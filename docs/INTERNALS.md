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
- `RESET_EXEMPT` — set of filenames preserved across `state reset`. Diagnostic side-channels live here so root-cause forensics survive `/devt:cancel-workflow`: `preflight-denies.jsonl`, `dispatch-warnings.jsonl`, `probe-failures.jsonl` (graphify+python probe failure categories — see `docs/GRAPHIFY.md::Probe Failure Diagnostics`), `.graphify-rebuild.lock` (DEF-038 atomic O_CREAT|O_EXCL — see `docs/GRAPHIFY.md::Debounced Rebuild`), `last-curator-run.txt`, `deferred.md`.
- `STATE_FILE_CONTRACT` — canonical filename inventory (referenced by `docs/STATE-RULES.md`).

**Validation.** `updateState()` auto-runs `validateConsistency()` (shadow mode), emits stderr warnings, and persists `validation_status` / `validation_warnings` to `workflow.yaml` on mismatch.

**Disable.** `DEVT_VALIDATE_SHADOW=0` turns off the shadow check.

**Workflow session metadata.** `updateState()` auto-stamps `created_at` (ISO-8601) and `workflow_id` (UUID via `crypto.randomUUID`) on the `active=true` transition. Idempotent — subsequent updates preserve the stamps; `resetState()` clears them so the next activation re-stamps. The stuck-detector uses `created_at` as its session boundary anchor.

**Immutable session anchors.** First activation also freezes `first_created_at` and `original_workflow_id` — these never rotate, even when `workflow_type` transitions cause `created_at` / `workflow_id` to refresh. Freshness gates (`assert-preflight-fresh`, `assert-claude-mem-harvest`, `assert-graphify-decision`) and `mcp-stats --since-workflow-created` read the immutable anchors so artifacts written before a transition stay attributable to the current session.

**Workflow_id chain.** Each `workflow_type` transition appends the outgoing `workflow_id` to `workflow_id_history[]` before overwriting (serialized via the JSON-stringify path in `serializeSimpleYaml`; round-tripped via `parseSimpleYaml`). `mcp-stats --workflow-id=<current>` unions the whole chain when the supplied id matches `workflow_id` — sessions chaining through three or more `workflow_type` rotations (e.g. dev → code_review → debug → quick_implement) stay attributable across every intermediate id. Historical-id queries (a user citing a specific past id) stay strict against that id alone.

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

6-lane Topic Pre-Flight Brief generator. Lanes A–D query `index.db`; Lane E pulls REJ keyword overlap; Lane F filters the deduped governing union for `doc_type='lesson'` so the Brief renders LES entries under their own header.

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
2. `--workflow-id=<current>` unions the whole `workflow_id_history[]` chain — every intermediate id from prior `workflow_type` transitions is included. Historical-id queries (a specific past id) stay strict so audit-trail lookups remain deterministic.

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
| `get_community` | code-review-parallel.md::partition_lanes (via `lane-suggestions`) | `graphify lane-suggestions` | LIVE |
| `list_prs` / `triage_prs` | — | — | NOT WIRED — GitHub-only PR triage tier, deferred until calibration evidence justifies the work |

V65-6 closed `get_node`'s reachability gap by documenting the single-symbol introspection use case in `agents/architect.md`. Going forward: any new upstream tool added by the graphify MCP server gets an entry in this table during reachability audit. If a tool sits NOT WIRED for >1 release cycle, decide explicitly: wire it (with documented consumer) or remove from the audit set with a "deferred until ..." note.

**MCP trace external-server gap (C7-5, won't-fix).** `_mcp-trace.jsonl` only captures tool calls routed through devt's OWN MCP server (`bin/devt-memory-mcp.cjs::recordTrace`). Calls to upstream third-party MCP servers (graphify, claude-mem, context7, etc.) made directly by the orchestrator or by sub-agents whose `tools:` frontmatter exposes those MCP names go client → upstream-server with no devt-side observability hook. Greenfield calibration #7 noted that `mcp-stats` therefore undercounts the true MCP surface used during a workflow. The fix would require either a Claude Code-level harness instrumentation point (not in devt's scope) or a wrapping MCP proxy (architecturally heavy + introduces a new failure mode in the hot path). Decision: won't-fix; instrument-where-we-can (own server) + document the gap here. `mcp-stats` output should be read as "tool calls through devt's MCP server" rather than "all MCP calls in this workflow".

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

**Function.** `init.cjs::loadGoverningRules` returns the PROJECT'S `CLAUDE.md` + `.devt/rules/*.md` contents (priority order: `coding-standards.md`, `architecture.md`, `quality-gates.md`, `review-checklist.md`, then alphabetical) inline in the `init` payload:

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

**Cap.** 96 KB total. Files past the cap surface in `paths_excluded` and agents Read them on demand.

**Consumer workflows.** `dev-workflow.md`, `quick-implement.md`, `code-review.md`, `research-task.md` inject the block as `<governing_rules rules_hash="...">` with sub-tags `<claude_md>`, `<coding_standards>`, `<architecture>`, `<quality_gates>`, `<review_checklist>` into the **code-reviewer, verifier, and researcher** dispatch templates — the 3 READ-ONLY agents that previously re-read CLAUDE.md + 1–4 rule files on every dispatch.

**Agent behavior.** Those agents prefer inline content over on-disk Reads when the block is present; fall back to disk Reads when a specific sub-tag is empty (project lacks that file) or `governing_rules.content` is empty (no project rules).

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

**Capture.** Via `/devt:defer "<title>"` (or any agent calling `node bin/devt-tools.cjs deferred add`).

**Survival.** Exempted from `state reset` via `RESET_EXEMPT` set in `bin/modules/state.cjs` so items survive `/devt:cancel-workflow`.

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

Project templates in `templates/` (python-fastapi, go, typescript-node, vue-bootstrap, blank) provide `.devt/rules/` scaffolding files:

| Template file | Purpose |
|---|---|
| `coding-standards.md` | Naming, style, structural conventions |
| `testing-patterns.md` | Test framework + structure |
| `quality-gates.md` | Exact validation commands |
| `architecture.md` | Layer boundaries, dependency rules |
| `review-checklist.md` | Code review priorities |
| `documentation.md` (optional) | Docs conventions |
| `git-workflow.md` (optional) | Branch / commit conventions |
| `golden-rules.md` (optional) | Project-specific golden rules |
| `api-changelog.md` (optional) | API change log conventions |
| `patterns/common-smells.md` (optional) | Project-specific anti-patterns |

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
| `run-quality-gates.sh` | Extracts and executes bash commands from `.devt/rules/quality-gates.md` fenced blocks | Used by `/devt:quality` workflow |
| `init-dev-rules.sh` | Scaffolds `.devt/rules/` from a template (one-off setup helper) | Manual |
| `cancel-workflow.sh` | Cancel active devt workflow — delegates to `devt-tools.cjs` | User-facing |
| `reset-workflow.sh` | Reset devt workflow state — delegates to `devt-tools.cjs` for robust cleanup | User-facing |
| `extract-changelog.sh` | Pulls a single version's section out of `CHANGELOG.md` for GitHub release notes | Release workflow only |
| `test-graphify.cjs` | Drives the graphify CLI surface against a fixture `graph.json` | **CI** (via smoke-test) |

**Adding a new script.** If it's a CI gate, wire it into `scripts/smoke-test.sh` so it runs on every push. If it's a quality-gate helper for projects, expose it as a `node bin/devt-tools.cjs <verb>` subcommand instead — projects should not shell out to `scripts/` directly (those are devt-internal tooling).

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

1. **Existence binding** — the artifact must exist. Validated by `fs.existsSync` or equivalent. This was the original F26-F28 contract.
2. **Freshness binding** — the artifact's mtime must postdate the current `workflow.yaml::created_at` within a 30-second grace window. Validated by `isArtifactFresh(path)`. Added after a greenfield calibration showed every existence-only gate passed against stale prior-workflow artifacts.

Gates missing either property are bypassable. Empirical evidence from the freshness retrofit: five existence-only gates produced silent passes against stale state; the one gate with mechanical reset binding (`auto-curator-considered`) fired correctly because the prior session's marker was naturally absent.

### Pattern recognition

When adding a new gate, ask explicitly: **does this check the artifact's shape, or the work behind it?** If it checks shape alone, identify a substance signal that proves the work happened:

- **For MCP-backed work** — cross-reference `_mcp-trace.jsonl` records scoped to the current `workflow_id` (the trace is the receipt). See `assertGraphifyDecision` for the reference implementation.
- **For agent-authored content** — run `state check-agent-output` against the output file (stubs, low word count, heading-only all flag as `looks_like_stub: true`). Wire the call as a bash pre-gate before the verifier dispatch.
- **For multi-step work where one step is skippable** — relocate the gate to a mandatory step, not the optional one (the F4 lesson).
- **For any artifact whose currency matters** — wire `isArtifactFresh(artifactPath)` into the gate's branch logic. Stale prior-workflow artifacts return `fresh:false` with reason "artifact mtime is Ns older than workflow.yaml::created_at — file is from a prior workflow".

### Why these gates fail closed, not advisory

LLM orchestrators under context pressure classify advisory warnings as "not load-bearing" and skip them. The pattern across all fourteen instances: a soft signal loses to perceived urgency every time. The only counterweights with observed efficacy in the field are gates that block involuntarily — either by failing the artifact contract (F26 returns `ok:false`) or by failing the workflow contract (F28 sets `verdict=FAILED`, which routes to STOP-with-BLOCKED at the existing failure terminal).

The audit instinct when reviewing devt's own gates: *if I remove the substance check, can a well-intentioned orchestrator still pass by writing prose / creating an empty file / running through the form?* If yes, the gate enforces form not substance.

---

## Cross-references

- `docs/AGENT-CONTRACTS.md` — agent + workflow contracts (consumed by these mechanisms)
- `docs/MEMORY.md` — memory layer + Pre-Flight Brief details
- `docs/HOOKS.md` — hook subsystem internals
- `docs/GRADER.md` — outcome-grader + rubric resolution
- `docs/GRAPHIFY.md` — graphify integration
- `docs/STATE-RULES.md` — `.devt/state/` filename contract
- `docs/COMMANDS.md` — user-facing command reference
