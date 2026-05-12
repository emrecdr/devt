# Verifier Rubric — `code_review` Workflow

This rubric drives outcome grading for the `code_review` workflow's verifier agent. The verifier here grades the **quality of the review itself**, not the underlying code. It reads its general technique library from `agents/verifier.md`; it reads **what passes** for a code review from this file.

## What the verifier is grading

The code-reviewer (a separate, upstream agent) writes `.devt/state/review.md` with verdict `APPROVED | APPROVED_WITH_NOTES | NEEDS_WORK`. The verifier's job here is a **meta-grade**: did the review do its job well? A thorough review earns `satisfied`. A review with gaps (missed scope files, vague findings, miscalibrated severity, no remediation) earns `needs_revision` so the workflow re-dispatches the reviewer with targeted feedback. The verifier is NOT re-doing the code review — it's spot-checking thoroughness.

## Verdict Vocabulary

The verifier emits a `verdict` in `verification.json` from this enum:

| Verdict          | Meaning                                                                                                                 | Workflow Action                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `satisfied`      | The review covers every scope file, findings are specific (file:line + rule ref), severities are calibrated, remediation is concrete. | Workflow proceeds to `present_findings`.                                                                              |
| `needs_revision` | The review has fixable gaps: missing files, vague findings, miscalibrated severity, or unsupported claims. Reviewer can close the gaps in one more pass given `revisions[]`. | Workflow re-dispatches code-reviewer with `revisions[]` from the sidecar as `<reviewer_feedback>`; increments `verify_iteration`. |
| `failed`         | The review is structurally broken (status missing, no findings list, can't parse the markdown) OR review-scope.md is missing entirely. | Workflow surfaces BLOCKED to the user; no further retry.                                                              |

The orchestrator owns the terminal `max_iterations_reached` outcome — when `verify_iteration >= workflow.max_iterations` and the verdict is still `needs_revision`, the workflow PRUNEs (writes remaining gaps to scratchpad, proceeds with `status=DONE_WITH_CONCERNS`). The verifier itself never emits `max_iterations_reached`.

## Status Field

`status` mirrors the human-readable verdict shown in `verification.md`. Map deterministically from `verdict`:

| verdict          | status                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| `satisfied`      | `VERIFIED` (or `DONE_WITH_CONCERNS` if `NEEDS_HUMAN` items in `review.md`) |
| `needs_revision` | `GAPS_FOUND`                                                            |
| `failed`         | `FAILED`                                                                |

## Grading axes (what to actually check)

The verifier evaluates the review against **five axes**. Each axis must pass for `verdict=satisfied`. Any failed axis produces a `revisions[]` entry.

| Axis | Bar | How to check |
| ---- | --- | ------------ |
| **A. Scope coverage** | Every file listed in `.devt/state/review-scope.md` appears at least once in `review.md` — either as an explicit finding OR an explicit "no issues found in `<file>`" line. | `grep` each scope file against `review.md`. A file with zero mentions is a gap. |
| **B. Finding specificity** | Each finding has: `file:line` reference, severity tier (Critical / Important / Minor / Nit), and either a rule reference (CLAUDE.md rule, `.devt/rules/coding-standards.md` clause, ADR id) OR a concrete code-pattern citation. Findings of the form "could be cleaner" with no anchor are gaps. | Sample 3-5 findings at random; check each has the required fields. |
| **C. Severity calibration** | No critical-rated nits (e.g. "Critical: variable naming"). No minor-rated security/data-mutation issues (e.g. "Minor: SQL injection on POST /admin"). Severity must match impact. | Read each Critical and each Minor finding; flag any obvious miscalibration. |
| **D. Remediation concreteness** | Every Critical and Important finding describes a remediation step — "replace X with Y", "extract the validation to module Z", "add a test for the empty-collection case." Findings that only describe the problem without a fix direction are gaps for NEEDS_WORK reviews; informational-only is acceptable for APPROVED_WITH_NOTES. | Re-read each Critical/Important finding; check for an actionable fix. |
| **E. ADR Compliance section** | If `node bin/devt-tools.cjs memory affects <file>` returns hits for any scope file, `review.md` MUST include an `## ADR Compliance` section that addresses each affected ADR/CON/FLOW. Reviews missing this section when memory affects-paths returned hits are gaps. (Skip this axis when memory layer is disabled OR no affects hits exist for any scope file.) | Run `memory affects` for each scope file; if hits, grep review.md for ADR Compliance section. |

A sixth axis — **REJ tombstone alignment** — is a hard fail rather than a gap: if `review.md` proposes (in any remediation) an approach whose keywords match a REJ tombstone via `memory rejected-keywords`, the verdict is `failed` (not `needs_revision`). The reviewer is recommending something the team explicitly tombstoned; that's not a "fix this and retry" — it's a structural confusion that needs human review.

## `revisions[]` Array Shape

When `verdict=needs_revision`, `verification.json` MUST include a `revisions[]` array. Each entry references one axis + one specific gap:

```json
{
  "revisions": [
    {
      "id": "A-1",
      "axis": "scope_coverage",
      "criterion": "Every file in review-scope.md appears at least once in review.md",
      "gap": "src/auth/middleware.ts is in review-scope.md but has zero mentions in review.md — reviewer skipped it",
      "evidence": "grep 'middleware.ts' .devt/state/review.md → no matches"
    },
    {
      "id": "B-3",
      "axis": "finding_specificity",
      "criterion": "Each finding has file:line + severity + rule ref",
      "gap": "Finding 'Logic could be simplified' at line 47 of review.md has no file:line anchor and no rule citation",
      "evidence": "review.md line 47: \"Logic could be simplified — consider refactoring\""
    }
  ]
}
```

Required fields per entry: `id`, `axis`, `gap`. Recommended: `criterion`, `evidence`. The orchestrator passes `revisions[]` to the next code-reviewer dispatch as `<reviewer_feedback>`. The reviewer addresses each entry by id; the next verifier pass reports whether each was resolved.

`id` convention: `<axis-letter>-<seq>`. This keeps the namespace separate from the `dev` rubric's `AC-*` style so cross-rubric collisions are impossible at a glance.

## When to choose `failed` vs `needs_revision`

Prefer `needs_revision` when:

- The review exists and has the right shape but misses scope, lacks specificity, or has calibration issues.
- The code-reviewer can plausibly close the gaps in one more iteration given `revisions[]`.

Choose `failed` only when:

- `review.md` is missing, empty, or unparseable.
- `.devt/state/review-scope.md` is missing (the reviewer was dispatched without scope — a workflow bug, not a review quality issue).
- The review proposes (in remediation) an approach that matches a REJ tombstone — see axis F above.
- 3+ axes fail simultaneously across the same finding cluster — re-dispatch will not converge; surface to human.

`failed` is a hard stop. The workflow surfaces BLOCKED to the user. Do not use `failed` for "the review missed one file" — that is what `needs_revision` is for.

## Decision Sketch

```
              ┌─ review.md missing/empty/unparseable? ──────────────────► failed
              │
              ├─ review-scope.md missing? ─────────────────────────────► failed
              │
              ├─ Remediation matches a REJ tombstone? ─────────────────► failed
              │
              ├─ Every axis A–E passes + no NEEDS_HUMAN flags? ────────► satisfied
              │
Verifier ─────┤
              ├─ Only NEEDS_HUMAN flags remain? ──► satisfied (status=DONE_WITH_CONCERNS)
              │
              ├─ Axis A–E failures are point fixes (1-3 entries)? ─────► needs_revision
              │     (populate revisions[] with axis-keyed ids + gap evidence)
              │
              └─ 3+ axes fail simultaneously across same finding cluster? ► failed
```

## What this rubric does NOT cover

- **Iteration counting** — owned by the workflow orchestrator (`workflow.max_iterations` config + `verify_iteration` counter in state).
- **Re-running the code review** — the verifier spot-checks; it does not re-perform the review. If the verifier finds itself wanting to add findings the reviewer missed, that's a `needs_revision` with `axis=scope_coverage` or `axis=finding_specificity` — the reviewer goes back to add them.
- **Severity-recalibration adjudication** — when the verifier disagrees with a severity, the gap is "miscalibrated" but the reviewer chooses the final severity on retry. Verifier does not have severity-veto authority.
- **Test design quality** — that's the tester agent's domain. Code review verifier reads `test-summary.md` for context but does not grade test quality.

The verifier's sole job under this rubric is to answer: *did the code review do its job well enough to act on?*
