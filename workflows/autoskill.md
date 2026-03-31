# Autoskill — Plugin Self-Improvement

Analyze the current session for patterns that suggest skill or agent improvements.

<purpose>
Detect repeated corrections, missing capabilities, and workflow friction points.
Propose targeted improvements to skills and agents with evidence (3+ instances required).
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `.devt/state/` may contain workflow artifacts from the current session
- `node` is available on PATH
</prerequisites>

<available_agent_types>
The following agent types may be dispatched for applying accepted proposals:

- `devt:programmer` — implementation specialist (Read, Write, Edit, Bash, Glob, Grep)
- `devt:curator` — playbook quality maintenance specialist (Read, Write, Edit, Bash, Glob, Grep)

Note: This workflow applies most changes directly. Agents are dispatched only when proposals require complex implementation that benefits from a focused agent context.
</available_agent_types>

<agent_skill_injection>
Before dispatching any agent, check `.devt/config.json` for an `agent_skills` configuration block.

If `agent_skills.<agent_type>` exists, inject the skill references into the agent's prompt context:

```
<agent_skills>
  Load and follow these skill protocols before starting work:
  - ${CLAUDE_PLUGIN_ROOT}/skills/<skill_name>/  (for each skill listed)
</agent_skills>
```

If `agent_skills` is not configured or the key is missing for the agent type, consult `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` for the default agent-to-skill mapping and inject those defaults.
</agent_skill_injection>

<deviation_rules>
1. **Auto-fix: minor issues** — Fix typos, formatting, and obvious errors in proposals inline
2. **STOP: insufficient evidence** — If a signal has fewer than 3 instances, discard the proposal; do not lower the threshold
3. **STOP: scope creep** — If the user requests changes beyond skill/agent improvements, suggest the appropriate workflow instead (e.g., /devt:workflow for feature work)
4. **STOP: destructive changes** — Never delete or overwrite existing skills/agents without explicit user approval
</deviation_rules>

<process>

<step name="init" gate="project context loaded">
## Step 1: Initialize

Read the current session's workflow artifacts from .devt/state/ (if they exist).
Read the learning playbook for historical patterns.
Read `${CLAUDE_PLUGIN_ROOT}/guardrails/skill-update-guidelines.md` — safe patterns for evolving the plugin.
</step>

<step name="detect" gate="signals identified">
## Step 2: Detect Improvement Signals

Scan for:
1. **Repeated corrections** — same type of mistake fixed 3+ times
2. **Missing capabilities** — tasks that required manual workarounds
3. **Workflow friction** — steps that consistently produce DONE_WITH_CONCERNS or BLOCKED
4. **Pattern gaps** — .devt/rules/ conventions not enforced by any agent/skill

For each signal, record: what happened, how many times, which files/agents involved.
</step>

<step name="propose" gate="proposals have 3+ evidence instances each">
## Step 3: Generate Proposals

For each valid signal (3+ evidence instances), create a proposal:

```
### Proposal: [Short title]

**Type**: skill-update | agent-update | new-skill | new-rule
**Target**: [which skill/agent/file to change]
**Evidence**: [3+ specific instances from this session]
**Change**: [what to add/modify]
**Before**: [current behavior]
**After**: [improved behavior]
**Risk**: LOW | MEDIUM (HIGH = needs user design review)
```

Filter: proposals with < 3 evidence instances are discarded.
</step>

<step name="present" gate="user has reviewed proposals">
## Step 4: Present to User

Show all proposals. Do NOT auto-apply any changes.
Ask user which proposals to accept.
For accepted proposals, write the changes.
</step>

<step name="audit" gate="changelog entry appended">
## Step 5: Record in Autoskill Changelog

For each accepted and applied proposal, append an entry to `.devt/autoskill-changelog.md`.

If the file does not exist, create it from `${CLAUDE_PLUGIN_ROOT}/templates/autoskill-changelog.md`.

Append one entry per accepted proposal:

```yaml
- date: "YYYY-MM-DDTHH:MM:SSZ"
  type: skill-update | agent-update | new-skill | new-rule
  target: "<file path that was modified>"
  change: "<one-line summary of what was changed>"
  evidence_count: <number of instances that triggered this>
  risk: LOW | MEDIUM
  approved_by: user
```

This is an append-only audit trail. Never edit or delete existing entries.
</step>

</process>

<success_criteria>
- All signals have 3+ evidence instances
- Proposals are specific (name the file, the change, the evidence)
- No proposals auto-applied without user approval
- Accepted changes written to the appropriate files
- Every accepted proposal recorded in `.devt/autoskill-changelog.md`
</success_criteria>
