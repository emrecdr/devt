"use strict";

/**
 * State management — .devt/state/ directory operations.
 *
 * .devt/state/ is the shared state bus between workflow steps and agents.
 * Each file is written by one agent, read by subsequent agents.
 */

const fs = require("fs");
const path = require("path");
const { findProjectRoot } = require("./config.cjs");

const STATE_DIR = path.join(".devt", "state");
const WORKFLOW_FILE = "workflow.yaml";
const LOCK_TIMEOUT_MS = 3000;
const LOCK_RETRY_MS = 50;

function getStateDir() {
  return path.join(findProjectRoot(), STATE_DIR);
}

function getWorkflowPath() {
  return path.join(getStateDir(), WORKFLOW_FILE);
}

function ensureStateDir() {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Simple YAML-like parser for workflow state.
 * Handles flat key: value pairs and basic nesting.
 */
function parseSimpleYaml(content) {
  const result = {};
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([\w-]+):\s*(.+)$/);
    if (match) {
      const [, key, rawValue] = match;
      let value = rawValue;
      // Handle quoted strings
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
        result[key] = value;
      } else if (value === "true") result[key] = true;
      else if (value === "false") result[key] = false;
      else if (value === "null") result[key] = null;
      else if (/^\d+$/.test(value)) result[key] = parseInt(value, 10);
      else result[key] = value;
    }
  }
  return result;
}

function serializeSimpleYaml(obj) {
  return (
    Object.entries(obj)
      .map(([key, value]) => {
        if (typeof value === "string" && (value.includes(":") || value.includes("\n") || value.includes('"') || value.includes("#"))) {
          return `${key}: "${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
        }
        return `${key}: ${value}`;
      })
      .join("\n") + "\n"
  );
}

// Known state keys with expected types — warns on mismatch, does not block writes
const KNOWN_STATE_KEYS = {
  active: "boolean",
  phase: "string",
  tier: "string",
  complexity: "string", // legacy alias for tier — kept for backward compat with existing state files
  iteration: "number",
  task: "string",
  workflow_id: "string",
  workflow_type: "string",
  last_session: "string",
  stopped_at: "string",
  stopped_phase: "string",
  skipped_phases: "string",
  resume_context: "string",
  decisions_file: "string",
  status: "string",
  autonomous: "boolean",
  autonomous_chain: "string",
  verdict: "string",
  repair: "string",
  verify_iteration: "number",
};

const VALID_PHASES = new Set([
  "context_init", "flow_deviation", "assess", "risk_warning",
  "scan", "regression_baseline", "arch_health", "arch_health_scan", "plan",
  "architect", "implement", "test", "simplify", "review", "verify",
  "docs", "retro", "curate", "autoskill", "review_deferred",
  "identify_scope", "debug", "complete", "finalize", null,
]);

const VALID_TIERS = new Set(["TRIVIAL", "SIMPLE", "STANDARD", "COMPLEX", null]);

const VALID_WORKFLOW_TYPES = new Set([
  "dev", "quick_implement", "debug", "retro", "code_review", "arch_health_scan",
  "research", "plan", "specify", "clarify", null,
]);

function warnState(msg) {
  process.stderr.write(JSON.stringify({ state_warning: msg }) + "\n");
}

function validateStateEntry(key, value) {
  const expected = KNOWN_STATE_KEYS[key];
  if (!expected) return; // Unknown keys are allowed (extensibility)
  if (value === null) return; // Null is valid for any key
  if (typeof value !== expected) {
    warnState(`${key} should be ${expected}, got ${typeof value}`);
  }
  if (key === "phase" && !VALID_PHASES.has(value)) {
    warnState(`Unknown phase "${value}"`);
  }
  if ((key === "tier" || key === "complexity") && !VALID_TIERS.has(value)) {
    warnState(`Unknown tier "${value}"`);
  }
  if (key === "workflow_type" && !VALID_WORKFLOW_TYPES.has(value)) {
    warnState(`Unknown workflow_type "${value}"`);
  }
  if (key === "complexity") {
    warnState(`"complexity" is deprecated — use "tier" instead`);
  }
}

function readState() {
  const filePath = getWorkflowPath();
  if (!fs.existsSync(filePath)) {
    return { active: false, phase: null, tier: null, iteration: 0 };
  }
  const parsed = parseSimpleYaml(fs.readFileSync(filePath, "utf8"));
  // Normalize legacy "complexity" key to "tier" so consumers only check one field
  if (parsed.complexity && !parsed.tier) {
    parsed.tier = parsed.complexity;
  }
  return parsed;
}

/**
 * Validate consistency between workflow phases and expected artifacts.
 * For each phase that has been "passed through" (i.e., phase is beyond it),
 * check that the expected artifact file exists in .devt/state/.
 *
 * Returns { consistent: true/false, mismatches: [{phase, expected_artifact, exists}] }
 */
function validateConsistency() {
  const state = readState();
  const stateDir = getStateDir();

  // Phase→artifact mapping
  const PHASE_ARTIFACTS = {
    implement: "impl-summary.md",
    test: "test-summary.md",
    review: "review.md",
    verify: "verification.md",
  };

  // Conditional mappings based on workflow_type
  if (state.workflow_type === "plan") {
    PHASE_ARTIFACTS.plan = "plan.md";
  }
  if (state.workflow_type === "debug") {
    PHASE_ARTIFACTS.debug = "debug-summary.md";
  }
  // Retro always maps to lessons.yaml
  PHASE_ARTIFACTS.retro = "lessons.yaml";

  // Ordered phases to determine which have been "passed through"
  const PHASE_ORDER = [
    "context_init", "flow_deviation", "assess", "risk_warning",
    "scan", "regression_baseline", "arch_health", "arch_health_scan",
    "plan", "architect", "implement", "test", "simplify", "review",
    "verify", "docs", "retro", "curate", "autoskill", "review_deferred",
    "debug", "complete", "finalize",
  ];

  const currentPhaseIndex = PHASE_ORDER.indexOf(state.phase);
  if (currentPhaseIndex === -1) {
    // Unknown phase or no phase — return consistent (nothing to validate)
    return { consistent: true, mismatches: [] };
  }

  const mismatches = [];
  for (const [phase, artifact] of Object.entries(PHASE_ARTIFACTS)) {
    const phaseIndex = PHASE_ORDER.indexOf(phase);
    if (phaseIndex === -1) continue;
    // Only check phases that have been passed through (current phase is beyond them)
    if (currentPhaseIndex > phaseIndex) {
      const artifactPath = path.join(stateDir, artifact);
      const exists = fs.existsSync(artifactPath);
      if (!exists) {
        mismatches.push({ phase, expected_artifact: artifact, exists: false });
      }
    }
  }

  return { consistent: mismatches.length === 0, mismatches };
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

function acquireLock() {
  const lockFile = path.join(getStateDir(), ".lock");
  const start = Date.now();

  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      // Atomic create — fails if file already exists (prevents race condition)
      fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      return lockFile;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      sleepSync(LOCK_RETRY_MS);
    }
  }
  // Timeout — check if holding process is still alive before force-acquiring
  try {
    const storedPid = parseInt(fs.readFileSync(lockFile, "utf8"), 10);
    if (storedPid && !isNaN(storedPid)) {
      try {
        process.kill(storedPid, 0); // throws ESRCH if process is gone
        throw new Error("Lock held by active process " + storedPid);
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
        // Process is gone — steal lock atomically: remove then re-create with wx
      }
    }
  } catch (e) {
    if (e.message && e.message.startsWith("Lock held by")) throw e;
    // Lock file unreadable — proceed with force acquire
  }
  // Atomic steal: unlink then create with wx to prevent two processes stealing simultaneously
  try {
    fs.unlinkSync(lockFile);
  } catch { /* already removed by another process — fine */ }
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
  } catch (e) {
    if (e.code === "EEXIST") {
      // Another process won the steal — retry once after brief wait
      sleepSync(LOCK_RETRY_MS);
      try {
        fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      } catch (retryErr) {
        throw new Error("Lock contention — another process acquired the lock during steal");
      }
    } else {
      throw e;
    }
  }
  return lockFile;
}

function releaseLock(lockFile) {
  try {
    // Verify we still own the lock before releasing (prevents ABA problem with stolen locks)
    const content = fs.readFileSync(lockFile, "utf8").trim();
    if (parseInt(content, 10) !== process.pid) return; // Lock was stolen — do not delete
    fs.unlinkSync(lockFile);
  } catch (e) {
    // Lock file already removed or inaccessible — safe to ignore (ENOENT expected on concurrent release)
    if (e.code !== "ENOENT") {
      process.stderr.write(JSON.stringify({ warning: "Lock release failed: " + e.message }) + "\n");
    }
  }
}

function updateState(keyValues) {
  ensureStateDir();
  const lockFile = acquireLock();

  try {
    const current = readState();
    for (const kv of keyValues) {
      const eqIndex = kv.indexOf("=");
      if (eqIndex === -1) continue;
      const key = kv.slice(0, eqIndex);
      let value = kv.slice(eqIndex + 1);
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value === "null") value = null;
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      validateStateEntry(key, value);
      current[key] = value;
    }
    // Atomic write: temp file + rename
    const tmpFile = getWorkflowPath() + ".tmp";
    fs.writeFileSync(tmpFile, serializeSimpleYaml(current));
    fs.renameSync(tmpFile, getWorkflowPath());
    return current;
  } finally {
    releaseLock(lockFile);
  }
}

function resetState() {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) {
    return { ok: true, cleaned: dir };
  }
  const lockFile = acquireLock();
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".lock") continue; // Don't remove our own lock
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  } finally {
    releaseLock(lockFile);
  }
  return { ok: true, cleaned: dir };
}

function checkWorkflowLock(preReadState) {
  const state = preReadState || readState();
  if (state.active) {
    return {
      locked: true,
      phase: state.phase,
      tier: state.tier,
      message:
        "A workflow is already active. Run /devt:cancel-workflow first, or wait for it to complete.",
    };
  }
  return { locked: false };
}

function run(subcommand, args) {
  switch (subcommand) {
    case "read":
      return readState();
    case "update":
      return updateState(args);
    case "reset":
      return resetState();
    case "validate":
      return validateConsistency();
    default:
      throw new Error(
        `Unknown state subcommand: ${subcommand}. Use: read, update, reset, validate`,
      );
  }
}

module.exports = {
  run,
  readState,
  updateState,
  resetState,
  checkWorkflowLock,
  validateConsistency,
  getStateDir,
  ensureStateDir,
  VALID_PHASES,
  VALID_WORKFLOW_TYPES,
  VALID_TIERS,
};
