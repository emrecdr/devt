"use strict";

/**
 * Reuse-candidate detector. Queries the local graphify graph for functions
 * matching a task description and scores them by a 3-signal heuristic:
 *   +3 if name contains a task keyword (verb or noun)
 *   +3 if any depth-2 caller is in expected_paths (from preflight-brief.json
 *      ::suggested_reading or scope_hint)
 *   +2 if the first comment line near the function definition contains a task keyword
 *   +1 if in_degree >= 2 (function is actually used)
 *
 * Output bucketed: STRONG (>=7), MEDIUM (4-6), WEAK (1-3). Caps at top 8.
 * Writes .devt/state/reuse-candidates.md (markdown for human + programmer).
 * Returns JSON summary for CLI callers and programmatic use.
 */

const fs = require("fs");
const path = require("path");
const graphify = require("./graphify.cjs");
const preflight = require("./preflight.cjs");
const { findProjectRoot } = require("./config.cjs");

const MAX_KEYWORDS = 5;
const MAX_QUERY_RESULTS = 10;
const MAX_CANDIDATES = 8;
const STRONG_THRESHOLD = 7;
const MEDIUM_THRESHOLD = 4;
const FILE_READ_BYTE_CAP = 200000;

function deriveReuseCandidates(taskText, opts = {}) {
  if (!taskText || typeof taskText !== "string" || !taskText.trim()) {
    return { ok: false, reason: "no task text provided", candidates: [] };
  }

  const status = graphify.status();
  if (status.state !== "ready") {
    return {
      ok: true,
      candidates: [],
      candidates_total: 0,
      reason: `graphify state=${status.state} — reuse pre-search not available; programmer must scan manually`,
      graphify_state: status.state,
    };
  }

  // Extract keywords. preflight.extractTopic returns {symbols, keywords, domains, raw}.
  // Use symbols first (PascalCase identifiers), then keywords + domains of length >= 4.
  const topic = preflight.extractTopic(taskText);
  const symbolTerms = (topic.symbols || []).slice(0, 3);
  const contentTerms = [
    ...(topic.keywords || []),
    ...(topic.domains || []),
  ]
    .filter((w) => w.length >= 4)
    .filter((w) => !symbolTerms.includes(w));

  const queryTerms = [
    ...symbolTerms,
    ...contentTerms.slice(0, MAX_KEYWORDS - symbolTerms.length),
  ];

  if (queryTerms.length === 0) {
    return { ok: true, candidates: [], candidates_total: 0, reason: "no query terms extracted from task" };
  }

  // Query graphify for each term, union candidate IDs.
  const seen = new Set();
  const rawCandidates = [];
  for (const term of queryTerms) {
    const result = graphify.queryGraph(term, { limit: MAX_QUERY_RESULTS });
    if (!result.results || result.results.length === 0) continue;
    for (const node of result.results) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      rawCandidates.push({ ...node, matched_term: term });
    }
  }

  if (rawCandidates.length === 0) {
    return { ok: true, candidates: [], candidates_total: 0, reason: "no graph nodes matched task keywords" };
  }

  // Load expected_paths from preflight-brief.json::suggested_reading for caller-community scoring.
  const expectedPaths = readExpectedPaths();

  // Enrich each candidate: caller graph + signature/docstring + score.
  const enriched = rawCandidates.map((c) => {
    const callers = graphify.getNeighbors(c.label || c.id, {
      direction: "in",
      depth: 2,
    });
    const callerFiles = ((callers && callers.results) || [])
      .map((n) => n.source_file)
      .filter(Boolean);
    const callerOverlap = callerFiles.some((f) =>
      expectedPaths.some((p) => f.includes(p) || p.includes(f)),
    );

    const { signature, firstComment, lineNumber } = readSymbolDetails(
      c.source_file,
      c.label,
    );

    let score = 0;
    const labelLower = (c.label || "").toLowerCase();
    if (queryTerms.some((t) => labelLower.includes(t.toLowerCase()))) score += 3;
    if (callerOverlap) score += 3;
    if (firstComment) {
      const fcLower = firstComment.toLowerCase();
      if (queryTerms.some((t) => fcLower.includes(t.toLowerCase()))) score += 2;
    }
    if ((c.in_degree || 0) >= 2) score += 1;

    return {
      label: c.label,
      source_file: c.source_file,
      line: lineNumber,
      signature: signature || "(signature unavailable)",
      first_comment: firstComment || "",
      matched_term: c.matched_term,
      in_degree: c.in_degree || 0,
      caller_files_sample: callerFiles.slice(0, 3),
      caller_overlap: callerOverlap,
      score,
    };
  });

  // Sort descending by score, cap to top 8.
  enriched.sort((a, b) => b.score - a.score);
  const top = enriched.slice(0, MAX_CANDIDATES);

  const strong = top.filter((c) => c.score >= STRONG_THRESHOLD);
  const medium = top.filter((c) => c.score >= MEDIUM_THRESHOLD && c.score < STRONG_THRESHOLD);
  const weak = top.filter((c) => c.score > 0 && c.score < MEDIUM_THRESHOLD);

  const md = renderMarkdown(taskText, queryTerms, { strong, medium, weak });
  const stateDir = path.join(findProjectRoot(), ".devt", "state");
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  const outPath = path.join(stateDir, "reuse-candidates.md");
  fs.writeFileSync(outPath, md);

  return {
    ok: true,
    candidates_total: top.length,
    strong_count: strong.length,
    medium_count: medium.length,
    weak_count: weak.length,
    query_terms: queryTerms,
    candidates: top,
    output_path: ".devt/state/reuse-candidates.md",
  };
}

function readExpectedPaths() {
  try {
    const root = findProjectRoot();
    if (!root) return [];
    const briefPath = path.join(root, ".devt", "state", "preflight-brief.json");
    if (!fs.existsSync(briefPath)) return [];
    const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
    // Cal #33.B-2: suggested_reading is {files, symbols}; reuse-search
    // expected_paths needs the files (caller-community paths for scoring).
    const sr = brief.suggested_reading;
    const files = sr && Array.isArray(sr.files) ? sr.files : [];
    return files.map(String);
  } catch {
    return [];
  }
}

function readSymbolDetails(sourceFile, label) {
  if (!sourceFile || !label) return { signature: null, firstComment: null, lineNumber: null };
  try {
    const root = findProjectRoot();
    const fullPath = path.isAbsolute(sourceFile) ? sourceFile : path.join(root, sourceFile);
    if (!fs.existsSync(fullPath)) return { signature: null, firstComment: null, lineNumber: null };
    const stat = fs.statSync(fullPath);
    if (stat.size > FILE_READ_BYTE_CAP) {
      return { signature: null, firstComment: "(file too large to scan)", lineNumber: null };
    }
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split("\n");
    // Strip trailing () that graphify appends to function labels (e.g. "parse_email_backend()").
    const cleanLabel = label.replace(/\(\s*\)$/, "");
    // Match common declaration forms across JS/TS/Python/Go/Rust.
    // async may precede both JS `function` and Python `def`.
    const labelEsc = cleanLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `^\\s*(?:export\\s+)?(?:async\\s+)?(?:function|def|class|func|fn|const|let|var)?\\s*` +
      `${labelEsc}\\b`,
    );
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        const sig = lines[i].trim().slice(0, 120);
        // Scan up to 3 lines before for a comment.
        let comment = null;
        for (let j = Math.max(0, i - 3); j < i; j++) {
          const t = lines[j].trim();
          if (/^(\/\/|#|\*|\/\*)/.test(t) && t.length > 2) {
            comment = t.replace(/^[\/*#\s]+/, "").slice(0, 120);
            break;
          }
        }
        return { signature: sig, firstComment: comment, lineNumber: i + 1 };
      }
    }
    return { signature: null, firstComment: null, lineNumber: null };
  } catch {
    return { signature: null, firstComment: null, lineNumber: null };
  }
}

function renderMarkdown(taskText, queryTerms, buckets) {
  const lines = [];
  lines.push(`# Reuse Candidates — task: ${taskText.slice(0, 200)}`);
  lines.push("");
  lines.push(`Generated by: \`state derive-reuse-candidates\``);
  lines.push(`Query terms: ${queryTerms.join(", ")}`);
  lines.push("");
  lines.push("## How to use this file");
  lines.push("");
  lines.push("Each candidate below is an existing function that may share responsibility with what you are about to build. BEFORE writing new code:");
  lines.push("");
  lines.push("1. Read each STRONG and MEDIUM candidate's source location to assess fit.");
  lines.push("2. Write your decision to `.devt/state/reuse-analysis.md` — one entry per candidate:");
  lines.push("   - **REUSED**: cite import path; no new code written for this concern");
  lines.push("   - **EXTENDED**: cite which function + what you'll add (one-line reason)");
  lines.push("   - **REJECTED**: one-sentence reason (e.g., 'wrong domain', 'too specific')");
  lines.push("3. `state assert-reuse-analyzed` will BLOCK the test step until reuse-analysis.md is written.");
  lines.push("");

  for (const [bucketName, items, hint] of [
    ["STRONG (reuse directly unless clear gap)", buckets.strong, "Reuse or extend; do not duplicate."],
    ["MEDIUM (likely overlap — read source to confirm)", buckets.medium, "Often holistic functions that already cover your need internally."],
    ["WEAK (review and probably reject)", buckets.weak, "Listed for completeness; usually wrong domain."],
  ]) {
    if (items.length === 0) continue;
    lines.push(`## ${bucketName}`);
    lines.push("");
    lines.push(`> ${hint}`);
    lines.push("");
    for (const c of items) {
      const loc = c.line ? `${c.source_file}:${c.line}` : c.source_file;
      lines.push(`### \`${c.label}\` at \`${loc}\``);
      lines.push(`- **Signature**: \`${c.signature}\``);
      lines.push(`- **Score**: ${c.score}/10 (matched term: ${c.matched_term}, in_degree: ${c.in_degree}${c.caller_overlap ? ", caller overlap" : ""})`);
      if (c.first_comment) lines.push(`- **First comment**: ${c.first_comment}`);
      if (c.caller_files_sample.length) {
        lines.push(`- **Sample callers**: ${c.caller_files_sample.join(", ")}`);
      }
      lines.push("");
    }
  }

  if (buckets.strong.length + buckets.medium.length + buckets.weak.length === 0) {
    lines.push("## No candidates found");
    lines.push("");
    lines.push("Either the graph has no matching nodes, or graphify is unavailable. Proceed with manual codebase scan per programmer.md guidance.");
  }

  return lines.join("\n") + "\n";
}

module.exports = {
  deriveReuseCandidates,
};
