# Dispatch Escape-Hatch Recipes

> Operator how-to for the cases where no `/devt:*` slash command fits — multi-lane fan-out with custom per-lane scope, secondary side audits, ad-hoc continuations after a workflow closed. Each recipe preserves the dispatch envelope (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`, `<graph_impact>`) so the dispatch-hygiene hook doesn't fire and the agent gets the full graph context.
>
> For the contract these recipes preserve, see [`AGENT-CONTRACTS.md`](../AGENT-CONTRACTS.md) (Never raw-dispatch / Single-dispatch contract).

## Render the canonical envelope

`dispatch render-filled` renders the current envelope with all placeholders filled from `.devt/state/workflow.yaml`. Paste into a `Task()` call.

```bash
node bin/devt-tools.cjs dispatch render-filled <agent>:<workflow_type>     # e.g. code-reviewer:code_review_parallel
node bin/devt-tools.cjs dispatch render-filled <agent>:auto                # resolves workflow_type from active workflow.yaml
```

## Recipe 1 — Multi-lane parallel review, custom scope

Run `/devt:review` once to populate `workflow.yaml::scope_*_json` + `.devt/state/graph-impact.md`, then fan out N lane dispatches. For each lane, start from `dispatch render-filled code-reviewer:code_review_parallel` and edit the `<task>` block to scope the lane's files. Each lane gets the envelope automatically.

## Recipe 2 — Secondary side audit of a prior review

No standalone slash command exists. Render `dispatch render-filled code-reviewer:code_review`, then replace the `<task>` block with the audit instructions. The envelope keeps the graph context the audit needs.

## Recipe 3 — Standalone post-workflow docs refresh

Use `/devt:workflow --mode=docs` (one-shot slash, no active workflow required) — wraps `workflows/docs-extraction.md` which dispatches `devt:docs-writer` with the proper envelope.

## Recipe 4 — Standalone post-workflow retro

Use `/devt:workflow --retro` (one-shot slash) — wraps `workflows/lesson-extraction.md` which dispatches `devt:retro` + `devt:curator`.

## Recipe 5 — Multi-lane parallel review with a hand-rolled partition

The formal alternative to raw dispatch when you already know the per-lane file partition (you don't need `code-review.md::partition_lanes` to compute it via `graphify lane-suggestions` or path-based fallback). Register each lane formally so the dispatch envelope carries the canonical rubric self-grade directive, files persist to a per-lane sidecar, and the hygiene guard sees the lane registry instead of raw dispatches.

```bash
# 1. Register lanes — either incrementally or in bulk from a YAML file
node bin/devt-tools.cjs state register-lane --id=L1 --scope=identity --files=app/services/identity/auth.py,app/services/identity/middleware.py
# or, for the common "I have all N lanes mapped" case:
node bin/devt-tools.cjs state register-lanes --from=/tmp/lanes.yaml

# 2. Emit one envelope per registered lane (canonical code-reviewer:code_review template — carries the rubric self-grade directive)
node bin/devt-tools.cjs dispatch render-lanes --out=/tmp/lane-envelopes/
# Each lane gets its own envelope with <lane_id>, <lane_community>, <lane_files> injected, and `Write review to .devt/state/review.md` overridden to the lane's review_file.
```

Paste each `/tmp/lane-envelopes/lane-L*.txt` into a parallel `Task()` call (one message, N Task tools). Lanes get the full canonical envelope + rubric self-grade directive without the orchestrator hand-rolling task text. This makes the hand-rolled-task-text-omits-rubric bypass structurally impossible.

## Recipe 6 — Side audit in a separate headless session

For an audit that should not share the current session's context or workflow state, `claude --bg "<task>"` (Research Preview) launches a detached background session instead of a subagent. Pair it with the concurrent-session discipline: generated/handoff files carry the spawning session's discriminator, and canonical `.devt/state/` writes belong to per-instance dirs (`state new-instance`).

## Recipe 7 — Cross-project orchestration (review a sibling project from this session)

Field-proven shape for running a full `/devt:review` (single or parallel) against a project that is NOT this session's working directory — the orchestrator stays here, the target project's `.devt/state/` carries the workflow. Four blind spots and their compensations:

1. **CLI calls**: prefix every devt-tools invocation with `cd <target-root> && ` — state, lanes, preflight, and diff-LOC all resolve from cwd. Render envelopes from the target cwd (`dispatch render-lanes --out=<dir>` / `render-filled --out=<file>`) and dispatch the emitted pointer stubs, which keep 50KB envelopes out of orchestrator context.
2. **Subagents inherit the SESSION's cwd, not the target's**: prepend a root-pin preamble to every dispatch prompt — declare `<project_root>`, instruct `cd <target-root>` for Bash and absolute paths for Read/Grep/Glob, and note that the harness-injected CLAUDE.md belongs to the session project (the agent must Read the target's CLAUDE.md instead).
3. **MCP servers bind the session root**: graphify MCP tools query the wrong graph — execute the impact plan through the Bash-callable `devt-tools graphify` wrappers (`blast-radius`, `neighbors`, `augment-impact-map`), which are cwd-resolved. Same args-VERBATIM contract.
4. **Hooks log to the session project's ledger**: dispatch-hygiene warnings land in the session's `dispatch-warnings.jsonl`, not the target's — advisory noise here, and the target's finalize gates read the target's own ledger.

## Gap not covered above?

Raise it — the workflow pattern probably warrants a new slash command or workflow file rather than a raw dispatch.
