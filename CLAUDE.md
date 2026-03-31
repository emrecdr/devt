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
- **Skills** (`skills/*/`) — Technique libraries injected into agents based on `skill-index.yaml` or `.devt/config.json` overrides.
- **Hooks** (`hooks/`) — Lifecycle event handlers (SessionStart, Stop, SubagentStart/Stop, PreToolUse, PostToolUse, UserPromptSubmit). Defined in `hooks/hooks.json`, executed via Node.js `run-hook.js` runner with profile support (`DEVT_HOOK_PROFILE=minimal|standard|full`).
- **Guardrails** (`guardrails/`) — Protective guidelines (golden rules, engineering principles, contamination prevention, generative debt checklist).
- **Scripts** (`scripts/`) — Utility scripts for quality gates, documentation checks, prompt injection scanning, workflow management.

### CLI Tools (`bin/devt-tools.cjs`)

Zero-dependency Node.js CLI that bridges markdown prompts and filesystem state. All modules are in `bin/modules/`:

- **`init.cjs`** — Compound init: one call returns all context (config, models, state, rules status) as JSON. This is the primary token-saver pattern.
- **`config.cjs`** — 3-level config merge: hardcoded defaults <- `~/.devt/defaults.json` (global) <- `.devt/config.json` (project). Uses `findProjectRoot()` to locate project.
- **`state.cjs`** — Manages `.devt/state/` directory. Simple YAML parser/serializer. File-level locking with PID-based stale lock detection.
- **`model-profiles.cjs`** — Maps agent types to model tiers (quality/balanced/budget/inherit). Per-agent overrides from `.devt/config.json`.
- **`setup.cjs`** — Scaffolds `.devt/rules/` from templates, creates `.devt/config.json`. Supports create/update/reinit modes. Auto-detects stack via marker files and git remote.
- **`semantic.cjs`** — FTS5 full-text search on learning playbook. Uses `node:sqlite` (built-in). Sync playbook → DB, query lessons, compact stale entries. Grep fallback when DB doesn't exist.
- **`weekly-report.cjs`** — Git log parsing and markdown report rendering. Contributor matching via `.devt/config.json` config.
- **`update.cjs`** — Version check against GitHub. Caches results (4hr TTL). Detects install type (plugin system vs git clone).
- **`health.cjs`** — Project health validation with 19 checks, structured JSON output, `--repair` flag for safe auto-fixes.
- **`security.cjs`** — Input validation: path traversal prevention, prompt injection detection, safe JSON parsing, shell argument validation. Wired into `init.cjs` to sanitize task descriptions entering the system.

### State Flow

Workflows write artifacts to `.devt/state/` (gitignored). Each file is written by one agent and read by subsequent agents: `workflow.yaml` (active state, includes `workflow_type` for resume routing), `impl-summary.md`, `test-summary.md`, `review.md`, `verification.md`, `plan.md`, `decisions.md`, `baseline-gates.md`, `lessons.yaml`, `curation-summary.md`, `debug-context.md`, `debug-summary.md`, `debug-investigation.md` (debugger scratchpad, within-session only). The learning playbook (`.devt/learning-playbook.md`) and FTS5 database (`memory/semantic/lessons.db`) persist across workflows.

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
node bin/devt-tools.cjs config get
node bin/devt-tools.cjs config set key=value
node bin/devt-tools.cjs models get <profile>
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
```

There are no build steps, test suites, or linters configured for the plugin itself. The codebase is all CommonJS Node.js (`.cjs`) for the tooling and Markdown for prompts/workflows/agents.

## Key Conventions

- All Node.js modules use zero dependencies (Node.js stdlib only).
- Atomic file writes throughout: write to `.tmp` then `fs.renameSync()`.
- Config uses prototype-pollution-safe deep merge with `FORBIDDEN_KEYS` set.
- Hooks use a Node.js runner (`run-hook.js`) with profile support: `DEVT_HOOK_PROFILE=minimal|standard|full` and `DEVT_DISABLED_HOOKS=hook1,hook2`. The `run-hook.cmd` polyglot delegates to `run-hook.js`.
- The plugin manifest lives at `.claude-plugin/plugin.json`. Agents are listed explicitly; commands and skills are auto-discovered.
- Commands are symlinked to `~/.claude/commands/devt/` on session start for `devt:` namespaced autocomplete.
- Version is tracked in both `plugin.json` and `VERSION` file (plugin.json is primary).
