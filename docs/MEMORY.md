# The Memory Layer

> Comprehensive guide to devt's two-layer knowledge persistence model.

devt persists structured knowledge across **two distinct layers**, each with a different lifetime and write authority. Understanding which layer to use for which fact is critical — putting an architectural decision in `.devt/state/` (ephemeral) or a transient debug note in `.devt/memory/` (permanent) is the most common authoring mistake.

## The Two Layers

```
.devt/state/                       ← LAYER 1: ephemeral (per-workflow)
├── decisions.md                       DEC-001, DEC-002 — captured during clarify/specify/research
├── lessons.yaml                       retro draft hand-off → curator promotes to LES-NNNN
├── plan.md, spec.md, etc.             workflow artifacts
├── preflight-brief.md                 Topic Pre-Flight Brief — auto-fired
├── scratchpad.md                      cross-agent handoff notes within workflow
└── ...                                wiped on /devt:workflow --cancel OR `state reset`

.devt/memory/                      ← LAYER 2: permanent (unified knowledge)
├── index.db                           gitignored FTS5 index (regenerable from markdown)
├── decisions/                         ADR-001, ADR-002 — constitutional decisions
│   └── _index.md                      auto-generated catalog
├── concepts/                          CON-001, CON-002 — durable mental models
├── flows/                             FLOW-001, FLOW-002 — named sequences
├── rejected/                          REJ-001, REJ-002 — tombstones (we said no)
├── lessons/                           LES-001, LES-002 — "when X happens, do Y"
└── _suggestions.md                    auto-generated discovery proposals (curator-gated)
```

### When to use each layer

| Question | Answer |
|---|---|
| "We decided to use Argon2 for passwords. Where does this go?" | **Layer 2** — ADR. It's a permanent architectural decision affecting multiple files. |
| "I picked option B for this specific PR." | **Layer 1** — DEC. It's per-workflow, doesn't bind future work. (If it turns out to be load-bearing across workflows, the curator can promote DEC → ADR via `/devt:memory promote`.) |
| "When the integration tests fail, check the migration first." | **Layer 2** — LES. Operational lesson, written by retro+curator pipeline to `.devt/memory/lessons/`. |
| "We tried Redis caching and rejected it for compliance." | **Layer 2** — REJ tombstone. Future agents must NOT propose Redis. |
| "AuthService talks to PaymentService via this 4-step handshake." | **Layer 2** — FLOW. Permanent named sequence. |

> **Note on FLOW.** `flows/` is a supported doc type but devt's own vault carries no FLOW docs — devt's processes live as executable plugin content in `workflows/`, not as memory records. FLOW is available for consumer projects that want to document cross-workflow runtime sequences (event chains, multi-service handshakes) the code doesn't make obvious. An empty `flows/` is expected here, not a gap.

## Layer 2: `.devt/memory/` Frontmatter Schema

Every ADR/Concept/Flow/REJ markdown file starts with strict YAML frontmatter:

```yaml
---
id: ADR-001                    # required, unique across all four folders
title: "Switch to Argon2"      # required
doc_type: decision             # required: decision | concept | flow | rejected | lesson
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
superseded_at: "2026-07-16"    # stamped by `memory supersede` on retirement
superseded_by: ADR-050         # successor id; the successor carries the matching supersedes link
---
```

Retirement is **two-sided**: the retired doc flips to `status: superseded` (+ `superseded_at`/`superseded_by`) AND the successor gains a `supersedes` link. Never hand-edit one side — `memory supersede <old> <new>` does both atomically, and `memory validate` errors on the one-sided state (`supersession-contradiction`: a supersedes link whose target is still active/candidate) and warns on the other (`orphaned-retirement`: a superseded ADR/CON/FLOW nothing links to; lessons and REJ docs are exempt — curator archival retires them without successors).

For REJ tombstones, additional fields:

```yaml
reason: user_preference        # user_preference | performance | security | maintainability | compliance | complexity
search_keywords:               # AI suppression triggers — surface these to discovery + autoskill
  - "Redis caching"
  - "in-memory KV"
```

**REJ status convention**: tombstones carry `status: active` — the *rejection* is a living rule; `status` describes the doc, not the approach. Retrieval treats REJ docs by `doc_type`, never by status: they are excluded from the Brief's governing union unconditionally (their surface is lane E, framed as "pre-rejected") and their `search_keywords` suppress re-proposals regardless of status. A tombstone that is itself retracted gets `status: superseded` like any other doc.

## The Two-Tier Pre-Flight Protocol

Before any non-trivial change, the protocol runs in two tiers:

### Tier 1 — Topic Pre-Flight (workflow start, automatic)

Auto-fired by every dev workflow's context_init step:

```bash
node bin/devt-tools.cjs preflight generate "${TASK_DESCRIPTION}"
```

Produces `.devt/state/preflight-brief.md` with `## Status: FRESH`. The Brief contains:

- **Topic Extracted** — domains, symbols, keywords parsed from the task
- **Governing Documentation** — ADRs/CONs/FLOWs from Lanes A (domain), B (FTS), C (symbol), D (link closure depth-2)
- **Memory Graph (2-hop subgraph)** — flat `source → predicate → target` triples spanning the depth-2 link closure of the governing union. Reuses `memory.cjs::getLinks` per seed; deduplicates across seeds; capped at 50 triples for scannability. Agents inspect structural relationships (`supersedes`, `depends_on`, `relates_to`, etc.) without per-doc `get_doc` round-trips. When the governing union is empty, the section renders an informational fallback so the Brief layout stays stable.
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
| `warn` | Stderr advisory; edit proceeds |
| `block` | Returns `{decision: "deny"}` with a checklist; agent must produce the line first |

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

## Pre-Flight Brief JSON Sidecar

`bin/modules/preflight.cjs::generate` writes `.devt/state/preflight-brief.json` alongside the markdown via `atomicWriteJsonSync`. This is the **deterministic machine surface** workflows consume via `jq` for scope_hint / scope_trust dispatch injection without parsing markdown.

### Sidecar shape

```jsonc
{
  "status": "FRESH",
  "topic": {
    "domains": [...],
    "symbols": [...],          // filtered via SYMBOL_DENYLIST + isAllCapsNoise
    "keywords": [...],
    "resolution_path": "none" | "plan" | "diff" | "text" | "snake_fts" | "kebab_fts" | "full_text_fts",
    "symbol_provenance": { // G4-v2: per-symbol source channel for reviewer triage
      // "Organization": "plan", "BillingService": "diff", "VAT": "text", ...
      // Values: "plan" | "diff" | "text" | "snake_fts" | "kebab_fts" | "full_text_fts"
    },
    "extraction_confidence": { // numeric trust score; consumed by state assert-preflight-semantic-quality
      "score": 0.0,            // 0.0 (none) → 0.3 (text-leg short stand-ins) → 0.6 (text-leg with long tokens) → 0.8 (FTS rescue) → 1.0 (diff or plan)
      "band": "none" | "low" | "medium" | "high",
      "reason": "..."          // human-readable; +0.2 overlap bonus when CamelCase-split symbol tokens match keywords
    }
  },
  "governing": [...],          // deduped union of lanes A-D ∪ G, lifecycle-filtered (status active|candidate only, REJ excluded); [{id, status, confidence}] — project bare ids via [.governing[].id]
  "suggested_reading": [...],  // capped at 8 — see below
  "scope_hint": {
    "confidence": {            // placeholder pending v0.69 R3 calibration
      "score": 0.0 | 1.0,
      "band": "none" | "high",
      "reason": "..."
    }
  },
  "hyperedges_matched": [     // Option A: graphify hyperedges intersecting topic.symbols
    {
      "id": "hyper_billing_country_fk_flow",
      "label": "...",
      "member_count": 5,        // total members in the hyperedge
      "members": ["route_x", "service_y", ...],
      "members_in_scope": ["service_y"],  // members in current PR scope
      "completeness": 0.2,      // ratio in_scope/total — consumed by /devt:ship gate
      "confidence_score": 0.85
    }
  ],
  "blast": {
    "effect_size": "...",
    "source": "graphify" | "grep",
    "direct_dependents_count": N
  },
  "graph_stats": {
    "state": "ready" | "missing",
    "node_count": N,
    "edge_count": N,
    "density": F,
    "trust": "empty" | "sparse" | "dense"
  },
  "staleness": {
    "state": "fresh" | "stale" | "unknown",
    "fresh": true | false,
    "built_at": "...",
    "head": "...",
    "lag_commits": N | null
  },
  "rej_keyword_matches": [...],
  "generated_at": "..."
}
```

### Plan-aware symbol extraction

`extractTopic` accepts a `planDerivedSymbols` channel populated from any `~/.claude/plans/*.md` paths referenced verbatim in the task text. `bin/modules/preflight.cjs::extractPlanReferences` regex-matches `~/`, `$HOME/`, `/Users/<u>/.claude/plans/...`, and `/home/<u>/.claude/plans/...`; `extractSymbolsFromPlan` reads each plan (200KB cap), slices `## Files to change` / `## Files affected` / `## Scope` / `## Symbols` sections, and lifts PascalCase + snake_case identifiers (denylist-filtered) plus code-extension file paths. Symbols flow through with `resolution_path: "plan"` (rank 1, equal-priority to diff-derived). Scope intentionally narrow: project-local `docs/plans/*.md` deferred to a follow-up.

### Extraction confidence (semantic-quality observability)

`topic.extraction_confidence` is computed by `preflight.cjs::computeExtractionConfidence` from `topic.symbols` + `topic.resolution_path`. Deterministic score → band → human-readable reason:

| Resolution path | Base score | Band |
|---|---|---|
| `diff` or `plan` | 1.0 | high |
| `snake_fts` / `kebab_fts` / `full_text_fts` | 0.8 | high |
| `text` with ≥1 token >6 chars | 0.6 | medium |
| `text`, all symbols ≤6 chars | 0.3 | low (likely stand-ins) |
| empty `symbols` | 0.0 | none |

Plus a +0.2 overlap bonus (capped at 1.0) when CamelCase-split symbol tokens appear in `keywords` — catches the case where short symbols are real (e.g., `VAT` alongside a `vat_rate` keyword).

Consumed by `state assert-preflight-semantic-quality`, a WARN-mode gate that returns `{ok: true, warn: bool, confidence, threshold, reason}`. Default threshold 0.4 (override via `--threshold=0.6`). The gate never blocks — semantic quality is signal, not safety — so orchestrators can surface a stderr advisory without halting the workflow. Diagnostic prose names the band, names the cause, prescribes the recovery (refine task text with the central subject, re-run /devt:preflight).

### `suggested_reading` derivation

The deduped union of:
1. Governing docs' `affects_paths` — frontmatter-declared globs, fetched via `memory.cjs::getAffectsPathsByIds(ids[])` batch helper (avoids N round-trips).
2. Blast-radius `direct_dependents` — Graphify depth-1 incoming.

Capped at 8 entries. Renders into the Brief markdown as `## Suggested Reading Set (auto-derived)` between Blast Radius and Cross-Cutting Concerns; omitted when empty.

### Consumer wiring (5 workflows)

`dev-workflow.md`, `quick-implement.md`, `code-review.md`, `debug.md`, `research-task.md` cache two derived values at context_init from the sidecar:

| Cache key | Source | Injected as |
|---|---|---|
| `scope_hint_json` | `suggested_reading` | `<scope_hint>{...}</scope_hint>` |
| `scope_trust_json` | jq projection over `graph_stats.trust` + `staleness.lag_commits` + `staleness.fresh` | `<scope_trust>{...}</scope_trust>` (immediately after scope_hint) |

Injected into 11+ dispatch sites covering programmer, tester, code-reviewer, verifier, researcher, architect, and debugger. The 7 affected agents prefer these blocks over independent discovery. See `docs/AGENT-CONTRACTS.md` for agent-side behavior.

## Tier-Aware Lane Budget

`bin/modules/preflight.cjs::detectTier(taskText)` heuristically classifies tasks before the Brief is generated:

| Tier | Signals | Memory-Graph lane cap |
|---|---|---|
| `trivial` | typo / rename | 10 triples |
| `simple` | small fix / hotfix | 25 triples |
| `standard` | (default fallback) | 50 triples |
| `complex` | refactor / architecture / migration | 75 triples |

Keyword-first detection with length-based fallback.

**Budget precedence** (`resolveTripleBudget`):

```
opts.budget → config.preflight.max_triples → config.preflight.lane_budget[tier] → 50
```

**Per-call override.** `preflight generate "<task>" --budget=N`.

**Outcome.** Trivial flows produce roughly 5× smaller Briefs; complex flows get more breadth.

## Verifier Memory Signal

Every verifier dispatch in `dev-workflow.md` and `code-review.md` includes a `<memory_signal>` block in `<context>` populated at orchestrator prep. The derivation differs by workflow family:

**Review workflows (diff-anchored).** `state review-context-init` builds the signal from the union of `memory affects` hits across the changed files (committed + working tree + untracked) — every doc in the primary lane governs at least one file in the diff. The prose-FTS aggregate merges in as a supplement only when non-empty:

```jsonc
{
  "mode": "signal",
  "primary": {
    "source": "affects-union",
    "files_checked": 42,
    "count": 2,
    "docs": [{"id": "ADR-002", "title": "...", "doc_type": "decision", "matched_files": ["tests/hurl/..."]}],
    "claim": "no affects-matched docs across 42 changed file(s)"   // present ONLY when docs is empty
  },
  "supplement": {"source": "prose-fts", "counts": {...}, "top": [...]}  // omitted when empty
}
```

Rendering rules: an empty **supplement** disappears; an empty **primary** states the checkable claim above; a literal `{}` is reserved for memory-layer-unavailable ("could not check" — consumers fall back to fresh queries). Field failure this fixes: the prose query returned `counts: {}` — reading as "no governance applies" — while per-file affects carried ADR/FLOW governance for the same diff.

**Dev/research workflows (prose-anchored).** Pre-implementation work has no diff to anchor on, so the signal stays:

```bash
node bin/devt-tools.cjs memory query "<task>" --signal=3 --json-compact
# → {"counts": {"<domain>": n, ...}, "top": [{"id", "title", "doc_type"}]}
```

…in one call — bypassing the mutually-exclusive precedence trap of the standalone `--count` / `--domain-counts` / `--top` flags. `agents/verifier.md` prefers the inline block over fresh `memory query` calls during the initial scan, saving 3–4 MCP round trips per verify iteration.

A `KEEP IN SYNC` comment in both verifier dispatches keeps the block ordering aligned.

## CLI Surface

```bash
# Memory layer
node bin/devt-tools.cjs memory init              # scaffold + first index pass
node bin/devt-tools.cjs memory index             # atomic drop+rebuild FTS5
node bin/devt-tools.cjs memory query <terms>     # full-text search
node bin/devt-tools.cjs memory query <terms> --count           # aggregate: row count only
node bin/devt-tools.cjs memory query <terms> --top=N           # aggregate: top-N compact rows
node bin/devt-tools.cjs memory query <terms> --domain-counts   # aggregate: counts grouped by domain
node bin/devt-tools.cjs memory query <terms> --signal=N        # combined: domain counts + top-N compact rows (verifier signal mode)
node bin/devt-tools.cjs memory query <terms> --json-compact    # full rows, compact JSON (no formatting)
node bin/devt-tools.cjs memory get <id>          # fetch single doc
node bin/devt-tools.cjs memory affects <path>    # path-based pre-flight
node bin/devt-tools.cjs memory list [doc_type]   # enumerate
node bin/devt-tools.cjs memory links <id>        # transitive link traversal
node bin/devt-tools.cjs memory active [domain]   # status: active filter
node bin/devt-tools.cjs memory rejected-keywords # all REJ search_keywords
node bin/devt-tools.cjs memory validate          # schema + link integrity + (Graphify-enabled) stale-symbol detection
                                                 # validate's own graphify probe is trace-aware: if 3 consecutive probe queries fail
                                                 # BUT _mcp-trace.jsonl shows ≥1 successful graphify MCP call SINCE workflow.yaml::first_created_at
                                                 # (session anchor — default), severity downgrades from `warning/graphify-unreachable` to
                                                 # `info/graphify-probe-transient` (probe path is independent from orchestrator's MCP transport).
                                                 # Override session-anchor default with a sliding window via
                                                 # `memory.graphify_probe_trace_window_minutes` config key (any positive integer).
node bin/devt-tools.cjs memory backlinks <id>    # incoming refs
node bin/devt-tools.cjs memory orphans           # no-link docs
node bin/devt-tools.cjs memory stale-links       # broken cross-refs
node bin/devt-tools.cjs memory affects-symbol <name>  # case-insensitive
node bin/devt-tools.cjs memory supersede <old-id> <new-id> [--reason=…]
                                                 # atomic two-sided retirement: old doc → status: superseded +
                                                 # superseded_at/superseded_by stamps, successor gains the supersedes
                                                 # link, both files rewritten via the frontmatter serializer, one reindex.
                                                 # Curator-invoked — the command is the mechanism, the curator stays the authority.

# Bundle export/import
node bin/devt-tools.cjs memory export --out=PATH [--include=...] [--all-roots]
node bin/devt-tools.cjs memory import <bundle.json> [--prefix=ORG-] [--overwrite]

# Multi-root operational helpers
node bin/devt-tools.cjs memory paths [--validate]      # list roots; --validate stats each
node bin/devt-tools.cjs memory diff <root-a> <root-b>  # added/removed/changed across roots

# Discovery — never writes permanent files
node bin/devt-tools.cjs memory suggest           # writes _suggestions.md
node bin/devt-tools.cjs discovery harvest        # full discovery sweep
node bin/devt-tools.cjs discovery wiki-links     # just wiki-link enrichment

# Candidate-surface helpers — read _suggestions.md + emit/gate user hints
node bin/devt-tools.cjs memory candidates-status         # JSON: {count, threshold, cooldown_passed, ready_to_surface}
node bin/devt-tools.cjs memory candidates-touch-surface  # set the cooldown timestamp (after the consumer surfaces the hint)
node bin/devt-tools.cjs memory candidates-footer         # one-shot finalize-footer: status + threshold + cooldown + emit + touch in one call. Used by code-review.md, code-review-parallel.md, quick-implement.md::finalize, dev-workflow.md::finalize (replaces a 7-line inline bash block previously duplicated across all four — round 5 cut). workflows/next.md keeps the lower-level candidates-status primitive because its variant uses ready_to_surface as a shell variable to gate a downstream AskUserQuestion

# Pre-Flight
node bin/devt-tools.cjs preflight generate <task>   # Lanes A-H + blast radius; auto-loads ~/.claude/plans/*.md referenced in <task>
node bin/devt-tools.cjs preflight topic <task>      # debug topic extraction (returns extraction_confidence)
node bin/devt-tools.cjs preflight status            # FRESH/STALE/MISSING + timestamp
node bin/devt-tools.cjs preflight mark-stale [reason]
node bin/devt-tools.cjs preflight scope-cache       # cache scope_hint + scope_trust to workflow.yaml from the current sidecar
node bin/devt-tools.cjs state refresh-scope-context # alias for `preflight scope-cache` — invoked before every dispatch site so cached scope_trust reflects current graph state
node bin/devt-tools.cjs state assert-preflight-semantic-quality [--threshold=0.4]
                                                    # WARN-mode gate over topic.extraction_confidence; ok:true always

# Telemetry
node bin/devt-tools.cjs mcp-stats [--since=DATE] [--tool=NAME] [--top=N --by=calls|duration|errors]
node bin/devt-tools.cjs mcp-stats [--workflow-id=ID] [--workflow-type=TYPE] [--phase=PHASE]
                                                          # narrow traces to a specific workflow run, type, or phase
node bin/devt-tools.cjs mcp-stats --prune-older-than=30d  # compact trace JSONL
```

## SQL Views

Four convenience views accessible via the read-only MCP `query_index` SELECT-only escape hatch — useful for triage workflows and operational dashboards.

| View | Definition | Triage use |
|------|-----------|------------|
| `pending_review` | `status: candidate` ordered by confidence (`verified` → `speculative`) then `created_at DESC` | Daily curator pass: which candidates need attention, in what order? |
| `speculative_candidates` | `confidence: speculative` regardless of status | Audit: what low-confidence claims exist anywhere in the system? |
| `constraint_chains` | Per-doc `outgoing_links` + `incoming_links` counts via LEFT JOIN | Hub detection (high incoming) and orphan detection (zero outgoing) |
| `stale_speculative` | Speculative candidates >30 days old (using `created_at` as age signal) | Cleanup: candidates that have sat untouched too long — promote, demote, or reject |

The `stale_speculative` view uses `created_at` rather than a `last_hit_at` field deliberately — tracking pre-flight hits would require writes during reads, breaking the "index regenerable from markdown" invariant.

Example MCP query (via `query_index`):
```sql
SELECT id, age_days FROM stale_speculative ORDER BY age_days DESC LIMIT 10
```

## Native MEM_* Health Checks

`bin/devt-tools.cjs health` runs six memory-adjacent checks natively (no agent in the loop, suitable for CI):

| Check | Severity | Triggered when |
|-------|----------|----------------|
| `MEM_PATH_UNREACHABLE` | error | Any `memory.paths` root doesn't exist on disk |
| `MEM_INDEX_STALE` | warning | `index.db` is older than the newest `.md` mtime across all roots |
| `MEM_VALIDATE_ERRORS` | error | Frontmatter schema violations from `memory validate` |
| `MEM_CONFLICT_HIGH` | info | High count of cross-root ID collisions (last-wins applied) |
| `DEF_TRIGGER_FIRED` | info | An open deferred item declares a corpus-size unlock ("corpus >N docs" in its context) and the indexed doc count now exceeds N — receipt triggers arrive on their own; size triggers need this watcher or they fire silently |
| `GRAPHIFY_MCP_UNREGISTERED` | info | `graphify` binary is on PATH but `.mcp.json` lacks the server entry — MCP queries silently fall back to grep |

The `MEM_PATH_UNREACHABLE` check pairs with `memory paths --validate` — both surface actionable hints ("git submodule init / NFS mount / sibling clone") rather than bare "missing directory" errors.

`GRAPHIFY_MCP_UNREGISTERED` is **warn-only by design** — `health --repair` does NOT auto-edit `.mcp.json` to avoid stomping user MCP customizations. The fix is `node bin/devt-tools.cjs setup --mode update` (regenerates the MCP server entries, preserving any unrelated customizations).

## MCP Server

Vendored at `bin/devt-memory-mcp.cjs` — read-only stdio JSON-RPC server. Registered via the plugin-root `.mcp.json` (Claude Code resolves `${CLAUDE_PLUGIN_ROOT}/bin/devt-memory-mcp.cjs` at server launch when devt is loaded as a plugin); no per-project scaffolding needed. Tools:

| Tool | Purpose |
|---|---|
| `get_context_for_path(path)` | Governing docs for a file |
| `get_context_for_symbol(symbol)` | Governing docs for a symbol |
| `query_fts(terms, limit?)` | Full-text search |
| `get_doc(id)` | Fetch by id |
| `list_active(domain?)` | Active docs filter |
| `list_rejected_keywords()` | All REJ search_keywords |
| `list_links(doc_id, depth?)` | Transitive link traversal |
| `preflight(task)` | Run lanes A-H + blast radius |
| `blast_radius(symbols)` | Graphify-derived blast radius |
| `query_index(sql)` | Raw SQL escape hatch — SELECT-only |
| `query_fts_count(terms)` | Aggregate-first FTS — returns `{count}` only |
| `query_fts_top(terms, n?)` | Aggregate-first FTS — top-N compact rows |
| `query_fts_by_domain(terms)` | Aggregate-first FTS — group counts by domain |
| `memory_upsert_doc(frontmatter, body)` | Atomic write of `.devt/memory/<subdir>/<ID>-<slug>.md` **and** FTS5 index refresh in one call. Gated by `DEVT_MCP_ALLOW_WRITES=1` (set by plugin's `.mcp.json` env block by default; remove or set `"0"` to disable writes). Validates frontmatter BEFORE touching disk; rolls back file write if index rebuild fails. Curator's preferred write path — falls back to the legacy 3-tool ritual (file Write + Bash mv + `memory index`) on `WRITES_DISABLED` error. |

**Hard guarantees:**
- SQLite opened with `readOnly: true` — even malicious helpers cannot mutate
- `query_index` SELECT-only validator strips comments, blocks multi-statement payloads, rejects 17 forbidden tokens
- Self-test: `node bin/devt-memory-mcp.cjs --self-test` validates 15 SQL fixtures

## Curator Promotion Flow

The curator agent gates ALL writes to `.devt/memory/`. Discovery engine (`bin/modules/discovery.cjs`) harvests:

- **`#KNOWLEDGE-CANDIDATE` scratchpad tags** → typed candidates per the inline tag
- **`.devt/state/decisions.md` DEC entries** → ADR candidates
- **graphify god-nodes** (when graphify is ready) → Concept candidates for the highest-fanin entities in `graphify-out/GRAPH_REPORT.md`, filtered to skip symbols already covered by an active CON/ADR
- **claude-mem observations via MCP** (when the claude-mem Claude Code plugin is installed) → ADR/Concept candidates. The dev / quick-implement / lesson-extraction workflows instruct the orchestrator to call `mcp__plugin_claude-mem_mcp-search__search` with the workflow task as query; the response is a markdown index mixing observations (`#NNNN`), sessions (`#SNNN`), and prompts. The orchestrator extracts only observation rows, maps the emoji column (⚖️ → decision, 🔵 → discovery) to `obs_type`, drops session-telemetry types (`bugfix`, `feature`, `refactor`, `change`), and persists the result to `.devt/state/claude-mem-harvest.md` in the canonical format `- [decision|discovery] <title>: <body>`. Only `decision` (⚖️ → ADR/REJ candidates) and `discovery` (🔵 → Concept/Lesson candidates) are promotion-eligible. `discovery.cjs::harvestClaudeMemFromMcp()` reads the file and folds its observations into `_suggestions.md`. The `search` tool is exposed identically by both claude-mem runtimes (worker default and server-beta); the older `observation_search` tool was server-beta-only and silently no-opped on the canonical worker install.

All candidates flow into `.devt/memory/_suggestions.md` (NEVER auto-promoted). Curator presents each via `AskUserQuestion` with the FULL original reasoning verbatim — no AI summarization. Only on user approval (Promote active | Promote candidate | Reject as REJ | Defer | Edit before promoting) does the markdown file get written.

REJ tombstones suppress future proposals matching their `search_keywords` — the "no nag" mechanism.

### Harvest is unconditional; curator review is gated

The harvest step (which writes `_suggestions.md`) and the curator review step (which dispatches `AskUserQuestion` per candidate) are wired separately:

- **`harvest_observations`** — runs in every `dev-workflow`, `lesson-extraction`, and `quick-implement` finalize phase, regardless of complexity tier or `config.workflow.retro` flags. Cost is ~50ms when claude-mem is absent. Best-effort: harvest failures NEVER fail the workflow. This guarantees that a SIMPLE-tier workflow that skips retro+curator still buffers its observations into `_suggestions.md` for the next dev-workflow's curator to review.
- **`curate`** — only runs when `complexity=COMPLEX` (or `/devt:workflow --retro` standalone). Dual-path: PLAYBOOK PATH (lessons.yaml → playbook) AND MEMORY-LAYER PATH (_suggestions.md → AskUserQuestion approval flow). Hard invariant: NEVER writes a permanent memory doc without explicit user approval.

The decoupling makes harvest categorically unskippable — the scenario where `quick-implement` drops every ⚖️/🔵 observation on the floor cannot recur.

## Memory Maintenance Discipline

After editing any `.devt/memory/**.md` file:

- **Automatic** (when `auto_index_on_change: true`, the default): the PostToolUse `memory-auto-index.sh` hook runs `memory index`. Idempotent — no-op when nothing changed.
- **Manual** (when hooks are disabled): run `node bin/devt-tools.cjs memory index && node bin/devt-tools.cjs memory validate`.

Before proposing any new candidate, the discovery engine consults `rejected/` for matching `search_keywords` — if a tombstone matches, the candidate is suppressed silently.

## Configuration

| Key | Default | Purpose |
|---|---|---|
| `memory.enabled` | `true` | Master switch |
| `memory.preflight_mode` | `block` | Hook behavior on missing PREFLIGHT scratchpad line |
| `memory.auto_index_on_change` | `true` | PostToolUse hook on `.devt/memory/**.md` edits |
| `memory.mcp_telemetry` | `true` | MCP tool-call trace JSONL log |
| `memory.paths` | `null` | List of memory roots to scan + index. `null` = single-root behavior. See "Multi-Root Memory" below. |
| `preflight.domain_hints` | `[]` | Project vocabulary APPENDED to the built-in English domain-hint list for lane A / topic extraction (never replaces the generic floor). Lowercased on load. |
| `graphify.enabled` | `false` (auto-set to `true` by `setup.cjs` when the `graphify` binary is on PATH at first setup) | Opt-in AST symbol anchoring |

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

## Multi-Root Memory

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

When `memory.paths` is `null` or absent (the default), devt uses `[<projectRoot>/.devt/memory]` as a single root. Existing projects see zero change.

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

## Related Documentation

- [`CLAUDE.md`](../CLAUDE.md) — entry point: orchestrator architecture + critical contracts
- [`docs/AGENT-CONTRACTS.md`](AGENT-CONTRACTS.md) — scope_hint / scope_trust / verifier memory_signal contracts consumed by agents
- [`docs/INTERNALS.md`](INTERNALS.md) — `memory.cjs` + `preflight.cjs` module internals
- [`docs/GRADER.md`](GRADER.md) — verifier outcome-grader (memory-aware rubric)
- [`docs/GRAPHIFY.md`](GRAPHIFY.md) — graph-impact map flow (consumes preflight sidecar fields)
- `guardrails/golden-rules.md` — Rule 14 (Pre-Flight Protocol) and Rule 15 (Memory Maintenance)
- `guardrails/engineering-principles.md` — "Sources of Truth" hierarchy
- `skills/memory-pre-flight/SKILL.md` — Two-Tier Pre-Flight protocol (preloaded onto all dev agents)
- `skills/memory-curation/SKILL.md` — curator promotion flow
- `skills/graphify-helpers/SKILL.md` — Graphify-first protocol
- `commands/memory.md`, `commands/preflight.md` — user-facing command reference
