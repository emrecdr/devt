# devt

**devt** (short for **dev**elopment **t**eam) — a multi-agent development workflow plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

[![Version](https://img.shields.io/github/v/tag/emrecdr/devt?sort=semver&label=version&color=blue)](https://github.com/emrecdr/devt/releases)
[![CI](https://github.com/emrecdr/devt/actions/workflows/ci.yml/badge.svg)](https://github.com/emrecdr/devt/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22%2B-brightgreen)](https://nodejs.org)
[![Changelog](https://img.shields.io/badge/changelog-keep%20a%20changelog-orange)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## What is devt?

A Claude Code plugin that orchestrates a coordinated **multi-agent** development workflow: **implement → test → review → document → learn**. Instead of relying on a single monolithic prompt, devt decomposes work across specialized agents — a programmer writes code, a tester verifies it, a code-reviewer audits it, a docs-writer updates documentation, and a retro agent extracts lessons for future sessions. Each agent is focused, stateless, and replaceable.

The plugin is **language-agnostic** — Python, Go, TypeScript, Vue, or anything else. Project-specific coding standards, testing patterns, quality gates, and architecture rules live in your repository under `.devt/rules/`, not baked into the plugin.

**What you get out of the box:**

- **Auto-complexity detection** — analyzes your task and selects the right pipeline (TRIVIAL through COMPLEX)
- **10 specialized agents** — programmer, tester, code-reviewer, docs-writer, architect, retro, curator, verifier, researcher, debugger — plus the opt-in **devt-coordinator** main-thread router (see [Main-thread coordinator](#main-thread-coordinator-opt-in))
- **Closed learning loop** — lessons extracted from each workflow feed back into future sessions
- **Permanent memory layer** — ADR/CON/FLOW/REJ/LES knowledge graph that survives session boundaries
- **Topic Pre-Flight Brief** — every workflow surfaces governing decisions, rejected approaches, related lessons, and blast radius before touching code
- **Autonomous chaining** — implement → test → review → ship without manual `/devt:next` invocations
- **Test-driven flag** — `--tdd` reverses implement/test phase order
- **Architecture health scanning** — detect drift across sessions with baseline diffing
- **Adversarial council** — 5-advisor pressure-test for high-stakes decisions
- **Deferred-task tracker** — capture mid-work TODOs without derailing current focus

---

## Install

### devt

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

### Recommended dependencies

devt itself is **zero-npm-dependency** — Node 22+, bash, and Claude Code are the only required tools. Three optional integrations plug into specific pipelines and add measurable benefits. Each is auto-detected on PATH; if absent, devt falls back to grep / scratchpad markers.

#### Graphify — multi-language AST anchoring (~10× lower token cost on code-search)

**Repo:** [github.com/safishamsi/graphify](https://github.com/safishamsi/graphify)

```bash
uv tool install graphifyy[mcp]   # recommended — works for both CLI and MCP server
# alternatives:
# pipx install graphifyy[mcp]
# pip install graphifyy[mcp]     # CLI works; MCP server still requires uv on PATH
```

Tree-sitter multi-language parser that binds memory docs to actual functions/classes. Used by 6 of 10 dev agents (programmer, debugger, researcher, code-reviewer, verifier, architect), Pre-Flight Brief Lane C, blast-radius queries, and `memory validate` stale-symbol detection. See [Features in detail → Graphify](#graphify-deep-dive) for the surface-by-surface benefit comparison.

#### uv — fast Python package manager

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Required for Graphify v0.7.10+ — its MCP server launches via `uv run --with graphifyy --with mcp -m graphify.serve`. Without `uv`, devt scaffolds a `python3 -m graphify.serve` fallback only when graphifyy is importable from your system Python.

#### claude-mem — mid-session insight capture

**Repo:** [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — see their docs for install.

Captures ⚖️ (decisions) and 🔵 (insights) tags during sessions. devt's discovery harvester (`bin/modules/discovery.cjs::harvest()`) mines these into curator-reviewable proposals at `.devt/memory/_suggestions.md`. The curator agent gates each candidate via AskUserQuestion before promoting to permanent memory. Without claude-mem, discovery still works on `#KNOWLEDGE-CANDIDATE` scratchpad markers and DEC-xxx entries — you get fewer auto-surfaced ADR/CON candidates but nothing breaks.

---

## Quick start

```bash
/devt:init
```

Scaffolds `.devt/rules/` with project-specific conventions and creates `.devt/config.json`. devt auto-detects your stack and selects the matching template (python-fastapi, go, typescript-node, vue-bootstrap, or blank). The wizard pitches optional integrations and confirms detected primary branch. Declining still produces a fully working install.

**Your first workflow:**

```bash
/devt:workflow "add a health check endpoint at GET /health returning 200"
```

`/devt:workflow` is the primary entry. devt analyzes the task, picks a complexity tier (TRIVIAL / SIMPLE / STANDARD / COMPLEX), and runs the matching pipeline. If you don't know which command to use, `/devt:do "describe what you want"` routes for you.

**Task format**: imperative verb + specific outcome.

- ✓ `"add health check endpoint at GET /health returning 200 with status ok"`
- ✓ `"fix login validation that accepts empty passwords"`
- ✗ `"make it better"` — too vague
- ✗ `"refactor everything"` — too broad

---

## Basic configuration

`.devt/config.json` (project root) configures plugin behavior. Only set what you want to override — defaults handle the rest. Five keys cover most needs:

```json
{
  "model_profile": "quality",
  "memory": { "preflight_mode": "block" },
  "graphify": { "enabled": true },
  "scope_mode": "surgical",
  "git": { "primary_branch": "main", "contributors": ["alice", "bob"] }
}
```

| Key | What it controls | Default |
|---|---|---|
| `model_profile` | Per-agent model tier — `quality` / `balanced` / `budget` / `inherit` | `quality` |
| `memory.preflight_mode` | Pre-flight guard strictness — `off` / `warn` / `block` | `block` |
| `graphify.enabled` | Enable AST-anchored code search | `false` (auto-set to `true` if `graphify` is on PATH at first setup) |
| `scope_mode` | How agents handle unrelated findings — `surgical` (ask first) / `boyscout` (small mechanical fixes ok) | `surgical` |
| `rubrics.<workflow_type>` | Pinned verifier rubric filename per workflow_type. Two workflows dispatch the verifier today: `dev` (default `dev.v1.md`) and `code_review` (default `code_review.v1.md`). Bump to a newer version after testing — devt ships old rubrics alongside new ones, so projects can pin or roll back independently. | `{dev: "dev.v1.md", code_review: "code_review.v1.md"}` |
| `git.primary_branch` / `git.contributors` | Used by `/devt:ship` and reports | auto-detected |

For the full schema (model_overrides, agent_skills, multi-root memory, arch_scanner, workflow toggles), see [Configuration reference](#configuration-reference).

---

## Day-to-day usage

The 80% of devt usage centers on a small set of commands. Each handles a distinct intent:

### `/devt:workflow` — the primary entry

```bash
/devt:workflow "add OAuth login flow"          # auto-tier, full pipeline
/devt:workflow --autonomous "<task>"            # implement → test → review → ship without prompts
/devt:workflow --tdd "<task>"                   # test-first: write tests, watch them fail, then implement
/devt:workflow --dry-run "<task>"               # preview the pipeline without executing
```

devt picks a tier based on task analysis. You never need to choose. Override only if needed.

### `/devt:do` — when you're not sure which command

```bash
/devt:do "fix the failing auth tests"
```

Routes the freeform description to the right command (workflow, debug, review, plan, etc.). Useful when you'd otherwise stare at the command list.

### <a name="main-thread-coordinator-opt-in"></a>Main-thread coordinator (opt-in)

If you'd rather not type `/devt:do` on every prompt, devt ships an opt-in **main-thread coordinator** that runs in front of your session and does the same routing automatically — but only when the prompt is devt-shaped. Casual questions and conversation pass through to a normal Claude session.

Opt in by adding one line to your project's `.claude/settings.json`:

```json
{
  "agent": "devt-coordinator"
}
```

Or invoke ad-hoc for a single session:

```bash
claude --agent devt-coordinator
```

After opting in, every prompt is classified:

- **Devt-shaped task** (e.g. "fix the 405 on POST /admin", "review my changes", "ship this") → routed to the matching `/devt:*` command via Skill tool. Same routing table as `/devt:do`.
- **Casual / general** (e.g. "explain quicksort", "thanks", "what's a closure?") → answered directly. No routing nag.
- **Ambiguous** → asked once, with an "answer directly" bail-out option.

The agent body lives at `agents/devt-coordinator.md`. Read it before opting in if you want to see the exact classification protocol.

**Caveat (Claude Code plugin agent security restriction):** plugin agents cannot define their own `hooks`, `mcpServers`, or `permissionMode` frontmatter. If you need any of those per-coordinator, copy `agents/devt-coordinator.md` into your project's `.claude/agents/` and use that copy — the personal copy is unrestricted. Devt's plugin-level hooks and the devt-memory MCP server still fire normally either way.

### `/devt:debug` — systematic debugging

```bash
/devt:debug "login form silently fails on Safari mobile"
```

Four-phase investigation (Symptom → Hypothesis → Test → Fix) in an isolated context, so root-cause work doesn't pollute your main session. Persists state across context resets.

### `/devt:next` — auto-resume from anywhere

```bash
/devt:next
```

Reads `.devt/state/`, detects what just happened (workflow paused, review found issues, deferred queue has items, etc.), and runs the appropriate next step. The "I forgot what I was doing" command.

### `/devt:ship` — create the PR

```bash
/devt:ship
```

Runs after a workflow completes. Reads `impl-summary.md`, `test-summary.md`, `review.md`, and creates a PR with auto-generated title + body. Handles uncommitted changes, branch detection, and CI status.

### Common flow examples

**Build something end-to-end (most common):**
```bash
/devt:workflow "add password reset endpoint with email verification"
# devt does: scan → implement → test → review → verify → docs → retro → autoskill
/devt:ship
```

**TDD a small change:**
```bash
/devt:workflow --tdd "add validation rejecting passwords shorter than 12 chars"
# tests get written first and watched to fail before implementation runs
```

**Fix a bug:**
```bash
/devt:debug "users report 500 on /api/profile after upload"
# isolated investigation; produces debug-summary.md with root cause + fix
```

**Pause mid-work, resume next session:**
```bash
/devt:pause
# next session in same project:
/devt:next   # reads handoff.json, resumes
```

**Capture a TODO without derailing:**
```bash
/devt:defer "rate-limit /api/login — Redis backend, see SEC-007"
# survives /devt:cancel-workflow; surfaces in /devt:next when idle
```

**High-stakes architectural decision:**
```bash
/devt:council "should we move from REST to GraphQL for the public API?"
# 5 advisors in parallel + peer review + chairman synthesis → verdict + next step
```

For detailed walkthroughs, see [Workflows & use cases in detail](#workflows--use-cases-in-detail).

---

## Why devt?

Standard AI coding has three concrete failure modes that compound over time.

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
- **Agents** (11 files): 10 focused workers (programmer/tester/code-reviewer/docs-writer/architect/retro/curator/verifier/researcher/debugger) plus the opt-in `devt-coordinator` main-thread router.
- **Skills** (16 directories): technique libraries injected into agents (codebase scanning, complexity assessment, TDD patterns, verification patterns, memory curation, Graphify helpers, …).
- **Hooks** (7 lifecycle events): SessionStart, Stop, SubagentStart, SubagentStop, PostToolUse, PreToolUse, UserPromptSubmit. Profile-controlled (`DEVT_HOOK_PROFILE=minimal|standard|full`).

### Workflow tiers

`/devt:workflow` auto-selects a tier based on task complexity:

| Tier         | Pipeline                                                                                                              | Auto-detected when                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **TRIVIAL**  | execute inline → validate gates                                                                                       | ≤3 files, no decisions needed         |
| **SIMPLE**   | implement → test → review                                                                                             | Single file, known pattern            |
| **STANDARD** | scan → implement → test → review → verify → docs → retro → autoskill                                                  | Multiple files, existing patterns     |
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

Every devt-configured project gets a `.devt/rules/` directory containing project-specific rules that agents read at execution time. This keeps the plugin generic while giving agents deep project knowledge.

**Required files:**

| File                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `coding-standards.md` | Language conventions, naming, formatting, import rules |
| `testing-patterns.md` | Test framework, patterns, coverage expectations        |
| `quality-gates.md`    | Lint, typecheck, test commands and pass criteria       |
| `architecture.md`     | Layer structure, dependency rules, module boundaries   |

**Optional:** `review-checklist.md`, `api-changelog.md`, `documentation.md`, `git-workflow.md`, `golden-rules.md`, `patterns/common-smells.md`.

Run `/devt:init` to generate these from a template matched to your stack.

---

## Configuration reference

Full schema for `.devt/config.json` (project root). Global `~/.devt/defaults.json` sets user-wide defaults that project config overrides. Merge order: hardcoded defaults → `~/.devt/defaults.json` → `.devt/config.json` (later overrides earlier).

```json
{
  "model_profile": "quality",
  "model_overrides": { "tester": "opus" },
  "git": {
    "provider": "github", "workspace": "my-team", "slug": "my-repo",
    "primary_branch": "main", "contributors": ["alice", "bob"]
  },
  "agent_skills": { "programmer": ["codebase-scan", "scratchpad", "api-docs-fetcher"] },
  "memory": {
    "paths": ["../engineering-adrs", ".devt/memory"],
    "preflight_mode": "block",
    "enabled": true,
    "auto_index_on_change": true
  },
  "graphify": { "enabled": true, "command": "graphify" },
  "arch_scanner": { "command": "make arch-scan", "report_dir": "docs/reports" },
  "scope_mode": "surgical",
  "workflow": {
    "docs": true, "retro": true, "verification": true,
    "autoskill": true, "regression_baseline": true
  }
}
```

| Key | Values | Default |
|---|---|---|
| `model_profile` | `quality` / `balanced` / `budget` / `inherit` | `quality` |
| `model_overrides` | Per-agent model tier (opus / sonnet / haiku / inherit) | from `model_profile` |
| `git.provider` | `github` / `gitlab` / `bitbucket` | auto-detect from remote |
| `git.workspace` / `git.slug` | Repo identifiers (used by `/devt:ship`) | auto-detect |
| `git.primary_branch` | Integration branch | 4-step fallback chain (`origin/HEAD` → `init.defaultBranch` → common-name heuristic → current branch) |
| `git.contributors` | Display names for `/devt:weekly-report` | git log scan |
| `agent_skills` | Per-agent skill list overrides | see `skill-index.yaml` |
| `memory.paths` | Multi-root memory roots — last-wins precedence | project-local only |
| `memory.preflight_mode` | Pre-flight guard hook strictness — `off` / `warn` / `block` | `block` |
| `memory.enabled` | Master switch — disables Pre-Flight Brief, discovery harvester, auto-index hook, pre-flight guard hook | `true` |
| `memory.auto_index_on_change` | PostToolUse hook rebuilds FTS5 index when memory docs touched | `true` |
| `graphify.enabled` | Boolean | `false` (auto-set to `true` by `setup.cjs` when `graphify` is on PATH at first setup) |
| `graphify.command` | Binary name | `graphify` |
| `arch_scanner.command` | Architecture scanner invocation | `null` (manual analysis) |
| `arch_scanner.report_dir` | Where scan output lands | `docs/reports` |
| `scope_mode` | `surgical` / `boyscout` — see below | `surgical` |
| `workflow.docs` / `.retro` / `.verification` / `.autoskill` / `.regression_baseline` | Toggle pipeline steps | all `true` |

### `scope_mode` — surgical (default) vs boy-scout

Controls how agents handle *unrelated* findings discovered while doing the requested task — dead imports, lint warnings, cosmetic issues in files they're touching anyway.

| Mode | Behavior | When to pick |
|---|---|---|
| **`surgical`** (default) | Find-Surface-Decide protocol per `golden-rules.md` Rule 5: agent **finds** the unrelated issue, **surfaces** it (in impl-summary or `defer add`), and **does NOT fix it** without explicit approval. Keeps PRs reviewable. | Production codebases, regulated environments, anywhere PR diff hygiene matters, code-review handoffs |
| **`boyscout`** | Blanket authority for small mechanical in-file cleanups (dead imports, formatter fixes, removing `console.log`) without asking — *only* in files the agent is already touching, and *only* for behavior-preserving changes. Bigger findings still go through Find-Surface-Decide. | Personal projects, prototypes, fast-moving codebases, individual contributors who own the diff |

The setting is **declarative** — no enforcement code reads it. Agents self-regulate based on the rule body and the resolved value in their context.

### Hook profile

`DEVT_HOOK_PROFILE=minimal|standard|full` (env var, default `standard`) controls which hooks fire:

| Hook | minimal | standard | full |
|---|:---:|:---:|:---:|
| `session-start.sh` | ✓ | ✓ | ✓ |
| `stop.sh` | ✓ | ✓ | ✓ |
| `workflow-context-injector.sh` | – | ✓ | ✓ |
| `subagent-status.sh` | – | ✓ | ✓ |
| `read-before-edit-guard.sh` | – | ✓ | ✓ |
| `context-monitor.sh` | – | – | ✓ |
| `prompt-guard.sh` | – | – | ✓ |

Disable specific hooks: `DEVT_DISABLED_HOOKS=hook1.sh,hook2.sh`.

---

## Features in detail

### The memory layer — bridges three sources of truth

A self-evolving knowledge graph that joins:

1. **The code that exists** — what functions, classes, modules actually live in the repo (Graphify AST). When the graph is built, `graphify-out/GRAPH_REPORT.md` god-nodes also seed concept (CON-*) candidates and feed the Pre-Flight Brief's Cross-Cutting Concerns section so structural couplings surface before any change starts.
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

#### Memory CLI — full subcommand reference

```bash
node bin/devt-tools.cjs memory init                              # scaffold .devt/memory/{decisions,concepts,flows,rejected,lessons}/
node bin/devt-tools.cjs memory index                             # rebuild FTS5 index from markdown
node bin/devt-tools.cjs memory query <terms> [--doc-type=…]      # full-text search
node bin/devt-tools.cjs memory get <id>                          # fetch by id (e.g. ADR-007)
node bin/devt-tools.cjs memory list [--doc-type=… --status=…]    # filtered listing
node bin/devt-tools.cjs memory active [--domain=…]               # active docs only
node bin/devt-tools.cjs memory affects <glob>                    # docs governing path
node bin/devt-tools.cjs memory affects-symbol <symbol>           # docs governing symbol
node bin/devt-tools.cjs memory links <id> [--depth=N]            # transitive link traversal
node bin/devt-tools.cjs memory orphans                           # docs with no inbound links
node bin/devt-tools.cjs memory stale-links                       # broken wiki-link targets
node bin/devt-tools.cjs memory rejected-keywords                 # all REJ search_keywords (used for AI suppression)
node bin/devt-tools.cjs memory validate                          # frontmatter + path + symbol checks
node bin/devt-tools.cjs memory paths [--validate]                # multi-root path config inspection
node bin/devt-tools.cjs memory diff <root-a> <root-b>            # cross-root diff
node bin/devt-tools.cjs memory bundle export --out=… --filter=…  # portable JSON export
node bin/devt-tools.cjs memory bundle import <file> [--prefix=…] # import with optional ID remap
```

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

### Workflow modes

`/devt:workflow` accepts flags that modify pipeline shape:

| Flag | What it does |
|---|---|
| `--autonomous` | Skip the human-in-the-loop checkpoints between phases. After implement → auto-runs test → review → ship if review passes. State key `autonomous_chain` persists the choice across `/devt:next` resumes. Stop manually with `/devt:cancel-workflow`. |
| `--tdd` | Reverses implement/test phase order. Tester writes failing tests first against the spec, programmer then implements until tests pass. Best for tasks where the test contract is clearer than the implementation path. |
| `--dry-run` | Preview the tier + pipeline + agents that would run, without dispatching any. Useful for understanding what `/devt:workflow` will do on a fragile task before committing. |

### Closed learning loop

devt captures and reuses knowledge across sessions:

1. **Extract** — retro agent distills lessons (4-filter quality gate) → `.devt/state/lessons.yaml`
2. **Curate** — curator agent applies the 5-filter (Specificity, Durability, Non-obviousness, Evidence, Actionability) and presents AskUserQuestion per candidate → on approval, writes `.devt/memory/lessons/LES-NNNN-slug.md`
3. **Index** — `memory index` rebuilds the unified FTS5 database (auto-triggered by PostToolUse hook on memory-doc changes)
4. **Query** — Pre-Flight Brief queries `index.db` across all 5 doc types at workflow start
5. **Inject** — Brief's "Related Operational Lessons" section is lifted into `<learning_context>` for programmer/tester/code-reviewer dispatches

The loop is fully closed — lessons flow from completed work back into future agents.

### Architecture health scanning

`/devt:arch-health` runs the project's architecture scanner (configured via `arch_scanner.command`) and detects structural drift across sessions:

- **Baseline mode** — first run captures the current state to `.devt/state/arch-baseline.json`
- **Delta mode** — subsequent runs compare against baseline, surfacing only NEW violations (no noise from pre-existing debt)
- **Triage mode** — interactive review of findings via AskUserQuestion: fix now, defer (`/devt:defer`), or accept-as-baseline

The python-fastapi reference template ships an `arch-scan.py` that detects 6 layer-violation patterns (LAYER-IMPORT-DOMAIN, LAYER-IMPORT-API, DB-IN-APPLICATION, INLINE-IMPORT, GOD-FILE, …). Other templates can wire any scanner — output must be JSON with a `findings` array.

### Quality gates

`/devt:quality` runs lint, typecheck, and tests as defined in `.devt/rules/quality-gates.md`. The rules file specifies the exact commands and pass criteria for your stack — devt has no opinion. Agents read this file before reporting "tests passing" so the claim is grounded in your project's actual gates, not assumptions.

### Deferred-task tracker

`.devt/state/deferred.md` with `DEF-NNN` ids holds cross-workflow TODOs ("things we said we'd do later"). Captured via `/devt:defer "<title>"` from any workflow. **Exempted from `state reset`** so items survive `/devt:cancel-workflow`. Surfaces in `/devt:status` (count) and `/devt:next` (idle pickup via AskUserQuestion). Distinct from the memory layer — deferred items are transient TODOs, not curator-gated, not in Pre-Flight Brief noise.

### Threads — cross-session investigation context

`/devt:thread` creates persistent investigation contexts that survive session boundaries. Useful for multi-day debugging or research where the trail can't fit in one session. Subcommands: `create`, `list`, `resume`, `update`. Each thread has its own scratch + decision log; reading a thread restores the full context cheaply.

### Notes — zero-friction idea capture

`/devt:note "<thought>"` saves a freeform note without derailing your current workflow. Notes can later be promoted to deferred items, memory candidates, or just deleted. The "I'll forget this if I keep coding" mechanism.

### Forensics — workflow post-mortem

`/devt:forensics` analyzes a stuck or failed workflow's artifacts (`.devt/state/`, git history, recent commits) and diagnoses what went wrong. Useful when `/devt:next` hits a wall and you can't figure out why.

### Autoskill — self-improving skill index

`/devt:autoskill` runs after retro and analyzes the session for patterns: skills that should have been preloaded but weren't, commands that took too many tries, friction points. Proposes additions to `.devt/state/autoskill-proposals.md`. Curator decides what to merge into `skill-index.yaml`. Meta-feature most users won't touch directly.

### Reports

`/devt:weekly-report` generates a markdown summary of git activity for the configured `git.contributors`. Runs against any time window. `/devt:session-report` generates a session summary (work done, commits, decisions, outcomes) without git dependency.

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

### <a name="graphify-deep-dive"></a>Graphify deep dive

For users who installed Graphify, here's the surface-by-surface benefit comparison vs grep fallback:

| Surface | Without Graphify | With Graphify |
|---|---|---|
| Pre-Flight Brief Lane C (symbol resolution) | grep across `affects_symbols` text fields | tree-sitter AST resolution — knows `User` the class differs from `User` the type alias |
| `blast_radius()` MCP tool | Falls back to filename matching | Walks actual import graph via `getNeighbors()` for true impact analysis |
| `memory validate` stale-symbol check | Cannot detect — keeps `affects_symbols: [renamedFn]` after refactor silently | Flags symbols in memory docs that no longer exist in the codebase |
| Code-search agents (programmer/debugger/researcher/code-reviewer/verifier/architect) | grep + path patterns | Graphify-first protocol → ~200–400 tokens per query vs ~3–5K with grep |

Concrete savings vary by codebase size; the ~10× claim is conservative for medium codebases (500+ files).

### Hooks & guardrails

devt uses Claude Code hooks for lifecycle events (see [Configuration reference → Hook profile](#hook-profile) for the matrix).

Guardrails (`guardrails/`): contamination guidelines, generative-debt checklist, golden rules (15 numbered rules including Pre-Flight Protocol and scope_mode protocol), incident runbook, skill-update guidelines.

---

## Workflows & use cases in detail

### Build a feature end-to-end

```bash
/devt:workflow "add password reset endpoint with email verification, rate-limited at 3/hour per email"
```

What runs (STANDARD or COMPLEX tier auto-detected):

1. **Pre-Flight Brief** — surfaces governing ADR/CON/FLOW for auth + email + rate-limiting domains; flags REJ tombstones (e.g., "we said no to bcrypt"); injects related lessons
2. **Scan** (architect or scan agent, COMPLEX only) — maps the affected layers
3. **Implement** (programmer) — writes code following `.devt/rules/coding-standards.md`
4. **Test** (tester) — writes tests per `.devt/rules/testing-patterns.md`; runs `.devt/rules/quality-gates.md` commands
5. **Review** (code-reviewer) — read-only audit per `.devt/rules/review-checklist.md`
6. **Verify** (verifier) — checks the implementation actually meets the original task description
7. **Docs** (docs-writer) — updates README/CHANGELOG/API docs as needed
8. **Retro** — distills lessons → `lessons.yaml` (curator promotes to LES-NNNN later)
9. **Autoskill** — analyzes the session for skill-index improvements

```bash
/devt:ship   # creates PR with auto-generated body from impl-summary + test-summary + review
```

### Test-driven development

```bash
/devt:workflow --tdd "add validation rejecting passwords shorter than 12 chars or with no special character"
```

The `--tdd` flag swaps phase 3 and 4. Tester writes failing tests first, runs them to confirm they fail, then programmer implements until tests pass. Best when the contract is clear (validation rules, parsing logic, pure functions).

### Autonomous chain — implement to ship without prompts

```bash
/devt:workflow --autonomous "rename internal helper getUser → fetchUserById across the codebase"
```

After implement → auto-runs test → review → ship. If review returns `NEEDS_WORK`, the chain pauses for human input. Stop manually with `/devt:cancel-workflow`. Best for mechanical changes where you trust the agents.

### Fix a bug

```bash
/devt:debug "users report 500 on /api/profile after avatar upload — only Safari mobile, only on second upload"
```

Four-phase investigation in an isolated context (the debugger agent has its own conversation lane so root-cause exploration doesn't pollute your main session):

1. **Symptom** — formalize the failure mode, reproduce if possible
2. **Hypothesis** — generate 2–4 candidate causes with falsifiability
3. **Test** — design minimal experiments to distinguish hypotheses
4. **Fix** — apply the fix, verify the symptom is gone, update relevant memory

Persists state across context resets via `memory: project` agent persistence at `.claude/agent-memory/devt-debugger/`.

### Pause and resume

```bash
/devt:pause   # captures: current phase, decisions so far, next action — to handoff.json + continue-here.md
```

Then in a future session in the same project:

```bash
/devt:next   # reads handoff.json, resumes the workflow, deletes the handoff
```

Useful at end of day or when a workflow blocks on an external decision (waiting for stakeholder, blocked by another team).

### Explore the deferred queue

```bash
/devt:defer "rate-limit /api/login — Redis backend, see SEC-007"
/devt:defer list
/devt:defer close DEF-003
```

`/devt:next` surfaces an idle deferred queue via AskUserQuestion when no other work is resumable: "5 deferred items waiting. Pick one to start?" Items survive `/devt:cancel-workflow` (the only state-reset exemption).

### Architectural decision via council

```bash
/devt:council "should we move from REST to GraphQL for the public API? Current REST has ~40 endpoints, mostly CRUD with 5 complex aggregation queries. We have 3 client teams (web, iOS, Android) and concerns about mobile bandwidth."
```

5 advisors respond in parallel (Contrarian, First Principles, Generalizer, Newcomer, Pragmatist), peer-review each other anonymously, and the Chairman synthesizes a verdict. Full transcript saves to `.devt/state/council-rest-vs-graphql-{timestamp}.md` for later reference. Add `--mixed-models` for opus/sonnet/haiku diversity at extra token cost.

### Architecture drift check (over time)

```bash
/devt:arch-health                        # first run: captures baseline
# … weeks pass, code evolves …
/devt:arch-health                        # subsequent run: shows DELTA only (new violations)
/devt:arch-health --triage               # interactive: fix / defer / accept-as-baseline per finding
```

The baseline lives in `.devt/state/arch-baseline.json` so the team can ratchet quality forward without drowning in pre-existing debt noise.

### Reset or uninstall

```bash
/devt:uninstall
```

Interactive workflow that asks which level of reset you want and confirms before any destructive op. Always creates a `.devt.bak.YYYYMMDD-HHMMSS/` backup for project-reset and full-reset modes.

| Mode | What it does | Keeps |
|---|---|---|
| **Reinit** | Re-scaffold `.devt/rules/` + `.devt/config.json` from template | Memory, lessons, deferred queue |
| **Project reset** | Wipe all `.devt/` in this project | Files outside `.devt/` |
| **Full reset** | Wipe `.devt/` + scattered devt files at repo root | Optional Graphify / claude-mem caches |
| **Plugin uninstall** | Remove the plugin itself (advisory — auto-detects install type and instructs) | All project `.devt/` directories |

devt scatters a few files outside `.devt/` (`.mcp.json`, `.claude/agent-memory/devt-debugger/`, `.gitignore` entries, `.git/hooks/post-commit`) because Claude Code and git specs require those paths. The full-reset mode handles all of them.

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

**Setup & help:** `/devt:init`, `/devt:uninstall`, `/devt:help`.

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

# Memory layer (full subcommand reference in Features → memory CLI)
node bin/devt-tools.cjs memory <subcommand>

# Pre-Flight Brief
node bin/devt-tools.cjs preflight "<topic>"

# Deferred TODO tracker
node bin/devt-tools.cjs deferred add "<title>" [--context=… --tags=a,b --by=<agent>]
node bin/devt-tools.cjs deferred list|get|close|reopen|count

# Diagnostics + reports + telemetry
node bin/devt-tools.cjs health [--repair]
node bin/devt-tools.cjs report window|generate
node bin/devt-tools.cjs token-report [--sessions=N --baseline=PATH --compare=PATH --regression --fail-on-regression]
node bin/devt-tools.cjs mcp-stats [--since=DATE --tool=NAME --workflow-id=ID --workflow-type=TYPE --phase=PHASE]

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
| `PreToolUse`       | Prompt guard (Write/Edit), pre-flight guard, bash safety guard (destructive rm, `--no-verify`, force-push, mass-discard) |
| `UserPromptSubmit` | Injects workflow context and statusline               |

Profile control: see [Configuration reference → Hook profile](#hook-profile).

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

**MCP server warnings (`Missing environment variables: CLAUDE_PLUGIN_ROOT`, `unknown command 'mcp'`):**
- Already fixed in current versions. Update via `/devt:update`.

### Where to read more

- **`docs/MEMORY.md`** — comprehensive memory-layer guide (frontmatter reference, authoring conventions, troubleshooting)
- **`docs/COMMANDS.md`** — full command reference
- **`guardrails/golden-rules.md`** — Rules 14 (Pre-Flight Protocol) and 15 (Memory Maintenance)
- **`skills/memory-pre-flight/SKILL.md`** — the protocol skill loaded by all 8 dev agents
- **`skills/memory-curation/SKILL.md`** — the curator's promotion gate
- **`templates/memory/`** — ADR/CON/FLOW/REJ/LES scaffolds for new docs
- **[CHANGELOG.md](CHANGELOG.md)** — full version history

### CI

GitHub Actions runs `scripts/smoke-test.sh` (260+ assertions across all CLI subcommands) and `scripts/test-locking.cjs` (20-worker concurrent state-write test) on every push. Version coherence, CHANGELOG coverage, and `workflow_type` registry coverage are enforced. Releases are tag-driven — push `vX.Y.Z` to fire `.github/workflows/release.yml` which extracts the matching CHANGELOG section into the GitHub release notes.

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
