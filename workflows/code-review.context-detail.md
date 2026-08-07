# code-review.md — by-reference detail (context_init + scope_check)

Uncommon-path handling relocated out of `code-review.md` so the common review path (fresh graph, no arch scanner, normal drill-down responses, single-dispatch) doesn't load it every run. Each section is loaded on-demand: `code-review.md` reads it only when the substep's precondition fires. Anchors are referenced by mandatory-Read pointers in `code-review.md`; the pointer↔anchor bijection is enforced by smoke gate K309.

**Sections here do NOT all belong to the same step** — read the entry line of the one you were sent to. `arch-scan-advisory` and `drill-down-recovery` are entered from `context_init`; `parallel-offer` is entered from `scope_check` and hands control to a different workflow file entirely. A reader who assumed the file's title named its only caller would be holding the wrong step in mind at the point of the run where the most state is already in play.

## arch-scan-advisory

Loaded from substep 4 only when `.devt/state/arch-scan-report.md` exists.

Check how recent the report is. Advisory-only — surfaces a `[STALE-ARCH-SCAN]` sentinel if the report is older than 24h so the reviewer can decide whether to refresh before reviewing structural changes. Surfaces state subcommands that would otherwise be available but unwired into workflows:

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

## drill-down-recovery

Loaded from substep 6 only when a drill-down response comes back anomalous (empty, god-node-oversized, or below the substance threshold). Normal drill-downs need none of it.

**Empty drill-down handling**: `get_neighbors` self-recovers on empty results — identifier-shaped dropped callers return in `results` marked `recovered_from_noise: true` (confidence RECOVERED), with `dropped_by_file` still aggregating what stayed filtered. A drill-down is genuinely empty only when BOTH are absent — then record `## Drill-down: <SYM> (empty — dynamic dispatch suspected) [call: <correlation_id>]` and substitute the next-ranked dependent (bounded: try up to 5).

**God-node oversize handling**: when a top-3 dependent carries `is_god_node: true` in its `direct_dependents_degrees` entry — a high-fan-in node now demoted by relevance ranking, so it only reaches the top-3 when relevant dependents are scarce, typically a class with hundreds of incoming edges — the upstream MCP `get_neighbors(symbol, direction="in", depth=2)` response can overflow the MCP transport's response-size cap, returning zero usable data (observed: 84KB overflow → empty response on high-degree symbols). When this happens, fall back to the devt CLI wrapper which supports `--max-bytes` truncation: `node bin/devt-tools.cjs graphify neighbors <symbol> --direction=in --depth=2 --max-bytes=60000`. The CLI sorts results depth-ascending + label-alphabetical and truncates deterministically, returning `truncated: true` + `total_neighbors` so the heading can record the partial nature: `## Drill-down: <SYM> (truncated — depth-2 incoming exceeded 60KB; first <N> of <total>) [via CLI fallback]`.

**Substance threshold on drill-down sections.** `assert-graphify-decision` doesn't check "was the MCP tool called?" — it checks "is each drill-down section dense enough to be useful?" The gate uses a substance-byte-threshold heuristic per `## Drill-down:` block (currently 200 bytes minimum after stripping headings). A thin drill-down (e.g., 57 bytes) can fail the gate even when the MCP call succeeded — the section is thin because the topic extraction returned a generic concept that didn't map to a single useful subgraph. **If the gate fails with reason `drill-down section below substance threshold`**: re-derive the drill-down symbol from the impact-plan's `args.symbols` (NOT from topic keywords) so each section anchors on a real graph node with real dependents to enumerate. The gate is by design about output usefulness, not call presence.

## parallel-offer

Entered from code-review.md::scope_check ONLY when the offer bar is crossed (>15 files, or >10 files spanning ≥3 domains) AND `GRAPHIFY_STATE == "ready"`. Ends with `.devt/state/scope-check-answer.txt` written (`parallel` | `single` | `cancel`) — the mechanical signal `state assert-scope-check-handled` requires.

> **Pre-known partition shortcut:** If you already know the right lane partition before this workflow runs (e.g., 7 domain lanes for a multi-service PR), skip the auto-partitioner entirely and use the formal lane-registration path: `node bin/devt-tools.cjs state register-lanes --from=<lanes.yaml>` followed by `node bin/devt-tools.cjs dispatch render-lanes` to emit paste-ready envelopes carrying the canonical rubric self-grade directive + scope blocks. Each rendered envelope carries a `<correlation_id>cid_<workflow_id_prefix>_<lane_id></correlation_id>` tag that `dispatch-hygiene-guard.sh` recognizes — preserve this short tag in your dispatch prompt (even when customizing other envelope content) to silence `raw_dispatch` warnings on registered-lane dispatches. The matcher is content-based: any one of the recognized envelope tags (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`, `<context>`, `<graph_impact>`, `<correlation_id>cid_*`, etc.) is sufficient. This avoids the bypass-pattern where long sessions accumulate unbounded raw-dispatch counts.

**Operator-explicit short-circuit:** When the task text in `REVIEW_SCOPE` already declares parallel/single intent (e.g. operator typed "split across multiple agents for parallel review" or "single dispatch only"), asking the AskUserQuestion is re-asking an answered question. Pre-detect the intent and auto-write the answer:

```bash
# The split alternative allows interior words: operators write "split this
# review between multiple agents", not the contiguous "split between multiple".
# Field near-miss: that phrasing matched on the `multiple agents` alternative
# alone, so one alternative carried the whole routing decision. Spelling
# tolerance is deliberately NOT added — "paralel" missed and chasing
# "parralel"/"paralell" is unbounded over-fitting. The real safety net is the
# else branch: an undetected intent must ASK, never guess.
PARALLEL_INTENT_RE='(parallel|split[^.]{0,30}(multiple|several)|per-lane|fan[ -]out|multiple agents|N agents|community lanes)'
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
  echo "[scope_check] no explicit parallel/single intent in task text — the offer bar decides, and if crossed the operator MUST be asked (do not infer a default)"
fi
```

If `SCOPE_CHECK_DECISION` is set, skip the AskUserQuestion block and proceed to the chosen path (parallel → delegate to `code-review-parallel.md`; single → continue to identify_scope).

If the offer bar was crossed AND `GRAPHIFY_STATE == "ready"` AND `SCOPE_CHECK_DECISION` is empty: compute the cost/value preview, then ask the user. **An empty `SCOPE_CHECK_DECISION` with the offer bar crossed is precisely when AskUserQuestion must fire** — it is the no-match branch, not a default-to-single branch. The short-circuit above exists to avoid re-asking an *answered* question; silently picking a path when the regex found nothing is the opposite failure, and the more expensive one, because a near-miss then routes the review without the operator ever seeing a choice.

**Cost preview with value caveat — NEVER present cost alone.** A naked cost number systematically biases toward false economy on exactly the reviews where fan-out pays (field case: the "expensive" parallel run was the one that caught two cross-lane Criticals a single pass would plausibly have missed). The preview pairs a rough banded estimate with the coverage signal:

```bash
# Domain spread — the value-side variable. Top-2 path segments of the scope files.
DOMAIN_COUNT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state changed-files ${PRIMARY_BRANCH:+--base=$PRIMARY_BRANCH} | jq -r '.files[]' | awk -F/ '{ if (NF >= 3) print $1"/"$2; else if (NF == 2) print $1; else print "root" }' | sort -u | wc -l | tr -d ' ')
EXPECTED_LANES=$(( DOMAIN_COUNT < 5 ? DOMAIN_COUNT : 5 ))
echo "[scope_check] cost/value preview: single-dispatch ≈ 1 reviewer + 1-2 verify rounds; parallel ≈ ${EXPECTED_LANES} lanes + consolidator + 1-3 verify rounds (field-measured: a 5-lane run with 3 verify rounds cost roughly 6-8x a single dispatch). Value side: scope spans ${DOMAIN_COUNT} domain(s) at ${DIFF_LOC} changed lines — single-dispatch coverage-confidence drops as attention spreads past ~15 files / 3+ domains, and finding rates scale with diff mass; cross-cutting findings need reconciliation only parallel lanes surface independently."
```

```yaml
question: "Review scope is {SCOPE_FILE_COUNT} files across {DOMAIN_COUNT} domains. Split into parallel lanes (one reviewer per graphify community, capped at 5)? Rough cost: parallel ≈ {EXPECTED_LANES} lane dispatches + consolidation + verify (~6-8x single-dispatch tokens); single ≈ one reviewer whose coverage-confidence drops above ~15 files / 3+ domains."
header: "Parallel Review"
multiSelect: false
options:
  - label: "Yes — parallel lanes (recommended for >15 files or 3+ domains)"
    description: "Higher token cost, buys independent per-domain attention + cross-lane reconciliation — the configuration that catches cascade findings single passes miss"
  - label: "No — single dispatch with community-filter"
    description: "Fraction of the cost; one reviewer, deep review restricted to affected_communities, rest deferred — right call for single-domain or shallow diffs"
```

Do NOT add mid-verify-loop cost readouts: a "you've spent N tokens re-litigating this finding, continue?" prompt cannot distinguish convergence spend from waste, and the field case where round 3 cost ~800K is the round that reversed a wrong refutation — the spend was buying correctness.

**After the user answers, write the choice to `.devt/state/scope-check-answer.txt`** — this is the mechanical signal that satisfies `state assert-scope-check-handled` (the gate at the start of the next step). The answer must be one of: `parallel`, `single`, `cancel`. Example:

```bash
echo "${USER_CHOICE}" > .devt/state/scope-check-answer.txt
```

If the user chose `cancel`, STOP with BLOCKED. If `parallel`, proceed to the parallel delegation path. If `single`, continue to identify_scope (single-dispatch).

If user picks YES (parallel): **first pre-write the scope artifact, THEN delegate.** scope_check runs BEFORE identify_scope would write `.devt/state/code-review-input.md`, and the parallel workflow's `partition_lanes` reads it — writing it here (from the same changed-files union scope_check measured) means the parallel path has its scope on entry. `partition_lanes` also self-recovers if it's somehow still absent, but pre-writing keeps that a genuine-anomaly path (loud warning fires only when the handoff really broke, not on every fresh run):

```bash
if [ ! -s .devt/state/code-review-input.md ]; then
  RANGE=$(echo " ${REVIEW_SCOPE} ${ARGUMENTS:-} " | /usr/bin/grep -oE -- '--range=[^ ]+' | head -1 | cut -d= -f2)
  PARALLEL_SCOPE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state changed-files ${PRIMARY_BRANCH:+--base=$PRIMARY_BRANCH} ${RANGE:+--range=$RANGE} 2>/dev/null | jq -r '.files[]?' 2>/dev/null)
  if [ -n "$PARALLEL_SCOPE" ]; then
    # Same shape identify_scope documents, ## Source included. The two emitters
    # disagreed: an orchestrator following the documented template produced a
    # section this pre-write omitted, and the scope parser tolerated only the
    # shorter form — so writing the artifact CORRECTLY was what broke it.
    { echo "# Review Scope"; echo; echo "## Files"; echo; printf '%s\n' "$PARALLEL_SCOPE" | sed 's/^/- /'; echo; echo "## Source"; echo; echo "git-diff${PRIMARY_BRANCH:+ (base: $PRIMARY_BRANCH)}${RANGE:+ (range: $RANGE)}"; } > .devt/state/code-review-input.md
    echo "[scope_check] pre-wrote code-review-input.md ($(printf '%s\n' "$PARALLEL_SCOPE" | /usr/bin/grep -cE '.') files) before parallel delegation"
    # Re-anchor the bundle: scope_sig folds the artifact, so this recomputes
    # the signal/impact inputs over the explicit universe before lanes inherit them.
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state review-context-init --scope="${REVIEW_SCOPE}" ${PRIMARY_BRANCH:+--primary-branch=$PRIMARY_BRANCH} >/dev/null 2>&1 || true
  fi
fi
```

Then delegate to `workflows/code-review-parallel.md` by Read-ing that file and following its steps starting from `context_init`. The cached workflow.yaml state (workflow_id, memory_signal, scope_hint, scope_trust) carries over — the parallel workflow re-reads it.

If user picks NO: continue to identify_scope (existing single-dispatch path; the code-reviewer agent's community-filter logic handles scope > 10 files automatically).
