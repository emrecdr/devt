"use strict";

// state-io — paths, YAML parse/serialize, locking, and the read-only state accessors (readState, sidecar/section reads, consistency validation).
// Mechanical split of the former single-file state.cjs — function bodies are
// verbatim moves; state.cjs remains the facade that re-exports every public
// name, so all consumers keep requiring bin/modules/state.cjs unchanged.

const fs = require("fs");
const path = require("path");
const { findProjectRoot } = require("./config.cjs");
const { atomicWriteFileSync, atomicWriteJsonSync } = require("./io.cjs");
const { FILE_REL: DEFERRED_FILE_REL } = require("./deferred.cjs");
const {
  STATE_DIR,
  WORKFLOW_FILE,
  LOCK_TIMEOUT_MS,
  LOCK_RETRY_MS,
  _INSTANCE_ID_PATTERN,
  ARTIFACT_FRESHNESS_GRACE_MS,
  KNOWN_STATE_KEYS,
  PHASE_ORDER,
  VALID_PHASES,
  PHASE_ARTIFACT_MAP,
  VALID_TIERS,
  TIER_RANK,
  INPUT_ARTIFACTS,
  MISMATCH_REASONS,
  VERIFICATION_STATUSES,
  VERIFICATION_VERDICTS,
  JSON_SIDECAR_SCHEMAS,
  JSON_INPUT_SCHEMAS,
  ARTIFACT_SCHEMA,
  SIDECAR_FOR_MARKDOWN,
  PERSISTENT_ARTIFACTS,
  VALID_WORKFLOW_TYPES,
  VALID_LANE_STATUSES,
  _ACTIVE_SUBAGENT_FRESH_MS,
  ARCHIVE_DIR,
  RESET_EXEMPT,
  STATE_FILE_CONTRACT,
  RESET_SOFT_CLEAR_KEYS,
  RESET_SOFT_ROTATE_LOGS,
  RESET_SOFT_EVICT_PATTERNS,
  TRUNCATABLE_ARTIFACTS,
  _DISK_WARN_MB,
  STUB_MARKER_PATTERNS,
  STUB_WORD_COUNT_THRESHOLD,
  STUB_PHRASE_WORD_CEILING,
  VERIFIER_REQUIRED_WORKFLOWS,
  SELF_FLAG_SIDECAR_FOR_AGENT,
  REUSE_REQUIRED_WORKFLOWS,
  STUB_SIZE_THRESHOLD,
  LANE_DIFF_CHUNKED_THRESHOLD,
  LANE_DIFF_SPLIT_THRESHOLD,
  SIZING_EXCLUDE_DEFAULT,
} = require("./state-contract.cjs");

function getStateDir() {
  const instanceId = process.env.DEVT_WORKFLOW_ID;
  if (instanceId && _INSTANCE_ID_PATTERN.test(instanceId)) {
    return path.join(findProjectRoot(), STATE_DIR, instanceId);
  }
  if (instanceId) {
    // Invalid format — fall back and warn (path safety).
    try { process.stderr.write(`[devt] DEVT_WORKFLOW_ID="${instanceId}" rejected (not [A-Za-z0-9_-]{1,64}) — using legacy state dir\n`); } catch { /* ignore */ }
  }
  return path.join(findProjectRoot(), STATE_DIR);
}

// Always returns the project-level state root, regardless of DEVT_WORKFLOW_ID.
// Use this for files that MUST be shared across instances: deferred.md,
// council transcripts, last-curator-run.txt cooldown markers, project-wide
// locks, .archive/ ring buffer, .instances/ registry.
function getStateRoot() {
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


function isArtifactFresh(artifactPath) {
  if (!fs.existsSync(artifactPath)) {
    return { fresh: true, reason: "artifact absent (caller handles existence)" };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const workflowPath = path.join(dir, "workflow.yaml");
  if (!fs.existsSync(workflowPath)) {
    return { fresh: true, reason: "no workflow.yaml — freshness check inapplicable" };
  }
  let createdAt;
  try {
    const yaml = fs.readFileSync(workflowPath, "utf8");
    // Prefer first_created_at (immutable session anchor) over created_at
    // (which rotates on workflow_type transitions). Fall back to created_at
    // when first_created_at is absent — older workflow.yaml files predate
    // the immutable field.
    const mFirst = yaml.match(/^first_created_at:\s*"?([^"\n]+)"?\s*$/m);
    const mLegacy = yaml.match(/^created_at:\s*"?([^"\n]+)"?\s*$/m);
    const m = mFirst || mLegacy;
    if (!m) return { fresh: true, reason: "workflow.yaml has no created_at stamp" };
    createdAt = new Date(m[1]).getTime();
    if (isNaN(createdAt)) return { fresh: true, reason: "workflow.yaml::created_at unparseable" };
  } catch {
    return { fresh: true, reason: "workflow.yaml read failure" };
  }
  let artifactMtime;
  try {
    artifactMtime = fs.statSync(artifactPath).mtime.getTime();
  } catch {
    return { fresh: true, reason: "artifact stat failure" };
  }
  const ageMs = createdAt - artifactMtime;
  if (ageMs > ARTIFACT_FRESHNESS_GRACE_MS) {
    return {
      fresh: false,
      reason: `artifact mtime is ${Math.round(ageMs / 1000)}s older than workflow.yaml::created_at — file is from a prior workflow`,
      artifact_mtime: new Date(artifactMtime).toISOString(),
      workflow_created_at: new Date(createdAt).toISOString(),
      age_seconds: Math.round(ageMs / 1000),
    };
  }
  return {
    fresh: true,
    artifact_mtime: new Date(artifactMtime).toISOString(),
    workflow_created_at: new Date(createdAt).toISOString(),
    age_seconds: Math.round(ageMs / 1000),
  };
}

/**
 * Simple YAML-like parser for workflow state.
 * Handles flat key: value pairs at the top level, plus a single nested
 * block: `lanes:` followed by `  - id: "..."` entries. The lanes block is
 * round-tripped as a structured array on the special-case path; all other
 * top-level keys round-trip as scalars (objects/arrays get JSON.stringify'd
 * on write and JSON.parse'd on read when the value looks like JSON).
 *
 * Why nested `lanes:` is special-cased: the simple flat parser would
 * otherwise drop the block on read, causing `state update` to re-serialize
 * without it and assert-lanes-registered to report lane_count: 0 after any
 * state mutation between partition_lanes and dispatch_lanes.
 *
 * Why objects/arrays are JSON-encoded before quote-wrap: template coercion
 * would otherwise stringify them to "[object Object]" / "1,2,3", destroying
 * memory_signal_json and scope_hint_json caches on every state.update call.
 * Objects/arrays serialize via JSON.stringify before write; JSON-shaped
 * strings parse back into structured data on read so downstream code sees
 * objects, not stringified blobs.
 */

function parseSimpleYaml(content) {
  const result = {};
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) { i++; continue; }
    // Special-case: lanes: header followed by indented `- id:` entries.
    // Capture the contiguous block until the next non-indented line.
    if (trimmed === "lanes:") {
      const lanes = [];
      i++;
      let current = null;
      while (i < lines.length) {
        const sub = lines[i];
        if (!sub.startsWith("  ")) break; // de-indent — block ended
        const subTrim = sub.trim();
        if (subTrim.startsWith("- id:")) {
          if (current) lanes.push(current);
          current = {};
          const idMatch = subTrim.match(/^-\s+id:\s*"?([^"\n]+)"?\s*$/);
          if (idMatch) current.id = idMatch[1];
        } else if (current) {
          const kvMatch = subTrim.match(/^([\w-]+):\s*(.+)$/);
          if (kvMatch) {
            const [, k, rawV] = kvMatch;
            let v = rawV;
            if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
            else if (v === "true") v = true;
            else if (v === "false") v = false;
            else if (/^\d+$/.test(v)) v = parseInt(v, 10);
            current[k] = v;
          }
        }
        i++;
      }
      if (current) lanes.push(current);
      result.lanes = lanes;
      continue;
    }
    const match = trimmed.match(/^([\w-]+):\s*(.+)$/);
    if (match) {
      const [, key, rawValue] = match;
      let value = rawValue;
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
        // JSON-shaped strings parse back to structured data so downstream
        // consumers see objects/arrays, not stringified blobs.
        if ((value.startsWith("{") && value.endsWith("}")) ||
            (value.startsWith("[") && value.endsWith("]"))) {
          try { result[key] = JSON.parse(value); }
          catch { result[key] = value; }
        } else {
          result[key] = value;
        }
      } else if (value === "true") result[key] = true;
      else if (value === "false") result[key] = false;
      else if (value === "null") result[key] = null;
      else if (/^\d+$/.test(value)) result[key] = parseInt(value, 10);
      else result[key] = value;
    }
    i++;
  }
  return result;
}


function serializeSimpleYaml(obj) {
  const lines = [];
  let lanesBlock = null;
  for (const [key, value] of Object.entries(obj)) {
    if (key === "lanes" && Array.isArray(value)) {
      // Lanes round-trip as a structured block, preserving every lane's
      // fields across state mutations.
      lanesBlock = value;
      continue;
    }
    // Objects + arrays serialize via JSON.stringify before the quote-wrap
    // path. Without this, template coercion stringifies objects to
    // "[object Object]" and arrays to "1,2,3" (comma-join).
    if (value && typeof value === "object") {
      const json = JSON.stringify(value);
      const escaped = json.replace(/"/g, '\\"');
      lines.push(`${key}: "${escaped}"`);
      continue;
    }
    if (typeof value === "string" && (value.includes(":") || value.includes("\n") || value.includes('"') || value.includes("#"))) {
      lines.push(`${key}: "${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
      continue;
    }
    lines.push(`${key}: ${value}`);
  }
  if (lanesBlock) {
    lines.push("lanes:");
    for (const lane of lanesBlock) {
      const id = lane.id || "";
      lines.push(`  - id: "${id}"`);
      for (const [k, v] of Object.entries(lane)) {
        if (k === "id") continue;
        if (typeof v === "string") {
          lines.push(`    ${k}: "${v.replace(/"/g, '\\"')}"`);
        } else {
          lines.push(`    ${k}: ${v}`);
        }
      }
    }
  }
  return lines.join("\n") + "\n";
}


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


// Round 7 W5 — count actual file paths in the canonical scope list. The file
// has `## Files` headers + bullets + blank lines + a `## Source` provenance
// block; `wc -l` overcounts. We parse `- <path>` lines only. Returns null
// when no scope file exists (e.g. dev-workflow not at scope_check yet).
function getScopeFileCount() {
  try {
    const scopePath = path.join(getStateDir(), "code-review-input.md");
    if (!fs.existsSync(scopePath)) return null;
    const content = fs.readFileSync(scopePath, "utf8");
    let count = 0;
    for (const line of content.split("\n")) {
      // Bullet items at column 0 with a non-empty token after `- ` count
      // as one file path. Tolerates leading spaces on continuation lines.
      if (/^\-\s+\S/.test(line)) count++;
    }
    return count;
  } catch {
    return null;
  }
}


// Round 7 W5 — derive the deterministic minimum tier from observable scope
// signals. Today the only signal is file_count; future signals (services
// touched, infra changes, schema migrations) can extend this without
// changing the caller contract. Null result → no floor; keep agent's choice.
function computeTierFloor() {
  const count = getScopeFileCount();
  if (count === null) return null;
  if (count >= 10) return "COMPLEX";  // dev-workflow.md:399 heuristic: 10+ files → COMPLEX
  if (count >= 4) return "STANDARD";  // SIMPLE requires ≤2, TRIVIAL requires ≤3
  return null;
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
  // Deep-parse `_json`-suffixed values so consumers don't have to.
  // Why: `STATE=$(state read); echo "$STATE" | jq` breaks because zsh's echo
  // interprets embedded `\n` escapes in nested string values, producing
  // invalid JSON for downstream jq. With deep-parse, those keys hold real
  // objects/arrays — no escape sequences to misinterpret.
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
  if (state.workflow_type === "arch_health_scan") {
    // The arch flow has no scan phase, and arch_health is the dev-side
    // opt-in artifact — field: both rows false-fired "missing" against a
    // task-service arch run whose own phase artifact is the architect review.
    delete PHASE_ARTIFACTS.scan;
    delete PHASE_ARTIFACTS.arch_health;
  } else {
    delete PHASE_ARTIFACTS.arch_health_scan;
  }

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
  // Sidecar mismatches carry a .json artifact name — the markdown wording
  // ("## Status line") on a JSON field check reads as a bogus check and
  // erodes trust in the validator (field-reported).
  const isSidecar = typeof m.expected_artifact === "string" && m.expected_artifact.endsWith(".json");
  switch (m.reason) {
    case MISMATCH_REASONS.MISSING: return "is missing";
    case MISMATCH_REASONS.NO_STATUS_LINE:
      return isSidecar ? 'is missing its "status" field (JSON sidecar routing contract)' : "has no `## Status` line";
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
  // A validation false without the allowed set is unactionable; surface what
  // WOULD pass so the consumer can route on it.
  if (!validation.valid_status && Array.isArray(schema.status)) validation.allowed_status = schema.status;
  if (!validation.valid_verdict && Array.isArray(schema.verdict)) validation.allowed_verdict = schema.verdict;
  // Per-schema custom checks — field-driven guards the enum trio can't express
  // (e.g. verification.json requiring criteria_total, review.json requiring a
  // reason when lane scores are all null). Each check returns a reason string
  // or null; failures surface as schema_warnings, never a hard ok:false —
  // routing consumers decide severity, same contract as the enum validators.
  if (Array.isArray(schema.checks)) {
    const warnings = schema.checks.map((fn) => { try { return fn(data); } catch { return null; } }).filter(Boolean);
    if (warnings.length) validation.schema_warnings = warnings;
    validation.valid_fields = warnings.length === 0;
  }
  // Routing fields hoisted to the TOP level alongside the full payload —
  // `read-sidecar verification.json | jq '.status'` previously returned null
  // (the fields live under .data) while the assert gates read the same file
  // directly and saw them fine. Field-reported as "confusing to route on";
  // the top-level mirror makes the obvious jq path the correct one.
  return {
    ok: true,
    file: safe,
    status: data.status !== undefined ? data.status : null,
    verdict: data.verdict !== undefined ? data.verdict : null,
    agent: data.agent !== undefined ? data.agent : null,
    data,
    validation,
  };
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
        "A workflow is already active. Run /devt:workflow --cancel first, or wait for it to complete.",
    };
  }
  return { locked: false };
}

/**
 * Release an active workflow lock cleanly. Sets active=false, phase=cancelled,
 * status=cancelled, and stamps released_at. Distinct from resetState (which
 * archives all artifacts) — release preserves task outputs so a follow-up
 * /devt:next or /devt:workflow --retro can still consume them.
 *
 * Why a dedicated subcommand: ad-hoc
 * `state update active=false phase=cancelled status=cancelled` trips the
 * VALID_PHASES warning. This subcommand encapsulates the correct mutation
 * set and stamps released_at so /devt:debug --mode=forensics can distinguish
 * orderly release from interrupted state.
 */


// Chain-aware workflow-id set. workflow_id rotates on every workflow_type
// transition (a single review session can hop preflight → code_review →
// code_review_parallel and rotate several times), so any consumer filtering
// artifacts or trace records by "this workflow's id" MUST match the whole
// session chain — current + original + workflow_id_history — or real
// same-session records classify as foreign (field failure: a lane stamped
// under an intermediate rotation was dropped from consolidation, and real
// get_neighbors trace records were counted as fabricated). Membership alone
// is NOT sufficient: resetSoft PRESERVES history across working sessions, so
// consumers must pair the chain with an mtime/ts >= anchor_ms bound to keep
// prior-session artifacts out.
// Returns { ids: Set<full-id>, prefixes: Set<8-char>, anchor_ms }.
function workflowIdChainSet(yaml) {
  const ids = new Set();
  const addId = (v) => {
    const t = String(v || "").trim();
    if (t) ids.add(t);
  };
  addId((yaml.match(/^workflow_id:\s*"?([^"\n]+)"?\s*$/m) || [])[1]);
  addId((yaml.match(/^original_workflow_id:\s*"?([^"\n]+)"?\s*$/m) || [])[1]);
  const histLine = (yaml.match(/^workflow_id_history:\s*(.+)$/m) || [])[1];
  if (histLine) {
    // History is a JSON array serialized into a quoted YAML scalar; UUID
    // extraction sidesteps the double-escaping rather than re-parsing it.
    const uuids = histLine.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [];
    for (const u of uuids) ids.add(u);
  }
  let anchorMs = 0;
  const anchorMatch = yaml.match(/^first_created_at:\s*"?([^"\n]+)"?\s*$/m);
  if (anchorMatch) {
    const parsed = new Date(anchorMatch[1].trim()).getTime();
    if (Number.isFinite(parsed)) anchorMs = parsed;
  }
  const prefixes = new Set();
  for (const id of ids) prefixes.add(id.slice(0, 8));
  return { ids, prefixes, anchor_ms: anchorMs };
}


// Extract --flag <value> from a positional args array. Returns null when absent.
function _getFlag(args, name) {
  if (!Array.isArray(args)) return null;
  // Accept both `--flag value` (space-separated) and `--flag=value` (equals-
  // separated) forms — historically only the former worked, which silently
  // dropped equals-form invocations (state cleanup --stale-days=1 became a
  // no-op because parseInt(null) is NaN and the cleanup left staleDays at
  // the default).
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) {
      if (i + 1 < args.length) return args[i + 1];
      return null;
    }
    if (typeof arg === "string" && arg.startsWith(name + "=")) {
      return arg.slice(name.length + 1);
    }
  }
  return null;
}

// Active commit-range scope, persisted in workflow.yaml by contextInitBundle.
// All scope consumers (affects union, diff-symbol extraction, manifest
// freshness — plus every child CLI the bundle shells out to) read it from
// state instead of threading a parameter through a dozen signatures.
function _activeRange() {
  try {
    const r = readState().range;
    return typeof r === "string" && r.trim() && r !== "null" ? r.trim() : null;
  } catch { return null; }
}

module.exports = {
  _activeRange,
  getStateDir,
  getStateRoot,
  getWorkflowPath,
  ensureStateDir,
  isArtifactFresh,
  parseSimpleYaml,
  serializeSimpleYaml,
  warnState,
  validateStateEntry,
  getScopeFileCount,
  computeTierFloor,
  readState,
  extractStatus,
  validateConsistency,
  validateInputJson,
  describeMismatch,
  sleepSync,
  acquireLock,
  releaseLock,
  readSidecar,
  readSection,
  checkWorkflowLock,
  workflowIdChainSet,
  _getFlag,
};
