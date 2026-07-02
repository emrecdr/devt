# devt — Development CLI Reference

Extracted from `docs/INTERNALS.md`. The verbose CLI inventory lives here so
the runtime-load-bearing INTERNALS.md stays tight. CLAUDE.md keeps the
short primary list for always-on context budget.

---

## Development CLI Reference

The full inventory of `node bin/devt-tools.cjs` subcommands. CLAUDE.md keeps a short primary list for the always-on context budget; the verbose entries live here so every-session token cost stays small.

### State — workflow-internal assertions and gates

```bash
node bin/devt-tools.cjs state check-agent-output <path>
# Substance check: detects stub phrases, low word count, heading-only outputs

node bin/devt-tools.cjs state check-agent-output <path> --structural --baseline=<sentinel-snapshot-path> [--mode=superset|equality]
# Structural-drift check against a stub-first sentinel snapshot — extracts headings/code-blocks/URLs/paths/inline-codes/bullets via structural-validator.cjs (caveman validate.py port) and reports drift via structural_drift:{ok, errors, warnings, mode}. Default mode=superset (final must contain all baseline structures, may add more — fits devt's stub-first protocol). mode=equality enforces strict identity. Gated by config.validator.structural_mode (default 'warn'); 'off' is a no-op even when the flag is passed.

node bin/devt-tools.cjs state assert-graphify-decision
# Confirms graphify decision artifact + cross-refs _mcp-trace.jsonl for fabricated drill-downs. When plan_tier ∈ {symbol_anchored, bulk_scoped} AND 0 get_neighbors MCP calls AND 0 drill-down sections AND graphify_decision_mode=block (default), returns ok:false to force drill-down completion. Opt-out via .devt/config.json::graphify_decision_mode: "warn" (mirrors dispatch_hygiene_mode pattern; CON-001 instance #6).

node bin/devt-tools.cjs state assert-verifier-graded-all-axes
# Post-hoc check that the verifier walked every axis in the pinned rubric. Counts both heading-style (`## Axis [A-Z] —`) and table-row-style (`| **X.`) axes; compares against verification.json::criteria_total. Mismatch → ok:false with missing_axes_count surfaced. Workflow_types whose rubrics don't use axis taxonomy (e.g. dev uses verification levels L1-L5.5) return ok:true with explicit skip reason. Observed failure mode: a verifier walks the first several axes and silently skips a later axis, returning `satisfied` despite the missing grade (CON-001 instance #7).

node bin/devt-tools.cjs state list-lane-outputs
# Read workflow.yaml::lanes[] registry with per-lane file existence + size + stale flag (mtime < first_created_at)

node bin/devt-tools.cjs state update-lane <id> status=<status> ["override_reason=<why>"]
# Mutate a single lane's status (substance_pass | stub_redispatched | deferred). Optional
# override_reason= annotates an operator override (e.g. keeping a review the stub gate
# false-flagged) — appends {ts, lane_id, prior_status, status, override_reason, pid} to
# .devt/state/lane-status-overrides.jsonl (RESET_EXEMPT audit ledger). Rejected standalone:
# it must accompany status= or redispatch_count=

node bin/devt-tools.cjs state register-lane --id=L1 --scope=<community> --files=a.py,b.py [--overwrite]
# Formal registration shortcut for orchestrators with a hand-rolled partition. Writes the canonical lane entry into workflow.yaml::lanes[] with derived metadata (slug via slugifyLaneName, file_count, est_loc, oversized) + new `registered_at` ISO timestamp. Per-lane files persist to .devt/state/lane-files/<id>.json sidecar (canonical subdir; not flagged by state cleanup). Validates id matches /^L\d+$/; rejects duplicates without --overwrite. Lock-aware read-modify-write. Replaces the raw-dispatch escape hatch that orchestrators previously used to express hand-rolled partitions

node bin/devt-tools.cjs state register-lanes --from=<lanes.yaml|.json>
# Bulk wrapper (round 8 W2). YAML inline-array files: form + JSON both accepted. Loops registerLane with allowOverwrite=true so bulk re-runs are idempotent. Returns {ok, registered:[{id,ok,reason?}], errors:[]}

node bin/devt-tools.cjs dispatch render-lanes [--out=<dir>] [--inline-rules]
# Per-lane envelopes are rules-BY-REFERENCE by default: governing_rules carries rules_hash +
# read-from-disk stubs + a Context-Loaded contract instead of full rule bodies, and CLAUDE.md
# is never inlined (the harness auto-injects it into subagents). Field-measured 391KB → 110KB
# (−71%) on a 5-lane render. --inline-rules restores full inlining for worktree-isolated lanes
# whose disk view may not match the orchestrator's. Result carries rules_mode for audit.

node bin/devt-tools.cjs state assert-knowledge-candidates-tagged
# Session-scoped via first_created_at — stale scratchpad tags from a prior workflow fail the gate

node bin/devt-tools.cjs state aggregate-knowledge-candidates
# Pulls #KNOWLEDGE-CANDIDATE: tags from review-lane-*.md / review.md / impl-summary*.md into scratchpad with dedup + provenance comments

node bin/devt-tools.cjs state assert-preflight-semantic-quality [--threshold=0.4]
# WARN-mode gate reading preflight-brief.json::topic.extraction_confidence; never blocks, returns {ok:true, warn:bool, confidence, threshold, reason}

node bin/devt-tools.cjs state assert-no-raw-dispatches-this-session
# Post-hoc enforcement. Scans dispatch-warnings.jsonl for source:raw_dispatch with ts >= first_created_at; BLOCKS workflow finalize when any. Honors dispatch_hygiene_mode={block|warn|off}. Compensates for CC PreToolUse Task-deny not enforcing. Hard kill-threshold (config: `dispatch_hygiene_kill_threshold`, default 3, null=disabled): when count ≥ threshold, returns {ok:false, killed:true} regardless of `dispatch_hygiene_mode` — hard-limit safety bypasses warn-mode for runaway-pattern detection while preserving soft-warn for intentional 1–2-off ad-hoc dispatches

node bin/devt-tools.cjs state assert-artifact-present <agent>
# Layer-1 mechanical claim-check. Reads agent's outputs.primary from agents/io-contracts.yaml, asserts the file exists + is non-empty. Returns {ok, agent, expected_path, exists, size_bytes, reason}. Every call persists result to .devt/state/claim-check-failures.jsonl for Layer-2 consumption. Workflow runners call after each output-writing dispatch to verify "agent claims it wrote X" against ground truth. Polymorphic form: `assert-artifact-present <agent>:lane-<id>` resolves expected_path from `workflow.yaml::lanes[].review_file` instead of io-contracts (used by code-review-parallel for per-lane Layer-1 records — each lane persists a distinct stream within the workflow window)

node bin/devt-tools.cjs state assert-claim-checks-resolved
# Layer-2 post-hoc finalize gate. Reads claim-check-failures.jsonl, computes per-agent latest verdict in workflow window; failures with no subsequent success block. Resolution semantic: successful re-runs overwrite prior failures. Honors claim_check_mode={block|warn|off} (default block, mirrors dispatch_hygiene_mode). Wired into all 4 workflow finalize sites adjacent to assert-no-raw-dispatches-this-session

node bin/devt-tools.cjs state recover-partial-impl <agent>
# Rate-limit-mid-section recovery diagnostic. The PARTIAL contract triggers at section boundaries; a rate-limit MID-section leaves impl-summary.md at its stub-first sentinel with no structured sidecar. CLI reads dispatch-warnings.jsonl::task_output_bytes for low_output:true + on-disk primary substance and returns a recovery decision: recovery_needed=true + suggested_action=SendMessage-resume when stub+low_output pattern matches; recovery_needed=true + suggested_action=investigate when stub but no low_output signal; recovery_needed=true + suggested_action=targeted-fix when the artifact is substantive but missing one or more sections declared in io-contracts.yaml::outputs.expected_sections (structural-drift recovery via structural-validator.cjs — gated by config.validator.structural_mode); recovery_needed=false + primary_state=substantive|missing for cleaner outcomes; recovery_needed=false + sidecar_status=<terminal> short-circuit when sidecar declares DONE/PARTIAL/etc. dev-workflow + quick-implement orchestrators call after programmer dispatch and route on the suggestion via [PARTIAL_IMPL_RECOVERY] / [STRUCTURAL_DRIFT_DETECTED] echo. Optional malformed_jsonl_lines:N field surfaces degraded dispatch-warnings telemetry when present

node bin/devt-tools.cjs state advance-phase <phase> [key=value ...]
# Runtime gate-at-transition. Reads workflow_type from state, looks up required gates for target phase in workflows/_phase-gates.yaml, runs each gate via existing assert-* functions; throws on any failure → process exits 1. Phases NOT in registry fall through to plain update (backwards compat). Every gate firing logs to gate-trace.jsonl with name prefixed "advance-phase:<gate>". Migrated 4 workflows at finalize-deactivation (replaces `state update phase=X status=DONE active=false`)

node bin/devt-tools.cjs state reset-soft
# Cal #31.A — surgical reset for new-review-against-stale-workflow. Clears per-workflow accumulator fields (raw_dispatch_count, claim-check, dispatched_at, etc.), rotates dispatch-warnings.jsonl + claim-check-failures.jsonl logs, evicts review.{md,json} + review-lane-*.{md,json} (cal #32 rank #1; prevents cid_<prefix> stale-artifact collision in fresh runs), assigns fresh workflow_id + first_created_at. PRESERVES workflow_id_history (appends prev), .devt/memory/, impl-summary.md/test-summary.md/graph-impact.md (phase artifacts that legitimately span re-runs). Non-destructive of valuable state — safe to auto-fire for unambiguous new-session signals

node bin/devt-tools.cjs state staleness-check --task=<text> [--workflow-type=<type>]
# Cal #30.1 — detects whether current workflow.yaml is stale relative to a new task/type. Returns {stale, reason, age_hours, task_changed, workflow_type_changed, auto_reset_recommended}. Stale = task_changed AND age > 1h. auto_reset_recommended = task_changed AND age > 24h AND workflow_type_changed (deterministic "new working session" signal — see auto-reset-if-stale below)

node bin/devt-tools.cjs state auto-reset-if-stale --task=<text> --workflow-type=<type>
# Cal #31.D G4 — combined diagnose+act helper. Calls stalenessCheck; when auto_reset_recommended fires resetSoft inline + emits loud stderr message describing what was cleared/preserved. Returns {acted: true, ...resetSoftResult, staleness} OR {acted: false, staleness}. Orchestrators use this instead of prompting when the 3-condition auto-trigger holds; falls back to AskUserQuestion otherwise

node bin/devt-tools.cjs state graphify-roi
# Cal #33.A Rank #1 — falsifiable measurement of graphify drill-down value. Scans graph-impact.md for `## Drill-down: <SYM> [call: <8hex>]` sections (denominator: executed drills) + review.md for `(via call: <id>)` / `[via call: <id>]` citations (numerator: drills with downstream finding-citation). Returns {status, drills_executed, drills_with_citation, wasted_drill_count, wasted_drill_rate, per_drill: [{symbol, corr_ids, cited}]}. CRITICAL exclusion: when graph-impact.md is absent OR 0 drill sections, status="no_drills_executed" + rate=null (NOT 100% — receipt #7 explicit: runs that skip substep 6 must NOT punish graphify for operator skips). Use across receipts to track wasted-drill rate; cal-N+ levers (e.g. "drop drills in direction X if waste >70%") consume the per-drill structured output

node bin/devt-tools.cjs state mark-claude-mem-skipped [--reason=<enum>] [--details=<text>]
# Cal #33.B-4 — operator escape valve for the claude-mem harvest gate. assertClaudeMemHarvest already accepts claude-mem-skipped.txt as a satisfying marker IF its content matches `reason=<not_installed|mcp_unavailable|corpus_empty|task_unrelated_to_history>` + details= line (for task_unrelated_to_history). This CLI writes the gate-compliant format. Default --reason=task_unrelated_to_history + auto-fills --details="session memory already covers scope (operator-declared)". Use when session memory already covers the scope (operator just reviewed the same PR 5x) so the harvest's marginal value is ~0. Rejects invalid --reason values; refuses when claude-mem-harvest.md already exists (mutually exclusive per gate)

node bin/devt-tools.cjs state compute-impact-plan --scope=<text> [--primary-branch=<ref>]
# Cal #37 #3 — wrapper CLI for the graphify impact-plan tier-decision tree (previously inlined as ~115 lines of bash in workflows/code-review.md substep 5). Single call returns {tier, tool, args, skip_reason, git_provider, pr_scoped_skip_reason, pr_diff_caveat?, topic_symbols_dropped_count?} and writes .devt/state/graphify-impact-plan.json. Tier-decision branches preserved verbatim: graphify-state=not_ready→skip / github+PR→pr_scoped / non-github+PR→pr_scoped_diff (diff symbols) or symbol_anchored fallback / topic.symbols→symbol_anchored / scope ≥ threshold + dense + diff-symbols→symbol_anchored / scope ≥ threshold + dense + no diff-symbols→bulk_scoped / else→skip. Side effects: pre-truncates topic.symbols to TOPIC_CAP=32 with topic-symbols-dropped.json sidecar write/cleanup. MCP execution (blast_radius/get_neighbors) + AskUserQuestion stay orchestrator-side — they architecturally cannot move into a CLI.

node bin/devt-tools.cjs state disk-check
# Cal #38.C — cheap free-disk probe (df -Pk, ~5ms). Returns {ok:true, status, free_mb, warn_threshold_mb} where status is "ok" | "warn" (< 1 GiB free) | "unknown". WARN-ONLY by design — never blocks: surfaced at the context_init preflight brief AND at pre-fan-out (cmdRenderLanes::disk_warning) so a multi-lane run doesn't ENOSPC mid-fan-out with N agent transcripts accumulating, but user intervention is the failsafe (no hard stop). `ok` is always true; a low-disk signal carries the human-readable `message`.

node bin/devt-tools.cjs state refresh-scope-context
# Alias for `preflight scope-cache`. Re-derives scope_trust from preflight-brief.json::graph_stats + staleness (with staleness-threshold override) and persists to workflow.yaml::scope_trust_json. Idempotent, ~50ms. Wired into each dispatch site so cached scope_trust always reflects current graph state, not the value computed at workflow start
```

### Multi-instance isolation

```bash
node bin/devt-tools.cjs state new-instance [--tag=<label>]
# Generates an 8-char hex workflow_id, creates .devt/state/<id>/ subdir + .devt/state/.instances/<id>.json index entry. Typical use: `export DEVT_WORKFLOW_ID=$(devt-tools state new-instance --tag=feature-X | jq -r .wf_id)` per terminal. When DEVT_WORKFLOW_ID is set, getStateDir() returns the per-instance subdir so workflow artifacts (decisions.md, plan.md, impl-summary.md, claim-check-failures.jsonl, gate-trace.jsonl, etc.) don't collide between concurrent devt sessions. Cross-instance files (deferred.md, council transcripts, last-curator-run.txt, probe-failures.jsonl, .graphify-rebuild.lock) stay at the root. Backwards compatible: when DEVT_WORKFLOW_ID is unset, all paths resolve to the legacy `.devt/state/` root — existing single-instance users see no change. ID format `[A-Za-z0-9_-]{1,64}` is enforced; unsafe values (path traversal attempts, etc.) fall back to legacy with a stderr warning

node bin/devt-tools.cjs state list-instances
# Enumerate all instance subdirectories under .devt/state/. Returns {wf_id, created_at, last_active, phase, tag, file_count} per instance, sorted by last_active descending. Use when returning to a project the next session and need to find your previous instance: `devt-tools state list-instances | jq -r '.instances[] | "\(.wf_id) phase=\(.phase) tag=\(.tag)"'`
```

### Dispatch — envelope render + compile

```bash
node bin/devt-tools.cjs dispatch render-filled <agent>:<workflow_id|auto> [--rules-exclude=heading,list]
# Render an envelope with state-driven placeholder substitution. Defaults from active workflow.yaml when :auto. Opt-in --rules-exclude strips matching `## Heading` sections from inlined governing_rules.content before substitution — exact title match, predictable. Auto-wires from project config: `.devt/config.json::rules.exclude_sections: []` is merged with the CLI flag list (deduped) so the section strip accrues per-project without per-call plumbing. `render-lanes` threads the merged list through to every lane envelope. Envelope carries a trailing `<!-- rules-excluded: N sections (X.X KB saved) -->` marker for audit. Typical savings run 15-35% per dispatch depending on which sections are excluded

node bin/devt-tools.cjs dispatch render-lanes [target] [--target=<agent>:<workflow>] [--out=<dir>]
# Emit per-lane envelopes for every entry in workflow.yaml::lanes[]. Default target is code-reviewer:code_review (the canonical per-file review template carrying the self-grade directive in its task body — hand-rolled raw-dispatch task text consistently omits the self-grade directive, so emitting envelopes from the canonical template by default makes the bypass structurally impossible). Each lane gets the base envelope + injected <lane_id>, <lane_community>, <lane_files> before </context>; canonical "Write review to .devt/state/review.md" trailer is overridden per-lane to lane.review_file so concurrent lanes don't clobber one path. Stdout mode: concatenated with `<!-- LANE: <id> -->` separators. --out=dir mode: writes one file per lane + returns JSON summary with byte counts. Empty-state path: clear stderr message + usage hint before exit 2

node bin/devt-tools.cjs dispatch compile --check|--write
# Verifies (or rewrites) every <!-- BEGIN dispatch:agent:workflow_id --> region in workflows/*.md against its template at templates/dispatch/envelopes/. Returns regions_checked + drift array. --check exits 1 when drift exists; --write atomically rewrites drifted bodies

node bin/devt-tools.cjs dispatch run <agent> --task="<text>" [--workflow=<id|auto>] [--rules-exclude=<headings>]
# Single-dispatch ergonomic launcher. Builds the canonical envelope (scope_trust, scope_hint, memory_signal, governing_rules) and prints it Task-tool-ready, so an orchestrator doing ONE devt:* dispatch can stay on the canonical path without the 3-step lanes.yaml → register-lanes → render-lanes boilerplate. Compresses single-agent dispatch to one CLI call. For parallel fan-out, still use render-lanes (run is single-agent only by design). --task is required; empty task rejected at input validation
```

### Agent — recovery + resume

```bash
node bin/devt-tools.cjs agent resume [auto|--sidecar=<path>]
# Walled-agent recovery: reads an agent's sidecar (impl-summary.json / test-summary.json / verification.json) and emits a SendMessage-ready resume block — bridges the gap where a dispatched agent returned PARTIAL status and the orchestrator needs to continue without re-dispatching from scratch. `auto` mode walks state-dir for the most-recent PARTIAL sidecar; explicit --sidecar=<path> targets a specific one. Missing sidecar fails loudly with the canonical fallback hint
```

### Workflow overrides — env vars

| Env var | Default | Effect |
|---|---|---|
| `PRIMARY_BRANCH` | `main` | Base branch for `git diff --name-only ${PRIMARY_BRANCH:-main}...HEAD` in `workflows/code-review.md` `scope_check` + `identify_scope`. Set per-project (`export PRIMARY_BRANCH=development` for trunk-based or non-main projects) so multi-commit feature branches diff against merge-base instead of `HEAD~1` |
| `DEVT_HOOK_PROFILE` | `standard` | Hook tier — `minimal` / `standard` / `full`. See CLAUDE.md hook profiles table |
| `DEVT_DISABLED_HOOKS` | (empty) | CSV of hook script names to disable regardless of profile |
| `DEVT_WORKFLOW_ID` | (unset) | Multi-instance isolation — when set, `getStateDir()` returns `.devt/state/<id>/` for per-terminal workflow concurrency |
| `DEVT_HOOK_TRACE` | `1` | Universal hook invocation trace at `.devt/state/hook-trace/run-hook.jsonl`. Kill switch: `DEVT_HOOK_TRACE=0` |
| `DEVT_MCP_ALLOW_WRITES` | (unset) | Permits `memory_upsert_doc` MCP write surface — default-deny safety floor for project-shape doc writes |

### Evolution — git-history behavioral metrics (operator-runnable)

```bash
node bin/devt-tools.cjs evolution scan [--window-months=N] [--top=N] [--max-changeset-size=N] [--out-dir=DIR] [--no-write]
# Single `git log --numstat` pass → hotspots (change frequency × LOC), change coupling (co-change pairs, code-maat degree formula), SZZ-lite fix density (commit-subject regex), relative churn, code age, ownership/minor contributors (auto-gated at ≥3 distinct authors in window). Language-agnostic — no parser, no AST, works on any stack. Writes .devt/state/evolution-report.md (architect-ready tables + interpretation notes) + evolution-report.json (full per-file data). Stdout is a compact summary (counts, top-5 hotspots/coupling, artifact paths). Degrades gracefully: {ok:false, reason:"not_a_git_repo"} outside git. Coupling excludes commits over max_changeset_size files (default 30 — mass reformats fake coupling); exclusion count surfaces in commits_skipped_large. Config: evolution.* (window_months, thresholds, fix_pattern, exclude globs, ownership mode). Consumed by the evolution_scan step in arch-health-scan.md; gates K225/K226
```

### Memory — surface helpers (operator-runnable)

```bash
node bin/devt-tools.cjs memory candidates-footer
# Finalize-footer convenience wrapper. Replaces the multi-line bash block previously inlined in code-review.md, code-review-parallel.md, quick-implement.md::finalize, dev-workflow.md::finalize. Silent (no stdout) when not ready; emits the canonical `💭 N memory candidates pending in .devt/memory/_suggestions.md — run /devt:memory promote to triage.` line + leading blank line when ready_to_surface, then touches the cooldown. Always exits 0 — surface failure is best-effort. workflows/next.md keeps the lower-level candidates-status primitive because its variant uses ready_to_surface as a shell variable to gate a downstream AskUserQuestion
```

### Build steps (maintainer-only)

```bash
node bin/devt-tools.cjs static-compress <path> [--restore]
# Opt-in prose compressor for project markdown files (.devt/rules/*.md, guardrails/*.md, skill bodies). Probes for `headroom` CLI on PATH for neural extractive compression; falls back to prose-shrink.cjs (regex, caveman-shrink port) when absent. Either engine runs through structural-validator post-compression — drift detected → backup deleted, input untouched. Five safety layers before backup-write: sensitive-path denylist refusal, size cap (500 KB default), empty refusal, identical-output refusal, backup-readback with byte-mismatch detail on failure. Reversible via <path>.original.md sibling and --restore. Gated by config.static_compress.mode='off' default (returns ok:true, skipped:true, exit 0 when off — config-as-designed, not failure). Compress + restore actions log to .devt/state/static-compress.jsonl (RESET_EXEMPT). User-facing recipe: docs/static-compress-recipe.md

node bin/devt-tools.cjs graphify rebuild [--debounce=N] [--timeout=N]
# Atomic O_CREAT|O_EXCL lock at .devt/state/.graphify-rebuild.lock; concurrent callers skip with reason=debounced inside the window; mtime past window unlinks + retries

node bin/devt-tools.cjs graphify compose-drilldowns <symbol>... [--direction=in|out|both] [--depth=1] [--limit=3]
# Cal #31.D G7 — emits markdown-ready `## Drill-down: <SYM> (direction=..., depth=...)` sections for top-N symbols. Each section includes per-neighbor bullets (label, relation, source_file, optional `+N DI-collapsed` marker from G1) + filter telemetry footer. Designed for pipeline use: `graphify compose-drilldowns CallOrchestrationService AuthService UserService | tee -a .devt/state/graph-impact.md` removes the "did I remember to append drill-downs?" failure mode that historically forced graphify-decision gate re-runs (receipt #5 Q7a evidence). Emits canonical empty marker `_(no neighbors found in direction=...)_` when get_neighbors returns 0 results — substance gate (cal #32 rank #3) exempts this marker so legitimately-empty DI-blind symbols don't force operator-pad workarounds

node bin/devt-tools.cjs init review --bundle "<task>"
# Cal #31.D G6 — opt-in compound CLI. Default `init review` returns the standard envelope-context payload. With `--bundle` flag, attaches the 3 most common post-init data-fetch steps in one call: preflight-generate, memory-signal count probe, graphify impact-plan computation (when graph is ready). Best-effort: any sub-step failure aggregates into bundle.errors[] so init.workflow_id always succeeds. Reduces 4-6 sequential CLI round-trips to 1; receipt #5 Q7b evidence: setup friction is dominated by CLI calls, not MCP or file reads
```

## Cross-references

- `docs/AGENT-CONTRACTS.md` — agent + workflow contracts (consumed by these mechanisms)
- `docs/MEMORY.md` — memory layer + Pre-Flight Brief details
- `docs/HOOKS.md` — hook subsystem internals
- `docs/GRADER.md` — outcome-grader + rubric resolution
- `docs/GRAPHIFY.md` — graphify integration
- `docs/STATE-RULES.md` — `.devt/state/` filename contract
- `docs/COMMANDS.md` — user-facing command reference
