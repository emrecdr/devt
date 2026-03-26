# devt

**Lightweight multi-agent development workflow plugin for Claude Code.**

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## What It Does

devt orchestrates a coordinated multi-agent development workflow: **implement, test, review, document, learn**. Instead of relying on a single monolithic prompt, it decomposes work across specialized agents -- a programmer writes code, a tester verifies it, a code-reviewer audits it, a docs-writer updates documentation, and a retro agent extracts lessons for future sessions. Each agent is focused, stateless, and replaceable.

The plugin adapts to any project -- Python, Go, TypeScript, or anything else -- via the `.dev-rules/` convention. Project-specific coding standards, testing patterns, quality gates, and architecture decisions live in your repository, not baked into the plugin. Templates for common stacks are included; a blank template covers everything else.

devt draws from the **GSD pattern** (Command -> Workflow -> Agent) for its execution model and the **Superpowers pattern** for anti-rationalization guardrails and gate functions. Commands are thin entry points, workflows handle orchestration and tier selection, agents do the actual work, and hooks manage lifecycle events.

## Installation

```bash
# Option 1: Clone and add locally
git clone https://github.com/emrecamdere/devt.git ~/.claude/plugins/devt

# Option 2: Add from local path
claude plugin add /path/to/devt
```

## Quick Start

```bash
# Initialize for your project
/devt:init

# Run a full development workflow
/devt:workflow "add a health check endpoint"

# Quick implementation (skip docs/retro)
/devt:implement "fix the login validation bug"

# Code review only
/devt:review
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
                                              .devt-state/ (results)
```

The execution model has three layers:

- **Commands** (10): Thin entry points. Parse arguments, delegate to a workflow. No business logic.
- **Workflows** (8): Orchestration files. Determine tier, coordinate agents, manage state transitions.
- **Agents** (7): Focused workers. Each owns one concern -- programmer, tester, code-reviewer, docs-writer, architect, retro, curator.
- **Skills** (13): Technique libraries injected into agents. Codebase scanning, complexity assessment, semantic search, API docs fetching, and more.
- **Hooks** (5 lifecycle events): SessionStart, Stop, SubagentStart, SubagentStop, UserPromptSubmit. Manage workflow context injection, cleanup, and subagent tracking.

## The .dev-rules/ Convention

Every project configured with devt gets a `.dev-rules/` directory containing project-specific rules that agents read at execution time. This keeps the plugin generic while giving agents deep project knowledge.

**Required files:**

| File | Purpose |
|------|---------|
| `coding-standards.md` | Language conventions, naming, formatting, import rules |
| `testing-patterns.md` | Test framework, patterns, coverage expectations |
| `quality-gates.md` | Lint, typecheck, test commands and pass criteria |

**Optional files:**

| File | Purpose |
|------|---------|
| `architecture.md` | Layer structure, dependency rules, module boundaries |
| `documentation.md` | Doc style, MODULE.md conventions, what to update |
| `git-workflow.md` | Branch naming, commit conventions, PR process |

Run `/devt:init` to generate these from a template matched to your stack.

**Available templates:** `python-fastapi`, `go`, `typescript-node`, `blank`

## Configuration (.devt.json)

The optional `.devt.json` file at your project root configures plugin behavior:

```json
{
  "model_profile": "balanced",
  "git": {
    "provider": "bitbucket",
    "workspace": "my-team",
    "slug": "my-repo",
    "contributors": ["alice", "bob"]
  },
  "agent_skills": {
    "programmer": ["codebase-scan", "scratchpad", "api-docs-fetcher"],
    "tester": ["scratchpad"],
    "code-reviewer": ["code-review-guide", "codebase-scan"]
  },
  "arch_scanner": "make arch-scan"
}
```

| Key | Values | Default |
|-----|--------|---------|
| `model_profile` | `quality`, `balanced`, `budget`, `inherit` | `balanced` |
| `git.provider` | `github`, `bitbucket`, `gitlab` | auto-detect |
| `agent_skills` | Per-agent skill list overrides | See `skill-index.yaml` |
| `arch_scanner` | Custom architecture scan command | built-in scanner |

## Commands Reference

| Command | Description |
|---------|-------------|
| `/devt:workflow` | Full development pipeline -- scan, implement, test, review, docs, retro |
| `/devt:implement` | Quick implementation -- skip docs and retro, go straight to code and tests |
| `/devt:review` | Standalone code review -- read-only analysis with findings and recommendations |
| `/devt:quality` | Run quality gates -- lint, typecheck, and tests |
| `/devt:init` | Interactive project setup wizard that configures devt for a new or existing project |
| `/devt:retro` | Extract lessons learned from the current session into persistent memory |
| `/devt:arch-health` | Architecture health scan -- detect violations, coupling issues, and structural drift |
| `/devt:autoskill` | Propose skill and agent updates based on patterns observed in recent sessions |
| `/devt:weekly-report` | Generate a weekly contribution report from git history and session logs |
| `/devt:cancel-workflow` | Abort the currently active workflow and reset state |

## Workflow Tiers

The `/devt:workflow` command auto-selects a tier based on task complexity:

| Tier | Steps | When to use |
|------|-------|-------------|
| **SIMPLE** | implement -> test -> review | Single file, known pattern |
| **STANDARD** | scan -> implement -> test -> review -> docs -> retro -> curate | Multiple files, existing patterns |
| **COMPLEX** | scan -> architect -> implement -> test -> review -> docs -> retro -> curate -> autoskill | New patterns, architectural decisions |

Use `/devt:implement` to force the SIMPLE tier regardless of complexity.

## Learning Loop

devt includes a feedback loop that captures and reuses knowledge across sessions:

1. **Retro** -- After a workflow completes, the retro agent extracts lessons: what worked, what failed, decisions made, patterns discovered.
2. **Curator** -- The curator agent organizes extracted lessons into searchable playbooks, compacts redundant memories, and maintains the semantic index.
3. **Semantic Search** -- Future workflows query the knowledge base to find relevant prior lessons before starting work.

This means the plugin gets better at your project over time. Early sessions produce raw lessons; later sessions benefit from accumulated project knowledge.

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
  commands/               # 10 thin command entry points
  workflows/              # 8 orchestration files
  agents/                 # 7 agent definitions
  skills/                 # 13 technique skill directories
  hooks/                  # Lifecycle hooks (hooks.json + scripts)
  guardrails/             # Protective guidelines
  protocols/              # Interaction protocols
  standards/              # Development pattern standards
  templates/              # Project templates (python-fastapi, go, typescript-node, blank)
  scripts/                # Utility scripts (init, cancel, reset)
  memory/                 # Memory schemas and semantic index
  state/                  # Runtime workflow state
  skill-index.yaml        # Agent-to-skill mapping
```

## Troubleshooting

**Workflow fails or gets stuck:**
- Run `/devt:status` to see current state
- Run `/devt:cancel-workflow` to reset and start over
- Check `.devt-state/` for artifact details

**Missing .dev-rules/:**
- Run `/devt:init` to set up project conventions

**Agent returns BLOCKED:**
- Read the agent's output in `.devt-state/` for details
- The task may need to be broken down or clarified

## Experimental Features

These features are available but may have limited functionality:
- **Semantic search** — FTS5 lesson database (requires Python 3)
- **Memory compaction** — Automatic lesson archival (requires Python 3)
- **Autoskill** — Plugin self-improvement proposals

## License

MIT
