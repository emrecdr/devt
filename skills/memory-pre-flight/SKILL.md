---
name: memory-pre-flight
description: Use BEFORE any code edit, plan, or architectural decision. Defines the Two-Tier Pre-Flight Protocol (Topic Pre-Flight at workflow start; File Pre-Flight at each Edit). Agents preload this skill when they may modify code or propose changes — it tells them how to read the .devt/state/preflight-brief.md, when to escalate to a 5-lane File Pre-Flight, and how to scratchpad-summarize their findings before touching files. The PreToolUse pre-flight-guard hook checks the scratchpad — missing summaries warn or block the edit.
allowed-tools: Bash Read Grep Glob
---

# Memory Pre-Flight Protocol

## Why this exists

Without a structured pre-flight step, agents either:
- Miss prior architectural decisions (causing silent ADR violations)
- Propose approaches that the team has explicitly rejected (REJ tombstone hits)
- Burn tokens re-discovering the same context per agent
- Edit files outside their initial scope without re-checking governance

The Two-Tier Pre-Flight Protocol fixes all four. **Tier 1** (Topic Pre-Flight)
generates a comprehensive Brief at workflow start. **Tier 2** (File Pre-Flight)
verifies coverage at each Edit and escalates when scope expands.

## When to invoke

This skill is **mandatory** for the following agent types:

- programmer, architect, code-reviewer, debugger, researcher, tester, verifier, docs-writer

Agents preload it via `skills:` frontmatter; the skill body is part of their
system prompt at boot.

It applies whenever the agent is about to:
- Edit, Write, or NotebookEdit any file in src/, lib/, tests/, .devt/memory/, or guardrails/
- Propose an architectural change in plan.md, arch-review.md, or decisions.md
- Implement a feature, fix a bug, or refactor existing code
- Recommend an approach in research.md or spec.md

It does NOT apply when:
- Reading or grepping files for understanding
- Editing only ephemeral state in `.devt/state/` (scratchpad.md, debug-investigation.md)
- Working on prose-only changes (CHANGELOG, docs/, top-level README)

## Tier 1 — Topic Pre-Flight (workflow start)

**Performed by**: the workflow itself (auto-fired) OR `/devt:preflight "<task>"` standalone.

**Output**: `.devt/state/preflight-brief.md` with `## Status: FRESH`.

The Brief contains:
- **Topic Extracted** — domains, symbols, keywords parsed from the task
- **Governing Documentation** — ADRs/CONs/FLOWs from Lanes A (domain), B (FTS), C (symbol), D (link closure)
- **Memory Graph (2-hop subgraph)** — flat `source → predicate → target` triples spanning the depth-2 link closure of the governing union. Scan this section to understand structural relationships (`supersedes`, `depends_on`, `relates_to`, etc.) without firing per-doc `get_doc` calls.
- **Rejected Approaches** — REJ tombstones whose `search_keywords` overlap the topic (Lane E)
- **Related Operational Lessons** — playbook entries matching the topic (Lane F)
- **Blast Radius** — Graphify-derived dependents/effect-size (or grep heuristic if disabled)
- **Pre-Flight Recommendations** — synthesized guardrails for the agent

### Reading the Brief

At agent startup (after context_loading), check for the Brief:

```bash
cat .devt/state/preflight-brief.md 2>/dev/null
```

If the Brief is `## Status: FRESH`, treat it as **the source of truth** for what
governance applies to this task. Re-read it any time you change direction.

If the Brief is `## Status: STALE`, it means a prior File Pre-Flight detected
scope expansion. Re-run `/devt:preflight "<refined task>"` before continuing
substantial work. Stale Briefs are not invalid — they are warnings that the
governance set may be incomplete.

If the Brief is **missing**, the workflow either skipped pre-flight (rare —
non-development workflow) or the user is in `preflight_mode: off`. In that case,
fall back to the legacy `codebase-scan` skill behavior: read CLAUDE.md, scan
`.devt/rules/`, and search `.devt/memory/` manually if it exists.

## Tier 2 — File Pre-Flight (at each Edit)

**Performed by**: the agent itself, BEFORE calling Edit/Write/NotebookEdit.

**Output**: a 1-line summary appended to `.devt/state/scratchpad.md`. Format:

```
PREFLIGHT <ISO-timestamp> <action> <file_path> :: <comma-separated governing IDs>
```

Examples:

```
PREFLIGHT 2026-05-05T15:30:00Z edit src/auth/service.ts :: ADR-007, ADR-012, CON-003
PREFLIGHT 2026-05-05T15:31:00Z edit src/billing/invoice.ts :: brief-coverage-extended; ran 5-lane lookup
PREFLIGHT 2026-05-05T15:32:00Z write tests/auth/mfa.test.ts :: ADR-007, FLOW-002
```

### Decision tree per edit

```
1. Is the file path covered by the Brief's affects_paths or the agent's working scope?
   YES → summarize the relevant subset to scratchpad. Cheap. Proceed.
   NO  → File expanded scope; run the 5-Lane File Pre-Flight (below). Then mark Brief STALE.

2. Append PREFLIGHT line to .devt/state/scratchpad.md.

3. Proceed with Edit/Write.
```

### 5-Lane File Pre-Flight (only when scope expands)

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

## PreToolUse hook integration

`hooks/pre-flight-guard.sh` runs on PreToolUse(Edit | Write | NotebookEdit).
It checks `.devt/state/scratchpad.md` for a recent `PREFLIGHT` line covering
the target file path.

- **`memory.preflight_mode: off`** — hook is a no-op
- **`memory.preflight_mode: warn`** (Phase 3 default) — hook emits a stderr advisory but does NOT block
- **`memory.preflight_mode: block`** (Phase 4 default) — hook denies the tool call when no PREFLIGHT line is found, with a checklist for the agent

To pass the hook, just write the PREFLIGHT scratchpad line BEFORE calling the
edit tool. This is the entire ceremony — five seconds of discipline per edit
catches the kinds of governance drift that compound into incidents over months.

### Recovering from a deny

Every hook deny (or warn) is appended to `.devt/state/preflight-denies.jsonl` —
single-writer, append-only, gitignored, one JSON record per line. **If you
receive a `decision: "deny"` in a tool result, your first action should be to
read this log** — it shows your prior denied attempts in this session so you
can satisfy the hook in order. Each record:

```jsonl
{"mode":"block","ts":"2026-05-08T18:56:20.800Z","action":"edit","file_path":"/path/to/foo.py","reason":"missing PREFLIGHT line"}
```

Fields: `mode` (`block` | `warn`), `ts` (ISO-8601 UTC), `action` (`edit` |
`write` | `notebookedit`), `file_path` (absolute path), `reason` (always
`"missing PREFLIGHT line"` today; reserved for future deny reasons).

Recovery sequence on deny:
1. **Read** `.devt/state/preflight-denies.jsonl` — parse each line, filter by
   `mode=="block"` and your current workflow's recent timestamps
2. **Append** a `PREFLIGHT <ts> edit <path> :: <governing IDs>` line to
   `.devt/state/scratchpad.md` for each blocked path (one PREFLIGHT line per
   target — no batching)
3. **Retry** the original Edit/Write call

The log survives `state reset` via the archive ring buffer
(`.devt/state/.archive/<ts>/preflight-denies.jsonl`), so post-mortem inspection
of stalled workflows is possible after the workflow finishes. JSONL parsing
makes the log readable by `jq`, `node -e 'data.split("\n").map(JSON.parse)'`,
or any structured log tool — same as `_mcp-trace.jsonl`.

## Common pitfalls

1. **Skipping the scratchpad line "because the Brief covers this file"** — the
   hook can't read your mind; it scans for the literal `PREFLIGHT` token. Always
   write the line, even if the summary is one ADR id.

2. **Treating REJ tombstones as advisory** — they are NOT. A matching REJ in the
   Brief means the team explicitly said no to that approach. If you must propose
   it anyway, capture the new motivation as a DEC and ask the user to override
   the tombstone via `/devt:memory promote` (which can supersede the REJ).

3. **Stale Brief → blind plowing ahead** — STALE means coverage is incomplete,
   not that the Brief is wrong. Re-running `/devt:preflight` is cheap; assuming
   you know the governance is expensive when it bites at code-review time.

4. **Forgetting to mark stale on scope expansion** — without the mark, the next
   agent thinks the Brief is still authoritative. The five-lane lookup is wasted
   if the next agent doesn't know it happened.

## When this skill DOES NOT apply

- During autoskill / weekly-report / session-report / status / help — these are
  meta workflows, not development workflows.
- During retro / lesson-extraction — those READ memory but don't mutate code.
- For trivial fast-tier work (`/devt:fast`) — the pre-flight overhead is larger
  than the change itself; fast tier ships explicit "no Brief expected" semantics.

## Configuration

| Config key | Default | Purpose |
|---|---|---|
| `memory.preflight_mode` | `block` | Hook behavior on missing PREFLIGHT line — `off` no-op, `warn` advisory, `block` denies the edit |
| `memory.enabled` | `true` | Master switch — false disables Brief generation entirely |
| `memory.paths` | `null` | List of memory roots to scan. `null` = single-root (`.devt/memory`). When set, lanes A-F return docs from EVERY configured root with last-wins precedence on ID collisions. The Brief surfaces the union — a shared org-wide REJ tombstone shadows the same approach in your project just as effectively as a local one. |
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
from. When you cite a Brief entry in your scratchpad PREFLIGHT line, you can include
the source root for clarity:

```
PREFLIGHT 2026-05-05T15:30:00Z edit src/auth/service.ts :: ADR-007 (org-shared), ADR-012 (project-local)
```

This is informational — the hook only checks for the existence of a PREFLIGHT line
covering the file, not the format of the governing-IDs section.
