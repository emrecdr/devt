# devt

**devt** (short for **dev**elopment **t**eam) — a lightweight multi-agent development workflow plugin for Claude Code.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## What It Does

devt orchestrates a coordinated multi-agent development workflow: **implement, test, review, document, learn**. Instead of relying on a single monolithic prompt, it decomposes work across specialized agents -- a programmer writes code, a tester verifies it, a code-reviewer audits it, a docs-writer updates documentation, and a retro agent extracts lessons for future sessions. Each agent is focused, stateless, and replaceable.

The plugin adapts to any project -- Python, Go, TypeScript, or anything else -- via the `.devt/rules/` convention. Project-specific coding standards, testing patterns, quality gates, and architecture decisions live in your repository, not baked into the plugin. Templates for common stacks are included; a blank template covers everything else.

The execution model follows a **Command -> Workflow -> Agent** architecture with anti-rationalization guardrails and gate functions. Commands are thin entry points, workflows handle orchestration and tier selection, agents do the actual work, and hooks manage lifecycle events.

## Installation

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

## Quick Start

```bash
# Initialize for your project (one-time)
/devt:init

# Build anything — devt figures out the right approach
/devt:workflow "add a health check endpoint"

# Define a feature before building
/devt:specify "user notification preferences"

# Fix a bug
/devt:debug "tests failing on user service"

# Create PR when ready
/devt:ship
```

`/devt:workflow` auto-detects complexity and runs the right pipeline:

- **Trivial** (typo, config) → executes inline, no subagents
- **Simple** (one file, known pattern) → implement → test → review
- **Standard** (multiple files) → scan → implement → test → review → verify → docs → retro → autoskill
- **Complex** (new patterns, multi-service) → auto-research → auto-plan → scan → architect → full pipeline

**Task format**: Use imperative verb + specific outcome:

- Good: `"add health check endpoint at GET /health returning 200 with status ok"`
- Good: `"fix login validation that accepts empty passwords"`
- Bad: `"make it better"` (too vague)
- Bad: `"refactor everything"` (too broad)

## Architecture

```
User -> Command (thin) -> Workflow (orchestration) -> Agent (worker)
                                                    |
                                              .devt/state/ (results)
```

The execution model has three layers:

- **Commands** (25): Thin entry points. Parse arguments, delegate to a workflow. No business logic.
- **Workflows** (23): Orchestration files. Determine tier, coordinate agents, manage state transitions.
- **Agents** (10): Focused workers. Each owns one concern -- programmer, tester, code-reviewer, docs-writer, architect, retro, curator, verifier, researcher, debugger.
- **Skills** (15): Technique libraries injected into agents. Codebase scanning, complexity assessment, semantic search, API docs fetching, and more.
- **Hooks** (7 lifecycle events): SessionStart, Stop, SubagentStart, SubagentStop, PostToolUse, PreToolUse, UserPromptSubmit. Manage workflow context injection, cleanup, prompt injection guard, and subagent tracking.

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
| `documentation.md`          | Doc style, MODULE.md conventions, what to update                    |
| `git-workflow.md`           | Branch naming, commit conventions, PR process                       |
| `golden-rules.md`           | Non-negotiable rules: scan first, no duplicates, verify before done |
| `patterns/common-smells.md` | Anti-patterns to detect and fix during development                  |

Run `/devt:init` to generate these from a template matched to your stack. Files are placed in `.devt/rules/`.

**Available templates:** `python-fastapi`, `go`, `typescript-node`, `vue-bootstrap`, `blank`

## Configuration (.devt/config.json)

The optional `.devt/config.json` file at your project root configures plugin behavior:

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

| Key                            | Values                                                                                                                                                                                                                                  | Default                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `model_profile`                | `quality`, `balanced`, `budget`, `inherit`                                                                                                                                                                                              | `quality`              |
| `model_overrides`              | Per-agent model tier overrides (opus, sonnet, haiku, inherit). Valid agents: programmer, tester, code-reviewer, docs-writer, architect, retro, curator, debugger, verifier, researcher. Invalid keys produce a warning and are ignored. | From `model_profile`   |
| `git.provider`                 | `github`, `bitbucket`, `gitlab`                                                                                                                                                                                                         | auto-detect            |
| `git.workspace`                | Organization or workspace name                                                                                                                                                                                                          | `null`                 |
| `git.slug`                     | Repository slug                                                                                                                                                                                                                         | `null`                 |
| `git.primary_branch`           | Default branch name                                                                                                                                                                                                                     | `main`                 |
| `git.contributors`             | List of contributor usernames                                                                                                                                                                                                           | `[]`                   |
| `agent_skills`                 | Per-agent skill list overrides                                                                                                                                                                                                          | See `skill-index.yaml` |
| `arch_scanner`                 | Object with `command` and `report_dir`                                                                                                                                                                                                  | built-in scanner       |
| `workflow.docs`                | `true` / `false` — toggle documentation step                                                                                                                                                                                            | `true`                 |
| `workflow.retro`               | `true` / `false` — toggle retrospective step                                                                                                                                                                                            | `true`                 |
| `workflow.verification`        | `true` / `false` — toggle verification step                                                                                                                                                                                             | `true`                 |
| `workflow.autoskill`           | `true` / `false` — toggle autoskill step                                                                                                                                                                                                | `true`                 |
| `workflow.regression_baseline` | `true` / `false` — run quality gates before implementation                                                                                                                                                                              | `true`                 |

## Commands

### Primary (start here)

| Command          | Description                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/devt:workflow` | Build, fix, or improve anything — auto-detects complexity and runs the right pipeline. Supports `--autonomous` flag. |
| `/devt:specify`  | Define a feature through interview and codebase analysis — produces a validated PRD                                  |
| `/devt:debug`    | Investigate and fix a bug with 4-phase systematic debugging                                                          |
| `/devt:ship`     | Create PR with auto-generated description from workflow artifacts                                                    |
| `/devt:next`     | Auto-detect where you are and run the next logical step                                                              |

### Setup

| Command      | Description                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| `/devt:init` | Interactive project setup wizard — scaffolds `.devt/rules/` and `.devt/config.json` |

### Utilities

| Command                 | Description                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `/devt:status`          | Show current workflow progress and suggest next action      |
| `/devt:pause`           | Pause workflow and create structured handoff for resumption |
| `/devt:forensics`       | Post-mortem investigation of failed or stuck workflows      |
| `/devt:cancel-workflow` | Abort the currently active workflow and reset state         |
| `/devt:note`            | Zero-friction idea capture — save, list, or promote to task |
| `/devt:health`          | Diagnose plugin health — checks config, state, hooks        |
| `/devt:update`          | Check for and install plugin updates from GitHub            |

### Internal (called by workflows, available for power users)

| Command               | Description                                                                           |
| --------------------- | ------------------------------------------------------------------------------------- |
| `/devt:plan`          | Create a validated implementation plan (auto-triggered by workflow for COMPLEX tasks) |
| `/devt:research`      | Research implementation approaches (auto-triggered by plan for COMPLEX tasks)         |
| `/devt:clarify`       | Discuss choices and capture decisions (supports `--assumptions` mode)                 |
| `/devt:implement`     | Quick implementation — workflow with SIMPLE tier                                      |
| `/devt:fast`          | Execute trivial tasks inline — workflow with TRIVIAL tier                             |
| `/devt:review`        | Standalone code review                                                                |
| `/devt:quality`       | Run quality gates — lint, typecheck, and tests                                        |
| `/devt:retro`         | Extract lessons learned into persistent memory                                        |
| `/devt:arch-health`   | Architecture health scan                                                              |
| `/devt:autoskill`     | Propose skill and agent updates based on observed patterns                            |
| `/devt:weekly-report` | Generate a weekly contribution report from git history                                |
| `/devt:thread`        | Persistent context threads for cross-session investigations                           |

## Workflow Tiers

The `/devt:workflow` command auto-selects a tier based on task complexity:

| Tier         | Steps                                                                                                    | Auto-detected when                    |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **TRIVIAL**  | execute inline -> validate gates                                                                         | <=3 files, no decisions needed        |
| **SIMPLE**   | implement -> test -> review                                                                              | Single file, known pattern            |
| **STANDARD** | scan -> implement -> test -> review -> verify -> docs -> retro -> autoskill                              | Multiple files, existing patterns     |
| **COMPLEX**  | auto-research -> auto-plan -> scan -> [arch-health?] -> architect -> ... -> retro -> curate -> autoskill | New patterns, architectural decisions |

You never need to choose a tier — `/devt:workflow` detects it automatically. You can override if the assessment is wrong.

## Learning Loop

devt includes a closed feedback loop that captures and reuses knowledge across sessions:

1. **Extract** -- After a workflow completes, the retro agent extracts lessons (what worked, what failed, patterns discovered) with a 4-filter quality gate.
2. **Curate** -- The curator agent evaluates lessons (accept, merge, edit, reject, archive) and writes them to `.devt/learning-playbook.md` in a documented format.
3. **Index** -- The semantic module syncs the playbook to a SQLite FTS5 database (`node:sqlite` built-in, zero dependencies).
4. **Query** -- At the start of each workflow, `context_init` queries the FTS5 database for lessons relevant to the current task.
5. **Inject** -- Matching lessons are formatted and injected as `<learning_context>` into programmer, tester, and code-reviewer dispatches.

The loop is fully closed: lessons flow from completed work back into future agents. Early sessions produce raw lessons; later sessions benefit from accumulated project knowledge.

## Guardrails

devt includes protective guardrails that prevent common AI-assisted development pitfalls:

- **Contamination guidelines** -- Prevent AI-generated patterns from degrading codebase quality
- **Generative debt checklist** -- Catch over-engineering, dead code, and unnecessary abstractions
- **Golden rules** -- Core principles that agents must never violate
- **Incident runbook** -- Recovery procedures when things go wrong
- **Skill update guidelines** -- Safe patterns for evolving the plugin itself

## Directory Structure

```
devt/
  .claude-plugin/
    plugin.json           # Plugin manifest
  bin/
    devt-tools.cjs        # CLI entry point
    modules/              # init, state, config, model-profiles, setup, semantic, weekly-report, update
  commands/               # 25 thin command entry points
  workflows/              # 23 orchestration files
  agents/                 # 10 agent definitions
  skills/                 # 15 technique skill directories
  hooks/                  # Lifecycle hooks (hooks.json + scripts)
  guardrails/             # Protective guidelines
  protocols/              # Interaction protocols
  standards/              # Development pattern standards
  templates/              # Project templates (python-fastapi, go, typescript-node, vue-bootstrap, blank)
  memory/                 # Memory schemas and semantic index
  skill-index.yaml        # Agent-to-skill mapping
```

## Updating

```bash
# Check for updates and install
/devt:update
```

devt checks for new versions on GitHub at each session start. When an update is available, you'll see a notification. The `/devt:update` command handles the update automatically — it detects how devt was installed (plugin system or git clone) and runs the right update command.

Manual update methods:

```bash
# Pull latest from GitHub
cd ~/.devt && git pull origin main
```

Restart your Claude Code session after updating.

## Troubleshooting

**Workflow fails or gets stuck:**

- Run `/devt:status` to see current state
- Run `/devt:cancel-workflow` to reset and start over
- Check `.devt/state/` for artifact details

**Missing .devt/rules/:**

- Run `/devt:init` to set up project conventions

**Agent returns BLOCKED:**

- Read the agent's output in `.devt/state/` for details
- The task may need to be broken down or clarified

## License

MIT
