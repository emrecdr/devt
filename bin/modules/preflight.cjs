"use strict";

/**
 * Topic Pre-Flight Brief generator.
 *
 * Orchestrates Lanes A-F + Graphify blast radius for a development task,
 * producing `.devt/state/preflight-brief.md` — a single document that lists
 * every governing ADR/Concept/Flow, all relevant REJ tombstones, related
 * lessons, and (when Graphify is enabled) blast-radius analysis.
 *
 * Lanes:
 * A: Domain match — list_active(domain) per extracted domain
 * B: FTS expansion — queryFTS(terms) across the unified index
 * C: Symbol match (Graphify) — getBySymbol(sym) per subject symbol
 * D: Wiki-link closure — getLinks(id, depth=2) from initial matches
 * E: Rejected check — listRejectedKeywords() filtered to topic
 * F: Lessons filter — filters governing docs (A∪B∪C∪D) for doc_type='lesson'
 *
 * Memory Graph: a flat `{source, predicate, target}` triples view of
 * the depth-2 subgraph rooted at the governing union (A∪B∪C∪D). Rendered as a
 * dedicated section between Governing Documentation and Rejected Approaches.
 *
 * Determinism: lanes are independent and ordered; merging is by doc_id;
 * output ordering is alphabetical by id within each section. Identical
 * input on identical state produces byte-identical output (modulo the
 * timestamp footer, which is deliberately the only varying field).
 */

const fs = require("fs");
const path = require("path");
const memory = require("./memory.cjs");
const graphify = require("./graphify.cjs");
const { findProjectRoot, getMergedConfig, isMemoryEnabled } = require("./config.cjs");
const { atomicWriteFileSync, atomicWriteJsonSync } = require("./io.cjs");

const STATE_DIR = path.join(".devt", "state");
const BRIEF_FILE = "preflight-brief.md";

// Graph staleness threshold for Pre-Flight warnings — balances actionable signal
// vs noise after every minor commit.
const STALE_LAG_COMMITS = 10;

// Suggested-reading caps: keep the orchestrator's <scope_hint> payload bounded
// so a topic with many governing docs can't balloon dispatch prefix bytes.
const MAX_DIRECT_DEPS = 12;

// Tier-aware <scope_hint> cap. Field-validated against greenfield-api: a
// 61-file PR in COMPLEX-tier review was crowded out by the 8-item ceiling —
// reviewers fell back to grep. SURGICAL/TRIVIAL keep 8 (scannable Brief),
// STANDARD bumps to 15, COMPLEX/QUALITY gets 25.
const SCOPE_HINT_CAP_BY_TIER = {
  TRIVIAL: 8,
  SIMPLE: 8,
  STANDARD: 15,
  COMPLEX: 25,
};
const DEFAULT_SCOPE_HINT_CAP = 8;

// Read the current workflow's complexity tier from workflow.yaml. Returns
// undefined when no workflow is active or tier is absent — callers fall back
// to DEFAULT_SCOPE_HINT_CAP. Never throws.
function readWorkflowTier() {
  try {
    const fs = require("fs");
    const path = require("path");
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, ".devt", "state", "workflow.yaml");
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, "utf8");
        const m = content.match(/^tier:\s*"?(TRIVIAL|SIMPLE|STANDARD|COMPLEX)"?\s*$/m);
        return m ? m[1] : undefined;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fall through to default */ }
  return undefined;
}

function resolveScopeHintCap() {
  const tier = readWorkflowTier();
  if (tier && Object.prototype.hasOwnProperty.call(SCOPE_HINT_CAP_BY_TIER, tier)) {
    return SCOPE_HINT_CAP_BY_TIER[tier];
  }
  return DEFAULT_SCOPE_HINT_CAP;
}


function dedupeCap(items, cap) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

// Topic extraction — pragmatic keyword + symbol parsing. Not NLP-grade, but
// deterministic and zero-deps. The intent: pull domain hints, capitalized
// symbols (likely class names), and quoted phrases out of a free-form task.

const DOMAIN_HINTS = [
  "auth", "authentication", "authorization", "rbac", "session", "login", "logout",
  "payment", "billing", "checkout", "subscription", "invoice",
  "user", "account", "profile", "registration", "signup",
  "api", "endpoint", "route", "controller",
  "database", "migration", "schema", "query", "orm",
  "cache", "redis", "memcached",
  "ui", "frontend", "view", "component", "page",
  "test", "testing", "fixture", "mock",
  "security", "encryption", "hashing", "csrf", "xss", "ssrf",
  "logging", "metrics", "telemetry", "observability",
  "error", "exception", "validation",
  "deployment", "ci", "cd", "build", "release",
];

// Stop-words filtered out before FTS query construction
const STOP_WORDS = new Set([
  "a", "an", "and", "the", "or", "but", "to", "for", "of", "in", "on", "at",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "should", "could", "can", "may", "might",
  "i", "you", "we", "they", "it", "this", "that", "these", "those",
  "add", "fix", "update", "change", "remove", "refactor", "implement", "build",
  "make", "create", "new", "support", "feature", "task",
]);

// Symbol-extraction denylist.
// PascalCase regex catches common English words used as sentence-leading verbs/markers
// ("Add", "Fix", "Refactor" at the start of a task description). These are NOT symbols
// and pollute Lane C results. Filter them out so symbol-anchored queries stay precise.
//
// Lowercased for comparison — matches symbols regardless of original casing.
const SYMBOL_DENYLIST = new Set([
  // Action verbs commonly capitalized as task-leading words
  "add", "fix", "remove", "delete", "update", "change", "rename", "refactor",
  "implement", "build", "create", "make", "extend", "improve", "optimize",
  "support", "introduce", "migrate", "wire", "integrate", "polish",
  // Common English markers
  "before", "after", "during", "while", "when", "where", "what", "which", "who",
  "the", "this", "that", "these", "those", "some", "all", "any", "each",
  // Generic nouns that are usually NOT symbols
  "feature", "task", "bug", "issue", "todo", "fixme", "note", "review",
  // Common short labels
  "api", "ui", "cli", "db", "url", "http", "https", "json", "yaml", "xml",
  "css", "html", "sql",
  // Doc / repo / spec filenames commonly capitalized in task text
  "readme", "changelog", "license", "notice", "authors", "maintainers",
  "module", "modules", "package", "packages", "openapi", "swagger",
  "graphql", "restful", "sdk", "mvp",
  // Product / platform proper nouns — mixed-case so isAllCapsNoise misses them
  // but they appear in task titles ("PR #N (Bitbucket feature/X)") where the
  // PascalCase regex grabs them as symbols. Without this filter they crowd out
  // real code identifiers and the scan-prep gate fires on noise.
  "bitbucket", "github", "gitlab", "stripe", "notion", "linear", "slack",
  "hubspot", "salesforce", "discord", "confluence", "jira", "trello", "asana",
  "intercom", "segment", "datadog", "sentry", "pagerduty", "cloudflare",
]);

// Tokens of pure ALL-CAPS letters (≥4 chars, no lowercase) are usually
// project labels (CHANGELOG, MODULE), issue prefixes (GFBUGS, ENG, JIRA-NNN),
// or file/doc names — rarely code identifiers. Mixed-case PascalCase names
// like DeviceSummary, LicenseResponse, OpenAPI keep flowing through.
function isAllCapsNoise(token) {
  if (token.length < 4) return false;
  return /^[A-Z][A-Z0-9_-]*$/.test(token);
}

// File extensions whose contents we'll parse for declaration symbols. Anything
// outside this set is skipped to avoid binary reads and meaningless lockfile
// noise. Keep narrow on purpose — false positives from generated/vendored
// files would crowd out real anchor symbols.
const DIFF_SYMBOL_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".cs", ".swift",
  ".vue", ".svelte",
]);

// Pulls declaration symbols (class/function/interface/etc.) out of changed
// files in the working tree. These are higher-signal than PascalCase regex on
// task text because they're grounded in actual code touched right now —
// unblocks the `symbol_anchored` graphify tier on Bitbucket projects where
// PR-scoped diffs aren't available.
//
// Cheap by design: caps file count + per-file byte read so a large diff can't
// stall the preflight call. All git/fs failures fall through silently — the
// caller still gets a topic from the task text.
// Single-range extraction worker — pulls declaration symbols from files that
// changed in one git ref range. Caller is responsible for merging across
// multiple ranges via extractDiffSymbols().
function _symbolsFromRange(refRange, maxFiles, maxBytesPerFile) {
  // Defensive whitelist so the git ref can never escape into a shell — also
  // catches typos that would otherwise turn into a confused `git diff`.
  if (!/^[A-Za-z0-9_./~^@-]{1,100}$/.test(refRange)) return [];

  try {
    const { execFileSync } = require("child_process");
    const fs = require("fs");
    const path = require("path");

    const out = execFileSync(
      "git",
      ["diff", "--name-only", refRange],
      { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }
    );
    const files = out.split("\n").filter(Boolean).slice(0, maxFiles);

    const declRe = /(?:^|\n)\s*(?:export\s+(?:default\s+)?(?:async\s+)?)?(?:class|function|interface|type|def|trait|struct|enum|fn)\s+([A-Z][a-zA-Z0-9_]{2,})/g;

    const symbols = [];
    const seen = new Set();
    for (const rel of files) {
      const ext = path.extname(rel).toLowerCase();
      if (!DIFF_SYMBOL_EXTENSIONS.has(ext)) continue;
      try {
        const fd = fs.openSync(rel, "r");
        const buf = Buffer.alloc(maxBytesPerFile);
        const n = fs.readSync(fd, buf, 0, maxBytesPerFile, 0);
        fs.closeSync(fd);
        const content = buf.subarray(0, n).toString("utf8");
        let m;
        declRe.lastIndex = 0;
        while ((m = declRe.exec(content)) !== null) {
          const sym = m[1];
          if (SYMBOL_DENYLIST.has(sym.toLowerCase())) continue;
          if (isAllCapsNoise(sym)) continue;
          if (!seen.has(sym)) { seen.add(sym); symbols.push(sym); }
        }
      } catch { /* unreadable file → skip */ }
    }
    return symbols;
  } catch {
    return [];
  }
}

function extractDiffSymbols(opts = {}) {
  const maxFiles = Number.isFinite(opts.maxFiles) ? opts.maxFiles : 30;
  const maxBytesPerFile = Number.isFinite(opts.maxBytesPerFile) ? opts.maxBytesPerFile : 50000;

  // Explicit refRange opts.refRange short-circuits multi-range — preserves the
  // smoke-test contract where callers pin a specific ref to verify a behavior.
  if (typeof opts.refRange === "string") {
    return _symbolsFromRange(opts.refRange, maxFiles, maxBytesPerFile);
  }

  // Default: merge two ranges to cover both PR-review (committed diff vs.
  // primary branch) and in-progress work (uncommitted working tree). The PR
  // case was missed in v0.52.0 — field-validated against greenfield-api on a
  // feature/ branch where `git diff HEAD` returns 0 files.
  const ranges = ["HEAD"];
  try {
    const { getMergedConfig } = require("./config.cjs");
    const cfg = getMergedConfig();
    const primary = (cfg && cfg.git && typeof cfg.git.primary_branch === "string" && cfg.git.primary_branch) || "main";
    // Three-dot syntax: symbols changed on this branch since divergence from
    // primary. This is the PR diff for typical feature-branch workflows.
    ranges.push(`${primary}...HEAD`);
  } catch { /* config unavailable → working-tree-only fallback */ }

  const seen = new Set();
  const merged = [];
  for (const range of ranges) {
    for (const sym of _symbolsFromRange(range, maxFiles, maxBytesPerFile)) {
      if (!seen.has(sym)) { seen.add(sym); merged.push(sym); }
    }
  }
  return merged;
}

/**
 * Extract topic structure from a free-form task description.
 * Returns: { domains, symbols, keywords, raw }
 *
 * `opts.gitDiffSymbols` — symbols pre-extracted from the working-tree diff.
 * When supplied (or auto-fetched by callers via `extractDiffSymbols()`), they
 * rank ABOVE PascalCase-on-text matches in the returned `symbols` array
 * because changed-file declarations are higher-signal than NLP-on-task-text.
 */
function extractTopic(taskText, opts = {}) {
  if (!taskText || typeof taskText !== "string") {
    return { domains: [], symbols: [], keywords: [], raw: "" };
  }
  const text = taskText.trim();
  const diffSymbols = Array.isArray(opts.gitDiffSymbols)
    ? opts.gitDiffSymbols.filter(s => typeof s === "string" && s.length >= 3 && !SYMBOL_DENYLIST.has(s.toLowerCase()) && !isAllCapsNoise(s))
    : [];

  // Symbols: PascalCase identifiers ≥3 chars, deduped, denylist-filtered,
  // ALL-CAPS noise filtered. Preserves mixed-case identifiers
  // (DeviceSummary) while rejecting project labels (CHANGELOG, GFBUGS).
  const symbolMatches = text.match(/\b[A-Z][a-zA-Z0-9]{2,}\b/g) || [];
  const textSymbols = Array.from(new Set(symbolMatches))
    .filter(s => !SYMBOL_DENYLIST.has(s.toLowerCase()))
    .filter(s => !isAllCapsNoise(s));
  // Diff symbols come first; text symbols only contribute their delta. Order
  // matters because downstream consumers (blast_radius args, scope_hint cap)
  // may truncate to top-N — the higher-signal source wins.
  const seen = new Set();
  const symbols = [];
  for (const s of diffSymbols) { if (!seen.has(s)) { seen.add(s); symbols.push(s); } }
  for (const s of textSymbols) { if (!seen.has(s)) { seen.add(s); symbols.push(s); } }

  // Lowercased word stream for domain + keyword extraction
  const words = (text.toLowerCase().match(/[a-z][a-z0-9_-]{1,30}/g) || []);
  const domains = Array.from(new Set(words.filter(w => DOMAIN_HINTS.includes(w)))).sort();

  // Keywords: words ≥3 chars, not stop-words, not domains, not symbols (lowered)
  const symbolLower = new Set(symbols.map(s => s.toLowerCase()));
  const domainSet = new Set(domains);
  const keywords = Array.from(new Set(
    words.filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !domainSet.has(w) && !symbolLower.has(w))
  )).sort();

  // Service-directory fallback. Field case (greenfield GF-543): "tablet_communication
  // permission" returned 0 symbols because tablet_communication is a snake_case
  // directory name, not a PascalCase identifier. Without this fallback the
  // scan_prep cascade fails (symbols=0 → blast=skip → impact=skip → subagent blind).
  // When `opts.graphifyQuery` is injected and text+diff symbols are empty, resolve
  // snake_case keywords (foo_bar / foo_bar_baz) via FTS against the live graph.
  // Cap at 3 candidate queries — too many pollutes scope_hint and dominates cost.
  const graphifyQuery = typeof opts.graphifyQuery === "function" ? opts.graphifyQuery : null;
  if (symbols.length === 0 && graphifyQuery) {
    const candidates = Array.from(new Set(
      words.filter(w => /^[a-z][a-z0-9]+(_[a-z0-9]+)+$/.test(w) && !STOP_WORDS.has(w))
    )).slice(0, 3);
    for (const cand of candidates) {
      let r;
      try { r = graphifyQuery(cand, { limit: 2 }); } catch { continue; }
      if (!r || !Array.isArray(r.results)) continue;
      for (const node of r.results) {
        const label = (node && (node.label || node.id)) || null;
        if (!label) continue;
        if (!seen.has(label) && !SYMBOL_DENYLIST.has(label.toLowerCase()) && !isAllCapsNoise(label)) {
          seen.add(label);
          symbols.push(label);
        }
      }
    }
  }

  return { domains, symbols, keywords, raw: text };
}

/**
 * Defensive coercion — memory.cjs `withDb` helper returns `{ error }` when no
 * index exists. Normalize that to an empty array so lane code stays simple.
 */
function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function dedupSortById(docs) {
  const map = new Map();
  for (const d of docs) if (d && d.id && !map.has(d.id)) map.set(d.id, d);
  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Lane A — domain match. For each extracted domain, pull active docs.
 */
function laneA(topic) {
  const out = [];
  for (const domain of topic.domains) {
    try { out.push(...asArray(memory.listActive(domain))); } catch { /* empty */ }
  }
  return dedupSortById(out);
}

/**
 * Lane B — FTS expansion. Combines domain words + symbols (lowercased) +
 * a bounded slice of keywords. Caps at 12 tokens to keep FTS query tight.
 */
function laneB(topic, limit = 30) {
  const tokens = [
    ...topic.domains,
    ...topic.symbols.map(s => s.toLowerCase()),
    ...topic.keywords.slice(0, 8),
  ].slice(0, 12);
  if (tokens.length === 0) return [];
  let results;
  try { results = asArray(memory.queryFTS(tokens.join(" "), { limit })); }
  catch { results = []; }
  return results;
}

/**
 * Lane C — symbol match. Requires Graphify-enabled OR the doc's
 * affects_symbols already populated (path-only deployments still get this lane,
 * just without AST validation).
 */
function laneC(topic) {
  const out = [];
  for (const sym of topic.symbols) {
    try { out.push(...asArray(memory.getBySymbol(sym))); } catch { /* empty */ }
  }
  return dedupSortById(out);
}

/**
 * Lane D — wiki-link transitive closure (depth 2) from the union of
 * lanes A+B+C. Only returns docs NOT already in the seed set.
 */
function laneD(seedDocs, depth = 2) {
  const seedIds = new Set(seedDocs.map(d => d.id));
  const expanded = new Map();
  for (const seed of seedDocs) {
    let linked;
    try { linked = asArray(memory.getLinks(seed.id, depth)); } catch { linked = []; }
    for (const l of linked) {
      // getLinks may return either flat doc rows or {target_id} rows; handle both.
      const id = l.id || l.target_id;
      if (!id || seedIds.has(id) || expanded.has(id)) continue;
      // Resolve to full doc if we only have an id reference
      let doc = l.title ? l : null;
      if (!doc) { try { doc = memory.getDoc(id); } catch { doc = null; } }
      if (doc) expanded.set(id, doc);
    }
  }
  return Array.from(expanded.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Lane E — rejected check. Pull all REJ tombstones and filter to those whose
 * search_keywords overlap with the topic's keyword/domain/symbol set.
 */
function laneE(topic) {
  let all;
  try { all = asArray(memory.listRejectedKeywords()); } catch { all = []; }
  if (all.length === 0) return [];
  const haystack = new Set([
    ...topic.domains,
    ...topic.keywords,
    ...topic.symbols.map(s => s.toLowerCase()),
  ]);
  const matchedById = new Map();
  for (const row of all) {
    const kw = (row.keyword || "").toLowerCase();
    if (!kw) continue;
    // Two match modes: direct word overlap OR substring against raw task text
    const hit = haystack.has(kw)
      || kw.split(/\s+/).some(t => haystack.has(t))
      || (topic.raw && topic.raw.toLowerCase().includes(kw));
    if (hit && !matchedById.has(row.id)) {
      matchedById.set(row.id, { id: row.id, title: row.title, summary: row.summary, keyword: row.keyword });
    }
  }
  return Array.from(matchedById.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Lane F — pulls lesson-typed entries out of the deduped governing union so the
 * Brief can render them under a dedicated header. Caller must pass an already-
 * deduped array; the architectural rationale lives in docs/MEMORY.md.
 *
 * @param {Array<{id: string, doc_type: string}>} dedupedUnion
 */
function laneF(dedupedUnion, limit = 8) {
  return dedupedUnion.filter(d => d && d.doc_type === "lesson").slice(0, limit);
}

/**
 * Compute blast radius via Graphify when available; emit degraded payload otherwise.
 */
function blastRadius(topic) {
  if (topic.symbols.length === 0) {
    return { effect_size: null, source: "skipped", reason: "no symbols extracted from task" };
  }
  return graphify.blastRadius(topic.symbols);
}

/**
 * Render the markdown Brief from lane outputs.
 */
function renderBrief({ task, topic, lanes, governing, triples, blast, report, generatedAt, suggestedReading }) {
  const lines = [];
  lines.push(`# Pre-Flight Brief: ${task || "(unspecified task)"}`);
  lines.push("");
  lines.push("## Status: FRESH");
  lines.push("");

  // Memory FTS5 index missing → governance lanes A/B/D/F return empty even
  // when ADR/CON/FLOW/REJ/LES docs exist on disk. The signal is invisible to
  // a reader who doesn't know the database had to be built. Surface it
  // explicitly at the top so the next action ("run `/devt:memory init`") is
  // unambiguous.
  try {
    const dbPath = path.join(findProjectRoot(), ".devt", "memory", "index.db");
    if (!fs.existsSync(dbPath)) {
      lines.push("> ⚠️ **Memory index not built** — governing-doc lanes (A/B/D/F) will be empty even if `.devt/memory/{decisions,concepts,flows,rejected,lessons}/` contain docs. Run `node bin/devt-tools.cjs memory init` then re-run preflight to enable ADR/CON/FLOW/REJ/LES discovery.");
      lines.push("");
    }
  } catch { /* findProjectRoot may throw in tests — skip the check */ }

  lines.push("## Topic Extracted");
  lines.push(`- **Domains:** ${topic.domains.length ? topic.domains.join(", ") : "_(none)_"}`);
  lines.push(`- **Symbols:** ${topic.symbols.length ? topic.symbols.join(", ") : "_(none)_"}`);
  lines.push(`- **Keywords:** ${topic.keywords.length ? topic.keywords.slice(0, 12).join(", ") : "_(none)_"}`);
  lines.push("");

  // Caller passes the deduped union directly. Defensive fallback for tests
  // that build `lanes` without pre-deduping — keeps renderer self-sufficient.
  if (!governing) {
    governing = dedupSortById([...lanes.A, ...lanes.B, ...lanes.C, ...lanes.D]);
  }

  // Per-doc lane attribution: A wins on tie, then B, C, D. Build once (O(n))
  // instead of running 3 Array.find probes per governing doc.
  const laneOf = new Map();
  for (const [letter, arr] of [["A", lanes.A], ["B", lanes.B], ["C", lanes.C], ["D", lanes.D]]) {
    for (const d of arr) if (d && d.id && !laneOf.has(d.id)) laneOf.set(d.id, letter);
  }

  lines.push("## Governing Documentation (depth-2 transitive closure)");
  if (governing.length === 0) {
    lines.push("_No active ADR/Concept/Flow docs match this topic._");
  } else {
    for (const d of governing) {
      const lane = laneOf.get(d.id) || "D";
      lines.push(`- [${d.id}] ${d.title || "(untitled)"} — ${d.summary || ""} _(lane ${lane})_`);
    }
  }
  lines.push("");

  // Memory Graph subgraph. Renders the depth-2 link
  // closure rooted at the governing union as flat triples — agents can scan
  // structural relationships (supersedes/depends_on/relates_to/etc.) without
  // running individual get_doc calls per neighbor.
  lines.push("## Memory Graph (2-hop subgraph)");
  if (!Array.isArray(triples) || triples.length === 0) {
    lines.push("_No outgoing links from governing docs — flat docset for this topic._");
  } else {
    for (const t of triples) {
      lines.push(`- ${t.source} → ${t.predicate} → ${t.target}`);
    }
  }
  lines.push("");

  lines.push("## Rejected Approaches (REJ tombstones)");
  if (lanes.E.length === 0) {
    lines.push("_No matching REJ tombstones — no prior NOs in this topic area._");
  } else {
    for (const r of lanes.E) {
      lines.push(`- [${r.id}] ${r.title} — matched on keyword \`${r.keyword}\``);
      if (r.summary) lines.push(`  > ${r.summary}`);
    }
  }
  lines.push("");

  lines.push("## Related Operational Lessons");
  if (lanes.F.length === 0) {
    lines.push("_No related lessons indexed for this topic._");
  } else {
    for (const l of lanes.F.slice(0, 8)) {
      const id = l.id || "LES-?";
      const text = l.title || l.summary || "";
      lines.push(`- [${id}] ${text}`);
    }
  }
  lines.push("");

  lines.push("## Blast Radius");
  if (blast.source === "skipped") {
    lines.push(`_${blast.reason || "skipped"}_`);
  } else if (blast.source === "grep") {
    lines.push("_Graphify disabled or unavailable — blast radius computed from path heuristics only._");
    if (blast.reason) lines.push(`_${blast.reason}_`);
  } else {
    lines.push(`- **Effect size:** ${blast.effect_size || "unknown"}`);
    lines.push(`- **Direct dependents:** ${(blast.direct_dependents || []).length}`);
    lines.push(`- **Indirect dependents (depth 2):** ${(blast.indirect_dependents || []).length}`);
    lines.push(`- **Modules touched:** ${blast.modules_touched || 0}`);
    if (blast.god_node_match) lines.push("- ⚠️ **God-node match** — review GRAPH_REPORT.md before proceeding");
    if (blast.ambiguous_bindings && blast.ambiguous_bindings > 0) {
      lines.push(`- ⚠️ **AMBIGUOUS bindings:** ${blast.ambiguous_bindings} (review needed)`);
    }
    try {
      const f = graphify.freshness();
      const stale = f.state === "ready" && !f.fresh;
      if (stale && typeof f.lag_commits === "number" && f.lag_commits >= STALE_LAG_COMMITS) {
        lines.push(`- ⚠️ **Graph cache is stale** — ${f.lag_commits} commits behind HEAD. Run \`graphify update .\` (or \`graphify hook install\` once for auto-refresh on commit). Numbers above may reflect old code.`);
      } else if (stale && f.built_at && f.head && f.lag_commits === null) {
        // Shallow clone: built_at != head but rev-list count unavailable.
        lines.push(`- ⚠️ **Graph cache may be stale** — built at ${f.built_at.slice(0,7)}, HEAD is ${f.head.slice(0,7)}. Run \`graphify update .\`.`);
      }
    } catch { /* freshness probe is advisory; never fail the Brief */ }
  }
  lines.push("");

  // Suggested Reading Set — paths derived from governing docs' affects_paths
  // and blast-radius direct_dependents. Consumed by workflows via the JSON
  // sidecar's `suggested_reading` field for <scope_hint> dispatch injection.
  if (Array.isArray(suggestedReading) && suggestedReading.length > 0) {
    lines.push("## Suggested Reading Set (auto-derived)");
    for (const p of suggestedReading) {
      lines.push(`- ${p}`);
    }
    lines.push("");
  }

  // Cross-Cutting Concerns — surfaces god-nodes / surprising-connections /
  // knowledge-gaps from graphify-out/GRAPH_REPORT.md that overlap the topic.
  // Omitted entirely when no overlap or when graphify hasn't produced a report.
  if (report && (report.god_nodes.length || report.surprising_connections.length || report.knowledge_gaps_summary)) {
    const topicTokens = new Set([
      ...topic.symbols.map(s => s.toLowerCase()),
      ...topic.domains.map(d => d.toLowerCase()),
    ]);
    const tokenMatches = (str) => {
      if (!str || !topicTokens.size) return false;
      const lower = str.toLowerCase();
      for (const t of topicTokens) {
        if (t.length >= 3 && lower.includes(t)) return true;
      }
      return false;
    };

    // B5 — when blast.god_node_match is true, the topic touched a god-node even
    // if the textual symbol comparison missed (e.g. CamelCase vs snake_case
    // tokenization differences). Surface the top god-node so the operational
    // guidance below (>=50 edges) fires. Field case: ClientService was a
    // god_node_match but tokenMatches() rejected it.
    let matchedGods = report.god_nodes.filter(g => tokenMatches(g.symbol)).slice(0, 5);
    if (matchedGods.length === 0 && blast && blast.god_node_match && report.god_nodes.length > 0) {
      matchedGods = report.god_nodes.slice(0, 1);
    }
    const matchedConns = report.surprising_connections
      .filter(c => tokenMatches(c.from) || tokenMatches(c.to))
      .slice(0, 5);

    if (matchedGods.length || matchedConns.length) {
      lines.push("## Cross-Cutting Concerns (graphify)");
      if (matchedGods.length) {
        lines.push("**God-nodes touching this topic (high coupling — scope changes carefully):**");
        for (const g of matchedGods) {
          // Operational guidance — distinguish raw edge count from behavior the
          // agent should adopt. Field audit (greenfield GF-543) showed agents
          // ignored bare edge counts but modified signatures of 100+ edge nodes
          // anyway. Reifying the implication makes the guidance load-bearing.
          const guidance = g.edge_count >= 50
            ? " — prefer adding new methods over modifying signatures; any signature change ripples to all callers"
            : "";
          lines.push(`- \`${g.symbol}\` — ${g.edge_count} edges${guidance}`);
        }
      }
      if (matchedConns.length) {
        if (matchedGods.length) lines.push("");
        lines.push("**Surprising connections involving this topic:**");
        for (const c of matchedConns) {
          lines.push(`- \`${c.from}\` --${c.relation}--> \`${c.to}\`  [${c.confidence}]`);
        }
      }
      lines.push("");
    }
  }

  lines.push("## Pre-Flight Recommendations");
  const recs = synthesizeRecommendations(governing, lanes.E, blast);
  if (recs.length === 0) {
    lines.push("- No specific guardrails detected; proceed with normal review discipline.");
  } else {
    for (const r of recs) lines.push(`- ${r}`);
  }
  lines.push("");

  lines.push("---");
  lines.push(`Generated ${generatedAt} by /devt:preflight`);
  lines.push("");
  return lines.join("\n");
}

function synthesizeRecommendations(governing, rejected, blast) {
  const recs = [];
  if (governing.length > 0) {
    const ids = governing.slice(0, 5).map(d => d.id).join(", ");
    recs.push(`Re-read ${ids} before any change — they constrain this topic area.`);
  }
  if (rejected.length > 0) {
    const ids = rejected.map(r => r.id).join(", ");
    recs.push(`${ids} govern: any solution involving the matched keywords is pre-rejected. Read these tombstones before proposing.`);
  }
  if (blast && blast.effect_size === "large") {
    recs.push("Effect size is LARGE — coordinate via /devt:plan, not /devt:fast. Plan thorough test coverage for the dependent set.");
  } else if (blast && blast.effect_size === "medium") {
    recs.push("Effect size is MEDIUM — STANDARD-tier review recommended; identify and test direct dependents.");
  }
  if (blast && blast.god_node_match) {
    recs.push("Subject matches a god-node entry — high coupling. Consider whether the change can be scoped narrower.");
  }
  if (blast && blast.ambiguous_bindings && blast.ambiguous_bindings > 0) {
    recs.push("Graphify reports AMBIGUOUS symbol bindings — manually verify the affected docs before edits.");
  }
  return recs;
}

// Tier detection for the Memory-Graph lane budget. Keywords classify first
// (explicit signal beats length); length-based bands are conservative fallbacks
// so most tasks land in "standard" unless they're clearly trivial or complex.
// `preflight.max_triples` in config overrides tier resolution entirely.
function detectTier(taskText) {
  if (!taskText || typeof taskText !== "string") return "standard";
  const t = taskText.toLowerCase();
  if (/\b(refactor|architecture|migration|cross-cutting|rewrite)\b/.test(t)) return "complex";
  if (/\b(small fix|tweak|adjust|patch|hotfix)\b/.test(t)) return "simple";
  if (/\b(typo|rename|one-line|trivial|whitespace)\b/.test(t)) return "trivial";
  if (taskText.length < 40) return "trivial";
  if (taskText.length >= 500) return "complex";
  return "standard";
}

function resolveTripleBudget(taskText, cfg, opts) {
  // Precedence: explicit CLI override → config max_triples → tier-based budget → 50
  if (opts && opts.budget != null) return opts.budget;
  const pre = cfg && cfg.preflight;
  if (pre && pre.max_triples != null) return pre.max_triples;
  const tier = detectTier(taskText);
  return (pre && pre.lane_budget && pre.lane_budget[tier]) || 50;
}

/**
 * Generate the Brief end-to-end and write it to .devt/state/preflight-brief.md.
 * Returns { brief_path, topic, counts, blast }.
 */
function generate(taskText, opts) {
  opts = opts || {};

  // Master switch — when memory.enabled=false, no Brief is generated.
  // Returns a disabled envelope so callers can branch cleanly without crashing.
  const cfg = getMergedConfig();
  if (!isMemoryEnabled(cfg)) {
    return {
      state: "disabled",
      reason: "memory.enabled=false in .devt/config.json",
      brief_path: null,
      topic: null,
      counts: { lane_a: 0, lane_b: 0, lane_c: 0, lane_d: 0, lane_e: 0, lane_f: 0, governing: 0, triples: 0 },
      blast: { effect_size: 0, source: null, god_node_match: false, ambiguous_bindings: 0 },
      generated_at: null,
    };
  }

  // Higher-signal source: declaration symbols pulled from changed files in
  // the working tree. Falls back to empty array when not in a git repo or
  // when nothing has changed — extractTopic still produces text-derived
  // symbols in that case.
  const diffSymbols = extractDiffSymbols();
  const topic = extractTopic(taskText, {
    gitDiffSymbols: diffSymbols,
    graphifyQuery: (text, qOpts) => graphify.queryGraph(text, qOpts),
  });

  // Run lanes
  const A = laneA(topic);
  const B = laneB(topic);
  const C = laneC(topic);
  const D = laneD(dedupSortById([...A, ...B, ...C]), opts.depth || 2);
  const E = laneE(topic);
  // Hoist the deduped union once: laneF filters it for lessons, renderBrief reuses
  // it for the governing docs section. Avoids two separate dedupSortById passes.
  const governingUnion = dedupSortById([...A, ...B, ...C, ...D]);
  const F = laneF(governingUnion);

  // Blast radius
  const blast = blastRadius(topic);

  // Parse GRAPH_REPORT.md once for surprising connections + knowledge gaps.
  // Empty sections when graphify is not ready or the report is missing —
  // the renderer omits the block.
  const report = graphify.parseReportSections();
  // Overlay live god-nodes from graph.json adjacency. Post-`graphify update`
  // rebuilds without `cluster-only` don't rewrite GRAPH_REPORT.md, so the
  // text-scraped god_nodes field can lag the actual graph; godNodes() reads
  // the live loader cache.
  const liveGods = graphify.godNodes(50);
  if (liveGods.length > 0) report.god_nodes = liveGods;

  // Memory Graph triples — depth-2 subgraph rooted at governing union.
  // Cheap to compute since getLinks already does the heavy lifting; the helper
  // just reshapes per-seed results into flat triples and dedupes across seeds.
  // Budget resolves from cfg.preflight (config) → tier heuristic over taskText
  // → default 50. Trivial tasks get a smaller subgraph; complex tasks get more.
  let triples = [];
  try {
    const budget = resolveTripleBudget(taskText, cfg, opts);
    triples = memory.getSubgraphTriples(governingUnion.map(d => d.id), opts.depth || 2, budget);
  } catch { /* memory layer not initialized — empty triples is the correct degradation */ }

  // Aggregate task-relevant code paths for the orchestrator's <scope_hint>
  // injection: governing docs' affects_paths (frontmatter-declared) plus
  // blast-radius direct_dependents (depth-1 incoming). Capped at
  // MAX_SUGGESTED_READING so the Brief stays scannable and the hint inflates
  // dispatch prefixes by at most a few hundred bytes.
  let affectsPaths = [];
  try {
    affectsPaths = memory.getAffectsPathsByIds(governingUnion.map(d => d.id));
  } catch { /* memory layer not initialized — empty list is correct */ }
  // B2 — when the topic central symbol is itself a god-node, blast.direct_dependents
  // is the god-node's general neighborhood (often 200+ entries unrelated to the task).
  // Suppressing direct_dependents avoids poisoning scope_hint with structurally
  // adjacent but task-irrelevant paths. Field case (greenfield 2026-05-26):
  // ClientService god-node match produced scope_hint filled with
  // OrganizationCreatedEvent etc. that had zero overlap with the actual task scope.
  const directDeps = blast.god_node_match
    ? []
    : (blast.direct_dependents || []).slice(0, MAX_DIRECT_DEPS);

  // Graphify wiki output (when the project ran `graphify <path> --wiki`) is the
  // agent-crawlable curated navigation surface. When present, prepend it to the
  // suggested reading so agents land on the wiki entry point before raw source.
  // Hidden behind existsSync — projects that never built a wiki see no change.
  const wikiPaths = [];
  try {
    const wikiIndex = path.join(findProjectRoot(), "graphify-out", "wiki", "index.md");
    if (fs.existsSync(wikiIndex)) wikiPaths.push("graphify-out/wiki/index.md");
  } catch { /* findProjectRoot may throw — skip */ }

  const suggestedReading = dedupeCap([...wikiPaths, ...affectsPaths, ...directDeps], resolveScopeHintCap());

  const lanes = { A, B, C, D, E, F };
  const generatedAt = new Date().toISOString();
  const brief = renderBrief({ task: taskText, topic, lanes, governing: governingUnion, triples, blast, report, generatedAt, suggestedReading });

  // Write atomically to .devt/state/preflight-brief.md
  const root = findProjectRoot();
  const stateDir = path.join(root, STATE_DIR);
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  const dest = path.join(stateDir, BRIEF_FILE);
  atomicWriteFileSync(dest, brief);

  // Emit JSON sidecar for deterministic orchestrator consumption. The .md is
  // the human-readable surface; .json is the machine interface workflows read
  // via jq for scope_hint injection without parsing markdown.
  const sidecarDest = path.join(stateDir, BRIEF_FILE.replace(/\.md$/, ".json"));
  // graph_stats + staleness give agents trust + freshness signals so they can
  // de-weight scope_hint / blast-radius when the underlying graph is sparse
  // (graphify not done indexing) or stale (built_at >> N commits behind HEAD).
  // Cheap — graph_stats reuses the Phase A loader cache; freshness reads ~8KB
  // of graph.json + 1 git call. Both surface state="not_ready" gracefully when
  // graphify is disabled or graph.json is absent.
  let graphStats, staleness;
  try { graphStats = graphify.graphStats(); }
  catch { graphStats = { state: "not_ready", trust: "empty" }; }
  try { staleness = graphify.freshness(); }
  catch { staleness = { state: "not_ready", fresh: false, built_at: null, head: null, lag_commits: null }; }

  let memoryIndexMissing = false;
  try {
    memoryIndexMissing = !fs.existsSync(path.join(findProjectRoot(), ".devt", "memory", "index.db"));
  } catch { memoryIndexMissing = false; }

  // Top-N god-nodes for downstream consumers. graphify.godNodes() may have been
  // called above when overlaying report.god_nodes; re-resolve here so the sidecar
  // surfaces structured data even when the markdown brief omits god-node prose
  // (e.g., topic doesn't textually match any god-node). Subagent dispatch
  // templates inject this list as operational guidance — "X is a god-node with
  // N edges; signature changes ripple to N sites". Cap at 3 — beyond that the
  // signal/noise ratio in agent prompts degrades.
  let topGods = [];
  try { topGods = (graphify.godNodes(3) || []).slice(0, 3); } catch { /* empty */ }

  atomicWriteJsonSync(sidecarDest, {
    status: "FRESH",
    topic,
    governing_ids: governingUnion.map(d => d.id),
    suggested_reading: suggestedReading,
    blast: {
      effect_size: blast.effect_size,
      source: blast.source,
      direct_dependents_count: (blast.direct_dependents || []).length,
    },
    graph_stats: graphStats,
    staleness,
    god_nodes: topGods,
    memory_index_missing: memoryIndexMissing,
    rej_keyword_matches: lanes.E.map(r => r.keyword).filter(Boolean),
    generated_at: generatedAt,
  });

  return {
    brief_path: dest,
    sidecar_path: sidecarDest,
    topic,
    counts: {
      lane_a: A.length, lane_b: B.length, lane_c: C.length,
      lane_d: D.length, lane_e: E.length, lane_f: F.length,
      governing: governingUnion.length,
      triples: triples.length,
      suggested_reading: suggestedReading.length,
    },
    blast: {
      effect_size: blast.effect_size,
      source: blast.source,
      god_node_match: !!blast.god_node_match,
      ambiguous_bindings: blast.ambiguous_bindings || 0,
    },
    generated_at: generatedAt,
  };
}

/**
 * Mark an existing brief STALE (typically when File Pre-Flight discovers
 * an unanchored file mid-task). Idempotent — no-op if no brief exists.
 */
function markStale(reason) {
  const root = findProjectRoot();
  const dest = path.join(root, STATE_DIR, BRIEF_FILE);
  if (!fs.existsSync(dest)) return { ok: false, reason: "no brief exists" };
  let body;
  try { body = fs.readFileSync(dest, "utf8"); } catch (e) { return { ok: false, reason: e.message }; }
  if (/^## Status:\s*STALE/m.test(body)) return { ok: true, already_stale: true };
  const updated = body.replace(/^## Status:\s*FRESH.*$/m, `## Status: STALE\n\n_Reason:_ ${reason || "scope expanded mid-task"}`);
  atomicWriteFileSync(dest, updated);
  return { ok: true, marked_stale_at: new Date().toISOString() };
}

/**
 * Read the current Brief metadata (status, generated_at). Returns null if absent.
 */
function readBriefMeta() {
  const root = findProjectRoot();
  const dest = path.join(root, STATE_DIR, BRIEF_FILE);
  if (!fs.existsSync(dest)) return null;
  let body;
  try { body = fs.readFileSync(dest, "utf8"); } catch { return null; }
  const status = (body.match(/^## Status:\s*(\w+)/m) || [, "MISSING"])[1];
  const generatedAt = (body.match(/Generated\s+([0-9T:.\-Z]+)/) || [, null])[1];
  const titleMatch = body.match(/^# Pre-Flight Brief:\s*(.+)$/m);
  return {
    path: dest,
    status,
    generated_at: generatedAt,
    task: titleMatch ? titleMatch[1] : null,
  };
}

// B1 — pick the central symbol from a topic.symbols list that best matches the
// task description text. Field rationale (greenfield 2026-05-26): the prior
// bash logic `jq -r '.[0]'` picked the alphabetically-first symbol regardless
// of task relevance (chose `AuditMapping` for a task about clients/relatives).
// Strategy: tokenize each symbol (CamelCase + snake_case + _underscores) into
// lowercase 3-char-plus tokens, score by what fraction appear in task text.
// Highest score wins; ties broken by original order; falls back to first symbol
// when no symbol scores above zero.
function pickCentralSymbol(symbols, taskText) {
  if (!Array.isArray(symbols) || symbols.length === 0) return null;
  const task = (taskText || "").toLowerCase();
  if (!task) return symbols[0];
  const tokenize = (sym) => sym
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 3);
  let best = { sym: symbols[0], score: 0, idx: -1 };
  symbols.forEach((sym, i) => {
    const tokens = tokenize(sym);
    if (tokens.length === 0) return;
    const hits = tokens.filter(t => task.includes(t)).length;
    const score = hits / tokens.length;
    if (score > best.score) best = { sym, score, idx: i };
  });
  return best.score > 0 ? best.sym : symbols[0];
}

function run(subcommand, args) {
  const json = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
  switch (subcommand) {
    case "generate": {
      const budgetArg = args.find(a => a.startsWith("--budget="));
      const task = args.filter(a => !a.startsWith("--")).join(" ").trim();
      if (!task) { process.stderr.write("Usage: preflight generate <task description> [--budget=N]\n"); return 2; }
      const opts = {};
      if (budgetArg) {
        const n = parseInt(budgetArg.split("=")[1], 10);
        if (Number.isFinite(n) && n > 0) opts.budget = n;
      }
      json(generate(task, opts));
      return 0;
    }
    case "topic": {
      const task = args.join(" ").trim();
      json(extractTopic(task));
      return 0;
    }
    case "status": {
      const meta = readBriefMeta();
      json(meta || { status: "MISSING" });
      return 0;
    }
    case "mark-stale": {
      const reason = args.join(" ").trim();
      json(markStale(reason));
      return 0;
    }
    case "pick-central-symbol": {
      // Usage: preflight pick-central-symbol <symbols-json> <task-text>
      if (args.length < 2) {
        process.stderr.write("Usage: preflight pick-central-symbol <symbols-json> <task-text>\n");
        return 2;
      }
      let symbols;
      try { symbols = JSON.parse(args[0]); }
      catch (e) { process.stderr.write(`Invalid symbols JSON: ${e.message}\n`); return 2; }
      const task = args.slice(1).join(" ");
      const picked = pickCentralSymbol(symbols, task);
      // Plain string output — easier for bash to consume than JSON
      process.stdout.write((picked || "") + "\n");
      return 0;
    }
    default:
      process.stderr.write(
        `Unknown preflight subcommand: ${subcommand}\n` +
        `Valid: generate | topic | status | mark-stale | pick-central-symbol\n`
      );
      return 2;
  }
}

module.exports = {
  run,
  generate,
  pickCentralSymbol,
  extractTopic,
  extractDiffSymbols,
  resolveScopeHintCap,
  SCOPE_HINT_CAP_BY_TIER,
  readBriefMeta,
  markStale,
  // Lanes exported for testing
  laneA, laneB, laneC, laneD, laneE, laneF,
  // Tier budget — exported for smoke-test gates and CLI override paths
  detectTier, resolveTripleBudget,
};
