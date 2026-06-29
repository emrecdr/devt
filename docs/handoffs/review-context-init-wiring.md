# Handoff: wire `state review-context-init` into `code-review.md`

**Status:** the compound CLI is built, validated, shipped, and CI-green. The
workflow integration that actually delivers the ceremony reduction is NOT done
— this doc is everything a fresh session needs to finish it without re-deriving.

Delete this file once the wiring lands and its acceptance criteria are green.

---

## 1. Goal

`workflows/code-review.md` `context_init` currently makes the orchestrator
issue **~19 `devt-tools` CLI round-trips across 9 substeps** before a single
file is reviewed. The `state review-context-init` CLI collapses the
*data-gathering* substeps into **one** call returning a JSON bundle. Wiring it
in cuts the orchestrator's context_init round-trips to ~4.

**The win is removing the orchestrator's LLM round-trips, not the gates.** The
gates caught real failures in the field (staleness pre-flight + claim-check)
and MUST stay as separate, unskippable orchestrator stops.

---

## 2. Current state (already shipped — do not redo)

- `state review-context-init --scope=<text> [--primary-branch=<ref>]` exists in
  `bin/modules/state.cjs` (`reviewContextInit()`), CLI-dispatched, usage-listed.
- Smoke gate **K200** asserts its bundle shape + short-circuit + honest-absence.
- It internally spawns the existing sub-CLIs (init review, preflight generate,
  memory query --signal, preflight scope-cache, state evict-graphify) and calls
  `computeGraphifyImpactPlan` in-process, then assembles the bundle.

**What the CLI does NOT do (by design — keep these in the workflow):**
- Substep 0 stale-workflow AskUserQuestion (operator-mediated reset).
- Substep 4's staleness AskUserQuestion (now *driven by* `bundle.staleness_tier`).
- Substep 6 MCP impact-plan execution (driven by `bundle.impact_plan.tier/args`).
- Substep 8's gates (the 7 `assert-*` stops).

---

## 3. Bundle contract (read these fields; do not re-compute)

Full run (`short_circuited: false`):
```
{
  ok: true,
  short_circuited: false,
  impact_plan: { tier, tool, args, skip_reason, git_provider, pr_diff_caveat?, ... },
  scope_trust: { trust, fresh, ... } | "empty"-shaped on degrade,
  memory_signal: { counts, top } | {} on degrade,
  god_node_warnings: { god_nodes: [...] },
  freshness: { state, lag_commits, fresh } | { state:"unknown" } on degrade,
  staleness_tier: "fresh" | "warn" | "stale" | "unknown_lag" | "unknown",
  degraded_fields: [ ... ]    // honest list of which fields fell back
}
```
Short-circuit (fresh re-call): same minus `staleness_tier`, plus
`reason`; `freshness` comes straight from the cached brief.

Prerequisite failure (init/activate): `{ ok:false, prerequisite_failed, detail }`
— the orchestrator should STOP/BLOCK on this, exactly as a failed init today.

**Honest-absence invariant:** a degraded field NEVER reports a false-confident
`"ready"`/`"fresh"`/`"dense"`. If the wiring surfaces freshness to the reviewer,
trust `freshness.state` / `staleness_tier` verbatim — they degrade loud.

The CLI also writes the same side-effect artifacts the substeps did
(`preflight-brief.{md,json}`, `graphify-impact-plan.json`, `scope_trust_json` +
`memory_signal_json` + `god_node_warnings_json` cached in `workflow.yaml`), so
the dispatch envelopes that read those caches keep working unchanged.

---

## 4. The wiring task

In `workflows/code-review.md`:

1. **Substep 1** becomes: run `state review-context-init --scope="${REVIEW_SCOPE}"
   --primary-branch="${PRIMARY_BRANCH:-main}"` once, capture the bundle into a
   shell var (e.g. `CTX`). Keep the substep-0 stale prompt BEFORE it.
2. **Substeps 2, 3, 5, 7** (memory_signal, scope-cache, impact-plan, god-node):
   replace their inline `devt-tools` calls with reads from `$CTX`
   (`tier=$(echo "$CTX" | jq -r '.impact_plan.tier')`, etc.). Their *side-effect
   artifacts are already written by the CLI*, so the only change is the
   orchestrator stops re-invoking the CLIs — it reads the bundle.
3. **Substep 4** keeps its AskUserQuestion, but the staleness decision now reads
   `$CTX.staleness_tier` (`stale` → prompt; `warn` → silent-warn band; `fresh` →
   proceed) instead of re-reading `preflight-brief.json::staleness.lag_commits`.
   Preserve the `--no-refresh` escape-hatch detection (gate K180).
4. **Substep 6** unchanged in spirit — it executes `$CTX.impact_plan.tool` with
   `$CTX.impact_plan.args` via MCP. Preserve the "EXECUTE THE PLAN" imperative
   and the "EXACTLY ONE of graph-impact.md / graphify-skip-reason.txt MUST
   exist" contract.
5. **Substep 8** unchanged — the 7 `assert-*` gates stay separate stops.

Mirror the same collapse in `workflows/code-review-parallel.md` context_init if
it shares the substep structure (check first).

---

## 5. Gates at risk — re-verify each after the rewire

These smoke assertions grep `code-review.md` prose; the rewire must keep them
green (or migrate them, as cal #37 #3 did for K174/K190/M12 → state.cjs):

- **"EXECUTE THE PLAN"** presence gate (smoke ~line 4832) — keep the imperative
  in substep 6.
- **"EXACTLY ONE … graph-impact.md … graphify-skip-reason.txt … MUST exist"**
  contract gate (~line 4844) — keep that sentence.
- **K180** — staleness band (`0<lag<threshold` silent-warn) + `--no-refresh`
  escape hatch must still be detectable in substep 4.
- **K178** — `scope_check` operator-explicit short-circuit branch unchanged.
- **K190 / K174 / M12** — already migrated to assert `state.cjs`; they test the
  CLI, so they should be unaffected. Confirm, don't assume.
- The `state.cjs::<filename>` reference-integrity gate — if the wiring adds a new
  `.devt/state/` filename reference, it must match the contract.

**Protocol:** edit one substep → `bash scripts/smoke-test.sh 2>&1 | grep -E "FAIL:"`
→ fix or migrate the flagged gate → next substep. Do NOT batch all edits then run
once; the gates pinpoint which substep broke which assertion.

---

## 6. Acceptance criteria

- [ ] Orchestrator context_init issues ~4 CLI calls (init via the wrapper +
      the still-separate gates/MCP), not ~19.
- [ ] Substep 0 stale prompt, substep 4 staleness prompt, substep 6 MCP exec,
      and all 7 substep-8 gates still fire as distinct steps.
- [ ] `bash scripts/smoke-test.sh` green (945+), `test-locking.cjs` 3/3,
      `test-graphify.cjs` 37/37.
- [ ] A manual `/devt:review` dry-read of `code-review.md` shows the reviewer
      still receives `<scope_hint>`, `<scope_trust>`, `<memory_signal>`,
      `<god_node_warnings>`, and the graph-impact map (the caches are written by
      the wrapper, so envelopes are unchanged — verify, don't assume).
- [ ] New K-gate asserting the workflow calls `review-context-init` at
      context_init (lock the collapse so it can't silently regress to 19 calls).
- [ ] Version bump + CHANGELOG + release; update the K-gate count docs (K117).

---

## 7. Watch-outs

- **Don't bundle gate verdicts into the wrapper.** A gate that returns a verdict
  in JSON reads as advisory; a separate `assert-*` that exits non-zero is an
  unskippable wall. The field value of the gates came from being walls.
- **`updateState` takes a `"key=value"` string array, not an object** — the
  wrapper learned this the hard way; the workflow already uses the string form.
- **The short-circuit is freshness-BEFORE-eviction by design.** If you touch the
  ordering, keep the freshness check ahead of `evict-graphify` or a clean resume
  will evict the `graph-impact.md` it's about to reuse.
- Graphify-disabled / degraded is normal — the bundle degrades per-field with
  honest absence; the workflow must treat `freshness.state != "ready"` as
  "fall back to grep + scope_hint", never as a hard error.
