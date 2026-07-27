# Debug — Systematic Investigation

Dispatch a debugger agent to investigate and fix a bug using a 4-phase investigation protocol.

<purpose>
Systematically isolate, diagnose, and fix bugs instead of guessing. The debugger agent
follows a structured protocol that builds evidence before proposing fixes.
</purpose>

<prerequisites>
- `.devt/rules/coding-standards.md` exists (for code context)
- `.devt/rules/quality-gates.md` exists (for verification after fix)
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>

- `devt:debugger` — systematic debugging specialist, 4-phase investigation protocol (Read, Write, Edit, Bash, Glob, Grep)
</available_agent_types>

<agent_skill_injection>
Before dispatching the debugger agent, read `resolved_skills.debugger` from the compound `init` output. This is pre-resolved by `init.cjs::resolveSkills` — `.devt/config.json::agent_skills.debugger` overrides; the debugger's default skills (`memory-pre-flight`, `codebase-scan`) are preloaded via agent frontmatter, so an empty/absent list is normal — inject `<agent_skills>(none — defaults preloaded via agent frontmatter)</agent_skills>`.
</agent_skill_injection>

<process>

<step name="context_init" gate="compound init succeeds and .devt/rules/ is readable">

Run the compound context-init wrapper ONCE — it performs `init workflow`, activates the workflow (`active=true workflow_type=debug phase=context_init`), runs `preflight generate`, computes + caches `memory_signal` / `scope_hint` / `scope_trust`, and evicts stale Graphify artifacts — collapsing the hand-rolled preamble's ~6 data-gathering round-trips into one (uniform with dev-workflow.md + quick-implement.md):

```bash
CTX=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state workflow-context-init --workflow-type=debug --scope="${BUG_DESCRIPTION}" ${PRIMARY_BRANCH:+--primary-branch=$PRIMARY_BRANCH})
PREREQ_FAILED=$(printf '%s\n' "$CTX" | jq -r '.prerequisite_failed // empty')
if [ -n "$PREREQ_FAILED" ]; then
  echo "BLOCKED: compound init failed — workflow-context-init prerequisite ${PREREQ_FAILED}: $(printf '%s\n' "$CTX" | jq -r '.detail // ""')"
  exit 1
fi
# debug-specific fields the wrapper doesn't stamp (it sets workflow_type + context_init phase).
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=debug status=IN_PROGRESS verdict=null repair=null verify_iteration=0 stopped_at=null stopped_phase=null resume_context=null
```

Load project context (orchestrator-side reads, not CLI round-trips): governing-rule values (`CLAUDE.md`, `.devt/rules/coding-standards.md`, `quality-gates.md`) are in `$CTX.init.governing_rules.content` — under the default `delivery_mode: by-reference` they are short `(by-reference: …)` stubs (the debugger Reads from disk when relevant; the envelope's Context-Loaded contract keeps that honest), full bodies only with config `dispatch.rules_mode: inline`. Fill the `{models.<agent>}` / `<governing_rules>` dispatch placeholders VERBATIM from `$CTX.init`; for any placeholder whose key is absent from content, fill `(no <path> available — file not present in this project)`.

The wrapper writes the same side-effect artifacts the inline steps did — `preflight-brief.{md,json}` + `memory_signal_json` / `scope_hint_json` / `scope_trust_json` cached in `workflow.yaml` (the debugger dispatch reads them back). Its `preflight generate "${BUG_DESCRIPTION}"` produces `.devt/state/preflight-brief.md` so the debugger reads governing rules + REJ tombstones before proposing fixes (especially load-bearing for "we already tried that" cases); its `preflight scope-cache` computes `scope_hint` + `scope_trust` with the mechanical staleness override (forces `trust='sparse'` + writes `.devt/state/staleness-suppressed.txt` when `graph_stats.state=ready` AND `lag_commits` is null or exceeds `graphify.stale_threshold`); and `state evict-graphify` ran after the freshness read so a clean resume reuses its `graph-impact.md`.

**Staleness gate** — If `preflight-brief.json::staleness.lag_commits > graphify.stale_threshold` (default 30) OR (`graph_stats.state` is `ready` AND `staleness.lag_commits` is `null`), prompt the user via AskUserQuestion BEFORE the debugger dispatch: "Graphify graph is {lag_commits ?? 'unknown'} commits behind HEAD; symbol-to-file mappings may be stale. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed. Skip only when graphify is disabled — a null `lag_commits` while `state=ready` (e.g., unreachable SHA, shallow clone) now triggers the prompt instead of silently disabling the gate. **Silent-warn band** — when `0 < staleness.lag_commits < graphify.stale_threshold` (behind HEAD but within tolerance), do NOT prompt: emit a one-line `[staleness] graph is {lag_commits} commits behind HEAD; caller-sets may be slightly stale (lag<threshold)` note and continue, matching `/devt:review`'s tiered `warn` tier.

**Graphify scan-prep gate** — When the graph is dense AND blast radius is substantial AND topic symbols resolved, instruct the orchestrator to write a fresh `.devt/state/graph-impact.md` via two MCP calls. Field-validated threshold: `direct_dependents_count >= 10 AND graph_stats.trust == "dense"`. Below the threshold (or graphify disabled): skip; the debugger falls back to grep + stack trace. The decision tree is bash; the MCP calls are the orchestrator's responsibility:

```bash
# `preflight scan-prep` consolidates the decision tree (reads
# preflight-brief.json's direct_dependents_count + graph_stats.trust +
# topic.symbols, applies the adaptive threshold, picks the central symbol) into
# one call and writes graphify-skip-reason.txt on SKIP — the same CLI
# dev-workflow.md + quick-implement.md use. Returns
# {decision, central_symbol, dependents, trust, threshold, symbols_count, reason}.
SCAN=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight scan-prep --scope="${BUG_DESCRIPTION}")
DECISION=$(printf '%s\n' "$SCAN" | jq -r '.decision')
CENTRAL_SYMBOL=$(printf '%s\n' "$SCAN" | jq -r '.central_symbol // empty')
echo "graphify_scan_prep: $DECISION — $(printf '%s\n' "$SCAN" | jq -r '.reason // ("central=" + (.central_symbol // "?") + " dependents=" + (.dependents|tostring) + " trust=" + .trust)')"
```

**Act on `$DECISION`** (`GRAPHIFY-STEP:decision`, MODE=debug) — Read `${CLAUDE_PLUGIN_ROOT}/workflows/graphify-scan.steps.md` and execute its `## decision` block for the emitted value: ACTIVE runs the blast_radius + top-3 drill-down MCP calls into `.devt/state/graph-impact.md`; SKIP proceeds on the CLI-written skip artifact; RECOVERY resolves `CENTRAL_SYMBOL` via the `query_graph` fallback first. The graphify-decision gate below still requires the resulting artifact.

**Decision artifact assertion** — hard-fail if the orchestrator skipped writing either artifact:

```bash
PFRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-preflight-fresh)
if [ "$(printf '%s\n' "$PFRESH" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: preflight-brief is stale — $(printf '%s\n' "$PFRESH" | jq -r '.reason')"
  exit 1
fi
ASSERT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-graphify-decision)
if [ "$(printf '%s\n' "$ASSERT" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: graphify decision artifact missing — $(printf '%s\n' "$ASSERT" | jq -r '.reason')"
  exit 1
fi
```

The assert auto-passes when graphify is disabled or the graph is missing (`graphify_state != "ready"`).

**Gate**: If compound init fails, STOP with BLOCKED. If `state assert-graphify-decision` returns `ok:false`, STOP with BLOCKED.
</step>

<step name="init" gate="project context loaded">
## Step 1: Initialize

Read `.devt/rules/coding-standards.md` and `.devt/rules/quality-gates.md` for context.
Read `CLAUDE.md` if it exists.
</step>

<step name="gather_symptoms" gate="symptoms captured in debug-context.md">
## Step 2: Gather Symptoms

Before dispatching debugger, capture:

- What is the expected behavior?
- What is the actual behavior?
- Error message (if any)
- Steps to reproduce
- When did it start? (recent change?)

Write to `.devt/state/debug-context.md`
</step>

<step name="dispatch" gate="debugger returns a status">
## Step 3: Dispatch Debugger

<!-- BEGIN dispatch:debugger:debug -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/debugger-debug.tmpl.md -->
Task(subagent_type="devt:debugger", model="{models.debugger}", prompt="
<context>
<files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md</files_to_read>
<scope_hint>{scope_hint_json}</scope_hint>
<scope_trust>{scope_trust_json}</scope_trust>
<graph_impact>
{graph_impact_content}
</graph_impact>
<graph_impact_note>The above is orchestrator-mediated MCP output inlined from .devt/state/graph-impact.md — pre-computed caller set + blast radius for the bug's central symbol. When the inlined content is a "(no graph-impact.md available — ...)" notice, fall back to following the stack trace from the symptom.</graph_impact_note>
<symptoms>Read .devt/state/debug-context.md</symptoms>
<agent_skills>{injected from .devt/config.json if available}</agent_skills>
</context>
<bug>{bug_description}</bug>
Follow the 4-phase investigation protocol. Write findings to .devt/state/debug-summary.md.

Your tool surface does not include `mcp__*graphify*`. Use the `<scope_hint>` block (derived from preflight Brief blast-radius) as the high-signal starting set for hypothesis formation, then validate with Grep/Read. When `<scope_trust>.trust` is `empty`, fall back to following the stack trace from the symptom.

**Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing debug-summary.md): per your `knowledge_candidates` step, if debugging surfaces a non-obvious pattern (recurring bug class, hidden invariant the bug violated, environmental gotcha worth documenting), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes the 5-filter test: specificity, durability, non-obviousness, evidence, actionability. When none qualify, surface that decision in debug-summary.md.
")
<!-- END dispatch:debugger:debug -->

**Claim-check (Q11)**: Before proceeding past the debugger dispatch, mechanically verify the debugger wrote its declared output. Why: without a Layer-1 check at the dispatch site, Layer-2's `assert-claim-checks-resolved` at finalize passes vacuously when no Layer-1 calls ever fired (`claim-check-failures.jsonl` stays absent regardless of dispatch outcome).

```bash
PDC=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state post-dispatch-check debugger)
if [ "$(printf '%s\n' "$PDC" | jq -r '.action')" != "proceed" ]; then
  echo "[BLOCKED] devt: $(printf '%s\n' "$PDC" | jq -r '.action + " — " + .reason')"
fi
```

`post-dispatch-check` folds the Layer-1 artifact assertion (plus a partial-recovery diagnosis — a no-op for the debugger, which has no sidecar) into one `{action}` verdict. If the action is not `proceed`: `redispatch` → the debugger returned without writing debug-summary.md, so re-dispatch with an explicit instruction to write it; `investigate` → an abnormal stop (no rate-limit signal), inspect the transcript before re-dispatching.

</step>

<step name="auto_curator" gate="curator dispatched if config + threshold + cooldown all permit">

**F6 — Conditional auto-curator.** Same gate as `/devt:review`. When `memory.auto_curator_on_review = true` AND `_suggestions.md` has ≥ `memory.auto_curator_min_candidates` (default 3) AND last curator run was ≥ `memory.auto_curator_cooldown_days` (default 7) ago, refresh harvest and fire curator dispatch. Skipped silently otherwise.

```bash
AUTO=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_on_review 2>/dev/null | jq -r '.value // false')
if [ "$AUTO" = "true" ]; then
  MIN=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_min_candidates 2>/dev/null | jq -r '.value // 3')
  COOLDOWN=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get memory.auto_curator_cooldown_days 2>/dev/null | jq -r '.value // 7')
  CANDIDATES=$(/usr/bin/grep -cE '^###\s+[⚖️🔵]' .devt/memory/_suggestions.md 2>/dev/null || echo 0)
  LAST_RUN_FILE=.devt/state/last-curator-run.txt
  COOLDOWN_OK=1
  if [ -f "$LAST_RUN_FILE" ]; then
    LAST_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$(cat "$LAST_RUN_FILE")" "+%s" 2>/dev/null || echo 0)
    NOW_EPOCH=$(date "+%s")
    AGE_DAYS=$(( (NOW_EPOCH - LAST_EPOCH) / 86400 ))
    if [ "$AGE_DAYS" -lt "$COOLDOWN" ]; then COOLDOWN_OK=0; fi
  fi
  if [ "$CANDIDATES" -ge "$MIN" ] && [ "$COOLDOWN_OK" = "1" ]; then
    echo "auto_curator: ACTIVE — candidates=$CANDIDATES min=$MIN age=${AGE_DAYS:-never}d cooldown=${COOLDOWN}d"
    node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory suggest >/dev/null 2>&1 || true
    date -u "+%Y-%m-%dT%H:%M:%SZ" > "$LAST_RUN_FILE"
  else
    echo "auto_curator: SKIP — candidates=$CANDIDATES (need $MIN) cooldown_ok=$COOLDOWN_OK"
  fi
else
  echo "auto_curator: DISABLED — memory.auto_curator_on_review=false (default; opt-in via .devt/config.json)"
fi
```

When ACTIVE, dispatch curator:

```
<!-- BEGIN dispatch:curator:debug -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/curator-debug.tmpl.md -->
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <context>
    <files_to_read>.devt/memory/_suggestions.md, .devt/memory/lessons/*.md (existing)</files_to_read>
    <agent_skills>{injected from .devt/config.json — must include devt:memory-curation}</agent_skills>
  </context>
  <task>
    Auto-curator triggered by /devt:debug post-debug threshold (≥${MIN} candidates pending, last run ≥${COOLDOWN}d ago).
    Evaluate ⚖️/🔵 entries in .devt/memory/_suggestions.md. For each that passes the 5-filter, present an
    AskUserQuestion proposal per memory-curation skill. Accepted candidates land in
    .devt/memory/{decisions,concepts,flows,rejected}/. Write .devt/state/curation-summary.md.
  </task>
")
<!-- END dispatch:curator:debug -->
```

</step>

<step name="post_fix_graphify_refresh" gate="refresh decision recorded">

**Post-fix graphify refresh** — When `graphify.enabled=true` AND the debugger landed a fix (`debug-summary.md` status is `FIXED`), the graph is now N commits behind reality. The next workflow (review, dev, retro) would consume a stale scope_hint. Branch on `config.graphify.auto_refresh_post_impl` (default `"ask"`):

- **`"ask"` (default)** AND interactive (non-autonomous) mode: emit AskUserQuestion with header "Graphify refresh", question "Debug fix landed. The graph is now N commits behind reality. Refresh now?", three options:
    1. **Refresh now (recommended)** — runs `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify maybe-refresh --force --timeout=60`, surfaces one-line confirmation. Downstream workflows see the patched symbols.
    2. **Skip — I'll refresh manually later** — emits the `💡` tip and continues; user retains control. Next preflight will catch staleness via the staleness gate.
    3. **Always auto-refresh for this project** — runs the refresh AND writes `auto_refresh_post_impl: true` into `.devt/config.json` so future workflows in this project skip the prompt.
- **`true`** OR autonomous mode: silently call `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify maybe-refresh --force --timeout=60`. Surface a one-line confirmation: `🔄 Refreshed graphify graph after fix (Xs)` or `⚠️ Graphify refresh skipped: <reason>`. Continue regardless — refresh is best-effort.
- **`false`**: emit only the one-line tip — `💡 Debug fix landed — run `graphify update .` (or `node bin/devt-tools.cjs graphify maybe-refresh --force`) to refresh the project graph. The staleness gate will catch drift on the next workflow.` No prompt, no refresh.

Skip the step entirely when graphify is disabled (`config.graphify.enabled=false`) — emit nothing. Skip when `debug-summary.md` status is `NEEDS_MORE_INVESTIGATION` or `BLOCKED` (no fix landed; graph isn't stale).

</step>

<step name="report" gate="results presented to user">
## Step 4: Report Results

**Finalize gates (one call).** `state finalize-gates` runs `aggregate-knowledge-candidates` FIRST — harvesting `#KNOWLEDGE-CANDIDATE` tags from `debug-summary.md` / `impl-summary*.md` into `scratchpad.md` so the knowledge-candidates gate can count them — then the phase-gate registry trio for the `debug` terminal phase in declared order: Layer-2 claim-check resolution (`claim_check_mode: "warn"` opts out), post-hoc raw-dispatch hygiene (`dispatch_hygiene_mode: "warn"` opts out), and knowledge-candidates-tagged. Nonzero exit on any block. The `scratchpad.md` truncate stays a separate step after `advance-phase` below — advance-phase re-runs the KC gate, so truncating earlier would empty scratchpad before that final re-check (KC-before-truncate preserved by position).

```bash
FG=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state finalize-gates --phase=debug)
if [ "$(printf '%s\n' "$FG" | jq -r '.all_ok')" != "true" ]; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=report status=BLOCKED verdict=FAILED
  echo "BLOCKED: $(printf '%s\n' "$FG" | jq -r '[.gates[] | select(.ok==false) | .gate + ": " + .reason] | join(" | ")')"
  exit 0
fi
```

When the gate trips: re-read debug-summary.md, identify non-obvious patterns the debugger described in prose (recurring bug class, hidden invariant, environmental gotcha) but did not tag, append `#KNOWLEDGE-CANDIDATE: [type=...] <summary>` lines to scratchpad.md, then re-enter report. If genuinely none qualify, write the structured none-declaration: `printf 'reason=no_novel_patterns\ndeclared_at=%s\n' "$(date -u +%FT%TZ)" > .devt/state/knowledge-candidates-none.txt`.

Read `.devt/state/debug-summary.md`:

- **FIXED**: report fix, run quality gates to verify. Confirm that the debugger agent appended an entry to its persistent memory at `.claude/agent-memory/devt-debugger/MEMORY.md` (the agent does this automatically).
- **NEEDS_MORE_INVESTIGATION**: show what was discovered, offer to re-run /devt:debug with accumulated context
- **DONE_WITH_CONCERNS**: debugger hit the 3-attempt limit on a fix. Report what was tried, what remains, and suggest next steps (manual fix or architectural review via `/devt:review --focus=arch`)
- **BLOCKED**: surface root cause analysis, suggest architectural review

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state advance-phase debug active=false
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state truncate-artifact scratchpad.md
```

The second line clears ephemeral PREFLIGHT lines from `scratchpad.md` so the next workflow in the same session starts clean — debugger writes PREFLIGHT entries during investigation, and stale entries would otherwise falsely satisfy the pre-flight-guard hook for files touched in the next workflow.
</step>

</process>

<deviation_rules>

1. **Auto-fix: bugs** — The debugger agent may fix bugs inline as part of its investigation. This is expected.
2. **Auto-fix: test gaps** — If the bug reveals a missing test, the debugger may add one.
3. **STOP: architectural** — If the root cause is architectural (wrong abstraction, missing layer, design flaw), report BLOCKED and surface to user.

</deviation_rules>

<success_criteria>

- Bug symptoms are documented in debug-context.md before investigation
- Debugger follows the 4-phase protocol (isolate, diagnose, test hypothesis, fix)
- Quality gates pass after fix (if status is FIXED)
- Summary includes root cause, not just the fix
</success_criteria>

## Memory layer integration

Debugger consults REJ tombstones BEFORE proposing fixes via `node bin/devt-tools.cjs memory
rejected-keywords`. Proposed fixes matching tombstone search_keywords are silently filtered —
DO NOT surface "but Redis would solve this" when REJ-001 already rejected Redis. When debug
findings reveal a recovery flow worth documenting, tag `#KNOWLEDGE-CANDIDATE: [type=flow]
<summary>` so curator can promote to FLOW-xxx. Debug knowledge persistent memory continues to
write to `.claude/agent-memory/devt-debugger/MEMORY.md` (existing surface).
