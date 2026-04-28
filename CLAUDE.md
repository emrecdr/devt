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
- **Skills** (`skills/*/`) — Technique libraries injected into agents based on `skill-index.yaml` or `.devt/config.json` overrides. Trigger-evaluation fixtures live in `skills-workspace/` (gitignored, used by autoskill).
- **Hooks** (`hooks/`) — Lifecycle event handlers (SessionStart, Stop, SubagentStart/Stop, PreToolUse, PostToolUse, UserPromptSubmit). Defined in `hooks/hooks.json`, executed via Node.js `run-hook.js` runner with profile support (`DEVT_HOOK_PROFILE=minimal|standard|full`, default `standard`). `hooks/quality-gate-verifier.md` is an opt-in template that projects wire into their own `.claude/settings.json` — not auto-registered.
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
| `context-monitor.sh` | – | – | ✓ |
| `prompt-guard.sh` | – | – | ✓ |

Use `DEVT_DISABLED_HOOKS=hook1.sh,hook2.sh` to selectively disable individual hooks regardless of profile.

### CLI Tools (`bin/devt-tools.cjs`)

Zero-dependency Node.js CLI that bridges markdown prompts and filesystem state. All modules are in `bin/modules/`:

- **`init.cjs`** — Compound init: one call returns all context (config, models, state, rules status) as JSON. This is the primary token-saver pattern.
- **`config.cjs`** — 3-level config merge: hardcoded defaults <- `~/.devt/defaults.json` (global) <- `.devt/config.json` (project). Uses `findProjectRoot()` to locate project.
- **`state.cjs`** — Manages `.devt/state/` directory. Simple YAML parser/serializer. File-level locking with PID-based stale lock detection. Includes `ARTIFACT_SCHEMA` + `extractStatus()` for per-artifact `## Status:` line validation. `updateState()` auto-runs shadow validation, emits stderr warnings, and persists `validation_status`/`validation_warnings` to `workflow.yaml` on mismatch (disable via `DEVT_VALIDATE_SHADOW=0`).
- **`model-profiles.cjs`** — Maps agent types to model tiers (quality/balanced/budget/inherit). Per-agent overrides from `.devt/config.json`.
- **`setup.cjs`** — Scaffolds `.devt/rules/` from templates, creates `.devt/config.json`. Supports create/update/reinit modes. Auto-detects stack via marker files and git remote.
- **`semantic.cjs`** — FTS5 full-text search on learning playbook. Uses `node:sqlite` (built-in). Sync playbook → DB, query lessons, compact stale entries. Grep fallback when DB doesn't exist.
- **`weekly-report.cjs`** — Git log parsing and markdown report rendering. Contributor matching via `.devt/config.json` config.
- **`update.cjs`** — Version check against GitHub. Caches results (4hr TTL). Detects install type (plugin system vs git clone). Also provides dirty-tree detection, cache management, and changelog fetching.
- **`health.cjs`** — Project health validation with 22 checks, structured JSON output, `--repair` flag for safe auto-fixes.
- **`security.cjs`** — Input validation: path traversal prevention, prompt injection detection (with `strict` mode: Shannon entropy analysis, URL/HTML entity decoding, zero-width character detection), safe JSON parsing, shell argument validation, `sanitizeForDisplay`. Wired into `init.cjs` to sanitize task descriptions entering the system.

### State Flow

Workflows write artifacts to `.devt/state/` (gitignored). Each file is written by one agent and read by subsequent agents: `workflow.yaml` (active state, includes `workflow_type` and `autonomous_chain` for resume routing and cross-workflow autonomous chaining, plus `validation_status`/`validation_warnings` set by shadow-mode content-schema checks), `impl-summary.md`, `test-summary.md`, `review.md`, `verification.md`, `plan.md`, `decisions.md`, `baseline-gates.md`, `lessons.yaml`, `curation-summary.md`, `debug-context.md`, `debug-summary.md`, `debug-investigation.md` (debugger investigation log, within-session only), `scratchpad.md` (ephemeral within-workflow notes for cross-agent handoff; reset between workflows), `spec.md`, `research.md`, `scan-results.md`, `arch-review.md`, `arch-health-scan.md`, `docs-summary.md`, `handoff.json` (from `/devt:pause`, consumed by `/devt:next`), `continue-here.md` (from `/devt:pause`), `review-scope.md` (code-review file list), `session-report.md`, `autoskill-proposals.md`, `arch-baseline.json` (arch-health prior scan), `arch-triage.json` (arch-health triage decisions), `scanner-output.txt` (arch-health raw output), `scan-delta.md` (arch-health delta summary). The learning playbook (`.devt/learning-playbook.md`) and FTS5 database (`memory/semantic/lessons.db`) persist across workflows. Persistent debugger knowledge now lives at `.claude/agent-memory/devt-debugger/MEMORY.md` via the debugger agent's `memory: project` frontmatter (gitignored, auto-injected at agent startup). Legacy `debug-knowledge-base.md` at project root is read for backwards compatibility but no longer written to.

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

When adding a new workflow that sets `active=true`, add its `workflow_type` to `VALID_WORKFLOW_TYPES` in `bin/modules/state.cjs` and routing entries in `workflows/next.md`.

### Templates

Project templates in `templates/` (python-fastapi, go, typescript-node, vue-bootstrap, blank) provide `.devt/rules/` scaffolding files: `coding-standards.md`, `testing-patterns.md`, `quality-gates.md`, `architecture.md`, `review-checklist.md`, and optional `documentation.md`, `git-workflow.md`, `golden-rules.md`, `api-changelog.md`, `patterns/common-smells.md`. Authoring templates for new agents and skills are at `templates/agent-template.md` and `templates/skill-template.md`.

## Development Commands

```bash
# Run the CLI tools directly
node bin/devt-tools.cjs init workflow "task"
node bin/devt-tools.cjs init review "task"
node bin/devt-tools.cjs state read
node bin/devt-tools.cjs state update key=value
node bin/devt-tools.cjs state reset
node bin/devt-tools.cjs state validate          # Check state/artifact consistency
node bin/devt-tools.cjs state sync              # Reconstruct workflow.yaml from artifacts
node bin/devt-tools.cjs state prune [--dry-run]  # Remove orphaned artifacts
node bin/devt-tools.cjs config get
node bin/devt-tools.cjs config set key=value
node bin/devt-tools.cjs models get <profile>
node bin/devt-tools.cjs models resolve <profile>  # Get with aliases resolved to model IDs
node bin/devt-tools.cjs models list              # List available profiles
node bin/devt-tools.cjs models table <profile>   # Formatted table output
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
bash scripts/smoke-test.sh       # 16 CLI smoke checks across all 9 subcommands (manifest parses, init/state/config/models/update/health/semantic/report/setup return JSON, 50 KB cap rejection, concurrent locking, agent 500-line budget)
node scripts/test-locking.cjs    # 20-worker concurrent state-write test — asserts no lost updates, no orphaned .lock
```

Run both locally before committing changes to `bin/`, `hooks/`, or `.claude-plugin/`. The CI workflow also enforces version coherence (`VERSION` ↔ `plugin.json`), CHANGELOG coverage (every VERSION must have a matching `## [X.Y.Z]` section), and `workflow_type` registry coverage (every entry in `VALID_WORKFLOW_TYPES` must have routing in `next.md`).

### Releasing

The release flow is tag-driven via `.github/workflows/release.yml`:

```bash
# 1. Bump VERSION, plugin.json version, and write the new CHANGELOG section
# 2. Commit (CI verifies coherence + CHANGELOG coverage on push to main)
git commit -m "chore(release): vX.Y.Z — short headline"
git push

# 3. Tag and push — the release workflow fires on the tag-push event
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow extracts the matching `## [X.Y.Z]` section from `CHANGELOG.md` via `scripts/extract-changelog.sh` and creates a GitHub release with those notes. It is idempotent — if a release already exists for the tag, it exits cleanly. Tags containing `-` (e.g. `v1.0.0-rc1`) are flagged as prereleases. All step-output values are passed through `env:` rather than direct `${{ }}` shell interpolation, so a maliciously named tag cannot inject shell.

## Key Conventions

- All Node.js modules use zero dependencies (Node.js stdlib only).
- Atomic file writes throughout: write to `.tmp` then `fs.renameSync()`.
- Config uses prototype-pollution-safe deep merge with `FORBIDDEN_KEYS` set.
- Hooks use a Node.js runner (`run-hook.js`) with profile support: `DEVT_HOOK_PROFILE=minimal|standard|full` and `DEVT_DISABLED_HOOKS=hook1,hook2`. The `run-hook.cmd` polyglot delegates to `run-hook.js`.
- State validation is shadow-mode by default: `state update` runs `validateConsistency()` on every call, warns on stderr, and persists `validation_status="warned"` + `validation_warnings=N` to `workflow.yaml`. Disable with `DEVT_VALIDATE_SHADOW=0`. `next.md` routes on the persisted flag so resume-after-pause surfaces drift.
- The plugin manifest lives at `.claude-plugin/plugin.json`. Agents are listed explicitly; commands and skills are auto-discovered.
- Commands are symlinked to `~/.claude/commands/devt/` on session start for `devt:` namespaced autocomplete.
- **Plugin agents register only when devt is loaded via `claude --plugin-dir <path>` or installed through the plugin system.** Sessions started without these loading paths see commands/skills via cwd auto-discovery but `devt:<agent>` subagents will not appear in `claude agents`. For development always launch with `claude --plugin-dir /path/to/devt` (see README install). Per-agent persistent memory created by `memory:` frontmatter writes to `.claude/agent-memory/devt-<agent>/MEMORY.md` (gitignored).
- **Agent `skills:` preload requires the `devt:` namespace** for plugin skills (e.g., `skills: [devt:codebase-scan]`, NOT `skills: [codebase-scan]`). The plain name silently fails to inject — the skill's full body must be present in the agent's system prompt at startup, verifiable by grepping for a unique phrase from the SKILL.md body via a probe agent. Plugin agents do not support `permissionMode`, `hooks`, or `mcpServers` frontmatter (security restriction — silently ignored).
- Version is tracked in both `plugin.json` and `VERSION` file (plugin.json is primary).
- Agent artifacts include provenance sections (agent name, timestamp, workflow context) for traceability across the pipeline.
- The `autonomous_chain` field in `workflow.yaml` enables cross-workflow autonomous chaining (e.g., implement -> test -> review without manual `/devt:next` invocations).
- `state validate` subcommand checks artifact consistency: verifies expected files exist for the current workflow phase, flags orphaned artifacts, and detects state/artifact mismatches. Also runs content-schema checks via `ARTIFACT_SCHEMA` (per-artifact `## Status:` whitelists), surfacing reasons `invalid_status`, `no_status_line`, `unreadable`, `missing`.
- Agent prompt files (`agents/*.md`) are budgeted at ≤ 500 lines each, enforced by `scripts/smoke-test.sh`. Exceeding the budget signals time to extract sub-skills, references, or split responsibilities. Bump the limit deliberately — silent growth is what the check guards against.
