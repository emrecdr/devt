# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

devt is a Claude Code plugin that orchestrates multi-agent development workflows. It follows a **Command -> Workflow -> Agent** architecture where commands are thin entry points, workflows handle orchestration and tier selection, and agents do the actual work. The plugin adapts to any project via the `.devt/rules/` convention and `.devt/config.json` configuration.

## Architecture

### Three-Layer Execution Model

1. **Commands** (`commands/*.md`) — Markdown files with YAML frontmatter. Parse arguments and delegate to a workflow. No business logic.
2. **Workflows** (`workflows/*.md`) — Orchestration files. Determine complexity tier (TRIVIAL/SIMPLE/STANDARD/COMPLEX), coordinate agents, manage state transitions via `.devt/state/`.
3. **Agents** (`agents/*.md`) — Focused workers. Each owns one concern: programmer, tester, code-reviewer, docs-writer, architect, retro, curator, verifier, researcher, debugger.

Supporting layers:
- **Skills** (`skills/*/`) — Technique libraries injected into agents via tier-aware buckets in `skill-index.yaml` (`skills` always / `skills_standard` STANDARD+ / `skills_complex` COMPLEX only). → docs/INTERNALS.md (Skills Resolution).
- **Agent IO Contracts** (`agents/io-contracts.yaml`) — single source of truth declaring per-agent `frontmatter_skills`, `index_buckets`, `outputs.{primary,sidecar}`, `inputs.context_blocks`. Three smoke gates enforce agreement with reality. → docs/INTERNALS.md (Agent IO Contracts).
- **Hooks** (`hooks/`) — Lifecycle event handlers (SessionStart, Stop, SubagentStart/Stop, PreToolUse, PostToolUse, UserPromptSubmit). Defined in `hooks/hooks.json`, executed via Node.js `run-hook.js` runner with profile support. Full subsystem reference: → docs/HOOKS.md.
- **Guardrails** (`guardrails/`) — Protective guidelines (golden rules, engineering principles, contamination prevention, generative debt checklist, incident runbook, skill update guidelines).
- **References** (`references/`) — Technique libraries for agent workflows. Static guidance documents read by workflows during specify/clarify phases (questioning guide, domain probes).
- **Scripts** (`scripts/`) — Utility scripts for quality gates, documentation checks, prompt injection scanning, workflow management, CI verification (`smoke-test.sh`, `test-locking.cjs`), and release tooling (`extract-changelog.sh` pulls a single version's section out of `CHANGELOG.md` for use as GitHub release notes).

#### Hook Profiles

The `DEVT_HOOK_PROFILE` env var (default `standard`) controls which hooks fire:

| Hook script | minimal | standard | full |
|---|:---:|:---:|:---:|
| `session-start.sh` | ✓ | ✓ | ✓ |
| `stop.sh` | ✓ | ✓ | ✓ |
| `workflow-context-injector.sh` | – | ✓ | ✓ |
| `subagent-status.sh` | – | ✓ | ✓ |
| `read-before-edit-guard.sh` | – | ✓ | ✓ |
| `pre-flight-guard.sh` | – | ✓ | ✓ |
| `memory-auto-index.sh` | – | ✓ | ✓ |
| `bash-guard.sh` | – | ✓ | ✓ |
| `dispatch-scope-guard.sh` | – | ✓ | ✓ |
| `dispatch-hygiene-guard.sh` | – | ✓ | ✓ |
| `task-truncation-detector.sh` | – | ✓ | ✓ |
| `context-monitor.sh` | – | – | ✓ |
| `prompt-guard.sh` | – | – | ✓ |

Use `DEVT_DISABLED_HOOKS=hook1.sh,hook2.sh` to selectively disable individual hooks regardless of profile.

### CLI Tools (`bin/devt-tools.cjs`)

Zero-dependency Node.js CLI that bridges markdown prompts and filesystem state. Modules in `bin/modules/`:

`init`, `config`, `state`, `model-profiles`, `setup`, `io`, `memory` (+ `memory-graph`, `memory-bundle`), `preflight`, `discovery`, `weekly-report`, `update`, `health`, `security`, `grader`, `stuck-detector`, `state-audit`, `structural-validator`, `sensitive-path`, `prose-shrink`, `static-compress`.

Deep-dive per module: → docs/INTERNALS.md (CLI Modules).

### State Flow

Workflows write per-step artifacts to `.devt/state/` (gitignored). Each file is written by one agent and read by subsequent agents; `workflow.yaml` carries active state (including `workflow_type` + `autonomous_chain` for resume routing). The full canonical filename inventory, allowed slug patterns, and reset semantics live in → docs/STATE-RULES.md.

Permanent knowledge (architectural docs + operational lessons) lives in `.devt/memory/{decisions,concepts,flows,rejected,lessons}/` indexed by FTS5 in `.devt/memory/index.db` → docs/MEMORY.md. Persistent debugger knowledge lives at `.claude/agent-memory/devt-debugger/MEMORY.md` (gitignored, auto-injected at agent startup).

#### `workflow_type` Registry

The `workflow_type` field in `workflow.yaml` drives resume routing via `/devt:next`. Valid values (validated by `state.cjs`):

| `workflow_type` | Set by | Resume command |
|-----------------|--------|----------------|
| `dev` | `dev-workflow.md` | `/devt:workflow` |
| `quick_implement` | `quick-implement.md` | `/devt:implement` |
| `debug` | `debug.md` | `/devt:debug` |
| `retro` | `lesson-extraction.md` | `/devt:workflow --retro` |
| `code_review` | `code-review.md` | `/devt:review` |
| `arch_health_scan` | `arch-health-scan.md` | `/devt:review --focus=arch` |
| `research` | `research-task.md` | `/devt:research` |
| `plan` | `create-plan.md` | `/devt:plan` |
| `specify` | `specify.md` | `/devt:specify` |
| `clarify` | `clarify-task.md` | `/devt:workflow --mode=clarify` |
| `preflight` | `preflight.md` | `/devt:preflight` |
| `memory_promote` | `memory-promote.md` | `/devt:memory promote` |
| `memory_reject` | `memory-reject.md` | `/devt:memory reject` |
| `docs` | `docs-extraction.md` | `/devt:workflow --mode=docs` |
| `code_review_parallel` | `code-review-parallel.md` | `/devt:review` (re-routes via scope_check) |

When adding a new workflow that sets `active=true`, add its `workflow_type` to `VALID_WORKFLOW_TYPES` in `bin/modules/state.cjs` and routing entries in BOTH `workflows/next.md` and `workflows/status.md`. The smoke test enforces presence in both surfaces.

### Templates

Project templates in `templates/` (python-fastapi, go, typescript-node, vue-bootstrap, rust, blank) provide `.devt/rules/` scaffolding files. The 9-file baseline (`architecture.md`, `coding-standards.md`, `documentation.md`, `git-workflow.md`, `golden-rules.md`, `quality-gates.md`, `review-checklist.md`, `testing-patterns.md`, `patterns/common-smells.md`) is enforced by smoke gate K70 — every template registered in `bin/modules/setup.cjs::AVAILABLE_TEMPLATES` MUST ship all 9. Optional add-ons vary per template's domain: `api-changelog.md` (HTTP-API-serving templates), `canonical-entities.yaml` (entity-aware projects), `arch-scan.py` + `detectors/` (Python arch-scanner). Authoring templates for new agents and skills are at `templates/agent-template.md` and `templates/skill-template.md`.

## Development Commands

Primary CLI surface (one-liners for the every-session token budget; verbose entries are in `docs/INTERNALS.md::Development CLI Reference`):

```bash
# Compound context init (one call returns workflow context as JSON — token-saver pattern)
node bin/devt-tools.cjs init workflow "task"
node bin/devt-tools.cjs init review "task"

# State (workflow.yaml + .devt/state/ artifacts)
node bin/devt-tools.cjs state read|update|reset|validate|sync|prune
node bin/devt-tools.cjs state read-section --file plan.md --section "Phase 2"
node bin/devt-tools.cjs state cleanup [--apply] [--stale-days=N]

# Config + agent/model profiles
node bin/devt-tools.cjs config get|set
node bin/devt-tools.cjs models get|resolve|list|table [profile]

# Project setup + maintenance
node bin/devt-tools.cjs setup --template <name> [--mode create|update|reinit]
node bin/devt-tools.cjs health [--repair]
node bin/devt-tools.cjs update check|status|local-version|install-type|dirty|clear-cache|changelog

# Memory layer (multi-root, FTS5)
node bin/devt-tools.cjs memory init|index|query|get|affects|list|links|active|rejected-keywords|validate|suggest

# Semantic search + reports
node bin/devt-tools.cjs semantic sync|query|compact|status
node bin/devt-tools.cjs report window|generate [--weeks N]
```

→ docs/INTERNALS.md::Development CLI Reference for the full inventory including `state assert-*` gates, claim-check, `recover-partial-impl`, multi-instance isolation (`state new-instance|list-instances`), `static-compress`, and `graphify rebuild`.

No build steps or linters. CommonJS Node.js (`.cjs`) for tooling, Markdown for prompts/workflows/agents.

CI runs `bash scripts/smoke-test.sh` (CLI smoke + 27-deep drift-guard stack K94-K120) + `node scripts/test-locking.cjs` (20-worker concurrent state-write test) on every push. Also enforces version coherence (`VERSION` ↔ `plugin.json`), CHANGELOG coverage, and `workflow_type` registry coverage. Run both locally before committing to `bin/`, `hooks/`, or `.claude-plugin/`.

### Releasing

Tag-driven via `.github/workflows/release.yml`. Bump VERSION + plugin.json + CHANGELOG, commit, then `bash scripts/release.sh X.Y.Z` — the helper handles separate commit-then-tag push (avoiding bulk-push silent-skip), annotated tag, post-push verification, and manual-dispatch recovery if the workflow didn't fire. See script header comments for the manual flow.

## Key Conventions

### Universal Rules

- **Zero dependencies.** All Node.js modules use Node.js stdlib only.
- **Documentation discipline.** The codebase is NOT the changelog. Never write version markers (`v0.X.Y+`, `since v0.A.B`), wave/option/D-number labels, or roadmap pointers in code, comments, agent prose, workflow prose, or skill bodies. All such provenance belongs in `CHANGELOG.md` + git history. Third-party version markers are fine — only devt-internal version refs are banned.
- **Comment discipline.** Comments are reserved for non-obvious WHY: hidden invariants, subtle constraints, documented workarounds, behavior that would surprise a reader. Banned: tautological narration (`// loop over users`), what-it-does descriptions of well-named code, self-promotion / origin tags (`// added for X`, `// used by Y`), version trivia, implementation-ordering annotations. Test: "if I deleted this comment, would a future reader actually be more confused?" — if no, delete before committing. Applies equally to `.cjs`, `.sh`, and `.md` agent/workflow/skill bodies.

### Plugin Mechanics

- Plugin manifest at `.claude-plugin/plugin.json`. Agents are listed explicitly; commands and skills are auto-discovered.
- Commands symlinked to `~/.claude/commands/devt/` on SessionStart for `devt:` namespaced autocomplete.
- Version tracked in both `plugin.json` (primary) and `VERSION` file; CI enforces coherence.
- Plugin registration + skill-namespacing footguns: → docs/AGENT-CONTRACTS.md (Plugin Mechanics).
- `agents/devt-coordinator.md` opt-in main-thread router: → docs/INTERNALS.md (devt-coordinator).

### Critical Agent + Workflow Contracts (read these before modifying any workflow)

- **Never raw-dispatch devt agents.** Orchestrators MUST route through devt slash commands (`/devt:review`, `/devt:workflow`, `/devt:implement`, `/devt:debug`, `/devt:research`, etc.). Direct `Task(subagent_type="devt:*", prompt=...)` calls bypass the workflow's dispatch template — losing `<scope_trust>`, `<scope_hint>`, `<memory_signal>`, the graph-impact map injection, the impact-plan, the verifier loop, and the telemetry surface. Defense in depth catches this: (1) `hooks/dispatch-hygiene-guard.sh` emits an advisory `additionalContext` and appends `source: "raw_dispatch"` to `dispatch-warnings.jsonl` on any `Task` call to a `devt:*` subagent whose prompt lacks all three context blocks; (2) `agents/code-reviewer.md::workflow_context_assertion` hard-stops with `status=BLOCKED` + `verdict=NEEDS_WORK` + a Critical finding pointing at the raw dispatch rather than producing a shallow review. Custom parallelism over multi-slice reviews? Run `/devt:review` once to get the bash plan + graph-impact map computed, then re-dispatch the sliced reviewers manually with `<scope_trust>` + `<scope_hint>` + reference to `.devt/state/graph-impact.md` injected into each prompt.

- **Orchestrator owns MCP; sub-agents are MCP-blind by design.** Every sub-agent's `tools:` frontmatter declares stdlib tools only (`Read, Bash, Glob, Grep` for read-only; `+ Write, Edit` for writers) — never `mcp__*`. The orchestrator runs MCP calls (e.g. `mcp__devt-graphify__query_graph`, `blast_radius`) inside workflow `context_init` bash blocks, writes results to `.devt/state/graph-impact.md`, and sub-agents consume that file READ-ONLY. Agent bodies and workflow `<task>` dispatch blocks MUST NOT instruct `mcp__*graphify*` calls — those would be dead code the sub-agent can't execute. Smoke gates enforce both: no agent body mentions MCP graphify, no workflow dispatch block carries the `Graphify-first discovery|investigation protocol` / `PROACTIVELY` sub-agent protocol signatures. The architect agent preloads `graphify-helpers` skill which uses `node bin/devt-tools.cjs graphify <subcmd>` CLI wrappers (Bash-callable, not MCP-callable) — that path is correct and stays.

- **Workflow single-dispatch contract for `/devt:review`.** The `workflows/code-review.md` spec defines EXACTLY ONE `Task(subagent_type="devt:code-reviewer", …)` dispatch + ONE `Task(subagent_type="devt:verifier", …)` dispatch — no `slice`, `partition`, or `parallel fan-out` keyword appears in the file. When a review scope exceeds the agent's per-dispatch budget, the **canonical recovery path** is the code-reviewer's built-in `community-filter for large reviews` (restrict deep review to files in the affected_communities listed in `graph-impact.md` when scope > 10 files; defer the rest into `## Out-of-Scope Files (Deferred)` in `review.md`), then the orchestrator dispatches follow-up `/devt:review` calls for the deferred set. Orchestrators MUST NOT improvise N-way parallel fan-out without the workflow contract — that pattern has no synthesis spec, no slice-aware verifier rubric, and historically produced partial completion (~40% sub-agent success rate in field). If parallel fan-out is genuinely needed, the orchestrator must inject `<scope_trust>` + `<scope_hint>` + a reference to `.devt/state/graph-impact.md` into each manual dispatch and synthesize the results.

### Dispatch Escape-Hatch Recipes

When a workflow pattern doesn't fit any `/devt:*` slash command (multi-lane fan-out with custom per-lane scope, secondary side audits, ad-hoc continuations after a workflow closed), use these recipes instead of hand-rolling a raw `Task()` call. Each preserves the workflow envelope (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`, `<graph_impact>`) so the dispatch-hygiene hook doesn't fire and the agent gets the full graph context.

**Get the canonical envelope for any agent + workflow combo** — render the current envelope (with all placeholders filled from `.devt/state/workflow.yaml`) and paste into your `Task()` call:

```bash
node bin/devt-tools.cjs dispatch render-filled <agent>:<workflow_type>     # e.g. code-reviewer:code_review_parallel
node bin/devt-tools.cjs dispatch render-filled <agent>:auto                # resolves workflow_type from active workflow.yaml
```

**Recipe 1 — Multi-lane parallel review with custom scope.** Run `/devt:review` once to populate `workflow.yaml::scope_*_json` + `.devt/state/graph-impact.md`, then manually fan out N lane dispatches. For each lane, start from `dispatch render-filled code-reviewer:code_review_parallel` and edit the `<task>` block to scope the lane's files. Each lane gets the envelope automatically.

**Recipe 2 — Secondary side audit of a prior review.** No standalone slash command exists. Render `dispatch render-filled code-reviewer:code_review`, then replace the `<task>` block with the audit instructions. The envelope keeps the graph context the audit needs.

**Recipe 3 — Standalone post-workflow docs refresh.** Use `/devt:workflow --mode=docs` (one-shot slash, no active workflow required) — wraps `workflows/docs-extraction.md` which dispatches `devt:docs-writer` with the proper envelope.

**Recipe 4 — Standalone post-workflow retro.** Use `/devt:workflow --retro` (one-shot slash) — wraps `workflows/lesson-extraction.md` which dispatches `devt:retro` + `devt:curator`.

If none of these fit your case, raise the gap — the workflow pattern probably warrants a new slash command or workflow file rather than a raw dispatch.

### Agent + Workflow Contracts (full reference)

- `scope_mode` controls how agents handle unrelated findings (surgical / boyscout). → docs/AGENT-CONTRACTS.md (Scope Mode).
- `<scope_hint>` and `<scope_trust>` dispatch tags + agent fallback behavior. → docs/AGENT-CONTRACTS.md (Scope Hint + Trust Contract).
- Community-filter for large reviews (code-reviewer >10 files). → docs/AGENT-CONTRACTS.md (Community-filter).
- Reviewer rubric self-check — code-reviewer dispatches receive inlined `<rubric_content>`; reviewer walks axes A–G during first pass to skip the verifier-revision loop. → docs/AGENT-CONTRACTS.md (Reviewer rubric self-check).
- Verifier `<memory_signal>` block (signal-mode memory query). → docs/AGENT-CONTRACTS.md (Verifier memory signal) + docs/MEMORY.md (Verifier Memory Signal).
- Stub-first protocol (8 output-writing agents). → docs/AGENT-CONTRACTS.md (Stub-first protocol).
- JSON sidecar contract (`.md` + `.json` agreement, `JSON_SIDECAR_SCHEMAS`). → docs/AGENT-CONTRACTS.md (JSON sidecar contract).
- Sidecar-only status routing — `impl-summary` / `test-summary` / `verification` carry NO `## Status` header in markdown. → docs/AGENT-CONTRACTS.md (Sidecar-only status routing).
- Agent artifact provenance, agent line budget ≤ 500. → docs/AGENT-CONTRACTS.md (Agent Output Contract).
- Cache-friendly dispatch ordering — `<task>` AFTER `</context>`. → docs/AGENT-CONTRACTS.md (Cache-friendly dispatch ordering).
- Workflow body loading is explicit (Read after `@`-ref). → docs/AGENT-CONTRACTS.md (Workflow body loading).
- Questioning protocol for `/devt:clarify` + `/devt:specify`. → docs/AGENT-CONTRACTS.md (Questioning Protocol).
- Rejected pattern: sub-conversation JSON returns (Anthropic specialist-team cookbook). devt deliberately does NOT adopt this — file-based state is load-bearing for `/devt:next` + `/devt:pause` resume. → docs/AGENT-CONTRACTS.md (Rejected Patterns).

### Memory Layer

- Two-layer memory model: ephemeral `.devt/state/` + permanent `.devt/memory/{decisions,concepts,flows,rejected,lessons}/` indexed by FTS5. → docs/MEMORY.md.
- Topic Pre-Flight Brief auto-fires `/devt:preflight` at context_init (6 lanes, JSON sidecar, 2-hop subgraph, tier-aware lane budget). → docs/MEMORY.md (Topic Pre-Flight).
- Two-Tier Pre-Flight Protocol — Tier 1 the Brief; Tier 2 `pre-flight-guard.sh` PreToolUse hook. Deny log at `.devt/state/preflight-denies.jsonl` (RESET_EXEMPT) with `source` field discriminator. → docs/HOOKS.md (Tier 2 Pre-Flight Guard).
- Pre-Flight Brief JSON sidecar shape + `<scope_hint>` / `<scope_trust>` workflow injection. → docs/MEMORY.md (Pre-Flight Brief JSON Sidecar).
- Curator gates ALL writes to `.devt/memory/`; discovery never writes permanent files. → docs/MEMORY.md (Curator Promotion Flow).
- Multi-root memory (`memory.paths` config), aggregate-flag query modes (`--count`, `--top`, `--domain-counts`, `--signal`), MCP write surface (`memory_upsert_doc` + `DEVT_MCP_ALLOW_WRITES`). → docs/MEMORY.md.

### Hook Subsystem

- `hooks/run-hook.js` Node runner with profile selection (`DEVT_HOOK_PROFILE`) and per-hook disable (`DEVT_DISABLED_HOOKS`). → docs/HOOKS.md (Runner + Profiles).
- Universal invocation trace at `.devt/state/hook-trace/run-hook.jsonl` (kill switch: `DEVT_HOOK_TRACE=0`). → docs/HOOKS.md (Universal Hook Invocation Trace).
- Bash safety hook denies filesystem-wipe + `--no-verify`. → docs/HOOKS.md (Bash Safety Hook).
- Stuck-agent detector reports `stuck=true` at 3-deny threshold; autonomous flows pause. → docs/HOOKS.md (Stuck-Agent Detector).
- Dispatch-scope advisory hook (NEVER blocks; writes to `dispatch-warnings.jsonl`). → docs/HOOKS.md (Dispatch-Scope Advisory Hook).
- Hook messaging is right-sized — compact per-fire output, smoke-gated byte budgets on the 4 highest-frequency messages. → docs/HOOKS.md (Hook Messaging Is Right-Sized for Cost).

### Grader + Rubrics

- Verifier outcome-grader emits `verification.json` with lowercase `verdict` + `revisions[]`; workflow re-dispatches programmer up to `workflow.max_iterations`. → docs/GRADER.md (Outcome-Grader).
- Deterministic pre-verifier gate (`grader.cjs`) walks `## Deterministic Gates` constraint trees against sidecars BEFORE LLM verifier dispatches — saves 5–15K tokens per failed iteration. → docs/GRADER.md (Deterministic Pre-Verifier Gate).
- Pinned rubric versions (`DEFAULTS.rubrics`, `<workflow_type>.v<N>.md` naming, project-local rubric escape hatch). → docs/GRADER.md (Pinned Rubric Versions).
- Code-review grader (5 axes, code-reviewer re-dispatched on `needs_revision`). → docs/GRADER.md (Code-Review Grader).

### Architecture health

- `arch_scanner.command` config wires a project-supplied scanner into `/devt:review --focus=arch`. When unset, the workflow probes `.devt/rules/arch-scan.{py,sh}` + `tests/architecture/arch-scan.py` + `scripts/arch-scan.py` and AskUserQuestion offers auto-wire / show-command / skip. python-fastapi template ships the canonical scanner at the convention path.

### Graphify

- `graphify.*` config (optional but recommended; auto-flips `enabled: true` when binary on PATH at first setup). → docs/GRAPHIFY.md.
- `graphify_scan_prep` orchestrator gate in `dev-workflow` + `quick-implement` — threshold-gated MCP scan writing to `.devt/state/graph-impact.md`. → docs/GRAPHIFY.md (`graphify_scan_prep` Orchestrator Gate).
- Hyperedge-aware preflight (Option A) — `graphify.getHyperedgesContaining()` discovers semantic multi-file groupings; `preflight-brief.json::hyperedges_matched[]` carries matches; `/devt:ship::hyperedge_completeness_scan` warns on partial coverage. → docs/GRAPHIFY.md (Hyperedge-aware preflight).
- Universal stale-graphify eviction via `state evict-graphify` CLI — called by all 5 graphify-touching workflows at context_init top. → docs/GRAPHIFY.md (Universal Stale-Graphify Eviction).
- Three-option AskUserQuestion for post-impl graphify refresh (`graphify.auto_refresh_post_impl ∈ {ask, true, false}`). → docs/GRAPHIFY.md (Post-Implementation Refresh Prompt).

### State + Workflow Internals

- Atomic file writes throughout via `bin/modules/io.cjs::atomicWriteFileSync` / `atomicWriteJsonSync` (single shared implementation). → docs/INTERNALS.md (Universal Conventions).
- Config uses prototype-pollution-safe deep merge with `FORBIDDEN_KEYS` set. → docs/INTERNALS.md.
- Workflow session metadata (`created_at`, `workflow_id` auto-stamped on activation; idempotent; cleared on reset). Immutable session anchors `first_created_at` + `original_workflow_id` frozen at first activation. Append-only `workflow_id_history[]` is **idempotently self-healing**: every `state update` ensures `{original_workflow_id, workflow_id} ⊆ history` (prepend original if missing, append current if missing). Captures every `workflow_type` transition AND recovers from upgrade-boundary cases where prior tool versions seeded history without the original. Cross-rotation trace attribution survives multi-hop sessions and partial-history scenarios. → docs/INTERNALS.md (state.cjs).
- MCP trace records carry `workflow_id` / `workflow_type` / `phase` (mtime-invalidated caching). `mcp-stats --workflow-id=<current>` unions the whole `workflow_id_history[]` chain so trace records written under intermediate rotations stay attributable. → docs/INTERNALS.md (MCP Trace Workflow Context).
- Shadow-mode state validation persists `validation_status` to `workflow.yaml`. → docs/INTERNALS.md (Shadow-mode State Validation).
- `autonomous_chain` enables cross-workflow chaining (implement → test → review). → docs/INTERNALS.md (Autonomous Chaining).
- Parallel researcher + arch_health dispatch in COMPLEX dev flows (one message, two `Task` calls). → docs/INTERNALS.md (Parallel Researcher + arch_health Dispatch).
- Inline guardrails wiring — `loadInlineGuardrails` injects `<guardrails_inline>` into programmer + code-reviewer dispatches (64 KB cap). → docs/INTERNALS.md (Inline Guardrails Wiring).
- Governing rules wiring — `loadGoverningRules` injects `<governing_rules>` into code-reviewer + verifier + researcher dispatches (96 KB cap, drift detection via `rules_hash`). → docs/INTERNALS.md (Governing Rules Wiring).
- `state validate` subcommand checks artifact consistency + content-schema. → docs/INTERNALS.md (State Validate Subcommand).
- Deferred-task tracker (`/devt:defer`, `.devt/state/deferred.md`, `DEF-NNN`, RESET_EXEMPT). → docs/INTERNALS.md (Deferred-Task Tracker).
