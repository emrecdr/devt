# devt

**devt** (short for **dev**elopment **t**eam) — a multi-agent development workflow plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

<!-- Primary topic discovery row -->
[![Topic: claude-code](https://img.shields.io/badge/topic-claude--code-7048e8?style=flat-square&logo=github)](https://github.com/topics/claude-code)
[![Topic: claude-code-plugin](https://img.shields.io/badge/topic-claude--code--plugin-7048e8?style=flat-square&logo=github)](https://github.com/topics/claude-code-plugin)
[![Topic: anthropic](https://img.shields.io/badge/topic-anthropic-7048e8?style=flat-square&logo=github)](https://github.com/topics/anthropic)
[![Topic: multi-agent](https://img.shields.io/badge/topic-multi--agent-7048e8?style=flat-square&logo=github)](https://github.com/topics/multi-agent)
[![Topic: ai-development-tools](https://img.shields.io/badge/topic-ai--development--tools-7048e8?style=flat-square&logo=github)](https://github.com/topics/ai-development-tools)

<!-- Tech-stack + secondary discovery row -->
[![Topic: agent-workflow](https://img.shields.io/badge/topic-agent--workflow-7048e8?style=flat-square&logo=github)](https://github.com/topics/agent-workflow)
[![Topic: mcp](https://img.shields.io/badge/topic-mcp-7048e8?style=flat-square&logo=github)](https://github.com/topics/mcp)
[![Topic: code-review-automation](https://img.shields.io/badge/topic-code--review--automation-7048e8?style=flat-square&logo=github)](https://github.com/topics/code-review-automation)
[![Topic: prompt-engineering](https://img.shields.io/badge/topic-prompt--engineering-7048e8?style=flat-square&logo=github)](https://github.com/topics/prompt-engineering)
[![Topic: developer-tools](https://img.shields.io/badge/topic-developer--tools-7048e8?style=flat-square&logo=github)](https://github.com/topics/developer-tools)

<!-- Release + license meta -->
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Femrecdr%2Fdevt%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&color=blue&prefix=v)](https://github.com/emrecdr/devt/releases)
[![CI](https://github.com/emrecdr/devt/actions/workflows/ci.yml/badge.svg)](https://github.com/emrecdr/devt/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22%2B-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![Changelog](https://img.shields.io/badge/changelog-keep%20a%20changelog-orange?style=flat-square)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

---

## What is devt?

A Claude Code plugin that orchestrates a coordinated **multi-agent** development workflow: **implement → test → review → document → learn**. Instead of relying on a single monolithic prompt, devt decomposes work across specialized agents — a programmer writes code, a tester verifies it, a code-reviewer audits it, a docs-writer updates documentation, and a retro agent extracts lessons for future sessions. Each agent is focused, stateless, and replaceable.

The plugin is **language-agnostic** — Python, Go, TypeScript, Vue, Rust, or anything else. Project-specific coding standards, testing patterns, quality gates, and architecture rules live in your repository under `.devt/rules/`, not baked into the plugin.

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
# Fresh install (latest):
uv tool install graphifyy[mcp]   # recommended — works for both CLI and MCP server
# alternatives:
# pipx install graphifyy[mcp]
# pip install graphifyy[mcp]     # CLI works; MCP server still requires uv on PATH

# Already installed? Keep it current:
uv tool upgrade graphifyy        # required for the full devt feature set (see below)
graphify install                 # refresh the assistant skill files after upgrading
                                 # (the CLI warns when skill version drifts from package)
```

Check your installed version with:

```bash
uv tool list | grep graphifyy    # e.g. "graphifyy v0.8.24"
```

> **Full devt feature set requires graphifyy ≥ 0.8.x.** Newer subcommands like `graphify prs --conflicts` (powering `/devt:ship`'s pre-PR merge-risk scan), `graphify affected`, and the v8 MCP tools (`list_prs`, `get_pr_impact`, `triage_prs`) only ship in the 0.8 line. devt capability-probes graphify at runtime and silently skips features on older versions — they activate automatically once you upgrade.

Tree-sitter multi-language parser that binds memory docs to actual functions/classes. Used by 6 of 10 dev agents (programmer, debugger, researcher, code-reviewer, verifier, architect), Pre-Flight Brief Lane C, blast-radius queries, and `memory validate` stale-symbol detection. See [Features in detail → Graphify](#graphify-deep-dive) for the surface-by-surface benefit comparison.

#### uv — fast Python package manager

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Required for Graphify — its MCP server launches via `uv run --with graphifyy --with mcp -m graphify.serve`. Without `uv`, devt scaffolds a `python3 -m graphify.serve` fallback only when graphifyy is importable from your system Python.

#### claude-mem — mid-session insight capture

**Repo:** [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — see their docs for install.

Captures ⚖️ (decisions) and 🔵 (insights) tags during sessions. devt's discovery harvester (`bin/modules/discovery.cjs::harvest()`) mines these into curator-reviewable proposals at `.devt/memory/_suggestions.md`. The curator agent gates each candidate via AskUserQuestion before promoting to permanent memory. Without claude-mem, discovery still works on `#KNOWLEDGE-CANDIDATE` scratchpad markers and DEC-xxx entries — you get fewer auto-surfaced ADR/CON candidates but nothing breaks.

---

## Quick start

```bash
/devt:setup --init
```

Scaffolds `.devt/rules/` with project-specific conventions and creates `.devt/config.json`. devt auto-detects your stack and selects the matching template (python-fastapi, go, typescript-node, vue-bootstrap, rust, or blank). The wizard pitches optional integrations and confirms detected primary branch. Declining still produces a fully working install.

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
  "model_profile": "balanced",
  "memory": { "preflight_mode": "block" },
  "graphify": { "enabled": true },
  "scope_mode": "surgical",
  "git": { "primary_branch": "main", "contributors": ["alice", "bob"] }
}
```

| Key | What it controls | Default |
|---|---|---|
| `model_profile` | Per-agent model tier — `quality` / `balanced` / `budget` / `inherit` (see [Model profiles](#model-profiles) for per-agent assignments) | `balanced` |
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
/devt:workflow --pause
# next session in same project:
/devt:next   # reads handoff.json, resumes
```

**Capture a TODO without derailing:**
```bash
/devt:note --defer "rate-limit /api/login — Redis backend, see SEC-007"
# survives /devt:workflow --cancel; surfaces in /devt:next when idle
```

**High-stakes architectural decision:**
```bash
/devt:council "should we move from REST to GraphQL for the public API?"
# 5 advisors in parallel + peer review + chairman synthesis → verdict + next step
```

For detailed walkthroughs, see [Workflows & use cases in detail](#workflows--use-cases-in-detail).

---

## How it works (architecture)

```
User → Command (thin) → Workflow (orchestration) → Agent (worker)
                                                  ↓
                                            .devt/state/  (artifacts)
                                            .devt/memory/ (permanent knowledge)
```

The execution model follows a **Command → Workflow → Agent** architecture:

- **Commands** (19 files): thin entry points — 15 user-invocable + 4 specialized (`preflight`, `autoskill`, `thread`, `council`) hidden from the `/`-menu via `user-invocable: false` but still typed-callable. Parse arguments, delegate to a workflow. Each `commands/*.md` that delegates to a workflow file pairs the `@${CLAUDE_PLUGIN_ROOT}/workflows/<name>.md` reference with an explicit `Read` instruction in its `<process>` block — the workflow body is deterministically present in the orchestrator's context.
- **Workflows** (36 files): orchestration. Determine tier, coordinate agents, manage state transitions. Orchestrator owns MCP calls — sub-agents consume the produced `.devt/state/*.md` files READ-ONLY. Each workflow's `<step>` blocks are the contract; orchestrators don't improvise N-way parallel fan-out beyond the dispatches the workflow specifies. For oversized review scopes, the code-reviewer's built-in `community-filter` defers out-of-scope files into `## Out-of-Scope Files (Deferred)` in `review.md`, then the orchestrator dispatches follow-up `/devt:review` calls for the deferred set.
- **Agents** (11 files): 10 focused workers (programmer/tester/code-reviewer/docs-writer/architect/retro/curator/verifier/researcher/debugger) plus the opt-in `devt-coordinator` main-thread router. Every sub-agent's `tools:` is stdlib-only (`Read, Bash, Glob, Grep` + optional `Write, Edit`) — no `mcp__*` grants. MCP belongs to the orchestrator.
- **Skills** (17 directories): technique libraries injected into agents (codebase scanning, complexity assessment, TDD patterns, verification patterns, memory curation, Graphify helpers, …).
- **Hooks** (7 lifecycle events): SessionStart, Stop, SubagentStart, SubagentStop, PostToolUse, PreToolUse, UserPromptSubmit. Profile-controlled (`DEVT_HOOK_PROFILE=minimal|standard|full`). `run-hook.js` writes a forensic trace record per invocation to `.devt/state/hook-trace/run-hook.jsonl` — the diagnostic source-of-truth for "did the harness invoke this hook?".

### Workflow tiers

`/devt:workflow` auto-selects a tier based on task complexity:

| Tier         | Pipeline                                                                                                              | Auto-detected when                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **TRIVIAL**  | execute inline → validate gates                                                                                       | ≤3 files, no decisions needed         |
| **SIMPLE**   | implement → test → review                                                                                             | Single file, known pattern            |
| **STANDARD** | scan → implement → test → review → verify → docs → retro → autoskill                                                  | Multiple files, existing patterns     |
| **COMPLEX**  | auto-research → auto-plan → scan → architect → implement → test → review → verify → docs → retro → curate → autoskill | New patterns, architectural decisions |

You never need to pick a tier. Override the auto-detection if needed.

### Verify gate (STANDARD + COMPLEX)

Workflow-routing artifacts come in pairs: a human-readable `.md` (narrative) and a machine-readable `.json` sidecar (authoritative for status routing). Four artifacts use this pattern today: `impl-summary`, `test-summary`, `verification`, and `review` (the code-reviewer sidecar splits `status` for workflow routing from `verdict ∈ {APPROVED, APPROVED_WITH_NOTES, NEEDS_WORK}` for the review outcome). Before dispatching the LLM verifier, the workflow runs a zero-dep deterministic grader (`bin/modules/grader.cjs`) against the test-summary and impl-summary sidecars. The grader walks the `## Deterministic Gates` JSON block in `references/rubrics/dev.v1.md` and returns one of three envelope shapes — `ok:false` (I/O failure → BLOCKED), `ok:true, pass:false` (constraint violation → RETRY or PRUNE under `workflow.max_iterations`), `ok:true, pass:true` (greens → LLM verifier dispatches). The LLM verifier is skipped entirely on red-test cycles, saving ~5–15K input tokens per failed iteration. Projects can ship lenient rubrics at `.devt/rubrics/<file>.md` to override gate strictness per workflow_type.

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

**Baseline files** (every devt template ships all 9; enforced by smoke gate K70):

| File                       | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `architecture.md`          | Layer structure, dependency rules, module boundaries   |
| `coding-standards.md`      | Language conventions, naming, formatting, import rules |
| `documentation.md`         | Docs conventions (godoc/TSDoc/rustdoc/sphinx)          |
| `git-workflow.md`          | Branch + commit conventions, PR template               |
| `golden-rules.md`          | Project-specific non-negotiables                       |
| `quality-gates.md`         | Lint, typecheck, test commands and pass criteria       |
| `review-checklist.md`      | Code review priorities                                 |
| `testing-patterns.md`      | Test framework, patterns, coverage expectations        |
| `patterns/common-smells.md`| Project-specific anti-patterns                         |

**Optional add-ons** (vary per template's domain): `api-changelog.md` (HTTP-API-serving templates), `canonical-entities.yaml` (entity-aware projects with newtype/enum drift detection), `arch-scan.py` + `detectors/` (Python arch-scanner shipped with python-fastapi).

Run `/devt:setup --init` to generate these from a template matched to your stack.

---

## Configuration reference

Full schema for `.devt/config.json` (project root). Global `~/.devt/defaults.json` sets user-wide defaults that project config overrides. Merge order: hardcoded defaults → `~/.devt/defaults.json` → `.devt/config.json` (later overrides earlier).

```json
{
  "model_profile": "balanced",
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
  "validator": { "structural_mode": "warn" },
  "static_compress": { "mode": "on", "size_cap_bytes": 500000 },
  "workflow": {
    "docs": true, "retro": true, "verification": true,
    "autoskill": true, "regression_baseline": true
  }
}
```

| Key | Values | Default |
|---|---|---|
| `model_profile` | `quality` / `balanced` / `budget` / `inherit` (see [Model profiles](#model-profiles)) | `balanced` |
| `model_overrides` | Per-agent model tier (opus / sonnet / haiku / inherit) | from `model_profile` |
| `git.provider` | `github` / `gitlab` / `bitbucket` | auto-detect from remote |
| `git.workspace` / `git.slug` | Repo identifiers (used by `/devt:ship`) | auto-detect |
| `git.primary_branch` | Integration branch | 4-step fallback chain (`origin/HEAD` → `init.defaultBranch` → common-name heuristic → current branch) |
| `git.contributors` | Display names for `/devt:status --report=weekly` | git log scan |
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
| `dispatch_hygiene_mode` | `block` / `warn` / `off` — controls `hooks/dispatch-hygiene-guard.sh` behavior when an orchestrator raw-dispatches a `devt:*` subagent without the canonical context envelope (`<scope_trust>` + `<scope_hint>` + `<memory_signal>`). `block` (default) returns `{decision:"deny"}` for investigative agents with `/devt:review` redirect in the reason. `warn` allows the call AND attaches the fully-rendered canonical envelope as a `<canonical_envelope>` block in `additionalContext` (paste-ready, derived from current state via `dispatch render-filled <agent>:auto`). `off` is a no-op. All modes append `source: "raw_dispatch"` to `.devt/state/dispatch-warnings.jsonl` for forensics. | `block` |
| `claim_check_mode` | `block` / `warn` / `off` — controls Layer-2 enforcement (`state assert-claim-checks-resolved`). Mirrors `dispatch_hygiene_mode` pattern. Layer-1 (`state assert-artifact-present`) prints `[BLOCKED]` inline; Layer-2 reads `.devt/state/claim-check-failures.jsonl` at finalize phases (via `state advance-phase`). `block` (default) fails the finalize gate on unresolved failures. `warn` surfaces a summary but allows phase advance. `off` auto-passes. Resolution semantic: successful re-runs of Layer-1 after a failure overwrite the failure record. | `block` |
| `graphify.blast_magnification_threshold` | When graphify's BFS-derived `direct_dependents_count` is ≥ N× the literal `caller_count_grep` (run via `git grep -F "<sym>("`), `preflight-brief.json::blast.magnification_advisory` flags potential interface-edge over-counting. Set to `null` to disable the Q2 cross-check entirely. | `3` |
| `telemetry.task_truncation_warn_bytes` | Hook-side threshold for `near_cliff` detection in `hooks/task-truncation-detector.sh`. The hook emits an advisory + `.devt/state/dispatch-warnings.jsonl` record when a sub-agent return exceeds this byte count. Override per-project when telemetry shows the cliff sits somewhere else than the 40 KB default. | `40000` |
| `telemetry.task_truncation_log_all` | When `true`, `hooks/task-truncation-detector.sh` writes a forensic record to `.devt/state/dispatch-warnings.jsonl` for **every** sub-agent return — calibration-cycle mode. When `false` (default), only cliff signals (`near_cliff` / `low_output` / `mid_task_language`) emit. Orchestrator-visible advisory stays cliff-only regardless of this flag; log-all mode adds no advisory noise. Enable for return-size histograms, latency baselines, or other coverage-dependent analyses. | `false` |
| `validator.structural_mode` | `block` / `warn` / `off` — controls structural-drift detection in `state recover-partial-impl` and `state check-agent-output --structural`. When non-`off`, the validator compares the agent's final artifact against `agents/io-contracts.yaml::outputs.expected_sections` (and against an explicit baseline file when the CLI flag is passed). Drift detected → `[STRUCTURAL_DRIFT_DETECTED]` echo + `suggested_action=targeted-fix` in `recoverPartialImpl` so orchestrators SendMessage-resume the same agent ID with a fix prompt rather than fresh re-dispatch (saves ~5–15K tokens per drift incident). `warn` is advisory routing; `block` is mandatory. Same triad as `dispatch_hygiene_mode`. | `warn` |
| `static_compress.mode` | `on` / `off` — static-file prose compressor (`node bin/devt-tools.cjs static-compress <path>`). Default `on` since v0.88.0; the init-time prompt asks at setup and existing projects can flip to `off` here to disable. Bulk-run via `--all` walks `.devt/rules/*.md` + project-local `guardrails/*.md` (plugin source excluded by design). Reversible via `--restore <path>`. When `off`, the CLI exits 0 with `{ok:true, skipped:true}` — configuration-as-designed, not failure. See [Static-file compression (built-in)](#static-file-compression-built-in) above. | `on` |
| `static_compress.size_cap_bytes` | Hard refuse files larger than this. 500 KB covers `.devt/rules/`, `guardrails/`, skill bodies without raising concerns. Override if you need to compress an unusually large file. | `500000` |
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
| `pre-flight-guard.sh` | – | ✓ | ✓ |
| `memory-auto-index.sh` | – | ✓ | ✓ |
| `bash-guard.sh` | – | ✓ | ✓ |
| `dispatch-scope-guard.sh` | – | ✓ | ✓ |
| `dispatch-hygiene-guard.sh` | – | ✓ | ✓ |
| `context-monitor.sh` | – | – | ✓ |
| `prompt-guard.sh` | – | – | ✓ |

Disable specific hooks: `DEVT_DISABLED_HOOKS=hook1.sh,hook2.sh`. Disable the universal hook trace (advanced): `DEVT_HOOK_TRACE=0`.

---

## Model profiles

`model_profile` picks one of four per-agent model assignments. Set in `.devt/config.json`:

```json
{ "model_profile": "balanced" }
```

The four profiles and what each agent gets:

| Agent | `quality` | `balanced` (default) | `budget` | `inherit` |
|---|---|---|---|---|
| **architect** | opus | opus | sonnet | inherit session model |
| **verifier** | opus | opus | sonnet | inherit session model |
| **debugger** | opus | opus | sonnet | inherit session model |
| **code-reviewer** | opus | opus | sonnet | inherit session model |
| **programmer** | opus | opus | sonnet | inherit session model |
| tester | opus | sonnet | sonnet | inherit session model |
| docs-writer | opus | sonnet | haiku | inherit session model |
| researcher | opus | sonnet | haiku | inherit session model |
| retro | opus | sonnet | haiku | inherit session model |
| curator | opus | sonnet | haiku | inherit session model |

**`balanced` (default)** — keeps the 5 strategic agents (architect, verifier, debugger, code-reviewer, programmer) on opus while downgrading the 5 synthesis/exploration agents to sonnet. ~50-60% of `quality`'s token cost; protects judgment-critical paths.

**`quality`** — all 10 agents on opus. Highest cost, highest reasoning depth. Use for production codebases, high-stakes reviews, complex debugging.

**`budget`** — sonnet for strategic agents, haiku for synthesis agents. ~15-20% of `quality`'s cost. Use for prototypes, exploratory work, throw-away branches.

**`inherit`** — every agent inherits whatever model your CC session is using. Useful when you've manually picked a model via `/model` and don't want devt to override per-agent.

### Inspecting + overriding

```bash
node bin/devt-tools.cjs models list                    # All available profiles
node bin/devt-tools.cjs models table balanced          # Per-agent table for a specific profile
node bin/devt-tools.cjs models resolve balanced        # Resolved Anthropic model IDs (after alias map)
node bin/devt-tools.cjs config set model_profile=quality   # Switch profiles
```

Override a single agent without changing the profile via `model_overrides`:

```json
{
  "model_profile": "balanced",
  "model_overrides": { "curator": "opus" }
}
```

Valid agent keys: `programmer`, `tester`, `code-reviewer`, `docs-writer`, `architect`, `retro`, `curator`, `debugger`, `verifier`, `researcher`. Valid model aliases: `opus`, `sonnet`, `haiku`, `inherit`.

---

## Features in detail

### The memory layer — bridges three sources of truth

A self-evolving knowledge graph that joins **the code that exists** (Graphify AST), **the conversation happening now** (claude-mem ⚖️/🔵 captures), and **the permanent rules of the project** (Markdown + SQLite FTS5). Every dev workflow consults it before touching code; curator-gated promotion ensures only validated knowledge lands.

Two layers, two lifetimes:

- `.devt/state/` — ephemeral per-workflow scratch (DEC-, lessons.yaml, scratchpad, Pre-Flight Brief). Reset on `/devt:workflow --cancel`.
- `.devt/memory/` — permanent canonical knowledge, five doc types:

| Type | Use for | Example |
|------|---------|---------|
| **ADR** (decision) | Constitutional rules — "we always do X, never Y" | "Auth uses HMAC-SHA256, never plain JWT" |
| **CON** (concept) | Durable mental models | "A 'session' here is a request chain bound by trace_id" |
| **FLOW** (sequence) | Named multi-step processes | "Production deploy: PR→smoke→canary→staged rollout" |
| **REJ** (rejected) | Tombstones — "we considered X, here's why no" | "Server-Sent Events: rejected (cors, mobile battery)" |
| **LES** (lesson) | Operational tactics — "when X, do Y" | "When integration tests flake, check fixture seed order" |

Every dev workflow auto-fires `/devt:preflight "<task>"` at context_init. A 6-lane Topic Pre-Flight Brief surfaces governing ADRs/CONs/FLOWs/LES + REJ tombstones for the task before any code is touched. When the task references a plan file (`~/.claude/plans/*.md`), preflight auto-loads it and lifts symbols + paths from its `## Files to change` / `## Scope` / `## Symbols` sections — no need to redo the work in the task text. When graphify has discovered hyperedges (semantic multi-file groupings), preflight surfaces matches and `/devt:ship` warns if the PR touches some-but-not-all members of any hyperedge — catches the "fixed the service but forgot the readme/test/migration" failure mode automatically. A PreToolUse guard (`memory.preflight_mode = block`) blocks Edits that aren't justified by a governing ID.

**Full reference:** → [`docs/MEMORY.md`](docs/MEMORY.md) — frontmatter schema, 6 lanes, JSON sidecar, tier-aware budget, verifier memory_signal, MCP server (14 tools), multi-root config, bundle export/import, curator promotion flow, SQL views, native health checks.

### Workflow modes

`/devt:workflow` accepts flags that modify pipeline shape:

| Flag | What it does |
|---|---|
| `--autonomous` | Skip the human-in-the-loop checkpoints between phases. After implement → auto-runs test → review → ship if review passes. State key `autonomous_chain` persists the choice across `/devt:next` resumes. Stop manually with `/devt:workflow --cancel`. |
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

`/devt:review --focus=arch` runs the project's architecture scanner (configured via `arch_scanner.command`) and detects structural drift across sessions:

- **Baseline mode** — first run captures the current state to `.devt/state/arch-baseline.json`
- **Delta mode** — subsequent runs compare against baseline, surfacing only NEW violations (no noise from pre-existing debt)
- **Triage mode** — interactive review of findings via AskUserQuestion: fix now, defer (`/devt:note --defer`), or accept-as-baseline

The python-fastapi reference template ships an `arch-scan.py` that detects 6 layer-violation patterns (LAYER-IMPORT-DOMAIN, LAYER-IMPORT-API, DB-IN-APPLICATION, INLINE-IMPORT, GOD-FILE, …). Other templates can wire any scanner — output must be JSON with a `findings` array.

**Auto-discovery** — when `arch_scanner.command` is unset but a conventional scanner exists at `.devt/rules/arch-scan.{py,sh}`, `tests/architecture/arch-scan.py`, or `scripts/arch-scan.py`, the workflow surfaces it via AskUserQuestion before falling back to manual analysis. Three branches: auto-wire (writes a sensible default `arch_scanner.command` to `.devt/config.json`), show-the-command (prints the exact `config set` invocation for external execution), or skip. Mirrors the `graphify` capability-probe pattern — zero config needed when the scanner follows the convention.

### Quality gates

`/devt:review --focus=quality` runs lint, typecheck, and tests as defined in `.devt/rules/quality-gates.md`. The rules file specifies the exact commands and pass criteria for your stack — devt has no opinion. Agents read this file before reporting "tests passing" so the claim is grounded in your project's actual gates, not assumptions.

### Deferred-task tracker

`.devt/state/deferred.md` with `DEF-NNN` ids holds cross-workflow TODOs ("things we said we'd do later"). Captured via `/devt:note --defer "<title>"` from any workflow. **Exempted from `state reset`** so items survive `/devt:workflow --cancel`. Surfaces in `/devt:status` (count) and `/devt:next` (idle pickup via AskUserQuestion). Distinct from the memory layer — deferred items are transient TODOs, not curator-gated, not in Pre-Flight Brief noise.

### Threads — cross-session investigation context

`/devt:thread` creates persistent investigation contexts that survive session boundaries. Useful for multi-day debugging or research where the trail can't fit in one session. Subcommands: `create`, `list`, `resume`, `update`. Each thread has its own scratch + decision log; reading a thread restores the full context cheaply.

### Notes — zero-friction idea capture

`/devt:note "<thought>"` saves a freeform note without derailing your current workflow. Notes can later be promoted to deferred items, memory candidates, or just deleted. The "I'll forget this if I keep coding" mechanism.

### Forensics — workflow post-mortem

`/devt:debug --mode=forensics` analyzes a stuck or failed workflow's artifacts (`.devt/state/`, git history, recent commits) and diagnoses what went wrong. Useful when `/devt:next` hits a wall and you can't figure out why.

### Autoskill — self-improving skill index

`/devt:autoskill` runs after retro and analyzes the session for patterns: skills that should have been preloaded but weren't, commands that took too many tries, friction points. Proposes additions to `.devt/state/autoskill-proposals.md`. Curator decides what to merge into `skill-index.yaml`. Meta-feature most users won't touch directly.

### Reports

`/devt:status --report=weekly` generates a markdown summary of git activity for the configured `git.contributors`. Runs against any time window. `/devt:status --report=session` generates a session summary (work done, commits, decisions, outcomes) without git dependency.

### Questioning protocol

`references/questioning-guide.md` defines how `/devt:workflow --mode=clarify` and `/devt:specify` interview users. Key principles:

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
- **Automatically (off-ramp)** — `references/council-offramp.md` defines the escalation criteria. `/devt:workflow --mode=clarify` and `/devt:specify` route to council when an open question is high-stakes (architecture-shaping, expensive-to-reverse, or has 3+ defensible options with no clear winner). The off-ramp sequence is: clarify → if council-worthy → council → resume clarify with the council verdict as decision input.
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

**Full reference:** → [`docs/GRAPHIFY.md`](docs/GRAPHIFY.md) — config, scan-prep gate, eviction CLI, post-impl refresh prompt, graph-impact map flow.

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

After implement → auto-runs test → review → ship. If review returns `NEEDS_WORK`, the chain pauses for human input. Stop manually with `/devt:workflow --cancel`. Best for mechanical changes where you trust the agents.

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
/devt:workflow --pause   # captures: current phase, decisions so far, next action — to handoff.json + continue-here.md
```

Then in a future session in the same project:

```bash
/devt:next   # reads handoff.json, resumes the workflow, deletes the handoff
```

Useful at end of day or when a workflow blocks on an external decision (waiting for stakeholder, blocked by another team).

### Explore the deferred queue

```bash
/devt:note --defer "rate-limit /api/login — Redis backend, see SEC-007"
/devt:note --defer list
/devt:note --defer close DEF-003
```

`/devt:next` surfaces an idle deferred queue via AskUserQuestion when no other work is resumable: "5 deferred items waiting. Pick one to start?" Items survive `/devt:workflow --cancel` (the only state-reset exemption).

### Architectural decision via council

```bash
/devt:council "should we move from REST to GraphQL for the public API? Current REST has ~40 endpoints, mostly CRUD with 5 complex aggregation queries. We have 3 client teams (web, iOS, Android) and concerns about mobile bandwidth."
```

5 advisors respond in parallel (Contrarian, First Principles, Generalizer, Newcomer, Pragmatist), peer-review each other anonymously, and the Chairman synthesizes a verdict. Full transcript saves to `.devt/state/council-rest-vs-graphql-{timestamp}.md` for later reference. Add `--mixed-models` for opus/sonnet/haiku diversity at extra token cost.

### Architecture drift check (over time)

```bash
/devt:review --focus=arch                        # first run: captures baseline
# … weeks pass, code evolves …
/devt:review --focus=arch                        # subsequent run: shows DELTA only (new violations)
/devt:review --focus=arch --triage               # interactive: fix / defer / accept-as-baseline per finding
```

The baseline lives in `.devt/state/arch-baseline.json` so the team can ratchet quality forward without drowning in pre-existing debt noise.

### Reset or uninstall

```bash
/devt:setup --uninstall
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

**Setup & help:** `/devt:setup` (with `--init|--update|--uninstall|--health`), `/devt:help`.

**Utilities:** `/devt:status` (with `--report=session|weekly`, `--stats=tokens|mcp|hooks`, `--health`), `/devt:note` (with `--defer`), `/devt:workflow --pause` / `--cancel` / `--retro`, `/devt:debug --mode=forensics`.

**Family-head verbs:** `/devt:plan`, `/devt:research`, `/devt:implement`, `/devt:debug`, `/devt:review` (with `--focus=arch|quality|security`), `/devt:memory`.

**Specialized (direct-callable, hidden from autocomplete):** `/devt:thread`, `/devt:council`, `/devt:autoskill`, `/devt:preflight`. The 22 advanced direct-form commands listed by `/devt:help --all` continue to work when typed (e.g., `/devt:setup --init` is the same as `/devt:setup --init`); the family-head + parameter form is the recommended entry.

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
node bin/devt-tools.cjs dispatch warnings [--by-source|--by-agent|--limit=N|--since=ISO|--raw]   # Summarize raw_dispatch incidents from .devt/state/dispatch-warnings.jsonl

# Updates
node bin/devt-tools.cjs update check|status|local-version|install-type|dirty|clear-cache|changelog
```

Full module-by-module breakdown: → [`docs/INTERNALS.md`](docs/INTERNALS.md) (CLI Modules).

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

Profile control: see [Configuration reference → Hook profile](#hook-profile). Full subsystem details (runner, deny log, scope guards, bash safety, stuck detector): → [`docs/HOOKS.md`](docs/HOOKS.md).

### Directory structure

```
devt/
  .claude-plugin/        Plugin manifest
  bin/
    devt-tools.cjs       CLI entry point
    devt-memory-mcp.cjs  Vendored MCP server (14 tools, JSON-RPC stdio; read-only by default, write surface gated by `DEVT_MCP_ALLOW_WRITES=1`)
    modules/             32 zero-dep modules — init, state, config, model-profiles, setup, memory, preflight,
                         discovery, graphify, deferred, dispatch, mcp-stats, token-report, hook-cost, security,
                         health, weekly-report, update, prose-shrink, static-compress, … (full inventory:
                         docs/INTERNALS.md::CLI Modules)
  commands/              Slash command entry points (19 files: 15 visible + 4 specialized hidden)
  workflows/             Orchestration files (36 files)
  agents/                Agent definitions (11 files; 3 agents bundle sub-skill subdirectories)
  skills/                Skill libraries (17 directories)
  hooks/                 Lifecycle hook scripts + hooks.json
  guardrails/            Protective guidelines
  references/            Technique libraries (questioning guide, domain probes, council offramp)
  scripts/               smoke-test.sh, test-locking.cjs, extract-changelog.sh
  templates/             Project templates (python-fastapi, go, typescript-node, vue-bootstrap, rust, blank)
                         + memory/ (ADR/CON/FLOW/REJ/LES frontmatter scaffolds)
  .github/workflows/     CI: smoke-test on Node 22/24, version coherence,
                         CHANGELOG coverage, tag-driven GitHub releases
  skill-index.yaml       Agent-to-skill mapping
```

For the canonical `.devt/state/` filename contract see [`docs/STATE-RULES.md`](docs/STATE-RULES.md); for contributor-facing internals see [`docs/INTERNALS.md`](docs/INTERNALS.md).

### Troubleshooting

**Workflow fails or gets stuck:**
- `/devt:status` — see current state
- `/devt:debug --mode=forensics` — post-mortem investigation
- `/devt:workflow --cancel` — reset and start over
- Check `.devt/state/` for artifact details

**Plugin health issues:**
- `/devt:setup --health` — diagnose (21 checks across config, state, hooks, memory)
- `/devt:setup --health --repair` — auto-fix safe issues

**Missing `.devt/rules/`:**
- `/devt:setup --init` — set up project conventions

**Agent returns BLOCKED:**
- Read agent's output in `.devt/state/<phase>-summary.md` — task may need to be broken down or clarified

**Memory layer not surfacing expected docs:**
- `node bin/devt-tools.cjs memory validate` — check frontmatter / stale paths / broken links
- `node bin/devt-tools.cjs memory index` — rebuild the FTS5 index
- `/devt:setup --health` — surfaces `MEM_INDEX_STALE`, `MEM_PATH_UNREACHABLE`, `MEM_VALIDATE_ERRORS`, `MEM_CONFLICT_HIGH`

**MCP server warnings (`Missing environment variables: CLAUDE_PLUGIN_ROOT`, `unknown command 'mcp'`):**
- Already fixed in current versions. Update via `/devt:setup --update`.

### Static-file compression (built-in)

devt ships `static-compress` for compression of project markdown files that load into every code-touching agent dispatch — `.devt/rules/*.md` and project-local `guardrails/*.md`. The compressor preserves fenced code, inline code, URLs, paths, identifiers, version numbers, and heading lines byte-equal; only prose changes. **Default is `on`** — flip to `off` in `.devt/config.json` to disable; the init-time prompt asks at setup.

**Honest measurement note**: in real workflows the per-dispatch wire savings are small — ~0.06–0.19% on a 37–115 KB rendered envelope in greenfield-api with an 88.86% prompt-cache hit rate. The reason is that most of the envelope is the `governing_rules` block (often dominated by `CLAUDE.md`), and Anthropic's cache hierarchy means in-place edits to cached content invalidate downstream cache. Use the new `dispatch decompose` CLI (below) to measure your own envelopes — the empirical biggest lever per dispatch is usually selective inlining of `governing_rules`, not regex compression.

```bash
# Compress all project rules in one shot
node bin/devt-tools.cjs static-compress --all
# Restore one file
node bin/devt-tools.cjs static-compress --restore .devt/rules/coding-standards.md
# Opt out per-project
echo '{"static_compress":{"mode":"off"}}' >> .devt/config.json
```

**Compression ratio depends on prose density**: conversational or filler-heavy markdown compresses 25–35% (the compressor's design target); tightly written technical specifications compress 4–15% (measured ~4% on `guardrails/golden-rules.md`). The compressor (`prose-shrink.cjs`, zero-dependency caveman-shrink port) runs through the structural-drift validator post-compression — any drift → backup deleted, input file untouched. Five safety layers before the input is touched (sensitive-path denylist, size cap, empty-file refusal, identical-output refusal, backup-readback verification). Fully reversible via the `<path>.original.md` backup sibling.

Recipe + full safety semantics: [`docs/static-compress-recipe.md`](docs/static-compress-recipe.md). Smoke gates **K77** (round-trip), **K85** (prose-shrink correctness), **K74** (structural validator) lock the contract.

### Envelope decomposition (measurement tool)

When investigating "where are my tokens actually going?", devt ships a read-only CLI that decomposes any rendered dispatch envelope into static vs dynamic blocks and ranks them by byte size:

```bash
# Decompose any agent's envelope for the active workflow
node bin/devt-tools.cjs dispatch decompose verifier:auto
# Same, with explicit workflow_id
node bin/devt-tools.cjs dispatch decompose code-reviewer:code_review
```

Returns JSON with a `summary` (total/static/dynamic/wrapper bytes + percentages) and a `blocks[]` array sorted by size. Static blocks (`governing_rules`, `inline_rubrics`, `files_to_read`, `provenance_protocol`, etc.) pay cache-creation cost on every Task() dispatch; dynamic blocks (`scope_hint`, `scope_trust`, `memory_signal`, `graph_impact`, `prior_outputs`, `task`) vary per dispatch. The tool is the empirical input for per-agent inlining decisions — if one block dominates, that's your lever. Smoke gate **K86** locks the contract.

### Where to read more

- **`CLAUDE.md`** — orchestrator-facing contract sheet (architecture, conventions, critical rules)
- **`docs/AGENT-CONTRACTS.md`** — rules for modifying agents/workflows (dispatch, scope hint/trust, sidecar contract)
- **`docs/INTERNALS.md`** — CLI module deep-dive, governing-rules + inline-guardrails wiring, plugin internals
- **`docs/MEMORY.md`** — comprehensive memory-layer guide (frontmatter reference, pre-flight, sidecar shape, multi-root, troubleshooting)
- **`docs/HOOKS.md`** — hook subsystem (run-hook runner, deny log, bash-guard, stuck detector, scope-guard)
- **`docs/GRADER.md`** — verifier outcome-grader, deterministic gate, pinned rubrics, code-review grader
- **`docs/GRAPHIFY.md`** — config, scan-prep gate, eviction CLI, post-impl refresh prompt
- **`docs/STATE-RULES.md`** — `.devt/state/` filename contract (canonical inventory + allowed patterns)
- **`docs/COMMANDS.md`** — full command reference
- **`guardrails/golden-rules.md`** — Rules 14 (Pre-Flight Protocol) and 15 (Memory Maintenance)
- **`skills/memory-pre-flight/SKILL.md`** — the protocol skill loaded by all 8 dev agents
- **`skills/memory-curation/SKILL.md`** — the curator's promotion gate
- **`templates/memory/`** — ADR/CON/FLOW/REJ/LES scaffolds for new docs
- **[CHANGELOG.md](CHANGELOG.md)** — full version history

### CI

GitHub Actions runs `scripts/smoke-test.sh` (900+ assertions across all CLI subcommands, including a 62-deep drift-guard stack `K94–K155` covering command stratification, parameter routing, stale-ref scans, `workflow_type` registry parity, size budgets, CLI surface contracts, telemetry-CLI input validation, push-not-pull session signal surfacing, substance-enforcement gates per `[[CON-001]]`, meta-gates that auto-validate drift count claims, CHANGELOG coverage, pipefail-trap patterns, compiled-region edit-source markers, phase-gate firing on `state update phase=X status=DONE`, intermediate-phase gate coverage, ungoverned-edit silent-skip, envelope-unavailable reason surfacing, dual-window session-signal counter, the `dispatch run` agent-launcher CLI, dispatch-helpers skill discoverability for single + fan-out cases, the `agent resume` CLI for walled-agent recovery, 3-way version coherence — VERSION ↔ plugin.json ↔ marketplace.json, dispatch usage message includes `run`, workflow-staleness warning at >24h, preflight laneG project-context enrichment, docs/GRAPHIFY.md tier-semantics positioning (symbol_anchored as canonical primary for non-GitHub), and code-review.md merge-base-aware diff resolution at identify_scope, `state reset-soft` clears per-workflow accumulators while preserving session anchors + history + memory + phase artifacts, `state staleness-check` AND-semantics (task-changed AND age>1h required to surface staleness; typo-retry and legitimate-resume both NOT stale), `dispatch render-lanes` stamps `<correlation_id>cid_*` per envelope, and dispatch-hygiene-guard matcher recognizes `<correlation_id>cid_*` as envelope-managed, model profiles carry per-agent effort settings (architect=high, tester=low) and opus alias resolves to claude-opus-4-8, `state assert-verifier-short-circuit` fires on substantive clean sidecar (DONE + empty self_flagged_uncertainties), self_flagged_uncertainties prompt language present in programmer.md + tester.md + code-reviewer.md, task-truncation-detector surfaces category-specific refusal hints, F5 `_isDocstringNode` threshold catches "Test X." patterns + 2-whitespace short docstrings, F4 `graphify status` surfaces lag_commits by default + node_count/edge_count under --full, F1 MCP `get_neighbors` schema declares max_bytes with server-side 60KB default, F2 `getNeighbors` filters primitives + test-path nodes with filter telemetry envelope, M4a `telemetry calibrate` CLI aggregates hook-trace and emits hook_error_pattern/hook_low_value recommendations, M3 `dispatch run-lanes` registers from `--partition=<file>` + injects per-lane `--lane-N-focus` + global `--task-suffix=<file>` + `--base=<ref>` diff base into canonical envelopes) and `scripts/test-locking.cjs` (20-worker concurrent state-write test) on every push. Version coherence, CHANGELOG coverage, and `workflow_type` registry coverage are enforced. Releases are tag-driven — push `vX.Y.Z` to fire `.github/workflows/release.yml` which extracts the matching CHANGELOG section into the GitHub release notes.

---

## Releases & contributing

### Updating

```bash
/devt:setup --update
```

devt checks for new versions on GitHub at each session start. The `/devt:setup --update` command auto-detects how devt was installed (plugin system or git clone) and runs the right update command. Restart your Claude Code session after updating.

Manual update: `cd ~/.devt && git pull origin main`.

### Releases

Releases are published at [emrecdr/devt/releases](https://github.com/emrecdr/devt/releases). Each version follows [Semantic Versioning](https://semver.org/) and has a matching `## [X.Y.Z]` section in [CHANGELOG.md](CHANGELOG.md), formatted per [Keep a Changelog](https://keepachangelog.com/).

The release flow is tag-driven: pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which extracts the changelog section via `scripts/extract-changelog.sh` and creates the GitHub release automatically. CI enforces that `VERSION`, `plugin.json` version, and the changelog all stay in lock-step — a version bump without a matching changelog entry fails the build.

### License

MIT
