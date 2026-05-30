# Ship — Create PR from Workflow Artifacts

Auto-generate a rich PR description from the completed workflow's .devt/state/ artifacts.

---

<prerequisites>
- `gh` CLI installed and authenticated
- Git working tree is clean (or changes are staged)
- On a feature branch (not main/master/development)
- `.devt/state/` contains workflow artifacts (impl-summary.md, test-summary.md, review.md)
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

---

## Steps

<step name="preflight" gate="all preflight checks pass">

## Preflight Checks

Run these checks in order. If any fails, report the specific issue and STOP.

0. **Consume autonomous_chain** — idempotency safety net: clear the chain flag at the start of ship so that retries (e.g. after a push/PR failure) don't see a stale autonomous-dispatch instruction. The consumer in `/devt:next` already clears before dispatching; this is defense-in-depth for direct invocations:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update autonomous_chain=null
   ```

1. **PR CLI available** (based on git provider in `.devt/config.json`):

   ```bash
   # Read provider from config (default: github)
   PROVIDER=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.devt/config.json','utf8'));process.stdout.write(c.git&&c.git.provider||'github')}catch{process.stdout.write('github')}" 2>/dev/null)
   ```

   - If `github`: check `which gh` — if missing: "Install GitHub CLI: https://cli.github.com/"
   - If `gitlab`: check `which glab` — if missing: "Install GitLab CLI: https://gitlab.com/gitlab-org/cli"
   - If `bitbucket`: manual PR creation will be guided (no standard CLI)

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
   Check for `.devt/state/impl-summary.md` at minimum.
   If missing: "No workflow artifacts found in .devt/state/. Run /devt:implement or /devt:workflow first."

</step>

<step name="merge_risk_scan" gate="merge-risk scan complete (or graphify lacks the capability)">

## Merge-Risk Scan (capability-gated)

When the installed graphify exposes `prs --conflicts` (v0.8.x+) AND `graphify-out/graph.json` exists, scan the open PRs targeting the same base branch for graph-community overlap with the current branch's scope. Surface conflicts to the user before opening the new PR so merge order can be coordinated.

```bash
SCAN_VERDICT="skipped"
if command -v graphify >/dev/null 2>&1 && graphify prs --help >/dev/null 2>&1; then
  if [ -f "graphify-out/graph.json" ]; then
    BASE_BRANCH=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.devt/config.json','utf8'));process.stdout.write((c.git&&c.git.base_branch)||'')}catch{}" 2>/dev/null)
    [ -z "$BASE_BRANCH" ] && BASE_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
    [ -z "$BASE_BRANCH" ] && BASE_BRANCH="main"

    # stderr suppressed: graphify warns about skill-version mismatches that don't affect functionality
    SCAN_OUTPUT=$(graphify prs --conflicts --base="$BASE_BRANCH" 2>/dev/null || echo "")

    if echo "$SCAN_OUTPUT" | grep -q "Community conflicts"; then
      SCAN_VERDICT="conflicts"
      echo "---"
      echo "MERGE-RISK SCAN — community conflicts detected on base '$BASE_BRANCH':"
      echo "$SCAN_OUTPUT"
      echo "---"
    else
      SCAN_VERDICT="clear"
    fi
  fi
fi
echo "merge_risk_scan: $SCAN_VERDICT"
```

**If `SCAN_VERDICT=conflicts`**: present the conflicting PRs to the user via AskUserQuestion:

- Question: "Open PRs share graph communities with your branch — merge order matters. Proceed anyway?"
- Options: "Proceed — I'll coordinate merge order"; "Cancel — review conflicts first"
- On Cancel: STOP with BLOCKED.

**If `SCAN_VERDICT=clear` or `SCAN_VERDICT=skipped`**: continue silently. `clear` means `graphify prs --conflicts` ran and found no overlap; `skipped` means graphify lacks the subcommand, no `graph.json` exists, or the base branch couldn't be detected.

</step>

<step name="hyperedge_completeness_scan" gate="hyperedge coverage scan complete (or no hyperedges to scan)">

## Hyperedge Completeness Scan (Option A — greenfield calibration #11)

Graphify's hyperedges are machine-discovered semantic groupings — multi-file scopes that "should change together" (e.g., route + service + repo + readme + test for a billing flow). When this PR's scope touches some-but-not-all members of a hyperedge, flag it before opening the PR so the user can decide: expand scope, defer the missing pieces, or accept partial coverage.

```bash
HYPEREDGES_JSON=$(jq -c '.hyperedges_matched // []' .devt/state/preflight-brief.json 2>/dev/null || echo "[]")
HYPER_COUNT=$(echo "$HYPEREDGES_JSON" | jq 'length')
if [ "${HYPER_COUNT:-0}" -eq 0 ]; then
  echo "hyperedge_completeness_scan: no hyperedges matched — skipping"
else
  # Partial-coverage hyperedges = completeness < 1.0
  PARTIAL=$(echo "$HYPEREDGES_JSON" | jq -c '[.[] | select(.completeness < 1.0)]')
  PARTIAL_COUNT=$(echo "$PARTIAL" | jq 'length')
  if [ "${PARTIAL_COUNT:-0}" -eq 0 ]; then
    echo "hyperedge_completeness_scan: all $HYPER_COUNT matched hyperedges fully covered"
  else
    echo "hyperedge_completeness_scan: $PARTIAL_COUNT of $HYPER_COUNT hyperedges have partial coverage:"
    echo "$PARTIAL" | jq -r '.[] | "  - " + .id + " (" + (.completeness * 100 | floor | tostring) + "% covered, members missing: " + ((.members | length) - (.members_in_scope | length) | tostring) + ")"'
  fi
fi
```

**If partial-coverage hyperedges exist**: surface via AskUserQuestion. For each partial-coverage entry, name the missing members so the user can decide whether the PR should expand to include them.

- Question: "This PR partially covers $PARTIAL_COUNT semantic grouping(s) from graphify's hyperedge analysis. Missing members may indicate forgotten changes (readme, test, repo, migration). Proceed anyway?"
- Options: "Proceed — partial coverage is intentional"; "Cancel — let me expand scope first"
- On Cancel: STOP with BLOCKED.

**If all hyperedges fully covered OR no hyperedges matched**: continue silently.

This step is non-fatal when `preflight-brief.json` is absent or has no `hyperedges_matched` field — graphify capability-probe-style, fails open.

</step>

<step name="changelog" gate="changelog updated or skipped">

## Changelog (conditional)

Check if the project has a changelog convention:

```bash
test -f .devt/rules/api-changelog.md && echo "HAS_CHANGELOG_RULES" || echo "NO_CHANGELOG_RULES"
```

**If `HAS_CHANGELOG_RULES`:**

1. Read `.devt/rules/api-changelog.md` — the project's changelog format and rules
2. Read the current changelog file (typically `docs/API-CHANGELOG.md` or `CHANGELOG.md` — check the rules file for the path)
3. Determine version: read `VERSION` file if it exists, or derive from git tags
4. Scan the diff for API-affecting changes:

   ```bash
   git diff $(git merge-base HEAD $(git rev-parse --abbrev-ref @{upstream} 2>/dev/null || echo main))..HEAD -- '*.py' '*.ts' '*.go' '*.js' | head -500
   ```

5. If API-affecting changes are found (new/modified endpoints, request/response changes, status code changes):
   - Generate a changelog entry following the format in `api-changelog.md`
   - Include Before/After examples for breaking changes
   - Include migration checklist
   - Append the entry to the changelog file

6. If no API-affecting changes: append a one-line "No API changes" entry if the rules require it

**If `NO_CHANGELOG_RULES`:** Skip this step entirely.

</step>

<step name="generate_pr_body" gate="PR body is composed">

## Generate PR Description

Read these `.devt/state/` artifacts and compose a PR body:

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

### From preflight-brief.md:

- Topic, governing ADR/Concept/Flow ids consulted (lane A+B+C+D union)
- Any REJ tombstones the implementation deliberately stayed clear of
- Brief-derived effect-size — useful for reviewer triage

Cite ADR ids in the PR body so reviewers can verify alignment without re-reading the Brief themselves. Example: `Implements per [ADR-007]; respects [REJ-001].`

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

2. **Create PR** based on git provider:

   - **github**: `gh pr create --title "<title>" --body "<body>"` (use HEREDOC for body)
   - **gitlab**: `glab mr create --title "<title>" --description "<body>"`
   - **bitbucket**: Report the push URL and instruct the user to create the PR manually via the Bitbucket web UI. Include the generated title and body for them to copy.

   Use a HEREDOC for the body to preserve formatting.

3. **Report PR/MR URL** to the user.

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
