"use strict";

/**
 * Graphify integration — reads graphify-out/graph.json directly.
 *
 * Graphify (https://github.com/safishamsi/graphify) is an optional code-graph
 * extractor. Project owners install it (`uv tool install graphifyy[mcp]` or
 * equivalent), run `graphify update .` to produce graphify-out/graph.json, and
 * devt then consumes that JSON artifact in-process. devt itself stays
 * Node-stdlib-only.
 *
 * Architecture note: devt does NOT shell out to graphify subcommands for
 * structured queries. graphify's CLI is text-output and its MCP tools return
 * text blobs (TextContent) — neither emits the structured shape devt's
 * consumers need. graph.json is the structured contract; devt parses it.
 *
 * Core invariant: the system is fully functional WITHOUT Graphify. Every
 * method returns a structured `{source, results, degraded?, error?}` payload
 * so callers can transparently fall back when graph.json is absent, disabled,
 * or malformed.
 *
 * Four fallback triggers (per the Graphify-First Skill Protocol):
 * 1. Graphify returns empty
 * 2. Graphify errors out
 * 3. Graphify is not setup (config disabled OR graph.json missing)
 * 4. Graphify returns too few results (< caller's min_results_threshold)
 */

const fs = require("fs");
const path = require("path");
const child_process = require("node:child_process");
const { safeJsonParse } = require("./security.cjs");

// ---------------------------------------------------------------------------
// Config + path discovery
// ---------------------------------------------------------------------------

function getConfig() {
  const { getMergedConfig } = require("./config.cjs");
  const cfg = getMergedConfig();
  return cfg.graphify || { enabled: false, command: "graphify" };
}

function findProjectRoot() {
  return require("./config.cjs").findProjectRoot();
}

function getGraphifyOutDir() {
  // Respect Graphify's own GRAPHIFY_OUT env var if set (per Graphify docs:
  // "useful for sharing one graph across multiple git worktrees")
  if (process.env.GRAPHIFY_OUT) {
    const v = process.env.GRAPHIFY_OUT;
    return path.isAbsolute(v) ? v : path.join(findProjectRoot(), v);
  }
  return path.join(findProjectRoot(), "graphify-out");
}

/**
 * Returns one of: "ready" | "disabled" | "graph_missing"
 * Ready when config enables graphify AND graphify-out/graph.json exists.
 * The graphify binary is needed only to *generate* the graph; devt's read
 * path does not invoke it, so binary presence does not gate "ready".
 */
function status(options = {}) {
  const cfg = getConfig();
  if (!cfg.enabled) return { state: "disabled", reason: "graphify.enabled is false in .devt/config.json" };

  const outDir = getGraphifyOutDir();
  const graphPath = path.join(outDir, "graph.json");
  if (!fs.existsSync(graphPath)) {
    return {
      state: "graph_missing",
      reason: `${graphPath} not found. Run: ${cfg.command || "graphify"} update . to extract`,
    };
  }
  // Cheap freshness call surfaces lag_commits without parsing graph.json.
  // _freshnessForPath reads built_at_commit via regex on file head/tail
  // (~8KB+16KB) — bounded cost even on 50MB+ graphs. Uses _freshnessForPath
  // (not freshness()) to avoid the recursion freshness→status→freshness
  // that would otherwise hang in spawnSync. Field-evidenced gap: status()
  // used to return only {state, out_dir, graph_path}, leaving operators to
  // derive freshness from preflight-brief.json which had the real data.
  // This unifies the source of truth.
  let lagCommits = null;
  let builtAt = null;
  try {
    const fr = _freshnessForPath(graphPath);
    if (fr && typeof fr.lag_commits === "number") lagCommits = fr.lag_commits;
    if (fr && typeof fr.built_at === "string") builtAt = fr.built_at;
  } catch { /* freshness probe failure non-fatal */ }

  const base = { state: "ready", out_dir: outDir, graph_path: graphPath, lag_commits: lagCommits, built_at_commit: builtAt };

  // --full opts into loadGraph() parse cost. On a 50MB+ graph this can take
  // 200-500ms — not free. Defaults to off so the common "is graphify ready?"
  // check stays O(1). With --full surfaces node_count + edge_count + trust
  // classification (sparse/dense per density threshold).
  if (!options.full) return base;

  try {
    const stats = graphStats();
    if (stats && stats.node_count !== undefined) {
      base.node_count = stats.node_count;
      base.edge_count = stats.edge_count;
      base.trust = stats.trust;
      if (stats.has_communities !== undefined) base.has_communities = stats.has_communities;
    }
  } catch (e) {
    base.full_probe_error = String(e && e.message);
  }
  return base;
}

/**
 * Read graph.json's `built_at_commit` and compare to current HEAD.
 * Returns { fresh: bool, built_at: string|null, head: string|null, lag_commits: number|null }.
 */
// Per-process memo for _freshnessForPath. Keyed on (graphPath, mtimeMs) so
// graph rebuild invalidates the cache automatically. Without this, F4's
// status()→freshness call spawns git rev-parse + git rev-list (up to 2x
// 10-30ms) on EVERY status() invocation. Workflows hit status() in
// context_init + scan-prep + several preflight checks — cumulative
// ~20-60ms per workflow run. Module-scope cache survives the workflow.
const _FRESHNESS_CACHE = new Map();

// Inner freshness probe given an already-resolved graph.json path. Extracted
// so status() can reuse it without recursing back through freshness()->status()
// (the recursion previously caused spawnSync timeouts after F4 added a
// freshness call to status()).
function _freshnessForPath(graphPath) {
  let mtimeKey = null;
  try {
    const stat = fs.statSync(graphPath);
    mtimeKey = `${graphPath}|${stat.mtimeMs}`;
    const cached = _FRESHNESS_CACHE.get(mtimeKey);
    if (cached) return cached;
  } catch { /* fall through to fresh compute; cache miss is non-fatal */ }
  const result = _computeFreshnessForPath(graphPath);
  if (mtimeKey) _FRESHNESS_CACHE.set(mtimeKey, result);
  return result;
}

function _computeFreshnessForPath(graphPath) {
  // graphify emits built_at_commit as a JSON trailer (end of file) in current
  // versions; older versions emitted it near the start. Scan both head (8KB)
  // and tail (16KB) — full parse on a 50MB+ graph would dominate freshness() cost.
  const BUILT_AT_RE = /"built_at_commit"\s*:\s*"([0-9a-fA-F]{4,64})"/;
  let builtAt = null;
  try {
    const stat = fs.statSync(graphPath);
    const fd = fs.openSync(graphPath, "r");
    const headLen = Math.min(8192, stat.size);
    const headBuf = Buffer.alloc(headLen);
    fs.readSync(fd, headBuf, 0, headLen, 0);
    let m = headBuf.toString("utf8", 0, headLen).match(BUILT_AT_RE);
    if (!m && stat.size > headLen) {
      const tailLen = Math.min(16384, stat.size - headLen);
      const tailBuf = Buffer.alloc(tailLen);
      fs.readSync(fd, tailBuf, 0, tailLen, stat.size - tailLen);
      m = tailBuf.toString("utf8", 0, tailLen).match(BUILT_AT_RE);
    }
    fs.closeSync(fd);
    if (m) builtAt = m[1];
  } catch {
    return { state: "ready", fresh: false, built_at: null, head: null, error: "graph.json unreadable" };
  }

  let head = null;
  try {
    const r = child_process.spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: findProjectRoot(),
      timeout: 2000,
      encoding: "utf8",
    });
    if (r.status === 0) head = r.stdout.trim();
  } catch { /* swallow — git may be missing */ }

  const fresh = !!(builtAt && head && builtAt === head);

  // Cal #33.B-1 — built_at_commit consistency defensive surface. Receipt #7
  // (field-observed): graph.json with built_at_commit: null
  // while lag_commits: 0 — internally inconsistent state where the
  // staleness gate trusts a freshness it can't verify against HEAD. Even if
  // the current freshness() math doesn't predict this combination (null
  // built_at → fresh=false → lag_commits=null), the receipt-evidenced
  // observation indicates either an upstream graphify regression OR a
  // stale-cache path that bypasses the math. Defensive surface: when
  // built_at is missing, return `unverifiable_freshness: true` so downstream
  // staleness gates can refuse to trust the freshness verdict OR emit a
  // banner. Distinct from `fresh: false` (which means "we verified it's not
  // fresh") — unverifiable_freshness means "we cannot verify EITHER WAY."
  if (!builtAt) {
    return {
      state: "ready",
      fresh: false,
      built_at: null,
      head,
      lag_commits: null,
      unverifiable_freshness: true,
      reason: "graph.json missing built_at_commit anchor — staleness cannot be verified against HEAD",
    };
  }

  // lag_commits stays null when count can't be computed (built_at/head missing,
  // shallow clone where built_at sha is unreachable, or git unavailable).
  let lagCommits = fresh ? 0 : null;
  if (builtAt && head && builtAt !== head) {
    try {
      const r = child_process.spawnSync(
        "git",
        ["rev-list", "--count", `${builtAt}..${head}`],
        { cwd: findProjectRoot(), timeout: 2000, encoding: "utf8" }
      );
      if (r.status === 0) {
        const n = parseInt(r.stdout.trim(), 10);
        if (Number.isFinite(n)) lagCommits = n;
      }
    } catch { /* swallow */ }
  }

  return { state: "ready", fresh, built_at: builtAt, head, lag_commits: lagCommits };
}

function freshness() {
  const s = _statusBare();
  if (s.state !== "ready") return { state: s.state, fresh: false, built_at: null, head: null };
  return _freshnessForPath(s.graph_path);
}

// Bare existence/state check without freshness probe — keeps status() and
// freshness() from recursing. Status() callers get the freshness-enriched
// output; this internal probe is just "is graphify ready?".
function _statusBare() {
  const cfg = getConfig();
  if (!cfg.enabled) return { state: "disabled", reason: "graphify.enabled is false in .devt/config.json" };
  const outDir = getGraphifyOutDir();
  const graphPath = path.join(outDir, "graph.json");
  if (!fs.existsSync(graphPath)) {
    return { state: "graph_missing", reason: `${graphPath} not found. Run: ${cfg.command || "graphify"} update . to extract` };
  }
  return { state: "ready", out_dir: outDir, graph_path: graphPath };
}

// ---------------------------------------------------------------------------
// Warm-cache + report discovery
// ---------------------------------------------------------------------------

/**
 * Returns the path of the preferred warm-cache file (wiki/index.md when present,
 * else GRAPH_REPORT.md, else null). Per Graphify's own AGENTS.md guidance:
 * "If graphify-out/wiki/index.md exists, navigate it instead of reading raw files."
 */
function warmCachePath() {
  const outDir = getGraphifyOutDir();
  const wikiIndex = path.join(outDir, "wiki", "index.md");
  if (fs.existsSync(wikiIndex)) return wikiIndex;
  const report = path.join(outDir, "GRAPH_REPORT.md");
  if (fs.existsSync(report)) return report;
  // Some installs put GRAPH_REPORT.md at project root via `graphify install`
  const rootReport = path.join(findProjectRoot(), "GRAPH_REPORT.md");
  if (fs.existsSync(rootReport)) return rootReport;
  return null;
}

// ---------------------------------------------------------------------------
// graph.json loader — memoized by (path, mtime). One read per workflow turn.
// ---------------------------------------------------------------------------

const GRAPH_SIZE_CAP = 100 * 1024 * 1024;

let _graphCache = null;

function _degraded(reason, state, trigger) {
  return {
    source: "grep",
    results: [],
    degraded: true,
    reason: reason || "graphify not ready",
    state: state || "unknown",
    fallback_trigger: trigger || "not_setup",
  };
}

// One forensic record per process invocation per oversize graph.json. Without
// this dedupe a single workflow that calls multiple graphify wrappers would
// fan out N identical records into the JSONL log.
const _loggedSizeCap = new Set();

function _logGraphSizeCap(graphPath, size) {
  if (_loggedSizeCap.has(graphPath)) return;
  _loggedSizeCap.add(graphPath);
  try {
    const { appendJsonl } = require("./logger.cjs");
    const logPath = path.join(findProjectRoot(), ".devt", "state", "preflight-denies.jsonl");
    appendJsonl(logPath, {
      source: "graph_loader",
      ts: new Date().toISOString(),
      reason: "graph.json exceeds GRAPH_SIZE_CAP",
      path: graphPath,
      size,
      cap: GRAPH_SIZE_CAP,
    });
  } catch { /* logger missing or .devt/state/ uncreatable — degrade silently */ }
}

function loadGraph() {
  const s = status();
  if (s.state !== "ready") return { ok: false, degraded: _degraded(s.reason, s.state, "not_setup") };

  let stat;
  try { stat = fs.statSync(s.graph_path); }
  catch (e) { return { ok: false, degraded: _degraded(`stat failed: ${e.message}`, s.state, "error") }; }

  if (_graphCache && _graphCache.path === s.graph_path && _graphCache.mtimeMs === stat.mtimeMs) {
    return { ok: true, cache: _graphCache };
  }

  // Stat the file before reading so monorepo graphs over the 100MB cap fail
  // fast with a forensic trail instead of degrading silently. Without this,
  // affected projects see blast_radius=small and effect_size=null for every
  // call and have no signal that the graph is too big to consume.
  if (stat.size > GRAPH_SIZE_CAP) {
    _logGraphSizeCap(s.graph_path, stat.size);
    return { ok: false, degraded: _degraded(`graph.json exceeds ${GRAPH_SIZE_CAP} byte cap (size: ${stat.size})`, s.state, "error") };
  }

  let raw;
  try { raw = fs.readFileSync(s.graph_path, "utf8"); }
  catch (e) { return { ok: false, degraded: _degraded(`read failed: ${e.message}`, s.state, "error") }; }

  const parsed = safeJsonParse(raw, "graphify graph.json", GRAPH_SIZE_CAP);
  if (!parsed.ok) {
    return { ok: false, degraded: _degraded(`parse failed: ${parsed.error}`, s.state, "error") };
  }
  const graph = parsed.value;
  // NetworkX writes via node_link_data(G, edges="links") in modern versions
  // and via the legacy "edges" key in older versions. We accept either.
  const links = Array.isArray(graph.links) ? graph.links
              : (Array.isArray(graph.edges) ? graph.edges : []);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];

  const adj = _buildAdjacency(nodes, links);
  _graphCache = { path: s.graph_path, mtimeMs: stat.mtimeMs, graph, nodes, links, adj };
  return { ok: true, cache: _graphCache };
}

function _buildAdjacency(nodes, links) {
  const out = new Map();      // nodeId -> [edge]
  const inc = new Map();      // nodeId -> [edge]
  const nodeMap = new Map();  // nodeId -> nodeData
  for (const n of nodes) {
    if (!n || typeof n.id !== "string") continue;
    nodeMap.set(n.id, n);
    out.set(n.id, []);
    inc.set(n.id, []);
  }
  for (const l of links) {
    if (!l || typeof l.source !== "string" || typeof l.target !== "string") continue;
    const edge = {
      source: l.source,
      target: l.target,
      relation: l.relation || "",
      confidence: l.confidence || "",
      weight: typeof l.weight === "number" ? l.weight : 1,
    };
    if (out.has(l.source)) out.get(l.source).push(edge);
    if (inc.has(l.target)) inc.get(l.target).push(edge);
  }
  return { out, inc, nodeMap };
}

/**
 * Resolve a free-text query to a node id. Precedence: exact id, exact label
 * (case-insensitive), label substring, id substring. Returns null on no match.
 */
function _resolveOne(adj, query) {
  if (!query) return null;
  const q = String(query).toLowerCase();
  if (adj.nodeMap.has(query)) return query;
  for (const [id, node] of adj.nodeMap) {
    if (typeof node.label === "string" && node.label.toLowerCase() === q) return id;
  }
  for (const [id, node] of adj.nodeMap) {
    if (typeof node.label === "string" && node.label.toLowerCase().includes(q)) return id;
  }
  for (const id of adj.nodeMap.keys()) {
    if (id.toLowerCase().includes(q)) return id;
  }
  return null;
}

/** Return all node ids whose label or id contains query (case-insensitive). */
function _resolveMany(adj, query, limit = 20) {
  if (!query) return [];
  const q = String(query).toLowerCase();
  const hits = new Set();
  // Exact label/id first so the top result is the most specific match.
  if (adj.nodeMap.has(query)) hits.add(query);
  for (const [id, node] of adj.nodeMap) {
    if (typeof node.label === "string" && node.label.toLowerCase() === q) hits.add(id);
    if (hits.size >= limit) break;
  }
  for (const [id, node] of adj.nodeMap) {
    if (hits.size >= limit) break;
    if (typeof node.label === "string" && node.label.toLowerCase().includes(q)) hits.add(id);
  }
  for (const id of adj.nodeMap.keys()) {
    if (hits.size >= limit) break;
    if (id.toLowerCase().includes(q)) hits.add(id);
  }
  return Array.from(hits);
}

// Token fallback for multi-word queries. `_resolveMany` substring-matches the
// WHOLE query string, so a phrase like "orchestration service TokenProvider"
// matches no single node label and returns empty — forcing a silent grep
// degrade. This splits the query into tokens and resolves in two passes:
//   1. token-AND — nodes whose label/id contains EVERY token (precise).
//   2. token-OR  — if AND is empty, nodes matching ANY token, ranked by
//      token-match-count then degree (graceful: never empty when any token
//      hits). OR-ranked degradation beats an empty result for review scoping.
// Returns { ids, mode } where mode is "token_and" | "token_or" | null.
function _tokenizeQuery(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9_]+/i).filter(t => t.length >= 2);
}
function _resolveManyTokens(adj, text, limit = 20) {
  const tokens = _tokenizeQuery(text);
  if (tokens.length < 2) return { ids: [], mode: null };
  const _deg = (id) => (adj.inc.get(id) || []).length + (adj.out.get(id) || []).length;
  const scoreById = new Map();
  for (const [id, node] of adj.nodeMap) {
    const hay = ((typeof node.label === "string" ? node.label : "") + " " + id).toLowerCase();
    let matched = 0;
    for (const t of tokens) { if (hay.includes(t)) matched++; }
    if (matched > 0) scoreById.set(id, matched);
  }
  if (scoreById.size === 0) return { ids: [], mode: null };
  const andIds = Array.from(scoreById.entries())
    .filter(([, n]) => n === tokens.length)
    .map(([id]) => id);
  if (andIds.length > 0) {
    andIds.sort((a, b) => _deg(b) - _deg(a));
    return { ids: andIds.slice(0, limit), mode: "token_and" };
  }
  const orIds = Array.from(scoreById.entries())
    .sort((a, b) => (b[1] - a[1]) || (_deg(b[0]) - _deg(a[0])))
    .map(([id]) => id);
  return { ids: orIds.slice(0, limit), mode: "token_or" };
}

/**
 * BFS from `fromId` along `direction` ("in" | "out" | "both") up to `depth`.
 * Returns { visited: Map<id, {depth, edge}>, order: [id...] } where `edge` is
 * the edge that first reached this node (null for the seed).
 */
function _bfs(adj, fromId, direction, depth) {
  const visited = new Map();
  if (!adj.nodeMap.has(fromId)) return { visited, order: [] };
  visited.set(fromId, { depth: 0, edge: null });
  const order = [fromId];
  const queue = [[fromId, 0]];
  while (queue.length > 0) {
    const [cur, d] = queue.shift();
    if (d >= depth) continue;
    const edges = [];
    if (direction === "out" || direction === "both") edges.push(...(adj.out.get(cur) || []).map(e => ({ ...e, _next: e.target })));
    if (direction === "in" || direction === "both") edges.push(...(adj.inc.get(cur) || []).map(e => ({ ...e, _next: e.source })));
    for (const e of edges) {
      if (visited.has(e._next)) continue;
      visited.set(e._next, { depth: d + 1, edge: e });
      order.push(e._next);
      queue.push([e._next, d + 1]);
    }
  }
  return { visited, order };
}

// ---------------------------------------------------------------------------
// GRAPH_REPORT.md section parser (no graphify shellout — file-based)
// ---------------------------------------------------------------------------

/**
 * Parse the three actionable sections out of graphify-out/GRAPH_REPORT.md.
 *
 * Returns { god_nodes, surprising_connections, knowledge_gaps_summary } where:
 *   god_nodes: [{symbol, edge_count}] from "## God Nodes (...)" — top-N concepts by degree
 *   surprising_connections: [{from, to, relation, confidence}] from "## Surprising Connections (...)"
 *   knowledge_gaps_summary: first non-empty body line of "## Knowledge Gaps", or null
 *
 * Empty arrays when the report is missing, graphify is not ready, or the section
 * fails to parse. Capped at 4 MB to bound memory.
 *
 * Section regexes are anchored on the prefix only (graphify suffixes the headers
 * with descriptive parens, e.g. "## God Nodes (most connected - your core abstractions)").
 */
function parseReportSections(reportPath) {
  const empty = { god_nodes: [], surprising_connections: [], knowledge_gaps_summary: null };
  let resolvedPath = reportPath;
  if (!resolvedPath) {
    const s = status();
    if (s.state !== "ready") return empty;
    resolvedPath = path.join(s.out_dir, "GRAPH_REPORT.md");
  }
  let stat;
  try { stat = fs.statSync(resolvedPath); } catch { return empty; }
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return empty;

  let body;
  try {
    body = fs.readFileSync(resolvedPath, "utf8");
  } catch { return empty; }

  const sliceSection = (title) => {
    const lines = body.split("\n");
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("## " + title)) { start = i + 1; break; }
    }
    if (start < 0) return "";
    let end = lines.length;
    for (let i = start; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { end = i; break; }
    }
    return lines.slice(start, end).join("\n");
  };

  const god = empty.god_nodes;
  const godBody = sliceSection("God Nodes");
  for (const line of godBody.split("\n")) {
    const m = line.match(/^\s*\d+\.\s+`([^`]+)`\s+-\s+(\d+)\s+edges?\b/);
    if (m && god.length < 50) god.push({ symbol: m[1], edge_count: Number(m[2]) });
  }

  const sc = empty.surprising_connections;
  const scBody = sliceSection("Surprising Connections");
  for (const line of scBody.split("\n")) {
    const m = line.match(/^\s*-\s+`([^`]+)`\s+--([^-]+?)-->\s+`([^`]+)`\s*\[([A-Z]+)\]/);
    if (m && sc.length < 50) {
      sc.push({ from: m[1], to: m[3], relation: m[2].trim(), confidence: m[4] });
    }
  }

  const gapBody = sliceSection("Knowledge Gaps");
  let gapSummary = null;
  for (const line of gapBody.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) { gapSummary = trimmed.replace(/^[-*]\s*/, "").slice(0, 300); break; }
  }

  return { god_nodes: god, surprising_connections: sc, knowledge_gaps_summary: gapSummary };
}

// ---------------------------------------------------------------------------
// Structured query API — pure Node, reads graph.json directly
// ---------------------------------------------------------------------------

/**
 * Search for concepts/symbols by label/id. Returns up to `limit` matches.
 */
function queryGraph(text, options) {
  options = options || {};
  const loaded = loadGraph();
  if (!loaded.ok) return loaded.degraded;

  const limit = options.limit || 20;
  let ids = _resolveMany(loaded.cache.adj, text, limit);
  let resolutionMode = null;
  if (ids.length === 0) {
    // Whole-query match empty → token fallback (AND, then OR-ranked) so
    // multi-word queries degrade gracefully instead of silently grep-falling.
    const tok = _resolveManyTokens(loaded.cache.adj, text, limit);
    ids = tok.ids;
    resolutionMode = tok.mode;
  }
  if (ids.length === 0) {
    return { source: "grep", results: [], degraded: true, reason: "no matching nodes (whole-query + token-AND + token-OR all empty)", fallback_trigger: "empty" };
  }

  const results = ids.map(id => {
    const node = loaded.cache.adj.nodeMap.get(id);
    return {
      id,
      label: node.label || id,
      source_file: node.source_file || "",
      file_type: node.file_type || "",
      confidence_score: typeof node.confidence_score === "number" ? node.confidence_score : null,
      in_degree: (loaded.cache.adj.inc.get(id) || []).length,
      out_degree: (loaded.cache.adj.out.get(id) || []).length,
    };
  });
  const out = { source: "graphify", results };
  // Telemetry: surface WHICH resolution pass produced results so a reviewer
  // can see the query was an exact-substring hit vs a token fallback (and how
  // loose) — per the telemetry-on-reduction principle.
  if (resolutionMode) out.resolution_mode = resolutionMode;
  return out;
}

/**
 * Fetch a single node's details. Mirrors upstream `get_node` MCP tool but
 * with structured output instead of formatted text.
 */
function getNode(nodeId, _options) {
  const loaded = loadGraph();
  if (!loaded.ok) return loaded.degraded;

  const id = _resolveOne(loaded.cache.adj, nodeId);
  if (!id) {
    return { source: "grep", results: [], degraded: true, reason: `no node matching "${nodeId}"`, fallback_trigger: "empty" };
  }
  const node = loaded.cache.adj.nodeMap.get(id);
  return {
    source: "graphify",
    results: [{
      id,
      label: node.label || id,
      source_file: node.source_file || "",
      source_location: node.source_location || null,
      file_type: node.file_type || "",
      confidence_score: typeof node.confidence_score === "number" ? node.confidence_score : null,
      in_degree: (loaded.cache.adj.inc.get(id) || []).length,
      out_degree: (loaded.cache.adj.out.get(id) || []).length,
      degree: (loaded.cache.adj.inc.get(id) || []).length + (loaded.cache.adj.out.get(id) || []).length,
    }],
  };
}

/**
 * Walk neighbors of a symbol with direction + depth control.
 * direction: "in" (callers) | "out" (dependents) | "both" (default)
 * depth: 1 (default) | 2 | ...
 */
function getNeighbors(symbol, options) {
  options = options || {};
  const direction = ["in", "out", "both"].includes(options.direction) ? options.direction : "both";
  const depth = Number.isInteger(options.depth) && options.depth > 0 ? options.depth : 1;

  const loaded = loadGraph();
  if (!loaded.ok) return loaded.degraded;

  const fromId = _resolveOne(loaded.cache.adj, symbol);
  if (!fromId) {
    return { source: "grep", results: [], degraded: true, reason: `symbol not found: "${symbol}"`, fallback_trigger: "empty" };
  }

  const { visited } = _bfs(loaded.cache.adj, fromId, direction, depth);
  visited.delete(fromId);

  // God-nodes can return tens of thousands of incoming neighbors at depth=2
  // (observed: a single high-degree symbol overflowing the MCP transport
  // limit and yielding zero signal on the most-important symbol). The
  // `max_bytes` option caps the serialized size at a target; sorting by
  // depth-ascending then label-alphabetical keeps the truncation
  // deterministic and prefers the closest neighbors (most relevant for
  // impact analysis). When truncation fires, the response carries
  // `truncated: true` + counts so consumers can flag the partial result
  // instead of trusting it as complete.
  // Compose noise filters. Without these, getNeighbors caller-set drill-downs
  // surface primitives, docstrings, file/concept/json-key nodes, and test code
  // as legitimate neighbors. Field-evidenced gap (cal #30.0 D1 was blastRadius-
  // only): AuthenticationService incoming ~95% test methods + rationale_for
  // docstrings, burying the production-caller signal.
  const extraNoise = _getExtraNoiseSet();
  const frameworkBuiltins = _getFrameworkBuiltinSet();
  const testPathPatterns = _getTestPathPatterns();

  // G1 (cal #31.B) — DI-aggregation collapse. Receipt #5 Q3: a field project's
  // `licences/dependencies.py` "imports everything" pattern produced a fan of
  // 100+ result nodes all sharing one source_file via `imports`/`uses` edges,
  // overwhelming legitimate call-graph signal. Detection is structural (per-
  // source-file occurrence count + basename matches DI-pattern), NOT a pure
  // node predicate — `factory.py` is often legitimate so basename-only is too
  // aggressive. Threshold-gated: only collapses when >threshold nodes share
  // a DI-pattern file (otherwise small DI wiring stays visible).
  const DI_AGGREGATION_BASENAMES = _getDIAggregationPatterns();
  const COLLAPSE_THRESHOLD = _getDIAggregationCollapseThreshold();
  const sourceFileCounts = new Map();
  for (const [id] of visited) {
    const node = loaded.cache.adj.nodeMap.get(id);
    const src = (node && node.source_file) || "";
    if (src) sourceFileCounts.set(src, (sourceFileCounts.get(src) || 0) + 1);
  }

  const items = [];
  const seenDIAggregator = new Set(); // source_file paths where the representative has been emitted
  let filteredNoiseCount = 0;
  let filteredTestPathCount = 0;
  let filteredDIAggregationCount = 0;
  // Transparency: same reason-coded dropped-sample surface as blast_radius, so a
  // drill-down that filters a real caller is auditable, not a black box.
  const droppedSample = [];
  const droppedSeen = new Set();
  const droppedByFile = new Map();
  const droppedAll = [];
  const DROPPED_SAMPLE_CAP = 15;
  const recordDrop = (label, reason, srcFile, dep) => {
    droppedAll.push({ label, reason, source_file: srcFile || "", depth: dep });
    if (!droppedSeen.has(label) && droppedSample.length < DROPPED_SAMPLE_CAP) {
      droppedSeen.add(label);
      droppedSample.push({ label, reason, source_file: srcFile || "", depth: dep });
    }
    const key = srcFile || "(no source_file)";
    let agg = droppedByFile.get(key);
    if (!agg) { agg = { source_file: key, count: 0, reasons: {}, sample: [] }; droppedByFile.set(key, agg); }
    agg.count++;
    agg.reasons[reason] = (agg.reasons[reason] || 0) + 1;
    if (agg.sample.length < 3) agg.sample.push(label);
  };
  for (const [id, info] of visited) {
    const node = loaded.cache.adj.nodeMap.get(id);
    const label = node.label || id;
    if (_isBlastNoise(node, label, extraNoise, frameworkBuiltins)) { filteredNoiseCount++; recordDrop(label, _noiseSubReason(label), node && node.source_file, info.depth); continue; }
    if (_isTestPathNode(node, testPathPatterns)) { filteredTestPathCount++; recordDrop(label, "test_path", node && node.source_file, info.depth); continue; }

    // DI-aggregation collapse: when many nodes share one DI-pattern source_file,
    // keep one representative + count the rest as collapsed. Marker field
    // `di_aggregation_collapsed_count` tells consumers how many siblings were
    // suppressed so they can drill down if needed.
    const src = (node && node.source_file) || "";
    if (src && DI_AGGREGATION_BASENAMES.test(src) && (sourceFileCounts.get(src) || 0) > COLLAPSE_THRESHOLD) {
      if (seenDIAggregator.has(src)) { filteredDIAggregationCount++; recordDrop(label, "di_aggregation", src, info.depth); continue; }
      seenDIAggregator.add(src);
      items.push({
        id,
        label,
        source_file: src,
        relation: info.edge ? info.edge.relation : "",
        confidence: info.edge ? info.edge.confidence : "",
        depth: info.depth,
        di_aggregation_collapsed_count: (sourceFileCounts.get(src) || 1) - 1,
      });
      continue;
    }

    items.push({
      id,
      label,
      source_file: node.source_file || "",
      relation: info.edge ? info.edge.relation : "",
      confidence: info.edge ? info.edge.confidence : "",
      depth: info.depth,
    });
  }
  // Confidence-aware ordering + INFERRED cap. INFERRED edges are low-confidence
  // co-location links (upstream graphify emits same-file symbol adjacency as
  // `uses` edges); field-observed a 247-neighbor result split 228 INFERRED / 19
  // EXTRACTED, the INFERRED bulk drowning the trustworthy structural edges. Rank
  // every non-INFERRED neighbor (EXTRACTED / AMBIGUOUS / unknown) ahead of
  // INFERRED — the reliable set is never capped — then trim the INFERRED tail so
  // co-location noise can't dominate. Graphs without confidence data land
  // everything in the reliable bucket → depth+alpha ordering, unchanged.
  const byDepthAlpha = (a, b) => a.depth - b.depth || (a.label || "").localeCompare(b.label || "");
  const reliableItems = items.filter(it => it.confidence !== "INFERRED").sort(byDepthAlpha);
  const inferredItems = items.filter(it => it.confidence === "INFERRED").sort(byDepthAlpha);
  const inferredCap = _getInferredNeighborCap();
  const inferredKept = inferredCap === null ? inferredItems : inferredItems.slice(0, inferredCap);
  const inferredCappedCount = inferredItems.length - inferredKept.length;
  const rankedItems = reliableItems.concat(inferredKept);
  // Filter + confidence telemetry exposed in envelope so callers can audit how
  // aggressive the reduction was, per [[telemetry-on-reduction]]. Surfaces both
  // the retained EXTRACTED count and the total/capped INFERRED counts so the
  // split is visible, not silent. Null when nothing filtered and no confidence data.
  const extractedCount = reliableItems.filter(it => it.confidence === "EXTRACTED").length;
  const confidenceTelemetry = (inferredItems.length || extractedCount) ? {
    confidence_extracted: extractedCount,
    confidence_inferred_total: inferredItems.length,
    confidence_inferred_capped: inferredCappedCount,
  } : null;
  const filterTelemetry = (filteredNoiseCount || filteredTestPathCount || filteredDIAggregationCount || confidenceTelemetry) ? {
    ...((filteredNoiseCount || filteredTestPathCount || filteredDIAggregationCount) ? {
      filtered_noise: filteredNoiseCount,
      filtered_test_path: filteredTestPathCount,
      filtered_di_aggregation: filteredDIAggregationCount,
    } : {}),
    ...(confidenceTelemetry || {}),
  } : null;
  // Carry the reason-coded dropped sample on the same envelope as the filter
  // counts, so every return path (plain / truncated / capped) surfaces it.
  if (filterTelemetry && droppedSample.length > 0) filterTelemetry.dropped_sample = droppedSample;
  // When filtering leaves NOTHING, the drops ARE the answer — aggregate them
  // per source file so the consumer sees the real caller set at a glance
  // (field receipt: every DI/router caller was classified noise and the
  // reviewer had to mine dropped_sample by hand to write the drill-down).
  if (filterTelemetry && rankedItems.length === 0 && droppedByFile.size > 0) {
    filterTelemetry.dropped_by_file = Array.from(droppedByFile.values())
      .sort((a, b) => b.count - a.count).slice(0, 10);
  }
  // Auto-promote on empty results (node-kind-gated). Identifier-shaped drops
  // in the plain consumer bucket ARE the caller set (field-measured: 11 of 17
  // drops were real callables; docstring/container nodes stay down — a
  // reviewer pattern-matching "callers" must never cite a prose node).
  // Promotion is marked + confidence-demoted and fires ONLY on empty results,
  // so healthy responses never grow.
  let promotedItems = [];
  if (rankedItems.length === 0 && droppedAll.length > 0) {
    const seenPromo = new Set();
    const idShaped = (l) => /^[A-Za-z_$][\w.$]*(\(\))?$/.test(String(l || ""));
    for (const d of droppedAll) {
      if (d.reason !== "noise" || !idShaped(d.label) || seenPromo.has(d.label)) continue;
      seenPromo.add(d.label);
      promotedItems.push({ label: d.label, source_file: d.source_file, relation: "", confidence: "RECOVERED", depth: d.depth, recovered_from_noise: true });
      if (promotedItems.length >= 25) break;
    }
    if (filterTelemetry && promotedItems.length > 0) filterTelemetry.recovered_from_noise_count = promotedItems.length;
  }
  const finalItems = rankedItems.length > 0 ? rankedItems : promotedItems;
  const maxBytes = Number.isInteger(options.max_bytes) && options.max_bytes > 0 ? options.max_bytes : null;
  if (!maxBytes) {
    const base = { source: "graphify", results: finalItems };
    if (filterTelemetry) Object.assign(base, filterTelemetry);
    return base;
  }
  const totalCount = finalItems.length;
  const results = [];
  let runningBytes = 0;
  // Approximate per-item byte cost via JSON.stringify of the item; cheap
  // enough at this granularity (god-node payloads are 10K-50K items).
  for (const item of finalItems) {
    const itemBytes = JSON.stringify(item).length + 1; // +1 for separator comma
    if (runningBytes + itemBytes > maxBytes) break;
    results.push(item);
    runningBytes += itemBytes;
  }
  if (results.length < totalCount) {
    const base = {
      source: "graphify",
      results,
      truncated: true,
      truncated_at: results.length,
      total_neighbors: totalCount,
      max_bytes: maxBytes,
      truncation_reason: `${totalCount - results.length} neighbor(s) dropped to fit max_bytes=${maxBytes}; results sorted depth-asc + label-alpha so closest neighbors retained`,
    };
    if (filterTelemetry) Object.assign(base, filterTelemetry);
    return base;
  }
  const ok = { source: "graphify", results };
  if (filterTelemetry) Object.assign(ok, filterTelemetry);
  return ok;
}

/**
 * Shortest directed path from source label to target label.
 * Returns the sequence of edges (hops). Empty results when no path exists.
 */
function shortestPath(from, to, options) {
  options = options || {};
  const maxHops = Number.isInteger(options.max_hops) && options.max_hops > 0 ? options.max_hops : 8;

  const loaded = loadGraph();
  if (!loaded.ok) return loaded.degraded;

  const fromId = _resolveOne(loaded.cache.adj, from);
  const toId = _resolveOne(loaded.cache.adj, to);
  if (!fromId || !toId) {
    return { source: "grep", results: [], degraded: true, reason: "source or target not found", fallback_trigger: "empty" };
  }

  // BFS along outgoing edges only — preserves directed semantics
  const prev = new Map();
  prev.set(fromId, null);
  const queue = [[fromId, 0]];
  let found = false;
  while (queue.length > 0) {
    const [cur, d] = queue.shift();
    if (cur === toId) { found = true; break; }
    if (d >= maxHops) continue;
    for (const e of (loaded.cache.adj.out.get(cur) || [])) {
      if (prev.has(e.target)) continue;
      prev.set(e.target, e);
      queue.push([e.target, d + 1]);
    }
  }
  if (!found) {
    return { source: "graphify", results: [], reason: `no path within ${maxHops} hops` };
  }
  const hops = [];
  let cursor = toId;
  while (cursor !== fromId) {
    const e = prev.get(cursor);
    if (!e) break;
    hops.unshift({ source: e.source, target: e.target, relation: e.relation, confidence: e.confidence });
    cursor = e.source;
  }
  return { source: "graphify", results: hops };
}

/**
 * Compute blast radius for a set of subject symbols. Returns:
 * { effect_size: 'small' | 'medium' | 'large' | null,
 *   direct_dependents: [...],      // depth-1 incoming labels/ids
 *   indirect_dependents: [...],    // depth-2 incoming (excluding direct)
 *   modules_touched: number,
 *   god_node_match: boolean,
 *   ambiguous_bindings: number,
 *   ambiguous_details: [{symbol, node}],
 *   source: 'graphify' | 'grep',
 *   degraded?, reason? }
 *
 * Used by preflight to populate the JSON sidecar's suggested_reading field.
 */
// Sub-reason taxonomy for noise drops. A uniform "noise" label made
// promote-except rules unimplementable (field receipt: 17 drops, all
// "noise", ~40% docstring/container junk among the real callers).
function _noiseSubReason(label) {
  const l = String(label || "");
  if (/\s/.test(l) && (/[.!?]$/.test(l) || l.length > 40)) return "noise_docstring";
  if (/\.[a-z]{1,4}$/i.test(l) && !/\s/.test(l)) return "noise_container";
  return "noise";
}

function blastRadius(symbols, options) {
  const loaded = loadGraph();
  if (!loaded.ok) {
    return {
      effect_size: null,
      direct_dependents: [],
      indirect_dependents: [],
      modules_touched: 0,
      god_node_match: false,
      ambiguous_bindings: 0,
      ambiguous_details: [],
      source: "grep",
      degraded: true,
      reason: loaded.degraded.reason,
    };
  }
  const adj = loaded.cache.adj;
  // direct maps label → the BFS-visited node id. Carrying the real id (instead
  // of re-resolving the label later) is what keeps degree data coherent: label
  // re-resolution via _resolveOne returns the FIRST homonym, which can be an
  // edgeless namesake in another module — the source of the field-observed
  // "direct dependent with edge_count:0" contradiction.
  const direct = new Map();
  const indirect = new Set();
  const modules = new Set();
  const ambiguous = [];
  const extraNoise = _getExtraNoiseSet();
  const frameworkBuiltins = _getFrameworkBuiltinSet();
  // Cal #34 #5b — telemetry-on-reduction per [[telemetry-on-reduction]]
  // standing principle: every filter / collapser tracks its own count + the
  // raw (pre-filter) totals so reviewers can audit how aggressive each
  // reduction was. Mirrors getNeighbors' filter-telemetry pattern.
  const testPathPatterns = _getTestPathPatterns();
  const DI_AGGREGATION_BASENAMES = _getDIAggregationPatterns();
  const COLLAPSE_THRESHOLD = _getDIAggregationCollapseThreshold();
  let rawDirectCount = 0;
  let rawIndirectCount = 0;
  let filteredNoiseCount = 0;
  let filteredTestPathCount = 0;
  let filteredDIAggregationCount = 0;
  // Q5a (cal #39.A) — accumulate the source_files of ALL incoming callers
  // (depth 1+2) across the seed symbols. When direct_dependents ends up empty
  // BUT DI-aggregation collapsed callers (the FastAPI Depends()-factory case),
  // an empty set silently reads as "no callers" for the highest-value symbol.
  // Surfacing the top-K caller files turns that silent blind spot into a
  // labeled one — "which files to open to verify wiring" — with zero edge
  // tracing (the graph already has these; we just stopped hiding them).
  const incomingFileCounts = new Map();

  // Transparency (greenfield field receipt): the noise filter answers "how big
  // is the blast" (risk sizing) but a reviewer also needs "what else must I
  // check" — the dropped consumers. droppedSample surfaces a capped, reason-
  // coded sample of every filtered dependent so a wrongly-filtered real consumer
  // (the field case: a route + DI provider silently collapsed 20→1) is visible
  // instead of a black box. rawDirectMap retains the pre-filter depth-1 set,
  // deduped by label, so a small-diff review can be shown the full unfiltered
  // consumer list — the filter is the wrong tool at a scale a human can read.
  const droppedSample = [];
  const droppedSeen = new Set();
  const DROPPED_SAMPLE_CAP = 15;
  const rawDirectMap = new Map();

  for (const sym of symbols) {
    const seedId = _resolveOne(adj, sym);
    if (!seedId) continue;
    // depth-2 incoming: visited.depth in {1, 2}; direct = depth 1, indirect = depth 2
    const { visited } = _bfs(adj, seedId, "in", 2);

    // Cal #34 #5b — DI-aggregation collapse pre-pass per receipt #8 Q7. Mirrors
    // G1 (cal #31.B) collapse logic from getNeighbors: count occurrences per
    // source_file FIRST, then collapse during the main pass when >threshold
    // nodes share a DI-pattern file. Without the pre-pass, can't decide
    // collapse-vs-keep until we know the count.
    const sourceFileCountsDirect = new Map();
    const sourceFileCountsIndirect = new Map();
    for (const [id, info] of visited) {
      if (id === seedId) continue;
      const node = adj.nodeMap.get(id);
      const src = (node && node.source_file) || "";
      if (!src) continue;
      const target = info.depth === 1 ? sourceFileCountsDirect : sourceFileCountsIndirect;
      target.set(src, (target.get(src) || 0) + 1);
      incomingFileCounts.set(src, (incomingFileCounts.get(src) || 0) + 1);
    }
    const seenDIDirect = new Set();
    const seenDIIndirect = new Set();

    for (const [id, info] of visited) {
      if (id === seedId) continue;
      const node = adj.nodeMap.get(id);
      const label = node && node.label ? node.label : id;
      const srcFile = (node && node.source_file) || "";
      // Raw-count tracking BEFORE any filter so receipt-#8-required raw_direct_count
      // / raw_indirect_count telemetry stays auditable per cal #34 #5b spec.
      if (info.depth === 1) rawDirectCount++;
      else if (info.depth === 2) rawIndirectCount++;

      // Retain the raw depth-1 consumer (deduped by label) so the small-diff
      // full-view can expose it; filtered ones get their reason stamped below.
      let rawItem = null;
      if (info.depth === 1) {
        rawItem = rawDirectMap.get(label);
        if (!rawItem) { rawItem = { label, source_file: srcFile, filtered_reason: null }; rawDirectMap.set(label, rawItem); }
      }
      // Record a dropped dependent with its filter reason — the transparency
      // surface. Deduped by label, capped, so the sample stays small but every
      // filter class is representable.
      const recordDrop = (reason) => {
        if (rawItem && rawItem.filtered_reason === null) rawItem.filtered_reason = reason;
        if (!droppedSeen.has(label) && droppedSample.length < DROPPED_SAMPLE_CAP) {
          droppedSeen.add(label);
          droppedSample.push({ label, reason, source_file: srcFile, depth: info.depth });
        }
      };

      // Skip noise: primitives, docstrings, file/concept/JSON-key nodes, +
      // project-configured extras. Without filtering, blast_radius reports
      // `int`/`str`/docstring fragments as "dependents" of every queried
      // symbol — accurate to the graph topology, useless as signal.
      if (_isBlastNoise(node, label, extraNoise, frameworkBuiltins)) { filteredNoiseCount++; recordDrop("noise"); continue; }

      // Cal #34 #5b — test-path filter. Mirrors F2 (cal #30.3) from getNeighbors.
      // Receipt #8: indirect_dependents had 150+ entries dominated by
      // MagicMock/AsyncMock/test_inbound_push_failure_* — useful as test-coverage
      // info but not as "what production code depends on this." F2 drops with
      // telemetry so the reduction is auditable per [[telemetry-on-reduction]].
      if (_isTestPathNode(node, testPathPatterns)) { filteredTestPathCount++; recordDrop("test_path"); continue; }

      // Cal #34 #5b — DI-aggregation collapse. Mirrors G1 (cal #31.B) from
      // getNeighbors. Receipt #8: direct_dependents had Depends/Select/Page/
      // get_*_repository entries — framework wiring + DI patterns where one
      // source_file (factory.py, dependencies.py, etc.) contributes many edges.
      // Collapse (not drop) to preserve signal at 1/N volume.
      if (srcFile && DI_AGGREGATION_BASENAMES.test(srcFile)) {
        const counts = info.depth === 1 ? sourceFileCountsDirect : sourceFileCountsIndirect;
        const seen = info.depth === 1 ? seenDIDirect : seenDIIndirect;
        if ((counts.get(srcFile) || 0) > COLLAPSE_THRESHOLD) {
          if (seen.has(srcFile)) { filteredDIAggregationCount++; recordDrop("di_aggregation"); continue; }
          seen.add(srcFile);
          // Keep the representative (one label) — the collapsed-count is
          // surfaced via filteredDIAggregationCount in noise_telemetry.
        }
      }

      if (info.depth === 1) direct.set(label, id);
      else if (info.depth === 2) indirect.add(label);
      if (node && node.source_file) modules.add(path.dirname(node.source_file));
      // Include source_file so consumers can show the colliding module.
      // Observed: same-label modules in different packages collide unflagged
      // — reviewers have no signal which module each finding referenced.
      // source_file may be empty for synthetic nodes, kept as "" then.
      if (info.edge && info.edge.confidence === "AMBIGUOUS") {
        ambiguous.push({
          symbol: sym,
          node: { id, label, source_file: (node && node.source_file) || "" },
        });
      }
    }
  }

  // god-node detection via direct degree-sort over the loaded adjacency.
  // Replaces the prior regex-scrape of graphify-out/GRAPH_REPORT.md — degree
  // is what defines god-nodes (per upstream graphify/analyze.py::god_nodes),
  // and graph.json carries the structural data directly. Works even when
  // GRAPH_REPORT.md hasn't been generated yet.
  const topNodes = _topByDegree(adj, 10);
  const topIds = new Set(topNodes.map(item => item.id));
  const topLabels = new Set(topNodes.map(item => (item.node.label || item.id).toLowerCase()));
  // Itemize WHICH input symbols hit a god-node + flag each as ubiquitous (an
  // expected, fires-on-most-PRs type) or discriminating (a notable structural
  // god-node). Replaces the prior opaque boolean so consumers can quiet the
  // alarm-fatigue warning for ubiquitous-only matches. See _getUbiquitousTypeSet.
  const ubiquitousSet = _getUbiquitousTypeSet(adj);
  const godNodeMatches = [];
  const seenGod = new Set();
  for (const sym of symbols) {
    if (typeof sym !== "string" || sym.length === 0 || sym.length > 256) continue;
    const resolvedId = _resolveOne(adj, sym);
    let matchedLabel = null;
    if (resolvedId && topIds.has(resolvedId)) {
      const n = adj.nodeMap.get(resolvedId);
      matchedLabel = (n && n.label) || resolvedId;
    } else if (topLabels.has(sym.toLowerCase())) {
      matchedLabel = sym;
    }
    if (matchedLabel && !seenGod.has(matchedLabel.toLowerCase())) {
      seenGod.add(matchedLabel.toLowerCase());
      godNodeMatches.push({ symbol: matchedLabel, ubiquitous: ubiquitousSet.has(matchedLabel.toLowerCase()) });
    }
  }
  const godNodeMatch = godNodeMatches.length > 0;
  // Discriminating = matched a god-node that is NOT ubiquitous. This is the
  // signal that should fire the ⚠️ warning; a PR touching only ubiquitous
  // types (the alarm-fatigue case) has godNodeMatch=true but discriminating=false.
  const discriminatingGodNodeMatch = godNodeMatches.some(m => !m.ubiquitous);

  let effect_size;
  if (godNodeMatch || direct.size + indirect.size > 20 || modules.size >= 4) effect_size = "large";
  else if (direct.size + indirect.size > 5 || modules.size >= 2) effect_size = "medium";
  else effect_size = "small";

  // Cal #34 #5b — surface noise_telemetry + raw counts per receipt #8 Q7
  // explicit requirement: post-filter counts feed effect_size (above), but
  // raw_*_count surfaces pre-filter totals so the shrink is auditable +
  // doesn't silently re-route tiers. Empty telemetry object when nothing
  // filtered (matches getNeighbors' null-telemetry-when-noop pattern).
  const totalFiltered = filteredNoiseCount + filteredTestPathCount + filteredDIAggregationCount;
  const noiseTelemetry = totalFiltered > 0 ? {
    filtered_noise: filteredNoiseCount,
    filtered_test_path: filteredTestPathCount,
    filtered_di_aggregation: filteredDIAggregationCount,
  } : null;
  // Rank direct dependents by RELEVANCE to the diff, not raw in-degree. Raw
  // in-degree surfaces incidental high-fan-in god-nodes (permission enums,
  // event-bus protocols) as top drill-down targets even when they relate to the
  // change only tangentially — and their depth-2 incoming overflows the MCP
  // transport. Relevance tiers, derived from data already in this function (no
  // extra inputs): tier 2 = dependent's source_file is among the changed
  // symbols' files (co-located with a change); tier 1 = dependent shares a
  // Leiden community with a changed symbol; tier 0 = neither. Pure god-nodes
  // (top-degree AND tier 0) sink to the bottom but STAY present — they are real
  // dependents, so dropping them would hide genuine callers (only demote, never
  // filter). in-degree is the within-tier tie-break. direct_dependents order is
  // the rank; direct_dependents_degrees carries the ranking signal so the F16
  // drill-down step consumes it directly (and uses is_god_node to trigger the
  // --max-bytes transport fallback). Config reverts to raw in-degree.
  const relevanceRanking = _getDrillDownRelevanceRanking();
  const changedFiles = new Set();
  const changedCommunities = new Set();
  if (relevanceRanking) {
    for (const sym of symbols) {
      if (typeof sym !== "string" || sym.length === 0 || sym.length > 256) continue;
      const sid = _resolveOne(adj, sym);
      if (!sid) continue;
      const snode = adj.nodeMap.get(sid);
      if (snode && snode.source_file) changedFiles.add(snode.source_file);
      if (snode && snode.community !== undefined && snode.community !== null) changedCommunities.add(snode.community);
    }
  }
  let edgeCountZeroFlagged = 0;
  const directDegrees = Array.from(direct.entries()).map(([label, id]) => {
    // id is the BFS-visited node id, carried through from the traversal — NOT
    // a label re-resolution — so degrees are computed against the exact node
    // that was reached via a real edge (no first-homonym mismatch).
    const inCount = id ? ((adj.inc.get(id) || []).length) : 0;
    const outCount = id ? ((adj.out.get(id) || []).length) : 0;
    const node = id ? adj.nodeMap.get(id) : null;
    const srcFile = (node && node.source_file) || "";
    const isGodNode = id ? topIds.has(id) : topLabels.has(String(label).toLowerCase());
    let relevanceTier = 0;
    if (relevanceRanking) {
      if (srcFile && changedFiles.has(srcFile)) relevanceTier = 2;
      else if (node && node.community !== undefined && node.community !== null && changedCommunities.has(node.community)) relevanceTier = 1;
    }
    const pureGodNode = isGodNode && relevanceTier === 0;
    const edgeCount = inCount + outCount;
    // A node reached as a depth-1 "in" dependent necessarily has an edge to the
    // seed, so edge_count 0 is contradictory — it signals a graph inconsistency
    // (or a residual id mismatch). Flag rather than drop: a real caller must
    // stay visible, but the reviewer is told the degree data is untrustworthy.
    const lowConfidence = edgeCount === 0;
    if (lowConfidence) edgeCountZeroFlagged++;
    return {
      label, in_count: inCount, edge_count: edgeCount,
      source_file: srcFile, relevance_tier: relevanceTier,
      is_god_node: isGodNode, pure_god_node: pureGodNode,
      ...(lowConfidence ? { low_confidence: true } : {}),
    };
  }).sort((a, b) => {
    if (relevanceRanking && a.pure_god_node !== b.pure_god_node) return a.pure_god_node ? 1 : -1;
    if (relevanceRanking && b.relevance_tier !== a.relevance_tier) return b.relevance_tier - a.relevance_tier;
    return b.in_count - a.in_count || b.edge_count - a.edge_count;
  });

  const base = {
    effect_size,
    direct_dependents: directDegrees.map(d => d.label),
    direct_dependents_degrees: directDegrees,
    indirect_dependents: Array.from(indirect),
    modules_touched: modules.size,
    modules_touched_list: Array.from(modules).slice(0, 10),
    god_node_match: godNodeMatch,
    god_node_matches: godNodeMatches,
    discriminating_god_node_match: discriminatingGodNodeMatch,
    ambiguous_bindings: ambiguous.length,
    ambiguous_details: ambiguous,
    source: "graphify",
    raw_direct_count: rawDirectCount,
    raw_indirect_count: rawIndirectCount,
  };
  if (noiseTelemetry) base.noise_telemetry = noiseTelemetry;
  // Transparency surface (greenfield field receipt). direct_dependents stays the
  // FILTERED risk-sizing view (effect_size legitimately wants filtering); these
  // fields answer the separate "what else must I check" question so the two are
  // no longer conflated into one filtered answer.
  //   dropped_sample — always-on, capped, reason-coded list of filtered
  //     dependents, so a wrongly-filtered real consumer is auditable.
  //   raw_direct_dependents — the FULL unfiltered depth-1 set, exposed only when
  //     it's small enough for a human to read (≤ threshold). At that scale the
  //     filter creates a blind spot to solve a problem that doesn't exist, so it
  //     is demoted to an advisory annotation. Keyed on raw-dependent-COUNT (not
  //     file-count): a 2-file change can touch a symbol with 200 dependents.
  if (droppedSample.length > 0) base.dropped_sample = droppedSample;
  if (edgeCountZeroFlagged > 0) base.edge_count_zero_flagged = edgeCountZeroFlagged;
  const rawFullThreshold = _getRawDependentsFullViewThreshold();
  if (rawFullThreshold !== null && rawDirectMap.size > 0 && rawDirectMap.size <= rawFullThreshold) {
    base.raw_direct_dependents = Array.from(rawDirectMap.values());
    base.raw_direct_view_note = `Showing all ${rawDirectMap.size} raw direct dependents (≤ ${rawFullThreshold} — a scale a reviewer can read directly). The noise filter is advisory here: ${filteredNoiseCount} noise, ${filteredTestPathCount} test-path, ${filteredDIAggregationCount} DI-aggregation. direct_dependents remains the filtered risk-sizing view.`;
  }
  // Q5a (cal #39.A) — DI-opaque caller surface. When direct_dependents is empty
  // BUT callers were DI-aggregation-collapsed, the empty set would otherwise
  // read as "no callers" for what may be the highest-value symbol in the diff
  // (a FastAPI service reached only through Depends() factories). Surface the
  // top-K caller source_files (graph already has them; we just stopped hiding
  // them) + a labeled note so a reviewer opens the right files instead of
  // trusting a false "no dependents". No edge tracing — purely re-surfacing.
  // Fire when DI-collapse DOMINATES the visible caller set (collapsed ≥
  // surviving), not only when it's literally empty — the collapse keeps one
  // representative per source_file, so a DI-opaque service often shows 1-2
  // reps masking dozens of real callers. `>= direct.size` catches both the
  // empty case greenfield observed and the sparse-reps case, while staying
  // quiet when the caller picture is mostly real (collapse was minor).
  if (filteredDIAggregationCount > 0 && filteredDIAggregationCount >= direct.size && incomingFileCounts.size > 0) {
    const callerFiles = Array.from(incomingFileCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([f]) => f);
    base.di_opaque = true;
    base.di_collapsed_caller_files = callerFiles;
    const shown = direct.size === 0 ? "direct_dependents: []" : `direct_dependents shows only ${direct.size}`;
    base.di_opaque_note = `${shown} — ${filteredDIAggregationCount} caller(s) collapsed via DI-aggregation (e.g. FastAPI Depends() factories); true blast radius is DI-opaque. Open these caller source_files to verify wiring: ${callerFiles.join(", ")}`;
  }
  // Shape-aware size cap (parity with getNeighbors --max-bytes). Field
  // consumption profile of an 85KB response: ~3KB used — the scalars + the
  // ranked degrees array; the raw label arrays were never read (degrees
  // supersedes them). So truncate raw arrays FIRST and never cut the ranked
  // signal; a naive tail-truncation that cut into degrees would be strictly
  // worse than the MCP sidecar fallback it replaces.
  const blastMaxBytes = options && Number.isInteger(options.max_bytes) && options.max_bytes > 0 ? options.max_bytes : null;
  if (blastMaxBytes) {
    const size = () => JSON.stringify(base).length;
    if (size() > blastMaxBytes) {
      base.truncated = true;
      base.max_bytes = blastMaxBytes;
      base.indirect_dependents_total = base.indirect_dependents.length;
      base.indirect_dependents = [];
      if (size() > blastMaxBytes) {
        base.direct_dependents_total = base.direct_dependents.length;
        base.direct_dependents = base.direct_dependents.slice(0, 20);
      }
      if (size() > blastMaxBytes && base.raw_direct_dependents) {
        delete base.raw_direct_dependents;
        base.raw_direct_dependents_omitted = true;
      }
      if (size() > blastMaxBytes) {
        base.direct_dependents_degrees_total = base.direct_dependents_degrees.length;
        base.direct_dependents_degrees = base.direct_dependents_degrees.slice(0, 40);
      }
    }
  }
  return base;
}

// "JSON-key noise" labels excluded from god-node detection. Mirrors upstream
// graphify/analyze.py::_JSON_NOISE_LABELS — purely structural JSON keys that
// accumulate edges mechanically and don't represent architectural concepts.
const _JSON_NOISE_LABELS = new Set([
  "start", "end", "name", "id", "type", "properties",
  "value", "key", "data", "items", "title", "description", "version",
  "dependencies", "devdependencies", "peerdependencies",
  "optionaldependencies", "bundleddependencies", "bundledependencies",
]);

function _isFileNode(node, degree) {
  const label = node && typeof node.label === "string" ? node.label : "";
  if (!label) return false;
  const src = node.source_file || "";
  if (src) {
    const basename = src.split(/[/\\]/).pop();
    if (label === basename) return true;
  }
  if (label.startsWith(".") && label.endsWith("()")) return true;
  if (label.endsWith("()") && degree <= 1) return true;
  return false;
}

function _isConceptNode(node) {
  const src = (node && node.source_file) || "";
  if (!src) return true;
  const lastSeg = src.split(/[/\\]/).pop();
  return !lastSeg.includes(".");
}

function _isJsonKeyNode(node) {
  const src = ((node && node.source_file) || "").toLowerCase();
  if (!src.endsWith(".json")) return false;
  const label = ((node && node.label) || "").trim().toLowerCase();
  return _JSON_NOISE_LABELS.has(label);
}

// Primitive + universal type-system labels surfaced by upstream graphify as
// first-class nodes. They accumulate edges from every typed signature in the
// codebase, so depth-1/depth-2 incoming BFS treats them as "dependents" of
// every queried symbol. Filtering them out of blast_radius results restores
// signal — `direct_dependents` should contain real call sites, not the fact
// that the function returns `int`.
const _PRIMITIVE_TYPE_LABELS = new Set([
  // Python scalars
  "int", "str", "bool", "bytes", "float", "complex", "None", "NoneType", "NoReturn",
  // Python typing module
  "Any", "Optional", "Union", "List", "Dict", "Tuple", "Set", "FrozenSet",
  "Type", "Callable", "Awaitable", "Iterable", "Iterator", "Generator", "AsyncGenerator",
  "Sequence", "Mapping", "MutableMapping", "Literal", "Final", "ClassVar",
  // Universal Python bases
  "object", "BaseException", "Exception",
  // Common framework infrastructure that bridges every typed signature
  "BaseModel", "UUID", "Session", "datetime", "date", "time", "timedelta",
  // JavaScript/TypeScript primitives (graph may include JS projects)
  "number", "string", "boolean", "undefined", "null", "void", "never", "unknown",
  // Common JS/TS bases
  "Object", "Array", "Promise", "Error",
]);

function _isPrimitiveTypeNode(label) {
  if (typeof label !== "string") return false;
  return _PRIMITIVE_TYPE_LABELS.has(label);
}

// Framework request/response/DI-injection builtins that leak into
// direct_dependents: every handler signature references them, so BFS ranks
// them as top "callers" of any touched symbol (field-observed: Request,
// Depends, BackgroundTasks led a drill-down list and 2 of 3 drill-downs
// anchored on them were worthless). Framework-GENERAL by construction —
// spans FastAPI/Starlette, Spring, Django, ASP.NET, Express — never
// project-specific names. Extend via config graphify.framework_builtin_noise[]
// ("!Label" removes a default from the set — same force-keep convention as
// ubiquitous_types).
const _FRAMEWORK_BUILTIN_LABELS_DEFAULT = new Set([
  // FastAPI / Starlette
  "Request", "Response", "Depends", "BackgroundTasks", "WebSocket",
  "APIRouter", "HTTPException", "status",
  // Spring / Jakarta
  "HttpServletRequest", "HttpServletResponse", "ResponseEntity", "Autowired",
  // Django
  "HttpRequest", "HttpResponse", "JsonResponse", "QuerySet",
  // ASP.NET
  "HttpContext", "IServiceProvider", "IActionResult", "ActionResult",
  // Express / Node
  "NextFunction", "IncomingMessage", "ServerResponse",
]);

function _getFrameworkBuiltinSet() {
  const cfg = getConfig();
  const set = new Set(_FRAMEWORK_BUILTIN_LABELS_DEFAULT);
  const list = cfg && Array.isArray(cfg.framework_builtin_noise) ? cfg.framework_builtin_noise : [];
  for (const entry of list) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (entry.startsWith("!")) set.delete(entry.slice(1));
    else set.add(entry);
  }
  return set;
}

// Cap on INFERRED neighbors in getNeighbors. null disables (keep all); a
// non-negative integer caps the INFERRED tail. Anything else falls back to 25.
function _getInferredNeighborCap() {
  const cfg = getConfig();
  const v = cfg ? cfg.inferred_neighbor_cap : undefined;
  if (v === null) return null;
  if (Number.isInteger(v) && v >= 0) return v;
  return 25;
}

// Raw-dependent count at/below which blast_radius exposes the FULL unfiltered
// direct-dependent set (filter demoted to advisory). Keyed on dependent count,
// not file count — the question is "can a reviewer read the whole list." Set to
// null to always keep the filtered-only view.
function _getRawDependentsFullViewThreshold() {
  const cfg = getConfig();
  const v = cfg ? cfg.raw_dependents_full_view_threshold : undefined;
  if (v === null) return null;
  if (Number.isInteger(v) && v >= 0) return v;
  return 30;
}

// Relevance ranking of blast_radius drill-down targets. Default on; only an
// explicit `false` reverts to raw in-degree ordering.
function _getDrillDownRelevanceRanking() {
  const cfg = getConfig();
  return !(cfg && cfg.drill_down_relevance_ranking === false);
}

// Upstream graphify emits some docstrings as first-class nodes (observed in
// the wild: `"Stringify value for streaming CSV output, with formula-escape
// applied."`, `"Test successful login."`, `"Tests for ExportService.list_exports."`).
// They survive as labels because the extractor doesn't classify them.
// Heuristic combines three sentence-shape detectors:
//   - length > 80 chars (long descriptive sentences)
//   - whitespace count >= 2 (multi-word labels — real symbols are
//     CamelCase/snake_case/dot.notation with zero internal spaces)
//   - starts with "Test " / "Tests for " / "Tests " AND ends with "."
//     (test-description docstring conventional shape; catches short slips
//      below the whitespace threshold like "Test login." which has 1 ws)
// False positives on legitimate long-named functions are tolerable — the
// alternative is hundreds of docstring fragments listed as dependents.
function _isDocstringNode(label) {
  if (typeof label !== "string") return false;
  if (label.length > 80) return true;
  const whitespaceCount = (label.match(/\s/g) || []).length;
  if (whitespaceCount >= 2) return true;
  if (/^Test(s)?( for)? /.test(label) && label.endsWith(".")) return true;
  return false;
}

// Composed noise filter for blast_radius BFS. Combines existing file/concept/
// json-key filters with primitive-type + docstring detection + project-extra
// labels from `.devt/config.json::graphify.blast_radius_extra_noise[]`.
function _isBlastNoise(node, label, extraNoiseSet, frameworkBuiltinSet) {
  if (_isPrimitiveTypeNode(label)) return true;
  if (_isDocstringNode(label)) return true;
  if (extraNoiseSet && extraNoiseSet.has(label)) return true;
  if (frameworkBuiltinSet && frameworkBuiltinSet.has(label)) return true;
  if (node) {
    if (_isFileNode(node, 0)) return true;
    if (_isConceptNode(node)) return true;
    if (_isJsonKeyNode(node)) return true;
  }
  return false;
}

function _getExtraNoiseSet() {
  const cfg = getConfig();
  const list = cfg && Array.isArray(cfg.blast_radius_extra_noise) ? cfg.blast_radius_extra_noise : [];
  return new Set(list.filter(s => typeof s === "string" && s.length > 0));
}

// Universal source_file patterns that mark test code. Project can override
// via .devt/config.json::graphify.test_path_patterns[]. Used by getNeighbors
// to filter test-code nodes from caller-set drill-downs — field-evidenced
// gap: AuthenticationService incoming edges were ~95% test methods + docstring
// fragments, burying the production-caller signal the operator actually needed.
const _DEFAULT_TEST_PATH_PATTERNS = [
  "(^|/)tests?/",                  // tests/ or test/
  "(^|/)__tests__/",               // JavaScript Jest convention
  "(^|/)test_[^/]+\\.py$",         // Python: test_foo.py
  "(^|/)[^/]+_test\\.(py|go|rb)$", // Python/Go/Ruby: foo_test.py / foo_test.go
  "\\.spec\\.[jt]sx?$",            // JS/TS Jasmine/Jest: foo.spec.ts
  "\\.test\\.[jt]sx?$",            // JS/TS Jest: foo.test.ts
  "(^|/)conftest\\.py$",           // pytest shared fixtures
  "(^|/)src/test/",                // Java/Kotlin Maven/Gradle layout
];
// Module-load compile — patterns are static. Project overrides via config
// still compile per-call (rare path, small list).
const _COMPILED_DEFAULT_TEST_PATH_PATTERNS = _DEFAULT_TEST_PATH_PATTERNS
  .map(p => { try { return new RegExp(p); } catch { return null; } })
  .filter(Boolean);

function _getTestPathPatterns() {
  const cfg = getConfig();
  const projectPatterns = cfg && Array.isArray(cfg.test_path_patterns) ? cfg.test_path_patterns : [];
  if (projectPatterns.length === 0) return _COMPILED_DEFAULT_TEST_PATH_PATTERNS;
  const compiled = projectPatterns
    .filter(s => typeof s === "string" && s.length > 0)
    .map(p => { try { return new RegExp(p); } catch { return null; } })
    .filter(Boolean);
  return [..._COMPILED_DEFAULT_TEST_PATH_PATTERNS, ...compiled];
}

function _isTestPathNode(node, patterns) {
  if (!node || typeof node.source_file !== "string" || !node.source_file) return false;
  const src = node.source_file;
  for (const re of patterns) {
    if (re.test(src)) return true;
  }
  return false;
}

// G1 (cal #31.B) — DI-aggregation file basename patterns. Receipt #5 Q3:
// FastAPI/Django/.NET projects commonly have one file (e.g. `dependencies.py`,
// `wiring.py`, `container.py`) that imports/wires many services via DI. The
// graph extractor sees these as many imports/uses edges from one source_file,
// producing huge fans in get_neighbors that crowd out real call edges.
// `factory.py` deliberately excluded — often legitimate (factory pattern,
// test fixtures, etc.) — basename alone isn't sufficient; the collapse only
// fires when ALSO above the threshold count.
const _DI_AGGREGATION_BASENAMES_DEFAULT = /\/(dependencies|deps|wiring|container|providers)\.(py|ts|js|tsx|jsx)$/;

function _getDIAggregationPatterns() {
  const cfg = getConfig();
  const projectPatterns = cfg && typeof cfg.di_aggregation_pattern === "string" ? cfg.di_aggregation_pattern : null;
  if (!projectPatterns) return _DI_AGGREGATION_BASENAMES_DEFAULT;
  try { return new RegExp(projectPatterns); } catch { return _DI_AGGREGATION_BASENAMES_DEFAULT; }
}

function _getDIAggregationCollapseThreshold() {
  const cfg = getConfig();
  const n = cfg && Number.isInteger(cfg.di_aggregation_collapse_threshold) ? cfg.di_aggregation_collapse_threshold : 5;
  return n > 0 ? n : 5;
}

/**
 * Top-N nodes by degree, filtered to match upstream graphify/analyze.py::god_nodes
 * (file-level hubs, method stubs, concept nodes, and JSON-key noise excluded).
 * Used by blastRadius for god-node detection — replaces the prior approach
 * that regex-scraped graphify-out/GRAPH_REPORT.md.
 */
function _topByDegree(adj, n = 10) {
  const items = [];
  for (const [id, node] of adj.nodeMap) {
    const degree = (adj.inc.get(id) || []).length + (adj.out.get(id) || []).length;
    items.push({ id, node, degree });
  }
  items.sort((a, b) => b.degree - a.degree);
  const result = [];
  for (const item of items) {
    if (_isFileNode(item.node, item.degree)) continue;
    if (_isConceptNode(item.node)) continue;
    if (_isJsonKeyNode(item.node)) continue;
    result.push(item);
    if (result.length >= n) break;
  }
  return result;
}

// Auto-derived ubiquitous-type set for god-node alarm-fatigue suppression.
// Returns a Set of lowercased labels considered "ubiquitous" — structural hubs
// so high-degree they're touched by nearly every PR (so a match on them is
// expected noise, not a notable signal). Used to downgrade the god-node ⚠️ to
// an info note when only ubiquitous types matched.
//
// Auto-derivation uses degree DOMINANCE, not a flat top-K. A flat top-K can't
// work: the god-node MATCH window is the top-10, so any flat top-K ≥ 10 would
// mark every match ubiquitous and suppress ALL warnings. Instead, of the top
// god-nodes, flag the dominant outliers — those whose degree is ≥
// DOMINANCE_FACTOR × the match-window floor degree. This separates the
// fires-on-every-PR hubs (e.g. a base error type at many× the floor) from
// merely-high domain symbols, and fails safe: a flat degree distribution
// yields an empty set (no suppression → warnings still fire).
//
// Project overrides from config.graphify.ubiquitous_types: a plain name is
// FORCE-ADDED to the suppression set; a "!"-prefixed name is FORCE-KEPT
// (exempt from suppression — e.g. when a normally-ubiquitous type is itself
// being refactored). Generic by design — no project-specific names baked in.
const _UBIQUITOUS_DOMINANCE_FACTOR = 2;
function _getUbiquitousTypeSet(adj) {
  const set = new Set();
  const top = _topByDegree(adj, 10);
  if (top.length > 0) {
    const floorDegree = top[top.length - 1].degree || 0;
    if (floorDegree > 0) {
      const threshold = floorDegree * _UBIQUITOUS_DOMINANCE_FACTOR;
      for (const item of top) {
        if (item.degree >= threshold) {
          const label = (item.node && item.node.label) || item.id;
          if (label) set.add(String(label).toLowerCase());
        }
      }
    }
  }
  let overrides = [];
  try { overrides = getConfig().ubiquitous_types; } catch { /* default empty */ }
  if (!Array.isArray(overrides)) overrides = [];
  const forceKeep = new Set();
  for (const raw of overrides) {
    if (typeof raw !== "string" || !raw) continue;
    if (raw.startsWith("!")) forceKeep.add(raw.slice(1).toLowerCase());
    else set.add(raw.toLowerCase());
  }
  for (const k of forceKeep) set.delete(k);
  return set;
}

/**
 * Top-N god-nodes as [{symbol, edge_count}] — shape-compatible with the
 * legacy parseReportSections().god_nodes field, but sourced from graph.json
 * adjacency rather than regex-scraping GRAPH_REPORT.md. Reads stay live with
 * the graph: post-`graphify update` rebuilds without `cluster-only` don't
 * rewrite GRAPH_REPORT.md, so the text-scrape path can lag the actual graph
 * by a commit or two.
 */
/**
 * Conditionally refresh the project graph by subprocess-shelling `graphify update .`.
 * Returns a structured envelope (no throws) so workflows can branch without try/catch:
 *   {ok, action: "refreshed"|"skip"|"error", reason?, duration_ms?, lag_commits?}
 *
 * Skip reasons: "disabled" (config.graphify.enabled=false), "graph_missing" (no graph.json
 * to refresh — first build must be manual), "fresh" (lag_commits within threshold),
 * "timeout" (subprocess hit the wall), "graphify_not_installed" (ENOENT on the binary).
 *
 * Two trigger modes — when `options.force=true`, skip the freshness check and always
 * run; otherwise compare freshness().lag_commits against options.staleThreshold (default
 * pulled from config.graphify.stale_threshold). When the project graph is brand-new
 * (state != "ready" in freshness), skip with `graph_missing` rather than spawning —
 * first build is a deliberate user action (`graphify ./src`), not an auto-refresh.
 *
 * Output is silent on stdout/stderr — designed for orchestrator workflows to call
 * pre-preflight without polluting the agent's visible prompt. Errors land in the
 * return envelope only.
 */
function maybeRefresh(options = {}) {
  const cfg = getConfig();
  if (!cfg.enabled) {
    return { ok: true, action: "skip", reason: "disabled" };
  }

  const timeoutMs = Math.max(parseInt(options.timeout, 10) || 60, 5) * 1000;
  const force = !!options.force;

  if (!force) {
    const fresh = freshness();
    if (fresh.state !== "ready") {
      return { ok: true, action: "skip", reason: "graph_missing" };
    }
    let threshold = options.staleThreshold;
    if (threshold === undefined || threshold === null) {
      threshold = (cfg.stale_threshold !== undefined && cfg.stale_threshold !== null)
        ? cfg.stale_threshold
        : 30;
    }
    if (fresh.lag_commits === null || fresh.lag_commits === undefined || fresh.lag_commits <= threshold) {
      return { ok: true, action: "skip", reason: "fresh", lag_commits: fresh.lag_commits };
    }
  }

  const startedAt = Date.now();
  let result;
  try {
    result = child_process.spawnSync(cfg.command || "graphify", ["update", "."], {
      timeout: timeoutMs,
      cwd: findProjectRoot(),
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (e) {
    return { ok: false, action: "error", reason: `spawn threw: ${e.message}`, duration_ms: Date.now() - startedAt };
  }
  const duration_ms = Date.now() - startedAt;

  if (result.error) {
    if (result.error.code === "ENOENT") {
      return { ok: true, action: "skip", reason: "graphify_not_installed", duration_ms };
    }
    if (result.error.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
      return { ok: true, action: "skip", reason: "timeout", duration_ms };
    }
    return { ok: false, action: "error", reason: result.error.message, duration_ms };
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim().slice(0, 500);
    return { ok: false, action: "error", reason: `exit ${result.status}${stderr ? ": " + stderr : ""}`, duration_ms };
  }
  return { ok: true, action: "refreshed", duration_ms };
}

// DEF-038 — debounced rebuild with O_CREAT|O_EXCL atomic lock. Two concurrent
// workflows firing `graphify rebuild` would race the subprocess; an exclusive
// lock plus a configurable debounce window de-dupes. The lock file's mtime
// doubles as the debounce timestamp — within the window, contention skips
// silently with reason="debounced"; outside the window the lock is
// considered stale (probably from a crashed prior invocation) and is broken.
// Lock path lives in .devt/state/ so it inherits gitignore + RESET_EXEMPT.
function rebuildDebounced(options = {}) {
  const cfg = getConfig();
  if (!cfg.enabled) {
    return { ok: true, action: "skip", reason: "disabled" };
  }
  const debounceSec = (() => {
    const v = options.debounce;
    if (v !== undefined && v !== null && v !== "") {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= 0) return n;
    }
    const c = cfg.rebuild_debounce_seconds;
    if (typeof c === "number" && c >= 0) return c;
    return 30;
  })();
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    return { ok: false, action: "error", reason: "project_root_unresolved" };
  }
  const stateDir = path.join(projectRoot, ".devt", "state");
  try {
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  } catch (e) {
    return { ok: false, action: "error", reason: `state_dir_uncreatable: ${e.message}` };
  }
  const lockPath = path.join(stateDir, ".graphify-rebuild.lock");

  // Atomic acquire via wx flag (O_CREAT|O_EXCL). Two callers race the
  // openSync; exactly one wins and gets a writable fd. The other gets EEXIST.
  let fd;
  try {
    fd = fs.openSync(lockPath, "wx");
  } catch (e) {
    if (e.code !== "EEXIST") {
      return { ok: false, action: "error", reason: `lock_open_failed: ${e.message}` };
    }
    let lockMtime;
    try { lockMtime = fs.statSync(lockPath).mtime.getTime(); }
    catch { return { ok: true, action: "skip", reason: "in_progress" }; }
    const ageSec = Math.round((Date.now() - lockMtime) / 1000);
    // Within the debounce window — another caller's rebuild is either
    // still running or just finished; skip silently.
    if (ageSec < debounceSec) {
      return { ok: true, action: "skip", reason: "debounced", age_seconds: ageSec, debounce_seconds: debounceSec };
    }
    // Past the debounce window — assume the prior holder crashed before
    // unlinking. Break the lock and retry once.
    try { fs.unlinkSync(lockPath); } catch { /* race with the legitimate holder; bail out */ }
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (retryErr) {
      if (retryErr.code === "EEXIST") {
        return { ok: true, action: "skip", reason: "in_progress" };
      }
      return { ok: false, action: "error", reason: `lock_retry_failed: ${retryErr.message}` };
    }
  }

  try {
    // Record pid + start time inside the lock — diagnostic-only.
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    } catch { /* not load-bearing */ }
    const refreshOptions = { force: true, timeout: options.timeout };
    return maybeRefresh(refreshOptions);
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.unlinkSync(lockPath); } catch { /* nothing to clean up */ }
  }
}

/**
 * Write a workflow-completion Q&A entry to `graphify-out/memory/<workflow_id>.md`
 * for graphify's memory feedback loop. On the next `graphify update .` run,
 * graphify auto-extracts these files into the graph — closing the loop so the
 * project graph learns from what devt's agents discovered.
 *
 * Returns {ok, action: "written"|"skip", path?, reason?} — no throws. Skips
 * silently when graphify is disabled, when graphify-out/ doesn't exist (the
 * project never built a graph), or when payload is malformed. The skip-silently
 * contract means workflows can call this at every completion without guarding.
 *
 * The written file's frontmatter carries semantic anchors graphify's extractor
 * recognizes: workflow_id, workflow_type, task, references (symbol list),
 * created_at, status. Body is a markdown Q&A — graphify treats markdown
 * headings as concept boundaries during extraction.
 */
function writeMemoryEntry(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, action: "skip", reason: "invalid_payload" };
  }
  // Validate workflow_id BEFORE any other gate — security-relevant args must
  // be rejected unconditionally so the contract is verifiable in any environment,
  // including disabled-graphify devt-self where no file ever gets written.
  if (!payload.workflow_id || typeof payload.workflow_id !== "string") {
    return { ok: false, action: "skip", reason: "missing_workflow_id" };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(payload.workflow_id)) {
    return { ok: false, action: "skip", reason: "invalid_workflow_id_chars" };
  }
  const cfg = getConfig();
  if (!cfg.enabled) {
    return { ok: true, action: "skip", reason: "disabled" };
  }

  const outDir = getGraphifyOutDir();
  if (!fs.existsSync(outDir)) {
    return { ok: true, action: "skip", reason: "no_graphify_out" };
  }
  const memDir = path.join(outDir, "memory");
  try {
    if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  } catch (e) {
    return { ok: false, action: "skip", reason: `mkdir failed: ${e.message}` };
  }

  // Filename: <workflow_id>.md — UUID guarantees uniqueness; one entry per
  // workflow run. Re-running the same workflow_id replaces atomically.
  // Validate to defuse path traversal — accept only [A-Za-z0-9_-] in id.
  // workflow_id was already regex-validated to /^[A-Za-z0-9_-]+$/ at function
  // entry — no `.`, `/`, `\`, or null bytes possible. path.basename strips any
  // residual separators as belt-and-suspenders. Final path is assembled by
  // string concat (memDir + sep + safeBasename) rather than path.join so
  // static analyzers don't have to verify the chain.
  const safeBasename = path.basename(`${payload.workflow_id}.md`);
  const dest = `${memDir}${path.sep}${safeBasename}`;

  // Validate references — array of bounded-length strings, capped at 50 to
  // keep frontmatter under graphify's extractor sweet spot. Drop non-strings.
  const refs = Array.isArray(payload.references)
    ? payload.references.filter(r => typeof r === "string" && r.length > 0 && r.length < 200).slice(0, 50)
    : [];

  const task = String(payload.task || "").slice(0, 1000);
  const summary = String(payload.summary || "").slice(0, 50000);
  const workflowType = String(payload.workflow_type || "unknown").slice(0, 64);
  const createdAt = payload.created_at || new Date().toISOString();
  const status = String(payload.status || "completed").slice(0, 32);

  const frontmatterLines = [
    "---",
    `workflow_id: ${payload.workflow_id}`,
    `workflow_type: ${workflowType}`,
    `task: ${JSON.stringify(task)}`,
    `created_at: ${createdAt}`,
    `status: ${status}`,
  ];
  if (refs.length > 0) {
    frontmatterLines.push("references:");
    for (const r of refs) frontmatterLines.push(`  - ${JSON.stringify(r)}`);
  }
  frontmatterLines.push("---", "");

  const body = [
    `# Q: ${task || "(no task description)"}`,
    "",
    `## Workflow Result`,
    "",
    summary || "_(no summary provided)_",
    "",
  ];
  if (refs.length > 0) {
    body.push("## Symbols Referenced", "");
    for (const r of refs) body.push(`- ${r}`);
    body.push("");
  }

  const content = frontmatterLines.join("\n") + body.join("\n");
  try {
    const { atomicWriteFileSync } = require("./io.cjs");
    atomicWriteFileSync(dest, content);
  } catch (e) {
    return { ok: false, action: "skip", reason: `write failed: ${e.message}` };
  }
  return { ok: true, action: "written", path: dest };
}

// Test-class symbol prefix — pytest classes use TestX naming convention; when
// they accumulate edges (fixtures, parametrize wiring, shared helpers) they
// rank as god-nodes and pollute the surface that reviewers consult for
// "constitutional abstractions." Field-observed: a test class accumulated
// ~591 edges and ranked top-12, drowning out genuine domain god-nodes.
// Filter on label only (source_file alone isn't enough — some test classes
// live in tests/ AND some prod classes are mis-classified into tests/ via
// monorepo layout).
const _TEST_CLASS_PREFIX_RE = /^Test[A-Z]/;
function _isTestClassSymbol(label) {
  return typeof label === "string" && _TEST_CLASS_PREFIX_RE.test(label);
}

function godNodes(limit = 10) {
  const loaded = loadGraph();
  if (!loaded.ok) return [];
  const testPathPatterns = _getTestPathPatterns();
  // Over-fetch (3×) before filter so we still hit `limit` after stripping
  // test-class + test-path nodes. _topByDegree is O(n log n) in node count
  // regardless — the slice is the cheap part.
  const overFetch = Math.max(limit * 3, 30);
  const survivors = _topByDegree(loaded.cache.adj, overFetch).filter(item => {
    const label = (item.node && item.node.label) || item.id;
    if (_isTestClassSymbol(label)) return false;
    if (_isTestPathNode(item.node, testPathPatterns)) return false;
    return true;
  });
  return survivors.slice(0, limit).map(item => ({
    symbol: (item.node && item.node.label) || item.id,
    edge_count: item.degree,
  }));
}

// Check whether files in the diff scope are graphify god-nodes.
// Observed: large files (multi-thousand LOC routers/services) are almost
// certainly god nodes, but symbol-anchored scan_prep misses them because
// the anchor list doesn't include module-level symbols. This function maps
// file paths back to graph nodes (via `source_file` metadata) and reports
// the max-degree symbol per file — orchestrators can flag any file above
// `edgeThreshold` (default 50) as a god-node candidate for the review.
//
// Returns [{file, max_edges, top_symbol, is_god_node}] sorted by max_edges desc.
// Files with no graph nodes are omitted (no signal to report). When loadGraph
// fails the function returns [] — the workflow proceeds without F17 surface.
function checkLargeFilesGodNodes(diffFiles, edgeThreshold = 50) {
  if (!Array.isArray(diffFiles) || diffFiles.length === 0) return [];
  const loaded = loadGraph();
  if (!loaded.ok) return [];
  const { nodeMap, inc, out } = loaded.cache.adj;
  // file basename → top match (deterministic dedup so absolute/relative paths
  // collapse to the same file row). We match on basename to handle the common
  // case where diff entries are relative paths but graph source_file is
  // absolute (or vice versa).
  const wantBasenames = new Set(diffFiles.map(f => path.basename(f)));
  const perFile = new Map(); // basename -> { max_edges, top_symbol, file }
  for (const [id, node] of nodeMap) {
    const sf = node && node.source_file;
    if (!sf) continue;
    const bn = path.basename(sf);
    if (!wantBasenames.has(bn)) continue;
    const degree = (inc.get(id) || []).length + (out.get(id) || []).length;
    const cur = perFile.get(bn);
    if (!cur || degree > cur.max_edges) {
      perFile.set(bn, { file: sf, max_edges: degree, top_symbol: node.label || id });
    }
  }
  const out_ = [];
  for (const row of perFile.values()) {
    out_.push({ ...row, is_god_node: row.max_edges >= edgeThreshold });
  }
  out_.sort((a, b) => b.max_edges - a.max_edges);
  return out_;
}

// augmentImpactMap — the deterministic post-MCP augmentation that used to live
// as ~113 lines of inline jq in code-review.md's context_init (substep 7). It
// runs AFTER the MCP tier call wrote graph-impact.md, so it cannot fold into the
// pre-MCP contextInitBundle. Pure post-processing of on-disk JSON — zero MCP,
// zero model judgment — it appends up to six sections to graph-impact.md,
// byte-identical to the prior workflow output:
//   1. God-node warning (file-level, from check-large-files)
//   2. Symbol-level god-nodes (from check-symbol-godnodes)
//   3. Dropped-symbol truncation banner (prepended when >5) + section
//   4. Hyperedge completeness (partial-coverage groupings, from the brief)
//   5. Ambiguous bindings (from the brief's blast.ambiguous_details)
//   6. Symbol-level god-nodes from preflight (fallback when 1 AND 2 are empty)
// Returns a summary of what was appended so the workflow can echo it in one line.
function augmentImpactMap(opts = {}) {
  const proot = opts.projectRoot || (() => { try { return require("./config.cjs").findProjectRoot(); } catch { return process.cwd(); } })();
  const edgeThreshold = Number.isInteger(opts.edgeThreshold) && opts.edgeThreshold > 0 ? opts.edgeThreshold : 50;
  const rawCount = (opts.rawCount === undefined || opts.rawCount === null || opts.rawCount === "") ? "?" : String(opts.rawCount);
  const stateDir = path.join(proot, ".devt", "state");
  const giPath = path.join(stateDir, "graph-impact.md");
  const briefPath = path.join(stateDir, "preflight-brief.json");
  const droppedPath = path.join(stateDir, "topic-symbols-dropped.json");

  const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
  const brief = readJson(briefPath, null);

  // Resolve the diff files (the two god-node CLIs need them).
  let diffFiles = Array.isArray(opts.files) ? opts.files.slice() : [];
  if (diffFiles.length === 0) {
    try {
      const base = opts.baseRef || (brief && brief.git && brief.git.primary_branch) || "main";
      // Union collection (committed range + working tree + untracked) — the
      // same semantic every scope-sensitive consumer uses; a bare base...HEAD
      // diff goes blind on uncommitted trees.
      diffFiles = require("./review-weight.cjs").collectChangedFiles(proot, base);
    } catch { diffFiles = []; }
  }

  const appended = [];
  const append = (name, text) => { try { fs.appendFileSync(giPath, text); appended.push(name); } catch { /* graph-impact.md unwritable — skip */ } };

  // 1. File-level god-node warning.
  const fileGods = diffFiles.length ? checkLargeFilesGodNodes(diffFiles, edgeThreshold).filter(r => r.is_god_node) : [];
  if (fileGods.length) {
    const rows = fileGods.map(r => `- \`${r.file}\` — \`${r.top_symbol}\` has ${r.max_edges} edges; signature changes ripple to all callers. Prefer additive changes.`);
    append("god_node_warning", `\n## God-node warning\n\n${rows.join("\n")}\n`);
  }

  // 2. Symbol-level god-nodes.
  const symGods = diffFiles.length ? checkSymbolLevelGodNodes(diffFiles, edgeThreshold) : [];
  if (symGods.length) {
    const rows = symGods.map(r => `- \`${r.symbol}\` (${r.source_file}) has ${r.edge_count} edges; any non-additive change cascades through every caller.`);
    append("symbol_godnodes", `\n## Symbol-level god-nodes\n\n${rows.join("\n")}\n`);
  }

  // 3. Dropped-symbol truncation banner + section.
  const dropped = readJson(droppedPath, null);
  if (Array.isArray(dropped) && dropped.length > 0) {
    const n = dropped.length;
    if (n > 5) {
      const banner = `> **Subject symbols truncated**: ${n} of ${rawCount} extracted topic symbols were dropped by the MCP blast_radius 32-symbol cap. Full list in the **## Subject symbols dropped** section below — spot-check for high-risk symbols whose absence may affect severity calibration.\n\n`;
      try { fs.writeFileSync(giPath, banner + (fs.existsSync(giPath) ? fs.readFileSync(giPath, "utf8") : "")); appended.push("dropped_banner"); } catch { /* skip */ }
    }
    const rows = dropped.map(s => `- ${s}`);
    append("dropped_section", `\n## Subject symbols dropped (truncation notice)\n\n_${n} of the ${rawCount} extracted topic symbols were truncated by the MCP blast_radius 32-symbol cap. Listed below in original preflight ranking order. Spot-check for any high-risk symbols whose absence may affect severity calibration._\n\n${rows.join("\n")}\n`);
  }

  // 4. Hyperedge completeness (partial-coverage groupings).
  const hyper = (brief && Array.isArray(brief.hyperedges_matched)) ? brief.hyperedges_matched.filter(h => (h.completeness ?? 1) < 1.0) : [];
  if (hyper.length) {
    const rows = hyper.map(h => {
      const inScope = Array.isArray(h.members_in_scope) ? h.members_in_scope : [];
      const members = Array.isArray(h.members) ? h.members : [];
      const pct = Math.floor((h.completeness || 0) * 100);
      const outOfScope = members.filter(m => !inScope.includes(m)).join(", ");
      return `- **${h.label}** — ${inScope.length} of ${h.member_count} members in scope (${pct}% complete). Out-of-scope members: ${outOfScope}`;
    });
    append("hyperedge_completeness", `\n## Hyperedge completeness (partial-coverage semantic groupings)\n\n_${hyper.length} graphify-discovered semantic grouping(s) below 100% completeness. Members outside the current scope may indicate forgotten changes (related route/repo/migration/test/doc). Review whether scope should expand OR explicitly defer the missing members in your verdict._\n\n${rows.join("\n")}\n`);
  }

  // 5. Ambiguous bindings.
  const ambCount = (brief && brief.blast && brief.blast.ambiguous_bindings) || 0;
  if (ambCount) {
    const details = (brief.blast.ambiguous_details || []);
    const rows = details.map(d => `- \`${d.symbol}\` → resolves at \`${(d.node && d.node.source_file) || "(no source_file)"}\` (label: \`${d.node && d.node.label}\`)`);
    append("ambiguous_bindings", `\n## Ambiguous bindings\n\n_${ambCount} symbol(s) resolve to multiple definition sites — reviewers should cite the module path explicitly when a finding references one of these symbols. Same-name modules from different packages can collide unflagged, forcing manual cross-check per finding._\n\n${rows.join("\n")}\n`);
  }

  // 6. Preflight god-node fallback — only when the diff-anchored CLIs (1 + 2)
  // both found nothing, so the reviewer still gets structural signal.
  if (fileGods.length === 0 && symGods.length === 0) {
    const pgods = (brief && Array.isArray(brief.god_nodes)) ? brief.god_nodes : [];
    if (pgods.length) {
      const rows = pgods.map(g => `- \`${g.symbol}\` has ${g.edge_count} edges (graph-wide rank)`);
      append("preflight_godnodes_fallback", `\n## Symbol-level god-nodes (from preflight, not diff-anchored)\n\n_File-level + symbol-level diff CLIs returned 0 — surfacing graph-global top god-nodes from preflight.god_nodes so severity calibration has structural signal. These symbols may not be in the diff; weight findings that touch them or their callers higher because changes ripple to many sites._\n\n${rows.join("\n")}\n`);
    }
  }

  // 7. Severity calibration (god-node anchors). effect_size is popularity-
  // derived; when god nodes are merely IN the blast set a "large" reading is
  // inflated — but when a CHANGED symbol IS a god node, severity must go UP.
  // The plan's anchors give the discrimination; both branches name names so
  // reviewers weight findings by mechanism, not a bare scalar (template from
  // an operator's hand-written note, field receipt).
  const planForNote = readJson(path.join(stateDir, "graphify-impact-plan.json"), null);
  const planSymbols = (planForNote && planForNote.args && Array.isArray(planForNote.args.symbols)) ? planForNote.args.symbols : [];
  const effectSizeForNote = (brief && brief.blast && brief.blast.effect_size) || null;
  const godPool = [
    ...symGods.map(g => ({ symbol: g.symbol, edge_count: g.edge_count })),
    ...(((brief && brief.god_nodes) || []).map(g => ({ symbol: g.symbol, edge_count: g.edge_count }))),
  ];
  if (godPool.length) {
    const changedGods = godPool.filter(g => planSymbols.includes(g.symbol));
    if (changedGods.length) {
      const rows = changedGods.slice(0, 5).map(g => `\`${g.symbol}\` (${g.edge_count} edges)`).join(", ");
      append("severity_calibration_godnode", `\n## Severity Calibration (god-node)\n\n- CHANGED symbol(s) ${rows} are themselves god nodes — severity weighting UP, not down: a defect here ripples to every caller.\n`);
    } else if (effectSizeForNote === "large") {
      const rows = godPool.slice(0, 4).map(g => `\`${g.symbol}\` (in=${g.edge_count})`).join(", ");
      append("severity_calibration_godnode", `\n## Severity Calibration (god-node)\n\n- effect_size: large (popularity-inflated: the blast set contains god nodes ${rows}; no CHANGED symbol is itself a god node) — weight findings by semantic delta, not raw counts, while still using the caller sets to verify wiring.\n`);
    }
  }

  return { sections_appended: appended, god_node_count: fileGods.length, symbol_godnode_count: symGods.length, ambiguous_count: ambCount };
}

// B-XIII — group diff files by their dominant graphify community attribute.
// Each node in graph.json may carry `community: <int>` from the Leiden
// clustering step. For each input file, find its source-file node(s) and
// determine the most-common community among symbols in that file. Group
// files by community. Returns:
//   {
//     mode: "community" | "fallback",
//     groups: [{community: <int|null>, files: [<file>...]}],
//     reason?: <string>            // why we fell back (when mode === "fallback")
//   }
// Falls back to mode:"fallback" with empty groups when:
//   - graph not loaded (graphify disabled / graph.json missing)
//   - graph has no community attributes (clustering didn't run)
//   - any input file has 0 matching nodes (diff entirely uncovered)
// Caller (code-review-parallel.md::partition_lanes) handles the fallback
// by routing to the legacy top-N-path partition.
//
// options.targetLanes consolidates groups into N super-groups when the raw
// community count exceeds N. Observed failure mode: a PR returns dozens of
// micro-communities at high coverage → unusable for a small lane cap.
// Path-prefix consolidation matches the manual-override pattern (group by
// domain path): when groups > targetLanes, keep top-N by file count as
// anchors, merge remaining groups into the anchor whose files share the
// longest common directory prefix. Result has exactly `target_lanes`
// super-groups (or fewer if input had fewer raw groups).

// Round 7 W6 — service-boundary auto-detect. When the graph carries no
// Leiden community labels, scan diff files for common 2-segment service
// prefix patterns and group by service name. Patterns are ordered by
// specificity so a file matching both `app/services/X/` and the generic
// `apps/X/` lands in the more specific bucket via first-wins. Anchor
// check (`idx === 0 || prev === "/"`) prevents `vendor/app/services/X/`
// from matching the bare prefix. Returns null when coverage falls below
// 80% — caller falls through to the legacy fallback.
const _SERVICE_PREFIXES = [
  "app/services/", "services/", "internal/",
  "packages/", "apps/", "pkg/", "cmd/",
];
function detectServiceBoundary(diffFiles) {
  let best = null;
  for (const prefix of _SERVICE_PREFIXES) {
    const groups = new Map();
    let matches = 0;
    for (const f of diffFiles) {
      const idx = f.indexOf(prefix);
      if (idx === -1) continue;
      if (idx !== 0 && f[idx - 1] !== "/") continue;
      const rest = f.slice(idx + prefix.length);
      const slashAt = rest.indexOf("/");
      if (slashAt <= 0) continue;
      const service = rest.slice(0, slashAt);
      const key = `${prefix}${service}`;
      if (!groups.has(key)) groups.set(key, { service: key, files: [] });
      groups.get(key).files.push(f);
      matches++;
    }
    if (!best || matches > best.matches) {
      best = { pattern: prefix, matches, groups: Array.from(groups.values()) };
    }
  }
  if (!best || diffFiles.length === 0) return null;
  const coverage = best.matches / diffFiles.length;
  if (coverage < 0.8) return null;
  return { ...best, coverage };
}

// G7 (cal #31.D) — Compose markdown-ready drill-down sections for top-N
// symbols. The graphify-impact-plan workflow step requires drill-down
// sections in graph-impact.md; orchestrator-discipline can drop them.
// This emits ready-to-concatenate markdown that the workflow can pipe
// directly into the impact file, removing the "did I remember to drill?"
// failure mode receipt #5 Q7a flagged.
//
// Format per symbol:
//   ## Drill-down: <symbol> (direction=<dir>, depth=<n>)
//
//   - <neighbor> (relation=<rel>, depth=<d>, source_file=<sf>)
//   - ...
//
//   _(filtered: noise=<n>, test_path=<n>, di_aggregation=<n>)_
// DI factory site hint — when getNeighbors returned empty AND
// filtered_di_aggregation > 0, the symbol's incoming edges were collapsed
// because they come from a DI-pattern file. Re-walk the BFS visited set
// directly to identify which DI source_file contributed the most edges so
// the drill-down points at a useful starting place instead of "empty."
// Returns the source_file path with collapsed-count, or null when no DI
// signal exists. Bounded: walks at most the same depth-2 visited set
// getNeighbors already populated.
function _findDIFactorySiteHint(symbol, direction, depth, neighborsResult) {
  if (!neighborsResult || !neighborsResult.filtered_di_aggregation) return null;
  try {
    const loaded = loadGraph();
    if (!loaded.ok) return null;
    const seedId = _resolveOne(loaded.cache.adj, symbol);
    if (!seedId) return null;
    const { visited } = _bfs(loaded.cache.adj, seedId, direction, depth);
    const DI_RE = _getDIAggregationPatterns();
    const diCounts = new Map();
    for (const [id, info] of visited) {
      if (id === seedId) continue;
      void info;
      const node = loaded.cache.adj.nodeMap.get(id);
      const src = node && node.source_file;
      if (!src || !DI_RE.test(src)) continue;
      diCounts.set(src, (diCounts.get(src) || 0) + 1);
    }
    if (diCounts.size === 0) return null;
    let topFile = null;
    let topCount = 0;
    for (const [file, count] of diCounts) {
      if (count > topCount) { topFile = file; topCount = count; }
    }
    return topFile ? `${topFile} (+${topCount} DI-wired edges)` : null;
  } catch { return null; }
}

function composeDrilldowns(symbols, options) {
  options = options || {};
  const direction = options.direction || "in";
  const depth = options.depth || 1;
  const limit = options.limit || 3;
  const targets = symbols.slice(0, limit);
  const lines = [];
  for (const sym of targets) {
    lines.push(`## Drill-down: ${sym} (direction=${direction}, depth=${depth})`);
    lines.push("");
    let r;
    try {
      r = getNeighbors(sym, { direction, depth });
    } catch (e) {
      lines.push(`_(error: ${e.message || String(e)})_`);
      lines.push("");
      continue;
    }
    if (!r || !Array.isArray(r.results) || r.results.length === 0) {
      // DI-aware fallback (cal #36 #4 from receipt #9): when 0 results
      // survived but filter telemetry shows DI-aggregation entries were
      // collapsed, the symbol IS reached — just via DI factory wiring
      // that the noise+collapse filters strip. Surface the DI factory
      // site explicitly instead of "empty" so reviewers know where to
      // look. Re-query the same neighbors with a higher max_bytes cap
      // AND no DI collapse for a moment, find the source_file with the
      // most edges matching DI patterns, and report it. Falls back to
      // the original "no neighbors" marker when no DI signal exists.
      const diHint = _findDIFactorySiteHint(sym, direction, depth, r);
      if (diHint) {
        lines.push(`_(no direct neighbors found in direction=${direction}; DI factory site: ${diHint})_`);
      } else {
        lines.push(`_(no neighbors found in direction=${direction})_`);
      }
    } else {
      for (const item of r.results) {
        const tags = [`relation=${item.relation || "?"}`, `depth=${item.depth}`];
        if (item.source_file) tags.push(`source_file=${item.source_file}`);
        if (item.di_aggregation_collapsed_count !== undefined) {
          tags.push(`+${item.di_aggregation_collapsed_count} DI-collapsed`);
        }
        lines.push(`- **${item.label}** (${tags.join(", ")})`);
      }
    }
    const filters = [];
    if (r && r.filtered_noise) filters.push(`noise=${r.filtered_noise}`);
    if (r && r.filtered_test_path) filters.push(`test_path=${r.filtered_test_path}`);
    if (r && r.filtered_di_aggregation) filters.push(`di_aggregation=${r.filtered_di_aggregation}`);
    if (filters.length > 0) {
      lines.push("");
      lines.push(`_(filtered: ${filters.join(", ")})_`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function laneSuggestions(diffFiles, options) {
  options = options || {};
  if (!Array.isArray(diffFiles) || diffFiles.length === 0) {
    return { mode: "fallback", groups: [], reason: "no input files" };
  }
  const loaded = loadGraph();
  if (!loaded.ok) {
    // Round 7 W6 — service-boundary works without a graph (purely path-
    // based heuristic). Projects with graphify disabled OR graphify enabled
    // but graph.json absent still benefit from semantic lane partitions
    // for service-oriented layouts. Falls through to legacy path-based
    // fallback when no service prefix matches >=80% of the diff.
    const sb = detectServiceBoundary(diffFiles);
    if (sb) {
      return {
        mode: "service_boundary",
        groups: sb.groups.map(g => ({ community: g.service, files: g.files })),
        reason: `graph not loaded — service-boundary heuristic (${sb.pattern}, ${(sb.coverage * 100).toFixed(0)}% coverage)`,
        covered_count: sb.matches,
        uncovered_count: diffFiles.length - sb.matches,
      };
    }
    return { mode: "fallback", groups: [], reason: "graph not loaded" };
  }
  const { nodeMap } = loaded.cache.adj;
  // Quick community-presence probe: scan first 100 nodes for any non-null
  // community attribute. Bails to fallback if clustering wasn't run.
  let sawCommunity = false;
  let nodesScanned = 0;
  for (const [, node] of nodeMap) {
    if (node && node.community !== undefined && node.community !== null) {
      sawCommunity = true;
      break;
    }
    if (++nodesScanned >= 100) break;
  }
  if (!sawCommunity) {
    // Round 7 W6 — try service-boundary auto-detect before falling back.
    // Field signal: an observed graph carried zero community attributes
    // (Q5 receipts: Client/AppError/etc. all returned degree-only schema).
    // Every parallel review reverted to legacy path-based partition, which
    // produced semantically broken lanes for service-oriented layouts. The
    // 80% coverage gate preserves graceful degradation for polyglot diffs
    // that don't fit a single prefix.
    const sb = detectServiceBoundary(diffFiles);
    if (sb) {
      return {
        mode: "service_boundary",
        groups: sb.groups.map(g => ({ community: g.service, files: g.files })),
        reason: `graph has no community attributes — service-boundary heuristic (${sb.pattern}, ${(sb.coverage * 100).toFixed(0)}% coverage)`,
        covered_count: sb.matches,
        uncovered_count: diffFiles.length - sb.matches,
      };
    }
    return { mode: "fallback", groups: [], reason: "graph has no community attributes" };
  }
  // Per-file: collect community counts across all matching nodes, pick the
  // mode. Files with no matching nodes flag a fallback so the orchestrator
  // doesn't silently drop them.
  const wantBasenames = new Set(diffFiles.map(f => path.basename(f)));
  const byFileCommunityCounts = new Map();
  for (const [, node] of nodeMap) {
    const sf = node && node.source_file;
    if (!sf) continue;
    const bn = path.basename(sf);
    if (!wantBasenames.has(bn)) continue;
    if (node.community === undefined || node.community === null) continue;
    if (!byFileCommunityCounts.has(bn)) byFileCommunityCounts.set(bn, new Map());
    const counts = byFileCommunityCounts.get(bn);
    counts.set(node.community, (counts.get(node.community) || 0) + 1);
  }
  // A strict-coverage check that requires 100% of diff files to have graph
  // nodes routes any diff with tests, migrations, or docs to full fallback
  // — observed pattern: roughly half the files in a typical PR lack nodes,
  // so community partition would never fire despite many files having
  // clean community labels.
  //
  // Now: full fallback only fires when ZERO files have nodes (graph
  // irrelevant for this diff). Partial coverage falls through to the
  // grouping logic below — covered files group by community, uncovered
  // files land in the "ungrouped" bucket (community: null). The mode
  // reports as "partial" when ANY file is uncovered, "community" when
  // all are covered.
  if (byFileCommunityCounts.size === 0) {
    return {
      mode: "fallback",
      groups: [],
      reason: "no diff file has graph nodes — graph irrelevant for this diff",
    };
  }
  const uncoveredCount = diffFiles.length - byFileCommunityCounts.size;
  const coverageRatio = byFileCommunityCounts.size / diffFiles.length;
  // Pick dominant community per file (max count wins).
  const fileToCommunity = new Map();
  for (const [bn, counts] of byFileCommunityCounts) {
    let bestC = null;
    let bestN = 0;
    for (const [c, n] of counts) {
      if (n > bestN) { bestC = c; bestN = n; }
    }
    fileToCommunity.set(bn, bestC);
  }
  // Group input files (preserve original path strings, not basenames).
  // Files without a community attribute previously collapsed into a single
  // "ungrouped" bucket; observed pattern: more than half the files in a
  // mixed code/hurl/docs/config PR land there, requiring manual reshape on
  // every multi-file review.
  //
  // Sub-classify the ungrouped bucket by file-extension archetype so
  // prose-only / test-only / config-only files cluster coherently.
  // Classifier runs ONLY on files without a community label; covered
  // files stay routed by their graph community. Archetypes:
  //   docs    — .md, .rst, .txt, .adoc, .mdx
  //   tests   — .hurl, paths containing /tests/ or _test or .test or .spec
  //   config  — .toml, .lock, .yaml, .yml, .json (not in src/), .ini, .env,
  //             VERSION, Makefile, Dockerfile, .gitignore, requirements.txt
  //   other   — falls back to legacy single "ungrouped" bucket
  const _archetype = (f) => {
    const p = f.toLowerCase();
    const bn = path.basename(p);
    if (/\.(md|rst|txt|adoc|mdx)$/.test(p)) return "docs";
    if (/\.hurl$/.test(p) || /\/tests?\//.test(p) || /\/__tests?__\//.test(p) ||
        /(^|[._-])(test|spec)([._-]|$)/.test(bn)) return "tests";
    if (/\.(toml|lock|yaml|yml|ini|env|cfg|conf)$/.test(p) ||
        bn === "version" || bn === "makefile" || bn === "dockerfile" ||
        bn === ".gitignore" || bn === "requirements.txt" || bn === "go.mod" ||
        bn === "cargo.toml" || bn === "package-lock.json" || bn === "pnpm-lock.yaml") return "config";
    return "other";
  };

  const groupsByCommunity = new Map();
  for (const f of diffFiles) {
    const c = fileToCommunity.get(path.basename(f));
    let key;
    if (c === null || c === undefined) {
      const arch = _archetype(f);
      key = arch === "other" ? "ungrouped" : `archetype:${arch}`;
    } else {
      key = String(c);
    }
    if (!groupsByCommunity.has(key)) {
      const meta = { community: c, files: [] };
      if (key.startsWith("archetype:")) meta.archetype = key.slice("archetype:".length);
      groupsByCommunity.set(key, meta);
    }
    groupsByCommunity.get(key).files.push(f);
  }
  let groups = Array.from(groupsByCommunity.values())
    .sort((a, b) => b.files.length - a.files.length);

  // Consolidate to target_lanes super-groups via path-prefix similarity
  // when raw count exceeds target. Anchors are the top-N by file count;
  // each remaining group merges into its best anchor.
  let consolidationMeta = null;
  const targetLanes = Number.isInteger(options.targetLanes) && options.targetLanes > 0
    ? options.targetLanes : null;
  if (targetLanes && groups.length > targetLanes) {
    const rawGroupCount = groups.length;
    const anchors = groups.slice(0, targetLanes).map(g => ({
      community: g.community,
      files: g.files.slice(),
      mergedCommunities: [g.community],
    }));
    const leftovers = groups.slice(targetLanes);
    for (const lg of leftovers) {
      // Pick the anchor whose files share the longest common path prefix with
      // this leftover group's files. Cheap proxy for graph-distance — matches
      // the manual domain-based consolidation pattern of grouping by
      // top-level path component.
      let bestAnchor = anchors[0];
      let bestScore = -1;
      for (const a of anchors) {
        const score = _avgPrefixSimilarity(a.files, lg.files);
        if (score > bestScore) { bestScore = score; bestAnchor = a; }
      }
      bestAnchor.files.push(...lg.files);
      bestAnchor.mergedCommunities.push(lg.community);
    }
    groups = anchors.map(a => ({
      community: a.community,
      files: a.files,
      merged_from_communities: a.mergedCommunities,
    }));
    consolidationMeta = {
      raw_group_count: rawGroupCount,
      target_lanes: targetLanes,
      consolidated_to: groups.length,
    };
  }

  if (uncoveredCount > 0) {
    // Skew check: if the largest group dominates the covered scope (>40%),
    // the partition is too skewed to drive parallelism — one lane would do
    // most of the work while others sit nearly idle. Downgrade to
    // mode=fallback with a reason so the orchestrator falls back to
    // path-based partitioning instead of accepting the bad partition.
    // Threshold 0.40 chosen against observed pathology: a single dominant
    // group plus a handful of noise buckets approaching ~95% skew on a
    // small-lane request.
    const SKEW_THRESHOLD = 0.40;
    const totalCovered = groups.reduce((s, g) => s + g.files.length, 0);
    const maxGroup = groups.reduce((m, g) => Math.max(m, g.files.length), 0);
    const skewRatio = totalCovered > 0 ? maxGroup / totalCovered : 0;
    if (skewRatio > SKEW_THRESHOLD) {
      return {
        mode: "fallback",
        groups: [],
        reason: `partial-coverage partition too skewed (largest group ${maxGroup}/${totalCovered}=${(skewRatio * 100).toFixed(0)}% of covered scope, > ${(SKEW_THRESHOLD * 100).toFixed(0)}% threshold); orchestrator should use path-based fallback`,
        skew_ratio: Number(skewRatio.toFixed(4)),
        coverage_ratio: Number(coverageRatio.toFixed(4)),
      };
    }
    const result = {
      mode: "partial",
      groups,
      covered_count: byFileCommunityCounts.size,
      uncovered_count: uncoveredCount,
      coverage_ratio: Number(coverageRatio.toFixed(4)),
    };
    if (consolidationMeta) result.consolidation = consolidationMeta;
    return result;
  }
  const result = { mode: "community", groups };
  if (consolidationMeta) result.consolidation = consolidationMeta;
  return result;
}

// Helper: average longest-common-prefix similarity between two file-path
// sets. Higher = more similar. Used by lane-suggestions consolidation to
// pick which anchor a leftover community merges into. Computes per-pair
// LCP-depth, averages over a sample (cap at 20×20 = 400 pairs to bound
// cost on large lanes).
function _avgPrefixSimilarity(filesA, filesB) {
  const sa = filesA.slice(0, 20);
  const sb = filesB.slice(0, 20);
  if (sa.length === 0 || sb.length === 0) return 0;
  let totalDepth = 0;
  let pairs = 0;
  for (const a of sa) {
    const aParts = a.split("/");
    for (const b of sb) {
      const bParts = b.split("/");
      let depth = 0;
      const min = Math.min(aParts.length, bParts.length) - 1; // exclude filename
      for (let i = 0; i < min; i++) {
        if (aParts[i] === bParts[i]) depth++;
        else break;
      }
      totalDepth += depth;
      pairs++;
    }
  }
  return pairs === 0 ? 0 : totalDepth / pairs;
}

// Top-N non-noise symbols whose source_file is in the diff. Used by
// code-review.md's bulk_scoped tier (B-XI) to convert "scope > 10 files +
// dense graph" into a symbol_anchored blast_radius call instead of a less
// useful query_graph text search. For dense graphs with >10 files,
// query_graph(text=REVIEW_SCOPE) returns keyword matches that don't reflect
// the call graph. blast_radius with diff-derived symbols produces actual
// structural impact.
//
// Returns envelope: { symbols: [{symbol, source_file, edge_count}], reason,
// graph_lag_commits, total_matches }. Symbols sorted desc by edge_count, with
// file/concept/json-key nodes filtered out. Defaults to limit=10 (matches
// blast_radius's typical comfortable input size). Prior shape was a bare
// array which silently collapsed three distinct states ([] for "no input",
// "graph not loaded", "no matching nodes") into the same caller
// observation. Envelope shape disambiguates: reason explains WHY symbols is
// empty when it is, graph_lag_commits lets the orchestrator decide whether
// to re-index before trusting the answer, and total_matches preserves the
// "limit truncated" signal.
// Normalize a path for cross-source matching: backslash→slash, strip leading
// "./", collapse repeated slashes. Used by _pathSuffixMatch.
function _normPath(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

// Segment-boundary suffix match. True when a===b OR one is a path-segment
// suffix of the other — so `app/services/x/models.py` matches the graph's
// `x/models.py` (package-relative) and `/abs/app/services/x/models.py`
// (absolute), but NOT `app/services/y/models.py` (different module). Replaces
// the prior `path.basename()` match that pulled symbols from EVERY same-named
// file across the repo. graphify source_file rooting is uncontrolled (varies
// by graphify version: repo-relative / absolute / package-relative), so an
// exact full-path compare would break matching on absolute-path graphs — see
// the devt-stays-general guardrail.
function _pathSuffixMatch(a, b) {
  const na = _normPath(a);
  const nb = _normPath(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.endsWith("/" + nb)) return true;
  if (nb.endsWith("/" + na)) return true;
  return false;
}

// Defensive source_location → line-number parse. graphify versions emit
// varying shapes ("L33", "33", 33, {line:33}, {start_line:33}, {start:33},
// nested). Returns the line number, or null when unparseable. Callers MUST
// treat null as "unknown — keep the symbol" (never drop a symbol just because
// its location couldn't be parsed; that would silently lose real targets).
function _parseSourceLine(loc) {
  if (loc == null) return null;
  if (typeof loc === "number") return Number.isFinite(loc) ? loc : null;
  if (typeof loc === "string") {
    const m = loc.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }
  if (typeof loc === "object") {
    for (const k of ["line", "start_line", "start", "lineno", "row", "begin"]) {
      const v = loc[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") { const m = v.match(/(\d+)/); if (m) return parseInt(m[1], 10); }
      if (v && typeof v === "object") { const inner = _parseSourceLine(v); if (inner != null) return inner; }
    }
  }
  return null;
}

// Parse `git diff -U0 <baseRef>...HEAD` into per-file new-file changed-line
// ranges: Map<normalizedPath, Array<[startLine, endLine]>>. Hunk-scoping uses
// this so only symbols DEFINED on changed lines anchor blast_radius — not
// every symbol in a touched file (the root cause of god-node burial: a 1-line
// tweak to errors.py surfaced AppError because AppError is defined there).
// Best-effort: git failure / no baseRef → empty map → callers degrade to
// no hunk-scoping (full-path-matched set, still far better than basename).
function _changedHunkRanges(baseRef) {
  const ranges = new Map();
  if (!baseRef || !/^[A-Za-z0-9_./~^@-]{1,100}$/.test(baseRef)) return ranges;
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync("git", ["diff", "-U0", `${baseRef}...HEAD`], {
      cwd: findProjectRoot(), encoding: "utf8", timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 * 1024 * 1024,
    });
    let curFile = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("+++ ")) {
        const p = line.slice(4).replace(/^b\//, "").trim();
        curFile = (p === "/dev/null") ? null : _normPath(p);
        if (curFile && !ranges.has(curFile)) ranges.set(curFile, []);
      } else if (curFile && line.startsWith("@@")) {
        // "@@ -a,b +c,d @@" → new-file changed range [c, c+d-1]; d defaults to 1
        const m = line.match(/\+(\d+)(?:,(\d+))?/);
        if (m) {
          const start = parseInt(m[1], 10);
          const count = m[2] !== undefined ? parseInt(m[2], 10) : 1;
          if (count > 0) ranges.get(curFile).push([start, start + count - 1]);
        }
      }
    }
  } catch { /* git unavailable / no diff → empty map (no hunk-scoping) */ }
  return ranges;
}

// Find changed-line ranges for a graph source_file path, tolerant of rooting
// differences between the graph path and the diff path (same suffix-match
// logic as node matching). Returns the ranges array or null.
function _hunkRangesForFile(nsf, hunkRanges) {
  if (hunkRanges.has(nsf)) return hunkRanges.get(nsf);
  for (const [k, v] of hunkRanges) {
    if (_pathSuffixMatch(nsf, k)) return v;
  }
  return null;
}

function _lineInRanges(line, rangesForFile, slack) {
  if (line == null || !Array.isArray(rangesForFile)) return false;
  const s = slack || 0;
  for (const [lo, hi] of rangesForFile) {
    if (line >= lo - s && line <= hi + s) return true;
  }
  return false;
}

function symbolsInFiles(diffFiles, limit = 10, opts = {}) {
  if (!Array.isArray(diffFiles) || diffFiles.length === 0) {
    return { symbols: [], reason: "no input files", graph_lag_commits: null, total_matches: 0 };
  }
  const loaded = loadGraph();
  if (!loaded.ok) {
    return { symbols: [], reason: "graph not loaded", graph_lag_commits: null, total_matches: 0 };
  }
  // Cheap freshness probe — read built_at_commit + HEAD without re-parsing
  // the graph. freshness() itself caches the result.
  let lagCommits = null;
  try {
    const f = freshness();
    lagCommits = (f && typeof f.lag_commits === "number") ? f.lag_commits : null;
  } catch { /* leave null */ }
  const { nodeMap, inc, out } = loaded.cache.adj;
  const wantPaths = diffFiles.map(f => _normPath(f));
  const matchedFiles = new Set();   // normalized graph source_file paths that matched a diff file
  // Hunk-scoping: when a base ref is supplied, restrict to symbols whose
  // definition line falls in a changed hunk. Graceful degradation throughout:
  // empty hunk map (no baseRef / git failure) → no scoping; per-file no-hunks
  // → keep all that file's symbols; unparseable source_location → keep symbol.
  const hunkRanges = opts.baseRef ? _changedHunkRanges(opts.baseRef) : new Map();
  const hunkScopingActive = hunkRanges.size > 0;
  const HUNK_SLACK = 5;   // decorators/multi-line def signatures above the def line
  const seen = new Set(); // dedup by symbol label (blast_radius args are names)
  let hunkFilteredCount = 0;
  const results = [];
  for (const [id, node] of nodeMap) {
    const sf = node && node.source_file;
    if (!sf) continue;
    const nsf = _normPath(sf);
    if (!wantPaths.some(wp => _pathSuffixMatch(nsf, wp))) continue;
    matchedFiles.add(nsf);
    const degree = (inc.get(id) || []).length + (out.get(id) || []).length;
    if (_isFileNode(node, degree)) continue;
    if (_isConceptNode(node)) continue;
    if (_isJsonKeyNode(node)) continue;
    // Hunk-scope: keep the symbol only if its def-line is in a changed hunk.
    // When the file has changed-line ranges AND the symbol's line is known
    // AND it's outside every range → drop (it's "in a touched file" but not
    // "what changed"). Otherwise keep.
    if (hunkScopingActive) {
      const fileRanges = _hunkRangesForFile(nsf, hunkRanges);
      if (fileRanges && fileRanges.length > 0) {
        const ln = _parseSourceLine(node.source_location);
        if (ln != null && !_lineInRanges(ln, fileRanges, HUNK_SLACK)) {
          hunkFilteredCount++;
          continue;
        }
      }
    }
    const label = node.label || id;
    if (seen.has(label)) continue;   // dedup (fixes EventBusDep-twice)
    seen.add(label);
    results.push({
      symbol: label,
      source_file: sf,
      edge_count: degree,
    });
  }
  results.sort((a, b) => b.edge_count - a.edge_count);

  // G5 (cal #31.B) — Diff-hunk symbol fallback. Receipt #5 Q4: when files in
  // the diff are NEWLY ADDED, the graph (rebuilt at last commit) has no nodes
  // for them, so symbols-in-files returns [] for the highest-risk subset —
  // forcing the workflow to fall back to noisy topic-text symbols. The
  // 80/20 fix per receipt: regex-extract symbol-introducing keywords from
  // the file contents directly. No tree-sitter, no graph rebuild — just
  // identifier-introducing keyword matches across Python/TS/JS/Go/Rust.
  // Synthesized symbols carry source="diff-hunk" + edge_count=null so
  // consumers can distinguish them from graph-derived results.
  const fallbackSymbols = [];
  const filesWithoutNodes = [];
  let fallbackFilesScanned = 0;
  let fallbackUbiquitousFiltered = 0;
  // Shared ubiquitous-type stoplist applied to the new-file fallback. The
  // graph has no nodes for un-indexed files, so hunk-scoping can't anchor
  // them — every regex-extracted declaration is included. A declaration whose
  // NAME matches a ubiquitous graph god-node is noise as a blast anchor (it
  // pulls the god-node's whole blast set), so the same stoplist that quiets
  // god-node warnings drops it here. Force-keep ("!"-prefixed config entries)
  // are honored via _getUbiquitousTypeSet's exemption.
  const fallbackUbiquitous = _getUbiquitousTypeSet(loaded.cache.adj);
  for (const file of diffFiles) {
    const nf = _normPath(file);
    // Skip files the graph already covered (any matched source_file
    // suffix-matches this diff file). For a genuinely new/un-indexed file,
    // no graph node matched → regex-extract its declared symbols.
    let covered = false;
    for (const mf of matchedFiles) { if (_pathSuffixMatch(mf, nf)) { covered = true; break; } }
    if (covered) continue;
    // Corpus-blind: the graph carries NO node for this changed CODE file
    // (upstream token-filter exclusion or never indexed). The regex fallback
    // below still extracts anchor names, but every graph query about this
    // file's symbols returns silence — consumers must treat that as blindness,
    // not safety. Prose/config files are excluded: the graph never indexes
    // them, so listing them would cry wolf on every diff.
    if (/\.(py|js|jsx|ts|tsx|go|rs|rb|java|kt|cs|php|swift|scala|c|cc|cpp|h|hpp)$/i.test(file)) {
      filesWithoutNodes.push(file);
    }
    const extracted = _extractSymbolsFromFile(file);
    if (extracted.length === 0) continue;
    fallbackFilesScanned++;
    for (const sym of extracted) {
      if (seen.has(sym)) continue;   // dedup across graph-results + fallback
      if (fallbackUbiquitous.has(sym.toLowerCase())) { fallbackUbiquitousFiltered++; continue; }
      seen.add(sym);
      fallbackSymbols.push({
        symbol: sym,
        source_file: file,
        edge_count: null,
        source: "diff-hunk",
      });
    }
  }

  const totalMatches = results.length + fallbackSymbols.length;
  const cap = Math.max(1, Math.min(limit, 200));
  // Graph-derived results rank first (have degree info); fallback last (no
  // degree, but better than nothing). Within fallback, preserve file order.
  const allSymbols = [...results, ...fallbackSymbols];
  const symbols = allSymbols.slice(0, cap);
  let reason;
  if (totalMatches === 0) {
    reason = lagCommits !== null && lagCommits > 30
      ? `no nodes in graph for these files (graph_lag_commits=${lagCommits} — likely stale; consider 'graphify update .')`
      : "no nodes in graph for these files";
  } else if (results.length === 0) {
    reason = `graph empty for these files — diff-hunk fallback extracted ${fallbackSymbols.length} symbols from ${fallbackFilesScanned} added/un-indexed file(s)`;
  } else if (fallbackSymbols.length > 0) {
    reason = totalMatches > cap
      ? `truncated to limit=${cap} of ${totalMatches} total matches (${fallbackSymbols.length} from diff-hunk fallback)`
      : `ok (${fallbackSymbols.length} from diff-hunk fallback for un-indexed files)`;
  } else {
    reason = totalMatches > cap ? `truncated to limit=${cap} of ${totalMatches} total matches` : "ok";
  }
  const envelope = { symbols, reason, graph_lag_commits: lagCommits, total_matches: totalMatches };
  // matched_files: normalized graph source_file paths that suffix-matched a
  // diff file. Consumed by computeGraphifyImpactPlan to reconcile the
  // "N files not indexed" caveat against reality (a diff file is genuinely
  // un-indexed only if NO graph node matched it — not just because git flags
  // it as added). hunk telemetry surfaced per the telemetry-on-reduction
  // principle: never drop symbols silently.
  envelope.matched_files = Array.from(matchedFiles);
  if (hunkScopingActive) {
    envelope.hunk_scoped = true;
    if (hunkFilteredCount > 0) envelope.hunk_filtered = hunkFilteredCount;
  }
  if (fallbackUbiquitousFiltered > 0) envelope.fallback_ubiquitous_filtered = fallbackUbiquitousFiltered;
  if (filesWithoutNodes.length > 0) envelope.files_without_nodes = filesWithoutNodes;
  return envelope;
}

/**
 * resolveExactSymbols — validate candidate anchor labels against the graph.
 * A label resolves only when a node carries EXACTLY that label AND a real
 * source_file. Dangling label-only nodes (edge-endpoint orphans left behind by
 * upstream corpus exclusion) do NOT count — anchoring blast_radius on one
 * yields a garbage neighborhood (field receipt: "TokenService" resolved to an
 * orphan whose only neighbors were docstring nodes in an unrelated module),
 * and prose words that match no node ("TTL", "ENV") must never become anchors.
 */
function resolveExactSymbols(labels) {
  const out = { resolved: [], unresolved: [] };
  if (!Array.isArray(labels) || labels.length === 0) return out;
  const loaded = loadGraph();
  if (!loaded.ok) {
    out.unresolved = labels.map(l => ({ label: l, reason: "graph_not_loaded" }));
    return out;
  }
  const byLabel = new Map();
  for (const [, node] of loaded.cache.adj.nodeMap) {
    const lb = node && node.label;
    if (!lb) continue;
    if (!byLabel.has(lb)) byLabel.set(lb, []);
    byLabel.get(lb).push(node);
  }
  for (const l of labels) {
    const nodes = byLabel.get(l) || [];
    if (nodes.some(n => n.source_file)) out.resolved.push(l);
    else if (nodes.length > 0) out.unresolved.push({ label: l, reason: "dangling_no_source_file" });
    else out.unresolved.push({ label: l, reason: "no_exact_node" });
  }
  return out;
}

/**
 * manifestFreshness — per-file freshness via graphify's own build manifest.
 * The manifest records {mtime, ast_hash, semantic_hash} per relative path at
 * build time. A scope file whose disk mtime equals the manifest mtime is what
 * the graph indexed — FRESH regardless of commit lag (working-tree flows have
 * no usable built_at anchor; the lag model told a reviewer to distrust a graph
 * rebuilt 90 minutes earlier from the exact files under review). ast_hash is
 * graphify's own hasher and is NOT recomputed here — mtime drift degrades to
 * "drifted" (unverified), never to a false fresh. Paths resolve relative to
 * cwd, mirroring loadGraph()'s cwd-based convention.
 */
function manifestFreshness(files) {
  const outDir = getGraphifyOutDir();
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8")); }
  catch { return { available: false }; }
  const res = { available: true, checked: 0, matched: 0, drifted: [], missing_from_manifest: [] };
  for (const f of Array.isArray(files) ? files : []) {
    const entry = manifest[f] || manifest[_normPath(f)];
    if (!entry || typeof entry.mtime !== "number") { res.missing_from_manifest.push(f); continue; }
    res.checked++;
    try {
      const st = fs.statSync(f);
      if (Math.abs(st.mtimeMs / 1000 - entry.mtime) < 0.002) res.matched++;
      else res.drifted.push(f);
    } catch { res.drifted.push(f); }
  }
  res.all_matched = res.checked > 0 && res.drifted.length === 0 && res.missing_from_manifest.length === 0;
  return res;
}

// G5 (cal #31.B) — Identifier-introducing keyword extractor. Covers
// Python/TS/JS/Go/Rust syntax for symbol-anchor lookup on un-indexed files.
// Bounded reads (~50KB) keep latency negligible. Per-file symbol cap (20)
// prevents one mega-file from dominating the fallback set. NOT meant to be
// a full parser — false positives on identifiers in comments/strings are
// acceptable; they're harmless extra blast_radius anchors.
const _MAX_FILE_READ_BYTES = 50000;
const _MAX_SYMBOLS_PER_FILE = 20;
const _SYMBOL_INTRO_RE = /(?:^|\n)(?:\s{0,12})(?:export\s+)?(?:async\s+)?(?:public\s+|private\s+|protected\s+)?(?:class|function|interface|struct|enum|trait|fn|def|type)\s+([A-Za-z_]\w{2,})/g;

function _extractSymbolsFromFile(filePath) {
  try {
    const fs = require("fs");
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return [];
    const readBytes = Math.min(stat.size, _MAX_FILE_READ_BYTES);
    const fd = fs.openSync(filePath, "r");
    let content;
    try {
      const buf = Buffer.alloc(readBytes);
      fs.readSync(fd, buf, 0, readBytes, 0);
      content = buf.toString("utf-8");
    } finally {
      fs.closeSync(fd);
    }
    const seen = new Set();
    const symbols = [];
    let m;
    _SYMBOL_INTRO_RE.lastIndex = 0;
    while ((m = _SYMBOL_INTRO_RE.exec(content)) !== null) {
      const name = m[1];
      if (!seen.has(name)) {
        seen.add(name);
        symbols.push(name);
        if (symbols.length >= _MAX_SYMBOLS_PER_FILE) break;
      }
    }
    return symbols;
  } catch {
    return []; // ENOENT, permission denied, etc. — fallback gracefully
  }
}

// Symbol-level companion to `checkLargeFilesGodNodes`. The file-level check
// collapses to one max-degree symbol per basename — when a high-degree symbol
// lives alongside the file's dominant symbol it can be eclipsed and never
// surface independently. This check reports every symbol whose `source_file`
// is in the diff AND whose degree clears `edgeThreshold`, with no per-file
// aggregation. Independent of `topic.symbols`, so high-degree symbols missing
// from the anchor list still surface.
//
// Returns [{symbol, source_file, edge_count, is_god_node}] sorted by
// edge_count desc, already filtered to is_god_node=true.
// Known non-monotonic aggregation bug in some environments. Observed
// pattern on a 5-file diff: subsets of size <4 can silently lose god-node
// entries while N≥4 returns correct results and is order-invariant.
//
// Code-level inspection (this function): single-pass Set lookup over
// nodeMap; no obvious non-monotonic logic. The divergence between
// environments strongly suggests graph-state dependency (cached nodeMap
// topology, ordering, or `loadGraph()` return shape varying across
// rebuilds). Defer code fix until reproducible. If you encounter this in
// field:
//   1. Capture the input file list + edge_threshold + full CLI output
//   2. Capture graphify status (built_at SHA, node_count, edge_count)
//   3. Run the same args after `graphify rebuild` and compare
//   4. If the result changes across rebuilds, the bug is graph-state coupled
//      (likely in loadGraph or the nodeMap iteration); if it persists, the
//      bug is in this function's Set/iteration logic.
function checkSymbolLevelGodNodes(diffFiles, edgeThreshold = 50) {
  if (!Array.isArray(diffFiles) || diffFiles.length === 0) return [];
  const loaded = loadGraph();
  if (!loaded.ok) return [];
  const { nodeMap, inc, out } = loaded.cache.adj;
  const wantBasenames = new Set(diffFiles.map(f => path.basename(f)));
  const results = [];
  for (const [id, node] of nodeMap) {
    const sf = node && node.source_file;
    if (!sf || !wantBasenames.has(path.basename(sf))) continue;
    const degree = (inc.get(id) || []).length + (out.get(id) || []).length;
    if (degree < edgeThreshold) continue;
    if (_isFileNode(node, degree)) continue;
    if (_isConceptNode(node)) continue;
    if (_isJsonKeyNode(node)) continue;
    results.push({
      symbol: node.label || id,
      source_file: sf,
      edge_count: degree,
      is_god_node: true,
    });
  }
  results.sort((a, b) => b.edge_count - a.edge_count);
  return results;
}

/**
 * Return nodes belonging to a single graphify community. The Leiden clustering
 * step writes a `community: <int>` attribute on every node — same field used by
 * graphify's upstream MCP `get_community` tool. Use case: when graph-impact.md
 * surfaces affected communities for a review, the reviewer can ask "what other
 * files belong to community 42?" to scope follow-up checks.
 *
 * Returns {source, results: [{id, label, source_file, degree}], degraded?, fallback_trigger?}
 * — same envelope shape as the other read wrappers so consumers can branch
 * uniformly on `degraded`. Result is capped by `limit` (default 50, max 200);
 * nodes sorted by degree desc so the highest-leverage members lead.
 */
function getCommunity(communityId, options = {}) {
  const loaded = loadGraph();
  if (!loaded.ok) {
    return { source: "grep", results: [], degraded: true, fallback_trigger: loaded.degraded.fallback_trigger };
  }
  if (communityId === null || communityId === undefined) {
    return { source: "graphify", results: [], degraded: true, fallback_trigger: "invalid_arg" };
  }
  // Accept both integer and stringified-integer community ids. Reject anything else.
  const idNum = typeof communityId === "number" ? communityId : parseInt(communityId, 10);
  if (!Number.isFinite(idNum)) {
    return { source: "graphify", results: [], degraded: true, fallback_trigger: "invalid_arg" };
  }
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 200);
  const matches = [];
  for (const n of loaded.cache.nodes) {
    if (!n || n.community === undefined || n.community === null) continue;
    if (n.community === idNum || n.community === String(idNum)) {
      const adj = loaded.cache.adj;
      const outEdges = (adj.out.get(n.id) || []).length;
      const inEdges = (adj.inc.get(n.id) || []).length;
      matches.push({
        id: n.id,
        label: n.label || n.id,
        source_file: n.source_file || null,
        degree: outEdges + inEdges,
      });
    }
  }
  matches.sort((a, b) => b.degree - a.degree);
  return { source: "graphify", results: matches.slice(0, limit) };
}

// Hyperedges are graphify's machine-discovered "design plans" — semantic
// groupings that span multiple files (route + service + repo + readme +
// test). When a task's symbols/paths overlap any hyperedge's member set,
// lifting ALL members into preflight's symbol channel auto-catches the
// "fixed code, forgot the readme/test/migration" failure mode. Each
// hyperedge is a high-confidence (≥0.85) cross-file binding.
//
// Returns hyperedges whose `nodes[]` intersects ANY input symbol or
// source_file. Mirrors the shape of laneSuggestions / checkLargeFilesGodNodes
// — load graph, scan, return structured payload, no MCP write.
function getHyperedgesContaining(symbols, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 10, 1), 50);
  const loaded = loadGraph();
  if (!loaded.ok) {
    return { source: "grep", results: [], degraded: true, fallback_trigger: loaded.degraded.fallback_trigger };
  }
  const graph = loaded.cache.graph || {};
  const hyperedges = Array.isArray(graph.hyperedges) ? graph.hyperedges
                   : (graph.graph && Array.isArray(graph.graph.hyperedges) ? graph.graph.hyperedges : []);
  if (hyperedges.length === 0) {
    return { source: "graphify", results: [], reason: "no_hyperedges_in_graph" };
  }
  const wantedLowered = new Set();
  for (const s of (Array.isArray(symbols) ? symbols : [])) {
    if (typeof s === "string" && s.length > 0) wantedLowered.add(s.toLowerCase());
  }
  if (wantedLowered.size === 0) {
    return { source: "graphify", results: [], reason: "no_input_symbols" };
  }
  // Build node-id → source_file + label lookup so we can intersect against
  // both symbol-name matches AND source-file matches in one pass.
  const nodeMeta = new Map();
  for (const n of loaded.cache.nodes) {
    if (!n || !n.id) continue;
    nodeMeta.set(n.id, {
      label: (n.label || "").toLowerCase(),
      source_file: (n.source_file || "").toLowerCase(),
    });
  }
  const matches = [];
  for (const h of hyperedges) {
    if (!h || !Array.isArray(h.nodes)) continue;
    const overlap = [];
    for (const nodeId of h.nodes) {
      const meta = nodeMeta.get(nodeId);
      if (!meta) continue;
      // Match if node label or source_file is wanted (case-insensitive,
      // basename for path matches).
      const labelHit = meta.label && wantedLowered.has(meta.label);
      const idHit = wantedLowered.has(nodeId.toLowerCase());
      const fileHit = meta.source_file && wantedLowered.has(meta.source_file);
      if (labelHit || idHit || fileHit) overlap.push(nodeId);
    }
    if (overlap.length > 0) {
      matches.push({
        id: h.id,
        label: h.label || h.id,
        member_count: h.nodes.length,
        members: h.nodes,
        members_in_scope: overlap,
        completeness: Number((overlap.length / h.nodes.length).toFixed(2)),
        confidence: h.confidence || null,
        confidence_score: h.confidence_score || null,
        source_file: h.source_file || null,
        relation: h.relation || null,
        // Cal #32.A (field receipt follow-up): hyperedge
        // rationale was being silently dropped. graph.json::hyperedges[]
        // carries it (alongside label) — graphify's standard query/MCP
        // tools (DFS/BFS, query_graph, get_node) skip the hyperedges array
        // entirely, so devt's direct-read bypass was the right approach
        // for discoverability — but it dropped the rationale field at
        // the projection. Surfacing it now means hyperedges_matched[]
        // carries the "why these N files belong together" signal to
        // reviewers without requiring the graphify-upstream fix
        // (encoding rationale as rationale_for edges from each node).
        rationale: h.rationale || null,
      });
    }
  }
  // Highest completeness first so reviewers see "most overlapping" hyperedges
  // when triaging.
  matches.sort((a, b) => b.completeness - a.completeness);
  return { source: "graphify", results: matches.slice(0, limit) };
}

/**
 * Summary statistics over graph.json for the trust-gate consumer. Uses the
 * Phase A loader cache so this is O(1) after the first parse. Trust thresholds:
 *   - empty: 0 nodes (graph generation never ran or produced nothing)
 *   - sparse: < 50 nodes OR density (edges/nodes) < 1
 *   - dense:  ≥ 50 nodes AND density ≥ 1
 *
 * Agents and workflows consume `trust` to decide whether to weight blast_radius
 * and scope_hint signals. Sparse graphs typically reflect partial indexing
 * (graphify hasn't finished, or language coverage is poor) — derived signals
 * are unreliable in that state.
 */
// C-III.1 (field review report): the legacy direct_dependents
// threshold was hardcoded `>= 10` across quick-implement.md + dev-workflow.md.
// For a 45K-node graph (large-project scale), 10 is roughly right; for a
// 5K-node graph it's too high — many edits touch 3-9 dependents that would
// benefit from a blast map. Scale with graph size: max(5, log10(node_count) * 2).
//   100 nodes  → max(5, 4)  = 5
//   1000 nodes → max(5, 6)  = 6
//   10000 nodes → max(5, 8) = 8
//   45000 nodes → max(5, 10) = 10  (large-graph baseline)
//   100000 nodes → max(5, 10) = 10
// Floor at 5 prevents trivially-small graphs from triggering scan-prep on
// 2-3 dependent counts. node_count = 0 (graph not ready) falls back to 5.
function adaptiveImpactThreshold(nodeCount) {
  const n = Number.isFinite(nodeCount) && nodeCount > 0 ? nodeCount : 0;
  if (n === 0) return 5;
  return Math.max(5, Math.ceil(Math.log10(n) * 2));
}

function graphStats() {
  const loaded = loadGraph();
  if (!loaded.ok) {
    return {
      state: loaded.degraded.state || "not_ready",
      node_count: 0,
      edge_count: 0,
      density: null,
      trust: "empty",
      has_communities: null,
    };
  }
  const nodeCount = loaded.cache.adj.nodeMap.size;
  const edgeCount = (loaded.cache.links || []).length;
  const density = nodeCount > 0 ? edgeCount / nodeCount : 0;
  let trust;
  if (nodeCount === 0) trust = "empty";
  else if (nodeCount < 50 || density < 1) trust = "sparse";
  else trust = "dense";
  // Round 7 W6b — probe first 100 nodes for any non-null `community`
  // attribute. Same probe as laneSuggestions so surfaces stay consistent.
  // null when graph not loaded; false when probed and absent; true when
  // present. Preflight surfaces a Brief warning when ready+false so
  // operators know parallel-review will route via service-boundary or
  // path-based fallback rather than Leiden communities.
  let hasCommunities = false;
  let scanned = 0;
  for (const [, node] of loaded.cache.adj.nodeMap) {
    if (node && node.community !== undefined && node.community !== null) {
      hasCommunities = true;
      break;
    }
    if (++scanned >= 100) break;
  }
  return { state: "ready", node_count: nodeCount, edge_count: edgeCount, density, trust, has_communities: hasCommunities };
}

// ---------------------------------------------------------------------------
// CLI dispatcher
// ---------------------------------------------------------------------------

// CLI-side trace records for the drill-down-bearing subcommands. The
// documented oversize fallback ("re-run via CLI with --max-bytes when an MCP
// response overflows") previously produced ZERO trace evidence, so a
// drill-down legitimately built from CLI output was indistinguishable from a
// hand-typed one — assert-graphify-decision counts get_neighbors trace
// records and flagged such runs as fabricated. Record shape and telemetry
// kill switch (memory.mcp_telemetry) mirror the MCP servers'; the cli__
// tool names still match the gate's /graphify.*get_neighbors/ matcher.
// Returns the correlation_id (so the CLI response can carry _meta and
// drill-down headings can cite `[call: <id>]` exactly like MCP responses),
// or null when tracing is off/unavailable. Best-effort: a trace failure
// must never affect CLI output or exit code.
function appendCliTrace(toolName, result, args, startedMs) {
  try {
    const { getMergedConfig } = require("./config.cjs");
    const cfg = getMergedConfig();
    if (cfg.memory && cfg.memory.mcp_telemetry === false) return null;
    const root = findProjectRoot();
    const tracePath = path.join(root, ".devt", "memory", "_mcp-trace.jsonl");
    if (!fs.existsSync(path.dirname(tracePath))) return null;
    let workflow_id = null, workflow_type = null, phase = null;
    try {
      const y = fs.readFileSync(path.join(root, ".devt", "state", "workflow.yaml"), "utf8");
      workflow_id = ((y.match(/^workflow_id:\s*"?([^"\n\r]+)"?\s*$/m) || [])[1] || "").trim() || null;
      workflow_type = ((y.match(/^workflow_type:\s*"?([^"\n\r]+)"?\s*$/m) || [])[1] || "").trim() || null;
      phase = ((y.match(/^phase:\s*"?([^"\n\r]+)"?\s*$/m) || [])[1] || "").trim() || null;
    } catch { /* no active workflow — context fields stay null */ }
    const crypto = require("crypto");
    let argsStr = "{}";
    try { argsStr = JSON.stringify(args || {}); } catch { /* keep {} */ }
    let resultSize = 0;
    try { resultSize = JSON.stringify(result, null, 2).length; } catch { /* keep 0 */ }
    const correlationId = crypto.randomBytes(4).toString("hex");
    const rec = {
      workflow_id, workflow_type, phase,
      ts: new Date().toISOString(),
      tool: toolName,
      ok: !(result && typeof result === "object" && result.error),
      error_code: result && typeof result === "object" && result.error ? "TOOL_ERROR" : null,
      duration_ms: Date.now() - startedMs,
      args_size: argsStr.length,
      args_fp: crypto.createHash("sha256").update(argsStr).digest("hex").slice(0, 12),
      result_size: resultSize,
      correlation_id: correlationId,
      session: process.env.CLAUDE_SESSION_ID || `pid-${process.pid}`,
    };
    fs.appendFileSync(tracePath, JSON.stringify(rec) + "\n", "utf8");
    return correlationId;
  } catch { return null; }
}

function run(subcommand, args) {
  const json = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");

  // Sensitive-path denylist. Refuses CLI file args matching credential / key /
  // secret patterns (caveman is_sensitive_path port, see sensitive-path.cjs).
  // Returns the input array if clean; writes a stderr error and returns null
  // if any input is sensitive — callers then `return 2` (usage-error exit).
  // Scoped to the 4 file-accepting subcommands: passing .env or ~/.ssh/id_rsa
  // would otherwise feed the path into graphify queries, which is a disclosure
  // path the orchestrator rarely intends.
  // Parse --allow=<basename> args (repeatable).
  // Whitelist basename patterns let known-safe files bypass the
  // sensitive-path denylist. Field-evidenced use case:
  // `.env.example`, `.env.sample` (committed templates, never real
  // credentials).
  //
  // Match is filename-equality OR filename-prefix on path.basename(f),
  // NOT substring on the full path. Substring matching on full path
  // (initial design) widened the bypass surface dangerously:
  // `--allow=/.ssh/` would have whitelisted `nested/.ssh/id_rsa`
  // because `.ssh/` appears as substring. Basename-only matching
  // covers every documented use case (basenames like `.env.example`,
  // `id_rsa.example`) while preventing path-traversal-via-substring.
  const allowPatterns = args
    .filter(a => a.startsWith("--allow="))
    .map(a => a.slice("--allow=".length))
    .filter(Boolean);
  const filterSensitive = (files) => {
    const { isSensitivePath } = require("./sensitive-path.cjs");
    const blocked = files.filter((f) => {
      if (!isSensitivePath(f)) return false;
      // Apply --allow whitelist: equality or prefix match on basename.
      const base = path.basename(f);
      for (const pat of allowPatterns) {
        if (base === pat || base.startsWith(pat)) return false;
      }
      return true;
    });
    if (blocked.length > 0) {
      const allowHint = allowPatterns.length > 0
        ? ` (current --allow patterns: ${JSON.stringify(allowPatterns)})`
        : " — bypass with --allow=<substring> for known-safe paths (e.g. --allow=.env.example)";
      process.stderr.write(
        `graphify: refused ${blocked.length} sensitive path(s) — ` +
        JSON.stringify(blocked) +
        " (matches credential/key/secret pattern). " +
        "Rename if false-positive, or remove from input list" + allowHint + ".\n",
      );
      return null;
    }
    return files;
  };

  switch (subcommand) {
    case "status": {
      const full = args.includes("--full");
      json(status({ full }));
      return 0;
    }
    case "freshness":
      json(freshness());
      return 0;
    case "warm-cache":
      json({ path: warmCachePath() });
      return 0;
    case "stats":
      json(graphStats());
      return 0;
    case "maybe-refresh": {
      const timeoutArg = args.find(a => a.startsWith("--timeout="));
      const force = args.includes("--force");
      const opts = { force };
      if (timeoutArg) opts.timeout = parseInt(timeoutArg.split("=")[1], 10);
      const result = maybeRefresh(opts);
      json(result);
      return result.ok ? 0 : 1;
    }
    case "rebuild": {
      // DEF-038 — debounced rebuild gated by atomic O_CREAT|O_EXCL lock.
      // Concurrent callers: exactly one wins, the rest return action="skip"
      // with reason="debounced" (within window) or "in_progress" (lock
      // contention past window). Releases lock in finally.
      const timeoutArg = args.find(a => a.startsWith("--timeout="));
      const debounceArg = args.find(a => a.startsWith("--debounce="));
      const opts = {};
      if (timeoutArg) opts.timeout = parseInt(timeoutArg.split("=")[1], 10);
      if (debounceArg) opts.debounce = parseInt(debounceArg.split("=")[1], 10);
      const result = rebuildDebounced(opts);
      json(result);
      return result.ok ? 0 : 1;
    }
    case "write-memory": {
      // Args: --workflow-id <id> --workflow-type <t> --task <text> --summary <text> [--references=a,b,c]
      const getFlag = (name) => {
        const i = args.findIndex(a => a === `--${name}`);
        if (i >= 0 && args[i + 1]) return args[i + 1];
        const inline = args.find(a => a.startsWith(`--${name}=`));
        return inline ? inline.split("=").slice(1).join("=") : undefined;
      };
      const refsArg = getFlag("references");
      const payload = {
        workflow_id: getFlag("workflow-id"),
        workflow_type: getFlag("workflow-type"),
        task: getFlag("task"),
        summary: getFlag("summary"),
        references: refsArg ? refsArg.split(",").map(s => s.trim()).filter(Boolean) : [],
      };
      if (!payload.workflow_id) {
        process.stderr.write("Usage: graphify write-memory --workflow-id <id> [--workflow-type t] [--task text] [--summary text] [--references=a,b,c]\n");
        return 2;
      }
      const result = writeMemoryEntry(payload);
      json(result);
      return result.ok ? 0 : 1;
    }
    case "query": {
      if (!args[0]) { process.stderr.write("Usage: graphify query <text>\n"); return 2; }
      json(queryGraph(args.join(" ")));
      return 0;
    }
    case "node": {
      if (!args[0]) { process.stderr.write("Usage: graphify node <id>\n"); return 2; }
      json(getNode(args[0]));
      return 0;
    }
    case "neighbors": {
      if (!args[0]) { process.stderr.write("Usage: graphify neighbors <symbol> [--direction=in|out|both] [--depth=N] [--max-bytes=N]\n"); return 2; }
      const dirArg = args.find(a => a.startsWith("--direction="));
      const depthArg = args.find(a => a.startsWith("--depth="));
      const maxBytesArg = args.find(a => a.startsWith("--max-bytes="));
      const direction = dirArg ? dirArg.split("=")[1] : "both";
      // Input validation: --depth must be a positive integer when present.
      // Prior behavior propagated NaN through getNeighbors and produced
      // unpredictable results (empty traversal silently).
      let depth = 1;
      if (depthArg) {
        const depthVal = depthArg.split("=")[1];
        const depthN = Number(depthVal);
        if (!Number.isInteger(depthN) || depthN < 1) {
          process.stderr.write(`graphify neighbors: invalid --depth value "${depthVal}" (expected positive integer ≥ 1)\n`);
          return 2;
        }
        depth = depthN;
      }
      const opts = { direction, depth };
      // Input validation: --max-bytes must be a positive integer when present.
      // Prior behavior silently kept the default cap on invalid input.
      if (maxBytesArg) {
        const mbVal = maxBytesArg.split("=")[1];
        const mbN = Number(mbVal);
        if (!Number.isInteger(mbN) || mbN < 1) {
          process.stderr.write(`graphify neighbors: invalid --max-bytes value "${mbVal}" (expected positive integer ≥ 1)\n`);
          return 2;
        }
        opts.max_bytes = mbN;
      }
      const startedMs = Date.now();
      const nResult = getNeighbors(args[0], opts);
      const cid = appendCliTrace("cli__graphify__get_neighbors", nResult, { symbol: args[0], ...opts }, startedMs);
      if (cid && nResult && typeof nResult === "object") nResult._meta = { correlation_id: cid, via: "cli" };
      json(nResult);
      return 0;
    }
    case "path": {
      if (!args[0] || !args[1]) { process.stderr.write("Usage: graphify path <from> <to>\n"); return 2; }
      json(shortestPath(args[0], args[1]));
      return 0;
    }
    case "blast-radius": {
      const bMaxArg = args.find(a => a.startsWith("--max-bytes="));
      const bMax = bMaxArg ? Math.max(1024, parseInt(bMaxArg.split("=")[1], 10) || 0) : null;
      const bSymbols = args.filter(a => !a.startsWith("--"));
      if (bSymbols.length === 0) { process.stderr.write("Usage: graphify blast-radius <symbol> [<symbol>...] [--max-bytes=N]\n"); return 2; }
      const bStartedMs = Date.now();
      const bResult = blastRadius(bSymbols, bMax ? { max_bytes: bMax } : undefined);
      const bCid = appendCliTrace("cli__graphify__blast_radius", bResult, { symbols: bSymbols, max_bytes: bMax }, bStartedMs);
      if (bCid && bResult && typeof bResult === "object") bResult._meta = { correlation_id: bCid, via: "cli" };
      json(bResult);
      return 0;
    }
    case "god-nodes": {
      const limitArg = args.find(a => a.startsWith("--limit="));
      const limit = limitArg ? Math.max(1, parseInt(limitArg.split("=")[1], 10) || 10) : 10;
      json(godNodes(limit));
      return 0;
    }
    case "check-large-files": {
      const thresholdArg = args.find(a => a.startsWith("--edge-threshold="));
      const threshold = thresholdArg ? Math.max(1, parseInt(thresholdArg.split("=")[1], 10) || 50) : 50;
      let files = args.filter(a => !a.startsWith("--"));
      if (files.length === 0) { process.stderr.write("Usage: graphify check-large-files <file>... [--edge-threshold=50]\n"); return 2; }
      files = filterSensitive(files);
      if (files === null) return 2;
      json(checkLargeFilesGodNodes(files, threshold));
      return 0;
    }
    case "check-symbol-godnodes": {
      const thresholdArg = args.find(a => a.startsWith("--edge-threshold="));
      const threshold = thresholdArg ? Math.max(1, parseInt(thresholdArg.split("=")[1], 10) || 50) : 50;
      let files = args.filter(a => !a.startsWith("--"));
      if (files.length === 0) { process.stderr.write("Usage: graphify check-symbol-godnodes <file>... [--edge-threshold=50]\n"); return 2; }
      files = filterSensitive(files);
      if (files === null) return 2;
      json(checkSymbolLevelGodNodes(files, threshold));
      return 0;
    }
    case "augment-impact-map": {
      const thresholdArg = args.find(a => a.startsWith("--edge-threshold="));
      const threshold = thresholdArg ? Math.max(1, parseInt(thresholdArg.split("=")[1], 10) || 50) : 50;
      const baseArg = args.find(a => a.startsWith("--base="));
      const rawArg = args.find(a => a.startsWith("--raw-count="));
      json(augmentImpactMap({
        edgeThreshold: threshold,
        baseRef: baseArg ? baseArg.split("=")[1] : undefined,
        rawCount: rawArg ? rawArg.split("=")[1] : undefined,
      }));
      return 0;
    }
    case "symbols-in-files": {
      const limitArg = args.find(a => a.startsWith("--limit="));
      // Input validation: --limit must be a positive integer when present.
      // Prior behavior used `|| 10` fallback so --limit=garbage silently
      // returned the default-10 result instead of the user's intended N.
      let limit = 10;
      if (limitArg) {
        const limitVal = limitArg.split("=")[1];
        const limitN = Number(limitVal);
        if (!Number.isInteger(limitN) || limitN < 1) {
          process.stderr.write(`graphify symbols-in-files: invalid --limit value "${limitVal}" (expected positive integer ≥ 1)\n`);
          return 2;
        }
        limit = limitN;
      }
      let files = args.filter(a => !a.startsWith("--"));
      if (files.length === 0) { process.stderr.write("Usage: graphify symbols-in-files <file>... [--limit=10]\n"); return 2; }
      files = filterSensitive(files);
      if (files === null) return 2;
      json(symbolsInFiles(files, limit));
      return 0;
    }
    case "compose-drilldowns": {
      // G7 (cal #31.D) — emit drill-down markdown for top-N symbols. The
      // graphify-impact-plan workflow step requires drill-down sections in
      // graph-impact.md, but the orchestrator easily forgets to append them
      // after writing the impact-plan envelope — receipt #5 saw the gate
      // (correctly) flag the omission and require a re-run. This CLI emits
      // ready-to-concatenate markdown so the workflow can pipe its output
      // directly into graph-impact.md without forgetting the step.
      const limitArg = args.find(a => a.startsWith("--limit="));
      const dirArg = args.find(a => a.startsWith("--direction="));
      const depthArg = args.find(a => a.startsWith("--depth="));
      let limit = 3;
      if (limitArg) {
        const n = Number(limitArg.split("=")[1]);
        if (!Number.isInteger(n) || n < 1) {
          process.stderr.write(`graphify compose-drilldowns: invalid --limit "${limitArg.split("=")[1]}" (expected positive integer)\n`);
          return 2;
        }
        limit = n;
      }
      const direction = dirArg ? dirArg.split("=")[1] : "in";
      const depth = depthArg ? Math.max(1, Number(depthArg.split("=")[1])) : 1;
      const symbols = args.filter(a => !a.startsWith("--"));
      if (symbols.length === 0) {
        process.stderr.write("Usage: graphify compose-drilldowns <symbol>... [--direction=in|out|both] [--depth=1] [--limit=3]\n");
        return 2;
      }
      process.stdout.write(composeDrilldowns(symbols, { direction, depth, limit }));
      return 0;
    }
    case "lane-suggestions": {
      let files = args.filter(a => !a.startsWith("--"));
      if (files.length === 0) { process.stderr.write("Usage: graphify lane-suggestions <file>... [--target-lanes=N]\n"); return 2; }
      files = filterSensitive(files);
      if (files === null) return 2;
      const tlArg = args.find(a => a.startsWith("--target-lanes="));
      const opts = {};
      if (tlArg) {
        const v = parseInt(tlArg.split("=")[1], 10);
        if (Number.isInteger(v) && v > 0) opts.targetLanes = v;
      }
      json(laneSuggestions(files, opts));
      return 0;
    }
    case "adaptive-threshold": {
      // Reads node_count from graphStats() (which loads graph.json) and
      // returns the scaled threshold. Workflows pipe this into their
      // graphify_scan_prep bash conditional in lieu of the hardcoded 10.
      const stats = graphStats();
      const nc = (stats && Number.isFinite(stats.node_count)) ? stats.node_count : 0;
      json({ threshold: adaptiveImpactThreshold(nc), node_count: nc });
      return 0;
    }
    default:
      process.stderr.write(
        `Unknown graphify subcommand: ${subcommand}\n` +
        `Valid: status | freshness | warm-cache | stats | query | node | neighbors | path | blast-radius | god-nodes | check-large-files | check-symbol-godnodes | augment-impact-map | symbols-in-files | compose-drilldowns | lane-suggestions | adaptive-threshold | maybe-refresh | rebuild | write-memory\n`
      );
      return 2;
  }
}

// Config-independent binary probe used during setup/health. Returns true when
// `<command> --help` exits 0 within the timeout. The subcommand variant is
// needed because `graphifyy` ships without the `mcp` subcommand unless the
// `[mcp]` extra was installed — bare-binary detection alone is not sufficient
// to know whether the MCP server can actually start.
function _logProbeFailure(category, command, args, detail) {
  try {
    const { appendJsonl } = require("./logger.cjs");
    const root = findProjectRoot();
    if (!root) return;
    const stateDir = path.join(root, ".devt", "state");
    if (!fs.existsSync(stateDir)) return;
    appendJsonl(path.join(stateDir, "probe-failures.jsonl"), {
      ts: new Date().toISOString(),
      category,
      command,
      args,
      ...detail,
    });
  } catch { /* diagnostic side-channel; never raise */ }
}

// Label-collision detection. graphify's _resolveOne returns ONE node
// arbitrarily by Map iteration order when two distinct definitions share a
// label. Observed: two distinct same-named methods on different service
// classes — a single-binding picture wrongly underreports caller risk
// because the resolver picked one and missed the other. This helper finds
// ALL nodes with the exact (case-insensitive) label match, so
// preflight can surface the collision in the brief before downstream agents
// trust a single-binding picture. Returns {source, collisions, count} where
// count > 1 means a real collision; count == 1 is normal; count == 0 means
// the symbol isn't in the graph.
function getSymbolCollisions(label) {
  if (!label || typeof label !== "string") {
    return { source: "graphify", collisions: [], count: 0 };
  }
  const loaded = loadGraph();
  if (!loaded.ok) return { source: "grep", collisions: [], count: 0, degraded: true, reason: loaded.degraded && loaded.degraded.reason };
  const targetLower = label.toLowerCase();
  const collisions = [];
  // Cal #33.A Rank #3 — ghost-node defensive filter + visible counter.
  // Receipt #7: collision detection surfaced empty-source_file ghosts
  // and null-location duplicate symbol entries; a reviewer couldn't
  // tell a real N-way collision from an AST↔semantic merge artifact.
  // Upstream graphify is fixing the canonical-ID merge that creates these,
  // but the bug has demonstrably recurred — defense-in-depth at the
  // projection earns its few LOC.
  //
  // CRITICAL per receipt user's caveat: emit ghost_nodes_filtered counter
  // (NOT silent), so upstream-fix motivation stays visible. A silent filter
  // masks the root cause and removes the pressure to fix it upstream.
  let ghostNodesFiltered = 0;
  for (const [id, node] of loaded.cache.adj.nodeMap) {
    if (typeof node.label === "string" && node.label.toLowerCase() === targetLower) {
      const hasSourceFile = typeof node.source_file === "string" && node.source_file.length > 0;
      const hasLocation = node.source_location !== null && node.source_location !== undefined;
      if (!hasSourceFile && !hasLocation) {
        ghostNodesFiltered++;
        continue;
      }
      collisions.push({
        id,
        label: node.label,
        source_file: node.source_file || "",
        source_location: node.source_location || null,
        // Class qualifier derived from id (e.g. LicenseDetailService.update_license_rights
        // → "LicenseDetailService"). Null when the id has no dotted scoping.
        class_qualifier: id.includes(".") ? id.split(".").slice(0, -1).join(".") : null,
      });
    }
  }
  const result = { source: "graphify", collisions, count: collisions.length };
  if (ghostNodesFiltered > 0) result.ghost_nodes_filtered = ghostNodesFiltered;
  return result;
}

// When the locally-installed graphify skill bundle drifts from the binary
// version, graphify silently emits an empty hyperedges list — workflows
// downstream see hyperedges_matched=[] and assume "no semantic groupings
// found" when the real cause is version drift. Surface format:
//   stderr: "  warning: skill is from graphify X.Y.Z, package is A.B.C. Run 'graphify install' to update."
// Best-effort: spawn failure / no graphify on PATH / unrecognized warning
// format all return `{detected:false}` so callers can layer this on top of
// existing fallback behavior without changing it.
function detectSkillVersionDrift() {
  let r;
  try {
    r = require("child_process").spawnSync("graphify", ["--version"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { return { detected: false }; }
  if (!r || r.error || r.signal === "SIGTERM") return { detected: false };
  const stderr = r.stderr || "";
  const match = stderr.match(/warning:\s*skill is from graphify\s+(\d+\.\d+\.\d+),\s*package is\s+(\d+\.\d+\.\d+)/);
  if (!match) return { detected: false };
  return {
    detected: true,
    skill_version: match[1],
    binary_version: match[2],
    advisory: `graphify skill ${match[1]} drift from binary ${match[2]}`,
  };
}

function probeBinary(command = "graphify", timeoutMs = 1500, options = {}) {
  const args = options.subcommand ? [options.subcommand, "--help"] : ["--help"];
  let probe;
  try {
    probe = require("child_process").spawnSync(command, args, { timeout: timeoutMs, stdio: "ignore" });
  } catch (e) {
    _logProbeFailure("spawn-error", command, args, { error: String(e && e.message || e), timeout_ms: timeoutMs });
    return false;
  }
  if (!probe) {
    _logProbeFailure("no-result", command, args, { timeout_ms: timeoutMs });
    return false;
  }
  if (probe.signal === "SIGTERM") {
    _logProbeFailure("timeout", command, args, { timeout_ms: timeoutMs, signal: probe.signal });
    return false;
  }
  if (probe.error) {
    const code = probe.error.code || "";
    const category = code === "ENOENT" ? "not-installed" : "spawn-error";
    _logProbeFailure(category, command, args, { error: probe.error.message, code, timeout_ms: timeoutMs });
    return false;
  }
  if (probe.status !== 0) {
    _logProbeFailure("nonzero-exit", command, args, { status: probe.status, signal: probe.signal || null, timeout_ms: timeoutMs });
    return false;
  }
  return true;
}

module.exports = {
  logProbeFailure: _logProbeFailure,
  rebuildDebounced,
  run,
  status,
  freshness,
  warmCachePath,
  graphStats,
  queryGraph,
  getNode,
  detectSkillVersionDrift,
  getSymbolCollisions,
  getNeighbors,
  shortestPath,
  blastRadius,
  godNodes,
  checkLargeFilesGodNodes,
  checkSymbolLevelGodNodes,
  augmentImpactMap,
  symbolsInFiles,
  laneSuggestions,
  adaptiveImpactThreshold,
  getCommunity,
  getHyperedgesContaining,
  maybeRefresh,
  writeMemoryEntry,
  parseReportSections,
  getGraphifyOutDir,
  probeBinary,
  resolveExactSymbols,
  manifestFreshness,
};
