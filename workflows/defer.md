# Defer — Capture or manage a deferred TODO

Captures a deferred TODO to `.devt/state/deferred.md`, or manages existing items
(list / close / reopen / count / get). The file is exempted from `state reset`
so items survive `/devt:workflow --cancel`.

---

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set
- `node` is available on PATH
- `.devt/state/` exists (auto-created by `defer add` if missing)
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps execute in the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

---

## Steps

<step name="route_subcommand" gate="subcommand identified or default add">

Inspect the argument the user passed to `/devt:note --defer`:

- If first arg is `list` / `close` / `reopen` / `count` / `get` → route to the matching subcommand below.
- Otherwise treat the entire argument as the title of a new deferred item (`add` mode).

If the argument is empty, ask via AskUserQuestion: "What should be deferred?" with the most recent context-relevant suggestions (review.md findings, scratchpad #KNOWLEDGE-CANDIDATE tags) as options.
</step>

<step name="capture" gate="DEF-NNN written to .devt/state/deferred.md">

_Run when the user typed `/devt:note --defer "<title>"` (no subcommand)._

Auto-detect capture context:

```bash
# Active workflow type, if any
WORKFLOW=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read 2>/dev/null | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{try{const w=JSON.parse(s).workflow_type;process.stdout.write(w||'')}catch{process.stdout.write('')}})")
# The agent or persona invoking the command (default: user)
CAPTURED_BY=${WORKFLOW:+"workflow:$WORKFLOW"}
```

Then call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" deferred add "$TITLE" \
  ${CONTEXT:+--context="$CONTEXT"} \
  ${TAGS:+--tags="$TAGS"} \
  ${CAPTURED_BY:+--by="$CAPTURED_BY"}
```

Report the assigned `DEF-NNN` to the user, plus the queue count. Example:

> Captured **DEF-007**: "Add rate limiting to /api/login"
> Deferred queue: **3 open**, 5 closed.

If the title is unclear or context-rich, offer to enrich via AskUserQuestion (tags, context excerpt). Do NOT block on enrichment — capture is the primary value.
</step>

<step name="list" gate="filtered list reported to user">

_Run on `/devt:note --defer list [--status=...] [--tag=...]`._

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" deferred list ${FLAGS}
```

Render as a markdown table:

| ID | Title | Status | Tags | Captured |
|----|-------|--------|------|----------|
| DEF-001 | Add rate limiting | open | security, api | 2026-05-06 |

Default: `--status=open` (the active queue). Use `--status=closed` for completed history.
</step>

<step name="close" gate="DEF-NNN status flipped to closed">

_Run on `/devt:note --defer close DEF-007`._

Validate the id matches `DEF-\d{3,}` before invoking. Then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" deferred close "$ID" --by="user"
```

Report the new state. If the id is not found, the CLI returns exit 1 — surface the error verbatim.
</step>

<step name="reopen" gate="DEF-NNN status flipped to open">

_Run on `/devt:note --defer reopen DEF-007`._

Same shape as `close`, with `reopen`. Removes the `closed_at` and `closed_by` fields.
</step>

<step name="count" gate="counts emitted">

_Run on `/devt:note --defer count`._

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" deferred count
```

Renders as: `Deferred queue: N open, M closed (T total)`.
</step>

<step name="get" gate="single DEF-NNN entry fetched">

_Run on `/devt:note --defer get DEF-007`._

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" deferred get "$ID"
```

Render the full block (heading + key:value list).
</step>

---

<deviation_rules>

1. **Auto-fix: bugs** — Not applicable. Capture/manage workflow, no code changes.
2. **Auto-fix: lint** — Not applicable.
3. **Auto-fix: deps** — If `.devt/state/` doesn't exist, the CLI auto-creates it.
4. **STOP: architecture** — If a user asks "should this be deferred or a memory ADR?", stop and route them to `/devt:memory promote` instead. Permanent architectural decisions belong in `.devt/memory/`, not the deferred queue.
</deviation_rules>

<success_criteria>

- For `add`: a new `DEF-NNN` entry exists in `.devt/state/deferred.md`
- For `list`/`get`/`count`: the user sees the requested data
- For `close`/`reopen`: the entry's status is correctly flipped, with `closed_at`/`closed_by` set/cleared
- Status: **DONE**
</success_criteria>
