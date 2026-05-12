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
