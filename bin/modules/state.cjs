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
  // Input JSON artifact (handoff.json, etc.) missing a top-level field listed
  // in JSON_INPUT_SCHEMAS[file].required. The artifact exists and parses but
  // lacks contractually required content.
  MISSING_REQUIRED_FIELD: "missing_required_field",
});

// Allowed `## Status` values per artifact. Used by validateConsistency to detect
// invalid status values that pass file-existence checks but would mislead downstream agents.
//
// Scope (intentional): only markdown artifacts with a `## Status:` line that drives
// workflow routing decisions. The schema is deliberately narrow.
//
// Excluded by design:
// - YAML/JSON state files (workflow.yaml, handoff.json, arch-baseline.json,
// arch-triage.json, lessons.yaml) — validated structurally elsewhere or have
// no Status convention.
// - Persistent cross-phase artifacts in PERSISTENT_ARTIFACTS (scratchpad.md,
// baseline-gates.md, debug-context.md, debug-investigation.md, review-scope.md,
// session-report.md, autoskill-proposals.md, scanner-output.txt, scan-delta.md)
// — content varies, no status enum.
// - Free-form artifacts (plan.md, decisions.md, spec.md, scan-results.md,
// continue-here.md, docs-summary.md, autoskill-proposals.md) — no status enum.
//
// TODO (post-1.0): Consider DEVT_VALIDATE_ENFORCE=1 to upgrade shadow warnings
// into hard failures. Today validateConsistency only warns on mismatch and
// persists validation_status to workflow.yaml; enforce mode would block writes.
// JSON sidecars — machine-readable companions to the markdown
// artifacts. Programmer writes impl-summary.json alongside impl-summary.md;
// workflows read the JSON for routing decisions (status, verdict, requirements
// coverage) and read the markdown for human-review narrative. JSON is
// authoritative for workflow control flow; markdown is authoritative for
// the human-readable record.
//
// Adding a new sidecar requires:
// 1. An entry in JSON_SIDECAR_SCHEMAS below (whitelisted status + verdict)
// 2. The owning agent's body documents the JSON shape and writes both files
// 3. The consumer workflow uses readSidecar() to read the JSON
// Verifier verdict vocabularies — kept as shared constants so the JSON sidecar
// schema and the markdown ARTIFACT_SCHEMA below can't drift independently.
// `verification.json::verdict` is the workflow-routing enum; `verification.md`
// status mirrors the four terminal values for human-readable parity.
const VERIFICATION_STATUSES = ["VERIFIED", "GAPS_FOUND", "FAILED", "DONE_WITH_CONCERNS"];
const VERIFICATION_VERDICTS = ["satisfied", "needs_revision", "failed"];

const JSON_SIDECAR_SCHEMAS = {
  "impl-summary.json": {
    status: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
    verdict: ["PASS", "FAIL", "INDETERMINATE"],
    agent: ["programmer"],
  },
  "test-summary.json": {
    status: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
    verdict: ["PASS", "FAIL", "INDETERMINATE"],
    agent: ["tester"],
  },
  "verification.json": {
    status: VERIFICATION_STATUSES,
    verdict: VERIFICATION_VERDICTS,
    agent: ["verifier"],
  },
  // review.md emits "## Verdict" instead of "## Status", so the legacy
  // extractStatus parser returned null on every code-review verify advance
  // and validateConsistency persisted a NO_STATUS_LINE warning. Sidecar
  // routing via SIDECAR_FOR_MARKDOWN bypasses extractStatus entirely.
  "review.json": {
    status: ["DONE", "BLOCKED"],
    verdict: ["APPROVED", "APPROVED_WITH_NOTES", "NEEDS_WORK"],
    agent: ["code-reviewer"],
  },
};

// Separate registry for INPUT JSON artifacts — files that workflows consume to
// drive resume/branching but that don't carry the status/verdict/agent routing
// triple. Different shape from JSON_SIDECAR_SCHEMAS because the validation
// surface is different: sidecars validate enum membership; inputs validate
// presence of required fields. A schema entry declares which top-level fields
// MUST exist (missing → validation_warning) and which SHOULD exist
// (missing → soft note). Consumer-facing helpers: validateInputJson() returns
// {valid, missing_required, missing_recommended}.
const JSON_INPUT_SCHEMAS = {
  "handoff.json": {
    // Minimum fields a pause writer must emit for the next session to resume.
    required: ["task", "phase", "paused_at"],
    // Recommended fields — present in well-formed handoffs but a missing one
    // doesn't break resume; just surfaces as a soft note.
    recommended: ["tier", "iteration", "last_commit", "remaining_tasks", "next_action"],
  },
};

// artifacts that ALSO have a JSON sidecar in
// JSON_SIDECAR_SCHEMAS no longer appear here. Their status validation goes
// through the sidecar (machine-readable, single source of truth). The
// remaining entries are markdown-only artifacts pending future sidecar
// backfill; extractStatus continues to read them.
//
// Removed:
// - "impl-summary.md" — superseded by JSON_SIDECAR_SCHEMAS["impl-summary.json"]
// - "verification.md" — superseded by JSON_SIDECAR_SCHEMAS["verification.json"]
// - "test-summary.md" — superseded by JSON_SIDECAR_SCHEMAS["test-summary.json"]
// - "review.md" — superseded by JSON_SIDECAR_SCHEMAS["review.json"]
const ARTIFACT_SCHEMA = {
  "debug-summary.md": ["FIXED", "NEEDS_MORE_INVESTIGATION", "DONE_WITH_CONCERNS", "BLOCKED"],
  "arch-review.md": ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
  "docs-summary.md": ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
  "curation-summary.md": ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
  "research.md": ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"],
  // Phase 1 — Pre-Flight Brief artifact. FRESH = generated this session,
  // STALE = brief exists but workflow scope expanded beyond it (caught by Tier-2
  // File Pre-Flight in Phase 3), MISSING = brief never generated for this workflow.
  // (Brief uses its own lifecycle parsers in preflight.cjs; entry retained here
  // only for the existence-check pass of validateConsistency.)
  "preflight-brief.md": ["FRESH", "STALE", "MISSING"],
};

// Map markdown artifact -> JSON sidecar filename for sidecar-status validation.
// Sidecar-covered artifacts pull status from JSON_SIDECAR_SCHEMAS instead of
// extractStatus. Adding a sidecar: register in JSON_SIDECAR_SCHEMAS, add the
// pairing here, remove the matching entry from ARTIFACT_SCHEMA above.
const SIDECAR_FOR_MARKDOWN = {
  "impl-summary.md": "impl-summary.json",
  "test-summary.md": "test-summary.json",
  "verification.md": "verification.json",
  "review.md": "review.json",
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
  // Memory layer workflow types — see workflows/memory-*.md.
  // memory_promote: curator promotes ephemeral DEC -> permanent ADR.
  // memory_reject: curator creates a REJ tombstone with search_keywords.
  // preflight: standalone Topic Pre-Flight Brief generation.
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
  // Deep-parse `_json`-suffixed values so consumers don't have to. Field
  // failure (greenfield 2026-05-26): `STATE=$(state read); echo "$STATE" | jq`
  // broke because zsh's echo interpreted embedded `\n` escapes in nested
  // string values, producing invalid JSON for downstream jq. With deep-parse,
  // those keys hold real objects/arrays — no escape sequences to misinterpret.
  for (const k of Object.keys(parsed)) {
    if (!k.endsWith("_json")) continue;
    const v = parsed[k];
    if (typeof v !== "string" || !v) continue;
    try {
      parsed[k] = JSON.parse(v);
    } catch {
      // Keep as string on parse failure — defensive against malformed legacy data
    }
  }
  return parsed;
}

/**
 * Extract the `## Status` value from an artifact's first 100 lines.
 * Long verifier reports with prologue / scope / requirements-coverage
 * sections push the status line further down, so we scan generously.
 *
 * Looks for either `## Status\n\nVALUE` or `## Status: VALUE` patterns.
 * Returns null if no status line is found.
 */
function extractStatus(content) {
  const lines = content.split("\n").slice(0, 100);
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
 * 1. Existence: file present for phases passed through
 * 2. Content schema: `## Status` value is in the allowed enum (if defined in ARTIFACT_SCHEMA)
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
  const mismatches = [];

  // Input JSON validation is phase-independent — a malformed handoff.json is
  // a problem whether the workflow is at phase=implement or just initialized.
  // We collect these mismatches first so they always surface, then fall through
  // to phase-gated artifact validation only if a known phase is set.
  for (const [fileName, schema] of Object.entries(JSON_INPUT_SCHEMAS)) {
    const filePath = path.join(stateDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    let body;
    try {
      body = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      mismatches.push({ expected_artifact: fileName, reason: MISMATCH_REASONS.UNREADABLE, error: e.message });
      continue;
    }
    const verdict = validateInputJson(body, schema);
    if (!verdict.parsed) {
      mismatches.push({ expected_artifact: fileName, reason: MISMATCH_REASONS.UNREADABLE, error: verdict.parse_error });
      continue;
    }
    for (const field of verdict.missing_required) {
      mismatches.push({
        expected_artifact: fileName,
        reason: MISMATCH_REASONS.MISSING_REQUIRED_FIELD,
        field,
        note: `required field "${field}" missing from ${fileName}`,
      });
    }
  }

  if (currentPhaseIndex === -1) {
    // Unknown phase or no phase — return only the input-JSON mismatches
    // collected above (no phase-gated artifact checks).
    return { consistent: mismatches.length === 0, mismatches };
  }
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
      // if a sidecar exists for this markdown artifact,
      // read status from the JSON sidecar (single source of truth). Otherwise
      // fall through to the legacy extractStatus path on markdown.
      const sidecarName = SIDECAR_FOR_MARKDOWN[artifact];
      if (sidecarName) {
        const sidecarSchema = JSON_SIDECAR_SCHEMAS[sidecarName];
        const sidecarPath = path.join(stateDir, sidecarName);
        if (!fs.existsSync(sidecarPath)) {
          mismatches.push({ phase, expected_artifact: artifact, reason: MISMATCH_REASONS.MISSING, exists: false, note: `sidecar ${sidecarName} missing` });
          continue;
        }
        let sidecar;
        try {
          sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
        } catch (e) {
          mismatches.push({ phase, expected_artifact: sidecarName, reason: MISMATCH_REASONS.UNREADABLE, error: e.message });
          continue;
        }
        const allowed = sidecarSchema && sidecarSchema.status;
        if (allowed && (!sidecar || typeof sidecar.status !== "string")) {
          mismatches.push({ phase, expected_artifact: sidecarName, reason: MISMATCH_REASONS.NO_STATUS_LINE, allowed });
        } else if (allowed && !allowed.includes(sidecar.status)) {
          mismatches.push({ phase, expected_artifact: sidecarName, reason: MISMATCH_REASONS.INVALID_STATUS, actual: sidecar.status, allowed });
        }
        continue;
      }
      // Legacy: extractStatus on markdown for artifacts without sidecars yet.
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

// Parse + schema-check a JSON input artifact. Returns
// { parsed: bool, parse_error?, missing_required: [], missing_recommended: [] }.
// Pure — no I/O. Caller reads the file body and passes it in.
function validateInputJson(body, schema) {
  const out = { parsed: false, missing_required: [], missing_recommended: [] };
  if (!schema) {
    out.parsed = true;
    return out;
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    out.parse_error = e.message;
    return out;
  }
  out.parsed = true;
  if (!parsed || typeof parsed !== "object") {
    // JSON parsed but is not an object — treat all required fields as missing.
    out.missing_required = [...(schema.required || [])];
    out.missing_recommended = [...(schema.recommended || [])];
    return out;
  }
  for (const field of schema.required || []) {
    if (!(field in parsed)) out.missing_required.push(field);
  }
  for (const field of schema.recommended || []) {
    if (!(field in parsed)) out.missing_recommended.push(field);
  }
  return out;
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
    // Snapshot workflow_type BEFORE merging updates. If a workflow switches
    // (e.g. user runs /devt:review mid-/devt:workflow), workflow_type changes
    // while active stays true — this is a NEW logical workflow that deserves
    // a fresh workflow_id + created_at stamp. Without this snapshot the
    // mcp-trace records would silently attribute the new workflow's MCP calls
    // to the old workflow_id, breaking telemetry attribution across boundaries.
    const previousWorkflowType = current.workflow_type;
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
    // Auto-stamp session metadata on first activation. Idempotent — subsequent updates
    // preserve the stamp; resetState() clears workflow.yaml, so the next active=true
    // re-stamps. Anchors the stuck-detector to a precise session boundary.
    if (current.active === true && !current.created_at) {
      current.created_at = new Date().toISOString();
      current.workflow_id = current.workflow_id || require("crypto").randomUUID();
    } else if (
      current.active === true &&
      previousWorkflowType &&
      current.workflow_type &&
      previousWorkflowType !== current.workflow_type
    ) {
      // workflow_type transition while active — new logical workflow, fresh stamps.
      // Closes the attribution bug where /devt:review running on top of an active
      // /devt:workflow would write trace records with the old workflow_id.
      current.created_at = new Date().toISOString();
      current.workflow_id = require("crypto").randomUUID();
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
// e.g. deferred.md is the cross-workflow TODO queue and must NOT
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
  "preflight-denies.jsonl",             // forensic deny log — survives cancel so stuck-detector reads at canonical path
  "dispatch-warnings.jsonl",            // forensic dispatch-scope log — survives cancel for /devt:forensics post-hoc analysis
]);

// ---------------------------------------------------------------------------
// State directory contract — declares which filenames are LEGITIMATE in
// .devt/state/. Used by `state audit` and `state cleanup` to surface
// ad-hoc files agents (or users) have dumped over time, without enforcing
// at write time (too disruptive — agents may legitimately need slug variants
// during sliced workflows). Three buckets:
//
//  - `additional_canonical`: exact filenames not covered by ARTIFACT_SCHEMA /
//    SIDECAR_FOR_MARKDOWN / JSON_SIDECAR_SCHEMAS / JSON_INPUT_SCHEMAS but
//    still part of the documented contract (workflow.yaml, scratchpad.md, etc.).
//  - `allowed_patterns`: regex strings for permitted slug variants — review-X.md,
//    impl-summary-X.md/.json, slice-X.md. Anchored. Files matching these are
//    legitimate but flagged for archival when mtime > stale_days_default.
//  - `ephemeral_patterns`: temp files that should never persist (orphaned .tmp).
//
// Files matching NONE of the above (and not in canonical) are AD-HOC — surfaced
// by `state audit` as candidates for manual review or `state cleanup` archival.
// ---------------------------------------------------------------------------
const STATE_FILE_CONTRACT = {
  additional_canonical: [
    "workflow.yaml",            // active workflow state — auto-stamped
    "scratchpad.md",            // ephemeral cross-agent notes
    "plan.md", "spec.md", "scope.md", "decisions.md", "research.md",
    "review-scope.md", "scan-results.md", "scan-delta.md",
    "test-summary.md",          // markdown side of test-summary sidecar
    "lessons.yaml",             // retro hand-off draft
    "debug-context.md", "debug-investigation.md", "debug-summary.md",
    "arch-review.md", "arch-health-scan.md", "arch-baseline.json",
    "arch-triage.json", "scanner-output.txt",
    "docs-summary.md", "curation-summary.md", "session-report.md",
    "autoskill-proposals.md", "baseline-gates.md",
    "claude-mem-harvest.md", "claude-mem-skipped.txt",
    "continue-here.md",         // /devt:pause output (paired with handoff.json)
    "graph-impact.md",
    "graphify-impact-plan.json", // bash-computed tier+tool decision for code-review impact step
    "graphify-skip-reason.txt", // explicit-skip artifact when the impact step's plan == "skip"
    "staleness-suppressed.txt", // mechanical-override artifact when staleness gate forces scope_trust='sparse'
    "preflight-brief.json",     // JSON sidecar for preflight-brief.md (no routing — input-only)
    "weekly-report.md",         // output of `devt-tools report generate` — weekly contributor + commit summary
    "review.md",
  ],
  allowed_patterns: [
    "^review-[A-Za-z0-9_.-]+\\.md$",                // review-architecture.md, review-pr367-slice-A.md
    "^impl-summary-[A-Za-z0-9_.-]+\\.(md|json)$",   // impl-summary-cr3.{md,json}
    "^test-summary-[A-Za-z0-9_.-]+\\.(md|json)$",
    "^verification-[A-Za-z0-9_.-]+\\.(md|json)$",
    "^slice-[A-Za-z0-9_.-]+\\.md$",
    "^[a-z]+-summary\\.md$",                        // module-md-update-summary.md
  ],
  ephemeral_patterns: [
    "^\\..*\\.tmp$",       // hidden temp files
    "^.*\\.tmp$",          // orphaned atomic-write temps
    "^.*~$",               // editor backups
  ],
  // Default freshness window for pattern-allowed artifacts before audit flags
  // them as stale. Canonical files never go stale by mtime. Override per-run
  // with `state cleanup --stale-days=N`.
  stale_days_default: 21,
};

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
 * `{ ok: false, reason }` on miss/missing-file.
 */
/**
 * Truncate a state-dir artifact to zero bytes atomically.
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

/**
 * Read a JSON sidecar artifact and validate against its schema.
 *
 * Sidecars are machine-readable companions to markdown artifacts written by
 * the same agent. Today: only impl-summary.json (programmer). Future: test-
 * summary.json (tester), review.json (code-reviewer), verification.json
 * (verifier). Adding new sidecars = entry in JSON_SIDECAR_SCHEMAS.
 *
 * Returns `{ ok: true, file, data, validation }` where validation is
 * { valid_status, valid_verdict, valid_agent } — any false fields are
 * surfaced as schema warnings the caller can decide how to handle.
 * Returns `{ ok: false, reason }` on missing file, parse error, or unknown
 * sidecar name.
 */
function readSidecar(fileName) {
  if (!fileName) return { ok: false, reason: "file name is required" };
  const safe = path.basename(fileName);
  if (safe !== fileName) return { ok: false, reason: `invalid file name: ${fileName}` };
  const schema = JSON_SIDECAR_SCHEMAS[safe];
  if (!schema) {
    return {
      ok: false,
      reason: `${safe} is not a registered JSON sidecar`,
      allowed: Object.keys(JSON_SIDECAR_SCHEMAS),
    };
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const filePath = path.join(getStateDir(), safe);
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: "file not found", path: filePath };
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return { ok: false, reason: `read failed: ${e.message}`, path: filePath };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `not valid JSON: ${e.message}`, path: filePath };
  }
  // Sidecar payloads must be JSON objects — null/array/scalar payloads
  // would crash the validation block below on `data.status` access and
  // produce undefined behavior in the downstream grader. Fail loud with
  // a structured ok:false envelope instead of letting a TypeError escape.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    const got = Array.isArray(data) ? "array" : (data === null ? "null" : typeof data);
    return { ok: false, reason: `sidecar must be a JSON object, got ${got}`, path: filePath };
  }
  const validation = {
    valid_status: Array.isArray(schema.status) ? schema.status.includes(data.status) : true,
    valid_verdict: Array.isArray(schema.verdict) ? schema.verdict.includes(data.verdict) : true,
    valid_agent: Array.isArray(schema.agent) ? schema.agent.includes(data.agent) : true,
  };
  return { ok: true, file: safe, data, validation };
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

// Process-level gate for the graphify decision step. Workflows declare in prose
// that "EXACTLY ONE of graph-impact.md or graphify-skip-reason.txt MUST exist"
// after context_init — but with no code enforcement, orchestrators under context
// pressure silently skip the step. This function turns the prose into a hard gate
// that workflow bash blocks call after the graphify decision and STOP with
// BLOCKED on ok:false.
//
// When graphify is not ready (disabled or graph missing), the gate auto-passes —
// the assertion is about orchestrator obedience to the workflow contract, not
// about graphify being installed.
function assertGraphifyDecision() {
  const graphify = require("./graphify.cjs");
  const status = graphify.status();
  if (status.state !== "ready") {
    return {
      ok: true,
      reason: `graphify_state=${status.state} — gate does not apply`,
      graphify_state: status.state,
    };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const graphImpactPath = path.join(dir, "graph-impact.md");
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const skipReasonPath = path.join(dir, "graphify-skip-reason.txt");
  const haveImpact = fs.existsSync(graphImpactPath);
  const haveSkipReason = fs.existsSync(skipReasonPath);
  if (haveImpact && haveSkipReason) {
    return {
      ok: false,
      reason:
        "both graph-impact.md AND graphify-skip-reason.txt exist — mutually exclusive; orchestrator wrote both",
      graphify_state: "ready",
    };
  }
  if (!haveImpact && !haveSkipReason) {
    return {
      ok: false,
      reason:
        "neither graph-impact.md nor graphify-skip-reason.txt exists — orchestrator skipped the graphify decision step in context_init",
      graphify_state: "ready",
    };
  }
  return {
    ok: true,
    file: haveImpact ? "graph-impact.md" : "graphify-skip-reason.txt",
    graphify_state: "ready",
  };
}

// Process-level gate that the orchestrator actually ran `preflight generate`
// in context_init (vs. silently reusing a brief from a prior workflow). Field
// observed (greenfield-api 2026-05-21): orchestrator started a new workflow at
// 21:29 UTC but preflight-brief.json mtime was 17:29 UTC — 4 hours older than
// workflow.yaml::created_at. The orchestrator skipped the regenerate step and
// the stale topic.symbols caused tier=skip → 0 graphify calls.
//
// The gate compares preflight-brief.json mtime against workflow.yaml::created_at.
// When the brief is older than the workflow start, the orchestrator must have
// skipped the regenerate — STOP with BLOCKED. When no workflow.yaml exists (no
// active workflow) OR no brief exists (preflight disabled / failed gracefully),
// auto-pass: the assertion is about orchestrator obedience, not preflight
// installation state.
//
// Auto-passes are NOT failures — workflows wire this AFTER preflight generate
// to catch the orchestrator-skipped-the-call case specifically.
function assertPreflightFresh() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const briefPath = path.join(dir, "preflight-brief.json");
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const workflowPath = path.join(dir, "workflow.yaml");

  if (!fs.existsSync(workflowPath)) {
    return { ok: true, reason: "no workflow.yaml — gate does not apply" };
  }
  if (!fs.existsSync(briefPath)) {
    return { ok: true, reason: "no preflight-brief.json — preflight disabled or failed gracefully" };
  }

  let createdAt;
  try {
    const content = fs.readFileSync(workflowPath, "utf8");
    const m = content.match(/^created_at:\s*"?([^"\n]+)"?\s*$/m);
    if (!m) {
      return { ok: true, reason: "workflow.yaml has no created_at stamp (legacy workflow)" };
    }
    createdAt = new Date(m[1]);
    if (isNaN(createdAt.getTime())) {
      return { ok: true, reason: `workflow.yaml::created_at unparseable: ${m[1]}` };
    }
  } catch (e) {
    return { ok: true, reason: `workflow.yaml read failure: ${e.message}` };
  }

  let briefMtime;
  try {
    briefMtime = fs.statSync(briefPath).mtime;
  } catch (e) {
    return { ok: true, reason: `preflight-brief.json stat failure: ${e.message}` };
  }

  // Allow a small grace window: the brief can be written up to 30s BEFORE the
  // workflow.yaml gets its created_at stamp (atomic ordering during workflow
  // startup is bash-dependent). 30s is well below any sane gap that would
  // indicate skip-and-reuse.
  const ageMs = createdAt.getTime() - briefMtime.getTime();
  const GRACE_MS = 30 * 1000;

  if (ageMs > GRACE_MS) {
    return {
      ok: false,
      reason:
        `preflight-brief.json is ${Math.round(ageMs / 1000)}s older than workflow.yaml::created_at ` +
        `— orchestrator skipped preflight generate in context_init`,
      brief_mtime: briefMtime.toISOString(),
      workflow_created_at: createdAt.toISOString(),
      age_seconds: Math.round(ageMs / 1000),
    };
  }
  return {
    ok: true,
    brief_mtime: briefMtime.toISOString(),
    workflow_created_at: createdAt.toISOString(),
    age_seconds: Math.round(ageMs / 1000),
  };
}

// Decision-artifact gate for the claude-mem harvest pre-step. Mirrors
// assertGraphifyDecision pattern: workflow contract is "EXACTLY ONE of
// claude-mem-harvest.md OR claude-mem-skipped.txt MUST exist after the
// orchestrator's pre-step in context_init". Without enforcement, orchestrators
// under context pressure silently skip the pre-step and discovery never sees
// claude-mem observations — field-validated leak where greenfield's
// _suggestions.md accumulated only graphify god-nodes (zero claude-mem entries)
// despite dozens of workflows running.
//
// When no workflow is active, the gate auto-passes (the assertion is about
// orchestrator obedience to the workflow contract, not about claude-mem
// being installed).
function assertClaudeMemHarvest() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const workflowPath = path.join(dir, "workflow.yaml");
  if (!fs.existsSync(workflowPath)) {
    return { ok: true, reason: "no workflow.yaml — gate does not apply" };
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const harvestPath = path.join(dir, "claude-mem-harvest.md");
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const skippedPath = path.join(dir, "claude-mem-skipped.txt");
  const haveHarvest = fs.existsSync(harvestPath);
  const haveSkipped = fs.existsSync(skippedPath);
  if (haveHarvest && haveSkipped) {
    return {
      ok: false,
      reason: "both claude-mem-harvest.md AND claude-mem-skipped.txt exist — mutually exclusive; orchestrator wrote both",
    };
  }
  if (!haveHarvest && !haveSkipped) {
    return {
      ok: false,
      reason: "neither claude-mem-harvest.md nor claude-mem-skipped.txt exists — orchestrator skipped the claude-mem pre-step in context_init",
    };
  }
  return {
    ok: true,
    file: haveHarvest ? "claude-mem-harvest.md" : "claude-mem-skipped.txt",
  };
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
    case "read-sidecar": {
      const file = _getFlag(args, "--file") || ((args && args.length && !args[0].startsWith("--")) ? args[0] : null);
      return readSidecar(file);
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
    case "audit": {
      const audit = require("./state-audit.cjs");
      return audit.auditStateFiles();
    }
    case "cleanup": {
      const audit = require("./state-audit.cjs");
      const dryRun = !args.includes("--apply");
      const staleArg = _getFlag(args, "--stale-days");
      const opts = { dryRun };
      if (staleArg) opts.staleDays = parseInt(staleArg, 10);
      return audit.cleanupStateFiles(opts);
    }
    case "evict-graphify": {
      const audit = require("./state-audit.cjs");
      const opts = { dryRun: args.includes("--dry-run") };
      const ageArg = _getFlag(args, "--max-age-minutes");
      if (ageArg) opts.maxAgeMinutes = parseInt(ageArg, 10);
      return audit.evictGraphifyArtifacts(opts);
    }
    case "assert-graphify-decision":
      return assertGraphifyDecision();
    case "assert-preflight-fresh":
      return assertPreflightFresh();
    case "assert-claude-mem-harvest":
      return assertClaudeMemHarvest();
    default:
      throw new Error(
        `Unknown state subcommand: ${subcommand}. Use: read, read-section, read-sidecar, truncate-artifact, update, reset, validate, sync, prune, audit, cleanup, evict-graphify, assert-graphify-decision, assert-preflight-fresh, assert-claude-mem-harvest`,
      );
  }
}

module.exports = {
  run,
  readState,
  readSection,
  readSidecar,
  truncateArtifact,
  updateState,
  resetState,
  syncState,
  pruneState,
  checkWorkflowLock,
  validateConsistency,
  assertGraphifyDecision,
  assertPreflightFresh,
  assertClaudeMemHarvest,
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
  ARTIFACT_SCHEMA,
  JSON_SIDECAR_SCHEMAS,
  JSON_INPUT_SCHEMAS,
  validateInputJson,
  VERIFICATION_STATUSES,
  VERIFICATION_VERDICTS,
  RESET_EXEMPT,
  STATE_FILE_CONTRACT,
  SIDECAR_FOR_MARKDOWN,
};
