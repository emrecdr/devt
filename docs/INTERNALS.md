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
- `RESET_EXEMPT` — set of filenames preserved across `state reset`.
- `STATE_FILE_CONTRACT` — canonical filename inventory (referenced by `docs/STATE-RULES.md`).

**Validation.** `updateState()` auto-runs `validateConsistency()` (shadow mode), emits stderr warnings, and persists `validation_status` / `validation_warnings` to `workflow.yaml` on mismatch.

**Disable.** `DEVT_VALIDATE_SHADOW=0` turns off the shadow check.

**Workflow session metadata.** `updateState()` auto-stamps `created_at` (ISO-8601) and `workflow_id` (UUID via `crypto.randomUUID`) on the `active=true` transition. Idempotent — subsequent updates preserve the stamps; `resetState()` clears them so the next activation re-stamps. The stuck-detector uses `created_at` as its session boundary anchor.

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

## Cross-references

- `docs/AGENT-CONTRACTS.md` — agent + workflow contracts (consumed by these mechanisms)
- `docs/MEMORY.md` — memory layer + Pre-Flight Brief details
- `docs/HOOKS.md` — hook subsystem internals
- `docs/GRADER.md` — outcome-grader + rubric resolution
- `docs/GRAPHIFY.md` — graphify integration
- `docs/STATE-RULES.md` — `.devt/state/` filename contract
- `docs/COMMANDS.md` — user-facing command reference
