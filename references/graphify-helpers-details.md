# Graphify Helpers — Cold Detail

Reference for `skills/graphify-helpers/SKILL.md`. Read this when tuning
per-skill thresholds, explaining degraded-mode behavior, or working at the
ORCHESTRATOR level (the MCP surface below is unusable by sub-agents — they are
MCP-blind by contract and consume `.devt/state/graph-impact.md` instead).

## Architecture note (why wrappers, not the binary)

devt's CLI wrappers (`node bin/devt-tools.cjs graphify <subcmd>`) read
`graphify-out/graph.json` **directly** — they do NOT shell out to the upstream
`graphify` binary at the read path. The binary is needed only to *generate* the
graph via `graphify update .`; projects with a checked-in or CI-built
`graph.json` work without the binary on PATH. This decouples devt from upstream
CLI flag drift (upstream's `graphify query` accepts only
`--dfs`/`--budget`/`--context`/`--graph` — no `--json`, no `--neighbors`, no
`--direction`). The wrappers parse `graph.json` in-process, build an adjacency
map, and run BFS/lookup natively in Node.

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

## Without-Graphify Feature Parity

When `graphify.enabled: false`, the skill falls back to grep cleanly. Output
shape stays identical (just with `source: "grep"`). The following features
become approximations rather than precise:

| Feature | With Graphify | Without Graphify |
|---|---|---|
| Definition lookup | Exact AST node + 5-line context | grep matches the symbol name (false positives possible) |
| Caller enumeration | AST-anchored callers via `direction=in` | grep + manual filter (substring match) |
| Dependent enumeration | AST-anchored dependents via `direction=out` | grep + heuristic (imports / requires) |
| Cross-module path | `shortest_path` via graph traversal | n/a (skipped — caller treats as "no info") |
| Blast radius effect_size | LARGE/MEDIUM/SMALL from AST + god_node detection | Approximation: file count + module spread |
| AMBIGUOUS binding flagging | Surfaced from Graphify's confidence taxonomy | n/a (no binding confidence available) |

## Upstream MCP tool surface (ORCHESTRATOR-ONLY)

Sub-agents never call these — the orchestrator owns MCP and persists results to
`.devt/state/graph-impact.md` for sub-agent consumption. When the setup wizard
registers Graphify in `.mcp.json` (auto-detected at `/devt:setup --init`), the
upstream MCP server exposes 10 tools. devt's Node wrappers in
`bin/modules/graphify.cjs` cover the first 4 directly; the remaining 6 are
reachable by the ORCHESTRATOR via the Claude Code MCP system. One of them
(`get_pr_impact`) is already wired into PR-scoped code review; the other 5 are
available for ad-hoc orchestrator use.

| MCP tool | devt wrapper / wiring | When to use |
|---|---|---|
| `query_graph` | `graphify.queryGraph(text)` | Free-text symbol/concept search across the graph |
| `get_node` | `graphify.getNode(nodeId)` | Fetch a single node's definition + references |
| `get_neighbors` | `graphify.getNeighbors(sym, {direction, depth})` | Callers/dependents traversal |
| `shortest_path` | `graphify.shortestPath(from, to)` | Cross-module relationship discovery |
| `god_nodes` | (no wrapper — call MCP directly) | Top-N most-connected core abstractions. devt computes the same data locally via `graphify.godNodes()` from graph.json |
| `get_community` | Upstream-only — call `mcp__graphify__get_community` directly. Removed from devt's vendored relay (zero agent invocations field-observed); the JS function `graphify.getCommunity()` is still consumed internally by `graphify lane-suggestions`. Re-advertise on the relay if a documented use case emerges | All nodes in a community by ID — feature-cluster traversal |
| `graph_stats` | (no wrapper — call MCP directly) | Node/edge/community counts + EXTRACTED/INFERRED/AMBIGUOUS confidence breakdown — devt's `graphify.graphStats()` covers density+trust locally but not confidence percentages |
| `get_pr_impact` | **wired** in `workflows/code-review.md` — orchestrator writes the response to `.devt/state/graph-impact.md` when reviewing a PR | Blast-radius per PR: which graph communities the PR touches, files affected, node-impact list |
| `list_prs` | (not wired) | Graph-aware PR dashboard — open PRs with CI/review state and blast-radius |
| `triage_prs` | (not wired) | Actionable PRs sorted by blast-radius — useful for "which PR should I review next?" surfacing |

For tools without a devt wrapper, the orchestrator calls them via the registered
`graphify` MCP server directly. The `blast_radius` tool exposed by devt's
vendored `bin/devt-memory-mcp.cjs` aggregates `get_neighbors` calls — it is NOT
a Graphify-native tool, but a devt-specific composition.

## Credit & Lineage

Wraps [safishamsi/graphify](https://github.com/safishamsi/graphify) — a
multi-language (26 langs) tree-sitter AST extractor with built-in MCP support
and post-commit hooks. The four fallback triggers are devt-specific resilience
policy, not Graphify's design.
