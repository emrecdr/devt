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
const MAX_SUGGESTED_READING = 8;

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
]);

/**
 * Extract topic structure from a free-form task description.
 * Returns: { domains, symbols, keywords, raw }
 */
function extractTopic(taskText) {
  if (!taskText || typeof taskText !== "string") {
    return { domains: [], symbols: [], keywords: [], raw: "" };
  }
  const text = taskText.trim();

  // Symbols: PascalCase identifiers ≥3 chars, deduped, denylist-filtered
  const symbolMatches = text.match(/\b[A-Z][a-zA-Z0-9]{2,}\b/g) || [];
  const symbols = Array.from(new Set(symbolMatches))
    .filter(s => !SYMBOL_DENYLIST.has(s.toLowerCase()))
    .sort();

  // Lowercased word stream for domain + keyword extraction
  const words = (text.toLowerCase().match(/[a-z][a-z0-9_-]{1,30}/g) || []);
  const domains = Array.from(new Set(words.filter(w => DOMAIN_HINTS.includes(w)))).sort();

  // Keywords: words ≥3 chars, not stop-words, not domains, not symbols (lowered)
  const symbolLower = new Set(symbols.map(s => s.toLowerCase()));
  const domainSet = new Set(domains);
  const keywords = Array.from(new Set(
    words.filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !domainSet.has(w) && !symbolLower.has(w))
  )).sort();

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

    const matchedGods = report.god_nodes.filter(g => tokenMatches(g.symbol)).slice(0, 5);
    const matchedConns = report.surprising_connections
      .filter(c => tokenMatches(c.from) || tokenMatches(c.to))
      .slice(0, 5);

    if (matchedGods.length || matchedConns.length) {
      lines.push("## Cross-Cutting Concerns (graphify)");
      if (matchedGods.length) {
        lines.push("**God-nodes touching this topic (high coupling — scope changes carefully):**");
        for (const g of matchedGods) {
          lines.push(`- \`${g.symbol}\` — ${g.edge_count} edges`);
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

  const topic = extractTopic(taskText);

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

  // Parse GRAPH_REPORT.md once for cross-cutting concerns (god nodes,
  // surprising connections, knowledge gaps). Empty sections when graphify
  // is not ready or the report is missing — the renderer omits the block.
  const report = graphify.parseReportSections();

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
  const directDeps = (blast.direct_dependents || []).slice(0, MAX_DIRECT_DEPS);
  const suggestedReading = dedupeCap([...affectsPaths, ...directDeps], MAX_SUGGESTED_READING);

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
    default:
      process.stderr.write(
        `Unknown preflight subcommand: ${subcommand}\n` +
        `Valid: generate | topic | status | mark-stale\n`
      );
      return 2;
  }
}

module.exports = {
  run,
  generate,
  extractTopic,
  readBriefMeta,
  markStale,
  // Lanes exported for testing
  laneA, laneB, laneC, laneD, laneE, laneF,
  // Tier budget — exported for smoke-test gates and CLI override paths
  detectTier, resolveTripleBudget,
};
