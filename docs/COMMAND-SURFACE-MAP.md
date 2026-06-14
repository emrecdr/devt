# Command Surface Map — when to use which command

Practical decision tree for orchestrators choosing between the `/devt:*` workflows, parameter modes, and direct sub-agent dispatch. Surfaces what each path does, what it costs, and when bypassing the workflow is the right call.

This doc was prompted by greenfield calibration #21 F25: "I bypassed `/devt:workflow` because (a) it felt heavy for waves with locked plans, (b) I didn't know `/devt:workflow --mode=fast` existed, and (c) the workflow file gave the dispatch protocol but not the meta-choice framing."

---

## Decision tree

```
You have a task to do. Pick the path.

  Is the plan already written + locked + you're executing fixed waves?
    └── Yes → Direct sub-agent dispatch (see "Direct dispatch" below) — skip
              workflow overhead; envelope blocks are mandatory.
    └── No  → Continue.

  Is the task one of: spec → plan → research → implement → debug → review → ship?
    └── No  → /devt:do (smart router infers the right command)
    └── Yes → Continue.

  Is it a single, well-scoped, < 3-file change?
    └── Yes → /devt:workflow --mode=fast (lighter weight; skips
                docs/retro/preflight overhead)
    └── No  → Continue.

  Is it a bug, not a feature?
    └── Yes → /devt:debug (root-cause-first 4-phase protocol)
    └── No  → /devt:workflow (full dev pipeline)

  Special cases:
    - "I want to know what to do next"     → /devt:next
    - "Show me my workflow state"          → /devt:status
    - "Bundle this as a PR"                → /devt:ship
    - "Run code review on what's changed"  → /devt:review
    - "Pressure-test an architectural call" → /devt:council
    - "Quickly capture an idea"            → /devt:note
    - "Defer this for later"               → /devt:note --defer "<title>"
```

---

## What each path does

### `/devt:workflow` (full pipeline)

The default for net-new feature work. Runs the complete sequence: preflight → scan → reuse-analysis → implement → test → review → verify → docs → retro → autoskill. Each phase reads the prior phase's artifact from `.devt/state/` and produces its own. Approves all phases via gates declared in `workflows/dev-workflow.md`.

**Cost:** ~10 sub-agent dispatches, ~7 artifact files written, ~3-5 minutes of orchestration overhead.
**Value:** Every governing rule fires automatically; verifier loop catches partial work; lessons get harvested.
**Use when:** Real feature; spec isn't fully fleshed out; complexity is uncertain.

### `/devt:workflow --mode=fast`

Subset of the full pipeline: skips preflight (uses inline scope_hint instead), skips docs and retro phases. Still runs scan + reuse + implement + test + review + verify.

**Cost:** ~5 sub-agent dispatches, ~4 artifact files.
**Value:** Quality gates still fire; sidecar contracts still enforced.
**Use when:** Plan is small + locked (≤3 files, known pattern); you've already done the discovery; you don't need docs or retro for this change.

### `/devt:workflow --mode=specify` / `--mode=plan` / `--mode=research`

Single-phase entry points to one of the discovery phases. Useful when you want to STOP after specification, planning, or research without running implement.

**Use when:** You're scoping work but not yet executing.

### `/devt:debug`

4-phase protocol: investigate root cause → analyze pattern → hypothesize fix → implement. Refuses to skip Phase 1 (no "fix-first") and produces `.devt/state/debug-context.md` for resume-on-failure.

**Use when:** Reproducible bug; you don't yet know the cause.

### `/devt:review` / `/devt:review --focus=arch|quality|security`

Read-only code review. Dispatches one code-reviewer + one verifier; produces `.devt/state/review.md` with structured findings. Does NOT modify code unless the operator dispatches a follow-up workflow.

**Use when:** You want findings without auto-fix.

### `/devt:ship`

Reads `.devt/state/` artifacts (impl-summary, test-summary, review verdict), generates a PR title + body, opens the PR. Single sub-agent (ship is mostly orchestration).

**Use when:** Workflow is complete and you're ready to push.

### Direct sub-agent dispatch (Agent tool from main thread)

`Agent(subagent_type="devt:programmer", prompt="<envelope-injected prompt>")` without going through a `/devt:*` command. The orchestrator hand-builds the envelope (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`, and optionally `<context>`, `<graph_impact>`, etc.) by copy-pasting from preflight output or constructing manually.

**Cost:** ~1 sub-agent dispatch; you take on the orchestration overhead the workflow would have done.
**Value:** Maximum flexibility; bypass the workflow's phase progression.
**Use when:** Plan is fully locked; you're executing specific waves and don't need preflight/test/review automation between them; envelope blocks are present.

**Required envelope** (otherwise the dispatch-hygiene-guard hook flags as `raw_dispatch`):

```
<scope_trust>{"trust": "...", "lag_commits": null, "fresh": true}</scope_trust>
<scope_hint>["path/to/file.ext", ...]</scope_hint>
<memory_signal>{"counts": {...}, "top": [...]}</memory_signal>
```

`dispatch-hygiene-guard.sh` exempts envelope-managed dispatches from logging (cal #21 F21 falsification confirmed). If your dispatch has all 3 blocks, the hook is silent — that's success, not a hook failure.

For docs-writer, retro, curator, and devt-coordinator, envelope blocks are not required (they're declared `graphify_inputs: []` in `agents/io-contracts.yaml`).

---

## When NOT to bypass the workflow

Direct dispatch is correct for fixed-plan execution. It's WRONG for:

- **Discovery phases.** If the plan isn't locked, `/devt:workflow` handles scan + reuse-analysis with governance hooks the orchestrator would otherwise need to replicate.
- **Multi-phase work where you need verifier between dispatches.** The workflow runs the verifier; manual dispatch needs you to remember to dispatch it.
- **Auto-resume after credential expiry / model rate-limit.** `/devt:next` reads workflow state and routes back to the correct command; manual dispatch loses this safety net.
- **Cross-agent file dependencies.** Workflows guarantee phase ordering (programmer writes impl-summary BEFORE tester reads it); manual dispatch makes you responsible for sequencing.

If you bypass and run into one of these problems, recovery is `/devt:next` (which reads `.devt/state/workflow.yaml` and routes to the right place) or `state recover-partial-impl` (which detects partial artifacts from a dead dispatch).

---

## State you should know about

| File | Read for | Written by |
|---|---|---|
| `.devt/state/workflow.yaml` | current workflow_type, phase, status, scope cached values | every `state update` call |
| `.devt/state/impl-summary.md` (+ .json sidecar) | what programmer changed | programmer dispatch |
| `.devt/state/review.md` (+ .json sidecar) | code review findings | code-reviewer dispatch |
| `.devt/state/dispatch-warnings.jsonl` | raw_dispatch incidents + cliff signals | hooks (dispatch-hygiene-guard, task-truncation-detector) |
| `.devt/state/preflight-brief.md` | scope_hint + memory_signal source data | preflight dispatch |
| `.devt/state/deferred.md` | cross-workflow TODO queue | `/devt:note --defer` |
| `.devt/state/scratchpad.md` | PREFLIGHT trace + KNOWLEDGE-CANDIDATES | all dispatches |

Manual dispatches that don't go through `/devt:workflow` should still update `state.cjs` (mark phase transitions, write artifacts) so `/devt:next` can route correctly if the session resumes.

---

## Cross-references

- [`docs/COMMANDS.md`](COMMANDS.md) — the canonical command reference (this doc is the meta-choice framing)
- [`docs/AGENT-CONTRACTS.md`](AGENT-CONTRACTS.md) — what each sub-agent expects in its envelope
- [`docs/HOOKS.md`](HOOKS.md) — dispatch-hygiene-guard.sh contract details
- [`workflows/next.md`](../workflows/next.md) — auto-resume routing rules
