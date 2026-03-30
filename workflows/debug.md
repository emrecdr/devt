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
Before dispatching the debugger agent, check `.devt/config.json` for `agent_skills.debugger`. If not configured, consult `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` for defaults (codebase-scan).
</agent_skill_injection>

<process>

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
<bug>{bug_description}</bug>
<context>
<files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md</files_to_read>
<symptoms>Read .devt/state/debug-context.md</symptoms>
</context>
Follow the 4-phase investigation protocol. Write findings to .devt/state/debug-summary.md
")
</step>

<step name="report" gate="results presented to user">
## Step 4: Report Results

Read `.devt/state/debug-summary.md`:

- **FIXED**: report fix, run quality gates to verify. Confirm that `debug-knowledge-base.md` was updated with the root cause (the debugger agent does this automatically).
- **NEEDS_MORE_INVESTIGATION**: show what was discovered, offer to re-run /devt:debug with accumulated context
- **BLOCKED**: surface root cause analysis, suggest architectural review
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
