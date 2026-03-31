# Architecture Health Scan Workflow

Scan the codebase for architecture health: layer violations, coupling issues, circular dependencies, structural drift, and convention inconsistencies.

Supports **delta mode** (only new issues since last scan) and **triage persistence** (accept/dismiss/defer decisions survive across scans).

---

<modes>
## Scan Modes

Determined by arguments passed to `/devt:arch-health`:

- **(default) Delta mode**: Compare against last baseline. Show only NEW findings since the last scan. If no baseline exists, runs as full mode and saves the first baseline.
- **`--all`**: Full mode. Show ALL findings regardless of baseline. Useful for periodic comprehensive review.
- **`--update-baseline`**: Save the current scan results as the new baseline. Run this after triaging all findings to reset the delta.
- **`--triage`**: Interactive mode. Walk through untriaged findings one at a time, classifying each as accept/dismiss/defer.
  </modes>

<prerequisites>
- `.devt/config.json` exists in project root (run `/init` first if not)
- `.devt/rules/architecture.md` exists with architectural rules
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
Before dispatching the architect agent, check `.devt/config.json` for an `agent_skills` configuration block:

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

Track state so `/devt:status` and `/devt:next` can detect and resume interrupted scans:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true phase=arch_health_scan status=IN_PROGRESS
```

<step name="check_scanner" gate="scanner configuration is determined">

Check if `.devt/config.json` has an `arch_scanner.command` configured:

```bash
node -e "
  const cfg = JSON.parse(require('fs').readFileSync('.devt/config.json', 'utf8'));
  const cmd = cfg.arch_scanner?.command;
  console.log(cmd ? 'SCANNER:' + cmd : 'NO_SCANNER');
"
```

Record the result:

- If a scanner command is configured: it will be run in the next step
- If no scanner is configured: the architect agent will perform a manual analysis

Also check for existing baseline and triage data:

```bash
test -f .devt/state/arch-baseline.json && echo "BASELINE_EXISTS" || echo "NO_BASELINE"
test -f .devt/state/arch-triage.json && echo "TRIAGE_EXISTS" || echo "NO_TRIAGE"
```

</step>

<step name="run_scanner" gate="scanner output is captured (or skipped if no scanner)">

**If a scanner command is configured**: Execute it and capture the output.

```bash
$SCANNER_COMMAND 2>&1 | tee .devt/state/scanner-output.txt
```

Capture the exit code. Even if the scanner reports findings (non-zero exit), continue to the architect step — the architect will interpret the results.

If the scanner command fails to execute (command not found, permission denied), report the error and fall through to manual analysis by the architect.

**If no scanner is configured**: Skip this step. The architect agent will perform the analysis manually using Grep/Glob. Write the manual analysis to `.devt/state/scanner-output.txt` for baseline consistency.
</step>

<step name="baseline_delta" gate="delta computed (or full mode selected)">

### Baseline & Delta Logic

**If `--update-baseline`**: Save current scan results as the new baseline and stop.

```bash
# Copy current scan output as new baseline
cp .devt/state/scanner-output.txt .devt/state/arch-baseline.json 2>/dev/null || true
```

Report: "Baseline updated with N findings. Future scans will show only new issues."
STOP here — do not proceed to analysis.

**If `--all`**: Skip delta computation. Pass ALL findings to the architect.

**If default (delta mode)**:

1. Read `.devt/state/arch-baseline.json` if it exists
2. Compare current findings against baseline:
   - **New findings**: present in current scan but NOT in baseline → report these
   - **Resolved findings**: present in baseline but NOT in current scan → note as resolved
   - **Unchanged findings**: present in both → skip (already triaged)
3. If no baseline exists: treat as first scan. Save current results as baseline after analysis.

Write the delta summary to `.devt/state/scan-delta.md`:

```markdown
# Scan Delta

## New Findings (N)

{list new findings for architect to analyze}

## Resolved Since Last Scan (N)

{list findings that no longer appear — good news}

## Unchanged (N — skipped)

{count of findings already in baseline, not re-analyzed}
```

Pass only NEW findings to the architect for classification.
</step>

<step name="triage_mode" gate="triage complete (or triage mode not selected)">

### Interactive Triage (only if `--triage`)

_Skip this step unless `--triage` was specified._

Read `.devt/state/arch-triage.json` if it exists (prior triage decisions).

For each untriaged finding, present to the user via AskUserQuestion:

```yaml
question: "Finding: {category} in {module} — {description}"
header: "Triage: {finding_id}"
multiSelect: false
options:
  - label: "Accept — true positive, needs fixing"
    description: "Add to Fix Now or Fix Soon based on severity"
  - label: "Dismiss — false positive"
    description: "Scanner limitation or acceptable design. Provide reason."
  - label: "Defer — revisit later"
    description: "Not urgent, skip for now but keep on radar"
  - label: "Stop triage"
    description: "Save progress and stop — remaining findings stay untriaged"
```

Save each decision to `.devt/state/arch-triage.json`:

```json
{
  "decisions": {
    "{finding_fingerprint}": {
      "decision": "accept|dismiss|defer",
      "reason": "{user's reason if dismiss}",
      "date": "YYYY-MM-DD"
    }
  }
}
```

If "Stop triage" selected: save progress, report how many triaged vs remaining, and proceed to report.

Triage decisions persist across scans — dismissed findings won't resurface in delta mode unless the underlying code changes.
</step>

<step name="architect_analysis" gate="arch-review.md is written to .devt/state/">

Dispatch the architect agent to interpret findings:

```
Task(subagent_type="devt:architect", model="{models.architect}", prompt="
  <task>
    Perform a comprehensive architecture health scan of the codebase.
    Assess: module boundaries, dependency direction, coupling, structural duplication,
    data flow integrity, and convention compliance.

    If scanner output is available in .devt/state/scanner-output.txt, use it as input
    and focus on interpreting and prioritizing the findings.

    If a delta summary exists in .devt/state/scan-delta.md, focus ONLY on the new
    findings listed there — skip unchanged findings.

    If triage decisions exist in .devt/state/arch-triage.json, respect them:
    skip dismissed findings, prioritize accepted findings, note deferred findings.

    If no scanner output is available, perform the analysis manually by scanning
    imports, module structure, and cross-module references.
  </task>
  <context>
    <files_to_read>
      .devt/rules/architecture.md — layer rules, module boundaries, dependency direction
      .devt/rules/coding-standards.md — coding conventions, forbidden patterns, entity standards
      .devt/rules/testing-patterns.md — test structure, coverage rules, soft-delete testing requirements
      .devt/rules/golden-rules.md (if exists) — non-negotiable project rules
      .devt/rules/patterns/common-smells.md (if exists) — project-specific anti-patterns with detection commands
      CLAUDE.md (if exists)
    </files_to_read>
    <scanner_output>Read .devt/state/scanner-output.txt (if exists)</scanner_output>
    <delta>Read .devt/state/scan-delta.md (if exists)</delta>
    <triage>Read .devt/state/arch-triage.json (if exists)</triage>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write findings to .devt/state/arch-review.md
")
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/architecture-health-scanner/` for additional analysis patterns the architect can use.
</step>

<step name="report" gate="findings are presented to the user with priorities">

Read `.devt/state/arch-review.md` and present findings to the user, organized by priority:

**Critical** (fix now — active breakage or security risk):

- List each finding with location, description, and impact

**Important** (fix soon — will cause problems as the system grows):

- List each finding with location, description, and impact

**Minor** (improve when touching the area):

- List each finding with location, description, and impact

**Delta summary** (if delta mode was used):

- New findings since last scan: N
- Resolved since last scan: N
- Unchanged (skipped): N

**Triage summary** (if triage data exists):

- Accepted: N findings awaiting fix
- Dismissed: N findings (false positives)
- Deferred: N findings (revisit later)
- Untriaged: N findings

**Health summary**:

- Overall assessment (healthy / needs attention / at risk)
- Areas of strength
- Areas needing improvement
- Trend (improving / stable / degrading) — compare new vs resolved counts

**Recommended next actions** (ordered by priority):

- If many new findings: "Run `/devt:arch-health --triage` to classify findings"
- If many accepted findings: "Create tasks with `/devt:workflow` to fix critical issues"
- If scan is clean: "Run `/devt:arch-health --update-baseline` to save this clean state"

If this was the first scan (no prior baseline), save the results as baseline automatically.

This is a READ-ONLY workflow. Do NOT offer to fix findings inline. If the user wants fixes, they should create tasks for specific issues and run `/devt:workflow`.

Save the report to `.devt/state/arch-review.md` and also to the report directory:

```bash
REPORT_DIR=$(node -e "const c=JSON.parse(require('fs').readFileSync('.devt/config.json','utf8'));process.stdout.write((c.arch_scanner&&c.arch_scanner.report_dir)||'docs/reports')" 2>/dev/null || echo "docs/reports")
mkdir -p "$REPORT_DIR"
cp .devt/state/arch-review.md "$REPORT_DIR/ARCHITECTURE-HEALTH-REPORT.md"
```

Report: "Saved to $REPORT_DIR/ARCHITECTURE-HEALTH-REPORT.md"

Final status: **DONE**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=arch_health_scan status=DONE
```
</step>

---

<deviation_rules>

1. **Auto-fix: bugs** — Not applicable. This is a READ-ONLY workflow.
2. **Auto-fix: lint** — Not applicable.
3. **Auto-fix: deps** — If the scanner command is not found, fall through to manual architect analysis. Do not STOP.
4. **STOP: architecture** — If `.devt/rules/architecture.md` does not exist, STOP with NEEDS_CONTEXT. The architect cannot review without knowing the rules.
   </deviation_rules>

<success_criteria>

- Architecture scan is complete (manual or scanner-assisted)
- Findings are categorized by severity (Critical / Important / Minor)
- Each finding has: location, description, severity, and impact
- Recommendations are actionable and prioritized
- No code was modified (READ-ONLY)
- Final status: **DONE**
  </success_criteria>
