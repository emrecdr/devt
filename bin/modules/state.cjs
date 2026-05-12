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
const { atomicWriteFileSync } = require("./io.cjs");

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
  validation_status: "string",
  validation_warnings: "number",
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
// Only covers artifacts tied to phases in PHASE_ORDER. Standalone workflow outputs
// (spec.md from /devt:specify, research.md from /devt:research) live in INPUT_ARTIFACTS.
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

// Always preserved by prune — cross-workflow inputs not tied to a single phase.
const INPUT_ARTIFACTS = ["spec.md", "plan.md", "research.md", "decisions.md", "handoff.json", "continue-here.md"];

// Mismatch reason codes emitted by validateConsistency() and consumed by
// describeMismatch() and updateState()'s shadow-validation filter.
const MISMATCH_REASONS = Object.freeze({
  MISSING: "missing",
  NO_STATUS_LINE: "no_status_line",
  UNREADABLE: "unreadable",
  INVALID_STATUS: "invalid_status",
});

// Allowed `## Status` values per artifact. Used by validateConsistency to detect
// invalid status values that pass file-existence checks but would mislead downstream agents.
//
// Scope (intentional): only markdown artifacts with a `## Status:` line that drives
// workflow routing decisions. The schema is deliberately narrow.
//
// Excluded by design:
//   - YAML/JSON state files (workflow.yaml, handoff.json, arch-baseline.json,
//     arch-triage.json, lessons.yaml) — validated structurally elsewhere or have
//     no Status convention.
//   - Persistent cross-phase artifacts in PERSISTENT_ARTIFACTS (scratchpad.md,
//     baseline-gates.md, debug-context.md, debug-investigation.md, review-scope.md,
//     session-report.md, autoskill-proposals.md, scanner-output.txt, scan-delta.md)
//     — content varies, no status enum.
//   - Free-form artifacts (plan.md, decisions.md, spec.md, scan-results.md,
//     continue-here.md, docs-summary.md, autoskill-proposals.md) — no status enum.
//
// TODO (post-1.0): Consider DEVT_VALIDATE_ENFORCE=1 to upgrade shadow warnings
// into hard failures. Today validateConsistency only warns on mismatch and
// persists validation_status to workflow.yaml; enforce mode would block writes.
const ARTIFACT_SCHEMA = {
  "impl-summary.md": ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
  "test-summary.md": ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
  "review.md": ["APPROVED", "APPROVED_WITH_NOTES", "NEEDS_WORK"],
  "verification.md": ["VERIFIED", "GAPS_FOUND", "FAILED", "DONE_WITH_CONCERNS"],
  "debug-summary.md": ["FIXED", "NEEDS_MORE_INVESTIGATION", "DONE_WITH_CONCERNS", "BLOCKED"],
  "arch-review.md": ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
  "docs-summary.md": ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
  "curation-summary.md": ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
  "research.md": ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
  // Phase 1 (v0.16.0) — Pre-Flight Brief artifact. FRESH = generated this session,
  // STALE = brief exists but workflow scope expanded beyond it (caught by Tier-2
  // File Pre-Flight in Phase 3), MISSING = brief never generated for this workflow.
  "preflight-brief.md": ["FRESH", "STALE", "MISSING"],
};

// Always preserved by prune — cross-cutting artifacts not tied to a single phase
const PERSISTENT_ARTIFACTS = [
  "scratchpad.md", "baseline-gates.md",
  "debug-context.md", "debug-investigation.md",
  "review-scope.md", "session-report.md", "autoskill-proposals.md",
  "arch-baseline.json", "arch-triage.json", "scanner-output.txt", "scan-delta.md",
];

const VALID_WORKFLOW_TYPES = new Set([
  "dev", "quick_implement", "debug", "retro", "code_review", "arch_health_scan",
  "research", "plan", "specify", "clarify",
  // Memory layer workflow types (v0.16.0+) — see workflows/memory-*.md.
  // memory_promote: curator promotes ephemeral DEC -> permanent ADR (Phase 2).
  // memory_reject: curator creates a REJ tombstone with search_keywords (Phase 2).
  // preflight: standalone Topic Pre-Flight Brief generation (Phase 3).
  // (memory_init / memory_index are CLI-only subcommands — they don't set state and aren't workflow_types.)
  "memory_promote", "memory_reject", "preflight",
  null,
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
    // Surface the registry + a closest-match hint so agent hallucinations
    // (e.g. `workflow_type=workflow` from the slash-command name) are self-
    // correcting on the next try. Common false-friends mapped explicitly.
    const aliasHint = {
      workflow: "dev",
      implement: "quick_implement",
      review: "code_review",
      arch: "arch_health_scan",
    }[value];
    const validList = [...VALID_WORKFLOW_TYPES].filter((v) => v !== null).sort().join(", ");
    const suggestion = aliasHint ? ` Did you mean "${aliasHint}"?` : "";
    warnState(`Unknown workflow_type "${value}".${suggestion} Valid: ${validList}`);
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
 * Extract the `## Status` value from an artifact's first 50 lines.
 * Looks for either `## Status\n\nVALUE` or `## Status: VALUE` patterns.
 * Returns null if no status line is found.
 */
function extractStatus(content) {
  const lines = content.split("\n").slice(0, 50);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Inline form: `## Status: VALUE`
    const inlineMatch = line.match(/^##\s+Status\s*:\s*(.+)$/i);
    if (inlineMatch) return inlineMatch[1].trim().split(/\s+/)[0];
    // Block form: `## Status` followed by a value line
    if (/^##\s+Status\s*$/i.test(line)) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const v = lines[j].trim();
        if (v && !v.startsWith("#")) return v.split(/\s+/)[0];
      }
    }
  }
  return null;
}

/**
 * Validate consistency between workflow phases and expected artifacts.
 * Two checks per artifact:
 *   1. Existence: file present for phases passed through
 *   2. Content schema: `## Status` value is in the allowed enum (if defined in ARTIFACT_SCHEMA)
 *
 * Returns { consistent: true/false, mismatches: [{phase, expected_artifact, reason, ...}] }
 */
function validateConsistency(stateOverride = null) {
  const state = stateOverride || readState();
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
        mismatches.push({ phase, expected_artifact: artifact, reason: MISMATCH_REASONS.MISSING, exists: false });
        continue;
      }
      // Existence passed — check content schema if one is defined
      const allowedStatuses = ARTIFACT_SCHEMA[artifact];
      if (!allowedStatuses) continue;
      let content;
      try {
        content = fs.readFileSync(artifactPath, "utf8");
      } catch (e) {
        mismatches.push({ phase, expected_artifact: artifact, reason: MISMATCH_REASONS.UNREADABLE, error: e.message });
        continue;
      }
      const status = extractStatus(content);
      if (status === null) {
        mismatches.push({ phase, expected_artifact: artifact, reason: MISMATCH_REASONS.NO_STATUS_LINE, allowed: allowedStatuses });
      } else if (!allowedStatuses.includes(status)) {
        mismatches.push({ phase, expected_artifact: artifact, reason: MISMATCH_REASONS.INVALID_STATUS, actual: status, allowed: allowedStatuses });
      }
    }
  }

  return { consistent: mismatches.length === 0, mismatches };
}

function describeMismatch(m) {
  switch (m.reason) {
    case MISMATCH_REASONS.MISSING: return "is missing";
    case MISMATCH_REASONS.NO_STATUS_LINE: return "has no `## Status` line";
    case MISMATCH_REASONS.UNREADABLE: return "is unreadable";
    case MISMATCH_REASONS.INVALID_STATUS: return `has invalid status "${m.actual}" (allowed: ${(m.allowed || []).join(", ")})`;
    default: return `failed validation (${m.reason || "unknown"})`;
  }
}

function sleepSync(ms) {
  // Atomics.wait blocks the thread without CPU spin (Node 16+)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockDir) {
  // Default to state dir for backward compatibility; memory.cjs passes its own dir
  // for FTS5 rebuild serialization across concurrent Claude sessions.
  // Callers are internal only (state.cjs::updateState/resetState/syncState/pruneState
  // pass undefined → defaults to getStateDir; memory.cjs::rebuildIndex passes the
  // memory dir derived from getDbPath()). No user input flows here.
  const dir = lockDir || getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const lockFile = path.join(dir, ".lock");
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
      if (eqIndex === -1) {
        warnState(`Skipped invalid key=value pair (no '='): "${kv}"`);
        continue;
      }
      const key = kv.slice(0, eqIndex);
      let value = kv.slice(eqIndex + 1);
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value === "null") value = null;
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      validateStateEntry(key, value);
      current[key] = value;
    }
    // Run before write so the validation verdict and the data hit disk in a single atomic write —
    // a crash between two writes would leave the flag desynced from the state it describes.
    // `missing` mismatches are filtered: PHASE_ORDER assumes linear progression but TRIVIAL/SIMPLE
    // tiers legitimately skip phases, so absent artifacts aren't reliable violations. Content-schema
    // mismatches only fire when the artifact exists, so they're the actionable signal.
    let preciseMismatches = [];
    if (process.env.DEVT_VALIDATE_SHADOW !== "0") {
      try {
        const validation = validateConsistency(current);
        preciseMismatches = (validation.mismatches || []).filter(
          (m) => m.reason && m.reason !== MISMATCH_REASONS.MISSING,
        );
      } catch (e) {
        process.stderr.write(`[devt:shadow] validation skipped: ${e.message}\n`);
      }
    }
    if (preciseMismatches.length > 0) {
      current.validation_status = "warned";
      current.validation_warnings = preciseMismatches.length;
    } else if (current.validation_status) {
      // Delete (rather than set to null) so cleared flags don't linger as `validation_status: null`
      delete current.validation_status;
      delete current.validation_warnings;
    }

    atomicWriteFileSync(getWorkflowPath(), serializeSimpleYaml(current));

    // Stderr emission and _validation echo for visibility (non-blocking)
    if (preciseMismatches.length > 0) {
      current._validation = { consistent: false, mismatches: preciseMismatches };
      process.stderr.write(
        `[devt:shadow] ${preciseMismatches.length} consistency warning(s) after state update\n`,
      );
      for (const m of preciseMismatches.slice(0, 5)) {
        process.stderr.write(`  - ${m.expected_artifact} ${describeMismatch(m)}\n`);
      }
    }

    return current;
  } finally {
    releaseLock(lockFile);
  }
}

// Files in .devt/state/ that survive `state reset` / `/devt:cancel-workflow`.
// Most state is per-workflow ephemeral, but some artifacts span sessions —
// e.g. deferred.md (v0.29.0+) is the cross-workflow TODO queue and must NOT
// disappear when the user cancels an unrelated active workflow.
//
// Filenames imported from their owning module where possible, so renaming the
// canonical file in one place doesn't desync the exemption list.
const { FILE_REL: DEFERRED_FILE_REL } = require("./deferred.cjs");
const ARCHIVE_DIR = ".archive";       // .devt/state/.archive/ — ring buffer of prior resets
const RESET_EXEMPT = new Set([
  ".lock",                              // active locking — never delete
  ARCHIVE_DIR,                          // ring buffer survives reset (rolls off via pruneArchive)
  path.basename(DEFERRED_FILE_REL),     // deferred.md — see bin/modules/deferred.cjs
]);

// Get configured archive ring-buffer size (state.archive_runs). Reads via
// require() at call time to avoid circular deps with config.cjs at module load.
function getArchiveRuns() {
  try {
    const { getMergedConfig } = require("./config.cjs");
    const cfg = getMergedConfig();
    const n = cfg && cfg.state && cfg.state.archive_runs;
    return Number.isInteger(n) && n >= 0 ? n : 5;
  } catch {
    return 5;
  }
}

// Prune .archive/ to the most recent `keep` snapshots (oldest first by name —
// timestamps sort lexicographically). No-op when keep=0 (caller already cleared
// or directory doesn't exist).
function pruneArchive(stateDir, keep) {
  const archiveDir = path.join(stateDir, ARCHIVE_DIR);
  if (!fs.existsSync(archiveDir)) return;
  const snapshots = fs
    .readdirSync(archiveDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  while (snapshots.length > keep) {
    const oldest = snapshots.shift();
    fs.rmSync(path.join(archiveDir, oldest), { recursive: true, force: true });
  }
}

function resetState() {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) {
    return { ok: true, cleaned: dir };
  }
  const archiveRuns = getArchiveRuns();
  const lockFile = acquireLock();
  let archivedTo = null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const movable = entries.filter((e) => !RESET_EXEMPT.has(e.name));
    if (archiveRuns > 0 && movable.length > 0) {
      // Archive: move non-exempt entries into .archive/<ISO-ts>/
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      archivedTo = path.join(dir, ARCHIVE_DIR, ts);
      fs.mkdirSync(archivedTo, { recursive: true });
      for (const entry of movable) {
        const src = path.join(dir, entry.name);
        const dst = path.join(archivedTo, entry.name);
        try {
          fs.renameSync(src, dst);
        } catch {
          // Cross-device or permission issue — fall back to copy+remove
          if (entry.isDirectory()) {
            fs.cpSync(src, dst, { recursive: true });
            fs.rmSync(src, { recursive: true, force: true });
          } else {
            fs.copyFileSync(src, dst);
            fs.unlinkSync(src);
          }
        }
      }
      pruneArchive(dir, archiveRuns);
    } else {
      // archive_runs=0 OR nothing to archive — original behavior (delete in place)
      for (const entry of movable) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      }
    }
  } finally {
    releaseLock(lockFile);
  }
  return { ok: true, cleaned: dir, archived_to: archivedTo };
}

/**
 * Read a single section from a state-dir markdown file.
 *
 * Token-saver for agents: instead of `Read .devt/state/plan.md` (entire file),
 * call `state read-section --file plan.md --section "Phase 2"` to get just
 * that heading's body. Slice runs from the matching heading line to (but not
 * including) the next same-or-higher level heading, or EOF.
 *
 * Heading match: exact text after the `#`s, case-insensitive, leading/trailing
 * whitespace trimmed. Level inferred from the input — `"## Foo"` matches only
 * H2; bare `"Foo"` matches the first heading at any level.
 *
 * Returns `{ ok: true, section, content, level }` on hit,
 *         `{ ok: false, reason }` on miss/missing-file.
 */
/**
 * Truncate a state-dir artifact to zero bytes atomically (v0.30.6+).
 *
 * Used at clean workflow finalize to clear ephemeral scratchpad content
 * — specifically PREFLIGHT lines from the pre-flight-guard hook contract —
 * that would otherwise bleed into the next workflow in the same session
 * and falsely satisfy the hook's edit-coverage check.
 *
 * Preserves the file (just empties it) so the next workflow doesn't need
 * to recreate it. No-op if the file doesn't exist. Returns
 * `{ ok: true, path, status: "truncated"|"missing" }`.
 *
 * Path safety: name is basenamed and must be a known PERSISTENT artifact
 * — only scratchpad.md is currently allowed to prevent accidental wipes
 * of critical state. Extend `TRUNCATABLE_ARTIFACTS` to opt new files in.
 */
const TRUNCATABLE_ARTIFACTS = new Set(["scratchpad.md"]);

function truncateArtifact(name) {
  if (!name) return { ok: false, reason: "artifact name is required" };
  const safe = path.basename(name);
  if (safe !== name) return { ok: false, reason: `invalid artifact name: ${name}` };
  if (!TRUNCATABLE_ARTIFACTS.has(safe)) {
    return {
      ok: false,
      reason: `artifact "${safe}" is not in TRUNCATABLE_ARTIFACTS — refusing to wipe`,
      allowed: Array.from(TRUNCATABLE_ARTIFACTS),
    };
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const filePath = path.join(getStateDir(), safe);
  if (!fs.existsSync(filePath)) {
    return { ok: true, path: filePath, status: "missing" };
  }
  atomicWriteFileSync(filePath, "");
  return { ok: true, path: filePath, status: "truncated" };
}

function readSection(fileName, sectionQuery) {
  if (!fileName || !sectionQuery) {
    return { ok: false, reason: "file and section are required" };
  }
  // Path safety — keep reads inside .devt/state/, no traversal.
  const safe = path.basename(fileName);
  if (safe !== fileName) {
    return { ok: false, reason: `invalid file name: ${fileName}` };
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const filePath = path.join(getStateDir(), safe);
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `file not found: ${safe}` };
  }
  // Parse heading query — split off optional leading `#`s
  const m = sectionQuery.trim().match(/^(#{1,6})?\s*(.+?)\s*$/);
  if (!m) return { ok: false, reason: "could not parse section query" };
  const queryLevel = m[1] ? m[1].length : null;
  const queryText = m[2].toLowerCase();

  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  // Two-pass match: exact first, prefix fallback. Exact wins so unambiguous
  // queries are never overridden by accidental prefix collisions; prefix is
  // a convenience so `--section "Phase 2"` finds `## Phase 2: Implementation`.
  let startIdx = -1;
  let foundLevel = -1;
  let matchMode = null;
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!h) continue;
    const lvl = h[1].length;
    if (queryLevel !== null && lvl !== queryLevel) continue;
    candidates.push({ idx: i, lvl, text: h[2].toLowerCase() });
  }
  // Pass 1: exact
  for (const c of candidates) {
    if (c.text === queryText) {
      startIdx = c.idx; foundLevel = c.lvl; matchMode = "exact";
      break;
    }
  }
  // Pass 2: prefix (only if no exact hit)
  if (startIdx === -1) {
    for (const c of candidates) {
      if (c.text.startsWith(queryText)) {
        startIdx = c.idx; foundLevel = c.lvl; matchMode = "prefix";
        break;
      }
    }
  }
  if (startIdx === -1) {
    return { ok: false, reason: `section not found: ${sectionQuery}` };
  }
  // Slice until next same-or-higher level heading
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,6})\s+/);
    if (h && h[1].length <= foundLevel) {
      endIdx = i;
      break;
    }
  }
  return {
    ok: true,
    file: safe,
    section: lines[startIdx].replace(/^#+\s+/, "").trim(),
    level: foundLevel,
    match: matchMode,
    content: lines.slice(startIdx, endIdx).join("\n"),
  };
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

    // Also scan INPUT_ARTIFACTS into foundSet so workflow_type inference uses one path
    for (const artifact of INPUT_ARTIFACTS) {
      if (fs.existsSync(path.join(stateDir, artifact))) {
        foundSet.add(artifact);
      }
    }

    if (foundSet.size === 0) {
      return { ok: true, synced: false, message: "No artifacts found — state is empty", state: existing };
    }

    // Infer workflow_type from artifacts — all checks go through foundSet
    let inferredType = existing.workflow_type || null;
    if (!inferredType) {
      if (foundSet.has("debug-summary.md")) inferredType = "debug";
      else if (foundSet.has("spec.md")) inferredType = "specify";
      else if (foundSet.has("research.md") && !foundSet.has("impl-summary.md")) inferredType = "research";
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

    atomicWriteFileSync(getWorkflowPath(), serializeSimpleYaml(reconstructed));

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

  const lockFile = dryRun ? null : acquireLock();
  try {
    const state = readState();
    const currentPhaseIndex = PHASE_ORDER.indexOf(state.phase);

    // Build set of expected files: workflow.yaml + artifacts for completed/current phases
    const expectedFiles = new Set(["workflow.yaml"]);
    for (const f of INPUT_ARTIFACTS) expectedFiles.add(f);
    for (const f of PERSISTENT_ARTIFACTS) expectedFiles.add(f);

    // Keep artifacts for phases that have been completed (phase index <= current)
    for (const [phase, artifact] of Object.entries(PHASE_ARTIFACT_MAP)) {
      const phaseIndex = PHASE_ORDER.indexOf(phase);
      if (phaseIndex !== -1 && phaseIndex <= currentPhaseIndex) {
        expectedFiles.add(artifact);
      }
    }

    // Find orphans
    const pruned = [];
    const entries = fs.readdirSync(stateDir);
    for (const entry of entries) {
      if (entry === ".lock") continue;
      if (entry === ARCHIVE_DIR) continue;   // ring buffer survives prune (rolls off via reset)
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

    return { ok: true, dry_run: dryRun, pruned, kept: [...expectedFiles] };
  } finally {
    if (lockFile) releaseLock(lockFile);
  }
}

// Extract --flag <value> from a positional args array. Returns null when absent.
function _getFlag(args, name) {
  if (!Array.isArray(args)) return null;
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return null;
  return args[i + 1];
}

function run(subcommand, args) {
  switch (subcommand) {
    case "read":
      return readState();
    case "read-section": {
      const file = _getFlag(args, "--file");
      const section = _getFlag(args, "--section");
      return readSection(file, section);
    }
    case "truncate-artifact": {
      // First positional arg after the subcommand is the artifact name.
      // Falls back to --name flag for symmetry with other state subcommands.
      const name = (args && args.length && !args[0].startsWith("--")) ? args[0] : _getFlag(args, "--name");
      return truncateArtifact(name);
    }
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
        `Unknown state subcommand: ${subcommand}. Use: read, read-section, truncate-artifact, update, reset, validate, sync, prune`,
      );
  }
}

module.exports = {
  run,
  readState,
  readSection,
  truncateArtifact,
  updateState,
  resetState,
  syncState,
  pruneState,
  checkWorkflowLock,
  validateConsistency,
  describeMismatch,
  getStateDir,
  ensureStateDir,
  acquireLock,
  releaseLock,
  PHASE_ORDER,
  PHASE_ARTIFACT_MAP,
  VALID_PHASES,
  VALID_WORKFLOW_TYPES,
  VALID_TIERS,
  INPUT_ARTIFACTS,
  PERSISTENT_ARTIFACTS,
  MISMATCH_REASONS,
};
