"use strict";

/**
 * Per-hook migration ROI estimator.
 *
 * Reads .devt/state/hook-trace/run-hook.jsonl (universal invocation trace,
 * written by hooks/run-hook.js) and reports — for each hook script — what
 * a migration from shell `command` type to LLM `prompt` type would cost in
 * tokens, dollars, and added latency.
 *
 * Cross-references hooks/hooks.json to discover each script's event(s) so
 * lifecycle hooks (SessionStart, Stop, SubagentStart/Stop) are never
 * recommended for prompt-hook migration — those don't make decisions and
 * the cost would be pure overhead.
 *
 * Brittleness score is regex/sed/awk usage in the hook body (proxy for the
 * kind of brittle pattern-matching that LLM judgment naturally improves on).
 *
 * Output is JSON; pipe to jq for readable tables.
 *
 * Usage:
 *   node bin/devt-tools.cjs hook-cost-estimate              # 7-day window
 *   node bin/devt-tools.cjs hook-cost-estimate --window=30d # 30-day window
 *   node bin/devt-tools.cjs hook-cost-estimate --window=24h # 24-hour window
 */

const fs = require("fs");
const path = require("path");

// Cost model — fast-model pricing approximation (revisit if Anthropic
// pricing shifts substantially). Numbers are order-of-magnitude correct;
// rankings are insensitive to exact rates because every hook gets the
// same multiplier.
const BYTES_PER_TOKEN = 3.5;
const OUTPUT_TOKENS_PER_PROMPT_HOOK = 50;
const COST_INPUT_USD_PER_1K = 0.0008;
const COST_OUTPUT_USD_PER_1K = 0.004;
const LATENCY_SEC_PER_FIRE = 1.5;

// Threshold tuning — verified against real devt trace data (see K93 smoke
// test). The fires-cap on "migrate" prevents recommending high-frequency
// hooks where the cumulative latency overhead outweighs the brittleness
// reduction.
const MIGRATE_BRITTLENESS_MIN = 4;
const MIGRATE_FIRES_MAX = 200;
const CONSIDER_BRITTLENESS_MIN = 3;
const CONSIDER_COST_MIN_USD = 0.50;

const DECISION_EVENTS = new Set(["PreToolUse", "PostToolUse"]);
const LIFECYCLE_EVENTS = new Set([
  "SessionStart", "Stop", "SubagentStart", "SubagentStop",
  "UserPromptSubmit", "SessionEnd", "PreCompact", "PostCompact",
]);

function parseWindow(s) {
  const m = String(s).match(/^(\d+)([dh])$/);
  if (!m) throw new Error("invalid --window=" + s + " (use Nd or Nh)");
  const n = parseInt(m[1], 10);
  return m[2] === "d" ? n * 86_400_000 : n * 3_600_000;
}

function loadHookEventsMap(hooksDir) {
  const cfg = path.join(hooksDir, "hooks.json");
  const map = {};
  if (!fs.existsSync(cfg)) return map;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cfg, "utf8"));
  } catch {
    return map;
  }
  for (const evt of Object.keys(parsed.hooks || {})) {
    for (const block of parsed.hooks[evt] || []) {
      for (const hk of block.hooks || []) {
        const m = (hk.command || "").match(/run-hook\.js"\s+(\S+)/);
        if (!m) continue;
        const script = m[1].replace(/^"|"$/g, "");
        if (!map[script]) map[script] = [];
        if (!map[script].includes(evt)) map[script].push(evt);
      }
    }
  }
  return map;
}

function brittlenessFromHookBody(hooksDir, scriptName) {
  const p = path.join(hooksDir, scriptName);
  if (!fs.existsSync(p)) return { lines_of_code: 0, regex_count: 0 };
  const body = fs.readFileSync(p, "utf8");
  const lines_of_code = body.split("\n").length;
  // Brittleness proxies: pattern-match constructs an LLM judge would
  // naturally improve on. devt's hooks do most pattern matching inside
  // `node -e` heredoc blocks via JS regex (.test/.match), not shell tools
  // — so JS-regex calls dominate the signal. Shell-side patterns (grep -E,
  // sed -E, awk, bash =~) are also counted for completeness.
  const jsTest = (body.match(/\.test\(/g) || []).length;
  const jsMatch = (body.match(/\.match\(/g) || []).length;
  const bashRegex = (body.match(/=~/g) || []).length;
  const shellGrepExt = (body.match(/grep\s+-[EP]/g) || []).length;
  const shellSedExt = (body.match(/sed\s+-E/g) || []).length;
  const shellAwk = (body.match(/\bawk\b/g) || []).length;
  const regex_count = jsTest + jsMatch + bashRegex + shellGrepExt + shellSedExt + shellAwk;
  return { lines_of_code, regex_count };
}

function classifyRecommendation({ events, brittleness, fires, cost_total }) {
  const isDecision = events.some((e) => DECISION_EVENTS.has(e));
  const isLifecycle = events.some((e) => LIFECYCLE_EVENTS.has(e));

  if (!isDecision && isLifecycle) return "stay";
  if (brittleness >= MIGRATE_BRITTLENESS_MIN && fires <= MIGRATE_FIRES_MAX) return "migrate";
  if (brittleness >= CONSIDER_BRITTLENESS_MIN || cost_total >= CONSIDER_COST_MIN_USD) return "consider";
  return "stay";
}

function estimateFromTrace(opts = {}) {
  const windowMs = parseWindow(opts.window || "7d");
  const cwd = opts.cwd || process.cwd();
  const tracePath = opts.tracePath || path.join(cwd, ".devt/state/hook-trace/run-hook.jsonl");
  const hooksDir = opts.hooksDir || path.resolve(__dirname, "..", "..", "hooks");

  if (!fs.existsSync(tracePath)) {
    return { ok: false, reason: "no trace at " + tracePath, hint: "hooks may not have fired yet, or DEVT_HOOK_TRACE=0 is set" };
  }

  const cutoff = Date.now() - windowMs;
  const eventMap = loadHookEventsMap(hooksDir);
  const byHook = {};

  const raw = fs.readFileSync(tracePath, "utf8");
  for (const ln of raw.split("\n")) {
    if (!ln) continue;
    let r;
    try { r = JSON.parse(ln); } catch { continue; }
    const ts = Date.parse(r.ts);
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const name = r.script;
    // Filter degenerate records (event-name as script, missing script field)
    if (!name || /^[A-Z][a-zA-Z]+$/.test(name)) continue;
    if (!byHook[name]) byHook[name] = { fires: 0, stdin_sum: 0, stdin_n: 0, exits_nonzero: 0 };
    const slot = byHook[name];
    slot.fires++;
    if (typeof r.stdin_bytes === "number") {
      slot.stdin_sum += r.stdin_bytes;
      slot.stdin_n++;
    }
    if (r.exit !== 0) slot.exits_nonzero++;
  }

  const hooks = [];
  for (const [name, stats] of Object.entries(byHook)) {
    const avg_stdin_bytes = stats.stdin_n > 0 ? stats.stdin_sum / stats.stdin_n : 0;
    const tokens_in = Math.ceil(avg_stdin_bytes / BYTES_PER_TOKEN);
    const tokens_out = OUTPUT_TOKENS_PER_PROMPT_HOOK;
    const cost_per_fire = (tokens_in / 1000) * COST_INPUT_USD_PER_1K + (tokens_out / 1000) * COST_OUTPUT_USD_PER_1K;
    const cost_total = cost_per_fire * stats.fires;
    const latency_total_sec = stats.fires * LATENCY_SEC_PER_FIRE;
    const { lines_of_code, regex_count } = brittlenessFromHookBody(hooksDir, name);
    const events = eventMap[name] || [];
    const brittleness = regex_count;
    const recommend = classifyRecommendation({ events, brittleness, fires: stats.fires, cost_total });

    hooks.push({
      hook: name,
      events,
      fires: stats.fires,
      exits_nonzero: stats.exits_nonzero,
      avg_stdin_bytes: Math.round(avg_stdin_bytes),
      lines_of_code,
      regex_count,
      brittleness,
      est_tokens_in_per_fire: tokens_in,
      est_tokens_out_per_fire: tokens_out,
      est_cost_usd_per_fire: Number(cost_per_fire.toFixed(6)),
      est_cost_usd_total: Number(cost_total.toFixed(4)),
      est_latency_added_sec_total: latency_total_sec,
      recommend,
    });
  }
  hooks.sort((a, b) => b.fires - a.fires);

  return {
    ok: true,
    window_days: windowMs / 86_400_000,
    trace_file: tracePath,
    total_hooks: hooks.length,
    summary: {
      migrate: hooks.filter((h) => h.recommend === "migrate").map((h) => h.hook),
      consider: hooks.filter((h) => h.recommend === "consider").map((h) => h.hook),
      stay: hooks.filter((h) => h.recommend === "stay").map((h) => h.hook),
      total_est_cost_usd_per_window: Number(
        hooks.reduce((a, h) => a + h.est_cost_usd_total, 0).toFixed(4)
      ),
    },
    hooks,
  };
}

function run(args) {
  let window = "7d";
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--window=")) window = args[i].slice("--window=".length);
  }
  try {
    const result = estimateFromTrace({ window });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result.ok ? 0 : 1;
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + "\n");
    return 1;
  }
}

module.exports = { estimateFromTrace, classifyRecommendation, run };
