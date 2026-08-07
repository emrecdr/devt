"use strict";

// state-graphify — the graphify impact-plan computation, decision/scope gates, ROI accounting, and fallback tracing.
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
  _activeRange,
} = require("./state-io.cjs");


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
// Full attestation for an args override. Shared by the gate that rejects a
// partial attestation and by the regeneration path that must carry a complete
// one forward — the two must not drift, or a field the gate demands could be
// silently dropped on rewrite.
const ATTESTATION_FIELDS = Object.freeze([
  "original_args", "override_args", "override_reason", "override_evidence", "override_by", "timestamp",
]);

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
  // Verbatim-OR-attested args contract: the plan's args are the single source
  // of truth for what reaches the MCP tool — but when the GENERATOR is known
  // bad (field: topic.symbols carried truncated docstring fragments and the
  // verbatim rule forced a wasted MCP call on them), an orchestrator may
  // override PROVIDED the override is fully attested in the plan itself. A
  // post-hoc auditor reconstructs: what the generator produced (original_args),
  // what was sent (override_args, cross-checkable via mcp-stats correlation),
  // and why (reason + evidence + who + when). Partial attestation fails —
  // an unexplained override is indistinguishable from improvisation.
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const planPath = path.join(dir, "graphify-impact-plan.json");
    if (fs.existsSync(planPath)) {
      const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
      if (plan && plan.args_overridden === true) {
        const missing = ATTESTATION_FIELDS.filter((k) => {
          const v = plan[k];
          if (v === undefined || v === null) return true;
          if (typeof v === "string") return v.trim() === "";
          if (typeof v === "object") return Object.keys(v).length === 0;
          return false;
        });
        if (missing.length > 0) {
          return {
            ok: false,
            reason: `graphify-impact-plan.json declares args_overridden=true but attestation is incomplete — missing/empty: ${missing.join(", ")}. Verbatim-OR-attested: either send the plan args unmodified, or record the full override attestation in the plan file.`,
            graphify_state: "ready",
            missing_attestation_fields: missing,
          };
        }
      }
    }
  } catch { /* unreadable plan handled by the artifact checks below */ }
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
        "both graph-impact.md AND graphify-skip-reason.txt exist — mutually exclusive. Recovery (content wins): keep graph-impact.md, ensure its first line is a provenance note naming tier=skip when no MCP call ran, and DELETE graphify-skip-reason.txt — do not discard the map to satisfy bookkeeping (augment-impact-map does this absorption itself on skip runs).",
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
        // Accept the whole session id chain (current + original +
        // workflow_id_history), not just current + original — a session can
        // rotate several times between the calls and this gate, and records
        // emitted under an INTERMEDIATE rotation caused a false "fabricated
        // drill-down" positive (field case: 3 real get_neighbors calls under
        // the 5th of 6 chain ids counted as zero). The ts >= anchor bound
        // keeps prior-session records out, since history survives resetSoft.
        const chain = workflowIdChainSet(wfYaml);
        const acceptedIds = chain.ids;
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
                    (chain.anchor_ms === 0 || Date.parse(rec.ts) >= chain.anchor_ms) &&
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
  // lookahead so `src/PaymentService.py` doesn't match symbol `PaymentService` —
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
      primaryBranch = require("./config.cjs").resolvePrimaryBranch(null, cfg);
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

  // The branch diff, fetched at most once per call. Two consumers below need
  // the same `-U0` range — symbol ranking and the hunk census — and each used
  // to fork its own git and hold its own copy of a diff that can run to the
  // 32 MB cap. null means "unavailable", which both consumers degrade on.
  let _branchDiff;
  const branchDiffText = () => {
    if (_branchDiff !== undefined) return _branchDiff;
    try {
      const { spawnSync } = require("child_process");
      const d = spawnSync("git", ["diff", "-U0", `${primaryBranch}...HEAD`], {
        cwd: findProjectRoot(), encoding: "utf8", timeout: 10000, maxBuffer: 32 * 1024 * 1024,
      });
      _branchDiff = (d.status !== 0 || !d.stdout) ? null : d.stdout;
    } catch { _branchDiff = null; }
    return _branchDiff;
  };

  // Identifiers appearing on changed lines of the branch diff. Used to rank
  // the topic list before the cap bites: the incoming order is by topic score
  // (graph centrality), which fills the budget with untouched siblings that
  // merely share a file with a changed symbol while genuinely-changed
  // production functions fall off the tail. Field: a review's args carried a
  // bare TypeVar and 13 untouched DTOs while five changed functions were
  // truncated away. Membership, not definition — a symbol referenced by the
  // diff is in scope for the review even if declared elsewhere.
  const changedSymbolNames = () => {
    const text = branchDiffText();
    if (!text) return null;
    const names = new Set();
    for (const line of text.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line[0] !== "+" && line[0] !== "-") continue;
      for (const m of line.slice(1).matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) names.add(m[0]);
    }
    return names;
  };

  // Rank diff members ahead of the rest, then cut once — kept list and dropped
  // tail are the two halves of one slice, so they cannot disagree. Only pay for
  // the diff when the cap actually truncates something; with no diff signal
  // (detached base, git failure) topic order stands rather than dropping the
  // cap and breaking the verbatim-args contract.
  let ordered = topicSymbolsRaw;
  let topicSymbolsDiffRanked = false;
  if (topicSymbolsRawCount > TOPIC_CAP) {
    const changed = changedSymbolNames();
    if (changed && changed.size > 0) {
      // Stable partition — order within each group is preserved, so ranking
      // only ever promotes diff members past non-members.
      ordered = topicSymbolsRaw.filter((s) => changed.has(s))
        .concat(topicSymbolsRaw.filter((s) => !changed.has(s)));
      topicSymbolsDiffRanked = true;
    }
  }
  const topicSymbols = ordered.slice(0, TOPIC_CAP);
  const topicSymbolsCount = topicSymbols.length;
  const droppedSymbols = ordered.slice(TOPIC_CAP);
  const topicSymbolsDroppedCount = droppedSymbols.length;
  if (topicSymbolsDroppedCount > 0) {
    try { atomicWriteJsonSync(droppedPath, droppedSymbols); } catch { /* best-effort */ }
  } else {
    try { if (fs.existsSync(droppedPath)) fs.unlinkSync(droppedPath); } catch { /* best-effort */ }
  }

  // Config — graphify provider + impact threshold (single config read)
  let gitProvider = "";
  let impactThreshold = 10;
  let severityNoteThreshold = 0.5;
  try {
    const { getMergedConfig } = require("./config.cjs");
    const cfg = getMergedConfig();
    gitProvider = ((cfg && cfg.git && cfg.git.provider) || "").toLowerCase();
    impactThreshold = (cfg && cfg.graphify && typeof cfg.graphify.impact_threshold === "number")
      ? cfg.graphify.impact_threshold : 10;
    severityNoteThreshold = (cfg && cfg.graphify && typeof cfg.graphify.severity_note_threshold === "number")
      ? cfg.graphify.severity_note_threshold : 0.5;
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

  // Graph build anchor + "added after build" ancestry check — shared by the
  // pr_scoped_diff caveat and the symbol_anchored working-tree caveat below.
  const _resolveBuiltAt = () => {
    try {
      const graphifyMod = require("./graphify.cjs");
      const f = graphifyMod.freshness();
      return (f && (f.built_at || f.built_at_commit)) || null;
    } catch { return null; }
  };
  // An added file is "not indexed" ONLY if it was introduced AFTER the graph
  // was built — compare each added file's introducing commit against the
  // graph's build anchor via `git merge-base --is-ancestor`. A matched-files
  // proxy over-fires on indexed-but-symbolless files. Degrade SAFE: when the
  // anchor or an introducing commit can't be resolved (rebase/squash rewrote
  // SHAs), assume INDEXED — false-"not-indexed" is the noisy direction this
  // caveat exists to remove.
  const _countAddedAfterBuild = (spawnSync, proot, builtAt, extRe) => {
    if (!builtAt) return 0;
    const addRes = spawnSync("git", ["diff", "--name-status", "--diff-filter=A", `${primaryBranch}...HEAD`], {
      cwd: proot, encoding: "utf8", timeout: 5000,
    });
    if (addRes.status !== 0) return 0;
    let added = addRes.stdout.split("\n").map(s => s.trim()).filter(Boolean)
      .map(l => l.replace(/^A\s+/, "").trim()).filter(Boolean);
    if (extRe) added = added.filter(f => extRe.test(f));
    return added.filter(file => {
      const introRes = spawnSync("git", ["log", "--diff-filter=A", "--format=%H", "-1", "--", file], {
        cwd: proot, encoding: "utf8", timeout: 5000,
      });
      const intro = (introRes.status === 0 ? introRes.stdout.trim().split("\n")[0] : "").trim();
      if (!intro) return false;
      const anc = spawnSync("git", ["merge-base", "--is-ancestor", intro, builtAt], {
        cwd: proot, timeout: 5000,
      });
      if (anc.status === 0) return false;  // ancestor → indexed
      if (anc.status === 1) return true;   // not ancestor → genuinely new
      return false;                        // unknown (bad SHA) → assume indexed
    }).length;
  };

  // Working-tree blind-spot census for symbol_anchored: the graph indexes
  // commits, so untracked files and files added after the graph build are
  // invisible — blast_radius runs against the last-committed layout.
  // pr_scoped_diff already emits this caveat; symbol_anchored (whose symbols
  // come from the preflight topic, not the diff) stayed silent even when the
  // branch centerpiece was an untracked module and the blast ran against its
  // old path. Untracked count is restricted to code extensions so scratch
  // files don't inflate it.
  const _CODE_EXT_RE = /\.(py|js|jsx|ts|tsx|go|rb|java|kt|cs|rs|php|swift|c|cc|cpp|h|hpp|scala|ex|exs)$/i;
  const countUnindexedWorkingTree = () => {
    let untracked = 0;
    let addedAfterBuild = 0;
    try {
      const { spawnSync } = require("child_process");
      const proot = findProjectRoot();
      const u = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
        cwd: proot, encoding: "utf8", timeout: 5000,
      });
      if (u.status === 0) {
        untracked = u.stdout.split("\n").map(s => s.trim()).filter(f => f && _CODE_EXT_RE.test(f)).length;
      }
      // Census-side only: prose/config files the graph never indexes must not
      // inflate the caveat (pr_scoped_diff's file count stays unfiltered —
      // its "N of M files" framing is about the diff, not the graph).
      addedAfterBuild = _countAddedAfterBuild(spawnSync, proot, _resolveBuiltAt(), _CODE_EXT_RE);
    } catch { /* defaults */ }
    return { untracked, added_after_build: addedAfterBuild, total: untracked + addedAfterBuild };
  };

  // Diff symbols extractor — wraps `graphify symbols-in-files` against
  // the current diff. Only invoked on tier branches that need it.
  const getDiffSymbols = () => {
    let symbols = [];
    let newFilesCount = 0;
    let totalFilesCount = 0;
    let filesWithoutNodes = [];
    let files = [];
    try {
      const { spawnSync } = require("child_process");
      const proot = findProjectRoot();
      // Union collection (committed range + working tree + untracked): an
      // uncommitted branch has an EMPTY base...HEAD diff, which used to zero
      // this extractor exactly when the review scope lived in the working tree.
      const { collectChangedFiles } = require("./review-weight.cjs");
      files = collectChangedFiles(proot, primaryBranch, _activeRange() ? { range: _activeRange() } : undefined);
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
        filesWithoutNodes = Array.isArray(res && res.files_without_nodes) ? res.files_without_nodes : [];
        // Caveat reconciliation via the shared build-SHA ancestry check —
        // see _countAddedAfterBuild above for the degrade-safe semantics.
        newFilesCount = _countAddedAfterBuild(spawnSync, proot, _resolveBuiltAt());
      }
    } catch { /* defaults */ }
    return { symbols, newFilesCount, totalFilesCount, files, files_without_nodes: filesWithoutNodes };
  };

  // Tier decision tree — explicit, no implicit fallbacks. Preserved
  // verbatim from workflows/code-review.md substep 5.
  let tier = "skip";
  let tool = "";
  let args = {};
  let skipReason = "";
  let prDiffCaveat = null;
  let symbolSources = null;
  let anchorsDropped = null;
  let corpusBlindFiles = [];
  let dsFilesForPlan = [];

  if (graphifyState !== "ready") {
    tier = "skip";
    skipReason = `graphify state=${graphifyState}`;
  } else if (prNum && gitProvider === "github") {
    tier = "pr_scoped";
    tool = "mcp__graphify__get_pr_impact";
    args = { pr_number: Number(prNum) };
  } else if (prNum && gitProvider !== "github") {
    const ds = getDiffSymbols();
    dsFilesForPlan = ds.files || [];
    corpusBlindFiles = ds.files_without_nodes || [];
    if (ds.symbols.length > 0) {
      tier = "pr_scoped_diff";
      tool = "mcp__plugin_devt_devt-graphify__blast_radius";
      args = { symbols: ds.symbols };
      prScopedSkipReason = ""; // tier activated — clear prior skip-reason
      if (ds.newFilesCount > 0) {
        prDiffCaveat = `${ds.newFilesCount} of ${ds.totalFilesCount} files are new — symbols extracted via diff-hunk fallback but blast_radius edge data unavailable until "graphify update ." rebuild`;
      }
    } else if (topicSymbolsCount > 0) {
      // Exact-resolution guard: same anchor-quality rule as the main branch.
      let rt = { resolved: [], unresolved: [] };
      try { rt = require("./graphify.cjs").resolveExactSymbols(topicSymbols); } catch { /* graph unavailable → no topic anchors */ }
      anchorsDropped = rt.unresolved;
      if (rt.resolved.length > 0) {
        tier = "symbol_anchored";
        tool = "mcp__plugin_devt_devt-graphify__blast_radius";
        args = { symbols: rt.resolved };
      } else {
        tier = "skip";
        skipReason = "non-GitHub PR: no diff symbols and no topic symbol resolves to a real graph node";
      }
    } else {
      tier = "skip";
      skipReason = "non-GitHub PR but no diff symbols extracted (graph sparse) AND no topic symbols";
    }
  } else if (topicSymbolsCount > 0 || scopeFileCount > 0) {
    // Diff-anchored first: symbols DEFINED in changed hunks are the ground
    // truth of what a review is about. topic.symbols are keyword harvest from
    // the scope TEXT and go junk whenever the prose mentions concepts (field
    // receipt: "TTL"/"ENV"/"Settings" — words from the task sentence — anchored
    // the blast, inflating effect_size and pointing every drill-down at
    // irrelevant modules). Topic symbols participate only when they resolve to
    // a real graph node (exact label + source_file); dangling orphans and
    // prose words never become anchors.
    const ds = getDiffSymbols();
    dsFilesForPlan = ds.files || [];
    corpusBlindFiles = ds.files_without_nodes || [];
    let rt = { resolved: [], unresolved: [] };
    try { rt = require("./graphify.cjs").resolveExactSymbols(topicSymbols); } catch { /* graph unavailable → no topic anchors */ }
    anchorsDropped = rt.unresolved;
    const merged = Array.from(new Set([...ds.symbols, ...rt.resolved])).slice(0, TOPIC_CAP);
    if (merged.length > 0) {
      tier = "symbol_anchored";
      tool = "mcp__plugin_devt_devt-graphify__blast_radius";
      args = { symbols: merged };
      symbolSources = { diff_anchored: ds.symbols, topic_exact: rt.resolved };
    } else if (scopeFileCount >= impactThreshold && graphifyTrust === "dense") {
      tier = "bulk_scoped";
      tool = "mcp__plugin_devt_devt-graphify__query_graph";
      args = { text: reviewScope, limit: 20 };
    } else {
      tier = "skip";
      skipReason = "no anchors: the diff yields no symbols and no topic symbol resolves to a real graph node";
    }
  } else {
    tier = "skip";
    skipReason = "no PR (or non-GitHub), no topic symbols, no scope files";
  }

  // symbol_anchored working-tree caveat — mirrors pr_diff_caveat: warn when
  // blast_radius will run against a committed layout that misses working-tree
  // files (untracked or added after the graph build).
  let symbolAnchoredCaveat = null;
  if (tier === "symbol_anchored") {
    const uw = countUnindexedWorkingTree();
    if (uw.total > 0) {
      symbolAnchoredCaveat = `${uw.total} working-tree file(s) invisible to the graph (${uw.untracked} untracked, ${uw.added_after_build} added after graph build) — blast_radius runs against the last-committed layout; verify hits on moved/new paths manually or rebuild via "graphify update ."`;
    }
  }

  // Manifest-based freshness for the changed files. Working-tree flows have no
  // usable commit anchor (built_at missing or lagging), yet graphify's own
  // manifest records exactly what the build indexed — when every changed file
  // matches it, the graph IS fresh for this review and the working-tree caveat
  // is noise (field receipt: a graph rebuilt 90 minutes earlier from the exact
  // files under review was reported as untrustworthy by the lag model).
  let manifestFreshnessSummary = null;
  if ((tier === "symbol_anchored" || tier === "pr_scoped_diff") && dsFilesForPlan.length > 0) {
    try {
      const mf = require("./graphify.cjs").manifestFreshness(dsFilesForPlan);
      if (mf && mf.available) {
        manifestFreshnessSummary = {
          checked: mf.checked,
          matched: mf.matched,
          drifted: (mf.drifted || []).slice(0, 5),
          missing_from_manifest: (mf.missing_from_manifest || []).slice(0, 5),
          all_matched: !!mf.all_matched,
        };
        if (mf.all_matched) {
          manifestFreshnessSummary.note = "manifest-verified: every changed file matches the graph build (mtime) — treat the graph as FRESH for this scope even when the commit anchor is missing or lagging";
          symbolAnchoredCaveat = null;
        }
      }
    } catch { /* graph module unavailable — plan proceeds without manifest data */ }
  }

  // Corpus-blindness caveat: changed files the graph carries NO nodes for.
  // Every graph query about them returns silence — the reviewer must know
  // that silence is blindness, not safety.
  let corpusBlindCaveat = null;
  if (corpusBlindFiles.length > 0) {
    corpusBlindCaveat = `graph has NO nodes for changed file(s): ${corpusBlindFiles.slice(0, 8).join(", ")}${corpusBlindFiles.length > 8 ? ` (+${corpusBlindFiles.length - 8})` : ""} — their symbols and callers are invisible to every graph query (upstream corpus exclusion); regex-fallback anchors from them carry no edge data. Use grep/LSP for their caller sets and treat graph silence about them as blindness, not safety.`;
  }

  // Hunk-type census → severity-calibration note. effect_size is computed
  // from graph degree (popularity of the touched symbols), so a branch whose
  // hunks are overwhelmingly comment/import/prose edits still scores "large"
  // and inflates lane severity. The census classifies each diff hunk by its
  // changed lines (framework/language-general regexes, no project coupling);
  // when the cosmetic ratio crosses graphify.severity_note_threshold the plan
  // carries a calibration note for graph-impact.md. The note keeps the
  // caller-set clause deliberately — the discount must not become an excuse
  // to skip wiring/cascade checks.
  const hunkCensus = () => {
    try {
      const diffText = branchDiffText();
      if (!diffText) return null;
      const PROSE_EXT = /\.(md|rst|txt|adoc)$/i;
      // A changed line is cosmetic when blank, comment-only, or import/using/
      // require-only. Language-general by construction (Python/JS/TS/Go/Java/
      // C#/Ruby/SQL comment + import forms) — never project symbol names.
      const COSMETIC_LINE = /^\s*$|^\s*(#|\/\/|\/\*|\*|--|;|"""|''')|^\s*(import\s|from\s+\S+\s+import\b|require\s*\(|using\s|use\s|include\s)/;
      let total = 0;
      let cosmetic = 0;
      let currentFileProse = false;
      let inHunk = false;
      let hunkCosmetic = true;
      const closeHunk = () => {
        if (inHunk) { total++; if (hunkCosmetic) cosmetic++; inHunk = false; }
      };
      for (const line of diffText.split("\n")) {
        if (line.startsWith("diff --git")) {
          closeHunk();
          const m = line.match(/ b\/(.+)$/);
          currentFileProse = m ? PROSE_EXT.test(m[1]) : false;
          continue;
        }
        if (line.startsWith("@@")) { closeHunk(); inHunk = true; hunkCosmetic = true; continue; }
        if (!inHunk || line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+") || line.startsWith("-")) {
          if (currentFileProse) continue; // prose-file hunks count as cosmetic
          if (!COSMETIC_LINE.test(line.slice(1))) hunkCosmetic = false;
        }
      }
      closeHunk();
      let renames = 0;
      const { spawnSync } = require("child_process");
      const r = spawnSync("git", ["diff", "--name-status", "-M90", `${primaryBranch}...HEAD`], {
        cwd: findProjectRoot(), encoding: "utf8", timeout: 10000,
      });
      if (r.status === 0) renames = r.stdout.split("\n").filter(l => /^R(9\d|100)\t/.test(l)).length;
      return {
        total_hunks: total,
        cosmetic_hunks: cosmetic,
        cosmetic_ratio: total > 0 ? Number((cosmetic / total).toFixed(2)) : 0,
        high_similarity_renames: renames,
      };
    } catch { return null; }
  };
  let census = null;
  let severityCalibrationNote = null;
  if (tier !== "skip") {
    census = hunkCensus();
    if (census && census.total_hunks >= 3 && census.cosmetic_ratio >= severityNoteThreshold) {
      const renameClause = census.high_similarity_renames > 0
        ? `; rename-similarity ≥90% on ${census.high_similarity_renames} file pair(s)` : "";
      severityCalibrationNote = `${census.cosmetic_hunks} of ${census.total_hunks} diff hunks are comment/import/prose-only (${Math.round(census.cosmetic_ratio * 100)}%${renameClause}) — a large effect_size reflects the popularity of the touched symbols, not behavioral change surface. Weight findings by actual semantic delta, but use the caller sets to verify no import-order/wiring regressions.`;
    }
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
  if (symbolAnchoredCaveat) plan.symbol_anchored_caveat = symbolAnchoredCaveat;
  if (census) plan.hunk_census = census;
  if (severityCalibrationNote) plan.severity_calibration_note = severityCalibrationNote;
  if (topicSymbolsDroppedCount > 0) {
    plan.topic_symbols_dropped_count = topicSymbolsDroppedCount;
    // Whether the truncation was diff-ranked or fell back to topic order —
    // a reader auditing what was dropped needs to know which ordering produced
    // the tail. Diff-ranking is safe to apply to this budget ONLY because the
    // structural signal (high-edge/god-node symbols) reaches the impact map
    // through graphify's post-MCP augmentation, which does not draw on this
    // budget. If augmentation ever becomes coupled to it, this budget must
    // reserve slots for high-edge symbols again.
    plan.topic_symbols_diff_ranked = topicSymbolsDiffRanked;
  }
  if (symbolSources) plan.symbol_sources = symbolSources;
  if (anchorsDropped && anchorsDropped.length > 0) plan.anchors_dropped = anchorsDropped;
  if (corpusBlindFiles.length > 0) plan.corpus_blind_files = corpusBlindFiles;
  if (corpusBlindCaveat) plan.corpus_blind_caveat = corpusBlindCaveat;
  if (manifestFreshnessSummary) plan.manifest_freshness = manifestFreshnessSummary;

  // An attested override is a deliberate deviation with evidence attached, and
  // regeneration must not silently revert it. Field: a context-init re-anchor
  // rewrote this file mid-review, dropping args_overridden plus the whole
  // attestation and restoring the generated args the orchestrator had rejected.
  // assert-graphify-decision passed clean afterwards — it only inspects an
  // attestation when args_overridden === true, so a wiped one is invisible to
  // it, while the impact map still cited an attestation that no longer existed.
  // The map is regenerable from the graph; the audit trail is not.
  try {
    const prior = fs.existsSync(planPath) ? JSON.parse(fs.readFileSync(planPath, "utf8")) : null;
    if (prior && prior.args_overridden === true) {
      if (prior.tier === plan.tier) {
        // Same tier — the override still targets this tool, so it stays in
        // force. Carried forward even when incomplete, so the gate keeps its
        // ability to reject a partial attestation instead of seeing it vanish.
        plan.args_overridden = true;
        for (const k of ATTESTATION_FIELDS) {
          if (prior[k] !== undefined) plan[k] = prior[k];
        }
        if (prior.override_args !== undefined) plan.args = prior.override_args;
        plan.regenerated_args = args;
        plan.regenerated_at = new Date().toISOString();
      } else {
        // Tier changed: the override was written against a different tool and
        // reapplying it would send the wrong args. It still may not vanish —
        // park it so an auditor sees the deviation and why it stopped applying.
        plan.superseded_attestation = { tier: prior.tier };
        for (const k of ATTESTATION_FIELDS) {
          if (prior[k] !== undefined) plan.superseded_attestation[k] = prior[k];
        }
      }
    }
  } catch { /* unreadable prior plan — regenerate clean */ }

  try { atomicWriteJsonSync(planPath, plan); } catch { /* best-effort */ }
  return plan;
}


// Compound review context_init (cal #39.B). Collapses the data-gathering
// substeps of code-review.md (init + state-activate + preflight brief +
// memory_signal + scope-cache + freshness/eviction + impact-plan + god-node
// warnings) into ONE call, removing ~15 of the orchestrator's ~19 LLM
// round-trips. The gates (substep 8) + the staleness AskUserQuestion (substep
// 4 prompt) + the MCP impact-plan execution (substep 6) deliberately STAY
// separate orchestrator steps — bundling a gate verdict into JSON would make
// an unskippable wall skimmable. Returns a bundle exposing the fields the
// still-separate steps consume: {impact_plan.tier/args, freshness/
// staleness_tier, scope_trust, god_node_warnings, memory_signal}.
//
// Design constraints (greenfield receipt #11):
//  - Per-field GRACEFUL DEGRADATION with HONEST ABSENCE: a degraded field
//    reports freshness:"unknown"/scope_trust:"empty"/god_node_warnings:[],
//    NEVER a false-confident "fresh"/"dense" (a false "fresh" is worse than a
//    graphify outage — it tells reviewers a signal is present when it isn't).
//  - FAIL-FAST only on a true PREREQUISITE (init itself, governing-rules) —
//    graphify is an enhancer; its outage degrades, never aborts.
//  - FRESHNESS short-circuit checked BEFORE eviction: a clean resume must not
//    evict the graph-impact.md it's about to reuse.
// Scope signature for the context-init freshness key: a hash of the review's
// changed-file set (git three-dot / merge-base diff vs the primary branch),
// anchored to the current commit. This is "what this review is about". Keying
// freshness on this — NOT the free-text task, which routinely degrades to a
// generic default like "code review" — is what lets a scope change invalidate
// a cached bundle even when the graph is fresh. The HEAD anchor keeps the
// signature stable and scope-distinguishing when the diff-vs-primary is empty
// (the review is ON the primary branch, or the base ref is unresolved).
// Returns null only when neither a diff nor a HEAD can be read (no git at all);
// a null signature never matches a stored stamp, so the caller falls through to
// a full recompute — the safe direction (a false full-compute costs a few
// round-trips; a false short-circuit serves the wrong review's context).
function contextInitScopeSig(primaryBranch) {
  try {
    const { execFileSync } = require("child_process");
    const proot = findProjectRoot();
    const base = primaryBranch || "main";
    const runGit = (args) => execFileSync("git", args, { cwd: proot, encoding: "utf8", timeout: 10000 }).trim();
    let files = [];
    // Explicit scope (pre-written code-review-input.md) IS the scope universe —
    // fold it into the signature so a scope-file change invalidates the cache
    // the same way a diff change does.
    try {
      const { scopeInputFiles } = require("./state-io.cjs");
      const explicit = scopeInputFiles();
      if (explicit) files = explicit.slice().sort();
    } catch { /* fall through to diff */ }
    if (files.length === 0) try {
      files = runGit(["diff", "--name-only", `${base}...HEAD`]).split("\n").map(s => s.trim()).filter(Boolean).sort();
    } catch { /* base ref unresolvable — fall through to the HEAD-only signature */ }
    let head = "";
    try { head = runGit(["rev-parse", "HEAD"]); } catch { head = ""; }
    if (files.length === 0 && !head) return null;
    return require("crypto").createHash("sha1").update(head + "\n" + files.join("\n")).digest("hex").slice(0, 16);
  } catch { return null; }
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

module.exports = {
  assertGraphifyDecision,
  graphifyRoi,
  computeGraphifyImpactPlan,
  contextInitScopeSig,
  assertScopeCheckHandled,
  assertScopeComplete,
  assertGraphifySourceTagged,
  graphifyFallbackTrace,
};
