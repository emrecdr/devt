# MCP Stats Workflow

Aggregate per-tool MCP statistics from the devt-memory trace log.

---

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- The project is a devt project (i.e., `.devt/` directory exists at the project root)
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<deviation_rules>
1. **No trace yet**: If `.devt/memory/_mcp-trace.jsonl` doesn't exist, the CLI returns `{ "error": "no MCP trace file found", "path": "...", "hint": "..." }`. Report the hint to the user cleanly — this is expected on fresh projects, not an error.
2. **Prune dry-run**: When `--prune-older-than=...` is passed, the CLI is destructive. Surface the planned eviction count to the user BEFORE confirming if the user did not explicitly include `--yes`.
</deviation_rules>

---

## Steps

<step name="run" gate="aggregated stats are presented to the user">

Invoke the CLI with whatever arguments the user passed via `$ARGUMENTS`. Common flags:
- `--since=YYYY-MM-DD` — filter records by ISO date
- `--tool=NAME` — filter to one specific MCP tool
- `--top=N --by=calls|duration|errors` — rank top N tools by the given metric
- `--prune-older-than=Nd|Nh|Nm|Ns` — evict older trace records (destructive)

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" mcp-stats $ARGUMENTS
```

Present the JSON output to the user. Key fields to highlight:
- `per_tool[].calls` — call count
- `per_tool[].error_rate` — fraction of calls that returned errors
- `per_tool[].duration.p95` — 95th-percentile duration in ms (slow tools)
- `per_tool[].result_bytes.sum` — cumulative payload size

For `--top` queries, the result is ordered — present the ranked list with a one-line summary per tool.

</step>

---

<success_criteria>
- CLI invocation succeeds and returns valid JSON
- User is shown a ranked or filtered view of MCP tool stats
- Destructive operations (`--prune-older-than`) confirm with the user before evicting
</success_criteria>

<failure_modes>
- Trace file unreadable: surface the error; suggest checking `.devt/memory/` permissions
- JSON parse errors in the trace: the CLI's `parse_errors` field reports the count; if non-zero, suggest pruning (the trace is append-only JSONL, one parse error per line is non-fatal)
</failure_modes>
