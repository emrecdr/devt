# Next-Session Plan — Post-v0.62.0 Backlog

> **Created**: 2026-05-28. Validates against working tree state as of v0.62.0 commit `2ef32fb` + chore commit `5c6c6bd`.
>
> **Discipline**: every task includes a "validate before coding" step. Per [[feedback-validate-before-implement]], do not blindly trust this plan; surface deviations from observed code state before implementing.

## Backlog grooming summary

| Source | Items reviewed | Kept | Rejected | Deferred | Skipped |
|---|---|---|---|---|---|
| v0.62.0 deferred + greenfield calibration + session findings | 14 | 6 | 3 | 3 | 2 |

**Rejected (will not implement)**:
- *Agent passivity around graphify* — conflicts with CLAUDE.md:176 architectural contract ("Agent bodies MUST NOT instruct mcp__*graphify* calls"). The intentional "orchestrator owns MCP, sub-agents MCP-blind" design must not be reversed.
- *Re-dispatch template enforcement* — detecting freeform-vs-template requires new hook infrastructure; L1 hook's existing "blocks present" check is the right granularity.
- *Per-lane verifiers* — no field signal; speculative. Single consolidated verifier remains correct architecturally.

**Deferred (revisit on field signal)**:
- *AST-based semantic duplicate detection* — complements v0.61.0's text-based pre-search; defer until field shows v0.61.0's ~30% miss-rate is a real problem.
- *v0.62.0 freshness-binding field test*, *v0.61.0 reuse pre-search field test* — user-driven, not in this plan.
- *Field calibration template as Lesson doc* — nice-to-have; folds into Phase A INTERNALS.md update if quick, otherwise defer.

**Skipped (not code tasks)**:
- Greenfield testing of v0.62.0 + v0.61.0 — your runs; produces next signal cycle.

## Three-phase plan

Phases sequenced by risk + leverage. Phase A is small and ships quickly; Phase B is medium; Phase C is a focused feature milestone.

---

## Phase A — Operational + Architecture documentation (v0.62.1 patch)

**Theme**: clean operational deck + harden release flow + promote CON-001 to first-class architectural principle.

**Smoke target**: 678 → 680 (J1 INTERNALS.md instance-count gate + J2 release-tag-drift gate)

**Task count**: 6 (A1 already done; A2-A6 to ship).

### Task A1: Recover 8 missing GitHub Releases — ✅ COMPLETED 2026-05-28

**Validated finding (controller)**: `gh release list` confirmed v0.58.1 → v0.62.0 missing from GitHub. Tags ARE on remote with matching SHAs. The release workflow never fired for these 8 tags — likely a lightweight-tag + bulk-push edge case.

**Effort**: ~5 minutes. **Done — Emre ran the loop manually on 2026-05-28.**

- [x] **Step 1: Run the recovery loop** (✅ done)

```bash
cd /Users/emrec/Projects/devt
for v in 0.58.1 0.58.2 0.58.3 0.58.4 0.59.0 0.60.0 0.61.0 0.62.0; do
  notes=$(bash scripts/extract-changelog.sh "${v}")
  gh release create "v${v}" --title "v${v}" --notes "$notes"
done
```

- [ ] **Step 2: Verify**

```bash
gh release list --limit 12
# Expected: v0.62.0 marked Latest; 8 new releases visible
```

Confirm `v0.62.0` shows as `Latest` and the count went from 41 → 49.

**No commit needed** — this is a GitHub-side operation; no git changes locally.

### Task A2: Add `workflow_dispatch` to release.yml

**Validated finding (controller)**: `.github/workflows/release.yml` currently has only `on: push: tags: 'v*'`. No manual trigger fallback exists. If the silent-skip pattern recurs (as in A1), there's no way to manually re-run the workflow.

**Effort**: ~5 minutes.

- [ ] **Step 1: Read current workflow file**

```bash
head -25 /Users/emrec/Projects/devt/.github/workflows/release.yml
```

- [ ] **Step 2: Add `workflow_dispatch` trigger**

Use Edit. Find:
```yaml
on:
  push:
    tags:
      - 'v*'
```

Replace with:
```yaml
on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      tag:
        description: 'Tag to release (e.g. v0.62.0). Must already exist on origin.'
        required: true
        type: string
```

- [ ] **Step 3: Update the "Resolve version from tag" step to handle workflow_dispatch input**

Currently the step uses `${GITHUB_REF#refs/tags/}`. For workflow_dispatch, the ref is the branch, not the tag. Add input handling:

Replace:
```yaml
      - name: Resolve version from tag
        id: version
        run: |
          TAG="${GITHUB_REF#refs/tags/}"
          VERSION="${TAG#v}"
```

With:
```yaml
      - name: Resolve version from tag
        id: version
        env:
          INPUT_TAG: ${{ github.event.inputs.tag }}
        run: |
          if [ -n "$INPUT_TAG" ]; then
            TAG="$INPUT_TAG"
          else
            TAG="${GITHUB_REF#refs/tags/}"
          fi
          VERSION="${TAG#v}"
```

Then in the checkout step earlier, add `ref: ${{ github.event.inputs.tag || github.ref }}` so workflow_dispatch checks out the tag's commit, not main.

- [ ] **Step 4: Commit**

```bash
cd /Users/emrec/Projects/devt
git add .github/workflows/release.yml
git commit -m "ci(release): add workflow_dispatch trigger as manual fallback (covers silent-skip recurrence)"
```

### Task A3: Release helper script (`scripts/release.sh`) — prevent silent-skip recurrence

**Validated finding**: the v0.58.1→v0.62.0 silent-skip happened because tags got pushed in a single bulk `git push --tags` operation. The fix is procedural — a helper script that pushes commits + tag separately, uses an annotated tag (more reliable workflow triggering than lightweight), and verifies the GitHub Release was created.

**Effort**: ~30 minutes.

- [ ] **Step 1: Validate existing release flow + git config**

```bash
# What does git tag -a look like in this repo's history? Compare to plain git tag.
git -C /Users/emrec/Projects/devt for-each-ref --format='%(refname:short) %(objecttype)' refs/tags | head -10
# Annotated tags show "tag" (object); lightweight show "commit". The 8 session tags are likely "commit" (lightweight).
```

- [ ] **Step 2: Create `scripts/release.sh`**

```bash
#!/usr/bin/env bash
# Release a new devt version. Pushes commits + annotated tag in separate
# operations to avoid the bulk-push edge case where GitHub Actions
# release workflow can silently miss per-tag events. Verifies the
# release was created post-push; surfaces a fallback recovery command
# if the workflow didn't fire.
#
# Usage: bash scripts/release.sh 0.62.1
# Pre-requisites:
#   - VERSION + plugin.json + CHANGELOG.md already updated for this version
#   - Release commit already made on local main
#   - Working tree clean

set -euo pipefail
VERSION="${1:?usage: bash scripts/release.sh X.Y.Z}"
TAG="v${VERSION}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Sanity checks
[ -z "$(git status --porcelain)" ] || { echo "ERROR: working tree not clean"; exit 1; }
[ "$(cat VERSION | tr -d '[:space:]')" = "$VERSION" ] || { echo "ERROR: VERSION file is not $VERSION"; exit 1; }
grep -q "^## \[${VERSION}\]" CHANGELOG.md || { echo "ERROR: CHANGELOG.md missing [$VERSION] section"; exit 1; }
[ -z "$(git tag -l "$TAG")" ] || { echo "WARN: tag $TAG already exists locally; reusing"; }

# Push the release commit first; CI runs on main push.
echo "→ Pushing main to origin..."
git push origin main

# Create annotated tag (object type 'tag', more reliable workflow triggering)
if [ -z "$(git tag -l "$TAG")" ]; then
  echo "→ Creating annotated tag $TAG..."
  git tag -a "$TAG" -m "Release $TAG"
fi

# Push the single tag (NOT --tags; single-tag pushes always trigger the workflow per tag)
echo "→ Pushing tag $TAG to origin..."
git push origin "$TAG"

# Wait briefly + verify the release workflow fired
echo "→ Waiting 15s for the release workflow to start..."
sleep 15

if gh release view "$TAG" --json tagName >/dev/null 2>&1; then
  echo "✓ Release $TAG created on GitHub"
else
  echo "⚠ Release $TAG NOT yet created on GitHub. Check workflow:"
  echo "   gh run list --workflow=release.yml --limit 3"
  echo "   Fallback: gh workflow run release.yml -f tag=$TAG"
fi
```

Make executable: `chmod +x scripts/release.sh`.

- [ ] **Step 3: Document the helper in CLAUDE.md's Releasing section**

Find the "Releasing" section in CLAUDE.md (currently shows the manual `git tag` + `git push` flow). Add a note above it:

```markdown
**Recommended**: use `bash scripts/release.sh X.Y.Z` instead of the manual flow below — it pushes commits + tag separately (avoiding the bulk-push edge case that caused v0.58.1→v0.62.0 to silently skip the release workflow), uses an annotated tag (more reliable trigger), and verifies the GitHub Release was created.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/release.sh CLAUDE.md
git commit -m "chore(release): scripts/release.sh helper — annotated tag + per-tag push (prevents silent-skip recurrence)"
```

### Task A4: Smoke gate detecting release-tag drift

**Validated finding**: there is currently no smoke gate that warns when local tags exist but corresponding GitHub Releases don't. The v0.58.1→v0.62.0 drift went unnoticed for hours because nothing tested for it.

**Effort**: ~15 minutes.

- [ ] **Step 1: Add the gate to `scripts/smoke-test.sh`**

Just before the final `== Result ==` echo, add:

```bash
# J2: every local tag in the current minor-series has a corresponding
# GitHub release. Catches the silent-skip drift the v0.58.1→v0.62.0
# tags hit. Skipped when gh CLI is not available or authenticated.
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  CURRENT_VER=$(cat "$ROOT/VERSION" | tr -d '[:space:]')
  CURRENT_MINOR=$(echo "$CURRENT_VER" | awk -F. '{print $1"."$2}')
  LOCAL_TAGS=$(git -C "$ROOT" tag --list "v${CURRENT_MINOR}.*" | sort -V)
  MISSING=""
  for tag in $LOCAL_TAGS; do
    if ! gh -R emrecdr/devt release view "$tag" --json tagName >/dev/null 2>&1; then
      MISSING="$MISSING $tag"
    fi
  done
  if [ -z "$MISSING" ]; then
    pass "J2: every local tag in v${CURRENT_MINOR}.* series has a corresponding GitHub release"
  else
    fail "J2: missing GitHub release(s) for:${MISSING} — run: bash scripts/release.sh <version> or gh workflow run release.yml -f tag=<tag>"
  fi
else
  pass "J2: gh CLI unavailable; release-drift check skipped"
fi
```

- [ ] **Step 2: Run smoke + commit**

```bash
bash /Users/emrec/Projects/devt/scripts/smoke-test.sh 2>&1 | grep -E "J[12]|Result"
# Expected: J1 + J2 both pass; result 680/0
git add scripts/smoke-test.sh
git commit -m "test(smoke): J2 — detect local-tag-vs-GitHub-release drift (prevents silent-skip blindness)"
```

### Task A5: Promote CON-001 + update INTERNALS.md to current state

**Validated finding (controller)**: docs/INTERNALS.md::Substance-Enforcement Gates section documents only 5 instances (F4, B4, L1, F26, F27-F28) and only the existence-binding property. Missing 9 instances (F29, F30, F31, v0.60.0 × 4 mechanical gates, v0.61.0 reuse pre-search, v0.62.0 freshness binding × 7 retrofits) and the new freshness-binding property.

**Effort**: ~30 minutes.

- [ ] **Step 1: Read current section**

```bash
sed -n '377,402p' /Users/emrec/Projects/devt/docs/INTERNALS.md
```

- [ ] **Step 2: Update the section**

Use Edit. Replace the entire current section (lines 377-402) with the updated version. Three changes:

1. **Header sentence**: "Five field-validated instances" → "Fourteen field-validated instances across v0.55–v0.62."

2. **Expand the instances table** to 14 rows (one per gate). Group by release for readability:

```markdown
| Gate | Form check (passed) | Substance gap | Fix |
|---|---|---|---|
| **F4** (v0.55) | `graphify_scan_prep` step ran | Step was inside a skippable conditional | Move gate to mandatory precondition |
| **B4** (v0.55) | Curator dispatched | Dispatch was in unreachable workflow branch | Relocate gate to context_init |
| **L1** (v0.58.0) | `dispatch-hygiene-guard.sh` warned | Advisory was ignored 6× in one session | Default-block (`{decision:"deny"}`) |
| **F26** (v0.58.1) | `## Drill-down:` headings present | Headings hand-written without MCP calls | Cross-reference `_mcp-trace.jsonl` for `get_neighbors` in `workflow_id` window |
| **F27/F28** (v0.58.1/2) | `review.md` file exists | Body is "Stub written; analysis in progress." | `state check-agent-output` detects stub phrases + low word count + heading-only |
| **F29** (v0.58.3) | dev-workflow verifier dispatch | Same stub problem, different workflow | Apply F28 substance gate to dev-workflow |
| **F30** (v0.58.3) | Verifier agent body grading stubs | Agent burns turns on stub artifacts | Verifier self-aborts with `verdict=failed` on stub upstream |
| **F31** (v0.58.3) | Narrow stub regex | "analysis in progress" only — missed variants | Verb-prefixed pattern catches realistic phrasings |
| **scope-check-handled** (v0.60.0) | AskUserQuestion prose in workflow | Orchestrator skips silently | Artifact-and-CLI: `scope-check-required.txt` + `state assert-scope-check-handled` |
| **lanes-registered** (v0.60.0) | partition_lanes ran | Empty `workflow.yaml::lanes[]` | `state assert-lanes-registered` blocks dispatch |
| **consolidator-dispatched** (v0.60.0) | Lanes passed substance | Orchestrator writes review.md instead of dispatching synthesis agent | `state assert-consolidator-dispatched` requires marker from agent body |
| **auto-curator-considered** (v0.60.0) | auto_curator step in workflow | Skipped without reading config | Marker file writes FIRE/DISABLED; gate requires marker |
| **assert-reuse-analyzed** (v0.61.0) | Programmer "scans existing code" prose | Reimplements similar functions | derive-reuse-candidates writes candidates; programmer must address each |
| **isArtifactFresh** (v0.62.0) | Artifact exists | Stale prior-workflow artifact passes | mtime-vs-workflow.yaml::created_at, 30s grace; retro-fit to 7 gates |
```

3. **Add a new "Required properties" subsection** after the table, before "Pattern recognition":

```markdown
### Required properties (both must hold)

Every substance-enforcement gate has two non-negotiable properties:

1. **Existence binding** — the artifact must exist. Validated by `fs.existsSync` or equivalent. (Established v0.58.x.)
2. **Freshness binding** — the artifact's mtime must postdate the current `workflow.yaml::created_at` within a 30-second grace window. Validated by `isArtifactFresh(path)`. (Established v0.62.0 after greenfield calibration showed every existence-only gate passed against stale prior-workflow artifacts.)

Gates missing either property are bypassable. The v0.60.0 → v0.62.0 arc demonstrated this empirically: 5 existence-only gates produced silent passes against stale state; the one gate with mechanical reset binding (auto-curator-considered) fired correctly because the prior session's marker was naturally absent.
```

4. **Update "Pattern recognition"** with a 4th bullet for freshness:

```markdown
- **For any artifact whose currency matters** — wire `isArtifactFresh(artifactPath)` into the gate's branch logic. Stale prior-workflow artifacts return `fresh:false` with reason "artifact mtime is Ns older than workflow.yaml::created_at — file is from a prior workflow".
```

- [ ] **Step 3: Add smoke gate enforcing the instance count claim**

In `scripts/smoke-test.sh`, just before the final result echo, add:

```bash
# J1: INTERNALS.md substance-enforcement-gates section is current.
# Pattern documentation must accurately reflect shipped gates — when a new gate
# ships, this gate fails until the docs are updated. Conservative count check.
INSTANCES=$(/usr/bin/grep -cE "^\| \*\*[A-Za-z0-9_-]+\*\* \(v[0-9]" "$ROOT/docs/INTERNALS.md" 2>/dev/null || echo 0)
if [ "$INSTANCES" -ge 14 ]; then
  pass "J1: INTERNALS.md substance-enforcement-gates table documents ≥14 instances (${INSTANCES} found)"
else
  fail "J1: INTERNALS.md table has only ${INSTANCES} instances; should be ≥14 (missing recent gates?)"
fi
```

- [ ] **Step 4: Smoke + commit**

```bash
bash /Users/emrec/Projects/devt/scripts/smoke-test.sh 2>&1 | tail -3
# Expected: 679 passed, 0 failed (678 + J1)
cd /Users/emrec/Projects/devt
git add docs/INTERNALS.md scripts/smoke-test.sh
git commit -m "docs(internals): promote substance-enforcement-gates to first-class principle (14 instances + freshness property)"
```

### Task A6: v0.62.1 release

**Files**: VERSION, plugin.json, CHANGELOG.md

- [ ] Bump VERSION 0.62.0 → 0.62.1, plugin.json to match
- [ ] CHANGELOG `[0.62.1]` section — theme: "operational cleanup + INTERNALS.md substance-gates update"
- [ ] Final smoke 679/0
- [ ] Commit + tag v0.62.1, then `git push origin main v0.62.1` (with workflow_dispatch fallback in place, this triggers the release workflow even if the push event misses)

---

## Phase B — Workflow UX + small features (v0.63.0)

**Theme**: close three field-validated gaps in workflow ergonomics.

**Smoke target**: 679 → ~688 (+~9 gates)

**Effort**: ~4-5 hours subagent-driven.

### Task B0: Interactive memory-promotion offer at workflow end

**Validated finding** (field signal 2026-05-28): the auto_curator infrastructure is binary today — FIRE (auto-dispatch curator) or SKIP (silent). When `memory.auto_curator_on_review=false` (default), candidates accumulate in `_suggestions.md` until the user remembers to run `/devt:retro` or `/devt:memory promote`. The `devt:health` I004 info line is the only surface today and requires manual `/devt:health` invocation.

User feedback: "memory update should be more robust — at most relevant moments like after task execution, changing codebase or at other relevant moments it should ask me for this."

**Design**: extend `memory.auto_curator_on_review` from boolean to tristate `"off" | "ask" | "auto"` (with bool back-compat — `true` → `"auto"`, `false` → `"off"`). Add `"ask"` mode = AskUserQuestion at workflow-end when threshold + cooldown both met. Wire the prompt into every workflow that ends with `present_findings` (code-review.md, code-review-parallel.md, dev-workflow.md, quick-implement.md).

**Effort**: ~1.5 hours.

- [ ] **Step 1: Validate the current auto_curator step's branching**

```bash
sed -n '538,580p' /Users/emrec/Projects/devt/workflows/code-review.md
```

Identify the FIRE / SKIP / DISABLED branches and confirm where the new "ASK" branch would slot in.

- [ ] **Step 2: Extend config schema**

In `bin/modules/config.cjs::DEFAULTS.memory`, change:
```javascript
auto_curator_on_review: false,
```
to:
```javascript
// Tristate: "off" (silent skip) | "ask" (AskUserQuestion at workflow end
// when threshold + cooldown met) | "auto" (silent dispatch via curator).
// Boolean values accepted for back-compat: false→"off", true→"auto".
auto_curator_on_review: "ask",
```

(Default = `"ask"` is the right ergonomic — user gets the offer instead of silent skip. Boolean back-compat preserves existing config files.)

- [ ] **Step 3: Implement the ASK branch in code-review.md::auto_curator**

Inside the existing auto_curator bash block, after the threshold + cooldown checks pass, add a tristate dispatch:

```bash
case "$AUTO_CURATOR_MODE" in
  auto|true)
    # existing auto-dispatch path
    ;;
  ask)
    # NEW: AskUserQuestion offer
    echo "auto_curator: ASK — surface AskUserQuestion to user with ${CANDIDATES} candidates"
    # The actual AskUserQuestion is workflow-level prose (orchestrator must
    # surface it). Write a marker so the orchestrator's present_findings
    # step knows to ask.
    echo "ASK ${CANDIDATES}" > .devt/state/auto-curator-considered.txt
    ;;
  off|false|"")
    # existing silent skip
    ;;
esac
```

Then in present_findings, after the existing report, add prose:

```markdown
If `.devt/state/auto-curator-considered.txt` contains `ASK <N>`, surface to the user via AskUserQuestion:

  Question: "{N} memory promotion candidates pending. Triage now via /devt:memory promote?"
  Options: Yes (run promote) | No (defer; will ask again after next workflow if conditions persist) | Snooze 7d (record cooldown extension)
```

- [ ] **Step 4: Mirror in code-review-parallel.md, dev-workflow.md, quick-implement.md** (KEEP-IN-SYNC)

Each workflow's terminal step (present_findings or report) gets the same ASK-branch surface.

- [ ] **Step 5: Smoke gates** (~3)
  - L1: config schema accepts `"ask"` value
  - L2: ASK mode writes the marker (not auto-dispatches)
  - L3: ASK mode skip surfaces when count < min OR cooldown active

- [ ] **Step 6: Commit**

### Task B1: Knowledge-candidate aggregation to scratchpad

**Validated finding** (greenfield calibration #18): lane agents append `#KNOWLEDGE-CANDIDATE` to their lane output files; orchestrator never aggregates them into `.devt/state/scratchpad.md`. The curator's harvest step reads scratchpad — without aggregation, lane-surfaced candidates are invisible to the memory layer.

- [ ] **Validate**: confirm exactly where `#KNOWLEDGE-CANDIDATE` tags get written today (lane agents vs scratchpad) and where the curator reads from.
- [ ] **Implement**: workflow bash step after `consolidate` (parallel) or `review` (single-dispatch) that greps lane outputs / review.md for `#KNOWLEDGE-CANDIDATE` lines, appends them to scratchpad.md with provenance comment.
- [ ] Alternative: add a `state aggregate-knowledge-candidates` CLI that scans `.devt/state/review-lane-*.md` + `review.md`, dedupes by content, appends to scratchpad.
- [ ] Smoke gate: aggregation runs, scratchpad gets entries.

### Task B2: `context_init` prose simplification (split into named sub-steps)

**Validated finding**: code-review.md context_init = 188 lines; dev-workflow.md context_init = 180 lines. Orchestrator's calibration #16: "By the time prose reaches line ~220, I've started forgetting earlier obligations."

- [ ] **Validate**: read both context_init blocks; identify natural sub-step boundaries (e.g., "init", "compute memory_signal", "compute scope_hint + scope_trust", "evict graphify", "compute impact-plan", "execute graphify call", "F16 drill-down", "claude-mem harvest", "assert decision artifact").
- [ ] **Implement**: split context_init into ~8 named `<substep>` blocks (or named bash sections) with one bash block + one gate-assert per sub-step. Minimize prose between bash blocks.
- [ ] Apply to both code-review.md and code-review-parallel.md (KEEP-IN-SYNC).
- [ ] Smoke gate: count `<substep>` markers; gate fails if fewer than expected.

### Task B3: v0.63.0 release

Standard bump + CHANGELOG + tag.

---

## Phase C — Bitbucket PR-scoped tier (v0.64.0)

**Theme**: graphify's biggest project-leverage gap for non-GitHub repos.

**Validated finding** (greenfield orchestrator's P0): `code-review.md:152-156` shows the tier-decision bash routes Bitbucket projects to `symbol_anchored` because `pr_scoped` requires `git.provider=github`. Every greenfield-api review since 2026-05-19 has hit the fallback. The upstream `mcp__graphify__get_pr_impact` MCP tool is GitHub-only.

**Effort**: 6-8 hours. Larger feature; deserves its own milestone.

**Strategy**: implement a devt-native equivalent. No upstream MCP changes needed; devt computes the equivalent locally using `git diff origin/main...HEAD` + symbol extraction + blast_radius on the extracted symbols.

### Task C1: Validate Bitbucket PR detection

- [ ] **Validate**: How does devt detect "this is a PR"? Currently `PR_NUM=$(echo "${REVIEW_SCOPE}" | grep -oE '(PR|pull request) ?#?[0-9]+' ...)` — text parse from task description. Workable for both GitHub and Bitbucket since both use "PR #N" idiom.
- [ ] How does devt know which commit range to diff for the PR? Currently it doesn't — for symbol_anchored, the bash extracts symbols from `git diff origin/main...HEAD`.
- [ ] **Design**: new tier `bitbucket_pr_scoped` (or rename `pr_scoped` to `provider_native_pr` and parameterize by provider).

### Task C2: Implement `bitbucket_pr_scoped` tier

- [ ] In code-review.md context_init's impact-plan bash, add a branch:
  - When `PR_NUM` is detected AND `git.provider=bitbucket` AND `graphify_state=ready` → use `bitbucket_pr_scoped` tier
  - Tool: `mcp__plugin_devt_devt-graphify__blast_radius` (same as symbol_anchored — graphify's blast_radius is provider-agnostic)
  - Args derivation: extract symbols from `git diff origin/main...HEAD -- <files-touched-by-PR>` (currently the same diff command, but scoped to the PR's actual file list rather than HEAD's recent changes)
  - The key difference vs symbol_anchored is the SCOPE of diff: PR's commit range, not just recent HEAD.

- [ ] Validate the PR commit range derivation. Bitbucket doesn't have a stable "main branch" name in all repos — may be `master`, `main`, or custom. Read it from config or detect via `git symbolic-ref refs/remotes/origin/HEAD`.

- [ ] Implement.

### Task C3: Mirror in code-review-parallel.md (KEEP-IN-SYNC)

### Task C4: Smoke gates

- bitbucket-pr-tier fires when `git.provider=bitbucket` + PR detected
- bitbucket-pr-tier produces different args than symbol_anchored (broader scope: full PR diff)
- bitbucket-pr-tier degrades to symbol_anchored when origin/main doesn't exist

### Task C5: v0.64.0 release

---

## Sequencing recommendation

**This session (today)**: Phase A only. 5 tasks remaining (A1 done), ~1.5 hours total. Operational cleanup + release-flow hardening + docs update. Low risk, high value.

**Next session**: Phase B. 3 tasks, ~3 hours. Workflow UX improvements.

**Following session**: Phase C. Bitbucket PR tier. ~6-8 hours, own milestone.

**Do not bundle Phase B with Phase C** — they have different risk profiles and natural release boundaries.

## Out of scope (will not implement; will not re-evaluate without new field signal)

- Agent passivity around graphify — architectural contract requires this stays.
- Re-dispatch template enforcement — L1 hook's existence check is the right granularity.
- Per-lane verifiers — no field signal, speculative.

## Why this plan

- **Validation-first**: every kept item has codebase evidence; every rejected item has documented reason.
- **No speculative work**: every item traces to specific field signal or operational evidence.
- **Phased by risk**: operational/docs first (low risk), UX second (medium), large feature last (own milestone).
- **CON-001 pattern preserved**: Phase A's INTERNALS.md update locks in the architectural principle the session demonstrated. Future work inherits the documented discipline.
- **Aligns with [[project-devt-north-star-goals]]**: output quality (better gates), token usage (no wasted dispatches), graphify integration (Bitbucket tier closes the biggest project gap).
