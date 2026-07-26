"use strict";

// state-gates — the assert-* enforcement gates, phase-gate registry, claim-check + gate-trace persistence, and dispatch/finalize composites.
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
const {
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
} = require("./state-io.cjs");


function checkAgentOutput(filePath, opts) {
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, reason: "no path provided" };
  }
  // Relative resolution tries project root first (preserves `.devt/state/x`
  // style callers), then the state dir — workflow prose passes bare artifact
  // names (`check-agent-output review.md`), which previously joined to the
  // project ROOT and reported every state artifact as missing.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  let abs = path.isAbsolute(filePath) ? filePath : path.join(findProjectRoot(), filePath);
  if (!path.isAbsolute(filePath) && !fs.existsSync(abs)) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const inState = path.join(getStateDir(), filePath);
    if (fs.existsSync(inState)) abs = inState;
  }
  if (!fs.existsSync(abs)) {
    // A missing output is a substance FAILURE, not a pass. Consumers grep
    // `looks_like_stub == true` to detect non-substantive output; the prior
    // `false` here let a missing file fall through to the pass branch (the
    // race that left a lane silently uncovered). Set looks_like_stub:true so
    // every consumer hard-fails; `missing:true` lets coverage reporting tell a
    // zero-output lane apart from a present-but-stub one.
    return {
      ok: false,
      path: filePath,
      looks_like_stub: true,
      missing: true,
      reason: `file does not exist: ${filePath}`,
    };
  }
  let content = "";
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch (e) {
    return { ok: false, path: filePath, looks_like_stub: true, reason: `read failure: ${e.message}` };
  }
  // Zero-byte / whitespace-only is a substance failure, same class as missing.
  if (content.trim().length === 0) {
    return {
      ok: false,
      path: filePath,
      looks_like_stub: true,
      empty: true,
      word_count: 0,
      reason: `file is empty (zero substantive bytes): ${filePath}`,
    };
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
    wordCount < STUB_WORD_COUNT_THRESHOLD ||
    allHeadings ||
    (stubPhrasesFound.length > 0 && wordCount < STUB_PHRASE_WORD_CEILING);
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
  let tier = null;
  try {
    const stateData = readState();
    workflowType = stateData && stateData.workflow_type;
    tier = stateData && stateData.tier;
  } catch { /* fall through — treat as unknown, apply gate */ }
  if (workflowType && !VERIFIER_REQUIRED_WORKFLOWS.has(workflowType)) {
    return {
      ok: true,
      verification_enabled: true,
      workflow_type: workflowType,
      reason: `workflow_type=${workflowType} does not dispatch a verifier by design — gate does not apply`,
    };
  }
  // Tier opt-out (dev only): SIMPLE/TRIVIAL dev tasks run only implement→test→
  // review — the verify step is STANDARD+ only, so requiring a verification
  // artifact for those tiers would false-block a correct SIMPLE/TRIVIAL run.
  // code_review / code_review_parallel carry no tier and always verify, so they
  // are unaffected. This is what makes assert-verifier-ran safe to add to the
  // dev::complete gate set (closing the gap where a STANDARD dev task could
  // silently skip verify with nothing catching it).
  if (workflowType === "dev" && (tier === "SIMPLE" || tier === "TRIVIAL")) {
    return {
      ok: true,
      verification_enabled: true,
      workflow_type: "dev",
      tier,
      reason: `tier=${tier} runs no verify step (STANDARD+ only) — gate does not apply`,
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


// Mechanical gate for code-review-parallel.md::dispatch_lanes. partition_lanes
// is supposed to populate workflow.yaml::lanes[] via state update-lane calls.
// Why this gate exists: orchestrators can skip lane registration entirely;
// list-lane-outputs then returns {"lanes":[]} despite lanes being dispatched
// manually. This gate fails when partition_lanes runs but produces zero lane
// records — forcing the orchestrator to either register lanes or fall back
// to single-dispatch explicitly.
function assertLanesRegistered() {
  // Lazy require: lane CRUD lives in state-lanes.cjs; call-time require
  // avoids a load-order cycle (lanes never requires gates back).
  const { listLaneOutputs } = require("./state-lanes.cjs");
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
  // Lazy require: lane CRUD lives in state-lanes.cjs; call-time require
  // avoids a load-order cycle (lanes never requires gates back).
  const { listLaneOutputs } = require("./state-lanes.cjs");
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
  // Provenance-stamp path (preferred): render-filled stamped dispatch intent
  // (cid + ts) and the synthesis agent embedded the same cid in review.md's
  // header. Proves "review.md came from a dispatched synthesis agent" without
  // a side-file duty the agent can forget — field: a consolidator produced
  // perfect artifacts but never wrote the marker until nudged. Still catches
  // hand-written review.md (no stamp / no embedded cid) and
  // died-before-artifact (stamp, no artifact / mtime precedes stamp).
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const stampsPath = path.join(dir, "dispatch-stamps.jsonl");
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const reviewPath = path.join(dir, "review.md");
    if (fs.existsSync(stampsPath) && fs.existsSync(reviewPath)) {
      const embedded = (fs.readFileSync(reviewPath, "utf8").match(/Correlation:\s*(cid_[A-Za-z0-9_-]+)/) || [])[1];
      if (embedded) {
        for (const line of fs.readFileSync(stampsPath, "utf8").split("\n").filter(Boolean)) {
          let rec; try { rec = JSON.parse(line); } catch { continue; }
          if (rec && rec.cid === embedded && rec.agent === "code-reviewer") {
            const stampTs = Date.parse(rec.ts);
            if (!isNaN(stampTs) && fs.statSync(reviewPath).mtimeMs > stampTs) {
              return {
                ok: true,
                source: "provenance_stamp",
                cid: embedded,
                substance_pass_count: substancePassCount,
                reason: `review.md embeds ${embedded} matching a render stamp that predates the artifact — dispatched synthesis proven`,
              };
            }
          }
        }
      }
    }
  } catch { /* stamp evidence unavailable — legacy marker path below */ }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const markerPath = path.join(dir, "consolidator-ran.txt");
  if (!fs.existsSync(markerPath)) {
    return {
      ok: false,
      reason:
        `${substancePassCount} lanes passed substance but no provenance evidence — ` +
        "neither a render stamp matched by a `Correlation: cid_…` header in review.md " +
        "nor the legacy consolidator-ran.txt marker. Dispatch the code-reviewer with " +
        "the synthesis envelope (render-filled stamps intent automatically; the " +
        "template mandates the Correlation header).",
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
  // Lazy require: lane CRUD lives in state-lanes.cjs; call-time require
  // avoids a load-order cycle (lanes never requires gates back).
  const { listLaneOutputs } = require("./state-lanes.cjs");
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
  // Lazy require: lane CRUD lives in state-lanes.cjs; call-time require
  // avoids a load-order cycle (lanes never requires gates back).
  const { listLaneOutputs } = require("./state-lanes.cjs");
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
      reason: `all ${terminal.length} lane(s) reached terminal status (substance_pass | stub_redispatched | deferred | lane_failed)`,
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
    // A nag without an on-ramp is a dead end (field-reported): name the exact
    // command that creates the baseline. arch_scanner.command configured →
    // that command IS the on-ramp; unconfigured → say how to wire one.
    let onramp = "no arch_scanner configured — set arch_scanner.command in .devt/config.json (or place a scanner at .devt/rules/arch-scan.py) and run /devt:review --focus=arch once to create the baseline";
    try {
      const cmd = ((require("./config.cjs").getMergedConfig() || {}).arch_scanner || {}).command;
      if (cmd) onramp = `create the baseline once with: ${cmd} (one scanner pass; then /devt:review --focus=arch keeps it current)`;
    } catch { /* config unreadable — generic on-ramp stands */ }
    return {
      ok: false,
      reason: `arch-scan-report.md not found in either per-instance dir or legacy root — no arch scan has run for this project. On-ramp: ${onramp}`,
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
  // Deliberately NOT io.cjs::listTrackedFiles — assert-wired must distinguish
  // "git unavailable" (return {ok:false, reason} so the caller reports why the
  // check couldn't run) from "no matching files", which the []-on-error helper
  // collapses together.
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
  // Lazy require: the graphify-flavored gates live in state-graphify.cjs;
  // requiring at call time (result memoized below) avoids a load-order cycle
  // between the gates and graphify submodules.
  const { assertGraphifyDecision, assertScopeCheckHandled } = require("./state-graphify.cjs");
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
    "assert-dispatch-warnings-acknowledged": assertDispatchWarningsAcknowledged,
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
      const t0 = Date.now();
      try { result = fn(); }
      catch (e) { result = { ok: false, reason: `gate ${gateName} threw: ${e.message}` }; }
      result._elapsed_ms = Date.now() - t0;
    }
    persistGateTrace(`${tracePrefix}:${gateName}`, result);
    // detail carries the gate's own evidence payload (claim-check unresolved
    // ids, axis-H counts, warning ids …) — a bare ok/reason pair forces the
    // consumer back to per-gate re-runs to see what actually failed.
    gateResults.push({ gate: gateName, ok: !!result.ok, reason: result.reason || "", elapsed_ms: result._elapsed_ms ?? null, detail: result });
    if (result.ok === false) blockedBy.push({ gate: gateName, reason: result.reason || "" });
  }
  return { fired: true, gateResults, blockedBy };
}


// One-call gate runner for a declared phase: every registered gate for
// (current workflow_type, --phase) in one JSON verdict, with a NONZERO EXIT
// CODE on any failure. The exit code is the load-bearing part — orchestrator
// shell pipelines that mangle output (unquoted-var no-ops, jq on empty
// stdin) render failures as blank text that reads like a pass; an exit code
// survives any output mangling. Sources the SAME registry advance-phase
// consults — a hand-listed gate set would drift exactly like the copy-pasted
// step bodies once did.
function cmdAssertAll(args) {
  const phase = _getFlag(args || [], "--phase");
  if (!phase) {
    process.exitCode = 1;
    return { ok: false, reason: "Usage: state assert-all --phase=<phase>" };
  }
  let st = {};
  try { st = readState(); } catch { /* empty state — gates run with null type below */ }
  const workflowType = st.workflow_type || null;
  const run = runPhaseGates(workflowType, phase, { tracePrefix: "assert-all" });
  if (!run.fired) {
    return { ok: true, all_ok: true, phase, workflow_type: workflowType, workflow_id: st.workflow_id || null, registry_count: 0, gates_run: 0, gates: [], note: run.note };
  }
  const allOk = run.blockedBy.length === 0;
  if (!allOk) process.exitCode = 1;
  return {
    ok: allOk,
    all_ok: allOk,
    phase,
    workflow_type: workflowType,
    workflow_id: st.workflow_id || null,
    registry_count: run.gateResults.length,
    gates_run: run.gateResults.length,
    gates: run.gateResults,
  };
}


function postDispatchCheck(agent, args) {
  if (!agent || typeof agent !== "string" || agent.startsWith("--")) {
    return { ok: false, action: "investigate", reason: "Usage: state post-dispatch-check <agent> [--iteration=N] [--max-iterations=M]" };
  }
  const iteration = parseInt(_getFlag(args || [], "--iteration"), 10);
  const maxIterations = parseInt(_getFlag(args || [], "--max-iterations"), 10);
  const hasBudget = Number.isFinite(iteration) && Number.isFinite(maxIterations);
  const budgetExhausted = hasBudget && iteration >= maxIterations;

  const claim = assertArtifactPresent(agent); // persists claim-check-failures.jsonl
  let recover;
  try { recover = recoverPartialImpl(agent); }
  catch (e) { recover = { recovery_needed: false, reason: `recover-partial-impl unavailable: ${(e && e.message) || e}` }; }
  const sugg = recover && recover.suggested_action;

  let action, reason, resumeHint = null;
  if (claim.ok === true && (!recover || recover.recovery_needed === false)) {
    action = "proceed";
    reason = claim.reason || "artifact present and substantive — proceed.";
  } else if (sugg === "SendMessage-resume" || sugg === "targeted-fix") {
    action = "sendmessage_resume";
    reason = recover.reason || "partial output — resume the same agent instead of re-dispatching.";
    resumeHint = sugg === "targeted-fix"
      ? { kind: "structural_drift", missing_sections: (recover.drift && recover.drift.missing_sections) || [], mode: recover.mode || null, fix_template: "templates/dispatch/envelopes/programmer-fix.tmpl.md" }
      : { kind: "rate_limit", low_output: recover.low_output === true, output_bytes: recover.output_bytes ?? null };
  } else if (sugg === "investigate") {
    action = "investigate";
    reason = recover.reason || "stub output with no rate-limit signal — investigate the transcript before re-dispatching.";
  } else if (budgetExhausted) {
    action = "investigate";
    reason = `artifact missing after ${iteration}/${maxIterations} iterations — retry budget exhausted, escalate to the user. (${claim.reason || (recover && recover.reason) || ""})`;
  } else {
    action = "redispatch";
    reason = claim.reason || (recover && recover.reason) || "artifact missing — re-dispatch the agent.";
  }

  return {
    ok: action === "proceed",
    agent,
    action,
    reason,
    ...(hasBudget ? { iteration, max_iterations: maxIterations, budget_exhausted: budgetExhausted } : {}),
    ...(resumeHint ? { resume_hint: resumeHint } : {}),
    claim_check: claim,
    ...(recover && recover.recovery_needed ? { partial_recovery: recover } : {}),
  };
}


// One-call finalize gate. Runs aggregate-knowledge-candidates FIRST (so the
// knowledge-candidates gate counts freshly-harvested tags), then the SAME
// phase-gate registry runner as assert-all/advance-phase — single-sourcing the
// gate set so the CC/RD/KC trio can't drift out of sync across the five
// finalize sites that used to copy-paste it. Nonzero exit code on any block
// (survives shell-output mangling, exactly like cmdAssertAll).
//
// Deliberately does NOT truncate scratchpad: the caller's terminal
// `advance-phase` re-runs the KC gate through the same registry, so truncating
// here would empty scratchpad before that re-check and fail it whenever the run
// tagged candidates (rather than none-declaring). The scratchpad truncate stays
// the caller's LAST step, after advance-phase — the KC-before-truncate ordering
// preserved by position.
function finalizeGates(args) {
  const phaseFlag = _getFlag(args || [], "--phase");
  let st = {};
  try { st = readState(); } catch { /* empty state — gates run with null type below */ }
  const workflowType = st.workflow_type || null;
  // Default to each workflow_type's TERMINAL phase key (the one carrying the
  // full gate set) — `debug`/`arch_health_scan` name their terminal phase after
  // themselves; everything else finalizes at `complete`. An explicit --phase
  // always wins (and must name a phase the registry declares gates for).
  const phase = phaseFlag || (
    workflowType === "debug" ? "debug"
      : workflowType === "arch_health_scan" ? "arch_health_scan"
        : "complete"
  );

  let aggregated;
  try { aggregated = aggregateKnowledgeCandidates(); }
  catch (e) { aggregated = { ok: false, reason: `aggregate failed: ${(e && e.message) || e}` }; }

  const run = runPhaseGates(workflowType, phase, { tracePrefix: "finalize-gates" });
  const gates = run.fired ? run.gateResults : [];
  const allOk = run.fired ? run.blockedBy.length === 0 : true;

  if (!allOk) process.exitCode = 1;
  return {
    ok: allOk,
    all_ok: allOk,
    phase,
    workflow_type: workflowType,
    workflow_id: st.workflow_id || null,
    aggregated: (aggregated && aggregated.ok !== false)
      ? { aggregated: aggregated.aggregated ?? 0, sources_scanned: aggregated.sources_scanned ?? 0 }
      : aggregated,
    gates_run: gates.length,
    gates,
    ...(run.fired ? {} : { note: run.note }),
  };
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
  // Field signal: a field session accumulated 62 raw_dispatch warnings in
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
  // Two passes: collect in-window raw_dispatch records AND resolution
  // annotations (source='resolution', written by `dispatch warnings resolve
  // <warning_id> --reason=…`). A resolved-with-reason record stops counting
  // against the gate — the proportional remediation for a substantively
  // compliant dispatch the guard couldn't read (e.g. pointer dispatch),
  // replacing the all-or-nothing --skip-gates escape. Records persist either
  // way; resolution is an annotation, never a deletion.
  const rawRecords = [];
  const resolvedIds = new Set();
  const resolvedTsAgent = new Set();
  for (const line of body.split("\n")) {
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.source === "resolution") {
        if (typeof rec.resolves === "string") resolvedIds.add(rec.resolves);
        // Fallback address for legacy records that predate warning_id.
        if (typeof rec.resolves_ts === "string") resolvedTsAgent.add(`${rec.resolves_ts}|${rec.resolves_agent || ""}`);
        continue;
      }
      if (rec.source !== "raw_dispatch") continue;
      if (typeof rec.ts !== "string") continue;
      if (new Date(rec.ts).getTime() < anchorMs) continue;
      rawRecords.push(rec);
    } catch { /* malformed line — skip */ }
  }
  const unresolved = rawRecords.filter(r =>
    !(r.warning_id && resolvedIds.has(r.warning_id)) &&
    !resolvedTsAgent.has(`${r.ts}|${r.agent || ""}`));
  const resolvedCount = rawRecords.length - unresolved.length;
  const agents = unresolved.map(r => r.agent || "(unknown)");
  const rawDispatchCount = agents.length;
  if (rawDispatchCount === 0) {
    return {
      ok: true,
      raw_dispatch_count: 0,
      resolved_count: resolvedCount,
      reason: resolvedCount > 0
        ? `no unresolved raw dispatches in this workflow's window (${resolvedCount} resolved-with-reason — see dispatch warnings list)`
        : "no raw dispatches in this workflow's window",
    };
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
      resolved_count: resolvedCount,
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
      resolved_count: resolvedCount,
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
    resolved_count: resolvedCount,
    unresolved: unresolved.map(r => ({ warning_id: r.warning_id || null, ts: r.ts, agent: r.agent || "(unknown)" })),
    reason:
      `${rawDispatchCount} unresolved raw devt:* dispatch(es) detected in THIS workflow: ${agents.join(", ")}. ` +
      `These bypassed the workflow contract (no <scope_trust>/<scope_hint>/<memory_signal> blocks injected) — agents fell back to grep-quality discovery without graphify-anchored impact maps. ` +
      `Remediation: re-dispatch the agents via the workflow path (/devt:review, /devt:workflow, /devt:debug) which injects the canonical context envelope. ` +
      `If a specific dispatch was substantively compliant (e.g. pointer dispatch that consumed a rendered envelope), resolve THAT record with evidence: dispatch warnings resolve <warning_id> --reason="..." — never --skip-gates, which bypasses every gate on the transition. ` +
      `If raw dispatch was intentional (ad-hoc orchestration), set 'dispatch_hygiene_mode: "warn"' in .devt/config.json to opt the gate out. ` +
      `Note: scope is THIS workflow only (since workflow.yaml::created_at) — prior workflows in the same session are excluded.`,
  };
}


// Mechanical check of review.md's Axis-H claims against the warnings file.
// The axis is graded by the verifier for PRESENCE; the numbers themselves are
// checked here — this gate runs last and needs no model honesty (field: a
// consolidator honestly synthesized lanes' stale "file absent" claims while
// its own dispatch's warning sat in the log; the review's BEHAVIOR was gated,
// its CLAIMS about warnings were not).
//
// Fairness bounds: records are counted in [workflow created_at, review.md
// mtime] — a warning written after the review was authored cannot be blamed
// on its author. Equality required within that window.
function assertDispatchWarningsAcknowledged() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const reviewPath = path.join(dir, "review.md");
  if (!fs.existsSync(reviewPath)) {
    return { ok: false, reason: "review.md absent — nothing to check (run after the review step)" };
  }
  const review = fs.readFileSync(reviewPath, "utf8");
  // LAST section wins: the documented divergence remedy is appending a
  // corrected section from a live read — a first-match parser made that
  // remedy unsatisfiable (field-observed), and edit-in-place erases the
  // pass-1 audit trail.
  const secMatches = [...review.matchAll(/^##\s+Dispatch warnings \(session-scoped\)\s*$([\s\S]*?)(?=^##\s|\n*$(?![\s\S]))/gm)];
  const secMatch = secMatches.length ? secMatches[secMatches.length - 1] : null;
  if (!secMatch) {
    return { ok: false, reason: "review.md has no '## Dispatch warnings (session-scoped)' section (rubric axis H)" };
  }
  const section = secMatch[1];
  const reviewMtime = fs.statSync(reviewPath).mtimeMs;

  // Anchor: same workflow window as assert-no-raw-dispatches.
  let anchorMs = 0;
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const wfYaml = fs.readFileSync(path.join(dir, "workflow.yaml"), "utf8");
    const m = wfYaml.match(/^created_at:\s*"?([^"\n]+)"?\s*$/m);
    if (m) {
      const parsed = new Date(m[1].trim()).getTime();
      if (Number.isFinite(parsed)) anchorMs = parsed;
    }
  } catch { /* no anchor — window unbounded below */ }

  // Actual counts from the file, bounded to [anchor, review mtime].
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const warningsPath = path.join(dir, "dispatch-warnings.jsonl");
  const actual = { raw_dispatch: 0, resolved: 0, cliff_signal: 0 };
  let fileEmpty = true;
  if (fs.existsSync(warningsPath)) {
    const body = fs.readFileSync(warningsPath, "utf8");
    if (body.trim().length > 0) fileEmpty = false;
    const rawInWindow = [];
    const resolvedIds = new Set();
    for (const line of body.split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        const tsMs = rec.ts ? new Date(rec.ts).getTime() : NaN;
        if (rec.source === "resolution") {
          if (Number.isFinite(tsMs) && tsMs <= reviewMtime && typeof rec.resolves === "string") resolvedIds.add(rec.resolves);
          continue;
        }
        if (!Number.isFinite(tsMs) || tsMs < anchorMs || tsMs > reviewMtime) continue;
        if (rec.source === "raw_dispatch") rawInWindow.push(rec);
        else if (rec.source === "task_output_bytes" && rec.signal && rec.signal !== "healthy") actual.cliff_signal++;
      } catch { /* malformed line — skip */ }
    }
    actual.raw_dispatch = rawInWindow.length;
    actual.resolved = rawInWindow.filter(r => r.warning_id && resolvedIds.has(r.warning_id)).length;
  }

  // n/a form is valid only when there is genuinely nothing to report.
  if (/\bn\/a\b/i.test(section) && !/counts:/.test(section)) {
    if (fileEmpty || (actual.raw_dispatch === 0 && actual.cliff_signal === 0)) {
      return { ok: true, claimed: null, actual, reason: "n/a claim consistent — no in-window incidents" };
    }
    return {
      ok: false, claimed: null, actual,
      reason: `review.md claims 'n/a' but the file carries in-window incidents (raw_dispatch=${actual.raw_dispatch}, cliff_signal=${actual.cliff_signal}) — Axis H must be a live read, not inherited from lane sections`,
    };
  }

  const cm = section.match(/counts:\s*raw_dispatch=(\d+)\s+resolved=(\d+)\s+cliff_signal=(\d+)/);
  if (!cm) {
    return {
      ok: false, claimed: null, actual,
      reason: "section lacks the machine-readable first line 'counts: raw_dispatch=N resolved=M cliff_signal=K' (or a valid 'n/a' when nothing is logged)",
    };
  }
  const claimed = { raw_dispatch: parseInt(cm[1], 10), resolved: parseInt(cm[2], 10), cliff_signal: parseInt(cm[3], 10) };
  const mismatches = [];
  for (const k of ["raw_dispatch", "resolved", "cliff_signal"]) {
    if (claimed[k] !== actual[k]) mismatches.push(`${k}: claimed ${claimed[k]} vs actual ${actual[k]}`);
  }
  if (mismatches.length > 0) {
    return {
      ok: false, claimed, actual,
      reason: `Axis-H counts diverge from dispatch-warnings.jsonl (window: workflow start → review.md mtime): ${mismatches.join("; ")}. The section must come from a live read of the file at synthesis time.`,
    };
  }
  return { ok: true, claimed, actual, reason: "Axis-H counts match the file" };
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


// Process-level gate that the orchestrator actually ran `preflight generate`
// in context_init (vs. silently reusing a brief from a prior workflow). Field
// observed in the field: orchestrator started a new workflow at
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
// claude-mem observations — field-validated leak where a project's
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

module.exports = {
  checkAgentOutput,
  assertVerifierRan,
  assertVerifierShortCircuit,
  assertVerifierGradedAllAxes,
  assertLanesRegistered,
  assertConsolidatorDispatched,
  assertAutoCuratorConsidered,
  assertReuseAnalyzed,
  assertKnowledgeCandidatesTagged,
  assertPreflightSemanticQuality,
  assertArtifactPresent,
  _assertArtifactPresentInner,
  _assertLaneArtifactPresent,
  _computeSubstanceVerdict,
  recoverPartialImpl,
  detectInheritedSourceEdits,
  assertFileQuiescent,
  assertLanesQuiesced,
  councilTrace,
  assertCouncilNotRecent,
  councilValidationMaterial,
  assertAdvisorDiversity,
  assertCouncilBudget,
  archScanTrace,
  assertArchScanFresh,
  assertWired,
  autoskillRejCheck,
  parsePhaseGatesYaml,
  PHASE_GATE_FNS_MEMO,
  _phaseGateFns,
  runPhaseGates,
  cmdAssertAll,
  postDispatchCheck,
  finalizeGates,
  persistGateTrace,
  traceGate,
  persistClaimCheckResult,
  assertClaimChecksResolved,
  assertNoRawDispatchesThisSession,
  assertDispatchWarningsAcknowledged,
  aggregateKnowledgeCandidates,
  assertPreflightFresh,
  assertClaudeMemHarvest,
};
