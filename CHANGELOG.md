# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/). The `[Unreleased]` section below stages changes for the next version — when bumping, rename it to `## [X.Y.Z] - YYYY-MM-DD` so the release workflow's changelog extractor (`scripts/extract-changelog.sh`) can find it.

Older releases (v0.1.0–v0.162.0) are rotated into `docs/archive/CHANGELOG-historical.md` — the root file keeps `[Unreleased]` plus the most recent releases (rotation ceiling enforced by smoke gate K288).

## [Unreleased]

## [0.224.0] - 2026-07-31

The proef latest-run batch — the correctness fix proef ranked first, plus two right-sized companions. Each fix site validated against the tree before the edit; the replay harness (v0.223.0) gained cases for the two that touch its surface, so this field defect is now a regression test.

### Fixed

- **F2 — the completeness-denominator conflation (correctness; proef's #1).** A consolidator echoed "complete across all 161 files" from `memory_signal.files_checked` while the actual review covered fewer — the affects-scan universe (161, which folds a gitignored scope artifact) was used as the review-completeness denominator, which is `code-review-input.md` (160, rubric Axis A). Root cause included this project's own v0.220 "name the universe" wording: labeling it "scope file(s)" *invited* the misread. Fix: the empty-governance claim is reframed to `no ADR/CON/FLOW governs any of the N file(s) scanned for governance` (un-conflatable with review scope), and the code-reviewer contract now states explicitly that `files_checked` is the governance-scan universe and **never** a completeness figure — completeness is measured against `code-review-input.md` only. Guarded by an updated replay-harness case (mutation-verified).
- **F1 — the governance layer degrades loudly.** On a project with 0 `.devt/memory/` docs the entire ADR/CON/FLOW apparatus + rubric Axis E silently no-op'd — an empty layer looked identical to a compliant one, so an operator could read the N/A as a pass. `review-context-init` now detects an empty layer (`scanDocs().length === 0`), sets `memory_signal.governance_active: false`, adds `memory_layer_empty` to `degraded_fields`, and emits a loud stderr banner. A populated layer is silent. New replay-harness case (mutation-verified). Indexing external `docs/adr/*` is deferred — proef's guidance: only if it real-parses (status/supersedes/decision text), never keyword-greps, and for *signal* not adjudication.
- **F4 — the `god_node_match` apparent contradiction.** proef saw `workflow.yaml::god_node_warnings_json.god_node_match=false` while `blast_radius=true` and read it as a bug. They are two different questions ("are the changed symbols themselves god-nodes?" vs "does the diff's caller closure reach god-nodes?") that can legitimately differ. Validation showed the field is coupled across 8 preflight sites + the code-reviewer contract + the template — so a serialized-field rename risked creating drift for a cosmetic gain. Right-sized to the clarity fix that resolves the actual concern (trust erosion): the code-reviewer contract now documents that the two values answer different questions and that `blast_radius`'s value is authoritative for severity.

Not built this batch, by design: F5 (parallel-offer "% mechanical" churn signal — medium) and the F.14 cross-workflow state-contention rework (a graphify-update subagent blocked a review `reset-soft` — real friction, but it's the corruption-prevention guard and needs a design pass, not a rushed edit). Both recorded for follow-up.

## [0.223.0] - 2026-07-30

The orchestration replay harness — the improvement two independent field evaluations (task-service, proef) converged on, and the answer to the standing "untestable orchestration layer" concern. The workflow layer is ~10.5K lines of LLM-executed prose whose `field:` notes are a scar-tissue log of past silent failures no test could catch; this begins converting that class into regression tests.

### Added

- **`scripts/replay-orchestration.cjs` + gate K337.** Records a `.devt/state/` fixture for a known precondition, drives the *real* producer/gate CLI sequence the workflow prose invokes, and asserts the block/advance decision the prose promises — pure CLI, no LLM, CI-buildable (the `assert-*` and context-init verbs are pure and CLI-addressable). Distinct from `test-gates.cjs` (single-gate unit tests): this replays producer→gate *seams* against what the producer actually emits. Three cases, each citing the `field:` note it guards:
  - **Explicit-scope bundle re-anchor** — a pre-written `code-review-input.md` (5-file scope) plus a 3-file diff asserts `review-context-init`'s memory_signal derives from the scope universe, not the diff. Regression-guards the v0.220.0 F2 fix (mutation-verified: reverting F2 reds the case).
  - **Union scope on uncommitted work** — a fixture where `git diff base...HEAD` is empty but the working tree + untracked files are the review target asserts `state changed-files` unions them.
  - **Graphify-decision three-state contract** — a `symbol_anchored` plan asserts the gate blocks on missing drill-downs, blocks on drill-downs *unbacked by real `get_neighbors` MCP-trace records* (the anti-fabrication / provenance check — proef's sharpened substance-gate point, already live in this gate), and advances only when the drill-downs are both substantive and MCP-traced.

The design was settled by proef's filled receipt: pure gate-sequence replay first; the envelope↔gate stub-agent stage (which its provenance finding motivates) is deferred to a follow-up. Not built from this evaluation: the retracted dispatch-hygiene warn-default flip (proef's own run evidence showed block-default worked exactly as designed and warn would have been ignored).

## [0.222.0] - 2026-07-30

Adopted the strongest angle of Claude Code's built-in `/simplify` — the **altitude** lens (right-depth / generalize-vs-special-case) — into devt's read-only review path, and corrected a stale description of the skill devt already delegates to.

### Added

- **"Altitude" review category in `code-review-guide`** — is each change at the right depth, or a fragile bandaid? Flags special cases that should generalize the underlying mechanism, second code paths that should unify onto one, symptom-patches one layer above their cause, and derived-and-stored state. It's the read-only, review-time complement to the "One Way To Do One Thing" golden rule. Deliberately a review *technique*, not a graded rubric axis — so it reaches standalone `/devt:review` and the SIMPLE/TRIVIAL tiers (which skip the simplify step) without touching the verifier's `criteria_total` axis-count contract. (In STANDARD+ dev flows the `/simplify` step already runs this lens with fixes before review.)

### Fixed

- **The dev-workflow `simplify` step described `/simplify` wrong.** It claimed "3 parallel review agents (reuse, quality, efficiency)"; the built-in skill it invokes now runs **4** (reuse, simplification, efficiency, **altitude**), and "quality" was never one of them. Behavior was already current (the step delegates to the live skill) — only the prose had drifted. Also corrected the guide's "evaluate all 6 categories" anti-pattern line to 7 (the altitude add).

Non-goal, by design: devt does **not** copy `/simplify`'s content — its simplify step single-sources to the built-in skill (correct per "One Way To Do One Thing"; duplicating it would be the defect the rule names). This change adds only the review-time *lens* the read-only reviewer lacked.

## [0.221.0] - 2026-07-30

A new language-agnostic golden rule — and the cross-template alignment its absence exposed. The rule was found living in only 2 of 6 templates, which is itself the defect the rule names.

### Added

- **Golden rule "One Way To Do One Thing"** — every capability has exactly one canonical implementation, command, code path, and format; when a second way appears (duplicate helper, parallel command, second service, alternate on-disk format), unify onto one and delete the other in the same change. New redundancy is a defect even when both paths work, because drift between two "equivalent" paths is a bug generator. Added byte-identical to **all six** templates (`blank`, `go`, `python-fastapi`, `rust`, `typescript-node`, `vue-bootstrap`) and devt's own `guardrails/golden-rules.md` (folded into the existing Rule 9 "One Obvious Way" as its system-level generalization — expanded, not duplicated). In go/typescript-node it *replaces* the old code-level "One Obvious Way" rule, whose reuse content already lived in Rule 2 (No Duplicate Features) — one rule, not two.
- **Gate K336** — the canonical rule must be present in every template's golden-rules.md and in guardrails. Drift guard for the class that just bit: "One Obvious Way" had silently drifted into only go + typescript-node. Mutation-proven (stripping it from any template reds the gate, naming the template).

### Changed

- **rust template gained the full language-agnostic rule core.** It carried *zero* agnostic process rules (all 16 were Rust idioms in a different format) — the largest cross-template misalignment. A new "Universal Rules (language-agnostic — aligned across all devt templates)" section now carries the same eight process rules every other template has (Deep Analysis, No Duplicate Features, No Backward Compat, Surgical Changes, One Way To Do One Thing, No TODOs, Verify Before Done, Never Weaken Tests); its 16 Rust-specific idiom rules move under an explicit "Rust-Specific Rules" tier, unchanged.
- **Quick-Reference cards made contiguous** in every template that has one — `blank`, `python-fastapi`, `vue-bootstrap`, `go`, and `typescript-node` cards were each silently missing their "Never Weaken Tests" row (pre-existing drift); all now list every rule through the new One-Way entry.

The alignment target is the rule *set* + principle wording, not byte-identical bodies: language-flavored examples inside shared rules (Go's `// Deprecated:`, TS's `@deprecated`) are correct per-language detail and stay. Absolute rule numbers still differ where language-specific rules interleave — unavoidable and not drift.

## [0.220.0] - 2026-07-29

The proef parallel-review seam batch — a second independent field run (64-file whole-workspace review, 5-lane fan-out) reported six findings, all code-verified; the initial fixes were then **reconciled against the operator's filled receipt before commit**, which reversed one design outright and upgraded three others. The receipt also delivered the state-truth verdict the arc was waiting for: across 35 minutes, a workflow rotation, 5 lanes, and 42 gate fires, the v0.216.0 fixes held — zero state/reality disagreements, zero foreign-cid false positives.

### Fixed

- **`augment-impact-map` and its gate agree about skip runs — content wins.** On a tier=skip run the CLI created `graph-impact.md` next to the skip artifact; both mutually-exclusive decision artifacts existed and `assert-graphify-decision` blocked. The first fix (no-op on skip) was **refuted by the receipt**: the workflow's own contract runs augment "even when it skipped", and the deterministic god-node fallback it appends was this run's only graph signal — consumed by a lane and the consolidator. Shipped design (the operator's field-proven recovery, made mechanical): augment-on-skip stamps the map's provenance first line ("deterministic sections only, tier=skip, no MCP call") and **absorbs the skip artifact** — single-artifact invariant preserved, signal kept. The gate's both-exist remediation now names that recovery instead of implying the map should be discarded.
- **The context bundle honors an explicit scope — and re-anchors at the right moment.** `review-context-init` derived everything from the git diff; a user-specified whole-workspace scope was invisible (the run's memory_signal claimed "3 changed files" against 64 under review). A pre-written `code-review-input.md` is now the scope universe for both bundle derivations AND the cache signature — and because the receipt proved bundle-time reading alone never fires on a fresh run (the artifact is written *after* context_init), both artifact-write sites now explicitly re-run the wrapper, which recomputes over the real universe. The signal's claim string names its universe ("across N scope file(s)" vs "changed file(s)") so lanes can't misread diff-governance as scope-governance.
- **`review-weight` reports explicit-scope reviews honestly.** "HEAVY recommended — graph-blind … safety not provable" is noise when the operator chose full-content review; it now emits `explicit-scope review — depth is operator-chosen (N files, M domains)`, keeping the counts that feed the parallel-offer preview.
- **Three auto-partitioner seams**: the scope-artifact read strips the `- ` bullets its upstream writes; groups sort by **file-count descending before the cap** (receipt data: lexicographic order kept two single-file config groups while dropping 17 files across 8 groups — the order bug was as damaging as the cap bug); overflow groups merge into a final `mixed-overflow` lane with a loud note instead of silently vanishing.
- **The verifier envelope asks for what the gate demands.** `criteria_total` is now instructed in the envelope, and the rubric states the count explicitly (**7**: A–E, G, H — no axis F). The "A seventh axis" phrase that made the field verifier declare 8 is reworded to "a further hard-fail check (NOT a countable axis)". The gate's declared-≥-parsed tolerance stays (legitimate over-grading shouldn't fail); the explicit contract makes counts converge.
- **Warm-resume guidance carries the recipe, not just the constraint.** The receipt's revised, trace-backed account: a resume asking the read-only verifier to "edit" its sidecar produced a silent stall the operator misdiagnosed under 30s patience. Read-only agents now carry an inability contract (reply with what you can't do and the Bash alternative); the resume guidance embeds the per-agent recipe (`jq … > tmp && mv`) and an orchestrator wait-rule: one full agent-turn (~60–90s) before concluding inaction.
- Two `register-lanes` paper cuts: `registered[]` echoes the lane label, and an empty diff over a non-empty file set re-sizes by whole-file LOC with `size_class=unknown` (explicit-scope lanes registered `est_loc=0, ok` for 10–18-file full-content reviews — latent under-instruction).
- `/devt:review`'s tool declaration gains `AskUserQuestion`.

### Added

- **`state lane-severity-tally`** — deterministic per-lane count of `[Critical|Important|Minor|Nit]` finding headers with totals, wired into the consolidate step: consolidated counts exceeding lane-declared counts is a stop condition; a lower count must be explained (dedupe/promotion). Receipt-driven: the consolidator caught the orchestrator's wrong tally (7 vs 10 Important) by judgment — the recount is now mechanical.
- **Parallel-offer bar recalibrated**: >15 files, OR >10 files spanning ≥3 domains (was: >10 files flat). Receipt calibration: consolidator+verifier overhead dominates near 10 files; value proven at 20 with ≥3 domains.
- Gate K335 — the batch behaviorally: augment-on-skip stamps provenance + absorbs the skip artifact (single-artifact invariant), criteria_total contract in template + compiled region + rubric, bullet-strip + size-sort + overflow-merge pinned.

Already fixed before the report arrived: the `$CTX` fresh-shell re-acquisition it flagged (v0.219.0). Recorded for the next arc: the receipt's seam-suite design (fixture repo + stub agents that follow only their envelope instructions — would have caught four of the six findings).

## [0.219.0] - 2026-07-29

The final substrate slice of the task-service field arc: the fresh-shell contract is now machine-enforced, and the architect dispatch joined the compiled-envelope system.

### Added

- **`scripts/check-workflow-shell-state.cjs` + gate K334 — the cross-fence lint.** Every ```bash fence runs as a fresh shell; a `$VAR` assigned in one fence and consumed in a later one is dead on arrival (the field operator improvised a `.current-scan-id` file to survive this). The lint flags assign-in-fence-i/use-in-fence-j across all workflows, with stated exemptions (env-provided names, `${X:-}` fence-local defaults, same-fence assignment) and a stated limit (bash-fence-only; prose-carried values belong to the envelope compile path). The sweep found the known arch bug **plus four live siblings nobody had reported**: `$CTX` consumed in three later fences of code-review.md, `$RANGE` in its scope step, `$SCOPE_HINT` in code-review-parallel's lane-block builder, and `$CAPTURED_BY` in defer.md.
- **W016 downgraded to info severity** (proef field report, same day it shipped): untailored template rules are safe-by-design under the precedence line, so they must not hold a project at DEGRADED forever — guidance, not degradation. The check and its file list are unchanged.

### Fixed

- **All five cross-fence violations, each with the right carrier**: the arch scan-id rides `state update scan_id=...` / `state read` (the receipt's exact recommendation; `scan_id` registered as a known state key; the `--scanner` arg is inline-substituted since it's never re-needed); code-review's `$CTX` fences re-acquire the compound bundle (idempotent — short-circuits on same scope_sig+graph_head per K207); `$RANGE` re-derives with the one-liner its own prose already mandated; parallel's `$SCOPE_HINT` re-reads the workflow.yaml cache; defer's two adjacent fences merged into one.

### Changed

- **The architect's arch-scan dispatch is a compiled marker region** (`dispatch:architect:arch_health_scan`, rendered from `architect-arch_health_scan.tmpl.md`) — the raw prose `Task(` template that was structurally invisible to every contract gate is gone. `model="{models.architect}"` dropped entirely (the field receipt: inherit was correct, and the placeholder never resolved outside compound-init flows — the model question now belongs to the house resolution path). The template carries typed fill-contracts for `scope_hint`/`scope_trust` (JSON shapes per architect.md), a `memory_signal` block wired to `memory query --signal`, and the coupling-confidence caveat in the task body.
- **`memory_signal` is contract-declared for the architect** — the field receipt proved it is the standalone-scan defense against untailored rules (it alone kept an architect from grading a project against contradicting boilerplate). The two dev-flow variants are exempted with the reason in the contract, not silently absent. Mutation-proven: deleting `<memory_signal>` from the compiled region fails `dispatch check-contracts`. K314's io-declare pin updated for the architect's new block list.

Remaining from the arc, all receipt-gated or dedicated-session: the compound `arch-scan run` verb, the identity fallback chain (awaiting a payload capture), the curator flow's first-fire receipt, and the smoke phase-split.

## [0.218.0] - 2026-07-28

Direct user field friction: the curator's promote questions were too frequent and too technical ("I do not understand what memory_promote asked"). The flow is now recurrence-gated and plain-language.

### Changed

- **Promotion asks are recurrence-gated.** A persistent ledger (`.devt/memory/_suggestions-ledger.json`) counts how many harvests have staged each candidate, with paraphrases folding into one entry via the same 0.6 token-overlap similarity the dedup already uses (same-harvest duplicates count once — a burst of identical tags in one session is one preference event). The curator asks ONLY about candidates seen `memory.promote_recurrence_threshold`+ times (default 3), framed as *"You've preferred this approach N× across sessions"*; below the bar, candidates build evidence silently — `_suggestions.md` now splits into "Ready to promote (preferred 3+ times)" and "Building evidence (do NOT ask about these)". An explicit `/devt:memory promote <id>` bypasses the gate.
- **The ask is plain language, three options.** The previous form led with internal vocabulary — ADR/CON/FLOW, `status: active`, memory paths — across five symmetric options. Now: one plain sentence of what will change about future work ("readable cold by a non-expert" is the written test), and three choices: *make it a rule* / *don't suggest it again* / *not yet — keep watching*. The curator decides ALL mechanics silently (doc type from the tag, active-vs-candidate via the existing tooling-evolving classifier, affects_paths/keywords from evidence) and reports them in one line after the choice; the original reasoning rides verbatim below as secondary context; free-text answers via Other are the edit path.
- K25 repinned to the new contract's real signals (the classifier's candidate pre-recommendation now modulates the recommended label's description instead of swapping two technical labels).

### Added

- Gate K333 — recurrence behavior end-to-end: two harvests stay "Building evidence" at seen 2×, the third crosses into "Ready to promote", a paraphrase increments the SAME ledger entry (1 entry at 4×), and the skill carries the plain-language form with the old five-option text gone.

## [0.217.0] - 2026-07-27

Substrate batch, first slice (task-service field arc, Release Two part 1): headless honesty and untailored-rules defense.

### Added

- **`arch_scanner.autowire: never|ask|auto`** (default `ask`). The scanner-wiring prompt had no headless fallback — an autonomous run would block on a question nobody answers (the field operator saw it coming and deviated preemptively). Per the receipt's key refinement, `ask` now **degrades to `never` explicitly** in headless runs — skip, plus a named report line — never implicitly. `auto` wires a detected candidate without asking. The scanner-resolution step also collapsed to a single fence (config read + convention probe + autowire mode in one emission), removing that step's own cross-fence variable bug en route.
- **Triage headless guard: defer-ALL.** A headless `--triage` run defers every untriaged finding with a report line instead of prompting — auto-accepting would corrupt the baseline's semantics ("operator-accepted floor"), making delta mode lie forever after.
- **Template rules carry a precedence line** (fix (d), shipped to all 63 template rule files): the project's own CLAUDE.md and documented conventions win on any conflict with the template baseline. The field near-miss: an untailored template rule prescribed `repository_interfaces.py` against a project whose CLAUDE.md explicitly locks `interfaces.py` — only the memory signal and the architect's role text stood in between.
- **Health check W016 — untailored-rules detection** (fix (b)'s mechanical core): `/devt:setup --health` flags every `.devt/rules/` file byte-identical to its counterpart in ANY shipped template, naming file and template. Template-agnostic because installs don't reliably record which template scaffolded them. Fixture-proven both directions: fresh install flags all files; a tailored file drops off the list.

Remaining for the final substrate slice: the typed compiled architect envelope (needs the memory_signal contract decision + template-variant mechanics), the cross-fence workflow lint + sweep, and the compound `arch-scan run` verb.

## [0.216.0] - 2026-07-27

The state-truth batch — Release One of the task-service field arc. A real external run (arch-health scan on a FastAPI service) produced a 9/9-verified defect report plus a calibration-grade filled receipt; this release restores the property the operator watched decay: *the state layer tells the truth during recovery*. Every fix below carries a field receipt.

### Fixed

- **The Layer-2 claim-check gate self-heals recovered artifacts.** A resume/re-dispatch that produced the artifact AFTER a failure record left the failure "unresolved" until someone re-ran Layer-1 by hand — the field operator recovered correctly and then had to *guess* `state assert-artifact-present <agent>` to clear it. The finalize gate now re-probes presence AND substance via the real Layer-1 (which appends the success record itself), reports `self_healed:[agents]`, and fails loud only when the artifact is genuinely still missing or still stub. The workflow's remediation text also names the manual command.
- **A stop-stamped workflow re-activates on new agent activity.** The Stop hook stamped `active:false/stopped_at` at a turn boundary; a SendMessage-resumed agent then ran ~2.5 minutes while state said "stopped" and `/devt:status` mis-routed to "resume or start fresh" mid-scan. New verb `state reactivate` clears the stamp (no-op without one); `hooks/subagent-status.sh` fires it on every SubagentStart. The lane-state guard stays intact — reactivation never mints ids, so first-activation protection is untouched.
- **Subagent events no longer merge.** `status.json` keys by resolved name, so same-name (or unresolved-"unknown") agents collapsed last-writer-wins — three distinct field events survived as one record. The hook now appends every start/stop to `subagent-events.jsonl` (contract-canonical, STATE-RULES documented); `status.json` remains the derived last-known view.
- **Hook failures keep their stderr.** A hook hard-failed with 721 bytes of stderr and only the byte count survived (async fire + `2>/dev/null` culture). `run-hook.js` trace records now carry `stderr_excerpt` (first 500B) on nonzero exit.
- **`state validate`'s arch fossils are gone.** The phase-artifact map expected `scan-results.md` and `arch-health-scan.md` on `arch_health_scan` runs — a workflow type with no scan phase, and a phase key (`arch_health`) that doesn't match the live phase name. Type-scoped deletions (the plan/debug pattern) plus the missing `arch_health_scan → arch-review.md` row; the field's exact two-mismatch output now validates clean. The `arch_health` row stays for dev-COMPLEX's parallel arch dispatch, which really writes `arch-health-scan.md`.
- **`--focus=architecture` is accepted** as an alias for `arch` (the operator hit the rejection on their first call).

### Added

- **`DEVT_DUMP_HOOK_PAYLOAD=1`** — one-off hook-payload capture to `hook-trace/payload-<script>-<ts>.json`. The trace stores byte counts only, so "which name fields does this build's SubagentStop payload carry?" was unanswerable post-hoc — the receipt's precondition for designing the agent-identity fallback chain.
- **Small-history coupling annotation.** `evolution scan` now emits `coupling_confidence` (`level:"low"` when `commits_analyzed<50` or `authors<2`, reason-tagged, mirroring ownership's degradation shape) in the CLI summary, the JSON report, and as a banner in the markdown report. Field calibration: 24 commits/1 author inflated degrees to 91%, but the pairs stayed useful as leads — so annotate, never suppress (the architect converted one flagged pair into a real structural finding and the rest into a dismissal ledger).
- **Graphify staleness surfaces in the arch flow.** `arch-health-scan.md` had zero staleness wiring while code-review carries the full tiered gate; a one-line non-blocking banner now reports graph lag at context init.
- **Gate K332** — the batch's behavioral contract: self-heal (positive and negative), reactivate cycle, event-append no-merge, SubagentStart re-activation, stderr excerpt, coupling annotation — all fixture-proven in one gate. K156 independently caught the new verb's missing enum registration during the run, which is that gate class earning its keep.

Deferred to Release Two (substrate batch): the state-carrier + workflow lint for cross-fence variables, the typed compiled architect envelope, `arch_scanner.autowire` with explicit headless degradation, the rules precedence line + health contradiction diff, and the compound `arch-scan run` verb.

## [0.215.0] - 2026-07-27

### Changed

- **The coordinator's routing table is generated, not mirrored.** `agents/devt-coordinator.md`'s copy of the do.md routing table is now rendered between GENERATED markers by `scripts/generate-coordinator-table.cjs` (`--write` to regenerate; check mode exits 1 on staleness). The hand-maintained mirror had live trigger-text drift that both parity gates missed — row-count and command-token parity stayed green while "how does X work" diverged from "how does X work in this codebase". The two coordinator-side refinements were upstreamed into `workflows/do.md` (they're better trigger text for `/devt:do` as well), making do.md the single routing source. K98 rewritten as the generation-freshness gate (byte-equality via the generator's check mode — mutation-proven in both directions: a hand-edited coordinator row and an un-regenerated do.md edit each fail with the remediation command named); the redundant row-count/command-token parity pair collapsed to a minimum-rows check.

Still open: smoke phase-split (L — its own session; acceptance gate: identical PASS-name inventory before/after).

## [0.214.0] - 2026-07-27

The per-dispatch-weight content batch — two items shipped, two closed by measurement instead of checkbox, and the scan-prep family completed.

### Changed

- **`/devt:memory` is a single-owner command.** `commands/memory.md` and `workflows/memory-init.md` both loaded on every invocation (~11.3KB combined) and duplicated the CLI-execution instructions, rendering guidance, and promote/reject routing. The workflow's unique content (prerequisites, failure handling, the exit-2 curator-routing detail, the atomic-index notes) folded into the command; `workflows/memory-init.md` deleted; K99's orphan allowlist token dropped. ~5.5KB lighter per invocation, one load path.
- **`research-task.md` joined the scan-prep family.** Its hand-rolled decision bash (an older generation that duplicated what `preflight scan-prep` consolidates — same brief fields, same dense+symbols threshold shape, same skip artifact) replaced with the same CLI call + `GRAPHIFY-STEP:decision` pointer the other three workflows use; its research-specific drill-down rationale rides as a MODE=research clause in the shared file. One semantic harmonization: research now gets the CLI's adaptive threshold instead of its hard-coded 10. F13 is now a 4-pointer partition gate; F16's list follows the bodies.
- **Guide→rubric dedupe, the honest slice.** The one true verbatim-class duplication — the ADR-Compliance section contract and the REJ-tombstone hard-fail, stated in both the code-review-guide and the rubric — now lives canonically in the rubric; the guide keeps the operational commands and points at axes. The rest of the proposed dedupe was **refuted on close reading**: the guide's severity table (with point deductions), scoring examples, and report template are the reviewer's operating instrument — the rubric doesn't contain the deduction points at all, and cutting them would make the reviewer learn its own scoring from the verifier's grading doc.

### Validated non-issues

- **The memory-curation disclosure split saves nothing real.** Nearly every curator dispatch presents candidates, so the protocol + classifier + exemplar are needed at presentation time — splitting them to references/ converts unconditional preload into a mandatory same-dispatch Read (one added hop, zero net tokens). The only consultation-grade content (anti-patterns, summary template, ~1.8KB) doesn't justify the structure churn on a low-frequency agent. Recorded here so the ledger entry doesn't resurrect.

Still open: coordinator table generation (new compile machinery), smoke phase-split (L, dedicated session).

## [0.213.0] - 2026-07-27

Standing-ledger burn-down, round two — the graphify quadruplication healed and the install tax fenced.

### Changed

- **The `graphify_scan_prep` decision bodies are single-sourced.** What the ledger carried as a "triplication" was four sites: dev-workflow, quick-implement, and debug each held a near-copy of the ACTIVE/SKIP/RECOVERY protocol (~6.9KB total) that had drifted at the wording level — three phrasings of the drill-down instruction, divergent RECOVERY tails, and one real per-mode variant (debug's SKIP falls back to grep + stack trace). The richest body (dev's, with the audit-trail and gate-closure sentences) is now the canonical in `workflows/graphify-scan.steps.md` with the debug variant mode-marked; each parent keeps its scan-prep bash and a `GRAPHIFY-STEP:decision` pointer. F13 rewritten as the partition gate (pointers + no resident copies + shared-file completeness, mutation-RED both directions — including a weak-leg fix caught during mutation: the mode-variant check now pins the variant's content, not its label); the scan-prep MCP gate and F16 repointed. The fourth site, `research-task.md`, carries an older bash-echo structural variant — left intact, named for migration.

### Added

- **Gate K331 — registration-surface budget.** The summed description/argument-hint frontmatter of commands + agents + skills (17,067B live — the model-facing registration slice of the ~23KB install tax v4 measured) is now budgeted at 18,500B, K319's idiom applied to the class: a ballooning description fails CI with the actual bytes named; raising the ceiling is a deliberate act with a changelog note. (The v4 trim recommendations for this surface were withdrawn by v5's platform intel — `disable-model-invocation` saves nothing and breaks subagent access — so the fence, not the trim, is the shippable piece.)

### Fixed

- `code-review.steps.md` still told the verifier to read `code_review.v1.md` — now points at the pinned rubric resolved via `DEFAULTS.rubrics` (the prose pointer the rubric-v2 sweep missed).

Still open on the ledger: guide→rubric dedupe, coordinator table generation, memory dual-layer merge, memory-curation disclosure split, research-task scan-prep migration, smoke phase-split.

## [0.212.0] - 2026-07-27

Standing-ledger burn-down, round one — the largest remaining resident-token lever plus the small verified retirements.

### Changed

- **The scope_check parallel-offer machinery rides by-reference.** The >10-file branch (operator-intent short-circuit, cost/value preview, AskUserQuestion, answer routing, scope pre-write + parallel delegation) — 7,371 bytes — moved from resident `code-review.md` into `code-review.context-detail.md::## parallel-offer` behind a conditional Read pointer. The common path (≤10 files, or graphify not ready) never loads it: every ordinary review is ~7KB lighter. K309's partition contract extends to the new anchor (three body sentinels, pointer↔anchor bijection — both directions mutation-RED); K178, K313, and K274's cost-doctrine pins repointed to the body's new home.

### Removed

- **The `memory candidates-footer --hint-only` flag** — test-only code kept alive by its own gate since the Stop hook went in-process (the hook consumes `candidatesFooterStatus()` directly). K300 redesigned: an export probe covers below-threshold semantics, the footer verb covers hint+stamp, and the real `stop.sh` legs carry the once-per-cooldown behavior. Stale wiring claims fixed in the case comment, MEMORY.md, and HOOKS.md.
- **Four zero-consumer files**: `protocols/ui-presentation.md` (nothing references it; the other two protocol files are consumed by dev-workflow) and three `skills-workspace/` eval sidecars for skills retired long ago (memory-compaction, playbook-curation, semantic-search).

### Fixed

- **A manual-clone → plugin-managed migration no longer leaves a stale `~/.claude/commands/devt` symlink forever** — the plugin-managed branch of session-start.sh now removes it instead of skipping cleanup along with registration.
- `.ruff_cache/` added to `.gitignore` (Python arch-scan tooling cache).

### Added

- CLI-REFERENCE rows for the two composite verbs the previous batch missed: `state post-dispatch-check <agent>` and `state finalize-gates [--phase=]` (the latter described from its actual body — it fires the `_phase-gates.yaml` registry set, not a hand-rolled sweep).

Still open on the ledger, named for the next round: the graphify ACTIVE/RECOVERY triplication (~6.9KB across three workflows, needs a mode-marked shared file), guide→rubric dedupe (~2KB per reviewer dispatch), coordinator table generation, memory dual-layer merge, memory-curation progressive disclosure, and the smoke-suite phase split.

## [0.211.0] - 2026-07-27

The v5 follow-up batch (contract-gate extensions + the two platform verifications) — and the item that was scheduled as a "2-minute field check" turned out to be the most important fix of the arc.

### Fixed

- **Every devt deny hook was silently advisory — the deny schema was dead.** Live-verified with five probes on the current build: the legacy top-level `{decision: "deny"}` that all three guards emitted is IGNORED (a governed Edit executed while pre-flight-guard logged a block-mode deny; a `rm -rf *`-classified Bash call executed while bash-guard logged its deny), and a dual legacy+modern form is ALSO ignored — the legacy key's presence poisons the deny. Only the modern `hookSpecificOutput.permissionDecision: "deny"` shape enforces (verified: the fixed guard then actually blocked a live governed Edit and a live `--no-verify` commit). All three emitters (pre-flight-guard, bash-guard, dispatch-hygiene-guard) now emit modern-only, with `source`/`rule_id` metadata retained; nine suite assertions repointed from the legacy shape to `permissionDecision`. Bonus finding recorded en route: pre-flight-guard is workflow-scoped by design (`active: false` → silent), which is why maintainer sessions never saw it fire. Task-tool deny enforcement remains unverified either way — the post-hoc `assert-no-raw-dispatches-this-session` gate stays the load-bearing net there, and its comment now tells the schema story accurately.

### Added

- **Contract-system completeness (the v5 A8–A11 batch), all mutation-proven RED:** the contracts-drift gate now also asserts (d) every `index_buckets` entry declared in io-contracts.yaml is non-empty in skill-index.yaml — the promise io-contracts' own comment made about a gate that didn't exist; (e) every `agents/*.md` has a contract row — devt-coordinator previously escaped the contract system entirely and now has a row (frontmatter skills gated, no IO — it routes, writes nothing); (f) every `outputs.expected_sections` entry appears as a heading in the agent's .md — `recoverPartialImpl` greps artifacts for these, so an agent never told to write a section reads as structural drift.
- **The code-reviewer rubric blocks are contract-declared.** `rubric_path` + `rubric_content` added to code-reviewer's `context_blocks` with per-workflow exemptions matching reality (parallel is by-reference — path only; dev/quick_implement reviewers carry no rubric). A template edit deleting the rubric from a standalone-review dispatch now fails `dispatch check-contracts` — previously it would have passed every gate. Mutation-proven: deleting `<rubric_path>` from the compiled review region reds K206.
- **PreCompact thread-snapshot hook receipt-gated, not built.** The platform event exists and devt has no hook on it — but file-based state is designed to survive compaction, so the hook only earns its place if a field receipt shows `/devt:next` mis-routing after a mid-workflow compaction. Entry in RETIREMENT-WATCH; the field instrument asks the question directly.

### Changed

- Deny-contract documentation matches the verified reality across HOOKS.md and all three hook headers (block-mode rows now name `hookSpecificOutput.permissionDecision` and note the legacy key is ignored by current builds).

## [0.210.0] - 2026-07-27

Alignment batch from the v5 external report (validated finding-by-finding before implementation; ~25 claims checked — the three headline defects confirmed, one of them undercounted by the report itself, two of the report's supporting details refuted). Theme: the code was ahead of its own paperwork — two real data-loss/behavior defects lived in maintenance verbs, everything else was a surface lying about another surface.

### Fixed

- **`state cleanup`/`reset` no longer destroy the static-compress calibration log.** `static-compress.jsonl` was doc-promised reset-exempt but absent from `RESET_EXEMPT` — every hard reset archived it, and the audit classified it `ad_hoc` so stale-cleanup archived it too. One membership entry fixes both (RESET_EXEMPT feeds the audit's canonical set). Fixture-proven: hard reset now leaves it as the only survivor.
- **The audit's pattern list can no longer diverge from the contract.** `state-audit.cjs` carried a hand-copied 6-pattern list against the contract's 10 — contract-legal `lane-diff-L*.txt` (and the plan/research/spec/debug slug classes) classified `ad_hoc` and were cleanup-archived; both the audit comment and STATE-RULES claimed a smoke gate enforced agreement that never existed. The audit now compiles its regexes directly from `STATE_FILE_CONTRACT` — there is no second list.
- **Consolidation surfaced two latent defects in the topical-summary pattern**: the old form could not match its own documented example (`[a-z]+` cannot cross hyphens in `module-md-update-summary.md`), and once fixed, the widened form collided with the canonical single-word namespace (`test-summary.md` — caught by F10e on the first suite run). Final form requires ≥2 words before `-summary`, matching the documented intent while staying disjoint from canonical names.
- **The code-review rubric grades against a file that exists again.** All six `review-scope.md` references in the shipped rubric (axis-A procedure, the `failed` trigger, examples, decision tree) pointed at an artifact renamed to `code-review-input.md` — every verifier received a grading contract naming a dead path and bridged it ad-hoc. Shipped per the pinning convention as `code_review.v2.md` + DEFAULTS bump (`code_review` and `code_review_parallel`); v1 stays on disk for projects pinning it. Same ghost purged from GRADER.md, AGENT-CONTRACTS.md, and STATE-RULES.md (a fourth site the report missed).
- **`/devt:note --tags` no longer silently drops tags on the default path.** The command advertised `--tags=a,b,c` but only the `--defer` route consumed it; the note workflow now parses the token and writes a `tags:` frontmatter line.
- **`rules.exclude_sections` no longer triggers a false "unknown config key" warning.** The key is honored by dispatch envelope rendering but was absent from DEFAULTS, so config validation warned it "will be ignored" — it now ships in DEFAULTS as a documented empty list.
- **devt-coordinator's routing note cited a CLAUDE.md section that lives in AGENT-CONTRACTS.md** — the citation now points at the real home.

### Removed

- **The unwired `--focus=security` and `--quick` promises on `/devt:review`.** Both injected tags (`<focus>security</focus>`, `<mode>quick</mode>`) that no workflow consumes — a user asking for a security-focused or quick review got the standard path with no signal anything was ignored. Removed from the command surface (argument-hint, routing table, help) rather than silently half-honored; `--lite|--full` remain the real consumed modes. A future security focus can be added deliberately, wired end-to-end.
- **The phantom `--workflow=` flag from `dispatch run`'s documentation** — the CLI never parsed it (the colon form `<agent>:<workflow_id|auto>` is the real path and stays documented).

### Added

- **Gate K329 — contract single-sourcing + reset-exemption truth.** The reverse leg of K197 plus live behavior: a contract-legal lane-diff artifact must classify `pattern_allowed`, `static-compress.jsonl` must survive a hard reset, and every "survives reset" row STATE-RULES promises must be in `RESET_EXEMPT`. All three legs mutation-proven RED with named reasons.
- **Gate K330 — the shipped rubric grades against live artifacts.** Resolves the rubric path through DEFAULTS (a future v3 bump stays gated automatically), requires the live artifact name, and pins zero ghost references. The ghost name matches the `^review-*` allowed pattern, so the state-contract checker structurally cannot catch this class — the content pin is the rename-class guard. Mutation-proven both directions (map regression to v1, ghost reintroduced into v2).
- **`check-state-contract.cjs` now also scans `references/` + `references/rubrics/`**, with its pattern-shadowing limit documented in the header (a stale name that happens to match an allowed pattern passes the checker — that class needs content pins like K330).
- **CLI documentation for the verbs that existed only in the router**: `state review-context-init` / `state workflow-context-init` / `state stop-hook` (the three composite verbs), `hook-cost-estimate`, `telemetry`, and `memory promote|reject` — added to both `printUsage` and CLI-REFERENCE.

### Changed

- **Post-refactor text sweep — every description of the state family now names the owning submodule.** CLAUDE.md (module list + `VALID_WORKFLOW_TYPES` edit-pointer), INTERNALS (workflow-registry pointers; `traceGate`/`recoverPartialImpl`/`assertNoRawDispatchesThisSession`/`checkAgentOutput` attributions — the first three are facade-internal and not re-exported, which the docs now say), AGENT-CONTRACTS (`JSON_SIDECAR_SCHEMAS`), STATE-RULES (six `state.cjs::` pointers + the `lane-files/` row flipped to code-truth: it is scope-bound and archived with reset, same rationale as lane diffs), test-gates.cjs header (stale line numbers → owning files).
- **Gate PASS-texts tell the truth**: K42's three-way drift fixed (comment said "all 5", PASS said "all 6", the expected set has 7 workflow_types including `docs`); K50's hardcoded "11 workflows checked" is now a computed count that cannot go stale.
- **Config/doc value truth**: HOOKS.md `max_files_hint` default 8 → 12 and auto-index debounce 30s → 5s (code truth); the static-compress default is honestly "on" across all three surfaces that still claimed "off" (recipe status line, recipe sample comment, and config.cjs's own comment block — whose tail already documented the flip its head denied); README's balanced profile row for verifier corrected to sonnet with the prose recount (4 judgment-critical agents on opus, not 5 — code truth; the verifier's rubric-driven grading is the structured case sonnet holds).

## [0.209.3] - 2026-07-26

Third adversarial pass — this round's subject was the newest validator itself, plus two never-swept angles. Field-receipt closure worth headlining: across real session fires in the live hook trace, `stop.sh` p50 went **815ms → 84ms (9.7×)** — the v0.206.0 single-spawn claim confirmed with usage data, better than the bench estimate.

### Fixed

- **`check-state-resolution.cjs` no longer false-fires on prose (mutation-verified).** A call-form name inside a string literal (`"run generateLaneDiff() first"`) tripped the resolver — no such string exists today, but a future error message would have wrongly blocked CI. The checker now strips single-, double-, and backtick-quoted literals before matching (interpolation edge cases degrade to under-stripping — a loud false positive at worst, never a silent miss). Re-verified both directions: the string no longer fires; a genuinely swallowed cross-module call is still caught.

### Added

- **Gate K328 — NUL-byte hygiene.** Exactly one tracked text file may contain a NUL: the suite itself (the memory-paths sanitization fixture). The class is real and recurring — evolution.cjs once shipped with stray NULs, and a NUL flips GNU grep into binary mode, silently changing every non-quiet grep of that file on Linux (the K321 CI-only failure mechanism). Mutation-proven: an injected NUL in a module turns the gate RED with the file named.
- **The checker documents its stated limit** (mirroring K326's honesty): only CALL-form usage is checked; value-form references are a false-positive minefield and both field instances of the bug class were call-form — the deliberate value-form pattern (the phase-gate registry) carries its own lazy requires.


## [0.209.2] - 2026-07-26

Second adversarial pass over the released surface — new angles only (receipt stability under load, hostile stdin, the affects-index, a systematic Linux-binary-grep sweep, and closing K326's own stated blind spot). Everything held: receipts load-scale proportionally (deltas stand), stop-hook survives malformed + 1MB stdin with the base stopReason, ADR-003 resolves through `memory affects`, and no other non-quiet grep of the NUL-bearing suite file exists.

### Added

- **Gate K327 — static per-function cross-module resolution, the complement to K326.** K326's runtime sweep states its own limit: an unresolved cross-module call inside a bare catch never surfaces (the `_activeRange` break hid exactly this way). K327 closes it statically — every top-level function in the state family must resolve each call of another submodule's (or facade-internal) name via module import, own-module scope, or a function-local lazy require. **Mutation-proven complementary**: a swallowed cross-module call injected into a gate function is invisible to the K326 sweep and caught by K327 with the exact function named. Runtime + static together now cover both halves of the facade-split risk class.


## [0.209.1] - 2026-07-26

Post-release adversarial validation of the 0.205.0–0.209.0 batch: every new gate mutation-tested (break the guarded property → gate must go RED), all 73 router verbs swept, and the one unproven changelog claim behaviorally verified (unlisted `tools/call` in a disabled dir returns the graceful `degraded` payload, no RPC error — confirming the 0.206.0 assertion). Two hardenings came out of it.

### Fixed

- **K323's wiring leg no longer matches comments.** `grep -qF 'state stop-hook'` was satisfiable by stop.sh's own comment with the command deleted — the leg now pins the executable invocation (`devt-tools.cjs" state stop-hook`). Mutation-proven: breaking the command line turns the leg RED; the comment alone cannot keep it green. (K300 always covered the hook behaviorally; this closes the structural leg's blind spot.)

### Added

- **Gate K326 — state-router ReferenceError sweep.** Invokes every router verb (73 at gate time) in a minimal fixture and asserts none dies on an unresolved identifier — the regression net for the facade-split risk class, where a function moved between state submodules references a name its new home doesn't import and fails at CALL time (both real breaks of this class — `_assertLanesRegistered→listLaneOutputs` and `computeGraphifyImpactPlan→_activeRange` — shipped past load checks and a flat import audit). Known limit stated in the gate: a verb that swallows the error in a bare catch hides it from the sweep too; per-verb behavioral gates remain the deep net. Current sweep: 0/73 hits.


## [0.209.0] - 2026-07-26

### Added

- **The memory-doc batch — three decisions the sessions kept re-deriving are now tombstoned.** `ADR-003` (Agent Teams adoption deferred: experimental + non-`/resume`-restorable, while file-based state is load-bearing for `/devt:next` — trigger named in RETIREMENT-WATCH), `REJ-003` (no OpenTelemetry/telemetry SDK: zero-dep contract, SDK init would dwarf the measured 26–73ms hook fires, no cross-process audience — JSONL side-channels + aggregation verbs are the stack), `REJ-004` (no Rust/native CLI rewrite: zero-build Node stdlib IS the distribution contract; node startup ~26ms is the measured floor, a binary buys ~25ms/call for a per-platform build matrix). All indexed, FTS-retrievable, and keyword-armed against re-proposal.

### Removed

- **`scripts/check-docs.sh` retired.** Doc-completeness checker for a user project's `.devt/rules/documentation.md`, invoked by no workflow, agent, skill, or CI surface — the same maintained-but-unwired class as the retired injection scanner. RETIREMENT-WATCH records it as revivable receipt-gated if a docs workflow ever wants a deterministic completeness leg.

### Validated non-issues (measured, not shipped)

- **Lazy facade requires — refuted by measurement.** The entire 5-submodule state family parses in **+2ms** over bare node startup (28ms vs 26ms; full CLI verbs 37–39ms warm). Lazy getters plus ~50 call-site rewrites to save 2ms fails the receipt bar; the earlier ~440ms stop-hook reading was load-inflated, not require-dominated.
- **bash-guard in-process fast path — deferred with a named trigger.** Measured chain: runner-node 26ms + bash ~8ms + CLI-node 39ms = **73ms warm**; in-process would save ~45ms/call (~1–2s/day at observed frequency) at the cost of a second execution model inside the runner. Recorded in RETIREMENT-WATCH's receipt-gated list — TRIGGER: sustained warm p50 > 250ms on a PreToolUse guard, or an order-of-magnitude frequency jump.


## [0.208.0] - 2026-07-26

### Fixed

- **K321 no longer fails on Linux CI (field report: "binary file matches").** `scripts/smoke-test.sh` legitimately contains one NUL byte — a `'/some/path\u0000evil'` fixture inside the memory-paths sanitization gate (present since before v0.203.0 and load-bearing). GNU grep therefore classifies the file as binary, and K321's two kcorpus legs — the first NON-quiet greps of the file, added in 0.205.0 — got "binary file matches" instead of matching lines on ubuntu runners (BSD grep on macOS masked it; 0.204.0–0.207.0 first met CI at the release push). Both legs now pass `-a` (`--text`, portable BSD+GNU). The NUL fixture stays — it is test substance, not corruption.

### Changed

- **The Context-Loaded contract is single-sourced (N4, K325).** The read-and-record paragraph the by-reference stubs lean on was copy-pasted 28× (byte-identical — verified by checksum — but 14 hand-maintained template copies + 14 compiled copies of pure drift surface). It now lives once in `dispatch.cjs::CONTEXT_LOADED_CONTRACT` and is render-time expanded into every envelope's `{context_loaded_contract}` placeholder — `renderEnvelope` is the single chokepoint (`compile`, `render`, `render-filled`, and `render-lanes` all route through it, verified at call-site level), so compiled workflow regions and rendered envelopes are **byte-identical to before** (`dispatch compile --check`: 21 regions, zero drift; workflows untouched). Templates carry only the placeholder. Gate **K325** locks it: constant present, zero literal template bodies, 14 placeholder templates, compiled regions still full-text for the LLM-fill path, rendered envelope carries the body with no placeholder leak.


## [0.207.0] - 2026-07-26

### Changed

- **`state.cjs` split into a 5-submodule family behind a facade (N2).** The repo's self-development hotspot — 8,183 lines / 391KB / 107 functions / a 73-case router in one file, the #1 merge-conflict surface — is now `state-contract.cjs` (42 shared constant tables), `state-io.cjs` (paths, YAML, locking, read-only accessors incl. `validateConsistency` + `workflowIdChainSet`), `state-gates.cjs` (43 assert-*/registry/claim-check/trace functions, incl. the lane-flavored gates — placing them here is what breaks the lanes↔gates cycle), `state-lanes.cjs` (lane CRUD/sizing/diffs), `state-graphify.cjs` (impact plan, graphify gates, ROI), with `state.cjs` keeping the mutation core, the context-init compounds, `run()`, and a re-export of the full 59-name public surface. **Mechanical**: function bodies are verbatim line-moves (goldens byte-identical modulo timestamps); the only insertions are five documented call-time requires where a gate reaches a lane/graphify function (avoiding load cycles — every submodule loads standalone). Every consumer keeps requiring `bin/modules/state.cjs` unchanged: export surface verified identical 59/59, behavioral goldens identical, CI's inline require + `check-state-contract.cjs` untouched. 45 smoke content-grep pins were repointed to the `state*.cjs` family and 2 awk constant-readers to `state-contract.cjs`. Facade: 8,183 → 1,968 lines (one 7-line read-only helper, `_activeRange`, relocated to state-io as a shared accessor).

### Added

- **Gate K324** — the facade contract: every submodule loads standalone (cycle guard), none requires the facade back, the facade export surface stays ≥ the 59-name floor, and a 2,600-line ceiling keeps the hotspot from silently regrowing in place.


## [0.206.0] - 2026-07-26

### Measured token + latency batch — the two receipt-supported levers, and only those

The v3 report's spawn-count batch proposed four legs; live `duration_ms` telemetry supported exactly two. The other two (PreToolUse matcher-merge, injector idle short-circuit) were refuted by measurement — profile-skips cost ~1ms and the injector's `state read` is already mtime-cached — and are recorded as validated non-issues, not shipped.

### Changed

- **`stop.sh` collapsed to one compound CLI call — measured p50 928ms → ~440ms per turn end (N/spawn 9 → 2).** The Stop hook fires at every response end in all profiles and ran a chain of 8 `node` spawns (stop-loop guard parse, `state read`, knowledge-candidate harvest, curation footer, field extraction, conditional deactivation stamp, stopReason emission). New `state stop-hook` verb does all of it in-process with a byte-identical output contract: `stop_hook_active` → no output; active+incomplete → `WARNING` stopReason + the same `stopped_at`/`stopped_phase`/`active=false` stamp through the same `updateState` path (deactivation-gate semantics inherited); otherwise the base stopReason — every leg best-effort so a failure degrades toward the base message instead of blocking shutdown. The hook wrapper is 5 lines: read stdin, pipe to the verb, fail open. Also retires the chain's `STATE_JSON`-via-`process.argv` pattern (the same argv family the hook ecosystem was converted off). The curation-hint logic is single-sourced: `memory.cjs::candidatesFooterStatus()` now serves both the `candidates-footer` CLI case and the verb — same counts, same cooldown-stamp side effect.
- **`devt-graphify-mcp` stops charging disabled installs — tools/list 4,643B → 298B (−93.6%) when graphify is off (N1).** The server advertised all 9 tool schemas in every session even with `graphify.enabled=false` (the DEFAULT) and no graph built — degradation existed only at call time. `listTools()` now consults `graphify.status()`: not-ready projects advertise only `status` (a probing agent learns the state + enable path from it; enabling is a setup event — restart re-lists the full surface). `tools/call` still resolves every tool regardless of listing, so an unlisted call degrades gracefully instead of erroring. A ready project's surface is byte-identical to before.

### Added

- **Gate K323** — stop-hook behavioral parity (loop-guard silence, WARNING + stop stamp on active+incomplete, base stopReason otherwise, hook wired to the single-spawn path). The curation-hint leg stays covered by K300, which drives the real `stop.sh`.
- **The graphify MCP tools/list gate now probes both directions in fixtures** (disabled dir → status-only; ready fixture → full surface) so the repo's own graphify state never decides the verdict; the `get_community` inversion gate now checks the ready surface, where the check is meaningful. The `--self-test` registry-drift check now inspects the `TOOLS` registry itself instead of the conditional advertisement.

### Fixed

- **bash-guard perf budget 6000ms → 8000ms.** The ceiling boundary-flaked twice in three days under full-suite load (6019ms, 6827ms) while idle p50 sits ~3000ms — pure scheduler contention, not a regression. 8000ms still catches the catastrophic class the gate exists for (a hook spawning subagents lands >10s).

## [0.205.0] - 2026-07-26

### v3-report residuals — every item code-verified before implementation

A third external deep-read (post-0203) was validated finding-by-finding: 13 findings confirmed (2 with corrected severity/mechanics, 2 expanded beyond the report), 1 fix-direction rejected. This release ships the validated small-fix tier; the measured token/latency tier follows separately.

### Fixed

- **The tester dispatch gets the claim-check every other agent already had (R3, K320).** Six agents were claim-checked after dispatch (programmer ×2, code-reviewer ×2, debugger, architect, verifier) — the tester was the only output-writing dispatch without one, i.e. the one agent whose partial output stayed invisible until the verifier stage. Both test bodies now run `state post-dispatch-check tester` (proven working behaviorally: missing artifact → `redispatch` with the io-contracts reason; present → `proceed`) and K320's test-step token list pins it.
- **KCORPUS digests ALL corpus files and is honestly fail-loud (R1+R2).** The gate hashed only `*.md` — `skills/complexity-assessment/assets/keywords.yaml` is a behavioral input (the assess step reads it) that in-place mutation could corrupt silently. Now all files under `guardrails/` + `skills/` are hashed (`.DS_Store` pruned). The "degrades safe: absent shasum → no-op" comment was false — under `set -euo pipefail` a missing shasum aborted the suite with a bare exit 127. Deliberately kept **fail-loud** (an integrity gate that can quietly stop tripping is worse than one that refuses to run — the report's `|| true` suggestion was rejected) and made legible: an explicit `command -v shasum` check fails with a named error. The abort-path non-assertion is now documented (the `SUITE_COMPLETED` sentinel already forces failure there).
- **`_common.sh` honors `CLAUDE_PLUGIN_ROOT` again (R5).** Three hooks' inner node blocks still read `CLAUDE_PLUGIN_ROOT` directly, but the consolidated `devt_plugin_root` had dropped it from the fallback chain — now `PLUGIN_ROOT` → `CLAUDE_PLUGIN_ROOT` → `$0`-relative, one consistent contract.
- **Config schema truth restored, both directions (N3, expanded).** `graphify.rebuild_debounce_seconds` (read by `maybe-refresh`, documented in GRAPHIFY.md) and `preflight.domain_hints` (read by lane-A extraction, documented in MEMORY.md, dogfooded in this repo's own config) were absent from DEFAULTS — the CON-005 inverse, where the unknown-key warning can't protect their nesting. Both added with rationale comments. The README hook-profile table had drifted **three** ways (a ghost `dispatch-scope-guard.sh` row surviving that hook's long-ago merge into `dispatch-hygiene-guard.sh`, a missing `task-truncation-detector.sh` row, and `read-before-edit-guard.sh` shown at `standard` after its demotion to full-only — the third error found during validation, not in the report). Fixed, plus three more merge-leftover ghost references the report missed: `config.cjs`'s consumer comment, `docs/AGENT-CONTRACTS.md`'s cross-ref list, and `docs/STATE-RULES.md`'s writer attribution.
- Comment truth one-liners: `workflow-context-injector`'s stdin read documents its tty-guard/timeout semantics (R4); KCORPUS documents why the EXIT trap doesn't re-assert (R7).

### Removed

- **`scripts/prompt-injection-scan.sh` retired (N5).** A duplicate pattern list of `security.cjs::scanForInjection` — the two were literally cross-NOTEd as "parallel implementation" of each other — and invoked by no CI job, smoke section, or hook. Two drift-prone pattern lists in a security control, one of them dead. Deleted; `security.cjs` is the single implementation. Deliberately NO new CLI verb: nothing consumes one, and maintained-but-unwired machinery is the exact class the `--plugin-build` retirement closed. RETIREMENT-WATCH ledger records it.

### Changed

- **`session-start.sh` no longer touches `~/.claude/commands/` on plugin-managed installs (N6).** The per-session symlink re-link (`rm -rf` + `ln -sf` into user-global state) is a pre-plugin-era registration mechanism; marketplace installs get native command registration. Now gated: a `PLUGIN_ROOT` under `~/.claude/plugins/` skips it; manual-clone installs keep the current behavior.

### Added

- **Gate K321** — hook-profile TABLE parity (README + CLAUDE.md ↔ `run-hook.js::HOOK_PROFILES`, hook set AND per-profile membership, both directions — the class none of K315/K155 covered) plus pins for every fix in this batch (env contract, KCORPUS scope + fail-loud, DEFAULTS keys, ghost-name absence, scanner retirement, symlink gating).

### Corrected (v3-report claims adjusted under verification)

- R6 ("allow-hooks fail closed if `_common.sh` breaks") — severity refuted: exit 1 is a *non-blocking* hook error to the harness (only exit 2 blocks), so the failure mode is fail-open-with-noise; the proposed `source … || echo '{}'` would hide guard death and was not adopted.
- The injector "runs the full CLI on every prompt with no idle short-circuit" — partly wrong: the `state read` is mtime-cached; the unconditional per-prompt cost is the context-builder spawn.
- PreToolUse matcher-merge and injector idle short-circuit — refuted by measurement (profile-skips cost ~1ms; the cache works); recorded as validated non-issues rather than shipped.

## [0.204.0] - 2026-07-25

Both items surfaced by a post-release deep-validation pass (adversarial mutation-testing of the session's new gates + an audit for further improvements).

### Added

- **Coordinator routing-table content-parity gate.** The `workflows/do.md` ↔ `agents/devt-coordinator.md` routing tables were gated on **row-count parity only** — the file's own drift note admitted it "does not catch column-content drift," so two equal-row tables could route a command to a different target, rename a command, or diverge on a `--flag` form undetected. The gate now also asserts the sorted `/devt:` command-token sets (full form incl. flags, extracted from table rows) are **identical** — the same drift class K320 closes for the implement/test bodies. Verified adversarially (mutating `/devt:ship`→`/devt:shipx` turns it red).

### Fixed

- **Smoke suite is now robust to a pre-existing "running" subagent in the dogfood repo.** Several gates (K4 among them) exercise the CLI against the repo's own `.devt/state/`, where `init workflow` is blocked by the lane-state-guard when `status.json` shows a fresh running agent — a crashed prior session (or a hook test) would abort the **entire** suite before the Result line. The setup now snapshots + clears `status.json` at start and restores it in the EXIT trap (mirroring the existing `workflow.yaml` tripwire), and the 8 bare `init workflow` calls are guarded with `|| true` so any init failure degrades to a visible gate failure instead of an ungraceful abort. Verified: injecting a running agent, the suite now runs 1068/0 instead of aborting at K4.

## [0.203.0] - 2026-07-22

### Added

- **Gate K320 — implement/test KEEP-IN-SYNC contract.** `dev-workflow.md` and `quick-implement.md` carry deliberately-divergent implement/test step bodies (dev is the full pipeline — verifier, arch, scope-requirements blocks; quick is the fast path). A deep scan measured them ~50% diverged, and most of the divergence is *intentional* — so rather than force them into a ~50%-mode-forked shared file (which would be less legible than two honest bodies, and is resident-neutral anyway), K320 asserts the LOAD-BEARING mechanical contract — `post-dispatch-check`, sidecar routing (`read-sidecar` + status enum), `phase=` update — is present in BOTH step bodies. It catches a silent gate-drop of the shared contract (the exact drift the review paths hit before K275) while letting prose + mode-specific blocks differ freely. The four `KEEP IN SYNC` markers now name the gate so the enforcement is legible to a maintainer editing either body. (Considered the full K275-style extraction; the scan showed the bodies are too divergent and too intentionally different for a shared file to be a net win — detection over deduplication.)

## [0.202.0] - 2026-07-22

### Changed

- **README `### CI` section slimmed ~36KB → <1KB (gate K319).** The section inlined a single run-on paragraph enumerating every drift-guard gate (107 of them, K94–K259) — a third of the entire README, and a count-sync burden that went stale the instant a gate was added (it stopped at K259 while the stack runs past K300). Nobody kept it synced because nobody could. The per-gate rationale already lives in the `## [X.Y.Z]` CHANGELOG entry that introduced each gate; the README now keeps a concise floor-based summary (`K94+`, 200+ gates) and points to CHANGELOG for the detail. New gate **K319** budgets the section at ≤2500B so the enumeration can't creep back — the count-sync relief K117's floor conversion started, finished on the README side.

## [0.201.0] - 2026-07-22

### Removed

- **`static-compress --plugin-build` retired, gate K84 with it.** The maintainer-mode CLI that prose-shrank the plugin's OWN `guardrails/` + `skills/` implemented exactly the transformation REJ-001 rejected. Three independent reasons converged on removal: it was wired into **no** release path (verified: zero references in `scripts/release.sh` + `.github/`, and known-unwired for months); its measured payoff was the cache-invisible **0.06–0.19%/dispatch** REJ-001 already cites (editing cached content is briefly net-negative); and running it against a real tree silently corrupted the corpus (the article-stripping the K84-hermetic fix in `0.199.0` had to fence off). Its only exercise was K84 — a gate verifying the CLI surface existed. Removed: the `--plugin-build` / `--allow-dirty` / `--root` flags, `compressPluginBuild` + `_compressPluginFile`, and gate K84 (a gate retires with its subject — RETIREMENT-WATCH policy). `static-compress` keeps `--all` / `--restore` / single-file compression on a project's own `.devt/rules/` — the surface REJ-001 does not cover. Recorded loudly: REJ-001 gains a "Machinery status" section, the RETIREMENT-WATCH strip-ledger gains the entry, and KCORPUS remains the whole-corpus tripwire against any future in-place mutation.

## [0.200.0] - 2026-07-22

### Hook-runtime consolidation

The stdin read and plugin-root resolution that every hook re-implemented are now single-sourced in `hooks/_common.sh`. This makes the argv→stdin (E2BIG) fix — which had to be applied to the hook ecosystem one script at a time — structurally un-reintroducible: a new hook sources the helper and inherits the correct, tty-guarded, time-boxed read for free.

### Changed

- **`hooks/_common.sh` single-sources `devt_read_stdin` + `devt_plugin_root`.** All 10 stdin-consuming hooks (`bash-guard`, `dispatch-hygiene-guard`, `memory-auto-index`, `pre-flight-guard`, `prompt-guard`, `read-before-edit-guard`, `stop`, `subagent-status`, `task-truncation-detector`, `workflow-context-injector`) now `source` it instead of carrying an inline `INPUT="" / if ! [ -t 0 ]; then timeout N cat …` block. Hook-specific empty-input actions (an allow-hook echoes `{}` before exit; others exit silently) stay in each hook. `devt_plugin_root` prefers the `PLUGIN_ROOT` the runner already exports, falling back to `$0`-relative resolution for direct invocation.
- **`workflow-context-injector` stdin read is now tty-guarded + time-boxed.** It previously used a bare `cat` with no `[ -t 0 ]` guard — robust only because the runner always pipes stdin; a direct or on-a-tty invocation could block. It now uses `devt_read_stdin` like the others.

### Added

- **Gate K318** enforces the consolidation: `_common.sh` defines both helpers, every stdin hook sources it and calls `devt_read_stdin`, none re-implements the inline `timeout N cat` read, and the sourced helper delivers end-to-end (bash-guard deny path survives the source).

## [0.199.0] - 2026-07-22

### Smoke-suite corpus safety (K84 hermetic + corpus-integrity gate)

An external post-0198 verification pass reproduced a silent-corruption class: the K84 smoke gate compressed the *live* `guardrails/` + `skills/` corpus in place and relied on `git checkout` to undo it. That cleanup is a no-op in a git-less checkout (archive install, shallow / no-`.git` tree), so a smoke run there left the REJ-001 prose-shrink transformation **permanent** — 21 files / ~6,982 bytes altered (article-stripped skill descriptions and guardrail bodies) — while the suite stayed green. Real CI checks out with `.git`, so cleanup fired there; the hazard was specifically git-less installs.

### Fixed

- **K84 is now hermetic — the live corpus is never a test subject.** The gate copies `guardrails/` + `skills/` into a `mktemp` fixture and points the compressor at it via a new `--plugin-build --root=<dir>` override (`compressPluginBuild` gained an `opts.root`, ~5 lines), following the K77/K81 fixture pattern. All `git diff` / `git checkout` / patch-restore logic is gone — the compressor *cannot* reach the working tree because it never receives its path. A new hermeticity assertion confirms the compressor reported the fixture (not the repo root) as `plugin_root`.
- **`read-before-edit-guard.sh` reads hook input from stdin, not `process.argv`.** The 8th and last hook still passing the JSON payload on argv — a large payload could hit `E2BIG` and silently skip the guard. Now `printf '%s' "$INPUT" | node -e "… fs.readFileSync(0,'utf8') …"`, matching the other seven hooks hardened earlier.

### Added

- **KCORPUS corpus-integrity gate.** A whole-corpus sha256 of `guardrails/` + `skills/` is captured before any gate runs and asserted byte-identical at suite end. This is the tripwire for the *entire* in-place-mutation class — independent of which pinned phrase a content-grep gate happens to watch (only 1 of the pinned-phrase gates could have caught the article-stripping) and independent of which gate causes the mutation, present or future. Belt to K84's suspenders; degrades safe (absent `shasum` → empty digests → no-op).

### Changed

- **`guardrails_mode` config-absent fallback aligned `inline` → `by-reference`.** The authoritative default has lived in `config.cjs` DEFAULTS as `by-reference` since the measured flip, but the secondary fallbacks in `dispatch.cjs` and `init.cjs` (fired only on a total config-read failure) still read `|| "inline"` — so a degraded path silently reverted guardrails to the *expensive* inline mode, the opposite of the intended default. Both now read `|| "by-reference"` and use the same `!== "inline"` idiom as `rules_mode` / `rubric_mode`, and the stale "defaults to inline / opt-in until field-measured" comments are corrected to match reality.

## [0.198.1] - 2026-07-21

### Fixed

- **`review-weight`'s "scope unresolvable — empty diff" message now names the base.** Field calibration surfaced that the message hid *which* base resolved to empty — so a base mismatch (the workflow computing scope against `main` while the operator meant `development`) read as a bare "empty diff" the operator couldn't diagnose. It now reads `empty diff for base '<base>' (<base>...HEAD + working tree + untracked all empty); if that base is wrong, set git.primary_branch in .devt/config.json (or export PRIMARY_BRANCH), else … pass --range=<a>..<b>`. Complements the v0.198.0 `PRIMARY_BRANCH`→config fix by making any residual base mismatch immediately legible.

## [0.198.0] - 2026-07-21

### Field-report fixes (greenfield calibration) + measured guardrails default flip

A calibration field run surfaced five items; double-verification (a code-verify agent + a controlled git fixture) confirmed three real fixes, corrected two of the report's own claims, and pinned #1's true root cause. Plus the measured `guardrails_mode` flip and the staleness silent-warn unification.

### Fixed

- **Review/dev scope no longer mis-bases to `main` on non-main-default repos (K317).** `PRIMARY_BRANCH` was consumed as `${PRIMARY_BRANCH:-main}` at 12 sites across 6 workflows but never assigned from config — so on a repo with `git.primary_branch: "development"`, every scope computation (review-weight, changed-files, domain count, parallel scope, merge-base, the context-init wrapper) silently used `main`. The field report framed it as a review-weight *diff divergence*; a controlled fixture proved review-weight's diff is correct given the right base — the CLIs already default `--base` to `config.git.primary_branch`. Fix: pass the flag only when `PRIMARY_BRANCH` is explicitly set (`${PRIMARY_BRANCH:+--base=...}`), letting the CLI fall back to config (the one raw `git merge-base` resolves config inline). Backward-compatible — no config still means `main`. Also unblocks the `--lite` auto-suggest, which had been reading false scope numbers.
- **Impact-plan `args.symbols` no longer leaks docstring prose (K317).** `graphify.cjs::symbolsInFiles` pushed a node's `label` with no identifier gate; docstring pseudo-nodes carry a real `source_file` (so the concept/file/json filters miss them) but a prose label with spaces. A whitespace filter now drops them before they reach the impact plan (with a `docstring_filtered` counter) — whitespace, **not** a length cap: field data showed 92 legitimate symbols over 64 chars. Low-severity hygiene (graphify's own blast_radius noise filter already absorbed the fragments downstream).
- **Lane `correlation_id` is stamped at registration (K317).** `register-lane` now stamps a deterministic `cid_<workflow_id_prefix>_<lane_id>` (matching render-lanes) into the lane record, and `list-lane-outputs` surfaces it + falls back to it for `cid_match` — so the consolidate step's `cid_match != "foreign"` stale-lane filter and trace-back work immediately after registration instead of only after a reviewer echoes the cid into the review file.

### Changed

- **`dispatch.guardrails_mode` default flipped `inline` → `by-reference`.** Measured: ~6.1K tok/programmer dispatch, ~3.9K reviewer, ~3.3K tester saved (~13–19K tok per STANDARD dev run), on the same proven stub mechanism `rules_mode` uses; the guardrails stub directs an unconditional disk read, and `--inline-rules` restores inline for worktree-isolated dispatches. (K314 flipped to assert the by-reference default; D-11 forces inline to keep verifying the full-content load path.)
- **`--lite` suggestion suppressed on thoroughness intent.** When the review task text carries `detailed` / `thorough` / `audit` / cascade intent, the light-eligible suggestion is withheld (the operator can still pass `--lite`) — reusing the parallel short-circuit's intent-signal class.
- **Staleness silent-warn band unified across debug / quick-implement / research-task.** The `0 < lag < threshold` middle band now emits a one-line `[staleness]` note and continues, matching `/devt:review`'s tiered `warn` tier (these three were previously silent for mid-range staleness).

### Corrected (field-report claims softened under verification)

- The "review-weight vs changed-files internal divergence" was refuted — both call the same `collectChangedFiles`; the real bug was `PRIMARY_BRANCH` never sourced from config (above).
- The docstring-symbol impact was downgraded from "confirmed bug" to low-severity hygiene — no wrong blast_radius was ever observed.

## [0.197.0] - 2026-07-21

### Composite claim-check / finalize CLI verbs + K117 gate-count floor

Two mechanical sequences copy-pasted across the workflows become single-sourced CLI verbs (the `preflight scan-prep` precedent applied twice more), and the K-gate count the docs advertise becomes a floor instead of an exact number that taxed a manual re-sync on every gate addition.

### Added

- **`state post-dispatch-check <agent>` — one call for the post-dispatch claim-check ladder (K316).** Composes `assert-artifact-present` + `recover-partial-impl` into a `{action}` verdict (`proceed` | `sendmessage_resume` | `redispatch` | `investigate`) with a `resume_hint` distinguishing the rate-limit and structural-drift cases; the workflow keeps only the routing semantics and drops the ~35-line branching. Wired at 7 dispatch sites (dev + quick programmer, quick reviewer, dev-complex architect, dev-standard verifier, code-review reviewer, debug debugger). The parallel-lane substance-check state machine keeps its prose — its per-lane retry budget + terminal statuses don't map onto the 4-action model.
- **`state finalize-gates` — one call for the finalize gate trio (K316).** Runs `aggregate-knowledge-candidates` first (so the knowledge-candidates gate counts freshly-harvested tags), then the SAME `_phase-gates.yaml` registry runner `assert-all`/`advance-phase` already use — single-sourcing the claim-check / raw-dispatch / knowledge-candidate set so it can't drift out of sync across the five finalize sites that copy-pasted it. Nonzero exit on any block. Wired at dev/quick/debug finalize; code-review's superset finalize (adds curator/verifier/axis-H gates + K275 partition integrity) stays inline. Deliberately does NOT truncate scratchpad — the caller's terminal `advance-phase` re-runs the knowledge-candidates gate, so the truncate stays the last step after it (KC-before-truncate preserved by position, not by erasing the tags the re-check needs).

### Changed

- **K117 is a gate-count FLOOR, not an exact count.** The README / CLAUDE.md "N-deep drift-guard stack K94–KNNN" claim taxed a manual four-string re-sync on every gate addition — for a number no reader cares about. The docs now advertise a floor (`K94+`, 200+ gates) and K117 enforces only that the real gate count hasn't shrunk below it; the floor is bumped when crossing a round hundred, upward, never per-gate. (K7 + K50 claim-check presence gates now accept either `assert-artifact-present` or the folded `post-dispatch-check`.)

## [0.196.0] - 2026-07-21

### Deep-read validation pass — two P0 defects, the guardrails by-reference lever, hook-latency measurement, drift-class gates, debug unification

An external deep-read of the plugin against the four north stars was code-verified finding-by-finding (38 of 39 sampled anchors exact; cited byte counts byte-exact) and the top of its recommended sequence shipped. Guiding frame unchanged: **weight is an adoption risk, not just a token cost.** Drift-guard stack 221 → 223 deep (K94–K315).

### Fixed

- **Seven hooks no longer hard-fail (and prompt-guard no longer silently skips its scan) on payloads over ARG_MAX.** `memory-auto-index.sh`, `stop.sh`, `subagent-status.sh`, `pre-flight-guard.sh`, `prompt-guard.sh`, `dispatch-hygiene-guard.sh`, and `task-truncation-detector.sh` passed the event payload as a single `node -e '…' "$INPUT"` argv argument; a payload above ~1 MB exceeded ARG_MAX, so `node` never ran and `set -e` exited non-zero (field trace: all 36 non-zero hook exits were `memory-auto-index.sh` with stdin ≥ 1.088 MB). For `prompt-guard.sh` this was a **silent injection-scan bypass** on exactly the writes big enough to hide an injection — the CON-001 substance-vs-form failure mode, in hook plumbing. All ten call-sites now pipe the payload via stdin (`printf '%s' "$INPUT" | node -e '… fs.readFileSync(0) …'`), the shape `bash-guard.sh` already used — strictly widens coverage, no behavior change. Regression-tested: a 3.2 MB payload now exits 0 (was 126) and the injection scan fires on a > 1.5 MB write.
- **`/devt:memory promote|reject` are routable again (circular contract break closed).** The command frontmatter advertised `promote`/`reject`/`suggest` but the router (`workflows/memory-init.md`) sent every subcommand to `node … memory <sub>`, where `promote`/`reject` return exit 2 by design — so the shipped `workflows/memory-promote.md` / `memory-reject.md` were never loaded, and the CLI bounced the user back to a slash route that never took it. The router now branches `promote`/`reject` to their workflows; `commands/memory.md` gained the three routing rows; both "Phase 2 will add …" roadmap sentences (banned version-markers, and false) are deleted. (`suggest` was already functional via the generic fallback.)
- **Drift-class instances corrected across code + docs.** `help.md` counts (15 visible · 4 specialized → 16 · 3, with `/devt:thread` moved to the visible tier where K94 already places it; the `v0.93` version-marker narrative removed); three banned `v0.x` markers in runtime source (`preflight.cjs`, `devt-tools.cjs`, `devt-memory-mcp.cjs`); ghost path refs (`dispatch-scope-guard.sh` → the merged `dispatch-hygiene-guard.sh`, `contamination-prevention.md` → `contamination-guidelines.md`, a dead `skills/caveman-compress/` path); the README "model profiles carry per-agent effort settings" claim (profiles carry model tiers — effort is frontmatter-only, per K239 in the same line); the `code-reviewer.md` "graphify-helpers preloaded for code-reviewer" claim (it is architect-only; the Bash CLI works regardless); and the unsubstantiated "skills-workspace used by autoskill" note.

### Added

- **`dispatch.guardrails_mode` — the `<guardrails_inline>` block gains a by-reference mode (K314).** The ~25 KB golden-rules + engineering-principles + generative-debt-checklist bundle rode fully inline in 8 envelope templates across 4 agent families (82–88 % of the heavyweight envelopes) while rules and rubric already defaulted to by-reference. `guardrails_mode` mirrors `rules_mode` exactly — `by-reference` swaps each body for a single-sourced `GUARDRAILS_BY_REFERENCE_STUB` the templates' Context-Loaded contract already treats as read-and-record; the agent-side "Read from guardrails/ when the inline block is absent" fallback already existed in all four bodies. **Defaults to `inline`** (unlike rules/rubric) — zero behavior change until measured; `--guardrails-by-reference` opts a single dispatch in, `--inline-rules` forces inline for worktree lanes. When flipped: −25 KB (~6.2 K tok)/dispatch for programmer + code-reviewer, −13.6 KB for tester. tester + architect now **declare** the `guardrails_inline` block they already render (the present-but-undeclared io-contract gap K206 missed), and the CLAUDE.md / INTERNALS.md "programmer + code-reviewer only" claim is corrected to all four families.
- **`duration_ms` on every hook-trace record.** `run-hook.js` now stamps a `Date.now()` delta on all four trace call-sites (spawn + dead-spawn paths) — the measurement primitive the hook-runtime cost line depends on, standing in for `hook-cost.cjs`'s hard-coded 1.5 s constant (an enabled `subagent-status.sh` measured 68 ms; a profile-disabled dead-spawn 0 ms in-process, its Node cold-start being the invisible cost).
- **Drift-class gate K315.** Three audit sweeps promoted to a permanent gate: (a) every `hooks/` / `guardrails/` path referenced in a live docs/ file (reports + archive excluded) resolves on disk; (b) no devt-internal `v0.x` markers survive in the runtime/prose surfaces (third-party graphify + a changelog-header regex example allowlisted); (c) `help.md`'s printed visible/specialized counts derive from the command frontmatter.

### Changed

- **`debug.md` context_init adopts the `state workflow-context-init` wrapper + `preflight scan-prep` verb.** It was the last graphify-touching workflow still hand-rolling its init (state update + evict-graphify + `preflight generate` + an inline scan-prep decision tree — ~45 lines of bash). Now uniform with dev-workflow + quick-implement: ~6 CLI round-trips collapse to ~2 and the graphify scan-prep decision single-sources through the shared CLI. Behavior-preserving (all ~15 debug.md smoke gates green; the F13 `query_graph(task_text)` RECOVERY-branch literal kept).

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

