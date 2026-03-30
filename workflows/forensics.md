# Forensics — Workflow Post-Mortem

Investigate a failed or stuck workflow to determine what went wrong and recommend recovery.

---

<purpose>
When a devt workflow fails, gets stuck, or produces unexpected results, this workflow performs
a structured post-mortem. It reads all available evidence without modifying anything.
</purpose>

<prerequisites>
- `.devt/state/` directory exists with at least one artifact
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session (READ-ONLY investigation).
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<deviation_rules>
1. **READ-ONLY**: This workflow must NOT modify any files. It is purely diagnostic.
2. **No speculation**: Report only what the evidence shows. If the cause is unclear, say so.
3. **STOP: if .devt/state/ is empty**: Nothing to investigate. Suggest running `/devt:status` instead.
</deviation_rules>

<process>

<step name="collect_state" gate="workflow state is read">
## Step 1: Collect Workflow State

Read the current workflow state:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read
```

Record:
- Which phase was active when the workflow stopped
- What tier (SIMPLE/STANDARD/COMPLEX) was selected
- Current iteration count
- Any verdict or status recorded
</step>

<step name="collect_artifacts" gate="all artifacts catalogued">
## Step 2: Catalogue Artifacts

List and read all `.devt/state/` artifacts:

```bash
ls -la .devt/state/*.md .devt/state/*.yaml .devt/state/*.json 2>/dev/null
```

For each artifact that exists, read it and record:
- **Status/verdict** (first lines after title)
- **Key findings** (errors, BLOCKED reasons, NEEDS_WORK findings, GAPS_FOUND lists)
- **Timestamps** (from git log if committed, or file modification time)

Priority artifacts:
1. `workflow.yaml` — last known state
2. `impl-summary.md` — did implementation complete?
3. `review.md` — was code review the failure point?
4. `verification.md` — did verification find gaps?
5. `debug-summary.md` — was debugging involved?
6. `scratchpad.md` — any deferred issues?
</step>

<step name="check_git" gate="recent git activity reviewed">
## Step 3: Check Git History

```bash
git log --oneline -10
git diff --stat
git status --porcelain
```

Look for:
- Uncommitted changes that may indicate interrupted work
- Recent commits that correlate with workflow phases
- Merge conflicts or failed rebases
</step>

<step name="check_quality_gates" gate="quality gate status known">
## Step 4: Run Quality Gates (Non-Destructive)

Read `.devt/rules/quality-gates.md` and run each gate command to determine current project health:

```bash
# Run lint, typecheck, tests — capture output, do not fix anything
```

Record which gates pass and which fail. Compare against `.devt/state/baseline-gates.md` if it exists.
</step>

<step name="diagnose" gate="root cause identified or classified as unknown">
## Step 5: Diagnose

Based on the collected evidence, determine:

1. **What failed**: Which phase/agent/gate was the point of failure?
2. **Why it failed**: What does the evidence say? (error messages, status values, git state)
3. **Contributing factors**: Was there state corruption, missing config, or context issues?

Common failure patterns:

| Pattern | Evidence | Likely Cause |
|---------|----------|--------------|
| Phase stuck at `implement` | impl-summary.md missing or BLOCKED | Programmer agent hit architectural wall or missing context |
| Review loop exhausted | review.md shows NEEDS_WORK, iteration=3 | Persistent quality issues not addressable within iteration budget |
| Verification gaps | verification.md shows GAPS_FOUND | Implementation doesn't match task requirements |
| Quality gate failure | Gates fail post-implementation | Regressions introduced; compare against baseline |
| State corruption | workflow.yaml has inconsistent values | Possible concurrent workflow or crash |
| Missing artifacts | Expected .devt/state/ files absent | Agent failed silently or hit turn limit |
</step>

<step name="report" gate="forensics report written">
## Step 6: Report

Present findings to the user (do NOT write to files — this is a verbal report):

```
## Forensics Report

### Timeline
{Reconstruct what happened step by step based on artifacts and git history}

### Point of Failure
{Phase}: {what went wrong}

### Root Cause
{Evidence-based explanation, or "Unknown — insufficient evidence" with what IS known}

### Current State
- Quality gates: {pass/fail summary}
- Uncommitted changes: {yes/no, what}
- Workflow state: {active/inactive, last phase}

### Recommended Recovery
{One of:}
- `/devt:cancel-workflow` then retry with adjusted task scope
- Fix the specific issue manually, then `/devt:workflow` to continue
- `/devt:debug` to investigate the underlying bug
- Reset state (`scripts/reset-workflow.sh`) and start fresh
```
</step>

</process>

<success_criteria>

- All available artifacts read and catalogued
- Git history reviewed for context
- Quality gates checked for current status
- Clear diagnosis with evidence (or honest "unknown")
- Actionable recovery recommendation provided
</success_criteria>
