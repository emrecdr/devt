# Graphify scan protocol — shared decision bodies (single source)

This file is the SINGLE SOURCE for the `graphify_scan_prep` decision bodies
shared by `workflows/dev-workflow.md` (MODE=dev), `workflows/quick-implement.md`
(MODE=qi), and `workflows/debug.md` (MODE=debug). Each parent runs its resident
scan-prep bash (which emits `$DECISION`), then a `GRAPHIFY-STEP:decision`
pointer Reads this file and executes the matching block. Clauses marked
**MODE=x** apply in that mode alone; everything unmarked applies in all three.
History: these bodies lived copy-pasted in three parents and drifted at the
wording level (three phrasings of the drill-down instruction, divergent
RECOVERY tails). `research-task.md` carries an older bash-echo variant and does
NOT load this file.

## decision

The CLI emits exactly one of `graphify_scan_prep: ACTIVE` / `graphify_scan_prep: RECOVERY` / `graphify_scan_prep: SKIP` (also in `$DECISION`). Act on it:

**`graphify_scan_prep: ACTIVE`** — `$CENTRAL_SYMBOL` resolved. Execute these two MCP calls and concatenate the output into `.devt/state/graph-impact.md`:

1. **`mcp__plugin_devt_devt-graphify__blast_radius({symbols: ["<CENTRAL_SYMBOL>"]})`** — first call, returns the impact map with `direct_dependents` array.
2. **Drill-down on top-3 direct dependents** (multi-tier follow-up). Parse the `direct_dependents` array from blast_radius response, select the top 3 by `impact_size` (or first 3 if no rank), and for each call `mcp__plugin_devt_devt-graphify__get_neighbors({symbol: "<DEPENDENT_NAME>", direction: "in", depth: 2})`. This drills DOWN the impact tree — surfaces which callers will be affected if each high-risk dependent breaks. Why: one blast_radius call alone leaves lane subagents grep-hunting for caller sets that 3 cheap MCP calls would have surfaced.

Format `graph-impact.md` with sections `# Graph Impact — <task>` / `## Blast radius — <CENTRAL_SYMBOL>` / `## Drill-down: <dep1> [call: <correlation_id>]` / `## Drill-down: <dep2> [call: <correlation_id>]` / `## Drill-down: <dep3> [call: <correlation_id>]`. The `correlation_id` is the `_meta.correlation_id` field returned by each `get_neighbors` MCP response (8-char hex); omit the `[call: ...]` suffix when the field is absent so downstream lane reviewers can cite specific calls via `mcp-stats --correlation-id=<id>`. The subsequent scan / architect / implement steps will Read this file. When fewer than 3 direct_dependents are returned (small graph or leaf central symbol), drill into all available — the section may have 0-3 drill-downs.

**`graphify_scan_prep: SKIP`** — the CLI already wrote `graphify-skip-reason.txt` as the explicit decision artifact and no MCP call is made — downstream agents fall back to grep + scope_hint (**MODE=debug**: the debugger falls back to grep + stack trace).

**`graphify_scan_prep: RECOVERY`** — topic extraction returned 0 symbols on a dense graph (the snake_case fallback also missed). Orchestrator MUST first call `mcp__plugin_devt_devt-graphify__query_graph({text: "${TASK_DESCRIPTION}", limit: 5})` — the `query_graph(task_text)` fallback — to resolve synthetic symbols against the graph, then proceed with `get_neighbors` + `blast_radius` using the top result's label as `CENTRAL_SYMBOL`. Write `graph-impact.md` with an additional `## Fuzzy symbol resolution` section listing the query and top results so the audit trail is explicit about how CENTRAL_SYMBOL was derived. The assert-graphify-decision gate below still requires either graph-impact.md or graphify-skip-reason.txt — recovery succeeds by producing the former.
