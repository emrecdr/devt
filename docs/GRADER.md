# Grader + Rubrics

> ↑ Entry point: [`CLAUDE.md`](../CLAUDE.md) (orchestrator architecture + critical contracts).

> Outcome-grader, deterministic pre-verifier gate, pinned rubric versions, and the code-review grader. The grader system gates workflow retries with bounded cost — it skips the LLM verifier on red and feeds structured `revisions[]` back into the next dispatch.

---

## Outcome-Grader (Bounded Retry)

**Agent.** `agents/verifier.md` reads `references/rubrics/<workflow_type>.md` to decide verdict semantics.

**Currently verifier-using workflow types.** `dev`, `code_review`.

**Output.** `verification.json` with:
- Lowercase `verdict` — `satisfied | needs_revision | failed`
- Structured `revisions[]` array — per-criterion gaps keyed by `AC-*` ids (dev) or `A-N` / `B-N` (code-review)

**Workflow retry loop.** `workflows/dev-workflow.md` reads the sidecar via `state read-sidecar`, caps iterations via `workflow.max_iterations` config (default `3`), feeds `revisions[]` directly into the next programmer dispatch as `<review_feedback>`.

**PRUNE outcome.** The orchestrator-level `repair=PRUNE` outcome is set when `verify_iteration >= MAX_ITER` — the verifier itself has no iteration awareness.

### Two `verdict` fields, disjoint scopes

| Field | Vocabulary | Used for |
|---|---|---|
| `workflow.yaml::verdict` | UPPERCASE devt vocab (`GAPS_FOUND`, etc.) | `/devt:next` and `/devt:status` resume routing |
| `verification.json::verdict` | Grader enum (`satisfied`, `needs_revision`, `failed`) | Retry control flow |

Don't conflate them.

---

## Deterministic Pre-Verifier Gate

**Module.** `bin/modules/grader.cjs` — zero-dep stdlib-only.

**What it does.** Extracts the `## Deterministic Gates` JSON block from `references/rubrics/<workflow_type>.<v>.md`, walks the constraint tree against a sidecar's parsed JSON, and returns `{pass, gate_failures: [{field, expected, got}]}`.

**Constraint leaves.**
- Scalar → equality check.
- Array → `oneOf` check.
- Nested object → recurse with a dotted field path.

**CLI.** `node bin/devt-tools.cjs grade <workflow_type> <sidecar.json>`.

### CLI envelope shapes

The grader returns one of three envelope shapes that drive workflow routing:

| Shape | Meaning | Exit | Workflow routing |
|---|---|---|---|
| `{ok: false, reason}` | I/O failure — sidecar missing/malformed or rubric file not found | 1 | BLOCKED, NOT retried |
| `{ok: true, pass: false, gate_failures}` | Constraint violation | 1 | RETRY/PRUNE under `verify_iteration` cap |
| `{ok: true, pass: true}` | Gates green | 0 | LLM verifier dispatches |

### Workflow integration (`dev`)

`workflows/dev-workflow.md` runs the grader against `test-summary.json` AND `impl-summary.json` **BEFORE** the LLM verifier dispatch.

**On `pass: false`** the workflow participates in the same `verify_iteration` counter the LLM verifier path uses:
- Under `workflow.max_iterations` cap → re-dispatch programmer with `gate_failures` as `<review_feedback>`.
- At cap → PRUNE with `gate_failures` written to scratchpad and `status=DONE_WITH_CONCERNS`.

**Savings.** Skips the LLM verifier on red, saves ~5–15K input tokens per failed iteration.

### Rubrics without `## Deterministic Gates`

Rubrics that don't define a `## Deterministic Gates` section short-circuit the grader to `pass: true` (no enforcement). This is intentional — workflows can adopt grader gating incrementally.

---

## Rubric Path Resolution

**Function.** `grader.cjs::resolveRubricPath` — three lookup layers in order:

| Layer | Source | Use case |
|---|---|---|
| 1 | Absolute path in config | Override anywhere on disk |
| 2 | Project-local `<projectRoot>/.devt/rubrics/<file>` | **Canonical escape hatch** for projects with custom constraint trees |
| 3 | Plugin default `<PLUGIN_ROOT>/references/rubrics/<file>` | The shipped rubrics |

### Custom-rubric escape hatch

Drop a `.md` file at `.devt/rubrics/dev-lenient.md` and reference it by name in `.devt/config.json`:

```json
{ "rubrics": { "dev": "dev-lenient.md" } }
```

The grader will find it via layer 2 before falling back to the plugin default.

### Friction note for custom-agent projects

A project running its own `.claude/agents/programmer.md` that doesn't emit `impl-summary.json::gates` will see RETRY-loop-to-PRUNE on iteration 1 with `gate_failures` pointing at `gates.test.ran` / etc. The same applies to projects without a test runner that legitimately emit `gates.test.ran=false`.

**Fix.** Use the project-local-rubric escape hatch to ship a lenient rubric (omit the `## Deterministic Gates` section entirely, or remove the `gates.*` constraints) for those projects.

**Note.** Plugin agents take precedence over project `.claude/agents/` when devt is loaded via the plugin system, so this friction only affects locally-forked devt installs.

---

## Pinned Rubric Versions

**Config.** `bin/modules/config.cjs::DEFAULTS.rubrics` is the version map per workflow_type. Shipped defaults:

```json
{ "dev": "dev.v1.md", "code_review": "code_review.v1.md" }
```

**Init payload.** `init.cjs::initWorkflow` surfaces this at the top level of the payload as `rubrics: {dev: "dev.v1.md", code_review: "code_review.v1.md"}` so dispatch templates use the flat `{rubrics.<workflow_type>}` namespace.

**Workflow injection.** `workflows/dev-workflow.md` verifier dispatch injects `<rubric_path>references/rubrics/{rubrics.dev}</rubric_path>` into the context; `agents/verifier.md` prefers that block over computing the path from `<workflow_type>`.

**Naming convention.** `<workflow_type>.v<N>.md` so we can ship rubric updates as new files without breaking projects pinned to the earlier file. Projects opt in by overriding `rubrics.<workflow_type>` in `.devt/config.json`.

**Smoke gate.** Resolves each verifier-using `workflow_type`'s pinned filename via `DEFAULTS.rubrics`, asserts the file exists, and asserts the init payload + dispatch wiring agree.

---

## Code-Review Grader

**Workflow.** `workflows/code-review.md` dispatches the verifier agent after the code-reviewer writes `review.md`.

**Rubric.** `references/rubrics/code_review.v1.md` (pinned via `DEFAULTS.rubrics.code_review`).

**Grading axes (5).** The verifier grades the **review's quality** along:

| Axis | Check |
|---|---|
| A. Scope coverage | Every file in `review-scope.md` has at least one observation |
| B. Finding specificity | `file:line` + severity + rule ref on every finding |
| C. Severity calibration | No critical-rated nits, no minor-rated security issues |
| D. Remediation concreteness | Critical/Important findings have actionable fixes |
| E. ADR Compliance section | Present when `memory affects` returned hits |

**Revision keys.** `revisions[]` entries are axis-keyed (`A-1`, `B-3`, etc.) so the namespace stays separate from the `dev` rubric's `AC-*` convention.

**Retry target.** On `needs_revision`, the **code-reviewer** (NOT the verifier) is re-dispatched with the gaps as `<reviewer_feedback>`. Iteration cap is `workflow.max_iterations` (default `3`).

**Hard fail.** A REJ-tombstone match in the review's remediation is a hard `failed`, not a `needs_revision` — that's a structural confusion that needs human review.

### Why not arch-health-scan or debug?

Those workflows were considered but deferred. The rubric design for them is **meta-architecture**: grading the architect's analysis is itself an architectural call. Code-review ships because its grading criteria are concrete and the retry cost is low.

---

## Cross-references

- `docs/AGENT-CONTRACTS.md` — JSON sidecar contract (the `verification.json` shape)
- `docs/INTERNALS.md` — `state.cjs::JSON_SIDECAR_SCHEMAS` (verdict enums)
- `agents/verifier.md` — agent body that reads rubrics
- `references/rubrics/dev.v1.md` — current dev rubric with `## Deterministic Gates`
- `references/rubrics/code_review.v1.md` — current code-review rubric
