# Changelog

All notable changes to devt will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/). The `[Unreleased]` section below stages changes for the next version — when bumping, rename it to `## [X.Y.Z] - YYYY-MM-DD` so the release workflow's changelog extractor (`scripts/extract-changelog.sh`) can find it.

## [Unreleased]

## [0.17.0] - 2026-05-05

### Added
- **Optional Graphify integration** (`bin/modules/graphify.cjs`): subprocess wrapper around the `graphify` CLI binary (multi-language tree-sitter AST extractor — 26 languages). Exposes the four MCP-style helpers (`queryGraph`, `getNode`, `getNeighbors`, `shortestPath`) plus a custom `blastRadius` that aggregates neighbor counts, modules touched, AMBIGUOUS bindings, and god-node detection from `GRAPH_REPORT.md`. **Core invariant: the system is fully functional WITHOUT Graphify** — every method returns a structured `{ source, results, degraded?, error? }` payload with the four-trigger fallback (empty / error / not setup / under min_results_threshold). Setup wizard pitches Graphify as "strongly recommended" but a "no thanks" answer produces a fully working install. Honors Graphify's own config surface (`.graphifyignore`, `.graphifyinclude`, `GRAPHIFY_OUT` env var). Reads `built_at_commit` from `graph.json` for freshness checks. Detects warm-cache file with wiki-first preference (`graphify-out/wiki/index.md` → `GRAPH_REPORT.md` fallback).
- **Discovery engine** (`bin/modules/discovery.cjs`): harvests session signals into `_suggestions.md` for curator review. Sources (priority order): claude-mem ⚖️ decision and 🔵 discovery tagged entries (when claude-mem installed) → `#KNOWLEDGE-CANDIDATE` inline tags in scratchpad → `.devt/state/decisions.md` DEC-xxx entries. Each candidate carries the **full original reasoning verbatim** — no AI summarization. Filters: REJ tombstone consultation (suppresses matches silently — the "no nag" mechanism), token-overlap deduplication against existing memory docs (60% threshold). Wiki-link enrichment scans 5 surfaces (decisions.md, research.md, spec.md, learning-playbook.md, CLAUDE.md) for bare mentions of memory-doc IDs and proposes `[[ADR-xxx]]` additions. **Hard guarantee: NEVER writes a permanent `.devt/memory/{decisions,concepts,flows,rejected}/*.md` file** — that's exclusively the curator agent's role via AskUserQuestion.
- **Memory layer Phase 2 subcommands** (`bin/modules/memory.cjs` extensions): `backlinks <id>` (incoming refs — load-bearing for safe ADR supersession), `orphans` (no in/out links — surface for curator), `stale-links` (forward refs to non-existent docs), `affects-symbol <s>` (Graphify-anchored, returns `degraded=true` when disabled), `suggest` (invokes discovery engine, writes `_suggestions.md`), `migrate-lessons` (imports legacy `lessons.db` rows into the unified `.devt/memory/index.db` with doc_class='lesson' — backward-compat for one release, Phase 3 will deprecate the old DB). `promote` and `reject` subcommands route through curator workflows (no direct file writes).
- **`skills/memory-curation/SKILL.md`** (NEW, ~250 lines): the curator's promotion authority. Reads `_suggestions.md`, applies the 5-filter (Specificity, Durability, Non-obviousness, Evidence, Actionability), presents each qualified candidate via AskUserQuestion with the FULL original reasoning verbatim (no curator paraphrasing), captures the user's choice (Promote active | Promote candidate | Reject as REJ | Defer | Edit before promoting), writes the markdown, runs `memory index`. Hard invariants: no file write without AskUserQuestion approval; no bulk auto-approve; REJ search_keywords mandatory and exhaustive (curator MUST surface "Are these keywords exhaustive?" before committing).
- **`skills/graphify-helpers/SKILL.md`** (NEW, ~250 lines): canonical Graphify-first protocol for every developer skill. Documents the 4 fallback triggers, per-skill `min_results_threshold` defaults, decision tree, result tagging (`source: graphify | grep | merged`), reusable Bash snippets, and the without-Graphify feature parity table. All other dev skills consume this rather than calling Graphify or grep directly.
- **`workflows/memory-promote.md`** (NEW): curator-gated DEC → ADR/CON/FLOW promotion. Dispatches curator agent with memory-curation skill, runs `memory index` after writes.
- **`workflows/memory-reject.md`** (NEW): captures REJ tombstones with curator-verified search_keywords (the "Are these keywords exhaustive?" gate is the only thing standing between the tombstone and AI-nagging in 2 weeks).
- **34 new smoke-test assertions** covering: graphify graceful degradation, discovery engine claude-mem detection, memory backlinks/orphans/stale-links/affects-symbol, presence of all 6 new files, curator skill preload, integration sections in 11 skills + 8 workflows. Total smoke count: 43 → 77.

### Changed
- **`agents/curator.md`**: gains `skills: [devt:playbook-curation, devt:memory-curation]` preload + `AskUserQuestion` tool. Role description extends to memory-layer gatekeeping. Curator now spans both surfaces with the same 5-filter discipline.
- **`agents/retro.md`**: extended extraction — alongside operational lessons, watches for `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected]` tags so the discovery engine surfaces architectural candidates to curator.
- **`agents/researcher.md`**: consults `.devt/memory/` BEFORE recommending an approach; pre-rejects recommendations matching active REJ tombstones; tags stable findings as `#KNOWLEDGE-CANDIDATE: [type=concept]`; populates `links:` field in research.md.
- **`agents/debugger.md`**: REJ tombstone consultation is HARD RULE — proposed fixes matching tombstone search_keywords are silently filtered (the AI-nagging mitigation extends from autoskill into debug). Debug findings can promote to FLOW-xxx via curator.
- **`agents/architect.md`**: arch-review references active ADRs by id; detects Stale ADRs (path/symbol resolution failures) for curator update or supersession; suggests new ADR candidates via `#KNOWLEDGE-CANDIDATE: [type=decision]`.
- **`agents/code-reviewer.md`**: every review now produces an "ADR Compliance" section (Critical severity for violations); enumerates affected callers via Graphify when enabled; treats ADR violations same as security findings.
- **11 dev skills extended with Memory + Graphify integration sections** (Graphify-first protocol with grep fallback): `codebase-scan`, `code-review-guide`, `lesson-extraction`, `playbook-curation` (sister-skill cross-reference), `architecture-health-scanner` (Stale ADR detection), `autoskill` (REJ HARD RULE), `strategic-analysis`, `tdd-patterns`, `verification-patterns`, `complexity-assessment` (blast_radius primary input for tier selection), `semantic-search` (dual-search via unified index + Graphify).
- **8 dev workflows extended with Memory layer integration sections**: `clarify-task` (end-of-clarify offers DEC→ADR promotion + REJ pre-rejection), `specify` (PRD auto-cites related ADRs), `research-task` (researcher consults Concepts/REJs), `lesson-extraction` (extracts both lessons AND architectural candidates), `debug` (REJ-aware investigation), `code-review` (ADR Compliance Critical findings), `autoskill` (REJ consultation HARD RULE), `arch-health-scan` (Stale ADR finding type).
- **`bin/devt-tools.cjs`**: wires `graphify` and `discovery` subcommands; help text expanded with all Phase 2 entries (memory backlinks/orphans/stale-links/affects-symbol/suggest/migrate-lessons + 6 graphify subs + 3 discovery subs).

### Documentation
- **`CLAUDE.md`** Key Conventions: `graphify.*` config knob (optional, opt-in), claude-mem ⚖️/🔵 harvest mechanism, curator promotion flow, two-confidence-layer model (doc-level + per-symbol binding_confidence).
- **`docs/COMMANDS.md`**: `/devt:memory` section expanded with Phase 2 subcommands; new `/devt:memory promote` and `/devt:memory reject` documentation; `graphify` and `discovery` subcommand reference; the without-Graphify feature parity table.

## [0.16.0] - 2026-05-05

### Added
- **Memory layer foundation (`.devt/memory/`)**: permanent knowledge store for architectural decisions (ADRs), concepts (CONs), flows (FLOWs), and rejected proposals (REJ tombstones). Each doc carries strict frontmatter (`id`, `title`, `doc_type`, `status`, `confidence`, `summary`, optional `affects_paths`, `affects_symbols`, `links`, `created_at`, `created_by`, `schema_version`); REJ docs additionally carry `reason` and `search_keywords` (for future AI suppression in autoskill). Three-layer separation: `.devt/state/decisions.md` stays per-workflow ephemeral; `.devt/learning-playbook.md` stays for operational lessons; `.devt/memory/{decisions,concepts,flows,rejected}/*.md` is the new permanent architectural layer. This is Phase 1 of the multi-release Cognitive Coding Architecture v27.0 integration plan; Phase 2 (v0.17.0) wires Graphify symbol anchoring + curator-gated promotion + claude-mem ⚖️/🔵 tag harvest, Phase 3 (v0.18.0) ships the Topic Pre-Flight Brief + vendored MCP query layer, Phase 4 (v0.19.0) flips block-mode + wide-surface integration polish.
- **`bin/modules/memory.cjs`** (847 lines): pure-Node FTS5 unified index via `node:sqlite`. Atomic drop+rebuild within a single SQLite transaction (failure rolls back to prior index state). Frontmatter YAML-subset parser (handles scalars, list-of-scalars, list-of-objects). Strict per-doc-type schema validator with id-pattern enforcement (`ADR-\d{3,}` / `CON-` / `FLOW-` / `REJ-`). Query helpers: `getDoc`, `getByPath` (glob-aware), `getBySymbol`, `listActive`, `listRejectedKeywords`, `queryFTS` (prefix-matched + AND-combined tokens), `getLinks` (transitive depth-2 by default), `listDocs`, `validate` (frontmatter + path resolution + broken-link detection). Files prefixed with `_` are NEVER indexed (auto-generated reports like future `_suggestions.md`). Templates with id ending in `-000` are skipped during indexing. `links.target_id` has no FK constraint — forward references to not-yet-created docs are valid; broken links surface as warnings via `memory validate`.
- **`/devt:memory` slash command** with subcommands: `init`, `index`, `query`, `get`, `affects`, `list`, `links`, `active`, `rejected-keywords`, `validate`. Phase 2 will add `suggest`, `promote`, `reject`, `backlinks`, `orphans`, `stale-links`, `affects-symbol`. The command routes through `workflows/memory-init.md` (subcommand dispatcher, no agent dispatch).
- **`schemas/memory-doc.yaml`**: JSON Schema documentation for the four doc types. Used by `validateFrontmatter()` in `memory.cjs`, by curator agent during Phase 2 promotions, and by the discovery engine during Phase 2 wiki-link enrichment.
- **`templates/memory/{ADR,CON,FLOW,REJ}-template.md`**: scaffolding templates with the strict frontmatter and section structure. Templates are skipped during indexing (id ends in `-000`).
- **`bin/modules/state.cjs:ARTIFACT_SCHEMA`** entry for `preflight-brief.md` (status enum: `FRESH | STALE | MISSING`). Populated in Phase 3.
- **`bin/modules/state.cjs:VALID_WORKFLOW_TYPES`** additions: `memory_init`, `memory_index`, `memory_promote`, `memory_reject`, `preflight`. Routing in `workflows/next.md` will follow as Phase 2/3 ship.
- **`bin/modules/config.cjs:DEFAULTS`** new blocks: `memory: { enabled: true, preflight_mode: "off", auto_index_on_change: true }` and `graphify: { enabled: false, command: "graphify" }`. Phase 1 keeps `preflight_mode: "off"` since hooks haven't shipped; Phase 3 default flips to `"warn"`, Phase 4 to `"block"`.
- **`bin/modules/setup.cjs`**: `/devt:init` now scaffolds `.devt/memory/{decisions,concepts,flows,rejected}/` and gitignores `.devt/memory/index.db` (regenerable from markdown — never commit). The four ADR/CON/FLOW/REJ subdirs ARE intentionally committed (team-shared architectural truth).
- **13 new smoke-test assertions** covering: scaffolding, atomic rebuild, `_*` skip behavior, FTS5 prefix matching, glob-based affects, REJ tombstone keywords, validation errors on missing required fields, deterministic retrieval (rebuild on unchanged state produces identical doc set).

### Changed
- Smoke-test count: 30 → 43 passing.

### Documentation
- **`docs/COMMANDS.md`**: new `/devt:memory` section with full subcommand reference.
- **`CLAUDE.md`** Key Conventions: documents the three-layer memory architecture (state/playbook/memory) and notes that Phase 1 is data-layer-only (no agent integrations yet — those land in Phase 2+).

## [0.15.0] - 2026-05-05

### Changed
- **`/devt:council` advisors now produce structured, research-grounded output**: every advisor response follows a fixed format — `## Options Considered`, `## Recommendation`, `## Validated Reasoning` (numbered claims with `Evidence:` citations to specific files, rules, research findings, or codebase patterns), and an optional `## Unvalidated Concerns` (claims the advisor suspects but cannot ground in available material, tagged `[speculation]`). Advisors are now explicitly instructed to **actively investigate** using Read/Grep/Glob before forming claims — the Validated Reasoning section presents the **outcomes** of those investigations rather than generic takes filtered through a persona lens. The prompt suggests perspective-specific investigation patterns (Contrarian greps for prior bugs/TODOs/incident history; First Principles reads the existing API contract; Generalizer globs for similar modules; Newcomer reads entry points and onboarding docs; Pragmatist scans recent commits to gauge typical PR size). Free-form prose is a regression — advisors are re-dispatched if they skip the structure. Peer review (Stage 3) gains a fourth question explicitly scoring evidence-quality across the five anonymized responses. Chairman synthesis (Stage 4) gains two new verdict sections — `## What Grounded the Verdict` (specific evidence cited across multiple advisors backing the recommendation) and `## Where the Council Speculates` (consequential Unvalidated Concerns + the artifact or check that would convert each from speculation to validated reasoning) — and explicitly weights Validated Reasoning over Unvalidated Concerns when adjudicating disagreement. Word budget bumped from 150-300 to 250-400 per advisor (structure + investigation outcomes cost words; that's fine — without the bump advisors compress claims into unsupported one-liners). Behavior change for existing users: verdicts become more evidence-anchored and less rhetorical, advisors investigate before reasoning, and unvalidated speculation is flagged explicitly instead of disguised as conviction.

### Added
- **Council offramp integrated into brainstorming workflows** (`/devt:clarify`, `/devt:research`, `/devt:specify`): when a gray area or open question trips a 3-condition threshold — **multiple viable approaches** AND **hard to reverse** AND **high stakes** — the workflow offers `/devt:council` as one of the resolution options in its `AskUserQuestion` list, alongside the standard pick-A/B and defer paths. Threshold, template, and capture rules live in a new shared reference (`references/council-offramp.md`) so future tweaks don't require touching three workflow files. Soft cap of 1 council invocation per workflow session prevents cumulative time blowup. Council never auto-invokes — always offered as one option. Verdict is captured back into the calling workflow's primary artifact: `clarify` writes a new `DEC-xxx` entry in `.devt/state/decisions.md` referencing the transcript; `research` appends a `## Council Verdict on {decision}` section to `.devt/state/research.md`; `specify` adds a Decisions entry to the PRD plus a `DEC-xxx`. Each workflow passes caller-specific `validation_material` paths into the council framing so advisors ground their reasoning in the right artifacts (e.g. research caller passes `research.md`; specify caller passes the in-progress `spec.md`).
- **`references/council-offramp.md`** — new shared reference document encoding the threshold (§1, AND-of-three test), offramp template (§2, the AskUserQuestion options block), invocation/capture protocol (§3 with caller-specific validation_material map and capture format per workflow), anti-patterns (§4, including the soft cap and re-running guard), and when to use `strategic-analysis` instead of council (§5).

### Documented
- **`docs/COMMANDS.md` `/devt:council` section**: now documents the structured advisor output contract (Options + Validated Reasoning + Unvalidated Concerns), the chairman verdict's expanded 7-section structure (was 5), and the offramp integration with the three brainstorming workflows.

## [0.14.0] - 2026-05-05

### Changed
- **Golden Rule 5 reframed: Boy Scout Rule → Surgical Changes**, with explicit Find-Surface-Decide protocol for unrelated findings. The old rule told agents to "leave code cleaner than you found it" which gave them license for silent drive-by edits — a known LLM failure mode that bloats diffs and obscures the real change. The reframed rule scopes cleanup to orphans the agent's own changes create, and routes any unrelated improvements through a 4-step protocol: **Find** (note the file + one-line description), **Surface** (present as a side-finding, not a fait accompli), **Decide** (ask the user whether to fix-now / split-into-follow-up / record-in-summary), then act on the choice. Failure mode named explicitly: "I noticed it, I should fix it" is now an opt-in behavior, not a default. Adapted from [Andrej Karpathy's observations on LLM coding pitfalls](https://x.com/karpathy/status/2015883857489522876) via [@forrestchang's andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills).
- **All 5 project templates updated**: `templates/{blank,go,python-fastapi,typescript-node,vue-bootstrap}/golden-rules.md` Rule 4 (the project-scoped twin of plugin Rule 5) now mirrors the Surgical Changes framing with stack-specific examples (ESLint/golangci-lint/ruff/etc.). `templates/vue-bootstrap/coding-standards.md` parenthetical updated. The vue-bootstrap legacy Options API → `<script setup>` conversion remains explicitly pre-approved at the project level — that's a documented exception, not a license for general drive-by edits.

### Added
- **`scope_mode` config knob (`bin/modules/config.cjs`)**: defaults to `"surgical"` (Find-Surface-Decide for any unrelated finding). Project owners can set `scope_mode: "boyscout"` in `.devt/config.json` to grant blanket cleanup authority for small mechanical issues — dead imports, lint warnings, typos in comments, formatting — within files agents are already editing, without invoking the protocol. Anything larger (refactors, behavior changes, cross-file cleanups) still goes through Find-Surface-Decide regardless of mode. Resolved through the existing 3-level merge (defaults ← `~/.devt/defaults.json` ← `.devt/config.json`); surfaced to agents via the standard `init` payload — no enforcement code, declarative-only like the rest of devt's config surface.
- **Golden Rule 12 — Surface Assumptions Before Implementing `[CRITICAL]`**: agents must state non-trivial assumptions explicitly and present interpretations rather than picking one silently when a task is ambiguous. Targets the most expensive failure mode in AI-assisted coding: silent assumption + plausible-looking output for the wrong problem.
- **Golden Rule 13 — Minimum Viable Implementation `[WARNING]`**: complement to existing Rule 8 (Complexity/Benefit Evaluation). Where Rule 8 targets defensive over-engineering (try/catch, redundant validation), Rule 13 targets scope creep and speculative features (unrequested config knobs, generic abstractions for one caller, "we might need this later" plumbing). The senior-engineer test: would a careful reviewer say this is overcomplicated? If yes, simplify.

### Documented
- **`CLAUDE.md` — `scope_mode` config field**: noted under Key Conventions so future contributors discover the field without reading the rule body.

## [0.13.0] - 2026-04-30

### Added
- **`/devt:council` slash command + `council` skill (Karpathy LLM Council adapted for engineering)**: pressure-test high-stakes engineering decisions through 5 advisors with distinct thinking styles (Contrarian / First Principles / Generalizer / Newcomer / Pragmatist) that analyze in parallel, peer-review each other anonymously, and pass to a chairman for synthesis. Adapted from [@tenfoldmarc's LLM Council skill](https://github.com/tenfoldmarc/llm-council-skill); methodology by [Karpathy](https://github.com/karpathy/llm-council). Retuned for engineering trade-offs (architecture choices, refactor strategies, API design, contentious code-review feedback) and integrated with devt conventions: auto-pulls `.devt/rules/{architecture,coding-standards,golden-rules}.md` for context, writes markdown transcripts to `.devt/state/council-{slug}-{timestamp}.md` (no HTML — engineering tooling, integrates with `/devt:plan` and `/devt:clarify` downstream), expands trigger phrases with engineering-specific cues (`red team this`, `audit this approach`, `devil's advocate`, `second opinion`), and adds an opt-in `--mixed-models` flag that dispatches advisors across opus/sonnet/haiku via the Task tool's `model` parameter for genuine reasoning diversity (closer to Karpathy's original cross-vendor design). Chairman synthesis uses `model: opus` when available — chairman quality dominates the verdict per Karpathy's principle. Anonymization order is randomized every session to remove positional bias on top of identity bias. Skill total: 16 directories (was 15); commands: 29 entry points (was 28).

## [0.12.0] - 2026-04-28

### Changed
- **Permissive `allowed-tools` extended**: all 15 skills now also pre-allow `WebFetch`, `WebSearch`, `Skill`, and `Task` on top of the prior `Bash Read Write Edit Grep Glob` baseline. Lets skills cross-invoke each other, spawn subagents, and fetch web content without per-call permission prompts while the skill is active. Defense-in-depth for users whose project `.claude/settings.json` is more restrictive than the permissive default scaffolded by `setup.cjs`.
- **Project `.claude/settings.json` scaffold parity**: `setup.cjs` now also pre-allows `Skill` and `Task` at the project level, mirroring the per-skill `allowed-tools` superset so end-users running `/devt:init` no longer hit a prompt the first time a skill cross-invokes another skill or spawns a subagent.
- **`architecture-health-scanner` runs in a forked subagent context**: skill frontmatter now declares `context: fork` with `agent: general-purpose`. The scanner-triage workflow reads many source files to verify findings (per the skill's "NO CLASSIFICATION WITHOUT READING THE ACTUAL CODE" iron law), so isolating it from the main conversation context prevents the heavy file reads and intermediate analysis from polluting the caller's context — only the prioritized remediation plan returns. Skill still has the explicit Steps 1-7 task structure that the docs require for fork-mode skills to produce meaningful output.

### Fixed
- **`setup.cjs` path-traversal hardening (CWE-22)**: `copyDirRecursive` and `copyMissingFiles` now reject suspicious entry names (separators, traversal markers, null bytes, symlinks) and validate each filesystem entry through `validatePath` from `security.cjs` before any `fs.copyFileSync` or recursive descent. `setupProject` additionally validates the resolved templateDir stays within `pluginRoot/templates` as defense-in-depth even though `templateName` is allowlisted upstream. Same hardening pattern that was applied to `scanDevRules` in v0.9.1, extended to the template-copy machinery. Reduces semgrep CWE-22 findings on this file from 12 to 3 (remaining flags are on hardcoded infrastructure paths where inputs are not externally controllable). No behaviour change — the smoke check that exercises `setup --template python-fastapi` end-to-end (mixed-extension copy with `arch-scan.py` + rules markdown) continues to pass.

## [0.11.0] - 2026-04-28

### Added

- **Native subagent frontmatter adoption**: devt now uses the platform-native `memory:`, `skills:`, and `allowed-tools:` fields documented at code.claude.com instead of prose-driven knowledge management.
  - `memory: project` on `code-reviewer`, `debugger`, `retro`, `curator` — each agent writes to `.claude/agent-memory/devt-<agent>/MEMORY.md` (auto-injected at startup, gitignored). Persistent across sessions, scoped per project.
  - `skills:` preload on `programmer` (devt:codebase-scan), `code-reviewer` (devt:code-review-guide), `verifier` (devt:verification-patterns) — the full skill body is injected into the agent's system prompt at spawn, eliminating the "agent forgot to invoke its primary skill" failure mode. Empirically validated via signature-phrase probe.
  - `allowed-tools: Bash Read Write Edit Grep Glob` on all 15 skills (api-docs-fetcher also gets `WebFetch WebSearch`). Eliminates per-invocation permission prompts for routine dev operations while a skill is active.
  - `paths:` glob on `tdd-patterns` so the platform auto-activates the skill when Claude touches test files (Python `test_*.py` / `*_test.py`, JS/TS `*.test.*` / `*.spec.*`, Go `*_test.go`, and `test/spec` directories).

- **Single-plugin marketplace** (`.claude-plugin/marketplace.json`): turns this repo into a self-hosting marketplace so end-users can install with `/plugin marketplace add emrecdr/devt && /plugin install devt`. Marketplace points at the same repo via `source: "./"`; version stays in lock-step with `plugin.json`. Before: install required `git clone` + `claude --plugin-dir ~/.devt` and the agents would not register without the flag. After: `/plugin install` registers all 10 plugin agents under the `devt:` namespace and supports `/plugin update`.

- **`.claude/settings.json` scaffolding in `setup.cjs`**: project init now writes a permissive starter at `.claude/settings.json` (only when absent — never overwrites). Pre-allows `Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob`, `WebFetch`, `WebSearch`; gates only genuinely destructive operations (`rm -rf`, `git push --force`, `git reset --hard`, `npm publish`, `yarn publish`, `pip install`) behind `permissions.ask`.

### Changed

- **Debugger knowledge base location**: persistent debug findings now write to `.claude/agent-memory/devt-debugger/MEMORY.md` (the native agent-memory path) instead of `debug-knowledge-base.md` at project root. Before: the project-root file was the only persistence layer and required prose instructions in the agent body to read/write it. After: the platform auto-injects the first 200 lines of `MEMORY.md` into the debugger's system prompt at startup, and the agent has Read/Write auto-enabled on its own memory directory. Legacy `debug-knowledge-base.md` is still read for backwards compatibility — pre-migration entries remain accessible — but new writes go to the native location only. Touchpoints updated: `agents/debugger.md`, `workflows/debug.md`, `docs/COMMANDS.md`, `CLAUDE.md`.

- **`setup.cjs` gitignore handling**: now adds `.claude/agent-memory/` alongside `.devt/state/` when initialising a project. Per-project agent memories should never be committed regardless of the project's prior gitignore state.

### Documented

- **`CLAUDE.md` — Plugin loading invariants**: three non-obvious platform behaviours documented inline so future Claude sessions understand the architecture before debugging "missing agent" symptoms:
  - Plugin agents register only when devt is loaded via `claude --plugin-dir <path>` or installed through the plugin system. Sessions that rely solely on cwd-auto-discovery see commands and skills but `devt:<agent>` subagents will not appear in `claude agents`.
  - Agent persistent memory writes to `.claude/agent-memory/devt-<agent>/MEMORY.md` (hyphen replaces colon for filesystem safety).
  - Agent `skills:` preload requires the `devt:` namespace prefix (`skills: [devt:codebase-scan]`); the plain skill name silently fails to inject. Plugin agents also do not honour `permissionMode`, `hooks`, or `mcpServers` (security restriction — silently ignored by the platform).

- **README install section rewrite**: marketplace install promoted to "recommended" path with explicit `/plugin marketplace add` + `/plugin install` flow. Git-clone + `--plugin-dir` retained as the development path with notes about why agent registration depends on the loading mechanism.

## [0.10.0] - 2026-04-28

### Added
- **arch-scan.py skips `.devt/` directory**: when deployed at `.devt/rules/arch-scan.py`, the scanner would have audited itself plus `.devt/` scaffolding. Added `.devt` to the skip list (alongside existing `.venv`, `__pycache__`, `node_modules`, etc.) so the scanner only audits real project source. Also fixes inline-import detection inside class methods (visit_ClassDef now recurses into method bodies — previously `def` children of classes were skipped, so inline imports inside repository methods were missed)
- **Smoke check for `setup --template python-fastapi`**: existing check only exercised `--template blank`. The new check uses an isolated temp dir (so the smoke's earlier `init workflow` doesn't pollute the project-root walk) and asserts BOTH `.devt/rules/arch-scan.py` AND `.devt/rules/coding-standards.md` are present after setup, exercising the mixed-extension copy path. Suite now 24 checks
- **Reference Python arch scanner**: `templates/python-fastapi/arch-scan.py` ships a slim, generic, stdlib-only Clean-Architecture scanner (~290 lines). Detects 6 categories: `LAYER-IMPORT-DOMAIN` (domain importing from outer layers), `LAYER-IMPORT-API` (api reaching past application into infrastructure), `DB-IN-APPLICATION` (raw `Session`/`select` import in application layer), `INLINE-IMPORT` (function-body imports — circular-dep smell), `GOD-FILE` (configurable line cap, default 600), `GOD-CLASS` (configurable method cap, default 25). Output: human-readable text or `--json` for the architect agent. Exit codes are gated by `--fail-on` (default: critical+high). `--disable=CAT,CAT` skips categories; `--service-root` and `--max-*` thresholds tune to non-greenfield layouts. Deploys to `.devt/rules/arch-scan.py` via the existing template-copy machinery — wire into `.devt/config.json` as `"arch_scanner": { "command": "python3 .devt/rules/arch-scan.py --json" }`. Smoke suite gains 2 checks (clean project = 0 findings + exit 0; dirty project = critical + high findings + exit 1); now 23 checks
- **Parallel quality gates**: `scripts/run-quality-gates.sh` now recognizes a `parallel` info-string on fenced bash blocks (` ```bash parallel `). Consecutive parallel-tagged blocks group into one batch and run concurrently; sequential blocks force-flush any pending batch first. Each block's stdout/stderr is captured to a temp file and replayed in submission order so output stays per-gate readable. Failures in a parallel block correctly fail the batch (exit non-zero, FAIL count increments). Existing security validation (allowlist, no shell metacharacters) applies per-block unchanged. `templates/python-fastapi/quality-gates.md` now ships with ruff-check / ruff-format-check / mypy as a 3-block parallel batch and pytest as the trailing sequential gate — read-only checks parallelize, mutating checks moved to a "Fix Helpers" section that is explicitly NOT run by `/devt:quality`. Smoke suite gains 2 checks (parallel batch concurrency + failure propagation); now 19 checks
- **`semantic query` filter flags**: `--min-importance=N`, `--min-confidence=F`, `--category=NAME`, `--tags=a,b,c`, `--limit=N`. Filters apply *after* FTS5 ranking (over-fetching capped at 200) so match quality is preserved. Unknown flags and out-of-range values (e.g. `--min-importance=99`) are rejected with a clear error. Output now includes a `filters` field echoing what was applied. The grep fallback honors the same filters. `dev-workflow.md` step `context_init` defaults to `--min-importance=6 --limit=8` so injected `learning_context` stays high-signal — agents read fewer, more relevant lessons. Smoke suite gains 3 checks (no-playbook filtered query, unknown-flag rejection, out-of-range rejection); now 17 checks
- **Tag-driven GitHub releases**: `.github/workflows/release.yml` fires on `v*` tag push, extracts the matching `CHANGELOG.md` section, and creates a GitHub release with those notes. Idempotent — skips cleanly if a release already exists. Pre-release tags (containing `-`) are flagged accordingly. All step-output values pass through `env:` to prevent shell injection from maliciously named tags
- **`scripts/extract-changelog.sh`**: AWK-based extractor that pulls a single version's section out of `CHANGELOG.md`. Used by the release workflow and the CI coverage check. Exits non-zero if the version is not found
- **CI CHANGELOG coverage check**: `manifest-version-coherence` job in `ci.yml` now fails if `VERSION` is bumped without a matching `## [X.Y.Z]` section in `CHANGELOG.md`. Stronger contract than the README-badge check it replaces
- **README badges**: dynamic version badge (reads from GitHub Releases API), CI status badge, Node 22+ badge, Changelog badge, License badge. The dynamic version badge self-validates — no static value to keep in sync

### Changed
- **CI version coherence**: dropped the README-badge string check (the new dynamic shields.io badge reads from the GitHub API, so there's nothing to drift). Coherence is now enforced between `VERSION` and `plugin.json` only

### Fixed
- **Silent data loss in `semantic.cjs` playbook parser**: `parsePlaybook` regex required lines to start with a word character, so YAML-list entries (`- description: ...`, the format shown in `schemas/learning-entry.yaml`'s example) were silently dropped at sync time. Sync would report `synced: N` based on entries the parser actually understood; entries written in the schema's documented format vanished without warning. Parser now strips an optional leading `- ` before key matching, so both `- key: value` and `key: value` are accepted. No migration needed — existing playbooks that already worked still work, and any retro/curator output following the schema literally will now sync. New smoke check guards against regression
- **`/devt:quality` was broken on 3 of 5 stack templates**: `templates/{go,typescript-node,vue-bootstrap}/quality-gates.md` shipped "Quick Reference" / "Running All Gates" blocks tagged ` ```bash ` containing `&&`-chained commands. The runner's security validator (correctly) rejects shell metacharacters, so these aggregator blocks always failed with a misleading "command not in allowlist" message — masking the real gate results above them. Aggregator blocks retagged ` ```text ` so the runner skips them as documentation while humans can still copy-paste. The runner's rejection messages now distinguish "shell metacharacter — split into separate gates" from "command prefix not in ALLOWED_PREFIXES", so future violations point at the actual problem. New smoke check confirms both rejection reasons surface correctly
- **`arch_scanner` docs/config drift**: `README.md` claimed the default for `arch_scanner` was "built-in scanner", and `.devt-config.json.example` referenced `uv run python scripts/arch_scanner.py` — but devt does not ship a scanner script, so copying the example into a project would surface a "command not found" at scan time. README now states `command: null` is the real default and explicitly says devt does not ship a built-in scanner; example config sets `command: null` with a comment explaining users provide their own (e.g. `make arch-scan`, `npx ts-arch`). The architect agent already falls back to manual Grep/Glob analysis when no scanner is configured — that path was already correct, only the docs lied

### Documented
- **Release flow**: `CLAUDE.md` and `README.md` document the tag-driven release process (commit + push → tag + push → release auto-created)
- **Backfilled GitHub releases**: v0.9.0, v0.9.1, v0.9.2, v0.9.3 now have proper GitHub releases at their original commit SHAs

## [0.9.3] - 2026-04-27

### Added
- **Smoke suite CLI coverage**: `scripts/smoke-test.sh` now exercises all 9 CLI subcommands. Before: `init`, `state`, `config`, `models`, `update` (5 of 9). After: adds `health`, `semantic status`, `report window`, `setup --template blank` — closes silent-regression gap on 4 untested subcommands. Suite goes from 11 to 16 checks
- **Agent size-budget guard**: smoke suite enforces a 500-line hard cap on `agents/*.md` files. Largest agent at release is 387 lines, so the check is forward-looking — it prevents agent prompt bloat without forcing any current cleanup. Bump deliberately if a new agent legitimately needs more

### Documented
- **Agent budget convention**: `CLAUDE.md` Key Conventions now states the 500-line agent limit and rationale (extract sub-skills or references when a prompt grows past the cap)

## [0.9.2] - 2026-04-27

### Added
- **CI smoke suite**: `scripts/smoke-test.sh` exercises 11 CLI checks (manifest parse, init/state/config/models/update return JSON, 50 KB cap rejection, concurrent locking) in a temp project. Wired into `.github/workflows/ci.yml` across Node 22 and 24
- **CI version coherence check**: GitHub Actions job asserts `VERSION`, `plugin.json` `version`, and the README badge stay in lock-step. Drift fails the build
- **CI workflow_type registry check**: Asserts every entry in `VALID_WORKFLOW_TYPES` has a routing rule in `next.md`, preventing the kind of drift that would silently break resume after pause
- **Concurrent locking test**: New `scripts/test-locking.cjs` spawns 20 parallel writers against a shared `workflow.yaml` and asserts no lost updates and no orphaned `.lock` file. Documents that `acquireLock` / `releaseLock` (`bin/modules/state.cjs:326-389`) actually serialize. Runs in the smoke suite

### Documented
- **Memory-skill boundary**: `skill-index.yaml` header now distinguishes `scratchpad` (ephemeral, within-workflow, resets between runs) from `lesson-extraction` (permanent, cross-workflow, scored playbook entries) at the orchestrator-facing layer. Before: the boundary was only inside each `SKILL.md`. After: an editor adding a third memory skill sees the routing rule before they pick a name

## [0.9.1] - 2026-04-27

### Added
- **Task length cap**: `init.cjs` now rejects task descriptions over 50 KB with a clear error. Defense-in-depth against accidental prompt bloat from oversized inputs
- **Hook profile reference**: `CLAUDE.md` now includes a table mapping every hook script to the `minimal`/`standard`/`full` profiles, so users no longer need to read `run-hook.js` source to understand which hooks fire

### Changed
- **`scanDevRules` hardening**: Now uses `validatePath` from `security.cjs` for confinement, skips symlinks and dotfiles, rejects names containing path separators. Resolves long-standing semgrep CWE-22 warnings on the recursive directory walk
- **`ARTIFACT_SCHEMA` comment honesty**: Rewrote the comment in `state.cjs` to enumerate the schema's intentional scope. Before: claimed only 3 artifacts were excluded. After: explains that ~18 artifacts (JSON/YAML state, persistent cross-phase artifacts, free-form markdown) are excluded by design — only markdown artifacts with `## Status:` lines that drive routing belong here

### Documented
- **`quality-gate-verifier.md` is opt-in**: Clarified in `CLAUDE.md` that this is a per-project template projects wire into their own `.claude/settings.json`, not auto-registered in `hooks.json`
- **`skills-workspace/` purpose**: Added one-line mention that this directory holds autoskill trigger-evaluation fixtures (already gitignored)
- **Enforce-mode roadmap**: Added a `TODO (post-1.0)` comment in `state.cjs` documenting the future `DEVT_VALIDATE_ENFORCE=1` mode that would block on shadow-validation mismatches instead of just warning

## [0.9.0] - 2026-04-27

### Added
- **`<self_check>` on 7 agents**: code-reviewer, architect, verifier, docs-writer, retro, curator, researcher — agents now self-verify outputs before completion
- **`<deviation_rules>` on 7 agents**: standardized escalation when agents detect issues outside their lane. READ-ONLY agents (code-reviewer→NEEDS_WORK, architect→BLOCKED, verifier→FAILED, researcher→NEEDS_CONTEXT, retro→DONE_WITH_CONCERNS) report-don't-fix; SCOPED-WRITE agents (docs-writer, curator) get bounded auto-fix authority
- **Artifact content schema validation**: `state.cjs` extracts and validates `## Status:` lines against per-artifact whitelists. New mismatch reasons: `invalid_status`, `no_status_line`, `unreadable`, `missing`
- **Shadow-mode state validation**: `state update` auto-runs `validateConsistency` and emits stderr warnings on mismatch. `_validation` attached to the JSON response. Disable with `DEVT_VALIDATE_SHADOW=0`
- **Persisted validation flag**: `workflow.yaml` now persists `validation_status="warned"` and `validation_warnings=N` when content-schema mismatches are detected. `next.md` routing surfaces the flag so resume can react to it. Cleared actively when an update has zero mismatches
- **Specify ambiguity score**: `specify` step 5 computes a 5-dimension 0-10 ambiguity score (placeholder scan, internal consistency, scope focus, ambiguity, completeness — 0-2 each). Soft-gate `AskUserQuestion` at <8 lets the user refine or accept-and-proceed before the spec is finalized

## [0.8.2] - 2026-04-25

### Fixed
- **CLAUDE.md docs audit**: Added missing `scratchpad.md` artifact to state flow documentation, added 5 undocumented `update` subcommands (local-version, install-type, dirty, clear-cache, changelog), expanded `update.cjs` module description

## [0.8.1] - 2026-04-24

### Fixed
- **Parameterized SQL in semantic.cjs**: Replaced string-interpolated DELETE with `db.prepare().run()` in compact — consistent with INSERT which already used prepared statements
- **syncState consistency**: Refactored workflow_type inference to scan INPUT_ARTIFACTS into `foundSet` — all artifact checks now go through one mechanism instead of mixing `foundSet.has()` with ad-hoc `existsSync`
- **Silent skip on malformed state args**: `state update` now warns when key=value pairs lack `=` instead of silently skipping

### Added
- **W014 health check**: Validates `next.md` routing table covers every entry in `VALID_WORKFLOW_TYPES` — prevents drift when adding new workflow types
- **PHASE_ARTIFACT_MAP / INPUT_ARTIFACTS documentation**: Comments now explain the design boundary (phase-ordered vs cross-workflow) and document artifact origins

## [0.8.0] - 2026-04-17

### Added
- **`--tdd` flag**: Test-driven development mode for dev workflow — reverses implement/test phase order, auto-injects tdd-patterns skill into programmer and tester agents
- **`--dry-run` flag**: Preview the workflow pipeline (tier, steps, agents, models) without executing any agents
- **Acceptance criteria gate**: STANDARD+ tiers check for spec.md with acceptance criteria before implementation — options to define now, auto-derive, or skip verification
- **Enhanced statusline**: Compact format showing tier, phase, iteration, active flags, and task in `UserPromptSubmit` hook. Idle state shows last workflow context.
- **`state prune` subcommand**: Remove orphaned artifacts from `.devt/state/` using `PHASE_ARTIFACT_MAP`. Supports `--dry-run` for safe preview.
- **Tier-based context limiting**: SIMPLE/STANDARD tiers load only relevant state artifacts into agent prompts, reducing context waste

## [0.7.0] - 2026-04-06

### Added
- **JSONC config support**: `readJsonSafe` now strips `//` and `/* */` comments before parsing — config files can include inline documentation
- **Model alias resolution**: `MODEL_ALIAS_MAP` maps short names (opus/sonnet/haiku) to full Anthropic model IDs. New CLI subcommands: `models resolve`, `models list`, `models table`
- **Strict injection scanning**: Shannon entropy analysis for encoded payloads, URL-encoded (`%XX`) and HTML entity (`&lt;` / `&#xNN;`) decode-and-rescan, zero-width Unicode character detection
- **State sync recovery**: `devt-tools state sync` reconstructs `workflow.yaml` from artifact presence on disk — recovery mechanism for corrupted or missing state
- **Phase control flags**: `--to <phase>`, `--only <phase>`, `--chain` for granular autonomous workflow control. New state keys: `stop_at_phase`, `only_phase`
- **Read-before-edit guard hook**: Advisory `PreToolUse` hook reminds agents to read files before editing (async, non-blocking)
- **Domain probes reference**: Structured probing techniques for uncovering domain unknowns, consumed by specify and clarify workflows
- **Severity-tagged golden rules**: `[CRITICAL]`, `[WARNING]`, `[STYLE]` severity levels on all 11 rules for prioritization under turn pressure
- **Researcher provenance tagging**: Every claim requires `[codebase: file:line]`, `[docs: URL]`, or `[inference]` source tags
- **Verifier later-phase awareness**: Level 5.5 filters gaps explicitly deferred to later phases, annotated as `[DEFERRED]` (informational, does not downgrade verdict)
- **Playwright E2E patterns**: Visual regression, accessibility testing, network inspection, locator strategy, and MCP integration sections in typescript-node and vue-bootstrap templates
- **Prompt injection scan**: URL-encoded injection detection (category 7) and Cyrillic homoglyph/lookalike detection (category 8)
- **References directory**: New `references/` supporting layer documented in CLAUDE.md

### Fixed
- **`PHASE_ARTIFACT_MAP` arch_health mismatch**: `arch_health` was mapped to `arch-review.md` (belongs to `architect` phase) — corrected to `arch-health-scan.md` and added `architect` entry
- **`HTML_NAMED_ENTITIES` per-call allocation**: Hoisted from function body to module-level constant in security.cjs
- **Pre-ES2021 `split().join()` idiom**: Replaced with `replaceAll()` in `decodeHtmlEntities` (project requires Node 22+)
- **`syncState` redundant early check**: Removed `existsSync` guard that contradicted subsequent `ensureStateDir()` call
- **Read-before-edit hook blocking**: Changed from `async: false` to `async: true` — advisory hooks should not block tool execution

## [0.6.0] - 2026-04-06

### Added
- **Vue-bootstrap template**: form handling (ref + error object), permission-based rendering (computed + authStore), toast composable wrapper, shallowRef vs ref guidance, multi-env config, legacy Options API migration note
- **Vue-bootstrap template**: UI/UX quality standards (WCAG 2.2 AA: touch targets, focus states, contrast ratios, reduced-motion), responsive design checklist, diagnostic grep commands
- **Vue-bootstrap template**: 6 new code smells (div-as-button, missing loading states, stale permission checks, empty states, hardcoded transitions, direct toast calls)
- **Vue-bootstrap template**: architecture additions (constants 4-file pattern, API client architecture, theme/layout system)
- **All 15 skills**: "When NOT to Use" sections, time budget hints, concrete examples for edge cases
- **State validate/sync**: `devt-tools state validate` cross-references state claims against actual artifact files — detects drift when sessions drop mid-workflow (W013 health check)
- **Research gate**: planning blocks when research has unresolved open questions — presents them for resolve/defer/proceed decision
- **Scope reduction detection**: verifier Level 5 extracts every requirement from spec/plan, flags omissions as SCOPE_REDUCED forcing GAPS_FOUND verdict
- **Claim provenance tagging**: programmer, tester, code-reviewer artifacts now include Agent/Model/Timestamp provenance — verifier treats provenance-tagged claims as self-reported
- **Prompt injection defense**: 10→20 patterns covering forget-instructions, act-as, system prompt extraction, `<<SYS>>` markers, exfiltration, tool manipulation. Added strict mode (zero-width Unicode, prompt stuffing) and `sanitizeForDisplay()`
- **Atomics.wait lock**: replaced CPU-spinning busy-wait with `Atomics.wait()` for lock retry — blocks thread without burning cycles
- **Config key warnings**: `getMergedConfig()` warns on unknown keys in `.devt/config.json` (catches typos like `agent_skils`)
- **Questioning guide**: "The Goal" framing, concrete AskUserQuestion examples, option modification tip, expanded freeform rule with wrong/right pairs, decision gate pattern, 2 new anti-patterns
- **Model profiles**: `devt-tools models table [profile]` renders box-drawn agent→model table for diagnostics
- **Autonomous chain flag**: `--autonomous` workflows auto-advance to `/devt:ship` after completion; stale flag cleared on manual invocation
- **Parallel docs + retro**: docs-writer and retro agents now dispatch simultaneously (independent outputs), saving ~30-60s per STANDARD workflow
- **All 15 skills**: optimized descriptions for triggering accuracy with explicit trigger phrases and negative boundaries

### Fixed
- **UserPromptSubmit hook error**: `workflow-context-injector.sh` emitted empty line when no workflow was active, causing Claude Code to fail JSON parsing — now outputs nothing when idle
- **Stale `stopped_at`/`stopped_phase` on resume**: all 10 workflows now clear these fields when setting `active=true`, preventing misleading session-start banners and false W006 health alerts
- **`next.md` missing post-implementation routes**: added routing for impl-summary without review (→ `/devt:review`) and review with NEEDS_WORK verdict (→ resume `/devt:workflow`)
- **Missing `<agent_skills>` in 2 dispatch templates**: `debug.md` debugger and `create-plan.md` architect dispatches now include skill injection tag
- **`specify.md` decisions format**: extracted decisions now use DEC-xxx ID format matching `clarify-task.md`, enabling cross-workflow traceability
- **Quick-implement stale comment**: review iteration comparison updated from "vs 3" to "vs 5 (RETRY/DECOMPOSE/PRUNE)"
- **Verifier status enum incomplete**: added `DONE_WITH_CONCERNS` to formal output format (was already produced via turn-limit awareness but undocumented)
- **`next.md` NEEDS_WORK route accuracy**: corrected misleading "resume at implement phase" — workflow restarts from context_init, not mid-phase
- **`next.md` APPROVED_WITH_NOTES**: merged with APPROVED route — both are ship-ready verdicts
- **`next.md` unreadable verdict**: added route for interrupted/partial review.md with user prompt
- **Stale `verdict`/`repair`/`verify_iteration` on fresh workflow**: dev-workflow and quick-implement now reset these fields in context_init to prevent carry-over from prior runs
- **Hook `echo` portability**: replaced `echo "$RESULT"` with `printf '%s\n'` to avoid flag interpretation risk
- **`agent_skills` placeholder inconsistency**: normalized debug.md and create-plan.md to use the standard placeholder text

## [0.2.1] - 2026-03-31

### Added
- **Simplify workflow phase** (STANDARD + COMPLEX tiers): runs `/simplify` (3 parallel review agents for reuse, quality, efficiency) after tests pass, re-runs quality gates to verify, then proceeds to code review
- Programmer agent self-review now includes explicit simplification pass (reuse, redundancy, over-engineering, dead code checks) integrated into the `<self_review>` section
- `effort` field on all 10 agents: `high` for critical agents (programmer, tester, code-reviewer, verifier, architect, debugger), `medium` for support agents (docs-writer, retro, curator, researcher)
- State tracking (`active=true`, `phase`, `status=IN_PROGRESS/DONE`) added to standalone workflows: `debug.md`, `lesson-extraction.md`, `arch-health-scan.md` — enables `/devt:status` and `/devt:next` resume detection
- `<deviation_rules>` block added to `create-plan.md` (was the only workflow missing it)
- Programmer agent now reads `guardrails/generative-debt-checklist.md` — BEFORE/DURING/AFTER coding gates
- Tester agent now reads `guardrails/golden-rules.md` — scan-before-implementing applies to test code
- Code-reviewer agent now reads `guardrails/golden-rules.md` — reviews against universal rules
- `scripts/run-quality-gates.sh` and `scripts/check-docs.sh` moved from `harness/` to `scripts/` and wired into quality-gate-verifier

### Fixed
- **`run-hook.js` silent hook bypass**: spawn failure or timeout (status=null) now detected via `result.error` check and exits with code 1 instead of silently succeeding. Uses `??` instead of `||` for null-safe exit code
- **`semantic.cjs` crash on Node < 22.5**: `require("node:sqlite")` wrapped in try/catch with friendly error message showing required version
- **`security.cjs` dead code**: wired into `init.cjs` — task descriptions are now scanned for prompt injection patterns and sanitized via `sanitizeForPrompt()` before entering agent prompts
- **`stop.sh` performance**: collapsed 2 node spawns (parse + extract) into 1 with `IFS` parsing, eliminated intermediate `WORKFLOW_STATE` variable. Task descriptions sanitized to prevent newline-based IFS splitting
- **`subagent-status.sh` race condition**: `status.json` now uses atomic write (tmp + rename) matching project convention. Switched from `readFileSync('/dev/stdin')` to `process.argv[1]` for consistency
- **`state.cjs` VALID_PHASES**: added `debug`, `arch_health_scan`, `simplify` phases
- **`code-reviewer.md` numbering**: fixed duplicate item "4." in context_loading list
- `quality-gate-verifier.md` rewritten with correct hook schema (prompt, agent, command options) — was using outdated fields and incorrectly claiming plugins can't register agent-type Stop hooks
- `quality-gates.md` workflow: removed misleading agent reference list from `<available_agent_types>`
- `autoskill.md` workflow: clarified that agent dispatch is conditional, not guaranteed

### Changed
- `harness/` directory removed — scripts relocated to `scripts/` (run-quality-gates.sh, check-docs.sh)
- `state/workflow.yaml` at plugin root removed (development artifact — runtime state is in `.devt/state/`)

## [0.2.0] - 2026-03-30

### Added
- `/devt:help` command — full command reference with use cases, organized by experience level
- `node devt-tools.cjs health [--repair]` — CLI-based health validation with structured JSON output, 17 checks, auto-repair for safe issues, version and update status display
- Hook profile system: `DEVT_HOOK_PROFILE=minimal|standard|full` and `DEVT_DISABLED_HOOKS` env var for granular hook control
- Node.js hook runner (`hooks/run-hook.js`) — replaces bash polyglot, resolves plugin root from script location, checks profile flags
- Language-specific `review-checklist.md` for all 5 templates (Python, Go, TypeScript, Vue, blank)
- `api-changelog.md` template for Go and TypeScript (was Python-only)
- `schemas/learning-entry.yaml` — formal entry schema for retro/curator agents
- Autoskill changelog audit trail (`.devt/autoskill-changelog.md`) — records all autoskill modifications
- Ship workflow changelog step — conditional API changelog generation when `.devt/rules/api-changelog.md` exists
- `templates/agent-template.md` and `templates/skill-template.md` — authoring templates for extending devt
- Command registration via symlink to `~/.claude/commands/devt/` for proper `devt:` namespacing in autocomplete
- `context-monitor.sh` made async — no longer blocks tool calls
- Health check W009: agent file validation — verifies all plugin agent files exist on disk
- Health check W010: workflow `<available_agent_types>` enforcement — prevents post-`/clear` silent fallback to general-purpose
- `scripts/prompt-injection-scan.sh` — CI security scanner for prompt injection, role manipulation, system boundary injection, base64 obfuscation, and secret detection across all markdown files
- Repo-local CLI resolution in `run-hook.js` — probes `<projectDir>/.claude/devt/` before global fallback, persists resolved path to temp file for workflow bash blocks
- `/devt:do` smart router — freeform text dispatched to the right command via intent matching
- `/devt:session-report` — post-session summary from git log and workflow artifacts
- `bin/modules/security.cjs` — input validation: path traversal prevention, prompt injection detection, safe JSON parsing, shell argument validation
- `references/questioning-guide.md` — collaborative questioning philosophy for specify and clarify workflows

### Fixed
- Hook exit codes: `workflow-context-injector.sh` and `context-monitor.sh` now exit 0 (not 2) when inactive — prevents blocking prompts and tool calls
- Stop hook output uses correct `stopReason` schema (was using `hookSpecificOutput` which is invalid for Stop events)
- `CLAUDE_PLUGIN_ROOT` path resolution: session-start hook injects the resolved absolute path so agents can substitute it in workflow bash commands
- `update status` type field collision: `dirty.type` no longer overwrites `install.type` for plugin installs
- `tier` vs `complexity` naming: workflow now writes `tier=` (not `complexity=`), matching schema, hooks, and cancel script. Legacy `complexity` normalized to `tier` on read.
- Non-atomic `stop.sh`: merged two separate `state update` calls into single atomic call
- `findProjectRoot()` memoized — eliminates redundant directory traversals per CLI call
- `checkWorkflowLock(state?)` accepts pre-read state to avoid double `readState()`
- Default model profile fallback aligned to `"quality"` everywhere (was `"balanced"` in some paths)
- Missing `plan` phase added to `VALID_PHASES`
- `architecture.md` correctly classified as required (was listed as optional in docs)
- Stale v0.2.0 migration checks removed from session-start hook
- API changelog template: Before/After labels no longer include version numbers
- Project-init: model profile selection split into own step to prevent batched AskUserQuestion errors

### Changed
- All project artifacts consolidated under `.devt/` directory:
  - `.devt.json` → `.devt/config.json`
  - `.dev-rules/` → `.devt/rules/`
  - `.devt-state/` → `.devt/state/`
  - `learning-playbook.md` → `.devt/learning-playbook.md`
- Health workflow rewritten to call CLI (deterministic) instead of agent-interpreted bash
- `DEFAULTS` exported from config.cjs — health and setup use canonical defaults
- `REQUIRED_DEV_RULES` exported from init.cjs — health imports instead of duplicating
- Atomic writes in setup.cjs via `atomicWriteJson()` helper
- `releaseLock` verifies PID ownership before unlinking (ABA prevention)
- Plugin install docs updated to `claude --plugin-dir` (correct mechanism)
- Weekly report workflow rewritten to use `devt-tools.cjs report` CLI (removed dead Python script branches)
- Incident runbook modernized — references `/devt:cancel-workflow` instead of raw scripts
- Incident runbook wired into dev-workflow.md deviation_rules for failure recovery
- `research-task.md` now has deviation_rules (was the only workflow missing them)
- `quick-implement.md` now writes `tier=SIMPLE` to state (was null, causing hooks to report unknown tier)
- `autonomous=true` state write added to dev-workflow.md when `--autonomous` flag detected
- Code-reviewer agent now reads `.devt/rules/review-checklist.md` for language-specific review patterns
- Retro and curator agents now read `schemas/learning-entry.yaml` for entry format validation

## [0.1.0] - 2026-03-30

Initial release.

### Core Architecture
- **Command -> Workflow -> Agent** three-layer execution model
- 10 agents: programmer, tester, code-reviewer, architect, docs-writer, verifier, researcher, debugger, retro, curator
- 15 skills: codebase-scan, complexity-assessment, tdd-patterns, code-review-guide, architecture-health-scanner, and more
- 28 commands, 26 workflows
- Complexity-tiered pipeline: TRIVIAL, SIMPLE, STANDARD, COMPLEX
- Language-agnostic via `.devt/rules/` convention

### Project Structure
- All artifacts under `.devt/` directory: `config.json`, `rules/`, `state/`, `learning-playbook.md`
- Templates: python-fastapi, go, typescript-node, vue-bootstrap, blank
- 3-level config merge: hardcoded defaults <- `~/.devt/defaults.json` (global) <- `.devt/config.json` (project)

### CLI Tools (zero dependencies)
- Compound init: single call returns all workflow context as JSON
- State management with file-level locking and PID-based stale lock detection
- FTS5 full-text search on learning playbook (node:sqlite)
- Version check against GitHub with 4-hour cache
- Stack auto-detection and git remote auto-detection

### Learning Loop
- Retro agent extracts lessons from each workflow run
- Curator agent deduplicates and compacts the learning playbook
- Semantic search injects relevant lessons into agent dispatches
- Autoskill proposes skill improvements based on accumulated patterns

### Hooks
- 7 lifecycle hooks: SessionStart, Stop, SubagentStart/Stop, PostToolUse, PreToolUse, UserPromptSubmit
- Cross-platform support via polyglot `run-hook.cmd` (Windows + Unix)
- Session-start injects CLI path resolution and workflow awareness
- Context monitor warns at high tool-call counts

### Update System
- `/devt:update` with GitHub version check, changelog display, install-type detection
- Background version check on session start
- Dirty tree detection with stash option for git installs
