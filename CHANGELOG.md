# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-03-28

Initial release.

### Core
- 10 agents, 15 skills, 23 commands, 23 workflows
- Complexity-tiered pipeline: TRIVIAL → SIMPLE → STANDARD → COMPLEX
- Language-agnostic core with `.dev-rules/` convention for project-specific rules
- Templates: python-fastapi, go, typescript-node, vue-bootstrap, blank
- Learning loop: retro → curator → semantic search → autoskill

### Agents
- programmer, tester, code-reviewer, architect, docs-writer, verifier, researcher, debugger, retro, curator
- Color-coded for visual identification in Claude Code UI
- READ-ONLY agents (architect, code-reviewer, researcher, verifier) restricted to Read/Bash/Glob/Grep

### Architecture Health
- 15 detection categories for architecture scanning
- Architecture health scan wired into COMPLEX workflow as optional Step 2.7 with risk-based recommendation
- Arch-health workflow reads all `.dev-rules/` files (architecture, coding-standards, golden-rules, common-smells, testing-patterns)

### Autoskill
- Confidence scoring system (1-5 pts per signal type)
- New-information filter — skip common knowledge, capture project-specific only
- Skill vs `.dev-rules/` routing for correct target selection
- Runs automatically for STANDARD and COMPLEX tiers

### Init
- Stack auto-detection (pyproject.toml, go.mod, tsconfig.json, vite.config.*)
- Git remote auto-detect (provider, workspace, slug, branch)
- Deep config merge: defaults ← git auto-detect ← user input
- Three modes: create, update (add missing files), reinit (overwrite)

### Update
- `/devt:update` command with GitHub version check, changelog display, install-type detection
- Background version check on session start with notification
- Dirty tree detection with stash option for git installs
- `--force` flag to bypass 4-hour cache

### Hooks
- 7 lifecycle hooks: SessionStart, Stop, SubagentStart/Stop, PostToolUse, PreToolUse, UserPromptSubmit
- Cross-platform support via polyglot `run-hook.cmd` (Windows + Unix)
- Migration warning system in session-start hook
- Richer session bootstrap with workflow awareness

### Python-FastAPI Template
- Modernized to 2025-2026 standards
- Annotated DI, lifespan context manager, structlog, OpenTelemetry
- testcontainers, httpx.AsyncClient, polyfactory
- Docker multi-stage build, pyproject.toml config, security section (CORS, auth, rate limiting)
- 30 anti-patterns with detection commands
