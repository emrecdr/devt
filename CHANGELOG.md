# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/). The `[Unreleased]` section below stages changes for the next version — when bumping, rename it to `## [X.Y.Z] - YYYY-MM-DD` so the release workflow's changelog extractor (`scripts/extract-changelog.sh`) can find it.

Older releases (v0.1.0–v0.208.0) are rotated into `docs/archive/CHANGELOG-historical.md` — the root file keeps `[Unreleased]` plus the most recent releases (rotation ceiling enforced by smoke gate K288).

## [Unreleased]

### A field evaluation's five real findings — and the three that did not survive verification

A calibration run on a downstream project graded a five-lane parallel review and filed eight numbered findings. Each was checked against the code and against that run's own artifacts before anything was built; the two it ranked highest turned out to be a no-op and a hook devt does not ship, while its lowest-ranked item was the root cause of both.

**A declared cross-cutting lane is now a first-class concept.** A lens lane — plan compliance, changelog agreement, contract audit — reads files the logic lanes own, on purpose. Registration answered that with `N file(s) assigned to multiple lanes; lanes are expected to be disjoint`, correct for an accidental double-assignment and wrong for a declared one, and the warning is the only signal separating the two. `lens: true` (or `disjoint: false`) now marks the lane: only lanes that claim a file's *logic* count toward the disjointness warning, and the lane's envelope gains a `<lane_lens>` block. The envelope half mattered more than the suppression — `<lane_neighbors>` tells every lane that another lane's files are THEIRS, which for a lens lane forbids precisely the work it exists to do, so that block now states the ownership rule in terms of logic rather than files. The operator had been writing that paragraph by hand every run.

The flag had to be taught to three separate parsers to survive one hop each: the partition-file reader (its own minimal YAML parser, which names five keys and silently drops the rest), the registry writer, and `listLaneOutputs`'s line-based read-back. Two of the three were found only because the first end-to-end test rendered an envelope with no `<lane_lens>` in it despite `lens: true` sitting in `workflow.yaml` — a consumer added without checking the producer could deliver, which is the same defect this batch exists to close. `lens` is emitted unconditionally as a boolean, like `stale`: a key present on some lanes and absent on others makes a reader's `.lens` indistinguishable between "not a lens" and "this field does not exist".

**Registration answers in the vocabulary it was asked in.** A partition file declares `scope:` and `files:`; the registry stores them as `community` and `file_count` and answered only in its own names. Reading `.scope` and `.files` off the response returned null for every lane and was reported from the field as `0 lanes registered / files=0` — registration had in fact succeeded completely. Both names are now returned, and `entry.community` is accepted on input, matching the dual-convention handling `repo_root`/`repoRoot` already had. This is also the real content of the evaluation's top-ranked finding: `list-lane-outputs` was reported as blind to its own artifacts, but re-running it against the very state that produced the report returns `file_exists: true` and a real byte count for all five lanes. The query had asked for `.present` and `.bytes`; the fields are `file_exists` and `file_size_bytes`. The prescribed fix — "stat the review_file path" — is what the function already does, including an id-form alias fallback.

**A thin drill-down is no longer assumed to be a fake one.** The substance gate demanded ≥200 bytes per drill-down section, exempting a truncation marker and an empty marker. Neither covers a section that is short because the *subgraph* is short — one real caller behind 32 filtered noise nodes — so accurately reporting a sparse neighborhood failed a gate built to catch fabrication. `compose-drilldowns` has been emitting `_(filtered: noise=N, …)_` from the query result all along and nothing read it; the gate now credits it. Reading that code turned up a second unread marker: the empty marker has a DI-factory-hint variant whose own text carries parentheses, so the pattern demanding a closing `)_` credited the bare form and failed the more informative one. Matched by prefix now. Padding that cites neither still counts as thin.

**Lane briefs name the corpus an existence claim has to rest on.** A deletion review lost time to local-history snapshots, coverage HTML, and type-checker caches — stale copies of the very files under review, which can appear to *disprove* a "no remaining readers" finding using the source the branch just deleted. Stated as a corpus rule rather than a path list, because the noise directories differ per project and "tracked" does not: `<search_discipline>` tells lanes to ground existence and absence claims in git-tracked content. Checked against the reporting project first — two of its three noise directories were already gitignored (so `rg` skips them); the one that actually bit was 84 MB of coverage HTML that is not.

**`--fresh` stops being persisted as scope text.** The flag is consumed at substep 0 and was then left in `$ARGUMENTS`, which substep 1 persists verbatim as `workflow.yaml::task` — so it reached the preflight topic query, the memory signal, and every later `taskChanged` comparison. `--range=` is deliberately left alone: the parallel path reads it back out of the persisted task. Gate **F66**.

### Validated non-issues from the same report (recorded so they are not re-fixed)

- **The graphify PreToolUse hook it asks devt to scope is not devt's.** It lives in the reporting project's own `.claude/settings.local.json` — two hand-rolled hooks emitting the `MANDATORY` text quoted in the report. devt ships no `Read|Glob` matcher and no graphify Bash hook; its only Bash hook is the safety guard.
- **The two rubric files being byte-identical is the configuration, not a copy step.** `code_review_parallel` pins `code_review.v2.md` deliberately — the verifier grades the consolidated artifact — and 18504 bytes is that file's size.
- **The raw-dispatch gate is not vacuous.** That run's own `gate-trace.jsonl` recorded `dispatch-warnings.jsonl absent — dispatch-hygiene-guard.sh last ran at <ts> in this window and recorded nothing`, with `evidence: guard_fired`. The report quotes the first clause and stops before the one that answers it.
- **Two of three "workarounds that should become defaults" already are.** Rotating `workflow_type` before lane registration is the shipped step order, and lane read-back chain-matches so an out-of-order lane still reads `current`; the scope artifact the parallel path skips is pre-written by `scope_check` under gate K313, with self-recovery if absent.

## [0.243.0] - 2026-08-13

### Four fixes in this release were themselves half-wired — a second review pass found them

Deep-pass review of the arc above, by four reviewers who did not share the author's assumption about how the code gets called. Every finding below is a defect the arc introduced while closing defects of exactly this shape.

**The lane score went to a file nobody opens.** `<lane_scoring>` named `review-lane-<lane_id>.json`; `review_file` is slugified from the lane's **scope**, and both the write trailer and the consolidator's reader derive the sidecar from that. So the fix for the all-null score column produced an all-null score column — by writing the score correctly into the wrong file. Both instructions now interpolate one shared name. The gate could not have caught it: it asserted the block *mentioned* `score_null_reason`, never which file it named, and its own fixture (scope `api`, id `L1`) was already rendering the mismatch and passing.

**A disabled guard counted as a live one.** The liveness check matched the trace line by substring, but the hook runner traces hooks it **skips** too — `enabled:false, reason:"disabled_by_profile_or_env"` — and those records carry the script name. So at the `minimal` profile, or with the guard in `DEVT_DISABLED_HOOKS`, every skip record read as a firing and a zero count reported `clean`. That is the vacuous pass this release closed, restored through the back door, in the exact configuration the failure message tells the reader to go check. Needle hits are now parsed and skips rejected.

**The unknown verdict still reached no operator.** Lifting `warn`/`evidence` into the phase-gate projection was half the delivery: every workflow's finalize-gates reader filters `select(.ok==false)`, so an advisory row was computed, projected, and printed by nothing. The three readers now echo `select(.warn==true)` as a non-blocking line. `unknowns[]` is also derived from the rows rather than accumulated beside them — the two encodings already disagreed for any gate returning `ok:false` **and** `warn:true`.

**The axis gate counted axes in a file the verifier never read.** It resolved the rubric from the plugin root alone, ignoring the documented project-local `.devt/rubrics/` override — and this release made that strictly worse by pointing the verifier at an in-project copy instead. On any project using the escape hatch, the gate stopped enforcing and said `gate does not apply`. It now reads the same materialized copy the verifier was given, falls back to the shared resolver, and reports an unreadable rubric as `unknown` rather than as a pass.

**Three more branches meant "evidence absent" and said "pass".** `warn` arrived as the vocabulary for a gate that passed only because it could not look, then got applied to one branch. The anchor-absent paths in the raw-dispatch, claim-check, and council-budget gates are a **larger** blind spot than the one it closed — with no window anchor those gates cannot count anything at all — and all three returned a hard pass. They warn now. The claim-checks *ledger*-absent branch deliberately does not: it fires on every workflow type that legitimately never dispatches an output-writer, where a warn is noise rather than signal.

**The verdict is announced by the producer, not re-derived by each reader.** Adding the advisory echo to three workflows left the review path — where every field receipt in this arc came from, and the only path where the dispatch-warnings gate is even registered — still discarding it. `assert-all` and `finalize-gates` now write the unknown set to stderr themselves, so the guarantee holds at call sites that do not exist yet.

**Axis H counted from a different window than the rubric told the reviewer to use.** The rubric says count from `first_created_at`, and names a CLI that does; the gate anchored on `created_at`. Re-routing to the parallel path rotates `created_at` mid-review while `first_created_at` stays frozen, so records the reviewer correctly counted fell outside the gate's window and the gate blocked on the honest read — the same failure F62 fixed at the syntax level, still open at the semantic one. Both now read the same stamp, with a legacy fallback for a `workflow.yaml` written before it existed.

**The lane was told to derive its score from a document that defines no score.** The rubric grades six axes pass/fail; the 0–100 scale lives in the reviewer's scoring guide (100 minus per-severity deductions), which every lane already carries. So the block asking for a "rubric-derived" score was asking each lane to invent a mapping — manufacturing exactly the incomparable number its own next sentence forbids, and diverging silently from the single-dispatch scores the consolidated distribution invites the reader to compare against. It now names the real producer, and the null condition is keyed to completing the review rather than to reading the rubric, which a lane can fail independently.

**Eleven more branches passed without looking.** `assert-preflight-fresh` reported three distinct I/O failures as passes; `assert-claude-mem-harvest` and the scope-check gate passed on absent markers written by the very step they audit. All now warn. The claim-check and council *ledger* branches are deliberately left: fixing them properly means generalizing the hardened trace scanner to `gate-trace.jsonl`, which is its own change.

**Two graphify honesty fixes were undone by ordering.** The dropped-symbol list is reconciled against the locally generated args, and an attested override replaces `plan.args` forty lines later — restoring the reported defect exactly, where a reviewer finds the same symbol in both the submitted set and the dropped list. Reconciliation now runs after the override and against the args that shipped. And on the tiers that submit no symbols at all, "dropped and not submitted" implied a selective submission that never happened; that case now says so.

**The context-init cache key went blind on uncommitted work.** `contextInitScopeSig` was the third `base...HEAD` instance in this module — the two others were fixed, the one gating the cache was not. On an uncommitted branch the file list came back empty and the key degraded to HEAD-only, so every working-tree edit produced the same signature and the short-circuit re-served a stale brief for the whole phase. It now hashes the shared range- and untracked-aware collector, minus `.devt/` — devt rewrites its own state continuously during the run this key is caching, and a signature that moves under its own workflow never hits.

**Three findings the incremental pass left on the floor.** The raw-dispatch gate gathered its evidence before reading the config that can disable it, so a project running `dispatch_hygiene_mode: "off"` paid a full backward walk of the hook trace per gate run — worst-case, since a disabled guard never fires and the walk therefore runs to the window's end before concluding so. `materializeRubrics` returned a map both callers discarded, and re-read the shared source once per aliased workflow_type; it now caches the body and each type still gets its own dest, so a project overriding one alias gets what it configured. And F64's reconciliation check was tautological — the generated args are disjoint from the tail by construction, which is why it passed while both of the honesty regressions above went in. It now drives the attested-override path and the no-symbols-submitted lede, and fails on each.

**The resolution order is single-sourced for real.** Three copies of "absolute → project-local → plugin default" existed, in a function whose own comment warned that two copies is how the pinned rubric and the inlined one come to disagree. `grader.cjs` owns it now; `init.cjs`'s copy is deleted and both its callers go through the owner, which differ only in whether an absent plugin candidate comes back as a path or a null — now a parameter rather than a fork. F63 gained the project-override leg it never had, which is the only path where the copies could disagree, and K292's residue check was widened from the `<rubric_path>` tag to the prose around it: naming *which* rubric is pinned stays legal, claiming an agent *reads* it from the plugin root does not. That check now fails on both copies it previously walked past.

**Also.** `code_review_parallel` now points at its own materialized rubric, so `<rubric_path>` is `.devt/state/rubric-<workflow_type>.md` with no exceptions — a project overriding that key was getting the single reviewer's rubric. The liveness scan stops at the first firing instead of counting every one to answer a boolean, which gives it the right cost curve rather than a flat saving: on this repo's 1.26 MB trace a live guard is answered from one 64 KB chunk in 0.17 ms, and only the case that is about to warn anyway — a guard that never fired in the window — still walks it all (768 KB, 1.8 ms). `branchDiffText` honours the active range its sibling file-collector already honoured, and falls through only on git failure rather than on an empty diff, which cost a clean tree three forks to rediscover the same emptiness. The recovered-symbol count and the graph-filter status are rendered where a reader will see them, rather than only in a JSON field whose sole consumer was the gate asserting it. `task_written` is gone — no reader, and hardcoded `true` at one of its two sites. `_workflowWindowAnchorMs` absorbed a fourth copy via a `field` parameter, and two prose copies still naming `references/rubrics/` were corrected.

### A corrected review scope survives a cache hit, and `init` stops eating the task

Field: an operator passed a 1.6KB `--scope` and read back the literal `code review`. Two independent writers produced that, and they had been repairing each other on the common path — which is why nothing ever caught it.

`init review` with no task argument wrote its `code review` placeholder **unconditionally**. Every context-init bundle runs `init` at the top purely for its payload, so the real task was destroyed on the way past. On the recompute path the later activation write happened to restore it; on the cached path nothing rewrites it afterwards, so the damage stood. `init` now preserves an existing task when the caller supplies none and still honours an explicit one — same fix for `init workflow`, which nulled it instead.

The freshness short-circuit returned **above** the activation write, so re-running with corrected scope text re-served the stale task indefinitely and the only exit was `state update task=` by hand. The short-circuit now persists a supplied scope. The cache key stays the changed-file set: caching the expensive computation is right, caching the task text is not.

That same early return carried no `scope_missing` and hardcoded `degraded_fields` to `[]`, so the degrade signal existed only on the path the operator was **not** on — and the CLI's own hint steers you onto the path without it. Both fields are real on both paths now, and an empty scope never overwrites a task an earlier call got right.

`--fresh` was recommended by the short-circuit's own stderr hint and parsed by nothing; `review-context-init` accepted three flags and silently discarded it. It now bypasses the cache, as the hint always claimed. The message also names what the cache key is derived from and whether `task` was written this call — the two facts that cost the reporter three re-runs to establish by reading `workflow.yaml` directly (**F61**).

### The truncation notice reports what was actually withheld

`args.symbols` for the `symbol_anchored` tier is a **union** — the diff-symbol extractor's output merged with the exact-resolved topic anchors — while `topic-symbols-dropped.json` was the tail of the *topic* list alone. Two different lists. A symbol cut from the topic tail could therefore be submitted anyway through the diff leg, and the notice reported it as absent.

Field: a reviewer compared `args.symbols` against the dropped list, found two names in **both**, and reasonably concluded the artifact was lying about its own truncation. A lane's truncation claim built on that notice was then half-wrong, and the verifier adjudicating it had to work out which half. The list was never internally inconsistent — it was answering a question nobody asked it.

The notice is now reconciled against what actually went to the MCP call: only symbols no leg submitted are listed, and the ones recovered via the diff leg are **counted rather than absorbed**, so the reduction is visible.

Three adjacent honesty fixes in the same path. The section claimed its contents were "listed in original preflight ranking order", which stopped being true the moment diff-ranking shipped — it now states the ordering it actually used, read from the plan rather than assumed, and says nothing when the plan doesn't say. `branchDiffText` diffed `base...HEAD` only, so symbol ranking and the hunk census both silently no-opped on uncommitted work — the same empty-`base...HEAD` hole `collectChangedFiles` was already fixed for, whose comment says exactly that; it now falls back to the working tree (fallback, not union, because a change both committed and further modified would otherwise count twice and the census reads these hunks too). And the graph-node filter — the only thing that removes plausible-looking non-symbols the shape gate and verb denylist both pass, like `Verify`, `Modern`, or a project name — sat behind a catch-all that made "found nothing to remove" and "never ran" identical; `preflight-brief.json::topic.symbol_graph_filter` now says which (**F64**).

### The rubric is reachable from where the reviewer actually runs

`<rubric_path>` pointed at the plugin root — **outside the project under review**. A lane declined to open it: *"outside this repo and was not opened"*, a policy refusal rather than a filesystem error, which no path fix inside the plugin can reach. Making the path absolute was the earlier attempt at this and was not enough; the requirement is the project boundary, not the path shape.

Field: of five lanes on one review, two read the rubric fully, one partially, one refused, one never said. The ones that could not reach it self-graded against the task prose, so their grades were not comparable with the rest — and nothing noticed, because a silent self-grade looks exactly like a real one.

`init` **and every dispatch render** now materialize the resolved rubric to `.devt/state/rubric-<workflow_type>.md` (project-local `.devt/rubrics/` override honoured, else the plugin default) and every `<rubric_path>` resolves there — both, because the documented `register-lanes` shortcut reaches `render-*` without a fresh `init`, and one producer for a two-path consumer is the same half-wiring this release is about — the same place agents already read `code-review-input.md` from. For both init verbs, since dev workflows never inline the rubric and the verifier's `<rubric_path>` is the only copy it sees. An unreachable rubric must now be **declared**: say so and state the grades are not rubric-derived, rather than self-grading in silence. The resolution order is single-sourced, because two copies of a resolution order is how the pinned rubric and the inlined one come to disagree.

### Lanes are asked for the score the consolidated report already prints

The parallel report's headline carries a per-lane score distribution; the lane envelope never requested a score. Every run therefore produced an all-null column that read as a broken feature — a consumer specified with no producer.

Lanes now emit a rubric-derived `score` in their own sidecar, **with the condition attached**: a lane that could not read the rubric emits `null` plus a `score_null_reason` instead. A manufactured score is worse than a null because it looks comparable with the lanes that could read it, and the distribution is read as a coverage signal first — one null beside three real scores says immediately which lane's grade cannot be trusted. The consolidator copies both through rather than filling the gap with a number of its own.

### The change set finally includes files git cannot diff

`git diff` cannot show untracked files at all. So every consumer reading diff **text** — symbol ranking, the hunk census — was blind to a branch whose centrepiece is a NEW module, while the truncation notice asserted the ordering it had derived from exactly that blind diff. The file-list collector had been fixed for the empty-committed-range hole twice; the diff-text path was the third private notion of "the change under review" in one module, and the one nothing had touched.

`changeSetText` now lives beside `collectChangedFiles`, in the module that owns change-set semantics, and `branchDiffText` delegates to it. Untracked files are surfaced by staging them intent-to-add into a **scratch** index via `GIT_INDEX_FILE` — one diff covering modified, committed and new files together, at a constant three forks however many new files there are, and the caller's `git status` provably unchanged. The alternative, one `git diff --no-index` per untracked file, forks per file and returns fragments the consumer has to stitch.

Both collectors also stop reporting `.devt/state/` as a change. devt rewrites that layer **during** the run that inspects it — a plan written by `compute-impact-plan` fed straight back into the next call's census — and `--exclude-standard` only covers it where a project remembered to gitignore it. `.devt/rules/` and `.devt/config.json` stay reviewable; they are author-maintained. The one-off filter added to `contextInitScopeSig` earlier in this release folds into that shared predicate.

Two gates were measuring the wrong thing and said so once the diff could see. K227/K228 share a fixture whose "cosmetic-heavy" ratio held only because the one real-code addition in it was invisible — the fixture gained genuine cosmetic hunks so the scenario it claims to test is the scenario it produces. And F64 wrote its probe script **into** the project it analyses, so the probe became part of that project's own change set; it now lives outside the fixture (**F65**).

### The lane-skip policy is read out of the rubric instead of asserted beside it

The injected `<lane_axis_policy>` block named axis H against a document it never opened. That is correct for the shipped default — and the default rubric **already carries the exemption**, so the block was a second copy of something the rubric says itself. Where it is not a copy, it is wrong: `code_review.v1.md` is still shipped and still pinnable, carries no exemption, and requires the axis unconditionally, so a v1-pinned project was handing every lane an instruction to skip an axis its own rubric mandates. A project-local rubric that renames or reorders axes fails the same way.

`render-lanes` now parses the in-project rubric copy the lanes are pointed at, attributes each lane-skip marker to the axis block containing it, and emits the policy naming those axes with the titles the rubric gives them — or emits nothing at all when the rubric exempts none, which is the honest default. The by-reference stub already said "**any** `<lane_axis_policy>` block", so absence degrades without a second edit. The gate moved with it: F63 computes its expectation from the pinned rubric rather than matching a fixed string, and a v1 pin must produce no block.

### Axis H is asked once

Marking the axis lane-skip in the rubric did not land: the shared envelope still told every reviewer to walk it, and the envelope won **4 of 5 lanes** in the field because it sits closer to the task. The rubric, the envelope task text, and the by-reference stub now all defer to a `<lane_axis_policy>` block that `render-lanes` injects into lane dispatches only — so the single reviewer, who genuinely owns the axis, is unaffected. Fixing one end of a two-ended contract and reporting it closed is what produced the 4–1 (**F63**).

### Two gates stop reporting on mechanisms they never consulted

**Axis H punished explanation.** Its `n/a` branch was disqualified by a bare substring test for `counts:` across the whole section, so a consolidator explaining *why* zeros would mislead failed on its own explanation while a terser answer passed — and the failure message claimed the section lacked a valid `n/a` while one sat in it, sending the reader to look for a formatting fault in the line that was already correct. The branch is now chosen by what **parses**, not by which tokens appear, and the failure names what was actually found. Field consequence worth recording: the retry hid the reasoning and shipped three zeros that read as "verified clean" when the honest claim was "nothing was recorded" — the gate rejected the better answer and accepted the misleading one.

**The raw-dispatch gate passed vacuously.** The hygiene guard appends only on a violation, so a violation-free ledger and a guard that never ran produce the same silence — and the gate reported the first. The universal hook trace already records every invocation, so the evidence existed and nothing read it. A zero count now reads `clean` only with an in-window guard firing behind it, `unknown` otherwise (advisory, never blocking), with `guard_fired` and `evidence` on the result. Firings are window-scoped, so a pre-anchor fire or a different hook is not mistaken for evidence (**F62**).

## [0.242.2] - 2026-08-11

### A hinted path now says whether the branch touched it

Every `suggested_reading` entry arrives through the same channel — a governing doc's affects glob — so a file **in the change set** and one merely governed by the same ADR were indistinguishable to the reader. Field: three hinted files behaved three different ways (one changed, one the remediation site for an Important finding, one neither), and two lanes spent prose explaining that a hinted file was out of scope.

`preflight-brief.json::scope_hint_provenance` now classes each entry `in_diff` / `governed_only` / `wiki` / `unknown`, and the reviewer contract says what to do with each — notably that a `governed_only` path is often exactly where a fix belongs even though it is not under review, so it belongs in remediation rather than as a finding site. `unknown` is emitted when no diff range is available rather than defaulting to `governed_only`, which would assert a distinction that was never computed.

Kept as a **sibling map** rather than richer `scope_hint` entries: four agent contracts document `scope_hint` as "a JSON array of file paths", and breaking that shape to annotate it costs more than the annotation is worth (**F60**).

### The state parser survives a hand-edited workflow.yaml

Two silent data-loss paths, both reproduced by direct execution. A **blank line between lane items** ended the lanes block — blank lines are not two-space indented — so every later lane was dropped and its fields leaked into the top-level state namespace beside `phase` and `tier`. A **bare `key:` heading an indented block** matched no value regex, so its children were promoted to top level while the parent vanished, inventing state keys out of someone else's nesting.

devt's own serializer emits neither shape, which is why this never fired on the normal write path — and also why it matters: both arrive via a hand-edited `workflow.yaml`, which is exactly when silently invented keys are hardest to notice. Blank lines between list items are idiomatic YAML besides. **F58** pins both, plus the controls that must not move: a de-indent still bounds the block, the round-trip is unchanged, and `_json` keys still promote while free text does not.

### Governance hits say how specifically they matched

A doc claiming `.devt/**` matches every file under `.devt` and reads, to a consumer, exactly like a doc that named the file — so an ADR-compliance section gets written about a concept with nothing to do with the change. Field: CON-002 (graphify review tiers) surfaced on `.devt/rules/api-changelog.md` purely on the wildcard. `memory affects` matches now carry `match_breadth` — `exact`, `narrow`, or `broad`. Reported, never filtered: a broad claim can still be the right one, and dropping it silently would be the worse failure (**F59**).

### The provenance protocol promised args and responses it never logs

`<provenance_protocol>` told agents that `mcp-stats --correlation-id=<id>` "resolves the call back to its **args + response**". It does not — the trace records `args_fp` (a fingerprint) and `args_size`, and devt deliberately never logs args or results. An auditor following that instruction got metadata and reasonably concluded the mechanism was broken. It now states what actually comes back (tool, timestamp, duration, ok/error, args fingerprint), names the trace path, and names the result shape — `{aggregate, tools[], entries_considered}` — because a jq selector that misses returns `null`, which is indistinguishable from a broken feature.

The reported failure itself was **refuted**: `mcp-stats --correlation-id=1db6d7a0` resolves against the field trace (1 entry, timestamps), `--include-chain` returns 288 calls with a populated `tools` array, and `_meta.correlation_id` is emitted on both the MCP and CLI paths. The nulls came from querying `by_tool`, a key that does not exist — the same class of error that produced two bad gates in this batch before being caught.

### The scratchpad's documented reset is now real

`skills/scratchpad/SKILL.md` says *"Ephemeral: do not treat the scratchpad as permanent storage — it resets between workflows"*, and `reset-soft` left it untouched — so it accumulated across every workflow a project ever ran. Field: **80 KB, 345 lines, 143 `#KNOWLEDGE-CANDIDATE` tags** spanning domains absent from the diff, and it grew during the run that reported it. Four entries explicitly invalidate earlier ones ("CORRECTS the stale line-9 candidate", "is FALSE", "must NOT be promoted to memory") — and the curator promotes from that pile, so the memory layer's entire premise, that it is trustworthy, was being fed known-refuted claims.

`reset-soft` now rotates it to `.devt/state/.archive/scratchpad-<workflow_id>.md`. **Archived, never deleted** — the candidates are real work and stay harvestable, keyed by the workflow that produced them so provenance survives the rotation. Fixing an accumulation bug by deleting the pile would have traded one silent loss for another. The skill text now describes what actually happens (**F57**).

### Inline rubric cap raised to 48 KB

The shipped trio had reached ~32.6 KB against a 32 KB ceiling, and correct rubric content was being trimmed to fit — twice in one release. The cap was shaped when the corpus was smaller and inlining was the default; rubric-by-reference is the default now, so it bounds the `--inline-rules` worktree path rather than the common one. Breaching it is loud at both call sites, which was the actual fix: over the cap, every dispatch loses its inline rubric and lanes self-grade ad hoc against one they never received.


## [0.242.1] - 2026-08-11

### First receipt on v0.242.0 — two of these were my own regressions

**The envelope digest never matched the file it named.** Both render paths hashed the pre-write buffer while the writer appended a trailing newline, so the advertised `sha256` was wrong on *every* render, deterministically. Dormant for as long as nothing compared it — and v0.242.0 shipped `dispatch verify-envelope`, which turned a wrong number into a confident false alarm telling a lane its untouched envelope had been tampered with. Making a false guarantee actionable without first checking the guarantee was true is the same defect class the release was closing. Both paths now hash the bytes written (**F48**, verified falsifiable).

**`criteria_total` said 7 in the verifier envelope while the rubric said 8.** Axis I took the code-review rubric to 8 axes; the envelope prose and a copy-paste `jq` recipe still said 7. `assert-verifier-graded-all-axes` counts from the *rubric*, so a verifier obediently following its envelope declares 7 and fails the gate on a **correct** verification. The field run survived only because the verifier read the rubric, caught the contradiction and overrode its own envelope — a more compliant agent would have failed. Both sites now instruct counting from the loaded rubric rather than quoting a number. (The first fix went into the compiled copy rather than the template; `compile --check` caught it, which is what the `EDIT-SOURCE` marker exists for.)

### Orchestrator-level axes are asked once, not once per lane

Axis H is a dispatch-time signal, and every lane self-grades every axis — so five lanes each wrote the same stale-by-construction paragraph that the consolidator then had to discard. Lanes are now excused from it explicitly. Its skip wording also let "ledger absent" and "ledger clean" render identically (`n/a — no incidents logged`), which is the silence-is-a-pass shape devt's own narrative-guard caveat exists to prevent: an absent `dispatch-warnings.jsonl` means the guard never wrote, and reporting that as zeros is indistinguishable from a clean run. The two now read differently (**F56**).

**The inline-rubric fallback was silent on the path that matters.** Over the byte cap, `loadInlineRubrics` returns `content: null` and every dispatch loses its inline rubric — lanes then self-grade ad hoc against a rubric they never received. `init` propagated that warning; `dispatch` discarded it. It now announces. Rubric prose was trimmed to stay under the cap rather than raising it: at 149 bytes of headroom the corpus is close to the ceiling, and the *silence* was the defect, not the number.

### Telemetry stopped discarding three quarters of its own log

`gate-trace.jsonl` has four writers and only `persistGateTrace` emits a `gate` key — council, arch-scan and graphify-fallback identify themselves with `source`. The aggregator keyed on `gate` alone, so those three landed on disk and were skipped, including the records three skill files name as their measurement channel, while the aggregate read as complete. It now keys on `gate` **or** `source`, and reports `_unkeyed_records` rather than dropping silently.

`warn` also matched no branch: it incremented `count` while `pass + fail` quietly failed to sum to it, so a warn-heavy gate read as half-missing. Buckets now sum to count by construction (**F54**).

### The tester contract could not be satisfied

`tester.md` instructed the tester to answer `coverage_complete: false` for a categorically-untestable file and deferred to "the rubric's allow-list". `dev.v1.md` hard-requires `true`, `walkConstraints` implements scalars as strict equality, and **no allow-list exists anywhere**. A tester following its own contract short-circuited to a re-dispatch that reached the same answer — indefinitely.

Untestable files now ride `coverage_exempt: [{file, reason}]` and still count complete, so the boolean means "covered **or** explicitly exempted" rather than "every file has a test". `false` is reserved for a file that should have coverage and doesn't.

**The tester also had no way to signal a budget wall.** `PARTIAL` is in the sidecar enum and routed by `agent-resume.cjs`, and appeared **zero** times in `tester.md` — the agent most likely to exhaust its budget was the one never told the recovery value existed. Now declared in the status enum and explained, with the PARTIAL vs DONE_WITH_CONCERNS distinction stated (**F55**).

### State writers now resolve the same directory the readers do

`subagent-status.sh` wrote `status.json` to a bare `.devt/state`, and `dispatch` stamped `dispatch-stamps.jsonl` under `process.cwd()` — while both readers go through `getStateDir()`, which honours `DEVT_WORKFLOW_ID`. Under multi-instance mode the concurrent-rotation guard and `assert-consolidator-dispatched` each read an absent file and **passed**, disabling themselves in exactly the concurrent case they exist for. The `cwd` form also broke whenever `devt-tools` ran from a subdirectory. Four writers moved onto `getStateDir()`; the hook mirrors the same resolution in bash rather than paying a node spawn on each of its ~260 per-run invocations (**F53**).

**The unresolved-agent-name diagnostic now reaches disk.** Every `status.json` record in the field run is keyed `unknown` because the extractor looks for `agentName`/`name` and the harness payload carries neither — so per-agent status tracking has never worked. It now tries every plausible key and records the payload's top-level **key names** (never values) in `subagent-events.jsonl` when all miss. The first version of this wrote to stderr from inside a `2>/dev/null` command substitution, where it was produced and discarded in the same breath; the gate covers the durable path.

### The lane-block injection anchored on the wrong `</context>`

`cmdRenderLanes` injected its per-lane blocks at the **first** `</context>` via a forward regex, while every other injection in the file anchors on the **last** — the distinction the `envelope_health` site was explicitly written to get right, because inlined governing rules can mention the tag in prose. Both policies ran over the same string (`cmdRenderLanes` builds its base from `cmdRenderFilled`), so they disagreed by construction and stayed benign only because current envelopes contain exactly one `</context>`. Now consistent. Lane `bytes` also reported the pre-write length rather than what was written.

### Lane artifacts are content-pinned across synthesis

`assert-lanes-quiesced` checks lane *status*, and status is the wrong signal: a lane reaches `substance_pass` and can still be rewritten in place afterwards. Field run — the consolidator was dispatched at ~10:53 and lane artifacts were rewritten at 10:57, 11:02 and 11:11, one of them a 12-citation correction. `review.md` was synthesized from the pre-correction copies and shipped stale pointers, and two independent citation audits over "the same" artifact returned **non-overlapping** results because each writer believed it held the corrected version. That is a race on authority, and nothing in the pipeline could see it.

`state snapshot-lanes` records per-lane content hashes at consolidation entry; `state assert-lanes-unchanged` compares after the consolidator returns and names the lanes that moved. Advisory rather than blocking — the correct recovery is to reconcile the affected citations, not discard a review that is otherwise sound. An absent snapshot **warns**: "never recorded" and "recorded and stable" are different claims (**F51**).

### Symbol ranking is by diff centrality, not bare membership

Reported as "no relevance ranking against the diff" — and the field artifacts say otherwise: `topic_symbols_diff_ranked: true`, ranking on, and `ImpersonationResult` dropped anyway despite appearing **9 times** in that diff. The membership partition splits the pool in two, which does nothing once a branch touches more symbols than the 32 cap: the entire cap falls inside the members bucket, still ordered by upstream topic order. Diff members now sort by mention count, ties keeping upstream order, non-members untouched at the tail (**F52**).

The same report's identifier-validation half checked out as **low impact** rather than wrong: the six prose tokens (`Check`, `Consider`, `You`, `Double`, `Not`, `Python`) score 0–2 diff mentions, so they already ranked below every real member and displaced nothing. Worth filtering eventually; it was not what cost the central types their slots.

### Lane diffs now carry the source line numbers reviewers are graded on

Field-measured as the cause of every real defect in one run's output: **34 wrong `file:line` citations across five lanes.** The mechanism is the tool's, not the reviewer's — a lane is told the diff IS the change under review, the rubric then grades it on *source* `file:line`, and the only number in the buffer was the buffer's own position. The cleanest evidence: one lane scored **85/85 correct** on files read with a numbered tool and **0/18** on files read through `sed` — perfect correlation with the reading method.

Every diff line is now prefixed with its true source line number, parsed from each hunk's `@@ -a,b +c,d @@` header. Removed lines get no number, because they do not exist in the file anyone would open. The lane contract gained the other half: cite the annotated number with the repo-relative path from the `+++ b/<path>` header, and never cite a line read through a numberless view (`sed -n a,bp`, `head`, `tail`) — re-read with `Read` or `grep -n` first.

**The obvious gate was tested and rejected before shipping this.** A file-exists + EOF-bounds check over 89 field citations produced **zero** failures while 34 were wrong: a buffer position lands inside a long file and looks entirely plausible. So **F50** asserts the number is *right* against ground truth, and fails if the fixture's buffer position ever coincides with the source line — a gate that can pass on a degenerate fixture proves nothing. Annotation touches the artifact only; sizing and diffstat still compute from the raw diff.

### post-dispatch-check no longer recommends a destructive action against a live agent

Run against a still-executing consolidator it returned `action: redispatch` — an agent that writes its artifact at the *end* of a long synthesis is indistinguishable, by artifact presence alone, from one that returned without writing. Acting on it would have duplicated a five-artifact synthesis. It now returns `still_in_flight` when a subagent is live, and still emits `redispatch` when none is or the entry is stale (**F49**).

**The liveness probe had to be built around a defect to work at all.** Every `status.json` record in the field run is keyed `unknown`: `subagent-status.sh` looks for `agentName`/`name` and the harness payload carries neither, across 260 invocations with ~1.8 KB of input each. Per-agent status tracking has therefore never worked. A probe matching strictly on agent name would have passed review and done nothing in production, so it matches the placeholder too — coarse-but-live over precise-but-dead, sharpening automatically once names resolve. The extractor now tries every plausible key and, when all miss, logs the payload's top-level **key names** (never values — it is a hook payload) so the next run diagnoses the gap instead of recording `unknown` forever.

## [0.242.0] - 2026-08-11

### The reviewer never knew what it was asked

**The operator's task reached every agent except the one reviewing.** `workflow.yaml::task` was substituted into the programmer, researcher, verifier and architect envelopes via `{task_description}` — and into **none** of the code-reviewer templates. Every review devt has ever run answered the envelope's generic *"review the following files for quality, correctness, and standards compliance"* instead of the question the operator actually typed. Rendered from one state, the mandate appeared once in the programmer envelope and zero times in the reviewer's. The field workaround was hand-appending the mandate to all eight lane dispatches; the failure mode and the workaround are indistinguishable to every gate in the envelope path, which is how it survived this long.

`<operator_mandate>{task_description}</operator_mandate>` now ships in the four dispatch-carrying code-reviewer templates. A placeholder rather than a render-time injection, because devt has **two** delivery paths and only one of them runs the CLI: the canonical `/devt:review` dispatches from a compiled marker region in the workflow markdown, with placeholders filled by the orchestrator at dispatch time. An injection in the render path would have left that path — the dominant one — still unfixed. A placeholder is dispatch-invariant, so it survives `compile` and both paths get the mandate from one declaration. (`code-reviewer-fix.tmpl.md` is exempt: it is a SendMessage-resume structural-fix prompt with no `<context>`, and the reviewer already holds its prior dispatch context.)

It rides as its own block rather than interpolated into `<task>`: that body carries the rubric self-grade directive, the graph-impact consumption protocol and the knowledge-candidates step, and two voices in one block read as a contradiction wherever they differ in specificity. An empty task emits no block at all — "no mandate recorded" and "the operator asked for nothing" are different claims, and Axis I skips on absent rather than on empty.

**`dispatch run --task=` was destroying the envelope to deliver the task.** It replaced the entire `<task>` body, discarding the self-grade directive, the graph-impact protocol and the knowledge-candidates step — the envelope's whole contract, silently, on the one path built to carry an operator's words. `--task=` now overrides the task for that render, so it fills every placeholder the template declares and leaves `<task>` intact; templates with no task placeholder at all still get an injected block rather than swallowing the flag.

**No safety net existed.** The verifier *does* receive the operator's task as `<original_task>` — and no rubric axis covered it, so it was delivered to the one agent never told to check it. New **Axis I — Operator mandate coverage** grades whether the review answered the question, including the clauses that passed: a clause satisfied but never mentioned is indistinguishable from one skipped. It reads `<operator_mandate>` or `<original_task>`, whichever the dispatch carries, so it fires on both envelope shapes instead of self-skipping on the one it was written for. In synthesis mode it grades the consolidated document, because eight lanes answering a clause that consolidation then drops is the same outcome as never asking. `criteria_total` 7 → 8.

**Per-lane focus was unreachable from the documented path.** `cmdRenderLanes` always honored `focusByLane`, but only `run-lanes` passed it — so the pointer-stub form the parallel workflow documents as *the* dispatch shape could not carry per-lane emphasis. `render-lanes` now accepts `--lane-<id>-focus=`.

**`envelope_health` could not see the placeholders it exists to catch.** Its classifier matched `{token}` but not brace-wrapped prose, so `{injected from .devt/config.json if available}` and `{learning_context — …}` scored "populated" and the health block certified as healthy the very envelopes that shipped literal template syntax to their agents. Widened to catch any brace-wrapped non-JSON body. `operator_mandate` joins the monitored set but stays **out** of the healthy/degraded count — counting it would let a populated mandate lift an otherwise-degraded envelope over the bar, inverting the point of watching it.

### review.json had three specifications that shared zero fields

The sidecar schema declared `status`/`verdict`/`agent`; the consolidator envelope pinned `raw_lane_finding_counts`/`score`/`lane_scores`/`coverage`; `laneSeverityTally` read `severity_counts`/`findings`. No field appeared in all three. A consolidator emitting `consolidated_severity_counts` and `top_findings` was not misbehaving — given three specs that disagree, inventing names was the only behavior available to it, and the tally silently read `{0,0,0,0}` for a review carrying 75 findings.

`reader_fields` now declares what the readers require, the producer template pins every one of them, and a gate pairs the two so a reader gaining a dependency cannot leave the producer silent. `findings[]` is pinned as **complete, not a top-N** — the field model truncated to 5 of 75 because the surrounding language said "top findings".

**A zero that means "unknown" is the shape that survives field selection.** Unreadable `severity_counts` yielded four confident zeros with the warning sitting *beside* them, so a consumer running `jq '.consolidated'` — the obvious thing to do — got `{0,0,0,0}` and nothing saying it was fiction. Unknown now reads as `null` with the error *inside* the object.

**The narrative guard cried wolf on a correct review.** It substring-matched sidecar ids against `review.md`, so a sidecar writing `L3:I-1` beside prose writing `L3 I-1` reported 70 of 75 findings missing — a full-severity STOP earned by a separator, and a guard that does that trains operators to skip it. Matching is now alphanumeric-normalised, and the producer must anchor each finding's id verbatim in its own heading while inline references stay free-form (dropping the lane prefix inside a lane's own section is how models naturally write, and the guard should not fight it). The guard stays loud: it has yet to produce a true positive in the field, but the drop it exists to catch demonstrably happened while it was reporting `unavailable`.

### Verified wrong answers

**The stale-workflow check reported `acted=0` on a reset that had fired.** `code-review.md` captured `auto-reset-if-stale` with `2>&1` and parsed `tail -1`. stdout carries the JSON — always exactly one line, since `JSON.stringify` escapes newlines on the wire — but stderr carries the `[devt]` banner, which embeds the operator's task with **raw** newlines. Merging the two and taking the last line fed banner prose to `JSON.parse` whenever they interleaved. Reproduced once in ~30 attempts: a real race, not a deterministic bug. The adjacent staleness call six lines below already used `2>/dev/null` and parsed whole stdout; both now do.

**The post-implementation graph refresh had never fired.** `programmer.md` writes `files_changed` and every consumer reads it; only the graphify-refresh branch tested `files_modified`, a name no producer emits. Its condition was always false, so devt declined to refresh the graph it had just invalidated and handed the next workflow a degraded `scope_trust`. Gate **F46** pairs the field name across producer and branch.

**Free text that looked like JSON was type-punned into an object.** `parseSimpleYaml` promoted any `{…}`-shaped value, so an operator whose review scope opened with a brace got `task` back as an object — and every consumer renders it into prose. Promotion now keys off the `_json` suffix devt already uses to mark structured fields, rather than off the shape of the value.

**A newline in a lane field silently dropped every lane after it.** `serializeSimpleYaml` escaped newlines for top-level strings and not for lane fields, writing a raw line break into the middle of a quoted value; the reader then truncated it and lost the rest of `lanes[]`. Needs no LLM — just a multi-line scope description. Gate **F47** covers both round-trips.

**`register-lanes` derives `code-review-input.md` when it is absent.** The hand-rolled partition shortcut never runs `scope_check`, so nothing pre-wrote the artifact — while every lane envelope still says to read it and the verifier's axis A treats its absence as a failure. It is now a consequence of registering lanes. It also carries a cover check against the change set, reported as **numbers rather than an alarm**: a partition may scope to a subset deliberately and blast-radius lanes legitimately include unchanged files, so only an exact match is asserted and anything else is stated for the operator to judge.

### False guarantees

> A stated guarantee that does not hold is worse than a missing one, because it stops people from looking.

- **The pointer-stub sha256 was decorative.** Computed, persisted, advertised as "an integrity contract, not convention" — and compared nowhere. `dispatch verify-envelope <path> --sha256=<hash>` is the missing half; the prose now says the digest is an auditable anchor and names the command that checks it, instead of implying something already does.
- **The Context-Loaded contract claimed "the verifier checks that your reads cover the rules your findings depend on."** No rubric axis grades that section. The claim is gone; the requirement and its actual purpose remain.
- **`assertPreflightFresh` passed silently when the brief was missing.** It caught a stale brief and never an absent one, so green said nothing about whether preflight ran. Now warns — not blocks, since preflight is legitimately disabled on some projects.
- **`{models.code_reviewer}`** (underscore) in three example blocks resolved to nothing against the hyphenated key. Outside any marker region, which is why `compile --check` reported no drift.
- **`Unknown command:` now names the command families.** `Unknown state subcommand:` already lists its ~70 names, which turns a wrong guess into a self-correction in one round trip; the top-level path printed generic help. A field operator improvising `scratchpad aggregate` learned only that it was wrong, never that `state aggregate-knowledge-candidates` was what they wanted.

### Second field report, same release

greenfield re-ran against the in-flight build and reported two bugs. One was already fixed by the work above — their `envelope_health` observation predates the placeholder-detection widening, which catches all seven realistic unsubstituted template forms. The other was live:

**The consolidator-provenance gate failed on a consolidator that had genuinely been dispatched.** It matched `Correlation:\s*(cid_…)` while its own template quotes that header in backticks, so an agent following the instruction renders `` Correlation: `cid_…` `` or `` **Correlation:** `cid_…` `` — and neither matched. The gate rejected output produced by obeying its own template. (Their diagnosis said backticks block the match; whole-line backticking actually matches fine — it is a code-span *id* or a bolded label that fails.) The reader now tolerates markdown decoration between label and id. Loosening is safe because the captured id must still equal a real dispatch-stamp record, so a stray match falls through rather than passing anything.

**Lanes could not see each other's scope.** Cross-lane observations were guesses that happened to survive because the consolidator deduped them — luck, not design. Each lane envelope now carries `<lane_neighbors>`: one line per other lane with its community, file count, and top-level areas, plus the instruction to name the owning lane rather than fix or re-review a neighbor's file. The data was already in the orchestrator's hands at render time.

**Lane sidecars pinned `id` + `severity` only**, so a lane emitting exactly that was compliant and the consolidator had to re-read its markdown to recover what each finding was — the re-derivation the sidecar exists to prevent. `file` and `title` are now required.

**Verified negatives are documented rather than improvised.** The single highest-leverage input to one field consolidation was a notes block carrying hypotheses the orchestrator had already tested and refuted; it pre-empted a re-derivation and stopped a disproved hypothesis resurfacing as a phantom Critical. That was something the operator had to think of unprompted. `--notes-file` now documents a `## Verified Negatives` section, and the synthesis template instructs the consolidator to treat it as settled.

### Gates

- **F44** — the mandate reaches the reviewer on **both** dispatch paths: 4/4 compiled marker regions carry the block, the render path substitutes it exactly once, task-bearing templates get no second copy, and an empty task emits nothing. The compiled-region leg is the load-bearing one — a CLI-only assertion passes while the path the canonical review actually uses stays unfixed. Asserts non-emptiness deliberately: every gate in this path checked that blocks *exist* and none checked that they *say* anything.
- **F45** — every `reader_fields` entry is pinned in the producer template.
- **F46** / **F47** cover the field-name pairing and the state round-trips above.
- **K115** re-anchored to the 8-axis taxonomy; the expected count stays hardcoded on purpose, since deriving it from the rubric is what the CLI already does and would make the gate tautological.

## [0.241.0] - 2026-08-08

### Fixed

- **The god-node scan measured against the wrong branch on any project whose primary branch isn't `main`.** `augment-impact-map` resolved its diff base from `brief.git.primary_branch` — a field `preflight-brief.json` has never carried, in any version. The lookup therefore never resolved, the `"main"` literal beside it was the real answer, and that literal was then passed **explicitly** to `collectChangedFiles`, which interpolates whatever it is given and silently catches an unreachable ref. On a project configured with `primary_branch: development`, the scan ran over **289 files instead of 92** — three times the correct set — and reported nothing, because a wrong base cannot raise: it scans the wrong thing thoroughly and returns a confident clean result. That output feeds `<god_node_warnings>` into every reviewer dispatch. Found by validating an operator's standing habit of exporting `PRIMARY_BRANCH` by hand "even after confirming config has it right" — the workaround was masking this.

### Changed

- **One resolver for the diff base.** Seven sites had each re-implemented `(cfg && cfg.git && cfg.git.primary_branch) || "main"`, and the eighth disagreed with all of them — which is the actual root cause, not the one wrong line. `config.cjs::resolvePrimaryBranch(explicit, cfg)` is now the single implementation and every consumer routes through it; an explicit ref still overrides, a blank one falls through to config. A gate leg fails if any module resolves it independently again.
- **`augment-impact-map` reports the base it used.** The result now carries `base_ref` and `diff_file_count`. A wrong base is the one error this command cannot raise, so the number has to be visible — that invisibility is precisely what the operator was compensating for.

### Added

- **F43** — three legs: the resolver contract (explicit overrides, blank falls through), `augment-impact-map` exercised end-to-end on a repo that has **no `main` branch at all** so the old literal yields an empty scan, and a structural check that no module re-implements the resolution. Verified falsifiable: reverting the fix reports `augment_base=main:EMPTY`.

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
