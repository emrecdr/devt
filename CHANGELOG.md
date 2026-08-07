# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/). The `[Unreleased]` section below stages changes for the next version — when bumping, rename it to `## [X.Y.Z] - YYYY-MM-DD` so the release workflow's changelog extractor (`scripts/extract-changelog.sh`) can find it.

Older releases (v0.1.0–v0.196.0) are rotated into `docs/archive/CHANGELOG-historical.md` — the root file keeps `[Unreleased]` plus the most recent releases (rotation ceiling enforced by smoke gate K288).

## [Unreleased]

## [0.240.0] - 2026-08-07

### Fixed

- **"No parallel" started a seven-lane parallel review.** The scope_check intent short-circuit tested `PARALLEL_INTENT_RE` before `SINGLE_INTENT_RE` — and every phrase that *declines* a fan-out contains the word it declines. "review this, no parallel", "single agent, no fan-out please", and "do not fan out, one reviewer only" all matched the parallel test on the substring inside the refusal and routed the operator into exactly what they had ruled out. The single-intent regex already listed `no parallel` and `no fan[ -]out`, so the negation case was anticipated; only the branch order was wrong. This is worse than a bad guess, because the short-circuit exists to **skip the AskUserQuestion** — there was no correction step, no error, and the only symptom was a fan-out the operator had declined in writing. Single is now tested first (its phrases are specific; a bare "parallel" substring is not) and the regex covers `not/without/avoid/don't` forms. The residual case — "run in parallel, not a single agent" reading as single — is rare and fails toward the cheaper dispatch.

### Changed

- **K178 tests the classifier instead of grepping for a literal.** It extracted `SCOPE_CHECK_DECISION="parallel"` from the workflow and asserted the string was present — which it was, in every inverted variant. The gate now pulls both regexes from the shipped workflow (never a copy, which would drift and keep passing) and classifies ten task strings including the three negations, plus asserts the branch order structurally. Verified falsifiable: reverting the order turns it red. Of the nine gates flagged as claiming runtime behavior, five were re-examined and left alone — "does file A reference symbol B" is a text question by nature, and converting an honestly-scoped wiring gate adds cost without adding truth. Two more (the god-node emitter, the ambiguous-bindings chain) run through graphify, and a gate that silently skips when a binary is absent is worse than a text gate that always runs.

## [0.239.0] - 2026-08-07

### Fixed

- **A project's own files were evicted from `.devt/state/` on every single run, and the failure was attributed to their code.** The sweep classified anything outside devt's filename contract as ad-hoc and archived it once it predated the workflow — so a repo-committed test baseline qualified *always*, the architecture-drift test that read it failed, and the failure presented as "this branch introduced drift", pointing at innocent code. Eleven of eleven archive directories in the reporting project held that baseline plus two rendered fixtures. The sweep now splits on **authorship, not age**: files matching the contract are devt's and are archived on schedule; files matching nothing are the project's and are never auto-archived, only reported. Age was never the question, and it was wrong in exactly the case that hurt — a committed file is always older than the workflow. Git-tracking looked like a cleaner authorship signal and isn't available: projects gitignore `.devt/state/` wholesale, so "did the project commit it?" answers *no* for the baseline too. The manual `state cleanup` still sweeps foreign files, because the harm was the silence and the automation, not the archival.
- **devt archived its own outputs as unrecognized, and starved its own cost analytics doing it.** `gate-trace.jsonl`, `status.json`, `hook-trace/`, `lane-unassigned.txt` and the per-lane `review-lane-*.json` sidecars matched nothing in the contract, so devt swept files devt wrote — including the ones `telemetry-calibrate`, `hook-cost` and `weekly-report` read, all three of which read only the live path and never the archive. The consequence was not untidiness: devt's own longitudinal telemetry had a horizon of one workflow, which is why the cost question the reporting operator could not answer was unanswerable *by construction*. All are now declared.
- **`reset-soft` created files that `review-context-init` treated as litter 22 seconds later.** Rotated logs land as `<log>.archive-<ts>.jsonl`, a shape no pattern matched. One devt command produced them; the next archived them. Declared as a pattern, and their volume is what kept every archive directory noisy enough that a genuinely foreign file didn't stand out.
- **Following the documented scope-artifact template was what broke the scope parser.** `code-review.md::identify_scope` documents `# Review Scope` / `## Files` / `## Source`; the parallel pre-write emitted only the first two. The parser read every non-heading line, so the `## Source` provenance descriptor parsed as a file — a phantom entry in the declared universe that reached `lane-unassigned.txt` and pushed the consolidator into its "MUST NOT report complete coverage" branch over a line that was never a file. Both emitters now write the same shape and the parser reads only `## Files` (a bare list with no heading still parses). Fixing only the parser would have made the divergence invisible rather than absent.
- **The severity cross-check went dark again, four versions after being fixed.** The prior fix pinned the *reader* to accept a flat block or a `raw_total` roll-up; a run wrote `{by_lane, declared_totals}` and the cross-check reported an unreadable shape. The durable half was missing: `raw_lane_finding_counts` appeared in the reader, the consumer bash and the release notes — **zero surfaces any agent reads**. The shape is now rendered into the consolidator's task block, the way the per-lane sidecar shape already was. That asymmetry is why the lane sidecars parsed and the roll-up didn't.
- **A gate blamed an agent for omitting a field nothing asked it for.** The verifier short-circuit declined because `review.json` carried no `self_flagged_uncertainties` and said the agent "did not engage with the self-flag contract" — but the parallel consolidator's task block enumerates the sidecar requirements and never names it. The routing was always correct; the reason string sent the next debugger to interrogate an agent that was never told. It now reports the field as absent and says to check whether the dispatch asked for it. The field was deliberately NOT added to the consolidator contract: the workflow refuses to act on it in parallel mode, and collecting a signal nothing consumes invites someone to wire it up because the data is sitting there.
- **A review that ended `NEEDS_WORK` looked resumable, so its counters carried into the next run.** Auto-reset required `phase=complete` or a task+type change; a `NEEDS_WORK` review parks at `present_findings` and a re-review reuses the task text, so neither branch fired. A terminal verdict is the same "nothing to resume" signal `phase=complete` carries, and is now treated as one. Interrupted and paused runs still go through the operator prompt. Field evidence: an operator appending `--fresh` to every re-review by reflex.
- **`claim-check-failures.jsonl` contained only successes.** Seven rows, every one `verdict: "success"` — a name that reads as seven failures at a glance, and glances are what happen during incidents. Renamed to `claim-checks.jsonl`. Successes keep being written: they are what proves each lane actually wrote its artifact, and a failures-only file is indistinguishable from a file nothing wrote to.

### Changed

- **The severity cross-check now runs per lane and names which one drifted.** `by_lane` is treated as the consolidator's claim over any roll-up, because it is checkable lane-by-lane against sidecars the consolidator cannot author while a roll-up is a number it typed. The aggregate answered "did a finding get lost"; this answers "which lane lost it", which is actionable without re-reading every lane file — and it lets this guard and the lane sample corroborate each other, which they could not do while one was aggregate. A consolidator whose own `by_lane` and roll-up disagree is reported rather than silently resolved: the only two ways to get there are an arithmetic error or findings dropped from `by_lane` while the headline total held, and the second is exactly what the guard exists to catch.
- **Coverage is four claims, not one, and the templates now say so.** `files_assigned`, `files_mentioned`, `files_with_findings`, and `files_cleared` — the last meaning *verified with concrete evidence of why there is nothing to report*, not a bare "no issues found". A consolidated report claimed "88 of 88 files covered" when 43 appeared in the prose; both readings were legitimate and both were devt's own (rubric axis A measures mentions, the consolidator contract measured assignment). It cost a full verify-retry cycle. The fourth bucket exists because a lane's most careful work — the branch's highest-blast-radius file, verified across seven subclasses and both callers — did not survive consolidation and the file appeared nowhere. **A clean verification is a finding**; dropping one silently turns "verified safe" into "not mentioned", and those are indistinguishable to every downstream reader.
- **The sweep is loud, and the foreign count is stated separately.** Archive directories carry a `MANIFEST.txt` naming every file moved, its reason, and every file deliberately left behind; init emits one summary line. The counts are split because "archived 4 files" is ignorable and "2 not written by devt" is not — and the second is the only part that can point at damage outside devt's own state. The count is surfaced at `present_findings` as well as at init, since init's stderr scrolls past under a 20-block orchestration.

### Added

- **F35–F38** — four behavioral gates: the auto-sweep leaves foreign files on disk while still archiving devt-owned ones (and the manual sweep still clears both); the cross-check reads `by_lane`, names the drifting lane, and reports a self-contradicting consolidator; the scope parser treats `## Source` as prose across all three artifact shapes; a terminal verdict auto-resets while mid-flight and paused runs stay resumable. Each executes the code path rather than grepping prose about it — `O1` had to be rewritten because it asserted the *old* contract, and would have kept passing on the defect.

## [0.238.0] - 2026-08-07

### Changed

- **The partition gates test the partitioner instead of grepping for words about it.** An audit of all 532 gates found 78 that only grep prose and never execute anything; of those, 11 have pass messages claiming *runtime behaviour* — the class where the words can be present while the behaviour is wrong, which is how the previous release's overflow leg stayed green as the merge inverted. `F33b` was the worst of them: its pattern `routing.*single-dispatch` is satisfied by the very echo line that *reports* the fallback, so it passed whether or not the fallback worked — on the one path whose silent failure ran a five-lane review as one. Both F33 legs now call `state partition-lanes` and assert the decision it returns: exactly-at-cap partitions without merging, over-cap caps and merges, and an unrecoverable empty scope returns `action: route_single_dispatch`. Verified value-sensitive (the same fixture at `--target-lanes=4` yields `4:merged` against the gate's `5:merged`), and the remaining nine behaviour-claiming text-only gates are recorded for the same treatment.

## [0.237.0] - 2026-08-07

### Changed

- **`review-weight advise` owns the announce protocol.** The advisory was 25 lines of workflow bash that re-ran the **entire compound `review-context-init`** solely to read three fields already cached on disk — the impact-plan tier, `god_node_warnings`, and `blast.effect_size` — then assembled six flags, branched four ways, and echoed. One call now does all of it, reading those fields directly: equivalent, strictly cheaper, and the four branches become testable instead of living in a markdown fence. **−3.0KB from `code-review.md`.**

### Fixed

- **The advisory read a god-node signal that was never there.** `readState()` already parses the `*_json` state fields, so `god_node_warnings_json` arrives as an object; `JSON.parse` on it threw straight into a swallowing catch and left the signal `undefined`. Undefined reads as "god-node unknown", which forces a graph-blind **HEAVY** verdict on a genuinely light change — the advisory would have recommended the heavy path forever, and the failure was invisible because the fail-safe direction looks like a real answer. Both shapes are accepted now. Found by writing the gate: the behavioural leg failed where a grep-shaped one would have passed.

Guarded by K346 — light-eligible and thoroughness-suppression are asserted by running the advisory, not by matching its text.

## [0.236.0] - 2026-08-07

The first net-negative release of this arc. The review workflow surface had grown every release while the field kept reporting orientation cost; measuring where the bytes actually were found one bash block holding 19% of `code-review-parallel.md`.

### Changed

- **`partition_lanes` is one CLI call instead of 156 lines of bash.** The step carried scope self-recovery, `lane-suggestions`, mode branching, path grouping, degradation persistence, the cap/merge, and registration — plus an embedded `node -e` script — inside a markdown fence. None of it needed orchestrator judgment, none of it could be unit-tested, and its cap/merge half had already diverged from the community path's. It is now `state partition-lanes`, and the step is 2.0KB of call-plus-print with a five-point prose contract stating what the CLI does. **−10.0KB from the step, −8.2KB net across the review surface** after the contract prose. The two conditions that route the whole review back to single-dispatch stay with the caller — a library cannot exit a workflow, so they return `action: "route_single_dispatch"` with a reason.
- **Seven gates now test the partitioner instead of grepping its prose.** Each asserted that certain words appeared in a markdown file — the weakest available verification, and the reason the previous release's `mixed-overflow` leg stayed green while the behaviour inverted. They now assert against `state-lanes.cjs` or run the partitioner: K335's overflow leg builds a 9-group fixture and checks the resulting lane shape (`5:13:coherent`, red on the old implementation).

### Fixed

- **The partitioner and the coverage check read the same artifact two different ways.** `code-review-input.md` was parsed permissively by the bash (every non-comment line, bullet stripped) and strictly by the coverage set-difference (bullets under a `## Files` heading only), so a scope file written without that heading partitioned normally and then reported *no declared files at all* — silently disabling the coverage guarantee added one release earlier. One parser now serves both, on the permissive side: a heading is presentation, and a coverage claim must be about every path the artifact names.

## [0.235.0] - 2026-08-07

### Fixed

- **The path-fallback partitioner built a grab-bag lane.** Beyond the 5-lane cap it kept the four largest groups and swept everything else into a single `mixed-overflow` lane — on a 9-domain diff that is five unrelated services sharing one review, and a lane whose scope is "everything left over" has no coherent lens, which is the one thing a lane needs. Leftovers now join their most path-similar anchor with a fair-share load balance, so nothing drops *and* nothing becomes a grab-bag. The community path in `graphify.cjs` had already been fixed this way after an identical incident; the fallback kept the naive version, so which merge strategy ran depended on whether the graph had community data. Verified on the reported shape: 9 groups → 5 lanes of 10/9/9/4/4, all 36 files preserved, no overflow lane.
- **The gate guarding that merge could be satisfied by prose asserting the opposite.** K335 grepped `code-review-parallel.md` for the string `mixed-overflow`; a rewrite whose comment read "no mixed-overflow grab-bag lane" kept the gate green while the behaviour inverted. It now *runs* the partitioner against a 9-group fixture and asserts the lane shape — `5:36:coherent`, red against the previous implementation. A gate satisfiable by a sentence saying the opposite is not a gate.

## [0.234.0] - 2026-08-07

The batch after the batch. v0.233.0 moved the severity gate onto the schema'd sidecar so it would stop asserting things it couldn't see — and then asserted something it couldn't see, because the sidecar field it compared against had no declared shape. A guard that cries wolf on a correct artifact is worse than no guard: it trains the operator to skip it.

### Fixed

- **The severity cross-check reported a total disagreement against perfectly consistent data.** `raw_lane_finding_counts` was specified without a shape, so a consolidator wrote `{by_lane:{…}, raw_total:{…}}`; the reader indexed the severity keys directly, got four `undefined`s, floored them to four zeros, and announced every severity mismatched — "STOP and reconcile" on a review whose lane sidecars and roll-up agreed exactly. The shape is now declared: flat `{critical,important,minor,nit}`, with a `raw_total` roll-up accepted beside a `by_lane` breakdown. Anything else is **drift, and drift is loud as drift** — reported as `cross_check_unavailable` with the expected shapes named, never as a count disagreement. This is the same defect as the prose parser one layer in: fixing "prose vs sidecar" without pinning the shape simply relocated it to "sidecar shape vs reader".
- **The narrative guard returned a success shape over data it never inspected.** With no `findings[]` index in `review.json` it emitted `ids_missing_from_review: []` — indistinguishable from "checked, nothing missing". It now reports `null` plus a `narrative_guard` reason, and the consolidate step propagates the caveat into `review.md` itself. A guard that cannot evaluate has to say so where the review is read; the field operator saw `findings_listed: 0` inside a dense JSON line and nearly skipped past it.
- **A mid-run workflow-id rotation gave every lane two correlation ids.** A `workflow_type` transition rotates `workflow_id`, and a rotation landing between `register-lanes` and `render-lanes` meant six lanes were registered as `cid_7e2fa293_*` and dispatched as `cid_08417ab9_*`. Only chain-aware matching kept the run alive — a consumer comparing by string equality would have dropped every lane as foreign, the exact failure the workflow warns about elsewhere. The registry already stored the id; render now reads it instead of recomputing. Safe because `cid_match` resolves against the id chain, so a cid older than the current id still reads `current`.
- **Claim-check records carried `ok: null` on every success.** The field was derived into `verdict` and never written, so a consumer filtering `ok === false` matched nothing while one filtering `!ok` matched every success as a failure — same datum, two opposite wrong answers.
- **A zero-match `mcp-stats` filter returned `aggregate: null`.** The obvious `.aggregate.total_calls` threw instead of reporting zero. An empty result set now returns a zeroed aggregate; shape stability across the empty case is the point of returning a summary object.
- **A review archived a baseline the project's own test suite reads.** `context_init` sweeps unrecognized files out of `.devt/state/`, and a project keeping a canonical-drift baseline there lost it on three consecutive runs — the resulting failure flagged a service the branch never touched and read as a regression in the code under review. The root cause is not any filename: projects treat `.devt/state/` as shared scratch while devt treats it as private state. **`.devt/state/project/` is now the project's half and is never swept**, the python-fastapi template's baseline moves there, and the READ-ONLY claim — which promised more than it could deliver — now says it covers project *source*, not `.devt/state/`.

### Added

- **The verifier samples one lane.** It graded only the consolidated review, so a lane that quietly stopped early was invisible: its thin output merges in indistinguishably from a genuinely clean slice. The sampled lane is the highest **LOC-per-finding** — not the largest (often legitimately dense) and not the one with the most findings (which selects the lane that already worked hardest). "Big diff, few findings" is where under-review hides; on the run this came from it selects a 1061-line lane with 11 findings over a 331-line lane with 10. A weak sample annotates `review.md` rather than blocking a completed review.

Guarded by K345 (nine legs), each verified red against the pre-fix tree.

## [0.233.0] - 2026-08-06

A field batch about **falsifiability**. Every fix below is the same defect wearing different clothes: a component asserted something about coverage that no consumer could check. The severity gate asserted counts nobody diffed against a schema'd source; a hand-authored partition asserted completeness nobody diffed against the declared scope; an unbound scope variable asserted a task nobody compared to what the operator typed.

### Fixed

- **The severity gate re-derived numbers the sidecar already stated, and got them wrong.** `lane-severity-tally` parsed severity out of rendered markdown, so it read `{0,0,0,0}` off a 91KB consolidated review whose own `review.json` carried 3 critical / 37 important — then fired the "counts below lane totals … an unexplained drop is a lost finding" branch, costing a real investigation into 29 findings that had never gone anywhere. Tightening the regex was never available as a fix: the dispatch envelope instructs the consolidator to *"Group findings by file for the consolidated output"* while the parser counted severity headings, so the contract and the parser could not both be satisfied — devt was disagreeing with itself, and the prose parser was the side without a contract. Both sides now read `review.json`; the prose parser is gone rather than repaired. The gate fails closed when the sidecar is unreadable, because a zero-shaped default is exactly the failure being removed. What the prose check was reaching for survives in answerable form: every finding id the sidecar declares must appear in the rendered review, so a narrative that drops a counted finding is named. `lane_declared` is the consolidator's own `raw_lane_finding_counts` — self-reported, catching inconsistency rather than fabrication — and `basis` says so at the call site instead of letting the gate read as stronger than it is.
- **A hand-authored lane partition could drop files while the run reported complete coverage.** The auto-partitioner merges overflow groups into an anchor lane, so nothing it emits can fall out; `register-lanes` had no equivalent check, and a field partition omitted two declared files while the consolidator wrote "there is no uncovered scope" in good faith. Registration now set-differences the lane union against `code-review-input.md` — the declared scope universe, which is what a coverage claim is *about*; the blast radius answers a different question and would flag dependents that were never review targets. The binding form is not the partition-time warning, which scrolls past twenty orchestration blocks before coverage is claimed: the unassigned list rides into the consolidator envelope as `<unassigned_scope>`, making the false claim impossible rather than merely discouraged. Silent when the partition is complete — a check that always speaks earns the ignore reflex.
- **`REVIEW_SCOPE` was load-bearing in `code-review.md` and assigned nowhere.** Twelve-plus references, no binding — and because each Bash call is a fresh shell, a value bound in one block cannot survive to the next anyway. An unbound run does not error: `review-context-init` substitutes the literal `code review` into `workflow.yaml::task`, the Pre-Flight Brief query, and the memory signal at once, so preflight searches for the words "code review" and every downstream consumer reads a plausible, content-free scope. Worse, a *later* block calling `review-context-init` unbound **overwrites** a good task with that literal. Both acquisition modes are now stated once and applied at every call site: substeps 0–1 bind from the arguments, everything after re-reads the task from state. The seven `${REVIEW_SCOPE} ${ARGUMENTS:-}` defensive pairings were never guarding a second semantic case — they were per-callsite workarounds for non-persistence.
- **An absent scope is reported rather than absorbed.** `contextInitBundle` now records the substitution in `degraded_fields` and returns `scope_missing`, and substep 1 prints it. The failure signature was previously invisible by construction: nothing failed, so nothing was said.
- **The curation escalation went quiet exactly as the backlog got worse.** The high-water reminder carried its own 168h window, so it spoke once at 4× the surfacing threshold and then stayed silent for a week while candidates kept accumulating — anti-correlated with urgency, and the field hit precisely that (22 pending, 4.4× threshold, footer reading "cooldown blocked"). Time is the wrong axis for a monotonically growing backlog: the escalation now fires on each integer multiplier crossing (2×, 3×, 4×…) with the hour floor demoted to a burst rate-limit, and the stamp records the level it spoke at so a backlog that stops growing stops talking. The status line no longer reads "cooldown blocked" on a turn it is in fact escalating.
- **A zero knowledge-candidate harvest read as a loss when it was the correct result.** `aggregate-knowledge-candidates` is a rescue path for tags written to review outputs instead of `scratchpad.md`, where agents are actually told to put them — so zero rescued is normal. Reporting only "no `#KNOWLEDGE-CANDIDATE` lines in lane outputs" beside six lane files that discussed candidates in prose led an operator to conclude the harvest was broken while 64 correctly tagged lines sat in scratchpad. The zero case now reports where the candidates are, and distinguishes "none here because they are in the documented sink" from "none anywhere".

### Added

- **Per-lane JSON sidecars are the primary basis for the lane severity total.** Each lane reviewer now writes `review-lane-<id>.json` beside its markdown, carrying `severity_counts` + `findings[{id,severity}]`. This is the one lane number the consolidator cannot author: the previous basis was its own `raw_lane_finding_counts`, which catches a disagreement but not a drop that is under-reported to match. The self-report is kept as an independent cross-check rather than discarded — two sources that disagree mean one is wrong, and `cross_check_mismatch` names which severity and which side. A run whose lanes wrote no sidecar falls back to the self-report and **says so** (`basis`), because a gate that silently weakens is the failure this batch is about.

### Changed

- **`memory.candidates_high_water_cooldown_hours` → `candidates_escalation_floor_hours`** (default 168 → 1), and `candidates_high_water_multiplier` default 3 → 2. The key was renamed because its meaning inverted: it was a gate, it is now a floor.
- **Parallel-intent detection no longer rests on a single alternative.** The `split` alternative allows interior words (`split[^.]{0,30}(multiple|several)`), so the natural phrasing "split this review between multiple agents" matches on its own terms; previously only the unrelated `multiple agents` alternative carried it, and the routing decision for a whole review rode on that coincidence. Spelling tolerance was deliberately not added — a real run typed "paralel" and chasing variants is unbounded over-fitting. The safety net is stated instead: an empty decision with the offer bar crossed is the no-match branch and **must** ask, never default.

Guarded by K344 (nine legs) and a rewritten K340 whose fixture is a by-file consolidated review carrying no severity headings at all — the shape that read zero in the field. A fixture written in the format the parser already matched is how the previous version of this bug shipped green.

## [0.232.0] - 2026-08-05

### Fixed

- **`init` deleted graphify artifacts the current session had just written.** `evictWorkflowArtifacts` chained an ungated graphify eviction, and `init` runs it on every context-init — so a re-anchor mid-review destroyed the blast-radius map the decision gate had already verified, before the freshness read and before the session-anchored eviction that was supposed to protect it. Lane envelopes then pointed at a file that no longer existed, and the only trace was an envelope health field that nothing blocks on. Before: a zero-second-old `graph-impact.md` was reachable by this path. After: the chain is anchored on the same session cutoff the canonical sweep already uses; cross-session artifacts are still evicted. The comment asserting that `init` "does not evict graph-impact.md" — the claim that made this invisible — is corrected.
- **`init` deleted the live run's gate markers and verifier output.** The gate-marker sweep in `evictWorkflowArtifacts` had no session gate at all and ran before the anchor was even read, so a mid-flight re-entry blanked `verification.{json,md}`, the dropped-symbols sidecar, and the markers — and the terminal verifier gate then blocked on a verifier that had in fact run. (`verification.{json,md}` sit in both eviction lists, so the anchored sweep below was dead code for them.) The discriminator is not age but whether a run is in flight: eviction now keys on the prior workflow's `active` flag. While a run is active, current-session writes survive; once it is closed, markers go unconditionally — being recent is no defence, since a stale marker satisfying the next workflow's gate is the failure that sweep exists to prevent. The two contracts are now named at the call site (`unless_in_flight` for markers, `stale_only` for canonical outputs) rather than implied by which loop a filename happens to sit in.
- **A prior workflow's impact map could satisfy a new workflow's gate.** `graph-impact.md` satisfies `assert-graphify-decision`, so it follows the marker contract for the same reason: freshness protects it only while a run is in flight, and a closed workflow's map is evicted so the next `context_init` rebuilds it.
- **An attested args override did not survive plan regeneration.** Regenerating `graphify-impact-plan.json` dropped `args_overridden` plus the full attestation and restored the generated args the orchestrator had rejected. The gate that rejects an incomplete attestation only fires when `args_overridden === true`, so a wiped one passed clean while the impact map still cited an attestation that no longer existed. Before: the deviation record was unrecoverable and the defective args were silently re-armed. After: a same-tier override is carried forward whole (including an incomplete one, so the gate keeps its teeth) with the regenerated args recorded alongside; a tier change parks the attestation as `superseded_attestation` instead of dropping it.
- **The graphify decision was verified at context_init and never re-checked at dispatch.** The destruction happens between those two points, so the gate could not see it. Both review paths now re-run `assert-graphify-decision` immediately before dispatching. A deliberately skipped tier still passes via `graphify-skip-reason.txt`; only a decision that was recorded and then lost blocks.
- **Topic-symbol truncation ranked by topic score, not diff membership.** The 32-symbol cap filled with untouched siblings that merely share a file with a changed symbol while genuinely-changed production functions fell off the tail. Before: a review's args carried a bare `TypeVar` and 13 untouched DTOs, and five changed functions were truncated away. After: symbols appearing on changed lines are promoted before the cap bites, with the ordering recorded in `topic_symbols_diff_ranked`. The diff is only computed when the cap actually truncates. Safe for this budget only because the god-node structural signal reaches the map through post-MCP augmentation, which does not draw on it — recorded at the call site as a load-bearing invariant.
- **Lane outputs written under the lane id read as missing.** `review_file` is slugified from the scope string and truncates mid-word, so a hand-written dispatch prompt naturally names the lane by id; every lane then reported `file_exists:false` with the reviews sitting on disk beside the expected path — enough to fail every claim-check and trigger a full round of pointless re-dispatches. `review-lane-<ID>.md` is now accepted as an alias, with the registered path preserved in the output.
- **Empty-diff lanes claimed no read class.** A lane whose files are the blast radius rather than the change got `size_class: unknown`, whose own comment claimed it let the chunked-read strategy attach — dispatch attaches that strategy for `chunked`/`split` only, so a lane spanning thousands of unchanged lines went out with no read strategy and an `est_loc` a reviewer could only read as noise. Empty-diff lanes now classify by whole-file LOC, capped at `chunked` because that number predicts read effort and says nothing about change volume, and they receive a whole-file review method instead of being pointed at a 0-byte artifact and told "that diff IS the change under review". That method also states the files are the scope rather than a change set — the instruction an operator previously had to hand-write to stop a blast-radius lane reporting "no changes found". A lane with no usable git context still claims no class — there the diff is unknown, not empty.

### Changed

- **The graphify activity surface emits one readable line instead of two raw JSON blobs.** The surface exists so a reader can tell whether the integration ran or silently fell back to grep; echoing `mcp-stats` output verbatim technically carried the counts but required hand-parsing, and an operator recovered them with their own `awk` rather than read it. Now: `4 call(s), 0 error(s) — get_neighbors ×3, blast_radius ×1`. The zero case states which of its two causes it cannot distinguish.

## [0.231.0] - 2026-08-04

### Fixed

- **Three gates failed open.** Both reuse-analysis gates substituted `{"ok":true}` when their CLI crashed, so any exception silently green-lit the very step the gate exists to block; `/devt:next`'s stuck-detector substituted `{"stuck":false}`, making a broken detector indistinguishable from a healthy session. A default that says "everything is fine" is the one shape a failure handler must never take. The reuse gates now fail closed with a reason that names the failure; the detector reports the signal as unavailable rather than absent. K342 asserts no workflow reintroduces a success-shaped fallback.
- **The curation backlog could grow unbounded behind its own cooldown.** Readiness was `count >= threshold && cooldownOk`, so a project sat at 21 pending candidates — 4.2× the surfacing threshold — with the footer reading "cooldown blocked" and the layer staying empty, which in turn made every ADR-compliance check honestly-unchecked. A high-water escalation now speaks past the routine cooldown, carrying its **own** longer window (default 7d) rather than bypassing it: the footer runs at every workflow finalize, so an unconditional override would fire all session and earn exactly the ignore-reflex that makes a quiet failure worse. The escalated line states why it is speaking ("4.2× the surfacing threshold … still unpromoted while the routine reminder is in cooldown") so it reads as a threshold breach rather than a louder copy of the ordinary reminder. Tunable via `memory.candidates_high_water_multiplier` / `candidates_high_water_cooldown_hours`.
- **`/devt:next` and the finalize footer now share one readiness computation.** They derived it independently, so an escalation added to the footer alone would have left the `/devt:next` triage prompt — the only interactive path into curation — still suppressed by the cooldown the escalation exists to outlast. Inspecting status never consumes the escalation window; only the footer records that it spoke.

### Changed

- **`code-review.md` marks its single-dispatch tail as dead on the parallel branch.** After delegation both files are held at once and their `SHARED-STEP` pointers name the same target file with opposite `MODE` values, with nothing else in the text distinguishing the live set from the dead one — the point in the run where an orchestrator is already holding the most state. `code-review.context-detail.md`'s title also claimed a single owning step while one of its three sections is entered from a different step and hands control to another workflow entirely; both now say what they are.

## [0.230.0] - 2026-08-04

### Fixed

- **`PARTIAL` was offered by five agents and accepted by none of their schemas.** Every markdown-only artifact's owning agent (`debugger`, `architect`, `docs-writer`, `curator`, `researcher`) lists `PARTIAL` in its `output_format` status enum for budget-walled multi-section work, and `dev-workflow.complex` actively *routes* on architect `PARTIAL` to SendMessage-resume — but `ARTIFACT_SCHEMA` omitted it, so an agent following its own contract wrote an artifact the reader flagged `invalid_status`. The JSON sidecar schemas already carried it; only the markdown-only artifacts had drifted. K341 now asserts the two sides agree by *comparison* rather than pinning a literal, so the next enum edit on either side has to keep them in step.
- **A `code_review` workflow scored an artifact it never writes.** `architect` was the one phase the artifact-scoping cluster never special-cased, so a week-old `arch-review.md` left by an unrelated arch run emitted a consistency warning on every single `state update` of a review. The scoping is now declared as data (`PHASE_OWNER_TYPES` / `PHASE_EXCLUDED_TYPES`) instead of a fifth `if (workflow_type !== X) delete …` branch — the accretion was itself the reason `architect` got missed.
- **The arch-health report overwrote a conforming artifact with a status-less one.** `arch-review.md` has two writers: the architect agent, which emits `## Status`, and the report step, whose own schema had no status section at all — only "Overall assessment (healthy / needs attention / at risk)". The report step now requires a contract-conforming `## Status` header and says explicitly that it is the routing field, not the health judgement (a scan that completes is `DONE` even when it reports "at risk"). This is a delayed-detonation class: the corruption never fails the run that causes it, only the next workflow to touch the file.
- **`read-sidecar` hoists every field a gate routes on**, not the three that were reported first. `criteria_total` read `null` at the top level while the walk-all-axes gate read it from the raw file and passed — same file, two answers. `criteria_met` and `lane_scores_null_reason` are mirrored alongside it rather than waiting for the next report.

## [0.229.0] - 2026-08-04

### Fixed

- **The deterministic severity recount was blind to the format reviewers actually use.** `lane-severity-tally` matched only bracketed severity headings (`### [Critical]`) — the shape a secondary report template shows — while the reviewer agent's *documented default* is axes-shape: findings are markdown table rows carrying an id like `B-1`, with severity either in a Severity column or implied by the enclosing `### Important` section. A field run therefore tallied `{0,0,0,0}` against 16 real findings. The reviewers were on-contract; the parser was the outlier. It now reads all four shapes reviewers legitimately emit — section-implied table rows, Severity-column table rows, consolidated `#### I-N` headings with `M-N` rows, and the legacy bracket headings — while deliberately *not* counting rows that merely reference a finding declared elsewhere (the id must be the row's first cell, so disposition tables don't double-count).
- **The consolidated side shared the same bug.** `partition_lanes`' comparison grepped bracketed headings against `review.md`, so both sides could read zero and the check compared nothing to nothing — and any consolidated count above zero against a blind lane total would have fired the "consolidator invented findings — STOP" branch spuriously. Both sides now route through one parser, exposed as `state lane-severity-tally --file=<path>`.

Guarded by K340, whose fixtures are the reviewer's real output shapes rather than the parser's own format — a fixture written in the format the parser already matched would have stayed green while the field stayed red, which is exactly how this shipped.

## [0.228.0] - 2026-08-04

The companion to the partition batch, and the half the field report ranked higher: when the impact map went missing mid-run, the envelope asserted a cause it could not know, and the detector built to catch exactly that certified the result healthy. A recoverable absence was converted into a confident false statement — and that is what kept the underlying bug invisible for a whole run.

### Fixed

- **The absent-map notice no longer invents a cause.** With the map gone the envelope told every lane "graphify did not run for this workflow; investigate with grep" — while graphify had run a symbol-anchored `blast_radius` over 32 symbols plus three drill-downs. Five reviewers were told the opposite of what happened *and* told to stop looking. The impact plan survives eviction by design, so a plan carrying a real tier beside a missing map is unambiguous: the notice now reports that graphify **did** run and the artifact was lost, names the tier, and tells the reader to treat blast-radius as missing rather than absent-by-design. With no plan on disk it says that instead of guessing, and a `tier: "skip"` plan still reads as absent-by-design. The `(no graph-impact.md available — ` prefix is preserved on every branch — a gate greps it and the health classifier keys off it.
- **`envelope_health` can now express a lost blast-radius map.** Status was a bare count (`populated >= 3`), and with `scope_hint` routinely absent the practical denominator was 4 — so an empty `graph_impact` alone could *never* reach degraded. A lane dispatched with zero blast-radius context reported `healthy`. It now escalates to `degraded` when `graph_impact` is empty under a graph-anchored tier, modelled on the per-block `rubric_path` escalation added after an identical incident. A `skip` tier stays healthy: absent-by-design is not a loss.
- **Eviction is session-anchored.** `review-context-init` evicted graphify artifacts unconditionally, including on the same-run re-anchor that fires after the scope artifact is pre-written — which changes `scope_sig`, defeats the freshness short-circuit, and so deleted the `graph-impact.md` the run's own impact step had just built. The eviction now passes the session age as its age gate, preserving same-session artifacts while still clearing a prior session's stale map. Fail-safe: an unparseable session anchor keeps the previous unconditional behavior rather than silently preserving stale state.
- **Deleting files is reported.** `evict-graphify` computed a full `evicted[]` / `skipped[]` record and threw it away, so an orchestrator had no way to observe that its own context-init had removed the impact map. The bundle now carries `graphify_evicted`.
- **The note contradicting the block is gone.** `<graph_impact_note>` described "the above" as inlined MCP output even when the block held an absence notice. The programmer and debugger variants already carried a fallback clause; the three **reviewer** variants — including the one in the field envelope — did not, a copy-paste drift across 12 emit sites. All 12 now instruct the reader to treat an absence notice as a report about missing context, act on its stated cause, and say so in their output.

Guarded by K339 (six legs, including that the load-bearing prefix survives on every branch).

## [0.227.0] - 2026-08-04

Community lane partitioning, which a field run reported as quietly unavailable, was disabled by four stacked defects. Each was reproduced against the reporting project's real 1,137-node Leiden graph before the fix, and the same scope now partitions into five balanced lanes instead of falling back to a path-based grab-bag.

### Fixed

- **A credential-safety refusal aborted the whole call.** The denylist guarding graphify's four path-taking subcommands refused the entire invocation when *any* input matched, so one checked-in `.env.example` in a 48-file review scope permanently disabled community partitioning for that repo — every run, with no operator-visible cause. These subcommands match path *strings* against a locally-loaded `graph.json`; they never read file contents and never leave the process, so a flagged path is now dropped from the input and named in `refused_sensitive[]` while the rest of the batch proceeds. Exit 2 is reserved for "nothing usable survived". Converges on the per-file `refused_sensitive[]` semantics `static-compress` already shipped. New `graphify.sensitive_allow` config (unioned with `--allow`) so a project can mark a known-safe basename once instead of every caller hardcoding a flag.
- **Coverage and grouping were keyed by basename.** Any two diff files sharing a name — `__init__.py`, `index.ts`, `mod.rs`, `conftest.py` — collapsed into one entry, so a multi-package diff under-reported its coverage *and* force-merged unrelated files into a single community, corrupting the skew numerator and denominator at once. Keying is now the diff path, with basename retained only as the lookup index and same-name candidates disambiguated by path suffix. On the field scope this moved coverage from 71% to 97.9%.
- **Consolidation manufactured the skew the guard then rejected.** Merging leftover communities by path-similarity alone let one anchor absorb without limit: a diff whose *raw* community skew was 11% consolidated into a single 24-file lane at 51%, and the whole partition was discarded. The merge is now capped at each anchor's fair share, with similarity still choosing the home among under-capacity anchors and the cap lifting if every anchor fills.
- **The skew guard flagged partitions no shape could improve.** Two files in two communities are 50% "skewed" while perfectly balanced. The guard now computes the smallest achievable max-share for the partition's shape and stays silent when the threshold is unreachable — and it runs at full coverage too, instead of only when some file lacked graph nodes. Its denominator and reason string now describe the same population they measure (largest lane over total scope); the arithmetic was self-consistent, the label was not. Threshold is config-overridable via `graphify.lane_skew_threshold`.
- **The workflow converted a safety refusal into a false capability claim.** `lane-suggestions` was invoked with `2>/dev/null || echo '{"mode":"fallback"}'`, so a non-zero exit — including the refusal above, which names its own bypass flag — became a reason-less fallback that the next line labelled as graphify being switched off. On a project with graphify enabled and a fully-clustered graph, that sent the operator to the wrong subsystem. stderr and the exit code are now captured into the fallback reason, the no-reason default names itself as unknown rather than asserting a cause, and the degradation is **persisted** to `.devt/state/partition-degraded.txt` (scope-bound, evicted on soft reset) so lanes, the consolidator, and gates can see it — transcript echoes scroll past under a long orchestration and reach no downstream agent.

Guarded by K338 (four legs) and a restated K76, which now asserts the stronger per-file property: a mixed input proceeds *and* names what it dropped.

## [0.226.0] - 2026-07-31

A deep `/simplify` pass over the last ten commits — four behavior-preserving cleanups, plus the one behavior fix that pass surfaced: `state reactivate` was resurrecting abandoned workflows across sessions.

### Fixed

- **`state reactivate` is now recency-bounded.** SubagentStart cleared the stop stamp on *any* stop-stamped workflow whenever *any* subagent started — with no recency check — so an abandoned, never-finalized workflow could be silently flipped back to `active=true` by unrelated agent activity in a later session (a `/graphify update`, an Explore pass), re-lying "active" to `/devt:status` and `/devt:next`. This is the same false-positive class the F.14 lane guard scopes out. `reactivate` now clears the stamp only when it falls within the 30-min `_ACTIVE_SUBAGENT_FRESH_MS` window (fail-safe: an unparseable stamp is treated as stale), preserving the intended ~2.5-min SendMessage resume while refusing cross-session resurrection. `subagent-status.sh` additionally gates the reactivate process behind a bare `grep` for a real on-disk stamp, so the heaviest spawn on the hot SubagentStart path (loading the whole state module graph) no longer fires just to no-op on the common no-stamp start. K332 gains stale-stamp negatives so the bound is red-capable in-gate.

### Changed

- **Internal cleanup, no behavior change (each probed behavior-equivalent before landing).** Deduplicated the token-overlap similarity in `discovery.cjs` into shared `tokenize` + `overlapRatio` + `DUP_OVERLAP_BAR` (previously inlined 4× with the `≥0.6` bar copy-pasted between `findDuplicate` and `ledgerMatch` — the "one similarity definition across the layer" the comment claimed is now literally shared). Extracted `sumWholeFileLoc` in `state-lanes.cjs` (two byte-identical whole-file LOC loops in `registerLane`). Removed dead code from the `check-workflow-shell-state` linter (a first `usedIn` predicate that structurally never fires — verified identical across a 16-sample sweep — and a no-op `for`-variable ternary). Corrected the W016 comment in `health.cjs`, which named a `config.template` field that is never written and claimed "current-template only" while the code matches against every shipped template.

## [0.225.0] - 2026-07-31

The F.14 follow-up promised (and deliberately deferred) in v0.224.0 — now designed and shipped as a regression test.

### Fixed

- **F.14 — `lane_state_guard` no longer false-blocks on unrelated subagents.** A `/graphify update` subagent, registered `"running"` in `status.json`, blocked a review `state reset-soft` for the full 30-minute freshness window (proef field case). The guard exists to stop a *lane* subagent from rotating orchestrator-owned `workflow.yaml` / `workflow_id` mid-fan-out — but that corruption can only occur while lanes are registered (`lanes[]` is written *before* lane subagents dispatch). Firing on *any* running subagent therefore stalled the operator on a false positive whenever an unrelated agent (a graphify refresh, an Explore pass) happened to be live. `_guardConcurrentRotation` now scopes the block: it skips only when `lanes[]` is **provably** empty, and remains fail-closed — a read failure still blocks, so the parallel-review protection is intact. Behavior: no registered lanes + running subagent → the operation proceeds; lanes registered + running subagent → still blocked. Guarded by replay-harness Case 5 (mutation-verified) and K195's block-path fixtures, which now register a lane so they exercise the block under the corrected scoping.

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

