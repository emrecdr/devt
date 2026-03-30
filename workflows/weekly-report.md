# Weekly Report Workflow

Generate a structured weekly contribution report from git history and PR data.

---

<prerequisites>
- `.devt/config.json` exists with git configuration (provider, workspace, slug)
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- Git is available on PATH and the project is a git repository
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<deviation_rules>
1. **Auto-fix: API failures** — If PR data fetch fails, continue with git-only data. Do not STOP.
2. **STOP: not a git repo** — If no `.git/` directory, STOP with BLOCKED.
3. **STOP: node missing** — If `node` is not available, STOP with BLOCKED.
</deviation_rules>

---

## Steps

<step name="compute_window" gate="report window determined">

Compute the reporting window using the CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" report window
```

This returns JSON with `start` and `end` dates (ISO 8601). Default: last 7 days.

The user can override with `--weeks N` to change the window size.

Store: `$WINDOW_START`, `$WINDOW_END`
</step>

<step name="generate_report" gate="report is generated">

Generate the full report using the CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" report generate --output .devt/state/weekly-report.md
```

This command:
1. Reads `.devt/config.json` for git provider, workspace, slug, contributors
2. Parses git log for the reporting window
3. Matches contributors from config
4. Renders a markdown report with: summary, features, fixes, contributor activity

If the command fails, fall back to manual git log analysis:

```bash
git log --since="$WINDOW_START" --until="$WINDOW_END" \
  --pretty=format:'%H|%an|%ae|%aI|%s' --no-merges
```

And compose the report inline following the structure in `${CLAUDE_PLUGIN_ROOT}/skills/weekly-report/references/report-structure.md`.
</step>

<step name="fetch_pr_data" gate="PR data captured or skipped">

Read the provider from `.devt/config.json`.

**If `github`:**
```bash
gh pr list --state merged --search "merged:>=$WINDOW_START" \
  --json number,title,author,mergedAt,labels 2>/dev/null
```

**If `bitbucket`:**
```bash
# Bitbucket API via curl or MCP tool
# GET /2.0/repositories/{workspace}/{slug}/pullrequests?state=MERGED
```

**If `gitlab`:**
```bash
glab mr list --state merged --merged-after "$WINDOW_START" 2>/dev/null
```

**If `none` or API fails:** Continue with git-only data. Warn the user.

If PR data is available, append a "Pull Requests" section to the report.
</step>

<step name="output" gate="report delivered to user">

Report to the user:
- The report is at `.devt/state/weekly-report.md`
- Quick summary: total commits, PRs merged, contributors active
- Ask if they want to see the full report or export to a different location

Final status: **DONE**
</step>

<success_criteria>
- Reporting window computed via CLI
- Report generated using `devt-tools.cjs report generate`
- PR data fetched if provider is configured
- Report written to `.devt/state/weekly-report.md`
- Final status: **DONE**
</success_criteria>
