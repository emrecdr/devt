---
name: graphify-helpers
description: Use whenever a developer skill needs to search the codebase for symbols, callers, dependents, or paths between symbols. This is the canonical implementation of the Graphify-first protocol — Graphify queries first, grep fallback when any of four trigger conditions hits (empty result, error, not setup, under min_results_threshold). All other dev skills (codebase-scan, code-review-guide, lesson-extraction, tdd-patterns, verification-patterns, complexity-assessment, strategic-analysis, semantic-search, architecture-health-scanner, council, autoskill) consume this skill rather than calling Graphify directly. Skill auto-degrades to grep-only mode when graphify.enabled=false in .devt/config.json — system stays fully functional without Graphify, just less token-efficient.
allowed-tools: Bash Read Grep Glob
---

# Graphify Helpers — Graphify-First Protocol

## Overview

devt is Node-stdlib-only. Graphify (`pip install graphifyy[mcp]`) is an OPTIONAL
project-level dependency that supercharges code search by replacing grep's text-match
results with AST-anchored symbol nodes. When enabled, Graphify reduces token cost on
typical code-search operations by ~10×; when disabled, devt falls back to grep with
identical output shape.

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
1. Read .devt/config.json -> is graphify.enabled true?
     NO   -> jump to step 5 (grep, source: "grep", reason: "disabled in config")
     YES  -> continue

2. Probe `graphify --help` -> exit 0?
     NO   -> jump to step 5 (grep, source: "grep", reason: "binary missing")
     YES  -> continue

3. Run the appropriate Graphify subcommand:
     - codebase-scan     -> `node bin/devt-tools.cjs graphify query "<text>"`
     - get-caller-set    -> `node bin/devt-tools.cjs graphify neighbors <symbol> --direction=in`
     - get-dependent-set -> `node bin/devt-tools.cjs graphify neighbors <symbol> --direction=out`
     - find-path         -> `node bin/devt-tools.cjs graphify path <from> <to>`
     - blast-radius      -> `node bin/devt-tools.cjs graphify blast-radius <sym1> [<sym2>...]`

4. Inspect Graphify result:
     ERROR or non-JSON output  -> jump to step 5 (grep, source: "grep")
     0 results                 -> jump to step 5 (grep, source: "grep")
     < min_results_threshold   -> run grep AND merge (source: "merged")
     ≥ min_results_threshold   -> return Graphify results (source: "graphify")

5. Grep fallback (always available):
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
| `semantic-search` | symbol query | 0 — pairs with FTS5 over docs |

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

## Hard Invariants

1. **`graphify.enabled: false` is fully supported.** No skill, no workflow, no agent
   should fail or return empty when Graphify is disabled. Every operation has a grep
   fallback that produces a working (less precise) result.
2. **Result tagging is mandatory.** Every output from this skill (or skills consuming
   it) MUST include `source: "graphify" | "grep" | "merged"` so the user can debug
   "why did Graphify miss this?" cases.
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
