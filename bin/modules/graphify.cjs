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
function status() {
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
  return { state: "ready", out_dir: outDir, graph_path: graphPath };
}

/**
 * Read graph.json's `built_at_commit` and compare to current HEAD.
 * Returns { fresh: bool, built_at: string|null, head: string|null, lag_commits: number|null }.
 */
function freshness() {
  const s = status();
  if (s.state !== "ready") return { state: s.state, fresh: false, built_at: null, head: null };

  // Read only the first 8KB to extract built_at_commit. graph.json is a top-level
  // object emitted by graphify with built_at_commit near the start, and full JSON
  // parse on a 50MB+ graph would dominate freshness() cost.
  let builtAt = null;
  try {
    const fd = fs.openSync(s.graph_path, "r");
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    const head = buf.toString("utf8", 0, bytesRead);
    const m = head.match(/"built_at_commit"\s*:\s*"([0-9a-fA-F]{4,64})"/);
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

function loadGraph() {
  const s = status();
  if (s.state !== "ready") return { ok: false, degraded: _degraded(s.reason, s.state, "not_setup") };

  let stat;
  try { stat = fs.statSync(s.graph_path); }
  catch (e) { return { ok: false, degraded: _degraded(`stat failed: ${e.message}`, s.state, "error") }; }

  if (_graphCache && _graphCache.path === s.graph_path && _graphCache.mtimeMs === stat.mtimeMs) {
    return { ok: true, cache: _graphCache };
  }

  let raw;
  try { raw = fs.readFileSync(s.graph_path, "utf8"); }
  catch (e) { return { ok: false, degraded: _degraded(`read failed: ${e.message}`, s.state, "error") }; }

  // safeJsonParse enforces a byte cap and returns {ok, value, error}.
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

  const ids = _resolveMany(loaded.cache.adj, text, options.limit || 20);
  if (ids.length === 0) {
    return { source: "grep", results: [], degraded: true, reason: "no matching nodes", fallback_trigger: "empty" };
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
  return { source: "graphify", results };
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

  const results = [];
  for (const [id, info] of visited) {
    const node = loaded.cache.adj.nodeMap.get(id);
    results.push({
      id,
      label: node.label || id,
      source_file: node.source_file || "",
      relation: info.edge ? info.edge.relation : "",
      confidence: info.edge ? info.edge.confidence : "",
      depth: info.depth,
    });
  }
  return { source: "graphify", results };
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
function blastRadius(symbols, _options) {
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
  const direct = new Set();
  const indirect = new Set();
  const modules = new Set();
  const ambiguous = [];

  for (const sym of symbols) {
    const seedId = _resolveOne(adj, sym);
    if (!seedId) continue;
    // depth-2 incoming: visited.depth in {1, 2}; direct = depth 1, indirect = depth 2
    const { visited } = _bfs(adj, seedId, "in", 2);
    for (const [id, info] of visited) {
      if (id === seedId) continue;
      const node = adj.nodeMap.get(id);
      const label = node && node.label ? node.label : id;
      if (info.depth === 1) direct.add(label);
      else if (info.depth === 2) indirect.add(label);
      if (node && node.source_file) modules.add(path.dirname(node.source_file));
      if (info.edge && info.edge.confidence === "AMBIGUOUS") ambiguous.push({ symbol: sym, node: { id, label } });
    }
  }

  // god-node detection via direct degree-sort over the loaded adjacency.
  // Replaces the prior regex-scrape of graphify-out/GRAPH_REPORT.md — degree
  // is what defines god-nodes (per upstream graphify/analyze.py::god_nodes),
  // and graph.json carries the structural data directly. Works even when
  // GRAPH_REPORT.md hasn't been generated yet.
  let godNodeMatch = false;
  const topNodes = _topByDegree(adj, 10);
  const topIds = new Set(topNodes.map(item => item.id));
  const topLabels = new Set(topNodes.map(item => (item.node.label || item.id).toLowerCase()));
  for (const sym of symbols) {
    if (typeof sym !== "string" || sym.length === 0 || sym.length > 256) continue;
    const resolvedId = _resolveOne(adj, sym);
    if (resolvedId && topIds.has(resolvedId)) { godNodeMatch = true; break; }
    if (topLabels.has(sym.toLowerCase())) { godNodeMatch = true; break; }
  }

  let effect_size;
  if (godNodeMatch || direct.size + indirect.size > 20 || modules.size >= 4) effect_size = "large";
  else if (direct.size + indirect.size > 5 || modules.size >= 2) effect_size = "medium";
  else effect_size = "small";

  return {
    effect_size,
    direct_dependents: Array.from(direct),
    indirect_dependents: Array.from(indirect),
    modules_touched: modules.size,
    god_node_match: godNodeMatch,
    ambiguous_bindings: ambiguous.length,
    ambiguous_details: ambiguous,
    source: "graphify",
  };
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
function graphStats() {
  const loaded = loadGraph();
  if (!loaded.ok) {
    return {
      state: loaded.degraded.state || "not_ready",
      node_count: 0,
      edge_count: 0,
      density: null,
      trust: "empty",
    };
  }
  const nodeCount = loaded.cache.adj.nodeMap.size;
  const edgeCount = (loaded.cache.links || []).length;
  const density = nodeCount > 0 ? edgeCount / nodeCount : 0;
  let trust;
  if (nodeCount === 0) trust = "empty";
  else if (nodeCount < 50 || density < 1) trust = "sparse";
  else trust = "dense";
  return { state: "ready", node_count: nodeCount, edge_count: edgeCount, density, trust };
}

// ---------------------------------------------------------------------------
// CLI dispatcher
// ---------------------------------------------------------------------------

function run(subcommand, args) {
  const json = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");

  switch (subcommand) {
    case "status":
      json(status());
      return 0;
    case "freshness":
      json(freshness());
      return 0;
    case "warm-cache":
      json({ path: warmCachePath() });
      return 0;
    case "stats":
      json(graphStats());
      return 0;
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
      if (!args[0]) { process.stderr.write("Usage: graphify neighbors <symbol> [--direction=in|out|both] [--depth=N]\n"); return 2; }
      const dirArg = args.find(a => a.startsWith("--direction="));
      const depthArg = args.find(a => a.startsWith("--depth="));
      const direction = dirArg ? dirArg.split("=")[1] : "both";
      const depth = depthArg ? parseInt(depthArg.split("=")[1], 10) : 1;
      json(getNeighbors(args[0], { direction, depth }));
      return 0;
    }
    case "path": {
      if (!args[0] || !args[1]) { process.stderr.write("Usage: graphify path <from> <to>\n"); return 2; }
      json(shortestPath(args[0], args[1]));
      return 0;
    }
    case "blast-radius": {
      if (args.length === 0) { process.stderr.write("Usage: graphify blast-radius <symbol> [<symbol>...]\n"); return 2; }
      json(blastRadius(args));
      return 0;
    }
    default:
      process.stderr.write(
        `Unknown graphify subcommand: ${subcommand}\n` +
        `Valid: status | freshness | warm-cache | stats | query | node | neighbors | path | blast-radius\n`
      );
      return 2;
  }
}

// Config-independent binary probe used during setup/health. Returns true when
// `<command> --help` exits 0 within the timeout. The subcommand variant is
// needed because `graphifyy` ships without the `mcp` subcommand unless the
// `[mcp]` extra was installed — bare-binary detection alone is not sufficient
// to know whether the MCP server can actually start.
function probeBinary(command = "graphify", timeoutMs = 1500, options = {}) {
  const args = options.subcommand ? [options.subcommand, "--help"] : ["--help"];
  try {
    const probe = require("child_process").spawnSync(command, args, { timeout: timeoutMs, stdio: "ignore" });
    return Boolean(probe && probe.status === 0);
  } catch {
    return false;
  }
}

module.exports = {
  run,
  status,
  freshness,
  warmCachePath,
  graphStats,
  queryGraph,
  getNode,
  getNeighbors,
  shortestPath,
  blastRadius,
  parseReportSections,
  getGraphifyOutDir,
  probeBinary,
};
