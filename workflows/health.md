# Health — Plugin Diagnostics

Check the integrity of devt configuration, state, and project setup.

<purpose>
Catch configuration problems before they cause confusing agent failures.
Run after interrupted sessions, failed workflows, or when things feel broken.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<deviation_rules>
1. **Auto-fix: minor issues** — Fix typos, formatting, and obvious errors inline
2. **STOP: scope creep** — If the task grows beyond diagnostics into fixing code or workflow issues, suggest the appropriate workflow instead
3. **STOP: destructive repairs** — Do not auto-fix state issues (e.g., deleting .devt/state/); only report problems and suggest specific fix commands
</deviation_rules>

<process>

<step name="check_config" gate="all checks complete">
## Check 1: Plugin Configuration

- [ ] E001: .devt/config.json exists (or defaults are sufficient)
- [ ] E002: .devt/rules/ directory exists
- [ ] E003: Required .devt/rules/ files present (coding-standards.md, testing-patterns.md, quality-gates.md)
- [ ] W001: .devt/rules/architecture.md exists (recommended)
- [ ] W002: .devt/rules/documentation.md exists (recommended)
- [ ] I001: CLAUDE.md exists (informational)

Run: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow "health-check"`
Parse the output for warnings and missing_rules.
</step>

<step name="check_state">
## Check 2: Workflow State

- [ ] E004: .devt/state/ directory exists (if workflow was run)
- [ ] W003: workflow.yaml is not stale (active: true but no recent activity)
- [ ] W004: No orphaned .devt/state/ artifacts (files from a different workflow run)
- [ ] W005: handoff.json exists if workflow was paused

Check workflow.yaml:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read
```

If active: true but no recent artifacts, warn about stale state.
</step>

<step name="check_hooks">
## Check 3: Hook Health

- [ ] W006: All hook scripts are executable
- [ ] W007: Node.js is available (required for CLI tools)
- [ ] W008: Quality gate verifier agent hook is configured (recommended)
- [ ] I002: Python is available (optional, for learning loop)

```bash
# Check executability
for script in "${CLAUDE_PLUGIN_ROOT}"/hooks/*.sh; do
  test -x "$script" || echo "WARNING: $script is not executable"
done

# Check Node.js
which node >/dev/null 2>&1 || echo "ERROR: Node.js not found"

# Check Python (optional)
which python3 >/dev/null 2>&1 || echo "INFO: Python3 not found (learning loop features unavailable)"
```

Check if the quality gate verifier agent hook is configured in the user's settings:
- Look for a Stop hook with `type: "agent"` in `.claude/settings.json` (project-level) or `~/.claude/settings.json` (user-level)
- If not found: `W008: Quality gate verifier agent hook not configured. See ${CLAUDE_PLUGIN_ROOT}/hooks/quality-gate-verifier.md for setup instructions.`
- If found: mark as passing
</step>

<step name="check_artifacts">
## Check 4: Artifact Integrity (if workflow active)

If .devt/state/ contains artifacts, verify consistency:
- impl-summary.md mentions files → do those files exist on disk?
- review.md has a verdict → is it a valid status enum value?
- workflow.yaml phase → do expected artifacts for that phase exist?
</step>

<step name="report">
## Report

Format results:

```
devt Health Check
═════════════════
Errors (must fix):
  E001: [description] → FIX: [specific action]

Warnings (should fix):
  W001: [description] → FIX: [specific action]

Info:
  I001: [description]

Status: HEALTHY | NEEDS_ATTENTION | BROKEN
```

If BROKEN: suggest /devt:cancel-workflow to reset state, consult `${CLAUDE_PLUGIN_ROOT}/guardrails/incident-runbook.md` for recovery procedures
If NEEDS_ATTENTION: list specific fixes
If HEALTHY: "All systems operational"
</step>

</process>

<success_criteria>
- All checks executed
- Clear error/warning/info categorization
- Every issue has a specific fix suggestion
- Status reflects actual health
</success_criteria>
