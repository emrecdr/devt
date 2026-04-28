# devt

**devt** (short for **dev**elopment **t**eam) — a multi-agent development workflow plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

[![Version](https://img.shields.io/github/v/release/emrecdr/devt?display_name=tag&sort=semver&label=version&color=blue)](https://github.com/emrecdr/devt/releases)
[![CI](https://github.com/emrecdr/devt/actions/workflows/ci.yml/badge.svg)](https://github.com/emrecdr/devt/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22%2B-brightgreen)](https://nodejs.org)
[![Changelog](https://img.shields.io/badge/changelog-keep%20a%20changelog-orange)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## What It Does

devt orchestrates a coordinated multi-agent development workflow: **implement, test, review, document, learn**. Instead of relying on a single monolithic prompt, it decomposes work across specialized agents -- a programmer writes code, a tester verifies it, a code-reviewer audits it, a docs-writer updates documentation, and a retro agent extracts lessons for future sessions. Each agent is focused, stateless, and replaceable.

The plugin adapts to any project -- Python, Go, TypeScript, or anything else -- via the `.devt/rules/` convention. Project-specific coding standards, testing patterns, quality gates, and architecture decisions live in your repository, not baked into the plugin. Templates for common stacks are included; a blank template covers everything else.

### Key capabilities

- **Auto-complexity detection** -- Analyzes your task and selects the right pipeline (TRIVIAL through COMPLEX)
- **10 specialized agents** -- programmer, tester, code-reviewer, docs-writer, architect, retro, curator, verifier, researcher, debugger
- **Closed learning loop** -- Lessons extracted from each workflow feed back into future sessions via FTS5 semantic search
- **Autonomous chaining** -- Run implement → test → review → ship without manual `/devt:next` invocations
- **Test-driven development** -- `--tdd` flag reverses implement/test phase order
- **Dry-run mode** -- Preview the full pipeline (tier, steps, agents, models) before executing
- **State management** -- Full artifact lifecycle with validate, sync, and prune subcommands
- **Architecture health scanning** -- Track architectural drift across sessions with baseline diffing
- **Project-specific rules** -- `.devt/rules/` convention keeps agents grounded in your conventions

## Installation

### Via Claude Code plugin system

```bash
claude plugin add https://github.com/emrecdr/devt
```

### Via git clone

```bash
git clone https://github.com/emrecdr/devt.git ~/.devt
```

Then start Claude Code with devt loaded:

```bash
claude --plugin-dir ~/.devt
```

To avoid typing `--plugin-dir` every time, add a shell alias:

```bash
echo 'alias devt="claude --plugin-dir ~/.devt"' >> ~/.zshrc  # or ~/.bashrc
```

On first session start, devt registers commands under `~/.claude/commands/devt/` for autocomplete. All commands are available as `/devt:command-name`.

## Quick Start

### 1. Initialize your project

```bash
/devt:init
```

This scaffolds `.devt/rules/` with project-specific conventions and creates `.devt/config.json`. devt auto-detects your stack (Python, Go, TypeScript, Vue) and selects the matching template.

### 2. Build something

```bash
# The main entry point -- devt figures out the right approach
/devt:workflow "add a health check endpoint at GET /health returning 200"

# Don't know which command? Describe what you want
/devt:do "I need to refactor the auth module"
```

### 3. Iterate

```bash
# Check where you are
/devt:status

# Resume from where you left off
/devt:next

# Pause and create a handoff for the next session
/devt:pause
```

### 4. Ship

```bash
# Create PR with auto-generated description from workflow artifacts
/devt:ship
```

### More examples

```bash
# Define a feature before building
/devt:specify "user notification preferences"

# Fix a bug with systematic debugging
/devt:debug "login validation accepts empty passwords"

# Run the full pipeline without manual intervention
/devt:workflow --autonomous "add rate limiting to API endpoints"

# Test-driven development
/devt:workflow --tdd "add input validation to user registration"

# Preview what would happen without executing
/devt:workflow --dry-run "migrate database schema"

# Quick implementation (skips heavier pipeline steps)
/devt:implement "add created_at timestamp to User model"

# Standalone code review
/devt:review

# Investigate a failed or stuck workflow
/devt:forensics
```

**Task format**: Use imperative verb + specific outcome:

- Good: `"add health check endpoint at GET /health returning 200 with status ok"`
- Good: `"fix login validation that accepts empty passwords"`
- Bad: `"make it better"` (too vague)
- Bad: `"refactor everything"` (too broad)

## Architecture

```
User -> Command (thin) -> Workflow (orchestration) -> Agent (worker)
                                                    |
                                              .devt/state/ (artifacts)
```

The execution model follows a **Command -> Workflow -> Agent** architecture:

- **Commands** (28): Thin entry points. Parse arguments, delegate to a workflow. No business logic.
- **Workflows** (26): Orchestration files. Determine tier, coordinate agents, manage state transitions.
- **Agents** (10): Focused workers. Each owns one concern -- programmer, tester, code-reviewer, docs-writer, architect, retro, curator, verifier, researcher, debugger.
- **Skills** (15): Technique libraries injected into agents. Codebase scanning, complexity assessment, semantic search, TDD patterns, verification patterns, API docs fetching, and more.
- **Hooks** (7 lifecycle events): SessionStart, Stop, SubagentStart, SubagentStop, PostToolUse, PreToolUse, UserPromptSubmit. Managed via Node.js runner with profile control.

### Workflow Tiers

`/devt:workflow` auto-selects a tier based on task complexity:

| Tier         | Pipeline                                                                                                 | Auto-detected when                    |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **TRIVIAL**  | execute inline -> validate gates                                                                         | <=3 files, no decisions needed        |
| **SIMPLE**   | implement -> test -> review                                                                              | Single file, known pattern            |
| **STANDARD** | scan -> implement -> test -> review -> verify -> docs -> retro -> autoskill                              | Multiple files, existing patterns     |
| **COMPLEX**  | auto-research -> auto-plan -> scan -> architect -> implement -> test -> review -> verify -> docs -> retro -> curate -> autoskill | New patterns, architectural decisions |

You never need to choose a tier -- `/devt:workflow` detects it automatically. You can override if the assessment is wrong.

### Agent-Skill Mapping

Skills are injected into agents at dispatch time based on `skill-index.yaml` or `.devt/config.json` overrides:

| Agent           | Default Skills                                                                      |
| --------------- | ----------------------------------------------------------------------------------- |
| programmer      | codebase-scan, scratchpad, api-docs-fetcher, strategic-analysis, tdd-patterns, verification-patterns |
| tester          | scratchpad, tdd-patterns                                                            |
| code-reviewer   | code-review-guide, codebase-scan, scratchpad                                        |
| docs-writer     | scratchpad                                                                          |
| architect       | codebase-scan, architecture-health-scanner, api-docs-fetcher, strategic-analysis, complexity-assessment |
| verifier        | codebase-scan, verification-patterns                                                |
| researcher      | codebase-scan, strategic-analysis                                                   |
| debugger        | codebase-scan                                                                       |
| retro           | lesson-extraction, autoskill                                                        |
| curator         | playbook-curation, semantic-search, memory-compaction, autoskill                    |

## The .devt/rules/ Convention

Every project configured with devt gets a `.devt/rules/` directory containing project-specific rules that agents read at execution time. This keeps the plugin generic while giving agents deep project knowledge.

**Required files:**

| File                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `coding-standards.md` | Language conventions, naming, formatting, import rules |
| `testing-patterns.md` | Test framework, patterns, coverage expectations        |
| `quality-gates.md`    | Lint, typecheck, test commands and pass criteria       |
| `architecture.md`     | Layer structure, dependency rules, module boundaries   |

**Optional files:**

| File                        | Purpose                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `review-checklist.md`       | Language-specific review priorities and security patterns            |
| `api-changelog.md`          | API changelog format, before/after rules, migration checklist       |
| `documentation.md`          | Doc style, MODULE.md conventions, what to update                    |
| `git-workflow.md`           | Branch naming, commit conventions, PR process                       |
| `golden-rules.md`           | Non-negotiable rules: scan first, no duplicates, verify before done |
| `patterns/common-smells.md` | Anti-patterns to detect and fix during development                  |

Run `/devt:init` to generate these from a template matched to your stack.

**Available templates:** `python-fastapi`, `go`, `typescript-node`, `vue-bootstrap`, `blank`

## Configuration

The optional `.devt/config.json` file at your project root configures plugin behavior. A global `~/.devt/defaults.json` can set user-wide defaults that project config overrides.

```json
{
  "model_profile": "quality",
  "model_overrides": {
    "tester": "opus"
  },
  "git": {
    "provider": "github",
    "workspace": "my-team",
    "slug": "my-repo",
    "primary_branch": "main",
    "contributors": ["alice", "bob"]
  },
  "agent_skills": {
    "programmer": ["codebase-scan", "scratchpad", "api-docs-fetcher"],
    "tester": ["scratchpad"],
    "code-reviewer": ["code-review-guide", "codebase-scan"]
  },
  "arch_scanner": {
    "command": "make arch-scan",
    "report_dir": "docs/reports"
  }
}
```

### Configuration reference

| Key                            | Values                                                              | Default              |
| ------------------------------ | ------------------------------------------------------------------- | -------------------- |
| `model_profile`                | `quality`, `balanced`, `budget`, `inherit`                          | `quality`            |
| `model_overrides`              | Per-agent model tier (opus, sonnet, haiku, inherit)                 | From `model_profile` |
| `git.provider`                 | `github`, `bitbucket`, `gitlab`                                     | auto-detect          |
| `git.workspace`                | Organization or workspace name                                      | `null`               |
| `git.slug`                     | Repository slug                                                     | `null`               |
| `git.primary_branch`           | Default branch name                                                 | `main`               |
| `git.contributors`             | List of contributor usernames                                       | `[]`                 |
| `agent_skills`                 | Per-agent skill list overrides                                      | See `skill-index.yaml` |
| `arch_scanner`                 | Object with `command` and `report_dir`. devt does not ship a built-in scanner core, but the `python-fastapi` template includes a reference scanner at `.devt/rules/arch-scan.py` (Clean-Architecture audits, stdlib-only). Set `command` to invoke it (`python3 .devt/rules/arch-scan.py --json`) or to your own. When `null`, the architect agent falls back to manual Grep/Glob analysis. | `command: null`, `report_dir: docs/reports` |
| `workflow.docs`                | Toggle documentation step                                           | `true`               |
| `workflow.retro`               | Toggle retrospective step                                           | `true`               |
| `workflow.verification`        | Toggle verification step                                            | `true`               |
| `workflow.autoskill`           | Toggle autoskill step                                               | `true`               |
| `workflow.regression_baseline` | Run quality gates before implementation                             | `true`               |

Valid agents for `model_overrides`: programmer, tester, code-reviewer, docs-writer, architect, retro, curator, debugger, verifier, researcher. Invalid keys produce a warning and are ignored.

### Config merge order

Configuration merges in 3 layers (later overrides earlier):

1. **Hardcoded defaults** (in `config.cjs`)
2. **Global** (`~/.devt/defaults.json`) -- user-wide preferences
3. **Project** (`.devt/config.json`) -- project-specific overrides

## Commands

### Primary (start here)

| Command          | Description                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `/devt:do`       | Don't know which command? Describe what you want -- devt routes to the right one                         |
| `/devt:workflow`  | Build, fix, or improve anything. Supports `--autonomous`, `--tdd`, `--dry-run` flags                   |
| `/devt:specify`  | Define a feature through interview and codebase analysis -- produces a validated PRD                     |
| `/devt:debug`    | Investigate and fix a bug with 4-phase systematic debugging                                              |
| `/devt:ship`     | Create PR with auto-generated description from workflow artifacts                                        |
| `/devt:next`     | Auto-detect where you are and run the next logical step                                                  |

### Setup & Help

| Command      | Description                                                                        |
| ------------ | ---------------------------------------------------------------------------------- |
| `/devt:init` | Interactive project setup -- scaffolds `.devt/rules/` and `.devt/config.json`      |
| `/devt:help` | Show all commands with use cases -- basics to advanced                              |

### Utilities

| Command                 | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `/devt:status`          | Show current workflow progress and suggest next action           |
| `/devt:pause`           | Pause workflow and create structured handoff for resumption      |
| `/devt:forensics`       | Post-mortem investigation of failed or stuck workflows           |
| `/devt:cancel-workflow` | Abort the currently active workflow and reset state              |
| `/devt:note`            | Zero-friction idea capture -- save, list, or promote to task     |
| `/devt:health`          | Diagnose plugin health -- checks config, state, hooks. `--repair` flag |
| `/devt:session-report`  | Post-session summary -- commits, files changed, decisions       |
| `/devt:update`          | Check for and install plugin updates from GitHub                 |
| `/devt:thread`          | Persistent context threads for cross-session investigations      |
| `/devt:weekly-report`   | Generate a weekly contribution report from git history           |

### Internal (called by workflows, available for power users)

| Command             | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| `/devt:plan`        | Create a validated implementation plan (auto-triggered by workflow for COMPLEX tasks) |
| `/devt:research`    | Research implementation approaches (auto-triggered by plan for COMPLEX tasks)         |
| `/devt:clarify`     | Discuss choices and capture decisions (supports `--assumptions` mode)                 |
| `/devt:implement`   | Quick implementation -- workflow with SIMPLE tier                                     |
| `/devt:fast`        | Execute trivial tasks inline -- workflow with TRIVIAL tier                            |
| `/devt:review`      | Standalone code review                                                                |
| `/devt:quality`     | Run quality gates -- lint, typecheck, and tests                                       |
| `/devt:retro`       | Extract lessons learned into persistent memory                                        |
| `/devt:arch-health` | Architecture health scan with baseline diffing                                        |
| `/devt:autoskill`   | Propose skill and agent updates based on observed patterns                            |

## Learning Loop

devt includes a closed feedback loop that captures and reuses knowledge across sessions:

1. **Extract** -- After a workflow completes, the retro agent extracts lessons (what worked, what failed, patterns discovered) with a 4-filter quality gate.
2. **Curate** -- The curator agent evaluates lessons (accept, merge, edit, reject, archive) and writes them to `.devt/learning-playbook.md`.
3. **Index** -- The semantic module syncs the playbook to a SQLite FTS5 database (`node:sqlite` built-in, zero dependencies).
4. **Query** -- At the start of each workflow, `context_init` queries the FTS5 database for lessons relevant to the current task.
5. **Inject** -- Matching lessons are formatted and injected as `<learning_context>` into programmer, tester, and code-reviewer dispatches.

The loop is fully closed: lessons flow from completed work back into future agents. Early sessions produce raw lessons; later sessions benefit from accumulated project knowledge.

## Hooks

devt uses Claude Code hooks to inject context and manage lifecycle events. Hooks are defined in `hooks/hooks.json` and executed via a Node.js runner.

| Event              | What it does                                          |
| ------------------ | ----------------------------------------------------- |
| `SessionStart`     | Registers commands, checks for updates, loads context |
| `Stop`             | Cleans up workflow state                              |
| `SubagentStart`    | Tracks agent dispatch                                 |
| `SubagentStop`     | Tracks agent completion                               |
| `PostToolUse`      | Context monitoring                                    |
| `PreToolUse`       | Prompt guard (Write/Edit), read-before-edit guard     |
| `UserPromptSubmit` | Injects workflow context and statusline               |

### Hook profiles

Control hook verbosity with `DEVT_HOOK_PROFILE`:

```bash
export DEVT_HOOK_PROFILE=minimal   # Essential hooks only
export DEVT_HOOK_PROFILE=standard  # Default
export DEVT_HOOK_PROFILE=full      # All hooks active
```

Disable specific hooks:

```bash
export DEVT_DISABLED_HOOKS=context-monitor,read-before-edit-guard
```

## Guardrails

devt includes protective guardrails that prevent common AI-assisted development pitfalls:

- **Contamination guidelines** -- Prevent AI-generated patterns from degrading codebase quality
- **Generative debt checklist** -- Catch over-engineering, dead code, and unnecessary abstractions
- **Golden rules** -- Core principles that agents must never violate
- **Incident runbook** -- Recovery procedures when things go wrong
- **Skill update guidelines** -- Safe patterns for evolving the plugin itself

## CLI Tools

devt includes a zero-dependency Node.js CLI (`bin/devt-tools.cjs`) for state management and diagnostics:

```bash
# State management
node bin/devt-tools.cjs state read              # Show current workflow state
node bin/devt-tools.cjs state update key=value   # Update state fields
node bin/devt-tools.cjs state reset             # Reset all state
node bin/devt-tools.cjs state validate          # Check artifact consistency
node bin/devt-tools.cjs state sync              # Reconstruct state from artifacts
node bin/devt-tools.cjs state prune [--dry-run] # Remove orphaned artifacts

# Configuration
node bin/devt-tools.cjs config get              # Show merged config
node bin/devt-tools.cjs config set key=value    # Set project config value

# Model profiles
node bin/devt-tools.cjs models get <profile>    # Show model mappings
node bin/devt-tools.cjs models resolve <profile> # Resolve aliases to model IDs
node bin/devt-tools.cjs models list             # List available profiles
node bin/devt-tools.cjs models table <profile>  # Formatted table output

# Semantic search
node bin/devt-tools.cjs semantic sync           # Sync playbook to FTS5 database
node bin/devt-tools.cjs semantic query <terms>  # Search lessons by keyword
node bin/devt-tools.cjs semantic compact [--dry-run] # Archive stale lessons
node bin/devt-tools.cjs semantic status         # Show database stats

# Setup
node bin/devt-tools.cjs setup --template <name> [--mode create|update|reinit] [--detect]

# Diagnostics
node bin/devt-tools.cjs health [--repair]       # 22 health checks with auto-fix
node bin/devt-tools.cjs init workflow "task"     # Initialize workflow context
node bin/devt-tools.cjs init review "task"       # Initialize review context

# Updates
node bin/devt-tools.cjs update check [--force]  # Check for newer version
node bin/devt-tools.cjs update status           # Combined version + install info
node bin/devt-tools.cjs update local-version    # Show installed version
node bin/devt-tools.cjs update install-type     # Detect install method
node bin/devt-tools.cjs update dirty            # Check for local modifications
node bin/devt-tools.cjs update clear-cache      # Clear update check cache
node bin/devt-tools.cjs update changelog        # Fetch changelog from GitHub

# Reports
node bin/devt-tools.cjs report window [--weeks N]                   # Compute reporting window
node bin/devt-tools.cjs report generate [--weeks N] [--output PATH] # Generate contribution report
```

## Directory Structure

```
devt/
  .claude-plugin/
    plugin.json           # Plugin manifest
  bin/
    devt-tools.cjs        # CLI entry point
    modules/              # init, state, config, model-profiles, setup, semantic,
                          # security, health, weekly-report, update
  commands/               # 28 command entry points
  workflows/              # 26 orchestration files
  agents/                 # 10 agent definitions
  skills/                 # 15 skill directories
  hooks/                  # Lifecycle hooks (hooks.json + scripts)
  guardrails/             # Protective guidelines
  protocols/              # Interaction protocols (checkpoint, status enum, UI presentation)
  standards/              # Development pattern standards
  references/             # Technique libraries (questioning guide, domain probes)
  scripts/                # Utility scripts (quality gates, prompt injection
                          # scanning, CI smoke + concurrent locking tests)
  .github/workflows/      # CI: smoke-test on Node 22/24, version coherence,
                          # CHANGELOG coverage, workflow_type registry coverage,
                          # tag-driven GitHub releases
  templates/              # Project templates (python-fastapi, go, typescript-node,
                          # vue-bootstrap, blank)
  memory/                 # Memory schemas and semantic index
  skill-index.yaml        # Agent-to-skill mapping
```

## Updating

```bash
# Check for updates and install
/devt:update
```

devt checks for new versions on GitHub at each session start. When an update is available, you'll see a notification. The `/devt:update` command handles the update automatically -- it detects how devt was installed (plugin system or git clone) and runs the right update command.

Manual update:

```bash
cd ~/.devt && git pull origin main
```

Restart your Claude Code session after updating.

## Releases

Releases are published on GitHub at [emrecdr/devt/releases](https://github.com/emrecdr/devt/releases). Each version follows [Semantic Versioning](https://semver.org/) and has a matching `## [X.Y.Z]` section in [`CHANGELOG.md`](CHANGELOG.md), formatted per [Keep a Changelog](https://keepachangelog.com/).

The release flow is tag-driven: pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which extracts the changelog section via `scripts/extract-changelog.sh` and creates the GitHub release automatically. CI enforces that `VERSION`, `plugin.json` version, and the changelog all stay in lock-step — a version bump without a matching changelog entry fails the build.

## Troubleshooting

**Workflow fails or gets stuck:**

- Run `/devt:status` to see current state
- Run `/devt:forensics` for post-mortem investigation
- Run `/devt:cancel-workflow` to reset and start over
- Check `.devt/state/` for artifact details

**Plugin health issues:**

- Run `/devt:health` to diagnose (checks config, state, hooks -- 22 checks)
- Run `/devt:health --repair` to auto-fix safe issues

**Missing .devt/rules/:**

- Run `/devt:init` to set up project conventions

**Agent returns BLOCKED:**

- Read the agent's output in `.devt/state/` for details
- The task may need to be broken down or clarified

**Semantic search not working:**

- Run `node bin/devt-tools.cjs semantic status` to check database state
- Run `node bin/devt-tools.cjs semantic sync` to rebuild the FTS5 index
- Falls back to grep automatically if SQLite is unavailable

## License

MIT
