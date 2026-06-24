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

Primary CLI surface (one-liners for the every-session token budget; verbose entries are in `docs/operator-guide/CLI-REFERENCE.md`):

```bash
# Compound context init (one call returns workflow context as JSON — token-saver pattern)
node bin/devt-tools.cjs init workflow "task"
node bin/devt-tools.cjs init review "task"

# State (workflow.yaml + .devt/state/ artifacts)
node bin/devt-tools.cjs state read|update|reset|validate|sync|prune
node bin/devt-tools.cjs state read-section --file plan.md --section "Phase 2"
node bin/devt-tools.cjs state cleanup [--apply] [--stale-days=N]
node bin/devt-tools.cjs state register-lane --id=L1 --scope=<community> --files=a.py,b.py
node bin/devt-tools.cjs state register-lanes --from=<lanes.yaml|.json>

# Config + agent/model profiles
node bin/devt-tools.cjs config get|set
node bin/devt-tools.cjs models get|resolve|list|table [profile]

# Project setup + maintenance
node bin/devt-tools.cjs setup --template <name> [--mode create|update|reinit]
node bin/devt-tools.cjs health [--repair]
node bin/devt-tools.cjs update check|status|local-version|install-type|dirty|clear-cache|changelog

# Memory layer (multi-root, FTS5)
node bin/devt-tools.cjs memory init|index|query|get|affects|list|links|active|rejected-keywords|validate|suggest
node bin/devt-tools.cjs memory candidates-footer

# Dispatch — envelope render + per-lane fan-out
node bin/devt-tools.cjs dispatch render-filled <agent>:<workflow_id|auto> [--rules-exclude=heading,list]
node bin/devt-tools.cjs dispatch render-lanes [--out=<dir>]

# Semantic search + reports
node bin/devt-tools.cjs semantic sync|query|compact|status
node bin/devt-tools.cjs report window|generate [--weeks N]
```

→ docs/operator-guide/CLI-REFERENCE.md for the full inventory including `state assert-*` gates, claim-check, `recover-partial-impl`, multi-instance isolation (`state new-instance|list-instances`), `static-compress`, and `graphify rebuild`.

No build steps or linters. CommonJS Node.js (`.cjs`) for tooling, Markdown for prompts/workflows/agents.

CI runs `bash scripts/smoke-test.sh` (CLI smoke + 68-deep drift-guard stack K94-K161) + `node scripts/test-locking.cjs` (20-worker concurrent state-write test) on every push. Also enforces version coherence (`VERSION` ↔ `plugin.json`), CHANGELOG coverage, and `workflow_type` registry coverage. Run both locally before committing to `bin/`, `hooks/`, or `.claude-plugin/`.

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

- **Never raw-dispatch devt agents.** Route through `/devt:*` slash commands; raw `Task(subagent_type="devt:*")` bypasses envelope (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`, graph-impact map, impact-plan, verifier loop, telemetry). Three-layer defense: `dispatch-hygiene-guard.sh` (advisory) → `assert-no-raw-dispatches-this-session` finalize gate (block) → `code-reviewer.md::workflow_context_assertion` (hard-stop). → docs/AGENT-CONTRACTS.md (Never raw-dispatch).
- **Orchestrator owns MCP; sub-agents are MCP-blind.** Sub-agents declare stdlib tools only (`Read, Bash, Glob, Grep` + `Write, Edit` for writers) — never `mcp__*`. Orchestrators run MCP, write to `.devt/state/graph-impact.md`, sub-agents consume read-only. Architect's `graphify-helpers` skill uses Bash-callable CLI wrappers, not MCP. → docs/AGENT-CONTRACTS.md (Orchestrator owns MCP).
- **Single-dispatch contract for `/devt:review`.** `workflows/code-review.md` defines EXACTLY ONE reviewer + ONE verifier dispatch. Large reviews use the built-in community-filter (>10 files → restrict to `affected_communities`, defer rest); sanctioned parallel fan-out lives in `workflows/code-review-parallel.md` only. → docs/AGENT-CONTRACTS.md (Single-dispatch contract).
- **Escape hatches** for cases no `/devt:*` command fits (custom multi-lane fan-out, side audits, ad-hoc continuations). → docs/operator-guide/DISPATCH-RECIPES.md.

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
