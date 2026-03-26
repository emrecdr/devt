---
name: weekly-report
description: Use when the user says 'generate report', 'weekly report', 'contribution report', 'what did we ship', or 'sprint summary'. Produces a team contribution report from git data. Requires .devt.json git config. Also use at end of sprint or before retrospectives.
---

# Weekly Report

## Overview

A weekly report transforms raw git data (commits, PRs, diffs) into a human-readable summary of what the team accomplished. It answers "what did we ship?" without requiring manual tracking.

The report is generated from data, not from memory. Git is the source of truth.

## When to Use

- End of each work week (Friday or Monday morning)
- End of a sprint
- When a stakeholder asks "what was accomplished?"
- Before a retrospective (provides factual basis for discussion)

## The Process

### Step 1: Verify Configuration

Read `.devt.json` for git configuration:

```json
{
  "git": {
    "provider": "bitbucket|github|gitlab",
    "workspace": "team-workspace",
    "slug": "repo-name",
    "contributors": ["user1", "user2"]
  }
}
```

If this configuration is missing, the report cannot be generated. Ask the user to configure `.devt.json`.

### Step 2: Compute Time Window

Determine the reporting period:

- **Default**: Last 7 days (Monday to Sunday)
- **Custom**: User-specified date range
- **Sprint**: Based on sprint start/end dates if configured

### Step 3: Fetch Git Data

Gather from the git provider:

- **Commits**: All commits in the window by configured contributors
- **Branches**: Active branches with recent activity
- **Files changed**: Aggregated file change statistics

Group commits by:
1. Author
2. Branch/feature
3. Type (feature, fix, refactor, docs, test)

### Step 4: Fetch PR Data

Gather pull request activity:

- **Merged PRs**: PRs merged during the window
- **Open PRs**: PRs still in review
- **Review activity**: Comments, approvals, change requests

### Step 5: Render Report

Structure the report as:

```markdown
# Weekly Report: [date range]

## Highlights
- [Top 3-5 accomplishments in plain language]

## Merged Pull Requests
| PR | Title | Author | Files | Additions | Deletions |
|----|-------|--------|-------|-----------|-----------|

## Commits by Author
### [Author Name]
- [branch] commit message (files changed)

## In Progress
- [Open PRs and active branches]

## Statistics
- Commits: X
- PRs merged: X
- Files changed: X
- Lines added: X
- Lines removed: X
```

Highlights should be written in plain language for non-technical stakeholders. The rest provides detail for the team.

## Gate Functions

### Gate: Configuration Present

- [ ] `.devt.json` has `git.provider`, `git.workspace`, `git.slug`
- [ ] At least one contributor configured in `git.contributors`

### Gate: Data Fetched

- [ ] Commits retrieved for the time window
- [ ] PR data retrieved (merged + open)
- [ ] No API errors or authentication failures

### Gate: Report Quality

- [ ] Highlights are in plain language (not commit messages)
- [ ] All merged PRs are listed
- [ ] Statistics are accurate (match raw data)

## Red Flags — STOP

- "Nothing happened this week" — Check all contributors and all branches. Something happened.
- "The API is not responding" — Verify credentials and provider configuration before giving up.
- "The report is too long" — Summarize in highlights; keep detail in expandable sections.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll write the report from memory" | Memory is unreliable. Git data is not. |
| "Only merged PRs matter" | In-progress work provides context for next week |
| "Statistics are vanity metrics" | Trends in statistics reveal process issues |
| "The report is just bureaucracy" | A data-driven summary saves 30 minutes of standup updates |

## Integration

- **Prerequisites**: `.devt.json` configured with git provider details
- **Scripts**: `scripts/` directory contains report generation utilities
- **References**: `references/` directory contains report templates
- **Used by agents**: coordinator (can trigger at end of sprint)
- **Related skills**: lesson-extraction (report may surface accomplishments worth recording)
