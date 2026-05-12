# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/). The `[Unreleased]` section below stages changes for the next version — when bumping, rename it to `## [X.Y.Z] - YYYY-MM-DD` so the release workflow's changelog extractor (`scripts/extract-changelog.sh`) can find it.

## [Unreleased]

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
