# Weekly Report Workflow

Generate a structured weekly contribution report from git history, PR data, and session logs.

---

<prerequisites>
- `.devt.json` exists in project root with git configuration (provider, workspace, slug)
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- Git is available on PATH and the project is a git repository
- Scripts exist: `${CLAUDE_PLUGIN_ROOT}/skills/weekly-report/scripts/`
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session using scripts and data processing.

Available agent types in the devt system (for reference):
- `devt:programmer` — implementation specialist
- `devt:tester` — testing specialist
- `devt:code-reviewer` — code review specialist (READ-ONLY)
- `devt:architect` — structural review specialist (READ-ONLY)
- `devt:docs-writer` — documentation specialist
- `devt:retro` — lesson extraction specialist
- `devt:curator` — playbook quality maintenance specialist
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

---

## Steps

<step name="load_config" gate=".devt.json is read and git config is extracted">

Read `.devt.json` and extract the git configuration:

```bash
node -e "
  const cfg = JSON.parse(require('fs').readFileSync('.devt.json', 'utf8'));
  console.log(JSON.stringify({
    provider: cfg.git?.provider || 'none',
    workspace: cfg.git?.workspace || '',
    slug: cfg.git?.slug || '',
    branch: cfg.git?.branch || 'main',
    contributors: cfg.contributors || []
  }, null, 2));
"
```

Extract:
- `provider`: bitbucket | github | gitlab | none
- `workspace`: organization or workspace name
- `slug`: repository slug
- `branch`: default branch name
- `contributors`: list of contributor usernames to include in the report

**Gate**: If provider is `none` and no contributors are configured, the report will be git-log-only (no PR data). Warn the user but proceed.
</step>

<step name="compute_window" gate="report window (start date, end date) is determined">

Determine the reporting window. Check `${CLAUDE_PLUGIN_ROOT}/skills/weekly-report/scripts/` for a `compute_window.py` script.

If the script exists:
```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/weekly-report/scripts/compute_window.py"
```

If the script does not exist, compute manually:
- End date: today
- Start date: 7 days ago
- Format: ISO 8601 (YYYY-MM-DD)

The user can override the window by providing `--from` and `--to` arguments.

Store: `$WINDOW_START`, `$WINDOW_END`
</step>

<step name="fetch_git_data" gate="git log data is captured">

Fetch git history for the reporting window:

```bash
git log --since="$WINDOW_START" --until="$WINDOW_END" \
  --pretty=format:'%H|%an|%ae|%aI|%s' \
  --no-merges > .devt-state/git-log-raw.txt
```

If contributors are configured, also fetch per-contributor stats:

```bash
for author in $CONTRIBUTORS; do
  echo "=== $author ==="
  git log --since="$WINDOW_START" --until="$WINDOW_END" \
    --author="$author" --pretty=format:'%H|%s' --no-merges
done > .devt-state/git-contributor-stats.txt
```

Capture file change stats:
```bash
git diff --stat $(git log --since="$WINDOW_START" --format=%H | tail -1)..HEAD \
  2>/dev/null > .devt-state/git-diffstat.txt || echo "NO_DIFF_STAT"
```
</step>

<step name="fetch_pr_data" gate="PR data is captured (or skipped if provider is none)">

**If provider is `none`**: Skip this step.

**If provider is `bitbucket`**:
Fetch merged PRs for the window using the Bitbucket API (via `bb_get` MCP tool or direct API):
```
GET /2.0/repositories/{workspace}/{slug}/pullrequests?state=MERGED&q=updated_on>"{WINDOW_START}"
```

**If provider is `github`**:
```bash
gh pr list --repo "{workspace}/{slug}" --state merged \
  --search "merged:>=$WINDOW_START" --json number,title,author,mergedAt,labels \
  > .devt-state/pr-data.json 2>/dev/null || echo "[]" > .devt-state/pr-data.json
```

**If provider is `gitlab`**:
```bash
glab mr list --repo "{workspace}/{slug}" --state merged \
  --merged-after "$WINDOW_START" > .devt-state/pr-data.json 2>/dev/null || echo "[]" > .devt-state/pr-data.json
```

If the API call fails, warn the user and continue with git-only data.
</step>

<step name="parse_and_render" gate="report is generated">

Check `${CLAUDE_PLUGIN_ROOT}/skills/weekly-report/scripts/` for parsing and rendering scripts.

If `parse_git_data.py` exists:
```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/weekly-report/scripts/parse_git_data.py" \
  --git-log .devt-state/git-log-raw.txt \
  --pr-data .devt-state/pr-data.json \
  --output .devt-state/parsed-data.json
```

If `render_report.py` exists:
```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/weekly-report/scripts/render_report.py" \
  --data .devt-state/parsed-data.json \
  --from "$WINDOW_START" --to "$WINDOW_END" \
  --output .devt-state/weekly-report.md
```

If the scripts do not exist, generate the report directly by analyzing the raw data:

**Report structure**:
```markdown
# Weekly Report: {WINDOW_START} to {WINDOW_END}

## Summary
- Commits: N
- Pull Requests merged: N
- Contributors: N
- Files changed: N

## Features Delivered
- <feature description> (PR #N)

## Bug Fixes
- <fix description> (PR #N)

## Technical Improvements
- <improvement description> (commit SHA)

## Contributor Activity
| Contributor | Commits | PRs Merged |
|-------------|---------|------------|
| @user1      | N       | N          |

## Notable Changes
- <significant architectural or infrastructure changes>
```

Write the final report to `.devt-state/weekly-report.md`.
</step>

<step name="output" gate="report location is communicated to user">

Report to the user:
- The report has been generated at `.devt-state/weekly-report.md`
- Quick summary: total commits, PRs merged, contributors active
- Ask if they want to see the full report or export it to a specific location

Final status: **DONE**
</step>

---

<deviation_rules>
1. **Auto-fix: bugs** — If a script fails, fall back to direct analysis of raw git data. Do not STOP.
2. **Auto-fix: lint** — Not applicable.
3. **Auto-fix: deps** — If `python3` is not available for scripts, perform all data processing inline using bash and node.
4. **STOP: architecture** — If the project is not a git repository (no `.git/`), STOP with BLOCKED — git history is required for the report.
</deviation_rules>

<success_criteria>
- Reporting window is computed (7-day default or user-specified)
- Git history is fetched for the window
- PR data is fetched (if provider is configured)
- Report is generated with: summary, features, fixes, improvements, contributor activity
- Report is written to `.devt-state/weekly-report.md`
- Final status: **DONE**
</success_criteria>
