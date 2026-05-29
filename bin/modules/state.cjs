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

// Freshness check: an artifact is fresh if its mtime is no more than
// 30 seconds OLDER than workflow.yaml::created_at. Files from prior
// workflows have mtime << current created_at → return fresh:false.
//
// Returns: { fresh: bool, reason?: string, artifact_mtime?, workflow_created_at?, age_seconds? }
//
// Auto-passes (fresh:true) when:
//   - workflow.yaml has no created_at field (legacy / fresh project)
//   - workflow.yaml does not exist
//   - artifact does not exist (caller handles existence separately)
//
// Binding to workflow.yaml::created_at (reset on every init * verb) makes
// each gate workflow-current: stale prior-workflow artifacts that passed
// existence-only checks now fail with a clear staleness message.
const ARTIFACT_FRESHNESS_GRACE_MS = 30 * 1000;

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
    // NEW-1: prefer first_created_at (immutable session anchor) over
    // created_at (rotates on workflow_type transitions). Backward-compat:
    // fall back to created_at when first_created_at is absent — older
    // workflow.yaml files predate the immutable field.
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
 * NEW-2 (greenfield calibration #5): the legacy parser dropped nested
 * `lanes:` blocks entirely on read, causing every `state update` to
 * re-serialize without them — `assert-lanes-registered` would report
 * lane_count: 0 after any state mutation between partition_lanes and
 * dispatch_lanes.
 *
 * NEW-3: the legacy serializer did `${value}` template coercion, which
 * stringifies non-primitive objects to "[object Object]" — the
 * memory_signal_json and scope_hint_json caches were getting destroyed
 * on every state.update call. Now: objects/arrays get JSON.stringify'd
 * before write, and JSON-shaped strings get parsed back into objects on
 * read so downstream code sees structured data, not stringified blobs.
 */
function parseSimpleYaml(content) {
  const result = {};
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) { i++; continue; }
    // NEW-2 special-case: lanes: header followed by indented `- id:` entries.
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
        // NEW-3: JSON-shaped strings parse back to structured data so
        // downstream consumers see objects/arrays, not stringified blobs.
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
      // NEW-2: lanes round-trip as a structured block, preserving every
      // lane's fields across state mutations.
      lanesBlock = value;
      continue;
    }
    // NEW-3: objects + arrays serialize via JSON.stringify before the
    // quote-wrap path. Without this, template coercion stringifies
    // objects to "[object Object]" and arrays to "1,2,3" (comma-join).
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
  first_created_at: "string",
  original_workflow_id: "string",
  // Append-only chain of workflow_ids the active session has held. Populated
  // on every workflow_type transition (state.cjs::updateState) so mcp-stats
  // --workflow-id can union all historical ids when matching the current one,
  // not just the original ↔ current 1-hop. Serializes as JSON-stringified
  // array via the NEW-3 path; typeof [] is "object" for schema validation.
  workflow_id_history: "object",
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
  // Terminal phase set by `state release` for workflows abandoned mid-flight
  // (greenfield 2026-05-28 PM calibration #3 finding #3: ad-hoc workaround
  // `state update active=false phase=cancelled` tripped the VALID_PHASES
  // warning because the enum didn't include the value the workflow actually
  // ended in). Distinct from "complete" (normal terminal) and "finalize"
  // (last-step-before-complete).
  "cancelled",
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
// baseline-gates.md, debug-context.md, debug-investigation.md, code-review-input.md,
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
  "code-review-input.md", "session-report.md", "autoskill-proposals.md",
  "arch-baseline.json", "arch-triage.json", "scanner-output.txt", "scan-delta.md",
];

const VALID_WORKFLOW_TYPES = new Set([
  "dev", "quick_implement", "debug", "retro", "code_review", "code_review_parallel", "arch_health_scan",
  "research", "plan", "specify", "clarify",
  // Memory layer workflow types — see workflows/memory-*.md.
  // memory_promote: curator promotes ephemeral DEC -> permanent ADR.
  // memory_reject: curator creates a REJ tombstone with search_keywords.
  // preflight: standalone Topic Pre-Flight Brief generation.
  // (memory_init / memory_index are CLI-only subcommands — they don't set state and aren't workflow_types.)
  "memory_promote", "memory_reject", "preflight",
  null,
]);

// Lane-status enum for code-review-parallel.md::workflow.yaml::lanes[].
// in_flight       — Task() dispatched, lane file may be empty/stub
// substance_pass  — state check-agent-output returned ok:true
// stub_redispatched — first F28 stub; will be re-dispatched once
// deferred        — second F28 stub OR harness failure; consolidator notes it
const VALID_LANE_STATUSES = new Set([
  "in_flight", "substance_pass", "stub_redispatched", "deferred",
]);

// Slug normalization for lane file names. Graphify affected_communities[].name
// can carry spaces, hyphens, slashes, or other separators that would produce
// invalid filenames. Rule: lowercase, replace non-alphanum with underscore,
// collapse repeats, trim, cap at 32 chars. Deterministic and stable across
// re-partitions.
function slugifyLaneName(name) {
  if (!name || typeof name !== "string") return "ungrouped";
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return slug || "ungrouped";
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
    //
    // NEW-1 (greenfield calibration #5): two fields are immutable for the lifetime
    // of the workflow:
    //   - first_created_at — frozen at first active=true; used by freshness gates
    //     (assert-preflight-fresh, assert-claude-mem-harvest, assert-graphify-decision)
    //     as the staleness anchor. Survives workflow_type transitions.
    //   - original_workflow_id — frozen at first active=true; used by mcp-stats
    //     --since-workflow-created to find ALL trace records from session start
    //     regardless of mid-session workflow_id rotations.
    //
    // The mutable workflow_id + created_at continue to rotate on workflow_type
    // transitions — that intent (trace attribution per logical workflow) stays
    // correct. The bug was that freshness gates conflated "logical workflow"
    // (which legitimately resets on transition) with "session anchor" (which
    // must NOT reset, otherwise artifacts written before the transition look
    // stale to gates running after).
    if (current.active === true && !current.created_at) {
      const now = new Date().toISOString();
      current.created_at = now;
      current.workflow_id = current.workflow_id || require("crypto").randomUUID();
      // Freeze the immutable anchors on first activation only.
      if (!current.first_created_at) current.first_created_at = now;
      if (!current.original_workflow_id) current.original_workflow_id = current.workflow_id;
      if (!Array.isArray(current.workflow_id_history)) {
        current.workflow_id_history = [current.workflow_id];
      }
    } else if (
      current.active === true &&
      previousWorkflowType &&
      current.workflow_type &&
      previousWorkflowType !== current.workflow_type
    ) {
      // workflow_type transition while active — new logical workflow, fresh stamps.
      // Closes the attribution bug where /devt:review running on top of an active
      // /devt:workflow would write trace records with the old workflow_id.
      // first_created_at + original_workflow_id are NOT touched here — they
      // anchor the session, not the logical workflow.
      //
      // Append the outgoing id to workflow_id_history BEFORE overwrite — the
      // 1-hop union in mcp-stats.cjs (HF-2) couldn't see trace records written
      // during intermediate workflows when the session chained through more
      // than two workflow_types. G6 widens the union to the whole chain.
      if (!Array.isArray(current.workflow_id_history)) {
        current.workflow_id_history = current.original_workflow_id
          ? [current.original_workflow_id]
          : [];
      }
      if (current.workflow_id && !current.workflow_id_history.includes(current.workflow_id)) {
        current.workflow_id_history.push(current.workflow_id);
      }
      current.created_at = new Date().toISOString();
      current.workflow_id = require("crypto").randomUUID();
      current.workflow_id_history.push(current.workflow_id);
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
  "probe-failures.jsonl",               // Q4 — graphify+python probe failures (category, command, args, error). Survives reset so health subcommand can surface root-cause across sessions.
  ".graphify-rebuild.lock",             // DEF-038 — atomic O_CREAT|O_EXCL lock for graphify rebuild --debounce. Survives reset so a crashed prior holder doesn't deadlock a fresh workflow (the rebuild path also unlinks the lock when mtime exceeds the debounce window).
  "last-curator-run.txt",               // F6 — auto-curator cooldown tracker; survives reset so the 7-day gate isn't bypassed by /devt:cancel-workflow
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
    "scan-results.md", "scan-delta.md",
    "test-summary.md",          // markdown side of test-summary sidecar
    "lessons.yaml",             // retro hand-off draft
    "debug-context.md", "debug-investigation.md", "debug-summary.md",
    "arch-review.md", "arch-health-scan.md", "arch-baseline.json",
    "arch-triage.json", "scanner-output.txt",
    "docs-summary.md", "curation-summary.md", "session-report.md",
    "autoskill-proposals.md", "baseline-gates.md",
    "claude-mem-harvest.md", "claude-mem-skipped.txt", "last-curator-run.txt",
    "continue-here.md",         // /devt:pause output (paired with handoff.json)
    "graph-impact.md",
    "graphify-impact-plan.json", // bash-computed tier+tool decision for code-review impact step
    "graphify-skip-reason.txt", // explicit-skip artifact when the impact step's plan == "skip"
    "staleness-suppressed.txt", // mechanical-override artifact when staleness gate forces scope_trust='sparse'
    "preflight-brief.json",     // JSON sidecar for preflight-brief.md (no routing — input-only)
    "weekly-report.md",         // output of `devt-tools report generate` — weekly contributor + commit summary
    "review.md", "code-review-input.md",
    "scope-check-required.txt", // marker written when >10-file + graphify-ready gate fires
    "scope-check-answer.txt",   // orchestrator writes user's parallel/single/cancel choice
    "consolidator-ran.txt",     // marker written by consolidator synthesis entry (assert-consolidator-dispatched)
    "auto-curator-considered.txt", // marker written by auto_curator step (assert-auto-curator-considered)
    "reuse-candidates.md",      // written by state derive-reuse-candidates (reuse pre-search)
    "reuse-analysis.md",        // written by programmer per-candidate decisions (assert-reuse-analyzed gate)
    "reuse-search-attempted.txt", // marker written by workflow bash BEFORE derive-reuse-candidates CLI — distinguishes "never ran" from "ran with 0 candidates"
    "knowledge-candidates-none.txt", // declared-none artifact for assert-knowledge-candidates-tagged (escape hatch with structured reason)
    "topic-symbols-dropped.json",  // C7-2 — symbols dropped when symbol_anchored truncates >32 from preflight; consumed by code-review F17 step to emit truncation notice in graph-impact.md
    "probe-failures.jsonl",        // Q4 — append-only diagnostic log of graphify+python probe failures; RESET_EXEMPT so health subcommand can surface root-cause across sessions
  ],
  allowed_patterns: [
    "^review-[A-Za-z0-9_.-]+\\.md$",                // review-architecture.md, review-pr367-slice-A.md
    "^impl-summary-[A-Za-z0-9_.-]+\\.(md|json)$",   // impl-summary-cr3.{md,json}
    "^test-summary-[A-Za-z0-9_.-]+\\.(md|json)$",
    "^verification-[A-Za-z0-9_.-]+\\.(md|json)$",
    "^slice-[A-Za-z0-9_.-]+\\.md$",
    // F10 — slug variants for plan-class / research-class / spec-class / debug-class.
    // Use case: multi-phase tasks where one workflow produces multiple plan/research/debug
    // artifacts. Each variant carries a task-derived slug so archived snapshots are
    // browseable via `state history`. NOT for parallel-concurrent workflows — single-tenant
    // is preserved; only the within-workflow slice case is enabled.
    "^plan-[A-Za-z0-9_.-]+\\.md$",
    "^research-[A-Za-z0-9_.-]+\\.md$",
    "^spec-[A-Za-z0-9_.-]+\\.md$",
    "^debug-(context|investigation|summary)-[A-Za-z0-9_.-]+\\.md$",
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
 * Release an active workflow lock cleanly. Sets active=false, phase=cancelled,
 * status=cancelled, and stamps released_at. Distinct from resetState (which
 * archives all artifacts) — release preserves task outputs so a follow-up
 * /devt:next or /devt:retro can still consume them.
 *
 * Field signal (greenfield 2026-05-28 PM calibration #3 finding #3): the
 * ad-hoc workaround `state update active=false phase=cancelled status=cancelled`
 * tripped the VALID_PHASES warning. This subcommand encapsulates the correct
 * mutation set and stamps released_at so /devt:forensics can distinguish
 * orderly release from interrupted state.
 */
function releaseWorkflow() {
  const current = readState();
  if (!current || current.active === false) {
    return {
      ok: true,
      already_released: true,
      reason: "no active workflow — release is a no-op",
      previous_phase: current && current.phase,
      previous_workflow_type: current && current.workflow_type,
    };
  }
  const released_at = new Date().toISOString();
  updateState([
    "active=false",
    "phase=cancelled",
    "status=cancelled",
    `released_at=${released_at}`,
  ]);
  return {
    ok: true,
    released: true,
    workflow_id: current.workflow_id,
    workflow_type: current.workflow_type,
    previous_phase: current.phase,
    released_at,
  };
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
  // F18 — content-quality signal. The gate passes when one artifact exists,
  // but workflows + auditors benefit from knowing whether graph-impact.md
  // carries substantive content. Field observation (greenfield 2026-05-26):
  // "I had no signal whether content was complete enough." We expose
  // file_bytes + section_count (Markdown `## ` headings) so downstream tooling
  // can flag thin payloads as advisory — never block, since legitimate empty
  // results exist (e.g., leaf nodes with zero callers).
  //
  // B6 — drill-down count signal (signal-only, not blocking). F16 prescribes
  // top-3 drill-down on direct_dependents but the bash gate only writes
  // graph-impact.md without enforcing section structure. Field 2026-05-26:
  // orchestrator drilled top-1 (ClientService) and skipped top-2/3. We count
  // `## Drill-down:` sections and surface drill_down_sections +
  // under_three_drill_downs so workflows / auditors can flag incomplete F16
  // execution. Not enforced as BLOCK because legitimate small graphs may have
  // fewer than 3 direct_dependents to drill into.
  const filePath = haveImpact ? graphImpactPath : skipReasonPath;
  let fileBytes = 0;
  let sectionCount = 0;
  let drillDownSections = 0;
  // Per-section substance bookkeeping. Field (greenfield 2026-05-27 PR #372 P5):
  // F26 counted sections but didn't measure each section's body. A response can
  // have 3 headings with empty bodies and pass the count gate. We measure each
  // drill-down section's byte count after the heading; require ≥ 200 bytes OR
  // an explicit truncation marker ("— TRUNCATED" or "saved to /tmp/.../") that
  // documents an oversized response was saved off-context for later reference.
  const DRILL_DOWN_MIN_BYTES = 200;
  const TRUNCATION_MARKER_RE = /(?:—\s*TRUNCATED\b|saved (?:to|at)\s+[/\w.-]+)/i;
  const thinDrillDowns = [];
  let thinDrillDownSections = 0;
  try {
    fileBytes = fs.statSync(filePath).size;
    if (haveImpact && fileBytes > 0) {
      const content = fs.readFileSync(filePath, "utf8");
      const m = content.match(/^##\s+/gm);
      sectionCount = m ? m.length : 0;
      const dm = content.match(/^##\s+Drill-down:/gim);
      drillDownSections = dm ? dm.length : 0;
      if (drillDownSections > 0) {
        // Split on drill-down headings; track each section's body length.
        // Each section runs until the next ^## heading or EOF.
        const sections = content.split(/(?=^##\s+Drill-down:)/gim).slice(1);
        for (const sec of sections) {
          const lines = sec.split("\n");
          const heading = lines[0] || "";
          // Body = everything after the heading line, up to next ^## (already
          // handled by the split lookahead) or EOF.
          const body = lines.slice(1).join("\n").trim();
          const bodyBytes = Buffer.byteLength(body, "utf8");
          const hasTruncMarker = TRUNCATION_MARKER_RE.test(body);
          if (bodyBytes < DRILL_DOWN_MIN_BYTES && !hasTruncMarker) {
            thinDrillDownSections++;
            const symMatch = heading.match(/^##\s+Drill-down:\s*(.+?)\s*$/i);
            thinDrillDowns.push({
              symbol: symMatch ? symMatch[1] : heading.trim(),
              body_bytes: bodyBytes,
            });
          }
        }
      }
    }
  } catch { /* stat/read failure — leave zeros, gate still passes */ }
  const thin = haveImpact && fileBytes < 200;
  const underThreeDrillDowns = haveImpact && drillDownSections < 3;
  const hasThinDrillDowns = thinDrillDownSections > 0;
  // Substance check: a drill-down section in graph-impact.md asserts the
  // orchestrator called get_neighbors via MCP. Field (greenfield 2026-05-26
  // PR #372): 3 prose drill-downs were written from codebase knowledge with
  // zero MCP calls — form-only gate (sections exist) passed silently. Cross-
  // reference _mcp-trace.jsonl for get_neighbors records scoped to the
  // current workflow_id; if drill-down headings exist but no MCP calls
  // landed in this workflow's window, mark fabricated and fail the gate.
  let mcpGetNeighborsCalls = 0;
  let fabricatedDrillDown = false;
  if (haveImpact && drillDownSections >= 1) {
    try {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const wfPath = path.join(dir, "workflow.yaml");
      if (fs.existsSync(wfPath)) {
        const wfYaml = fs.readFileSync(wfPath, "utf8");
        // HF-1: build a Set of acceptable workflow_ids — current rotated value
        // PLUS the original anchor — so trace records emitted BEFORE the
        // workflow_type transition still match. Greenfield calibration #7
        // hit "fabricated drill-down" false positive because the orchestrator's
        // 3 get_neighbors calls landed under the prior workflow_id while the
        // gate queried the rotated one. Backward-compat: when original is
        // absent (legacy workflow.yaml), only the current id is accepted.
        const wfIdMatch = wfYaml.match(/^workflow_id:\s*"?([^"\n]+)"?\s*$/m);
        const origIdMatch = wfYaml.match(/^original_workflow_id:\s*"?([^"\n]+)"?\s*$/m);
        const acceptedIds = new Set();
        if (wfIdMatch) acceptedIds.add(wfIdMatch[1].trim());
        if (origIdMatch) acceptedIds.add(origIdMatch[1].trim());
        if (acceptedIds.size > 0) {
          // _mcp-trace.jsonl is in .devt/memory/ — sibling of .devt/state/
          const memDir = path.join(path.dirname(dir), "memory");
          // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
          const tracePath = path.join(memDir, "_mcp-trace.jsonl");
          if (fs.existsSync(tracePath)) {
            const content = fs.readFileSync(tracePath, "utf8");
            const lines = content.split("\n");
            for (const line of lines) {
              if (!line) continue;
              try {
                const rec = JSON.parse(line);
                if (acceptedIds.has(rec.workflow_id) &&
                    typeof rec.tool === "string" &&
                    /graphify.*get_neighbors/.test(rec.tool)) {
                  mcpGetNeighborsCalls++;
                }
              } catch { /* malformed line — skip */ }
            }
          }
        }
      }
    } catch { /* trace unavailable — leave count at 0 */ }
    fabricatedDrillDown = mcpGetNeighborsCalls === 0;
  }
  const result = {
    ok: !fabricatedDrillDown && !hasThinDrillDowns,
    file: haveImpact ? "graph-impact.md" : "graphify-skip-reason.txt",
    graphify_state: "ready",
    file_bytes: fileBytes,
    section_count: sectionCount,
    drill_down_sections: drillDownSections,
    mcp_get_neighbors_calls: mcpGetNeighborsCalls,
    thin_content: thin,
    under_three_drill_downs: underThreeDrillDowns,
    fabricated_drill_down: fabricatedDrillDown,
    thin_drill_down_sections: thinDrillDownSections,
    thin_drill_downs: thinDrillDowns,
  };
  if (fabricatedDrillDown) {
    result.reason =
      `drill-down sections present (${drillDownSections}) but no get_neighbors ` +
      `MCP calls recorded in workflow_id window — fabricated drill-down`;
  } else if (hasThinDrillDowns) {
    const sym = thinDrillDowns.map(d => `${d.symbol}=${d.body_bytes}B`).join(", ");
    result.reason =
      `${thinDrillDownSections} drill-down section(s) below ${DRILL_DOWN_MIN_BYTES}-byte ` +
      `substance threshold with no truncation marker (${sym}). Either the MCP ` +
      `response was empty or the drill-down was hand-typed.`;
  }
  if (result.ok) {
    const freshness = isArtifactFresh(filePath);
    if (!freshness.fresh) {
      return {
        ok: false,
        file: haveImpact ? "graph-impact.md" : "graphify-skip-reason.txt",
        graphify_state: "ready",
        reason: `${freshness.reason} — graph-impact may be from a prior workflow; re-run preflight/graphify`,
        artifact_mtime: freshness.artifact_mtime,
        workflow_created_at: freshness.workflow_created_at,
        age_seconds: freshness.age_seconds,
      };
    }
  }
  return result;
}

// Substance check for agent output files. Field (greenfield 2026-05-26
// PR #372): 5/6 lane sub-agent dispatches returned status:completed with
// placeholder bodies like "Stub written; analysis in progress." The verifier
// approved them on file-existence alone. This function detects stub markers,
// low word count, and heading-only structure so downstream gates can refuse
// to accept the output without re-dispatch.
const STUB_MARKER_PATTERNS = [
  /\bstub written\b/i,
  // Verb-prefixed "in progress" variants. Field validation (greenfield 2026-05-26)
  // surfaced "Stub: analysis in progress" — broader pattern catches realistic
  // variants without false-positives on substantive prose (validated against
  // real review.md files: matches stub, zero matches on 2132-word real review).
  /\b(?:analysis|implementation|review|work|writing|investigation)\s+in\s+progress\b/i,
  // Leading "Stub:" or "Stub." marker — field stubs frequently use this prefix
  // form independent of the "in progress" phrase.
  /^\s*stub\s*[:.]/im,
  /^\s*TODO\s*:/m,
  /^\s*WIP\s*:/m,
  /\(stub\)/i,
  /\bnot yet (?:written|complete|done)\b/i,
];
const STUB_WORD_COUNT_THRESHOLD = 50;

function checkAgentOutput(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, reason: "no path provided" };
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(findProjectRoot(), filePath);
  if (!fs.existsSync(abs)) {
    return {
      ok: false,
      path: filePath,
      looks_like_stub: false,
      reason: `file does not exist: ${filePath}`,
    };
  }
  let content = "";
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch (e) {
    return { ok: false, path: filePath, reason: `read failure: ${e.message}` };
  }
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const stubPhrasesFound = [];
  for (const re of STUB_MARKER_PATTERNS) {
    if (re.test(content)) stubPhrasesFound.push(re.source);
  }
  const nonEmptyLines = content.split("\n").filter((l) => l.trim());
  const allHeadings =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((l) => /^#+\s/.test(l.trim()));
  const looksLikeStub =
    stubPhrasesFound.length > 0 ||
    wordCount < STUB_WORD_COUNT_THRESHOLD ||
    allHeadings;
  const result = {
    ok: !looksLikeStub,
    path: filePath,
    word_count: wordCount,
    stub_phrases_found: stubPhrasesFound,
    heading_only: allHeadings,
    looks_like_stub: looksLikeStub,
  };
  if (looksLikeStub) {
    result.reason =
      `agent output looks like a stub: word_count=${wordCount} ` +
      `(threshold ${STUB_WORD_COUNT_THRESHOLD}), ` +
      `stub_phrases=${stubPhrasesFound.length}, heading_only=${allHeadings}`;
  }
  return result;
}

// Workflow types that dispatch a verifier when config.workflow.verification=true.
// Other workflow types (quick_implement, debug, retro, plan, specify, etc.)
// intentionally skip verification by design — applying the gate uniformly
// produces false-negative blocks. Field signal (greenfield 2026-05-28 PM
// calibration #2, 1c + 6a #2): orchestrator running quick_implement with
// project config.workflow.verification=true hit assert-verifier-ran ok:false
// even though quick_implement has no verifier step. Silent miss that should
// have been a no-op.
const VERIFIER_REQUIRED_WORKFLOWS = new Set([
  "dev",
  "code_review",
  "code_review_parallel",
]);

// Substance gate ensuring the verifier dispatch actually ran when config
// said it should. Field (greenfield 2026-05-27 PR #372): orchestrator with
// config.workflow.verification=true skipped the verifier step entirely,
// rationalizing that "8-lane fan-out is verifier-grade." Nothing in the
// workflow contract enforced the dispatch happening; the conditional skip
// at the top of the verify step was the only check, and orchestrators
// under context pressure rationalize past conditional skips. Same arch
// class as L1: gate-bypass via "I'll skip this one." We expose the
// post-dispatch substance check as a CLI; workflows wire it into
// present_findings.
function assertVerifierRan() {
  // require() at call time to avoid circular deps with config.cjs at module load
  // (same pattern as the validateConsistency path elsewhere in this file).
  const { getMergedConfig } = require("./config.cjs");
  const cfg = getMergedConfig();
  const verificationEnabled =
    cfg && cfg.workflow && cfg.workflow.verification !== false;
  if (!verificationEnabled) {
    return {
      ok: true,
      verification_enabled: false,
      reason: "config.workflow.verification=false — gate does not apply",
    };
  }
  // workflow_type opt-out: only dev / code_review / code_review_parallel
  // dispatch a verifier. Other workflow_types intentionally skip — applying
  // the gate uniformly would block their present_findings step on a missing
  // artifact that was never going to be written.
  let workflowType = null;
  try {
    const stateData = readState();
    workflowType = stateData && stateData.workflow_type;
  } catch { /* fall through — treat as unknown, apply gate */ }
  if (workflowType && !VERIFIER_REQUIRED_WORKFLOWS.has(workflowType)) {
    return {
      ok: true,
      verification_enabled: true,
      workflow_type: workflowType,
      reason: `workflow_type=${workflowType} does not dispatch a verifier by design — gate does not apply`,
    };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const sidecarPath = path.join(dir, "verification.json");
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const mdPath = path.join(dir, "verification.md");
  const haveSidecar = fs.existsSync(sidecarPath);
  const haveMd = fs.existsSync(mdPath);
  if (!haveSidecar && !haveMd) {
    return {
      ok: false,
      verification_enabled: true,
      reason:
        "config.workflow.verification=true but neither verification.json nor verification.md exists — " +
        "verifier was skipped despite being required. Re-dispatch the verifier or set " +
        "config.workflow.verification=false if verification is genuinely not needed for this workflow.",
    };
  }
  const checkPath = haveSidecar ? sidecarPath : mdPath;
  const freshness = isArtifactFresh(checkPath);
  if (!freshness.fresh) {
    return {
      ok: false,
      verification_enabled: true,
      sidecar_present: haveSidecar,
      markdown_present: haveMd,
      reason: `${freshness.reason} — verification artifact may be from a prior workflow; re-run verifier`,
      artifact_mtime: freshness.artifact_mtime,
      workflow_created_at: freshness.workflow_created_at,
      age_seconds: freshness.age_seconds,
    };
  }
  return {
    ok: true,
    verification_enabled: true,
    sidecar_present: haveSidecar,
    markdown_present: haveMd,
  };
}

// Mechanical gate for code-review.md::scope_check. When the scope_check
// bash detects scope > 10 files AND graphify=ready, it writes
// .devt/state/scope-check-required.txt. The next step (identify_scope)
// must verify either:
//   - .devt/state/scope-check-answer.txt exists (orchestrator wrote the
//     AskUserQuestion answer)
//   - OR .devt/state/scope-check-required.txt does NOT exist (condition
//     didn't match; gate doesn't apply)
// Field rationale (greenfield 2026-05-27): orchestrator skipped the
// AskUserQuestion silently with the rationalization "user pre-stated
// parallel intent." Prose gate failed.
function assertScopeCheckHandled() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const requiredPath = path.join(dir, "scope-check-required.txt");
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const answerPath = path.join(dir, "scope-check-answer.txt");
  if (!fs.existsSync(requiredPath)) {
    return { ok: true, reason: "scope-check-required.txt absent — gate does not apply" };
  }
  if (!fs.existsSync(answerPath)) {
    return {
      ok: false,
      reason:
        "scope-check-required.txt exists but scope-check-answer.txt absent — " +
        "orchestrator skipped the AskUserQuestion. Either ask the user " +
        "(parallel vs single-dispatch) and write the answer to " +
        ".devt/state/scope-check-answer.txt, or set autonomous-mode override.",
    };
  }
  const answer = fs.readFileSync(answerPath, "utf8").trim();
  const freshness = isArtifactFresh(answerPath);
  if (!freshness.fresh) {
    return {
      ok: false,
      reason: `${freshness.reason} — scope-check-answer.txt may be from a prior workflow; re-run scope check`,
      artifact_mtime: freshness.artifact_mtime,
      workflow_created_at: freshness.workflow_created_at,
      age_seconds: freshness.age_seconds,
    };
  }
  return { ok: true, answer };
}

// Mechanical gate for code-review-parallel.md::dispatch_lanes. partition_lanes
// is supposed to populate workflow.yaml::lanes[] via state update-lane calls.
// Field rationale (greenfield 2026-05-27): orchestrator skipped lane
// registration entirely; list-lane-outputs returned {"lanes":[]} despite
// 6 lanes being dispatched manually. This gate fails when partition_lanes
// runs but produces zero lane records — forcing the orchestrator to either
// register lanes or fall back to single-dispatch explicitly.
function assertLanesRegistered() {
  const result = listLaneOutputs();
  const laneCount = (result.lanes || []).length;
  if (laneCount === 0) {
    return {
      ok: false,
      reason:
        "workflow.yaml::lanes[] is empty — partition_lanes did not register " +
        "any lanes. Either run state update-lane for each lane in the " +
        "partition, or route to code-review.md single-dispatch fallback.",
      lane_count: 0,
    };
  }
  return { ok: true, lane_count: laneCount };
}

// Mechanical gate for code-review-parallel.md::verify step. The consolidator
// (code-reviewer in synthesis mode) writes .devt/state/consolidator-ran.txt
// as its first action (synthesis-mode handler in agents/code-reviewer.md).
// Field rationale (greenfield 2026-05-27): orchestrator wrote the
// consolidated review.md themselves instead of dispatching the synthesis
// agent. Verifier graded it and the silent skip was invisible. This gate
// fails when ≥1 lane passed substance but no consolidator marker exists.
function assertConsolidatorDispatched() {
  const result = listLaneOutputs();
  const substancePassCount = (result.lanes || []).filter(
    (l) => l.status === "substance_pass",
  ).length;
  if (substancePassCount === 0) {
    return {
      ok: true,
      reason: "no substance_pass lanes — consolidator dispatch not required",
    };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const markerPath = path.join(dir, "consolidator-ran.txt");
  if (!fs.existsSync(markerPath)) {
    return {
      ok: false,
      reason:
        `${substancePassCount} lanes passed substance but consolidator-ran.txt absent — ` +
        "orchestrator skipped synthesis-mode dispatch. Dispatch the code-reviewer " +
        "with synthesis task instruction; the agent body writes the marker.",
      substance_pass_count: substancePassCount,
    };
  }
  const freshness = isArtifactFresh(markerPath);
  if (!freshness.fresh) {
    return {
      ok: false,
      reason: `${freshness.reason} — consolidator-ran.txt may be from a prior workflow; re-dispatch the synthesis agent`,
      substance_pass_count: substancePassCount,
      artifact_mtime: freshness.artifact_mtime,
      workflow_created_at: freshness.workflow_created_at,
      age_seconds: freshness.age_seconds,
    };
  }
  return { ok: true, substance_pass_count: substancePassCount };
}

// Mechanical gate ensuring the auto_curator step was at least considered.
// Field rationale (greenfield 2026-05-27): orchestrator skipped the step
// entirely with "default config has it disabled" rationale, but never
// actually read the config to confirm. This forces a consideration marker
// regardless of the config outcome.
function assertAutoCuratorConsidered() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const markerPath = path.join(dir, "auto-curator-considered.txt");
  if (!fs.existsSync(markerPath)) {
    return {
      ok: false,
      reason:
        "auto-curator-considered.txt absent — orchestrator skipped the " +
        "auto_curator step without reading config. Run the auto_curator bash " +
        "block which writes the marker (SKIP|FIRE|DISABLED status).",
    };
  }
  const status = fs.readFileSync(markerPath, "utf8").trim();
  const freshness = isArtifactFresh(markerPath);
  if (!freshness.fresh) {
    return {
      ok: false,
      reason: `${freshness.reason} — auto-curator-considered.txt may be from a prior workflow; re-run the auto_curator step`,
      artifact_mtime: freshness.artifact_mtime,
      workflow_created_at: freshness.workflow_created_at,
      age_seconds: freshness.age_seconds,
    };
  }
  return { ok: true, auto_curator_status: status };
}

// Mechanical gate: programmer must write .devt/state/reuse-analysis.md
// before code is written. Field rationale: prose-only "scan existing code
// first" gets rationalized past, producing 5-variations-of-same-function.
// Pattern: derive-reuse-candidates writes the candidate list; programmer
// must address each candidate in reuse-analysis.md with a decision.
// NEW-7 (greenfield calibration #5): assert-reuse-analyzed was workflow_type-
// blind, returning ok:false on /devt:review sessions even though review is
// READ-ONLY and never dispatches a programmer. The gate is correct for
// implement-flows (dev / quick_implement) but creates noise for review-only
// flows. Same pattern as VERIFIER_REQUIRED_WORKFLOWS (A9) — declare the
// implement-flow opt-in set, return ok:true for others with a workflow-type
// reason.
const REUSE_REQUIRED_WORKFLOWS = new Set([
  "dev",
  "quick_implement",
]);

function assertReuseAnalyzed() {
  // Workflow-type opt-out: read-only workflows (code_review, debug, research,
  // arch_health_scan, retro, etc.) intentionally don't dispatch a programmer,
  // so the reuse pre-search step is irrelevant. Returning ok:true with a
  // workflow-type reason prevents the gate from blocking present_findings on
  // these flows. Same opt-out pattern as assertVerifierRan (A9).
  let workflowType = null;
  try {
    const stateData = readState();
    workflowType = stateData && stateData.workflow_type;
  } catch { /* fall through — treat as unknown, apply gate */ }
  if (workflowType && !REUSE_REQUIRED_WORKFLOWS.has(workflowType)) {
    return {
      ok: true,
      workflow_type: workflowType,
      reason: `workflow_type=${workflowType} does not dispatch a programmer by design — reuse pre-search gate does not apply`,
    };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const markerPath = path.join(dir, "reuse-search-attempted.txt");
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const candidatesPath = path.join(dir, "reuse-candidates.md");
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const analysisPath = path.join(dir, "reuse-analysis.md");

  // Three-state gate. Marker presence distinguishes the legitimate "ran with
  // zero candidates" pass from the silent "workflow bash skipped the step"
  // failure. Greenfield calibration #2: assert-reuse-analyzed returned
  // ok:true under the old escape clause when reuse-candidates.md was simply
  // absent, blessing a session where the entire pre-search step never ran.
  // The marker is written BEFORE the derive-reuse-candidates CLI invocation
  // by the workflow bash, so its presence is the canonical "orchestrator
  // attempted the step" signal.
  if (!fs.existsSync(markerPath)) {
    return {
      ok: false,
      reason:
        "reuse-search-attempted.txt absent — workflow skipped the reuse pre-search step entirely. " +
        "Orchestrator must run the reuse-search bash block (write the marker, then `state derive-reuse-candidates \"<task>\"`) before dispatching the programmer.",
    };
  }

  if (!fs.existsSync(candidatesPath)) {
    return {
      ok: false,
      marker_present: true,
      reason:
        "reuse-search-attempted.txt present but reuse-candidates.md absent — the derive-reuse-candidates CLI was invoked but failed to write the candidates file. " +
        "Check the result= line in the marker file for failure context (graphify down, CLI exception, etc.).",
    };
  }

  const candidatesContent = fs.readFileSync(candidatesPath, "utf8");
  // Extract candidate labels from ### `<label>` at... headings.
  const labelMatches = candidatesContent.matchAll(/^###\s+`([^`]+)`/gm);
  const candidateLabels = Array.from(labelMatches, (m) => m[1]);

  if (candidateLabels.length === 0) {
    return {
      ok: true,
      reason: "reuse-candidates.md has zero candidates — nothing to analyze",
      candidates_to_analyze: 0,
    };
  }

  if (!fs.existsSync(analysisPath)) {
    return {
      ok: false,
      reason:
        `reuse-candidates.md lists ${candidateLabels.length} candidate(s) but reuse-analysis.md absent — ` +
        "programmer must write per-candidate decisions (REUSED | EXTENDED | REJECTED) before writing new code.",
      candidates_to_analyze: candidateLabels.length,
    };
  }

  const analysisContent = fs.readFileSync(analysisPath, "utf8");
  const missing = candidateLabels.filter(
    (label) => !analysisContent.includes(label),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `reuse-analysis.md exists but does not address ${missing.length} candidate(s): ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""} — programmer must include a decision for every candidate.`,
      candidates_to_analyze: candidateLabels.length,
      candidates_missing: missing,
    };
  }

  const freshness = isArtifactFresh(analysisPath);
  if (!freshness.fresh) {
    return {
      ok: false,
      reason: `${freshness.reason} — reuse-analysis.md may be from a prior workflow; re-run reuse analysis`,
      candidates_to_analyze: candidateLabels.length,
      artifact_mtime: freshness.artifact_mtime,
      workflow_created_at: freshness.workflow_created_at,
      age_seconds: freshness.age_seconds,
    };
  }
  return {
    ok: true,
    candidates_to_analyze: candidateLabels.length,
    candidates_addressed: candidateLabels.length,
  };
}

// B-II.3 — verify the orchestrator either surfaced #KNOWLEDGE-CANDIDATE tags
// in scratchpad.md (canonical capture path → harvester → curator) OR declared
// none explicitly via knowledge-candidates-none.txt with a structured reason.
//
// Greenfield calibration #2 finding 6a#1+6e: the agent prose at
// workflows/quick-implement.md said "load-bearing — not optional" but no
// assert-* enforced it. Result: 4 candidates described in review.md prose
// but ZERO #KNOWLEDGE-CANDIDATE lines in scratchpad. The candidates never
// reached the curator harvester. Hard miss.
//
// The structured none-declaration is the deliberate escape hatch — pure CRUD
// tasks, conventional-pattern implementations, or topics already covered by
// existing memory don't always produce novel candidates. The valid-reason
// enum forces the orchestrator to commit to a category rather than skipping
// silently.
function assertKnowledgeCandidatesTagged() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const scratchpadPath = path.join(dir, "scratchpad.md");
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const nonePath = path.join(dir, "knowledge-candidates-none.txt");

  if (fs.existsSync(nonePath)) {
    const content = fs.readFileSync(nonePath, "utf8");
    const reasonMatch = content.match(/^reason=([a-z_]+)$/m);
    const validReasons = new Set([
      "task_too_routine", "no_novel_patterns", "all_subsumed_by_existing_memory",
    ]);
    if (!reasonMatch || !validReasons.has(reasonMatch[1])) {
      return {
        ok: false,
        reason:
          "knowledge-candidates-none.txt missing valid reason= line. Required format: " +
          "reason=<task_too_routine|no_novel_patterns|all_subsumed_by_existing_memory>.",
      };
    }
    const freshness = isArtifactFresh(nonePath);
    if (!freshness.fresh) {
      return {
        ok: false,
        reason: `${freshness.reason} — knowledge-candidates-none.txt may be from a prior workflow; re-evaluate for this run`,
        artifact_mtime: freshness.artifact_mtime,
        workflow_created_at: freshness.workflow_created_at,
        age_seconds: freshness.age_seconds,
      };
    }
    return { ok: true, none_declared: true, skip_reason: reasonMatch[1] };
  }

  if (!fs.existsSync(scratchpadPath)) {
    return {
      ok: false,
      reason:
        "scratchpad.md absent AND knowledge-candidates-none.txt absent — orchestrator must either tag candidates during work " +
        "(append `#KNOWLEDGE-CANDIDATE: [type=...] <summary>` lines to scratchpad.md) or declare none with a structured reason " +
        "(write `reason=<task_too_routine|no_novel_patterns|all_subsumed_by_existing_memory>` to knowledge-candidates-none.txt).",
    };
  }
  const content = fs.readFileSync(scratchpadPath, "utf8");
  const tags = (content.match(/^#KNOWLEDGE-CANDIDATE:/gm) || []).length;
  if (tags === 0) {
    return {
      ok: false,
      tag_count: 0,
      reason:
        "scratchpad.md present but contains 0 #KNOWLEDGE-CANDIDATE lines. " +
        "Orchestrator must either tag candidates during work or write knowledge-candidates-none.txt with a structured reason.",
    };
  }
  // Q5 — session-scope check via first_created_at. Tags only count when the
  // scratchpad was touched DURING this workflow session. If scratchpad mtime
  // predates first_created_at (immutable session anchor), the tags are from
  // a prior workflow whose teardown didn't reset scratchpad cleanly — the
  // gate must fail so this session's candidates aren't silently shadowed.
  const freshness = isArtifactFresh(scratchpadPath);
  if (!freshness.fresh) {
    return {
      ok: false,
      tag_count: tags,
      reason: `${freshness.reason} — scratchpad.md #KNOWLEDGE-CANDIDATE lines are from a prior workflow; this session must tag its own candidates or declare none via knowledge-candidates-none.txt`,
      artifact_mtime: freshness.artifact_mtime,
      workflow_created_at: freshness.workflow_created_at,
      age_seconds: freshness.age_seconds,
    };
  }
  return { ok: true, tag_count: tags };
}

// B-II.4 — aggregate #KNOWLEDGE-CANDIDATE lines from review-lane-*.md and
// review.md into scratchpad.md so the canonical capture path (scratchpad →
// harvester → curator) sees parallel-lane tags. Without this, parallel
// reviews dispatched via code-review-parallel write candidates to lane
// output files (per agent body instructions for the lane agent), and the
// assert-knowledge-candidates-tagged gate would false-block because
// scratchpad stays empty even when 8 lanes each tagged 3 candidates.
//
// Dedup is by line content (after the `#KNOWLEDGE-CANDIDATE:` prefix) — two
// lanes might surface the same architectural rule, and the downstream
// harvester does its own dedup, but writing the same line twice into
// scratchpad pollutes the audit trail.
// G4 (greenfield calibration #8): the structural side of preflight has
// observable decision artifacts (graphify-skip-reason.txt, staleness lag);
// the semantic side did not, so an orchestrator could read scope_hint
// without knowing whether the underlying symbols were trustworthy. This
// gate surfaces the extraction confidence numerically. Returns
// `ok: true` always — the gate WARNS, it does not block (per the
// "no defensive limits for low-risk scenarios" rule; semantic quality is
// signal, not safety). Default warn threshold 0.4 (configurable via
// --threshold flag). Confidence < threshold → `warn: true` with a
// prescriptive reason citing the band.
function assertPreflightSemanticQuality(args) {
  let threshold = 0.4;
  if (Array.isArray(args)) {
    const flagIdx = args.findIndex(a => a === "--threshold" || a.startsWith("--threshold="));
    if (flagIdx >= 0) {
      const raw = args[flagIdx].includes("=") ? args[flagIdx].split("=")[1] : args[flagIdx + 1];
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) threshold = parsed;
    }
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const sidecarPath = path.join(dir, "preflight-brief.json");
  if (!fs.existsSync(sidecarPath)) {
    return {
      ok: true,
      warn: false,
      reason: "preflight-brief.json absent — run /devt:preflight or wait for the auto-fire at context_init before asserting semantic quality",
    };
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(sidecarPath, "utf8")); }
  catch (e) { return { ok: true, warn: false, reason: `preflight-brief.json unparseable: ${e.message}` }; }
  const conf = parsed && parsed.topic && parsed.topic.extraction_confidence;
  if (!conf || typeof conf.score !== "number") {
    return {
      ok: true,
      warn: false,
      reason: "preflight-brief.json predates the extraction_confidence field — regenerate via /devt:preflight to surface semantic quality",
    };
  }
  if (conf.score < threshold) {
    return {
      ok: true,
      warn: true,
      confidence: conf,
      threshold,
      reason: `topic extraction confidence ${conf.score} (${conf.band}) below threshold ${threshold} — ${conf.reason}. Refine task text with the central subject (e.g. snake_case identifier or PascalCase class), then re-run /devt:preflight. Downstream scope_hint may be noise.`,
    };
  }
  return {
    ok: true,
    warn: false,
    confidence: conf,
    threshold,
    reason: `topic extraction confidence ${conf.score} (${conf.band}) above threshold`,
  };
}

function aggregateKnowledgeCandidates() {
  const dir = getStateDir();
  let sources;
  try {
    sources = fs.readdirSync(dir)
      .filter(f =>
        /^review-lane-[A-Za-z0-9_.-]+\.md$/.test(f) ||
        f === "review.md" ||
        // Programmers writing #KNOWLEDGE-CANDIDATE tags in impl-summary*.md
        // would otherwise be stranded — the aggregator only scanned review
        // outputs, leaving valid candidates invisible to the gate (field
        // signal: greenfield 2026-05-29 calibration #8, quick_implement
        // workflow producing 3 tags in impl-summary.md with zero reaching
        // scratchpad.md).
        /^impl-summary(?:-[A-Za-z0-9_.-]+)?\.md$/.test(f)
      );
  } catch {
    return { ok: false, reason: "state_dir_unreadable", aggregated: 0 };
  }
  if (sources.length === 0) {
    return { ok: true, sources_scanned: 0, aggregated: 0, reason: "no review-lane-*.md, review.md, or impl-summary*.md present" };
  }
  // Map content → first source file that surfaced it; preserves provenance
  // even when several lanes propose the same candidate (only the first
  // attribution lands in scratchpad).
  const byContent = new Map();
  let totalLines = 0;
  for (const file of sources) {
    let content;
    try { content = fs.readFileSync(path.join(dir, file), "utf8"); } catch { continue; }
    const matches = content.match(/^#KNOWLEDGE-CANDIDATE:.*$/gm) || [];
    for (const line of matches) {
      totalLines++;
      const body = line.replace(/^#KNOWLEDGE-CANDIDATE:\s*/, "").trim();
      if (!byContent.has(body)) byContent.set(body, file);
    }
  }
  if (byContent.size === 0) {
    return { ok: true, sources_scanned: sources.length, aggregated: 0, total_seen: totalLines, reason: "no #KNOWLEDGE-CANDIDATE lines in lane outputs" };
  }
  // Determine which entries scratchpad already carries (so re-runs don't
  // duplicate). Compare full line content rather than just bodies — the
  // harvester uses the exact prefixed form.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const scratchpadPath = path.join(dir, "scratchpad.md");
  let existing = "";
  if (fs.existsSync(scratchpadPath)) {
    try { existing = fs.readFileSync(scratchpadPath, "utf8"); } catch { existing = ""; }
  }
  const toAppend = [];
  let skipped = 0;
  for (const [body, source] of byContent) {
    const line = `#KNOWLEDGE-CANDIDATE: ${body}`;
    if (existing.includes(line)) { skipped++; continue; }
    toAppend.push(`<!-- aggregated from ${source} -->\n${line}`);
  }
  if (toAppend.length === 0) {
    return { ok: true, sources_scanned: sources.length, aggregated: 0, total_seen: totalLines, deduped_seen: byContent.size, skipped_already_present: skipped };
  }
  const header = existing.endsWith("\n") || existing === "" ? "" : "\n";
  const block = `${header}\n## Aggregated Knowledge Candidates (from parallel lanes)\n\n${toAppend.join("\n")}\n`;
  try { fs.appendFileSync(scratchpadPath, block, "utf8"); }
  catch (e) { return { ok: false, reason: `scratchpad write failed: ${e.message}`, aggregated: 0 }; }
  return {
    ok: true,
    sources_scanned: sources.length,
    aggregated: toAppend.length,
    total_seen: totalLines,
    deduped_seen: byContent.size,
    skipped_already_present: skipped,
  };
}

// Surfaces the canonical lane registry from workflow.yaml::lanes[] alongside
// each lane's review file existence + size. Consumed by code-review-parallel.md's
// substance_check_lanes + consolidate steps. Returns empty lanes:[] when no
// parallel workflow is active (lanes key missing from workflow.yaml).
function listLaneOutputs() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const wfPath = path.join(dir, "workflow.yaml");
  if (!fs.existsSync(wfPath)) {
    return { lanes: [], reason: "no workflow.yaml" };
  }
  const yaml = fs.readFileSync(wfPath, "utf8");
  // first_created_at lets each lane report stale=true when its review_file
  // predates the current session anchor — calibration #8 surfaced lanes
  // registered in a prior workflow whose physical files were long gone
  // (file_exists:false) but whose metadata still satisfied consumers.
  const anchorMatch = yaml.match(/^first_created_at:\s*"?([^"\n]+)"?\s*$/m);
  let anchorMs = 0;
  if (anchorMatch) {
    const parsed = new Date(anchorMatch[1].trim()).getTime();
    if (Number.isFinite(parsed)) anchorMs = parsed;
  }
  // Light YAML parse: the lanes[] block uses a fixed shape; we extract via
  // line-based parsing to avoid pulling in a YAML library (zero-deps rule).
  const lanes = [];
  const blocks = yaml.split(/^  - id:/m).slice(1);
  for (const block of blocks) {
    const id = (block.match(/^\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const community = (block.match(/^\s+community:\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const reviewFile = (block.match(/^\s+review_file:\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const status = (block.match(/^\s+status:\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const redispatchCount = parseInt(
      (block.match(/^\s+redispatch_count:\s*(\d+)\s*$/m) || [])[1] || "0", 10);
    // B-VIII oversized-lane sizing — file_count / est_loc / oversized are
    // optional fields written by code-review-parallel.md::partition_lanes.
    // Absent when the lane was registered manually (pre-B-VIII workflows) or
    // when the fields were stripped during a manual workflow.yaml edit.
    const fileCount = parseInt(
      (block.match(/^\s+file_count:\s*(\d+)\s*$/m) || [])[1] || "0", 10);
    const estLoc = parseInt(
      (block.match(/^\s+est_loc:\s*(\d+)\s*$/m) || [])[1] || "0", 10);
    const oversizedRaw = (block.match(/^\s+oversized:\s*(true|false)\s*$/m) || [])[1];
    const oversized = oversizedRaw === "true";
    if (!id) continue;
    let sizeBytes = 0;
    let exists = false;
    let mtimeMs = 0;
    if (reviewFile) {
      try {
        const stat = fs.statSync(reviewFile);
        sizeBytes = stat.size;
        mtimeMs = stat.mtimeMs;
        exists = true;
      } catch { /* file absent — leave defaults */ }
    }
    // stale when the on-disk file is older than this session's anchor;
    // absent files cannot be classified (no mtime) so they stay stale=false
    // even though file_exists:false — consumers should treat absence as its
    // own signal.
    const stale = exists && anchorMs > 0 && mtimeMs < anchorMs;
    lanes.push({
      id: id ? id.trim() : null,
      community: community ? community.trim() : null,
      review_file: reviewFile ? reviewFile.trim() : null,
      status: status ? status.trim() : null,
      redispatch_count: redispatchCount,
      file_count: fileCount,
      est_loc: estLoc,
      oversized,
      file_exists: exists,
      file_size_bytes: sizeBytes,
      stale,
    });
  }
  return { lanes };
}

function updateLane(laneId, kvPairs) {
  if (!laneId || typeof laneId !== "string") {
    return { ok: false, reason: "no lane-id provided" };
  }
  const updates = {};
  for (const kv of (kvPairs || [])) {
    const [k, v] = kv.split("=", 2);
    if (!k || v === undefined) continue;
    if (k === "status") {
      if (!VALID_LANE_STATUSES.has(v)) {
        return { ok: false, reason: `invalid status "${v}" (allowed: ${[...VALID_LANE_STATUSES].join(", ")})` };
      }
      updates.status = v;
    } else if (k === "redispatch_count") {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0) {
        return { ok: false, reason: `invalid redispatch_count "${v}" (must be non-negative integer)` };
      }
      updates.redispatch_count = n;
    } else {
      return { ok: false, reason: `unknown lane field "${k}" (allowed: status, redispatch_count)` };
    }
  }
  if (Object.keys(updates).length === 0) {
    return { ok: false, reason: "no updates provided (need status=... or redispatch_count=...)" };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const wfPath = path.join(dir, "workflow.yaml");
  if (!fs.existsSync(wfPath)) {
    return { ok: false, reason: "no workflow.yaml" };
  }
  const yaml = fs.readFileSync(wfPath, "utf8");
  // Locate the lane block by id, then mutate the status/redispatch_count
  // lines in-place. Conservative line-based edit preserves YAML formatting.
  const lines = yaml.split("\n");
  let inLane = false;
  let mutated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^  - id:\s*"?/.test(line)) {
      inLane = line.includes(`"${laneId}"`) || line.replace(/^  - id:\s*"?/, "").replace(/"\s*$/, "").trim() === laneId;
    } else if (/^[a-z_]/.test(line)) {
      inLane = false;
    }
    if (!inLane) continue;
    if (updates.status !== undefined && /^\s+status:\s*/.test(line)) {
      lines[i] = line.replace(/status:\s*"?[^"\n]*"?/, `status: "${updates.status}"`);
      mutated = true;
    }
    if (updates.redispatch_count !== undefined && /^\s+redispatch_count:\s*/.test(line)) {
      lines[i] = line.replace(/redispatch_count:\s*\d+/, `redispatch_count: ${updates.redispatch_count}`);
      mutated = true;
    }
  }
  if (!mutated) {
    return { ok: false, reason: `lane id "${laneId}" not found in workflow.yaml::lanes[]` };
  }
  atomicWriteFileSync(wfPath, lines.join("\n"));
  return { ok: true, lane_id: laneId, updates };
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
    // HF-1: prefer immutable first_created_at over mutable created_at.
    // Greenfield calibration #7: state update workflow_type=... rotates
    // created_at, retroactively invalidating preflight-brief.json written
    // BEFORE the transition. first_created_at anchors session start and
    // never rotates. Backward-compat fallback for legacy workflow.yaml.
    const mFirst = content.match(/^first_created_at:\s*"?([^"\n]+)"?\s*$/m);
    const mLegacy = content.match(/^created_at:\s*"?([^"\n]+)"?\s*$/m);
    const m = mFirst || mLegacy;
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
  const checkPath = haveHarvest ? harvestPath : skippedPath;
  const freshness = isArtifactFresh(checkPath);
  if (!freshness.fresh) {
    return {
      ok: false,
      file: haveHarvest ? "claude-mem-harvest.md" : "claude-mem-skipped.txt",
      reason: `${freshness.reason} — claude-mem artifact may be from a prior workflow; re-run the claude-mem pre-step in context_init`,
      artifact_mtime: freshness.artifact_mtime,
      workflow_created_at: freshness.workflow_created_at,
      age_seconds: freshness.age_seconds,
    };
  }
  if (haveSkipped) {
    // Structured payload requirement. Greenfield calibration #2 finding 6b#3:
    // a one-line skip reason satisfied the gate but produced no value. The
    // valid-reason enum forces the orchestrator to commit to a concrete
    // reason category that downstream observability can aggregate over.
    // task_unrelated_to_history additionally requires a details= line so
    // the deliberate override leaves an audit trail rather than a bare
    // assertion.
    const skipContent = fs.readFileSync(skippedPath, "utf8");
    const reasonMatch = skipContent.match(/^reason=([a-z_]+)$/m);
    const validReasons = new Set([
      "not_installed", "mcp_unavailable", "corpus_empty", "task_unrelated_to_history",
    ]);
    if (!reasonMatch || !validReasons.has(reasonMatch[1])) {
      return {
        ok: false,
        file: "claude-mem-skipped.txt",
        reason:
          "claude-mem-skipped.txt missing valid reason= line. Required format: " +
          "reason=<not_installed|mcp_unavailable|corpus_empty|task_unrelated_to_history>. " +
          "For task_unrelated_to_history, also include details=<explanation>.",
      };
    }
    if (reasonMatch[1] === "task_unrelated_to_history" && !/^details=/m.test(skipContent)) {
      return {
        ok: false,
        file: "claude-mem-skipped.txt",
        reason: "reason=task_unrelated_to_history requires a details= line explaining the orchestrator's reasoning.",
      };
    }
    return {
      ok: true,
      file: "claude-mem-skipped.txt",
      skip_reason: reasonMatch[1],
    };
  }
  return {
    ok: true,
    file: "claude-mem-harvest.md",
  };
}

// F10 — list archived workflows by walking .devt/state/.archive/<ts>/ snapshots.
// Each archive snapshot may contain a workflow.yaml whose `task` field carries the
// human-readable description. Returns most-recent first. Caps at `limit` (default 20)
// to keep the output scannable. Snapshots missing workflow.yaml are silently skipped.
function stateHistory(limit) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const archiveDir = path.join(dir, ARCHIVE_DIR);
  if (!fs.existsSync(archiveDir)) return [];
  let snapshots;
  try {
    snapshots = fs.readdirSync(archiveDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
      .reverse();
  } catch { return []; }
  const out = [];
  for (const ts of snapshots) {
    if (out.length >= cap) break;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const wfPath = path.join(archiveDir, ts, "workflow.yaml");
    if (!fs.existsSync(wfPath)) continue;
    try {
      const parsed = parseSimpleYaml(fs.readFileSync(wfPath, "utf8"));
      out.push({
        timestamp: ts,
        workflow_type: parsed.workflow_type || null,
        workflow_id: parsed.workflow_id || null,
        task: parsed.task || null,
        phase: parsed.phase || null,
        status: parsed.status || null,
      });
    } catch { /* unreadable workflow.yaml — skip */ }
  }
  return out;
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
    case "release":
      return releaseWorkflow();
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
    case "evict-workflow-artifacts": {
      const audit = require("./state-audit.cjs");
      const opts = { dryRun: args.includes("--dry-run") };
      return audit.evictWorkflowArtifacts(opts);
    }
    case "assert-graphify-decision":
      return assertGraphifyDecision();
    case "assert-preflight-fresh":
      return assertPreflightFresh();
    case "assert-claude-mem-harvest":
      return assertClaudeMemHarvest();
    case "check-agent-output":
      return checkAgentOutput(args[0]);
    case "assert-verifier-ran":
      return assertVerifierRan();
    case "assert-scope-check-handled":
      return assertScopeCheckHandled();
    case "assert-lanes-registered":
      return assertLanesRegistered();
    case "assert-consolidator-dispatched":
      return assertConsolidatorDispatched();
    case "assert-auto-curator-considered":
      return assertAutoCuratorConsidered();
    case "assert-reuse-analyzed":
      return assertReuseAnalyzed();
    case "assert-knowledge-candidates-tagged":
      return assertKnowledgeCandidatesTagged();
    case "assert-preflight-semantic-quality":
      return assertPreflightSemanticQuality(args);
    case "aggregate-knowledge-candidates":
      return aggregateKnowledgeCandidates();
    case "derive-reuse-candidates":
      return require("./reuse-search.cjs").deriveReuseCandidates(args.join(" "));
    case "list-lane-outputs":
      return listLaneOutputs();
    case "update-lane":
      return updateLane(args[0], args.slice(1));
    case "history": {
      const limitArg = _getFlag(args, "--limit");
      const lim = limitArg ? parseInt(limitArg, 10) : 20;
      return stateHistory(lim);
    }
    default:
      throw new Error(
        `Unknown state subcommand: ${subcommand}. Use: read, read-section, read-sidecar, truncate-artifact, update, reset, release, validate, sync, prune, audit, cleanup, evict-graphify, evict-workflow-artifacts, assert-graphify-decision, assert-preflight-fresh, assert-claude-mem-harvest, check-agent-output, assert-verifier-ran, assert-scope-check-handled, assert-lanes-registered, assert-consolidator-dispatched, assert-auto-curator-considered, assert-reuse-analyzed, assert-knowledge-candidates-tagged, assert-preflight-semantic-quality, aggregate-knowledge-candidates, derive-reuse-candidates, list-lane-outputs, update-lane, history`,
      );
  }
}

module.exports = {
  run,
  parseSimpleYaml,
  serializeSimpleYaml,
  readState,
  readSection,
  readSidecar,
  truncateArtifact,
  updateState,
  resetState,
  releaseWorkflow,
  syncState,
  pruneState,
  checkWorkflowLock,
  validateConsistency,
  assertGraphifyDecision,
  assertPreflightFresh,
  assertClaudeMemHarvest,
  checkAgentOutput,
  assertVerifierRan,
  assertScopeCheckHandled,
  assertLanesRegistered,
  assertConsolidatorDispatched,
  assertAutoCuratorConsidered,
  assertReuseAnalyzed,
  assertKnowledgeCandidatesTagged,
  aggregateKnowledgeCandidates,
  listLaneOutputs,
  updateLane,
  stateHistory,
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
  VALID_LANE_STATUSES,
  slugifyLaneName,
  isArtifactFresh,
  ARTIFACT_FRESHNESS_GRACE_MS,
};
