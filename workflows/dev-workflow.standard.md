# dev-workflow — STANDARD+ tier steps (lazy-loaded)

Loaded by `workflows/dev-workflow.md`'s `load_tier_steps` step when the assessed tier is STANDARD or COMPLEX. Each `<step>` below executes at its `TIER-STEP` insertion point in the spine's pipeline order — the bodies were relocated VERBATIM from dev-workflow.md; their `gate="..."` contracts, tier skip-clauses, and artifacts are unchanged. TRIVIAL/SIMPLE never load this file.

<available_agent_types>
Dispatched from this tier file (full roster + tool surfaces in the spine `dev-workflow.md`):

- `devt:verifier` — goal-backward verification specialist, READ-ONLY (Read, Bash, Glob, Grep)
- `devt:docs-writer` — documentation specialist (Read, Write, Edit, Bash, Glob, Grep)
- `devt:retro` — lesson extraction specialist (Read, Write, Bash, Glob, Grep)
</available_agent_types>

## risk_warning (STANDARD+; insertion: after assess, before auto_research_plan (COMPLEX))

<step name="risk_warning" gate="risk check completed">

_Skip if TRIVIAL or SIMPLE._

Before proceeding, evaluate:

1. **Simpler approach exists?** — Is the proposed solution more complex than the problem requires?
2. **Over-engineering risk?** — Does the task description imply abstractions or patterns beyond what's needed?
3. **High-risk change?** — Does it touch auth, data integrity, public APIs, or 10+ files?
4. **Breaking change?** — Does it change API contracts, database schema, or external interfaces?

If ANY warning triggers, present options to the user via AskUserQuestion:

```yaml
question: "I detected a potential concern before proceeding."
header: "Risk Check"
multiSelect: false
options:
  - label: "Proceed with current approach"
    description: "{describe the approach and its trade-offs}"
  - label: "Use simpler alternative (Recommended)"
    description: "{describe the simpler approach if one exists}"
  - label: "Let me reconsider the task"
    description: "Pause to rethink scope or approach"
```

If no warnings trigger, proceed silently.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=risk_warning status=DONE
```

</step>

## scan (STANDARD+; insertion: pre-implement)

<step name="scan" gate="scan-results.md is written to .devt/state/">

_Skip this step if complexity is SIMPLE._

Use the codebase-scan skill to survey relevant code:

Read `${CLAUDE_PLUGIN_ROOT}/skills/codebase-scan/` for the scan protocol.

Scan for:

- Existing implementations related to the task (patterns to reuse)
- Module boundaries and interfaces involved
- Error types, constants, enums in the domain
- Existing tests for the affected modules
- Cross-module dependencies and integration points

Write results to `.devt/state/scan-results.md` with:

- Files relevant to the task (grouped by module)
- Existing patterns to follow (with file references)
- Interfaces and contracts to satisfy
- Risks and constraints discovered

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=scan status=DONE
```

</step>

## regression_baseline (STANDARD+; insertion: pre-implement (after scan))

<step name="regression_baseline" gate="baseline-gates.md is written to .devt/state/ or step is skipped">

_Skip this step if complexity is SIMPLE._
_Skip this step if `config.workflow.regression_baseline` is `false`._

Run quality gates **before** implementation to establish a baseline. This captures the current pass/fail state so that any regressions introduced by the implementation can be detected.

**Parallel-bash pairing with Step 2 (scan)**: when the test suite from `.devt/rules/quality-gates.md` is slow (minutes), launch it with `run_in_background=true` and proceed to Step 2's scan in the foreground. The two steps share no state (different artifacts, no overlapping `state update` writes) so they cannot race. Await background completion before the implement step.

```bash
# Read quality gate commands from .devt/rules/quality-gates.md and run them
# Capture output — failures here are PRE-EXISTING, not caused by this task
```

Write results to `.devt/state/baseline-gates.md`:

```markdown
# Baseline Quality Gates

Captured before implementation to detect regressions.

| Gate | Command | Result | Notes |
|------|---------|--------|-------|
| lint | {command} | PASS/FAIL | {pre-existing failures if any} |
| typecheck | {command} | PASS/FAIL | {pre-existing failures if any} |
| tests | {command} | PASS/FAIL ({N passed, M failed}) | {pre-existing failures if any} |
```

**Important**: Pre-existing failures are noted but NOT blocking. The baseline exists to compare AFTER implementation — new failures not in the baseline are regressions.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=regression_baseline status=DONE
```

</step>

## simplify (STANDARD+; insertion: after test, before review)

<step name="simplify" gate="code is cleaned up and quality gates still pass">

_Only applies if complexity tier is STANDARD or COMPLEX. Skip for TRIVIAL and SIMPLE._
_Skip this step if `simplify` is listed in `skipped_phases` from workflow state._

After tests pass, run a simplification pass on the changed code before it goes to review. This catches generative debt (redundancy, over-engineering, missed reuse) that the programmer's self-review may have missed.

Invoke the built-in `/simplify` skill, which spawns 3 parallel review agents (reuse, quality, efficiency) and applies fixes:

```
Skill(skill="simplify")
```

After simplify completes, **re-run quality gates** to ensure simplification didn't break anything:

```bash
# Read quality gate commands from project rules and execute
GATES_FILE=".devt/rules/quality-gates.md"
if [[ -f "$GATES_FILE" ]]; then
  echo "Re-running quality gates after simplification..."
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/run-quality-gates.sh"
fi
```

**Gate check** — set `STATUS` based on outcome:

- Quality gates pass → `STATUS=DONE`, proceed to review
- Quality gates fail → attempt to fix (run failing command, read error, fix). Re-run gates.
  - Gates pass after fix → `STATUS=DONE`, proceed to review
  - Gates still fail → revert simplification changes (`git checkout -- <broken_files>`), `STATUS=REVERTED`, proceed to review with pre-simplify code. The original code was already tested and passing — safe to fall back.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=simplify status=$STATUS
```

</step>

## autoskill (STANDARD+; insertion: after curate, before review_deferred)

<step name="autoskill" gate="autoskill analysis is complete">

_Skip this step if complexity is SIMPLE._
_Skip this step if `config.workflow.autoskill` is `false`._
_Skip this step if `autoskill` is listed in `skipped_phases` from workflow state._

Read `${CLAUDE_PLUGIN_ROOT}/skills/autoskill/` for the autoskill protocol.

Analyze the completed workflow for patterns that could be automated:

- Repeated manual interventions that could become skills
- Agent prompt patterns that could be extracted into reusable templates
- Quality gate patterns that could be added to `.devt/rules/`

If actionable proposals are identified, write them to `.devt/state/autoskill-proposals.md`.
Report proposals to the user — do NOT auto-apply them.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=autoskill status=DONE
```

</step>

## verify (STANDARD+; insertion: after review, before docs_retro)

<step name="verify" gate="verification.md is written with status VERIFIED">

_Skip this step if complexity is SIMPLE._
_Skip this step if `config.workflow.verification` is `false`._
_Skip this step if `verify` is listed in `skipped_phases` from workflow state._

**Artifact pre-gate**: Before dispatching the verifier, confirm required context artifacts exist:

- Check that `.devt/state/impl-summary.md` AND `.devt/state/impl-summary.json` exist
- Check that `.devt/state/test-summary.md` AND `.devt/state/test-summary.json` exist
- Check that `.devt/state/review.md` exists

If ANY of these are missing: **STOP with BLOCKED**. Report to the user:
"Verification cannot proceed — missing artifacts: {list the missing files}. The upstream phase may have failed silently or returned BLOCKED without writing its output. Check /devt:status for details."

Do NOT dispatch the verifier with incomplete context — it will waste a subagent turn and produce unreliable results.

**Substance pre-gate**: even when the three artifacts exist, the upstream agents may have returned placeholder bodies (e.g., "Stub written; analysis in progress." that pass file-existence gates). Run `state check-agent-output` on each one BEFORE the LLM verifier dispatch — same architectural class as the code-review substance pre-gate, applied to all three upstream artifacts the verifier consumes:

```bash
for ARTIFACT in impl-summary.md test-summary.md review.md; do
  SUBSTANCE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output ".devt/state/$ARTIFACT")
  if printf '%s\n' "$SUBSTANCE" | jq -e '.looks_like_stub == true' >/dev/null 2>&1; then
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
    echo "BLOCKED: $ARTIFACT looks like a stub — $(printf '%s\n' "$SUBSTANCE" | jq -r '.reason')"
    exit 0
  fi
done
```

When this gate trips, surface the substance reason to the user. The verifier loop cannot recover from a stub upstream artifact — re-dispatch the originating agent (programmer for impl-summary, tester for test-summary, code-reviewer for review) rather than asking the verifier to grade a placeholder.

**Deterministic pre-verifier gate**. Run `bin/modules/grader.cjs` against the test-summary + impl-summary sidecars BEFORE dispatching the LLM verifier. Saves the verifier round-trip on red-test cycles where the test runner or quality gates already proved failure:

```bash
MAX_ITER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get | jq -r '.workflow.max_iterations // 3')
VITER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.verify_iteration // 0')
GRADE_TS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" grade dev test-summary.json 2>/dev/null || true)
GRADE_IS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" grade dev impl-summary.json 2>/dev/null || true)
```

Each call returns one of three envelope shapes — Claude MUST distinguish them, because each represents a different failure class with a different remediation path:

- **`{ok: false, reason: "...", sidecar, rubric?}`** — I/O-level failure (sidecar missing or malformed, rubric file not found, malformed `## Deterministic Gates` JSON, etc.). The `pass` field is ABSENT. **STOP with BLOCKED**. Report to the user the `reason` field verbatim. Do NOT retry the programmer — they cannot fix a missing/corrupt sidecar or a broken rubric. The fix is operator-level (restore artifact, restore/fix rubric, or override `.devt/config.json::rubrics.dev` to point at a project-local rubric in `.devt/rubrics/`). Exit the verify step.
- **`{ok: true, pass: false, gate_failures: [...], ...}`** — Constraint violation. A real gate the programmer can address. Apply the `verify_iteration` routing below (RETRY/PRUNE). This is the same `verify_iteration` counter the LLM verifier path uses, so deterministic gates participate in the same `workflow.max_iterations` cap — without this, a programmer that can't get tests green would loop forever.
- **`{ok: true, pass: true, gate_failures: [], ...}`** — Gate passes. Proceed to the LLM verifier dispatch below.

**Merge precedence across both grader calls (test-summary + impl-summary).** Apply each envelope's routing rule independently, then merge with the strictest outcome winning: **`ok:false` (BLOCKED) > `pass:false` (RETRY/PRUNE) > `pass:true` (proceed)**. Concretely: if EITHER `GRADE_TS` or `GRADE_IS` is `ok:false`, the entire verify step routes to BLOCKED regardless of the other call's outcome. If neither is `ok:false` but EITHER is `pass:false`, route to RETRY/PRUNE — merge the `gate_failures` arrays from both calls into the programmer feedback. Only when BOTH calls return `pass:true` does the LLM verifier dispatch fire.

For the `ok=true, pass=false` constraint-violation case, route on the iteration counter:

- **`VITER + 1 >= MAX_ITER` → PRUNE**: cap reached. Write the combined `gate_failures` from both grader calls to `.devt/state/scratchpad.md` under a `## Deferred Verification Gaps` section (mirroring the LLM-verifier PRUNE path), set `status=DONE_WITH_CONCERNS`, exit the retry loop, surface to the user:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify verify_iteration=$((VITER+1)) status=DONE_WITH_CONCERNS repair=PRUNE
  ```
- **`VITER + 1 < MAX_ITER` → RETRY**: increment counter, re-dispatch programmer with the `gate_failures` JSON as `<review_feedback>`, return to **Step 4 (implement)**:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify verify_iteration=$((VITER+1)) verdict=GATES_FAILED repair=RETRY
  ```
  Pass the structured `gate_failures` array verbatim into the next programmer dispatch's `<review_feedback>` block — each entry is `{field, expected, got}` with a clear field path (e.g. `gates.test.passed`) the programmer can act on directly.

If BOTH gates pass, proceed to the memory_signal prep and LLM verifier dispatch below. The verifier's job under deterministic-gating narrows to **semantic verification** — does the implementation solve the user's task? — rather than re-checking test results and gate execution that the grader already proved.

**Orchestrator-prep — read cached signals**. `memory_signal_json` and `scope_hint_json` were cached at context_init; re-read both here so the verifier doesn't burn per-doc round trips or rediscover the implementation's likely paths:

```bash
# Re-derive scope_trust from current preflight-brief.json so the cached value reflects current graph state, not the value computed at workflow start. Fail-open: stale cache used if no brief.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1 || true
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(printf '%s\n' "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(printf '%s\n' "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(printf '%s\n' "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Substitute `MEMORY_SIGNAL` into `<memory_signal>` and `SCOPE_HINT` into `<scope_hint>` below. If `.devt/memory/` is empty or either query fails, the `{}`/`[]` fallbacks keep the blocks well-formed and the agent falls back to fresh queries.

If all three artifacts exist, dispatch the verifier agent:

```
<!-- BEGIN dispatch:verifier:dev -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/verifier.tmpl.md -->
Task(subagent_type="devt:verifier", model="{models.verifier}", prompt="
  <context>
    <workflow_type>dev</workflow_type>
    <!-- Rubric path is pinned by the `rubrics` config key. The init payload
         exposes `rubrics.dev` (default "dev.v1.md"); override per project in
         .devt/config.json. The verifier reads this block instead of computing
         the path from <workflow_type>, so we can ship rubric updates as new
         files (dev.v2.md) without breaking projects pinned to v1. -->
    <rubric_path>references/rubrics/{rubrics.dev}</rubric_path>
    <original_task>{task_description}</original_task>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify). Use as primary acceptance criteria source.</spec>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
    </governing_rules>
    {prior_outputs}
    {provenance_protocol}
    <files_to_read>.devt/state/impl-summary.md, .devt/state/test-summary.md, .devt/state/review.md</files_to_read>
    <baseline>Read .devt/state/baseline-gates.md (if exists). Compare current quality gate results against this baseline — tests that PASSED in baseline but FAIL now are regressions. Pre-existing failures are NOT regressions.</baseline>
    <plan>Read .devt/state/plan.md (if exists)</plan>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Verify the implementation achieves the original task goal.
    Use goal-backward verification: trace from requirements to code.
    If a spec exists, verify against its user stories, success criteria, and test scenarios — not just the task description.
    Grade against the pinned rubric — Read it from <rubric_path> before grading (verdict vocabulary, required levels, and revisions[] shape all come from the rubric).
  </task>
  Write verification to .devt/state/verification.md
")
<!-- END dispatch:verifier:dev -->
```

**Layer-1 claim-check** — confirm the verifier wrote its output before routing on it (mirrors the programmer/architect claim-checks in the spine):

```bash
ARTIFACT_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present verifier)
```

**Gate check**: Read the structured sidecar `.devt/state/verification.json` for routing — the JSON is authoritative for control flow per the  outcome-grader contract (`references/rubrics/dev.v1.md`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read-sidecar verification.json
```

The sidecar exposes `verdict` (`satisfied|needs_revision|failed`), `status` (mirrors the markdown), and `revisions[]` (per-criterion gap descriptions tied to AC-* ids). Also extract the iteration cap from config:

```bash
MAX_ITER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get | jq -r '.workflow.max_iterations // 3')
VITER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.verify_iteration // 0')
```

Route on `verdict`:

- **`verdict=satisfied`** (status=VERIFIED): Check if any acceptance criteria have `NEEDS_HUMAN` status. If so, emit a **Human Verify checkpoint** (even in autonomous mode) listing those specific items for the user to confirm:
  ```yaml
  question: "Verification passed, but {N} criteria need human confirmation:"
  header: "Human Verification Needed"
  ```
  List each NEEDS_HUMAN criterion with what the user should check. After user confirms (or in autonomous mode after a timeout), proceed to docs.
- **`verdict=satisfied`** with `status=DONE_WITH_CONCERNS`: proceed to docs, but report concerns to user:
  "Verification passed with concerns: [extract from verification.md]"
- **`verdict=needs_revision`** (status=GAPS_FOUND) — apply the **repair operator** based on `VITER` vs `MAX_ITER`:
  - **`VITER < MAX_ITER` → RETRY**: go back to **Step 4 (implement)** feeding `revisions[]` as structured `<review_feedback>`:
    - Pass each `revisions[].gap` (with its AC-* id and evidence) verbatim into the next programmer dispatch's `<review_feedback>` block — do NOT have the programmer re-parse the markdown; the structured list is the contract.
    - Increment: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify verify_iteration=$((VITER+1)) verdict=GAPS_FOUND repair=RETRY`
  - **`VITER >= MAX_ITER` → PRUNE**: stop iterating
    - Write remaining `revisions[]` to `.devt/state/scratchpad.md` under `## Deferred Verification Gaps` (one entry per revision: AC id, criterion, gap, evidence)
    - Proceed with status DONE_WITH_CONCERNS
    - Report: "Verification gap limit reached after `MAX_ITER` iterations. `revisions[].length` gaps deferred to scratchpad."
    - `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify verify_iteration=$((MAX_ITER)) verdict=GAPS_FOUND repair=PRUNE`
- **`verdict=failed`** (status=FAILED): surface to user as BLOCKED. Do NOT retry — `failed` means architectural rework needed or verification cannot run; iteration will not converge.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=$STATUS
```

**Vocabulary note** — two `verdict` fields exist with different scopes:

- `workflow.yaml::verdict` — uppercase status vocab (`GAPS_FOUND`, `NEEDS_WORK`, `FAILED`, etc.) — used by `/devt:next` and `/devt:status` for resume routing. Preserved unchanged by .
- `verification.json::verdict` — lowercase grader vocab (`satisfied | needs_revision | failed`) — used by THIS gate-check to decide retry vs. proceed.

The PRUNE branch sets `repair=PRUNE` on state so a future inspector can distinguish "converged with gaps" from "hit the iteration cap" without reading the JSON sidecar.

</step>

## docs_retro_parallel (STANDARD+; insertion: after verify, before harvest_observations)

<step name="docs_retro_parallel" gate="docs-summary.md and lessons.yaml are written to .devt/state/">

These two agents are independent — dispatch both simultaneously to reduce wall-clock time.

**Pre-dispatch check**: Read `.devt/state/impl-summary.md` status.

- If DONE or DONE_WITH_CONCERNS: dispatch both agents below
- If BLOCKED: skip both steps (nothing to document or learn from)
- If file missing: skip both steps with warning "No implementation summary found"

**Skip conditions** (evaluated independently for each agent):
- _Skip docs-writer if complexity is SIMPLE, `config.workflow.docs` is `false`, or `docs` is listed in `skipped_phases`._
- _Skip retro if complexity is SIMPLE, `config.workflow.retro` is `false`, or `retro` is listed in `skipped_phases`._

Dispatch both agents in parallel:

```
<!-- BEGIN dispatch:docs-writer:dev -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/docs-writer.tmpl.md -->
Task(subagent_type="devt:docs-writer", model="{models.docs-writer}", prompt="
  <context>
    <files_to_read>.devt/rules/documentation.md (if exists)</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md</impl_summary>
    <test_summary>Read .devt/state/test-summary.md</test_summary>
    <review>Read .devt/state/review.md</review>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Update module documentation to reflect the implementation changes.
    Update existing docs — do not create parallel documentation.
    Delete documentation for any removed features.
  </task>
  Write summary to .devt/state/docs-summary.md
")
<!-- END dispatch:docs-writer:dev -->

<!-- BEGIN dispatch:retro:dev -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/retro.tmpl.md -->
Task(subagent_type="devt:retro", model="{models.retro}", prompt="
  <context>
    <files_to_read>
      .devt/state/impl-summary.md,
      .devt/state/test-summary.md,
      .devt/state/review.md,
      .devt/state/arch-review.md (if exists),
      .devt/state/docs-summary.md (if exists),
      .devt/rules/coding-standards.md,
      .devt/rules/testing-patterns.md,
      .devt/memory/lessons/*.md (existing LES-NNNN entries)
    </files_to_read>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review all workflow artifacts and extract lessons learned.
    Apply the 4-filter test: specific, generalizable, actionable, evidence-based.
    Discard anything that fails any filter.
  </task>
  Write lessons to .devt/state/lessons.yaml
")
<!-- END dispatch:retro:dev -->
```

Wait for both to complete before proceeding to Step 9 (curation).

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=retro status=DONE
```

</step>

