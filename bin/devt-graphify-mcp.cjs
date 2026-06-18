#!/usr/bin/env node
"use strict";

/**
 * devt-graphify-mcp — vendored MCP relay (stdio transport, JSON-RPC 2.0).
 *
 * Re-exposes `bin/modules/graphify.cjs` wrapper functions as MCP tools so
 * subagents can query the project graph mid-dispatch. Zero subprocess overhead:
 * the wrappers read `graphify-out/graph.json` directly via the memoized
 * loader cache in graphify.cjs — same path preflight already uses.
 *
 * Hard guarantees:
 * 1. Read-only — no tool writes to disk, no tool mutates graph.json.
 * 2. Graceful degradation — every tool returns `{degraded: true, fallback_trigger}`
 *    when graphify is disabled, the binary is missing, or the graph file is absent.
 *    Tools never throw; the wrappers swallow errors and return structured payloads.
 * 3. Zero external dependencies — implements the subset of MCP we need by hand,
 *    same as devt-memory-mcp.cjs.
 *
 * Tools exposed (read-only):
 * - status() → {state: "ready"|"disabled"|"graph_missing", reason}
 * - freshness() → {fresh, built_at, head, lag_commits}
 * - graph_stats() → {node_count, edge_count, density, trust}
 * - get_node(node_id) → {results: [{id, label, source_file, in_degree, out_degree, degree}]}
 * - get_neighbors(symbol, direction?, depth?, relation_filter?) → {results: [{id, label, depth, relation, confidence}]}
 * - shortest_path(source, target, max_hops?) → {results: [{source, target, relation, confidence}]}
 * - query_graph(text, limit?) → {results: [{id, label, in_degree, out_degree}]}
 * - blast_radius(symbols) → {effect_size, direct_dependents, indirect_dependents, modules_touched, god_node_match}
 * - god_nodes(limit?) → [{symbol, edge_count}]
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const graphify = require("./modules/graphify.cjs");
const { findProjectRoot } = require("./modules/config.cjs");
const { safeJsonParse } = require("./modules/security.cjs");

const SERVER_NAME = "devt-graphify-mcp";
const SERVER_VERSION = "0.45.0";
const PROTOCOL_VERSION = "2024-11-05";

// ----------------------------------------------------------------------------
// Tool registry — every handler delegates to graphify.cjs wrappers, which
// already return structured `{source, results, degraded?, fallback_trigger?}`
// shapes. We do NOT re-implement query logic here; the relay is a thin shell.
// ----------------------------------------------------------------------------

const TOOLS = {
  status: {
    description: "Report graphify availability: 'ready' (graph.json found), 'disabled' (graphify.enabled=false), 'graph_missing' (enabled but no graph built). Call this first when an agent suspects graphify is unavailable.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      try { return graphify.status(); }
      catch (e) { return { error: e.message }; }
    },
  },

  freshness: {
    description: "Compare the graph's built_at_commit to git HEAD. Returns {fresh, built_at, head, lag_commits}. Use to decide whether to trust scope_hint signals — if lag_commits > 30, the graph is likely stale.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      try { return graphify.freshness(); }
      catch (e) { return { error: e.message }; }
    },
  },

  graph_stats: {
    description: "Aggregate graph statistics: {node_count, edge_count, density, trust ∈ {empty, sparse, dense}}. Use to gauge whether to invest tokens in graph queries — sparse graphs return low-confidence neighbor sets.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      try { return graphify.graphStats(); }
      catch (e) { return { error: e.message }; }
    },
  },

  get_node: {
    description: "Look up a single node by id or label. Returns degree counts and source_file. Use to disambiguate when a symbol name matches multiple nodes.",
    inputSchema: {
      type: "object",
      required: ["node_id"],
      properties: {
        node_id: { type: "string", description: "Node id or label, e.g. 'AuthService.validate' or a fully-qualified id from a prior query" },
      },
    },
    handler: ({ node_id }) => {
      if (typeof node_id !== "string" || node_id.length === 0) return { error: "node_id required (string)" };
      try { return graphify.getNode(node_id); }
      catch (e) { return { error: e.message }; }
    },
  },

  get_neighbors: {
    description: "BFS the graph from a symbol. direction: 'in' (callers), 'out' (callees), 'both' (default). depth: 1-3 (default 1). relation_filter: optional edge-type whitelist (e.g. 'calls'). max_bytes caps the serialized response size (default 60000); when exceeded the response carries truncated:true + the closest-by-depth neighbors retained. Returns up to 200 neighbors with edge relation + confidence. Use for caller-set enumeration before declaring a change safe.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "Node label or id" },
        direction: { type: "string", enum: ["in", "out", "both"], description: "Edge direction (default 'both')" },
        depth: { type: "integer", minimum: 1, maximum: 3, description: "BFS depth (default 1)" },
        relation_filter: { type: "string", description: "Optional edge-type filter, e.g. 'calls', 'imports'" },
        max_bytes: { type: "integer", minimum: 1024, maximum: 524288, description: "Cap serialized response size in bytes (default 60000). When exceeded, response includes truncated:true and neighbors sorted depth-asc + label-alpha so closest neighbors retained." },
      },
    },
    handler: ({ symbol, direction, depth, relation_filter, max_bytes }) => {
      if (typeof symbol !== "string" || symbol.length === 0) return { error: "symbol required (string)" };
      const opts = {};
      if (direction) opts.direction = direction;
      if (depth) opts.depth = depth;
      if (relation_filter) opts.relation_filter = relation_filter;
      // Server-side default 60KB. Without this, drill-downs on big hubs
      // (ExportService-class symbols with 8000+ inbound edges) overflowed the
      // MCP transport — field-evidenced gap. Caller can override up to 512KB.
      opts.max_bytes = Number.isInteger(max_bytes) && max_bytes >= 1024 ? max_bytes : 60000;
      try { return graphify.getNeighbors(symbol, opts); }
      catch (e) { return { error: e.message }; }
    },
  },

  shortest_path: {
    description: "Directed BFS path finder between two symbols. Returns the edge sequence with relation + confidence per hop. Use to answer 'how does X reach Y?' for bug-trace handoffs.",
    inputSchema: {
      type: "object",
      required: ["source", "target"],
      properties: {
        source: { type: "string" },
        target: { type: "string" },
        max_hops: { type: "integer", minimum: 1, maximum: 12, description: "Hop budget (default 8)" },
      },
    },
    handler: ({ source, target, max_hops }) => {
      if (typeof source !== "string" || source.length === 0) return { error: "source required" };
      if (typeof target !== "string" || target.length === 0) return { error: "target required" };
      const opts = {};
      if (max_hops) opts.max_hops = max_hops;
      try { return graphify.shortestPath(source, target, opts); }
      catch (e) { return { error: e.message }; }
    },
  },

  query_graph: {
    description: "Resolve free text to candidate graph nodes (label-substring + token match). Returns top-N nodes with degree counts. Use as the FIRST query when you don't have a known symbol yet — feed top results into get_neighbors for traversal.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Free-text query, e.g. 'auth middleware' or 'webhook handler'" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Top-N (default 10)" },
      },
    },
    handler: ({ text, limit }) => {
      if (typeof text !== "string" || text.length === 0) return { error: "text required" };
      const opts = {};
      if (limit) opts.limit = limit;
      try { return graphify.queryGraph(text, opts); }
      catch (e) { return { error: e.message }; }
    },
  },

  blast_radius: {
    description: "Compute the depth-2 incoming dependency set for a list of symbols. Returns {effect_size: 'small'|'medium'|'large'|null, direct_dependents, indirect_dependents, modules_touched, god_node_match, ambiguous_bindings}. Use to size a change's risk before dispatching tests.",
    inputSchema: {
      type: "object",
      required: ["symbols"],
      properties: {
        // maxItems=256: schema-level cap with no underlying transport
        // constraint. The CLI wrapper (graphify.blastRadius) accepts
        // unlimited input; only this MCP schema constrained. Prior
        // cap (32) silently dropped 65% of topic symbols on PRs with
        // wider domain surfaces — field-observed losing exactly the
        // most-reviewable symbols. 256 covers realistic PR scope;
        // revisit only if a real response-size overflow is observed.
        symbols: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 256, description: "Subject symbols (cap 256, see schema comment)" },
      },
    },
    handler: ({ symbols }) => {
      if (!Array.isArray(symbols) || symbols.length === 0) return { error: "symbols required (array of strings)" };
      try { return graphify.blastRadius(symbols); }
      catch (e) { return { error: e.message }; }
    },
  },

  god_nodes: {
    description: "Return the top-N most-connected nodes (after filtering file stubs and JSON keys). Use to identify cross-cutting abstractions touched by a change.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Top-N (default 10)" },
      },
    },
    handler: ({ limit }) => {
      try { return { results: graphify.godNodes(limit || 10) || [] }; }
      catch (e) { return { error: e.message }; }
    },
  },

  // get_community removed from MCP advertised tool surface. Field signal
  // Field signal: zero agent invocations across 50+ raw-
  // dispatched lane reviews — no workflow tells an agent to reach for it.
  // The JS function `graphify.getCommunity()` (bin/modules/graphify.cjs) is
  // the canonical contract + remains in active use via `graphify lane-
  // suggestions` CLI. Re-advertise here if a future workflow needs agent-
  // facing community enumeration.
};

// ----------------------------------------------------------------------------
// JSON-RPC 2.0 stdio transport (mirrors devt-memory-mcp.cjs structure)
// ----------------------------------------------------------------------------

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  send({ jsonrpc: "2.0", id, error: err });
}

function listTools() {
  return {
    tools: Object.entries(TOOLS).map(([name, def]) => ({
      name,
      description: def.description,
      inputSchema: def.inputSchema,
    })),
  };
}

// ----------------------------------------------------------------------------
// Telemetry — shares the trace file with devt-memory-mcp, tagged by server name
// so `mcp-stats --tool=mcp__devt-graphify__*` aggregations work the same way.
// Trace records carry the active workflow's id/type/phase when one is set.
// ----------------------------------------------------------------------------

let _telemetryState = null;

function getTelemetry() {
  if (_telemetryState) return _telemetryState;
  try {
    const { getMergedConfig } = require("./modules/config.cjs");
    const cfg = getMergedConfig();
    const enabled = !cfg.memory || cfg.memory.mcp_telemetry !== false;
    const tracePath = path.join(findProjectRoot(), ".devt", "memory", "_mcp-trace.jsonl");
    _telemetryState = { enabled, tracePath };
  } catch {
    _telemetryState = { enabled: false, tracePath: null };
  }
  return _telemetryState;
}

let _workflowContextCache = null;

function readWorkflowContext() {
  try {
    const wfPath = path.join(findProjectRoot(), ".devt", "state", "workflow.yaml");
    let stat;
    try {
      stat = fs.statSync(wfPath);
    } catch {
      _workflowContextCache = { mtimeMs: 0, context: null };
      return null;
    }
    if (_workflowContextCache && _workflowContextCache.mtimeMs === stat.mtimeMs) {
      return _workflowContextCache.context;
    }
    const body = fs.readFileSync(wfPath, "utf8");
    const idMatch = body.match(/^workflow_id:\s*"?([^"\n\r]+)"?\s*$/m);
    const typeMatch = body.match(/^workflow_type:\s*"?([^"\n\r]+)"?\s*$/m);
    const phaseMatch = body.match(/^phase:\s*"?([^"\n\r]+)"?\s*$/m);
    const workflow_id = idMatch ? idMatch[1].trim() : null;
    const workflow_type = typeMatch ? typeMatch[1].trim() : null;
    const phase = phaseMatch ? phaseMatch[1].trim() : null;
    const context = (workflow_id || workflow_type || phase)
      ? { workflow_id, workflow_type, phase }
      : null;
    _workflowContextCache = { mtimeMs: stat.mtimeMs, context };
    return context;
  } catch {
    return null;
  }
}

function fingerprint(obj) {
  try {
    return crypto.createHash("sha256").update(JSON.stringify(obj || {})).digest("hex").slice(0, 12);
  } catch {
    return "fp_err";
  }
}

function appendTrace(record) {
  const t = getTelemetry();
  if (!t.enabled || !t.tracePath) return;
  if (!fs.existsSync(path.dirname(t.tracePath))) return;
  const ctx = readWorkflowContext();
  const merged = ctx ? { ...ctx, ...record } : record;
  try {
    fs.appendFileSync(t.tracePath, JSON.stringify(merged) + "\n", "utf8");
  } catch {
    // Trace write failure must NEVER affect tool result.
  }
}

function callTool(name, args) {
  const startedAt = Date.now();
  const ts = new Date().toISOString();
  const argsSize = (() => {
    try { return JSON.stringify(args || {}).length; } catch { return 0; }
  })();
  const argsFp = fingerprint(args);
  // 8-char hex (4 random bytes) — collision risk negligible for a session-scoped
  // log, short enough to embed in F16 drill-down headings. Two consumers:
  //   1. Trace record — enables `mcp-stats --correlation-id=<id>` lookup.
  //   2. MCP response `_meta` — orchestrator can cite the id when writing
  //      drill-down headings so lane findings reference a specific call.
  const correlationId = crypto.randomBytes(4).toString("hex");

  const tool = TOOLS[name];
  if (!tool) {
    appendTrace({
      ts, tool: `mcp__devt-graphify__${name}`, ok: false, error_code: "TOOL_NOT_FOUND",
      duration_ms: Date.now() - startedAt, args_size: argsSize, args_fp: argsFp, result_size: 0,
      correlation_id: correlationId,
    });
    return { error: `unknown tool: ${name}`, code: "TOOL_NOT_FOUND", correlation_id: correlationId };
  }

  let result;
  let isError = false;
  let errorCode = null;
  try {
    result = tool.handler(args || {});
    if (result && typeof result === "object" && result.error) {
      isError = true;
      errorCode = result.code || "TOOL_ERROR";
    }
  } catch (e) {
    isError = true;
    errorCode = "EXCEPTION";
    result = { error: e.message };
  }

  let resultText;
  try { resultText = JSON.stringify(result, null, 2); } catch { resultText = "{}"; }
  const resultSize = resultText.length;

  appendTrace({
    ts, tool: `mcp__devt-graphify__${name}`, ok: !isError, error_code: errorCode,
    duration_ms: Date.now() - startedAt,
    args_size: argsSize, args_fp: argsFp, result_size: resultSize,
    correlation_id: correlationId,
  });

  return {
    content: [{ type: "text", text: resultText }],
    _meta: { correlation_id: correlationId },
    ...(isError ? { isError: true } : {}),
  };
}

function handleMessage(msg) {
  if (msg.jsonrpc !== "2.0" || !msg.method) {
    if (msg.id !== undefined) replyError(msg.id, -32600, "invalid request");
    return;
  }
  switch (msg.method) {
    case "initialize":
      reply(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    case "notifications/initialized":
    case "initialized":
      return;
    case "tools/list":
      reply(msg.id, listTools());
      return;
    case "tools/call": {
      const params = msg.params || {};
      const result = callTool(params.name, params.arguments);
      reply(msg.id, result);
      return;
    }
    case "ping":
      reply(msg.id, {});
      return;
    case "shutdown":
      reply(msg.id, {});
      process.nextTick(() => process.exit(0));
      return;
    default:
      if (msg.id !== undefined) replyError(msg.id, -32601, `method not found: ${msg.method}`);
      return;
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const result = safeJsonParse(line, "JSON-RPC frame");
    if (!result.ok) {
      replyError(null, -32700, `parse error: ${result.error}`);
      continue;
    }
    const parsed = result.value;
    if (Array.isArray(parsed)) {
      for (const m of parsed) handleMessage(m);
    } else {
      handleMessage(parsed);
    }
  }
});
process.stdin.on("end", () => process.exit(0));

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

module.exports = {
  TOOLS,
  callTool,
  listTools,
};

// CLI mode for smoke tests: node bin/devt-graphify-mcp.cjs --self-test
if (require.main === module && process.argv.includes("--self-test")) {
  const expectedTools = [
    "status", "freshness", "graph_stats", "get_node", "get_neighbors",
    "shortest_path", "query_graph", "blast_radius", "god_nodes",
  ];
  const listed = listTools().tools.map(t => t.name).sort();
  const missing = expectedTools.filter(t => !listed.includes(t));
  const extra = listed.filter(t => !expectedTools.includes(t));
  if (missing.length || extra.length) {
    console.log(`FAIL: tool registry drift. missing=[${missing.join(",")}] extra=[${extra.join(",")}]`);
    process.exit(1);
  }
  // Every tool must return a payload (object, not throw) when called with empty args.
  // For tools with required args, this exercises the "missing arg" error path.
  let pass = 0, fail = 0;
  for (const name of expectedTools) {
    try {
      const r = callTool(name, {});
      if (!r || !r.content) { fail++; console.log(`FAIL: ${name} returned no content`); }
      else pass++;
    } catch (e) {
      fail++;
      console.log(`FAIL: ${name} threw: ${e.message}`);
    }
  }
  console.log(`devt-graphify-mcp self-test: ${pass}/${expectedTools.length} tools responded (no throws), ${fail} failures`);
  process.exit(fail === 0 ? 0 : 1);
}
