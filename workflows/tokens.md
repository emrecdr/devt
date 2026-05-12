# Tokens Workflow

Surface Claude Code session token usage from the JSONL session logs.

---

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- At least one Claude Code session has produced a JSONL log under `~/.claude/projects/<slug>/`
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<deviation_rules>
1. **No sessions yet**: If the project's session directory doesn't exist or contains no `.jsonl` files, the CLI returns a structured `{ ok: false, reason: "no_sessions" }` JSON. Report it cleanly to the user; do not treat as an error.
2. **Baseline missing**: If `--compare=PATH` is passed but the path doesn't exist, report and STOP. Suggest capturing a baseline first.
</deviation_rules>

---

## Steps

<step name="run" gate="JSON output is presented to the user">

Invoke the CLI with whatever arguments the user passed via `$ARGUMENTS`. Common flags:
- `--sessions=N` — show the last N sessions (default 5)
- `--since=YYYY-MM-DD` — filter by ISO date
- `--project=PATH` — different project than cwd
- `--baseline=PATH` — write a baseline snapshot for later comparison
- `--compare=PATH` — diff current totals against a prior baseline

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" token-report $ARGUMENTS
```

Present the JSON output to the user. Key fields to highlight:
- `aggregate.cache_hit_rate` — fraction of input tokens served from cache
- `aggregate.cache_read_input_tokens` — total tokens served from cache (the savings)
- `per_session[].cache_creation_input_tokens` — cache writes; high values mean prefix churn
- `per_session[].output_tokens` — assistant work; useful for verifying agent efficiency

If `--compare` was passed, also surface the delta — positive cache_read deltas with negative or flat cache_creation deltas indicate the optimization wave landed cleanly.

</step>

---

<success_criteria>
- CLI invocation succeeds and returns valid JSON
- User is shown a human-readable summary of the key metrics
- On `--baseline`, the baseline file is written and confirmed
- On `--compare`, the delta is computed and presented
</success_criteria>

<failure_modes>
- CLI returns non-zero: surface stderr to the user; suggest `node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" token-report --help` if the flag set is unfamiliar
- JSON parse error: indicates a CLI bug — capture the raw output and report
</failure_modes>
