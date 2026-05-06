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

### Via Claude Code plugin marketplace (recommended)

Inside any Claude Code session, register the marketplace and install the plugin:

```text
/plugin marketplace add emrecdr/devt
/plugin install devt
```

The marketplace lives at the repository root (`.claude-plugin/marketplace.json`), so this single command pair fetches the plugin straight from GitHub and keeps it updatable via `/plugin update devt`. All commands become available as `/devt:command-name`.

### Via git clone (development / pre-marketplace use)

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

The `--plugin-dir` path is the canonical development install — used internally to test changes against the live plugin. Plugin agents (`devt:programmer`, `devt:retro`, etc.) only register when devt is loaded via the marketplace install or the `--plugin-dir` flag; running `claude` from a project directory without either path discovers commands and skills via cwd auto-discovery but agents will not appear in `claude agents`.

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
| `/devt:council`         | Pressure-test a decision through 5 advisors with peer review (Karpathy LLM Council). `--mixed-models` for cross-tier dispatch |

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
| `/devt:memory`      | Permanent ADR/Concept/Flow/REJ knowledge layer (v0.16.0+) — multi-root via `memory.paths` (v0.22.0+) |
| `/devt:preflight`   | Generate Topic Pre-Flight Brief (v0.18.0+) — auto-fired by every dev workflow at context_init |

## The Memory Layer

### What we are building

A **self-evolving knowledge graph** that bridges three sources of truth:

1. **The code that exists** — what functions, classes, and modules actually live in the repo (Graphify AST)
2. **The conversation happening now** — ephemeral observations captured mid-session (claude-mem ⚖️ decisions / 🔵 discoveries)
3. **The permanent architectural rules of the project** — what we always do and what we said no to (Markdown + SQLite FTS5)

The layer is **ground truth**: every dev workflow consults it before touching code, and curator-gated promotion ensures only validated knowledge lands.

### Why this matters

Standard AI coding is **amnesiac** — it forgets architectural decisions the moment the context window rolls over. The memory layer fixes three concrete failure modes:

- **Deterministic retrieval** — the AI finds the *exact* rule that governs a file (`affects_paths` glob match + symbol AST anchor), not just something semantically similar.
- **Proactive documentation** — the AI detects patterns mid-session, drafts its own ADRs/Concepts via `_suggestions.md`, and waits for your explicit approval before promoting them.
- **Refactor safety** — when you rename `UserService` → `AccountService`, `memory validate` flags every doc whose `affects_symbols[]` no longer resolves via Graphify (`category: "stale-symbol"`). Requires `graphify.enabled: true`; degrades gracefully without it (the rest of `validate` still runs path/link checks).

### The four tools and why each was chosen

| Tool | Role | Why this one |
|------|------|--------------|
| **Markdown** | The canonical truth | Human-readable, Git-tracked, diff-able. Every doc is `<id>-<slug>.md` with strict YAML frontmatter. |
| **SQLite (FTS5)** | The machine index | Lets the AI run Multi-Lane queries — joining `affects_paths`, `affects_symbols`, and `links` simultaneously. Text search alone can't do that. Built-in `node:sqlite` (zero dependencies, regenerable from markdown). |
| **Graphify** | Code reality (optional, AST) | Parses tree-sitter AST to bind docs to actual functions/classes — survives file renames. ADR symbol bindings carry `EXTRACTED`/`INFERRED`/`AMBIGUOUS` confidence. ~10× lower token cost on code-search ops. |
| **claude-mem** | Session buffer (optional) | Catches ephemeral ⚖️/🔵 observations during the conversation before they get "smelted" into permanent ADRs by the curator. Prevents knowledge loss between context-window rollovers. |

System stays fully functional without Graphify or claude-mem (grep fallback for the former, scratchpad-tag fallback for the latter). Both are opt-in.

### Three layers, three lifetimes

```
.devt/state/                    LAYER 1 — ephemeral (per-workflow)
├── decisions.md                    DEC-xxx — clarify/specify/research scratch
├── preflight-brief.md              Topic Pre-Flight Brief (auto-fired)
├── scratchpad.md                   cross-agent handoff (#KNOWLEDGE-CANDIDATE)
└── ...                             reset on /devt:cancel-workflow

.devt/learning-playbook.md      LAYER 2 — permanent (operational lessons)
                                    LES-xxx — "when X fails, check Y first"
                                    indexed via FTS5 at memory/semantic/lessons.db

.devt/memory/                   LAYER 3 — permanent (architectural truth)
├── decisions/                      ADR-xxx — constitutional decisions
├── concepts/                       CON-xxx — durable mental models
├── flows/                          FLOW-xxx — named sequences (auth, deploy, etc.)
├── rejected/                       REJ-xxx — tombstones (we said no, here's why)
├── _suggestions.md                 discovery proposals (curator-only writes)
└── index.db                        FTS5 unified index (gitignored, regenerable)
```

### The four doc types

Each doc is markdown with strict YAML frontmatter. Every doc has `id`, `doc_type`, `status`, `confidence`, `title`, `summary`, `affects_paths`, `affects_symbols`, `links`, `created_at`. ID prefixes are enforced (`ADR-001`, `CON-042`, `FLOW-007`, `REJ-013`).

| Type | Use for | Example |
|------|---------|---------|
| **ADR** (decision) | Constitutional rules — "we always do X, never Y" | "Auth uses HMAC-SHA256, never plain JWT" |
| **CON** (concept) | Durable mental models — "this is what X means here" | "A 'session' in this app is a request chain bound by trace_id" |
| **FLOW** (sequence) | Named multi-step processes — "the deploy flow is…" | "Production deploy: PR→smoke→canary→staged rollout→pagerduty hold" |
| **REJ** (rejected) | Tombstones — "we considered X, here's why it's a no" | "Server-Sent Events: rejected (cors_workarounds, mobile_battery_drain)" |

Confidence values: `verified` > `explicit` > `inferred` > `observed` > `speculative`. Status values: `candidate` (awaiting curator) → `active` (in force) → `superseded` (replaced by another ADR) → `rejected` (no-go).

### Two-Tier Pre-Flight Protocol (v0.18.0+)

- **Tier 1 — Topic Brief (automatic)**: every dev workflow auto-fires `/devt:preflight "<task>"` at context_init. The 6-lane orchestrator (`bin/modules/preflight.cjs`) reads the topic and writes `.devt/state/preflight-brief.md`:
  - Lane A — `affects_paths` glob match against changed files
  - Lane B — FTS5 keyword expansion across title/summary
  - Lane C — `affects_symbols` AST match (Graphify-anchored if enabled)
  - Lane D — wiki-link transitive closure (depth 2) from A+B+C seeds
  - Lane E — REJ tombstone overlap on `search_keywords`
  - Lane F — relevant lessons from `learning-playbook.md`

  All 8 dev agents preload the `devt:memory-pre-flight` skill and read the Brief first.

- **Tier 2 — File guard (PreToolUse)**: before each Edit/Write/NotebookEdit, agents append `PREFLIGHT <ts> edit <path> :: <governing IDs>` to `.devt/state/scratchpad.md`. The `hooks/pre-flight-guard.sh` PreToolUse hook checks the line. `memory.preflight_mode` controls behavior: `off` (no-op) / `warn` (advisory stderr) / `block` (denies the edit) — **default `block` in v0.19.0+**.

The PostToolUse hook `hooks/memory-auto-index.sh` rebuilds the FTS5 index whenever any `.devt/memory/**.md` file is touched, so queries always reflect the latest state.

### Vendored MCP server (10 tools, read-only)

`bin/devt-memory-mcp.cjs` is auto-registered in project `.mcp.json` at `/devt:init`. JSON-RPC 2.0 stdio, zero external dependencies, three layers of defense (`OPEN_READONLY` + SELECT-only validator + multi-statement guard) on the `query_index` SQL escape hatch. Tools:

| Tool | Purpose |
|------|---------|
| `get_context_for_path(path)` | Governing ADRs/CONs/FLOWs for a file |
| `get_context_for_symbol(symbol)` | Docs whose `affects_symbols` includes the symbol |
| `query_fts(terms, limit?)` | FTS5 unified search across all doc_class values |
| `get_doc(id)` | Fetch a single doc with affects/links/keywords |
| `list_active(domain?)` | Enumerate `status: active` docs |
| `list_rejected_keywords()` | REJ tombstones with their `search_keywords` |
| `list_links(doc_id, depth?)` | Transitive link expansion (depth-1 default) |
| `preflight(task)` | Full 6-lane Brief, same as CLI |
| `blast_radius(symbols)` | Graphify-derived dependents (degraded payload when disabled) |
| `query_index(sql)` | SELECT-only escape hatch for arbitrary FTS5 queries |

Per-call telemetry (v0.21.0+) lands in `.devt/memory/_mcp-trace.jsonl` (privacy-safe — sizes + 12-char fingerprints, no raw args). Aggregate via `node bin/devt-tools.cjs mcp-stats`.

### SQL views for triage (v0.25.0+)

Four convenience views accessible through `query_index`:

| View | What it surfaces | When to query |
|------|-----------------|---------------|
| `pending_review` | All `status: candidate` docs sorted by confidence (verified→speculative) then recency | Daily triage: which candidates need a curator pass? |
| `speculative_candidates` | All `confidence: speculative` docs regardless of status | Audit: what low-confidence claims exist in the system? |
| `constraint_chains` | Per-doc link degree (`outgoing_links` + `incoming_links`) | Spot hub docs (high incoming) and isolated leaves (zero outgoing) |
| `stale_speculative` | Speculative candidates >30 days old (uses `created_at` as age signal) | Cleanup: candidates that have sat untouched too long — promote, demote, or reject |

### Discovery → Curator promotion (v0.17.0+)

The curator agent is the **only** writer to `.devt/memory/`. Discovery (`bin/modules/discovery.cjs`) harvests three signal sources into `_suggestions.md` (never permanent files):

1. **claude-mem ⚖️/🔵** observations (decision and discovery tagged entries)
2. **`#KNOWLEDGE-CANDIDATE`** inline tags in `scratchpad.md`
3. **DEC-xxx** entries from `decisions.md`

Each candidate goes through five filters (relevance, novelty, dedup against existing memory, REJ tombstone overlap, schema-fit). Survivors are presented to the user via `AskUserQuestion` with the **full original reasoning verbatim** — no AI summarization. Only on user approval does the curator write the markdown file. REJ tombstones suppress matching future proposals **silently** (the "no nag" mechanism — keywords listed in `search_keywords` block re-proposals across discovery, autoskill, and the debugger).

### Validation surfaces

`memory validate` runs four checks:
- **Frontmatter schema** — required fields, valid `doc_type`/`status`/`confidence`/`link_type`/`rejection_reason` enums
- **Stale paths** — `affects_paths` entries that don't resolve to existing files
- **Broken links** — wiki-links pointing to non-existent doc ids
- **Self-links** (v0.25.0+) — `source_id = target_id` (almost always copy-paste authoring slip)

Plus standalone subcommands: `memory orphans` (docs with no incoming links), `memory stale-links` (link targets that don't exist anywhere). Symbol lookups via `affects-symbol` are case-insensitive (`COLLATE NOCASE`, v0.25.0+).

### Multi-root memory (v0.22.0+)

Set `memory.paths` in `.devt/config.json` to index company-wide ADRs alongside project-local ones:

```json
{
  "memory": {
    "paths": ["../engineering-adrs", ".devt/memory"]
  }
}
```

Last-wins precedence: project-local always overrides shared on ID collision (like CSS specificity). The `source_root` column tracks provenance. Conflicts are explicit (never silent) — `memory index` returns a `conflicts[]` array. Curator writes always land in the project-local root. Operational helpers:

- `memory paths --validate` — stat each root, surface `MEM_PATH_UNREACHABLE` with actionable hints
- `memory diff <root-a> <root-b>` — added/removed/changed docs with sha256:16 fingerprint over (frontmatter + body)
- Native MEM_* health checks in `devt-tools health`: `MEM_PATH_UNREACHABLE`, `MEM_INDEX_STALE`, `MEM_VALIDATE_ERRORS`, `MEM_CONFLICT_HIGH`

Use case: every ACME microservice inherits the org's 30+ ADRs via git submodule, while keeping its own project-specific decisions local — a single source of architectural truth without monolith coupling.

### Bundle export/import (v0.20.0+)

```bash
node bin/devt-tools.cjs memory bundle export --out=acme-memory.json --filter=domain:auth
node bin/devt-tools.cjs memory bundle import acme-memory.json --prefix=ACME-
```

Portable JSON snapshots with optional `--prefix` remapping (e.g., `ACME-` rewrites `ADR-001` → `ACME-ADR-001` to avoid collisions during cross-org sharing). Round-trip safe — exported `+` re-imported produces a byte-identical fingerprint.

### Graphify integration (optional)

```bash
pip install 'graphifyy[mcp]'   # then enable in .devt/config.json: graphify.enabled = true
```

Multi-language tree-sitter AST extractor. When enabled, the system upgrades five surfaces:

| Feature | Without Graphify | With Graphify |
|---|---|---|
| ADR symbol validation | Stored as authored | AST-validated; AMBIGUOUS bindings flagged |
| Topic Pre-Flight blast radius | Path-glob heuristic | AST-derived dependents/effect_size |
| File Pre-Flight Lane 0/3 | Skipped | Active (warm cache + symbol-anchored) |
| `architecture-health-scanner` | Path-based boundaries | Symbol-anchored boundaries |
| Code-search token cost | Baseline | ~10× reduction on symbol queries |

The system stays fully functional without it via grep fallback (4 fallback triggers: empty result / error / not setup / under `min_results_threshold`). Same opt-in design for `claude-mem` (mid-session capture).

### Where to read more

- **`docs/MEMORY.md`** — comprehensive user guide (frontmatter reference, authoring conventions, troubleshooting)
- **`guardrails/golden-rules.md`** — Rules 14 (Pre-Flight Protocol) and 15 (Memory Maintenance) — the constitutional rules every agent follows
- **`skills/memory-pre-flight/SKILL.md`** — the protocol skill loaded by all 8 dev agents
- **`skills/memory-curation/SKILL.md`** — the curator's promotion gate
- **`templates/memory/`** — ADR/CON/FLOW/REJ scaffolds for new docs

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

# Memory layer (v0.16.0+)
node bin/devt-tools.cjs memory init                       # Scaffold .devt/memory/ subdirs
node bin/devt-tools.cjs memory index                      # Rebuild FTS5 unified index
node bin/devt-tools.cjs memory query <terms>              # Full-text search across all docs
node bin/devt-tools.cjs memory get <id>                   # Fetch single doc by id
node bin/devt-tools.cjs memory affects <path>             # Docs governing a file path
node bin/devt-tools.cjs memory affects-symbol <name>      # Docs governing a symbol (NOCASE)
node bin/devt-tools.cjs memory list <status>              # List docs by status (active|candidate|...)
node bin/devt-tools.cjs memory validate                   # Frontmatter + broken-link + self-link checks
node bin/devt-tools.cjs memory orphans                    # Docs with no incoming links
node bin/devt-tools.cjs memory stale-links                # Wiki-links to non-existent ids
node bin/devt-tools.cjs memory paths [--validate]         # List memory roots (multi-root, v0.22.0+)
node bin/devt-tools.cjs memory diff <root-a> <root-b>     # Cross-root added/removed/changed (v0.23.0+)

# Topic Pre-Flight Brief (v0.18.0+)
node bin/devt-tools.cjs preflight "<topic>"               # 6-lane brief (path/FTS/symbol/wiki/REJ/lessons)

# Telemetry (v0.20.0+)
node bin/devt-tools.cjs token-report [--sessions=N]       # Session token cost breakdown
node bin/devt-tools.cjs token-report --baseline=PATH      # Snapshot for later comparison
node bin/devt-tools.cjs token-report --compare=PATH       # Compare current vs baseline
node bin/devt-tools.cjs mcp-stats [--since=DATE] [--tool=NAME]  # Per-tool MCP call stats
```

## Directory Structure

```
devt/
  .claude-plugin/
    plugin.json           # Plugin manifest
  bin/
    devt-tools.cjs        # CLI entry point
    modules/              # init, state, config, model-profiles, setup, semantic,
                          # security, health, weekly-report, update, cli-args,
                          # memory, preflight, discovery, graphify, mcp-stats,
                          # token-report
    devt-memory-mcp.cjs   # Vendored read-only MCP server (10 tools, JSON-RPC stdio)
  commands/               # 29 command entry points
  workflows/              # 26 orchestration files
  agents/                 # 10 agent definitions
  skills/                 # 16 skill directories
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
