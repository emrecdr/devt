# Architecture Health Scan Workflow

Scan the codebase for architecture health: layer violations, coupling issues, circular dependencies, structural drift, and convention inconsistencies.

---

<prerequisites>
- `.devt.json` exists in project root (run `/init` first if not)
- `.dev-rules/architecture.md` exists with architectural rules
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>
The following agent type is used in this workflow:
- `devt:architect` — structural review specialist, READ-ONLY (Read, Bash, Glob, Grep)

Not used in this workflow:
- `devt:programmer` — implementation specialist
- `devt:tester` — testing specialist
- `devt:code-reviewer` — code review specialist
- `devt:docs-writer` — documentation specialist
- `devt:retro` — lesson extraction specialist
- `devt:curator` — playbook quality maintenance specialist
</available_agent_types>

<agent_skill_injection>
Before dispatching the architect agent, check `.devt.json` for an `agent_skills` configuration block:

```json
{
  "agent_skills": {
    "architect": ["architecture-health-scanner"]
  }
}
```

If `agent_skills.architect` exists, inject the skill references into the agent's prompt context:

```
<agent_skills>
  Load and follow these skill protocols before starting work:
  - ${CLAUDE_PLUGIN_ROOT}/skills/<skill_name>/  (for each skill listed)
</agent_skills>
```

If not configured, omit the block.
</agent_skill_injection>

---

## Steps

<step name="check_scanner" gate="scanner configuration is determined">

Check if `.devt.json` has an `arch_scanner.command` configured:

```bash
node -e "
  const cfg = JSON.parse(require('fs').readFileSync('.devt.json', 'utf8'));
  const cmd = cfg.arch_scanner?.command;
  console.log(cmd ? 'SCANNER:' + cmd : 'NO_SCANNER');
"
```

Record the result:
- If a scanner command is configured: it will be run in the next step
- If no scanner is configured: the architect agent will perform a manual analysis
</step>

<step name="run_scanner" gate="scanner output is captured (or skipped if no scanner)">

**If a scanner command is configured**: Execute it and capture the output.

```bash
$SCANNER_COMMAND 2>&1 | tee .devt-state/scanner-output.txt
```

Capture the exit code. Even if the scanner reports findings (non-zero exit), continue to the architect step — the architect will interpret the results.

If the scanner command fails to execute (command not found, permission denied), report the error and fall through to manual analysis by the architect.

**If no scanner is configured**: Skip this step. The architect agent will perform the analysis manually using Grep/Glob.
</step>

<step name="architect_analysis" gate="arch-review.md is written to .devt-state/">

Dispatch the architect agent to interpret scanner results or perform manual analysis:

```
Task(subagent_type="devt:architect", model="{models.architect}", prompt="
  <task>
    Perform a comprehensive architecture health scan of the codebase.
    Assess: module boundaries, dependency direction, coupling, structural duplication,
    data flow integrity, and convention compliance.

    If scanner output is available in .devt-state/scanner-output.txt, use it as input
    and focus on interpreting and prioritizing the findings.

    If no scanner output is available, perform the analysis manually by scanning
    imports, module structure, and cross-module references.
  </task>
  <context>
    <files_to_read>.dev-rules/architecture.md, CLAUDE.md (if exists)</files_to_read>
    <scanner_output>Read .devt-state/scanner-output.txt (if exists)</scanner_output>
    <agent_skills>{injected from .devt.json if available}</agent_skills>
  </context>
  Write findings to .devt-state/arch-review.md
")
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/architecture-health-scanner/` for additional analysis patterns the architect can use.
</step>

<step name="report" gate="findings are presented to the user with priorities">

Read `.devt-state/arch-review.md` and present findings to the user, organized by priority:

**Critical** (fix now — active breakage or security risk):
- List each finding with location, description, and impact

**Important** (fix soon — will cause problems as the system grows):
- List each finding with location, description, and impact

**Minor** (improve when touching the area):
- List each finding with location, description, and impact

**Health summary**:
- Overall assessment (healthy / needs attention / at risk)
- Areas of strength
- Areas needing improvement
- Recommended next actions (ordered by priority)

This is a READ-ONLY workflow. Do NOT offer to fix findings. If the user wants fixes, they should create tasks for specific issues and run `/implement` or `/workflow`.

Final status: **DONE**
</step>

---

<deviation_rules>
1. **Auto-fix: bugs** — Not applicable. This is a READ-ONLY workflow.
2. **Auto-fix: lint** — Not applicable.
3. **Auto-fix: deps** — If the scanner command is not found, fall through to manual architect analysis. Do not STOP.
4. **STOP: architecture** — If `.dev-rules/architecture.md` does not exist, STOP with NEEDS_CONTEXT. The architect cannot review without knowing the rules.
</deviation_rules>

<success_criteria>
- Architecture scan is complete (manual or scanner-assisted)
- Findings are categorized by severity (Critical / Important / Minor)
- Each finding has: location, description, severity, and impact
- Recommendations are actionable and prioritized
- No code was modified (READ-ONLY)
- Final status: **DONE**
</success_criteria>
