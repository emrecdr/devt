# devt Commands Guide

How to use devt -- from your first task to shipping a PR.

---

## Decision Tree

```
What do you need?
  |
  |-- "I'll describe it"                  -->  /devt:do (smart router)
  |-- "Build, fix, or improve something"  -->  /devt:workflow
  |-- "Define a feature first"            -->  /devt:specify
  |-- "Fix a bug"                         -->  /devt:debug
  |-- "Create a PR"                       -->  /devt:ship
  |-- "Not sure / continue from where I left off"  -->  /devt:next
  |-- "Set up a new project"              -->  /devt:setup --init
  |-- "What commands are available?"      -->  /devt:help
```

Six commands for daily work, two for setup/discovery.

---

## Primary Commands

### `/devt:workflow` -- Build anything

The main command. Give it a task, it figures out the rest.

```bash
/devt:workflow "add health check endpoint at GET /health"
/devt:workflow "fix login validation that accepts empty passwords"
/devt:workflow "refactor user service to use repository pattern"
/devt:workflow "update API rate limiting from 100 to 500 req/min"

# Autonomous mode — skip confirmations, auto-proceed if gates pass
/devt:workflow "add health check endpoint" --autonomous
```

**Autonomous mode** (`--autonomous`): Skips phase transition confirmations and auto-proceeds when quality gates pass. Still pauses for: review score below 50, critical errors, max iteration limits, and architectural decisions that need your input.

**What happens internally:**

devt assesses your task and auto-selects a complexity tier:

```
TRIVIAL   (typo, config change)     -->  executes inline, no subagents
  |
SIMPLE    (1-2 files, known pattern) -->  implement --> test --> review
  |
STANDARD  (multiple files)           -->  scan --> implement --> test --> simplify
  |                                       --> review --> verify --> docs --> retro
COMPLEX   (new patterns, multi-svc)  -->  auto-research --> auto-plan --> scan
                                          --> architect --> implement --> test
                                          --> simplify --> review --> verify --> docs --> retro
```

You never choose a tier. devt detects it using:
- **Scope**: How many files? (<=3 = TRIVIAL, <=2 = SIMPLE, 10+ = COMPLEX)
- **Risk**: Critical paths, data models, cross-service boundaries?
- **Novelty**: Known pattern or something new?
- **Dependencies**: Cross-cutting concerns (auth, audit, events)?

For STANDARD+ tasks, devt also runs a **risk & simplicity check** -- if a simpler approach exists, it warns you before proceeding.

For COMPLEX tasks, devt **auto-researches** (investigates approaches, patterns, pitfalls) and **auto-plans** (creates ordered task breakdown) before implementation -- you don't need to run separate commands.

**Prior artifacts are used automatically:**

If you ran `/devt:specify` before, the spec feeds into the workflow. Same for any existing `research.md`, `decisions.md`, or `plan.md` in `.devt/state/`. You never need to wire things together manually.

---

### `/devt:specify` -- Define a feature

Use when you have a feature idea but not clear requirements. Produces a structured PRD (Product Requirements Document) through systematic interview.

```bash
/devt:specify "user notification preferences"
/devt:specify "add rate limiting to public API endpoints"
```

**What happens:**

1. Analyzes your codebase for context (existing patterns, modules, conventions)
2. Interviews you systematically -- only non-obvious questions
3. Scores the draft on 5 dimensions (placeholder scan, internal consistency, scope focus, ambiguity, completeness), 0-2 each. Total <8/10 triggers a soft-gate: you choose between refining (walk through the deductions) or accepting the score and proceeding
4. Generates a PRD with: user stories, scope, decisions, API design, test scenarios, task breakdown
5. Saves to `.devt/state/spec.md` (for pipeline) and `docs/specs/` (permanent)
6. Asks what you want to do next:
   - **Create an implementation plan** --> chains to `/devt:plan`
   - **Start implementation now** --> chains to `/devt:workflow`
   - **Clarify decisions first** --> chains to `/devt:workflow --mode=clarify`
   - **Done for now** --> saves and stops

**When to use specify vs workflow directly:**

| Situation | Command |
|---|---|
| Clear task, known approach | `/devt:workflow` directly |
| Feature idea, need to scope it | `/devt:specify` then `/devt:workflow` |
| Bug or fix | `/devt:debug` |

---

### `/devt:debug` -- Fix a bug

Systematic 4-phase debugging. No guessing, no "try this and see."

```bash
/devt:debug "tests failing on user service after migration"
/devt:debug "API returns 500 on concurrent requests to /orders"
/devt:debug "login works locally but fails in staging"
```

**What happens:**

1. Captures symptoms (expected vs actual behavior, error messages, reproduction steps)
2. Dispatches a debugger agent in fresh context with 4-phase protocol:
   - **Phase 1**: Root cause investigation (MANDATORY -- no fixes before understanding)
   - **Phase 2**: Pattern analysis (find working example, compare line-by-line)
   - **Phase 3**: Hypothesis (falsifiable, one variable at a time)
   - **Phase 4**: Fix (minimal change + tests + defense-in-depth)
3. If FIXED: appends root cause to its agent memory at `.claude/agent-memory/devt-debugger/MEMORY.md` (future debug sessions skip re-investigation; legacy `debug-knowledge-base.md` at project root is still read for backwards compatibility but no longer written to)
4. If needs more investigation: offers to re-run with accumulated context

---

### `/devt:ship` -- Create PR

Creates a pull request from completed workflow artifacts.

```bash
/devt:ship
```

**What happens:**

1. Checks preflight: git auth, not on protected branch, remote configured
2. Reads `.devt/state/` artifacts: impl-summary, test-summary, review verdict, decisions
3. Generates PR body with: summary, changes, testing, review score
4. Pushes branch and creates PR via `gh` CLI
5. Reports PR URL

---

### `/devt:next` -- What should I do?

Don't remember where you left off? Don't know which command to run? Just run next.

```bash
/devt:next
```

**What happens:**

Reads all available state and acts:

| State detected | Action |
|---|---|
| Nothing in progress | Asks what you want to do (build, specify, debug) |
| Paused workflow (handoff.json) | Resumes from where you left off |
| Spec exists, no plan | Runs `/devt:plan` |
| Plan exists, no implementation | Runs `/devt:workflow` |
| Implementation complete + approved | Offers `/devt:ship` |
| Active workflow at a phase | Continues the workflow |
| Workflow blocked | Shows the blocker, offers fix/cancel/forensics |
| Uncommitted changes, no workflow | Offers to ship |

---

## Setup

### `/devt:setup --init` -- Initialize project

One-time setup for a new project. Scaffolds `.devt/rules/` with project conventions and creates `.devt/config.json`.

```bash
/devt:setup --init
```

**What happens:**

1. Asks which template: `python-fastapi`, `go`, `typescript-node`, `vue-bootstrap`, `rust`, `blank` (language-agnostic defaults)
2. Asks for project metadata: git provider, workspace, branch name
3. Copies template files to `.devt/rules/`
4. Creates `.devt/config.json`, `.devt/state/`, `.devt/memory/{decisions,concepts,flows,rejected,lessons}/`
5. Adds `.devt/state/` to `.gitignore`

---

### `/devt:help` -- Command reference

Show all devt commands organized by experience level with practical use cases and typical workflows.

```bash
/devt:help
```

---

### `/devt:do` -- Smart router

Describe what you want in plain text. devt matches your intent to the right command and dispatches it. Never does work itself.

```bash
/devt:do "fix the login bug"          # → routes to /devt:debug
/devt:do "add pagination to contacts" # → routes to /devt:workflow
/devt:do "what changed this week"     # → routes to /devt:status --report=weekly
```

---

### `/devt:status --report=session` -- Session summary

Generate a post-session report with commits, files changed, decisions, and outcomes. Reads from git log and `.devt/state/` artifacts.

```bash
/devt:status --report=session
```

---

## Utilities

Commands you call when needed, not part of the main flow.

### `/devt:status` -- Where am I?

```bash
/devt:status
```

Shows: current workflow phase, tier, iteration count, what happened so far, what's next.

### `/devt:workflow --pause` -- Save and resume later

```bash
/devt:workflow --pause
```

Creates structured handoff in `.devt/state/handoff.json`. When you start a new session, devt detects the handoff and offers to resume.

### `/devt:debug --mode=forensics` -- What went wrong?

```bash
/devt:debug --mode=forensics
```

Post-mortem for failed or stuck workflows. Reads all artifacts, checks git history, runs quality gates, diagnoses the failure point, and recommends recovery.

### `/devt:workflow --cancel` -- Reset

```bash
/devt:workflow --cancel
```

Aborts the active workflow and clears `.devt/state/`. Clean slate.

### `/devt:note` -- Quick idea capture

```bash
/devt:note "should add caching to the search endpoint later"
/devt:note --list
```

### `/devt:council` -- Pressure-test a decision

Run a high-stakes engineering decision through 5 advisors who think from fundamentally different angles, peer-review each other anonymously, then a chairman synthesizes the verdict. Adapted from Karpathy's LLM Council, retuned for engineering trade-offs.

```bash
/devt:council "rewrite the legacy state module or strangle it incrementally?"
/devt:council "REST or event-driven for the new ingestion pipeline?"
/devt:council --mixed-models "drop SQLite FTS5 for an external search index?"
```

You can also trigger by phrase: `council this: ...`, `pressure-test this`, `red team this`, `second opinion on this`, `devil's advocate`.

The five advisors:

| Advisor | Lens |
|---|---|
| Contrarian | What breaks in prod? Failure modes, edge cases, fatal flaws. |
| First Principles | Are we solving the right problem? Strip assumptions and rebuild. |
| Generalizer | What reusable abstraction is hiding? What does this enable downstream? |
| Newcomer | The on-call engineer at 3am with zero context. Curse-of-knowledge check. |
| Pragmatist | What's the smallest first commit? Monday-morning execution. |

These five create three natural tensions (Contrarian ⇄ Generalizer, First Principles ⇄ Pragmatist, Newcomer holding everyone honest), which is why all five always convene — reducing the count breaks the protocol.

**Optional model diversity** (`--mixed-models`): dispatches advisors across opus/sonnet/haiku for genuinely different reasoning patterns (closer to Karpathy's original which used GPT-5.1, Gemini-3, Claude, and Grok). Default is single-model dispatch to control cost; opt in when the decision is high-stakes enough.

**Structured advisor output**: each advisor responds in a fixed format — `## Options Considered`, `## Recommendation`, `## Validated Reasoning` (numbered claims with `Evidence:` citations to specific files / rules / research findings), and an optional `## Unvalidated Concerns` (claims they suspect but cannot ground in available material, marked `[speculation]`). Free-form prose is a regression — the advisor is re-dispatched if it skips the structure. Peer review then explicitly scores evidence quality across the five anonymized responses, and the chairman synthesis weights Validated Reasoning over Unvalidated Concerns when adjudicating disagreement.

**Output**: a chairman verdict in chat (7 sections — agreement, clashes, blind spots, what grounded the verdict, where the council speculates, recommendation, the one thing to do first) plus a full transcript at `.devt/state/council-{slug}-{timestamp}.md` with all advisor responses and peer reviews.

**Offramp integration with brainstorming workflows**: `/devt:workflow --mode=clarify`, `/devt:research`, and `/devt:specify` will offer `/devt:council` as one of the resolution options when a gray area trips a 3-condition threshold (multiple viable approaches AND hard to reverse AND high stakes). The threshold and offramp template live in `references/council-offramp.md`. Soft cap of 1 council per workflow invocation; verdict is captured back into the calling workflow's primary artifact (DEC-xxx in `decisions.md` for clarify, "Council Verdict" section in `research.md` for research, PRD Decisions entry for specify). Offer-only — never auto-invoked.

**Skip the council for**: factual lookups, syntax fixes, single-line bugs, or validation-seeking when you've already decided. The council tells you what you don't want to hear — that's the feature.

Distinct from `/devt:workflow --mode=clarify` (resolves ambiguity through interview) and the `strategic-analysis` skill (produces a trade-off table for two named options). The council adds adversarial peer review and synthesis specifically for cases where one perspective feels untrustworthy.

### `/devt:setup --health` -- Plugin diagnostics

```bash
/devt:setup --health
```

Checks: config valid, state directory exists, hooks registered, required files present.

### `/devt:memory` -- Permanent knowledge layer

The memory layer is the permanent knowledge surface — distinct from per-workflow ephemeral state (`.devt/state/decisions.md`). It holds **all five doc types** under one canonical store: ADR-xxx (decisions), CON-xxx (concepts/domain models), FLOW-xxx (business processes), REJ-xxx (rejected ideas / tombstones), and LES-xxx (operational lessons — "when X happens, do Y"). Lessons live in `.devt/memory/lessons/` alongside the architectural docs and are FTS5-indexed in the same `index.db`.

The memory layer integrates with: Topic Pre-Flight Brief auto-fired from dev workflows; curator-gated promotion of session DECs to permanent ADRs; Graphify symbol anchoring with EXTRACTED/INFERRED/AMBIGUOUS confidence (read directly from `graphify-out/graph.json`); claude-mem observation harvest via the `mcp__plugin_claude-mem_mcp-search__search` MCP tool (orchestrator-mediated; persisted to `.devt/state/claude-mem-harvest.md` then folded into `_suggestions.md`); vendored MCP query layer (`bin/devt-memory-mcp.cjs`) for read-only agent access; and PreToolUse pre-flight enforcement.

```bash
/devt:memory init                       # scaffold .devt/memory/{decisions,concepts,flows,rejected}/ + first FTS5 index
/devt:memory index                      # atomic drop+rebuild of the unified index (transaction-wrapped)
/devt:memory query "argon hashing"      # full-text search; prefix-matched, AND-combined tokens
/devt:memory get ADR-007                # fetch one doc by id with affects/links/keywords
/devt:memory affects src/auth/service.ts  # which active/candidate docs govern this file (glob-aware)
/devt:memory list decision              # list all docs of a type (or all types if omitted)
/devt:memory links ADR-007 --depth=3    # transitive link traversal — load-bearing for safe ADR supersession
/devt:memory active security            # all status:active docs in a domain
/devt:memory rejected-keywords          # all REJ tombstones with their AI-suppression search_keywords
/devt:memory validate                   # frontmatter + path-resolution + broken-link checks
```

**Frontmatter schema** (strict — `bin/modules/memory.cjs:validateFrontmatter` enforces):

```yaml
---
id: ADR-007                    # required; pattern enforced per doc_type (ADR-/CON-/FLOW-/REJ-)
title: "Argon2 password hashing"
doc_type: decision             # decision | concept | flow | rejected
domain: security               # optional, free-form
status: active                 # candidate | active | superseded | rejected
confidence: explicit           # verified | explicit | inferred | observed | speculative
summary: "..."                 # ≤ 200 chars; FTS5-indexed surface for high-speed search
affects_paths:                 # optional, POSIX glob patterns
  - "src/auth/**"
affects_symbols:               # optional; bare strings OR objects with binding_confidence (Graphify Phase 2+)
  - AuthService
  - symbol: SessionManager
    binding_confidence: EXTRACTED   # EXTRACTED | INFERRED | AMBIGUOUS
links:                         # optional; typed cross-references
  - id: ADR-001
    type: depends_on           # supersedes | depends_on | implements | relates_to
created_at: "2026-05-05T10:00:00Z"
created_by: user               # user | curator | retro | council | manual
schema_version: 1
---
```

REJ docs additionally carry `reason` (user_preference | performance | security | maintainability | compliance | complexity) and `search_keywords` — phrases that suppress AI re-proposal of the rejected idea (the tombstone mechanism; consumed by autoskill in Phase 2).

**Index location**: `.devt/memory/index.db` (gitignored — regenerable from markdown via `memory index`). Uses `node:sqlite` FTS5 (built-in since Node 22.5+). The four `.devt/memory/{decisions,concepts,flows,rejected}/` subdirs ARE intentionally committed — they are team-shared architectural truth.

**Hard invariants**:
- Files prefixed with `_` (e.g. `_suggestions.md`) are NEVER indexed as first-class docs (they are auto-generated reports — Phase 2 introduces `_suggestions.md` for curator promotion proposals).
- Templates with id ending in `-000` are skipped during indexing (avoids polluting the index with scaffolding).
- Atomic rebuild: drop+re-insert wrapped in a single SQLite transaction. Failure mid-rebuild rolls back to the prior index state.
- `links.target_id` has NO foreign key constraint — forward references to not-yet-created docs are valid; broken links surface as warnings via `memory validate`, not errors.

**Templates**: `templates/memory/{ADR,CON,FLOW,REJ}-template.md` — copy + edit + drop into the appropriate subdir. Never commit a template scaffold (id `-000` would be skipped anyway, but it bloats history).

Distinct from `/devt:workflow --mode=clarify` (per-workflow DEC-xxx capture, resets between workflows) and `/devt:workflow --retro` (operational lessons to playbook). Use `/devt:memory` for **permanent architectural rules** that should govern future agent decisions across sessions.

**Phase 5+ subcommands**:

```bash
/devt:memory export [--out=PATH] [--include=decision,concept,flow,rejected] [--all-roots]
                                        # write portable JSON bundle (frontmatter + body)
                                        # default: project-local only
                                        # --all-roots: union of every configured memory root
/devt:memory import <bundle.json> [--prefix=ORG-] [--overwrite]
                                        # restore from a bundle; default skip if id exists
                                        # --prefix=ORG- remaps every id (ORG-ADR-001) to avoid collisions
/devt:memory suggest                    # discovery engine harvest into _suggestions.md
                                        # (curator-gated; never auto-writes permanent files)
```

**Multi-root memory**: set `memory.paths` in `.devt/config.json` to index company-wide ADRs alongside project-local ones — `["../engineering-adrs", ".devt/memory"]`. Project-local is always appended last (highest precedence — last-wins). `memory list`/`get` expose `source_root` for provenance. `memory index` returns `conflicts[]` + `conflict_count` so collisions are explicit. See `docs/MEMORY.md` for the full guide.

### `/devt:preflight` -- Topic Pre-Flight Brief

```bash
/devt:preflight "<task description>"
```

Generates `.devt/state/preflight-brief.md` — a single document listing every governing ADR/Concept/Flow, all REJ tombstones, related operational lessons, and (with Graphify enabled) blast radius for the task. Auto-fired by every dev workflow at context_init; standalone invocation also supported.

The Brief drives Tier 1 of the Two-Tier Pre-Flight Protocol. Tier 2 = `hooks/pre-flight-guard.sh` (PreToolUse on Edit/Write) checks `.devt/state/scratchpad.md` for a `PREFLIGHT <ts> edit <path> :: <governing IDs>` line written by the agent. Behavior governed by `memory.preflight_mode`: `off` no-op | `warn` advisory | `block` denies.

Subcommands:

```bash
/devt:preflight generate "<task>"   # default — runs Lanes A-F + blast radius
/devt:preflight topic "<task>"      # debug topic extraction (domains/symbols/keywords)
/devt:preflight status              # FRESH | STALE | MISSING + generated_at
/devt:preflight mark-stale [reason] # called by File Pre-Flight on scope expansion
```

The Brief surfaces 6 lanes: A (domain match), B (FTS expansion), C (symbol match), D (wiki-link transitive closure depth-2), E (REJ tombstone overlap), F (operational lessons). When `memory.paths` is set, all lanes span every configured root.

**JSON sidecar**: alongside the markdown Brief, `preflight generate` writes `.devt/state/preflight-brief.json` — a deterministic interface workflows consume via `jq`. Fields: `status`, `topic`, `governing_ids`, `suggested_reading` (deduped union of governing-doc `affects_paths` + blast-radius direct dependents, capped at 8), `blast` (effect size, source, dependent count), `graph_stats`, `staleness`, `rej_keyword_matches`, `generated_at`. Five workflows (`dev`, `quick-implement`, `code-review`, `debug`, `research`) cache and inject this as `<scope_hint>` and `<scope_trust>` blocks into subagent dispatches so agents start with high-signal paths instead of discovering scope from the task description.

**`<scope_trust>` dispatch signal** — `{trust, lag_commits, fresh}` projected from the sidecar's `graph_stats.trust` + `staleness`. Trust values: `dense` (full graph, fresh), `sparse` (graph exists but partial), `empty` (no graph or Graphify disabled). When `trust ∈ {sparse, empty}` OR `lag_commits > 10`, the 7 receiving agents (programmer/tester/code-reviewer/verifier/researcher/architect/debugger) fall back to their role-specific low-confidence behavior (e.g., programmer leans on impl-summary, verifier verifies path existence). Each agent's fallback is tailored to its role — the signal carries low-confidence guidance, not blocks.

**`graph_stats`** — `{state, node_count, edge_count, density, trust}` computed by `graphify.cjs::graphStats()` over the loader cache. `state` is `empty | sparse | dense`. Surfaces in the Brief's JSON sidecar; agents reading the sidecar via `state read` see it as part of `scope_trust_json`. With Graphify disabled, all fields are zero/empty and `trust=empty`.

---

## Dispatch Telemetry

devt collects two independent telemetry streams in `.devt/state/dispatch-warnings.jsonl` and surfaces them via `node bin/devt-tools.cjs dispatch warnings`. Both streams are project-shaped: see [`.devt/memory/concepts/CON-002-dispatch-telemetry-signal-flip.md`](../.devt/memory/concepts/CON-002-dispatch-telemetry-signal-flip.md) for the field-validated distribution analysis.

### What gets logged and when (A0 + A9)

| Source | Hook | Logged when |
|---|---|---|
| `raw_dispatch` | `hooks/dispatch-hygiene-guard.sh` (PreToolUse) | Task call to a `devt:*` agent without ANY of 10 envelope-signal blocks (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`, `<context>`, `<graph_impact>`, `<original_review>`, `<lane_scope>`, `<god_node_warnings>`, `<prior_outputs>`, `<provenance_protocol>`) |
| `task_output_bytes` | `hooks/task-truncation-detector.sh` (PostToolUse) | Sub-agent return triggers a cliff: `near_cliff` (output ≥ 40KB threshold), `low_output` (output < 500B AND prompt ≥ 1000B per F26's proportional gate), or `mid_task_language` (continuation phrasing in return) |

**Envelope-managed dispatches are intentionally silent.** If you dispatch `devt:programmer` with all 3 canonical envelope blocks (`<scope_trust>` + `<scope_hint>` + `<memory_signal>`) and you don't see your dispatch in `dispatch-warnings.jsonl`, that's success — not a hook failure. The detector classified your dispatch as workflow-managed and exited at the envelope check. This was field-validated by cal #21 F21 falsification: a deliberate envelope-less probe dispatch DID appear; the prior envelope-injected dispatches correctly did NOT.

`docs-writer`, `retro`, `curator`, and `devt-coordinator` are additionally exempt from raw_dispatch detection per `agents/io-contracts.yaml` (`graphify_inputs: []` declares no envelope contract). The detector exits silently for those agents regardless of prompt shape.

### Reading the telemetry

```bash
node bin/devt-tools.cjs dispatch warnings                     # default summary view
node bin/devt-tools.cjs dispatch warnings --by-source         # raw_dispatch vs task_output_bytes counts
node bin/devt-tools.cjs dispatch warnings --by-agent          # which agents get hit most
node bin/devt-tools.cjs dispatch warnings --limit=5 --raw     # 5 most-recent raw entries
node bin/devt-tools.cjs dispatch warnings --since=1h          # filter to last hour
node bin/devt-tools.cjs dispatch warnings --since=2026-06-01  # since ISO date
```

Invalid `--since` (non-ISO) and invalid `--limit` (non-positive integer) exit 2 with a stderr error rather than silently returning wrong results.

### The `low_output` canary (A1)

`low_output` is the dominant signal in projects with substantive sub-agent work (greenfield 6% vs devt 0.08% — see CON-002). It catches three failure modes:

1. **Credential expiry returning zero tokens.** The W12 case (cal #21 F-OBS-1): subagent died at "Not logged in" returning 0 bytes. `low_output: true` would have fired had the proportional gate not been added; F26 added the prompt-size gate so it now correctly fires here (prompt was ~5KB envelope; output 0 bytes).
2. **Auth/permission failure mid-dispatch.** Similar pattern to credential expiry — agent gets blocked before substantive work, returns a stub.
3. **91-tool-call wall hit.** Greenfield's "Now B.5" case (cal #17): programmer returned 140 bytes after substantial work because it hit the Claude Code tool-call ceiling.

**Recovery prescription when `low_output: true` fires** with `near_cliff: false` and `mid_task_language: false`:

1. Read the structured sidecar artifact (e.g., `impl-summary.json`) — check `Status` field. If `PARTIAL` or absent, this is a mid-task wall hit.
2. If `Status: PARTIAL`, `SendMessage`-resume the same agent ID with `<continue_from_section>...</continue_from_section>` — preserves cache, saves ~15-20 Reads vs cold re-dispatch.
3. If sidecar is absent entirely AND output is a stub, this is the credential-expiry pattern. Acknowledge the auth event, re-dispatch with the same envelope plus a note that prior work landed zero files. Before re-dispatching, run `node bin/devt-tools.cjs state check-inherited-edits` to surface any uncommitted source edits from the dead dispatch.

**`low_output` is NOT recovery-actionable for trivial dispatches.** Probe prompts (< 1000 bytes) with small replies are proportional, not cliff hits. F26's prompt-size gate suppresses the false alarm. If you see `low_output: true` with a tiny prompt in `dispatch-warnings.jsonl` from an old session pre-F26, ignore it.

### Parallel sub-agent dispatch recipe (A3)

When the orchestrator needs to run N independent sub-agents in parallel without going through `/devt:workflow`'s full pipeline (e.g., fan-out review across lanes, parallel research streams), the canonical pattern is:

1. **Run `/devt:workflow` once first** to populate `workflow.yaml::scope_*_json` + `.devt/state/graph-impact.md` (single-source preparation; all lanes inherit).
2. **Render the canonical envelope for each lane** using `dispatch render-filled`:
   ```bash
   node bin/devt-tools.cjs dispatch render-filled programmer:auto
   node bin/devt-tools.cjs dispatch render-filled code-reviewer:auto
   ```
   Each envelope carries `<scope_trust>`, `<scope_hint>`, `<memory_signal>`, governing rules, and guardrails — all populated from current state.
3. **Hand-inject + dispatch each lane** as a separate `Agent(subagent_type="devt:<agent>", prompt="<rendered envelope> + <lane-specific task>")` call from main thread.
4. **Each lane's dispatch is correctly classified as workflow-managed** by the hygiene guard (envelope blocks present). No raw_dispatch entries.
5. **Synthesize results** in the orchestrator: read each lane's primary artifact, compose the final output.

Without step 2's `dispatch render-filled`, hand-rolled envelope construction is error-prone. The CLI exists specifically to support this case.

For ad-hoc parallel review across files, `workflows/code-review-parallel.md` is the sanctioned multi-lane pattern (declared in `agents/io-contracts.yaml` as a specific workflow type, K103-validated). Use that workflow when scope > 10 files AND user opts in via AskUserQuestion; orchestrator improvisation outside it is prohibited per `CLAUDE.md::Workflow single-dispatch contract`.

### Discoverability surfaces

- `/devt:status` includes a `Dispatch warnings:` line when session-scoped counts are > 0 (per A2). Threshold-gated; suppressed when both raw and cliff counts are zero.
- `hooks/task-truncation-detector.sh` emits a one-line hint in `additionalContext` at sub-agent return time when raw_dispatch entries exist within the last hour (per A2b). Operator-confirmed UX preference: catch the signal in the act-on-it window, not the next status check.

---

## Typical Flows

### Flow 1: Quick fix

```
You: /devt:workflow "fix typo in error message for login endpoint"

devt: Assessed as TRIVIAL (1 file, no decisions).
      Fixed typo in src/auth/messages:42
      Quality gates: PASS
      Done.
```

### Flow 2: Standard feature

```
You: /devt:workflow "add health check endpoint at GET /health"

devt: Assessed as STANDARD (2 files, known pattern).
      --- Phase 1/7: Scan ---
      Found 12 relevant files, existing endpoint patterns in routes/...
      --- Phase 2/7: Implement ---
      programmer: DONE (2 files changed)
      --- Phase 3/7: Test ---
      tester: DONE (4 tests added)
      --- Phase 4/7: Review ---
      code-reviewer: APPROVED (score: 93/100)
      --- Phase 5/7: Verify ---
      verifier: VERIFIED
      --- Phase 6/7: Docs ---
      docs-writer: DONE (MODULE.md updated)
      --- Phase 7/7: Retro ---
      retro: 1 lesson extracted

      Workflow complete. 2 files changed, 4 tests, score 93/100.
```

### Flow 3: Complex feature with specify

```
You: /devt:specify "add rate limiting to public API endpoints"

devt: [Analyzes codebase: 12 public endpoints, Redis available, DI framework detected]
      [Interviews: strategy? limits? which endpoints? 429 behavior?]
      PRD written to docs/specs/rate-limiting.md
      What next? --> "Start implementation"

devt: /devt:workflow "add rate limiting to public API endpoints"
      Assessed as COMPLEX (new pattern, 10+ files, external integration).
      --- Auto-Research ---
      Researcher investigated: Redis sliding window, middleware patterns...
      --- Auto-Plan ---
      Plan: 8 tasks, 12 files to change
      Proceed? --> Yes
      --- Phase 1/10: Scan ---
      ...
      [full pipeline runs]
      ...
      Workflow complete. 12 files changed, 15 tests, score 91/100.
```

### Flow 4: Debug

```
You: /devt:debug "tests failing on user service after migration"

devt: Capturing symptoms...
      --- Dispatching debugger ---
      Phase 1 (Root Cause): Traced to missing column in migration 003
      Phase 2 (Pattern): Compared with working migration 002
      Phase 3 (Hypothesis): "Migration 003 drops NOT NULL constraint on email,
                             causing unique index to fail on empty strings"
      Phase 4 (Fix): Added NOT NULL constraint, created regression test

      FIXED. Root cause saved to .claude/agent-memory/devt-debugger/MEMORY.md.
      Quality gates: PASS
```

### Flow 5: Something goes wrong

```
You: /devt:workflow "refactor authentication to use JWT"

devt: Assessed as COMPLEX... [runs]
      --- Phase 4/10: Review ---
      code-reviewer: NEEDS_WORK (score: 62/100)
      Repair: RETRY (iteration 1) -- re-dispatching programmer...
      code-reviewer: NEEDS_WORK (score: 71/100)
      Repair: DECOMPOSE (iteration 2) -- fixing isolated issues, deferring cross-cutting...
      code-reviewer: APPROVED_WITH_NOTES (score: 82/100)
      Proceeding with 2 deferred findings in scratchpad.

      Workflow complete (DONE_WITH_CONCERNS).
      Deferred: 2 findings in .devt/state/scratchpad.md
```

```
You: /devt:debug --mode=forensics

devt: Timeline: workflow ran 8/10 phases, stopped at verify (GAPS_FOUND)
      Root cause: JWT refresh token rotation not wired to middleware
      Recovery: fix the wiring manually, then re-run /devt:workflow
```

---

## Internal Commands (Power User)

These are called automatically by workflows. You can invoke them directly for fine-grained control.

| Command | What it does | Normally called by |
|---|---|---|
| `/devt:plan` | Create implementation plan with auto-research | `/devt:workflow` for COMPLEX tasks |
| `/devt:research` | Investigate approaches, patterns, pitfalls | `/devt:plan` when research is needed |
| `/devt:workflow --mode=clarify` | Resolve ambiguity with interview or `--assumptions` mode | `/devt:specify` and `/devt:workflow` |
| `/devt:implement` | Code + test + review (no docs/retro) | Equivalent to `/devt:workflow` SIMPLE tier |
| `/devt:workflow --mode=fast` | Inline execution, no subagents | Equivalent to `/devt:workflow` TRIVIAL tier |
| `/devt:review` | Standalone code review | Workflow review step |
| `/devt:review --focus=quality` | Run lint, typecheck, tests | Every workflow as quality gates |
| `/devt:workflow --retro` | Extract lessons to playbook | Workflow retro step |
| `/devt:workflow --mode=docs` | Refresh project documentation against current state | Standalone post-workflow doc catch-up |
| `/devt:review --focus=arch` | Architecture violation scan | Workflow architect step |
| `/devt:autoskill` | Propose plugin improvements from session patterns | Standalone or workflow autoskill step |
| `/devt:status --report=weekly` | Git-based contribution report | Standalone utility |
| `/devt:thread` | Cross-session context threads | Standalone utility |
| `/devt:memory` | ADR/Concept/Flow/REJ permanent layer | All dev agents at context_loading; curator at promote/reject |
| `/devt:preflight` | Topic Pre-Flight Brief generator | Auto-fired by every dev workflow at context_init |

### Telemetry CLI

These subcommands have no slash-command alias — they are read-only diagnostics:

```bash
node bin/devt-tools.cjs token-report [--sessions=N] [--since=DATE] [--project=PATH]
                                        # aggregate Claude Code session token usage
                                        # streams ~/.claude/projects/<slug>/*.jsonl
                                        # reports cache hit rate + per-session totals
                                        # validates user-supplied paths (null bytes, traversal)
node bin/devt-tools.cjs token-report --baseline=PATH
                                        # snapshot current aggregate to PATH for later comparison
node bin/devt-tools.cjs token-report --compare=PATH
                                        # diff current aggregate against a saved baseline
node bin/devt-tools.cjs token-report --regression [--fail-on-regression]
                                        # detect cold-prefix streaks per session (dispatch-ordering
                                        # regression detector); --fail-on-regression exits 1 when any
                                        # session has streaks, suitable as a CI gate
node bin/devt-tools.cjs mcp-stats [--since=DATE] [--tool=NAME]
                                        # aggregate MCP tool-call traces from .devt/memory/_mcp-trace.jsonl
                                        # per-tool: call count, error rate, p50/p95/p99 latency
node bin/devt-tools.cjs mcp-stats [--workflow-id=ID] [--workflow-type=TYPE] [--phase=PHASE]
                                        # narrow traces to a specific workflow run, type, or phase
                                        # filters compose conjunctively with --since and --tool
node bin/devt-tools.cjs mcp-stats --prune-older-than=30d
                                        # compact the trace JSONL by dropping entries older than cutoff
```

The MCP server (`bin/devt-memory-mcp.cjs`) appends one JSONL line per tool call when `memory.mcp_telemetry: true` (default). Records are privacy-safe: timestamp, tool name, ok/error_code, duration_ms, args_size, args_fp (sha256:12 fingerprint — NOT the raw args), result_size. When a workflow is active, the record also carries `workflow_id`, `workflow_type`, and `phase` (read from `.devt/state/workflow.yaml` with mtime-invalidated caching); the fields are omitted when no workflow.yaml exists. Trace file is gitignored.

---

## How Data Flows

Agents never talk to each other directly. They communicate through `.devt/state/` files:

```
specify     --> spec.md          --> programmer, tester, verifier, architect, researcher
research    --> research.md      --> programmer (approach guidance)
clarify     --> decisions.md     --> programmer, reviewer, verifier
plan        --> plan.md          --> programmer, architect, verifier
programmer  --> impl-summary.{md,json}  --> tester, reviewer, verifier, docs-writer, retro
tester      --> test-summary.{md,json}  --> reviewer, verifier, docs-writer, retro
reviewer    --> review.md               --> programmer (if NEEDS_WORK in dev), verifier, retro
verifier    --> verification.{md,json}  --> programmer (if GAPS_FOUND in dev) | reviewer
                                            (deterministic grader runs against impl-summary.json
                                             + test-summary.json BEFORE LLM verifier dispatch;
                                             .json is authoritative for status routing, .md is narrative)
scan        --> scan-results.md  --> programmer, architect
baseline    --> baseline-gates.md --> verifier (regression detection)
architect   --> arch-review.md   --> programmer
retro       --> lessons.yaml     --> curator
curator     --> .devt/memory/lessons/LES-NNNN.md (AskUserQuestion-gated)
                                    --> memory index --> .devt/memory/index.db (FTS5)
                                    --> future workflows (Pre-Flight Brief Lane F surfaces matching lessons)
debugger    --> debug-summary.md + .claude/agent-memory/devt-debugger/MEMORY.md --> future debug sessions
```

Each agent gets a **fresh context window** -- no accumulated garbage from prior steps. The workflow reads each artifact, checks the status gate, and decides what happens next.

---

## Cross-references

- [`CLAUDE.md`](../CLAUDE.md) — entry point: orchestrator architecture + critical contracts
- [`docs/AGENT-CONTRACTS.md`](AGENT-CONTRACTS.md) — rules for modifying the agents these commands dispatch
- [`docs/INTERNALS.md`](INTERNALS.md) — `init.cjs` compound-init pattern + CLI module reference
- [`docs/MEMORY.md`](MEMORY.md) — `/devt:memory` and `/devt:preflight` command semantics
- [`docs/STATE-RULES.md`](STATE-RULES.md) — `.devt/state/` filename contract that commands write to
- [`docs/HOOKS.md`](HOOKS.md) — lifecycle hooks fired around command invocation
