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

**Custom parallelism over multi-slice reviews?** Run `/devt:review` once to get the bash plan + graph-impact map computed, then re-dispatch the sliced reviewers manually. The `dispatch render-filled <agent>:auto` CLI generates the paste-ready envelope with `<scope_trust>` + `<scope_hint>` + `<memory_signal>` + governing rules + guardrails substituted from current state; append per-lane scope details to its `<task>` block before each manual `Task()` call. The `dispatch-helpers` skill (`skills/dispatch-helpers/`) autoloads on fan-out phrasing and teaches the lane-customization pattern. In `warn` mode the hook auto-attaches the canonical envelope to `additionalContext` at the moment of decision.

### Workflow body loading is explicit

**Rule.** Every `commands/*.md` that delegates to a workflow file pairs the `@${CLAUDE_PLUGIN_ROOT}/workflows/<name>.md` reference with a mandatory `Read` instruction in its `<process>` block:
> "Mandatory first action: read the workflow body via the Read tool before any other action."

**Why.** The `@`-reference's auto-inline behavior is harness-dependent; the explicit Read makes the workflow body deterministically present in the orchestrator's context. Without it, the orchestrator can't see `<step>` blocks, skips `context_init`, and the entire workflow contract degrades silently — every integration lives inside those steps.

**Enforcement.** Smoke gate asserts every `@`-ref command also carries the Read instruction.

### Single-dispatch contract for `/devt:review`

**Rule.** The `workflows/code-review.md` spec defines EXACTLY ONE `Task(subagent_type="devt:code-reviewer", …)` dispatch + ONE `Task(subagent_type="devt:verifier", …)` dispatch — no `slice`, `partition`, or `parallel fan-out` keyword appears in the file. Orchestrators MUST NOT improvise N-way parallel fan-out without the workflow contract.

**Why.** Improvised parallelism has no synthesis spec, no slice-aware verifier rubric, and historically produced partial completion (~40% sub-agent success rate in field).

**Canonical recovery path for large reviews.** The code-reviewer's built-in `community-filter for large reviews` restricts deep review to files in the `affected_communities` listed in `graph-impact.md` when scope > 10 files; the rest go into an `## Out-of-Scope Files (Deferred)` section in `review.md`. The orchestrator then dispatches follow-up `/devt:review` calls for the deferred set.

**If parallel fan-out is genuinely needed.** The orchestrator must inject `<scope_trust>` + `<scope_hint>` + a reference to `.devt/state/graph-impact.md` into each manual dispatch and synthesize the results. The `dispatch render-filled <agent>:auto` CLI produces a paste-ready envelope with all context blocks pre-substituted, eliminating the hand-composition friction that historically drove orchestrators toward prose-only dispatches.

**Sanctioned exception.** `workflows/code-review-parallel.md` dispatches N code-reviewers in foreground parallel (single message, multi-Task) when scope > 10 files AND the user opts in via AskUserQuestion. The parallel workflow inherits the same context-block contract (`scope_trust` + `scope_hint` + `memory_signal` injected per dispatch); the L1 dispatch-hygiene hook accepts all lane Task() calls. Substance gates per-lane (via `state check-agent-output`) and a consolidator dispatch enforce the same quality bar. Orchestrator improvisation OUTSIDE this workflow remains prohibited.

### Orchestrator owns MCP; sub-agents are MCP-blind

**Rule.** Every sub-agent's `tools:` frontmatter declares stdlib tools only (`Read, Bash, Glob, Grep` for read-only; `+ Write, Edit` for writers) — never `mcp__*`. The orchestrator runs MCP calls (e.g. `mcp__devt-graphify__query_graph`, `blast_radius`) inside workflow `context_init` bash blocks, writes results to `.devt/state/graph-impact.md`, and sub-agents consume that file READ-ONLY.

**Implication.** Agent bodies and workflow `<task>` dispatch blocks MUST NOT instruct `mcp__*graphify*` calls — those would be dead code the sub-agent can't execute.

**Enforcement.** Smoke gates enforce both: no agent body mentions MCP graphify; no workflow dispatch block carries the `Graphify-first discovery|investigation protocol` / `PROACTIVELY` sub-agent protocol signatures.

**Exception.** The architect agent preloads `graphify-helpers` skill which uses `node bin/devt-tools.cjs graphify <subcmd>` CLI wrappers (Bash-callable, not MCP-callable) — that path is correct and stays.

**Corollary (L1-v2 — greenfield calibration #11).** Per-lane filtering of the shared cache happens at the ORCHESTRATOR, not the lane. `code-review-parallel.md::dispatch_lanes` detects prose-only lanes (`<lane_files>` containing only `.md` / `.rst` / `.txt` / `.adoc` files) and replaces the `graph-impact.md` injection with a `<graphify_status>not_applicable</graphify_status>` stub. Lanes never query graphify themselves; the orchestrator decides what each lane sees based on the lane's scope. Greenfield's L3 README-review lane was receiving the GLOBAL preflight cache (`effect_size: large`, `god_node_match: true` computed against the full PR scope including code files) — pure noise for a markdown-only review.

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

### Reviewer rubric self-check

**Rule.** Every code-reviewer dispatch in `workflows/code-review.md` (single + verifier paths) and `workflows/code-review-parallel.md` (per-lane + consolidator) carries `<rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>` plus `<rubric_content>{inline_rubrics.code_review}</rubric_content>` from the init payload. `agents/code-reviewer.md::Rubric self-check (C7-7)` parses the inline block and walks axes A–G (scope coverage, finding specificity, severity calibration, remediation concreteness, ADR Compliance section when memory affects-paths returned hits, Reuse Discipline section when `reuse-candidates.md` is non-empty) as it writes `review.md` — same axes the verifier will grade against.

**Why.** Saves ~5K tokens per avoided verifier-revision round-trip by aligning reviewer ↔ verifier on the same rubric in the first pass, rather than discovering axis drift via the revisions[] loop. Reviewer + verifier no longer work from independent quality bars.

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

### Status enum + PARTIAL semantics (Q8 contract)

**Rule.** Every output-writing agent declares a Status from a controlled enum. The enum varies by agent role but ALWAYS includes `PARTIAL` so a subagent that hits its per-dispatch tool budget mid-task can signal incomplete work without faking completion.

**Per-agent enums** (canonical source: `bin/modules/state.cjs::JSON_SIDECAR_SCHEMAS` for sidecar agents; agent markdown templates for non-sidecar agents):

| Agent | Status enum |
|---|---|
| programmer (sidecar) | `DONE / DONE_WITH_CONCERNS / PARTIAL / BLOCKED / NEEDS_CONTEXT` |
| tester (sidecar) | `DONE / DONE_WITH_CONCERNS / PARTIAL / BLOCKED / NEEDS_CONTEXT` |
| code-reviewer (sidecar) | `DONE / PARTIAL / BLOCKED` |
| verifier (sidecar) | `VERIFIED / GAPS_FOUND / FAILED / DONE_WITH_CONCERNS / PARTIAL` |
| architect (markdown) | `DONE / DONE_WITH_CONCERNS / PARTIAL / BLOCKED / NEEDS_CONTEXT` |
| researcher (markdown) | `DONE / DONE_WITH_CONCERNS / PARTIAL / BLOCKED / NEEDS_CONTEXT` |
| debugger (markdown) | `FIXED / NEEDS_MORE_INVESTIGATION / DONE_WITH_CONCERNS / PARTIAL / BLOCKED` |
| docs-writer (markdown) | `DONE / DONE_WITH_CONCERNS / PARTIAL / BLOCKED / NEEDS_CONTEXT` |
| curator (markdown) | `DONE / DONE_WITH_CONCERNS / PARTIAL / BLOCKED / NEEDS_CONTEXT` |
| retro (yaml) | `DONE / DONE_WITH_CONCERNS / PARTIAL / BLOCKED / NEEDS_CONTEXT` |

**PARTIAL emission convention.** When emitting Status: PARTIAL, the agent also writes a Next-section indicator pointing at the work remaining:
- Sidecar agents: `{"status": "PARTIAL", "next_section": "B.5", ...}` in the JSON sidecar (no schema validation on the field — informational only)
- Non-sidecar agents: `## Next-section: B.5` markdown section after the `## Status: PARTIAL` block

**Workflow routing on PARTIAL.** Detection happens in two layers:
1. **Sidecar agents** → workflow reads `<sidecar>.status === "PARTIAL"` directly
2. **Non-sidecar agents** → workflow greps `^## Status: PARTIAL` in the markdown output
3. **Backup (M9 regex)** → workflow scans the agent's return text for mid-task language (`\b(now|next|remaining|continue|then\s+B\.\d+)\b`) when in {STANDARD, COMPLEX} tier; catches agents that forgot to emit the explicit token

On PARTIAL detection, workflow routes to SendMessage-resume (in-session continuation) primary, re-dispatch with `<continue_from_checkpoint>` block fallback (cross-session resume).

### Q8 worked example — resume protocol

**Scenario.** Workflow dispatches programmer for a 6-section implementation (`B.1` through `B.6`). Programmer completes B.1-B.4 + part of B.5, hits the ~91-tool-call wall mid-Edit on `events.py`. Per `agents/programmer.md::section_completion_protocol`, programmer writes:

```json
{
  "status": "PARTIAL",
  "next_section": "B.5",
  "verdict": "INDETERMINATE",
  "summary": "B.1-B.4 complete + tests passing (427). B.5 mid-implementation in events.py — completed event class definitions, started subscriber wiring."
}
```

**Detection.** Workflow's claim-check (Q11) confirms `impl-summary.md` exists and `impl-summary.json::status === "PARTIAL"`. Workflow does NOT advance `phase=implement status=DONE`.

**Recovery — SendMessage primary path** (in-session, ~one-prompt cost, full subagent context preserved):

```
SendMessage(to=<programmer-subagent-id>, content="
<continue_from_section>B.5</continue_from_section>
<context>
  <prior_work>Read .devt/state/impl-summary.md — B.1-B.4 complete; B.5 partially implemented in events.py.</prior_work>
  <task>Continue B.5 from where you left off: complete subscriber wiring + B.6 + tests. Maintain the same Q8 protocol — emit Status: PARTIAL if you hit the wall again.</task>
</context>
")
```

Why SendMessage primary: re-uses the subagent's full conversation cache (~15-20 file Reads saved vs cold re-dispatch). Field evidence: greenfield cal #17 documented ~60+ wasted file Reads avoided across one session's 4 resumes.

**Recovery — re-dispatch fallback path** (cross-session, after CC compaction, or when subagent-id is no longer addressable):

```
Task(subagent_type="devt:programmer", prompt="
<continue_from_checkpoint>
  Read .devt/state/impl-summary.md for prior work (B.1-B.4 complete; B.5 partially implemented in events.py per impl-summary.json::next_section).
  Continue with B.5 subscriber wiring + B.6 + tests.
</continue_from_checkpoint>
<context>...standard envelope blocks per dispatch render-filled...</context>
")
```

Re-dispatch is more expensive but survives session boundaries. Workflows choose based on whether the original subagent-id is still addressable (in-session = SendMessage; after `/devt:pause` + new session = re-dispatch).

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
