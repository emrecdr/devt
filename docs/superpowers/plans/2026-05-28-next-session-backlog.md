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

## Phase B — Workflow UX + memory layer improvements (v0.63.0)

**Theme**: close six field-validated gaps in workflow + memory-layer ergonomics.

**Smoke target**: 679 → ~694 (+~15 gates)

**Effort**: ~7-9 hours subagent-driven.

**Task list**:
- B0 (a-d): Passive memory-candidate surfacing (SessionStart + /devt:next + present_findings)
- B1: Knowledge-candidate aggregation to scratchpad
- B2: context_init prose simplification
- B3: Curator pre-recommends `candidate` for tooling-evolving items
- B4: Concept docs track `superseded_when` for lifecycle clarity
- B5: `memory promote` batches tooling-related items

B0+B3+B4+B5 are a coherent "memory layer UX" sub-batch. B1+B2 are workflow-side. Both share the v0.63.0 release boundary because they're all UX improvements that don't affect protocol/correctness.

### Task B0: Passive memory-candidate surfacing at three natural moments

**Validated finding** (field signal 2026-05-28 + investigation): user wants memory candidates surfaced at relevant moments without manual `/devt:health` invocation. Investigation of `/devt:memory promote` cost profile shows it dispatches the `curator` agent (effort: medium, maxTurns: 35, AskUserQuestion-per-candidate) → 1–3 minutes + 30–100K tokens for 18 candidates. This is decisively NOT auto-fireable, and AskUserQuestion at every workflow end would prompt the user repeatedly with a costly action.

**Right pattern**: surface count, never auto-dispatch, never block. Three passive surfaces; user acts when they have attention budget.

**Effort**: ~2-3 hours.

#### Sub-task B0a — SessionStart hint

**Wire `hooks/session-start.sh`** to check `_suggestions.md` candidate count at session start. If count ≥ threshold AND no active workflow (`workflow.yaml::active != true`) AND time-since-last-shown ≥ cooldown, inject via `additionalContext`:

> 📋 Memory: N candidates pending triage. When you have time, run `/devt:retro` or `/devt:memory promote`.

Single line. Non-blocking. Free (hook output, no LLM cost). Frequency-limited via `.devt/state/last-memory-hint-shown.txt`.

- [ ] **Step 1: Validate** the SessionStart hook structure (currently does plugin registration + project detection; no candidate surfacing today).
- [ ] **Step 2: Add candidate-count read** + cooldown check + `additionalContext` emission. Update `last-memory-hint-shown.txt` post-emit.
- [ ] **Step 3: Smoke gate**: `_suggestions.md` count ≥ 5 + no active workflow → hint appears; with `last-memory-hint-shown.txt` recent → hint skipped (cooldown).

#### Sub-task B0b — `/devt:next` candidate recommendation

**Modify `workflows/next.md`** to include "🧠 Triage memory candidates (N pending)" as one of the recommended next actions WHEN `state.active=false` AND count ≥ threshold. This is the natural "user explicitly asks what's next" moment.

- [ ] **Step 1: Validate** the current branching logic in `next.md` (it already considers state.active and other signals; just add candidate-count branch).
- [ ] **Step 2: Add the recommendation prose** + bash check for `_suggestions.md` count.
- [ ] **Step 3: Smoke gate**: count ≥ 5 + no active workflow → `/devt:next` surfaces "Triage memory candidates" as one of the options; otherwise doesn't.

#### Sub-task B0c — `present_findings` informational footer

**Add a one-line footer** to every workflow's `present_findings` step (after the main report, before the workflow ends). When `_suggestions.md` count ≥ threshold:

> 💡 N memory candidates pending — run `/devt:retro` when you have time.

NOT AskUserQuestion. Just a line of text. User can act or ignore. KEEP-IN-SYNC across code-review.md, code-review-parallel.md, dev-workflow.md, quick-implement.md.

- [ ] **Step 1: Identify present_findings step in all 4 workflows.**
- [ ] **Step 2: Add the footer bash snippet** — reads candidate count, emits line if ≥ threshold.
- [ ] **Step 3: Smoke gate**: footer present in each workflow's present_findings (4 grep checks).

#### Sub-task B0d — Config schema additions

Add to `bin/modules/config.cjs::DEFAULTS.memory`:

```javascript
// Memory-candidate surfacing config. Three passive surfaces (SessionStart
// hint + /devt:next recommendation + present_findings footer) all gate
// on count ≥ surface_threshold. SessionStart hint additionally
// rate-limits via surface_cooldown_hours. Surfaces never dispatch the
// curator — they only inform; user runs /devt:memory promote when ready.
candidates_surface_threshold: 5,
candidates_surface_cooldown_hours: 24,
```

KEEP existing `memory.auto_curator_on_review` (boolean) for power users who DO want auto-dispatch. Don't rework it to tristate — surfacing and dispatching are separate concerns now.

#### Sub-task B0e — Commit

Single commit for B0a-B0d:

```bash
git commit -m "feat(memory): passive candidate surfacing at 3 natural moments (SessionStart + /devt:next + present_findings footer)"
```

**Why this design over the original B0**:

| Concern | Original B0 (AskUserQuestion at workflow end) | Revised B0 (3 passive surfaces) |
|---|---|---|
| User interruption | Blocks workflow completion with prompt | Never blocks — informational only |
| Cost when user accepts | 1–3min + 30-100K tokens immediately | User runs `/devt:memory promote` deliberately when ready |
| Notification fatigue | Prompts at end of every workflow | SessionStart once/24h + opt-in `/devt:next` + passive footer |
| Honors "right moments" intent | Yes but invasive | Yes and non-invasive |
| Cost of the surface itself | AskUserQuestion latency | Zero (text emission) |

### Task B3 — Curator pre-recommends `candidate` status for tooling-evolving items

**Field-validated finding** (2026-05-28 promote pass): user ran `/devt:memory promote` on 18 candidates. Curator asked "active vs candidate vs REJ vs defer?" per candidate, but for tooling-related items (e.g., "Bitbucket pr_scoped tier doesn't exist on devt-graphify"), the answer is always `candidate` — because the underlying tooling will evolve. User had to make this decision manually 18 times.

**Design**: heuristic in the curator agent body. When the candidate text contains tooling-evolving signals (regex match on `mcp__*`, `version`, `currently`, `today`, `limitation`, `until`, `not yet`, etc.) AND a related entry exists in `docs/superpowers/plans/*.md` (text search across plan files), pre-recommend `candidate` as the default option and surface the resolution path in the question prose:

> Q: "{candidate-text}" — tooling-related, expected to evolve. Promote how?
>   1. **Candidate** (Recommended — related backlog: Phase C v0.64.0 in 2026-05-28-next-session-backlog.md)
>   2. Active (if you want this canonical; risk: stales when Phase C ships)
>   3. REJ tombstone
>   4. Defer

**Effort**: ~1 hour. Curator agent body change + smoke gate.

- [ ] **Step 1**: Validate the curator's current per-candidate prompt format in `agents/curator.md`.
- [ ] **Step 2**: Add the tooling-detection heuristic + plan-file backref text search.
- [ ] **Step 3**: Update curator prose to surface "Recommended" + resolution link when matched.
- [ ] **Step 4**: Smoke gate verifying the heuristic matches the documented signals on a fixture candidate.

### Task B4 — Concept docs track `superseded_when` for lifecycle clarity

**Field-validated finding** (same promote pass): `candidate` status means "true today, expected to evolve" — but there's no field documenting WHAT would resolve the candidate. When v0.64.0 ships Bitbucket pr_scoped, the CON-002 doc becomes invalid; today there's no automatic detection.

**Design**: add optional `superseded_when` frontmatter field to concept/decision/rejected docs:

```yaml
---
id: CON-002
title: Bitbucket pr_scoped tier unavailable on devt-graphify
doc_type: concept
status: candidate
confidence: explicit
domain: graphify
summary: ...
superseded_when: "devt ships a Bitbucket-native pr_scoped tier (tracked: Phase C in docs/superpowers/plans/2026-05-28-next-session-backlog.md)"
---
```

Add `state assert-concept-currency` (or `memory check-stale-concepts`) CLI that scans `.devt/memory/concepts/*.md` + `decisions/*.md` + `rejected/*.md` for `superseded_when` fields, then surfaces a warning if any reference plan items that have been completed (i.e., the plan file's checkbox is `[x]` for that task).

**Effort**: ~1.5 hours. Schema addition + new CLI + smoke gate.

- [ ] **Step 1**: Add `superseded_when` to memory frontmatter schema (in `bin/modules/memory.cjs::validateFrontmatter`). Optional field; existing docs without it are fine.
- [ ] **Step 2**: Implement `state assert-concept-currency` CLI that scans for stale references.
- [ ] **Step 3**: Wire into `/devt:health` as a new I-code (I005 — stale concept references found).
- [ ] **Step 4**: Smoke gates (schema accepts field; CLI flags fixture stale doc).

### Task B5 — `memory promote` batches tooling-related items

**Field-validated finding** (same promote pass): user had to make 18 sequential per-candidate decisions. Tooling-related items share the same answer pattern — batching by category would reduce decisions to ~3-5.

**Design**: in the curator agent body, before per-candidate prompts, scan ALL candidates for shared signals (tooling-evolving, REJ-tombstone-shape, decision-pattern). Group similar candidates and offer batch-promote:

> "5 candidates are all tooling-evolving concepts about devt-graphify limitations. Promote all as `candidate` with status='expires when matching backlog item ships'?"
>
>   1. **Batch promote all 5 as candidate** (Recommended)
>   2. Review each individually
>   3. Reject the batch

Falls back to per-candidate prompts for non-batched items.

**Effort**: ~2 hours. Curator agent body restructure + batch-grouping algorithm + smoke gate.

- [ ] **Step 1**: Validate the curator's current iteration over `_suggestions.md` entries.
- [ ] **Step 2**: Implement clustering heuristic (group by tooling signal + domain).
- [ ] **Step 3**: Add batch-prompt branch with per-cluster summary.
- [ ] **Step 4**: Smoke gate verifying clustering on a fixture with 3+ tooling candidates.

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
