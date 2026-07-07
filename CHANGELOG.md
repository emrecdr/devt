# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/). The `[Unreleased]` section below stages changes for the next version — when bumping, rename it to `## [X.Y.Z] - YYYY-MM-DD` so the release workflow's changelog extractor (`scripts/extract-changelog.sh`) can find it.

## [Unreleased]

## [0.148.0] - 2026-07-07

### Fold code-review substep 7 into a CLI (workflow body-weight)

`code-review.md`'s context_init substep 7 carried ~110 lines of inline `jq` that ran on every review — deterministic post-processing of on-disk JSON (`graph-impact.md` + `preflight-brief.json`) with zero MCP and zero model judgment. Because it runs *after* the MCP tier call, it couldn't fold into the pre-MCP `contextInitBundle`; it needed its own post-MCP CLI. This is the same "don't dump logic into context" principle the session applied to per-dispatch payloads, now applied to the workflow body.

- **New `graphify augment-impact-map` CLI** (`graphify.cjs::augmentImpactMap`) appends the same six sections to `graph-impact.md`, byte-identical to the prior inline output: file- and symbol-level god-node warnings (via `check-large-files` / `check-symbol-godnodes`), the dropped-symbol truncation banner + section, hyperedge-completeness, ambiguous-bindings, and the preflight god-node fallback (emitted only when both diff-anchored checks come back empty). Substep 7 shrinks from ~110 lines of `jq` to a single CLI call — lighter workflow context on every review, and the emission logic is now unit-tested instead of embedded in prose.
- No behavior change: the CLI reproduces the exact section wording; a fixture test locks byte-identity. `git` stderr is suppressed on non-repo / bad-base so the CLI degrades quietly. The load-bearing `assert-preflight-fresh` / `assert-graphify-decision` gates at the end of substep 7 are untouched.
- Gates: **K238** (behavioral — the CLI emits all six sections with byte-identical wording on a synthetic graph + brief, and the preflight fallback is correctly suppressed when diff god-nodes are present); F17c + M12 re-pointed to the CLI as the single source of the emitted section wording. Drift-guard stack 144 → 145 deep (K94–K238).

## [0.147.0] - 2026-07-06

### Slim the memory-pre-flight skill (per-dispatch weight)

The `memory-pre-flight` skill is preloaded in full into 8–9 agents' system prompts on every dispatch — but roughly half of it was cold-path detail (the full Brief structure, the 5-lane escalation mechanics, config, multi-root behavior, common pitfalls) that an agent needs only when it actually escalates. That half was paying per-dispatch rent for a minority-case reference.

- **Hot protocol stays inline; cold detail lazy-loads.** The skill body now carries only what an agent needs mid-edit — when the protocol applies, how to read `.devt/state/preflight-brief.md`, the `PREFLIGHT` scratchpad-line format + decision tree, the hook behavior, and the deny-recovery source table. The cold detail moved to `references/memory-pre-flight-details.md`, Read on demand (the same lazy-load pattern `specify.md` already uses for its PRD template). Result: **261 → 118 lines** (~55% smaller) in the preloaded body, saving that weight on every programmer / reviewer / tester / verifier / researcher / architect / debugger / docs-writer dispatch.
- No behavior change: the pre-flight-guard hook reads the scratchpad, not the skill, so the protocol contract is unchanged; the load-bearing strings (`preflight-brief.md`, multi-root `source_root`) stay in the body.
- Gate **K237** (behavioral: the skill retains the `PREFLIGHT` format + deny-recovery table, points to the reference, the reference exists with the 5-lane detail, and the body stays under a line ceiling so the cold detail can't creep back). Drift-guard stack 143 → 144 deep (K94–K237).

## [0.146.0] - 2026-07-06

### Review-weight: scale ceremony to change size (field receipt, Scope A)

A field review argued that the heavyweight review pipeline runs the same way for a two-line change as for a cross-cutting refactor — and that the "correct" path fires friction warnings for the sensible lightweight path. This ships the safe half of the fix: an explicit lightweight flag plus a **fail-safe advisory** that recommends light-vs-heavy on every review but never auto-acts. Auto-selection is deliberately deferred until the advisory has a track record (the field priors are n=1).

- **`review-weight assess` — a fail-safe light-vs-heavy verdict.** New `bin/modules/review-weight.cjs` computes, from the diff, whether a review can safely run light: logic-file count (lockfiles / `requirements*.txt` / `VERSION` / `*.md` excluded — a "12-file" change that is 10 lockfiles + 2 logic files is small), domain count, and **risk-surface hits** (framework-general patterns: auth / authz / rbac / crypto / secrets / redaction, schema / migrations / `*.sql`, core / shared / event-bus / error-bases). Combined with the blast headline (`effect_size`, `god_node_match`, `tier`) the caller already computed, the verdict is `light` **only** when danger is provably absent: `god_node_match: false` and no risk-surface path are HARD gates; `effect_size` only corroborates (it is popularity-derived and noisy). A change the graph can't speak to (`tier: skip` / no headline) is **not** eligible — absence of a headline is not evidence of safety. Every threshold is project-overridable under `.devt/config.json::review.*`; the defaults are framework-general (no project-specific paths).
- **Advisory shadow mode (non-gating).** `code-review.md` context_init now runs the verdict and announces it (`[review-weight] LIGHT-eligible …` / `HEAVY recommended — <reasons>`) on every review. It changes nothing on its own — it accumulates a track record so a future cal can decide whether the recommendation is reliable enough to auto-act on. Light must be earned, not granted.
- **`/devt:review --lite` / `--full`.** `--lite` (operator judges the change small) runs the graphify headline (single `blast_radius`) plus the deterministic god-node check but skips the heavyweight multi-tier drill-down; `--full` forces the full drill-down. Neither is auto-selected — only the operator's flag changes behavior.
- Gate **K236** (behavioral: small-clean → light; auth path / god-node / >2 domains / effect_size large → heavy hard-gates; graph-blind → not eligible; lockfile-heavy → stays light). Drift-guard stack 142 → 143 deep (K94–K236).

Deferred (per the field receipt's own n=1 caveat): auto-selection of the light path, review-lens lane partitioning, and memory contradiction-flagging — each its own cal once the advisory has run enough real reviews.

## [0.145.0] - 2026-07-06

### Blast-radius transparency + degree coherence (field receipt)

A field review found that graphify's blast-radius drill-down was untrustworthy in three specific ways, all in devt's own consumption code (`bin/modules/graphify.cjs`, not upstream graphify). This ships the safe, unambiguous subset of the fixes — correctness and telemetry only, no change to which nodes are considered dependents.

- **`edge_count: 0` on a real dependent — fixed.** `blastRadius` held dependents as labels and recomputed each one's degree by re-resolving the label back to a node id — which returned the *first* node with that label, an edgeless namesake in another module when a homonym existed. A dependent reached through a real edge would then report `edge_count: 0`, a self-contradiction that eroded trust in the whole degree signal. The traversal now carries the real BFS-visited node id through to the degree computation, so degrees are always measured against the exact node that was reached. Any residual `edge_count: 0` (a genuine graph inconsistency) is flagged `low_confidence` and counted in `edge_count_zero_flagged` rather than presented as fact.
- **Filtered consumers are no longer a black box.** The noise/test-path/DI-aggregation filters dropped dependents with only a per-category count emitted — a reviewer asking "what else must I check" couldn't see *which* consumers were filtered, and a wrongly-filtered real consumer was invisible. `blast_radius` and `get_neighbors` now emit a capped, reason-coded `dropped_sample` (`{label, reason, source_file, depth}`) so every filtered consumer is auditable. (Field case: a route was silently filtered as a file-node; the sample now surfaces it by name and reason.)
- **The filter and the reviewer's question are no longer conflated.** `effect_size` legitimately wants the filtered set (risk sizing), but "what else depends on this" wants the raw set. When the raw dependent count is small enough for a human to read (`graphify.raw_dependents_full_view_threshold`, default 30, keyed on dependent count — not file count), `blast_radius` now exposes the full unfiltered `raw_direct_dependents` (each annotated with its `filtered_reason` or `null`) and demotes the noise filter to an advisory annotation. Above the threshold the filter earns its keep. `direct_dependents` remains the filtered risk-sizing view throughout.
- Gate **K235** (behavioral: a homonym-carrying synthetic graph proves the degree fix distinguishes from the pre-fix re-resolution, plus `dropped_sample` reason coverage and small-diff raw exposure). Drift-guard stack 141 → 142 deep (K94–K235).

Upstream-owned findings from the same review (Leiden community over-fragmentation, incremental-update phantom deletions, producer-suppression extraction blind spots) are relayed to graphify rather than reimplemented here — devt guards nonsensical output but does not re-derive graphify's algorithms.

## [0.144.0] - 2026-07-06

### Newer-model prompt hygiene (safe subset)

Current Anthropic guidance for the Fable 5 / Opus 4.x generation deprecates two habits carried over from older models: anxious over-emphasis, and prompts that make the model reproduce its own internal reasoning as response text. This ships only the provably-safe part of that alignment — the wholesale de-prescription of the two largest agent files (programmer.md's 21 steps, code-reviewer.md's 41) is deferred: 60 of their exact prose strings are smoke-gate-asserted, and the quality gain from restructuring them is unproven on Fable, so churning them now would be mechanism-firing without demonstrated value.

- **Preventive `reasoning_extraction` guard (gate K234).** Newer Claude models can trigger a `reasoning_extraction` refusal — and an elevated fallback to a heavier model — when a prompt tells them to echo, transcribe, or output their internal reasoning / chain-of-thought / thought process verbatim. No agent or skill body does this today; K234 keeps it that way. The pattern fires only on a reproduce-verb paired with a *qualified* reasoning-noun (internal / chain-of-thought / thought-process / trace / tokens / hidden / raw / verbatim), never bare "reasoning", so a legitimate "explain your reasoning for this finding" instruction is untouched. The gate self-tests against a synthetic false-positive and false-negative so the pattern can't silently rot into an always-pass. Drift-guard stack 140 → 141 deep (K94–K234).
- **Anxious closers calmed.** The two `context_loading` closers that leaned on anxiety ("...that waste everyone's time", "...which is worthless") now state the directive plus a factual reason without the pressure language — aligned with the current-model preference for brief, non-anxious instructions. No gate-asserted string touched.

### Internal (post-review cleanup)

Cleanups on the v0.143.0/v0.144.0 mechanisms, surfaced by a `/simplify` pass:

- **`init` no longer reads rubric files off the workflow path.** `loadInlineRubrics` is now called only for the `review` verb (the sole consumer of an inline rubric); non-review `init` previously read every configured rubric off disk just to discard the bodies. Also fixed `inline_rubrics_omitted` to derive its universe from the configured rubric set rather than the read result, so an oversized-rubric fallback is correctly reported as omitted instead of silently as `[]`.
- Consolidated the CLAUDE.md by-reference stub to a single exported constant (was two divergent string literals across `init.cjs` and `dispatch.cjs`); generalized the rubric-by-reference stub to seed from the configured rubric keys instead of hardcoding `code_review`; moved a doc-comment onto the function it describes and dropped a redundant placeholder check already covered by the general regex.

## [0.143.0] - 2026-07-06

### Token-lightening: transport dedup (zero output-quality change)

Four surfaces were paying for the same bytes twice per dispatch. Removing the duplication leaves each agent's effective context identical, minus the redundant copy — so the savings carry no quality risk. The dispatch prose itself was already audited and kept (rewording guardrails was previously found net-negative); this pass trims only transport, not content.

- **CLAUDE.md is no longer inlined into dispatch envelopes.** The harness auto-injects project `CLAUDE.md` into every subagent's context (only the built-in Explore/Plan agents skip it, and devt's agents are custom agents), so inlining it inside the `<governing_rules>` block paid its ~23KB cost a second time on every programmer / code-reviewer / tester / verifier / researcher / architect dispatch. `loadGoverningRules` now carries a short by-reference stub for the `CLAUDE.md` key — hashed for drift detection, surfaced in `paths_excluded` with reason `harness_injected` — and the 14 envelope templates plus all compiled workflow regions render the stub. Agent bodies updated to state CLAUDE.md is harness-injected and never Read from disk.
  - Before: `<claude_md>` carried the full project CLAUDE.md body per dispatch.
  - After: `<claude_md>` carries a one-line by-reference note; the harness supplies the real content.
- **Skill double-load removed.** An agent's frontmatter `skills:` preloads the full SKILL.md bodies at agent startup; `skill-index.yaml` then re-listed the same skills in the `<agent_skills>` injection, so each dispatch Read ~5–14KB of skill bodies it already held. `skill-index.yaml` buckets are now disjoint from each agent's frontmatter skills (`memory-pre-flight`, `codebase-scan`, `code-review-guide`, `tdd-patterns`, `verification-patterns`, `graphify-helpers`, `memory-curation` removed from the buckets that duplicated frontmatter); `io-contracts.yaml` `index_buckets` synced; the `<agent_skill_injection>` prose across all workflows now notes frontmatter skills are never re-listed and to inject an explicit "(none — defaults preloaded via agent frontmatter)" when the resolved list is empty.
- **Rubric by-reference for the verifier, the parallel consolidator, and per-lane reviewers.** The pinned rubric is now Read from `<rubric_path>` by those dispatches instead of being inlined (14.3KB × N lanes + every verifier dispatch). The single-dispatch reviewer KEEPS its inline rubric — a deliberate self-check so reviewer and verifier grade the same axes without a revision loop. `init workflow` ships no inline rubric bodies (only the standalone-review verb keeps them, since only `code_review` is consumed anywhere), surfaced via a new `inline_rubrics_omitted` key. `dispatch render-lanes` defaults to rubric-by-reference alongside rules-by-reference (`--inline-rules` restores both for worktree-isolated lanes), reported via a new `rubric_mode` field. Envelope-health now counts the rubric signal as present when either `<rubric_content>` or `<rubric_path>` is populated.
- **Command `@`-refs removed.** `commands/*.md` no longer `@`-reference whole workflow families in an `<execution_context>` block — in harnesses that expand `@`-refs this inlined every referenced workflow body (≈196KB for `commands/workflow.md`'s 10 refs) before routing, of which only one is used and is then Read again. The smoke-gated mandatory `Read` of the resolved workflow file was always the deterministic load path.

### Fixed

- Removed cal/receipt provenance identifiers from runtime prose (envelope templates, workflows, hooks) — the reasoning is preserved, the ephemeral IDs belong to the changelog and git history.
- `commands/memory.md` referenced the dead path `.devt/learning-playbook.md`; operational lessons live in `.devt/memory/lessons/` (curator-gated LES entries).
- The `CLAUDE.md` guardrails inventory listed two files that no longer exist (`incident runbook`, `skill update guidelines`).
- Unified the `<agent_skill_injection>` idiom onto the `resolved_skills`-from-init one-liner where the workflow's init path exposes it; the two workflows whose init genuinely lacks `resolved_skills` (parallel review off cached state, arch-health with no compound init) keep the config-probing variant, now corrected to reference the `skill-index.yaml` default merge.
- `dispatch.cjs` STATIC_TAGS named the guardrails block `inline_guardrails` where the rendered tag is `guardrails_inline` (measurement-only misattribution).

### Guardrails

- The governing-rules gate now positively asserts the CLAUDE.md by-reference invariant (content stub + `harness_injected` in `paths_excluded`); the complex-tier skill gate asserts frontmatter skills are not re-listed in `resolved_skills`; the code-review rubric gate (M15) now guards the inline-reviewer / by-reference-everywhere-else split.
- Gate **K233** (behavioral: `skill-index.yaml` buckets stay disjoint from every agent's frontmatter `skills:` — generalizes the programmer-only complex-tier spot-check to all agents). Drift-guard stack 139 → 140 deep (K94–K233).

## [0.142.0] - 2026-07-02

### Test files excluded from architectural scanners

Both of devt's architecture surfaces now skip test files — tests legitimately import across layers, run long, and co-change with the code they cover, so scanning them only manufactures false positives (layer violations, god-files) and inflates hotspot/coupling signal without representing production structure.

- **Python arch scanner (`templates/python-fastapi/arch-scan.py`).** `_iter_python_files` — the sole file-gathering chokepoint every detector consumes — now skips `tests/` and `test/` directories (any depth) plus co-located test modules by name (`test_*.py`, `*_test.py`, `conftest.py`), so a test file outside a test directory is excluded too. Added `test_iter_python_files_excludes_test_suites` to the scanner's pytest suite and a dedicated smoke gate (a project with a layer violation in production + identical violations in `tests/` and a co-located `models_test.py` → only the production file is scanned/reported).
- **Evolution scan (`bin/modules/evolution.cjs`, language-agnostic).** New `exclude_tests` option (default on) filters test files from ALL behavioral metrics (hotspots, coupling, fix density, churn) at both file-entry points. Language-general patterns span Python/Go/Ruby/JS/TS/Java + `tests/` dirs (mirrors graphify's canonical test-path set); projects extend via `evolution.test_path_patterns[]`, disable via `evolution.exclude_tests`, or pass `--include-tests` per-run (a churny test file can itself flag an unstable API). A `test_files_excluded` counter is surfaced in the JSON summary + report markdown per the telemetry-on-reduction rule.
- Gate **K232** (behavioral: 6 multi-language test files excluded from metrics + counter + `--include-tests` escape hatch restores them). Drift-guard stack 138 → 139 deep (K94–K232).

### Fixed

- **`evolution.cjs` was stored as a binary file.** The coupling-pair map key used two *literal* NUL bytes as a path delimiter (`paths[i] + <NUL> + paths[j]`) instead of the `"\0"` escape sequence, so git detected the whole file as binary and rendered its diffs unreviewable. Replaced the embedded NUL bytes with the textually-identical `\0` escape (zero behavior change — verified by the existing coupling gate K225) so the file is plain text and diffs are reviewable again.

## [0.141.0] - 2026-07-02

### Graphify drill-down signal calibration — relevance-ranked targets + confidence-split neighbors

Follow-up to v0.140.0's graphify quick wins, from a second field report. The v0.140.0 mechanisms fired but were miscalibrated: the reviewer ran the shipped code and it still mis-targeted the drill-down. Two findings, both validated against the field run's own artifacts before implementation (a third — "dispatch-hygiene guard defanged" — was investigated and confirmed a misread: the shipped default is `block`; the field project set `warn` in its own config, loudly banner-flagged, with the finalize gate + kill-threshold + agent hard-stop all intact — no change).

- **`get_neighbors` confidence split + INFERRED cap.** Upstream graphify emits same-file symbol adjacency as low-confidence INFERRED `uses` edges; a field `get_neighbors` returned 247 "consumers" that split 228 INFERRED / 19 EXTRACTED — the co-location bulk drowning the trustworthy structural edges, which were mixed at equal prominence (sole ordering was depth+alpha). `getNeighbors` now ranks every non-INFERRED neighbor (EXTRACTED / AMBIGUOUS / unknown) ahead of INFERRED — the reliable set is never capped — then trims the INFERRED tail at `graphify.inferred_neighbor_cap` (default 25), surfacing `confidence_extracted` / `confidence_inferred_total` / `confidence_inferred_capped` telemetry per the telemetry-on-reduction rule.
  - Before: 247 neighbors ordered depth+alpha, EXTRACTED and INFERRED at equal prominence — 92% co-location noise on top. After: EXTRACTED first, INFERRED tail capped, split visible in telemetry. Graphs that don't populate confidence are unaffected (everything reads as non-INFERRED → unchanged depth+alpha ordering).
- **`blast_radius` relevance-ranked drill-down targets.** The prior "degree-ranked" dependents ranked by the dependent's own in-degree — which surfaces incidental high-fan-in god-nodes (permission enums, event-bus protocols) as top drill targets even when they relate to the change only tangentially, and whose depth-2 incoming overflows the MCP transport (forcing the reviewer to deviate and hand-drill the actually-changed symbols). `blast_radius` now ranks `direct_dependents` by RELEVANCE to the diff: a dependent whose `source_file` is among the changed symbols' files (`relevance_tier` 2) or that shares a Leiden community with a changed symbol (`relevance_tier` 1) outranks an unrelated one; pure god-nodes (top-degree AND tier 0) are DEMOTED to the bottom but stay present — they are real dependents, so dropping them would hide genuine callers (expanding the framework-builtin filter to hide them would be the wrong fix). The relevance signal is derived entirely from data already inside the function (changed-symbol `source_file` + `community` + the existing top-degree set) — no new inputs. `direct_dependents_degrees` gains `source_file` / `relevance_tier` / `is_god_node` / `pure_god_node`; `code-review.md`'s F16 drill-down consumes the relevance order and routes `is_god_node` targets to the `--max-bytes` fallback — resolving the self-conflict where `assert-graphify-decision` mandated drilling god-nodes its own ranking made undrillable. Config `graphify.drill_down_relevance_ranking` (default true) reverts to raw in-degree.
  - Before: top-3 drill targets were the highest-fan-in dependents (god-nodes). After: co-located / same-community dependents rank first; god-nodes only reached as fallback, transport-safe.
- Both fixes stay general (framework-agnostic relevance signals; every heuristic config-overridable) and demote/cap rather than drop — no real dependent or trustworthy edge is ever hidden. K229's degree ordering is preserved as the within-tier tie-break.
- Gates: K230 (confidence split + cap + telemetry, behavioral), K231 (relevance ranking demotes-not-drops god-nodes + tier/flag fields, behavioral). Drift-guard stack 136 → 138 deep (K94–K231).

## [0.140.0] - 2026-07-02

### Added

- **Evolution scan — git-history behavioral metrics for `/devt:review --focus=arch`.** New zero-dependency `bin/modules/evolution.cjs` + `evolution scan` CLI computes the research-validated process metrics a snapshot scanner cannot see, from a single `git log --numstat` pass: hotspots (change frequency × LOC — Tornhill/CodeScene model), change coupling (co-change pairs with code-maat's degree formula — catches runtime-wired dependencies invisible to the structural graph), SZZ-lite fix density (syntactic bug-fix commit matching), relative churn (Nagappan & Ball), code age, and ownership/minor-contributor counts (Bird et al., auto-gated at ≥3 authors in window). Language-agnostic — works on any git repo regardless of stack. Writes `.devt/state/evolution-report.{md,json}` with truncation telemetry (shown/total counters, mass-commit exclusion count).
  - Before: arch-health scan analyzed a static snapshot only — 50 findings, all severity-ranked, zero signal on which ones sit in code that actually changes. After: the architect effort-weights findings by hotspot rank (a violation in a top hotspot outranks the same violation in cold code), flags co-change pairs lacking structural edges as hidden coupling, and marks bleeding-edge files (high churn/loc + high fix density) in the health trend.
  - Coupling excludes commits touching more than `evolution.max_changeset_size` (default 30) files — mass reformats create false co-change signal; exclusions are counted, never silent.
  - Config block `evolution.*` (window, thresholds, fix pattern, excludes, ownership mode) — every heuristic overridable per project.
  - New workflow step `evolution_scan` in `arch-health-scan.md` (graceful `{ok:false}` degrade outside git repos); `<evolution>` context block in the architect envelope; evolution summary section in the report step.
  - `evolution-report.{md,json}` registered as canonical + persistent state artifacts.
  - Gates: K225 (functional — synthetic-repo hotspot ranking, coupling detection, changeset guard, fix density, artifacts), K226 (wiring — step + envelope block + effort-weight instruction present). Drift-guard stack 131 → 133 deep.

- **Graphify signal quick wins — three devt-side fixes from the field report's soft-spot list.** All validated against the run's own artifacts before implementation; the lane-partition redesign (soft spot #2) is deliberately deferred to its own design round — the field oracle showed change-cohesion, not community-splitting, is the right primary partition key.
  - **`symbol_anchored` working-tree caveat.** The graph indexes commits, so untracked files and files added after the graph build are invisible to `blast_radius` — `pr_scoped_diff` warned about this, `symbol_anchored` didn't (field case: the branch centerpiece was an untracked module; the blast ran against its old path silently). The impact plan now attaches `symbol_anchored_caveat` via the shared build-SHA ancestry check + a `git ls-files --others` census (code extensions only), and the workflow prepends it to `graph-impact.md`.
  - **Hunk-type census + severity-calibration note.** `effect_size` measures symbol popularity (graph degree), not change semantics — a ~75%-cosmetic branch scored "large" and the operator hand-wrote a calibration note into `graph-impact.md` to stop lanes inflating severity (it demonstrably worked — lanes cited it). The plan now carries `hunk_census` (`{total_hunks, cosmetic_hunks, cosmetic_ratio, high_similarity_renames}`, language-general line classifiers) and auto-generates `severity_calibration_note` above `graphify.severity_note_threshold` (default 0.5), keeping the field note's "use the caller sets to verify wiring" clause so the discount can't become an excuse to skip cascade checks. Orchestrator copies it into `graph-impact.md` as `## Severity Calibration`.
  - **Degree-ranked dependents + framework-builtin filter.** `direct_dependents` was Set-insertion-ordered with no degree fields, so the drill-down "top-3" degraded to array position and anchored on framework builtins (2 of 3 drill-downs worthless until the substance gate forced a re-anchor). `blast_radius` now ranks `direct_dependents` by in-degree, emits `direct_dependents_degrees` (`{label, in_count, edge_count}`), and filters framework request/response/DI builtins from dependents (framework-general defaults spanning FastAPI/Spring/Django/.NET/Express per the stays-general guardrail; `graphify.framework_builtin_noise` extends, `"!Label"` removes). `code-review.md`'s drill-down ranking consumes the degrees array.
  - Gates: K227 (working-tree caveat behavioral), K228 (severity note behavioral), K229 (ranking + builtin filter behavioral). Drift-guard stack 133 → 136 deep (K94–K229).

## [0.139.0] - 2026-07-02

### Lane envelopes go rules-by-reference — 391KB → 110KB (−71%) per 5-lane review

`dispatch render-lanes` duplicated the full governing-rules body (CLAUDE.md + 4 `.devt/rules/*` files, ~57KB) byte-identical into every lane envelope — 73% of a field-measured 391KB 5-lane render. The same field run proved the alternative: hand-rolled compact envelopes with rules-by-reference passed the dispatch-hygiene guard (it matches tag *presence*, not content) and produced five substantive, verifier-clean lane reviews with **selective** rules reads (each lane read the 1–2 files relevant to its scope, ¼–½ of the corpus, targeted) and zero verifier-flagged quality gaps.

- **`render-lanes` defaults to by-reference.** Each `governing_rules` content field becomes a short read-from-disk stub; the `rules_hash` attribute stays for drift detection; CLAUDE.md is dropped outright (the harness auto-injects project CLAUDE.md into every subagent — inlining it paid its byte cost twice). Field-measured on the real 5-lane registry: 391,013 → 110,528 bytes.
- **`--inline-rules` opt-out** restores full inlining for worktree-isolated lanes whose disk view may not match the orchestrator's. `render-filled` (single dispatch, 1× cost) and the consolidator dispatch keep inline content unchanged.
- **Context-Loaded contract** keeps selective reading honest: by-reference envelopes carry a `<context_loaded_contract>` block requiring lanes to record every rules file actually read in a `## Context Loaded` section; the consolidate step emits a per-lane advisory when the section is missing. This is the guard against the n=1 risk that a weaker model skips the Reads entirely.
- `render-lanes` result carries `rules_mode` (`by-reference`/`inline`) so the reduction is auditable, per the telemetry-on-reduction rule.
- The hand-assembled lane dispatch block in `code-review-parallel.md` mirrors the same default (by-reference `governing_rules` line + Context-Loaded task instruction).
- **K223** (behavioral: no rule/CLAUDE.md bodies in by-reference render, stubs + hash + contract present, `--inline-rules` restores bodies and drops the contract) + **K224** (prose: lane task instruction + consolidator advisory carry the Context-Loaded contract). Drift stack 129 → 131-deep (K94–K224).

## [0.138.0] - 2026-07-02

### Field-receipt fixes — 7 validated bugs/UX gaps from the first full parallel-review run

A greenfield field report surfaced 6 orchestration bugs + alert fatigue; every claim was validated against the code and the run's own `.devt/state/` artifacts before fixing. One report item (invalid JSON from `review-context-init`) was **not** a devt bug — the CLI's stdout is a single `JSON.stringify` and parses clean; the captured breakage came from re-emitting the bundle through a model-rendered write, which turns `\n` escapes into literal newlines. A capture-discipline note in `code-review.md` substep 1 now says to persist `$CTX` via shell redirection only.

- **Stub-gate phrase precedence** (`state check-agent-output`): stub phrases were OR-ed with the word count, so one phrase match flagged any document — a 2,242-word substantive lane review was flagged `looks_like_stub` because a verdict sentence contained "not yet done", and the prescribed remediation would have overwritten it with a narrowed top-5 redispatch. Phrases are now decisive only below `STUB_PHRASE_WORD_CEILING` (300 words); the word-count and heading-only signals are unchanged, and `stub_phrases_found` still reports matches for telemetry.
- **Auto-reset double-signal** (`state staleness-check` / `auto-reset-if-stale`): the recommendation required task-changed AND type-changed AND age>24h, so real session turnover (task+type changed at 16h) still forced an interactive prompt. Now task-changed AND type-changed AND age>1h; single-signal cases keep the prompt. Field counterfactual verified lossless (cleared fields were per-workflow ephemera; arch-scan-report.md and memory survived).
- **Review phases registered**: `scope_check`, `partition_lanes`, `dispatch_lanes`, `substance_check_lanes`, `redispatch_lanes`, `consolidate`, `present_findings` added to `PHASE_ORDER` — they warned "Unknown phase" on every parallel review AND silently short-circuited `validateConsistency`'s phase-gated artifact checks. Placed early in the order so sitting at a lane phase doesn't imply dev-pipeline artifacts exist.
- **mcp-stats silent under-report**: `--workflow-id` stays strict by default (deliberate design — chain-union over-counts long sessions), but a strict query returning 0 while the `workflow_id_history[]` chain has matches now emits a `hint` naming `--include-chain`, and both workflows' "Graphify activity" surfaces pass `--include-chain` (their context_init MCP calls land under the pre-rotation id by design — the field run showed 5 real graphify calls reported as zero). `filters` output now echoes `workflow_id` + `include_chain`. Docs (CLAUDE.md, INTERNALS.md) corrected — they still described the pre-strict union default.
- **scope_check measures its own source**: it read `code-review-input.md`, which `identify_scope` writes *later*, so the file count was always 0 on fresh runs and the >10-file parallel path was reachable only via the operator-intent short-circuit. It now counts the same merge-base-aware git diff identify_scope uses (pre-written artifact still honored as the escape hatch).
- **Config-drift banner once-per-session** (`workflow-context-injector.sh`): the safety-floor alert fired on every UserPromptSubmit (~15-19×/session field-observed — alert fatigue trains operators to ignore it). Now once per session per project via a `session_id` marker in the devt cache dir; `session-start.sh` still surfaces it at session open; missing `session_id` fails loud (every-prompt).
- **`update-lane override_reason=`**: operator overrides of lane verdicts (e.g. keeping a review the stub gate false-flagged) were untraceable. New optional field appends `{ts, lane_id, prior_status, status, redispatch_count, override_reason, pid}` to `.devt/state/lane-status-overrides.jsonl` (RESET_EXEMPT, registered in the state-file contract); rejected standalone — it must annotate a real mutation.
- **K215–K222** pin all of the above (phrase ceiling both sides, double-signal three cases, phase registry + bogus-phase control, chain hint + recovery, scope_check source, audit ledger + standalone rejection, banner dedup behavioral 3-case, `--include-chain` at all 4 call sites). Drift stack 121 → 129-deep (K94–K222).

## [0.137.0] - 2026-07-02

### Workflow body-weight — defer specify.md's PRD template + illustration to references/

`specify.md` carried a 115-line PRD template (needed only at Step 4) + ~50 lines of best-practices / anti-patterns / example-session illustration up-front on every run. Both are now lazy-loaded from `references/`, matching the pattern specify.md already uses for `questioning-guide.md` / `domain-probes.md` / `council-offramp.md`.

- **`references/prd-template.md`** (new) — the generate step Reads it at Step 4 and fills it; deferred from up-front load (and skipped entirely if the spec is abandoned before Step 4).
- **`references/specify-guide.md`** (new) — best practices, anti-patterns, and a worked example session; pointer only, Read when useful (not required to execute the steps).
- **`specify.md` 504 → 344 lines.** The load-bearing `validate_spec` scoring rubric, `success_criteria`, and Memory-layer-integration sections stay inline.
- **K214** locks the deferral (generate step Reads `prd-template.md`; `specify-guide.md` pointer present; both reference files exist with real content — so the deferred body can't silently vanish). Drift stack 120 → 121-deep (K94–K214).

## [0.136.0] - 2026-07-02

### Fix: dev + quick_implement finalize hard-blocked by a code-review-only gate

Confirmed pre-existing bug — `dev.complete` **and** `quick_implement.complete` required `assert-auto-curator-considered`, but the marker (`auto-curator-considered.txt`) is written **only** by code-review.md's auto_curator step. Since `advanceState` throws on any blocking gate, a real dev or quick_implement run reaching finalize would throw at `state advance-phase complete` (verified by reproduction). It went unnoticed because full pipelines-to-`complete` are rare in dogfooding.

- **Removed `assert-auto-curator-considered` from `dev.complete` + `quick_implement.complete`.** Both are non-review workflows that enforce curation-consideration via their own unconditional `harvest_observations` / `assert-claude-mem-harvest` gate — the code-review-only marker never applied. `code_review` / `code_review_parallel` keep the gate (they own the auto_curator step + write the marker).
- **K213** locks the class: each workflow_type's `.complete` set must be satisfiable by that workflow — a STANDARD dev and a quick_implement, each with only the markers their own workflow writes, must reach `complete` without blocking. Drift stack 119 → 120-deep (K94–K213).
- Surfaced-but-deferred: `code_review_parallel`'s `present_findings` also calls `assert-auto-curator-considered`, and the parallel path has no auto_curator writer step of its own — a probable related review-path gap flagged for a separate design call (does a parallel review run auto_curator, or not).

## [0.135.0] - 2026-07-02

### `--dry-run` preview accuracy — reconcile the tier tables with the live gates

A live receipt on the tier-partition (v0.132–134) surfaced a pre-existing drift: `dev-workflow.md`'s two summary surfaces — the **Tier Routing Manifest** and the **Tier→Steps table** that `--dry-run` prints its pipeline from — under-reported the STANDARD/COMPLEX step lists versus the authoritative inline `_Skip if…_` gates. Execution was always correct (the inline annotations are the live gates); only the `--dry-run` *preview* was incomplete.

- **Tier→Steps table** (the `--dry-run` source) now lists the full per-tier pipeline: STANDARD gains `risk_warning`, `regression_baseline`, `harvest`; COMPLEX gains `risk_warning`, `research`/`plan`, `regression_baseline`, `harvest`, `autoskill`; SIMPLE gains `harvest`.
- **Tier Routing Manifest** legend gains `R=risk-warning` + `RP=auto-research+plan` so the two unnumbered pre-steps appear in the STANDARD/COMPLEX rows.
- Pre-existing (not caused by the carve); zero execution impact — a `--dry-run` now previews exactly what a real run executes. No gate change; 957 smoke/0.

## [0.134.0] - 2026-07-01

### Workflow body-weight Stage 3 — lazy-load the COMPLEX steps (tier-partition complete)

The final stage of the `dev-workflow.md` tier-partition. The 3 COMPLEX-only dispatch steps (auto_research_plan, architect, curate) move into a new `dev-workflow.complex.md`, and docs_retro_parallel joins the STANDARD file. `dev-workflow.md` 1,424 → 1,088 lines — **cumulatively 1,728 → 1,088 (~37% lighter)** for the common SIMPLE/TRIVIAL tiers, which now load only the spine.

- **`load_tier_steps` extended:** STANDARD reads `dev-workflow.standard.md`; COMPLEX reads both `.standard.md` + `.complex.md`; SIMPLE/TRIVIAL load neither.
- **Verbatim moves** — the researcher / architect×2 / curator / docs-writer / retro dispatch envelopes moved with BEGIN/END/EDIT-SOURCE intact (the compiler globs `workflows/`); `check-contracts` + compile-drift stay clean. `auto_research_plan`'s pre-existing double-`</step>` was preserved byte-for-byte. Each tier file carries its own `<available_agent_types>` (W010) and an `assert-artifact-present` (K50: complex.md via architect's, standard.md via verifier's).
- **Gate repointing:** the 5 COMPLEX-content gates (parallel-dispatch marker, arch_health dispatch scoping, F22 curator B4 pre-gate, K7 architect claim-check, K205 researcher `<memory_signal>` region) now read `dev-workflow.complex.md`.
- **K210/K211 extended to all 10 relocated steps** across both tier files (partition still complete + disjoint; the load directive references both). Gate count unchanged at 119-deep (K94–K212).
- Tier-partition complete: `dev-workflow.md` (spine, all tiers) + `dev-workflow.standard.md` (STANDARD+) + `dev-workflow.complex.md` (COMPLEX). Every step body appears exactly once; SIMPLE runs shed ~640 lines.

## [0.133.0] - 2026-07-01

### Workflow body-weight Stage 2 — lazy-load the verify step (+ close a pre-existing verify-skip hole)

Stage 2 of the `dev-workflow.md` tier-partition relocates the **verify step** (166 lines — the single largest tier-gated block, carrying the verifier dispatch envelope) into `dev-workflow.standard.md`. `dev-workflow.md` 1,590 → 1,424 lines; SIMPLE/TRIVIAL runs no longer carry it.

- **Verbatim move** — the `<!-- BEGIN/END dispatch:verifier:dev -->` + `EDIT-SOURCE` region moved intact; the dispatch compiler globs `workflows/`, so `dispatch check-contracts` + K1/K71/K119/K206 stay green. The verify step gains an `assert-artifact-present verifier` Layer-1 claim-check (parity with the programmer/architect steps) and the tier file carries its own `<available_agent_types>` (W010) — both correct, not gate-appeasement.
- **Closes a pre-existing safety hole:** `assert-verifier-ran` was in the code_review terminal gate set but **absent from `dev.complete`** — a STANDARD dev task could silently skip verify with nothing catching it. It's now added to `dev.complete`, made **tier-aware**: `assertVerifierRan` opts out (ok:true) for dev SIMPLE/TRIVIAL (which run no verify step) and requires `verification.json` for STANDARD/COMPLEX. code_review/code_review_parallel carry no tier and are unaffected.
- **Gate repointing:** the verify-content gates (three-way envelope routing, two-call merge precedence, `rubric_path`) now read the tier file; the `devt:verifier` workflow→type case-map accepts `dev-workflow*`; and the two hollow whole-file greps (verifier `<memory_signal>` / `<scope_trust>`) are tightened to region-scope the moved verifier envelope — so they verify the actual dispatch instead of passing off an unrelated spine copy.
- **K212** locks the tier-aware verify gate; **K210/K211** extended to 6 relocated steps. Drift stack 118 → 119-deep (K94–K212).
- Stage 3 (COMPLEX dispatch steps: auto_research_plan, architect, curate + docs_retro) remains.

## [0.132.0] - 2026-07-01

### Workflow body-weight — lazy-load STANDARD+ tier steps (Stage 1)

`dev-workflow.md` is the default `/devt:workflow` entry, and its whole 1,728-line body loaded into context on every run regardless of tier — even though a SIMPLE task executes only implement → test → review. Stage 1 of the tier-partition relocates the **dispatch-free STANDARD+ steps** (risk_warning, scan, regression_baseline, simplify, autoskill) into a lazily-Read `dev-workflow.standard.md`, loaded only when the assessed tier is STANDARD or COMPLEX. TRIVIAL/SIMPLE runs no longer carry those bodies. Zero features removed — the step bodies moved **verbatim** (gate contracts, tier skip-clauses, artifacts unchanged).

- **New spine step `load_tier_steps`** (after tier detection) issues a mandatory Read of `dev-workflow.standard.md` for STANDARD+; each relocated step leaves a `TIER-STEP:<name>` pointer at its original pipeline position so execution order is preserved.
- **`dev-workflow.md` 1,728 → 1,590 lines**; the 5 relocated steps (~138 lines) load only on STANDARD/COMPLEX. The dispatch compiler globs `workflows/`, so all compile/contract gates (K1/K71/K119/K206) + the ~60 dev-workflow-coupled gates stay green.
- **K210** (partition complete + disjoint — each relocated step appears exactly once across the file set, none lost, none duplicated) + **K211** (spine carries the `load_tier_steps` mandatory-Read directive + a pointer per relocated step). Drift stack 116 → 118-deep (K94–K211).
- **K99 orphan-detector fix**: its reference regex now recognizes dotted workflow filenames (`dev-workflow.standard.md`) so the lazy-load Read reference is seen — was `[a-z0-9-]*`, now `[a-z0-9.-]*`.
- Stage 1 deliberately moves only the **dispatch-free** steps (0 gate breakers). Stages 2–3 (verify + the COMPLEX dispatch steps) follow, each with its gate repointing + a tier-aware `verify` gate that also closes a pre-existing `dev.complete` hole (`assert-verifier-ran` is absent from the dev terminal set today).

## [0.131.0] - 2026-07-01

### Scope-aware context-init freshness — fixes cross-review stale-bundle contamination

A field eval (dogfooding `/devt:review` on a Bitbucket PR) surfaced a correctness bug in the compound context-init wrapper: the freshness short-circuit keyed on **graph freshness alone**, so a review served a *different* PR's cached bundle whenever the graph happened to be fresh — wrong `scope_hint` / `memory_signal` / `scope_trust`, and an on-disk `graphify-impact-plan.json` still carrying the prior PR's symbols. A faithful impact-step would have anchored the whole blast-radius on the wrong diff. The free-text `task` was no help as a key — it degrades to the generic default `"code review"`.

- **Freshness is now keyed on `(scope_sig, graph_head)` jointly** (`contextInitBundle`). `scope_sig` is a hash of the review's changed-file set (`git diff --name-only <primary>...HEAD`, three-dot / merge-base), anchored to HEAD; `graph_head` is the graph's current commit. A scope change invalidates the cached `scope_hint` / `memory_signal` / `impact-plan` **even on a fresh graph**; a same-scope re-call still short-circuits (the resume optimization is preserved). A null signature (no git / unresolved base / empty diff) fails safe to a full recompute — a false full-compute costs a few round-trips; a false short-circuit served the wrong review's context.
- **Loud signals replace silent stale-serve:** a one-line `[devt]` banner on every legitimate cache reuse, plus an explicit "review scope changed (was … now …) — recomputing" line when a stamped bundle belongs to a different scope.
- **`state.task` + the on-disk impact-plan now recompute on a scope change** (both were skipped on the short-circuit path). `reset-soft` additionally evicts the scope-bound `graphify-impact-plan.json` — it had preserved it as a "phase artifact", so a soft-reset left a stale plan behind — while still preserving workflow-spanning `graph-impact.md`.

### SessionStart surfaces a lowered safety floor

`dispatch_hygiene_mode` defaults to `block` (raw `devt:*` dispatches that bypass the envelope are hard-blocked). A project that lowers it to `warn`/`off` silently weakens that floor — the field eval hit exactly this, flagged every turn but never explained at session start. `session-start.sh` now surfaces a one-line `⚠️ safety floor lowered` notice when the merged config is below `block`, silent at `block`.

- **K207/K208/K209** lock the three surfaces: scope-aware `(scope_sig, graph_head)` freshness (same-scope short-circuits, a changed-scope review recomputes on a fresh graph), `reset-soft` evicts `graphify-impact-plan.json` while preserving `graph-impact.md`, and `session-start.sh` surfaces the hygiene floor. Drift stack 113 → 116-deep (K94–K209).

## [0.130.0] - 2026-06-30

### Structural context-blocks contract gate (`dispatch check-contracts`, K206)

Generalizes the per-agent `<memory_signal>` presence greps (K204/K205) into one structural invariant, so the bug class that left the researcher blind — a dispatch silently missing a context block its contract declares — is caught for **every** agent + variant, not one hand-written grep at a time. Closes the `io-contracts.yaml` drift surface that was marked `(future)` precisely because it was unenforced.

- **New CLI `dispatch check-contracts`:** for every compiled `<!-- BEGIN dispatch:agent:wf -->` region, asserts the region body carries an XML block for each `context_block` the agent declares in `agents/io-contracts.yaml`. Exit 1 + a `violations[]` list on any gap. Checks the committed region bodies (what actually ships), not just the templates.
- **Variant-aware via `context_blocks_exempt`:** io-contracts gains an optional flat `<workflow_id>:<block>` exemption list so a variant can legitimately omit a declared block — `programmer` exempts `quick_implement:plan` (quick-implement skips planning); `code-reviewer` exempts `guardrails_inline` on the `code_review` / `code_review_parallel` variants (standalone review leans on `governing_rules` + the rubric and never loads inline guardrails). Each exemption is itself audited — it must name a real declared block, so the suppression list can't silently neuter the gate.
- **Closed an inconsistency the gate surfaced:** the `quick_implement` code-reviewer now carries `<guardrails_inline>` (golden-rules / engineering-principles / generative-debt-checklist). quick-implement already loads inline guardrails for its programmer, so the reviewer now reviews against the same constitutional guardrails the dev reviewer does — no exemption needed (only `code_review` / `code_review_parallel`, which don't load them at all, stay exempt).
- **K206** runs the real CLI against the live templates. Drift stack 112 → 113-deep (K94–K206).

## [0.129.0] - 2026-06-30

### researcher `memory_signal` — second path (`/devt:workflow` auto-research)

Completes the `memory_signal` fix shipped for the standalone `/devt:research` path. That change wired the standalone researcher but left the COMPLEX `/devt:workflow` auto-research researcher (`dev-workflow.md`'s `dispatch:researcher:dev`, sourced from the generic `researcher.tmpl.md`) still blind to REJ/ADR — even though `dev-workflow` already computes and caches `memory_signal_json` and injects it into the programmer, code-reviewer, and verifier dispatches. The signal was computed but never delivered to the researcher (mechanism firing without value conversion).

- **Quality fix:** added `<memory_signal>` to `templates/dispatch/envelopes/researcher.tmpl.md` + recompiled the inline region, and added an orchestrator-prep `memory_signal_json` read before the parallel researcher/architect dispatch. The auto-research researcher now investigates with the project's REJ-tombstone / ADR governance signal (north-star #2: output quality always increases).
- **SSoT consistency:** `agents/io-contracts.yaml` researcher contract now lists `memory_signal` in `context_blocks` — it was the lone consumer omitting it while shipping the block in its dispatch.
- **K205** locks all four surfaces — generic template, region-scoped compiled inline (a sibling dispatch's `<memory_signal>` can't satisfy it), orchestrator-prep substitution, and the io-contracts SSoT — so the signal can't silently drop on either researcher path. Drift stack 111 → 112-deep (K94–K205).

## [0.128.0] - 2026-06-30

### research-task wrapper wiring + researcher `memory_signal` fix (lightening + quality)

The remaining-lever pick: the only one that's **both** lightening *and* a quality fix.

- **Lightening:** `research-task.md` context_init now calls `state workflow-context-init --workflow-type=research` once — init round-trips **8 → 4**. Replaces its fragile inline-jq scope override with the wrapper's `preflight scope-cache`. The preflight-fresh gate, staleness AskUserQuestion, and graphify scan-prep stay separate.
- **Quality fix (the differentiator):** the researcher dispatch previously carried **no `<memory_signal>`** — it investigated approaches blind to REJ tombstones / ADRs and could re-recommend an already-rejected approach. Added `<memory_signal>` to `templates/dispatch/envelopes/researcher-research.tmpl.md` + recompiled; the wrapper caches `memory_signal_json` and the researcher now receives REJ/ADR/Concept governance signal (north-star #2: output quality always increases).
- **K204** locks both the wiring and the `<memory_signal>` injection (template + compiled inline) against regression. Drift stack 110 → 111-deep (K94–K204).
- research-task was safe to wire (it already calls `init workflow`, so no resume-reset hazard). debug.md remains excluded (needs a resume-safe non-resetting variant); research-task's own scan-prep block is left inline for a later fold.

## [0.127.0] - 2026-06-29

### `preflight scan-prep` — shared graphify_scan_prep CLI (dedup, token-optimization)

Lightening pass option #5: the `graphify_scan_prep` decision tree was an ~84%-identical inline bash block duplicated across dev-workflow.md + quick-implement.md (a KEEP-IN-SYNC burden). Extracted into one CLI.

- **`preflight scan-prep --scope=<task>`** — reads `preflight-brief.json` (`direct_dependents_count` + `graph_stats.trust` + `topic.symbols`), applies the adaptive threshold via graphify, picks the central symbol, and returns `{decision, central_symbol, dependents, trust, threshold, symbols_count, reason}`. Writes `graphify-skip-reason.txt` on SKIP (preserving the assert-graphify-decision "exactly one artifact" contract). The orchestrator reads `.decision` and runs the MCP calls (still its job — ACTIVE → blast_radius + drill-down, RECOVERY → query_graph, SKIP → grep fallback). No feature removed.
- **dev-workflow context_init: 6 → 5; quick-implement: 7 → 6** orchestrator CLI round-trips (cumulative with the prior wrapper: dev-workflow 16 → 5, quick-implement 11 → 6). Removes the duplicate decision tree.
- **K203** locks the CLI's 3-way decision + the skip artifact. Drift stack 109 → 110-deep (K94–K203).

Note: the gate→hook lever was investigated and reclassified — devt's PostToolUse(Task) hooks are advisory-only, so migrating `assert-artifact-present` off its inline hard-block would regress enforcement. It is a reliability lever (add unskippable hook + keep the block), NOT a lightening one. The remaining lightening backlog is recorded in the project memory.

## [0.126.0] - 2026-06-29

### Generalized context-init wrapper — dev-workflow + quick-implement (token-optimization, no feature/quality loss)

Receipt-driven lightening pass (5-dimension research): the dominant per-run cost is ceremony round-trips + re-paid static context, not the gates. The top option generalizes the shipped `reviewContextInit` into a shared `contextInitBundle` core with thin `review` / `workflow` mode wrappers.

- **`state workflow-context-init --workflow-type=<t> --scope=…`** — new CLI (shared core with `review-context-init`). Collapses each workflow's data-gathering (`init workflow` + activate + `preflight generate` + `memory query --signal=3` + `preflight scope-cache` + `evict-graphify`) into one bundle call carrying `{ok, init, impact_plan, scope_trust, memory_signal, god_node_warnings, freshness, staleness_tier, degraded_fields}`.
- **dev-workflow.md context_init: ~16 → 6 orchestrator CLI round-trips**; **quick-implement.md: ~11 → 7**. Gates (`assert-preflight-fresh`, `assert-graphify-decision`), the graphify scan-prep step, the staleness AskUserQuestion, and the flag-writes stay as separate, unskippable steps. No feature removed; same side-effect artifacts + `workflow.yaml` caches, so dispatch envelopes are unchanged.
- **`contextInitBundle` refactor is DRY** — `reviewContextInit` is now a thin caller; K200/K201 guard the review path against regression (both still green).
- **K202** locks the dev-workflow + quick-implement wiring + the workflow-mode bundle shape (init payload + memory_signal). Drift stack 108→109-deep (K94–K202).
- **Plugin description reworded `Lightweight` → `Zero-dependency`** (plugin.json + marketplace.json). "Lightweight" was only defensible on install footprint (zero deps, stdlib-only, no build); it misleadingly implied conceptual simplicity for a system with 10 agents, ~20 workflows, a 109-gate drift stack, and a multi-layer memory graph. The reword anchors the claim to the axis where it's true.
- **Deferred (documented):** `debug.md` excluded from wrapper wiring — it deliberately omits `init workflow` to preserve `/devt:next` resume state, so routing it through a state-resetting wrapper would risk a resume regression (violates the no-quality-loss constraint). `research-task.md` deferred to a focused pass (its prose is tightly coupled to specific call positions). The remaining research items (gate→hook migration, guardrails `static-compress`, claude-mem harvest dedup) are queued.

## [0.125.0] - 2026-06-29

### Cal #39.B wiring — `code-review.md` context_init consumes the `review-context-init` bundle

The `state review-context-init` compound CLI shipped previously but `code-review.md` still issued the ~19 inline round-trips, so the ceremony reduction was never actually delivered. This wires the workflow to the wrapper.

- **Substep 1** now makes a single `state review-context-init --scope=… --primary-branch=…` call, capturing the bundle into `$CTX`. Substeps 2/3/5 read `memory_signal` / `scope_trust` / `god_node_warnings` / `impact_plan` from the bundle; substep 4's staleness decision reads `$CTX.staleness_tier`. The wrapper still writes the same `workflow.yaml` caches + `.devt/state/` side-effect artifacts, so the dispatch envelopes are unchanged. Orchestrator context_init drops from ~19 CLI round-trips to ~4.
- **Gates stay separate, unskippable stops** — substep 0 stale-workflow prompt, substep 4 staleness AskUserQuestion, substep 6 MCP impact-plan execution, and all 7 substep-8 `assert-*` gates remain distinct orchestrator steps (deliberately NOT folded into the wrapper). The win is removing LLM round-trips, not gates.
- **Wrapper now surfaces the `init` payload** — `reviewContextInit` runs `init review` ahead of the freshness short-circuit and returns its payload as `bundle.init` (`governing_rules`, `models`, `inline_rubrics`, …) in BOTH the full and short-circuit paths, so the code-reviewer/verifier dispatch envelopes fill their `{governing_rules}` / `{models}` / `{inline_rubrics}` placeholders from the one call instead of a separate `init review`.
- **Wrapper `god_node_warnings` shape fixed** — now emits the canonical `{god_node_match, matches, ambiguous}` the code-reviewer agent body parses. The shipped wrapper emitted `{god_nodes}`, which the agent's parser + the ambiguous-bindings surface did not recognize — a latent bug exposed only once the wrapper was actually consumed.
- **K201** locks the collapse: asserts `code-review.md` context_init calls `review-context-init` AND the bundle carries the `init` payload, so it can't silently regress to inline calls or a payload-less bundle. Drift-guard stack 107→108-deep (K94–K201).
- Migrated the L7 + M14 smoke gates (god_node_warnings prep + ambiguous-bindings construction) to assert `state.cjs` computes them, since those inline workflow steps moved into the wrapper.
- Stripped ephemeral provenance markers (`cal #34 #1`, `receipt #8 Q4`, `C-I.1`) from the rewritten substeps per the no-version-refs-in-prose rule.

## [0.124.0] - 2026-06-29

### Cal #39.B — compound `review-context-init` wrapper (heavy-ceremony fix, CLI)

greenfield receipt #11's headline friction: code-review `context_init` is 9 substeps / **19 CLI round-trips** / 7 gates before a single file is reviewed — "great for autonomous runs, heavy for interactive." But greenfield also confirmed the gates "earned their keep" (the staleness pre-flight + claim-check each caught a real failure this session). So the tax is the ~15 *data-gathering* round-trips, not the gates.

New `state review-context-init --scope=<text> [--primary-branch=<ref>]` collapses the data-gathering (init + activate + preflight brief + memory_signal + scope-cache + freshness/eviction + impact-plan + god-node warnings) into **one** call returning a bundle: `{ok, short_circuited, impact_plan, scope_trust, memory_signal, god_node_warnings, freshness, staleness_tier, degraded_fields}`. Removes ~15 of the ~19 orchestrator round-trips.

Design (per greenfield's round-two answers):
- **Per-field graceful degradation with honest absence** — a degraded field reports `freshness.state:"unknown"`/`scope_trust:"empty"`/`god_node_warnings:[]`, **never** a false-confident `"ready"`/`"fresh"`. A false "fresh" is worse than a graphify outage (it claims a signal is present when it's absent). Validated: graphify-disabled → `freshness.state:"disabled"`, not a fake fresh.
- **Fail-fast only on a true prerequisite** (init itself / state-activate) — graphify is an enhancer; its outage degrades, never aborts.
- **Freshness short-circuit checked BEFORE eviction** — a fresh re-call (preflight-fresh + plan exists + graph fresh) returns the cached bundle untouched, so a clean resume doesn't evict the `graph-impact.md` it's about to reuse.
- **Gates stay separate** — the 7 asserts + the staleness AskUserQuestion + the MCP impact-plan execution remain distinct orchestrator stops; bundling a gate verdict into JSON would make an unskippable wall skimmable.

**Note:** this ships the validated CLI mechanism. Wiring it into `code-review.md` (collapsing substeps 1–5+7 to call it) is the remaining integration — deferred to a focused step to protect the production review path, since several smoke gates assert that workflow's substep prose.

### Fix: K117 doc-count meta-gate blind spot at K200

K117's gate-counting regex was `K(9[4-9]|1[0-9][0-9])` — it matched K94–K199 but **not** K200+. Crossing into the 200s meant a new gate (K200) went uncounted and the meta-gate passed against stale docs. Widened to `K(9[4-9]|[1-9][0-9][0-9])` (K94–K999). The doc-drift guard now guards its own range boundary.

**Drift-guard stack now 107-deep K94-K200.** K200 asserts the wrapper bundle shape + short-circuit + honest-absence degradation.

## [0.123.0] - 2026-06-29

### Cal #39.A — three receipt-#11 fixes (substance hard-fail + SHA caveat + DI-opaque surface)

Three decoupled, field-evidenced fixes from greenfield's receipt #11, each closing a way the review pipeline could mislead silently.

**#3 — substance-check hard-fail on missing/zero-byte + `lane_failed` coverage status.** `checkAgentOutput` on a missing file returned `looks_like_stub: false`, and all 6 consumers branch on `looks_like_stub == true` — so a missing lane file silently took the *pass* branch (greenfield's L9: a lane file absent the whole time read as substantive). Now missing → `looks_like_stub: true` + `missing: true`; zero-byte/whitespace-only → `+ empty: true`. New `lane_failed` lane status (terminal, distinct from `deferred`): a lane that produced *no* output even after retry reviewed *nothing* — the consolidator reports it under "Uncovered Scope" so "all lanes terminal" can't hide a zero-coverage hole. (The all-lanes-terminal gate that *prevents* the race already existed; greenfield hit it only via a hand-rolled background loop.)

**#4 — SHA-based "new files" caveat.** The cal #38.A `matched_files` proxy still over-fired for files indexed-at-HEAD-but-symbolless (receipt #11: "6 of 188 files new" was a false alarm — the graph was at HEAD). Now each added file's introducing commit is compared against `built_at_commit` via `git merge-base --is-ancestor`; only files added *after* the graph was built count. Degrades **safe**: unresolvable SHA (rebase/squash) → assume indexed, because false-"not-indexed" is the noise this caveat exists to remove.

**Q5a — `blast_radius` DI-opaque caller surface.** A service reached only through FastAPI `Depends()` factories shows empty/sparse `direct_dependents` (callers collapsed by DI-aggregation), which silently reads as "no callers" for often the highest-value symbol in the diff. When the collapse *dominates* the visible set (`filtered_di_aggregation >= direct.size`), `blast_radius` now emits `di_opaque: true` + `di_collapsed_caller_files` (top-K caller source_files — the actual files to open, which the graph already had and was just hiding) + a labeled note. Zero edge-tracing; purely re-surfacing.

**Drift-guard stack now 106-deep K94-K199.** K198 (substance hard-fail + lane_failed + DI-opaque) + K199 (SHA caveat via real git fixture).

## [0.122.0] - 2026-06-27

### Doc sync — close the cal #37/#38 documentation gaps + RESET_EXEMPT drift meta-gate

A wrap-up doc audit found three staleness issues from the cal #37/#38 arc:

- **`docs/STATE-RULES.md` claimed "5 entries"** for RESET_EXEMPT when the set had grown to 8 (forensic logs accreted across cal #31.D / #34 #6 / #37 #1). The two hardcoded "5" counts are now **count-free** ("the RESET_EXEMPT set survives") to prevent re-staleness, and the forensic-logs table gains the three missing rows: `last-curator-run.txt`, `graphify-impact-plan.json`, `workflow-id-rotations.jsonl`.
- **`docs/operator-guide/CLI-REFERENCE.md` was missing `state disk-check`** (cal #38.C) — added alongside the existing `compute-impact-plan` entry, documenting the warn-only contract.
- Config knobs `ubiquitous_types` + `lane_state_guard` are documented in `config.cjs` (the source-of-truth convention all graphify knobs follow — `di_aggregation_pattern`, `test_path_patterns`, etc. live there too), so no separate config-table entry was needed.

**New meta-gate K197** asserts every `RESET_EXEMPT` canonical filename appears in `docs/STATE-RULES.md` — converting "remember to update the doc when you add a forensic log" into a structural CI invariant (same class as K117 doc-count / K156 case-enum / K194 stays-general). It extracts the Set's line-start quoted members (mid-line comment artifacts excluded) and fails the build on any undocumented entry.

**Drift-guard stack now 104-deep K94-K197.**

## [0.121.0] - 2026-06-27

### Cal #38.B item 6 completion — ubiquitous-type stoplist reaches the new-file fallback

A verification pass against the original cal #38 plan found item 6 was half-shipped: the shared ubiquitous-type stoplist was wired into god-node warnings (v0.117.0) but NOT into the `symbolsInFiles` G5 new-file fallback — the plan called for "one shared list for god-node-warning suppression AND the new-file whole-file fallback path." The warnings half landed; the fallback half was an oversight.

The graph has no nodes for an un-indexed (new) file, so hunk-scoping can't anchor it — every regex-extracted declaration is included as a blast anchor. A declaration whose NAME collides with a ubiquitous graph god-node pulls that god-node's entire blast set (noise). Now the same `_getUbiquitousTypeSet` stoplist that quiets god-node warnings drops it here too: a genuinely-new symbol survives, a god-node-named declaration is filtered, and `fallback_ubiquitous_filtered` is surfaced per the telemetry-on-reduction principle. Force-keep (`!`-prefixed `config.graphify.ubiquitous_types`) entries are honored via the same exemption.

**Drift-guard stack now 103-deep K94-K196.** Gate K196 asserts the fallback stoplist (dominant-hub graph + a new file declaring a fresh symbol + a colliding god-node name → fresh kept, god-node dropped, telemetry counter set).

This closes the last genuine gap in the cal #38 plan. (Item 7's literal "drop markdown-parse path" remains a deliberate no-op — preflight already overlays live `godNodes()` inc+out, so the path is dead and the `god_nodes_built_at` stamp addresses the temporal divergence. Item 10's `<200Mi` hard-block was dropped per the operator's warn-only choice.)

## [0.120.0] - 2026-06-27

### Cal #37 #2 — lane state-mutation guard (concurrent-rotation corruption fix)

The last architectural piece of the cal #37 cluster. Field evidence (the cal #37 #1 audit log was built to diagnose exactly this): during a parallel-lane review, 8 subagents rotated the shared `workflow_id` mid-run (1f871314 → f67240bb), corrupting trace attribution. `workflow.yaml` — especially `workflow_id` — is orchestrator-owned; a lane subagent must never rotate/reset/init it.

**Enforcement is at the CLI, not a hook** — a subagent's Bash runs the same `node devt-tools.cjs state update`, so a CLI self-guard works regardless of whether PreToolUse:Bash hooks fire for subagents (unverifiable). The discriminator is sound: during a fan-out the orchestrator is *blocked* awaiting `Task()` returns, so any workflow_id rotation while a subagent is "running" is necessarily a lane subagent.

`state update` (workflow_id first-activation + type-transition), `state reset`, `state reset-soft`, and `init workflow` (closed-workflow strip) now call `_guardConcurrentRotation()`, which reads the `subagent-status.sh`-maintained `.devt/state/status.json`: if a subagent is marked `running` with a fresh timestamp, the mutation throws (block mode). Key properties:
- **`state update-lane` is never guarded** — it's the safe lane path, mutates only `lanes[].status` in-place, never touches `workflow_id`. Lanes update their status normally.
- **Stale "running" entries are ignored** — a crashed subagent whose SubagentStop never fired (timestamp > 30 min) doesn't permanently wedge the orchestrator.
- **No status.json (the common case) never blocks** — the guard is best-effort signal, not a hard precondition.
- **`config.lane_state_guard`** = `block` (default) / `warn` (stderr advisory, proceed) / `off`. Same block-default rationale as `dispatch_hygiene_mode`: silent corruption is hard to diagnose post-hoc, so prevention beats a warning.

Validated end-to-end: fresh-running → `state update`/`reset-soft` throw; `update-lane` allowed; completed/stale/no-file → allowed. `test-locking.cjs` (20-worker concurrent state writes) stays green — the guard doesn't impede legitimate concurrency.

### Fix: K194 aborted the suite under `set -e` (shipped latent in v0.119.0)

K194's `K194_HITS=$(grep ... | wc -l)` exits non-zero on **0 matches** — which is the *pass* case — and `pipefail` + `set -euo pipefail` turned that into a full-suite abort after K193 (K194/K195/test-gates/result never ran). v0.119.0's CI was red as a result. Wrapped the grep in `{ ...; || true; }` so a clean tree yields `0` without aborting. (K195's expected-failure command substitutions got the same `|| true` treatment.)

**Drift-guard stack now 102-deep K94-K195.** New gate K195 asserts the guard's full matrix (fresh-running blocks update+reset-soft; update-lane allowed; no-file + stale allowed).

**Cal #37 complete** (#1 audit log, #2 state-mutation guard, #3 compute-impact-plan wrapper).

## [0.119.0] - 2026-06-27

### Cal #38.D — stays-general comment hygiene + regression meta-gate

The cal #38 arc field-tested against an external project ("greenfield-api"). An audit confirmed devt's *logic* was 100% general (zero field-project specifics in any executable path), but ~111 references to the field project's name + distinctive symbol names had accumulated in **comments** and **smoke-test fixtures** — cosmetic coupling that made the "is devt tailored to one project?" question harder to answer at a glance. This pass removes it and institutionalizes the [[devt-stays-general]] guardrail as CI.

**Decoupled across all product + CI surfaces:**
- **Production `.cjs` (26 refs across 7 modules)** — field-project provenance in comments genericized to "field-observed" / "a field project" / "field evidence"; field-specific symbol-name examples (`CallBackend`, `VicasaCallProvider`, `PScope`, `TestMappingExtractors`, …) replaced with generic placeholders (`PaymentService`, `BaseError`, …). The non-obvious *why* each comment documents is preserved; only the project-specific names + dates drop.
- **Workflows + agents (5 refs)** — "field-validated against greenfield-api" → "field-validated"; the generic-term "greenfield" (a fresh codebase with no existing patterns) in `research-task.md` is legitimate and kept.
- **smoke-test.sh (81 comment refs + 18 fixture symbols)** — calibration-provenance comments genericized; synthetic fixture symbol names renamed to generic ones (`CallBackend`→`PaymentService`, `TestMappingExtractors`→`TestWidgetMapper` keeping the `Test*` prefix K184 exercises, `PScope`→`AuthScope`, `external_calls`→`billing`) in lockstep with their assertions. Zero pass/fail strings touched.
- **README (2 refs)** — measurement-note provenance + the K184 fixture-name mention genericized.

**New meta-gate K194** — CI-enforces the guardrail: greps `bin/modules` + `workflows` + `agents` for the field project's name/path + three distinctive symbol names (pattern assembled from fragments so the gate can't self-trip). Any reintroduction fails the build. The generic-term "greenfield" is deliberately not matched. This converts the stays-general guardrail from a manual audit into a structural invariant — the same pattern as K155/K156 meta-gates.

**Drift-guard stack now 101-deep K94-K194.** Logic was already general; this pass makes the *whole source tree* reflect that, and K194 keeps it that way.

**Cal #38 complete** (A: symbolsInFiles overhaul, B: alarm-fatigue suppression, C: robustness trio, D: stays-general hygiene + meta-gate).

## [0.118.0] - 2026-06-27

### Cal #38.C — robustness trio (receipt #10 findings #3 + #6 + lane-stall)

Three independent robustness fixes from receipt #10.

**C1 — query_graph token fallback (finding #3).** `_resolveMany` substring-matches the WHOLE query string, so a multi-word phrase ("orchestration service TokenProvider") matched no single node label and returned empty — silently forcing a grep degrade, which made the `bulk_scoped` review tier weak. Added `_resolveManyTokens`: when whole-query match is empty, tokenize and resolve in two passes — token-AND (nodes containing every token, precise) then token-OR (nodes matching any token, ranked by token-match-count then degree, graceful — never empty when any token hits). Per greenfield's Q3 (AND-then-OR; OR-ranked is the floor that fixes the bulk_scoped path). `queryGraph` surfaces `resolution_mode` (`token_and` / `token_or`) telemetry so a reviewer sees the match was a fallback and how loose.

**C2 — disk preflight, warn-only (finding #6).** devt workflows are disk-heavy (`.devt/state/` + N parallel-lane transcripts at multiple MB each); greenfield hit `ENOSPC` at 132Mi when a Bash stdout-capture failed mid-lane. New `state disk-check` CLI (`df -Pk`, ~5ms) returns `{ok, status, free_mb}` where status is `ok` / `warn` (< 1 GiB free) / `unknown`. **Warn-only by design** — surfaced at the context_init preflight brief AND at pre-fan-out (`cmdRenderLanes::disk_warning`), but never blocks the workflow. This deliberately diverges from greenfield's Q6 (which proposed a hard-block < 200Mi): per the no-defensive-limits-for-low-risk principle, a low-disk signal is surfaced for the operator to act on, but user intervention is the failsafe, not a hard stop that overrides intent.

**C3 — incremental lane writes (greenfield's highest-value item, "more valuable than disk preflight").** Greenfield's Lane 6 ran 117 tool calls, wrote only its start-stub, then hit its budget wall before the single terminal write — losing all analysis. Extended the code-reviewer stub-first protocol with an explicit incremental-write directive: append each finding to the output file as you confirm it (Edit), rather than buffering every finding for one terminal write. A budget or disk wall then costs the last finding, not the whole analysis — the orchestrator gets a partially-populated, recoverable artifact. Makes lane work crash-safe regardless of *cause* (budget OR disk), which the disk preflight alone can't.

**Drift-guard stack now 100-deep K94-K193.** Smoke gate K193 asserts all three (token fallback resolution_mode, disk-check warn-only envelope, incremental-write directive presence).

**Cal #38 carryover**: #38.D (comment-hygiene per [[devt-stays-general]] — strip greenfield-api provenance refs + genericize comment-examples + smoke fixtures).

## [0.117.0] - 2026-06-27

### Cal #38.B — god-node alarm-fatigue suppression + edge-count staleness stamp (receipt #10 findings #4 + #5)

Receipt #10 finding #4: *"God-node warnings have alarm fatigue — PScope/AppError/UUID fire on nearly every PR. Needs a project ubiquitous-types suppression list."* Finding #5: *"Edge-count drift — cached preflight (AppError 893) vs live MCP (1074) disagree; pick one source of truth."*

**B1 — ubiquitous-type discrimination (alarm fatigue).** `blastRadius` no longer returns an opaque `god_node_match` boolean alone — it now itemizes `god_node_matches: [{symbol, ubiquitous}]` and a `discriminating_god_node_match` flag. The preflight god-node warning fires the ⚠️ only for a *discriminating* match (a non-ubiquitous god-node); a match on ubiquitous types alone downgrades to an `ℹ️` info note, killing the every-PR alarm fatigue.

The ubiquitous set is **auto-derived via degree-DOMINANCE**, not a flat top-K. A flat top-K can't work: the god-node match window is the top-10, so any flat top-K ≥ 10 would mark every match ubiquitous and suppress *all* warnings. Instead, of the top-10 god-nodes, those whose degree is ≥ `_UBIQUITOUS_DOMINANCE_FACTOR` (2) × the match-window floor degree are flagged ubiquitous — separating the fires-on-every-PR hubs from merely-high domain symbols. Fails safe: a flat degree distribution yields an empty set (no suppression → warnings still fire).

Greenfield's Q1a chose hybrid (auto + override). New `config.graphify.ubiquitous_types` knob: a plain name is FORCE-ADDED to suppression; a `!`-prefixed name is FORCE-KEPT (exempt — e.g. when a normally-ubiquitous type is itself being refactored, you want it back in the warning set). `effect_size` routing is **unchanged** (touching a hub is still structurally large) — only the warning surface is quieted, which is where the fatigue actually was.

This generalizes greenfield's "K=15 flat list" suggestion per the devt-stays-general guardrail: degree-dominance is the general mechanism that works against devt's actual top-10 match semantics, and it self-tunes as the graph grows (a hardcoded count rots — receipt #10 watched AppError move 893→1074 in a day).

**B2 — edge-count staleness stamp.** The cached-vs-live divergence (893 vs 1074) is temporal, not a computation bug: preflight already overlays live `godNodes()` (inc+out degree), but the cached sidecar value is from an earlier graph snapshot than a later live MCP read. `preflight-brief.json` now carries `god_nodes_built_at` (the commit the cached counts were computed against), so the divergence is diagnosable as staleness rather than a silent contradiction. Per greenfield's Q5: the absolute count doesn't change any decision ("high-degree, weight it") — what erodes trust is the unexplained contradiction.

**Drift-guard stack now 99-deep K94-K192.** Smoke gate K192 asserts the discrimination (dominant hub → suppressed info note; moderate god-node → ⚠️ fires; `!`-force-keep → re-fires) with a synthetic dominance-distribution graph.

**Cal #38 carryover**: #38.C (incremental lane writes + query_graph AND-then-OR fallback + disk preflight), #38.D (comment-hygiene per [[devt-stays-general]]).

## [0.116.0] - 2026-06-27

### Cal #38.A — symbolsInFiles signal-quality overhaul (receipt #10 root cause)

Receipt #10 (greenfield) reframed the entire improvement axis: *"the plumbing is now genuinely strong (gates/telemetry/consolidation are real assets) — the weakness moved upstream to signal quality at the input (symbol extraction)."* The headline bug: `blast_radius` was fed AppError/License/UUID (the top god-nodes) instead of the actually-changed providers (VicasaCallProvider, indexed at in_degree 33 but never extracted). Greenfield read the code and surfaced the root cause + two bugs neither of us had flagged.

**Three confirmed bugs in `symbolsInFiles` (graphify.cjs:1919):**
1. **Cross-module basename pollution** — matched by `path.basename(sf)`, so a changed `models.py` pulled symbols from *every* `models.py` across all services.
2. **Sort by `edge_count` DESC + cap** — god-nodes (1000+ edges) filled the limit, burying mid-degree changed symbols. Degree measures *ubiquity*, anti-correlated with discriminating signal.
3. **No dedup** — duplicate labels (EventBusDep twice).

**Fixes (generalized per the devt-stays-general guardrail — greenfield's project-specific suggestions adapted to devt's uncontrolled `source_file`/`source_location` formats):**

- **Segment-boundary full-path suffix match** (`_pathSuffixMatch`) — `a===b || a.endsWith('/'+b) || b.endsWith('/'+a)`. Kills cross-module pollution while tolerating graph-path rooting differences (repo-relative / absolute / package-relative). Greenfield's literal "exact full-path compare" would have broken matching on absolute-path graphs — the suffix match is the general fix.
- **Hunk-scoping** (`_changedHunkRanges` via `git diff -U0` + `_parseSourceLine` defensive parse) — keeps only symbols whose definition line falls in a changed hunk (±5 slack for decorators/multi-line sigs). God-nodes now appear *only when their own definition changed*. Graceful degradation: no baseRef / git failure → no scoping; unparseable `source_location` → keep the symbol (never drop a real target for a missing line). `source_location` parser handles `"L33"` / `"33"` / `33` / `{line}` / `{start_line}` / nested — devt doesn't control graphify's emit format.
- **Dedup** by symbol label across graph-results + diff-hunk-fallback.
- **Q2 caveat reconciliation** (`computeGraphifyImpactPlan`) — the "N files not indexed" caveat now reconciles the added-file list against the actual `matched_files` the extractor returned, instead of a blind `git diff --diff-filter=A` count. Receipt #10 proved the static count overstated ~37× (37/38 added .py files were indexed at HEAD; only an ignore-patterned migration was genuinely absent).
- **Cap bump 10→25** on the review path (with hunk-scoping shrinking the candidate set, the cap rarely binds, but protects against truncation when a large changed set survives).
- **Telemetry** (`hunk_scoped`, `hunk_filtered`, `matched_files`) surfaced per [[telemetry-on-reduction]].

**Validated end-to-end** with real git-diff fixtures: AppError defined at L9, change at L1-2 → AppError dropped, changed Foo survives; cross-module agenda/models.py Foo excluded; EventBusDep deduped; caveat reconciles to "1 of 2" not "2 of 2."

**Drift-guard stack now 98-deep K94-K191.** Smoke gate K191 asserts all three (full-path / dedup / hunk-scoping) with a real git repo fixture.

**Cal #38 carryover** (next sessions): #38.B (shared auto-derived god-node stoplist for warnings + new-file fallback + unified inc+out degree source), #38.C (incremental lane writes + query_graph AND-then-OR fallback + disk preflight), #38.D (comment-hygiene: strip greenfield-api provenance refs + genericize comment-examples + smoke fixtures, per [[devt-stays-general]] + [[feedback-no-version-refs-in-code]]).

## [0.115.0] - 2026-06-26

### Cal #37 #3 — devt state compute-impact-plan wrapper CLI

Receipt #9 Q2(c) framing: the graphify impact-plan tier-decision was inlined as ~115 lines of fragile bash in `workflows/code-review.md` substep 5. Receipt user described this as "the 1,152-line file is the biggest mis-execution risk" with "lots of defensive code for rare cases." New `state compute-impact-plan --scope=<text> [--primary-branch=<ref>]` CLI collapses it into a single JSON-returning call.

**What moved into the CLI** (state.cjs::computeGraphifyImpactPlan):
- Provider + PR# extraction from REVIEW_SCOPE
- Graphify state + trust reads from `preflight-brief.json`
- `topic.symbols` pre-truncation to TOPIC_CAP=32 + dropped-list sidecar write/cleanup
- Scope file count + impact threshold reads
- 7-branch tier-decision tree (skip / pr_scoped / pr_scoped_diff / symbol_anchored ×3 / bulk_scoped)
- Diff-symbol extraction via `git diff <primary>...HEAD` + `graphify symbolsInFiles`
- New-files-count for `pr_diff_caveat` surface
- Output JSON to `.devt/state/graphify-impact-plan.json`

**What deliberately stayed in workflow** (architecturally cannot move — per receipt #9 Q2 evidence):
- Substeps 0 + 4 AskUserQuestion gates (CLIs cannot prompt)
- Substep 6 MCP `blast_radius` / `get_neighbors` execution (CLIs cannot reach `mcp__*` tools)
- Substep 0 conditional reset-soft (needs operator-mediated decision)

**Workflow surface reduction**: `workflows/code-review.md` 1152 → 1064 lines (−88 lines, −7.6%). Substep 5 collapsed from ~115 lines of inline bash to ~15 lines + a tier-decision table for orchestrator-visible semantics. The output JSON contract is preserved verbatim so downstream substeps (6 EXECUTE-THE-PLAN, 7 god-node check that consumes `topic-symbols-dropped.json`) unchanged.

**6 smoke gates migrated** to verify the CLI tier-decision semantics instead of the obsolete inline bash:
- K174 (pr_scoped_diff branch presence) → checks state.cjs
- F41a (TOPIC_CAP=32 pre-truncation) → checks state.cjs
- M12 (topic-symbols-dropped capture) → checks state.cjs unlinkSync + workflow header
- K89 (symbolsInFiles envelope consumer) → checks state.cjs::computeGraphifyImpactPlan
- Bitbucket-aware provider branch → checks state.cjs `gitProvider === "github"` / `!== "github"`
- Tier-order regression (symbol_anchored before bulk_scoped) → checks state.cjs branch order

**New smoke gate K190**: 3-scenario tier-decision (not_ready → skip / GitHub PR → pr_scoped / topic.symbols → symbol_anchored) + dropped-sidecar emission test (40 symbols > 32 cap → file written).

**Drift-guard stack now 97-deep K94-K190.** CLAUDE.md + README updated.

**Cal #37 carryover** (deferred to next session):
- **Cal #37 #2** (~5-7hr architectural) — lane tool-surface deny-list for workflow.yaml writes. Now unblocked by cal #37 #1 audit log (v0.114.0) — when subagent concurrency rotation recurs, the audit log says exactly which CLI rotated the id. Ready to scope when next on-rail receipt confirms cal #37 #1+#3 didn't introduce regressions.

## [0.114.0] - 2026-06-26

### Cal #37 #1 — workflow_id rotation audit log (prerequisite for lane deny-list)

Receipt #9 Q1 evidence: 8 parallel subagents rotated `workflow_id` mid-run (1f871314 → f67240bb) with no audit trail. Receipt user could only narrow the source to "lifecycle write surface, not status" at 70% confidence — "no rotation-audit record (nothing logs who rotated workflow_id, when, via which command). That absence is itself a finding." Receipt user explicitly asked this 1hr fix to ship FIRST before the architectural lane tool-surface deny-list (cal #37 #2) so the future debugging is "100% diagnosable."

**Fix**: new `_logWorkflowIdRotation({prev_id, new_id, source})` helper in `state.cjs` appends one JSONL line per mutation to `.devt/state/workflow-id-rotations.jsonl`. Each entry carries `ts`, `prev_id`, `new_id`, `source`, `pid`, `argv` (capped to first 5 argv segments). RESET_EXEMPT — survives `resetSoft` precisely because rotations BY resetSoft are themselves the events being audited.

Wired into 4 rotation sites:
- `updateState:first_activation` (state.cjs ~L1027 — workflow_id created lazily on first state-update)
- `updateState:type_transition` (state.cjs ~L1043 — workflow_type change while active)
- `resetSoft` (state.cjs ~L1471 — surgical reset for new-review-against-stale)
- `initWorkflow:strip_closed_workflow` (init.cjs — pre-strip log so the strip-and-restamp pattern doesn't show as `prev_id: null` in the eventual updateState entry; preserves attribution across the boundary)

NOT wired: `newInstance` (creates an isolated subdir for multi-instance work, not a rotation in the conventional sense — there's no prev_id to compare against; logging it would clutter the trace with non-rotation events).

**Carryover for next session** (cal #37 #2 + #3 deferred per scope discipline):
- **Cal #37 #2 — lane tool-surface deny-list** (~5-7hr architectural): deny lane agents init/reset-soft/auto-reset-if-stale/any workflow.yaml mutation; status updates only via `state update-lane`; stamp workflow_id into lane envelopes as immutable. NOW unblocked — when the bug recurs after #2 ships, the audit log says exactly which subagent + CLI rotated the id.
- **Cal #37 #3 — `devt review-context-init` wrapper CLI** (~3-4hr): sequences pure-bash work (staleness tier + memory_signal cache + scope-cache + god-node sidecar + impact-plan + claude-mem skip-decision) into one JSON-returning CLI. Removes ~80% of code-review.md's 1,152-line orchestration surface per receipt #9.

**Drift-guard stack now 96-deep K94-K189.** CLAUDE.md + README updated.

**Smoke gate**: K189 (synthetic: `state update + state reset-soft` → 2 audit lines captured with first_activation + resetSoft sources + pid telemetry; RESET_EXEMPT preserves log across the reset).

## [0.113.0] - 2026-06-26

### Cal #36 — Receipt #9 tactical fixes (6 items)

Receipt #9 (greenfield, 2026-06-26) was an on-rail review run that delivered the most positive calibration yet (graphify A−, devt workflow B+) AND surfaced 6 ranked tactical fixes. Receipt user followed up with precise Q1+Q2+Q3 answers locking design forks. All 6 ship under [[telemetry-on-reduction]] discipline.

**#1 — Test-class god-node filter** (`bin/modules/graphify.cjs::godNodes`). Extends `_topByDegree` filter pipeline to strip `^Test[A-Z]` symbol-prefix + test-path source files. Receipt evidence: TestMappingExtractors ranked top-12 with 591 edges, polluting the constitutional-abstraction list reviewers consult. Over-fetches 3× before filter so post-filter `limit` still hits target. Reuses existing `_isTestPathNode` helper (no duplication).

**#2 — mcp-stats --workflow-id default-strict** (`bin/modules/mcp-stats.cjs`). Reverses cal #32 #4 default: `--workflow-id` alone is now STRICT (current-wid only); `--include-chain` opts INTO the workflow_id_history union. Receipt evidence: greenfield observed default behavior over-counted (27 calls vs ~4 actual) because operators reach for `--workflow-id` expecting per-run scope. `--strict-wid` retained as deprecated alias matching default (preserves K170 fixture). K170 + M9 + N8 migrated to `--include-chain` opt-in.

**#3 — Verifier substance check** (`bin/modules/state.cjs::assertVerifierRan`). Existing existence+freshness gate accepted a synthetic `verification.json` with only `{"status":"DONE"}`. Receipt evidence: greenfield wrote one and the gate passed. New substance check: sidecar must carry verdict/findings/revisions/axes/criteria_total in non-empty form OR markdown must be ≥600 substance-bytes (frontmatter + stub-marker lines stripped). Same [[CON-001]] form-vs-substance failure mode the verifier exists to prevent at the agent layer.

**#4 — DI-aware drill-down fallback** (`bin/modules/graphify.cjs::composeDrilldowns`). When `getNeighbors(X, direction)` returns 0 results AND filter telemetry shows `filtered_di_aggregation > 0`, the new `_findDIFactorySiteHint` re-walks the BFS visited set to identify the DI-pattern source_file with the most edges. Emits `_(no direct neighbors found in direction=X; DI factory site: <path> (+N DI-wired edges))_` instead of bare "empty". Defensive fallback for the rare case where cal #31.B G1 collapse doesn't preserve a representative (heterogeneous DI edges, sub-threshold counts).

**#5 — register-lanes envelope auto_memory injection** (`bin/modules/dispatch.cjs::cmdRenderLanes`). Receipt evidence: G2 laneH populated 8 auto_memory entries in preflight-brief.json but hand-rolled `register-lanes` + ad-hoc Agent() dispatches dropped them; only the cmdRenderFilled base envelope path inherited `{auto_memory_json}` substitution. New `<auto_memory>` lane-context block injected with top-N "name (type, score)" summary so the bridge's output reaches each lane regardless of how operators customize prose. Falls back to no-emit when laneH found no matches.

**#6 — laneG FTS under-retrieval** (`bin/modules/preflight.cjs::laneG`). Receipt evidence: bare `cfg.git.provider` token under-retrieved CON-002 (bitbucket-pr-scoped-tier-unavailable) + REJ-002 (graphify-god-node-mechanical-con-proposals) on a Bitbucket+graphify review even though both docs were squarely relevant. New optional `topic` param expands the FTS query token set with `topic.domains` so domain-relevant CON/REJ docs surface when the project-context token alone misses them. `generate()` updated to pass topic through.

**Drift-guard stack now 95-deep K94-K188.** CLAUDE.md + README updated.

**Smoke gates**: K184 (#1 godNodes test-class filter), K185 (#3 verifier substance check on synthetic vs graded bodies), K186 (#4 DI-aware fallback function present), K187 (#5 cmdRenderLanes auto_memory block injection), K188 (#6 laneG topic param wired). K170 + M9 + N8 updated for #2's reversed default. Total 933 smoke + 3/3 locking + 37/37 graphify.

**Receipt-#9 carryover to cal #37** (architectural, separate scoping): workflow_id rotation audit log (~1hr prerequisite) → lane tool-surface deny-list for workflow.yaml writes (~5-7hr) → `devt review-context-init` wrapper CLI (~3-4hr). Plus Q1 upstream graphify DI-edges filing (user action).

## [0.112.0] - 2026-06-26

### Cal #35.A — Historical-attribution comment strip (R1 only)

Slim-down pass on the K156-K183 smoke-gate preambles + cal #31-#34 state.cjs function header comments. Strips `cal #N` / `receipt #N` / `Wave X` / `G[0-9]+` attribution sentences from comment bodies while preserving WHY rationale, K-gate IDs, assertion shape, ADR references, and load-bearing technical context. Receipt #9 cited the "receipt #N cal #M" calibration history embedded in workflow + module bodies as both token-heavy and hard to execute correctly.

**Files**: `scripts/smoke-test.sh` (-29 lines, 14,665 → 14,636); `bin/modules/state.cjs` (-32 lines, 6,325 → 6,293). Combined -61 lines (~0.3% of the 21K combined).

**Scope discipline**: Limited to cal #31-#34 K-gates (K156-K183) + cal #31-#34 state.cjs function headers I added this session. Older comments (cal #1-#28 K-gates + older state.cjs functions) NOT touched — preserving context where I lack the confidence to draw the slim-down line safely. The author's own `feedback_no_version_refs_in_code` rule justifies the deletions; CHANGELOG + git history retain provenance.

**Scope dropped from initial plan**:
- R2 (collapse older verbose K-gate preambles): older K-gates outside cal #31-#34 range touch code I don't fully own; risk of context loss exceeded value
- R3 (hoist nosemgrep comments to file-level): requires semgrep scanner-syntax verification I can't perform
- K184 (anti-regression gate forbidding `cal #N` in comments): would itself flag the 40 remaining older-K-gate patterns I deliberately left; overkill for the value

**Smoke**: 928 passed, 0 failed (unchanged). Locking 3/3 + graphify 37/37.

**Cal #36 + #37 scoped from receipt #9 follow-up** (carryover): 4 tactical fixes (test-class god-node filter, DI-aware drill-down, mcp-stats default-strict, verifier substance check) + 2 dispatch-side fixes from Q3 (envelope auto_memory injection on register-lanes path, laneG FTS under-retrieval). Plus cal #37 architectural (workflow_id rotation audit log → lane tool-surface deny-list → review-context-init wrapper CLI).

## [0.111.0] - 2026-06-25

### Cal #34 — Receipt #8 on-rail validation + 4 evidence-driven refinements

Receipt #8 (greenfield, 2026-06-25) was the first on-rail review run — substep 6's drill phase actually executed end-to-end. Headline: "the devt↔graphify integration is real, well-architected at the orchestration layer, and measurably improved this review's calibration and scoping." Cal #31.C G2 laneH validated as preventing false positives; cal #33.A Rank #2 `pr_scoped_diff` Bitbucket tier validated as data-flowing through 8 lane prompts; cal #33.A Rank #1 graphify-roi correctly returned `no_drills_executed` per receipt-#7-required confound-safe design. Receipt #8 part 2 also ran the drill phase + measured 100% wasted_drill_rate that decomposed into 3 distinct causes — surfaced 4 actionable improvements.

**Standing design principle captured to memory** (`[[telemetry-on-reduction]]`): when a tool filters / scores / reduces, never let the reduction be silent. Receipt #8 evidence: 100% wasted_drill_rate was 2/3 real-empty + 1/3 measurement-artifact + parser-bug-silenced suffix-variant headings. Single-number aggregates HIDE which lever to pull. All 4 cal #34 fixes embody this principle.

**#1 — Stale-threshold tiered policy** (`bin/modules/config.cjs` + `workflows/code-review.md`). Per receipt #8 Q4 with explicit thresholds + tier shape: `graphify.stale_threshold` default lowered 30→10 ("30 commits of drift is a lot of wrong caller-sets... 10 ≈ a sprint's drift, the point where blast-radius reliability degrades enough to matter"). Tiered policy: `lag==0` noop / `0<lag<threshold` silent-warn band emits one-line stderr + sets `scope_trust.fresh=false` (no prompt) / `lag>=threshold` AskUserQuestion. New `--no-refresh` / `--stale-ok` operator escape hatch for emergency-review-on-known-broken-graph cases (forces `scope_trust.trust="sparse"` + skips gate). Auto-fire latency budget (28.5s for `--no-cluster` rebuild per Q3b benchmark) kept policy AskUserQuestion-gated rather than always-silent-refresh.

**#5b — blastRadius noise filter (b)+(c)** (`bin/modules/graphify.cjs::blastRadius`). Per receipt #8 Q7 with semantics call: extends G1 (DI-aggregation collapse) + F2 (test-path filter) to BOTH `direct_dependents` AND `indirect_dependents`. Receipt: direct had `Depends`/`Select`/`Page`/`get_*_repository` framework + DI noise; indirect had `MagicMock`/`AsyncMock`/`test_*` fixtures. New `noise_telemetry` field (`filtered_noise` + `filtered_test_path` + `filtered_di_aggregation`) mirrors `getNeighbors` pattern. CRITICAL semantics: `effect_size` + `modules_touched` size on POST-filter counts (real dependents drive tier-routing, not test mock inflation) AND `raw_direct_count` + `raw_indirect_count` surface in telemetry so the shrink is auditable + doesn't silently re-route tiers. G1's collapse-don't-drop semantics preserved (DI patterns keep 1/N representative); F2 genuinely drops with telemetry.

**#3 — ROI parser refinement** (`bin/modules/state.cjs::graphifyRoi`). Per receipt #8 Q6(c) with refinements: 3-state per-drill `citation` (strong = corr_id / weak = symbol-name code-identifier / none); separate `yielded_data: bool` distinguishes drill-returned-empty (canonical empty marker / `results: []`) from drill-returned-data-but-uncited — different waste classes demanding different fixes. Dual rate surface (`wasted_drill_rate` strict / `wasted_drill_rate_weak` permissive) — the DELTA between them IS the diagnostic ("strict 100% / weak 67% reads as 'drills aren't useless, citation plumbing is broken'"). Weak-citation regex requires code-identifier match (backtick-wrapped OR CamelCase token with non-identifier/non-path boundaries) so file-path mentions don't false-positive. **Also fixes the receipt-#8-evidenced parser bug**: prior strict `\s*$` anchor caused suffix-variant headings (e.g. `[in, depth2]`) to silently fail-parse; lenient parser now accepts any heading starting with `## Drill-down: <symbol>` and emits `parse_failed_lines` telemetry for harder malformed cases.

**#6 — Counter-log rotation on workflow_id rotation** (`bin/modules/init.cjs::initWorkflow`). Per receipt #8 Q5(c) "cheap version": when initWorkflow detects a closed prior workflow (`active: false`) and rotates workflow_id, archive `dispatch-warnings.jsonl` + `claim-check-failures.jsonl` to timestamped sidecars. Mirror's resetSoft's existing rotation mechanism. Closes the cal #31.D `auto-reset-if-stale` 3-condition gap (task_changed AND age>24h AND workflow_type_changed) for same-day workflow churn — block-mode users no longer get false-fire KILL gates on accumulated prior-workflow counters. Receipt #8: gap is currently masked by `dispatch_hygiene_mode=warn` on this project; #6 becomes load-bearing the moment block-mode is restored.

**Drift-guard stack now 90-deep K94-K183.** CLAUDE.md + README updated.

**Smoke gates**: K180 (#1 — config default = 10 + tiered policy markers in code-review.md), K181 (#5b — synthetic 10-node fixture: filtered_test_path=1 + filtered_di_aggregation=7 + raw_direct_count=10), K182 (#3 — receipt #8 scenario reconstruction: 3 drills with CallBackend cited-by-name → strict=1.0 / weak=0.667 / cb_citation=weak / yielded_data=false), K183 (#6 — closed prior workflow + 2 counter logs → init rotates both to archive sidecars). PLUS staleness-gate smoke regression updated to validate the new tiered contract.

**Strategic framing per [[mechanism-firing-neq-value-conversion]]** (post receipt #8 sharpening): the pattern stands ("K-gates measure mechanism execution; receipts measure outcome value"), but receipt #8 RESOLVED the specific cal #31 verdict that was based on confounded off-rail receipts #6+#7. cal #31 mechanisms DO convert to value on-rail — laneH G2 prevented false positives, pr_scoped_diff data flowed end-to-end. Cal #34 ships per the on-rail receipt evidence with [[telemetry-on-reduction]] discipline encoded throughout.

**Carryover**: Receipt #8 #1 (phantom-deletion bug in detect_incremental) + #2 (safe-modes-default) are graphify-upstream; receipt user is fixing those. Q1 DI-edges upstream filing still pending. Cal #34 implementation closes all 4 ranked devt-side findings from receipt #8.

## [0.110.0] - 2026-06-25

### Cal #33.B — Receipt #7 ergonomics + defensive correctness (4 fixes)

Held cal #33.B items from receipt #7, shipped after cal #33.A landed the measurement infrastructure. Per receipt #7 framing + [[mechanism-firing-neq-value-conversion]] discipline: cal #33.B ships for correctness + friction reduction, NOT value lift. Cal #33.A's `graphify-roi` CLI is the measurement that will distinguish whether any of cal #31-#33 actually moves the workflow-outcome needle on the next on-rail receipt.

**B-1 — `graphify freshness()` unverifiable-freshness defensive surface** (`bin/modules/graphify.cjs::freshness`). Receipt #7 finding #2: observed `built_at_commit: null` while `lag_commits: 0` — "staleness gate trusting a freshness it can't confirm." When `graph.json` lacks the `built_at_commit` anchor, freshness now returns `unverifiable_freshness: true` + reason text explicitly stating staleness cannot be verified against HEAD. Distinct from `fresh: false` (meaning "we verified it's not fresh") — `unverifiable_freshness` means "we cannot verify either way." Downstream staleness gates can refuse to trust the freshness verdict OR emit operator banners.

**B-2 — `suggested_reading` split into `{files, symbols}` object** (`bin/modules/preflight.cjs`). Receipt #7 #5: previously flat-array shape mixed navigable file paths (from governing-doc `affects_paths` + wiki) with bare symbol labels (from `blast.direct_dependents` — which graphify.cjs:740 documents as "labels/ids, NOT paths"). Reviewers couldn't tell which entries to open vs query. The brief now renders two distinct sections (`**Files** (open these)` / `**Symbols** (drill via graphify get-neighbors when needed)`); sidecar emits `suggested_reading.{files, symbols}` (object, not array); internal consumers updated (`scopeCache` reads `.files` for scope_hint, `reuse-search` reads `.files` for expected_paths). Per-bucket dedupeCap prevents symbol overflow from crowding out paths and vice versa.

**B-3 — `scope_check` operator-explicit short-circuit** (`workflows/code-review.md`). Receipt #7 Q1: "your prompt explicitly said 'split between multiple agents for parallel.' Asking would re-ask an answered question. Clean (iii)." Pre-AskUserQuestion regex detects parallel-intent (`parallel|split (across|between|into) (multiple|several)|per-lane|fan[ -]out|multiple agents|community lanes`) OR single-intent (`single (dispatch|agent|reviewer)|no parallel|no fan[ -]out`) in `REVIEW_SCOPE` text. When matched, auto-writes the answer to `scope-check-answer.txt` + skips the AskUserQuestion + logs the short-circuit. Falls through to the standard AskUserQuestion when no intent keywords present.

**B-4 — `state mark-claude-mem-skipped` CLI helper** (`bin/modules/state.cjs`). Receipt #7 Q1(c): claude-mem harvest is `(iii)-conditional-on-session-state` — when session memory already covers scope (operator just reviewed the same PR 5x), marginal harvest value ≈ 0. The `assert-claude-mem-harvest` gate already accepted `claude-mem-skipped.txt` as a satisfying marker — this CLI surfaces that escape valve discoverably AND ensures gate-compliant content shape (`reason=<not_installed|mcp_unavailable|corpus_empty|task_unrelated_to_history>` + `details=` line for `task_unrelated_to_history`). Default `--reason=task_unrelated_to_history` + auto-fills sensible `--details="session memory already covers scope (operator-declared)"`. Rejects invalid `--reason` values so operators don't silently produce gate-rejected output.

**Drift-guard stack now 86-deep K94-K179.** CLAUDE.md + README updated.

**Smoke gates**: K176 (B-1 — synthetic graph.json without built_at_commit → freshness returns `unverifiable_freshness=true` + `lag_commits=null`), K177 (B-2 — preflight-brief.json::suggested_reading is `{files, symbols}` object with both Arrays), K178 (B-3 — code-review.md scope_check contains `SCOPE_CHECK_DECISION="parallel"` short-circuit marker), K179 (B-4 — valid reason writes gate-compliant content + assertion passes; invalid reason rejected). PLUS: pre-existing `preflight-brief.json shape validation` smoke test updated to expect the new `{files, symbols}` shape.

**Strategic framing per [[mechanism-firing-neq-value-conversion]]**: cal #33.B fixes ergonomics + correctness gaps. None of these move the value-rating needle — receipt #7 was explicit that code-review value stays DI-capped at ~6.5/10 until Q1 (DI-aware graphify extraction) lands upstream. Cal #33.A's `graphify-roi` CLI is the falsifiable measurement that will distinguish whether on-rail receipt #8 sees ANY change.

**Carryover**: Q1 upstream graphify filing remains the only known fix that addresses the actual code-review value bottleneck per receipts #6 + #7. Cal #33.A + #33.B close the receipt-evidenced devt-side gaps; further devt-side iteration without on-rail measurement risks more confounded-data scoping.

## [0.109.0] - 2026-06-25

### Cal #33.A — Receipt #7 measurement-first + Bitbucket-lift + ghost-dedup (3 ranked fixes)

Receipt #7 (greenfield 2026-06-25 follow-up) delivered the most important calibration in the entire receipt arc: the receipt user self-corrected that BOTH receipts #6 and #7 measurements came from off-rail hand-rolled review runs where substep 6 (drill-down execution) was never run, making the "graph drove zero findings" / "6.5/10 score" claims hypothesis-not-finding. The explicit recommendation: ship measurement infrastructure FIRST, then wait for an on-rail receipt to actually measure outcome value.

Cal #33.A follows that prescription — ships the 3 highest-leverage devt-side fixes from receipt #7 with measurement-first ordering. NO value-lift predictions per the [[mechanism-firing-neq-value-conversion]] discipline; cal #33.A enables future measurement (Rank #1), opens a previously-locked tier path (Rank #2), and hardens collision-detection signal quality (Rank #3).

**Rank #1 — Graphify ROI telemetry (`state graphify-roi`)** (`bin/modules/state.cjs`). New CLI computes the wasted-drill rate (drills with no `review.md` citation / executed drills) by parsing `graph-impact.md`'s `## Drill-down: <SYM>` sections + extracting per-drill correlation_ids from heading `[call: <8hex>]` suffix and body, then scanning `review.md` for both `(via call: <id>)` and `[via call: <id>]` citation formats (per dispatch.cjs::provenanceProtocol contract). CRITICAL exclusion per receipt user's explicit caveat: when `graph-impact.md` is absent OR contains 0 drill sections, returns `status="no_drills_executed"` + `wasted_drill_rate=null` (NOT 100%). Runs that skip substep 6 are not punished as "100% waste" — that would punish graphify for the operator's skip. Output includes per-drill citation map so cal #34+ levers ("drop drills in direction X if waste >70%") can read structured input.

**Rank #2 — Bitbucket / non-GitHub PR-scoped tier (`pr_scoped_diff`)** (`workflows/code-review.md`). Receipt #7: "permanently gets the coarser fallback" because the upstream `mcp__graphify__get_pr_impact` tool is GitHub-only. New tier branch activates when `PR_NUM` is set AND `GIT_PROVIDER != "github"`. Wires `git diff <primary>...HEAD → graphify symbols-in-files → blast_radius`. As-built (no rebuild needed); G5 (cal #31.B) diff-hunk fallback already extracts symbols from new files via regex. Emits per-run caveat: `"N of M files are new — symbols extracted via diff-hunk fallback but blast_radius edge data unavailable until 'graphify update .' rebuild"` so reviewers know which symbols have partial caller-analysis coverage. Reads `git.primary_branch` from existing config; uses established triple-dot merge-base pattern; no new config knobs.

**Rank #3 — Ghost-node defensive filter + visible counter** (`bin/modules/graphify.cjs::getSymbolCollisions`). Receipt #7: collision data on PushNotifier/OutboundInitiator was polluted by empty-source_file ghosts + null-location duplicate VicasaCallProvider entries (AST↔semantic canonical-ID merge artifacts). Reviewer "can't tell a real 6-way collision from a merge artifact." Defense-in-depth: filter nodes where BOTH `source_file` is empty AND `source_location` is null (pure ghosts); preserve nodes with location-but-no-file (real binding, unparseable path). Emits `ghost_nodes_filtered` counter when non-zero so the upstream fix motivation stays visible — receipt user explicitly required `(c)-with-counter NOT (c)-silent` to prevent rug-sweeping the upstream bug.

**Drift-guard stack now 82-deep K94-K175.** CLAUDE.md + README updated.

**Smoke gates**: K173 (graphify-roi: 3-scenario coverage — no_drills_executed/null rate, no_review_yet, measured with 2/3 citations = 33% wasted), K174 (pr_scoped_diff tier branch in code-review.md), K175 (collision projection filters 2 pure ghosts + preserves 1 partial-ghost + emits counter).

**Strategic framing per receipt #7's explicit recommendation:** cal #33.A is the measurement-and-foundation cal. Cal #33.B (ergonomics: Q1-(iii) scope_check short-circuit, claude-mem session-saturated bypass, suggested_reading split, built_at_commit consistency check) is HELD until an on-rail receipt #8 provides actual measurement of wasted-drill rate + finding citations. The discipline: stop iterating on confounded data; let the measurement infrastructure produce the next signal.

**Carryover for cal #33.B (held)**: 4 ergonomics fixes from receipt #7 — wait for on-rail receipt #8 before committing to scope. **Q1 upstream graphify filing** still pending (DI/dispatch edges) — only fix that addresses the actual code-review value bottleneck per receipt #6 evidence (still holds even with #7 confound caveat).

## [0.108.1] - 2026-06-25

### Cal #32.A — Hyperedge rationale projection leakage (1 receipt-evidenced fix)

Greenfield session (2026-06-25, late) observed that hyperedge rationale was durable in `graph.json::hyperedges[].rationale` but invisible to standard graphify query paths (DFS/BFS CLI, MCP `query_graph`, `get_node` — none traverse the hyperedges array). Devt's `getHyperedgesContaining` reads the array directly (bypassing the limitation correctly) but was silently dropping the `rationale` field at projection — capturing `id`, `label`, `member_count`, `members`, `members_in_scope`, `completeness`, `confidence`, `confidence_score`, `source_file`, `relation` but NOT `rationale`.

**Fix** (`bin/modules/graphify.cjs::getHyperedgesContaining`): add `rationale: h.rationale || null` to the matches projection. Flows through automatically to `hyperedges_matched[]` in preflight-brief.json sidecar → envelope consumers see WHY N files belong together (e.g., "two threat models, one genuine re-guard — both layers required for defense in depth") without further changes.

**Graphify-upstream item carried forward**: receipt suggested encoding hyperedge rationale as `rationale_for` edges from each participant node to a rationale node, which standard graphify traversal already prints. That's an upstream design change — devt's projection fix here is independent and doesn't require it.

**Drift-guard stack now 79-deep K94-K172.** CLAUDE.md + README updated.

**Smoke gate**: K172 (synthetic hyperedge with rationale → `getHyperedgesContaining` result includes rationale field — prevents future projection-leakage of newly-added hyperedge fields).

## [0.108.0] - 2026-06-25

### Cal #32 — Receipt #6 correctness + closing-loop fixes (4 ranked + G3 strengthening)

Receipt #6 (greenfield, 2026-06-25) ran the first full validation of cal #31.B+C+D and surfaced 4 new devt-side findings PLUS a critical G3 self-correction (cal #31 demotion didn't prevent backfill because cap had headroom). Cal #32 ships per the receipt's ranked priority table — framed as correctness + closing loose ends, NOT value lift (Q1 upstream graphify DI-edges remains the only fix that demonstrably touches the bottleneck).

**Rank #1 — `reset-soft` artifact eviction + consolidator cid-keying defense** (`bin/modules/state.cjs` + `workflows/code-review-parallel.md`). Highest correctness hazard: receipt evidence shows stale `review-lane-*.md` files from a rotated workflow (`cid_68768a3d`) nearly merged into the fresh report's consolidation; manual cid+mtime discipline was the only defense. Two-layer fix:

- **(b) Eviction**: `RESET_SOFT_EVICT_PATTERNS` adds `review.{md,json}` + `review-lane-*.{md,json}` to reset-soft's clear list. Phase artifacts (`impl-summary.md` / `test-summary.md` / `graph-impact.md`) preserved intact — they legitimately span review re-runs.
- **(c) cid-keying**: `state list-lane-outputs` emits per-lane `cid_match` field (`current` / `foreign` / `absent`) by extracting `cid_<8hex>` pattern from the first 2KB of each review file body and comparing to current `workflow_id` prefix. Consolidator workflow filters `select(.cid_match != "foreign")` to defend against eviction misses. `"absent"` preserves backward-compat with pre-F6 legacy files.

**Rank #2 — Wire `auto_memory` into dispatch envelope template** (`bin/modules/dispatch.cjs` + `templates/dispatch/envelopes/code-reviewer-code_review.tmpl.md` + `workflows/code-review-parallel.md`). Cal #31.C/G2 shipped `laneH` which populates `auto_memory: [...]` in preflight-brief.json sidecar with 8+ entries from auto-memory dir + claude-mem-harvest. But the envelope never referenced the field — lanes received it only redundantly via claude-mem harvest. This closes the structural gap: dispatch reads `auto_memory` from preflight-brief.json (best-effort; empty array on missing brief), surfaces it as `<auto_memory>{auto_memory_json}</auto_memory>` block alongside `<memory_signal>`.

**Rank #3 — Substance gate honors canonical empty marker** (`bin/modules/state.cjs::assertGraphifyDecision`). Receipt: gate forced operator to pad a legitimately-empty drill-down section (`OAuthTokenService` had 0 callers due to FastAPI DI blindness — not a skipped step). G7's `compose-drilldowns` already emits canonical marker `_(no neighbors found in direction=in)_`. New `EMPTY_MARKER_RE` exempts sections containing the marker from the 200-byte substance check. Distinct from TRUNCATION_MARKER_RE (which exempts saved-to-file truncation cases).

**Rank #4 — `mcp-stats --strict-wid` scope-to-current-wid flag** (`bin/modules/mcp-stats.cjs`). Receipt: workflow's present_findings "Graphify activity" surface reported 27 calls cumulative since Jun 9 (full history chain union back to first reset-soft) instead of ~4 (current run). Union-by-design × unbounded reset-soft chain creates "every chained session" semantic when "what did this run actually do" is wanted. New `--strict-wid` flag suppresses the history chain union, returning current-wid-only stats. Default behavior preserved for token-report + debug forensics consumers.

**G3 strengthening — pre-cap EXCLUSION when real-symbol count ≥ FLOOR** (`bin/modules/preflight.cjs::extractTopic`). Receipt #6 Q1 correction: cal #31.B G3 demotion-to-end was non-binding when cap (32) had headroom — config symbols (Settings, *Config, *Backend, Environment, etc.) backfilled and inflated blast_radius effect_size by ~30 phantom modules. Real harm wasn't budget-crowding (no real symbol displaced) — it was effect_size inflation. New behavior: when `nonConfig.length >= 10` (FLOOR), drop `config_demoted` entirely. When sparse < 10, keep backfill behavior. New `config_demoted_excluded` telemetry field surfaces which mode fired.

**Drift-guard stack now 78-deep K94-K171.** CLAUDE.md + README updated.

**Smoke gates**: K166 (reset-soft eviction matrix — 5 evicted, 3 preserved), K167 (cid_match classification: current/foreign/absent), K168 (auto_memory propagated from brief to envelope), K169 (substance gate exempts empty marker — 0 thin with marker, 3 thin without), K170 (--strict-wid scopes to current wid — default 5, strict 2), K171 (G3 exclusion when ≥10 real symbols vs backfill when sparse).

**Strategic framing per [[mechanism-firing-neq-value-conversion]]**: cal #32 ships for correctness + closing G2/G3 loops, NOT for value lift. Receipt #6 made the framing explicit: code-review value stays DI-capped at ~6.5/10 until Q1 (DI-aware graphify extraction) lands upstream. K-gates here measure mechanism execution; outcome lift requires DI extraction or different architectural lever.

**Remaining**: Q1 upstream graphify filing (DI/dispatch edges — non-devt code).

## [0.107.0] - 2026-06-25

### Cal #31.D — Setup-friction ergonomics (3 fixes)

Three devt-side fixes from receipt #5 Q2/Q7 targeting setup friction (12-14 CLI round-trips before Wave 1 dispatch) + orchestrator-discipline failure modes (drill-down step easy to forget).

**G4 — Auto-staleness-reset + `/devt:review --fresh` flag** (`bin/modules/state.cjs` + `workflows/code-review.md`). Receipt #5 Q2: KILL gates fired on accumulated raw_dispatch/claim-check counters from a 9-day-old workflow blocked a brand-new review at substep 1, requiring manual `reset-soft` detour. Two-part fix:

- New `state auto-reset-if-stale --task=X --workflow-type=Y` CLI: deterministic auto-fire when ALL hold — task changed AND age > 24h AND workflow_type changed (unambiguous new working session). resetSoft is non-destructive of valuable state (preserves workflow_id_history, session anchors, .devt/memory, phase artifacts) so prompting in this case adds friction without value. Loud stderr message on fire so operator sees what was cleared.
- New `/devt:review --fresh` operator-override flag: explicit "I know it's stale, just reset and go" shortcut. Bypasses staleness check, calls reset-soft unconditionally. Useful when operator already knows the workflow is stale and wants to skip the prompt round-trip.
- `state staleness-check` extended with `--workflow-type=Y` parameter + `workflow_type_changed` / `auto_reset_recommended` fields in output.

**G6 — `init review --bundle` opt-in CLI bundling** (`bin/modules/init.cjs`). Receipt #5 Q7b: setup friction is dominated by CLI calls (12-14 before Wave 1), not MCP or file reads. New `--bundle` flag attaches the 3 most common post-init context-build steps in one CLI call: preflight-generate, memory-signal count, graphify impact-plan (when graph is ready). Best-effort — any sub-step failure aggregates into `bundle.errors[]` so init.workflow_id always succeeds. Default behavior unchanged — `init review` without `--bundle` returns the same shape as before, preserving all existing callers.

**G7 — `graphify compose-drilldowns` markdown emitter** (`bin/modules/graphify.cjs`). Receipt #5 Q7a: graphify-decision gate correctly flagged that orchestrator wrote graph-impact.md without drill-down sections, but the failure-mode (orchestrator discipline) is recurring. New CLI emits ready-to-concatenate markdown (`## Drill-down: <symbol>` header + per-neighbor bullets + filter telemetry) for the top-N symbols. The workflow can pipe `compose-drilldowns | tee -a graph-impact.md` to remove the "did I remember to drill?" failure class entirely.

**Drift-guard stack now 72-deep K94-K165.** CLAUDE.md + README updated.

**Smoke gates**: K163 (G4 — synthetic 30d-old workflow.yaml with task+type mismatch → auto-fires; same workflow with matching type → no-op), K164 (G6 — `init review` default vs `--bundle` shape diff: bundle field absent vs present with `preflight_generated` + `errors[]`), K165 (G7 — synthetic graph + 1 target with 2 callers → output contains `## Drill-down:` header + both caller labels).

**Cal #31 series complete** (B + C + D shipped across v0.105.0 → v0.107.0). Receipt #6 target: code-review value rating ≥ 7.0 (up from 6.5/10 baseline) after all 3 cals integrated. If rating stays at 6.5, lift came from elsewhere (memory bridge G2 or ergonomics G4/G6/G7) — useful diagnostic signal even on partial validation.

**Remaining**: Q1 (DI/dispatch edges) deferred to graphify-upstream filing — generalizes to FastAPI/Spring/Django/.NET/Express; not devt-side reimplementation.

## [0.106.0] - 2026-06-25

### Cal #31.C — Memory read-path bridge (G2 laneH)

One receipt-#5-validated devt-side fix closing the architectural gap surfaced by receipt #5 Q5: MEMORY.md + claude-mem-harvest observations weren't reaching reviewers via preflight `memory_signal` because cal #29 shipped a WRITE path (claude-mem → `_suggestions.md` → curator → permanent doc) but no READ path. Receipt user had to hand-assemble `claude-mem-harvest.md` per dispatch.

**G2 — Lane H auto-memory + claude-mem-harvest READ path** (`bin/modules/preflight.cjs`). New lane surfaces decisions at preflight time without bypassing the curator-write path:

- **Source 1**: auto-memory dir (default `~/.claude/projects/<projHash>/memory/*.md`; override via `cfg.memory.auto_memory_paths`). Reads each `.md` file's frontmatter (`name`/`description`/`metadata.type`) + body, scores body content against task tokens, returns matched records sorted by score.
- **Source 2**: `.devt/state/claude-mem-harvest.md` if present (orchestrator-staged observations from `discovery.cjs::harvestClaudeMemFromMcp`). Parses `## Observation #NNNNN` blocks, scores each against task tokens.
- **Output**: normalized records `{name, description, source, source_file, score, type}` folded into the brief as a new `## Auto-Memory + Claude-Mem (read-time)` section AND a new `auto_memory: [...]` field in the JSON sidecar.

Architectural decision (Option Z from receipt scoping): NOT folded into FTS index — auto-memory frontmatter schema (`name/description/metadata.type`) is incompatible with devt FTS schema (`id/title/doc_type/status/confidence/summary`). Options X (add 6th `doc_type: note`) and Y (repurpose `concept`) would require rewriting 38 user-curated files. Z (read-time grep, no FTS pollution) is the only viable path. No curator-bypass concern — auto-memory is operator-owned; harvest file is orchestrator-staged.

**Drift-guard stack now 69-deep K94-K162.** CLAUDE.md + README updated.

**Smoke gate**: K162 (synthetic auto-memory dir + harvest file → laneH returns 2 records, 1 each correctly attributed `source=auto_memory` and `source=claude_mem_harvest`).

**Carryover for cal #31.D**: G4 (auto-staleness-reset + `--fresh` flag), G6 (extend existing `init review` CLI to bundle preflight + memory + scope-cache + impact-plan, ~6-8 round-trip reduction), G7 (drill-down composition CLI to remove orchestrator-discipline-failure mode on graphify-decision gate).

## [0.105.0] - 2026-06-24

### Cal #31.B — Graphify signal quality (3 receipt-validated fixes)

Three devt-side fixes from greenfield-api receipt #5 (2026-06-23). Receipt rated graphify integration depth 8/10 but session value 6.5/10 with calibrated noise samples (19/19 config-enum noise dominating topic.symbols, `licences/dependencies.py` "imports everything" DI-aggregation flooding get_neighbors, `symbols-in-files` returning `[]` on newly-added files). Each fix addresses one named symptom with deterministic, code-grounded edits.

**G1 — DI-aggregation collapse in `getNeighbors` BFS visitor** (`bin/modules/graphify.cjs`). When many result nodes share one DI-pattern source file (`dependencies.py` / `wiring.py` / `container.py` / `providers.py` / `deps.py` — extension-agnostic across Python/TS/JS), collapse to one representative + `di_aggregation_collapsed_count` marker instead of fanning out. Threshold-gated (default >5 occurrences) so small legitimate DI wiring stays visible. Configurable via `graphify.di_aggregation_pattern` + `graphify.di_aggregation_collapse_threshold`. Receipt evidence: greenfield review had 100+ nodes from one `dependencies.py` drowning out real call edges; with G1 those collapse to a single labeled marker.

**G3 — Config-enum demotion in `extractTopic`** (`bin/modules/preflight.cjs`). When config/constants/settings files are in the diff, their enum/dataclass symbols (`Settings`, `*Config`, `*Backend`, `*Profile`, `LogLevel`, `Environment`, `OrderBy`, `ErrorCode`, etc.) flooded topic.symbols above real feature symbols. Receipt's 19 confirmed noise samples → 18/19 demoted (94.7% coverage; `UserLanguages` intentionally not matched — plural-noun is too weak a config signal). Demotion preserves recall (symbols stay in array, ranked last) while improving precision (downstream top-N truncation drops them first). New `topic.config_demoted` telemetry field surfaces demoted set so reviewers can audit.

**G5 — Diff-hunk symbol fallback in `symbolsInFiles`** (`bin/modules/graphify.cjs`). When the graph (rebuilt at last commit) has no nodes for newly-added files, fall back to regex-extracted symbols from file contents via identifier-introducing-keyword pattern (Python/TS/JS/Go/Rust). Synthesized symbols carry `source: "diff-hunk"` + `edge_count: null` so consumers distinguish them from graph-derived results. Bounded reads (50KB/file, 20 symbols/file) keep latency negligible. Receipt evidence: symbols-in-files returned `[]` on greenfield's new `.py` files — exactly the highest-risk subset — forcing fallback to noisy topic-text symbols. With G5, symbol_anchored tier produces anchors even for additions the graph has never seen.

**Drift-guard stack now 68-deep K94-K161.** CLAUDE.md + README updated.

**Smoke gates**: K159 (G1 — 8 dependencies.py nodes collapse to 1 representative + filtered=7), K160 (G3 — real symbols rank above 4 mixed config-enums + config_demoted field present), K161 (G5 — 3 symbols extracted from un-indexed .py file with source=diff-hunk).

**Receipt validation target**: receipt #6 should rate code-review value ≥ 7.0 (up from 6.5/10 baseline). If it stays at 6.5, the Q3/Q4/Q6 fixes weren't the right levers and cal #31.C (memory bridge) must carry the lift instead.

**Carryover for cal #31.C/D**: G2 (MEMORY.md → preflight memory_signal via new laneH, Option Z confirmed by schema-incompatibility validation), G4 (auto-staleness-reset + `--fresh` flag), G6 (extend existing `init review` CLI to bundle 4 more steps, ~6-8 round-trip reduction), G7 (drill-down composition CLI to remove orchestrator-discipline-failure mode on graphify-decision gate). Q1 (DI/dispatch edges) deferred to upstream graphify filing — generalizes to all FastAPI/Spring/Django/.NET/Express DI patterns; not devt-side reimplementation.

## [0.104.0] - 2026-06-21

### Cal #31.A — Wave A tightening (drift meta-gate + 2 UX fixes)

Three small validated cleanups from the cal #31 candidate roster (Wave A only — quick-win drift+UX class). Per "tighten don't add" directive: no new features, only converging existing surfaces.

**C1 — K156 case-handler ⊃ default-case enumeration drift gate** (`scripts/smoke-test.sh`). Walks every `bin/modules/*.cjs`, extracts `case "X":` handlers + the multi-line "Unknown <mod> subcommand. Use: A | B | C" enumeration block; asserts handlers ⊆ enumeration. Empirically validated drift class: 4 incidents in 48 hours during the cal #30 audit arc (cal #29 dispatch, c26b9ed state, f299a99 memory, 0c2bbff graphify) — each a case handler shipped without updating its sibling enumeration. K156 prevents all future incidents of this class automatically. Adversarially verified: injecting a `case "fake-test-xyz":` handler into state.cjs makes K156 flag the missing enumeration entry.

**C2' — K157 preflight-brief.json staleness banner** (`hooks/workflow-context-injector.sh`). Field receipt #2 Q3: operator cited preflight-brief.json data from a prior workflow run as fresh. A2 staleness banner covers `workflow.yaml::created_at` age but NOT `.devt/state/` artifact age. New check: when `preflight-brief.json` mtime is >4h older than workflow.yaml::created_at, emit `[devt] preflight-brief.json STALE (Xh older than workflow start) — run /devt:preflight before relying on memory_signal/governing-doc data`. Closes the artifact-age gap.

**C3' — K158 dispatch-hygiene-guard per-subagent canonical CLI** (`hooks/dispatch-hygiene-guard.sh`). Field receipt #2: operators saw the generic "/devt:review, /devt:workflow, /devt:debug" suggestion and chose the wrong workflow. KILL-gate message now derives a precise per-subagent canonical CLI from a 10-entry map (programmer→/devt:workflow, code-reviewer→/devt:review OR dispatch run-lanes, debugger→/devt:debug, etc.). Falls back to the generic list for unknown agents.

**C4 — `subagent-status.sh` 14% failure investigation** (M4 analyzer follow-up). Pulled the failure cluster: all 30 failures clustered on 2026-06-10 in a ~6-hour window (06:40-13:14); zero failures since. The bug is historical, not current. Hook unchanged since the cluster; all recent runs exit=0. No code fix needed — documenting the closure validates the M4 telemetry infrastructure.

**C1' — parallel-canonical banner** scoped + deferred. Receipt #2 Q5 surfaced operator hand-rolling lane dispatches because canonical paths weren't surfaced. Implementation requires reading the UserPromptSubmit event's `input.prompt` from stdin, but `workflow-context-injector.sh` only receives `state` via `process.argv[1]` — not the event JSON. Adding stdin handling for one banner is larger than Wave A's "tighten" scope. Deferred for cal #31.B; would need either a separate UserPromptSubmit hook OR plumbing stdin into the existing injector.

**Drift-guard stack now 65-deep K94-K158.** CLAUDE.md + README updated.

**Smoke gates**: K156 (drift meta-gate self-test + adversarial-injection-catches-drift), K157 (8h-stale preflight fixture emits banner), K158 (programmer + code-reviewer routes emit per-agent CLI).

**Wave B + C cal #31 candidates carried over** (per cal #31 candidate roster): C2 M6 claude-mem audit (research), C3 M1 effort wiring completion (PREREQUISITE: verify Task tool effort param), C6 M5 mid-conv system messages (architectural), C7 Option B wrap-not-compete (architectural), C8/C9 D8/D5 upstream filings.

**Validation**: smoke (target 902/902), graphify 37/37, locking 3/3.

## [0.103.0] - 2026-06-19

### Cal #30.5 — `dispatch run-lanes` canonical-path ergonomics (M3, 4 directive shapes)

Closing Option E roadmap. Greenfield receipt #2 Q5 diagnosed the canonical-path adoption gap as **customization expressiveness, not step count** — operators hand-rolled lane dispatches because `register-lanes → render-lanes` couldn't inject custom directives. Receipt #4 Q10 ranked the 4 directive shapes that would flip the hand-roll decision. Cal #30.5 ships all four.

**M3 — `node bin/devt-tools.cjs dispatch run-lanes`** (`bin/modules/dispatch.cjs`, `bin/modules/state.cjs`). Ergonomic launcher that bundles partition registration + render-lanes + directive injection in one CLI call. Flags:

| Flag | Effect | Greenfield Q10 priority |
|---|---|---|
| `--partition=<file>` | Register lanes from YAML/JSON file (delegates to existing `state.cjs::registerLanesFromYaml`) before rendering | Q10 #2 (manual partition beats auto) |
| `--lane-<id>-focus=<text>` | Per-lane directive injected as `<lane_focus>` envelope tag (matched by lane id) | **Q10 #1 highest** — the actual driver of hand-rolling |
| `--task-suffix=<file>` | Global checklist content injected as `<task_suffix>` tag into every lane envelope | Q10 #4 |
| `--base=<ref>` | Diff base override injected as `<diff_base>` tag (defaults to `$PRIMARY_BRANCH` env, then `main`) | Q10 #3 (silent wrong-range fix per D7) |
| `--out=<dir>` | Write lane envelopes to per-lane files (inherits render-lanes semantics) | — |
| `--target=<agent>:<workflow>` | Override default `code-reviewer:code_review` template | — |

Per-lane directive injection extends the existing `cmdRenderLanes` lane-block composer at the same insertion point as `<lane_id>` / `<lane_community>` / `<correlation_id>` / `<lane_files>` — directives slot in before `</context>` so investigative agents reading the envelope see them alongside their canonical context. The injection is opt-in: lanes without a matching `--lane-N-focus` get no `<lane_focus>` block; envelopes without `--task-suffix` get no `<task_suffix>` block. Default-off keeps backward-compat with existing `dispatch render-lanes` invocations.

Auto-partition (graphify-community-derived lane split) intentionally deferred per Q11 evidence: god-node bridges (PScope, AppError, EventBusProtocol with 600-1100 edges) guarantee 2-3 mega-communities under any modularity-maximizing cut. Default-on auto-partition needs the D8 god-node-edge-discounting upstream graphify fix first; until then operators provide manual `--partition=<file>`.

Also added to `state.cjs::module.exports`: `resetSoft`, `stalenessCheck`, `registerLane`, `registerLanesFromYaml` (previously not exported; required for cross-module use from `dispatch.cjs::cmdRunLanes`).

**Smoke gates K151-K154**: K151 (partition file registers + renders both lanes), K152 (per-lane focus injects into matching envelope without cross-contamination), K153 (task-suffix injects globally into all envelopes), K154 (`--base=<ref>` overrides `PRIMARY_BRANCH` env in `<diff_base>` block).

**Drift-guard stack now 61-deep K94-K154.** CLAUDE.md + README updated.

**Cal #30 series closure**: Option E roadmap fully shipped across 5 cals (cal #30.0 → cal #30.5) per greenfield's 4-receipt validation chain.

- cal #30.0 → graphify D1 filter + Bitbucket positioning + merge-base diff
- cal #30.1 → state reset-soft + dispatch correlation_id matcher + doc-lie fix
- cal #30.2 → Opus 4.8 absorption (effort + verifier short-circuit + refusal routing)
- cal #30.3 → graphify signal quality (MCP max_bytes + getNeighbors filter + status counts + docstring rider)
- cal #30.4 → telemetry calibrate analyzer + first findings
- cal #30.5 → dispatch run-lanes with 4 directive shapes (this release)

**Deferred follow-ups** (not part of cal #30 closure):
- **Cal #30.4.1** — investigate `subagent-status.sh` 14% non-zero exit pattern (30 identical 722B-stderr failures clustered) surfaced by M4 analyzer
- **D8** — god-node edge-discounting (graphify-upstream prerequisite for `--auto-partition` default-on)
- **D5 upstream** — file `detect_incremental` false-positive issue with graphify maintainer
- **C1'/C2'/C3'** from receipt #2 — parallel-canonical banner, artifact staleness banner, dispatch-hygiene per-workflow canonical message
- **M5** (mid-conv system messages), **M6** (claude-mem delegation audit) — cal #31 architectural

**Validation**: smoke (target 899/899), graphify 37/37, locking 3/3.

## [0.102.0] - 2026-06-18

### Cal #30.4 — telemetry-driven calibration (M4, infrastructure + first findings)

devt accumulates `.devt/state/hook-trace/run-hook.jsonl` + `gate-trace.jsonl` + `dispatch-warnings.jsonl` across all sessions but had no analyzer surface — recalibrating guard thresholds + cap sizes meant manually grepping jsonl. M4 ships the analyzer CLI + runs it against devt's own 554KB hook-trace to surface the first data-driven calibration findings.

**M4a — `bin/modules/telemetry-calibrate.cjs` + `node bin/devt-tools.cjs telemetry calibrate` CLI** (~3hr). Single-pass aggregator over four telemetry sources:
- `hook-trace/run-hook.jsonl` → per-script {count, exit_zero, exit_nonzero, stdin_bytes/stdout_bytes/stderr_bytes summaries with p50/p95/p99/max}
- `gate-trace.jsonl` → per-gate {count, pass, fail} (accepts both `ok:boolean` and `verdict:string` shapes for backward compat)
- `dispatch-warnings.jsonl` → {total, by_source, by_agent}
- `claim-check-failures.jsonl` → {total}

Recommendation engine emits actionable findings:
- **`hook_low_value`** — hook fired ≥20 times with exit=0 AND stdout=0 on ≥95% of fires (silent + always-succeed = candidate for disable/reduce)
- **`hook_error_pattern`** — hook fired ≥50 times with non-zero exit on ≥10% (consistent failure mode worth investigating)
- **`gate_always_pass`** — gate fired ≥100 times with 100% pass (low-signal-to-cost; caveat: may be project-shape-specific)
- **`gate_always_fail`** — gate fired ≥100 times with 100% fail (likely broken)

Conservative thresholds chosen to minimize false positives. Note: hook stdout caps are Claude Code hook-contract-sized (not devt-configurable), so the recommender does NOT emit cap_shrink_candidate on hook stdout — that target reserves for genuine devt-configurable caps (graph-impact 32KB, governing_rules 96KB, inline_guardrails 64KB) which need separate telemetry sources.

**M4b — first analyzer run against devt repo telemetry** (3423 hook-trace records, 78 gate records, 55 dispatch warnings). Findings:

| Finding | Surface | Disposition |
|---|---|---|
| `subagent-status.sh` 14% non-zero exit (30/212 fires, identical 722B stderr) | `hook_error_pattern` | **Deferred follow-up** — real bug, identical error signature across all 30 failures; investigate in cal #30.4.1 |
| `memory-auto-index.sh` always silent (104 fires, stdout=0) | `hook_low_value` | **Validated as expected** — hook runs silently in normal mode, only writes output on indexable changes; no action |
| `assert-graphify-decision` 100% pass over 39 fires | (below 100-fire floor — not flagged) | Trivially passes when graphify disabled (devt project's own config); validates the floor-100 caveat works |

**M4c — applied refinements**: recommender's gate-fire floor raised 20→100 to suppress project-shape false positives; gate aggregator now accepts both `ok:boolean` and `verdict:string` record shapes (older `assertGraphifyDecision` + `assertPreflightFresh` use verdict). Removed misleading hook-stdout `cap_shrink_candidate` recommender — hook stdout sizes are Claude Code hook-contract-sized, not devt-configurable.

**Smoke gates K149-K150**: K149 (analyzer aggregates hook-trace + emits hook_error_pattern recommendation on synthetic flaky-hook fixture), K150 (hook_low_value recommendation emitted on synthetic always-silent fixture).

**Drift-guard stack now 57-deep K94-K150.** CLAUDE.md + README updated.

**Cal #30.4.1 candidate (deferred)**: investigate `subagent-status.sh` 14% failure pattern — 30 identical 722B-stderr failures concentrated in one period, suggests a real bug rather than environmental noise.

**Cal #30.5 candidate (next per Option E roadmap)**: M3 `dispatch run-lanes` with 4 directive shapes (~6-8hr).

**Validation**: smoke (target 895/895), graphify 37/37, locking 3/3.

## [0.101.0] - 2026-06-18

### Cal #30.3 — graphify signal quality (F1+F2+F4+F5, 4 fixes from greenfield receipt #4)

Greenfield receipt #4 surfaced four graphify-side signal-quality gaps that survived cal #30.0's D1 blast_radius filter: (1) MCP get_neighbors path overflowed on big hubs because max_bytes was code-side-only, not exposed in schema; (2) getNeighbors caller-set drill-downs were ~95% noise (test methods + docstrings + primitives) — D1's filter applied to blastRadius only, not getNeighbors; (3) `graphify status` returned `{state, out_dir, graph_path}` while preflight-brief.json had the real freshness data — two sources of truth, one broken; (4) D1's whitespace-≥3 threshold slipped short test-description docstrings like "Test successful login." (2 ws). All four fixed devt-side; no graphify-upstream blockers.

**F1 — MCP `get_neighbors` max_bytes schema exposure** (`bin/devt-graphify-mcp.cjs`). Code at `graphify.cjs:519` already handled `options.max_bytes` (deterministic depth-asc + label-alpha sort, returns `truncated:true`). MCP schema didn't declare the property, so the truncation knob was unreachable from MCP callers. Schema now declares `max_bytes: {type: integer, minimum: 1024, maximum: 524288}`; handler forwards to graphify with server-side default 60000 bytes when caller omits. Description updated. Field motivation: greenfield's ExportService drill-down returned 293K chars / 8509 lines, overflowing MCP transport to a saved file with zero usable signal.

**F2 — `getNeighbors` noise filter + test-path heuristic** (`bin/modules/graphify.cjs`). Cal #30.0's D1 filter `_isBlastNoise` only applied inside `blastRadius()`; the parallel `getNeighbors()` loop pushed every visited node unfiltered. Composes `_isBlastNoise` into getNeighbors BFS visitor (filters primitives + docstrings + file/concept/json-key nodes) PLUS new `_isTestPathNode` source_file regex heuristic. Universal `_DEFAULT_TEST_PATH_PATTERNS` covers Python (tests/, test_*.py, *_test.py, conftest.py), JavaScript/TypeScript (__tests__/, *.spec.*, *.test.*), Go (*_test.go), Ruby (*_test.rb), Java/Kotlin (src/test/). Project override via new config `graphify.test_path_patterns[]`. Response envelope carries `filtered_noise` + `filtered_test_path` telemetry so consumers can audit filter aggressiveness. Field motivation: AuthenticationService caller-set was ~95% test methods + `rationale_for` docstring fragments, burying production-caller signal.

**F4 — `graphify status` count surfacing** (`bin/modules/graphify.cjs`). `status()` previously returned only `{state, out_dir, graph_path}` — operators had to derive freshness from `preflight-brief.json` (which had the real data via a different code path). Extends `status()` to call `freshness()` by default (cheap regex on graph.json head/tail), surfacing `lag_commits` + `built_at_commit`. New `--full` flag opts into `loadGraph()` parse cost — surfaces `node_count`, `edge_count`, `trust`, `has_communities`. Default stays O(1) so the "is graphify ready?" check on 50MB+ graphs doesn't pay parse cost. Reconciles the two code paths to one source of truth.

**F5 — `_isDocstringNode` threshold rider** (`bin/modules/graphify.cjs`). Cal #30.0 D1 set whitespace threshold ≥3 to detect sentence-shaped labels. Field receipt: "Test successful login." (2 whitespace) and "Tests for ExportService.list_exports." (3 ws but the period+Test prefix is more distinctive) slipped through. Lowers threshold to ≥2 AND adds explicit "starts with Test/Tests/Tests for + ends with period" pattern. Catches the test-docstring conventional shape without over-broadening to legitimate multi-word labels.

**Drift-guard stack now 55-deep K94-K148.** CLAUDE.md + README updated.

**Smoke gates K145-K148**: K145 (F5 threshold catches "Test X." class + retains real symbols), K146 (F4 status surfaces lag_commits + --full surfaces counts), K147 (F1 MCP schema declares max_bytes + server default 60000), K148 (F2 getNeighbors filters noise + test-path nodes + emits filter telemetry).

**Cal #30.4 (telemetry-driven calibration: M4) + cal #30.5 (dispatch run-lanes with 4 directive shapes: M3)** carried over per Option E roadmap.

**Validation**: smoke (target 893/893), graphify 37/37, locking 3/3.

## [0.100.0] - 2026-06-18

### Cal #30.2 — devt absorbs Opus 4.8 (M1+M2+M7, 3 fixes)

Opus 4.8 introduced three behavior changes that demanded devt-side absorption: (1) effort default flipped from medium to high — silent token regression on every dispatch; (2) 4x reduction in silent code flaws with proactive uncertainty flagging — agents now self-report uncertainty far more reliably; (3) refusal responses carry structured `stop_details.category` — categorical routing now possible. This cal absorbs all three with three small validated fixes plus per-K-gate enforcement.

**M1 — Effort schema in model profiles** (`bin/modules/model-profiles.cjs`, `bin/modules/dispatch.cjs`). New `EFFORTS` map parallel to `PROFILES`, calibrated per agent role: architect/verifier=high (design + rubric grading), code-reviewer/debugger=medium (analysis), programmer/researcher=medium (synthesis), retro/tester/docs-writer/curator=low for budget profile (mechanical). New `getEfforts(profileName, overrides)` function with `effort_overrides` config support. New CLI subcommands `models efforts` and `models efforts-table`. Dispatch substitution adds `{efforts.<agent>}` parallel to `{models.<agent>}` for envelope wiring. Also updates `MODEL_ALIAS_MAP`: `opus → claude-opus-4-8` (was 4-6), adds `fable → claude-fable-5`. Smoke gate **K141** (architect=high, tester=low, opus resolves to claude-opus-4-8).

**M2 — Verifier-hardening: sidecar self-flag schema + short-circuit gate** (`bin/modules/state.cjs`, `agents/programmer.md`, `agents/tester.md`, `agents/code-reviewer.md`, `workflows/code-review.md`). New CLI `node bin/devt-tools.cjs state assert-verifier-short-circuit --agent=<name>` reads upstream sidecar (impl-summary.json / test-summary.json / review.json) and returns `{short_circuit, reason, sidecar_path, self_flagged_count}`. Short-circuit fires when: (a) sidecar exists + parseable, (b) status is DONE or DONE_WITH_CONCERNS, (c) `self_flagged_uncertainties[]` is empty. When fired, workflows/code-review.md verify step writes a synthetic `verification.json` with `source: short_circuit` (audit trail preserved) and skips the verifier LLM dispatch — saves 3-5K tokens per clean iteration. The existing `assert-verifier-ran` gate accepts the synthetic verification.json so downstream contracts hold. Sidecar schema documentation added to all three writer agents with explicit prompt: "Always include the field — use `[]` for no uncertainties. Empty IS a meaningful negative claim that you actively considered uncertainty and found none." Smoke gates **K142** (short-circuit fires on clean sidecar; blocks on non-empty self_flags AND on PARTIAL status), **K143** (self_flag prompt language present in all three writer agents).

**M7 — Refusal stop_details category routing** (`hooks/task-truncation-detector.sh`). Extends opportunistic stop_reason capture (existing) to also read `stop_details.category` (Opus 4.7+). Four categories routed with category-specific actionable hints: `unclear_instruction` → re-dispatch with clarification block; `policy_violation` → log + DO NOT retry (terminal); `content_safety` → escalate to user; generic fallback for unknown categories. Refusal hints prepend the advisory (highest-priority signal) and bypass the cliff-fired short-circuit so refusals always surface. Forensic record now carries `stop_category` and `refusal_routed` fields. Smoke gate **K144** (unclear_instruction routed; end_turn does NOT trigger refusal hint).

**Drift-guard stack now 51-deep K94-K144.** CLAUDE.md + README updated.

**Cal #30.3 candidates (graphify signal quality, ships next per Option E roadmap)**: F1 (MCP get_neighbors max_bytes), F2 (getNeighbors noise filter + test-path heuristic), F4 (graphify status counts), F5 (D1 docstring rider).

**Cal #30.4** (telemetry calibration: M4) and **cal #30.5** (`dispatch run-lanes` with 4 directive shapes: M3) carried over.

**Validation**: smoke (target 887/887), graphify 37/37, locking 3/3.

## [0.99.0] - 2026-06-18

### Cal #30.1 — unblock stale workflows + stop deceiving operators (urgency-first ordering, 2 fixes from greenfield receipt #4)

Greenfield receipt #4 surfaced two failures that blocked the canonical /devt:review flow on a long-lived project: (1) accumulated raw_dispatch counts from a 20-day-old prior workflow chain tripped the KILL gate on the first state.update call of a brand-new review; (2) workflows/code-review.md prose at scope_check claimed lane registration "silences raw_dispatch warnings on the registered tuple" but the dispatch-hygiene-guard.sh matcher is purely content-based on envelope tags — operators following the canonical path with customized prompts still got flagged. Per Option E urgency-first ordering (validated against the field receipt), unblock + stop deceiving ship FIRST, before signal-quality fixes (cal #30.2) and architectural absorption (cal #30.3+).

**F3 — `state reset-soft` + `state staleness-check` + workflow context_init integration** (`bin/modules/state.cjs`, `workflows/code-review.md`, `hooks/dispatch-hygiene-guard.sh`). Surgical reset for new reviews against stale workflows. Clears per-workflow accumulators (task, complexity, tier, community, slug, phase, status, verdict, repair, verify_iteration, redispatch_count, lanes, review_file, dispatched_at, stopped_at, stopped_phase, resume_context, memory_signal_json, scope_hint_json, scope_trust_json); rotates dispatch-warnings.jsonl + claim-check-failures.jsonl to `.archive-<ts>.jsonl`; assigns fresh workflow_id + first_created_at so KILL/claim-check gates start counting from zero. Preserves session anchors (workflow_id_history with prev appended, original_workflow_id), .devt/memory/, and all phase artifacts (impl-summary.md, graph-impact.md, review.md, test-summary.md). `state staleness-check --task=<text>` returns `{stale, reason, age_hours, task_changed, prior_task}` with AND-semantics: stale iff task differs AND prior workflow > 1h old (task-match-but-stale = legitimate resume, NOT stale; task-mismatch-but-fresh = typo retry, NOT stale). code-review.md::context_init Substep 0 (new) runs staleness-check; if stale, AskUserQuestion offers reset. dispatch-hygiene-guard.sh KILL-gate refusal message now includes the actionable reset-soft hint. Smoke gates **K137** (reset-soft clears accumulators + rotates logs + preserves history+anchor), **K138** (staleness-check AND-semantics across all 3 cases).

**F6 — `dispatch render-lanes` correlation_id stamping + dispatch-hygiene matcher recognition + FALSE workflow doc claim fix** (`bin/modules/dispatch.cjs`, `hooks/dispatch-hygiene-guard.sh`, `workflows/code-review.md`). Each rendered lane envelope now carries `<correlation_id>cid_<workflow_id_prefix>_<lane_id></correlation_id>` — a short, copy-paste-friendly tag operators can preserve when customizing other envelope content. The matcher at hooks/dispatch-hygiene-guard.sh:155-167 now accepts `/<correlation_id>cid_/` alongside the existing envelope-tag list, so registered-lane dispatches don't get flagged as raw_dispatch even when prose is customized. Field-evidenced operator-mistake pattern: greenfield's reviewer followed register-lanes + render-lanes canonical path but wrote customized prose prompts; all 6 dispatches got raw_dispatch warnings despite originating from the correct workflow. Documentation fix at workflows/code-review.md:434 — replaces the FALSE claim that lane registration "silences raw_dispatch warnings on the registered (lane_id × scope_hint × file_set) tuple" with accurate description of correlation_id content matching. Smoke gates **K139** (render-lanes emits correlation_id tag per envelope), **K140** (matcher accepts correlation_id-only envelope as silent; no-envelope prompt still flagged raw_dispatch).

**Drift-guard stack now 47-deep K94-K140.** CLAUDE.md + README updated for new count.

**Cal #30.2 candidates (validated, ship next per Option E ordering)**:
- **F1** — MCP `get_neighbors` `max_bytes` schema exposure (code exists at graphify.cjs:519, gated off by MCP schema; ExportService drill-down overflowed on this run)
- **F2** — `getNeighbors` noise filter extension (D1's `_isBlastNoise` not applied to getNeighbors loop) + source_file test-path heuristic
- **F4** — `graphify status` count surfacing (status() never calls freshness()/loadGraph(); preflight-brief.json has the real data)
- **F5** — D1 docstring threshold rider (lower whitespace threshold from ≥3 → ≥2 + Test/Tests/ends-with-. heuristic to catch "Test successful login."-class slips)

**Cal #30.3 candidates (Opus 4.8 absorption, ship after cal #30.2)**:
- **M1** — Effort schema in model profiles (active silent regression: Opus 4.8 default flipped to high)
- **M2** — Verifier-hardening (sidecar self_flagged_uncertainties + short-circuit + hard-refusal)
- **M7** — Refusal stop_details routing (half-shipped infra at hooks/task-truncation-detector.sh:113)

**Cal #30.4 (telemetry-driven calibration) + Cal #30.5 (`dispatch run-lanes` with 4 directive shapes)** carried over.

**Validation**: smoke 883/883 (4 new K-gates), graphify 37/37, locking 3/3.

## [0.98.0] - 2026-06-18

### Cal #30.0 — graphify signal-quality + canonical diff-base + docs honesty (3 validated fixes from greenfield field receipts)

Two greenfield calibration receipts (one on devt-flow adherence, one on devt+graphify integration depth) surfaced concrete cal #30 candidates. Three were validated against the codebase as ship-ready single-session fixes; the rest moved to cal #30.1+ scoping. Pattern matches cal #29's "small validated fixes with smoke gates."

**D1 — `blast_radius` node-type filter** (`bin/modules/graphify.cjs`). Field calibration: upstream graphify emits primitive types (`int`, `str`, `bool`, `BaseModel`) and docstring text as first-class nodes. Without filtering, `blast_radius` returned `direct_dependents: [..., "int", "str", "BaseModel", "Stringify value for streaming CSV output..."]` — accurate to graph topology, useless as signal. Existing filter functions `_isFileNode` / `_isConceptNode` / `_isJsonKeyNode` were only applied to god-node detection, not to the BFS visitor in `blastRadius()`. Added `_PRIMITIVE_TYPE_LABELS` set (Python scalars, typing module, framework infra) + `_isDocstringNode` heuristic (label length > 80 OR ≥3 whitespace chars) + `_isBlastNoise` composer + project-extra config via `graphify.blast_radius_extra_noise: string[]` in `.devt/config.json`. Filter applied at BFS visitor before `direct.add` / `indirect.add` / `modules.add`. Deflates noise from `effect_size` count AND `modules_touched` simultaneously. 2 new `test-graphify.cjs` assertions (graphify suite 35 → 37).

**D4 — `docs/GRAPHIFY.md` tier-semantics positioning section**. Field calibration: a greenfield reviewer (Bitbucket project) read `pr_scoped` as "the flagship" and `symbol_anchored` as "the noisy fallback." The framing was already honest in workflow code (`code-review.md:235`, `docs/INTERNALS.md:284`) but absent from user-facing `docs/GRAPHIFY.md`. New "Tier Semantics" section explicitly documents `symbol_anchored` as the canonical primary tier for non-GitHub repos — not a fallback, not degraded. Smoke gate **K135** locks the positioning string.

**D7 — Canonical diff-base resolution at `identify_scope`** (`workflows/code-review.md:495`). Field calibration: greenfield's multi-commit feature branch was silently diffed at `HEAD~1` (single commit) instead of merge-base (whole branch). The same workflow file ALREADY used the correct `${PRIMARY_BRANCH:-main}...HEAD` triple-dot pattern at `scope_check` (L207, L252) — L495 had diverged in `identify_scope`. Fix: align L495 with the existing pattern. Fallback chain: merge-base → HEAD~1 → --staged → NO_DIFF. Operator override: `export PRIMARY_BRANCH=development` (or whatever the project's primary branch is). Smoke gate **K136** behavioral test — builds a 3-commit branch fixture and asserts merge-base captures all 3 commits while HEAD~1 captures only 1, then confirms the workflow file uses the merge-base pattern.

**Drift-guard stack now 43-deep K94-K136.** CLAUDE.md + README updated for new count.

**Cal #30.1+ candidates** (validated, deferred for focused rounds):
- **D2** — verifier-on-canonical enforcement strengthening: ADR-compliance axis is real and load-bearing (Q9 evidence — ADR-001 sits on the top audit finding on the greenfield receipt); needs a hard refusal path when orchestrator skips verifier with "fan-out is already verifier-grade" rationalization
- **D3** — `dispatch run-lanes` CLI with 4 directive shapes (`--lane-N-focus`, `--partition=<file>`, `--base=<ref>`, `--task-suffix=<file>`) per Q10. Customization expressiveness, not step count, is the canonical-path friction.
- **D5 upstream** — file detect_incremental false-positive issue with graphify maintainer (261 phantom deletions on FD-exhausted run; devt-side audit confirmed devt does NOT expose dangerous `force=True`)
- **D8** — god-node edge-discounting in community detection (Q11 evidence — PScope/AppError/EventBusProtocol bridges guarantee 2-3 mega-communities under modularity-maximizing cut; required before `dispatch run-lanes --auto-partition=community` can default-on)
- **C1'/C2'/C3'** from first receipt (parallel-canonical banner; artifact staleness; dispatch-hygiene per-workflow canonical message)
- **Option B** wrap-not-compete architecture — cal #31 design pass

**Reclassified during validation**:
- ~~D5 devt-side force=True audit~~ — devt's `--force` at `graphify.cjs:781` is freshness-skip only; calls `graphify update .` via `spawnSync` with NO `--force` passthrough. Does not cascade to dangerous `build_merge force=True`. No devt code change needed; reduces to upstream filing only.
- ~~D6 reviewer MCP access~~ — Q4 confirmed Grep won every call-graph question on greenfield review; orchestrator-owns-MCP contract holds.

**Validation track record**: two greenfield receipts → 8 clarifying questions → answers triggered 3 voluntary corrections from the reviewer + 1 reclassification on devt side → 3 ship-ready fixes. Per the standing "validate before implementing" rule, two findings (D5 devt-side, D6) would have been wasted work without the validation pass.

**Validation**: smoke 881/881 (2 new K-gates), graphify 37/37 (2 new D1 assertions), locking 3/3, gate 16/16.

## [0.97.0] - 2026-06-18

### Cal #29 — three validated bugs surfaced by field-receipt validation

Field calibration receipts forced re-validation of three claimed Tier-A issues. **All three original diagnoses were wrong**; validation surfaced the actual bugs underneath:

| Original (wrong) diagnosis | Receipt | Actual bug |
|---|---|---|
| Memory retrieval broken — CON-002 doesn't surface | `memory query "bitbucket"` returns CON-002 perfectly; only fails when query has zero keyword overlap with doc content | **Preflight query construction doesn't include project-context tokens** — Bitbucket project's CON-002 misses when task description doesn't say "bitbucket" |
| Dispatch-hygiene counter all-time-scoped | Code at `state.cjs:4731` uses `created_at` (workflow-scoped). 39 dispatches WERE in current workflow window (open 3 days) | **Long workflows accumulate counts across many sessions** — counter is correct but operator's mental model differs |
| Fresh release needed — cal #26 not in field | Cache install at `604a02a` HAS cal #26 commit | **dispatch usage message at line 1041 wasn't updated to list `run`** — operators conclude `run` doesn't exist |

Three small fixes shipped:

**A3' — Dispatch usage message includes `run`** (`bin/modules/dispatch.cjs:1041`). One-line fix. Cal #26's `dispatch run` ergonomic launcher (A7-min) had been silently un-discoverable since June 17. Operators running `dispatch` with no args saw an 8-subcommand list missing `run`. Now lists all 9. Smoke gate **K132** locks the subcommand inventory.

**A2' — Workflow-staleness warning at >24h** (`hooks/workflow-context-injector.sh`). When `workflow.yaml::created_at` is more than 24h old, the session-start banner appends `[devt] workflow open Xd (since YYYY-MM-DD); long-running — consider /devt:workflow --cancel`. No auto-reset (operator decides). Bridges the gap between operator's per-session mental model and the counter's per-workflow-window semantics. Smoke gate **K133** verifies staleness fires on >24h workflows, silent on <24h.

**A1' — Project-context token enrichment for preflight memory query** (`bin/modules/preflight.cjs`). New **laneG** queries the FTS index with project-shape tokens (currently `.devt/config.json::git.provider`) per-token independently, unions results into the governing pool. Effect: docs whose content matches the project shape (e.g., CON-002 "Bitbucket projects permanently lose pr_scoped tier") surface in `memory_signal` for every Bitbucket project's preflight, regardless of the task vocabulary. Verified against Greenfield's actual case: `preflight.generate("export wizard mobile 2FA bypass")` on Bitbucket project now surfaces CON-002 (lane_g=1, CON-002 in brief). Smoke gate **K134** seeds a Bitbucket-only test doc + queries with unrelated task → confirms laneG surfaces the doc.

**Drift-guard stack now 41-deep K94-K134.** CLAUDE.md + README updated for new count.

**Validation track record**: three claims investigated, three corrections made before shipping. Per the standing "validate before implementing" rule, this is the pattern paying off — original cal #29 scope would have shipped fixes that didn't address the actual bugs.

**Cal #29 explicit defers** (validated as not-the-right-fix-yet):
- ~~Memory retrieval fix~~ — works correctly; query enrichment is the actual gap (shipped as A1')
- ~~Counter scoping refactor~~ — works correctly; workflow lifecycle is the actual gap (shipped as A2' warning)
- ~~Fresh release for cal #26 visibility~~ — cal #26 is in field; discoverability bug is the actual gap (shipped as A3')

**Cal #30 candidates (validated, deferred for focused rounds)**:
- **B1** — Default Graphify MCP to summarized output (server-side change, coordinate with graphify maintainer)
- **C1 — Wrap-not-compete architecture** — GF's strongest single ask. devt agents internally invoke project specialists, add envelope + telemetry + sidecar. ~8-12 hr design pass.

**Validation**: smoke 879/879 (3 new K-gates), gate 16/16, locking 3/3, graphify 35/35, envelope-compile 22/0 drift.

### Cal #28-A — dispatch-helpers discoverability + agent resume CLI

Two of Greenfield's field-evidenced top-3 highest-ROI items shipped. Item #2 (validation-as-hook) deferred to cal #28-B for its own design pass — it's the bigger one and combining muddied scope.

**dispatch-helpers skill discoverability** (`skills/dispatch-helpers/SKILL.md`). GF report: "I never figured out how to invoke `dispatch render-filled` cleanly" despite the skill existing. Root cause: skill description and trigger phrases targeted only parallel fan-out (`"fan out review across files X,Y,Z"`, `"dispatch programmer in lanes"`), so the Skill never loaded into context when the orchestrator was about to do a SINGLE raw dispatch (the common case). Updated:
- Description broadened to cover single + parallel + recovery patterns with explicit trigger phrases for each shape ("dispatch devt:code-reviewer to review X", "run devt:programmer for Y", "re-dispatch programmer with continuation")
- Body restructured: leads with the one-off `dispatch run agent --task="..."` ergonomic launcher (cal #26 A7-min), then advanced `dispatch render-filled` for fan-out, then companion `state refresh-scope-context`
- Worked example added for the one-off case — replacing a typical raw `Agent(subagent_type="devt:code-reviewer", ...)` call
- Description trimmed to 766 chars (under F19's 800-char budget)

**`agent resume` CLI** (`bin/modules/agent-resume.cjs`). GF item #3: "SendMessage-resume contract is heavyweight... a one-command `devt agent resume <id>` that reads the sidecar's next_section would have made this trivial." Shipped:
- `node bin/devt-tools.cjs agent resume [agent_id] [--section=NAME] [--sidecar=PATH]`
- Auto-detects newest PARTIAL sidecar in `.devt/state/` when no agent_id given (scans `impl-summary*.json`, `review*.json`, `test-summary*.json`, `verification*.json`, `debug-summary.json`)
- Emits paste-ready `SendMessage(to="<id>", content="<continue_from_section>...")` block with sections_completed context
- Graceful degradation when `next_section` is absent (mid-section wall before agent could write it): emits `<continue_from_checkpoint/>` with scan-and-continue task + stderr advisory
- Input validation: usage on no subcommand, clear errors on missing sidecar / unknown agent_id (exit 2)

Note: agent body protocol change to PRE-write `next_section` (vs current post-section write) is deferred to cal #28-B alongside the validation-hook design. Currently the CLI handles both populated and absent `next_section` gracefully.

**Smoke gates K129-K130** lock both behaviors. Drift-guard stack now **37-deep K94-K130**. CLAUDE.md + README.md updated for new count.

**Cal #28-B (next round) — validation-as-hook design pass**. Field-evidenced 55% wall rate at validation step (agent's response budget eaten by implementation work, "all tests passed" doesn't fit). Design needs: sidecar schema addition for `validation_gates[]` + PostToolUse/Stop hook that runs the declared gates + sidecar patch + workflow logic to consume aggregate verdict + agent body protocol change (pre-section next_section). ~3-4 hours focused work.

**Validation**: smoke 875/875 (2 new K-gates), gate 16/16, locking 3/3, graphify 35/35, envelope-compile 22/0 drift.

### Cal #26 — constraint-aware bypass response (4 hooks + 1 CLI)

Five field-evidenced fixes shipped after validating each against existing code and reproducing the GF-observed pattern locally. **Validation revealed two items from the initial Tier A were already shipped** (R6 scope filter at `hooks/dispatch-hygiene-guard.sh:132`; A2' envelope auto-staging at `hooks/dispatch-hygiene-guard.sh:262-291`) — those dropped from scope. The remaining work shipped as five mechanical fixes that interlock.

**Architectural honesty**: cal #26 cannot mechanically block raw dispatch because Claude Code's harness doesn't honor PreToolUse `decision: "deny"` on the Task tool (documented at `docs/HOOKS.md:147` + `state.cjs:2778`). This release ships maximum-ergonomics + scope-correctness + recovery-mechanics instead of an unachievable hard block.

**A2' silent-failure fix** (`hooks/dispatch-hygiene-guard.sh`). The existing envelope auto-staging at warn-mode had two silent-drop paths: (1) `CLAUDE_PLUGIN_ROOT` unset → `require()` never ran; (2) no active workflow → `cmdRenderFilled(':auto')` threw and was swallowed. Both reproduced locally via synthetic hook input. Now: hook walks up to find `.claude-plugin/plugin.json` if env var unset; catches the no-workflow throw and surfaces "no active devt workflow — run /devt:workflow or /devt:review first to bootstrap context, then re-dispatch" in the advisory. Operators see WHY the envelope wasn't attached.

**A4 silent PreFlight for ungoverned edits** (`hooks/pre-flight-guard.sh`). Field signal: ~50 noise events per session when every edit demanded manually-written `:: ungoverned` PREFLIGHT line. When memory layer exists AND no doc's `affects_paths` matches the file, auto-write the `:: ungoverned` line silently and allow. Projects WITHOUT a memory layer keep existing warn behavior — the nudge to set up governance is load-bearing for those.

**Dual-window session-signal counter** (`hooks/workflow-context-injector.sh`). Field signal: long-running workflows (`first_created_at` days/weeks old) accumulated `dispatch-warnings.jsonl` entries the cumulative counter treated as current — "74 raw_dispatch" was actually 7 days of activity, not actionable. Now: count last-1h primarily; silent when last-1h=0 regardless of cumulative. When workflow age > 24h AND cumulative differs, append `; total this workflow (Xd): N raw + N cliff` tail. Banner-blindness root cause addressed at the noise source. Reproduced with synthetic fixture before shipping.

**C2 inline `--by-source` output** (same hook). When recent raw_dispatch count > 0, top-3 agent sources inline as `[devt:code-reviewer=2, devt:tester=1]`. Discoverability fix — operators see the data shape immediately, not a CLI command they'd need to learn and run.

**A7-min `dispatch run` CLI** (`bin/modules/dispatch.cjs`). New subcommand: `node bin/devt-tools.cjs dispatch run <agent> --task="..."`. Renders the canonical envelope for the specified agent + substitutes the user-supplied task text into the `<task>` block + emits paste-ready `Task()` invocation. Closes the "no matching skill" bypass justification (e.g., dispatching `devt:tester` for a one-shot rewrite with no `/devt:test-rewrite` skill). Input validation: requires `<agent>` + non-empty `--task=`; surfaces usage on misuse.

**Smoke gates K125-K128** lock all four behaviors:
- K125: pre-flight-guard silent auto-write when memory exists + no doc matches
- K126: dispatch-hygiene-guard surfaces envelope-unavailable reasons (both no-workflow + no-plugin-root paths)
- K127: workflow-context-injector dual-window counter (silent on stale-only, recent count + workflow-age tail + by-source inline)
- K128: dispatch run CLI surface input validation

Drift-guard stack now **35-deep K94-K128**. CLAUDE.md + README.md updated for new count.

**Validated rejects** (recorded for audit):
- **A1 PreToolUse hard-block** — Claude Code doesn't enforce `decision:deny` on Task tool. Replace via A2' carrot + A7-min ergonomics + R6 scope filter (already shipped).
- **R6 scope filter** — already shipped at `dispatch-hygiene-guard.sh:132`. The field-observed "74 raw_dispatch" was workflow-staleness counter accumulation, not scope-filter absence. Dual-window counter is the correct fix.
- **A2'-minimal envelope auto-staging** — already shipped (warn-mode + investigative agent). Silent-failure paths were the actual gap; addressed via A2'-silent-failure-fix above.
- **Narrative redirect at threshold** — field signal confirmed text-only redirect joins banner-blindness within 5 fires. Mechanical ergonomics (A7-min) ships instead.
- **A5 banner rotation** — without a working hard-block, more banner noise doesn't help. Dual-window counter eliminates the noise source instead.

**New backlog item surfaced**: `/devt:implement` keeps prompting operators at each phase to choose between continuing with devt agents vs direct execution. Not in any workflow body — this is the orchestrator (main-thread LLM) freelancing mid-workflow. Different bypass pattern than what cal #26 addresses. Fix shapes (deferred to next round): (a) workflow bodies become explicit "MUST dispatch via Task() — direct execution bypasses verifier loop + sidecar contract + telemetry"; (b) config knob `orchestrator.always_dispatch_devt_agents: true`; (c) hook detection on Edit/Write during active dev/quick_implement workflow when prior tool call wasn't a Task dispatch.

**Validation**: smoke 873/873, gate 16/16, locking 3/3, graphify 35/35, envelope-compile 22/0 drift.

## [0.96.0] - 2026-06-16

### Cal #25 — doc slim + ephemeral-ref sweep + stale-plans cleanup

Three-track doc-slim pass aligned with north-star goals (output quality preserved, token cost reduced per dispatch). Net change: 48 files modified, 7 files deleted, 1 file created; **+981 / -7032 lines** (-5965 from plan deletions, -86 net from prose density).

**α — CLAUDE.md duplication collapse (`CLAUDE.md`, new `docs/operator-guide/DISPATCH-RECIPES.md`).** CLAUDE.md is preloaded into every agent dispatch and main session. Three "Critical Agent + Workflow Contracts" paragraphs (each ~5 lines) collapsed to one-line pointers since `docs/AGENT-CONTRACTS.md` already carries the full contract bodies. Five-recipe "Dispatch Escape-Hatch Recipes" section (~35 lines) extracted to `docs/operator-guide/DISPATCH-RECIPES.md`. CLAUDE.md: 262 → 225 lines (-14%). Per-dispatch token savings compound across every workflow.

**β + γ — Workflow + agent prose density (11 files, 54 edits, ~1.6KB stripped).** Stripped ephemeral provenance (cal #N, C7-N, R10-N, PR #N, dated session refs, project-specific symbols) from `workflows/code-review*.md`, `workflows/dev-workflow.md`, `workflows/quick-implement.md`, `workflows/debug.md`, smaller workflows, and `agents/{code-reviewer,programmer,verifier}.md`. Technical content preserved — only attribution removed. Pattern: `Field signal (greenfield 2026-05-27 PR #372): ...` → `Why: ...` with the same technical content.

**E — Broader sweep across active code + docs (~30 files, ~7KB stripped).** Extended the same taxonomy to: 11 CJS modules (`bin/modules/*.cjs`), 8 active docs (`docs/AGENT-CONTRACTS.md`, `INTERNALS.md`, `HOOKS.md`, `GRAPHIFY.md`, `COMMANDS.md`, `STATE-RULES.md`, `operator-guide/CLI-REFERENCE.md`, etc.), 3 hooks, 3 skills, 2 pinned-version rubrics. **Verified zero code-logic changes** via `git diff | grep` filter excluding comment lines — all 11 CJS modules show zero non-comment additions/deletions.

**F — Stale plans cleanup (6 plans + 1 dated spec deleted).** All `docs/superpowers/plans/*.md` files targeted shipped functionality (v0.8 GSD improvements, v0.60 mechanical gates, v0.61 reuse pre-search, v0.62 workflow freshness, post-v0.62 backlog) — codebase is at 0.95.0, 35+ versions past their targets. Files recoverable from git history if needed.

**Memory rule clarified.** `feedback_no_version_refs_in_code` now carries the **static-rule exception** explicitly: references to numbered IDs that map to hard-coded static rule files (`.devt/memory/concepts/CON-NNN-*.md`, `.devt/memory/decisions/ADR-NNN-*.md`, K-gates in `scripts/smoke-test.sh`) ARE allowed because the source persists. Ephemeral refs (calibration rounds, PR numbers, dated session logs) remain forbidden. Verified static refs kept: `[[CON-001]]`, `[[CON-002]]`, `[[CON-003]]` wiki-links across 5 files.

**Regressions caught + fixed during execution**:
- M14 + M15 smoke gates re-pinned to new header text (`Ambiguous bindings`, `Rubric self-check`)
- K1 dispatch-compile drift fixed via source-template sync (template + region now share new wording)
- F10b stale `review-scope` ref restored to `REVIEW_SCOPE` (variable name, not file name)

**Validation**: smoke 869/869, gate 16/16, locking 3/3, graphify 35/35, envelope-compile 22/0 drift.

### Cal #24 round 12 follow-up — strip round/cal/ID refs from codebase

Codebase is not the changelog. Stripped round numbers, calibration IDs, ticket refs, and other provenance markers introduced during R10-R12 across 14 files (`hooks/*`, `bin/modules/*`, `bin/devt-graphify-mcp.cjs`, `workflows/_phase-gates.yaml`, `workflows/code-review*.md`, `agents/code-reviewer.md`, `scripts/smoke-test.sh`). Replaced provenance with rule/invariant phrasing or field-observed framing; the WHY signal stays load-bearing, the time-pinned context decays out. Net: +135 / −134 lines (information density preserved). Smoke 869/0, gate 16/0, locking 3/0, envelope-compile 22/0. K-gate self-IDs (K121-K124 inside their own pass/fail messages) intentionally retained as self-referential.

Memory rule reinforced via `feedback_no_version_refs_in_code` (slug: `feedback-no-version-refs-in-code`): rounds, calibration IDs, wave/option/tier labels, ticket refs, K-gate cross-refs, and session timestamps are CHANGELOG-only. Legacy refs predating R10 (~195 remaining `cal #N` / `greenfield calibration` / `D-NN` markers from earlier rounds) intentionally left — per the rule's "clean up when nearby code is being modified" guidance; dedicated legacy sweep deferred as a candidate round.

### Cal #24 round 12 — stop wasting signal

Two field-evidenced fixes; both single-line where they matter.

- **Q3 cliff-counter signal-awareness** (`hooks/workflow-context-injector.sh:153`). R10-6 added `signal: healthy|near_cliff|low_output|mid_task` tagging to emitter; this consumer was still counting ALL `task_output_bytes` records. Greenfield cal #24: "247 cliff signals" was actually 0 actionable. Predicate now reads `r.signal && r.signal !== 'healthy'`. K123 locks. Cry-wolf eliminated.
- **Q4 raise MCP `maxItems: 32 → 256`** (`bin/devt-graphify-mcp.cjs:166`). Cap was arbitrary literal with no transport constraint; CLI handles unlimited. Greenfield cal #24: 92-symbol PR review silently dropped 60 (65%). 256 covers 2.8x. K124 locks. Auto-split (D-1) subsumed.

Drift-guard 29 → 31 (K94-K124). Smoke 869/869, gate 16/16, locking 3/3, envelope 22/0.

### Cal #24 round 11 — intermediate-phase gate coverage (D-5) + envelope_health substance signal (R11-3)

Two Tier A items from the round 10 deferred list, both field-evidenced. Round 10 closed the enforcement gap for terminal-phase transitions; round 11 extends that to intermediate phases and surfaces context degradation that R10's presence-only check missed.

**D-5 — intermediate-phase gate coverage (`workflows/_phase-gates.yaml` + `scripts/smoke-test.sh`).** Field signal (greenfield cal #24): the 62 raw_dispatches accumulated across `dispatch_lanes` → `substance_check_lanes` → `redispatch_lanes` → `consolidate` mid-workflow with no enforcement until terminal `complete`. Round 10's R10-1 wired `state update phase=X status=DONE` to fire phase-gates, but `_phase-gates.yaml` was scope-limited to terminal phases only (v0.73 design intent — *"the FINAL-DEACTIVATION phase per workflow_type"*). Round 11 extends the registry to gate every INTERMEDIATE phase per workflow_type with the minimum gate set: `assert-no-raw-dispatches-this-session`. Combined with R10-4's kill-threshold=3, the bypass pattern now trips at the THIRD raw_dispatch on whatever intermediate phase boundary the orchestrator hits next — no longer accumulates 62 before any enforcement fires.

- 33 intermediate phases gated across 5 workflow_types (code_review, code_review_parallel, dev, quick_implement, debug)
- Terminal phases (`complete` / `debug` / `arch_health_scan`) retain their full gate set (claim-checks-resolved + knowledge-candidates-tagged + auto-curator-considered + verifier-ran where applicable)
- Why intermediate phases get ONLY the raw-dispatch gate (not the full terminal set): the other terminal gates check work-products that don't exist mid-workflow (e.g., `assert-verifier-ran` is meaningless until verify phase produces `verification.json`). Gating those mid-workflow would block every intermediate transition with false positives. Raw-dispatch is the one signal universally relevant at every phase boundary.
- New smoke gate **K122** locks the contract: fixture seeds 3 raw_dispatches → `state update phase=<intermediate> status=DONE` refuses with state preserved at IN_PROGRESS → `--skip-gates` bypasses → clean fixture advances cleanly. Drift-guard stack now **29-deep K94-K122**.

**R11-3 — `<envelope_health>` substance signal (`bin/modules/dispatch.cjs` + `agents/code-reviewer.md`).** Field signal (greenfield cal #24 Q8): `workflow_context_assertion` at `agents/code-reviewer.md:91` is presence-only — even `{}` empty payloads pass the presence check (forgiving by design). Lane reviewers couldn't tell when context was degraded (e.g., Bitbucket + stale brief → empty memory_signal/scope_trust but envelope LOOKS healthy because the tags are present).

- `dispatch.cjs::computeEnvelopeHealth(rendered)` classifies 5 monitored blocks (`scope_trust`, `scope_hint`, `memory_signal`, `graph_impact`, `rubric_content`) as `populated` / `empty` / `placeholder`; status="healthy" when ≥3 of 5 populated, "degraded" otherwise.
- Injected as `<envelope_health>{JSON}</envelope_health>` before the LAST `</context>` in cmdRenderFilled output (lastIndexOf preserves correctness when inlined CLAUDE.md prose mentions `</context>`).
- `agents/code-reviewer.md::workflow_context_assertion` now reads envelope_health and adds a `## Envelope Health` section to review.md when status=degraded, with per-block compensation directives (e.g., `empty: ["memory_signal"]` → "grep-first on REJ tombstones recommended for any Critical finding"; `placeholder: ["rubric_content"]` → "inline_rubrics substitution failed — fell back to Read <rubric_path>").
- NOT gating — surfaces degradation without blocking legitimately-degraded contexts (Bitbucket, stale brief, graphify-disabled). Verifiers + maintainers can now see WHICH inputs degraded a review, separate from the review's verdict.

**Validation:** 867/867 smoke (K122 added), 16/16 gate tests, 35/35 graphify tests, 3/3 locking, 22 envelope-compile regions / 0 drift. Live-tested both healthy (4-of-5 populated → status=healthy) and degraded (0-of-5 populated → status=degraded) fixtures.

### Cal #24 round 10 — enforcement-gap close (phase-gates fire on state update, kill-threshold, recursive gitignore, config-drift banner, knowledge-candidate harvest at exit, signal discriminator)

Greenfield's first v0.95.0 field evaluation surfaced the single highest-leverage gap in cal #24: **gates defined in `workflows/_phase-gates.yaml` were functionally dead for ~93% of phase transitions in shipped workflows** (99 `state update phase=X` call sites vs. 7 `state advance-phase` calls — and only `state advance-phase` fired the gate registry). Round 10 closes that gap end-to-end plus the field-validated supporting items.

**R10-1 — Phase-gates fire on `state update phase=X status=DONE` (`bin/modules/state.cjs`).** Extracted reusable `runPhaseGates(workflowType, targetPhase)` helper from `advanceState`; `updateState` detects `phase=X` + `status=DONE` in keyValues and fires registered gates BEFORE the lock acquisition (avoids gate-readState recursion). On failure: throws with the blocked gates listed + alternative-command hints (e.g. raw_dispatch → `state register-lanes && dispatch render-lanes`; knowledge-candidate → `state aggregate-knowledge-candidates`). State stays at IN_PROGRESS. `--skip-gates` CLI flag opts out (loud name keeps the bypass auditable). `advanceState` passes `{skipGates: true}` when calling `updateState` internally so gates fire exactly once. Field-validated end-to-end in fresh project fixture: phase-gates fire correctly for `code_review_parallel.complete` (98 byte refusal output with three gate failures + alt-command hints + skip-gates instruction).

**R10-4 — Hard kill-threshold on `assertNoRawDispatchesThisSession` (`bin/modules/state.cjs`).** New `dispatch_hygiene_kill_threshold: 3` config knob (null = disabled). When `raw_dispatch_count >= threshold`, gate returns `{ok: false, killed: true}` regardless of `dispatch_hygiene_mode` — hard-limit safety bypasses warn-mode. Closes the field-evidenced gap where greenfield accumulated 62 warn-mode warnings in one session with zero enforcement. Other gates stay mode-aware. The 3-count threshold lets intentional 1–2-off ad-hoc dispatches still work in warn mode; runaway-pattern (>=3) blocks regardless. Verified: warn mode + 3 raw_dispatches → `killed:true` with recovery instructions naming `state register-lanes` and `dispatch render-lanes`; warn mode + 2 → passes (soft-warn preserved).

**R10-2 — Recursive gitignore + `--upgrade-gitignore` migration + W015 health check (`bin/modules/setup.cjs`, `bin/modules/health.cjs`).** Setup's required gitignore patterns changed from flat (`.devt/state/`) to recursive (`**/.devt/state/`) so sub-tree `devt` invocations (e.g. `tools/X/`, `tests/Y/`) no longer leak transient state files into PR diffs. Field signal: greenfield committed 6 transient files from sub-tree `.devt/state/` directories in one PR. New `devt setup --upgrade-gitignore` fast-path appends recursive pattern alongside any existing flat entry (idempotent, preserves backward compat — both patterns coexist). New W015 health code detects "flat-only" gitignores and recommends the upgrade; W015's repair handler calls the new fast-path. W005 messaging unchanged for "no `.devt/state` at all" case but now bootstraps with the recursive pattern.

**R10-3 — Session-start config-drift banner (`hooks/workflow-context-injector.sh`).** When a project's `.devt/config.json` overrides any safety mode (`dispatch_hygiene_mode`, `claim_check_mode`, `graphify_decision_mode`) to a non-`block` value, emits `[devt config alert] safety floor weakened: <list> (fail-secure default = block). Restore: devt config set <key> block. Audit: devt config get` as the topmost line of every UserPromptSubmit context — active workflow OR idle session. Field signal: greenfield's project config had `dispatch_hygiene_mode=warn` for unknown reasons; the override was invisible at session start and remained inherited across sessions. Cheap: one shallow JSON read per prompt, only the explicit project overrides (not the merged config). Silent when all modes are default-block.

**R10-5 — Knowledge-candidate harvest at every workflow exit (`hooks/stop.sh`).** `state aggregate-knowledge-candidates` now fires unconditionally on Stop hook, regardless of completion path. Field signal: off-script orchestrators that bypass the workflow (`62 raw_dispatch` events in greenfield's session) never reach `present_findings` → never call the aggregator → `scratchpad.md` candidates never propagate → curator never sees them. Fire-and-forget: the aggregator early-returns on absent sources, never overwrites existing scratchpad entries, never blocks shutdown.

**R10-6 — `task_output_bytes` signal discriminator (`hooks/task-truncation-detector.sh`, `bin/modules/dispatch.cjs::cmdWarnings`).** Emit gains a `signal: healthy|near_cliff|low_output|mid_task` field. `dispatch warnings` CLI summary modes default-filter `signal: healthy` events; `--all` flag opts back into the full series. Stuck-detector at `state.cjs:3000` reads the file directly (bypasses this CLI), so its consumer contract is preserved. Field signal: greenfield session emitted 246 cliff signals — 0 actionable, all healthy noise drowning the actionable raw_dispatch count. When healthy events are filtered, summary results carry `filtered_noise_count` + `filter_hint` so operators see what was hidden.

**R10-7 — Smoke gate K121 (`scripts/smoke-test.sh`).** Locks the R10-1 contract: state update phase=complete status=DONE refuses when gates block, --skip-gates opts out cleanly, state stays at IN_PROGRESS on refusal. Brings drift-guard stack to 28-deep (K94-K121, +1 from cal #23). CLAUDE.md + README.md updated for new gate count.

**Rejected after validation** (recorded for future audit):
- **GF's "flip dispatch_hygiene_mode default to block"** — devt already ships block-default at `config.cjs:41`. Greenfield's project config explicitly overrode. R10-3 banner surfaces the override; no devt-side default flip needed.
- **F17 god-node bash CLI extraction** — R6 retraction validated again (27 vs 4 lines; inheritance architecture intentional). Skipping.
- **SERVER_VERSION pinning** — R6 retraction stands (no consumer reads `serverInfo.version`).
- **Wire `state update` to call `advance-phase` internally** — R10-1 achieves the same with smaller blast radius (gates run inline; advanceState still owns the phase-update orchestration).

### Cal #24 round 10 follow-ups — validated polish + Round-11 carryovers

Five improvement opportunities validated and shipped alongside Round 10. Three Tier-A polish + two Round-11-planned items that turned out cheap-to-ship-now.

**R11-1 — Lane CLI discoverability in workflow prose (`workflows/code-review.md::scope_check`, `workflows/code-review-parallel.md::partition_lanes`).** Both review workflows now carry a `> **Pre-known partition shortcut**` note pointing operators at `state register-lanes --from=<lanes.yaml> && dispatch render-lanes` when the lane breakdown is already known. Closes the discoverability gap that drove greenfield's 62-raw_dispatch bypass — Tier C primitives shipped in Round 8 but were undiscoverable from the workflow files themselves.

**R11-2 — Axes-shape default in `agents/code-reviewer.md` output template (D1 protection).** Revised the example output template from topic-shape (`### Critical / Important / Minor`) to axes-shape (`## Axis A — Scope coverage / Axis B — Specificity / ...`) matching the rubric. Topic-shape preserved as a fallback for single-domain lanes but requires the lane to ALSO emit `## Axis Coverage Map` so the verifier's `assert-verifier-graded-all-axes` gate can grade axis-walk coverage. Field signal: greenfield's D1 evidence-cycle close was conditional on the lane reviewer being attentive enough to override the topic-shape example; axes-shape default makes the win robust against less-attentive future lanes.

**R11-4 — `dispatch render-filled --rules-exclude` auto-wire via `.devt/config.json::rules.exclude_sections` (`bin/modules/dispatch.cjs`).** New `_mergeConfigRulesExclude(flagList)` helper reads `cfg.rules.exclude_sections: []` from merged config and merges with the CLI flag list (deduped). `render-lanes` also threads the merged list through to `cmdRenderFilled`. Field signal: greenfield never used the flag because it was unadvertised; project-level config makes the 18.1KB-per-dispatch saving accrue automatically without per-call plumbing. Verified: config-only (2 sections) + flag merge (2+1=3) + dedupe (same in both → still 2) + silence (no config, no flag → no trailer).

**D-2 — `memory.preflight_mode` added to session-start config-drift banner (`hooks/workflow-context-injector.sh`).** The banner introduced in R10-3 watched `dispatch_hygiene_mode / claim_check_mode / graphify_decision_mode` but missed `memory.preflight_mode` (default `block` per `state.cjs::DEFAULTS`). Now covered. Verified: `memory.preflight_mode=warn` in project config fires the banner standalone (idle session) with `safety floor weakened: memory.preflight_mode=warn` line.

**D-3 — Walk-up project-root resolution in `workflow-context-injector.sh`.** Hook previously used `process.cwd()` for `.devt/config.json` + `.devt/state/dispatch-warnings.jsonl` + `git status` cwd, which silently misbehaved when Claude Code was launched from a subdirectory of the project (e.g. `cd tools/X && claude code`). Added inline `_hookFindProjectRoot()` mirroring `config.cjs::findProjectRoot` semantics (walks up looking for `.devt/` or `.git/`; falls back to cwd). All 4 path resolutions now use the resolved root. Verified: hook invoked from `tools/subdir/` correctly finds project-root config and emits the drift banner.

**Self-review polish (during round 10)**:
- `state.cjs::assertNoRawDispatchesThisSession` reason field dedupes repeated agent names (`devt:code-reviewer ×5` vs listing 5×). Programmatic `agents[]` array unchanged.
- `bin/devt-tools.cjs` help text documents `--skip-gates` (state update) and `--all` (dispatch warnings).

**Validated-but-deferred** (recorded for next session):
- **D-1 memoize `_phase-gates.yaml` registry** — most CLI invocations are single-shot processes; memo only helps within ONE process which runs runPhaseGates at most once. Marginal value.
- **D-5 intermediate-phase gate coverage** — v0.73 design intent is terminal-only per `_phase-gates.yaml` header comment; expanding needs separate design pass.
- **D-6 expand recursive gitignore to more paths** — no field evidence for `.devt/memory/index.db` or `graphify-out/cache/`; could mask intentional sharing.
- **D-7 lock-protected aggregateKnowledgeCandidates** — theoretical race; matches stop.sh's existing best-effort convention.
- **R11-3 `<envelope_health>` block** — bigger work; needs envelope-shape design pass.

## [0.95.0] - 2026-06-16

### Cal #23 docs sync — rounds 5-9 surfaces documented across operator + internals docs

Doc-only sync covering all CLI surfaces, architecture, and state-contract changes shipped across rounds 5-9. Six files updated, +75 / −1 lines. No code change.

- **`docs/operator-guide/CLI-REFERENCE.md`** — full inventory entries for `state register-lane`, `state register-lanes` (round 8 Tier C); `dispatch render-filled --rules-exclude` flag (round 6 W7); `dispatch render-lanes [--out=]` with C7-7 auto-injection rationale (round 8 W3); `dispatch compile --check|--write`; `memory candidates-footer` finalize wrapper (round 5).
- **`CLAUDE.md`** — Dev Commands section adds `state register-lane[s]`, `memory candidates-footer`, `dispatch render-filled --rules-exclude`, `dispatch render-lanes`. New escape-hatch recipe 5 documenting the formal lane-orchestration alternative to raw dispatch (Q12 root-cause fix).
- **`docs/STATE-RULES.md`** — `lane-files/` listed in the canonical-subdir table (alongside `.archive/`) so the round 9 #1 fix is discoverable in the contract doc.
- **`docs/INTERNALS.md`** — state.cjs section gains W5 deterministic tier floor + Tier C `registerLane`/`registerLanesFromYaml` paragraphs. New dispatch.cjs section covers `cmdRenderLanes` (C7-7 default + per-lane injection + path override) and the opt-in `--rules-exclude` mechanism.
- **`docs/GRAPHIFY.md`** — Lane-Suggestions section expanded from 2 modes (community/partial) to 4 (adds `service_boundary` per round 7 W6 + `fallback`). New "Leiden-Absent Surfacing in Preflight (W6b)" section documenting `graphStats.has_communities` + the preflight `ℹ️` advisory.
- **`docs/MEMORY.md`** — CLI Surface section adds the candidate-surface helper trio (`candidates-status` + `candidates-touch-surface` + `candidates-footer`) with the workflow consumer mapping.

README spot-checked — no stale CLI / version / counts. Smoke 865/865, envelope-compile 22/0.

### Cal #23 round 9 — Tier A bug fix + Tier B test-coverage gaps closed

Four gaps surfaced by post-Round 8 deep validation pass — one active bug and three test-coverage holes from rounds 6-8 that would have silently regressed without coverage.

**#1 — `.devt/state/lane-files/` recognized as canonical subdir (`bin/modules/state-audit.cjs`).** Active bug from Round 8: the new Tier-C sidecar dir was classified `ad_hoc` by `state-audit::auditStateFiles` because the directory-check at line 100-103 only allowlisted `.archive`. Running `state cleanup` between `register-lane` and `dispatch render-lanes` would have archived the per-lane files sidecars, dropping the files list. Extracted `CANONICAL_SUBDIRS` set with `.archive` + `lane-files`; check replaced with `CANONICAL_SUBDIRS.has(name)`. Future canonical subdirs add one line each.

**#4 — `dispatch render-lanes` writes clear stderr on no-lanes (`bin/modules/dispatch.cjs`).** Round 8 silent failure: empty stdout + exit 2 was indistinguishable from a render bug. CLI now writes the underlying `result.reason` plus a one-liner usage hint (`Run 'state register-lane --id=L1 --scope=<X> --files=a.py,b.py' for one lane, or 'state register-lanes --from=<lanes.yaml|.json>' for bulk.`) before exiting 2.

**#3 — `test-gates.cjs` wired into smoke-test.sh CI gate (`scripts/smoke-test.sh`).** Round 7+B shipped 16 gate assertions as operator-runnable only — CI didn't catch regressions. Smoke now atomic-runs the subsuite as one gate; failure surfaces a hint to run the script directly for per-gate detail. Closes the regression-class GF flagged (substance-byte-threshold tweaks slipping through). Smoke total now 865 (was 864).

**#2 — W6 service-boundary + W6b has_communities test coverage (`scripts/test-graphify.cjs`).** Round 7 shipped both without test coverage. Four new test blocks added at end of file:
- W6 path A: graph not loaded + app/services/* shape → mode=service_boundary, 3 groups, reason mentions "graph not loaded"
- W6 path B: graph loaded sans communities + app/services/* shape → mode=service_boundary, reason mentions "no community attributes"
- W6 below-threshold: 1-of-5 service prefix coverage → mode=fallback (correctly skips service-boundary when <80%)
- W6b graphStats has_communities=false on fixture graph

test-graphify.cjs total: 35 passed, 0 failed (was 31). Future tweaks to the 7 prefix patterns or 80% coverage threshold can't silently change behavior.

**Validation**: 865/865 smoke (incl. new test-gates gate), 3/3 locking, 22 envelope regions / 0 drift, 35/35 graphify tests, 16/16 gate tests. No behavior changes for any of the 5 prior rounds — these are purely additive coverage + bug-fix + UX polish.

### Cal #23 round 8 — Tier C lane orchestration: register-lane[s] + render-lanes

Three new CLIs that turn the field-evidenced raw-dispatch escape hatch (greenfield calibration thread Q12-Q13: 50 raw_dispatch hygiene warnings in one PR session because orchestrators with a hand-rolled partition had no formal registration path) into a structurally-enforced canonical path.

**W1 — `state register-lane` (`bin/modules/state.cjs`).** Primitive CLI for orchestrators who already know the partition. Validates id (`/^L\d+$/`), scope (non-empty), files (non-empty array). Computes derived metadata (slug via existing `slugifyLaneName`, `file_count`, `est_loc` via wc-l on each existing file, `oversized` per 15-files/800-LOC thresholds). Lock-aware read-modify-write of `workflow.yaml::lanes[]`; rejects duplicate ids unless `--overwrite`. Files persisted to per-lane sidecar `.devt/state/lane-files/<id>.json` rather than embedded in YAML — avoids extending `serializeSimpleYaml`'s lane round-trip which today handles primitive values only (arrays would corrupt). New schema field `registered_at` distinguishes formally-registered lanes from `partition_lanes` bash-written ones.

**W2 — `state register-lanes --from=<file>` (same module).** Bulk wrapper for the common case (greenfield's 7-lane hand-rolled partition). Parses YAML inline-array form (`files: [a.py, b.py]`) and JSON, loops `registerLane` per entry with `allowOverwrite=true` so bulk re-runs are idempotent. Returns aggregate `{ok, registered: [...], errors: [...]}`.

**W3 — `dispatch render-lanes [target] [--out=dir]` (`bin/modules/dispatch.cjs`).** Emits per-lane envelopes for every entry in `workflow.yaml::lanes[]`. Default target is `code-reviewer:code_review` — the canonical per-file review template that already carries the C7-7 self-grade directive in its task body. **This is the structural fix for Q12's root cause**: hand-rolled raw-dispatch task text consistently omitted C7-7; rendering from the canonical template by default makes the bypass impossible. Each lane gets the base envelope (rendered once, substitution-cached) plus injected `<lane_id>`, `<lane_community>`, `<lane_files>` blocks before `</context>`, and the canonical "Write review to .devt/state/review.md" trailer is overridden per-lane to `lane.review_file` so concurrent lanes don't clobber one path. Stdout mode emits all envelopes with `<!-- LANE: <id> -->` separators; `--out=dir` mode writes one file per lane and returns a JSON summary with byte counts.

**Behavioural verification on temp fixture** (2 lanes registered, render-lanes invoked):
- 2 `<!-- LANE: -->` separators emitted
- 2 C7-7 directives present (one per lane, from canonical template)
- 2 `<lane_id>`, 2 `<lane_files>` injected blocks
- 2 per-lane output path overrides; **0 default-trailer leakage**
- `--out=dir` produces `lane-L1.txt` (5287 bytes) + `lane-L2.txt` (5244 bytes)

**Validation:** 864/864 smoke, 3/3 locking, 22 envelope regions / 0 drift, 16/16 gate tests.

**W4 (hygiene-warning silence at lane-id × scope-hint × file-set tuple) deliberately deferred** — touches `hooks/dispatch-hygiene-guard.sh` which has broader blast radius. Tier C ships without it; the C7-7 auto-injection in W3 closes the actual root cause without needing the silence rule. W4 becomes a follow-up only if registered-but-silenced-via-hook becomes felt friction.

### Tier B — Gate unit tests + shared fixture helper

Closes the substance-byte-threshold regression class Greenfield flagged in Cal #23 Wave 2 Q11. The 200-byte drill-down floor in `assertGraphifyDecision` was load-bearing prose with zero JS coverage — a future tweak from 200 → 150 would silently change drill-down acceptance across every code review. Five named gates now have direct unit coverage with synthetic fixtures.

**`scripts/_test-fixture.cjs`** — shared helper extracted from `scripts/test-graphify.cjs::setupFixture`. Exports `setupDevtFixture(opts)` returning `{tmp, devtDir, stateDir, runCli, cleanup}` and `seedArtifact(stateDir, relpath, content)`. The `runCli(...args)` closure spawns the project's `devt-tools.cjs` from the tmp project, eliminating per-test spawn boilerplate. `opts.graphify=true` enables BOTH the config-side `enabled` flag AND the graph.json scaffold so `graphify.status()` reports "ready" — required for gate tests that exercise the graphify-decision substance path.

**`scripts/test-gates.cjs`** — 16 assertions across 5 gates:

- **`assertGraphifyDecision` (state.cjs:1701)** — 4 cases: graphify-not-ready inapplicability, ready+no-artifacts → ok:false (skipped step), substantive drill-down without backing MCP trace → ok:false with `fabricated_drill_down:true` (anti-hallucination contract), thin drill-down body (<200 bytes) → `thin_drill_down_sections >= 1` (the GF-flagged substance regression class).
- **`assertArtifactPresent` (state.cjs:2778)** — 3 cases: missing agent argument, unknown agent name, known agent (programmer) resolves to canonical `impl-summary.md` expected_path.
- **`assertFileQuiescent` (state.cjs:3284)** — 3 cases: missing path argument, nonexistent file, stable file settles in ≥2 attempts with `--settle-ms=50 --timeout-ms=2000`.
- **`assertClaimChecksResolved` (state.cjs:4525)** — 3 cases: failures jsonl absent → ok:true with structural ambiguity note, `claim_check_mode=off` disables the gate regardless of failures present, in-window `verdict:"failure"` record → ok:false with `unresolved_count >= 1`.
- **`assertVerifierGradedAllAxes` (state.cjs:2192, cal #22 F2)** — 3 cases: no active workflow_type, code_review + verification.json absent → ok:false ("verifier never ran"), `criteria_total=6` vs rubric's 7 axes → ok:false with `missing_axes_count >= 1`.

Final scope `+260 LOC` across two new files (helper ~75, test suite ~185). Manually runnable via `node scripts/test-gates.cjs`. Not wired into CI smoke yet — following existing `test-graphify.cjs` / `test-locking.cjs` pattern of operator-runnable verification harnesses that exist alongside the smoke suite.

### Cal #23 round 7 — deterministic tier floor + service-boundary auto-detect + Leiden-absent surfacing

Three field-anchored cuts from greenfield's cross-calibration response. All three sit upstream of the lane-orchestration work (Tier C) so register-lane lands cleanly when its session opens.

**W5 — Deterministic complexity-tier floor enforcement (`bin/modules/state.cjs`).** Field signal: greenfield's 180-file PR was classified SIMPLE by `detectTier()` (task-text only at `init.cjs:536`) and never re-evaluated against the scope list; the `dev-workflow.md:399` heuristic table (`10+ files → COMPLEX`) was load-bearing prose with no enforcement. New `TIER_RANK` ordering + `computeTierFloor()` + `getScopeFileCount()` helpers; floor runs after every `updateState()` merge regardless of which keys were touched, so a SIMPLE tier seeded at init auto-elevates when `code-review.md::identify_scope` later writes 12+ paths to `.devt/state/code-review-input.md`. File-count parsing uses bullet-line matches (not `wc -l`) so headers and the `## Source` provenance block don't inflate. Auto-elevate emits a `state_warning` and never demotes (an over-elevation from earlier scope stays). Verified end-to-end: 12-bullet scope + `state update phase=identify_scope status=DONE` elevates `tier=SIMPLE` → `tier=COMPLEX` with the canonical warning carrying file count + heuristic reference.

**W6 — Service-boundary auto-detect in `graphify lane-suggestions` (`bin/modules/graphify.cjs`).** Field signal: greenfield's graph carries zero `community` attributes on every probed node (Q5 receipts) — every parallel review reverted to legacy path-based partitions that semantically broke service boundaries. New `detectServiceBoundary()` helper runs after the community-presence probe fails but before the fallback return. Seven prefix patterns ordered by specificity (`app/services/`, `services/`, `internal/`, `packages/`, `apps/`, `pkg/`, `cmd/`); first-wins anchoring (column-0 or `/`-preceded) prevents `vendor/app/services/X/` matching the bare prefix; 80% coverage gate preserves graceful degradation for polyglot diffs. Emits `mode: "service_boundary"` with `community` field carrying the service path (e.g. `app/services/identity`) — community-mode shape so the consumer extension at `code-review-parallel.md::partition_lanes` is one bash condition. Verified: 12-file `app/services/*` greenfield-shape diff returns 8 service-boundary groups at 100% coverage; polyglot 5-file diff falls back cleanly.

**W6b — Leiden-absent surfacing in preflight brief (`bin/modules/preflight.cjs` + `bin/modules/graphify.cjs::graphStats`).** When parallel-review partitioning will route via service-boundary or path-based fallback (not Leiden communities), operators learn that at preflight time, not after a 50-raw_dispatch session. `graphStats()` gains a `has_communities: boolean|null` field probed via the same 100-node scan `laneSuggestions` uses (consistent surfaces); preflight `renderBrief()` emits an `ℹ️` advisory when `state==="ready" && has_communities===false`, sibling to the existing "Memory index not built" warning. Cheap — graphStats reuses the loader cache. Verified: 2-node test graph without communities produces `has_communities:false` in `graphStats()` and the advisory appears in `.devt/state/preflight-brief.md`.

**Workflow + smoke coverage**: `workflows/code-review-parallel.md::partition_lanes` bash condition extended to route `service_boundary` mode through the community-shape branch (third arm in the if/elif/else with telemetry line `partition_lanes: N files → service-boundary partition (...)`). Prose at line 91 documents the new mode alongside community/partial/fallback. Full smoke suite 864/0 — zero regression.

### Cal #23 round 6 — graphify mechanical wins + opt-in rules-exclude

Four small mechanical wins from the cross-calibration between Greenfield's Graphify-integration evaluation and a second workflow-architecture thread. Each item field-anchored; rejected items (SERVER_VERSION discipline, standalone normalize-tool-name CLI, agent-body block-fragment extraction) documented under [Cal #23 round 6 — rejected after validation](#) below.

**A1 — `get_community` removed from MCP advertised surface (`bin/devt-graphify-mcp.cjs`).** Field signal: zero agent invocations across 50+ raw-dispatched lane reviews — no workflow tells an agent to reach for it. The JS function `graphify.getCommunity()` remains in `bin/modules/graphify.cjs` and stays in active use via the `graphify lane-suggestions` CLI. MCP wrapper handler block deleted (correcting GF's Q8(i) framing — there was no separate "handler block" from TOOLS[]; the handler IS the registry entry). Smoke gate replaced with an inversion gate that locks the removal — accidental re-add now fails CI rather than silently re-introduces a dead agent-facing surface.

**A2 — Bitbucket PR-scoped skip observability (`workflows/code-review.md` impact-plan).** Existing routing already correctly falls through from `pr_scoped` to `symbol_anchored`/`bulk_scoped` for non-GitHub providers (not a bug). Added `pr_scoped_skip_reason` field to `graphify-impact-plan.json` so post-hoc audits can answer "why didn't this Bitbucket PR use pr_scoped?" without re-deriving from provider + tier. Computed once before the if/elif chain; empty string when pr_scoped fires or no PR present.

**A3 — Namespace-split paragraph in `docs/INTERNALS.md`.** Tool-name forms (`mcp__plugin_devt_devt-graphify__*` prefixed in workflow prose vs `mcp__devt-graphify__*` unprefixed in trace records) documented next to the tool inventory, pointing to `mcpStats.normalizeToolName()` at `bin/modules/mcp-stats.cjs:121` as the canonical translator. Removes the every-future-implementer-rediscovery tax — the canonical implementation existed but was buried in one module's inline comment. Tool inventory's `get_community` row updated to `NOT ADVERTISED` with re-advertise instructions.

**W7 — `--rules-exclude` flag for `dispatch render-filled` (`bin/modules/dispatch.cjs`).** Per-dispatch opt-in CLAUDE.md (and other `governing_rules.content` entries) section strip by exact `## Heading` match. Field signal: 3 CLAUDE.md sections were cited 0 times across both L1 and L6 lane reviews (~15-20% of CLAUDE.md per dispatch). Section matching is exact title (predictable, no regex); preamble before first `##` always preserved; emitted envelope carries a `<!-- rules-excluded: N sections (X.X KB saved) -->` trailer for audit. Measured: 18.1KB saved on `programmer:dev` envelope with 2 sections excluded (~34% reduction of the 53KB baseline). Opt-in keeps project-portability open; will promote to `.devt/config.json` after field-evidence accumulates (Workflow Q14 promotion threshold: ≥3 dispatches in 30 days with the same exclude set).

**Rejected after validation** (recorded for future audit):
- **SERVER_VERSION discipline** — clients don't read `serverInfo.version`; protocolHistory array was speculation; revisit only if Claude Code plugin marketplace introduces a compatibility constraint.
- **Standalone `graphify normalize-tool-name` CLI** — `mcpStats.normalizeToolName()` at `bin/modules/mcp-stats.cjs:121` already exists; any future caller `require()`s it directly.
- **Agent-body block-fragment infrastructure** — original Round 6 proposal premise was wrong (per-pool-load, not per-dispatch); real saving was ~150 tokens × per dispatch + 2 commits/6mo of cross-file edits, not worth half a day of building agent-body compile system.
- **"600 lines duplicated graphify bash"** — retracted by GF after measurement; the MCP-setup inheritance architecture in `code-review-parallel.md::context_init` is correct.

### Cal #23 round 5 — memory-candidate footer collapsed to single CLI call

**`memory candidates-footer` subcommand added to `bin/modules/memory.cjs`.** Encapsulates the status-read + threshold check + cooldown probe + canonical hint emission + cooldown-timestamp touch that 4 workflows had been hand-rolling identically in 7-line bash blocks. Single CLI call replaces the duplication; the prose `KEEP IN SYNC across …` comment becomes vestigial (and is dropped) because the duplicated surface no longer exists.

- **Workflows updated**: `workflows/code-review.md`, `workflows/code-review-parallel.md`, `workflows/quick-implement.md`, `workflows/dev-workflow.md` each replace their footer bash block with `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-footer`. Net workflow diff: −24 lines of duplicated bash.
- **`workflows/next.md` deliberately unchanged**: its variant uses `ready_to_surface` as a shell variable to gate a downstream AskUserQuestion; the underlying `candidates-status` primitive remains the right surface for that call site.
- **Behaviour preserved**: silent exit 0 when not ready; canonical `💭 N memory candidates pending in .devt/memory/_suggestions.md — run /devt:memory promote to triage.` line + cooldown touch when ready. Verified via temp-fixture exercise of both branches.

### Cal #23 round 4 — code-review-parallel envelope migration

**Envelope migration for `code-review-parallel.md`.** Last workflow without EDIT-SOURCE markers; brought up to the canonical pattern. Two compiled regions added (`dispatch:verifier:code_review` + `dispatch:code-reviewer:code_review_parallel`), one new envelope template (`templates/dispatch/envelopes/code-reviewer-code_review_parallel.tmpl.md`) for the synthesis-mode consolidate dispatch.

- **Verify-step drift fix**: parallel verify was missing `<god_node_warnings>`, `{prior_outputs}`, and `{provenance_protocol}` placeholders that the canonical `verifier-code_review.tmpl.md` carries. Migrating to the shared template force-syncs both surfaces — `dispatch compile --check` is now the structural guarantee, replacing the prose-only "KEEP IN SYNC" comment as the enforcement mechanism.
- **Discoverability tip pinned**: lane envelope generation changed from `dispatch render-filled code-reviewer:auto` to `code-reviewer:code_review`. The `:auto` would have resolved to the new synthesis template while `code_review_parallel` is active — wrong for per-file lane review.
- Region count: 20 → 22 regions tracked by `dispatch compile --check`. Zero drift after migration.

### Cal #23 simplification — Round 1+2 (6C, 8E, 7E complete)

Round 2 update: shipped 2 more cuts after the round-1 northstar audit.

**8E — `workflow_id_history` trim to `archive_runs` cap (`215d123` + `2d881d7`).** Greenfield session evidence: history grew to 234 entries while archive_runs cap was 5. Self-healing logic appended + backfilled but never bounded. Added trim after self-heal at state.cjs:993: preserve `original_workflow_id` anchor at index 0, keep last N entries where N = archive_runs. Idempotent self-healing — runs on every state update. K120 locks the contract (10 → 6 entries fixture, anchor preserved). Northstar: bounded growth (#2 quality), smaller workflow.yaml per dispatch (#3 tokens).

**7E — Merge dispatch-scope-guard + dispatch-hygiene-guard hooks (`4057666`).** Two PreToolUse hooks on Task that shared the same matcher and did similar work (parse input, walk to .devt, write forensic record, emit hook output) merged into one. Single subprocess per Task call instead of two. Walk to .devt happens once (state+config in same pass) instead of 3 times. Distinct `source` discriminators preserved in dispatch-warnings.jsonl. Three behavioral tests verify: scope over-cap fires advisory ✓, raw devt:* fires hygiene block ✓, envelope-managed dispatch silently passes ✓. Net change: 5 files, +163/-217 lines.

### Round 3 batch — substantive doc restructure

**N1 — CHANGELOG.md historical archive (`34ef759`).** 141 versioned entries (v0.1.0 → v0.94.1) at 748KB / 4273 lines. Split at the natural v0.50.0 boundary: active CHANGELOG.md retains v0.50.0+ (~84 versions, 432KB), `docs/archive/CHANGELOG-historical.md` gets v0.1.0–v0.49.x (~58 versions, 317KB) with header explaining the split. Active CHANGELOG 42% smaller at every read. `extract-changelog.sh` still works for any v0.50+ version; older versions reachable via archive. Smoke gate exclusion list extended to `^docs/archive/` for the version-ref discipline check + observation_search gate.

**5B partial — Development CLI Reference extraction (`b9fcad7`).** INTERNALS.md was 60KB; the "Development CLI Reference" section alone was 10KB of verbose CLI inventory — operator-onboarding content that belongs alongside the 6C guardrails. Extracted to `docs/operator-guide/CLI-REFERENCE.md`. INTERNALS.md now 50KB (-17%), retains all runtime-load-bearing internals (workflow mechanics, state validation, governing rules, inline guardrails, substance-enforcement gates). CLAUDE.md cross-refs (2 places) updated to the new location. The other INTERNALS sections (CLI Modules 14KB, Workflow Mechanics 14KB, Substance-Enforcement Gates 6KB) stay — they're runtime-load-bearing per the same northstar discipline.

### Cal #23 simplification — Round 1 (6C complete; remaining cuts northstar-validated)

Greenfield Cal #23 surfaced 18 SAFE-marked simplification candidates after deep field evaluation of v0.94.1. Per-cut northstar audit (goals: clear protocols, quality always increases, tokens always optimized, delegate to graphify+claude-mem) demoted 5 from SAFE → SKIP and recategorized 2 from cuts → other:

- **SKIP** `10A inline config keys` — fails goal #2 (operator agency)
- **SKIP** `10C drop FORBIDDEN_KEYS guard` — fails goal #2 (prototype-pollution defense is functional security, not a defensive limit per the standing rule)
- **SKIP** `7B remove DEVT_DISABLED_HOOKS` — fails goal #2 (operator kill-switch agency)
- **SKIP** `7D remove bash-guard denials` — fails goal #2 catastrophically (`rm -rf /` defense)
- **SKIP** `4B trivially-true K-gates` — fails goal #2 (future-regression protection)
- **RECATEGORIZED** `3A 4 single-use asserts` → inline rather than delete
- **RECATEGORIZED** `8C suggestions aging` → feature, not cut

### 6C — Operator-onboarding guardrails moved to docs/operator-guide/

`incident-runbook.md` + `skill-update-guidelines.md` moved from `guardrails/` to `docs/operator-guide/`. Both are on-demand reads (not in INLINE_GUARDRAILS list), so the move is semantic re-location with no runtime impact. Workflow references updated. `guardrails/` directory now contains ONLY files actually injected at dispatch time (CON-001 substance-vs-form applied to directory structure).

### Remaining cuts (deferred to future cycles, ranked by northstar fit)

| Cut | Why deferred from this session |
|---|---|
| 2A/2B/2C agent partials | Fails goal #3 without compile pipeline (agent bodies aren't templated). Pivot to "delete + link" needs K-gate enforcement layer |
| B2 cal-N refs | More nuanced than greenfield estimated; many refs are inline justifications, not pure prose appendix |
| 1E F17 CLI extraction | Substantive — needs careful test surface |
| 5B INTERNALS.md split | Substantive doc restructure |
| 5C COMMANDS.md per-file | Substantive doc restructure |
| 7E merge dispatch guards | Substantive hook refactor — both have K-gate test coverage; merge risk-managed |
| 9A envelope template parameterization | Extends existing template compile system; works with infrastructure rather than against |
| 4C K-gate redundancy consolidation | Requires audit-first then cuts |

Each surviving cut earns its own focused session with northstar re-validation at apply-time. Smoke 864/864.

## [0.94.1] - 2026-06-15

### Meta-gates — prevent next cycle's drift before it happens

The v0.93→v0.94 cycle's introspection surfaced four systematic failure modes the existing drift-guard stack didn't catch. v0.94.1 adds K116–K119 as preventive auto-detectors so future cycles don't repeat the same mistakes.

**K116 — Pipefail+`grep -c` trap auto-detector.** Codifies CON-003. Scans `scripts/smoke-test.sh` for `$(... grep -c ...)` substitutions lacking the defuser pattern (`set +eo pipefail` inside subshell OR `|| FALLBACK` defuser). Pattern caught 5× during v0.93→v0.94, each costing ~15min debug time before the trap was diagnosed. The gate is implemented in node so it doesn't fall into its own trap. Also fixed 7 pre-existing un-defused patterns surfaced by the new gate (K73_ABSENT/PRESENT, K77_B_HAS_URL/PATH/CODE, K79_TMPL_HAS_PLACEHOLDER, M12_REG).

**K117 — K-gate count auto-validator.** Catches the off-by-one drift class observed 3× during v0.93→v0.94 (each release: "X-deep" claim in README + CLAUDE.md drifted from actual smoke-gate count). Counts `^# K(9[4-9]|1[0-9][0-9]):` definitions in smoke-test.sh and verifies both files' `N-deep` + `K94-Ktop` claims match. Was 12-deep/K94-K105 at v0.93.0 → 22-deep/K94-K115 at v0.94.0 (off by 9, drifted forward at each release). Now: gate fails on first drift instead of accumulating until the next manual sweep.

**K118 — CHANGELOG [Unreleased] coverage gate.** Catches the failure mode the v0.94.0 wrap-up exposed: code-surface commits since the last tag (`bin/`, `hooks/`, `workflows/`, `.claude-plugin/`) but `[Unreleased]` is empty. Pre-version-rename check that complements the existing CHANGELOG version-coverage gate. v0.94.0's `[0.94.0]` section was missing the validation pass + axis-H propagation + template source fix content; the gate would have caught the omission pre-commit.

**K119 — Compiled-region EDIT-SOURCE markers.** During v0.94.0 doc-sync, edits to `workflows/code-review.md` inside compiled `<!-- BEGIN dispatch:... -->` regions got reverted by `dispatch compile --write` twice before I realized the body was managed by the compile system. `bin/modules/dispatch.cjs::cmdCompile` now prepends `<!-- EDIT-SOURCE: templates/dispatch/envelopes/X.tmpl.md -->` to every compiled body. Editors viewing the workflow file see the template source path immediately and know where to edit instead. `editSourceMarkerFor` is kept separate from `renderEnvelope` so `dispatch render-filled` output stays marker-free (K2 invariant preserved).

### Why "meta-gates" is the right framing

These four gates don't ship new features. They convert four CON-001-class telemetry-without-enforcement gaps into hard automated checks. The meta-pattern: **every recurring failure mode the cycle introspection surfaced becomes a smoke gate.** v0.93.x's "validate-input-boundaries" methodology operated on user input; v0.94.0's "telemetry-to-enforcement" operated on gate results; v0.94.1's meta-gates operate on the cycle's own documentation and infrastructure. The methodology spiral closes one more layer.

Drift-guard stack now **26-deep (K94–K119)**. Smoke 864/864, locking 3/3.

## [0.94.0] - 2026-06-15

### Cal #22 Round 1 — Telemetry to Enforcement (F1 + F2 + F3 + F4)

Greenfield's deep field session against v0.93.3 produced a 9-finding audit with a coherent theme: gates that compute structured signals but don't enforce them. Three distinct gates fit the pattern (`assert-graphify-decision` informational drill-down fields, verifier rubric axis taxonomy, `check-symbol-godnodes` non-monotonic aggregation). All trace to the same CON-001 substance-enforcement-gates concept — instances 6 and 7 added to its field-validated table.

**F1 — `assert-graphify-decision` gate flip (greenfield I1).** Field evidence from greenfield: 5+ prior sessions skipped the F16 top-3 drill-down step entirely (0 `get_neighbors` MCP calls, 0 drill-down sections in `graph-impact.md`) while the gate returned `ok:true` because `under_three_drill_downs` was informational only. Flipped: when `plan_tier ∈ {symbol_anchored, bulk_scoped}` AND 0 calls AND 0 sections AND `graphify_decision_mode === "block"` (new config knob, default block), gate returns `ok:false` with operator-actionable reason. Opt-out via `.devt/config.json::graphify_decision_mode: "warn"` mirrors the `dispatch_hygiene_mode` pattern. K114 locks the contract across block + warn cases.

**F2 — Verifier walk-all-axes contract (greenfield Q1).** Field evidence: greenfield's verifier walked rubric axes A–G and stopped at G, silently skipping axis H (`## Axis H — Dispatch warnings acknowledgment` added in v0.93.3). Verdict came back `satisfied` despite the missing axis grade. Two-layer fix:
- **Rubric:** Renamed `## Required: Dispatch warnings acknowledgment` → `## Axis H — Dispatch warnings acknowledgment` in `references/rubrics/code_review.v1.md` so it sorts naturally with the table-style A–G axes. Verifier prose updated in `agents/verifier.md` to mandate walking every axis (both `^## Axis [A-Z] —` heading and `^\| **X.` table-row patterns).
- **Post-hoc check:** New CLI `state assert-verifier-graded-all-axes` reads `verification.json::criteria_total` and compares against the count of axes in the pinned rubric body (hybrid heading + table-row detection). Mismatch → `ok:false` with `missing_axes_count` surfaced. Workflows whose rubrics don't use axis taxonomy (e.g., `dev` uses verification levels L1–L5.5) return `ok:true` with explicit skip reason. K115 locks the contract across miss + match + skip cases.

**F3 — `check-symbol-godnodes` non-monotonic diagnostic (greenfield Q2/Q-final).** Field evidence: greenfield's bisect grid showed non-additive aggregation across 2–3 file combinations (A+B → lost A's god-node, C+D → lost C's, etc.) with correct aggregation at N≥4 (order-invariant). Reproducer: `check-symbol-godnodes app/core/error_codes.py app/services/clients/api/v1/relative_action_routes.py` returns `[]` in greenfield's env vs `[{symbol:"ErrorCode", ...}]` in devt's. Code-level inspection shows clean single-pass Set lookup with no obvious non-monotonic logic; the divergence between environments suggests graph-state coupling (cached `nodeMap` topology or `loadGraph()` return-shape variance across rebuilds). Conservative scope: shipped a structured diagnostic comment block at `bin/modules/graphify.cjs:1385` with field-debugging hints; deferred code fix until reproducible. The bug class is documented for future cycles.

**F4 — CON-001 sixth and seventh instances.** Updated `.devt/memory/concepts/CON-001-substance-enforcement-gates.md::Field-validated instances (now 7)` with C22F1 (gate flip) and C22F2 (walk-all-axes). The CON-001 pattern is now structural to devt's design vocabulary — 7 field instances over 6 months means any new gate that returns structured fields without enforcing them inherits the concept's accumulated lessons.

### Validation pass + axis-H propagation (pre-tag fixes)

A `/simplify` code review on the cal #22 batch caught two findings that would have shipped silently otherwise:

**Validation Finding 1 — `assert-verifier-graded-all-axes` was unwired.** The new state CLI existed and `agents/verifier.md` prose claimed "mismatches fail the workflow's verify step" — but no workflow actually called the CLI post-verifier. Same UX failure mode as cal #21 V6 (CLIs that operators must remember to invoke get forgotten), ironically reintroduced by the same commit that diagnosed the pattern. Wired into `workflows/code-review.md::verify step`: immediately after reading `verification.json`, the workflow calls `assert-verifier-graded-all-axes`; on `ok:false`, it overrides the verifier's self-reported verdict to `needs_revision` and re-dispatches with the missing-axes reason as `<reviewer_feedback>`. The routing skips the verdict block when `AXES_COVERAGE_GAP=true` so the verifier's stale verdict doesn't poison the RETRY decision.

**Validation Finding 2 — charCode boundary for rubrics with > 26 axes.** `String.fromCharCode(64 + rubricAxesPresent)` produced non-letter chars at 27+ (charCode 91 = `[`). Clamped to `"Z+"` for the edge case so the gate's user-facing reason stays legible. Visible-only — gate logic unaffected.

**Doc propagation sweep.** Three forward-looking instructions still said "walk axes A–G" and would have led the code-reviewer agent + verifier dispatch to silently skip axis H — the exact failure mode F2 was designed to prevent. Updated:
- `agents/code-reviewer.md::Rubric self-check (C7-7)` — walks every declared axis including H; cites cal #22 §Q1 as failure precedent
- `docs/AGENT-CONTRACTS.md::Reviewer rubric self-check` — clarified hybrid taxonomy (table A–G + heading H); described post-hoc enforcement
- `templates/dispatch/envelopes/code-reviewer-code_review.tmpl.md` — source-of-truth for the compiled rubric-self-check region in `workflows/code-review.md`. Editing the workflow body directly was reverted by `dispatch compile --write`; updating the template source + recompile persists correctly.

The K1 dispatch-drift gate caught the compile-cache staleness during the doc-sync pass and pointed back to the template source — exactly the kind of architectural discipline check the gate exists for.

### Doc sync to v0.94.0 reality

- `README.md`: drift-guard count 12-deep K94–K105 → 22-deep K94–K115; smoke assertion count 850+ → 860+; scope blurb extended (telemetry-CLI input validation + push-not-pull session signal surfacing + substance-enforcement gates per CON-001)
- `CLAUDE.md`: drift guards K94–K100 → 22-deep K94–K115
- `docs/INTERNALS.md`: state CLI reference adds `assert-verifier-graded-all-axes` entry + extends `assert-graphify-decision` to document the cal #22 F1 gate flip semantics

Drift-guard stack now **22-deep (K94–K115)**. Smoke 860/860, locking 3/3, K1 dispatch-drift 0 across 20 compiled regions.

## [0.93.3] - 2026-06-15

### Cal #21 Round 5 V6 — push-not-pull session signal surfacing

Greenfield's V6 honest answer in calibration round 5 revealed an LLM-operator UX failure mode that wasn't anticipated when the cal #21 telemetry changes shipped: A2 (`/devt:status` dispatch warnings line), A2b (PostToolUse return-time hint), A4 (`state check-inherited-edits` CLI) were all infrastructure-correct but **operator-passive** — operators forget the CLIs exist when head-down in a workflow. Greenfield's own confession: "I had the exact use case for `state check-inherited-edits` and forgot it existed." Two concrete fixes inverting the surfacing semantics from pull to push:

**G1 — UserPromptSubmit hook injects session-scoped signals.** Extended `hooks/workflow-context-injector.sh` so the next-prompt `additionalContext` line includes session-scoped signal counts when present (suppressed when both zero). When an active workflow has any raw_dispatch entries since `first_created_at` in `dispatch-warnings.jsonl` OR uncommitted source edits with mtime > workflow start, the hook adds a second line to the existing workflow-status output:

```
[devt session signal] N raw_dispatch + M cliff signal(s); K uncommitted source edit(s) since workflow start
  — inspect: dispatch warnings --by-source | state check-inherited-edits
```

The operator sees the signal at the moment they're issuing the next prompt — no `/devt:status` invocation required. Performance cost: ~50–100ms per UserPromptSubmit (JSONL scan + git status with 1s timeout). Fail-open on any probe error. K112 validates both quiet (no signals → workflow line only) and loud (recent raw_dispatch → workflow + session-signal lines) cases.

**G3 — Verifier rubric mandates `## Dispatch warnings (session-scoped)` section in `verification.md` + `review.md`.** Both `references/rubrics/dev.v1.md` and `references/rubrics/code_review.v1.md` now require finalize-time acknowledgment. The verifier emits `needs_revision` with a `dispatch-warnings` gap when the section is absent. Skip condition: `n/a (no incidents logged this session)` when the JSONL is absent or empty. K113 validates both rubric files contain the requirement + section title.

### Pipefail trap caught for the 5th time (now CON-003-aware)

K112's first attempt hit the same pipefail + `grep -c` + command-substitution trap CON-003 documented as caught 4 times in v0.93. Set count to 5: the `set +eo pipefail` inside the subshell is insufficient when the OUTER script's `set -e` triggers on the substitution's non-zero exit. Required defuser is `|| FALLBACK` appended to the substitution itself, not just inside the subshell. CON-003 reference template should be updated to show both defuser layers in the next revision cycle.

Drift-guard stack now **19-deep (K94–K113)**. Smoke 858/858, locking 3/3.

## [0.93.2] - 2026-06-15

### CLI input validation sweep (post-v0.93.1)

The validate-input-boundaries methodology continued to surface instances of the silent-wrong-result UX bug class across additional CLI surfaces. All shipped as exit-2-on-invalid with stderr error message, matching the pattern established by K106/K109.

**`memory query --limit` + `memory links --depth`.** `memory query --limit=garbage|-5|0` silently propagated NaN through to the FTS5 prepared statement and returned 0 results; `memory links --depth=garbage` did the same for graph traversal. K110 added.

**`preflight generate --budget`.** Silently kept the default budget on invalid input — user's tuning intent was ignored without any signal.

**`graphify neighbors --depth`.** NaN propagated through `getNeighbors` and produced unpredictable empty results.

**`graphify neighbors --max-bytes`.** Silently kept the default cap on invalid input — user could not narrow the result size as requested.

**`graphify symbols-in-files --limit`.** `parseInt(...) || 10` fallback masked invalid input by silently returning the default-10 result instead of the user's intended N. K111 added covering all 4 graphify+preflight flags.

Drift-guard stack now **17-deep (K94–K111)**. Smoke 856/856, locking 3/3.

### Validation methodology summary (post-v0.93.0)

This cycle's "validate-input-boundaries" sweep caught 9 instances of the silent-wrong-result bug class across 6 CLI surfaces — dispatch warnings (2 flags), mcp-stats (1 flag), token-report (3 cases), memory query/links (4 cases), preflight generate (1 flag), graphify neighbors/symbols-in-files (3 flags). All shipped with the same exit-2-with-stderr-error contract. K106/K110/K111 lock the rejection behavior in CI. Six discrete bug classes that all reduce to "the function evaluated an invalid input the same way it would evaluate a missing input" — a Number()/parseInt() landmine that's prevalent in zero-dep Node CLI code.

## [0.93.1] - 2026-06-14

Post-v0.93.0 fix-up batch. Two parallel threads landed back-to-back: (a) an audit-driven sweep that surfaced YAML-naive extraction bugs in two smoke gates + silent-wrong-result UX bugs in three CLI surfaces; (b) greenfield calibration #21's full incorporation cycle (10 actions across 4 commits). Both threads were systematic — not "what looked broken" but "what would a structured probe of the input boundaries find?"

### Audit-driven fix sweep (4 commits)

**K105 YAML-aware extraction fix (`47b9a98`).** Phase 12's K105 silently miscounted 6 of 17 skill descriptions. The awk extractor only handled YAML block scalars (`description: >-`); for inline-style (`description: Foo bar...`) it skipped the inline content with `next` and counted trailing frontmatter fields instead. 4 inline-style skills had descriptions 500–700 bytes longer than reported. K105 had been structurally unable to catch inline-style bloat since shipping. Fixed with node-based YAML-aware extractor; budget unchanged at 950 bytes (current true max is 777b, architecture-health-scanner).

**Command description gate twin fix (`b0f5596`).** Same root cause as K105 lived at `scripts/smoke-test.sh:3526` — the "Command description budget" gate's awk reported `2` bytes (the `>-` marker length) for any future YAML block-scalar command descriptions. Currently all 19 commands use inline style so the bug was latent; the fix prevents future silent regression. Same YAML-aware extractor applied.

**dispatch warnings input validation (`c608340`).** `dispatch warnings --since=garbage` used string comparison `e.ts >= "garbage"` — alphabetically "g" > "2026-..." so the filter silently returned 0 results (user saw "no incidents in range" — wrong conclusion). `--limit=-3` returned `slice(-(-3))` = `slice(3)` on a 1-entry array → empty result. Both now reject with exit 2 + stderr error. K104 extended to lock the rejection contract.

**Telemetry CLI input validation (`ccacd7f`).** Same bug class at three sites: `mcp-stats --since=invalid` silently no-op'd the filter (NaN > 0 is false); `token-report --since=invalid` ditto; `token-report --sessions=garbage` → `slice(0, "garbage")` coerces to `slice(0, 0)` → 0 sessions; `token-report --sessions=-5` → `slice(0, -5)` removes last 5. All four now reject with exit 2 + stderr error. K106 added to enforce the rejection contract across both telemetry CLIs.

### Calibration #21 incorporation (2 commits)

Greenfield calibration #21 ran across 3 rounds (full questions → honest answers → F21 falsification test → F26 organic discovery during test). The findings produced 10 distinct actions spanning behavior + docs + memory.

**Behavior changes (`4fcfb6e`):**

- **F26 — Cliff detector proportional-response gate.** Discovered during the F21 falsification test itself: a 112-byte probe prompt with a 39-byte reply tripped `low_output` and produced a false-alarm SendMessage-resume hint. Real cliff hits happen when an agent processes a substantial input but returns a stub. `low_output` now requires prompt ≥ 1000 bytes to fire (real workflow dispatch territory). K107 locks both halves of the contract.

- **A4 — `state check-inherited-edits` CLI subcommand.** W12 case (cal #21 F-OBS-1 + F23): subagent died at credential expiry; retry inherited a `str | None` type from the partial prior session and silently self-corrected to `PScope`. Operator had no programmatic signal that files had been modified. New CLI runs `git status --porcelain` filtered by `workflow.yaml::first_created_at` to surface uncommitted source edits with a recommendation (clean / review / ambient_uncommitted). K108 validates the response shape across 3 fixture states.

- **A2 — `/devt:status` raw_dispatch + cliff-signal counts.** F12 surfaced a discoverability gap: operator didn't know `dispatch warnings` CLI existed. `/devt:status` now includes a threshold-gated line showing session-scoped counts from both `dispatch-warnings.jsonl` sources. Inclusion rule suppresses the line when both counts are zero.

- **A2b — PostToolUse raw_dispatch return-time hint.** F24 operator preference: catch the signal in the act-on-it window (PostToolUse return time) rather than wait for an explicit `/devt:status` call. `task-truncation-detector.sh` now emits a one-line hint in `additionalContext` regardless of whether THIS dispatch tripped a cliff, when any raw_dispatch entries exist within the last 60 minutes. Operator-confirmed chattiness trade-off. K109 validates 3 cases (quiet / loud / aged-out).

**Documentation + memory (`ff78fb1`):**

- **A0 + A9 — Envelope-managed dispatches are intentionally silent.** F21 falsification confirmed: dispatch-warnings.jsonl shows entries only for envelope-LESS dispatches. New section in `docs/COMMANDS.md` spells out the classification rules so future operators don't repeat F21's mental-model gap ("no entries means hook didn't fire" — wrong; could also mean "all dispatches were envelope-managed").

- **A1 — `low_output` canary recipe.** F22 surfaced the distribution: greenfield's `low_output` is the dominant signal (6% vs 0% near_cliff vs 2% mid_task_language). Recipe focuses on `low_output` as the credential-expiry / auth-fail / 91-tool-wall canary with specific recovery prescriptions for each.

- **A3 — Parallel sub-agent dispatch recipe.** F13: operator hand-rolled parallel dispatches because the recipe was buried in `workflows/quick-implement.md`'s `<step name="implement">` block. New section in `docs/COMMANDS.md` spotlights `dispatch render-filled` as the canonical envelope source and cross-references `workflows/code-review-parallel.md`.

- **A5 — Inheritance-check protocol in programmer.md.** Cal #21 §1 F1 reference added to `agents/programmer.md::<self_check>`. If a programmer finds substantive work in a file it didn't write THIS dispatch, surface in `impl-summary.md::## Deviations` as `[Inherited] <file>:<symbol> — found X, corrected to Y`. Anchors the W12 pattern at the code surface future agents read.

- **A6 — CON-002 memory concept.** Memorialized the F18 signal flip (devt 99.7% raw_dispatch vs greenfield 84.7% task_output_bytes) as a permanent Concept in `.devt/memory/concepts/CON-002-dispatch-telemetry-signal-flip.md`. Includes W12 case field evidence + concrete instrumentation table so future telemetry work has a reference for cross-project signal validation.

- **A8 — Command-surface decision tree.** F25 explicit ask: "When should I dispatch sub-agents directly vs through /devt:workflow?" New file `docs/COMMAND-SURFACE-MAP.md` provides the decision tree, what-each-path-does breakdown, when-NOT-to-bypass framing, and a state-reference table.

### Methodology lesson surfaced this cycle

**The pipefail + `grep -c` trap caught us 4 times.** K98 (Phase 2.6), K103 (Phase 11), K104 input-validation extension, and K109 — each time a pipeline ending in `grep -c` or `comm` returning empty-but-zero broke silently under `set -euo pipefail`. Pattern: `node ... | grep -c "..."` where node may exit non-zero AND grep returning 0 matches both propagate via pipefail. Fix: `set +eo pipefail` in each test subshell. The lesson is worth a permanent reference for future smoke gate authors but the doc surface for it is TBD; current best practice is to look at K106 or K109's structure as the template.

### Drift-guard stack — now 15-deep (K94–K109)

| Gate | Surface |
|---|---|
| K94–K100 | command stratification + parameter routing + stale-ref scans (Phases 1-5) |
| K101 | CLAUDE.md size budget (Phase 6.5) |
| K102 | inline guardrails size budget (Phase 10) |
| K103 | workflow_type 4-way registry parity (Phase 11) |
| K104 | dispatch warnings CLI surface + input validation (Phase 11 + this batch) |
| K105 | skill description size budget — NOW YAML-aware (Phase 12 + this batch) |
| K106 | mcp-stats + token-report input validation (this batch) |
| **K107** | **cliff detector proportional-response gate (cal #21 F26)** |
| **K108** | **state check-inherited-edits response shape (cal #21 A4)** |
| **K109** | **PostToolUse raw_dispatch return-time hint emit semantics (cal #21 A2b)** |

Smoke 854/854 (was 850 at v0.93.0 tag), locking 3/3.

## [0.93.0] - 2026-06-13

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

### Phase 12 — Deferred-queue hygiene + K105 skill description budget

Final mini-bundle before tag. Queue audit found 44 open deferred items; validation reduced four to actionable status:

- **DEF-042** ("Close stale DEF-007, 010, 011, 016") — already done. All 4 referenced items closed `2026-06-01`; the cleanup task itself was the only thing left to close.
- **DEF-040** ("Document `dispatch_hygiene_mode` config key") — gap doesn't exist. Strict re-grep shows the key documented in `docs/HOOKS.md` plus 7 other files (`docs/AGENT-CONTRACTS.md`, `docs/INTERNALS.md`, `workflows/code-review.md`, `workflows/dev-workflow.md`, `bin/modules/state.cjs`, `bin/modules/config.cjs`, `README.md`).
- **DEF-041** ("3 missing env vars in HOOKS.md") — false-positive from loose regex. Strict `${DEVT_*:-default}|${DEVT_*}|export DEVT_|test DEVT_` pattern returns empty for undocumented vars. Original grep matched substrings: `DEVT_BIN` (label in session-start help-text dump), `DEVT_CONFIG` (substring of local `HAS_DEVT_CONFIG` presence-flag), `DEVT_COUNTER_DIR` (substring of private `_DEVT_COUNTER_DIR` internal var). The 7 actually-documented env vars are the complete set in use.
- **DEF-006** ("Skill description budget for `skills/`") — implemented as K105.

**Validation discipline win.** Three of the four items shifted on re-validation: 1 already done, 2 false-positive (no real gap), 1 implementable. Had `DEF-041`'s loose-grep claim been taken at face value, the cycle would have shipped documentation rows for three non-existent config knobs — exactly the failure mode Golden Rule 7 ("Validate Before Implementing") guards against. Captured here because the pattern is general: long-deferred items can drift from real-when-captured to false-now-without-anyone-noticing.

**Added: `scripts/smoke-test.sh::K105`** — skill description size budget. Caps every `skills/*/SKILL.md` frontmatter `description` field at **950 bytes** (current max 835 for `strategic-analysis` + ~14% headroom matching the K101/K102 pattern). Skill frontmatter descriptions are the model's routing-trigger signal — included in the Skill tool's per-session catalog prompt — so unchecked growth burns prompt budget across all 17 skills every session. Adversarially validated: temporarily lowering the budget to 800 → fails with exact 3 overflow skills (`code-review-guide=830b`, `strategic-analysis=835b`, `verification-patterns=832b`); restoring → passes. Drift class: skill descriptions ballooning into README territory.

The drift-guard stack is now **12-deep (K94–K105)**. Smoke: 850/850. Locking: 3/3.

**Deferred queue:** 44 open → 40 open (closed: DEF-006, DEF-040, DEF-041, DEF-042).

---

### Phase 11 — Registry hardening + dispatch telemetry surface

Three validated drift/feature fixes bundled. Origin: post-Phase 10 audit asked "what's worth shipping before tagging?" — measurement disproved theoretical candidates (engineering-principles/generative-debt trim, agent body trim, paths: expansion all rejected by 0 pedagogy markers and 100% operational density). Three real gaps surfaced instead.

**F1 — `workflows/status.md` routing table 4-row drift fix.** Direct measurement: `state.cjs::VALID_WORKFLOW_TYPES` holds 15 types, `workflows/next.md` routing table has 15 (parity), `workflows/status.md` had **11** — silently missing `dev`, `debug`, `retro`, `arch_health_scan`. Drift had persisted for weeks (memory observation 947 flagged it on May 7; never fixed). Effect: a user running `/devt:status` mid-workflow on any of those 4 types fell through the routing table to the catch-all bottom rows and got no resume guidance specific to their workflow type. Added 4 rows matching the next.md canonical resume commands.

**F2 — `scripts/smoke-test.sh::K103` 4-way registry parity gate.** `CLAUDE.md::workflow_type Registry` claimed "the smoke test enforces presence in both surfaces" — `grep` confirmed no such gate existed; the claim was false. The F1 drift had been ship-able because nothing structurally enforced parity. K103 enforces 4-way parity across `state.cjs::VALID_WORKFLOW_TYPES` ↔ `next.md` routing table ↔ `status.md` routing table ↔ workflow-body `state update workflow_type=…` assignments. Validated adversarially: temporarily reverted F1 → K103 reported the exact 4 missing types with actionable remediation. Restored F1 → K103 passes. Drift class: silent registry/router divergence.

**Implementation footgun (now documented inline):** under `set -euo pipefail` (line 14), the pattern `comm -23 <(A) <(B) | grep -v '^$' | tr '\n' ',' | sed 's/,$//'` exits 1 when `comm` produces empty output (the clean case — no drift) because `grep` finds no matches. `pipefail` propagates and `set -e` kills the script silently between K102 and the result echo. Defused with `|| true` on each pipeline. Same failure mode that bit K98 in Phase 2.6.

**F4 — `node bin/devt-tools.cjs dispatch warnings` CLI.** `hooks/dispatch-hygiene-guard.sh` had been writing `.devt/state/dispatch-warnings.jsonl` for weeks on every raw_dispatch incident (a `Task(devt:* …)` call without a workflow envelope), accumulating **2,495 entries** spanning May–June 2026. No read surface existed; the telemetry sat unused. New `cmdWarnings()` in `bin/modules/dispatch.cjs` surfaces it:

| Flag | Output |
|---|---|
| (default) | Summary: total, span, by_source breakdown, top 5 agents, last 5 recent |
| `--by-source` | Counts grouped by `source` field |
| `--by-agent` | Counts grouped by `agent` field, sorted descending |
| `--limit=N` | Truncate output to N most-recent entries |
| `--since=ISO` | Filter to entries with `ts ≥ ISO` |
| `--raw` | Return full entry objects (`entries[]`) instead of aggregations |

JSON output, pipable to `jq`. North-star vector 1 (coordination via clear protocols): silent telemetry now actionable.

**First measurement from the new CLI:** of the 2,495 raw_dispatch incidents, 2,189 (87.7%) targeted `devt:code-reviewer`, 307 (12.3%) `devt:programmer`. Validates the workflow envelope discipline lives where the highest-frequency raw-dispatch attempts are caught.

### Added

- **`scripts/smoke-test.sh::K103`** — `workflow_type` registry 4-way parity gate (see F2 above).
- **`scripts/smoke-test.sh::K104`** — `dispatch warnings` CLI surface contract (summary keys, `--raw --limit=N` truncation, `--by-source` aggregation, missing-file graceful response, `cmdWarnings` exported).
- **`node bin/devt-tools.cjs dispatch warnings`** + 5 flags (see F4 above).
- **`workflows/status.md`** — 4 routing-table rows for `dev`, `debug`, `retro`, `arch_health_scan`.

The drift-guard stack is now **11-deep (K94–K104)**. Smoke: 849/849. Locking: 3/3.

### Validated NOT shipped

- **Trim `engineering-principles.md` + `generative-debt-checklist.md`.** Direct measurement: 0 "Common violation / Example / For example" markers in either file. Phase 10's trim pattern relied on extracting these markers; without them there's nothing to extract.
- **Agent body trim.** Read of `agents/programmer.md` (largest, 446 lines): lines 1–237 operational protocol, 239–274 deviation-rule decision tables (load-bearing logic), 395–446 the impl-summary.md output template (sidecar contract — moving it would break the JSON sidecar shape downstream consumers depend on). Zero pedagogy markers across all 11 agent bodies. Agent bodies are dense protocol, not reference.
- **Delegate `memory-graph.cjs` to graphify.** Different graphs: `memory-graph.cjs` traverses the memory layer's SQLite `links` table (relationships between ADR/Concept/Flow docs); graphify traverses source-code symbols. Correctly separated, no overlap.
- **Standardize `phase=context_init` naming across all 15 registered workflow_types.** Of 15 workflow_types, 11 use `phase=context_init` + `<step name="context_init">`, 4 use alternative init phase names (`phase=debug` + `step name="init"`, `phase=retro` + `gather_context`, `phase=arch_health_scan` + `check_scanner`, `phase=docs` + `gather_context`). All 4 bootstrap state identically; the variation is cosmetic. Renaming would touch 4 files for no behavioral gain.
- **Agent frontmatter uniformity audit.** All 11 agents already declare `model`, `effort`, `maxTurns`, `color`, `skills`, `tools` — no drift to fix.

---

### Phase 10 — Inline guardrails trim + K102

After Phase 6 trimmed CLAUDE.md by 29.9%, audit found the **inline guardrails block** (`init.cjs::loadInlineGuardrails`) is the *other* large per-dispatch context payload — **27,092 bytes** (golden-rules.md + engineering-principles.md + generative-debt-checklist.md) injected as `<guardrails_inline>` into every programmer/code-reviewer dispatch. Same lever as Phase 6, applied to a different surface.

**Approach** (validated against CC best-practices: "for each line, ask whether removing it would cause Claude to make mistakes"): each Golden Rule has 4 sections — **What** (rule statement), **Why** (rationale), **Common violation** (pedagogy/examples), **Practice** (how-to). What/Why/Practice are behavioral content agents need at decision time; Common violation examples are reference material for pattern recognition that the agent can consult on demand.

**Moved**: "Common violation" subsections of all 15 rules → new `docs/GUARDRAILS-REFERENCE.md`. `golden-rules.md` gains a single pointer line at the top.

### Metrics

| Surface | Before | After | Δ |
|---|---:|---:|---:|
| `guardrails/golden-rules.md` | 16,259 bytes | 12,813 bytes | −3,446 (−21.2%) |
| `docs/GUARDRAILS-REFERENCE.md` (new) | — | 4,876 bytes | + |
| **Inline guardrails total per dispatch** | **27,092 bytes** | **23,646 bytes** | **−3,446 (−12.7%)** |

Across N programmer/code-reviewer dispatches per workflow this compounds. Combined with Phase 6 CLAUDE.md slim (−10,651 bytes per dispatch), the cycle now saves **~14,097 bytes of static context per dispatch**.

### Added

- **`scripts/smoke-test.sh::K102`** — inline_guardrails size budget gate. Caps `golden-rules.md + engineering-principles.md + generative-debt-checklist.md` total at **27,000 bytes** (Phase 10 result + ~14% headroom). Same pattern as K101 for CLAUDE.md. Drift class: detailed pedagogy accumulating in guardrails/ instead of docs/GUARDRAILS-REFERENCE.md. Remediation message points the maintainer at the right pattern.

The drift-guard stack is now **9-deep (K94-K102)**.

Smoke: 846/846 (K102 added, K101 unchanged). Locking: 3/3.

### Engineering-principles.md and generative-debt-checklist.md — left as-is

These two files were validated against the same pattern but NOT trimmed. They have less pedagogy/example content and a tighter rule-to-practice ratio. The trim ratio would be small (~5-10%) versus the maintenance cost of restructuring. K102's 27,000-byte budget covers them; if they grow significantly, future maintenance can apply the Phase 10 pattern then.

---

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


---

**Historical releases (v0.1.0–v0.49.x)** archived to [`docs/archive/CHANGELOG-historical.md`](docs/archive/CHANGELOG-historical.md) per Cal #23 N1 simplification.
