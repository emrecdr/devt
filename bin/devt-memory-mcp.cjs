#!/usr/bin/env node
"use strict";

/**
 * devt-memory-mcp — vendored MCP server (stdio transport, JSON-RPC 2.0).
 *
 * Phase 3 (v0.18.0). Exposes read-only access to the unified memory index
 * (`.devt/memory/index.db`) via Model Context Protocol tools. Designed for
 * agents to query governing rules BEFORE proposing edits.
 *
 * Hard guarantees:
 *   1. SQLite opened with `readOnly: true` — even malicious helpers cannot mutate.
 *   2. The escape-hatch `query_index(sql)` tool rejects any non-SELECT statement.
 *   3. Multi-statement payloads are rejected (defends against semicolon injection).
 *   4. PRAGMA writes, ATTACH, and any DML/DDL are caught by the SELECT-only check
 *      AND blocked by readOnly mode at the SQLite layer.
 *
 * Zero external dependencies — implements the subset of MCP we need by hand.
 *
 * Tools exposed:
 *   - get_context_for_path(path)      → governing ADRs/CONs/FLOWs for a file
 *   - get_context_for_symbol(symbol)  → docs whose affects_symbols includes <symbol>
 *   - query_fts(terms, limit?)        → FTS5 unified search across all doc_class values
 *   - get_doc(id)                     → fetch a single doc with affects/links/keywords
 *   - list_active(domain?)            → enumerate status:active docs
 *   - list_rejected_keywords()        → REJ tombstones with their search_keywords
 *   - list_links(doc_id, depth?)      → transitive link expansion (depth-1 default)
 *   - preflight(task)                 → run lanes A-F + blast radius; same as CLI
 *   - blast_radius(symbols)           → Graphify-derived blast radius (degraded payload when disabled)
 *   - query_index(sql)                → SELECT-only escape hatch
 */

const path = require("path");
const fs = require("fs");
const memory = require("./modules/memory.cjs");
const preflight = require("./modules/preflight.cjs");
const graphify = require("./modules/graphify.cjs");
const { findProjectRoot } = require("./modules/config.cjs");
const { safeJsonParse } = require("./modules/security.cjs");

const SERVER_NAME = "devt-memory-mcp";
const SERVER_VERSION = "0.21.0";
const PROTOCOL_VERSION = "2024-11-05";

// ----------------------------------------------------------------------------
// Read-only DB helper — opens index.db in readOnly mode, never writes.
// ----------------------------------------------------------------------------

function openReadOnly() {
  const dbPath = path.join(findProjectRoot(), ".devt", "memory", "index.db");
  if (!fs.existsSync(dbPath)) {
    const err = new Error(
      `memory index not built at ${dbPath}. Run \`node bin/devt-tools.cjs memory init\` first.`
    );
    err.code = "INDEX_NOT_BUILT";
    throw err;
  }
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(dbPath, { readOnly: true });
}

function withReadOnly(fn) {
  let db;
  try { db = openReadOnly(); } catch (e) {
    return { error: e.message, code: e.code || "DB_ERROR" };
  }
  try { return fn(db); } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// ----------------------------------------------------------------------------
// SELECT-only validator for the raw query_index escape hatch.
//
// Strategy:
//  1. Strip line comments (-- ...) and block comments (/* ... */)
//  2. Reject any payload containing more than one statement (semicolon outside string)
//  3. Reject any leading keyword that isn't SELECT or WITH (CTE) or EXPLAIN
//  4. Block-list dangerous tokens (PRAGMA, ATTACH, DETACH) anywhere in payload
//
// Because the DB is opened readOnly, even a missed token cannot mutate state.
// This validator is defense-in-depth, not the only line of defense.
// ----------------------------------------------------------------------------

function stripSqlComments(sql) {
  // Remove block comments first (non-greedy)
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove line comments
  s = s.replace(/--[^\n]*/g, " ");
  return s;
}

function isMultiStatement(sql) {
  // Count semicolons OUTSIDE string literals. Walk the string with a small state machine.
  let inSingle = false;
  let inDouble = false;
  let count = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (!inDouble && c === "'" && sql[i - 1] !== "\\") inSingle = !inSingle;
    else if (!inSingle && c === '"' && sql[i - 1] !== "\\") inDouble = !inDouble;
    else if (!inSingle && !inDouble && c === ";") count++;
  }
  // Count non-whitespace remainder after the LAST semicolon to allow trailing `;` only.
  if (count >= 2) return true;
  if (count === 1) {
    const lastSemi = sql.lastIndexOf(";");
    const rest = sql.slice(lastSemi + 1).trim();
    if (rest.length > 0) return true;
  }
  return false;
}

const FORBIDDEN_TOKENS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "REPLACE",
  "TRUNCATE", "PRAGMA", "ATTACH", "DETACH", "VACUUM", "REINDEX",
  "ANALYZE", "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE",
];

function validateSelectOnly(sql) {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    return { ok: false, reason: "empty SQL" };
  }
  const cleaned = stripSqlComments(sql);
  if (isMultiStatement(cleaned)) {
    return { ok: false, reason: "multi-statement payload rejected (semicolon injection guard)" };
  }
  // Tokenize at word boundaries (uppercase comparison)
  const upper = cleaned.toUpperCase();
  for (const token of FORBIDDEN_TOKENS) {
    const re = new RegExp(`\\b${token}\\b`);
    if (re.test(upper)) {
      return { ok: false, reason: `forbidden token: ${token}` };
    }
  }
  // Leading keyword must be SELECT, WITH (CTE), or EXPLAIN
  const leadingMatch = upper.trim().match(/^(SELECT|WITH|EXPLAIN)\b/);
  if (!leadingMatch) {
    return { ok: false, reason: "leading keyword must be SELECT, WITH, or EXPLAIN" };
  }
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Tool implementations
// ----------------------------------------------------------------------------

const TOOLS = {
  get_context_for_path: {
    description: "Return active docs governing a file path (glob-matched via affects_paths). Spans all configured memory roots; rows include source_root.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string", description: "Project-relative file path, e.g. src/auth/service.ts" } },
    },
    handler: ({ path: filePath }) => {
      if (typeof filePath !== "string" || filePath.length === 0) {
        return { error: "path required (string)" };
      }
      try { return { results: memory.getByPath(filePath) || [] }; }
      catch (e) { return { error: e.message }; }
    },
  },

  get_context_for_symbol: {
    description: "Return active docs whose affects_symbols includes the given symbol.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: { symbol: { type: "string", description: "Symbol name, e.g. AuthService" } },
    },
    handler: ({ symbol }) => {
      if (typeof symbol !== "string" || symbol.length === 0) {
        return { error: "symbol required (string)" };
      }
      try { return { results: memory.getBySymbol(symbol) || [] }; }
      catch (e) { return { error: e.message }; }
    },
  },

  query_fts: {
    description: "Full-text search across the memory index. Tokens AND together with prefix matching.",
    inputSchema: {
      type: "object",
      required: ["terms"],
      properties: {
        terms: { type: "string", description: "Whitespace-separated search terms" },
        limit: { type: "integer", description: "Max results (default 20)", minimum: 1, maximum: 100 },
      },
    },
    handler: ({ terms, limit }) => {
      try { return { results: memory.queryFTS(terms, { limit: limit || 20 }) || [] }; }
      catch (e) { return { error: e.message }; }
    },
  },

  // Pre-filter aggregations (v0.35.0+, Option 6) — return aggregates instead of full
  // FTS rows so agents that only need a count, a top-N preview, or a domain breakdown
  // don't pay the per-row payload cost (each full row is ~600-1500 bytes; aggregates
  // are typically <500 bytes total).
  query_fts_count: {
    description: "Count FTS5 matches without returning rows. Use when you only need to know IF/HOW MANY docs match a topic, not their contents.",
    inputSchema: {
      type: "object",
      required: ["terms"],
      properties: {
        terms: { type: "string", description: "Whitespace-separated search terms" },
      },
    },
    handler: ({ terms }) => {
      try { return memory.queryFTS(terms, { mode: "count" }) || { count: 0 }; }
      catch (e) { return { error: e.message }; }
    },
  },

  query_fts_top: {
    description: "Return top-N most-relevant FTS5 matches as compact rows (id, title, doc_type only). Use for preview/triage before drilling into a specific doc with get_doc.",
    inputSchema: {
      type: "object",
      required: ["terms"],
      properties: {
        terms: { type: "string", description: "Whitespace-separated search terms" },
        n: { type: "integer", description: "Top-N (default 5)", minimum: 1, maximum: 50 },
      },
    },
    handler: ({ terms, n }) => {
      try { return { results: memory.queryFTS(terms, { mode: "compact", limit: n || 5 }) || [] }; }
      catch (e) { return { error: e.message }; }
    },
  },

  query_fts_by_domain: {
    description: "Group FTS5 matches by document `domain` and return only the {domain: count} map. Use when you want to see WHERE in the project the topic is concentrated.",
    inputSchema: {
      type: "object",
      required: ["terms"],
      properties: {
        terms: { type: "string", description: "Whitespace-separated search terms" },
      },
    },
    handler: ({ terms }) => {
      try { return memory.queryFTS(terms, { mode: "domain-counts" }) || { counts: {} }; }
      catch (e) { return { error: e.message }; }
    },
  },

  // Write surface (v0.35.0+, Option 2) — only exposed when DEVT_MCP_ALLOW_WRITES=1
  // is set in the MCP server's process environment. The curator agent's
  // workflow dispatch sets this flag; all other dispatches see a read-only
  // tool surface. listTools() filters write tools out when the flag is unset,
  // and callTool() rejects the call at the handler level (defense in depth).
  memory_upsert_doc: {
    description: "Atomically write a memory doc (.devt/memory/<subdir>/<ID>-<slug>.md) and refresh the FTS5 index in a single call. Replaces the legacy 4-tool curator ritual (Write .tmp + Bash mv + Bash memory index). Requires DEVT_MCP_ALLOW_WRITES=1.",
    writable: true,
    inputSchema: {
      type: "object",
      required: ["frontmatter"],
      properties: {
        frontmatter: {
          type: "object",
          description: "Frontmatter object: {id, doc_type, status, confidence, title, summary, domain?, affects_paths?, affects_symbols?, links?, reason?, search_keywords?, created_at?, created_by?}",
          required: ["id", "doc_type", "status", "confidence", "title", "summary"],
        },
        body: { type: "string", description: "Markdown body (without frontmatter delimiters). Default: empty." },
      },
    },
    handler: (args) => {
      if (process.env.DEVT_MCP_ALLOW_WRITES !== "1") {
        return { error: "write surface disabled — set DEVT_MCP_ALLOW_WRITES=1 to enable (curator dispatch only)", code: "WRITES_DISABLED" };
      }
      const payload = args || {};
      if (!payload.frontmatter || typeof payload.frontmatter !== "object") {
        return { error: "frontmatter object required" };
      }
      try { return memory.upsertDoc({ frontmatter: payload.frontmatter, body: payload.body || "" }); }
      catch (e) { return { error: e.message }; }
    },
  },

  get_doc: {
    description: "Fetch a single doc by id (e.g. ADR-007, REJ-001) with its full payload, including source_root.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "Doc id, e.g. ADR-007" } },
    },
    handler: ({ id }) => {
      if (typeof id !== "string" || id.length === 0) return { error: "id required (string)" };
      try {
        const doc = memory.getDoc(id);
        return doc ? { doc } : { error: `no doc with id ${id}`, code: "NOT_FOUND" };
      } catch (e) { return { error: e.message }; }
    },
  },

  list_active: {
    description: "List all active docs across configured memory roots; rows include source_root. Optionally filter by domain.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string", description: "Optional domain filter, e.g. 'security'" } },
    },
    handler: ({ domain }) => {
      try { return { results: memory.listActive(domain) || [] }; }
      catch (e) { return { error: e.message }; }
    },
  },

  list_rejected_keywords: {
    description: "Return REJ tombstones with their search_keywords (used to suppress re-proposals).",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      try { return { results: memory.listRejectedKeywords() || [] }; }
      catch (e) { return { error: e.message }; }
    },
  },

  list_links: {
    description: "Transitive link traversal from a starting doc. Default depth 1.",
    inputSchema: {
      type: "object",
      required: ["doc_id"],
      properties: {
        doc_id: { type: "string" },
        depth: { type: "integer", minimum: 1, maximum: 5, description: "Traversal depth (default 1, max 5)" },
      },
    },
    handler: ({ doc_id, depth }) => {
      if (typeof doc_id !== "string" || doc_id.length === 0) return { error: "doc_id required" };
      try { return { results: memory.getLinks(doc_id, depth || 1) || [] }; }
      catch (e) { return { error: e.message }; }
    },
  },

  preflight: {
    description: "Run the full Topic Pre-Flight (lanes A-F + blast radius). Writes .devt/state/preflight-brief.md and returns lane counts.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: { task: { type: "string", description: "Task description, e.g. 'Add MFA to AuthService'" } },
    },
    handler: ({ task }) => {
      if (typeof task !== "string" || task.length === 0) return { error: "task required" };
      try { return preflight.generate(task); }
      catch (e) { return { error: e.message }; }
    },
  },

  blast_radius: {
    description: "Compute Graphify blast radius for subject symbols. Falls back to grep when Graphify is disabled.",
    inputSchema: {
      type: "object",
      required: ["symbols"],
      properties: {
        symbols: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 32 },
      },
    },
    handler: ({ symbols }) => {
      if (!Array.isArray(symbols) || symbols.length === 0) return { error: "symbols required (array of strings)" };
      try { return graphify.blastRadius(symbols); }
      catch (e) { return { error: e.message }; }
    },
  },

  query_index: {
    description: "Raw SQL escape hatch — SELECT-only. Multi-statements, PRAGMA, ATTACH, and DML/DDL are rejected; DB opens read-only.",
    inputSchema: {
      type: "object",
      required: ["sql"],
      properties: {
        sql: { type: "string", description: "A single SELECT (or WITH … SELECT) statement" },
        params: { type: "array", description: "Optional positional bind parameters" },
      },
    },
    handler: ({ sql, params }) => {
      const v = validateSelectOnly(sql);
      if (!v.ok) return { error: `query_index rejected: ${v.reason}`, code: "INVALID_SQL" };
      const args = Array.isArray(params) ? params : [];
      return withReadOnly(db => {
        try {
          const rows = db.prepare(sql).all(...args);
          return { rows };
        } catch (e) {
          return { error: e.message, code: "SQL_ERROR" };
        }
      });
    },
  },
};

// ----------------------------------------------------------------------------
// JSON-RPC 2.0 stdio transport
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
  // Write tools are visible only when DEVT_MCP_ALLOW_WRITES=1. This keeps the
  // tool catalogue lean for non-curator dispatches and ensures Claude doesn't
  // see (and try to call) write tools that are env-gated off anyway.
  const writesEnabled = process.env.DEVT_MCP_ALLOW_WRITES === "1";
  return {
    tools: Object.entries(TOOLS)
      .filter(([, def]) => writesEnabled || !def.writable)
      .map(([name, def]) => ({
        name,
        description: def.description,
        inputSchema: def.inputSchema,
      })),
  };
}

// ----------------------------------------------------------------------------
// Telemetry — tool-call tracing (v0.21.0+)
//
// Each tools/call invocation appends one JSONL line to .devt/memory/_mcp-trace.jsonl
// (gitignored). The line records: timestamp, tool name, args size + sha256 fingerprint
// (NOT the args themselves — privacy/security), result size, error/ok status, duration.
//
// Behavior governed by config: memory.mcp_telemetry (default true). Disable for
// projects that don't want any session-side persistence.
//
// Trace file is auto-managed by `node bin/devt-tools.cjs mcp-stats --prune-older-than=30d`.
// Aggregation reads the same file. No SQL involved — JSONL is the right primitive
// for append-only event logs.
// ----------------------------------------------------------------------------

const crypto = require("crypto");

// Lazy-loaded once on first appendTrace; the MCP server is a long-lived process
// so the cost is paid once. `null` until loaded; thereafter `{enabled, tracePath}`.
let _telemetryState = null;

function getTelemetry() {
  if (_telemetryState) return _telemetryState;
  try {
    const { getMergedConfig, findProjectRoot } = require("./modules/config.cjs");
    const cfg = getMergedConfig();
    const enabled = !cfg.memory || cfg.memory.mcp_telemetry !== false;
    const tracePath = path.join(findProjectRoot(), ".devt", "memory", "_mcp-trace.jsonl");
    _telemetryState = { enabled, tracePath };
  } catch {
    _telemetryState = { enabled: false, tracePath: null };
  }
  return _telemetryState;
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
  // Only write if the parent dir already exists. The MCP server must not have side
  // effects on projects that haven't opted into the memory layer yet.
  if (!fs.existsSync(path.dirname(t.tracePath))) return;
  try {
    fs.appendFileSync(t.tracePath, JSON.stringify(record) + "\n", "utf8");
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

  const tool = TOOLS[name];
  if (!tool) {
    appendTrace({
      ts, tool: name, ok: false, error_code: "TOOL_NOT_FOUND",
      duration_ms: Date.now() - startedAt, args_size: argsSize, args_fp: argsFp, result_size: 0,
    });
    return { error: `unknown tool: ${name}`, code: "TOOL_NOT_FOUND" };
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
    ts, tool: name, ok: !isError, error_code: errorCode,
    duration_ms: Date.now() - startedAt,
    args_size: argsSize, args_fp: argsFp, result_size: resultSize,
  });

  return {
    content: [{ type: "text", text: resultText }],
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
      return; // notification — no reply
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
      // Defer exit to allow response to flush
      process.nextTick(() => process.exit(0));
      return;
    default:
      if (msg.id !== undefined) replyError(msg.id, -32601, `method not found: ${msg.method}`);
      return;
  }
}

// Line-delimited JSON over stdin
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
      // Batch
      for (const m of parsed) handleMessage(m);
    } else {
      handleMessage(parsed);
    }
  }
});
process.stdin.on("end", () => process.exit(0));

// Allow explicit kill
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

// Export internals for unit testing (e.g. from smoke-test)
module.exports = {
  validateSelectOnly,
  stripSqlComments,
  isMultiStatement,
  TOOLS,
  callTool,
  listTools,
  FORBIDDEN_TOKENS,
};

// CLI mode for smoke tests: node bin/devt-memory-mcp.cjs --self-test
if (require.main === module && process.argv.includes("--self-test")) {
  const tests = [
    { sql: "SELECT * FROM documents", expect: true },
    { sql: "  SELECT 1  ", expect: true },
    { sql: "WITH x AS (SELECT 1) SELECT * FROM x", expect: true },
    { sql: "EXPLAIN SELECT 1", expect: true },
    { sql: "INSERT INTO documents VALUES (1)", expect: false },
    { sql: "SELECT 1; INSERT INTO foo VALUES (1)", expect: false },
    { sql: "SELECT 1; -- comment", expect: true },
    { sql: "SELECT 1;", expect: true },
    { sql: "DROP TABLE documents", expect: false },
    { sql: "PRAGMA writable_schema = 1", expect: false },
    { sql: "ATTACH DATABASE 'foo.db' AS foo", expect: false },
    { sql: "/* trick */ DELETE FROM x", expect: false },
    { sql: "SELECT 1 -- ; DROP TABLE x", expect: true },
    { sql: "", expect: false },
    { sql: "BEGIN; SELECT 1", expect: false },
  ];
  let pass = 0, fail = 0;
  for (const t of tests) {
    const got = validateSelectOnly(t.sql).ok;
    const ok = got === t.expect;
    if (ok) pass++;
    else { fail++; console.log(`FAIL: ${JSON.stringify(t.sql)} expected ${t.expect}, got ${got}`); }
  }
  console.log(`SELECT-only validator: ${pass} pass, ${fail} fail (of ${tests.length})`);
  process.exit(fail === 0 ? 0 : 1);
}
