# Agent + Workflow Contracts

> ↑ Entry point: [`CLAUDE.md`](../CLAUDE.md) (orchestrator architecture + critical contracts).

> Contract sheet for anyone modifying `agents/*.md`, `workflows/*.md`, or `skills/*/SKILL.md`. Every rule here is enforced by smoke gates, by hooks, or by both. Violating them silently breaks dispatch quality, telemetry, or resume routing — not in obvious ways.

Source of truth for the rules themselves is the agent and workflow markdown plus the smoke gates in `scripts/smoke-test.sh`. This document is the **explainer**.

---

## Dispatch Contract

### Cache-friendly dispatch ordering

**Rule.** Every `Task(subagent_type="devt:*", ...)` block in `workflows/*.md` MUST place its per-task dynamic block (`<task>...</task>` or `<bug>...</bug>`) **AFTER** the closing `</context>` tag. Static blocks (`<governing_rules>`, `<guardrails_inline>`, `<workflow_type>`, `<rubric_path>`, `<files_to_read>`, etc.) lead the prompt.

**Why.** The byte-stable prefix cache-hits across retry iterations within the prompt-cache TTL. Putting per-task data inside the prefix invalidates the cache on every retry — agents pay full prefix cost on every iteration.

**Enforcement.** `scripts/check-dispatch-ordering.cjs` is run by `scripts/smoke-test.sh`; it rejects any new dispatch placing `<task>` before `</context>`. Telemetry-side detection via `node bin/devt-tools.cjs token-report --regression` flags cold-prefix streaks signalling a regression.

### Never raw-dispatch devt agents

**Rule.** Orchestrators MUST route through devt slash commands (`/devt:review`, `/devt:workflow`, `/devt:implement`, `/devt:debug`, `/devt:research`, etc.). Direct `Task(subagent_type="devt:*", prompt=...)` calls bypass the workflow's dispatch template — losing `<scope_trust>`, `<scope_hint>`, `<memory_signal>`, the graph-impact map injection, the impact-plan, the verifier loop, and the telemetry surface.

**Defense in depth.**
1. `hooks/dispatch-hygiene-guard.sh` emits an advisory `additionalContext` and appends `source: "raw_dispatch"` to `dispatch-warnings.jsonl` on any `Task` call to a `devt:*` subagent whose prompt lacks all three context blocks.
2. `agents/code-reviewer.md::workflow_context_assertion` hard-stops with `status=BLOCKED` + `verdict=NEEDS_WORK` + a Critical finding pointing at the raw dispatch rather than producing a shallow review.

**Custom parallelism over multi-slice reviews?** Run `/devt:review` once to get the bash plan + graph-impact map computed, then re-dispatch the sliced reviewers manually with `<scope_trust>` + `<scope_hint>` + reference to `.devt/state/graph-impact.md` injected into each prompt.

### Workflow body loading is explicit

**Rule.** Every `commands/*.md` that delegates to a workflow file pairs the `@${CLAUDE_PLUGIN_ROOT}/workflows/<name>.md` reference with a mandatory `Read` instruction in its `<process>` block:
> "Mandatory first action: read the workflow body via the Read tool before any other action."

**Why.** The `@`-reference's auto-inline behavior is harness-dependent; the explicit Read makes the workflow body deterministically present in the orchestrator's context. Without it, the orchestrator can't see `<step>` blocks, skips `context_init`, and the entire workflow contract degrades silently — every integration lives inside those steps.

**Enforcement.** Smoke gate asserts every `@`-ref command also carries the Read instruction.

### Single-dispatch contract for `/devt:review`

**Rule.** The `workflows/code-review.md` spec defines EXACTLY ONE `Task(subagent_type="devt:code-reviewer", …)` dispatch + ONE `Task(subagent_type="devt:verifier", …)` dispatch — no `slice`, `partition`, or `parallel fan-out` keyword appears in the file. Orchestrators MUST NOT improvise N-way parallel fan-out without the workflow contract.

**Why.** Improvised parallelism has no synthesis spec, no slice-aware verifier rubric, and historically produced partial completion (~40% sub-agent success rate in field).

**Canonical recovery path for large reviews.** The code-reviewer's built-in `community-filter for large reviews` restricts deep review to files in the `affected_communities` listed in `graph-impact.md` when scope > 10 files; the rest go into an `## Out-of-Scope Files (Deferred)` section in `review.md`. The orchestrator then dispatches follow-up `/devt:review` calls for the deferred set.

**If parallel fan-out is genuinely needed.** The orchestrator must inject `<scope_trust>` + `<scope_hint>` + a reference to `.devt/state/graph-impact.md` into each manual dispatch and synthesize the results.

### Orchestrator owns MCP; sub-agents are MCP-blind

**Rule.** Every sub-agent's `tools:` frontmatter declares stdlib tools only (`Read, Bash, Glob, Grep` for read-only; `+ Write, Edit` for writers) — never `mcp__*`. The orchestrator runs MCP calls (e.g. `mcp__devt-graphify__query_graph`, `blast_radius`) inside workflow `context_init` bash blocks, writes results to `.devt/state/graph-impact.md`, and sub-agents consume that file READ-ONLY.

**Implication.** Agent bodies and workflow `<task>` dispatch blocks MUST NOT instruct `mcp__*graphify*` calls — those would be dead code the sub-agent can't execute.

**Enforcement.** Smoke gates enforce both: no agent body mentions MCP graphify; no workflow dispatch block carries the `Graphify-first discovery|investigation protocol` / `PROACTIVELY` sub-agent protocol signatures.

**Exception.** The architect agent preloads `graphify-helpers` skill which uses `node bin/devt-tools.cjs graphify <subcmd>` CLI wrappers (Bash-callable, not MCP-callable) — that path is correct and stays.

---

## Scope Hint + Trust Contract

### `<scope_hint>` dispatch tag

**Rule.** Workflows cache `scope_hint_json` at context_init from `.devt/state/preflight-brief.json` and inject `<scope_hint>{scope_hint_json}</scope_hint>` into dispatch sites covering programmer, tester, code-reviewer, verifier, researcher, architect, and debugger. Agents prefer `<scope_hint>` content over independent discovery.

**Wiring.** `dev-workflow.md`, `quick-implement.md`, `code-review.md`, `debug.md`, `research-task.md` all carry this — 11+ dispatch sites total.

**Sidecar shape.** `suggested_reading` is the deduped union of governing docs' `affects_paths` (frontmatter-declared globs) and blast-radius `direct_dependents` (Graphify depth-1 incoming), capped at 8 entries. See `docs/MEMORY.md` (Pre-Flight JSON sidecar) for the full schema.

**Graceful empty.** Empty `[]` is fine — agents fall back to normal discovery when no governing docs match the topic or Graphify is disabled.

### `<scope_trust>` sibling dispatch tag

**Rule.** The same 5 workflows additionally cache `scope_trust_json={trust, lag_commits, fresh}` at context_init (jq projection over the sidecar's `graph_stats.trust` + `staleness.lag_commits` + `staleness.fresh`) and inject `<scope_trust>{scope_trust_json}</scope_trust>` **immediately after** each `<scope_hint>` block.

**Agent behavior under low trust.** The 7 affected agent bodies carry a "Scope trust signal" paragraph instructing low-confidence treatment when `trust ∈ {sparse, empty}` OR `lag_commits` is non-null AND > 10. Each agent's fallback is role-tailored:

| Agent | Low-trust fallback |
|---|---|
| programmer | Lean on `impl-summary` |
| tester | Use `impl-summary` file list |
| code-reviewer | Treat `review-scope.md` as authoritative |
| verifier | Verify path existence on disk |
| researcher | Broaden Glob/Grep |
| architect | Weight `scan-results` + `architecture.md` |
| debugger | Trust stack trace + reproduction |

### Community-filter for large reviews

**Rule.** When `.devt/state/graph-impact.md` lists a non-empty `affected_communities` AND review scope exceeds 10 files, the code-reviewer restricts its initial-pass deep review to files in those communities. Files outside go into an `## Out-of-Scope Files (Deferred)` section in `review.md` so the orchestrator can dispatch a follow-up.

**Why.** Budget protection — converts PR-impact data from a prioritization hint into an enforcing filter so a single dispatch fits within the turn budget on 30+ file PRs.

### Verifier memory signal

**Rule.** Every verifier dispatch in `workflows/dev-workflow.md` and `workflows/code-review.md` includes a `<memory_signal>` block in `<context>` populated by an orchestrator-prep step that runs `node bin/devt-tools.cjs memory query "<task>" --signal=3 --json-compact`. `agents/verifier.md` prefers the inline block over fresh `memory query` calls during the initial scan.

**Why.** Saves 3–4 MCP round trips per verify iteration. The CLI's `--signal` mode returns `{counts: {<domain>: N}, top: [{id, title, doc_type}]}` in one call — bypassing the mutually-exclusive precedence trap of the standalone `--count` / `--domain-counts` / `--top` flags.

**Maintenance discipline.** A `KEEP IN SYNC` comment keeps both verifier dispatches' block ordering aligned.

---

## Agent Output Contract

### Stub-first protocol

**Rule.** Every output-writing agent writes a stub of its target output file as its FIRST `Write`/`Edit` (`# <Artifact> — in progress`), then iterates to fill it.

**Applies to.** programmer, tester, code-reviewer, verifier, debugger, architect, researcher, docs-writer (8 agents).

**Why.** Eliminates the failure mode where a subagent hits its turn budget mid-investigation and the orchestrator can't distinguish "agent never started" from "agent worked but couldn't finalize."

### JSON sidecar contract

**Rule.** Agents that emit a workflow-routing decision write BOTH a `.md` (human review) and a `.json` (machine routing). Schemas registered in `bin/modules/state.cjs::JSON_SIDECAR_SCHEMAS` with per-sidecar enums for `status` + `verdict` + `agent`.

**Reading.** Consumers read via `state read-sidecar <name>` which returns `{ok, file, data, validation:{valid_status, valid_verdict, valid_agent}}`.

**Adding a new sidecar.** One entry in `JSON_SIDECAR_SCHEMAS` + agent body documents the shape + consumer workflow uses `readSidecar`.

**Invariant.** The `.md` and `.json` MUST agree on `status`; mismatches surface as state-validation warnings.

### Sidecar-only status routing

**Rule.** The 3 aligned artifacts that have JSON sidecars — `impl-summary.md` (`impl-summary.json`), `test-summary.md` (`test-summary.json`), `verification.md` (`verification.json`) — DO NOT carry a `## Status` header in their markdown templates. The JSON sidecar is the single source of truth for workflow routing.

**Mechanism.** `bin/modules/state.cjs::SIDECAR_FOR_MARKDOWN` maps markdown → sidecar; `validateConsistency()` reads the sidecar's `status` field for these artifacts and validates against `JSON_SIDECAR_SCHEMAS[sidecar].status`. The remaining ARTIFACT_SCHEMA artifacts (review, debug-summary, arch-review, docs-summary, curation-summary, research) keep the markdown `## Status` header.

**Enforcement.** Smoke gates: agent markdown templates must NOT emit `^## Status$` for sidecar-covered artifacts; `ARTIFACT_SCHEMA` must NOT list them; `SIDECAR_FOR_MARKDOWN` must reference all three.

### Agent artifact provenance

**Rule.** Agent-written artifacts include provenance sections (agent name, timestamp, workflow context) for traceability across the pipeline.

### Agent prompt line budget

**Rule.** Agent prompt files (`agents/*.md`) are budgeted at ≤ 500 lines each, enforced by `scripts/smoke-test.sh`. Exceeding the budget signals time to extract sub-skills, references, or split responsibilities.

**Bump policy.** The limit must be raised deliberately, not silently — silent growth is what the check guards against.

---

## Scope Mode

**Rule.** `scope_mode` (default `"surgical"`) controls how agents handle unrelated findings.

| Mode | Behavior |
|---|---|
| `surgical` | Routes unrelated findings through the Find-Surface-Decide protocol in `golden-rules.md` Rule 5 (ask the user before fixing). |
| `boyscout` | Grants blanket authority for small mechanical in-file cleanups (dead imports, lint warnings, formatting) without asking. |

**Note.** Declarative only — no enforcement code reads `scope_mode`; agents self-regulate based on the rule body and the resolved value in the `init` payload.

---

## Questioning Protocol

**Rule.** `/devt:clarify` and `/devt:specify` interview users following `references/questioning-guide.md`:

- **Before You Ask** — codebase-first: grep/Read/`memory query` before any question; only ask about decisions requiring user judgment.
- **Walk the Decision Tree** — resolve roots before dependents; cut subtrees on root answers.
- **One at a Time** — AskUserQuestion supports 1-4 questions per call but discipline says use 1; each answer reframes the next.
- **Recommendation Required** — every option carries validated reasoning; mark recommended option `(Recommended)` and place first.

**Companion docs.**
- `references/council-offramp.md` — when to escalate to `/devt:council` for high-stakes branches.
- `references/domain-probes.md` — structured probes for domain unknowns.

---

## Plugin Mechanics

### Plugin agent registration

**Rule.** Plugin agents register only when devt is loaded via `claude --plugin-dir <path>` or installed through the plugin system. Sessions started without these loading paths see commands/skills via cwd auto-discovery but `devt:<agent>` subagents will not appear in `claude agents`.

**For development.** Always launch with `claude --plugin-dir /path/to/devt` (see README install).

**Per-agent persistent memory.** Created by `memory:` frontmatter, writes to `.claude/agent-memory/devt-<agent>/MEMORY.md` (gitignored, auto-injected at agent startup).

### `devt:` namespace required for skill preloads

**Rule.** Agent `skills:` preload requires the `devt:` namespace for plugin skills:

```yaml
skills: [devt:codebase-scan]    # ✓ works
skills: [codebase-scan]         # ✗ silently fails
```

**Why.** The plain name silently fails to inject — the skill's full body must be present in the agent's system prompt at startup, verifiable by grepping for a unique phrase from the SKILL.md body via a probe agent.

**Plugin-agent frontmatter restrictions.** Plugin agents do not support `permissionMode`, `hooks`, or `mcpServers` frontmatter (security restriction — silently ignored).

---

## Rejected Patterns

### Sub-conversation JSON returns

**Status.** Rejected. Do not propose adopting Anthropic's specialist-team cookbook pattern where specialists return structured JSON via `send_to_parent` with no shared file artifacts.

**Why devt rejects this.** devt's file-based state (`.devt/state/*.{md,json}`) is the load-bearing mechanism for **cross-session resume + `/devt:next` + `/devt:pause` + handoff continuity** — capabilities that an in-conversation specialist-return pattern cannot provide. Anthropic's specialist cookbook assumes a single live orchestrator session; devt is plugin-orchestrated and outlives any conversation.

**Reference.** This aligns with the managed-agents engineering article ("session log serves as durable, interrogable state").

**Do not** propose "modernizing" specialists to JSON-only returns — it would silently break resume.

---

## Cross-references

- `docs/MEMORY.md` — pre-flight, scope_hint sidecar shape, memory layer mechanics
- `docs/INTERNALS.md` — governing_rules wiring, inline guardrails, sidecar registry, MCP trace
- `docs/HOOKS.md` — dispatch-hygiene-guard, dispatch-scope-guard, pre-flight-guard, bash-guard
- `docs/GRADER.md` — verifier outcome-grader, code-review grader, pinned rubrics
- `docs/GRAPHIFY.md` — graphify-first protocol, scan_prep gate, eviction CLI
- `docs/STATE-RULES.md` — `.devt/state/` filename contract
- `guardrails/golden-rules.md` — universal development rules
- `references/questioning-guide.md` — full questioning protocol
