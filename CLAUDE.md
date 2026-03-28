# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

devt is a Claude Code plugin that orchestrates multi-agent development workflows. It follows a **Command -> Workflow -> Agent** architecture where commands are thin entry points, workflows handle orchestration and tier selection, and agents do the actual work. The plugin adapts to any project via the `.dev-rules/` convention and `.devt.json` configuration.

## Architecture

### Three-Layer Execution Model

1. **Commands** (`commands/*.md`) — Markdown files with YAML frontmatter. Parse arguments and delegate to a workflow. No business logic.
2. **Workflows** (`workflows/*.md`) — Orchestration files. Determine complexity tier (TRIVIAL/SIMPLE/STANDARD/COMPLEX), coordinate agents, manage state transitions via `.devt-state/`.
3. **Agents** (`agents/*.md`) — Focused workers. Each owns one concern: programmer, tester, code-reviewer, docs-writer, architect, retro, curator, verifier, researcher, debugger.

Supporting layers:
- **Skills** (`skills/*/`) — Technique libraries injected into agents based on `skill-index.yaml` or `.devt.json` overrides.
- **Hooks** (`hooks/`) — Lifecycle event handlers (SessionStart, Stop, SubagentStart/Stop, PreToolUse, PostToolUse, UserPromptSubmit). Defined in `hooks/hooks.json`, executed via cross-platform `run-hook.sh`/`run-hook.cmd` wrapper.
- **Guardrails** (`guardrails/`) — Protective guidelines (golden rules, contamination prevention, generative debt checklist).

### CLI Tools (`bin/devt-tools.cjs`)

Zero-dependency Node.js CLI that bridges markdown prompts and filesystem state. All modules are in `bin/modules/`:

- **`init.cjs`** — Compound init: one call returns all context (config, models, state, dev-rules status) as JSON. This is the primary token-saver pattern.
- **`config.cjs`** — 3-level config merge: hardcoded defaults <- `~/.devt/defaults.json` (global) <- `.devt.json` (project). Uses `findProjectRoot()` to locate project.
- **`state.cjs`** — Manages `.devt-state/` directory. Simple YAML parser/serializer. File-level locking with PID-based stale lock detection.
- **`model-profiles.cjs`** — Maps agent types to model tiers (quality/balanced/budget/inherit). Per-agent overrides from `.devt.json`.
- **`setup.cjs`** — Scaffolds `.dev-rules/` from templates, creates `.devt.json`. Supports create/update/reinit modes. Auto-detects stack via marker files and git remote.
- **`update.cjs`** — Version check against GitHub. Caches results (4hr TTL). Detects install type (plugin system vs git clone).

### State Flow

Workflows write artifacts to `.devt-state/` (gitignored). Each file is written by one agent and read by subsequent agents: `workflow.yaml` (active state), `impl-summary.md`, `test-summary.md`, `review.md`, `plan.md`, `decisions.md`, `debug-context.md`.

### Templates

Project templates in `templates/` (python-fastapi, go, typescript-node, vue-bootstrap, blank) provide `.dev-rules/` scaffolding files: `coding-standards.md`, `testing-patterns.md`, `quality-gates.md`, and optional `architecture.md`, `documentation.md`, `git-workflow.md`, `patterns/common-smells.md`.

## Development Commands

```bash
# Run the CLI tools directly
node bin/devt-tools.cjs init workflow "task"
node bin/devt-tools.cjs state read
node bin/devt-tools.cjs state update key=value
node bin/devt-tools.cjs state reset
node bin/devt-tools.cjs config get
node bin/devt-tools.cjs config set key=value
node bin/devt-tools.cjs models get <profile>
node bin/devt-tools.cjs setup --template <name> [--mode create|update|reinit] [--detect]
node bin/devt-tools.cjs update check [--force]
node bin/devt-tools.cjs update status
```

There are no build steps, test suites, or linters configured for the plugin itself. The codebase is all CommonJS Node.js (`.cjs`) for the tooling and Markdown for prompts/workflows/agents.

## Key Conventions

- All Node.js modules use zero dependencies (Node.js stdlib only).
- Atomic file writes throughout: write to `.tmp` then `fs.renameSync()`.
- Config uses prototype-pollution-safe deep merge with `FORBIDDEN_KEYS` set.
- Hooks use a cross-platform wrapper pattern: `run-hook.cmd` dispatches to `run-hook.sh` (Unix) or runs directly (Windows).
- The plugin manifest lives at `.claude-plugin/plugin.json`.
- Version is tracked in both `plugin.json` and `VERSION` file (plugin.json is primary).
