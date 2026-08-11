"use strict";

// state-contract — the shared constant tables of the state layer (phase order, artifact schemas, file contract, reset exemptions, thresholds).
// Mechanical split of the former single-file state.cjs — function bodies are
// verbatim moves; state.cjs remains the facade that re-exports every public
// name, so all consumers keep requiring bin/modules/state.cjs unchanged.

const fs = require("fs");
const path = require("path");
const { findProjectRoot } = require("./config.cjs");
const { atomicWriteFileSync, atomicWriteJsonSync } = require("./io.cjs");
const { FILE_REL: DEFERRED_FILE_REL } = require("./deferred.cjs");


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
  scan_id: "string",
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
  "context_init", "flow_deviation",
  // Review-pipeline phases (code-review.md + code-review-parallel.md).
  // Deliberately placed early: validateConsistency expects the artifact of
  // every lower-indexed mapped phase to exist, so a low index keeps sitting
  // at a lane phase from implying dev-pipeline artifacts (impl-summary.md,
  // test-summary.md) are present. Unregistered they were worse — the
  // indexOf() -1 short-circuit skipped ALL phase-gated artifact checks.
  "scope_check", "partition_lanes", "dispatch_lanes", "substance_check_lanes",
  "redispatch_lanes", "consolidate", "present_findings",
  "assess", "risk_warning",
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
  arch_health_scan: "arch-review.md",
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
    checks: [
      // The walk-all-axes gate documents criteria_total as its comparison
      // basis — a verifier that omits it writes a sidecar the gate's doc
      // names but the write-time schema never enforced. Short-circuit
      // synthetics are exempt (no axes were walked; source records that).
      (d) => (d.source !== "short_circuit" && typeof d.criteria_total !== "number")
        ? 'missing "criteria_total" (number) — required for the walk-all-axes gate unless source="short_circuit"'
        : null,
    ],
  },
  // review.md emits "## Verdict" instead of "## Status", so the legacy
  // extractStatus parser returned null on every code-review verify advance
  // and validateConsistency persisted a NO_STATUS_LINE warning. Sidecar
  // routing via SIDECAR_FOR_MARKDOWN bypasses extractStatus entirely.
  "review.json": {
    status: ["DONE", "PARTIAL", "BLOCKED"],
    verdict: ["APPROVED", "APPROVED_WITH_NOTES", "NEEDS_WORK"],
    agent: ["code-reviewer"],
    // Fields the consolidation readers require, declared so the producer
    // template can be gated against them. review.json was specified in three
    // places that shared ZERO fields — this schema (status/verdict/agent), the
    // consolidator envelope (raw_lane_finding_counts/score/lane_scores/…), and
    // state-lanes.cjs::laneSeverityTally (severity_counts/findings) — so a
    // consolidator inventing names was the only behavior available to it, and
    // a field one reader needs went unnamed by every producer surface. This is
    // the list the producer-template gate compares against; a reader that
    // starts depending on a new field adds it here first.
    reader_fields: [
      "severity_counts", "findings", "raw_lane_finding_counts",
      "coverage", "uncovered_scope", "lane_scores", "score",
    ],
    checks: [
      // A silent all-null lane_scores[] reads as a working feature (the lane
      // score distribution is the parallel report's headline) — field: every
      // lane failed to self-score and nothing mechanical noticed. Null scores
      // demand a stated reason.
      (d) => (Array.isArray(d.lane_scores)
              && d.lane_scores.some((l) => l && l.score == null)
              && typeof d.lane_scores_null_reason !== "string")
        ? 'lane_scores[] contains null score(s) without "lane_scores_null_reason" — a silent null distribution masks a broken self-grading path'
        : null,
    ],
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
  "acceptance-criteria.json": {
    // Frozen by the verifier's FIRST iteration; later iterations grade against
    // it verbatim so revisions[] ids stay comparable across the retry loop.
    required: ["criteria"],
    recommended: ["derived_at", "workflow_id"],
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
// PARTIAL is required on every one of these: each owning agent's output_format
// offers it for budget-walled multi-section work, and dev-workflow.complex
// ROUTES on `Status: PARTIAL` to SendMessage-resume the architect. Omitting it
// here meant an agent following its own contract wrote an artifact this reader
// flagged invalid_status — the sidecar schemas already carried it, so only the
// markdown-only artifacts drifted.
const ARTIFACT_SCHEMA = {
  "debug-summary.md": ["FIXED", "NEEDS_MORE_INVESTIGATION", "DONE_WITH_CONCERNS", "PARTIAL", "BLOCKED"],
  "arch-review.md": ["DONE", "DONE_WITH_CONCERNS", "PARTIAL", "BLOCKED", "NEEDS_CONTEXT"],
  "docs-summary.md": ["DONE", "DONE_WITH_CONCERNS", "PARTIAL", "BLOCKED", "NEEDS_CONTEXT"],
  "curation-summary.md": ["DONE", "DONE_WITH_CONCERNS", "PARTIAL", "BLOCKED", "NEEDS_CONTEXT"],
  "research.md": ["DONE", "DONE_WITH_CONCERNS", "PARTIAL", "BLOCKED", "NEEDS_CONTEXT"],
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
  "evolution-report.md", "evolution-report.json",
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
// deferred        — second F28 stub (present-but-thin); REVIEWED SOMETHING — consolidator notes it
// lane_failed     — produced NO output (missing/zero-byte) even after retry; reviewed NOTHING.
//                   Distinct from `deferred` for COVERAGE HONESTY: "9 lanes, all terminal"
//                   must not hide a zero-coverage hole. Terminal; consolidator reports it as
//                   uncovered scope, never silently folded into the deferred bucket.
const VALID_LANE_STATUSES = new Set([
  "in_flight", "substance_pass", "stub_redispatched", "deferred", "lane_failed",
]);


// Workflow-id rotation audit log. Receipt #9 evidence: 8 parallel subagents
// rotated workflow_id mid-run (1f871314 → f67240bb) with no audit trail —
// receipt user could only narrow to "lifecycle surface, not status" at 70%
// confidence because no record exists of "who rotated, when, via which CLI."
// Every mutation site now appends a JSONL line so post-hoc forensics can
// pinpoint the source. RESET_EXEMPT — survives resetSoft (that's the whole
// point: rotations BY resetSoft are themselves the events being audited).
// Append-only + best-effort: any I/O failure is swallowed (audit logging
// must NEVER prevent the underlying mutation from succeeding).
// Concurrent-mutation guard. workflow.yaml (especially workflow_id) is
// orchestrator-owned. During a parallel-lane fan-out the orchestrator is
// blocked awaiting Task() returns, so any workflow_id rotation / reset / init
// while a subagent is still RUNNING is necessarily a lane subagent mutating
// shared state — the concurrent-rotation failure where parallel lanes rotated
// workflow_id mid-run and corrupted trace attribution. Lanes update their own
// status via `state update-lane` (which never touches workflow_id), so this
// guard never blocks legitimate lane work. Reads the subagent-status.sh-
// maintained status.json; a "running" entry older than the fresh window is a
// crash leak (SubagentStop never fired) and is ignored.
const _ACTIVE_SUBAGENT_FRESH_MS = 30 * 60 * 1000;

const ARCHIVE_DIR = ".archive";       // .devt/state/.archive/ — ring buffer of prior resets

const RESET_EXEMPT = new Set([
  ".lock",                              // active locking — never delete
  ARCHIVE_DIR,                          // ring buffer survives reset (rolls off via pruneArchive)
  "threads",                            // cross-session handoffs/threads — surviving session boundaries IS their contract; a workflow reset/cancel must never destroy another session's open threads
  path.basename(DEFERRED_FILE_REL),     // deferred.md — see bin/modules/deferred.cjs
  "preflight-denies.jsonl",             // forensic deny log — survives cancel so stuck-detector reads at canonical path
  "dispatch-warnings.jsonl",            // forensic dispatch-scope log — survives cancel for /devt:debug --mode=forensics post-hoc analysis
  "probe-failures.jsonl",               // graphify+python probe failures (category, command, args, error). Survives reset so health subcommand can surface root-cause across sessions.
  ".graphify-rebuild.lock",             // atomic O_CREAT|O_EXCL lock for graphify rebuild --debounce. Survives reset so a crashed prior holder doesn't deadlock a fresh workflow (the rebuild path also unlinks the lock when mtime exceeds the debounce window).
  "last-curator-run.txt",               // auto-curator cooldown tracker; survives reset so the 7-day gate isn't bypassed by /devt:workflow --cancel
  "graphify-impact-plan.json",          // args+tier audit trail for the impact step. Survives reset so the "args VERBATIM" contract is auditable post-hoc; otherwise the plan disappears with the workflow and the only evidence left is graph-impact.md (the MCP response) without the args used to derive it.
  "workflow-id-rotations.jsonl",        // audit log of every workflow_id mutation (prev_id, new_id, source, pid, argv). RESET_EXEMPT because rotations BY resetSoft are themselves the events being audited — wiping the log on reset would erase the forensic trail for the bug that motivated it.
  "lane-status-overrides.jsonl",        // operator lane-verdict override rationales (update-lane override_reason=). Survives reset so post-hoc audits can distinguish "gate wrong, operator overrode with reason" from "gate right, lane redispatched".
  "static-compress.jsonl",              // static-compress calibration log (compress/restore actions with byte ratios). Survives reset so calibration data isn't lost when a workflow resets between compression runs; membership here also makes it audit-canonical, so `state cleanup` never archives it.
  "gate-trace.jsonl",                   // forensic gate-decision trace. Same contract as dispatch-warnings.jsonl. Not declaring it cost more than tidiness: telemetry-calibrate + hook-cost + weekly-report read ONLY the live path, so an undeclared trace was archived at every init and devt's own cost analytics had a horizon of one workflow.
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
    "subagent-events.jsonl",
    "arch-triage.json", "arch-scan-report.md", "scanner-output.txt",
    "evolution-report.md", "evolution-report.json",
    "docs-summary.md", "curation-summary.md", "session-report.md",
    "autoskill-proposals.md", "baseline-gates.md",
    "claude-mem-harvest.md", "claude-mem-skipped.txt", "last-curator-run.txt",
    "continue-here.md",         // /devt:workflow --pause output (paired with handoff.json)
    "graph-impact.md",
    "graphify-impact-plan.json", // bash-computed tier+tool decision for code-review impact step
    "graphify-skip-reason.txt", // explicit-skip artifact when the impact step's plan == "skip"
    "staleness-suppressed.txt", // mechanical-override artifact when staleness gate forces scope_trust='sparse'
    "partition-degraded.txt",   // why a lane partition fell back — survives the session for lanes/consolidator/gates
    "preflight-brief.json",     // JSON sidecar for preflight-brief.md (no routing — input-only)
    "weekly-report.md",         // output of `devt-tools report generate` — weekly contributor + commit summary
    "review.md", "code-review-input.md",
    "scope-check-required.txt", // marker written when >10-file + graphify-ready gate fires
    "scope-check-answer.txt",   // orchestrator writes user's parallel/single/cancel choice
    "review-depth.txt",         // diff-LOC banding (standard|chunked + measured LOC) written at scope_check; reset-soft evicted
    "dispatch-stamps.jsonl",    // render-time dispatch-intent stamps (cid + ts) — provenance evidence for assert-consolidator-dispatched; reset-soft evicted
    "consolidator-ran.txt",     // marker written by consolidator synthesis entry (assert-consolidator-dispatched)
    "auto-curator-considered.txt", // marker written by auto_curator step (assert-auto-curator-considered)
    "reuse-candidates.md",      // written by state derive-reuse-candidates (reuse pre-search)
    "reuse-analysis.md",        // written by programmer per-candidate decisions (assert-reuse-analyzed gate)
    "reuse-search-attempted.txt", // marker written by workflow bash BEFORE derive-reuse-candidates CLI — distinguishes "never ran" from "ran with 0 candidates"
    "knowledge-candidates-none.txt", // declared-none artifact for assert-knowledge-candidates-tagged (escape hatch with structured reason)
    "topic-symbols-dropped.json",  // symbols dropped when symbol_anchored truncates >32 from preflight; consumed by code-review step to emit truncation notice in graph-impact.md
    "probe-failures.jsonl",        // append-only diagnostic log of graphify+python probe failures; RESET_EXEMPT so health subcommand can surface root-cause across sessions
    "workflow-id-rotations.jsonl", // append-only audit log of workflow_id mutations (prev, new, source, pid, argv); RESET_EXEMPT for forensics
    "lane-status-overrides.jsonl", // append-only audit log of update-lane override_reason= annotations; RESET_EXEMPT for post-hoc gate audits
    "claim-checks.jsonl",       // Layer-1 claim-check log (successes AND failures — the success rows are what prove each lane wrote its artifact). Rotated by resetSoft rather than reset-exempt, so it belongs here rather than in RESET_EXEMPT
    "status.json",              // subagent-status.sh + state.cjs run status
    "lane-unassigned.txt",      // declared-scope files in no lane (coverage set-difference from register-lanes)
    "lane-snapshot.json",       // per-lane artifact content hashes taken at consolidation entry; assert-lanes-unchanged compares against it
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
    "^[a-z][a-z0-9]*(-[a-z0-9]+)+-summary\\.md$",  // topical summaries (module-md-update-summary.md) when no slugged class fits. ≥2 segments before "-summary" required: single-word forms (test-summary.md) ARE the canonical namespace — F10e enforces the disjointness
    "^lane-diff-L\\d+\\.txt$",   // per-lane diff artifact from register-lane
    "^review-lane-[A-Za-z0-9_.-]+\\.json$",  // per-lane severity sidecar. The .md side rides the review-* pattern above; the .json side matched nothing and was classified foreign — devt's own dispatch renders the write instruction for it
    "^rubric-[a-z_]+\\.md$",  // in-project rubric copy materialized by init. <rubric_path> must resolve INSIDE the project: a lane declined to open the plugin-root path as outside the repo and self-graded instead
    "^[a-z][a-z0-9-]*\\.archive-[0-9A-Za-z:.\\-]+\\.jsonl$",  // logs rotated by resetSoft. Undeclared, these were litter one devt command created and the next archived 22 seconds later
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
  "context_init_scope_sig", "context_init_graph_head",
];


// Verdicts that mean the workflow DELIVERED its answer. Reaching one is the
// same "nothing to resume" signal `phase: complete` carries — a NEEDS_WORK
// review is finished as a review; the next step is fixing code and running
// again. Without this, a re-review parked at phase=present_findings looked
// resumable and carried the prior run's counters into it.
const TERMINAL_VERDICTS = new Set(["APPROVED", "APPROVED_WITH_NOTES", "NEEDS_WORK", "PASS", "FAILED"]);


// Logs rotated by resetSoft. Cross-workflow accumulators that the KILL gate +
// claim-check gate read MUST be rotated, else gates re-fire immediately on the
// preserved counts. Field receipt: a 51-raw-dispatch KILL gate from
// a 20-day-old workflow blocked a brand-new review's first state.update call.
const RESET_SOFT_ROTATE_LOGS = [
  "dispatch-warnings.jsonl",
  "claim-checks.jsonl",
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
//
// graphify-impact-plan.json IS evicted: it is scope-bound (its args carry the
// diff symbols of ONE specific review), not durable. A soft-reset marks a new
// working session against a new scope; preserving the prior scope's plan lets
// a faithful impact-step anchor the whole blast-radius on the wrong diff
// (field-observed). It is cheap to regenerate on the next context-init.
const RESET_SOFT_EVICT_PATTERNS = [
  /^review\.md$/,
  /^review\.json$/,
  /^review-lane-.+\.md$/,
  /^review-lane-.+\.json$/,
  // Per-lane diff artifacts are scope-bound like the lane outputs they feed —
  // a stale diff read as "the change under review" is silent-wrong-input.
  /^lane-diff-.+\.txt$/,
  // Depth banding is measured per review scope — a stale "chunked" marker
  // would bolt the large-diff strategy onto a small follow-up review.
  /^review-depth\.txt$/,
  /^dispatch-stamps\.jsonl$/,
  /^graphify-impact-plan\.json$/,
  // Records WHY a lane partition degraded. Scope-bound: carrying a prior
  // review's degradation reason into a healthy run misreports the new
  // partition exactly as badly as reporting nothing.
  /^partition-degraded\.txt$/,
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
 * Field motivation: a field receipt — operator ran /devt:review on a fresh
 * task, the workflow.yaml carried 51 raw_dispatch entries + 6-deep workflow_id_history
 * from a 20-day-old prior workflow chain, KILL gate fired on the first state.update
 * call, agent had to bypass the state machine entirely. /devt:review context_init
 * substep 1 explicitly says "do NOT reset .devt/state/" — correct for resume cases,
 * wrong for new-review-against-stale cases. resetSoft is the missing surgical reset.
 */

const TRUNCATABLE_ARTIFACTS = new Set(["scratchpad.md"]);


// Graphify impact-plan computation — orchestration wrapper for the
// tier-decision tree previously inlined as ~115 lines of bash in
// workflows/code-review.md substep 5. Returns the same JSON shape that the
// workflow used to write to .devt/state/graphify-impact-plan.json:
//   {tier, tool, args, skip_reason, git_provider, pr_scoped_skip_reason,
//    pr_diff_caveat?, symbol_anchored_caveat?, hunk_census?,
//    severity_calibration_note?, topic_symbols_dropped_count?}
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
//   4. any topic symbols OR scope files → DIFF-ANCHORED symbol_anchored:
//      symbols from changed-file hunks first, plus topic symbols that
//      exact-resolve to real graph nodes (dangling orphans + prose words
//      never become anchors)
//   5. no anchors + scope >= IMPACT_THRESHOLD + dense graph → bulk_scoped
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
// with ENOSPC (a field run died at ~132Mi when a Bash stdout-capture failed
// mid-lane), leaving partial work + a stalled lane. This is WARN-ONLY by
// design: a low-disk signal is surfaced so the operator can act, but the
// workflow is never blocked (per the no-defensive-limits-for-low-risk
// principle — user intervention is the failsafe, not a hard stop). One `df`
// call, ~5ms. Always returns ok:true; status is "ok" | "warn" | "unknown".
const _DISK_WARN_MB = 1024; // warn below 1 GiB free


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

// Phrase matches are decisive only below this word count. In a long,
// substantive document a stub phrase is overwhelmingly a quotation or a
// finding sentence, not a placeholder — field case: a 2,242-word lane review
// was flagged as a stub because one verdict sentence contained "not yet
// done". Between the two thresholds, phrases still catch stubs whose
// boilerplate headings inflate word count past the bare minimum.
const STUB_PHRASE_WORD_CEILING = 300;


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


// Substance-verdict helper shared by canonical + lane forms. Returns
// {verdict: "stub"|"substantive"|"unknown", detail?: string}.
// Size-threshold short-circuit at STUB_SIZE_THRESHOLD bytes: empirically,
// outputs above this cap are substantive (no field-observed false negatives);
// outputs at or below the cap warrant the regex scan + word-count check.
// The threshold is generous — common stubs are sub-100 bytes; this gives
// nearly 10x headroom before triggering the deeper check.
const STUB_SIZE_THRESHOLD = 1000;


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
//
// Sizing is DIFF-based: est_loc counts the lines of the lane's generated diff
// artifact (.devt/state/lane-diff-<id>.txt), not whole-file LOC. Whole-file
// counting made the old 800-LOC threshold fire on every real lane (field:
// six lanes at 14K–69K whole-file LOC, zero signal) while the quantity that
// actually predicts lane budget is diff size. Field-calibrated size_class:
//   ok      < 3000 diff lines — no special handling needed
//   chunked ≥ 3000 — lands, but the envelope auto-attaches a chunk-and-
//                    prioritize read instruction (proven at ~8000)
//   split   ≥ 8000 — recommend splitting the lane
//   unknown — diff generation failed (not a git repo / unreachable base);
//             est_loc falls back to whole-file LOC, which carries no
//             threshold signal, so no class is claimed
// repo_root + base_ref are per-lane: a lane may live in a SIBLING repository
// (field case: a frontend repo reviewed alongside the API repo) with its own
// diff base — sizing and the diff artifact must be computed in that repo.
const LANE_DIFF_CHUNKED_THRESHOLD = 3000;

const LANE_DIFF_SPLIT_THRESHOLD = 8000;


// Generated / append-only / lockfile paths inflate a lane's diff-LOC without
// adding reviewable logic — a 15k-line changelog archive or a lockfile bump is
// a doc-skim, not a line-by-line review. They stay IN the lane's coverage (the
// diff artifact keeps every file), but are discounted from the SIZING count
// that drives size_class, so a lane whose diff is mostly generated churn does
// not trip a spurious "split". Generic (not project-tailored) + extendable via
// config review.size_exclude_globs (extra regex source strings).
const SIZING_EXCLUDE_DEFAULT = [
  /(^|\/)[^/]*\.lock$/i,
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|go\.sum)$/i,
  /(^|\/)CHANGELOG[^/]*\.md$/i,
  /(^|\/)[^/]*-ARCHIVE\.md$/i,
  /(^|\/)[^/]*\.min\.(js|css)$/i,
  /\.(map|snap)$/i,
];

module.exports = {
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
  TERMINAL_VERDICTS,
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
};
