# Memory — Subcommand Dispatcher

Memory layer management workflow. Routes the user's `/devt:memory <subcommand>` invocation
through `bin/devt-tools.cjs memory <subcommand>` and surfaces results.

<purpose>
The memory layer (`.devt/memory/`) is the permanent knowledge graph for architectural
decisions, concepts, flows, and rejected proposals. This workflow is a thin shell over
the CLI — no agent dispatch, no state mutation beyond the index rebuild itself.

Phase 1 covers the data layer only (init, index, query, get, affects, list,
links, active, rejected-keywords, validate). Phase 2 will add curator-gated
promotion subcommands (promote, reject, suggest) that DO mutate markdown files via
AskUserQuestion approval flow.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- Node.js 22.5+ (required for `node:sqlite` FTS5 support)
- `.devt/` exists (run `/devt:setup --init` first if not)
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are CLI calls executed by the main session.
</available_agent_types>

<deviation_rules>
1. **STOP: missing Node version** — If `node:sqlite` import fails, surface the actual node version and link to the install guide. Do not attempt workarounds.
2. **STOP: corrupted index** — If `memory index` reports a SQLite error, surface the error verbatim and suggest deleting `.devt/memory/index.db` (regenerable from markdown).
3. **Auto-fix: missing subdirs** — If `memory query` or other read subcommands fail because `.devt/memory/` doesn't exist, automatically suggest `memory init`.
</deviation_rules>

<process>

<step name="parse" gate="subcommand identified">
## Step 1: Parse the user's invocation

The argument string from `${ARGUMENTS}` looks like `<subcommand> [args]`. First token is
the subcommand; remaining tokens are arguments to pass through.

If the user provided NO subcommand (empty argument), display the subcommand reference
table from `commands/memory.md` and stop.
</step>

<step name="execute" gate="CLI invoked and result captured">
## Step 2: Execute via bin/devt-tools.cjs

Run the subcommand via Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory <subcommand> [args...]
```

The CLI returns JSON on stdout (always) and human-readable errors on stderr (on failure).
Capture both. Exit code 0 = success, 1 = not-found / business error, 2 = usage error.

For `init`: this scaffolds `.devt/memory/{decisions,concepts,flows,rejected}/` if missing
AND runs the first index pass. Idempotent — safe to run repeatedly.

For `index`: this performs an atomic drop+rebuild within a SQLite transaction. If
anything fails mid-rebuild, the previous index is preserved. The rebuild reads ALL
markdown files in `.devt/memory/{decisions,concepts,flows,rejected}/` (skipping any
file whose name starts with `_` and any template scaffold whose id ends with `-000`).
</step>

<step name="render" gate="user sees result">
## Step 3: Render the result

Translate the JSON into a readable summary appropriate to the subcommand. Examples:

**init / index**:
> Memory layer initialized.
> - Created: .devt/memory/decisions/, concepts/, flows/, rejected/
> - Indexed: 0 docs (no ADRs yet)
> - Schema version: 1
> - Index path: .devt/memory/index.db
> Next: drop your first ADR in `.devt/memory/decisions/ADR-001-<slug>.md` (use `templates/memory/ADR-template.md`) and run `/devt:memory index`.

**query <terms>**:
> Top N matches for "<terms>":
> 1. ADR-007 "Argon2 password hashing" — security domain, active
>    "Use argon2 for password hashing for audit compliance"
> 2. REJ-001 "Redis sessions" — security domain, rejected
>    "Redis sessions rejected for compliance audit"
> No matches for `<terms>` — try broader terms or `/devt:memory list` to browse.

**affects <path>**:
> Active/candidate docs governing `<path>`:
> - ADR-007 (Argon2 password hashing) via affects_paths: src/auth/**
> - CON-003 (Auth domain model) via affects_paths: src/auth/**

**validate**:
> docs_scanned: N | errors: M | warnings: K
> Errors: <list with file paths and reasons>
> Warnings: <list with file paths and reasons>

For empty results (no docs match), say so plainly without padding ("No active ADRs in domain 'security'.").

For schema errors, surface the file path and the specific field/violation so the user
can fix the markdown directly.
</step>

</process>

<success_criteria>
- The CLI subcommand was executed
- The result was rendered to the user
- For mutating subcommands (init, index): the SQLite index file at `.devt/memory/index.db` reflects the current markdown state
- For read subcommands (query, get, affects, list, links, active, rejected-keywords, validate): no side effects on disk
</success_criteria>
