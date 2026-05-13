"use strict";

/**
 * MCP telemetry aggregator.
 *
 * Reads the JSONL trace file appended by bin/devt-memory-mcp.cjs at
 * .devt/memory/_mcp-trace.jsonl and computes per-tool statistics:
 * - call count
 * - error count + rate
 * - duration percentiles (p50, p95, p99) — useful for spotting slow tools
 * - cumulative result size (bytes)
 * - first / last call timestamp
 *
 * Also supports `--prune-older-than=30d` to compact the trace file by
 * dropping entries older than the cutoff.
 *
 * Zero deps (Node stdlib). Privacy-safe: trace records contain no args/results,
 * just sizes + sha256 fingerprints.
 *
 * Usage:
 * node bin/devt-tools.cjs mcp-stats # aggregate all entries
 * node bin/devt-tools.cjs mcp-stats --since=2026-05-01 # ISO date filter
 * node bin/devt-tools.cjs mcp-stats --tool=query_fts # filter to one tool
 * node bin/devt-tools.cjs mcp-stats --workflow-id=<UUID> # filter to one workflow session
 * node bin/devt-tools.cjs mcp-stats --workflow-type=dev # filter by workflow_type (dev|code_review|…)
 * node bin/devt-tools.cjs mcp-stats --phase=implement # filter by workflow phase
 * node bin/devt-tools.cjs mcp-stats --prune-older-than=30d
 *
 * Filters compose conjunctively — e.g. `--workflow-type=dev --phase=verify --tool=query_fts`
 * shows verifier-phase memory calls across all dev workflows. The workflow_*
 * fields are populated by the MCP server from .devt/state/workflow.yaml; trace
 * records emitted outside any workflow lack these fields and are excluded by
 * the corresponding filters.
 */

const fs = require("fs");
const path = require("path");
const { findProjectRoot } = require("./config.cjs");
const { safeJsonParse } = require("./security.cjs");
const { atomicWriteFileSync } = require("./io.cjs");

function getTracePath() {
  return path.join(findProjectRoot(), ".devt", "memory", "_mcp-trace.jsonl");
}

function parseDuration(spec) {
  // Accept formats like "30d", "12h", "5m", "120s"
  const m = String(spec).trim().match(/^(\d+)([dhms])$/);
  if (!m) throw new Error(`invalid duration: ${spec} (use Nd|Nh|Nm|Ns)`);
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const ms = unit === "d" ? 86400e3 : unit === "h" ? 3600e3 : unit === "m" ? 60e3 : 1e3;
  return n * ms;
}

/**
 * Read a JSONL trace file and parse each non-blank line.
 * Returns parallel arrays so callers can choose between parsed objects
 * (for filtering/aggregation) and raw lines (for round-trip rewrites that
 * preserve byte-for-byte ordering, e.g. prune).
 */
function readJsonlLines(filePath) {
  if (!fs.existsSync(filePath)) return { entries: [], raw: [], parseErrors: 0, exists: false };
  const content = fs.readFileSync(filePath, "utf8");
  const entries = [];
  const raw = [];
  let parseErrors = 0;
  for (const line of content.split("\n")) {
    if (line.trim().length === 0) continue;
    const result = safeJsonParse(line, "MCP trace line");
    if (result.ok) { entries.push(result.value); raw.push(line); }
    else { parseErrors++; }
  }
  return { entries, raw, parseErrors, exists: true };
}

function loadEntries(opts) {
  opts = opts || {};
  const tracePath = getTracePath();
  const parsed = readJsonlLines(tracePath);
  if (!parsed.exists) return { entries: [], path: tracePath, exists: false };
  const sinceMs = opts.since ? new Date(opts.since).getTime() : 0;
  const entries = parsed.entries.filter(e => {
    if (sinceMs > 0 && e.ts && new Date(e.ts).getTime() < sinceMs) return false;
    if (opts.tool && e.tool !== opts.tool) return false;
    // Workflow-context filters. Trace records pre-v0.39.0 (and any emitted
    // outside an active workflow) lack these fields → excluded when the
    // corresponding filter is set. Bare aggregate (no filters) still includes them.
    if (opts.workflow_id && e.workflow_id !== opts.workflow_id) return false;
    if (opts.workflow_type && e.workflow_type !== opts.workflow_type) return false;
    if (opts.phase && e.phase !== opts.phase) return false;
    return true;
  });
  return { entries, path: tracePath, exists: true, parse_errors: parsed.parseErrors };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(entries) {
  if (entries.length === 0) return null;
  const byTool = {};
  let firstTs = null, lastTs = null;
  for (const e of entries) {
    const k = e.tool || "(unknown)";
    if (!byTool[k]) byTool[k] = { tool: k, calls: 0, errors: 0, durations: [], result_bytes: 0, error_codes: {} };
    const t = byTool[k];
    t.calls++;
    if (!e.ok) {
      t.errors++;
      const code = e.error_code || "UNKNOWN";
      t.error_codes[code] = (t.error_codes[code] || 0) + 1;
    }
    if (typeof e.duration_ms === "number") t.durations.push(e.duration_ms);
    if (typeof e.result_size === "number") t.result_bytes += e.result_size;
    if (e.ts) {
      if (!firstTs || e.ts < firstTs) firstTs = e.ts;
      if (!lastTs || e.ts > lastTs) lastTs = e.ts;
    }
  }
  const tools = Object.values(byTool).map(t => {
    const sorted = t.durations.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
      tool: t.tool,
      calls: t.calls,
      errors: t.errors,
      error_rate: t.calls > 0 ? Number((t.errors / t.calls).toFixed(4)) : 0,
      error_codes: t.error_codes,
      duration_ms: {
        min: sorted.length ? sorted[0] : null,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted.length ? sorted[sorted.length - 1] : null,
        avg: sorted.length ? Number((sum / sorted.length).toFixed(2)) : null,
      },
      result_bytes_total: t.result_bytes,
    };
  }).sort((a, b) => b.calls - a.calls);

  const totalCalls = tools.reduce((s, t) => s + t.calls, 0);
  const totalErrors = tools.reduce((s, t) => s + t.errors, 0);

  return {
    aggregate: {
      total_calls: totalCalls,
      total_errors: totalErrors,
      error_rate: totalCalls > 0 ? Number((totalErrors / totalCalls).toFixed(4)) : 0,
      first_ts: firstTs,
      last_ts: lastTs,
      tools_used: tools.length,
    },
    tools,
  };
}

function pruneOlderThan(spec) {
  const ms = parseDuration(spec);
  const cutoff = Date.now() - ms;
  const tracePath = getTracePath();
  const parsed = readJsonlLines(tracePath);
  if (!parsed.exists) return { pruned: 0, kept: 0, path: tracePath, exists: false };
  const kept = [];
  // Unparseable lines were already dropped by readJsonlLines (parseErrors); count them as pruned.
  let pruned = parsed.parseErrors;
  for (let i = 0; i < parsed.entries.length; i++) {
    const tsMs = parsed.entries[i].ts ? new Date(parsed.entries[i].ts).getTime() : 0;
    if (tsMs >= cutoff) kept.push(parsed.raw[i]);
    else pruned++;
  }
  atomicWriteFileSync(tracePath, kept.join("\n") + (kept.length > 0 ? "\n" : ""));
  return { pruned, kept: kept.length, path: tracePath, cutoff_iso: new Date(cutoff).toISOString() };
}

function run(subcommand, args) {
  const allArgs = subcommand && subcommand.startsWith("--") ? [subcommand, ...args] : args;
  const opts = require("./cli-args.cjs").parseFlags(allArgs);
  const json = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");

  // Prune mode
  if (opts.prune_older_than) {
    try { json(pruneOlderThan(opts.prune_older_than)); return 0; }
    catch (e) { process.stderr.write(JSON.stringify({ error: e.message }) + "\n"); return 2; }
  }

  // Aggregate mode (default)
  const loaded = loadEntries(opts);
  if (!loaded.exists) {
    json({ error: "no MCP trace file found", path: loaded.path, hint: "MCP server has not been invoked yet, or memory.mcp_telemetry is false" });
    return 0;
  }
  const summary = summarize(loaded.entries);

  // --top=N --by=calls|duration|errors — narrow tools[] to the top-N by chosen metric
  let tools = (summary && summary.tools) || [];
  if (opts.top) {
    const n = Math.max(1, Math.min(100, parseInt(opts.top, 10) || 5));
    const by = (opts.by || "calls").toLowerCase();
    const sorter = {
      calls: (a, b) => b.calls - a.calls,
      duration: (a, b) => (b.duration_ms.p95 || 0) - (a.duration_ms.p95 || 0),
      errors: (a, b) => b.errors - a.errors,
    }[by];
    if (!sorter) {
      process.stderr.write(JSON.stringify({ error: `--by must be one of: calls | duration | errors (got '${opts.by}')` }) + "\n");
      return 2;
    }
    tools = tools.slice().sort(sorter).slice(0, n);
  }

  json({
    trace_path: loaded.path,
    parse_errors: loaded.parse_errors,
    entries_considered: loaded.entries.length,
    filters: {
      since: opts.since || null,
      tool: opts.tool || null,
      top: opts.top || null,
      by: opts.top ? (opts.by || "calls") : null,
    },
    ...(summary ? { aggregate: summary.aggregate, tools } : { aggregate: null, tools: [] }),
  });
  return 0;
}

module.exports = { run, loadEntries, summarize, pruneOlderThan, getTracePath, parseDuration };
