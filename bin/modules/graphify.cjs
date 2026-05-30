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

  // graphify emits built_at_commit as a JSON trailer (end of file) in current
  // versions; older versions emitted it near the start. Scan both head (8KB)
  // and tail (16KB) — full parse on a 50MB+ graph would dominate freshness() cost.
  const BUILT_AT_RE = /"built_at_commit"\s*:\s*"([0-9a-fA-F]{4,64})"/;
  let builtAt = null;
  try {
    const stat = fs.statSync(s.graph_path);
    const fd = fs.openSync(s.graph_path, "r");
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

  // NEW-5 (greenfield calibration #5): god-nodes can return tens of thousands
  // of incoming neighbors at depth=2 (greenfield's AuditMapping overflowed
  // 84KB and the MCP transport dropped the response, yielding zero signal
  // on the most-important symbol). The `max_bytes` option caps the serialized
  // size at a target; sorting by depth-ascending then label-alphabetical
  // keeps the truncation deterministic and prefers the closest neighbors
  // (most relevant for impact analysis). When truncation fires, the response
  // carries `truncated: true` + counts so consumers can flag the partial
  // result instead of trusting it as complete.
  const items = [];
  for (const [id, info] of visited) {
    const node = loaded.cache.adj.nodeMap.get(id);
    items.push({
      id,
      label: node.label || id,
      source_file: node.source_file || "",
      relation: info.edge ? info.edge.relation : "",
      confidence: info.edge ? info.edge.confidence : "",
      depth: info.depth,
    });
  }
  items.sort((a, b) => a.depth - b.depth || (a.label || "").localeCompare(b.label || ""));
  const maxBytes = Number.isInteger(options.max_bytes) && options.max_bytes > 0 ? options.max_bytes : null;
  if (!maxBytes) return { source: "graphify", results: items };
  const totalCount = items.length;
  const results = [];
  let runningBytes = 0;
  // Approximate per-item byte cost via JSON.stringify of the item; cheap
  // enough at this granularity (god-node payloads are 10K-50K items).
  for (const item of items) {
    const itemBytes = JSON.stringify(item).length + 1; // +1 for separator comma
    if (runningBytes + itemBytes > maxBytes) break;
    results.push(item);
    runningBytes += itemBytes;
  }
  if (results.length < totalCount) {
    return {
      source: "graphify",
      results,
      truncated: true,
      truncated_at: results.length,
      total_neighbors: totalCount,
      max_bytes: maxBytes,
      truncation_reason: `${totalCount - results.length} neighbor(s) dropped to fit max_bytes=${maxBytes}; results sorted depth-asc + label-alpha so closest neighbors retained`,
    };
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
      // C7-3+C7-6: include source_file so consumers can show the colliding
      // module (greenfield calibration #4 + #7: two ExternalCallService
      // modules collided unflagged — reviewers had no signal which module
      // each finding referenced). source_file may be empty for synthetic
      // nodes, kept as "" then.
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

function godNodes(limit = 10) {
  const loaded = loadGraph();
  if (!loaded.ok) return [];
  return _topByDegree(loaded.cache.adj, limit).map(item => ({
    symbol: (item.node && item.node.label) || item.id,
    edge_count: item.degree,
  }));
}

// F17 — Check whether files in the diff scope are graphify god-nodes.
// Field rationale (greenfield 2026-05-26): routes.py at 2,463 LOC was almost
// certainly a god node, but symbol-anchored scan_prep missed it because the
// anchor list didn't include routes.py module-level symbols. This function
// maps file paths back to graph nodes (via `source_file` metadata) and reports
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
// C7-4 (greenfield calibration #7): options.targetLanes consolidates groups
// into N super-groups when the raw community count exceeds N. Greenfield's
// PR returned 44 micro-communities at 95% coverage → unusable for the
// 5-lane cap. Their manual override grouped by domain path (audit+obs /
// clients+identity / external_calls / nettie+migrations / hurl+docs).
// Path-prefix consolidation matches that pattern: when groups > targetLanes,
// keep top-N by file count as anchors, merge remaining groups into the
// anchor whose files share the longest common directory prefix. Result has
// exactly `target_lanes` super-groups (or fewer if input had fewer raw groups).
function laneSuggestions(diffFiles, options) {
  options = options || {};
  if (!Array.isArray(diffFiles) || diffFiles.length === 0) {
    return { mode: "fallback", groups: [], reason: "no input files" };
  }
  const loaded = loadGraph();
  if (!loaded.ok) {
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
  // NEW-6 (greenfield calibration #5): the legacy strict-coverage check
  // required 100% of diff files to have graph nodes — any diff with tests,
  // migrations, .md docs failed and routed to full fallback. Greenfield's
  // session: 47/91 files lacked nodes → community partition never fired
  // despite 44 files having clean community labels. The marquee feature
  // was consistently absent in practice.
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
  // Files without a community attribute land in the "ungrouped" bucket so
  // the orchestrator can route them to a single lane (better than collapsing
  // everything to path-prefix partition when only some files are uncovered).
  const groupsByCommunity = new Map();
  for (const f of diffFiles) {
    const c = fileToCommunity.get(path.basename(f));
    const key = c === null || c === undefined ? "ungrouped" : String(c);
    if (!groupsByCommunity.has(key)) groupsByCommunity.set(key, { community: c, files: [] });
    groupsByCommunity.get(key).files.push(f);
  }
  let groups = Array.from(groupsByCommunity.values())
    .sort((a, b) => b.files.length - a.files.length);

  // C7-4 — consolidate to target_lanes super-groups via path-prefix similarity
  // when raw count exceeds target. Anchors are the top-N by file count; each
  // remaining group merges into its best anchor.
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
      // greenfield's manual domain-based consolidation (their override grouped
      // audit/clients/external_calls by top-level path component).
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
// useful query_graph text search. Field signal (greenfield calibration #3
// finding #4): for bitbucket + dense + >10 files, query_graph(text=REVIEW_SCOPE)
// returns keyword matches that don't reflect the call graph. blast_radius
// with diff-derived symbols produces actual structural impact.
//
// Returns [{symbol, source_file, edge_count}] sorted desc by edge_count, with
// file/concept/json-key nodes filtered out. Defaults to limit=10 (matches
// blast_radius's typical comfortable input size).
function symbolsInFiles(diffFiles, limit = 10) {
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
    if (_isFileNode(node, degree)) continue;
    if (_isConceptNode(node)) continue;
    if (_isJsonKeyNode(node)) continue;
    results.push({
      symbol: node.label || id,
      source_file: sf,
      edge_count: degree,
    });
  }
  results.sort((a, b) => b.edge_count - a.edge_count);
  return results.slice(0, Math.max(1, Math.min(limit, 200)));
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

// Option A (greenfield calibration #11): hyperedges are graphify's machine-
// discovered "design plans" — semantic groupings that span multiple files
// (route + service + repo + readme + test). When a task's symbols/paths
// overlap any hyperedge's member set, lifting ALL members into preflight's
// symbol channel auto-catches the "fixed code, forgot the readme/test/
// migration" failure mode. Greenfield's graph has 3 hyperedges:
//   hyper_billing_country_fk_flow (route → service → repo → event → audit)
//   hyper_vat_resolution_chain (invoice → country → billing)
//   hyper_audit_jurisdiction_snapshot (org lifecycle + invoice events)
// Each is a high-confidence (≥0.85) cross-file binding.
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
// C-III.1 (greenfield review report #5): the legacy direct_dependents
// threshold was hardcoded `>= 10` across quick-implement.md + dev-workflow.md.
// For a 45K-node graph (greenfield-api scale), 10 is roughly right; for a
// 5K-node graph it's too high — many edits touch 3-9 dependents that would
// benefit from a blast map. Scale with graph size: max(5, log10(node_count) * 2).
//   100 nodes  → max(5, 4)  = 5
//   1000 nodes → max(5, 6)  = 6
//   10000 nodes → max(5, 8) = 8
//   45000 nodes → max(5, 10) = 10  (greenfield baseline)
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
      const depth = depthArg ? parseInt(depthArg.split("=")[1], 10) : 1;
      const opts = { direction, depth };
      if (maxBytesArg) {
        const v = parseInt(maxBytesArg.split("=")[1], 10);
        if (Number.isInteger(v) && v > 0) opts.max_bytes = v;
      }
      json(getNeighbors(args[0], opts));
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
    case "god-nodes": {
      const limitArg = args.find(a => a.startsWith("--limit="));
      const limit = limitArg ? Math.max(1, parseInt(limitArg.split("=")[1], 10) || 10) : 10;
      json(godNodes(limit));
      return 0;
    }
    case "check-large-files": {
      const thresholdArg = args.find(a => a.startsWith("--edge-threshold="));
      const threshold = thresholdArg ? Math.max(1, parseInt(thresholdArg.split("=")[1], 10) || 50) : 50;
      const files = args.filter(a => !a.startsWith("--"));
      if (files.length === 0) { process.stderr.write("Usage: graphify check-large-files <file>... [--edge-threshold=50]\n"); return 2; }
      json(checkLargeFilesGodNodes(files, threshold));
      return 0;
    }
    case "check-symbol-godnodes": {
      const thresholdArg = args.find(a => a.startsWith("--edge-threshold="));
      const threshold = thresholdArg ? Math.max(1, parseInt(thresholdArg.split("=")[1], 10) || 50) : 50;
      const files = args.filter(a => !a.startsWith("--"));
      if (files.length === 0) { process.stderr.write("Usage: graphify check-symbol-godnodes <file>... [--edge-threshold=50]\n"); return 2; }
      json(checkSymbolLevelGodNodes(files, threshold));
      return 0;
    }
    case "symbols-in-files": {
      const limitArg = args.find(a => a.startsWith("--limit="));
      const limit = limitArg ? Math.max(1, parseInt(limitArg.split("=")[1], 10) || 10) : 10;
      const files = args.filter(a => !a.startsWith("--"));
      if (files.length === 0) { process.stderr.write("Usage: graphify symbols-in-files <file>... [--limit=10]\n"); return 2; }
      json(symbolsInFiles(files, limit));
      return 0;
    }
    case "lane-suggestions": {
      const files = args.filter(a => !a.startsWith("--"));
      if (files.length === 0) { process.stderr.write("Usage: graphify lane-suggestions <file>... [--target-lanes=N]\n"); return 2; }
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
        `Valid: status | freshness | warm-cache | stats | query | node | neighbors | path | blast-radius | god-nodes | check-large-files | check-symbol-godnodes | symbols-in-files | lane-suggestions | adaptive-threshold\n`
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
  getNeighbors,
  shortestPath,
  blastRadius,
  godNodes,
  checkLargeFilesGodNodes,
  checkSymbolLevelGodNodes,
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
};
