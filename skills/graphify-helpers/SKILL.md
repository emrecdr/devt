---
name: graphify-helpers
description: Use whenever a developer skill needs to search the codebase for symbols, callers, dependents, or paths between symbols. This is the canonical implementation of the Graphify-first protocol — Graphify queries first, grep fallback when any of four trigger conditions hits (empty result, error, not setup, under min_results_threshold). All other dev skills (codebase-scan, code-review-guide, lesson-extraction, tdd-patterns, verification-patterns, complexity-assessment, strategic-analysis, architecture-health-scanner, council, autoskill) consume this skill rather than calling Graphify directly. Skill auto-degrades to grep-only mode when graphify.enabled=false in .devt/config.json — system stays fully functional without Graphify, just less token-efficient.
allowed-tools: Bash Read Grep Glob
---

# Graphify Helpers — Graphify-First Protocol

## Overview

devt is Node-stdlib-only. Graphify (`uv tool install graphifyy[mcp]` or equivalent)
is an OPTIONAL project-level dependency that supercharges code search by replacing
grep's text-match results with AST-anchored symbol nodes from `graphify-out/graph.json`.
When enabled, Graphify reduces token cost on typical code-search operations by ~10×;
when disabled, devt falls back to grep with identical output shape.

**Architecture note**: devt's CLI wrappers (`node bin/devt-tools.cjs graphify <subcmd>`)
read `graphify-out/graph.json` **directly** — they do NOT shell out to the upstream
`graphify` binary at the read path. The binary is needed only to *generate* the graph
via `graphify update .`; projects with a checked-in or CI-built `graph.json` work
without the binary on PATH. This decouples devt from upstream CLI flag drift (upstream's
`graphify query` accepts only `--dfs`/`--budget`/`--context`/`--graph` — no `--json`,
no `--neighbors`, no `--direction`). The wrappers parse `graph.json` in-process,
build an adjacency map, and run BFS/lookup natively in Node.

This skill is the canonical wrapper. Other developer skills (codebase-scan,
code-review-guide, etc.) MUST route through this skill rather than calling Graphify
or grep directly. The skill auto-handles the four fallback triggers and tags every
result with its provenance.

## When To Use

Trigger on:

- Any skill needing to find symbol definitions, callers, dependents, or paths
- Code-review tasks that need to enumerate affected callers
- Refactor scoping ("how big is the blast radius if I change AuthService?")
- TDD pattern lookup ("show me existing tests near this subject")
- Architecture health checks needing symbol-anchored boundary verification

Skip for:

- Pure prose search (config keys in YAML, log message strings, doc text) —
  use grep directly with `--text-mode`. Graphify-first does not help.
- Single-file exact lookups when the agent already knows the path —
  use Read directly.

## The Four Fallback Triggers

When `graphify.enabled: true` AND `graphify` binary is on PATH, attempt Graphify
first. Fall back to grep when ANY of:

| # | Trigger | Detection |
|---|---|---|
| 1 | **Empty result** | Graphify returned 0 results (e.g. brand-new uncommitted symbol, query mismatch) |
| 2 | **Error** | Subprocess failure, malformed graph.json, MCP transport error, timeout |
| 3 | **Not setup** | `graphify.enabled: false` OR binary not on PATH OR `graphify-out/graph.json` missing |
| 4 | **Under threshold** | `results.length < caller's min_results_threshold` (default ≥2 for caller/dependent queries; ≥1 for definition queries) |

Each fallback path tags results with `source: "grep"` (when only grep ran),
`"graphify"` (when only Graphify ran), or `"merged"` (when partial Graphify results
were supplemented with grep). Callers MUST surface this tag in their output so
downstream agents and the user know how the result was obtained.

## Decision Tree

```
1. Check graphify status -> `node bin/devt-tools.cjs graphify status`
     state != "ready" -> jump to step 4 (grep, source: "grep", reason from state)
     state == "ready" -> continue
   The status state combines `graphify.enabled` in config AND `graph.json` existence.
   No separate binary probe — devt's wrappers read graph.json in-process, the
   `graphify` binary is needed only to regenerate the graph offline.

2. Run the appropriate Graphify subcommand:
     - codebase-scan     -> `node bin/devt-tools.cjs graphify query "<text>"`
     - get-caller-set    -> `node bin/devt-tools.cjs graphify neighbors <symbol> --direction=in`
     - get-dependent-set -> `node bin/devt-tools.cjs graphify neighbors <symbol> --direction=out`
     - find-path         -> `node bin/devt-tools.cjs graphify path <from> <to>`
     - blast-radius      -> `node bin/devt-tools.cjs graphify blast-radius <sym1> [<sym2>...]`

3. Inspect Graphify result:
     ERROR or non-JSON output  -> jump to step 4 (grep, source: "grep")
     0 results                 -> jump to step 4 (grep, source: "grep")
     < min_results_threshold   -> run grep AND merge (source: "merged")
     ≥ min_results_threshold   -> return Graphify results (source: "graphify")

4. Grep fallback (always available):
     - For symbol queries: `grep -rn --include="*.{ts,tsx,js,jsx,py,go,rs,java}" "<symbol>" .`
     - For text queries:   `grep -rn "<text>" <relevant-paths>`
     - Cap result size at 200 hits to bound token cost
     - Tag results with `source: "grep"`
```

## Per-Skill Threshold Defaults

When skills consume graphify-helpers, they should pass an appropriate
`min_results_threshold` based on what answer is expected:

| Skill | Operation | Default threshold |
|---|---|---|
| `codebase-scan` | symbol search | 2 — we expect at least the definition + 1 reference |
| `code-review-guide` | get-caller-set | 1 — even one caller is informative |
| `verification-patterns` | get-dependent-set | 1 — same |
| `complexity-assessment` | blast-radius | (uses `effect_size` heuristic, no threshold) |
| `tdd-patterns` | find-tests-near-symbol | 1 — even one similar test is enough scaffolding |
| `strategic-analysis` | get-dependent-set per option | 0 — empty is informative ("Option A touches 0 callers") |

Callers SHOULD override the default when their use case demands richer evidence.

## Result Shape (canonical)

Every helper returns:

```json
{
  "source": "graphify" | "grep" | "merged",
  "results": [ /* array shape depends on operation */ ],
  "degraded": false | true,
  "fallback_trigger": "empty" | "error" | "not_setup" | "below_threshold" | null,
  "reason": "human-readable note on why grep was used (when source != graphify)"
}
```

Fields:
- `source`: provenance — REQUIRED in the output of any consuming skill
- `results`: the actual data; shape depends on the operation
- `degraded`: true when Graphify wasn't fully used (informational, not error)
- `fallback_trigger`: which of the four conditions fired (null when source == "graphify")
- `reason`: human-readable; surface in stderr or skill output

## Reusable Bash Snippets

For consuming skills, here are the canonical invocations:

### Find symbol definitions (codebase-scan replacement)

```bash
# Graphify-first
result=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify query "AuthService")
src=$(echo "$result" | python3 -c "import json,sys;print(json.load(sys.stdin)['source'])")
if [ "$src" = "grep" ] || [ "$src" = "merged" ]; then
  # Supplement with grep
  grep -rn --include="*.ts" --include="*.tsx" --include="*.py" --include="*.go" "AuthService" . | head -200
fi
```

### Find callers of a symbol (code-review-guide use case)

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify neighbors "AuthService.login" --direction=in
```

### Find blast radius for a refactor

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify blast-radius "AuthService" "SessionManager"
# Returns effect_size: small | medium | large + dependents + ambiguous_bindings count
```

### Lane 0 warm cache (for Pre-Flight Brief — Phase 3)

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" graphify warm-cache
# Returns { path: "graphify-out/wiki/index.md" } or { path: "GRAPH_REPORT.md" } or { path: null }
```

## Without-Graphify Feature Parity

When `graphify.enabled: false` (the default — Phase 1 ships with this), the skill falls
back to grep cleanly. Output shape stays identical (just with `source: "grep"`). The
following features become approximations rather than precise:

| Feature | With Graphify | Without Graphify |
|---|---|---|
| Definition lookup | Exact AST node + 5-line context | grep matches the symbol name (false positives possible) |
| Caller enumeration | AST-anchored callers via `direction=in` | grep + manual filter (substring match) |
| Dependent enumeration | AST-anchored dependents via `direction=out` | grep + heuristic (imports / requires) |
| Cross-module path | `shortest_path` via graph traversal | n/a (skipped — caller treats as "no info") |
| Blast radius effect_size | LARGE/MEDIUM/SMALL from AST + god_node detection | Approximation: file count + module spread |
| AMBIGUOUS binding flagging | Surfaced from Graphify's confidence taxonomy | n/a (no binding confidence available) |

## Upstream MCP tool surface

When the setup wizard registers Graphify in `.mcp.json` (auto-detected at `/devt:init`), the upstream MCP server exposes 10 tools. devt's Node wrappers in `bin/modules/graphify.cjs` cover the first 4 directly; the remaining 6 are reachable by the AI agent via the Claude Code MCP system. One of them (`get_pr_impact`) is already wired into PR-scoped code review; the other 5 are available for ad-hoc agent use.

| MCP tool | devt wrapper / wiring | When to use |
|---|---|---|
| `query_graph` | `graphify.queryGraph(text)` | Free-text symbol/concept search across the graph |
| `get_node` | `graphify.getNode(nodeId)` | Fetch a single node's definition + references |
| `get_neighbors` | `graphify.getNeighbors(sym, {direction, depth})` | Callers/dependents traversal |
| `shortest_path` | `graphify.shortestPath(from, to)` | Cross-module relationship discovery |
| `god_nodes` | (no wrapper — call MCP directly) | Top-N most-connected core abstractions. devt computes the same data locally via `graphify.godNodes()` from graph.json |
| `get_community` | (no wrapper — call MCP directly) | All nodes in a community by ID — feature-cluster traversal |
| `graph_stats` | (no wrapper — call MCP directly) | Node/edge/community counts + EXTRACTED/INFERRED/AMBIGUOUS confidence breakdown — devt's `graphify.graphStats()` covers density+trust locally but not confidence percentages |
| `get_pr_impact` | **wired** in `workflows/code-review.md` — orchestrator writes the response to `.devt/state/graph-impact.md` when reviewing a PR | Blast-radius per PR: which graph communities the PR touches, files affected, node-impact list |
| `list_prs` | (not wired) | Graph-aware PR dashboard — open PRs with CI/review state and blast-radius |
| `triage_prs` | (not wired) | Actionable PRs sorted by blast-radius — useful for "which PR should I review next?" surfacing |

For tools without a devt wrapper, call them via the registered `graphify` MCP server directly. The `blast_radius` tool exposed by devt's vendored `bin/devt-memory-mcp.cjs` aggregates `get_neighbors` calls — it is NOT a Graphify-native tool, but a devt-specific composition.

## Hard Invariants

1. **`graphify.enabled: false` is fully supported.** No skill, no workflow, no agent
   should fail or return empty when Graphify is disabled. Every operation has a grep
   fallback that produces a working (less precise) result.
2. **Result tagging is mandatory.** Every output from this skill (or skills consuming
   it) MUST include `source: "graphify" | "grep" | "merged"` so the user can debug
   "why did Graphify miss this?" cases.

   **Mechanical enforcement (`state assert-graphify-source-tagged`)** — verifies the
   output file carries the source tag. Closes the prose-only HARD INVARIANT:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-graphify-source-tagged .devt/state/graph-impact.md
   # {ok:false, ...} → missing source tag; reject the output
   # {ok:true, source:"graphify"} → tag present, output is consumable
   ```

   Accepts both JSON form (`"source":"graphify"`) and markdown prose form (`source: grep`).

3. **Fallback observability (`state graphify-fallback-trace`)** — when a fallback fires,
   emit a trace record to gate-trace.jsonl so cal cycles can measure trigger rates:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state graphify-fallback-trace empty --skill=codebase-scan --operation=symbol-lookup
   ```

   Trigger values: `empty | error | not_setup | below_threshold | none`. The trace records workflow_id/workflow_type/phase automatically. Cal #21+ analytics: high empty-result rate signals under-resolved queries; high not_setup rate signals graphify install adoption is low.
3. **Setup wizard pitch is "strongly recommended", not required.** `/devt:init` offers
   Graphify install with a clear value prop, but a "no thanks" answer produces a fully
   working install. No feature is locked behind Graphify.
4. **Respect Graphify's own config surface.** Honor `GRAPHIFY_OUT` env var,
   `.graphifyignore`, `.graphifyinclude`. Do not override these. Do not duplicate the
   graphify-out/ contents elsewhere — devt reads what Graphify produces.

## Output Contract

Per call:

- stdout: JSON payload with `source`, `results`, `degraded`, `fallback_trigger`, `reason`
- stderr: human-readable note when degraded (e.g. "graphify binary not found on PATH; using grep fallback")
- exit code: 0 always (the skill never errors out — empty results are not errors)

## Credit & Lineage

Wraps [safishamsi/graphify](https://github.com/safishamsi/graphify) — a multi-language
(26 langs) tree-sitter AST extractor with built-in MCP support and post-commit hooks.
The four fallback triggers are devt-specific resilience policy, not Graphify's design.
