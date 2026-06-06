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

`init`, `config`, `state`, `model-profiles`, `setup`, `io`, `memory` (+ `memory-graph`, `memory-bundle`), `preflight`, `discovery`, `weekly-report`, `update`, `health`, `security`, `grader`, `stuck-detector`, `state-audit`.

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
| `retro` | `lesson-extraction.md` | `/devt:retro` |
| `code_review` | `code-review.md` | `/devt:review` |
| `arch_health_scan` | `arch-health-scan.md` | `/devt:arch-health` |
| `research` | `research-task.md` | `/devt:research` |
| `plan` | `create-plan.md` | `/devt:plan` |
| `specify` | `specify.md` | `/devt:specify` |
| `clarify` | `clarify-task.md` | `/devt:clarify` |
| `preflight` | `preflight.md` | `/devt:preflight` |
| `memory_promote` | `memory-promote.md` | `/devt:memory promote` |
| `memory_reject` | `memory-reject.md` | `/devt:memory reject` |
| `docs` | `docs-extraction.md` | `/devt:docs` |
| `code_review_parallel` | `code-review-parallel.md` | `/devt:review` (re-routes via scope_check) |

When adding a new workflow that sets `active=true`, add its `workflow_type` to `VALID_WORKFLOW_TYPES` in `bin/modules/state.cjs` and routing entries in BOTH `workflows/next.md` and `workflows/status.md`. The smoke test enforces presence in both surfaces.

### Templates

Project templates in `templates/` (python-fastapi, go, typescript-node, vue-bootstrap, rust, blank) provide `.devt/rules/` scaffolding files. The 9-file baseline (`architecture.md`, `coding-standards.md`, `documentation.md`, `git-workflow.md`, `golden-rules.md`, `quality-gates.md`, `review-checklist.md`, `testing-patterns.md`, `patterns/common-smells.md`) is enforced by smoke gate K70 — every template registered in `bin/modules/setup.cjs::AVAILABLE_TEMPLATES` MUST ship all 9. Optional add-ons vary per template's domain: `api-changelog.md` (HTTP-API-serving templates), `canonical-entities.yaml` (entity-aware projects), `arch-scan.py` + `detectors/` (Python arch-scanner). Authoring templates for new agents and skills are at `templates/agent-template.md` and `templates/skill-template.md`.

## Development Commands

```bash
# Run the CLI tools directly
node bin/devt-tools.cjs init workflow "task"
node bin/devt-tools.cjs init review "task"
node bin/devt-tools.cjs state read
node bin/devt-tools.cjs state read-section --file plan.md --section "Phase 2" # Slice one heading; exact-then-prefix match
node bin/devt-tools.cjs state update key=value
node bin/devt-tools.cjs state reset # Archives non-exempt artifacts to .devt/state/.archive/<ts>/ (ring buffer; size: state.archive_runs, default 5; set 0 to disable)
node bin/devt-tools.cjs state validate # Check state/artifact consistency
node bin/devt-tools.cjs state sync # Reconstruct workflow.yaml from artifacts
node bin/devt-tools.cjs state prune [--dry-run] # Remove orphaned artifacts
node bin/devt-tools.cjs state check-agent-output <path> # Substance check: detects stub phrases, low word count, heading-only outputs
node bin/devt-tools.cjs state assert-graphify-decision # Confirms graphify decision artifact + cross-refs _mcp-trace.jsonl for fabricated drill-downs
node bin/devt-tools.cjs state list-lane-outputs # Read workflow.yaml::lanes[] registry with per-lane file existence + size + stale flag (mtime < first_created_at)
node bin/devt-tools.cjs state new-instance [--tag=<label>] # Multi-instance isolation. Generates an 8-char hex workflow_id, creates .devt/state/<id>/ subdir + .devt/state/.instances/<id>.json index entry. Typical use: `export DEVT_WORKFLOW_ID=$(devt-tools state new-instance --tag=feature-X | jq -r .wf_id)` per terminal. When DEVT_WORKFLOW_ID is set, getStateDir() returns the per-instance subdir so workflow artifacts (decisions.md, plan.md, impl-summary.md, claim-check-failures.jsonl, gate-trace.jsonl, etc.) don't collide between concurrent devt sessions. Cross-instance files (deferred.md, council transcripts, last-curator-run.txt, probe-failures.jsonl, .graphify-rebuild.lock) stay at the root. Backwards compatible: when DEVT_WORKFLOW_ID is unset, all paths resolve to the legacy `.devt/state/` root — existing single-instance users see no change. ID format `[A-Za-z0-9_-]{1,64}` is enforced; unsafe values (path traversal attempts, etc.) fall back to legacy with a stderr warning
node bin/devt-tools.cjs state list-instances # Enumerate all instance subdirectories under .devt/state/. Returns {wf_id, created_at, last_active, phase, tag, file_count} per instance, sorted by last_active descending. Use when returning to a project the next session and need to find your previous instance: `devt-tools state list-instances | jq -r '.instances[] | "\(.wf_id) phase=\(.phase) tag=\(.tag)"'`
node bin/devt-tools.cjs state cleanup [--apply] [--stale-days=N] [--ad-hoc-stale-days=N] # Archive ad_hoc + ephemeral + stale pattern_allowed; init.cjs auto-fires with --stale-days=1 --ad-hoc-stale-days=1 to preserve current-session work-in-progress files
node bin/devt-tools.cjs state update-lane <id> status=<status> # Mutate a single lane's status (substance_pass | stub_redispatched | deferred)
node bin/devt-tools.cjs state assert-knowledge-candidates-tagged # Session-scoped via first_created_at — stale scratchpad tags from a prior workflow fail the gate
node bin/devt-tools.cjs state aggregate-knowledge-candidates # Pulls #KNOWLEDGE-CANDIDATE: tags from review-lane-*.md / review.md / impl-summary*.md into scratchpad with dedup + provenance comments
node bin/devt-tools.cjs state assert-preflight-semantic-quality [--threshold=0.4] # WARN-mode gate reading preflight-brief.json::topic.extraction_confidence; never blocks, returns {ok:true, warn:bool, confidence, threshold, reason}
node bin/devt-tools.cjs state assert-no-raw-dispatches-this-session # Post-hoc enforcement (greenfield calibration #12). Scans dispatch-warnings.jsonl for source:raw_dispatch with ts >= first_created_at; BLOCKS workflow finalize when any. Honors dispatch_hygiene_mode={block|warn|off}. Compensates for CC PreToolUse Task-deny not enforcing
node bin/devt-tools.cjs state assert-artifact-present <agent> # Layer-1 mechanical claim-check. Reads agent's outputs.primary from agents/io-contracts.yaml, asserts the file exists + is non-empty. Returns {ok, agent, expected_path, exists, size_bytes, reason}. Every call persists result to .devt/state/claim-check-failures.jsonl for Layer-2 consumption. Workflow runners call after each output-writing dispatch to verify "agent claims it wrote X" against ground truth. Polymorphic form: `assert-artifact-present <agent>:lane-<id>` resolves expected_path from `workflow.yaml::lanes[].review_file` instead of io-contracts (used by code-review-parallel for per-lane Layer-1 records — each lane persists a distinct stream within the workflow window)
node bin/devt-tools.cjs state assert-claim-checks-resolved # Layer-2 post-hoc finalize gate (greenfield cal #16+#17). Reads claim-check-failures.jsonl, computes per-agent latest verdict in workflow window; failures with no subsequent success block. Resolution semantic: successful re-runs overwrite prior failures. Honors claim_check_mode={block|warn|off} (default block, mirrors dispatch_hygiene_mode). Wired into all 4 workflow finalize sites adjacent to assert-no-raw-dispatches-this-session
node bin/devt-tools.cjs state recover-partial-impl <agent> # Rate-limit-mid-section recovery diagnostic (greenfield cal #19 §5 Q17). The PARTIAL contract triggers at section boundaries; a rate-limit MID-section leaves impl-summary.md at its stub-first sentinel with no structured sidecar. CLI reads dispatch-warnings.jsonl::task_output_bytes for low_output:true + on-disk primary substance and returns a recovery decision: recovery_needed=true + suggested_action=SendMessage-resume when stub+low_output pattern matches; recovery_needed=true + suggested_action=investigate when stub but no low_output signal; recovery_needed=false + primary_state=substantive|missing for cleaner outcomes; recovery_needed=false + sidecar_status=<terminal> short-circuit when sidecar declares DONE/PARTIAL/etc. dev-workflow + quick-implement orchestrators call after programmer dispatch and route on the suggestion via [PARTIAL_IMPL_RECOVERY] echo
node bin/devt-tools.cjs state advance-phase <phase> [key=value ...] # Runtime gate-at-transition (greenfield cal #18 #1). Reads workflow_type from state, looks up required gates for target phase in workflows/_phase-gates.yaml, runs each gate via existing assert-* functions; throws on any failure → process exits 1. Phases NOT in registry fall through to plain update (backwards compat). Every gate firing logs to gate-trace.jsonl with name prefixed "advance-phase:<gate>". Migrated 4 workflows at finalize-deactivation (replaces `state update phase=X status=DONE active=false`)
node bin/devt-tools.cjs state refresh-scope-context # Alias for `preflight scope-cache`. Re-derives scope_trust from preflight-brief.json::graph_stats + staleness (with staleness-threshold override) and persists to workflow.yaml::scope_trust_json. Idempotent, ~50ms. Wired into each dispatch site so cached scope_trust always reflects current graph state, not the value computed at workflow start
node bin/devt-tools.cjs graphify rebuild [--debounce=N] [--timeout=N] # Atomic O_CREAT|O_EXCL lock at .devt/state/.graphify-rebuild.lock; concurrent callers skip with reason=debounced inside the window; mtime past window unlinks + retries
node bin/devt-tools.cjs config get
node bin/devt-tools.cjs config set key=value
node bin/devt-tools.cjs models get [profile]     # Default: balanced. Profiles: quality / balanced / budget / inherit
node bin/devt-tools.cjs models resolve [profile] # Aliases resolved to model IDs (opus → claude-opus-4-6 etc.)
node bin/devt-tools.cjs models list              # List 4 available profiles
node bin/devt-tools.cjs models table [profile]   # Per-agent assignments — see README.md::Model profiles for the full table
node bin/devt-tools.cjs setup --template <name> [--mode create|update|reinit] [--detect]
node bin/devt-tools.cjs semantic sync
node bin/devt-tools.cjs semantic query <search terms>
node bin/devt-tools.cjs semantic compact [--dry-run]
node bin/devt-tools.cjs semantic status
node bin/devt-tools.cjs report window [--weeks N]
node bin/devt-tools.cjs report generate [--weeks N] [--output PATH]
node bin/devt-tools.cjs health [--repair]
node bin/devt-tools.cjs update check [--force]
node bin/devt-tools.cjs update status
node bin/devt-tools.cjs update local-version
node bin/devt-tools.cjs update install-type
node bin/devt-tools.cjs update dirty
node bin/devt-tools.cjs update clear-cache
node bin/devt-tools.cjs update changelog
```

There are no build steps or linters configured for the plugin itself. The codebase is all CommonJS Node.js (`.cjs`) for the tooling and Markdown for prompts/workflows/agents.

CI runs two test scripts on every push (`.github/workflows/ci.yml`):

```bash
bash scripts/smoke-test.sh # CLI smoke checks across all subcommands (manifest parses, init/state/config/models/update/health/semantic/report/setup return JSON, 50 KB cap rejection, concurrent locking, agent 500-line budget)
node scripts/test-locking.cjs # 20-worker concurrent state-write test — asserts no lost updates, no orphaned .lock
```

Run both locally before committing changes to `bin/`, `hooks/`, or `.claude-plugin/`. The CI workflow also enforces version coherence (`VERSION` ↔ `plugin.json`), CHANGELOG coverage (every VERSION must have a matching `## [X.Y.Z]` section), and `workflow_type` registry coverage (every entry in `VALID_WORKFLOW_TYPES` must have routing in `next.md`).

### Releasing

The release flow is tag-driven via `.github/workflows/release.yml`.

**Recommended**: after bumping VERSION + plugin.json + CHANGELOG and committing, run:

```bash
bash scripts/release.sh X.Y.Z
```

The helper pushes commits and the tag separately (avoiding the bulk-push edge case where the per-tag push event silent-skips), uses an annotated tag (more reliable workflow trigger than lightweight), verifies the GitHub release was created, and surfaces the manual-dispatch recovery command if it wasn't.

**Manual flow** (use only if the helper isn't available — e.g., during initial setup):

```bash
# 1. Bump VERSION, plugin.json version, and write the new CHANGELOG section
# 2. Commit (CI verifies coherence + CHANGELOG coverage on push to main)
git commit -m "chore(release): vX.Y.Z — short headline"
git push

# 3. Tag and push — the release workflow fires on the tag-push event
git tag vX.Y.Z
git push origin vX.Y.Z

# 4. If the workflow didn't fire (silent-skip recurrence), fall back to:
gh workflow run release.yml -f tag=vX.Y.Z
```

The workflow extracts the matching `## [X.Y.Z]` section from `CHANGELOG.md` via `scripts/extract-changelog.sh` and creates a GitHub release with those notes. It is idempotent — if a release already exists for the tag, it exits cleanly. Tags containing `-` (e.g. `v1.0.0-rc1`) are flagged as prereleases. All step-output values are passed through `env:` rather than direct `${{ }}` shell interpolation, so a maliciously named tag cannot inject shell.

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

**Recipe 3 — Standalone post-workflow docs refresh.** Use `/devt:docs` (one-shot slash, no active workflow required) — wraps `workflows/docs-extraction.md` which dispatches `devt:docs-writer` with the proper envelope.

**Recipe 4 — Standalone post-workflow retro.** Use `/devt:retro` (one-shot slash) — wraps `workflows/lesson-extraction.md` which dispatches `devt:retro` + `devt:curator`.

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

- `arch_scanner.command` config wires a project-supplied scanner into `/devt:arch-health`. When unset, the workflow probes `.devt/rules/arch-scan.{py,sh}` + `tests/architecture/arch-scan.py` + `scripts/arch-scan.py` and AskUserQuestion offers auto-wire / show-command / skip. python-fastapi template ships the canonical scanner at the convention path.

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
