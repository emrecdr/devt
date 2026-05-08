# devt

**devt** (short for **dev**elopment **t**eam) — a multi-agent development workflow plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

[![Version](https://img.shields.io/github/v/tag/emrecdr/devt?sort=semver&label=version&color=blue)](https://github.com/emrecdr/devt/releases)
[![CI](https://github.com/emrecdr/devt/actions/workflows/ci.yml/badge.svg)](https://github.com/emrecdr/devt/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22%2B-brightgreen)](https://nodejs.org)
[![Changelog](https://img.shields.io/badge/changelog-keep%20a%20changelog-orange)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## Contents

1. [What is devt?](#what-is-devt)
2. [Setup](#setup)
3. [Configuration](#configuration)
4. [Use cases](#use-cases)
5. [Dependencies & integrations](#dependencies--integrations)
6. [Features](#features)
7. [How it works (architecture)](#how-it-works-architecture)
8. [The problem it solves](#the-problem-it-solves)
9. [Reference](#reference) — commands, CLI, hooks, troubleshooting
10. [Releases & contributing](#releases--contributing)

---

## What is devt?

A Claude Code plugin that orchestrates a coordinated **multi-agent** development workflow: **implement → test → review → document → learn**. Instead of relying on a single monolithic prompt, devt decomposes work across specialized agents — a programmer writes code, a tester verifies it, a code-reviewer audits it, a docs-writer updates documentation, and a retro agent extracts lessons for future sessions. Each agent is focused, stateless, and replaceable.

The plugin is **language-agnostic** — Python, Go, TypeScript, Vue, or anything else. Project-specific coding standards, testing patterns, quality gates, and architecture rules live in your repository under `.devt/rules/`, not baked into the plugin. Templates for common stacks are included; a blank template covers everything else.

### What you get out of the box

- **Auto-complexity detection** — analyzes your task and selects the right pipeline (TRIVIAL through COMPLEX)
- **10 specialized agents** — programmer, tester, code-reviewer, docs-writer, architect, retro, curator, verifier, researcher, debugger
- **Closed learning loop** — lessons extracted from each workflow feed back into future sessions
- **Permanent memory layer** — ADR/CON/FLOW/REJ/LES knowledge graph that survives session boundaries (curator-gated, FTS5-indexed)
- **Topic Pre-Flight Brief** — every workflow starts by surfacing governing decisions, rejected approaches, related lessons, and blast radius
- **Autonomous chaining** — implement → test → review → ship without manual `/devt:next` invocations
- **Test-driven development** — `--tdd` flag reverses implement/test phase order
- **Architecture health scanning** — track architectural drift across sessions with baseline diffing
- **Deferred-task tracker** — capture mid-work TODOs without derailing current focus

---

---

## Setup

### Install

**Via Claude Code plugin marketplace (recommended):**

```text
/plugin marketplace add emrecdr/devt
/plugin install devt
```

The marketplace lives at the repo root (`.claude-plugin/marketplace.json`). Updates via `/plugin update devt`. All commands become available as `/devt:command-name`.

**Via git clone (development / pre-marketplace):**

```bash
git clone https://github.com/emrecdr/devt.git ~/.devt
claude --plugin-dir ~/.devt
```

To avoid `--plugin-dir` every time:

```bash
echo 'alias devt="claude --plugin-dir ~/.devt"' >> ~/.zshrc  # or ~/.bashrc
```

> Plugin agents (`devt:programmer`, `devt:retro`, etc.) only register when devt is loaded via the marketplace install or `--plugin-dir`. Running `claude` from a project directory without either path discovers commands and skills via cwd auto-discovery, but agents won't appear in `claude agents`.

### Initialize a project

```bash
/devt:init
```

This scaffolds `.devt/rules/` with project-specific conventions and creates `.devt/config.json`. devt auto-detects your stack and selects the matching template. The wizard also pitches optional integrations (Graphify for AST-anchored code search, claude-mem for session capture) — declining still produces a fully working install.

### First task

```bash
/devt:workflow "add a health check endpoint at GET /health returning 200"
```

`/devt:workflow` is the primary entry. devt analyzes the task, picks a tier, runs the pipeline. If you don't know which command to use, `/devt:do "describe what you want"` routes for you.

**Task format**: imperative verb + specific outcome.

- ✓ `"add health check endpoint at GET /health returning 200 with status ok"`
- ✓ `"fix login validation that accepts empty passwords"`
- ✗ `"make it better"` — too vague
- ✗ `"refactor everything"` — too broad

### Reset or uninstall

```text
/devt:uninstall
```

Interactive workflow that asks which level of reset you want and confirms before any destructive op. Always creates a `.devt.bak.YYYYMMDD-HHMMSS/` backup for project-reset and full-reset modes, so you can restore by `mv`-ing it back.

Four modes:

| Mode | What it does | Keeps |
|---|---|---|
| **Reinit** | Re-scaffold `.devt/rules/` + `.devt/config.json` from template | Memory (ADR/CON/FLOW/REJ/LES), lessons, deferred queue |
| **Project reset** | Wipe all `.devt/` in this project | Files outside `.devt/` (`.mcp.json`, `.claude/`, `.gitignore` entries) |
| **Full reset** | Wipe `.devt/` + scattered devt files at repo root | Optional Graphify / claude-mem caches (not auto-removed) |
| **Plugin uninstall** | Remove the plugin itself (advisory — auto-detects install type and instructs) | All project `.devt/` directories — those are owned by your repos |

devt scatters a few files outside `.devt/` (`.mcp.json`, `.claude/agent-memory/devt-debugger/`, `.gitignore` entries, `.git/hooks/post-commit`) because Claude Code and git specs require those paths. The full-reset mode handles all of them.

---

---

## Configuration

Optional `.devt/config.json` at project root configures plugin behavior. Global `~/.devt/defaults.json` sets user-wide defaults that project config overrides.

```json
{
  "model_profile": "quality",
  "model_overrides": { "tester": "opus" },
  "git": {
    "provider": "github", "workspace": "my-team", "slug": "my-repo",
    "primary_branch": "main", "contributors": ["alice", "bob"]
  },
  "agent_skills": { "programmer": ["codebase-scan", "scratchpad", "api-docs-fetcher"] },
  "memory": { "paths": ["../engineering-adrs", ".devt/memory"], "preflight_mode": "block" },
  "graphify": { "enabled": true, "command": "graphify" },
  "arch_scanner": { "command": "make arch-scan", "report_dir": "docs/reports" },
  "scope_mode": "surgical"
}
```

| Key | Values | Default |
|---|---|---|
| `model_profile` | `quality` / `balanced` / `budget` / `inherit` | `quality` |
| `model_overrides` | Per-agent model tier (opus / sonnet / haiku / inherit) | from `model_profile` |
| `git.*` | provider / workspace / slug / primary_branch / contributors | auto-detect |
| `agent_skills` | Per-agent skill list overrides | see `skill-index.yaml` |
| `memory.paths` | Multi-root memory roots (last-wins precedence) | project-local only |
| `memory.preflight_mode` | `off` / `warn` / `block` | `block` |
| `graphify.enabled` | Boolean | `false` (auto-set to `true` by `setup.cjs` when the `graphify` binary is on PATH at first setup) |
| `arch_scanner.command` | Architecture scanner invocation | `null` (manual analysis) |
| `scope_mode` | `surgical` / `boyscout` — see below | `surgical` |
| `workflow.docs` / `.retro` / `.verification` / `.autoskill` / `.regression_baseline` | Toggle pipeline steps | all `true` |

Config merge order: hardcoded defaults → `~/.devt/defaults.json` → `.devt/config.json` (later overrides earlier).

#### `scope_mode` — surgical (default) vs boy-scout

Controls how agents handle *unrelated* findings discovered while doing the requested task — dead imports, lint warnings, cosmetic issues in files they're touching anyway.

| Mode | Behavior | When to pick |
|---|---|---|
| **`surgical`** (default) | Find-Surface-Decide protocol per `golden-rules.md` Rule 5: agent **finds** the unrelated issue, **surfaces** it to you (in the impl-summary or a `defer add`), and **does NOT fix it** without explicit approval. Keeps PRs reviewable — diff scope matches the asked-for change. | Production codebases, regulated environments, anywhere PR diff hygiene matters, code-review handoffs |
| **`boyscout`** | Blanket authority for small mechanical in-file cleanups (dead imports, formatter fixes, removing `console.log`) without asking — *only* in files the agent is already touching, and *only* for changes that don't alter behavior. Bigger findings (refactors, behavior changes, structural fixes) still go through Find-Surface-Decide. | Personal projects, prototypes, fast-moving codebases, individual contributors who own the diff |

The setting is **declarative** — no enforcement code reads it. Agents self-regulate based on the rule body and the resolved value in their context. Switching modes mid-project just changes future agent behavior; existing artifacts are unaffected.

---

## Use cases

| When you want to… | Run |
| --- | --- |
| Build a feature end-to-end | `/devt:workflow "<task>"` |
| Build with no manual steps between phases | `/devt:workflow --autonomous "<task>"` |
| Test-driven flow (test before implement) | `/devt:workflow --tdd "<task>"` |
| Preview a pipeline without executing | `/devt:workflow --dry-run "<task>"` |
| Define a feature before building it | `/devt:specify "<feature>"` |
| Fix a tricky bug systematically | `/devt:debug "<symptom>"` |
| Quick implementation (skip heavier steps) | `/devt:implement "<task>"` |
| Trivial inline change | `/devt:fast "<change>"` |
| Standalone code review | `/devt:review` |
| Investigate failed/stuck workflow | `/devt:forensics` |
| Resume from where you left off | `/devt:next` |
| Pause and create a session handoff | `/devt:pause` |
| Capture a deferred TODO without derailing | `/devt:defer "<title>"` |
| Pressure-test a hard decision (5 advisors) | `/devt:council "<question>"` |
| Create a PR with auto-generated description | `/devt:ship` |
| Update the plugin | `/devt:update` |

---

---

## Dependencies & integrations

devt is **zero-npm-dependency** by design. The required install footprint is just Node.js, bash, and Claude Code itself. Optional integrations plug into specific pipelines and degrade gracefully when absent.

### Required

| Tool | Why | How devt uses it |
|---|---|---|
| **Node.js ≥ 22** | Runtime for all CLI tooling. The `node:sqlite` built-in (v22.5+) backs the FTS5 memory index — no `better-sqlite3` npm dep. | All `bin/*.cjs` modules; `node:sqlite` for `.devt/memory/index.db` |
| **bash + standard Unix tools** (`grep`, `sed`, `awk`, `git`) | Lifecycle hooks (`hooks/*.sh`), CI scripts, prompt-injection scanner | 11 hooks across 6 lifecycle events + smoke test infrastructure |
| **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** | Host platform | Skills/agents/commands/hooks all run through Claude Code's harness |

### Recommended optional integrations

Each adds a measurable benefit at a specific pipeline point. Setup auto-detects each binary on PATH; if absent, devt falls back to grep / scratchpad markers.

#### Graphify — multi-language AST anchoring (~10× lower token cost on code-search)

**Repo:** [github.com/safishamsi/graphify](https://github.com/safishamsi/graphify)

**Install:** `uv tool install graphifyy[mcp]` *(recommended — works for both CLI and MCP server launch)* or `pip install graphifyy[mcp]` *(MCP launch still requires `uv` on PATH for graphify v0.7.10+)*

**What it improves:**

| Surface | Without Graphify | With Graphify |
|---|---|---|
| Pre-Flight Brief Lane C (symbol resolution) | grep across `affects_symbols` text fields | tree-sitter AST resolution — knows `User` the class differs from `User` the type alias |
| `blast_radius()` MCP tool | Falls back to filename matching | Walks actual import graph via `getNeighbors()` for true impact analysis |
| `memory validate` stale-symbol check | Cannot detect — keeps `affects_symbols: [renamedFn]` after refactor silently | Flags symbols in memory docs that no longer exist in the codebase |
| Code-search agents (programmer/debugger/researcher/code-reviewer/verifier/architect) | grep + path patterns | Graphify-first protocol → ~200–400 tokens per query vs ~3–5K with grep |

Concrete savings vary by codebase size; the ~10× claim is conservative for medium codebases (500+ files).

#### uv — fast Python package manager

**Install:** `curl -LsSf https://astral.sh/uv/install.sh | sh`

**Why required for Graphify:** graphify v0.7.10+ launches its MCP server via `uv run --with graphifyy --with mcp -m graphify.serve`. Without `uv`, devt scaffolds a Python-direct fallback (`python3 -m graphify.serve`) only when graphifyy is importable from your system Python.

#### claude-mem — mid-session insight capture

**Install:** see [claude-mem](https://github.com/thedotmack/claude-mem) docs.

**What it improves:** `bin/modules/discovery.cjs::harvest()` mines claude-mem's ⚖️ (decisions) and 🔵 (insights) tags into `.devt/memory/_suggestions.md` — the curator agent then gates each candidate via AskUserQuestion before promoting to permanent memory. Without claude-mem, discovery still works on `#KNOWLEDGE-CANDIDATE` scratchpad markers and DEC-xxx entries — you get fewer auto-surfaced ADR/CON candidates but nothing breaks.

### Vendored / built-in (no install needed)

| Component | Where | What it provides |
|---|---|---|
| **devt-memory MCP server** | `bin/devt-memory-mcp.cjs` | 10-tool stdio JSON-RPC server (`get_context_for_path`, `get_context_for_symbol`, `query_fts`, `get_doc`, `list_active`, `list_rejected_keywords`, `list_links`, `preflight`, `blast_radius`, `query_index`). Read-only — `OPEN_READONLY` + SELECT-only validator + multi-statement guard on the `query_index` SQL escape hatch. Auto-registers when devt is loaded as a plugin. |
| **SQLite FTS5** | Node 22.5+ stdlib (`node:sqlite`) | Full-text search across all 5 doc types in `.devt/memory/index.db` with BM25 ranking, 4 SQL views, NOCASE collation, multi-root provenance |
| **Atomic write helpers** | `bin/modules/io.cjs` | `tmp + renameSync + cleanup-on-failure` for every state mutation — prevents partial writes |
| **Security utilities** | `bin/modules/security.cjs` | Path-traversal prevention, prompt injection detection, `safeJsonParse`, secret masking before LLM context |

### Per-template tools (only if you use that template)

| Template | Tool | Notes |
|---|---|---|
| `python-fastapi` | Python 3 + stdlib | Reference architecture scanner (`arch-scan.py`) detects 6 layer-violation patterns; stdlib-only, no pip install |
| `python-fastapi` | HURL | Recommended E2E test pattern; install only if your project uses it |
| `go` / `typescript-node` / `vue-bootstrap` / `blank` | (per template) | Each template documents its own ecosystem's recommended tooling; devt has no opinion |

### CI

GitHub Actions runs `scripts/smoke-test.sh` (260+ assertions across all CLI subcommands) and `scripts/test-locking.cjs` (20-worker concurrent state-write test) on every push. Version coherence, CHANGELOG coverage, and `workflow_type` registry coverage are enforced. Releases are tag-driven — push `vX.Y.Z` to fire `.github/workflows/release.yml` which extracts the matching CHANGELOG section into the GitHub release notes.

---

## Features

### The memory layer — bridges three sources of truth

A self-evolving knowledge graph that joins:

1. **The code that exists** — what functions, classes, modules actually live in the repo (Graphify AST)
2. **The conversation happening now** — ephemeral observations captured mid-session (claude-mem ⚖️ decisions / 🔵 discoveries)
3. **The permanent rules of the project** — what we always do and what we said no to (Markdown + SQLite FTS5)

The layer is **ground truth**: every dev workflow consults it before touching code, and curator-gated promotion ensures only validated knowledge lands.

#### Two layers, two lifetimes

```
.devt/state/                    LAYER 1 — ephemeral (per-workflow)
├── decisions.md                    DEC-xxx — clarify/specify/research scratch
├── lessons.yaml                    retro draft hand-off → curator promotes to LES-NNNN
├── deferred.md                     DEF-NNN cross-workflow TODO queue (reset-exempted)
├── preflight-brief.md              Topic Pre-Flight Brief (auto-fired)
├── scratchpad.md                   cross-agent handoff (#KNOWLEDGE-CANDIDATE)
└── …                               reset on /devt:cancel-workflow

.devt/memory/                   LAYER 2 — permanent (canonical knowledge)
├── decisions/                      ADR-xxx — constitutional decisions
├── concepts/                       CON-xxx — durable mental models
├── flows/                          FLOW-xxx — named sequences (auth, deploy, …)
├── rejected/                       REJ-xxx — tombstones (we said no, here's why)
├── lessons/                        LES-xxx — operational lessons ("when X, do Y")
├── _suggestions.md                 discovery proposals (curator-only writes)
└── index.db                        FTS5 unified index (gitignored, regenerable)
```

#### The five doc types

Each doc is markdown with strict YAML frontmatter — `id`, `doc_type`, `status`, `confidence`, `title`, `summary`, `affects_paths`, `affects_symbols`, `links`, `created_at`. ID prefixes enforced: `ADR-001`, `CON-042`, `FLOW-007`, `REJ-013`, `LES-001`.

| Type | Use for | Example |
|------|---------|---------|
| **ADR** (decision) | Constitutional rules — "we always do X, never Y" | "Auth uses HMAC-SHA256, never plain JWT" |
| **CON** (concept) | Durable mental models — "this is what X means here" | "A 'session' here is a request chain bound by trace_id" |
| **FLOW** (sequence) | Named multi-step processes | "Production deploy: PR→smoke→canary→staged rollout→pagerduty hold" |
| **REJ** (rejected) | Tombstones — "we considered X, here's why it's a no" | "Server-Sent Events: rejected (cors_workarounds, mobile_battery_drain)" |
| **LES** (lesson) | Operational tactics — "when X happens, do Y" | "When integration tests flake on first run, check fixture seed order" |

Confidence: `verified` > `explicit` > `inferred` > `observed` > `speculative`. Status: `candidate` → `active` → `superseded` → `rejected`.

#### Two-Tier Pre-Flight Protocol

- **Tier 1 — Topic Brief (automatic)**: every dev workflow auto-fires `/devt:preflight "<task>"` at context_init. The 6-lane orchestrator (`bin/modules/preflight.cjs`) writes `.devt/state/preflight-brief.md`:
  - Lane A — `affects_paths` glob match
  - Lane B — FTS5 keyword expansion
  - Lane C — `affects_symbols` AST match (Graphify-anchored when enabled)
  - Lane D — wiki-link transitive closure (depth 2) from A∪B∪C seeds
  - Lane E — REJ tombstone overlap on `search_keywords`
  - Lane F — filters governing docs for `doc_type='lesson'` to render LES-NNNN entries

  All 8 dev agents preload `devt:memory-pre-flight` and read the Brief first.

- **Tier 2 — File guard (PreToolUse)**: agents append `PREFLIGHT <ts> edit <path> :: <governing IDs>` to scratchpad before each Edit/Write. `hooks/pre-flight-guard.sh` checks the line. `memory.preflight_mode`: `off` / `warn` / `block` (default **block**).

The PostToolUse `hooks/memory-auto-index.sh` rebuilds the FTS5 index whenever `.devt/memory/**.md` is touched (debounced; collapses curator batch-promotions into a single rebuild).

#### Vendored MCP server (10 tools, read-only)

`bin/devt-memory-mcp.cjs` ships with the plugin and is registered via the plugin-root `.mcp.json` — Claude Code resolves `${CLAUDE_PLUGIN_ROOT}` at MCP-server launch and starts the server automatically whenever the devt plugin is loaded (no per-project scaffolding). JSON-RPC 2.0 stdio, zero external dependencies, three layers of defense (`OPEN_READONLY` + SELECT-only validator + multi-statement guard) on the `query_index` SQL escape hatch. Tools: `get_context_for_path`, `get_context_for_symbol`, `query_fts`, `get_doc`, `list_active`, `list_rejected_keywords`, `list_links`, `preflight`, `blast_radius`, `query_index`.

Per-call telemetry lands in `.devt/memory/_mcp-trace.jsonl` (privacy-safe — sizes + 12-char fingerprints, no raw args). Aggregate via `node bin/devt-tools.cjs mcp-stats`.

#### Multi-root memory

Set `memory.paths` in `.devt/config.json` to index company-wide ADRs alongside project-local ones:

```json
{ "memory": { "paths": ["../engineering-adrs", ".devt/memory"] } }
```

Last-wins precedence: project-local overrides shared on ID collision. `source_root` column tracks provenance. Conflicts are explicit (`memory index` returns a `conflicts[]` array) — never silent.

#### Bundle export/import

```bash
node bin/devt-tools.cjs memory bundle export --out=acme-memory.json --filter=domain:auth
node bin/devt-tools.cjs memory bundle import acme-memory.json --prefix=ACME-
```

Round-trip-safe portable JSON with optional ID prefix remapping for cross-org sharing.

### Closed learning loop

devt captures and reuses knowledge across sessions:

1. **Extract** — retro agent distills lessons (4-filter quality gate) → `.devt/state/lessons.yaml`
2. **Curate** — curator agent applies the 5-filter (Specificity, Durability, Non-obviousness, Evidence, Actionability) and presents AskUserQuestion per candidate → on approval, writes `.devt/memory/lessons/LES-NNNN-slug.md`
3. **Index** — `memory index` rebuilds the unified FTS5 database (auto-triggered by PostToolUse hook on memory-doc changes)
4. **Query** — Pre-Flight Brief queries `index.db` across all 5 doc types at workflow start
5. **Inject** — Brief's "Related Operational Lessons" section is lifted into `<learning_context>` for programmer/tester/code-reviewer dispatches

The loop is fully closed — lessons flow from completed work back into future agents.

### Deferred-task tracker

`.devt/state/deferred.md` with `DEF-NNN` ids holds cross-workflow TODOs ("things we said we'd do later"). Captured via `/devt:defer "<title>"` from any workflow. **Exempted from `state reset`** so items survive `/devt:cancel-workflow`. Surfaces in `/devt:status` (count) and `/devt:next` (idle pickup via AskUserQuestion). Distinct from the memory layer — deferred items are transient TODOs, not curator-gated, not in Pre-Flight Brief noise.

### Questioning protocol

`references/questioning-guide.md` defines how `/devt:clarify` and `/devt:specify` interview users. Key principles:

- **Before You Ask** — codebase-first: grep/Read/`memory query` before any question; only ask about decisions requiring user judgment
- **Walk the Decision Tree** — resolve roots before dependents, cut subtrees on root answers
- **One at a Time** — AskUserQuestion supports up to 4 questions per call but discipline says use 1; each answer reframes the next
- **Recommendation Required** — every option carries validated reasoning; mark recommended option `(Recommended)` and place first

### The council — adversarial peer review for high-stakes decisions

`/devt:council "<question>"` convenes 5 advisors in parallel, each with a distinct thinking style designed to create three natural tensions: **Contrarian ⇄ Generalizer** (downside vs upside), **First Principles ⇄ Pragmatist** (rethink vs ship), with **the Newcomer** keeping everyone honest by reading the question fresh and asking obvious questions.

| Advisor | Lens | Asks |
|---|---|---|
| **Contrarian** | What's the worst case? | "What breaks under load? What's the on-call cost when this fails? Have we hit this class of bug before?" |
| **First Principles Thinker** | What does the problem actually require? | "Strip away the current solution — what are we really trying to do? Is there a simpler primitive?" |
| **Generalizer** | What latent value or pattern fits? | "Have other teams solved this? Can this become a reusable pattern? What does the broader literature say?" |
| **Newcomer** | What's obvious that everyone missed? | "Why does this even need to exist? What would a junior dev assume? What's the simplest thing that could work?" |
| **Pragmatist** | What's the smallest concrete next step? | "Even if the plan is brilliant, what do we actually do tomorrow morning? What's the 30-min experiment that de-risks this?" |

After advisors respond in parallel, responses are anonymized and **peer-reviewed** (no advisor knows who said what). A **Chairman** then synthesizes the round into a verdict: consensus, conflicts, blind spots, a recommendation, and one concrete next step. The full transcript saves to `.devt/state/council-{slug}-{timestamp}.md` for later reference.

**When the council fires:**

- **Manually** — invoke `/devt:council "should we use Postgres or Mongo for this workload?"` whenever you suspect your first instinct is biased.
- **Automatically (off-ramp)** — `references/council-offramp.md` defines the escalation criteria. `/devt:clarify` and `/devt:specify` route to council when an open question is high-stakes (architecture-shaping, expensive-to-reverse, or has 3+ defensible options with no clear winner). The off-ramp sequence is: clarify → if council-worthy → council → resume clarify with the council verdict as decision input.
- **`--mixed-models` flag** — dispatches advisors across opus/sonnet/haiku for higher reasoning diversity at extra token cost. Default is single-model dispatch.

The council deliberately does NOT fire for trivial questions (factual lookups, single-line fixes, syntax). The skill description's trigger boundary keeps it from being a hammer for every nail.

### Hooks & guardrails

devt uses Claude Code hooks for lifecycle events. Hook profile control via `DEVT_HOOK_PROFILE=minimal|standard|full`. Disable individual hooks with `DEVT_DISABLED_HOOKS=name1,name2`.

Guardrails (`guardrails/`) include: contamination guidelines, generative-debt checklist, golden rules, incident runbook, skill-update guidelines.

---

---

## How it works (architecture)

```
User → Command (thin) → Workflow (orchestration) → Agent (worker)
                                                  ↓
                                            .devt/state/  (artifacts)
                                            .devt/memory/ (permanent knowledge)
```

The execution model follows a **Command → Workflow → Agent** architecture:

- **Commands** (32 files): thin entry points. Parse arguments, delegate to a workflow. No business logic.
- **Workflows** (31 files): orchestration. Determine tier, coordinate agents, manage state transitions.
- **Agents** (10 files): focused workers. Each owns one concern.
- **Skills** (16 directories): technique libraries injected into agents (codebase scanning, complexity assessment, TDD patterns, verification patterns, memory curation, Graphify helpers, …).
- **Hooks** (7 lifecycle events): SessionStart, Stop, SubagentStart, SubagentStop, PostToolUse, PreToolUse, UserPromptSubmit. Profile-controlled (`DEVT_HOOK_PROFILE=minimal|standard|full`).

### Workflow tiers

`/devt:workflow` auto-selects a tier based on task complexity:

| Tier         | Pipeline                                                                                    | Auto-detected when                    |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| **TRIVIAL**  | execute inline → validate gates                                                             | ≤3 files, no decisions needed         |
| **SIMPLE**   | implement → test → review                                                                   | Single file, known pattern            |
| **STANDARD** | scan → implement → test → review → verify → docs → retro → autoskill                        | Multiple files, existing patterns     |
| **COMPLEX**  | auto-research → auto-plan → scan → architect → implement → test → review → verify → docs → retro → curate → autoskill | New patterns, architectural decisions |

You never need to pick a tier. Override the auto-detection if needed.

### Agent–skill mapping

Skills inject into agents at dispatch time based on `skill-index.yaml` (or `.devt/config.json` overrides):

| Agent           | Default Skills                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| programmer      | codebase-scan, scratchpad, api-docs-fetcher, strategic-analysis, tdd-patterns, verification-patterns    |
| tester          | scratchpad, tdd-patterns                                                                                |
| code-reviewer   | code-review-guide, codebase-scan, scratchpad                                                            |
| docs-writer     | scratchpad                                                                                              |
| architect       | codebase-scan, architecture-health-scanner, api-docs-fetcher, strategic-analysis, complexity-assessment |
| verifier        | codebase-scan, verification-patterns                                                                    |
| researcher      | codebase-scan, strategic-analysis                                                                       |
| debugger        | codebase-scan                                                                                           |
| retro           | lesson-extraction, autoskill                                                                            |
| curator         | memory-curation, autoskill                                                                              |

### The `.devt/rules/` convention

Every project configured with devt gets a `.devt/rules/` directory containing project-specific rules that agents read at execution time. This keeps the plugin generic while giving agents deep project knowledge.

**Required files:**

| File                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `coding-standards.md` | Language conventions, naming, formatting, import rules |
| `testing-patterns.md` | Test framework, patterns, coverage expectations        |
| `quality-gates.md`    | Lint, typecheck, test commands and pass criteria       |
| `architecture.md`     | Layer structure, dependency rules, module boundaries   |

**Optional files:** `review-checklist.md`, `api-changelog.md`, `documentation.md`, `git-workflow.md`, `golden-rules.md`, `patterns/common-smells.md`.

Run `/devt:init` to generate these from a template matched to your stack. Available templates: `python-fastapi`, `go`, `typescript-node`, `vue-bootstrap`, `blank`.

---

---

## The problem it solves

Standard AI coding has three concrete failure modes that compound over time:

### 1. Amnesia between sessions

A monolithic prompt forgets every architectural decision the moment the context window rolls over. You end up re-explaining "we use Argon2id for hashing, never bcrypt" in every session, and the AI silently re-proposes rejected approaches.

**devt fixes this** with a permanent memory layer at `.devt/memory/` — markdown docs with strict frontmatter, FTS5-indexed, queried at every workflow start. REJ tombstones suppress re-proposals across all agents.

### 2. Surface understanding, no judgment

A single prompt either over-engineers a one-line fix or under-thinks a refactor. There's no orchestration that matches effort to complexity.

**devt fixes this** with auto-tier selection. TRIVIAL tasks run inline; STANDARD tasks add scan/test/review; COMPLEX tasks add research, plan, architecture review, verification, and curated lesson capture. You never pick a tier — devt detects it.

### 3. No accumulating expertise

Even within a single project, lessons are lost the moment a session ends. The team's hard-won "the integration tests fail when fixture seed order changes" insight gets re-discovered three weeks later.

**devt fixes this** with a closed learning loop: retro extracts → curator gates approval → LES-NNNN docs land in `.devt/memory/lessons/` → Pre-Flight Brief surfaces them at the next workflow start. Knowledge accumulates instead of evaporating.

---

---

## Reference

### Commands

**Primary (start here):**

| Command          | Description                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `/devt:do`       | Don't know which command? Describe what you want — devt routes to the right one                         |
| `/devt:workflow` | Build, fix, or improve anything. Supports `--autonomous`, `--tdd`, `--dry-run`                           |
| `/devt:specify`  | Define a feature through interview and codebase analysis — produces a validated PRD                      |
| `/devt:debug`    | Investigate and fix a bug with 4-phase systematic debugging                                              |
| `/devt:ship`     | Create PR with auto-generated description from workflow artifacts                                        |
| `/devt:next`     | Auto-detect where you are and run the next logical step                                                  |

**Setup & help:** `/devt:init`, `/devt:help`.

**Utilities:** `/devt:status`, `/devt:pause`, `/devt:forensics`, `/devt:cancel-workflow`, `/devt:note`, `/devt:defer`, `/devt:health`, `/devt:session-report`, `/devt:update`, `/devt:thread`, `/devt:weekly-report`, `/devt:council`.

**Internal (called by workflows, available to power users):** `/devt:plan`, `/devt:research`, `/devt:clarify`, `/devt:implement`, `/devt:fast`, `/devt:review`, `/devt:quality`, `/devt:retro`, `/devt:arch-health`, `/devt:autoskill`, `/devt:memory`, `/devt:preflight`.

### CLI tools

`bin/devt-tools.cjs` is a zero-dependency Node.js CLI for state management and diagnostics:

```bash
# State + config + setup + models
node bin/devt-tools.cjs state read|update|reset|validate|sync|prune
node bin/devt-tools.cjs config get|set
node bin/devt-tools.cjs models get|resolve|list|table <profile>
node bin/devt-tools.cjs setup --template <name> [--mode create|update|reinit]

# Memory layer
node bin/devt-tools.cjs memory init|index|validate
node bin/devt-tools.cjs memory query <terms> [--doc-type=decision|concept|flow|rejected|lesson]
node bin/devt-tools.cjs memory get|affects|affects-symbol|list|links|active|orphans|stale-links
node bin/devt-tools.cjs memory paths [--validate]
node bin/devt-tools.cjs memory diff <root-a> <root-b>
node bin/devt-tools.cjs memory bundle export|import

# Pre-Flight Brief
node bin/devt-tools.cjs preflight "<topic>"

# Deferred TODO tracker
node bin/devt-tools.cjs deferred add "<title>" [--context=… --tags=a,b --by=<agent>]
node bin/devt-tools.cjs deferred list|get|close|reopen|count

# Diagnostics + reports + telemetry
node bin/devt-tools.cjs health [--repair]
node bin/devt-tools.cjs report window|generate
node bin/devt-tools.cjs token-report [--sessions=N --baseline=PATH --compare=PATH]
node bin/devt-tools.cjs mcp-stats [--since=DATE --tool=NAME]

# Updates
node bin/devt-tools.cjs update check|status|local-version|install-type|dirty|clear-cache|changelog
```

### Hooks

| Event              | What it does                                          |
| ------------------ | ----------------------------------------------------- |
| `SessionStart`     | Registers commands, checks for updates, loads context |
| `Stop`             | Cleans up workflow state                              |
| `SubagentStart`    | Tracks agent dispatch                                 |
| `SubagentStop`     | Tracks agent completion                               |
| `PostToolUse`      | Context monitoring + memory auto-index (debounced)    |
| `PreToolUse`       | Prompt guard (Write/Edit), pre-flight guard           |
| `UserPromptSubmit` | Injects workflow context and statusline               |

Profile control: `DEVT_HOOK_PROFILE=minimal|standard|full`. Disable specific: `DEVT_DISABLED_HOOKS=context-monitor,read-before-edit-guard`.

### Directory structure

```
devt/
  .claude-plugin/        Plugin manifest
  bin/
    devt-tools.cjs       CLI entry point
    devt-memory-mcp.cjs  Vendored read-only MCP server (10 tools, JSON-RPC stdio)
    modules/             init, state, config, model-profiles, setup, memory, preflight,
                         discovery, graphify, deferred, mcp-stats, token-report,
                         security, health, weekly-report, update, cli-args, io
  commands/              Slash command entry points (32 files)
  workflows/             Orchestration files (31 files)
  agents/                Agent definitions (10 files; 3 agents bundle sub-skill subdirectories)
  skills/                Skill libraries (16 directories)
  hooks/                 Lifecycle hook scripts + hooks.json
  guardrails/            Protective guidelines
  references/            Technique libraries (questioning guide, domain probes, council offramp)
  scripts/               smoke-test.sh, test-locking.cjs, extract-changelog.sh
  templates/             Project templates (python-fastapi, go, typescript-node, vue-bootstrap, blank)
                         + memory/ (ADR/CON/FLOW/REJ/LES frontmatter scaffolds)
  .github/workflows/     CI: smoke-test on Node 22/24, version coherence,
                         CHANGELOG coverage, tag-driven GitHub releases
  skill-index.yaml       Agent-to-skill mapping
```

### Troubleshooting

**Workflow fails or gets stuck:**
- `/devt:status` — see current state
- `/devt:forensics` — post-mortem investigation
- `/devt:cancel-workflow` — reset and start over
- Check `.devt/state/` for artifact details

**Plugin health issues:**
- `/devt:health` — diagnose (21 checks across config, state, hooks, memory)
- `/devt:health --repair` — auto-fix safe issues

**Missing `.devt/rules/`:**
- `/devt:init` — set up project conventions

**Agent returns BLOCKED:**
- Read agent's output in `.devt/state/<phase>-summary.md` — task may need to be broken down or clarified

**Memory layer not surfacing expected docs:**
- `node bin/devt-tools.cjs memory validate` — check frontmatter / stale paths / broken links
- `node bin/devt-tools.cjs memory index` — rebuild the FTS5 index
- `/devt:health` — surfaces `MEM_INDEX_STALE`, `MEM_PATH_UNREACHABLE`, `MEM_VALIDATE_ERRORS`, `MEM_CONFLICT_HIGH`

### Where to read more

- **`docs/MEMORY.md`** — comprehensive memory-layer guide (frontmatter reference, authoring conventions, troubleshooting)
- **`docs/COMMANDS.md`** — full command reference
- **`guardrails/golden-rules.md`** — Rules 14 (Pre-Flight Protocol) and 15 (Memory Maintenance)
- **`skills/memory-pre-flight/SKILL.md`** — the protocol skill loaded by all 8 dev agents
- **`skills/memory-curation/SKILL.md`** — the curator's promotion gate
- **`templates/memory/`** — ADR/CON/FLOW/REJ/LES scaffolds for new docs
- **[CHANGELOG.md](CHANGELOG.md)** — full version history

---

---

## Releases & contributing

### Updating

```bash
/devt:update
```

devt checks for new versions on GitHub at each session start. The `/devt:update` command auto-detects how devt was installed (plugin system or git clone) and runs the right update command. Restart your Claude Code session after updating.

Manual update: `cd ~/.devt && git pull origin main`.

### Releases

Releases are published at [emrecdr/devt/releases](https://github.com/emrecdr/devt/releases). Each version follows [Semantic Versioning](https://semver.org/) and has a matching `## [X.Y.Z]` section in [CHANGELOG.md](CHANGELOG.md), formatted per [Keep a Changelog](https://keepachangelog.com/).

The release flow is tag-driven: pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which extracts the changelog section via `scripts/extract-changelog.sh` and creates the GitHub release automatically. CI enforces that `VERSION`, `plugin.json` version, and the changelog all stay in lock-step — a version bump without a matching changelog entry fails the build.

### License

MIT
