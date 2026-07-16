# Memory Pre-Flight — Details (on-demand reference)

The `memory-pre-flight` skill body carries the hot protocol every agent needs
per edit. This reference holds the cold-path detail — read it when you actually
escalate to a 5-Lane File Pre-Flight, or when you need the config / multi-root
semantics. It is NOT preloaded into agent context; Read it on demand.

## Why the protocol exists

Without a structured pre-flight step, agents either:
- Miss prior architectural decisions (causing silent ADR violations)
- Propose approaches the team explicitly rejected (REJ tombstone hits)
- Burn tokens re-discovering the same context per agent
- Edit files outside their initial scope without re-checking governance

The Two-Tier Pre-Flight Protocol fixes all four. **Tier 1** (Topic Pre-Flight)
generates a comprehensive Brief at workflow start. **Tier 2** (File Pre-Flight)
verifies coverage at each Edit and escalates when scope expands.

## What the Brief contains

`.devt/state/preflight-brief.md` (`## Status: FRESH`) carries:
- **Topic Extracted** — domains, symbols, keywords parsed from the task. The JSON sidecar (`preflight-brief.json::topic.resolution_path`) records WHICH fallback leg produced the final symbol set: `diff` (working-tree changes) → `text` (PascalCase in task) → `snake_fts` / `kebab_fts` (FTS rescue on snake/kebab keywords) → `full_text_fts` (terminal FTS on the full task text) → `none`. Deeper-leg paths (`*_fts`) signal the upstream heuristics under-resolved — a useful diagnostic when reviews surface unexpected symbols.
- **Governing Documentation** — ADRs/CONs/FLOWs from Lanes A (domain), B (FTS), C (symbol), D (link closure)
- **Memory Graph (2-hop subgraph)** — flat `source → predicate → target` triples spanning the depth-2 link closure of the governing union. Scan this section to understand structural relationships (`supersedes`, `depends_on`, `relates_to`, etc.) without firing per-doc `get_doc` calls.
- **Rejected Approaches** — REJ tombstones whose `search_keywords` overlap the topic (Lane E)
- **Related Operational Lessons** — playbook entries matching the topic (Lane F)
- **Blast Radius** — Graphify-derived dependents/effect-size (or grep heuristic if disabled)
- **Pre-Flight Recommendations** — synthesized guardrails for the agent

## 5-Lane File Pre-Flight (only when scope expands)

When the file isn't covered by the Brief, run these in order:

| Lane | Query | Returns |
|---|---|---|
| 0 | Warm cache *(Graphify only)* | `Read("graphify-out/wiki/index.md")` for orientation, else `Read("GRAPH_REPORT.md")` |
| 1 | Wiki-links from local context | Parse scratchpad/Brief for `[[ADR-xxx]]`, `[[CON-xxx]]`, `[[FLOW-xxx]]`, `[[REJ-xxx]]` mentions |
| 2 | Path-anchored | `node bin/devt-tools.cjs memory affects "<file>"` |
| 3 | Symbol-anchored *(Graphify only)* | `node bin/devt-tools.cjs memory affects-symbol "<sym>"` |
| 4 | Domain-active | `node bin/devt-tools.cjs memory active "<domain>"` |
| 5 | FTS task-summary | `node bin/devt-tools.cjs memory query "<terms>"` |

**Aggregate-first probes** — when you only need to know IF/WHERE/HOW-MANY docs match (not their contents), use the aggregate flags or the matching MCP tool. Aggregates return ~50-500 bytes vs ~1.5-15KB for full payloads. Default to aggregate-first; pull full rows only when you've identified a specific doc to drill into via `get_doc`.

| Aggregate need | CLI | MCP tool |
|---|---|---|
| Count matches only | `memory query "<terms>" --count` | `query_fts_count` |
| Top-N compact preview | `memory query "<terms>" --top=5` | `query_fts_top` |
| Group by domain | `memory query "<terms>" --domain-counts` | `query_fts_by_domain` |
| All compact rows | `memory query "<terms>" --json-compact` | (use `query_fts_top` with larger n) |

After the lookup, append findings to scratchpad AND run:

```bash
node bin/devt-tools.cjs preflight mark-stale "scope expanded to <file>"
```

Marking the Brief STALE signals the next agent (and the user) that governance
coverage may be incomplete; running `/devt:preflight "<refined task>"` rebuilds
a FRESH brief on demand.

## Common pitfalls

1. **Skipping the scratchpad line "because the Brief covers this file"** — the
   hook can't read your mind; it scans for the literal `PREFLIGHT` token. Always
   write the line, even if the summary is one ADR id.
2. **Treating REJ tombstones as advisory** — they are NOT. A matching REJ in the
   Brief means the team explicitly said no to that approach. To propose it
   anyway, capture the new motivation as a DEC and ask the user to override the
   tombstone via `/devt:memory promote` (which can supersede the REJ).
3. **Stale Brief → blind plowing ahead** — STALE means coverage is incomplete,
   not that the Brief is wrong. Re-running `/devt:preflight` is cheap; assuming
   the governance is already known is expensive when it bites at code-review time.
4. **Forgetting to mark stale on scope expansion** — without the mark, the next
   agent thinks the Brief is still authoritative. The five-lane lookup is wasted
   if the next agent doesn't know it happened.

## Configuration

| Config key | Default | Purpose |
|---|---|---|
| `memory.preflight_mode` | `block` | Hook behavior on missing PREFLIGHT line — `off` no-op, `warn` advisory, `block` denies the edit |
| `memory.enabled` | `true` | Master switch — false disables Brief generation entirely |
| `memory.paths` | `null` | List of memory roots to scan. `null` = single-root (`.devt/memory`). When set, the index-backed lanes (A-G) return docs from EVERY configured root with last-wins precedence on ID collisions. The Brief surfaces the union — a shared org-wide REJ tombstone shadows the same approach in your project just as effectively as a local one. |
| `graphify.enabled` | `false` | Opt-in; controls Lanes 0/3 and blast radius |

Override per-project in `.devt/config.json`:

```json
{
  "memory": {
    "preflight_mode": "block",
    "paths": ["../engineering-adrs", ".devt/memory"]
  }
}
```

## Multi-root behavior

When `memory.paths` is set, the lane queries the agent runs (`memory listActive`,
`queryFTS`, `getBySymbol`, etc.) automatically span all configured roots. The Brief
the agent reads at workflow start surfaces governing docs from any root — a shared
org-wide ADR-007 in `../engineering-adrs/decisions/` constrains your work just as
forcefully as a project-local ADR-007 would.

The `source_root` field on every Brief entry tells the agent where the rule came
from. When citing a Brief entry in a scratchpad PREFLIGHT line, include the
source root for clarity:

```
PREFLIGHT 2026-05-05T15:30:00Z edit src/auth/service.ts :: ADR-007 (org-shared), ADR-012 (project-local)
```

This is informational — the hook only checks for the existence of a PREFLIGHT line
covering the file, not the format of the governing-IDs section.
