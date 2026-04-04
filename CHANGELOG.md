# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-04-04

### Added
- **Vue-bootstrap template**: form handling (ref + error object), permission-based rendering (computed + authStore), toast composable wrapper, shallowRef vs ref guidance, multi-env config, legacy Options API migration note
- **Vue-bootstrap template**: UI/UX quality standards (WCAG 2.2 AA: touch targets, focus states, contrast ratios, reduced-motion), responsive design checklist, diagnostic grep commands
- **Vue-bootstrap template**: 6 new code smells (div-as-button, missing loading states, stale permission checks, empty states, hardcoded transitions, direct toast calls)
- **Vue-bootstrap template**: architecture additions (constants 4-file pattern, API client architecture, theme/layout system)
- **All 15 skills**: "When NOT to Use" sections, time budget hints, concrete examples for edge cases
- **State validate/sync**: `devt-tools state validate` cross-references state claims against actual artifact files — detects drift when sessions drop mid-workflow (W013 health check)
- **Research gate**: planning blocks when research has unresolved open questions — presents them for resolve/defer/proceed decision
- **Scope reduction detection**: verifier Level 5 extracts every requirement from spec/plan, flags omissions as SCOPE_REDUCED forcing GAPS_FOUND verdict
- **Claim provenance tagging**: programmer, tester, code-reviewer artifacts now include Agent/Model/Timestamp provenance — verifier treats provenance-tagged claims as self-reported
- **Autonomous chain flag**: `--autonomous` workflows auto-advance to `/devt:ship` after completion; stale flag cleared on manual invocation
- **Parallel docs + retro**: docs-writer and retro agents now dispatch simultaneously (independent outputs), saving ~30-60s per STANDARD workflow
- **All 15 skills**: optimized descriptions for triggering accuracy with explicit trigger phrases and negative boundaries

### Fixed
- **UserPromptSubmit hook error**: `workflow-context-injector.sh` emitted empty line when no workflow was active, causing Claude Code to fail JSON parsing — now outputs nothing when idle
- **Stale `stopped_at`/`stopped_phase` on resume**: all 10 workflows now clear these fields when setting `active=true`, preventing misleading session-start banners and false W006 health alerts
- **`next.md` missing post-implementation routes**: added routing for impl-summary without review (→ `/devt:review`) and review with NEEDS_WORK verdict (→ resume `/devt:workflow`)
- **Missing `<agent_skills>` in 2 dispatch templates**: `debug.md` debugger and `create-plan.md` architect dispatches now include skill injection tag
- **`specify.md` decisions format**: extracted decisions now use DEC-xxx ID format matching `clarify-task.md`, enabling cross-workflow traceability
- **Quick-implement stale comment**: review iteration comparison updated from "vs 3" to "vs 5 (RETRY/DECOMPOSE/PRUNE)"
- **Verifier status enum incomplete**: added `DONE_WITH_CONCERNS` to formal output format (was already produced via turn-limit awareness but undocumented)
- **`next.md` NEEDS_WORK route accuracy**: corrected misleading "resume at implement phase" — workflow restarts from context_init, not mid-phase
- **`next.md` APPROVED_WITH_NOTES**: merged with APPROVED route — both are ship-ready verdicts
- **`next.md` unreadable verdict**: added route for interrupted/partial review.md with user prompt
- **Stale `verdict`/`repair`/`verify_iteration` on fresh workflow**: dev-workflow and quick-implement now reset these fields in context_init to prevent carry-over from prior runs
- **Hook `echo` portability**: replaced `echo "$RESULT"` with `printf '%s\n'` to avoid flag interpretation risk
- **`agent_skills` placeholder inconsistency**: normalized debug.md and create-plan.md to use the standard placeholder text

## [0.2.1] - 2026-03-31

### Added
- **Simplify workflow phase** (STANDARD + COMPLEX tiers): runs `/simplify` (3 parallel review agents for reuse, quality, efficiency) after tests pass, re-runs quality gates to verify, then proceeds to code review
- Programmer agent self-review now includes explicit simplification pass (reuse, redundancy, over-engineering, dead code checks) integrated into the `<self_review>` section
- `effort` field on all 10 agents: `high` for critical agents (programmer, tester, code-reviewer, verifier, architect, debugger), `medium` for support agents (docs-writer, retro, curator, researcher)
- State tracking (`active=true`, `phase`, `status=IN_PROGRESS/DONE`) added to standalone workflows: `debug.md`, `lesson-extraction.md`, `arch-health-scan.md` — enables `/devt:status` and `/devt:next` resume detection
- `<deviation_rules>` block added to `create-plan.md` (was the only workflow missing it)
- Programmer agent now reads `guardrails/generative-debt-checklist.md` — BEFORE/DURING/AFTER coding gates
- Tester agent now reads `guardrails/golden-rules.md` — scan-before-implementing applies to test code
- Code-reviewer agent now reads `guardrails/golden-rules.md` — reviews against universal rules
- `scripts/run-quality-gates.sh` and `scripts/check-docs.sh` moved from `harness/` to `scripts/` and wired into quality-gate-verifier

### Fixed
- **`run-hook.js` silent hook bypass**: spawn failure or timeout (status=null) now detected via `result.error` check and exits with code 1 instead of silently succeeding. Uses `??` instead of `||` for null-safe exit code
- **`semantic.cjs` crash on Node < 22.5**: `require("node:sqlite")` wrapped in try/catch with friendly error message showing required version
- **`security.cjs` dead code**: wired into `init.cjs` — task descriptions are now scanned for prompt injection patterns and sanitized via `sanitizeForPrompt()` before entering agent prompts
- **`stop.sh` performance**: collapsed 2 node spawns (parse + extract) into 1 with `IFS` parsing, eliminated intermediate `WORKFLOW_STATE` variable. Task descriptions sanitized to prevent newline-based IFS splitting
- **`subagent-status.sh` race condition**: `status.json` now uses atomic write (tmp + rename) matching project convention. Switched from `readFileSync('/dev/stdin')` to `process.argv[1]` for consistency
- **`state.cjs` VALID_PHASES**: added `debug`, `arch_health_scan`, `simplify` phases
- **`code-reviewer.md` numbering**: fixed duplicate item "4." in context_loading list
- `quality-gate-verifier.md` rewritten with correct hook schema (prompt, agent, command options) — was using outdated fields and incorrectly claiming plugins can't register agent-type Stop hooks
- `quality-gates.md` workflow: removed misleading agent reference list from `<available_agent_types>`
- `autoskill.md` workflow: clarified that agent dispatch is conditional, not guaranteed

### Changed
- `harness/` directory removed — scripts relocated to `scripts/` (run-quality-gates.sh, check-docs.sh)
- `state/workflow.yaml` at plugin root removed (development artifact — runtime state is in `.devt/state/`)

## [0.2.0] - 2026-03-30

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
- Command registration via symlink to `~/.claude/commands/devt/` for proper `devt:` namespacing in autocomplete
- `context-monitor.sh` made async — no longer blocks tool calls
- Health check W009: agent file validation — verifies all plugin agent files exist on disk
- Health check W010: workflow `<available_agent_types>` enforcement — prevents post-`/clear` silent fallback to general-purpose
- `scripts/prompt-injection-scan.sh` — CI security scanner for prompt injection, role manipulation, system boundary injection, base64 obfuscation, and secret detection across all markdown files
- Repo-local CLI resolution in `run-hook.js` — probes `<projectDir>/.claude/devt/` before global fallback, persists resolved path to temp file for workflow bash blocks
- `/devt:do` smart router — freeform text dispatched to the right command via intent matching
- `/devt:session-report` — post-session summary from git log and workflow artifacts
- `bin/modules/security.cjs` — input validation: path traversal prevention, prompt injection detection, safe JSON parsing, shell argument validation
- `references/questioning-guide.md` — collaborative questioning philosophy for specify and clarify workflows

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
- 28 commands, 26 workflows
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
