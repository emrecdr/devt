# GSD-Inspired Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt 6 validated improvements from GSD v1.35-v1.36 into devt, enhancing workflow control, user orientation, and state management.

**Architecture:** All improvements follow devt's existing patterns — flag-stripping in `dev-workflow.md`, state keys in `state.cjs`, hooks for user-facing output. No new agents, commands, or dependencies. Each task is independent with no cross-task dependencies.

**Tech Stack:** Markdown (workflow prompts), CommonJS Node.js (CLI modules), Bash (hooks)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `workflows/dev-workflow.md` | Modify | Tasks 1, 2, 3, 6 — flag parsing, gate, context loading |
| `bin/modules/state.cjs` | Modify | Tasks 1, 5 — new state key, prune subcommand |
| `bin/modules/init.cjs` | Modify | Task 1 — expose tdd_mode in init JSON |
| `hooks/workflow-context-injector.sh` | Modify | Task 4 — enhanced statusline |
| `CLAUDE.md` | Modify | Task 5 — document `state prune` command |
| `CHANGELOG.md` | Modify | Final — document all changes |

---

### Task 1: Add `--tdd` Flag to Dev Workflow

**Files:**
- Modify: `bin/modules/state.cjs:77-100` (KNOWN_STATE_KEYS)
- Modify: `bin/modules/init.cjs:84-101` (init JSON output)
- Modify: `workflows/dev-workflow.md:6-59` (flag detection section)
- Modify: `workflows/dev-workflow.md:180-193` (state write section)
- Modify: `workflows/dev-workflow.md:624-713` (steps 4 and 5)

- [ ] **Step 1: Add `tdd_mode` to KNOWN_STATE_KEYS in state.cjs**

In `bin/modules/state.cjs`, add `tdd_mode` to the `KNOWN_STATE_KEYS` object after `verify_iteration`:

```javascript
  verify_iteration: "number",
  tdd_mode: "boolean",
};
```

- [ ] **Step 2: Expose `tdd_mode` in init.cjs output**

In `bin/modules/init.cjs`, add `tdd_mode` to the returned JSON object. After line 101 (`warnings`), add:

```javascript
    tdd_mode: state.tdd_mode || false,
    warnings: warnings.concat(injectionWarning),
```

- [ ] **Step 3: Add `--tdd` to flag detection in dev-workflow.md**

In `workflows/dev-workflow.md`, inside the `<autonomous_mode>` section, after the `--chain` flag description (line 48-51), add:

```markdown
**`--tdd`** — Enable test-driven development mode: tests are written BEFORE implementation.
- Reverses Step 4 (implement) and Step 5 (test): tester runs first with spec/task, programmer receives failing tests as context.
- Store `tdd_mode=true` in workflow state.
- Auto-injects `tdd-patterns` skill into both programmer and tester agents (regardless of `agent_skills` config).
```

- [ ] **Step 4: Add `--tdd` to flag stripping logic**

In the "Detection and stripping" list (lines 53-58), add after item 3:

```markdown
4. Check for `--tdd` — strip from task description.
```

Renumber subsequent items (old 4 becomes 5, old 5 becomes 6).

- [ ] **Step 5: Add state write for `--tdd`**

In the state write section (lines 186-192), after the `--chain` write, add:

```markdown
If `--tdd` was detected, also write: `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update tdd_mode=true`
```

- [ ] **Step 6: Add TDD mode conditional to Steps 4 and 5**

At the beginning of Step 4 (Implementation, line 625), before "Initialize iteration tracking", add:

```markdown
**TDD Mode Check**: If `tdd_mode=true` in workflow state, SKIP this step for now — proceed directly to Step 5 (Testing) first. The tester will write failing tests based on the spec/task. After Step 5 completes, return here to implement code that makes the tests pass.
```

At the beginning of Step 5 (Testing, line 677), after the skip condition, add:

```markdown
**TDD Mode**: If `tdd_mode=true` in workflow state AND this is the FIRST pass (no `impl-summary.md` exists yet):
- Change the tester's task prompt to: "Write failing tests that define the expected behavior for: {task_description}. Do NOT implement any production code. Tests should fail because the production code does not exist yet."
- Add to the tester's context: `<tdd_skill>Read ${CLAUDE_PLUGIN_ROOT}/skills/tdd-patterns/SKILL.md — follow the RED phase protocol.</tdd_skill>`
- After tester completes: return to Step 4 (Implementation). Add to the programmer's context:
  - `<failing_tests>Read .devt/state/test-summary.md — these are the RED tests you must make pass.</failing_tests>`
  - `<tdd_skill>Read ${CLAUDE_PLUGIN_ROOT}/skills/tdd-patterns/SKILL.md — follow the GREEN phase protocol. Write MINIMAL code to pass each test.</tdd_skill>`
- After programmer completes: proceed to Step 5 again for additional test coverage (edge cases, error paths). This second tester pass follows normal (non-TDD) behavior.
```

- [ ] **Step 7: Verify flag is stripped from task description**

Confirm that the existing stripping logic pattern handles `--tdd`. The task description regex should already match `--tdd` since the detection says "strip from task description" — but verify the existing code uses a generic `--flag` pattern or enumerate it explicitly.

- [ ] **Step 8: Commit**

```bash
git add bin/modules/state.cjs bin/modules/init.cjs workflows/dev-workflow.md
git commit -m "feat: add --tdd flag for test-driven development mode

Reverses implement/test phase order when enabled. Tester writes
failing tests first (RED), programmer implements to pass (GREEN).
Auto-injects tdd-patterns skill into both agents."
```

---

### Task 2: Add `--dry-run` Mode to Dev Workflow

**Files:**
- Modify: `workflows/dev-workflow.md:6-59` (flag detection)
- Modify: `workflows/dev-workflow.md:180-193` (state write)
- Modify: `workflows/dev-workflow.md:249-289` (assessment step)

- [ ] **Step 1: Add `--dry-run` to flag detection**

In `workflows/dev-workflow.md`, inside the `<autonomous_mode>` section, after the `--tdd` description (added in Task 1), add:

```markdown
**`--dry-run`** — Preview the workflow pipeline without executing any agents.
- Runs `context_init` and `assess` (complexity assessment) normally.
- After assessment: prints the planned pipeline steps, agent assignments, and model tiers.
- STOPS without executing — no agents dispatched, no state written beyond `context_init`.
- Does NOT write `active=true` — the workflow is not considered started.
- Useful for understanding what devt will do before committing to a full run.
```

- [ ] **Step 2: Add `--dry-run` to flag stripping logic**

Add to the detection list:

```markdown
5. Check for `--dry-run` — strip from task description.
```

Renumber subsequent items.

- [ ] **Step 3: Add dry-run exit point after assessment**

At the end of Step 1 (Complexity Assessment), after "Report the tier and reasoning to the user before proceeding" (line 289), add:

```markdown
**Dry-run exit**: If `--dry-run` was detected, display the planned pipeline and STOP:

```
--- DRY RUN ---
Task: {task_description}
Tier: {TIER}
Pipeline: {list of steps for this tier from the Tier→Steps table}
Agents: {list of agents that would be dispatched, with their model assignments from init JSON}
Estimated phases: {count}
---
No agents dispatched. Remove --dry-run to execute.
```

Do NOT write `active=true` to state. Do NOT proceed to any subsequent step. The dry run is complete.
```

- [ ] **Step 4: Commit**

```bash
git add workflows/dev-workflow.md
git commit -m "feat: add --dry-run flag for workflow pipeline preview

Shows planned steps, agents, and models without executing.
Useful for understanding tier assessment before committing."
```

---

### Task 3: Add Acceptance Criteria Gate at Implement Phase

**Files:**
- Modify: `workflows/dev-workflow.md:624-632` (before Step 4 dispatch)

- [ ] **Step 1: Add gate check before programmer dispatch**

In `workflows/dev-workflow.md`, at the beginning of Step 4 (Implementation, line 625), after the TDD mode check (added in Task 1) and before "Initialize iteration tracking" (line 629), add:

```markdown
**Acceptance Criteria Gate** (STANDARD + COMPLEX only):

_Skip this gate if tier is TRIVIAL or SIMPLE._

Before dispatching the programmer, verify that acceptance criteria exist:

1. Check if `.devt/state/spec.md` exists AND contains a section matching `## Acceptance Criteria` or `## Success Criteria`
2. If YES: proceed — spec provides clear acceptance criteria for the verifier.
3. If NO: present options via AskUserQuestion (even in autonomous mode — scope clarity is not skippable):

```yaml
question: "No acceptance criteria found. The verifier needs criteria to validate against."
header: "Acceptance Criteria Missing"
multiSelect: false
options:
  - label: "Define criteria now (Recommended)"
    description: "I'll create a brief spec.md with acceptance criteria before coding starts"
  - label: "Derive from task description"
    description: "Auto-extract criteria from the task text — less precise but faster"
  - label: "Skip verification"
    description: "Proceed without criteria — verification step will be skipped"
```

- If **"Define criteria now"**: Pause. Create `.devt/state/spec.md` with a template:
  ```markdown
  # Specification
  ## Acceptance Criteria
  - [ ] {criterion 1 — derived from task description}
  - [ ] {criterion 2}
  ```
  Present to user for review/edit. Resume after user confirms.

- If **"Derive from task description"**: Extract 3-5 verifiable criteria from the task description. Write to `.devt/state/spec.md`. Note in state: `acceptance_criteria_source=derived`.

- If **"Skip verification"**: Store `skipped_phases` to include `verify`. Note: this means the verifier will not run, and the implementation will not be checked against goal achievement.
```

- [ ] **Step 2: Commit**

```bash
git add workflows/dev-workflow.md
git commit -m "feat: add acceptance criteria gate before implementation

STANDARD+ tiers now check for spec.md with acceptance criteria
before dispatching programmer. Options: define now, auto-derive,
or skip verification."
```

---

### Task 4: Enhance Statusline in Workflow Context Injector

**Files:**
- Modify: `hooks/workflow-context-injector.sh:1-36`

- [ ] **Step 1: Replace the active-state output format**

In `hooks/workflow-context-injector.sh`, replace the Node.js block that builds the context string (lines 14-31) with an enhanced version that handles both active and idle states:

```bash
# Read current workflow state (exit 0 on failure — don't block the prompt)
STATE_JSON=$(node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state read 2>/dev/null) || exit 0

# Parse state and build context using node (proper JSON handling)
RESULT=$(node -e "
  const state = JSON.parse(process.argv[1]);

  // Active workflow — compact status line
  if (state.active) {
    const tier = state.tier || '?';
    const phase = state.phase || '?';
    const iter = state.iteration || 0;
    const task = state.task ? (state.task.length > 60 ? state.task.slice(0, 57) + '...' : state.task) : 'none';
    const flags = [];
    if (state.autonomous) flags.push('autonomous');
    if (state.tdd_mode) flags.push('tdd');
    if (state.stop_at_phase) flags.push('--to ' + state.stop_at_phase);
    if (state.only_phase) flags.push('--only ' + state.only_phase);
    const flagStr = flags.length > 0 ? ' [' + flags.join(', ') + ']' : '';
    const context = '[devt] ' + tier + ' · ' + phase + (iter > 1 ? ' (iter ' + iter + ')' : '') + flagStr + ' · \"' + task + '\"';
    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context
      }
    };
    process.stdout.write(JSON.stringify(output));
  }
  // Idle — show last known state if available
  else if (state.phase && state.phase !== 'null') {
    const tier = state.tier || '';
    const task = state.task ? (state.task.length > 50 ? state.task.slice(0, 47) + '...' : state.task) : '';
    const context = '[devt] idle · last: ' + (tier ? tier + ' · ' : '') + state.phase + (task ? ' · \"' + task + '\"' : '');
    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context
      }
    };
    process.stdout.write(JSON.stringify(output));
  }
  // No workflow state at all — silent (don't inject noise)
" "$STATE_JSON" 2>/dev/null) || exit 0

# printf avoids echo's flag interpretation (-n, -e) regardless of JSON content
[ -n "$RESULT" ] && printf '%s\n' "$RESULT"
exit 0
```

- [ ] **Step 2: Verify the hook outputs correct JSON**

Run manually against a test state:

```bash
echo '{"active":true,"phase":"implement","tier":"STANDARD","iteration":2,"task":"add user auth","autonomous":true}' | node -e "
  const state = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  // paste the node block above and verify output
"
```

Expected output should contain: `[devt] STANDARD · implement (iter 2) [autonomous] · "add user auth"`

- [ ] **Step 3: Commit**

```bash
git add hooks/workflow-context-injector.sh
git commit -m "feat: enhance statusline with compact format and idle display

Active: [devt] TIER · phase (iter N) [flags] · \"task\"
Idle: [devt] idle · last: TIER · phase · \"task\"
Shows active flags (autonomous, tdd, --to, --only)."
```

---

### Task 5: Add State Prune Subcommand

**Files:**
- Modify: `bin/modules/state.cjs:425-461` (run function and exports)
- Modify: `CLAUDE.md` (development commands section)

- [ ] **Step 1: Add `pruneState` function to state.cjs**

In `bin/modules/state.cjs`, before the `run` function (line 427), add:

```javascript
/**
 * Remove orphaned artifacts from .devt/state/ that don't belong to the current workflow.
 * Uses PHASE_ARTIFACT_MAP to determine which artifacts are expected.
 * Returns list of removed files. Supports dry-run mode.
 */
function pruneState(dryRun) {
  const stateDir = getStateDir();
  if (!fs.existsSync(stateDir)) {
    return { ok: true, pruned: [], message: "State directory does not exist" };
  }

  const state = readState();
  const currentPhaseIndex = PHASE_ORDER.indexOf(state.phase);

  // Build set of expected files: workflow.yaml + artifacts for completed phases + lock
  const expectedFiles = new Set(["workflow.yaml", ".lock"]);
  // Always keep spec.md, plan.md, research.md, decisions.md — these are input artifacts
  const inputArtifacts = ["spec.md", "plan.md", "research.md", "decisions.md", "handoff.json", "continue-here.md"];
  for (const f of inputArtifacts) expectedFiles.add(f);

  // Keep artifacts for phases that have been completed (phase index <= current)
  for (const [phase, artifact] of Object.entries(PHASE_ARTIFACT_MAP)) {
    const phaseIndex = PHASE_ORDER.indexOf(phase);
    if (phaseIndex !== -1 && phaseIndex <= currentPhaseIndex) {
      expectedFiles.add(artifact);
    }
  }
  // Also keep scratchpad and baseline
  expectedFiles.add("scratchpad.md");
  expectedFiles.add("baseline-gates.md");

  // Find orphans
  const pruned = [];
  const entries = fs.readdirSync(stateDir);
  for (const entry of entries) {
    if (!expectedFiles.has(entry)) {
      const fullPath = path.join(stateDir, entry);
      if (dryRun) {
        pruned.push({ file: entry, action: "would_remove" });
      } else {
        try {
          fs.unlinkSync(fullPath);
          pruned.push({ file: entry, action: "removed" });
        } catch (e) {
          pruned.push({ file: entry, action: "failed", error: e.message });
        }
      }
    }
  }

  return { ok: true, dry_run: dryRun, pruned, kept: [...expectedFiles].filter(f => f !== ".lock") };
}
```

- [ ] **Step 2: Add `prune` case to the `run` function**

In the `run` function's switch statement (line 427-443), add before the `default` case:

```javascript
    case "prune":
      return pruneState(args.includes("--dry-run"));
```

- [ ] **Step 3: Update the error message in `default` case**

Change the error message to include `prune`:

```javascript
      throw new Error(
        `Unknown state subcommand: ${subcommand}. Use: read, update, reset, validate, sync, prune`,
      );
```

- [ ] **Step 4: Export `pruneState`**

Add `pruneState` to the module.exports object:

```javascript
module.exports = {
  run,
  readState,
  updateState,
  resetState,
  syncState,
  pruneState,
  checkWorkflowLock,
  validateConsistency,
  getStateDir,
  ensureStateDir,
  PHASE_ORDER,
  PHASE_ARTIFACT_MAP,
  VALID_PHASES,
  VALID_WORKFLOW_TYPES,
  VALID_TIERS,
};
```

- [ ] **Step 5: Test the prune command**

```bash
node bin/devt-tools.cjs state prune --dry-run
```

Expected: JSON output with `ok: true`, `dry_run: true`, and a `pruned` array (empty if state is clean).

- [ ] **Step 6: Update CLAUDE.md development commands**

In `CLAUDE.md`, in the development commands section under the `state` subcommands, add after `state sync`:

```bash
node bin/devt-tools.cjs state prune [--dry-run]  # Remove orphaned artifacts
```

- [ ] **Step 7: Commit**

```bash
git add bin/modules/state.cjs CLAUDE.md
git commit -m "feat: add state prune subcommand for orphaned artifacts

Removes state files that don't belong to the current workflow phase.
Uses PHASE_ARTIFACT_MAP to determine expected artifacts.
Supports --dry-run for safe preview."
```

---

### Task 6: Tier-Based Prior-Phase Context Limiting

**Files:**
- Modify: `workflows/dev-workflow.md:635-660` (programmer dispatch context)

- [ ] **Step 1: Add tier-conditional context loading to programmer dispatch**

In `workflows/dev-workflow.md`, replace the programmer agent's `<context>` block (lines 640-657) with tier-conditional loading:

```markdown
  <context>
    <files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md, .devt/rules/architecture.md, CLAUDE.md</files_to_read>

    <!-- Tier-conditional context: load only what the tier needs to reduce context waste -->

    <!-- SIMPLE: minimal context — spec + task description are sufficient -->
    <!-- STANDARD: add scan results and plan, skip arch-review and research -->
    <!-- COMPLEX: load everything (full context needed for architectural decisions) -->

    <scan_results>Read .devt/state/scan-results.md for existing patterns and code to reuse. If this file doesn't exist, the task was assessed as SIMPLE and no scan was performed.</scan_results>
    <spec>Read .devt/state/spec.md (if it exists — from /devt:specify). This is the primary requirements source with user stories, API design, and detailed acceptance criteria.</spec>
    <plan>Read .devt/state/plan.md (if it exists — from /devt:plan)</plan>

    <!-- COMPLEX-only context: skip for SIMPLE and STANDARD to save tokens -->
    <arch_review>COMPLEX only: Read .devt/state/arch-review.md (if it exists). Skip for SIMPLE/STANDARD tiers.</arch_review>
    <research>COMPLEX only: Read .devt/state/research.md (if it exists — from /devt:research). Skip for SIMPLE/STANDARD tiers.</research>
    <decisions>STANDARD+: Read .devt/state/decisions.md (if it exists — from /devt:clarify). Skip for SIMPLE tier.</decisions>

    <review_feedback>Read .devt/state/review.md (if this is a fix iteration)</review_feedback>
    <scope_requirements>
      Extract every discrete requirement from the best available source (spec.md, plan.md, or task description) and list them numbered:
      R1: {requirement}
      R2: {requirement}
      ...
      The verifier will cross-reference this list against impl-summary.md to detect scope reduction. Every numbered requirement must have corresponding implementation evidence.
    </scope_requirements>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/learning-playbook.md, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
```

- [ ] **Step 2: Add guidance note above the dispatch**

Before the `Task(subagent_type="devt:programmer"` dispatch, add a guidance note:

```markdown
**Context loading by tier**: To manage context window usage, only load state artifacts relevant to the current tier:
- **SIMPLE**: `spec.md` (if exists), `review.md` (if fix iteration). Skip `scan-results.md`, `arch-review.md`, `research.md`, `decisions.md`.
- **STANDARD**: Add `scan-results.md`, `plan.md`, `decisions.md`. Skip `arch-review.md`, `research.md`.
- **COMPLEX**: Load all artifacts (current behavior).

When building the programmer's prompt, omit the `<arch_review>` and `<research>` XML elements entirely for SIMPLE/STANDARD — don't include them with "skip" instructions, as that wastes tokens on instructions about what NOT to read.
```

- [ ] **Step 3: Commit**

```bash
git add workflows/dev-workflow.md
git commit -m "feat: tier-based context limiting for agent dispatch

SIMPLE loads only spec + review feedback.
STANDARD adds scan results, plan, decisions.
COMPLEX loads everything (unchanged).
Reduces context waste for lighter tiers."
```

---

### Task 7: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md:7` (add new version section)

- [ ] **Step 1: Add changelog entry**

At the top of CHANGELOG.md, before the `## [0.7.0]` section, add:

```markdown
## [0.8.0] - 2026-04-17

### Added
- **`--tdd` flag**: Test-driven development mode for dev workflow — reverses implement/test phase order, auto-injects tdd-patterns skill into programmer and tester agents
- **`--dry-run` flag**: Preview the workflow pipeline (tier, steps, agents, models) without executing any agents
- **Acceptance criteria gate**: STANDARD+ tiers check for spec.md with acceptance criteria before implementation — options to define now, auto-derive, or skip verification
- **Enhanced statusline**: Compact format showing tier, phase, iteration, active flags, and task in `UserPromptSubmit` hook. Idle state shows last workflow context.
- **`state prune` subcommand**: Remove orphaned artifacts from `.devt/state/` using `PHASE_ARTIFACT_MAP`. Supports `--dry-run` for safe preview.
- **Tier-based context limiting**: SIMPLE/STANDARD tiers load only relevant state artifacts into agent prompts, reducing context waste
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for v0.8.0 — GSD-inspired improvements"
```
