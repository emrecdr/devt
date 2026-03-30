# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-03-30

### Added
- `/devt:help` command — full command reference with use cases, organized by experience level
- `node devt-tools.cjs health [--repair]` — CLI-based health validation with structured JSON output, 17 checks, auto-repair for safe issues, version and update status display
- Hook profile system: `DEVT_HOOK_PROFILE=minimal|standard|full` and `DEVT_DISABLED_HOOKS` env var for granular hook control
- Node.js hook runner (`hooks/run-hook.js`) — replaces bash polyglot, resolves plugin root from script location, checks profile flags
- Language-specific `review-checklist.md` for all 5 templates (Python, Go, TypeScript, Vue, blank)
- `api-changelog.md` template for Go and TypeScript (was Python-only)
- `schemas/learning-entry.yaml` — formal entry schema for retro/curator agents
- Autoskill changelog audit trail (`.devt/autoskill-changelog.md`) — records all autoskill modifications
- Ship workflow changelog step — conditional API changelog generation when `.devt/rules/api-changelog.md` exists
- `templates/agent-template.md` and `templates/skill-template.md` — authoring templates for extending devt
- Explicit agent/skill/command registration in `plugin.json`
- `context-monitor.sh` made async — no longer blocks tool calls

### Fixed
- Hook exit codes: `workflow-context-injector.sh` and `context-monitor.sh` now exit 0 (not 2) when inactive — prevents blocking prompts and tool calls
- Stop hook output uses correct `stopReason` schema (was using `hookSpecificOutput` which is invalid for Stop events)
- `CLAUDE_PLUGIN_ROOT` path resolution: session-start hook injects the resolved absolute path so agents can substitute it in workflow bash commands
- `update status` type field collision: `dirty.type` no longer overwrites `install.type` for plugin installs
- `tier` vs `complexity` naming: workflow now writes `tier=` (not `complexity=`), matching schema, hooks, and cancel script. Legacy `complexity` normalized to `tier` on read.
- Non-atomic `stop.sh`: merged two separate `state update` calls into single atomic call
- `findProjectRoot()` memoized — eliminates redundant directory traversals per CLI call
- `checkWorkflowLock(state?)` accepts pre-read state to avoid double `readState()`
- Default model profile fallback aligned to `"quality"` everywhere (was `"balanced"` in some paths)
- Missing `plan` phase added to `VALID_PHASES`
- `architecture.md` correctly classified as required (was listed as optional in docs)
- Stale v0.2.0 migration checks removed from session-start hook
- API changelog template: Before/After labels no longer include version numbers
- Project-init: model profile selection split into own step to prevent batched AskUserQuestion errors

### Changed
- All project artifacts consolidated under `.devt/` directory:
  - `.devt.json` → `.devt/config.json`
  - `.dev-rules/` → `.devt/rules/`
  - `.devt-state/` → `.devt/state/`
  - `learning-playbook.md` → `.devt/learning-playbook.md`
- Health workflow rewritten to call CLI (deterministic) instead of agent-interpreted bash
- `DEFAULTS` exported from config.cjs — health and setup use canonical defaults
- `REQUIRED_DEV_RULES` exported from init.cjs — health imports instead of duplicating
- Atomic writes in setup.cjs via `atomicWriteJson()` helper
- `releaseLock` verifies PID ownership before unlinking (ABA prevention)
- Plugin install docs updated to `claude --plugin-dir` (correct mechanism)
- Weekly report workflow rewritten to use `devt-tools.cjs report` CLI (removed dead Python script branches)
- Incident runbook modernized — references `/devt:cancel-workflow` instead of raw scripts
- Incident runbook wired into dev-workflow.md deviation_rules for failure recovery
- `research-task.md` now has deviation_rules (was the only workflow missing them)
- `quick-implement.md` now writes `tier=SIMPLE` to state (was null, causing hooks to report unknown tier)
- `autonomous=true` state write added to dev-workflow.md when `--autonomous` flag detected
- Code-reviewer agent now reads `.devt/rules/review-checklist.md` for language-specific review patterns
- Retro and curator agents now read `schemas/learning-entry.yaml` for entry format validation

## [0.1.0] - 2026-03-30

Initial release.

### Core Architecture
- **Command -> Workflow -> Agent** three-layer execution model
- 10 agents: programmer, tester, code-reviewer, architect, docs-writer, verifier, researcher, debugger, retro, curator
- 15 skills: codebase-scan, complexity-assessment, tdd-patterns, code-review-guide, architecture-health-scanner, and more
- 26 commands, 24 workflows
- Complexity-tiered pipeline: TRIVIAL, SIMPLE, STANDARD, COMPLEX
- Language-agnostic via `.devt/rules/` convention

### Project Structure
- All artifacts under `.devt/` directory: `config.json`, `rules/`, `state/`, `learning-playbook.md`
- Templates: python-fastapi, go, typescript-node, vue-bootstrap, blank
- 3-level config merge: hardcoded defaults <- `~/.devt/defaults.json` (global) <- `.devt/config.json` (project)

### CLI Tools (zero dependencies)
- Compound init: single call returns all workflow context as JSON
- State management with file-level locking and PID-based stale lock detection
- FTS5 full-text search on learning playbook (node:sqlite)
- Version check against GitHub with 4-hour cache
- Stack auto-detection and git remote auto-detection

### Learning Loop
- Retro agent extracts lessons from each workflow run
- Curator agent deduplicates and compacts the learning playbook
- Semantic search injects relevant lessons into agent dispatches
- Autoskill proposes skill improvements based on accumulated patterns

### Hooks
- 7 lifecycle hooks: SessionStart, Stop, SubagentStart/Stop, PostToolUse, PreToolUse, UserPromptSubmit
- Cross-platform support via polyglot `run-hook.cmd` (Windows + Unix)
- Session-start injects CLI path resolution and workflow awareness
- Context monitor warns at high tool-call counts

### Update System
- `/devt:update` with GitHub version check, changelog display, install-type detection
- Background version check on session start
- Dirty tree detection with stash option for git installs
