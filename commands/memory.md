---
name: memory
description: Manage the permanent memory layer at .devt/memory/ (ADR/Concept/Flow/Rejected/Lesson). Subcommands - init, index, query, list, affects, promote, reject, suggest, validate.
argument-hint: "<subcommand> [args]   e.g. /devt:memory query argon hashing"
---

<tool_restrictions>
This workflow uses: Bash, Read
</tool_restrictions>

<objective>
Route the user's `/devt:memory <subcommand> [args]` invocation to bin/devt-tools.cjs and
display the result. The memory layer is the permanent knowledge graph for architectural
decisions, concepts, flows, rejected proposals, and operational lessons (LES) — all
curator-gated in `.devt/memory/{decisions,concepts,flows,rejected,lessons}/`, distinct
from the ephemeral per-workflow state at `.devt/state/decisions.md`. This command is a
thin shell over the CLI — no agent dispatch, no state mutation beyond the index rebuild
itself; it is the single owner of the memory subcommand surface (no workflow body to load).
</objective>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- Node.js 22.5+ (required for `node:sqlite` FTS5 support)
- `.devt/` exists (run `/devt:setup --init` first if not)
</prerequisites>

<process>
## Subcommand routing

Parse the user's argument. The first token is the subcommand; remaining tokens are args.
If the user passes no subcommand or an unknown one, surface this table and stop.

| Subcommand | Description | Example |
|---|---|---|
| `init` | Scaffold `.devt/memory/{decisions,concepts,flows,rejected}/` and run first FTS5 index pass. Idempotent. | `/devt:memory init` |
| `index` | Atomic drop+rebuild of the SQLite FTS5 unified index from markdown. | `/devt:memory index` |
| `query <terms>` | Full-text search across all indexed docs (prefix-matched, AND-combined). | `/devt:memory query argon hashing` |
| `get <id>` | Fetch a single doc by id (e.g. ADR-007, REJ-001). | `/devt:memory get ADR-007` |
| `affects <path>` | Which active/candidate ADRs/CONs/FLOWs govern this file? Glob-aware. | `/devt:memory affects src/auth/service.ts` |
| `list [doc_type]` | List all docs, optionally filtered by `decision`/`concept`/`flow`/`rejected`. | `/devt:memory list decision` |
| `links <id> [--depth=N]` | Transitive link traversal (default depth 2) — useful for impact analysis before retiring an ADR. | `/devt:memory links ADR-007 --depth=3` |
| `active [domain]` | All `status: active` docs, optionally filtered by domain. | `/devt:memory active security` |
| `rejected-keywords` | All REJ tombstones with their AI-suppression search_keywords. Used by autoskill before proposing changes. | `/devt:memory rejected-keywords` |
| `validate` | Schema check + path resolution + broken-link detection. Reports errors and warnings. | `/devt:memory validate` |
| `suggest` | Scan session state for promotion candidates and stage them in `.devt/memory/_suggestions.md`. No permanent files written. | `/devt:memory suggest` |
| `promote [DEC-id]` | Curator-gated: promote a candidate (DEC-xxx, a `_suggestions.md` entry, or a caller payload) into a permanent ADR/CON/FLOW via the curator's AskUserQuestion approval flow. | `/devt:memory promote DEC-003` |
| `reject <statement>` | Curator-gated: capture a rejection as a permanent REJ tombstone (suppresses future re-proposals). | `/devt:memory reject "no Redis sessions — compliance"` |

**Curator-gated routing** — `promote` and `reject` do NOT call the CLI (the CLI returns
exit 2 for them by design: permanent memory is mutated only through curator approval).
Instead Read `${CLAUDE_PLUGIN_ROOT}/workflows/memory-promote.md` (or `memory-reject.md`)
via the Read tool and execute its steps, then STOP. All other subcommands — including
`suggest`, which stages candidates without touching permanent memory — run as CLI calls.

## Execution

For all data-layer subcommands, run via Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory <subcommand> [args...]
```

The CLI returns JSON on stdout (always) and human-readable errors on stderr (on failure).
Exit code 0 = success, 1 = not-found / business error, 2 = usage error.

`index` performs an atomic drop+rebuild inside a SQLite transaction — a mid-rebuild
failure preserves the previous index. The rebuild reads all markdown in
`.devt/memory/{decisions,concepts,flows,rejected}/`, skipping `_`-prefixed files and
template scaffolds whose id ends with `-000`. `init` scaffolds the directories AND runs
the first index pass; idempotent.

## Rendering

Translate the JSON into a readable summary, surfacing:
- For `init`/`index`: created paths, inserted doc count, schema_version, last_built_at, **`memory_roots`**, **`conflict_count` + `conflicts[]`** when same id appears in multiple configured roots
- For `query`: ranked hits with id/title/summary/file_path/doc_type
- For `get`: full doc record including affects_paths/affects_symbols/links/search_keywords (rejected-only) and **`source_root`**
- For `affects`: matching docs ordered by id
- For `list`: tabular summary including **`source_root`** for provenance
- For `links`: tree showing depth, target_exists status, link_type
- For `validate`: errors first, warnings second, with file paths and reasons

For empty results, say so plainly without padding ("No active ADRs in domain 'security'.").
For schema errors, surface the file path and the specific field/violation so the user can
fix the markdown directly.

**Multi-root behavior**: when `memory.paths` is set in `.devt/config.json`, all subcommands operate over the union of configured roots. `index` rebuilds the unified FTS5 from all roots. `get`/`list`/`active`/`affects`/`query` return docs from any root, with last-wins precedence on ID collisions (project-local always wins). Surface `source_root` to the user so they can see which root governs a hit. See `docs/MEMORY.md` "Multi-Root Memory" for setup.

## Failure handling

1. **STOP: missing Node version** — if the `node:sqlite` import fails, surface the actual node version and link to the install guide; do not attempt workarounds.
2. **STOP: corrupted index** — if `memory index` reports a SQLite error, surface it verbatim and suggest deleting `.devt/memory/index.db` (regenerable from markdown).
3. **Auto-fix: missing subdirs** — if a read subcommand fails because `.devt/memory/` doesn't exist, suggest `memory init`.

## Boundaries

- This command is **read/write on the markdown files**, **read-only on the index** during query subcommands, and **write on the index** during init/index.
- Permanent ADR/CON/FLOW/REJ markdown files are NEVER created automatically. The `promote` and `reject` subcommands DO create them, but only through the curator's AskUserQuestion approval flow (routed via `workflows/memory-promote.md` / `memory-reject.md`) — never without explicit user approval.
- For ephemeral session decisions (DEC-xxx in `.devt/state/decisions.md`), use `/devt:workflow --mode=clarify` instead — those are workflow-scoped and reset between workflows.
- For operational lessons ("when X fails, check Y first"), use `/devt:workflow --retro` — those are extracted as candidates and promoted by the curator into `.devt/memory/lessons/` (LES-NNNN).

</process>
