"use strict";

/**
 * Stuck-agent detector — counts deny records in the current workflow session.
 *
 * Reads .devt/state/preflight-denies.jsonl, filters records by the session
 * boundary (workflow.yaml::created_at if present, else its filesystem mtime),
 * and reports stuck=true when ≥3 denies exist. Surfaces every source equally
 * (preflight, bash_destroy, no_verify) so autonomous flows pause when ANY
 * guardrail triggers repeatedly — not just preflight ones.
 */

const fs = require("fs");
const path = require("path");

const STUCK_THRESHOLD = 3;

function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".devt")) || fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

// Parse `created_at: "ISO-string"` from a YAML body. We hand-parse instead of
// pulling in the YAML helper because the value is always a single quoted ISO
// timestamp written by state.cjs::updateState — the broader YAML grammar adds
// no value here and would couple this module to state.cjs's serializer.
function extractCreatedAtFromYaml(body) {
  const m = body.match(/^\s*created_at:\s*"?([^"\n\r]+)"?\s*$/m);
  return m ? m[1].trim() : null;
}

function resolveSessionStart(stateDir) {
  const workflowPath = path.join(stateDir, "workflow.yaml");
  let stat;
  try {
    stat = fs.statSync(workflowPath);
  } catch {
    return null; // no active workflow → no session boundary → caller treats as not-stuck
  }
  try {
    const body = fs.readFileSync(workflowPath, "utf8");
    const createdAt = extractCreatedAtFromYaml(body);
    if (createdAt) return createdAt;
  } catch {
    /* fall through to mtime */
  }
  return stat.mtime.toISOString();
}

function checkStuckSignal(stateDir) {
  const sessionStartedAt = resolveSessionStart(stateDir);
  if (!sessionStartedAt) {
    return { stuck: false, deny_count: 0, denies: [], session_started_at: null };
  }

  const logPath = path.join(stateDir, "preflight-denies.jsonl");
  if (!fs.existsSync(logPath)) {
    return { stuck: false, deny_count: 0, denies: [], session_started_at: sessionStartedAt };
  }

  const denies = [];
  let body;
  try {
    body = fs.readFileSync(logPath, "utf8");
  } catch {
    return { stuck: false, deny_count: 0, denies: [], session_started_at: sessionStartedAt };
  }

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue; // malformed line — skip, never fail the detector on partial corruption
    }
    if (!rec.ts || typeof rec.ts !== "string") continue;
    if (rec.ts < sessionStartedAt) continue; // pre-session deny — ignore
    denies.push({
      ts: rec.ts,
      source: rec.source || "preflight", // legacy records have no source field
      reason: rec.reason || rec.rule_id || "",
    });
  }

  return {
    stuck: denies.length >= STUCK_THRESHOLD,
    deny_count: denies.length,
    denies,
    session_started_at: sessionStartedAt,
  };
}

function run(subcommand) {
  if (subcommand && subcommand !== "check") {
    process.stderr.write("Usage: stuck check  (reports JSON to stdout)\n");
    return 2;
  }
  const root = findProjectRoot();
  const stateDir = path.join(root, ".devt", "state");
  const signal = checkStuckSignal(stateDir);
  process.stdout.write(JSON.stringify(signal));
  return 0;
}

module.exports = { checkStuckSignal, run, STUCK_THRESHOLD };
