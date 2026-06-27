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
const { atomicWriteFileSync, atomicWriteJsonSync } = require("./io.cjs");

const STATE_DIR = path.join(".devt", "state");
const WORKFLOW_FILE = "workflow.yaml";
const LOCK_TIMEOUT_MS = 3000;
const LOCK_RETRY_MS = 50;

// Multi-instance state isolation.
//
// When `DEVT_WORKFLOW_ID` is set in the environment, getStateDir() returns
// a per-instance subdirectory at `<projectRoot>/.devt/state/<DEVT_WORKFLOW_ID>/`.
// Otherwise it returns the legacy `<projectRoot>/.devt/state/` path. This is
// fully backwards-compatible: existing users who don't set the env var see
// no behavior change.
//
// Rationale: multiple devt sessions on the same project would collide on
// flat-named artifacts (decisions.md, plan.md, impl-summary.md, etc.). Each
// terminal exports `DEVT_WORKFLOW_ID=$(devt-tools state new-instance)` to
// scope its writes to a dedicated subdirectory.
//
// Cross-instance files (deferred.md, council transcripts, last-curator-run.txt,
// probe-failures.jsonl, .graphify-rebuild.lock, .archive/, .instances/) use
// getStateRoot() instead — they're project-wide by design.
//
// The DEVT_WORKFLOW_ID is also validated for path-traversal safety: only
// hex/alphanumeric/hyphen IDs are honored; anything else falls back to the
// legacy root path with a stderr warning. This prevents an attacker-controlled
// env var from escaping the project state directory.
const _INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
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
  // array via the JSON-encode path; typeof [] is "object" for schema validation.
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
  // Terminal phase set by `state release` for workflows abandoned mid-flight.
  // Why explicit: ad-hoc `state update active=false phase=cancelled` would
  // otherwise trip the VALID_PHASES warning. Distinct from "complete" (normal
  // terminal) and "finalize" (last-step-before-complete).
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

// Tier ordering for deterministic floor enforcement. Matches the
// workflows/dev-workflow.md::Quick Classification Heuristic table (TRIVIAL≤3
// files; SIMPLE≤2 files; COMPLEX≥10 files). updateState() consults this to
// auto-elevate when the agent-judged tier falls below the file-count floor.
// Why floor enforcement: detectTier() in init.cjs uses task-text only and is
// never re-evaluated against the actual scope list, so a 180-file review can
// be seeded SIMPLE. Floor enforcement closes the loop regardless of caller.
const TIER_RANK = { TRIVIAL: 0, SIMPLE: 1, STANDARD: 2, COMPLEX: 3 };

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
const VERIFICATION_STATUSES = ["VERIFIED", "GAPS_FOUND", "FAILED", "DONE_WITH_CONCERNS", "PARTIAL"];
const VERIFICATION_VERDICTS = ["satisfied", "needs_revision", "failed"];

const JSON_SIDECAR_SCHEMAS = {
  "impl-summary.json": {
    // Why PARTIAL exists: work-doer subagents that hit the per-dispatch tool
    // budget mid-task signal incomplete work via Status: PARTIAL + a Next-section
    // marker. Workflow runners route PARTIAL to SendMessage-resume instead of
    // advancing phase=DONE.
    status: ["DONE", "DONE_WITH_CONCERNS", "PARTIAL", "BLOCKED", "NEEDS_CONTEXT"],
    verdict: ["PASS", "FAIL", "INDETERMINATE"],
    agent: ["programmer"],
  },
  "test-summary.json": {
    status: ["DONE", "DONE_WITH_CONCERNS", "PARTIAL", "BLOCKED", "NEEDS_CONTEXT"],
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
    status: ["DONE", "PARTIAL", "BLOCKED"],
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
  "arch-baseline.json", "arch-triage.json", "arch-scan-report.md", "scanner-output.txt", "scan-delta.md",
];

const VALID_WORKFLOW_TYPES = new Set([
  "dev", "quick_implement", "debug", "retro", "code_review", "code_review_parallel", "arch_health_scan",
  "research", "plan", "specify", "clarify",
  // Memory layer workflow types — see workflows/memory-*.md.
  // memory_promote: curator promotes ephemeral DEC -> permanent ADR.
  // memory_reject: curator creates a REJ tombstone with search_keywords.
  // preflight: standalone Topic Pre-Flight Brief generation.
  // docs: standalone documentation refresh — see workflows/docs-extraction.md.
  // (memory_init / memory_index are CLI-only subcommands — they don't set state and aren't workflow_types.)
  "memory_promote", "memory_reject", "preflight", "docs",
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

// Workflow-id rotation audit log. Receipt #9 evidence: 8 parallel subagents
// rotated workflow_id mid-run (1f871314 → f67240bb) with no audit trail —
// receipt user could only narrow to "lifecycle surface, not status" at 70%
// confidence because no record exists of "who rotated, when, via which CLI."
// Every mutation site now appends a JSONL line so post-hoc forensics can
// pinpoint the source. RESET_EXEMPT — survives resetSoft (that's the whole
// point: rotations BY resetSoft are themselves the events being audited).
// Append-only + best-effort: any I/O failure is swallowed (audit logging
// must NEVER prevent the underlying mutation from succeeding).
function _logWorkflowIdRotation({ prev_id, new_id, source }) {
  if (!new_id || prev_id === new_id) return; // no-rotation case (idempotent updates)
  try {
    const dir = getStateDir();
    if (!fs.existsSync(dir)) return;
    const logPath = path.join(dir, "workflow-id-rotations.jsonl");
    const entry = {
      ts: new Date().toISOString(),
      prev_id: prev_id || null,
      new_id,
      source,
      pid: process.pid,
      argv: (process.argv || []).slice(1, 6).join(" "), // cap argv to avoid blowing line size
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch { /* audit best-effort */ }
}

function updateState(keyValues, opts = {}) {
  ensureStateDir();
  // Detect phase=X status=DONE update intent BEFORE acquiring the lock.
  // Gates fire OUTSIDE the lock to avoid recursive lock attempts from any
  // future gate that calls readState/updateState. Why update-time gating:
  // shipped workflows call `state update phase=X status=DONE` ~99x for every
  // ~7 calls to `advance-phase`, so update-time gates catch the vast majority
  // of phase transitions. opts.skipGates is set by advanceState (gates already
  // ran there) and by --skip-gates CLI flag (explicit opt-out for ad-hoc
  // callers that don't want the enforcement layer).
  const skipGates = !!opts.skipGates;
  let phaseGateRun = null;
  if (!skipGates && Array.isArray(keyValues)) {
    const phaseKv = keyValues.find(k => typeof k === "string" && k.startsWith("phase="));
    const statusKv = keyValues.find(k => typeof k === "string" && k.startsWith("status="));
    if (phaseKv && statusKv) {
      const stripQuotes = (s) => (s.startsWith('"') && s.endsWith('"')) ? s.slice(1, -1) : s;
      const targetPhase = stripQuotes(phaseKv.slice("phase=".length));
      const statusVal = stripQuotes(statusKv.slice("status=".length));
      if (targetPhase && statusVal === "DONE") {
        // Resolve workflow_type from current state — could be set BY this
        // update (workflow_type=X in same call) so check keyValues too.
        let workflowType = null;
        const wfTypeKv = keyValues.find(k => typeof k === "string" && k.startsWith("workflow_type="));
        if (wfTypeKv) {
          workflowType = stripQuotes(wfTypeKv.slice("workflow_type=".length));
        } else {
          try {
            const snap = readState();
            workflowType = snap && snap.workflow_type;
          } catch { /* leave null — runPhaseGates handles it */ }
        }
        try {
          phaseGateRun = runPhaseGates(workflowType, targetPhase, { tracePrefix: "state-update" });
        } catch (e) {
          // Registry load failures propagate — preserves advanceState semantics.
          throw e;
        }
        if (phaseGateRun.fired && phaseGateRun.blockedBy.length > 0) {
          // Refuse the write. State stays at IN_PROGRESS (or whatever its
          // current status is). Reason includes alternative-command guidance
          // when applicable so the orchestrator has a recovery path.
          const altHints = phaseGateRun.blockedBy
            .map(b => {
              if (/raw_dispatch/i.test(b.reason)) {
                return `  → try: state register-lanes --from=<lanes.yaml> && dispatch render-lanes (canonical parallel-lane path)`;
              }
              if (/knowledge.candidate/i.test(b.reason)) {
                return `  → try: state aggregate-knowledge-candidates`;
              }
              return null;
            })
            .filter(Boolean);
          throw new Error(
            `[devt state update] ${phaseGateRun.blockedBy.length} gate(s) blocked transition to ${workflowType}.${targetPhase}:\n` +
            phaseGateRun.blockedBy.map(b => `  - ${b.gate}: ${b.reason}`).join("\n") +
            (altHints.length ? `\n${altHints.join("\n")}` : "") +
            `\n  → opt out: pass --skip-gates if this bypass is intentional (loud flag for audit).`
          );
        }
      }
    }
  }
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
    // Snapshot active state BEFORE the update loop so the deactivation gate
    // (after the loop, before write) can detect the true→false transition.
    // Why hooked at updateState: CLI-driven orchestrators that flip
    // `active=false` via direct `state update active=false ...` bypass the
    // workflow .md finalize step where the gate originally lived. Hooking
    // the gate here closes that escape hatch regardless of caller.
    // releaseWorkflow() routes through this same updateState call (L1403),
    // so `state release` is covered automatically.
    const wasActive = current.active === true;
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
    // Round 7 W5 — deterministic tier-floor enforcement. Runs after every
    // merge (not gated on `tier` being in keyValues) because scope-files can
    // grow AFTER tier is seeded — e.g. init.cjs:536 seeds tier via detectTier
    // (task-text only) long before code-review.md::identify_scope writes
    // 180 paths. Any subsequent state update re-evaluates and elevates as
    // needed. No-op when scope-list absent (dev-workflow pre-scope_check).
    if (current.tier && VALID_TIERS.has(current.tier)) {
      const floor = computeTierFloor();
      if (floor && TIER_RANK[current.tier] < TIER_RANK[floor]) {
        const count = getScopeFileCount();
        warnState(
          `tier="${current.tier}" elevated to "${floor}" by deterministic floor ` +
          `(${count} files in .devt/state/code-review-input.md; ` +
          `workflows/dev-workflow.md:399 heuristic)`
        );
        current.tier = floor;
      }
    }
    // Auto-stamp session metadata on first activation. Idempotent — subsequent updates
    // preserve the stamp; resetState() clears workflow.yaml, so the next active=true
    // re-stamps. Anchors the stuck-detector to a precise session boundary.
    //
    // Two fields are immutable for the lifetime of the workflow:
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
      const prevId = current.workflow_id || null;
      current.workflow_id = current.workflow_id || require("crypto").randomUUID();
      _logWorkflowIdRotation({ prev_id: prevId, new_id: current.workflow_id, source: "updateState:first_activation" });
      // Freeze the immutable anchors on first activation only.
      if (!current.first_created_at) current.first_created_at = now;
      if (!current.original_workflow_id) current.original_workflow_id = current.workflow_id;
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
      const prevId = current.workflow_id;
      current.created_at = new Date().toISOString();
      current.workflow_id = require("crypto").randomUUID();
      _logWorkflowIdRotation({ prev_id: prevId, new_id: current.workflow_id, source: `updateState:type_transition(${previousWorkflowType}->${current.workflow_type})` });
    }
    // Idempotent self-healing for workflow_id_history: ensure {original,
    // current} ⊆ history regardless of how history arrived. init.cjs strips
    // workflow_id + created_at, forcing the first-activation branch above
    // that never appended a new id to an existing array, so the guard runs
    // after either branch. Plus a trace-backfill pass for orphan ids that
    // appeared in `_mcp-trace.jsonl` but never reached history — capped at
    // the last 5000 lines to bound I/O cost; orphans land in trace-appearance
    // order between `original` (index 0) and `current` (end).
    if (current.active === true) {
      if (!Array.isArray(current.workflow_id_history)) current.workflow_id_history = [];
      // Prepend original if missing — preserves chronological order
      // (original is the first id the session ever held).
      if (
        current.original_workflow_id &&
        !current.workflow_id_history.includes(current.original_workflow_id)
      ) {
        current.workflow_id_history.unshift(current.original_workflow_id);
      }
      // H2-v3 trace backfill — collect in-session orphan ids first, then
      // splice them between original anchor and current (preserves
      // chronological intent).
      const anchorIso = current.first_created_at;
      if (anchorIso) {
        try {
          const anchorMs = new Date(anchorIso).getTime();
          // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
          const tracePath = path.join(getStateDir(), "..", "memory", "_mcp-trace.jsonl");
          if (fs.existsSync(tracePath)) {
            const body = fs.readFileSync(tracePath, "utf8");
            const lines = body.split("\n").slice(-5000);
            const seen = new Set(current.workflow_id_history);
            const orphans = [];
            for (const line of lines) {
              if (!line) continue;
              try {
                const rec = JSON.parse(line);
                if (typeof rec.workflow_id !== "string") continue;
                if (typeof rec.ts !== "string") continue;
                if (new Date(rec.ts).getTime() < anchorMs) continue;
                if (seen.has(rec.workflow_id)) continue;
                seen.add(rec.workflow_id);
                orphans.push(rec.workflow_id);
              } catch { /* malformed — skip */ }
            }
            if (orphans.length > 0) {
              // Splice orphans before current id if current is already in history;
              // otherwise append. Keeps original at index 0 + current at end.
              const currentIdx = current.workflow_id
                ? current.workflow_id_history.indexOf(current.workflow_id)
                : -1;
              if (currentIdx >= 0) {
                current.workflow_id_history.splice(currentIdx, 0, ...orphans);
              } else {
                current.workflow_id_history.push(...orphans);
              }
            }
          }
        } catch { /* trace read failure — backfill best-effort, leave existing history intact */ }
      }
      // Append current if missing — covers init-driven rotations that
      // didn't go through the workflow_type-transition branch.
      if (
        current.workflow_id &&
        !current.workflow_id_history.includes(current.workflow_id)
      ) {
        current.workflow_id_history.push(current.workflow_id);
      }
      // Trim workflow_id_history to archive_runs cap. Why bounded: the
      // self-healing logic above appends + backfills but never bounds, so
      // long-lived sessions can grow history to hundreds of entries.
      // Trim policy: preserve original_workflow_id anchor (index 0) for
      // cross-rotation trace attribution; keep the last N ids where
      // N = state.archive_runs. When history length ≤ N+1, no-op. Preserves
      // the same chronological-order invariant the self-healing code maintains.
      const archiveRuns = getArchiveRuns();
      if (current.workflow_id_history.length > archiveRuns + 1) {
        const original = current.original_workflow_id;
        const recentN = current.workflow_id_history.slice(-archiveRuns);
        if (original && !recentN.includes(original)) {
          current.workflow_id_history = [original, ...recentN];
        } else {
          current.workflow_id_history = recentN;
        }
      }
    }
    // Deactivation gate: on active=true→false transition, invoke
    // assertNoRawDispatchesThisSession before write. Block
    // (throw) when mode=block and raw dispatches present in workflow window;
    // warn to stderr when mode=warn|off; pass silently when clean. The gate
    // reads workflow.yaml from disk for its `created_at` anchor — that's the
    // unchanged pre-write value, which correctly bounds the workflow window.
    if (wasActive && current.active === false) {
      const gateResult = assertNoRawDispatchesThisSession();
      if (gateResult.ok === false) {
        throw new Error(
          `[devt:dispatch-hygiene] BLOCKED workflow deactivation — ${gateResult.reason}`
        );
      } else if (gateResult.warn) {
        process.stderr.write(
          `[devt:dispatch-hygiene] ${gateResult.reason}\n`
        );
      }
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

// Files in .devt/state/ that survive `state reset` / `/devt:workflow --cancel`.
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
  "dispatch-warnings.jsonl",            // forensic dispatch-scope log — survives cancel for /devt:debug --mode=forensics post-hoc analysis
  "probe-failures.jsonl",               // graphify+python probe failures (category, command, args, error). Survives reset so health subcommand can surface root-cause across sessions.
  ".graphify-rebuild.lock",             // atomic O_CREAT|O_EXCL lock for graphify rebuild --debounce. Survives reset so a crashed prior holder doesn't deadlock a fresh workflow (the rebuild path also unlinks the lock when mtime exceeds the debounce window).
  "last-curator-run.txt",               // auto-curator cooldown tracker; survives reset so the 7-day gate isn't bypassed by /devt:workflow --cancel
  "graphify-impact-plan.json",          // args+tier audit trail for the impact step. Survives reset so the "args VERBATIM" contract is auditable post-hoc; otherwise the plan disappears with the workflow and the only evidence left is graph-impact.md (the MCP response) without the args used to derive it.
  "workflow-id-rotations.jsonl",        // audit log of every workflow_id mutation (prev_id, new_id, source, pid, argv). RESET_EXEMPT because rotations BY resetSoft are themselves the events being audited — wiping the log on reset would erase the forensic trail for the bug that motivated it.
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
    "arch-triage.json", "arch-scan-report.md", "scanner-output.txt",
    "docs-summary.md", "curation-summary.md", "session-report.md",
    "autoskill-proposals.md", "baseline-gates.md",
    "claude-mem-harvest.md", "claude-mem-skipped.txt", "last-curator-run.txt",
    "continue-here.md",         // /devt:workflow --pause output (paired with handoff.json)
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
    "topic-symbols-dropped.json",  // symbols dropped when symbol_anchored truncates >32 from preflight; consumed by code-review step to emit truncation notice in graph-impact.md
    "probe-failures.jsonl",        // append-only diagnostic log of graphify+python probe failures; RESET_EXEMPT so health subcommand can surface root-cause across sessions
    "workflow-id-rotations.jsonl", // append-only audit log of workflow_id mutations (prev, new, source, pid, argv); RESET_EXEMPT for forensics
  ],
  allowed_patterns: [
    "^review-[A-Za-z0-9_.-]+\\.md$",                // review-architecture.md, review-pr367-slice-A.md
    "^impl-summary-[A-Za-z0-9_.-]+\\.(md|json)$",   // impl-summary-cr3.{md,json}
    "^test-summary-[A-Za-z0-9_.-]+\\.(md|json)$",
    "^verification-[A-Za-z0-9_.-]+\\.(md|json)$",
    "^slice-[A-Za-z0-9_.-]+\\.md$",
    // Slug variants for plan-class / research-class / spec-class / debug-class.
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

// Per-workflow accumulator fields cleared by resetSoft. Excludes session
// anchors (workflow_id_history, original_workflow_id, first_created_at — but
// reset-soft DOES rotate workflow_id + first_created_at so the dispatch-hygiene
// KILL gate doesn't fire on stale accumulated counts from a prior review).
const RESET_SOFT_CLEAR_KEYS = [
  "task", "complexity", "tier", "community", "slug",
  "phase", "status", "verdict", "repair", "verify_iteration",
  "redispatch_count", "lanes", "review_file", "dispatched_at",
  "stopped_at", "stopped_phase", "resume_context",
  "memory_signal_json", "scope_hint_json", "scope_trust_json",
];

// Logs rotated by resetSoft. Cross-workflow accumulators that the KILL gate +
// claim-check gate read MUST be rotated, else gates re-fire immediately on the
// preserved counts. Field receipt: greenfield's 51-raw-dispatch KILL gate from
// a 20-day-old workflow blocked a brand-new review's first state.update call.
const RESET_SOFT_ROTATE_LOGS = [
  "dispatch-warnings.jsonl",
  "claim-check-failures.jsonl",
];

// Review artifacts evicted by resetSoft. Without correlation-ID + mtime
// discipline, stale review-lane-*.md / review.{md,json} from a prior
// session would survive reset and the consolidator could merge stale
// findings — silent-wrong-output hazard, not just untidy.
//
// Each pattern is a basename glob (anchored to .devt/state/ root, no
// recursion). review-lane-*.md and review-lane-*.json cover canonical lane
// outputs AND the F-audit.md / G-stale.json variants reviewers emit when
// they can't claim the canonical name. The base review.{md,json} files are
// per-run reviewer outputs; consolidator regenerates them each pass.
//
// SAFE-TO-EVICT rationale: these are review-instance outputs, not workflow-
// spanning artifacts. impl-summary.md / graph-impact.md / test-summary.md
// are NOT in this list — they legitimately survive across review re-runs of
// the same implementation workflow.
const RESET_SOFT_EVICT_PATTERNS = [
  /^review\.md$/,
  /^review\.json$/,
  /^review-lane-.+\.md$/,
  /^review-lane-.+\.json$/,
];

/**
 * Soft-reset workflow state for a new review starting against a stale workflow.yaml.
 *
 * Surgical: clears per-workflow accumulator fields + rotates dispatch-warnings
 * and claim-check logs + assigns fresh workflow_id and first_created_at (so
 * KILL/claim-check gates start counting from zero). Preserves session anchors
 * (workflow_id_history with prev appended, original_workflow_id), the memory
 * layer, and all phase artifacts (impl-summary.md, graph-impact.md, review.md,
 * test-summary.md) — operators resuming legitimate prior phases retain their work.
 *
 * Field motivation: greenfield receipt #4 — operator ran /devt:review on a fresh
 * task, the workflow.yaml carried 51 raw_dispatch entries + 6-deep workflow_id_history
 * from a 20-day-old prior workflow chain, KILL gate fired on the first state.update
 * call, agent had to bypass the state machine entirely. /devt:review context_init
 * substep 1 explicitly says "do NOT reset .devt/state/" — correct for resume cases,
 * wrong for new-review-against-stale cases. resetSoft is the missing surgical reset.
 */
function resetSoft() {
  const filePath = getWorkflowPath();
  const stateDir = getStateDir();
  const lockFile = acquireLock();
  try {
    const prev = fs.existsSync(filePath)
      ? parseSimpleYaml(fs.readFileSync(filePath, "utf8"))
      : {};
    const prevWorkflowId = prev.workflow_id || null;
    const newWorkflowId = require("crypto").randomUUID();
    const nowIso = new Date().toISOString();
    _logWorkflowIdRotation({ prev_id: prevWorkflowId, new_id: newWorkflowId, source: "resetSoft" });

    const history = Array.isArray(prev.workflow_id_history)
      ? [...prev.workflow_id_history]
      : [];
    if (prevWorkflowId && !history.includes(prevWorkflowId)) {
      history.push(prevWorkflowId);
    }

    const next = {};
    for (const k of Object.keys(prev)) {
      if (RESET_SOFT_CLEAR_KEYS.includes(k)) continue;
      next[k] = prev[k];
    }
    next.workflow_id = newWorkflowId;
    next.first_created_at = nowIso;
    next.created_at = nowIso;
    next.original_workflow_id = prev.original_workflow_id || prevWorkflowId || newWorkflowId;
    next.workflow_id_history = history;
    next.active = false;
    next.iteration = 0;

    atomicWriteFileSync(filePath, serializeSimpleYaml(next));

    const rotated = [];
    const archiveTs = nowIso.replace(/[:.]/g, "-");
    for (const logName of RESET_SOFT_ROTATE_LOGS) {
      const src = path.join(stateDir, logName);
      if (!fs.existsSync(src)) continue;
      const archived = `${logName.replace(/\.jsonl$/, "")}.archive-${archiveTs}.jsonl`;
      const dst = path.join(stateDir, archived);
      try {
        fs.renameSync(src, dst);
        rotated.push({ from: logName, to: archived });
      } catch (e) {
        rotated.push({ from: logName, to: null, error: String(e && e.message) });
      }
    }

    // Evict review-instance artifacts to prevent fresh-run collision
    // (filename claim conflicts + stale-cid leakage into consolidation).
    // See RESET_SOFT_EVICT_PATTERNS comment for safety rationale.
    const evicted = [];
    try {
      for (const fname of fs.readdirSync(stateDir)) {
        if (!RESET_SOFT_EVICT_PATTERNS.some(re => re.test(fname))) continue;
        const fpath = path.join(stateDir, fname);
        try {
          fs.unlinkSync(fpath);
          evicted.push(fname);
        } catch (e) {
          evicted.push({ file: fname, error: String(e && e.message) });
        }
      }
    } catch { /* state dir read failure non-fatal — log entries already exist */ }

    return {
      ok: true,
      new_workflow_id: newWorkflowId,
      prev_workflow_id: prevWorkflowId,
      new_first_created_at: nowIso,
      cleared_fields: RESET_SOFT_CLEAR_KEYS,
      rotated_logs: rotated,
      evicted_artifacts: evicted,
      preserved: {
        workflow_id_history_depth: history.length,
        original_workflow_id: next.original_workflow_id,
        memory_layer: ".devt/memory/ untouched",
        phase_artifacts: "impl-summary.md / graph-impact.md / test-summary.md untouched (review.md and review-lane-*.{md,json} evicted to prevent fresh-run collision)",
      },
    };
  } finally {
    releaseLock(lockFile);
  }
}

/**
 * Detect whether the current workflow.yaml is stale relative to a new task.
 *
 * Returns {stale, reason, age_hours, task_changed, prior_task}. Stale iff
 * BOTH conditions hold:
 *   1. The proposed task differs from workflow.yaml::task (strict !==)
 *   2. workflow.yaml::created_at is more than 1 hour old
 *
 * AND semantics (not OR) — task-match-but-stale = legitimate resume; reset
 * would destroy the operator's prior-phase artifacts. Task-mismatch-but-fresh
 * = possible typo retry on the same session; wait for clearer signal.
 *
 * Consumed by workflows/code-review.md and workflows/dev-workflow.md
 * context_init substep 0 — if stale, AskUserQuestion offers reset-soft.
 */
function stalenessCheck({ task, workflowType } = {}) {
  const filePath = getWorkflowPath();
  if (!fs.existsSync(filePath)) {
    return { stale: false, reason: "no prior workflow.yaml — fresh start", age_hours: null, task_changed: false, prior_task: null, workflow_type_changed: false, prior_workflow_type: null, auto_reset_recommended: false };
  }
  const prev = parseSimpleYaml(fs.readFileSync(filePath, "utf8"));
  const priorTask = prev.task || null;
  const priorCreatedAt = prev.created_at || prev.first_created_at || null;
  const priorWorkflowType = prev.workflow_type || null;

  const taskChanged = Boolean(typeof task === "string" && task.length > 0 && priorTask && priorTask !== task);
  const workflowTypeChanged = Boolean(typeof workflowType === "string" && workflowType.length > 0 && priorWorkflowType && priorWorkflowType !== workflowType);

  let ageHours = null;
  if (priorCreatedAt) {
    const ms = Date.now() - new Date(priorCreatedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) ageHours = ms / (60 * 60 * 1000);
  }

  const ageStale = ageHours !== null && ageHours > 1;
  const stale = Boolean(taskChanged && ageStale);

  // Auto-reset recommendation — non-destructive resetSoft auto-fire when
  // ALL hold: task_changed AND age>24h AND workflow_type_changed. Any one
  // alone is too aggressive (typo retry / long-running workflow / mid-
  // session mode flip respectively). All three = unambiguous "new working
  // session" — orchestrator can fire without prompting the operator.
  const ageVeryStale = ageHours !== null && ageHours > 24;
  const autoResetRecommended = Boolean(taskChanged && ageVeryStale && workflowTypeChanged);

  let reason = "fresh";
  if (autoResetRecommended) {
    reason = `auto-reset recommended: task changed ('${priorTask}' → '${task}'), workflow_type changed ('${priorWorkflowType}' → '${workflowType}'), prior workflow ${ageHours.toFixed(1)}h old — unambiguous new working session`;
  } else if (stale) {
    reason = `task changed ('${priorTask}' → '${task}') and prior workflow is ${ageHours.toFixed(1)}h old; raw_dispatch/claim-check counters carry from prior session and may fire KILL gate on first state update`;
  } else if (taskChanged && !ageStale) {
    reason = `task changed but prior workflow is <1h old — may be typo retry, not resetting`;
  } else if (!taskChanged && ageStale) {
    reason = `task matches prior workflow (${ageHours.toFixed(1)}h old) — legitimate resume`;
  }

  return { stale, reason, age_hours: ageHours, task_changed: taskChanged, prior_task: priorTask, workflow_type_changed: workflowTypeChanged, prior_workflow_type: priorWorkflowType, auto_reset_recommended: autoResetRecommended };
}

// auto-reset-if-stale orchestration helper. Combines
// stalenessCheck + resetSoft in one call when auto-reset conditions are met.
// Returns { acted: true, ...resetSoftResult, staleness } when reset fired,
// or { acted: false, staleness } when conditions weren't met (orchestrator
// then decides whether to AskUserQuestion the operator). Loud stderr message
// emitted on auto-fire so the operator sees what was cleared without having
// to inspect JSON.
function autoResetIfStale({ task, workflowType } = {}) {
  const staleness = stalenessCheck({ task, workflowType });
  if (!staleness.auto_reset_recommended) {
    return { acted: false, staleness };
  }
  const resetResult = resetSoft();
  // Loud stderr: operator typically sees CLI output; stderr is the surface
  // that survives JSON-only stdout consumers (jq pipelines, etc.).
  process.stderr.write(`[devt] AUTO-RESET fired: ${staleness.reason}\n`);
  process.stderr.write(`[devt] preserved: workflow_id_history (${(resetResult.preserved && resetResult.preserved.workflow_id_history_depth) || 0} entries), session anchors, .devt/memory, phase artifacts\n`);
  process.stderr.write(`[devt] cleared: per-workflow counters (raw_dispatch, claim-check, etc.) rotated to fresh workflow_id\n`);
  return { acted: true, ...resetResult, staleness };
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
  // Content-quality signal. The gate passes when one artifact exists, but
  // workflows + auditors benefit from knowing whether graph-impact.md carries
  // substantive content. Expose file_bytes + section_count (Markdown `## `
  // headings) so downstream tooling can flag thin payloads as advisory —
  // never block, since legitimate empty results exist (e.g., leaf nodes with
  // zero callers).
  //
  // Drill-down count signal (signal-only, not blocking). The drill-down spec
  // prescribes top-3 drill-down on direct_dependents, but the bash gate only
  // writes graph-impact.md without enforcing section structure. Count
  // `## Drill-down:` sections and surface drill_down_sections +
  // under_three_drill_downs so workflows / auditors can flag incomplete
  // execution. Not enforced as BLOCK because legitimate small graphs may have
  // fewer than 3 direct_dependents to drill into.
  const filePath = haveImpact ? graphImpactPath : skipReasonPath;
  let fileBytes = 0;
  let sectionCount = 0;
  let drillDownSections = 0;
  let malformedDrillDownHeadings = 0;
  // Per-section substance bookkeeping. Why per-section: counting sections
  // alone is fooled by 3 headings with empty bodies. Measure each drill-down
  // section's byte count after the heading; require ≥ 200 bytes OR an
  // explicit truncation marker ("— TRUNCATED" or "saved to /tmp/.../") that
  // documents an oversized response was saved off-context for later reference.
  const DRILL_DOWN_MIN_BYTES = 200;
  const TRUNCATION_MARKER_RE = /(?:—\s*TRUNCATED\b|saved (?:to|at)\s+[/\w.-]+)/i;
  // Empty-marker exemption. Without it, the gate forces operators to pad
  // legitimately-empty drill-down sections (e.g. interface symbols with 0
  // callers due to FastAPI DI blindness — see graphify-di-edge-gap).
  // `compose-drilldowns` emits the canonical marker for this case; the gate
  // honors it as "validly considered, empty by data" — distinct from "skipped"
  // (no section at all) and "fake" (prose padding to clear 200 bytes).
  const EMPTY_MARKER_RE = /_\(no neighbors found in direction=(?:in|out|both)\)_/i;
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
      // Detect non-spec drill-down headings (### or ####) so the gate doesn't
      // silently award credit when format violates the canonical
      // `## Drill-down: <SYM>` shape. Without this, a writer using ### causes
      // drillDownSections == 0 AND gate returns ok:true (no sections to
      // validate). If ANY `#+ Drill-down:` heading exists outside the strict
      // `^## ` form, flag it and let the substance check fail.
      const anyDepthDrillDown = content.match(/^#+\s+Drill-down:/gim);
      const anyDepthCount = anyDepthDrillDown ? anyDepthDrillDown.length : 0;
      malformedDrillDownHeadings = anyDepthCount - drillDownSections;
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
          const hasEmptyMarker = EMPTY_MARKER_RE.test(body);
          if (bodyBytes < DRILL_DOWN_MIN_BYTES && !hasTruncMarker && !hasEmptyMarker) {
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
  // orchestrator called get_neighbors via MCP. Without this check, prose
  // drill-downs written from codebase knowledge with zero MCP calls pass
  // silently (form-only gate). Cross-reference _mcp-trace.jsonl for
  // get_neighbors records scoped to the current workflow_id; if drill-down
  // headings exist but no MCP calls landed in this workflow's window, mark
  // fabricated and fail the gate.
  let mcpGetNeighborsCalls = 0;
  let fabricatedDrillDown = false;
  if (haveImpact && drillDownSections >= 1) {
    try {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const wfPath = path.join(dir, "workflow.yaml");
      if (fs.existsSync(wfPath)) {
        const wfYaml = fs.readFileSync(wfPath, "utf8");
        // Build a Set of acceptable workflow_ids — current rotated value
        // PLUS the original anchor — so trace records emitted BEFORE the
        // workflow_type transition still match. Without the original anchor,
        // get_neighbors calls landing under a prior workflow_id cause a false
        // "fabricated drill-down" positive after rotation. When original is
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
  // Drill-down skip is gating, not informational — applies the [[CON-001]]
  // substance-enforcement-gates pattern. Without this, the top-3 drill-down
  // step can be skipped entirely (0 get_neighbors calls, 0 drill-down sections)
  // while assert-graphify-decision returns ok:true.
  //
  // Distinguishing skip from legitimate small-graph case: skip is
  // characterized by tier ∈ {symbol_anchored, bulk_scoped} (drill-down
  // mandated) AND mcpGetNeighborsCalls === 0 (no calls attempted) AND
  // drillDownSections === 0 (no sections written). A small graph with
  // few-or-zero dependents would still produce at least one get_neighbors
  // call (the "skip if 0 dependents" branch fires AFTER the call).
  //
  // Gate is opt-out via .devt/config.json::graphify_decision_mode = "warn"
  // (default "block"). Mirrors dispatch_hygiene_mode pattern at line ~4398.
  let planTier = null;
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const planPath = path.join(dir, "graphify-impact-plan.json");
    if (fs.existsSync(planPath)) {
      const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
      if (plan && typeof plan.tier === "string") planTier = plan.tier;
    }
  } catch { /* plan missing or malformed — tier stays null, gate stays informational */ }
  let graphifyDecisionMode = "block";
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const configPath = path.join(findProjectRoot(), ".devt", "config.json");
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (cfg && typeof cfg.graphify_decision_mode === "string") {
        graphifyDecisionMode = cfg.graphify_decision_mode.toLowerCase();
      }
    }
  } catch { /* config missing — keep block default */ }
  const drillDownMandated = planTier === "symbol_anchored" || planTier === "bulk_scoped";
  const drillDownSkipped = haveImpact && drillDownMandated &&
                           mcpGetNeighborsCalls === 0 && drillDownSections === 0;
  const drillDownGateFires = graphifyDecisionMode === "block" && drillDownSkipped;
  const result = {
    ok: !fabricatedDrillDown && !hasThinDrillDowns && !(malformedDrillDownHeadings > 0) && !drillDownGateFires,
    file: haveImpact ? "graph-impact.md" : "graphify-skip-reason.txt",
    graphify_state: "ready",
    file_bytes: fileBytes,
    section_count: sectionCount,
    drill_down_sections: drillDownSections,
    malformed_drill_down_headings: malformedDrillDownHeadings,
    mcp_get_neighbors_calls: mcpGetNeighborsCalls,
    thin_content: thin,
    under_three_drill_downs: underThreeDrillDowns,
    fabricated_drill_down: fabricatedDrillDown,
    thin_drill_down_sections: thinDrillDownSections,
    thin_drill_downs: thinDrillDowns,
    plan_tier: planTier,
    graphify_decision_mode: graphifyDecisionMode,
    drill_down_skipped: drillDownSkipped,
  };
  if (malformedDrillDownHeadings > 0) {
    result.reason =
      `${malformedDrillDownHeadings} drill-down heading(s) use non-spec depth (###+ or #) — ` +
      `canonical form is "## Drill-down: <SYMBOL> [call: <correlation_id>]". Fix the writer ` +
      `agent's heading depth so the substance check counts them.`;
  } else if (fabricatedDrillDown) {
    result.reason =
      `drill-down sections present (${drillDownSections}) but no get_neighbors ` +
      `MCP calls recorded in workflow_id window — fabricated drill-down`;
  } else if (hasThinDrillDowns) {
    const sym = thinDrillDowns.map(d => `${d.symbol}=${d.body_bytes}B`).join(", ");
    result.reason =
      `${thinDrillDownSections} drill-down section(s) below ${DRILL_DOWN_MIN_BYTES}-byte ` +
      `substance threshold with no truncation marker (${sym}). Either the MCP ` +
      `response was empty or the drill-down was hand-typed.`;
  } else if (drillDownGateFires) {
    result.reason =
      `F16 drill-down step skipped: tier=${planTier} mandates top-3 get_neighbors ` +
      `but graph-impact.md has 0 drill-down sections and 0 get_neighbors MCP calls ` +
      `recorded in this workflow's window. Re-run the F16 step (the "## Drill-down: ` +
      `<DEP>" blocks for top-3 dependents). To opt out, set graphify_decision_mode: ` +
      `"warn" in .devt/config.json.`;
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

// Graphify ROI telemetry — wasted-drill rate metric.
//
// Inputs:
//   - .devt/state/graph-impact.md → counts `^## Drill-down: <SYM> ...` headings
//     (denominator: executed drills). Per-drill correlation_id extracted from
//     either `[call: <id>]` suffix on heading (compose-drilldowns format) OR
//     scanned from section body if present.
//   - .devt/state/review.md → counts unique `(via call: <id>)` / `[via call: <id>]`
//     citations. Each citation = downstream consumer (reviewer) actually
//     traced a finding back to a specific graph drill.
//
// Output: { drills_executed, drills_with_citation, wasted_drill_count,
//   wasted_drill_rate, status, ... }
//
// CRITICAL exclusion: when graph-impact.md is absent OR has 0 drill-down
// sections, status="no_drills_executed" + waste rate = null (NOT 100%).
// Runs that skip the drill-down phase must not be counted as waste — that
// would punish graphify for the operator's skip, biasing the metric.
function graphifyRoi() {
  const stateDir = getStateDir();
  const impactPath = path.join(stateDir, "graph-impact.md");
  const reviewPath = path.join(stateDir, "review.md");

  if (!fs.existsSync(impactPath)) {
    return {
      status: "no_drills_executed",
      reason: "graph-impact.md absent — substep 6 (drill-down execution) was skipped OR not applicable; metric undefined (NOT 100% waste)",
      drills_executed: 0,
      drills_with_citation: 0,
      wasted_drill_count: null,
      wasted_drill_rate: null,
    };
  }

  let impactContent = "";
  try { impactContent = fs.readFileSync(impactPath, "utf8"); }
  catch (e) {
    return { status: "error", reason: `graph-impact.md read failed: ${e.message}`, drills_executed: 0, drills_with_citation: 0, wasted_drill_count: null, wasted_drill_rate: null };
  }

  // Heading parser — lenient match captures ANY heading starting with
  // `## Drill-down:`, separately extracts the canonical `[call: <8hex>]`
  // suffix when present, and surfaces non-canonical headings via
  // `parse_failed_lines` telemetry. Prior strict `\s*$` anchor silently
  // dropped headings with arbitrary trailing suffixes, hiding
  // "heading present but unparseable" inside "no drills written."
  const drillHeadingLenientRe = /^##\s+Drill-down:\s*([^\n]+?)\s*$/gim;
  const callSuffixRe = /\[call:\s*([0-9a-f]{8})\]/i;
  const drillSections = [];
  let parseFailedLines = 0;
  let m;
  while ((m = drillHeadingLenientRe.exec(impactContent)) !== null) {
    const fullTitle = (m[1] || "").trim();
    // Extract optional [call: <hex>] suffix from anywhere in the title
    const callMatch = fullTitle.match(callSuffixRe);
    const corrId = callMatch ? callMatch[1] : null;
    // Symbol = everything before the first `(` or `[` (paren-or-bracket metadata)
    const symbolMatch = fullTitle.match(/^([^\s(\[]+)/);
    const symbol = symbolMatch ? symbolMatch[1].trim() : fullTitle;
    if (!symbol) { parseFailedLines++; continue; }
    drillSections.push({
      symbol,
      heading_full: fullTitle,
      heading_corr_id: corrId,
      heading_index: m.index,
    });
  }

  if (drillSections.length === 0) {
    return {
      status: "no_drills_executed",
      reason: "graph-impact.md present but contains 0 `## Drill-down:` sections; substep 6 wrote the file shell but no drills executed",
      drills_executed: 0,
      drills_with_citation: 0,
      wasted_drill_count: null,
      wasted_drill_rate: null,
      wasted_drill_rate_weak: null,
      parse_failed_lines: parseFailedLines,
    };
  }

  // Per-drill body analysis: corr_ids + yielded_data. yielded_data
  // distinguishes "drill returned results: []" from "drill returned data
  // nobody cited" — they're different waste classes demanding different
  // fixes (drill-selection vs drill-value). Collapsing them hides the lever.
  const corrIdRe = /([0-9a-f]{8})/g;
  // Canonical empty marker from compose-drilldowns +
  // explicit "results: []" + parenthetical "(empty ...)" + "no usable"
  // patterns. If ANY match, drill yielded no data.
  const emptyMarkerRe = /(_\(no neighbors found in direction=(?:in|out|both)\)_|results\s*:\s*\[\s*\]|\(empty\b|no usable caller set)/i;
  for (let i = 0; i < drillSections.length; i++) {
    const start = drillSections[i].heading_index;
    const end = i + 1 < drillSections.length ? drillSections[i + 1].heading_index : impactContent.length;
    const section = impactContent.slice(start, end);
    const ids = new Set();
    if (drillSections[i].heading_corr_id) ids.add(drillSections[i].heading_corr_id);
    let im;
    while ((im = corrIdRe.exec(section)) !== null) {
      if (im[1] !== drillSections[i].heading_corr_id) ids.add(im[1]);
      if (ids.size >= 5) break;
    }
    drillSections[i].corr_ids = Array.from(ids);
    drillSections[i].yielded_data = !emptyMarkerRe.test(section);
  }

  // 3-state citation: "strong" (corr_id match) / "weak" (symbol-name
  // code-identifier match in finding body) / "none" (neither). The weak
  // path catches MCPs that don't emit correlation_ids — without it the
  // metric is biased to 100% waste by construction. Symbol-name match
  // constrained to backtick-wrapped + CamelCase code identifiers (path-
  // separator-aware boundaries) to avoid file-path false-positives.
  let citedIds = new Set();
  let reviewContent = "";
  const reviewExists = fs.existsSync(reviewPath);
  if (reviewExists) {
    try { reviewContent = fs.readFileSync(reviewPath, "utf8"); } catch { /* fall through */ }
    const citationRe = /[(\[]\s*via\s+call:\s*([0-9a-f]{8})\s*[)\]]/gi;
    let cm;
    while ((cm = citationRe.exec(reviewContent)) !== null) citedIds.add(cm[1]);
  }

  // Code-identifier-only weak match. Tighten the word-boundary regex to
  // ALSO exclude path separators (`/`, `\`) and dots in lookbehind/
  // lookahead so `src/CallBackend.py` doesn't match symbol `CallBackend` —
  // symbol must appear as a STANDALONE identifier, not as a path component.
  // Backtick-wrapping always matches. NO line-strip pre-pass: line-strip
  // over-fires when a line mentions the symbol legitimately AND contains
  // a file path on the same line.
  let strongCount = 0;
  let weakCount = 0;
  for (const d of drillSections) {
    if (d.corr_ids.some(id => citedIds.has(id))) {
      d.citation = "strong";
      strongCount++;
    } else if (d.symbol && reviewContent) {
      const escaped = d.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const codeIdRe = new RegExp(`(?:\`${escaped}\`|(?<![A-Za-z0-9_./\\\\])${escaped}(?![A-Za-z0-9_./\\\\]))`, "g");
      if (codeIdRe.test(reviewContent)) {
        d.citation = "weak";
        weakCount++;
      } else {
        d.citation = "none";
      }
    } else {
      d.citation = "none";
    }
  }

  // Dual rate per receipt #8 Q6(c): strict (corr_id only) vs weak (includes
  // symbol-name matches). The DELTA between them is the diagnostic — strict
  // 100% / weak 33% reads as "drills aren't useless, the citation plumbing
  // is broken." Without both, the failure mode can't be diagnosed.
  const drillsWithCitation = strongCount;
  const wastedCount = drillSections.length - drillsWithCitation;
  const wastedRate = drillSections.length > 0 ? Number((wastedCount / drillSections.length).toFixed(3)) : null;
  const wastedRateWeak = drillSections.length > 0
    ? Number(((drillSections.length - strongCount - weakCount) / drillSections.length).toFixed(3))
    : null;

  return {
    status: reviewExists ? "measured" : "no_review_yet",
    reason: reviewExists
      ? `${strongCount}/${drillSections.length} drills cited strong (corr_id); ${weakCount} weak (symbol-name); ${citedIds.size} unique correlation_ids` + (parseFailedLines > 0 ? `; ${parseFailedLines} unparseable heading line(s)` : "")
      : "review.md not yet written — consolidator may not have run; metric premature",
    drills_executed: drillSections.length,
    drills_with_citation: drillsWithCitation,
    drills_with_weak_citation: weakCount,
    wasted_drill_count: wastedCount,
    wasted_drill_rate: wastedRate,           // strict: corr_id-only citations
    wasted_drill_rate_weak: wastedRateWeak,  // permissive: includes symbol-name matches
    unique_citations_in_review: citedIds.size,
    parse_failed_lines: parseFailedLines,
    // Per-drill output: refactored from {cited: bool} to richer shape.
    // citation: "strong"|"weak"|"none" distinguishes corr_id-cited from
    // symbol-name-matched from neither. yielded_data: distinguishes drills
    // that returned data (could be cited) from drills that returned empty
    // results (couldn't be cited regardless) — different waste classes.
    per_drill: drillSections.map(d => ({
      symbol: d.symbol,
      corr_ids: d.corr_ids,
      citation: d.citation,            // "strong" | "weak" | "none"
      yielded_data: d.yielded_data,    // false = drill returned results: [] OR canonical empty marker
    })),
  };
}

// Graphify impact-plan computation — orchestration wrapper for the
// tier-decision tree previously inlined as ~115 lines of bash in
// workflows/code-review.md substep 5. Returns the same JSON shape that the
// workflow used to write to .devt/state/graphify-impact-plan.json:
//   {tier, tool, args, skip_reason, git_provider, pr_scoped_skip_reason,
//    pr_diff_caveat?, topic_symbols_dropped_count?}
//
// Inputs (all optional, defaulted from current state):
//   - reviewScope: text of the current review task (used for PR# extraction
//     + bulk_scoped query text). Defaults to workflow.yaml::task.
//   - primaryBranch: git default branch for `<primary>...HEAD` triple-dot
//     diff. Defaults to config.git.primary_branch || "main".
//
// Tier decision tree (preserved verbatim from workflow bash):
//   1. graphify state != ready → tier="skip"
//   2. PR# + github → tier="pr_scoped" (uses get_pr_impact)
//   3. PR# + non-github → tier="pr_scoped_diff" (diff symbols + blast_radius)
//      OR fallback to symbol_anchored on topic.symbols OR "skip"
//   4. topic.symbols present → tier="symbol_anchored"
//   5. scope >= IMPACT_THRESHOLD + dense graph → diff-symbol-driven
//      symbol_anchored OR legacy bulk_scoped fallback
//   6. else → tier="skip"
//
// SIDE EFFECTS: writes the same files the bash used to:
//   - .devt/state/graphify-impact-plan.json (the returned object)
//   - .devt/state/topic-symbols-dropped.json (when topic.symbols > 32)
//     OR removes any stale topic-symbols-dropped.json
//
// Cheap free-disk probe (cal #38.C / receipt #10 finding #6). devt workflows
// are disk-heavy — `.devt/state/` artifacts + N parallel-lane agent
// transcripts (multiple MB each). On a near-full disk a write fails mid-run
// with ENOSPC (greenfield died at 132Mi when a Bash stdout-capture failed
// mid-lane), leaving partial work + a stalled lane. This is WARN-ONLY by
// design: a low-disk signal is surfaced so the operator can act, but the
// workflow is never blocked (per the no-defensive-limits-for-low-risk
// principle — user intervention is the failsafe, not a hard stop). One `df`
// call, ~5ms. Always returns ok:true; status is "ok" | "warn" | "unknown".
const _DISK_WARN_MB = 1024; // warn below 1 GiB free
function diskCheck() {
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync("df", ["-Pk", "."], { encoding: "utf8", timeout: 3000 });
    const lines = out.trim().split("\n");
    // POSIX -P guarantees one un-wrapped data row: Filesystem 1024-blocks Used
    // Available Capacity Mounted-on. Take the last line (the mount for ".").
    const cols = lines[lines.length - 1].trim().split(/\s+/);
    const availKb = parseInt(cols[3], 10);
    if (!Number.isFinite(availKb)) {
      return { ok: true, status: "unknown", free_mb: null, reason: "df output unparseable" };
    }
    const freeMb = Math.floor(availKb / 1024);
    const status = freeMb < _DISK_WARN_MB ? "warn" : "ok";
    const result = { ok: true, status, free_mb: freeMb, warn_threshold_mb: _DISK_WARN_MB };
    if (status === "warn") {
      result.message = `⚠️ low disk: ${freeMb}Mi free (< ${_DISK_WARN_MB}Mi) — parallel-lane transcripts may exhaust space mid-run; free space to avoid ENOSPC`;
    }
    return result;
  } catch (e) {
    return { ok: true, status: "unknown", free_mb: null, reason: "df unavailable: " + (e && e.message ? e.message : "error") };
  }
}

// MCP execution + AskUserQuestion remain orchestrator-side (architecturally
// can't move into a CLI). This wrapper handles ONLY the pure-compute tier-
// decision path.
function computeGraphifyImpactPlan({ reviewScope, primaryBranch } = {}) {
  // Resolve defaults from state + config
  if (!reviewScope) {
    try {
      const s = readState();
      reviewScope = (s && s.task) || "";
    } catch { reviewScope = ""; }
  }
  if (!primaryBranch) {
    try {
      const { getMergedConfig } = require("./config.cjs");
      const cfg = getMergedConfig();
      primaryBranch = (cfg && cfg.git && cfg.git.primary_branch) || "main";
    } catch { primaryBranch = "main"; }
  }

  const stateDir = getStateDir();
  const briefPath = path.join(stateDir, "preflight-brief.json");
  const droppedPath = path.join(stateDir, "topic-symbols-dropped.json");
  const planPath = path.join(stateDir, "graphify-impact-plan.json");

  // Read preflight-brief sidecar — source of truth for graph_stats + topic
  let brief = null;
  try { brief = JSON.parse(fs.readFileSync(briefPath, "utf8")); }
  catch { brief = null; }
  const graphifyState = (brief && brief.graph_stats && brief.graph_stats.state) || "not_ready";
  const graphifyTrust = (brief && brief.graph_stats && brief.graph_stats.trust) || "empty";
  const topicSymbolsRaw = Array.isArray(brief && brief.topic && brief.topic.symbols) ? brief.topic.symbols : [];
  const topicSymbolsRawCount = topicSymbolsRaw.length;

  // Pre-truncate topic.symbols to MCP blast_radius cap (32). The contract
  // says "args VERBATIM" — exceeding 32 makes that mechanically impossible.
  // Capture the dropped tail to a sidecar so reviewers can spot-check
  // whether high-risk symbols were silently excluded.
  const TOPIC_CAP = 32;
  const topicSymbols = topicSymbolsRaw.slice(0, TOPIC_CAP);
  const topicSymbolsCount = topicSymbols.length;
  let topicSymbolsDroppedCount = 0;
  if (topicSymbolsRawCount > TOPIC_CAP) {
    const dropped = topicSymbolsRaw.slice(TOPIC_CAP);
    topicSymbolsDroppedCount = dropped.length;
    try { atomicWriteJsonSync(droppedPath, dropped); } catch { /* best-effort */ }
  } else {
    try { if (fs.existsSync(droppedPath)) fs.unlinkSync(droppedPath); } catch { /* best-effort */ }
  }

  // Config — graphify provider + impact threshold (single config read)
  let gitProvider = "";
  let impactThreshold = 10;
  try {
    const { getMergedConfig } = require("./config.cjs");
    const cfg = getMergedConfig();
    gitProvider = ((cfg && cfg.git && cfg.git.provider) || "").toLowerCase();
    impactThreshold = (cfg && cfg.graphify && typeof cfg.graphify.impact_threshold === "number")
      ? cfg.graphify.impact_threshold : 10;
  } catch { /* defaults */ }

  // PR# extraction from REVIEW_SCOPE: matches "PR #N" / "PR N" / "pull request #N"
  const prMatch = (reviewScope || "").match(/(?:PR|pull request)\s*#?(\d+)/i);
  const prNum = prMatch ? prMatch[1] : null;

  // Scope file count from code-review-input.md (when present)
  let scopeFileCount = 0;
  try {
    const inputPath = path.join(stateDir, "code-review-input.md");
    if (fs.existsSync(inputPath)) {
      scopeFileCount = fs.readFileSync(inputPath, "utf8").split("\n").filter(l => l.trim().length > 0).length;
    }
  } catch { /* default 0 */ }

  // Provider-skip-reason for PR-scoped GitHub-only tier (cleared when
  // pr_scoped_diff fires successfully — see branch below).
  let prScopedSkipReason = "";
  if (prNum && gitProvider !== "github") {
    prScopedSkipReason = `provider=${gitProvider}; pr_scoped (GitHub get_pr_impact) skipped — pr_scoped_diff tier used instead`;
  }

  // Diff symbols extractor — wraps `graphify symbols-in-files` against
  // the current diff. Only invoked on tier branches that need it.
  const getDiffSymbols = () => {
    let symbols = [];
    let newFilesCount = 0;
    let totalFilesCount = 0;
    try {
      const { spawnSync } = require("child_process");
      const proot = findProjectRoot();
      const diffRes = spawnSync("git", ["diff", "--name-only", `${primaryBranch}...HEAD`], {
        cwd: proot, encoding: "utf8", timeout: 5000,
      });
      if (diffRes.status === 0) {
        const files = diffRes.stdout.split("\n").map(s => s.trim()).filter(Boolean);
        totalFilesCount = files.length;
        if (files.length > 0) {
          const graphifyMod = require("./graphify.cjs");
          // Pass baseRef → enables hunk-scoping (keep only symbols DEFINED on
          // changed lines, so god-nodes in touched files don't bury the
          // actually-changed providers). limit=25: with hunk-scoping the
          // candidate set is small, but the bump protects against truncation
          // when a large changed set survives scoping.
          const res = graphifyMod.symbolsInFiles(files, 25, { baseRef: primaryBranch });
          symbols = Array.isArray(res && res.symbols) ? res.symbols.map(s => s.symbol).filter(Boolean) : [];
          // Q2 caveat reconciliation: an added file is "not indexed" ONLY when
          // NO graph node matched it — not merely because git flags it added.
          // The prior static --diff-filter=A count overstated ~37× (receipt
          // #10: 37/38 added .py files WERE indexed at HEAD; only an
          // ignore-patterned migration was genuinely absent). Reconcile the
          // added-file list against the actual matched_files the extractor
          // returned.
          const matched = Array.isArray(res && res.matched_files) ? res.matched_files : [];
          const addRes = spawnSync("git", ["diff", "--name-status", "--diff-filter=A", `${primaryBranch}...HEAD`], {
            cwd: proot, encoding: "utf8", timeout: 5000,
          });
          if (addRes.status === 0) {
            const added = addRes.stdout.split("\n").map(s => s.trim()).filter(Boolean)
              .map(l => l.replace(/^A\s+/, "").trim()).filter(Boolean);
            const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "");
            const matchedNorm = matched.map(norm);
            const suffixMatch = (a, b) => a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
            // Count added files NOT covered by any matched graph source_file.
            newFilesCount = added.filter(a => {
              const na = norm(a);
              return !matchedNorm.some(m => suffixMatch(m, na));
            }).length;
          }
        }
      }
    } catch { /* defaults */ }
    return { symbols, newFilesCount, totalFilesCount };
  };

  // Tier decision tree — explicit, no implicit fallbacks. Preserved
  // verbatim from workflows/code-review.md substep 5.
  let tier = "skip";
  let tool = "";
  let args = {};
  let skipReason = "";
  let prDiffCaveat = null;

  if (graphifyState !== "ready") {
    tier = "skip";
    skipReason = `graphify state=${graphifyState}`;
  } else if (prNum && gitProvider === "github") {
    tier = "pr_scoped";
    tool = "mcp__graphify__get_pr_impact";
    args = { pr_number: Number(prNum) };
  } else if (prNum && gitProvider !== "github") {
    const ds = getDiffSymbols();
    if (ds.symbols.length > 0) {
      tier = "pr_scoped_diff";
      tool = "mcp__plugin_devt_devt-graphify__blast_radius";
      args = { symbols: ds.symbols };
      prScopedSkipReason = ""; // tier activated — clear prior skip-reason
      if (ds.newFilesCount > 0) {
        prDiffCaveat = `${ds.newFilesCount} of ${ds.totalFilesCount} files are new — symbols extracted via diff-hunk fallback but blast_radius edge data unavailable until "graphify update ." rebuild`;
      }
    } else if (topicSymbolsCount > 0) {
      tier = "symbol_anchored";
      tool = "mcp__plugin_devt_devt-graphify__blast_radius";
      args = { symbols: topicSymbols };
    } else {
      tier = "skip";
      skipReason = "non-GitHub PR but no diff symbols extracted (graph sparse) AND no topic symbols";
    }
  } else if (topicSymbolsCount > 0) {
    tier = "symbol_anchored";
    tool = "mcp__plugin_devt_devt-graphify__blast_radius";
    args = { symbols: topicSymbols };
  } else if (scopeFileCount >= impactThreshold && graphifyTrust === "dense") {
    // Prefer symbol_anchored driven from diff-file symbols over bulk_scoped
    // text-search. blast_radius with symbols whose source_file is in the
    // diff produces actual structural impact; query_graph(text=SCOPE) only
    // returns keyword matches that don't reflect the call graph.
    const ds = getDiffSymbols();
    if (ds.symbols.length > 0) {
      tier = "symbol_anchored";
      tool = "mcp__plugin_devt_devt-graphify__blast_radius";
      args = { symbols: ds.symbols };
    } else {
      tier = "bulk_scoped";
      tool = "mcp__plugin_devt_devt-graphify__query_graph";
      args = { text: reviewScope, limit: 20 };
    }
  } else {
    tier = "skip";
    skipReason = "no PR (or non-GitHub), no topic symbols, scope below threshold";
  }

  const plan = {
    tier,
    tool,
    args,
    skip_reason: skipReason,
    git_provider: gitProvider,
    pr_scoped_skip_reason: prScopedSkipReason,
  };
  if (prDiffCaveat) plan.pr_diff_caveat = prDiffCaveat;
  if (topicSymbolsDroppedCount > 0) plan.topic_symbols_dropped_count = topicSymbolsDroppedCount;

  try { atomicWriteJsonSync(planPath, plan); } catch { /* best-effort */ }
  return plan;
}

// Substance check for agent output files. Lane sub-agent dispatches can
// return status:completed with placeholder bodies like
// "Stub written; analysis in progress." while the verifier approves on
// file-existence alone. This function detects stub markers, low word count,
// and heading-only structure so downstream gates can refuse to accept the
// output without re-dispatch.
const STUB_MARKER_PATTERNS = [
  /\bstub written\b/i,
  // Verb-prefixed "in progress" variants. "Stub: analysis in progress" and
  // similar forms appear in stub bodies; broader pattern catches realistic
  // variants without false-positives on substantive prose (validated against
  // real review.md files: matches stub, zero matches on 2132-word real review).
  /\b(?:analysis|implementation|review|work|writing|investigation)\s+in\s+progress\b/i,
  // Leading "Stub:" or "Stub." marker — stubs frequently use this prefix
  // form independent of the "in progress" phrase.
  /^\s*stub\s*[:.]/im,
  /^\s*TODO\s*:/m,
  /^\s*WIP\s*:/m,
  /\(stub\)/i,
  /\bnot yet (?:written|complete|done)\b/i,
];
const STUB_WORD_COUNT_THRESHOLD = 50;

function checkAgentOutput(filePath, opts) {
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

  // Optional structural-drift check against a baseline (typically the
  // stub-first sentinel snapshot the orchestrator captured before final
  // write). Closes the gap stub/word-count detection misses: section
  // deletion, code-fence mangling, lost URLs between baseline and final.
  if (opts && opts.structural && opts.baseline) {
    const baselinePath = path.isAbsolute(opts.baseline)
      ? opts.baseline
      : path.join(findProjectRoot(), opts.baseline);
    if (!fs.existsSync(baselinePath)) {
      result.structural_drift = {
        ok: false,
        errors: [`baseline does not exist: ${opts.baseline}`],
        warnings: [],
        mode: opts.mode || "superset",
      };
      result.ok = false;
      const driftReason = `structural drift: baseline does not exist: ${opts.baseline}`;
      result.reason = result.reason ? `${result.reason}; ${driftReason}` : driftReason;
    } else {
      try {
        const baseline = fs.readFileSync(baselinePath, "utf8");
        const { validate } = require("./structural-validator.cjs");
        result.structural_drift = validate(baseline, content, {
          mode: opts.mode || "superset",
        });
        if (!result.structural_drift.ok) {
          result.ok = false;
          const driftReason = `structural drift: ${result.structural_drift.errors.join("; ")}`;
          result.reason = result.reason
            ? `${result.reason}; ${driftReason}`
            : driftReason;
        }
      } catch (e) {
        // Validator crash must not be silent — a checkAgentOutput consumer
        // expects `ok` to reflect ALL gates, not just the stub-pattern one.
        // Without flipping ok=false, the gate reports clean when validation
        // is actually broken.
        result.structural_drift = {
          ok: false,
          errors: [`structural-validator error: ${e.message}`],
          warnings: [],
          mode: opts.mode || "superset",
        };
        result.ok = false;
        const driftReason = `structural-validator crashed: ${e.message}`;
        result.reason = result.reason ? `${result.reason}; ${driftReason}` : driftReason;
      }
    }
  }

  return result;
}

// Workflow types that dispatch a verifier when config.workflow.verification=true.
// Other workflow types (quick_implement, debug, retro, plan, specify, etc.)
// intentionally skip verification by design — applying the gate uniformly
// produces false-negative blocks. Without this allow-list, a project running
// quick_implement with workflow.verification=true would hit assert-verifier-ran
// ok:false even though quick_implement has no verifier step (silent miss).
const VERIFIER_REQUIRED_WORKFLOWS = new Set([
  "dev",
  "code_review",
  "code_review_parallel",
]);

// Substance gate ensuring the verifier dispatch actually ran when config
// said it should. Without this gate, an orchestrator with
// config.workflow.verification=true can skip the verifier step entirely
// (e.g., rationalizing that "fan-out is verifier-grade") and nothing in the
// workflow contract enforces the dispatch happening — the conditional skip
// at the top of the verify step is the only check, and orchestrators under
// context pressure rationalize past conditional skips. Same arch class as
// gate-bypass via "I'll skip this one." This CLI exposes the post-dispatch
// substance check; workflows wire it into present_findings.
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
  // Substance check (cal #36 #3 from receipt #9): existence-only gate
  // accepted a synthetic verification.json with `{"status":"DONE"}` and
  // nothing else. Verifier outputs MUST carry actual grade evidence —
  // either substantive markdown (≥600 bytes after frontmatter, sentinel
  // markers stripped) OR sidecar with non-empty axis grades / verdict
  // structure. Without this, the gate fires "ok" on a well-formed empty
  // shell — same [[CON-001]] form-vs-substance failure mode the verifier
  // exists to prevent at the agent layer.
  const SUBSTANCE_MIN_MD_BYTES = 600;
  const STUB_RE = /\b(stub written|analysis in progress|placeholder|TODO\b)/i;
  let substanceOk = false;
  let substanceReason = "";
  if (haveSidecar) {
    try {
      const parsed = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
      // Sidecar substance: either explicit axis grades OR findings OR
      // revisions OR criteria_total > 0 (graded any axes). One of these
      // must be a non-empty signal that the verifier actually ran a grade.
      const hasGrades = parsed && (
        (Array.isArray(parsed.findings) && parsed.findings.length > 0) ||
        (Array.isArray(parsed.revisions) && parsed.revisions.length > 0) ||
        (Array.isArray(parsed.axes) && parsed.axes.length > 0) ||
        (typeof parsed.criteria_total === "number" && parsed.criteria_total > 0) ||
        (typeof parsed.verdict === "string" && parsed.verdict.length > 0)
      );
      if (hasGrades) {
        substanceOk = true;
      } else {
        substanceReason = "verification.json carries status but no grade evidence (findings/revisions/axes/criteria_total/verdict all absent or empty)";
      }
    } catch (e) {
      substanceReason = `verification.json unparseable: ${e.message}`;
    }
  }
  if (!substanceOk && haveMd) {
    try {
      const mdContent = fs.readFileSync(mdPath, "utf8");
      // Strip YAML frontmatter + stub-marker lines, then check byte size
      const stripped = mdContent
        .replace(/^---\n[\s\S]*?\n---\n/, "")
        .split("\n")
        .filter(line => !STUB_RE.test(line))
        .join("\n")
        .trim();
      if (Buffer.byteLength(stripped, "utf8") >= SUBSTANCE_MIN_MD_BYTES) {
        substanceOk = true;
      } else {
        substanceReason = substanceReason
          || `verification.md substance-stripped size ${Buffer.byteLength(stripped, "utf8")} < ${SUBSTANCE_MIN_MD_BYTES} bytes — verifier output is a stub/skeleton, not a grade`;
      }
    } catch (e) {
      substanceReason = substanceReason || `verification.md unreadable: ${e.message}`;
    }
  }
  if (!substanceOk) {
    return {
      ok: false,
      verification_enabled: true,
      sidecar_present: haveSidecar,
      markdown_present: haveMd,
      reason: `verification artifact exists but lacks substance: ${substanceReason}. Re-dispatch the verifier — a synthetic skeleton bypasses the safety net.`,
    };
  }
  return {
    ok: true,
    verification_enabled: true,
    sidecar_present: haveSidecar,
    markdown_present: haveMd,
  };
}

// Map from upstream-agent to the sidecar that carries its self-flagged
// uncertainty signal. Derived by inverting JSON_SIDECAR_SCHEMAS::agent so
// adding a new self-flag-bearing agent requires editing only the schema
// registry (single source of truth). Excludes verifier itself — verifier's
// own sidecar isn't the upstream consulted by short-circuit logic.
// Verifier short-circuit reads this sidecar to decide whether the verifier
// LLM dispatch can be skipped — when the upstream agent emitted Status: DONE
// AND self_flagged_uncertainties[] is empty, the agent itself is the
// strongest signal that there are no coverage gaps worth a re-grade. Opus
// 4.8 made this signal load-bearing: the model self-reports uncertainty far
// more reliably than prior versions.
const SELF_FLAG_SIDECAR_FOR_AGENT = Object.freeze(
  Object.entries(JSON_SIDECAR_SCHEMAS).reduce((acc, [sidecar, schema]) => {
    if (sidecar === "verification.json") return acc;
    for (const agent of (schema.agent || [])) acc[agent] = sidecar;
    return acc;
  }, {})
);

/**
 * Verifier short-circuit gate. Returns {short_circuit, reason, sidecar_path,
 * self_flagged_count}. When the upstream agent's sidecar is substantive (status
 * DONE) AND self_flagged_uncertainties[] is empty, skip the verifier LLM
 * dispatch — re-grading work the agent already self-certified saves 3-5K
 * tokens per clean iteration. Verifier still runs when:
 *   - sidecar absent or unparseable (defensive — verifier is the safety net)
 *   - sidecar status != DONE (PARTIAL/BLOCKED need verifier judgment)
 *   - self_flagged_uncertainties[] non-empty (re-dispatch with structured
 *     revisions[] mapping each flagged uncertainty to a coverage gap)
 *
 * Field motivation: Opus 4.8 is 4x less likely than 4.7 to silently ship
 * code defects; the model now proactively flags issues. devt's verifier was
 * burning tokens re-grading work where the agent itself reported "no gaps."
 */
function assertVerifierShortCircuit({ agent } = {}) {
  if (!agent || typeof agent !== "string") {
    return { short_circuit: false, reason: "missing --agent argument (required)" };
  }
  const sidecarName = SELF_FLAG_SIDECAR_FOR_AGENT[agent];
  if (!sidecarName) {
    return { short_circuit: false, reason: `agent '${agent}' has no self-flag sidecar registered (valid: ${Object.keys(SELF_FLAG_SIDECAR_FOR_AGENT).join(", ")})` };
  }
  const sidecarPath = path.join(getStateDir(), sidecarName);
  if (!fs.existsSync(sidecarPath)) {
    return { short_circuit: false, reason: `${sidecarName} absent — verifier must run as safety net`, sidecar_path: sidecarPath };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  } catch (e) {
    return { short_circuit: false, reason: `${sidecarName} unparseable: ${e.message} — verifier must run`, sidecar_path: sidecarPath };
  }
  const status = parsed && parsed.status;
  if (status !== "DONE" && status !== "DONE_WITH_CONCERNS") {
    return {
      short_circuit: false,
      reason: `${sidecarName} status='${status}' (not DONE/DONE_WITH_CONCERNS) — verifier judgment required`,
      sidecar_path: sidecarPath,
      sidecar_status: status,
    };
  }
  // Field-absent must NOT short-circuit. Agents updated for cal #30.2 always
  // populate self_flagged_uncertainties (empty array means "no uncertainties");
  // older/external agents omit it entirely. Treating absence as "empty" would
  // silently bypass the verifier safety net for any sidecar produced before
  // the contract existed. Require an EXPLICIT empty array as the negative
  // claim — anything else (undefined, null, non-array) → verifier runs.
  if (!Object.prototype.hasOwnProperty.call(parsed, "self_flagged_uncertainties")) {
    return {
      short_circuit: false,
      reason: `${sidecarName} does not declare self_flagged_uncertainties — agent did not engage with the self-flag contract; verifier must run as safety net (use [] to explicitly assert no uncertainties)`,
      sidecar_path: sidecarPath,
      sidecar_status: status,
    };
  }
  if (!Array.isArray(parsed.self_flagged_uncertainties)) {
    return {
      short_circuit: false,
      reason: `${sidecarName} self_flagged_uncertainties is not an array (got ${typeof parsed.self_flagged_uncertainties}) — schema violation; verifier must run`,
      sidecar_path: sidecarPath,
      sidecar_status: status,
    };
  }
  const flagged = parsed.self_flagged_uncertainties;
  if (flagged.length > 0) {
    return {
      short_circuit: false,
      reason: `${sidecarName} self_flagged_uncertainties=${flagged.length} — verifier should re-dispatch with structured revisions mapping each flagged item`,
      sidecar_path: sidecarPath,
      sidecar_status: status,
      self_flagged_count: flagged.length,
      self_flagged_uncertainties: flagged,
    };
  }
  return {
    short_circuit: true,
    reason: `${sidecarName} status='${status}' AND self_flagged_uncertainties is explicitly empty [] — agent self-certified no coverage gaps; verifier LLM dispatch may be skipped to save tokens`,
    sidecar_path: sidecarPath,
    sidecar_status: status,
    self_flagged_count: 0,
  };
}

// Verifier-axis-coverage gate. Without this, a verifier can walk rubric
// axes A–G and stop, silently skipping axis H ("## Axis H — Dispatch warnings
// acknowledgment"). Same [[CON-001]] substance-vs-form failure mode: the
// rubric's H axis was computed at edit time but the verifier didn't enforce
// walking it.
//
// Counts `^## Axis [A-Z] —` headings in the pinned rubric body and compares
// against verification.json::criteria_total. Mismatch → ok:false with the
// missing-axis count surfaced. Workflow types whose rubrics don't use
// axis-letter taxonomy (e.g. dev workflow uses Verification Levels L1-L5.5)
// return ok:true with reason "rubric does not use axis taxonomy".
//
// Returns {ok, reason?, rubric_axes_present, criteria_total, missing_axes_count}.
function assertVerifierGradedAllAxes() {
  const { getMergedConfig } = require("./config.cjs");
  const cfg = getMergedConfig();
  const dir = getStateDir();
  // Resolve workflow_type to know which rubric was pinned.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const wfPath = path.join(dir, "workflow.yaml");
  let workflowType = null;
  if (fs.existsSync(wfPath)) {
    const raw = fs.readFileSync(wfPath, "utf8");
    const m = raw.match(/^workflow_type:\s*"?([^"\n]+)"?\s*$/m);
    if (m) workflowType = m[1].trim();
  }
  if (!workflowType) {
    return { ok: true, reason: "no active workflow — gate does not apply" };
  }
  // Resolve rubric path: cfg.rubrics[<workflow_type>] is the filename in
  // references/rubrics/. Same pattern as the workflow dispatch templates.
  const rubricFilename = cfg && cfg.rubrics && cfg.rubrics[workflowType];
  if (!rubricFilename) {
    return {
      ok: true,
      workflow_type: workflowType,
      reason: `no rubric pinned for workflow_type=${workflowType} — gate does not apply`,
    };
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const rubricPath = path.join(__dirname, "..", "..", "references", "rubrics", rubricFilename);
  if (!fs.existsSync(rubricPath)) {
    return {
      ok: true,
      workflow_type: workflowType,
      rubric_path: rubricFilename,
      reason: `rubric file ${rubricFilename} not found at expected path — gate does not apply`,
    };
  }
  const rubricBody = fs.readFileSync(rubricPath, "utf8");
  // Code-review rubric uses a hybrid taxonomy: axes A–G live as TABLE ROWS in
  // the "Grading axes" table (`| **A. Scope coverage** | ...`), while axis H
  // is a top-level heading. Count both patterns so the gate applies to the
  // full taxonomy regardless of authoring shape.
  const headingMatches = rubricBody.match(/^##\s+Axis\s+[A-Z]\s+—/gm);
  const tableMatches = rubricBody.match(/^\|\s+\*\*[A-Z]\.\s+/gm);
  const headingCount = headingMatches ? headingMatches.length : 0;
  const tableCount = tableMatches ? tableMatches.length : 0;
  const rubricAxesPresent = headingCount + tableCount;
  if (rubricAxesPresent === 0) {
    return {
      ok: true,
      workflow_type: workflowType,
      rubric_path: rubricFilename,
      rubric_axes_present: 0,
      reason: `rubric does not use axis taxonomy (no "## Axis [A-Z] —" headings or "| **X." table rows found) — gate does not apply`,
    };
  }
  // Read verification.json sidecar to get criteria_total.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const sidecarPath = path.join(dir, "verification.json");
  if (!fs.existsSync(sidecarPath)) {
    return {
      ok: false,
      workflow_type: workflowType,
      rubric_path: rubricFilename,
      rubric_axes_present: rubricAxesPresent,
      reason: `verification.json sidecar absent — verifier never ran or sidecar was deleted`,
    };
  }
  let criteriaTotal = null;
  try {
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    if (sidecar && typeof sidecar.criteria_total === "number") {
      criteriaTotal = sidecar.criteria_total;
    }
  } catch {
    return {
      ok: false,
      workflow_type: workflowType,
      rubric_path: rubricFilename,
      rubric_axes_present: rubricAxesPresent,
      reason: `verification.json malformed — cannot read criteria_total`,
    };
  }
  if (criteriaTotal === null) {
    return {
      ok: false,
      workflow_type: workflowType,
      rubric_path: rubricFilename,
      rubric_axes_present: rubricAxesPresent,
      criteria_total: null,
      reason: `verification.json missing criteria_total field — verifier did not declare how many axes it graded`,
    };
  }
  const missing = rubricAxesPresent - criteriaTotal;
  if (missing > 0) {
    return {
      ok: false,
      workflow_type: workflowType,
      rubric_path: rubricFilename,
      rubric_axes_present: rubricAxesPresent,
      criteria_total: criteriaTotal,
      missing_axes_count: missing,
      reason: `rubric declares ${rubricAxesPresent} axes (A–${rubricAxesPresent <= 26 ? String.fromCharCode(64 + rubricAxesPresent) : "Z+"}) but verifier graded only ${criteriaTotal}; verifier stopped early and skipped ${missing} axis (axes). Re-dispatch verifier with the full rubric body and re-grade.`,
    };
  }
  return {
    ok: true,
    workflow_type: workflowType,
    rubric_path: rubricFilename,
    rubric_axes_present: rubricAxesPresent,
    criteria_total: criteriaTotal,
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
// Why a mechanical gate: orchestrators can skip the AskUserQuestion silently
// with rationalizations like "user pre-stated parallel intent." Prose-only
// gates don't survive this; this gate forces the answer artifact to exist.
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
// Why this gate exists: orchestrators can skip lane registration entirely;
// list-lane-outputs then returns {"lanes":[]} despite lanes being dispatched
// manually. This gate fails when partition_lanes runs but produces zero lane
// records — forcing the orchestrator to either register lanes or fall back
// to single-dispatch explicitly.
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
// Why this gate exists: orchestrators can write the consolidated review.md
// themselves instead of dispatching the synthesis agent. The verifier grades
// it and the silent skip is invisible. This gate fails when ≥1 lane passed
// substance but no consolidator marker exists.
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
// Without this, an orchestrator can skip the step entirely with "default
// config has it disabled" rationale while never actually reading the config
// to confirm. This forces a consideration marker regardless of the config
// outcome.
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
// before code is written. Why mechanical: prose-only "scan existing code
// first" gets rationalized past, producing N-variations-of-same-function.
// Pattern: derive-reuse-candidates writes the candidate list; programmer
// must address each candidate in reuse-analysis.md with a decision.
// Workflow-type-scoped: a blind gate returns ok:false on /devt:review
// sessions even though review is READ-ONLY and never dispatches a programmer.
// Declare the implement-flow opt-in set; return ok:true for others with a
// workflow-type reason. Same pattern as VERIFIER_REQUIRED_WORKFLOWS.
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
  // failure. Without the marker, this gate returned ok:true when
  // reuse-candidates.md was simply absent, blessing a session where the
  // entire pre-search step never ran. The marker is written BEFORE the
  // derive-reuse-candidates CLI invocation by the workflow bash, so its
  // presence is the canonical "orchestrator attempted the step" signal.
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
// Without this gate, agent prose at workflows/quick-implement.md says
// "load-bearing — not optional" but nothing enforces it. Observed failure
// mode: candidates described in review.md prose but ZERO #KNOWLEDGE-CANDIDATE
// lines in scratchpad, so candidates never reach the curator harvester.
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
// The structural side of preflight has observable decision artifacts
// (graphify-skip-reason.txt, staleness lag); the semantic side did not, so
// an orchestrator could read scope_hint without knowing whether the
// underlying symbols were trustworthy. This gate surfaces the extraction
// confidence numerically. Returns
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

// Post-hoc enforcement gate for raw devt:* agent dispatches. The PreToolUse
// `dispatch-hygiene-guard.sh` hook detects raw dispatches correctly and
// returns `{decision:"deny"}` — but Claude Code does NOT enforce PreToolUse
// deny verdicts on the Task tool in current versions (hook fires and writes
// raw_dispatch entries to dispatch-warnings.jsonl, but sub-agents run
// anyway). The hook's `mode:"block"` is functionally a no-op for Task
// dispatches; the advisory surfaces in additionalContext but the orchestrator
// can rationalize past it.
//
// This gate is the post-hoc mitigation: at workflow finalize/present_findings
// time, scan dispatch-warnings.jsonl for `source:"raw_dispatch"` entries
// with ts >= workflow.yaml::created_at (current WORKFLOW's window) and BLOCK
// the workflow if any are present. Same pattern as
// assert-knowledge-candidates-tagged (gate-cluster sibling at finalize).
//
// Scope is `created_at` (current workflow's start, rotates on every init *
// and workflow_type transition), not `first_created_at` (immutable session
// anchor). Session-scope was too aggressive for pattern-C open-ended
// sessions: historical raw dispatches across prior workflows would block a
// CURRENT workflow whose own dispatches were all properly enveloped. The
// right scope is per-workflow: each new init * gives a clean window so
// legitimate per-workflow review remains independent of historical
// accumulation.
//
// Setting `dispatch_hygiene_mode:"warn"` in .devt/config.json opts out — the
// gate respects the same config knob the PreToolUse hook reads. Useful for
// projects that intentionally orchestrate ad-hoc agent dispatches.
// Mechanical claim-check. Workflow runners call this AFTER each
// output-writing dispatch to verify the agent actually wrote its declared
// output, instead of trusting the agent's verbal "I wrote X" claim. Observed
// failure mode: architect returns a verbal summary claiming "wrote
// arch-review.md" but the file is never on disk — main thread has to
// reconstruct it. This gate catches exactly that case before phase advances.
//
// Reads agent → primary output from agents/io-contracts.yaml (single source of
// truth — see artifact manifest). Returns:
//   {ok:true, agent, expected_path, exists:true, size_bytes, reason}
//   {ok:false, agent, expected_path, exists:false, reason}
//   {ok:false, agent, reason: "agent not declared in io-contracts"}
// Layer-2 wrapper persists every result (success + failure) to
// claim-check-failures.jsonl. Layer-2 assertClaimChecksResolved reads the
// jsonl at finalize. Persistence is fail-open; the wrapped result is the
// authoritative return value.
function assertArtifactPresent(agent) {
  const result = _assertArtifactPresentInner(agent);
  persistClaimCheckResult(result);
  return result;
}
function _assertArtifactPresentInner(agent) {
  if (typeof agent !== "string" || !agent) {
    return { ok: false, reason: "missing agent argument" };
  }
  // Polymorphic argument: `<agent>` (canonical, resolves from io-contracts) or
  // `<agent>:lane-<id>` (per-lane, resolves from workflow.yaml::lanes[]). The
  // per-lane form closes the Layer-1 coverage gap in code-review-parallel.md
  // where lane dispatches had no claim-check trail despite being output-writing.
  // Each lane persists a distinct record (agent key includes the suffix) so
  // Layer-2 sees lane-level resolution semantics.
  const laneMatch = agent.match(/^([^:]+):lane-(.+)$/);
  if (laneMatch) {
    return _assertLaneArtifactPresent(laneMatch[1], laneMatch[2]);
  }
  let contracts;
  try {
    const dispatch = require("./dispatch.cjs");
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const contractsPath = path.join(__dirname, "..", "..", "agents", "io-contracts.yaml");
    if (!fs.existsSync(contractsPath)) {
      return { ok: false, agent, reason: "agents/io-contracts.yaml not found" };
    }
    contracts = dispatch.parseIoContracts(fs.readFileSync(contractsPath, "utf8"));
  } catch (e) {
    return { ok: false, agent, reason: `io-contracts parse failed: ${e.message}` };
  }
  const agentContract = contracts.agents && contracts.agents[agent];
  if (!agentContract) {
    return { ok: false, agent, reason: `agent "${agent}" not declared in agents/io-contracts.yaml` };
  }
  const primary = agentContract.outputs && agentContract.outputs.primary;
  if (!primary || primary === "null") {
    // Agent has no output artifact by design (e.g., curator's outputs.primary
    // could legitimately be null in some configs) — gate auto-passes.
    return { ok: true, agent, expected_path: null, exists: null, reason: "agent declares no primary output" };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const artifactPath = path.join(dir, primary);
  const exists = fs.existsSync(artifactPath);
  if (!exists) {
    return {
      ok: false,
      agent,
      expected_path: `.devt/state/${primary}`,
      exists: false,
      reason: `Expected output .devt/state/${primary} (per agents/io-contracts.yaml::${agent}.outputs.primary) does not exist. The ${agent} dispatch returned without writing its declared artifact — re-dispatch with explicit instruction to write ${primary} before returning.`,
    };
  }
  let sizeBytes;
  try { sizeBytes = fs.statSync(artifactPath).size; }
  catch (e) { return { ok: false, agent, expected_path: `.devt/state/${primary}`, exists: true, reason: `stat failed: ${e.message}` }; }
  if (sizeBytes === 0) {
    return {
      ok: false,
      agent,
      expected_path: `.devt/state/${primary}`,
      exists: true,
      size_bytes: 0,
      reason: `Expected output .devt/state/${primary} exists but is empty (0 bytes). Likely a stub-first protocol write that the agent didn't follow through on — re-dispatch.`,
    };
  }
  // Substance-aware Layer-1 — call checkAgentOutput internally to add
  // substance_verdict alongside the file-presence verdict. Size-threshold
  // short-circuit: files above STUB_SIZE_THRESHOLD bytes are empirically
  // substantive (lane stubs observed at 65/72 B; substantive lanes at
  // 7–42 KB). Skipping the regex scan for large files keeps the per-call
  // cost flat for the common case. Without substance_verdict, Layer-1
  // records success on stub-sized files and Layer-2 PASSes false-positive
  // when a stub wins the latest-timestamp slot. substance_verdict closes
  // that gap. Backwards compat: assertClaimChecksResolved treats missing
  // field as "substantive" so historical records keep passing.
  const substance = _computeSubstanceVerdict(artifactPath, sizeBytes);
  return {
    ok: true,
    agent,
    expected_path: `.devt/state/${primary}`,
    exists: true,
    size_bytes: sizeBytes,
    substance_verdict: substance.verdict,
    ...(substance.detail ? { substance_detail: substance.detail } : {}),
    reason: `${primary} present (${sizeBytes} bytes, substance=${substance.verdict})`,
  };
}

// Per-lane Layer-1 — resolves expected_path from workflow.yaml::lanes[].review_file
// instead of io-contracts.yaml::outputs.primary. The agent key in the persisted
// record is `<canonicalAgent>:lane-<id>` so Layer-2's per-agent latest-verdict
// computation treats each lane as a distinct stream within the workflow window.
function _assertLaneArtifactPresent(canonicalAgent, laneId) {
  const tag = `${canonicalAgent}:lane-${laneId}`;
  const { lanes } = listLaneOutputs();
  const lane = (lanes || []).find((l) => l.id === laneId);
  if (!lane) {
    return {
      ok: false,
      agent: tag,
      reason: `lane "${laneId}" not registered in workflow.yaml::lanes[]. Either the lane id is wrong or partition_lanes has not run yet.`,
    };
  }
  if (!lane.review_file) {
    return {
      ok: false,
      agent: tag,
      reason: `lane "${laneId}" has no review_file field in workflow.yaml::lanes[]. partition_lanes must register a review_file per lane.`,
    };
  }
  if (!lane.file_exists) {
    return {
      ok: false,
      agent: tag,
      expected_path: lane.review_file,
      exists: false,
      reason: `Expected lane output ${lane.review_file} does not exist. Lane ${laneId} dispatch returned without writing its declared review file — re-dispatch with explicit instruction to write ${lane.review_file} before returning.`,
    };
  }
  if (lane.file_size_bytes === 0) {
    return {
      ok: false,
      agent: tag,
      expected_path: lane.review_file,
      exists: true,
      size_bytes: 0,
      reason: `Lane output ${lane.review_file} exists but is empty (0 bytes). Likely a stub-first protocol write that the lane reviewer did not follow through on — re-dispatch.`,
    };
  }
  // Substance-aware Layer-1 (lane variant) — same semantic as the canonical
  // form: size-threshold short-circuit + checkAgentOutput for small files.
  // Closes the gap where lane Layer-1 recorded success on stub-sized files
  // that substance_check_lanes correctly flagged later.
  const substance = _computeSubstanceVerdict(lane.review_file, lane.file_size_bytes);
  return {
    ok: true,
    agent: tag,
    expected_path: lane.review_file,
    exists: true,
    size_bytes: lane.file_size_bytes,
    substance_verdict: substance.verdict,
    ...(substance.detail ? { substance_detail: substance.detail } : {}),
    reason: `${lane.review_file} present (${lane.file_size_bytes} bytes, substance=${substance.verdict})`,
  };
}

// Substance-verdict helper shared by canonical + lane forms. Returns
// {verdict: "stub"|"substantive"|"unknown", detail?: string}.
// Size-threshold short-circuit at STUB_SIZE_THRESHOLD bytes: empirically,
// outputs above this cap are substantive (no field-observed false negatives);
// outputs at or below the cap warrant the regex scan + word-count check.
// The threshold is generous — common stubs are sub-100 bytes; this gives
// nearly 10x headroom before triggering the deeper check.
const STUB_SIZE_THRESHOLD = 1000;
function _computeSubstanceVerdict(artifactPath, sizeBytes) {
  if (sizeBytes > STUB_SIZE_THRESHOLD) {
    return { verdict: "substantive" };
  }
  let subRes;
  try { subRes = checkAgentOutput(artifactPath); }
  catch (e) { return { verdict: "unknown", detail: `substance check error: ${e.message}` }; }
  if (!subRes || typeof subRes.looks_like_stub !== "boolean") {
    return { verdict: "unknown", detail: (subRes && subRes.reason) || "substance check returned no boolean verdict" };
  }
  if (subRes.looks_like_stub === true) {
    return { verdict: "stub", detail: subRes.reason || "stub heuristic match" };
  }
  return { verdict: "substantive" };
}

// Rate-limit-mid-section recovery diagnostic.
// The PARTIAL contract in programmer.md triggers at section boundaries. When a
// rate-limit interrupts the agent MID-section, no PARTIAL sidecar emits and
// impl-summary.md stays at its stub-first sentinel. The agent provably cannot
// detect rate-limits from inside the model (the API just stops responding) —
// only the orchestrator has the signals: dispatch-warnings.jsonl carries the
// task_output_bytes record with low_output:true, and the on-disk primary
// artifact reveals stub vs substantive state.
//
// Returns a JSON decision the orchestrator routes on:
//   recovery_needed=true + suggested_action=SendMessage-resume — rate-limit
//     pattern matches (stub + low_output) — resume rather than re-dispatch
//   recovery_needed=true + suggested_action=investigate — stub but no
//     low_output signal — abnormal stop without rate-limit shape
//   recovery_needed=false + primary_state=substantive — agent finished
//     enough work to count, just didn't write a sidecar (status unknown but
//     not stub-equivalent)
//   recovery_needed=false + primary_state=missing — never wrote anything,
//     dispatch from scratch (not a partial case)
//   recovery_needed=false + sidecar_status=<terminal> — sidecar declares
//     explicit terminal status (DONE / PARTIAL / DONE_WITH_CONCERNS), no
//     recovery needed
function recoverPartialImpl(agent) {
  if (typeof agent !== "string" || !agent) {
    return { ok: false, reason: "missing agent argument" };
  }
  let primary, sidecar, expectedSections;
  try {
    const dispatch = require("./dispatch.cjs");
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const contractsPath = path.join(__dirname, "..", "..", "agents", "io-contracts.yaml");
    if (!fs.existsSync(contractsPath)) {
      return { ok: false, agent, reason: "agents/io-contracts.yaml not found" };
    }
    const contracts = dispatch.parseIoContracts(fs.readFileSync(contractsPath, "utf8"));
    const ac = contracts.agents && contracts.agents[agent];
    if (!ac) {
      return { ok: false, agent, reason: `agent "${agent}" not declared in agents/io-contracts.yaml` };
    }
    primary = ac.outputs && ac.outputs.primary;
    sidecar = ac.outputs && ac.outputs.sidecar;
    expectedSections = (ac.outputs && ac.outputs.expected_sections) || null;
  } catch (e) {
    return { ok: false, agent, reason: `io-contracts parse failed: ${e.message}` };
  }
  if (!primary || primary === "null") {
    return { ok: true, agent, recovery_needed: false, reason: "agent declares no primary output — nothing to recover" };
  }
  const dir = getStateDir();
  // Sidecar is authoritative when it declares a terminal status — short-circuit.
  if (sidecar && sidecar !== "null") {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const sidecarPath = path.join(dir, sidecar);
    if (fs.existsSync(sidecarPath)) {
      try {
        const sc = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
        if (sc.status && typeof sc.status === "string" && sc.status !== "WIP") {
          return {
            ok: true,
            agent,
            recovery_needed: false,
            sidecar_status: sc.status,
            reason: `${sidecar}::status=${sc.status} — agent declared its terminal state explicitly; no recovery needed`,
          };
        }
      } catch { /* malformed JSON — fall through to primary inspection */ }
    }
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const primaryPath = path.join(dir, primary);
  if (!fs.existsSync(primaryPath)) {
    return {
      ok: true,
      agent,
      recovery_needed: false,
      primary_state: "missing",
      reason: `${primary} does not exist — agent dispatch never wrote anything. Re-dispatch from scratch (not a partial-recovery case).`,
    };
  }
  let sizeBytes = 0, head = "";
  try {
    sizeBytes = fs.statSync(primaryPath).size;
    head = fs.readFileSync(primaryPath, "utf8").slice(0, 500);
  } catch (e) {
    return { ok: false, agent, reason: `read failed: ${e.message}` };
  }
  // Stub heuristic — matches the stub-first protocol's canonical header pattern.
  // Threshold 500 bytes is generous to cover "# Title — in progress\n\nMetadata".
  // The dash class accepts both em-dash (U+2014, canonical convention) and
  // regular hyphen (U+002D, common typo) so the gate fails open to "stub
  // detected" rather than misclassifying a hyphenated stub as substantive.
  const STUB_BYTES_THRESHOLD = 500;
  const stubPattern = /^#\s+.+\s+[—\-]\s+in progress\b/m;
  const isStub = sizeBytes < STUB_BYTES_THRESHOLD && stubPattern.test(head);
  // Latest task_output_bytes record for this agent in dispatch-warnings.jsonl.
  // The hook prefixes agent with "devt:" so match accordingly. Malformed-line
  // counter surfaces degraded telemetry — partial JSONL writes from a hook
  // race or disk-full event would otherwise route recovery to "investigate"
  // (the wrong path) without any signal.
  let latestOutputRecord = null;
  let malformedJsonlLines = 0;
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const warningsPath = path.join(dir, "dispatch-warnings.jsonl");
  if (fs.existsSync(warningsPath)) {
    try {
      const lines = fs.readFileSync(warningsPath, "utf8").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i]) continue;
        try {
          const rec = JSON.parse(lines[i]);
          if (rec.source !== "task_output_bytes") continue;
          const recAgent = (rec.agent || "").replace(/^devt:/, "");
          if (recAgent === agent) {
            latestOutputRecord = rec;
            break;
          }
        } catch { malformedJsonlLines++; }
      }
    } catch { /* read failed — fall through */ }
  }
  const lowOutput = !!(latestOutputRecord && latestOutputRecord.low_output === true);
  if (isStub && lowOutput) {
    const r = {
      ok: true,
      agent,
      recovery_needed: true,
      primary_state: "stub",
      low_output: true,
      output_bytes: latestOutputRecord.output_bytes,
      suggested_action: "SendMessage-resume",
      reason: `${primary} is stub-equivalent (${sizeBytes} bytes, header-only) AND dispatch-warnings.jsonl shows the agent's last dispatch had low_output:true (${latestOutputRecord.output_bytes} bytes). Likely rate-limited mid-section. SendMessage-resume the agent rather than re-dispatching — the stub-first sentinel + orchestrator's section progress are recoverable context.`,
    };
    if (malformedJsonlLines > 0) r.malformed_jsonl_lines = malformedJsonlLines;
    return r;
  }
  if (isStub) {
    const r = {
      ok: true,
      agent,
      recovery_needed: true,
      primary_state: "stub",
      low_output: false,
      suggested_action: "investigate",
      reason: `${primary} is stub-equivalent (${sizeBytes} bytes, header-only) but no low_output signal in dispatch-warnings.jsonl${malformedJsonlLines > 0 ? ` (${malformedJsonlLines} malformed line(s) skipped — telemetry may be degraded)` : ""}. The dispatch either never started writing content OR stopped for a reason other than rate-limit. Investigate before re-dispatching.`,
    };
    if (malformedJsonlLines > 0) r.malformed_jsonl_lines = malformedJsonlLines;
    return r;
  }
  // Structural-drift check. When the artifact is substantive
  // but the agent's contract declares expected_sections AND validator mode is
  // not 'off', extract the artifact's headings and verify every declared
  // section is present. Drops detected → return suggested_action="targeted-fix"
  // so orchestrators can SendMessage-resume the same agent with a precise
  // fix prompt rather than fresh re-dispatch. Mode 'warn' surfaces the
  // signal advisory-style; mode 'block' makes the orchestrator routing
  // mandatory. Same triad shape as dispatch_hygiene_mode / claim_check_mode.
  let structuralCheckErrored = false;
  if (expectedSections && Array.isArray(expectedSections) && expectedSections.length > 0) {
    let structuralMode = "off";
    try {
      const { getMergedConfig } = require("./config.cjs");
      const cfg = getMergedConfig();
      structuralMode = (cfg && cfg.validator && cfg.validator.structural_mode) || "off";
    } catch (e) {
      // ENOENT (missing config file) is the expected silent case. Other
      // errors — malformed JSON, permission, prototype-pollution rejection —
      // are configuration mistakes the user needs to see; otherwise the
      // feature silently no-ops and the calibration window collects no data.
      if (e && e.code !== "ENOENT") {
        process.stderr.write(
          `[recover-partial-impl] config load failed: ${e.message} — defaulting structural_mode=off\n`,
        );
      }
    }
    if (structuralMode !== "off") {
      try {
        const content = fs.readFileSync(primaryPath, "utf8");
        const { extractHeadings } = require("./structural-validator.cjs");
        const headings = extractHeadings(content);
        const present = new Set(headings.map(h => h.title));
        const missing = expectedSections.filter(s => !present.has(s));
        if (missing.length > 0) {
          return {
            ok: true,
            agent,
            recovery_needed: true,
            primary_state: "substantive",
            size_bytes: sizeBytes,
            suggested_action: "targeted-fix",
            mode: structuralMode,
            drift: {
              missing_sections: missing,
              expected_sections: expectedSections,
            },
            reason: `${primary} is substantive (${sizeBytes} bytes) but missing ${missing.length} section(s) declared in io-contracts.yaml::${agent}.outputs.expected_sections: ${JSON.stringify(missing)}. SendMessage-resume the agent with templates/dispatch/envelopes/${agent}-fix.tmpl.md — preserves existing content while restoring the dropped section(s) — rather than fresh re-dispatch.`,
          };
        }
      } catch (e) {
        // Validator crash must not be silent — the calibration window
        // relies on observing real drift. Stderr-surface and mark the
        // return so the orchestrator can distinguish "no drift detected"
        // from "drift detection unavailable".
        process.stderr.write(
          `[recover-partial-impl] structural validator failed: ${e.message}\n`,
        );
        structuralCheckErrored = true;
      }
    }
  }
  const substantiveReturn = {
    ok: true,
    agent,
    recovery_needed: false,
    primary_state: "substantive",
    size_bytes: sizeBytes,
    reason: `${primary} appears substantive (${sizeBytes} bytes, no stub-pattern match). No partial-recovery needed — agent may simply not have written a sidecar.`,
  };
  if (structuralCheckErrored) substantiveReturn.structural_check = "errored";
  if (malformedJsonlLines > 0) substantiveReturn.malformed_jsonl_lines = malformedJsonlLines;
  return substantiveReturn;
}

// Substance-check race fix — mtime-stability primitive.
// PRIMARY mechanism for guarding against premature substance reads.
//
// Failure mode: an orchestrator's substance check on a lane file fires
// BEFORE the agent's Task() returns; the read sees a stub because the
// agent's write hasn't completed. The orchestrator then dispatches a retry
// based on the false stub signal; the retry's smaller output overwrites the
// first-pass's substantive output → findings lost.
//
// Mtime-stability is mechanically robust without orchestrator burden: stat
// the file at T0, sleep settle-ms, stat again at T1. If size and mtime
// are unchanged, the file is quiescent (no active writer) → safe to read.
// If different, the file is still being written → wait and retry.
//
// Default settle window: 500ms. Default timeout: 5000ms. Both tunable.
//
// Returns: {ok, path, size_bytes, mtime_ms, attempts, settle_ms, total_ms,
//           reason}. ok=false on timeout (file never stabilized) or path
// not found. Workflows can choose: BLOCK on ok=false (strict) or warn-and-
// proceed (best-effort with sentinel logging).

// When a sub-agent dispatch dies mid-flight (credential expiry, network
// failure, model rate-limit), the orchestrator typically re-dispatches
// without programmatic visibility into what files the dead dispatch may have
// already edited. Observed failure mode: dispatch dies at "Not logged in",
// retry inherits partial edits from the prior session and self-corrects —
// but the orchestrator has no signal that edits have landed.
// detectInheritedSourceEdits surfaces uncommitted git changes filtered by
// mtime > workflow start so orchestrators can decide before re-dispatching:
// clean (revert prior edits), merge (treat as in-progress work), or
// investigate.
//
// Returns: {ok, workflow_started_at, count_total, count_after_workflow_start,
//           recommendation, guidance, files}. files[] entries carry status code
//           (M/A/D etc.), path, and mtime_after_workflow_start boolean.
function detectInheritedSourceEdits() {
  const { execSync } = require("child_process");
  let workflowStartIso = null;
  try {
    const wfPath = path.join(findProjectRoot(), ".devt", "state", "workflow.yaml");
    if (fs.existsSync(wfPath)) {
      const raw = fs.readFileSync(wfPath, "utf8");
      // first_created_at is the immutable session anchor (per existing
      // semantics in state.cjs). created_at rotates on workflow_type
      // transitions; for the inheritance-detection use case we want the
      // earliest anchor of the current session.
      const m = raw.match(/^first_created_at:\s*"?([^"\n]+)"?\s*$/m) ||
                raw.match(/^created_at:\s*"?([^"\n]+)"?\s*$/m);
      if (m) workflowStartIso = m[1].trim();
    }
  } catch { /* no workflow active; report all uncommitted as ambient */ }
  const workflowStartMs = workflowStartIso ? new Date(workflowStartIso).getTime() : 0;
  let porcelain;
  try {
    porcelain = execSync("git status --porcelain", {
      cwd: findProjectRoot(),
      timeout: 3000,
      encoding: "utf8",
    });
  } catch (e) {
    return {
      ok: false,
      reason: "git status failed (not a git repo, or git unavailable)",
      error: e.message,
    };
  }
  const files = [];
  let filesAfterStart = 0;
  for (const line of porcelain.split("\n")) {
    if (!line) continue;
    const status = line.slice(0, 2);
    const filename = line.slice(3).trim();
    // Skip untracked (??) — these could be the current dispatch's in-progress
    // writes, not inherited state. Skip ignored (!!) — irrelevant.
    if (status === "??" || status === "!!") continue;
    let mtimeAfterStart = false;
    if (workflowStartMs > 0) {
      try {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
        const stat = fs.statSync(path.join(findProjectRoot(), filename));
        mtimeAfterStart = stat.mtimeMs > workflowStartMs;
      } catch { /* file may have been deleted (status D) */ }
    }
    if (mtimeAfterStart) filesAfterStart++;
    files.push({
      status: status.trim(),
      file: filename,
      mtime_after_workflow_start: mtimeAfterStart,
    });
  }
  let recommendation, guidance;
  if (files.length === 0) {
    recommendation = "clean";
    guidance = "No uncommitted source edits — safe to dispatch.";
  } else if (filesAfterStart > 0) {
    recommendation = "review";
    guidance = `${filesAfterStart} file(s) modified since workflow start at ${workflowStartIso}. If you did not intend these edits, run \`git diff\` to inspect, then either commit them as part of the current workflow OR \`git checkout <file>\` to revert before re-dispatching.`;
  } else {
    recommendation = "ambient_uncommitted";
    guidance = `${files.length} uncommitted file(s) predate the current workflow (ambient state). Likely operator WIP from before workflow start; usually safe to ignore, but worth a glance if a dispatch dies unexpectedly.`;
  }
  return {
    ok: true,
    workflow_started_at: workflowStartIso,
    count_total: files.length,
    count_after_workflow_start: filesAfterStart,
    recommendation,
    guidance,
    files,
  };
}

function assertFileQuiescent(filePath, args) {
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, reason: "missing path argument" };
  }
  args = args || [];
  const settleMs = parseInt(_getFlag(args, "--settle-ms") || "500", 10);
  const timeoutMs = parseInt(_getFlag(args, "--timeout-ms") || "5000", 10);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(findProjectRoot(), filePath);
  if (!fs.existsSync(abs)) {
    return { ok: false, path: filePath, reason: `file does not exist: ${filePath}` };
  }
  const startMs = Date.now();
  let attempts = 0;
  let prev = null;
  while (Date.now() - startMs < timeoutMs) {
    attempts += 1;
    let cur;
    try {
      const st = fs.statSync(abs);
      cur = { size: st.size, mtimeMs: st.mtimeMs };
    } catch (e) {
      return { ok: false, path: filePath, attempts, reason: `stat failed: ${e.message}` };
    }
    if (prev !== null && prev.size === cur.size && prev.mtimeMs === cur.mtimeMs) {
      return {
        ok: true,
        path: filePath,
        size_bytes: cur.size,
        mtime_ms: cur.mtimeMs,
        attempts,
        settle_ms: settleMs,
        total_ms: Date.now() - startMs,
        reason: `file quiescent (size + mtime stable across ${settleMs}ms window)`,
      };
    }
    prev = cur;
    // Synchronous sleep — settle window is short (default 500ms) and the CLI
    // is single-purpose; busy-loop is acceptable and matches the existing
    // synchronous-CLI pattern used elsewhere in this module.
    const sleepEnd = Date.now() + settleMs;
    while (Date.now() < sleepEnd) { /* spin */ }
  }
  return {
    ok: false,
    path: filePath,
    attempts,
    settle_ms: settleMs,
    timeout_ms: timeoutMs,
    total_ms: Date.now() - startMs,
    reason: `file did not stabilize within ${timeoutMs}ms (still being written or system is slow). Workflows should either retry, increase --timeout-ms, OR proceed with sentinel warning.`,
  };
}

// Substance-check race fix — workflow-mechanical OPT-IN.
//
// SECONDARY mechanism — available for workflows that enforce explicit
// lane-status discipline (orchestrator advances lanes[].status from in_flight
// to a non-in_flight terminal state AFTER each Task() returns). When that
// discipline holds, this gate is stricter than mtime-stability because it
// rejects ANY in_flight lane regardless of file activity. When the discipline
// is loose (orchestrator might forget to update status), this gate gives a
// false sense of security — that's why mtime-stability is the PRIMARY default
// path; this gate is opt-in for workflows that own the lane lifecycle tightly.
//
// Returns: {ok, in_flight_count, terminal_count, lanes_in_flight, reason}.
function assertLanesQuiesced() {
  const { lanes } = listLaneOutputs();
  if (!Array.isArray(lanes) || lanes.length === 0) {
    return { ok: true, in_flight_count: 0, terminal_count: 0, reason: "no lanes registered — nothing to quiesce" };
  }
  const inFlight = [];
  const terminal = [];
  for (const lane of lanes) {
    if (!lane.id) continue;
    if (lane.status === "in_flight") {
      inFlight.push(lane.id);
    } else {
      terminal.push(lane.id);
    }
  }
  if (inFlight.length === 0) {
    return {
      ok: true,
      in_flight_count: 0,
      terminal_count: terminal.length,
      reason: `all ${terminal.length} lane(s) reached terminal status (substance_pass | stub_redispatched | deferred)`,
    };
  }
  return {
    ok: false,
    in_flight_count: inFlight.length,
    terminal_count: terminal.length,
    lanes_in_flight: inFlight,
    reason: `${inFlight.length} lane(s) still in_flight: ${inFlight.join(", ")}. Workflow must wait for all Task() calls to return AND advance lanes[].status away from in_flight before substance_check_lanes runs.`,
  };
}

// Council observability — gate-trace.jsonl entries for council Stages 2/3/4.
// Each council dispatch (advisor batch, peer-review batch, chairman) emits
// one record via the existing traceGate-style append so cal cycles can
// measure council usage patterns (sessions per workflow_type, advisor model
// distribution, clash rate via stage-4 outcomes).
//
// Usage:
//   state council-trace stage-2 --slug=<slug> [--model=<m>] [--advisor=<n>]
//   state council-trace stage-3 --slug=<slug>
//   state council-trace stage-4 --slug=<slug> [--verdict=converge|clash|dissent]
//
// All arguments are pass-through metadata; the CLI doesn't enforce shape so
// future stages or telemetry shapes can extend without a CLI change. workflow_id
// + workflow_type + phase come from workflow.yaml automatically (same enrichment
// path as persistGateTrace).
function councilTrace(stage, args) {
  if (!stage || typeof stage !== "string") {
    return { ok: false, reason: "missing stage argument (expected: stage-2 | stage-3 | stage-4 | <other>)" };
  }
  args = args || [];
  const meta = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 2) {
        meta[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        meta[a.slice(2)] = args[++i];
      }
    }
  }
  try {
    const dir = getStateDir();
    let workflowId = null, workflowType = null, phase = null;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const wfPath = path.join(dir, "workflow.yaml");
    if (fs.existsSync(wfPath)) {
      try {
        const yaml = fs.readFileSync(wfPath, "utf8");
        const idMatch = yaml.match(/^workflow_id:\s*"?([^"\n]+)"?\s*$/m);
        if (idMatch) workflowId = idMatch[1].trim();
        const typeMatch = yaml.match(/^workflow_type:\s*"?([^"\n]+)"?\s*$/m);
        if (typeMatch) workflowType = typeMatch[1].trim();
        const phaseMatch = yaml.match(/^phase:\s*"?([^"\n]+)"?\s*$/m);
        if (phaseMatch) phase = phaseMatch[1].trim();
      } catch { /* enrichment best-effort */ }
    }
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      source: "council",
      stage,
      ...meta,
      workflow_id: workflowId,
      workflow_type: workflowType,
      phase,
    });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    fs.appendFileSync(path.join(dir, "gate-trace.jsonl"), record + "\n");
    return { ok: true, stage, meta, workflow_id: workflowId, workflow_type: workflowType, phase, reason: `council-trace stage=${stage} recorded` };
  } catch (e) {
    return { ok: false, stage, reason: `trace append failed: ${e.message}` };
  }
}

// Council A — re-run prevention (offramp §4 anti-pattern).
// Checks whether a council transcript for the given decision slug already
// exists in .devt/state/council-{slug}-{timestamp}.md form. When --cooldown-
// days=N is set, only transcripts within the last N days count as "recent."
// Council transcripts live at the project state ROOT (cross-instance) so
// the cooldown is naturally shared across concurrent devt sessions.
//
// Returns ok:false when a transcript matches (blocks re-run by default);
// caller can opt out by passing --warn (changes verdict to ok:true with
// warn:true so workflow proceeds with a sentinel).
function assertCouncilNotRecent(slug, args) {
  if (!slug || typeof slug !== "string" || slug.length === 0) {
    return { ok: false, reason: "missing slug argument (expected: <decision-slug>)" };
  }
  args = args || [];
  const cooldownDays = parseInt(_getFlag(args, "--cooldown-days") || "0", 10);
  const warnMode = args.includes("--warn");
  const root = getStateRoot();
  let entries = [];
  try { entries = fs.readdirSync(root); } catch { return { ok: true, slug, reason: "no .devt/state/ root yet — no prior councils" }; }
  // Match files matching council-<slug>-*.md exactly (anchored on hyphen
  // boundary so similarly-prefixed slugs don't collide). The trailing
  // timestamp segment can be any non-slash; the .md suffix is required.
  const prefix = `council-${slug}-`;
  const matches = entries.filter((f) => f.startsWith(prefix) && f.endsWith(".md"));
  if (matches.length === 0) {
    return { ok: true, slug, matched_count: 0, reason: `no prior council transcript with slug "${slug}"` };
  }
  // Optional cooldown filter — only count transcripts within the last N days.
  let inWindow = matches;
  if (cooldownDays > 0) {
    const cutoffMs = Date.now() - cooldownDays * 86400 * 1000;
    inWindow = matches.filter((f) => {
      try {
        const stat = fs.statSync(path.join(root, f));
        return stat.mtimeMs >= cutoffMs;
      } catch { return false; }
    });
    if (inWindow.length === 0) {
      return { ok: true, slug, matched_count: 0, matches_outside_window: matches.length, cooldown_days: cooldownDays, reason: `${matches.length} prior transcript(s) found but all are older than ${cooldownDays} days — outside cooldown window` };
    }
  }
  const verdict = warnMode ? { ok: true, warn: true } : { ok: false };
  return {
    ...verdict,
    slug,
    matched_count: inWindow.length,
    matches: inWindow.map((f) => path.join(".devt", "state", f)),
    cooldown_days: cooldownDays > 0 ? cooldownDays : null,
    reason: `Prior council transcript(s) found for slug "${slug}": ${inWindow.join(", ")}. Surface the existing transcript instead of running a new council (offramp §4 anti-pattern: re-running wastes spend + risks contradictory verdicts). Pass --warn to proceed anyway with a sentinel.`,
  };
}

// Council C — validation_material helper.
// Takes paths and returns an annotated JSON array suitable for direct
// inclusion in advisor prompts. Each entry has {path, exists, size_bytes?,
// mtime?, content?}. Default mode emits EXISTS/MISSING tags only; with
// --inline=true, file contents are returned so the council orchestrator
// doesn't need to Read each file separately (token-economy win + closes
// the SKILL.md Stage 1 prose-only "check existence and tag" rule).
//
// Path-safety: each path is resolved relative to project root; absolute
// paths and ../ traversal are rejected.
function councilValidationMaterial(args) {
  args = args || [];
  const inline = args.includes("--inline") || args.includes("--inline=true");
  const maxBytes = parseInt(_getFlag(args, "--max-bytes-per-file") || "65536", 10);
  // Positional args are paths; flags are filtered out.
  const paths = args.filter((a) => !a.startsWith("--"));
  if (paths.length === 0) {
    return { ok: false, reason: "no paths provided" };
  }
  const root = findProjectRoot();
  const results = [];
  for (const p of paths) {
    if (typeof p !== "string" || p.length === 0) continue;
    // Reject path traversal — only project-relative paths allowed.
    if (path.isAbsolute(p) || p.includes("..")) {
      results.push({ path: p, exists: false, reason: "path rejected (absolute or contains ..)" });
      continue;
    }
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const abs = path.join(root, p);
    if (!fs.existsSync(abs)) {
      results.push({ path: p, exists: false });
      continue;
    }
    let stat;
    try { stat = fs.statSync(abs); }
    catch (e) { results.push({ path: p, exists: false, reason: `stat failed: ${e.message}` }); continue; }
    const entry = {
      path: p,
      exists: true,
      size_bytes: stat.size,
      mtime: new Date(stat.mtimeMs).toISOString(),
    };
    if (inline) {
      try {
        const content = fs.readFileSync(abs, "utf8");
        entry.content = content.length > maxBytes
          ? content.slice(0, maxBytes) + `\n[... truncated at ${maxBytes} bytes; original size ${stat.size} bytes ...]`
          : content;
        if (content.length > maxBytes) entry.truncated = true;
      } catch (e) {
        entry.read_error = e.message;
      }
    }
    results.push(entry);
  }
  return { ok: true, inline, max_bytes_per_file: maxBytes, count: results.length, entries: results };
}

// Council advisor diversity check.
// SKILL.md's "natural tensions" design depends on 5 advisors producing
// DIFFERENT Recommendations. When all 5 converge on identical text, the
// tensions weren't generated — either the prompt is too steering, the model
// inheritance is too aligned, or the question doesn't actually have viable
// alternatives. This gate detects the degenerate case and warns.
//
// Args:
//   <responses-dir>   — directory containing 5 advisor response .md files
//   --threshold=N     — number of identical Recommendations to trigger warn
//                       (default 4 — 4-of-5 collapsed counts as collapsed)
//
// Returns ok:true with diversity_score; ok:false when collapse detected.
function assertAdvisorDiversity(args) {
  args = args || [];
  const positional = args.filter((a) => !a.startsWith("--"));
  const dir = positional[0];
  const threshold = parseInt(_getFlag(args, "--threshold") || "4", 10);
  if (!dir || typeof dir !== "string") {
    return { ok: false, reason: "missing responses-dir argument" };
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const abs = path.isAbsolute(dir) ? dir : path.join(findProjectRoot(), dir);
  if (!fs.existsSync(abs)) {
    return { ok: false, reason: `responses dir not found: ${dir}` };
  }
  let entries = [];
  try { entries = fs.readdirSync(abs).filter((f) => f.endsWith(".md")); }
  catch (e) { return { ok: false, reason: `read failed: ${e.message}` }; }
  if (entries.length < 2) {
    return { ok: true, advisor_count: entries.length, reason: "fewer than 2 advisor responses — diversity check not applicable" };
  }
  // Extract the body of the "## Recommendation" section from each file.
  // The section ends at the next "##" heading or end-of-file.
  const recommendations = [];
  for (const f of entries) {
    try {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const content = fs.readFileSync(path.join(abs, f), "utf8");
      const recMatch = content.match(/##\s+Recommendation\s*\n([\s\S]*?)(?=\n##\s|\n$|$)/i);
      if (recMatch) {
        // Normalize: lowercase, collapse whitespace, strip leading/trailing.
        const normalized = recMatch[1].toLowerCase().replace(/\s+/g, " ").trim();
        recommendations.push({ file: f, recommendation: normalized });
      } else {
        recommendations.push({ file: f, recommendation: null, missing_section: true });
      }
    } catch (e) {
      recommendations.push({ file: f, error: e.message });
    }
  }
  // Count identical Recommendations.
  const counts = new Map();
  for (const r of recommendations) {
    if (r.recommendation === null || r.error) continue;
    counts.set(r.recommendation, (counts.get(r.recommendation) || 0) + 1);
  }
  let maxCount = 0, dominantRec = null;
  for (const [rec, n] of counts) {
    if (n > maxCount) { maxCount = n; dominantRec = rec; }
  }
  const diversityScore = recommendations.length > 0 ? (counts.size / recommendations.length) : 0;
  if (maxCount >= threshold) {
    return {
      ok: false,
      advisor_count: recommendations.length,
      max_identical: maxCount,
      threshold,
      diversity_score: parseFloat(diversityScore.toFixed(2)),
      dominant_recommendation: dominantRec && dominantRec.slice(0, 200),
      reason: `${maxCount} of ${recommendations.length} advisors returned identical Recommendation — natural-tensions design (Contrarian ⇄ Generalizer, First Principles ⇄ Pragmatist) didn't generate. Check: prompt steering, model alignment, or whether the question actually has viable alternatives. Surface this to the user before accepting the chairman verdict.`,
    };
  }
  return {
    ok: true,
    advisor_count: recommendations.length,
    max_identical: maxCount,
    threshold,
    diversity_score: parseFloat(diversityScore.toFixed(2)),
    reason: `advisor diversity acceptable (${maxCount} of ${recommendations.length} identical; threshold ${threshold})`,
  };
}

// Council L — soft-cap enforcement (offramp §4 anti-pattern).
// Counts council stage-4 emits (one per completed council) in the current
// workflow window via gate-trace.jsonl records written by councilTrace.
// Returns ok:false when count >= max-per-workflow (default 1).
//
// The workflow window is anchored at workflow.yaml::first_created_at,
// matching the per-workflow filtering used by assertClaimChecksResolved.
function assertCouncilBudget(args) {
  args = args || [];
  const max = parseInt(_getFlag(args, "--max-per-workflow") || "1", 10);
  const dir = getStateDir();
  // Anchor on workflow.yaml::first_created_at to scope the count to the
  // current workflow window. Without an anchor, all prior records would
  // count and the gate would always block.
  let anchorMs = 0;
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const wfPath = path.join(dir, "workflow.yaml");
    if (fs.existsSync(wfPath)) {
      const yaml = fs.readFileSync(wfPath, "utf8");
      const m = yaml.match(/^first_created_at:\s*"?([^"\n]+)"?\s*$/m);
      if (m) {
        const parsed = new Date(m[1].trim()).getTime();
        if (Number.isFinite(parsed)) anchorMs = parsed;
      }
    }
  } catch { /* no anchor — gate auto-passes */ }
  if (anchorMs === 0) {
    return { ok: true, count: 0, max, reason: "workflow.yaml::first_created_at absent — no anchor for windowing; gate inapplicable" };
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const tracePath = path.join(dir, "gate-trace.jsonl");
  if (!fs.existsSync(tracePath)) {
    return { ok: true, count: 0, max, reason: "no gate-trace.jsonl in window — zero councils run" };
  }
  let count = 0;
  try {
    const lines = fs.readFileSync(tracePath, "utf8").split("\n");
    for (const line of lines) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.source !== "council") continue;
        if (rec.stage !== "stage-4") continue; // stage-4 = chairman = completed council
        if (!rec.ts) continue;
        if (new Date(rec.ts).getTime() < anchorMs) continue;
        count += 1;
      } catch { /* malformed line — skip */ }
    }
  } catch { /* read failure — count stays 0 */ }
  if (count >= max) {
    return {
      ok: false,
      count,
      max,
      reason: `${count} council(s) already completed in this workflow window — soft-cap is ${max} per offramp §4 anti-pattern (cumulative time + fatigue). Surface deferred decisions or strategic-analysis prompts instead of running another council. Override with --max-per-workflow=<higher-N> if the case genuinely warrants.`,
    };
  }
  return {
    ok: true,
    count,
    max,
    reason: `${count} of ${max} council budget used in this workflow window`,
  };
}

// Arch scanner observability — gate-trace.jsonl entries for arch-health-scan
// events. Mirrors the council-trace pattern: each significant scan event
// emits one record with workflow_id/workflow_type/phase enrichment so cal
// cycles can measure scanner usage patterns (detector firing rates, finding
// counts over time, false-positive trends).
//
// Usage:
//   state arch-scan-trace scan-start --scan-id=<id> [--scanner=<cmd>]
//   state arch-scan-trace scan-complete --scan-id=<id> --finding-count=N
//                                       [--severity-dist=JSON]
//                                       [--baseline-delta=N]
//   state arch-scan-trace triage --scan-id=<id> --classification=<class>
//
// All --flag=value args land in the record verbatim; future event shapes
// extend without a CLI change.
function archScanTrace(event, args) {
  if (!event || typeof event !== "string") {
    return { ok: false, reason: "missing event argument (expected: scan-start | scan-complete | triage | <other>)" };
  }
  args = args || [];
  const meta = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 2) {
        meta[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        meta[a.slice(2)] = args[++i];
      }
    }
  }
  try {
    const dir = getStateDir();
    let workflowId = null, workflowType = null, phase = null;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const wfPath = path.join(dir, "workflow.yaml");
    if (fs.existsSync(wfPath)) {
      try {
        const yaml = fs.readFileSync(wfPath, "utf8");
        const idMatch = yaml.match(/^workflow_id:\s*"?([^"\n]+)"?\s*$/m);
        if (idMatch) workflowId = idMatch[1].trim();
        const typeMatch = yaml.match(/^workflow_type:\s*"?([^"\n]+)"?\s*$/m);
        if (typeMatch) workflowType = typeMatch[1].trim();
        const phaseMatch = yaml.match(/^phase:\s*"?([^"\n]+)"?\s*$/m);
        if (phaseMatch) phase = phaseMatch[1].trim();
      } catch { /* enrichment best-effort */ }
    }
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      source: "arch_scan",
      event,
      ...meta,
      workflow_id: workflowId,
      workflow_type: workflowType,
      phase,
    });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    fs.appendFileSync(path.join(dir, "gate-trace.jsonl"), record + "\n");
    return { ok: true, event, meta, workflow_id: workflowId, workflow_type: workflowType, phase, reason: `arch-scan-trace event=${event} recorded` };
  } catch (e) {
    return { ok: false, event, reason: `trace append failed: ${e.message}` };
  }
}

// Arch scanner freshness check — closes the "many subcommands declared but
// few exercised by workflows" pattern. When wired into /devt:review's
// context_init, surfaces a [STALE-ARCH-SCAN] sentinel if the
// arch-scan-report.md is older than --max-age-hours (default 24) —
// orchestrator can decide whether to surface to user or proceed silently.
//
// Returns ok:true + warn:true on stale; ok:true + warn:false on fresh; ok:false
// only on missing report (advisory-only gate by default).
function assertArchScanFresh(args) {
  args = args || [];
  const maxAgeHours = parseInt(_getFlag(args, "--max-age-hours") || "24", 10);
  const blockOnStale = args.includes("--block");
  // arch-scan-report.md is workflow-output but currently written to the
  // legacy state root by the python-fastapi convention. Check BOTH the
  // per-instance dir (where future runs may write) and the legacy root.
  const candidates = [
    path.join(getStateDir(), "arch-scan-report.md"),
    path.join(getStateRoot(), "arch-scan-report.md"),
  ];
  let reportPath = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { reportPath = p; break; }
  }
  if (!reportPath) {
    return {
      ok: false,
      reason: "arch-scan-report.md not found in either per-instance dir or legacy root — no arch scan has run for this project. Suggest /devt:review --focus=arch before review.",
    };
  }
  let mtime;
  try { mtime = fs.statSync(reportPath).mtimeMs; }
  catch (e) { return { ok: false, reason: `stat failed: ${e.message}` }; }
  const ageHours = (Date.now() - mtime) / (1000 * 3600);
  const fresh = ageHours <= maxAgeHours;
  if (!fresh && blockOnStale) {
    return {
      ok: false,
      report_path: reportPath,
      age_hours: parseFloat(ageHours.toFixed(1)),
      max_age_hours: maxAgeHours,
      reason: `arch-scan-report.md is ${ageHours.toFixed(1)}h old (limit ${maxAgeHours}h with --block). Re-run /devt:review --focus=arch before review.`,
    };
  }
  return {
    ok: true,
    warn: !fresh,
    report_path: reportPath,
    age_hours: parseFloat(ageHours.toFixed(1)),
    max_age_hours: maxAgeHours,
    reason: fresh
      ? `arch-scan-report.md fresh (${ageHours.toFixed(1)}h old, limit ${maxAgeHours}h)`
      : `arch-scan-report.md is ${ageHours.toFixed(1)}h old (advisory — exceeds ${maxAgeHours}h fresh window). Review may miss recent architectural drift; consider /devt:review --focus=arch refresh.`,
  };
}

// verification-patterns Level 3 (Wired) — mechanical check that a symbol
// is imported AND called somewhere besides its definition site.
//
// Closes the SKILL.md Level 3 ("Connected to the rest of the system") which
// is currently prose-only — verifier reads the prose and checks by eye.
// CLI verb gives the verifier mechanical evidence: grep for imports +
// callers; return ok:false when zero references outside the definition.
//
// Args:
//   <symbol>          — symbol name to check (e.g. "AuthService", "process_payment")
//   --lang=python|ts  — language hint for grep pattern selection (auto-detect default)
//   --exclude-self    — pass to grep --invert-match against the definition file
//   --min-references=N — required minimum reference count outside definition (default 1)
//
// Returns: {ok, symbol, reference_count, locations: [path], reason}
// ok:false when reference_count < min_references (symbol is dead code or unwired).
function assertWired(symbol, args) {
  if (!symbol || typeof symbol !== "string" || symbol.length === 0) {
    return { ok: false, reason: "missing symbol argument" };
  }
  args = args || [];
  const minRefs = parseInt(_getFlag(args, "--min-references") || "1", 10);
  const lang = _getFlag(args, "--lang") || "auto";
  // Reject obvious injection attempts in symbol arg.
  if (!/^[A-Za-z_][\w.]*$/.test(symbol)) {
    return { ok: false, symbol, reason: `symbol "${symbol}" contains non-identifier characters — rejected for safety` };
  }
  // Language-aware include patterns.
  const langIncludes = {
    python: ["*.py"],
    ts: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.cjs", "*.mjs"],
    js: ["*.js", "*.jsx", "*.cjs", "*.mjs"],
    go: ["*.go"],
    rust: ["*.rs"],
    auto: ["*.py", "*.ts", "*.tsx", "*.js", "*.jsx", "*.cjs", "*.mjs", "*.go", "*.rs", "*.java"],
  };
  const includes = langIncludes[lang] || langIncludes.auto;
  const root = findProjectRoot();
  // Use git ls-files when available (fast + respects gitignore), fall back
  // to fs.readdirSync recursion. Use Node-native grep via fs.readFileSync —
  // avoids shelling out and the BRE alternation grep trap.
  let files = [];
  try {
    const { execSync } = require("child_process");
    const out = execSync("git ls-files", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    files = out.split("\n").filter(Boolean);
  } catch {
    return { ok: false, symbol, reason: "git ls-files unavailable — repo must be a git working tree for assert-wired" };
  }
  // Filter by extension.
  const extOk = files.filter((f) => includes.some((g) => f.endsWith(g.replace("*", ""))));
  // Symbol pattern: word-boundary on either side. We match exact identifier.
  const symRe = new RegExp(`\\b${symbol.replace(/[.\\]/g, "\\$&")}\\b`);
  const matches = [];
  for (const f of extOk) {
    let content;
    try { content = fs.readFileSync(path.join(root, f), "utf8"); }
    catch { continue; }
    if (symRe.test(content)) matches.push(f);
    if (matches.length > 200) break; // cap result size
  }
  const refCount = matches.length;
  if (refCount < minRefs) {
    return {
      ok: false,
      symbol,
      reference_count: refCount,
      min_references: minRefs,
      locations: matches,
      reason: `Symbol "${symbol}" found in ${refCount} file(s) — below minimum ${minRefs}. Likely dead code or unwired implementation. Verify the symbol is imported and called from elsewhere before claiming Level 3 (Wired).`,
    };
  }
  return {
    ok: true,
    symbol,
    reference_count: refCount,
    min_references: minRefs,
    locations: matches.slice(0, 20),
    reason: `Symbol "${symbol}" found in ${refCount} file(s) — Level 3 (Wired) verified`,
  };
}

// verification-patterns Level 5 (Scope Completeness) — mechanical extraction
// of requirements from spec/plan + check for implementation evidence per
// requirement.
//
// Closes the SKILL.md Level 5 ("Did the implementation cover ALL requirements,
// or was scope silently reduced?") — currently prose-only and verifier
// re-extracts requirements by eye each time.
//
// Args (flags):
//   --spec=<path>          — spec file to extract requirements from (default .devt/state/spec.md)
//   --impl-summary=<path>  — implementation summary to check for evidence (default impl-summary.md)
//   --requirement-pattern  — regex for requirement markers in spec (default: "(?:^|\n)(?:- |\\d+\\. |\\* )")
//
// Approach: extract requirement bullets from the spec; for each, check if
// any keywords (3+ chars, deduped) appear in the impl-summary. Returns the
// requirement-to-evidence mapping plus a SCOPE_REDUCED list when evidence
// is missing. Conservative heuristic — false-positives are acceptable;
// false-negatives (claimed complete when incomplete) are the failure mode
// we're guarding against.
function assertScopeComplete(args) {
  args = args || [];
  const specPath = _getFlag(args, "--spec") || ".devt/state/spec.md";
  const implPath = _getFlag(args, "--impl-summary") || "impl-summary.md";
  // Resolve relative to per-instance state dir when applicable.
  const dir = getStateDir();
  const root = findProjectRoot();
  // Spec: try state-dir first, then project root (where plan.md may also live).
  const resolveCandidate = (p) => {
    if (path.isAbsolute(p)) return p;
    const candidates = [
      path.join(dir, p),
      path.join(root, p),
      path.join(dir, path.basename(p)),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  };
  const specAbs = resolveCandidate(specPath);
  const implAbs = resolveCandidate(implPath);
  if (!specAbs) {
    return { ok: true, reason: `spec file not found at ${specPath} — scope-completeness check inapplicable (no scope contract to verify against)` };
  }
  if (!implAbs) {
    return { ok: false, reason: `impl-summary file not found at ${implPath} — cannot verify scope completeness without implementation evidence` };
  }
  let specBody, implBody;
  try { specBody = fs.readFileSync(specAbs, "utf8"); }
  catch (e) { return { ok: false, reason: `read spec failed: ${e.message}` }; }
  try { implBody = fs.readFileSync(implAbs, "utf8"); }
  catch (e) { return { ok: false, reason: `read impl-summary failed: ${e.message}` }; }
  // Extract requirement-shaped lines: top-level bullets / numbered lines.
  const reqs = [];
  const lines = specBody.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*(?:-|\d+\.|\*)\s+(.{15,})/); // ≥15 chars to skip headers
    if (m) {
      const text = m[1].trim();
      // Skip lines that look like meta-formatting or are too short for real requirements
      if (text.length < 15) continue;
      if (/^(?:see|todo|note|example)\b/i.test(text)) continue;
      reqs.push({ line_no: i + 1, text });
    }
  }
  if (reqs.length === 0) {
    return { ok: true, reason: `no requirement-shaped bullets found in spec — scope-completeness check inapplicable` };
  }
  // Per-requirement keyword extraction + impl evidence check.
  const implLower = implBody.toLowerCase();
  const STOPWORDS = new Set(["the", "and", "for", "this", "that", "with", "from", "into", "must", "should", "will", "can", "all", "any", "are", "was", "have", "has", "but", "not", "use"]);
  const checked = [];
  const missing = [];
  for (const r of reqs) {
    const words = r.text.toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
    const uniq = [...new Set(words)];
    if (uniq.length === 0) continue;
    // Evidence rule: at least one keyword from the requirement appears in
    // the impl-summary. This is conservative — false positives possible
    // (keyword in unrelated context), but false negatives (missed scope)
    // are the failure mode we guard against more strictly.
    const matches = uniq.filter((w) => implLower.includes(w));
    const evidenceFound = matches.length > 0;
    checked.push({ line_no: r.line_no, text: r.text.slice(0, 100), evidence_found: evidenceFound, matched_keywords: matches.slice(0, 5) });
    if (!evidenceFound) missing.push({ line_no: r.line_no, text: r.text.slice(0, 100) });
  }
  if (missing.length > 0) {
    return {
      ok: false,
      total_requirements: reqs.length,
      checked: checked.length,
      missing_count: missing.length,
      missing,
      reason: `${missing.length} of ${reqs.length} requirements have no keyword evidence in impl-summary.md — SCOPE_REDUCED candidates. Verify each is implemented or document the scope reduction explicitly before claiming DONE. (Conservative heuristic — review each entry; false positives possible if implementation uses synonyms.)`,
    };
  }
  return {
    ok: true,
    total_requirements: reqs.length,
    checked: checked.length,
    missing_count: 0,
    reason: `All ${reqs.length} requirement bullets have keyword evidence in impl-summary — scope-completeness Level 5 verified (conservative heuristic; review the impl-summary qualitatively for actual coverage)`,
  };
}

// autoskill REJ-tombstone check — closes the SKILL.md HARD RULE
// ("Before generating ANY proposal, query the rejected-keywords list...").
//
// Reads `node bin/devt-tools.cjs memory rejected-keywords` output (the list
// of search_keywords from REJ tombstones), then scans the supplied proposal
// text for case-insensitive substring matches. Returns ok:false (rejection)
// when any keyword matches — the proposal should be silently suppressed per
// SKILL.md.
//
// Args:
//   <text>             — proposal text to scan (positional)
//   --from-file=<path> — read proposal text from file instead
//   --list-only        — return the rejected-keywords list without scanning
function autoskillRejCheck(args) {
  args = args || [];
  const listOnly = args.includes("--list-only");
  const fromFile = _getFlag(args, "--from-file");
  const positional = args.filter((a) => !a.startsWith("--"));
  let proposalText = positional.join(" ");
  if (fromFile) {
    if (path.isAbsolute(fromFile) || fromFile.includes("..")) {
      return { ok: false, reason: `path "${fromFile}" rejected (absolute or contains ..)` };
    }
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const abs = path.join(findProjectRoot(), fromFile);
    if (!fs.existsSync(abs)) {
      return { ok: false, reason: `from-file ${fromFile} not found` };
    }
    try { proposalText = fs.readFileSync(abs, "utf8"); }
    catch (e) { return { ok: false, reason: `read failed: ${e.message}` }; }
  }
  // Pull the rejected-keywords list via the memory module — same path the
  // existing `memory rejected-keywords` CLI subcommand uses. The function
  // is exported as `listRejectedKeywords` in memory.cjs; falls back to the
  // `run("rejected-keywords")` dispatcher when the direct export is absent
  // (e.g. older memory module shape).
  let keywords = [];
  try {
    const memory = require("./memory.cjs");
    let res = null;
    if (typeof memory.listRejectedKeywords === "function") {
      res = memory.listRejectedKeywords();
    } else if (typeof memory.run === "function") {
      res = memory.run("rejected-keywords", []);
    }
    if (res && Array.isArray(res.keywords)) {
      keywords = res.keywords;
    } else if (Array.isArray(res)) {
      keywords = res;
    } else if (res && Array.isArray(res.rejected_keywords)) {
      keywords = res.rejected_keywords;
    }
  } catch { /* memory module unavailable — return empty list path */ }
  if (listOnly) {
    return { ok: true, keyword_count: keywords.length, keywords };
  }
  if (!proposalText || proposalText.length === 0) {
    return { ok: false, reason: "missing proposal text — pass as positional arg OR --from-file=<path>" };
  }
  // Case-insensitive substring match per HARD RULE wording.
  const lower = proposalText.toLowerCase();
  const matches = [];
  for (const kw of keywords) {
    if (!kw || typeof kw !== "string") continue;
    const kwLower = kw.toLowerCase();
    if (lower.includes(kwLower)) matches.push(kw);
  }
  if (matches.length > 0) {
    return {
      ok: false,
      matched_keywords: matches,
      reason: `Proposal text matches ${matches.length} REJ-tombstone keyword(s): ${matches.join(", ")}. Per SKILL.md HARD RULE: SUPPRESS this proposal silently — do not surface to user. Rejected ideas should never resurface regardless of rephrasing.`,
    };
  }
  return {
    ok: true,
    keyword_count: keywords.length,
    reason: `proposal text clears ${keywords.length} REJ-tombstone keyword(s) — ok to surface`,
  };
}

// graphify-helpers Hard Invariant #2 enforcement — verifies the consuming
// skill tagged `source: "graphify"|"grep"|"merged"` in its output.
//
// SKILL.md line ~207: "Result tagging is mandatory. Every output from this
// skill (or skills consuming it) MUST include source." — currently
// prose-only. CLI verb checks an arbitrary output file for the source field.
//
// Returns ok:false when the file exists but lacks a source tag.
function assertGraphifySourceTagged(filePath, args) {
  args = args || [];
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, reason: "missing file path argument" };
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const abs = path.isAbsolute(filePath) ? filePath : path.join(findProjectRoot(), filePath);
  if (!fs.existsSync(abs)) {
    return { ok: false, file: filePath, reason: `file does not exist: ${filePath}` };
  }
  let content;
  try { content = fs.readFileSync(abs, "utf8"); }
  catch (e) { return { ok: false, file: filePath, reason: `read failed: ${e.message}` }; }
  // Accept either JSON-shape `"source":"graphify"` (closing quote between
  // key and colon) or markdown prose `source: graphify` or `[source:
  // graphify]` etc. The Hard Invariant says the tag must be present and
  // identifiable. The optional `["']?` BEFORE the colon handles JSON's
  // quoted-key form.
  const sourceMatch = content.match(/source["']?\s*[:=]\s*["']?(graphify|grep|merged)["']?/i);
  if (!sourceMatch) {
    return {
      ok: false,
      file: filePath,
      reason: `file does not contain a graphify source tag. Hard Invariant #2 (graphify-helpers SKILL.md): "Every output ... MUST include source: 'graphify'|'grep'|'merged'". Add the source tag so downstream agents can debug provenance.`,
    };
  }
  return {
    ok: true,
    file: filePath,
    source: sourceMatch[1].toLowerCase(),
    reason: `source tag present: ${sourceMatch[1]}`,
  };
}

// graphify-helpers fallback-trace observability. Mirrors council-trace +
// arch-scan-trace patterns. Records which fallback trigger fired and which
// consuming skill invoked graphify, so cal cycles can measure fallback
// rates (high empty-result rate suggests under-resolved queries; high
// not-setup rate suggests graphify install adoption is low; etc.).
//
// Usage:
//   state graphify-fallback-trace <trigger> --skill=<name> [--operation=<op>]
//
// trigger ∈ {empty | error | not_setup | below_threshold | none}
//   none = no fallback fired (pure graphify result) — also worth tracking
function graphifyFallbackTrace(trigger, args) {
  if (!trigger || typeof trigger !== "string") {
    return { ok: false, reason: "missing trigger argument (expected: empty | error | not_setup | below_threshold | none)" };
  }
  args = args || [];
  const meta = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 2) {
        meta[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        meta[a.slice(2)] = args[++i];
      }
    }
  }
  try {
    const dir = getStateDir();
    let workflowId = null, workflowType = null, phase = null;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const wfPath = path.join(dir, "workflow.yaml");
    if (fs.existsSync(wfPath)) {
      try {
        const yaml = fs.readFileSync(wfPath, "utf8");
        const idMatch = yaml.match(/^workflow_id:\s*"?([^"\n]+)"?\s*$/m);
        if (idMatch) workflowId = idMatch[1].trim();
        const typeMatch = yaml.match(/^workflow_type:\s*"?([^"\n]+)"?\s*$/m);
        if (typeMatch) workflowType = typeMatch[1].trim();
        const phaseMatch = yaml.match(/^phase:\s*"?([^"\n]+)"?\s*$/m);
        if (phaseMatch) phase = phaseMatch[1].trim();
      } catch { /* best-effort */ }
    }
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      source: "graphify_fallback",
      trigger,
      ...meta,
      workflow_id: workflowId,
      workflow_type: workflowType,
      phase,
    });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    fs.appendFileSync(path.join(dir, "gate-trace.jsonl"), record + "\n");
    return { ok: true, trigger, meta, reason: `graphify-fallback-trace trigger=${trigger} recorded` };
  } catch (e) {
    return { ok: false, trigger, reason: `trace append failed: ${e.message}` };
  }
}

// Multi-instance state isolation — instance management CLIs.
//
// newInstance(): generates a fresh 8-character hex ID (truncated UUID v4),
// creates the per-instance subdirectory at .devt/state/<id>/, writes an
// index entry at .devt/state/.instances/<id>.json. Prints the ID to stdout
// so users can capture it via shell substitution:
//   export DEVT_WORKFLOW_ID=$(devt-tools state new-instance)
//
// Optional --tag=<short label> records a user-friendly label in the index
// entry for the discovery flow (state list-instances).
function newInstance(args) {
  args = args || [];
  const tag = _getFlag(args, "--tag") || null;
  const uuid = require("crypto").randomUUID();
  const id = uuid.split("-")[0]; // 8-char hex from the first UUID segment
  const root = getStateRoot();
  const instanceDir = path.join(root, id);
  const indexDir = path.join(root, ".instances");
  const indexPath = path.join(indexDir, `${id}.json`);
  try {
    fs.mkdirSync(instanceDir, { recursive: true });
    fs.mkdirSync(indexDir, { recursive: true });
    const entry = {
      wf_id: id,
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
      tag,
    };
    fs.writeFileSync(indexPath, JSON.stringify(entry, null, 2));
  } catch (e) {
    return { ok: false, reason: `instance creation failed: ${e.message}` };
  }
  // Returns JSON like all state subcommands. Typical shell capture:
  //   export DEVT_WORKFLOW_ID=$(devt-tools state new-instance | jq -r .wf_id)
  return { ok: true, wf_id: id, instance_dir: instanceDir, index_entry: indexPath, tag };
}

// listInstances(): enumerates all instance subdirectories under .devt/state/
// and returns a structured table with {wf_id, created_at, last_active, phase,
// tag, file_count}. The phase comes from each instance's workflow.yaml; tag
// from the index entry; file_count helps the user identify which instance
// has the most activity.
function listInstances() {
  const root = getStateRoot();
  const indexDir = path.join(root, ".instances");
  const instances = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return { ok: true, instances: [], reason: "no .devt/state/ root yet" }; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue; // skip .archive, .instances, etc.
    if (!_INSTANCE_ID_PATTERN.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    let phase = null, createdAt = null, lastActive = null, tag = null, fileCount = 0;
    try {
      const wfPath = path.join(dir, "workflow.yaml");
      if (fs.existsSync(wfPath)) {
        const yaml = fs.readFileSync(wfPath, "utf8");
        const phaseMatch = yaml.match(/^phase:\s*"?([^"\n]+)"?\s*$/m);
        if (phaseMatch) phase = phaseMatch[1].trim();
        const createdMatch = yaml.match(/^created_at:\s*"?([^"\n]+)"?\s*$/m);
        if (createdMatch) createdAt = createdMatch[1].trim();
        const stat = fs.statSync(wfPath);
        lastActive = new Date(stat.mtimeMs).toISOString();
      }
      // Read index entry for tag + canonical created_at
      const idxPath = path.join(indexDir, `${entry.name}.json`);
      if (fs.existsSync(idxPath)) {
        try {
          const idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));
          if (idx.tag) tag = idx.tag;
          if (!createdAt && idx.created_at) createdAt = idx.created_at;
        } catch { /* malformed index — ignore */ }
      }
      fileCount = fs.readdirSync(dir).filter((f) => !f.startsWith(".")).length;
    } catch { /* per-instance read failures are non-fatal */ }
    instances.push({ wf_id: entry.name, created_at: createdAt, last_active: lastActive, phase, tag, file_count: fileCount });
  }
  // Sort newest last_active first so the discovery flow shows the recently-
  // touched instances at the top.
  instances.sort((a, b) => {
    const aMs = a.last_active ? Date.parse(a.last_active) : 0;
    const bMs = b.last_active ? Date.parse(b.last_active) : 0;
    return bMs - aMs;
  });
  return { ok: true, instances, count: instances.length };
}

// Layer-2 persistence helper for assertArtifactPresent results. Every
// Layer-1 call appends a record so Layer-2 (assertClaimChecksResolved) can
// compute per-agent latest verdict at finalize. Last write per agent in
// window wins — successful re-runs after a failure RESOLVE the failure (the
// orchestrator re-dispatched). Fail-open: jsonl write errors are silenced
// (matches dispatch-warnings.jsonl pattern — forensic best-effort, never
// affect the caller).
// Unified gate-trace.jsonl observability. Every assert-* CLI subcommand
// appends one record so there is a single source of truth for "did gate X
// fire? what verdict? when?". Complements the per-class jsonls
// (dispatch-warnings, claim-check-failures) without duplicating them — those
// carry rich per-gate forensic data; this carries the firing-rate + verdict
// timeline.
//
// Verdict derivation: ok:true → "ok"; ok:true + warn:true → "warn"; ok:false
// → "fail". Mirrors the standard {ok, warn?, reason} shape every gate returns.
// Fail-open persistence (matches dispatch-warnings.jsonl pattern).
// YAML parser for workflows/_phase-gates.yaml. Zero-dep purpose-built parser
// mirroring dispatch.cjs::parseIoContracts. Schema:
//   workflow_types:
//     <workflow_type>:
//       <phase>:
//         gates:
//           - <gate-name>
function parsePhaseGatesYaml(content) {
  const lines = content.split("\n");
  const result = { workflow_types: {} };
  let currentType = null;
  let currentPhase = null;
  let inGates = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0 && trimmed === "workflow_types:") continue;
    if (indent === 2 && trimmed.endsWith(":")) {
      currentType = trimmed.slice(0, -1);
      result.workflow_types[currentType] = {};
      currentPhase = null;
      inGates = false;
    } else if (indent === 4 && trimmed.endsWith(":") && currentType) {
      currentPhase = trimmed.slice(0, -1);
      result.workflow_types[currentType][currentPhase] = { gates: [] };
      inGates = false;
    } else if (indent === 6 && trimmed === "gates:" && currentPhase) {
      inGates = true;
    } else if (indent === 8 && trimmed.startsWith("- ") && inGates && currentPhase) {
      const gate = trimmed.slice(2).trim();
      result.workflow_types[currentType][currentPhase].gates.push(gate);
    }
  }
  return result;
}

// Runtime gate enforcement. `state advance-phase <phase> [key=value ...]`
// reads the workflow_type from workflow.yaml, looks up gates for the target
// phase in _phase-gates.yaml, runs each gate via the existing assert-*
// functions, and refuses to advance on any failure. Throws on block
// (devt-tools.cjs outer catch exits 1).
//
// Phases NOT in the registry → falls through to a plain phase update,
// preserving backwards compatibility. Gates NOT recognized → reported as
// blocking failures (catches typos in the YAML).
//
// Every gate firing logs to gate-trace.jsonl via persistGateTrace, with
// gate name prefixed by "advance-phase:" so consumers can distinguish
// transition-time gates from manual one-off gate runs.
// Shared phase-gate runner. Extracted from advanceState so
// `updateState` can fire gates when `state update phase=X status=DONE` is
// called directly (devt's own workflow files lean heavily on `state update`
// over `state advance-phase`, so without this extraction gates in
// _phase-gates.yaml would be dead for most phase transitions). Pure: reads
// YAML + dispatches GATE_FNS; caller decides what to do with blockedBy.
//
// Returns one of:
//   {fired:false, note:"<reason>"}  — workflow_type missing / YAML absent /
//                                     no gates declared for (workflow_type,
//                                     targetPhase); caller should proceed
//                                     with plain write
//   {fired:true, gateResults:[...], blockedBy:[...]} — gates ran; caller
//                                     decides whether to refuse the write
//                                     based on blockedBy.length
const PHASE_GATE_FNS_MEMO = { value: null };
function _phaseGateFns() {
  if (PHASE_GATE_FNS_MEMO.value) return PHASE_GATE_FNS_MEMO.value;
  PHASE_GATE_FNS_MEMO.value = {
    "assert-claim-checks-resolved": assertClaimChecksResolved,
    "assert-no-raw-dispatches-this-session": assertNoRawDispatchesThisSession,
    "assert-knowledge-candidates-tagged": assertKnowledgeCandidatesTagged,
    "assert-auto-curator-considered": assertAutoCuratorConsidered,
    "assert-verifier-ran": assertVerifierRan,
    "assert-graphify-decision": assertGraphifyDecision,
    "assert-preflight-fresh": assertPreflightFresh,
    "assert-claude-mem-harvest": assertClaudeMemHarvest,
    "assert-scope-check-handled": assertScopeCheckHandled,
    "assert-lanes-registered": assertLanesRegistered,
    "assert-consolidator-dispatched": assertConsolidatorDispatched,
    "assert-reuse-analyzed": assertReuseAnalyzed,
  };
  return PHASE_GATE_FNS_MEMO.value;
}
function runPhaseGates(workflowType, targetPhase, { tracePrefix = "advance-phase" } = {}) {
  if (!workflowType) return { fired: false, note: "no workflow_type set" };
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const yamlPath = path.join(__dirname, "..", "..", "workflows", "_phase-gates.yaml");
  if (!fs.existsSync(yamlPath)) return { fired: false, note: "_phase-gates.yaml absent" };
  let registry;
  try { registry = parsePhaseGatesYaml(fs.readFileSync(yamlPath, "utf8")); }
  catch (e) { throw new Error(`runPhaseGates: registry load failed: ${e.message}`); }
  const phaseEntry = registry.workflow_types[workflowType] && registry.workflow_types[workflowType][targetPhase];
  const gates = (phaseEntry && Array.isArray(phaseEntry.gates)) ? phaseEntry.gates : [];
  if (gates.length === 0) return { fired: false, note: `no gates declared for ${workflowType}.${targetPhase}` };
  const fns = _phaseGateFns();
  const gateResults = [];
  const blockedBy = [];
  for (const gateName of gates) {
    const fn = fns[gateName];
    let result;
    if (!fn) {
      result = { ok: false, reason: `unknown gate name in registry: ${gateName} (typo in _phase-gates.yaml or missing GATE_FNS entry)` };
    } else {
      try { result = fn(); }
      catch (e) { result = { ok: false, reason: `gate ${gateName} threw: ${e.message}` }; }
    }
    persistGateTrace(`${tracePrefix}:${gateName}`, result);
    gateResults.push({ gate: gateName, ok: !!result.ok, reason: result.reason || "" });
    if (result.ok === false) blockedBy.push({ gate: gateName, reason: result.reason || "" });
  }
  return { fired: true, gateResults, blockedBy };
}

function advanceState(targetPhase, kvUpdates) {
  if (typeof targetPhase !== "string" || !targetPhase) {
    throw new Error("advance-phase: missing target phase argument (Usage: state advance-phase <phase> [key=value ...])");
  }
  let current;
  try { current = readState(); }
  catch (e) { throw new Error(`advance-phase: state read failed: ${e.message}`); }
  const workflowType = current.workflow_type;
  const baseUpdates = [`phase=${targetPhase}`, "status=DONE", ...(Array.isArray(kvUpdates) ? kvUpdates : [])];
  const gateRun = runPhaseGates(workflowType, targetPhase, { tracePrefix: "advance-phase" });
  if (!gateRun.fired) {
    // Pass skipGates so updateState doesn't re-fire the same gates we just
    // confirmed don't apply (workflow_type unset / YAML absent / no gates).
    return { ok: true, advanced: true, target_phase: targetPhase, workflow_type: workflowType || null, gates_run: [], note: gateRun.note, update: updateState(baseUpdates, { skipGates: true }) };
  }
  if (gateRun.blockedBy.length > 0) {
    throw new Error(
      `[devt advance-phase] ${gateRun.blockedBy.length} gate(s) blocked transition to ${workflowType}.${targetPhase}: ` +
      gateRun.blockedBy.map(b => `${b.gate} (${b.reason})`).join(" | ")
    );
  }
  // Gates fired and passed — proceed with the write. skipGates avoids a
  // duplicate gate run inside updateState (which now also fires gates on
  // phase=X status=DONE through the same runner).
  const updateResult = updateState(baseUpdates, { skipGates: true });
  return { ok: true, advanced: true, target_phase: targetPhase, workflow_type: workflowType, gates_run: gateRun.gateResults, update: updateResult };
}

function persistGateTrace(name, result) {
  try {
    const dir = getStateDir();
    let workflowId = null;
    let workflowType = null;
    let phase = null;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const wfPath = path.join(dir, "workflow.yaml");
    if (fs.existsSync(wfPath)) {
      try {
        const yaml = fs.readFileSync(wfPath, "utf8");
        const idMatch = yaml.match(/^workflow_id:\s*"?([^"\n]+)"?\s*$/m);
        if (idMatch) workflowId = idMatch[1].trim();
        const typeMatch = yaml.match(/^workflow_type:\s*"?([^"\n]+)"?\s*$/m);
        if (typeMatch) workflowType = typeMatch[1].trim();
        const phaseMatch = yaml.match(/^phase:\s*"?([^"\n]+)"?\s*$/m);
        if (phaseMatch) phase = phaseMatch[1].trim();
      } catch { /* unreadable — fields stay null */ }
    }
    const verdict = result && result.ok === true
      ? (result.warn === true ? "warn" : "ok")
      : "fail";
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      source: "gate_trace",
      gate: name,
      verdict,
      reason: (result && typeof result.reason === "string") ? result.reason : "",
      workflow_id: workflowId,
      workflow_type: workflowType,
      phase,
    });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    fs.appendFileSync(path.join(dir, "gate-trace.jsonl"), record + "\n");
  } catch { /* trace persistence is best-effort */ }
}

// Wrapper that runs the gate function and traces the result. Mirrors how
// persistClaimCheckResult wraps assertArtifactPresent — single wrap point
// per gate so future changes (e.g., adding latency field) live in one place.
function traceGate(name, fn) {
  const result = fn();
  persistGateTrace(name, result);
  return result;
}

function persistClaimCheckResult(result) {
  if (!result || !result.agent) return;
  try {
    const dir = getStateDir();
    // Read workflow_id from workflow.yaml if present (audit-trail enrichment)
    let workflowId = null;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const wfPath = path.join(dir, "workflow.yaml");
    if (fs.existsSync(wfPath)) {
      try {
        const yaml = fs.readFileSync(wfPath, "utf8");
        const m = yaml.match(/^workflow_id:\s*"?([^"\n]+)"?\s*$/m);
        if (m) workflowId = m[1].trim();
      } catch { /* unreadable — workflow_id stays null */ }
    }
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      source: "claim_check",
      agent: result.agent,
      verdict: result.ok ? "success" : "failure",
      // Substance-aware Layer-1 — substance_verdict added alongside the
      // file-presence verdict so Layer-2 can distinguish "file present
      // but stub" from "file present and substantive". Backwards compat:
      // historical records (pre-substance-aware) lack this field; the
      // Layer-2 reader treats missing as "substantive" so old records
      // continue to resolve cleanly.
      ...(result.substance_verdict ? { substance_verdict: result.substance_verdict } : {}),
      reason: result.reason || "",
      expected_path: result.expected_path || null,
      workflow_id: workflowId,
    });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    fs.appendFileSync(path.join(dir, "claim-check-failures.jsonl"), record + "\n");
  } catch { /* persistence is best-effort */ }
}

// Layer-2 post-hoc finalize gate — mirrors the assertNoRawDispatchesThisSession
// pattern. Walks claim-check-failures.jsonl, builds per-agent latest verdict
// in workflow window, counts unresolved failures.
//
// Resolution semantic: append-only audit trail with verdict field. For each
// agent in the window, the LAST record wins — orchestrator re-dispatches that
// succeed overwrite prior failures (verdict=success). Workflow finalize
// blocks only when an agent's latest verdict in window is still "failure".
//
// Respects claim_check_mode config (block default; warn surfaces summary
// without blocking; off auto-passes). Same config-knob pattern as
// dispatch_hygiene_mode.
function assertClaimChecksResolved() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const failsPath = path.join(dir, "claim-check-failures.jsonl");
  if (!fs.existsSync(failsPath)) {
    // Honest read of the absent file: structurally fine (nothing to resolve)
    // but ambiguous about coverage. Without explicit flagging, a workflow that
    // never dispatches Layer-1 calls leaves this file absent → gate
    // auto-passes without ever verifying any lane output. Reason now flags
    // the ambiguity so /devt:next and the audit trail can distinguish
    // "workflow doesn't dispatch output-writers" from "workflow should have
    // but Layer-1 never fired."
    return {
      ok: true,
      unresolved_count: 0,
      reason: "claim-check-failures.jsonl absent — no Layer-1 assert-artifact-present calls fired in this workflow window. OK if the workflow_type doesn't dispatch output-writing agents or hasn't reached an output-writing phase yet. Investigate as a coverage gap if dispatches DID happen but Layer-1 calls were skipped (cross-check gate-trace.jsonl for assert-artifact-present entries in this window).",
    };
  }
  let mode = "block";
  try {
    const { getMergedConfig } = require("./config.cjs");
    const cfg = getMergedConfig();
    if (cfg && typeof cfg.claim_check_mode === "string") {
      mode = cfg.claim_check_mode.toLowerCase();
    }
  } catch { /* keep default 'block' on any failure */ }
  if (mode === "off") {
    return { ok: true, unresolved_count: 0, mode, reason: "claim_check_mode=off — gate disabled" };
  }
  // Workflow window anchor — same pattern as assertNoRawDispatchesThisSession.
  // Scope is per-workflow: each new init * gets a clean window.
  let anchorMs = 0;
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const wfPath = path.join(dir, "workflow.yaml");
    if (fs.existsSync(wfPath)) {
      const yaml = fs.readFileSync(wfPath, "utf8");
      const m = yaml.match(/^created_at:\s*"?([^"\n]+)"?\s*$/m);
      if (m) {
        const parsed = new Date(m[1].trim()).getTime();
        if (Number.isFinite(parsed)) anchorMs = parsed;
      }
    }
  } catch { /* no anchor — gate auto-passes since we can't bound the window */ }
  if (anchorMs === 0) {
    return { ok: true, unresolved_count: 0, reason: "workflow.yaml::created_at absent — workflow window undefined; gate inapplicable" };
  }
  const body = fs.readFileSync(failsPath, "utf8");
  const latestByAgent = new Map();
  for (const line of body.split("\n")) {
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.source !== "claim_check") continue;
      if (typeof rec.ts !== "string") continue;
      if (new Date(rec.ts).getTime() < anchorMs) continue;
      if (!rec.agent) continue;
      // Last write wins per agent — successful re-dispatch resolves prior failures
      latestByAgent.set(rec.agent, rec);
    } catch { /* malformed line — skip */ }
  }
  const unresolved = [];
  for (const [agent, rec] of latestByAgent) {
    if (rec.verdict === "failure") {
      unresolved.push({ agent, reason: rec.reason, ts: rec.ts, expected_path: rec.expected_path, kind: "failure" });
      continue;
    }
    // Substance-aware Layer-2 — verdict=success with substance_verdict=stub
    // is treated as unresolved. Closes the gap where Layer-1 recorded
    // success on stub-sized files (file present + size > 0 = ok) but the
    // agent dispatch produced no substantive output. The retry path is
    // unchanged: a substantive re-dispatch overwrites the stub record
    // (last-write-wins per agent), so stub-then-substantive-retry stays the
    // happy path. Backwards compat: records without substance_verdict
    // default-resolve as substantive.
    if (rec.verdict === "success" && rec.substance_verdict === "stub") {
      unresolved.push({
        agent,
        reason: rec.reason || "latest claim-check has substance_verdict=stub — agent wrote a header-only or stub-phrase artifact, not substantive content",
        ts: rec.ts,
        expected_path: rec.expected_path,
        kind: "stub",
      });
    }
  }
  if (unresolved.length === 0) {
    return { ok: true, unresolved_count: 0, mode, reason: "all claim-checks in window resolved (latest verdict=success + substance=substantive per agent)" };
  }
  if (mode === "warn") {
    return {
      ok: true,
      warn: true,
      unresolved_count: unresolved.length,
      unresolved,
      mode,
      reason: `${unresolved.length} unresolved claim-check failure(s); claim_check_mode=warn so gate does not block. Re-dispatch missing artifacts OR set mode=block to enforce.`,
    };
  }
  return {
    ok: false,
    unresolved_count: unresolved.length,
    unresolved,
    mode,
    reason:
      `${unresolved.length} unresolved claim-check failure(s) in this workflow window: ${unresolved.map(u => u.agent).join(", ")}. ` +
      `Each named agent's most recent dispatch returned without writing its declared output (per io-contracts.yaml::outputs.primary). ` +
      `Remediation: re-dispatch the agent(s) so they write the missing artifact, OR SendMessage-resume if a budget wall is suspected (check dispatch-warnings.jsonl for near_cliff / low_output / mid_task_language records). ` +
      `Successful re-runs overwrite the failure record. Opt out via 'claim_check_mode: "warn"' or "off" in .devt/config.json.`,
  };
}

function assertNoRawDispatchesThisSession() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const warningsPath = path.join(dir, "dispatch-warnings.jsonl");
  if (!fs.existsSync(warningsPath)) {
    return { ok: true, raw_dispatch_count: 0, reason: "dispatch-warnings.jsonl absent — no dispatches recorded" };
  }
  // Honor the same config knob the PreToolUse hook reads. When mode is "warn"
  // or "off", this gate returns ok:true with the count surfaced so consumers
  // can choose to log it without blocking.
  // Hard kill-threshold bypasses dispatch_hygiene_mode.
  // Field signal: greenfield session accumulated 62 raw_dispatch warnings in
  // warn mode with zero enforcement. The kill-threshold is a hard-limit
  // safety (not a soft hygiene reminder) — runaway-pattern at 3+ dispatches
  // is a different failure class from intentional 1-2-off ad-hoc dispatches.
  // Mode-bypass for the kill check preserves "warn mode allows ad-hoc" while
  // catching runaway. Set to null to disable.
  let mode = "block";
  let killThreshold = 3;
  try {
    const { findProjectRoot, getMergedConfig } = require("./config.cjs");
    void findProjectRoot;
    const cfg = getMergedConfig();
    if (cfg && typeof cfg.dispatch_hygiene_mode === "string") {
      mode = cfg.dispatch_hygiene_mode.toLowerCase();
    }
    if (cfg && (typeof cfg.dispatch_hygiene_kill_threshold === "number" || cfg.dispatch_hygiene_kill_threshold === null)) {
      killThreshold = cfg.dispatch_hygiene_kill_threshold;
    }
  } catch { /* keep defaults on any failure */ }

  // Read workflow anchor — only count dispatches from the CURRENT workflow.
  // Use `created_at` (rotates on init *) not `first_created_at` (immutable
  // session anchor). Workflow-scope matches the gate's intent: each new
  // workflow gets a clean window, so a workflow's pass/fail reflects ONLY
  // its own dispatch hygiene, not accumulated history across the session.
  let anchorMs = 0;
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const wfPath = path.join(dir, "workflow.yaml");
    if (fs.existsSync(wfPath)) {
      const yaml = fs.readFileSync(wfPath, "utf8");
      const m = yaml.match(/^created_at:\s*"?([^"\n]+)"?\s*$/m);
      if (m) {
        const parsed = new Date(m[1].trim()).getTime();
        if (Number.isFinite(parsed)) anchorMs = parsed;
      }
    }
  } catch { /* no anchor — gate auto-passes since we can't bound the workflow window */ }
  if (anchorMs === 0) {
    return { ok: true, raw_dispatch_count: 0, reason: "workflow.yaml::created_at absent — workflow window undefined; gate inapplicable" };
  }

  const body = fs.readFileSync(warningsPath, "utf8");
  const agents = [];
  for (const line of body.split("\n")) {
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.source !== "raw_dispatch") continue;
      if (typeof rec.ts !== "string") continue;
      if (new Date(rec.ts).getTime() < anchorMs) continue;
      agents.push(rec.agent || "(unknown)");
    } catch { /* malformed line — skip */ }
  }
  const rawDispatchCount = agents.length;
  if (rawDispatchCount === 0) {
    return { ok: true, raw_dispatch_count: 0, reason: "no raw dispatches in this workflow's window" };
  }
  // Kill-threshold runs BEFORE the mode check — hard-limit safety
  // bypasses warn-mode. Closes the loop GF flagged explicitly in Q22 (62
  // warn-mode warnings accumulated with zero action).
  // Dedupe agent names for human-readable summary (count-suffixed when
  // duplicates exist). The raw `agents` array stays in the response so
  // programmatic consumers see the unfiltered sequence.
  const _agentSummary = (() => {
    const counts = {};
    for (const a of agents) counts[a] = (counts[a] || 0) + 1;
    return Object.entries(counts).map(([a, c]) => c > 1 ? `${a} ×${c}` : a).join(", ");
  })();
  if (typeof killThreshold === "number" && killThreshold > 0 && rawDispatchCount >= killThreshold) {
    return {
      ok: false,
      killed: true,
      raw_dispatch_count: rawDispatchCount,
      kill_threshold: killThreshold,
      agents,
      mode,
      reason:
        `KILL: ${rawDispatchCount} raw devt:* dispatches in this workflow ≥ kill-threshold ${killThreshold} ` +
        `(dispatch_hygiene_kill_threshold). This is hard-limit safety — overrides dispatch_hygiene_mode=${mode}. ` +
        `Agents bypassed: ${_agentSummary}. ` +
        `Recovery: re-dispatch via /devt:review / /devt:workflow / /devt:debug (canonical envelope path) ` +
        `OR pre-register lanes for parallel review: state register-lanes --from=<lanes.yaml> && dispatch render-lanes. ` +
        `Suppress by raising dispatch_hygiene_kill_threshold in .devt/config.json (loud audit signal) or set null to disable.`,
    };
  }
  if (mode === "warn" || mode === "off") {
    return {
      ok: true,
      warn: true,
      raw_dispatch_count: rawDispatchCount,
      agents,
      mode,
      reason: `${rawDispatchCount} raw devt:* dispatch(es) detected in this workflow (${_agentSummary}); dispatch_hygiene_mode=${mode} so gate does not block. Set mode=block to enforce.`,
    };
  }
  return {
    ok: false,
    raw_dispatch_count: rawDispatchCount,
    agents,
    mode,
    reason:
      `${rawDispatchCount} raw devt:* dispatch(es) detected in THIS workflow: ${agents.join(", ")}. ` +
      `These bypassed the workflow contract (no <scope_trust>/<scope_hint>/<memory_signal> blocks injected) — agents fell back to grep-quality discovery without graphify-anchored impact maps. ` +
      `Remediation: re-dispatch the agents via the workflow path (/devt:review, /devt:workflow, /devt:debug) which injects the canonical context envelope. ` +
      `If raw dispatch was intentional (ad-hoc orchestration), set 'dispatch_hygiene_mode: "warn"' in .devt/config.json to opt the gate out. ` +
      `Note: scope is THIS workflow only (since workflow.yaml::created_at) — prior workflows in the same session are excluded.`,
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
        // outputs, leaving valid candidates invisible to the gate. Observed
        // failure mode: quick_implement workflow produced tags in
        // impl-summary.md with zero reaching scratchpad.md.
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
  // Cid-match correctness defense. Dispatch envelope stamps
  // `cid_<workflow_id_prefix>_<lane_id>` and the lane reviewer's file body
  // surfaces it. Extracting the prefix here lets the consolidator filter
  // `select(.cid_match != "foreign")` to defend against eviction misses
  // (stale review-lane-*.md from a rotated workflow leaking into a fresh run).
  const wfIdMatch = yaml.match(/^workflow_id:\s*"?([^"\n]+)"?\s*$/m);
  const currentWorkflowIdPrefix = wfIdMatch ? wfIdMatch[1].trim().slice(0, 8) : null;
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

    // Cid-match extraction. Reads first 2KB of the lane file looking for
    // a `cid_<8hex>` pattern (F6's correlation_id format). Three outcomes:
    //   "current" — cid prefix matches workflow.yaml's workflow_id prefix
    //   "foreign" — cid prefix differs (stale from a rotated workflow)
    //   "absent"  — no cid found (legacy lane file pre-F6 OR file missing)
    // Consumers (consolidator query, gate checks) select `cid_match != "foreign"`
    // to defend against the eviction-misses-a-file case. Bounded 2KB read so
    // huge review files don't slow listLaneOutputs.
    let cidMatch = "absent";
    if (exists && reviewFile && currentWorkflowIdPrefix) {
      try {
        const fd = fs.openSync(reviewFile, "r");
        const buf = Buffer.alloc(2048);
        try { fs.readSync(fd, buf, 0, 2048, 0); } finally { fs.closeSync(fd); }
        const head = buf.toString("utf-8");
        const cidM = head.match(/cid_([0-9a-f]{8})/);
        if (cidM) {
          cidMatch = cidM[1] === currentWorkflowIdPrefix ? "current" : "foreign";
        }
      } catch { /* read error — leave as "absent" */ }
    }

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
      cid_match: cidMatch,
    });
  }
  return { lanes };
}

// Formal lane registration shortcut. Orchestrators with a hand-rolled
// partition (knew the lanes up front, didn't need lane-suggestions to
// compute them) were forced into raw-dispatch territory because no CLI
// accepts the partition directly — observed bursts of raw_dispatch hygiene
// warnings fired in single sessions. This CLI is the formal alternative —
// it writes the canonical lane entry into workflow.yaml::lanes[] and
// persists the per-lane files list in a sidecar at
// .devt/state/lane-files/<id>.json. The sidecar split avoids extending
// parseSimpleYaml + serializeSimpleYaml's lane round-trip (which today
// handles primitive values only; arrays would corrupt).
//
// Returns {ok, lane: {...full metadata}} or {ok: false, reason}.
function registerLane({ id, scope, files, allowOverwrite }) {
  if (!id || typeof id !== "string" || !/^L\d+$/.test(id)) {
    return { ok: false, reason: `invalid id "${id}" (must match /^L\\d+$/, e.g. L1, L2)` };
  }
  if (!scope || typeof scope !== "string") {
    return { ok: false, reason: "scope required (non-empty string)" };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, reason: "files required (non-empty array of paths)" };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const wfPath = path.join(dir, "workflow.yaml");
  if (!fs.existsSync(wfPath)) {
    return { ok: false, reason: "no workflow.yaml — initialize a workflow first" };
  }
  // Lock so concurrent register-lane calls don't lose entries on the
  // read-modify-write cycle. acquireLock() defaults to getStateDir() —
  // matches updateState/resetState/syncState/pruneState's lock idiom.
  const lockFile = acquireLock();
  try {
    const state = parseSimpleYaml(fs.readFileSync(wfPath, "utf8"));
    const lanes = Array.isArray(state.lanes) ? state.lanes : [];
    const existing = lanes.findIndex(l => l && l.id === id);
    if (existing !== -1 && !allowOverwrite) {
      return { ok: false, reason: `lane id "${id}" already registered; pass --overwrite to replace` };
    }
    const slug = slugifyLaneName(scope);
    let estLoc = 0;
    for (const f of files) {
      try {
        const content = fs.readFileSync(f, "utf8");
        estLoc += content.length === 0 ? 0 : content.split("\n").length - 1;
      } catch { /* file missing or unreadable — counts as 0 LOC */ }
    }
    const fileCount = files.length;
    const oversized = fileCount > 15 || estLoc > 800;
    const reviewFile = path.join(dir, `review-lane-${slug}.md`);
    const registeredAt = new Date().toISOString();
    const laneEntry = {
      id,
      community: scope,
      slug,
      review_file: reviewFile,
      status: "in_flight",
      redispatch_count: 0,
      registered_at: registeredAt,
      file_count: fileCount,
      est_loc: estLoc,
      oversized,
    };
    if (existing !== -1) {
      lanes[existing] = laneEntry;
    } else {
      lanes.push(laneEntry);
    }
    state.lanes = lanes;
    atomicWriteFileSync(wfPath, serializeSimpleYaml(state));
    // Per-lane files sidecar. Atomic per-lane write. Read by render-lanes
    // (dispatch.cjs) and any future consumer that needs the file list
    // without re-parsing the orchestrator's partition input.
    const sidecarDir = path.join(dir, "lane-files");
    if (!fs.existsSync(sidecarDir)) fs.mkdirSync(sidecarDir, { recursive: true });
    atomicWriteFileSync(
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      path.join(sidecarDir, `${id}.json`),
      JSON.stringify({ id, community: scope, files, registered_at: registeredAt }, null, 2) + "\n",
    );
    return { ok: true, lane: { ...laneEntry, files } };
  } finally {
    releaseLock(lockFile);
  }
}

// Round 8 W2 — bulk-register from a YAML/JSON partition file. Format:
//   lanes:
//     - id: L1
//       scope: identity
//       files: [app/services/identity/auth.py, ...]
//     - id: L2
//       ...
// JSON shape (same key names) also accepted. Loops registerLane per entry.
function registerLanesFromYaml(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: `partition file not found: ${filePath}` };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed = null;
  // JSON-first: cheaper than the YAML branch and tolerates either format.
  try { parsed = JSON.parse(raw); } catch { /* fall through to YAML */ }
  if (!parsed) {
    // Minimal YAML parse for the lanes:[] shape. Each lane is a dash-prefixed
    // block. Reuses the existing parseSimpleYaml lanes round-trip when files
    // is absent, then falls through to a focused multi-line files parse.
    const lines = raw.split("\n");
    const lanes = [];
    let current = null;
    let inFiles = false;
    for (const line of lines) {
      if (/^\s*-\s+id:/.test(line)) {
        if (current) lanes.push(current);
        current = { files: [] };
        inFiles = false;
        const m = line.match(/id:\s*"?([^"\n]+)"?\s*$/);
        if (m) current.id = m[1].trim();
      } else if (current && /^\s+scope:/.test(line)) {
        inFiles = false;
        const m = line.match(/scope:\s*"?([^"\n]+)"?\s*$/);
        if (m) current.scope = m[1].trim();
      } else if (current && /^\s+files:\s*\[/.test(line)) {
        // Inline array form: files: [a.py, b.py]
        inFiles = false;
        const m = line.match(/files:\s*\[(.+)\]\s*$/);
        if (m) current.files = m[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
      } else if (current && /^\s+files:\s*$/.test(line)) {
        inFiles = true;
      } else if (current && inFiles && /^\s+-\s+/.test(line)) {
        current.files.push(line.replace(/^\s+-\s+/, "").trim().replace(/^"|"$/g, ""));
      } else if (/^[a-z_]/.test(line)) {
        inFiles = false;
      }
    }
    if (current) lanes.push(current);
    parsed = { lanes };
  }
  const lanes = (parsed && Array.isArray(parsed.lanes)) ? parsed.lanes : [];
  if (lanes.length === 0) {
    return { ok: false, reason: "no lanes found in partition file (expected `lanes: [...]` at top level)" };
  }
  const results = [];
  const errors = [];
  for (const entry of lanes) {
    const r = registerLane({
      id: entry.id,
      scope: entry.scope,
      files: entry.files,
      allowOverwrite: true, // bulk register is idempotent — re-runs replace
    });
    results.push({ id: entry.id, ok: r.ok, reason: r.reason || null });
    if (!r.ok) errors.push({ id: entry.id, reason: r.reason });
  }
  return { ok: errors.length === 0, registered: results, errors };
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
    // Prefer immutable first_created_at over mutable created_at.
    // `state update workflow_type=...` rotates created_at, retroactively
    // invalidating preflight-brief.json written BEFORE the transition.
    // first_created_at anchors session start and never rotates. Backward-
    // compat fallback for legacy workflow.yaml.
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
    // Structured payload requirement. Without this, a one-line skip reason
    // satisfied the gate but produced no value. The valid-reason enum forces
    // the orchestrator to commit to a concrete reason category that
    // downstream observability can aggregate over. task_unrelated_to_history
    // additionally requires a details= line so the deliberate override
    // leaves an audit trail rather than a bare assertion.
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
    case "update": {
      // --skip-gates opt-out for explicit ad-hoc callers who
      // don't want phase-gate enforcement on phase=X status=DONE updates.
      // Loud flag name keeps the bypass auditable. Filtered out of the
      // key=value args so it doesn't poison the merge.
      const skipGates = args.includes("--skip-gates");
      const cleanArgs = args.filter(a => a !== "--skip-gates");
      return updateState(cleanArgs, { skipGates });
    }
    case "reset":
      return resetState();
    case "reset-soft":
      return resetSoft();
    case "staleness-check": {
      const taskArg = args.find(a => a.startsWith("--task="));
      const wfTypeArg = args.find(a => a.startsWith("--workflow-type="));
      const task = taskArg ? taskArg.slice("--task=".length) : "";
      const workflowType = wfTypeArg ? wfTypeArg.slice("--workflow-type=".length) : "";
      return stalenessCheck({ task, workflowType });
    }
    case "auto-reset-if-stale": {
      const taskArg = args.find(a => a.startsWith("--task="));
      const wfTypeArg = args.find(a => a.startsWith("--workflow-type="));
      const task = taskArg ? taskArg.slice("--task=".length) : "";
      const workflowType = wfTypeArg ? wfTypeArg.slice("--workflow-type=".length) : "";
      return autoResetIfStale({ task, workflowType });
    }
    case "graphify-roi":
      return graphifyRoi();
    case "disk-check":
      return diskCheck();
    case "compute-impact-plan": {
      const scopeArg = args.find(a => a.startsWith("--scope="));
      const branchArg = args.find(a => a.startsWith("--primary-branch="));
      const reviewScope = scopeArg ? scopeArg.slice("--scope=".length) : undefined;
      const primaryBranch = branchArg ? branchArg.slice("--primary-branch=".length) : undefined;
      return computeGraphifyImpactPlan({ reviewScope, primaryBranch });
    }
    case "mark-claude-mem-skipped": {
      // Operator-declarable skip for claude-mem harvest. When session
      // memory already covers the scope, marginal value of harvest is ~0.
      // assert-claude-mem-harvest already accepts `claude-mem-skipped.txt`
      // as a marker; this CLI makes the escape valve discoverable and
      // ensures the gate-compliant content shape (reason=<enum> [+ details=]).
      // Default --reason=task_unrelated_to_history (the session-saturated
      // case). Other valid reasons (not_installed/mcp_unavailable/
      // corpus_empty) are gate-supported but operator-declared skip
      // wouldn't typically use them.
      const VALID_REASONS = new Set([
        "not_installed", "mcp_unavailable", "corpus_empty", "task_unrelated_to_history",
      ]);
      const reasonArg = args.find(a => a.startsWith("--reason="));
      const detailsArg = args.find(a => a.startsWith("--details="));
      const reason = reasonArg ? reasonArg.slice("--reason=".length) : "task_unrelated_to_history";
      const details = detailsArg ? detailsArg.slice("--details=".length) : "session memory already covers scope (operator-declared)";
      if (!VALID_REASONS.has(reason)) {
        return {
          ok: false,
          reason: `invalid --reason="${reason}". Valid: ${Array.from(VALID_REASONS).join(" | ")}`,
        };
      }
      const dir = getStateDir();
      const skippedPath = path.join(dir, "claude-mem-skipped.txt");
      const harvestPath = path.join(dir, "claude-mem-harvest.md");
      if (fs.existsSync(harvestPath)) {
        // Mutually exclusive per assertClaudeMemHarvest contract — if harvest
        // already exists, declaring skip would create a both-files conflict
        // that the gate would then reject.
        return { ok: false, reason: "claude-mem-harvest.md already exists; cannot mark skipped (mutually exclusive per gate)" };
      }
      // Gate-compliant format: `reason=<enum>` line + `details=` line for
      // task_unrelated_to_history (other enums don't strictly require details
      // per gate logic, but including it provides audit context).
      const lines = [`reason=${reason}`];
      if (reason === "task_unrelated_to_history" || details) {
        lines.push(`details=${details}`);
      }
      atomicWriteFileSync(skippedPath, lines.join("\n") + "\n");
      return { ok: true, path: skippedPath, reason, details };
    }
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
      const adHocArg = _getFlag(args, "--ad-hoc-stale-days");
      const opts = { dryRun };
      if (staleArg) opts.staleDays = parseInt(staleArg, 10);
      if (adHocArg) opts.adHocStaleDays = parseInt(adHocArg, 10);
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
    // Every assert-* gate firing logs to gate-trace.jsonl via traceGate
    // wrapper for unified observability. assertArtifactPresent already
    // persists to claim-check-failures.jsonl; gate-trace.jsonl adds the
    // unified firing-rate + verdict timeline across all 14 gates.
    case "assert-graphify-decision":
      return traceGate("assert-graphify-decision", () => assertGraphifyDecision());
    case "assert-preflight-fresh":
      return traceGate("assert-preflight-fresh", () => assertPreflightFresh());
    case "assert-claude-mem-harvest":
      return traceGate("assert-claude-mem-harvest", () => assertClaudeMemHarvest());
    case "check-agent-output": {
      const structural = args.includes("--structural");
      const baseline = _getFlag(args, "--baseline");
      const mode = _getFlag(args, "--mode");
      const opts = structural || baseline
        ? { structural: true, baseline, ...(mode ? { mode } : {}) }
        : undefined;
      return checkAgentOutput(args[0], opts);
    }
    case "assert-verifier-graded-all-axes":
      return traceGate("assert-verifier-graded-all-axes", () => assertVerifierGradedAllAxes());
    case "assert-verifier-short-circuit": {
      const agentArg = args.find(a => a.startsWith("--agent="));
      const agent = agentArg ? agentArg.slice("--agent=".length) : "";
      return assertVerifierShortCircuit({ agent });
    }
    case "assert-verifier-ran":
      return traceGate("assert-verifier-ran", () => assertVerifierRan());
    case "assert-scope-check-handled":
      return traceGate("assert-scope-check-handled", () => assertScopeCheckHandled());
    case "assert-lanes-registered":
      return traceGate("assert-lanes-registered", () => assertLanesRegistered());
    case "assert-consolidator-dispatched":
      return traceGate("assert-consolidator-dispatched", () => assertConsolidatorDispatched());
    case "assert-auto-curator-considered":
      return traceGate("assert-auto-curator-considered", () => assertAutoCuratorConsidered());
    case "assert-reuse-analyzed":
      return traceGate("assert-reuse-analyzed", () => assertReuseAnalyzed());
    case "assert-knowledge-candidates-tagged":
      return traceGate("assert-knowledge-candidates-tagged", () => assertKnowledgeCandidatesTagged());
    case "assert-preflight-semantic-quality":
      return traceGate("assert-preflight-semantic-quality", () => assertPreflightSemanticQuality(args));
    case "assert-no-raw-dispatches-this-session":
      return traceGate("assert-no-raw-dispatches-this-session", () => assertNoRawDispatchesThisSession());
    case "assert-artifact-present":
      return traceGate("assert-artifact-present", () => assertArtifactPresent(args[0]));
    case "assert-claim-checks-resolved":
      return traceGate("assert-claim-checks-resolved", () => assertClaimChecksResolved());
    case "recover-partial-impl":
      return recoverPartialImpl(args[0]);
    case "check-inherited-edits":
      return detectInheritedSourceEdits();
    case "assert-file-quiescent":
      return assertFileQuiescent(args[0], args.slice(1));
    case "assert-lanes-quiesced":
      return traceGate("assert-lanes-quiesced", () => assertLanesQuiesced());
    case "council-trace":
      return councilTrace(args[0], args.slice(1));
    case "assert-council-not-recent":
      return traceGate("assert-council-not-recent", () => assertCouncilNotRecent(args[0], args.slice(1)));
    case "council-validation-material":
      return councilValidationMaterial(args);
    case "assert-advisor-diversity":
      return assertAdvisorDiversity(args);
    case "assert-council-budget":
      return traceGate("assert-council-budget", () => assertCouncilBudget(args));
    case "arch-scan-trace":
      return archScanTrace(args[0], args.slice(1));
    case "assert-arch-scan-fresh":
      return traceGate("assert-arch-scan-fresh", () => assertArchScanFresh(args));
    case "assert-wired":
      return traceGate("assert-wired", () => assertWired(args[0], args.slice(1)));
    case "assert-scope-complete":
      return traceGate("assert-scope-complete", () => assertScopeComplete(args));
    case "autoskill-rej-check":
      return autoskillRejCheck(args);
    case "assert-graphify-source-tagged":
      return traceGate("assert-graphify-source-tagged", () => assertGraphifySourceTagged(args[0], args.slice(1)));
    case "graphify-fallback-trace":
      return graphifyFallbackTrace(args[0], args.slice(1));
    case "new-instance":
      return newInstance(args);
    case "list-instances":
      return listInstances();
    case "advance-phase":
      return advanceState(args[0], args.slice(1));
    case "aggregate-knowledge-candidates":
      return aggregateKnowledgeCandidates();
    case "derive-reuse-candidates":
      return require("./reuse-search.cjs").deriveReuseCandidates(args.join(" "));
    case "refresh-scope-context":
      return require("./preflight.cjs").scopeCache();
    case "list-lane-outputs":
      return listLaneOutputs();
    case "update-lane":
      return updateLane(args[0], args.slice(1));
    case "register-lane": {
      // Args: --id=L1 --scope=identity --files=a.py,b.py [--overwrite]
      const getFlag = (name) => {
        const inline = args.find(a => a.startsWith(`--${name}=`));
        if (inline) return inline.slice(`--${name}=`.length);
        const idx = args.findIndex(a => a === `--${name}`);
        return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
      };
      const filesRaw = getFlag("files");
      return registerLane({
        id: getFlag("id"),
        scope: getFlag("scope"),
        files: filesRaw ? filesRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
        allowOverwrite: args.includes("--overwrite"),
      });
    }
    case "register-lanes": {
      // Args: --from=lanes.yaml (or --from=lanes.json)
      const fromInline = args.find(a => a.startsWith("--from="));
      const fromIdx = args.findIndex(a => a === "--from");
      const from = fromInline ? fromInline.slice("--from=".length)
                              : (fromIdx >= 0 && args[fromIdx + 1] ? args[fromIdx + 1] : undefined);
      if (!from) {
        return { ok: false, reason: "Usage: state register-lanes --from=<lanes.yaml|lanes.json>" };
      }
      return registerLanesFromYaml(from);
    }
    case "history": {
      const limitArg = _getFlag(args, "--limit");
      const lim = limitArg ? parseInt(limitArg, 10) : 20;
      return stateHistory(lim);
    }
    default:
      throw new Error(
        `Unknown state subcommand: ${subcommand}. Use: read, read-section, read-sidecar, truncate-artifact, update, reset, reset-soft, staleness-check, auto-reset-if-stale, graphify-roi, disk-check, compute-impact-plan, mark-claude-mem-skipped, release, validate, sync, prune, audit, cleanup, evict-graphify, evict-workflow-artifacts, assert-graphify-decision, assert-preflight-fresh, assert-claude-mem-harvest, check-agent-output, assert-verifier-ran, assert-verifier-short-circuit, assert-verifier-graded-all-axes, assert-scope-check-handled, assert-lanes-registered, assert-consolidator-dispatched, assert-auto-curator-considered, assert-reuse-analyzed, assert-knowledge-candidates-tagged, assert-preflight-semantic-quality, assert-no-raw-dispatches-this-session, aggregate-knowledge-candidates, derive-reuse-candidates, refresh-scope-context, assert-artifact-present, assert-claim-checks-resolved, recover-partial-impl, check-inherited-edits, assert-file-quiescent, assert-lanes-quiesced, council-trace, assert-council-not-recent, council-validation-material, assert-advisor-diversity, assert-council-budget, arch-scan-trace, assert-arch-scan-fresh, assert-wired, assert-scope-complete, autoskill-rej-check, assert-graphify-source-tagged, graphify-fallback-trace, new-instance, list-instances, advance-phase, list-lane-outputs, update-lane, register-lane, register-lanes, history`,
      );
  }
}

module.exports = {
  run,
  diskCheck,
  parseSimpleYaml,
  serializeSimpleYaml,
  readState,
  readSection,
  readSidecar,
  truncateArtifact,
  updateState,
  resetState,
  registerLanesFromYaml,
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
