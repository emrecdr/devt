# Preflight — Topic Pre-Flight Brief Generator

Generates `.devt/state/preflight-brief.md` for a development task by running
six independent discovery lanes (A-F) plus Graphify blast radius analysis,
then synthesizing the merged result into a single markdown brief that every
downstream agent reads before proposing changes.

<purpose>
The Topic Pre-Flight Brief is the **single source of truth** for what governing
rules apply to the current task. Without it, agents either miss prior decisions
(causing unintended ADR violations) or burn tokens re-discovering the same
context per agent. The Brief is generated **once** at workflow init, persisted
to `.devt/state/preflight-brief.md`, and consumed by every agent in the workflow.

Tier 1 of the Two-Tier Pre-Flight Protocol (golden-rules Rule 14):
- **Tier 1 (this workflow)**: comprehensive Topic Pre-Flight at workflow start
- **Tier 2 (PreToolUse hook)**: lightweight File Pre-Flight per Edit, with optional
  scope-expanded 5-lane lookup if the file is not covered by the existing Brief
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set
- Node.js 22.5+ (required for `node:sqlite`)
- `.devt/` exists (run `/devt:init` first)
- Optional: `.devt/memory/index.db` exists (run `/devt:memory init` for richer Brief)
- Optional: `graphify.enabled: true` in `.devt/config.json` for blast radius
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are CLI calls executed by the main session.
</available_agent_types>

<deviation_rules>
1. **Continue: missing memory index** — preflight degrades to keyword-only; the Brief shows empty governance sections and notes the missing index. Recommend the user run `/devt:memory init`.
2. **Continue: graphify disabled** — blast radius section explains the degradation. Brief is still generated.
3. **STOP: empty task description** — if no task argument, prompt the user. Never generate a Brief for a blank task.
4. **STOP: state dir unwritable** — surface the FS error. Do not silently swallow.
</deviation_rules>

<process>

<step name="parse" gate="task description captured">
## Step 1: Parse the user's invocation

The argument string from `${ARGUMENTS}` is the free-form task description.
First word may be a subcommand (`topic` | `status` | `mark-stale`) — route those
to the corresponding CLI subcommand. Otherwise treat the whole argument as the
task description and call `preflight generate "<task>"`.

If empty, ask the user for a task description and stop.
</step>

<step name="execute" gate="CLI invoked and result captured">
## Step 2: Generate the Brief

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "<task description>"
```

The CLI:
1. Extracts topic structure (domains, symbols, keywords)
2. Runs Lane A (`memory listActive` per domain)
3. Runs Lane B (`memory queryFTS` over unified index)
4. Runs Lane C (`memory getBySymbol` per extracted symbol)
5. Runs Lane D (`memory getLinks` depth-2 from A+B+C union)
6. Runs Lane E (`memory listRejectedKeywords` filtered to topic)
7. Runs Lane F (filters governing docs A∪B∪C∪D for `doc_type='lesson'` — surfaces LES-NNNN entries from `.devt/memory/lessons/`)
8. Computes blast radius via `graphify.blastRadius` (or degrades to grep heuristics)
9. Atomically writes `.devt/state/preflight-brief.md`

JSON returned on stdout includes `brief_path`, `topic`, `counts` (per lane),
`blast` (effect_size + source), and `generated_at`.
</step>

<step name="state" gate="workflow.yaml updated">
## Step 3: Mark workflow_type=preflight (only when standalone)

If this workflow was invoked standalone (`/devt:preflight ...`), update state:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=preflight phase=context_init
```

If this workflow was AUTO-FIRED from another dev workflow (`dev-workflow`,
`quick-implement`, `clarify-task`, `specify`, `research-task`, `create-plan`,
`debug`, `code-review`), DO NOT touch workflow.yaml — the parent workflow owns
the state machine; preflight only writes the Brief artifact and returns.

Detect mode: when called with `${PARENT_WORKFLOW}` set, treat as auto-fire.
Otherwise standalone.
</step>

<step name="render" gate="user sees summary">
## Step 4: Render the result

Translate the JSON summary into:

> ✓ Pre-Flight Brief generated → `.devt/state/preflight-brief.md`
>
> **Topic:** `<domains>`, `<symbols>`, `<keywords>`
> **Governing docs:** N (A:n B:n C:n D:n unique)
> **REJ tombstones:** N (Lane E)
> **Operational lessons:** N (Lane F)
> **Blast radius:** `<effect_size>` (source: graphify | grep | skipped)
>
> Re-read the Brief any time: `cat .devt/state/preflight-brief.md`

If `governing == 0 AND lane_e == 0 AND lane_f == 0`, add:

> _No prior governance found for this topic. The Brief is empty by design — proceed with normal review discipline. Capture any architectural decisions you make during this task as DEC-xxx via `/devt:clarify`; curator will offer to promote them to ADRs at retro time._

If Graphify status is `disabled` or `binary_missing`, add:

> _Tip: install Graphify for ~10× lower token cost on code-search ops + symbol-anchored blast radius. See `/devt:init --graphify` or run `pip install graphifyy[mcp]`._
</step>

</process>

<success_criteria>
- `.devt/state/preflight-brief.md` exists and starts with `## Status: FRESH`
- The Brief includes a Governing Documentation section (possibly empty)
- The Brief includes Rejected Approaches section (possibly empty)
- The Brief includes Blast Radius section with explicit source (graphify | grep | skipped)
- For standalone invocations: workflow.yaml has `workflow_type=preflight active=true`
- For auto-fire invocations: workflow.yaml is untouched (parent owns state)
</success_criteria>

<auto_fire_contract>
When a dev workflow auto-fires this workflow, it:
1. Sets `${PARENT_WORKFLOW}` env hint (informal — used by Step 3 to skip state mutation)
2. Calls `preflight generate "<task>"` early in its context_init step
3. Each subsequent agent in that workflow reads `.devt/state/preflight-brief.md` as part of context_loading
4. If an agent's Edit touches a path NOT covered by the Brief, the File Pre-Flight tier (Tier 2) runs `preflight mark-stale "scope expanded to <path>"` and appends the new lookup to scratchpad

This contract is documented in detail in `skills/memory-pre-flight/SKILL.md`.
</auto_fire_contract>
