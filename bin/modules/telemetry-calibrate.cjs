"use strict";

/**
 * Telemetry calibrate — mines .devt/state/hook-trace/run-hook.jsonl +
 * dispatch-warnings.jsonl + gate-trace.jsonl + claim-check-failures.jsonl
 * and emits a calibration report.
 *
 * Purpose: data-driven recalibration of guard thresholds, inlined surface
 * byte caps, and cache thresholds. devt's defensive limits were calibrated
 * in early cals against assumed traffic; this CLI surfaces actual usage so
 * thresholds can be set against evidence rather than intuition.
 *
 * Report shape:
 *   {
 *     hooks: {
 *       <script>: { count, exit_zero, exit_nonzero,
 *                   stdin_bytes:  {min, p50, p95, p99, max},
 *                   stdout_bytes: {min, p50, p95, p99, max},
 *                   stderr_bytes: {min, p50, p95, p99, max} }
 *     },
 *     gates: { <gate>: { count, pass, fail } },
 *     dispatch_warnings: { by_source: {...}, by_agent: {...}, total },
 *     recommendations: [ { kind, target, reason, current?, suggested? } ]
 *   }
 *
 * Single-pass over each file; bounded memory (per-key aggregates only).
 */

const fs = require("fs");
const path = require("path");
const { findProjectRoot } = require("./config.cjs");

function _stateDir() {
  try { return path.join(findProjectRoot(), ".devt", "state"); }
  catch { return path.join(process.cwd(), ".devt", "state"); }
}

function _readJsonlSafe(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch { /* skip malformed line */ }
  }
  return out;
}

function _percentile(sortedNums, p) {
  if (!sortedNums.length) return null;
  const idx = Math.min(sortedNums.length - 1, Math.floor(sortedNums.length * p));
  return sortedNums[idx];
}

function _summarizeNums(nums) {
  if (!nums.length) return { count: 0, min: null, p50: null, p95: null, p99: null, max: null };
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: _percentile(sorted, 0.5),
    p95: _percentile(sorted, 0.95),
    p99: _percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  };
}

function _aggregateHookTrace(records) {
  const byScript = new Map();
  for (const r of records) {
    if (!r || typeof r.script !== "string") continue;
    let agg = byScript.get(r.script);
    if (!agg) {
      agg = { count: 0, exit_zero: 0, exit_nonzero: 0, stdin: [], stdout: [], stderr: [] };
      byScript.set(r.script, agg);
    }
    agg.count++;
    if (r.exit === 0) agg.exit_zero++; else agg.exit_nonzero++;
    if (typeof r.stdin_bytes === "number") agg.stdin.push(r.stdin_bytes);
    if (typeof r.stdout_bytes === "number") agg.stdout.push(r.stdout_bytes);
    if (typeof r.stderr_bytes === "number") agg.stderr.push(r.stderr_bytes);
  }
  const out = {};
  for (const [script, agg] of byScript) {
    out[script] = {
      count: agg.count,
      exit_zero: agg.exit_zero,
      exit_nonzero: agg.exit_nonzero,
      stdin_bytes: _summarizeNums(agg.stdin),
      stdout_bytes: _summarizeNums(agg.stdout),
      stderr_bytes: _summarizeNums(agg.stderr),
    };
  }
  return out;
}

function _aggregateGateTrace(records) {
  const byGate = new Map();
  for (const r of records) {
    if (!r || typeof r.gate !== "string") continue;
    let agg = byGate.get(r.gate);
    if (!agg) { agg = { count: 0, pass: 0, fail: 0 }; byGate.set(r.gate, agg); }
    agg.count++;
    // Gate records use either boolean `ok` (newer asserts) or string
    // `verdict` (older assertGraphifyDecision / assertPreflightFresh).
    // Accept both shapes — verdict "ok" is the pass signal.
    if (r.ok === true || r.verdict === "ok" || r.verdict === "pass") agg.pass++;
    else if (r.ok === false || r.verdict === "fail" || r.verdict === "error") agg.fail++;
  }
  const out = {};
  for (const [gate, agg] of byGate) out[gate] = agg;
  return out;
}

function _aggregateDispatchWarnings(records) {
  const bySource = {};
  const byAgent = {};
  for (const r of records) {
    if (!r) continue;
    const src = r.source || "unknown";
    bySource[src] = (bySource[src] || 0) + 1;
    if (typeof r.agent === "string") byAgent[r.agent] = (byAgent[r.agent] || 0) + 1;
  }
  return { total: records.length, by_source: bySource, by_agent: byAgent };
}

/**
 * Generate recalibration recommendations from aggregates. Conservative
 * thresholds — only emits recommendations when the data has enough sample
 * size (count >= 20) AND the gap from current threshold is substantial.
 *
 * Recommendation kinds:
 *   - cap_shrink: hook stdout p95 < 25% of an assumed cap → cap is over-
 *     provisioned, can shrink
 *   - hook_low_value: hook exits 0 with stdout=0 on >90% of fires → may be
 *     candidate to disable (low signal)
 *   - hook_error_pattern: hook exits non-zero on >10% of fires → suggests
 *     bug or environmental issue
 *   - gate_always_pass: gate passes 100% over >=20 fires → low signal, may
 *     be candidate to skip (or evidence the gate is too lax)
 *   - gate_always_fail: gate fails 100% over >=20 fires → broken gate
 */
function _generateRecommendations(report) {
  const recs = [];
  // Note: hook stdout caps are Claude Code hook-contract sized (not devt-
  // configurable), so we DON'T emit cap_shrink_candidate based on hook stdout
  // distribution. Reserve that recommender for genuine devt-configurable caps
  // (graph-impact.md 32KB, governing_rules 96KB, inline_guardrails 64KB) —
  // those need a separate telemetry source (dispatch envelope sizes), not
  // hook-trace.
  for (const [script, agg] of Object.entries(report.hooks)) {
    if (agg.count < 20) continue;

    const zeroStdoutMostRuns = agg.stdout_bytes.count > 0 && agg.stdout_bytes.p95 === 0;
    if (agg.exit_zero / agg.count > 0.95 && zeroStdoutMostRuns) {
      recs.push({
        kind: "hook_low_value",
        target: script,
        reason: `hook fired ${agg.count} times with exit=0 AND stdout=0 on >=95% — low signal, candidate to disable or reduce profile (verify hook is supposed to be quiet vs broken)`,
        fires: agg.count,
      });
    }

    if (agg.count >= 50 && agg.exit_nonzero / agg.count > 0.10) {
      recs.push({
        kind: "hook_error_pattern",
        target: script,
        reason: `hook exited non-zero on ${agg.exit_nonzero}/${agg.count} fires (${Math.round(100 * agg.exit_nonzero / agg.count)}%) — investigate consistent failure mode`,
        nonzero_rate: agg.exit_nonzero / agg.count,
      });
    }
  }

  for (const [gate, agg] of Object.entries(report.gates)) {
    // Higher floor for gates: 100 fires before flagging always-pass. Many
    // gates trivially pass on project shapes that don't exercise the
    // gated condition (e.g. assert-graphify-decision passes when graphify
    // is disabled — that's correct, not a sign of low signal). Bigger
    // sample reduces project-context false positives.
    if (agg.count < 100) continue;
    if (agg.pass === agg.count) {
      recs.push({
        kind: "gate_always_pass",
        target: gate,
        reason: `gate passed ${agg.pass}/${agg.count} (100%) — low signal-to-cost over a substantial sample; review whether the gate catches anything in practice (caveat: may be project-shape-specific — gate may trivially pass on this project's config but fire on others)`,
        fires: agg.count,
      });
    } else if (agg.fail === agg.count) {
      recs.push({
        kind: "gate_always_fail",
        target: gate,
        reason: `gate failed ${agg.fail}/${agg.count} (100%) — likely broken or chronically tripped`,
        fires: agg.count,
      });
    }
  }

  return recs;
}

function calibrate(options = {}) {
  const dir = options.stateDir || _stateDir();
  const hookTraceFile = path.join(dir, "hook-trace", "run-hook.jsonl");
  const gateTraceFile = path.join(dir, "gate-trace.jsonl");
  const dispatchWarnFile = path.join(dir, "dispatch-warnings.jsonl");
  const claimCheckFile = path.join(dir, "claim-check-failures.jsonl");

  const hookRecords = _readJsonlSafe(hookTraceFile);
  const gateRecords = _readJsonlSafe(gateTraceFile);
  const dispatchRecords = _readJsonlSafe(dispatchWarnFile);
  const claimCheckRecords = _readJsonlSafe(claimCheckFile);

  const report = {
    sources: {
      hook_trace: { file: hookTraceFile, records: hookRecords.length, exists: fs.existsSync(hookTraceFile) },
      gate_trace: { file: gateTraceFile, records: gateRecords.length, exists: fs.existsSync(gateTraceFile) },
      dispatch_warnings: { file: dispatchWarnFile, records: dispatchRecords.length, exists: fs.existsSync(dispatchWarnFile) },
      claim_check_failures: { file: claimCheckFile, records: claimCheckRecords.length, exists: fs.existsSync(claimCheckFile) },
    },
    hooks: _aggregateHookTrace(hookRecords),
    gates: _aggregateGateTrace(gateRecords),
    dispatch_warnings: _aggregateDispatchWarnings(dispatchRecords),
    claim_check_failures: { total: claimCheckRecords.length },
  };
  report.recommendations = _generateRecommendations(report);
  return report;
}

function run(subcommand, _args) {
  switch (subcommand) {
    case "calibrate":
      return calibrate();
    default:
      throw new Error(`Unknown telemetry subcommand: ${subcommand}. Use: calibrate`);
  }
}

module.exports = { run, calibrate };
