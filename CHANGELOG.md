# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/). The `[Unreleased]` section below stages changes for the next version — when bumping, rename it to `## [X.Y.Z] - YYYY-MM-DD` so the release workflow's changelog extractor (`scripts/extract-changelog.sh`) can find it.

Older releases (v0.1.0–v0.162.0) are rotated into `docs/archive/CHANGELOG-historical.md` — the root file keeps `[Unreleased]` plus the most recent releases (rotation ceiling enforced by smoke gate K288).

## [Unreleased]

## [0.195.0] - 2026-07-21

### Lightness pass (batch 3) — close the small gaps: parallel pre-write + empty scope_hint

Two remaining items from the field-run sequence. Drift-guard stack 220 → 221 deep (K94–K313).

### Fixed

- **Parallel scope artifact is now pre-written before delegation (K313, completes the P0 handoff).** `scope_check` runs before `identify_scope` would write `code-review-input.md`, so its parallel branch now pre-writes the scope (from the same `changed-files` union it measured) *before* Read-ing `code-review-parallel.md`. Without this, `partition_lanes` self-recovers (K310) on **every** fresh parallel run and the loud `ABSENT` warning degrades into constant noise; the pre-write makes the common path clean and keeps the self-recovery/warning a genuine-anomaly signal. Parent-side + parallel-side self-recovery = defense in depth for the seam greenfield ranked #1.

### Changed

- **Empty `scope_hint` blocks are suppressed in rendered dispatch envelopes.** An `<scope_hint>[]</scope_hint>` line — the common case in `symbol_anchored` / `pr_scoped_diff` tiers, where `blast_radius`'s caller sets already cover the reading-scope role — is now stripped once, centrally, in `applySubstitutions` (the shared render point for all lane / consolidator / verifier envelopes). Only the empty form is stripped; a populated `scope_hint` is untouched, and the envelope's other tags keep dispatch-hygiene-guard's raw-dispatch recognition intact. (The single-path inline code-reviewer envelope is orchestrator-filled and out of scope; `scope_hint` is a pervasive block across 12+ templates with real consumers — e.g. the debugger — so suppression is deliberately empty-only, not a removal.)

## [0.194.0] - 2026-07-21

### Lightness pass (batch 2) — god-node basename-collision fix (the 85-line bloat)

Tracing the "85-line god-node list" from the field run to its source: `checkLargeFilesGodNodes` and `checkSymbolLevelGodNodes` matched a diff file against graph nodes by **basename only**. In a service-oriented layout — where dozens of files share names (`service.py`, `routes.py`, `models.py`, `dto.py`, `config.py`, `events.py`…) — a diff touching one `service.py` pulled the top god-node from **every** `service.py` across the repo. The result: a review's `## God-node warning` section ballooned to ~85 entries, almost all from files *outside* the diff, riding into every lane's context for zero findings. Drift-guard stack 219 → 220 deep (K94–K312).

### Fixed

- **God-node warnings now match the diff by path suffix, not basename (K312).** Both `checkLargeFilesGodNodes` and `checkSymbolLevelGodNodes` migrate to `_pathSuffixMatch` — a helper written for exactly this ("replaces the prior `path.basename()` match that pulled symbols from EVERY same-named file across the repo") but never wired into these two functions. `app/services/a/service.py` no longer matches `app/services/b/service.py`; the relative/absolute rooting variance basename papered over is handled by segment-boundary suffix matching. The god-node warning now lists only diff-adjacent nodes — the ones a reviewer can act on. Hermetic K312 locks it (two same-basename files in different dirs → only the diffed one reported).

## [0.193.0] - 2026-07-21

### Lightness pass (batch 1) — correctness + token trims from a second greenfield field run

A second parallel-review field run surfaced a real structural bug and several cost-without-conversion mechanisms. This batch ships the confirmed, validated fixes; the design-fresh items (review-weight→offer, an interactive gate profile) are staged separately. Guiding frame: **a heavy pipeline that gets skipped or silently degraded is worse than a lighter one that runs** — weight is an adoption risk, not just a token cost. Drift-guard stack 217 → 219 deep (K94–K311).

### Fixed

- **Parallel `/devt:review` no longer silently degrades to single-dispatch (P0, K310).** On a *fresh* parallel delegation, `scope_check` delegated to `code-review-parallel.md` before `identify_scope` wrote `code-review-input.md` — so `partition_lanes` found the scope artifact absent and silently fell back to single-dispatch. The user asked for a 5-lane review and got 1, with no signal. `partition_lanes` now **self-recovers** the scope from the same `changed-files` union `scope_check` used to trigger parallel, writes the artifact, and proceeds **parallel** — **loudly** (a silent fallback reads as "worked" when it didn't). Only a genuinely empty scope falls back to single-dispatch.
- **`augment-impact-map` truncation banner no longer emits a fabricated denominator or misattributed cap.** `TOPIC_SYMBOLS_RAW_COUNT` was never set by any substep (the `--raw-count` arg was always `unknown`), so the banner invented a denominator; it also credited the truncation to a "blast_radius 32-symbol cap" when 32 is *devt's own* pre-truncation topic cap (applied before `blast_radius` to keep args verbatim), not blast_radius's limit. The CLI now derives the true count from the authoritative source (`preflight-brief.json::topic.symbols`, falling back to kept+dropped) and names the cap correctly. A wrong number in a review artifact is worse than no number.

### Changed

- **claude-mem per-read suppression extended to `Bash` (`CLAUDE_MEM_SKIP_TOOLS`).** Field-confirmed that `Bash` tool calls also triggered claude-mem's per-read observation injection; the recommended skip list now includes it (parent-side). The dominant remaining cost — subagent-read inheritance flooding the parent context in a multi-lane review — is claude-mem-internal (upstream #3274/#3324), not devt-tunable.
- **New seam contract-tests (K310, K311).** K310 locks the parallel scope self-recovery against regression; K311 locks the render-filled correlation_id mint (every rendered dispatch envelope carries a cid). CI-time drift-guards only — no runtime weight.

### Retracted (validated as no-ops before building — no code shipped)

- **Graphify activity telemetry "bug"** — the `mcp-stats --include-chain` `calls:"?"` was a consumer-side jq path error (`.aggregate.total_calls` is nested), not a devt defect. Capture + `--include-chain` union both work.
- **render-filled correlation_id "gap"** — render-filled has minted a cid into every envelope since v0.169.0; the field `raw_dispatch` came from a hand-built consolidator dispatch that didn't paste the rendered output. Usage, not defect (K311 locks the existing behavior).

## [0.192.0] - 2026-07-21

### context_init ceremony-trim — orchestrator prose weight cut ~19% (T2)

The compound `review-context-init` wrapper banked context_init's CLI round-trips (8→1) but left behind two kinds of now-redundant prose that reloaded into the orchestrator's context every review: documentation of decision logic the wrapper already computes, and uncommon-branch handling that noops in the common path. This finishes that refactor — losslessly. `code-review.md`'s `context_init` drops **280 → 232 lines (~19% fewer bytes)** on the common path, with the uncommon-branch detail moved one Read away. Not prose compression (that stays rejected) — content is relocated (the drill-down recovery blocks byte-for-byte; the arch-scan advisory intro lightly reworded for its new conditional gating, no instruction lost) or deleted because an authoritative copy already lives in wrapper code. Drift-guard stack 216 → 217 deep (K94–K309).

### Changed

- **Wrapper-logic documentation deleted from context_init.** The 14-row Graphify tier-decision table and the god-node signal-independence rationale documented logic the `computeGraphifyImpactPlan` / `augment-impact-map` wrappers already run — the orchestrator only reads the computed `$CTX.impact_plan.tier` / signal outputs, never the tables. A second copy of truth that lived in code, removed with a pointer to the source function. Verbose staleness-tree branches, WHY-narration, and self-justifying meta-sentences trimmed to their load-bearing core; every gate string, always-run bash block, and `AskUserQuestion` wording preserved.
- **Uncommon-branch detail lazy-loaded by reference (K309).** The arch-scan freshness advisory and the anomalous-drill-down recovery handling (empty / god-node-oversize / below-substance-threshold) moved into a new `workflows/code-review.context-detail.md`, read only when the substep's precondition fires — the common review path (fresh graph, no arch scanner, normal drill-downs) never loads them. Modeled on the shared-steps partition (K275); the new K309 gate enforces the pointer↔anchor bijection + the common-path guard contract so the partition can't silently drift.
- **Arch-scan advisory is now conditional (one intentional behavior delta).** The freshness probe runs only when an `arch-scan-report.md` exists — checking BOTH candidate paths `assert-arch-scan-fresh` itself probes (`.devt/state/arch-scan-report.md` and, in multi-instance mode, `.devt/state/$DEVT_WORKFLOW_ID/arch-scan-report.md`). Projects with no arch scanner wired (the common case) no longer emit the `[ARCH-SCAN-MISSING]` advisory line — and skip its CLI round-trip — on every review. Advisory-only and non-gating, so no functional review behavior changes; the K63 CLI contract is untouched.
- **KEEP-IN-SYNC note reworded to a semantics contract.** The reciprocal `code-review.md ↔ dev-workflow.md` context_init sync note now governs the substep *semantics* (same wrapper, same cached signals), not prose layout — the two paths may diverge in presentation while the compound-wrapper contract stays shared.

### Fixed (pre-release adversarial review)

- **`pr_scoped_diff` tier now has an executable branch in substep 6.** The non-GitHub PR path (`state.cjs` emits `tier="pr_scoped_diff"`, executed identically to `symbol_anchored` — `blast_radius` over diff symbols) previously had no `if tier == …` branch in the review workflow; the deleted tier-decision table was its only mention. Substep 6's `symbol_anchored` branch and the drill-down follow-up now both cover `pr_scoped_diff` — closing a latent gap the table had masked, and making the workflow more correct than the pre-refactor documentation.
- **Substance-threshold recovery is discoverable at the point of failure.** Substep 7's `assert-graphify-decision` gate-failure prose now cross-references `code-review.context-detail.md → ## drill-down-recovery` for the `drill-down section below substance threshold` reason, so the orchestrator re-anchors thin sections on `args.symbols` and re-runs the gate instead of stopping. (The other two recovery cases — empty, oversize — are observable at substep 6.)
- **K309 disjointness strengthened.** The partition gate now checks one body-only sentinel per relocated passage (a partial re-inline that duplicates content while leaving the pointer is now caught, not just a 2-token spot-check), and requires each pointer to name the detail file, not just a valid anchor.

## [0.191.0] - 2026-07-20

### First-field-run calibration fixes (greenfield T1 receipt)

devt's first real field run — a greenfield cross-service review — produced a first-hand calibration. Every reported issue was validated against the code before acting, which mattered: the report's headline *"memory_signal came back empty"* was a **misread of its own run**. The cached `memory_signal_json` shows `files_checked:42, count:2` — the affects-union fired correctly on FLOW-001 + ADR-002. No memory bug existed; the fixes below are the validated remainder. Drift-guard stack 215 → 216 deep (K94–K308).

### Fixed

- **Lane size-band discounts generated / lockfile / append-only files (K308).** A lane whose diff is mostly generated churn — a changelog archive, a `*.lock` bump — no longer trips a spurious "split the lane": `size_class` is driven by the *reviewable* diff (`est_loc`), the full count is preserved as `diff_lines_raw`, and the file stays in the lane's coverage. Generic denylist (`*.lock`, `CHANGELOG*.md`, `*-ARCHIVE.md`, `*.min.js/css`, `*.map`/`*.snap`), extendable via `review.size_exclude_globs`. Field: a lane sized at ~29,900 diff-LOC that was 96% append-only changelog archive nearly triggered a needless split.
- **`/devt:review` flag-parse tokenizes `--focus=`** instead of interpolating the whole argument blob into the routing table. A prose task description that merely mentions `--focus` no longer risks misrouting — the command matches a standalone `--focus=<value>` token and passes the remaining scope text verbatim.

### Changed

- **Graphify drill-down runs inline before its gate.** The top-3 `get_neighbors` follow-up is now explicitly executed in the same pass as `blast_radius`, before the graphify-decision gate — removing the chicken-and-egg block where an orchestrator hit the gate first, then had to hand-produce the drill-down sections.
- **Weekly-report instrument honesty (two caveats).** (1) The affects-coverage section warns, when the window has **0 commits**, that it counts *committed* history only — so staged/uncommitted work reads 0% and must not be read as "the memory layer governs nothing" (this exact artifact caused a field LLM to misdiagnose a working affects-union as empty). (2) The injection-cost line is retitled **"devt Memory Injection Cost"** and caveats that it measures devt's `workflow-context-injector` only — not co-installed plugins' Read-hook injections (e.g. claude-mem's per-read observation blocks, field-measured far larger).

### Deferred (validated, same receipt)

- context_init ceremony trim → a future step-manifest cal (the field substep-value breakdown is the input); claude-mem's per-read injection volume → upstream (not devt-tunable); lane-cap-of-5 → kept (field: no measurable degradation).

## [0.190.0] - 2026-07-20

### Memory injection-cost projection + queue hygiene (options-v2 review, north-star-filtered)

A second-pass memory-layer review (options v2) was validated filesystem-first. It proposed mostly TRIM + measurement; the aligned subset shipped, and its two flagship "cheap projections" were **disproven on the filesystem** and deferred to their true home (DEF-006). Drift-guard stack 214 → 215 deep (K94–K307).

### Added

- **Memory injection-cost line in the weekly report (OPT-α).** Prices the memory/context-injection surface — what `memory_signal` + governing lines + advisories cost per workflow — by projecting `workflow-context-injector` `stdout_bytes` from the universal `run-hook.jsonl` trace (the same source `hook-cost` reads; no new collector). It reads **~0 in raw-dispatch/maintainer sessions** (the injector emits nothing without an active workflow) and reflects real cost only in workflow-running projects; the section renders only when injection actually happened in-window. In-code kill-receipt: delete the line if it changes no decision across ~3 report windows. Pinned by **K307**.

### Changed (queue hygiene — no code)

- **DEF-005/006 triggers de-proxied (TRIM-2).** Replaced the `corpus > 30 docs` numeric trigger with a value-shaped one (a field receipt, or the curator flagging dead-weight governance). For a solo-maintainer plugin, doc-count is a proxy that games as easily as it gates.
- **OPT-α(% cited) / OPT-β(lane-attribution) recorded as DEF-006, not a cheap projection.** Their "projection over existing data" premise was disproven: PREFLIGHT scratchpad lines are ephemeral (truncated per workflow) and are pre-flight-guard file-coverage records, not doc-citations; and the sidecar `governing[]` carries no lane-of-origin tag. Capturing + aggregating citations *is* the deferred DEF-006 build — noted so it isn't double-built. Only OPT-α's *bytes-injected* half was a genuine projection (shipped above).

### Notes

- The review's FLOW trim (TRIM-3) was **already satisfied** — `docs/MEMORY.md` already documents FLOW as a consumer-facing doc type with an expected-empty `flows/`. No change.

## [0.189.0] - 2026-07-20

### Memory-layer hardening — enforce trust-tier, frontmatter hygiene, retract (validated external findings)

An independent memory-layer review surfaced two confirmed code defects plus several enhancement options. Each was validated filesystem-first and filtered through the project's north stars (TRIM > ADD, delegate over reimplement, value over mechanism): the aligned subset shipped; four mechanism-heavy options (FTS keyword indexing, a changelog→candidate extractor, an A/B eval harness, a `PreCompact` hook) were deliberately declined as ADD-before-value. Drift-guard stack 211 → 214 deep (K94–K306).

### Fixed

- **`enforce:` bypassed the shared-root trust tier.** A shared-root governing doc — whose content never passes the local curator gate — could block the verify loop through an `enforce:` rule even with `memory.shared_roots_coerce: false`, the exact coercive authority the tier (DEF-009 M2) was built to withhold. `runEnforce` now tags each violation `severity: blocking|advisory`: a shared-root violation is **advisory** (surfaced, non-blocking) unless the project grants coercion; local-doc violations always block. Top-level `pass` is false iff a blocking violation exists, and the verifier routes on it — mirroring the pre-flight guard's tier exactly. A wrong block from an unreviewed shared root would be destructive, so coercion stays an explicit grant. Pinned by **K304**.

### Added

- **`memory validate` warns on unrecognized frontmatter keys.** An authored-but-inert field (the retired `decay_days`, a stray `keywords`) previously failed silently. A known-key allowlist now emits an `unknown-key` **warning** — never an error, so an experimental field never hard-blocks validate-clean — applying LES-001's "gate the class on the second recurrence". Its first run caught three inert `keywords:` fields (CON-001/002/003), now trimmed.  Pinned by **K305**.
- **`memory retract <id> [--reason=…]`** — the "never valid" sibling to `supersede`'s "changed, here's the successor". Flips a doc to `status: rejected` (dropping it from the active governing union), stamps `retracted_at` + optional `retracted_reason`, requires no successor, and keeps the file on disk (archive-never-delete). Idempotent; validates the mutated frontmatter before writing. Pinned by **K306**.

### Changed

- **Guard Telemetry caveat.** The weekly report now notes — only when `:: ungoverned` recoveries are actually present — that the ungoverned bucket is trustworthy only for denies logged after the guard began matching absolute paths, so a long-window read doesn't mistake path-mismatches for real coverage gaps.
- **docs/MEMORY.md** — documents the enforce blocking/advisory tier, corrects the stale "`require` matches per line" description (whole-content since the K303 hardening), adds an **enforce-vs-K-gate** boundary note (which mechanism a rule belongs in; enforce coverage is a direction, not a target), and the unknown-key validate warning.

## [0.188.0] - 2026-07-20

### Enforce / affects-coverage hardening (xhigh code-review findings)

A workflow-backed xhigh review of the coverage + enforce work (v0.184.0–v0.186.0) surfaced eight verified correctness findings — including two regressions the earlier F5/simplify changes introduced. All fixed and pinned by the new gate **K303** plus extended coverage in K301/K302. Drift-guard stack 210 → 211 deep (K94–K303).

### Fixed

- **`require` enforcement regressed to per-line matching** (F5 side effect) — a `require` regex spanning lines (`Copyright[\s\S]*Licensed`) or using `^`/`$` anchors was mis-evaluated per line, producing false conformance violations. Reverted to whole-content matching; the ReDoS bound is now a file-size skip for `require` (per-line cap stays for `forbid`).
- **`aggregateAffectsCoverage` reported `available:true` on error** — `withDb` *returns* `{error}` (it doesn't throw) when the memory index is absent, so the simplify refactor's try/catch never fired. The result shape is now validated, so a missing index yields `available:false`.
- **Git-sourced file universes weren't robustly based** (devt runs in arbitrary consuming repos): `git ls-files` now defaults its working dir to the project root (a subdirectory invocation no longer yields subdir-relative paths that match nothing), uses `-z` (non-ASCII names aren't `core.quotePath`-escaped), and a 256MB buffer (large monorepos no longer silently overflow the 1MB default into an empty universe). `parseGitLog` gains `--no-renames` (rename `{a => b}` arrows no longer drop renamed files from coverage), `--relative`, and the same buffer. Absolute-or-relative `--files` are canonicalized against the cwd, and paths are normalized to forward slashes (Windows).
- **Empty `forbid` matched everything** — `runEnforce` now skips empty/whitespace patterns (validate already rejects them; this hardens the runner if one is indexed anyway).
- **The `enforce-ignored` warning missed the status axis** — a `candidate`/`superseded` governing doc with `enforce:` is silently skipped by `runEnforce`; `memory validate` now warns on non-active status, not just non-governing doc-type.

### Changed (cleanup)

- **One `io.cjs::listTrackedFiles(cwd, {nul})`** replaces the duplicated `git ls-files` boilerplate in `memory.trackedFiles` and `evolution.listTrackedFiles` (256MB buffer + `[]`-on-error in one place; `nul` selects `-z` vs quotePath-consistent output per caller). `state.cjs`'s assert-wired copy intentionally stays — it must distinguish "git unavailable" from "no files"; the `--others` (untracked-listing) variants are a different operation.

## [0.187.0] - 2026-07-20

### Template currency refresh — go + typescript-node (T4)

Refreshed the `go` and `typescript-node` project-rules templates to current-stable practices, validated against live releases (July 2026). A filesystem-first check found `rust` (edition 2024, next is 2027) and `vue-bootstrap` (Vue 3.5, **Vite 8**, Pinia 3) already current — so those were left as-is apart from a one-line Pinia note, rather than churned. Content-only; K70 (9-file baseline) unaffected.

- **go** — floor raised to Go 1.24+ (was 1.22+; current stable 1.26). Added: the `tool` directive in `go.mod` (retires the `tools.go` blank-import workaround), `go fix` modernizers, `os.Root` (traversal-safe FS), generic type aliases, `encoding/json/v2`, container-aware `GOMAXPROCS`, `sync.WaitGroup.Go`, and a `testing/synctest` section for deterministic concurrency tests (the top source of CI flakes).
- **typescript-node** — TypeScript 7 (the native Go-based `tsc`, ~10× faster, same type system) and Node.js 24 LTS. The big shift: **native type-stripping** — `node app.ts` runs with no build step — documented with its two load-bearing caveats (it does *not* type-check, so `tsc --noEmit` stays the CI gate; only erasable syntax runs, so avoid `enum`/parameter-properties/`namespace`). `node --test` now runs `.ts` directly.
- **vue-bootstrap** — one-line note that Pinia 4 (ESM-only) is current; Vue 3.5 / Vite 8 were already accurate.

## [0.186.0] - 2026-07-20

### Hardening + cleanup for the coverage + enforce features (v0.184.0/v0.185.0)

A validation pass over the two new memory-layer features found five edge cases, and a follow-up simplify pass removed the duplication they were built on. All behavior-preserving where it counts; the drift-guard suite stays 1049/0 at K94–K302.

### Fixed

- **Affects-coverage density could exceed 100%** — `matched` was not scoped to the tracked universe, so a file changed in the window but since deleted (or changed on another branch via `git log --all`) inflated the numerator past `claimed`. `matched` now counts only changed files that are still tracked, restoring `matched ≤ claimed` (F1, pinned by K301's deleted-file case).
- **`memory enforce` silently no-op'd on absolute `--files`** — a raw absolute path matched no repo-relative glob (the same trap that once disarmed the pre-flight guard). Paths are now canonicalized (`realpath` both sides, resilient to a symlinked root) before matching (F2, K302).
- **Enforce violations were unattributed by root** — each violation now carries `shared_root` (null for local, the root label for shared-root docs), so a reviewer can see when a doc governing without the local curator gate is the source of a finding (F3, DEF-009 M4 parity, K302).
- **Enforce on a non-governing doc-type was silently ignored** — a REJ/lesson carrying `enforce:` now warns at `memory validate` (`enforce-ignored`) instead of quietly never running (F4, K302).
- **Enforce regexes were unbounded** — a catastrophic-backtracking pattern could stall the verify loop. Regexes now apply per line and skip pathologically long (minified/generated) lines, removing the ReDoS surface without affecting real source (F5, K302).

### Changed (internal cleanup)

- **One `trackedFiles()` helper** replaces three copies of the `git ls-files` idiom (`runEnforce`, `computeAffectsCoverage` fallback, coverage CLI, weekly report).
- **One `toRepoRelative()` helper** for the absolute→repo-relative canonicalization; **one `activeAffectsRows()`** query shared by `getByPath` + `computeAffectsCoverage` so the governing-doc definition can't drift; **one module-level `parseCsvFlag()`** for the `--files`/`--changed`/`--universe` CLI args.
- **The weekly report no longer runs a second `git log`** — `parseGitLog` collects the window's changed-file set in its existing walk (via an out-param) instead of re-walking it for affects-coverage.
- `runEnforce` reads + splits each in-scope file once per run (cache) instead of once per matching rule.

## [0.185.0] - 2026-07-20

### Enforce assertions — declarative ADR conformance (DEF-004 pilot)

A ratified decision ("the API layer must not import infrastructure directly") only holds if something checks it. DEF-004's filed trigger — "a field receipt of an ADR the review missed" — is self-defeating: it only fires once a miss is already noticed. This pilot escapes that by shipping the mechanism so it generates its own evidence. A governing ADR/CON/FLOW doc can now carry an `enforce:` block, and the verifier runs it on the touched files during the normal loop; a violation is a blocking finding routed through the existing grader/revision cycle.

**The assertion is a regex, never a shell command — a deliberate safety call.** DEF-009 (v0.180.0–v0.182.0) established that shared-root docs govern *without* passing the local curator gate; an `enforce:` shell field would be arbitrary code execution from any such doc. So the contract is purely declarative — a `forbid`/`require` regex over a file glob — with zero code-execution surface.

```yaml
# on an ADR/CON/FLOW (a LIST — the frontmatter parser makes a valueless key a list,
# so a nested map silently empties; validate errors on that):
enforce:
  - files: "src/api/**"
    forbid: "import .*infrastructure"   # or: require: "<regex>"
    message: "api layer must not import infrastructure directly"
```

### Added

- **`memory.runEnforce(files)`** + **`memory enforce [--files=a,b]`** CLI — runs every active decision/concept/flow doc's `enforce:` rules against a file set (`--files` = the verifier's touched set; default = `git ls-files`). `forbid` → one violation per matching line; `require` → one per in-scope file missing the pattern. Results are DATA (`pass:false` + `violations[]`); exit stays 0 so a pipefail-guarded caller never dies. Broken regexes are skipped (caught earlier at validate).
- **`validateFrontmatter` validates `enforce:`** — must be a non-empty list of `{files, forbid|require (valid regex), message}` objects; a nested map (which parses as empty) errors with a fix hint.
- **`agents/verifier.md`** gains a `run_verification` step: run `memory enforce --files=<changed>`, treat each violation as a blocking, deterministic finding.
- **CON-003** gains a live `enforce` binding (`scripts/smoke-test.sh` must retain a `set +e` pipefail guard) — the pilot's first real-code assertion, green on the current tree.
- Gate **K302** — behavioral: forbid flags the matching line, require flags the missing-pattern file, clean files pass, touched-file scoping works, malformed nested-map enforce errors at validate. Drift-guard stack 209 → 210 deep (K94–K302). `docs/MEMORY.md` documents the contract.

## [0.184.0] - 2026-07-20

### Affects-coverage density (DEF-007 part 2)

Part 1 (v0.176.0) warned when an active governing doc had no `affects_paths` at all — invisible to the affects-union memory_signal. Part 2 instruments the opposite failure: a doc whose glob is so broad it claims files it never really governs, so it fires on the affects-union for nearly any change while adding no precision (mechanism-firing ≠ value). Before: nothing distinguished a tight exact-path doc from a `**` doc that matches half the tree — both just "govern" whatever changed. After: the weekly report's new **## Affects Coverage (trend)** section gives each governing doc a density — of the N tracked files its own globs CLAIM, how many M were changed in the window — sorted most-diluted-first. A `guardrails/**`+`skills/**` tombstone claiming 26 files reads visibly diluted next to an exact-path doc at 100%.

Deliberately a **direction, not a target**: the denominator is scoped to each doc's own claim (a raw changed-files fraction would reward broad globs that govern nothing), a single window can't distinguish "diluted" from "quiet," and the mean-over-claiming-docs line is there to compare across reports — never a score to maximize, since narrowing a glob to nothing would "improve" it while governing less.

### Added

- **`memory.computeAffectsCoverage(changedFiles, fileUniverse)`** + the pure, DB-free **`memory.globReach(patterns, files)`** core (reuses the same `matchesGlob` engine `getByPath` uses, so a coverage count is exactly the file set the affects-union would match). Per governing doc in `getByPath`'s universe (active/candidate, ≥1 affects pattern, all types): `claimed` = universe ∩ globs, `matched` = changed ∩ globs, `density` = M/N (null when the globs match nothing tracked — a distinct "dead governance" pathology). Rows sort density-ascending, broadest-claim-first within a tier.
- **`memory coverage`** CLI — `--changed`/`--universe` accept comma lists (with `--universe` omitted the denominator is `git ls-files`); exposes the metric for ad-hoc inspection and hermetic testing.
- **Weekly report `## Affects Coverage (trend)` section** — `report generate` now aggregates the window's changed-file set (a new `git log --name-only` collector) against tracked files and renders per-doc density with the trend-not-target caveat and a mean-coverage line. New `affects_coverage` key in the `generate` JSON result.
- Gate **K301** — behavioral on a hermetic fixture (exact-path doc → 100%, broad `**` doc → diluted 1/3, dead glob → null, most-diluted-first ordering, mean over claiming docs). Drift-guard stack 208 → 209 deep (K94–K301).

## [0.183.0] - 2026-07-20

### Session-end curation surface (DEF-008)

Curation triggers were exclusively workflow-finalize-bound (`skills/memory-curation` "When to Run It"), so sessions that never complete a workflow — raw-dispatch maintainer work, exactly where devt's densest decision-making happens — accumulated candidates in `_suggestions.md` that nobody ever saw. Before: the Stop hook harvested candidates silently and said nothing. After: when candidates cross the surface threshold and the cooldown allows, the Stop hook's `stopReason` carries `💭 N memory candidates pending … — run /devt:memory promote to triage`, at most once per cooldown window.

### Added

- **`memory candidates-footer --hint-only`** — Stop-hook mode: emits ONLY the 💭 hint when `count >= threshold && cooldown ok` (touching the cooldown stamp), silent otherwise. The finalize-footer contract's always-on status line is deliberately dropped in this mode — that contract exists for once-per-workflow call sites where silence is indistinguishable from never-executing; Stop fires per turn, invocation is already recorded by the hook trace, and an always-on line there would be noise. Default (flag-less) behavior byte-identical.
- **`hooks/stop.sh` appends the curation hint to `stopReason`** in both exit paths (incomplete-workflow warning and clean exit), right after the existing unconditional candidate harvest — the write side and the surface side of session-end curation now live in the same hook.
- `skills/memory-curation` gains the session-end trigger line (the weak form, shipping alongside the wiring that makes it fire).
- Gate **K300** — behavioral: hint-only silent below threshold, hint+stamp at threshold, cooldown suppresses the rerun, default footer line intact, and stop.sh end-to-end emits the hint exactly once per window. Drift-guard stack 207 → 208 deep (K94–K300).
- `docs/HOOKS.md` gains a "Session-End Curation Surface" section; `docs/MEMORY.md` CLI reference documents the mode.

## [0.182.0] - 2026-07-19

### Shared-root trust tier + REJ attribution (DEF-009 M2+M4 — sequence complete)

The last legs of the multi-root provenance work. Before: a shared-root doc coerced under block-mode pre-flight with the same authority as a locally-curated one, and a shared-root REJ tombstone vetoed proposals with no indication of which root said NO. After: shared roots always govern and advise, but coercive denial over edits is an explicit config grant — and every REJ suppression names its root. With provenance markers, the index delta, the trust model doc, and now the tier, the full mitigation sequence for the curator-gate bypass is in place.

### Added

- **Config `memory.shared_roots_coerce`** (default `false`) — when false, an edit governed *solely* by shared-root docs logs a `PREFLIGHT … :: shared-advisory <ids>` scratchpad line and proceeds; the docs still ride the Brief and scope hints, only the block-mode deny is withheld. Any local governing doc in the match set keeps the full deny path. Provenance-unresolvable rows count as local (fail-coercive — preserves prior behavior). Opt-in restores the old always-coerce semantics.
- **REJ suppression is root-attributed** — Brief tombstone lines gain `_(shared:<label>)_` for shared-root REJs (local lines unchanged), the recommendations line renders `REJ-NNN (shared:<label>)`, and `listRejectedKeywords` carries `source_root`.
- Gate **K299** — behavioral fixture across the matrix: shared-only governance → advisory allow with scratchpad line; local governance on an **absolute** path → deny; `shared_roots_coerce: true` → deny restored; Brief REJ attribution on shared, absent on local. Drift-guard stack 206 → 207 deep (K94–K299).

### Fixed

- **`pre-flight-guard.sh` never matched governance on absolute paths** — `getByPath` received the raw `tool_input.file_path` (usually absolute) while `affects_paths` globs are repo-relative, so every absolutely-pathed edit auto-logged `:: ungoverned` and bypassed the guard whenever the plugin root was resolvable. Discovered while wiring the trust tier into that exact block; the guard now relativizes against the canonical project root (both sides already realpath'd for the descendant check) before matching. The deny path for governed files works for both path forms — pinned by K299.

### Changed

- `docs/MEMORY.md` — config-table row for `shared_roots_coerce`; trust-model section rewritten to the completed state (tiered coercion, attributed suppression; the inherent residual — shared content never passes the local curator gate — is the documented trust decision).

## [0.181.0] - 2026-07-19

### Shared-root change delta on `memory index` (DEF-009 M3)

Shared-root re-governance was structurally silent: an external edit in a shared memory root (git pull, maintainer commit) re-governs every consuming project at its next `memory index` — and the auto-index hook that usually triggers that index printed nothing on success. Before: the only trace of a shared-root change was diffing the root by hand. After: every multi-root index reports exactly which shared-root docs were added/changed/removed since the previous index, on three surfaces.

### Added

- **`shared_delta` in the `memory index` result** — `{baseline, added, changed, removed}` with entries `{id, root: <label>}` (labels via the provenance helper). The baseline manifest (`{id: {root, hash}}` over post-precedence *winners* — a shared doc shadowed by a local one doesn't govern and isn't tracked) persists in the index DB's `meta` table, which the rebuild transaction never clears (the same mechanism that preserves `last_built_at`); deleting the regenerable DB honestly resets the baseline. First-ever run reports `baseline: "unavailable"` with empty arrays instead of enumerating every shared doc as added. Local-doc churn is excluded by design. Single-root projects: key omitted entirely, zero new surface.
- **`health` gains `MEM_SHARED_DELTA`** (info severity) — reads the persisted last delta and reports `+a ~c -r` with doc ids. Self-clearing: the next multi-root index with no shared changes writes an empty delta, and a multi→single config flip deletes the row.
- **`memory-auto-index` hook emits a compact line when the delta is non-empty** — the one silent re-governance path now surfaces `[memory-auto-index] shared-root memory changed: +a ~c -r (ids) …` on the hook's stdout. Fires only when multi-root AND shared docs changed (near-never), honoring the hook-messaging byte budget; silent-on-success behavior is otherwise unchanged.
- **`memory.cjs::getLastSharedDelta()`** export (health's reader) and a `content_hash` (sha256) computed per doc at scan time to drive change detection.
- Gate **K298** — behavioral two-root fixture walking the full lifecycle: first-run unavailable+empty, no-change empty, shared modify → `changed`, shared remove → `removed` with local churn excluded, health fires, single-root flip omits the key and clears health. Drift-guard stack 205 → 206 deep (K94–K298).

### Fixed

- **`memory-auto-index.sh` backtick command-substitution noise** — a JS comment inside the double-quoted `node -e` block contained a backticked phrase, which bash command-substituted on every hook fire (`memory: command not found` on stderr, empty string spliced into the comment). Harmless to behavior but a latent landmine of the known no-backticks-in-double-quoted-`node -e` class; the backticks are now plain quotes.

### Changed

- `docs/MEMORY.md` — new "Shared-root change delta" subsection under Multi-Root Memory; trust-model section updated (re-governance is now surfaced-not-blocked; remaining DEF-009 gap narrowed to the trust tier and REJ-suppression attribution).

## [0.180.0] - 2026-07-19

### Shared-root provenance at the governance surface (DEF-009 M1)

The keystone code half of DEF-009. `source_root` was tracked at index time (last-wins precedence needs it) and shown in `memory list`/`get`, but `getDocsMeta` — the governing-union enrichment chokepoint — selected only `id, doc_type, status, confidence`, so a shared-root doc entered the Brief, the sidecar `governing[]`, and block-mode scope hints looking exactly as authoritative as a locally-curated one. Before: `_(active·verified, lane B)_` for shared and local alike. After: shared-root docs carry a provenance marker; local docs render byte-identical, so single-root projects (the common case) see zero new noise.

### Added

- **Brief governing lines mark shared-root docs** — `_(active·verified·shared:<label>, lane B)_`. The label is the shared root's basename, parent-qualified only when two configured shared roots collide on basename (no config alias surface — that would front-run the planned `{path, trust}` entry form).
- **Sidecar `governing[]` entries gain `shared_root`** — `"<label>"` for shared-root docs, `null` for local. Additive: consumers projecting `[.governing[].id]` are unaffected (verified — no workflow reads any other `governing[]` field).
- **`memory.cjs::sourceRootInfo(sourceRoot)`** — classifies a doc's root as local vs shared and derives the display label. Null/absent `source_root` (rows indexed before the column existed, single-root deployments) is treated as local; a recorded root no longer in config still renders as shared with its basename.
- Gate **K297** — two-root behavioral fixture: shared Brief line carries the `·shared:<label>` marker, local line renders unchanged with no marker, sidecar `shared_root` is the label on the shared doc and null on the local doc. Drift-guard stack 204 → 205 deep (K94–K297).

### Changed

- `getDocsMeta` (`bin/modules/memory.cjs`) SELECT includes `source_root`; the preflight enrichment join threads it into the governing union.
- `docs/MEMORY.md` — sidecar shape documents the new field; the trust-model section's limitation paragraph now reads provenance-legible, with the remaining gap narrowed to block-mode tiering (trust tier) and the shared-root index delta, both still tracked as `DEF-009`.

## [0.179.0] - 2026-07-19

### Memory trust-model documentation (DEF-009 M5)

A memory-layer security review (validated filesystem-first) observed that devt's curator-gate control — untrusted candidates in `_suggestions.md`, mediated promotion into `.devt/memory/` via 5-filter review + `AskUserQuestion` — is bypassed on exactly one path: multi-root **shared roots** are read-only from devt, edited directly by their maintainers, and re-govern consuming projects silently on the next `memory-auto-index`, so their docs never pass the gate. A shared-root ADR governs (and, under block-mode pre-flight, coerces) with the same authority as a locally-curated one; provenance (`source_root`) is tracked but not rendered at the governance surface. This is an architectural gap with cheap mitigations, not a live vulnerability — multi-root is opt-in and shared roots are normally org-controlled repos behind PR review.

### Changed (docs only)

- **`docs/MEMORY.md` gains a "Trust model — memory is a persistent write channel" section**: memory acts on future dispatches (governs, coerces via block-mode, suppresses via REJ keywords), the curator gate is the control, multi-root shared roots are the documented bypass, and adding a shared root grants it commit-blocking authority — trust it accordingly. Names the current limitation (provenance not yet at the governance surface) and points at `DEF-009` for the code mitigations (surface `source_root` in the Brief; optional trust tier so shared roots advise without coercing). Shipped as the depth-safe half of DEF-009; M1/M2 (the memory-signal-path code) stay fresh-session.

## [0.178.0] - 2026-07-19

### Ghost-surface class gate for module references (OPT-2, .cjs scope)

The `learning-entry.yaml` retirement (v0.177.0) was the third instance of the same ghost class — a `*.cjs` module referenced inside a schema or agent that no longer exists on disk. K280/K281 gate documented CLI commands and `printUsage` but never module references buried in `schemas/`/`agents/` prose, which is exactly where `semantic.cjs` survived twice. Per LES-001's own rule (second post-sweep recurrence → gate the class), this was overdue.

### Added

- Gate **K296** — every `*.cjs` module token referenced in `agents/**.{md,yaml}` and `schemas/**.{yaml}` must resolve on disk. Scoped deliberately to the `.cjs`-module class: measured empirically to produce **zero false positives** on the current tree (only `devt-tools`/`memory`/`state.cjs` are referenced, all resolve), and verified to catch an injected ghost. The artifact-path half of the original proposal (`.devt/**`, `docs/**`) is **intentionally excluded** — those are runtime-created and example-prone and would false-positive; the recurring ghost was always a module reference. Drift-guard stack 203 → 204 deep (K94–K296).

## [0.177.0] - 2026-07-19

### Retired a contradictory ghost schema in the lesson pipeline (OPT-1)

A memory-layer review (validated filesystem-first) found `schemas/learning-entry.yaml` was a stale spec that both `agents/retro.md` (context step 8) and `agents/curator.md` (context step 7) were instructed to load as authoritative — while it contradicted the contract both agents actually implement. Most seriously it typed `confidence` as `float 0.0-1.0` against the memory layer's five-value enum, which `validateFrontmatter` treats as a hard **error**; it also referenced the deleted `semantic.cjs` twice and targeted a `.devt/learning-playbook.md` that does not exist. Verified zero other consumers on the current tree — no gate, no doc. This was the third instance of the `semantic.cjs` ghost class (K280/K281 gate CLI routing + printUsage but not module/artifact paths inside `schemas/`/`agents/`).

### Removed

- **`schemas/learning-entry.yaml` deleted.** `retro.md` step 8 and `curator.md` step 7 now point at the real, existing contract — `templates/memory/LES-template.md` (enum confidence, `affects_paths`, `links`) — and retro's own `structure` step remains the lessons.yaml hand-off definition. The agents already emitted the correct enum shape; the loaded schema was inert and contradictory, so retiring it removes a documentation-rot landmine without changing any working behavior.
- DEF-005's decay leg re-anchored off the deleted schema (its `decay_days` field is now noted as design-fresh, since the schema was its only prior spec).

### Notes

- Gate **K295** pins the removal (schema stays deleted, no agent re-references it, both repoint at the LES template). Drift-guard stack 202 → 203 deep (K94–K295).
- The **broad** ghost-class gate (module/artifact paths referenced inside `schemas/**`/`agents/**` must resolve) is OPT-2 — deliberately deferred to a fresh session for the false-positive-scoping care a new class scan needs. The report's own sequencing (delete before the broad gate) is honored: this ships the deletion first.

## [0.176.0] - 2026-07-19

### Affects-coverage: the first instrument for the primary memory signal (DEF-007 part 1)

A second external memory-layer review (validated filesystem-first) surfaced that since prose-FTS was demoted to a supplement and the affects-union became the primary review-time `memory_signal`, a governing doc with no `affects_paths` is structurally invisible to that signal — and nothing measured or flagged it. `affects_paths` is optional and `memory validate` only walked it when present, so a doc with none was silently absent from governance. This ships the small, unambiguous half of the fix.

### Added

- **`memory validate` warns on active `decision`/`concept`/`flow` docs with no `affects_paths`.** Scoped to lineage-bearing types exactly like the orphaned-retirement check — REJ tombstones, lessons, and superseded docs are exempt. It is a **warning** (never touches the `errors` count the validate-clean gates key on), with a message that names why: the doc can't reach the affects-union signal until it declares the paths it governs. Gate K294 (behavioral: warn on active-no-paths, exempt REJ, clear when a path is added). Drift-guard stack 201 → 202 deep (K94–K294).

### Deferred (DEF-007 part 2)

- The coverage **trend** number (what fraction of a governing doc's claimed domain actually gets affects hits) remains open — it needs a denominator scoped to governed domains and a trend-not-target framing (a raw fraction rewards broad globs that govern nothing). Captured in the backlog for a fresh session.

## [0.175.0] - 2026-07-19

### The range release — receipt #22's headline gap closed (cal #56b)

The first native-context field run reviewed a merged PR and watched four subsystems starve simultaneously on an empty `base...HEAD` union, while topic anchoring shipped docstring fragments to the graph. This release makes commit-range review first-class end-to-end and puts identifier-shape hygiene at the anchor chokepoints. Verified end-to-end on a git fixture in K293: `--range` persists through `review-context-init` into `workflow.yaml` and the memory_signal affects union counts exactly the range's files.

### Added

- **`--range=<a>..<b>` first-class commit-range scope.** Range mode in the file-collection choke point (`collectChangedFiles`: exactly the named range, no working-tree/untracked contamination) and threaded everywhere scope is consumed: `state changed-files --range`; `review-weight assess --range`; **`state review-context-init --range` persists the range into `workflow.yaml` before any child CLI runs**, so the memory_signal affects union (the single cached value all three dispatch generations consume), diff-symbol extraction, manifest freshness, and preflight's topic anchoring all read one consistent scope; `graphify augment-impact-map --range`; `code-review.md` scope_check (file count + diff-LOC banding vs the range) and substep-7; the auto-partitioner wires each lane's `base_ref` from the range start (generalizing the per-lane plumbing the field run proved by hand); `/devt:review --range=…` documented at the command surface.
- **Verbatim-OR-attested ARGS contract**: overriding known-bad generated args is sanctioned WHEN fully attested inside `graphify-impact-plan.json` (`args_overridden` + original/override args + reason/evidence/by/timestamp — a post-hoc auditor reconstructs what the generator produced, what was sent, and why); `assert-graphify-decision` fails a declared override with incomplete attestation. Undeclared overrides remain violations.

### Fixed

- **Topic anchors are identifier-shape gated.** The graph label space includes docstring pseudo-nodes; harvesting legs leaked ~80-char prose fragments and filenames into `topic.symbols`, where the args contract then forced wasted MCP calls on them. `isIdentifierShaped` now gates the symbol filter AND final assembly (every leg, including FTS rescue): whitespace, >64 chars, and file-extension-shaped entries rejected; dotted identifiers and `call()` forms kept. All three field fragments die in the K293 truth table.
- **Commit-SHA shrapnel never becomes topic vocabulary**: hex-shaped tokens (the tokenizer split a SHA and `b9344` became a keyword that FTS-matched an unrelated service into suggested_reading) are excluded from keywords — the relevance floor at the query source. (A per-entry FTS score floor on suggested_reading remains open — the tokenizer + shape gates cut the junk-query side that produced the field's off-domain entry.)
- **review-weight empty-diff is a scope failure, not a safety verdict**: "scope unresolvable" naming `--range` as the likely fix (was: "HEAVY recommended — nothing to prove safe" on zero evidence), with a distinct workflow echo; plus the **recently-reviewed caveat** (advisory-only, never auto-light) sourced from the claude-mem harvest artifact.
- Gate **K293** pins the release (range persist + affects-union + changed-files end-to-end on a two-commit git fixture; topic hygiene behavioral truth table; scope-unresolvable verdict; attestation + workflow wiring pins). Drift-guard stack 200 → 201 deep (K94–K293).

## [0.174.0] - 2026-07-19

### The trust batch — receipt #22's confirmed small bugs and contract fixes (cal #56, first of two)

Receipt #22 (the first NATIVE-context run: a greenfield session reviewing a merged PR end-to-end, followed by a 14-question clarification round answered with on-disk verification) split its findings into a headline input-shape gap (`--range`, next release) and this batch: small, source-verified defects that silently degraded marquee features, plus contract fixes the run's own workarounds designed. Every fix is behaviorally gated in K292.

### Fixed

- **`<rubric_path>` now renders ABSOLUTE.** It was plugin-root-relative in every envelope; all five native-run lanes resolved it against the project cwd, concluded the rubric didn't exist, and self-graded ad hoc — the lane-score distribution (a parallel-report headline) came back all-null with nothing noticing. Templates carry `{plugin_root}/references/rubrics/…` (fills identically from render substitution and orchestrator LLM-fill via `$CTX.init.plugin_root`); no relative value form remains anywhere.
- **envelope_health no longer green-lights an unresolvable rubric.** A by-reference rubric stub classified as "populated" while pointing at a path no lane could resolve — health now stats the `rubric_path` target when the content is a stub; unresolvable = degraded.
- **Sidecar schema checks with teeth**: `verification.json` requires `criteria_total` (the walk-all-axes gate's documented basis) unless `source="short_circuit"`; `review.json` with null `lane_scores[].score` requires `lane_scores_null_reason`. Surfaced as `schema_warnings` from `read-sidecar` — routing consumers decide severity. The synthesis template now also mandates the `status` routing field the field run omitted.
- **Sidecar consistency wording**: the shadow checker told a JSON sidecar it "has no `## Status` line" (markdown language on a field check, re-warning every state update) — sidecar mismatches now say what's actually missing.
- **Lane telemetry honesty**: `register-lanes` results carry `file_count` (displayed 0-shaped for every lane before); `est_loc` counts true +/− change lines instead of raw diff-artifact lines (~25% field-measured inflation vs a real diffstat).
- **`memory candidates-footer` is never silent**: an always-on `[memory] candidates-footer: N pending / threshold M / cooldown ok|blocked` line — below-threshold was indistinguishable from the command never executing.
- **Arch-scan advisory carries its on-ramp**: the missing-baseline reason names the exact command that creates one (the configured `arch_scanner.command` when present) instead of recommending a scan nothing ever seeds.

### Changed

- **Consolidator provenance is CLI-stamped, not agent-remembered.** `render-filled` appends a dispatch-intent stamp (cid + ts → `dispatch-stamps.jsonl`, state-contract registered, reset-soft evicted); `assert-consolidator-dispatched` passes on stamp + the same cid embedded in review.md's now-mandatory `Correlation:` header + artifact-mtime > stamp — proving "review.md came from a dispatched synthesis agent" while still catching hand-written reviews and died-before-artifact. The side-file marker (which the field consolidator forgot until nudged, despite perfect artifacts) remains a legacy fallback.
- **`state assert-all --phase=X`**: every gate registered for the phase in one JSON verdict — per-gate `{ok, reason, elapsed_ms, detail}` with evidence passthrough, `gates_run` vs registry count, and a NONZERO EXIT CODE on any failure. Kills the silent-empty pipeline class (field: a shell quirk rendered never-executed gates as blank output visually identical to passes). Sourced from the same registry `advance-phase` consults; inline blocks remain canonical for per-gate remediation.
- **Pointer dispatch is a contract, not a convention**: stubs carry a full-envelope `sha256` (rules_hash covers rules only); `render-lanes --out` prints the stubs as a tail-safe stderr trailer (the field operator's `tail -3` ate the stub field and they hand-reinvented pointer dispatch); `dispatch_lanes` prose presents the stub as the sanctioned first-class dispatch form.
- **Per-lane `base_ref` documented as the sanctioned non-default-base mechanism** (merged PRs, commit ranges) — it carried the entire field run and was load-bearing but underdocumented.
- Gate **K292** pins the batch behaviorally (absolute rubric render + zero relative residue, stub sha256, render-stamp → provenance-gate round trip, both schema checks, assert-all exit code, footer line). Drift-guard stack 199 → 200 deep (K94–K292).

### Deliberately deferred (named owners)

- `--range=<a>..<b>` first-class scope threading + empty-diff verdict + topic-anchor validation + attested args override → next release (the range work; threading spec captured from the field run).
- Step-manifest architecture (~15–20K orchestrator tokens of process prose per review), RESET_EXEMPT ledger-growth audit, graphify PreToolUse hook scoping + NL-query upstream relay, `run-lanes` discoverability → parked in the receipt ledger with owners.

## [0.173.0] - 2026-07-18

### First field receipt of the by-reference stack (cal #55)

The same evening v0.172.0 shipped, a full cross-project parallel review ran against a real consumer project — 3 community lanes + consolidator + verifier, APPROVED with VERIFIED 8/8 axes after one revision round. The by-reference layer held (97 KB of rules kept out of the payload; all three lanes honored the Context-Loaded contract; the verifier caught a from-memory citation), and the run surfaced five defects/gaps — all fixed here, each behaviorally gated. Two receipt items closed as not-bugs during diagnosis: the post-reset survival of dispatch-warnings records is documented RESET_EXEMPT forensics behavior, and the lane-echo field-count zero was the operator's own display artifact.

### Fixed

- **`state check-agent-output` resolved bare artifact names against the project ROOT, not the state dir** — every documented `check-agent-output review.md` call reported the artifact missing (`looks_like_stub: true`), which turns the verify step's substance pre-gate into a false BLOCK on any run that follows the prose verbatim. Relative names now try the project root first (preserving `.devt/state/x` callers) and fall back to the state dir. Caught live when the substance pre-gate flagged a 15 KB consolidated review as a stub.
- **By-reference delivery now bypasses the 96 KB inline byte-cap.** The cap exists to protect dispatch size, but it ran before mode resolution — oversized rules files were excluded from `content` entirely, so in by-ref mode they never even became stubs and agents were never told they exist (field: 5 of a consumer project's 16 rules files invisible to reviewers; `stubbed_bytes_saved` 97,044 → 170,133 after the fix). `loadGoverningRules` gains an `inlineByteCap` option threaded from both delivery pipelines; inline mode keeps the cap; `rules_hash` semantics unchanged (it always covered all candidates).
- **The Axis-H claims gate now reads the LAST `## Dispatch warnings (session-scoped)` section.** Its documented divergence remedy — append a corrected section from a live read — was unsatisfiable against a first-match parser; edit-in-place worked but erased the pass-1 audit trail. Appending under the same exact heading now supersedes while preserving history.
- **Axis-H writer contract is window-scoped.** The ledger is RESET_EXEMPT (prior-session records persist by design), the gate counts only inside [workflow start, review.md mtime], but the writer instruction said "live read" with no window — a synthesis that honestly counted a prior day's record diverged systematically. The reviewer/rubric/steps contracts now state the window (`ts >= first_created_at`) and name the mechanical path (`dispatch warnings --since=<first_created_at>`).

### Changed

- **`assert-dispatch-warnings-acknowledged` is registered on both review workflow types' `complete` transitions** in the phase-gate registry — `advance-phase` now enforces it mechanically. Field-observed slip: an orchestrator ran the gate and `advance-phase complete` in one compound command without routing on the gate result, completing a workflow with the gate red; a registered gate makes that ordering error impossible.
- **Warm SendMessage-resume adopted for delta-shaped revision rounds** (previously receipt-gated; the receipt landed): when every `revisions[]` entry is a point-fix and the writer agent is still resumable, the shared verify step's RETRY operator prefers resuming it with the revisions verbatim — field-measured a two-anchor fix at 4 tool calls warm vs 10 cold, and the paired verifier re-grade at 4 vs 22. Cold re-dispatch stays the automatic fallback (post-compaction, and fresh-eyes for structural revisions). RETIREMENT-WATCH row flipped to ADOPTED; the platform persistent-subagent row remains a watch item.
- **DISPATCH-RECIPES Recipe 7 — cross-project orchestration**: the field-proven shape for reviewing a sibling project from the current session (cwd-pinned CLI, root-pin dispatch preamble, harness-injected CLAUDE.md caveat, cwd-resolved graphify CLI in place of session-bound MCP, hook-ledger location).
- Gate **K291** pins the batch with behavioral checks (bare-name resolution from a fixture, byte-cap bypass vs inline-kept via a 99 KB fixture rule, last-section Axis-H pass on a two-section review.md, registry + prose greps). Drift-guard stack 198 → 199 deep (K94–K291).

## [0.172.0] - 2026-07-18

### By-reference delivery completed on the canonical dispatch paths (cal #54)

A third-pass external verification of the two fresh batches, plus a one-line user probe ("what about code-review.md?"), surfaced two defects in the just-shipped by-reference layer: a placeholder leak on missing rules files, and a coverage gap — the by-reference default lived only in the CLI render pipeline, while the canonical dev / quick-implement / single-review dispatches fill their envelopes LLM-side from the init compound payload with full rule bodies. Both external sweeps had tested the CLI path only; the mechanism fired, the value didn't convert on the paths that run most. This release closes both, plus the two validated small items from the same verification.

### Fixed

- **Suite runs no longer leave a phantom active workflow.** Several gates exercise the CLI against the repo's own state dir; the last seeder's workflow ("K4 hook envelope test") persisted after every run as a live active-workflow nag — and a mid-task suite run would stomp the operator's real state. The suite now snapshots `workflow.yaml` at start and restores (or removes) it in the EXIT trap.
- **Placeholder leak on missing rules files.** `loadGoverningRules` maps only files that exist; the substitution replacer returned the literal `{governing_rules.content["…"]}` on a missing key; the by-reference stub loop iterates existing keys only — so any template-referenced rules file absent on disk (un-scaffolded projects, partial rule sets, absent CLAUDE.md) shipped literal template syntax into the dispatch in BOTH modes. The rubric loop had been deliberately fixed for this exact leak class; the rules side never mirrored it. Fixed at the replacer, covering every template and both modes at once: missing keys resolve to the `(no <path> available — file not present in this project)` fallback-notice grammar `classifyBlockBody` already treats as "empty". Reproduced on a bare fixture before fixing.

### Changed

- **The init compound payloads now deliver rule bodies per `dispatch.rules_mode`.** By-reference default: each `.devt/rules/*.md` value in `$CTX.init.governing_rules.content` arrives as the same read-from-disk stub `render-filled` emits — single-sourced as `RULES_BY_REFERENCE_STUB` in init.cjs, consumed by both pipelines — with `delivery_mode` surfaced and `stubbed_bytes_saved` counted, never silent. The canonical LLM-fill dispatch paths (38 compiled-envelope placeholder sites across the dev-workflow/quick-implement/code-review spines and tier files) previously rode full bodies twice: once into orchestrator context via the payload, again into every dispatched subagent. Now the corpus stays out of both; config `dispatch.rules_mode: inline` restores full bodies end-to-end.
- **Context-Loaded contract single-sourced into the envelope templates.** Previously injected at render time — by-reference CLI renders only, so the LLM-filled canonical paths never carried it. Now a static `<context_loaded_contract>` with structurally-conditional wording (stubs mean read-and-record in `## Context Loaded`; inline content means neither) rides after `</governing_rules>` in all 14 governing-rules-carrying templates and their compiled workflow regions; the render-time injection is deleted. Both delivery modes carry the same contract — the sub-tags themselves signal the mode.
- **Spine fill-prose is delivery-mode aware.** The three fill instructions say: fill placeholders VERBATIM from content (stubs are the payload, not something to expand), and fill `(no <path> available — file not present in this project)` for any key absent from content — the LLM-fill twin of the replacer fix, byte-identical grammar so one gate pins both.
- RETIREMENT-WATCH gains the gate-retirement leg: **gates retire with their subject** — a smoke gate whose guarded surface is deleted goes out in the same commit; trimming a gate whose surface still exists is a strip-audit call, not housekeeping.
- Specify and clarify close their interviews with a **blind-spot round** — given the user's stated expertise level and what the codebase revealed, what unknown-unknowns has the interview not touched; one final AskUserQuestion or an explicit "none surfaced" — and the questioning guide carries the principle. Unknown-reduction up front is cheaper than enforcement mid-flight.
- Gates: **K223 + K289** updated to the template-static contract semantics (contract rides in both modes; K289's mode distinction is now behavioral via a fixture rule body — stubbed by default, inlined under `--inline-rules`); new **K290** pins the batch (leak-fix behavioral in both modes on a bare fixture, init payload stubbing + inline escape behavioral, spine fill-prose ×3, template contract census, single-sourced stub, gate-retirement leg, blind-spot round). Drift-guard stack 197 → 198 deep (K94–K290).

### Validated, deliberately not shipped (for the record)

- Boilerplate single-sourcing (the turn-limit block duplicated across 10 agents): duplication is real and near-byte-identical, but each copy loads only in its own agent's spawn context — relocating the prose saves ~zero tokens. Drift is the only cost; if it ever bites, an identity gate is the cheaper answer than restructuring the agent/envelope boundary.
- Smoke-suite split/tiering: 17.5K lines, but the full suite completes in ~1m39s of CI wall time — a maintainability question today, not a cost one.
- Rubric few-shot graded examples stay sequenced behind the by-reference field receipt.

## [0.171.0] - 2026-07-18

### The token-cut behavioral batch (cal #53)

Companion release to the platform-alignment batch: the four behavioral items from the same two-sweep validation, each reusing machinery that already existed rather than building new. The single biggest lever — by-reference dispatch — was promoted exactly as dispatch.cjs's own comment prescribed ("promote to config after field evidence accumulates"); the field evidence was the 5-lane −71% render receipt with zero verifier-flagged quality gaps.

### Changed

- **By-reference is now the default delivery mode for ALL rendered dispatches, not just lanes.** `dispatch render-filled` swaps every `governing_rules` body and the inline rubric for read-from-disk stubs (config `dispatch.rules_mode` / `dispatch.rubric_mode`; `--inline-rules` restores full inlining for worktree-isolated dispatches, `--rules-by-reference` / `--rubric-by-reference` force-enable). Resolution lives inside `cmdRenderFilled` so every render path — CLI, render-lanes base, hygiene-guard canonical envelope — agrees; render-lanes now passes explicit values both ways so project config can never override the lane worktree opt-out. The Context-Loaded contract auto-injects (agents record what they actually Read; the verifier checks reads cover cited rules), `rules_hash` keeps drift detection, and CLAUDE.md stays dropped (harness auto-injects it). Expected: ~35–45 KB (~9–11 K tokens) saved per full dispatch on the default path, multiplied across every dispatch and revision round.
- **Six consumer agents gained stub-awareness.** The context_loading prose in programmer, code-reviewer, verifier, architect, researcher, and tester previously said "treat inline sub-tag contents as authoritative and SKIP the on-disk Read" — against a by-reference stub, a literal reading would treat the stub text as the rules. Each now recognizes `(by-reference: …)` as an instruction to Read the named file from disk, not as content.
- **Single-path review now measures diff mass.** scope_check computes diff LOC over the same union basis identify_scope uses (merge-base + working tree + untracked) and bands it with the lane registry's field-calibrated thresholds into `.devt/state/review-depth.txt` (reset-soft evicted — a stale `chunked` marker would bolt the large-diff strategy onto a small follow-up review). The cost/value preview and the parallel-decision question now carry changed-line counts alongside file/domain counts, and `chunked` diffs (≥3000 lines) get the same hunk-enumeration read strategy lane envelopes auto-attach at that size. The below-threshold verifier-skip idea from the source report was deliberately NOT added — the existing self-certification short-circuit (status=DONE + empty self_flagged_uncertainties) already skips the verifier on a better signal than diff size.
- **Deny→recovery funnel is now visible.** pre-flight-guard's covered-allow path appends a `deny-outcome` record when the edit resolves a same-file deny from this session, classed `recovered-governed` (PREFLIGHT line cites governing IDs) vs `recovered-ungoverned` (`:: ungoverned`) — each deny resolved at most once, best-effort, never blocking. `report generate` gains a **Guard Telemetry** section: denies by source/rule, both recovery classes, the unrecovered remainder, and an explicit signal line when recoveries are mostly ungoverned (tune the guard vs grow affects coverage — the two levers a single aggregate would conflate).
- **Fix iterations are delta-shaped.** The programmer envelope's review_feedback contract (dev + quick_implement, template source + compiled workflow regions) now states it explicitly: work from the feedback entries and the files they cite; no redoing reuse analysis, no re-reading scan/plan/research artifacts a prior iteration consumed, no rewriting untouched impl-summary sections. Combined with by-reference rules, a revision round no longer re-pays the first dispatch's context bill.
- Gate **K289** pins the batch, including two behavioral checks (fixture render with/without `--inline-rules`; guard-telemetry aggregation over a fixture funnel) and the compile-sync proof that the delta-fix contract reached both compiled workflow regions. Drift-guard stack 196 → 197 deep (K94–K289).

## [0.170.0] - 2026-07-18

### Platform-alignment batch from the 39-page external sweep (cal #52)

Two independent sweeps of the same sources (27 claudefa.st guides, 9 claude.com posts, 3 anthropic.com engineering articles — one in-session, one external report validated filesystem-first against the repo) converged on a small, first-party-validated batch: align devt with the platform's autonomous-operation grammar, sharpen prompt surfaces field receipts already exercise, and institutionalize the strip-audit discipline. Everything heavier stays receipt-gated with named triggers.

### Added

- **Narrow auto-mode allow rules in the settings scaffold.** Auto mode drops broad allow rules at entry (bare `Bash`, wildcarded interpreters like `Bash(node:*)`), so every devt CLI call routes through the permission classifier. `setup` now scaffolds two machine-resolved literal rules — `Bash(node "<plugin-root>/bin/devt-tools.cjs" *)` in quoted and unquoted form — into fresh `.claude/settings.json`; narrow literal rules carry over into auto mode. Rule shape verified against the platform permission docs (literal text matching; `${CLAUDE_PLUGIN_ROOT}` is never substituted inside settings files, so the path resolves at scaffold time). Approve-once recipe for existing projects documented in CLI-REFERENCE (Auto-mode permissions).
- **Recover-don't-halt deny grammar on bash-guard.** Every deny now appends the platform's on-deny contract at the single emit point: deny is a redirect, not a stop — continue the task via a safer path; do not retry the exact command; do not work around the guard. The jsonl deny record keeps the raw rule reason for telemetry classification. (pre-flight-guard's message already conformed — it names the exact recovery action — and stays inside its smoke-gated byte budget.)
- **`docs/RETIREMENT-WATCH.md`** — standing register merging the native-convergence freeze-zone table (Agent Teams, observer agents, auto-mode pipeline, `/usage`, artifacts, worktree isolation, persistent-subagent resume, Managed Agents primitives — each row with an explicit trigger to act) with the strip-candidate ledger (a `compensates:` annotation per scaffold) and the per-model-generation strip-audit checklist. Receipt-gated adoption items (headless-Ask audit, enforced active verification, warm revision resume) carry their named unlock triggers.
- **Plans lead with decisions.** create-plan Step 4 + the implementation-plan template gain `## Key Decisions (most-likely-to-change first)` ahead of the task list — data model changes, new interfaces/contracts, anything user-facing first — so early review attention lands where wrongness is most expensive. The plan-presentation summary surfaces the same list.
- **Recipe 6 in DISPATCH-RECIPES**: side audit in a separate detached headless session (`claude --bg`), paired with the concurrent-session discriminator discipline.

### Changed

- **read-before-edit-guard demoted to the `full` profile** — first strip-audit retirement. The runtime natively errors on Edit-without-Read (the hook's own message said so), making the per-Edit reminder (~40 tokens/fire) redundant at `standard`. Kept at `full` for environments without the native check.
- Questioning guide's decision-tree walk gains the architecture tiebreak: when two candidate questions compete for the next slot, ask the one whose answer would change the architecture first — a late answer there invalidates the most downstream work.
- Programmer deviation Rules 1-3 now default to the most conservative valid fix (log under Deviations, keep going), folded into the shared-process line so the agent stays exactly at its 500-line cap.
- Verifier self-check bans silent downgrades — an issue identified during verification may only be dismissed WITH the evidence that justified the downgrade (the known evaluator failure mode: identify, then talk yourself out of it) — and `run_verification` now declares the functional surface: which project-declared runnable surfaces were executed and which were not, one-line reason per skip; legibility only, no forced execution. The dev.v1 rubric carries both bars.
- **CHANGELOG rotated**: the root file keeps `[Unreleased]` plus the ten most recent releases (709 KB → 32 KB); 152 older sections moved into `docs/archive/CHANGELOG-historical.md` (now spanning v0.1.0–v0.162.0). Every consumer verified rotation-safe: CI checks only the current version's section, the release extractor reads recent sections, and `update changelog`'s between-parse degrades gracefully when old sections are absent.
- Gate **K288** pins the batch (guard demotion, deny-grammar behavioral check from a bare temp dir, narrow-allow scaffold, retirement-watch register, prompt-surface lines, rotation ceiling). Drift-guard stack 195 → 196 deep (K94–K288).

### Validated, deliberately not shipped (for the record)

- The external report's guardrails-compression proposal is a direct REJ-001 hit (twice-rejected static-compress / hedge-removal) — rejected again; no new evidence offered.
- The 20-total-denies escalation leg died in verification: the stuck-detector already fires at ≥3 TOTAL denies per workflow session — stricter than the platform's 3-consecutive/20-total grammar on both axes — so the leg would be unreachable dead code.

## [0.169.0] - 2026-07-17

### Sixth field receipt: make the compliant path legible

A six-lane pointer-dispatch run confirmed the orchestration layer earning its cost (gates caught real drift including the grader's own stale self-report; diff-first lanes held every Opus lane in budget; the cost preview's 6–8× banded estimate landed on actuals) and located the rough edges precisely: every "failure" was the deterministic layer correctly refusing to distinguish *substantively compliant but illegible* from *non-compliant*. The reporter's transcript-grade answers locked each design — including falsifying one proposed mechanism outright. Theme of every fix: make compliance legible rather than enforcement softer.

- **Pointer dispatch is first-class.** The field pattern (dispatch prompts that say "Read your envelope at …" — ~50K output tokens saved on one run, envelopes never entering orchestrator context) is now the rendered path: `render-filled` mints the `<correlation_id>` tag it previously lacked (the run's one real failure — a compliant consolidator dispatch flagged as raw), gains `--out[=path]` (bare form → canonical `.devt/state/dispatch/`), and prints a ~200-byte paste-ready stub (cid + envelope path + read-and-execute contract) instead of the body; `render-lanes --out` emits the same stub per lane. Deliberately NOT guard path-matching — a path string is spoofable; the guard keeps passing on cid content with zero matcher changes.
- **Scoped warning resolution.** The hygiene hook stamps a `warning_id` on every raw-dispatch record; new `dispatch warnings resolve <id> --reason="…" [--evidence="…"]` appends a resolution ANNOTATION (the record persists — auditable like `update-lane override_reason`; reason mandatory, double-resolve rejected, no blanket clear-by-type: a legitimate warning landing between `list` and a bulk clear would be silently absolved). `assert-no-raw-dispatches` passes when every in-scope record is resolved-with-reason — replacing the field's actual remedy, `--skip-gates` across two whole transitions whose other gates had all passed.
- **Axis-H is a live read + a mechanical claims check.** The consolidator honestly synthesized five lanes' "no incidents" sections — all true at lane-write time, all stale by construction, since warnings are written AT dispatch (including the consolidator's own). Snapshot injection was proposed and **falsified by the reporter's timeline** (envelope rendered 13:19, its own warning born 13:30): no dispatch-time snapshot can contain the warning the dispatch itself generates. Shipped instead: the rubric + synthesis contract now require Axis-H to be a live read of `dispatch-warnings.jsonl` at synthesis time (an explicit exception to consolidate-don't-re-review), with a machine-readable `counts:` first line — and new gate `state assert-dispatch-warnings-acknowledged` compares the claimed counts against the file, bounded to [workflow start, review.md mtime] so post-write warnings are never blamed on the author. Runs last; needs no model honesty.
- **auto_curator reaches the parallel path.** The step body moved into `code-review.steps.md` (both modes) — the parallel path previously had NO writer for the artifact the shared present_findings gate demands, forcing a hand-run of the single-path bash.
- **memory_signal is diff-anchored with honest empty rendering.** Review signals now derive PRIMARY from the union of `memory affects` hits across the changed files (field: prose FTS returned `counts: {}` — reading as "no governance applies" — while per-file affects carried ADR/FLOW governance for the same diff; reporter's 5-run observation: prose-FTS never uniquely converted). Prose FTS demotes to a merge-in `supplement`, omitted when empty; an empty PRIMARY renders the checkable claim `"no affects-matched docs across N changed files"`; a literal `{}` is reserved for memory-layer-unavailable. Dev/research workflows deliberately keep the prose-anchored signal — pre-implementation work has no diff.
- **Small surfaces**: `read-sidecar` hoists `status`/`verdict`/`agent` to the top level (`jq '.status'` previously returned null while gates read the file fine) and validation failures now carry the allowed values; the review staleness prose caught up with the real auto-reset criteria (both legs, 1h) + a note on the mid-run `workflow_type` rotation; `scope-cache` suppresses generic scope_hint entries (wiki index, bare directory wildcards) when concrete blast-derived paths exist — they were "pure noise next to the blast-radius map" and now appear only when they're the best available signal.
- Gates **K282–K287** (resolution loop, pointer stubs, Axis-H count matrix incl. fairness bound, auto_curator partition, diff-anchored signal + consumer docs, small surfaces). Drift-guard stack 189 → 195 deep (K94–K287).

## [0.168.1] - 2026-07-16

### Verification-pass hardening: ghost surfaces, the lean sidecar, and the fork-free write path

Independent verification of v0.168.0 confirmed all eight shipped claims; the follow-up rounds it triggered grew well past the two one-line residuals it opened with — a third ghost surface gated, a 12-site doc-drift class swept and scanned, the sidecar contract cut to a single field, a real fork bug in the curator's write path fixed behaviorally, and the deferred queue's size triggers given a watcher:

- **`memory supersede` added to the top-level `printUsage`** — it was routed, module-usage-listed, and CLAUDE.md-documented, but absent from the third surface: the CLI's own help text. **K281** extends the ghost-surface class gate there (curated list, so the invariant runs one direction: everything advertised must route; supersede must stay advertised). Drift-guard stack 188 → 189 deep (K94–K281).
- **REJ template aligned with the documented convention** — it scaffolded `status: rejected` with a comment claiming that value was mandatory, contradicting docs/MEMORY.md's `status: active` living-tombstone convention. Template now scaffolds `active` and the comment states the real contract: retrieval keys on `doc_type`, either status behaves identically, no migration.
- **Deferred size-triggers get a watcher.** DEF items parked behind "corpus >N docs" had no evaluator — receipt triggers arrive by their nature, but a size trigger would fire silently, noticed only if someone happened to run `deferred list` and happened to check the count. `health` now parses the unlock condition from each open item's own context and emits `DEF_TRIGGER_FIRED: DEF-001 (corpus 34 > 30)` when met — items declare their triggers, the watcher stays generic.
- **Failed-gate names travel with the suite's Result line.** A red run captured via `| tail -N` counted failures without naming them (this session's own unreproduced flake was unidentifiable for exactly that reason); the summary now lists failed gates so a transient red is investigable instead of noise.
- **`upsertDoc` no longer forks retitled docs.** The write path recomputed the target filename from the current title on every call — updating an existing hand-named or retitled doc via MCP `memory_upsert_doc` (the curator's preferred route) would silently create `<ID>-<new-slug>.md` alongside the original, the same trap `supersede()` guards against. An existing id now keeps its current file; only new ids get the canonical slug name. The rebuild-failure rollback learned the same distinction — it deletes only files the call created, never a pre-existing doc it just updated. K277 gains the no-fork behavioral check.
- **`governing_ids` removed — `governing[]` is the single sidecar interface.** v0.168.0 shipped the lifecycle array alongside the bare-id array "so jq consumers keep working"; a consumer inventory found zero such consumers outside the suite's own gates — the parallel field was hedging against an audience that didn't exist. One field now, `[{id, status, confidence}]`; bare ids project via `[.governing[].id]`. K276 additionally asserts the legacy field stays gone.
- **Lane-count drift swept AND gated** — the Brief has been 8 lanes (A–H) since lanes G/H shipped, but "6 lanes"/"Lanes A-F" survived at 12 sites across README, CLAUDE.md, docs (COMMANDS/INTERNALS/the preflight workflow's step list), commands, three workflows, both CLI usage surfaces, the MCP tool description, and preflight.cjs's own docblock (whose lane enumeration also gained G/H + the lifecycle-gate note). Three successive manual sweeps each missed some — so K279 now carries a narrow class scan ("anes A-F" + the Topic-Brief-specific 6-lane phrasings; variable-lane-count prose like a 5-lane render example can't false-positive, and the "5-lane" File Pre-Flight mentions are a different mechanism, correct as written).

## [0.168.0] - 2026-07-16

### Memory lifecycle made live: retired knowledge can no longer masquerade as governing

An external deep-audit of the memory layer (validated finding-by-finding against the code before any change) confirmed one correctness hole and a cluster of coherence gaps: the lifecycle vocabulary (`status`, `confidence`, `supersedes`) was fully implemented on the write side and almost entirely ignored on the read side.

- **Governing-lane lifecycle gate (the correctness fix).** Lanes B (FTS) and G (project-context FTS) read raw `documents_fts` rows and lane D resolves link targets by bare id — none carried a status predicate, unlike lanes A/C which filter to active/candidate in SQL. A superseded doc that FTS-matched the task, or that any doc still linked to, re-entered the governing union and flowed into `governing_ids` → `<scope_hint>` dispatches looking exactly as authoritative as an active ADR — and the curator is explicitly instructed to retire docs via `status: superseded`, so the leak was one archival away on every project. The union now passes through a single eligibility chokepoint (batch metadata join against `documents`): status must be active|candidate, and REJ tombstones are excluded from the governing framing unconditionally — lane E is their surface, "pre-rejected", never "governing". Superseded docs stay visible in the Memory Graph triples section as lineage and in explicit `memory query` results — excluded from governance, not erased.
- **Lifecycle is now visible at the consumption surface.** Brief governing lines render `_(status·confidence, lane X)_` — a `candidate·speculative` doc no longer reads identically to an `active·verified` one. The sidecar gains a parallel `governing: [{id, status, confidence}]` array (`governing_ids` unchanged — existing jq consumers keep working). Lane G docs also gain honest lane attribution (previously fell through to lane D).
- **`memory supersede <old-id> <new-id> [--reason=…]`** — retirement was a manual, two-sided, unverified ritual across two files: forget the status flip and the retired doc stays in every lane forever; forget the link and lineage is untraceable. The new command does both sides atomically (status flip + `superseded_at`/`superseded_by` stamps on the old doc, `supersedes` link on the successor), validates mutated frontmatter before touching disk, writes to each doc's existing path, and reindexes once.
- **`memory validate` learns supersession consistency**: `supersession-contradiction` (error) when a supersedes link's target is still active/candidate, `orphaned-retirement` (warning) when a superseded ADR/CON/FLOW has no incoming supersedes link — scoped to lineage-bearing types because curator archival legitimately retires lessons without successors.
- **`preflight.domain_hints` config** — lane A's domain extraction relied on a hardcoded English keyword list with no extension point, violating the every-heuristic-ships-a-config-override guardrail; project vocabulary now appends to the built-in floor.
- **Ghost `semantic` CLI surface deleted.** CLAUDE.md documented `semantic sync|query|compact|status` months after the module it pointed at was removed; the orphaned repo-root `memory/` tree (a second, dead learning-entry schema + an unreferenced FTS schema for that deleted module) is gone with it. The live schema remains `schemas/learning-entry.yaml`.
- **REJ status convention documented**: tombstones carry `status: active` (the rejection is a living rule; retrieval keys on `doc_type`, so existing `status: rejected` tombstones behave identically). Doc drift fixed: lanes are A–H, and `governing_ids` is the lifecycle-filtered union of A–D ∪ G.
- Gates: **K276** (behavioral: superseded + REJ FTS-matches stay out of `governing_ids`, lifecycle rendered, explicit query unaffected), **K277** (supersede round-trip atomic, validate clean after), **K278** (one-sided link errors, orphaned retirement warns), **K279** (mechanism drift pins), **K280** (documented-CLI routing coverage — every `devt-tools.cjs <cmd>` in CLAUDE.md must have a live routing case; the gate that would have caught the `semantic` ghost the day it appeared). Drift-guard stack 183 → 188 deep (K94–K280).

Deferred with triggers (mechanism-firing ≠ value-conversion; live corpora are currently 4–7 docs): confidence-weighted lane ranking (matters only when the FTS limit truncates), confidence lifecycle transitions (proposals-only if ever built — auto-promotion would breach the curator gate), usage-ledger aggregation of PREFLIGHT citations, `enforce:` frontmatter compilation, drift-risk reporting, LES decay, `memory history` lineage walk, alias frontmatter.

## [0.167.0] - 2026-07-16

### Review verify + present_findings single-sourced (the KEEP-IN-SYNC banners were lying)

The receipt ranked the ~1,670-line two-file review workflow's copy-paste duplication as its #5 fix. Validation before implementation found something worse than duplication: **the sync had already failed silently**. The parallel path was missing four gates the single path gained over time — the verifier short-circuit, the walk-all-axes coverage override, the Layer-2 claim-check resolution gate, and the raw-dispatch finalize gate (two of which are the load-bearing blocks of the three-layer dispatch defense). A parallel review could finalize without the enforcement the single path guarantees, while both files displayed banners claiming they were identical.

- **New `workflows/code-review.steps.md`** — single source for the `verify` and `present_findings` step bodies, loaded by both parents at `SHARED-STEP` pointers via the dev-workflow tier-partition mechanism (mandatory Read + pipeline-position markers + mode branches: unmarked blocks run in both modes, `SINGLE-DISPATCH ONLY` / `PARALLEL ONLY` blocks in one). The verifier dispatch envelope — which had stayed byte-identical in both copies — now exists once.
- **Parallel path gains the four lost gates**: axes-coverage override, claim-check resolution, raw-dispatch finalize enforcement (all unconditional now), and the finalize migrates to `advance-phase`. The short-circuit gate stays deliberately single-only — a consolidator's self-flags summarize other agents' work, and short-circuiting synthesis on second-hand self-certification is unvalidated (receipt-gated, reason documented in the block).
- **Deliberate divergences are now explicit** instead of hidden in drift: consolidator-dispatched gate (parallel), short-circuit (single), RETRY re-dispatch target, report format (single keeps its 0–100; parallel headlines verdict + counts + lane distribution per the score-model fix).
- Net: 1,690 → 1,527 lines across the three files, ~440 formerly-drifting lines single-sourced, stale KEEP-IN-SYNC banners replaced with the real contract.
- Nine smoke gates repointed at the new single source (verifier-dispatch pair, allow-list, graphify-surface, F28a, I7a, M15, K43, K222, K274) + **K275** (partition integrity: bodies present once with all four recovered gates, parents carry pointers + mandatory-Read, resident copies banned) + **O5 fixture de-flaked** (anchor stamped before the fresh touch — the anchor-after-touch order raced the second boundary under suite load, same class as the N8 flake). Drift-guard stack 182 → 183 deep (K94–K275).

## [0.166.0] - 2026-07-16

### Fifth field receipt: signals that carry their own guard rails

A six-lane parallel run (receipt-validated against its on-disk artifacts) confirmed cal #48's machinery converting — zero raw dispatches, gates blocking real skips, corpus-blind caveats steering lanes correctly — and surfaced a shared root cause across its top defects: **signals that are only safe because a smart consumer happens to distrust them**. Every fix below makes the artifact carry its own guard rails instead. Each design parameter was locked by the reporter's answered follow-ups, including one self-correction of my proposed mechanism.

- **No merged 0–100 on consolidation.** The −15/−7/−3 deduction model saturates at the 0 floor on multi-lane merges (field: −171 in deductions rendered a shippable branch as 0/100; two LLM layers independently routed around the number, but the structured `"score": 0` field was one CI hook away from being trusted). Synthesis-mode reviews now emit `score: null` + `lane_scores[]`, and the headline is **verdict + severity counts + the per-lane score distribution** — the 91-vs-24 lane spread is the signal; averaging it manufactures false precision. Serial single-dispatch reviews keep their number (no distribution to hide). Contract lives in the agent body AND the dispatch template, per the structural-trigger lesson.
- **Repro-spec contract for behaviorally-testable claims.** A three-round verify saga (finder, verifier, and operator each tested a hallucination claim at a DIFFERENT placement; two rounds confidently "falsified" a correct finding) locked the fix finder-first: findings asserting runtime behavior must carry the exact placement/config + expected observable — and the finder must have run that exact test to file. The verifier reproduces the spec **verbatim**, states the tested placement in its verdict, and returns `needs_revision` rather than improvising a configuration when the spec is missing. Prevention at author time, enforcement at verify time.
- **Cost preview with mandatory value caveat at scope_check.** The parallel-offer now pairs a rough banded estimate (single vs ~N lanes + consolidation + verify, with the field-measured 6–8× anchor) with the coverage signal (domain spread, where single-dispatch confidence drops) — a naked cost number systematically biases toward false economy on exactly the reviews where fan-out pays (the "expensive" run caught two cross-lane Criticals). Explicitly banned: mid-verify-loop cost readouts — they cannot distinguish convergence spend from waste, and the field's ~800K third round was the one that reversed a wrong refutation.
- **Session-distance eviction for `code-review-input.md`.** The file is double-duty — documented pre-written-scope escape hatch AND prior-session leftover (field: a stale 123-file scope nearly reviewed against a 42-file live diff). Blanket eviction would kill the escape hatch; the reporter's own correction showed a prior-`created_at` comparison under-evicts mid-session leftovers. Shipped their prep-window rule: reset-soft evicts only when the file is >1h old — a deliberate pre-write minutes before launch survives, anything demonstrably pre-dating this session's prep dies.
- **Mechanical**: the `--raw-count=${VAR:-?}` unquoted glob sentinel (zsh aborts on `?`) is quoted with a non-glob default; the phase banner renders `workflow_type` instead of a literal `?` when tier is absent (review workflows have no tier); `verify_iteration`'s 0-based retries-not-dispatches semantics documented at the read site.
- Gates **K274** (all five fixes pinned) + **K274b** (eviction behavioral: stale dies, pre-write survives). Drift-guard stack 180 → 182 deep (K94–K274b).

## [0.165.1] - 2026-07-16

### Fix: template copy shipped ephemeral dirs into scaffolded projects

- `setup --template python-fastapi` delivered `__pycache__` (compiled bytecode caches from the template's own arch-scan tests running in CI) into every scaffolded project's `.devt/rules/`, and would likewise have shipped a stray `.devt/state/` hook-trace residue scaffolded into the template by an agent running with its cwd there. These directories regenerate — deleting them doesn't stick — so the copy layer is the enforcement point: `copyDirRecursive` + `copyMissingFiles` now skip `__pycache__`, `.ruff_cache`, `.pytest_cache`, `.mypy_cache`, `.devt`, `.git`, `node_modules`.
- Behaviorally verified both directions: pollution gone from a fresh scaffold AND intentional template content (`tests/architecture/`, `detectors/`, `pydantic-patterns.md`) still ships.
- Gate **K273** (plants pollution in the template, scaffolds, asserts zero ships + content intact, cleans up). Drift-guard stack 179 → 180 deep (K94–K273).

## [0.165.0] - 2026-07-16

### python-fastapi template: error-shape + streaming sections (cal #49 follow-up)

The two research-validated items deferred from the FastAPI/Pydantic calibration, re-verified against live sources 24h apart with zero drift before shipping:

- **RFC 9457 problem-details section** in architecture.md — the community-recommended error response shape (`application/problem+json` with `type`/`title`/`status`/`detail`/`instance`), framed explicitly as *recommended shape, not FastAPI default* (core still emits `{"detail": ...}`). Wires into the template's existing `AppError` hierarchy via the exception handler + per-class type/title registry; points at the actively-maintained `fastapi-problem` library; requires a deliberate decision on the 422 validation-error format rather than mixed shapes.
- **Streaming & SSE section** — JSON-lines streaming and Server-Sent Events are now first-class framework surface; the section carries the four rules that keep streams from taking down the service: never block inside a streaming generator (stalls the loop for every request), release resources on client disconnect (`try/finally` — abandoned generators are a slow leak), bounded `asyncio.Queue` backpressure, and flat item models (typed SSE items validate per item).
- **K271 extended** to guard both sections. Deliberately still held back: `lazy=` relationship detector (receipt-gated — the only field consumer runs 94-to-1 sync sessions, nothing to fire on), httpx2 migration (upstream hasn't moved), other-template calibrations (own research loops).

## [0.164.1] - 2026-07-16

### Fix: graphify MCP scaffold path + dead registration hint

Both surfaced by a live platform-doc check on the `.mcp.json` location question:

- The scaffolded graphify server's graph-path arg was bare-relative (`graphify-out/graph.json`), resolving against the spawned server's working directory — which Claude Code does not guarantee to be the project root. Now `${CLAUDE_PROJECT_DIR:-.}/graphify-out/graph.json`, the platform-documented form for project-scoped `.mcp.json` (the `:-.` default degrades to today's behavior where the variable isn't substituted, and self-heals wherever it is). Existing projects reconcile on `setup --mode reinit`; `create`/`update` leave user entries untouched as before.
- `health`'s `GRAPHIFY_MCP_UNREGISTERED` fix message instructed users to register `graphify mcp --project .` — a subcommand upstream removed (setup.cjs has scaffolded `python -m graphify.serve` for months; the hint was never updated). Anyone following it registered a server that cannot start. The message now leads with re-running setup and shows the current uv launch form.
- Gate **K272** (prefixed graph path + no dead registration hint anywhere). Drift-guard stack 178 → 179 deep (K94–K272).

## [0.164.0] - 2026-07-15

### python-fastapi template: FastAPI + Pydantic best-practice calibration

Four-agent research sweep (official FastAPI docs + release timeline, community production consensus, ecosystem stack, dedicated Pydantic pass — every prescription live-verified against primary sources, cross-corroborated, UNVERIFIED claims excluded). The template's bones held up (Annotated DI, lifespan, UUIDv7, uv, structlog+OTel, testcontainers, ASGITransport all still current); what follows fixes the parts the ecosystem moved out from under.

- **Security stack corrected**: `python-jose` (unmaintained, dropped from official guidance) → **PyJWT**; `passlib`/`bcrypt` → **pwdlib[argon2]** with `PasswordHash.recommended()` (the official tutorial stack; passlib survives only as a read-legacy-hashes note).
- **Async story rewritten** (was self-contradictory: prescribed sync-DB-by-default while showing async testing): explicit decision tree (non-blocking → `async def`; blocking lib → `def`/threadpool of ~40; mixed → `run_in_threadpool`; CPU-bound → task queue), async-first DB as the default posture, and the async-SQLAlchemy trap kit — engine-once-in-lifespan, session-per-request yield dependency (+ the new `scope` parameter), `expire_on_commit=False`, `selectinload`/`joinedload`, **`lazy="raise"` relationship default**, `MissingGreenlet` explained.
- **New `pydantic-patterns.md` add-on** (~300 lines): ConfigDict essentials (`extra="forbid"` at API boundaries, the 2.11 aliasing trio replacing `populate_by_name`), validator rules (ValueError-only — anything else 500s; messages leak verbatim into 422 bodies; no `assert`), `field_serializer` over deprecated `json_encoders`, `computed_field`, TypeAdapter reuse, `exclude_unset`-vs-`exclude_none` semantics + the official PATCH pattern, discriminated unions, `AwareDatetime`, `Optional ≠ default`, `polymorphic_serialization`, settings (secrets_dir, the BaseSettings `extra="forbid"` default gotcha, eager fail-fast + `lru_cache` dependency), and the validate-at-boundaries performance doctrine.
- **Enforcement over prose**: ruff `FAST` + `ASYNC` rule groups added to the pyproject example — FAST002 mechanically enforces the template's own Annotated-DI rule; ASYNC detects blocking-in-async. Compatibility-floor table added to coding-standards (FastAPI ≥0.128 = Pydantic-v2-only; 0.132 strict JSON Content-Type; pytest-asyncio 1.x; httpx 0.28).
- **Response-model idiom**: return-type annotation as primary (now also the fast Rust-serialization path), `response_model=` only when types diverge; second-validation-pass cost noted; self-contradicting `= Depends()` example fixed.
- **pytest idiom coherence**: pytest-asyncio 1.x config (`asyncio_mode=auto` + explicit `asyncio_default_fixture_loop_scope`), no per-test markers, `event_loop`-fixture and `AsyncClient(app=)` flagged as removed-upstream.
- **Six new common-smells entries**: lazy-loading-in-async (MissingGreenlet/hidden N+1), ValueError-internals-leak, legacy test-client/event-loop idioms, `exclude_none`-in-PATCH, superseded config flags; sync-in-async entry gains the `run_in_threadpool` escape and threadpool-exhaustion context.
- **architecture.md additions**: BackgroundTasks-vs-queue boundary (ARQ async-native default, Celery for heavy pipelines), workers guidance (K8s single-process; gunicorn is legacy; uvicorn is HTTP/1.1-only), correlation-id middleware + double-access-log note, alembic `pyproject_async` init template, structure-tradeoff note (deliberate Clean-Architecture sublayers vs community flat-per-domain).
- **HURL 8 notes** in hurl-reference: RFC 9535 JSONPath engine, removed multiline-string attributes, secrets redaction (`--secrets-file`), parallel-by-default `--test` mode vs ordered chains.
- **De-contamination sweep**: field-project domain vocabulary in generic examples (ownership table, HURL domain map + foundation chain, changelog example rows, scope table, service-name lists, circular-dep examples) replaced with generic Users/Orders/Catalog/Billing/Notifications shapes.
- Gate **K271** (template currency: pydantic-patterns present + PyJWT/pwdlib + FAST/ASYNC wiring + trap kit + pytest-asyncio idiom). Drift-guard stack 177 → 178 deep (K94–K271).

## [0.163.0] - 2026-07-15

### Fourth field receipt, lane ergonomics: diff-first lanes + un-droppable consolidator contract

The same six-lane field run's ergonomic layer, design-locked by the reporter's measured answers: lane sizing measured the wrong quantity (whole-file LOC fired "oversized" on all six lanes — 14K–69K against an 800 threshold, zero signal — while diff sizes of 872–7,937 lines were what actually predicted budget), the mitigation that made lanes land (hand-generated per-lane diff artifacts, diff-read-FIRST method) wasn't a workflow capability, cross-repo lanes had to fake it with absolute paths, and the consolidator's synthesis contract silently didn't activate under a customized prompt.

- **Diff-LOC lane sizing + first-class lane-diff artifacts.** `register-lane` now generates `.devt/state/lane-diff-<id>.txt` (merge-base diff of the lane's files: committed + working tree + untracked) and sizes the lane on its line count: `size_class` ok < 3,000 / chunked ≥ 3,000 / split ≥ 8,000 — thresholds calibrated from the field run's measured lanes (≤~3,000 needed nothing; 7,937 landed with chunking). Whole-file fallback (no usable git context) claims `size_class: unknown` instead of a fake verdict. The 15-file trigger is gone (16–19-file lanes were all fine).
- **Diff-first review method, auto-injected.** `render-lanes` adds `<lane_diff>` + `<lane_method>` ("the diff IS the change under review; full files only for context around changed hunks") to every lane envelope with an artifact; `chunked`/`split` lanes additionally get the hunk-enumeration read strategy. Only `split` lanes interrupt the operator — `chunked` is handled by the envelope.
- **Per-lane (repo_root, base_ref).** Lane registration accepts a repository root + diff base per lane — sizing and the diff artifact are computed in that repo. Covers the sibling-repo lane (frontend repo with `base=main` reviewed alongside an API repo on `base=development`) that previously required hand-rolling everything.
- **Auto-partitioner routes through register-lanes.** The community-partition step no longer hand-builds a lanes YAML splice with its own (whole-file) sizing — one sizing implementation, lane-files sidecars + diff artifacts now exist for BOTH partition paths, and the fixed `/tmp` block file (a concurrent-session collision hazard) is gone.
- **Structural synthesis trigger.** The consolidator contract (including the `consolidator-ran.txt` marker, step 0) previously activated on a literal opening phrase — a near-verbatim custom prompt ("the 6" for "the N") skipped it silently. It now triggers on the `<lane_files>`-of-review-lane-artifacts structure, regardless of task phrasing.
- **Paste-ready consolidator envelope.** `dispatch render-filled code-reviewer:code_review_parallel` now pre-fills `{lane_files_newline_separated}` from the lane registry (terminal lanes, foreign cids excluded — the consolidate step's exact filter) and `--notes-file` injects `<orchestrator_notes>` (cross-lane reconciliation directives, validation evidence) — the three field-reported reasons for hand-rolling (unknown trigger, no advertised render path, no customization slot) each get a mechanical answer. The consolidate + dispatch discoverability tips now name both render CLIs explicitly.
- `lane-diff-*.txt` added to the state-file contract (pattern-allowed) and to `reset-soft` eviction (a stale diff read as "the change under review" is silent-wrong-input).
- Gates **K267–K270** (diff sizing behavioral incl. untracked + fallback, diff-first injection, consolidator render behavioral, structural trigger + single-source partition) + **K27 recalibrated** (size_class/size_basis/diff_artifact surface; legacy lanes report null, never a fake class). Drift-guard stack 173 → 177 deep (K94–K270).

