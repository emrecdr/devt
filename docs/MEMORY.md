# The Memory Layer

> Comprehensive guide to devt's three-layer knowledge persistence model.
> Last updated for v0.19.0 (Phase 4).

devt persists structured knowledge across **three distinct layers**, each with a different lifetime, write authority, and consumption pattern. Understanding which layer to use for which fact is critical — putting an architectural decision in `.devt/state/` (ephemeral) or a transient debug note in `.devt/memory/` (permanent) is the most common authoring mistake.

## The Three Layers

```
.devt/state/                       ← LAYER 1: ephemeral (per-workflow)
├── decisions.md                       DEC-001, DEC-002 — captured during clarify/specify/research
├── plan.md, spec.md, etc.             workflow artifacts
├── preflight-brief.md                 (v0.18.0+) Topic Pre-Flight Brief — auto-fired
├── scratchpad.md                      cross-agent handoff notes within workflow
└── ...                                wiped on /devt:cancel-workflow OR `state reset`

.devt/learning-playbook.md         ← LAYER 2: permanent (operational lessons)
                                       LES-001, LES-002 — "when X fails, check Y first"
                                       managed by retro/curator existing pipeline
                                       FTS5-indexed via memory/semantic/lessons.db (v0.16.0)
                                       OR via unified .devt/memory/index.db (v0.17.0+)

.devt/memory/                      ← LAYER 3: permanent (architectural truth)
├── index.db                           gitignored FTS5 index (regenerable from markdown)
├── decisions/                         ADR-001, ADR-002 — constitutional decisions
│   └── _index.md                      auto-generated catalog
├── concepts/                          CON-001, CON-002 — durable mental models
├── flows/                             FLOW-001, FLOW-002 — named sequences
├── rejected/                          REJ-001, REJ-002 — tombstones (we said no)
└── _suggestions.md                    auto-generated discovery proposals (curator-gated)
```

### When to use each layer

| Question | Answer |
|---|---|
| "We decided to use Argon2 for passwords. Where does this go?" | **Layer 3** — ADR. It's a permanent architectural decision affecting multiple files. |
| "I picked option B for this specific PR." | **Layer 1** — DEC. It's per-workflow, doesn't bind future work. (If it turns out to be load-bearing across workflows, the curator can promote DEC → ADR via `/devt:memory promote`.) |
| "When the integration tests fail, check the migration first." | **Layer 2** — lesson. Operational gotcha for retro/curator. |
| "We tried Redis caching and rejected it for compliance." | **Layer 3** — REJ tombstone. Future agents must NOT propose Redis. |
| "AuthService talks to PaymentService via this 4-step handshake." | **Layer 3** — FLOW. Permanent named sequence. |

## Layer 3: `.devt/memory/` Frontmatter Schema

Every ADR/Concept/Flow/REJ markdown file starts with strict YAML frontmatter:

```yaml
---
id: ADR-001                    # required, unique across all four folders
title: "Switch to Argon2"      # required
doc_type: decision             # required: decision | concept | flow | rejected
domain: security               # optional, free-form tag
status: active                 # required: candidate | active | superseded | rejected
confidence: explicit           # required: verified | explicit | inferred | observed | speculative
summary: "..."                 # required, ≤200 chars (FTS5-indexed)
affects_paths:                 # optional, glob patterns
  - "src/auth/**"
affects_symbols:               # optional, validated when Graphify enabled
  - "AuthService"
links:                         # optional, typed cross-refs
  - id: ADR-007
    type: supersedes           # supersedes | depends_on | implements | relates_to
created_at: "2026-05-05T10:30:00Z"
created_by: curator | user     # provenance
---
```

For REJ tombstones, additional fields:

```yaml
reason: user_preference        # user_preference | performance | security | maintainability | compliance | complexity
search_keywords:               # AI suppression triggers — surface these to discovery + autoskill
  - "Redis caching"
  - "in-memory KV"
```

## The Two-Tier Pre-Flight Protocol (v0.18.0+)

Before any non-trivial change, the protocol runs in two tiers:

### Tier 1 — Topic Pre-Flight (workflow start, automatic)

Auto-fired by every dev workflow's context_init step:

```bash
node bin/devt-tools.cjs preflight generate "${TASK_DESCRIPTION}"
```

Produces `.devt/state/preflight-brief.md` with `## Status: FRESH`. The Brief contains:

- **Topic Extracted** — domains, symbols, keywords parsed from the task
- **Governing Documentation** — ADRs/CONs/FLOWs from Lanes A (domain), B (FTS), C (symbol), D (link closure depth-2)
- **Rejected Approaches** — REJ tombstones whose `search_keywords` overlap the topic (Lane E)
- **Related Operational Lessons** — playbook entries matching the topic (Lane F)
- **Blast Radius** — Graphify-derived dependents/effect-size (or grep heuristic if disabled)
- **Pre-Flight Recommendations** — synthesized guardrails for the agent

Standalone invocation: `/devt:preflight "<task>"` — useful before manually planning, or for re-generating after the Brief goes STALE.

### Tier 2 — File Pre-Flight (per Edit, agent-driven)

Before each `Edit`/`Write`/`NotebookEdit`, the agent appends a one-line summary to `.devt/state/scratchpad.md`:

```
PREFLIGHT 2026-05-05T15:30:00Z edit src/auth/service.ts :: ADR-007, ADR-012, CON-003
```

The PreToolUse `pre-flight-guard.sh` hook scans for this line. Behavior governed by `memory.preflight_mode`:

| Mode | Behavior |
|---|---|
| `off` | Hook is a no-op |
| `warn` (Phase 3, v0.18.0) | Stderr advisory; edit proceeds |
| `block` (Phase 4 default, v0.19.0+) | Returns `{decision: "deny"}` with a checklist; agent must produce the line first |

**5-Lane File Pre-Flight** (when scope expands beyond the Brief):

| Lane | Query | Returns |
|---|---|---|
| 0 | Warm cache *(Graphify only)* | `Read("graphify-out/wiki/index.md")` for orientation |
| 1 | Wiki-links | Parse scratchpad/Brief for `[[ADR-xxx]]` mentions |
| 2 | Path-anchored | `node bin/devt-tools.cjs memory affects "<file>"` |
| 3 | Symbol-anchored *(Graphify only)* | `node bin/devt-tools.cjs memory affects-symbol "<sym>"` |
| 4 | Domain-active | `node bin/devt-tools.cjs memory active "<domain>"` |
| 5 | FTS task-summary | `node bin/devt-tools.cjs memory query "<terms>"` |

After the lookup, run `node bin/devt-tools.cjs preflight mark-stale "scope expanded to <file>"` so the next agent knows.

## CLI Surface

```bash
# Memory layer (v0.16.0+)
node bin/devt-tools.cjs memory init              # scaffold + first index pass
node bin/devt-tools.cjs memory index             # atomic drop+rebuild FTS5
node bin/devt-tools.cjs memory query <terms>     # full-text search
node bin/devt-tools.cjs memory get <id>          # fetch single doc
node bin/devt-tools.cjs memory affects <path>    # path-based pre-flight
node bin/devt-tools.cjs memory list [doc_type]   # enumerate
node bin/devt-tools.cjs memory links <id>        # transitive link traversal
node bin/devt-tools.cjs memory active [domain]   # status: active filter
node bin/devt-tools.cjs memory rejected-keywords # all REJ search_keywords
node bin/devt-tools.cjs memory validate          # schema + link integrity
node bin/devt-tools.cjs memory backlinks <id>    # incoming refs
node bin/devt-tools.cjs memory orphans           # no-link docs
node bin/devt-tools.cjs memory stale-links       # broken cross-refs

# Discovery (v0.17.0+) — never writes permanent files
node bin/devt-tools.cjs memory suggest           # writes _suggestions.md
node bin/devt-tools.cjs discovery harvest        # full discovery sweep
node bin/devt-tools.cjs discovery wiki-links     # just wiki-link enrichment
node bin/devt-tools.cjs discovery claude-mem-status

# Pre-Flight (v0.18.0+)
node bin/devt-tools.cjs preflight generate <task>   # Lanes A-F + blast radius
node bin/devt-tools.cjs preflight topic <task>      # debug topic extraction
node bin/devt-tools.cjs preflight status            # FRESH/STALE/MISSING + timestamp
node bin/devt-tools.cjs preflight mark-stale [reason]
```

## MCP Server (v0.18.0+)

Vendored at `bin/devt-memory-mcp.cjs` — read-only stdio JSON-RPC server registered in project `.mcp.json`. Tools:

| Tool | Purpose |
|---|---|
| `get_context_for_path(path)` | Governing docs for a file |
| `get_context_for_symbol(symbol)` | Governing docs for a symbol |
| `query_fts(terms, limit?)` | Full-text search |
| `get_doc(id)` | Fetch by id |
| `list_active(domain?)` | Active docs filter |
| `list_rejected_keywords()` | All REJ search_keywords |
| `list_links(doc_id, depth?)` | Transitive link traversal |
| `preflight(task)` | Run lanes A-F + blast radius |
| `blast_radius(symbols)` | Graphify-derived blast radius |
| `query_index(sql)` | Raw SQL escape hatch — SELECT-only |

**Hard guarantees:**
- SQLite opened with `readOnly: true` — even malicious helpers cannot mutate
- `query_index` SELECT-only validator strips comments, blocks multi-statement payloads, rejects 17 forbidden tokens
- Self-test: `node bin/devt-memory-mcp.cjs --self-test` validates 15 SQL fixtures

## Curator Promotion Flow (v0.17.0+)

The curator agent gates ALL writes to `.devt/memory/`. Discovery engine (`bin/modules/discovery.cjs`) harvests:

- **claude-mem ⚖️ decision tags** → ADR/REJ candidates
- **claude-mem 🔵 discovery tags** → Concept/Lesson candidates
- **`#KNOWLEDGE-CANDIDATE` scratchpad tags** → typed candidates per the inline tag
- **`.devt/state/decisions.md` DEC entries** → ADR candidates

All candidates flow into `.devt/memory/_suggestions.md` (NEVER auto-promoted). Curator presents each via `AskUserQuestion` with the FULL original reasoning verbatim — no AI summarization. Only on user approval (Promote active | Promote candidate | Reject as REJ | Defer | Edit before promoting) does the markdown file get written.

REJ tombstones suppress future proposals matching their `search_keywords` — the "no nag" mechanism.

## Memory Maintenance Discipline

After editing any `.devt/memory/**.md` file:

- **Automatic** (when `auto_index_on_change: true`, the default): the PostToolUse `memory-auto-index.sh` hook runs `memory index`. Idempotent — no-op when nothing changed.
- **Manual** (when hooks are disabled): run `node bin/devt-tools.cjs memory index && node bin/devt-tools.cjs memory validate`.

Before proposing any new candidate, the discovery engine consults `rejected/` for matching `search_keywords` — if a tombstone matches, the candidate is suppressed silently.

## Configuration

| Key | Default | Purpose |
|---|---|---|
| `memory.enabled` | `true` | Master switch |
| `memory.preflight_mode` | `block` (v0.19.0+) | Hook behavior on missing PREFLIGHT scratchpad line |
| `memory.auto_index_on_change` | `true` | PostToolUse hook on `.devt/memory/**.md` edits |
| `memory.mcp_telemetry` | `true` (v0.21.0+) | MCP tool-call trace JSONL log |
| `memory.paths` | `null` (v0.22.0+) | List of memory roots to scan + index. `null` = single-root behavior. See "Multi-Root Memory" below. |
| `graphify.enabled` | `false` | Opt-in AST symbol anchoring |

Override per-project in `.devt/config.json`:

```json
{
  "memory": {
    "preflight_mode": "warn",
    "auto_index_on_change": false,
    "paths": ["../engineering-adrs", ".devt/memory"]
  }
}
```

## Multi-Root Memory (v0.22.0+)

Many engineering organizations have **company-wide architectural rules** that should apply to every project. Instead of copy-pasting ADRs across N project repos (which drift) or building a separate import command, devt's memory layer can index **multiple memory roots** in one project.

### Config

```json
{
  "memory": {
    "paths": [
      "../engineering-adrs",
      "/usr/local/share/acme-architecture",
      ".devt/memory"
    ]
  }
}
```

When `memory.paths` is set:

- Devt walks **every** root during `memory index` and `memory scan`
- Relative paths resolve against the project root
- The project-local root (`.devt/memory`) is **always appended last** so it has highest precedence (auto-added if missing)
- Each indexed doc is tagged with `source_root` (visible in `memory get`/`memory list` output)
- ID collisions follow **last-wins** — project-local writes shadow shared decisions, like CSS specificity

### Backward compat

When `memory.paths` is `null` or absent (the default), devt uses `[<projectRoot>/.devt/memory]` as a single root — exactly the v0.16.0–v0.21.0 behavior. Existing projects see zero change.

### Conflict reporting

When the same `id` appears in multiple roots, `memory index` returns:

```jsonc
{
  "inserted": 2,
  "memory_roots": ["/path/to/shared", "/path/to/project/.devt/memory"],
  "conflicts": [{
    "id": "ADR-001",
    "prev_source": "/path/to/shared",
    "prev_path": "/path/to/shared/decisions/ADR-001-shared.md",
    "new_source": "/path/to/project/.devt/memory",
    "new_path": ".devt/memory/decisions/ADR-001-local.md"
  }],
  "conflict_count": 1
}
```

Collisions are **always reported** — never silent. CI can fail on `conflict_count > 0` if a project wants strict no-overlap policy.

### Sharing mechanism

The shared root can come from any source:

- **Git submodule**: `git submodule add https://github.com/acme/engineering-adrs ../engineering-adrs`
- **Sibling clone**: `git clone https://github.com/acme/engineering-adrs ../engineering-adrs`
- **NFS mount**: `/mnt/acme-policy/memory`
- **Monorepo subdir**: `../../shared/memory`
- **Env-resolved path**: any absolute path

Updates flow naturally — `git pull` (or whatever) in the shared dir, next `memory index` or PostToolUse `memory-auto-index` hook picks up the change. No re-import step.

### Curator writes always go local

The curator agent (memory-curation skill) writes promoted ADRs/Concepts/Flows/REJ to the **project-local root** by default. Shared roots are read-only from devt's perspective; their maintainers edit the markdown directly with their own toolchain (e.g., a PR to the shared repo).

### Use case examples

**ACME company-wide ADRs**:
```json
{ "memory": { "paths": ["../engineering-adrs", ".devt/memory"] } }
```

**Monorepo with team-shared concept models**:
```json
{ "memory": { "paths": ["../../shared/memory", ".devt/memory"] } }
```

**Multi-tier**:
```json
{ "memory": { "paths": [
  "/etc/acme/global-policy",
  "../team-platform-adrs",
  ".devt/memory"
] } }
```

Precedence: rightmost (project-local) wins, leftmost loses. Mid-tier overrides global; project overrides mid-tier.

## Migration Notes

- **v0.16.0 → v0.17.0**: legacy `memory/semantic/lessons.db` rows are imported into the unified `.devt/memory/index.db` via `memory migrate-lessons` (one-time).
- **v0.17.0 → v0.18.0**: nothing user-facing breaks. Pre-flight runs in `warn` mode by default — opt-in to `off` if you want to disable temporarily.
- **v0.18.0 → v0.19.0**: `preflight_mode` flips from `warn` to `block`. Agents that already write PREFLIGHT scratchpad lines (via the `devt:memory-pre-flight` skill) need no changes. Older custom workflows that bypass the protocol must be updated OR set `preflight_mode: "warn"` per-project.

## Related Documentation

- `guardrails/golden-rules.md` Rule 14 (Pre-Flight Protocol) and Rule 15 (Memory Maintenance)
- `guardrails/engineering-principles.md` "Sources of Truth" hierarchy
- `skills/memory-pre-flight/SKILL.md` — Two-Tier Pre-Flight protocol (preloaded onto all dev agents)
- `skills/memory-curation/SKILL.md` — curator promotion flow
- `skills/graphify-helpers/SKILL.md` — Graphify-first protocol
- `commands/memory.md`, `commands/preflight.md` — user-facing command reference
