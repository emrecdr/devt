---
name: dispatch-helpers
description: Use whenever the orchestrator is about to issue a raw Agent() / Task() dispatch to a devt:* subagent (single OR parallel) instead of routing through /devt:review or /devt:workflow. Surfaces two CLIs that build the canonical envelope so context blocks (scope_trust, scope_hint, memory_signal, governing_rules) are never silently dropped — `dispatch run agent --task=...` for one-off single dispatches, `dispatch render-filled agent:auto` for advanced cases (lane fan-out, pre-computation, custom edits). Trigger phrases include single dispatches like "dispatch devt:code-reviewer to review X", "run devt:programmer for Y"; fan-out like "fan out review across files", "parallel reviewer across communities"; recovery like "re-dispatch programmer with continuation".
allowed-tools: Bash Read
user-invocable: false
---

# Dispatch Helpers — Canonical Envelope Generation for Raw Dispatches

## When to use this skill

The devt CLAUDE.md "Critical Agent + Workflow Contracts" section says:

> Never raw-dispatch devt agents. Orchestrators MUST route through devt slash commands (/devt:review, /devt:workflow, …). Direct Task(subagent_type="devt:*", prompt=…) calls bypass the workflow's dispatch template — losing <scope_trust>, <scope_hint>, <memory_signal>, the graph-impact map injection, the impact-plan, the verifier loop, and the telemetry surface.

**Prefer `/devt:review` / `/devt:workflow` / `/devt:debug` when applicable.** This skill is for the genuine edge cases where the canonical path doesn't fit: ad-hoc single dispatches that don't match a slash command's shape, parallel fan-out across file groups, or recovery / second-pass scenarios on existing artifacts.

The cost of bypassing canonical paths without this skill: orchestrators construct prose context by hand, drop the structured blocks, and the agent runs in degraded mode (grep-first discovery, no caller verification, no telemetry). The CLIs below eliminate that cost.

## CLI surface — pick by shape

### One-off dispatch (the common case) — `dispatch run`

Use for ONE devt agent invocation that doesn't fit a `/devt:*` slash command. Example: dispatching `devt:tester` to rewrite a hurl spec file when no slash command matches that intent.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" dispatch run <agent> --task="..."
```

- `<agent>` — `programmer | tester | code-reviewer | verifier | researcher | debugger | architect | curator | docs-writer | retro`
- `--task="..."` — your task text; gets injected verbatim into the envelope's `<task>` block
- Output: paste-ready `Task(subagent_type="devt:<agent>", model="...", prompt="...")` invocation with the canonical envelope filled and your task substituted
- Errors loudly when no active workflow exists (because `:auto` workflow-id resolution needs one)

**Worked example** — replacing a raw `Agent(subagent_type="devt:code-reviewer", prompt="review my new tests")` call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" dispatch run code-reviewer --task="Review the new tests/contacts/test_exporter.py — focus on the row-limit pre-flight gate + the soft-deleted org filter"
```

Copy the emitted block into your next Task() call. Done. Every context block (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`, `<governing_rules>`, `<guardrails_inline>`, `<rubric_content>`, agent skills) is filled from current state — no manual block composition.

### Advanced — `dispatch render-filled`

Use for parallel fan-out (multiple lanes, each needs its own envelope), pre-computing envelopes for orchestration planning, or when the envelope needs editing before dispatch (e.g., custom rules-exclude, model override).

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" dispatch render-filled <agent>:<workflow_id|auto>
```

- `<workflow_id>` — explicit id from `.devt/state/workflow.yaml::workflow_id` OR the literal `auto`
- Output: the same envelope shape as `dispatch run`, but with the template's default `<task>` block (no `--task=` substitution)
- Use case: you'll customize each lane's `<task>` block manually after rendering

### Companion — `state refresh-scope-context`

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context
```

Re-derives `scope_trust` from `preflight-brief.json::graph_stats + staleness` and persists to `workflow.yaml::scope_trust_json`. Cost ~50ms, idempotent. Run BEFORE `dispatch run` / `dispatch render-filled` if the session spans many commits or extensive code reading — keeps the rendered envelope's scope-trust signal fresh.

## Advanced — parallel code-reviewer fan-out

Scenario: a review scope of 24 files split into 3 file-group lanes (8 files each). `/devt:review` would dispatch ONE code-reviewer with the community-filter; the orchestrator wants three reviewers in parallel.

### Step 1: keep the scope_trust fresh

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1
```

### Step 2: render one envelope per lane

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" dispatch render-filled code-reviewer:auto > /tmp/lane-1-envelope.txt
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" dispatch render-filled code-reviewer:auto > /tmp/lane-2-envelope.txt
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" dispatch render-filled code-reviewer:auto > /tmp/lane-3-envelope.txt
```

(All three envelopes are byte-identical at this point — same workflow_id, same state. Customize per-lane by appending lane-specific file lists to the rendered `<task>` block.)

### Step 3: append lane scope to each envelope

After rendering, the `<task>` block in the envelope is the substitution point for per-lane scope. Edit each envelope to inject the lane's file list:

```
<task>{task_description}

  **Lane scope (lane 1 of 3)**: focus deep review on these 8 files only — defer the rest of the review scope to other lanes:
  - src/api/foo.ts
  - src/api/bar.ts
  - ...

  Write findings to .devt/state/review-lane-1.md (not review.md — orchestrator will synthesize).
</task>
```

### Step 4: dispatch each lane in a single message with three parallel Task() calls

Per the CLAUDE.md cache-friendly dispatch ordering: each `Task()` invocation gets its lane-specific envelope as the `prompt=` value. Inject all three in one assistant message so they run concurrently.

### Step 5: synthesize the per-lane review outputs

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state aggregate-knowledge-candidates
```

The per-lane outputs (`.devt/state/review-lane-{1,2,3}.md`) are picked up by the orchestrator for synthesis into a final `review.md`.

## What `render-filled` substitutes

| Placeholder class | Examples | Source |
|---|---|---|
| Data refs | `{scope_trust_json}`, `{scope_hint_json}`, `{memory_signal_json}`, `{task_description}` | `state read` / `workflow.yaml` |
| Governing rules | `{governing_rules.content["CLAUDE.md"]}`, `{governing_rules.rules_hash}` | `loadGoverningRules(project_root)` |
| Guardrails | `{inline_guardrails["golden-rules.md"]}` | `loadInlineGuardrails(plugin_root)` |
| Rubrics | `{inline_rubrics.dev}`, `{rubrics.code_review}` | `loadInlineRubrics()` |
| Models | `{models.programmer}`, `{models.code-reviewer}` | `getModels(config.model_profile)` |

Unknown placeholders (prose-descriptions like `{learning_context — relevant lessons from .devt/memory/lessons/...}`) are left verbatim — they're instructions for the orchestrator to look up context at agent-read time, not substitution targets.

## Long-running synthesis — SendMessage-resume pattern

A single subagent dispatched for multi-section work (programmer doing R1-R10 implementation, code-reviewer doing community-filter on 10+ files, verifier walking N revisions) can hit the per-dispatch tool-call budget (~91 calls in field observation) before finishing. The Q8 contract addresses this with explicit Status: PARTIAL declaration; the SendMessage-resume pattern is the cheap recovery primitive.

**Architecture.** When a subagent hits a section boundary AND has more work remaining AND has done significant tool calls, it emits Status: PARTIAL with a Next-section marker (per `agents/<name>.md::section_completion_protocol`). The workflow's claim-check (Q11) reads the sidecar; PARTIAL routes to SendMessage-resume primary, re-dispatch fallback.

**Why SendMessage is the cheap path.** SendMessage to the same subagent re-uses the full conversation cache — every prior Read, Edit, Bash result stays available at the cost of one new prompt. A fresh re-dispatch via `Task(subagent_type=...)` starts cold, paying the full context-loading cost (skill injection, governing rules, file Reads to re-discover working set). Field observation: roughly 15-20 file Reads saved per SendMessage-resume vs cold re-dispatch.

**When to use re-dispatch instead.** After session boundary (`/devt:workflow --pause` + resume in new session), or when the subagent-id is no longer addressable. Re-dispatch reads the partial artifact via `<continue_from_checkpoint>` block instead of conversation history.

**Worked example** — programmer with 6-section impl (B.1-B.6), hit wall at B.5 mid-Edit:

```
SendMessage(to=<programmer-subagent-id>, content="
<continue_from_section>B.5</continue_from_section>
<context>
  <prior_work>Read .devt/state/impl-summary.md — B.1-B.4 complete; B.5 partially done in events.py.</prior_work>
  <task>Continue B.5 from where you left off + complete B.6 + tests. Same Q8 protocol — emit Status: PARTIAL with Next-section if you hit the wall again.</task>
</context>
")
```

If the same subagent hits the wall again, the workflow loops: SendMessage → PARTIAL detection → next SendMessage. Each iteration progresses by one or more sections.

See `docs/AGENT-CONTRACTS.md::Q8 worked example` for the full sidecar shape + re-dispatch fallback.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `auto-workflow-id: no active workflow` | No `.devt/state/workflow.yaml` with `active=true` | Run `/devt:workflow` / `/devt:review` / etc. to seed state first, OR pass explicit `<agent>:<workflow_id>` |
| `agent 'X' not declared in io-contracts.yaml` | Typo or non-devt agent name | Use one of: programmer, tester, code-reviewer, verifier, researcher, debugger, architect, curator, docs-writer, retro |
| `no envelope template for agent 'X'` | Agent declared in contracts but template file missing | File a bug — `templates/dispatch/envelopes/X.tmpl.md` should exist |
| Empty/placeholder values in rendered envelope | Project-specific files (e.g. `.devt/rules/architecture.md`) don't exist | This is fine — the agent will fall back to defaults at read-time |

## Why this is not the default path

Auto-injection happens at the hook layer too: when `dispatch_hygiene_mode=warn` in `.devt/config.json`, raw dispatches automatically receive the canonical envelope via the `dispatch-hygiene-guard.sh` PreToolUse hook's `additionalContext`. In `block` mode (the default), raw dispatches are denied entirely — the orchestrator must re-route through a workflow.

This skill is for orchestrators that need to pre-compute envelopes for planning purposes, or for projects running in `warn` mode where the hook's auto-injection is a fallback rather than the primary discovery surface.
