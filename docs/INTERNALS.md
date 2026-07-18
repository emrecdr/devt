# Internals

> ↑ Entry point: [`CLAUDE.md`](../CLAUDE.md) (orchestrator architecture + critical contracts).

> Deep-dive reference for anyone modifying devt itself: CLI modules, workflow mechanics, state validation, the governing-rules + inline-guardrails injection pipeline, deferred queue, plugin internals. For agent-facing rules see `docs/AGENT-CONTRACTS.md`.

---

## CLI Modules (`bin/modules/`)

Zero-dependency Node.js. All `.cjs` for sync require semantics. Atomic file writes throughout.

### `init.cjs`

Compound init: one CLI call returns all context (config, models, state, rules status, inline guardrails, governing rules) as JSON. **The primary token-saver pattern** — one orchestrator init call replaces 5–10 individual reads.

Key exports:
- `initWorkflow(...)` — returns the workflow init payload, including `inline_guardrails`, `governing_rules`, `rubrics`, and state context.
- `loadInlineGuardrails()` — see Inline Guardrails Wiring below.
- `loadGoverningRules()` — see Governing Rules Wiring below.

### `config.cjs`

3-level config merge: hardcoded defaults ← `~/.devt/defaults.json` (global) ← `.devt/config.json` (project). Uses `findProjectRoot()` to locate project root.

**Safety.** Prototype-pollution-safe deep merge with a `FORBIDDEN_KEYS` set guarding against `__proto__` / `constructor` / `prototype` injection.

**Exports of note.**
- `DEFAULTS` — single source for shipped defaults (including `DEFAULTS.rubrics`).

### `state.cjs`

Manages `.devt/state/` directory. Simple YAML parser/serializer. File-level locking with PID-based stale lock detection.

**Schemas.**
- `ARTIFACT_SCHEMA` + `extractStatus()` for per-artifact `## Status:` line validation (still used for the 6 non-sidecar artifacts).
- `JSON_SIDECAR_SCHEMAS` — schema registry for sidecar `.json` files, with per-sidecar enums for `status` + `verdict` + `agent`.
- `JSON_INPUT_SCHEMAS` — schemas for input-only JSON (e.g. `handoff.json`).
- `SIDECAR_FOR_MARKDOWN` — maps markdown → sidecar so `validateConsistency()` reads from the right place.
- `RESET_EXEMPT` — set of filenames preserved across `state reset`. Diagnostic side-channels live here so root-cause forensics survive `/devt:workflow --cancel`: `preflight-denies.jsonl`, `dispatch-warnings.jsonl`, `probe-failures.jsonl` (graphify+python probe failure categories — see `docs/GRAPHIFY.md::Probe Failure Diagnostics`), `.graphify-rebuild.lock` (DEF-038 atomic O_CREAT|O_EXCL — see `docs/GRAPHIFY.md::Debounced Rebuild`), `last-curator-run.txt`, `deferred.md`.
- `STATE_FILE_CONTRACT` — canonical filename inventory (referenced by `docs/STATE-RULES.md`).

**Validation.** `updateState()` auto-runs `validateConsistency()` (shadow mode), emits stderr warnings, and persists `validation_status` / `validation_warnings` to `workflow.yaml` on mismatch.

**Disable.** `DEVT_VALIDATE_SHADOW=0` turns off the shadow check.

**Workflow session metadata.** `updateState()` auto-stamps `created_at` (ISO-8601) and `workflow_id` (UUID via `crypto.randomUUID`) on the `active=true` transition. Idempotent — subsequent updates preserve the stamps; `resetState()` clears them so the next activation re-stamps. The stuck-detector uses `created_at` as its session boundary anchor.

**Immutable session anchors.** First activation also freezes `first_created_at` and `original_workflow_id` — these never rotate, even when `workflow_type` transitions cause `created_at` / `workflow_id` to refresh. Freshness gates (`assert-preflight-fresh`, `assert-claude-mem-harvest`, `assert-graphify-decision`) and `mcp-stats --since-workflow-created` read the immutable anchors so artifacts written before a transition stay attributable to the current session.

**Workflow_id chain.** Each `workflow_type` transition appends the outgoing `workflow_id` to `workflow_id_history[]` before overwriting (serialized via the JSON-stringify path in `serializeSimpleYaml`; round-tripped via `parseSimpleYaml`). `mcp-stats --workflow-id` is **strict by default** (records stamped with the exact supplied id); pass `--include-chain` to union the whole history chain when the supplied id matches the current `workflow_id` — sessions chaining through three or more `workflow_type` rotations (e.g. dev → code_review → debug → quick_implement) stay attributable across every intermediate id. The reduction is never silent: a strict query that returns 0 entries while the chain union has matches emits a `hint` field naming `--include-chain`. Historical-id queries (a user citing a specific past id) stay strict against that id alone.

**Idempotent self-healing.** Every `updateState` call runs a post-step that ensures `{original_workflow_id, workflow_id} ⊆ workflow_id_history`. The original id is prepended if missing (preserving chronological order — original is the first id the session ever held); the current id is appended if missing. Three failure modes this covers:
1. **Upgrade-boundary**: sessions whose history was seeded by an older tool version as `[current_only]` (no original) get the original backfilled on the next state update.
2. **Init-driven rotation**: `init.cjs` strips `workflow_id + created_at`, forcing `updateState`'s first-activation branch — which historically didn't append the NEW workflow_id to an existing history array. The self-heal pass catches it.
3. **Manual edits**: any manual workflow.yaml edit that left history out of sync with `original_workflow_id` / `workflow_id` self-corrects on the next CLI write.

Safe to re-run — the includes-check makes the pass idempotent. Observed: a history sequence missing BOTH the original and current ids is repaired by a single `state update` call (history extends by two entries on the next write).

**Trace backfill.** The self-heal post-step also scans `_mcp-trace.jsonl` (last 5000 lines) for `workflow_id` values with `ts >= first_created_at` that are NOT in `workflow_id_history`. Found orphans get spliced between the original anchor and the current id (preserves chronological intent). Covers the residue case where pre-fix rotation bugs orphaned trace workflow_ids that never reached state: those records were invisible to `mcp-stats --workflow-id=<current>` until backfill. Observed pattern: `mcp-stats --workflow-id` returns fewer entries than `--since-workflow-created` because intermediate ids never made it into history; post-backfill the counts converge. Capped at 5000 trace lines to bound I/O cost per state update.

**Deterministic complexity-tier floor.** `updateState()` consults `TIER_RANK` (`TRIVIAL<SIMPLE<STANDARD<COMPLEX`), `computeTierFloor()`, and `getScopeFileCount()` after every merge: when an agent-judged tier sits BELOW the file-count floor (`COMPLEX` triggered by ≥10 files per the `dev-workflow.md::Quick Classification Heuristic` table), auto-elevates with a `state_warning` and never demotes. Closes the gap where a large-PR scope can be seeded `SIMPLE` by `detectTier()` (task-text only) and never re-evaluated against the scope list — without this floor, the heuristic is load-bearing prose with no enforcement. Floor runs regardless of which keys were touched, so a SIMPLE tier from init auto-elevates when `code-review.md::identify_scope` later writes 12+ paths to `code-review-input.md`. File-count parsing uses bullet-line matches (not `wc -l`) so headers and the `## Source` provenance block don't inflate.

**Lane orchestration — register + render.** `registerLane({id, scope, files, allowOverwrite})` validates id (`/^L\d+$/`), scope, and files; computes derived metadata (slug via existing `slugifyLaneName`, `file_count`, `est_loc` via wc-l, `oversized` per 15-files/800-LOC thresholds); writes the canonical lane entry into `workflow.yaml::lanes[]` with new `registered_at` ISO timestamp; persists files to per-lane sidecar `.devt/state/lane-files/<id>.json` (canonical subdir — never flagged ad_hoc by `state cleanup`). Lock-aware read-modify-write; rejects duplicate ids without `--overwrite`. The sidecar split avoids extending `parseSimpleYaml`+`serializeSimpleYaml`'s lane round-trip which today handles primitive values only — arrays would corrupt. `registerLanesFromYaml(yamlPath)` bulk-wraps for the common case (hand-rolled multi-lane partitions); YAML inline-array form and JSON both accepted; loops `registerLane` with `allowOverwrite=true` so re-runs are idempotent. Companion `dispatch render-lanes` (see dispatch.cjs section below) consumes the registry to emit per-lane envelopes — the structural fix for raw-dispatches bypassing the canonical template's self-grade directive.

### `dispatch.cjs` (lane rendering, opt-in section strip)

`cmdRenderLanes(target, options)` reads `workflow.yaml::lanes[]` via `state.listLaneOutputs()`, loads each lane's files sidecar from `.devt/state/lane-files/<id>.json`, calls `cmdRenderFilled(target)` once for the base envelope (default target `code-reviewer:code_review` — the canonical per-file review template carrying the self-grade directive in its task body), then injects `<lane_id>`, `<lane_community>`, `<lane_files>` before `</context>` per lane and overrides the canonical `Write review to .devt/state/review.md` trailer with `lane.review_file` so concurrent lanes don't clobber one path. Stdout mode emits all envelopes with `<!-- LANE: <id> -->` separators; `--out=dir` mode writes one file per lane + returns a JSON summary with byte counts. Empty-lanes state writes a clear stderr message + usage hint before exit 2 rather than silent empty output.

`cmdRenderFilled(target, options)` accepts an opt-in `options.rulesExclude` array (CLI flag `--rules-exclude=heading,list`) that strips matching `## Heading` sections from each `governing_rules.content[*]` string before substitution. Match is exact title (predictable, no regex); preamble before first `## ` always preserved. Output carries a `<!-- rules-excluded: N sections (X.X KB saved) -->` trailer for audit. Typical saving runs 15-35% per dispatch depending on which sections are excluded. Promotes to project-level `.devt/config.json` config after field-evidence accumulates (promotion threshold: ≥3 dispatches in 30 days with the same exclude set).

### `model-profiles.cjs`

Maps agent types to model tiers (quality / balanced / budget / inherit). Per-agent overrides from `.devt/config.json::models`.

### `setup.cjs`

Scaffolds `.devt/rules/` from templates, creates `.devt/config.json`. Supports `create`, `update`, `reinit` modes.

**Auto-detection.** At first setup, inspects:
- Marker files (`package.json`, `pyproject.toml`, `go.mod`, etc.)
- Git remote
- Graphify availability (`graphify.enabled: true` written when the binary is on PATH)

The schema default for `graphify.enabled` stays `false` for projects without it; setup is the only thing that flips it true automatically.

### `io.cjs`

Atomic file write helpers: `atomicWriteFileSync`, `atomicWriteJsonSync`. **Single source of truth** for the `tmp + renameSync` pattern (previously inline-duplicated across 10 modules).

**Failure cleanup.** Cleans up the orphan `.tmp` if `renameSync` fails (EXDEV/EACCES/EBUSY) so a failed write never leaves stale state behind.

### `memory.cjs` (+ `memory-graph.cjs`, `memory-bundle.cjs`)

Unified FTS5 layer for all 5 doc types (ADR/CON/FLOW/REJ/LES). Owns `.devt/memory/index.db` (gitignored, regenerable). Uses `node:sqlite` (built-in).

**Schema-driven.** `DOC_TYPES` / `ID_PATTERN_BY_TYPE` / `SUBDIR_BY_TYPE` constants — adding a doc type cascades through scanner, validator, and `init()` scaffolder automatically.

**Two sibling modules.**
- `memory-graph.cjs` — link-table traversal: `getLinks`, `getSubgraphTriples`, `getBacklinks`, `findOrphans`, `findStaleLinks`.
- `memory-bundle.cjs` — portable JSON import/export: `resolveExportPath`, `resolveImportPath`, `exportBundle`, `importBundle`.

Both sub-modules lazy-require `./memory.cjs` inside function bodies to break the load-time circular dep. The core file re-exports their public surface so consumers see one API.

**Export contract for sibling use.** Four core helpers are explicitly part of the export contract: `withDb`, `findProjectRoot`, `parseYamlSubset`, `serializeFrontmatter`.

Memory layer details (frontmatter shape, multi-root, MCP tools, aggregate flags) live in `docs/MEMORY.md`.

### `preflight.cjs`

8-lane Topic Pre-Flight Brief generator. Lanes A–D query `index.db`; Lane E pulls REJ keyword overlap; Lane F filters the deduped governing union for `doc_type='lesson'` so the Brief renders LES entries under their own header; Lane G runs per-project-context-token FTS; Lane H reads auto-memory + claude-mem harvest. The governing union (A–D ∪ G) passes a lifecycle-eligibility gate (`active|candidate` only, REJ excluded) before rendering.

**Tier-aware lane budget.** `detectTier(taskText)` heuristically classifies tasks as `trivial | simple | standard | complex`:
- Keyword-first: refactor/architecture/migration → complex; small fix/hotfix → simple; typo/rename → trivial.
- Length-based fallback.

`resolveTripleBudget` resolves the Memory-Graph lane cap via precedence:

```
opts.budget → config.preflight.max_triples → config.preflight.lane_budget[tier] → 50
```

Defaults: `{trivial: 10, simple: 25, standard: 50, complex: 75}`.

**CLI override.** `preflight generate "<task>" --budget=N`.

**Outcome.** Trivial flows produce roughly 5× smaller Briefs; complex flows get more breadth.

Full Brief mechanics (JSON sidecar shape, scope_hint sidecar fields, subgraph) live in `docs/MEMORY.md`.

### `discovery.cjs`

Harvests claude-mem ⚖️/🔵 + `#KNOWLEDGE-CANDIDATE` scratchpad tags + DEC-xxx + graphify god-nodes (when graphify is ready) into `.devt/memory/_suggestions.md` for curator review.

**NEVER writes permanent memory docs.** That's the curator's exclusive authority. Full pipeline in `docs/MEMORY.md` (Curator Promotion Flow).

### `weekly-report.cjs`

Git log parsing and markdown report rendering. Contributor matching via `.devt/config.json` config.

### `update.cjs`

Version check against GitHub. Caches results (4hr TTL). Detects install type (plugin system vs git clone). Also provides:
- Dirty-tree detection (`update dirty`)
- Cache management (`update clear-cache`)
- Changelog fetching (`update changelog`)

### `health.cjs`

Project health validation with structured JSON output and `--repair` flag for safe auto-fixes. 21 checks. Includes the native `MEM_*` checks documented in `docs/MEMORY.md`.

### `security.cjs`

Input validation:
- Path traversal prevention
- Prompt injection detection (with `strict` mode: Shannon entropy analysis, URL/HTML entity decoding, zero-width character detection)
- Safe JSON parsing
- Shell argument validation
- `sanitizeForDisplay`

Wired into `init.cjs` to sanitize task descriptions entering the system.

### `structural-validator.cjs`

Markdown-structure extractors ported from caveman (MIT, `skills/caveman-compress/scripts/validate.py`). Public surface:

- `extractHeadings(text)` → `[{level, title}]`
- `extractCodeBlocks(text)` → `[string]` (line-based, nested-fence-aware per CommonMark)
- `extractUrls(text)` → `Set<string>`
- `extractPaths(text)` → `Set<string>`
- `extractInlineCodes(text)` → `Map<code, count>`
- `countBullets(text)` → `number`
- `validate(orig, comp, {mode}) → {ok, errors, warnings, mode}` — `mode: 'superset'` (default; comp must contain all orig structures, may add) or `mode: 'equality'` (strict)

Used by `state.cjs::checkAgentOutput --structural --baseline=<path>` to detect dropped sections / mangled code fences / lost URLs between a stub-first sentinel snapshot and the agent's final write, and by `state.cjs::recoverPartialImpl` to compare an artifact against `outputs.expected_sections` from `agents/io-contracts.yaml`.

### `sensitive-path.cjs`

Credential-path denylist port from caveman (MIT, `compress.py::is_sensitive_path`) with one devt-specific divergence: substring-token check is skipped when the file extension is a known programming-language source (`.py/.js/.ts/.go/.rs/...`) to avoid false-positives on legitimate code modules like `auth/token.py`. Three checks (any match → sensitive): basename regex (`.env*`, `.netrc`, credentials/secrets/passwords/keys), sensitive path component (`.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`), token-normalized basename. Non-string input throws `TypeError` — silent-false would hide programming errors as a "safe to process" verdict.

Wired into `graphify.cjs` CLI inputs at four file-accepting subcommands (`lane-suggestions`, `check-large-files`, `check-symbol-godnodes`, `symbols-in-files`) and used as the first-pass refusal gate in `static-compress.cjs`.

### `prose-shrink.cjs`

Regex prose compressor ported from caveman-shrink (MIT, `src/mcp-servers/caveman-shrink/compress.js`). Deterministic, zero-dep, sentinel-protected. Public surface:

- `compress(text, opts?) → {compressed, before, after}`
- `withProtectedSegments(text, transform)` — sentinel-wraps protected regions before transform, restores after with iterative unrolling for nested-pattern overlap

Eight protected pattern classes: fenced code, inline code, URLs, paths, CONST_CASE tokens, dotted.method paths, function calls, version numbers. Sentinel restoration loops until stable (8-pass cap); throws on non-convergence rather than silently emitting `ZZZPROTZZZ`-leaked output. Whitespace classes exclude newlines so line structure (heading boundaries) survives compression.

Used as the regex-fallback compression engine in `static-compress.cjs`.

### `static-compress.cjs`

CLI compressor for project markdown files (`.devt/rules/*.md`, project-local `guardrails/*.md`). Single engine — `prose-shrink.cjs` (zero-dep caveman-shrink regex port). Output runs through `structural-validator.cjs` post-compression — drift detected → backup file deleted, input file left untouched. Five safety layers before any input is touched: sensitive-path denylist refusal, size cap (default 500 KB), empty-file refusal, identical-output refusal, backup-readback verification (with byte-mismatch detail when readback fails).

Reversible via `<path>.original.md` backup sibling: `node bin/devt-tools.cjs static-compress --restore <path>` swaps it back atomically. Bulk run via `--all` walks project-owned surfaces; plugin maintainer pre-compress via `--plugin-build` ships pre-compressed guardrails with the next plugin release.

Gated by `config.static_compress.mode` (`'on'` default; CLI returns `{ok: true, skipped: true}` when off, exit 0). Compress + restore actions log to `.devt/state/static-compress.jsonl` (RESET_EXEMPT). Full user-facing recipe in `docs/static-compress-recipe.md`.

---

## Universal Conventions

### Atomic file writes

All file writes go through `bin/modules/io.cjs::atomicWriteFileSync` / `atomicWriteJsonSync`. Tmp-write + rename. Never write to the final path directly.

### Zero dependencies

All Node.js modules use Node.js stdlib only. No `npm install` for the plugin. This keeps the install surface small and the dependency tree empty.

### Prototype-pollution-safe config merge

`config.cjs` uses a deep merge with a `FORBIDDEN_KEYS` set blocking `__proto__`, `constructor`, `prototype`. Any source config containing those keys gets stripped before merge.

---

## Workflow Mechanics

### `workflow_type` registry

The `workflow_type` field in `workflow.yaml` drives resume routing via `/devt:next`. Valid values are validated by `state.cjs::VALID_WORKFLOW_TYPES`. The canonical table lives in `CLAUDE.md > State Flow > workflow_type Registry`.

**Adding a new workflow.** When a new workflow sets `active=true`, add its `workflow_type` to `VALID_WORKFLOW_TYPES` in `bin/modules/state.cjs` AND routing entries in BOTH `workflows/next.md` and `workflows/status.md`. The smoke test enforces presence in both surfaces.

### Autonomous Chaining

The `autonomous_chain` field in `workflow.yaml` enables cross-workflow autonomous chaining — e.g., implement → test → review without manual `/devt:next` invocations.

### Shadow-mode State Validation

`state update` runs `validateConsistency()` on every call, warns on stderr, and persists `validation_status="warned"` + `validation_warnings=N` to `workflow.yaml`. Disable with `DEVT_VALIDATE_SHADOW=0`. `next.md` routes on the persisted flag so resume-after-pause surfaces drift.

### State Validate Subcommand

`state validate` checks artifact consistency: verifies expected files exist for the current workflow phase, flags orphaned artifacts, and detects state/artifact mismatches. Also runs content-schema checks via `ARTIFACT_SCHEMA` (per-artifact `## Status:` whitelists), surfacing reasons `invalid_status`, `no_status_line`, `unreadable`, `missing`.

### Parallel Researcher + arch_health Dispatch

COMPLEX-tier `dev` flows dispatch the researcher and (when arch_health is opted-in via risk-signal AskUserQuestion) the architect in **one message with two `Task` tool calls** from Step 2.5 (`Auto-Research & Auto-Plan`).

**Old Step 2.7 is deleted.** Its risk-signal detection + user prompt logic moved earlier so the decision happens before research starts.

**arch_health architect scope.** Now scopes from `.devt/state/scan-results.md` only (no `plan.md` dependency, since the plan does not yet exist at parallel-dispatch time). True-positive findings flow into the inline Auto-Plan AND into the Step 3 architect review.

**Marker + smoke gate.** The workflow markdown carries a `<!-- parallel-dispatch: researcher + architect (arch_health mode) -->` marker. The smoke test asserts:
- Marker present.
- Step 2.7 deleted.
- No `plan.md` reads in the arch_health context block.
- No stale "from Step 2.7" references.

**Win.** One serial subagent hop saved on COMPLEX flows with arch_health enabled.

### MCP Trace Workflow Context

`bin/devt-memory-mcp.cjs::readWorkflowContext()` reads `.devt/state/workflow.yaml` on demand with mtime-invalidated caching (one `stat()` syscall per MCP call when stable; full re-read on workflow transitions).

Each trace record appended to `.devt/memory/_mcp-trace.jsonl` carries `workflow_id`, `workflow_type`, and `phase` when a workflow is active; the fields are **omitted entirely** when no `workflow.yaml` exists (the cleanest "no context" signal).

**Why mtime, not lazy-once.** The MCP server is long-lived across many workflows in one Claude Code session. Lazy-once caching would freeze the context to the first workflow seen; mtime invalidation keeps it accurate as the active workflow changes.

**CLI consumption.** `bin/devt-tools.cjs mcp-stats` consumes these fields via `--workflow-id`, `--workflow-type`, and `--phase` filter flags. Filters compose conjunctively with the existing `--since` and `--tool`.

**Workflow_id rotation across init→partition transitions.** A long-running session can rotate `workflow_id` mid-flight: code-review-parallel activates with a fresh `workflow_id` only after partition decisions, but trace records emitted during the preceding `context_init` carry the prior `workflow_id`. As a result, `mcp-stats --workflow-id=<current>` would return an empty result for sessions where every direct MCP call preceded the rotation. Two complementary mitigations:

1. `--since-workflow-created` filters by time — reads `workflow.yaml::first_created_at` (immutable session anchor) and captures the full session window regardless of how `workflow_id` mutated. The resolved cutoff is echoed under `filters.since_workflow_created`. When both `--since` and `--since-workflow-created` are passed, the later timestamp wins (conjunctive composition).
2. `--workflow-id=<current> --include-chain` unions the whole `workflow_id_history[]` chain — every intermediate id from prior `workflow_type` transitions is included. The bare `--workflow-id` filter is strict (exact id only, deterministic for audit-trail lookups); when a strict query returns 0 entries but the chain union has matches, the output carries a `hint` field naming `--include-chain` so the under-report is never silent. The workflows' own "Graphify activity" surfaces pass `--include-chain` because their context_init MCP calls land under the pre-rotation id by design.

**graphify-mcp + memory-mcp trace records carry `correlation_id`.** Each `tools/call` generates an 8-char hex id (`crypto.randomBytes(4)`) injected into the trace record AND the MCP response envelope under `_meta.correlation_id`. Two consumers: `mcp-stats --correlation-id=<id>` for retrospective single-call lookup; F16 drill-down headings in lane review files cite `[call: <id>]` so findings reference a specific call rather than just "blast_radius said X".

**CLI wrappers do NOT write to `_mcp-trace.jsonl`.** The trace records direct MCP tool invocations only. Workflows that go entirely through CLI wrappers (`preflight generate`, `state derive-reuse-candidates`, `state assert-graphify-decision`, `state evict-graphify`) will produce empty `mcp-stats` output even when graphify is fully active and load-bearing — the trace is "correctly empty" because no direct MCP calls occurred. To validate the namespace-prefix invariant (each trace record's `tool` field is the *unprefixed* form like `query_graph`, while orchestrator-side MCP calls use the *prefixed* form like `mcp__plugin_devt_devt-graphify__query_graph`) or to measure direct MCP usage, exercise a workflow that dispatches code-reviewer's `symbol_anchored` / `bulk_scoped` / `pr_scoped` tiers (which call `query_graph`, `get_neighbors`, `blast_radius` directly), or call MCP tools from the orchestrator during context_init's drill-down protocol.

### MCP Tool Reachability

The upstream graphify MCP server exposes ~10 tools; devt's read path consumes them via either the orchestrator (direct MCP calls in workflow context_init / F16 drill-down) or the CLI surface (`bin/devt-tools.cjs graphify *`). Mapping (V65-6 audit):

| Tool | Workflow consumer | CLI consumer | Status |
|---|---|---|---|
| `blast_radius` | code-review.md::F16, dev-workflow.md::scan_prep | `graphify blast-radius` | LIVE |
| `get_neighbors` | F16 drill-down (top-3 dependents) + `graphify neighbors --max-bytes` fallback | `graphify neighbors` | LIVE |
| `query_graph` | bulk_scoped tier (legacy) + RECOVERY mode | `graphify query` | LIVE |
| `get_pr_impact` | pr_scoped tier (GitHub-only) | — | LIVE (GitHub) |
| `graph_stats` | preflight.cjs:907 (Pre-Flight Brief), `graphify adaptive-threshold` | `graphify stats` | LIVE |
| `get_node` | architect.md::cross-service-path verification (V65-6) | `graphify node` | LIVE (architect) |
| `shortest_path` | architect.md::cross-service-path verification (C-I.2) | `graphify path` | LIVE |
| `god_nodes` | preflight.cjs::renderPreflightSidecar (top-3 cached) | `graphify god-nodes` | LIVE |
| `get_community` | — | `graphify lane-suggestions` (consumes `graphify.getCommunity()` JS function) | NOT ADVERTISED — MCP wrapper removed; JS function remains. Re-advertise if a workflow needs agent-facing community enumeration |
| `list_prs` / `triage_prs` | — | — | NOT WIRED — GitHub-only PR triage tier, deferred until field evidence justifies the work |

V65-6 closed `get_node`'s reachability gap by documenting the single-symbol introspection use case in `agents/architect.md`. Going forward: any new upstream tool added by the graphify MCP server gets an entry in this table during reachability audit. If a tool sits NOT WIRED for >1 release cycle, decide explicitly: wire it (with documented consumer) or remove from the audit set with a "deferred until ..." note.

**Tool-name namespace split (prefixed vs unprefixed).** MCP tool names appear in two forms across the codebase: **prefixed** (e.g. `mcp__plugin_devt_devt-graphify__blast_radius`) in workflow prose + dispatch instructions, because Claude Code's plugin loader namespaces tool invocations under the plugin id; and **unprefixed** (e.g. `mcp__devt-graphify__blast_radius`) in trace records (`_mcp-trace.jsonl`) + telemetry queries, because the MCP server records its own raw name. This split is intentional and can't be unified without breaking either (a) plugin-namespaced invocation or (b) backward-compat of existing trace ledgers. **Canonical translator: `mcpStats.normalizeToolName(name)` at `bin/modules/mcp-stats.cjs:121`** — `require()` it from any new caller that needs to match across surfaces. Don't reinvent the mapping inline; the comment block at `mcp-stats.cjs:112-118` is the authoritative explanation of which form belongs where.

**MCP trace external-server gap (won't-fix).** `_mcp-trace.jsonl` only captures tool calls routed through devt's OWN MCP server (`bin/devt-memory-mcp.cjs::recordTrace`). Calls to upstream third-party MCP servers (graphify, claude-mem, context7, etc.) made directly by the orchestrator or by sub-agents whose `tools:` frontmatter exposes those MCP names go client → upstream-server with no devt-side observability hook. As a result, `mcp-stats` undercounts the true MCP surface used during a workflow. The fix would require either a Claude Code-level harness instrumentation point (not in devt's scope) or a wrapping MCP proxy (architecturally heavy + introduces a new failure mode in the hot path). Decision: won't-fix; instrument-where-we-can (own server) + document the gap here. `mcp-stats` output should be read as "tool calls through devt's MCP server" rather than "all MCP calls in this workflow".

### Gate Enforcement Architecture (Layer-1 + Layer-2 + advance-phase)

Architecture progression: warn-at-dispatch → warn-at-finalize (Layer-1) → block-at-finalize (Layer-2) → block-at-transition (advance-phase). This is the architectural floor on the post-hoc-to-runtime axis — there's nowhere lower than gating the phase transition itself.

**Layer-1 — inline mechanical claim-check.** `state assert-artifact-present <agent>` reads agent's `outputs.primary` from `agents/io-contracts.yaml`, asserts `[ -s file ]` exists. Every Layer-1 call wraps result through `persistClaimCheckResult` which appends a record to `.devt/state/claim-check-failures.jsonl` (`{ts, source:"claim_check", agent, verdict:"success"|"failure", reason, expected_path, workflow_id}`). Workflow .md bash blocks call Layer-1 immediately after each output-writing dispatch — prints `[BLOCKED]` warning but does NOT halt (advisory inline).

**Layer-2 — post-hoc finalize gate.** `state assert-claim-checks-resolved` reads `claim-check-failures.jsonl`, groups records by agent, computes per-agent latest verdict in workflow window (anchored at `created_at`). Failure with no subsequent success blocks. **Resolution semantic**: a successful re-run after a failed dispatch OVERWRITES the failure record (orchestrator re-dispatched successfully → no longer unresolved). Honors `claim_check_mode` config knob (block default, mirrors `dispatch_hygiene_mode` pattern). Wired in all 4 workflow finalize sites adjacent to `assert-no-raw-dispatches-this-session`.

**Layer-3 — `state advance-phase` runtime gate-at-transition.** Reads `workflow.yaml::workflow_type`, looks up required gates for target phase from `workflows/_phase-gates.yaml`, dispatches each via `GATE_FNS` central registry, throws on any failure (devt-tools.cjs outer catch exits 1). All-pass results in atomic `updateState` with phase + status=DONE + any kv updates. Phases NOT in registry fall through to plain update (backwards compat preserves the migration cadence). Every gate firing logs to `gate-trace.jsonl` with name prefixed `advance-phase:<gate-name>` so consumers distinguish transition-time gates from manual one-off runs.

**Belt-and-suspenders during migration cadence.** advance-phase ships but RETAINS the prior inline gate-check bash blocks. Both fire for each finalize transition until field evidence confirms the YAML registry path catches everything inline-checks catch. Cleanup removes inline checks once verified.

**Unified gate-trace.jsonl observability.** `bin/modules/state.cjs::traceGate(name, fn)` wraps every `assert-*` CLI subcommand in the `run()` switch. Records appended: `{ts, source:"gate_trace", gate, verdict:"ok"|"warn"|"fail", reason, workflow_id, workflow_type, phase}`. Gives unified observability across the entire gate surface in one file instead of stitching together `dispatch-warnings.jsonl` + `claim-check-failures.jsonl` + `preflight-denies.jsonl`. Query patterns: `jq -s 'group_by(.gate) | map({gate: .[0].gate, fires: length, blocks: map(select(.verdict=="fail")) | length})'`. **Cross-session retention**: gate-trace.jsonl is append-only — it persists across `/devt:workflow --cancel` and accumulates across workflows. Entries from prior workflows surface in the file with their original `workflow_id`. Filter to the current session with `jq 'select(.workflow_id == "<id-from-workflow.yaml>")'` or union the full `workflow_id_history[]` chain in `workflow.yaml` to span all ids belonging to the current logical session (per the immutable session anchors pattern).

**`dispatch-warnings.jsonl` — discriminated-union schema.** The filename suggests single-source dispatch-warning records but the file actually carries multi-source telemetry. Every record has a `source:` discriminator + source-specific fields. Three active sources (writers in `hooks/`):

| `source` | Writer | Per-record fields (after `ts` + `source`) |
|---|---|---|
| `raw_dispatch` | `hooks/dispatch-hygiene-guard.sh` | `agent`, `prompt_bytes`, `prompt_preview` |
| `dispatch_scope` | `hooks/dispatch-scope-guard.sh` | `agent`, `prompt_bytes`, `scope_hint_count`, `cap_bytes`, `cap_files`, `warnings` |
| `task_output_bytes` | `hooks/task-truncation-detector.sh` | `agent`, `output_bytes`, `threshold_bytes`, `near_cliff`, `low_output`, `low_output_threshold`, `stop_reason`, `mid_task_language` |

Consumers MUST filter by `source:` before interpreting payload fields — different sources have disjoint schemas. Common pitfall: reading the file expecting unified `{dispatch_type, subagent_type, reason}` fields → mostly-null payloads because the actual schema is per-source. `state.cjs::recoverPartialImpl` is the canonical example of a correct consumer — it filters `rec.source === "task_output_bytes"` before reading `rec.low_output`. `state.cjs::assertNoRawDispatchesThisSession` does the same for `rec.source === "raw_dispatch"`.

**Mirroring the dispatch-hygiene pattern.** This architecture reuses `assertNoRawDispatchesThisSession`'s shape (a battle-tested pattern): write to jsonl, post-hoc gate at finalize, config knob with block default. advance-phase mirrors the same pattern at transition time. Reusing established patterns is intentional — coordination via clear protocols is strengthened by NOT introducing new contract patterns.

---

## Skills Resolution

**Source.** `skills/*/` directories shipped with the plugin, plus optional user overrides at `.devt/config.json::agent_skills.<agent>`.

**Per-agent bucket structure.** Each agent's entry in `skill-index.yaml` carries up to three sibling buckets:

| Bucket | Loaded when |
|---|---|
| `skills` | Always |
| `skills_standard` | Tier is STANDARD or COMPLEX |
| `skills_complex` | Tier is COMPLEX only |

**Resolution function.** `init.cjs::resolveSkills(pluginRoot, config, tier)` merges and dedupes the matching buckets. Init seeds `tier` from `state.tier` (set by `complexity-assessment`) or `detectTier(task)` so the first dispatch in a fresh workflow already gets tier-aware loading.

**Outcome.** Trivial-tier programmer load is ~3 skills vs ~7 for COMPLEX — meaningful prefix shrinkage on light flows.

**User overrides.** `.devt/config.json::agent_skills.<agent>` remains a flat array (= always loaded, no tier filter) so existing project configs don't break.

**Fixtures.** Trigger-evaluation fixtures live in `skills-workspace/` (gitignored, used by autoskill).

---

## Agent IO Contracts

**File.** `agents/io-contracts.yaml` — single source of truth declaring per-agent:

| Field | Purpose |
|---|---|
| `frontmatter_skills` | Skills declared in the agent's `.md` frontmatter `skills:` array |
| `index_buckets` | Buckets the agent's `skill-index.yaml` entry uses (skills / skills_standard / skills_complex) |
| `outputs.{primary,sidecar}` | The artifact(s) the agent writes |
| `inputs.context_blocks` | Dispatch tags the agent expects (e.g. `<scope_hint>`, `<governing_rules>`, `<memory_signal>`) |

**Three smoke gates** enforce that the contract agrees with reality:

1. Agent `.md` frontmatter matches `frontmatter_skills`.
2. `skill-index.yaml` buckets match `index_buckets`.
3. `state.cjs::JSON_SIDECAR_SCHEMAS` includes the declared `outputs.sidecar`.

**Adding a new agent.** Append a contract entry, create `agents/<name>.md`, register any sidecar in `JSON_SIDECAR_SCHEMAS`. The smoke test catches any miss.

**What this prevents.** The class of silent drift where a skill is preloaded via agent frontmatter for several releases while being absent from the index — fixed retroactively, prevented going forward.

---

## Governing Rules Wiring

**Function.** `init.cjs::loadGoverningRules` returns the PROJECT'S `.devt/rules/*.md` contents (priority order: `coding-standards.md`, `architecture.md`, `quality-gates.md`, `review-checklist.md`, then alphabetical) inline in the `init` payload. `CLAUDE.md` is hashed but NEVER inlined — the harness auto-injects project `CLAUDE.md` into every subagent's context (built-in Explore/Plan are the only agents that skip it; devt's agents are custom agents), so inlining it would pay the byte cost twice. `content["CLAUDE.md"]` holds a short by-reference stub, and the real bytes surface in `paths_excluded` with reason `harness_injected` while still feeding `rules_hash`:

```jsonc
{
  "governing_rules": {
    "content": {"<path>": "<content>", ...},
    "paths_included": [...],
    "paths_excluded": [...],
    "rules_hash": "<sha256-16>",
    "total_bytes": N
  }
}
```

**Cap.** 96 KB total for the `.devt/rules/*.md` corpus. Files past the cap surface in `paths_excluded` and agents Read them on demand. `CLAUDE.md` also surfaces in `paths_excluded` (reason `harness_injected`), not `paths_included`.

**Consumer workflows.** `dev-workflow.md` (its verifier + researcher dispatch templates live in the tier files `dev-workflow.standard.md` / `dev-workflow.complex.md` since the tier-partition; code-reviewer stays in the spine), `quick-implement.md`, `code-review.md`, `research-task.md` inject the block as `<governing_rules rules_hash="...">` with sub-tags `<claude_md>`, `<coding_standards>`, `<architecture>`, `<quality_gates>`, `<review_checklist>` into the **code-reviewer, verifier, and researcher** dispatch templates — the 3 READ-ONLY agents that previously re-read CLAUDE.md + 1–4 rule files on every dispatch.

**Agent behavior.** Those agents prefer inline content over on-disk Reads when the block is present; fall back to disk Reads when a specific sub-tag is empty (project lacks that file) or `governing_rules.content` is empty (no project rules). The `<claude_md>` sub-tag carries only the by-reference stub — agents never Read `CLAUDE.md` from disk, since the harness has already injected it.

**Delivery mode.** `dispatch render-filled` swaps every `governing_rules.content` body (and the inline rubric) for a read-from-disk stub by default — config `dispatch.rules_mode` / `dispatch.rubric_mode`, per-call flags win — and auto-injects the `<context_loaded_contract>` so selective reading stays verifier-checkable. `--inline-rules` restores full inlining for worktree-isolated dispatches. Agents recognize the `(by-reference: …)` stub as an instruction to Read from disk, not as content (stub-awareness clause in each consumer agent's context_loading). Lanes have always defaulted to by-reference; this extends the same economics to single dispatches.

**Drift detection.** The `rules_hash` (SHA-256 first 16 chars over all discovered rule file contents in stable order) lets agents detect mid-workflow drift if a rule file is edited between init and agent dispatch.

---

## Inline Guardrails Wiring

**Function.** `init.cjs::loadInlineGuardrails` returns the contents of `golden-rules.md` + `engineering-principles.md` + `generative-debt-checklist.md` (~27 KB total, capped at 64 KB) inline in the `init` payload as `inline_guardrails: {filename: content}`.

**Consumer workflow.** `workflows/dev-workflow.md` captures this at context_init and injects it as a `<guardrails_inline>` block (with `<golden_rules>`, `<engineering_principles>`, `<generative_debt_checklist>` sub-tags) into the **programmer and code-reviewer** dispatch templates only — the 2 agents that read all 3 files on every dispatch.

**Why only those two.** Other dev agents continue reading from disk. Extending inlining to them would inflate prefix bytes without offsetting Read savings (their reads are 0–1 files per dispatch).

**Fallback.** Agents fall back to `${CLAUDE_PLUGIN_ROOT}/guardrails/*.md` Reads when the 64 KB cap triggers `inline_guardrails: null`.

---

## Deferred-Task Tracker

**File.** `.devt/state/deferred.md` — markdown with `DEF-NNN` ids.

**Capture.** Via `/devt:note --defer "<title>"` (or any agent calling `node bin/devt-tools.cjs deferred add`).

**Survival.** Exempted from `state reset` via `RESET_EXEMPT` set in `bin/modules/state.cjs` so items survive `/devt:workflow --cancel`.

**CLI.** `deferred add|list|get|close|reopen|count`.

**Surface.**
- `/devt:status` shows "Deferred queue: N open" when non-empty.
- `/devt:next` offers AskUserQuestion pickup of top open items when no other work resumable.

**Distinct from `.devt/memory/`.** Deferred items are transient TODOs — not curator-gated, not in Pre-Flight Brief noise.

---

## Plugin Internals

### Manifest

The plugin manifest lives at `.claude-plugin/plugin.json`. Agents are listed explicitly; commands and skills are auto-discovered from cwd.

### Symlinking

Commands are symlinked to `~/.claude/commands/devt/` on session start for `devt:` namespaced autocomplete.

### Version tracking

Version is tracked in both `plugin.json` and `VERSION` file. **`plugin.json` is primary** — CI enforces version coherence between the two.

### `devt-coordinator` opt-in main-thread router

`agents/devt-coordinator.md` is a thin classifier that routes devt-shaped prompts to `/devt:*` commands via the Skill tool and lets casual prompts pass through to a normal Claude session.

**Opt-in.** Users add `"agent": "devt-coordinator"` to their project's `.claude/settings.json` (or `claude --agent devt-coordinator` for ad-hoc).

**Sync invariant.** The agent's routing table MUST stay in sync with `workflows/do.md` — smoke test enforces row-count parity.

**Plugin-agent restrictions.** Still apply when run as main thread — no `hooks` / `mcpServers` / `permissionMode` frontmatter. Users needing those can copy the agent to `.claude/agents/` for unrestricted use.

---

## Templates

Project templates in `templates/` (python-fastapi, go, typescript-node, vue-bootstrap, rust, blank) provide `.devt/rules/` scaffolding files:

| Template file | Purpose |
|---|---|
| `architecture.md` | Layer boundaries, dependency rules |
| `coding-standards.md` | Naming, style, structural conventions |
| `documentation.md` | Docs conventions (godoc/TSDoc/rustdoc/sphinx) |
| `git-workflow.md` | Branch / commit conventions |
| `golden-rules.md` | Project-specific golden rules |
| `quality-gates.md` | Exact validation commands |
| `review-checklist.md` | Code review priorities |
| `testing-patterns.md` | Test framework + structure |
| `patterns/common-smells.md` | Project-specific anti-patterns |
| `api-changelog.md` (optional) | API change log conventions (HTTP-API templates) |
| `canonical-entities.yaml` (optional) | Canonical entity registry for arch-scanner |
| `arch-scan.py` + `detectors/` (optional) | Project-specific architecture scanner |

The 9-file baseline (architecture, coding-standards, documentation, git-workflow, golden-rules, quality-gates, review-checklist, testing-patterns, patterns/common-smells) is enforced by smoke gate K70 — every template registered in `bin/modules/setup.cjs::AVAILABLE_TEMPLATES` MUST ship all 9. Optional files vary per template's domain: `api-changelog.md` ships with python-fastapi/go/typescript-node (HTTP-API-serving); `canonical-entities.yaml` ships with python-fastapi/rust (entity-aware projects); `arch-scan.py` + `detectors/` ship only with python-fastapi (the canonical Python scanner).

**Smoke gate K71** — dispatch envelope drift. Runs `dispatch compile --check` and fails the smoke run when any rendered envelope in `workflows/*.md` drifts from its source `.tmpl.md` + `agents/io-contracts.yaml` declaration. Closes the structural gap that let v0.75.x `graph_impact_md` declarations stay un-rendered.

**Smoke gate K72** — lane-suggestions archetype classifier. Fixture: 1 covered file (community 1) + 1 `.md` + 1 `tests/*` path + 1 `.sql`. Asserts that `groups[].archetype` contains exactly `["docs", "tests"]` for the uncovered files, with the `.sql` falling to residual `ungrouped` (no archetype field). Locks the B1 archetype taxonomy against accidental regression.

**Smoke gate K73** — `dispatch render-filled` graph-impact inlining. Round-trips two states: absent (envelope contains the `(no graph-impact.md available — ...)` notice) and present (envelope contains a sentinel marker from an actual file). Locks A1 against the prior-cycle regression where the placeholder shipped without substitution.

**Authoring templates** for new agents and skills are at `templates/agent-template.md` and `templates/skill-template.md`.

---

## Scripts

Utility scripts in `scripts/` with their purpose and CI status. Run-on-push gates marked **CI**.

| Script | Purpose | When |
|---|---|---|
| `smoke-test.sh` | 500+ CLI smoke checks across all subcommands, agent line budget, content-schema gates, pointer integrity | **CI** + manual pre-commit |
| `test-locking.cjs` | 20-worker concurrent state-write test — asserts no lost updates, no orphaned `.lock` | **CI** + manual after `state.cjs` changes |
| `check-dispatch-ordering.cjs` | Enforces `<task>`/`<bug>` AFTER `</context>` in workflow Task dispatches (cache-friendly prefix). Called by `smoke-test.sh`. | **CI** (via smoke-test) |
| `check-state-contract.cjs` | Static analyzer scanning every `agents/*.md` and `workflows/*.md` for `.devt/state/<filename>` references; flags any that match no `STATE_FILE_CONTRACT` pattern | **CI** (via smoke-test) |
| `check-docs.sh` | Checks documentation completeness against `.devt/rules/documentation.md` — verifies declared doc paths + sections exist | Manual / quality gate |
| `prompt-injection-scan.sh` | Scans plugin markdown for injection patterns that could compromise agent behavior | Manual / release gate |
| `run-quality-gates.sh` | Extracts and executes bash commands from `.devt/rules/quality-gates.md` fenced blocks | Used by `/devt:review --focus=quality` workflow |
| `init-dev-rules.sh` | Scaffolds `.devt/rules/` from a template (one-off setup helper) | Manual |
| `cancel-workflow.sh` | Cancel active devt workflow — delegates to `devt-tools.cjs` | User-facing |
| `reset-workflow.sh` | Reset devt workflow state — delegates to `devt-tools.cjs` for robust cleanup | User-facing |
| `extract-changelog.sh` | Pulls a single version's section out of `CHANGELOG.md` for GitHub release notes | Release workflow only |
| `test-graphify.cjs` | Drives the graphify CLI surface against a fixture `graph.json` | **CI** (via smoke-test) |

**Adding a new script.** If it's a CI gate, wire it into `scripts/smoke-test.sh` so it runs on every push. If it's a quality-gate helper for projects, expose it as a `node bin/devt-tools.cjs <verb>` subcommand instead — projects should not shell out to `scripts/` directly (those are devt-internal tooling).

### Notable smoke gates

`scripts/smoke-test.sh` houses ~826 individual assertions; the K-prefixed gates are the named, high-leverage ones referenced elsewhere in this codebase. Recent additions:

| Gate | What it asserts |
|---|---|
| **K71** — dispatch envelope drift | `dispatch compile --check` reports zero drift between rendered envelopes in `workflows/*.md` and their source `.tmpl.md` + `io-contracts.yaml` declaration. |
| **K71b** — dispatch render idempotence | Two consecutive `dispatch compile --check` calls produce byte-identical output. Catches mtime/timestamp/random-id leaks into the substitution table that would silently break prompt-cache hit rates. |
| **K74** — structural-drift validator | Four-fixture round-trip across `state check-agent-output --structural --baseline=<path>` — superset stub→complete passes, superset stub→dropped-section fails with specific "Section dropped" error, equality mode mangled code-block fails, equality identical passes. |
| **K76** — graphify sensitive-path denylist | Four fixtures across `lane-suggestions` / `check-large-files` / `symbols-in-files` — credential/key/secret paths refused with exit 2 + stderr message; clean paths flow through. |
| **K77** — static-compress round-trip | Five fixtures: mode-off skip, mode-on compress preserves code/URL/path + writes backup, `--restore` returns byte-equal original, sensitive filename refused, empty file refused. Drift-revert behavior is locked separately by K74 (structural-drift validator) + K85 (prose-shrink correctness) since the compressor is single-engine. |
| **K78** — banned version markers | Scans `bin/modules/`, `hooks/`, `agents/`, `workflows/`, `templates/`, `guardrails/` for v-prefixed semver literals. Provenance belongs in CHANGELOG and git history, not code comments. Exempts the `update.cjs` CHANGELOG-parser regex and `templates/*/documentation.md` files (the latter contain JSDoc deprecation-style template snippets that legitimately demonstrate semver syntax to the user). Pairs with the broader doc-discipline gate that scans `agents/`, `workflows/`, `skills/`, `docs/` for the same class of markers. |
| **K86** — dispatch decompose CLI surface | Renders verifier:dev envelope, asserts JSON shape (`.summary`, `.blocks`), pct components sum to ~1.0, `governing_rules` classified as static when present, `cmdDecompose` exported. Locks the read-only measurement CLI that surfaces per-block byte breakdown — primary input to per-agent inlining decisions. |

---

## Substance-Enforcement Gates

Cross-cutting design discipline. A recurring failure mode: gates that verify an artifact exists, has the right shape, or has the right section count — but not whether the *substance* behind the form is real. Fifteen field-validated instances, grouped by enforcement class:

| Gate | Form check (passed) | Substance gap (bypassed) | Fix |
|---|---|---|---|
| **F4** | `graphify_scan_prep` step ran | Step was inside a skippable conditional | Move gate to mandatory precondition |
| **B4** | Curator dispatched | Dispatch was in an unreachable workflow branch | Relocate gate to context_init |
| **L1** | `dispatch-hygiene-guard.sh` warned | Advisory was ignored 6× in one session | Default-block (`{decision:"deny"}`) |
| **F26** | `## Drill-down:` headings present | Headings hand-written without MCP calls | Cross-reference `_mcp-trace.jsonl` for `get_neighbors` records in `workflow_id` window |
| **F27/F28** | `review.md` file exists | Body is "Stub written; analysis in progress." | `state check-agent-output` detects stub phrases + low word count + heading-only |
| **F29** | dev-workflow verifier dispatch | Same stub problem, different workflow | Apply F28 substance gate to dev-workflow |
| **F30** | Verifier agent body grading stubs | Agent burns turns on stub artifacts | Verifier self-aborts with `verdict=failed` on stub upstream |
| **F31** | Narrow stub regex | "analysis in progress" only — missed variants | Verb-prefixed pattern catches realistic phrasings |
| **scope-check-handled** | AskUserQuestion prose in workflow | Orchestrator skips silently | Artifact-and-CLI: `scope-check-required.txt` + `state assert-scope-check-handled` |
| **lanes-registered** | partition_lanes ran | Empty `workflow.yaml::lanes[]` | `state assert-lanes-registered` blocks dispatch |
| **consolidator-dispatched** | Lanes passed substance | Orchestrator writes review.md instead of dispatching synthesis agent | `state assert-consolidator-dispatched` requires marker from agent body |
| **auto-curator-considered** | auto_curator step in workflow | Skipped without reading config | Marker file writes FIRE/DISABLED; gate requires marker |
| **assert-reuse-analyzed** | Programmer "scans existing code" prose | Reimplements similar functions | `derive-reuse-candidates` writes candidates; programmer must address each |
| **isArtifactFresh** | Artifact exists | Stale prior-workflow artifact passes | mtime-vs-`workflow.yaml::created_at`, 30s grace; retro-fit to 7 gates |
| **assert-preflight-semantic-quality** | `topic.symbols` non-empty | Symbols don't match task subject (path-leak, short stand-ins) | `topic.extraction_confidence` numeric score from resolution_path + keyword overlap; WARN-mode (`ok:true, warn:bool`), default threshold 0.4. Deliberate variant — see note below. |

**Note on the WARN-mode variant.** `assert-preflight-semantic-quality` is the only entry that returns `ok:true` even when its substance check fails (it surfaces `warn:true` instead). Rationale: semantic quality is signal, not safety. Hard-blocking on noisy symbols would refuse to run workflows on the very tasks that most need rescue (vague PRs, paste-of-Slack-message inputs). The WARN routes through the orchestrator's `present_findings` footer rather than the BLOCKED terminal, preserving forward motion while still surfacing the calibration data downstream gates need.

(Historical timeline: see `CHANGELOG.md` for which release introduced each gate.)

### Required properties (both must hold)

Every substance-enforcement gate has two non-negotiable properties:

1. **Existence binding** — the artifact must exist. Validated by `fs.existsSync` or equivalent.
2. **Freshness binding** — the artifact's mtime must postdate the current `workflow.yaml::created_at` within a 30-second grace window. Validated by `isArtifactFresh(path)`. Added after field observation showed every existence-only gate passed against stale prior-workflow artifacts.

Gates missing either property are bypassable. Empirical evidence from the freshness retrofit: five existence-only gates produced silent passes against stale state; the one gate with mechanical reset binding (`auto-curator-considered`) fired correctly because the prior session's marker was naturally absent.

### Pattern recognition

When adding a new gate, ask explicitly: **does this check the artifact's shape, or the work behind it?** If it checks shape alone, identify a substance signal that proves the work happened:

- **For MCP-backed work** — cross-reference `_mcp-trace.jsonl` records scoped to the current `workflow_id` (the trace is the receipt). See `assertGraphifyDecision` for the reference implementation.
- **For agent-authored content** — run `state check-agent-output` against the output file (stubs, low word count, heading-only all flag as `looks_like_stub: true`). Wire the call as a bash pre-gate before the verifier dispatch.
- **For multi-step work where one step is skippable** — relocate the gate to a mandatory step, not the optional one (the F4 lesson).
- **For any artifact whose currency matters** — wire `isArtifactFresh(artifactPath)` into the gate's branch logic. Stale prior-workflow artifacts return `fresh:false` with reason "artifact mtime is Ns older than workflow.yaml::created_at — file is from a prior workflow".

### Why these gates fail closed, not advisory

LLM orchestrators under context pressure classify advisory warnings as "not load-bearing" and skip them. The pattern across many instances: a soft signal loses to perceived urgency every time. The only counterweights with observed efficacy in the field are gates that block involuntarily — either by failing the artifact contract (returns `ok:false`) or by failing the workflow contract (sets `verdict=FAILED`, which routes to STOP-with-BLOCKED at the existing failure terminal).

The audit instinct when reviewing devt's own gates: *if I remove the substance check, can a well-intentioned orchestrator still pass by writing prose / creating an empty file / running through the form?* If yes, the gate enforces form not substance.

---

## Development CLI Reference

Moved to [`docs/operator-guide/CLI-REFERENCE.md`](operator-guide/CLI-REFERENCE.md) — the verbose CLI inventory belongs in the operator-onboarding namespace; runtime-load-bearing internals stay here.

