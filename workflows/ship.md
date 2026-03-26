# Ship — Create PR from Workflow Artifacts

Auto-generate a rich PR description from the completed workflow's .devt-state/ artifacts.

---

<prerequisites>
- `gh` CLI installed and authenticated
- Git working tree is clean (or changes are staged)
- On a feature branch (not main/master/development)
- `.devt-state/` contains workflow artifacts (impl-summary.md, test-summary.md, review.md)
</prerequisites>

---

## Steps

<step name="preflight" gate="all preflight checks pass">

## Preflight Checks

Run these checks in order. If any fails, report the specific issue and STOP.

1. **gh CLI available**:
   ```bash
   which gh
   ```
   If missing: "Install GitHub CLI: https://cli.github.com/"

2. **gh authenticated**:
   ```bash
   gh auth status
   ```
   If not authenticated: "Run `gh auth login` first."

3. **Not on protected branch**:
   ```bash
   git branch --show-current
   ```
   If on main, master, or development: "You are on a protected branch. Create a feature branch first."

4. **Working tree status**:
   ```bash
   git status --porcelain
   ```
   If dirty: warn the user that uncommitted changes exist and will NOT be included in the PR. Ask if they want to continue or commit first.

5. **Remote configured**:
   ```bash
   git remote -v
   ```
   If no remote: "No git remote configured. Add one with `git remote add origin <url>`."

6. **Artifacts exist**:
   Check for `.devt-state/impl-summary.md` at minimum.
   If missing: "No workflow artifacts found in .devt-state/. Run /devt:implement or /devt:workflow first."

</step>

<step name="generate_pr_body" gate="PR body is composed">

## Generate PR Description

Read these `.devt-state/` artifacts and compose a PR body:

### From impl-summary.md (required):
- Summary of changes (what was built)
- Files created/modified
- Key decisions made

### From test-summary.md (if exists):
- Test results (pass/fail counts)
- Test coverage summary

### From review.md (if exists):
- Review verdict (APPROVED/APPROVED_WITH_NOTES)
- Review score
- Notable findings (if any)

### From decisions.md (if exists):
- Key design decisions with rationale

### PR Body Format

```markdown
## Summary
[2-3 bullet points from impl-summary]

## Changes
[File list grouped by type: new files, modified files]

## Testing
[Test results from test-summary, or "No test summary available" if missing]

## Review
- Verdict: [APPROVED/NOTES, or "No review performed" if missing]
- Score: [N/100, or omit if missing]

## Decisions
[Key decisions if any, omit section if none]
```

Generate a PR title from the task description:
- Under 70 characters
- Use conventional format: `feat:`, `fix:`, `refactor:`, `docs:`, `test:` prefix
- Describe the what, not the how

</step>

<step name="push_and_create" gate="PR is created successfully">

## Push and Create PR

1. **Push branch** to remote:
   ```bash
   git push -u origin $(git branch --show-current)
   ```

2. **Create PR** via gh CLI:
   ```bash
   gh pr create --title "<generated title>" --body "<generated body>"
   ```
   Use a HEREDOC for the body to preserve formatting.

3. **Report PR URL** to the user.

If push or PR creation fails, report the error and STOP.

</step>

---

<deviation_rules>
1. **Missing artifacts**: If only impl-summary.md exists (no test-summary, no review), still create the PR but note which sections are absent. Do NOT block.
2. **Dirty working tree**: Warn but do not block. The user may have intentional unstaged changes.
3. **Push failure**: If push fails (e.g., no upstream, auth), report the exact error. Do NOT retry automatically.
4. **PR already exists**: If `gh pr create` fails because a PR already exists for this branch, report the existing PR URL instead.
</deviation_rules>

<red_flags>
- "I'll write the PR description manually" — The artifacts are there, use them
- "Ship without review" — If review.md does not exist, note it but do not block. Suggest running /devt:review first.
- "Push to main" — Always push to feature branch. Never push directly to main/master/development.
</red_flags>

<success_criteria>
- All preflight checks pass
- PR body is generated from available artifacts
- Branch is pushed to remote
- PR is created and URL is reported to user
</success_criteria>
