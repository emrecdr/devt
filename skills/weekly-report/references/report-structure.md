# Report Structure Reference

## Standard Report Sections

1. **Header**: Report title with date range
2. **Summary Table**: Per-contributor stats (commits, files, insertions, deletions)
3. **Totals Row**: Aggregated team numbers
4. **Per-Contributor Detail**: Breakdown per person
5. **PR Activity** (optional): Merged/open/declined PRs if git provider configured

## Report Output Location

Default: `docs/reports/TEAM-CONTRIBUTION-{FROM}-{TO}.md`
Configurable via workflow.

## Data Sources

| Source | What It Provides | How to Fetch |
|--------|-----------------|--------------|
| git log | Commits, file changes, insertions/deletions | `devt-tools.cjs report generate` |
| PR API | Pull request activity | Provider-specific (gh, bb_get) |
| .devt/config.json | Contributor names, git match patterns | `config get` |
