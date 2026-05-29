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

**User opt-in flow.** `/devt:init` pitches Graphify as strongly recommended via AskUserQuestion; declining still produces a fully working install.

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

**RESET_EXEMPT.** Lock survives `/devt:cancel-workflow` deliberately — a half-broken workflow that crashes mid-rebuild leaves the lock behind, but the next `rebuild` invocation past the debounce window breaks it cleanly. Resetting on cancel would defeat the concurrency guarantee in active multi-workflow scenarios.

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

**RESET_EXEMPT.** Survives `/devt:cancel-workflow` so root-cause forensics persist across sessions.

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
       ▼  (sub-agents consume READ-ONLY)
┌──────────────────────────────────┐
│ code-reviewer, programmer, ...    │
└──────────────────────────────────┘
```

The orchestrator owns the MCP boundary; sub-agents are MCP-blind by design (see `docs/AGENT-CONTRACTS.md` — Orchestrator owns MCP).

---

## Cross-references

- `docs/AGENT-CONTRACTS.md` — Orchestrator owns MCP; scope_hint contract
- `docs/MEMORY.md` — Pre-Flight Brief JSON sidecar (`blast.direct_dependents_count`, `graph_stats.trust`, `topic.symbols`)
- `docs/HOOKS.md` — `graph_loader` deny source (graph.json size cap)
- `skills/graphify-helpers/SKILL.md` — agent-side Graphify-first protocol + 4 fallback triggers
- `skills/codebase-scan/SKILL.md` — scan skill with Graphify-first routing
