# Graphify Integration

> ↑ Entry point: [`CLAUDE.md`](../CLAUDE.md) (orchestrator architecture + critical contracts).

> All graphify-specific mechanics in one place: optional-but-recommended config, the `scan_prep` orchestrator gate, cross-workflow eviction, post-implementation refresh prompts, and the graph-impact map flow.

For agent-side Graphify-first protocol details (fallback triggers, min_results_threshold), see `skills/graphify-helpers/SKILL.md`.

---

## What Graphify Is

Graphify is a multi-language tree-sitter AST extractor: `pip install graphifyy[mcp]`. It supercharges code-search ops with ~10× lower token cost than grep-based discovery.

**Independence guarantee.** devt stays fully functional without Graphify via grep fallback. Every dev skill follows the Graphify-first protocol with 4 fallback triggers (empty / error / not setup / under min_results_threshold).

---

## Config

| Key | Default | Behavior |
|---|---|---|
| `graphify.enabled` | `false` (schema default) | Master switch |
| `graphify.auto_refresh_post_impl` | `"ask"` | Post-impl prompt — see below |
| `graphify.rebuild_debounce_seconds` | `30` | Window during which concurrent `graphify rebuild` invocations skip via the atomic lock — see Debounced Rebuild below |

**Auto-enable on setup.** `setup.cjs` writes `graphify.enabled: true` when the `graphify` binary is on PATH at first setup. The schema default stays `false` for projects where the binary is absent (so the toggle is meaningful, not silently wrong).

**User opt-in flow.** `/devt:setup --init` pitches Graphify as strongly recommended via AskUserQuestion; declining still produces a fully working install.

---

## Universal Stale-Graphify Eviction

**Module.** `bin/modules/state-audit.cjs::evictGraphifyArtifacts` — single source of truth for the four graphify artifacts:

| Artifact | Source |
|---|---|
| `graphify-impact-plan.json` | Orchestrator pre-flight |
| `graph-impact.md` | Orchestrator MCP scan |
| `graphify-skip-reason.txt` | Orchestrator when skipping |

**Wiring.** All five graphify-touching workflows call eviction at the top of `context_init`:

```bash
node bin/devt-tools.cjs state evict-graphify
```

| Workflow | Calls eviction |
|---|---|
| `code-review.md` | ✓ |
| `debug.md` | ✓ |
| `research-task.md` | ✓ |
| `quick-implement.md` | ✓ |
| `dev-workflow.md` | ✓ |

**Why it's universal.** Eliminates cross-workflow contamination. Without eviction, a prior `/devt:review` session's `graph-impact.md` would persist into a sibling `/devt:workflow` session and mislead it — exactly the failure mode observed where blast radius from one task lingered into an unrelated task.

**CLI flags.**

| Flag | Purpose |
|---|---|
| `--dry-run` | Inspect what would be evicted without removing |
| `--max-age-minutes=N` | mtime-gated eviction (preserves concurrent-workflow fresh state) |

---

## Debounced Rebuild

**CLI.** `node bin/devt-tools.cjs graphify rebuild [--debounce=N] [--timeout=N]` — concurrency-safe wrapper around `maybeRefresh(force=true)`. Two workflows firing rebuild within the same second would otherwise race the subprocess against `graph.json`.

**Lock.** Atomic via `fs.openSync(path, "wx")` (O_CREAT|O_EXCL semantics) at `.devt/state/.graphify-rebuild.lock`. Lock body carries `{pid, started_at}` for forensics. Always unlinked in `finally{}` so a subprocess error doesn't deadlock the next caller.

**Contention behavior.**

| State | Action | Reason |
|---|---|---|
| Lock absent, acquired | Run `graphify update .` | (normal path) |
| Lock present, mtime within debounce window | Skip silently | `reason=debounced`, with `age_seconds` + `debounce_seconds` |
| Lock present, mtime past debounce window | Unlink + retry acquire | Assumes crashed prior holder |
| Lock present, retry also EEXIST | Skip silently | `reason=in_progress` (legitimate concurrent holder won the race) |

**Default debounce 30 s** (`graphify.rebuild_debounce_seconds`). Override per-call with `--debounce=N`.

**RESET_EXEMPT.** Lock survives `/devt:workflow --cancel` deliberately — a half-broken workflow that crashes mid-rebuild leaves the lock behind, but the next `rebuild` invocation past the debounce window breaks it cleanly. Resetting on cancel would defeat the concurrency guarantee in active multi-workflow scenarios.

---

## Probe Failure Diagnostics

**File.** `.devt/state/probe-failures.jsonl` — append-only structured log written by `graphify.probeBinary` and `setup.probePythonGraphifyMcp`.

**Why.** Both probes previously silent-caught everything (`catch { return false; }`), collapsing four distinct failure modes into a single false return. Users seeing "graphify not detected" had no way to know whether the binary was absent, broken, slow, or permission-denied.

**Record shape.** `{ ts, category, command, args, error, code?, status?, signal?, timeout_ms }`. Categories:

| Category | Meaning |
|---|---|
| `not-installed` | ENOENT — binary missing from PATH |
| `spawn-error` | Other spawn error (permission, sandbox block, etc.) |
| `timeout` | `signal === "SIGTERM"` — subprocess hit `timeoutMs` |
| `nonzero-exit` | Process ran but `status !== 0` (often "wrong subcommand" or "wrong flag") |
| `no-result` | `spawnSync` returned null/undefined |

**Surface.** `node bin/devt-tools.cjs health` raises `PROBE_FAILURES_RECENT` (info-level) when any record's `ts` is within the last 24 h. The check bucketizes by category so the user can distinguish "binary missing" from "binary broken" without reading the raw JSONL. Stale activity (>24 h old) is intentionally NOT flagged — keeps the warning meaningful after the user fixed the cause.

**RESET_EXEMPT.** Survives `/devt:workflow --cancel` so root-cause forensics persist across sessions.

---

## `graphify_scan_prep` Orchestrator Gate

**Where wired.** `dev-workflow.md` + `quick-implement.md` at context_init.

**Threshold (all three must hold).**

| Condition | Source |
|---|---|
| `blast.direct_dependents_count >= 10` | `preflight-brief.json::blast.direct_dependents_count` |
| `graph_stats.trust == "dense"` | `preflight-brief.json::graph_stats.trust` |
| `topic.symbols` non-empty | `preflight-brief.json::topic.symbols` |

**When threshold met.** The orchestrator calls (in one bash block):

```
mcp__devt-graphify__get_neighbors({symbol: <central>, direction: "in", depth: 2})
mcp__devt-graphify__blast_radius({symbols: [<central>]})
```

…and writes the concatenated output to `.devt/state/graph-impact.md`.

**When threshold not met.** Skip; agents fall back to grep + `scope_hint`.

**Central symbol selection.** `topic.symbols[0]` after the noise filter (`SYMBOL_DENYLIST` + `isAllCapsNoise`) in `preflight.cjs` strips:
- File / spec names (`CHANGELOG`, `MODULE`, `OpenAPI`)
- Project issue prefixes (`GFBUGS-NNN`, `JIRA-NNN`)

**Savings.** ~30–40% scan-phase tokens on STANDARD/COMPLEX tasks meeting the threshold. Plus catches reverse-dependencies grep misses (OpenAPI examples, hurl assertions, MODULE.md mentions, test fixtures).

---

## Post-Implementation Refresh Prompt

**Config.** `graphify.auto_refresh_post_impl` accepts:

| Value | Behavior |
|---|---|
| `"ask"` (default) | Three-option AskUserQuestion after impl |
| `true` | Silent auto-refresh (best for autonomous flows) |
| `false` | Tip-only (no prompt, no refresh) |

**The three options under `"ask"`.**

1. Refresh now (Recommended)
2. Skip — I'll refresh manually later
3. Always auto-refresh for this project — writes `true` to project config

**Why default is `"ask"`.** Tip-only was easy to miss. Interactive prompt makes freshness visible; the "Always" option lets power users opt into silent refresh after experiencing the prompt once.

**Workflows that prompt.** `dev-workflow.md` + `quick-implement.md`.

---

## Graph-Impact Map Flow

The data flow when the scan-prep gate fires:

```
preflight-brief.json
       │
       ▼  (orchestrator reads threshold conditions)
┌──────────────────────────────────┐
│ orchestrator context_init bash   │
│   mcp__devt-graphify__*          │
└──────────────────────────────────┘
       │
       ▼  (orchestrator writes concatenated output)
.devt/state/graph-impact.md
       │
       ▼  (inlined into dispatch envelope at render time)
┌──────────────────────────────────┐
│ code-reviewer, programmer, ...    │
└──────────────────────────────────┘
```

The orchestrator owns the MCP boundary; sub-agents are MCP-blind by design (see `docs/AGENT-CONTRACTS.md` — Orchestrator owns MCP).

**Envelope-inlined.** Investigative-agent envelopes (programmer, code-reviewer, debugger and their workflow variants) inline `graph-impact.md` content directly into the dispatch prompt via the `{graph_impact_content}` placeholder. The helper is `bin/modules/init.cjs::loadGraphImpact(projectRoot)` — capped at 32 KB, three states: `present` (content inlined, truncation notice when over cap), `skipped` (`graphify-skip-reason.txt` content inlined), `absent` (graceful fallback line). The inlined form removes one Read tool call per dispatch and survives sub-agent attention drift (the data is right there in the prompt, not behind a Read-instruction the agent might skip). The dispatch substitution wiring lives in `bin/modules/dispatch.cjs::buildSubstitutionTable` and `applySubstitutions`.

---

## Tier Semantics: pr_scoped, symbol_anchored, bulk_scoped

The graph-impact tier order in `workflows/code-review.md::context_init`:

1. **`pr_scoped`** — calls `mcp__graphify__get_pr_impact` with a PR number. **GitHub-only** (the upstream tool requires the GitHub PR REST API). On Bitbucket, GitLab, or any non-GitHub provider, this tier is correctly skipped with `pr_scoped_skip_reason: "provider=<x>; PR-scoped requires GitHub"` written to `graphify-impact-plan.json`. No error, no degraded output.
2. **`symbol_anchored`** — calls `mcp__plugin_devt_devt-graphify__blast_radius` with diff-derived symbols. **Universal — works on every provider.** This is the **canonical primary tier for non-GitHub repos.** It is not a fallback or degraded path; it is the documented default when `pr_scoped` is unavailable.
3. **`bulk_scoped`** — calls `query_graph` + `get_neighbors` when the diff is too large or symbols are not extractable. Triggered when symbol extraction returns empty.
4. **`skip`** — graphify-skip-reason.txt written, no MCP call. The reviewer falls back to `<scope_hint>` plus raw file list; graph-impact analysis is correctly absent.

For non-GitHub providers, **`symbol_anchored` carries the full graph-impact payload** — `direct_dependents` (label array, sorted by in-degree descending), `direct_dependents_degrees` (`{label, in_count, edge_count}` in the same order, feeding the drill-down top-3 ranking), `indirect_dependents`, `modules_touched`, `effect_size`, `god_node_match`. The orchestrator writes `graph-impact.md` from this payload identically to the pr_scoped case. Reviewers cannot tell the difference at consumption time.

The signal-quality of `symbol_anchored` depends on graph-extraction quality (label cleanliness, noise filtering). See `bin/modules/graphify.cjs::blastRadius` for the noise filter that excludes file nodes, concept nodes, JSON-key nodes, primitive type labels, docstring-shaped labels, and framework request/response/DI builtins (Request, Depends, HttpServletRequest, HttpContext, NextFunction, … — framework-general across FastAPI/Spring/Django/.NET/Express) from `direct_dependents` / `indirect_dependents` before counting toward `effect_size`. Projects can extend via `graphify.blast_radius_extra_noise: string[]` and tune the builtin set via `graphify.framework_builtin_noise: string[]` (`"!Label"` removes a default) in `.devt/config.json`.

**Blind-spot + calibration caveats on the impact plan.** The graph indexes commits, so `symbol_anchored` attaches `symbol_anchored_caveat` when working-tree code files are invisible to it (untracked, or added after the graph build via the build-SHA ancestry check) — blast_radius runs against the last-committed layout. And because `effect_size` measures symbol popularity (graph degree), not change semantics, the plan carries a `hunk_census` (`{total_hunks, cosmetic_hunks, cosmetic_ratio, high_similarity_renames}`) and attaches `severity_calibration_note` when the cosmetic ratio crosses `graphify.severity_note_threshold` (default 0.5) — the orchestrator copies it into `graph-impact.md` as a `## Severity Calibration` section so lanes weight findings by actual semantic delta while still using the caller sets to verify wiring.

---

## MCP Trace correlation_id

Each `tools/call` against `bin/devt-graphify-mcp.cjs` generates an 8-char hex correlation_id (`crypto.randomBytes(4).toString("hex")`) at entry into `callTool`. The id appears in two places:

1. **The trace record** appended to `.devt/memory/_mcp-trace.jsonl` (`correlation_id` field), enabling retrospective single-call lookup via `mcp-stats --correlation-id=<id>`.
2. **The MCP response envelope** under `_meta.correlation_id`, so orchestrators can cite the id when writing F16 drill-down headings (e.g. `## Drill-down: <dep> [call: <id>]`) — lane findings then reference a specific call rather than just "blast_radius said X".

The pattern mirrors the one in `bin/devt-memory-mcp.cjs` (which adopted it earlier). Both servers emit the id even on the `TOOL_NOT_FOUND` path so unknown-tool dispatches stay traceable.

---

## Hyperedge-aware preflight (Option A)

Graphify's hyperedges are machine-discovered semantic groupings — multi-file scopes that "should change together" (e.g., route + service + repo + readme + test for a billing flow). Each binds several nodes with `confidence_score ≥ 0.85`.

`bin/modules/graphify.cjs::getHyperedgesContaining(symbols, opts)` loads `graph.json::hyperedges[]` and returns those whose member nodes intersect any input symbol or source_file. Each result carries:

| Field | Meaning |
|---|---|
| `id` / `label` | hyperedge identity + human-readable description |
| `member_count` | total nodes in the hyperedge |
| `members[]` | full node-id list |
| `members_in_scope[]` | subset present in current input |
| `completeness` | `members_in_scope.length / member_count` (0.0–1.0) |
| `confidence`, `confidence_score`, `source_file`, `relation` | graphify metadata |

`preflight.generate` probes hyperedges with `topic.symbols` and persists matches in `preflight-brief.json::hyperedges_matched[]`. `/devt:ship::hyperedge_completeness_scan` consumes that array — when any hyperedge has `completeness < 1.0`, AskUserQuestion surfaces the partial coverage so the user can decide: expand scope, defer the missing pieces, or accept partial coverage. Capability-probe style — fails open when graphify is disabled or graph has no hyperedges.

The intent: catch the "you fixed code, forgot the readme/test/migration" failure mode automatically. Observed pattern: a typical PR matches multiple hyperedges at varying completeness; the low-completeness cases (say 20% — 1 of 5 members) would catch "you fixed the service but forgot the route + repo + event + audit mapper".

---

## Central-Symbol Picker Calibrations (M1–M3)

`bin/modules/preflight.cjs::pickCentralSymbol(symbols, taskText)` returns the highest-precision central symbol from `topic.symbols`. The picker scores candidates by token-overlap with the task description; downstream `blast_radius` uses the result as its anchor. Three calibration layers refine the score:

**M1 — Graph-existence filter.** Filter candidates by `graphify.getNode(sym).results.length > 0` BEFORE token-overlap scoring. Without it, the picker can return a task-text noise word ("Batch") that scores 1.0 on token overlap but has no graph node — `blast_radius` then runs against a fictional symbol and returns degraded results. When graphify is unavailable (not setup / disabled / graph degraded), fall through to legacy scoring on raw symbols.

**M2 — God-node de-ranking.** Read `god_nodes` from `GRAPH_REPORT.md` via `graphify.parseReportSections()` and exclude symbols whose edge_count tops the god-node threshold. Without M2, the picker promotes framework keywords like FastAPI's `Depends` (888+ edges) over task-specific function names; downstream `blast_radius` then explodes across the whole codebase.

**M3 — Diff-recency weighting.** Run `git diff HEAD --unified=0` (best-effort, 2s timeout, 256 KB cap) and count word-bounded occurrences of each candidate. The final score becomes `token_overlap_score + min(diffCount × 0.2, 2.0)` — a symbol mentioned 5+ times in the diff dominates token-overlap noise from unrelated test/util symbols. Observed: a generic service name can be picked over the task's actual subject when token overlap matches unrelated test files; M3 inverts the pick to the diff-mentioned subject. Falls through gracefully when git is unavailable or the diff is empty (no boost applied; M1 + M2 still active).

The helper `_diffSymbolCounts(candidates)` returns a `Map<symbol, count>`; callers do not need to know about git state.

## Lane-Suggestions Archetype Classifier (B1)

`bin/modules/graphify.cjs::laneSuggestions(diffFiles, options)` partitions a multi-file review into coherent lanes. Four modes:

- **`community`** — every file has a graph community label (clustering ran successfully). Files group by dominant community.
- **`partial`** — some files have community labels, some don't (no graph node OR cluster-id missing). Covered files group by community; uncovered files used to collapse into a single `community: null` mega-bucket.
- **`service_boundary`** — graph has no Leiden community attributes (or graph not loaded at all), but ≥80% of diff files match a common service-prefix pattern (`app/services/X/`, `services/X/`, `internal/X/`, `packages/X/`, `apps/X/`, `pkg/X/`, `cmd/X/` — first-wins anchoring, column-0 or `/`-preceded to prevent `vendor/app/services/X/` false matches). Each lane's `community` field carries the service path (e.g. `app/services/identity`); reason field reports which prefix matched + coverage %. Some real-world graphs carry zero `community` attrs on every probed node — without service-boundary mode every parallel review reverts to legacy path-based partition that semantically breaks service boundaries. Service-boundary mode is shape-compatible with community mode so the consumer at `code-review-parallel.md::partition_lanes` is one bash condition.
- **`fallback`** — neither path matches (no graph, no service prefix at threshold). Caller bash falls through to the legacy top-2-level path partition.

**Archetype sub-classifier.** In real-world PRs more than half the files often land in the mega-bucket — mostly hurl/docs/config files with no graph nodes. Without the sub-classifier the orchestrator manually reshaped to coherent lanes every review.

The new `_archetype(f)` helper sub-classifies uncovered files by extension + path:

| Archetype | Matches |
|---|---|
| `docs` | `.md`, `.rst`, `.txt`, `.adoc`, `.mdx` |
| `tests` | `.hurl`; paths containing `/tests/` or `/__tests__/`; basenames matching `(^|[._-])(test|spec)([._-]|$)` |
| `config` | `.toml`, `.lock`, `.yaml`, `.yml`, `.ini`, `.env`, `.cfg`, `.conf`; specific basenames `VERSION`, `Makefile`, `Dockerfile`, `.gitignore`, `requirements.txt`, `go.mod`, `Cargo.toml`, `package-lock.json`, `pnpm-lock.yaml` |
| `other` | residual ungrouped bucket (preserves the legacy fallback) |

Groups expose an `archetype` field when the bucket comes from the classifier (community-labeled groups don't). Downstream consolidation to `target_lanes` super-groups operates on the archetype-split result, so prose-only lanes consolidate together rather than getting force-merged with code lanes.

---

## Leiden-Absent Surfacing in Preflight (W6b)

`graphStats()` (graphify.cjs) probes the first 100 nodes for any non-null `community` attribute and surfaces the result as a boolean `has_communities` field on its response. `bin/modules/preflight.cjs::renderBrief` consumes that field — when `state==="ready" && has_communities===false`, the preflight brief emits an `ℹ️` advisory: *"Graphify has no Leiden community labels — parallel review (`/devt:review` >10-file scope) will auto-detect service-boundary groups (`app/services/X/`, `packages/X/`, etc.) when ≥80% of files match, otherwise fall back to path-based partition. To enable community-driven lanes, re-graphify with Leiden clustering enabled."*

Operators learn at preflight time that parallel review will route via service-boundary or path-based fallback rather than Leiden communities. Cheap — graphStats reuses the loader cache. Sibling to the existing "Memory index not built" preflight warning. Test coverage: `scripts/test-graphify.cjs` (W6b graphStats has_communities=false on fixture).

---

## Sensitive-Path Denylist (CLI inputs)

Four file-accepting graphify subcommands — `lane-suggestions`, `check-large-files`, `check-symbol-godnodes`, `symbols-in-files` — filter their CLI args through `bin/modules/sensitive-path.cjs::isSensitivePath` before any graph query runs. Credential / key / secret-shaped paths refuse with exit 2 + a stderr message naming the blocked path; clean paths flow through unchanged.

Three checks (any match → sensitive): basename regex (`.env*`, `.netrc`, `credentials*`, `secrets?*`, `passwords?*`, `id_rsa/dsa/ecdsa/ed25519*`, `authorized_keys`, `known_hosts`, `*.pem/key/p12/pfx/crt/cer/jks/keystore/asc/gpg`), sensitive path component (`.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`), token-normalized basename containing `{secret, credential, password, apikey, accesskey, token, privatekey}`. The token check is suppressed when the file extension is a known programming-language source (`.py/.js/.ts/.go/.rs/...`) to avoid false-positives on legitimate code modules like `auth/token.py` or `secrets/loader.go`.

Closes the disclosure path where an accidentally-passed `.env` or `~/.ssh/id_rsa` would flow into graphify MCP queries. Smoke gate K76 enforces the round-trip. Source pattern ported from caveman (MIT, `compress.py::is_sensitive_path`).

---

## Cross-references

- `docs/AGENT-CONTRACTS.md` — Orchestrator owns MCP; scope_hint contract; sensitive-path denylist (full pattern reference)
- `docs/MEMORY.md` — Pre-Flight Brief JSON sidecar (`blast.direct_dependents_count`, `graph_stats.trust`, `topic.symbols`)
- `docs/HOOKS.md` — `graph_loader` deny source (graph.json size cap); `task_truncation_log_all` opt-in
- `docs/INTERNALS.md` — `sensitive-path.cjs` module surface
- `skills/graphify-helpers/SKILL.md` — agent-side Graphify-first protocol + 4 fallback triggers
- `skills/codebase-scan/SKILL.md` — scan skill with Graphify-first routing
