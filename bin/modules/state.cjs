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
  stop_at_phase: "string",
  only_phase: "string",
  verdict: "string",
  repair: "string",
  verify_iteration: "number",
  tdd_mode: "boolean",
};

const PHASE_ORDER = [
  "context_init", "flow_deviation", "assess", "risk_warning",
  "scan", "regression_baseline", "arch_health", "arch_health_scan",
  "plan", "architect", "implement", "test", "simplify", "review",
  "verify", "docs", "retro", "curate", "autoskill", "review_deferred",
  "identify_scope", "debug", "complete", "finalize",
];

const VALID_PHASES = new Set([...PHASE_ORDER, null]);

// Canonical phase→artifact mapping. Used by validateConsistency (forward) and syncState (inverse).
const PHASE_ARTIFACT_MAP = {
  implement: "impl-summary.md",
  test: "test-summary.md",
  review: "review.md",
  verify: "verification.md",
  plan: "plan.md",
  debug: "debug-summary.md",
  retro: "lessons.yaml",
  scan: "scan-results.md",
  arch_health: "arch-health-scan.md",
  architect: "arch-review.md",
  docs: "docs-summary.md",
  curate: "curation-summary.md",
};

const VALID_TIERS = new Set(["TRIVIAL", "SIMPLE", "STANDARD", "COMPLEX", null]);

// Input artifacts created by upstream workflows (specify, plan, clarify, pause) — always preserved by prune
const INPUT_ARTIFACTS = ["spec.md", "plan.md", "research.md", "decisions.md", "handoff.json", "continue-here.md"];

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

  // Build phase→artifact map for this workflow type from the canonical map
  const PHASE_ARTIFACTS = { ...PHASE_ARTIFACT_MAP };
  // Only include plan/debug artifacts when the workflow_type matches (reduces false positives)
  if (state.workflow_type !== "plan") delete PHASE_ARTIFACTS.plan;
  if (state.workflow_type !== "debug") delete PHASE_ARTIFACTS.debug;

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
  // Atomics.wait blocks the thread without CPU spin (Node 16+)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

/**
 * Reconstruct workflow.yaml from existing artifacts in .devt/state/.
 * Recovery mechanism for corrupted or missing workflow state.
 * Infers the latest completed phase from artifact presence.
 */
function syncState() {
  // Build artifact→phase map from canonical source (inverse of PHASE_ARTIFACT_MAP)
  const ARTIFACT_TO_PHASE = {};
  for (const [phase, artifact] of Object.entries(PHASE_ARTIFACT_MAP)) {
    ARTIFACT_TO_PHASE[artifact] = phase;
  }

  // ensureStateDir handles creation if missing; lock prevents TOCTOU race with concurrent writers
  const stateDir = getStateDir();
  ensureStateDir();
  const lockFile = acquireLock();
  try {
    // Read existing workflow.yaml if present (preserve fields we can't infer)
    const existing = readState();

    // Find all artifacts present on disk
    const foundArtifacts = [];
    const foundSet = new Set();
    let latestPhaseIndex = -1;

    for (const [artifact, phase] of Object.entries(ARTIFACT_TO_PHASE)) {
      if (fs.existsSync(path.join(stateDir, artifact))) {
        foundArtifacts.push({ artifact, phase });
        foundSet.add(artifact);
        const idx = PHASE_ORDER.indexOf(phase);
        if (idx > latestPhaseIndex) {
          latestPhaseIndex = idx;
        }
      }
    }

    if (foundArtifacts.length === 0) {
      return { ok: true, synced: false, message: "No artifacts found — state is empty", state: existing };
    }

    // Infer workflow_type from artifacts — reuse foundSet to avoid redundant existsSync
    let inferredType = existing.workflow_type || null;
    if (!inferredType) {
      if (foundSet.has("debug-summary.md")) inferredType = "debug";
      else if (fs.existsSync(path.join(stateDir, "spec.md"))) inferredType = "specify";
      else if (fs.existsSync(path.join(stateDir, "research.md")) && !foundSet.has("impl-summary.md")) inferredType = "research";
      else if (foundSet.has("impl-summary.md")) inferredType = "dev";
    }

    const inferredPhase = PHASE_ORDER[latestPhaseIndex] || existing.phase || null;

    // Build reconstructed state — preserve existing fields, override inferred ones
    const reconstructed = {
      ...existing,
      active: existing.active !== undefined ? existing.active : false,
      phase: inferredPhase,
      iteration: existing.iteration || 0,
    };
    if (inferredType) reconstructed.workflow_type = inferredType;

    // Atomic write
    const tmpFile = getWorkflowPath() + ".tmp";
    fs.writeFileSync(tmpFile, serializeSimpleYaml(reconstructed));
    fs.renameSync(tmpFile, getWorkflowPath());

    return {
      ok: true,
      synced: true,
      inferred_phase: inferredPhase,
      inferred_type: inferredType,
      artifacts_found: foundArtifacts.map((a) => a.artifact),
      state: reconstructed,
    };
  } finally {
    releaseLock(lockFile);
  }
}

/**
 * Remove orphaned artifacts from .devt/state/ that don't belong to the current workflow.
 * Uses PHASE_ARTIFACT_MAP to determine which artifacts are expected.
 * Returns list of removed files. Supports dry-run mode.
 */
function pruneState(dryRun) {
  const stateDir = getStateDir();
  if (!fs.existsSync(stateDir)) {
    return { ok: true, pruned: [], message: "State directory does not exist" };
  }

  const lockFile = acquireLock();
  try {
    const state = readState();
    const currentPhaseIndex = PHASE_ORDER.indexOf(state.phase);

    // Build set of expected files: workflow.yaml + artifacts for completed phases + lock
    const expectedFiles = new Set(["workflow.yaml", ".lock"]);
    for (const f of INPUT_ARTIFACTS) expectedFiles.add(f);

    // Keep artifacts for phases that have been completed (phase index <= current)
    for (const [phase, artifact] of Object.entries(PHASE_ARTIFACT_MAP)) {
      const phaseIndex = PHASE_ORDER.indexOf(phase);
      if (phaseIndex !== -1 && phaseIndex <= currentPhaseIndex) {
        expectedFiles.add(artifact);
      }
    }
    expectedFiles.add("scratchpad.md");
    expectedFiles.add("baseline-gates.md");

    // Find orphans
    const pruned = [];
    const entries = fs.readdirSync(stateDir);
    for (const entry of entries) {
      if (!expectedFiles.has(entry)) {
        const fullPath = path.join(stateDir, entry);
        if (dryRun) {
          pruned.push({ file: entry, action: "would_remove" });
        } else {
          try {
            fs.unlinkSync(fullPath);
            pruned.push({ file: entry, action: "removed" });
          } catch (e) {
            pruned.push({ file: entry, action: "failed", error: e.message });
          }
        }
      }
    }

    return { ok: true, dry_run: dryRun, pruned, kept: [...expectedFiles].filter(f => f !== ".lock") };
  } finally {
    releaseLock(lockFile);
  }
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
    case "sync":
      return syncState();
    case "prune":
      return pruneState(args.includes("--dry-run"));
    default:
      throw new Error(
        `Unknown state subcommand: ${subcommand}. Use: read, update, reset, validate, sync, prune`,
      );
  }
}

module.exports = {
  run,
  readState,
  updateState,
  resetState,
  syncState,
  pruneState,
  checkWorkflowLock,
  validateConsistency,
  getStateDir,
  ensureStateDir,
  PHASE_ORDER,
  PHASE_ARTIFACT_MAP,
  VALID_PHASES,
  VALID_WORKFLOW_TYPES,
  VALID_TIERS,
  INPUT_ARTIFACTS,
};
