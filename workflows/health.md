# Health — Plugin Diagnostics

Validate devt project configuration, state, and plugin integrity.

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
1. **Auto-fix: minor issues** — Use `--repair` flag to fix safe issues automatically
2. **STOP: scope creep** — If the task grows beyond diagnostics, suggest the appropriate workflow instead
3. **STOP: destructive repairs** — Only auto-repair issues classified as repairable in the error registry
</deviation_rules>

<process>

<step name="run_health_check" gate="health check complete">

Run the health validation CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" health
```

Parse the JSON output:
- `status`: `"healthy"` | `"degraded"` | `"broken"`
- `version`: Installed plugin version (e.g., `"0.1.1"`)
- `update`: `{ available, installed, latest }` or `null` if no cache
- `issues[]`: Each has `code`, `severity`, `message`, `fix`, `repairable`
- `repairable_count`: Number of auto-fixable issues
- `project_root`: Resolved project root path

</step>

<step name="format_output" gate="results displayed to user">

Format and display:

```
devt Health Check
═════════════════
Version: {version}
Status:  HEALTHY | DEGRADED | BROKEN
```

**If update available:**
```
Update:  {installed} → {latest} available. Run /devt:update
```

**If ahead (development version):**
```
Update:  {installed} (dev — ahead of remote {latest})
```

**If up to date:**
```
Update:  {installed} (latest)
```

**If errors exist:**
```
Errors (must fix):
  E001: .devt/ directory not found
        → Run /devt:init to set up project, or /devt:health --repair
```

**If warnings exist:**
```
Warnings (should fix):
  W005: .devt/state/ not in .gitignore
        → Run /devt:health --repair to add .devt/state/ to .gitignore
```

**If info exists:**
```
Info:
  I001: CLAUDE.md not found (recommended)
```

**Footer (if repairable issues exist):**
```
{N} issues can be auto-repaired. Run: /devt:health --repair
```

</step>

<step name="offer_repair" gate="user has decided on repair">

**If repairable issues exist**, ask the user:

```yaml
question: "Auto-repair the fixable issues?"
header: "Repair"
multiSelect: false
options:
  - label: "Yes, repair now"
    description: "Auto-fix {N} safe issues (directories, config, permissions)"
  - label: "No, I'll fix manually"
    description: "Just show the fix commands"
```

**If user says yes**, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" health --repair
```

Parse the result:
- `repairs[]`: Each has `code`, `action`, `success`
- `initial_status`: Status before repair
- `status`: Status after repair (re-checked automatically)

Display repairs performed:
```
Repairs:
  ✓ E005: Created .devt/state/ directory
  ✓ W005: Added .devt/state/ to .gitignore
  ✓ W008: Made session-start.sh executable

Status: DEGRADED → HEALTHY
```

</step>

</process>

<error_codes>

| Code | Severity | Description | Repairable |
|------|----------|-------------|------------|
| E001 | error | .devt/ directory not found | Yes — creates it |
| E002 | error | .devt/config.json not found | Yes — creates with defaults |
| E003 | error | .devt/config.json invalid JSON | Yes — resets to defaults |
| E004 | error | .devt/rules/ not found | No — run /devt:init |
| E005 | error | .devt/state/ not found | Yes — creates it |
| E006 | error | Node.js not available | No |
| W001 | warning | coding-standards.md missing | No — run /devt:init --mode update |
| W002 | warning | testing-patterns.md missing | No — run /devt:init --mode update |
| W003 | warning | quality-gates.md missing | No — run /devt:init --mode update |
| W004 | warning | architecture.md missing | No — run /devt:init --mode update |
| W005 | warning | .devt/state/ not in .gitignore | Yes — appends entry |
| W006 | warning | Stale workflow (active but stopped >24h ago) | Yes — sets active=false |
| W007 | warning | VERSION / plugin.json version mismatch | No |
| W008 | warning | Hook script not executable | Yes — chmod +x |
| I001 | info | CLAUDE.md not found | No |
| I002 | info | Learning playbook not found | Yes — creates template |
| I003 | info | No active workflow | No |

</error_codes>

<repair_actions>

| Action | Effect | Risk |
|--------|--------|------|
| Create .devt/ | Creates base directory | None |
| Create config.json | Creates with default config | None — user can customize after |
| Create .devt/state/ | Creates state directory | None |
| Add .gitignore entry | Appends .devt/state/ | None |
| Clear stale workflow | Sets active=false | Loses "in-progress" marker |
| Fix permissions | chmod +x on hook scripts | None |
| Create playbook | Creates learning-playbook.md template | None |

**Not repairable (too risky):**
- Missing .devt/rules/ — requires template selection (run /devt:init)
- Missing rule files — requires template (run /devt:init --mode update)
- Invalid config values — requires user decision
- Version mismatch — requires manual version bump

</repair_actions>

<success_criteria>
- All checks executed via CLI (deterministic, not agent-interpreted)
- Clear error/warning/info categorization with codes
- Every issue has a specific fix suggestion
- Repairable issues listed with risk classification
- Post-repair verification confirms fixes
</success_criteria>
