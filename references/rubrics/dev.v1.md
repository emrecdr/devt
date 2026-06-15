# Verifier Rubric — `dev` Workflow

This rubric drives outcome grading for the `dev` workflow's verifier agent. It is the **authority** on what counts as "satisfied" for this workflow_type. The verifier reads its body of techniques (4-level checks, scope-completeness analysis, artifact cross-check) from `agents/verifier.md`; it reads **what passes** for the active workflow_type from this file.

## Verdict Vocabulary

The verifier emits a `verdict` in `verification.json` from this enum:

| Verdict          | Meaning                                                                                   | Workflow Action                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `satisfied`      | All AC met to required level; no unresolved gaps; no scope reduction.                     | Workflow proceeds to docs+retro phases.                                                                      |
| `needs_revision` | One or more AC are unmet but the implementation direction is sound and gaps are fixable.  | Workflow re-dispatches programmer with `revisions[]` from the sidecar; increments `verify_iteration` counter. |
| `failed`         | Implementation does not approach the goal, or verification cannot run (build broken, etc). | Workflow surfaces BLOCKED to the user; no further retry.                                                     |

The orchestrator owns the terminal `max_iterations_reached` outcome — when `verify_iteration` equals `workflow.max_iterations` and the verdict is still `needs_revision`, the workflow PRUNEs (writes remaining gaps to scratchpad, proceeds with `status=DONE_WITH_CONCERNS`). The verifier itself never emits `max_iterations_reached`.

## Status Field

`status` mirrors the human-readable verdict shown in `verification.md`. Map deterministically from `verdict`:

| verdict          | status (default mapping)                                |
| ---------------- | ------------------------------------------------------- |
| `satisfied`      | `VERIFIED` (or `DONE_WITH_CONCERNS` if NEEDS_HUMAN ACs) |
| `needs_revision` | `GAPS_FOUND`                                            |
| `failed`         | `FAILED`                                                |

`DONE_WITH_CONCERNS` is reserved for: all functional ACs met, but one or more `NEEDS_HUMAN` items remain (UI rendering, third-party webhook, etc.). It pairs with `verdict=satisfied`.

## Required Verification Levels

For the `dev` workflow, every acceptance criterion must reach **Level 3 (Wired) minimum**. Critical paths must reach **Level 4 (Functional)**. When `baseline-gates.md` exists, **Level 4.5 (Regression)** is mandatory.

| Level | Bar         | Required for                                                              |
| ----- | ----------- | ------------------------------------------------------------------------- |
| L1    | Exists      | Every AC                                                                  |
| L2    | Substantive | Every AC                                                                  |
| L3    | Wired       | Every AC — **minimum bar**                                                |
| L4    | Functional  | Critical paths (auth, data mutation, payment, request handlers, exports) |
| L4.5  | Regression  | Whenever `.devt/state/baseline-gates.md` exists                          |
| L5    | Scope       | Whenever `spec.md` or `plan.md` exists                                    |
| L5.5  | Phased      | Whenever the plan mentions later-phase deferrals                          |

L5 (scope completeness) is the most common source of `needs_revision`: implementation works for AC-1..3 but silently dropped AC-4. Compare requirements from spec/plan against impl-summary evidence; any requirement without evidence becomes a `revisions[]` entry unless explicitly deferred to a later phase.

## Reject these shortcuts

The verifier MUST NOT pass on any of the following signals alone — each is a verification shortcut that bypasses real verification. When encountered, emit `needs_revision` with the shortcut named in the `revisions[]` entry's `gap` field. This list anticipates the cheap-but-wrong paths a writer-agent will try first under iteration pressure (cookbook outcome-grader pattern: anticipate shortcuts).

- **Passing on absence of red tests.** "No failing tests" is necessary but not sufficient — verifier MUST identify what affirmative evidence proves the behavior change works (a passing test that exercises the new path, a manual confirmation captured in impl-summary.md, a measurable metric delta).
- **"I remember it passed."** Verifier MUST Read the actual `.devt/state/impl-summary.json` + `test-summary.json` and quote specific fields in the verification body. Relying on impression from earlier in the session is a shortcut.
- **Citing line numbers from memory** without re-Reading the source file in the current verification pass. If a `revisions[]` entry references `src/foo.py:42`, the verifier MUST Read `src/foo.py` before authoring the entry.
- **Grep-only behavioral verification.** "I grepped for the new function and found it" is presence, not behavior. Verifier MUST trace at least one call site end-to-end (caller → callee → return) for any new function gated by Level 4 (deep verification).
- **Treating `gates.{lint,typecheck,test}.passed=true` as verification of correctness.** Quality gates are necessary but separate from acceptance-criteria verification. AC mapping (Level 5) is the load-bearing check; gates alone earn no verdict.
- **Inferring AC coverage from `impl-summary.md::files_changed` count.** "12 files changed = probably covers all 6 ACs" is correlation, not evidence. Verifier MUST map each AC to specific impl-summary evidence (file:line, test name, or stated artifact).

When a `revisions[]` entry references a shortcut, prefix the `gap` field with `[shortcut]:` so the next programmer pass recognizes the rejection pattern (e.g. `"gap": "[shortcut]: passed on absence of red tests for AC-3; what affirmative test exercises the empty-list path?"`).

## `revisions[]` Array Shape

When `verdict=needs_revision`, `verification.json` MUST include a `revisions[]` array. Each entry references one AC by id and gives the programmer enough context to act:

```json
{
  "revisions": [
    {
      "id": "AC-2",
      "criterion": "POST /users endpoint accepts email + password and returns 201",
      "level_reached": "L1",
      "level_required": "L3",
      "gap": "Route handler exists at routes/users.ts:24 but is not registered in app.ts router chain — calling endpoint returns 404.",
      "evidence": "grep 'usersRouter' app.ts → no matches; curl localhost:3000/users → 404"
    }
  ]
}
```

Required fields per entry: `id`, `gap`. Recommended fields: `criterion`, `level_reached`, `level_required`, `evidence`. Empty/missing recommended fields are tolerated but reduce the programmer's effectiveness on retry — invest in the evidence string when the gap is non-obvious.

The orchestrator passes `revisions[]` to the next programmer dispatch as `<review_feedback>`. The programmer addresses each entry by id; the next verifier pass reports whether each was resolved.

## When to Choose `failed` vs `needs_revision`

Prefer `needs_revision` when:

- The implementation is on the right track but has gaps (missing wiring, partial coverage, scope reduction).
- The programmer can plausibly close the gaps in one more iteration given the `revisions[]` list.
- Build runs, tests run, no architectural conflicts.

Choose `failed` only when:

- The build is broken — `npm run build` / `pytest --collect-only` etc. cannot complete.
- The implementation contradicts the task (built feature X when the task asked for feature Y).
- Verification cannot run at all (test command missing, dependencies unresolvable, project does not import).
- Three or more `revisions[]` entries describe architectural rework (not point fixes) — retry will not converge.

`failed` is a hard stop. The workflow surfaces BLOCKED to the user. Do not use `failed` for "I found a few gaps" — that is what `needs_revision` is for.

## Required: Dispatch warnings acknowledgment

Greenfield calibration #21 V6 surfaced an LLM-operator UX failure mode: session-scoped telemetry (`.devt/state/dispatch-warnings.jsonl`) sits unread because operators forget the CLI exists. To force acknowledgment at finalize time, `verification.md` MUST include a `## Dispatch warnings (session-scoped)` section.

**What goes in the section:**

- Either `raw_dispatch + cliff_signal counts since workflow_start: N + M` (a single line is sufficient when both signals were noise — small N suggests envelope-discipline lapses, small M suggests proportional sub-agent returns).
- OR a brief "investigated, none load-bearing" line citing `node bin/devt-tools.cjs dispatch warnings --since=<workflow_start>` as the inspection source.
- OR a structured triage when counts are non-trivial (≥3 of either): one bullet per incident class with the corrective action taken or deferred.

**Verifier check:**

If the section is missing from `verification.md`, the verifier emits `needs_revision` with `revisions[]` entry `{id: "dispatch-warnings", gap: "verification.md missing required ## Dispatch warnings (session-scoped) section — acknowledge counts or cite explicit triage"}`. This is a process gap, not a quality gap — the implementation work itself is not at issue.

**Skip condition:** when `dispatch-warnings.jsonl` does not exist OR is zero-bytes, the section may state `n/a (no incidents logged this session)` in one line and pass.

## Decision Sketch

```
              ┌─ Build/tests cannot run? ──────────────────────────────────► failed
              │
              ├─ Implementation contradicts task? ─────────────────────────► failed
              │
              ├─ Every AC reaches required level + no scope reduction? ────► satisfied
              │
              ├─ Only NEEDS_HUMAN items remain? ──► satisfied (status=DONE_WITH_CONCERNS)
Verifier ─────┤
              ├─ Gaps are point fixes (wiring, edge case, missing AC)? ────► needs_revision
              │     (populate revisions[] with AC-* ids + gap evidence)
              │
              └─ Gaps require architectural rework? ───────────────────────► failed
```

## What This Rubric Does NOT Cover

- **Iteration counting** — owned by the workflow orchestrator (`workflow.max_iterations` config + `verify_iteration` counter in state).
- **Repair operator selection** (RETRY/DECOMPOSE/PRUNE) — owned by the workflow's gate-check step.
- **Code quality scoring** — owned by the code-reviewer; verifier reads `review.md` but does not re-evaluate quality.
- **Test design quality** — owned by the tester agent; verifier confirms tests RAN, not that they were the right tests.

The verifier's sole job under this rubric is to answer: *did the implementation achieve the goal?*

## Deterministic Gates

Pre-verifier gates enforced by `bin/modules/grader.cjs`. These run BEFORE the LLM verifier dispatch — if any constraint fails, the workflow short-circuits back to the programmer with the failing fields surfaced as `<review_feedback>` (saving an LLM verifier round-trip on red-test cycles). The grader walks each sidecar's constraint tree: scalars demand equality, arrays demand membership (oneOf), nested objects recurse.

```json
{
  "test-summary.json": {
    "verdict": "PASS",
    "tests": {
      "failed_count": 0
    },
    "coverage_complete": true
  },
  "impl-summary.json": {
    "verdict": "PASS",
    "gates": {
      "test":      {"ran": true, "passed": true},
      "lint":      {"ran": true, "passed": true},
      "typecheck": {"ran": true, "passed": true}
    }
  }
}
```

Notes on intent:
- `verdict: "PASS"` blocks the verifier dispatch when the agent's own self-assessment is negative — no point asking the verifier to re-grade work the agent already flagged as failing.
- `tests.failed_count: 0` catches the asymmetric case where verdict is INDETERMINATE but failure counts are non-zero (test runner crashed mid-run).
- `coverage_complete: true` catches the silent-skip failure mode where a JSON-first tester loops over a truncated upstream `impl-summary.json::files_changed` and reports `status=DONE` while testing nothing. The tester computes this boolean by comparing its `coverage_files` to the upstream sidecar's `files_changed` (see `agents/tester.md`); `false` short-circuits to a tester re-dispatch with the missing files as `<review_feedback>`. Converts a previously-invisible truncation propagation into a hard process gate.
- `gates.{lint,typecheck,test}.{ran,passed}` verifies the programmer actually ran each gate. If a project doesn't have a linter configured the programmer should emit `gates.lint.ran: false` and the grader will surface that as a `gate_failures` entry — fail closed by design. To opt a project out of a gate, override the rubric in `.devt/config.json::rubrics.dev` with a customized constraint tree.
