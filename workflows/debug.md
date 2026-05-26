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
  CENTRAL_SYMBOL=$(echo "$SYMBOLS_JSON" | jq -r '.[0]')
  echo "graphify_scan_prep: ACTIVE — central=$CENTRAL_SYMBOL dependents=$DEPENDENTS trust=$TRUST"
else
  REASON="dependents=$DEPENDENTS trust=$TRUST symbols=$SYMBOLS_COUNT (need dense+≥10+symbols)"
  echo "graphify_scan_prep: SKIP — $REASON"
  printf '%s\n' "$REASON" > .devt/state/graphify-skip-reason.txt
fi
```

When the bash echo prints `ACTIVE`, the orchestrator MUST execute these two MCP calls and concatenate the output into `.devt/state/graph-impact.md`:

1. `mcp__devt-graphify__get_neighbors({symbol: "<CENTRAL_SYMBOL>", direction: "in", depth: 2})` — caller set for the bug's central symbol; debugger uses this to find blast-radius callers that may exhibit the same symptom.
2. `mcp__devt-graphify__blast_radius({symbols: ["<CENTRAL_SYMBOL>"]})` — aggregate structural risk for fix planning.

Format `graph-impact.md` with sections `# Graph Impact — <task>` / `## Caller set (get_neighbors)` / `## Blast radius`. The debugger Reads this file when present. When the bash printed `SKIP`, `graphify-skip-reason.txt` was written above — debugger falls back to grep+stack trace.

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

Task(subagent_type="devt:debugger", model="{models.debugger}", prompt="
<context>
<files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md</files_to_read>
<scope_hint>{scope_hint_json}</scope_hint>
<scope_trust>{scope_trust_json}</scope_trust>
<graph_impact>Read .devt/state/graph-impact.md if it exists — pre-computed caller set + blast radius for the bug's central symbol. When absent, .devt/state/graphify-skip-reason.txt explains why.</graph_impact>
<symptoms>Read .devt/state/debug-context.md</symptoms>
<agent_skills>{injected from .devt/config.json if available}</agent_skills>
</context>
<bug>{bug_description}</bug>
Follow the 4-phase investigation protocol. Write findings to .devt/state/debug-summary.md.

Your tool surface does not include `mcp__*graphify*`. Use the `<scope_hint>` block (derived from preflight Brief blast-radius) as the high-signal starting set for hypothesis formation, then validate with Grep/Read. When `<scope_trust>.trust` is `empty`, fall back to following the stack trace from the symptom.
")
</step>

<step name="report" gate="results presented to user">
## Step 4: Report Results

Read `.devt/state/debug-summary.md`:

- **FIXED**: report fix, run quality gates to verify. Confirm that the debugger agent appended an entry to its persistent memory at `.claude/agent-memory/devt-debugger/MEMORY.md` (the agent does this automatically).
- **NEEDS_MORE_INVESTIGATION**: show what was discovered, offer to re-run /devt:debug with accumulated context
- **DONE_WITH_CONCERNS**: debugger hit the 3-attempt limit on a fix. Report what was tried, what remains, and suggest next steps (manual fix or architectural review via `/devt:arch-health`)
- **BLOCKED**: surface root cause analysis, suggest architectural review

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=debug status=DONE active=false
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
