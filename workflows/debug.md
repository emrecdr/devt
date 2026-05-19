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

**Auto-fire Pre-Flight Brief**:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "${BUG_DESCRIPTION}"
```

This produces `.devt/state/preflight-brief.md` so the debugger reads governing rules + REJ tombstones before proposing fixes (especially load-bearing for "we already tried that" cases). Skip silently if the call fails.

**Cache the scope hint** for `<scope_hint>` injection. `preflight generate` writes `preflight-brief.json` alongside the markdown; its `suggested_reading` field is the deduped union of governing docs' `affects_paths` plus blast-radius `direct_dependents`, capped at 8 — high-leverage starting set for the debugger's hypothesis search:

```bash
SCOPE_HINT=$(jq -c '.suggested_reading // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
SCOPE_TRUST=$(jq -c '{trust: (.graph_stats.trust // "empty"), lag_commits: .staleness.lag_commits, fresh: (.staleness.fresh // false)}' .devt/state/preflight-brief.json 2>/dev/null || echo '{}')
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update scope_hint_json="${SCOPE_HINT}" scope_trust_json="${SCOPE_TRUST}"
```

**Staleness gate** — If `preflight-brief.json::staleness.lag_commits > graphify.stale_threshold` (default 30; `null` disables), prompt the user via AskUserQuestion BEFORE the debugger dispatch: "Graphify graph is {lag_commits} commits behind HEAD; symbol-to-file mappings may be stale. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed. Skip when graphify disabled or lag_commits is null.

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
<symptoms>Read .devt/state/debug-context.md</symptoms>
<agent_skills>{injected from .devt/config.json if available}</agent_skills>
</context>
<bug>{bug_description}</bug>
Follow the 4-phase investigation protocol. Write findings to .devt/state/debug-summary.md.

Graphify-first investigation protocol (when `<scope_trust>.trust` is `dense` or `sparse`):
Use `mcp__devt-graphify__*` PROACTIVELY during the hypothesis-formation phase:
  1. `mcp__devt-graphify__query_graph({text: "<bug_topic>"})` to anchor candidate symbols from the symptom description.
  2. `mcp__devt-graphify__shortest_path({source, target})` when the symptom names two endpoints (e.g. "HTTP request to DB write" — find the call path).
  3. `mcp__devt-graphify__get_neighbors({symbol, direction:"in"})` on the suspect symbol — the caller set tells you which call sites would have hit the bug.
  4. `mcp__devt-graphify__blast_radius({symbols: [suspect]})` once a fix candidate is forming, to size the regression surface.
Use `Grep`/`Read` to VALIDATE graph findings (line content, comments), NOT to discover the call topology from scratch. A fix proposal that doesn't enumerate callers via graphify is leaving fixed-but-broken-elsewhere risk on the table.
Empty/degraded responses (`{degraded: true}`) are normal signals to fall back — proceed with Grep+Read for that query. When `<scope_trust>.trust` is `empty`, skip the protocol entirely.
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
