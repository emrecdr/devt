# Shared review steps — verify + auto_curator + present_findings (single source)

This file is the SINGLE SOURCE for the `verify` and `present_findings` step
bodies shared by `workflows/code-review.md` (MODE=single) and
`workflows/code-review-parallel.md` (MODE=parallel). The parent workflows
carry a `SHARED-STEP` pointer at each step's pipeline position and a
mandatory Read directive that loads this file — the same lazy-load mechanism
as the dev-workflow tier partition. Blocks marked **SINGLE-DISPATCH ONLY** /
**PARALLEL ONLY** execute in that mode alone; everything unmarked executes in
both modes. History: these bodies lived copy-pasted in both parents under
KEEP-IN-SYNC banners and drifted — the parallel path silently lost four gates
the single path gained (short-circuit, axes-coverage, claim-check,
raw-dispatch finalize). Single-sourcing makes that class of drift impossible.

<available_agent_types>
The following agent type is dispatched from these shared steps:

- `devt:verifier` — goal-backward verification specialist, READ-ONLY (Read, Bash, Glob, Grep). Grades the review against the pinned rubric; never re-does the review.

The dispatching parents (code-review.md single path, code-review-parallel.md parallel path) declare their own reviewer/consolidator agent surfaces.
</available_agent_types>

---

<step name="verify" gate="verification.json is written or step is skipped">

_Skip this step if `verify` is listed in `skipped_phases` from workflow state._

Grader-driven thoroughness check. The verifier reads `references/rubrics/code_review.v1.md` and spot-checks the review for scope coverage, finding specificity, severity calibration, remediation concreteness, and ADR Compliance section presence. The verifier does NOT re-do the code review — it grades the review's quality and re-dispatches the code-reviewer with structured `revisions[]` when gaps are found. In MODE=parallel the artifact under grade is the consolidated review (written by the synthesis-mode dispatch); the grading contract is identical.

**Artifact pre-gate**: confirm both `.devt/state/review.md` and `.devt/state/review.json` exist (single: the code-reviewer writes these; parallel: the consolidator does). If either is missing, **STOP with BLOCKED** — verification cannot run without the upstream artifact. The sidecar is the routing source of truth; the markdown is the human-readable view.

**Substance pre-gate**: even when the file exists, the writer may have returned a placeholder body. Don't burn a verifier dispatch grading a stub — block here and re-dispatch the writer instead:

```bash
SUBSTANCE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output review.md)
if printf '%s\n' "$SUBSTANCE" | jq -e '.looks_like_stub == true' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: review.md looks like a stub — $(printf '%s\n' "$SUBSTANCE" | jq -r '.reason')"
  exit 0
fi
```

When this gate trips, surface the substance reason to the user and recommend re-dispatch of the upstream writer (single: the reviewer; parallel: the consolidator) — the verifier loop cannot recover from an empty upstream artifact.

**PARALLEL ONLY — consolidator-dispatched gate.** Assert the orchestrator actually dispatched the synthesis agent rather than writing review.md itself (the field failure mode this marker exists for):

```bash
CONS_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-consolidator-dispatched)
if printf '%s\n' "$CONS_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$CONS_GATE" | jq -r '.reason')"
  exit 0
fi
```

**SINGLE-DISPATCH ONLY — verifier short-circuit gate**: when the code-reviewer's review.json carries `status=DONE` AND `self_flagged_uncertainties=[]`, skip the verifier LLM dispatch entirely. The agent itself self-certified no coverage gaps; re-grading clean self-reports burns 3-5K tokens per iteration with no signal. This gate is consumer-aware: it only short-circuits when the upstream agent provided BOTH substance signals (status=DONE/DONE_WITH_CONCERNS AND empty self_flagged_uncertainties). Opus 4.8 made empty self-flags a meaningful negative claim — the model proactively flags uncertainty at far higher fidelity than prior versions, so empty IS a signal rather than a non-signal. Deliberately NOT applied in MODE=parallel: a consolidator's self-flags summarize other agents' work, and short-circuiting synthesis on second-hand self-certification is unvalidated — receipt-gate any future extension.

```bash
SHORT_CIRCUIT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-verifier-short-circuit --agent=code-reviewer)
if printf '%s\n' "$SHORT_CIRCUIT" | jq -e '.short_circuit == true' >/dev/null 2>&1; then
  # Write a synthetic verification.json so the downstream assert-verifier-ran
  # gate accepts the skip. Audit trail preserved via source=short_circuit.
  # Schema enums per JSON_SIDECAR_SCHEMAS::verification.json — VERIFICATION_STATUSES
  # uses "VERIFIED" (not workflow-level "DONE") and VERIFICATION_VERDICTS uses
  # "satisfied" (not workflow-level "PASS"). Validation gates enforce the enum.
  cat > .devt/state/verification.json <<EOF
{
  "status": "VERIFIED",
  "verdict": "satisfied",
  "agent": "verifier",
  "source": "short_circuit",
  "reason": "$(printf '%s\n' "$SHORT_CIRCUIT" | jq -r '.reason')",
  "sidecar_consulted": "$(printf '%s\n' "$SHORT_CIRCUIT" | jq -r '.sidecar_path')",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=DONE verdict=PASS
  echo "VERIFIER SHORT-CIRCUITED: $(printf '%s\n' "$SHORT_CIRCUIT" | jq -r '.reason')"
  exit 0
fi
```

If short-circuit fires, the verify step is complete — skip the rest of this step and proceed to `present_findings`. Otherwise the verifier LLM dispatches normally below.

**Orchestrator-prep — read cached memory signal**. Cached at context_init; re-read here so the verifier doesn't burn 3–4 per-doc `memory query` round trips on its initial scan:

```bash
# Re-derive scope_trust from current preflight-brief.json so the cached value reflects current graph state, not the value computed at workflow start. Fail-open: stale cache used if no brief.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1 || true
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(printf '%s\n' "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(printf '%s\n' "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(printf '%s\n' "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Substitute the JSON output into the `<memory_signal>` block in the dispatch prompt below. If `.devt/memory/` is empty or the query fails, the fallback `{}` keeps the block well-formed and the agent falls back to fresh queries.

Dispatch the verifier:

```
<!-- BEGIN dispatch:verifier:code_review -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/verifier-code_review.tmpl.md -->
Task(subagent_type="devt:verifier", model="{models.verifier}", prompt="
  <context>
    <workflow_type>code_review</workflow_type>
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
    <original_task>{review_scope_description}</original_task>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <god_node_warnings>{god_node_warnings_json}</god_node_warnings>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
    <context_loaded_contract>governing_rules delivery: any sub-tag above carrying a (by-reference: …) stub means Read that rules file from disk when relevant to your scope, and record every file you actually read in a `## Context Loaded` section of your output artifact (name + full/section read) — the verifier checks that your reads cover the rules your findings depend on. Sub-tags carrying full content inline need no disk reads and no section.</context_loaded_contract>
    {prior_outputs}
    {provenance_protocol}
    <files_to_read>.devt/state/review.md, .devt/state/code-review-input.md</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md (if exists — code-review may follow an implementation phase)</impl_summary>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Grade the code review against the code_review rubric. You are NOT re-doing the review.
    Spot-check the review's thoroughness, specificity, severity calibration, and remediation
    concreteness using the rubric in <rubric_path>. Read review.md as the artifact under review.
    If axes fail, emit revisions[] keyed by axis-letter (A-1, B-3, etc.) for the reviewer to address.

    Cross-reference the review's remediation against `.devt/state/graph-impact.md` when present.
    The orchestrator wrote that file from upstream Graphify MCP during context_init. When the
    impact map lists high-blast-radius symbols or affected communities for findings the reviewer
    flagged, verify the remediation accounts for caller-set impact — propose a revision when a
    Critical finding ignores a documented structural risk. When `graphify-skip-reason.txt` exists,
    graph data is unavailable and structural-risk cross-checks do not apply.
  </task>
  Write verification to .devt/state/verification.md AND .devt/state/verification.json (sidecar).
")
<!-- END dispatch:verifier:code_review -->
```

**Gate check**: Read the structured sidecar `.devt/state/verification.json` for routing:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read-sidecar verification.json
MAX_ITER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get | jq -r '.workflow.max_iterations // 3')
# verify_iteration is 0-BASED and increments only on RETRY re-dispatch: a run
# with 3 verifier dispatches finalizes at verify_iteration=2 (0 → first
# dispatch, +1 per retry). Read it as "retries so far", never "dispatch count"
# — field-reported as apparent state drift when misread.
VITER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.verify_iteration // 0')
```

**Verifier walk-all-axes substance gate.** A verifier can walk rubric axes A–G and stop at G, silently skipping axis H — and still return `verdict=satisfied` despite the missing grade. Post-hoc check: count axes in the pinned rubric and compare against `verification.json::criteria_total`. On mismatch, override the verdict to `needs_revision` so the workflow re-dispatches the verifier with explicit instruction to walk every declared axis.

```bash
AXES_ASSERT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-verifier-graded-all-axes 2>/dev/null)
AXES_OK=$(printf '%s\n' "$AXES_ASSERT" | jq -r '.ok // false')
AXES_COVERAGE_GAP=false
if [ "$AXES_OK" = "false" ]; then
  AXES_REASON=$(printf '%s\n' "$AXES_ASSERT" | jq -r '.reason // "verifier under-graded the rubric"')
  echo "[axes-coverage] $AXES_REASON"
  AXES_COVERAGE_GAP=true
  # Force needs_revision regardless of verifier's self-reported verdict — its
  # satisfied/needs_revision split is unreliable when it didn't walk the full
  # rubric. Surface AXES_REASON + missing_axes_count as `<reviewer_feedback>`
  # in the next iteration's verifier dispatch so it grades every axis explicitly.
fi
```

When `AXES_COVERAGE_GAP=true`, treat the verdict as `needs_revision` regardless of what `verification.json::verdict` says — skip the route block below and apply the RETRY operator using `AXES_REASON` as the `revisions[]` gap. When the workflow hits `MAX_ITER` with `AXES_COVERAGE_GAP=true` still set, PRUNE with explicit notice that axes were under-graded so the user sees the structural gap, not just the count gap.

Route on `verdict`:

- **`verdict=satisfied`** (status=VERIFIED or DONE_WITH_CONCERNS): proceed to `present_findings`.
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=DONE verdict=VERIFIED
  ```
- **`verdict=needs_revision`** (status=GAPS_FOUND) — apply the **repair operator**:
  - **`VITER < MAX_ITER` → RETRY**: re-dispatch the **code-reviewer** — MODE=single: the `review` step; MODE=parallel: the `consolidate` step — with each `revisions[].gap` (axis + AC-letter id + evidence) verbatim as `<reviewer_feedback>` in the prompt. Do NOT have the reviewer re-parse the markdown; the structured list is the contract.
    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify verify_iteration=$((VITER+1)) verdict=GAPS_FOUND repair=RETRY
    ```
  - **`VITER >= MAX_ITER` → PRUNE**: stop iterating. Write remaining `revisions[]` to `.devt/state/scratchpad.md` under `## Deferred Review Verification Gaps`. Proceed to `present_findings` with `status=DONE_WITH_CONCERNS` and surface the deferred gaps in the user report.
    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=DONE_WITH_CONCERNS verdict=GAPS_FOUND repair=PRUNE
    ```
- **`verdict=failed`** (status=FAILED) — STOP with BLOCKED. Surface the verifier's failure reason (missing review.md, missing code-review-input.md, REJ tombstone match, or 3+ axes failing simultaneously) to the user. No retry — this is a structural problem requiring human attention.
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  ```

</step>

---

<step name="auto_curator" gate="curator dispatched if config + threshold + cooldown all permit">

**Conditional auto-curator.** When `memory.auto_curator_on_review = true` AND `_suggestions.md` has ≥ `memory.auto_curator_min_candidates` (default 3) AND last curator run was ≥ `memory.auto_curator_cooldown_days` (default 7) ago, refresh discovery harvest and fire a curator dispatch. Skipped silently otherwise — default `false` keeps the workflow cost-neutral for users who don't opt in.

Decision logic (bash):

```bash
AUTO_CURATOR_ENABLED=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_on_review 2>/dev/null | jq -r '.value // false')
if [ "$AUTO_CURATOR_ENABLED" = "true" ]; then
  echo "FIRE" > .devt/state/auto-curator-considered.txt
else
  echo "DISABLED" > .devt/state/auto-curator-considered.txt
fi

AUTO=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_on_review 2>/dev/null | jq -r '.value // false')
if [ "$AUTO" = "true" ]; then
  MIN=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_min_candidates 2>/dev/null | jq -r '.value // 3')
  COOLDOWN=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_cooldown_days 2>/dev/null | jq -r '.value // 7')
  CANDIDATES=$(/usr/bin/grep -cE '^###\s+[⚖️🔵]' .devt/memory/_suggestions.md 2>/dev/null || echo 0)
  LAST_RUN_FILE=.devt/state/last-curator-run.txt
  COOLDOWN_OK=1
  if [ -f "$LAST_RUN_FILE" ]; then
    LAST_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$(cat "$LAST_RUN_FILE")" "+%s" 2>/dev/null || echo 0)
    NOW_EPOCH=$(date "+%s")
    AGE_DAYS=$(( (NOW_EPOCH - LAST_EPOCH) / 86400 ))
    if [ "$AGE_DAYS" -lt "$COOLDOWN" ]; then COOLDOWN_OK=0; fi
  fi
  if [ "$CANDIDATES" -ge "$MIN" ] && [ "$COOLDOWN_OK" = "1" ]; then
    echo "auto_curator: ACTIVE — candidates=$CANDIDATES min=$MIN age=${AGE_DAYS:-never}d cooldown=${COOLDOWN}d"
    # Refresh _suggestions.md from the latest scratchpad #KNOWLEDGE-CANDIDATE tags + decisions before dispatch
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory suggest >/dev/null 2>&1 || true
    # Record run timestamp BEFORE dispatch so a curator crash doesn't trigger immediate re-runs
    date -u "+%Y-%m-%dT%H:%M:%SZ" > "$LAST_RUN_FILE"
  else
    echo "auto_curator: SKIP — candidates=$CANDIDATES (need $MIN) cooldown_ok=$COOLDOWN_OK"
  fi
else
  echo "auto_curator: DISABLED — memory.auto_curator_on_review=false (default; opt-in via .devt/config.json)"
fi
```

When bash prints `auto_curator: ACTIVE`, orchestrator dispatches curator:

```
<!-- BEGIN dispatch:curator:code_review -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/curator-code_review.tmpl.md -->
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <context>
    <files_to_read>.devt/memory/_suggestions.md, .devt/memory/lessons/*.md (existing)</files_to_read>
    <agent_skills>{injected from .devt/config.json — must include devt:memory-curation}</agent_skills>
  </context>
  <task>
    Auto-curator triggered by /devt:review post-review threshold (≥${MIN} candidates pending, last run ≥${COOLDOWN}d ago).
    Evaluate ⚖️/🔵 entries in .devt/memory/_suggestions.md. For each that passes the 5-filter (Specificity, Durability,
    Non-obviousness, Evidence, Actionability), present an AskUserQuestion proposal per memory-curation skill.
    Accepted candidates land in .devt/memory/{decisions,concepts,flows,rejected}/.
    Write .devt/state/curation-summary.md with verdicts per candidate (accepted / edited / rejected with reason).
  </task>
")
<!-- END dispatch:curator:code_review -->
```

When bash prints `auto_curator: SKIP` or `auto_curator: DISABLED`, no dispatch — proceed to `present_findings`.

</step>

<step name="present_findings" gate="findings are reported to the user (parallel: with lane provenance)">

**Auto-curator-considered gate.** Before presenting findings, assert that auto-curation was considered (not silently skipped):

```bash
CURATOR_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-auto-curator-considered)
if printf '%s\n' "$CURATOR_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$CURATOR_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Verifier-ran enforcement gate**. Before presenting findings, assert that the verifier step actually ran when `config.workflow.verification=true`. Why: orchestrators sometimes skip the verifier dispatch with rationalizations like "the fan-out is already verifier-grade." Nothing in the conditional skip at the top of the verify step pushes back. This gate makes the skip impossible:

```bash
VERIF_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-verifier-ran)
if printf '%s\n' "$VERIF_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$VERIF_GATE" | jq -r '.reason')"
  exit 0
fi
```

When the gate trips, surface the reason to the user and recommend re-running the verify step. Do not present findings until verification has actually been performed (or `config.workflow.verification` is explicitly set to `false`).

**Layer-2 claim-check resolution gate.** Before finalize, assert all Layer-1 `assert-artifact-present` failures in this workflow window have been resolved. An unresolved failure means an agent dispatch returned without writing its declared output (per `agents/io-contracts.yaml::outputs.primary`) and was never re-dispatched — in MODE=parallel this includes the per-lane Layer-1 records written at substance_check_lanes. Mirrors the dispatch-hygiene S1 pattern — post-hoc enforcement at finalize. Set `claim_check_mode: "warn"` in `.devt/config.json` to opt out.

```bash
CC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-claim-checks-resolved)
if printf '%s\n' "$CC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$CC_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Dispatch-hygiene post-hoc gate.** Before knowledge-candidates aggregation, assert no raw devt:* dispatches happened this session. Claude Code does NOT enforce PreToolUse `decision:deny` on the Task tool — the existing `dispatch-hygiene-guard.sh` hook detects raw dispatches and writes them to `dispatch-warnings.jsonl` but cannot actually block. This gate is the post-hoc enforcement: any raw_dispatch entries with ts >= first_created_at blocks present_findings. Set `dispatch_hygiene_mode: "warn"` in `.devt/config.json` to opt out. (Registered lane dispatches carry `<correlation_id>cid_*` tags the hygiene guard recognizes — a clean parallel run passes this gate with zero raw dispatches.)

```bash
RD_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-no-raw-dispatches-this-session)
if printf '%s\n' "$RD_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$RD_GATE" | jq -r '.reason')"
  exit 0
fi
```

When this gate blocks on a dispatch that was substantively compliant (e.g. a pointer dispatch that consumed a rendered envelope from disk), resolve THAT record — `dispatch warnings resolve <warning_id> --reason="…" [--evidence="…"]` — and re-run the gate. Never `--skip-gates`: it bypasses every gate on the transition, not just this one. The `unresolved[]` array in the gate's output carries the warning_ids.

**Axis-H claims gate.** The verifier grades that the `## Dispatch warnings (session-scoped)` section EXISTS; this gate checks its NUMBERS against the file mechanically — it runs last and needs no model honesty. Counts are bounded to [workflow start, review.md mtime], so a warning written after the review was authored is never blamed on its author. Failure means the section was inherited or derived instead of live-read: re-dispatch is unnecessary — fix is appending a corrected section from a live read (`dispatch warnings` CLI or a direct file read), then re-run.

```bash
AXH_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-dispatch-warnings-acknowledged)
if printf '%s\n' "$AXH_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$AXH_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Knowledge-candidates-tagged gate.** Before presenting findings, assert that the orchestrator either surfaced `#KNOWLEDGE-CANDIDATE` lines in `scratchpad.md` during work OR declared none explicitly via `knowledge-candidates-none.txt` with a structured reason. Why: candidates described in review.md prose but never tagged in scratchpad never reach the curator harvester. The gate forces an explicit decision.

Aggregate first so tags placed in output artifacts reach scratchpad before the gate inspects it (the aggregator is idempotent + cheap, safe to always run). In MODE=parallel this aggregation is load-bearing, not just convenient: lane code-reviewers append `#KNOWLEDGE-CANDIDATE:` lines to their lane output files (`review-lane-*.md`), not directly to scratchpad — without aggregation the gate would false-block parallel reviews even when lanes diligently surfaced candidates.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state aggregate-knowledge-candidates >/dev/null 2>&1 || true
KC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-knowledge-candidates-tagged)
if printf '%s\n' "$KC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$KC_GATE" | jq -r '.reason')"
  exit 0
fi
```

When the gate trips: re-read the review.md narrative, identify any non-obvious patterns the reviewer described in prose but did not tag, append `#KNOWLEDGE-CANDIDATE: [type=...] <summary>` lines to scratchpad.md, then re-enter present_findings. If genuinely none qualify, write the structured none-declaration: `printf 'reason=no_novel_patterns\ndeclared_at=%s\n' "$(date -u +%FT%TZ)" > .devt/state/knowledge-candidates-none.txt`.

Read `.devt/state/review.md` and present to the user.

**SINGLE-DISPATCH ONLY — report format** (a serial review has one score, no distribution to hide):

- **Verdict**: APPROVED / APPROVED_WITH_NOTES / NEEDS_WORK
- **Score**: N / 100
- **Summary**: 2-3 sentence overview
- **Findings by severity**: Critical, Important, Minor (with file and line references)
- **Score breakdown**: by category (architecture, security, performance, etc.)
- **Graphify activity** (one line; the telemetry surface below populates it)

**PARALLEL ONLY — report format** (consolidated reviews carry NO merged 0–100 — the deduction model saturates at the 0 floor on multi-lane merges and the resulting headline misleads; the lane spread is the real signal):

- **Verdict**: APPROVED / APPROVED_WITH_NOTES / NEEDS_WORK
- **Severity counts**: N Critical / N Important / N Minor — this plus the verdict IS the one-glance signal
- **Lane score distribution**: per-lane scores with community labels (e.g. `core 61 · api 56 · infra 77 · migrations 91 · tests 24`) — the spread tells the reader which areas are shippable and which are not; never average it
- **Summary**: 2-3 sentence overview
- **Findings by severity**: Critical, Important, Minor (with file and line references)
- **Graphify activity** (one line; the telemetry surface below populates it)

Additionally (PARALLEL ONLY), surface the `## Lane Provenance` section verbatim so the user sees which communities contributed which findings.

**Graphify activity surface** — surface what graphify tools were actually invoked during this workflow. Without this line, the user has no way to verify the integration was used vs. silently fell back to grep. Reads `.devt/memory/_mcp-trace.jsonl` filtered by the current `workflow_id`:

```bash
WID=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.workflow_id // empty')
if [ -n "$WID" ]; then
  # Trace records UNPREFIXED tool names (`mcp__devt-graphify__*`) regardless
  # of how the orchestrator invokes (orchestrator uses prefixed
  # `mcp__plugin_devt_devt-graphify__*` per Claude Code plugin-namespacing,
  # but the recorded tool field in _mcp-trace.jsonl is the unprefixed form).
  # mcp-stats queries must use the unprefixed form to match trace records.
  # Workflow PROSE references for graphify tools stay prefixed.
  # --include-chain: context_init MCP calls land under the pre-rotation
  # workflow_id (workflow_type transitions rotate it), so the strict
  # default would report zero graphify usage for a run that used it.
  GRAPHIFY_SUMMARY=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" mcp-stats --workflow-id="$WID" --include-chain --tool='mcp__devt-graphify__*' --by=calls 2>/dev/null || echo "")
  GRAPHIFY_UPSTREAM=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" mcp-stats --workflow-id="$WID" --include-chain --tool='mcp__graphify__*' --by=calls 2>/dev/null || echo "")
  PLAN_TIER=$(jq -r '.tier // "unknown"' .devt/state/graphify-impact-plan.json 2>/dev/null || echo "unknown")
  if [ -f .devt/state/graphify-skip-reason.txt ]; then
    SKIP_REASON=$(cat .devt/state/graphify-skip-reason.txt)
    echo "Graphify activity: SKIPPED (plan=$PLAN_TIER, reason: $SKIP_REASON)"
  else
    echo "Graphify activity: tier=$PLAN_TIER"
    echo "$GRAPHIFY_SUMMARY"
    echo "$GRAPHIFY_UPSTREAM"
  fi
fi
```

Surface the output verbatim in the user report under "Graphify activity". When the trace file is missing or `workflow_id` is unset (legacy workflow.yaml predating auto-stamp), emit `Graphify activity: telemetry unavailable` and continue — best-effort.

This is a READ-ONLY workflow. Do NOT offer to fix findings. If the user wants fixes applied, they should run `/implement` or `/workflow` with the review findings as input.

**Memory-candidate footer** (B-III.1.c). Surfaces a one-liner when `_suggestions.md` has ≥ `memory.candidates_surface_threshold` proposals AND the cooldown has elapsed. The CLI handles status read + threshold + cooldown check + hint emission + cooldown-timestamp touch as a single operation.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-footer
```

Finalize (advance-phase runs any registered phase gates; workflow types without a registry entry fall through to a plain update):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state advance-phase complete active=false
```

</step>
