# devt — Development CLI Reference

Extracted from `docs/INTERNALS.md` per Cal #23 5B simplification. The verbose
CLI inventory lives here so the runtime-load-bearing INTERNALS.md stays tight.
CLAUDE.md keeps the short primary list for always-on context budget.

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
# Confirms graphify decision artifact + cross-refs _mcp-trace.jsonl for fabricated drill-downs. Cal #22 F1: when plan_tier ∈ {symbol_anchored, bulk_scoped} AND 0 get_neighbors MCP calls AND 0 drill-down sections AND graphify_decision_mode=block (default), returns ok:false to force F16 drill-down completion. Opt-out via .devt/config.json::graphify_decision_mode: "warn" (mirrors dispatch_hygiene_mode pattern; CON-001 instance #6).

node bin/devt-tools.cjs state assert-verifier-graded-all-axes
# Cal #22 F2: post-hoc check that the verifier walked every axis in the pinned rubric. Counts both heading-style (`## Axis [A-Z] —`) and table-row-style (`| **X.`) axes; compares against verification.json::criteria_total. Mismatch → ok:false with missing_axes_count surfaced. Workflow_types whose rubrics don't use axis taxonomy (e.g. dev uses verification levels L1-L5.5) return ok:true with explicit skip reason. Greenfield calibration #22 evidence: verifier walked code_review axes A–G and stopped, silently skipping axis H (CON-001 instance #7).

node bin/devt-tools.cjs state list-lane-outputs
# Read workflow.yaml::lanes[] registry with per-lane file existence + size + stale flag (mtime < first_created_at)

node bin/devt-tools.cjs state update-lane <id> status=<status>
# Mutate a single lane's status (substance_pass | stub_redispatched | deferred)

node bin/devt-tools.cjs state register-lane --id=L1 --scope=<community> --files=a.py,b.py [--overwrite]
# Formal registration shortcut for orchestrators with a hand-rolled partition (round 8 W1). Writes the canonical lane entry into workflow.yaml::lanes[] with derived metadata (slug via slugifyLaneName, file_count, est_loc, oversized) + new `registered_at` ISO timestamp. Per-lane files persist to .devt/state/lane-files/<id>.json sidecar (canonical subdir per round 9 #1; not flagged by state cleanup). Validates id matches /^L\d+$/; rejects duplicates without --overwrite. Lock-aware read-modify-write. Replaces the 50-raw_dispatch hygiene-warnings escape hatch greenfield calibration Q3 surfaced

node bin/devt-tools.cjs state register-lanes --from=<lanes.yaml|.json>
# Bulk wrapper (round 8 W2). YAML inline-array files: form + JSON both accepted. Loops registerLane with allowOverwrite=true so bulk re-runs are idempotent. Returns {ok, registered:[{id,ok,reason?}], errors:[]}

node bin/devt-tools.cjs state assert-knowledge-candidates-tagged
# Session-scoped via first_created_at — stale scratchpad tags from a prior workflow fail the gate

node bin/devt-tools.cjs state aggregate-knowledge-candidates
# Pulls #KNOWLEDGE-CANDIDATE: tags from review-lane-*.md / review.md / impl-summary*.md into scratchpad with dedup + provenance comments

node bin/devt-tools.cjs state assert-preflight-semantic-quality [--threshold=0.4]
# WARN-mode gate reading preflight-brief.json::topic.extraction_confidence; never blocks, returns {ok:true, warn:bool, confidence, threshold, reason}

node bin/devt-tools.cjs state assert-no-raw-dispatches-this-session
# Post-hoc enforcement (greenfield calibration #12). Scans dispatch-warnings.jsonl for source:raw_dispatch with ts >= first_created_at; BLOCKS workflow finalize when any. Honors dispatch_hygiene_mode={block|warn|off}. Compensates for CC PreToolUse Task-deny not enforcing

node bin/devt-tools.cjs state assert-artifact-present <agent>
# Layer-1 mechanical claim-check. Reads agent's outputs.primary from agents/io-contracts.yaml, asserts the file exists + is non-empty. Returns {ok, agent, expected_path, exists, size_bytes, reason}. Every call persists result to .devt/state/claim-check-failures.jsonl for Layer-2 consumption. Workflow runners call after each output-writing dispatch to verify "agent claims it wrote X" against ground truth. Polymorphic form: `assert-artifact-present <agent>:lane-<id>` resolves expected_path from `workflow.yaml::lanes[].review_file` instead of io-contracts (used by code-review-parallel for per-lane Layer-1 records — each lane persists a distinct stream within the workflow window)

node bin/devt-tools.cjs state assert-claim-checks-resolved
# Layer-2 post-hoc finalize gate. Reads claim-check-failures.jsonl, computes per-agent latest verdict in workflow window; failures with no subsequent success block. Resolution semantic: successful re-runs overwrite prior failures. Honors claim_check_mode={block|warn|off} (default block, mirrors dispatch_hygiene_mode). Wired into all 4 workflow finalize sites adjacent to assert-no-raw-dispatches-this-session

node bin/devt-tools.cjs state recover-partial-impl <agent>
# Rate-limit-mid-section recovery diagnostic. The PARTIAL contract triggers at section boundaries; a rate-limit MID-section leaves impl-summary.md at its stub-first sentinel with no structured sidecar. CLI reads dispatch-warnings.jsonl::task_output_bytes for low_output:true + on-disk primary substance and returns a recovery decision: recovery_needed=true + suggested_action=SendMessage-resume when stub+low_output pattern matches; recovery_needed=true + suggested_action=investigate when stub but no low_output signal; recovery_needed=true + suggested_action=targeted-fix when the artifact is substantive but missing one or more sections declared in io-contracts.yaml::outputs.expected_sections (structural-drift recovery via structural-validator.cjs — gated by config.validator.structural_mode); recovery_needed=false + primary_state=substantive|missing for cleaner outcomes; recovery_needed=false + sidecar_status=<terminal> short-circuit when sidecar declares DONE/PARTIAL/etc. dev-workflow + quick-implement orchestrators call after programmer dispatch and route on the suggestion via [PARTIAL_IMPL_RECOVERY] / [STRUCTURAL_DRIFT_DETECTED] echo. Optional malformed_jsonl_lines:N field surfaces degraded dispatch-warnings telemetry when present

node bin/devt-tools.cjs state advance-phase <phase> [key=value ...]
# Runtime gate-at-transition. Reads workflow_type from state, looks up required gates for target phase in workflows/_phase-gates.yaml, runs each gate via existing assert-* functions; throws on any failure → process exits 1. Phases NOT in registry fall through to plain update (backwards compat). Every gate firing logs to gate-trace.jsonl with name prefixed "advance-phase:<gate>". Migrated 4 workflows at finalize-deactivation (replaces `state update phase=X status=DONE active=false`)

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
# Render an envelope with state-driven placeholder substitution. Defaults from active workflow.yaml when :auto. Opt-in --rules-exclude (round 6 W7) strips matching `## Heading` sections from inlined governing_rules.content before substitution — exact title match, predictable. Field signal: 3 CLAUDE.md sections were cited 0 times across both lanes in greenfield's review (~15-20% per-dispatch saving). Envelope carries a trailing `<!-- rules-excluded: N sections (X.X KB saved) -->` marker for audit. Measured ~34% byte reduction on programmer:dev with 2 sections excluded

node bin/devt-tools.cjs dispatch render-lanes [target] [--target=<agent>:<workflow>] [--out=<dir>]
# Round 8 W3 — emit per-lane envelopes for every entry in workflow.yaml::lanes[]. Default target is code-reviewer:code_review (the canonical per-file review template carrying the C7-7 self-grade directive in its task body — Q12 root-cause fix: hand-rolled raw-dispatch task text consistently omitted C7-7, so emitting envelopes from the canonical template by default makes the bypass structurally impossible). Each lane gets the base envelope + injected <lane_id>, <lane_community>, <lane_files> before </context>; canonical "Write review to .devt/state/review.md" trailer is overridden per-lane to lane.review_file so concurrent lanes don't clobber one path. Stdout mode: concatenated with `<!-- LANE: <id> -->` separators. --out=dir mode: writes one file per lane + returns JSON summary with byte counts. Empty-state path (round 9 #4): clear stderr message + usage hint before exit 2

node bin/devt-tools.cjs dispatch compile --check|--write
# Verifies (or rewrites) every <!-- BEGIN dispatch:agent:workflow_id --> region in workflows/*.md against its template at templates/dispatch/envelopes/. Returns regions_checked + drift array. --check exits 1 when drift exists; --write atomically rewrites drifted bodies
```

### Memory — surface helpers (operator-runnable)

```bash
node bin/devt-tools.cjs memory candidates-footer
# Round 5 — finalize-footer convenience wrapper. Replaces the 7-line bash block previously inlined in 4 workflows (code-review.md, code-review-parallel.md, quick-implement.md::finalize, dev-workflow.md::finalize). Silent (no stdout) when not ready; emits the canonical `💭 N memory candidates pending in .devt/memory/_suggestions.md — run /devt:memory promote to triage.` line + leading blank line when ready_to_surface, then touches the cooldown. Always exits 0 — surface failure is best-effort. workflows/next.md keeps the lower-level candidates-status primitive because its variant uses ready_to_surface as a shell variable to gate a downstream AskUserQuestion
```

### Build steps (maintainer-only)

```bash
node bin/devt-tools.cjs static-compress <path> [--restore]
# Opt-in prose compressor for project markdown files (.devt/rules/*.md, guardrails/*.md, skill bodies). Probes for `headroom` CLI on PATH for neural extractive compression; falls back to prose-shrink.cjs (regex, caveman-shrink port) when absent. Either engine runs through structural-validator post-compression — drift detected → backup deleted, input untouched. Five safety layers before backup-write: sensitive-path denylist refusal, size cap (500 KB default), empty refusal, identical-output refusal, backup-readback with byte-mismatch detail on failure. Reversible via <path>.original.md sibling and --restore. Gated by config.static_compress.mode='off' default (returns ok:true, skipped:true, exit 0 when off — config-as-designed, not failure). Compress + restore actions log to .devt/state/static-compress.jsonl (RESET_EXEMPT). User-facing recipe: docs/static-compress-recipe.md

node bin/devt-tools.cjs graphify rebuild [--debounce=N] [--timeout=N]
# Atomic O_CREAT|O_EXCL lock at .devt/state/.graphify-rebuild.lock; concurrent callers skip with reason=debounced inside the window; mtime past window unlinks + retries
```

## Cross-references

- `docs/AGENT-CONTRACTS.md` — agent + workflow contracts (consumed by these mechanisms)
- `docs/MEMORY.md` — memory layer + Pre-Flight Brief details
- `docs/HOOKS.md` — hook subsystem internals
- `docs/GRADER.md` — outcome-grader + rubric resolution
- `docs/GRAPHIFY.md` — graphify integration
- `docs/STATE-RULES.md` — `.devt/state/` filename contract
- `docs/COMMANDS.md` — user-facing command reference
