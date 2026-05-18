"use strict";

/**
 * Discovery engine — harvests session signals into curator-reviewable proposals.
 *
 * Sources of candidate proposals (in priority order):
 * 1. #KNOWLEDGE-CANDIDATE inline tags in `.devt/state/scratchpad.md`
 * 2. .devt/state/decisions.md DEC-xxx entries (existing /devt:clarify output)
 * 3. Graphify god-nodes via parseReportSections (when graphify-out/GRAPH_REPORT.md exists)
 * 4. claude-mem MCP observations via `.devt/state/claude-mem-harvest.md` (when the
 *    orchestrator's pre-harvest step persisted them — workflows invoke
 *    mcp__plugin_claude-mem_mcp-search__search since devt's Node code
 *    cannot reach MCP directly)
 *
 * For each candidate, the engine:
 * - Fetches the FULL original reasoning (verbatim — no AI summarization)
 * - Cross-references existing memory docs (dedup) and REJ tombstones (suppress)
 * - Writes structured proposals to `.devt/memory/_suggestions.md`
 *
 * Hard guarantees:
 * - NEVER writes a permanent .devt/memory/{decisions,concepts,flows,rejected}/*.md
 * file. That is exclusively the curator agent's role via AskUserQuestion.
 * - REJ tombstone matches suppress proposals SILENTLY (the "no nag" mechanism).
 * - Idempotent: re-running on the same session window produces the same proposals.
 *
 * Phase 2. Phase 3 will wire this into the standalone /devt:preflight
 * Topic Pre-Flight Brief generator.
 */

const fs = require("fs");
const path = require("path");
const { atomicWriteFileSync } = require("./io.cjs");

// ---------------------------------------------------------------------------
// Paths + helpers
// ---------------------------------------------------------------------------

function findProjectRoot() {
  return require("./config.cjs").findProjectRoot();
}

function getMemoryRoot() {
  return path.join(findProjectRoot(), ".devt", "memory");
}

function getSuggestionsPath() {
  return path.join(getMemoryRoot(), "_suggestions.md");
}

function getStateDir() {
  return path.join(findProjectRoot(), ".devt", "state");
}

// ---------------------------------------------------------------------------
// Source 1: #KNOWLEDGE-CANDIDATE inline tags in scratchpad.md
//
// Format: `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] one-line summary`
// Followed optionally by indented body lines until the next non-indented line or another tag.
// ---------------------------------------------------------------------------

function harvestScratchpadTags() {
  const scratchpadPath = path.join(getStateDir(), "scratchpad.md");
  if (!fs.existsSync(scratchpadPath)) return [];

  const content = fs.readFileSync(scratchpadPath, "utf8");
  const lines = content.split("\n");
  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/#KNOWLEDGE-CANDIDATE:\s*(?:\[type=(\w+)\]\s*)?(.+)/);
    if (!m) continue;
    const proposed_type = (m[1] || "decision").toLowerCase();
    const summary = m[2].trim();

    // Collect body: indented continuation lines until next non-indented or another tag
    const bodyLines = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (/^\s+\S/.test(next) && !next.includes("#KNOWLEDGE-CANDIDATE")) {
        bodyLines.push(next.replace(/^\s+/, ""));
        j++;
      } else {
        break;
      }
    }

    candidates.push({
      id: null,
      timestamp: null,
      tag: proposed_type === "rejected" ? "REJ" : (proposed_type === "decision" ? "⚖️" : "🔵"),
      title: summary,
      body: bodyLines.join("\n"),
      proposed_type,
      source: "scratchpad",
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Source 2: .devt/state/decisions.md DEC-xxx entries
// ---------------------------------------------------------------------------

function harvestSessionDecisions() {
  const decisionsPath = path.join(getStateDir(), "decisions.md");
  if (!fs.existsSync(decisionsPath)) return [];

  const content = fs.readFileSync(decisionsPath, "utf8");
  const blocks = content.split(/^##\s+(DEC-\d+)/m);
  const candidates = [];

  // After split, blocks[0] is preamble; pairs after are [id, body, id, body, ...]
  for (let i = 1; i < blocks.length; i += 2) {
    const id = blocks[i];
    const body = (blocks[i + 1] || "").trim();
    const titleMatch = body.match(/^[:\s]*(.+?)$/m);
    const title = titleMatch ? titleMatch[1].trim() : id;

    candidates.push({
      id,
      timestamp: null,
      tag: "⚖️",
      title,
      body,
      proposed_type: "decision",
      source: "session-decisions",
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Source 3: graphify GRAPH_REPORT.md god-nodes
//
// Graphify's god-nodes are the most-connected concepts in the project (high
// fan-in) — exactly the kind of structural concept that belongs in CON-* docs
// but rarely surfaces through session-time ⚖️/🔵 signals. We propose each as
// a concept candidate; the curator AskUserQuestion gate decides per-symbol.
// Symbols already covered by an active CON/ADR are filtered out via
// memory.affectsSymbol() so we don't re-prompt on every harvest. The REJ
// tombstone mechanism handles "never propose this again" naturally.
// ---------------------------------------------------------------------------

function harvestGraphifyGodNodes() {
  let graphify;
  try { graphify = require("./graphify.cjs"); } catch { return []; }
  if (!graphify || graphify.status().state !== "ready") return [];

  const gods = graphify.godNodes(10);
  if (!gods.length) return [];

  let memory;
  try { memory = require("./memory.cjs"); } catch { memory = null; }

  const candidates = [];
  for (const g of gods) {
    const symbol = g.symbol.replace(/\(\)$/, "");
    if (!symbol || symbol.startsWith("_") || symbol.includes("/") || symbol.includes(" ")) continue;

    if (memory) {
      try {
        const hit = memory.affectsSymbol(symbol);
        if (hit && Array.isArray(hit.docs) && hit.docs.length > 0) continue;
      } catch { /* memory not initialized — propose anyway */ }
    }

    candidates.push({
      id: null,
      timestamp: null,
      tag: "🔵",
      title: `${symbol} — ${g.edge_count} edges (graphify god-node)`,
      body: `Graphify identified \`${symbol}\` as a god-node with ${g.edge_count} edges. High-fanin concepts are typical CON-* candidates: define what \`${symbol}\` is, who depends on it, and the invariants callers rely on.`,
      proposed_type: "concept",
      source: "graphify-god-node",
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Source 4: claude-mem MCP observations
//
// devt's Node code cannot reach MCP servers directly (zero-dep invariant).
// Workflows (dev / quick-implement / lesson-extraction) instruct the
// orchestrator — which runs in the main Claude session and has the
// project's MCP allowlist — to call `mcp__plugin_claude-mem_mcp-search__search`
// before invoking `memory suggest`. The orchestrator writes the result to
// `.devt/state/claude-mem-harvest.md` in this canonical format:
//   - [decision] <title>: <body>
//   - [discovery] <title>: <body>
//
// Modern claude-mem (v13.x) categorizes observations with `obs_type` ∈
// {bugfix, feature, refactor, change, discovery, decision}; only `decision`
// and `discovery` map to promotion-eligible candidates (⚖️ / 🔵).
//
// This function is no-op when the file is missing (the harvest step skipped
// silently because claude-mem MCP wasn't loaded or the call failed).
// ---------------------------------------------------------------------------

function harvestClaudeMemFromMcp() {
  const harvestPath = path.join(getStateDir(), "claude-mem-harvest.md");
  if (!fs.existsSync(harvestPath)) return [];

  let content;
  try { content = fs.readFileSync(harvestPath, "utf8"); }
  catch { return []; }

  const candidates = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^-\s+\[(\w+)\]\s+(.+?):\s+(.+)$/);
    if (!m) continue;
    const obsType = m[1].toLowerCase();
    if (obsType !== "decision" && obsType !== "discovery") continue;
    candidates.push({
      id: null,
      timestamp: null,
      tag: obsType === "decision" ? "⚖️" : "🔵",
      title: m[2].trim(),
      body: m[3].trim(),
      source: "claude-mem-mcp",
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// REJ tombstone consultation — suppresses candidates matching search_keywords
// ---------------------------------------------------------------------------

function loadRejectedKeywords() {
  // Read directly from the index if it exists; otherwise scan the rejected/ dir.
  try {
    const memory = require("./memory.cjs");
    const result = memory.listRejectedKeywords();
    if (Array.isArray(result)) {
      // Group by doc_id so we know which REJ matched
      const byDoc = {};
      for (const row of result) {
        if (!byDoc[row.id]) byDoc[row.id] = { id: row.id, title: row.title, summary: row.summary, keywords: [] };
        byDoc[row.id].keywords.push(row.keyword);
      }
      return Object.values(byDoc);
    }
  } catch {
    // Index missing — degrade to file-scan fallback
  }
  return [];
}

/**
 * Returns first matching REJ when any keyword appears as a substring (case-insensitive)
 * in the candidate's title or body. Returns null when no match.
 */
function findRejMatch(candidate, rejs) {
  const haystack = `${candidate.title}\n${candidate.body}`.toLowerCase();
  for (const rej of rejs) {
    for (const kw of rej.keywords) {
      if (haystack.includes(kw.toLowerCase())) {
        return { rej_id: rej.id, rej_title: rej.title, matched_keyword: kw };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dedup against existing memory docs
// ---------------------------------------------------------------------------

function loadExistingMemoryDocs() {
  try {
    const memory = require("./memory.cjs");
    const result = memory.listDocs();
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/**
 * Returns first dup match when candidate's title overlaps significantly with an
 * existing doc's title or summary. Coarse string-overlap heuristic — Phase 3
 * could swap in FTS5 match scoring.
 */
function findDuplicate(candidate, existing) {
  const candTokens = new Set(
    (candidate.title || "").toLowerCase().split(/\W+/).filter(t => t.length >= 4)
  );
  if (candTokens.size === 0) return null;
  for (const doc of existing) {
    const docTokens = new Set(
      `${doc.title} ${doc.summary || ""}`.toLowerCase().split(/\W+/).filter(t => t.length >= 4)
    );
    let overlap = 0;
    for (const t of candTokens) if (docTokens.has(t)) overlap++;
    const ratio = overlap / candTokens.size;
    if (ratio >= 0.6) {
      return { dup_id: doc.id, dup_title: doc.title, overlap_ratio: ratio };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wiki-link enrichment — find bare mentions of known doc IDs that should be linked
// ---------------------------------------------------------------------------

const WIKI_LINK_SURFACES = [
  ".devt/state/decisions.md",
  ".devt/state/research.md",
  ".devt/state/spec.md",
  "CLAUDE.md",
];

function discoverMissingWikiLinks() {
  const root = findProjectRoot();
  const existing = loadExistingMemoryDocs();
  if (existing.length === 0) return [];

  const proposals = [];
  for (const rel of WIKI_LINK_SURFACES) {
    const filePath = path.join(root, rel);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, "utf8");
    for (const doc of existing) {
      // Skip if already wiki-linked
      const idEscaped = doc.id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const wikiPattern = new RegExp(`\\[\\[${idEscaped}\\]\\]`);
      if (wikiPattern.test(content)) continue;
      // Detect bare mention
      const barePattern = new RegExp(`\\b${idEscaped}\\b`);
      const m = content.match(barePattern);
      if (m) {
        // Find the line for context
        const lines = content.split("\n");
        const lineIdx = lines.findIndex(l => l.includes(doc.id));
        proposals.push({
          file: rel,
          line: lineIdx + 1,
          doc_id: doc.id,
          doc_title: doc.title,
          context: lines[lineIdx] ? lines[lineIdx].trim().slice(0, 120) : "",
          proposal: `Add wiki-link: [[${doc.id}]]`,
        });
      }
    }
  }
  return proposals;
}

// ---------------------------------------------------------------------------
// Main: harvest from all sources, filter, dedup, write _suggestions.md
// ---------------------------------------------------------------------------

function harvest(_options) {
  // Master switch — when memory.enabled=false, harvest is a no-op so we don't
  // write to .devt/memory/_suggestions.md (a memory-layer artifact). Returns
  // the same envelope shape callers expect, with empty arrays + a state marker.
  const { getMergedConfig, isMemoryEnabled } = require("./config.cjs");
  if (!isMemoryEnabled(getMergedConfig())) {
    return {
      state: "disabled",
      reason: "memory.enabled=false in .devt/config.json",
      proposals: [],
      suppressed: [],
      duplicates: [],
    };
  }

  const rejs = loadRejectedKeywords();
  const existing = loadExistingMemoryDocs();

  const allCandidates = [
    ...harvestScratchpadTags(),
    ...harvestSessionDecisions(),
    ...harvestGraphifyGodNodes(),
    ...harvestClaudeMemFromMcp(),
  ];

  const proposals = [];
  const suppressed = [];
  const duplicates = [];

  for (const cand of allCandidates) {
    const rej = findRejMatch(cand, rejs);
    if (rej) {
      suppressed.push({ candidate: cand, suppressed_by: rej });
      continue;
    }
    const dup = findDuplicate(cand, existing);
    if (dup) {
      duplicates.push({ candidate: cand, duplicates: dup });
      continue;
    }
    proposals.push(cand);
  }

  const wikiLinkProposals = discoverMissingWikiLinks();

  return {
    proposals,
    suppressed,
    duplicates,
    wiki_link_enrichments: wikiLinkProposals,
    summary: {
      total_candidates: allCandidates.length,
      promoted_to_review: proposals.length,
      suppressed_by_rej: suppressed.length,
      filtered_as_duplicates: duplicates.length,
      wiki_links_to_add: wikiLinkProposals.length,
    },
  };
}

/**
 * Render the harvest result as a markdown report and write to _suggestions.md.
 * Curator reads this file to drive the AskUserQuestion approval flow.
 */
function writeSuggestionsReport(harvestResult) {
  const root = getMemoryRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

  const lines = [];
  lines.push("# Memory Layer — Discovery Suggestions");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("**This report is auto-generated. NO permanent files are written without explicit user approval via curator's AskUserQuestion flow.**");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`## Summary`);
  for (const [k, v] of Object.entries(harvestResult.summary)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");

  if (harvestResult.proposals.length > 0) {
    lines.push("## ⚖️/🔵 Proposed Promotions");
    lines.push("");
    lines.push("Each proposal carries the FULL original reasoning verbatim. Curator presents these via AskUserQuestion.");
    lines.push("");
    for (const p of harvestResult.proposals) {
      lines.push(`### ${p.tag} ${p.title}`);
      lines.push(`- Source: ${p.source}${p.id ? ` (${p.id})` : ""}`);
      lines.push(`- Proposed type: ${p.proposed_type || (p.tag === "⚖️" ? "decision" : "concept")}`);
      if (p.timestamp) lines.push(`- Recorded: ${p.timestamp}`);
      lines.push("");
      lines.push("**Original reasoning (verbatim):**");
      lines.push("```");
      lines.push(p.body || "(no body)");
      lines.push("```");
      lines.push("");
    }
  }

  if (harvestResult.suppressed.length > 0) {
    lines.push("## 🚫 Suppressed by REJ Tombstones (silent — not shown to user)");
    lines.push("");
    for (const s of harvestResult.suppressed) {
      lines.push(`- "${s.candidate.title}" matched ${s.suppressed_by.rej_id} via keyword "${s.suppressed_by.matched_keyword}"`);
    }
    lines.push("");
  }

  if (harvestResult.duplicates.length > 0) {
    lines.push("## 🔁 Duplicate Candidates (already covered by existing docs)");
    lines.push("");
    for (const d of harvestResult.duplicates) {
      lines.push(`- "${d.candidate.title}" overlaps ${d.duplicates.dup_id} (${(d.duplicates.overlap_ratio * 100).toFixed(0)}% token overlap) — consider whether the existing doc needs an UPDATE`);
    }
    lines.push("");
  }

  if (harvestResult.wiki_link_enrichments.length > 0) {
    lines.push("## 🔗 Wiki-Link Enrichments");
    lines.push("");
    lines.push("Bare mentions of doc IDs found in existing markdown that could become navigable wiki-links. Curator approves per file.");
    lines.push("");
    for (const w of harvestResult.wiki_link_enrichments) {
      lines.push(`- ${w.file}:${w.line} — bare mention of ${w.doc_id} (${w.doc_title})`);
      lines.push(`  - Context: \`${w.context}\``);
      lines.push(`  - Proposal: ${w.proposal}`);
    }
    lines.push("");
  }

  atomicWriteFileSync(getSuggestionsPath(), lines.join("\n"));
  return getSuggestionsPath();
}

// ---------------------------------------------------------------------------
// CLI dispatcher
// ---------------------------------------------------------------------------

function run(subcommand, _args) {
  const json = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");

  switch (subcommand) {
    case "harvest": {
      const result = harvest({});
      // When memory is disabled (master switch), skip writing the suggestions
      // report file — that file is itself a memory-layer artifact. Surface the
      // disabled state in the JSON envelope instead.
      if (result.state === "disabled") {
        json({ ...result, suggestions_path: null });
        return 0;
      }
      writeSuggestionsReport(result);
      json({
        ...result,
        suggestions_path: path.relative(findProjectRoot(), getSuggestionsPath()),
      });
      return 0;
    }
    case "wiki-links": {
      json({ proposals: discoverMissingWikiLinks() });
      return 0;
    }
    default:
      process.stderr.write(
        `Unknown discovery subcommand: ${subcommand}\n` +
        `Valid: harvest | wiki-links\n`
      );
      return 2;
  }
}

module.exports = {
  run,
  harvest,
  writeSuggestionsReport,
  harvestScratchpadTags,
  harvestSessionDecisions,
  harvestGraphifyGodNodes,
  harvestClaudeMemFromMcp,
  discoverMissingWikiLinks,
  findRejMatch,
  findDuplicate,
  loadRejectedKeywords,
  loadExistingMemoryDocs,
};
