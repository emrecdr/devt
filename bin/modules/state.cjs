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
  workflowIdChainSet, scopeInputFiles,
  _getFlag,
  _activeRange,
} = require("./state-io.cjs");
const {
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
} = require("./state-gates.cjs");
const {
  slugifyLaneName,
  listLaneOutputs, laneSeverityTally,
  _sizingExcludePatterns,
  _laneSizingLines,
  generateLaneDiff,
  registerLane,
  registerLanesFromYaml,
  updateLane,
} = require("./state-lanes.cjs");
const {
  assertGraphifyDecision,
  graphifyRoi,
  computeGraphifyImpactPlan,
  contextInitScopeSig,
  assertScopeCheckHandled,
  assertScopeComplete,
  assertGraphifySourceTagged,
  graphifyFallbackTrace,
} = require("./state-graphify.cjs");

function _activeSubagentNames() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(getStateDir(), "status.json"), "utf8"));
    const agents = (data && data.agents) || {};
    const now = Date.now();
    const active = [];
    for (const [name, info] of Object.entries(agents)) {
      if (!info || info.status !== "running") continue;
      const ts = Date.parse(info.timestamp || "");
      if (Number.isFinite(ts) && (now - ts) > _ACTIVE_SUBAGENT_FRESH_MS) continue;
      active.push(name);
    }
    return active;
  } catch { return []; }
}

function _guardConcurrentRotation(operation) {
  let mode = "block";
  try {
    const cfg = require("./config.cjs").getMergedConfig();
    if (cfg && typeof cfg.lane_state_guard === "string") mode = cfg.lane_state_guard;
  } catch { /* default block */ }
  if (mode === "off") return;
  const active = _activeSubagentNames();
  if (active.length === 0) return;
  const msg = `lane_state_guard: refusing ${operation} — ${active.length} subagent(s) still running (${active.slice(0, 4).join(", ")}). workflow.yaml + workflow_id are orchestrator-owned; a lane subagent must update only its own status via 'state update-lane <id> status=...', never rotate/reset/init the shared workflow (this is the concurrent-rotation corruption). Override: config.lane_state_guard=warn|off.`;
  if (mode === "warn") {
    try { process.stderr.write(msg + "\n"); } catch { /* best-effort */ }
    return;
  }
  throw new Error(msg);
}


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
      _guardConcurrentRotation("state update (workflow_id first-activation)");
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
      _guardConcurrentRotation(`state update (workflow_type transition ${previousWorkflowType}->${current.workflow_type})`);
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
  _guardConcurrentRotation("state reset (hard)");
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

function resetSoft() {
  const filePath = getWorkflowPath();
  const stateDir = getStateDir();
  _guardConcurrentRotation("state reset-soft");
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

    // code-review-input.md: session-distance eviction, NOT blanket. The file
    // is double-duty — scope_check's documented pre-written-scope escape
    // hatch (operator authors it minutes before launching the review — must
    // survive) AND a prior session's leftover (field: a 123-file stale scope
    // nearly reviewed against a 42-file live diff — must die). The
    // discriminator is the prep window: a deliberate pre-write is minutes
    // old at reset time; anything older than 1h demonstrably predates this
    // session's prep (every auto-reset leg already requires the prior
    // workflow to be >1h old, so mid-prior-session writes fall outside the
    // window too — which a prior-created_at comparison would miss).
    try {
      const criPath = path.join(stateDir, "code-review-input.md");
      if (fs.existsSync(criPath)) {
        const ageMs = Date.now() - fs.statSync(criPath).mtimeMs;
        if (ageMs > 60 * 60 * 1000) {
          fs.unlinkSync(criPath);
          evicted.push("code-review-input.md (stale: " + (ageMs / 3600000).toFixed(1) + "h old — prior-session leftover; pre-writes within 1h survive)");
        }
      }
    } catch { /* stat/unlink failure non-fatal */ }

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
    return { stale: false, reason: "no prior workflow.yaml — fresh start", age_hours: null, task_changed: false, prior_task: null, workflow_type_changed: false, prior_workflow_type: null, prior_completed: false, auto_reset_recommended: false };
  }
  const prev = parseSimpleYaml(fs.readFileSync(filePath, "utf8"));
  const priorTask = prev.task || null;
  const priorCreatedAt = prev.created_at || prev.first_created_at || null;
  const priorWorkflowType = prev.workflow_type || null;
  // A COMPLETED prior workflow has nothing to resume — its counters and
  // artifacts are preserved by resetSoft either way. `status: DONE` alone is
  // NOT a completion marker (phase updates write `phase=X status=DONE`
  // mid-pipeline); the terminal marker is phase=complete with active off.
  // stopped_at/resume_context exclude paused workflows, which are mid-flight
  // resumes regardless of what their last finished phase recorded.
  const priorCompleted = Boolean(
    prev.active !== true &&
    String(prev.phase || "").toLowerCase() === "complete" &&
    !prev.stopped_at && !prev.resume_context
  );

  const taskChanged = Boolean(typeof task === "string" && task.length > 0 && priorTask && priorTask !== task);
  const workflowTypeChanged = Boolean(typeof workflowType === "string" && workflowType.length > 0 && priorWorkflowType && priorWorkflowType !== workflowType);

  let ageHours = null;
  if (priorCreatedAt) {
    const ms = Date.now() - new Date(priorCreatedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) ageHours = ms / (60 * 60 * 1000);
  }

  const ageStale = ageHours !== null && ageHours > 1;
  const stale = Boolean(taskChanged && ageStale);

  // Auto-reset recommendation — non-destructive resetSoft auto-fire on
  // either of two signals, both with the >1h floor (excludes same-session
  // typo retries):
  //   1. task_changed AND workflow_type_changed — unambiguous new working
  //      session (a prior extra age>24h leg forced an interactive prompt on
  //      real session turnover; field case: task+type changed at 16h, silent
  //      reset verified lossless).
  //   2. prior workflow COMPLETED — nothing to resume, so back-to-back runs
  //      of the SAME type (re-review after fixes) auto-reset too. No
  //      task-change requirement here: task equality is fuzzy string
  //      comparison that false-negatives on rephrasings, and a finished
  //      workflow's counters deserve rotation either way (field case:
  //      every back-to-back review prompted despite a 26h-old completed
  //      prior).
  // Interrupted (non-complete) workflows still go through the operator
  // prompt — counters and artifacts may legitimately continue there.
  const autoResetRecommended = Boolean(
    (taskChanged && workflowTypeChanged && ageStale) ||
    (priorCompleted && ageStale)
  );

  let reason = "fresh";
  if (autoResetRecommended && !(taskChanged && workflowTypeChanged)) {
    reason = `auto-reset recommended: prior workflow completed (phase=complete, ${ageHours.toFixed(1)}h old) — nothing to resume, counters rotate for the new run`;
  } else if (autoResetRecommended) {
    reason = `auto-reset recommended: task changed ('${priorTask}' → '${task}'), workflow_type changed ('${priorWorkflowType}' → '${workflowType}'), prior workflow ${ageHours.toFixed(1)}h old — unambiguous new working session`;
  } else if (stale) {
    reason = `task changed ('${priorTask}' → '${task}') and prior workflow is ${ageHours.toFixed(1)}h old; raw_dispatch/claim-check counters carry from prior session and may fire KILL gate on first state update`;
  } else if (taskChanged && !ageStale) {
    reason = `task changed but prior workflow is <1h old — may be typo retry, not resetting`;
  } else if (!taskChanged && ageStale) {
    reason = `task matches prior workflow (${ageHours.toFixed(1)}h old) — legitimate resume`;
  }

  return { stale, reason, age_hours: ageHours, task_changed: taskChanged, prior_task: priorTask, workflow_type_changed: workflowTypeChanged, prior_workflow_type: priorWorkflowType, prior_completed: priorCompleted, auto_reset_recommended: autoResetRecommended };
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



function contextInitBundle({ mode = "review", workflowType = "code_review", scope, primaryBranch, range, taskDefault = "code review" } = {}) {
  const { spawnSync } = require("child_process");
  const selfBin = path.join(__dirname, "..", "devt-tools.cjs");
  const initMode = mode === "workflow" ? "workflow" : "review";
  const proot = findProjectRoot();
  if (!primaryBranch) {
    try {
      const cfg = require("./config.cjs").getMergedConfig();
      primaryBranch = (cfg && cfg.git && cfg.git.primary_branch) || "main";
    } catch { primaryBranch = "main"; }
  }
  const degraded = [];
  // Range is written before any child CLI runs so the entire bundle tree
  // (init, preflight generate, impact-plan) sees one consistent scope; an
  // absent range EXPLICITLY clears any prior value.
  try { updateState([range ? `range=${range}` : "range=null"], { skipGates: true }); } catch { /* state write races handled by callers */ }
  const sh = (args) => {
    try {
      const r = spawnSync("node", [selfBin, ...args], { cwd: proot, encoding: "utf8", timeout: 30000 });
      return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
    } catch (e) { return { ok: false, stdout: "", stderr: String(e && e.message) }; }
  };
  const readBriefJson = () => {
    try { return JSON.parse(fs.readFileSync(path.join(getStateDir(), "preflight-brief.json"), "utf8")); }
    catch { return null; }
  };

  // ── init review (fail-fast; payload needed by the dispatch envelope) ───
  // Runs ahead of the freshness short-circuit so BOTH paths return the init
  // payload — the code-review dispatch envelope fills governing_rules / models
  // / inline_rubrics from it, and a short-circuit must not starve those. init
  // is read-only context assembly; it does not evict graph-impact.md, so it is
  // safe before the freshness check (the eviction-after-freshness invariant is
  // about evict-graphify, not init).
  const initRes = sh(["init", initMode]);
  if (!initRes.ok) {
    return { ok: false, prerequisite_failed: `init ${initMode}`, detail: initRes.stderr || initRes.stdout };
  }
  let initPayload = null;
  try { initPayload = JSON.parse(initRes.stdout); } catch { initPayload = null; }

  // ── Freshness short-circuit (BEFORE any eviction) ──────────────────────
  // Reuse the cached bundle ONLY when it was computed for the SAME review
  // scope AND the same graph head. Freshness is keyed on (scope_sig,
  // graph_head) jointly — NOT on graph freshness alone. A graph-fresh check by
  // itself will serve a bundle from an entirely different review whenever the
  // graph happens to be fresh (field-observed: a PR review served the prior
  // PR's scope_hint / memory_signal / impact-plan). scope_sig is the
  // changed-file signature (independent of the free-text task, which degrades
  // to a generic default); graph_head additionally catches a same-scope resume
  // across an advanced graph, so a stale brief is regenerated, not served.
  try {
    const planPath = path.join(getStateDir(), "graphify-impact-plan.json");
    const brief = readBriefJson();
    const pfresh = sh(["state", "assert-preflight-fresh"]);
    let graphFresh = false, curHead = null;
    try { const f = require("./graphify.cjs").freshness(); graphFresh = !!(f && f.fresh); curHead = (f && f.head) || null; } catch { graphFresh = false; }
    const curSig = contextInitScopeSig(primaryBranch);
    const st = readState();
    const stampSig = st.context_init_scope_sig || null;
    const stampHead = st.context_init_graph_head || null;
    const scopeMatches = curSig !== null && stampSig !== null && curSig === stampSig;
    const headMatches = curHead !== null && stampHead !== null && curHead === stampHead;
    if (scopeMatches && headMatches && fs.existsSync(planPath) && brief && pfresh.ok && graphFresh) {
      const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
      process.stderr.write(`[devt] context-init: reused cached bundle for scope ${curSig} @ graph ${String(curHead).slice(0, 8)} — pass --fresh to force a recompute\n`);
      return {
        ok: true,
        short_circuited: true,
        reason: `cached bundle matches scope_sig=${curSig} + graph_head=${String(curHead).slice(0, 8)}; reused without re-eviction`,
        init: initPayload,
        impact_plan: plan,
        scope_trust: st.scope_trust_json || null,
        memory_signal: st.memory_signal_json || null,
        god_node_warnings: st.god_node_warnings_json || null,
        freshness: brief.staleness || { state: "unknown" },
        degraded_fields: [],
      };
    }
    // Loud signal when a cached bundle exists but belongs to a DIFFERENT scope:
    // recompute rather than silently serving stale context (the field-observed
    // failure mode). Only fires when a real prior stamp is present.
    if (stampSig && curSig && stampSig !== curSig) {
      process.stderr.write(`[devt] context-init: review scope changed (was ${stampSig}, now ${curSig}) — recomputing fresh context instead of serving the cached bundle\n`);
    }
  } catch { /* fall through to full compute */ }

  // ── Prerequisite: activate (fail-fast) ─────────────────────────────────
  // init already ran above; only the activation state-write remains.
  try {
    updateState([
      "active=true", `workflow_type=${workflowType}`, "phase=context_init", "status=DONE",
      "stopped_at=null", "stopped_phase=null", "verdict=null", "repair=null",
      "verify_iteration=0", "resume_context=null", `task=${scope || taskDefault}`,
    ]);
  } catch (e) {
    return { ok: false, prerequisite_failed: "state activate", detail: String(e && e.message) };
  }

  // ── Preflight brief (important; degrade, don't abort) ──────────────────
  const pfGen = sh(["preflight", "generate", scope || taskDefault]);
  if (!pfGen.ok) degraded.push("preflight_brief");

  // ── memory_signal: affects-union PRIMARY + prose-FTS supplement ────────
  // The primary lane is diff-anchored (union of `memory affects` hits over
  // the changed files) for the same reason blast anchors are: a review's
  // anchor genuinely is the diff. Prose FTS stays as a merge-in supplement —
  // its marginal cost is one query — but is OMITTED when empty; only the
  // PRIMARY renders an empty result, and it renders it as a checkable claim
  // ("no ADR/CON/FLOW governs any of the N file(s) scanned for governance"),
  // framed as a GOVERNANCE-scan count — never as a review-completeness scope,
  // which is code-review-input.md (Axis A). The prior "scope file(s)" wording
  // was read by a consolidator as the completeness denominator (proef: a false
  // "complete across 161 files" claim seeded from files_checked). never a bare {}
  // that reads as "no governance applies". Field failure: the prose query
  // returned counts:{} while per-file affects correctly carried ADR/FLOW
  // governance for the same diff. Dev/research workflows deliberately keep
  // the prose-anchored signal — pre-implementation work has no diff yet.
  let memorySignal = null;
  const affectsById = new Map();
  let filesChecked = 0;
  let memAvailable = true;
  // Governance-layer liveness: an EMPTY .devt/memory/ (0 docs) makes the whole
  // ADR/CON/FLOW apparatus + rubric Axis E silently no-op — an empty layer and
  // a genuinely-compliant one produce identical output, so an operator reads
  // the N/A as a pass (proef field case). Detect 0-docs and degrade LOUDLY.
  let governanceActive = true;
  try {
    const { collectChangedFiles } = require("./review-weight.cjs");
    const mem = require("./memory.cjs");
    try { governanceActive = mem.scanDocs().length > 0; } catch { /* scan failed — assume active, don't false-alarm */ }
    const explicit = scopeInputFiles();
    const changed = explicit || collectChangedFiles(findProjectRoot(), primaryBranch || "main", _activeRange() ? { range: _activeRange() } : undefined);
    filesChecked = changed.length;
    for (const f of changed) {
      let hits = [];
      try { hits = mem.getByPath(f) || []; } catch { hits = []; }
      for (const h of hits) {
        const id = h.id || h.doc_id;
        if (!id) continue;
        if (!affectsById.has(id)) affectsById.set(id, { id, title: h.title || "", doc_type: h.doc_type || null, matched_files: [] });
        const e = affectsById.get(id);
        if (e.matched_files.length < 5 && !e.matched_files.includes(f)) e.matched_files.push(f);
      }
    }
  } catch { memAvailable = false; }
  let supplement = null;
  const memRes = sh(["memory", "query", scope || taskDefault, "--signal=3", "--json-compact"]);
  if (memRes.ok && memRes.stdout) {
    try {
      const fts = JSON.parse(memRes.stdout);
      const hasCounts = fts && fts.counts && Object.keys(fts.counts).length > 0;
      const hasTop = fts && Array.isArray(fts.top) && fts.top.length > 0;
      if (hasCounts || hasTop) supplement = { source: "prose-fts", ...fts };
    } catch { /* unparseable — supplement stays absent */ }
  }
  if (!memAvailable && !memRes.ok) {
    // Memory layer genuinely unavailable — an empty {} is the honest shape
    // here ("we could not check"), NOT a no-docs claim.
    memorySignal = {};
    degraded.push("memory_signal");
  } else {
    const docs = Array.from(affectsById.values());
    if (!governanceActive) {
      degraded.push("memory_layer_empty");
      process.stderr.write("[devt] ⚠️ governance layer INACTIVE — .devt/memory/ has 0 ADR/CON/FLOW docs; rubric Axis E and affects governance contribute NOTHING this run (an empty layer looks identical to a compliant one). Project ADRs outside .devt/memory/ are NOT indexed. Populate via /devt:memory promote, or read the Axis-E N/A as honestly-unchecked, not passed.\n");
    }
    memorySignal = {
      mode: "signal",
      governance_active: governanceActive,
      primary: {
        source: "affects-union",
        files_checked: filesChecked,
        count: docs.length,
        docs: docs.slice(0, 20),
        ...(docs.length > 20 ? { truncated_from: docs.length } : {}),
        ...(docs.length === 0 ? { claim: `no ADR/CON/FLOW governs any of the ${filesChecked} file(s) scanned for governance` } : {}),
      },
      ...(supplement ? { supplement } : {}),
    };
  }
  try { updateState([`memory_signal_json=${JSON.stringify(memorySignal)}`]); } catch { /* best-effort cache */ }

  // ── scope-cache → scope_trust (enhancer; honest "empty" on degrade) ────
  const scRes = sh(["preflight", "scope-cache"]);
  if (!scRes.ok) degraded.push("scope_trust");
  let scopeTrust = null;
  try { scopeTrust = readState().scope_trust_json || null; } catch { scopeTrust = null; }
  if (scopeTrust === null) scopeTrust = { trust: "empty", fresh: false };

  // ── freshness + god_node_warnings from the brief (honest absence) ──────
  const brief = readBriefJson();
  let freshness = (brief && brief.staleness) || null;
  if (!freshness) { freshness = { state: "unknown", lag_commits: null, fresh: false }; degraded.push("freshness"); }
  // Tier the staleness for the orchestrator's still-separate prompt decision.
  let stalenessTier = "unknown";
  if (freshness && freshness.state === "ready") {
    let threshold = 10;
    try { const cfg = require("./config.cjs").getMergedConfig(); threshold = (cfg.graphify && cfg.graphify.stale_threshold) || 10; } catch { /* default */ }
    const lag = freshness.lag_commits;
    if (lag === null || lag === undefined) {
      // Working-tree flows have no usable lag anchor. Before defaulting to
      // unknown_lag (an AskUserQuestion + a blanket trust downgrade), check
      // graphify's own build manifest: when every changed code file matches
      // it, the graph IS fresh for this review (field receipt: lanes were
      // told to distrust a graph rebuilt from the exact files under review).
      let manifestFresh = false;
      try {
        const { collectChangedFiles } = require("./review-weight.cjs");
        const files = (scopeInputFiles() || collectChangedFiles(findProjectRoot(), primaryBranch, _activeRange() ? { range: _activeRange() } : undefined))
          .filter(f => /\.(py|js|jsx|ts|tsx|go|rs|rb|java|kt|cs|php|swift|scala|c|cc|cpp|h|hpp)$/i.test(f));
        if (files.length > 0) {
          const mf = require("./graphify.cjs").manifestFreshness(files);
          manifestFresh = !!(mf && mf.available && mf.all_matched);
        }
      } catch { /* manifest unavailable → unknown_lag stands */ }
      stalenessTier = manifestFresh ? "manifest_fresh" : "unknown_lag";
    }
    else if (lag >= threshold) stalenessTier = "stale";
    else if (lag > 0) stalenessTier = "warn";
    else stalenessTier = "fresh";
  }
  // Canonical god_node_warnings shape the code-reviewer agent body parses
  // ({god_node_match, matches, ambiguous}) — mirrors the inline jq the workflow
  // substep used before the collapse so the agent's parser + the ambiguous-
  // bindings surface keep working unchanged.
  const godNodeWarnings = brief
    ? {
        god_node_match: (brief.blast && brief.blast.god_node_match) || false,
        matches: brief.god_nodes || [],
        ambiguous: (brief.blast && brief.blast.ambiguous_details) || [],
      }
    : { god_node_match: false, matches: [], ambiguous: [] };
  try { updateState([`god_node_warnings_json=${JSON.stringify(godNodeWarnings)}`]); } catch { /* best-effort cache */ }

  // ── Eviction (AFTER freshness read) + impact-plan ──────────────────────
  sh(["state", "evict-graphify"]);
  let impactPlan = null;
  try { impactPlan = computeGraphifyImpactPlan({ reviewScope: scope, primaryBranch }); }
  catch { impactPlan = { tier: "skip", tool: "", args: {}, skip_reason: "impact-plan compute failed" }; degraded.push("impact_plan"); }

  // Stamp the freshness key for the NEXT call's short-circuit decision:
  // scope_sig = the changed-file signature of THIS review; graph_head = the
  // graph commit it was computed against. Written even when empty, so a prior
  // review's stamp is cleared rather than left to spuriously match.
  let graphHeadStamp = null;
  try { const f = require("./graphify.cjs").freshness(); graphHeadStamp = (f && f.head) || null; } catch { /* graph unavailable — empty stamp forces next recompute */ }
  const scopeSigStamp = contextInitScopeSig(primaryBranch);
  try { updateState([`context_init_scope_sig=${scopeSigStamp || ""}`, `context_init_graph_head=${graphHeadStamp || ""}`]); } catch { /* best-effort stamp */ }

  return {
    ok: true,
    short_circuited: false,
    init: initPayload,
    impact_plan: impactPlan,
    scope_trust: scopeTrust,
    memory_signal: memorySignal,
    god_node_warnings: godNodeWarnings,
    freshness,
    staleness_tier: stalenessTier,
    degraded_fields: degraded,
  };
}


// Thin mode-specific wrappers over the shared contextInitBundle core. review
// mode runs `init review` (rubrics/inline_rubrics in the payload); workflow
// mode runs `init workflow` (inline_guardrails) and stamps the caller's
// workflow_type. Both return the identical bundle shape so the dispatch
// envelopes + the still-separate gates/MCP/scan-prep steps consume them
// uniformly. memory_signal is gathered for EVERY mode — closing the gap where
// debug + research dispatches previously received no <memory_signal> block.
function reviewContextInit({ scope, primaryBranch, range } = {}) {
  return contextInitBundle({ mode: "review", workflowType: "code_review", scope, primaryBranch, range, taskDefault: "code review" });
}


function workflowContextInit({ workflowType = "dev", scope, primaryBranch } = {}) {
  return contextInitBundle({ mode: "workflow", workflowType, scope, primaryBranch, taskDefault: "development task" });
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


// One-call post-dispatch claim-check. Folds the assert-artifact-present +
// recover-partial-impl ladder — copy-pasted at 5+ dispatch sites — into a
// single routing verdict so each workflow keeps only the routing SEMANTICS
// (what each action means for its agent) and drops the mechanical branching.
// Composes the two existing functions; side-effect-free beyond the
// claim-check-failures.jsonl append assertArtifactPresent already performs
// (do NOT re-persist). recoverPartialImpl handles agents with no
// sidecar/expected_sections gracefully, so it is safe to call for every agent.
// The parallel-lane state machine (code-review-parallel.md) is deliberately
// NOT folded here — its per-lane retry budget + terminal statuses don't map
// onto the 4-action model; that routing stays in workflow prose.
// Compound Stop-hook verb — one CLI spawn replaces the 8-spawn bash/node
// chain hooks/stop.sh used to run at EVERY turn end in all profiles
// (field-measured p50 928ms/fire). Mirrors the retired chain step-for-step
// with a byte-identical output contract:
//   stop_hook_active   → NO output (any stopReason would re-enter the loop)
//   active+incomplete  → WARNING stopReason + stop stamp (stopped_at,
//                        stopped_phase, active=false — the same updateState
//                        args the chain used, so deactivation-gate semantics
//                        are inherited unchanged)
//   otherwise          → base "Workflow stopped" stopReason
// Every leg is best-effort — a failure inside any leg degrades toward the
// base stopReason rather than blocking shutdown. Returns null for the
// no-output leg; the router case prints and exits itself (the shared
// console.log(JSON.stringify(...)) printer can't express silence).
function stopHook() {
  let input = "";
  try { input = fs.readFileSync(0, "utf8"); } catch { /* no stdin piped */ }
  try {
    const d = JSON.parse(input);
    if (d && d.stop_hook_active) return null;
  } catch { /* malformed input → treat as inactive and continue */ }

  let state = {};
  try { state = readState() || {}; } catch { state = {}; }

  // Unconditional knowledge-candidate harvest at every workflow exit — covers
  // raw-dispatch paths that never hit a finalize step. Fire-and-forget.
  try { aggregateKnowledgeCandidates(); } catch { /* never blocks shutdown */ }

  // Session-end curation hint — at most one per cooldown window (the shared
  // decision core touches the stamp when it surfaces).
  let hint = "";
  try { hint = (require("./memory.cjs").candidatesFooterStatus().hint || "").trim(); } catch { hint = ""; }

  const active = state.active === true || state.active === "true";
  const phase = state.phase || "unknown";
  const status = state.status || "";
  const task = String(state.task || "").replace(/\n/g, " ");
  const isComplete = ["complete", "finalize"].includes(phase) || ["DONE", "BLOCKED"].includes(status);

  if (active && !isComplete) {
    try {
      const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      updateState([`stopped_at=${ts}`, `stopped_phase=${phase}`, "active=false"], {});
    } catch { /* stop stamp is best-effort */ }
    let ctx = `WARNING: Workflow stopped before completion. Phase '${phase}' was in progress.`;
    if (task) ctx += ` Task: ${task}.`;
    ctx += " State preserved in .devt/state/. Run /devt:next to resume or /devt:workflow --cancel to reset.";
    if (hint) ctx += ` ${hint}`;
    return { stopReason: ctx };
  }

  const base = "Workflow stopped. State preserved in .devt/state/";
  return { stopReason: hint ? `${base} | ${hint}` : base };
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
    case "changed-files": {
      // Canonical review scope file list: committed range + working tree +
      // untracked, via review-weight's collectChangedFiles union. Workflow
      // prose (scope_check / identify_scope) consumes this instead of raw
      // `git diff base...HEAD` chains, which return an EMPTY set exactly when
      // the review target is uncommitted work.
      const baseArg = args.find(a => a.startsWith("--base="));
      let base = baseArg ? baseArg.slice("--base=".length) : "";
      if (!base) {
        try {
          const cfg = require("./config.cjs").getMergedConfig();
          base = (cfg.git && cfg.git.primary_branch) || "main";
        } catch { base = "main"; }
      }
      // --range=<a>..<b> (or a single ref): explicit commit-range scope for
      // merged-PR / historical reviews where the base...HEAD union is empty
      // by construction. Range mode excludes working-tree/untracked files.
      const rangeArg = args.find(a => a.startsWith("--range="));
      const range = rangeArg ? rangeArg.slice("--range=".length) : null;
      const { collectChangedFiles } = require("./review-weight.cjs");
      const files = collectChangedFiles(findProjectRoot(), base, range ? { range } : undefined);
      return { ok: true, base, range: range || null, count: files.length, files };
    }
    case "review-context-init": {
      const scopeArg = args.find(a => a.startsWith("--scope="));
      const branchArg = args.find(a => a.startsWith("--primary-branch="));
      const rangeArg = args.find(a => a.startsWith("--range="));
      const scope = scopeArg ? scopeArg.slice("--scope=".length) : undefined;
      const primaryBranch = branchArg ? branchArg.slice("--primary-branch=".length) : undefined;
      const range = rangeArg ? rangeArg.slice("--range=".length) : undefined;
      return reviewContextInit({ scope, primaryBranch, range });
    }
    case "workflow-context-init": {
      const wtArg = args.find(a => a.startsWith("--workflow-type="));
      const scopeArg = args.find(a => a.startsWith("--scope="));
      const branchArg = args.find(a => a.startsWith("--primary-branch="));
      const workflowType = wtArg ? wtArg.slice("--workflow-type=".length) : "dev";
      const scope = scopeArg ? scopeArg.slice("--scope=".length) : undefined;
      const primaryBranch = branchArg ? branchArg.slice("--primary-branch=".length) : undefined;
      return workflowContextInit({ workflowType, scope, primaryBranch });
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
    case "assert-dispatch-warnings-acknowledged":
      return traceGate("assert-dispatch-warnings-acknowledged", () => assertDispatchWarningsAcknowledged());
    case "assert-artifact-present":
      return traceGate("assert-artifact-present", () => assertArtifactPresent(args[0]));
    case "assert-claim-checks-resolved":
      return traceGate("assert-claim-checks-resolved", () => assertClaimChecksResolved());
    case "recover-partial-impl":
      return recoverPartialImpl(args[0]);
    case "post-dispatch-check":
      return postDispatchCheck(args[0], args.slice(1));
    case "finalize-gates":
      return finalizeGates(args);
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
    case "assert-all":
      // No traceGate wrapper — runPhaseGates already persists a per-gate
      // trace under the assert-all prefix; double-wrapping would record the
      // aggregate as one more gate.
      return cmdAssertAll(args);
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
    case "reactivate": {
      // SubagentStart fires this: a stop-stamped workflow with NEW agent
      // activity is not stopped — field: a SendMessage-resumed architect ran
      // for ~2.5 min while workflow.yaml said active:false/stopped_at, and
      // /devt:status mis-routed to "resume or start fresh" mid-scan. Clears
      // the stamp only when one exists; otherwise a cheap no-op.
      const st = readState();
      if (!st || !st.stopped_at) return { ok: true, reactivated: false, reason: "no stop stamp present" };
      updateState(["active=true", "stopped_at=null", "stopped_phase=null"], {});
      return { ok: true, reactivated: true, reason: `stop stamp cleared — agent activity resumed after stop at ${st.stopped_at}` };
    }
    case "stop-hook": {
      const r = stopHook();
      // Self-printing: the stop_hook_active leg must emit NOTHING, which the
      // shared console.log(JSON.stringify(run(...))) printer can't express.
      if (r) process.stdout.write(JSON.stringify(r));
      process.exit(0);
    }
    case "derive-reuse-candidates":
      return require("./reuse-search.cjs").deriveReuseCandidates(args.join(" "));
    case "refresh-scope-context":
      return require("./preflight.cjs").scopeCache();
    case "lane-severity-tally":
      return laneSeverityTally();
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
        repoRoot: getFlag("repo-root"),
        baseRef: getFlag("base"),
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
        `Unknown state subcommand: ${subcommand}. Use: read, read-section, read-sidecar, truncate-artifact, update, reset, reset-soft, staleness-check, auto-reset-if-stale, graphify-roi, disk-check, compute-impact-plan, review-context-init, workflow-context-init, mark-claude-mem-skipped, release, validate, sync, prune, audit, cleanup, evict-graphify, evict-workflow-artifacts, assert-graphify-decision, assert-preflight-fresh, assert-claude-mem-harvest, check-agent-output, assert-verifier-ran, assert-verifier-short-circuit, assert-verifier-graded-all-axes, assert-scope-check-handled, assert-lanes-registered, assert-consolidator-dispatched, assert-auto-curator-considered, assert-reuse-analyzed, assert-knowledge-candidates-tagged, assert-preflight-semantic-quality, assert-no-raw-dispatches-this-session, assert-dispatch-warnings-acknowledged, aggregate-knowledge-candidates, derive-reuse-candidates, refresh-scope-context, assert-artifact-present, assert-claim-checks-resolved, recover-partial-impl, post-dispatch-check, finalize-gates, stop-hook, reactivate, check-inherited-edits, assert-file-quiescent, assert-lanes-quiesced, council-trace, assert-council-not-recent, council-validation-material, assert-advisor-diversity, assert-council-budget, arch-scan-trace, assert-arch-scan-fresh, assert-all, assert-wired, assert-scope-complete, autoskill-rej-check, assert-graphify-source-tagged, graphify-fallback-trace, new-instance, list-instances, advance-phase, list-lane-outputs, update-lane, register-lane, register-lanes, lane-severity-tally, changed-files, history`,
      );
  }
}

module.exports = {
  run,
  diskCheck,
  _guardConcurrentRotation,
  _activeSubagentNames,
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

