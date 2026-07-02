# Architecture Health Scan Workflow

Scan the codebase for architecture health: layer violations, coupling issues, circular dependencies, structural drift, and convention inconsistencies.

Supports **delta mode** (only new issues since last scan) and **triage persistence** (accept/dismiss/defer decisions survive across scans).

---

<modes>
## Scan Modes

Determined by arguments passed to `/devt:review --focus=arch`:

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
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=arch_health_scan phase=arch_health_scan status=IN_PROGRESS stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null
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

**Convention probe when NO_SCANNER.** Before falling through to manual analysis, probe conventional scanner locations and surface any discovery so the user can wire it. Mirrors the `graphify.probeBinary` capability-probe pattern. Probe order: `.devt/rules/arch-scan.py` (the project-scoped devt convention used by the python-fastapi template), `.devt/rules/arch-scan.sh`, `tests/architecture/arch-scan.py`, `scripts/arch-scan.py`.

```bash
if [ "$(echo "$SCANNER_RESULT" | head -1)" = "NO_SCANNER" ]; then
  for candidate in .devt/rules/arch-scan.py .devt/rules/arch-scan.sh tests/architecture/arch-scan.py scripts/arch-scan.py; do
    if [ -f "$candidate" ]; then
      DETECTED_SCANNER="$candidate"
      break
    fi
  done
fi
```

If `$DETECTED_SCANNER` is non-empty, AskUserQuestion before continuing:

- **Question**: "Found a project scanner at `$DETECTED_SCANNER` but it's not wired into `.devt/config.json::arch_scanner.command`. Wire it now so future arch-health scans use it?"
- **Options**:
  - **Wire automatically** — runs `node bin/devt-tools.cjs config set arch_scanner.command="python3 $DETECTED_SCANNER --baseline .devt/state/arch-baseline.json --report .devt/state/arch-scan-report.md --json --fail-on critical,high"`, then re-reads config and continues with the new scanner.
  - **Show me the command** — prints the exact `config set` invocation so the user can run it externally, then continues with manual analysis for THIS run.
  - **Skip — manual only** — continues with the manual-analysis path; no config change.

Recovery for first-run baseline (only needed when wiring): the scanner expects `--baseline .devt/state/arch-baseline.json` to exist. If it doesn't, the user should run `python3 $DETECTED_SCANNER --write-baseline .devt/state/arch-baseline.json` once to capture current findings as "accepted floor". The wire-automatically branch handles this by writing the baseline if absent before the next scan.

Record the result:

- If a scanner command is configured (originally or via auto-wire): it will be run in the next step
- If no scanner is configured AND no candidate detected (or user chose Skip): the architect agent will perform a manual analysis

Also check for existing baseline and triage data:

```bash
test -f .devt/state/arch-baseline.json && echo "BASELINE_EXISTS" || echo "NO_BASELINE"
test -f .devt/state/arch-triage.json && echo "TRIAGE_EXISTS" || echo "NO_TRIAGE"
```

</step>

<step name="run_scanner" gate="scanner output is captured (or skipped if no scanner)">

**Observability emit (before scanner runs).** Append a scan-start record to gate-trace.jsonl so cal cycles can measure scanner usage patterns:

```bash
SCAN_ID="$(date +%Y%m%d-%H%M%S)"
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state arch-scan-trace scan-start --scan-id="$SCAN_ID" --scanner="$SCANNER_COMMAND" >/dev/null
```

**If a scanner command is configured**: Execute it and capture the output.

```bash
$SCANNER_COMMAND 2>&1 | tee .devt/state/scanner-output.txt
```

Capture the exit code. Even if the scanner reports findings (non-zero exit), continue to the architect step — the architect will interpret the results.

**Observability emit (after scanner completes).** Compute finding count + baseline delta from the scanner output JSON when available, then trace:

```bash
if [ -f .devt/state/arch-scan-report.md ]; then
  # Best-effort finding count from the report's "## Findings (N)" header
  FINDING_COUNT=$(grep -oE 'Findings \([0-9]+\)' .devt/state/arch-scan-report.md | grep -oE '[0-9]+' | head -1)
  FINDING_COUNT="${FINDING_COUNT:-0}"
  # Baseline delta from arch-baseline.json + scan-delta.md if both present
  BASELINE_DELTA="${BASELINE_DELTA:-0}"
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state arch-scan-trace scan-complete \
    --scan-id="$SCAN_ID" --finding-count="$FINDING_COUNT" --baseline-delta="$BASELINE_DELTA" >/dev/null
fi
```

If the scanner command fails to execute (command not found, permission denied), report the error and fall through to manual analysis by the architect.

**If no scanner is configured**: Skip this step. The architect agent will perform the analysis manually using Grep/Glob. Write the manual analysis to `.devt/state/scanner-output.txt` for baseline consistency.
</step>

<step name="evolution_scan" gate="evolution report captured (or gracefully skipped)">

Run the language-agnostic evolution scan — git-history behavioral metrics the snapshot scanner cannot see (hotspots, change coupling, fix density, ownership):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" evolution scan
```

Writes `.devt/state/evolution-report.md` (architect input) + `.devt/state/evolution-report.json` (full data). Degrades gracefully: `{ok:false}` outside a git repository or when git is unavailable — continue without evolution data, do NOT stop.

This step is independent of the structural scanner result and runs in both scanner-assisted and manual-analysis paths.
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
    <evolution>Read .devt/state/evolution-report.md (if exists) — git-history hotspots, change coupling, fix density</evolution>
    <delta>Read .devt/state/scan-delta.md (if exists)</delta>
    <triage>Read .devt/state/arch-triage.json (if exists)</triage>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
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

    If an evolution report exists in .devt/state/evolution-report.md, use it to
    EFFORT-WEIGHT your findings: a violation in a top hotspot file outranks the
    same violation in cold code (state the hotspot rank when elevating). Flag
    change-coupling pairs that lack a structural relationship (no import/call
    edge) as hidden-coupling findings — likely a missing abstraction or
    copy-paste twins. High churn/loc + high fix count = bleeding edge; note it
    in the health summary trend.

    **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing arch-review.md): per your `knowledge_candidates` step, if your assessment surfaces architectural rules / patterns worth promoting (cross-component invariants, "this layer cannot depend on that layer", non-obvious design constraints), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write findings to .devt/state/arch-review.md
")
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/architecture-health-scanner/` for additional analysis patterns the architect can use.

**Claim-check (Q11)**: Before reading the artifact for the report step, mechanically verify the architect wrote its declared output. Catches the case where the architect returned a verbal summary without actually writing arch-review.md.

```bash
ARTIFACT_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present architect)
if [ "$(echo "$ARTIFACT_CHECK" | jq -r '.ok')" != "true" ]; then
  echo "[BLOCKED] devt: $(echo "$ARTIFACT_CHECK" | jq -r '.reason')"
fi
```

If the claim-check BLOCKED: architect did not write arch-review.md. Re-dispatch with explicit instruction to write the artifact before returning, OR SendMessage-resume if a budget wall is suspected (check `.devt/state/dispatch-warnings.jsonl` for `near_cliff` / `low_output` / `mid_task_language` records). Layer-2 at finalize will catch unresolved failures.
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

**Evolution summary** (if evolution-report.json exists):

- Top hotspots overlapping findings (finding severity × hotspot rank = fix-first list)
- Hidden coupling pairs (co-change without structural edge)
- Bleeding-edge files (high churn/loc + high fix density)

**Health summary**:

- Overall assessment (healthy / needs attention / at risk)
- Areas of strength
- Areas needing improvement
- Trend (improving / stable / degrading) — compare new vs resolved counts

**Recommended next actions** (ordered by priority):

- If many new findings: "Run `/devt:review --focus=arch --triage` to classify findings"
- If many accepted findings: "Create tasks with `/devt:workflow` to fix critical issues"
- If scan is clean: "Run `/devt:review --focus=arch --update-baseline` to save this clean state"

If this was the first scan (no prior baseline), save the results as baseline automatically.

This is a READ-ONLY workflow. Do NOT offer to fix findings inline. If the user wants fixes, they should create tasks for specific issues and run `/devt:workflow`.

Save the report to `.devt/state/arch-review.md` and also to the report directory:

```bash
REPORT_DIR=$(node -e "const c=JSON.parse(require('fs').readFileSync('.devt/config.json','utf8'));process.stdout.write((c.arch_scanner&&c.arch_scanner.report_dir)||'docs/reports')" 2>/dev/null || echo "docs/reports")
mkdir -p "$REPORT_DIR"
# Write BOTH the canonical "latest" pointer AND a dated archive so report
# history is preserved without breaking downstream references to the canonical
# name. ARCHITECTURE-HEALTH-REPORT.md gets overwritten each scan (always
# current); ARCHITECTURE-HEALTH-REPORT-YYYY-MM-DD.md is the permanent archive
# entry for trend analysis.
SCAN_DATE=$(date +%Y-%m-%d)
cp .devt/state/arch-review.md "$REPORT_DIR/ARCHITECTURE-HEALTH-REPORT.md"
cp .devt/state/arch-review.md "$REPORT_DIR/ARCHITECTURE-HEALTH-REPORT-${SCAN_DATE}.md"
```

Report: "Saved to $REPORT_DIR/ARCHITECTURE-HEALTH-REPORT.md (latest) + ARCHITECTURE-HEALTH-REPORT-${SCAN_DATE}.md (archive)"

Final status: **DONE**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state advance-phase arch_health_scan active=false
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

## Memory layer integration — Stale ADR detection

Arch-health gains a new finding type: **Stale ADR**. For each active ADR in
`.devt/memory/decisions/`, verify:
1. `affects_paths` resolve to existing files (path-based — always available)
2. `affects_symbols` exist in the codebase (Graphify-anchored when enabled)
A stale ADR is flagged in arch-review.md with severity Important — curator can either
update its `affects_*` fields or supersede the ADR with a new one. This catches the
common drift where a refactor renames a class but the ADR still references the old name
(the "Symbol Decay" failure mode the memory layer was designed to prevent).
