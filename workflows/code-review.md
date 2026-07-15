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

Read `resolved_skills.code-reviewer` from the compound `init` output (`$CTX.init.resolved_skills`; `init.cjs::resolveSkills` merges `.devt/config.json::agent_skills` with `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` defaults, config wins). Inject the list as the `<agent_skills>` block in the agent's task prompt. Frontmatter-preloaded skills are never re-listed; when the resolved list is empty, inject `<agent_skills>(none — defaults preloaded via agent frontmatter)</agent_skills>`.
</agent_skill_injection>

---

## Steps

<step name="context_init" gate="compound init succeeds">

> Context_init runs 9 substeps in order — bash + assert blocks under each. Substep markers are navigation anchors; the orchestrator must execute every block in sequence regardless of how they're labelled. KEEP IN SYNC with dev-workflow.md::context_init.

### Substep 0: Stale-workflow pre-flight (auto-reset for unambiguous cases; prompt otherwise)

Before any state update, detect whether `workflow.yaml` is stale relative to this new review. KILL gates fired on accumulated raw_dispatch/claim-check counters from the prior workflow will block this review's first `state update` call. Failure mode: a stale raw-dispatch counter left over from a days-old prior workflow blocks a brand-new review at substep 1.

**Auto-reset path**: when ALL hold — task changed AND prior workflow > 24h old AND workflow_type changed — this is unambiguously a new working session. Call `state auto-reset-if-stale` instead of prompting; resetSoft is non-destructive of valuable state (preserves workflow_id_history, session anchors, .devt/memory, phase artifacts) so prompting adds friction without value.

**Operator-override path**: if the operator types `/devt:review --fresh` (or includes `--fresh` in the task), skip the staleness check and unconditionally call `state reset-soft` before substep 1. This is the operator-explicit form of "I know it's stale, just reset and go."

```bash
# Operator-override path: --fresh flag in args triggers unconditional reset.
if [[ " ${REVIEW_SCOPE} " == *" --fresh "* ]] || [[ " $ARGUMENTS " == *" --fresh "* ]]; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state reset-soft 2>&1 | head -1
  echo "[review] --fresh: state reset-soft applied; proceeding to substep 1"
else
  AUTO_RESET=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state auto-reset-if-stale --task="${REVIEW_SCOPE}" --workflow-type="code_review" 2>&1)
  ACTED=$(echo "$AUTO_RESET" | tail -1 | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{console.log(JSON.parse(s).acted===true?'1':'0')}catch{console.log('0')}});" 2>/dev/null)
  if [ "$ACTED" = "1" ]; then
    echo "[review] auto-reset fired (task+type+age unambiguous new session); proceeding to substep 1"
  else
    # Not auto-resettable — fall back to standard staleness-check prompt
    STALENESS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state staleness-check --task="${REVIEW_SCOPE}" --workflow-type="code_review" 2>/dev/null || echo '{}')
    IS_STALE=$(echo "$STALENESS" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{console.log(JSON.parse(s).stale===true?'1':'0')}catch{console.log('0')}});" 2>/dev/null)
    STALE_REASON=$(echo "$STALENESS" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{console.log(JSON.parse(s).reason||'')}catch{console.log('')}});" 2>/dev/null)
  fi
fi
```

If auto-reset fired OR `--fresh` was used: continue to substep 1.

If `IS_STALE=1` (stale but not auto-resettable — e.g., same workflow_type, or task changed but <24h old), use AskUserQuestion with three options:

- Question: `Stale workflow state detected: ${STALE_REASON}. Reset accumulators? (preserves workflow_id_history + .devt/memory/ + phase artifacts like impl-summary.md / graph-impact.md / review.md; rotates dispatch-warnings.jsonl + claim-check-failures.jsonl; assigns fresh workflow_id + first_created_at so KILL gate counts from zero)`
- Options: `Reset` (recommended for new reviews on stale state) / `Continue without reset` (proceed — KILL gate may fire on subsequent state updates) / `Cancel`

If user picks `Reset`: run `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state reset-soft` and continue to substep 1. If `Continue`: proceed (operator accepts the KILL-gate risk). If `Cancel`: STOP with BLOCKED.

If `IS_STALE=0`: continue to substep 1 silently (no prompt, no overhead).

### Substep 1: Compound review-context-init (single bundle)

Run the compound context-init wrapper ONCE. It performs `init review`, activates the workflow (`active=true workflow_type=code_review phase=context_init`), runs `preflight generate` (Topic Pre-Flight Brief), computes + caches `memory_signal` / `scope_hint` / `scope_trust` / `god_node_warnings`, evicts stale Graphify artifacts, and computes the Graphify impact-plan — collapsing what were ~8 sequential CLI round-trips into one. It is read-only of prior-phase artifacts (does NOT reset `.devt/state/`; substep 0 handled the on-demand soft-reset for stale workflows), so a legitimate resumed review keeps its artifacts.

```bash
CTX=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state review-context-init --scope="${REVIEW_SCOPE}" --primary-branch="${PRIMARY_BRANCH:-main}")
PREREQ_FAILED=$(printf '%s\n' "$CTX" | jq -r '.prerequisite_failed // empty')
if [ -n "$PREREQ_FAILED" ]; then
  echo "BLOCKED: compound init failed — review-context-init prerequisite ${PREREQ_FAILED}: $(printf '%s\n' "$CTX" | jq -r '.detail // ""')"
  exit 1
fi
```

The wrapper writes the same side-effect artifacts the inline substeps did — `preflight-brief.{md,json}`, `graphify-impact-plan.json`, and `scope_trust_json` + `memory_signal_json` + `god_node_warnings_json` cached in `workflow.yaml` — so the dispatch envelopes that read those caches keep working unchanged.

**Capture discipline:** if you persist `$CTX` for later substeps, write it via shell redirection (`printf '%s' "$CTX" > <file>`) — never re-emit the JSON through a Write-tool body or heredoc you typed out. Model-rendered rewrites turn `\n` escapes inside string values (guardrails, rules content) into literal newlines, producing a file that fails `jq`/`JSON.parse` even though the CLI stdout was valid. Field-observed: a 133KB re-written bundle broke at the first embedded-file field while the live stdout parsed clean.

**Dispatch-envelope payload.** `$CTX.init` carries the `init review` compound payload — `governing_rules` (`content` + `rules_hash`), `models`, `inline_rubrics`, `rubrics`, `config`. Fill the `{governing_rules…}` / `{models.code-reviewer}` / `{models.verifier}` placeholders in the code-reviewer and verifier dispatch envelopes from `$CTX.init`. Fill `{inline_rubrics.code_review}` in the code-reviewer envelope only — that inline rubric is the reviewer's deliberate self-check; the verifier envelope carries the rubric by-reference (`<rubric_path>`) and Reads it from disk. The governing-rule file contents (`.devt/rules/*.md`) are in `$CTX.init.governing_rules.content`, so no separate Reads are needed to fill the dispatch. `CLAUDE.md` is carried as a by-reference stub — the harness auto-injects it into every subagent, so it is never inlined.

The wrapper's `preflight generate` auto-fires the **Topic Pre-Flight Brief** for the review scope (degrades silently on failure). The reviewer reads `.devt/state/preflight-brief.md` so the review checklist gains "alignment with governing ADRs/Concepts" and "no proposed changes that match a REJ tombstone" — high-leverage code-review items that are otherwise easy to miss.

### Substep 2: memory_signal (cached by the wrapper)

The wrapper ran the `memory query "${REVIEW_SCOPE}" --signal=3 --json-compact` aggregate once and cached it in `workflow.yaml::memory_signal_json` — consumed by both the code-reviewer and verifier dispatches (read back into each `<memory_signal>` block below). It is also in the bundle as `$CTX.memory_signal`; no separate query round-trip is needed.

### Substep 3: scope_hint + scope_trust + god_node_warnings (cached by the wrapper)

The wrapper ran `preflight scope-cache` (reads `preflight-brief.json`, computes `scope_hint` + `scope_trust`, applies the mechanical staleness override — forces `trust='sparse'` + writes `staleness-suppressed.txt` when state=ready AND lag exceeds `graphify.stale_threshold` or is null) and persisted `scope_trust_json` to `workflow.yaml`. The `scope_hint` `suggested_reading` field is the deduped union of governing docs' `affects_paths` plus blast-radius `direct_dependents`, capped at 8.

It also extracted the structured god-node data from `preflight-brief.json` — `god_nodes[]` carries `{symbol, edge_count, source_file}` per entry plus the boolean `blast.god_node_match` — and persisted `god_node_warnings_json` to `workflow.yaml` for the `<god_node_warnings>` dispatch injection. Both blobs are in the bundle (`$CTX.scope_trust`, `$CTX.god_node_warnings`).

When `god_node_match=true`, the agent sees a structured warning ("you're about to edit `<symbol>` — it has `<edge_count>` callers") instead of having to parse the markdown brief. Empty `god_nodes: []` with `god_node_match: false` is the no-warning baseline.

### Substep 4: Staleness gate + arch-scan advisory

**Staleness gate (tiered).** The wrapper tiered the Graphify freshness into `$CTX.staleness_tier` (comparing `preflight-brief.json::staleness.lag_commits` against `graphify.stale_threshold`, default 10). Decision tree:

- **Operator escape hatch (`--no-refresh` / `--stale-ok`)**: when the task text in `REVIEW_SCOPE` contains either flag, skip the staleness gate entirely + force `scope_trust.trust="sparse"` so reviewers downweight blast-radius signal. For emergency-review-on-known-broken-graph (graph build failing, CI runs accepting staleness).
- **`staleness_tier == "fresh"`** (`lag_commits == 0`): noop. Graph matches HEAD; proceed silently.
- **`staleness_tier == "manifest_fresh"`**: noop. No usable commit anchor, but every changed code file matches graphify's build manifest (mtime-verified) — the graph IS fresh for this scope. Proceed silently; do NOT downgrade trust or prompt.
- **`staleness_tier == "warn"`** (`0 < lag_commits < stale_threshold`, small-but-nonzero drift): **silent-warn band**. Emit one-line stderr `[staleness] graph behind HEAD; caller-sets may be slightly stale (lag<threshold)`; the wrapper already set `scope_trust.fresh=false` so reviewers see the freshness signal. No prompt — small drift doesn't justify interrupting.
- **`staleness_tier == "stale"`** (`lag_commits >= stale_threshold`) OR **`"unknown_lag"`** (`graph_stats.state` is `ready` AND `lag_commits` is `null`): AskUserQuestion BEFORE the impact-map fetch and any agent dispatch. Question: "Graphify graph is {lag_commits ?? 'unknown'} commits behind HEAD (threshold {threshold}); review may miss recent caller-set changes. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue dispatch with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed.
- **`staleness_tier == "unknown"`** (graphify disabled / not ready) or **absent** (short-circuit re-call on a fresh graph): proceed silently.

```bash
# Operator escape hatch detection
if [[ " ${REVIEW_SCOPE} " == *" --no-refresh "* ]] || [[ " ${REVIEW_SCOPE} " == *" --stale-ok "* ]] || [[ " $ARGUMENTS " == *" --no-refresh "* ]] || [[ " $ARGUMENTS " == *" --stale-ok "* ]]; then
  echo "[staleness] --no-refresh / --stale-ok: skipping staleness gate; forcing scope_trust.trust=sparse"
  STALENESS_TIER="bypass"
else
  STALENESS_TIER=$(printf '%s\n' "$CTX" | jq -r '.staleness_tier // "unknown"')
fi
case "$STALENESS_TIER" in
  warn)               echo "[staleness] graph behind HEAD; caller-sets may be slightly stale (lag<threshold)";;
  manifest_fresh)     echo "[staleness] manifest-verified fresh — changed files match the graphify build; proceeding";;
  stale|unknown_lag)  echo "[staleness] graph stale / unknown-lag — issue the AskUserQuestion before dispatch";;
esac
```

When `STALENESS_TIER` is `stale` or `unknown_lag`: issue the AskUserQuestion above. When `warn`: continue silently (silent-warn band — banner already emitted). When `fresh` / `manifest_fresh` / `unknown` / `bypass`: proceed.

**Stale Graphify artifacts were already evicted by the wrapper** (`state evict-graphify`, run after the freshness read so a clean short-circuit can reuse its `graph-impact.md`). The eviction is targeted — it never touches `impl-summary.md`, `test-summary.md`, etc. that the review may legitimately consume from a prior workflow phase. The same eviction set is shared with `dev-workflow`, `quick-implement`, `debug`, `research-task`.

**Arch-scan freshness advisory.** Check whether an arch-scan-report.md is available and how recent it is. Advisory-only by default — surfaces a `[STALE-ARCH-SCAN]` sentinel if the report is older than 24h so the reviewer can decide whether to refresh before reviewing structural changes. Surfaces state subcommands that would otherwise be available but unwired into workflows:

```bash
ARCH_FRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-arch-scan-fresh --max-age-hours=24 2>/dev/null || echo '{}')
if [ "$(printf '%s\n' "$ARCH_FRESH" | jq -r '.warn // false')" = "true" ]; then
  echo "[STALE-ARCH-SCAN] $(printf '%s\n' "$ARCH_FRESH" | jq -r '.reason')"
fi
if [ "$(printf '%s\n' "$ARCH_FRESH" | jq -r '.ok // false')" != "true" ]; then
  echo "[ARCH-SCAN-MISSING] $(printf '%s\n' "$ARCH_FRESH" | jq -r '.reason')"
fi
```

If the diff under review touches files that arch-scan has flagged (cross-reference arch-scan-report.md::findings vs the review's `scope_files`), surface the overlap explicitly to the reviewer — known architectural drift in the review's scope is a strong signal worth elevating.

### Substep 5: Graphify impact-plan (computed by the wrapper)

The wrapper computed the tier-decision tree in-process and wrote `.devt/state/graphify-impact-plan.json` carrying `{tier, tool, args, skip_reason, git_provider, pr_scoped_skip_reason, pr_diff_caveat?, symbol_anchored_caveat?, hunk_census?, severity_calibration_note?, topic_symbols_dropped_count?}`. Read the plan from the bundle (identical to the on-disk JSON) — the orchestrator then has ONE imperative instruction in substep 6, no "run the first matching" prose to skip past:

```bash
TIER=$(printf '%s\n' "$CTX" | jq -r '.impact_plan.tier')
TOOL=$(printf '%s\n' "$CTX" | jq -r '.impact_plan.tool')
GIT_PROVIDER=$(printf '%s\n' "$CTX" | jq -r '.impact_plan.git_provider')
echo "graphify_impact_plan: tier=$TIER tool=$TOOL provider=$GIT_PROVIDER"
# Echo the pr_diff_caveat (if any) so reviewers see the new-files-not-indexed signal in stdout.
PR_DIFF_CAVEAT=$(printf '%s\n' "$CTX" | jq -r '.impact_plan.pr_diff_caveat // empty')
[ -n "$PR_DIFF_CAVEAT" ] && echo "pr_scoped_diff caveat: $PR_DIFF_CAVEAT"
# Same blind spot on symbol_anchored: untracked / added-after-build files are invisible to the graph.
SA_CAVEAT=$(printf '%s\n' "$CTX" | jq -r '.impact_plan.symbol_anchored_caveat // empty')
[ -n "$SA_CAVEAT" ] && echo "symbol_anchored caveat: $SA_CAVEAT"
# Cosmetic-heavy diff → effect_size popularity warning (lanes must not inflate severity off it).
SEV_NOTE=$(printf '%s\n' "$CTX" | jq -r '.impact_plan.severity_calibration_note // empty')
[ -n "$SEV_NOTE" ] && echo "severity calibration: $SEV_NOTE"
# Echo the topic-symbol pre-truncation signal so reviewers see the dropped-list sidecar exists.
DROPPED_COUNT=$(printf '%s\n' "$CTX" | jq -r '.impact_plan.topic_symbols_dropped_count // empty')
[ -n "$DROPPED_COUNT" ] && echo "topic.symbols pre-truncated: $DROPPED_COUNT symbols dropped → .devt/state/topic-symbols-dropped.json"
```

**Tier decision tree (computed by the `computeGraphifyImpactPlan` wrapper — identical semantics to the prior inline bash):**

| Precondition | Tier | Tool | Args |
|---|---|---|---|
| graphify state ≠ ready | `skip` | — | `{skip_reason: "graphify state=…"}` |
| PR# + github | `pr_scoped` | `mcp__graphify__get_pr_impact` | `{pr_number: N}` |
| PR# + non-github + diff-symbols | `pr_scoped_diff` | `blast_radius` | `{symbols: [diff symbols]}` (+ `pr_diff_caveat` when new files) |
| PR# + non-github + topic.symbols | `symbol_anchored` | `blast_radius` | `{symbols: topic[:32]}` |
| topic.symbols | `symbol_anchored` | `blast_radius` | `{symbols: topic[:32]}` |
| scope ≥ threshold + dense + diff-symbols | `symbol_anchored` | `blast_radius` | `{symbols: [diff symbols]}` |
| scope ≥ threshold + dense + no diff-symbols | `bulk_scoped` | `query_graph` | `{text: REVIEW_SCOPE, limit: 20}` |
| else | `skip` | — | `{skip_reason: "no PR…"}` |

Side-effects (written by the wrapper): `.devt/state/graphify-impact-plan.json`; `.devt/state/topic-symbols-dropped.json` when `topic.symbols > 32` (consumed by substep 7's god-node check); removes any stale dropped-list sidecar otherwise.

### Substep 6: Execute the impact-plan + multi-tier drill-down

**EXECUTE THE PLAN.** Read `.devt/state/graphify-impact-plan.json`. This is not optional and not a "consider running it" — the next step gates on the output existing:

**ARGS CONTRACT** — the `args` field in `graphify-impact-plan.json` is the single source of truth for what gets passed to the MCP tool. Use it VERBATIM. Do NOT substitute symbols, narrow the list, "pick anchors", or improvise an alternative parameter set — those changes are unauditable and degrade tier signal. If the args look wrong, fix the bash that wrote them; do not override at the call site.

- If `tier == "skip"`: write `.devt/state/graphify-skip-reason.txt` containing the `skip_reason` field verbatim. Do NOT call any MCP tool. The reviewer falls back to `<scope_hint>` plus raw file list and graph-impact analysis is correctly absent.
- If `tier == "pr_scoped"`: call `mcp__graphify__get_pr_impact(args)` using the `args` object from the plan VERBATIM. **For Bitbucket projects this tier never fires** — the bash step routed past it. If the call errors (e.g. PR not found because the user-installed graphify MCP cannot reach the repo), fall back: write `graphify-skip-reason.txt` with the error and continue. Otherwise write the response verbatim to `.devt/state/graph-impact.md`.
- If `tier == "bulk_scoped"`: call `mcp__plugin_devt_devt-graphify__query_graph(args)` using the `args` object from the plan VERBATIM. From the response's top-5 nodes (highest degree), call `mcp__plugin_devt_devt-graphify__get_neighbors({symbol: <label>, direction: "in", depth: 2})` for each. Concatenate into `graph-impact.md` with one `## <symbol>` heading per block.
- If `tier == "symbol_anchored"`: call `mcp__plugin_devt_devt-graphify__blast_radius(args)` using the `args` object from the plan VERBATIM — the `symbols` array is computed from the diff in the bash step above; do not re-pick. Write the response verbatim to `graph-impact.md`.

**Caveat + calibration passthrough.** When the plan carries `symbol_anchored_caveat`, prepend it as a one-line note at the top of `graph-impact.md` (blast_radius ran against the last-committed layout — reviewers must know moved/new paths are unrepresented). When it carries `corpus_blind_caveat`, prepend that too — the graph has NO nodes for those changed files, and its silence about them is blindness, not safety. When `manifest_freshness.all_matched` is true, prepend one line noting the graph is manifest-verified FRESH for this scope (reviewers must not discount it on commit-lag grounds). When it carries `severity_calibration_note`, append the note as a `## Severity Calibration` section to `graph-impact.md` — lane reviewers weight findings by actual semantic delta instead of inflating severity off a popularity-driven `effect_size`, while still using the caller sets to verify wiring.

**Lite mode.** When the command injected `<mode>lite</mode>` (the operator judged the change small via `--lite`), execute the headline tier call above but SKIP the multi-tier drill-down follow-up in this substep AND the hyperedge/ambiguous augmentation in substep 7 — the headline (`effect_size` / `god_node_match` / `modules_touched`) plus the deterministic god-node check (substep 7's `check-large-files`) is the lite signal. The drill-down is a heavy-path tool for when the caller set is too large to grep; on a small change the reviewer reads the code directly. Emit `[review-weight] lite mode — headline only, multi-tier drill-down skipped per --lite`. `<mode>full</mode>` forces the full drill-down regardless.

**Multi-tier follow-up (post-impact-plan drill-down).** When the tier executed was `symbol_anchored` or `bulk_scoped` AND the response carries a `direct_dependents` or top-degree-nodes array, **also** call `mcp__plugin_devt_devt-graphify__get_neighbors({symbol: "<DEP>", direction: "in", depth: 2})` for the top-3 dependents from the response — rank via the `direct_dependents_degrees` array (`{label, in_count, edge_count, source_file, relevance_tier, is_god_node, pure_god_node}`, already sorted by RELEVANCE to the diff — dependents whose `source_file` is among the changed symbols' files (`relevance_tier: 2`), or that share a Leiden community with a changed symbol (`relevance_tier: 1`), rank first; incidental high-fan-in god-nodes are demoted to the bottom but remain present; `direct_dependents` carries the same order, so position IS the rank); fall back to array position on older response shapes. When the response has fewer than 3 dependents, drill on however many exist (skip the drill-down step entirely if 0). Append each as a `## Drill-down: <DEP> [call: <correlation_id>]` section to `graph-impact.md` — the correlation_id is the `_meta.correlation_id` field returned by the MCP call's response envelope (8-char hex), and downstream lane reviewers can cite it via `mcp-stats --correlation-id=<id>` to trace findings back to the specific call. When the response envelope lacks `_meta.correlation_id` (older MCP servers), omit the `[call: ...]` suffix rather than blocking. Why: one blast_radius call alone leaves lane subagents grep-hunting for caller sets that 3 cheap MCP calls would have surfaced. Args-VERBATIM contract still applies to the original tier call; the drill-down args are derived from the tier response, not from the impact-plan.json.

**Empty drill-down handling**: `get_neighbors` self-recovers on empty results — identifier-shaped dropped callers return in `results` marked `recovered_from_noise: true` (confidence RECOVERED), with `dropped_by_file` still aggregating what stayed filtered. A drill-down is genuinely empty only when BOTH are absent — then record `## Drill-down: <SYM> (empty — dynamic dispatch suspected) [call: <correlation_id>]` and substitute the next-ranked dependent (bounded: try up to 5).

**God-node oversize handling**: when a top-3 dependent carries `is_god_node: true` in its `direct_dependents_degrees` entry — a high-fan-in node now demoted by relevance ranking, so it only reaches the top-3 when relevant dependents are scarce, typically a class with hundreds of incoming edges — the upstream MCP `get_neighbors(symbol, direction="in", depth=2)` response can overflow the MCP transport's response-size cap, returning zero usable data (observed: 84KB overflow → empty response on high-degree symbols). When this happens, fall back to the devt CLI wrapper which supports `--max-bytes` truncation: `node bin/devt-tools.cjs graphify neighbors <symbol> --direction=in --depth=2 --max-bytes=60000`. The CLI sorts results depth-ascending + label-alphabetical and truncates deterministically, returning `truncated: true` + `total_neighbors` so the heading can record the partial nature: `## Drill-down: <SYM> (truncated — depth-2 incoming exceeded 60KB; first <N> of <total>) [via CLI fallback]`.

**Substance threshold on drill-down sections.** `assert-graphify-decision` doesn't check "was the MCP tool called?" — it checks "is each drill-down section dense enough to be useful?" The gate uses a substance-byte-threshold heuristic per `## Drill-down:` block (currently 200 bytes minimum after stripping headings). A thin drill-down (e.g., 57 bytes) can fail the gate even when the MCP call succeeded — the section is thin because the topic extraction returned a generic concept that didn't map to a single useful subgraph. **If the gate fails with reason `drill-down section below substance threshold`**: re-derive the drill-down symbol from the impact-plan's `args.symbols` (NOT from topic keywords) so each section anchors on a real graph node with real dependents to enumerate. The gate is by design about output usefulness, not call presence.

### Substep 7: Deterministic god-node check

**Deterministic post-MCP augmentation.** After the tier executes (or even when it skipped), run ONE CLI that appends up to six deterministic sections to `graph-impact.md` — file- and symbol-level god-node warnings (via `check-large-files` / `check-symbol-godnodes`), the dropped-symbol truncation banner + section, hyperedge-completeness, ambiguous-bindings, and the preflight god-node fallback (emitted only when both diff-anchored checks come back empty). Pure post-processing of on-disk JSON — no MCP, no model judgment — folded from ~110 lines of inline jq into `graphify augment-impact-map` (the section wording is emitted by the CLI, byte-identical to the prior inline output):

```bash
AUGMENT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify augment-impact-map --edge-threshold=50 --raw-count=${TOPIC_SYMBOLS_RAW_COUNT:-?} 2>/dev/null || echo '{}')
echo "graphify augment-impact-map: $(printf '%s\n' "$AUGMENT" | jq -r 'if (.sections_appended // []) | length == 0 then "no sections (clean)" else "appended " + (.sections_appended | join(", ")) end')"
```

Why: a large module file (e.g. ~2,400 LOC) may be a god node, but the symbol-anchored anchor list can miss it because the diff's PascalCase symbols don't include module-level identifiers from that file. The CLI is deterministic (no MCP calls), idempotent, and gracefully no-ops when the graph is missing or the diff is empty.

Symbol-level rationale: `check-large-files` aggregates per-file (one max-degree symbol per basename) and can miss a true god-node symbol when a lower-degree sibling in the same file happens to be reported as the file's top symbol. `check-symbol-godnodes` returns every above-threshold symbol whose `source_file` is in the diff with no per-file collapse, so a high-degree symbol cannot be eclipsed by a same-file sibling.

**Note on signal independence**: four signals now feed the reviewer, all independent:
- `blast_radius::god_node_match` — symbol-aggregated; at least one input symbol matches a god-node in the graph.
- `check-large-files` — file-aggregated; reports the max-degree symbol per diff file.
- `check-symbol-godnodes` — symbol-level; reports every above-threshold symbol whose source_file is in the diff, no per-file aggregation.
- `preflight.god_nodes` fallback — graph-global top god-nodes; only emitted when both diff-anchored CLIs return 0. Provides structural signal for the common pattern where the diff touches callers, not definition sites.

Any of the four can fire while the others stay silent — surface all four verbatim in the reviewer dispatch context. The fallback is mutually exclusive with the diff-anchored CLIs (only emits when they both go silent).

After this step, **EXACTLY ONE** of `graph-impact.md` or `graphify-skip-reason.txt` MUST exist. Enforced by a hard process gate — not prose:

```bash
PFRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-preflight-fresh)
if [ "$(printf '%s\n' "$PFRESH" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: preflight-brief is stale — $(printf '%s\n' "$PFRESH" | jq -r '.reason')"
  exit 1
fi
ASSERT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-graphify-decision)
if [ "$(printf '%s\n' "$ASSERT" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: graphify decision artifact missing — $(printf '%s\n' "$ASSERT" | jq -r '.reason')"
  exit 1
fi
```

The assert auto-passes when graphify is disabled or the graph is missing (`graphify_state != "ready"`) — the gate is about orchestrator obedience to the workflow contract, not about graphify being installed.

**Gate**: If compound init fails, STOP with BLOCKED. If `state assert-graphify-decision` returns `ok:false`, STOP with BLOCKED — the orchestrator skipped the EXECUTE THE PLAN step above.

### Substep 8: Decision-artifact gates + claude-mem MCP pre-step

**Orchestrator pre-step (claude-mem MCP) — DECISION-ARTIFACT REQUIRED.** Exactly ONE of `.devt/state/claude-mem-harvest.md` or `.devt/state/claude-mem-skipped.txt` MUST exist after this step. The `state assert-claude-mem-harvest` gate below enforces this — orchestrators that skip silently get caught. Why: this pre-step is easy to drop as an unconscious skip — not rationalized, not noticed, simply absent — without an enforcement gate.

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
if [ "$(printf '%s\n' "$HARVEST" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: claude-mem decision artifact missing — $(printf '%s\n' "$HARVEST" | jq -r '.reason')"
  exit 1
fi
```

The pre-step is intentionally permissive: a `claude-mem-skipped.txt` with reason satisfies the gate. The point is to make the consideration explicit — silent skips are the failure mode.

**Review-weight advisory (shadow mode — NON-gating).** Compute the fail-safe light-vs-heavy verdict from the diff (path-based risk surface + logic-file/domain counts) plus the blast headline already cached in `$CTX`, and ANNOUNCE it. This never changes behavior on its own — only the operator's `--lite` / `--full` flag does (substep 6). It runs on every review so its recommendation accumulates a track record against reality: light must be EARNED (proven absence of god-node + risk-surface path), never granted by a single metric.

```bash
RW_TIER=$(printf '%s\n' "$CTX" | jq -r '.impact_plan.tier // empty')
RW_GOD=$(printf '%s\n' "$CTX" | jq -r 'if .god_node_warnings.god_node_match == true then "true" elif .god_node_warnings.god_node_match == false then "false" else empty end')
RW_EFFECT=$(jq -r '.blast.effect_size // empty' .devt/state/preflight-brief.json 2>/dev/null)
RW_ARGS="--base=${PRIMARY_BRANCH:-main}"
[ -n "$RW_TIER" ]   && RW_ARGS="$RW_ARGS --tier=$RW_TIER"
[ -n "$RW_GOD" ]    && RW_ARGS="$RW_ARGS --god-node=$RW_GOD"
[ -n "$RW_EFFECT" ] && RW_ARGS="$RW_ARGS --effect-size=$RW_EFFECT"
RW=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" review-weight assess $RW_ARGS 2>/dev/null || echo '{}')
if [ "$(printf '%s\n' "$RW" | jq -r '.eligible // false')" = "true" ]; then
  echo "[review-weight] LIGHT-eligible — $(printf '%s\n' "$RW" | jq -r '.logic_file_count') logic file(s), $(printf '%s\n' "$RW" | jq -r '.domain_count') domain(s), no risk surface, no god-node. Heavy path running; pass --lite to scale down."
else
  echo "[review-weight] HEAVY recommended — $(printf '%s\n' "$RW" | jq -r '(.blocked_by // ["unknown"]) | join("; ")')"
fi
RW_ADV=$(printf '%s\n' "$RW" | jq -r '(.advisories // []) | join("; ")')
[ -n "$RW_ADV" ] && echo "[review-weight] advisories (non-blocking): $RW_ADV"
```
</step>

<step name="scope_check" gate="scope size measured + parallel decision made if applicable">

Measure the file count in the review scope. If > 10 files AND graphify is ready, offer the user a choice between single-dispatch (with community-filter fallback) and parallel-lane review.

> **Pre-known partition shortcut:** If you already know the right lane partition before this workflow runs (e.g., 7 domain lanes for a multi-service PR), skip the auto-partitioner entirely and use the formal lane-registration path: `node bin/devt-tools.cjs state register-lanes --from=<lanes.yaml>` followed by `node bin/devt-tools.cjs dispatch render-lanes` to emit paste-ready envelopes carrying the canonical rubric self-grade directive + scope blocks. Each rendered envelope carries a `<correlation_id>cid_<workflow_id_prefix>_<lane_id></correlation_id>` tag that `dispatch-hygiene-guard.sh` recognizes — preserve this short tag in your dispatch prompt (even when customizing other envelope content) to silence `raw_dispatch` warnings on registered-lane dispatches. The matcher is content-based: any one of the recognized envelope tags (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`, `<context>`, `<graph_impact>`, `<correlation_id>cid_*`, etc.) is sufficient. This avoids the bypass-pattern where long sessions accumulate unbounded raw-dispatch counts.

```bash
# Scope size must come from the same source identify_scope will use.
# This step runs BEFORE identify_scope writes code-review-input.md, so
# measuring that artifact here read 0 on every fresh run — the file-size
# path to parallel was only reachable via the operator-intent short-circuit
# or a leftover file from a prior run. Prefer the artifact when it already
# exists (pre-written scope escape hatch); otherwise count the same union
# (committed range + working tree + untracked) identify_scope strategy 2
# uses — a raw base...HEAD count reads 0 on uncommitted work.
if [ -s .devt/state/code-review-input.md ]; then
  SCOPE_FILE_COUNT=$(awk '/^- /{n++} END{print n+0}' .devt/state/code-review-input.md 2>/dev/null || echo 0)
else
  SCOPE_FILE_COUNT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state changed-files --base="${PRIMARY_BRANCH:-main}" | jq -r '.count // 0')
fi
GRAPHIFY_STATE=$(jq -r '.graph_stats.state // "not_ready"' .devt/state/preflight-brief.json 2>/dev/null || echo "not_ready")
echo "scope_check: file_count=${SCOPE_FILE_COUNT}, graphify_state=${GRAPHIFY_STATE}"

if [ "${SCOPE_FILE_COUNT:-0}" -gt 10 ] && [ "${GRAPHIFY_STATE:-not_ready}" = "ready" ]; then
  echo "scope=${SCOPE_FILE_COUNT} graphify=ready" > .devt/state/scope-check-required.txt
fi
```

If `SCOPE_FILE_COUNT ≤ 10` OR `GRAPHIFY_STATE != "ready"`: skip the AskUserQuestion and continue to identify_scope (single-dispatch path). The community-filter is the canonical fallback when scope creeps past 10 files without graphify.

**Operator-explicit short-circuit:** When the task text in `REVIEW_SCOPE` already declares parallel/single intent (e.g. operator typed "split across multiple agents for parallel review" or "single dispatch only"), asking the AskUserQuestion is re-asking an answered question. Pre-detect the intent and auto-write the answer:

```bash
PARALLEL_INTENT_RE='(parallel|split (across|between|into) (multiple|several)|per-lane|fan[ -]out|multiple agents|N agents|community lanes)'
SINGLE_INTENT_RE='(single (dispatch|agent|reviewer)|no parallel|no fan[ -]out|one[ -]reviewer)'
SCOPE_LOWER=$(echo "${REVIEW_SCOPE}" | tr '[:upper:]' '[:lower:]')
if echo "${SCOPE_LOWER}" | /usr/bin/grep -qE "${PARALLEL_INTENT_RE}"; then
  echo "parallel" > .devt/state/scope-check-answer.txt
  echo "[scope_check] operator-explicit short-circuit: parallel intent detected in task text — skipping AskUserQuestion"
  SCOPE_CHECK_DECISION="parallel"
elif echo "${SCOPE_LOWER}" | /usr/bin/grep -qE "${SINGLE_INTENT_RE}"; then
  echo "single" > .devt/state/scope-check-answer.txt
  echo "[scope_check] operator-explicit short-circuit: single intent detected in task text — skipping AskUserQuestion"
  SCOPE_CHECK_DECISION="single"
else
  SCOPE_CHECK_DECISION=""
fi
```

If `SCOPE_CHECK_DECISION` is set, skip the AskUserQuestion block and proceed to the chosen path (parallel → delegate to `code-review-parallel.md`; single → continue to identify_scope).

If `SCOPE_FILE_COUNT > 10` AND `GRAPHIFY_STATE == "ready"` AND `SCOPE_CHECK_DECISION` is empty: ask the user:

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
if printf '%s\n' "$SCOPE_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=scope_check status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$SCOPE_GATE" | jq -r '.reason')"
  exit 0
fi
```

Determine which files to review. Use ONE of these strategies (in priority order):

1. **User-specified files**: If the user provided specific file paths or patterns, use those.
2. **Git diff**: If no files were specified, detect changed files via the union CLI — committed range (merge-base-aware triple-dot) PLUS working tree PLUS untracked. Raw `git diff base...HEAD` returns an EMPTY set exactly when the review target is uncommitted work, silently under-scoping the review:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state changed-files --base="${PRIMARY_BRANCH:-main}" | jq -r '.files[]'
   ```
   Operator override: `export PRIMARY_BRANCH=development` (or whatever the project's primary branch is) before invoking /devt:review; without the flag the CLI defaults to `.devt/config.json::git.primary_branch`, then `main`.
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
MEMORY_SIGNAL=$(printf '%s\n' "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(printf '%s\n' "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(printf '%s\n' "$STATE" | jq -r '.scope_trust_json // "{}"')

# Skip-context injection — when graphify-skip-reason.txt exists, the reviewer
# should know the impact-map is intentionally absent (not "graphify failed").
# Coordination signal: tiny prompt cost, eliminates accidental over-reliance on
# absent graph data. Why: when tier=skip fires silently, reviewers fall back
# to grep without knowing graphify was the wrong tool for the workflow (e.g.,
# Bitbucket + stale brief). Explicit signal beats implicit file-presence checks.
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
<!-- EDIT-SOURCE: templates/dispatch/envelopes/code-reviewer-code_review.tmpl.md -->
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
    <!-- auto_memory carries user-curated decisions (laneH from
         ~/.claude/projects/<projHash>/memory/*.md) + claude-mem observations
         (.devt/state/claude-mem-harvest.md), populated in preflight-brief.json.
         Distinct from memory_signal, which is the FTS-backed
         ADR/CON/FLOW/REJ/LES governance layer. -->
    <auto_memory>{auto_memory_json}</auto_memory>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <graphify_status>{graphify_status_json}</graphify_status>
    <god_node_warnings>{god_node_warnings_json}</god_node_warnings>
    <graph_impact>
{graph_impact_content}
</graph_impact>
    <graph_impact_note>The above is orchestrator-mediated MCP output inlined from .devt/state/graph-impact.md — high-signal review map for changed symbols. Your tool surface does not include `mcp__*graphify*`, so consume the inlined data rather than issuing graph queries.</graph_impact_note>
    <evolution>Read .devt/state/evolution-report.md (if it exists) — git-history hotspots, change coupling, fix density; check generated_at for staleness. Elevate finding severity one notch on high fix-density files: recurring-fix hotspots break again.</evolution>
    {prior_outputs}
    {provenance_protocol}
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
    <!-- Inline rubric body from init payload — reviewer self-checks against
         the same axes the verifier will grade, reducing verifier-revision
         loops. Falls back to <rubric_path> on-disk Read when omitted
         (oversized rubric → init returns null inline_rubrics). -->
    <rubric_content>{inline_rubrics.code_review}</rubric_content>
    <review_scope>Read .devt/state/code-review-input.md</review_scope>
    <impl_summary>Read .devt/state/impl-summary.md (if exists)</impl_summary>
    <test_summary>Read .devt/state/test-summary.md (if exists)</test_summary>
    <decisions>Read .devt/state/decisions.md (if exists — from /devt:workflow --mode=clarify)</decisions>
    <learning_context>{learning_context — relevant review/quality lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review the following files for quality, correctness, and standards compliance.
    Review ALL code in the listed files — do not filter by origin or label findings as pre-existing.
    Every valid finding must be reported with file, line, severity, and rule reference.

    **Self-grade against the rubric as you write.** The same axes the
    verifier will use to grade your review are inlined in <rubric_content> (or
    readable at <rubric_path> as fallback). Walk EVERY declared axis (both the
    A–G table rows AND any `## Axis [A-Z] —` top-level headings, currently
    including axis H for dispatch warnings acknowledgment)
    before emitting review.md: scope coverage (every input file mentioned),
    finding specificity (file:line + rule ref or pattern citation), severity
    calibration (no Critical-rated nits, no Minor-rated security issues),
    remediation concreteness (Critical/Important findings include a fix
    direction), ADR Compliance section when memory affects-paths returned
    hits, Reuse Discipline section when reuse-candidates.md is non-empty,
    Dispatch warnings section per axis H. Closing these gaps in your first
    pass avoids a verifier revision loop.

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
if [ "$(printf '%s\n' "$ARTIFACT_CHECK" | jq -r '.ok')" != "true" ]; then
  echo "[BLOCKED] devt: $(printf '%s\n' "$ARTIFACT_CHECK" | jq -r '.reason')"
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

**Substance pre-gate**: even when the file exists, the code-reviewer may have returned a placeholder body (e.g., multi-lane fan-outs where most lane dispatches return `status:completed` with bodies like "Stub written; analysis in progress."). Don't burn a verifier dispatch grading a stub — block here and re-dispatch the reviewer instead:

```bash
SUBSTANCE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state check-agent-output .devt/state/review.md)
if printf '%s\n' "$SUBSTANCE" | jq -e '.looks_like_stub == true' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: review.md looks like a stub — $(printf '%s\n' "$SUBSTANCE" | jq -r '.reason')"
  exit 0
fi
```

When this gate trips, surface the substance reason to the user and recommend `/devt:review` re-dispatch — verifier loop cannot recover from an empty upstream artifact.

**Verifier short-circuit gate**: when the code-reviewer's review.json carries `status=DONE` AND `self_flagged_uncertainties=[]`, skip the verifier LLM dispatch entirely. The agent itself self-certified no coverage gaps; re-grading clean self-reports burns 3-5K tokens per iteration with no signal. This gate is consumer-aware: it only short-circuits when the upstream agent provided BOTH substance signals (status=DONE/DONE_WITH_CONCERNS AND empty self_flagged_uncertainties). Opus 4.8 made empty self-flags a meaningful negative claim — the model proactively flags uncertainty at far higher fidelity than prior versions, so empty IS a signal rather than a non-signal.

```bash
SHORT_CIRCUIT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-verifier-short-circuit --agent=code-reviewer)
if printf '%s\n' "$SHORT_CIRCUIT" | jq -e '.short_circuit == true' >/dev/null 2>&1; then
  # Write a synthetic verification.json so the downstream assert-verifier-ran
  # gate accepts the skip. Audit trail preserved via source=short_circuit.
  # Schema enums per JSON_SIDECAR_SCHEMAS::verification.json — VERIFICATION_STATUSES
  # uses "VERIFIED" (not workflow-level "DONE") and VERIFICATION_VERDICTS uses
  # "satisfied" (not workflow-level "PASS"). Validation gates enforce the enum.
  cat > .devt/state/verification.json <<EOF
{
  "status": "VERIFIED",
  "verdict": "satisfied",
  "agent": "verifier",
  "source": "short_circuit",
  "reason": "$(printf '%s\n' "$SHORT_CIRCUIT" | jq -r '.reason')",
  "sidecar_consulted": "$(printf '%s\n' "$SHORT_CIRCUIT" | jq -r '.sidecar_path')",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=DONE verdict=PASS
  echo "VERIFIER SHORT-CIRCUITED: $(printf '%s\n' "$SHORT_CIRCUIT" | jq -r '.reason')"
  exit 0
fi
```

If short-circuit fires, the verify step is complete — skip the rest of this step and proceed to `present_findings`. Otherwise the verifier LLM dispatches normally below.

**Orchestrator-prep — read cached memory signal**. Cached at context_init; re-read here so the verifier doesn't burn 3–4 per-doc `memory query` round trips on its initial scan:

```bash
# Re-derive scope_trust from current preflight-brief.json so the cached value reflects current graph state, not the value computed at workflow start. Fail-open: stale cache used if no brief.
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state refresh-scope-context >/dev/null 2>&1 || true
STATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read)
MEMORY_SIGNAL=$(printf '%s\n' "$STATE" | jq -r '.memory_signal_json // "{}"')
SCOPE_HINT=$(printf '%s\n' "$STATE" | jq -r '.scope_hint_json // "[]"')
SCOPE_TRUST=$(printf '%s\n' "$STATE" | jq -r '.scope_trust_json // "{}"')
```

Substitute the JSON output into the `<memory_signal>` block in the dispatch prompt below. If `.devt/memory/` is empty or the query fails, the fallback `{}` keeps the block well-formed and the agent falls back to fresh queries.

Dispatch the verifier:

```
<!-- BEGIN dispatch:verifier:code_review -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/verifier-code_review.tmpl.md -->
Task(subagent_type="devt:verifier", model="{models.verifier}", prompt="
  <context>
    <workflow_type>code_review</workflow_type>
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
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
    {prior_outputs}
    {provenance_protocol}
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

**Verifier walk-all-axes substance gate.** A verifier can walk rubric axes A–G and stop at G, silently skipping axis H — and still return `verdict=satisfied` despite the missing grade. Post-hoc check: count axes in the pinned rubric and compare against `verification.json::criteria_total`. On mismatch, override the verdict to `needs_revision` so the workflow re-dispatches the verifier with explicit instruction to walk every declared axis.

```bash
AXES_ASSERT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-verifier-graded-all-axes 2>/dev/null)
AXES_OK=$(printf '%s\n' "$AXES_ASSERT" | jq -r '.ok // false')
AXES_COVERAGE_GAP=false
if [ "$AXES_OK" = "false" ]; then
  AXES_REASON=$(printf '%s\n' "$AXES_ASSERT" | jq -r '.reason // "verifier under-graded the rubric"')
  echo "[axes-coverage] $AXES_REASON"
  AXES_COVERAGE_GAP=true
  # Force needs_revision regardless of verifier's self-reported verdict — its
  # satisfied/needs_revision split is unreliable when it didn't walk the full
  # rubric. Surface AXES_REASON + missing_axes_count as `<reviewer_feedback>`
  # in the next iteration's verifier dispatch so it grades every axis explicitly.
fi
```

When `AXES_COVERAGE_GAP=true`, treat the verdict as `needs_revision` regardless of what `verification.json::verdict` says — skip the route block below and apply the RETRY operator using `AXES_REASON` as the `revisions[]` gap. When the workflow hits `MAX_ITER` with `AXES_COVERAGE_GAP=true` still set, PRUNE with explicit notice that axes were under-graded so the user sees the structural gap, not just the count gap.

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

**Conditional auto-curator.** When `memory.auto_curator_on_review = true` AND `_suggestions.md` has ≥ `memory.auto_curator_min_candidates` (default 3) AND last curator run was ≥ `memory.auto_curator_cooldown_days` (default 7) ago, refresh discovery harvest and fire a curator dispatch. Skipped silently otherwise — default `false` keeps the workflow cost-neutral for users who don't opt in.

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
<!-- EDIT-SOURCE: templates/dispatch/envelopes/curator-code_review.tmpl.md -->
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <context>
    <files_to_read>.devt/memory/_suggestions.md, .devt/memory/lessons/*.md (existing)</files_to_read>
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
if printf '%s\n' "$CURATOR_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$CURATOR_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Verifier-ran enforcement gate**. Before presenting findings, assert that the verifier step actually ran when `config.workflow.verification=true`. Why: orchestrators sometimes skip the verifier dispatch with rationalizations like "the fan-out is already verifier-grade." Nothing in the conditional skip at the top of the verify step pushes back. This gate makes the skip impossible:

```bash
VERIF_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-verifier-ran)
if printf '%s\n' "$VERIF_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=verify status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$VERIF_GATE" | jq -r '.reason')"
  exit 0
fi
```

When the gate trips, surface the reason to the user and recommend re-running the verify step. Do not present findings until verification has actually been performed (or `config.workflow.verification` is explicitly set to `false`).

**Layer-2 claim-check resolution gate.** Before finalize, assert all Layer-1 `assert-artifact-present` failures in this workflow window have been resolved. An unresolved failure means an agent dispatch returned without writing its declared output (per `agents/io-contracts.yaml::outputs.primary`) and was never re-dispatched. Mirrors the dispatch-hygiene S1 pattern — post-hoc enforcement at finalize. Set `claim_check_mode: "warn"` in `.devt/config.json` to opt out.

```bash
CC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-claim-checks-resolved)
if printf '%s\n' "$CC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$CC_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Dispatch-hygiene post-hoc gate.** Before knowledge-candidates aggregation, assert no raw devt:* dispatches happened this session. Claude Code does NOT enforce PreToolUse `decision:deny` on the Task tool — the existing `dispatch-hygiene-guard.sh` hook detects raw dispatches and writes them to `dispatch-warnings.jsonl` but cannot actually block. This gate is the post-hoc enforcement: any raw_dispatch entries with ts >= first_created_at blocks present_findings. Set `dispatch_hygiene_mode: "warn"` in `.devt/config.json` to opt out.

```bash
RD_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-no-raw-dispatches-this-session)
if printf '%s\n' "$RD_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$RD_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Knowledge-candidates-tagged gate.** Before presenting findings, assert that the orchestrator either surfaced `#KNOWLEDGE-CANDIDATE` lines in `scratchpad.md` during work OR declared none explicitly via `knowledge-candidates-none.txt` with a structured reason. Why: candidates described in review.md prose but never tagged in scratchpad never reach the curator harvester. The gate forces an explicit decision.

Aggregate first so any tags the reviewer placed in `review.md` / `impl-summary*.md` reach scratchpad before the gate inspects it (the aggregator is idempotent + cheap, safe to always run).

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state aggregate-knowledge-candidates >/dev/null 2>&1 || true
KC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-knowledge-candidates-tagged)
if printf '%s\n' "$KC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=present_findings status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$KC_GATE" | jq -r '.reason')"
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
  # --include-chain: context_init MCP calls land under the pre-rotation
  # workflow_id (the type-transition rotates it later), so the strict
  # default would report zero graphify usage for a run that used it.
  GRAPHIFY_SUMMARY=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" mcp-stats --workflow-id="$WID" --include-chain --tool='mcp__devt-graphify__*' --by=calls 2>/dev/null || echo "")
  GRAPHIFY_UPSTREAM=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" mcp-stats --workflow-id="$WID" --include-chain --tool='mcp__graphify__*' --by=calls 2>/dev/null || echo "")
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

**Memory-candidate footer** (B-III.1.c). Surfaces a one-liner when `_suggestions.md` has ≥ `memory.candidates_surface_threshold` proposals AND the cooldown has elapsed. The CLI handles status read + threshold + cooldown check + hint emission + cooldown-timestamp touch as a single operation.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-footer
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
