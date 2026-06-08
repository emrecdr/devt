# Code Review Workflow

Standalone code review: READ-ONLY analysis with findings and recommendations. No edits or writes to project code.

---

<prerequisites>
- `.devt/config.json` exists in project root (run `/init` first if not)
- `.devt/rules/` directory exists with project conventions
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>
The following agent type is used in this workflow:

- `devt:code-reviewer` — code review specialist, READ-ONLY (Read, Bash, Glob, Grep)

Not used in this workflow:

- `devt:programmer` — implementation specialist
- `devt:tester` — testing specialist
- `devt:architect` — structural review specialist
- `devt:docs-writer` — documentation specialist
- `devt:retro` — lesson extraction specialist
- `devt:curator` — playbook quality maintenance specialist
  </available_agent_types>

<agent_skill_injection>
Before dispatching the code-reviewer agent, check `.devt/config.json` for an `agent_skills` configuration block:

```json
{
  "agent_skills": {
    "code-reviewer": ["code-review-guide"]
  }
}
```

If `agent_skills.code-reviewer` exists, inject the skill references into the agent's prompt context:

```
<agent_skills>
  Load and follow these skill protocols before starting work:
  - ${CLAUDE_PLUGIN_ROOT}/skills/<skill_name>/  (for each skill listed)
</agent_skills>
```

If not configured, omit the block.
</agent_skill_injection>

---

## Steps

<step name="context_init" gate="compound init succeeds">

> Context_init runs 8 substeps in order — bash + assert blocks under each. Substep markers are navigation anchors; the orchestrator must execute every block in sequence regardless of how they're labelled. KEEP IN SYNC with dev-workflow.md::context_init.

### Substep 1: Compound init + project context

Initialize the workflow (read-only — do NOT reset .devt/state/ as it may contain artifacts from a prior workflow that this review depends on):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init review
```

Load project context:

- Read `.devt/rules/coding-standards.md`
- Read `.devt/rules/architecture.md`
- Read `.devt/rules/quality-gates.md`
- Read `CLAUDE.md` if it exists

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=code_review phase=context_init status=DONE stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null "task=${REVIEW_SCOPE}"
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "${REVIEW_SCOPE}"
```

The second call auto-fires the **Topic Pre-Flight Brief** for the review scope. The reviewer reads `.devt/state/preflight-brief.md` so the review checklist gains "alignment with governing ADRs/Concepts" and "no proposed changes that match a REJ tombstone" — high-leverage code-review items that are otherwise easy to miss. Skip silently on failure.

### Substep 2: Compute memory_signal (cached for downstream dispatches)

**Compute the memory signal once and cache it for downstream dispatches.** The same `memory query --signal=3` aggregate keyed on the review scope is consumed by both the code-reviewer and verifier dispatches — compute once here, cache in `workflow.yaml`, read back in each orchestrator-prep step below:

```bash
MEMORY_SIGNAL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory query "${REVIEW_SCOPE}" --signal=3 --json-compact 2>/dev/null || echo '{}')
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update memory_signal_json="${MEMORY_SIGNAL}"
```

### Substep 3: Cache scope_hint + scope_trust

**Cache the scope hint** for `<scope_hint>` injection. `preflight generate` writes `preflight-brief.json` alongside the markdown; its `suggested_reading` field is the deduped union of governing docs' `affects_paths` plus blast-radius `direct_dependents`, capped at 8:

```bash
# Single CLI call replaces the prior 4-jq + conditional + state-update chain.
# Reads preflight-brief.json, computes scope_hint + scope_trust, applies the
# mechanical staleness override (forces trust='sparse' + writes
# staleness-suppressed.txt when state=ready AND lag exceeds graphify.stale_threshold
# or is null), and persists both JSON blobs to workflow.yaml.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight scope-cache
```

**Cache god_node_warnings (C-I.1)** for `<god_node_warnings>` injection. Extracts the structured god-node data already computed in `preflight-brief.json` — `god_nodes[]` array carries `{symbol, edge_count, source_file}` per entry, plus the boolean `blast.god_node_match`. Cached once so the dispatch block stays byte-stable across iterations:

```bash
GOD_NODE_WARNINGS=$(jq -c '{
  god_node_match: (.blast.god_node_match // false),
  matches: (.god_nodes // []),
  ambiguous: (.blast.ambiguous_details // [])
}' .devt/state/preflight-brief.json 2>/dev/null || echo '{"god_node_match":false,"matches":[],"ambiguous":[]}')
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update god_node_warnings_json="${GOD_NODE_WARNINGS}"
```

When `god_node_match=true`, the agent sees a structured warning ("you're about to edit `<symbol>` — it has `<edge_count>` callers") instead of having to parse the markdown brief. Empty `matches: []` with `god_node_match: false` is the no-warning baseline.

### Substep 4: Staleness gate + Graphify eviction

**Staleness gate** — If `preflight-brief.json::staleness.lag_commits > graphify.stale_threshold` (default 30) OR (`graph_stats.state` is `ready` AND `staleness.lag_commits` is `null`), prompt the user via AskUserQuestion BEFORE the impact-map fetch and any agent dispatch: question "Graphify graph is {lag_commits ?? 'unknown'} commits behind HEAD; review may miss recent caller-set changes. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue dispatch with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed. Skip only when graphify is disabled — a null `lag_commits` while `state=ready` (e.g., unreachable SHA, shallow clone) now triggers the prompt instead of silently disabling the gate.

**Evict any stale Graphify artifacts before regeneration.** A prior session's `graph-impact.md` or `graphify-skip-reason.txt` would otherwise look current and silently mask whether the orchestrator actually ran the plan this session. Targeted — never touches `impl-summary.md`, `test-summary.md`, etc. that the review may legitimately consume from a prior workflow phase. The CLI is the single source of truth for the eviction set (also used by `dev-workflow`, `quick-implement`, `debug`, `research-task`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state evict-graphify
```

**Arch-scan freshness advisory.** Check whether an arch-scan-report.md is available and how recent it is. Advisory-only by default — surfaces a `[STALE-ARCH-SCAN]` sentinel if the report is older than 24h so the reviewer can decide whether to refresh before reviewing structural changes. Closes the cal #19 §9 Surprise 3 pattern (state subcommands available but not wired into workflows):

```bash
ARCH_FRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-arch-scan-fresh --max-age-hours=24 2>/dev/null || echo '{}')
if [ "$(echo "$ARCH_FRESH" | jq -r '.warn // false')" = "true" ]; then
  echo "[STALE-ARCH-SCAN] $(echo "$ARCH_FRESH" | jq -r '.reason')"
fi
if [ "$(echo "$ARCH_FRESH" | jq -r '.ok // false')" != "true" ]; then
  echo "[ARCH-SCAN-MISSING] $(echo "$ARCH_FRESH" | jq -r '.reason')"
fi
```

If the diff under review touches files that arch-scan has flagged (cross-reference arch-scan-report.md::findings vs the review's `scope_files`), surface the overlap explicitly to the reviewer — known architectural drift in the review's scope is a strong signal worth elevating.

### Substep 5: Compute the Graphify impact-plan

**Compute the Graphify impact-map plan.** This bash step decides which tier the orchestrator MUST execute next. It writes `.devt/state/graphify-impact-plan.json` carrying `{tier, tool, args, skip_reason?}`. The orchestrator then has ONE imperative instruction below — no "run the first matching" prose to skip past.

```bash
GIT_PROVIDER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get git.provider 2>/dev/null | jq -r '.value // ""')
PR_NUM=$(echo "${REVIEW_SCOPE}" | grep -oE '(PR|pull request) ?#?[0-9]+' | grep -oE '[0-9]+' | head -1)
GRAPHIFY_STATE=$(jq -r '.graph_stats.state // "not_ready"' .devt/state/preflight-brief.json 2>/dev/null || echo "not_ready")
GRAPHIFY_TRUST=$(jq -r '.graph_stats.trust // "empty"' .devt/state/preflight-brief.json 2>/dev/null || echo "empty")
TOPIC_SYMBOLS_RAW=$(jq -c '.topic.symbols // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
TOPIC_SYMBOLS_RAW_COUNT=$(echo "$TOPIC_SYMBOLS_RAW" | jq 'length')
# Pre-truncate to the MCP blast_radius cap (32). Preflight orders symbols by
# relevance (governing-doc anchors first, then diff symbols, then prose), so
# slicing the first 32 preserves that ranking. Field rationale (greenfield
# 2026-05-27 PR #372 P2): the prior contract said "Use args VERBATIM" but
# topic.symbols can exceed 32, making the contract mechanically unimplementable.
# Truncating in the bash that WRITES the plan makes VERBATIM tractable.
TOPIC_SYMBOLS=$(echo "$TOPIC_SYMBOLS_RAW" | jq -c '.[:32]')
TOPIC_SYMBOLS_COUNT=$(echo "$TOPIC_SYMBOLS" | jq 'length')
if [ "$TOPIC_SYMBOLS_RAW_COUNT" -gt 32 ]; then
  echo "topic.symbols pre-truncated: ${TOPIC_SYMBOLS_RAW_COUNT} → 32 (MCP blast_radius cap)"
  # C7-2 (greenfield calibration #7): capture the dropped symbols so the
  # truncation isn't silent. Greenfield's NettieCalendarClientSetting was
  # in the dropped 21 from a 53-symbol PR and the absence directly affected
  # C-2's structural risk assessment. Sidecar is consumed by substep 7's
  # F17 step which appends a "## Subject symbols dropped" notice to
  # graph-impact.md (which doesn't exist yet at this point — substep 6
  # writes it fresh). Reviewers can spot-check whether high-risk symbols
  # were silently excluded from the impact analysis.
  echo "$TOPIC_SYMBOLS_RAW" | jq -c '.[32:]' > .devt/state/topic-symbols-dropped.json
else
  # Clear any stale dropped-list from a prior workflow so substep 7 doesn't
  # emit a stale truncation notice on a fresh non-truncated run.
  rm -f .devt/state/topic-symbols-dropped.json 2>/dev/null || true
fi
SCOPE_FILE_COUNT=$(wc -l < .devt/state/code-review-input.md 2>/dev/null | tr -d ' ' || echo 0)
IMPACT_THRESHOLD=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get graphify.impact_threshold 2>/dev/null | jq -r '.value // 10')

# Decision tree — explicit, no implicit fallbacks. The recommended tier is the
# first one whose preconditions all hold. Bitbucket projects skip PR-scoped
# because the upstream mcp__graphify__get_pr_impact tool is GitHub-only and
# returns "PR not found on GitHub" — the workflow would waste a call.
if [ "$GRAPHIFY_STATE" != "ready" ]; then
  TIER="skip"; SKIP_REASON="graphify state=$GRAPHIFY_STATE"; TOOL=""; ARGS_JSON='{}'
elif [ -n "$PR_NUM" ] && [ "$GIT_PROVIDER" = "github" ]; then
  TIER="pr_scoped"; SKIP_REASON=""; TOOL="mcp__graphify__get_pr_impact"; ARGS_JSON="$(jq -nc --arg n "$PR_NUM" '{pr_number: ($n|tonumber)}')"
elif [ "$TOPIC_SYMBOLS_COUNT" -gt 0 ]; then
  TIER="symbol_anchored"; SKIP_REASON=""; TOOL="mcp__plugin_devt_devt-graphify__blast_radius"; ARGS_JSON="$(jq -nc --argjson s "$TOPIC_SYMBOLS" '{symbols: $s}')"
elif [ "$SCOPE_FILE_COUNT" -ge "$IMPACT_THRESHOLD" ] && [ "$GRAPHIFY_TRUST" = "dense" ]; then
  # B-XI: prefer symbol_anchored driven from diff-file symbols over bulk_scoped
  # text-search. Greenfield calibration #3 finding #4: for bitbucket + dense +
  # >10 files, query_graph(text=REVIEW_SCOPE) returns keyword hits that don't
  # reflect the call graph. blast_radius with symbols whose source_file is in
  # the diff produces actual structural impact. Falls back to legacy bulk_scoped
  # only when no symbols can be extracted from the diff files (graph too sparse,
  # diff is all new files not yet indexed, etc.).
  DIFF_FILES=$(git diff --name-only "${PRIMARY_BRANCH:-main}...HEAD" 2>/dev/null | tr '\n' ' ')
  DIFF_SYMBOLS_JSON='[]'
  if [ -n "$DIFF_FILES" ]; then
    DIFF_SYMBOLS_JSON=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify symbols-in-files $DIFF_FILES --limit=10 2>/dev/null | jq -c '[.[].symbol]' 2>/dev/null || echo '[]')
  fi
  DIFF_SYMBOL_COUNT=$(echo "$DIFF_SYMBOLS_JSON" | jq 'length')
  if [ "$DIFF_SYMBOL_COUNT" -gt 0 ]; then
    TIER="symbol_anchored"; SKIP_REASON=""; TOOL="mcp__plugin_devt_devt-graphify__blast_radius"; ARGS_JSON="$(jq -nc --argjson s "$DIFF_SYMBOLS_JSON" '{symbols: $s}')"
  else
    TIER="bulk_scoped"; SKIP_REASON=""; TOOL="mcp__plugin_devt_devt-graphify__query_graph"; ARGS_JSON="$(jq -nc --arg t "$REVIEW_SCOPE" '{text: $t, limit: 20}')"
  fi
else
  TIER="skip"; SKIP_REASON="no PR (or non-GitHub), no topic symbols, scope below threshold"; TOOL=""; ARGS_JSON='{}'
fi

jq -nc --arg tier "$TIER" --arg tool "$TOOL" --arg skip_reason "$SKIP_REASON" --arg provider "$GIT_PROVIDER" --argjson args "$ARGS_JSON" \
  '{tier: $tier, tool: $tool, args: $args, skip_reason: $skip_reason, git_provider: $provider}' \
  > .devt/state/graphify-impact-plan.json
echo "graphify_impact_plan: tier=$TIER tool=$TOOL provider=$GIT_PROVIDER"
```

### Substep 6: Execute the impact-plan + F16 multi-tier drill-down

**EXECUTE THE PLAN.** Read `.devt/state/graphify-impact-plan.json`. This is not optional and not a "consider running it" — the next step gates on the output existing:

**ARGS CONTRACT** — the `args` field in `graphify-impact-plan.json` is the single source of truth for what gets passed to the MCP tool. Use it VERBATIM. Do NOT substitute symbols, narrow the list, "pick anchors", or improvise an alternative parameter set — those changes are unauditable and were field-observed (greenfield PR-369, 2026-05-21) to degrade tier signal. If the args look wrong, fix the bash that wrote them; do not override at the call site.

- If `tier == "skip"`: write `.devt/state/graphify-skip-reason.txt` containing the `skip_reason` field verbatim. Do NOT call any MCP tool. The reviewer falls back to `<scope_hint>` plus raw file list and graph-impact analysis is correctly absent.
- If `tier == "pr_scoped"`: call `mcp__graphify__get_pr_impact(args)` using the `args` object from the plan VERBATIM. **For Bitbucket projects this tier never fires** — the bash step routed past it. If the call errors (e.g. PR not found because the user-installed graphify MCP cannot reach the repo), fall back: write `graphify-skip-reason.txt` with the error and continue. Otherwise write the response verbatim to `.devt/state/graph-impact.md`.
- If `tier == "bulk_scoped"`: call `mcp__plugin_devt_devt-graphify__query_graph(args)` using the `args` object from the plan VERBATIM. From the response's top-5 nodes (highest degree), call `mcp__plugin_devt_devt-graphify__get_neighbors({symbol: <label>, direction: "in", depth: 2})` for each. Concatenate into `graph-impact.md` with one `## <symbol>` heading per block.
- If `tier == "symbol_anchored"`: call `mcp__plugin_devt_devt-graphify__blast_radius(args)` using the `args` object from the plan VERBATIM — the `symbols` array is computed from the diff in the bash step above; do not re-pick. Write the response verbatim to `graph-impact.md`.

**F16 — Multi-tier follow-up (post-impact-plan drill-down).** When the tier executed was `symbol_anchored` or `bulk_scoped` AND the response carries a `direct_dependents` or top-degree-nodes array, **also** call `mcp__plugin_devt_devt-graphify__get_neighbors({symbol: "<DEP>", direction: "in", depth: 2})` for the top-3 dependents from the response, ranked by `in_count` field if present (depth-1 incoming edges), else by `edge_count`, else by position in the response array. When the response has fewer than 3 dependents, drill on however many exist (skip the F16 step entirely if 0). Append each as a `## Drill-down: <DEP> [call: <correlation_id>]` section to `graph-impact.md` — the correlation_id is the `_meta.correlation_id` field returned by the MCP call's response envelope (8-char hex), and downstream lane reviewers can cite it via `mcp-stats --correlation-id=<id>` to trace findings back to the specific call. When the response envelope lacks `_meta.correlation_id` (older MCP servers), omit the `[call: ...]` suffix rather than blocking. Field rationale (greenfield 2026-05-26 PR #370): one blast_radius call alone left 5 lane subagents grep-hunting for caller sets that 3 cheap MCP calls would have surfaced. Args-VERBATIM contract still applies to the original tier call; the drill-down args are derived from the tier response, not from the impact-plan.json.

**Empty drill-down handling**: when `get_neighbors` returns `results: []` for a top-3 dependent (e.g., a module-level container where callers are dynamically dispatched), record the empty result as `## Drill-down: <SYM> (empty — dynamic dispatch suspected) [call: <correlation_id>]` and substitute the next-ranked dependent in the cap-3 slot. Bounded: try up to 5 ranked dependents before giving up on completing the top-3.

**God-node oversize handling (NEW-5)**: when a top-3 dependent matches a `god_node_match=true` signal from the parent `blast_radius` response — typically a class with hundreds of incoming edges — the upstream MCP `get_neighbors(symbol, direction="in", depth=2)` response can overflow the MCP transport's response-size cap, returning zero usable data. Greenfield calibration #5 hit this on AuditMapping (84KB overflow → empty response). When this happens, fall back to the devt CLI wrapper which supports `--max-bytes` truncation: `node bin/devt-tools.cjs graphify neighbors <symbol> --direction=in --depth=2 --max-bytes=60000`. The CLI sorts results depth-ascending + label-alphabetical and truncates deterministically, returning `truncated: true` + `total_neighbors` so the heading can record the partial nature: `## Drill-down: <SYM> (truncated — depth-2 incoming exceeded 60KB; first <N> of <total>) [via CLI fallback]`.

**Substance threshold on drill-down sections.** `assert-graphify-decision` doesn't check "was the MCP tool called?" — it checks "is each drill-down section dense enough to be useful?" The gate uses a substance-byte-threshold heuristic per `## Drill-down:` block (currently 200 bytes minimum after stripping headings). Field signal (greenfield cal #19 Surprise 1): a 57-byte GDPR drill-down was caught and failed the gate even though the MCP call succeeded — the section was thin because the topic extraction returned a generic concept (`GDPR`) that didn't map to a single useful subgraph. **If the gate fails with reason `drill-down section below substance threshold`**: re-derive the drill-down symbol from the impact-plan's `args.symbols` (NOT from topic keywords) so each section anchors on a real graph node with real dependents to enumerate. The gate is by design about output usefulness, not call presence.

### Substep 7: F17 deterministic god-node check

**F17 — God-node auto-check on diff files.** After the tier executes (or even when it skipped), run a deterministic CPU-local check that catches god-nodes the symbol-anchored anchor list missed. The CLI maps each diff file back to graph nodes via `source_file` metadata and reports the max-degree symbol per file:

```bash
DIFF_FILES=$(git diff --name-only ${PRIMARY_BRANCH:-main}...HEAD 2>/dev/null | tr '\n' ' ')
if [ -n "$DIFF_FILES" ]; then
  GODNODE_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify check-large-files $DIFF_FILES --edge-threshold=50 2>/dev/null || echo '[]')
  GOD_COUNT=$(echo "$GODNODE_CHECK" | jq '[.[] | select(.is_god_node)] | length')
  if [ "$GOD_COUNT" != "0" ] && [ "$GOD_COUNT" != "" ]; then
    {
      echo ""
      echo "## God-node warning"
      echo ""
      echo "$GODNODE_CHECK" | jq -r '.[] | select(.is_god_node) | "- `\(.file)` — `\(.top_symbol)` has \(.max_edges) edges; signature changes ripple to all callers. Prefer additive changes."'
    } >> .devt/state/graph-impact.md
  fi
  SYMBOL_GODNODES=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify check-symbol-godnodes $DIFF_FILES --edge-threshold=50 2>/dev/null || echo '[]')
  SYM_COUNT=$(echo "$SYMBOL_GODNODES" | jq 'length')
  if [ "$SYM_COUNT" != "0" ] && [ "$SYM_COUNT" != "" ]; then
    {
      echo ""
      echo "## Symbol-level god-nodes"
      echo ""
      echo "$SYMBOL_GODNODES" | jq -r '.[] | "- `\(.symbol)` (\(.source_file)) has \(.edge_count) edges; any non-additive change cascades through every caller."'
    } >> .devt/state/graph-impact.md
  fi
  # C7-2 (greenfield calibration #7): emit dropped-symbol truncation notice
  # if substep 5 captured one. Reviewers see exactly which symbols were
  # excluded from the symbol_anchored args so they can spot-check whether
  # high-risk symbols are missing (greenfield's NettieCalendarClientSetting
  # case). Section is informational — does not change tier routing or
  # downstream gates. Cleared by substep 5's `rm -f` on non-truncated runs.
  if [ -s ".devt/state/topic-symbols-dropped.json" ]; then
    DROPPED_COUNT=$(jq 'length' .devt/state/topic-symbols-dropped.json 2>/dev/null || echo 0)
    if [ "$DROPPED_COUNT" != "0" ] && [ "$DROPPED_COUNT" != "" ]; then
      {
        echo ""
        echo "## Subject symbols dropped (truncation notice — C7-2)"
        echo ""
        echo "_${DROPPED_COUNT} of the ${TOPIC_SYMBOLS_RAW_COUNT:-?} extracted topic symbols were truncated by the MCP blast_radius 32-symbol cap. Listed below in original preflight ranking order. Spot-check for any high-risk symbols whose absence may affect severity calibration._"
        echo ""
        jq -r '.[] | "- \(.)"' .devt/state/topic-symbols-dropped.json
      } >> .devt/state/graph-impact.md
    fi
  fi
  # v0.73 WI-5 (greenfield cal #18 assessment #3): surface partial-coverage
  # hyperedges. Preflight computes hyperedges_matched with completeness ratio
  # but the data never reached the code-reviewer prompt — greenfield's
  # license_update_rights_flow at 14% (1/7 RBAC members in scope) was lost.
  # Reviewers see the gap inline now: "task scope covers N/M members; consider
  # expanding OR explicitly defer remaining in your verdict".
  HYPER_PARTIAL=$(jq -c '[.hyperedges_matched[]? | select(.completeness < 1.0)]' .devt/state/preflight-brief.json 2>/dev/null || echo "[]")
  HYPER_PARTIAL_COUNT=$(echo "$HYPER_PARTIAL" | jq 'length' 2>/dev/null || echo 0)
  if [ "$HYPER_PARTIAL_COUNT" != "0" ] && [ "$HYPER_PARTIAL_COUNT" != "" ]; then
    {
      echo ""
      echo "## Hyperedge completeness (partial-coverage semantic groupings)"
      echo ""
      echo "_${HYPER_PARTIAL_COUNT} graphify-discovered semantic grouping(s) below 100% completeness. Members outside the current scope may indicate forgotten changes (related route/repo/migration/test/doc). Review whether scope should expand OR explicitly defer the missing members in your verdict._"
      echo ""
      echo "$HYPER_PARTIAL" | jq -r '.[] | "- **\(.label)** — \((.members_in_scope | length)) of \(.member_count) members in scope (\(((.completeness // 0) * 100) | floor)% complete). Out-of-scope members: \(.members - .members_in_scope | join(\", \"))"'
    } >> .devt/state/graph-impact.md
  fi
  # C7-3+C7-6 (greenfield calibration #4 + #7): when blast_radius reports
  # ambiguous_bindings > 0, emit the colliding symbols with their source_file
  # so reviewers know which module each finding's symbol refers to. Greenfield
  # session: two ExternalCallService modules (Nettie vs Vicasa legacy)
  # collided unflagged → manual cross-check per finding. The persisted
  # ambiguous_details (HF-3 + this commit) carries the data once; emit here
  # so it travels into graph-impact.md alongside the god-node sections.
  AMB_COUNT=$(jq '.blast.ambiguous_bindings // 0' .devt/state/preflight-brief.json 2>/dev/null || echo 0)
  if [ "$AMB_COUNT" != "0" ] && [ "$AMB_COUNT" != "" ] && [ "$AMB_COUNT" != "null" ]; then
    {
      echo ""
      echo "## Ambiguous bindings (C7-3)"
      echo ""
      echo "_${AMB_COUNT} symbol(s) resolve to multiple definition sites — reviewers should cite the module path explicitly when a finding references one of these symbols. Greenfield calibration evidence: two ExternalCall* modules collided unflagged across calibrations #4 + #7._"
      echo ""
      jq -r '.blast.ambiguous_details // [] | .[] | "- `\(.symbol)` → resolves at `\(.node.source_file // "(no source_file)")` (label: `\(.node.label)`)"' .devt/state/preflight-brief.json 2>/dev/null
    } >> .devt/state/graph-impact.md
  fi
  # C7-1 (greenfield calibration #7): F17's diff-anchored CLIs are silent
  # when the diff touches CALLERS but not symbol-definition sites. Greenfield's
  # most-common PR pattern is exactly that — changes in app/services/ reference
  # symbols defined in app/core/, neither CLI fires. Fall back to preflight's
  # graph-global god_nodes[] (already cached in preflight-brief.json) so the
  # signal still reaches the dispatch context. Section is explicitly labelled
  # "from preflight, not diff-anchored" so reviewers know the scope.
  if [ "${GOD_COUNT:-0}" = "0" ] && [ "${SYM_COUNT:-0}" = "0" ]; then
    PREFLIGHT_GODS=$(jq -c '.god_nodes // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
    PG_COUNT=$(echo "$PREFLIGHT_GODS" | jq 'length')
    if [ "$PG_COUNT" != "0" ] && [ "$PG_COUNT" != "" ]; then
      {
        echo ""
        echo "## Symbol-level god-nodes (from preflight, not diff-anchored)"
        echo ""
        echo "_File-level + symbol-level diff CLIs returned 0 — surfacing graph-global top god-nodes from preflight.god_nodes so severity calibration has structural signal. These symbols may not be in the diff; weight findings that touch them or their callers higher because changes ripple to many sites._"
        echo ""
        echo "$PREFLIGHT_GODS" | jq -r '.[] | "- `\(.symbol)` has \(.edge_count) edges (graph-wide rank)"'
      } >> .devt/state/graph-impact.md
    fi
  fi
fi
```

Field rationale (greenfield 2026-05-26): `routes.py` at 2,463 LOC was almost certainly a god node, but the symbol-anchored anchor list missed it because the diff's PascalCase symbols (UserStatus, ConsentType) didn't include module-level identifiers from routes.py. The CLI is deterministic (no MCP calls), idempotent, and gracefully no-ops when the graph is missing or the diff is empty.

Symbol-level rationale (greenfield 2026-05-28 calibration #4, graph-impact.md:62 verbatim): *"0 file-level god-nodes in PR #374 diff despite symbol-level god-node match on AuditMapping."* — `check-large-files` aggregates per-file (one max-degree symbol per basename) and missed AuditMapping when SmallHelper happened to be the file's reported top symbol. `check-symbol-godnodes` returns every above-threshold symbol whose `source_file` is in the diff with no per-file collapse, so a high-degree symbol cannot be eclipsed by a same-file sibling.

**Note on signal independence**: four signals now feed the reviewer, all independent:
- `blast_radius::god_node_match` — symbol-aggregated; at least one input symbol matches a god-node in the graph.
- `check-large-files` — file-aggregated; reports the max-degree symbol per diff file.
- `check-symbol-godnodes` — symbol-level; reports every above-threshold symbol whose source_file is in the diff, no per-file aggregation.
- `preflight.god_nodes` fallback (C7-1) — graph-global top god-nodes; only emitted when both diff-anchored CLIs return 0. Provides structural signal for the common pattern where the diff touches callers, not definition sites.

Any of the four can fire while the others stay silent — surface all four verbatim in the reviewer dispatch context. The fallback is mutually exclusive with the diff-anchored CLIs (only emits when they both go silent).

After this step, **EXACTLY ONE** of `graph-impact.md` or `graphify-skip-reason.txt` MUST exist. Enforced by a hard process gate — not prose:

```bash
PFRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-preflight-fresh)
if [ "$(echo "$PFRESH" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: preflight-brief is stale — $(echo "$PFRESH" | jq -r '.reason')"
  exit 1
fi
ASSERT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-graphify-decision)
if [ "$(echo "$ASSERT" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: graphify decision artifact missing — $(echo "$ASSERT" | jq -r '.reason')"
  exit 1
fi
```

The assert auto-passes when graphify is disabled or the graph is missing (`graphify_state != "ready"`) — the gate is about orchestrator obedience to the workflow contract, not about graphify being installed.

**Gate**: If compound init fails, STOP with BLOCKED. If `state assert-graphify-decision` returns `ok:false`, STOP with BLOCKED — the orchestrator skipped the EXECUTE THE PLAN step above.

### Substep 8: Decision-artifact gates + claude-mem MCP pre-step

**Orchestrator pre-step (claude-mem MCP) — DECISION-ARTIFACT REQUIRED.** Exactly ONE of `.devt/state/claude-mem-harvest.md` or `.devt/state/claude-mem-skipped.txt` MUST exist after this step. The `state assert-claude-mem-harvest` gate below enforces this — orchestrators that skip silently get caught. Field signal (greenfield 2026-05-27 PR #372): orchestrator self-reported this pre-step as an unconscious skip — not rationalized, not noticed, simply absent from the workflow file.

If `mcp__plugin_claude-mem_mcp-search__search` is registered in this session:
1. Call `mcp__plugin_claude-mem_mcp-search__search` with `query=${REVIEW_SCOPE}`, `project=<current devt project name>`, and `limit=50`. The response is a markdown index with table-row observations (`| #NNNN | time | <emoji> | Title | ~tokens |`) grouped by source file.
2. For each observation row with emoji ⚖️ (decision) or 🔵 (discovery): fetch the body via `mcp__plugin_claude-mem_mcp-search__get_observations({ids: [...]})` — the bare `search` response carries only Title, not body, so without `get_observations` the curator's evidence filter rejects the candidate. Batch IDs into one `get_observations` call for efficiency.
3. Write `.devt/state/claude-mem-harvest.md` with one line each in canonical format:

   ```
   - [decision] <title>: <body>
   - [discovery] <title>: <body>
   ```

If MCP unavailable / zero observations / errors: write `.devt/state/claude-mem-skipped.txt` with the structured payload below. The gate validates the `reason=` enum (`not_installed | mcp_unavailable | corpus_empty | task_unrelated_to_history`) — free-form one-liners are rejected. For `task_unrelated_to_history`, also include a `details=` line explaining the orchestrator's reasoning.

```bash
cat > .devt/state/claude-mem-skipped.txt <<EOF
reason=mcp_unavailable
attempted_at=$(date -u +%FT%TZ)
EOF
```

```bash
HARVEST=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-claude-mem-harvest)
if [ "$(echo "$HARVEST" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: claude-mem decision artifact missing — $(echo "$HARVEST" | jq -r '.reason')"
  exit 1
fi
```

The pre-step is intentionally permissive: a `claude-mem-skipped.txt` with reason satisfies the gate. The point is to make the consideration explicit — silent skips are the failure mode.
</step>

<step name="scope_check" gate="scope size measured + parallel decision made if applicable">

Measure the file count in the review scope. If > 10 files AND graphify is ready, offer the user a choice between single-dispatch (with community-filter fallback) and parallel-lane review.

```bash
SCOPE_FILE_COUNT=$(wc -l < .devt/state/code-review-input.md 2>/dev/null | tr -d ' ' || echo 0)
GRAPHIFY_STATE=$(jq -r '.graph_stats.state // "not_ready"' .devt/state/preflight-brief.json 2>/dev/null || echo "not_ready")
echo "scope_check: file_count=${SCOPE_FILE_COUNT}, graphify_state=${GRAPHIFY_STATE}"

if [ "${SCOPE_FILE_COUNT:-0}" -gt 10 ] && [ "${GRAPHIFY_STATE:-not_ready}" = "ready" ]; then
  echo "scope=${SCOPE_FILE_COUNT} graphify=ready" > .devt/state/scope-check-required.txt
fi
```

If `SCOPE_FILE_COUNT ≤ 10` OR `GRAPHIFY_STATE != "ready"`: skip the AskUserQuestion and continue to identify_scope (single-dispatch path). The community-filter is the canonical fallback when scope creeps past 10 files without graphify.

If `SCOPE_FILE_COUNT > 10` AND `GRAPHIFY_STATE == "ready"`: ask the user:

```yaml
question: "Review scope is {SCOPE_FILE_COUNT} files. Split into parallel lanes (one reviewer per graphify community, capped at 5)?"
header: "Parallel Review"
multiSelect: false
options:
  - label: "Yes — parallel lanes (recommended for >15 files)"
    description: "Foreground multi-Task dispatch by community; substance-gated per lane; consolidated into single review.md"
  - label: "No — single dispatch with community-filter"
    description: "One reviewer; deep review restricted to affected_communities; rest deferred"
```

**After the user answers, write the choice to `.devt/state/scope-check-answer.txt`** — this is the mechanical signal that satisfies `state assert-scope-check-handled` (the gate at the start of the next step). The answer must be one of: `parallel`, `single`, `cancel`. Example:

```bash
echo "${USER_CHOICE}" > .devt/state/scope-check-answer.txt
```

If the user chose `cancel`, STOP with BLOCKED. If `parallel`, proceed to the parallel delegation path. If `single`, continue to identify_scope (single-dispatch).

If user picks YES: delegate to `workflows/code-review-parallel.md` by Read-ing that file and following its steps starting from `context_init`. The cached workflow.yaml state (workflow_id, memory_signal, scope_hint, scope_trust) carries over — the parallel workflow re-reads it.

If user picks NO: continue to identify_scope (existing single-dispatch path; the code-reviewer agent's community-filter logic handles scope > 10 files automatically).

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=scope_check status=DONE
```

</step>

<step name="identify_scope" gate="file list is determined">

```bash
SCOPE_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-scope-check-handled)
if echo "$SCOPE_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=scope_check status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$SCOPE_GATE" | jq -r '.reason')"
  exit 0
fi
```

Determine which files to review. Use ONE of these strategies (in priority order):

1. **User-specified files**: If the user provided specific file paths or patterns, use those.
2. **Git diff**: If no files were specified, detect changed files:
   ```bash
   git diff --name-only HEAD~1 2>/dev/null || git diff --name-only --staged 2>/dev/null || echo "NO_DIFF"
   ```
3. **Impl-summary**: If `.devt/state/impl-summary.md` exists from a prior workflow, extract the file list from it.
4. **User prompt**: If none of the above yields results, ask the user which files to review.

Write the file list to `.devt/state/code-review-input.md`:

```markdown
# Review Scope

## Files

- path/to/file1
- path/to/file2

## Source

<how the file list was determined: user-specified / git-diff / impl-summary / user-prompt>
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=identify_scope status=DONE
```

</step>

<step name="review" gate="review.md is written to .devt/state/">

**Orchestrator-prep — read cached memory signal**. Cached at context_init; re-read here so the reviewer can spot REJ-tombstone matches and ADR violations without per-doc round trips:

```bash
# Re-derive scope_trust from current preflight-brief.json so the cached value reflects current graph state, not the value computed at workflow start. Fail-open: stale cache used if no brief.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1 || true
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(echo "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(echo "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(echo "$STATE" | jq -r '.scope_trust_json // "{}"')

# Skip-context injection — when graphify-skip-reason.txt exists, the reviewer
# should know the impact-map is intentionally absent (not "graphify failed").
# Coordination signal: tiny prompt cost, eliminates accidental over-reliance on
# absent graph data. Field-observed: greenfield 2026-05-21 session had tier=skip
# fire silently; reviewers fell back to grep without knowing graphify was the
# wrong tool for the workflow (Bitbucket + stale brief). Explicit signal beats
# implicit file-presence checks.
if [ -f .devt/state/graphify-skip-reason.txt ]; then
  GRAPHIFY_STATUS=$(jq -nc --arg r "$(cat .devt/state/graphify-skip-reason.txt)" '{skipped: true, reason: $r}')
elif [ -f .devt/state/graph-impact.md ]; then
  GRAPHIFY_STATUS='{"skipped":false,"impact_map":".devt/state/graph-impact.md"}'
else
  GRAPHIFY_STATUS='{"skipped":null,"reason":"no decision artifact"}'
fi
```

Substitute into the `<memory_signal>` block below.

Dispatch the code-reviewer agent with the identified file scope:

```
<!-- BEGIN dispatch:code-reviewer:code_review -->
Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="
  <context>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <graphify_status>{graphify_status_json}</graphify_status>
    <god_node_warnings>{god_node_warnings_json}</god_node_warnings>
    <graph_impact>
{graph_impact_content}
</graph_impact>
    <graph_impact_note>The above is orchestrator-mediated MCP output inlined from .devt/state/graph-impact.md — high-signal review map for changed symbols. Your tool surface does not include `mcp__*graphify*`, so consume the inlined data rather than issuing graph queries.</graph_impact_note>
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
    <!-- Inline rubric body from init payload — reviewer self-checks against
         the same axes the verifier will grade, reducing verifier-revision
         loops. Falls back to <rubric_path> on-disk Read when omitted
         (oversized rubric → init returns null inline_rubrics). -->
    <rubric_content>{inline_rubrics.code_review}</rubric_content>
    <review_scope>Read .devt/state/code-review-input.md</review_scope>
    <impl_summary>Read .devt/state/impl-summary.md (if exists)</impl_summary>
    <test_summary>Read .devt/state/test-summary.md (if exists)</test_summary>
    <decisions>Read .devt/state/decisions.md (if exists — from /devt:clarify)</decisions>
    <learning_context>{learning_context — relevant review/quality lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review the following files for quality, correctness, and standards compliance.
    Review ALL code in the listed files — do not filter by origin or label findings as pre-existing.
    Every valid finding must be reported with file, line, severity, and rule reference.

    **Self-grade against the rubric as you write (C7-7).** The same axes the
    verifier will use to grade your review are inlined in <rubric_content> (or
    readable at <rubric_path> as fallback). Walk axes A–G before emitting
    review.md: scope coverage (every input file mentioned), finding specificity
    (file:line + rule ref or pattern citation), severity calibration (no
    Critical-rated nits, no Minor-rated security issues), remediation
    concreteness (Critical/Important findings include a fix direction), ADR
    Compliance section when memory affects-paths returned hits, Reuse
    Discipline section when reuse-candidates.md is non-empty. Closing these
    gaps in your first pass avoids a verifier revision loop.

    Graph-impact map: the orchestrator wrote `.devt/state/graph-impact.md` (or `graphify-skip-reason.txt`)
    during context_init using upstream Graphify MCP. You consume that file READ-ONLY — your tool surface
    does not include `mcp__*graphify*`, so use the data already present rather than issuing graph queries
    yourself. When the impact map lists affected_communities, blast radius, or caller sets for symbols
    touched by your findings, cross-reference them as you write each finding's remediation. Use Grep/Read
    to validate specific code lines that the map points to. When `graphify-skip-reason.txt` exists, no
    graph data is available — proceed with Grep+Read review normally.

    **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing review.md):
    Per your agent body's `knowledge_candidates` step, if this review surfaces non-obvious patterns
    worth promoting to permanent memory (recurring code smell, undocumented invariant, "we always do X
    because Y" rule, REJ-tombstone-worthy anti-pattern), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Skip trivial findings
    or anything already in CLAUDE.md / .devt/rules/. Each tag passes the 5-filter test: specificity,
    durability, non-obviousness, evidence, actionability. Even when none qualify, surface that
    decision in your review.md ("no knowledge candidates emerged — all findings were code-local").
  </task>
  Write review to .devt/state/review.md
")
<!-- END dispatch:code-reviewer:code_review -->
```

**Claim-check (Q11)**: Before advancing phase, mechanically verify the code-reviewer wrote its declared output. Catches the case where the reviewer returned a verbal summary without actually writing review.md.

```bash
ARTIFACT_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present code-reviewer)
if [ "$(echo "$ARTIFACT_CHECK" | jq -r '.ok')" != "true" ]; then
  echo "[BLOCKED] devt: $(echo "$ARTIFACT_CHECK" | jq -r '.reason')"
fi
```

If BLOCKED: code-reviewer did not write review.md. Re-dispatch with explicit instruction, OR SendMessage-resume if a budget wall is suspected. Read the sidecar's `status` (`DONE|PARTIAL|BLOCKED`) — PARTIAL means SendMessage-resume with `<continue_from_section>` set to `sidecar.next_section`; DONE means proceed.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=review status=DONE
```

</step>

<step name="verify" gate="verification.json is written or step is skipped">

_Skip this step if `config.workflow.verification` is `false`._
_Skip this step if `verify` is listed in `skipped_phases` from workflow state._

Grader-driven thoroughness check. The verifier reads `references/rubrics/code_review.v1.md` and spot-checks the review for scope coverage, finding specificity, severity calibration, remediation concreteness, and ADR Compliance section presence. The verifier does NOT re-do the code review — it grades the review's quality and re-dispatches the code-reviewer with structured `revisions[]` when gaps are found.

**Artifact pre-gate**: confirm both `.devt/state/review.md` and `.devt/state/review.json` exist. If either is missing, **STOP with BLOCKED** — verification cannot run without the upstream artifact. The sidecar is the routing source of truth; the markdown is the human-readable view.

**Substance pre-gate (F28)**: even when the file exists, the code-reviewer may have returned a placeholder body (field signal: greenfield 2026-05-26 PR #372 multi-lane fan-out, 5/6 lane dispatches returned `status:completed` with bodies like "Stub written; analysis in progress."). Don't burn a verifier dispatch grading a stub — block here and re-dispatch the reviewer instead:

```bash
SUBSTANCE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output .devt/state/review.md)
if echo "$SUBSTANCE" | jq -e '.looks_like_stub == true' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: review.md looks like a stub — $(echo "$SUBSTANCE" | jq -r '.reason')"
  exit 0
fi
```

When this gate trips, surface the substance reason to the user and recommend `/devt:review` re-dispatch — verifier loop cannot recover from an empty upstream artifact.

**Orchestrator-prep — read cached memory signal**. Cached at context_init; re-read here so the verifier doesn't burn 3–4 per-doc `memory query` round trips on its initial scan:

```bash
# Re-derive scope_trust from current preflight-brief.json so the cached value reflects current graph state, not the value computed at workflow start. Fail-open: stale cache used if no brief.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1 || true
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(echo "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(echo "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(echo "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Substitute the JSON output into the `<memory_signal>` block in the dispatch prompt below. If `.devt/memory/` is empty or the query fails, the fallback `{}` keeps the block well-formed and the agent falls back to fresh queries.

Dispatch the verifier:

```
<!-- BEGIN dispatch:verifier:code_review -->
Task(subagent_type="devt:verifier", model="{models.verifier}", prompt="
  <context>
    <workflow_type>code_review</workflow_type>
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
    <!-- Inline rubric body from init payload — verifier prefers this over the
         on-disk Read at <rubric_path> when present. Falls back to path when
         omitted (oversized rubric → init returns null inline_rubrics). -->
    <rubric_content>{inline_rubrics.code_review}</rubric_content>
    <original_task>{review_scope_description}</original_task>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <god_node_warnings>{god_node_warnings_json}</god_node_warnings>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
    <files_to_read>.devt/state/review.md, .devt/state/code-review-input.md</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md (if exists — code-review may follow an implementation phase)</impl_summary>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Grade the code review against the code_review rubric. You are NOT re-doing the review.
    Spot-check the review's thoroughness, specificity, severity calibration, and remediation
    concreteness using the rubric in <rubric_path>. Read review.md as the artifact under review.
    If axes fail, emit revisions[] keyed by axis-letter (A-1, B-3, etc.) for the reviewer to address.

    Cross-reference the review's remediation against `.devt/state/graph-impact.md` when present.
    The orchestrator wrote that file from upstream Graphify MCP during context_init. When the
    impact map lists high-blast-radius symbols or affected communities for findings the reviewer
    flagged, verify the remediation accounts for caller-set impact — propose a revision when a
    Critical finding ignores a documented structural risk. When `graphify-skip-reason.txt` exists,
    graph data is unavailable and structural-risk cross-checks do not apply.
  </task>
  Write verification to .devt/state/verification.md AND .devt/state/verification.json (sidecar).
")
<!-- END dispatch:verifier:code_review -->
```

**Gate check**: Read the structured sidecar `.devt/state/verification.json` for routing:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read-sidecar verification.json
MAX_ITER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get | jq -r '.workflow.max_iterations // 3')
VITER=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.verify_iteration // 0')
```

Route on `verdict`:

- **`verdict=satisfied`** (status=VERIFIED or DONE_WITH_CONCERNS): proceed to `present_findings`.
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=DONE verdict=VERIFIED
  ```
- **`verdict=needs_revision`** (status=GAPS_FOUND) — apply the **repair operator**:
  - **`VITER < MAX_ITER` → RETRY**: re-dispatch the **code-reviewer** (Step `review`) with each `revisions[].gap` (axis + AC-letter id + evidence) verbatim as `<reviewer_feedback>` in the prompt. Do NOT have the reviewer re-parse the markdown; the structured list is the contract.
    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify verify_iteration=$((VITER+1)) verdict=GAPS_FOUND repair=RETRY
    ```
  - **`VITER >= MAX_ITER` → PRUNE**: stop iterating. Write remaining `revisions[]` to `.devt/state/scratchpad.md` under `## Deferred Review Verification Gaps`. Proceed to `present_findings` with `status=DONE_WITH_CONCERNS` and surface the deferred gaps in the user report.
    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=DONE_WITH_CONCERNS verdict=GAPS_FOUND repair=PRUNE
    ```
- **`verdict=failed`** (status=FAILED) — STOP with BLOCKED. Surface the verifier's failure reason (missing review.md, missing code-review-input.md, REJ tombstone match, or 3+ axes failing simultaneously) to the user. No retry — this is a structural problem requiring human attention.
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  ```

</step>

<step name="auto_curator" gate="curator dispatched if config + threshold + cooldown all permit">

**F6 — Conditional auto-curator.** When `memory.auto_curator_on_review = true` AND `_suggestions.md` has ≥ `memory.auto_curator_min_candidates` (default 3) AND last curator run was ≥ `memory.auto_curator_cooldown_days` (default 7) ago, refresh discovery harvest and fire a curator dispatch. Skipped silently otherwise — default `false` keeps the workflow cost-neutral for users who don't opt in.

Decision logic (bash):

```bash
AUTO_CURATOR_ENABLED=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_on_review 2>/dev/null | jq -r '.value // false')
if [ "$AUTO_CURATOR_ENABLED" = "true" ]; then
  echo "FIRE" > .devt/state/auto-curator-considered.txt
else
  echo "DISABLED" > .devt/state/auto-curator-considered.txt
fi

AUTO=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_on_review 2>/dev/null | jq -r '.value // false')
if [ "$AUTO" = "true" ]; then
  MIN=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_min_candidates 2>/dev/null | jq -r '.value // 3')
  COOLDOWN=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_cooldown_days 2>/dev/null | jq -r '.value // 7')
  CANDIDATES=$(/usr/bin/grep -cE '^###\s+[⚖️🔵]' .devt/memory/_suggestions.md 2>/dev/null || echo 0)
  LAST_RUN_FILE=.devt/state/last-curator-run.txt
  COOLDOWN_OK=1
  if [ -f "$LAST_RUN_FILE" ]; then
    LAST_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$(cat "$LAST_RUN_FILE")" "+%s" 2>/dev/null || echo 0)
    NOW_EPOCH=$(date "+%s")
    AGE_DAYS=$(( (NOW_EPOCH - LAST_EPOCH) / 86400 ))
    if [ "$AGE_DAYS" -lt "$COOLDOWN" ]; then COOLDOWN_OK=0; fi
  fi
  if [ "$CANDIDATES" -ge "$MIN" ] && [ "$COOLDOWN_OK" = "1" ]; then
    echo "auto_curator: ACTIVE — candidates=$CANDIDATES min=$MIN age=${AGE_DAYS:-never}d cooldown=${COOLDOWN}d"
    # Refresh _suggestions.md from the latest scratchpad #KNOWLEDGE-CANDIDATE tags + decisions before dispatch
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory suggest >/dev/null 2>&1 || true
    # Record run timestamp BEFORE dispatch so a curator crash doesn't trigger immediate re-runs
    date -u "+%Y-%m-%dT%H:%M:%SZ" > "$LAST_RUN_FILE"
  else
    echo "auto_curator: SKIP — candidates=$CANDIDATES (need $MIN) cooldown_ok=$COOLDOWN_OK"
  fi
else
  echo "auto_curator: DISABLED — memory.auto_curator_on_review=false (default; opt-in via .devt/config.json)"
fi
```

When bash prints `auto_curator: ACTIVE`, orchestrator dispatches curator:

```
<!-- BEGIN dispatch:curator:code_review -->
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <context>
    <files_to_read>.devt/memory/_suggestions.md, .devt/memory/lessons/*.md (existing), CLAUDE.md</files_to_read>
    <agent_skills>{injected from .devt/config.json — must include devt:memory-curation}</agent_skills>
  </context>
  <task>
    Auto-curator triggered by /devt:review post-review threshold (≥${MIN} candidates pending, last run ≥${COOLDOWN}d ago).
    Evaluate ⚖️/🔵 entries in .devt/memory/_suggestions.md. For each that passes the 5-filter (Specificity, Durability,
    Non-obviousness, Evidence, Actionability), present an AskUserQuestion proposal per memory-curation skill.
    Accepted candidates land in .devt/memory/{decisions,concepts,flows,rejected}/.
    Write .devt/state/curation-summary.md with verdicts per candidate (accepted / edited / rejected with reason).
  </task>
")
<!-- END dispatch:curator:code_review -->
```

When bash prints `auto_curator: SKIP` or `auto_curator: DISABLED`, no dispatch — proceed to `present_findings`.

</step>

<step name="present_findings" gate="findings are reported to the user">

**Auto-curator-considered gate.** Before presenting findings, assert that the auto_curator step was entered (not silently skipped):

```bash
CURATOR_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-auto-curator-considered)
if echo "$CURATOR_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$CURATOR_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Verifier-ran enforcement gate**. Before presenting findings, assert that the verifier step actually ran when `config.workflow.verification=true`. Field signal (greenfield 2026-05-27 PR #372): orchestrator skipped the verifier dispatch with the rationalization "8-lane fan-out is already verifier-grade." Nothing in the conditional skip at the top of the verify step pushed back. This gate makes the skip impossible:

```bash
VERIF_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-verifier-ran)
if echo "$VERIF_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$VERIF_GATE" | jq -r '.reason')"
  exit 0
fi
```

When the gate trips, surface the reason to the user and recommend re-running the verify step. Do not present findings until verification has actually been performed (or `config.workflow.verification` is explicitly set to `false`).

**Layer-2 claim-check resolution gate.** Before finalize, assert all Layer-1 `assert-artifact-present` failures in this workflow window have been resolved. An unresolved failure means an agent dispatch returned without writing its declared output (per `agents/io-contracts.yaml::outputs.primary`) and was never re-dispatched. Mirrors the dispatch-hygiene S1 pattern — post-hoc enforcement at finalize. Set `claim_check_mode: "warn"` in `.devt/config.json` to opt out.

```bash
CC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-claim-checks-resolved)
if echo "$CC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$CC_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Dispatch-hygiene post-hoc gate (greenfield calibration #12, S1).** Before knowledge-candidates aggregation, assert no raw devt:* dispatches happened this session. Claude Code does NOT enforce PreToolUse `decision:deny` on the Task tool — the existing `dispatch-hygiene-guard.sh` hook detects raw dispatches and writes them to `dispatch-warnings.jsonl` but cannot actually block. This gate is the post-hoc enforcement: any raw_dispatch entries with ts >= first_created_at blocks present_findings. Set `dispatch_hygiene_mode: "warn"` in `.devt/config.json` to opt out.

```bash
RD_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-no-raw-dispatches-this-session)
if echo "$RD_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$RD_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Knowledge-candidates-tagged gate.** Before presenting findings, assert that the orchestrator either surfaced `#KNOWLEDGE-CANDIDATE` lines in `scratchpad.md` during work OR declared none explicitly via `knowledge-candidates-none.txt` with a structured reason. Greenfield calibration #2 finding 6a#1: candidates described in review.md prose but never tagged in scratchpad → never reached the curator harvester. The gate forces an explicit decision.

Aggregate first so any tags the reviewer placed in `review.md` / `impl-summary*.md` reach scratchpad before the gate inspects it (the aggregator is idempotent + cheap, safe to always run).

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state aggregate-knowledge-candidates >/dev/null 2>&1 || true
KC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-knowledge-candidates-tagged)
if echo "$KC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$KC_GATE" | jq -r '.reason')"
  exit 0
fi
```

When the gate trips: re-read the review.md narrative, identify any non-obvious patterns the reviewer described in prose but did not tag, append `#KNOWLEDGE-CANDIDATE: [type=...] <summary>` lines to scratchpad.md, then re-enter present_findings. If genuinely none qualify, write the structured none-declaration: `printf 'reason=no_novel_patterns\ndeclared_at=%s\n' "$(date -u +%FT%TZ)" > .devt/state/knowledge-candidates-none.txt`.

Read `.devt/state/review.md` and present to the user:

- **Verdict**: APPROVED / APPROVED_WITH_NOTES / NEEDS_WORK
- **Score**: N / 100
- **Summary**: 2-3 sentence overview
- **Findings by severity**: Critical, Important, Minor (with file and line references)
- **Score breakdown**: by category (architecture, security, performance, etc.)
- **Graphify activity** (one line; the telemetry surface below populates it)

**Graphify activity surface** — surface what graphify tools were actually invoked during this workflow. Without this line, the user has no way to verify the integration was used vs. silently fell back to grep. Reads `.devt/memory/_mcp-trace.jsonl` filtered by the current `workflow_id`:

```bash
WID=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read | jq -r '.workflow_id // empty')
if [ -n "$WID" ]; then
  # Trace records UNPREFIXED tool names (`mcp__devt-graphify__*`) regardless
  # of how the orchestrator invokes (orchestrator uses prefixed
  # `mcp__plugin_devt_devt-graphify__*` per Claude Code plugin-namespacing,
  # but the recorded tool field in _mcp-trace.jsonl is the unprefixed form).
  # mcp-stats queries must use the unprefixed form to match trace records.
  # Workflow PROSE references for graphify tools stay prefixed.
  GRAPHIFY_SUMMARY=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" mcp-stats --workflow-id="$WID" --tool='mcp__devt-graphify__*' --by=calls 2>/dev/null || echo "")
  GRAPHIFY_UPSTREAM=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" mcp-stats --workflow-id="$WID" --tool='mcp__graphify__*' --by=calls 2>/dev/null || echo "")
  PLAN_TIER=$(jq -r '.tier // "unknown"' .devt/state/graphify-impact-plan.json 2>/dev/null || echo "unknown")
  if [ -f .devt/state/graphify-skip-reason.txt ]; then
    SKIP_REASON=$(cat .devt/state/graphify-skip-reason.txt)
    echo "Graphify activity: SKIPPED (plan=$PLAN_TIER, reason: $SKIP_REASON)"
  else
    echo "Graphify activity: tier=$PLAN_TIER"
    echo "$GRAPHIFY_SUMMARY"
    echo "$GRAPHIFY_UPSTREAM"
  fi
fi
```

Surface the output verbatim in the user report under "Graphify activity". When the trace file is missing or `workflow_id` is unset (legacy workflow.yaml predating auto-stamp), emit `Graphify activity: telemetry unavailable` and continue — best-effort.

This is a READ-ONLY workflow. Do NOT offer to fix findings. If the user wants fixes applied, they should run `/implement` or `/workflow` with the review findings as input.

**Memory-candidate footer** (B-III.1.c — KEEP IN SYNC across code-review.md, code-review-parallel.md, quick-implement.md::finalize, dev-workflow.md::finalize). Surfaces a one-liner when `_suggestions.md` has ≥ `memory.candidates_surface_threshold` proposals AND the cooldown has elapsed. The CLI handles all gating — workflows only need to echo the hint and touch the cooldown timestamp.

```bash
CC_STATUS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-status 2>/dev/null || echo '{"ready_to_surface":false}')
if echo "$CC_STATUS" | jq -e '.ready_to_surface == true' >/dev/null 2>&1; then
  CC_COUNT=$(echo "$CC_STATUS" | jq -r '.count')
  echo ""
  echo "💭 ${CC_COUNT} memory candidates pending in .devt/memory/_suggestions.md — run /devt:memory promote to triage."
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-touch-surface >/dev/null 2>&1 || true
fi
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state advance-phase complete active=false
```

</step>

---

<deviation_rules>

1. **Auto-fix: bugs** — Not applicable. This is a READ-ONLY workflow.
2. **Auto-fix: lint** — Not applicable. This is a READ-ONLY workflow.
3. **Auto-fix: deps** — Not applicable. This is a READ-ONLY workflow.
4. **STOP: architecture** — If no files can be identified for review (no git diff, no user input, no impl-summary), STOP with NEEDS_CONTEXT and ask the user to specify files.
   </deviation_rules>

<success_criteria>

- Review scope is determined (at least one file to review)
- Code review is complete (review.md is written with verdict and findings)
- Findings are presented to the user with severity, location, and rule references
- No code was modified (READ-ONLY)
- Final status: **DONE**
  </success_criteria>

## Memory layer integration

Code review now produces an "ADR Compliance" section in `.devt/state/review.md` (Critical
severity for violations). For each diff hunk:
1. `node bin/devt-tools.cjs memory affects <changed-file>` enumerates governing ADRs/CONs/FLOWs
2. Verify diff respects each (treat violations as Critical)
3. `node bin/devt-tools.cjs memory rejected-keywords` — flag any diff text matching a REJ
4. When `.devt/state/graph-impact.md` exists, read it — it carries the impact map from one of the three trigger tiers (PR-scoped via upstream `mcp__graphify__get_pr_impact`, bulk-scoped via vendored `mcp__plugin_devt_devt-graphify__query_graph`+`get_neighbors`, or symbol-anchored via `mcp__plugin_devt_devt-graphify__blast_radius`). The orchestrator wrote this file during context_init using its MCP tool surface — the code-reviewer agent consumes it READ-ONLY. Communities/dependents listed there get priority over unrelated files in the scope list, and finding severity is weighted by structural blast radius rather than file count
ADRs are constitutional — same severity as security findings.
