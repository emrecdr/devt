# Code-Review Parallel-Lane Workflow — Design Spec

**Status**: approved 2026-05-27. Pending implementation plan (writing-plans skill next).
**Author**: design pass with Emre.
**Field signal**: greenfield 2026-05-26 PR #372 6-lane improvised fan-out → 5/6 lanes returned stubs, L1 hook denied improvised re-dispatches, main thread stalled on background tasks waiting for notifications that never arrived.
**Predecessor**: deferred backlog item L5 from v0.58.0 CHANGELOG (*"Document parallel-lane workflow (`code-review-parallel.md`) for multi-lane reviews"*).
**Builds on**: substance-enforcement gates shipped v0.58.1–v0.58.3 (F26/F27/F28/F29/F30/F31). [[CON-001-substance-enforcement-gates]].

## Problem

`/devt:review` defines a single code-reviewer dispatch + single verifier dispatch. When the review scope exceeds the code-reviewer's per-dispatch turn budget (~10+ files), the orchestrator improvises N-way parallel fan-out — and historically that improvisation has a **~40% sub-agent success rate** (per `docs/AGENT-CONTRACTS.md`), produces lane outputs the verifier can't grade, and routes around the L1 dispatch-hygiene hook.

The user wants parallel review as a first-class workflow feature: triggered explicitly, dispatched cleanly, gated on substance, consolidated deterministically, verified consistently.

## Goal

Add an optional parallel-lane path to `/devt:review` that:

1. Triggers via `AskUserQuestion` when scope exceeds 10 files
2. Partitions work by graphify community (the existing substance-aware unit)
3. Dispatches N lanes in ONE message (foreground parallel — Anthropic-canonical "true parallelism" idiom)
4. Substance-gates each lane via F28 (`state check-agent-output`) before consolidation
5. Re-dispatches stub lanes once via a canonical template (closes L1 hook compliance)
6. Consolidates lane outputs through a code-reviewer synthesis-mode dispatch
7. Routes the consolidated `review.md` through the unchanged verify step

Non-goals: auto-trigger without `AskUserQuestion`, per-lane verifiers, multi-lane patterns for other workflows (dev-workflow, etc. — deferred until field signal arrives).

## Architecture

```
/devt:review <scope>
  │
  ▼
context_init (unchanged) — preflight + graph-impact.md + memory_signal cache
  │
  ▼
scope_check
  │
  ├─ files ≤ 10  → existing single-dispatch path (unchanged)
  │
  └─ files > 10 → AskUserQuestion("Split into parallel lanes?")
                   │
                   ├─ NO  → existing community-filter fallback (unchanged)
                   │
                   └─ YES → multi-lane path (NEW)
                            │
                            ▼
                       partition_lanes
                       reads graph-impact.md::affected_communities
                       caps at 5 lanes; falls back to community-filter
                         single-dispatch when graphify unavailable
                       writes workflow.yaml::lanes[] registry
                            │
                            ▼
                       dispatch_lanes
                       ONE message with N foreground Task() calls
                       each carries <scope_trust> + <scope_hint scoped to lane>
                         + <memory_signal>
                       each lane writes review-lane-{community}.md
                            │
                            ▼
                       substance_check
                       state check-agent-output per lane file
                       on stub → re-dispatch step (canonical template,
                                 SAME context blocks)
                       on second stub → mark lane deferred,
                                        continue with available lanes
                            │
                            ▼
                       consolidate
                       code-reviewer dispatched in synthesis mode
                       reads all review-lane-*.md
                       dedupes findings by (file:line:finding_class)
                       reconciles severity via rubric
                       writes review.md + review.json
                            │
                            ▼
                       verify (existing, unchanged) — grades review.md
```

## Components

### 1. New workflow file: `workflows/code-review-parallel.md`

A SEPARATE workflow file that the existing `code-review.md` delegates to when the user says yes to the AskUserQuestion. Keeping it separate (rather than branching inside `code-review.md`) makes the workflow contract explicit and lets smoke gates assert single-dispatch shape vs multi-dispatch shape independently.

**Steps**:
- `context_init` — re-uses the same payload as `code-review.md` (preflight, graph-impact, memory_signal, governing_rules). Cached in `workflow.yaml` for downstream dispatches.
- `partition_lanes` — bash step reading `graph-impact.md::affected_communities`; writes `workflow.yaml::lanes[]`. Cap at 5. Fallback: empty communities → single-dispatch via `code-review.md` (no multi-lane).
- `dispatch_lanes` — single message with N `Task(subagent_type="devt:code-reviewer", …)` calls. Each prompt carries `<scope_trust>`, `<scope_hint>` (filtered to lane's files), `<memory_signal>`, `<governing_rules>`, plus a `<lane_id>` and `<lane_files>` block.
- `substance_check_lanes` — loops `state check-agent-output` over each `review-lane-*.md`. Stub lanes go through `redispatch_lane` once.
- `redispatch_lane` (sub-step) — canonical re-dispatch template. Reads cached context blocks from `workflow.yaml`. Writes via SAME shape as `dispatch_lanes`. Increments `lanes[i].redispatch_count`. Second stub → `lanes[i].status = "deferred"`.
- `consolidate` — single `Task(subagent_type="devt:code-reviewer", …)` dispatch in synthesis mode. Task instruction: "Synthesize the N lane review files into a single review.md. Dedupe findings by (file:line:finding_class), reconcile severity using the rubric, preserve all Critical findings, group by file." Writes `review.md` + `review.json`.
- `verify` — identical to `code-review.md::verify` step. Inline-includes via `@workflows/code-review.md#verify` or duplicates the body with KEEP-IN-SYNC marker (decision in implementation plan).

### 2. State schema extension: `workflow.yaml::lanes[]`

```yaml
lanes:
  - id: "L1"
    community: "auth_subgraph"
    files: ["src/auth/middleware.ts", "src/auth/session.ts"]
    review_file: ".devt/state/review-lane-auth_subgraph.md"
    status: "in_flight"            # in_flight | substance_pass | stub_redispatched | deferred
    redispatch_count: 0
    dispatched_at: "2026-05-27T10:00:00Z"
```

`state.cjs::VALID_LANE_STATUSES` enforces the enum. `state.cjs` gains a new internal helper `readLaneRegistry()` and `updateLaneStatus(laneId, status)` for the bash steps to call.

### 3. CLI subcommand: `state list-lane-outputs`

Returns the `.devt/state/review-lane-*.md` paths plus their `workflow.yaml::lanes[]` metadata. Used by:
- The substance check loop
- The consolidator dispatch's `<lane_files>` context block

Format:
```json
{
  "lanes": [
    {"id": "L1", "review_file": ".devt/state/review-lane-auth_subgraph.md", "status": "substance_pass"},
    {"id": "L2", "review_file": ".devt/state/review-lane-billing_subgraph.md", "status": "deferred"}
  ]
}
```

### 4. STATE-RULES.md extension

Add `review-lane-{slug}.md` to the allowed slug pattern. Slug: `[a-z][a-z0-9_]*` matching `affected_communities[].name` values from graphify.

### 5. code-reviewer agent body change

Add a new synthesis-mode handler at the top of `<execution_flow>`:

```markdown
**Lane synthesis mode.** When the dispatch `<task>` instruction explicitly says "Synthesize the N lane review files…", DO NOT perform a fresh code review. Instead:
1. Read every `review-lane-*.md` listed in `<lane_files>`.
2. Dedupe findings by `(file:line:finding_class)`.
3. Reconcile severity using the rubric (Critical > Important > Minor > Suggestion).
4. Preserve all Critical findings even when other lanes flagged them at lower severity.
5. Group findings by file in the consolidated `review.md`.
6. Write `review.md` + `review.json` exactly as the single-dispatch path does.

No new graphify queries; no new file reads beyond the lane outputs and what lane authors cite.
```

No new agent file. Same subagent_type, same tools, same model.

## Lane partitioning algorithm

```pseudo
partition_lanes(graph_impact_md, scope_files):
  communities = parse(graph_impact_md.affected_communities)
  if communities is empty or graphify_unavailable:
    return SINGLE_LANE_FALLBACK   # routes back to code-review.md community-filter

  # Bucket each scope file into its community (or "ungrouped" if no community)
  buckets = {}
  for file in scope_files:
    community = first_community_containing(file, communities) or "ungrouped"
    buckets[community].append(file)

  # Cap at 5 lanes; merge smallest communities into "ungrouped" when over cap
  while len(buckets) > 5:
    smallest = min(buckets, key=lambda b: len(buckets[b]))
    if smallest == "ungrouped": break    # never merge OUT of ungrouped
    buckets["ungrouped"] += buckets.pop(smallest)

  # Each non-empty bucket becomes a lane
  return [Lane(id=f"L{i+1}", community=name, files=files)
          for i, (name, files) in enumerate(buckets.items()) if files]
```

Why cap 5: Anthropic Task tool concurrency is rate-limited; 5+ concurrent dispatches saturate the harness. Per-lane budget shrinks below useful threshold past 5 lanes. Field-validated: greenfield's 6-lane run was already past the sweet spot.

## Substance gate per lane

After `dispatch_lanes` returns (all foreground Tasks completed):

```bash
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
for LANE_ID in $(echo "$LANES_JSON" | jq -r '.lanes[].id'); do
  LANE_FILE=$(echo "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .review_file')
  RESULT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output "$LANE_FILE")
  if echo "$RESULT" | jq -e '.looks_like_stub == true' >/dev/null 2>&1; then
    REDISPATCH_COUNT=$(echo "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .redispatch_count')
    if [ "$REDISPATCH_COUNT" -ge 1 ]; then
      # Second stub — defer
      node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=deferred
    else
      # First stub — schedule re-dispatch
      node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=stub_redispatched
    fi
  else
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=substance_pass
  fi
done
```

Then a single `redispatch_lanes` step issues one message with N Task calls for any `status=stub_redispatched` lane — using the canonical template from `dispatch_lanes` (same context blocks). The L1 dispatch-hygiene hook accepts these because every required block is present.

## Failure modes addressed

| Failure mode | Mitigation |
|---|---|
| Lane returns stub | F28 per-lane, re-dispatch once, defer on second stub |
| Lane hangs silently | Cannot occur — foreground + `maxTurns` is a hard bound |
| L1 hook denies improvised re-dispatch | Canonical re-dispatch template injects all required blocks |
| Empty/impossibly-fast lane return (harness fail) | Hard-defer, no retry (file size < 30 bytes within 30s of dispatch) |
| All lanes deferred | Consolidator emits `review.md` noting full failure; verifier sets `verdict=failed` → STOP with BLOCKED |
| Lanes find overlapping issues | Consolidator dedupes by `(file:line:finding_class)` |
| Severity calibration drift | Consolidator reconciles via rubric |
| Graphify unavailable (no communities) | Fall back to single-dispatch + community-filter |
| User declines multi-lane | Falls back to single-dispatch + community-filter |
| Critical finding only flagged by one lane | Consolidator preserves it regardless of other lanes' severity assignment |

## Smoke gate plan

| Gate | Verifies |
|---|---|
| F32a | scope ≤ 10 files takes single-dispatch path (no AskUserQuestion fires) |
| F32b | scope > 10 files surfaces AskUserQuestion |
| F33a | lane partitioning caps at 5 when affected_communities has 7+ |
| F33b | lane partitioning falls back to single-dispatch when graphify unavailable |
| F34a | per-lane F28 detects stub in any `review-lane-*.md` |
| F34b | retry-once-then-defer policy holds (state transitions: in_flight → stub_redispatched → deferred) |
| F35a | consolidator dedupes overlapping findings by (file:line:finding_class) |
| F35b | consolidator emits valid `review.json` after synthesis |
| F36a | re-dispatch step injects all three L1-required context blocks |
| F36b | `workflow.yaml::lanes[]` schema validates at dispatch + each status transition |
| F37a | empty + impossibly-fast lane return is hard-deferred without retry |
| F37b | all-lanes-deferred case produces `review.md` with `## Failed Lanes (Deferred)` + verifier sees `verdict=failed` |

Total: 12 new smoke gates. Target: smoke `620 → 632`.

## Files to create / change

**New**:
- `workflows/code-review-parallel.md` — the new workflow body
- `docs/superpowers/specs/2026-05-27-code-review-parallel-design.md` — this file

**Changed**:
- `workflows/code-review.md` — add `AskUserQuestion` step when scope > 10 files; route YES → delegate to `code-review-parallel.md`
- `bin/modules/state.cjs` — add `lanes[]` schema validation, `list-lane-outputs` subcommand, `update-lane` subcommand, helper functions
- `agents/code-reviewer.md` — add synthesis-mode handler in `<execution_flow>`
- `docs/STATE-RULES.md` — add `review-lane-{slug}.md` pattern
- `docs/AGENT-CONTRACTS.md` — update the "EXACTLY ONE dispatch" rule to reference the parallel path as the sanctioned exception
- `CLAUDE.md` — Development Commands block sync (`state list-lane-outputs`, `state update-lane`)
- `scripts/smoke-test.sh` — 12 new gates
- `CHANGELOG.md` — `[0.59.0]` section (minor bump — new feature)
- `VERSION`, `.claude-plugin/plugin.json` — 0.58.3 → 0.59.0

## Out of scope (deferred)

- Auto-trigger without AskUserQuestion (Option A from the discussion; user picked Option C)
- Per-lane verifiers (single verifier on consolidated review is structurally simpler; no field signal for needing per-lane grading)
- Background-task dispatch (validated against: Task tool docs + greenfield field evidence)
- Lane patterns for `dev-workflow.md` (no field signal yet for multi-programmer flows)
- Lane partitioning strategies other than community (file-bucket + directory rejected during brainstorming)
- Cross-workflow lane reuse
- AskUserQuestion threshold tuning (10 files matches existing community-filter trigger — change only with field signal)

## Open implementation decisions (defer to writing-plans phase)

1. **`code-review-parallel.md`'s `verify` step**: inline-include via `@workflows/code-review.md#verify` or duplicate body with KEEP-IN-SYNC comment? Both work; inline-include is cleaner if devt's workflow loader supports it.
2. **Lane file slug normalization**: how to slugify community names that contain spaces or special chars (`affected_communities[].name` from graphify is free-form).
3. **`update-lane` CLI shape**: positional vs. flag-based args (`update-lane L1 status=deferred` vs `update-lane --id=L1 --status=deferred`). Match existing state subcommand idioms.
4. **Synthesis-mode dispatch context size**: the consolidator carries 5 lane files' worth of context. Cap each lane file? Inline-load via `<lane_content>` blocks vs Read-on-demand from the agent? Decide based on observed lane file sizes during smoke.

## References

- [[CON-001-substance-enforcement-gates]] — substance gate pattern this workflow inherits
- `docs/AGENT-CONTRACTS.md` — workflow contract + "Orchestrator owns MCP" rule
- `docs/INTERNALS.md::Substance-Enforcement Gates` — full architectural narrative
- `workflows/dev-workflow.md:506` — existing foreground parallel pattern (researcher+architect) this design generalizes
- Field signal: greenfield 2026-05-26 PR #372 multi-lane review session
- Task tool documentation (Anthropic): "send them in a single message with multiple tool uses so they run concurrently"
- `superpowers:dispatching-parallel-agents` skill — foreground multi-Task pattern
