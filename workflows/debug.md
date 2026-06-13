# Debug — Systematic Investigation

Dispatch a debugger agent to investigate and fix a bug using a 4-phase investigation protocol.

<purpose>
Systematically isolate, diagnose, and fix bugs instead of guessing. The debugger agent
follows a structured protocol that builds evidence before proposing fixes.
</purpose>

<prerequisites>
- `.devt/rules/coding-standards.md` exists (for code context)
- `.devt/rules/quality-gates.md` exists (for verification after fix)
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>

- `devt:debugger` — systematic debugging specialist, 4-phase investigation protocol (Read, Write, Edit, Bash, Glob, Grep)
</available_agent_types>

<agent_skill_injection>
Before dispatching the debugger agent, read `resolved_skills.debugger` from the compound `init` output. This is pre-resolved by `init.cjs::resolveSkills` — `.devt/config.json::agent_skills.debugger` overrides; default falls back to skill-index.yaml (`codebase-scan`).
</agent_skill_injection>

<process>

Track state so `/devt:status` and `/devt:next` can detect and resume interrupted debug sessions:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=debug phase=debug status=IN_PROGRESS stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null "task=${BUG_DESCRIPTION}"
```

**Evict stale Graphify artifacts** before regenerating preflight + impact data. Prevents cross-workflow contamination (a prior `/devt:review` or `/devt:workflow` session's `graph-impact.md` would otherwise persist and mislead this debug session):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state evict-graphify
```

**Auto-fire Pre-Flight Brief**:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "${BUG_DESCRIPTION}"
PFRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-preflight-fresh)
if [ "$(echo "$PFRESH" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: preflight-brief is stale — $(echo "$PFRESH" | jq -r '.reason')"
  exit 1
fi
```

This produces `.devt/state/preflight-brief.md` so the debugger reads governing rules + REJ tombstones before proposing fixes (especially load-bearing for "we already tried that" cases). Skip silently if the call fails. The `assert-preflight-fresh` gate catches orchestrators that skip `preflight generate` and reuse a stale brief from a prior workflow — field-validated: greenfield 2026-05-21 ran a code-review workflow where the brief was 4 hours older than `workflow.yaml::created_at`, leading to tier=skip from stale topic.symbols.

**Cache the scope hint** for `<scope_hint>` injection. `preflight generate` writes `preflight-brief.json` alongside the markdown; its `suggested_reading` field is the deduped union of governing docs' `affects_paths` plus blast-radius `direct_dependents`, capped at 8 — high-leverage starting set for the debugger's hypothesis search:

```bash
SCOPE_HINT=$(jq -c '.suggested_reading // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
SCOPE_TRUST=$(jq -c '{trust: (.graph_stats.trust // "empty"), lag_commits: .staleness.lag_commits, fresh: (.staleness.fresh // false)}' .devt/state/preflight-brief.json 2>/dev/null || echo '{}')

# Mechanical staleness override — force scope_trust.trust='sparse' + write a suppression artifact when
# graph_stats.state=ready AND (lag_commits is null OR exceeds threshold). Bash-mechanical because the
# prior prose-only spec ("In autonomous mode, force sparse") was found violated in field validation:
# the orchestrator wrote scope_trust before the prose, then never re-wrote.
GRAPHIFY_STATE=$(jq -r '.graph_stats.state // "not_ready"' .devt/state/preflight-brief.json 2>/dev/null || echo "not_ready")
STALE_THRESHOLD=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get graphify.stale_threshold 2>/dev/null | jq -r '.value // 30')
LAG=$(echo "$SCOPE_TRUST" | jq -r '.lag_commits // "null"')
SUPPRESS=""
if [ "$GRAPHIFY_STATE" = "ready" ]; then
  if [ "$LAG" = "null" ]; then
    SUPPRESS="lag_commits=null, state=ready (unreachable SHA / shallow clone)"
  elif [ "$LAG" -gt "$STALE_THRESHOLD" ] 2>/dev/null; then
    SUPPRESS="lag_commits=$LAG > stale_threshold=$STALE_THRESHOLD"
  fi
fi
if [ -n "$SUPPRESS" ]; then
  SCOPE_TRUST=$(echo "$SCOPE_TRUST" | jq '.trust = "sparse"')
  printf '%s — %s\n' "$(date -u +%FT%TZ)" "$SUPPRESS" > .devt/state/staleness-suppressed.txt
fi

node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update scope_hint_json="${SCOPE_HINT}" scope_trust_json="${SCOPE_TRUST}"
```

**Staleness gate** — If `preflight-brief.json::staleness.lag_commits > graphify.stale_threshold` (default 30) OR (`graph_stats.state` is `ready` AND `staleness.lag_commits` is `null`), prompt the user via AskUserQuestion BEFORE the debugger dispatch: "Graphify graph is {lag_commits ?? 'unknown'} commits behind HEAD; symbol-to-file mappings may be stale. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed. Skip only when graphify is disabled — a null `lag_commits` while `state=ready` (e.g., unreachable SHA, shallow clone) now triggers the prompt instead of silently disabling the gate.

**Graphify scan-prep gate** — When the graph is dense AND blast radius is substantial AND topic symbols resolved, instruct the orchestrator to write a fresh `.devt/state/graph-impact.md` via two MCP calls. Threshold matches dev-workflow's field-validated bar. Below the threshold (or graphify disabled): skip; debugger falls back to grep + stack trace.

```bash
DEPENDENTS=$(jq -r '.blast.direct_dependents_count // 0' .devt/state/preflight-brief.json 2>/dev/null || echo 0)
TRUST=$(jq -r '.graph_stats.trust // "empty"' .devt/state/preflight-brief.json 2>/dev/null || echo "empty")
SYMBOLS_JSON=$(jq -c '.topic.symbols // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
SYMBOLS_COUNT=$(echo "$SYMBOLS_JSON" | jq 'length')
if [ "$TRUST" = "dense" ] && [ "$DEPENDENTS" -ge 10 ] && [ "$SYMBOLS_COUNT" -gt 0 ]; then
  CENTRAL_SYMBOL=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight pick-central-symbol "$SYMBOLS_JSON" "${BUG_DESCRIPTION:-}" 2>/dev/null | head -1)
  [ -z "$CENTRAL_SYMBOL" ] && CENTRAL_SYMBOL=$(echo "$SYMBOLS_JSON" | jq -r '.[0]')
  echo "graphify_scan_prep: ACTIVE — central=$CENTRAL_SYMBOL dependents=$DEPENDENTS trust=$TRUST"
elif [ "$TRUST" = "dense" ] && [ "$SYMBOLS_COUNT" = "0" ]; then
  echo "graphify_scan_prep: RECOVERY — symbols=0 trust=dense; orchestrator must call query_graph(task_text) to resolve synthetic symbols, then proceed with get_neighbors + blast_radius on the top result"
else
  REASON="dependents=$DEPENDENTS trust=$TRUST symbols=$SYMBOLS_COUNT (need dense+≥10+symbols)"
  echo "graphify_scan_prep: SKIP — $REASON"
  printf '%s\n' "$REASON" > .devt/state/graphify-skip-reason.txt
fi
```

When the bash echo prints `ACTIVE`, the orchestrator MUST execute these two MCP calls and concatenate the output into `.devt/state/graph-impact.md`:

1. **`mcp__plugin_devt_devt-graphify__blast_radius({symbols: ["<CENTRAL_SYMBOL>"]})`** — first call, impact map with `direct_dependents`.
2. **Drill-down on top-3 dependents** (F16). Parse `direct_dependents`, take top-3 by impact_size, call `mcp__plugin_devt_devt-graphify__get_neighbors({symbol: "<DEP>", direction: "in", depth: 2})` for each. Debugger uses drill-down data to find callers across the bug's blast radius that may exhibit the same symptom.

Format `graph-impact.md` with sections `# Graph Impact — <task>` / `## Blast radius — <CENTRAL_SYMBOL>` / `## Drill-down: <dep1> [call: <correlation_id>]` / `## Drill-down: <dep2> [call: <correlation_id>]` / `## Drill-down: <dep3> [call: <correlation_id>]`. The `correlation_id` is the `_meta.correlation_id` field returned by each `get_neighbors` MCP response (8-char hex); omit the `[call: ...]` suffix when the field is absent. The debugger Reads this file when present. When the bash printed `SKIP`, `graphify-skip-reason.txt` was written above — debugger falls back to grep+stack trace.

**When the bash echo prints `RECOVERY`** — topic extraction returned 0 symbols on a dense graph. Orchestrator MUST first call `mcp__plugin_devt_devt-graphify__query_graph({text: "${BUG_DESCRIPTION}", limit: 5})` to resolve synthetic symbols, then proceed with `get_neighbors` + `blast_radius` using the top result's label as `CENTRAL_SYMBOL`. Write `graph-impact.md` with an additional `## Fuzzy symbol resolution` section.

**Decision artifact assertion** — hard-fail if the orchestrator skipped writing either artifact:

```bash
ASSERT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-graphify-decision)
if [ "$(echo "$ASSERT" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: graphify decision artifact missing — $(echo "$ASSERT" | jq -r '.reason')"
  exit 1
fi
```

<step name="init" gate="project context loaded">
## Step 1: Initialize

Read `.devt/rules/coding-standards.md` and `.devt/rules/quality-gates.md` for context.
Read `CLAUDE.md` if it exists.
</step>

<step name="gather_symptoms" gate="symptoms captured in debug-context.md">
## Step 2: Gather Symptoms

Before dispatching debugger, capture:

- What is the expected behavior?
- What is the actual behavior?
- Error message (if any)
- Steps to reproduce
- When did it start? (recent change?)

Write to `.devt/state/debug-context.md`
</step>

<step name="dispatch" gate="debugger returns a status">
## Step 3: Dispatch Debugger

<!-- BEGIN dispatch:debugger:debug -->
Task(subagent_type="devt:debugger", model="{models.debugger}", prompt="
<context>
<files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md</files_to_read>
<scope_hint>{scope_hint_json}</scope_hint>
<scope_trust>{scope_trust_json}</scope_trust>
<graph_impact>
{graph_impact_content}
</graph_impact>
<graph_impact_note>The above is orchestrator-mediated MCP output inlined from .devt/state/graph-impact.md — pre-computed caller set + blast radius for the bug's central symbol. When the inlined content is a "(no graph-impact.md available — ...)" notice, fall back to following the stack trace from the symptom.</graph_impact_note>
<symptoms>Read .devt/state/debug-context.md</symptoms>
<agent_skills>{injected from .devt/config.json if available}</agent_skills>
</context>
<bug>{bug_description}</bug>
Follow the 4-phase investigation protocol. Write findings to .devt/state/debug-summary.md.

Your tool surface does not include `mcp__*graphify*`. Use the `<scope_hint>` block (derived from preflight Brief blast-radius) as the high-signal starting set for hypothesis formation, then validate with Grep/Read. When `<scope_trust>.trust` is `empty`, fall back to following the stack trace from the symptom.

**Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing debug-summary.md): per your `knowledge_candidates` step, if debugging surfaces a non-obvious pattern (recurring bug class, hidden invariant the bug violated, environmental gotcha worth documenting), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes the 5-filter test: specificity, durability, non-obviousness, evidence, actionability. When none qualify, surface that decision in debug-summary.md.
")
<!-- END dispatch:debugger:debug -->

**Claim-check (Q11)**: Before proceeding past the debugger dispatch, mechanically verify the debugger wrote its declared output. Closes the cal #19 coverage gap — debug.md's Layer-2 `assert-claim-checks-resolved` ran at finalize but no Layer-1 calls ever fired, so `claim-check-failures.jsonl` stayed absent and the gate passed vacuously regardless of dispatch outcome.

```bash
ARTIFACT_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present debugger)
if [ "$(echo "$ARTIFACT_CHECK" | jq -r '.ok')" != "true" ]; then
  echo "[BLOCKED] devt: $(echo "$ARTIFACT_CHECK" | jq -r '.reason')"
fi
```

If BLOCKED: debugger did not write debug-summary.md. Re-dispatch with explicit instruction.

</step>

<step name="auto_curator" gate="curator dispatched if config + threshold + cooldown all permit">

**F6 — Conditional auto-curator.** Same gate as `/devt:review`. When `memory.auto_curator_on_review = true` AND `_suggestions.md` has ≥ `memory.auto_curator_min_candidates` (default 3) AND last curator run was ≥ `memory.auto_curator_cooldown_days` (default 7) ago, refresh harvest and fire curator dispatch. Skipped silently otherwise.

```bash
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
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory suggest >/dev/null 2>&1 || true
    date -u "+%Y-%m-%dT%H:%M:%SZ" > "$LAST_RUN_FILE"
  else
    echo "auto_curator: SKIP — candidates=$CANDIDATES (need $MIN) cooldown_ok=$COOLDOWN_OK"
  fi
else
  echo "auto_curator: DISABLED — memory.auto_curator_on_review=false (default; opt-in via .devt/config.json)"
fi
```

When ACTIVE, dispatch curator:

```
<!-- BEGIN dispatch:curator:debug -->
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <context>
    <files_to_read>.devt/memory/_suggestions.md, .devt/memory/lessons/*.md (existing), CLAUDE.md</files_to_read>
    <agent_skills>{injected from .devt/config.json — must include devt:memory-curation}</agent_skills>
  </context>
  <task>
    Auto-curator triggered by /devt:debug post-debug threshold (≥${MIN} candidates pending, last run ≥${COOLDOWN}d ago).
    Evaluate ⚖️/🔵 entries in .devt/memory/_suggestions.md. For each that passes the 5-filter, present an
    AskUserQuestion proposal per memory-curation skill. Accepted candidates land in
    .devt/memory/{decisions,concepts,flows,rejected}/. Write .devt/state/curation-summary.md.
  </task>
")
<!-- END dispatch:curator:debug -->
```

</step>

<step name="post_fix_graphify_refresh" gate="refresh decision recorded">

**Post-fix graphify refresh** — When `graphify.enabled=true` AND the debugger landed a fix (`debug-summary.md` status is `FIXED`), the graph is now N commits behind reality. The next workflow (review, dev, retro) would consume a stale scope_hint. Branch on `config.graphify.auto_refresh_post_impl` (default `"ask"`):

- **`"ask"` (default)** AND interactive (non-autonomous) mode: emit AskUserQuestion with header "Graphify refresh", question "Debug fix landed. The graph is now N commits behind reality. Refresh now?", three options:
    1. **Refresh now (recommended)** — runs `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify maybe-refresh --force --timeout=60`, surfaces one-line confirmation. Downstream workflows see the patched symbols.
    2. **Skip — I'll refresh manually later** — emits the `💡` tip and continues; user retains control. Next preflight will catch staleness via the staleness gate.
    3. **Always auto-refresh for this project** — runs the refresh AND writes `auto_refresh_post_impl: true` into `.devt/config.json` so future workflows in this project skip the prompt.
- **`true`** OR autonomous mode: silently call `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify maybe-refresh --force --timeout=60`. Surface a one-line confirmation: `🔄 Refreshed graphify graph after fix (Xs)` or `⚠️ Graphify refresh skipped: <reason>`. Continue regardless — refresh is best-effort.
- **`false`**: emit only the one-line tip — `💡 Debug fix landed — run `graphify update .` (or `node bin/devt-tools.cjs graphify maybe-refresh --force`) to refresh the project graph. The staleness gate will catch drift on the next workflow.` No prompt, no refresh.

Skip the step entirely when graphify is disabled (`config.graphify.enabled=false`) — emit nothing. Skip when `debug-summary.md` status is `NEEDS_MORE_INVESTIGATION` or `BLOCKED` (no fix landed; graph isn't stale).

</step>

<step name="report" gate="results presented to user">
## Step 4: Report Results

**Knowledge-candidates-tagged gate.** Before reporting, assert that the debugger either surfaced `#KNOWLEDGE-CANDIDATE` lines in `scratchpad.md` during investigation OR declared none via `knowledge-candidates-none.txt` with a structured reason. Greenfield calibration #2 finding 6a#1: candidates described in prose but never tagged → never reached the curator. Runs BEFORE the scratchpad truncate below — that order matters.

**Layer-2 claim-check resolution gate.** Block report on any unresolved Layer-1 `assert-artifact-present` failures. Mirrors S1's post-hoc pattern. Set `claim_check_mode: "warn"` in config to opt out.

```bash
CC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-claim-checks-resolved)
if echo "$CC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=report status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$CC_GATE" | jq -r '.reason')"
  exit 0
fi
```

**Dispatch-hygiene post-hoc gate (greenfield calibration #12, S1).** Block report on any in-session raw devt:* dispatches. CC doesn't enforce PreToolUse Task-deny; this is the post-hoc enforcement.

```bash
RD_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-no-raw-dispatches-this-session)
if echo "$RD_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=report status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$RD_GATE" | jq -r '.reason')"
  exit 0
fi
```

Aggregate tags from `debug-summary.md` / `impl-summary*.md` first so the gate sees them.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state aggregate-knowledge-candidates >/dev/null 2>&1 || true
KC_GATE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-knowledge-candidates-tagged)
if echo "$KC_GATE" | jq -e '.ok == false' >/dev/null 2>&1; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=report status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(echo "$KC_GATE" | jq -r '.reason')"
  exit 0
fi
```

When the gate trips: re-read debug-summary.md, identify non-obvious patterns the debugger described in prose (recurring bug class, hidden invariant, environmental gotcha) but did not tag, append `#KNOWLEDGE-CANDIDATE: [type=...] <summary>` lines to scratchpad.md, then re-enter report. If genuinely none qualify, write the structured none-declaration: `printf 'reason=no_novel_patterns\ndeclared_at=%s\n' "$(date -u +%FT%TZ)" > .devt/state/knowledge-candidates-none.txt`.

Read `.devt/state/debug-summary.md`:

- **FIXED**: report fix, run quality gates to verify. Confirm that the debugger agent appended an entry to its persistent memory at `.claude/agent-memory/devt-debugger/MEMORY.md` (the agent does this automatically).
- **NEEDS_MORE_INVESTIGATION**: show what was discovered, offer to re-run /devt:debug with accumulated context
- **DONE_WITH_CONCERNS**: debugger hit the 3-attempt limit on a fix. Report what was tried, what remains, and suggest next steps (manual fix or architectural review via `/devt:review --focus=arch`)
- **BLOCKED**: surface root cause analysis, suggest architectural review

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state advance-phase debug active=false
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state truncate-artifact scratchpad.md
```

The second line clears ephemeral PREFLIGHT lines from `scratchpad.md` so the next workflow in the same session starts clean. Debugger writes PREFLIGHT entries during investigation; without this, stale entries would falsely satisfy the pre-flight-guard hook for files touched in the next workflow.
</step>

</process>

<deviation_rules>

1. **Auto-fix: bugs** — The debugger agent may fix bugs inline as part of its investigation. This is expected.
2. **Auto-fix: test gaps** — If the bug reveals a missing test, the debugger may add one.
3. **STOP: architectural** — If the root cause is architectural (wrong abstraction, missing layer, design flaw), report BLOCKED and surface to user.

</deviation_rules>

<success_criteria>

- Bug symptoms are documented in debug-context.md before investigation
- Debugger follows the 4-phase protocol (isolate, diagnose, test hypothesis, fix)
- Quality gates pass after fix (if status is FIXED)
- Summary includes root cause, not just the fix
</success_criteria>

## Memory layer integration

Debugger consults REJ tombstones BEFORE proposing fixes via `node bin/devt-tools.cjs memory
rejected-keywords`. Proposed fixes matching tombstone search_keywords are silently filtered —
DO NOT surface "but Redis would solve this" when REJ-001 already rejected Redis. When debug
findings reveal a recovery flow worth documenting, tag `#KNOWLEDGE-CANDIDATE: [type=flow]
<summary>` so curator can promote to FLOW-xxx. Debug knowledge persistent memory continues to
write to `.claude/agent-memory/devt-debugger/MEMORY.md` (existing surface).
