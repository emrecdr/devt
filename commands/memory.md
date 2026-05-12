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
decisions, concepts, flows, and rejected proposals — distinct from the per-workflow
state at `.devt/state/decisions.md` and the operational lessons at
`.devt/learning-playbook.md`.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/memory-init.md
</execution_context>

<process>

## Subcommand routing

Parse the user's argument. The first token is the subcommand; remaining tokens are args.

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

## Execution

For ALL subcommands: run via Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory <subcommand> [args...]
```

The CLI returns JSON. Render it to the user as a readable summary, surfacing:
- For `init`/`index`: created paths, inserted doc count, schema_version, last_built_at, **`memory_roots`**, **`conflict_count` + `conflicts[]`** when same id appears in multiple configured roots
- For `query`: ranked hits with id/title/summary/file_path/doc_type
- For `get`: full doc record including affects_paths/affects_symbols/links/search_keywords (rejected-only) and **`source_root`**
- For `affects`: matching docs ordered by id
- For `list`: tabular summary including **`source_root`** for provenance
- For `links`: tree showing depth, target_exists status, link_type
- For `validate`: errors first, warnings second, with file paths and reasons

**Multi-root behavior**: when `memory.paths` is set in `.devt/config.json`, all subcommands operate over the union of configured roots. `index` rebuilds the unified FTS5 from all roots. `get`/`list`/`active`/`affects`/`query` return docs from any root, with last-wins precedence on ID collisions (project-local always wins). Surface `source_root` to the user so they can see which root governs a hit. See `docs/MEMORY.md` "Multi-Root Memory" for setup.

If the user passes no subcommand or an unknown one, surface the table above.

## Boundaries

- This command is **read/write on the markdown files**, **read-only on the index** during query subcommands, and **write on the index** during init/index.
- Permanent ADR/CON/FLOW/REJ markdown files are NEVER created automatically by these subcommands. Phase 2 will add `promote` and `reject` subcommands that DO create files, but those routes through curator's AskUserQuestion approval flow.
- For ephemeral session decisions (DEC-xxx in `.devt/state/decisions.md`), use `/devt:clarify` instead — those are workflow-scoped and reset between workflows.
- For operational lessons ("when X fails, check Y first"), use `/devt:retro` — those go to the learning-playbook, not the memory layer.

</process>
