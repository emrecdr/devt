---
description: Parallel-lane code review — partitions scope by graphify community, dispatches N lanes in foreground parallel, consolidates outputs. Delegated to from /devt:review when scope > 10 files AND user opts in via AskUserQuestion. Inherits all gates from code-review.md.
allowed-tools: Read, Bash, Glob, Grep, Task, AskUserQuestion
argument-hint: "<scope-description>"
---

# Parallel-Lane Code Review Workflow

> This workflow re-uses code-review.md's context_init payload, and its `verify` + `present_findings` step bodies are SINGLE-SOURCED in `workflows/code-review.steps.md` (loaded at the SHARED-STEP pointers below with MODE=parallel) — edit that file, never a local copy.

This workflow is invoked from `code-review.md::scope_check` when the review scope exceeds 10 files AND the user opts into parallel via `AskUserQuestion`. It is NOT a user-facing slash command — there is no `/devt:review-parallel`; the routing is internal to `/devt:review`.

---

<prerequisites>
- `.devt/config.json` exists in project root (run `/init` first if not)
- `.devt/rules/` directory exists with project conventions
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- `workflows/code-review.md::scope_check` has already routed here via `AskUserQuestion` → user picked parallel
- `.devt/state/workflow.yaml::workflow_type` is `code_review_parallel` (set during delegation)
</prerequisites>

<available_agent_types>
The following agent type is used in this workflow:

- `devt:code-reviewer` — code review specialist, READ-ONLY (Read, Bash, Glob, Grep). Used for both per-lane reviews AND the consolidator (synthesis-mode) dispatch.

Not used in this workflow:

- `devt:programmer` — implementation specialist
- `devt:tester` — testing specialist
- `devt:architect` — structural review specialist
- `devt:docs-writer` — documentation specialist
- `devt:retro` — lesson extraction specialist
- `devt:curator` — playbook quality maintenance specialist
- `devt:verifier` — used by the shared verify step (workflows/code-review.steps.md)
  </available_agent_types>

<agent_skill_injection>
Before dispatching the code-reviewer agent (both per-lane and consolidator), check `.devt/config.json` for an `agent_skills` configuration block:

```json
{
  "agent_skills": {
    "code-reviewer": ["code-review-guide"]
  }
}
```

If `agent_skills.code-reviewer` exists, inject the skill references into the agent's prompt context — same idiom as `code-review.md` single-dispatch path. The resolved set is `.devt/config.json::agent_skills.code-reviewer` merged over the `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` tier defaults (config wins); this workflow runs off cached state with no compound-`init` payload of its own, so resolve it that way rather than reading a `resolved_skills` field. Apply uniformly to every per-lane dispatch AND the consolidator synthesis-mode dispatch so all dispatches have the same skill surface. Frontmatter-preloaded skills are never re-listed; when the resolved list is empty, inject `<agent_skills>(none — defaults preloaded via agent frontmatter)</agent_skills>`.
</agent_skill_injection>

---

## Steps

<step name="context_init" gate="compound init succeeds + lane partition computed">

**MCP-setup inheritance architecture.** This workflow is dispatched AFTER `code-review.md::context_init` has already run its full 8-substep setup — including the Graphify impact-plan, multi-tier drill-down, god-node check, and claude-mem MCP harvest. The result is `.devt/state/graph-impact.md` + cached `workflow.yaml::memory_signal_json` / `scope_hint_json` / `scope_trust_json`. Lanes consume those READ-ONLY through the dispatch templates below — they do NOT run their own MCP calls. The "0 functional MCP calls" observation in lane traces is expected: lanes are MCP-blind by design (per CLAUDE.md::Critical Agent + Workflow Contracts), and graph-impact.md is the orchestrator-mediated handoff that gives lanes the same blast-radius context without each lane re-querying the graph. The single-source preparation also keeps trace records / correlation_ids consistent across all lanes of one review.

When this workflow is dispatched WITHOUT a prior `code-review.md::context_init` run (e.g., direct invocation in tests), `STATE.memory_signal_json` will be empty `"{}"`. That's a graceful degradation — lanes still dispatch, just without inherited MCP context — but the orchestrator should re-route to `code-review.md` first when the cached fields are empty AND the project has graphify enabled.

Initialize the workflow (delegated from code-review.md; the upstream step already wrote workflow.yaml::active=true and ran preflight + memory_signal cache). Re-read the cached context blocks:

```bash
# Re-derive scope_trust from current preflight-brief.json so the cached value reflects current graph state, not the value computed at workflow start. Fail-open: stale cache used if no brief.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1 || true
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
REVIEW_SCOPE=$(printf '%s\n' "$STATE" | jq -r '.task // ""')
MEMORY_SIGNAL=$(printf '%s\n' "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(printf '%s\n' "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(printf '%s\n' "$STATE" | jq -r '.scope_trust_json // "{}"')
WORKFLOW_ID=$(printf '%s\n' "$STATE" | jq -r '.workflow_id // empty')
```

Update the workflow_type to mark this as the parallel path:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update workflow_type=code_review_parallel phase=context_init status=DONE
```

**Note**: `workflow_type=code_review_parallel` must be added to `VALID_WORKFLOW_TYPES` in `bin/modules/state.cjs` AND routed in `workflows/next.md` + `workflows/status.md` (handled in Task 10 + Task 11).

</step>

<step name="partition_lanes" gate="lanes[] registered via state update-lane OR fallback to single-dispatch">

> **Hand-rolled-partition shortcut:** If the orchestrator already knows the right lane breakdown (e.g., 7 domain lanes for a multi-service PR), skip the auto-partitioner entirely. Write a YAML file `/tmp/lanes.yaml` with `lanes: [{id: L1, scope: identity, files: [...]}, ...]` — each lane optionally carries `repo_root:` + `base_ref:` for cross-repo lanes (a sibling repository with its own diff base; sizing + the lane-diff artifact are computed in that repo). `base_ref` alone is ALSO the sanctioned way to diff against a non-default base in THIS repo — reviewing an already-merged PR or an arbitrary commit range: set `base_ref: <pre-merge-sha>` per lane and the lane diff, sizing, and per-lane `memory_affects` all compute against it (field-proven on a merged-PR review where the default base yielded an empty diff). Lens lanes (plan-compliance, coverage audit) are file buckets like any other — register them with the files they inspect. Then run `node bin/devt-tools.cjs state register-lanes --from=/tmp/lanes.yaml && node bin/devt-tools.cjs dispatch render-lanes` — render-lanes emits paste-ready per-lane envelopes carrying the rubric self-grade directive + scope blocks + governing rules **by reference** (rules_hash + read-from-disk stubs + the Context-Loaded contract; pass `--inline-rules` to restore full rule bodies for worktree-isolated lanes). Hygiene-guard silences the registered (lane_id × scope_hint × file_set) tuples so the raw_dispatch warnings that field-evidenced unbounded raw-dispatch accumulation in long sessions don't fire. The auto-partitioner below is the FALLBACK when the partition isn't known up-front.

Partition scope files into lanes. Community-first when graphify is enabled AND the graph has community attributes (B-XIII), otherwise tries service-boundary auto-detect (R7-W6), otherwise falls back to top-level directory path grouping. The `graphify lane-suggestions` CLI returns `mode: "community"` with per-file dominant-community grouping when usable, `mode: "service_boundary"` when the graph has no community labels but ≥80% of diff files match a common service-prefix pattern (`app/services/X/`, `services/X/`, `packages/X/`, etc. — community field carries the service name), or `mode: "fallback"` when neither applies. The fallback case is the legacy path partition. The orchestrator does not pick between modes — the CLI decides and the bash branch routes.

**What `state partition-lanes` does** (one call — the whole pipeline was 156 lines of bash carrying an embedded `node -e` script, which could not be unit-tested and whose cap/merge half had silently diverged from the community path's):

1. **Scope self-recovery.** `scope_check` delegates here BEFORE `identify_scope` writes `code-review-input.md`, so on a fresh parallel delegation the artifact is absent. The scope is recovered LOUDLY from the same changed-files union `scope_check` used — silently routing to single-dispatch defeated the operator's explicit parallel choice (field-confirmed: a 5-lane review ran as 1). Only a genuinely empty scope returns `action: route_single_dispatch`.
2. **Community-first partition** via `graphify lane-suggestions`. Modes `community` / `partial` / `service_boundary` group by community; anything else falls back to **top-2-level path** grouping (`src/auth/x.ts` → `src/auth`; flat layouts use top-1; root files get `root`). `lane-suggestions` stderr is carried into the reason — it exits non-zero for reachable causes like a credential-safety refusal, and a reason-less fallback gets mislabelled as a graphify capability gap.
3. **Degradation is persisted** to `.devt/state/partition-degraded.txt` (plus a `graphify-fallback-trace`), because stdout scrolls past under a 20-block orchestration and is invisible to every downstream agent. Any prior run's record is cleared first — a stale "we degraded" artifact is as misleading as none.
4. **Cap at 5 lanes, merging overflow into the most path-similar anchor** under a fair-share load cap. Nothing drops and nothing becomes a `mixed-overflow` grab-bag: a lane whose scope is "everything left over" has no coherent review lens.
5. **Registers through `register-lanes`**, so sizing, per-lane diff artifacts, and lane-files sidecars are identical to a hand-rolled partition.

```bash
REVIEW_SCOPE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.task // ""')  # fresh shell
RANGE=$(echo " ${REVIEW_SCOPE} " | /usr/bin/grep -oE -- '--range=[^ ]+' | head -1 | cut -d= -f2)
PART=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state partition-lanes --target-lanes=5 ${PRIMARY_BRANCH:+--base=$PRIMARY_BRANCH} ${RANGE:+--range=$RANGE})
if [ "$(printf '%s\n' "$PART" | jq -r '.action')" = "route_single_dispatch" ]; then
  echo "FALLBACK: $(printf '%s\n' "$PART" | jq -r '.reason') — routing to single-dispatch"
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=context_init status=DONE workflow_type=code_review
  exit 0
fi
printf '%s\n' "$PART" | jq -r '"partition_lanes: " + (.scope_file_count|tostring) + " files → " + .partition_note + " (" + (.group_count|tostring) + " groups, cap=5)"'
printf '%s\n' "$PART" | jq -r 'if .scope_recovered then "⚠️  code-review-input.md was ABSENT — recovered " + (.scope_recovered|tostring) + " file(s) from the changed-files union; proceeding PARALLEL rather than silently degrading" else empty end'
printf '%s\n' "$PART" | jq -r 'if .merged_groups then "     merged beyond the cap into the most path-similar anchors: " + (.merged_groups|join(", ")) else empty end'
# review_file is printed because it is load-bearing for the claim-check and is
# NOT guessable — it is slugified from the scope string and truncates mid-word.
printf '%s\n' "$PART" | jq -r '.registered[] | "  lane " + .id + ": size_class=" + (.size_class // "?") + " est_loc=" + ((.est_loc // 0)|tostring) + " → " + (.review_file // "?")'
COV_WARN=$(printf '%s\n' "$PART" | jq -r '.coverage_warning // empty')
if [ -n "$COV_WARN" ]; then
  echo "⚠️  ${COV_WARN}"
  printf '%s\n' "$PART" | jq -r '.scope_unassigned[] | "     unassigned: " + .'
fi
echo "Partitioned into $(printf '%s\n' "$PART" | jq -r '.lane_count') lanes (cap=5)"
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=partition_lanes status=DONE
```

**Lane-size surface**: `register-lanes` computes each lane's `size_class` from **diff LOC** (the lane's generated `lane-diff-<id>.txt`): `ok` < 3000 / `chunked` ≥ 3000 / `split` ≥ 8000, or `unknown` when diff generation fell back to whole-file counting (no threshold signal — whole-file LOC fired on every real lane and carried none). `chunked` needs no interruption — render-lanes auto-attaches the hunk-enumeration read strategy to those envelopes (field-proven at ~8000 diff lines). Only `split` lanes are surfaced to the user with remediation hints; the orchestrator may proceed (the dispatch will still attempt the lane) or use AskUserQuestion to offer narrowing — see the AskUserQuestion block below.

```bash
SPLIT_LANES=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
  jq -r '.lanes[] | select(.size_class == "split") | "  - " + .id + " (" + .community + "): " + (.est_loc|tostring) + " diff lines / " + (.file_count|tostring) + " files"')
if [ -n "$SPLIT_LANES" ]; then
  echo ""
  echo "⚠️ Split-recommended lane(s) — diff exceeds the budget a single lane dispatch handles well:"
  echo "$SPLIT_LANES"
  echo ""
  echo "Consider: (1) split the lane into two scopes via register-lane --overwrite, (2) restrict scope via /devt:review --scope=<subset>, or (3) proceed — the envelope carries the chunk-and-prioritize read strategy, but expect DONE_WITH_CONCERNS if budget runs out."
fi
```

**Gate**: When zero lanes were registered (empty scope or path bucketing failed), the step routes back to the single-dispatch path. The parallel workflow only proceeds when ≥ 1 lane is in `workflow.yaml::lanes[]` — the next step (dispatch_lanes) enforces this via `state assert-lanes-registered`.

</step>

<step name="dispatch_lanes" gate="all lane Task() calls returned in a single foreground batch">

**Foreground parallel dispatch.** Issue ONE message containing N `Task(subagent_type="devt:code-reviewer", …)` calls — one per lane in `workflow.yaml::lanes[]`. Sequential Task calls serialize; only multi-Task-in-one-message gets true parallelism per the Anthropic Task contract (same idiom as `dev-workflow.md:506` researcher+architect parallel dispatch).

**Lane completion contract**: a lane is complete when its primary artifact + sidecar are written — teammate summary messages are NOT required (artifacts are canonical; a summary duplicates content the consolidator re-reads anyway).

**Discoverability tip — BOTH dispatch shapes have a render CLI; hand-roll neither:**

- **Per-lane envelopes**: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" dispatch render-lanes --out=<dir>` — one envelope file per registered lane with `<lane_id>`/`<lane_files>`/`<correlation_id>`/`<memory_affects>`/`<lane_diff>`+`<lane_method>` already injected (it pins the per-file review template internally; you never pass `:auto`). **Dispatch via the POINTER STUB — the sanctioned first-class form**: `--out` returns a per-lane `stub` field (also printed as a stderr trailer so tailed output shows it) of the shape `<correlation_id>cid_…</correlation_id>\n<envelope path="…" rules_hash="…" sha256="…">Read the envelope file at the path above and execute its contents as your complete dispatch instructions.</envelope>` — paste ONE stub per Task() prompt. This keeps ~50KB envelopes out of orchestrator context entirely, the cid satisfies the hygiene guard, and the sha256 covers the full envelope body so a consumer can confirm the file it Reads is the file the orchestrator rendered — `dispatch verify-envelope <path> --sha256=<hash>` performs that check (nothing performs it for you; the digest is an auditable anchor, not an enforced one). Do NOT hand-invent pointer prompts; the stub IS the contract. Per-lane focus + task suffix ride via `dispatch run-lanes` directive flags.
- **Consolidator envelope**: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" dispatch render-filled code-reviewer:code_review_parallel [--notes-file=<path>]` — resolves the synthesis template with `<lane_files>` pre-filled from the registry (terminal lanes, foreign cids excluded — the same filter the pre-gate bash uses). `--notes-file` injects free-text `<orchestrator_notes>` (cross-lane reconciliation directives, validation evidence, hand-included-lane annotations) so run-specific judgment never requires hand-rolling the envelope.

  **Write a `## Verified Negatives` section into that notes file whenever you disproved something during the run** — a hypothesis you tested and refuted, with the evidence and one line of reasoning. This is the highest-value block the consolidator receives: it pre-empts the re-derivation and stops a refuted hypothesis resurfacing as a phantom finding, and the synthesis template instructs the consolidator to treat the section as settled. Field-reported as the single largest contributor to one consolidation's quality — and as something the operator had to think of unprompted, which is why it is written down here.

See `skills/dispatch-helpers/SKILL.md` for the worked example.

```bash
LANES_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-lanes-registered)
if printf '%s\n' "$LANES_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=dispatch_lanes status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$LANES_GATE" | jq -r '.reason')"
  exit 0
fi
LANE_COUNT=$(printf '%s\n' "$LANES_GATE" | jq -r '.lane_count')
echo "dispatch_lanes: ${LANE_COUNT} lanes registered"
```

Read the lane registry:

```bash
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
```

For each lane in `$LANES_JSON.lanes[]`, prepare a dispatch prompt with these context blocks injected (L1 hook compliance requires ALL three blocks present in every devt:code-reviewer dispatch):

- `<workflow_type>code_review_parallel</workflow_type>`
- `<lane_id>L<N></lane_id>`
- `<lane_community>{community}</lane_community>`
- `<lane_files>{files for this lane}</lane_files>`
- `<lane_diff>{diff_artifact from the registry, when present}</lane_diff>` + `<lane_method>Read the lane diff FIRST — that diff IS the change under review (merge-base: committed + working tree + untracked); read full files only for context around changed hunks and cascade effects.</lane_method>` — mirror `dispatch render-lanes`, which injects both automatically; for `size_class: chunked|split` lanes it also appends the hunk-enumeration read strategy (`Grep '^diff --git'` the diff, then read file-by-file in priority order). Field-proven: the diff-first method is what let large lanes land within budget.
- `<scope_trust>{cached from workflow.yaml::scope_trust_json}</scope_trust>`
- `<scope_hint>{filtered to this lane's files only}</scope_hint>`
- `<memory_signal>{cached from workflow.yaml::memory_signal_json}</memory_signal>`
- `<governing_rules rules_hash="{governing_rules.rules_hash}">by-reference: Read the .devt/rules/ files relevant to your lane scope from disk ({governing_rules.paths_included, .devt/rules/* entries only}). CLAUDE.md is auto-injected by the harness — do not re-read it.</governing_rules>` — rules-by-reference is the lane default: the rules body is byte-identical across all N lanes and lane agents share the orchestrator's working tree, so inlining it multiplies ~57KB per lane for zero signal gain. Inline the full content only for worktree-isolated lanes (mirror `dispatch render-lanes --inline-rules`).
- `<rubric_path>.devt/state/rubric-code_review.md</rubric_path>` — an IN-PROJECT copy, materialized by `init` from the resolved rubric (project-local `.devt/rubrics/` override, else the plugin default). The path must land inside the project: a plugin-root path was assumed to be readable from anywhere and was not — a lane declined to open it as *outside this repo* (a policy refusal, not a filesystem error, so no path fix inside the plugin can reach it) and self-graded against the task prose instead, which is also why its `score` came back null. Rubric-by-reference is the lane default: `render-lanes` replaces the inline body with a directive stub, so each lane reviewer Reads the rubric FIRST and walks EVERY declared axis (the A–G grading-table rows AND every `## Axis [A-Z] —` heading, currently H and I) — the same axes the verifier will grade — **except Axis H, which `render-lanes` marks lane-skip per the rubric**. A lane that still cannot read the rubric must SAY so and declare its grades non-rubric-derived rather than self-grading in silence. Inline the full rubric body only for worktree-isolated lanes (mirror `dispatch render-lanes --inline-rules`).

**Pre-dispatch graphify re-check.** The decision gate ran at `context_init` — before the scope artifact was pre-written and the bundle re-anchored. Anything that removed the map in between leaves `<graph_impact>` as a by-reference pointer to a file that is not there, and every lane inherits it at once. Re-run the same gate here, where the pointer is actually handed out:

```bash
GRAPHIFY_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-graphify-decision 2>&1)
if [ "$(printf '%s\n' "$GRAPHIFY_GATE" | jq -r '.ok // "false"')" = "false" ]; then
  echo "BLOCKED — the graphify decision that held at context_init no longer holds at dispatch:"
  printf '%s\n' "$GRAPHIFY_GATE" | jq -r '.reason // "no reason reported"'
fi
```

If that prints `BLOCKED`, **STOP**. Re-run the impact tier (`context_init` substep 6) to rebuild `graph-impact.md`, then re-enter this step. Do not dispatch lanes with a dead `<graph_impact>` pointer — a skipped tier is legitimate and passes this gate via `graphify-skip-reason.txt`; a missing artifact with no skip reason is not.

**L1-v2 prose-only lane cache suppression.** When ALL files in `<lane_files>` have a prose extension (`.md`, `.rst`, `.txt`, `.adoc`), the lane's `<graph_impact>` block must be a `not_applicable` stub rather than the global cache. Why: a prose-only README lane otherwise receives the global preflight cache (`effect_size: large, god_node_match: true`) computed against the FULL PR scope including code files — pure noise for a markdown-only review. Detect AND compute the actual block in bash so the dispatch uses `${LANE_GRAPH_IMPACT_BLOCK}` / `${LANE_SCOPE_HINT_BLOCK}` directly (no orchestrator judgment step):

```bash
LANE_FILES_PROSE_ONLY=$(printf '%s\n' "$LANE_FILES_JSON" | jq -r 'all(. as $f | ["md","rst","txt","adoc"] | any($f | test("\\.\(.)$"; "i")))' 2>/dev/null || echo "false")
if [ "$LANE_FILES_PROSE_ONLY" = "true" ]; then
  LANE_GRAPH_IMPACT_BLOCK="<graph_impact>not_applicable: prose-only lane — graphify cache suppressed (no AST relationships on prose files)</graph_impact>"
  LANE_SCOPE_HINT_BLOCK="<scope_hint>$(printf '%s\n' "$LANE_FILES_JSON" | jq -c '.')</scope_hint>"
else
  LANE_GRAPH_IMPACT_BLOCK='<graph_impact>Read .devt/state/graph-impact.md — pre-computed caller set + blast radius for this lane scope</graph_impact>'
  SCOPE_HINT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.scope_hint_json // "[]"')  # fresh shell — re-read the cache
  LANE_SCOPE_HINT_BLOCK="<scope_hint>${SCOPE_HINT}</scope_hint>"
fi
```

The orchestrator uses `${LANE_GRAPH_IMPACT_BLOCK}` and `${LANE_SCOPE_HINT_BLOCK}` verbatim in the lane's `<context>` — the bash already filtered prose-only vs mixed. Respects the MCP-blind lane contract: the orchestrator filters per-lane, lanes never query graphify themselves.

Task instruction: `Review the files listed in <lane_files>. Write your review to <output_path>. Do NOT review files outside the lane. Use the substance-first protocol — write the stub on first turn, then iterate. Record every rules file you actually read (name + full/section) in a "## Context Loaded" section of your review.`

Output path: each lane's `review_file` from the registry.

**Issue all N Task() calls in ONE message.** Each lane's `<context>` uses the bash-computed `${LANE_GRAPH_IMPACT_BLOCK}` + `${LANE_SCOPE_HINT_BLOCK}` directly (the L1-v2 prose-only suppression already filtered by lane). Example for 3 lanes:

```
Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="<context><lane_id>L1</lane_id>${LANE_GRAPH_IMPACT_BLOCK}${LANE_SCOPE_HINT_BLOCK}...</context><task>Review the files listed in <lane_files>. Write your review to .devt/state/review-lane-auth_subgraph.md.</task>")
Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="<context><lane_id>L2</lane_id>${LANE_GRAPH_IMPACT_BLOCK}${LANE_SCOPE_HINT_BLOCK}...</context><task>Review the files listed in <lane_files>. Write your review to .devt/state/review-lane-billing_subgraph.md.</task>")
Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="<context><lane_id>L3</lane_id>${LANE_GRAPH_IMPACT_BLOCK}${LANE_SCOPE_HINT_BLOCK}...</context><task>Review the files listed in <lane_files>. Write your review to .devt/state/review-lane-payments.md.</task>")
```

When all Task() calls return (foreground blocks until all complete — each agent bounded by its `maxTurns` frontmatter), proceed to substance_check_lanes.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=dispatch_lanes status=DONE
```

</step>

<step name="substance_check_lanes" gate="every lane has terminal status (substance_pass | stub_redispatched | deferred)">

After dispatch_lanes returns, run `state check-agent-output` on each lane's review file. The substance check catches stub outputs (a common multi-lane failure mode where most lanes return `status:completed` with placeholder bodies). Each lane also fires a per-lane Layer-1 claim-check (`state assert-artifact-present code-reviewer:lane-<id>`) so Layer-2's `assertClaimChecksResolved` at finalize sees lane-level resolution semantics — without this, parallel reviews have Layer-1 silently absent.

```bash
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
STUB_LANE_IDS=""
for LANE_ID in $(printf '%s\n' "$LANES_JSON" | jq -r '.lanes[].id'); do
  LANE_FILE=$(printf '%s\n' "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .review_file')
  LANE_SIZE=$(printf '%s\n' "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .file_size_bytes')
  # Substance-check race guard — mtime-stability before any
  # read. Mechanically robust against premature substance checks regardless
  # of orchestrator polling discipline. Stats the file at T0, sleeps 500ms,
  # stats again — only proceeds when size + mtime are identical (no active
  # writer). Default 5s timeout; on timeout, proceeds with sentinel warning
  # rather than blocking forever (lane behaves as if the agent never wrote).
  QUIESCE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-file-quiescent "$LANE_FILE" 2>/dev/null || echo '{}')
  if [ "$(printf '%s\n' "$QUIESCE" | jq -r '.ok // false')" != "true" ]; then
    echo "[QUIESCE-WARN] lane $LANE_ID: $(printf '%s\n' "$QUIESCE" | jq -r '.reason // "file not quiescent"') — proceeding with current read; result may be premature"
  fi
  # Re-stat after quiescence wait so LANE_SIZE reflects post-settle state.
  LANE_SIZE=$(printf '%s\n' "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .file_size_bytes')
  if [ -f "$LANE_FILE" ]; then LANE_SIZE=$(wc -c < "$LANE_FILE" | tr -d ' '); fi
  # Per-lane Layer-1 — persists file-existence + size > 0 record + substance
  # verdict (post-substance-aware Layer-1) to claim-checks.jsonl.
  # Coarser than the substance check below; this catches "lane wrote nothing
  # at all". Both records overwrite on successful re-dispatch.
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present "code-reviewer:lane-${LANE_ID}" > /dev/null
  # Hard-defer impossibly-fast empty returns (file size < 30 bytes — that's
  # not even a real stub, it's a harness/dispatch failure). No retry.
  if [ "$LANE_SIZE" -lt 30 ]; then
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=deferred
    echo "Lane $LANE_ID hard-deferred (size=${LANE_SIZE}B — harness failure suspected)"
    continue
  fi
  RESULT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output "$LANE_FILE")
  # grep -F avoids jq parse failure: stub_phrases_found[] contains raw regex
  # source strings with unescaped backslashes (\b, \s) that are invalid JSON.
  if echo "$RESULT" | grep -qF '"looks_like_stub":true'; then
    REDISPATCH_COUNT=$(printf '%s\n' "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .redispatch_count')
    if [ "$REDISPATCH_COUNT" -ge 1 ]; then
      node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=deferred
      echo "Lane $LANE_ID deferred after retry (second stub)"
    else
      node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=stub_redispatched
      STUB_LANE_IDS="$STUB_LANE_IDS $LANE_ID"
    fi
  else
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=substance_pass
  fi
done
echo "STUB_LANES_FOR_REDISPATCH=$STUB_LANE_IDS"
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=substance_check_lanes status=DONE
```

If `STUB_LANES_FOR_REDISPATCH` is non-empty, proceed to redispatch_lanes. Otherwise jump directly to consolidate.

</step>

<step name="redispatch_lanes" gate="all stub_redispatched lanes have new outputs OR are deferred">

For each lane with `status=stub_redispatched`, issue ONE re-dispatch with a NARROWED prompt. Why: identical re-dispatch (same prompt, same scope) wastes budget; trading completeness for substance ("ask for the 5 highest-signal findings only") is more likely to land. Increment `redispatch_count` BEFORE the Task() call so the next substance_check_lanes pass correctly routes a second stub to deferred.

```bash
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
for LANE_ID in $(printf '%s\n' "$LANES_JSON" | jq -r '.lanes[] | select(.status == "stub_redispatched") | .id'); do
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" redispatch_count=1
done
```

**Narrowed redispatch prompt template (B-IX)** — issue ONE message with N Task() calls (one per stub_redispatched lane), using ALL the same context blocks (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`, `<lane_id>`, `<lane_files>`, etc. — every L1-required block from dispatch_lanes) BUT replace the `<task>` instruction with the scoped form below. The output file path stays identical so consolidate picks up the new content.

```text
<task>SCOPED REDISPATCH (1/1 retry budget): the prior dispatch returned stub-quality output (substance check failed). Re-review the files listed in <lane_files>, but constrain scope to the **5 highest-signal findings only** — pick the issues whose severity × blast-radius is greatest, write a substantive `## Finding N: <title>` block for each (description, evidence, remediation), and explicitly drop everything else. The full file path coverage of the prior dispatch is NOT required this time. Write to <review_file_for_this_lane>. Cap the markdown at ~4 KB.</task>
```

Why this works: oversized + low-information lanes hit maxTurns because the agent tries to cover everything shallowly. Constraining to top-5 lets the limited budget produce substantive findings on the issues that actually matter. The orchestrator's `## Out-of-Scope Findings (Deferred)` synthesis step (consolidate) already absorbs lanes that go deferred, so completeness loss here is intentional and bounded.

After all Task() calls return, re-run substance_check_lanes via the bash loop — but this time a lane that's still non-substantive becomes terminal. Distinguish two terminal failures for coverage honesty: a **present-but-thin** stub → `deferred` (it reviewed *something*); a file that is **missing or zero-byte** even after retry → `lane_failed` (it reviewed *nothing*). `check-agent-output` flags the latter with `missing:true` / `empty:true`.

```bash
# Re-run the substance check loop (copy from substance_check_lanes step).
# Lanes with redispatch_count >= 1 that still look like stubs route to a
# terminal failure — deferred (thin) vs lane_failed (no output at all).
LANES_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs)
for LANE_ID in $(printf '%s\n' "$LANES_JSON" | jq -r '.lanes[] | select(.status == "stub_redispatched") | .id'); do
  LANE_FILE=$(printf '%s\n' "$LANES_JSON" | jq -r --arg id "$LANE_ID" '.lanes[] | select(.id == $id) | .review_file')
  # Per-lane Layer-1 — overwrites the prior stub-redispatched failure record
  # with the new verdict. Successful re-dispatch resolves the failure for
  # Layer-2; another stub leaves the failure record in place for finalize.
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present "code-reviewer:lane-${LANE_ID}" > /dev/null
  RESULT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output "$LANE_FILE")
  if echo "$RESULT" | grep -qE '"(missing|empty)":true'; then
    # Zero output even after retry — reviewed nothing. Terminal failure, NOT deferred.
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=lane_failed
  elif echo "$RESULT" | grep -qF '"looks_like_stub":true'; then
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=deferred
  else
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update-lane "$LANE_ID" status=substance_pass
  fi
done
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=redispatch_lanes status=DONE
```

</step>

<step name="consolidate" gate="review.md + review.json written by code-reviewer in synthesis mode">

Dispatch the code-reviewer in synthesis mode. The synthesis-mode handler (agents/code-reviewer.md::execution_flow top) reads lane files passed in `<lane_files>` and emits the consolidated review.

Build the lane files list (only `substance_pass` and `deferred` lanes — never include `in_flight` or `stub_redispatched`; those should have been resolved by now):

```bash
# cid_match != "foreign" filter prevents stale review-lane-*.md files from a
# rotated workflow leaking into consolidation (field-observed: stale lane files
# from a rotated workflow nearly merged into a fresh report). "current" +
# "absent" both pass — "absent" preserves compatibility with legacy lanes that
# predate cid stamping.
LANE_FILES=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
  jq -r '.lanes[] | select(.status == "substance_pass" or .status == "deferred") | select(.cid_match != "foreign") | .review_file' | \
  /usr/bin/grep -v '^$' | paste -sd ',' -)
FOREIGN_CID_COUNT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
  jq '[.lanes[] | select(.cid_match == "foreign")] | length')
DEFERRED_COUNT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
  jq '[.lanes[] | select(.status == "deferred")] | length')
SUBSTANCE_COUNT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
  jq '[.lanes[] | select(.status == "substance_pass")] | length')
# lane_failed = produced NO output even after retry → that lane's scope is
# UNREVIEWED. Surface it loudly; a "all lanes terminal" summary must not hide a
# zero-coverage hole. The consolidator MUST carry these into review.md as an
# explicit "## Uncovered Scope (lane_failed)" section so the user sees what
# was not reviewed (coverage honesty, not silent omission).
FAILED_LANES=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
  jq -r '[.lanes[] | select(.status == "lane_failed") | .id] | join(", ")')
if [ -n "$FAILED_LANES" ]; then
  echo "[consolidator] ⚠️ lane(s) produced NO output (lane_failed): ${FAILED_LANES} — their scope is UNREVIEWED. Record under '## Uncovered Scope' in review.md; do NOT report these as covered."
fi
if [ "$FOREIGN_CID_COUNT" -gt 0 ]; then
  FOREIGN_CID_LANES=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state list-lane-outputs | \
    jq -r '[.lanes[] | select(.cid_match == "foreign") | "\(.id) (cid_\(.cid_prefix // "?"))"] | join(", ")')
  echo "[consolidator] ⚠️ dropped $FOREIGN_CID_COUNT lane file(s) with foreign cid: ${FOREIGN_CID_LANES} — stale from a prior session (cid outside the workflow_id_history chain or file predates first_created_at). If a listed lane belongs to THIS review, do NOT proceed: re-check with 'state list-lane-outputs' and hand-include the lane path in <lane_files> so its scope isn't silently unreviewed."
fi
# Context-Loaded honesty check (advisory) — lanes receive governing rules
# by-reference, so each substance_pass review must record which rules files
# it actually read. A missing section means the lane may have reviewed blind
# to the rules; the consolidator notes it per lane in review.md rather than
# blocking (the findings themselves may still be sound).
for LF in $(echo "$LANE_FILES" | tr ',' ' '); do
  if [ -f "$LF" ] && ! /usr/bin/grep -q '^## Context Loaded' "$LF"; then
    echo "[consolidator] ⚠️ ${LF} has no '## Context Loaded' section — lane did not record which rules files it read (by-reference contract). Note this next to that lane's findings in review.md."
  fi
done
```

**Snapshot the lane artifacts BEFORE dispatching.** Lane status reaching `substance_pass` does not mean a lane file has stopped moving — a lane can correct its own citations minutes after it reported, and the consolidator is reading those files the whole time. Field run: the consolidator was dispatched at ~10:53 and lane artifacts were rewritten at 10:57, 11:02 and 11:11, one of them a 12-citation fix; `review.md` was synthesized from the pre-correction copies and shipped stale pointers that the orchestrator then had to hunt down. Two separate citation audits over "the same" artifact returned non-overlapping results, because each writer believed it held the corrected version.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state snapshot-lanes
```

Issue a SINGLE `Task(subagent_type="devt:code-reviewer", …)` call with the synthesis instruction. Generate it via `dispatch render-filled code-reviewer:code_review_parallel [--out=<path>] [--notes-file=<path>]` — `--out` writes the envelope to disk and prints a paste-ready pointer stub with a `correlation_id` and `sha256`, exactly as `render-lanes --out` does for lanes. **Use it rather than hand-authoring a pointer prompt**: a hand-invented correlation id does not match the render stamp, and `assert-consolidator-dispatched` correctly refuses the resulting review.md (field-observed) — `<lane_files>` arrives pre-filled from the registry and `--notes-file` carries any run-specific reconciliation directives as `<orchestrator_notes>`; the agent's synthesis mode triggers structurally on a `<lane_files>` block listing review-lane artifacts, so customized task prose cannot silently skip the consolidator contract (marker step 0 included). The canonical shape:

```
<!-- BEGIN dispatch:code-reviewer:code_review_parallel -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/code-reviewer-code_review_parallel.tmpl.md -->
Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="
  <context>
    <workflow_type>code_review_parallel</workflow_type>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
    <context_loaded_contract>governing_rules delivery: any sub-tag above carrying a (by-reference: …) stub means Read that rules file from disk when relevant to your scope, and record every file you actually read in a `## Context Loaded` section of your output artifact (name + full/section read) — that section is how a reader can tell a selective read from a skipped one. Sub-tags carrying full content inline need no disk reads and no section.</context_loaded_contract>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <god_node_warnings>{god_node_warnings_json}</god_node_warnings>
    {prior_outputs}
    {provenance_protocol}
    <rubric_path>.devt/state/rubric-code_review.md</rubric_path>
    <lane_files>{lane_files_newline_separated}</lane_files>
    <unassigned_scope>{unassigned_scope}</unassigned_scope>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
    <operator_mandate>{task_description}</operator_mandate>
  </context>
  <task>
    Synthesize the N lane review files listed in <lane_files> into a single .devt/state/review.md
    plus .devt/state/review.json sidecar. Synthesis mode — you are NOT performing a fresh review;
    the lane files were produced by per-lane code-reviewer dispatches over disjoint file slices.
    Read each lane file, then consolidate.

    Synthesis rules:
    - Dedupe findings by (file:line:finding_class). When the same finding appears in multiple
      lanes (cross-cutting concern), keep the most specific one and cite all source lanes.
    - Reconcile severity using the rubric at <rubric_path> (Read it BEFORE reconciling
      severities) when lanes disagree — promote to the higher severity when evidence supports it.
    - Preserve EVERY Critical finding. Important and Minor may be deduped but never silently
      dropped — when you drop one, note it in the per-lane provenance.
    - NO merged 0-100 score: review.json carries "score": null + "lane_scores": [{id,
      community, score, verdict, findings_contributed}]; the review.md headline is verdict +
      severity counts + the per-lane score distribution. A consolidated deduction score
      saturates at the 0 floor and misleads any consumer that trusts it.
      Each lane_scores[].score is COPIED from that lane's own review-lane-<id>.json::score —
      never re-derived here. A lane that could not read the rubric reports "score": null with
      a "score_null_reason"; carry both through rather than filling the gap with a number of
      your own, and read the distribution as a coverage signal: one null beside three real
      scores means that lane's grade is not comparable with the others.
    - review.json MUST carry the routing fields: "status" ("DONE" | "PARTIAL" | "BLOCKED") and
      "verdict" — status absent fails the sidecar consistency check on every later state update.
      When any lane_scores[].score is null, add "lane_scores_null_reason" (one line: why lanes
      could not self-score) — a silent all-null distribution reads as a working feature.
    - review.json MUST carry "severity_counts" under EXACTLY that name:
        "severity_counts": {"critical":N,"important":N,"minor":N,"nit":N}
      These are the consolidated (post-dedupe) totals. Do NOT rename it — not
      "consolidated_severity_counts", not any other variant, however well the alternative reads
      in context. The consolidation reader looks up this exact key, and a renamed field reads as
      an absent one: the totals come back {0,0,0,0} and the review reports no findings it found.
    - review.json MUST carry "findings" — an array of EVERY kept finding, under exactly that
      name:
        "findings": [{"id":"<id>","severity":"critical|important|minor|nit","file":"<path>"}]
      COMPLETE, not a top-N. This array is the index the narrative guard checks review.md
      against, so a truncated array silently shrinks what gets verified. If you also want a
      highlights list, add it under a DIFFERENT name beside this one — never in place of it.
    - Finding ids: pick any scheme you like, but each finding's `id` MUST appear VERBATIM in its
      own heading in review.md (e.g. `### L3:I-1 · Important · <title>`). Inline references
      elsewhere in the prose stay free-form — write `I-1` or `M-5` bare inside a lane's own
      section if that reads better. The guard needs exactly one guaranteed match site per
      finding; the heading is it. Without that anchor a review whose ids render one way in JSON
      and another way in prose is reported as having lost every finding it actually kept.
    - MANDATORY provenance header: the FIRST lines of review.md include `Correlation: <your
      correlation_id>` — the consolidator-dispatched gate verifies this id against the render
      stamp, which is what proves review.md came from a dispatched synthesis agent.
    - Group findings by file for the consolidated output.
    - review.json MUST carry "raw_lane_finding_counts" in EXACTLY this shape — a per-lane
      breakdown keyed by lane id, optionally beside a roll-up:
        "raw_lane_finding_counts": {
          "by_lane": {"L1": {"critical":N,"important":N,"minor":N,"nit":N}, "L2": {...}},
          "raw_total": {"critical":N,"important":N,"minor":N,"nit":N}
        }
      `by_lane` is the field that matters: it is checked lane-by-lane against the per-lane
      sidecars, so it is the one number here that can be verified rather than trusted. If you
      supply a roll-up too it must equal the sum of by_lane — a disagreement between your own
      two figures is reported as a defect.
    - Coverage vocabulary — report these SEPARATELY in review.json::coverage; they are four
      different claims and collapsing them is how a review overstates itself:
        "files_assigned"      — declared files that went to some lane
        "files_mentioned"     — files named anywhere in review.md
        "files_with_findings" — files carrying at least one kept finding
        "files_cleared"       — files a lane verified with CONCRETE evidence of why there is
                                nothing to report ("base class is sole owner of X, both callers
                                re-verified"), not a bare "no issues found"
      A clean verification is a finding. When a lane proves a file safe, that proof must reach
      review.md — dropping it silently turns "verified safe" into "not mentioned", and those
      are indistinguishable to every downstream reader. Never report an N-of-M coverage figure
      without saying WHICH of these four N counts.
    - <unassigned_scope> lists declared files that were in NO lane. When it is non-empty you
      MUST NOT report complete coverage: carry the list into review.json::uncovered_scope and
      say so in review.md. Coverage is a claim about the declared scope universe, not about
      the lanes you happened to receive.
    - Add a `## Lane Provenance` section listing each lane's id, community, status, and finding
      count contributed. Lanes with status=deferred contribute zero findings — still list them so
      the reader knows coverage is partial.
    - `<orchestrator_notes>` may carry a `## Verified Negatives` section: hypotheses the
      orchestrator already tested and DISPROVED, with the evidence. Treat each as settled. Do NOT
      re-derive it, do NOT promote a lane finding that contradicts it without new evidence of your
      own, and when a lane raised it anyway, say in the provenance that it was pre-disproved and
      why. These are the cheapest findings in the review — someone already paid to answer them,
      and a consolidator that re-opens them either burns the budget again or ships a phantom
      finding the orchestrator had already refuted.

    Self-grade against the rubric as you write (axes that apply to synthesis: A — every lane
    referenced; B — every kept finding carries file:line + severity + rule ref; C — severity
    calibration after merge; D — Critical remediations remain concrete; H — dispatch warnings
    acknowledged). The verifier will grade against the same rubric — closing these gaps here
    avoids a revision loop.

    Do NOT re-issue lane reviews. Do NOT issue new graph queries (your tool surface has no
    `mcp__*graphify*`; the per-lane reviewers already consumed graph-impact.md). Do NOT promote
    or curate memory — the parallel workflow's `present_findings` step runs lane aggregation
    + knowledge-candidate gating separately.
  </task>
  Write the consolidated review to .devt/state/review.md and the sidecar to .devt/state/review.json
")
<!-- END dispatch:code-reviewer:code_review_parallel -->
```

After the dispatch returns, validate that review.md + review.json exist and pass the substance check on review.md (the consolidator could itself return a stub):

```bash
SUBSTANCE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output .devt/state/review.md)
if echo "$SUBSTANCE" | /usr/bin/grep -qF '"looks_like_stub":true'; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=consolidate status=BLOCKED verdict=FAILED
  REASON=$(echo "$SUBSTANCE" | /usr/bin/grep -oE '"reason":"[^"]*"' || echo '"reason":"unknown"')
  echo "BLOCKED: consolidator returned stub — ${REASON}"
  exit 0
fi
# Did any lane move while synthesis was reading it? Compared against the
# snapshot taken at consolidation entry. Advisory, not a block: the correct
# recovery is to reconcile the affected citations/counts, not to discard a
# review that is otherwise sound.
LANE_STABLE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-lanes-unchanged)
if [ "$(printf '%s\n' "$LANE_STABLE" | jq -r '.ok')" != "true" ]; then
  echo "⚠️  $(printf '%s\n' "$LANE_STABLE" | jq -r '.reason')"
  echo "CAVEAT_REQUIRED=lane-drift"
elif [ "$(printf '%s\n' "$LANE_STABLE" | jq -r '.warn // empty')" = "true" ]; then
  echo "note: $(printf '%s\n' "$LANE_STABLE" | jq -r '.reason')"
fi
# Deterministic severity tally — both sides read review.json, the schema'd
# sidecar. Nothing re-derives severities from the rendered prose: that parser
# read {0,0,0,0} off a review whose sidecar carried 3 critical / 37 important
# and then reported findings as lost. Counts are advisory-compared: the
# consolidator may legitimately dedupe cross-lane duplicates or promote
# severities, so a LOWER consolidated count with an explanation is fine — an
# UNEXPLAINED mismatch is the stop condition.
TALLY=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state lane-severity-tally)
if [ "$(printf '%s\n' "$TALLY" | jq -r '.ok')" != "true" ]; then
  echo "⚠️  severity tally unavailable: $(printf '%s\n' "$TALLY" | jq -r '.reason') — the consolidated review cannot be count-checked. Do NOT report coverage as verified."
else
  CONS_CRIT=$(printf '%s\n' "$TALLY" | jq -r '.consolidated.critical')
  CONS_IMP=$(printf '%s\n' "$TALLY" | jq -r '.consolidated.important')
  LANE_CRIT=$(printf '%s\n' "$TALLY" | jq -r '.lane_declared.critical // empty')
  LANE_IMP=$(printf '%s\n' "$TALLY" | jq -r '.lane_declared.important // empty')
  echo "severity tally: consolidated $(printf '%s\n' "$TALLY" | jq -c '.consolidated') vs lane-declared $(printf '%s\n' "$TALLY" | jq -c '.lane_declared') ($(printf '%s\n' "$TALLY" | jq -r '.findings_listed') findings listed)"
  # Basis matters: lane_sidecars is machine-derived per lane and the
  # consolidator cannot author it; the fallback is the consolidator's own
  # raw_lane_finding_counts, which catches inconsistency but not a drop
  # under-reported to match.
  if [ "$(printf '%s\n' "$TALLY" | jq -r '.basis')" = "consolidator_self_reported_lane_totals" ]; then
    echo "note: no per-lane JSON sidecars found — lane totals are the consolidator's own self-report, so this comparison cannot catch a consistently under-reported drop."
  fi
  XCHECK=$(printf '%s\n' "$TALLY" | jq -r '.cross_check_mismatch // empty')
  if [ -n "$XCHECK" ]; then
    echo "⚠️  lane sidecars disagree with review.json's own lane totals (${XCHECK}) — two independent sources, so one is wrong. STOP and reconcile."
  fi
  # A shape the reader cannot parse is NOT a disagreement. Announcing one was
  # the field failure: perfectly consistent counts produced a full-severity
  # "STOP and reconcile", and a guard that cries wolf on correct artifacts
  # trains the operator to skip it.
  XUNAVAIL=$(printf '%s\n' "$TALLY" | jq -r '.cross_check_unavailable // empty')
  [ -n "$XUNAVAIL" ] && echo "note: cross-check did not run — ${XUNAVAIL}"
  CWARN=$(printf '%s\n' "$TALLY" | jq -r '.consolidated_warning // empty')
  [ -n "$CWARN" ] && echo "⚠️  ${CWARN}"
  # Unreadable severity_counts yields nulls, not zeros, so the comparison below
  # must not run: `[ null -gt 3 ]` is a shell error, and more importantly there
  # is nothing to compare.
  CERR=$(printf '%s\n' "$TALLY" | jq -r '.consolidated.error // empty')
  if [ -n "$CERR" ]; then
    echo "⚠️  consolidated severity counts UNAVAILABLE — ${CERR}. Do NOT report severity totals for this review; fix review.json::severity_counts and re-run."
  elif [ -z "$LANE_CRIT" ]; then
    echo "note: review.json carries no raw_lane_finding_counts — consolidated counts stand unchecked against the lanes."
  elif [ "$CONS_CRIT" -gt "$LANE_CRIT" ] || [ "$CONS_IMP" -gt "$LANE_IMP" ]; then
    echo "⚠️  consolidated counts EXCEED the review's own lane totals (crit ${CONS_CRIT}>${LANE_CRIT} or imp ${CONS_IMP}>${LANE_IMP}) — the sidecar contradicts itself. STOP and reconcile."
  elif [ "$CONS_CRIT" -lt "$LANE_CRIT" ] || [ "$CONS_IMP" -lt "$LANE_IMP" ]; then
    echo "note: consolidated counts below lane totals (crit ${CONS_CRIT}/${LANE_CRIT}, imp ${CONS_IMP}/${LANE_IMP}) — verify review.md explains the delta (cross-lane dedupe / severity promotion); an unexplained drop is a lost finding."
  fi
  # Narrative guard: a finding the sidecar declares but the rendered review never
  # names is a finding the reader will never see.
  GUARD=$(printf '%s\n' "$TALLY" | jq -r '.narrative_guard // "evaluated"')
  MISSING=$(printf '%s\n' "$TALLY" | jq -r '(.ids_missing_from_review // []) | join(", ")')
  if [ "$GUARD" != "evaluated" ]; then
    echo "⚠️  narrative guard did NOT run — ${GUARD}"
    echo "CAVEAT_REQUIRED=narrative-guard"
  elif [ -n "$MISSING" ]; then
    echo "⚠️  ${MISSING} — declared in review.json but absent from review.md. The narrative dropped a finding the sidecar counts. STOP and reconcile."
  fi
fi

node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=consolidate status=DONE
```

**If the block printed `CAVEAT_REQUIRED=narrative-guard`, edit `review.md` now** — append the caveat to its `## Verdict` section, verbatim:

> **Coverage caveat:** the narrative guard did not run for this review (`review.json` declares no `findings[]` index), so nothing verified that every counted finding actually appears in the text below. Severity totals are still machine-derived from the lane sidecars.

A guard that cannot evaluate must say so **where the review is read**, not only in orchestration output. The field case printed `findings_listed: 0` inside a dense JSON line and the operator nearly skipped past it — an unevaluable guard whose silence is indistinguishable from a pass is the failure this whole surface exists to prevent.

</step>

<!-- SHARED-STEP:verify — step body relocated to workflows/code-review.steps.md (single source shared by code-review.md and code-review-parallel.md; the copy-paste KEEP-IN-SYNC era let the two bodies drift apart, including silently lost gates). **Mandatory action: Read `${CLAUDE_PLUGIN_ROOT}/workflows/code-review.steps.md` now** (skip the Read if the file is already loaded in this session), then execute its `verify` step at THIS pipeline position with MODE=parallel — blocks marked for the other mode are skipped; unmarked blocks always execute. -->

<!-- SHARED-STEP:auto_curator — step body relocated to workflows/code-review.steps.md (single source shared by code-review.md and code-review-parallel.md; the parallel path previously had NO auto_curator step while the shared present_findings gate demanded its artifact — field-reported as a hand-run workaround). **Mandatory action: Read `${CLAUDE_PLUGIN_ROOT}/workflows/code-review.steps.md` now** (skip the Read if the file is already loaded in this session), then execute its `auto_curator` step at THIS pipeline position with MODE=parallel — blocks marked for the other mode are skipped; unmarked blocks always execute. -->

<!-- SHARED-STEP:present_findings — step body relocated to workflows/code-review.steps.md (single source shared by code-review.md and code-review-parallel.md; the copy-paste KEEP-IN-SYNC era let the two bodies drift apart, including silently lost gates). **Mandatory action: Read `${CLAUDE_PLUGIN_ROOT}/workflows/code-review.steps.md` now** (skip the Read if the file is already loaded in this session), then execute its `present_findings` step at THIS pipeline position with MODE=parallel — blocks marked for the other mode are skipped; unmarked blocks always execute. -->
