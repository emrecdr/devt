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
 * node bin/devt-tools.cjs mcp-stats --since-workflow-created # all calls since workflow.yaml::created_at
 * node bin/devt-tools.cjs mcp-stats --tool=query_fts # filter to one tool
 * node bin/devt-tools.cjs mcp-stats --workflow-id=<UUID> # filter to one workflow session
 * node bin/devt-tools.cjs mcp-stats --workflow-type=dev # filter by workflow_type (dev|code_review|…)
 * node bin/devt-tools.cjs mcp-stats --phase=implement # filter by workflow phase
 * node bin/devt-tools.cjs mcp-stats --correlation-id=abc12345 # filter to single MCP call
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

// Workflow-id stamping rotates across init→partition transitions: trace records
// emitted in `context_init` carry the prior workflow_id, then code_review_parallel
// activates a fresh workflow_id, and `mcp-stats --workflow-id=<current>` returns
// an empty result for sessions whose calls all preceded the rotation. Filter by
// time instead — `--since-workflow-created` reads workflow.yaml::created_at and
// captures every call from session start regardless of how workflow_id mutated.
// Returns ISO timestamp string on success, null when workflow.yaml or its
// created_at field is missing — caller decides whether to error or no-op.
function getWorkflowCreatedAt() {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const wfPath = path.join(findProjectRoot(), ".devt", "state", "workflow.yaml");
  if (!fs.existsSync(wfPath)) return null;
  try {
    const raw = fs.readFileSync(wfPath, "utf8");
    // NEW-1: prefer first_created_at (immutable session anchor) over
    // created_at (rotates on workflow_type transitions). When a session
    // does code_review → code_review_parallel mid-flight, created_at
    // jumps forward and trace records from the code_review init phase
    // become unreachable via `--since-workflow-created`. first_created_at
    // anchors session start so all in-session records surface.
    const mFirst = raw.match(/^first_created_at:\s*"?([^"\n]+)"?\s*$/m);
    const mLegacy = raw.match(/^created_at:\s*"?([^"\n]+)"?\s*$/m);
    const m = mFirst || mLegacy;
    if (!m) return null;
    const ts = new Date(m[1]).getTime();
    if (isNaN(ts)) return null;
    return new Date(ts).toISOString();
  } catch {
    return null;
  }
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

// NEW-4 (greenfield calibration #5): trace records use UNPREFIXED tool
// names — the handler name as the MCP server sees it (mcp__devt-graphify__
// blast_radius). Orchestrators call MCP via the plugin-namespace PREFIXED
// form (mcp__plugin_devt_devt-graphify__blast_radius) per Claude Code's
// plugin loader. Without normalization, mcp-stats --tool=<prefixed> matches
// nothing because exact equality compares two forms that are functionally
// equivalent but lexically different. The fix normalizes BOTH the query
// pattern and the trace record's tool field to the unprefixed form before
// comparison. Result: users can query in either form and get the same
// match set.
function normalizeToolName(name) {
  if (typeof name !== "string") return name;
  // mcp__plugin_<plugin>_<service>__<tool> → mcp__<service>__<tool>
  // The plugin segment is the user-installed namespace; the service segment
  // is the MCP server's handler-registered name. Trace records preserve
  // only the service+tool portion. Plugin names may contain hyphens but
  // not underscores by convention — the character class excludes `_` so
  // the regex stops at the first `_` after `mcp__plugin_`, leaving the
  // service segment (which may contain hyphens, e.g., `devt-graphify`) intact.
  return name.replace(/^mcp__plugin_[a-z0-9-]+_/, "mcp__");
}

function loadEntries(opts) {
  opts = opts || {};
  const tracePath = getTracePath();
  // Builds a tool-name matcher. Pattern with `*` → glob (anchored regex);
  // no `*` → exact equality. Glob supports `*` only (no `?`, no character classes).
  // Both pattern and tool-name normalized through normalizeToolName so
  // prefixed/unprefixed forms match equivalently.
  function buildToolMatcher(pat) {
    const normPat = normalizeToolName(pat);
    if (!normPat.includes("*")) return (t) => normalizeToolName(t) === normPat;
    // Cap pattern length to prevent ReDoS on hostile input. Real tool names
    // are short (mcp__plugin_<name>__<tool>), 200 chars is well above any
    // legitimate use. Special regex metachars are escaped before `*` → `.*`
    // substitution so only the literal `*` becomes a wildcard.
    if (normPat.length > 200) return () => false;
    const esc = normPat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    const re = new RegExp("^" + esc + "$");
    return (t) => typeof t === "string" && re.test(normalizeToolName(t));
  }
  const parsed = readJsonlLines(tracePath);
  if (!parsed.exists) return { entries: [], path: tracePath, exists: false };
  const sinceMs = opts.since ? new Date(opts.since).getTime() : 0;
  // Tool filter: exact match when no `*` wildcard, glob match otherwise.
  // Wildcards already in active use by workflows/code-review.md present_findings
  // (`mcp__devt-graphify__*`) — prior implementation did exact-only match,
  // returning 0 entries for every wildcard query and breaking the telemetry surface.
  const toolMatcher = opts.tool ? buildToolMatcher(opts.tool) : null;
  // HF-2 (greenfield calibration #7): when --workflow-id is supplied, union
  // with original_workflow_id from workflow.yaml so trace records written
  // BEFORE a workflow_type rotation still match. mcp-stats previously did
  // strict equality against opts.workflow_id, returning 0 entries when the
  // user passed the post-rotation id. The union recovers attribution for
  // the entire session window even when --since-workflow-created is not used.
  let acceptedWorkflowIds = null;
  if (opts.workflow_id) {
    acceptedWorkflowIds = new Set([opts.workflow_id]);
    try {
      const wfPath = path.join(findProjectRoot(), ".devt", "state", "workflow.yaml");
      if (fs.existsSync(wfPath)) {
        const raw = fs.readFileSync(wfPath, "utf8");
        const wfMatch = raw.match(/^workflow_id:\s*"?([^"\n]+)"?\s*$/m);
        const origMatch = raw.match(/^original_workflow_id:\s*"?([^"\n]+)"?\s*$/m);
        // Only union when the user-supplied id matches the CURRENT workflow
        // (i.e., "I'm asking about THIS session"). If user passes a historical
        // id, leave the filter strict so historical queries stay deterministic.
        if (wfMatch && wfMatch[1].trim() === opts.workflow_id && origMatch) {
          acceptedWorkflowIds.add(origMatch[1].trim());
        }
      }
    } catch { /* leave acceptedWorkflowIds as just the user-supplied id */ }
  }
  const entries = parsed.entries.filter(e => {
    if (sinceMs > 0 && e.ts && new Date(e.ts).getTime() < sinceMs) return false;
    if (toolMatcher && !toolMatcher(e.tool)) return false;
    // Workflow-context filters. Trace records pre-v0.39.0 (and any emitted
    // outside an active workflow) lack these fields → excluded when the
    // corresponding filter is set. Bare aggregate (no filters) still includes them.
    if (acceptedWorkflowIds && !acceptedWorkflowIds.has(e.workflow_id)) return false;
    if (opts.workflow_type && e.workflow_type !== opts.workflow_type) return false;
    if (opts.phase && e.phase !== opts.phase) return false;
    if (opts.correlation_id && e.correlation_id !== opts.correlation_id) return false;
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

  // `--since-workflow-created` resolves to a time-based filter against
  // workflow.yaml::created_at, mitigating workflow_id rotation across
  // init→partition transitions. Composes conjunctively with --since: when
  // both are set, the later (most-restrictive) timestamp wins.
  let workflowCreatedAt = null;
  if (opts.since_workflow_created) {
    workflowCreatedAt = getWorkflowCreatedAt();
    if (!workflowCreatedAt) {
      process.stderr.write(JSON.stringify({
        error: "no workflow.yaml::created_at — start a workflow or pass --since=<ISO> explicitly",
        path: path.join(findProjectRoot(), ".devt", "state", "workflow.yaml"),
      }) + "\n");
      return 2;
    }
    const explicitSince = opts.since ? new Date(opts.since).getTime() : 0;
    const wfSince = new Date(workflowCreatedAt).getTime();
    opts.since = new Date(Math.max(explicitSince, wfSince)).toISOString();
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
      since_workflow_created: workflowCreatedAt,
      tool: opts.tool || null,
      correlation_id: opts.correlation_id || null,
      top: opts.top || null,
      by: opts.top ? (opts.by || "calls") : null,
    },
    ...(summary ? { aggregate: summary.aggregate, tools } : { aggregate: null, tools: [] }),
  });
  return 0;
}

module.exports = { run, loadEntries, summarize, pruneOlderThan, getTracePath, parseDuration, getWorkflowCreatedAt, normalizeToolName };
