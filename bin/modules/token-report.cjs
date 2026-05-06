"use strict";

/**
 * Token-cost telemetry — aggregates Claude Code session token usage from JSONL logs
 * at ~/.claude/projects/<slug>/*.jsonl.
 *
 * Phase 5 (v0.20.0+). Mentioned in the plan's Phase 4 success criteria but deferred.
 *
 * The JSONL format records every assistant turn with `message.usage` containing:
 *   - input_tokens                          (uncached prompt tokens)
 *   - cache_creation_input_tokens           (cache writes)
 *   - cache_read_input_tokens               (cache hits — the savings)
 *   - output_tokens
 *
 * Reads-only — never mutates session logs. Zero deps (Node stdlib).
 *
 * Usage:
 *   node bin/devt-tools.cjs token-report                    # current project, last 5 sessions
 *   node bin/devt-tools.cjs token-report --sessions=10      # last 10 sessions
 *   node bin/devt-tools.cjs token-report --since=2026-05-01 # ISO date filter
 *   node bin/devt-tools.cjs token-report --project=<path>   # different project
 */

const fs = require("fs");
const path = require("path");
const { safeJsonParse } = require("./security.cjs");
const os = require("os");
const { atomicWriteJsonSync } = require("./io.cjs");

function projectSlugFromPath(absPath) {
  // Claude Code maps /Users/emrec/Projects/devt → -Users-emrec-Projects-devt
  return absPath.replace(/\//g, "-");
}

/**
 * Validate a user-supplied project path. Must be:
 *   - a string
 *   - absolute (rooted at /)
 *   - normalized (no .. segments after normalization)
 *   - reasonable length (≤4096)
 *
 * Returns the normalized absolute path, or throws.
 */
function validateProjectPath(p) {
  if (typeof p !== "string") throw new Error("project path must be a string");
  if (p.length === 0 || p.length > 4096) throw new Error("project path length out of range");
  if (!path.isAbsolute(p)) throw new Error("project path must be absolute (start with /)");
  const normalized = path.normalize(p);
  if (normalized.includes("..")) throw new Error("project path contains parent-dir traversal after normalization");
  // Disallow null bytes (defense-in-depth)
  if (normalized.indexOf("\0") !== -1) throw new Error("project path contains null bytes");
  return normalized;
}

function getSessionDir(projectPath) {
  // projectPath is either process.cwd() (trusted) or validated user input.
  // validateProjectPath rejects: non-absolute paths, `..` segments after normalization,
  // null bytes, length > 4096. After validation, projectSlugFromPath replaces every
  // `/` with `-`, producing a single-segment basename. The final join with that slug
  // is therefore confined to ~/.claude/projects/<slug>/ — escape is structurally
  // impossible because the slug literally cannot contain a path separator.
  const safe = validateProjectPath(projectPath);
  const slug = projectSlugFromPath(safe);
  // Defense-in-depth: assert the slug invariant explicitly for future readers.
  if (slug.includes(path.sep) || slug.includes("..") || slug.startsWith(".")) {
    throw new Error("derived slug contains unsafe characters");
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  // Suppression rationale: `slug` is a transformed basename, not user input. Its construction
  // (replace / with -) eliminates path separators; the assertion above proves the invariant
  // at runtime. Same pattern as setup.cjs lines 59/124/360 (v0.12.0 path-traversal hardening).
  return path.join(os.homedir(), ".claude", "projects", slug);
}

function listSessionFiles(sessionDir) {
  if (!fs.existsSync(sessionDir)) return [];
  return fs.readdirSync(sessionDir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => {
      const full = path.join(sessionDir, f);
      const stat = fs.statSync(full);
      return { path: full, name: f, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Parse a JSONL session file via line-by-line streaming.
 * Session logs can exceed 100MB; we never hold the full file in memory.
 * Each line is parsed independently with a 1MB-per-line size guard.
 */
function parseSession(filePath) {
  const records = [];
  let errors = 0;
  const MAX_LINE_BYTES = 1048576;
  const fd = fs.openSync(filePath, "r");
  const bufSize = 64 * 1024;
  const buf = Buffer.alloc(bufSize);
  let leftover = "";
  try {
    while (true) {
      const bytes = fs.readSync(fd, buf, 0, bufSize, null);
      if (bytes === 0) break;
      const chunk = leftover + buf.subarray(0, bytes).toString("utf8");
      const lines = chunk.split("\n");
      leftover = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.length > MAX_LINE_BYTES) { errors++; continue; }
        const rec = parseTurnLine(line);
        if (rec === "error") errors++;
        else if (rec) records.push(rec);
      }
    }
    if (leftover.trim() && leftover.length <= MAX_LINE_BYTES) {
      const rec = parseTurnLine(leftover);
      if (rec === "error") errors++;
      else if (rec) records.push(rec);
    }
  } finally {
    fs.closeSync(fd);
  }
  return { records, errors };
}

function parseTurnLine(line) {
  try {
    const result = safeJsonParse(line, "session log line");
    if (!result.ok) return "error";
    const obj = result.value;
    const msg = obj.message;
    if (!msg || msg.role !== "assistant" || !msg.usage) return null;
    const u = msg.usage;
    return {
      timestamp: obj.timestamp || obj.message_timestamp || null,
      model: msg.model || "unknown",
      input: u.input_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      cache_creation: u.cache_creation_input_tokens || 0,
      output: u.output_tokens || 0,
    };
  } catch {
    return "error";
  }
}

function summarizeRecords(records) {
  let input = 0, cacheRead = 0, cacheCreate = 0, output = 0;
  let firstTs = null, lastTs = null;
  for (const r of records) {
    input += r.input;
    cacheRead += r.cache_read;
    cacheCreate += r.cache_creation;
    output += r.output;
    if (r.timestamp) {
      if (!firstTs || r.timestamp < firstTs) firstTs = r.timestamp;
      if (!lastTs || r.timestamp > lastTs) lastTs = r.timestamp;
    }
  }
  const total_input_costed = input + cacheCreate; // cache_read is essentially free
  const total = total_input_costed + output;
  const cache_hit_rate = (cacheRead + total_input_costed) > 0
    ? cacheRead / (cacheRead + total_input_costed)
    : 0;
  return {
    turns: records.length,
    input_tokens: input,
    cache_creation_tokens: cacheCreate,
    cache_read_tokens: cacheRead,
    output_tokens: output,
    total_input_costed: total_input_costed,
    total_with_output: total,
    cache_hit_rate: Number(cache_hit_rate.toFixed(4)),
    first_turn_at: firstTs,
    last_turn_at: lastTs,
  };
}

function buildReport(opts) {
  opts = opts || {};
  const projectPath = opts.project || process.cwd();
  const sessionLimit = opts.sessions || 5;
  const sinceMs = opts.since ? new Date(opts.since).getTime() : 0;

  const sessionDir = getSessionDir(projectPath);
  if (!fs.existsSync(sessionDir)) {
    return {
      project: projectPath,
      session_dir: sessionDir,
      error: "no Claude Code session logs found for this project",
      sessions: [],
    };
  }

  const allFiles = listSessionFiles(sessionDir);
  const filtered = sinceMs > 0 ? allFiles.filter(f => f.mtime >= sinceMs) : allFiles;
  const selected = filtered.slice(0, sessionLimit);

  const sessions = [];
  let agg = { turns: 0, input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };
  for (const f of selected) {
    const { records, errors } = parseSession(f.path);
    const summary = summarizeRecords(records);
    sessions.push({
      session_id: f.name.replace(/\.jsonl$/, ""),
      mtime: new Date(f.mtime).toISOString(),
      file_size_bytes: f.size,
      parse_errors: errors,
      ...summary,
    });
    agg.turns += summary.turns;
    agg.input_tokens += summary.input_tokens;
    agg.cache_creation_tokens += summary.cache_creation_tokens;
    agg.cache_read_tokens += summary.cache_read_tokens;
    agg.output_tokens += summary.output_tokens;
  }

  const aggTotalInputCosted = agg.input_tokens + agg.cache_creation_tokens;
  const aggCacheHit = (agg.cache_read_tokens + aggTotalInputCosted) > 0
    ? agg.cache_read_tokens / (agg.cache_read_tokens + aggTotalInputCosted)
    : 0;

  return {
    project: projectPath,
    session_dir: sessionDir,
    total_sessions_in_project: allFiles.length,
    sessions_in_report: sessions.length,
    aggregate: {
      ...agg,
      total_input_costed: aggTotalInputCosted,
      total_with_output: aggTotalInputCosted + agg.output_tokens,
      cache_hit_rate: Number(aggCacheHit.toFixed(4)),
    },
    sessions,
    plan_targets: {
      // From the v27 plan: "Average tokens per code-review session: target ≤50% of pre-Phase-2 baseline"
      note: "Targets are illustrative — actual baseline measurement requires pre-Phase-2 reference sessions.",
      code_review_per_session_max: 50000,
      dev_workflow_per_session_max: 70000,
      brief_generation_max: { small: 2000, medium: 5000, large: 10000 },
    },
  };
}

/**
 * Compare a current report against a baseline saved via `--baseline=PATH`.
 * Returns delta of aggregate fields + a verdict relative to the v27 plan's
 * success-criteria targets (≤50% code-review, ≤70% dev-workflow, ≤2K-10K Brief).
 */
function compareToBaseline(currentAgg, baselinePath) {
  if (!fs.existsSync(baselinePath)) {
    return { error: `baseline file not found: ${baselinePath}` };
  }
  let baseline;
  let raw;
  try {
    raw = fs.readFileSync(baselinePath, "utf8");
  } catch (e) {
    return { error: `baseline unreadable: ${e.message}` };
  }
  const parseResult = safeJsonParse(raw, "baseline");
  if (!parseResult.ok) {
    return { error: `baseline unreadable: ${parseResult.error}` };
  }
  baseline = parseResult.value;
  const baseAgg = baseline.aggregate || {};
  const pct = (cur, base) => base > 0 ? Number(((cur / base) * 100).toFixed(1)) : null;
  return {
    baseline_path: baselinePath,
    baseline_captured_at: baseline.captured_at || null,
    delta: {
      input_tokens: { baseline: baseAgg.input_tokens || 0, current: currentAgg.input_tokens || 0 },
      cache_creation_tokens: { baseline: baseAgg.cache_creation_tokens || 0, current: currentAgg.cache_creation_tokens || 0 },
      cache_read_tokens: { baseline: baseAgg.cache_read_tokens || 0, current: currentAgg.cache_read_tokens || 0 },
      output_tokens: { baseline: baseAgg.output_tokens || 0, current: currentAgg.output_tokens || 0 },
      total_with_output: { baseline: baseAgg.total_with_output || 0, current: currentAgg.total_with_output || 0 },
      cache_hit_rate: { baseline: baseAgg.cache_hit_rate || 0, current: currentAgg.cache_hit_rate || 0 },
    },
    relative_change_pct: {
      input: pct(currentAgg.input_tokens || 0, baseAgg.input_tokens || 0),
      total: pct(currentAgg.total_with_output || 0, baseAgg.total_with_output || 0),
    },
  };
}

function run(subcommand, args) {
  // Token-report has no subcommands — flags only. Treat any subcommand-shaped first arg as a flag.
  const allArgs = subcommand && subcommand.startsWith("--") ? [subcommand, ...args] : args;
  const opts = require("./cli-args.cjs").parseFlags(allArgs);
  const report = buildReport(opts);

  // --baseline=PATH: snapshot current aggregate as a baseline file (for later --compare).
  if (opts.baseline) {
    const baselineOut = {
      captured_at: new Date().toISOString(),
      project: report.project,
      aggregate: report.aggregate,
      sessions_in_report: report.sessions_in_report,
    };
    atomicWriteJsonSync(opts.baseline, baselineOut);
    report.baseline_written_to = opts.baseline;
  }

  // --compare=PATH: diff current against a previously saved baseline.
  if (opts.compare) {
    report.comparison = compareToBaseline(report.aggregate || {}, opts.compare);
  }

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return 0;
}

module.exports = {
  run,
  buildReport,
  parseSession,
  summarizeRecords,
  getSessionDir,
  projectSlugFromPath,
};
