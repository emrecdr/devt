# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/). The `[Unreleased]` section below stages changes for the next version — when bumping, rename it to `## [X.Y.Z] - YYYY-MM-DD` so the release workflow's changelog extractor (`scripts/extract-changelog.sh`) can find it.

## [Unreleased]

**Command surface stratification + parameter routing — Phase 1 + Phase 2.** Casual user surface collapses from 36 equal-tier commands to 15 family-head commands with rich parameter modes that route to the right underlying workflow. Hidden direct-form commands remain typed-callable for muscle memory / scripts. No functionality removed; the structural cleanup is presentation + routing only.

### Phase 2 — Parameter Routing (this commit)

**6 family heads gained parameter routing**, eliminating the need to memorize 22 separate command names:

| Family Head | Parameter Surface | Routes To |
|---|---|---|
| `/devt:workflow` | `--mode=specify\|plan\|research\|implement\|clarify\|fast\|docs` `--pause` `--cancel` `--retro` | corresponding workflow file |
| `/devt:review` | `--focus=code\|arch\|quality\|security` `--quick` | code-review / arch-health-scan / quality-gates |
| `/devt:debug` | `--mode=forensics` | debug.md / forensics.md |
| `/devt:status` | `--report=session\|weekly` `--stats=tokens\|mcp\|hooks` `--health` | per-mode workflow or hook-cost-estimate CLI |
| `/devt:note` | `--defer` `--tags=a,b,c` | note.md / defer.md |
| **NEW `/devt:setup`** | `--init` `--update` `--uninstall` `--health [--repair]` | project-init / update / uninstall / health |

Each family-head command parses `$ARGUMENTS` for routing flags, strips the matched flag, and reads the resolved workflow file via the Read tool. The existing direct-form commands (`/devt:init`, `/devt:health`, etc.) continue to work — they're hidden from `/`-autocomplete but typed invocation reaches the same workflow body.

### Added

- **`commands/setup.md`** — NEW family head consolidating admin operations (init / update / uninstall / health). Visible in `/`-autocomplete; raises visible count from 14 to 15.
- **6 family-head commands rewritten** (`workflow`, `review`, `debug`, `status`, `note`, plus new `setup`) with explicit routing tables in `<process>` blocks. Each declares its `argument-hint:` parameter surface for autocomplete discoverability. Multi-target `@-refs` in `<execution_context>` document the workflows each command can route to.
- **`scripts/smoke-test.sh::K95`** — locks the parameter routing contract. 23 (flag → workflow) pairings across the 6 family heads must all resolve; drift fails the test with the specific (cmd, flag, workflow) tuple that broke.
- **`commands/help.md`** — rewritten to surface the Phase 2 parameter forms in the default view. `--all` flag still surfaces the 22 advanced direct-form commands with cross-references to their family-head + parameter equivalents.
- **`README.md`** — updated to use parameter forms throughout: `/devt:init` → `/devt:setup --init`, `/devt:arch-health` → `/devt:review --focus=arch`, `/devt:quality` → `/devt:review --focus=quality`, `/devt:forensics` → `/devt:debug --mode=forensics`, `/devt:session-report` → `/devt:status --report=session`, etc. Direct-form commands documented as the legacy / muscle-memory path; family-head + parameter form is the recommended entry.

### Validated

- Phase 1 audit passed: all 22 hidden commands have `user-invocable: false`, all 14 → 15 visible commands lack it.
- Phase 2 alignment audit found the README gap and fixed it in this commit.
- Smoke: 846/846 (was 845 + K95). Locking: 3/3.

### Notes

This is Phase 1+2 of the 3-phase plan. Phase 3 (delete the 22 hidden command files and mass-update their ~200 cross-references to use family-head + param form) is deferred to a separate commit to keep this change set reviewable. The direct-form commands continue to work in the meantime — there is no behavioral break.

### Phase 2.5 — Internal Routing Alignment + K96

After Phase 2, an audit found 5 internal routing tables still referencing direct-form hidden commands. The user-facing layer (commands/, help.md, README.md) was already aligned in Phase 2; this entry aligns the *internal* routing surface so the family-head + param form is the canonical recommendation in every contract document.

- **`CLAUDE.md` workflow_type registry** updated: `retro`/`arch_health_scan`/`clarify`/`docs` rows now show `/devt:workflow --retro` / `/devt:review --focus=arch` / `/devt:workflow --mode=clarify` / `/devt:workflow --mode=docs` as the resume command. The `workflow_type` values themselves (internal identifiers) stay unchanged.
- **`CLAUDE.md` Recipes 3 + 4** updated to use `/devt:workflow --mode=docs` and `/devt:workflow --retro` as the canonical entry; direct-form names continue to work as aliases.
- **`CLAUDE.md` arch_scanner reference** updated: `arch_scanner.command` wires into `/devt:review --focus=arch` (direct-form `/devt:arch-health` aliased).
- **`workflows/next.md` resume routing table + body** — every `/devt:retro` / `/devt:arch-health` / `/devt:clarify` / `/devt:docs` / `/devt:cancel-workflow` / `/devt:forensics` / `/devt:defer` updated to the family-head + param form.
- **`workflows/do.md` routing table** — natural-language router now routes to canonical forms (e.g., "initialize" → `/devt:setup --init`, "trivial" → `/devt:workflow --mode=fast`).
- **`agents/devt-coordinator.md` routing table** — mirror of do.md, same updates.

### Added

- **`scripts/smoke-test.sh::K96`** — verifies every K95-referenced workflow file actually exists on disk. K95 catches "command body mentions the route"; K96 catches "the workflow file at that route exists." Drift class: someone renames `workflows/forensics.md` and forgets to update `commands/debug.md`'s routing table. Smoke now 847/847 (was 846 + K96).

### Phase 6 — CLAUDE.md slim-down (29.9% reduction in per-dispatch governing-rules cost)

After Phase 1-5 transformed the surface, Phase 6 targets the **token cost lever**: CLAUDE.md is loaded into every session AND every sub-agent dispatch. Per prior measurement (memory observation 21859), CLAUDE.md is **~94% of the 31KB `governing_rules` block** injected into every sub-agent prompt. Slimming it has compounding cost impact across the plugin.

**Research backing**: per CC `best-practices` doc — "CLAUDE.md is loaded every session, so only include things that apply broadly... For each line, ask: would removing this cause Claude to make mistakes? If not, cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions! ... Excluded: Detailed API documentation (link to docs instead)."

**What moved**: lines 92-141 (50 lines of verbose CLI reference with multi-paragraph descriptions: `state assert-*` gates, `state check-agent-output`, `state new-instance/list-instances`, `state recover-partial-impl`, `state advance-phase`, `state refresh-scope-context`, `static-compress`, `graphify rebuild`) → new `## Development CLI Reference` section in `docs/INTERNALS.md`. The Releasing subsection (~30 lines of release flow detail) → 2-line summary pointing to `scripts/release.sh` header comments.

**What stayed**: primary CLI surface (one-liners for the every-session token budget — `init`, `state read|update|reset|validate|sync|prune`, `config get|set`, `models *`, `setup --template`, `health`, `update *`, `memory *`, `semantic *`, `report *`). All "Universal Rules", "Key Conventions", "Critical Agent + Workflow Contracts", architecture overview unchanged.

### Metrics

| Surface | Before | After | Δ |
|---|---:|---:|---:|
| CLAUDE.md line count | 295 | 240 | −55 (−18.6%) |
| CLAUDE.md bytes | 35,699 | 25,048 | **−10,651 (−29.9%)** |
| Estimated `governing_rules` block reduction per sub-agent dispatch | ~31KB | ~21KB | **~32% savings** |
| docs/INTERNALS.md grew (CLI reference relocated) | 569 lines | 639 lines | +70 lines |

The ~10KB removed from CLAUDE.md was pure reference material — token-cost-per-dispatch with zero behavioral information. CC docs explicitly recommend `docs/` for "detailed API documentation."

Smoke: 845/845 (unchanged from Phase 5 — content move only). Locking: 3/3.

### Validated NOT removed

Behavioral rules — universal conventions, scope_mode, scope_hint contract, raw-dispatch policy, plugin mechanics summary, dispatch escape-hatch recipes — all retained because each has the property "removing this would cause Claude to make mistakes" per the CC docs' acid test.

### Phase 9 — Measurement & Release Prep

Capstone of the v0.93 cycle: quantifies the cumulative wins for the release narrative. Read-only measurement run — no code changes.

**Cycle-wide metrics (fd8915f → HEAD):**

| Metric | Before | After | Δ |
|---|---:|---:|---|
| Commits | — | — | 14 in cycle |
| Visible commands (`/`-autocomplete) | 36 | **19** | −47% surface area |
| Total commands on disk | 36 | 19 | −47% (18 folded into family-head + param forms) |
| Hidden specialized commands | 0 | 4 | preflight, autoskill, thread, council |
| Parameter routes | 0 | **23** | (flag → workflow) pairings across 6 family heads |
| Workflows reachable | 36 | 36 | 100% (K99 guarded) |
| `CLAUDE.md` size | 35,699 bytes | **25,048 bytes** | −10,651 bytes (−29.9%) |
| Per-dispatch `governing_rules` block | ~31 KB | ~21 KB | **~32% lighter** |
| Drift guards | 0 | **8** | K94–K101 |
| Smoke tests | 843 | **846** | +3 (K99, K100, K101 added; K94 absorbed prior `commands/X.md exists` checks) |
| Stale `/devt:<deleted>` refs (contract layer) | — | 0 | K97 enforced |
| Stale `/devt:<deleted>` refs (doc layer) | — | 0 | Phase 4 fixed |
| Stale `/devt:<deleted>` refs (runtime layer) | — | 0 | K100 enforced |

**Hook telemetry — measured against the same v0.93 trace** (`node bin/devt-tools.cjs hook-cost-estimate --window=7d`):

| Hook | Fires (7d) | Brittleness | Exit ≠ 0 | Est cost USD/wk if migrated to prompt-type |
|---|---:|---:|---:|---:|
| context-monitor.sh | 1,075 | 0 | 0 | $6.21 |
| bash-guard.sh | 432 | 0 | 0 | $0.16 |
| dispatch-hygiene-guard.sh | 247 | 10 | 3 | $0.06 |
| subagent-status.sh | 212 | 0 | 30 | $0.08 |
| prompt-guard.sh | 104 | 1 | 0 | $0.07 |
| pre-flight-guard.sh | 104 | 3 | 0 | $0.07 |
| memory-auto-index.sh | 104 | 1 | 0 | $5.25 |
| read-before-edit-guard.sh | 94 | 0 | 0 | $0.07 |
| workflow-context-injector.sh | 83 | 0 | 0 | $0.03 |
| stop.sh | 45 | 0 | 0 | $0.05 |
| session-start.sh | 9 | 1 | 0 | $0.00 |
| dispatch-scope-guard.sh | 6 | 1 | 0 | $0.01 |
| task-truncation-detector.sh | 6 | 1 | 0 | $0.02 |
| **Total** | **2,521** | — | **33** | **$12.08** |

**Migration recommendations** (from the cost estimator): `migrate=0`, `consider=4`, `stay=9`. No hook clears the brittleness ≥ 4 AND fires ≤ 200 threshold (dispatch-hygiene-guard, the highest-brittleness shell hook, has 247 fires/week — above the 200-cap that protects high-volume guards). The cost estimator's classifier validates: no hook should migrate to LLM-based decision logic right now.

### Validated NOT done (intentional non-changes)

Three Phase 9 candidates were validated and explicitly skipped because the analysis showed they were the wrong call:

- **Skill `paths:` expansion** — re-analysis confirmed devt skills aren't file-extension-scoped; they trigger on prose language ("triage findings", "is this actually working") not on files. Adding paths would narrow auto-loading without value.
- **Hook profile migration** — the hook-cost-estimate run shows `migrate=0`. No hook currently warrants the prompt-type migration cost. Revisit when a hook's brittleness or fire-rate shifts.
- **Output style `force-for-plugin: true`** — would override the user's chosen output style (intrusive). Opt-in would add an unused artifact for users who don't invoke it. No clear value over the current convention layer.

The drift-guard stack (K94–K101) covers every structural invariant established by Phases 1–8. The v0.93 cycle is structurally complete.

Smoke: 846/846 (unchanged — read-only measurement). Locking: 3/3.

---

### Phase 8 — No-task elicitation across family heads

Phase 7 added the no-flag picker to `/devt:setup`. Phase 8 extends the same "make the dead-end interactive" pattern to family heads that take a task arg: `/devt:workflow`, `/devt:debug`, `/devt:plan`, `/devt:research`, `/devt:implement`. `/devt:specify` already had this behavior (its workflow body asks for a one-sentence description if input is empty).

**Pattern**: each command body gets a `**Step 1.5 — Elicit task if empty**` (or equivalent inline note) that says:
- If `$ARGUMENTS` is empty after flag-stripping (and `--autonomous` is NOT set for the dev pipeline), ask the user in plain prose with a command-specific question
- Wait for the response, use it as the task description
- Do NOT proceed without a task

Per-command prose:
- `/devt:workflow` → "What would you like to build, fix, or improve?"
- `/devt:debug` → "Describe the bug or error you're seeing — include the symptom, where it happens, and what you expected."
- `/devt:plan` → "What task are we planning?"
- `/devt:research` → "What topic should I research? (e.g., a feature area, integration pattern, or specific subsystem)"
- `/devt:implement` → "What would you like to implement? (Quick mode skips docs and retro — best for tasks touching 1-2 files with clear scope.)"

`/devt:workflow --autonomous` with no task = STOP with error (autonomous runs need an upfront task) — preserves the existing precondition for unattended runs.

The pattern is intentionally prose-based (not `AskUserQuestion`) because the input is free-text task description, not multiple-choice. CC's `AskUserQuestion` is ergonomically wrong for task input — prose ask is the standard agentic-loop interaction.

Smoke: 846/846 (no new gates). Locking: 3/3.

---

### Phase 7 — `/devt:setup` interactive picker UX

When the user types `/devt:setup` with no operation flag, the previous behavior was "STOP with usage hint" — a dead-end error message telling them to re-type the command with `--init|--update|--uninstall|--health`. Phase 7 replaces that with an `AskUserQuestion` interactive picker showing all 4 operations with descriptions.

This matches CC's interactive-picker pattern (recommended in the docs' "interview the user" section) and aligns with devt's existing pattern (the `--uninstall` workflow is already `AskUserQuestion`-gated for destructive ops). For casual users typing `/devt:setup` to explore options, the picker is more discoverable than reading the autocomplete hint.

**Behavior matrix**:
| User input | Behavior |
|---|---|
| `/devt:setup --init` (or any specific flag) | Routes directly to matching workflow (unchanged) |
| `/devt:setup` (no flag) | **NEW**: AskUserQuestion with 4 labeled options + descriptions, routes after pick |
| `/devt:setup --foo` (invalid flag) | STOP with error (unchanged) |
| `/devt:setup --init --update` (multiple flags) | STOP with error (unchanged) |

The picker question is canonical (deterministic phrasing in `commands/setup.md::Step 1.5`) so a future smoke gate can lock the contract if needed. Decline / Esc on the picker exits cleanly.

Smoke: 846/846. Locking: 3/3. All 8 drift gates (K94-K101) PASS.

---

### Phase 6.5 — K101 CLAUDE.md size budget guard

Adds the 8th drift gate to prevent CLAUDE.md regrowth after Phase 6's slim-down. K101 enforces a **28,000-byte cap** (current 25,048 + ~12% headroom for natural maintenance). Drift class: large reference blocks accumulating in CLAUDE.md instead of `docs/INTERNALS.md`. Per CC best-practices, "every byte costs per-session AND per-dispatch token budget."

If K101 fails in a future change, the remediation message points the maintainer at the right pattern: move reference material to `docs/INTERNALS.md`, keep behavioral rules in CLAUDE.md.

The drift-guard stack is now 8-deep (K94-K101). Smoke: 846/846.

---

### Phase 5 — Runtime alignment + K100 (hooks/, bin/, templates/)

After Phases 3+4 aligned the contract layer (commands/workflows/agents/skills) and the doc layer (docs/, README.md), Phase 5 closes the final alignment gap: the **runtime layer** — hook scripts that emit prompts to users, CLI modules that emit error messages, and templates that ship to user projects on `/devt:setup --init`.

**Validation pass before rewriting** found 46+ stale refs across 12 files, classified by impact:

| Tier | Type | Files |
|---|---|---|
| **TIER 1** (user-facing) | Hook prompt strings | `session-start.sh` (9 edits), `stop.sh` (1) |
| **TIER 1** (user-facing) | Error message `fix:` fields | `bin/modules/health.cjs` (22 edits) |
| **TIER 1** (user-facing) | Warnings + recommendations | `init.cjs` (2), `preflight.cjs` (1), `state.cjs` (10), `devt-tools.cjs` (1) |
| **TIER 1** (user-facing) | Markdown template HTML comments | `deferred.cjs` (2 — written into `deferred.md` viewed via `/devt:status`) |
| **TIER 2** (comments/JSDoc) | Internal code comments | `dispatch-hygiene-guard.sh` (1), `discovery.cjs` (1), `logger.cjs` (2), `setup.cjs` (2) |

**Best-practice frame**: per the CC docs' "address root causes, not symptoms" rule, ALL stale refs got rewritten (both T1 and T2) so error messages give actionable suggestions and internal docs stay aligned for future maintainers.

**Bulk rewrite**: inline Node.js script (visible in transcript) applied 54 substitutions across 12 files in `hooks/` + `bin/` (.sh/.cjs/.js only). 5 additional manual fixes covered `.md` and `.py` files the script skipped: `hooks/quality-gate-verifier.md` (3 refs), `bin/modules/deferred.cjs` (multi-line comment), `templates/python-fastapi/arch-scan.py` (1), `templates/typescript-node/quality-gates.md` (1).

### Added

- **`scripts/smoke-test.sh::K100`** — runtime stale-reference scan. Every `/devt:<name>` reference in `hooks/`, `bin/`, and `templates/` (.sh/.cjs/.js/.py/.md) must resolve to an existing `commands/<name>.md`. Same allowlist as K97 (`review-parallel`, `command-name`). Drift class: a hook emits a stale "Run /devt:<deleted>" prompt that users follow into nowhere. This was a real bug that Phase 5's validation caught and fixed.

**The drift-guard stack is now 7 deep — K94 through K100:**

| Gate | Guards |
|---|---|
| K94 | Command stratification (15 visible + 4 specialized hidden) |
| K95 | Parameter routing contract (23 (flag → workflow) pairings) |
| K96 | Workflow file existence for K95 routes |
| K97 | Stale `/devt:<name>` refs in contract files (commands/help.md exempt) |
| K98 | Router parity between workflows/do.md and agents/devt-coordinator.md |
| K99 | Workflow orphan detection (with subcommand-route allowlist) |
| **K100** | **Runtime stale refs in hooks/+bin/+templates/** |

Together they enforce every structural invariant of the v0.93 UX simplification across every layer: contract (K94-K98), reachability (K99), runtime (K100).

Smoke: 845/845 (was 844 + K100). Locking: 3/3.

---

### Phase 4 — Documentation alignment + K99 orphan guard

After Phase 3, an audit found two final alignment gaps before declaring v0.93 done:

1. **35 stale refs in `docs/`** across 8 documentation files (COMMANDS.md, INTERNALS.md, STATE-RULES.md, HOOKS.md, MEMORY.md, AGENT-CONTRACTS.md, GRAPHIFY.md, CANONICAL-ENTITY-DRIFT.md, plus 2 historical superpower plans). K97's scope is the contract layer (commands/workflows/agents/skills) by design; docs/ was outside its guard but should still be aligned for users reading the documentation.
2. **17 stale refs in README.md** — Phase 2's update missed multiple sections (code blocks, troubleshooting examples).

**Bulk substitution** — the Phase 3 script's sister script (`/tmp/phase4-docs-rewrite.cjs`) ran the same MAPPINGS table against `docs/` and `README.md` only. 72 edits across 12 files: README.md (17), docs/COMMANDS.md (27, the worst offender — it's the user-facing command reference), docs/STATE-RULES.md (5), docs/INTERNALS.md (5), docs/HOOKS.md (3), docs/AGENT-CONTRACTS.md (3), docs/GRAPHIFY.md (3), docs/opus-4-8-upgrade-report.md (3), docs/CANONICAL-ENTITY-DRIFT.md (2), docs/MEMORY.md (2), plus 2 historical superpowers plan files (1 each).

**Post-rewrite audit confirms zero residual stale refs** in docs/+README for any of the 18 deleted command names.

### Added

- **`scripts/smoke-test.sh::K99`** — workflow orphan detection. Every `workflows/*.md` file must be reachable from somewhere: a command @-ref or explicit Read, a cross-workflow route, or via the allowlist for subcommand-routed workflows (`code-review-parallel` is invoked by `code-review.md::scope_check`; `memory-init`, `memory-promote`, `memory-reject` are invoked via `/devt:memory <subcommand>` not direct @-refs). Drift class: a workflow file added but never wired up, or a renamed workflow leaving an unreachable orphan. 36 workflows currently all reach.

The drift-guard stack is now 6 deep:

| Gate | Guards |
|---|---|
| K94 | Command stratification (15 visible + 4 specialized hidden) |
| K95 | Parameter routing contract (23 (flag → workflow) pairings) |
| K96 | Workflow file existence for K95 routes |
| K97 | Stale `/devt:<name>` refs in contract files (commands/help.md exempt) |
| K98 | Router parity between workflows/do.md and agents/devt-coordinator.md |
| K99 | Workflow orphan detection (with subcommand-route allowlist) |

Smoke: 844/844 (was 843 + K99). Locking: 3/3.

---

### Phase 3 — Delete folded commands + mass-update cross-refs

The final phase of the UX simplification: deleted 18 command files whose functionality folded cleanly into family-head + parameter forms, and mass-updated all internal cross-references to use the canonical form. The 4 specialized direct-callable commands (preflight, autoskill, thread, council) remain — their use cases don't fold cleanly into a parameter surface.

**Surface count**: 36 commands → 19 total (15 visible + 4 specialized hidden).

**Mass substitution** — a Node.js script applied 119 edits across 36 contract files (commands/, workflows/, agents/, skills/), word-boundary aware to avoid false matches. Each `/devt:<old>` reference was rewritten to its family-head + parameter form per the Phase 2 mapping table.

**Templates** — fixed `/devt:clarify` references in 3 dispatch envelope templates (`templates/dispatch/envelopes/*.tmpl.md`) and `/devt:quality` references in 3 stack quality-gates templates (`templates/{go,python-fastapi,vue-bootstrap}/quality-gates.md`). Recompiled via `dispatch compile --write`.

**Smoke gate updates**:
- **K94** contract revised: visible 15 + specialized hidden 4 = 19 total (was 15 + 22 = 37 before Phase 3 deletions).
- **K97** now excludes `commands/help.md` from the scan — the help body intentionally documents the Phase-3 renames (e.g., `/devt:init → /devt:setup --init`) as a guide for users with muscle memory; those refs to deleted commands are pedagogical and would otherwise be false positives.
- Memory integration check (`forensics`, `session-report`, `weekly-report` commands) removed — those commands no longer exist; the user-facing memory documentation moves to the family-head level.
- Stale assertions for `commands/uninstall.md`, `commands/tokens.md`, `commands/mcp-stats.md` removed (workflows still exist, the command files are gone).
- `bash-guard` perf budget bumped from 4500ms to 6000ms — flaky under macOS load variance; still catches catastrophic slowdowns.

**Deleted command files** (18): clarify, fast, docs, retro, pause, cancel-workflow, defer, init, update, uninstall, health, arch-health, quality, forensics, session-report, weekly-report, tokens, mcp-stats.

**Help rewrite** — `commands/help.md` rewritten for the post-Phase-3 reality: default view shows 15 visible commands + parameter surface; `--all` adds the 4 specialized direct-callable tools plus a "What happened to /devt:init, etc?" migration table mapping old direct forms to new family-head + parameter forms.

Smoke: 843/843 (847 → −6 stale assertions + 2 K94 buckets merged into one). Locking: 3/3.

---

### Phase 2.6 — Drift-class guards K97 + K98 (validation completeness)

After Phase 2.5, a structural validation pass surfaced two additional drift classes worth locking:

- **K97 — stale-reference scan in contract files.** Every `/devt:<name>` reference in `commands/`, `workflows/`, `agents/`, and `skills/` must resolve to an existing `commands/<name>.md`. Catches: typos, renames that miss callers, references to commands deleted without updating the references. Allowlist for known meta-syntactic placeholders (`review-parallel` is internal-only per `code-review-parallel.md`; `command-name` is a generic doc placeholder).
- **K98 — `workflows/do.md` ↔ `agents/devt-coordinator.md` routing parity.** The two routing tables are documented as mirrors; the drift note in `do.md` says "the smoke test enforces row-count parity but does not catch column-content drift." K98 closes that gap: extracts the "Route to" column from each, sorts, and asserts byte-equal output. Currently 19 routes match between the two files.
- **`workflows/do.md` header text aligned** with `agents/devt-coordinator.md` ("If the prompt describes..." everywhere).

Smoke: 849/849 (was 847 + K97 + K98).

---

**Command surface stratification — 36 commands cut to 14 visible.** Adds `user-invocable: false` to 22 advanced/admin/telemetry commands so they're hidden from the `/`-autocomplete menu while remaining fully typed-callable. The casual-user mental model collapses from 36 equal-tier commands to 14 (6 Tier-1 daily entries + 6 Tier-2 verbs by intent + 2 knowledge commands). Aligns with the surface size of every successful CC plugin we measured: superpowers (14 skills), document-skills (18), feature-dev (1 command), pr-review-toolkit (1) — devt was the outlier at 36.

This is Phase 1 of a 3-phase parameterization roadmap (the only phase shipped here). Phase 2 will wire parameter routing onto family heads (`/devt:workflow --mode=specify`, `/devt:status --report=session`, etc.). Phase 3 will delete the now-hidden command files and mass-update the ~200 internal cross-references to use the family-head + param form. Per current "no real users yet, ignore backward compat" stance, each phase ships clean without transitional shims.

**Hidden (22):** clarify, fast, docs, retro, pause, cancel-workflow, defer, init, update, uninstall, health, arch-health, quality, forensics, session-report, weekly-report, tokens, mcp-stats, preflight, autoskill, thread, council.
**Visible (14):** do, workflow, specify, plan, research, implement, debug, review, ship, status, next, memory, help, note.

### Added

- **`commands/help.md`** — rewritten with tiered display. Default `/devt:help` shows only Tier 1 (daily) + Tier 2 (verbs by intent) + Tier 3 (knowledge) = 14 commands. New `--all` flag surfaces the full 22-command advanced inventory grouped by family (workflow modes, lifecycle, admin, architecture, telemetry, specialized) plus the Phase 2 parameter-consolidation roadmap. Old help was 220 lines listing all 36 commands equally; new help leads with the casual-user working set.
- **`scripts/smoke-test.sh::K94`** — locks the stratification contract. Asserts every command in the 14-visible list lacks `user-invocable: false`, every command in the 22-hidden list has it, and the totals match the disk inventory. Drift-class guarded: any new command added without an explicit tier decision will fail K94, forcing the maintainer to classify it before merge.

### Validated against competitor surface

| Plugin | Commands | Skills | Total user-visible | UX model |
|---|---:|---:|---:|---|
| devt before this change | 36 | 17 | 51-64 | command-first, equal tiers |
| devt after Phase 1 | 14 visible (36 callable) | 13 visible | 27 | command-first, stratified |
| superpowers (Anthropic) | 0 | 14 | 14 | skill-first |
| document-skills (Anthropic) | 0 | 18 | 21 | skill-only |
| feature-dev (CC official) | 1 | 0 | 4 | one entry command |
| pr-review-toolkit | 1 | 0 | 7 | one entry command |

devt is now in the LOW range for top-level commands without losing any underlying functionality. All 36 commands remain installed and direct-typed-callable; only autocomplete surface is reduced.

### Why hide instead of delete (Phase 1 only)

Cross-reference audit before deletion: the 23 to-be-hidden commands have **203 total references** across workflows/, commands/, agents/, skills/, guardrails/, docs/, README.md, and CLAUDE.md. `/devt:clarify` alone is referenced 27 times; `/devt:preflight` 19 times. A single-commit "clean rewrite" with deletions would require touching ~50 unique files for routing updates and is too risky for one cycle. Phase 1 (frontmatter-only) is fully reversible per-file and ships immediate UX clarity. Phases 2-3 land structural cleanliness without the all-or-nothing risk.

---

**Per-hook migration ROI CLI — observability before any hook-type change.** New `node bin/devt-tools.cjs hook-cost-estimate [--window=7d|24h]` subcommand reads `.devt/state/hook-trace/run-hook.jsonl` and reports, per hook script: fire count in the window, brittleness score (JS-regex + shell pattern count), estimated tokens-per-fire if migrated to `prompt`-type hook, estimated weekly LLM cost in USD, added latency, and a recommendation (`migrate` / `consider` / `stay`). Cross-references `hooks/hooks.json` to discover each script's event(s) so lifecycle hooks (SessionStart, Stop, SubagentStart/Stop, UserPromptSubmit, etc.) are never recommended for prompt-hook migration regardless of brittleness — they don't make decisions and would be pure cost. Built as the empirical foundation for future hook migration decisions: pick from data, not intuition.

On the live devt trace (7 days, 2,413 fires), the tool classifies `dispatch-hygiene-guard.sh` as the single best migration candidate (138 fires, 10 JS-regex literals from the recent v0.91.0 false-positive fix, exits-nonzero=3 indicating real denial activity, est cost $0.04/wk), with `context-monitor.sh` and `memory-auto-index.sh` flagged for `consider` review (cost-driven — both fire on PostToolUse `*` with large stdin payloads, ~$6/wk and $5/wk respectively). Critical security guards like `bash-guard.sh` correctly stay shell-backed because their fire rate exceeds the migration cap.

### Added

- **`bin/modules/hook-cost.cjs`** (new module, ~130 lines). Reads JSONL trace, joins with `hooks/hooks.json` event map, scores brittleness from hook body content (counts `.test(` / `.match(` JS-regex calls + bash `=~` + shell `grep -E` / `sed -E` / `awk`). Output shape: `{ok, window_days, trace_file, total_hooks, summary: {migrate[], consider[], stay[], total_est_cost_usd_per_window}, hooks: [{hook, events, fires, exits_nonzero, avg_stdin_bytes, lines_of_code, regex_count, brittleness, est_tokens_in_per_fire, est_tokens_out_per_fire, est_cost_usd_per_fire, est_cost_usd_total, est_latency_added_sec_total, recommend}, ...]}`. Sorted by fire count descending. Recommendation thresholds: `brittleness ≥ 4 AND fires ≤ 200 → migrate`; `brittleness ≥ 3 OR cost ≥ $0.50 → consider`; lifecycle-only events (SessionStart, Stop, SubagentStart/Stop, etc.) always → `stay`.
- **`bin/devt-tools.cjs`** — registers `hook-cost-estimate` subcommand (~5 lines).
- **`scripts/smoke-test.sh::K93`** — synthetic trace fixture (dynamic timestamps via `date -u`, 3 hooks: dispatch-hygiene-guard at 50 fires, bash-guard at 1000 fires, session-start at 5 fires) verifies the classification contract: dispatch-hygiene-guard → `migrate`, bash-guard → `stay` (fires > 200 cap), session-start → `stay` (lifecycle event). Also probes the `--window=24h` flag and asserts invalid windows surface as `{ok: false, error: ...}` with exit 1 (wrapped in `|| true` under pipefail per K91 pattern).

### Validated against real telemetry — findings worth preserving

- **JS-regex inside `node -e` is devt's pattern-matching style, not shell tools.** First-cut brittleness probe counted `grep -E` / `sed -E` / `awk` and returned 0 for every hook. Audit of `dispatch-hygiene-guard.sh` (which has 10+ regex literals) revealed they're all `.test(/<scope_trust>/)`-style inside heredoc-embedded JS. The cost module's brittleness count corrects for this — `.test(` + `.match(` carry the real signal.
- **Fire-rate dwarfs brittleness for high-volume monitoring hooks.** `context-monitor.sh` has zero brittleness but fires 1,075 times/week with 24 KB average stdin — extrapolated `prompt`-hook cost ≈ $6.21/week. The "consider" recommendation here isn't about brittleness; it's a cost-awareness flag. (In practice, monitoring hooks rarely warrant migration regardless.)
- **The 200-fires migrate-cap protects security guards by design.** Without it, `bash-guard.sh` could slip into `migrate` if its brittleness grew — turning a critical denial guard into a 1.5-second-latency LLM call on every Bash invocation would be a regression. The cap is empirically tuned to devt's hook fire distribution and validated by K93.

## [0.92.0] - 2026-06-13

**Adopt modern Claude Code plugin primitives — additive frontmatter only.** Eight files touched, ~10 lines added, zero deletions. Surfaces plugin display metadata, opts agents into cross-session memory continuity where it helps, and hides preload-only helper skills from the `/` menu. Aligns with CC `plugins-reference` (v2.1.143+ `displayName`, v2.1.154+ `defaultEnabled`) and the `skills` doc's `user-invocable` field. No behavior change for current sessions; net win is surface-area clarity and per-agent memory continuity for architect / researcher / tester across sessions.

### Added

- **`.claude-plugin/plugin.json`** — `displayName: "devt"` (CC v2.1.143+ UI surfaces) and `defaultEnabled: false` (v2.1.154+). The `defaultEnabled: false` only affects NEW installs — existing users with explicit enablement are unaffected. Devt reshapes the development loop substantially (14 hooks, 11 agents, custom MCP) — opt-in matches the CC doc's recommendation for plugins that add cost or scope.
- **`agents/architect.md`, `agents/researcher.md`, `agents/tester.md`** — `memory: project` frontmatter. Auto-injects `.claude/agent-memory/<agent>/MEMORY.md` (200 lines / 25 KB cap) at agent startup; subagent self-curates across sessions. Architectural patterns, research findings, and known flaky-test contexts now persist. Deliberately skipped: programmer (impl context churns too fast), verifier (per-task), docs-writer (derives from current code), devt-coordinator (stateless router). code-reviewer / curator / debugger / retro already had `memory: project`.
- **`skills/memory-pre-flight/SKILL.md`, `skills/dispatch-helpers/SKILL.md`, `skills/memory-curation/SKILL.md`, `skills/scratchpad/SKILL.md`** — `user-invocable: false` frontmatter. These four are preload-only helpers consumed by agents via the `skills:` frontmatter list; users never type `/devt:memory-pre-flight` etc. Hiding from the `/` menu reduces catalog noise without affecting preload or Skill-tool invocation.

### Considered, validated NOT to change

- **Graphify delegation** — no standalone graphify plugin in the install registry (`~/.claude/plugins/installed_plugins.json`); devt's `mcp__plugin_devt_devt-graphify__*` is the only graphify MCP in the ecosystem. The ~1,950-LOC adapter is justified.
- **Agent `effort:` adoption** — already 100% on all 11 agents.
- **Skill progressive disclosure pass** — largest SKILL.md is `council` at 496 lines; none exceed the 500-line guideline.
- **`disable-model-invocation: true`** on internal helpers — per CC skills doc, this *also* blocks preload into subagents, which would break devt's `skills:` agent frontmatter contract. `user-invocable: false` is the correct field for "hide from `/` menu, keep preloadable".
- **`userConfig` migration** of `graphify.command` / `arch_scanner.command` / `memory.paths` — would force existing `.devt/config.json` users to re-enter values for marginal gain. Defer.
- **Hook-type migration** (shell → `prompt` / `mcp_tool` / `agent`) — needs per-fire token-cost measurement before broader adoption.

### Fixed

- **`scripts/smoke-test.sh::K84` no longer wipes uncommitted maintainer edits in `skills/` or `guardrails/`.** Prior behavior: K84 runs `node bin/devt-tools.cjs static-compress --plugin-build --allow-dirty` (which writes compression artifacts on top of any in-progress files), then resets via `git -C "$ROOT" checkout guardrails skills` to keep the smoke run side-effect-free. Side effect: the checkout also wiped any uncommitted maintainer edits in those directories. Fix wraps the test in a **capture-diff → run-test → reset → reapply-diff** pattern: `git diff -- guardrails skills > "$PATCH"` BEFORE the test, the existing reset AFTER, then `git apply --whitespace=nowarn "$PATCH"` to restore the prior working state. Empty diff = no-op; apply failure warns but doesn't fail the test (saved patch path printed for manual recovery). Untracked files are unaffected by either operation, so they survive without intervention. Verified by snapshotting `user-invocable: false` in the 4 affected SKILL.md files before smoke ran, executing smoke (843 pass), and confirming the field was still present after.

## [0.91.0] - 2026-06-10

**Content-aware dispatch hygiene gate — closes the v0.90.0-audit I1 false-positive class.** Greenfield reported that the `dispatch_hygiene_mode: block` gate flagged hand-injected envelopes identically to truly raw dispatches: a code-reviewer prompt that carries `<context>` + `<original_review>` + `<mode>synthesis_revision</mode>` (iter-2 revision pattern) was treated the same as a bare-prose "You are reviewing Lane A" prompt. The hand-injected case is the workflow's legitimate ergonomic — orchestrator hand-rolls a richer envelope than the canonical scope_*/memory_signal trio. Gate now recognizes content-aware signals.

Field telemetry (greenfield's `.devt/state/dispatch-warnings.jsonl`): of 24 raw_dispatch records, 3 were the hand-injected-envelope false-positive class. Of the 21 remaining, all are legitimate raw dispatches (Lane reviewers with no envelope structure) that the gate correctly continues to catch.

Smoke: 843 passed, 0 failed (+1 K92). Locking: 3/3.

### Fixed

- **`hooks/dispatch-hygiene-guard.sh` now recognizes 7 additional envelope signals.** Prior implementation gated on `<scope_trust>` OR `<scope_hint>` OR `<memory_signal>` (the canonical workflow-managed trio). Expanded set: `<context>`, `<graph_impact>`, `<original_review>`, `<lane_scope>`, `<god_node_warnings>`, `<prior_outputs>`, `<provenance_protocol>`. ANY one of these (in addition to the canonical three) is now sufficient signal that the orchestrator hand-injected an envelope — content-aware detection. Truly bare-prose dispatches (no XML envelope structure at all) STILL deny when `dispatch_hygiene_mode=block`. The `ENVELOPE_NOT_REQUIRED` set (docs-writer, retro, curator, devt-coordinator) is unchanged. K92 locks the contract with 3 fixtures: hand-injected `<context>` passes, docs-writer with no envelope passes (different exemption path), bare-prose denies.

### Backlog persisted (v0.92.0+)

Per `.devt/state/v091-backlog.md` (RESET_EXEMPT), remaining items ranked by next-cycle value:
1. Smoke gate audit + `node bin/devt-tools.cjs smoke list` introspection
2. `recover-partial-impl` extension for verifier + tester (currently programmer-only)
3. `DEVT_VALIDATE_ENFORCE=1` TODO at state.cjs:377 — shadow-mode validation has been running long enough to evaluate enforcement
4. `state update-json` new subcommand for operator ergonomics

## [0.90.2] - 2026-06-10

**Deep-validation patches — DV1 + DV2 fixes for incomplete v0.90.0 claims.** A deeper validation pass against the v0.90.0 trajectory surfaced two cases where CHANGELOG language exceeded actual code coverage. Both fixes ship as a patch since they restore the contract the CHANGELOG promised rather than introducing new behavior.

Smoke: 842 passed, 0 failed (+1 K86b). Locking: 3/3.

### Fixed

- **DV1: `dispatch decompose` wrapper_bytes no longer goes negative on envelopes with multi-occurrence tags.** v0.90.0 B1 fixed strict nesting (e.g. `<review_checklist>` inside `<governing_rules>`) by adding the `nested_in` ancestor analysis. But when a tag like `<task>` appeared MULTIPLE times in an envelope (literal mentions in CLAUDE.md prose inside the `<governing_rules>` block, plus the real dispatch `<task>` block), the byte-summation approach treated each occurrence as a sibling outermost range. Sum of static + dynamic could exceed total, producing negative wrapper_bytes. Live evidence: devt's own verifier:dev envelope returned `wrapper_bytes: -11710`. Fix: replace summation with per-byte coverage tracking. Each byte in the rendered envelope is attributed to at most one tag (the outermost containing it); wrapper_bytes = total - bytes-painted. Mathematically eliminates the double-count class entirely. K86b regression guard locks the invariant.

- **DV2: `compressFile` backup-readback read-error path now logs to `static-compress.jsonl`.** v0.90.0 B2 claim was "ALL return paths log", but 1-of-12 returns in `compressFile` was still a bare `return` — the catch-block for `fs.readFileSync` errors on the backup file (disk corruption, antivirus interference at the worst moment). The branch where the audit trail matters MOST was the one missing it. Fix: route the catch-block return through `_logAndReturn("compress", ...)` consistent with the other 11 paths.

### Backlog (persisted for v0.91.0)

The deeper validation pass produced an actionable backlog at `.devt/state/v091-backlog.md` (RESET_EXEMPT, gitignored). Highest-leverage next-cycle item: content-aware dispatch hygiene gate (2,218 raw_dispatch warnings vs 1 of any other type in field — 3 orders of magnitude dominant signal).

## [0.90.1] - 2026-06-10

**Post-v0.90.0 code-review fix — `--allow` whitelist hardened to basename match.** A code-review pass surfaced an over-permissive match in the v0.90.0 G7 `--allow` flag: prior implementation matched the pattern as substring anywhere in the path, so `--allow=.ssh/` would have bypassed `nested/.ssh/id_rsa` (because `.ssh/` appears as substring). Every documented field-evidenced use case (`.env.example`, `.env.sample`, similar template basenames) is a filename pattern — not a path component. Fix: switch to basename-equality OR basename-prefix match. Closes the path-traversal-via-substring bypass surface without affecting any legitimate use case.

Smoke: 841 passed, 0 failed (+1 K91b). Locking: 3/3.

### Fixed

- **`graphify --allow=<pattern>` now matches against `path.basename(f)` only**, not the full path string. `--allow=.env.example` correctly bypasses `configs/.env.example` (basename equals). `--allow=.ssh/` no longer bypasses `nested/.ssh/id_rsa` (basename is `id_rsa`, doesn't start with `.ssh/`). Match is equality OR prefix on the basename — covers documented use cases (`.env.example` exact, `.env-` prefix family) without widening the bypass surface. K91b regression guard added.

## [0.90.0] - 2026-06-10

**Greenfield audit response — 7 operational fixes across 4 subsystems.** Greenfield's calibration report on the v0.84.0 → v0.89.0 trajectory surfaced 11 candidate items. After per-item root-cause validation (reproduced each on greenfield's filesystem, read the relevant module, confirmed the cause), 7 ship here. The validation-first discipline paid off: G5 (mcp-stats --workflow-id history walk) turned out to be already-implemented and working correctly — what greenfield reported as a bug was a documentation gap (historical-id queries stay strict by design; current-id queries walk the chain). 4 items deferred to v0.91.0+ (content-aware dispatch hygiene, state-update JSON auto-detect, per-agent inlining, MCP description trimming) because they need more design work or behavioral validation.

Smoke: 840 passed, 0 failed (+5 K87–K91). Locking: 3/3.

### Fixed

- **B1: `dispatch decompose` no longer returns negative wrapper_bytes.** Greenfield reported `wrapper_bytes = -3,225` for their code-reviewer envelope. Root cause: tags nested inside other tags (e.g. `<review_checklist>` inside `<governing_rules>`) were summed both as the parent's bytes AND as the child's, double-counting and producing negative residuals. Fix: walk the tag ranges and identify each tag's outermost ancestor (`nested_in` field). Only outermost-tag bytes count toward `static_bytes`/`dynamic_bytes` totals; nested tags appear in `blocks[]` with `nested_in: <parent_tag>` for visibility but don't contribute to summary sums. Verified on greenfield: code-reviewer envelope wrapper_bytes -3,225 → +1,051 (positive, ~1.3% — XML markup overhead). K86 extended with non-negative + `nested_in` field assertions.

- **B2: `static-compress.jsonl` now persists log entries for ALL return paths, not just success.** Greenfield reported the log file was absent on their filesystem despite 14 files being compressed. Root cause: `_logEntry` was only called on the success branch of `compressFile` / `restoreFile`. Refusal returns (mode=off, sensitive path, backup exists, drift, empty, identical-output, etc.) never persisted. So a typical "compressed once, re-ran and got backup-exists refusals" workflow left no audit trail. Fix: introduce `_logAndReturn` helper used by every return statement; refusal entries carry `reason` for forensic clarity. K87 verifies 3 distinct return paths (mode=off refusal, success, backup-exists refusal) all log.

- **B4: `workflow_id` no longer rotates on every `init *` call within an active workflow.** Greenfield observed 42 IDs in `workflow_id_history` for one conceptual workflow — `mcp-stats --workflow-id=<current>` returns the right answer (G5 walks the chain) but downstream correlation analysis is noisy and confusing. Root cause: `init.cjs` unconditionally stripped `created_at` + `workflow_id` from `workflow.yaml` on every devt command, forcing `updateState` to treat each as a fresh activation and re-stamp. Fix: read the existing `workflow.yaml::active` flag before stripping. When `active=true`, preserve `workflow_id` + `created_at` (only lanes get stripped — they're workflow-scoped per H7). When `active=false` (or absent), strip as before so closed workflows get fresh stamps on next activation. K88 verifies both branches.

- **G2: `graphify symbols-in-files` returns an envelope, not a bare array.** Greenfield reported the bare `[]` return silently collapsed three distinct states ("no input files", "graph not loaded", "no nodes match"). New shape: `{symbols, reason, graph_lag_commits, total_matches}`. `reason` explains WHY symbols is empty; `graph_lag_commits` lets the orchestrator decide whether to re-index before trusting an empty answer; `total_matches` preserves the "limit truncated to N of M" signal. Breaking change for the one workflow consumer (`workflows/code-review.md:200` updated from `jq '.[].symbol'` to `jq '.symbols[]?.symbol'`). K30 fixture updated; K89 added.

- **G6: `graphify lane-suggestions` returns `mode=fallback` when partition is too skewed.** Greenfield observed a 230-file giant + 3 noise buckets passing through as `mode=partial`, forcing the orchestrator to discard the result. Fix: when the largest community group exceeds 40% of covered scope (`skew_ratio > 0.40`), downgrade `mode=partial` → `mode=fallback` with `reason` explaining the skew. Saves orchestrators a wasted dispatch decision. K90 verifies a synthetic 102/5/3 fixture (93% skew) → `mode=fallback`.

- **G7: `graphify --allow=<substring>` whitelist for sensitive-path filter.** Greenfield reported the sensitive-path denylist phantom-rejects `.env.example` / `.env.sample` (committed templates with no real credentials). Fix: new `--allow=<substring>` CLI flag (repeatable) bypasses the denylist when any pattern matches the path. Refusal stderr now hints at the flag. Plain substring match — kept deliberately simple so users can copy from the refusal output. K91 verifies `.env.example` is refused without the flag and allowed with `--allow=.env.example`.

- **D1: `dispatch decompose` now surfaces in `/devt:help`.** Greenfield's first reaction to v0.89.0 was "I didn't discover the tool from any doc read this session." The CLI shipped + documented in README + INTERNALS, but the workflow contract was the discovery path most operators used. Help text now includes the decompose CLI in the Diagnostics section, paired with `/devt:tokens`.

### Stood down (validated as already-working or out of scope)

- **G5: `mcp-stats --workflow-id` history walk.** Greenfield reported `--workflow-id=<current>` returns 0 calls. Verified on greenfield's filesystem: with the CURRENT workflow_id, mcp-stats returned 61 calls (history walk fired). With a HISTORICAL workflow_id, strict 1-hop is the documented + intentional behavior (lets operators debug specific rotations). The code at `bin/modules/mcp-stats.cjs:163-194` already implements exactly this contract. Greenfield's "bug" was a documentation/expectation gap — `--workflow-id` does what its help text says, just not what greenfield expected.

### Deferred to v0.91.0+

| Item | Source | Why deferred |
|---|---|---|
| Content-aware dispatch hygiene gate (inspect Task() prompt for canonical envelope blocks) | greenfield I1 + 1 | Needs design — the gate is currently pattern-based; content awareness requires reading the dispatched prompt body which has different access semantics |
| `state update key={json}` auto-detect JSON-shaped values | greenfield 4 | Backward-compatibility risk — existing callers pass `key=string-value` expecting string semantics; auto-detect could surprise |
| Per-agent selective inlining of `governing_rules` | research backlog | Needs per-agent behavioral validation; v0.90.0 ships the CLI (B1 fix) that makes this measurable |
| MCP description trimming | research backlog | Smallest leverage (~9 KB amortized); deferred until other levers exhausted |

## [0.89.0] - 2026-06-10

**Measurement-pivot release: `dispatch decompose` CLI + honest doc-update.** Real-workflow measurement in greenfield-api showed static-compress saves only 0.06–0.19% per rendered dispatch envelope (vs the 4–15% disk-level savings README implied). Deep research (5-source adversarial verification) confirmed: at 88%+ prompt-cache hit rate, in-place compression of cached system content can NET NEGATIVE due to Anthropic's cache hierarchy (any edit invalidates downstream cache at 1.25× write vs 0.1× read). The empirically validated highest-leverage lever for devt is per-agent selective inlining of `governing_rules` (83.5% of verifier:dev envelope is one block, mostly `CLAUDE.md`). Per-agent surgical change is risky without behavioral validation, so v0.89.0 ships the measurement tool first; the inlining work follows as v0.90.0 with proper per-agent validation.

Smoke: 835 passed, 0 failed (+1 K86). Locking: 3/3.

### Added

- **`dispatch decompose <agent>:<workflow_id|auto>` CLI** (`bin/modules/dispatch.cjs::cmdDecompose`). Pure read-only: renders the envelope (via existing `cmdRenderFilled`), classifies each XML block as static or dynamic via the `STATIC_TAGS` / `DYNAMIC_TAGS` registries, returns JSON with summary (`total_bytes`, `static_bytes`, `dynamic_bytes`, `wrapper_bytes` + percentages) and a `blocks[]` array sorted by byte size desc. Use to answer "which static block dominates my envelope?" before any per-agent inlining surgery. Same `:auto` semantics as `render-filled` for workflow_id resolution.
- **K86 smoke gate**. Asserts JSON shape (`.summary`, `.blocks`), pct components sum to ~1.0, `governing_rules` correctly classified as static when present, `cmdDecompose` exported for downstream consumers.

### Changed

- **README static-compress section now honest**. The prior claim "~87% of envelope cost" was for the `guardrails_inline` block (plugin source), but empirical measurement showed the dominant block is `governing_rules` (project rules, mostly `CLAUDE.md`). The per-dispatch wire savings from static-compress in real workflows are 0.06–0.19%, much smaller than the 4–15% disk-level reduction suggested. README now reflects measurement, not aspiration. Introduces the new `dispatch decompose` CLI as the user-facing tool for envelope-cost investigation.
- **INTERNALS.md** documents K86 row in the smoke-gate table.

### Research-validated next step (v0.90.0+ backlog)

The 5-source adversarial-verified research (cited in commit message) ranks the highest-leverage levers for devt's regime (88%+ cache hit rate, 37–115 KB envelopes):

1. **Per-agent selective inlining of `governing_rules`** — surgical change requiring per-agent behavioral validation. Largest empirical leverage (~30 KB / dispatch when applicable).
2. **Reduce Task() dispatch count per workflow** — orchestration surgery; merge adjacent steps where scope permits.
3. **MCP description trimming** — small leverage (~9 KB amortized), risk of degrading tool-selection quality.

v0.89.0 ships the measurement tool only. The actual inlining work waits for per-agent validation (sub-agent behavior, not just envelope sizes).

## [0.88.3] - 2026-06-10

**README doc-parity with v0.88.0 default flip.** v0.88.0 flipped `DEFAULTS.static_compress.mode` from `'off'` to `'on'` in code, but README still documented the old default in 3 places (JSON config example line 417, config table row line 449, broken anchor link to the renamed section heading). Reader-facing docs now match the shipped behavior.

Smoke: 834 passed, 0 failed (no test change — doc fix only).

### Fixed

- **README JSON example** at line 417 now shows `"mode": "on"` to match v0.88.0's flipped default.
- **Config reference table row** for `static_compress.mode` rewritten: removed "opt-in" framing, updated `Default` column to `on`, inverted the explanation to describe the opt-out path instead of the opt-in path, fixed the section anchor from `#optional-static-file-compression-built-in` to `#static-file-compression-built-in` (the heading lost its "Optional:" prefix in v0.88.0).

## [0.88.2] - 2026-06-10

**prose-shrink fix surfaced by greenfield rollout — inline triple-backticks no longer break real fence protection.** Running `static-compress --all` against greenfield's `.devt/rules/quality-gates.md` revealed a previously-uncaught prose-shrink bug. The file used a blockquote-style inline example like ``` ``` ```bash parallel ``` ``` ``` followed by a real ` ```bash parallel ` fenced block. The earlier unanchored fence-protection regex `/```[\s\S]*?```/g` paired the inline closing backticks with the real fence's opening, leaving the actual code block UNPROTECTED. Downstream `\s+([,.;:!?])` then collapsed `ruff check .` → `ruff check.` inside what should have been protected code, and the structural validator (correctly) refused the compression. Fix: anchor fence-opening AND fence-closing to start-of-line (CommonMark fence rule).

Smoke: 834 passed, 0 failed (K85 extended to 5 fixtures with the inline-backtick regression guard).

### Fixed

- **Fenced code blocks protected by line-anchored regex.** `PROTECTED_PATTERNS[1]` changed from `/```[\s\S]*?```/g` to `/^ {0,3}```[^`\n]*\n[\s\S]*?^ {0,3}```[ \t]*$/gm`. The new pattern enforces the CommonMark rule that fence-open and fence-close must each appear at column 0-3 of a line. Inline triple-backticks in prose (e.g. blockquote examples documenting fence syntax) no longer pair with real fence openings, eliminating the leak that left real code blocks open to prose-level transforms.

### Added

- **K85 Fixture 5 — inline-fence regression guard.** Compresses the exact pattern that surfaced the bug in greenfield (blockquote with inline ` ``` ```bash parallel ``` ``` ` followed by a real fenced block). Asserts `ruff check .` survives byte-equal inside the real block. Prevents regression on this CommonMark interpretation.

## [0.88.1] - 2026-06-10

**CI fix — K81 mtime probe now cross-platform.** v0.88.0's K81 used `stat -f '%m %N'` (macOS/BSD syntax) to snapshot plugin guardrails mtimes for the unchanged-check. On Linux CI runners, `stat -f` is a different flag (filesystem info, not format), so the snapshots diverged spuriously between before/after even though the files were genuinely untouched. Replaced with `sha256sum`-based content hashing — works identically on both platforms AND is semantically stronger: detects actual file content changes, not just mtime touches.

Smoke: 834 passed, 0 failed.

### Fixed

- **K81 plugin-unchanged check uses cross-platform content hashing.** `find -exec stat -f '%m %N'` → `find -exec sha256sum`. The macOS BSD stat syntax was failing on Linux runners; sha256sum is universally available and the content-based comparison is a stronger guarantee than mtime equality.

## [0.88.0] - 2026-06-09

**Headroom removal + default-on flip.** Two orthogonal cleanups in one release:
- **Headroom integration was dead code.** No current `headroom-ai` release ships the `compress` stdin CLI subcommand devt's shellout was written against — the project pivoted to a proxy/MCP architecture. The two-stage probe (v0.86.1) was correctly falling back to regex on every dispatch but added complexity for zero benefit. Stripped from code, README, and docs.
- **`static_compress.mode` default flipped `off` → `on`.** v0.87.1's K85 regression guards + 100% yield on the plugin tree earned the trust. The init-time prompt remains for users who want to opt out at setup. The conservative default outlived its purpose.

Smoke: 834 passed, 0 failed. Locking: 3/3.

### Removed

- **`_runHeadroom()` + `_headroomAvailable()` + two-stage probe** in `bin/modules/static-compress.cjs`. No current installable headroom variant satisfies the probe; the shellout never fired in practice and added a `spawnSync` dependency + stderr noise on the failure path.
- **`headroomAvailable` export** in `bin/modules/static-compress.cjs` and the corresponding consumer in `bin/modules/health.cjs`. The `compression` block in `/devt:health` output no longer exposes `headroom_available` or `engine` fields — there's only one engine now (`prose-shrink` regex), so reporting it is noise.
- **K77 Fixture F (drift-detected revert via faked headroom binary)** in `scripts/smoke-test.sh`. The drift-revert behavior is already locked by K74 (structural-drift validator, 4 fixtures) + K85 (prose-shrink correctness, 4 fixtures + 3 regression guards). K77 is now a 5-fixture round-trip — drift case is covered elsewhere.
- **Headroom mentions from README, `docs/static-compress-recipe.md`, `docs/INTERNALS.md`**. The `headroom proxy` companion section is gone — users who want input-side compression at the session-wrap layer can find headroom independently; devt no longer signposts it because it didn't integrate cleanly.

### Changed

- **`DEFAULTS.static_compress.mode` flipped `'off'` → `'on'`** in `bin/modules/config.cjs`. Projects that don't have a local `.devt/config.json` override inherit the new default. Existing projects with explicit `mode: 'off'` are unchanged. The init-time prompt in `workflows/project-init.md` still asks at setup so users have an explicit consent moment.
- **K77 fixture A now sets `mode='off'` explicitly** instead of relying on the (now-flipped) raw default. Same test intent (verify the disabled-feature refusal path); explicit pin keeps the test independent of the DEFAULTS value.
- **`engine_breakdown` schema simplified** in `compressAll()` and `compressPluginBuild()` results. Was `{ headroom: 0, regex: 0 }`; now just `{ regex: 0 }`.
- **Compression-ratio claims in README + recipe doc honest**. Removed "~40% neural extractive" copy that was always aspirational for current headroom users. Kept the calibrated range ("4–15% on technical specifications, 25–35% on conversational prose").

## [0.87.1] - 2026-06-09

**prose-shrink correctness sweep — plugin-build yield 22% → 100%.** v0.87.0 shipped `static-compress --plugin-build` honestly: 5 of 23 plugin files compressed cleanly, 18 were correctly refused by the structural validator. Each refusal was a real prose-shrink bug masquerading as compressor caution. This release fixes all three root causes; running `--plugin-build` against the plugin tree now compresses all 23 files (with no structural drift) for a 4% total byte reduction on plugin static-load content. The fixes also benefit user-side `static-compress --all` runs because the same bugs were silently degrading compression yield in `.devt/rules/` content too.

Smoke: 834 passed, 0 failed (+1 K85). Locking: 3/3.

### Fixed

- **`ARTICLES` regex no longer matches uppercase letters in lookahead.** The pattern `/\b(?:a|an|the)[ \t]+(?=[a-z])/gi` had a subtle bug: under the `/i` flag, the character class `[a-z]` in the lookahead matched both lowercase AND uppercase letters. This caused the regex to strip "The " from headings like `## The Iron Law` → `## Iron Law`, mangling the title. Fix: drop the `/i` flag so `[a-z]` matches only true lowercase. Tradeoff: sentence-start "The cat" is no longer compressed — a marginal compression loss against the gain of never mangling headings, proper nouns, or sentence-initial articles.

- **Markdown heading lines now sentinel-protected as whole-line atoms.** Even with the ARTICLES fix above, in-heading lowercase articles (`## Step 1: keep the scope fresh` → `## Step 1: keep scope fresh`) were still being stripped, changing heading titles. Fix: added `/^#{1,6}[ \t]+.*$/gm` as the FIRST entry in `PROTECTED_PATTERNS` so the entire heading line gets sentinel-replaced before any compression step runs against the body. Headings emerge byte-equal regardless of which articles or filler words their titles contain.

- **Interior whitespace collapse no longer eats leading indentation.** `s.replace(/[ \t]{2,}/g, " ")` was collapsing ALL multi-space runs, including the 3-space leading indent CommonMark uses for loose-list continuation content and indented code fences inside list items. Result: 3-space-indented `   ```bash` fences became 1-space-indented ` ```bash`, which the structural validator's line-based extractor compared as a different block from the original. Fix: anchor the pattern to require a non-whitespace character before the run (`/(\S)[ \t]{2,}/g`). Interior redundancy (where it actually lives) still collapses; leading line indentation is preserved.

### Added

- **K85 smoke gate — prose-shrink correctness.** 4 behavioral fixtures + 3 regression-guard greps:
  - Fixture 1: `## The Iron Law` heading title preserved byte-equal
  - Fixture 2: `## Step 1: keep the scope fresh` heading title preserved (in-heading lowercase article)
  - Fixture 3: 3-space-indented `   ```bash ... ```` fence preserved byte-equal
  - Fixture 4: lowercase prose `the cat / an example` STILL compressed (no regression on the intended target)
  - Regression guards: ARTICLES regex literal-string absence of `/gi` flag; PROTECTED_PATTERNS entry presence; whitespace-collapse `\S` anchor presence.

## [0.87.0] - 2026-06-09

**Inter-agent context broadening + provenance + maintainer-mode pre-compress.** Three improvements building on v0.86.0 Sidecar-Driven Handoff: (1) sidecar inline injection now reaches tester + code-reviewer dispatches, not just verifier; (2) consuming agents receive a conditional provenance-citation protocol that turns graphify into an auditable signal source; (3) plugin maintainers get a `--plugin-build` CLI that pre-compresses guardrails/ + skills/ so distributed packages ship leaner — closing the architectural gap where user-side `--all` couldn't reach the plugin's own ~32 KB guardrails_inline slice (87% of envelope cost per the v0.80 audit).

Honest scope note on B3: running `--plugin-build` against the current plugin tree compresses 5 of 23 files (the rest trip the structural validator because they start headings with articles like "The Iron Law" — exposing a real prose-shrink bug that a future fix will resolve without code changes here). The CLI ships correct; yield will improve as prose-shrink evolves.

Smoke: 833 passed, 0 failed (+1 K82b, +1 K83, +1 K84). Locking: 3/3.

### Added

- **`{prior_outputs}` token now reaches tester + code-reviewer envelopes** (5 templates: `tester.tmpl.md`, `tester-quick_implement.tmpl.md`, `code-reviewer.tmpl.md`, `code-reviewer-quick_implement.tmpl.md`, `code-reviewer-code_review.tmpl.md`). v0.86.0 scoped sidecar injection to verifier (dominant consumer); v0.87.0 broadens to the other 3 consuming agents. Tester sees programmer's impl-summary.json before its initial Read; code-reviewer in dev/quick_implement sees programmer + tester sidecars. Auto-discovery + self-filter still apply — each agent never inlines its own sidecar even if present. K82b locks the contract.

- **`{provenance_protocol}` substitution token** (`bin/modules/dispatch.cjs::DATA_REFS`). Conditional injection — populated ONLY when `.devt/state/graph-impact.md` exists (graphify ran for this dispatch). The block (~500 bytes) instructs the consuming agent to cite `(via call: <corr_id>)` when a finding traces back to a `## Drill-down: <SYM> [call: <id>]` section in graph-impact.md. The 8-char hex correlation_id maps 1-to-1 to a specific MCP call resolvable via `mcp-stats --correlation-id=<id>`. Closes greenfield's audit finding #5: "WHAT was called, not WHAT signal was delivered" — converts graphify from an opaque dependency into an auditable signal source. In graphify-skip flows the block is absent (would waste tokens with nothing to cite). Wired into verifier.tmpl.md, verifier-code_review.tmpl.md, code-reviewer.tmpl.md, code-reviewer-quick_implement.tmpl.md, code-reviewer-code_review.tmpl.md. K83 locks the contract.

- **`static-compress --plugin-build` CLI for plugin maintainers** (`bin/modules/static-compress.cjs::compressPluginBuild`). Pre-compresses the plugin's OWN `guardrails/**/*.md` + `skills/**/SKILL.md` at release-build time so distributed packages ship leaner content. This is the only path to reach the ~32 KB `guardrails_inline` slice that dominates per-dispatch envelope cost — user-side `static-compress --all` deliberately excludes the plugin tree per the v0.85.0 source/distribution boundary. Distinct semantics from `--all`: NO `.original.md` backup written (the plugin tree is git-managed; `git checkout` is the canonical undo). Refuses to run when guardrails/ or skills/ have uncommitted changes (override via `--allow-dirty` for CI/testing) so the maintainer's compression diff is always reviewable and reversible via git. Same 5 safety layers (sensitive-path denylist, size cap, empty-input refusal, identical-output refusal, structural-drift validator). K84 locks the CLI contract.

- **K82b smoke gate — sidecar consumer broadening.** Validates tester sees programmer (not own tester sidecar); code-reviewer in dev sees programmer + tester (not own review sidecar); all 5 broadened templates carry the `{prior_outputs}` placeholder.

- **K83 smoke gate — provenance citation protocol.** Validates conditional injection: graphify present → protocol block AND `(via call:` syntax both inlined; graphify absent → protocol block omitted entirely (no token waste in skip flows). Template regression guard asserts both verifier + code-reviewer-code_review carry the `{provenance_protocol}` placeholder.

- **K84 smoke gate — plugin maintainer-mode CLI surface.** Validates `--plugin-build` walker finds all 23 plugin static-load files (5 guardrails + 18 skills), result shape consistent with `compressAll` for telemetry continuity, errors[] array populated (most files currently trip structural validator — that's the safety net working correctly, not a regression). Usage advertises the new flag. Uses `--allow-dirty` to override the clean-tree check in smoke runs; restores plugin tree via `git checkout` post-test so the smoke run is side-effect-free.

## [0.86.1] - 2026-06-09

**Validation-pass patches against the v0.86.0 Sidecar-Driven Handoff + v0.85.0 Compression Adoption Loop releases.** Probed each release for edge cases after they shipped. Four real findings fixed; one cosmetic finding (blank line when `{prior_outputs}` resolves empty) deliberately deferred — the fix complexity exceeded the 5-bytes-per-dispatch cost.

Smoke: 830 passed, 0 failed (K77 fixture updated to match new two-stage headroom probe). Locking: 3/3.

### Fixed

- **`loadPriorSidecars` now validates JSON before injecting** (`bin/modules/init.cjs`). The v0.86.0 implementation treated sidecar content as opaque string injection — a malformed `impl-summary.json` (mid-write, manual edit, schema drift) would pipe raw garbage like `NOT VALID JSON {` into the consuming agent's dispatch envelope. The fix validates via `JSON.parse` AND re-serializes through `JSON.stringify` to guarantee canonical byte-stable representation (K71 idempotence holds even if a user edits the sidecar with extra whitespace). Also asserts the parsed value is an object (not a scalar like `"42"` which is valid JSON but breaks the schema contract). Invalid sidecars are silently skipped — consistent with existing error handling.

- **`compressAll` now distinguishes "already compressed" from "compressor refused"** (`bin/modules/static-compress.cjs`). The v0.85.0 implementation lumped safety refusals (identical-output, empty-input) into `skipped_already_done`, which falsely implied a `.original.md` backup existed. The two states are disjoint and informational: `skipped_already_done` means "backup file present from a prior run, leaving alone" (idempotent re-run guard); `skipped_no_change` means "compressor considered the file but produced identical output — calling --restore would do nothing because no backup was ever written". The aggregate result now surfaces both as separate arrays.

- **Two-stage headroom binary probe** (`bin/modules/static-compress.cjs::_headroomAvailable`). The v0.81.0 probe ran `headroom --version` only — but some users install the `headroom-ai[proxy]` variant which responds to `--version` but rejects the `compress` subcommand. Result: silent fallback to regex with noisy stderr per file. New behavior: stage 1 confirms binary presence via `--version`; stage 2 confirms subcommand support via `compress --help`. Click's "No such command" exit (status 2) is detected cleanly. Probe result is cached for the lifetime of the Node process — `--all` runs emit the probe-failure message at most once, not N times. Cache does not survive across CLI invocations (each `node devt-tools.cjs` is a new process), acceptable since probes are sub-100ms.

- **Honest compression-ratio claims in README + recipe doc.** v0.81.0 README and docs claimed "~40% reduction" (neural) and "~25-35% reduction" (regex), drawn from caveman's marketing copy. Real-world measurement: 4% on `guardrails/golden-rules.md` (tight technical documentation). The headroom MCP achieved 10.7% avg compression in this session's 12 API requests (per `mcp__headroom__headroom_stats`). Updated claim: "compression depends heavily on prose density — conversational text compresses 25-35% (the regex compressor's design target); tight technical specifications compress 4-15%". The original claims weren't wrong for the content they targeted; they just didn't generalize.

### Changed

- **K77 fixture F (drift-detected revert) updated.** The fake `headroom` binary that simulates a drift-causing compressor now responds to `compress --help` with exit 0, mirroring real click-CLI behavior. Required so the new two-stage probe passes the fake binary through to the drift-simulation path rather than rejecting it as a bad variant at stage 2.

## [0.86.0] - 2026-06-09

**Sidecar-Driven Handoff — eliminate Read tool round-trips on structured agent-to-agent context.** Today, when the verifier dispatches in a `dev` flow, it has no in-context knowledge of what the programmer or tester decided — it pays 1-2 Read tool calls turn-1 just to fetch `impl-summary.md` + `test-summary.md`. The structured handoff data already lives at `.devt/state/<agent>-summary.json` (the JSON sidecars produced for the claim-check + status-routing pipeline) and is tiny (~80 bytes per sidecar — `{status, verdict, agent}` enum triple). This release inlines those sidecars into the consuming agent's dispatch envelope so the structured contract data is in the cached prefix, not behind a Read.

Architectural alignment: this is the "Opportunity 1" from the inter-agent communication deep-dive — the inline-injection pattern devt already uses for `graph_impact_content` (32 KB cap), `guardrails_inline` (64 KB cap), `governing_rules` (96 KB cap). Sidecars are 3 orders of magnitude smaller than any of those caps; even a 4-agent chain stays under 1 KB total. Zero new dependencies. Zero changes to file-based state (sidecars stay on disk — `/devt:pause` + audit + claim-check + recover-partial-impl all keep working identically). Workflow-agnostic: whatever sidecars happen to exist at dispatch time, the consuming agent receives them. Auto-discovery instead of per-agent declaration keeps the contract surface small.

Smoke: 830 passed, 0 failed (+1 K82). Locking: 3/3.

### Added

- **`loadPriorSidecars(projectRoot, consumerAgent)` in `bin/modules/init.cjs`.** Mirrors `loadGraphImpact` exactly. Walks the canonical `JSON_SIDECAR_SCHEMAS` mapping (`impl-summary.json` → programmer, `test-summary.json` → tester, `verification.json` → verifier, `review.json` → code-reviewer), reads any that exist in `.devt/state/`, returns concatenated `<prior_outputs>` block with each sidecar wrapped in `<<producer>_sidecar>…</<producer>_sidecar>`. Skips the consumer's own sidecar so verifier never sees a stale verification.json from a prior phase. Defensive 8 KB cap on total block size — realistic payloads land well under 1 KB; cap exists for an ill-formed sidecar that ballooned somehow.

- **`{prior_outputs}` substitution token in `bin/modules/dispatch.cjs`.** Added to `DATA_REFS` alongside `graph_impact_content`. `buildSubstitutionTable(agent)` now takes the consuming agent's name and resolves `prior_outputs` via `loadPriorSidecars(projectRoot, agent)`. Backwards-compatible: when `agent` is undefined (legacy callers) the token resolves to empty string. `cmdRenderFilled` already knows the agent, so it threads it through automatically.

- **`{prior_outputs}` placeholder in verifier templates** — added to both `templates/dispatch/envelopes/verifier.tmpl.md` (dev workflow) and `templates/dispatch/envelopes/verifier-code_review.tmpl.md` (code-review workflow). Placed just before `<files_to_read>` so the structured handoff is read first, then full markdown bodies are available for verbatim citation. Workflow envelopes synced via `dispatch compile --write`. The `tester` and `code-reviewer` agents COULD also consume sidecars but are deferred to a future release — verifier is the dominant consumer (reads 3 sidecars in dev flow) and validating the pattern there before broadening minimizes scope risk.

- **K82 smoke gate — sidecar inline injection round-trip.** 4-assertion fixture: with `impl-summary.json` + `test-summary.json` + `verification.json` present, rendered envelope carries `<programmer_sidecar>` + `<tester_sidecar>` blocks AND `<prior_outputs_note>` but EXCLUDES `<verifier_sidecar>` (own-sidecar filtering). Without any sidecars present, the rendered envelope has no `<prior_outputs>` block at all (graceful degrade). Template regression guard asserts `{prior_outputs}` token is present in `verifier.tmpl.md`.

## [0.85.0] - 2026-06-09

**Compression Adoption Loop — close the 30-day-zero-adoption gap.** Greenfield's H1 audit revealed that static-compress (shipped v0.81.0, polished v0.83.0) had been live for 30+ days with zero invocations. After deep validation, the gap turned out to be friction, not algorithm quality: defaults conservative, manual per-file, no measurement, no init-time surface. This release ships a coherent closed-loop bundle that addresses each friction point individually while preserving every existing safety layer.

The loop: `/devt:init` offers compression at the explicit-consent moment → `static-compress --all` runs the bulk compress once → `/devt:health` aggregates savings from the JSONL log → `token-report` cross-references compression activity against cache-hit windows. Each component reuses existing devt infrastructure (consent UI mirrors `prompt_graphify_first_build`; bulk walker reuses `compressFile`; metric aggregation reuses Claude Code's existing `cache_read_input_tokens` field; safety layers untouched). Zero new dependencies, no LLM routing, no auth concept.

Smoke: 829 passed, 0 failed (+1 K81, +1 J2 fix). Locking: 3/3.

### Added

- **`static-compress --all` bulk-compress mode.** Walks PROJECT-OWNED static-load surfaces (`.devt/rules/**/*.md` + project-local `guardrails/**/*.md`) and compresses each file once. **Plugin's own `guardrails/` is deliberately excluded** — that's devt's source code, not user content; modifying it would (a) be overwritten on next `devt update`, (b) violate the plugin/source boundary, (c) be the plugin maintainer's release-time concern, not the user's runtime opt-in. Idempotent: files with an existing `<name>.original.md` backup are skipped. Safety refusals (identical-output, empty-input) categorize as `skipped_already_done`, not errors. Per-file errors don't abort the run. Returns aggregate `{total_files, compressed[], skipped_already_done[], refused_sensitive[], errors[], total_bytes_saved, median_ratio, engine_breakdown}`.

- **`prompt_static_compress_setup` step in `workflows/project-init.md`.** New step placed between `prompt_graphify_first_build` and `prompt_claude_mem_setup`, mirroring the graphify-first-build consent pattern. Detection: `.devt/rules/` exists + `static_compress.mode=off` (default) + no existing `.original.md` backups. AskUserQuestion offers "Compress now" / "Skip". On "Yes": flips `static_compress.mode` to `on` permanently AND runs `static-compress --all` once. Explicit consent — devt never silently modifies user files even during init.

- **`/devt:health` compression savings block.** Extends the v0.84.0 `compression` block with a new `savings` sub-object reading `.devt/state/static-compress.jsonl` (RESET_EXEMPT per `docs/STATE-RULES.md`): `files_compressed`, `total_bytes_saved`, `median_ratio`, `last_run_at`. Drives the adoption-feedback loop: users see what compression has actually saved before deciding whether to leave it on. Best-effort; missing log silently degrades to no `savings` field.

- **`token-report` static-compress activity cross-reference.** New top-level `static_compress_activity` field surfaces compression events in the same time window as the report's sessions (`window_start` = earliest session `first_turn_at`, `window_end` = latest session `last_turn_at`). Reports `events_in_window`, `bytes_saved_in_window`, `last_event_ts`. Cache-read tokens are already parsed + aggregated at the file level — this enrichment lets users correlate compression activity with the `cache_hit_rate` they observe.

- **K81 smoke gate — bulk-compress + adoption-loop integration.** 4-fixture round-trip: walker scans only project-local paths (plugin's `guardrails/` mtimes byte-equal before/after), idempotent re-run skips via backup-existence, `/devt:health` aggregates savings into `compression.savings`, `workflows/project-init.md` carries the new `prompt_static_compress_setup` step (regression guard). Closes the contract between init-time consent → bulk run → health-time ROI surface.

### Changed

- **`compression.engine` literal fixed from `prose-shrink` → `regex`.** v0.84.0 shipped the compression block reporting `engine: "prose-shrink"` when headroom was absent, but the actual engine literal in `_compressWithFallback` is `"regex"`. Drift detected during v0.85.0 bulk-compress integration (the `engine_breakdown` aggregator received `regex` keys, not `prose-shrink`). Fixed.

- **J2 smoke gate now distinguishes "release missing on GitHub" from "tag not yet pushed".** Previously the gate failed on any local tag without a corresponding GitHub release. That includes the transient window between `git tag vX.Y.Z` (local) and `git push origin vX.Y.Z` (which fires the release workflow). The gate now snapshots remote tags via `git ls-remote --tags origin` once at gate start and exempts local-only tags. Failure mode the gate was designed to catch — bulk-push silent-skip — is unchanged: tags that exist on remote but have no release still fail. New surface lists the exempted local-only tags so the user knows they're queued.

## [0.84.0] - 2026-06-09

**Greenfield field-audit response — 4 validated low-friction wins + claude-mem detection bug fix.** Greenfield ran two audits (graphify integration + H1 trajectory validation) and surfaced 9 candidate findings. After per-finding validation against the actual codebase, 5 were stood down (already-solved / falsified / speculative / requires per-agent prompt convention rather than system change) and 4 shipped. The synthetic-fixture pattern (K79) is the one that matters most strategically: greenfield's 30-day window with zero structural-drift fires meant field data could not validate the recovery loop. K79 replaces field data with a deterministic CI fixture, giving us a falsifiable signal for the future warn → block default flip. A late-cycle user report surfaced a longstanding claude-mem detection bug — `/devt:init` was reporting "not installed" for users who DO have claude-mem installed as a Claude Code plugin. Fix folded into this release; K80 freezes the contract.

Smoke: 828 passed, 0 failed (+1 K79, +1 K80). Locking: 3/3.

### Changed

- **`dispatch.max_files_hint` default 8 → 12.** Greenfield evidence: parallel-lane code review on real PRs naturally references 9–12 paths per lane brief (target module + 4–5 cross-cutting refs to CLAUDE.md, ADR docs, sibling MODULE.md files). Cap=8 fired advisory warnings on every parallel-lane dispatch without the safety floor being relevant — the hook is advisory-only, dispatches always proceeded. Raising the default to the empirical natural shape removes noise without losing the warning mechanism for genuinely anomalous payloads (50+ paths still warns). Two-place update: `bin/modules/config.cjs::DEFAULTS.dispatch.max_files_hint` + the `hooks/dispatch-scope-guard.sh` fallback default that the hook uses when `.devt/config.json` is missing or malformed.

- **`graph-impact.md` truncation notice — top banner when drop count > 5.** Previously the dropped-symbols section was appended after F17 god-node + symbol-godnode + hyperedge-completeness + ambiguous-bindings + fallback-god-nodes sections. Greenfield 2026-06-09 audit: 42 of 74 symbols dropped on a 132-file PR, the notice landed at line 200+ of a multi-section file and reviewers missed it. New behavior: when `DROPPED_COUNT > 5`, a one-line `> **Subject symbols truncated**: N of M …` banner is prepended to the file so the gap is visible before any scrolling. Full list at bottom is unchanged. Threshold matches the heuristic where reviewer cost of scanning ≤5 dropped symbols is trivial and a top banner would be noise.

### Fixed

- **`/devt:init` claude-mem detection — registry-based instead of `command -v`.** The prior detection ran `command -v claude-mem >/dev/null` and reported "not installed" when the binary wasn't on PATH. But claude-mem v13+ is distributed exclusively as a Claude Code plugin (`/plugin install claude-mem@thedotmack`), not a shell binary — it self-registers under `~/.claude/plugins/` and exposes its MCP server (`mcp__plugin_claude-mem_mcp-search__*`) at workflow time. Users with a working claude-mem plugin installation were being prompted to install it again. New detection reads `~/.claude/plugins/installed_plugins.json::plugins` and matches any key starting with `claude-mem@` (handles marketplace forks). Falls through to `no` when the registry file is missing or malformed. Hint text on the install path now points to the registry-keys jq command for verification instead of `command -v`.

### Added

- **K79 smoke gate — end-to-end synthetic drift recovery.** Closes the gap between K74 (detector-only) and the production recovery loop. Writes a substantive-but-incomplete `impl-summary.md` (5 expected sections, 2 dropped) to a temp dir, sets `validator.structural_mode='warn'`, runs `state recover-partial-impl programmer`, asserts the return shape: `suggested_action='targeted-fix'` AND `drift.missing_sections.length === 2` AND the fix-envelope template carries the `{drift_errors}` placeholder. No real sub-agent dispatch — the decision path is deterministic given the same filesystem inputs, so testing the decision is enough. ~100ms, zero token cost. Greenfield-evidenced rationale: 30+ days of field runs produced zero structural-drift fires, so synthetic is the only path to validate the recovery loop without inventing field data.

- **K80 smoke gate — claude-mem plugin-registry detection.** 6-fixture round-trip: registry with `claude-mem@thedotmack` → yes; registry without claude-mem → no; missing file → no (graceful default); empty registry object → no; marketplace fork (`claude-mem@some-fork`) → yes; regression guard asserts `workflows/project-init.md` uses the new `CLAUDE_MEM_REGISTRY=` path AND no longer contains the removed `command -v claude-mem >/dev/null` line. Closes the detection-bug regression risk.

- **`/devt:health` compression block.** New top-level field `compression: { static_compress_mode, headroom_available, engine, recipe }` reports the static-compress configuration state, whether the `headroom` binary is on PATH, which engine would run if compression were enabled (`headroom` / `prose-shrink` / `null` when off), and the canonical recipe doc path. Greenfield 2026-06-09 audit: the v0.81.0 static-compress feature was invisible during normal `/devt:health` runs — adoption gap, not a correctness gap. Surfaced as a data field (mirrors the existing `update` and `version` fields) rather than info-level issues so it doesn't clutter `issues[]` for every health invocation. `bin/modules/static-compress.cjs` exports the previously-internal `_headroomAvailable` probe as `headroomAvailable` for the health module to consume.

### Stood down (validated as non-issues or already-solved)

- **#1 blast_radius response-cap automation.** `workflows/code-review.md` NEW-5 already documents the `--max-bytes` CLI fallback; greenfield's manual 153KB → 2.6KB compress WAS the documented fallback path. Gap is discoverability, not capability.
- **#2 Bitbucket parity (`bb_pr_impact` tier).** Real, but high-effort. `symbol_anchored` tier already serves greenfield (their only field site) — the marginal gain doesn't justify a new workflow path right now.
- **#4 `check-imported-godnodes` CLI.** Speculative — F17 fallback fires correctly when caller-modifying PRs touch zero god-node definition sites; no field evidence that the C7-1 preflight fallback is insufficient.
- **#5 Per-finding provenance ledger.** Infrastructure already exists — `correlation_id` is embedded in `## Drill-down: <SYM> [call: <id>]` section headers across 4 workflows, and `mcp-stats --correlation-id=<id>` queries them. Gap is sub-agent prompt convention (agents don't cite IDs in findings), not a system change. Defer until the prompt-strength change is itself validated against quality drift.
- **#8 `/devt:tokens` CLI.** Falsified — `node bin/devt-tools.cjs token-report` exists and provides the per-session aggregation needed. The H1 plan referenced the wrong name; the implementation is fine.

## [0.83.2] - 2026-06-09

**README doc completeness — surface the static-compress feature + the two opt-in config knobs.** The v0.81.0 `static-compress` CLI and the `validator.structural_mode` / `static_compress.mode` config knobs landed but never appeared in the README's main feature list or configuration reference table. README is the primary entry point for users asking "how does devt save tokens?" — without these mentions the feature is effectively invisible. This patch closes the gap.

Smoke: 826 passed, 0 failed (no functional change). Locking: 3/3.

### Added

- **README "Optional: static-file compression (built-in)" section.** New subsection placed alongside the existing "Optional: input-side compression via headroom proxy" section. Names the static-compress CLI, the headroom probe + regex fallback architecture, the 5 safety layers, the `<path>.original.md` reversibility, and links to `docs/static-compress-recipe.md` + smoke gate K77.

- **README configuration-reference table** gained two new rows: `validator.structural_mode` (default `'warn'`) — controls structural-drift detection in `state recover-partial-impl` and `state check-agent-output --structural`; and `static_compress.mode` / `static_compress.size_cap_bytes` — opt-in static-file compressor. Both rows describe the trade-off + the same triad pattern (`block` / `warn` / `off`) used by `dispatch_hygiene_mode` and `claim_check_mode`.

- **README configuration-reference JSON example** gained the `validator` and `static_compress` blocks so the schema preview matches the table below.

## [0.83.1] - 2026-06-09

**CI fix for K78 description tripping the pre-existing doc-discipline gate.** The K78 description in `docs/INTERNALS.md` contained `@deprecated since v2.0.0` as a literal example of the JSDoc syntax K78 exempts from `templates/*/documentation.md`. The pre-existing doc-discipline smoke gate scans `docs/*.md` for `\bsince v[0-9]` markers and (correctly) flagged the example as a violation — provenance examples don't get a pass. Rephrased the K78 row to describe the JSDoc exemption by category, not by literal example, and added a cross-reference to the broader doc-discipline gate so future readers see both surfaces.

The local smoke test passed pre-push because the gate uses `git grep` (tracked files only), and the K78 description was uncommitted at smoke time. CI ran against the fresh-clone tracked content and caught the violation.

Smoke: 826 passed, 0 failed (both K78 and the doc-discipline gate clean). Locking: 3/3.

### Fixed

- **`docs/INTERNALS.md` K78 row** — replaced `\bv\d+\.\d+\.\d+\b` literal regex example with the phrase "v-prefixed semver literals" and removed the `@deprecated since v2.0.0` example. Cross-referenced the pair (K78 + doc-discipline gate) so future maintainers know both gates have complementary scope.

## [0.83.0] - 2026-06-09

**Strict version-marker sweep + K78 enforcement gate + 5 polish items.** Cleans up the pre-existing devt-internal version markers scattered across `bin/modules/`, `hooks/`, and `workflows/_phase-gates.yaml` that predated the rule's enforcement. K78 smoke gate scans `bin/modules/`, `hooks/`, `agents/`, `workflows/`, `templates/`, `guardrails/` for `vX.Y.Z` markers and refuses any. Skills and `templates/*/documentation.md` are exempt — they use version markers as legitimate template/example content (Option A/B prescription, `@deprecated`/`@beta` JSDoc patterns). The 5 polish items address silent-failure findings deferred from the v0.82.0 validation: prose-shrink sentinel non-convergence now throws, `isSensitivePath` throws on non-string inputs, `static-compress mode='off'` returns ok:true with skipped:true (config-as-designed not a failure), headroom failure modes differentiate, backup readback error surfaces the actual byte mismatch.

Smoke: 826 passed, 0 failed (+1 K78). Locking: 3/3.

### Changed

- **Strict version-marker sweep across `bin/modules/`, `hooks/`, `workflows/_phase-gates.yaml`.** Stripped historical-context comments referencing `v0.X.Y` markers (`bin/modules/state.cjs`, `init.cjs`, `preflight.cjs`, `state-audit.cjs`, `mcp-stats.cjs`, `graphify.cjs`; `hooks/session-start.sh`, `task-truncation-detector.sh`, `run-hook.js`; `workflows/_phase-gates.yaml`). Each comment block was rewritten to keep the architectural rationale that mattered (WHY the code is shaped the way it is) and drop the WHEN (the version provenance). `bin/modules/update.cjs:185` is the CHANGELOG-header regex parser — version literals there are functional code, exempt from the sweep.

- **`static-compress mode='off'` returns `ok:true, skipped:true`.** Configuration-as-designed isn't a failure; the prior `ok:false, exit 1` behavior tripped callers running under `set -e`. CLI exits 0 in skipped mode. K77 fixture A's `|| true` workaround is now functionally redundant but kept as defense-in-depth.

- **`_runHeadroom` timeout 60s → 30s.** Original 60s was over-generous for a 500 KB input cap × neural compressor's realistic wall time. 30s preserves headroom for slow Apple-Silicon-MPS first-load while halving the wait when something hangs.

### Added

- **K78 smoke gate — convention enforcement against banned version markers.** Scans `bin/modules/`, `hooks/`, `agents/`, `workflows/`, `templates/`, `guardrails/` for `\bv\d+\.\d+\.\d+\b`. Exempts the CHANGELOG-parser regex line in `update.cjs` and `templates/*/documentation.md` template-example content. Closes the systemic gap that let the H1 trajectory ship with 9 violations across new files — any future regression now fails CI.

### Fixed

- **`prose-shrink` sentinel non-convergence throws explicit error.** Previously the 8-pass restoration loop could exit with `ZZZPROTZZZ` markers still embedded in output on pathological nested-protection inputs. The structural validator downstream would catch the resulting corruption but report misleading errors ("URL lost"). Now throws a clear error naming the actual cause; the static-compress orchestrator's catch surfaces it to the user verbatim.

- **`isSensitivePath` throws `TypeError` on non-string inputs.** Previously returned `false` for `undefined`/`null`/numbers — silently treating programming errors as a "safe to process" verdict, the exact wrong default for a denylist. Empty string still returns false (legitimate "no path to check" signal).

- **`_headroomAvailable` distinguishes ENOENT from other errors.** Previously all probe failures were silently swallowed → user couldn't tell why headroom wasn't firing. ENOENT (not installed) stays silent; permission errors, non-zero exits from `headroom --version`, spawn exceptions now write a one-line stderr hint.

- **`_runHeadroom` returns structured failure shape.** Replaces the prior 4-mode-collapse-to-null with `{ok, reason}` where `reason` names the specific failure (timeout / non-zero exit + stderr tail / empty output / spawn exception). `_compressText` writes a per-mode stderr line before falling back to regex.

- **Backup readback failure includes byte-mismatch detail.** Previously `"backup readback failed — aborting"` told the user nothing actionable. Now distinguishes (a) read error (filesystem failure: code + message) from (b) bytes-differ-on-disk (in-memory vs on-disk byte counts, hint at disk/encoding/antivirus interference).

## [0.82.0] - 2026-06-09

**Validation-pass cleanup: error-handling discipline + CLAUDE.md hygiene.** Patch release responding to an independent code-review + silent-failure-hunter pass over the H1 trajectory diff. No new features. Six findings landed: a systemic CLAUDE.md "Documentation discipline" violation (banned version markers in nine new file headers), three silent error-catches that disabled the structural-drift feature on config typos / validator crashes, and one missing smoke fixture that left K77's drift-revert claim unverified. Closes the loop the H1 calibration window depends on.

Smoke: 825 passed, 0 failed (K77 expanded to 6 fixtures). Locking: 3/3.

### Changed

- **Version markers stripped from 9 added file headers** (4 fix templates, `bin/modules/static-compress.cjs`, `bin/modules/config.cjs` × 2 blocks, `bin/modules/state.cjs::recoverPartialImpl`, `docs/static-compress-recipe.md`). CLAUDE.md "Documentation discipline" + `feedback_no_version_refs_in_code` user memory ban devt-internal version refs from code/agents/workflows/skill bodies. Version provenance belongs in CHANGELOG + git history.

### Fixed

- **`recoverPartialImpl` config load surfaces non-ENOENT failures to stderr.** Previously a malformed `.devt/config.json::validator.structural_mode` (typo, JSON syntax error, forbidden-key rejection from the prototype-pollution guard) silently defaulted the feature to `'off'` with no signal — the calibration window the H1 plan was built around would silently collect no data. Now stderr-warns on every non-missing-file error so users can see the actual cause.

- **`recoverPartialImpl` structural-validator crash surfaces to stderr + marks return.** Previously `try { extractHeadings(...) } catch { /* best-effort */ }` swallowed all validator errors and fell through to "substantive" — orchestrator told "no drift" when drift detection was actually broken. Now writes a stderr line per failure AND attaches `structural_check: "errored"` to the substantive return so the orchestrator can distinguish "no drift detected" from "drift detection unavailable".

- **`static-compress.cjs::_resolveConfig()` surfaces non-ENOENT config errors to stderr.** Same footgun at a more visible surface — user runs `static-compress`, sees "feature disabled" message, edits config with a typo, sees the exact same message. Now the typo surfaces.

- **`checkAgentOutput` structural-drift catch flips `result.ok = false`.** Previously the catch block populated `structural_drift.errors[]` with the validator error but left `result.ok = true` — gate reports clean when the validator crashed. Now the gate correctly reports failure on validator crash with the failure cause in `reason`.

- **`recoverPartialImpl` malformed-line counter for `dispatch-warnings.jsonl`.** Three separate `catch { /* malformed line */ }` blocks silently skipped records — when a hook race condition or partial write produced an unparseable line, `recoverPartialImpl` could miss the `low_output:true` signal and route to `'investigate'` instead of `'SendMessage-resume'` (the wrong recovery path). Now counts skipped lines and surfaces them via the optional `malformed_jsonl_lines: N` field + an explanatory clause in the `investigate` reason.

- **`dispatch.cjs::parseIoContracts` throws on malformed `expected_sections`.** Previously a syntactically-broken inline list (e.g., `expected_sections: [Task Files Modified]` — missing comma) silently parsed to null → structural-drift check skipped for that agent without any signal. Now throws an explicit error with agent name + key so the calibration-data poisoning surfaces at load time.

### Added

- **K77 Fixture F — structural drift triggers automatic revert.** Closes a verification gap where K77's comment claimed the drift-detected-→-backup-deleted path was tested but no prior fixture exercised it. Fixture F injects a faked `headroom` binary on PATH that drops a section heading. Assertions: (a) input file byte-equal to original, (b) backup file absent, (c) reason mentions `structural elements`. Confirms the structural validator catches drift before the input is touched.

## [0.81.0] - 2026-06-09

**E3: opt-in static-file prose compressor (telemetry-gated, default off).** Fourth and final release in the H1 trajectory. The v0.80.0 envelope audit closed the telemetry gate — guardrails + governing rules dominate dispatch cost at 87.9% of envelope bytes — so the planned static-file compression infrastructure lands. New `static-compress` CLI subcommand compresses prose in markdown files while leaving fenced code blocks, inline code, URLs, paths, identifiers, function calls, CONST_CASE tokens, and version numbers byte-equal. Backup file (`<path>.original.md`) lands first with readback verification; structural-drift validator runs post-compression; any drift detected → backup deleted, input untouched. `headroom` probed on `PATH` for neural extractive compression; deterministic regex fallback (caveman-shrink port) when not available. Sensitive-path denylist refuses credentials before any compression. Documentation in `docs/static-compress-recipe.md`.

Smoke: 825 passed, 0 failed (+1 K77). Locking: 3/3.

### Added

- **E3-1 — `bin/modules/prose-shrink.cjs`** (zero-dep, MIT-attributed port of caveman-shrink `src/mcp-servers/caveman-shrink/compress.js`). Pure-Node regex prose compressor with sentinel-protected segments. Eight protected pattern classes: fenced code, inline code, URLs, paths (leading `./`, `../`, `/`, drive-letter, or `/`-bearing tokens), CONST_CASE identifiers, dotted.method paths, function calls, version numbers. Iterative sentinel restoration handles nested-pattern overlap (e.g., `config.SETTING_KEY` where SETTING_KEY first gets CONST_CASE-protected, then `config.<sentinel>` gets dotted-method-matched — sentinel restore loops until stable). Whitespace classes intentionally exclude newlines so line structure (heading boundaries) survives compression.

- **E3-2 — `bin/modules/static-compress.cjs`** (orchestrator). Probes `headroom --version` on PATH; shells out to `headroom compress -` for neural extractive compression (~40% reduction, 7.9/10 fidelity per chopratejas/kompress-base model card) when available; falls back to prose-shrink.cjs (~25-35% reduction, fully deterministic) when not. Five safety layers before any input file is touched: sensitive-path denylist refusal (same `is_sensitive_path` port `graphify.cjs` uses), file size cap (default 500 KB), empty-file refusal, identical-output refusal, backup-readback verification, structural-drift validation post-compression. Atomic writes via `io.cjs::atomicWriteFileSync`. Compress + restore actions log to `.devt/state/static-compress.jsonl`.

- **E3-3 — `static-compress [path]` + `--restore [path]` CLI subcommands** in `bin/devt-tools.cjs`. Returns JSON; exit 0 on success, 1 on refusal/failure, 2 on usage error.

- **E3-4 — `DEFAULTS.static_compress: { mode: 'off', size_cap_bytes: 500000 }`** in `bin/modules/config.cjs`. `mode: 'off'` (default) means the CLI returns a clear "feature disabled" message — explicit opt-in required per project via `.devt/config.json`. `mode: 'on'` activates the compressor. No surprises path — devt never modifies user files without permission.

- **K77 smoke gate** — static-compress 5-fixture round-trip: mode-off refused with feature-disabled message, mode-on compresses while preserving inline code + URL + path bytes + writing `.original.md` backup, `--restore` returns byte-identical original (compared via `wc -c`), sensitive filename refused with exit 1, empty file refused with "empty" reason.

- **`docs/static-compress-recipe.md`** — user-facing recipe covering the opt-in protocol, five safety layers, recommended targets (guardrails files dominate envelope), reversibility flow, and telemetry shape.

## [0.80.0] - 2026-06-08

**Default flip: `validator.structural_mode: 'off' → 'warn'`. C deferred after measurement.** Third release in the H1 trajectory. Closes the v0.78.0 + v0.79.0 calibration window — the structural-drift validator + targeted-fix loop ship default-active in advisory mode. Drift detected → `[STRUCTURAL_DRIFT_DETECTED]` echo fires with `mode=warn`; orchestrators can SendMessage-resume the rendered fix template for the affected agent, but the gate doesn't block workflows. `'warn' → 'block'` flip stays deferred until field data confirms zero false positives.

**C decision: skip.** The plan's measurement-gated MCP description shrinker was specced to target envelope description prose. Architecture audit of a real dispatch envelope (programmer:dev, 31,517 bytes) shows the compressible-prose slice is <2% of envelope cost — `guardrails_inline` dominates at 86.6% (27,291 bytes), `governing_rules` is 1.3%, MCP description prose is the noise floor. C-as-specified would optimize an immaterial slice. Defer C; track guardrails as the real future compression candidate, which requires a caching-layer architecture (not a simple shrinker).

Smoke: 824 passed, 0 failed (no new gates). Locking: 3/3.

### Changed

- **`validator.structural_mode` default flipped from `'off'` to `'warn'`.** Existing `checkAgentOutput` + `recoverPartialImpl` infrastructure now active in advisory mode for the 4 sidecar-bearing agents (programmer, tester, code-reviewer, verifier). Orchestrators see `[STRUCTURAL_DRIFT_DETECTED]` when an agent drops a section declared in `agents/io-contracts.yaml::outputs.expected_sections`. The fix flow remains SendMessage-resume against `templates/dispatch/envelopes/<agent>-fix.tmpl.md` — saves ~5–15K tokens per drift incident vs. fresh re-dispatch. Users who hit false positives can opt back to `'off'` via project `.devt/config.json::validator.structural_mode`.

- **Config comment updated** to reflect the flip + the deferral rationale for `'block'`. Same pattern dispatch_hygiene_mode used (warn precedes block-by-default after field cycles).

### Deferred

- **C — MCP description shrinker.** Measurement-by-architecture (envelope byte-slice audit) shows the targeted prose surface is <2% of dispatch cost. The wrong slice for compression effort. Re-evaluate as a guardrails-targeted caching layer in a future release — different architecture (cache invalidation, content stability, not a one-shot shrinker), distinct deliverable.

- **`'warn' → 'block'` flip.** Stays deferred. Will land once user-side field data confirms zero false positives across representative workflow runs. Same calibration cadence used for `dispatch_hygiene_mode`'s warn-then-block ramp.

## [0.79.0] - 2026-06-08

**B-Wire: targeted-fix recovery loop + E2 byte-stability + sensitive-path borrow.** Second release in the H1 trajectory. Closes the structural-drift loop opened by v0.78.0 — when a sub-agent writes a substantive artifact but drops a section declared in `agents/io-contracts.yaml::outputs.expected_sections`, the orchestrator now SendMessage-resumes the same agent ID with a precise fix prompt rather than fresh re-dispatch (saves ~5–15K tokens per drift incident). Default `validator.structural_mode` stays `'off'` for one calibration cycle — flip to `'warn'` deferred to v0.80.0 once user-side field data confirms zero false positives. Adds E2 byte-stability assertion to K71 (CacheAligner concept borrow from headroom). Adds graphify CLI sensitive-path denylist (caveman is_sensitive_path port) — refuses `.env`/`.ssh`/credential-shaped paths from flowing into MCP queries.

Smoke: 824 passed, 0 failed (+1 K71b idempotence + 1 K76 denylist). Locking: 3/3.

### Added

- **B3 — `outputs.expected_sections` + parser support for 4 sidecar-bearing agents.** Added the field to `agents/io-contracts.yaml` for programmer (`[Task, Files Modified, Key Decisions, Quality Gate Results, Provenance]`), code-reviewer (`[Findings]` — the load-bearing section downstream consumers parse, kept minimal given BLOCKED vs happy-path heading variance), verifier (`[Task, Acceptance Criteria, Quality Gates, Summary]`), tester (`[Coverage, Test Files, Quality Gate Results, Provenance]`). Extended `bin/modules/dispatch.cjs::parseIoContracts` to surface the new field. Sections derived from each agent's body declarations — represents the minimum common set across all valid output paths. Sections beyond this list are permitted (superset semantics).

- **B4 — `recoverPartialImpl` third `suggested_action: 'targeted-fix'` branch.** Extended `bin/modules/state.cjs::recoverPartialImpl` to detect structural drift when validator mode is non-`off` AND the agent's contract declares `expected_sections`. Returns `{recovery_needed: true, suggested_action: 'targeted-fix', mode: 'warn'|'block', drift: {missing_sections, expected_sections}, reason}`. Falls back gracefully if validator config or structural-validator module is unavailable.

- **B5 — 4 fix-prompt envelope templates.** New files in `templates/dispatch/envelopes/`: `programmer-fix.tmpl.md`, `code-reviewer-fix.tmpl.md`, `verifier-fix.tmpl.md`, `tester-fix.tmpl.md`. Body ports caveman (MIT) `compress.py::build_fix_prompt` adapted to devt — strict "do NOT redo, do NOT rewrite, ONLY add missing sections" instructions with `{drift_errors}` placeholder the orchestrator substitutes inline before SendMessage-resume. NOT loaded by `dispatch render-filled` (no BEGIN dispatch markers reference them) — they're orchestrator-side guidance templates.

- **B6 — `[STRUCTURAL_DRIFT_DETECTED]` echo wired into 2 workflows.** Extended the existing `[PARTIAL_IMPL_RECOVERY]` post-dispatch bash block in `workflows/dev-workflow.md` and `workflows/quick-implement.md` to differentiate the echo prefix when `recoverPartialImpl` returns `suggested_action=targeted-fix`. Echo carries `mode`, `missing_sections`, and `reason`. Workflow prose guides orchestrators to read the relevant `<agent>-fix.tmpl.md`, substitute `{drift_errors}` with the missing-sections list, and SendMessage-resume — NOT fresh `Task()` dispatch. `code-review.md` deferred because it does not currently call `recover-partial-impl programmer`; will join when code-reviewer-specific drift detection lands in a later release.

- **E2 — K71b idempotence smoke gate.** Extended K71 with a second `dispatch compile --check` call asserting byte-identical output across consecutive runs. Catches mtime/timestamp/random-id leaks into the substitution table that would silently break prompt-cache hit rates. Audit confirmed `buildSubstitutionTable` is a pure function of (config, state file content, governing-rules + guardrails + rubrics + graph-impact file content) — no non-deterministic inputs leak today. K71b is a forward-guard. Concept borrowed from headroom CacheAligner — concept only, zero code dependency.

- **`bin/modules/sensitive-path.cjs` (zero-dep, MIT-attributed port of caveman `compress.py::is_sensitive_path`).** Three-check denylist: basename regex (`.env*`, `.netrc`, `credentials*`, `secret(s)*`, `password(s)*`, `id_rsa/dsa/ecdsa/ed25519*`, `authorized_keys`, `known_hosts`, `*.pem/key/p12/pfx/crt/cer/jks/keystore/asc/gpg`), sensitive path component (`.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`), token-normalized basename (`secret`, `credential`, `password`, `apikey`, `accesskey`, `token`, `privatekey` — `[_\-\s.]` stripped before substring match so `api-key` and `api_key` both catch).

- **Graphify CLI sensitive-path filter at 4 file-accepting subcommands.** `lane-suggestions`, `check-large-files`, `check-symbol-godnodes`, `symbols-in-files` now refuse sensitive-path inputs with exit 2 + clear stderr message. Closes the disclosure path where an accidental `.env` or `~/.ssh/id_rsa` argument would flow into graphify MCP queries.

- **K76 smoke gate** — graphify sensitive-path denylist round-trip across 4 fixtures: `credentials.json` refused (exit 2), `.ssh/id_rsa` refused (exit 2), `my-api-key.env` refused (exit 2), clean path (`src/auth.py docs/README.md`) accepted (exit 0).

### Changed

- **`bin/modules/dispatch.cjs::parseIoContracts`** now surfaces `outputs.expected_sections` as a list (or `null` when absent). Backward-compatible — agents without the field see no behavior change.

- **`bin/modules/state.cjs::recoverPartialImpl`** signature shape extended (new optional `drift` and `mode` return fields when `suggested_action=targeted-fix`). The two existing branches (`SendMessage-resume`, `investigate`) are unchanged.

## [0.78.0] - 2026-06-08

**Structural-drift validator infrastructure + headroom companion mention.** First release in the H1 trajectory (validator → wiring → measurement-gated extensions). v0.78.0 lands the validator module + opt-in CLI flag + smoke gate K74 with `validator.structural_mode` defaulting to `'off'` for one calibration window. No behavioral change to existing workflows. README gains a "compatible companion" mention for headroom proxy as an optional input-side compression layer (devt does not bundle, does not require).

Smoke: 822 passed, 0 failed (+1 from K74). Locking: 3/3.

### Added

- **B1 — `bin/modules/structural-validator.cjs`.** Zero-dep module porting caveman (MIT, juliusbrussee/caveman, `skills/caveman-compress/scripts/validate.py`) extractors: `extractHeadings`, `extractCodeBlocks` (line-based, nested-fence-aware per CommonMark), `extractUrls`, `extractPaths`, `extractInlineCodes`, `countBullets`. Public `validate(orig, comp, {mode})` returns `{ok, errors, warnings, mode}`. Adds devt-specific `mode: 'superset'` (default) — final artifact must contain all baseline structures, may add more — for stub-first protocol; caveman's `mode: 'equality'` stays available.

- **B2 — `state check-agent-output --structural --baseline=<path>` flag.** Optional structural-drift check against a baseline snapshot (typically the stub-first sentinel the orchestrator captured before final write). Returns existing `checkAgentOutput` fields plus `structural_drift: {ok, errors, warnings, mode}`. Backward-compatible: callers without the flag see identical behavior. Missing baseline file is a hard failure with a specific error message. Supports optional `--mode=superset|equality` flag (defaults to `superset`).

- **`validator.structural_mode` config default in `bin/modules/config.cjs::DEFAULTS`.** New `'off' | 'warn' | 'block'` triad matching `dispatch_hygiene_mode` and `claim_check_mode` patterns. Default `'off'` for one calibration window; future releases flip to `'warn'` then `'block'` once replay against `.devt/state/.archive/` records confirms zero false positives.

- **K74 smoke gate** — structural-drift validator round-trip across 4 fixtures: superset stub→complete (ok), superset stub→dropped-section (fail with specific "Section dropped" error), equality mangled-code-block (fail), equality identical-text (ok).

- **README "Optional: input-side compression via headroom proxy" section.** Names [headroom](https://github.com/chopratejas/headroom) as a compatible companion for users who want input-side compression on top of devt. Honest trade-off: ~50–90% input-token savings, adds ~500 MB Python+Rust toolchain, beta version churn. devt does not bundle and does not require headroom — they're orthogonal layers.

## [0.77.0] - 2026-06-08

**v0.76.0 calibration response + Greenfield-LLM top-3 ergonomics.** Greenfield's calibrated PR #389 review surfaced one own-bug on v0.76.0 (the `<graph_impact>` block shipped as a Read prompt, not inlined content) plus 3 high-frequency / low-complexity asks ranked by field experience. v0.77.0 closes all 5 — A1 inlines graph-impact content into investigative-agent prompts, A2 fixes the doc-promotion communication gap, A3 ships the calibration-mode opt-in flag, B1 splits lane-suggestion's `community: null` mega-bucket by file archetype, B2 weights central-symbol picks by diff-recency. New smoke gates K72 (B1 archetype matrix) + K73 (A1 inline + absent matrix).

Smoke: 821 passed, 0 failed (+2 from K72 + K73). Locking: 3/3.

### Added

- **A1 — `loadGraphImpact()` helper + `{graph_impact_content}` placeholder.** New helper in `bin/modules/init.cjs` reads `.devt/state/graph-impact.md` (capped at 32 KB) and exposes content via `dispatch.cjs` substitution. Investigative-agent envelopes (programmer, programmer-quick_implement, code-reviewer, code-reviewer-quick_implement, code-reviewer-code_review, debugger-debug) now inline the actual file content instead of shipping a Read prompt. Three states: `present` (content inlined, truncation notice when over cap), `skipped` (graphify-skip-reason.txt content inlined), `absent` (graceful fallback line). Closes Greenfield-LLM's calibration finding that v0.76.0 C1a "delivered data reached the agent" but NOT "data inlined to save a Read call."

- **A2 — SessionStart what's-new surfacing.** `hooks/session-start.sh` now reads `VERSION` and compares to `~/.cache/devt/whats-new-seen`. On version mismatch, extracts the CHANGELOG headline paragraph for the current version (capped at 800 chars) and appends it to the SessionStart context. Stamp file updated so the announcement appears once per upgrade per machine. Closes the doc-promotion communication gap — Greenfield-LLM had zero awareness of v0.76.0 features because they only see project CLAUDE.md, never devt's. Mechanism is announcement-only; future releases inherit the channel for free.

- **A3 — `telemetry.task_truncation_log_all` config flag.** New `DEFAULTS.telemetry.task_truncation_log_all: false` in `bin/modules/config.cjs`; `hooks/task-truncation-detector.sh` reads it from `.devt/config.json::telemetry`. When true, every dispatch return logs a forensic record (calibration-mode coverage). When false (default), only cliff signals (`near_cliff`/`low_output`/`mid_task_language`) emit. Advisory output stays cliff-only regardless of the flag — log-all mode adds no orchestrator-visible noise. Greenfield-LLM-endorsed pattern: quiet-by-default + opt-in for calibration cycles.

- **B1 — Lane-suggestions archetype classifier.** New `_archetype(f)` helper in `bin/modules/graphify.cjs::laneSuggestions` sub-classifies the ungrouped bucket (files without graph community labels) into 4 archetypes: `docs` (.md/.rst/.txt/.adoc/.mdx), `tests` (.hurl + paths containing /tests/ or _test or .spec), `config` (.toml/.lock/.yaml/.yml/.ini/.env/.cfg + VERSION/Makefile/Dockerfile/Cargo.toml/go.mod/package-lock.json/pnpm-lock.yaml), `other` (residual ungrouped). Groups expose `archetype` field when the bucket comes from the classifier. Closes Greenfield-LLM's #1 ask (every multi-file review hit this — 24 of 42 files in their fixture went to one community: null mega-bucket).

- **B2 — Diff-recency weighting in `pickCentralSymbol` (M3 calibration).** New `_diffSymbolCounts()` helper runs `git diff HEAD --unified=0` (best-effort, 2s timeout, 256 KB cap) and counts word-bounded occurrences of each candidate symbol. The scoring then becomes `final = token_overlap_score + min(diffCount × 0.2, 2.0)` — a symbol mentioned 5+ times in the diff dominates token-overlap noise from unrelated test/debounce files. Builds on v0.76.0 C4 (god-node de-ranking); Greenfield-LLM's exact field example: `DebounceService` was picked over `_check_calendar_feature_gate` for a license-gate PR even though `_check_calendar_feature_gate` appeared 11 times in the task description AND many times in the diff. After M3, the diff-mentioned symbol wins regardless of token overlap.

- **K72 smoke gate** — lane-suggestions archetype classifier round-trip. Fixture: 1 covered file (community 1) + 1 .md + 1 tests/* path + 1 .sql. Asserts `groups[].archetype` contains exactly `["docs", "tests"]` for the uncovered files.

- **K73 smoke gate** — `dispatch render-filled` inlining round-trip. Two states: absent (envelope contains the "(no graph-impact.md available — ...)" notice) and present (envelope contains a sentinel marker from the actual file). Locks in A1 against the v0.76.0-style regression where the placeholder is shipped without substitution.

### Changed

- **K32 expectation: 3 → 4 groups for partial-coverage fixture.** B1 archetype split causes the 4-file mixed-input case (auth.py + billing.py + test_auth.py + 001.sql) to produce 4 groups (auth community + billing community + archetype:tests + ungrouped) instead of 3. Test message updated to reflect the new shape.

- **F7 graph-impact reference pattern broadened.** v0.76.0 shipped the exact phrase `"graph-impact.md if it exists"` in workflow dispatch prose. After A1's envelope rewrite, debugger-debug's reference now goes through the inlined `{graph_impact_content}` placeholder. F7 now accepts any of three patterns: the legacy Read prompt, the new inlining placeholder, or a bare `.devt/state/graph-impact.md` mention.

## [0.76.0] - 2026-06-06

**Agent context fidelity + post-workflow ergonomics pass.** Greenfield filesystem audit + Greenfield-LLM calibration-mode report converged on 5 specific gaps where field evidence + file evidence both signaled real cost. v0.76.0 closes them as a single coherent commit. Anchors: 11 raw_dispatch records (9 template-side, 2 orchestrator-side), 178 task_output_bytes records (93% noise), god-node central-symbol pick (FastAPI's `Depends` over `check_calendar_license`), nonsensical `scope_hint` (god-node depth-1 neighbors unrelated to the actual task), `assert-council-not-recent` placeholder bug, missing `/devt:docs` slash command.

Smoke: 818 passed, 0 failed (+1 K71). Locking: 3/3.

### Added

- **`/devt:docs` standalone slash command** + `workflows/docs-extraction.md`. Wraps `devt:docs-writer` with the proper envelope; runs whether or not an active workflow exists. Closes the cluster-1 raw_dispatch pattern (Greenfield 2026-06-02: 2 raw dispatches when docs-writer + retro had no standalone slash command). New `workflow_type: docs` registered in `VALID_WORKFLOW_TYPES`, routed in `next.md` + `status.md`, gate-locked at finalize via `_phase-gates.yaml::docs.complete`. New envelope template `templates/dispatch/envelopes/docs-writer-docs.tmpl.md` with deeper context blocks than the in-workflow variant (reads recent-changes from git when state artifacts absent).

- **K71 smoke gate (dispatch envelope drift)** — runs `dispatch compile --check` and fails the smoke run when ANY rendered envelope in `workflows/*.md` drifts from its source `.tmpl.md` + `agents/io-contracts.yaml` declaration. Closes the structural gap that let `<graph_impact_md>` declarations in io-contracts.yaml stay un-rendered in programmer + code-reviewer + debugger envelopes for multiple versions. Now mechanical: edit a `.tmpl.md` → run `dispatch compile --write` → smoke confirms zero drift.

- **`<graph_impact>` block in 5 dispatch envelope templates** (programmer.tmpl.md, programmer-quick_implement.tmpl.md, code-reviewer.tmpl.md, code-reviewer-quick_implement.tmpl.md, plus the already-shipping code-reviewer-code_review.tmpl.md and debugger-debug.tmpl.md). Sub-agents now receive the orchestrator-computed `graph-impact.md` content directly in the dispatch envelope instead of re-grepping for it. Closes Greenfield-LLM's #3 finding ("programmer re-discovered the cross-router import edge by grep instead of inheriting the orchestrator's MCP finding — 10-15 min duplicated per workflow"). Architectural pattern preserved: sub-agents stay MCP-blind by contract; the orchestrator-mediated `.devt/state/graph-impact.md` file is the handoff.

- **Dispatch escape-hatch recipes** (CLAUDE.md). New dedicated section ("Dispatch Escape-Hatch Recipes") with 4 recipes for patterns that don't fit any `/devt:*` slash command: multi-lane parallel review with custom scope, secondary side audit of a prior review, standalone post-workflow docs refresh (`/devt:docs`), standalone post-workflow retro (`/devt:retro`). Each recipe starts with `dispatch render-filled <agent>:<workflow>` to get the canonical envelope before pasting into a manual `Task()` call. Closes Greenfield-LLM clusters 2-4 ("the slash commands don't gracefully handle hand-fanout parallel lanes / meta-audits / standalone-after-workflow-closed") with an explicit, discoverable workflow rather than letting orchestrators hand-roll raw dispatches.

### Changed

- **`pickCentralSymbol` god-node de-ranking (M2 calibration).** When graphify is ready, read `god_nodes` from `GRAPH_REPORT.md` via `graphify.parseReportSections()` and exclude them from the candidate set BEFORE the M1 graph-existence filter. Closes Greenfield-LLM's #1 priority fix: FastAPI's `Depends` (888+ edges) was getting picked as the central symbol for a task whose description contained `check_calendar_license` 11 times. Falls through gracefully when `parseReportSections()` fails (preserves all candidates, no false negatives).

- **Dispatch-hygiene hook respects io-contracts.yaml `graphify_inputs: []` contracts.** `hooks/dispatch-hygiene-guard.sh` now exits cleanly (no raw_dispatch record, no advisory) for `devt:docs-writer`, `devt:retro`, `devt:curator`, `devt:devt-coordinator` — these agents are CONTRACTED to receive no envelope blocks per io-contracts.yaml. Closes the false-positive class that produced 2 of 11 raw_dispatch records in Greenfield's dataset. Investigative agents (programmer/code-reviewer/verifier/researcher/debugger/architect/tester) unchanged.

- **`task-truncation-detector` quiet-by-default.** Hook now only writes to `dispatch-warnings.jsonl` when a cliff signal triggers (`near_cliff` || `low_output` || `mid_task_language`). Calibration loop (which required emit-on-every-return) closed June 2026 — Greenfield evidence: 178 of 192 records (93%) carried `near_cliff:false`, `low_output:false`, no actionable signal. Smoke test updated to verify the new behavior (under-threshold mid-byte return produces no record + no advisory).

### Fixed

- **`assert-council-not-recent` placeholder bug.** `skills/council/SKILL.md` shipped a literal `<derived-slug>` placeholder in its bash gate code: orchestrators were copy-pasting it verbatim, the CLI rejected the literal angle-bracket string, and the gate failed with `reason:"missing slug argument (expected: <decision-slug>)"`. Confirmed in Greenfield gate-trace.jsonl on 2026-06-06 08:22:58. Replaced with explicit `COUNCIL_SLUG="your-decision-topic-here"` variable + 3 worked examples + instructions to substitute. The 2 downstream `council-trace` calls in stages 3 + 4 reuse the same `$COUNCIL_SLUG`.

### Documentation

- **CLAUDE.md "Templates" + docs/INTERNALS.md table — baseline shape clarification.** Already-shipped K70 enforces 9-file baseline; docs now distinguish baseline (9 K70-enforced files) from optional add-ons (api-changelog.md, canonical-entities.yaml, arch-scan.py + detectors/).

- **typescript-node template — Node 22 + TS 5.2+ currency pass.** Audit of `typescript-node/*.md` against the modern Node 22 + TS 5.4 vocabulary revealed 0/0/0 grep hits for `node:test`, `node --watch`, `node:` prefix imports, `AsyncLocalStorage`, `AsyncDisposable`, `satisfies`, const type params, `NoInfer`, branded types — template hadn't been updated since pre-Node 22 era. v0.76.0 closes the currency gap mechanically:
  - `coding-standards.md` (81 → 199 lines) adds two new sections — **Built-in Node APIs (Node 22+)** covering `node:` prefix imports, `node --test` / `--watch` / `--env-file`, `AsyncLocalStorage`, `AbortSignal.timeout` / `.any`, `structuredClone`, `crypto.randomUUID`; and **Modern TypeScript Idioms** covering `satisfies` operator (TS 4.9+), `using` declarations + `AsyncDisposable` (TS 5.2+), const type parameters (TS 5.0+), `NoInfer<T>` utility (TS 5.4+), branded types (newtype pattern with factory). Async Rules section expanded with `AbortSignal.timeout` / `AbortSignal.any` patterns + `AsyncLocalStorage` for request-scoped context. New Top-Level Await section.
  - `testing-patterns.md` (125 → 171 lines) adds `node --test` as a first-class option alongside Vitest/Jest. New runner-decision matrix (when to choose `node --test` vs Vitest vs Jest). Quick reference covering `describe` / `test` / subtests / `before` / `after` import from `node:test`, `assert from "node:assert/strict"`, run-flags including `--watch`, `--test-only`, `--experimental-test-coverage` (Node 22+), `--test-reporter=spec|junit`, `--test-name-pattern`. TypeScript loader guidance (`tsx`, `ts-node/esm`, `tsimp`).
  - `documentation.md` (42 → 194 lines) deepened to match rust + python-fastapi shape. New sections: Required Sections (`@param`/`@returns`/`@throws`/`@example`/`@deprecated`/`@beta`), Intra-Doc Links via `{@link}` (rename-survives), Module-Level Documentation via `@packageDocumentation`, README discipline for monorepos + published npm packages, Generated API Docs decision matrix (typedoc vs `@microsoft/api-extractor` + api-documenter), typedoc validation config mirroring Rust's `#![warn(missing_docs)]` semantics (`validation.notDocumented: true`), Common Failures.

- **go template — documentation.md depth-up.** Expanded `go/documentation.md` (40 → 173 lines) to match rust + python-fastapi shape. New sections: godoc Format Rules (Go 1.19+ doc-comment rules, pre-formatted blocks, `[Symbol]` doc links, section headings), Runnable Examples (`Example...` test pattern with mandatory `// Output:` validation, unordered output variant, naming conventions table for `ExampleFunc` / `ExampleType` / `ExampleType_method` / `ExampleFunc_scenario`), Inline Doc Links via `[Symbol]` / `[pkg.Symbol]` (resolves in `gopls` + pkg.go.dev), Doc Tests on Methods, Deprecation via `Deprecated:` paragraph (gopls strikethrough), Module Documentation (`doc.go` pattern, `go.mod` module path → pkg.go.dev rendering), Inline Comments discipline (WHY not WHAT, no origin tags), Common Failures (missing `// Output:`, renamed symbols, bare URLs).

## [0.75.0] - 2026-06-06

**Rust language template + structural template-shape consistency gate.** v0.75.0 adds the sixth devt template (rust), filling the 9-file baseline shape — `coding-standards`, `architecture`, `documentation`, `git-workflow`, `golden-rules`, `quality-gates`, `review-checklist`, `testing-patterns`, `patterns/common-smells` — plus a `canonical-entities.yaml` skeleton for the future arch-scanner port (DEF-061). Closes the GAP-1 class of template drift mechanically: K70 walks `AVAILABLE_TEMPLATES` and asserts every template ships the baseline; a new template can no longer silently ship fewer files than its peers. Validated against negative-test (removed `documentation.md` → K70 failed with the file name flagged; restored → passes).

Smoke: 818 passed, 0 failed (+2 from K69 + K70). Locking: 3/3.

### Added

- **Rust template** — sixth template in `templates/` joins python-fastapi, go, typescript-node, vue-bootstrap, blank. Ships the 9-file baseline (architecture, coding-standards, documentation, git-workflow, golden-rules, quality-gates, review-checklist, testing-patterns, patterns/common-smells) + canonical-entities.yaml skeleton. File-by-file: `coding-standards.md` (Edition 2024 + MSRV policy, naming, module organization, visibility minimization, anyhow+thiserror error-handling split, ownership/borrowing, async with Tokio, tracing crate logging, cargo fmt/clippy/quality-gates, `#[must_use]` discipline, Cargo features, unsafe code rules); `architecture.md` (Clean Architecture / Hexagonal layering, layer responsibilities, crate organization workspace vs single-crate, structural patterns: newtype/type-state/builder/trait-based DI/sealed traits, generics vs `Box<dyn Trait>` trade-off, async + concurrency patterns, error categorization, workspace configuration, forbidden patterns); `documentation.md` (rustdoc: `# Examples`/`# Errors`/`# Panics`/`# Safety` sections, intra-doc links, doc-test annotations, module-level docs, `cargo doc` strict-mode workflow, README discipline); `git-workflow.md` (branch + commit conventions, PR template, Cargo.lock discipline split for binaries vs libraries, semver bumps with `cargo semver-checks`, version-source-sync rules, pre-commit recipe); `quality-gates.md` (8-gate stack: check/clippy/fmt/test/doc-test/doc/audit/deny with deterministic commands + pre-commit + CI recipes); `golden-rules.md` (20 non-negotiables including no-unwrap-in-production, `?` for error propagation, `# Safety`/`# Panics` rustdoc sections, every `unsafe` has `SAFETY:` comment, newtype wrappers for IDs, `Cargo.lock` committed for binaries); `testing-patterns.md` (TDD red-green-refactor, file organization, async tests with `#[tokio::test]`, integration tests in `tests/`, doc tests, property-based with proptest, mockall, criterion benchmarks, anti-patterns); `review-checklist.md` (CRITICAL/HIGH/MEDIUM/LOW priorities: soundness+safety, error handling, security, type safety, borrowing+lifetimes, idiomatic Rust, async+concurrency, code quality, docs, testing, dependency hygiene); `patterns/common-smells.md` (Rust-native smell library: `unwrap()` in production, `Box<dyn Error>` in library public API, `unsafe` without `SAFETY:`, excessive `.clone()`, `Arc<Mutex<T>>` defaults, `await` holding `std::sync::Mutex`, indexed loops, truncating `as` casts, missing `Send + Sync` bounds, `String` where `&str` would do, derived `Copy` on secrets); `canonical-entities.yaml` (skeleton matching python-fastapi shape but with Rust-native vocabulary: `forbid_bare_primitive` instead of `forbid_string_only`, `pk_kind` instead of `pk_type`, 3 commented examples for EXISTS/ENUM/MISSING modes). Registered in `AVAILABLE_TEMPLATES` (`bin/modules/setup.cjs`); `setup --template rust --mode create` scaffolds the full set at `.devt/rules/`.

- **K69 smoke gate (`setup --template rust`)** — verifies the rust template is registered in `AVAILABLE_TEMPLATES` and `setup --template rust --mode create` produces the 6 (initial) canonical .md files + `canonical-entities.yaml` at `.devt/rules/`. Without this gate, a typo in `AVAILABLE_TEMPLATES` would only surface to end users at setup time.

- **K70 smoke gate (template-shape consistency)** — walks every template registered in `AVAILABLE_TEMPLATES` and asserts each ships the 9-file baseline (`architecture.md`, `coding-standards.md`, `documentation.md`, `git-workflow.md`, `golden-rules.md`, `quality-gates.md`, `review-checklist.md`, `testing-patterns.md`, `patterns/common-smells.md`). Closes the structural gap that K69 (and earlier per-template gates) leave open: a new template can silently omit standard files. Catches the GAP-1 class drift on future template additions before they reach users. Templates may ship MORE than the baseline (e.g. python-fastapi's hurl-* files, rust's canonical-entities.yaml) — extra files are fine; the gate flags only missing baseline files. Smoke: 818 passed, 0 failed (+2 from K69 + K70). Locking: 3/3.

### Deferred

- **DEF-061** — Rust arch-scanner port from `python-fastapi/arch-scan.py` shape to Rust idioms. Intentional scope cut: (1) Rust's borrow checker + cargo workspace boundaries already mechanically enforce more architectural rules than Python (cyclic deps prevented at Cargo level, visibility enforced by `pub`); (2) arch-scan.py's incremental value-add for Rust would be primarily canonical-entities checks (bare-primitive-where-newtype, FK column patterns, ownership), which require AST parsing via syn or rust-analyzer; (3) python-fastapi arch-scan.py is ~1200 lines + detectors/ ≈3500 lines — multi-day port deferred until proof-of-need. SUNSET TRIGGER: first real Rust devt user where canonical-entities rules are violated and they want mechanical enforcement, OR a calibration documents a Rust arch-pattern miss that arch-scan would have caught. Until then, `.devt/rules/architecture.md` + `golden-rules.md` + clippy + `cargo check` form the architectural enforcement layer.

## [0.74.0] - 2026-06-05

**Cal #20 integration response — substance-aware Layer-1 + Layer-2 stub-blocking + substance-check race fix.** Cal #20 produced two field-evidenced costs from the v0.73.4 cycle: (1) the only WORKS-BUT-FRICTION verdict was Layer-1 reporting `success` on 65/72-byte stubs because the contract was file-presence-only, leaving Layer-2 vulnerable to false-positive PASS when a stub won the latest-timestamp slot; (2) a 28 KB data-loss event where an orchestrator's substance check on a lane file fired BEFORE the agent's Task() returned, the premature read saw a stub, a retry was dispatched, and the retry's smaller output overwrote the first-pass's substantive output. v0.74.0 closes both with mechanical gates that don't require orchestrator discipline.

Smoke: 801 passed, 0 failed (+2 from K52 + K53; +1 from K51 already shipped). Locking: 3/3.

### Added

- **Substance-aware Layer-1** (`bin/modules/state.cjs`). `_assertArtifactPresentInner` and `_assertLaneArtifactPresent` now call a shared `_computeSubstanceVerdict` helper after the file-presence + size > 0 checks. The helper returns `substance_verdict: "stub" | "substantive" | "unknown"`. Size-threshold short-circuit at `STUB_SIZE_THRESHOLD = 1000` bytes: files above this cap fast-path to `substantive` without the deeper regex scan; files at or below run `checkAgentOutput` for the stub-phrase + word-count + heading-only heuristic. Cal #20 stubs were 65/72 B; substantive lane outputs were 7–42 KB — 1000 B threshold gives ~10x headroom. `persistClaimCheckResult` writes the `substance_verdict` field to `claim-check-failures.jsonl` only when present (backwards compat: historical records without the field treated as substantive by Layer-2).
- **Substance-aware Layer-2 stub-blocking** (`bin/modules/state.cjs::assertClaimChecksResolved`). Now treats `verdict=success + substance_verdict=stub` as unresolved. Substantive retry overwriting the stub record stays the happy path (last-write-wins per agent). The `kind` field on each unresolved entry distinguishes `"failure"` (missing/empty artifact) from `"stub"` (present but substance-thin) so remediation prose can specialize.
- **`state assert-file-quiescent <path> [--settle-ms=N] [--timeout-ms=N]`** — mtime-stability primitive. PRIMARY mechanism for guarding against premature substance reads. Stats the file at T0, sleeps settle-ms, stats again at T1; returns `ok:true` when size + mtime are identical (no active writer). Default settle 500ms, default timeout 5000ms. On timeout, returns `ok:false` with reason — workflows can BLOCK (strict) or warn-and-proceed (best-effort with sentinel logging). Mechanically robust without orchestrator burden — closes the cal #20 §10 data-loss bug regardless of orchestrator polling discipline.
- **`state assert-lanes-quiesced`** — workflow-mechanical OPT-IN gate. Reads `workflow.yaml::lanes[*].status`; returns `ok:false` if any are still `in_flight`; `ok:true` when all are terminal (`substance_pass | stub_redispatched | deferred`). Available for workflows that own the lane lifecycle tightly (orchestrator updates lane status away from `in_flight` after each Task returns). NOT the default path — `assert-file-quiescent` is the mechanical primary; this is the strict opt-in for projects that prefer the explicit contract.
- **`code-review-parallel.md::substance_check_lanes` wired with `assert-file-quiescent`** at the top of the per-lane loop. Each lane's file is checked for quiescence before any substance read; on timeout, the workflow logs a `[QUIESCE-WARN]` sentinel and proceeds (the hard-defer-on-<30-bytes catches genuinely empty results downstream). Latency cost per lane: 100-500ms on the happy path (file already stable on first stat pair); higher only when an agent is actively writing.

### Changed

- **K33 fixture updated to substantive content**. The prior fixture wrote `# Arch Review\n` (13 bytes, heading-only) as the "substantive" arch-review test case. The new substance-aware Layer-1 correctly classifies that as stub; Layer-2 then blocks per the new contract. K33 now writes multi-paragraph content above the substance threshold to test the post-substance-aware Layer-2 happy path honestly.

### Smoke gates

- **K51**: substance-aware Layer-1 + Layer-2 stub-blocking 5-state matrix (large→substantive | stub→stub | L2-blocks-on-stub | retry→substantive | L2-passes-after-retry)
- **K52**: `assert-file-quiescent` (stable→ok | missing→fail | settle-window honored)
- **K53**: `assert-lanes-quiesced` (in_flight×2 → block | terminal×2 → pass)

### Design decision: §3 mtime-stability primary (rationale)

Cal #20's third top-priority was the substance-check race fix. Greenfield's stated preference: workflow-mechanical (A) primary + mtime-stability (B) secondary. Code-level analysis surfaced a tension: workflow-mechanical requires orchestrator discipline (Claude updates `workflow.yaml::lanes[].status` away from `in_flight` after each Task returns) — but lanes register at `in_flight` from `partition_lanes` and there is no canonical step that flips them to a non-`in_flight` intermediate state before `substance_check_lanes` runs. Implementing A as default would require ADDING a new orchestrator discipline — precisely the kind of discipline whose absence caused the cal #20 28 KB data-loss bug. Mtime-stability (B) is mechanically robust without orchestrator burden; B was promoted to PRIMARY and A is shipped as OPT-IN for projects that own the lane lifecycle tightly. Both gates exist; only the default wiring changed.

### Deferred from v0.74.0 scope

Per the Option C release-cycle discipline (split-and-validate over big bundles), the following cal #20 work ships in v0.74.1 after cal #21 validates §1 + §3 in the field:

- **§2 — `/devt:repair-review` slash command** (auto-discover from `verification.json::verdict=needs_revision` + W1 whitelist + parallel re-consolidator). Greenfield's #2 priority; closes 3 cal #20 frictions but introduces a NEW orchestrator surface with no prior field history — benefits from cal-validation of §1+§3 before piling on.
- **§5 — `assert-preflight-semantic-quality` wiring** into `dev-workflow.md::context_init`. Greenfield's add-on for closing the 1-of-7 still-unused state subcommand classified as "real gap."
- **DEF-059 — `assertClaimChecksResolved` + `_phase-gates.yaml` registry expansion** for per-workflow_type Layer-1 expectations. The new gates (`assert-file-quiescent`, `assert-lanes-quiesced`) are intra-workflow gates that don't belong in `_phase-gates.yaml` (which declares finalize-phase gates). The architectural extension that would let the registry declare per-workflow_type Layer-1 expectations is larger scope; deferred.

### Cal-evidence anchoring

- §1 closes the ONLY WORKS-BUT-FRICTION verdict from cal #20 (Layer-1 verdict on stub files).
- §3 closes the cal #20 §10 negative surprise (28 KB data loss).
- v0.74.0 ships exactly the field-evidenced fixes; v0.74.1 picks up the NEW surface (§2) after cal #21 confirms §1+§3 don't have hidden issues.

## [0.73.4] - 2026-06-04

**Integration alignment patch: close cal #19's coverage gaps + surface friction fixes + ship the rate-limit-mid-section recovery diagnostic.** Strategic mandate from the user post-cal #19 was explicit: "instead of adding new and more features we should make all current existing structure are fully integrated with each other and fully aligned with each other." Both cal #19 evaluations (PR #387 review + GFBUGS-241 implement) surfaced 8-of-16 surfaces NOT EXERCISED — gates wired but unused in normal workflow. v0.73.4 closes the silent-coverage gaps (Layer-1 in parallel reviews), wires the rate-limit-mid-section diagnostic (PARTIAL contract broken for non-boundary stops), restores per-workflow observability (workflow_type in gate-trace), preserves the args-VERBATIM audit trail past evict-graphify, and aligns docs + UX with field-validated behavior.

Smoke: 795 passed, 0 failed (+3 from K45 + K46 + K47). Locking: 3/3.

### Added

- **Polymorphic `state assert-artifact-present <agent>:lane-<id>`** (`bin/modules/state.cjs`). Closes the cal #19 coverage gap where `code-review-parallel.md` had no Layer-1 integration despite being output-writing. Agent argument now accepts canonical form (`<agent>`, resolves from `io-contracts.yaml::outputs.primary`) OR lane form (`<agent>:lane-<id>`, resolves from `workflow.yaml::lanes[].review_file`). The agent key in the persisted record includes the lane suffix so Layer-2's per-agent latest-verdict computation treats each lane as a distinct stream within the workflow window. `code-review-parallel.md` fires a per-lane call at `substance_check_lanes` AND `redispatch_lanes`; successful re-dispatch overwrites prior stub/missing failure records.
- **`state recover-partial-impl <agent>` CLI** (`bin/modules/state.cjs`) — rate-limit-mid-section recovery diagnostic. cal #19 §5 Q17 documented a rate-limit MID-section interrupt that left programmer `impl-summary.md` at the stub-first sentinel with no structured sidecar. The agent provably cannot detect rate-limits from inside; only the orchestrator has the signals. CLI reads `dispatch-warnings.jsonl::task_output_bytes` for `low_output:true` records + on-disk primary substance, returns a JSON decision matrix: `recovery_needed=true + suggested_action=SendMessage-resume` when stub+low_output pattern matches; `recovery_needed=true + suggested_action=investigate` when stub but no rate-limit signal; `recovery_needed=false + primary_state=substantive | missing` for cleaner outcomes; `recovery_needed=false + sidecar_status=<terminal>` short-circuit when sidecar declares terminal status.
- **`dev-workflow.md` + `quick-implement.md` recover-partial-impl orchestrator hooks** — bash block after programmer's `assert-artifact-present` call invokes the diagnostic and surfaces `[PARTIAL_IMPL_RECOVERY]` echo with `suggested_action`. Prose tells the orchestrator how to route each suggestion.
- **`agents/programmer.md` migration safety preflight rule** — cal #19 §7 F2: a programmer wrote a migration with revision-id collision → alembic "Cycle detected" → app refused to start. New paragraph in `execution_flow` tells the programmer to grep `^revision = '<new-id>'` across the migrations dir BEFORE writing any `migrations/versions/*.py` (or framework equivalent). One-line preflight; project-agnostic prose.

### Changed

- **`assertClaimChecksResolved` "absent" reason clarification** (`bin/modules/state.cjs`). Previously the file-absent path returned `ok:true` with reason `"no Layer-1 checks recorded yet"` which sounded like normal early-phase state but actually masked total Layer-1 inactivity (cal #19 Surprise 3 — `code-review-parallel` ran without any Layer-1 calls). Reason now flags the ambiguity: ok if workflow_type doesn't dispatch output-writers OR hasn't reached an output-writing phase; investigate as coverage gap if dispatches DID happen but Layer-1 calls were skipped (cross-check `gate-trace.jsonl` for `assert-artifact-present` entries in this window).
- **`persistGateTrace` reads `workflow_type` from `workflow.yaml`** (`bin/modules/state.cjs`). Cal #19 friction #1: `workflow_type=null` in 17/17 trace entries blocked per-workflow trend analysis. All future gate-trace records include `workflow_type` alongside `workflow_id` + `phase`.
- **`graphify-impact-plan.json` audit-survives-reset** (R-2 from cal #19 secondary audit). Removed from `GRAPHIFY_EVICTABLE` in `state-audit.cjs` (so `state evict-graphify` doesn't delete it mid-session). Added to `RESET_EXEMPT` in `state.cjs` (so `state reset` doesn't delete it across sessions). The `{tier, tool, args}` audit trail is now preserved alongside the other forensic JSONLs — closes the "args VERBATIM" unauditable gap.
- **`dispatch render-filled` accepts space-separator alongside colon** (`bin/modules/dispatch.cjs`). Cal #19 §7 F3: colon-only syntax surprised users who typed space-separated form first. Now `dispatch render-filled programmer auto` AND `dispatch render-filled programmer:auto` both work. Usage message updated.

### Smoke gates

- **K45**: `assert-artifact-present` polymorphic `<agent>:lane-<id>` form (L1 pass + L2 absent + UNKNOWN not-registered)
- **K46**: `recover-partial-impl` 4-state decision matrix (missing | substantive | stub+low_output | sidecar-DONE)
- **K47**: `gate-trace.jsonl` carries `workflow_type` + `workflow_id` + `phase` (no nulls when workflow.yaml is well-formed)
- **K48**: `dispatch render-filled` accepts both colon-joined (`agent:wf`) AND space-separated (`agent wf`) forms with byte-identical output (parity anti-regression)
- **K49**: `graphify-impact-plan.json` audit-survives-reset (off `GRAPHIFY_EVICTABLE` + on `RESET_EXEMPT`)

### Layer-1 coverage expansion (round 4 validation)

Workflow-coverage validation discovered **5 additional workflows** dispatching output-writing agents without Layer-1 claim-check:

| Workflow | Dispatches | Layer-1 sites added |
|---|---|---|
| `create-plan.md` | researcher + architect | 2 |
| `lesson-extraction.md` | retro + curator | 2 |
| `memory-promote.md` | curator | 1 |
| `memory-reject.md` | curator | 1 |
| `research-task.md` | researcher | 1 |

7 total Layer-1 sites added. Closes the cal #19 §9 Surprise 3 gap (greenfield: "23 state subcommands exist but only 8 used by workflows"). **K50 smoke gate** enforces ongoing coverage: every workflow dispatching output-writers must reference `assert-artifact-present` at least once (11 workflows checked, all pass).

### Validation amendment

Post-implementation validation pass surfaced 2 real bugs + 3 alignment gaps:

- **Bug fix**: `recover-partial-impl` stub-pattern regex now accepts both em-dash (`—`, canonical convention) and regular hyphen (`-`, common typo). Previously only em-dash matched, so a hyphenated stub like `# Impl - in progress` was misclassified as substantive → orchestrator skipped the SendMessage-resume suggestion. Test case `# Impl - in progress` (21 bytes) now correctly returns `primary_state: stub`.
- **Docs accuracy**: `docs/INTERNALS.md` `dispatch-warnings.jsonl` schema previously documented 2 sources (`raw_dispatch`, `task_output_bytes`) — actual file is **3-source** including `dispatch_scope` from `hooks/dispatch-scope-guard.sh`. Also added 3 missing fields to `task_output_bytes` (`low_output_threshold`, `stop_reason`, `mid_task_language`). Schema now matches source-of-truth.
- **CLAUDE.md discoverability**: added inventory entries for the polymorphic `assert-artifact-present <agent>:lane-<id>` form and the new `state recover-partial-impl <agent>` CLI. Future Claude sessions discover the new surfaces at SessionStart.
- **`debug.md` Layer-1 coverage gap**: closed the same gap that v0.73.4 closed for `code-review-parallel.md`. `debug.md` had Layer-2 `assert-claim-checks-resolved` at finalize but no Layer-1 `assert-artifact-present` calls — Layer-2 passed vacuously regardless of debugger dispatch outcome. New claim-check after `dispatch:debugger:debug` step.
- **DEF-059** filed for the architectural enhancement (`assertClaimChecksResolved` reads `_phase-gates.yaml` to declare per-workflow_type Layer-1 expectations) — deferred from v0.73.4 scope, sunset trigger: cal #20+ documents a real coverage gap the "absent" reason failed to surface.

### Docs alignment

- `docs/INTERNALS.md`: `dispatch-warnings.jsonl` discriminated-union schema (2-source table: `raw_dispatch` + `task_output_bytes`); `gate-trace.jsonl` cross-session retention semantics + filtering pattern.
- `workflows/code-review.md::Substep 6`: substance-byte-threshold heuristic — `assert-graphify-decision` checks drill-down section density, not MCP-call presence (cal #19 Surprise 1).
- `docs/AGENT-CONTRACTS.md::SendMessage primary path`: cal #19 §5 Q18 field validation of the "no active task" success-path semantic. The 3-strike NOT EXERCISED demote (PARTIAL emission + SendMessage-resume) is REVERSED: PARTIAL flipped to EXERCISED-AND-FAILED (covered by `recover-partial-impl`), SendMessage flipped to EXERCISED-AND-WORKED (documented as field-validated). Only M4 collisions remains as a 3-strike → filed as DEF-058 with sunset trigger.

### Deferred items

- **DEF-058**: M4 symbol collisions surface — 3rd strike NOT EXERCISED. Sunset trigger: cal #20+ documents a missed finding traced to a colliding symbol the per-lane prompt didn't disambiguate. R-6 (collision injection per lane) remains alive for v0.74 once Layer-2 lane records soak.

### Strategic note

This release deliberately ships NO new features. Every fix targets an integration gap, friction point, or alignment issue surfaced by cal #19's empirical findings. Per the user's mandate: "instead of adding new and more features we should make all current existing structure are fully integrated with each other and fully aligned with each other." v0.74.0 holds the larger architectural work (per-lane scope_hint via `graphify symbols-in-files` — R-4; state-subcommand integration audit — 15 of 23 subcommands unreferenced by any workflow; dispatch render-filled inline-task design question).

## [0.73.3] - 2026-06-04

**Greenfield-validation cycle: reverse-direction sync of a silent false-negative bug + upstream template hygiene cleanup.** Working with greenfield as the field-validation target surfaced two structural template issues: (1) `detectors/layer_imports.py` had a `str.endswith()` over-exemption that silently allowed nested non-composition-root `dependencies.py` files to bypass `LAYER-IMPORT-API` enforcement — greenfield had already fixed this with a regex-anchored implementation; (2) `templates/python-fastapi/canonical-entities.yaml` shipped greenfield's actual production domain registry (Country / Client / User / Organization with `app.services.*` import paths) as the example, leaking one project's domain to every other adopter. Both fixes ship in this release. Plus an unrelated skill-layer hardening from the same session: tier-selection sanity cross-check.

Smoke: 792 passed, 0 failed (+3 from K44, arch_scanner auto-wire gate, canonical-entities-clean gate). Locking: 3/3.

### Added

- **`detectors/layer_imports.py` regex-anchored composition-root check** (reverse-sync from greenfield-api field validation). Replaces `_API_DEPENDENCIES_SUFFIXES` tuple + `str.endswith()` with `_COMPOSITION_ROOT_PATTERNS` regex tuple + `pattern.match()`. The endswith version exempted any file ending in `dependencies.py` from `LAYER-IMPORT-API` enforcement — so a nested `app/services/<svc>/feature/api/v1/dependencies.py` got silently exempted despite NOT being the canonical FastAPI DI composition root. Regex anchors to `^app/services/[^/]+/api[/v1]/dependencies\.py$` matching only the canonical service-tree shape (per the template's `architecture.md`). Field-validated in greenfield; backported with `_is_composition_root` docstring explaining the structural rationale.
- **Regression test `test_t2_nested_dependencies_py_not_exempted`** in `templates/python-fastapi/tests/architecture/test_arch_scan_internals.py`. Writes a `dependencies.py` at `app/services/x/feature/api/v1/` with an infrastructure import; asserts `LAYER-IMPORT-API` fires. Anchors the regex-anchored behavior so any future revert to suffix-matching is caught. Mirrors the existing `test_t2_non_dependencies_api_files_still_fire` shape.
- **Auto-wire `arch_scanner.command` in `setup --template python-fastapi`** (`bin/modules/setup.cjs`). When `mode === "create"` or `mode === "reinit"`, sets `arch_scanner.command = "python3 .devt/rules/arch-scan.py --baseline .devt/state/arch-baseline.json --report .devt/state/arch-scan-report.md --json --fail-on critical,high"` in the generated `.devt/config.json`. Field-validated by greenfield as the working command. Without this, every new python-fastapi adopter had to discover the canonical CLI invocation themselves. Users can still override at any time; `mode === "update"` doesn't touch existing config.
- **Tier-selection sanity cross-check** in `skills/complexity-assessment/SKILL.md`. The Layer 1 (5-dim task score) ↔ Layer 2 (graphify blast-radius effect_size) wiring previously trusted graphify's verdict with no cross-check. Known failure mode: bulk_scoped blast_radius over-reports `large` for 1-file localised changes (diffuse keyword matches against a dense graph), promoting typo-fixes to COMPLEX. Override rule: when `effect_size == "large"` BUT `Scope ≤ 1 AND Integration ≤ 1`, use the 5-dim total alone and document the override inline. Converse trust-rule (5-dim high + effect_size==small → trust 5-dim) also documented — risk/dependency dimensions encode information graphify cannot derive from call edges.

### Changed

- **`templates/python-fastapi/canonical-entities.yaml`** now ships a clean generic skeleton (`entities: {}`) plus three commented-out illustrative examples covering all three `entity_status` modes (`EXISTS`, `ENUM`, `MISSING`) using neutral domain names (`widget`, `size`, `region`). Previous version leaked greenfield's actual registry (Country / Client / User / Organization / Role / License / Photo / calling_settings / scope / currency / language) with `app.services.*` import paths — every new python-fastapi adopter inherited greenfield's domain and had to manually delete it before populating their own. The schema documentation header is preserved verbatim. Greenfield's existing `.devt/rules/canonical-entities.yaml` is unaffected (the template only writes new files in `setup --mode update`).

### Smoke gates

- **K44**: `complexity-assessment` skill declares the sanity cross-check (two-anchor anti-regression: section heading + rule clause)
- **setup auto-wire gate**: `setup --template python-fastapi` writes `arch_scanner.command` containing the canonical CLI invocation
- **canonical-entities clean gate**: `templates/python-fastapi/canonical-entities.yaml` contains no `app.services.{countries,clients,identity,organizations,licences,photos}` import paths (guards against future re-leak)

### Field-validation cycle observations

This release demonstrates the bidirectional sync pattern: greenfield's vendored `.devt/rules/` copy is field-validated production usage. When it diverges from upstream devt's template, the divergence direction tells you which side has the improvement. The `layer_imports.py` regex anchor is one such instance — greenfield evolved a structural fix that never made it back upstream. The `canonical-entities.yaml` leak is the inverse: upstream devt shipped greenfield's domain as the example, which propagates one project's domain shape to every other adopter. Both are signals that the field-validation relationship should be active rather than passive — drift detection + bidirectional sync is now a documented memory ([[greenfield-devt-sync]]).

## [0.73.2] - 2026-06-04

**Architectural alignment patch: extend the v0.71→v0.73 gate enforcement floor to the arch-health workflow.** When v0.73 migrated 4 workflows to `state advance-phase`, `arch-health-scan.md` was left out — it still used the legacy `state update phase=X status=DONE active=false` pattern at finalize, and its `workflow_type` (`arch_health_scan`) was absent from `_phase-gates.yaml`. Result: the 6th workflow could exit successfully without running any of the gates that protect the other 5. Cal #18's architectural floor was a 5-of-6 floor, not a 6-of-6 floor. This release closes the gap and also extends report-archive retention so trend analysis across scans is possible without breaking the canonical-name reference downstream consumers use.

Smoke: 789 passed, 0 failed (stable). Locking: 3/3.

### Added

- **`arch_health_scan` registered in `workflows/_phase-gates.yaml`** with 2 finalize-deactivation gates: `assert-claim-checks-resolved` (Layer-2 post-hoc) and `assert-no-raw-dispatches-this-session` (S1 dispatch-hygiene). The arch-health flow doesn't dispatch reviewers (no knowledge-candidate tagging applicable) and doesn't run a verifier (architect's report IS the verification surface) — gates are scoped accordingly rather than rote-copied from dev/code-review.
- **Layer-1 mechanical claim-check after architect dispatch** in `workflows/arch-health-scan.md::architect_analysis` step. Runs `state assert-artifact-present architect` before the report step, surfaces a `[BLOCKED]` marker on substance-failure (stub heuristic + word-count + heading-only detection per the existing assert-artifact-present contract). Persists to `claim-check-failures.jsonl` for the Layer-2 finalize gate to read.
- **Timestamped report archive** in `workflows/arch-health-scan.md` report step. Each scan now writes BOTH `ARCHITECTURE-HEALTH-REPORT.md` (canonical "latest" pointer — overwritten each scan) AND `ARCHITECTURE-HEALTH-REPORT-YYYY-MM-DD.md` (dated archive — permanent). Trend analysis across scans is possible without rebuilding the canonical-name reference downstream consumers depend on.

### Changed

- **`workflows/arch-health-scan.md` finalize** migrated from `state update phase=arch_health_scan status=DONE active=false` → `state advance-phase arch_health_scan active=false`. The 6th workflow now runs through the same gate-at-transition layer as the other 5.
- **`workflows/dev-workflow.md` arch_health pre-decision phase update** migrated from `state update phase=arch_health status=DONE` → `state advance-phase arch_health`. Intermediate phases fall through to the plain phase update via the YAML registry's backwards-compat path; the migration is for architectural consistency across the codebase (one verb at finalize-style transitions, regardless of registry coverage).

### Smoke gates

- **K42** updated: now expects 6 `workflow_types` in `_phase-gates.yaml` (added `arch_health_scan` to the expected list)
- **K43** updated: now expects 5 workflow files using `state advance-phase` at finalize-deactivation (added `workflows/arch-health-scan.md` to the migrated set)

### Architectural floor status (post-v0.73.2)

The post-hoc-to-runtime axis is at the floor for **all 6 workflows** as of this release:
- cal #14 → warn at dispatch (`dispatch-hygiene-guard.sh` hook)
- cal #15+#16+#17 → warn at finalize (S1 + Layer-1 inline checks)
- cal #18 → block at finalize (Layer-2 post-hoc gate)
- cal #18 Phase B → block at transition (`advance-phase` CLI) — **now covering all 6 workflows including arch_health_scan**

There's nowhere lower than blocking the phase transition itself. Cal #19+ will reveal whether further work points to a new layer OR to refining the existing floor.

## [0.73.1] - 2026-06-03

**Documentation completeness for the v0.71→v0.73 gate enforcement architecture.** Pure documentation patch — v0.71.0 / v0.72.0 / v0.72.1 / v0.73.0 shipped 4 new architectural surfaces (Layer-1 + Layer-2 claim-check, gate-trace.jsonl, advance-phase CLI, YAML registry) but none were documented in the canonical reference docs (CLAUDE.md, INTERNALS.md, README.md). Future Claude sessions load CLAUDE.md at SessionStart and stitch mental models from INTERNALS.md — without coverage of new surfaces, sessions fall back to older patterns and bypass the architectural floor cal #14-#18 worked to establish.

No code changes. Smoke 789/0 stable.

### Added (documentation only)

- **CLAUDE.md** state CLI table now includes:
  - `state assert-artifact-present <agent>` — Layer-1 mechanical claim-check
  - `state assert-claim-checks-resolved` — Layer-2 post-hoc finalize gate
  - `state advance-phase <phase> [key=value ...]` — runtime gate-at-transition
- **docs/INTERNALS.md** new `Gate Enforcement Architecture (Layer-1 + Layer-2 + advance-phase)` section under Workflow Mechanics. Covers the architecture progression from warn-at-dispatch through block-at-transition, the mechanical claim-check + resolution semantic, the YAML registry single-source-of-truth pattern, belt-and-suspenders coexistence during migration cadence, and unified gate-trace.jsonl observability.
- **README.md** config defaults table now includes `claim_check_mode` and `graphify.blast_magnification_threshold` rows alongside the existing `dispatch_hygiene_mode` row — coordination-via-clear-protocols (N1 north star) requires the config surface to be documented at the project entry point.

## [0.73.0] - 2026-06-03

**Runtime gate enforcement via `state advance-phase` CLI (Phase B of greenfield cal #18 response).** Greenfield's cal #18 first-assessment top recommendation: "replace prose contracts with `state advance-phase <name>` CLI" so phase transitions become atomic CLI-gated operations. v0.69.5+v0.71.0+v0.72 shipped post-hoc finalize gates; v0.73 ships the **gate-at-transition** layer — phase advances run all required gates atomically and refuse to advance on failure. The orchestrator can't reach the target phase without the CLI running every required gate first.

This is the **next architectural layer** above v0.72's Layer-2. The four-cal pattern (cal #14-#17) had each new contract get bypassed; v0.73 moves enforcement into the CLI verb itself — there's no `update phase=X` shortcut around gate-running anymore at the migrated sites.

Smoke: **785 → 789 passed** (K40 advance-phase exit-1-on-block + K41 backwards-compat fallthrough + K42 YAML registry shape + K43 workflow migration coverage). 0 failed. Locking 3/3.

### Added

- **`state advance-phase <phase> [key=value ...]` CLI** (`bin/modules/state.cjs::advanceState`). Reads the current `workflow_type` from `workflow.yaml`, looks up required gates for the target phase in `workflows/_phase-gates.yaml`, runs each gate via the existing `assert-*` functions (centralized via `GATE_FNS` dispatch map), and either (a) throws on any failure → devt-tools.cjs catch exits 1, OR (b) atomically updates phase + status=DONE + any kv updates passed through. Mirrors v0.69.5's S1-v3 deactivation pattern (throw on block, structured error reason). Phases NOT in the registry fall through to a plain phase update — preserves backwards compatibility while the migration cadence rolls out across remaining transitions. Every gate firing logs to `gate-trace.jsonl` via `persistGateTrace` with name prefixed `advance-phase:` so cal #19+ can distinguish transition-time gates from manual one-off gate runs.
- **`workflows/_phase-gates.yaml` SSOT** declarative per-workflow_type per-phase gate registry. Zero-dep YAML parser (`parsePhaseGatesYaml`) mirrors `dispatch.cjs::parseIoContracts` precedent. Initial scope: the final-deactivation phase per workflow_type (`complete` for code_review / code_review_parallel / dev / quick_implement; `debug` for debug.md). The YAML is the canonical answer to "what gates must fire at this transition?" — workflow .md files reference it implicitly via `state advance-phase`. Future expansion covers intermediate transitions as cal #19+ evidence accrues.
- **Workflow migration to `state advance-phase`** at the 4 finalize-deactivation sites (`workflows/code-review.md`, `workflows/dev-workflow.md`, `workflows/quick-implement.md`, `workflows/debug.md`). The previous `state update phase=X status=DONE active=false` lines are now `state advance-phase X active=false`. Existing v0.72 inline gate-check bash blocks remain as belt-and-suspenders during the transition cadence — v0.74 cleanup removes them once cal #19+ confirms the YAML path catches everything.

### Smoke gates

- **K40**: `state advance-phase complete` returns exit 1 when finalize gates block (claim-check + knowledge-candidates + auto-curator)
- **K41**: advance-phase falls through to plain update for phases not in registry (backwards compat preserved)
- **K42**: `_phase-gates.yaml` declares all 5 expected workflow_types
- **K43**: 4 workflow files migrated (use `state advance-phase` at finalize-deactivation)

### Cal #18 first-assessment finding closure (full set since v0.71.0 shipped)

| Finding | Status |
|---|---|
| **#1 Runtime gate enforcement via `state advance-phase` CLI** | **SHIPPED in v0.73** (this release) |
| **#2 graph_node_exists filter on topic.symbols** | SHIPPED in v0.72.1 (WI-4) |
| **#3 Hyperedge completeness in reviewer prompt** | SHIPPED in v0.72.1 (WI-5) |
| **#4 gate-trace.jsonl** | SHIPPED in v0.72.1 (WI-3) |
| **#5 Edge-relation filter on `blast_radius::modules_touched`** | DEFERRED — sunset trigger updated in v0.72.1 (cal evidence on Q2 firing rate ≥20%) |

### Cal #19 prompt prep

Cal #19 should specifically test:
- (a) Phase B: `state advance-phase` correctly blocks transitions when gates fail in a real session; orchestrator hits the exit-1 path and re-dispatches rather than rationalizing
- (b) Phase A (v0.72.1): gate-trace.jsonl observability — `cat .devt/state/gate-trace.jsonl | jq -s 'group_by(.gate) | map({gate: .[0].gate, fires: length, blocks: map(select(.verdict=="fail")) | length})'` should show per-gate firing + block-rate metrics directly
- (c) Phase A (v0.72.1) hyperedge surfacing reaches lane reviewers in parallel review workflows
- (d) Re-test v0.71.0 NOT EXERCISED items (PARTIAL emission, SendMessage-resume, collision detection) — these have not been field-validated yet
- (e) Confirm v0.72's Layer-2 + v0.73's advance-phase work together without redundant blocking (belt-and-suspenders → cleaner v0.74 design)

### Deferred to v0.74 / future

- **Cleanup pass**: remove inline gate-check bash blocks in workflow .md files (currently redundant with advance-phase). Sunset trigger: cal #19 confirms advance-phase catches what inline gate-checks catch.
- **YAML expansion**: declare gates for intermediate transitions (review→verify, implement→test, etc.) as cal evidence shows they're needed.
- **Migration extension**: `state update phase=X status=BLOCKED verdict=FAILED` patterns retained — those are the explicit-failure markers, not advance-phase candidates.

## [0.72.1] - 2026-06-03

**Greenfield cal #18 first-assessment quick wins (Phase A).** Greenfield's first assessment of v0.71.0 validated the post-hoc enforcement architecture (S1 dispatch-hygiene gate fired correctly, blocked deactivation on 6 raw parallel devt:code-reviewer dispatches) AND identified the next layer (runtime gate enforcement via `state advance-phase` CLI). v0.72.1 ships the **3 independent quick wins** from greenfield's top 5: graph-node existence filter on all topic.symbols (#2), hyperedge completeness in reviewer prompt (#3), unified gate-trace.jsonl observability (#4). The big structural fix — `state advance-phase` CLI (#1) — and edge-relation filter on `blast_radius::modules_touched` (#5) are scoped for v0.73 / v0.74 respectively where their blast-radius warrants focused validation cycles.

Smoke: **781 → 784 passed** (K37 gate-trace + K38 graph_node_exists field + K39 hyperedge surface). 1 pre-existing failure unchanged. Locking 3/3.

### Added

- **WI-3 unified gate-trace.jsonl observability** (`bin/modules/state.cjs::traceGate` + `persistGateTrace`). Every `assert-*` CLI invocation now appends one record `{ts, source:"gate_trace", gate, verdict:"ok"|"warn"|"fail", reason, workflow_id, phase}` to `.devt/state/gate-trace.jsonl`. Wraps all 14 assert-* cases in the state.cjs run() switch via `traceGate(name, fn)` — single wrap point per gate. Cal #19 has unified observability (firing rates + verdict timelines across the entire gate surface) instead of stitching together dispatch-warnings.jsonl + claim-check-failures.jsonl + preflight-denies.jsonl. End-to-end verified across 3 gate types with workflow_id + phase enrichment from workflow.yaml. Fail-open persistence (matches dispatch-warnings pattern). **N1 strong** (observability supports protocol coordination), **N2 moderate** (substance gate firing-rate visibility), **N3 mod** (~100 bytes per gate fire, bounded).
- **WI-4 graph_node_exists filter on ALL topic.symbols** (`bin/modules/preflight.cjs::generate`). v0.71's M1 added the existence filter to `pickCentralSymbol` (one symbol at a time). v0.72.1 extends the filter to ALL topic.symbols at preflight-write time so downstream `blast_radius`, dispatch envelopes, and reviewer prompts only see graph-anchored symbols. Falls through to legacy (no filter) when graphify unavailable — identical degradation pattern to M1. Phantom symbols surfaced as `topic.symbols_dropped_no_graph_node` so cal #19 + downstream agents see what was filtered. **N4 strong** (delegates to graphify.getNode — coordination wrapper, no reimplementation), **N2 strong** (cleaner downstream signal). End-to-end verified with mock graph: 2 real symbols kept, 2 phantoms dropped.
- **WI-5 hyperedge completeness reaches reviewer prompt** (`workflows/code-review.md`). Preflight computed `hyperedges_matched` with completeness ratio (e.g., greenfield's `license_update_rights_flow` at 14% = 1/7 RBAC chain members in scope) but the data never reached the code-reviewer dispatch — it sat in `preflight-brief.json` and was consumed only by `/devt:ship`'s completeness scan. v0.72.1 surfaces partial-coverage hyperedges (completeness < 1.0) in `graph-impact.md` alongside existing topic-symbols-dropped + ambiguous_bindings sections, with member-list breakdown showing which members are in-scope vs out-of-scope. Reviewers see the gap inline and can recommend scope expansion OR explicit deferral in their verdict. **N1 strong** (protocol-level surfacing of semantic-grouping signal), **N2 strong** (catches "fixed code, forgot related route/migration/test" failure mode).

### Smoke gates

- **K37**: `gate-trace.jsonl` captures every assert-* gate firing with verdict + workflow_id enrichment
- **K38**: `preflight-brief.json::topic.symbols_dropped_no_graph_node` field present (empty when graphify disabled OR all symbols graph-anchored)
- **K39**: `code-review.md` graph-impact.md compose block surfaces hyperedge completeness section

### Greenfield cal #18 first-assessment finding closure

| Finding | Status in v0.72.1 |
|---|---|
| **#1 Runtime gate enforcement via `state advance-phase` CLI** | **DEFERRED to v0.73** — structural fix; deserves focused release. v0.72's Layer-2 + v0.72.1's gate-trace.jsonl give cal #19 the observability to validate the transition point. |
| **#2 graph_node_exists filter on topic.symbols** | **SHIPPED** (WI-4). Extends v0.71 M1 pattern from central-symbol to all symbols. |
| **#3 Hyperedge completeness in reviewer prompt** | **SHIPPED** (WI-5). Surfaced in graph-impact.md with in-scope/out-of-scope breakdown. |
| **#4 gate-trace.jsonl** | **SHIPPED** (WI-3). Unified observability across all 14 assert-* gates. |
| **#5 Edge-relation filter on `blast_radius::modules_touched` (M2)** | **DEFERRED to v0.74 OR cal evidence trigger** — partial calibration shipped in v0.72 (Q2 caller_count_via_grep cross-check + magnification_advisory). Sunset trigger: Q2's magnification_advisory must fire in field for M2 to be the right fix path (otherwise cross-check is sufficient). |

### Sunset trigger update (anti plan-debt-rot)

Updated v0.72's deferred-items sunset criteria based on cal #18 first-assessment evidence:

- **M2 sunset** (was: "field finding where caller_count_grep differs ≥3× AND downstream over-dispatched"): now reads "ship in v0.74 OR when cal evidence shows Q2 magnification_advisory firing rate >20% — high false-positive rate means M2 proper fix needed; low rate means cross-check is sufficient calibration".
- **advance-phase CLI** (new, was implicit in plan): explicit v0.73 target. Sunset already satisfied by greenfield's cal #18 #1.

## [0.72.0] - 2026-06-03

**Close the cycle — Layer-2 enforcement + automation + delegation.** v0.71.0 shipped the architectural floor (mechanical contracts: Q11 claim-check, Q8 PARTIAL state, M5 sentinel). Four consecutive calibrations followed the same pattern — devt ships a contract, orchestrator ignores warnings, next calibration documents the bypass. v0.72 closes the cycle by adding the **Layer-2 enforcement** that turns warnings into hard gates at finalize, mirroring v0.69.5's `assertNoRawDispatchesThisSession` pattern that has held up across 4 cals. Plus two automation gaps (L1-v2 prose-only suppression moved from prose to bash; Q2 grep cross-check as graphify calibration) and one delegation win (memory `--validate-refs` leverages claude-mem + git grep without reimplementation).

Plan alignment scored against verbatim north-star definitions:
- **N1 coordination**: WI-1 + WI-2 strong (workflow gates as protocol handshakes; orchestrator-judgment paths removed)
- **N2 code quality**: WI-1 + WI-3 strong (substance gate prevents shallow-completion; refutes false-positive risks)
- **N3 token efficiency**: WI-2 strong (saves ~5-10KB graph-impact injection per prose-only lane)
- **N4 delegate to graphify+claude-mem**: WI-3 + WI-4 strong (`memory query --validate-refs` uses claude-mem + git grep; Q2 cross-check uses git grep as graphify calibration — pure coordination wrapper, zero reimplementation)

Smoke: **777 → 781 passed** (K33 Layer-2 round-trip + K34 LANE_GRAPH_IMPACT_BLOCK bash + K35 --validate-refs accepts flag + K36 Q2 cross-check fields). 1 pre-existing failure unchanged.

### Added

- **Layer-2 claim-check post-hoc enforcement** (`bin/modules/state.cjs::assertClaimChecksResolved` + new CLI `state assert-claim-checks-resolved`). Mirrors the v0.69.5 `assertNoRawDispatchesThisSession` pattern exactly: append-only audit trail in `.devt/state/claim-check-failures.jsonl` (every Layer-1 `assert-artifact-present` call appends success or failure record), per-agent last-write-wins resolution semantic (successful re-runs overwrite prior failures), post-hoc finalize gate fires on unresolved failures in workflow window. Wired adjacent to existing `assert-no-raw-dispatches-this-session` calls in all 4 finalize sites (code-review.md, debug.md, dev-workflow.md, quick-implement.md). New config knob `claim_check_mode: "block"` (default) / "warn" / "off" — same pattern as `dispatch_hygiene_mode`. End-to-end verified across 7 lifecycle test cases.
- **L1-v2 prose-only lane automation** (`workflows/code-review-parallel.md`). Bash now COMPUTES the actual `LANE_GRAPH_IMPACT_BLOCK` + `LANE_SCOPE_HINT_BLOCK` per lane based on `LANE_FILES_PROSE_ONLY` detection (the detection bash already existed). Task() prompt examples updated to use `${LANE_GRAPH_IMPACT_BLOCK}` / `${LANE_SCOPE_HINT_BLOCK}` directly — the orchestrator no longer needs to remember to swap in the not_applicable stub. Removes the "MUST replace" verbal-contract anti-pattern at L1-v2 (cal #15 + #17 evidence of bypass).
- **Memory query --validate-refs flag** (`bin/modules/memory.cjs::validateRefs` + flag handler in `query` CLI). Scope-filtered: ONLY validates entries with `doc_type ∈ {lesson, rejected}` (devt's analog of "concern|risk|warning" — entries that propagate as actionable warnings). For each in-scope entry, takes first 5 from `doc.affects_symbols`, runs `git grep -l -F` per symbol, reports `still_present + sample_locations` per symbol + `has_drift + summary` per entry. Cal #17 §J evidence: memory entry 14398 wrongly flagged "2-caller risk" for `update_license_rights` — `--validate-refs` catches stale entries whose declared symbols are no longer in the codebase. Strong N4 delegation: git grep + claude-mem entries as coordination layer, no reimplementation.
- **Q2 caller_count_via_grep cross-check** in `preflight-brief.json::blast` (`bin/modules/preflight.cjs::generate`). For each top topic.symbol (cap at 5), runs `git grep -c -F "<sym>("` and sums caller counts across files. Compares with graphify's BFS-derived `direct_dependents_count`: when `bfs >= grep * threshold` (default 3x, config knob `graphify.blast_magnification_threshold`), emits a `magnification_advisory` flagging potential interface-edge amplification. Cal #17 §F2 evidence: greenfield's `update_license_rights` reported 33 modules via BFS-in depth-2 vs 1 literal caller — 33x magnification. Pure N4 coordination wrapper around git grep + graphify; both fields surface in `blast` so downstream agents calibrate their decisions.

### Smoke gates

- **K33**: Layer-2 round-trip (empty→ok, failure→block, success-resolution)
- **K34**: code-review-parallel.md bash-computes `LANE_GRAPH_IMPACT_BLOCK`
- **K35**: `memory query --validate-refs` accepts flag + surfaces `validate_refs:true` envelope field
- **K36**: `preflight-brief.json::blast` carries `caller_count_grep` + `magnification_advisory` fields

### Changed

- `bin/modules/config.cjs` — two new defaults: `claim_check_mode: "block"` (mirrors `dispatch_hygiene_mode`) + `graphify.blast_magnification_threshold: 3` (Q2 cross-check trigger threshold).
- `bin/modules/state.cjs::assertArtifactPresent` — now wraps an inner function and persists every result (success + failure) to `claim-check-failures.jsonl`. Persistence is fail-open. Authoritative return value unchanged.
- `bin/modules/memory.cjs::queryFTS` ↔ `query` CLI — `--validate-refs` flag added (full-mode only; aggregate modes unchanged).

### Direct cal #16/#17 finding closure

- **§G + §K (Section trust-but-verify + architect-output completeness, scored 3/10)**: Layer-2 turns Layer-1's `[BLOCKED]` warnings into hard gates at finalize. Architect-skip case (greenfield's documented failure) now mechanically caught.
- **§J (auto-mode decision quality, scored 5/10)**: `memory query --validate-refs` provides the auto-refutation greenfield Q9/M11 specified. Stale entries flagged with `has_drift: true`.
- **§F2 (blast_radius magnification, 33 vs 1)**: Q2 cross-check surfaces magnification ratio in brief; downstream agents can calibrate.
- **§6.6 (prose-only lane noise)**: L1-v2 now bash-automated; orchestrator-judgment opportunity removed.

### Deferred items + explicit sunset criteria (anti plan-debt-rot)

| Deferred item | Sunset trigger |
|---|---|
| WI-5 expansion to 14 remaining dispatch sites | Cal #18 confirms v0.71.0 Layer-1 + v0.72 Layer-2 pattern works in field → expand. OR cal #18 documents specific failures at currently-uncovered sites → expand to those sites only. |
| M7 parallel sub-dispatch for COMPLEX with parallelism guarantee | 2 consecutive cals show >1 budget-wall hit per session despite Layer-2 in place → prevention layer becomes needed. Currently cal #17 = 4 walls; need cal #18 baseline to compare. |
| M2 modules_touched BFS tightening | Cal evidence documents a field finding where `blast.caller_count_grep` (new in WI-4) differs from `direct_dependents_count` by ≥3× AND a downstream agent over-dispatched on the inflated count → trigger design conversation. |
| Section I (Read-tracker bleed) | Claude Code releases note for parent/subagent tracker isolation OR cal documents this as load-bearing for a specific failure. |
| M3 existence_check helper | 2+ code paths in devt need the existence-vs-no-callers distinction. Currently only `pickCentralSymbol` uses the pattern (1/2 needed). |
| 5a 32-symbol surfacing extension (to dev-workflow + quick-implement) | Cal #18 documents a missing-surface case in one of those workflows → ship as v0.72.1. |
| 5c inline-import grep fallback (graphify-helpers Skill body) | 2+ cal findings cite missing inline-import edges. Currently 1 finding (cal #16). |

### Cal #18 prompt prep

Cal #18 audit prompt should explicitly test: (a) Layer-1 + Layer-2 claim-check round-trip in real session; (b) `memory query --validate-refs` flag usage + drift detection; (c) Q2 magnification advisory when present; (d) L1-v2 bash-computed block at parallel-lane dispatch; (e) re-test v0.71.0 NOT EXERCISED items (PARTIAL emission, SendMessage-resume, collision detection).

## [0.71.0] - 2026-06-03

**Greenfield calibrations #16 + #17 — verbal-contracts-to-mechanical-enforcement architectural fix.** Two consecutive calibrations independently surfaced the same root cause from different angles: devt's workflow contracts were prose-only declarations (`gate="arch-review.md is written"` in workflow frontmatter; "Read sidecar status" in prose) without mechanical enforcement. Cal #17's graphify-integration-review.md (54/110 score) made this explicit — sections G (subagent claim-checking, 3/10), H (mid-stream completion detection, 2/10), K (architect-output completeness, 3/10) all scored at the bottom because the contracts existed in markdown but no `[ -s file ]` shell guard, no return-token parser, no Status: PARTIAL state existed to catch mid-task wall hits. Cal #17 also delivered direct field evidence: 4 budget walls hit + 3 SendMessage-resumes manually performed in one session; architect returned a 2391-byte verbal summary claiming "wrote arch-review.md" but the file was never on disk; programmer returned "Now B.5" at the 91-tool-call wall and devt silently treated it as DONE.

This release closes the architecture across detection (Q11 mechanical claim-check), declaration (Q8 Status enum with PARTIAL), continuation (M5 SendMessage-resume protocol), and prevention surfaces (M1 + M4 graphify-side hardening). Architectural change is bundled to keep field-validation coherent — cal #18 will validate the full loop rather than partial layers.

Smoke: **775 → 777 passed** (K6 status-contract gate + K7 claim-check coverage gate); 1 pre-existing failure unchanged.

### Added

- **M1 + Q1 central_symbol_validator + SYMBOL_DENYLIST extension** (`bin/modules/preflight.cjs`). `pickCentralSymbol` now filters candidates by graph-existence via `graphify.getNode` before token-overlap scoring. When all symbols are absent from the graph, returns null (the workflow's bash fallback handles degraded display); when graphify is unavailable, falls through to legacy behavior preserving backward compatibility for projects without graphify. Q1 extends `SYMBOL_DENYLIST` with task-text noise tokens (`batch`, `wave`, `section`, `full`, `skip`, `semver`) that won the picker in cal #17 by scoring 1.0 against the literal task description ("Batch B refactor"). Field evidence: greenfield's "Batch" picked twice across cal #16 + #17 despite cal #16 raising the issue.
- **Q8 return-token contract** (`bin/modules/state.cjs::JSON_SIDECAR_SCHEMAS` + 6 agent markdown bodies + new section in `docs/AGENT-CONTRACTS.md`). PARTIAL added to all output-writing agent Status enums: programmer/tester (`DONE/DONE_WITH_CONCERNS/PARTIAL/BLOCKED/NEEDS_CONTEXT`), code-reviewer (`DONE/PARTIAL/BLOCKED`), verifier (`VERIFIED/GAPS_FOUND/FAILED/DONE_WITH_CONCERNS/PARTIAL`), architect/researcher/docs-writer/curator/retro (`DONE/DONE_WITH_CONCERNS/PARTIAL/BLOCKED/NEEDS_CONTEXT`), debugger (`FIXED/NEEDS_MORE_INVESTIGATION/DONE_WITH_CONCERNS/PARTIAL/BLOCKED`). PARTIAL emission convention: sidecar agents write `{"status":"PARTIAL", "next_section":"<name>"}`; markdown agents write `## Status: PARTIAL` + `## Next-section: <name>`. The Sidecar-only status routing contract is preserved (4 sidecar agents still emit no markdown `## Status` header) — schema-only addition.
- **D2 qualitative section_completion_protocol** in 5 heavy agents (programmer, code-reviewer, verifier, researcher, debugger). 10-line block after each agent's `<turn_limit_awareness>` section instructs the agent to check section boundaries qualitatively (no tool counting — Claude has no exposed tool-call counter to agents) and emit Status: PARTIAL when all three apply: (1) section complete, (2) more sections remain, (3) significant tool calls already + more work ahead. PARTIAL is explicitly distinguished from DONE_WITH_CONCERNS in the protocol prose.
- **Q11 mechanical claim-check** (`bin/modules/state.cjs::assertArtifactPresent` + CLI `state assert-artifact-present <agent>`). Reads agent → primary output mapping from `agents/io-contracts.yaml` (the existing single-source-of-truth — no new manifest file needed). Returns `{ok, agent, expected_path, exists, size_bytes, reason}` with four outcomes: agent-not-declared (ok:false with hint), file-missing (ok:false with re-dispatch guidance), file-empty/0-bytes (ok:false catching the stub-first-protocol-not-followed-through case), file-OK (ok:true with size). Workflow runners call this AFTER each output-writing dispatch instead of trusting verbal "I wrote X" claims.
- **WI-5 workflow wiring** in 4 workflow files at 5 dispatch sites (architect + programmer in `dev-workflow.md`; programmer + code-reviewer in `quick-implement.md`; code-reviewer in `code-review.md`). After each `<!-- END dispatch:* -->` marker, a bash claim-check invokes `state assert-artifact-present` and surfaces a `[BLOCKED]` warning when the agent didn't write its declared output. Gate-check prose extended to include PARTIAL routing: "SendMessage-resume the same agent with `<continue_from_section>` set to `sidecar.next_section`. Do NOT advance phase." Field-evidence-driven scope: 5 sites cover greenfield's documented failures (architect-skip, programmer mid-task return); 5 more sites (verifier, tester, parallel-review lanes) deferred to v0.71.1 pending cal #18 evidence.
- **WI-5b M9 mid-task heuristic regex** in `hooks/task-truncation-detector.sh`. Backup signal when an agent forgets to emit Q8 PARTIAL — regex on the return text catches phase markers ("Now B.5", "then C.3", "Next R2"), paused-language ("paused at/on/after"), and continuation prefixes ("continue with/from/later"). Patterns are tight to minimize false positives (verified: greenfield's "Now B.5" matches; normal completion "All tests pass now." does not).
- **WI-3b LOW-output cliff + opportunistic stop_reason capture** in `hooks/task-truncation-detector.sh`. New `low_output` boolean + `low_output_threshold` (500 bytes) detects suspiciously small subagent returns separate from the existing HIGH-output cliff (40K bytes). Field evidence: greenfield's "Now B.5" return at 140 bytes; threshold 500 provides 3.5x headroom. `stop_reason` captured from `tool_response.stop_reason` when present (Claude API standard field: end_turn / max_tokens / tool_use / pause_turn / refusal); null when absent — fail-open semantics. Advisory text branches: HIGH-output cliff recommends sidecar-read + tighter scope + split; LOW-output / mid-task-language cliff recommends sidecar-status check + SendMessage-resume.
- **M4 getSymbolCollisions helper + preflight integration** (`bin/modules/graphify.cjs::getSymbolCollisions` + `bin/modules/preflight.cjs::generate`). Scans graph `nodeMap` for all nodes whose label matches case-insensitively; returns `{source, collisions: [{id, label, source_file, source_location, class_qualifier}], count}`. Wired into preflight so each `topic.symbol` with collision count > 1 surfaces in `preflight-brief.json::blast.collisions[]`. Field evidence: greenfield's `update_license_rights` × 2 (LicenseDetailService + LicenseService) collision confused memory entry 14398 into wrongly flagging "2-caller risk". Now downstream agents see both bindings with their class_qualifier rather than the single arbitrarily-resolved one.
- **WI-7 F7/F16 discoverability fix**. Workflow .md prose enhanced at parallel-dispatch sites in `dev-workflow.md` (researcher + architect parallel) and `code-review-parallel.md` (lane dispatch) with a "Discoverability tip" block pointing at `dispatch render-filled <agent>:auto` + the `dispatch-helpers` Skill. `skills/dispatch-helpers/SKILL.md` extended with a SendMessage-resume pattern section + worked 6-section example. Field evidence: 2-strike reproduced — cal #16 surfaced "workflow doesn't include the CLI as a bash step"; cal #17 reproduced verbatim ("I hand-rolled the programmer prompt because the workflow file doesn't direct me to run it").
- **WI-6 SendMessage-resume protocol documentation** in `docs/AGENT-CONTRACTS.md::Q8 worked example`. Full worked example: 6-section impl, agent emits Status: PARTIAL with next_section, workflow claim-check confirms artifact present, sidecar reads PARTIAL, SendMessage primary path with `<continue_from_section>` block, re-dispatch fallback with `<continue_from_checkpoint>` block for cross-session resume. Cost evidence cited: ~15-20 file Reads saved per SendMessage-resume vs cold re-dispatch (greenfield cal #17 measurement).
- **K6 + K7 smoke gates** in `scripts/smoke-test.sh`. K6 asserts every output-writing agent declares Status enum with PARTIAL (10 agents checked: 6 markdown via `## Status` regex + 4 sidecar via JSON_SIDECAR_SCHEMAS awk parse). K7 asserts every wired dispatch site has `state assert-artifact-present <agent>` invocation (5 sites in current scope). Prevents WI-2/WI-5 regression: future agent additions or workflow edits that drop the contract are caught at commit time.

### Changed

- **JSON sidecar schemas in `bin/modules/state.cjs`** — `VERIFICATION_STATUSES`, `impl-summary.json::status`, `test-summary.json::status`, `review.json::status` all gained PARTIAL as an allowed enum value. Schema-only addition; existing validation paths continue to work for the prior states. Sidecar-only status routing contract preserved.

### Direct validation of cal #17 findings

- **M1 (central_symbol_validator)**: shipped. "Batch" failure mode demonstrated in controlled test (mock graph with Batch absent → picker correctly returns null/other-symbol; graphify-disabled → legacy behavior preserved). 4 test cases covered.
- **Q8 (return-token contract)** + **M5 (BatchComplete/PARTIAL sentinel)**: shipped together via PARTIAL state addition across 10 agents + sidecar schemas + agent-body section_completion_protocol. Section G/H/K's "verbal contracts → mechanical enforcement" root cause addressed at the contract layer.
- **Q11 (mechanical claim-check)**: shipped via assert-artifact-present CLI + 5 workflow wirings + K7 smoke gate. Greenfield's architect-skip case would now be caught with `[BLOCKED] Expected output .devt/state/arch-review.md does not exist` instead of silent advancement.
- **M4 (getSymbolCollisions)**: shipped. End-to-end verified — controlled graph with 2 `update_license_rights` nodes produces `blast.collisions[0].count=2` with both class qualifiers + source files in `preflight-brief.json`.
- **WI-4b artifact manifest (originally planned)**: subsumed by existing `agents/io-contracts.yaml::outputs.primary` — the declarative single-source-of-truth already exists. No new manifest file shipped, avoiding duplicate infrastructure.

### Deferred to v0.71.1 / v0.72

- **WI-5 expansion** — claim-check wiring at remaining dispatch sites (verifier, tester, parallel-review lanes). Current scope covers greenfield's documented failures; cal #18 will inform which additional sites need the gate.
- **M2 (modules_touched BFS tightening)** — graphify-internal blast_radius semantics change with downstream effect_size + community-filter trigger cascade; separate design conversation needed before scoping.
- **M3 (existence_check helper)** + **M7 (parallel sub-dispatch for COMPLEX with parallelism guarantee)** — both deferred. M3 is graphify-internal helper; M7 is structural-prevention layer above Shape 2's detection+recovery (needs plan-parser + new workflow contract; layer atop Shape 2 once that's field-validated).
- **Cal #16 backlog carry-forward** — 32-symbol cap surfacing, L1-v2 prose-only suppression automation, inline-import grep fallback in `graphify-helpers` skill. Lower-priority UX additions ranked below the architectural work.
- **Section I (Read-tracker bleed)** + **Section J (memory validation)** — Section I is mostly upstream Claude Code; Section J is separate quality-of-life conversation.

## [0.70.1] - 2026-06-02

**Greenfield calibration #16 — F9 wiring gap hotfix + DEF-052 field-confirmed surface.** Cal #16 (5-lane parallel code-review session, full evidence-anchored audit across §1-§10) surfaced two real issues in shipped v0.70.0 plus a high-severity DEF-052 field confirmation:

1. **F9 wiring gap**: `workflows/code-review-parallel.md` was missing the `state refresh-scope-context` invocation at both `STATE=$(... state read)` sites (L69 + L451). Greenfield's evidence: 0 hits in code-review-parallel.md vs 7 hits across `quick-implement.md` + `code-review.md` + `dev-workflow.md`. Result: across a 30+-min parallel review with 5 lanes + consolidator + verifier, the cached `scope_trust` was never re-derived, so byte-identical `<scope_trust>{...}</scope_trust>` blocks went out to all 7 dispatches. This is exactly the failure mode v0.70.0's per-dispatch freshness wiring was designed to prevent — the wiring was simply missing from one of the four workflow files.
2. **DEF-052 field confirmation**: greenfield's local install had skill 0.7.10 vs binary 0.8.24. `graphify --version` emits this drift on stderr (`warning: skill is from graphify X, package is Y. Run 'graphify install' to update.`) but devt never surfaced it. Consequence: `preflight-brief.json::hyperedges_matched` came back empty across multiple calibrations; greenfield reasonably interpreted "no semantic groupings found" when the real cause was version drift silently emptying the result. Same drift reproduced on the maintainer's local install too — verified the symptom is environmental, not a one-off.
3. **F1 false-alarm closure**: cal #16 reported S1-v3 deactivation hook didn't fire on greenfield's `state update active=false` despite raw dispatch in window + block mode. Reproduced all three deactivation paths (single-key update, multi-key update, `state release`) with the documented setup; gate fires correctly in every case (`workflow.yaml::active` stays true, stderr contains BLOCKED message, exit 1). Greenfield's specific session likely had `created_at` rotation timing that excluded the L5 raw dispatch from the window at deactivation time but included it post-hoc. No code change needed; documented as needs-more-evidence at next occurrence.

Smoke: **773 → 774 passed** (new K5 wiring-gap regression gate); 1 pre-existing failure unchanged.

### Added

- **K5 smoke gate — refresh-scope-context coverage assertion** (`scripts/smoke-test.sh`) — asserts count of `STATE=$(node ... state read)` matches count of `state refresh-scope-context` invocations per workflow file across the four files using this pattern (quick-implement, code-review, code-review-parallel, dev-workflow). `debug.md` and `research-task.md` are exempt because they read `scope_trust` directly from `preflight-brief.json` via jq (self-refreshing pattern). Cal #16's exact failure mode (2 STATE= vs 0 refresh) would have been caught by this gate at v0.70.0 commit time. Prevents the same regression class for any new workflow that adopts the STATE= pattern without the matching refresh call.
- **`graphify.cjs::detectSkillVersionDrift()`** — best-effort helper that calls `graphify --version`, parses stderr for the `warning: skill is from graphify X.Y.Z, package is A.B.C` pattern, and returns `{detected:bool, skill_version, binary_version, advisory}`. Spawn failure / graphify absent / unrecognized warning all return `{detected:false}` so callers can layer on top of existing fallback paths without behavior change.
- **`health.cjs` GRAPHIFY_SKILL_DRIFT check** — surfaces the version drift as a top-line warning issue in `node bin/devt-tools.cjs health` output. Only probes when `graphify` is on PATH (no noise on projects that don't use graphify). Remediation: `Run 'graphify install' to refresh the local skill bundle to match the binary version.`
- **`preflight.cjs::hyperedges_suppressed_reason` sidecar field** — when `hyperedges_matched` is empty AND skill/binary version drift is detected, `preflight-brief.json` now carries `hyperedges_suppressed_reason: "graphify skill X drift from binary Y; hyperedges may be silently empty — run 'graphify install' to refresh"`. Workflows that consume the brief can flag the empty list with the actual reason instead of treating it as "no semantic groupings found." Field stays `null` when graphify is healthy or when hyperedges are non-empty.

### Fixed

- **F9 — `workflows/code-review-parallel.md` missing per-dispatch scope_trust refresh wiring** (cal #16 BROKEN finding). Added `state refresh-scope-context` line before both `STATE=$(node ... state read)` sites (L69 lanes dispatch + L451 verifier dispatch). Behavior now matches the other three workflows that adopted the same pattern in v0.70.0.

### Closed without code change (false-alarm validation)

- **F1 — "S1-v3 deactivation hook didn't fire"**: reproduced all three deactivation paths (single-key `active=false`, multi-key `phase=complete status=DONE active=false`, `state release`) with `dispatch_hygiene_mode: block` + raw dispatch in workflow window. Gate fires correctly in every case; workflow stays `active:true`; stderr contains `[devt:dispatch-hygiene] BLOCKED workflow deactivation`; exit 1. Greenfield's specific case likely involves `workflow.yaml::created_at` rotation timing — not reproducible from the cal #16 evidence alone. Documented for next-occurrence capture (full session log + workflow.yaml snapshot at deactivation moment).

### Deferred to v0.71 (cal #16 design conversations)

- 32-symbol cap silent drop — `topic-symbols-dropped.json` sidecar exists but isn't referenced in dispatch prompts; surface as `<dropped_symbols>` block when count > 0.
- L1-v2 prose-only suppression automation — `workflows/code-review-parallel.md:256` documents the rule as human-enforced; needs per-lane bash detection writing `<graphify_status>not_applicable</graphify_status>` stub.
- `dispatch render-filled` discoverability at canonical workflow sites — workflow .md prose describes the envelope but doesn't include the bash invocation; greenfield (and any orchestrator following the workflow as-written) misses it.
- Inline-import edge grep fallback in `graphify-helpers` skill body (upstream-graphify limitation; devt-side workaround viable).

## [0.70.0] - 2026-06-02

**Greenfield calibrations #14 + #15 — friction-collapse on the canonical dispatch path.** Both calibrations surfaced the same root cause: greenfield's orchestrator treats the canonical workflow path as expensive friction, defaulting to raw `Agent(subagent_type="devt:*", …)` dispatches with prose context instead of routing through `/devt:review` / `/devt:workflow` / `/devt:debug`. Cal #14 (22 raw dispatches + 22 direct `state update` calls) drove the gate-bypass closure shipped in v0.69.5. Cal #15 (10 raw code-reviewer dispatches inside one `/devt:review` session) confirmed the gate fires retrospectively but does not change the moment-of-decision behavior — the orchestrator simply opts out via warn mode or leaves the workflow active forever (greenfield's §10c: *"I worked around [S1-v3] by leaving the workflow in active:true after presenting findings"*). This release attacks the moment-of-decision directly with three coordinated surfaces: a `dispatch render-filled` CLI for server-side envelope substitution, a `state refresh-scope-context` re-derivation hook wired into every dispatch site so cached `scope_trust` is always fresh, and a `dispatch-hygiene-guard.sh` enrichment that auto-injects the rendered envelope at the PreToolUse hook layer (warn mode). Block mode stays strict — no envelope in deny reason, so block users still get the canonical workflow path as the only forward motion. Smoke: **770 → 773 passed** (3 new K-series gates: render-filled substitution, refresh-scope-context JSON shape, hook envelope attachment).

### Added

- **`dispatch render-filled <agent>:<workflow_id|auto>` CLI** (`bin/modules/dispatch.cjs::cmdRenderFilled`) — server-side envelope substitution that produces a paste-ready `Task(subagent_type="devt:<agent>", model="…", prompt="…")` envelope with every recognized placeholder filled from current state, governing rules, inline guardrails, rubrics, and model-profile config. Three placeholder classes: simple data refs (`{scope_trust_json}`, `{scope_hint_json}`, `{memory_signal_json}`, `{task_description}`), structured lookups (`{governing_rules.content["X"]}`, `{inline_guardrails["X"]}`, `{models.X}`), and prose-descriptions (`{learning_context — …}`) which are correctly preserved as agent-read-time instructions. Both bare and shell-escaped variants of bracketed lookups handled. `<workflow_id>` accepts the literal `auto` to resolve from `.devt/state/workflow.yaml::workflow_id` (exit 2 + stderr message if no active workflow). Unknown placeholders pass through unmodified — the regex anchors are tight enough that templates can grow new prose placeholders without ever risking accidental substitution.
- **`state refresh-scope-context` CLI** (`bin/modules/state.cjs` subcommand → `preflight.cjs::scopeCache`) — thin alias for the existing `preflight scope-cache` re-derivation logic. Reads `preflight-brief.json::graph_stats + staleness`, applies the staleness-threshold override (forces `trust=sparse` when `lag_commits` exceeds threshold), and persists both `scope_hint_json` and `scope_trust_json` back to `workflow.yaml`. Idempotent, ~50ms, always-fresh from current graph state. Single source of truth for the staleness rules — no duplicated logic across the new CLI surface.
- **Per-dispatch scope_trust freshness wiring** — every dispatch block in `workflows/quick-implement.md` (2 sites: programmer, code-reviewer), `workflows/code-review.md` (2 sites: code-reviewer, verifier), and `workflows/dev-workflow.md` (3 sites: programmer, code-reviewer, verifier) now invokes `state refresh-scope-context` immediately before the `STATE=$(…)` block that extracts cached scope values. 7 total sites wired; `workflows/debug.md` correctly unchanged because it already reads scope_trust directly from `preflight-brief.json` on every invocation (its own self-refresh pattern). Fail-open: refresh failure preserves the cached value. **Before**: `scope_trust` computed once at Substep 6, injected verbatim across 6-8 dispatches over a 30+-minute session. **After**: cached value re-derives from current graph state on every dispatch (~50ms × 7 sites = 0.4s total per workflow run).
- **`dispatch-hygiene-guard.sh` warn-mode envelope auto-injection** — when `dispatch_hygiene_mode=warn` in `.devt/config.json`, a raw `Agent(subagent_type="devt:*", …)` dispatch (prompt missing all three scope blocks) now receives the fully-rendered canonical envelope as a structured `<canonical_envelope>…</canonical_envelope>` block inside `hookSpecificOutput.additionalContext`. The orchestrator sees the exact envelope it should have used, paste-ready, at the moment of decision. Best-effort with fail-open semantics: no active workflow, missing template, or plugin root absent → falls back to advisory-only (existing behavior). Block mode (the default) is unchanged — deny reason includes the `/devt:review` redirect only, no envelope, so raw-dispatch + paste cannot accidentally become the path of least resistance.
- **`skills/dispatch-helpers/` Skill** — autoloaded helper that fires when the orchestrator decides parallelism manually (raw `Agent()` to a `devt:*` subagent outside a `/devt:*` workflow). Description triggers on "fan out review across files X,Y,Z", "dispatch programmer in lanes", "parallel reviewer across communities", etc. Body teaches the `dispatch render-filled` CLI with a worked parallel-fan-out example (3-lane code review), enumerates the substitution surface, and documents failure modes. Reinforces the canonical workflow path as the preferred route — this skill is the escape hatch, not the default.
- **CLAUDE.md** `state refresh-scope-context` documented in the state CLI subcommand list; `dispatch render-filled` added to the `bin/devt-tools.cjs` help string and docstring.

### Changed

- **`bin/modules/init.cjs` exports** — `loadGoverningRules`, `loadInlineGuardrails`, and `loadInlineRubrics` are now in `module.exports` so `dispatch.cjs::buildSubstitutionTable` can reuse them. No behavior change for the existing `init workflow` / `init review` paths.
- **`bin/modules/preflight.cjs` exports** — `scopeCache` is now in `module.exports` so `state.cjs::refresh-scope-context` can call it directly without going through `run("scope-cache", [])` (which would double-print via the existing `process.stdout.write` inside that subcommand).

### Direct validation of greenfield's calibration #15 findings

- **Finding #1 (envelope freshness across phases — HIGH)**: confirmed in v0.69.5 architecture; closed in this release via per-dispatch `state refresh-scope-context` wiring. Greenfield's recommended design space (per-dispatch drift detection vs phase-counter triggers) was superseded by the cheaper D5 cadence — re-derive on every dispatch from `graph_stats` + `staleness`, ~50ms cost, simplest semantics.
- **Finding §10d (envelope composition is tedious — HIGH)**: confirmed root cause; closed via the three-surface fix (CLI + hook auto-injection + Skill). The orchestrator can now: (a) shell out to `dispatch render-filled <agent>:auto` for ad-hoc envelopes, (b) receive auto-injected envelopes via the hook in warn mode, or (c) trigger the `dispatch-helpers` Skill on fan-out phrasing.
- **Q1.4 false alarm (`state release` exit code)**: validated as false alarm in cal #15 post-audit; PIPESTATUS measurement trap on greenfield's side. Both `state update active=false` and `state release` exit 1 correctly. No code change needed; the v0.69.5 S1-v3 gate works as designed.
- **Finding #3 (graphify skill/binary version mismatch — MED)**: deferred to v0.71 as DEF-052 refinement. Health-side detection (parse `graphify --version` stderr for the `skill is from graphify X.Y.Z, package is A.B.C` warning) is the cleanest path; not yet implemented.
- **Finding §10c (workflow left active forever)**: not directly fixable without changing block-mode semantics — chose to preserve D1 (block mode stays strict, no envelope in deny reason) so that the orchestrator can't institutionalize the bypass. Cal #16 will validate whether the warn-mode auto-injection moves the needle without weakening block.

### North-star alignment

- **#1 coordination**: friction-collapse on the canonical path. Envelope generation moves from "construct from cached state + bash + jq + inline template" (high friction at decision time) to "shell out to one CLI" or "receive auto-injection from the hook". The canonical path is now cheap enough to choose by default.
- **#3 token usage**: per-dispatch `state refresh-scope-context` costs ~50ms × 7 sites = 0.4s per workflow run, negligible. Hook-attached envelopes save the orchestrator from a multi-second prompt-construction loop. Block-mode unchanged means deny reasons stay compact (~800 bytes), not bloated by envelope inclusion.
- **#4 delegate to graphify**: `scope_trust` re-derivation reads from graphify-derived `preflight-brief.json::graph_stats` rather than re-computing — single source of truth for graph staleness across cached and fresh paths.

### Deferred to v0.71

- DEF-052 refinement — graphify skill/binary version mismatch surfaced in health output
- DEF-053 — sibling-test glob fallback before FTS in reuse-candidate search
- DEF-054 — god-node noise suppression for leaf-change tasks
- DEF-055 — skip tester when impl-summary contains only test files
- R1 default tweak — `auto_refresh_post_impl` STANDARD+COMPLEX → `"true"`
- R3 god-node hard blocking gate (new CLI `state assert-god-node-blast-captured`)
- MCP server version stamping (commit SHA + start timestamp; `mcp ping` subcommand)
- Cal #15 graphify integration audit B1-B10 (10+ findings, validate each against codebase first)

## [0.69.5] - 2026-06-02

**Greenfield calibration #14 — gate-bypass escape hatch closure (S1-v3).** Closes the architectural escape hatch greenfield calibration #14 surfaced: the S1 gate (`assertNoRawDispatchesThisSession`) is invoked only from the 4 workflow .md files at finalize time, so CLI-driven orchestrators that bypass `/devt:*` slash commands entirely — using direct `state update phase=complete status=DONE active=false` to drive the workflow manually — never trigger the gate. Greenfield's evidence: 22 raw `Agent(subagent_type="devt:programmer", …)` dispatches + 22+ direct `state update phase=complete` calls + zero `/devt:implement` invocations across a 22-phase session. The S1 gate worked correctly within its design envelope; the orchestrator's operating envelope was entirely outside it. The fix: invoke the gate at the `active: true → false` transition inside `updateState()` itself — the write-side trigger that catches deactivation regardless of which CLI/workflow path produced it. `releaseWorkflow()` routes through `updateState()` internally (state.cjs:1403), so `state release` is covered automatically by the same hook. Smoke: **769 → 770 passed** (new S1-v3 smoke gate), **2 pre-existing failures** (opus-4-8-upgrade-report.md planning doc unchanged from v0.69.2; bash-guard perf budget — local environment timing variance, CI consistently under budget).

### Added

- **S1-v3 deactivation gate** (`bin/modules/state.cjs::updateState` at L821 + L967-981) — snapshots `wasActive = current.active === true` BEFORE the key=value loop, then after history maintenance + before atomic write, checks for `active: true → false` transition. If gate returns `ok: false`, throws prescriptive `[devt:dispatch-hygiene] BLOCKED workflow deactivation — …` error (process.exit(1), write prevented). Respects `dispatch_hygiene_mode` config: `warn`/`off` mode allows the deactivation but writes the alert to stderr; `block` mode (default) refuses. Same hook covers BOTH bypass paths: direct `state update active=false …` (greenfield's pattern) AND `state release` (via `releaseWorkflow` → `updateState` internal call at L1403). Single hook, two coverage.
- **Smoke gate S1-v3** — fixture exercises 4 behaviors: (a) deactivation BLOCKS with raw_dispatch in window (exit 1, write prevented — verified by re-reading workflow.yaml::active still=true); (b) warn mode allows + writes stderr alert + completes the deactivation; (c) activation (false→true) does NOT trigger the gate; (d) idempotent re-deactivation (already false) does NOT trigger the gate. Pre-existing S1-v2 (CLI assertion gate) continues to pass — both are now exercised in the smoke suite.

### Captured for v0.70 (calibration #14 follow-throughs)

- **Envelope freshness** (HIGH from cal #14): the `<scope_trust>` cache from Substep 6 (preflight) is injected verbatim into every subsequent dispatch via the `{scope_trust_json}` template placeholder in 6 dispatch sites across `dev-workflow.md` + `quick-implement.md`. There is no per-phase re-derivation — so a 22-phase session like greenfield's keeps injecting `{trust:"dense",lag_commits:0,fresh:true}` long after the codebase has materially changed underneath. Greenfield termed this "performative envelope injection"; the more accurate framing is that Substep 6 is one-shot by design and the design assumed graphify wouldn't drift mid-workflow. The `post_impl_graphify_refresh` step (debug.md:218, quick-implement.md:284, dev-workflow.md:948) EXISTS and would close the gap — but only fires when the orchestrator honors the workflow path. v0.70 design space: per-dispatch drift-detector (compare cached `lag_commits` vs current `graph_stats().head_commits_behind`) OR phase-counter trigger (re-run Substep 6 every N phases, configurable via `graphify.scope_trust_refresh_phases`).
- **R1 default tweak + commit-count heuristic**: change `auto_refresh_post_impl` default from `"ask"` to `"true"` for STANDARD+COMPLEX tier (TRIVIAL stays "ask"); add `graphify.cjs::maybeRefresh` heuristic to auto-fire when commits since last refresh > 10.
- **R3 god-node hard blocking gate**: new CLI `state assert-god-node-blast-captured` that cross-references `god_node_warnings_json` against `impl-summary.json::files_modified` and `_mcp-trace.jsonl::blast_radius` calls. Wired into dev-workflow + quick-implement dispatch context as warning by default, configurable to hard-block via `graphify.god_node_block_mode`. Detection + soft warning already exist (code-review.md:104-115); this adds the blocking layer.
- **MCP server version stamping** (optional, from cal #13 Q3.3): write commit SHA + start timestamp on MCP server boot; expose via `mcp ping`. Lets clients detect stale processes across plugin updates.
- DEF-052 (hyperedges-skill-mismatch advisory), DEF-053 (sibling-test glob), DEF-054 (god-node noise suppression), DEF-055 (skip tester for test-only impl) — all carried forward unchanged.

### Direct validation of greenfield's calibration #14 findings

- **Finding #2 (envelope performative)**: confirmed — Substep 6 caches `state.scope_trust_json` once at preflight; templates inject via placeholder. Substantive but expected behavior under the workflow's design contract. Fix scope = workflow template re-derivation logic; deferred to v0.70.
- **Finding #4 (gate bypass)**: confirmed by direct codebase analysis — `state.cjs::update()` had zero invocations of `assertNoRawDispatchesThisSession`. The HIGH finding from cal #13 honesty section. **Fixed this release.**
- **R1 / R3 vaporware false alarm (mine)**: an earlier validation pass I ran returned empty silently from `find . | xargs awk` due to a tool-handling quirk; I incorrectly characterized `auto_refresh_post_impl` and god-node detection as vaporware. Per-file awk shows both features are fully wired (auto-refresh in 3 workflows with full 3-option AskUserQuestion flow; god-node detection + cache + soft warning in code-review.md:104-115). R1 is a default tweak + new heuristic; R3 is a new gate on existing scaffolding. Both deferred to v0.70 with correct framing. No documentation retraction needed.
- **Q2.4 (70-file stale-state cluster)**: mis-characterized — 35 of 70 files are legitimate per-phase `impl-summary-*.{md,json}` lane artifacts from greenfield's 22-phase session. Not pollution; session sprawl. Pattern_allowed archival on workflow deactivation could trim this on long sessions but is downstream of the bypass fix (deferred to v0.70).
- **B6 (31-raw count pollution)**: stale finding — fixed in v0.69.4 scope correction. Current greenfield workflow shows `raw_dispatch_count: 1` (the audit-fix follow-up dispatch).

### North-star alignment

- **#1 coordination**: removes the demonstrated architectural escape hatch — there is now no way to deactivate a workflow that contains raw devt:* dispatches without either (a) re-dispatching cleanly via /devt:*, (b) explicitly opting out via `dispatch_hygiene_mode: "warn"`, or (c) accepting the block. The forcing function now fires at the right moment — when the orchestrator tries to close out a session with hygiene violations in it.
- **#3 code quality**: same write-side trigger discipline as v0.68.2's self-healing `workflow_id_history`. The gate doesn't trust callers to opt in; it enforces at the data-mutation point regardless of caller. The bypass-resistance is structural, not procedural.

## [0.69.4] - 2026-06-01

**Greenfield calibration #13 — S1 scope correction (workflow vs session).** Closes the false-positive failure mode greenfield calibration #13 surfaced 12 hours after v0.69.3 shipped: the `assert-no-raw-dispatches-this-session` gate was scoping by `workflow.yaml::first_created_at` (immutable session anchor — set on the first workflow of a session, never updated), so a clean current workflow blocked because 31 raw dispatches lived in `dispatch-warnings.jsonl` from 18 prior workflows across the same multi-day session. Greenfield direct evidence: `first_created_at: "2026-05-28T22:33:05Z"` (session start, 4 days ago) → 31 raw_dispatch matches; `created_at: "2026-06-01T21:01:05Z"` (current workflow start) → 0 matches. Each workflow gets its own hygiene budget; dispatches in prior workflows are not the current workflow's problem. Smoke: **769 → 769 passed**, **1 pre-existing failure** (opus-4-8-upgrade-report.md transient planning doc — unchanged from v0.69.2).

### Changed

- **`assertNoRawDispatchesThisSession` scope anchor switched from `first_created_at` to `created_at`** (`bin/modules/state.cjs`). The gate now counts raw dispatches occurring in the CURRENT WORKFLOW's window — exactly the window the orchestrator is finalizing. Before: a multi-day session that accumulated raw dispatches across many workflows would block every subsequent finalize regardless of that workflow's actual hygiene. After: each workflow is evaluated against its own dispatches only; prior-workflow dispatches stay attributable in the historical record but don't gate clean finalizes.
- **Smoke gate S1 fixture extended to test the new scope semantics** — fixture now sets BOTH `first_created_at` (session: 24h ago) AND `created_at` (workflow: 1h ago) in test workflow.yaml, AND includes a raw_dispatch entry between the two anchors that the gate MUST ignore. Confirms the gate uses workflow-scope, not session-scope.

### Captured for v0.70 (calibration #13 follow-throughs)

- **DEF-053 D19** — Sibling-test glob fallback before FTS in reuse-candidate search. Greenfield F#1: reuse search by stem (e.g. `ssrf_v2` → `ssrf_v2_test.go`) misses due to FTS keyword tokenization; add basename-glob first-pass, then FTS.
- **DEF-054 D20** — God-node noise suppression for leaf-change tasks. Greenfield F#2: surface god-node warnings only when impl-summary changes touch the god-node itself; otherwise demote to brief.json::nullable_warnings.
- **DEF-055 D21** — Skip tester when impl-summary contains only test files. Greenfield F#5: when programmer wrote only `*_test.*` files, tester re-runs the same tests. Add fast-skip in dev-workflow tester gate when impl-summary.files all match test patterns.

### Direct validation of greenfield's calibration #13 findings

- **Finding #4 (S1 gate scope bug)**: confirmed exactly via direct filesystem inspection of greenfield's `.devt/state/workflow.yaml` + `dispatch-warnings.jsonl`. Old scope counted 31 across 18 prior workflows; new scope counts 0 in current workflow window (which had only properly-enveloped dispatches via `/devt:review`). Fix shipped this release.
- **Finding #3 (hyperedges still dark)**: same root cause as v0.69.3 — greenfield's graphify skill 0.7.10 vs binary 0.8.24 mismatch. Greenfield-side fix: `graphify install`. Already tracked as DEF-052 D18.
- **Findings #1, #2, #5**: legitimate calibration signal but not regressions; captured as DEF-053/D19, DEF-054/D20, DEF-055/D21 for v0.70 scope.

### North-star alignment

- **#1 coordination**: removes the v0.69.3 over-correction (treating prior-workflow dispatches as current-workflow violations) that would have eroded trust in the dispatch-hygiene gate. The gate now matches the unit of orchestration (one workflow = one hygiene check).
- **#3 code quality**: validates the v0.68.2 self-healing `workflow_id_history[]` work — the session has a stable identity (`first_created_at`) AND each workflow has its own boundary (`created_at`); both are load-bearing and each gates the right thing.

## [0.69.3] - 2026-06-01

**Greenfield calibration #12 — post-hoc dispatch-hygiene enforcement (S1).** Closes the systemic gap calibration #12 surfaced: Claude Code's PreToolUse `decision:"deny"` is **not enforced for the Task tool**, so the `dispatch-hygiene-guard.sh` hook can detect raw devt:* dispatches and write `{decision:"deny"}` but the orchestrator proceeds anyway. Greenfield calibration #12 evidence: 4 hook invocations, 4 raw_dispatch entries written to dispatch-warnings.jsonl, 4 sub-agents ran without `<scope_trust>`/`<scope_hint>`/`<memory_signal>` envelope — fell back to grep-quality discovery. New post-hoc enforcement gate scans dispatch-warnings.jsonl at workflow finalize/present_findings time and BLOCKS if any in-session raw dispatches occurred. The orchestrator can rationalize past the pre-dispatch advisory but cannot reach finalize with raw dispatches in their session. Smoke: **769 → 770 passed**, **1 pre-existing failure** (opus-4-8-upgrade-report.md transient planning doc — unchanged from v0.69.2).

### Added

- **`state assert-no-raw-dispatches-this-session`** (`bin/modules/state.cjs::assertNoRawDispatchesThisSession`) — reads `.devt/state/dispatch-warnings.jsonl`, filters by `source:"raw_dispatch"` AND `ts >= workflow.yaml::first_created_at` (this session's window), returns `{ok:false, raw_dispatch_count, agents, mode, reason}` when any present. Respects `dispatch_hygiene_mode` config (mode=`block` BLOCKS, mode=`warn` returns `ok:true, warn:true` with count surfaced, mode=`off` returns `ok:true` silent). Same config knob the PreToolUse hook reads — opt-out is one-line.
- **Gate wired into 4 workflows** at the finalize/present_findings/report cluster: `code-review.md::present_findings`, `dev-workflow.md::finalize`, `quick-implement.md::finalize`, `debug.md::report`. Runs BEFORE the existing knowledge-candidates aggregation so dispatch-hygiene violations surface first. Blocked workflows set `phase=<phase> status=BLOCKED verdict=FAILED` with prescriptive remediation message (re-dispatch via /devt:review, or set mode=warn if intentional).
- **`docs/HOOKS.md::Dispatch-Hygiene Guard` section expanded** with "Known Claude Code limitation" callout documenting that PreToolUse Task-deny doesn't enforce, plus "Defense layer 1.5" explaining the post-hoc gate's role in the layered protection model.
- **Smoke gate S1** — live fixture: synthetic dispatch-warnings.jsonl with 2 in-session raw_dispatch + 1 pre-anchor + 1 non-raw entries triggers gate (`raw_dispatch_count: 2`); switching `dispatch_hygiene_mode` to `warn` flips ok:true with warn:true and count surfaced.

### Captured for v0.70 (calibration #12 follow-throughs)

- **DEF-049 D15** — Plan-file review variant or markdown-scope branch in code-review.md. Current workflow assumes source-code scope; orchestrator silently skips graphify substeps when reviewing markdown plans.
- **DEF-050 D16** — Per-phase artifact precondition gates. `state update phase=X` is permissive; add `state assert-phase-preconditions` so each phase verifies prior phase's required artifacts exist.
- **DEF-051 D17** — EXECUTE THE PLAN imperative refactor. Workflow's substep 6 buried in prose; replace with concrete one-liner + bash block.
- **DEF-052 D18** — Graphify skill-version mismatch advisory. Greenfield's `graphify 0.8.24` binary warns about `skill is from 0.7.10`; devt should surface this in `graphify.cjs::status()` so Option A's silent hyperedge gap becomes diagnosable.

### Direct validation of greenfield's calibration #12 findings

- **Finding #1 (Option A hyperedges silent)**: root cause is greenfield's graphify skill-vs-binary version mismatch (0.7.10 vs 0.8.24), not a devt bug. Greenfield-side fix: `graphify install`. Captured as DEF-052 D18 for devt-side advisory.
- **Finding #2 (arch-scan-report.md asymmetric registration)**: NOT a bug — ARTIFACT_SCHEMA is intentionally Status-only (validates `## Status:` line). arch-scan-report.md correctly belongs in PERSISTENT_ARTIFACTS only.
- **Finding #3 (doc-discipline gate failing)**: pre-existing planning doc `opus-4-8-upgrade-report.md` with version refs. Transient, will absorb into CHANGELOG when v0.70 ships.

### North-star alignment

- **#1 coordination**: closes the rationalize-past-the-warning failure mode that calibration #12 directly exposed; post-hoc enforcement is the only durable mitigation while CC platform Task-deny doesn't enforce.
- **#2 code quality**: greenfield's calibration #12 had agents running on grep-quality discovery (no graphify-anchored impact maps) because raw dispatches bypassed the workflow envelope; preventing this regression at finalize forces orchestrators back to the workflow path.

## [0.69.2] - 2026-06-01

**Doc-gap closure + deferred-queue housekeeping.** Three coordinated changes — arch-scan auto-discovery in `/devt:arch-health` (probe + AskUserQuestion when `arch_scanner.command` is unset and a conventional scanner exists at `.devt/rules/arch-scan.{py,sh}`), three additional env vars added to the HOOKS.md reference table, `dispatch_hygiene_mode` config key documented in README, plus 4 stale DEF items closed and 10 new D1-D10 items captured to the deferred queue for v0.69.2+v0.70 scope. Smoke: **769 passed, 0 failed** (after state contract widened for `arch-scan-report.md`).

### Added

- **`/devt:arch-health` convention probe** — when `arch_scanner.command` is unset, the workflow now probes `.devt/rules/arch-scan.py`, `.devt/rules/arch-scan.sh`, `tests/architecture/arch-scan.py`, `scripts/arch-scan.py` (in order) and AskUserQuestion offers three paths: auto-wire (writes a sensible default command to `.devt/config.json`), show-the-command (prints the `config set` invocation for external execution), or skip (continues with manual architect analysis). Mirrors the `graphify.probeBinary` capability-probe pattern. Field signal: greenfield-api ships a 681-line `arch-scan.py` at the convention path, but devt's workflow had no way to surface it without explicit config.
- **`arch-scan-report.md` added to STATE_FILE_CONTRACT** — recognizes the canonical scanner output path under `.devt/state/`. Pairs with the convention probe above so projects following the `.devt/rules/arch-scan.{py,sh}` convention write their report to a contract-recognized location without tripping the smoke-gate "non-contract state filename" check.
- **`docs/HOOKS.md` env-var table extended** — adds 4 previously-undocumented runtime knobs: `DEVT_VALIDATE_SHADOW` (shadow-mode state validation kill switch), `DEVT_VALIDATE_ENFORCE` (hard-fail mode for state mismatches), `DEVT_AUTO_INDEX_DEBOUNCE_SEC` (memory FTS5 rebuild debounce window), `DEVT_MCP_ALLOW_WRITES` (opt-in write surface on the memory MCP server). Closes a real discoverability gap — these vars existed only as inline comments in code/hooks before.
- **`README.md::Basic configuration` table now documents `dispatch_hygiene_mode`** — the previously-undocumented config key read by `hooks/dispatch-hygiene-guard.sh`. Default `warn`; `block` mode prevents raw-dispatched subagent Task() calls entirely.

### Changed

- **Deferred-queue housekeeping** — 4 stale items closed as superseded:
  - DEF-007 (v0.40 Path A bash exfil patterns) — SOAK criteria never met; bash-guard maturity in v0.65+ covered the concern
  - DEF-010 (token-report-regression CI promotion) — SOAK criteria never met
  - DEF-011 (Wave C3 expected_levels handshake) — superseded by v0.65 deterministic grader pre-verifier gate + v0.66 inlined rubric_content
  - DEF-016 (push v0.38.1 + v0.39.0) — long since shipped
- **10 new items captured (DEF-039 through DEF-048)** as v0.69.2 + v0.70 scope:
  - DEF-039 D1 — arch-scan auto-discovery (shipped this release)
  - DEF-040 D2 — dispatch_hygiene_mode docs (shipped this release)
  - DEF-041 D3 — env-var doc additions (shipped this release)
  - DEF-042 D4 — stale DEF triage (shipped this release)
  - DEF-043 D5 — Snapshot-diff drift detection (Option B, v0.70)
  - DEF-044 D6 — Rerank symbols by relevance-to-diff (v0.70)
  - DEF-045 D7 — H9 verifier-retry repair operator (v0.70)
  - DEF-046 D8 — INFERRED-edge verification queue (Option C, v0.70+)
  - DEF-047 D9 — Per-init marker for ad-hoc cleanup (v0.70)
  - DEF-048 D10 — Drill-down +1 hop retry for dynamic-dispatch nodes (v0.70)

### North-star alignment

- **#2 code quality**: arch-scan auto-discovery turns greenfield's existing 681-line scanner into a first-class devt capability without re-implementation; documented config + env vars close discoverability holes that cause user "WTF" debugging sessions.
- **#4 third-party integrations**: arch-scan probe pattern is a general-purpose plug-in convention for any project-supplied scanner that follows `.devt/rules/arch-scan.{py,sh}` placement.

## [0.69.1] - 2026-06-01

**Default model_profile changed from `quality` to `balanced` + Model profiles documentation.** Two coordinated changes: the hardcoded default tier shifts to `balanced` (protects token budget out of the box while keeping the 5 strategic agents — architect, verifier, debugger, code-reviewer, programmer — on opus), and the previously-undocumented model_profile system gets a full README section explaining the four profiles, their per-agent assignments, and the override mechanism. Smoke: **768 → 769 passed**, **0 failed** (+1 gate R1 locking the new default).

### Changed

- **Default `model_profile`: `quality` → `balanced`.** Affects (1) project-init scaffolding (`bin/modules/setup.cjs`) so new `.devt/config.json` files write `balanced`; (2) merged-config default (`bin/modules/config.cjs`) so existing projects without an explicit `model_profile` key now resolve to `balanced` instead of `quality`; (3) `models get` / `models resolve` / `models table` CLI defaults (`bin/modules/model-profiles.cjs`) so unspecified-profile invocations show balanced assignments; (4) docstring (`bin/modules/model-profiles.cjs:6`). Existing projects with explicit `"model_profile": "quality"` in their config are unaffected — the override mechanism takes precedence over the new default. **Impact:** ~50-60% token cost reduction vs `quality` for projects that never explicitly chose; 5 synthesis/exploration agents (tester, docs-writer, retro, curator, researcher) drop from opus to sonnet. The 5 strategic agents (architect, verifier, debugger, code-reviewer, programmer) remain opus. Projects that prefer `quality` should set it explicitly.

### Added

- **`README.md::Model profiles` section** — closes the documentation gap surfaced by user feedback: the four profiles (`quality` / `balanced` / `budget` / `inherit`) and their per-agent assignments were only discoverable via `model-profiles.cjs:5` docstring. New section includes (a) the full 10-agent × 4-profile assignment table, (b) one-sentence character summary per profile, (c) inspection + override CLI reference, (d) `model_overrides` schema with valid agent + alias keys.
- **CLAUDE.md `models` CLI block** — updated to surface `balanced` as the default + cross-reference the README section for the full assignment table.
- **Smoke gate R1** — live fixture asserts `config get model_profile` resolves to `balanced` AND `models get` returns balanced assignments (`programmer: opus, tester: sonnet`). Locks the default so future refactors of config/setup/model-profiles can't silently regress.

### Fixed

- N/A — pure default + docs release.

### North-star alignment

- **#3 token efficiency**: new projects no longer pay the `quality` premium by accident; the 50% reduction is automatic and reversible by one config line.
- **#2 code quality**: protects judgment-critical paths (5 strategic agents stay opus) while delegating execution/synthesis to sonnet — sensible tradeoff for routine work.

## [0.69.0] - 2026-05-30

**Greenfield calibration #11 closure + Option A hyperedge-aware preflight.** Seven items across three architectural categories: extractor consistency (H4-v2 closes a multi-channel filter leak; H4.1-v2 closes a silent heading-regex bypass), state cleanup completeness (H1-v3 extends cutoff to pattern_allowed bucket; H2-v3 backfills history from trace), workflow plumbing (L1-v2 orchestrator-side per-lane cache suppression for prose-only lanes; G4-v2 per-symbol provenance ledger), and the v0.69 marquee feature: Option A — hyperedge-aware preflight that lifts graphify's machine-discovered semantic groupings into the symbol channel, plus a /devt:ship completeness gate that warns when a PR touches some-but-not-all members of a hyperedge. Smoke: **761 → 768 passed**, **0 failed** (+7 gates Q1-Q7).

### Added

- **`graphify.getHyperedgesContaining(symbols, opts)`** — new sibling of `godNodes` / `laneSuggestions` / `symbolsInFiles`. Loads `graph.json::hyperedges[]` and returns those whose member nodes intersect any input symbol or source_file. Each result carries `{id, label, member_count, members, members_in_scope, completeness, confidence, confidence_score, source_file, relation}`. Sorted by completeness descending so reviewers see most-overlapping hyperedges first. Greenfield's 3 hyperedges (billing_country_fk_flow, vat_resolution_chain, audit_jurisdiction_snapshot) each bind multi-file scopes that should change together — partial coverage is the "you fixed code, forgot the readme/test/migration" signal.
- **`preflight-brief.json::hyperedges_matched[]`** — preflight.generate now probes hyperedges with topic.symbols and persists the matches in the sidecar. Downstream consumers (orchestrators, /devt:ship gate) read it without re-querying the graph.
- **`/devt:ship::hyperedge_completeness_scan` step** — when matched hyperedges have `completeness < 1.0`, AskUserQuestion surfaces the partial coverage with member counts and missing-member counts before opening the PR. Three outcomes: proceed (intentional partial), cancel (expand scope first), or skipped (no hyperedges matched / preflight absent). Capability-probe style — fails open when graphify is disabled.
- **`preflight-brief.json::topic.symbol_provenance{}`** — per-symbol source ledger (G4-v2). Each symbol mapped to its extraction channel: `"plan"`, `"diff"`, `"text"`, `"snake_fts"`, `"kebab_fts"`, or `"full_text_fts"`. Lets reviewers triage god-node noise faster — ignore aggregates when no anchor is diff-anchored or plan-anchored. Foundation for v0.70 ranking improvements.
- **`cleanupStateFiles({adHocCutoffMtime, patternAllowedCutoffMtime})` opts** — H1-v3 adds the second cutoff opt mirroring H1-v2's pattern. init.cjs passes the prior workflow's `created_at` for BOTH buckets so cross-PR-same-day residue clears uniformly. Greenfield calibration #11: 5 stale review-lane-*.md files from prior-day session that escaped the calendar-age `staleDays=1` gate.

### Fixed

- **`applySymbolFilter` extracted helper + applied to plan + diff + text channels** (H4-v2). The original H4 fix at v0.68.1 only applied `^Test[A-Z]` to textSymbols — planSymbols and diffSymbols channels still leaked pytest test classes. Greenfield calibration #11 evidence: `TestGetActivitySymmary`, `TestAddUserToOrganization` (etc.) appeared in topic.symbols positions 142-146 because they came from a plan file's `## Files to change` section that referenced test files. New helper applies `SYMBOL_DENYLIST + isAllCapsNoise + ^Test[A-Z]` consistently to all three channels.
- **`assert-graphify-decision` detects malformed drill-down headings** (H4.1-v2). The gate regex `/^##\s+Drill-down:/gim` literally requires exactly two pounds — `### Drill-down:` (three pounds) silently doesn't match. Greenfield calibration #11: writer used `###`, gate returned `drill_down_sections: 0` AND `ok: true`. Now: a second regex `/^#+\s+Drill-down:/gim` counts all depths; the delta surfaces as `malformed_drill_down_headings`. When > 0, `ok` becomes false with a prescriptive reason naming the canonical heading form (`## Drill-down: <SYMBOL> [call: <correlation_id>]`).
- **`workflow_id_history` backfills from `_mcp-trace.jsonl`** (H2-v3). H2-v2 (v0.68.2) self-heals when state.yaml carries orphan ids, but trace records from BEFORE the fix carry workflow_ids that never made it into history under pre-v0.68.2 rotation bugs. Greenfield calibration #11: 4 trace ids (8d2c91a1, 3a96bd9b, 9eeb1ae3, 7db622ee) not in history → mcp-stats `--workflow-id` reported 5-record gap vs `--since-workflow-created`. Fix: state.cjs::updateState's self-heal post-step now scans the trace's last 5000 lines for ids with `ts >= first_created_at` and splices them between original anchor and current. Idempotent. Greenfield live verification: 5-record gap → 0-record gap on first state update.
- **`/devt:ship` gains hyperedge_completeness_scan** — paired with Option A above; called out separately because it's a workflow contract change in addition to the new preflight signal.

### Changed

- **`code-review-parallel.md::dispatch_lanes` orchestrator-side prose-only filter** (L1-v2). When ALL files in a lane have prose extensions (`.md`, `.rst`, `.txt`, `.adoc`), the orchestrator replaces the `graph-impact.md` cache injection with a `<graphify_status>not_applicable</graphify_status>` stub. Greenfield calibration #11 L3 evidence: prose-only README review lane received the GLOBAL preflight cache (`effect_size: large, god_node_match: true` computed against the FULL PR scope including code files) — pure noise for a markdown-only review. Per-lane filtering happens at the orchestrator (respects CLAUDE.md's "lanes are MCP-blind by design" contract); lanes still never query graphify themselves.

### Smoke gates added

- **Q1** — applySymbolFilter blocks Test* from plan + diff + text channels.
- **Q2** — assert-graphify-decision rejects ### Drill-down: headings (malformed count + ok:false).
- **Q3** — patternAllowedCutoffMtime evicts stale review-lane, preserves fresh.
- **Q4** — workflow_id_history backfills orphan trace ids end-to-end.
- **Q5** — code-review-parallel.md documents prose-only lane cache suppression.
- **Q6** — extractTopic returns symbol_provenance map (plan + text sources tagged).
- **Q7** — Option A hyperedge plumbing complete (graphify fn + ship step + preflight wire).

### North-star alignment

- **#1 coordination**: hyperedge completeness propagates from graphify discovery → preflight sidecar → ship gate (Option A); orchestrator filters lane cache per-lane scope (L1-v2); state history backfills from trace so query layer matches state layer (H2-v3).
- **#2 code quality**: symbol filter applied uniformly across extraction channels (H4-v2); drill-down format violations surface as gate failures (H4.1-v2); per-symbol provenance lets reviewers triage god-node noise faster (G4-v2).
- **#3 token efficiency**: prose-only lanes skip graphify cache injection (L1-v2 — saves dispatch budget per lane); hyperedge signal redirects review attention to high-leverage missing changes rather than per-file noise (Option A).
- **#4 3rd-party integrations**: hyperedges are graphify's most sophisticated output and now drive a first-class devt feature, not a wrapper (Option A); state cleanup uses prior-workflow created_at uniformly across all classified buckets (H1-v3).

## [0.68.2] - 2026-05-30

**Greenfield calibration #10 hotfix bundle — three v0.68.1 follow-throughs.** Direct codebase validation against greenfield's running state confirmed two FAILs and one PARTIAL from the calibration #9 fixes that need v2 treatment. All three are surgical: idempotent self-healing for `workflow_id_history`, switching the graphify probe trace-check from a fixed minutes window to the session anchor, and switching the ad-hoc cleanup cutoff from calendar age to the prior workflow's `created_at`. Smoke: **758 → 761 passed**, **0 failed** (+3 gates P1-P3).

### Fixed

- **`workflow_id_history` self-healing on every state update** (H2-v2). The original H2 fix only seeded history when the array was absent — but greenfield's history was created by v0.68.0 as `[current_only]` (missing original), then accumulated rotations, never gaining the original_workflow_id. Worse: when init.cjs strips `workflow_id + created_at` and forces the first-activation branch, the NEW workflow_id wasn't appended to existing history either. Greenfield's evidence: history `[995823e0, 9fa91f3a, 5ab90124, 4e954a3d, 38c12b15]` was missing BOTH the original (`647d32e5`) AND the current (`a57aa9c2`). Fix moves history maintenance OUT of the conditional branches into an idempotent post-step that always ensures `{original, current} ⊆ history` — prepends original if missing, appends current if missing. Safe to run on every `updateState` call. Resolves the G6 PARTIAL (5-call gap between `mcp-stats --workflow-id` and `--since-workflow-created`) as a downstream consequence.
- **`memory validate` graphify probe uses session anchor by default** (H10-v2). The v0.68.1 H10 fix used a 5-minute window to check whether orchestrator MCP calls succeeded recently; greenfield's calibration #10 evidence showed the validate runs HOURS after the graphify burst (last call at 23:39, validate at 10:00 next day — 10h gap). No fixed minutes window works for bursty + quiet patterns. New default: read `workflow.yaml::first_created_at` and count successful graphify calls since session start. The semantic: "if THIS session ever successfully called graphify, the probe failure is anomalous and the warning is a false positive". `memory.graphify_probe_trace_window_minutes` config key still available for projects preferring a sliding window. Greenfield live check: validate now correctly downgrades to `info/graphify-probe-transient` ("16 graphify MCP calls succeeded since session start") instead of `warning/graphify-unreachable`.
- **`cleanupStateFiles` accepts `adHocCutoffMtime` for explicit cutoff** (H1-v2). The v0.68.1 `adHocStaleDays=1` calendar-age gate was too lenient for greenfield's multi-PR-per-day pattern — 16 ad-hoc files from yesterday's session survived because they were <24h old. New `adHocCutoffMtime` opt (ISO timestamp string) takes precedence when set; `init.cjs` reads `workflow.yaml::created_at` BEFORE the strip+restamp and passes it as the cutoff. Anything ad-hoc with mtime older than the PRIOR workflow's start gets archived. Falls back to `adHocStaleDays` when `created_at` unavailable. Catches the multi-PR-per-day residue without breaking current-session work-in-progress.

### Added

- **`memory.graphify_probe_trace_window_minutes` config key** — override the session-anchor default with a sliding window in minutes when project's call cadence prefers a strict time bound.
- **3 smoke gates P1-P3** locking each H-v2 fix to a live fixture (workflow_id_history idempotency, session-anchor trace count, adHocCutoffMtime semantics).

### Changed

- **`recentSuccessfulGraphifyTraceCount(arg)` signature widened.** Backward-compatible with the legacy `(minutes)` call form (including `0` for explicit empty window). New `({sinceSessionAnchor: true})` opts-object form uses `workflow.yaml::first_created_at` as cutoff. Default (no arg) is session-anchor with 24h fallback when no workflow.yaml exists.

### North-star alignment

- **#1 coordination**: history is now self-healing across upgrade boundaries (H2-v2); validate's verdict aligns with orchestrator's reality (H10-v2); init's ad-hoc sweep aligns with workflow-start semantics (H1-v2).
- **#2 code quality**: false-positive `graphify-unreachable` warnings stop appearing in healthy sessions (H10-v2); cross-PR ad-hoc residue clears (H1-v2).
- **#3 token efficiency**: validate's diagnostic prose is honest (info vs warning) — orchestrator stops allocating attention budget to false alarms (H10-v2).
- **#4 3rd-party integrations**: mcp-stats `--workflow-id` queries return correct counts after upgrade (H2-v2 + G6).

## [0.68.1] - 2026-05-29

**Greenfield calibration #9 hotfix bundle — stale-state cluster + extractor noise + diagnostic accuracy.** Field session against PR #376 surfaced seven bugs across three categories: stale prior-PR state contaminating fresh workflows (review.md/test-summary surviving init, lanes[] persisting across PRs, ad-hoc files accumulating with no eviction), extractor noise (pytest test classes leaking into symbols), and diagnostic accuracy (memory validate false-positive on healthy graphify, health --repair always reporting doc_count=0). All seven are surgical fixes — no architectural changes. Smoke: **751 → 758 passed**, **0 failed** (+7 gates O1-O7).

### Fixed

- **`init.cjs` wires `state cleanup --staleDays=1 --adHocStaleDays=1` after the existing evict-workflow-artifacts call** (H1). Greenfield's `.devt/state/` accumulated 30 stale files (council-*, simplify-*, validated-*, graphify-*-review.md, `.json` sidecars for slug variants) that the slug-variant regex couldn't catch. The audit classifier already buckets them as `ad_hoc`, and `cleanup` already knows how to archive them — the sweep just wasn't wired into init *. `adHocStaleDays=1` preserves recent ad-hoc files (likely current-session work-in-progress) while clearing accumulated cruft. Greenfield audit dry-run: 29/30 stale files caught with this single CLI invocation.
- **`workflow_id_history` seeds with `[original_workflow_id, workflow_id]` on first write when those ids differ** (H2). Upgrade-boundary recovery for sessions whose `first_created_at` predates v0.68 install. Greenfield's session: mcp-stats `--workflow-id=<current>` returned 4 trace records vs 9 via `--since-workflow-created` — the 5-record gap was the original_workflow_id chain that was dropped when v0.68 first wrote workflow_id_history with only `[current]`. Now the history captures the original anchor too, restoring full chain-union attribution.
- **`extractTopic` filters PascalCase pytest test classes matching `^Test[A-Z]`** (H4). Greenfield's PR #376 symbol set included 5 test class names (TestGetActivitySummary, TestAddUserToOrganization, etc.) consuming candidate slots that real symbols (OrganizationIntegrationRepositoryInterface, etc.) lost to the 32-symbol cap. Filter pattern is strict — `TestableBase`, `TestingFixture`, and other legit identifiers starting with `Test` followed by lowercase are preserved. Greenfield codebase confirmed zero non-test production classes match `^Test[A-Z]`.
- **`init *` strips `lanes:` block from workflow.yaml so each init starts with empty lanes** (H7). Lanes are workflow-scoped to code_review_parallel — they describe THIS PR's partition, not a persistent registry. Greenfield's PR #376 `init review` ran on top of workflow.yaml that still carried PR #374's 5 lanes (all with `file_exists: false` because the underlying review files had been evicted). Any consumer reading `list-lane-outputs` would falsely see pending work. The regex strip targets both the bare `lanes:` marker and the nested `lanes:\n  - id: ...` continuation block.
- **`evictWorkflowArtifacts` evicts workflow-scoped canonicals (review.{md,json}, test-summary.{md,json}, impl-summary.{md,json}, verification.{md,json}, debug-summary.md) when mtime predates `first_created_at`** (H11). Greenfield's verifier first-pass-failed because it graded against PR #374's stale `review.md` (~7.5 hours old, still INSIDE the freshness window first_created_at would have permitted). The G1 regex sweep deliberately excluded canonicals because the legacy comment said "task outputs follow-up workflows may consume" — but greenfield confirmed all 5 of these canonicals are single-PR with no cross-PR use case. New `WORKFLOW_SCOPED_CANONICAL` set in state-audit.cjs lists the exact filenames; mtime gate against first_created_at preserves current-session writes.
- **`memory validate` graphify probe defers to recent successful MCP traces before warning** (H10). Greenfield: 95 successful graphify MCP calls in the last hour AND zero errors per mcp-stats, yet `memory validate` still emitted "Graphify queries failed 3× consecutively despite graphify.status()=ready". The validator's `graphify.queryGraph` probe is a separate code path from the orchestrator's MCP transport — its independent timeouts produced the false-positive. New helper `recentSuccessfulGraphifyTraceCount(minutes)` reads `_mcp-trace.jsonl` for ok=true graphify records; when ≥1 exists, downgrade severity to `info` with category `graphify-probe-transient` and a message clarifying the probe path is independent. When zero recent successes exist, the legacy `warning` + `graphify-unreachable` path stays (genuine outage).
- **`health --repair MEM_INDEX_STALE` reads `result.inserted` not the broken `indexed_count || doc_count` fallback chain** (H12). `rebuildIndex()` only ever returned `inserted: N` — neither `indexed_count` nor `doc_count` were ever populated, so every successful rebuild reported `doc_count=0`. Greenfield's evidence: filesystem has 7 memory docs, sqlite has 7 documents_fts rows post-rebuild, but health output claimed `doc_count=0`. Fix puts `result.inserted` first in the fallback chain; legacy keys stay as defensive fallbacks for forward-compat.

### Added

- **`cleanupStateFiles` accepts `adHocStaleDays` option** to gate ad_hoc archiving by mtime (default behavior unchanged for manual `state cleanup` — sweeps all ad_hoc; init.cjs's auto-sweep opts into `adHocStaleDays=1` for current-session preservation).
- **`memory.recentSuccessfulGraphifyTraceCount(minutes)`** helper, exported for testing + reuse. Counts ok=true graphify trace records in a sliding window.
- **7 smoke gates O1-O7** locking each H fix to a live fixture (no static-only greps).

### Skipped from this release

- **H3** (assert-preflight-fresh negative `age_seconds` cosmetic) — dropped. No consumer reads the field numerically; only `.ok` matters.
- **H5** (short ≤3-char acronyms like VAT leak as symbols) — deferred to v0.69. Greenfield has SMS (3-char) as a legit symbol; needs graphify-aware filtering rather than blanket threshold lowering. H4 fix already reduces noise enough to push VAT out of the 32-symbol cap on greenfield's PR.
- **H6** (topic.confidence vs extraction_confidence) — dropped. Field IS present under correct name `extraction_confidence`; greenfield's evidence was reading wrong key.
- **H8** (stale-session UX warning when first_created_at > N hours) — dropped. With H7+H11 closing the actual contamination paths, a 12-hour stale-session warning would fire constantly for long-running session users and add noise without value.
- **H9** (verify_iteration bypassable via SendMessage) — deferred. Real workflow gap (no verifier-retry repair operator); needs architectural decision, not surgical fix.
- **B1 follow-up doc note** — dropped after direct investigation: B1 (graphify-mcp correlation_id) IS shipping correctly in greenfield's running session. Trace records carry cids; greenfield's earlier `grep -c → 0` was a query error (4 hits exist on direct check).

### Smoke gates added

- **O1** — init.cjs cleanup sweeps stale ad_hoc, preserves fresh ad_hoc.
- **O2** — workflow_id_history upgrade-boundary seed `[original, current]`.
- **O3** — `^Test[A-Z]` filter drops pytest classes, preserves TestableBase/TestingFixture.
- **O4** — init review strips `lanes:` block.
- **O5** — workflow-scoped canonical eviction (stale evicted, fresh preserved).
- **O6** — recentSuccessfulGraphifyTraceCount window arithmetic.
- **O7** — health --repair reads `result.inserted`.

### North-star alignment

- **#1 coordination**: lanes refresh per init review (H7); workflow-scoped canonicals refresh per init (H11); upgrade-boundary chain captured (H2).
- **#2 code quality**: pytest noise dropped from blast_radius args (H4); ad-hoc accumulation no longer contaminates fresh state (H1).
- **#3 token efficiency**: cleaner symbol set = fewer wasted blast_radius queries; validator no longer cries wolf so consumers stop allocating mental budget to false positives (H10).
- **#4 3rd-party integrations**: validator distinguishes "probe path broken" from "graphify down" (H10); health report accurately reflects rebuild outcome (H12).

## [0.68.0] - 2026-05-29

**Greenfield calibration #8 closure — semantic quality observability + plan-aware preflight + 4 confirmed bugfixes.** Three sequential calibration rounds against greenfield-api converged on the same architectural gap: devt's *structural* staleness was fully observable (anchors, isArtifactFresh, decision artifacts), but its *semantic* extraction quality was invisible — an orchestrator could read `scope_hint: ["Users", "VAT"]` for a billing_country task without knowing the symbols were path-leak noise. This release closes that gap: extractTopic strips absolute paths before tokenization (B3), text-leg stand-ins demote when FTS rescue promotes anything (B4), referenced `~/.claude/plans/*.md` are auto-loaded and their `## Files to change` / `## Scope` / `## Symbols` sections feed the symbol channel (G3), and `preflight-brief.json` now carries an `extraction_confidence` numeric score consumed by a new WARN-mode gate (G4). Plus three confirmed regression-class bugfixes from the calibration evidence: graphify-mcp `correlation_id` (B1, was half-shipped vs memory-mcp), pre-flight-guard `source` field (B2), multi-hop `workflow_id_history[]` for the HF-2 union (G6). Smoke: **741 → 751 passed**, **0 failed** (+10 gates N1-N10 lock the calibration #8 contracts).

### Added

- **`workflow_id_history[]` in `workflow.yaml`** + **`mcp-stats --workflow-id` whole-chain union** (G6). HF-2 (v0.66.0) unioned current ↔ original_workflow_id — a 1-hop horizon that silently missed trace records written during intermediate workflow_type rotations. Greenfield's session: 5 entries via `--since-workflow-created`, 0 via `--workflow-id=<current>` despite the chain having passed through multiple intermediate ids. `state.cjs::updateState` now appends every rotation to a `workflow_id_history[]` array (JSON-serialized via the NEW-3 path; persists via existing serializer/parser). `mcp-stats.cjs` reads the chain and unions when the supplied id matches current; historical-id queries stay strict so explicit lookups remain deterministic.
- **`state assert-preflight-semantic-quality`** WARN-mode gate (G4) — reads `preflight-brief.json::topic.extraction_confidence`, flags `warn: true` when score < threshold (default 0.4, override via `--threshold=0.6`). Returns `ok: true` always — semantic quality is signal, not safety, so the gate informs without blocking. Diagnostic prose follows the v0.63 best-in-class pattern (names the band, names the cause, prescribes the recovery: refine task text with the central subject and re-run /devt:preflight).
- **`topic.extraction_confidence`** + **`scope_hint.confidence`** in `preflight-brief.json` sidecar (G4). Confidence is computed deterministically from `topic.symbols` + `topic.resolution_path` (`{score, band, reason}`): 1.0 for `diff` or `plan` (grounded), 0.8 for FTS rescue legs, 0.6 for text-leg with any token >6 chars, 0.3 for text-leg-only with all symbols ≤6 chars. +0.2 overlap bonus when CamelCase-split symbol tokens appear in keywords. `scope_hint.confidence` is a placeholder pending v0.69 R3 calibration (returns 1.0 when suggested_reading non-empty, 0.0 when empty).
- **Plan-aware preflight** (G3) — `preflight.cjs::extractPlanReferences` + `extractSymbolsFromPlan` auto-load `~/.claude/plans/*.md` paths found in task text (regex covers `~/`, `$HOME/`, `/Users/<u>/`, `/home/<u>/`), parse `## Files to change` / `## Files affected` / `## Scope` / `## Symbols` sections, lift PascalCase + snake_case symbols (denylist-filtered) and code-extension file paths into the extractor's symbol channel. New resolution_path value `plan` ranks alongside `diff` (rank 1, grounded). Field validation against greenfield's billing_country task: symbols went from `["VAT","Users"]` (degenerate text-leg, 60% noise) to 12 grounded identifiers including `Organization`, `Invoice`, plus 8 real file paths from the plan body. Scope intentionally narrow to `~/.claude/plans/*.md` — project-local `docs/plans/*.md` deferred to a follow-up if anyone asks.
- **`correlation_id`** + **`_meta.correlation_id`** in `devt-graphify-mcp.cjs` tool dispatches (B1). v0.63 CHANGELOG claimed cid was wired into "trace records AND MCP response envelope" but only `devt-memory-mcp.cjs` adopted the pattern; graphify's `appendTrace` calls (which carry 95%+ of greenfield's MCP traffic — get_neighbors, query_graph, blast_radius) emitted records without cids. `mcp-stats --correlation-id=<id>` was correspondingly unfindable in real use. Ports the canonical pattern from memory-mcp (crypto.randomBytes(4).toString("hex") at callTool entry, propagated to TOOL_NOT_FOUND path + success path + _meta envelope).
- **`stale: true`** flag in `state list-lane-outputs` (G5) — when a lane's `review_file` exists and its mtime predates `workflow.yaml::first_created_at`, the field surfaces the staleness so consumers can filter. Absent files (`file_exists: false`) stay `stale: false` because absence is its own signal — no mtime to classify. Lane metadata leftover from prior workflows no longer falsely satisfies code-review-parallel's substance_check_lanes step.

### Changed

- **`pre-flight-guard.sh` deny records carry `source: "preflight"`** (B2) — both the helper-path (`logger.cjs::appendJsonl`) and the fallback-path (direct `fs.appendFileSync` used when CLAUDE_PLUGIN_ROOT isn't set) write the discriminator. Aligns with the `source` enum already documented in `docs/HOOKS.md::Pre-Flight Guard` (`preflight` / `bash_destroy` / `no_verify` / `graph_loader`). `bash-guard.cjs` already wrote its source values; this closes the producer gap so `preflight-denies.jsonl` consumers can triage by source. Greenfield's 359 deny entries were all `source: MISSING` despite the v0.62.2 path-scoping fix landing cleanly.
- **`extractTopic` strips absolute paths from the tokenization view** (B3) — `https?://...`, `~/...`, and `(?:[\w.-]+/)+[\w.-]+`-shaped paths get replaced with whitespace before the PascalCase symbol regex and the lowercase word stream run. The `raw` field still carries the original text for downstream prose. Greenfield's `/Users/emrec/.claude/plans/...` task text leaked `Users`, `emrec`, `claude`, `plans`, `hashed-sparking-cosmos` into keywords and surfaced `Users` as a symbol; all gone post-strip while `billing_country` survives intact in keywords.
- **`extractTopic` demotes ≤6-char text-leg symbols when FTS rescue promotes anything** (B4) — when `resolution_path` ends at `snake_fts` / `kebab_fts` / `full_text_fts` AND text-leg contributed short symbols (≤6 chars, the same threshold that gates FTS rescue), those text-leg stand-ins are removed from the final symbol list. Diff-derived symbols and longer text symbols are preserved. Net effect: FTS wins over text-leg when FTS fires, so downstream blast_radius args carry the graph-validated identifier rather than the acronym that triggered the rescue.
- **`state aggregate-knowledge-candidates` scans `impl-summary*.md`** alongside `review-lane-*.md` + `review.md` (G2). Programmers writing `#KNOWLEDGE-CANDIDATE:` tags in impl-summary were otherwise stranded — greenfield's quick_implement session produced 3 well-formed tags that never reached scratchpad.md because the aggregator's filter regex didn't include the impl-summary surface. Auto-call wired into `quick-implement.md::finalize`, `dev-workflow.md::finalize`, `code-review.md::present_findings`, `debug.md::report` — all four call the aggregator BEFORE `assert-knowledge-candidates-tagged` so tags reach scratchpad in time for the gate. Aggregator is idempotent + cheap (no harm calling on workflows that don't write impl-summary).
- **`state evict-workflow-artifacts` widens its slug-variant sweep** (G1) — `state-audit.cjs::evictWorkflowArtifacts` previously only swept `review-lane-*.{md,json}` via regex, missing accumulated `review-pr*-slice-*.md`, `review-architecture.md`, `impl-summary-c5.md`, `impl-summary-w1.md`, `review-slice-A.md`, etc. New sweep reuses the same `ALLOWED_PATTERNS` set the audit subcommand already classifies on (`review-*.md`, `review-lane-*.{md,json}`, `impl-summary-*.{md,json}`, `test-summary-*.{md,json}`, `verification-*.{md,json}`, `slice-*.md`). Mtime gate against `workflow.yaml::first_created_at` protects current-session writes — only files older than the session anchor are evicted. Canonical task outputs (`review.md`, `impl-summary.md`, `test-summary.md`, etc., no slug suffix) don't match the regexes by design. Greenfield's `.devt/state/` had 167 stale files of 201; with this fix, init * keeps fresh state plus current-session writes and clears the rest.

### Fixed

- **`assertPreflightSemanticQuality` works against missing/legacy preflight-brief.json** — returns `ok: true, warn: false` with prescriptive reason when the brief is absent or predates the `extraction_confidence` field. Doesn't trip on the upgrade boundary.
- **G3 plan-section parser uses split-on-heading instead of `\Z` lookahead** — initial implementation used `(?=^##\s|\Z)` to bound section captures, but JavaScript regex has no `\Z`; the literal `Z` truncated sections at the first occurrence (e.g. `Organization` became `Organi`). Rewrote as `body.split(/^##\s+/m)` + per-section title test — bounded correctly, last section captured.

### Smoke gates added

- **N1** — devt-graphify-mcp.cjs emits correlation_id in trace + _meta envelope.
- **N2** — pre-flight-guard.sh writes source field in both deny paths (helper + fallback).
- **N3** — extractTopic strips path tokens (greenfield's exact task as fixture).
- **N4** — text-leg short stand-ins demote when FTS rescue fires.
- **N5** — evict-workflow-artifacts sweeps stale slug variants, preserves fresh + canonical.
- **N6** — aggregate-knowledge-candidates scans impl-summary*.md.
- **N7** — list-lane-outputs flags stale review_files (mtime < first_created_at).
- **N8** — workflow_id_history multi-hop chain union end-to-end (3-hop fixture).
- **N9** — assert-preflight-semantic-quality WARN/PASS behavior on low/high confidence.
- **N10** — extractSymbolsFromPlan parses `## Files to change` / `## Scope` sections.

### North-star alignment

- **#1 coordination**: plan-referenced symbols flow through extractor → confidence score → sidecar → gate → orchestrator awareness in one chain (G3+G4); knowledge-candidate aggregation now reaches all four gate sites (G2); workflow_id chain captured end-to-end (G6).
- **#2 code quality**: extractor produces grounded symbols on plan-driven tasks (B3+G3); FTS results win over noisy text-leg stand-ins (B4); stale lane metadata no longer silently satisfies parallel-review consumers (G5).
- **#3 token efficiency**: scope_hint no longer poisons subagent prompts with path-leak noise (B3); aggregator pre-call costs <5K tokens for a benefit measured in avoided false-block re-dispatches (G2).
- **#4 3rd-party integrations**: graphify MCP calls carry cid (B1); preflight-denies producers agree on the source discriminator (B2); plan files become first-class signal alongside graphify + claude-mem (G3).

## [0.67.0] - 2026-05-29

**Option H+ — Compile-time dispatch templates + cookbook-aligned hardening + graphify v0.8.x integration.** Eliminates duplicated per-agent dispatch envelopes across 5 workflows via marker-region compile-time generation from `agents/io-contracts.yaml` + `templates/dispatch/`. Closes the "Smoke test (future)" TODO at `agents/io-contracts.yaml:29`. Adds PTC-style consolidation of the SCOPE_HINT/TRUST/staleness bash chain into one CLI verb. Tightens verifier + code-review rubrics with anti-shortcut clauses (cookbook outcome-grader pattern). Wires `graphify prs --conflicts` into `/devt:ship` as a capability-gated pre-PR merge-risk scan. Net workflow LoC reduction: ~370 lines despite added documentation. Smoke: **738 → 741 passed**, **0 failed**.

### Added

- **`dispatch` CLI surface** (`list`, `contracts`, `render`, `compile [--check|--write]`) — compile-time generation of per-agent dispatch envelopes from `agents/io-contracts.yaml` + `templates/dispatch/envelopes/`. Templates are the single source of truth; workflow marker regions are rendered, byte-stable, and CI-gated. `compile --check` (in `scripts/smoke-test.sh`) closes the "Smoke test (future)" TODO at `agents/io-contracts.yaml:29`. `compile --write` is the manual pre-release regeneration step. Per-workflow-id variants supported via `<agent>-<workflow_id>.tmpl.md` fallback (e.g. `architect-dev-arch-health.tmpl.md`, `architect-dev-arch-review.tmpl.md` for the two architect dispatches in dev-workflow).
- **`preflight scope-cache` CLI verb** — single Node call replaces the prior 4-jq + conditional staleness-override + 2 CLI-call bash chain in three workflows. Reads `preflight-brief.json`, computes scope_hint + scope_trust, applies mechanical staleness override (forces `trust=sparse` + writes `staleness-suppressed.txt` when graphify `state=ready` AND lag exceeds `graphify.stale_threshold` or is null), persists both JSON blobs to `workflow.yaml`. Returns `{ok, scope_hint, scope_trust, suppress_reason, threshold}`.
- **`## Tier Routing Manifest` in `workflows/dev-workflow.md`** — single-glance view of which steps fire for each complexity tier (TRIVIAL/SIMPLE/STANDARD/COMPLEX). Per-step `(STANDARD + COMPLEX)` annotations downstream remain operational (defense-in-depth) — the manifest is the documentation surface, the inline gates remain the live behavior.
- **Anti-shortcut clauses in pinned verifier rubrics** (`references/rubrics/code_review.v1.md` + `references/rubrics/dev.v1.md`). Implements the cookbook outcome-grader "anticipate shortcuts" pattern. The verifier MUST reject grep-only confirmations, "I remember it passed", line-number citations without re-Reading, passing on diff size, and similar cheap-but-wrong verification paths. Gap field prefixed with `[shortcut]:` so the next writer pass recognizes the rejection class.
- **`/devt:ship` merge-risk scan step** — capability-gated `graphify prs --conflicts` invocation between preflight and changelog. When graphifyy ≥ 0.8.x is installed AND `graphify-out/graph.json` exists, scans open PRs targeting the same base branch for graph-community overlap with the current branch's scope. Surfaces conflicts via AskUserQuestion so merge order can be coordinated BEFORE the PR opens. Silent skip on older graphify versions, missing graph, or undetectable base branch — zero cost when not applicable. Base-branch detection order: `.devt/config.json::git.base_branch` → `origin/HEAD` → `main`.
- **README upgrade note** for graphifyy ≥ 0.8.x with explicit `uv tool upgrade graphifyy` command. Newer graphify subcommands (`prs --conflicts`, `affected`) and v8 MCP tools (`list_prs`, `get_pr_impact`, `triage_prs`) only ship in the 0.8 line; devt capability-probes at runtime so users on older versions see no errors, but they won't get the new features until they upgrade.

### Changed

- **All 19 `Task()` dispatch envelopes across 5 workflows** (`dev-workflow`, `quick-implement`, `code-review`, `research-task`, `debug`) — now live in `<!-- BEGIN dispatch:<agent>:<workflow_id> -->` … `<!-- END dispatch:<agent>:<workflow_id> -->` marker regions rendered from `templates/dispatch/envelopes/*.tmpl.md`. Behavior unchanged; structure deduplicated.
- **`SCOPE_HINT` / `SCOPE_TRUST` chain in dev-workflow, code-review, quick-implement** — replaced by a single `node bin/devt-tools.cjs preflight scope-cache` call. ~25 lines of bash per workflow → 1 CLI invocation. Smoke gates updated to accept either pattern (legacy bash OR new CLI verb) — they now test presence-of-mechanism, not implementation shape.

### Removed

- **62 `<!-- KEEP IN SYNC -->` comment blocks** stripped from templates (then propagated to rendered marker regions across 14 workflow sites). Templates are now the single source of truth for dispatch envelope content; cross-file sync directives became obsolete. Remaining 15 KEEP IN SYNC comments live OUTSIDE marker regions (operational bash sync hints, prose footers) and are intentionally preserved.

### Fixed

- **`dispatch compile --write` multi-region rewrite bug.** First-pass implementation read marker-region line numbers once at the top, then rewrote regions in iteration order. The first rewrite in a file invalidated subsequent regions' begin_line/end_line. Now processes regions per-file in reverse `begin_line` order, applies rewrites to an in-memory copy, writes once at the end via `atomicWriteFileSync`. Resolves silent breakage when a single edit propagated to multiple marker regions in the same workflow file.

### Skipped (mid-flight scope revisions)

- **Layer 2 (collapse `code-review-parallel.md` fork)** — validation revealed it is a sanctioned exception per `docs/AGENT-CONTRACTS.md:50` with bespoke lane-partition + synthesis logic, not a deprecated fork. The dispatch envelope duplication was already absorbed by Layer 1's per-workflow-id templates. Two-workflow architecture stays.
- **Layer 4 (context_management tool clearing)** — the cookbook's `clear_tool_uses_20250919` is an Anthropic Messages API parameter; the Claude Code `Task` tool does not expose `context_management` on subagent dispatches. Deferred until harness support.
- **Layer 5 `graphify drill-down` half** — would lose the MCP `_meta.correlation_id` audit trail that workflows actively cite via `mcp-stats --correlation-id`. Preserved as a follow-up; `preflight scope-cache` shipped instead.

## [0.66.0] - 2026-05-29

**Greenfield calibration #7 follow-through + Q4/Q5 + DEF-038 bundle.** Closes seven multi-agent coordination items surfaced or queued during calibration #7 and the v0.65.0 soak. Reviewer ↔ verifier alignment via inlined rubric, ambiguous_bindings carried end-to-end with `source_file`, probe failures observable, session-scoped knowledge-candidate gate, concurrent-graphify safety via O_CREAT|O_EXCL lock, plus a doc close-out for the MCP-trace external-server gap. Smoke: **730 → 738 passed**, **0 failed**.

### Added

- **`graphify rebuild` CLI with `--debounce=N` + atomic lock** (DEF-038). Two workflows firing rebuild within the same second would race the subprocess against `graph.json`. New subcommand acquires a lock at `.devt/state/.graphify-rebuild.lock` via `openSync(path, "wx")` (O_CREAT|O_EXCL); contention within the debounce window returns `action=skip reason=debounced`; mtime past the window assumes a crashed prior holder and breaks the lock. Default debounce 30s; override via `--debounce=N` or `config.graphify.rebuild_debounce_seconds`. Lock file is RESET_EXEMPT so a crashed prior workflow doesn't deadlock a fresh one.
- **`code-reviewer` dispatch receives inlined `<rubric_content>`** (C7-7). Verifier already received the rubric; reviewer self-checked against agent-body conventions only, so axis drift produced extra revision loops. Now both work from the same six axes (A scope coverage, B finding specificity, C severity calibration, D remediation concreteness, E ADR Compliance, G Reuse Discipline). Wired into single-dispatch + parallel per-lane + parallel consolidator + agent body. Saves ~5K tokens per avoided verifier-revision round-trip.
- **Probe failure diagnostic logging** (Q4). `graphify.probeBinary` + `setup.probePythonGraphifyMcp` previously caught and returned false silently — users seeing "graphify not detected" couldn't distinguish "not installed" from "installed but timeout/permission/segfault". Both probes now append structured records to `.devt/state/probe-failures.jsonl` (categories: `spawn-error` / `timeout` / `nonzero-exit` / `not-installed`). `health` surfaces `PROBE_FAILURES_RECENT` info-check when activity is logged within the last 24h. RESET_EXEMPT so root-cause survives `/devt:cancel-workflow`.
- **`ambiguous_bindings` carries `source_file` end-to-end** (C7-3 + C7-6). `blastRadius` already returned `ambiguous_details` internally but only the count was persisted/surfaced. Calibration #4 + #7 documented unflagged `ExternalCallService` collisions causing manual cross-checks per finding. Now: `blastRadius` entries include `source_file`; preflight sidecar persists `ambiguous_details[]`; code-review F17 substep emits `## Ambiguous bindings (C7-3)` section in `graph-impact.md`; code-reviewer body parses the new field and requires every finding referencing a colliding symbol to cite `source_file` explicitly.

### Changed

- **`assertKnowledgeCandidatesTagged` is session-scoped via `first_created_at`** (Q5). The scratchpad branch counted `#KNOWLEDGE-CANDIDATE:` lines without freshness — tags from a prior workflow (e.g., scratchpad survived `/devt:cancel-workflow`) silently passed the gate and the auto-curator harvested them into this session's promotion queue. Now both gate branches use `isArtifactFresh()` (which prefers the immutable session anchor per v0.65.0 HF-1).

### Documentation

- **MCP-trace external-server gap documented as won't-fix** (C7-5). `_mcp-trace.jsonl` only captures tool calls routed through devt's OWN MCP server; calls to upstream third-party servers (graphify, claude-mem, context7) bypass devt's instrumentation point. Fix would require Claude Code harness instrumentation or a wrapping MCP proxy. Decision: `mcp-stats` output should be read as "tool calls through devt's MCP server" rather than "all MCP calls in this workflow". Added paragraph to `docs/INTERNALS.md::MCP Tool Reachability`.

### Smoke gates added

- **M14** — `ambiguous_bindings` consumer wiring (graphify produces `source_file`; preflight persists the array; workflow emits the section; agent body parses the field).
- **M15** — `code_review` rubric inlined into code-reviewer dispatch (single + parallel per-lane + consolidator + agent body).
- **M16** — probe failure logging wired end-to-end (graphify + setup log; RESET_EXEMPT + STATE_FILE_CONTRACT entries; health check; live probe of a missing binary).
- **M17** — knowledge-candidates gate session-scoped (live probe: scratchpad with backdated mtime fails; touch-fresh passes).
- **M18** — `graphify rebuild --debounce` E2E (fresh lock seeded returns `debounced`; stale 3-min-old lock is broken; both paths leave directory clean).

### North-star alignment

- **#1 coordination**: ambiguous_bindings flows producer → persistence → consumer → reviewer in one chain (C7-3+C7-6); reviewer + verifier work from the same rubric (C7-7); immutable session anchor applied uniformly across gates (Q5); two workflows can't race graphify update (DEF-038).
- **#2 code quality**: axes walked in first pass not after a revision loop (C7-7); actionable probe diagnostics replace silent false (Q4); harvester no longer sees prior-session leak (Q5).
- **#3 token efficiency**: ~5K tokens saved per avoided verifier-revision round-trip (C7-7).
- **#4 3rd-party integrations**: surfaces existing graphify signal rather than re-deriving (C7-3+C7-6); surfaces clear feedback when graphify/python probes fail (Q4); delegates to graphify binary via clean serialization rather than reimplementing (DEF-038).

## [0.65.0] - 2026-05-29

**Calibration #6 + #7 bug fixes + cross-agent graphify coverage.** Greenfield's calibration #6 surfaced two silent-failure bugs (`health --repair` no-op for MEM_INDEX_STALE, FTS5 index stale on active sessions) plus four coverage gaps. Calibration #7 then surfaced THREE half-applied fixes from v0.64.0's NEW-1 work — gate consumers + mcp-stats filter + preflight write-path that wasn't fully migrated. All bundled into v0.65.0 before push. Smoke: **720 → 730 passed**, **0 failed**.

### Fixed (v0.64.0 half-applied corrections — found in calibration #7)

- **`assertPreflightFresh` + `assertGraphifyDecision` honor `first_created_at` + `original_workflow_id`** (HF-1). v0.64.0's NEW-1 fix migrated `isArtifactFresh` + mcp-stats to immutable anchors, but two gate-specific implementations had their own freshness logic that still read mutable `created_at` / `workflow_id`. Greenfield's calibration #7: `state update workflow_type=code_review_parallel` rotated created_at, retroactively invalidating both gates even though the orchestrator had run preflight + executed 3 real `get_neighbors` MCP calls correctly. Fix: both gates' YAML regexes now prefer immutable anchors with backward-compat fallback; the graphify decision gate unions current + original workflow_ids into a Set when scanning trace records.
- **`mcp-stats --workflow-id` unions with `original_workflow_id` for current session** (HF-2). v0.64.0's `--since-workflow-created` correctly used immutable anchor, but the ID-based filter stayed strict against current-rotated id. Greenfield: 5 entries via time filter, 0 via id filter despite 4 real MCP calls. Fix: when supplied workflow_id matches current workflow.yaml, union with original_workflow_id; historical queries stay strict.
- **`preflight generate` persists `blast.god_node_match` + `blast.ambiguous_bindings`** (HF-3). v0.64.0's C-I.1 god_node_warnings block read `.blast.god_node_match` from the persisted sidecar, but preflight's `atomicWriteJsonSync` only wrote `{effect_size, source, direct_dependents_count}` — both fields were emitted in the function return but stripped on persist. Substep-3 jq fell back to `// false`, cached state contradicted preflight's stdout. Code-reviewer keys severity-elevation on the boolean → every code-review dispatch since v0.64.0 silently under-elevated god-node findings. Fix: persist both fields explicitly; return/persist now byte-equivalent.

### Fixed (calibration #6 batch)

### Fixed

- **`memory suggest` now rebuilds the FTS5 index immediately after writing `_suggestions.md`** (V65-1). The auto-index PostToolUse hook can miss the atomic rename-after-tmp-write pattern used by `writeSuggestionsReport`, leaving index.db drifted 1h+ behind active sessions. Fix: invoke `rebuildIndex` from the CLI path itself; failures surface in a new `index_refresh` field of the suggest response.
- **`health --repair` handler wired for MEM_INDEX_STALE** (V65-7). The issue catalogue declared MEM_INDEX_STALE as `repairable: true` with prescriptive fix text, but the `attemptRepair` switch had NO matching case — `health --repair` returned `repairs: []` despite `repairable: true`. Users clicked "Yes — auto-repair", devt reported success, nothing actually got fixed. Now wired with the same `rebuildIndex` call referenced in the prose.
- **`memory validate` defers to `graphify.status()` before probing** (V65-2). The legacy path ran 3 probe queries and reported GRAPHIFY_UNREACHABLE warning if any subset failed — even when the orchestrator's impact-plan path had successfully called graphify seconds earlier in the same session. Two consumers, two retry budgets, divergent verdicts. Now: when status reports not-ready, return a single structured info-level note (category: graphify-not-ready) instead of the alarming warning. Persistent-failure path's message frames the discrepancy as a transient outage worth retrying.

### Added

- **`<graphify_status>` block consumed by tester** (V65-3). Tester previously received scope_hint + scope_trust but no skip-awareness — it couldn't distinguish "graphify was deliberately skipped" from "the orchestrator forgot to populate graph-impact.md". dev-workflow.md::tester dispatch + tester.md::scope_trust step extended with the parse protocol; when graphify reports an impact map with god-node listings, tests on code touching those symbols get priority because regressions ripple to all callers.
- **`graphify_inputs` schema in io-contracts.yaml** (V65-5). Each agent now declares which graphify-derived blocks it consumes (subset of `scope_hint`, `scope_trust`, `graphify_status`, `god_node_warnings`, `graph_impact_md`). Drift gate M6 enforces alignment with actual dispatch templates + agent body parsing instructions. The architectural intent "lanes are MCP-blind by design" (CLAUDE.md) is now machine-readable in the contract registry — curator + retro declare `graphify_inputs: []`.
- **`graphify node <symbol>` wired into architect's investigation toolkit** (V65-6). The CLI surface was previously dead code; architect.md::boundaries step now documents the single-symbol introspection use case alongside the C-I.2 cross-service-path protocol. Cheaper than a full file read when only the source_file + dependencies are needed. INTERNALS.md gains a new "MCP Tool Reachability" sub-section tracking every upstream graphify tool's wire status — future audits don't re-flag dead-tool concerns without context.
- **`<scope_trust>` drift gate for verifier** (V65-4). Plan finding was tentative ("verifier may lack scope_trust"); investigation confirmed verifier IS fully wired across all 3 dispatch sites (code-review, dev-workflow, code-review-parallel). M5 smoke gate locks the behavior so a future edit can't silently regress it.

### Smoke tests

- **M1-M10** (+10 net gates): M1 memory suggest triggers index rebuild, M2 health --repair handler fires for MEM_INDEX_STALE, M3 validate defers to status() before probing, M4 tester graphify_status wiring, M5 verifier scope_trust drift, M6 io-contracts graphify_inputs reality check, M7 architect get_node + INTERNALS reachability table, M8 gate freshness consumers honor first_created_at + original_workflow_id (HF-1), M9 mcp-stats --workflow-id unions with original (HF-2), M10 preflight sidecar persists god_node_match + ambiguous_bindings (HF-3).

## [0.64.0] - 2026-05-29

**Calibration #5 bug fixes + MCP wiring improvements.** Greenfield's first field session on v0.63.0 surfaced five real bugs (workflow_id mutation cascade, lanes[] flattening, JSON scalar coercion, mcp-stats namespace mismatch, drill-down oversize) and validated five P1 improvements (lane-suggestions partial mode, workflow-aware reuse gate, god_node_warnings, shortest_path verification, adaptive threshold). Smoke: **711 → 720 passed**, **0 failed**.

### Fixed

- **`state update workflow_type=...` no longer breaks freshness gates** (NEW-1). Adds immutable `first_created_at` + `original_workflow_id` fields stamped once at first activation. Freshness gates (`assert-preflight-fresh`, `assert-claude-mem-harvest`, `assert-graphify-decision`) and `mcp-stats --since-workflow-created` now use the immutable anchors. Mutable `workflow_id` + `created_at` continue to rotate on workflow_type transitions (preserves trace-attribution intent). Backward-compat fallback to `created_at` for legacy workflow.yaml files.
- **`lanes[]` block survives state-update mutations** (NEW-2). `parseSimpleYaml` now special-cases the nested `lanes:` block and round-trips it as a structured array. Previously every `state update` call dropped lanes silently because the parser only handled flat key:value pairs; `assert-lanes-registered` reported `lane_count: 0` after any mid-workflow mutation.
- **JSON object/array workflow.yaml values preserved** (NEW-3). `serializeSimpleYaml` now JSON.stringify's non-primitives; `parseSimpleYaml` JSON.parse's `{...}` / `[...]` quoted strings back to structured data. Caches like `memory_signal_json` and `scope_hint_json` no longer get coerced to the literal `[object Object]` on write.
- **`mcp-stats --tool` matches prefixed and unprefixed forms** (NEW-4). Adds `normalizeToolName` that strips the `mcp__plugin_<plugin>_` prefix to yield the canonical `mcp__<service>__<tool>` form. Trace records use the unprefixed form (handler name); orchestrators call the prefixed form (plugin-namespace). Both now match equivalently in `--tool` filter and wildcard queries.
- **`assert-reuse-analyzed` opts out for read-only workflow_types** (NEW-7). Adds `REUSE_REQUIRED_WORKFLOWS = {dev, quick_implement}`. Other types (code_review, debug, research, arch_health_scan, retro, etc.) return `ok:true` with workflow-type reason. Same A9 opt-out pattern as `assert-verifier-ran`. Closes the false-positive that greenfield's calibration #5 review session hit.

### Added

- **`graphify neighbors --max-bytes=N`** (NEW-5). Drill-downs into god-nodes can return tens of thousands of neighbors at depth=2 (greenfield's AuditMapping overflowed 84KB and produced zero signal via MCP). Sorts depth-asc + label-alpha so the closest neighbors are kept; truncated responses carry `truncated: true`, `total_neighbors`, `truncation_reason`. `code-review.md::F16` prose extended with the god-node oversize handling protocol — fall back to CLI when MCP overflows.
- **`graphify lane-suggestions` partial mode** (NEW-6). Strict 100%-coverage check relaxed: full fallback now only fires when ZERO files have graph nodes. Partial coverage falls through to grouping logic — covered files group by community, uncovered files land in the `ungrouped` bucket. Response carries `covered_count`, `uncovered_count`, `coverage_ratio`. Greenfield's calibration #5 session had 47 of 91 files uncovered → full fallback under v0.63.0; now partitions into 5+ community lanes plus one ungrouped lane.
- **`<god_node_warnings>` structured dispatch block** (C-I.1). `code-review.md::context_init` substep 3 caches `{god_node_match, matches: [{symbol, edge_count, source_file}]}` into `workflow.yaml::god_node_warnings_json`. Code-reviewer + verifier dispatch templates carry the block. Code-reviewer agent body elevates findings on god-node source files because blast radius multiplies.
- **`shortestPath` cross-service verification via architect** (C-I.2). architect.md gains an inline `graphify path <from> <to>` Bash protocol with three structured outcomes (depth ≤ 3 / depth > 3 / no path). Architect already preloads graphify-helpers + has Bash, so no new workflow step needed.
- **`graphify adaptive-threshold` CLI** (C-III.1). Returns `max(5, ceil(log10(node_count) * 2))`. quick-implement.md + dev-workflow.md graphify_scan_prep blocks pipe the value into the conditional in lieu of the hardcoded `>= 10`. Scaling: 100 nodes → 5, 5K → 8, 45K → 10 (greenfield baseline preserved), 100K+ → 10. Echoes the resolved threshold for audit trail.

### Smoke tests

- **L1-L9** (+9 net gates): L1 first_created_at immutability matrix, L2 lanes[] survives mutation, L3 JSON object round-trip, L4 mcp-stats prefix normalization, L5 max-bytes truncation, L6 reuse-analyzed workflow-type matrix, L7 god_node_warnings wiring presence, L8 architect cross-service path protocol presence, L9 adaptive-threshold scaling matrix. K32 extended to cover partial mode.

## [0.63.0] - 2026-05-28

**Phase B — symbol-extraction unlock + anti-escape-hatch gate hardening + memory UX surfacing + parallel-review polish.** Field calibrations #2–#4 against greenfield-api delivered a coherent batch of structural improvements across 13 tasks. The headline change: greenfield's #1-ranked memory UX gap (candidates sitting in `_suggestions.md` without ambient signal) closed via three coordinated surfaces, plus the symbol-extraction cascade that caused `graphify_scan_prep` to silently skip on noun-heavy tasks. Smoke: **689 → 711 passed**, **0 failed**.

### Added

- **`memory candidates-status` + `memory candidates-touch-surface` CLI.** Single source of truth for the passive memory-candidate surfacing across three ambient surfaces: SessionStart hint (when no active workflow + cooldown elapsed), `/devt:next` "no workflow" branch (count + Triage option), and present_findings footer in 4 workflows. Config keys `memory.candidates_surface_threshold` (default 5) + `memory.candidates_surface_cooldown_hours` (default 24).
- **Knowledge-candidates-tagged gate** (`state assert-knowledge-candidates-tagged`). Treats `#KNOWLEDGE-CANDIDATE` lines in scratchpad as the canonical curator capture path; explicit none-declaration via `knowledge-candidates-none.txt` with enum `reason=<task_too_routine | no_novel_patterns | all_subsumed_by_existing_memory>` is the deliberate escape hatch. Wired into the final user-presentation step of 5 workflows. Closes the prose-only candidate leak greenfield calibration #2 flagged (4 candidates described in review.md narrative, zero scratchpad tags).
- **`state aggregate-knowledge-candidates` CLI.** Aggregates `#KNOWLEDGE-CANDIDATE:` lines from `review-lane-*.md` + `review.md` into scratchpad with provenance comments. Wired into code-review-parallel.md::present_findings so parallel-flow lane tags reach the gate above. Dedup by line content; idempotent re-runs.
- **MCP `correlation_id`** per `tools/call`. 8-char hex id (crypto.randomBytes) injected into trace records AND MCP response envelope (`_meta.correlation_id`). New filter `mcp-stats --correlation-id=<id>` for retrospective single-call lookup. F16 drill-down headings across 5 workflows updated to `## Drill-down: <dep> [call: <correlation_id>]` so lane findings can cite specific calls. Code-reviewer and verifier prose now reference `[call: <id>]` as the audit handle.
- **`mcp-stats --since-workflow-created` flag.** Reads `workflow.yaml::created_at` and filters trace records by `ts >= created_at`. Resolves the workflow_id rotation issue greenfield calibration #4 documented (82 graphify calls invisible via `--workflow-id=<current>` because calls were stamped with the prior workflow_id during context_init before partition rotation). Composes conjunctively with `--since`; later timestamp wins.
- **Symbol-level F17 god-node check** (`graphify check-symbol-godnodes`). Sibling to `check-large-files`; reports every above-threshold symbol whose source_file is in the diff with no per-file aggregation. Surfaces god-nodes that file-level checks miss when a same-file sibling has higher max degree. Wired into code-review.md::F17 alongside the file-level check, with three independent signals (blast_radius / file-level / symbol-level) documented as orthogonal.
- **`graphify symbols-in-files` + `graphify lane-suggestions` CLI.** Drive the bulk_scoped tier change (B-XI) and community-driven partition (B-XIII). symbols-in-files returns top-N non-noise symbols whose source_file is in the diff; lane-suggestions groups files by dominant Leiden community attribute with graceful fallback when clustering didn't run.
- **`reuse-search-attempted.txt` marker.** Workflow bash writes the marker BEFORE invoking `state derive-reuse-candidates`. `assertReuseAnalyzed` now distinguishes "never ran" (marker absent → BLOCK) from "ran with 0 candidates" (legit no-op → PASS). Closes the silent-skip escape hatch greenfield calibration #2 flagged (v0.61.0 reuse-search feature ran zero times in a workflow).
- **`topic.resolution_path` enum in `preflight-brief.json`.** Tracks the deepest fallback leg that produced the final symbol set: `diff | text | snake_fts | kebab_fts | full_text_fts | none`. Calibrations can measure how often each leg is load-bearing without ad-hoc instrumentation. Surfaces automatically via the existing `topic` sidecar dump.

### Changed

- **Symbol-extraction unlock** (`extractTopic` in preflight.cjs). Closes the cascade where a single short PascalCase noise symbol (e.g., "Enrich") blocked the entire FTS rescue path under the legacy `symbols.length === 0` gate. Four-leg unlock: (1) gate now also fires when surviving symbols are all ≤6 chars, (2) candidate regex now accepts kebab-case in addition to snake_case, (3) terminal FTS pass on full task text when keyword FTS yields zero, (4) `resolution_path` telemetry tracks which leg fired. Field signal: GFBUGS-180 with `topic.symbols=['Enrich']` produced 0 useful symbols, but the system didn't know.
- **`claude-mem-skipped.txt` requires a structured payload.** `assertClaudeMemHarvest` validates `reason=<not_installed | mcp_unavailable | corpus_empty | task_unrelated_to_history>`; `task_unrelated_to_history` additionally requires a `details=` line. Free-form one-liners no longer satisfy the gate. Closes the lazy-escape behavior greenfield flagged ("wrote a one-line skip reason instead of actually running mcp__plugin_claude-mem_mcp-search").
- **`code-reviewer` maxTurns 40 → 60, `verifier` maxTurns 40 → 50.** Aligns with the tester/debugger deep-read agent class. Closes the input side of greenfield calibration #3's Lane C (25 files / 1577 LOC) exhausting maxTurns on both dispatches; the input-side counterpart (B-VIII per-lane sizing + oversized-lane pre-warn) closes the same gap from the other direction.
- **code-review-parallel.md::partition_lanes — community-driven partition with path fallback.** When the graph has Leiden community attributes, partition diff files by dominant community per file (B-XIII). Falls back to legacy top-2-level path partition when graphify is disabled, the graph has no community labels, or any diff file is uncovered. Both branches feed the same downstream sizing + lane-yaml emission so workflow.yaml output stays uniform.
- **code-review-parallel.md::redispatch_lanes** narrows the stub-retry prompt to "5 highest-signal findings only" (B-IX). Identical re-dispatch wasted budget on lanes that hit maxTurns during the broad first pass; constrained scope lets the limited budget produce substantive findings on the issues that actually matter. All L1 context blocks (scope_trust, scope_hint, memory_signal) remain identical — only the `<task>` directive changes.
- **code-review.md::context_init tier decision** prefers symbol_anchored from diff-derived symbols when graphify is dense + scope > impact_threshold (B-XI). The legacy bulk_scoped `query_graph(text=REVIEW_SCOPE)` returned keyword matches that didn't reflect the call graph; blast_radius with `symbolsInFiles(diff)` output produces actual structural impact. Falls back to legacy bulk_scoped when no symbols can be extracted.
- **code-review-parallel.md::partition_lanes computes per-lane file_count + est_loc** and flags `oversized: true` when a lane exceeds 15 files or 800 LOC (B-VIII). `list-lane-outputs` surfaces the fields; the workflow emits an oversized-lane warning with remediation hints (split PR / narrow scope / accept budget risk).
- **8 substep navigation markers** added to code-review.md::context_init (214 lines) and dev-workflow.md::context_init (185 lines). Greenfield calibration #2 flagged 188+ line context_init as hard to navigate. Markers are additive section headers — no bash, no assert, no agent dispatch moved. quick-implement.md (123 lines) deemed tractable and left alone.

### Documentation

- **`workflows/code-review-parallel.md::context_init` documents the MCP-setup inheritance architecture** (B-X). Greenfield audit flagged "0 functional MCP calls" — observation correct, architecture intentional. Lanes are MCP-blind by design (per CLAUDE.md::Critical Agent + Workflow Contracts); the orchestrator-mediated graph-impact.md handoff is the single source of caller analysis. Documentation closes the audit-loop so a future read doesn't re-flag the choice.
- **`agents/code-reviewer.md` disambiguates "no MCP" from "no graphify"** (B-XII). graphify-helpers skill IS preloaded per skill-index.yaml; the skill uses Bash CLI (`node bin/devt-tools.cjs graphify <subcmd>`), not MCP. code-reviewer's tools include Bash. The architectural contract is "no MCP", not "no graphify access at all". Example CLI calls included for one-off finding verification.
- **`skills/memory-curation/SKILL.md` pre-recommendation heuristic** (B-III.2). When a candidate matches tooling-evolving signal (version constraint / behavior pattern / lacks opinionated framing / title contains behavior|pattern|migration|syntax|quirk|workaround|gotcha), the curator's AskUserQuestion presents "Promote (candidate)" first with `(Recommended)` suffix. Project decisions still default to `active`. Greenfield calibration #2: "Tooling-related candidates from THIS session (Hurl scalar predicate behavior, CONCURRENTLY migration pattern) should likely auto-route to candidate status."
- **`docs/INTERNALS.md::MCP Trace` documents workflow_id rotation behavior** and points at `--since-workflow-created` as the canonical current-session observability path.
- **`skills/memory-curation/SKILL.md` step headers renamed** from `Phase A/B/C/D` to `Step 1/2/3/4 — <descriptor>`. devt-internal phase labels belong in CHANGELOG + git history only, per the documentation-discipline rule.

### Smoke tests

- **K12–K32** (+16 net gates): K12 symbol-level F17, K13 since-workflow-created, K14a/b correlation_id producer + filter, K15–K18 symbol extraction four-leg unlock + resolution_path, K19 reuse-search marker matrix, K20 claude-mem structured payload, K21 knowledge-candidates five-case matrix, K22 lane aggregator dedup + provenance, K23/K24 candidates-status + cooldown, K25 curator heuristic presence, K26 context_init substep markers, K27 lane sizing surface, K28 narrowed-redispatch presence, K29 MCP-inheritance docs presence, K30 symbols-in-files, K31 graphify-access disambiguation presence, K32 lane-suggestions community + fallback.

## [0.62.2] - 2026-05-28

**Four surgical bug fixes from greenfield calibration #3 + graphify audit.** A fresh calibration session on greenfield-api surfaced two real bugs (PREFLIGHT walk-up + MCP namespace drift) with forensic evidence in their filesystem, plus a workflow parity gap (debug.md missing auto-refresh-post-impl) and a workflow-lifecycle ergonomics gap (no `state release` CLI). Smoke: **685 → 689 passed**, **0 failed**.

### Fixed

- **pre-flight-guard refuses to fire on out-of-project file paths.** Previously the walk-up from `process.cwd()` found the first `.devt/` ancestor and treated that as project root — the hook then validated unrelated target file paths against that project's scratchpad. Greenfield's `preflight-denies.jsonl` accumulated 10+ entries for `/tmp/*.md` and `~/.claude/plans/*.md` edits across multiple sessions. After resolving project root, the hook now refuses to fire when `fs.realpathSync(target)` is not a descendant of `fs.realpathSync(dir + sep)`. Symlink resolution on both sides handles macOS `/var → /private/var` and `/tmp → /private/tmp` consistently. realpath of the target's parent (not the target itself) so the check works when the Write tool creates new files.
- **MCP namespace drift in 4 dispatching workflows.** `dev-workflow.md`, `debug.md`, `quick-implement.md`, `research-task.md` carried 12 functional `mcp__devt-graphify__*` (unprefixed) references where the plugin loader exposes only `mcp__plugin_devt_devt-graphify__*`. Agents reading the prose verbatim would call non-existent tools; the orchestrator (with both forms in scope) smoothed over the wrong-name lookup, hiding the drift. Sed-rewrite with `#` delimiter across all 4 files. Trace-filter comments in `code-review*.md` (using the `*` wildcard form) deliberately untouched — those reference the mcp-stats handler-name, which records unprefixed.

### Added

- **debug.md gains the `auto_refresh_post_impl` post-fix hook** (parity with dev-workflow.md). When the debugger lands a fix (`debug-summary.md` status=FIXED) and `graphify.enabled=true`, the workflow now offers a graph refresh before exiting. Three branches identical to dev-workflow.md: `"ask"` emits AskUserQuestion; `"true"` silently refreshes; `"false"` emits a one-line tip. Skips when the status is `NEEDS_MORE_INVESTIGATION` or `BLOCKED` (no fix landed, graph isn't stale).
- **`state release` CLI subcommand.** Cleanly releases an active workflow lock — flips `active=false, phase=cancelled, status=cancelled` and stamps `released_at`. Distinct from `state reset` (which archives all artifacts) — release preserves task outputs so `/devt:next` or `/devt:retro` can still consume them. Idempotent: re-release on an already-released workflow is a no-op. Replaces the ad-hoc workaround `state update active=false phase=cancelled status=cancelled` which previously tripped the VALID_PHASES warning.
- **"cancelled" added to `PHASE_ORDER`** as a terminal phase distinct from `complete` (normal terminal) and `finalize` (last-step-before-complete). Workflows abandoned mid-flight via `state release` end here without VALID_PHASES warnings.
- **Smoke gates K8/K9/K10/K11** — regression fixtures for the four fixes above.

## [0.62.1] - 2026-05-28

**Operational hardening + four surgical hotfixes from a fresh greenfield calibration.** The afternoon calibration on GFBUGS-180 (quick-implement workflow) surfaced four false-negative / false-positive gate behaviors that didn't need architecture, only surgical edits. Plus: release-flow hardening so the v0.58.1–v0.62.0 bulk-push silent-skip cannot recur, and a promotion of the substance-enforcement-gates pattern documentation to first-class principle status (now records all 14 shipped instances plus the freshness-binding required property). Smoke: **679 → 685 passed**, **0 failed**.

### Fixed

- **F31 stub-regex no longer false-positives on compliance checklists.** The bare-noun `/\bplaceholder\b/i` pattern was matching legitimate "No TODO / placeholder | ✓" rows in substantive review documents — flagging an 897-word review as a stub. Dropped the pattern; the other seven phrase-context patterns ("Stub written", "analysis in progress", "(stub)", line-leading "TODO:"/"WIP:", "not yet written", "Stub:" prefix) catch real stubs without the false-positive risk.
- **`extractTopic` SYMBOL_DENYLIST now filters 25 more English action verbs.** Field signal: "Enrich relative-clients picker endpoint…" pulled `Enrich` as a PascalCase symbol, the lone surviving noise also blocked the snake_case FTS rescue path (gated on `symbols.length === 0`), cascading into `graphify_scan_prep` SKIP despite a fresh dense 45K-node graph. The structural FTS-gate loosening will land in the next minor release; this patch only closes the denylist hole. New verbs: `enrich, harvest, normalize, validate, deprecate, sunset, ratify, expose, enable, disable, surface, propagate, expand, shrink, split, merge, join, annotate, tag, track, monitor, observe, log, trace, report`.
- **`state evict-workflow-artifacts` now clears `review-lane-*.json` sidecars.** The eviction regex matched `.md` only; JSON sidecars written by parallel lane agents persisted across `init review`, causing `validation_warnings=2` mid-session in greenfield's recent run. Lane MD and JSON are paired artifacts — the regex now treats them as one class.
- **`state assert-verifier-ran` short-circuits for workflow_types that don't dispatch a verifier by design.** Project config `workflow.verification=true` was producing false-negative blocks for `quick_implement` runs (which intentionally skip verification per the "skip docs and retro, go straight to code and tests" contract). Added `VERIFIER_REQUIRED_WORKFLOWS = {dev, code_review, code_review_parallel}` — workflow_types outside this set return `ok:true` with reason citing the intentional opt-out. Other gates (e.g., `assert-claude-mem-harvest`) remain workflow_type-blind by design; only the verifier gate has a workflow-type contract.

### Added

- **`scripts/release.sh X.Y.Z` helper.** Pushes commits + tag in separate operations (avoiding the bulk-push edge case that left v0.58.1–v0.62.0 without GitHub Releases for hours), uses an annotated tag for more reliable workflow triggering, verifies the release was created post-push, and surfaces the manual-dispatch recovery command if it wasn't. Documented in CLAUDE.md::Releasing as the recommended flow.
- **`workflow_dispatch` trigger on `release.yml`.** Manual recovery path when the per-tag push event silent-skips. Invoke via `gh workflow run release.yml -f tag=vX.Y.Z`. The checkout step resolves to the input tag (not main HEAD) so the rest of the job sees the tagged commit's tree.
- **Smoke gate J2 — release-tag drift.** Every local tag in the current minor-series must have a corresponding GitHub release. Catches the silent-skip pattern before it accumulates. Gracefully skips when `gh` CLI is unavailable / unauthenticated (CI runners without gh, local sessions without `gh auth login`).
- **Smoke gate J1 — substance-enforcement-gates documentation currency.** INTERNALS.md must document ≥14 substance-enforcement-gate instances. Any future gate added without updating the docs trips the gate.
- **Smoke gates K2-K5 — regression fixtures for the four surgical hotfixes.** K2: compliance-checklist with "placeholder" word does NOT trigger stub false-positive. K3: extractTopic filters "Enrich" from task-leading position. K4: both lane MD and lane JSON sidecars get evicted. K5: assert-verifier-ran short-circuits for `quick_implement` AND still blocks for `code_review`.

### Changed

- **`docs/INTERNALS.md::Substance-Enforcement Gates` section promoted to first-class architectural principle.** Expanded the instances table from 5 → 14 (the full set across the F4 → isArtifactFresh arc). New "Required properties (both must hold)" subsection codifies the invariant: every substance-enforcement gate must have BOTH existence binding (`fs.existsSync`) AND freshness binding (`isArtifactFresh`). Gates missing either property are bypassable — the field arc proved it empirically. New "Pattern recognition" bullet covers freshness binding for any artifact whose currency matters.

### Documentation

- **`docs/INTERNALS.md::MCP Trace Workflow Context` gains a CLI-wrapper caveat.** CLI wrappers (`preflight generate`, `state derive-reuse-candidates`, `state assert-graphify-decision`, `state evict-graphify`) do NOT write to `_mcp-trace.jsonl` — sessions that exercise graphify entirely through CLI wrappers will show empty `mcp-stats` output even when graphify is load-bearing. Validating the namespace-prefix invariant requires a session with direct MCP calls (e.g., code-reviewer's symbol_anchored / bulk_scoped / pr_scoped tiers, or context_init drill-downs).
- **`docs/superpowers/plans/2026-05-28-next-session-backlog.md` revised** to absorb the afternoon calibration findings: Phase A grew from 6 → 11 tasks (the four hotfixes plus operational items), Phase B restructured into three sub-batches (symbol-extraction unlock, anti-escape-hatch gate strictening, memory UX), Phase D added as research spike for agent-truncation recovery.

### Process

- **8 missing GitHub Releases backfilled.** Tags v0.58.1 through v0.62.0 were on remote but had no GitHub Releases due to a bulk `git push --tags` silent-skip. Recovered manually via `gh release create` loop. The combination of the release helper, the workflow_dispatch trigger, and J2 prevents recurrence.

## [0.62.0] - 2026-05-27

**Workflow Freshness — bind all assert-* gates to workflow.yaml::created_at.** Field validation of v0.60.0 (greenfield calibration) surfaced that all mechanical assert-* gates used existence-only checks; stale prior-workflow artifacts from prior sessions satisfied every gate. The only gate that fired correctly (`assert-auto-curator-considered`) was the one tied to a marker the current workflow must write. Plus root cause: `init.cjs::initWorkflow` returned a payload but did NOT mutate workflow.yaml — workflow_type/workflow_id/created_at only got reset when context_init bash called `state update` (which orchestrators skipped). This release closes both: `init *` now writes workflow.yaml unconditionally; every existence-checking gate gains a freshness branch (mtime vs workflow.yaml::created_at, 30s grace). Also hotfixes v0.60.0's mcp-stats namespace drift. Smoke: **666 → 678 passed**, **0 failed**.

### Fixed

- **`init review` / `init workflow` now write workflow.yaml unconditionally**. Previously initWorkflow was a payload-returning CLI; workflow.yaml mutations happened entirely through `state update` calls in each workflow's `context_init` bash. When orchestrators skipped that bash (greenfield's calibration: "I skipped context_init machinery wholesale"), workflow.yaml retained prior session values forever. Now every `init *` triggers state.cjs::updateState which already had the workflow_type-transition logic for regenerating workflow_id + created_at — just needed to be invoked. Validated end-to-end: stale workflow.yaml with `workflow_type: quick_implement` / `created_at: 2026-05-01` is fully reset by `init review`.
- **mcp-stats namespace drift hotfix**: workflow `mcp-stats` query lines now use unprefixed graphify tool names (`mcp__devt-graphify__*`) to match `_mcp-trace.jsonl` records. v0.60.0's C1 over-applied the prefixed-form replacement; "Graphify activity" surface returned empty for unknown duration. Convention documented in workflow comments: trace records UNPREFIXED form regardless of how orchestrator invokes (prefixed `mcp__plugin_devt_devt-graphify__*` per Claude Code plugin namespacing); mcp-stats queries match trace.

### Added

- **`isArtifactFresh(path)` shared helper** in state.cjs — used by every freshness-aware gate. Returns `{fresh, reason?, artifact_mtime?, workflow_created_at?, age_seconds?}`. 30-second grace window for within-workflow ordering. Auto-passes when workflow.yaml has no created_at stamp (legacy compat). Exported for testing + direct programmatic use.
- **Freshness branch on 7 existence-only assert-* gates**: `assert-graphify-decision`, `assert-verifier-ran`, `assert-claude-mem-harvest`, `assert-scope-check-handled`, `assert-consolidator-dispatched`, `assert-auto-curator-considered`, `assert-reuse-analyzed`. Each gate now has three branches: artifact absent (existing) → stale (NEW ok:false "older than workflow.yaml::created_at") → fresh (existing ok:true).
- **`state evict-workflow-artifacts` CLI** — cleans gate-satisfaction markers + lane files from `.devt/state/` while preserving task outputs (review.md, impl-summary.md, test-summary.md, spec.md, plan.md, decisions.md). Called automatically by every `init *` verb. Manual invocation supported with `--dry-run` for preview.
- **`WORKFLOW_TYPE_BY_INIT_VERB` map in init.cjs** — single source of truth mapping init CLI verbs to workflow.yaml::workflow_type values. Currently: `workflow → dev`, `review → code_review`. New init verbs added in the future must extend this map AND state.cjs::VALID_WORKFLOW_TYPES.
- **12 new smoke gates (I1-I8)**: I1a/b/c (init reset of workflow_type / workflow_id / created_at), I2a/b/c (isArtifactFresh helper correctness: absent / fresh / stale), I3a (graphify-decision staleness branch), I4a (verifier-ran staleness), I5a (reuse-analyzed staleness), I6a (evict-workflow-artifacts preserves task outputs), I7a (namespace drift convention sanity), I8a (init auto-evict).

### Architectural note

CON-001 substance-enforcement-gates now has TWO required properties:
1. **Existence binding**: the artifact must exist (already enforced)
2. **Freshness binding**: the artifact's mtime must postdate the current workflow.yaml::created_at within a 30s grace (NEW in v0.62.0)

Gates missing either property are bypassable by stale prior-workflow artifacts. Both must be in place. The greenfield v0.60.0 calibration's findings confirmed this with a 100% prediction record: every existence-only gate produced false-positive ok:true on stale state; the one gate with mechanical reset binding (auto-curator-considered) fired correctly.

### Why this matters

The greenfield v0.60.0 calibration surfaced that every mechanical gate built across v0.58-0.61 had the same architectural blind spot: existence is necessary but not sufficient for the artifact to represent the CURRENT workflow's work. Without freshness binding, a new session can start, do nothing, and pass every gate against the prior session's leftovers. This release closes that systematically across all 7 existing gates plus the freshness helper for future ones.

### Not in this release (deferred)

- **context_init prose simplification** (greenfield orchestrator's #16) — the workflow's 250-line context_init step is hard to follow; obligations near the end get forgotten. UX gap; structurally separable from freshness binding.
- **Knowledge-candidate aggregation to scratchpad** — lane agents append to lane outputs, orchestrator doesn't always aggregate.
- **Bitbucket PR-scoped tier** — still on the backlog.
- **Agent passivity around graphify** — orchestrator's P1 observation that lanes consume graph-impact.md statically; structural change (would conflict with "orchestrator owns MCP" contract).

## [0.61.0] - 2026-05-27

**Reuse Pre-Search Pattern.** Extends CON-001 substance-enforcement-gates to the duplicate-function domain. Field signal: programmers (LLM-driven) tend to reimplement functionality rather than search existing code, producing N variations of the same logic across the codebase. The prose instruction "scan existing code first" exists in `programmer.md` but gets rationalized past under context pressure — identical failure mode as the prose gates v0.58-0.60 fixed. This release adds a pure-Node CLI that queries the local graphify graph for existing methods with similar responsibility, scores them via a 3-signal heuristic (name match + caller-community overlap + docstring keyword), writes them to `.devt/state/reuse-candidates.md`, and mechanically blocks the test step until the programmer writes per-candidate decisions to `reuse-analysis.md`. Smoke: **657 → 666 passed**, **0 failed** (+9 new gates).

### Added

- **`state derive-reuse-candidates "<task>"` CLI** — pure-Node, no MCP, no LLM dispatch. Reads the local `graphify.cjs` graph via `queryGraph` + `getNeighbors`, scores candidates with a 3-signal heuristic (+3 name-keyword match, +3 caller-community overlap vs `preflight-brief.json::suggested_reading`, +2 docstring-keyword match, +1 in_degree ≥ 2), buckets into STRONG/MEDIUM/WEAK (≥7/4-6/1-3), caps top 8, writes `.devt/state/reuse-candidates.md` with signature + line number + first-comment-line per candidate. Reads source files (best-effort, 200KB cap) to extract signatures via regex against function/class declarations. Degrades gracefully when graphify is unavailable (returns `{ok:true, candidates:[]}` with reason).
- **`state assert-reuse-analyzed` CLI** — mechanical gate. Parses `reuse-candidates.md` for `` ### `<label>` `` headings, then verifies each label appears in `reuse-analysis.md`. Returns `ok:false` (with which labels are missing) until every candidate is addressed. Gate inapplicably passes when candidates.md is absent (graphify unavailable) or has zero candidates.
- **`workflows/dev-workflow.md` + `workflows/quick-implement.md` wiring** (KEEP-IN-SYNC): derive-reuse-candidates runs before programmer dispatch with the task text from `state read | jq '.task'`; programmer Task() prompt gets a `<reuse_candidates>` context block referencing the artifact; `state assert-reuse-analyzed` gates the test step.
- **`agents/programmer.md` `reuse_analysis` step** — inserted between `scan` and `plan` steps. Programmer reads `reuse-candidates.md`, writes per-candidate REUSED | EXTENDED | REJECTED decisions to `reuse-analysis.md` BEFORE writing any code. impl-summary template gets a `## Reuse Decisions` section.
- **`references/rubrics/code_review.v1.md` axis G — Reuse Discipline** — L1 (critical: duplicates a STRONG candidate without justification, OR REUSED claim has no import in diff) / L2 (important: generic REJECTED reason, EXTENDED candidate reimplemented from scratch) / L3 (acceptable: every candidate addressed defensibly) / L4 (exemplary: ≥2 helpers reused, OR semantic duplicate the pre-search missed got caught by reviewer).
- **9 new smoke gates**: H1a/b/c (CLI empty-task rejection, graphify-unavailable degradation, success-path file write), H2a/b/c (gate inapplicable, blocks missing analysis, passes complete analysis), H3a/b (workflow wiring in both dev-workflow and quick-implement), H4a (programmer.md reuse_analysis step + decision vocabulary).

### Why this ships as a single coherent release

All components are interlocked: the CLI writes the file the gate validates, which references the agent step the programmer follows, which the rubric verifies. Splitting them would ship a half-functional state. The architectural pattern (artifact + mechanical gate + agent body instruction + rubric axis) is the same recipe v0.58/0.60 established for scope_check, lanes-registered, consolidator-dispatched, auto-curator-considered — this is its 7th field-validated instance (per [[CON-001-substance-enforcement-gates]]).

### What this catches vs misses

**Catches (~70% of the duplicate-function pattern)**:
- Name-similar functions whose names overlap task keywords
- Functions called from the same upstream community as the new function
- Functions whose docstring/first-comment mentions task keywords

**Misses (~30% — second-line caught by reviewer's axis G L4)**:
- Semantically-equivalent functions with no name overlap and no shared callers
- These rely on the code-reviewer's independent scan for L4 catches

### Not in this release (deferred)

- **AST-based semantic duplicate detection** (PR-side, like the cited blog post's tool) — covers the misses above. Tracked for a future release as a complement, not replacement.
- **Bitbucket PR-scoped tier** — still on the backlog; deferred from v0.59.0+ scoping.
- **Re-dispatch template enforcement** — L1 hook can detect missing context blocks but can't distinguish freeform-with-blocks from canonical template. Deferred.

## [0.60.0] - 2026-05-27

**Mechanical gates + functional parallel partitioning.** Field validation of the prior parallel-review release revealed 5 silent-skip vectors (orchestrator skipped scope_check AskUserQuestion, lane registration, consolidator dispatch, auto_curator step, delegation routing — all prose-only). Plus the central data-layer bug: partition_lanes depended on `## Affected Communities` section that graphify never emits. This release converts prose to mechanical artifact-and-CLI gates and replaces community-based partitioning with path-based (which the orchestrator was doing manually anyway). Smoke: **642 → 657 passed**, **0 failed** (+15 new gates).

### Added

- **4 new state CLI subcommands** (mechanical gates following the substance-enforcement pattern):
  - `state assert-scope-check-handled` — BLOCKS when `scope-check-required.txt` exists but `scope-check-answer.txt` absent. Closes the AskUserQuestion silent-skip vector.
  - `state assert-lanes-registered` — BLOCKS when `workflow.yaml::lanes[]` empty. Forces `state update-lane` registration before `dispatch_lanes`.
  - `state assert-consolidator-dispatched` — BLOCKS when ≥1 lane passed substance but `consolidator-ran.txt` marker absent. Closes the orchestrator-wrote-review.md-themselves silent skip.
  - `state assert-auto-curator-considered` — BLOCKS when `auto-curator-considered.txt` absent. Forces orchestrator to enter the auto_curator step.
- **Path-based lane partitioning** in `workflows/code-review-parallel.md::partition_lanes`. Groups scope files by top-2-level directory prefix, caps at 5 lanes, falls back to single-dispatch on empty input. Replaces graphify-community-based partitioning that never worked.
- **Synthesis-mode marker write** in `agents/code-reviewer.md` — first action of synthesis mode writes `.devt/state/consolidator-ran.txt`. Consumed by assert-consolidator-dispatched.
- **auto_curator-considered marker** in `workflows/code-review.md::auto_curator` — writes FIRE or DISABLED status regardless of config opt-in.
- **15 new smoke gates** (G1a/b/c, G2a/b, G3a/b/c, G4a/b, G5a, G6a, G7a, G8a, G9a) covering the 4 mechanical assertions + 5 workflow corrections.

### Fixed

- **Tool name inconsistency**: graphify references in workflow prose now use `mcp__plugin_devt_devt-graphify__*` (matches the prefixed convention already used for claude-mem). Field signal: orchestrator had to ToolSearch for the real callable name.
- **F16 ranking ambiguity**: workflow prose now specifies "rank by in_count field if present, else edge_count, else array position".
- **F16 empty-drill-down handling**: when `get_neighbors` returns empty for a top-3 dependent (e.g., module-level container with dynamic dispatch), the step records the empty result and substitutes the next-ranked dependent.
- **god_node_match vs F17 signal clarification**: workflow prose notes the two signals measure different things (symbol-aggregated vs file-aggregated) and both should be surfaced independently.
- **`state evict-graphify` now also cleans `staleness-suppressed.txt`**: previously left stale across sessions.

### Why these ship together

All 5 silent-skip vectors derive from the same architectural class (prose gates get rationalized past). The mechanical conversion is one coherent pattern applied to 4 gates. The path-based partitioning fix is a prerequisite for those gates to have any value — without it, even mechanically-forced delegation would route into a broken workflow. The 4 prose corrections are field-validated quick fixes from the same calibration report; bundling them avoids two-release ceremony for small changes.

### Not in this release (deferred)

- **Bitbucket PR-scoped tier** — orchestrator's P0 for greenfield. Needs separate design + Bitbucket API research. Tracked for the next release.
- **Re-dispatch template enforcement** — L1 hook can detect missing context blocks but can't distinguish freeform-with-blocks from canonical template. Needs richer logging infrastructure.
- **Lane subagents getting graphify tool surface** — orchestrator's P1, but conflicts with the deliberate "orchestrator owns MCP, sub-agents MCP-blind" contract.

## [0.59.0] - 2026-05-27

**Parallel-lane code review as a first-class workflow.** Closes deferred backlog item L5 from the dispatch-hygiene release. Triggered from `/devt:review` via `AskUserQuestion` when scope > 10 files. Foreground multi-Task dispatch (Anthropic-canonical idiom); community-aware partitioning capped at 5 lanes; F28 substance gates per-lane with retry-once-then-defer; canonical re-dispatch template closes L1 hook compliance; consolidator runs code-reviewer in synthesis mode. Inherits the full substance-enforcement layer from the prior dispatch-hygiene release. Smoke: **630 → 642 passed**, **0 failed** (+12 new gates).

### Added

- **`workflows/code-review-parallel.md`** — new workflow body covering context_init, partition_lanes (community-based, cap 5), dispatch_lanes (foreground multi-Task), substance_check_lanes, redispatch_lanes (canonical L1-compliant re-dispatch template), consolidate (synthesis dispatch), verify + present_findings (KEEP-IN-SYNC with code-review.md).
- **`agents/code-reviewer.md` synthesis-mode handler** — when dispatch task instruction begins with "Synthesize the N lane review files", agent dedupes findings by (file:line:finding_class), reconciles severity via rubric, preserves Critical findings, groups by file, emits `## Lane Provenance` section.
- **`workflows/code-review.md::scope_check` step** — measures file count; when > 10 AND graphify ready, surfaces `AskUserQuestion` offering parallel-lane review with single-dispatch+community-filter as the alternative.
- **2 new state CLI subcommands**:
  - `state list-lane-outputs` — parses `workflow.yaml::lanes[]` and returns per-lane existence + size
  - `state update-lane <id> status=<status>` — mutates a single lane's status, validated against `VALID_LANE_STATUSES`
- **`code_review_parallel` workflow_type** registered in `VALID_WORKFLOW_TYPES` + routed in `next.md` + `status.md` + rubric pinned in `DEFAULTS.rubrics`.
- **12 new smoke gates**: F32a/b (scope_check + threshold), F33a/b (partition cap + fallback), F34a/b (per-lane substance + retry-defer), F35a/b (consolidator + synthesis handler), F36a/b (L1 re-dispatch + KEEP-IN-SYNC), F37a/b (impossibly-fast hard-defer + all-deferred handling).

### Why foreground dispatch

Field signal (the multi-lane fan-out case from the dispatch-hygiene release): background dispatch + "no-polling-rule" stalled the main thread waiting for agents that never returned. Foreground multi-Task in one message is Anthropic-canonical for true parallelism — each agent bounded by `maxTurns: 40` (natural timeout), all results arrive synchronously (no polling required), consolidator gets everything at once. The same pattern devt already uses for researcher+architect parallel in `dev-workflow.md`.

### Not in this release (deferred)

- Auto-trigger without AskUserQuestion (user-opt-in design preserved).
- Per-lane verifiers (single verifier on consolidated review is simpler; field signal for needing per-lane grading not yet observed).
- Multi-lane patterns for `dev-workflow.md` (no field signal for multi-programmer flows).
- Lane partitioning strategies other than community (file-bucket + directory rejected during brainstorming).

## [0.58.4] - 2026-05-27

**5 field-validated fixes from greenfield 2026-05-27 PR #372 calibration report.** Closes blockers and quick wins before v0.59.0 parallel-review work — the parallel workflow would otherwise inherit these bugs into a wider surface. Smoke: **620 → 629**, **0 failed** (+9 new gates).

### Changed

- **`workflows/code-review.md` topic.symbols pre-truncated to 32** (P2). The bash that writes `graphify-impact-plan.json` now caps the array at 32 BEFORE assembling the args, with deterministic preflight-ranking preserved. Closes a contract violation where "Use args VERBATIM" was mechanically unimplementable any time `topic.symbols > 32` — the MCP `blast_radius` cap. Workflow now emits an explicit log line when truncation fires (`topic.symbols pre-truncated: N → 32`).
- **`bin/modules/state.cjs::assertGraphifyDecision` now measures per-section drill-down substance** (P5). Each `## Drill-down:` section in `graph-impact.md` must carry ≥ 200 bytes of body OR an explicit truncation marker (`— TRUNCATED` / `saved to/at <path>`). Sections that fail both criteria are emitted in a new `thin_drill_downs[]` sidecar array and fail the gate with a reason naming the symbols + their byte counts. Closes a form-only check where 3 heading-only sections passed.
- **`bin/modules/preflight.cjs::SYMBOL_DENYLIST` extended** (P1) with 17 domain-prose tokens that slipped through into greenfield's 32-symbol args: `deep`, `shallow`, `primary`, `secondary`, `tertiary`, `service(s)`, `notification(s)`, `scope(s)`, `audit(s)`, `summary/summaries`, `lane(s)`, `tier(s)`, `phase(s)`, plus devt-internal terms (`graphify`, `claudemem`, `devt`, `preflight`). These are PascalCase-extractable from prose but never code symbols.

### Added

- **`state assert-verifier-ran` CLI subcommand** + wired into `workflows/code-review.md::present_findings` as a pre-gate. When `config.workflow.verification=true` but neither `verification.json` nor `verification.md` exists, returns `ok:false` and routes the workflow through `verdict=FAILED → STOP with BLOCKED`. Closes the silent-skip vector where the verify step's conditional skip was rationalized past ("8-lane fan-out is verifier-grade"). Same substance-enforcement architectural class as F28/F29/F30 — see [[CON-001-substance-enforcement-gates]].
- **`workflows/code-review.md::context_init` wires claude-mem 2-step pre-search** + `state assert-claude-mem-harvest` decision-artifact gate, mirroring the canonical pattern from `dev-workflow.md`. Closes the orchestrator's self-reported unconscious skip (the pre-step instruction was simply absent from the workflow file; the gate exists but never fired here).
- **9 new smoke gates**: F38a (denylist coverage), F39a/b/c (thin / substantive / truncation-marker drill-down substance), F40a/b/c (verifier-ran enforcement with verification absent / present / disabled), F41a (ARGS pre-truncation presence), F42a (claude-mem pre-step presence).

### Why these ship together

All five fixes derive from the same calibration report and form a coherent substance-enforcement pass over `/devt:review`. Shipping them as v0.58.4 before v0.59.0 parallel-review means the multi-lane workflow inherits a clean base — the parallel design's blast_radius dispatch reuses the same ARGS bash; the parallel verify path uses the same verifier-ran gate; the per-lane drill-down outputs benefit from the per-section substance check.

### Not in this release

- **F28 T+N grace timer before re-dispatch** (mentioned in the calibration report) — analyzed and rejected. The "agent still thinking" condition only manifests under background dispatch (which v0.59.0 explicitly rejects in favor of foreground multi-Task). With foreground, an agent that returns has returned final output; no grace window is meaningful. Per [[feedback-no-legacy-trash]], not adding infrastructure for an obsolete failure mode.
- **P3 graphify get_neighbors pagination** — upstream MCP surface; devt cannot patch directly. Workflow could detect overflow + auto-save + reference path, but that's a separate item.
- **P4 file-aggregated edge counts in `graphify check-large-files`** — strengthens existing F17; tracked as a separate item.
- **P6 Bitbucket-native PR-scoped tier** — new feature, deferred to its own milestone.

## [0.58.3] - 2026-05-27

**F29 + F30 + F31 — completes the substance-enforcement layer.** v0.58.2 wired F27 into one workflow (code-review) and one artifact (review.md). v0.58.3 closes the remaining surface: backports the gate to dev-workflow's multi-artifact verifier (F29), moves the substance check into the verifier agent body itself for defense-in-depth across all workflows (F30), and broadens the stub-marker regex to catch realistic phrase variants the v0.58.2 narrow form would miss (F31). Smoke: **620 passed**, **0 failed** (+6 new gates).

### Changed

- **`workflows/dev-workflow.md` verifier step now runs F28 substance check across all three upstream artifacts** (`impl-summary.md`, `test-summary.md`, `review.md`) before the deterministic pre-verifier gate. Mirrors the `code-review.md` wiring from v0.58.2; routes through the same `verdict=FAILED → STOP with BLOCKED` terminal when any artifact looks like a stub. Saves a verifier dispatch on stub upstream — surfaces remediation (re-dispatch the originating agent) instead of asking the verifier to grade a placeholder.
- **`agents/verifier.md` carries a `substance_pre_check` step** as defense-in-depth — runs `state check-agent-output` on upstream artifacts immediately after stub-first protocol, before any grading effort. When a stub is detected, writes `verdict=failed` to verification.json with a structured `failure_reason` and exits. Makes substance enforcement structural rather than workflow-dependent: gates fire even when a new workflow is added without the explicit F28/F29 wiring.
- **F27 stub-marker regex broadened**: replaces `\banalysis in progress\b` with verb-prefixed `\b(?:analysis|implementation|review|work|writing|investigation)\s+in\s+progress\b`, and adds a new leading-marker pattern `^\s*stub\s*[:.]` that catches the field-validated "Stub: …" prefix form. Both validated against real review.md files: catches stubs, returns zero matches on substantive 2132-word reviews.

### Added

- **6 new smoke gates**:
  - F29a: dev-workflow.md wires substance check across all three upstream artifacts before verifier dispatch
  - F29b: stub impl-summary.md routes through `looks_like_stub:true + ok:false`
  - F30a: verifier.md carries the substance_pre_check step + `check-agent-output` call + `verdict=failed` routing
  - F31a: broadened regex catches "implementation in progress" variant (missed by v0.58.2 narrow regex)
  - F31b: leading "Stub:" marker catches the field-validated greenfield form
  - F31c: broadened regex does NOT false-positive on substantive prose mentioning "implementation" without "in progress"

### Fixed

- **`agents/verifier.md` substance pre-check uses the canonical `TS=$(date …)` heredoc pattern** rather than inlining `$(date …)` inside the JSON body. Aligns with the byte-stability lint's 3-line code-fence lookback window — keeps the prefix-cache stable across iterations and prevents a smoke regression on the v0.32.0+ byte-stability gate.

### Why all three together

F29 alone leaves dev-workflow gated but every other workflow with a verifier unprotected; F30 alone provides defense-in-depth but lets workflows burn a verifier dispatch before the agent self-aborts; F31 alone tightens detection but doesn't reach new dispatch sites. Together they make substance enforcement robust against three independent failure modes: workflow forgets to wire (F30 catches), regex too narrow (F31 catches), multi-artifact verifier path lacks coverage (F29 catches).

### Not in this release (validated and skipped)

- **F28 in `quick-implement.md`** — validation confirmed quick-implement has zero `Task(subagent_type="devt:verifier"...)` dispatches by design (the workflow's stated purpose is "skip docs and retro, go straight to code and tests"). No verifier means no substance gate to wire. Recorded here so future audits don't re-evaluate.

## [0.58.2] - 2026-05-27

**F28 — activates F27 from dormant CLI to live workflow gate**, plus documentation alignment. v0.58.1 shipped `state check-agent-output` as a CLI but nothing called it; the greenfield failure mode (5/6 lane outputs were stubs the verifier approved) remained un-blocked in the actual workflow flow. v0.58.2 wires the substance check into `code-review.md` before the verifier dispatch, syncs CLAUDE.md, and codifies the recurring "substance vs form gates" pattern in `docs/INTERNALS.md`. Smoke: **614 passed**, **0 failed** (+2 new gates).

### Changed

- **`workflows/code-review.md` verifier step now runs `state check-agent-output .devt/state/review.md` as a substance pre-gate** before the verifier dispatch. When the CLI returns `looks_like_stub: true`, the workflow writes `phase=verify status=BLOCKED verdict=FAILED` and exits — routing through the existing `verdict=FAILED → STOP with BLOCKED` terminal at the same step. Saves a verifier dispatch on a stub artifact and surfaces a remediation (re-dispatch the reviewer) instead.

### Added

- **`docs/INTERNALS.md::Substance-Enforcement Gates` section** — codifies the recurring architectural pattern across F4 / B4 / L1 / F26 / F27+F28. Tabulates each instance's form-check vs substance-gap, lists the three substance signal categories (MCP trace cross-reference, agent-output check, mandatory-step relocation), and documents why these gates fail closed rather than emit advisory warnings. Audit checklist included for reviewing future gates.
- **`CLAUDE.md` Development Commands sync** — `state check-agent-output <path>` and `state assert-graphify-decision` added to the state subcommand block. Closes the docs gap from v0.58.1 (new CLI subcommand wasn't reflected in the discoverable command list).
- **2 new smoke gates**: F28a (presence-check that `code-review.md` invokes `state check-agent-output` and gates on `looks_like_stub`), F28b (behavioral check that a stub review.md returns `looks_like_stub:true + ok:false`, confirming the CLI output is what the workflow gates on).

### Why this matters

v0.58.1 added F27 as a CLI but no caller. Per the [[feedback-validate-during-impl]] discipline, dormant gates are half-fixes — the substance enforcement only counts when a workflow actually consults the CLI. v0.58.2 closes that loop on the highest-risk dispatch (verifier on review.md) and documents the pattern so future gates inherit the discipline rather than re-discovering the lesson under field pressure.

### Not in this release (deferred)

- **F28 in dev-workflow.md verifier dispatch** — the same substance gate would apply to `verification.md` / `impl-summary.md` artifacts in the dev flow. Deferred until field signal arrives showing the failure mode there too (current observed cases are all multi-lane review fan-out).
- **F26 missing-trace-file branch** — `setup.cjs:319` creates `_mcp-trace.jsonl` unconditionally during init, so the file missing reduces to "project not set up" which is itself a substance failure. Existing behavior (treat as fabricated) is correct; explicit branch unnecessary.

## [0.58.1] - 2026-05-27

**F26 + F27 — substance enforcement on existing gates.** Same architectural class as prior F4/B4/L1: gates that don't enforce what they claim. Field rationale (greenfield 2026-05-26 PR #372 multi-lane review): two new bypass patterns surfaced — the drill-down gate accepted prose-only sections without any MCP calls, and the verifier approved lane outputs whose entire body was `Stub written; analysis in progress.` Smoke: **612 passed**, **0 failed** (+5 new gates).

### Changed

- **`state assert-graphify-decision` now cross-references `.devt/memory/_mcp-trace.jsonl`** for `get_neighbors` calls scoped to the current `workflow_id`. When `drill_down_sections >= 1` but no matching MCP records exist in the workflow's window, the gate returns `ok: false` with `fabricated_drill_down: true` and a reason naming the section count. Closes the form-vs-substance gap where 3 prose drill-down headings could be hand-written from codebase knowledge without invoking MCP.

### Added

- **`state check-agent-output <file-path>` CLI subcommand** — substance check for agent output files. Returns JSON with `word_count`, `stub_phrases_found[]`, `heading_only`, and `looks_like_stub`. Flags output as a stub when ANY of: stub-marker phrase present (`stub written`, `analysis in progress`, `placeholder`, `TODO:`, `WIP:`, `(stub)`, `not yet written/complete/done`), word count below 50, OR every non-empty line is a heading. Provides the API auditors and downstream gates need to refuse stub-only lane outputs.
- **`mcp_get_neighbors_calls` + `fabricated_drill_down`** fields on `state assert-graphify-decision` response — exposes the MCP cross-reference count and the boolean fabrication verdict so workflows and auditors can read substance state without re-parsing trace files.
- **5 new smoke gates**: F26a (fabricated drill-down blocked), F26b (real drill-down with matching MCP calls passes), F27a (substantive output passes), F27b (stub-phrase output blocked), F27c (heading-only output blocked).

### Why these are blocking (not advisory)

Both fixes follow the same lesson as L1 (v0.58.0): soft signals get classified as "not load-bearing" by orchestrators under context pressure. Per [[feedback-no-legacy-trash]] devt ships clean defaults — no opt-in flag, no transitional warn mode. Workflows already wired to `assert-graphify-decision` inherit F26 for free; `check-agent-output` is a CLI that workflows can adopt incrementally without breaking existing wiring.

### Not in this release (deferred)

- **Workflow integration of `check-agent-output`** — wiring the CLI into `code-review.md` verifier dispatch's pre-check or a new `assert-lane-substance` step is left for v0.58.2. The CLI alone provides the API; workflow adoption can land separately without affecting the gate semantics.

## [0.58.0] - 2026-05-26

**L1 — Dispatch-hygiene hook upgrades from advisory to default-block.** Field rationale (greenfield 2026-05-26): orchestrator received 6 advisory warnings in succession and proceeded anyway. The LLM's self-diagnosis: *"ceremony cost > result urgency, every time. The hook is the only counterweight, and a soft warning loses to perceived urgency. Make it pay involuntarily."* Smoke: **607 passed**, **0 failed** (+5 L1 gates).

### Changed (BREAKING for raw dispatches)

- **`hooks/dispatch-hygiene-guard.sh` now returns `{decision:"deny"}` by default** when a raw `devt:*` dispatch is detected (prompt lacks ALL of `<scope_trust>`, `<scope_hint>`, `<memory_signal>`). Hard-blocks the dispatch instead of merely emitting an advisory. Investigative subagents only (`code-reviewer`, `programmer`, `verifier`, `researcher`, `debugger`, `architect`, `tester`) — curator/docs-writer/retro/coordinator are exempt because their dispatch templates legitimately don't carry scope blocks.

### Added

- **`dispatch_hygiene_mode` config flag** (top-level in `.devt/config.json`):
  - `"block"` (default) — hook denies raw investigative dispatches
  - `"warn"` — hook emits `additionalContext` advisory, allows call (pre-L1 behavior)
  - `"off"` — hook is a no-op for raw dispatches
- **Agent-type filter** in the hook — block-mode no longer over-fires on curator/docs-writer dispatches that legitimately don't carry scope blocks.
- **5 L1 smoke gates**: L1a (default block on raw code-reviewer), L1b (warn mode allows + advises), L1c (off mode no-op), L1d (curator exempt from block), L1e (wrapped dispatch with `<scope_trust>` passes).

### Why default-block

Three structural arguments:

1. **Field-validated necessity**: soft warning was ignored 6 times in one session by the same LLM, with explicit self-report that informational warnings get classified as "not load-bearing".
2. **Pattern consistency**: same lesson as F4 (gate inside skippable step → moved to precondition) and B4 (relocated to mandatory step). Gates that don't block don't work.
3. **Per [[feedback-no-legacy-trash]]**: devt has no production usage that requires raw dispatch. Ship the clean default. Users with intentional raw-dispatch needs (custom workflows, testing) opt to `warn` or `off`.

### Migration notes

- Existing devt workflows are unaffected — dispatch templates always carry scope blocks; the hook only denies *raw* dispatches that bypass the workflow contract.
- Users who improvise raw `Task(subagent_type="devt:code-reviewer", ...)` calls will get a deny with remediation guidance.
- Override per-project by adding `"dispatch_hygiene_mode": "warn"` to `.devt/config.json`.

### Deferred from field report (next-cycle backlog)

- **L2** — Compound `prep-context` CLI runs all context_init bash in one call (DX win, removes 200-line ceremony).
- **L3** — Pre-load graphify MCP tools (out of devt's control — Claude Code harness).
- **L4** — `compose-dispatch-prompt` CLI emits ready-to-paste templated prompts.
- **L5** — Document parallel-lane workflow (`code-review-parallel.md`) for multi-lane reviews.

## [0.57.4] - 2026-05-26

Minimum-viable B6 — F16 top-3 drill-down enforcement (signal-only). Smoke: **602 passed**, **0 failed** (+1 new gate).

### Added

- **`drill_down_sections` + `under_three_drill_downs`** fields on `state assert-graphify-decision` response. Counts `## Drill-down:` headings in `graph-impact.md` and flags when fewer than 3 are present. Field rationale (greenfield 2026-05-26): orchestrator drilled top-1 dependent (ClientService) and skipped top-2/3. Signal-only — does NOT block; legitimate small graphs may have fewer than 3 direct_dependents to drill into. Downstream tooling / auditors can use the signal to surface incomplete F16 execution.
- **F25 smoke gate** — verifies `drill_down_sections=0` + `under_three_drill_downs=true` on a substantive graph-impact.md with zero drill-down sections.

### Why signal-only, not BLOCK

A hard gate at ≥3 drill-downs would false-positive on legitimate cases:
- Small project graphs with fewer than 3 direct_dependents
- Leaf central symbols (no callers to drill into)
- Single-tier graphify responses without drill-down section

Combined with F18's `thin_content` + `section_count`, the assert response now carries 5 quality signals: `file_bytes`, `section_count`, `drill_down_sections`, `thin_content`, `under_three_drill_downs`. Workflows and auditors can build verdict logic on top without the gate making policy decisions about acceptable drill-down counts.

### Still deferred

- **B3 (inheritance edge filtering)** — blocked on graphify upstream `edge_type` metadata. No clean local heuristic.
- **B6-full (hard-block on <3)** — needs verdict-design pass to handle small-graph false positives.

## [0.57.3] - 2026-05-26

Field-validation bug-fix wave from greenfield WITH_CONCERNS verdict. Closes 4 of 6 audited bugs (B1, B2, B4, B5); defers 2 (B3, B6) with documented reasons. Smoke: **601 passed**, **0 failed** (+6 new gates).

### Fixed

- **B1 — CENTRAL_SYMBOL selection now task-aware.** Field rationale: bash `jq -r '.[0]'` picked alphabetically-first `AuditMapping` for a task about clients/relatives; orchestrator had to manually override. New `preflight pick-central-symbol` CLI tokenizes each symbol (CamelCase + snake_case → 3-char-plus tokens) and scores by fraction of tokens appearing in task text. Highest score wins; falls back to first symbol when no score > 0. Wired into 4 workflows (dev-workflow, quick-implement, research-task, debug) with `jq` fallback.
- **B2 — scope_hint no longer poisoned by god-node neighborhoods.** When `blast.god_node_match=true`, `directDeps` is suppressed from `suggestedReading` because the god-node's huge dependent list is structurally adjacent but task-irrelevant. Field case: `ClientService` god-node match filled `scope_hint` with `OrganizationCreatedEvent` etc. — zero overlap with actual task. Path: `preflight.cjs::generate`.
- **B4 — claude-mem harvest gate relocated to curator-dispatch precondition.** Field rationale: orchestrator skipped the entire `harvest_observations` step; assert-claude-mem-harvest never fired because it was INSIDE the skipped step. Gate now runs as a precondition before curator dispatch in 3 workflows (dev-workflow, lesson-extraction, memory-promote). Missing harvest now BLOCKS curator instead of silently passing.
- **B5 — F8 god-node prose fallback when token match fails.** Previously the operational-guidance prose (`"prefer adding methods over modifying signatures"`) required `report.god_nodes` to textually match a topic symbol via tokenMatches(). When `blast.god_node_match=true` but textual tokenization differed (e.g., CamelCase vs snake_case), no prose surfaced. Now surfaces the top god-node when `blast.god_node_match=true` even if textual match fails. Path: `preflight.cjs::renderBrief`.

### Added

- **`preflight pick-central-symbol <symbols-json> <task-text>` CLI subcommand** — used by 4 workflow bash blocks to pick a task-relevant central symbol from topic.symbols. Returns plain-string output for shell consumption.
- **5 new smoke gates**: F21a (pick-central-symbol task-relevant), F21b (fallback to first), F22 (B4 gate present in 3 workflows), F23 (B2 suppression present), F24 (B5 fallback present).

### Deferred

- **B3 — Inheritance edges in `direct_dependents`** (e.g., `BaseModel` listed as dependent of `ClientRelativeDetail`). Filtering parent-class edges requires `edge_type` metadata which graphify's `graph.json` does not currently expose. Deferred until graphify upstream surfaces relation kinds, or local inheritance-detection heuristic is designed.
- **B6 — F16 top-3 drill-down enforcement.** Workflow prose prescribes top-3 `get_neighbors` calls but only assert-graphify-decision checks file presence, not section count. Would require extending `assertGraphifyDecision` with a `min_drill_down_sections` parameter and a corresponding `WARNED` / `BLOCKED` verdict design. Deferred to v0.58.0+ as its own contract design.
- **A2 — Inline-implementation impl-summary stub.** When orchestrator implements without dispatching `devt:programmer`, no `impl-summary.json` is written and the post-impl graphify-refresh gate has nothing to read. Fix would auto-write a minimal stub from git-diff data. Deferred — requires orchestrator-side detection logic.

## [0.57.2] - 2026-05-26

Skill best-practice compliance — converts 6 second-person language instances across 4 skills to imperative form per the [official skill-writing guidance](https://docs.claude.com/en/docs/claude-code/skills) (page 12-13 of *The Complete Guide to Building Skills for Claude*). Smoke: **596 passed**, **0 failed** (+1 F20 gate).

### Changed (second-person → imperative)

- **`codebase-scan`** — "Search before you build" → "Search before building"; "No you will not. Deduplicate now." → "Refactor-later never happens. Deduplicate now."
- **`lesson-extraction`** — "You will not. In 3 months, you will make the same mistake." → "Memory is unreliable. The same mistake recurs in 3 months."
- **`memory-curation`** — "you can promote to active later" → "promote to active later"
- **`memory-pre-flight`** — "If you must propose it anyway" → "To propose it anyway"; "assuming you know the governance is expensive" → "assuming the governance is already known is expensive"; "When you cite a Brief entry... you can include the source root" → "When citing a Brief entry... include the source root"

### Added

- **F20 smoke gate** — enforces zero "you should/need/can/must/will" patterns in any `skills/*/SKILL.md` body. Catches future drift back to second-person phrasing.

### Validated (no action taken)

- **`allowed-tools` frontmatter** in 16 skills — grep of `bin/`, `hooks/`, `scripts/` confirms no devt code reads this field. Likely vestigial. Left in place this release; removal deferred to a verification wave once Claude Code's harness contract is confirmed (per `[[feedback-validate-external-schema]]`).
- **`council` SKILL.md body at 2,729 words** — 37% over the 2,000-word ideal but well under the 5,000-word hard max. Proper trim requires `references/` split (move 5 advisor briefs out). Deferred to v0.58.0+ as architectural-disclosure work, not in-place trim.

## [0.57.1] - 2026-05-26

Skill description refactor — trims 8 verbose SKILL.md descriptions to follow the official [`What it does` + `When to use it` + `Key capabilities`] structure documented in *The Complete Guide to Building Skills for Claude* (page 11). Smoke: **595 passed**, **0 failed** (+1 new gate enforcing the 800-char limit).

### Why

Skill descriptions load into every Claude session via level-1 progressive disclosure (always in context). The 8 audited skills were 800–1,100 chars each (~200–275 tokens). One — `codebase-scan` — was over the official 1,024-char hard limit (1,045 chars). Together they cost ~2,000 tokens per session before any skill was triggered.

### Changed

- **`skills/codebase-scan/SKILL.md`** — description trimmed from 1,045 → ~430 chars. Was in violation of the official 1,024-char hard limit.
- **`skills/complexity-assessment/SKILL.md`** — 1,028 → ~440 chars
- **`skills/api-docs-fetcher/SKILL.md`** — 916 → ~400 chars
- **`skills/scratchpad/SKILL.md`** — 885 → ~420 chars
- **`skills/weekly-report/SKILL.md`** — 868 → ~390 chars
- **`skills/council/SKILL.md`** — 867 → ~420 chars
- **`skills/tdd-patterns/SKILL.md`** — 832 → ~370 chars
- **`skills/lesson-extraction/SKILL.md`** — 825 → ~430 chars

Each rewrite follows the official template: lead with what the skill does, name 3–5 specific trigger phrases users would say, end with a "Distinct from <sibling skill>" disambiguation. Removed: quoted-phrase enumeration (10–20 paraphrases → 3–5 canonical), negative-space "NOT for X" clauses (3–6 → 1 disambiguation line), implementation details that belong in skill body.

### Added

- **F19 smoke gate** — enforces all `skills/*/SKILL.md` descriptions stay under 800 chars (22% margin under the official 1,024-char hard limit). Catches future verbose-description drift before it lands.

### Token savings

- Per session: ~2,000 → ~600 tokens of skill metadata (≈ 1,400 tokens saved every session).
- Compounds across every user and every session for the lifetime of the plugin.

## [0.57.0] - 2026-05-26

Wave 3 — memory pipeline + state hygiene + graphify depth. Twelve atomic fixes across two themes: (a) close the silent capture/promotion leak surfaced by greenfield field validation, (b) advance graphify integration depth from "data ingested at workflow boundaries" to "multi-tier drill-down with structural-risk surfacing". Smoke: **594 passed**, **0 failed** (+25 gates over v0.56.0's 569).

### Memory pipeline (capture → harvest → promote)

- **F4** — `state assert-claude-mem-harvest` decision-artifact gate. Mirrors `assertGraphifyDecision` pattern: exactly ONE of `claude-mem-harvest.md` or `claude-mem-skipped.txt` MUST exist after the orchestrator's pre-step in `dev-workflow` / `quick-implement` / `lesson-extraction`. Closes the silent-skip leak where greenfield's `_suggestions.md` accumulated only graphify god-nodes despite dozens of workflows running. Prose clarified to call both `mcp__plugin_claude-mem_mcp-search__search` AND `get_observations` (the bare search returns Title only).
- **F5** — `#KNOWLEDGE-CANDIDATE` capture instruction added to 5 agent body files (researcher, code-reviewer, debugger, architect, programmer). Target: `.devt/state/scratchpad.md` (NOT primary artifact — discovery.cjs:62 scans scratchpad). Each tag passes the 5-filter test: specificity, durability, non-obviousness, evidence, actionability.
- **F5b** — Knowledge-candidate dispatch reinforcement in 7 workflow dispatch task blocks. Field-validated necessity: F5 alone produced ZERO tags in greenfield's PR #370 5-lane review because the agent-body instruction wasn't load-bearing in dispatch context. Reinforcement makes it explicit in the `<task>` block.
- **F6** — Conditional auto-curator on `/devt:review` + `/devt:debug`. Opt-in via `memory.auto_curator_on_review: false` default. Fires curator dispatch at workflow end when `_suggestions.md` has ≥3 candidates AND last curator run ≥7d ago. Cooldown tracked in `.devt/state/last-curator-run.txt` (RESET_EXEMPT — survives `/devt:cancel-workflow`).

### Graphify depth (3-layer defense ladder + structural risk surfacing)

- **F16** — Multi-tier drill-down. Re-orders the existing scan_prep MCP sequence in 4 workflows AND adds post-impact-plan drill-down in code-review.md. After `blast_radius` returns, orchestrator auto-calls `get_neighbors` on the top-3 direct dependents. Field rationale: greenfield's PR #370 review made ONE MCP call total while 5 lane subagents grep-hunted for caller sets that 3 cheap MCP calls would have surfaced.
- **F17** — God-node auto-check on diff files. New CPU-local CLI `graphify check-large-files <file>... [--edge-threshold=50]` maps diff files back to graph nodes via `source_file` metadata and reports max-degree symbol per file. Catches god-nodes the symbol-anchored anchor list missed (greenfield: routes.py at 2,463 LOC was almost certainly a god-node but missed because the anchor list didn't include module-level identifiers). Workflow appends a `## God-node warning` section to `graph-impact.md` when any file crosses threshold.
- **F18** — Content-quality signal in `assert-graphify-decision`. Adds `file_bytes`, `section_count`, `thin_content` to the gate response. Signal-only (gate still passes) — workflows/auditors can flag thin payloads without blocking legitimate-empty results.

### Bug fixes from field validation

- **F14** — `state read` deep-parses `_json`-suffixed keys. Field failure (greenfield 2026-05-26): `STATE=$(state read); echo "$STATE" | jq` broke with "control characters from U+0000 through U+001F" because zsh's `echo` interpreted embedded `\n` escapes in nested string values. After F14, `_json` keys are real arrays/objects in the JSON output — no embedded escape sequences for shells to misinterpret.

### State hygiene

- **F15** — Removed 3 dead canonical file entries (`regression-baseline.md`, `memory-suggestions.md`, `pr-impact.md`) after full-codebase grep confirmed zero writers and zero readers. Updated 4 doc/skill references that pointed to the legacy `pr-impact.md` alias.
- **F10** — Slug-variant patterns + `review-scope.md` rename + `state history` CLI + collision gate. Adds `^plan-<slug>.md`, `^research-<slug>.md`, `^spec-<slug>.md`, `^debug-{context,investigation,summary}-<slug>.md` to `STATE_FILE_CONTRACT.allowed_patterns`. Renames `review-scope.md` → `code-review-input.md` to eliminate collision with `^review-<slug>.md$` pattern. New `state history` subcommand walks `.devt/state/.archive/<ts>/` and emits archived workflow.yaml tasks for browseable history. Collision smoke gate prevents future drift.

### Architectural notes

- All Wave 3 fixes preserve the documented contract: orchestrator owns MCP; sub-agents are MCP-blind by design. F16/F17/F18 add depth via CLI-side functions + orchestrator-prose pre-steps + hard decision-artifact gates — no sub-agent MCP grants.
- Three-layer defense against empty-symbol cascades is now structurally complete: (1) PascalCase text extraction, (2) snake_case FTS fallback (F12 from v0.56.0), (3) orchestrator `query_graph` recovery (F13 from v0.56.0).
- Three-layer defense against silent capture leaks: (1) agent prompts request tags (F5), (2) dispatch reinforces (F5b), (3) hard gate catches harvest-skip (F4).

## [0.56.0] - 2026-05-26

Graphify completion wave (Wave 2). Closes the four orchestrator-skip + cascade-failure patterns that left subagents flying blind on healthy graphs across greenfield field audits. Architecturally bounded — sub-agents remain MCP-blind by design; all fixes route through orchestrator-prose pre-steps + CLI-side fallbacks + hard decision-artifact gates. Smoke: **569 passed**, **0 failed** (+5 new gates over v0.55.1's 564 baseline).

### Added

- **`graphify_scan_prep` gate now active in research-task + debug workflows.** Both workflows previously evicted graphify artifacts at init but never regenerated them — sub-agents dispatched without `graph-impact.md` even on dense graphs. Now both workflows run the same bash decision tree as `dev-workflow` / `quick-implement` (threshold: trust=dense + dependents≥10 + symbols>0), instruct the orchestrator to write `graph-impact.md` via `get_neighbors` + `blast_radius` MCP calls, and hard-fail via `state assert-graphify-decision` if the artifact is missing. Researcher + debugger dispatch templates gain a `<graph_impact>` block pointing to the file. Field rationale: greenfield-api GF-543 researcher solved an RBAC topic via grep on a fresh 43k-node graph because research-task had no scan_prep step.
- **Top-3 god-nodes in `preflight-brief.json` sidecar.** New `god_nodes: [{symbol, edge_count}]` field surfaces structured god-node data so workflows can extract programmatically without parsing the markdown brief. Sourced via `graphify.godNodes(3)`, reuses the existing adjacency cache.
- **Operational guidance in preflight brief for >=50 edge god-nodes.** Cross-Cutting Concerns section now appends `"— prefer adding new methods over modifying signatures; any signature change ripples to all callers"` to god-nodes above the edge threshold. Reifies the implication so agents adopt safer change patterns instead of reading raw edge counts as data.
- **`extractTopic` FTS fallback for snake_case service names.** When text + diff symbol extraction returns 0 symbols, `preflight.cjs::extractTopic` falls back to `graphify.queryGraph()` against snake_case keywords in the task text (`foo_bar`, `foo_bar_baz` patterns). Field root cause: greenfield-api GF-543 task `"tablet_communication permission"` returned 0 symbols because the PascalCase regex misses directory/module names; cascade: no symbols → blast=skip → graph-impact=skip → subagent blind. Cap at 3 candidate queries to bound cost. Design: dependency-injected via `opts.graphifyQuery` so `extractTopic` stays pure-testable.
- **`RECOVERY` branch in `graphify_scan_prep` across all 4 workflows.** When topic extraction returns 0 symbols on a dense graph (i.e., F12 snake_case fallback also missed), bash echoes `RECOVERY` instead of `SKIP`. Prose instructs orchestrator to call `mcp__devt-graphify__query_graph(task_text, limit=5)` directly, use top result as CENTRAL_SYMBOL, then proceed with the standard `get_neighbors` + `blast_radius` calls. Wired across `dev-workflow`, `quick-implement`, `research-task`, `debug`. Defense in depth — F12 catches the common case in-process, F13 catches the truly opaque case via orchestrator MCP.

### Architectural notes

- **Sub-agents remain MCP-blind by design.** The greenfield audit's #1 recommendation ("grant graphify tools to programmer/researcher") was deliberately rejected per the documented contract in `CLAUDE.md` (Orchestrator owns MCP; file-based handoff is load-bearing for resume/replay/telemetry). All Wave 2 fixes route through orchestrator-prose pre-steps + CLI-side fallbacks + hard decision-artifact gates. The architectural contract is preserved; the workflows are just better instrumented.
- **Three-layer defense against empty-symbol cascade**: (1) `extractTopic` PascalCase extraction (existing); (2) `extractTopic` snake_case FTS fallback (F12, this release); (3) orchestrator `query_graph` recovery branch (F13, this release). Field-validated cases where each layer fires.

## [0.55.1] - 2026-05-26

Three bug-fix patches discovered during deep diagnostic of two greenfield field audits (research-phase + implementation-phase). All fixes address silent failure modes that were degrading graphify integration and confusing health output. Smoke: **564 passed**, **0 failed** (+3 new gates).

### Fixed

- **Graphify staleness gate false positive — root cause: `built_at_commit` scan window too small.** `bin/modules/graphify.cjs::freshness()` only scanned the first 8KB of `graph.json`, but newer graphify versions emit `built_at_commit` as a JSON **trailer** at end-of-file. On greenfield's 42MB graph the field sits at byte 42,576,276 of 42,576,339 — the head scan never reached it. Result: `built_at: null` cascaded into `lag_commits: null`, which workflow staleness gates interpreted as "graph unreachable", forcing `scope_trust.trust='sparse'` on a graph that was literally at HEAD. Fix scans BOTH first 8KB AND last 16KB. Eliminates the false-positive at root; no special-case logic needed in the 5 workflow gates that consume staleness.
- **Health `update` field showed stale `installed` version when local VERSION was bumped between update-check runs.** `bin/modules/health.cjs:88-102` read `update-check.json` from tmpdir without comparing `cached.installed` against the freshly-read `version`. Surfaced as `version: 0.55.0` (correct) alongside `update.installed: 0.49.0` (stale cache snapshot). Fix drops the entire `update` field when `cached.installed !== version`. `update.cjs::check()` already validates `cached.installed === local` before returning cached data; this aligns health's read path with that contract.

### Added

- **`I004` health info code surfaces pending memory-promotion candidates.** New `/devt:health` info-level signal counts `### ⚖️` and `### 🔵` headings in `.devt/memory/_suggestions.md` and reports `N candidates pending` with fix hint `/devt:retro` or `/devt:memory promote`. Closes the silent-rot pattern where discovery harvests accumulated unpromoted candidates between curator runs and users had no surface to notice. Adds telemetry signal for future auto-curator dispatch design (Wave 3 deferred work).

### Diagnostic notes (field validation)

- Greenfield's `graph.json::built_at_commit` matched current `git rev-parse HEAD` perfectly (`fef0f27...`) — graph WAS fresh; only the freshness extraction was broken.
- F2 fix preserves the existing 8KB head-scan path; tail-scan runs only when head match fails. Backward-compatible with older graphify versions that emit `built_at_commit` near the start.

## [0.55.0] - 2026-05-22

Graphify quality + coordination pass — two pareto improvements (positive on both token and quality vectors). Closes DEF-038 (stale preflight brief silently degrades graphify tier selection) + adds explicit skip-context coordination signal to reviewer dispatches. Smoke: **561 passed**, **0 failed** (+5 new gates).

### Added

- **`bin/modules/state.cjs::assertPreflightFresh` + `state assert-preflight-fresh` CLI** (DEF-038). New hard process gate that catches orchestrator-skipped preflight generate at workflow start. Compares `preflight-brief.json` mtime against `workflow.yaml::created_at`; BLOCKs when the brief is older than the workflow with a >30s margin. Auto-passes when workflow.yaml is absent (no active workflow), brief is absent (preflight disabled / failed gracefully), or created_at is absent (legacy workflow). Field-validated: greenfield 2026-05-21 had brief mtime 4h older than workflow.yaml::created_at — orchestrator silently reused a stale brief from a prior session, leading to stale `topic.symbols` cascading to `tier=skip` and 0 graphify MCP calls.
- **5 workflows wire `assert-preflight-fresh`** after their respective `preflight generate` invocations: `code-review.md`, `dev-workflow.md`, `quick-implement.md` add it alongside the existing `assert-graphify-decision` gate; `debug.md` and `research-task.md` add standalone post-`preflight generate` blocks. All STOP with BLOCKED + reason on `ok:false`.
- **`<graphify_status>` block in `workflows/code-review.md` reviewer dispatch template + `agents/code-reviewer.md` instruction**. Bash before dispatch reads `.devt/state/graphify-skip-reason.txt` or `graph-impact.md` and emits `{skipped: bool, reason?, impact_map?}` JSON. Reviewer parses block: when `skipped === true`, switches to **deliberate fallback mode** (grep + Read for caller analysis on high-severity findings) instead of hunting for an absent impact map. Eliminates the "did graphify silently fail?" ambiguity that was field-observed in greenfield PR-369 reviews. Token cost per dispatch: ~80 bytes. Coordination win: reviewer knows graphify was intentionally skipped vs accidentally absent.
- **5 new smoke gates**: (1) `assert-preflight-fresh` envelope shape, (2) functional BLOCK on stale brief (1h-old vs new workflow), (3) all 5 workflows wire the gate, (4) `code-review.md` has the `<graphify_status>` template + bash extraction + placeholder substitution, (5) `agents/code-reviewer.md` has the deliberate-fallback instruction.

### Deferred

- **DEF-039**: notification surface for `staleness-suppressed.txt` — currently invisible to user.
- **DEF-040**: intra-workflow blast_radius cache — defer until field data shows duplicate calls (audit observed 1 call, not duplicates).
- **DEF-041**: vendored vs upstream MCP capability matrix doc — pure documentation work.
- **DEF-042**: retry-with-backoff for transient graphify MCP failures.
- **DEF-036**: mandatory mcp-stats footer in `review.md` — still needs runtime sentinel design.
- **DEF-037**: `task_truncation_warn_bytes` calibration — 5 samples, need 20+ for distribution analysis.

## [0.54.0] - 2026-05-21

Two field-driven fixes closing concrete audit findings from greenfield-api PR-369 review (DEF-034, DEF-035). The third tactical finding (DEF-036, mandatory mcp-stats footer) needs more design work and stays deferred. Smoke: **556 passed**, **0 failed** (+2 new gates).

### Changed

- **`bin/modules/preflight.cjs` scope-hint cap is now tier-aware** (DEF-034). Replaced the hard-coded `MAX_SUGGESTED_READING = 8` with `SCOPE_HINT_CAP_BY_TIER = {TRIVIAL: 8, SIMPLE: 8, STANDARD: 15, COMPLEX: 25}`. A new `resolveScopeHintCap()` helper reads `.devt/state/workflow.yaml::tier` via upward filesystem walk (never throws — fallback is the default 8). Field-observed: the 8-item cap crowded out caller-set anchors on a 61-file COMPLEX-tier PR review; reviewers fell back to grep instead of the structured `<scope_hint>` payload. Default behavior (no workflow.yaml or malformed tier) is unchanged.
- **`workflows/code-review.md` args VERBATIM contract** (DEF-035). The "EXECUTE THE PLAN" section now opens with an explicit ARGS CONTRACT block: the `args` field in `graphify-impact-plan.json` is the single source of truth; orchestrator MUST use it verbatim — no symbol substitution, narrowing, or "anchor picking" at the call site. Field-observed: greenfield's session showed the orchestrator overriding `args.symbols` (the bash had written 22 diff-derived PascalCase declarations; the orchestrator hand-picked 7 different symbols instead). Each per-tier instruction now reinforces "VERBATIM" at the call site so the rule is unmissable.

### Added

- **`bin/modules/preflight.cjs::resolveScopeHintCap` + `SCOPE_HINT_CAP_BY_TIER`** — exported from preflight module for smoke testing and downstream callers. Tier is read lazily on every call (no caching) so resolveScopeHintCap reflects the current workflow state at the moment the Brief is built.
- **2 new smoke gates**: (1) `resolveScopeHintCap` returns tier-correct values across TRIVIAL/SIMPLE/STANDARD/COMPLEX + falls back to 8 on missing/malformed tier; (2) `code-review.md` contains all three load-bearing args-verbatim phrases (ARGS CONTRACT section, "args VERBATIM" per-tier reinforcement, "do not re-pick / do NOT substitute" prohibition).

### Deferred

- **DEF-036** — Mandatory `mcp-stats` footer in `review.md`. The bash block already exists at `workflows/code-review.md:388-407` and writes the "Graphify activity" line. Field-observed: orchestrator skipped the whole sub-block. The fix needs runtime gating (sentinel artifact + downstream assertion) rather than just prose strengthening, which is a meaningful design choice — moved to the next cycle.
- **DEF-037** — `task_truncation_warn_bytes` calibration awaits more samples (5 records currently, need 20+ for distribution analysis).

## [0.53.1] - 2026-05-21

Critical patch: all 3 Task-matcher hooks were silently no-op'ing in production. The DEF-031 diagnostic shipped uncommitted in v0.53.0 captured the smoking gun on its first greenfield Task dispatch — Claude Code's actual payload key is `tool_name: "Agent"`, not `"Task"`. The 3 hooks guarded on `=== 'Task'` and silent-exited on every real fire since they shipped (`dispatch-scope-guard` v0.43.0, `dispatch-hygiene-guard` v0.46.0, `task-truncation-detector` v0.51.0). 22 of 23 captured fires confirmed `tool_name='Agent'`. Smoke: **554 passed**, **0 failed** (+1 regression-catcher gate).

### Fixed

- **`hooks/dispatch-scope-guard.sh`, `hooks/dispatch-hygiene-guard.sh`, `hooks/task-truncation-detector.sh`** — `tool_name === 'Task'` guard now accepts both `'Task'` and `'Agent'`. The matcher `"Task"` in `hooks/hooks.json` is a platform-layer label; the actual payload carries `tool_name: "Agent"` for sub-agent dispatches. Backward-compat preserved for the `'Task'` variant. Effect: dispatch-scope-guard now actually flags oversized dispatches in production, dispatch-hygiene-guard now actually catches raw-dispatch violations, task-truncation-detector now actually writes `task_output_bytes` records.

### Removed

- **`hooks/task-truncation-detector.sh` diagnostic block** — the uncommitted v0.53.0 diagnostic that captured the root cause served its purpose and is removed. Net hook footprint identical to v0.51.0 plus the bug fix.

### Added

- **1 new smoke gate** — `Task-matcher hooks accept BOTH tool_name='Task' AND tool_name='Agent'`. Synthesizes the production payload (`tool_name='Agent'`) and asserts: task-truncation-detector writes a record, dispatch-hygiene-guard emits the raw-dispatch advisory. Backward-compat smoke for `tool_name='Task'` already exists in the existing gates.

## [0.53.0] - 2026-05-21

Same-day patch shipping three deeper field-validated fixes after v0.52.0's first greenfield run identified that two of the three v0.52.0 fixes landed mechanically but failed in the field. The validation cycle this release codifies: smoke-test fabricated environments are NOT a substitute for one real workflow run in a real project. Smoke: **553 passed**, **0 failed** (+4 new gates).

### Changed

- **`bin/modules/preflight.cjs::extractDiffSymbols`** — refactored to multi-range. v0.52.0 defaulted to `git diff --name-only HEAD` which only shows uncommitted changes. Field-observed in greenfield-api: PR-review on a `feature/` branch saw 0 files in `HEAD` (because PR commits were already merged into the branch) while `development...HEAD` showed the actual 43-file PR diff. v0.53.0 default: merge symbols from BOTH ranges (working tree AND `${primary_branch}...HEAD`), with `config.git.primary_branch` lazy-read from the project's devt config (default `"main"`). Explicit `opts.refRange` short-circuits to single-range, preserving smoke-test contract.
- **5 workflow staleness gates** (`code-review.md`, `debug.md`, `quick-implement.md`, `research-task.md`, `dev-workflow.md`) — converted the prose-only "In autonomous mode, force `scope_trust.trust='sparse'`" override into bash-mechanical logic. Field-observed: greenfield's PR-review session showed `scope_trust.trust='dense'` while the staleness condition (state=ready, lag_commits=null) had fired — a spec violation. Root cause: scope_trust was persisted via `state update` BEFORE the prose override could fire, and the orchestrator never re-issued the update. The bash block now reads `graphify.stale_threshold` from config, checks lag against threshold (treating null + ready as stale), rewrites SCOPE_TRUST with `trust='sparse'`, and writes `.devt/state/staleness-suppressed.txt` with the reason — all before the `state update` call.

### Added

- **`.devt/state/staleness-suppressed.txt`** — new canonical state artifact. Written by the 5 workflows whenever the mechanical staleness override fires. Contains a single line: `<ISO timestamp> — <reason>` where reason is either `lag_commits=null, state=ready (unreachable SHA / shallow clone)` or `lag_commits=N > stale_threshold=M`. Registered in `bin/modules/state.cjs::STATE_FILE_CONTRACT.additional_canonical`. RESET-eligible.
- **`extractDiffSymbols` config-driven primary branch resolution** — lazy require of `./config.cjs` inside the function (avoids load-time circular dep). Whitelist regex on refRange (`/^[A-Za-z0-9_./~^@-]{1,100}$/`) prevents shell escape on the three-dot syntax `${primary_branch}...HEAD`.
- **4 new smoke gates**: (1) multi-range extractor pulls PR-only commits (`development...HEAD`) when working tree is clean, (2) `opts.refRange='HEAD'` short-circuit preserves legacy single-range behavior, (3) all 5 staleness gates carry the mechanical override + suppression artifact write, (4) functional end-to-end — synthesized brief with state=ready + lag_commits=null triggers `trust='dense'→'sparse'` transition AND writes the artifact.

### Deferred

- **DEF-031 Part B hook still silently writes no records.** 14 fires across 2 days in greenfield, all `exit:0` with `stdout_bytes:0` and no entries in `dispatch-warnings.jsonl`. v0.53.0 ships an uncommitted diagnostic block on `hooks/task-truncation-detector.sh` that writes to `$PLUGIN_ROOT/.devt/state/task-truncation-debug.jsonl` capturing process.cwd, tool_name, hook_event_name, parse status, and raw payload preview. This will reveal the silent-exit branch on the next greenfield Task dispatch. Diagnostic is intentionally NOT committed (working-tree-only); root-cause fix lands in a future patch once data is captured.

## [0.52.0] - 2026-05-21

Three field-validated fixes from a greenfield-api PR-review audit (Bitbucket project, 4-parallel-reviewer dispatch on a 69-module blast radius). The audit produced a 12-finding meta-analysis with ranked P0/P1/P2/P3 recommendations. Validation against the actual codebase reclassified one P0 (the audit's proposed fix turned out to be wrong) and confirmed three others — those three ship here. Smoke: **549 passed**, **0 failed** (+4 new gates).

### Changed

- **`workflows/code-review.md` graphify tier ordering** — `symbol_anchored` now fires BEFORE `bulk_scoped` when topic symbols are present, regardless of scope size. The prior ordering (`bulk_scoped` first when file count ≥ impact_threshold + dense graph) silently demoted clean symbol-anchored signals to broad `query_graph` + 5×`get_neighbors` recipes on Bitbucket projects where PR-scoped diffs aren't available. Field-observed: the greenfield audit reported `query_graph` returning irrelevant test-fixture matches because the recipe favored breadth over the higher-precision blast_radius path that symbols would have unlocked.
- **`bin/modules/preflight.cjs::extractTopic`** — new `gitDiffSymbols` opt rank-merges declaration symbols extracted from the working-tree diff ABOVE PascalCase-on-text matches. Field-observed: greenfield's topic.symbols returned `["TR2"]` (a Jira ticket suffix) instead of real anchors `LicenseService`, `RBACService`, `ClientService` from the diff — collapsing the `symbol_anchored` tier into the coarser `bulk_scoped` path. Diff-symbol source is higher precision because it's grounded in code actually touched right now, not NLP on the task description.
- **Staleness gate across 5 workflows** (`code-review.md`, `debug.md`, `quick-implement.md`, `research-task.md`, `dev-workflow.md`) — `null` `lag_commits` no longer silently disables the prompt when `graph_stats.state` is `ready`. Field-observed: greenfield's graphify built_at_commit matched HEAD but `lag_commits=null` (unreachable SHA path), so the staleness gate's `null > threshold` check evaluated falsy and the gate never fired despite the graph being stale. New behavior: when state is ready AND lag is null (shallow clone, unreachable SHA, etc.), prompt with `{lag_commits ?? 'unknown'}` instead of silent skip. Skip-the-gate remains only when graphify is disabled.

### Added

- **`bin/modules/preflight.cjs::extractDiffSymbols`** — new function. Runs `git diff --name-only` against a ref (default `HEAD`), reads up to 30 changed files (≤50KB each), and pulls declaration symbols matching `class|function|interface|type|def|trait|struct|enum|fn <PascalCaseName>` (multi-language: JS/TS/Python/Go/Rust/Java/Kotlin/Ruby/PHP/C#/Swift/Vue/Svelte). Uses `execFileSync` (no shell — refRange whitelist-validated as defence-in-depth). Same `SYMBOL_DENYLIST` + `isAllCapsNoise` filters as the text extractor. Exported alongside `extractTopic` for downstream use and smoke testing.
- **`hooks/task-truncation-detector.sh` cleanup** — removed temporary diagnostic block that was added during the v0.51.0 silent-fire investigation. The 5 prior silent-exit events in greenfield were never reproduced (no Task dispatch fired in the subsequent greenfield session), but the diagnostic block was dead code on the working tree.
- **4 new smoke gates** for the field-validated fixes: (1) tier-ordering gate confirms `symbol_anchored` elif precedes `bulk_scoped` elif in `code-review.md`; (2) staleness-gate uniformity check across 5 workflows + legacy-phrase regression catcher; (3) preflight.cjs API surface check (`extractDiffSymbols` declared + exported, `gitDiffSymbols` opt threaded through `extractTopic`); (4) functional end-to-end — fabricate a tiny repo with `class LicenseService` + `interface ClientPayload`, run extractor, assert both symbols appear in `topic.symbols` ahead of any text-derived noise.

### Deferred

- **DEF-032** — mcp-trace upstream graphify call recording gap. The greenfield audit reported "mcp__graphify__* not captured in telemetry" and proposed a filter prefix change as the fix. Validation showed the filter at `bin/modules/mcp-stats.cjs:98-105` already supports both `mcp__graphify__*` and `mcp__devt-graphify__*` globs — the actual gap is at the recording side: only our vendored `bin/devt-graphify-mcp.cjs` and `bin/devt-memory-mcp.cjs` write to `_mcp-trace.jsonl`. Upstream MCP calls (to a server we don't control) bypass our recorders entirely. Architecturally correct fix is a PostToolUse hook on `mcp__*` matcher analogous to the v0.51.0 `task-truncation-detector.sh` — meaningful design work with three open questions (response capture scope, filter universality, deduplication with our own MCP servers).
- **DEF-033** — Smart tier auto-detection / explicit support for orchestrator-self-skip. Field observation: an LLM in a foreign project chose to skip devt orchestration entirely on a small task ("preflight/graphify/MCP harvests add noise without value here"). User confirmed this is desired behavior. Current state: tier system exists but auto-detection criteria are imprecise; the v0.51.0 graphify decision gate's skip-reason path IS the supported bypass but it's buried — most LLMs won't discover it. The fix is to make skip-on-trivial-task easy + discoverable (e.g., auto-detect single-file edits, doc-only changes, scratch refactors), not to remove the gate.

## [0.51.0] - 2026-05-20

Documentation restructure + two field-validated enforcement gates closing previously-invisible failure modes. CLAUDE.md grew to 61KB (above the 40KB harness warning, more than 2× the 27KB design baseline baked into `init.cjs::loadGoverningRules`). The Key Conventions section accounted for ~70% of the bloat by mixing three audiences — agent contracts, architecture rationale, implementation mechanics — in one list. Audience-based extraction separated the contract sentences (kept inline) from the rationale + mechanics (moved to `docs/`). The shrink propagates to per-dispatch prompt cost: `code-reviewer`, `verifier`, and `researcher` each shed ~35KB of governing_rules prefix per dispatch. Two enforcement gates added on top: greenfield-api forensics surfaced an orchestrator-skip pattern where the graphify decision step's "EXACTLY ONE artifact MUST exist" prose was never code-enforced — turned into a real `state assert-graphify-decision` gate that workflows STOP-with-BLOCKED on. A separate field report on a 3-sub-agent truncation cascade went through the `/devt:council` skill (5 advisors + 5 peer reviews + chairman synthesis); the verdict shipped mitigation #4 (tester JSON-first read) behind a deterministic `coverage_complete` rubric constraint that closes the silent-skip risk peer review unanimously named load-bearing. Smoke: **545 passed**, **0 failed** (+27 new gates).

### Changed

- **`CLAUDE.md`** — split from 60,979 B / 217 L to 21,834 B / ~230 L (−64%). Five new `docs/` files carry the extracted rationale + mechanics; CLAUDE.md becomes a contract sheet with `→ docs/X.md (Section)` pointers. Five critical contracts kept full-text inline (raw-dispatch ban, MCP boundary, single-dispatch contract, documentation discipline, comment discipline). Restores the 27 KB design baseline noted in `init.cjs:134` — `loadGoverningRules` now injects ~35 KB less per dispatch into the 3 READ-ONLY agents.
- **`docs/MEMORY.md`** — extended (+~6 KB) with Pre-Flight Brief JSON sidecar shape, tier-aware lane budget, verifier `<memory_signal>` cross-ref, `--signal` CLI mode.
- **`README.md`** — restructured (943 L → 862 L, −9%): `## Why devt?` hoisted from L266 to right after `## What is devt?`; Memory-layer deep-dive condensed from ~108 L to ~16 L + pointer to `docs/MEMORY.md`; `→ docs/X.md` pointers added to CLI tools / Hooks / Directory structure / Graphify sections.
- **`bin/modules/preflight.cjs::SYMBOL_DENYLIST`** — extended with 21 product/platform proper nouns (Bitbucket, GitHub, GitLab, Stripe, Notion, Linear, Slack, HubSpot, Salesforce, Discord, Confluence, JIRA, Trello, Asana, Intercom, Segment, Datadog, Sentry, PagerDuty, Cloudflare). The PascalCase symbol-extraction regex matched mixed-case platform names that survived `isAllCapsNoise` (which only catches ALL-CAPS tokens). Field-validated: greenfield's topic extractor produced `["Bitbucket"]` as the topic symbol on a PR-review task whose title contained "Bitbucket feature/X", crowding out real code identifiers and breaking the graphify scan-prep gate evaluation.
- **`workflows/code-review.md:142`** — removed documentation lie. Prior text cited a "verifier audit (line 257-267 below) checks this and emits caller-0 revision" — but L257-267 is the memory_signal cache read, not a caller-0 gate; `grep -r "caller-0"` returned only that single doc reference. Replaced with a real bash block calling `state assert-graphify-decision` and exit 1 on `ok:false`.
- **`workflows/quick-implement.md` + `workflows/dev-workflow.md`** — graphify_scan_prep gate SKIP branches now write `.devt/state/graphify-skip-reason.txt` as an explicit decision artifact (was: only echoed `graphify_scan_prep: SKIP` to stdout). Both workflows then call `state assert-graphify-decision` as a hard gate.
- **`agents/tester.md` (L32)** — JSON-first read of `impl-summary.json` (`files_changed` / `concerns[]` / `next_agent_hints.focus_areas` / `next_agent_hints.skip_areas`). `impl-summary.md` read becomes on-demand fallback (degraded-sidecar path: empty `focus_areas` AND non-empty `files_changed`, OR `concerns[]` referencing prose context not captured by structured fields). Mirrors the existing `<governing_rules>` / `<guardrails_inline>` inline-vs-disk pattern (`init.cjs:435,440`).
- **`workflows/quick-implement.md` + `workflows/dev-workflow.md`** — tester dispatch context now injects `<impl_summary_sidecar>` (primary) + `<impl_summary>` (fallback hint), keeping the two-tier read precedence visible at the dispatch site.

### Added

- **5 new `docs/` files** carrying the extracted CLAUDE.md content:
  - **`docs/AGENT-CONTRACTS.md`** (~250 L) — agent + workflow contracts (dispatch ordering, MCP boundary, scope hint/trust, JSON sidecar contract, sidecar-only routing, stub-first protocol, plugin agent registration, `devt:` namespace requirement, rejected sub-conversation JSON return pattern).
  - **`docs/INTERNALS.md`** (~315 L) — CLI module deep-dive, state mechanics, Skills Resolution (extracted), Agent IO Contracts (extracted), Workflow Mechanics, Governing Rules Wiring, Inline Guardrails Wiring, Deferred-Task Tracker, Plugin Internals, Templates, Scripts index (12 scripts).
  - **`docs/HOOKS.md`** (~165 L) — runner + profiles, universal invocation trace, Tier 2 Pre-Flight Guard, forensic deny log, bash safety, stuck-agent detector, dispatch-scope advisory, dispatch-hygiene guard, hook messaging budgets.
  - **`docs/GRADER.md`** (~155 L) — outcome-grader bounded retry, deterministic pre-verifier gate, rubric path resolution (3-layer + project-local escape hatch + friction note), pinned rubric versions, code-review grader 5 axes.
  - **`docs/GRAPHIFY.md`** (~150 L) — config + auto-detect on setup, universal stale-graphify eviction CLI, scan-prep orchestrator gate, post-impl refresh prompt, graph-impact map flow.
- **`bin/modules/state.cjs::assertGraphifyDecision`** + new `state assert-graphify-decision` CLI subcommand. Returns `{ok, graphify_state, reason?, file?}`. Auto-passes when graphify state is `disabled` or `graph_missing` (gate is about orchestrator obedience, not graphify install state). Fails on both-missing (orchestrator skipped context_init) and both-present (mutually exclusive violation). Uses lazy-require for `graphify.cjs` to break load-time circular dep.
- **`agents/tester.md` test-summary.json schema** — `coverage_files` (source files exercised, distinct from `test_files`) + `coverage_complete` (boolean computed by comparing `coverage_files` to upstream `impl-summary.json::files_changed`). The grader gates on `coverage_complete: true`; `false` short-circuits to a tester re-dispatch with missing files surfaced as `<review_feedback>` BEFORE the LLM verifier dispatches.
- **`references/rubrics/dev.v1.md::## Deterministic Gates`** — new `test-summary.json::coverage_complete: true` constraint. Catches the silent-skip failure mode where a JSON-first tester would loop over a truncated upstream `files_changed` and report `status=DONE` while testing nothing. Council verdict (DEF-030) explicitly required this gate land BEFORE the tester input-contract change.
- **`hooks/task-truncation-detector.sh`** — new PostToolUse hook on Task matcher (standard + full profiles). Emits one `dispatch-warnings.jsonl` record per Task call tagged `source: "task_output_bytes"` with the sub-agent's return byte count + `near_cliff` boolean (every call, not only crossings — keeps the calibration loop open). When bytes cross `telemetry.task_truncation_warn_bytes` (placeholder default **40000**), also surfaces a PostToolUse `additionalContext` advisory to the orchestrator nudging toward sidecar reads / tighter scope / Task splitting. Threshold is a placeholder until field data from greenfield lands — emitting on every call lets the post-hoc histogram tell us where the real cliff sits. Override via `.devt/config.json::telemetry.task_truncation_warn_bytes`. Never blocks. Kill switch: `DEVT_DISABLED_HOOKS=task-truncation-detector.sh`.
- **27 new smoke gates** across 5 themes: (1) Markdown pointer integrity — every `→ docs/X.md (Section)` in CLAUDE.md + docs/*.md must resolve to a real heading (catches anchor drift on rename); (2) Graphify decision gate — envelope shape, 3 workflows wired, 2 workflows write SKIP artifact, 3 platform nouns denylisted; (3) Tester coverage gates — `coverage_files` + `coverage_complete` emitted, semantics documented, rubric requires `coverage_complete: true`, grader rejects `coverage_complete: false` with explicit `gate_failures` entry; (4) Tester JSON-first read — agent body instructs JSON-first read, `.md` on-demand fallback documented, both tester dispatch sites inject `<impl_summary_sidecar>`; (5) Task truncation detector — file exists + executable, registered in hooks.json under PostToolUse Task matcher, registered in run-hook.js HOOK_PROFILES, low-byte path stays silent + writes `near_cliff:false` record, high-byte path emits advisory + writes `near_cliff:true` record.
- **`docs/` cross-references** (existing 3 + 5 new docs) — each new doc gains `↑ Entry point: CLAUDE.md` reverse pointer; MEMORY.md / COMMANDS.md / STATE-RULES.md gain a `## Cross-references` (or extended Related Documentation) section pointing to peer docs.

### Removed

- **`workflows/code-review.md:142`** "verifier audit (line 257-267 below) checks this and emits caller-0 revision" documentation lie. No `caller-0` code exists in the repo; the prose promised enforcement that was never implemented. Replaced with a real bash gate (see Changed).

### Fixed

- **Orchestrator silently skipped the graphify decision step in context_init** (field-reported by greenfield-api): the workflow's "EXACTLY ONE artifact MUST exist" prose was documentation-only. Orchestrators under context pressure skipped the entire bash block, leaving neither `graph-impact.md` nor `graphify-skip-reason.txt` written; the workflow completed `APPROVED_WITH_NOTES` with no record of the decision. The new `state assert-graphify-decision` CLI gate STOPs the workflow with BLOCKED when both artifacts are missing AND graphify state is `ready` — converting an invisible orchestrator-skip into a hard process failure.
- **Topic extractor over-broad PascalCase match** (field-reported): regex `\b[A-Z][a-zA-Z0-9]{2,}\b` matched platform names like `Bitbucket` in task titles. Surviving past `isAllCapsNoise` (which only catches ALL-CAPS), these crowded out real code symbols and broke the scan-prep gate's threshold evaluation. 21 product/platform proper nouns added to `SYMBOL_DENYLIST`.

### Council

- **DEF-030** — `/devt:council` deliberation on programmer-agent truncation cascade (greenfield 3-sub-agent truncation: programmer → continuation programmer → tester). 5 advisors (Contrarian / First Principles / Generalizer / Newcomer / Pragmatist) + 5 anonymized peer reviewers + chairman synthesis (opus). Verdict: ship mitigation #4 (tester JSON-first read of `impl-summary.json`) ONLY behind a deterministic `coverage_complete` gate that closes the silent-skip risk peer review unanimously named load-bearing. Defer mitigation #1 (split-and-merge — premature, N=1 + contract collision with filename-keyed `JSON_SIDECAR_SCHEMAS`) and mitigation #3 (file-by-file scope_hint — one mitigation at a time). Implementation shipped in 3 atomic commits with smoke between each. Full transcript: `.devt/state/council-programmer-truncation-mitigations-20260520-220034.md`. DEF-030 closed. Council-recommended parallel action **Part B** (`dispatch-warnings.jsonl` annotation on Task budget cliff) now shipped as `hooks/task-truncation-detector.sh` with a placeholder threshold + clear "calibrate via field data" follow-up (see Added). Part A (token-report run against captured greenfield trace to derive the real threshold) remains deferred — depends on data from greenfield-api, not implementable from devt repo. DEF-031 closed (Part B shipped + Part A explicitly scoped as field-validation work).

## [0.50.0] - 2026-05-20

Telemetry attribution + wildcard queries. Surfaced by greenfield-api's live `/devt:review` output: `Graphify activity: tier=bulk_scoped … | direct MCP calls during context_init: query_graph×3, blast_radius×1, get_neighbors×1 | telemetry trace: 0 entries captured (surface broken for this session)`. Deep probe revealed two distinct root causes that both manifested as the "0 entries captured" symptom: (a) `state.cjs::updateState` only stamped a fresh `workflow_id` on the false→true `active` transition, so a `/devt:review` running on top of an active `/devt:workflow` wrote trace records with the prior workflow's id; (b) `mcp-stats` filtered the `--tool` flag via literal string equality, but `workflows/code-review.md::present_findings` queries with the glob `mcp__devt-graphify__*` — always returning 0 entries. Smoke: **518 passed**, **0 failed** (+2 new gates).

### Changed

- **`bin/modules/state.cjs::updateState`** — snapshot `workflow_type` before the keyValues merge, then detect `workflow_type` change while `active=true` and stamp a fresh `workflow_id` + `created_at`. Closes the cross-workflow attribution leak where `/devt:review` (or any workflow_type switch) inherited the previous workflow's id, breaking telemetry filters, `/devt:forensics` analysis, and stuck-detector session boundaries.
- **`bin/modules/mcp-stats.cjs::loadEntries`** — `--tool` filter accepts glob patterns. Pattern containing `*` becomes an anchored regex (special regex chars escaped, `*` becomes `.*`); pattern without `*` stays exact-match. Cap input at 200 chars to prevent ReDoS on hostile patterns (real tool names are ≤80 chars). Behavior already assumed by `workflows/code-review.md::present_findings`, which has been querying with `mcp__devt-graphify__*` and silently receiving 0 results until now.

### Added

- **Two new smoke gates** under `== Telemetry attribution + wildcard queries ==`: workflow_id reset on workflow_type change (uses a temp .devt/state/, reads workflow_id before+after a type transition, asserts they differ), mcp-stats wildcard match (synthetic trace with 3 records, queries `mcp__devt-graphify__*`, asserts 2 matches).

### Context

- **Direct causal chain for greenfield's symptom**: `/devt:workflow` (May 15) set `active=true`, stamped `workflow_id=1b1855ad-…`. `/devt:review` (May 20) ran `state update active=true workflow_type=code_review …` — the existing logic preserved the prior `workflow_id`. `bin/devt-memory-mcp.cjs` correctly wrote 5 trace records with `workflow_id=1b1855ad-…`. `present_findings` then ran `mcp-stats --workflow-id=1b1855ad-… --tool=mcp__devt-graphify__*`. The workflow-id filter matched correctly, but the literal `mcp__devt-graphify__*` filter found zero tools named exactly that string — actual tool names are `mcp__devt-graphify__blast_radius` etc. Both fixes were needed; either alone wouldn't have closed the surface.
- **Items NOT in this release** (deferred to v0.51.0+): `preflight generate --from-state` (read review-scope.md/impl-summary.md file paths for symbol extraction), `memory_index_state` tri-state field, `dispatch-prep` CLI for substitution-as-tool. All validated as worthwhile; sized for separate releases.
- **Originally proposed v0.50.0 = 4 items** (`from-state` + tri-state + workflow_id reset + prefix normalization). Deep validation reframed `prefix normalization` as the actual wildcard-support gap (bigger UX win, no normalization needed — just glob support). Tightened to 2 items targeting greenfield's exact reported symptom; the larger 2 items (`from-state` + tri-state) ride a separate release for tighter blast radius per ship.

## [0.49.0] - 2026-05-20

Graphify integration completeness. Surfaced by greenfield-api field evidence on two consecutive days: (1) `/devt:workflow` and `/devt:implement` runs that should have benefited from graphify orchestration didn't — those workflows had no orchestrator-level MCP calls (only `/devt:review`, `/devt:debug`, `/devt:research` did); (2) stale graphify artifacts from prior `/devt:review` sessions persisted into unrelated `/devt:workflow` runs, producing cross-workflow contamination (PR-#367 sibling-context blast radius lingering during GFBUGS-133 license-details work); (3) the post-implementation graphify refresh defaulted to silent tip-only, so users had to remember to refresh manually. Four complementary changes close the integration gap end-to-end. Smoke: **516 passed**, **0 failed** (+7 new gates, 2 updated old gates).

### Added

- **`state evict-graphify` CLI** in `bin/modules/state-audit.cjs` — universal eviction primitive for the four graphify artifacts (`graphify-impact-plan.json`, `graph-impact.md`, `graphify-skip-reason.txt`, `pr-impact.md`). Single source of truth replaces per-workflow inline `rm -f` blocks. Supports `--dry-run` and `--max-age-minutes=N` (mtime gate for concurrent-workflow preservation). All five graphify-touching workflows (`code-review`, `debug`, `research-task`, `quick-implement`, `dev-workflow`) call it in `context_init` before regenerating; the CLI is also the recommended path for manual cleanup.
- **`graphify_scan_prep` gate** in `workflows/quick-implement.md` and `workflows/dev-workflow.md` context_init — bash decision tree that reads `preflight-brief.json::blast.direct_dependents_count` + `graph_stats.trust` + `topic.symbols[]` and decides whether to instruct the orchestrator to call `mcp__devt-graphify__get_neighbors` + `mcp__devt-graphify__blast_radius` for fresh `graph-impact.md` data. Field-validated threshold: `direct_dependents_count >= 10 AND trust == "dense" AND symbols non-empty`. Below the threshold (or graphify disabled): skip; agents fall back to grep + `scope_hint`. Greenfield field measurement: ~30-40% scan-phase token savings on STANDARD/COMPLEX tasks meeting the threshold, plus reverse-dependency coverage grep can't match (OpenAPI examples, hurl assertions, MODULE.md mentions, test fixtures).
- **Three-option AskUserQuestion for post-impl graphify refresh** in `workflows/quick-implement.md` and `workflows/dev-workflow.md` — when `config.graphify.auto_refresh_post_impl == "ask"` (new default), the workflow prompts: (1) **Refresh now (recommended)** — runs `graphify maybe-refresh --force --timeout=60`; (2) **Skip — I'll refresh manually later** — emits the `💡` tip; (3) **Always auto-refresh for this project** — runs refresh AND writes `auto_refresh_post_impl: true` to `.devt/config.json` so future workflows skip the prompt. Existing `true`/`false` values still supported (autonomous flows force silent; explicit `false` keeps tip-only).
- **Seven new smoke gates** under `== Graphify integration completeness ==`: evict-graphify CLI envelope shape, all 5 workflows call eviction, scan_prep gate present in both impl workflows, scan_prep specifies both required MCP calls, extractTopic filters ALL-CAPS noise without breaking mixed-case identifiers, config default for refresh-control accepts valid values, both workflows handle the "ask" branch with 3-option prompt.

### Changed

- **`config.cjs::DEFAULTS.graphify.auto_refresh_post_impl`** default changed from `false` (tip-only) to `"ask"` (user prompted each workflow). Accepts string `"ask"` OR boolean `true`/`false` — workflow prose branches on all three values. Rationale: tip-only was easy to miss, especially when users wanted to keep graphify fresh but hadn't discovered the config knob. The interactive prompt makes freshness explicit; the "Always auto-refresh" option lets power users opt into silent refresh after experiencing the prompt once.
- **`bin/modules/preflight.cjs::extractTopic` symbol filter** — extended `SYMBOL_DENYLIST` with common doc/spec filenames (`readme`, `changelog`, `license`, `notice`, `authors`, `maintainers`, `module(s)`, `package(s)`, `openapi`, `swagger`, `graphql`, `restful`, `sdk`, `mvp`) and added `isAllCapsNoise()` heuristic that filters tokens ≥4 chars containing no lowercase letters (catches `CHANGELOG`, `MODULE`, `GFBUGS`, project issue prefixes like `JIRA-NNN`, `ENG-NNN`). Mixed-case identifiers like `DeviceSummary`, `LicenseDetailResponse`, `PushNotificationRepositoryInterface` keep flowing through. Greenfield's 9 noisy symbols (with `CHANGELOG`, `GFBUGS`, `MODULE`, `OpenAPI`) reduce to 5 real code identifiers. Used by `graphify_scan_prep` to pick a reliable central symbol for `get_neighbors` queries.
- **2 obsolete smoke gates updated** to match the new architecture: the auto_refresh_post_impl default check (was pinned to `false`, now accepts the valid-value enum); the code-review.md eviction check (was looking for the literal `rm -f` line, now looks for the `state evict-graphify` CLI call).

### Context

- **Field-validated threshold rule** for `graphify_scan_prep` (greenfield-api forensic): "Graphify scan-time queries are net-positive when **task spans ≥2 service modules AND blast radius ≥10 direct dependents AND graph trust is dense**." `direct_dependents_count >= 10` is the practical proxy for cross-module work; below it, the 2-3k tokens per MCP call is overkill. The bash gate enforces all three conditions; the orchestrator only runs MCP calls when ACTIVE is printed.
- **What's NOT in this release** (deferred): adding `graphify_scan_prep` to `debug.md` and `research-task.md` — those workflows have sub-agent-only dispatch (no scan-then-implement pattern), so the scan-prep step doesn't naturally fit. They get the eviction fix (so their state stays clean) but rely on `<scope_hint>` from the preflight Brief for graphify signal. Future release could add a similar pre-dispatch step.
- **Cumulative impact**: combined with v0.48.0 hook-overhead minimization (~4.5k saved/session) and v0.47.0 workflow-loading recovery (no longer leaks workflows into nothingness), a typical `/devt:workflow` session on a STANDARD task should now save ~10-15k tokens vs the v0.46.0 baseline, with strictly improved coverage (reverse-deps caught) and freshness (graph updated post-impl).

## [0.48.0] - 2026-05-19

Hook-overhead minimization. Surfaced by greenfield-api's self-assessment: every Edit, every UserPromptSubmit, every Read-after-touched-file pays a token tax from the broader memory/preflight integration. Deep audit identified five hook-message and gating improvements that preserve quality protection while cutting per-fire token cost. No functionality removed; every hook keeps its quality role, the messaging just becomes right-sized. Estimated net saving: **~4,500 tokens per active dev session.** Smoke: **509 passed**, **0 failed** (+5 new gates, +1 updated gate to match new compact format).

### Changed

- **`hooks/pre-flight-guard.sh`** — two improvements. (1) Exit silently when `workflow.yaml` exists but `active=false`. Prior implementation only checked file existence, so completed workflows left the guard firing on every Edit indefinitely (state.cjs never deletes workflow.yaml on completion — it sets `active=false`). (2) Compacted the deny/warn message from ~150 tokens to ~35 tokens. The compact message preserves the load-bearing recovery cue (literal `PREFLIGHT <ts> edit <path> :: <ADR-ids|ungoverned>` format hint + `ungoverned` escape keyword) so agents without the memory-pre-flight skill loaded — e.g., raw-dispatched agents that bypassed the workflow — can still recover from the message alone. Verbose protocol re-explanation removed; agents with the skill loaded already know the protocol from their system prompt.
- **`hooks/workflow-context-injector.sh`** — two improvements. (1) Compacted the active-workflow context line: `[devt] STANDARD · implement (iter 2) [autonomous, tdd] · "task..."` (~80 tokens) → `[devt] STANDARD/implement·i2·auto+tdd · "task..."` (~50 tokens). The line is human-facing only (no programmatic consumer — validated via codebase grep), so compactness wins without breaking contracts. (2) Removed the idle-state context line. Prior implementation emitted `[devt] idle · last: <phase> · "<task>"` on every UserPromptSubmit when `active=false` but `phase` was set — pinning idle context into every prompt long after workflow completion. `/devt:status` and `/devt:next` provide explicit resume paths; the implicit per-prompt reminder is pure overhead.
- **`hooks/read-before-edit-guard.sh`** — compacted the reminder from ~80 tokens to ~25 tokens. The hook duplicates the CC harness's own read-before-edit enforcement; the advisory is a preemptive reminder, not a guard. Compact form: `Reminder: if "X" has not been Read in this session, Read it first — the runtime requires it before Edit.` Verbose form removed.

### Added

- **Five new smoke gates** under `== Hook-overhead minimization ==`: read-before-edit compact reminder (byte budget), workflow-context-injector compact active line format, workflow-context-injector silent on idle, pre-flight-guard silent on active=false, pre-flight-guard compact warn message with format hint + `ungoverned` escape preserved.

### Context

- **What's NOT in this release** (intentionally deferred):
    - **Directory-level PREFLIGHT coverage** (would let one PREFLIGHT line cover edits to multiple files under a directory). Investigated, but `skills/memory-pre-flight/SKILL.md` documents the protocol as PER-FILE — loosening it would be a spec change, not just an optimization. Requires a `/devt:council` decision before encoding.
    - **PostToolUse:Read recent-Read tracking** (would eliminate read-before-edit false-positives when agent just-Read the file). Race-condition risk with the existing async PostToolUse hooks; the simpler compact-message fix in this release captures most of the win without the new hook.
    - **Memory-auto-index incremental updates** (full FTS5 rebuild replaced with single-doc index). Already debounced at 5s; the marginal complexity isn't worth the wall-time saving for this release.
- **Where the actual token cost goes** (full attribution, audited from greenfield-api field data): claude-mem's PreToolUse:Read injection (~300-700 tokens per Read on touched files) is the dominant per-edit cost and not under devt's control. devt's per-edit contribution after this release is ~25 tokens (read-before-edit reminder) + 0-35 tokens (compact preflight warn when triggered). The "Security Guidance" UserPromptSubmit injection (~470 tokens/turn observed in field) comes from an external/global hook, not devt.

## [0.47.0] - 2026-05-19

Workflow contract recovery. Surfaced by a live greenfield-api forensic run that proved the Wave 1-4 graphify integration was systemically bypassed: the slash command's `@${CLAUDE_PLUGIN_ROOT}/workflows/<name>.md` reference does not deterministically inline the workflow body into the orchestrator's context, sub-agents have no `mcp__*graphify*` tool grant yet their bodies + dispatch templates instructed MCP calls, stale `.devt/state/graphify-impact-plan.json` from prior sessions silently masked context_init skipping, and `hooks/dispatch-hygiene-guard.sh` smoke-passes in isolation but provides no trace evidence of whether the CC harness actually invokes it in production. Five aligned failures, four direct fixes + universal hook trace logging. Smoke: **504 passed**, **0 failed** (+5 net new gates, 3 obsolete gates updated to match new architecture).

### Added

- **Explicit `Read` of the workflow body in every command that `@`-references a workflow file** — 32 of the 35 commands updated (`cancel-workflow`, `council`, `help` have inline bodies and are unaffected). Each `<process>` block now begins: "Mandatory first action: read `${CLAUDE_PLUGIN_ROOT}/workflows/<name>.md` via the Read tool before any other action." Belt-and-suspenders with the existing `@`-reference — even if the harness happens to inline `@`-references reliably in some sessions, the explicit Read makes the workflow body deterministically present in context. Assertive `<process>` prose also forbids skipping `context_init` and dispatching `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, `<memory_signal>` blocks.
- **Universal hook invocation trace** in `hooks/run-hook.js` — every hook dispatch (enabled, disabled, or spawn-failed) appends one JSON record to `.devt/state/hook-trace/run-hook.jsonl` with `{ts, script, profile, enabled, stdin_bytes, stdout_bytes, stderr_bytes, exit, reason?}`. Bypasses every per-hook ad-hoc logging pattern; one place to instrument, observability for all 11+ hooks. Kill switch: `DEVT_HOOK_TRACE=0`. Trace file is the diagnostic source-of-truth for "did the CC harness actually invoke this hook?" — without it, a silent no-op hook (as observed in greenfield) is indistinguishable from a fired-but-conditions-not-met hook.
- **Stale-artifact eviction in `workflows/code-review.md` context_init** — targeted `rm -f` of `graphify-impact-plan.json`, `graph-impact.md`, `graphify-skip-reason.txt`, `pr-impact.md` before the impact-plan bash regeneration step. Never touches `impl-summary.md`, `test-summary.md`, etc. that a review may legitimately consume from a prior workflow phase. Eliminates the failure mode where pass-N inherits pass-(N-1)'s artifacts and the orchestrator's skip of context_init is invisible.
- **Five new smoke gates** under `== Workflow contract enforcement ==`: every `@`-ref command also instructs an explicit Read; no agent body instructs MCP graphify calls (sub-agents are consume-only); `workflows/code-review.md` evicts stale graphify artifacts before regen; `run-hook.js` writes the trace record on every invocation; `dispatch-hygiene-guard.sh` emits the advisory when invoked via `run-hook.js` (production path, not just bash-direct — closes the smoke-vs-prod gap that hid the greenfield silence).

### Changed

- **Sub-agent bodies + workflow dispatch task blocks no longer instruct `mcp__*graphify*` calls.** The architecture is orchestrator-as-MCP-caller, sub-agent-as-file-consumer. The orchestrator owns MCP via `context_init` bash; sub-agents read `.devt/state/graph-impact.md` produced from those calls. Affected: `agents/code-reviewer.md` (removed the "Direct MCP access for caller verification" paragraph + the entire `caller_verification` step with its `### finding-N` block format), `workflows/code-review.md` (rewrote code-reviewer + verifier `<task>` blocks to instruct read-only consumption of `graph-impact.md`), `workflows/debug.md` + `workflows/research-task.md` (removed the "Graphify-first protocol" paragraphs from their dispatch prompts — the debugger and researcher agents have no MCP tool grant). Sub-agents in those three workflows still receive the `<scope_hint>` block (graphify-derived blast radius from preflight Brief) — they lose direct MCP autonomy but keep the indirect graphify signal.
- **Three obsolete smoke gates updated** to match the new architecture: the gate that previously required `mcp__devt-graphify__` references in `code-reviewer.md` now requires their absence (with `graph-impact.md` Read still required); the gates for `caller_verification` step + `Caller Verification` section + `caller-0` revision id were removed (feature deferred for re-implementation via orchestrator-generated data); the "Graphify-first protocol directive" gate replaced with a dead-signature absence check (`Graphify-first discovery protocol`, `PROACTIVELY` strings must NOT appear in the 3 affected workflows).

### Context

- **What's still missing (deferred to a future release)**: `workflows/dev-workflow.md` and `workflows/quick-implement.md` do NOT call graphify MCP from the orchestrator — they get graphify only indirectly via `scope_hint` from the preflight Brief. Adding orchestrator-level graphify orchestration to those workflows is a design decision (what's the impact-plan tier for "implement X" vs "review PR #N"?) and outside emergency scope. The deferred caller-verification feature is also pending re-implementation via orchestrator-generated data instead of dead sub-agent MCP calls.
- **Field validation**: greenfield-api ran a live `/devt:review` mid-implementation that visibly executed the workflow's `context_init` step (preflight generate ran with structured output, impact plan bash block ran). Before Fix #1, the same session bypassed `context_init` entirely, inheriting pass-9's stale artifacts. The pre/post contrast was the strongest signal that the workflow body was not previously reaching the orchestrator.

## [0.46.0] - 2026-05-19

Wave 5 — defense against rogue orchestration. Closes the failure mode surfaced by greenfield-api pass-9 evidence where the orchestrator dispatched 6 parallel `devt:code-reviewer` agents via raw `Task()` calls bypassing `/devt:review` entirely. All Wave 1-4 protections (Graphify-first directive, impact-plan, caller_verification, telemetry) live INSIDE workflow dispatch templates — when the orchestrator skips the workflow, every integration silently strips and agents fall back to grep-first defaults. Three layers of defense added; none of them block — they advise + log + degrade-explicitly. Smoke: **501 passed**, **0 failed** (+7 new gates over v0.45.1 baseline).

### Added

- **`hooks/dispatch-hygiene-guard.sh`** — PreToolUse hook on `Task` tool calls. Fires only when `subagent_type` matches `devt:*` AND the prompt lacks ALL of `<scope_trust>`, `<scope_hint>`, `<memory_signal>` (forgiving heuristic — ANY one counts as workflow-managed). Emits an advisory `additionalContext` block surfaced to the orchestrator + appends one JSONL record to `.devt/state/dispatch-warnings.jsonl` tagged `source: "raw_dispatch"` for `/devt:forensics` post-hoc analysis. Never blocks the dispatch. Registered in `hooks/hooks.json` under the existing Task matcher alongside `dispatch-scope-guard.sh`; profile coverage `standard + full` via `hooks/run-hook.js`. Kill switch: `DEVT_DISABLED_HOOKS=dispatch-hygiene-guard.sh`.
- **`workflow_context_assertion` execution step** in `agents/code-reviewer.md` — HARD GATE before any other work. Inspects the dispatch task prompt; if ALL THREE context blocks are missing, writes `.devt/state/review.md` + `review.json` with `status=BLOCKED`, `verdict=NEEDS_WORK`, `score=0`, and one Critical finding pointing at the raw dispatch with remediation: "Orchestrator should re-dispatch via `/devt:review`." Refuses to produce a shallow review — silently producing one would perpetuate the failure mode this assertion exists to surface. Sidecar carries `reason: "raw_dispatch_no_workflow_context"` for programmatic detection.
- **`CLAUDE.md` "Never raw-dispatch devt agents" rule** — explicit guidance that orchestrators MUST route through devt slash commands (`/devt:review`, `/devt:workflow`, `/devt:implement`, `/devt:debug`, `/devt:research`). Documents the defense-in-depth chain: hook advisory → agent assertion → BLOCKED review. Also documents the "bolt graphify onto fan-out" recovery pattern surfaced in greenfield-api pass-9 for legitimate parallel-review use cases: run `/devt:review` once to compute the bash plan + graph-impact map, then re-dispatch sliced reviewers manually with `<scope_trust>` + `<scope_hint>` + graph-impact reference injected per prompt.
- **Seven new smoke gates**: hook file exists + executable; hook registered in `hooks.json` under PreToolUse Task matcher; hook declared in `run-hook.js` profile registry; functional test that raw dispatch triggers advisory; functional test that workflow-managed dispatch stays silent; agent body carries `workflow_context_assertion` step + emits `raw_dispatch_no_workflow_context` reason; CLAUDE.md amendment present.

### Context

This wave addresses a class of failure Wave 4 didn't catch. Wave 4 fixed "orchestrator skipping a step inside a workflow" via the bash-computed impact plan + hard gate. Wave 5 fixes "orchestrator skipping the entire workflow" — a categorically different problem where there is no workflow execution at all and therefore no inside-the-workflow protections fire. The greenfield-api pass-9 evidence was textbook: the orchestrator, asked for "multi-agent parallel split," interpreted that as "hand-roll 6 Task() calls" instead of "run /devt:review with parallelism baked into the workflow." Zero `mcp__devt-graphify__*` trace calls landed during that ~3-hour fan-out, exactly because no workflow injected the Graphify-first directive into the sub-agent prompts. Wave 5's hook + agent assertion + CLAUDE.md guidance form a three-layer defense so this class of failure surfaces at dispatch time, agent-start time, AND project-doc reading time.

## [0.45.1] - 2026-05-19

Smoke-gate patch: the negative-path assertion for `memory_index_missing` assumed the local FTS5 index existed before the test ran. CI's clean checkout has no `.devt/memory/index.db` (it's gitignored), so the negative path ran preflight against a missing index, the sidecar correctly emitted `memory_index_missing=true`, and the gate failed with a false-positive "false positive" failure. No runtime behavior changed — purely a test-setup fix.

### Fixed

- `scripts/smoke-test.sh`: precreate the FTS5 index via `node bin/devt-tools.cjs memory init` before the negative-path preflight when `.devt/memory/index.db` is absent. Clean up the precreated index after the assertion so the test is idempotent on developer machines (the index is gitignored, so this only matters for tidiness). Smoke now passes both in local environments where the index exists AND in fresh CI checkouts. Verified via `rm -f .devt/memory/index.db && bash scripts/smoke-test.sh` → 494/0.

## [0.45.0] - 2026-05-19

Graphify integration deepening — Waves 1-4 of a 6-wave plan that takes devt's graphify usage from "scope-hint backdrop signal" to "agents actively query the graph mid-dispatch." Wave 1 makes graphify reachable from agents (vendored MCP relay, layered impact trigger, staleness gate). Wave 2 makes them actually USE it (Graphify-first dispatch directive, per-finding caller verification, `get_community` tool, wiki-first reading). Wave 3 closes the freshness/feedback loop (`maybe-refresh` + `write-memory` CLIs, post-impl refresh suggestion, lesson-extraction `graphify_feedback` step). Wave 4 closes the orchestrator-opt-out gap surfaced in greenfield-api evidence (bash-computed `graphify-impact-plan.json`, Bitbucket-aware routing, "Graphify activity" telemetry in present_findings). Plus two adjacent bundles: **`/devt:init` completeness** (auto `memory init`, first-graph-build prompt, claude-mem detection, verify_and_report extension) and the **`.devt/state/` directory contract** (`STATE_FILE_CONTRACT` declaration, `state audit` + `state cleanup` CLIs, static `check-state-contract.cjs` enforcer, `docs/STATE-RULES.md` authoritative spec). Smoke: **494 passed**, **0 failed** (+33 new gates from v0.44.0 baseline).

### Added — `/devt:init` completeness fixes (was: documented but unimplemented)

Closes the regression where `commands/init.md` documented "the wizard sets up the memory layer" but `workflows/project-init.md` never actually ran the command — users finished `/devt:init` with empty `.devt/memory/index.db` and silently degraded preflight lanes. Three new steps + claude-mem detection + verify_and_report extensions.

- **`init_memory_index` step** in `workflows/project-init.md` between `run_setup` and `prompt_graphify_setup`. Automatically runs `node bin/devt-tools.cjs memory init` so the FTS5 index exists from the moment init finishes. Idempotent. Surfaces a tip about the discovery pipeline + `_suggestions.md` + curator promotion flow so users know how to populate ADRs/CONs going forward.
- **`prompt_graphify_first_build` step** in `workflows/project-init.md` — when graphify is enabled but `graphify-out/graph.json` doesn't exist, offers to run the first build inline. Without this, graphify-enabled projects sit with `graph_stats.trust = "empty"` until the user remembers to build manually — and downstream agents fall back to grep-first discovery exactly as the user observed before Wave 2.
- **`prompt_claude_mem_setup` step** in `workflows/project-init.md` — detects claude-mem CLI presence; surfaces install command (`/plugin install claude-mem` via the plugin marketplace) when absent; confirms integration is live when present. Without claude-mem, devt's harvest pool is strictly smaller (no cross-session ⚖️/🔵 observations). Users had no way to discover the dependency before this step.
- **`verify_and_report` step** extended to check `.devt/memory/index.db` (FTS5 index present) and `graphify-out/graph.json` (only when graphify is enabled). Previously passed even when the memory layer was broken.
- **`success_criteria`** updated to require `index.db` and conditionally require graphify graph. Init now truly succeeds = project is fully usable.
- **`commands/init.md` doc** corrected to match what the wizard actually does (was making the promise; now describes the implementation).
- **Five new smoke gates** locking the new contract: `init_memory_index` step present + calls `memory init`; `prompt_graphify_first_build` step present; `verify_and_report` covers index.db AND graphify graph; success_criteria requires index.db; `prompt_claude_mem_setup` step present + calls `command -v claude-mem`.

### Added — graphify integration Wave 3

- **`bin/modules/graphify.cjs::maybeRefresh(options)`** — conditionally refresh the project graph by subprocess-shelling `graphify update .`. Returns a structured envelope (`{ok, action, reason?, duration_ms?, lag_commits?}`) — no throws. Skip reasons: `disabled` (graphify off), `graph_missing` (no graph.json — first build must be deliberate), `fresh` (lag within threshold), `timeout` (subprocess hit the wall), `graphify_not_installed` (ENOENT). Compares `freshness().lag_commits` against `config.graphify.stale_threshold` (default 30); `--force` bypasses the freshness check. Subprocess is bounded by `options.timeout` (default 60s, minimum 5s). Designed to be called silently by workflows pre-preflight without polluting visible prompt.
- **`bin/modules/graphify.cjs::writeMemoryEntry(payload)`** — write a workflow Q&A summary to `graphify-out/memory/<workflow_id>.md` for graphify's memory feedback loop. On the next `graphify update .` run, graphify re-extracts these files into the project graph — closing the loop so the graph learns from what devt's agents discovered. Validates `workflow_id` against `/^[A-Za-z0-9_-]+$/` BEFORE any other gate (security-relevant args rejected unconditionally) + `path.basename()` belt-and-suspenders before string-concat path assembly. Caps refs at 50, summary at 50KB, task at 1KB. Returns `{ok, action: "written"|"skip", path?, reason?}` — never throws.
- **Two new CLI subcommands** in `bin/modules/graphify.cjs::run()`: `graphify maybe-refresh [--timeout=N] [--force]` and `graphify write-memory --workflow-id <id> [--workflow-type t] [--task text] [--summary text] [--references=a,b,c]`. Both emit structured JSON for orchestrators to consume; `write-memory` exits 1 on validation rejection so smoke tests can lock the security contract.
- **Post-implementation graphify refresh suggestion** in `workflows/dev-workflow.md` and `workflows/quick-implement.md`. After the implementation phase writes new code (`impl-summary.json::files_modified` non-empty), the orchestrator branches on `config.graphify.auto_refresh_post_impl` (default `false`): when `true` (or autonomous mode), silently calls `maybe-refresh --force` and surfaces a one-line confirmation; default surfaces a `💡 Code changes made — run graphify update .` tip to the user. Skipped entirely when graphify is disabled or `files_modified` is empty. Closes the gap where new code lands but downstream review/debug agents work against a stale graph.
- **`graphify_feedback` step** in `workflows/lesson-extraction.md` between `reindex` and `report`. Calls `graphify write-memory` with the workflow's `workflow_id`, `workflow_type`, `task`, summary (from `curation-summary.md`), and `references` (from `preflight-brief.json::topic.symbols`). Best-effort — never blocks the workflow. Trace lands in `.devt/memory/_mcp-trace.jsonl` for `/devt:forensics`. Activates the upstream graphify memory feedback loop devt previously left unused.
- **`graphify.auto_refresh_post_impl` config default** (`false`) in `bin/modules/config.cjs::DEFAULTS.graphify`. Documented inline.
- **Eight new smoke gates**: `maybeRefresh`+`writeMemoryEntry` exports; `maybe-refresh` CLI returns valid envelope; `write-memory` CLI surfaces usage on missing arg; `write-memory` CLI returns valid envelope on valid args; **security gate**: `write-memory` rejects path-traversal `workflow_id`; `auto_refresh_post_impl=false` default in config; post-impl refresh directive present in dev-workflow + quick-implement; `graphify_feedback` step + `graphify write-memory` call present in lesson-extraction.

### Added — graphify integration Wave 2

- **`bin/modules/graphify.cjs::getCommunity(communityId, options)`** — new wrapper exposing the upstream `get_community` MCP capability. Reads `graph.json`'s per-node `community: <int>` attribute (written by graphify's Leiden clustering step), filters and returns members sorted by degree desc, capped at `options.limit` (default 50, max 200). Same `{source, results, degraded?}` envelope as the other read wrappers. Use case: when graph-impact.md surfaces affected communities, the reviewer can enumerate the other files in that cluster to scope follow-up checks. Validated against greenfield-api's real graph (38,932 nodes, 3,917 communities) — returns semantically coherent clusters like `[SQLModelDeviceRepository, DeviceService, StrEnum]` for community 4 (the device-management subgraph).
- **`get_community` MCP tool** in the vendored relay (`bin/devt-graphify-mcp.cjs`) — relay tool count grows from 9 → 10. Input schema accepts integer or stringified-integer community_id; returns degraded payload on `null`/`undefined`/non-numeric arg.
- **`caller_verification` step** added to `agents/code-reviewer.md` execution_flow between `score` and `summarize`. When `mcp__devt-graphify__status` returns `{state: "ready"}`, the reviewer emits a `## Caller Verification` section in review.md with structured `### finding-N` blocks for the top-5 Critical/Important findings (severity-ordered, capped at 5 for budget). Each block carries `Severity / File / Symbol / Callers checked / Risk / Notes` in a fixed format — the verifier reads this section as part of its grading and treats `Risk: High` entries as gap signals. Section is skipped entirely when graphify is disabled/graph_missing or there are zero Critical/Important findings.
- **Graphify-first dispatch directive** in `workflows/{code-review, debug, research-task}.md` task blocks — replaces passive "agents may use graphify" with active "USE graphify proactively, Grep/Read VALIDATES findings rather than discovers them." Each workflow's directive is tailored: code-reviewer emphasizes `query_graph → get_neighbors → blast_radius` for finding discovery; debugger emphasizes `query_graph → shortest_path → get_neighbors → blast_radius` for call-path tracing; researcher emphasizes `query_graph → god_nodes → get_neighbors` for pattern discovery. Empty/degraded responses are signals to fall back, not errors. Skipped when `scope_trust.trust == "empty"` (graphify unavailable). Closes the regression where agents had MCP access but worked grep-first because nothing told them otherwise.
- **Wiki-first reading** in `bin/modules/preflight.cjs::generate`: when `graphify-out/wiki/index.md` exists (project ran `graphify <path> --wiki`), the path is prepended to `suggested_reading` before `affects_paths` and `direct_dependents`. Agents land on the curated agent-crawlable navigation surface before raw source. Hidden behind `existsSync` — projects that never built a wiki see no change.
- **Verifier caller-verification audit** in `workflows/code-review.md` verifier dispatch: when review.md is missing the `## Caller Verification` section AND `graphify.status.state == "ready"`, the verifier emits a `caller-0` revision asking the reviewer to add it. When the section exists, the verifier validates per-finding `Risk: High` entries against the findings list and emits `caller-N` revisions when a High-risk caller set suggests tighter fix proposals.
- **Seven new smoke gates** covering: `graphify.cjs::getCommunity` export; relay exposes `get_community` tool; functional gate that `get_community` degrades gracefully on non-integer args; `caller_verification` step + `## Caller Verification` section format in code-reviewer.md; verifier dispatch validates the section presence (`caller-0` revision); wiki-first reading injection in preflight.cjs; graphify-first directive present in code-review/debug/research-task dispatch tasks.

### Added — graphify integration Wave 4 (orchestrator-imperative + Bitbucket-aware + telemetry surface)

Closes the gap surfaced by greenfield-api review evidence where the orchestrator knew the spec but skipped the explicit `get_pr_impact` call ("did not write .devt/state/graph-impact.md"). Prose-only steps don't bind the orchestrator; this wave converts the impact step into a contract.

- **Bash-computed `graphify-impact-plan.json`** in `workflows/code-review.md::context_init`: a bash block reads `config.git.provider`, parses PR number from `${REVIEW_SCOPE}`, checks `preflight-brief.json::graph_stats.{state,trust}` and `topic.symbols`, runs an explicit decision tree, and writes `.devt/state/graphify-impact-plan.json` carrying `{tier, tool, args, skip_reason?, git_provider}`. The orchestrator then has ONE imperative instruction — "EXECUTE THE PLAN" — instead of "run the first matching tier" prose it can skip past.
- **Bitbucket-aware routing**: the bash decision tree only fires PR-scoped tier when `git_provider == "github"`. Bitbucket / GitLab / unset providers route past the upstream `mcp__graphify__get_pr_impact` (which is GitHub-only and would silently fail with "PR not found on GitHub") directly to bulk-scoped or symbol-anchored tiers via the vendored relay. Closes the "graphify works on GitHub projects only" silent regression.
- **Hard gate**: after the EXECUTE THE PLAN step, **exactly one** of `.devt/state/graph-impact.md` OR `.devt/state/graphify-skip-reason.txt` MUST exist. The verifier audit checks this — when neither is present and `graphify.status == "ready"`, it emits a `caller-0` revision blocking workflow completion. Converts a soft "should write" into a contractual "must produce one of these two outputs."
- **`present_findings` telemetry surface** in `workflows/code-review.md`: at workflow completion, reads `.devt/memory/_mcp-trace.jsonl` filtered by the current `workflow_id` and surfaces a "Graphify activity" line in the user-visible report — per-tool call counts, separating vendored `mcp__devt-graphify__*` from upstream `mcp__graphify__*`. When `graphify-skip-reason.txt` exists, surfaces `Graphify activity: SKIPPED (plan=<tier>, reason: <reason>)`. Removes the "did the sub-agents use graphify?" uncertainty.
- **Contract registration**: `graphify-impact-plan.json` + `graphify-skip-reason.txt` added to `STATE_FILE_CONTRACT.additional_canonical`, locking them into the static check-state-contract enforcer.
- **Five new smoke gates**: imperative plan + EXECUTE THE PLAN directive present; bash branches on `git.provider == "github"`; hard gate "exactly one MUST exist" prose present; telemetry surface in present_findings calls `mcp-stats --workflow-id`; both new state filenames registered in the contract.

### Added — `.devt/state/` directory contract (strict + clear)

Closes the sprawl class greenfield-api accumulated: 76 files in `.devt/state/`, 10 of which were ad-hoc (`deep-cascade-*.md`, `validation-*.md`, `simplify-*.md`) with no devt-side mechanism to surface or clean them. The contract makes the rules explicit, the audit makes drift visible, and the static check blocks new agent code from extending the sprawl.

- **`STATE_FILE_CONTRACT` data declaration** in `bin/modules/state.cjs` — 30+ exact canonical filenames + 6 allowed regex patterns + 3 ephemeral patterns + `stale_days_default: 21` (3 weeks). Replaces the previous implicit contract (declared via ARTIFACT_SCHEMA + JSON_SIDECAR_SCHEMAS + JSON_INPUT_SCHEMAS + RESET_EXEMPT but with no unified enumeration).
- **`bin/modules/state-audit.cjs`** — sibling module providing `auditStateFiles()` and `cleanupStateFiles({dryRun, staleDays})`. The audit classifies every file in `.devt/state/` into 4 buckets (canonical / pattern_allowed / ephemeral / ad_hoc); cleanup archives ad_hoc + ephemeral always plus pattern_allowed older than `staleDays` (default 21) into `.devt/state/.archive/cleanup-<ts>/`. Cleanup is dry-run by default — must pass `--apply` for any move to happen.
- **`state audit` + `state cleanup` CLIs** wired into `bin/modules/state.cjs::run()`. Help text updated in `bin/devt-tools.cjs`.
- **`scripts/check-state-contract.cjs`** — strict static analyzer that scans every `agents/*.md` and `workflows/*.md` for `.devt/state/<filename>` references and verifies each one matches the contract. Exit 1 on any violation, printing `<source-file>: <violating-filename>`. Catches the regression where someone introduces a new ad-hoc filename in agent prose — the exact class of drift that produced the greenfield-api sprawl. Wired into smoke-test.sh as a STRICT gate.
- **`docs/STATE-RULES.md`** — ~200-line authoritative spec: 4-bucket classifier semantics, complete canonical inventory (every file documented with purpose + writer + status source), allowed-pattern regexes, ephemeral patterns, archival semantics, "the only legal procedure" for adding a new artifact, `state reset` vs `state cleanup` comparison table.
- **Default staleness 21 days** (was 14) — gives a 3-week grace window before pattern-allowed slug variants (review-pr*-slice-A.md etc.) become eligible for cleanup. Configurable via `STATE_FILE_CONTRACT.stale_days_default` or per-run `--stale-days=N` flag.
- **Eight new smoke gates**: `STATE_FILE_CONTRACT` exports both lists; `state-audit.cjs` exports both functions; CLI envelopes valid; `state cleanup` is dry-run by default (DESTRUCTIVE REGRESSION gate); isolated temp-fixture audit classifies all 4 buckets correctly; `stale_days_default == 21` (locks default at 3 weeks); strict static check passes on every workflow/agent reference; docs reference both source modules.

### Added — graphify integration Wave 1

- **`bin/devt-graphify-mcp.cjs`** — vendored read-only MCP relay (stdio, JSON-RPC 2.0) that re-exposes `bin/modules/graphify.cjs` wrapper functions as 9 MCP tools (`status`, `freshness`, `graph_stats`, `get_node`, `get_neighbors`, `shortest_path`, `query_graph`, `blast_radius`, `god_nodes`). Zero subprocess overhead — delegates directly to the wrappers' memoized loader cache. Graceful degradation: every tool returns `{degraded: true, fallback_trigger}` when graphify is disabled or `graph.json` is missing, never throws. Reuses the devt-memory MCP telemetry pattern: each call appends a JSONL trace record to `.devt/memory/_mcp-trace.jsonl` tagged `mcp__devt-graphify__<tool>`, carrying the active workflow's id/type/phase. Registered in `.mcp.json` alongside `devt-memory` so all plugin agents inherit the tool surface without per-agent frontmatter changes. `--self-test` flag exercises every tool with empty args to detect throw-paths.
- **Layered graphify impact-map trigger** in `workflows/code-review.md::context_init`: replaces the literal PR-number regex with four tiers — (1) PR-scoped via upstream `mcp__graphify__get_pr_impact`, (2) bulk-scoped (≥`graphify.impact_threshold` files AND `graph_stats.trust == "dense"`) via vendored `mcp__devt-graphify__query_graph` + `get_neighbors`, (3) symbol-anchored via vendored `mcp__devt-graphify__blast_radius` over `preflight-brief.json::topic.symbols`, (4) skip. Output written to `.devt/state/graph-impact.md` (renamed from `pr-impact.md`). Code-reviewer agent updated to Read the new filename and may now call `mcp__devt-graphify__get_neighbors` directly per Critical/Important finding for caller-set verification (capped at 5 calls/review for budget).
- **Staleness gate** directive in `workflows/{dev-workflow, code-review, debug, research-task, quick-implement}.md`: when `preflight-brief.json::staleness.lag_commits > graphify.stale_threshold` (default 30; configurable; `null` disables), the orchestrator prompts the user via AskUserQuestion before any agent dispatch — Refresh (recommended) / Proceed with stale graph / Cancel. Autonomous mode silently forces `scope_trust.trust = "sparse"` instead of prompting. Skipped when graphify is disabled or `lag_commits` is null.
- **`graphify.impact_threshold` and `graphify.stale_threshold` config defaults** in `bin/modules/config.cjs::DEFAULTS.graphify`: 10 and 30 respectively. Documented inline.
- **Memory-index-missing headline alert** in `bin/modules/preflight.cjs::renderBrief`: when `.devt/memory/index.db` is absent, the Brief renders a `> ⚠️ **Memory index not built**` blockquote immediately under the Status line with the exact remediation command. JSON sidecar grows a `memory_index_missing: bool` field for programmatic detection. Replaces the prior "silent empty lanes" failure mode where reviewers couldn't tell whether governance was empty because no docs existed or because the index hadn't been built.
- **Six new smoke gates**: `.mcp.json` registers `devt-graphify`; relay self-test runs clean; relay responds to stdio `initialize` + `tools/list` with `serverInfo` and `get_neighbors` + `blast_radius` tool defs; all 5 preflight-consuming workflows carry the Staleness gate directive; `config.cjs::DEFAULTS.graphify` exposes both new thresholds; preflight memory-alert positive AND negative paths verified (alert fires on missing index, suppressed when present).
- **Three rewritten smoke gates**: previously tested `pr-impact.md` + `get_pr_impact` literal strings; now test the layered trigger's full surface (`mcp__devt-graphify__*` refs + `graph-impact.md` persistence + community filter referencing the new filename).

### Fixed — graphify integration Wave 1

- `workflows/code-review.md::Memory layer integration` step 5: was citing the orchestrator's `mcp__graphify__get_pr_impact` payload as the source of `.devt/state/pr-impact.md`. Updated to `graph-impact.md` and acknowledges the three possible upstream sources (PR / bulk / symbol-anchored).

## [0.44.0] - 2026-05-18

Nine-commit wave layering four concerns on top of v0.43.0's graphify integration: alignment-drift cleanup, JSON-sidecar contract completion for the highest-traffic markdown-only artifact, memory-layer module split, and post-integration polish for graphify + claude-mem MCP routing. Two silent failure modes closed: `validateConsistency` was recording `NO_STATUS_LINE` warnings on every code-review verify-phase advance because `code-reviewer.md` emits `## Verdict` while `extractStatus()` only matched `## Status`; `loadGraph` silently degraded when `graph.json` exceeded the 100MB cap with no signal in `/devt:forensics`. One forensic-preservation gap closed: `dispatch-warnings.jsonl` was being deleted by `state reset` despite CLAUDE.md promising it survives. Plus the `claude-mem` harvest pre-step was routing to a tool that errors out for the canonical (worker-mode) install. Twelve new smoke gates added across the wave. Smoke: **454 passed**, **0 failed** (was 438 at the start of the wave).

### Added — alignment cleanup (a9ecfdf)

- **Documentation-discipline smoke gate** in `scripts/smoke-test.sh`: scans `agents/`, `workflows/`, `skills/`, and `docs/` for devt-internal version refs (`v0.X.Y` patterns and `since v[0-9]` markers), excluding `CHANGELOG.md` and `docs/superpowers/plans/` as legitimate historical homes. Catches the class of drift where version refs leak into source-of-truth surfaces despite the existing rule.
- **`RESET_EXEMPT` preservation smoke gate**: state-reset functional test asserts both `preflight-denies.jsonl` and `dispatch-warnings.jsonl` survive a reset, locking in the forensic-preservation contract.

### Fixed — alignment cleanup (a9ecfdf)

- `bin/modules/state.cjs::RESET_EXEMPT` now preserves `dispatch-warnings.jsonl` alongside `preflight-denies.jsonl`. The forensic-preservation claim for `/devt:forensics` already promised this; the implementation now honours it.
- `agents/retro.md` frontmatter adds `skills: []` for contract consistency with `agents/io-contracts.yaml` (where `retro.frontmatter_skills` already declared `[]`).
- `docs/MEMORY.md`: removed two devt-internal version refs (header note and multi-root prose), added `lesson` to the `doc_type` enum comment, deleted the empty `## Version Notes` section header.

### Added — review.json JSON sidecar (8dff301)

- **`review.json` sidecar** completes the JSON-sidecar contract for the highest-traffic markdown-only artifact. Joins the existing `impl-summary.json`, `test-summary.json`, and `verification.json`. Schema split mirrors `impl-summary`: `status ∈ {DONE, BLOCKED}` for workflow routing, `verdict ∈ {APPROVED, APPROVED_WITH_NOTES, NEEDS_WORK}` for the review outcome.
- **Wired end-to-end**: `bin/modules/state.cjs` (JSON_SIDECAR_SCHEMAS entry + SIDECAR_FOR_MARKDOWN mapping + review.md removed from ARTIFACT_SCHEMA), `agents/io-contracts.yaml` (`code-reviewer.outputs.sidecar = review.json`), `agents/code-reviewer.md` (stub-first protocol writing `review.json` first, finalizing with status+verdict+agent+score+counts+timestamp), `workflows/code-review.md` (artifact pre-gate requires both `.md` and `.json`), `workflows/next.md` (three review-routing branches now `state read-sidecar review.json` instead of text-matching the markdown).
- **Seven smoke gates** covering registry presence, mapping presence, ARTIFACT_SCHEMA absence, io-contracts declaration, agent emission, workflow consumption, and end-to-end schema validation of all three flags.

### Fixed — review.json JSON sidecar (8dff301)

- **Silent `extractStatus` warnings on `review.md` eliminated as side effect**. Before the sidecar wire, `validateConsistency` ran `extractStatus()` on `review.md`, which only matched `## Status` headings — but the code-reviewer template emits `## Verdict`. Every code-review verify-phase advance silently persisted `NO_STATUS_LINE` to `workflow.yaml::validation_warnings`. Sidecar routing via `SIDECAR_FOR_MARKDOWN` bypasses `extractStatus` entirely.
- **Generalized the ARTIFACT_SCHEMA drift gate** to recognize both "Status field is one of" and "Verdict field is one of" agent doc patterns, with the sidecar field-kind resolved from whichever matched. Prevents the same class of drift across all sidecar-routed artifacts going forward.

### Added — polish pass (867c005)

- **docs/COMMANDS.md scope_trust + graph_stats coverage** added in the preflight section. The JSON sidecar fields (`scope_hint`, `scope_trust`, `graph_stats`) were documented in CLAUDE.md (dev-facing) but absent from COMMANDS.md (user-facing). Three new paragraphs covering: sidecar shape, `<scope_trust>` dispatch signal semantics (low-confidence treatment when `trust ∈ {sparse, empty}` or `lag_commits > 10`), and `graph_stats` source.
- **End-to-end smoke gate for review.json sidecar routing**: constructs the exact scenario the silent bug occurred in (review.md without `## Status` heading, valid review.json) and asserts `state validate`'s JSON output contains no `review.md no_status_line` mismatch. Exercises the SIDECAR_FOR_MARKDOWN code path in `validateConsistency`, not just wiring presence.

### Fixed — polish pass (867c005)

- `agents/researcher.md` status pattern: template wrote `Status: DONE | ...` as plain text under `## Confidence` heading. `extractStatus()` only matches `## Status` headings, so the status line was unparseable. `research.md` is in `ARTIFACT_SCHEMA` and consumed by `workflows/dev-workflow.md`; misalignment was latent because `research` is not in `PHASE_ARTIFACT_MAP`, but adding research as a routed phase would have re-introduced the same silent-warning class fixed for `review.md`. Promoted to a proper `## Status` heading with block-form value.

### Changed — memory module split (af90cf0)

- **`bin/modules/memory.cjs` extracted into three files**. The 1884-line module was well past the 700-line informal threshold. Two clean extraction boundaries identified after dependency mapping:
  - **`bin/modules/memory-graph.cjs`** (135 lines): graph traversal over the `links` table — `getLinks`, `getSubgraphTriples`, `getBacklinks`, `findOrphans`, `findStaleLinks`. Only needs the DB handle, obtained via `withDb`.
  - **`bin/modules/memory-bundle.cjs`** (251 lines): portable JSON bundle export/import — `resolveExportPath`, `resolveImportPath`, `readDocFile`, `exportBundle`, `importBundle`. Uses parser/validation helpers from the core module.
  - **`bin/modules/memory.cjs`** (1576 lines, was 1884): everything else — paths, frontmatter parsing/validation, DB lifecycle, queries, `upsertDoc`, symbol validation, CLI dispatcher.
- **Lazy-require pattern** breaks the load-time circular dep: sub-modules `require("./memory.cjs")` inside function bodies, so memory.cjs's top-level require of the sub-modules resolves cleanly. Public API unchanged via re-exports; existing consumers (`devt-tools.cjs`, `devt-memory-mcp.cjs`, `discovery.cjs`, `preflight.cjs`, `health.cjs`) need zero call-site changes.
- **Four helpers now formally exported** from `memory.cjs` to support the sibling-module contract: `withDb`, `findProjectRoot`, `parseYamlSubset`, `serializeFrontmatter`. These are internal-but-shared utilities that sub-modules need; the export is the contract that lets them stay in their natural homes instead of being moved to a shared base module.
- Net: -308 lines from `memory.cjs` (-16%), +386 lines across two sibling modules, +78 lines total codebase (import boilerplate cost — acceptable tradeoff for module health).

### Fixed — claude-mem MCP harvest routing (26033b9)

- `claude-mem` harvest pre-step in three workflows (`dev-workflow.md`, `quick-implement.md`, `lesson-extraction.md`) was routing to `observation_search`, which requires `CLAUDE_MEM_RUNTIME=server-beta` and silently no-ops in the canonical worker-mode install. Re-targeted to `search` — the worker-mode equivalent exposed identically by both runtimes. Parsing instructions refined to extract only numeric-ID rows from the markdown index (the `search` tool returns observations + sessions + prompts under the same result count) and to map the emoji column (⚖️ → decision, 🔵 → discovery) to `obs_type`, dropping session-telemetry types that don't promote.
- Negative smoke gate added; existing positive harvest gate retargeted to the new tool name.

### Added — graphify polish (6ec5cf3 / 7d1f080 / 667f50b)

- **`loadGraph` size-cap forensic record** (6ec5cf3): when `graph.json` exceeds the 100MB cap, appends one JSONL record to `.devt/state/preflight-denies.jsonl` with `source="graph_loader"`, path, size, cap, and ISO timestamp. Per-process dedupe via a path set so one workflow that calls multiple graphify wrappers writes one record, not N. Skipping the full `readFileSync` on oversize files is a side benefit. Two new fixture-test assertions.
- **`graphify.godNodes()` public function** (7d1f080): `discovery.cjs::harvestGraphifyGodNodes` and `preflight.cjs`'s Cross-Cutting Concerns renderer were both reading god-nodes by regex-scraping `graphify-out/GRAPH_REPORT.md`. That path lags the actual graph because `graphify update` rewrites `graph.json` but leaves `GRAPH_REPORT.md` alone unless `cluster-only` also runs. The local `_topByDegree()` already computes god-nodes from `graph.json` adjacency with matching filters; wrapping it as a public `godNodes()` lets both consumers read live data. CLI: new `graphify god-nodes [--limit=N]` subcommand. Five new fixture-test assertions.
- **`docs/graphify-helpers/SKILL.md` MCP table aligned to v0.8.11** (667f50b): upstream graphify v0.8.11 ships 10 MCP tools; the skill's table listed 7 (pre-v0.8.8). Now lists all 10 (`query_graph`, `get_node`, `get_neighbors`, `shortest_path`, `god_nodes`, `get_community`, `graph_stats`, `get_pr_impact`, `list_prs`, `triage_prs`). Decision-tree step "Probe `graphify --help` -> exit 0?" was dead text (devt reads `graph.json` directly in-process); consolidated to `graphify status` which combines enabled-flag + `graph.json` existence in one call.

### Fixed — setup reinit reconcile (12860c3)

- `setup.cjs` MCP-scaffolding block consulted no mode flag; re-running setup with `--mode=reinit` refreshed `.devt/rules/` and `config.json` but left the graphify entry in `.mcp.json` pinned to whatever install method was first detected. A user who later installed `uv` after an initial `pip`-based setup would silently keep the suboptimal `python3` launch path.
- Extracts pure `reconcileMcpServers(existing, probed, mode)` helper that respects mode semantics: probed entry not present → add (any mode); probed entry present + `mode=reinit` + content differs → replace command + args, preserve user env keys (user keys win over probe env); probed entry present + `mode ∈ {create, update}` → leave untouched; identical entries under reinit → no-op; empty probed under reinit → no-op (no destructive removal).
- `files_updated` message now distinguishes "added X" from "reconciled X" so the user knows when an install-method delta just landed.
- Five new behavioral smoke gates inline in `smoke-test.sh` covering each branch of the mode semantics.

### Updated — documentation

- `CLAUDE.md` memory-module description updated to reflect the three-file split with sibling-module contract. Lists `bin/modules/memory-graph.cjs` and `bin/modules/memory-bundle.cjs` alongside the slimmed `memory.cjs` core.
- `docs/MEMORY.md` and `docs/COMMANDS.md` synced to the worker-mode `search` MCP tool. The Phase-1 fix (26033b9) updated the workflow prose and code comments but missed the user-facing docs, which were still describing the now-deprecated `observation_search` invocation. Memory-layer integration prose now reflects the actual harvest call path including the markdown row-type filtering the orchestrator performs.
- `scripts/smoke-test.sh` `observation_search` negative gate scope extended to include `docs/` (was `agents/workflows/skills/bin`) so future docs drift on this surface is caught at CI time.
- `README.md` sidecar paragraph updated from "Three artifacts" to "Four artifacts" with the new `review` sidecar's status/verdict split described inline.
- `CLAUDE.md` Topic Pre-Flight Brief stanza rewritten so the god-nodes path points at `graphify.godNodes()` (live `graph.json` adjacency, post-X-3 refactor) rather than the prior `parseReportSections()`-only description; SC + knowledge-gaps remain on the report-parse path.
- `CLAUDE.md` Forensic deny log stanza enumerates the new `"graph_loader"` source value alongside `"preflight"` / `"bash_destroy"` / `"no_verify"`, so the source-field enum matches what `loadGraph` now writes on `GRAPH_SIZE_CAP` exceedance.

## [0.43.0] - 2026-05-18

Eleven-commit wave addressing structural integration drift against upstream graphify and claude-mem. Three silent failure modes closed: graphify wrappers shelling out to subcommands with `--json` flags that don't exist upstream; code-reviewer never consuming `mcp__graphify__get_pr_impact` during PR reviews; `claude-mem mcp --db` invocation invalid against claude-mem v13 (produced "Unknown IDE: --db" error every Claude Code session). Two new agent signals added end-to-end: graph trust verdict + freshness lag in the preflight sidecar, with workflow caching + 7 agent body paragraphs implementing low-confidence treatment on sparse / stale graphs. One budget-protection mechanism: code-reviewer applies a community filter for large PR reviews when `pr-impact.md` is present, deferring out-of-community files to a follow-up dispatch. Smoke: **438 passed**, **0 failed** (was 427 at the start of the wave). Architectural through-line: devt's Node code never reaches into upstream MCP/CLI directly — file artifacts for Node, orchestrator-mediated MCP for agents, deletion when a path is unrecoverable.

Graphify wrapper migration to direct `graph.json` reads (`bin/modules/graphify.cjs`). Every structured-query call (`queryGraph`, `getNode`, `getNeighbors`, `shortestPath`, `blastRadius`) previously shelled out to `graphify query <text> --json` / `graphify query <sym> --neighbors --direction=... --depth=...` — flags that don't exist in upstream's CLI surface. Verified against `safishamsi/graphify` upstream source: the CLI accepts only `--dfs`/`--budget`/`--context`/`--graph` for `query`, and the MCP server's tool handlers return `types.TextContent(type="text", text=str)` blobs, not structured objects. Every call was silently triggering the grep fallback via `safeJsonParse` failure on non-JSON output. The migration replaces all 5 functions with pure-Node algorithms over the deterministic `graphify-out/graph.json` NetworkX node-link artifact (`{nodes, links/edges, hyperedges}`). One in-process tree walk replaces 2N subprocess spawns per `blastRadius` call. `status()` decoupled from binary presence — `state === "ready"` now depends only on `graphify.enabled` + `graph.json` exists, so projects with a checked-in or CI-built graph work without `graphify` on PATH. Smoke: **428 passed**, **0 failed** (+1 gate over the prior 427 baseline).

### Added (Phase A)

- **graph.json in-process reader** (`bin/modules/graphify.cjs::loadGraph`): memoized by `(path, mtimeMs)` so repeated calls within a workflow turn parse the file once. Builds `{out, inc, nodeMap}` adjacency maps for O(1) neighbor lookup. Handles both `links` (modern NetworkX `node_link_data(G, edges="links")`) and `edges` (legacy NetworkX) field names. Caps file size at 100 MB via `safeJsonParse`.
- **Pure-Node algorithms** for the 5 structured-query functions: substring/case-insensitive label+id resolution (`_resolveOne`, `_resolveMany`), direction-aware BFS (`_bfs` with `direction: in|out|both`, configurable `depth`), and directed shortest-path (BFS along outgoing edges only). `blastRadius` now walks depth-2 incoming in one tree traversal per symbol instead of issuing two subprocess calls per symbol.
- **`scripts/test-graphify.cjs`** (new, 16 assertions): fixture-based test runner matching the `scripts/test-locking.cjs` convention. Builds a 4-node / 4-edge NetworkX-format `graph.json` in a temp project and exercises every public function: `status` (ready/graph_missing/disabled paths) / `query` (exact/substring/empty) / `neighbors` (in/out/both/depth=2) / `path` (connected/no-route) / `blast-radius` (shape contract + direct dependent count) / legacy `edges` field name compatibility / graph-missing degradation. Wired into `scripts/smoke-test.sh` so CI runs it as part of the standard gate.

### Changed (Phase A)

- **`graphify.cjs::status()` no longer gates on binary presence**. Previously required `graphify --help` to exit 0 even though devt's read path never invokes the binary. State enum collapsed to `"ready" | "disabled" | "graph_missing"` (removed `"binary_missing"`). The graphify binary is still required to *generate* `graph.json` via `graphify update .`, but devt's consumption is now binary-independent. `probeBinary` is kept for `setup.cjs`'s MCP-server registration logic — that path legitimately needs to know whether the binary is installed.

### Removed (Phase A)

- **`callGraphify` subprocess wrapper**. The function passed `--json` and other flags that don't exist in upstream's CLI argparse — every invocation either returned `exit 2` ("unrecognized arguments") or non-JSON text that failed `safeJsonParse`. All structured-query operations now read `graph.json` directly. The export is gone from `module.exports`; no other module imported it.

### Added (Phase B-1 — PR-impact MCP wiring)

- **Orchestrator fetches `mcp__graphify__get_pr_impact` during code-review context_init** (`workflows/code-review.md`): when `REVIEW_SCOPE` mentions a PR number ("PR #N", "pull request N", or a PR arg), the orchestrator (main session, which has the project's MCP allowlist) calls the tool once and Writes the response verbatim to `.devt/state/pr-impact.md`. Skip-silently semantics — no PR number / no graphify MCP / call errors all proceed without the file, and the agent falls back to scope_hint + raw file list. The orchestrator pattern is necessary because the code-reviewer agent's allowlist is `Read, Bash, Glob, Grep` (no MCP), so the main session does the MCP fetch and the agent consumes the persisted file.
- **Code-reviewer agent Reads `.devt/state/pr-impact.md` when present** (`agents/code-reviewer.md::context_loading`): instructions to prioritize files in affected communities ahead of unrelated files in the scope list, and weight finding severity by structural impact rather than diff size alone. Graphify's structured map (files changed, communities affected, blast radius) is treated as authoritative for "what does this PR actually touch in the graph".
- **ADR Compliance section gains a PR-impact item** (both `workflows/code-review.md` and `agents/code-reviewer.md`): when reviewing a PR, the structured impact map is consulted alongside `memory affects` / `memory rejected-keywords` / `get_neighbors` so reviewers can weight findings by graph community rather than file count.
- **2 new smoke-test gates** that pin the wiring: workflow file references both `get_pr_impact` and `pr-impact.md`; agent file references both. Prevents silent regression if a future audit strips the guidance.

### Notes (Phase B-1)

- The companion MCP tools `mcp__graphify__list_prs` and `mcp__graphify__triage_prs` exist in upstream but apply to PR-selection ("which PR should I review next?"), not per-review work. They are deliberately not wired into this workflow — review-selection is a separate concern handled outside `/devt:review`.
- The fetch step does not write any tool name into Bash. The MCP call is a tool-use directive to the orchestrator (natural-language instruction), not a `mcp call` shell command — devt's Node code remains MCP-client-free per the architectural invariant from Phase A.

### Removed (Phase C-1 — broken claude-mem CLI integration)

- **`discovery.cjs::harvestClaudeMem` + `claudeMemAvailable`** removed entirely (~60 LOC). Modern claude-mem (v13.x) does not expose a `query` CLI command — its surface is `status / search <query> / mcp <ide> / install / repair / start / stop / restart / server / worker / adopt / cleanup / transcript`, all positional with no `--tags` or `--json` flags. devt's invocation `claude-mem query --tags decision,discovery --json` was returning exit 2 ("Unknown command") on every modern install. Source #1 of the discovery harvest has been silently producing `[]` for any user past the v13 upgrade.
- **Per-project `.mcp.json` scaffolding for claude-mem** removed from `setup.cjs::scaffoldProject`. The previous entry `{command: "claude-mem", args: ["mcp", "--db", ".claude-mem/mem.db"]}` is doubly wrong: `claude-mem mcp` is an IDE-installer subcommand that takes an IDE identifier (`claude-code`, `cursor`, etc.) — not flags. The scaffolded entry triggered an "Unknown IDE: --db" error on every Claude Code session for users with both devt and claude-mem installed. Modern claude-mem self-registers as a Claude Code plugin (its package.json declares `plugin/.mcp.json` + `plugin/.claude-plugin`), so per-project registration is also redundant.
- **`.claude-mem/mem.db` entry** removed from the `setup.cjs` `.gitignore` scaffold. Modern claude-mem uses `~/.claude-mem/` (per-user) for its database; the per-project path is upstream-obsolete.
- **`discovery claude-mem-status` CLI subcommand** removed from `bin/devt-tools.cjs` + `bin/modules/discovery.cjs::run` dispatcher. It probed a capability that has no consumer.
- **Documentation cleanup**: 24 references to "claude-mem ⚖️/🔵 harvest" / "claude-mem absent" / "claude-mem timeout" across `workflows/dev-workflow.md`, `workflows/quick-implement.md`, `workflows/lesson-extraction.md`, `workflows/memory-promote.md`, `workflows/uninstall.md`, `agents/curator.md`, and the JSDoc/comment sites in `bin/modules/discovery.cjs` + `bin/modules/memory.cjs`. Replaced with accurate descriptions of the remaining 3 sources (`#KNOWLEDGE-CANDIDATE` scratchpad tags, `.devt/state/decisions.md` DEC-xxx entries, Graphify god-nodes when available).
- **Stale smoke gate** ("discovery claude-mem-status returns boolean") removed. It exercised the deleted CLI subcommand.

### Added (Phase C-1)

- **2 smoke gates** that pin the removal: `discovery.cjs` MUST NOT `spawnSync("claude-mem"...)`; `setup.cjs` MUST NOT scaffold a `claude-mem` MCP entry with `--db` or `"mcp"` args. Prevents future regressions where someone re-adds the broken shellout.
- An explanatory comment in `setup.cjs` documenting why the per-project claude-mem entry is intentionally absent: *"claude-mem v13+ self-registers as a Claude Code plugin under ~/.claude/plugins/ — no per-project entry needed."*

### Notes (Phase C-1)

- This wave is **strict deletion of broken code**. It removes 24 false documentation claims, eliminates session-startup errors for users with both devt and claude-mem installed, and aligns the codebase with upstream claude-mem v13.x reality. No new feature is added — Phase C-2 (orchestrator-pattern MCP fetch via `mcp__plugin_claude-mem_mcp-search__*`) is deferred as a separate wave.
- Net code delta: -132 lines (deletions dominate) across 10 files. Net smoke gates: +1 (added 2 deletion gates, removed 1 stale capability gate).
- Existing projects with the broken `.mcp.json` claude-mem entry will continue to see the "Unknown IDE: --db" error until they re-run `node bin/devt-tools.cjs setup --mode update` or manually edit. `setup.cjs` update mode preserves user-customized server entries; we did not add a force-overwrite migration because some users may have hand-edited their `.mcp.json` to a working invocation. Document the manual fix in release notes.

### Added (Phase C-2 — claude-mem MCP harvest replacement)

- **`discovery.cjs::harvestClaudeMemFromMcp`** — new harvest source #4. Reads `.devt/state/claude-mem-harvest.md` (a canonical markdown file populated by the workflow orchestrator) and emits `{tag, title, body, source: "claude-mem-mcp"}` candidates into `allCandidates`. Filters to `obs_type ∈ {decision, discovery}` — the only two promotion-eligible categories per upstream claude-mem v13's 6-value enum (the other four — `bugfix`, `feature`, `refactor`, `change` — are session telemetry, not memory candidates).
- **Orchestrator pre-harvest step in 3 workflows** (`workflows/dev-workflow.md::harvest_observations`, `workflows/quick-implement.md::harvest_observations`, `workflows/lesson-extraction.md::harvest_observations`): if `mcp__plugin_claude-mem_mcp-search__observation_search` is available, the orchestrator (main Claude session, which carries the project's MCP allowlist) calls it with the workflow task as query (`limit=50`), parses the response, and Writes one observation per line to `.devt/state/claude-mem-harvest.md` in the canonical format `- [decision|discovery] <title>: <body>`. Skip-silently semantics: missing MCP tool / errors / empty response all proceed without the file. This mirrors the Phase B-1 PR-impact orchestrator pattern — devt's Node code stays MCP-client-free per the architectural invariant.
- **Curator agent body** (`agents/curator.md::context_loading`) re-references claude-mem as a `_suggestions.md` source, but with the new label "claude-mem MCP observations when the claude-mem plugin is installed" — clarifying that this is the modern MCP path, not the obsolete CLI shellout.
- **3 new smoke gates** (Phase C-2 section): (1) `discovery.cjs` references `harvestClaudeMemFromMcp` + `claude-mem-harvest.md`, (2) all 3 workflows carry the `mcp__plugin_claude-mem_mcp-search__observation_search` instruction, (3) a functional end-to-end test: a synthetic harvest file with `[decision] / [discovery] / [bugfix]` lines flows into `_suggestions.md` with bugfix filtered out and the other two promoted.

### Notes (Phase C-2)

- **The line-format choice is intentional**: orchestrator writes structured markdown (`- [type] title: body`) rather than raw JSON. This keeps `claude-mem-harvest.md` human-readable (same as `_suggestions.md`), lets devt-side parsing stay a regex one-liner, and avoids the "what's the exact shape of `observation_search`'s response" question that would couple devt to upstream's JSON schema. The orchestrator parses the MCP response and writes the canonical format.
- **C-2 restores the claude-mem signal source that C-1 removed**, via the correct interface. Net feature parity with the pre-C-1 design intent, but built on the actually-working surface (`mcp__plugin_claude-mem_mcp-search__observation_search`) rather than the never-existed CLI shellout.
- Net code delta: +56 / -0 lines across 5 files. Smoke: 434 passed, 0 failed (+3 over the 431 Phase C-1 baseline).

### Added (Phase B-2 — graph_stats trust gate + freshness in scope_hint sidecar)

- **`graphify.cjs::graphStats()`**: new Node-side computation over the Phase A loader cache. Returns `{state, node_count, edge_count, density, trust}` where `trust ∈ {empty, sparse, dense}` per a simple heuristic — empty when 0 nodes, sparse when `node_count < 50` OR `density < 1`, dense otherwise. Reuses the memoized graph.json parse (O(1) after first call). Returns `{state: "not_ready", trust: "empty"}` gracefully when graphify is disabled or graph.json is absent.
- **`graph_stats` and `staleness` fields in `.devt/state/preflight-brief.json`**: every `preflight generate` now populates the sidecar with the new trust signal AND the existing `freshness()` output (built_at, head, lag_commits, fresh flag). Agents reading the sidecar via `<scope_hint>` injection or direct read can de-weight blast-radius signals on sparse graphs and de-weight derived findings when the graph is N commits stale. Backward-compatible — existing consumers see the new fields without disruption.
- **`graphify stats` CLI subcommand** (`node bin/devt-tools.cjs graphify stats`): user-facing diagnostic that emits the JSON output of `graphStats()`. Useful when triaging "why is graphify not helping" — surfaces node/edge counts and the trust verdict.
- **3 new graphStats fixture tests** in `scripts/test-graphify.cjs` (sparse path with 4-node fixture, empty path with no graph.json, dense path with synthetic 60-node graph at density=2). Total fixture count: 19.
- **1 new smoke gate**: preflight sidecar must include both `graph_stats.trust` (enum) and `staleness.fresh` (boolean). Prevents silent regression of the trust+freshness signals.

### Notes (Phase B-2)

- **Trust thresholds are heuristic, not declarative**: 50 nodes / density 1 are reasonable defaults for a typical OOP/imperative codebase. Projects with unusual graph shapes (graph DBs, declarative configs) may legitimately have lower density and still be useful. The trust verdict is advisory — workflows decide whether to act on it; sidecar consumers can override.
- **`staleness` data is copied verbatim from `freshness()`** — no new graphify queries. `freshness()` already does an 8KB header read + one `git rev-parse` call per preflight; adding it to the sidecar is free.
- This phase consolidates the "Phase A loader as in-process graph engine" pattern: trust signals are now Node-side computations over `graph.json` directly, with no GRAPH_REPORT.md regex dependency and no graphify CLI shellout.
- Net code delta: +90 / -3 across 4 files (graphify.cjs, preflight.cjs, scripts/test-graphify.cjs, scripts/smoke-test.sh). Smoke: 435 passed, 0 failed.

### Changed (Phase X-3 — blastRadius god-node detection via degree-sort)

- **`graphify.cjs::blastRadius` no longer regex-scrapes `graphify-out/GRAPH_REPORT.md`** for god-node detection. The prior implementation read the report, sliced the "## God Nodes" section, and ran an XOR-pattern word-boundary scan to detect whether any seed symbol appeared in the section. The XOR scan was cross-validated (48/48 parity per prior soak telemetry) but coupled blastRadius to GRAPH_REPORT.md's text format AND required the report to exist (a separate graphify generation step from `graph.json`).
- **New approach**: direct degree-sort over the Phase A loader's adjacency cache via `_topByDegree(adj, n=10)`. Mirrors upstream `graphify/analyze.py::god_nodes()` definition exactly — top-N by degree, with file-level hubs, method stubs, concept nodes, and JSON-key noise filtered out per the upstream predicates (`_is_file_node`, `_is_concept_node`, `_is_json_key_node`). Now works when `graph.json` exists even if `GRAPH_REPORT.md` hasn't been regenerated.
- **Net code change**: removed 27-line XOR scan + GRAPH_REPORT.md read; added 75-line filter+degree-sort helper. Slight LOC increase, but the new path is testable in fixtures (no report file dependency) and more authoritative (degree IS what defines god-nodes, not report-text presence).

### Added (Phase X-3)

- **2 new fixture tests** in `scripts/test-graphify.cjs`: positive (real god-node by degree → `god_node_match: true`) and filter (file-named hub with high degree → must be excluded per upstream's `_is_file_node`). Total fixture count: 21.
- **`_JSON_NOISE_LABELS`** constant in `graphify.cjs` — the exact 20-label set from upstream `graphify/analyze.py::_JSON_NOISE_LABELS` (`start`, `end`, `name`, `id`, `type`, `properties`, `value`, `key`, `data`, `items`, `title`, `description`, `version`, plus the 7 npm dependency-array keys). Used by `_isJsonKeyNode` to suppress structural JSON noise from god-node candidates.

### Notes (Phase X-3)

- **`parseReportSections()` is intentionally NOT migrated**. It returns three sections from `GRAPH_REPORT.md` — god-nodes (could be degree-sorted) plus surprising-connections + knowledge-gaps (LLM-derived insights with NO in-graph equivalent — must stay regex-scraped). Mixing sources would be inconsistent for the agents that consume Cross-Cutting Concerns; keeping `parseReportSections` whole means agents see report-derived data uniformly, and `blastRadius` gets the degree-sort path for its single seed-symbol check.
- **Filter parity verified against upstream source** (`graphify/analyze.py:3627-3742` and `:3672-3691`). Ports `_is_file_node` (basename match + method-stub pattern + isolated function pattern), `_is_concept_node` (empty source_file OR no file extension), `_is_json_key_node` (json source_file + noise-label list). The smoke gate proves that a high-degree file-named hub IS filtered out of the god-node set.
- Net code delta: +75 / -27 across 2 files (graphify.cjs, scripts/test-graphify.cjs). Smoke: 435 passed, 0 failed (smoke count unchanged — new fixture assertions are inside the existing "graphify fixture tests" gate).

### Added (Phase B-3 — scope_trust consumer adoption)

- **`<scope_trust>` dispatch tag** injected alongside `<scope_hint>` across all 5 dispatch-emitting workflows (`workflows/dev-workflow.md`, `workflows/code-review.md`, `workflows/quick-implement.md`, `workflows/debug.md`, `workflows/research-task.md`). Cached once at context_init from `preflight-brief.json::graph_stats.trust` + `staleness.lag_commits` + `staleness.fresh`, stored in `workflow.yaml::scope_trust_json`. Orchestrator-prep steps now read both `scope_hint_json` and `scope_trust_json` from a single `state read` call.
- **Agent-body "Scope trust signal" paragraph** added to all 7 dev agents that consume `<scope_hint>` (programmer, tester, code-reviewer, verifier, researcher, architect, debugger). Common shape: *"Treat `<scope_hint>` as low-confidence when `trust === "sparse"` or `"empty"`, OR when `lag_commits` is non-null AND > 10. In low-trust mode, [agent-specific fallback]."* Each agent's fallback is tailored to its role (programmer leans on impl-summary, tester on impl-summary file list, code-reviewer on review-scope, verifier on acceptance criteria, researcher broadens Glob/Grep, architect weights scan-results.md + CLAUDE.md, debugger trusts stack trace + reproduction).
- **2 new smoke gates**: (1) all 5 workflows reference `scope_trust_json`, (2) all 7 dev agents carry the "Scope trust signal" paragraph. Prevents silent regression of the signal wiring.

### Notes (Phase B-3)

- **Threshold choice — `lag_commits > 10`** is heuristic. A graph 10 commits behind HEAD typically still reflects current structure well enough; past that, blast-radius paths start carrying false positives (renamed symbols, deleted files). Projects with low-velocity code may comfortably raise the threshold; high-velocity teams may lower it. The agent guidance is advisory, not enforcing — agents Read the actual files regardless.
- **`graph_stats.trust === "empty"` is the most actionable signal**: it means graphify hasn't run, the graph is missing, or generation failed. Agents in low-trust mode skip scope_hint entirely and fall through to fresh exploration. This is the primary mode for projects without graphify installed (which is the default in `setup.cjs` since graphify is optional).
- **Pattern coupling**: this phase couples 5 workflows + 7 agents but does it uniformly — same caching bash, same dispatch tag, same agent paragraph structure. Future changes to the trust schema need to ripple across both layers; the smoke gates pin the wiring.
- Net code delta: +27 / -5 across 12 files (5 workflows, 7 agents, smoke-test). Smoke: 437 passed, 0 failed (+2 over the 435 Phase X-3 baseline).

### Added (Phase A test gap — malformed graph.json fixtures)

- **3 new fixture tests** in `scripts/test-graphify.cjs` covering the Phase A loader's degradation paths: (1) **invalid JSON** in `graph.json` — `safeJsonParse` returns `ok:false`, loader emits `{source: "grep", degraded: true, reason: "parse failed: ..."}`. (2) **Empty schema** — `graph.json` is valid JSON but has no `nodes`/`links` keys; loader defaults to empty arrays, `queryGraph` returns `{source: "grep", results: [], fallback_trigger: "empty"}`. (3) **Schema mismatch** — `links` is a string instead of an array; loader's `Array.isArray()` guards prevent `.map`/`for...of` crashes, returns empty results.
- **`setupFixture({graphRaw})` option** for fixture tests that need to write raw bytes (e.g. malformed JSON) instead of `JSON.stringify(graph)`. Pure-Node test util change, no production impact.
- Total fixture count: 24 (was 21). Smoke gate label updated to `"24 assertions over ... degraded / malformed-JSON"`.

### Notes (Phase A test gap)

- This closes the last remaining item from this investigation arc — all 7 prior phases shipped and the degradation paths of the Phase A loader are now fixture-covered. The tests assert the *contract* (`source: "grep"`, `degraded: true`, parse-failed reason surfaced) rather than the internal error format, so future hardening of `safeJsonParse` or `loadGraph` won't churn the tests.
- Net code delta: +47 / -1 across 2 files (test-graphify.cjs, smoke-test.sh). Smoke: 437 passed, 0 failed (count unchanged — new fixture assertions are inside the bundled "graphify fixture tests" gate).

### Added (Phase B-4 — community-aware scope narrowing for code-reviewer)

- **Code-reviewer agent applies a community filter for large PR reviews** (`agents/code-reviewer.md::context_loading` step 8). When `.devt/state/pr-impact.md` carries a non-empty `affected_communities` list AND the review-scope file count exceeds 10, the agent restricts its initial-pass deep review to files in those communities only. Files outside the affected communities are listed in an `## Out-of-Scope Files (Deferred)` section of `review.md` with `<path> — deferred (outside community: <names>)`. The orchestrator can dispatch a follow-up review for the deferred set if needed.
- **Rationale**: a single code-reviewer dispatch has a finite turn budget. Without scope narrowing, deeply reviewing 30+ files exhausts the budget before findings can be written — the failure mode observed in the PR #367 Style review retry. The community filter converts the B-1 PR-impact data from a "prioritization hint" (advisory) into an "initial-pass restriction" (enforcing), keeping the dispatch within budget and surfacing the highest-leverage findings first.
- **1 new smoke gate**: agent body references "Community filter for large reviews" AND "Out-of-Scope Files (Deferred)". Prevents silent regression of the scope-narrowing mechanism.

### Notes (Phase B-4)

- **Threshold of 10 files is heuristic**: chosen to be conservative — most small PRs review fully without deferral; only larger PRs trip the community filter. A future phase could make this threshold configurable via `.devt/config.json::review.community_filter_threshold` if projects with different baseline PR sizes want to tune it.
- **The mechanism is agent-side, not orchestrator-side**: the agent makes the deferral decision based on data it reads from `pr-impact.md`. This keeps the orchestrator's dispatch logic simple — the workflow keeps invoking one code-reviewer dispatch with the full review-scope, and the agent decides which subset to deep-review. The deferred files surface in `review.md` so the user can choose to dispatch a follow-up if needed.
- **B-4 closes the architectural loop on PR review budget exhaustion**: B-1 wired the PR-impact MCP data; B-4 makes the agent use it as a filter. Together they convert "5 parallel code-reviewer agents reading every file in PR #367" into "5 parallel agents each reviewing files in their community subset" — fits in budget, structurally aware.
- Net code delta: +9 / -1 across 2 files. Smoke: 438 passed, 0 failed (+1 over the 437 Phase A test gap baseline).

---

Pre-Flight Brief JSON sidecar + `<scope_hint>` dispatch injection + advisory dispatch-scope guard hook. The Brief data plane already carried governing docs' `affects_paths` and blast-radius `direct_dependents` paths — the markdown surface rendered the dependent count but not the paths themselves, and there was no machine-readable interface for orchestrators. This wave surfaces those paths as a deduped `suggested_reading` array (capped at 8) in both the markdown (new `## Suggested Reading Set` section) and a new `preflight-brief.json` sidecar. Five workflows cache the array at context_init and inject it as a `<scope_hint>` block into 11+ dispatch sites so subagents start with high-signal paths instead of discovering scope from the task description. The companion PreToolUse hook on `Task` warns (advisory, never blocks) when a dispatch prompt or scope_hint count exceeds the configurable cap, with forensic appends to `.devt/state/dispatch-warnings.jsonl`. Smoke: **427 passed**, **0 failed** (was 401/401 baseline; +26 gates added for new surfaces).

### Added

- **`preflight-brief.json` sidecar** (`bin/modules/preflight.cjs::generate`): every `preflight generate` writes `.devt/state/preflight-brief.json` alongside the markdown via `atomicWriteJsonSync`. Shape: `{status, topic, governing_ids, suggested_reading, blast: {effect_size, source, direct_dependents_count}, rej_keyword_matches, generated_at}`. The deterministic interface workflows consume via `jq` for scope_hint injection — no more markdown-regex parsing.
- **`## Suggested Reading Set (auto-derived)` section in the Brief markdown**: when `suggested_reading` is non-empty, renders between Blast Radius and Cross-Cutting Concerns. Omitted entirely when empty (graceful — agents fall back to normal discovery).
- **`memory.cjs::getAffectsPathsByIds(ids[])`**: batch SQLite query (single `IN (?, ?, …)` round trip) for `affects.pattern` projection across a governing-union doc-ID list. Avoids N×`getDoc` round trips when only the path projection is needed for preflight aggregation.
- **`<scope_hint>` dispatch tag** injected into 11+ Task dispatches across `dev-workflow.md`, `quick-implement.md`, `code-review.md`, `debug.md`, `research-task.md`. Covered agents: programmer (dev/quick), tester (dev/quick), code-reviewer (dev/quick/code-review), verifier (dev/code-review), researcher (dev/research), architect (dev ×2), debugger. Cached once at context_init from `preflight-brief.json::suggested_reading`, stored in `workflow.yaml::scope_hint_json`. The 3 dispatches that already had a `memory_signal` orchestrator-prep step now read both values from a single `state read` call (one subprocess instead of two per dispatch).
- **Agent body "Scope hint preferred over discovery" paragraph** added to programmer.md, tester.md, code-reviewer.md, verifier.md, researcher.md, architect.md, debugger.md. Mirrors the memory_signal pattern: parse the JSON array, read those paths FIRST during investigation, fall back to discovery when the array is empty.
- **`hooks/dispatch-scope-guard.sh`** (NEW, ~110 LOC): PreToolUse matcher on `Task` tool. Reads the dispatch prompt, measures byte size, parses any `<scope_hint>` block. Emits advisory `additionalContext` to the orchestrator when either threshold exceeds the configurable cap. Appends one JSONL record to `.devt/state/dispatch-warnings.jsonl` (`source: "dispatch_scope"`) for forensics. Never blocks the dispatch.
- **Hook profile registration**: `dispatch-scope-guard.sh` declared in `hooks/run-hook.js::HOOK_PROFILES` (active in `standard` + `full`, skipped in `minimal`). Registered in `hooks/hooks.json` under PreToolUse with matcher `Task`, async, timeout=3s. Kill switch via `DEVT_DISABLED_HOOKS=dispatch-scope-guard.sh`.
- **`config.cjs::DEFAULTS.dispatch`** (NEW): `{max_prompt_bytes: 24576, max_files_hint: 8}`. Tunable per project in `.devt/config.json::dispatch.*`.
- **26 new smoke-test gates** covering: JSON sidecar emission + shape, scope_hint cache step + dispatch presence across all 5 workflows, agent-body guidance text across all 7 affected agents, hook registration in both `hooks.json` and `run-hook.js`, end-to-end hook behavior (over-cap warning + JSONL append, silent under cap, non-Task tool ignored), config DEFAULTS coverage.

### Changed

- **Orchestrator-prep step in dev/quick/code-review verifier+code-reviewer+programmer dispatches** now reads `workflow.yaml` once and parses both `memory_signal_json` and `scope_hint_json` from the single result — one subprocess per dispatch instead of two when both signals are needed.
- **`preflight.cjs::generate` return value**: adds `sidecar_path` to the existing return object and `suggested_reading` count to the `counts` object. Backward compatible — existing keys unchanged.

### Notes

- The hook is **advisory by design**. Subagent budget exhaustion remains the failure mode of last resort; the existing stub-first protocol (every output-writing agent writes a `# <Artifact> — in progress` stub as its FIRST write) catches the case where a dispatch runs out of turns mid-investigation. The advisory hook surfaces over-scoped dispatches *before* they fail so the orchestrator (or human user) can tighten the brief proactively.
- Empty `scope_hint` arrays (`[]`) are the expected default for projects without indexed `.devt/memory/` docs or with Graphify disabled. The injection is purely additive; absence of the array doesn't degrade existing flows.

## [0.42.0] - 2026-05-17

Tier-aware skill preloading + Agent IO Contracts registry + inline-loading coverage completion across write-agents + memory_signal cache hoist + over-cap skill description trim. The coordinated wave extends the existing inline-prefix pattern (`<governing_rules>`, `<guardrails_inline>`) from the original 3 read-only agents to the 3 write-agents (programmer/tester/architect) that re-read CLAUDE.md + rule files on every retry iteration; adds rubric body inlining for the verifier; collapses 7 per-dispatch `memory query --signal` CLI calls into a single workflow-start cache; trims 8 SKILL.md descriptions back under the 1024-char soft cap. Validated via `node bin/devt-tools.cjs token-report` showing aggregate `cache_hit_rate = 93.05%` across 5 recent sessions — empirical evidence that the existing prefix patterns were already hitting the prompt cache, so this wave focused on closing the coverage gaps the original inline-loading wave intentionally restricted to read-only agents. Smoke: **401 passed**, **0 failed**.

### Added

- **Tier buckets in `skill-index.yaml`**. Per-agent skill assignments now split across three sibling keys at the existing indent-4 level — `skills` (always loaded), `skills_standard` (added when `state.tier` is `STANDARD` or `COMPLEX`), `skills_complex` (added only at `COMPLEX`). Heavy specialist skills (`strategic-analysis` ~8K chars, `complexity-assessment` ~10K, `autoskill` ~12K) demoted out of the `always` bucket so SIMPLE/TRIVIAL dispatches skip them. The hand-rolled YAML parser at `init.cjs::parseSkillIndex` already accepted arbitrary indent-4 keys — no parser change required. User overrides at `.devt/config.json::agent_skills.<agent>` keep accepting a flat array (= always loaded, ignores tier) so existing project configs don't break.
- **`bin/modules/init.cjs::mergeSkillsForTier`** (NEW): merges the three buckets per agent against a tier (TRIVIAL/SIMPLE/STANDARD/COMPLEX/null), normalizes case, dedupes. Null/unknown tier returns the full union for backward-compatible default behavior. `resolveSkills` gained a `tier` parameter wired through `initWorkflow`; the call site seeds tier from `state.tier` (set by `complexity-assessment` once it runs) or falls back to `detectTier(task)` so the very first dispatch in a fresh workflow still gets tier-aware loading. The init payload now surfaces the resolved tier at the top level (`tier: "trivial"|"simple"|"standard"|"complex"`) for transparency.
- **`agents/io-contracts.yaml`** (NEW): single source of truth declaring per-agent `frontmatter_skills`, `index_buckets`, `outputs.{primary,sidecar}`, and `inputs.context_blocks`. Currently 10 dev agents covered. Three smoke-test gates assert no drift against (a) `agents/<name>.md` frontmatter `skills:`, (b) declared sidecars exist in `state.cjs::JSON_SIDECAR_SCHEMAS`, (c) every contracted agent has a backing `.md` file. The class of bug it catches: `memory-pre-flight` had been preloaded by 9 agents via frontmatter for several releases but was missing from `skill-index.yaml` — the kind of three-surface drift that's silently corrosive until something snaps.
- **`memory-pre-flight` added to `skill-index.yaml` for the 9 dev agents** that already preload it via frontmatter (programmer/tester/code-reviewer/docs-writer/architect/verifier/researcher/debugger — plus devt-coordinator already had it). Closes the registry-vs-reality gap that the new contracts gate would have failed on.
- **`graphify-helpers` added to architect's `skills` bucket** to match its frontmatter (architect was the second drift case).
- **Three new smoke-test gates** under `== Tier-aware skill resolution ==` and `== Agent IO Contracts registry drift ==`: empirical verification that a typo-style task seeds `tier=trivial` and prunes complex-tier skills from the programmer's resolved set; a refactor-style task seeds `tier=complex` and loads the full union; the io-contracts.yaml file agrees with all three drift surfaces.
- **`bin/modules/init.cjs::loadInlineRubrics`** (NEW): mirrors `loadInlineGuardrails` for the per-workflow-type pinned rubric files (`references/rubrics/<filename>` resolved via the same three-layer order as `grader.cjs::resolveRubricPath` — absolute → project-local `.devt/rubrics/` → plugin defaults). 32 KB cap. Surfaced at top-level `inline_rubrics` in the init payload as a `{workflow_type: content}` map. Verifier dispatches in `dev-workflow.md` and `code-review.md` now embed `<rubric_content>{inline_rubrics.dev}` / `{inline_rubrics.code_review}` alongside the existing `<rubric_path>` block — agent body instructs prefer-inline-over-path-read.
- **`<governing_rules>` block extended to programmer + tester + architect dispatches.** Original wave covered the 3 read-only agents (code-reviewer / verifier / researcher); this completes the coverage to write-agents that re-read CLAUDE.md + 1-3 rule files on every retry iteration. Per-agent sub-tag sets vary based on which files each agent actually needs: programmer (claude_md + coding_standards + architecture + quality_gates), tester (claude_md + quality_gates + testing_patterns), architect (claude_md + architecture). All three agent bodies updated with the prefer-inline instruction listing exactly the sub-tags they accept.
- **`<guardrails_inline>` block extended to tester + architect.** Tester preloads only `golden-rules.md`; architect preloads `golden-rules.md + engineering-principles.md`. Programmer already had the full 3-file inline block from the original wave.
- **`quick-implement.md` programmer + tester dispatches now carry inline blocks.** Was the most cache-unfriendly dispatcher in the codebase pre-wave — had zero inline blocks despite being the "lightweight fast path".
- **Parallel-bash pairing for Step 2 (scan) + Step 2.5 (regression_baseline) in `dev-workflow.md`.** New `<!-- parallel-bash: ... -->` marker comment documents the pattern (mirrors the existing `<!-- parallel-dispatch: researcher + architect -->` marker for Task subagent parallelism). The two steps share no state (distinct artifacts, no overlapping `state update` keys), so when `regression_baseline` would run a slow test suite the orchestrator can launch it with `run_in_background=true` and proceed to `scan` in the foreground. Wall-clock savings up to the full test-suite duration on projects with slow tests.

### Changed

- **Skill preload behavior is tier-conditional from dispatch #1.** Previously every dispatch loaded the full per-agent skill union regardless of complexity. Now `init.cjs` seeds tier via `detectTier(task)` (heuristic; refined by `complexity-assessment` once the workflow runs). Concrete effect: a trivial typo fix gives the programmer 3 preloaded skills (`codebase-scan, scratchpad, memory-pre-flight`) instead of the prior 6+, shrinking the per-dispatch prefix by ~28K chars. The full union still loads for COMPLEX-tier work — no regression for non-trivial flows.
- **`memory_signal` computation hoisted from per-dispatch CLI calls to workflow context_init cache** across `dev-workflow.md`, `quick-implement.md`, and `code-review.md`. The same `memory query "<task>" --signal=3 --json-compact` aggregate was previously computed 7 times across the 3 workflows (3 dispatches in dev: programmer/code-reviewer/verifier; 2 in quick-implement: programmer/code-reviewer; 2 in code-review: code-reviewer/verifier). Now computed once at context_init, persisted to `workflow.yaml::memory_signal_json`, and read back via `state read | jq -r '.memory_signal_json'` in each dispatch's orchestrator-prep block. Saves up to 6 subprocess calls per workflow + makes the `<memory_signal>` block byte-stable across iterations (no risk of mid-workflow index-mutation producing different ordering across dispatches).
- **8 over-cap skill descriptions trimmed back under the 1024-char soft cap.** Was 1030-1233 chars (pre-folded-scalar parser fix masked 4 of them); now 740-900 chars. Trimmed redundant trigger-phrase repetition while preserving discoverability triggers and scope-boundary statements. Each preload-injected description appears in agent system prompts on every dispatch, so even small per-skill trims compound. Skills affected: lesson-extraction (1233→825), autoskill (1131→743), verification-patterns (1076→~900), architecture-health-scanner (1049→777), code-review-guide (1049→~900), memory-curation (1049→~900), council (1042→844), strategic-analysis (1030→740).
- **Agent body context-loading instructions updated** for programmer / tester / architect / verifier. The numbered "Read X" steps now consolidate the inline-prefer language into the load step itself, listing exactly which `<governing_rules>` / `<guardrails_inline>` / `<rubric_content>` sub-tags each agent recognizes. Agents fall back to disk Reads only when the inline block is absent or a specific sub-tag is empty.
- **`regression_baseline` added to the "Valid phases" enumeration in `dev-workflow.md`** (3 occurrences: --to validation, --only validation, error message template). Previously `/devt:workflow --to regression_baseline` would reject as invalid even though the step is wired into the workflow.
- **`status.md` routing entry added for `phase=regression_baseline`**, sibling of the existing `phase=scan` row. Previously `/devt:status` would show a blank suggestion line for a workflow stopped at the baseline phase.

### Fixed

- **`scripts/smoke-test.sh` Agent IO Contracts gate ROOT env propagation bug.** `ROOT="$(cd ...)"` was set but never `export`ed; the gate's `node -e "..."` subprocess saw `process.env.ROOT === undefined`, crashed with `TypeError [ERR_INVALID_ARG_TYPE]: path argument must be of type string` on the first `path.join(root, ...)` call, and silently aborted the entire smoke test mid-run (at 321/401 passes, no FAIL line emitted because the abort happened before any `fail()` call). Two months of green-looking smoke runs were actually hiding a hard-aborting check. Fixed by prefixing the node call with `ROOT="$ROOT"` to scope-pass the var without mutating global shell state. Smoke now runs to completion at 401/401.
- **Missing `## [0.41.0] - 2026-05-16` version header in `CHANGELOG.md`.** The v0.41.0 release body (sidecar migration + deterministic grader) was orphaned under the `[Unreleased]` section, which would have tripped the CI version-coherence gate that requires every `VERSION` to have a matching `## [X.Y.Z]` header for `scripts/extract-changelog.sh` to find at release time.

## [0.41.0] - 2026-05-16

Sidecar migration wave + deterministic pre-verifier gate. Test-summary joins impl-summary and verification as a sidecar-routed artifact; impl-summary gains structured `gates.{lint,typecheck,test}` fields capturing the programmer's quality-gate execution; a new zero-dep `grader.cjs` runs as a pre-verifier gate that short-circuits the LLM verifier on red-test cycles (saves ~5–15K input tokens per failed iteration, up to ~45K per 3-iteration cycle). The grader gate's routing logic distinguishes three envelope shapes — I/O failures (sidecar missing/malformed/non-object, rubric missing, rubric `## Deterministic Gates` JSON malformed, path-traversal in config) route to BLOCKED so the programmer isn't retried on something they can't fix; constraint violations route to RETRY/PRUNE under the `verify_iteration` cap; greens dispatch the LLM verifier. The two-call merge precedence is documented explicitly: strictest outcome wins (any `ok:false` → BLOCKED). Project-local rubric overrides land at `.devt/rubrics/<file>` and are picked up before plugin defaults; relative paths are scoped to their trusted root, absolute paths bypass the check (operator opt-in). Pre-flight deny messages now carry an explicit recovery template so agents without the `memory-pre-flight` skill can recover from the deny output alone. Skill frontmatter is now structurally validated at smoke time per Anthropic's official Skills guide. Smoke: **398 passed**, **0 failed**.

### Added

- **`test-summary.json` sidecar** registered in `state.cjs::JSON_SIDECAR_SCHEMAS` (status enum mirrors the prior markdown ARTIFACT_SCHEMA, verdict enum mirrors impl-summary's `{PASS, FAIL, INDETERMINATE}`, agent gated to `tester`). The tester now emits both `.md` (human review) and `.json` (workflow routing) at gate time. `SIDECAR_FOR_MARKDOWN` maps `test-summary.md → test-summary.json`; `validateConsistency()` reads status through the sidecar for this artifact. JSON shape includes `tests.{added,passed,failed,skipped}_count`, `test_files[]`, `failures[]`, and `concerns[]` — the count fields feed the new deterministic grader directly. `workflows/dev-workflow.md` and `quick-implement.md` updated to read status via `state read-sidecar test-summary.json` instead of grepping the markdown's `## Status` header.
- **`impl-summary.json::gates` schema** extends the programmer sidecar with structured quality-gate execution fields: `gates.lint.{ran, passed, errors, warnings}`, `gates.typecheck.{ran, passed, errors}`, `gates.test.{ran, passed, passed_count, failed_count, skipped_count}`. Converts "did the programmer run tests" from prose-in-the-markdown into machine-readable fields the deterministic grader inspects directly. Existing `verdict`/`status`/`requirements_*` fields unchanged.
- **`bin/modules/grader.cjs`** (NEW, zero-dep stdlib only): extracts the `## Deterministic Gates` JSON block from a rubric markdown, walks the constraint tree against a sidecar's parsed JSON, returns `{pass, gate_failures: [{field, expected, got}]}`. Constraint leaves: scalar (equality), array (oneOf). Nested objects recurse with a dotted field path. CLI: `node bin/devt-tools.cjs grade <workflow_type> <sidecar.json>` (exit 0 on pass, 1 on fail). Rubrics without a Deterministic Gates section short-circuit to `pass:true` (no enforcement).
- **`references/rubrics/dev.v1.md` Deterministic Gates section** declares the dev-workflow constraints: `test-summary.json.verdict = "PASS"` + `tests.failed_count = 0`; `impl-summary.json.verdict = "PASS"` + `gates.{lint,typecheck,test}.{ran,passed} = true`. Projects override per-project in `.devt/config.json::rubrics.dev` by pointing at a customized rubric file.
- **Pre-verifier gate wired into `workflows/dev-workflow.md`** — runs the grader against test-summary + impl-summary BEFORE the LLM verifier Task dispatch. Three-way envelope routing: `{ok:false}` → BLOCKED (I/O failure, not retryable); `{ok:true, pass:false}` → RETRY/PRUNE under `verify_iteration` cap; `{ok:true, pass:true}` → LLM verifier dispatches. On constraint-violation `pass:false`, participates in the same `verify_iteration` counter the LLM verifier path uses: under `workflow.max_iterations` cap (default 3) routes to programmer re-dispatch with `gate_failures` as `<review_feedback>`; at cap routes to PRUNE with `gate_failures` written to scratchpad and `status=DONE_WITH_CONCERNS`. Existence pre-gate extended to check JSON sidecars alongside the markdown artifacts — missing sidecars surface as BLOCKED early instead of through a generic grader I/O error. Skips the LLM verifier entirely on red-test cycles. Verifier's job under deterministic-gating narrows to semantic verification — *did the implementation solve the task?* — rather than re-grading test results the grader already proved.
- **Skill frontmatter smoke gate** per Anthropic's "Complete Guide to Building Skills for Claude" (2026). Hard-fails on structural rules that would break Claude's skill loader: SKILL.md case-sensitive presence, no `README.md` inside skill folders, YAML frontmatter present, `name` = folder name in kebab-case, no `claude`/`anthropic` reserved name prefix, no XML angle brackets in frontmatter (security: frontmatter loads into Claude's system prompt). Soft-warns (informational, does not fail) on description >1024 chars or body >5000 words — the PDF lists these as guidelines, not loader requirements. Current state: 12 of 16 devt skills fully clean; 4 surface as soft-warn (architecture-health-scanner / autoskill / lesson-extraction / memory-curation — all are slightly over the 1024-char soft cap because they carry rich trigger-phrase lists, which the PDF *also* recommends for reliable triggering). Drift prevention surface for future skill additions.

### Changed

- **`impl-summary` gate-check now routes through the JSON sidecar.** `workflows/dev-workflow.md` and `workflows/quick-implement.md` previously instructed the orchestrator to *"Read `.devt/state/impl-summary.md` and check status"*, but `impl-summary.md` has carried no `## Status` header since v0.33.0 (sidecar-only routing contract). The instruction worked anyway via implicit Claude adaptation, but the documented routing was stale. Migrated to explicit `state read-sidecar impl-summary.json` — same pattern Phase 1 established for `test-summary`. All 3 sidecar-covered artifacts (impl-summary, test-summary, verification) now route uniformly through the CLI helper.

### Fixed

- **Pre-flight deny message includes explicit recovery template.** `hooks/pre-flight-guard.sh` replaces the single-paragraph reason with action-led multi-line output: leads with the literal `PREFLIGHT <ISO-8601-timestamp> edit <path> :: <governing-IDs>` template + a single-word `ungoverned` fallback keyword. Agents that haven't preloaded `devt:memory-pre-flight` can recover from the deny output alone instead of looping on the bare "missing PREFLIGHT line" diagnosis (root cause of the 9-deny stuck pattern surfaced in `/devt:status` field reports). The deny-record `reason` field in `preflight-denies.jsonl` is unchanged (terse for log scanning); only the user-facing message is enriched. Smoke gate added asserting the deny stdout contains the literal template substrings.
- **Grader propagates I/O errors as `ok:false`, not silently as `pass:false`.** `bin/modules/grader.cjs::run` previously emitted `{ok:true, pass:false}` when the rubric file was missing on disk, masking an operator-level problem as a constraint violation that would re-dispatch the programmer in an infinite loop (bounded by `max_iterations`, but burning 3 dispatches before PRUNE). Now propagates the `error` field from `gradeArtifact` as the top-level `ok:false` envelope. Sidecar-missing/malformed already returned `ok:false`; this fix completes the symmetry — all I/O failures from the grader route to BLOCKED. CLAUDE.md "Deterministic pre-verifier gate" entry expanded to document the three envelope shapes + the custom-agent / no-test-runner friction with copy-pasteable rubric override example.
- **Rubric path resolution supports project-local overrides.** `grader.cjs::resolveRubricPath` previously hardcoded `path.join(PLUGIN_ROOT, "references", "rubrics", file)`, which meant `path.isAbsolute` paths were silently mangled and `../` escapes resolved inside the plugin tree — the documented escape hatch was non-functional. Now uses three-layer resolution: (1) absolute paths in config → use directly, (2) project-local `<projectRoot>/.devt/rubrics/<file>` if it exists → that, (3) plugin default fallback. Users hitting the gates friction can drop a lenient rubric at `.devt/rubrics/dev-lenient.md` and reference it by name in `.devt/config.json::rubrics.dev`. CLAUDE.md updated with the corrected mechanics.
- **Malformed `## Deterministic Gates` JSON surfaces as `ok:false`, not silent pass.** `extractDeterministicGates` previously returned `null` on both "section missing" (by design — no enforcement) AND "JSON malformed" (silent bug — gate enforcement disabled with zero operator visibility). Now distinguishes the two: missing section still returns `null` (silent pass:true by design), but missing fence / malformed JSON / non-object root returns `{error: "..."}` which `gradeArtifact` propagates as `pass:false, error` and `run` lifts to `ok:false`. Operator edits that break the rubric now fail loud, not silent.
- **Two-call merge precedence documented explicitly in workflow text.** `workflows/dev-workflow.md` verify step now states the strictest-outcome-wins rule for combining GRADE_TS + GRADE_IS routing: `ok:false` (BLOCKED) > `pass:false` (RETRY/PRUNE) > `pass:true` (proceed). Without this, Claude could misroute when the two calls return different envelope shapes (e.g. one `ok:false`, other `ok:true, pass:true`).
- **Non-object sidecar payloads surface as ok:false.** `state.cjs::readSidecar` previously crashed with `TypeError: Cannot read properties of null (reading 'status')` when a sidecar file contained literal `null`, a JSON array, or a scalar — the validation block accessed `data.status` unconditionally. Now type-checks the parsed payload and returns `{ok:false, reason:"sidecar must be a JSON object, got <type>"}` for null/array/scalar payloads.
- **Path-traversal in `rubrics.<workflow_type>` config rejected.** `grader.cjs::resolveRubricPath` previously did `path.join(PLUGIN_ROOT, "references", "rubrics", configValue)` without scoping the normalized result. A user config of `"dev": "../../../../etc/passwd"` would read `/etc/passwd` (or similar escaped path) — read-only, local-only, no exfil, but the wrong category of behavior. Now normalizes the candidate and asserts it stays within `.devt/rubrics/` (project-local) or `references/rubrics/` (plugin default). Absolute paths bypass the check as explicit operator opt-in. Error message distinguishes "no rubric configured" from "configured but path-traversal rejected".
- **`templates/python-fastapi/arch-scan.py::emit_text` `stream` parameter annotated as `TextIO`.** Previously had no annotation, tripping mypy `--strict`'s `no-untyped-def` rule even though `Any` was inferred from usage. The body only ever passes `stream` to `print(..., file=stream)`, so the precise type is `TextIO`. Added to the existing `typing` import. Projects scaffolded from the python-fastapi template no longer fail mypy strict in CI on day one.

## [0.40.0] - 2026-05-13

Graphify Cross-Cutting Concerns + god-node candidate seeding + CI hardening. The Pre-Flight Brief and discovery harvest now read `graphify-out/GRAPH_REPORT.md` to surface structural couplings before changes start and to seed the underused CON-* tier with high-fanin concept candidates. Smoke: **383 passed**, **0 failed**.

### Added

- **Pre-Flight Brief absorbs `GRAPH_REPORT.md` sections.** `bin/modules/graphify.cjs::parseReportSections(reportPath)` is a 4 MB-capped markdown header parser that pulls God Nodes, Surprising Connections, and Knowledge Gaps out of graphify's report. `bin/modules/preflight.cjs::generate` calls it once per Brief and `renderBrief` emits a new `## Cross-Cutting Concerns (graphify)` section between Blast Radius and Recommendations — filtered to entries whose symbols overlap the topic (case-insensitive substring, ≥3 chars), capped at 5 god-nodes and 5 surprising connections. Section is omitted entirely when graphify isn't ready, the report is missing, or no entries overlap — Brief layout stays byte-stable for non-graphify projects.
- **Discovery seeds curator concept candidates from graphify god-nodes.** `bin/modules/discovery.cjs::harvestGraphifyGodNodes()` reads the same `parseReportSections` output, strips trailing parens, skips private/module-shaped symbols, caps at top 10 by edge count, and filters out symbols already covered by an active CON/ADR via `memory.affectsSymbol()`. Composes alongside the existing 3 sources in `harvest()`; REJ tombstone keyword suppression and dedup against existing memory docs apply unchanged. Closes the gap where CON-* docs starved of candidates because session-time ⚖️/🔵 signals rarely surface structural concepts.

### Fixed

- **`token-report --regression` emits a stable JSON contract.** When no Claude Code session logs exist for a project (fresh CI checkout), the missing-session-dir early-return now still emits the top-level `regression` block with zero counts, so the `--fail-on-regression` consumer and downstream automation can rely on the field shape. Previously the block was silently dropped on that branch, causing the smoke gate to fail in CI.
- **Release workflow promotes Latest by highest semver.** `.github/workflows/release.yml` computes the highest stable tag including the current `$TAG` and passes `--latest=true` only when `$TAG` is that maximum. Prereleases keep their existing `--prerelease` path and are never flagged Latest. Guards against retags of older versions or hotfixes of older series stealing "Latest" from a higher release.
- **`deferred list --tags=CSV` filter works** (was DEF-017). The list subcommand previously read `--tag` (singular) and only matched the first tag; now `--tags=a,b,c` parses to an array, OR-filters across items whose `tags[]` include any requested tag, and aligns with the documented canonical form.

## [0.39.0] - 2026-05-13

Observability foundation. The MCP trace records now carry the active workflow's context, and `mcp-stats` gains three filter flags so per-workflow / per-phase / per-type slicing is possible — unlocks measuring whether the `<memory_signal>` extensions from v0.38.x actually save the predicted MCP round trips. Smoke: **379 passed**, **0 failed**. Locking: **3/3**.

### Added

- **Workflow context on MCP trace records.** `bin/devt-memory-mcp.cjs` gains a `readWorkflowContext()` helper that reads `.devt/state/workflow.yaml` on demand with mtime-invalidated caching — one `stat()` syscall per MCP call when nothing changed, full re-read on workflow transitions. Each trace record emitted while a workflow is active now carries `workflow_id`, `workflow_type`, and `phase` fields merged into the existing schema. Records emitted outside any workflow omit these fields entirely (cleanest signal). Existing record fields (ts, tool, ok, duration_ms, …) take precedence on the unlikely collision.
- **Three new filter flags in `bin/devt-tools.cjs mcp-stats`**: `--workflow-id=<UUID>`, `--workflow-type=<dev|code_review|…>`, `--phase=<implement|verify|…>`. Filters compose conjunctively with the existing `--since` and `--tool` — e.g. `mcp-stats --workflow-type=dev --phase=verify --tool=query_fts` shows verifier-phase memory lookups across all dev workflows. Trace records lacking a field are excluded when its filter is set; bare aggregate behavior is unchanged.

### Internal

- 5 new smoke-test gates: bare aggregate over a synthesized 4-record fixture (counts all 4), `--workflow-id=wf-A` (narrows to 2), conjunctive `--workflow-type=dev --phase=verify` (narrows to 1), unknown workflow_id returns 0 cleanly, and a live MCP server boot test that fires a real `tools/call` JSON-RPC request and asserts the resulting trace record carries `workflow_id` + `workflow_type` + `phase` from the active workflow.yaml.
- Workflow-context regexes hardcoded (not built via `new RegExp(varName)`) so Semgrep's ReDoS analysis can prove the patterns are bounded.

## [0.38.1] - 2026-05-13

Small composing additions: memory signal extended to more dispatches, narrow git destructive patterns added to the Bash safety hook, and a new input-JSON schema registry validates `handoff.json` for resume reliability.

### Added

- **`<memory_signal>` extended to programmer + code-reviewer dispatches** across `workflows/dev-workflow.md`, `workflows/code-review.md`, and `workflows/quick-implement.md` — five new dispatch sites total. Each uses the same orchestrator-prep `memory query --signal=3` pattern shipped earlier for verifiers, so programmer and code-reviewer skip per-doc memory round trips on their initial scan. `agents/programmer.md` and `agents/code-reviewer.md` instruct preferring the inline block over fresh queries; programmer uses it to confirm which ADRs/CONs apply to the code path, code-reviewer uses it to flag REJ-tombstone matches and ADR violations. KEEP-IN-SYNC discipline extended to cover the 5-site cluster.
- **Git-destructive Bash patterns** (`source: "git_destructive"`) in `bin/modules/bash-guard.cjs`. Three narrow patterns with zero legitimate dev use: (1) force-push to a protected branch (`main`, `master`, `release/*`, `prod*`, `develop`) — `--force-with-lease` to the same branches is explicitly allowed as the safer variant; (2) `git clean -x` (any flag combo containing `x`) — nukes gitignored files including `.env`; (3) `git checkout -- .` or `git checkout -- *` mass-discard. `git reset --hard` is deliberately NOT denied so devt's own self-update flow in `workflows/update.md` continues to work.
- **`JSON_INPUT_SCHEMAS` registry** in `bin/modules/state.cjs` with a `validateInputJson(body, schema)` helper. Distinct from `JSON_SIDECAR_SCHEMAS` — sidecars validate enum membership (status/verdict/agent); input schemas validate required + recommended top-level fields. `handoff.json` is the first registered entry: `required = [task, phase, paused_at]`, `recommended = [tier, iteration, last_commit, remaining_tasks, next_action]`. `state validate` now surfaces a `missing_required_field` mismatch when `handoff.json` exists but lacks a required field, catching resume-after-pause breakage before it silently corrupts a routing decision.

### Internal

- 9 new smoke-test gates covering the 5 `<memory_signal>` dispatch sites, 3 orchestrator-prep step invocations, agent guidance presence in programmer + code-reviewer, force-push deny + `--force-with-lease` allow, `git clean -fdx` deny, mass-discard deny, devt self-update compatibility (regression guard), JSON_INPUT_SCHEMAS registry export, `validateInputJson` happy path, and end-to-end `state validate` surfacing missing required field.
- New `MISMATCH_REASONS.MISSING_REQUIRED_FIELD` entry — used by `validateConsistency` when an input JSON parses but lacks a contractually required field.

## [0.38.0] - 2026-05-13

Safety + token-efficiency wave with three pre-existing schema fixes. New Bash deny hook covers filesystem-wipe and `--no-verify` patterns. A stuck-agent detector pauses autonomous flows after three denies in one session. The verifier dispatches now pre-fetch a memory signal so the agent skips per-doc round trips. Preflight Brief size now scales by task tier. Smoke: **363 passed**, **0 failed**. Locking: **3/3**.

### Added

- **Bash safety hook (`hooks/bash-guard.sh` + `bin/modules/bash-guard.cjs`).** PreToolUse matcher on `Bash` that denies a narrow set of patterns with zero legitimate dev use: filesystem-wipe commands targeting root, `$HOME`, parent dirs, or raw block devices (`source: "bash_destroy"`); and git operations carrying `--no-verify` or `--no-gpg-sign` (`source: "no_verify"`). Returns `{decision:"deny", source, rule_id, reason, hookSpecificOutput}` per the Claude Code hook contract. Active in `standard` and `full` profiles; kill switch via `DEVT_DISABLED_HOOKS=bash-guard.sh`. Adjacency-safe — `rm -rf ./dist` allowed, `echo "rm -rf /"` allowed (quoted segments stripped before pattern test), `git commit -m "discuss --no-verify scenario"` allowed.
- **Stuck-agent detector (`bin/modules/stuck-detector.cjs` + `node bin/devt-tools.cjs stuck check`).** Counts deny records in the current workflow session (filtered by `workflow.yaml::created_at` with `mtime` fallback for pre-stamp files). Reports `stuck:true` at the 3-deny threshold. Wired into `workflows/dev-workflow.md` autonomous-mode pause block, `workflows/next.md` PRIORITY GUARDS + new "Active workflow, stuck signal" routing branch, and `workflows/status.md` conditional surface line (mirrors the deferred-queue pattern).
- **`memory query --signal[=N]` aggregate mode** in `bin/modules/memory.cjs`. Returns `{counts: {<domain>: N}, top: [{id, title, doc_type}]}` in a single CLI call. Bypasses the mutually-exclusive precedence trap of the existing `--count > --domain-counts > --top > --json-compact` flags.
- **`<memory_signal>` block in verifier dispatches** for `workflows/dev-workflow.md` and `workflows/code-review.md`. Orchestrator-prep step computes the signal via the new CLI and substitutes it into the dispatch prompt. `agents/verifier.md` prefers the inline block over fresh `memory query` calls — saves 3–4 per-doc round trips per verify iteration. KEEP-IN-SYNC marker keeps both verifier dispatches aligned.
- **Tier-aware Memory-Graph lane budget** in `bin/modules/preflight.cjs`. New `preflight.lane_budget` config (`{trivial: 10, simple: 25, standard: 50, complex: 75}`) plus a `detectTier(taskText)` heuristic — keyword-first (refactor/architecture/migration → complex; small fix/hotfix → simple; typo/rename → trivial), length-based fallback. Override per-call via `preflight generate "<task>" --budget=N` or per-project via `preflight.max_triples`. Trivial flows now produce ~5× smaller Briefs; complex flows get more breadth.
- **CI gate for cache-friendliness drift.** New `token-report-regression` job in `.github/workflows/ci.yml` runs `token-report --regression --fail-on-regression`. Soft-fail (`continue-on-error: true`) — reports without blocking releases until soak telemetry confirms zero false-positives. Promote to required by dropping `continue-on-error`.
- **Stub-first protocol** in 8 output-writing agent bodies (programmer, tester, code-reviewer, verifier, debugger, architect, researcher, docs-writer). Every dispatch instructs the agent to write a stub of its target output file as its first Write/Edit (`# <Artifact> — in progress`), then iterate. Eliminates the failure mode where turn-budget exhaustion leaves the orchestrator unable to distinguish "agent never started" from "agent worked but couldn't finalize".

### Fixed

- **`preflight-denies.jsonl` now in `RESET_EXEMPT`.** Before: file was archived to `.devt/state/.archive/<ts>/` on cancel, leaving the canonical path empty. After: file persists at `.devt/state/preflight-denies.jsonl` across `/devt:cancel-workflow`, mirroring the `deferred.md` pattern. Unblocks the stuck-detector's session-anchored read.
- **`workflow.yaml::created_at` + `workflow_id` now auto-stamped.** Before: both keys were declared in `KNOWN_STATE_KEYS` (`bin/modules/state.cjs:85`) but no workflow ever wrote them — dead schema. After: `updateState()` stamps `created_at` (ISO-8601) and `workflow_id` (UUID via `crypto.randomUUID`) on the `active=true` transition. Idempotent — subsequent updates preserve the stamps; `resetState()` clears them so the next activation re-stamps.
- **`memory query` combined-mode footgun documented and bypassed.** Before: combining `--domain-counts --top=N` silently dropped `--top` due to mutually-exclusive precedence. After: the new `--signal` mode returns both counts and top-N atomically; the legacy flags retain their precedence semantics for callers that need a single dimension.
- **`token-report --regression` gains exit-code semantics.** Before: regression detector ran but never called `process.exit`, so CI couldn't gate on it. After: new `--fail-on-regression` flag returns exit 1 when `sessions_with_regression > 0` (no-op when flag absent — backward-compatible).
- **Deny log readers gain a `source` field.** The `preflight-denies.jsonl` record schema is additive: pre-existing records (no `source`) are treated as `source: "preflight"`; new records from `bash-guard` carry `source: "bash_destroy"` or `source: "no_verify"`. The `skills/memory-pre-flight/SKILL.md` "Recovering from a deny" section documents the source enum and per-source recovery paths.

### Internal

- **22 new smoke-test gates** in `scripts/smoke-test.sh` covering RESET_EXEMPT membership, auto-stamp first-activation + idempotency, `--fail-on-regression` flag recognition, bash-guard hook profile + hooks.json registration, synthetic destroy + no-verify denies + adjacency safety, stuck-detector threshold + session scoping, perf budget (~50 ms/call), `memory query --signal` payload shape, `<memory_signal>` dispatch wiring in both workflows, orchestrator-prep step grep, agent guidance grep, `preflight.lane_budget` DEFAULTS shape, tier heuristic correctness on 4 cases, `resolveTripleBudget` precedence, and stub-first protocol presence in 8 agent bodies.
- **`workflows/next.md` PRIORITY GUARDS** expanded from a single validation-status guard to two early-exit conditions (stuck-signal + validation_status). Smoke gate adjusted accordingly.

## [0.37.0] - 2026-05-12

Cache-friendliness, CI hardening, and a strict documentation discipline pass. Smoke: **340 passed**, **0 failed**. Locking: **3/3**.

### Added

- **Cache-friendly dispatch ordering across every workflow.** Every `Task(subagent_type="devt:*", ...)` dispatch in `workflows/*.md` (25 dispatches across 11 files) was reordered so the per-task dynamic block (`<task>` or, for `workflows/debug.md`, `<bug>`) appears AFTER `</context>`. Static blocks (`<governing_rules>`, `<guardrails_inline>`, `<workflow_type>`, `<rubric_path>`) now lead the prompt so the Anthropic prompt-cache prefix is byte-stable across retry iterations within the 5-minute TTL. Subagent dispatches in a single workflow run now cache-hit each other's prefixes, paying ~10% of full input price on the static portion.
- **Cache-ordering smoke gate.** New `scripts/check-dispatch-ordering.cjs` walks every dispatch block and rejects any `<task>` that precedes `</context>`. Wired into `scripts/smoke-test.sh` as a new section; runs on every CI push.
- **`devt:tokens --regression` mode.** `bin/modules/token-report.cjs` exposes `detectRegressions(records, opts)` and the `--regression`, `--regression-min-input`, `--regression-streak` CLI flags. The detector scans per-turn JSONL records for streaks of "cold" turns (`cache_read_tokens == 0` with `input_tokens >= min_input_tokens`, default 5000) running ≥4-in-a-row (default). A streak is a near-certain signature of a dispatch-template ordering regression. Output: `sessions_with_regression`, `total_cold_turns`, `est_wasted_input_tokens`, `offending_sessions[].streaks[]`. Documented in `workflows/tokens.md`.

### Changed

- **Codebase-wide version/option/wave/D-NN reference removal.** Every devt-internal version marker (`v0.X.Y+`, `since v0.A.B`, `Phase N (v0.X.Y+)`, `Option N`, `Wave A`, `D-NN`, `CCA v27 §X`, roadmap pointers) has been stripped from every `.md`, `.cjs`, and `.sh` comment / prose surface — agents, workflows, skills, hooks, guardrails, references, docs, READMEs, CLAUDE.md. The codebase is no longer a parallel changelog; `CHANGELOG.md` + `git log` are the canonical sources for "when did X land". Third-party version markers (`Graphify v0.7.10+`, `Node v22`, model IDs) are preserved.
- **CLAUDE.md "Key Conventions" extended** with three new rules: cache-friendly dispatch ordering, documentation discipline (no version refs in code), and comment discipline (comments reserved for non-obvious WHY).

### Fixed

- **CI smoke-test exit 1 on Node 22 / Node 24.** The `memory.upsertDoc + MCP write surface` smoke check captured stderr (`2>&1`) which let Node 22/24's `node:sqlite` `ExperimentalWarning` contaminate `UPSERT_OUT`, breaking the `JSON.parse` that validates the upsert result. Switched to `2>/dev/null` to match the surrounding captures. Locally on Node 26 (where the warning is silent) the check always passed; CI on Node 22/24 now matches.
- **GitHub Actions Node-20 deprecation warnings.** Bumped `actions/checkout@v4` → `@v5` and `actions/setup-node@v4` → `@v5` in `.github/workflows/ci.yml` and `.github/workflows/release.yml`.

## [0.36.0] - 2026-05-12

Two waves consolidated into one release. v0.35.0's Wave A (6 options) was authored in a prior session but never published; v0.36.0's wave adds 4 more options on top (3 new + slim 3 + Option 12 tombstone). Ships 10 architectural improvements drawn from the `ticklish-mapping-backus.md` 12-option roadmap; the remaining 2 (Option 7 deferred to v0.37.0, Option 12 rejected by design). Smoke: **339 passed** (was 325 pre-wave). Locking: **3/3**. Plugin contract surface: stable (no breaking changes to commands, agents, or hooks).

### Added — v0.36.0 wave (Options 9a, 10, 11, slim 3, Option 12 tombstone)

- **Parallel researcher + arch_health dispatch** (Option 9a). COMPLEX-tier `dev` flows now dispatch the researcher and (when arch_health is opted-in via risk-signal `AskUserQuestion`) the architect in **one message with two `Task` tool calls** from `workflows/dev-workflow.md` Step 2.5. The arch_health architect dispatch reads `.devt/state/scan-results.md` only — the `plan.md` dependency dropped since the plan does not yet exist at parallel-dispatch time. Inline Auto-Plan consumes both `research.md` AND `arch-health-scan.md`. Workflow carries `<!-- parallel-dispatch: researcher + architect (arch_health mode) -->` marker; smoke test asserts presence + absence of regressions.
- **Memory Graph subgraph in Pre-Flight Brief** (Option 10). `bin/modules/memory.cjs::getSubgraphTriples(seedIds, depth=2, maxTriples=50)` reshapes per-seed `getLinks` rows into a deduped, sorted `{source, predicate, target}` array. `bin/modules/preflight.cjs::renderBrief` emits a new `## Memory Graph (2-hop subgraph)` section between **Governing Documentation** and **Rejected Approaches**. Agents scan structural relationships (`supersedes`, `depends_on`, `relates_to`, etc.) without per-doc `get_doc` round-trips. Smoke: 2 linked ADRs produce 2 expected triples.
- **Pinned rubric versions** (Option 11). `references/rubrics/dev.md` renamed to `dev.v1.md`. New `bin/modules/config.cjs::DEFAULTS.rubrics` block (default `{ dev: "dev.v1.md" }`) exposed at the top of the init payload as `rubrics`. `workflows/dev-workflow.md` verifier dispatch injects `<rubric_path>references/rubrics/{rubrics.dev}</rubric_path>`; `agents/verifier.md` prefers that block over computing the path from `<workflow_type>`. Future rubric updates ship as new files (`dev.v2.md`); projects opt in by overriding `rubrics.dev` in `.devt/config.json`. Naming convention: `<workflow_type>.v<N>.md`.
- **Grader-driven retry for `code_review`** (slim Option 3). New `references/rubrics/code_review.v1.md` rubric grades **review quality** along 5 axes — scope coverage, finding specificity, severity calibration, remediation concreteness, ADR Compliance section presence. `workflows/code-review.md` inserts a new `<step name="verify">` between `review` and `present_findings`; verifier dispatched with `<rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>` + `<workflow_type>code_review</workflow_type>`. `revisions[]` entries are axis-keyed (`A-1`, `B-3`, etc.). On `needs_revision`, the code-reviewer is re-dispatched with structured `<reviewer_feedback>` up to `workflow.max_iterations`; on `failed`, workflow STOPs with BLOCKED. REJ-tombstone matches in review remediation are a hard `failed`. `DEFAULTS.rubrics` extended to `{ dev: "dev.v1.md", code_review: "code_review.v1.md" }`. Slim scope: arch-health-scan and debug deferred (rubric design for those is meta-architectural).
- **Option 12 tombstone documented** in `CLAUDE.md`. Anthropic's specialist-team cookbook recommends sub-conversation JSON returns with no shared file artifacts; devt deliberately does NOT adopt this — `.devt/state/` file artifacts are load-bearing for cross-session resume + `/devt:next` + `/devt:pause`. Future contributors should not propose "modernizing" specialists to JSON-only returns.

### Added — v0.35.0 carryover wave (Options 1, 2, 4, 5, 6, 8)

- **Hot-path read cache: governing rules wiring** (Option 1). `bin/modules/init.cjs::loadGoverningRules` returns the project's `CLAUDE.md` + `.devt/rules/*.md` contents inline in the init payload as `governing_rules: {content, paths_included, paths_excluded, rules_hash, total_bytes}`. Cap is 96 KB total. Workflows `dev-workflow.md`, `quick-implement.md`, `code-review.md`, `research-task.md` inject a `<governing_rules rules_hash="...">` block (with `<claude_md>`, `<coding_standards>`, `<architecture>`, `<quality_gates>`, `<review_checklist>` sub-tags) into **code-reviewer, verifier, and researcher** dispatches. Those agents prefer inline content over on-disk Reads when present. `rules_hash` (SHA-256 first 16 chars) lets agents detect mid-workflow drift.
- **MCP write surface for curator** (Option 2). `bin/modules/memory.cjs::upsertDoc({frontmatter, body})` atomically writes a `.devt/memory/<subdir>/<ID>-<slug>.md` file AND refreshes the FTS5 index in one call. Validates frontmatter BEFORE touching disk; rolls back file write if index rebuild fails. `bin/devt-memory-mcp.cjs` exposes `memory_upsert_doc` tool gated by `DEVT_MCP_ALLOW_WRITES=1` (set by plugin's `.mcp.json` env block by default). `listTools()` filters out write tools when the flag is unset; `callTool()` re-checks at handler level. `agents/curator.md` instructs the curator to call `memory_upsert_doc` first and fall back to the legacy 3-tool ritual on `WRITES_DISABLED` error.
- **Sidecar-only status routing** (Option 4). `impl-summary.md` + `verification.md` no longer carry a `## Status` header in their markdown templates. JSON sidecars (`impl-summary.json` / `verification.json`) are the single source of truth for workflow routing. `bin/modules/state.cjs::SIDECAR_FOR_MARKDOWN` maps markdown → sidecar; `validateConsistency()` reads the sidecar's `status` field for these artifacts. Other 7 ARTIFACT_SCHEMA artifacts keep the markdown `## Status` header until backfilled with their own sidecars in a future wave (Path A of Option 4, deferred).
- **Stable-prefix invariant smoke test** (Option 5). Asserts that the byte-prefix of `init` payloads is stable across task-string variations — guards against accidentally moving task-text into a prefix-position that would defeat cache hits.
- **Memory query aggregate flags** (Option 6). `bin/modules/memory.cjs::queryFTS` accepts a `mode` option — `"full"` (default), `"count"`, `"top"`, `"domain-counts"`. CLI surfaces: `memory query "<terms>" --count|--top=N|--domain-counts|--json-compact`. MCP exposes `query_fts_count`, `query_fts_top`, `query_fts_by_domain`. Aggregates return ~50–500 B vs ~1.5–15 KB for full payloads — memory-pre-flight skill documents the "aggregate-first" probe pattern.
- **Hook profile docs resync** (Option 8). Updated the hook-profile table in `CLAUDE.md` to reflect the current `minimal | standard | full` set.

### Changed

- `references/rubrics/dev.md` → `references/rubrics/dev.v1.md` (rename, full content preserved). Future rubric revisions ship as new versioned files.
- `workflows/dev-workflow.md` Step 2.7 deleted — its risk-signal detection + user prompt logic moved into Step 2.5's parallel-dispatch block. Step 3's architect review prompt updated to reference the parallel dispatch instead of the deleted Step 2.7.
- `agents/verifier.md`: prefers the dispatch-injected `<rubric_path>` over computing the path from `<workflow_type>`; falls back to `<workflow_type>.v1.md` lookup when the block is absent.
- `agents/code-reviewer.md`, `agents/verifier.md`, `agents/researcher.md`: prefer the `<governing_rules>` dispatch block over on-disk Reads of `CLAUDE.md` + `.devt/rules/*.md`.
- `agents/programmer.md`, `agents/verifier.md`: emit BOTH `.md` (narrative) AND `.json` (workflow-routing sidecar) per Option 4's sidecar-only contract. Markdown templates no longer carry `## Status` for these two artifacts.
- `agents/curator.md`: instructs the curator to call `memory_upsert_doc` first and fall back to the legacy 3-tool ritual on `WRITES_DISABLED` error.
- `bin/devt-memory-mcp.cjs`: adds `query_fts_count`, `query_fts_top`, `query_fts_by_domain`, `memory_upsert_doc` tools; write tools filtered out via `listTools()` when `DEVT_MCP_ALLOW_WRITES` is unset.
- `bin/modules/state.cjs`: new `SIDECAR_FOR_MARKDOWN` registry; `validateConsistency()` reads sidecar `status` for sidecar-covered artifacts.
- `workflows/code-review.md`: new `<step name="verify">` between `review` and `present_findings` — verifier grader-driven retry of the code-reviewer, bounded by `workflow.max_iterations`. Skip when `config.workflow.verification` is false or `verify` is in `skipped_phases`.

### Smoke

- **+14 new assertions** in `scripts/smoke-test.sh`:
  - Option 9a (4): parallel-dispatch marker comment present; Step 2.7 deleted; arch_health dispatch reads scan-results.md only (no `plan.md`); no stale "from Step 2.7" references.
  - Option 10 (4): preflight Brief generated with seeded ADRs; Brief contains Memory Graph section header; section renders `source → predicate → target` triples; `getSubgraphTriples` returns flat `{source, predicate, target}` array.
  - Option 11 (3): verifier rubric resolved via `DEFAULTS.rubrics.dev` exists (`dev.v1.md`); init payload exposes `rubrics.dev`; dev-workflow verifier dispatch injects `<rubric_path>`.
  - Slim Option 3 (3): `code_review.v1.md` rubric exists and resolves via `DEFAULTS.rubrics.code_review`; code-review verifier dispatch injects `<rubric_path>`; workflow dispatches verifier with `<workflow_type>code_review</workflow_type>`. Drift guard's filename → workflow_type map extended (`code-review` → `code_review`).
- **339 total pass** (was 325 pre-wave). 3/3 locking assertions still pass.

### Docs

- **`CLAUDE.md`** — eight new architecture doc blocks covering each shipped option (incl. slim Option 3 grader extension for `code_review`, Option 12 tombstone documenting the rejection), plus an updated entry for Option 11's `rubrics` config key.
- **`docs/MEMORY.md`** — added aggregate-flag CLI variants under "CLI Surface"; added `query_fts_count` / `query_fts_top` / `query_fts_by_domain` / `memory_upsert_doc` rows under "MCP Server"; added Memory Graph bullet under "Tier 1 — Topic Pre-Flight".
- **`README.md`** — added `rubrics.dev` config row under "Basic configuration".
- **`skills/memory-pre-flight/SKILL.md`** — documents the aggregate-first probe pattern and the Memory Graph Brief section.

### Notes for projects upgrading from v0.34.1

- No config migration required. `.devt/config.json` keeps working unchanged.
- Projects that subclassed `references/rubrics/dev.md` directly need to update their path — point to `dev.v1.md` (or override `rubrics.dev` in `.devt/config.json`).
- MCP write surface (Option 2) is **enabled by default** via `DEVT_MCP_ALLOW_WRITES=1` in the plugin's `.mcp.json`. Set to `"0"` or remove the env var to disable and force the legacy 3-tool path.

## [0.34.1] - 2026-05-12

Wave 4 closeout: two more items from the deferred list that survived a second-pass validation against the current Claude Code 2.x reference. **D-19 (devt-coordinator opt-in main-thread router)** and **D-29 (CLAUDE.md sweep)**. The other Wave 4-5 items remain deferred — second-pass validation confirmed: D-12 already-marginal (1-2 KB Brief, not 5-10 KB); D-21 in current form has no mechanism (`FileChanged` matcher is literal filenames, not globs); D-22 best concrete win needs MCP server write capability (separate architectural decision); D-23 inverted premise (`paths:` LIMITS auto-activation, doesn't expand); D-25/D-26/D-27/D-28 speculative without concrete devt drivers; D-10 sub-1 / D-20 / D-24 deferred with concrete revisit triggers (token-comparison data, init friction reports, /devt:research weight complaints respectively).

### Added
- **`agents/devt-coordinator.md`** (D-19) — thin opt-in main-thread router. Users add `"agent": "devt-coordinator"` to their project's `.claude/settings.json` (or `claude --agent devt-coordinator` ad-hoc); every prompt is classified as devt-shaped (route via Skill tool to matching `/devt:*` command) or casual (pass through to normal Claude session). 256 lines, well under the 500-line agent budget. Mirrors `workflows/do.md` routing table — smoke test enforces row-count parity to catch drift. Pass-through-by-default policy: routing is the exception, not the rule, and the agent explicitly refuses to "nag" about devt commands during casual conversation.
- **README "Main-thread coordinator (opt-in)" section** documents the opt-in mechanism, the classification protocol, and the plugin-agent caveat (no per-coordinator `hooks`/`mcpServers`/`permissionMode` — workaround is copying the agent to user's `.claude/agents/`).

### Changed
- **`CLAUDE.md` (D-29)** — documented previously undocumented v0.33.0/v0.34.0 mechanics. New entries cover: the JSON sidecar contract (impl-summary.json + verification.json); the outcome-grader bounded-retry mechanism (rubric system + revisions[] routing + the two-scopes `verdict` field disjointness); the inline-guardrails wiring (init payload → `<guardrails_inline>` dispatch block → agent fallback); the devt-coordinator opt-in pattern. The Pre-Flight Protocol entry already covered v0.33.0 JSONL migration; v0.34.0 additions land alongside it.
- **`.claude-plugin/plugin.json` agents list** — added `./agents/devt-coordinator.md`. 11 agents total now (10 dev specialists + 1 opt-in coordinator). README "10 specialized agents" line updated to mention the coordinator as an opt-in addition.

### Smoke
- **+3 new assertions** (`scripts/smoke-test.sh`):
  - `agents/devt-coordinator.md` exists.
  - Coordinator is registered in `plugin.json` agents list.
  - Coordinator's routing table row count matches `workflows/do.md` (drift guard — adding a command to one file but not the other fails the build).
- **321 total pass** (was 318 at v0.34.0).

### Deferred (confirmed after second-pass validation)
The "Deferred (plan vs. reality)" section in v0.34.0 already enumerated 8 items with concrete blockers. v0.34.1 confirms those deferrals after re-analysis with hard data (current agent line counts, MCP server tool surface, init wizard complexity):

- **D-21 (hook event modernization)**: `FileChanged` matcher is literal filenames only — plan's biggest leverage win for memory-auto-index has no mechanism. `Setup`/`ConfigChange`/`InstructionsLoaded`/`PostToolBatch` are real but each is a solution-in-search-of-problem in current devt. Skip permanently in current form.
- **D-22 (non-command hook types)**: `mcp_tool` for memory-auto-index requires adding a write tool to the read-only `bin/devt-memory-mcp.cjs` — a security-posture change deserving its own plan. `prompt`/`http`/`agent` types either net-negative (latency/cost) or speculative.
- **D-23 (skill `paths:` glob)**: feature LIMITS skill auto-activation; plan's "saves tokens by skipping" premise inverts the documented semantics. Only `tdd-patterns` (already path-scoped) fits the model.
- **D-12 (Pre-Flight Brief inline injection)**: re-confirmed marginal — Brief is 1-2 KB, not 5-10 KB. Stay dropped.
- **D-10 sub-1 (trim non-programmer agent bodies)**: current line counts measured — programmer 423, verifier 357, tester 322, debugger 315, code-reviewer 313, all under 500-line budget. Without `/devt:tokens --compare` data showing specific agents dominate cache-miss prefix cost, trimming is guessing. Concrete trigger: when measurement data exists.
- **D-20 (userConfig migration)**: `/devt:init` works (14-question AskUserQuestion wizard runs once per project at setup). userConfig prompts at plugin-enable time would be a marginal UX nicety for substantial refactor. Concrete trigger: user reports `/devt:init` friction, or a sensitive value (license/API key) needs keychain storage.
- **D-24 (research-fork skill)**: devt already has `/devt:research`, `/devt:thread`, plus Claude Code's built-in `/explore`. A fourth way overlaps without clear differentiation. Concrete trigger: users find `/devt:research` too heavyweight for one-off read-only queries.
- **D-25 (`${CLAUDE_PLUGIN_DATA}`)**: no devt state today needs to persist across plugin updates and across projects. Plan mentioned FTS5 schema migrations (devt rebuilds the index on every memory write — no migration state) and embedding caches (don't exist). Skip until concrete need surfaces.
- **D-26 (channels)**: push-vs-poll for deferred reminders is marginal UX vs. heavy user setup (bot tokens, channel auth). `/devt:status` already surfaces deferred queue count. Skip.
- **D-27 (personal-agent install)**: niche edge case for power users wanting plugin-agent restrictions removed. Nobody has requested it. Skip until request.
- **D-28 (dispatch-time conditional skill preload)**: double-speculative (gated on D-10 sub-1 which is itself measurement-gated). Skip until D-10 data exists and post-trim cost is still high.

## [0.34.0] - 2026-05-12

Wave 4 opens with two items: **D-16 (outcome-grader rubrics + bounded retry)** from Wave 3 carryover, and **D-11 consumer wiring (inline guardrails)** completing the v0.32.0 data plumbing. Other Wave 4 items (D-19/D-20/D-21/D-22/D-23/D-24) deferred after validate-during-impl verification against the current Claude Code 2.x plugin reference revealed that several plan premises don't match documented feature semantics — see the "Deferred (plan vs. reality)" section below. Re-plan in a follow-up cycle with feature constraints verified up-front. Same two directives applied — *validate every assumption during implementation* and *no backward-compat hedging — ship clean implementations only*.

### Added
- **`references/rubrics/dev.md`** — authoritative grading rubric for the `dev` workflow's verifier. Defines: verdict vocabulary (`satisfied | needs_revision | failed`), status mapping to existing devt vocabulary (`VERIFIED | GAPS_FOUND | FAILED | DONE_WITH_CONCERNS`), required Level 1-5.5 verification bars per AC, `revisions[]` array shape, and the satisfied-vs-needs_revision-vs-failed decision tree. The verifier reads its body of *techniques* from `agents/verifier.md` and reads *what passes* for the active workflow_type from this rubric. New verifier-using workflows (none today) will need a rubric — smoke test enforces.
- **`verification.json` sidecar** registered in `state.cjs::JSON_SIDECAR_SCHEMAS` (status whitelist mirrors `ARTIFACT_SCHEMA`; verdict whitelist is the grader enum; agent gated to `verifier`). The verifier emits BOTH `.md` (human review) and `.json` (workflow routing) at verdict time. JSON is authoritative for control flow.
- **`workflow.max_iterations: 3`** in `bin/modules/config.cjs` DEFAULTS. Centralises the verifier-retry cap. Was hardcoded at "VERIFY_ITER 0-1 → RETRY, 2 → PRUNE" inline in `dev-workflow.md`. No opt-in flag (per no-legacy-trash directive — the grader retry ships unconditionally, not behind a `workflow.grader_loop: bool` toggle as the plan originally proposed).
- **`revisions[]` structured retry contract** — when verdict is `needs_revision`, the sidecar carries one entry per unmet AC: `{id, criterion, level_reached, level_required, gap, evidence}`. The orchestrator passes this list directly into the next programmer dispatch's `<review_feedback>` block. Programmer addresses each entry by AC-* id; no markdown re-parsing required on retry.

### Changed
- **`agents/verifier.md`** — context_loading now reads `.devt/state/workflow.yaml::workflow_type` then loads the matching rubric from `references/rubrics/<type>.md`. Verdict step writes both `verification.md` and `verification.json` (sidecar shape documented inline). The "How to write the sidecar" section uses a date-captured-to-shell-var pattern so the agent body stays byte-stable (no inlined `$(date ...)` in prose that would invalidate prefix cache; D-10 sub-2 lint enforces). Verifier body grew from 287 → 357 lines, well under the 500-line agent budget.
- **`workflows/dev-workflow.md` Step 6.5 verify gate** reads `verification.json` via `state read-sidecar` instead of grepping `verification.md` for status. Iteration cap now comes from `config get | jq -r '.workflow.max_iterations'` instead of the hardcoded `0-1/2` matrix. Routing dispatches on the lowercase `verdict` field; the uppercase `verdict` field on `workflow.yaml` state stays in the existing devt vocabulary (`GAPS_FOUND` etc.) for `/devt:next` and `/devt:status` compatibility — two `verdict` fields with disjoint scopes, documented inline in the gate-check section.
- **Programmer's `<review_feedback>` block** in the dispatch template explicitly differentiates code-review retry (read `review.md`) vs. verifier retry (read `verification.json` and address each `revisions[]` entry by AC id). The structured list is the contract — no markdown re-parsing.
- **D-11 consumer wiring — inline guardrails in dispatch** (`workflows/dev-workflow.md` + `agents/{programmer,code-reviewer}.md`). The init payload's `inline_guardrails` field (~27KB of golden-rules + engineering-principles + generative-debt-checklist, capped at 64KB) shipped in v0.32.0 as data plumbing only. v0.34.0 wires the two consumer agents that read all three files on every dispatch: dev-workflow.md context_init now captures the inline content across the workflow run; programmer + code-reviewer dispatch templates inject a `<guardrails_inline>` block (with `<golden_rules>`, `<engineering_principles>`, `<generative_debt_checklist>` sub-tags) into agent context; agents prefer the inline block when present, fall back to on-disk Reads only when the workflow omits it (which only happens when the 64KB cap triggers null fallback). Scope limited to the 2 agents that read all 3 files (per plan guidance — other dev agents read fewer guardrails, so extending to them would risk inflating prefix bytes without offsetting Read savings).

### Smoke
- **+3 new assertions** (`scripts/smoke-test.sh`):
  - `references/rubrics/dev.md` exists (rubric coverage for the only verifier-using workflow today).
  - Drift guard: any future workflow file that dispatches `devt:verifier` whose workflow_type is not in the `VERIFIER_USING_WORKFLOWS` allow-list fails the build — keeps coverage honest as new workflows surface.
  - `verification.json` registered in `JSON_SIDECAR_SCHEMAS` + `workflow.max_iterations` default present in config DEFAULTS.
- **318 total pass** (was 315 at v0.33.0).

### Validation
- Manual sidecar round-trip: schema-conformant `verification.json` passes all three validation flags (`valid_status`, `valid_verdict`, `valid_agent`). Negative test: orchestrator-only outcome `max_iterations_reached` is rejected as a verifier emission (`valid_verdict: false`), enforcing the contract that the verifier itself has no iteration awareness.
- Concurrent locking test (`scripts/test-locking.cjs`): 3/3 pass — no regressions from the state.cjs schema addition.

### Plan-vs-impl deviations (validate-during-impl directive)
- **5 rubrics planned, 1 shipped**. The original plan called for rubrics covering `dev / quick_implement / debug / code_review / arch_health_scan`. Validation found only `dev` invokes the verifier (`grep verifier workflows/quick-implement.md` → empty; the other workflows have their own terminal agents — debugger, code-reviewer, architect — producing their own verdicts in their own artifacts). Shipping 5 rubrics for 4 non-verifier-using workflows would be the speculative scaffolding the no-legacy directive forbids. Smoke test allow-list designed for one-line expansion when a real second verifier-using workflow lands.
- **No `workflow.grader_loop` opt-in flag** — the plan proposed shipping behind a boolean toggle for safer rollout. Overridden by no-legacy-trash directive in the handoff: devt has no production usage; new contract ships at its final value.
- **Verifier enum dropped `max_iterations_reached`** — the plan listed it as the fourth verifier verdict (CMA vocabulary parity). Validation found this conflates orchestrator-level outcome with verifier-level emission. The verifier has no iteration awareness — it can only see the artifacts in front of it. `max_iterations_reached` is now an orchestrator outcome (state field `repair=PRUNE` set when `verify_iteration >= MAX_ITER`); the sidecar's last `verdict=needs_revision` is preserved as historical evidence.

### Deferred (plan vs. reality — re-plan needed)
After D-16 + D-11 shipped, the remaining Wave 4-5 items were verified against the current Claude Code 2.x plugin and skill reference (`code.claude.com/docs/en/plugins-reference`, `/skills`, `/sub-agents`, `/hooks`). Three plan premises don't survive contact with the actual feature schemas:

- **D-21 ("FileChanged with glob matcher for memory-auto-index.sh") DEFERRED.** The `FileChanged` hook matcher accepts **literal filenames only**, not glob paths. Quote from the reference: *"literal filenames to watch ... example `.envrc|.env`"*. Memory files have dynamic IDs (`ADR-NNN.md`, `CON-NNN.md`, ...) generated on promotion — they cannot be enumerated at plugin-install time. The "biggest leverage hook win" the plan claimed for D-21 doesn't have a real mechanism. Setup, InstructionsLoaded, and PostToolBatch are real and usable, but they're solutions looking for problems in current devt — defer until a concrete need surfaces.
- **D-22 ("mcp_tool hook type to replace memory-auto-index shell spawn") DEFERRED.** The `mcp_tool` hook type is real and well-documented. Implementing it for memory-auto-index requires adding a **write tool to the currently read-only `bin/devt-memory-mcp.cjs`** (which exposes 10 read-only helpers + a SELECT-only escape hatch). That's a security-posture change with its own design surface — distinct enough from D-22's "modernize hook type" framing to deserve its own plan + threat model.
- **D-23 ("Skill `paths:` glob auto-trigger saves ~700-1k tokens per dispatch") DEFERRED.** The plan claimed `paths:` *expands* skill activation cheaply. The reference says the opposite: *"Glob patterns that **limit** when this skill is activated. When set, Claude loads the skill automatically **only when** working with files matching the patterns."* It narrows description-based activation, doesn't supplement it. Only `tdd-patterns` (already path-scoped to test files) actually fits the model where path-context outclasses description-match. The other skills the plan listed (api-docs-fetcher, architecture-health-scanner) have broader description triggers that paths would WEAKEN, not strengthen.
- **D-19/D-20 (devt-coordinator + userConfig migration), D-24 (research-fork skill), D-25 (`${CLAUDE_PLUGIN_DATA}`), D-26 (channels), D-27/D-28 (escape hatches/conditional skill preload)**: real Claude Code 2.x features — but each is a substantive UX-changing or architectural addition with its own justification, threat model, and rollout. Bundling them into a Wave 4 batch on speculative grounds violates no-legacy-trash directive. Each gets its own plan + concrete need-driver before implementation.
- **D-10 sub-1 (trim non-programmer agent bodies to ≤250 lines)**: still pending `/devt:tokens --compare` measurement data to identify trim targets evidence-driven. Verifier just grew from 287 → 357 lines as part of D-16 and remains well under the 500-line ceiling; line-count trimming on a guess could degrade agent capability without measurable token win.

## [0.33.0] - 2026-05-12

Wave 3 of the coordination-quality-tokens improvement series: handoff quality + structured-data foundations. Three items shipped (D-15, D-17, D-18); one deferred to Wave 4 (D-16) where it gets full context-budget room and measurement data to inform implementation choices. Same two directives applied — *validate every assumption during implementation* and *no backward-compat hedging — ship clean implementations only*.

### Added
- **`bin/modules/logger.cjs::appendJsonl`** — shared forensic-log helper with PIPE_BUF (4096 - 64 bytes) per-record cap. POSIX guarantees `write()` calls ≤ PIPE_BUF are atomic, so concurrent writers never interleave bytes. On oversize the helper appends a `{_truncated:true, _original_bytes, _cap, ts, + preserved identifying keys}` stub so the file stays parseable JSONL line-by-line. Zero-deps. Returns `{ok, bytes}` or `{ok:false, reason}`.
- **`state.cjs::readSidecar(name)`** + `JSON_SIDECAR_SCHEMAS` registry + `state read-sidecar` CLI subcommand. Reads + validates JSON sidecar artifacts against per-sidecar enum schemas. v0.33.0 registers `impl-summary.json` (programmer-authored). Returns `{ok:true, file, data, validation:{valid_status, valid_verdict, valid_agent}}` on hit. Adding a new sidecar = one entry in the registry + agent body documents the shape + consumer workflow uses `readSidecar`.
- **`impl-summary.json` canary** — programmer now writes a JSON sidecar alongside `impl-summary.md`. Fields: `status` (DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT), `verdict` (PASS/FAIL/INDETERMINATE), `agent`, `workflow_type`, `iteration`, `files_changed[]`, `tests_added[]`, `requirements_covered[]`, `requirements_missing[]`, `concerns[]`, `next_agent_hints{}`. JSON is authoritative for workflow routing; markdown stays for human review. Verifier reads `requirements_covered/missing` directly instead of parsing markdown — unlocks D-16's outcome-grader retry loop in Wave 4.

### Changed
- **`hooks/pre-flight-guard.sh` deny log: `.log` → `.jsonl`** (`bin/modules/logger.cjs::appendJsonl` via `process.env.CLAUDE_PLUGIN_ROOT`; fallback inline `appendFileSync` for direct-test invocations). Unified forensic-log format across devt — same JSONL shape as `_mcp-trace.jsonl`. One record per line: `{mode, ts, action, file_path, reason}`. `jq` and any structured log tool now parse both logs uniformly.
- **`skills/memory-pre-flight/SKILL.md`** updated "Recovering from a deny" section for JSONL format with field-level schema and parsing examples.
- **`CLAUDE.md` Pre-Flight Protocol entry** documents the v0.33.0 JSONL migration + shared `logger.cjs` helper + 4KB PIPE_BUF cap.
- **`state.cjs::extractStatus` first-50→first-100 line cap** (Wave 2 carryover, mentioned here for completeness; assertion added in Wave 2).

### Deferred (to Wave 4)
- **D-16 (Outcome-grader rubrics + bounded retry)** — multi-file architectural change touching `references/rubrics/`, `agents/verifier.md`, `workflows/dev-workflow.md` retry loop, `bin/modules/config.cjs` schema. Builds on D-15's JSON sidecar (now landed) for `verification.json` verdict shape. Deferred to Wave 4 where it gets full context-budget room and measurement data from `/devt:tokens --compare` to inform iteration-cap and grader-loop scoping.

### Smoke
- **+8 new assertions**:
  - `bin/modules/logger.cjs` exports `appendJsonl`
  - `hooks/pre-flight-guard.sh` writes to `preflight-denies.jsonl` (was `.log`)
  - Live-fire produces valid JSONL with v0.33.0 schema (`mode/ts/action/file_path/reason`)
  - v0.30.5 deny-log assertion updated to JSONL schema (parse-by-line)
  - `state read-sidecar impl-summary.json` happy path returns `valid_status`+`valid_agent`
  - `state read-sidecar` rejects unregistered sidecar names (schema gate)
  - `state read-sidecar` rejects path traversal in file name
  - `programmer.md` documents the `impl-summary.json` shape
  - Skill→skill coupling validator: every `skills/<name>/SKILL.md` reference resolves to existing file (catches future broken links in the 5-skill Graphify-routed transitive chain)
- **315 total pass** (was 307 at v0.32.0; 300 at v0.31.0; 287 at v0.30.6; 273 at v0.30.5).

## [0.32.0] - 2026-05-12

Wave 2 of the coordination-quality-tokens improvement series: token economics + hook overhead. Five items planned; three shipped substantively (D-13, D-14, D-11 plumbing, D-10 sub-2), two refined to deferral after validation showed the cost-benefit didn't hold up (D-10 sub-1, D-12). Same two directives applied throughout — *validate every assumption during implementation* and *no backward-compat hedging — ship clean implementations only*.

### Added
- **`init.cjs` returns `inline_guardrails`** (`bin/modules/init.cjs`). The 3 plugin-shipped guardrail files (`golden-rules.md`, `engineering-principles.md`, `generative-debt-checklist.md`) are loaded into the compound init payload at ~27KB total (capped at 64KB; on overflow falls back to path-only + warning). Dev agents read these on every dispatch; this exposes the content one level up so future orchestrator wiring can inline them in dispatch prompts and eliminate per-dispatch Read tool calls. **Data plumbing only this release** — agents still Read the on-disk files; consumer wiring deferred to Wave 3 once `/devt:tokens --compare` measures the prompt-cost-vs-Read-savings trade-off direction. Top-level constants `INLINE_GUARDRAILS` (list) + `MAX_INLINE_BYTES` (64KB) for easy auditing.

### Changed
- **`hooks/prompt-guard.sh` consolidates 6 grep shellouts into a single Node block.** Was 7 subprocess spawns per Edit/Write to `.devt/state/` (6 × `echo $CONTENT | grep -qiE PATTERN` for injection patterns + 1 Node block for invisible-Unicode). All 7 checks now run in one Node spawn; patterns mirror the prior bash regex set verbatim. Hot-path latency reduction proportional to the number of grep spawns saved.
- **`hooks/workflow-context-injector.sh` caches state-read result keyed by `workflow.yaml` mtime.** Was paying ~30-60ms cold-start to spawn `node devt-tools.cjs state read` on every UserPromptSubmit event. Cache lives at `$TMPDIR/devt-cache/wf-state-<projhash>.json`; mtime-pinned to source so any state.cjs::updateState write auto-invalidates the cache. Cross-platform: BSD/macOS `stat -f` + GNU/Linux `stat -c` fallback, universal `shasum`, `TMPDIR` with `/tmp` fallback. Live benchmark: 158ms cold → 77ms warm → 132ms after mtime touch (~50% reduction on repeat fires within an active workflow).
- **`bin/modules/state.cjs::extractStatus` reads first 100 lines** (was 50). Long verifier reports with prologue + scope + requirements-coverage sections push the `## Status` line past the original cap, causing `validateConsistency` to false-flag artifacts that DO have a valid status, just one written deeper in the file. Cross-reference at v0.31.0: every agent's "Status field is one of: ..." documentation aligns with the corresponding `ARTIFACT_SCHEMA` whitelist — current state is clean. The new line cap covers every realistic prologue length devt agents write today.

### Validated-as-marginal (no code change)
- **D-12 from the plan ("Pre-Flight Brief inline injection in dispatch")** — the audit's "5-10k token savings per STANDARD workflow" estimate did not survive close inspection. The Brief is small (~1-2KB typical). Inlining saves 4 Read tool calls per STANDARD but adds the same content to dispatch prompts; net token cost is roughly neutral, only round-trip count is reduced. The actual win is at most 4 Read round-trips per workflow — not worth the architectural change. Future wave can revisit if `/devt:tokens` measurement shows Read overhead is meaningfully larger than estimated.
- **D-10 sub-1 from the plan ("trim non-programmer agent bodies from 286-320 to ≤250 lines")** — deferred to Wave 3 with measurement data. Editorial work that benefits from knowing which agents actually contribute most to prefix cost before guessing what to cut. The 500-line ceiling is enforced; the 250-line target is aspirational and trim-what-matters should be evidence-driven.

### Smoke
- **+5 new assertions** (`scripts/smoke-test.sh`):
  - `ARTIFACT_SCHEMA` drift prevention: parses every agent's "Status field is one of: ..." docs and confirms each emitted value is in the corresponding artifact's whitelist (bash 3.2-compatible via parallel arrays; macOS ships 3.2 default).
  - `extractStatus` cap is 100 lines (was 50), enforced by literal-string match.
  - `prompt-guard.sh` has zero remaining `grep -qiE` shellouts (D-13 regression guard).
  - `workflow-context-injector.sh` references the cache dir.
  - `prompt-guard.sh` still detects "ignore all previous instructions" after consolidation (no detection regression).
  - `init.cjs` returns `inline_guardrails` with 3 keys, non-empty content, total bytes in [10KB, 64KB].
  - Byte-stability lint: no `Date()` / `Date.now()` / `$(date)` / ISO timestamp / "current timestamp" in agent or skill **prose** (code-fenced documentation examples are allowed via 3-line-of-fence proximity check). Current state is clean across all 10 agents + 16 skills. Catches future contributions that would silently invalidate the prefix cache.
- **307 total pass** (was 300 at v0.31.0; 287 at v0.30.6; 273 at v0.30.5).

## [0.31.0] - 2026-05-12

Wave 1 of the coordination-quality-tokens improvement series (`/Users/emrec/.claude/plans/polymorphic-orbiting-popcorn.md`): coordination clarity + observability surfacing. All changes guided by two recurring directives — *validate every assumption during implementation, don't trust the plan blindly* and *no backward-compat hedging — devt has no production usage yet, ship clean implementations only*.

### Added
- **`/devt:tokens` and `/devt:mcp-stats` slash commands** (`commands/tokens.md`, `commands/mcp-stats.md`, `workflows/tokens.md`, `workflows/mcp-stats.md`). Surfaces the existing `bin/modules/token-report.cjs` (parses Claude Code JSONL session logs for `cache_read_input_tokens` + per-session usage + `--baseline`/`--compare` for measuring optimization waves) and `bin/modules/mcp-stats.cjs` (per-tool MCP call counts, error rates, p50/p95/p99 durations from `.devt/memory/_mcp-trace.jsonl`). Both modules already shipped full telemetry; this release just adds the slash-command discoverability. Critical for Wave 2's prefix-hygiene measurement.
- **`init.cjs::parseSkillIndex` + `init.cjs::resolveSkills`** (`bin/modules/init.cjs`). Zero-deps nested-YAML parser for `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml`, plus a merge resolver that combines `.devt/config.json::agent_skills` (per-project override, wins on overlap) with skill-index defaults (plugin defaults). Returns `{ <agent_type>: [...skill-names...] }` as the new `resolved_skills` field in the compound init JSON payload. **Previously** six workflow files told the orchestrator LLM to "consult `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml`" as a free-form fallback when `agent_skills` wasn't set — three-way merge resolution happened ad-hoc inside the LLM. Now deterministic, cached in the compound init, costs zero LLM tokens to resolve.
- **`agents/programmer.md` surfaces `state read-section`** for surgical re-reads (iteration > 1 after phase-scoped `review.md` feedback). The CLI shipped in v0.30.4 but had no agent-level guidance for when to use it versus a whole-file Read. Refined from the plan's "wire into 7 dispatch sites" after mid-flight validation showed most reader sites (tester, code-reviewer, verifier) legitimately need whole-file plan context.

### Changed
- **`workflows/dev-workflow.md` programmer dispatch sets `isolation: "worktree"` under `autonomous_chain`**. Autonomous fix loops now land in a temporary git worktree (auto-cleaned by Claude Code if no edits, diff surfaced before merge on success) instead of clobbering the user's in-flight checkout. Per the no-legacy directive: no opt-out config key, always-on for autonomous mode. Interactive (non-autonomous) invocations still edit the user's checkout directly — that's the expected pattern for human-supervised work.
- **`workflows/next.md` Step 2 leads with a PRIORITY GUARD blockquote** stating that `validation_status="warned"` takes precedence over the generic "Active workflow, phase known" branch. The warned-state branch was previously buried among other routing options and an LLM could match the generic branch first, silently advancing past a prior-phase validation warning. The guard makes the precedence explicit at routing time, not as ambient documentation at the end of the warned branch.
- **`workflows/{dev-workflow,quick-implement,autoskill,debug,create-plan,research-task}.md` — six workflows rewired to read `resolved_skills.<agent_type>` from the init JSON** instead of asking the LLM to consult skill-index.yaml in free-form prose. No remaining "consult skill-index.yaml" phrasing in workflows or agents — verified by smoke assertion.
- **`agents/programmer.md::context_loading` no longer duplicates the Pre-Flight Brief read instruction**. The `memory-pre-flight` skill (preloaded by all 8 dev agents via `skills:` frontmatter) is the canonical source — its body at L55-74 contains FRESH/STALE/missing status handling. Programmer's step 0 duplicated this and was the *only* agent body that did, creating drift where CLAUDE.md claimed uniform enforcement but only programmer had the in-body reminder. Removing the duplication aligns all 8 preloading agents on the skill body's instruction.
- **`agents/tester.md::run` step adds a bounded 5-iteration inner-loop budget** referencing the existing `agents/programmer/fix-loop-protocol.md`. Programmer already had this discipline; tester's prior "fix immediately, do NOT defer" with no escalation criteria could loop indefinitely. Sharing the same protocol keeps the bounded-loop discipline DRY across both implementation agents.

### Removed
- **`templates/task-handoff-template.md`** — dead contract. Referenced only at `workflows/dev-workflow.md:126` ("use the structured handoff format"), but every actual Task() dispatch at L710+ uses an entirely different XML shape (`<task><context><spec>...</spec></context>`). The template's Markdown structure (`# Task / ## Context / ## Acceptance Criteria`) was never followed. Deleted the file AND the L123-136 `<task_handoff>` block in dev-workflow.md. The canonical handoff format IS the Task() dispatch example at L710+.

### Validated-as-invalid (no code change)
- **D-5 from the plan ("parallelize researcher ⊥ architect dispatch")** — premise rejected after tracing the actual input-dependency chain. Research (Task at L381) reads `spec.md`+`decisions.md` → `research.md`. Auto-Plan (inline at L416) uses research.md → `plan.md`. Step 2.7 arch-health (Task at L569) reads plan.md (L580). So research → plan → arch-health is chronologically required; they cannot fan out in parallel. The genuine independent pair is research ⊥ scan, but scan is inline (main session), not a subagent — converting it would add prefix-injection cost that exceeds the parallelization saving.
- **Step 7+8 (docs ⊥ retro) parallelism at L950** has a subtle ordering bug — retro reads `docs-summary.md` (L997) which is written by docs-writer. True parallelism gives retro a missing-or-stale docs-summary. The `(if exists)` tolerance papers over this. Not fixed in this release; flagged for a future wave.

### Smoke
- **+12 new assertions** (`scripts/smoke-test.sh`): no orphan `templates/` references; `/devt:tokens` and `/devt:mcp-stats` command + workflow files exist; `next.md` has the literal `PRIORITY GUARD` token adjacent to `validation_status`; `init.cjs` returns `resolved_skills` with the expected agents and non-empty arrays; no workflow or agent still references the dead "consult skill-index.yaml" phrasing; `programmer.md` references `state read-section` for surgical re-reads; `memory-pre-flight` skill references `preflight-brief.md`; no agent body duplicates the preflight-brief.md read instruction; `dev-workflow.md` programmer dispatch documents `isolation:worktree` for autonomous; `tester.md` cross-references `fix-loop-protocol`. **300 total pass** (was 287 in v0.30.6).

## [0.30.6] - 2026-05-12

### Fixed
- **Concurrent-session FTS5 rebuild race** (`bin/modules/memory.cjs::rebuildIndex`, `bin/modules/state.cjs::acquireLock`). Two Claude sessions editing `.devt/memory/**.md` within the 5s debounce window both fired `memory-auto-index.sh`, each opening its own `node:sqlite` handle and racing through the DELETE→INSERT transaction. Per-mtime debounce stamp doesn't cover cross-session contention. Added a file lock around `rebuildIndex` using the existing state lock pattern — `acquireLock` now accepts an optional `lockDir` parameter (defaults to state dir, backward-compatible for all existing callers). On contention, `rebuildIndex` returns `{ok:false, reason:"index_in_progress"}` so the debounce timer picks it up on the next cycle instead of waiting indefinitely. Heavy DB-transaction body extracted to `rebuildIndexLocked` for clarity.
- **`autonomous_chain` stale-flag dispatch** (`workflows/next.md`, `workflows/ship.md`). A stale `autonomous_chain=ship` value from a prior session re-triggered `/devt:ship` on the next `/devt:next` invocation — potentially shipping work from an unrelated context. `ship.md` never cleared the flag and `next.md` only cleared it on non-autonomous invocations. Fixed by adding consumer-site clears: `next.md` clears `autonomous_chain` BEFORE dispatching `/devt:ship` from the chain branch (mirrors the existing non-autonomous cleanup pattern); `ship.md` clears at the start of preflight as defense-in-depth for direct invocations.
- **Scratchpad cross-workflow bleed** (`bin/modules/state.cjs::truncateArtifact`, `workflows/{dev-workflow,quick-implement,debug}.md`). Two back-to-back clean workflows in the same session inherited each other's `.devt/state/scratchpad.md` — stale `PREFLIGHT <ts> edit <path> :: <ids>` lines from workflow A falsely satisfied the pre-flight-guard hook for unrelated files touched in workflow B. `/devt:cancel-workflow` archives scratchpad via `state reset`; clean completion didn't. Added `state.cjs::truncateArtifact(name)` with a `TRUNCATABLE_ARTIFACTS` whitelist (currently `scratchpad.md` only — guards against accidental wipe of `plan.md`/`impl-summary.md`/etc.), exposed as `state truncate-artifact <name>` CLI. Wired into finalize for the three workflows that dispatch dev agents writing PREFLIGHT lines; placed AFTER `review_deferred` so deferred findings reach the user before truncation.

### Changed
- **5 non-atomic write sites routed through `io.cjs` atomic helpers** (`bin/modules/{setup,update,discovery,deferred,health}.cjs`). CLAUDE.md claims all writes route through `atomicWriteFileSync` / `atomicWriteJsonSync`; the audit found 5 clean overwrite sites still using raw `fs.writeFileSync` (torn-write risk on crash, no `.tmp` cleanup). Migrated: `deferred.cjs:54` (HEADER bootstrap), `discovery.cjs:458` (`_suggestions.md` write), `update.cjs:142` (update-check cache → JSON), `setup.cjs:343` (gitignore full-create on ENOENT), `setup.cjs:461` (post-commit hook install — two-step atomic write + `fs.chmodSync(0o755)` since the helper doesn't preserve the `mode` option), `health.cjs:419` (gitignore bootstrap fallback). Three `fs.appendFileSync` calls (setup:332 + health:417 gitignore appends, MCP trace at devt-memory-mcp.cjs:385) kept as-is — append semantics differ from atomic-overwrite; converting would change concurrent-safety properties.
- **`acquireLock`/`releaseLock` exported from `state.cjs`** so other modules can serialize against arbitrary directories (memory rebuild today; broader use as needed).

### Smoke
- **6 new security.cjs assertions** (`scripts/smoke-test.sh`): `validatePath` traversal/null-byte/empty-input/non-string rejection plus a realpath'd happy path (macOS `/var → /private/var` symlink resolution required); `validateShellArg` null-byte/`$()`/backtick/empty rejection; `safeJsonParse` happy + malformed + size-cap + non-string; `scanForInjection` clean text + override-instruction + role manipulation + `<system>` tag + strict-mode zero-width unicode; `maskSecrets` `MAX_MASK_DEPTH` (50) cap with 60-deep nested input. Documents inline that the `<|system|>` pipe-bracket form is NOT in the current regex set — a future coverage-expansion opportunity, intentionally untested here.
- **3 new atomic-write + truncate-artifact assertions**: post-D-W0-5 invariant that 5 migrated modules contain zero remaining `fs.writeFileSync`; `state truncate-artifact scratchpad.md` happy path + non-whitelisted rejection + path-traversal rejection.
- **2 new autonomous_chain assertions**: `next.md` consumer-clears `autonomous_chain` before dispatch; `ship.md` clears at start.
- **3 new scratchpad-truncate-on-finalize assertions**: all three workflows (dev/quick-implement/debug) call `state truncate-artifact scratchpad.md` at finalize.
- **287 total pass** (was 273). One pre-existing `grep -c PATTERN file || echo 0` bash-bug fixed in the W0-5 atomic-write assertion: `grep -c` exits non-zero on no-match but still prints "0", so the `|| echo 0` doubled the count.

## [0.30.5] - 2026-05-08

### Added
- **Forensic deny log for the pre-flight guard** (`hooks/pre-flight-guard.sh`, `skills/memory-pre-flight/SKILL.md`). Every `decision: "deny"` (block mode) and every advisory (warn mode) now appends one line to `.devt/state/preflight-denies.log` — single-writer, append-only, gitignored under existing `.devt/state/` rules. Format: `<mode> <ISO-ts> <action> <file_path> :: missing PREFLIGHT line`. Closes the silent-stall failure mode where a subagent dispatched without the `devt:memory-pre-flight` skill received a deny it didn't know how to satisfy, then went silent (no streaming output) for 600s until Claude Code's stream watchdog killed it. With the log, recovering agents read `.devt/state/preflight-denies.log` first to see their own prior denied attempts, then write the missing PREFLIGHT lines to scratchpad in order. Hook stays stateless — log is pure side-effect, never read by the hook itself. Wrapped in try-catch so a log failure can never block the deny path. Survives `state reset` via the v0.30.4 archive ring buffer (`.devt/state/.archive/<ts>/preflight-denies.log`), so post-mortem of stalled workflows is possible after the workflow finishes.
- **`memory-pre-flight` skill documents the deny-recovery sequence** with explicit Read-log → Append-PREFLIGHT-lines → Retry steps. All 8 dev agents preload the skill, so the recovery protocol propagates without per-agent prompt edits.

### Changed
- **`workflows/dev-workflow.md` Step 1 gains a CONTRACT callout** above the `state update` line: "Execute the next bash block VERBATIM. Do not paraphrase `workflow_type=dev` to `workflow_type=workflow` (the slash-command name)." Addresses the orchestrator-deviation bug where an agent invoked `/devt:workflow` and improvised `workflow_type=workflow` instead of executing the workflow file's `workflow_type=dev` literal — the entire downstream stall traced back to this single deviation. The v0.30.4 alias hint catches drift after the fact; this callout prevents drift in the first place.
- **`CLAUDE.md` Two-Tier Pre-Flight Protocol entry updated** to mention the forensic deny log and point at the skill's recovery section.

### Fixed
- **Silent watchdog stalls when subagent hits a deny without the memory-pre-flight skill loaded** — fixed by giving the agent its own deny history via the new log so it can break out of silent reasoning and write the missing PREFLIGHT lines on retry. Root cause was orchestrator drift (separate fix above) plus agents lacking forensic visibility into hook denies (this fix).

### Smoke
- **2 new assertions** (`scripts/smoke-test.sh`): hook deny appends correctly to `preflight-denies.log`; deny JSON contract (`decision: "deny"`) still emitted alongside the log so the existing hook protocol is preserved. 273 total pass (was 271).

## [0.30.4] - 2026-05-08

### Added
- **State ring buffer — `state reset` archives instead of deleting** (`bin/modules/state.cjs::resetState`, `bin/modules/config.cjs` DEFAULTS). Non-exempt artifacts in `.devt/state/` are now moved to `.devt/state/.archive/<ISO-timestamp>/` instead of unlinked. Solves the "I started a second `/devt:debug` and lost my prior investigation" pain — past `debug-context.md`, `plan.md`, `decisions.md`, etc. survive a workflow restart and can be inspected for continuity. Ring buffer size configurable via new `state.archive_runs` key (default 5; set to 0 to disable archiving entirely for projects that prefer pure-ephemeral state). `.archive/` itself is added to `RESET_EXEMPT` so the ring survives subsequent resets, and to `pruneState`'s skip set so it doesn't show up as orphan noise. Eviction is oldest-first by ISO-timestamp directory name (lexicographic = chronological — no Date parsing needed). Falls back to copy+remove on `EXDEV`/cross-device rename failure.
- **`state read-section --file <name> --section <heading>`** (`bin/modules/state.cjs::readSection`). Slice a single markdown heading's body out of any `.devt/state/*.md` file instead of reading the whole artifact. Token-saver for agent dispatches: a 4-agent dev workflow that re-reads `plan.md` + `decisions.md` + `preflight-brief.md` at every phase boundary previously paid ~15K input tokens per run on full-file reads; targeted section reads cut that to ~2-3K. Two-pass match: exact heading text wins first, prefix match falls back so `--section "Phase 2"` finds `## Phase 2: Implementation`. Heading level is inferred from the query (`"## Phase 2"` matches H2 only; bare `"Phase 2"` matches first heading at any level). Slice runs from the matched heading to the next same-or-higher level heading, keeping deeper subsections (H3, H4) inside the slice. Returns `{ ok, file, section, level, match: "exact"|"prefix", content }` so callers can detect ambiguity.
- **`/devt:uninstall` command** (`commands/uninstall.md`, `workflows/uninstall.md`). Replaces the verbose 60+ line manual reset/uninstall instructions in the README with a guided AskUserQuestion-driven flow offering four modes: **Reinit** (re-scaffold rules + config from template; keeps memory + lessons + deferred queue) → **Project reset** (wipe `.devt/` only; backs up to `.devt.bak.YYYYMMDD-HHMMSS/` first) → **Full reset** (wipe `.devt/` + scattered files at repo root: `.mcp.json`, `.claude/agent-memory/devt-debugger/`, devt-managed git hooks, devt entries in `.gitignore`) → **Plugin uninstall** (advisory — auto-detects install type via `update install-type` and instructs the user; never auto-runs because plugin install lifecycle is user-owned). Destructive modes get a second confirmation prompt before any `rm -rf`. Always backs up before deleting so the user can `mv` the backup back to recover.

### Changed
- **README restructured for reader-journey flow** (`README.md`). New section order: What is devt → **Setup** → **Configuration** → Use cases → **Dependencies & integrations** → Features → How it works → The problem it solves → Reference → Releases. Setup moved up from line 137 to line 50 (above the fold). Configuration promoted from H3 inside §Reference to its own H2. New §Dependencies & integrations section absorbs the old §Stack table and expands it with concrete pipeline-by-pipeline benefit tables for Graphify (with surface-by-surface "without/with" comparison), uv, claude-mem, plus vendored components (devt-memory MCP, FTS5, atomic write helpers, security utilities). §Stack & tools used dropped (folded into Dependencies). The problem narrative moves later — now reads as "why we built this" after the user has seen what it does.
- **README §Reset slimmed** from 60+ lines of manual bash blocks to a 14-line section pointing at `/devt:uninstall` with a 4-mode summary table.
- **README council section expanded** with a 5-row advisor table (Contrarian / First Principles Thinker / Generalizer / Newcomer / Pragmatist), the three-tension framing (Contrarian ⇄ Generalizer, First Principles ⇄ Pragmatist, with Newcomer keeping everyone honest), the anonymized peer-review + Chairman synthesis flow, when the council fires (manual via `/devt:council "<question>"`, automatic off-ramp from `/devt:clarify` and `/devt:specify` per `references/council-offramp.md`), and the `--mixed-models` flag for opus/sonnet/haiku diversity at extra token cost.
- **README documents `scope_mode` config** (`surgical` default vs `boyscout`) with a side-by-side behavior table and guidance on when to pick each. Was previously only in `CLAUDE.md` Key Conventions and `golden-rules.md` Rule 5.
- **README claude-mem URL fixed** to [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) (was incorrectly pointing at `anthropics/claude-mem`).
- **README graphify repo link added** at the top of the Graphify subsection ([github.com/safishamsi/graphify](https://github.com/safishamsi/graphify)).
- **`workflow_type` validator now suggests aliases** (`bin/modules/state.cjs::validateStateEntry`). When an agent passes a hallucinated value (e.g. `workflow_type=workflow` inferred from the slash-command name, or `workflow_type=implement` from the phase name), the warning now lists all valid registry values and, for known false-friends, surfaces `Did you mean "X"?`. Mapped aliases: `workflow→dev`, `implement→quick_implement`, `review→code_review`, `arch→arch_health_scan`. Validator behavior unchanged for valid inputs (no warning) and unknown values without a mapped alias (warning + valid list, no suggestion).
- **Smoke gains 4 assertions** (`scripts/smoke-test.sh`): `state reset` archives non-exempt artifacts to `.archive/<ts>/`; `state read-section` returns sliced content with a `match` mode field; `state read-section` returns `ok:false` with `section not found` on miss; `workflow_type=workflow` produces the alias hint suggesting `dev`. 271 total pass (was 267).

## [0.30.3] - 2026-05-08

### Fixed
- **Graphify MCP scaffolding switched to v0.7.10+ canonical invocation** (`bin/modules/setup.cjs`). Upstream removed the `graphify mcp` subcommand entirely — the MCP server is now `python -m graphify.serve <graph.json>`. devt's previous scaffold pattern `command: "graphify", args: ["mcp", "--project", "."]` produced `unknown command 'mcp'` failures on every Claude Code session for users on graphify v0.7.10+. New scaffolding probes two launch paths in priority order: (1) `uv` and `graphify` both on PATH → registers `command: "uv", args: ["run", "--with", "graphifyy", "--with", "mcp", "-m", "graphify.serve", "graphify-out/graph.json"]` (matching graphify's own `__main__._antigravity_install` template); (2) `python3 -c "import graphify, mcp"` succeeds → registers `command: "python3", args: ["-m", "graphify.serve", "graphify-out/graph.json"]` for pip / pipx users without `uv`. Both paths use `graphify-out/graph.json` (project-relative) so the entry works in any cwd. If neither resolves but the binary is on PATH, an actionable hint points at the install path most likely to fix the user's setup.
- **Install hints across docs reordered** to lead with `uv tool install graphifyy[mcp]` (recommended — works for both CLI and MCP server) instead of `pip install graphifyy[mcp]` (works for CLI but MCP server still requires `uv` unless graphifyy is importable from system Python). Updated: `README.md` Optional integrations table, `workflows/preflight.md` install tip, `workflows/project-init.md` AskUserQuestion + install printout (now lists `uv tool` first, `pipx` second, `pip` third with note about `uv`-on-PATH requirement), `bin/modules/graphify.cjs` module docstring.

## [0.30.2] - 2026-05-08

### Fixed
- **Graphify MCP scaffolding now validates the `mcp` subcommand**, not just the binary's presence (`bin/modules/graphify.cjs::probeBinary`, `bin/modules/setup.cjs`). The previous probe only checked that `graphify --help` returned 0, so a user who installed the bare package (`uv tool install graphifyy` or `pip install graphifyy` — without the `[mcp]` extra) had a `graphify mcp --project .` entry written into project `.mcp.json` that produced `unknown command 'mcp'` failures every Claude Code session. `probeBinary` now accepts `{ subcommand }` and runs `<command> <subcommand> --help` instead, so setup correctly distinguishes three states: (a) binary missing — install hint as before; (b) binary present but `mcp` subcommand missing — new actionable hint pointing at `uv tool install --reinstall 'graphifyy[mcp]'` / `pip install --upgrade 'graphifyy[mcp]'`; (c) full support — register the MCP server entry. The other 3 `probeBinary` call sites (general "is graphify installed" checks in `setup.cjs::detectStack` post-commit-hook decision, the Graphify auto-enable config write, and `health.cjs::GRAPHIFY_MCP_UNREGISTERED`) keep the bare-binary semantics — they only need to know the binary exists, not whether it supports MCP.
- **Smoke assertion for project `.mcp.json` always fires** (`scripts/smoke-test.sh`). v0.30.1's "project `.mcp.json` correctly omits devt-memory" pass was conditioned on the file existing, which silently dropped on test machines where neither graphify (with MCP) nor claude-mem was installed. Added a parallel "project `.mcp.json` correctly absent" pass for the no-probes-succeeded path so the invariant is enforced in both states.

## [0.30.1] - 2026-05-08

### Fixed
- **Project `.mcp.json` no longer scaffolds the `devt-memory` server** (`bin/modules/setup.cjs`). Per Claude Code's plugin reference, `${CLAUDE_PLUGIN_ROOT}` substitution applies only to MCP configs at the **plugin root** (`<plugin-root>/.mcp.json` or inline in `plugin.json`) — project-level `.mcp.json` is treated as user-authored config with no plugin-context env vars, so the previously scaffolded entry produced a `Missing environment variables: CLAUDE_PLUGIN_ROOT` warning on every session and never started the server. The plugin's own `.mcp.json` (already present at the devt repo root) registers `devt-memory` correctly via `${CLAUDE_PLUGIN_ROOT}/bin/devt-memory-mcp.cjs` and starts the server automatically whenever devt is loaded as a plugin (no per-project copy needed). `setup.cjs` now writes only project-relative MCP servers (`graphify`, `claude-mem`) into project `.mcp.json`, conditional on their binaries being on PATH; if neither is present, the file is not created at all.
- **Smoke test assertion flipped** (`scripts/smoke-test.sh`). The "project `.mcp.json` scaffolded with devt-memory entry" check now asserts the *absence* of `devt-memory` from project `.mcp.json` (it must live in the plugin-root `.mcp.json`) and adds a positive assertion that the plugin-root `.mcp.json` registers `devt-memory` via the `${CLAUDE_PLUGIN_ROOT}` template. CI now enforces the architectural invariant.
- **Documentation reframed** (`README.md` §Vendored MCP server, `docs/MEMORY.md` §MCP Server, `commands/init.md`): the MCP server "ships with the plugin and registers automatically when devt is loaded" replaces the old "auto-registered in project `.mcp.json` at /devt:init" framing.

### Added
- **`bin/modules/io.cjs`** — shared atomic-write helpers (`atomicWriteFileSync`, `atomicWriteJsonSync`). Consolidates 12 inline `tmp + writeFileSync + renameSync` instances across 9 modules (state, config, deferred, memory, preflight, token-report, health, mcp-stats, weekly-report) plus `setup.cjs`'s local helper. Adds cleanup-on-rename-failure (unlinks the orphan `.tmp` if `EXDEV`/`EACCES`/`EBUSY` occurs, while preserving the original error). Future tweaks (cross-device fallback, `fdatasync` for true durability) are now single-file changes.
- **`bin/modules/security.cjs::maskSecrets` / `isSecretKey`** — defense-in-depth masking layer. Walks the merged config tree and replaces values whose key name is secret-shaped (exact-name set + `_secret`/`_password`/`_token`/`_key`/`_apikey`/`_credentials` suffixes; case-insensitive, substring-match avoided so `auth_strategy` isn't masked just because it contains `auth`). Wired into `config get` JSON output AND `init.cjs` workflow/review payload — anything that flows from config to LLM context now gets masked. Cycle/depth-safe (`WeakSet` + `MAX_MASK_DEPTH=50`); returns `[Circular]`/`[MaxDepth]` string sentinels so output stays JSON-serializable. Today's `DEFAULTS` carries no secrets, but `.devt/config.json` is user-extensible — the guard ships before users are tempted to add a custom token there.
- **`bin/modules/graphify.cjs::probeBinary(command, timeoutMs)`** — config-independent binary probe. Replaces 4 inline copies of `spawnSync("graphify", ["--help"], { timeout: 1500, stdio: "ignore" })` across `setup.cjs` (3 call sites) and `health.cjs`.
- **Direct smoke coverage for `bin/modules/io.cjs` and `bin/modules/security.cjs`** (`scripts/smoke-test.sh`, 4 new assertions, +1 net). `atomicWriteFileSync` round-trip + orphan-cleanup-on-rename-failure (verifies the EXDEV/EACCES/EBUSY branch by writing into an existing non-empty directory). `isSecretKey` + `maskSecrets` correctness across known names, suffix matches, case-insensitivity, and the `auth_strategy` substring-false-positive ward. `sanitizeForDisplay` strips protocol-leak markers (`<|assistant|>`) but preserves normal text. `maskSecrets` cycle-guard regression test (bug 888 — must return string sentinel, not the live cyclic object, so output stays JSON-serializable). These are the security/durability surfaces that `init.cjs` and every config-reading caller depend on; CI now enforces their behavior, not just their existence.

### Changed
- **`config get` accepts dot-notation path arg** (`bin/modules/config.cjs::run`). `node bin/devt-tools.cjs config get foo.bar.baz` returns `{key, value, found: true|false}`; bare `config get` still returns the full merged config (now masked). Previously `config get` ignored args entirely — asymmetry with `config set foo.bar=value` is closed. Read path includes a `FORBIDDEN_KEYS` denylist + `Object.prototype.hasOwnProperty.call` own-property check to refuse traversal into the prototype chain (e.g., `config get __proto__.constructor` returns an error rather than leaking `Object`).
- **`bin/modules/setup.cjs::setupProject`** auto-enables Graphify when the binary is on PATH at first setup. Without this, a fully-installed Graphify silently sat unused because the schema default is `enabled: false`. The `/devt:init` workflow has its own AskUserQuestion (Case B in `prompt_graphify_setup`) for the same — this branch covers CLI-direct setup users who bypass the wizard. Closes greenfield-api onboarding observation 855.
- **MCP tool descriptions trimmed** in `bin/devt-memory-mcp.cjs` (8 of 10 tools): condensed from action-verb + caveat to action-verb only, dropping inline version annotations and runtime-state details that belong in error messages. ~242 tokens saved per MCP-using session. The 3 tools that surface `source_root` (multi-root memory provenance) keep that mention because callers need to know the field exists.
- **`primary_branch` auto-detection** (`bin/modules/setup.cjs::detectPrimaryBranch`): replaces the old single-shot `git rev-parse --abbrev-ref HEAD` with a 4-step fallback chain: (1) `git symbolic-ref refs/remotes/origin/HEAD --short` — canonical answer set on `git clone`; (2) `git config init.defaultBranch` — explicit user/local config; (3) common-name heuristic — matches `development` / `develop` / `main` / `master` / `trunk` against `origin/` refs; (4) current branch as last resort, flagged `primary_branch_low_confidence: true` when it matches a feature-shape pattern (`feat/`, `fix/`, `chore/`, `wip/`, `task/`, `hotfix/`, `release/`). The detection result also surfaces `primary_branch_source` so users can see why a particular branch was picked.
- **`/devt:init` git-config escalation** (`workflows/project-init.md`): when `primary_branch_low_confidence === true`, the wizard now presents a dedicated AskUserQuestion before the standard git-config confirmation: "Detected `<X>` as your integration branch, but that looks like a feature branch. What's your team's actual integration branch?" with `development` / `main` / `master` / "use detected anyway" options. Closes the validated friction from greenfield-api onboarding where `feat/login-errors` was auto-detected instead of `development`.
- Smoke gains 2 structural-presence assertions for the new detection chain + escalation prompt.
- **`memory.enabled` wired as functional master switch** (`bin/modules/config.cjs::isMemoryEnabled`, `bin/modules/preflight.cjs::generate`, `bin/modules/discovery.cjs::harvest`, `hooks/memory-auto-index.sh`, `hooks/pre-flight-guard.sh`). Was documented in `docs/MEMORY.md` and `skills/memory-pre-flight/SKILL.md` as a master switch but no code consumed it — setting `.devt/config.json: { memory: { enabled: false } }` was a silent no-op. Now: Pre-Flight Brief generation returns `{state: "disabled", brief_path: null, …}`; discovery harvester returns `{state: "disabled", proposals: [], …}` and skips writing `_suggestions.md`; auto-index hook short-circuits before debounce; pre-flight-guard hook exits before mode resolution. Per-feature flags (`auto_index_on_change`, `preflight_mode`, `mcp_telemetry`) still apply when the master is true. The MCP query layer is gated separately via `.mcp.json` registration (the master is opt-out for active/automatic surfaces, not a kill-switch for opt-in tooling — see DEF-005 for the open architecture decision). Smoke gains 3 assertions verifying the gate behavior end-to-end (preflight + discovery short-circuit and no memory-layer artifacts written).
- **Slash-command description budget enforced** (`scripts/smoke-test.sh` `Command description budget` block). New 180-char ceiling for `description:` frontmatter in every `commands/*.md` — slash-command descriptions appear in autocomplete and the system prompt's command list, so each char costs cold-start tokens on every Claude Code session. Eight commands trimmed in this pass: `specify` (406→181), `preflight` (375→172), `memory` (221→179), `defer` (203→158), `plan` (194→181), `health` (193→158), `thread` (192→175), `research` (191→172). Skill descriptions intentionally not budgeted — skill descriptions are loaded into agent system prompts and need detail.

### Fixed
- **`/devt:do` dispatcher contract hardened** (`commands/do.md` + `workflows/do.md`). Previously the dispatch step said "Invoke the selected command, passing the original input as arguments" without specifying the concrete mechanic, so the path of least resistance became "answer in prose" — the user invoked `/devt:do "<task>"` expecting to land inside `/devt:debug` (or whichever) but got a conversational answer with no `.devt/state/` artifacts written. The contract now: (1) names the Skill-tool mechanic explicitly (`Skill tool: name=devt:<routed-command>`, matching the `commands/council.md:28` convention); (2) enumerates "doing the work" failure modes (prose answer / diagnostics / code reads / clarifying questions / task-validation — all forbidden); (3) ships a worked example with RIGHT and WRONG transcripts so the failure mode is recognizable; (4) updates `success_criteria` from vague "Command invoked" to "Skill tool invoked with `name=devt:<routed-command>` — dispatcher exits without further commentary or work."
- **`/devt:next` dispatcher contract hardened (closes DEF-004, symmetric with `/devt:do` fix)** (`workflows/next.md`). The route step said "Execute `/devt:X`" across many state-driven branches without specifying the Skill-tool mechanic, leaving the same prose-vs-dispatch ambiguity. Added a single `<dispatcher_contract>` block before the route step that defines: (1) "Execute `/devt:X`" means `Skill tool: name=devt:X` with subcommand mapping for routes like `/devt:memory promote` → `Skill(name=devt:memory, args="promote")`; (2) AskUserQuestion before dispatching is allowed when a routing rule explicitly requires it; (3) one-shot bash commands the routing block specifies (e.g., `rm -f handoff.json`) are NOT "doing the work"; (4) prose answers, diagnostic reads, and grep-ing instead of dispatching are forbidden. Lower stakes than `/devt:do` because `/devt:next` runs after explicit state setup, but symmetric closure keeps the routing contract consistent across dispatcher commands.
- **`workflow_type` registry alignment across CLAUDE.md, `next.md`, `status.md`, and `state.cjs`**. CLAUDE.md's `workflow_type` table was missing 3 of the live entries (`preflight`, `memory_promote`, `memory_reject`). `workflows/status.md` was missing 4 routing rows (`code_review`, `preflight`, `memory_promote`, `memory_reject`) — active-workflow status output silently fell through for those types. `VALID_WORKFLOW_TYPES` in `bin/modules/state.cjs` carried two vestigial enum values (`memory_init`, `memory_index`) that no workflow ever set — these are CLI-only one-shot operations, not state-tracking workflows; removed. CI lint extended: was checking only `next.md` for coverage; now requires every entry in `VALID_WORKFLOW_TYPES` to appear in BOTH `next.md` AND `status.md`, mirrored locally in `scripts/smoke-test.sh`.
- **README agent count corrected from 13 to 10** (`README.md`, three locations). Three places claimed "13 specialized agents" with reference to "3 supporting agents" — those 3 were actually subdirectories under `agents/` (`programmer/`, `tester/`, `code-reviewer/`) holding modular sub-skill prompts for 3 of the 10 top-level agents, not separate agents. Canonical count is 10 (matches `.claude-plugin/plugin.json`). Directory-tree row now reads "Agent definitions (10 files; 3 agents bundle sub-skill subdirectories)" so the subdirectories are explained without being miscounted as agents.

## [0.29.0] - 2026-05-06

### Changed
- **Simplify pass on v0.29.0 surface** (post-implementation cleanup). Six findings from the simplify review applied: (F1) `workflows/next.md` no longer double-parses `deferred.md` — dropped redundant `deferred count` call, presence is now derived from the `list --limit=4` output (saves ~100ms per idle `/devt:next`); (F2) `bin/modules/preflight.cjs` no longer rebuilds the governing-set in the counts block — uses `governingUnion.length` from the hoisted union; (F3) `governingUnion` is no longer mixed into the `lanes` object — passed as a sibling `governing` param to `renderBrief`, keeping `lanes` shape pure (per-lane arrays only); (F4+F6) `bin/modules/state.cjs::RESET_EXEMPT` now imports `FILE_REL` from `bin/modules/deferred.cjs` instead of hardcoding `"deferred.md"` — closes the cross-module coupling explicitly so renaming the file in one place doesn't desync the exemption list; (F5) `STATUS_OPEN`/`STATUS_CLOSED` constants in `deferred.cjs` replace 7 stringly-typed `"open"`/`"closed"` literals; (F7) `flag(name)` helper in `deferred.cjs::run` collapses 7 repeated `args.find(a => a.startsWith("--name="))` patterns to one call. F8 (parser `tags: []` always-seed) reviewed and SKIPPED on deeper analysis — `tags: []` is the canonical "no tags" shape; JSON consumers benefit from `Array.isArray(item.tags) === true` always being true; conditional `tags?: string[]` would force defensive checks downstream.

### Added
- **Questioning-guide hardening** (`references/questioning-guide.md`, v0.29.0). Three new sections distilled from the `grill-me` interview pattern: **"Before You Ask"** (codebase-first rule — grep/Read/`memory query` before any question; only ask about decisions requiring user judgment), **"Walk the Decision Tree"** (resolve root decisions before dependents, cut subtrees on root answers — prevents Q3 from invalidating Q1's framing), **"One at a Time"** (AskUserQuestion supports 1-4 questions per call but discipline says use 1, since each answer reframes the next question's options). Plus a "Recommendation Required" note formalizing the rule that every option carry validated reasoning. `workflows/clarify-task.md` and `workflows/specify.md` cross-reference the new sections explicitly so agents reading those workflows know what to check. Smoke gains 3 structural-presence assertions.
- **Deferred-task tracker** (`bin/modules/deferred.cjs`, `commands/defer.md`, `workflows/defer.md`, v0.29.0). Single shared markdown file at `.devt/state/deferred.md` for "things we said we'd do later." Captures both mid-work TODOs (workflow-emitted, e.g. code-reviewer flags a non-blocker) and standalone backlog items via `/devt:defer "<title>"`. **Exempted from `state reset`** via a new `RESET_EXEMPT` set in `bin/modules/state.cjs` so a TODO captured in workflow A survives `/devt:cancel-workflow` and can be picked up in workflow B. Lifetime contract is explicit, not magic — the exemption list lives in code, code-visible. Schema: `DEF-NNN` ids matching `/^DEF-\d{3,}$/`, append-only markdown, blocks separated by `---`. Status flow: `open` → `closed` (via `defer close DEF-NNN --by=<agent>`, sets `closed_at` + `closed_by`); `reopen` removes the closed metadata.
  - **CLI**: `deferred add "<title>" [--context=... --tags=a,b --by=<agent>]`, `list [--status=... --tag=... --limit=...]`, `get <DEF-NNN>`, `close <DEF-NNN>`, `reopen <DEF-NNN>`, `count`. Whitelist-validated ID pattern; invalid ids return exit 2 with a clear error message.
  - **`/devt:status` integration**: when `deferred count` reports `open > 0`, the status report includes a `Deferred queue: N open` line — both in idle-state output and active-workflow status. Suppressed when `open === 0` to avoid noise.
  - **`/devt:next` integration**: when no active workflow + no other resumable artifacts + deferred queue has open items, presents AskUserQuestion with the top 3 open items as options ("Start: DEF-NNN title") + a "Skip — show full queue" alternative. Picking a DEF-NNN routes to `/devt:workflow` with the item's title; on workflow completion, prompts to close the item.
  - **Curator deferred-sweep skill DEFERRED to v0.29.1** — periodic recurring-pattern detection (3+ items with same tag → "promote to LES-NNN?") not in this release.
  - **GitHub Issues mirror DEFERRED to v0.30+** — no `defer push` subcommand yet.
  - Smoke gains 6 assertions: sequential DEF-NNN id assignment, list returns added items, close flips status with metadata, count math, **state reset preserves deferred.md** (the exemption test), invalid id rejection. 246 total pass (was 240).
- **`memory query --doc-type=<type>` filter** (`bin/modules/memory.cjs::queryFTS`): restricts FTS5 results to one of `decision|concept|flow|rejected|lesson`. Whitelist-validated against `DOC_TYPES` so a typo or injection cannot reach the prepared statement as a free-form value. Mirrors `memory list <doc_type>` and Pre-Flight Brief Lane F's filter; useful for tooling that wants typed slices (e.g. "find all lessons about authentication"). Two smoke assertions: filter restricts to lesson-only, invalid value rejected with exit 2.
- **`prompt_graphify_setup` step in `/devt:init`** (`workflows/project-init.md`): closes two gaps that left Graphify unused even on machines where it was installed. **Gap 1** — when `graphify` is not on PATH, the wizard previously emitted only a passive `warnings[]` hint that users skimmed past; CLAUDE.md claimed a "strongly recommend" pitch but no AskUserQuestion existed. The new step asks whether to surface install instructions (prints the `pip install graphifyy[mcp]` command — does NOT execute, since Python env changes are user-owned). **Gap 2** (silent-failure mode) — when `graphify` IS on PATH but `.devt/config.json` has the default `graphify.enabled: false`, every Graphify call site in `bin/` short-circuits with `{state: "disabled"}`. Users could complete `/devt:init` with Graphify perfectly installed, hook registered, and devt still falling back to grep with no signal. The new step detects this and offers to flip `graphify.enabled=true` via `config set`. Best-effort, runs after `run_setup` (so `.devt/config.json` exists) and before `prompt_graphify_hook` (so the hook prompt's "keeps the graph cache fresh" rationale becomes meaningful). Smoke gains 1 assertion.
- **`templates/memory/LES-template.md`** — frontmatter scaffold for operational lessons (mirrors ADR/CON/FLOW/REJ shape with `## Trigger`, `## Action`, `## Evidence`, `## Related` body sections).

### Changed
- **Memory layer is now the single source of truth for ALL persistent knowledge** (v0.28.0 unified design). The 3-layer model (ephemeral state + flat-file playbook + structured memory) collapses into a 2-layer model (ephemeral state + unified memory). Operational lessons gain a 5th doc type (`doc_type: lesson`, id pattern `LES-\d{3,}`) living at `.devt/memory/lessons/LES-NNNN-slug.md` alongside ADR/CON/FLOW/REJ docs. Schema additions in `bin/modules/memory.cjs` cascade automatically — `DOC_TYPES` gains `"lesson"`, `ID_PATTERN_BY_TYPE` and `SUBDIR_BY_TYPE` gain corresponding entries, and the scanner / validator / `init()` scaffolder iterate `DOC_TYPES` so all surfaces pick up the new type with no per-call-site changes. Lessons FTS5-indexed in the same `index.db` as architectural docs — they surface in Pre-Flight Briefs via the same Lane A/B/C/D path that finds ADR/CON/FLOW/REJ. **This closes the silent-asymmetry** where pre-v0.28 lessons (in the separate `lessons.db`) never reached the Brief because the Brief queries `index.db` only.
- **Pre-Flight Brief Lane F refactored** (`bin/modules/preflight.cjs`): no longer queries the deleted `semantic.cjs` against the deleted `learning-playbook.md`. Now filters the union of Lanes A∪B∪C∪D for `doc_type='lesson'` — pulls LES-NNNN entries directly from the unified memory layer. Renders under "Related Operational Lessons" in the Brief, separate from architectural governing docs.
- **Curator agent unified** (`agents/curator.md`): single approval flow (AskUserQuestion per candidate) covering all 5 doc types. The previously dual `playbook-curation` + `memory-curation` skill split collapses into the single `memory-curation` skill. Curator's `skills:` frontmatter no longer references `playbook-curation`. Categorical confidence (`verified | explicit | inferred | observed | speculative`) replaces the legacy numeric `confidence: 0.0-1.0` for lessons — same scale as ADR/CON/FLOW/REJ.
- **Retro agent rewrite** (`agents/retro.md`): emits `lessons.yaml` drafts shaped for direct LES-NNNN promotion (categorical confidence, `affects_paths`/`affects_symbols`, `## Trigger`/`## Action`/`## Evidence` body sections). The legacy `importance` (1-10), `decay_days`, and `tags` (string) fields are gone — `confidence` carries severity, status='superseded' replaces decay-based archival, and `affects_paths`/`affects_symbols` replace tags.
- **`devt:init` no longer scaffolds `.devt/learning-playbook.md`** (`bin/modules/setup.cjs`) — instead, `.devt/memory/lessons/` is created alongside the other memory subfolders. New project layout has one canonical knowledge surface.

### Removed
- **`bin/modules/semantic.cjs`** — entire module deleted (was the legacy FTS5 query layer for `learning-playbook.md` → `lessons.db`). Superseded by `memory.cjs::queryFTS` against the unified `index.db`.
- **`memory migrate-lessons` subcommand + `migrateLessonsDb()` function** (`bin/modules/memory.cjs`) — no historical data to import in the v0.28.0 clean-cut design.
- **`semantic` CLI dispatch** (`bin/devt-tools.cjs`) — removed `case "semantic":` and the `semantic sync/query/compact/status` help text.
- **Playbook health check** (`bin/modules/health.cjs`): I002 catalog entry, the `if (!fs.existsSync('learning-playbook.md'))` check, and the matching repair branch all deleted.
- **Playbook scaffolding** (`bin/modules/setup.cjs`): the 14-line block that created an empty `learning-playbook.md` on `/devt:init`.
- **`learning-playbook.md` from `discovery.cjs::WIKI_LINK_SURFACES`** — lessons are now scanned natively as `.devt/memory/lessons/*.md` files.
- **3 legacy skill folders deleted**: `skills/playbook-curation/`, `skills/memory-compaction/`, `skills/semantic-search/`. Their guidance is absorbed into `skills/memory-curation/SKILL.md` (now covers all 5 doc types) or replaced by direct `memory query` usage.
- **5 smoke-test cases removed**: `semantic status`, `semantic query (no playbook)`, `parsePlaybook accepts both flat and YAML-list forms`, two `semantic query` flag-validation cases, and the playbook-curation/semantic-search Phase 2 integration assertions for the deleted skills. 3 new assertions added (LES-NNNN schema accept, `lessons/` folder created, lesson surfaces via `memory query`). Net: 240 → 238 total tests, 0 failures.

### Migration impact
- **Net deletions outweigh additions** — the v0.28.0 diff removes more lines than it adds. One canonical store (`index.db`) instead of two (`index.db` + `lessons.db`); one curation skill (`memory-curation`) instead of two; one approval gate (AskUserQuestion per candidate) covering all 5 doc types.
- **Retro→Curator pipeline**: retro writes `.devt/state/lessons.yaml` (intermediate hand-off) → curator presents each via AskUserQuestion → on approval writes `.devt/memory/lessons/LES-NNNN-slug.md` → runs `memory index` → entry FTS5-queryable and Brief-visible immediately.

## [0.27.0] - 2026-05-06

### Added
- **All 8 dev agents now Graphify-first.** Pre-v0.26.0, only programmer / code-reviewer / verifier preloaded a skill that routes through the canonical `graphify-helpers` wrapper. The other 4 dev agents (architect, debugger, researcher, tester) preloaded only `devt:memory-pre-flight` — giving them the Pre-Flight Brief (pre-computed Graphify output) but no per-query routing during deep investigation. Their bodies explicitly used Grep/Glob for symbol traversal, dependency tracing, pattern discovery, and test-pattern lookup — exactly the workloads where Graphify cuts ~10× the token cost. Each agent now preloads the most-specific skill that already routes through Graphify-first with grep fallback:
  - `architect` → `devt:graphify-helpers` (low-level wrapper for boundary inspection)
  - `debugger` → `devt:codebase-scan` (caller traversal during root-cause)
  - `researcher` → `devt:codebase-scan` (canonical pattern-discovery use case)
  - `tester` → `devt:tdd-patterns` (find tests near subject via `graphify neighbors`)
  - The added skills auto-degrade to grep when `graphify.enabled: false`, so no behavior changes for projects without Graphify.
- **`prompt_graphify_hook` step in `/devt:init`** (`workflows/project-init.md`): when Graphify is detected on PATH but its post-commit hook isn't registered, the wizard now asks via AskUserQuestion whether to run `graphify hook install`. Without the hook, the graph cache drifts behind HEAD and Pre-Flight Briefs surface stale-symbol false alarms after every refactor. Pre-fix `setup.cjs` only pushed a `warnings[]` hint gated to `mode=create`, so users who installed Graphify *after* `/devt:init` never saw the prompt; the new step fires for both `mode=create` and `mode=update`. Best-effort: failures never fail the workflow. Skipped silently when graphify is absent or hook already installed. Smoke gains 1 assertion (239 total pass).

## [0.26.0] - 2026-05-06

### Added
- **Symbol Decay detection in `memory validate`** (`bin/modules/memory.cjs::validateSymbolsViaGraphify`): each `affects_symbols[]` entry is probed via `graphify.queryGraph()`; symbols that resolve to zero AST nodes are flagged as `category: "stale-symbol"` warnings. Closes the last gap from CCA v27 §2 "Tricky Parts" and delivers the spec's "Refactor Safety" promise from §1 — when you rename a class, validate surfaces every doc that still claims to govern the old name. Graphify-disabled installs gracefully skip the check (existing validation paths unchanged).
  - **Caching:** per-symbol probe cache keyed by raw symbol string. A project where 5 docs reference `UserService` runs one Graphify subprocess, not five.
  - **Severity:** `warning`, not `error`. Graphify resolution can be ambiguous on overloaded names; flagging stale candidates without blocking validate keeps the workflow advisory.
  - **Circuit breaker:** after 3 consecutive `degraded: true` results from Graphify, `validateSymbolsViaGraphify` aborts with a single `category: "graphify-unreachable"` warning. Prevents both runaway subprocess cost and the false-positive cascade where a transient graphify crash mid-loop would have flagged every remaining symbol as `stale-symbol`. Also: degraded results never produce a stale-symbol flag (root-cause fix for the false-positive even when consecutive count stays below threshold).
- **Graph-staleness alert in Pre-Flight Brief** (`bin/modules/preflight.cjs`): when Graphify ran successfully but the graph cache is ≥10 commits behind HEAD (`STALE_LAG_COMMITS` constant), the Brief's Blast Radius section emits a warning with the exact lag count and the fix command (`graphify update .` or `graphify hook install` for auto-refresh). Previously, blast-radius numbers could silently reflect old code with no signal that the graph was stale.
- **`graphify.freshness().lag_commits` field** (`bin/modules/graphify.cjs`): the JSDoc has promised this field since v0.17.0 but the implementation never delivered it — surfacing the contract drift. Now computed via `git rev-list --count <built_at>..<head>`. Returns `null` for shallow clones, force-pushed history, or missing git binary.
- **Health check `GRAPHIFY_MCP_UNREGISTERED`** (`bin/modules/health.cjs`): info-severity warning when `graphify` is on PATH but not registered in `.mcp.json`. Catches the "user installed Graphify after `/devt:init`" drift case where MCP queries silently fall back to grep without any signal. **Warn-only by design** — `health --repair` does NOT auto-edit `.mcp.json` to avoid stomping user MCP customizations. Fix guidance points the user at `node bin/devt-tools.cjs setup --mode update` to regenerate the MCP server entries.

### Changed
- **`graphify.freshness()` no longer parses 200MB-cap graph.json to read one field.** The probe needs only `built_at_commit` (a top-level field); replaced full `safeJsonParse` with a 8KB head-of-file read + regex extraction. On a 50MB graph this drops freshness() from ~200ms to ~2ms — relevant because Pre-Flight Brief calls `freshness()` on every workflow start. SHA shape constraint (`[0-9a-fA-F]{4,64}`) bounds regex backtracking.
- **Health check `GRAPHIFY_MCP_UNREGISTERED` reordered**: read `.mcp.json` first, only spawn `graphify --help` when registration is *missing*. Removes a 50–200ms subprocess from every `/devt:health` invocation in the common case (graphify already registered).

### Fixed
- **`memory validate` no longer false-flags stale-symbol on transient Graphify failures.** When a graphify subprocess crashed mid-loop (e.g. graph cache corrupted partway through), every subsequent symbol returned `{degraded: true, results: []}` — and the old code treated empty results as "symbol not found", producing a cascade of false-positive `stale-symbol` warnings across docs whose symbols actually exist. Fix: detect `degraded: true` separately from "no results" and skip the flag for degraded probes.
- **Smoke test environment-aware post-commit assertions** (`scripts/smoke-test.sh`): the `setup.cjs installs .git/hooks/post-commit` assertions assumed a Graphify-absent environment, which fails on dev machines where Graphify is locally installed. Setup correctly yields post-commit ownership to Graphify when present (`graphify hook install` supersedes devt's hook). Smoke now branches on `command -v graphify` and asserts the correct behavior in both environments.
- **Eliminated dynamic-RegExp construction in 2 hot paths.** Pre-existing semgrep warnings traced to RegExp built from runtime strings — although both sites had length caps and metachar-escaping, removing the dynamic construction is real defense-in-depth and cleaner than nosemgrep suppression.
  - `bin/modules/graphify.cjs::blastRadius` god-node detection: rewrote `\b<sym>\b` regex match as an `indexOf` walk with charCode boundary checks. Same semantics, no RegExp.
  - `bin/modules/memory.cjs::matchesPattern` glob check: rewrote glob-to-regex conversion as a recursive descent matcher (`globMatch`). Supports `*` (within-segment) and `**` (cross-segment). `**/**/...` repeats are collapsed before matching to bound the recursive branching factor. O(n*m) with both bounded by the existing 256-char input cap. Incidentally fixed a pre-existing bug where `src/**` failed to match `src/foo/bar.ts` because the regex builder's escape-then-replace order corrupted the `**` substitution.
- **Curator-gated harvest is now actually wired and unconditional.** Audit revealed three real wiring gaps that made the documented "curator-gated harvest" path effectively skippable:
  1. `workflows/quick-implement.md` skipped retro+curator entirely (by design, for speed) — but that meant ⚖️/🔵 observations from quick workflows were dropped on the floor, never reaching `_suggestions.md`.
  2. `workflows/dev-workflow.md::curate` step (and its `lesson-extraction.md` standalone counterpart) dispatched the curator with playbook-only context — the "dual-path" claim in `lesson-extraction.md` line 202 was documentation drift from the actual `<files_to_read>` block.
  3. The retro step itself was skippable when `complexity=SIMPLE` or `config.workflow.retro=false`, cascading into curator never running, harvest never running.
  - **Fix shape:** Decoupled harvest (cheap, unconditional) from curator review (gated). New `harvest_observations` step in all three workflows runs `memory suggest` unconditionally — buffers candidates into `.devt/memory/_suggestions.md` even when curator never runs. Curator dispatches in `dev-workflow.md` + `lesson-extraction.md` updated to dual-path: `<files_to_read>` now includes `_suggestions.md` and the `<task>` block instructs both PLAYBOOK PATH and MEMORY-LAYER PATH per the `memory-curation` skill's hard invariant (never write permanent docs without AskUserQuestion approval).
  - **Smoke assertions** (3 new): `memory suggest` is idempotent on empty projects (rc=0, zero candidates); `memory suggest` is wired into all three workflow files; curator dispatches reference `_suggestions.md`. These assertions catch regression to the earlier playbook-only dispatch.

### Known limits
- **`memory validate` symbol probing is sequential.** With ≥100 unique symbols across many docs, validate can take 5–20s due to per-symbol Graphify subprocess spawn cost. The probe cache deduplicates same-symbol references, but unique-symbol cost is bounded only by the circuit breaker (3 consecutive failures). Parallelizing requires converting `validate()` from sync to async, which cascades into `health.cjs::runChecks` and the CLI dispatcher — deferred until users hit the wall.

## [0.25.0] - 2026-05-06

### Added
- **Symbol-name case-insensitivity** (`bin/modules/memory.cjs`): `affects.symbol` index uses `COLLATE NOCASE`; `getBySymbol()` query adds `COLLATE NOCASE`. Authors writing `affects_symbols: [UserService]` in one doc no longer fail to match a query for `userService`. Original casing still preserved in storage for display. Closes the symbol normalization gap from CCA v21.0 §5/B3 — implemented via SQLite primitive instead of double-storage.
- **Self-link detection in `memory validate`** (`bin/modules/memory.cjs:1226-1240`): catches docs that link to themselves (`source_id = target_id`) — almost always an authoring slip from copy-pasting an ID into the wrong field. Surfaces as `category: "self-link"` warning.
- **4 SQL views adapted from CCA v21.0 §10** (`bin/modules/memory.cjs:SCHEMA_DDL`):
  - `pending_review` — all `status='candidate'` docs ordered by confidence (verified → speculative) then most-recent. Stable ordering for triage workflows.
  - `speculative_candidates` — all docs at `confidence='speculative'` regardless of status. Surfaces low-confidence material that needs verification or downgrade.
  - `constraint_chains` — per-doc link degree (incoming/outgoing). Spot hub docs (high incoming) and leaves (zero outgoing). v21 wanted hierarchical traversal — we expose raw degrees and let callers do recursion via `memory.getLinks()`.
  - `stale_speculative` — speculative candidates older than 30 days (uses `created_at` as age signal because `last_hit_at` would break the regenerable-from-markdown invariant). Surface stale candidates for curator pass.
  - All four queryable via the read-only MCP `query_index` SELECT-only escape hatch.
- **7 new smoke assertions** (`scripts/smoke-test.sh`): 4 view existence + stale_speculative age threshold + symbol normalization round-trip (mixed-case INSERT, lowercase QUERY) + self-link detection.

### Fixed
- **`runSql` line-comment handling** (`bin/modules/memory.cjs:154-162`): SQL line comments (`-- ...`) are stripped before splitting on `;`. A semicolon inside a comment used to split the comment in half, leaving an orphan statement that errored at prepare-time AND silently aborted the rest of schema initialization. The bug caused 2 of 4 new views to be silently missing during my own integration test — caught before commit. Future maintainers can write semicolons in SQL comments without fear.

## [0.24.0] - 2026-05-05

### Security
- **Defense-in-depth: `safeJsonParse` wrapping at every JSON parse boundary.** All bare `JSON.parse` calls in `bin/` replaced with `bin/modules/security.cjs::safeJsonParse` (size-capped, error-wrapped). After this change, the only remaining `JSON.parse` callsite in the codebase is inside `safeJsonParse` itself (`bin/modules/security.cjs:127`) — making the codebase auditable in one grep and preventing regression by precedent.
  - **Untrusted boundaries (10 sites, threat-driven):** MCP server stdin frames (`bin/devt-memory-mcp.cjs:494`, 1MB cap — the only attacker-controlled boundary), bundle import (`bin/modules/memory.cjs:965`, 50MB), token-report baseline + per-line session log (`bin/modules/token-report.cjs:126,252`), MCP trace JSONL (`bin/modules/mcp-stats.cjs:59`), Graphify subprocess + graph cache (`bin/modules/graphify.cjs:103,200`, 100/200MB), claude-mem subprocess (`bin/modules/discovery.cjs:101`, 10MB), GitHub plugin.json fetch (`bin/modules/update.cjs:66`), `setup --config <json>` CLI argv (`bin/modules/setup.cjs:502`).
  - **Trusted-source reads (12 sites, consistency-driven):** `bin/modules/config.cjs:161` (`.devt/config.json`), `bin/modules/health.cjs` × 6 (plugin manifest, update cache, config validation, version coherence, agent file W009 check, hooks.json W012 check), `bin/modules/setup.cjs` × 2 (config update merge, `.mcp.json` read), `bin/modules/update.cjs` × 4 (`getLocalVersion`, `getRepoUrl`, `readCache`, `getInstallType`). Defense-in-depth — these read project-local files we wrote ourselves, but wrapping them sets an enforceable codebase invariant.
- **`safeJsonParse` extended with optional `maxSize` parameter** (`bin/modules/security.cjs:111`). Default stays 1MB. Per-callsite caps reflect threat model: 1MB for stdin / network / trusted manifests, 50MB for cross-org bundles, 100/200MB for Graphify outputs scaling with codebase size.
- **Smoke and locking suites unchanged: 225/225 + 3/3 still passing.** No behavior change — `safeJsonParse` is a strict superset of `JSON.parse` semantics (parse + size cap + error wrapping).

## [0.23.0] - 2026-05-05

### Added
- **`memory paths [--validate]`** subcommand (`bin/modules/memory.cjs`): echo the resolved memory roots in scan order with provenance flags. `--validate` stats each root and surfaces missing dirs with `MEM_PATH_UNREACHABLE` error code + actionable hint ("git submodule init / NFS mount / sibling clone"). Exits 1 if any root is unreachable so CI scripts can fail-fast on misconfigured `memory.paths`.
- **`memory diff <root-a> <root-b>`** subcommand: surface added / removed / changed docs between two memory roots, with sha256:16 fingerprint over (frontmatter + body) for change detection. Use case: after `git pull` in a shared org-ADRs repo, see what just arrived. Path inputs validated (length, null bytes, type). Returns counts + arrays so consumers can branch on the structure.
- **Native MEM_* checks in `bin/modules/health.cjs`** (Tier A from the audit): `MEM_PATH_UNREACHABLE` (any configured `memory.paths` root that doesn't exist), `MEM_INDEX_STALE` (index.db older than newest .md mtime across all roots), `MEM_VALIDATE_ERRORS` (frontmatter schema violations from `memory validate`), `MEM_CONFLICT_HIGH` (info — ID collisions across roots, last-wins applied). Promotes the workflows/health.md documentation from agent-orchestrated bash to native, deterministic checks — `node bin/devt-tools.cjs health` returns these directly without an agent in the loop, suitable for CI.
- **`mcp-stats --top=N --by=calls|duration|errors`** flag: narrow the per-tool breakdown to the top-N tools by chosen metric. Defaults to `--by=calls`. Quick triage: "show me the 3 most-called tools" or "show me the slowest 5 by p95". Invalid `--by` values rejected with helpful error message.
- **`token-report --baseline=PATH`** + **`--compare=PATH`** flags: snapshot the current aggregate to a baseline file (`captured_at`, `aggregate`, `sessions_in_report`), then later compare a fresh report against the saved baseline to compute relative-change percentages. Builds the harness for the v27 plan's success-criteria measurement (`≤50%` code-review tokens, `≤70%` dev-workflow tokens) — running it requires only an operational baseline pass, not new code.
- **6 new smoke assertions**: memory paths default + --validate, memory diff JSON shape, health native MEM_PATH_UNREACHABLE, mcp-stats --top filter + --by validation, token-report baseline+compare round-trip.

### Deferred (with rationale)
- **Git-remote helper** (`memory bundle-from-git <repo-url>`) — concrete scope but lower priority after v0.22.0 (configurable `memory.paths`) shipped. The use case shrank to bootstrap-only (fresh project with no shared-dir infrastructure yet). Has the most security surface of the candidates (URL validation, tempdir lifecycle, submodule risk) and warrants a separate design pass. Will revisit if/when the bootstrap niche becomes a real friction point.

## [0.22.0] - 2026-05-05

### Added
- **Configurable memory paths** (`bin/modules/config.cjs:DEFAULTS.memory.paths`): list of memory roots to scan + index. Default `null` = single-root behavior at `<projectRoot>/.devt/memory` (full backward compat). When set, devt indexes EVERY listed root and the project-local one is auto-appended last so it always wins ID collisions (last-wins precedence, like CSS specificity). Use cases: company-wide ADRs (`["../engineering-adrs", ".devt/memory"]`), monorepo shared rules (`["../../shared/memory", ".devt/memory"]`), NFS-mounted org policy.
- **`getMemoryRoots()` resolver** (`bin/modules/memory.cjs`): reads `memory.paths`, validates each entry (string, ≤4096 chars, no null bytes), resolves relative paths against project root, deduplicates while preserving precedence order, and ALWAYS appends the project-local root last so curator writes have a destination. Public-API export.
- **`getSubdirPathFor(root, docType)` helper**: resolves docType subdirs under explicit memory roots (not just the project-local one). Used by the multi-root scanner.
- **`scanDocs()` rewritten for multi-root**: walks every configured root, tags each indexed doc with `source_root`, detects ID collisions across roots, reports them via a non-enumerable `_conflicts` array on the result. Last-wins overwrite is in-place — no second pass.
- **`documents.source_root` column** in the FTS5 unified index (`bin/modules/memory.cjs:SCHEMA_DDL`): tracks which configured root each indexed doc came from. Surfaced in `memory get <id>` and `memory list` so users see provenance at a glance. Stored as the absolute root path; nullable for backward compat.
- **`rebuildIndex()` returns multi-root metadata**: result payload gains `memory_roots` (the resolved scan order) + `conflicts` (array of `{id, prev_source, prev_path, new_source, new_path}` for each collision) + `conflict_count`. Lets `/devt:memory index` surface clear "ADR-001 in shared/ shadowed by .devt/memory/" messages.

### Changed
- **`SCHEMA_DDL`** adds `source_root TEXT` column. Existing indexes are not migrated — `memory index` rebuilds from scratch each time, so the new column populates on next index rebuild.
- **`memory get <id>` output** now includes `source_root` field.

### Hard Invariants Maintained
- **Single-root behavior unchanged** when `memory.paths` is null or absent (default). Existing projects see no change.
- **Project-local always wins** — the resolved roots list always has `<projectRoot>/.devt/memory` last (auto-appended if missing), so a project can override any shared decision without modifying the shared source.
- **No silent shadowing** — every collision is reported in the rebuild result. CI can fail on `conflict_count > 0` if a project wants strict no-overlap policy.
- **Index DB stays per-project** at `.devt/memory/index.db` regardless of how many shared roots are configured. The DB indexes the union but the file itself is gitignored + regenerable.
- **Curator writes still target project-local** — promotion subcommands write to `.devt/memory/` by default. Shared roots are read-only from devt's perspective; their maintainers edit the markdown directly with their own toolchain.
- **All path inputs validated** at `getMemoryRoots()` boundary: string-type, ≤4096 chars, no null bytes; the existing `withDb` and FTS5 layer downstream are unchanged.

### Use case example

ACME Corp publishes `github.com/acme/engineering-adrs` containing company-wide architectural rules. Each ACME project's `.devt/config.json`:

```json
{
  "memory": {
    "paths": ["../engineering-adrs", ".devt/memory"]
  }
}
```

After `git submodule add` (or sibling clone) of the shared repo + `node bin/devt-tools.cjs memory index`, every project's Pre-Flight Brief now surfaces both org-wide ADRs and local ones. A new dev's `/devt:workflow "Add Redis caching"` immediately sees `ACME-REJ-001 "Redis sessions"` and stops the proposal at proposal time. Updates flow naturally — `git pull` in the shared dir, next `memory index` (or auto-index hook) picks up the change. No prefix mutation, no security surface, no separate import step.

## [0.21.0] - 2026-05-05

### Added
- **MCP-side tool-call telemetry** (`bin/devt-memory-mcp.cjs`): every `tools/call` invocation appends one JSONL line to `.devt/memory/_mcp-trace.jsonl` (gitignored). Records timestamp, tool name, ok/error_code, duration_ms, args_size, args_fp (sha256:12 fingerprint — NOT the args themselves; privacy/security), result_size. Trace-write failures are swallowed silently — telemetry MUST NEVER affect tool result correctness. Behavior governed by `memory.mcp_telemetry` config (default `true`).
- **`mcp-stats` aggregator** (NEW `bin/modules/mcp-stats.cjs` + `node bin/devt-tools.cjs mcp-stats`): aggregates the JSONL trace into per-tool statistics — call count, error count + rate, duration percentiles (p50, p95, p99), result-bytes total, error_codes breakdown. Supports `--since=YYYY-MM-DD`, `--tool=<name>`, `--prune-older-than=Nd|Nh|Nm|Ns` (atomic temp-rename rewrite). Aggregate output is JSON for downstream tooling.
- **`memory.mcp_telemetry` config key** (`bin/modules/config.cjs:DEFAULTS`): default `true`. Disable per-project via `.devt/config.json` for environments that don't want any session-side persistence beyond workflow state.
- **Comprehensive bundle round-trip smoke fixture**: 17 new assertions covering all 4 doc types (decision, concept, flow, rejected) authored with full frontmatter (affects_paths, affects_symbols, links graph, REJ search_keywords, REJ reason). Exercises: bundle structure preserves all types + REJ search_keywords + links + affects_paths/symbols; markdown→JSON→markdown re-render preserves REJ keywords; second round-trip (re-export from re-imported docs) preserves links; `--include=rejected` filter narrows to single doc.
- **Gitignore additions** (`bin/modules/setup.cjs`): `.devt/memory/_mcp-trace.jsonl` (telemetry — append-only, safe to delete) + `.devt/memory/export-*.json` (transient bundle artifacts — share via explicit channel, not git).

### Changed
- **`bin/devt-memory-mcp.cjs:SERVER_VERSION`** bumped from `"0.18.0"` to `"0.21.0"` to reflect the telemetry instrumentation. Reported in `initialize` handshake response so downstream MCP clients can branch on version.

### Hard Invariants Maintained
- **Telemetry is privacy-safe by construction**: trace records contain only sizes and a 12-char sha256 fingerprint of args (no SQL, no symbol names, no file paths). The fingerprint is enough to detect "the same call repeated" but not reverse-engineer payloads.
- **Telemetry never breaks the tool**: every trace write is wrapped in try/catch with empty rescue. The MCP server never errors because the trace file is unwritable.
- **Trace file is gitignored by default**: every freshly-scaffolded project gets the rule. Existing projects need a manual `.gitignore` add (only relevant when memory.mcp_telemetry is true and they want to keep the file out of git).

## [0.20.0] - 2026-05-05

### Added
- **`bin/modules/token-report.cjs`** + `node bin/devt-tools.cjs token-report` CLI (NEW): zero-deps Claude Code session-log aggregator. Streams `~/.claude/projects/<slug>/*.jsonl`, extracts per-turn `message.usage` (input_tokens / cache_creation / cache_read / output_tokens), and reports per-session + aggregate totals plus cache-hit rate. Supports `--sessions=N` (default 5), `--since=YYYY-MM-DD`, `--project=<absolute-path>`. Path inputs validated against null-bytes, traversal, and >4096-char overflow. Verified on a real 27-session devt project: 93.57% cache hit rate aggregate. Surfaces the plan's success-criteria targets (≤50% / ≤70% / ≤2K-10K) inline so users can compare.
- **Portable ADR/Concept/Flow/REJ bundle export/import** (`bin/modules/memory.cjs`):
  - `node bin/devt-tools.cjs memory export [--out=PATH] [--include=decision,concept,flow,rejected]` — writes a JSON bundle (schema_version=1) of selected docs with frontmatter + body. Default output: `.devt/memory/export-<ISO>.json`. Default include: all four types.
  - `node bin/devt-tools.cjs memory import <bundle.json> [--overwrite] [--prefix=NEW-]` — restores docs from a bundle. Default policy: skip if id exists. `--overwrite` replaces. `--prefix=TEAMA-` (validated `/^[A-Z][A-Z0-9]{0,14}-$/`) remaps every id for multi-source bundling, relaxing ID-pattern enforcement (since prefixed ids by design break canonical ADR-NNN shape). After import, FTS5 index is rebuilt automatically. Path inputs validated via `resolveExportPath`/`resolveImportPath` (null-byte, length, traversal-containment).
- **Topic extraction tuning** (`bin/modules/preflight.cjs`): `SYMBOL_DENYLIST` filters action verbs (`Add`, `Refactor`, `Fix`, `Update`, `Implement`, `Build`, `Create`, `Make`, `Extend`, `Improve`, `Optimize`, `Support`, `Migrate`, `Wire`, `Integrate`, `Polish`, etc.) + common short labels (`API`, `UI`, `CLI`, `DB`, `URL`, `HTTP`, `JSON`, `CSS`, `HTML`, `SQL`) + generic nouns (`feature`, `task`, `bug`, `issue`) from being captured as PascalCase symbols in topic extraction. Lane C results stay precise — `Add MFA support to AuthService` now extracts `[AuthService, MFA]` (not `[Add, AuthService, MFA]`).
- **`hooks/post-commit-validate.sh`** (NEW lightweight Graphify-disabled fallback): runs `memory validate` after each commit, surfaces stale-path warnings to stderr, never blocks. Wrapped by a tiny `.git/hooks/post-commit` shim (auto-installed by `setup.cjs` only when Graphify is NOT detected; when Graphify is present, the user is hinted to run `graphify hook install` instead, which supersedes our hook).
- **`bin/modules/setup.cjs` post-commit hook auto-install**: on `--mode create`, checks for `graphify` on PATH. If absent, writes `.git/hooks/post-commit` as a wrapper that delegates to `${CLAUDE_PLUGIN_ROOT}/hooks/post-commit-validate.sh`. If present, surfaces an actionable warning ("run `graphify hook install`"). Never overwrites an existing post-commit hook.
- **`bin/modules/weekly-report.cjs` memory aggregations**: `aggregateMemoryEvents()` counts new ADRs/Concepts/Flows/REJs created in the report window (file birthtime), plus a snapshot count of total `status='active'` docs. `renderMemorySection()` appends a "Memory Layer Activity" section to generated reports. Honors absent `.devt/memory/` (returns `available: false` cleanly).
- **Templates: ADR-override cross-references** in 20 files (`templates/{blank,go,python-fastapi,typescript-node,vue-bootstrap}/{coding-standards,architecture,quality-gates,review-checklist}.md`). Each gets a one-line note pointing to `.devt/memory/decisions/` with the relevant guidance ("ADRs are constitutional", "ADR alignment check is a quality gate", "REJ tombstones surface in code-review").
- **Commands: Memory integration subsection** in 6 non-dev commands (`commands/{forensics,thread,note,do,session-report,weekly-report}.md`) — documents that meta workflows don't auto-fire preflight but reference Brief artifacts when present.

### Changed
- **`.git/hooks/post-commit` is now scaffolded by `/devt:init`** (when Graphify absent). Existing hooks are preserved — never overwritten.
- **`memory.export` output filename uses ISO timestamp**: `.devt/memory/export-<ISO>.json` (colons + dots replaced with `-` for filesystem safety).

### Hard Invariants Maintained
- **Zero project-level dependencies preserved**: token-report uses Node stdlib only; bundle export/import is JSON (no zip lib); post-commit hook is bash + node stdlib.
- **All path inputs validated**: token-report's `validateProjectPath`, memory.cjs's `resolveExportPath`/`resolveImportPath`, and import's bundle-supplied filename guard all reject `..`, null bytes, and outsize-length attempts. The static analyzer warnings are false positives — same pattern as v0.12.0 path-traversal hardening.
- **Bundle import never escapes**: filenames in the JSON bundle are validated to disallow path separators (`/`, `\`) and `..`; only basenames are accepted.

## [0.19.0] - 2026-05-05

### Changed
- **`memory.preflight_mode` default flipped: `warn` → `block`** (`bin/modules/config.cjs:DEFAULTS`). The PreToolUse `pre-flight-guard.sh` hook now denies Edit/Write/NotebookEdit calls whose target file lacks a `PREFLIGHT <ts> edit <path> :: <governing IDs>` line in `.devt/state/scratchpad.md`. Agents preloading `devt:memory-pre-flight` (all 8 dev agents) write the line before each edit; older custom workflows that bypass the protocol must update OR set `memory.preflight_mode: "warn"` per-project. `off` remains an opt-out for projects that don't want the protocol.
- **`/devt:cancel-workflow` cleans the Pre-Flight Brief**: `scripts/cancel-workflow.sh` now removes `.devt/state/preflight-brief.md` and `.devt/state/scratchpad.md` alongside the workflow.yaml reset, so the next workflow starts with a clean Brief.

### Added
- **`docs/MEMORY.md`** (NEW, comprehensive guide): documents the three-layer model, Layer 3 frontmatter schema, Two-Tier Pre-Flight Protocol, full CLI surface, MCP server tool reference, curator promotion flow, memory maintenance discipline, configuration reference, migration notes, and cross-links to all related skills + guardrails.
- **README.md "The Memory Layer" section**: top-level visibility for the three-layer model + Pre-Flight Protocol + Graphify feature-parity table. Surfaces docs/MEMORY.md and the protocol skill as the canonical references.
- **`/devt:status` displays Pre-Flight Brief status**: status output now includes `Pre-Flight Brief: FRESH | STALE | MISSING (generated <timestamp>)` line so resume context surfaces whether the Brief is still authoritative.
- **`/devt:health` memory-integrity checks**: `MEM_VALIDATE_ERRORS` (frontmatter schema), `MEM_ORPHANS` (no in/out links), `MEM_STALE_LINKS` (broken cross-refs), `MEM_INDEX_STALE` (index older than newest .md mtime). Auto-repair via `memory index` for INDEX_STALE and VALIDATE_ERRORS.
- **`/devt:ship` PR body inclusion**: PR body generation reads `.devt/state/preflight-brief.md` and cites governing ADR/Concept/Flow ids + REJ tombstones the implementation respected, helping reviewers verify alignment without re-reading the Brief.
- **`/devt:pause` handoff includes Pre-Flight Brief reference**: `handoff.json` gains a `preflight_brief` field; `continue-here.md` surfaces the Brief's FRESH/STALE/MISSING status so resume sessions decide whether to re-run `/devt:preflight`. The Brief itself is NOT deleted on pause — it stays valid for the resumed workflow.
- **All 5 templates ship with Pre-Flight Protocol section**: `templates/{blank,go,python-fastapi,typescript-node,vue-bootstrap}/golden-rules.md` each gain a Pre-Flight Protocol section pointing to plugin Rule 14, with project-scoped guidance about checking ADRs in `.devt/memory/decisions/`.
- **CLAUDE.md updated**: documents the Phase 4 default flip + cross-links to `docs/MEMORY.md`.

### Hard Invariants Maintained
- **Override is one config key away**: `.devt/config.json` `memory.preflight_mode: "warn"` (or `"off"`) restores the previous behavior. Block-mode is the default because skipping the protocol on production-tier development is the higher long-term cost — but it's not mandatory.
- **No data deleted on flip**: existing Briefs, ADRs, lessons, and learning-playbook entries are untouched. The flip is purely a hook-behavior change.
- **Auto-index hook still optional**: `memory.auto_index_on_change: false` disables the PostToolUse rebuild for projects that prefer manual `memory index` runs.

## [0.18.0] - 2026-05-05

### Added
- **Topic Pre-Flight Brief generator** (`bin/modules/preflight.cjs`): orchestrates 6 independent discovery lanes (A: domain match via `memory.listActive`, B: FTS expansion via `memory.queryFTS`, C: symbol match via `memory.getBySymbol`, D: wiki-link transitive closure depth-2 via `memory.getLinks`, E: REJ tombstone overlap via `memory.listRejectedKeywords`, F: operational lessons via `semantic.query`) plus Graphify-derived blast radius. Synthesizes the merged result into `.devt/state/preflight-brief.md` with `## Status: FRESH` (validated by `state.cjs:ARTIFACT_SCHEMA`). Topic extraction is pragmatic and zero-deps — domains via `DOMAIN_HINTS` allowlist, symbols via PascalCase regex, keywords via stop-word filter. Determinism: identical input on identical state produces byte-identical output (modulo timestamp footer).
- **`/devt:preflight` standalone command + workflow** (`commands/preflight.md`, `workflows/preflight.md`): `/devt:preflight "<task>"` generates the Brief on demand. Subcommands: `topic` (debug topic extraction), `status` (read FRESH/STALE/MISSING), `mark-stale [reason]` (called by File Pre-Flight when scope expands). Standalone invocation registers `workflow_type=preflight`; auto-fire mode (called from another dev workflow) skips state mutation.
- **Vendored MCP server** (`bin/devt-memory-mcp.cjs`): zero-deps stdio JSON-RPC 2.0 server exposing 10 read-only tools — `get_context_for_path`, `get_context_for_symbol`, `query_fts`, `get_doc`, `list_active`, `list_rejected_keywords`, `list_links`, `preflight`, `blast_radius`, plus the SELECT-only `query_index` escape hatch. Hard guarantees: SQLite opened with `readOnly: true` (verified by node:sqlite — `attempt to write a readonly database`); SELECT-only validator strips comments, blocks multi-statement payloads (semicolon injection guard), and rejects 17 forbidden tokens (INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/REPLACE/TRUNCATE/PRAGMA/ATTACH/DETACH/VACUUM/REINDEX/ANALYZE/BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE). Self-test (`--self-test`) validates 15 SQL fixtures pass/fail correctly.
- **Two-Tier Pre-Flight Protocol skill** (`skills/memory-pre-flight/SKILL.md`): preloaded onto all 8 development agents. Documents Tier 1 (Topic Pre-Flight at workflow start, automatic) + Tier 2 (File Pre-Flight at each Edit, agent-driven via `PREFLIGHT <ts> edit <path> :: <governing IDs>` scratchpad lines). Includes 5-Lane File Pre-Flight (warm cache → wiki-links → path-anchored → symbol-anchored → domain-active → FTS) for scope-expansion cases.
- **PreToolUse `pre-flight-guard` hook** (`hooks/pre-flight-guard.sh`): on Edit/Write/NotebookEdit, scans `.devt/state/scratchpad.md` for a PREFLIGHT line covering the target file. Behavior governed by `memory.preflight_mode`: `off` no-op | `warn` emits stderr advisory (Phase 3 default) | `block` returns `{decision: "deny"}` (Phase 4 default). Fails-open on parse errors — never breaks legitimate work. Skips files in `.devt/state/`.
- **PostToolUse `memory-auto-index` hook** (`hooks/memory-auto-index.sh`): on Edit/Write/NotebookEdit touching `.devt/memory/**.md`, runs `node bin/devt-tools.cjs memory index` to keep the FTS5 unified index synchronized with markdown source. Idempotent — silent no-op when path doesn't match or `auto_index_on_change: false`. Logs to stderr but never fails the parent tool call. Eliminates the "I edited an ADR but forgot to reindex" failure mode.
- **`.mcp.json` setup-time scaffolding** (`bin/modules/setup.cjs`): writes a project `.mcp.json` registering `devt-memory` (always — vendored, referenced via `${CLAUDE_PLUGIN_ROOT}/bin/devt-memory-mcp.cjs` so plugin updates propagate without per-project copies), conditional `graphify` (when `graphify --help` succeeds — uses `graphify mcp --project .`), and conditional `claude-mem` (when `claude-mem --help` succeeds — uses `claude-mem mcp --db .claude-mem/mem.db`). Absent optional servers logged as actionable hints, never errors. Update mode preserves user-customized servers and only adds `devt-memory` when missing.
- **Workflow auto-fire integration** (9 dev workflows: `dev-workflow.md`, `quick-implement.md`, `create-plan.md`, `clarify-task.md`, `specify.md`, `research-task.md`, `debug.md`, `code-review.md`, `next.md`): each workflow's context_init step invokes `node bin/devt-tools.cjs preflight generate "${TASK_DESCRIPTION}"` early, so every subsequent agent reads the same governing rules. `next.md` resume routing recognizes `workflow_type=preflight`.
- **Agent integration**: all 8 development agents (programmer, architect, code-reviewer, debugger, researcher, tester, verifier, docs-writer) gained `devt:memory-pre-flight` in their `skills:` frontmatter. Programmer's `<context_loading>` block adds Step 0: read the Brief FIRST.
- **Golden Rule 14 — Pre-Flight Protocol** (`guardrails/golden-rules.md`): `[CRITICAL]` rule mandating Two-Tier Pre-Flight discipline before non-trivial changes. Documents the PREFLIGHT scratchpad line format and the PreToolUse hook contract.
- **Golden Rule 15 — Memory Maintenance Protocol** (`guardrails/golden-rules.md`): `[CRITICAL]` rule covering memory-index synchronization (PostToolUse hook does it automatically) and REJ tombstone consultation (mandatory before generating proposals).
- **Engineering Principles "Sources of Truth" section**: explicit hierarchy — ADRs > Concepts/Flows > REJ tombstones > .devt/rules > plugin guardrails. ADRs are constitutional.
- **Generative-debt checklist BEFORE/AFTER updates**: BEFORE-Coding gains "Read the Pre-Flight Brief"; AFTER-Coding gains "Memory index fresh after editing `.devt/memory/**.md`".
- **24+ new smoke-test assertions** covering: preflight CLI surface (topic / generate / status / mark-stale), brief artifact schema (FRESH status line), determinism (sha256 of timestamp-stripped body matches across two runs), MCP server self-test (15/15 SQL fixtures), MCP stdio handshake (initialize + tools/list + DROP rejection on tools/call), pre-flight-guard warn-mode advisory + covered-mode silence, .mcp.json scaffolding, gitignore manifest extension, file-presence checks for all 7 new artifacts, auto-fire integration in 8 dev workflows, agent skill preload in 8 agents, golden rules R14+R15 presence, state.cjs preflight workflow_type registration.

### Changed
- **`memory.preflight_mode` default**: `off` → `warn`. The hook surfaces an advisory but does NOT block the edit, giving teams a runway to adopt the protocol without immediate disruption. Phase 4 (v0.19.0) flips to `block`.
- **`hooks/run-hook.js` HOOK_PROFILES**: `pre-flight-guard.sh` and `memory-auto-index.sh` registered for `standard` + `full` profiles (excluded from `minimal` to keep that profile bare-bones).
- **`hooks/hooks.json`**: new PreToolUse entry on Write|Edit|NotebookEdit for `pre-flight-guard.sh` (5s timeout); new PostToolUse entry on the same matchers for `memory-auto-index.sh` (15s timeout, async).
- **`bin/devt-tools.cjs` CLI usage**: documents the new `preflight` subcommand surface.
- **`.devt/config.json` DEFAULTS** (`bin/modules/config.cjs`): comment block updated to reflect `warn` as the new Phase 3 default.

### Hard Invariants Maintained
- **Zero project-level dependencies**: the vendored MCP server is referenced via `${CLAUDE_PLUGIN_ROOT}` — projects don't install npm packages to use it.
- **Read-only at the SQLite layer**: even malicious helpers cannot mutate. The SELECT-only validator is defense-in-depth.
- **Graceful degradation everywhere**: missing memory index, disabled Graphify, absent claude-mem — every code path produces a coherent payload. Pre-flight on an empty universe still writes a valid Brief.
- **No silent file writes**: the only file `bin/modules/preflight.cjs` writes is `.devt/state/preflight-brief.md`. Curator-gated promotion (Phase 2) remains the only path to permanent `.devt/memory/**.md` files.

## [0.17.0] - 2026-05-05

### Added
- **Optional Graphify integration** (`bin/modules/graphify.cjs`): subprocess wrapper around the `graphify` CLI binary (multi-language tree-sitter AST extractor — 26 languages). Exposes the four MCP-style helpers (`queryGraph`, `getNode`, `getNeighbors`, `shortestPath`) plus a custom `blastRadius` that aggregates neighbor counts, modules touched, AMBIGUOUS bindings, and god-node detection from `GRAPH_REPORT.md`. **Core invariant: the system is fully functional WITHOUT Graphify** — every method returns a structured `{ source, results, degraded?, error? }` payload with the four-trigger fallback (empty / error / not setup / under min_results_threshold). Setup wizard pitches Graphify as "strongly recommended" but a "no thanks" answer produces a fully working install. Honors Graphify's own config surface (`.graphifyignore`, `.graphifyinclude`, `GRAPHIFY_OUT` env var). Reads `built_at_commit` from `graph.json` for freshness checks. Detects warm-cache file with wiki-first preference (`graphify-out/wiki/index.md` → `GRAPH_REPORT.md` fallback).
- **Discovery engine** (`bin/modules/discovery.cjs`): harvests session signals into `_suggestions.md` for curator review. Sources (priority order): claude-mem ⚖️ decision and 🔵 discovery tagged entries (when claude-mem installed) → `#KNOWLEDGE-CANDIDATE` inline tags in scratchpad → `.devt/state/decisions.md` DEC-xxx entries. Each candidate carries the **full original reasoning verbatim** — no AI summarization. Filters: REJ tombstone consultation (suppresses matches silently — the "no nag" mechanism), token-overlap deduplication against existing memory docs (60% threshold). Wiki-link enrichment scans 5 surfaces (decisions.md, research.md, spec.md, learning-playbook.md, CLAUDE.md) for bare mentions of memory-doc IDs and proposes `[[ADR-xxx]]` additions. **Hard guarantee: NEVER writes a permanent `.devt/memory/{decisions,concepts,flows,rejected}/*.md` file** — that's exclusively the curator agent's role via AskUserQuestion.
- **Memory layer Phase 2 subcommands** (`bin/modules/memory.cjs` extensions): `backlinks <id>` (incoming refs — load-bearing for safe ADR supersession), `orphans` (no in/out links — surface for curator), `stale-links` (forward refs to non-existent docs), `affects-symbol <s>` (Graphify-anchored, returns `degraded=true` when disabled), `suggest` (invokes discovery engine, writes `_suggestions.md`), `migrate-lessons` (imports legacy `lessons.db` rows into the unified `.devt/memory/index.db` with doc_class='lesson' — backward-compat for one release, Phase 3 will deprecate the old DB). `promote` and `reject` subcommands route through curator workflows (no direct file writes).
- **`skills/memory-curation/SKILL.md`** (NEW, ~250 lines): the curator's promotion authority. Reads `_suggestions.md`, applies the 5-filter (Specificity, Durability, Non-obviousness, Evidence, Actionability), presents each qualified candidate via AskUserQuestion with the FULL original reasoning verbatim (no curator paraphrasing), captures the user's choice (Promote active | Promote candidate | Reject as REJ | Defer | Edit before promoting), writes the markdown, runs `memory index`. Hard invariants: no file write without AskUserQuestion approval; no bulk auto-approve; REJ search_keywords mandatory and exhaustive (curator MUST surface "Are these keywords exhaustive?" before committing).
- **`skills/graphify-helpers/SKILL.md`** (NEW, ~250 lines): canonical Graphify-first protocol for every developer skill. Documents the 4 fallback triggers, per-skill `min_results_threshold` defaults, decision tree, result tagging (`source: graphify | grep | merged`), reusable Bash snippets, and the without-Graphify feature parity table. All other dev skills consume this rather than calling Graphify or grep directly.
- **`workflows/memory-promote.md`** (NEW): curator-gated DEC → ADR/CON/FLOW promotion. Dispatches curator agent with memory-curation skill, runs `memory index` after writes.
- **`workflows/memory-reject.md`** (NEW): captures REJ tombstones with curator-verified search_keywords (the "Are these keywords exhaustive?" gate is the only thing standing between the tombstone and AI-nagging in 2 weeks).
- **34 new smoke-test assertions** covering: graphify graceful degradation, discovery engine claude-mem detection, memory backlinks/orphans/stale-links/affects-symbol, presence of all 6 new files, curator skill preload, integration sections in 11 skills + 8 workflows. Total smoke count: 43 → 77.

### Changed
- **`agents/curator.md`**: gains `skills: [devt:playbook-curation, devt:memory-curation]` preload + `AskUserQuestion` tool. Role description extends to memory-layer gatekeeping. Curator now spans both surfaces with the same 5-filter discipline.
- **`agents/retro.md`**: extended extraction — alongside operational lessons, watches for `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected]` tags so the discovery engine surfaces architectural candidates to curator.
- **`agents/researcher.md`**: consults `.devt/memory/` BEFORE recommending an approach; pre-rejects recommendations matching active REJ tombstones; tags stable findings as `#KNOWLEDGE-CANDIDATE: [type=concept]`; populates `links:` field in research.md.
- **`agents/debugger.md`**: REJ tombstone consultation is HARD RULE — proposed fixes matching tombstone search_keywords are silently filtered (the AI-nagging mitigation extends from autoskill into debug). Debug findings can promote to FLOW-xxx via curator.
- **`agents/architect.md`**: arch-review references active ADRs by id; detects Stale ADRs (path/symbol resolution failures) for curator update or supersession; suggests new ADR candidates via `#KNOWLEDGE-CANDIDATE: [type=decision]`.
- **`agents/code-reviewer.md`**: every review now produces an "ADR Compliance" section (Critical severity for violations); enumerates affected callers via Graphify when enabled; treats ADR violations same as security findings.
- **11 dev skills extended with Memory + Graphify integration sections** (Graphify-first protocol with grep fallback): `codebase-scan`, `code-review-guide`, `lesson-extraction`, `playbook-curation` (sister-skill cross-reference), `architecture-health-scanner` (Stale ADR detection), `autoskill` (REJ HARD RULE), `strategic-analysis`, `tdd-patterns`, `verification-patterns`, `complexity-assessment` (blast_radius primary input for tier selection), `semantic-search` (dual-search via unified index + Graphify).
- **8 dev workflows extended with Memory layer integration sections**: `clarify-task` (end-of-clarify offers DEC→ADR promotion + REJ pre-rejection), `specify` (PRD auto-cites related ADRs), `research-task` (researcher consults Concepts/REJs), `lesson-extraction` (extracts both lessons AND architectural candidates), `debug` (REJ-aware investigation), `code-review` (ADR Compliance Critical findings), `autoskill` (REJ consultation HARD RULE), `arch-health-scan` (Stale ADR finding type).
- **`bin/devt-tools.cjs`**: wires `graphify` and `discovery` subcommands; help text expanded with all Phase 2 entries (memory backlinks/orphans/stale-links/affects-symbol/suggest/migrate-lessons + 6 graphify subs + 3 discovery subs).

### Documentation
- **`CLAUDE.md`** Key Conventions: `graphify.*` config knob (optional, opt-in), claude-mem ⚖️/🔵 harvest mechanism, curator promotion flow, two-confidence-layer model (doc-level + per-symbol binding_confidence).
- **`docs/COMMANDS.md`**: `/devt:memory` section expanded with Phase 2 subcommands; new `/devt:memory promote` and `/devt:memory reject` documentation; `graphify` and `discovery` subcommand reference; the without-Graphify feature parity table.

## [0.16.0] - 2026-05-05

### Added
- **Memory layer foundation (`.devt/memory/`)**: permanent knowledge store for architectural decisions (ADRs), concepts (CONs), flows (FLOWs), and rejected proposals (REJ tombstones). Each doc carries strict frontmatter (`id`, `title`, `doc_type`, `status`, `confidence`, `summary`, optional `affects_paths`, `affects_symbols`, `links`, `created_at`, `created_by`, `schema_version`); REJ docs additionally carry `reason` and `search_keywords` (for future AI suppression in autoskill). Three-layer separation: `.devt/state/decisions.md` stays per-workflow ephemeral; `.devt/learning-playbook.md` stays for operational lessons; `.devt/memory/{decisions,concepts,flows,rejected}/*.md` is the new permanent architectural layer. This is Phase 1 of the multi-release Cognitive Coding Architecture v27.0 integration plan; Phase 2 (v0.17.0) wires Graphify symbol anchoring + curator-gated promotion + claude-mem ⚖️/🔵 tag harvest, Phase 3 (v0.18.0) ships the Topic Pre-Flight Brief + vendored MCP query layer, Phase 4 (v0.19.0) flips block-mode + wide-surface integration polish.
- **`bin/modules/memory.cjs`** (847 lines): pure-Node FTS5 unified index via `node:sqlite`. Atomic drop+rebuild within a single SQLite transaction (failure rolls back to prior index state). Frontmatter YAML-subset parser (handles scalars, list-of-scalars, list-of-objects). Strict per-doc-type schema validator with id-pattern enforcement (`ADR-\d{3,}` / `CON-` / `FLOW-` / `REJ-`). Query helpers: `getDoc`, `getByPath` (glob-aware), `getBySymbol`, `listActive`, `listRejectedKeywords`, `queryFTS` (prefix-matched + AND-combined tokens), `getLinks` (transitive depth-2 by default), `listDocs`, `validate` (frontmatter + path resolution + broken-link detection). Files prefixed with `_` are NEVER indexed (auto-generated reports like future `_suggestions.md`). Templates with id ending in `-000` are skipped during indexing. `links.target_id` has no FK constraint — forward references to not-yet-created docs are valid; broken links surface as warnings via `memory validate`.
- **`/devt:memory` slash command** with subcommands: `init`, `index`, `query`, `get`, `affects`, `list`, `links`, `active`, `rejected-keywords`, `validate`. Phase 2 will add `suggest`, `promote`, `reject`, `backlinks`, `orphans`, `stale-links`, `affects-symbol`. The command routes through `workflows/memory-init.md` (subcommand dispatcher, no agent dispatch).
- **`schemas/memory-doc.yaml`**: JSON Schema documentation for the four doc types. Used by `validateFrontmatter()` in `memory.cjs`, by curator agent during Phase 2 promotions, and by the discovery engine during Phase 2 wiki-link enrichment.
- **`templates/memory/{ADR,CON,FLOW,REJ}-template.md`**: scaffolding templates with the strict frontmatter and section structure. Templates are skipped during indexing (id ends in `-000`).
- **`bin/modules/state.cjs:ARTIFACT_SCHEMA`** entry for `preflight-brief.md` (status enum: `FRESH | STALE | MISSING`). Populated in Phase 3.
- **`bin/modules/state.cjs:VALID_WORKFLOW_TYPES`** additions: `memory_init`, `memory_index`, `memory_promote`, `memory_reject`, `preflight`. Routing in `workflows/next.md` will follow as Phase 2/3 ship.
- **`bin/modules/config.cjs:DEFAULTS`** new blocks: `memory: { enabled: true, preflight_mode: "off", auto_index_on_change: true }` and `graphify: { enabled: false, command: "graphify" }`. Phase 1 keeps `preflight_mode: "off"` since hooks haven't shipped; Phase 3 default flips to `"warn"`, Phase 4 to `"block"`.
- **`bin/modules/setup.cjs`**: `/devt:init` now scaffolds `.devt/memory/{decisions,concepts,flows,rejected}/` and gitignores `.devt/memory/index.db` (regenerable from markdown — never commit). The four ADR/CON/FLOW/REJ subdirs ARE intentionally committed (team-shared architectural truth).
- **13 new smoke-test assertions** covering: scaffolding, atomic rebuild, `_*` skip behavior, FTS5 prefix matching, glob-based affects, REJ tombstone keywords, validation errors on missing required fields, deterministic retrieval (rebuild on unchanged state produces identical doc set).

### Changed
- Smoke-test count: 30 → 43 passing.

### Documentation
- **`docs/COMMANDS.md`**: new `/devt:memory` section with full subcommand reference.
- **`CLAUDE.md`** Key Conventions: documents the three-layer memory architecture (state/playbook/memory) and notes that Phase 1 is data-layer-only (no agent integrations yet — those land in Phase 2+).

## [0.15.0] - 2026-05-05

### Changed
- **`/devt:council` advisors now produce structured, research-grounded output**: every advisor response follows a fixed format — `## Options Considered`, `## Recommendation`, `## Validated Reasoning` (numbered claims with `Evidence:` citations to specific files, rules, research findings, or codebase patterns), and an optional `## Unvalidated Concerns` (claims the advisor suspects but cannot ground in available material, tagged `[speculation]`). Advisors are now explicitly instructed to **actively investigate** using Read/Grep/Glob before forming claims — the Validated Reasoning section presents the **outcomes** of those investigations rather than generic takes filtered through a persona lens. The prompt suggests perspective-specific investigation patterns (Contrarian greps for prior bugs/TODOs/incident history; First Principles reads the existing API contract; Generalizer globs for similar modules; Newcomer reads entry points and onboarding docs; Pragmatist scans recent commits to gauge typical PR size). Free-form prose is a regression — advisors are re-dispatched if they skip the structure. Peer review (Stage 3) gains a fourth question explicitly scoring evidence-quality across the five anonymized responses. Chairman synthesis (Stage 4) gains two new verdict sections — `## What Grounded the Verdict` (specific evidence cited across multiple advisors backing the recommendation) and `## Where the Council Speculates` (consequential Unvalidated Concerns + the artifact or check that would convert each from speculation to validated reasoning) — and explicitly weights Validated Reasoning over Unvalidated Concerns when adjudicating disagreement. Word budget bumped from 150-300 to 250-400 per advisor (structure + investigation outcomes cost words; that's fine — without the bump advisors compress claims into unsupported one-liners). Behavior change for existing users: verdicts become more evidence-anchored and less rhetorical, advisors investigate before reasoning, and unvalidated speculation is flagged explicitly instead of disguised as conviction.

### Added
- **Council offramp integrated into brainstorming workflows** (`/devt:clarify`, `/devt:research`, `/devt:specify`): when a gray area or open question trips a 3-condition threshold — **multiple viable approaches** AND **hard to reverse** AND **high stakes** — the workflow offers `/devt:council` as one of the resolution options in its `AskUserQuestion` list, alongside the standard pick-A/B and defer paths. Threshold, template, and capture rules live in a new shared reference (`references/council-offramp.md`) so future tweaks don't require touching three workflow files. Soft cap of 1 council invocation per workflow session prevents cumulative time blowup. Council never auto-invokes — always offered as one option. Verdict is captured back into the calling workflow's primary artifact: `clarify` writes a new `DEC-xxx` entry in `.devt/state/decisions.md` referencing the transcript; `research` appends a `## Council Verdict on {decision}` section to `.devt/state/research.md`; `specify` adds a Decisions entry to the PRD plus a `DEC-xxx`. Each workflow passes caller-specific `validation_material` paths into the council framing so advisors ground their reasoning in the right artifacts (e.g. research caller passes `research.md`; specify caller passes the in-progress `spec.md`).
- **`references/council-offramp.md`** — new shared reference document encoding the threshold (§1, AND-of-three test), offramp template (§2, the AskUserQuestion options block), invocation/capture protocol (§3 with caller-specific validation_material map and capture format per workflow), anti-patterns (§4, including the soft cap and re-running guard), and when to use `strategic-analysis` instead of council (§5).

### Documented
- **`docs/COMMANDS.md` `/devt:council` section**: now documents the structured advisor output contract (Options + Validated Reasoning + Unvalidated Concerns), the chairman verdict's expanded 7-section structure (was 5), and the offramp integration with the three brainstorming workflows.

## [0.14.0] - 2026-05-05

### Changed
- **Golden Rule 5 reframed: Boy Scout Rule → Surgical Changes**, with explicit Find-Surface-Decide protocol for unrelated findings. The old rule told agents to "leave code cleaner than you found it" which gave them license for silent drive-by edits — a known LLM failure mode that bloats diffs and obscures the real change. The reframed rule scopes cleanup to orphans the agent's own changes create, and routes any unrelated improvements through a 4-step protocol: **Find** (note the file + one-line description), **Surface** (present as a side-finding, not a fait accompli), **Decide** (ask the user whether to fix-now / split-into-follow-up / record-in-summary), then act on the choice. Failure mode named explicitly: "I noticed it, I should fix it" is now an opt-in behavior, not a default. Adapted from [Andrej Karpathy's observations on LLM coding pitfalls](https://x.com/karpathy/status/2015883857489522876) via [@forrestchang's andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills).
- **All 5 project templates updated**: `templates/{blank,go,python-fastapi,typescript-node,vue-bootstrap}/golden-rules.md` Rule 4 (the project-scoped twin of plugin Rule 5) now mirrors the Surgical Changes framing with stack-specific examples (ESLint/golangci-lint/ruff/etc.). `templates/vue-bootstrap/coding-standards.md` parenthetical updated. The vue-bootstrap legacy Options API → `<script setup>` conversion remains explicitly pre-approved at the project level — that's a documented exception, not a license for general drive-by edits.

### Added
- **`scope_mode` config knob (`bin/modules/config.cjs`)**: defaults to `"surgical"` (Find-Surface-Decide for any unrelated finding). Project owners can set `scope_mode: "boyscout"` in `.devt/config.json` to grant blanket cleanup authority for small mechanical issues — dead imports, lint warnings, typos in comments, formatting — within files agents are already editing, without invoking the protocol. Anything larger (refactors, behavior changes, cross-file cleanups) still goes through Find-Surface-Decide regardless of mode. Resolved through the existing 3-level merge (defaults ← `~/.devt/defaults.json` ← `.devt/config.json`); surfaced to agents via the standard `init` payload — no enforcement code, declarative-only like the rest of devt's config surface.
- **Golden Rule 12 — Surface Assumptions Before Implementing `[CRITICAL]`**: agents must state non-trivial assumptions explicitly and present interpretations rather than picking one silently when a task is ambiguous. Targets the most expensive failure mode in AI-assisted coding: silent assumption + plausible-looking output for the wrong problem.
- **Golden Rule 13 — Minimum Viable Implementation `[WARNING]`**: complement to existing Rule 8 (Complexity/Benefit Evaluation). Where Rule 8 targets defensive over-engineering (try/catch, redundant validation), Rule 13 targets scope creep and speculative features (unrequested config knobs, generic abstractions for one caller, "we might need this later" plumbing). The senior-engineer test: would a careful reviewer say this is overcomplicated? If yes, simplify.

### Documented
- **`CLAUDE.md` — `scope_mode` config field**: noted under Key Conventions so future contributors discover the field without reading the rule body.

## [0.13.0] - 2026-04-30

### Added
- **`/devt:council` slash command + `council` skill (Karpathy LLM Council adapted for engineering)**: pressure-test high-stakes engineering decisions through 5 advisors with distinct thinking styles (Contrarian / First Principles / Generalizer / Newcomer / Pragmatist) that analyze in parallel, peer-review each other anonymously, and pass to a chairman for synthesis. Adapted from [@tenfoldmarc's LLM Council skill](https://github.com/tenfoldmarc/llm-council-skill); methodology by [Karpathy](https://github.com/karpathy/llm-council). Retuned for engineering trade-offs (architecture choices, refactor strategies, API design, contentious code-review feedback) and integrated with devt conventions: auto-pulls `.devt/rules/{architecture,coding-standards,golden-rules}.md` for context, writes markdown transcripts to `.devt/state/council-{slug}-{timestamp}.md` (no HTML — engineering tooling, integrates with `/devt:plan` and `/devt:clarify` downstream), expands trigger phrases with engineering-specific cues (`red team this`, `audit this approach`, `devil's advocate`, `second opinion`), and adds an opt-in `--mixed-models` flag that dispatches advisors across opus/sonnet/haiku via the Task tool's `model` parameter for genuine reasoning diversity (closer to Karpathy's original cross-vendor design). Chairman synthesis uses `model: opus` when available — chairman quality dominates the verdict per Karpathy's principle. Anonymization order is randomized every session to remove positional bias on top of identity bias. Skill total: 16 directories (was 15); commands: 29 entry points (was 28).

## [0.12.0] - 2026-04-28

### Changed
- **Permissive `allowed-tools` extended**: all 15 skills now also pre-allow `WebFetch`, `WebSearch`, `Skill`, and `Task` on top of the prior `Bash Read Write Edit Grep Glob` baseline. Lets skills cross-invoke each other, spawn subagents, and fetch web content without per-call permission prompts while the skill is active. Defense-in-depth for users whose project `.claude/settings.json` is more restrictive than the permissive default scaffolded by `setup.cjs`.
- **Project `.claude/settings.json` scaffold parity**: `setup.cjs` now also pre-allows `Skill` and `Task` at the project level, mirroring the per-skill `allowed-tools` superset so end-users running `/devt:init` no longer hit a prompt the first time a skill cross-invokes another skill or spawns a subagent.
- **`architecture-health-scanner` runs in a forked subagent context**: skill frontmatter now declares `context: fork` with `agent: general-purpose`. The scanner-triage workflow reads many source files to verify findings (per the skill's "NO CLASSIFICATION WITHOUT READING THE ACTUAL CODE" iron law), so isolating it from the main conversation context prevents the heavy file reads and intermediate analysis from polluting the caller's context — only the prioritized remediation plan returns. Skill still has the explicit Steps 1-7 task structure that the docs require for fork-mode skills to produce meaningful output.

### Fixed
- **`setup.cjs` path-traversal hardening (CWE-22)**: `copyDirRecursive` and `copyMissingFiles` now reject suspicious entry names (separators, traversal markers, null bytes, symlinks) and validate each filesystem entry through `validatePath` from `security.cjs` before any `fs.copyFileSync` or recursive descent. `setupProject` additionally validates the resolved templateDir stays within `pluginRoot/templates` as defense-in-depth even though `templateName` is allowlisted upstream. Same hardening pattern that was applied to `scanDevRules` in v0.9.1, extended to the template-copy machinery. Reduces semgrep CWE-22 findings on this file from 12 to 3 (remaining flags are on hardcoded infrastructure paths where inputs are not externally controllable). No behaviour change — the smoke check that exercises `setup --template python-fastapi` end-to-end (mixed-extension copy with `arch-scan.py` + rules markdown) continues to pass.

## [0.11.0] - 2026-04-28

### Added

- **Native subagent frontmatter adoption**: devt now uses the platform-native `memory:`, `skills:`, and `allowed-tools:` fields documented at code.claude.com instead of prose-driven knowledge management.
  - `memory: project` on `code-reviewer`, `debugger`, `retro`, `curator` — each agent writes to `.claude/agent-memory/devt-<agent>/MEMORY.md` (auto-injected at startup, gitignored). Persistent across sessions, scoped per project.
  - `skills:` preload on `programmer` (devt:codebase-scan), `code-reviewer` (devt:code-review-guide), `verifier` (devt:verification-patterns) — the full skill body is injected into the agent's system prompt at spawn, eliminating the "agent forgot to invoke its primary skill" failure mode. Empirically validated via signature-phrase probe.
  - `allowed-tools: Bash Read Write Edit Grep Glob` on all 15 skills (api-docs-fetcher also gets `WebFetch WebSearch`). Eliminates per-invocation permission prompts for routine dev operations while a skill is active.
  - `paths:` glob on `tdd-patterns` so the platform auto-activates the skill when Claude touches test files (Python `test_*.py` / `*_test.py`, JS/TS `*.test.*` / `*.spec.*`, Go `*_test.go`, and `test/spec` directories).

- **Single-plugin marketplace** (`.claude-plugin/marketplace.json`): turns this repo into a self-hosting marketplace so end-users can install with `/plugin marketplace add emrecdr/devt && /plugin install devt`. Marketplace points at the same repo via `source: "./"`; version stays in lock-step with `plugin.json`. Before: install required `git clone` + `claude --plugin-dir ~/.devt` and the agents would not register without the flag. After: `/plugin install` registers all 10 plugin agents under the `devt:` namespace and supports `/plugin update`.

- **`.claude/settings.json` scaffolding in `setup.cjs`**: project init now writes a permissive starter at `.claude/settings.json` (only when absent — never overwrites). Pre-allows `Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob`, `WebFetch`, `WebSearch`; gates only genuinely destructive operations (`rm -rf`, `git push --force`, `git reset --hard`, `npm publish`, `yarn publish`, `pip install`) behind `permissions.ask`.

### Changed

- **Debugger knowledge base location**: persistent debug findings now write to `.claude/agent-memory/devt-debugger/MEMORY.md` (the native agent-memory path) instead of `debug-knowledge-base.md` at project root. Before: the project-root file was the only persistence layer and required prose instructions in the agent body to read/write it. After: the platform auto-injects the first 200 lines of `MEMORY.md` into the debugger's system prompt at startup, and the agent has Read/Write auto-enabled on its own memory directory. Legacy `debug-knowledge-base.md` is still read for backwards compatibility — pre-migration entries remain accessible — but new writes go to the native location only. Touchpoints updated: `agents/debugger.md`, `workflows/debug.md`, `docs/COMMANDS.md`, `CLAUDE.md`.

- **`setup.cjs` gitignore handling**: now adds `.claude/agent-memory/` alongside `.devt/state/` when initialising a project. Per-project agent memories should never be committed regardless of the project's prior gitignore state.

### Documented

- **`CLAUDE.md` — Plugin loading invariants**: three non-obvious platform behaviours documented inline so future Claude sessions understand the architecture before debugging "missing agent" symptoms:
  - Plugin agents register only when devt is loaded via `claude --plugin-dir <path>` or installed through the plugin system. Sessions that rely solely on cwd-auto-discovery see commands and skills but `devt:<agent>` subagents will not appear in `claude agents`.
  - Agent persistent memory writes to `.claude/agent-memory/devt-<agent>/MEMORY.md` (hyphen replaces colon for filesystem safety).
  - Agent `skills:` preload requires the `devt:` namespace prefix (`skills: [devt:codebase-scan]`); the plain skill name silently fails to inject. Plugin agents also do not honour `permissionMode`, `hooks`, or `mcpServers` (security restriction — silently ignored by the platform).

- **README install section rewrite**: marketplace install promoted to "recommended" path with explicit `/plugin marketplace add` + `/plugin install` flow. Git-clone + `--plugin-dir` retained as the development path with notes about why agent registration depends on the loading mechanism.

## [0.10.0] - 2026-04-28

### Added
- **arch-scan.py skips `.devt/` directory**: when deployed at `.devt/rules/arch-scan.py`, the scanner would have audited itself plus `.devt/` scaffolding. Added `.devt` to the skip list (alongside existing `.venv`, `__pycache__`, `node_modules`, etc.) so the scanner only audits real project source. Also fixes inline-import detection inside class methods (visit_ClassDef now recurses into method bodies — previously `def` children of classes were skipped, so inline imports inside repository methods were missed)
- **Smoke check for `setup --template python-fastapi`**: existing check only exercised `--template blank`. The new check uses an isolated temp dir (so the smoke's earlier `init workflow` doesn't pollute the project-root walk) and asserts BOTH `.devt/rules/arch-scan.py` AND `.devt/rules/coding-standards.md` are present after setup, exercising the mixed-extension copy path. Suite now 24 checks
- **Reference Python arch scanner**: `templates/python-fastapi/arch-scan.py` ships a slim, generic, stdlib-only Clean-Architecture scanner (~290 lines). Detects 6 categories: `LAYER-IMPORT-DOMAIN` (domain importing from outer layers), `LAYER-IMPORT-API` (api reaching past application into infrastructure), `DB-IN-APPLICATION` (raw `Session`/`select` import in application layer), `INLINE-IMPORT` (function-body imports — circular-dep smell), `GOD-FILE` (configurable line cap, default 600), `GOD-CLASS` (configurable method cap, default 25). Output: human-readable text or `--json` for the architect agent. Exit codes are gated by `--fail-on` (default: critical+high). `--disable=CAT,CAT` skips categories; `--service-root` and `--max-*` thresholds tune to non-greenfield layouts. Deploys to `.devt/rules/arch-scan.py` via the existing template-copy machinery — wire into `.devt/config.json` as `"arch_scanner": { "command": "python3 .devt/rules/arch-scan.py --json" }`. Smoke suite gains 2 checks (clean project = 0 findings + exit 0; dirty project = critical + high findings + exit 1); now 23 checks
- **Parallel quality gates**: `scripts/run-quality-gates.sh` now recognizes a `parallel` info-string on fenced bash blocks (` ```bash parallel `). Consecutive parallel-tagged blocks group into one batch and run concurrently; sequential blocks force-flush any pending batch first. Each block's stdout/stderr is captured to a temp file and replayed in submission order so output stays per-gate readable. Failures in a parallel block correctly fail the batch (exit non-zero, FAIL count increments). Existing security validation (allowlist, no shell metacharacters) applies per-block unchanged. `templates/python-fastapi/quality-gates.md` now ships with ruff-check / ruff-format-check / mypy as a 3-block parallel batch and pytest as the trailing sequential gate — read-only checks parallelize, mutating checks moved to a "Fix Helpers" section that is explicitly NOT run by `/devt:quality`. Smoke suite gains 2 checks (parallel batch concurrency + failure propagation); now 19 checks
- **`semantic query` filter flags**: `--min-importance=N`, `--min-confidence=F`, `--category=NAME`, `--tags=a,b,c`, `--limit=N`. Filters apply *after* FTS5 ranking (over-fetching capped at 200) so match quality is preserved. Unknown flags and out-of-range values (e.g. `--min-importance=99`) are rejected with a clear error. Output now includes a `filters` field echoing what was applied. The grep fallback honors the same filters. `dev-workflow.md` step `context_init` defaults to `--min-importance=6 --limit=8` so injected `learning_context` stays high-signal — agents read fewer, more relevant lessons. Smoke suite gains 3 checks (no-playbook filtered query, unknown-flag rejection, out-of-range rejection); now 17 checks
- **Tag-driven GitHub releases**: `.github/workflows/release.yml` fires on `v*` tag push, extracts the matching `CHANGELOG.md` section, and creates a GitHub release with those notes. Idempotent — skips cleanly if a release already exists. Pre-release tags (containing `-`) are flagged accordingly. All step-output values pass through `env:` to prevent shell injection from maliciously named tags
- **`scripts/extract-changelog.sh`**: AWK-based extractor that pulls a single version's section out of `CHANGELOG.md`. Used by the release workflow and the CI coverage check. Exits non-zero if the version is not found
- **CI CHANGELOG coverage check**: `manifest-version-coherence` job in `ci.yml` now fails if `VERSION` is bumped without a matching `## [X.Y.Z]` section in `CHANGELOG.md`. Stronger contract than the README-badge check it replaces
- **README badges**: dynamic version badge (reads from GitHub Releases API), CI status badge, Node 22+ badge, Changelog badge, License badge. The dynamic version badge self-validates — no static value to keep in sync

### Changed
- **CI version coherence**: dropped the README-badge string check (the new dynamic shields.io badge reads from the GitHub API, so there's nothing to drift). Coherence is now enforced between `VERSION` and `plugin.json` only

### Fixed
- **Silent data loss in `semantic.cjs` playbook parser**: `parsePlaybook` regex required lines to start with a word character, so YAML-list entries (`- description: ...`, the format shown in `schemas/learning-entry.yaml`'s example) were silently dropped at sync time. Sync would report `synced: N` based on entries the parser actually understood; entries written in the schema's documented format vanished without warning. Parser now strips an optional leading `- ` before key matching, so both `- key: value` and `key: value` are accepted. No migration needed — existing playbooks that already worked still work, and any retro/curator output following the schema literally will now sync. New smoke check guards against regression
- **`/devt:quality` was broken on 3 of 5 stack templates**: `templates/{go,typescript-node,vue-bootstrap}/quality-gates.md` shipped "Quick Reference" / "Running All Gates" blocks tagged ` ```bash ` containing `&&`-chained commands. The runner's security validator (correctly) rejects shell metacharacters, so these aggregator blocks always failed with a misleading "command not in allowlist" message — masking the real gate results above them. Aggregator blocks retagged ` ```text ` so the runner skips them as documentation while humans can still copy-paste. The runner's rejection messages now distinguish "shell metacharacter — split into separate gates" from "command prefix not in ALLOWED_PREFIXES", so future violations point at the actual problem. New smoke check confirms both rejection reasons surface correctly
- **`arch_scanner` docs/config drift**: `README.md` claimed the default for `arch_scanner` was "built-in scanner", and `.devt-config.json.example` referenced `uv run python scripts/arch_scanner.py` — but devt does not ship a scanner script, so copying the example into a project would surface a "command not found" at scan time. README now states `command: null` is the real default and explicitly says devt does not ship a built-in scanner; example config sets `command: null` with a comment explaining users provide their own (e.g. `make arch-scan`, `npx ts-arch`). The architect agent already falls back to manual Grep/Glob analysis when no scanner is configured — that path was already correct, only the docs lied

### Documented
- **Release flow**: `CLAUDE.md` and `README.md` document the tag-driven release process (commit + push → tag + push → release auto-created)
- **Backfilled GitHub releases**: v0.9.0, v0.9.1, v0.9.2, v0.9.3 now have proper GitHub releases at their original commit SHAs

## [0.9.3] - 2026-04-27

### Added
- **Smoke suite CLI coverage**: `scripts/smoke-test.sh` now exercises all 9 CLI subcommands. Before: `init`, `state`, `config`, `models`, `update` (5 of 9). After: adds `health`, `semantic status`, `report window`, `setup --template blank` — closes silent-regression gap on 4 untested subcommands. Suite goes from 11 to 16 checks
- **Agent size-budget guard**: smoke suite enforces a 500-line hard cap on `agents/*.md` files. Largest agent at release is 387 lines, so the check is forward-looking — it prevents agent prompt bloat without forcing any current cleanup. Bump deliberately if a new agent legitimately needs more

### Documented
- **Agent budget convention**: `CLAUDE.md` Key Conventions now states the 500-line agent limit and rationale (extract sub-skills or references when a prompt grows past the cap)

## [0.9.2] - 2026-04-27

### Added
- **CI smoke suite**: `scripts/smoke-test.sh` exercises 11 CLI checks (manifest parse, init/state/config/models/update return JSON, 50 KB cap rejection, concurrent locking) in a temp project. Wired into `.github/workflows/ci.yml` across Node 22 and 24
- **CI version coherence check**: GitHub Actions job asserts `VERSION`, `plugin.json` `version`, and the README badge stay in lock-step. Drift fails the build
- **CI workflow_type registry check**: Asserts every entry in `VALID_WORKFLOW_TYPES` has a routing rule in `next.md`, preventing the kind of drift that would silently break resume after pause
- **Concurrent locking test**: New `scripts/test-locking.cjs` spawns 20 parallel writers against a shared `workflow.yaml` and asserts no lost updates and no orphaned `.lock` file. Documents that `acquireLock` / `releaseLock` (`bin/modules/state.cjs:326-389`) actually serialize. Runs in the smoke suite

### Documented
- **Memory-skill boundary**: `skill-index.yaml` header now distinguishes `scratchpad` (ephemeral, within-workflow, resets between runs) from `lesson-extraction` (permanent, cross-workflow, scored playbook entries) at the orchestrator-facing layer. Before: the boundary was only inside each `SKILL.md`. After: an editor adding a third memory skill sees the routing rule before they pick a name

## [0.9.1] - 2026-04-27

### Added
- **Task length cap**: `init.cjs` now rejects task descriptions over 50 KB with a clear error. Defense-in-depth against accidental prompt bloat from oversized inputs
- **Hook profile reference**: `CLAUDE.md` now includes a table mapping every hook script to the `minimal`/`standard`/`full` profiles, so users no longer need to read `run-hook.js` source to understand which hooks fire

### Changed
- **`scanDevRules` hardening**: Now uses `validatePath` from `security.cjs` for confinement, skips symlinks and dotfiles, rejects names containing path separators. Resolves long-standing semgrep CWE-22 warnings on the recursive directory walk
- **`ARTIFACT_SCHEMA` comment honesty**: Rewrote the comment in `state.cjs` to enumerate the schema's intentional scope. Before: claimed only 3 artifacts were excluded. After: explains that ~18 artifacts (JSON/YAML state, persistent cross-phase artifacts, free-form markdown) are excluded by design — only markdown artifacts with `## Status:` lines that drive routing belong here

### Documented
- **`quality-gate-verifier.md` is opt-in**: Clarified in `CLAUDE.md` that this is a per-project template projects wire into their own `.claude/settings.json`, not auto-registered in `hooks.json`
- **`skills-workspace/` purpose**: Added one-line mention that this directory holds autoskill trigger-evaluation fixtures (already gitignored)
- **Enforce-mode roadmap**: Added a `TODO (post-1.0)` comment in `state.cjs` documenting the future `DEVT_VALIDATE_ENFORCE=1` mode that would block on shadow-validation mismatches instead of just warning

## [0.9.0] - 2026-04-27

### Added
- **`<self_check>` on 7 agents**: code-reviewer, architect, verifier, docs-writer, retro, curator, researcher — agents now self-verify outputs before completion
- **`<deviation_rules>` on 7 agents**: standardized escalation when agents detect issues outside their lane. READ-ONLY agents (code-reviewer→NEEDS_WORK, architect→BLOCKED, verifier→FAILED, researcher→NEEDS_CONTEXT, retro→DONE_WITH_CONCERNS) report-don't-fix; SCOPED-WRITE agents (docs-writer, curator) get bounded auto-fix authority
- **Artifact content schema validation**: `state.cjs` extracts and validates `## Status:` lines against per-artifact whitelists. New mismatch reasons: `invalid_status`, `no_status_line`, `unreadable`, `missing`
- **Shadow-mode state validation**: `state update` auto-runs `validateConsistency` and emits stderr warnings on mismatch. `_validation` attached to the JSON response. Disable with `DEVT_VALIDATE_SHADOW=0`
- **Persisted validation flag**: `workflow.yaml` now persists `validation_status="warned"` and `validation_warnings=N` when content-schema mismatches are detected. `next.md` routing surfaces the flag so resume can react to it. Cleared actively when an update has zero mismatches
- **Specify ambiguity score**: `specify` step 5 computes a 5-dimension 0-10 ambiguity score (placeholder scan, internal consistency, scope focus, ambiguity, completeness — 0-2 each). Soft-gate `AskUserQuestion` at <8 lets the user refine or accept-and-proceed before the spec is finalized

## [0.8.2] - 2026-04-25

### Fixed
- **CLAUDE.md docs audit**: Added missing `scratchpad.md` artifact to state flow documentation, added 5 undocumented `update` subcommands (local-version, install-type, dirty, clear-cache, changelog), expanded `update.cjs` module description

## [0.8.1] - 2026-04-24

### Fixed
- **Parameterized SQL in semantic.cjs**: Replaced string-interpolated DELETE with `db.prepare().run()` in compact — consistent with INSERT which already used prepared statements
- **syncState consistency**: Refactored workflow_type inference to scan INPUT_ARTIFACTS into `foundSet` — all artifact checks now go through one mechanism instead of mixing `foundSet.has()` with ad-hoc `existsSync`
- **Silent skip on malformed state args**: `state update` now warns when key=value pairs lack `=` instead of silently skipping

### Added
- **W014 health check**: Validates `next.md` routing table covers every entry in `VALID_WORKFLOW_TYPES` — prevents drift when adding new workflow types
- **PHASE_ARTIFACT_MAP / INPUT_ARTIFACTS documentation**: Comments now explain the design boundary (phase-ordered vs cross-workflow) and document artifact origins

## [0.8.0] - 2026-04-17

### Added
- **`--tdd` flag**: Test-driven development mode for dev workflow — reverses implement/test phase order, auto-injects tdd-patterns skill into programmer and tester agents
- **`--dry-run` flag**: Preview the workflow pipeline (tier, steps, agents, models) without executing any agents
- **Acceptance criteria gate**: STANDARD+ tiers check for spec.md with acceptance criteria before implementation — options to define now, auto-derive, or skip verification
- **Enhanced statusline**: Compact format showing tier, phase, iteration, active flags, and task in `UserPromptSubmit` hook. Idle state shows last workflow context.
- **`state prune` subcommand**: Remove orphaned artifacts from `.devt/state/` using `PHASE_ARTIFACT_MAP`. Supports `--dry-run` for safe preview.
- **Tier-based context limiting**: SIMPLE/STANDARD tiers load only relevant state artifacts into agent prompts, reducing context waste

## [0.7.0] - 2026-04-06

### Added
- **JSONC config support**: `readJsonSafe` now strips `//` and `/* */` comments before parsing — config files can include inline documentation
- **Model alias resolution**: `MODEL_ALIAS_MAP` maps short names (opus/sonnet/haiku) to full Anthropic model IDs. New CLI subcommands: `models resolve`, `models list`, `models table`
- **Strict injection scanning**: Shannon entropy analysis for encoded payloads, URL-encoded (`%XX`) and HTML entity (`&lt;` / `&#xNN;`) decode-and-rescan, zero-width Unicode character detection
- **State sync recovery**: `devt-tools state sync` reconstructs `workflow.yaml` from artifact presence on disk — recovery mechanism for corrupted or missing state
- **Phase control flags**: `--to <phase>`, `--only <phase>`, `--chain` for granular autonomous workflow control. New state keys: `stop_at_phase`, `only_phase`
- **Read-before-edit guard hook**: Advisory `PreToolUse` hook reminds agents to read files before editing (async, non-blocking)
- **Domain probes reference**: Structured probing techniques for uncovering domain unknowns, consumed by specify and clarify workflows
- **Severity-tagged golden rules**: `[CRITICAL]`, `[WARNING]`, `[STYLE]` severity levels on all 11 rules for prioritization under turn pressure
- **Researcher provenance tagging**: Every claim requires `[codebase: file:line]`, `[docs: URL]`, or `[inference]` source tags
- **Verifier later-phase awareness**: Level 5.5 filters gaps explicitly deferred to later phases, annotated as `[DEFERRED]` (informational, does not downgrade verdict)
- **Playwright E2E patterns**: Visual regression, accessibility testing, network inspection, locator strategy, and MCP integration sections in typescript-node and vue-bootstrap templates
- **Prompt injection scan**: URL-encoded injection detection (category 7) and Cyrillic homoglyph/lookalike detection (category 8)
- **References directory**: New `references/` supporting layer documented in CLAUDE.md

### Fixed
- **`PHASE_ARTIFACT_MAP` arch_health mismatch**: `arch_health` was mapped to `arch-review.md` (belongs to `architect` phase) — corrected to `arch-health-scan.md` and added `architect` entry
- **`HTML_NAMED_ENTITIES` per-call allocation**: Hoisted from function body to module-level constant in security.cjs
- **Pre-ES2021 `split().join()` idiom**: Replaced with `replaceAll()` in `decodeHtmlEntities` (project requires Node 22+)
- **`syncState` redundant early check**: Removed `existsSync` guard that contradicted subsequent `ensureStateDir()` call
- **Read-before-edit hook blocking**: Changed from `async: false` to `async: true` — advisory hooks should not block tool execution

## [0.6.0] - 2026-04-06

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
- **Prompt injection defense**: 10→20 patterns covering forget-instructions, act-as, system prompt extraction, `<<SYS>>` markers, exfiltration, tool manipulation. Added strict mode (zero-width Unicode, prompt stuffing) and `sanitizeForDisplay()`
- **Atomics.wait lock**: replaced CPU-spinning busy-wait with `Atomics.wait()` for lock retry — blocks thread without burning cycles
- **Config key warnings**: `getMergedConfig()` warns on unknown keys in `.devt/config.json` (catches typos like `agent_skils`)
- **Questioning guide**: "The Goal" framing, concrete AskUserQuestion examples, option modification tip, expanded freeform rule with wrong/right pairs, decision gate pattern, 2 new anti-patterns
- **Model profiles**: `devt-tools models table [profile]` renders box-drawn agent→model table for diagnostics
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
