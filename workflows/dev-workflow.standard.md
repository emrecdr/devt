# dev-workflow — STANDARD+ tier steps (lazy-loaded)

Loaded by `workflows/dev-workflow.md`'s `load_tier_steps` step when the assessed tier is STANDARD or COMPLEX. Each `<step>` below executes at its `TIER-STEP` insertion point in the spine's pipeline order — the bodies were relocated VERBATIM from dev-workflow.md; their `gate="..."` contracts, tier skip-clauses, and artifacts are unchanged. TRIVIAL/SIMPLE never load this file.

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

