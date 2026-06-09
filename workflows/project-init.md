# Project Initialization Workflow

Interactive project setup wizard that configures devt for a new or existing project.

---

<prerequisites>
- The user has invoked `/init` or the `devt:init` command
- The current working directory is the project root
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

---

## Steps

<step name="detect_existing" gate="project state determined">

Check existing configuration and auto-detect project context:

```bash
test -f .devt/config.json && echo "EXISTS" || echo "MISSING"
test -d .devt/rules && echo "RULES_EXIST" || echo "RULES_MISSING"
test -d .devt/state && echo "STATE_EXIST" || echo "STATE_MISSING"
```

Also run stack and git detection:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" setup --detect
```

This returns:
- `detected_stack`: array of `{template, marker}` — which templates match existing project files
- `detected_git`: `{remote, provider, workspace, slug, primary_branch}` — auto-detected from git remote
- `available_templates`: list of all templates

**Gate**: If `.devt/config.json` already exists, ask the user via AskUserQuestion:

```yaml
question: "devt is already configured for this project. What would you like to do?"
header: "Existing Configuration"
multiSelect: false
options:
  - label: "Update (add missing files)"
    description: "Keep existing .devt/rules/ and .devt/config.json, add any missing template files"
  - label: "Reinitialize (overwrite)"
    description: "Replace .devt/rules/ and .devt/config.json with fresh template"
  - label: "Cancel"
    description: "No changes"
```

If Cancel: STOP with "No changes made."

Store the mode: `create` (fresh), `update`, or `reinit`.
</step>

<step name="select_template" gate="user has selected a template">

If `detected_stack` found matches, present them as recommendations:

```yaml
question: "Which template should devt use for this project?"
header: "Project Template"
multiSelect: false
options:
  - label: "python-fastapi (Recommended — pyproject.toml detected)"
    description: "Python 3.12+, FastAPI, SQLModel, pytest, ruff, mypy"
  - label: "go"
    description: "Go modules, standard library patterns, golangci-lint"
  - label: "typescript-node"
    description: "TypeScript, Node.js, ESLint, Vitest/Jest"
  - label: "vue-bootstrap"
    description: "Vue 3 Composition API, Bootstrap 5, Pinia, Playwright"
  - label: "blank"
    description: "Language-agnostic — generic coding standards, quality gates, golden rules"
```

Mark the detected template as "(Recommended — {marker} detected)". If no stack detected, show all options without recommendation.

Store the selection as `$TEMPLATE`.
</step>

<step name="collect_config" gate="user has provided project metadata">

Present auto-detected values as defaults. Only ask about fields that couldn't be auto-detected.

**If git remote was detected**, show what was found, including how `primary_branch` was resolved:

```
Auto-detected from git remote:
  Provider: {provider}
  Workspace: {workspace}
  Repository: {slug}
  Branch: {primary_branch}  (source: {primary_branch_source})
```

`primary_branch_source` reports the detection chain: `origin_head_symref` (canonical, set on git clone) > `init_default_branch` (local config) > `common_name_heuristic` (matched `development` / `develop` / `main` / `master` / `trunk` on origin) > `current_branch` (last resort — what's checked out right now).

**Branch confidence escalation:** if `detected_git.primary_branch_low_confidence === true` (set when detection fell to `current_branch` AND the branch matches a feature-shape pattern like `feat/`, `fix/`, `chore/`, `wip/`, `task/`, `hotfix/`, `release/`), the auto-detected branch is almost certainly NOT the integration branch. In that case, escalate via a dedicated AskUserQuestion BEFORE the general git-config confirmation:

```yaml
question: "Detected `{primary_branch}` as your integration branch, but that looks like a feature branch. What's your team's actual integration branch (the one /devt:ship targets for PRs)?"
header: "Branch"
multiSelect: false
options:
  - label: "development (Recommended for many teams)"
    description: "Common integration branch for teams using GitFlow or trunk-based development with a long-lived dev branch"
  - label: "main"
    description: "Single-trunk repos where main is the integration target"
  - label: "master"
    description: "Legacy default — repos that haven't migrated naming"
  - label: "Use the detected `{primary_branch}` anyway"
    description: "Override only if you're certain this branch is your integration target"
```

The user can pick "Other" to type any branch name. Whatever they choose replaces `primary_branch` in the config.

Then ask the standard git-config confirmation:

```yaml
question: "Is the auto-detected git configuration correct?"
header: "Git Config"
multiSelect: false
options:
  - label: "Yes, looks correct"
    description: "Use detected values: {provider} / {workspace} / {slug} / {primary_branch}"
  - label: "No, I need to edit"
    description: "I'll provide corrected values"
```

If the user confirms, proceed with auto-detected values. If not, ask follow-up questions for the incorrect fields.
</step>

<step name="select_model_profile" gate="user has selected a model profile">

Ask about model profile via AskUserQuestion:

```yaml
question: "Which model profile should devt use for agent dispatch?"
header: "Model Profile"
multiSelect: false
options:
  - label: "quality (Recommended)"
    description: "All agents use opus — best results, highest token usage"
  - label: "balanced"
    description: "Key agents (programmer, reviewer, architect) use opus, others use sonnet"
  - label: "budget"
    description: "Most agents use sonnet, docs/retro/curator use haiku"
```

Build a JSON configuration object combining: auto-detected git values (or user overrides), selected model profile, and any optional fields the user provides (contributors, architecture scanner command).
</step>

<step name="run_setup" gate="setup command completes with exit code 0">

Execute the devt setup tool with the collected template, configuration, and mode:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" setup --template $TEMPLATE --config '$CONFIG_JSON' --mode $MODE
```

This command:

1. Auto-detects stack markers and git remote
2. Copies template files to `.devt/rules/` (create: full copy, update: missing files only, reinit: overwrite)
3. Creates `.devt/config.json` with deep-merged config: defaults ← git auto-detect ← user input
4. Creates `.devt/state/` directory for workflow state artifacts
5. Scaffolds `.devt/memory/{decisions,concepts,flows,rejected,lessons}/` (curator's write target)
6. Creates or appends `.devt/state/` to `.gitignore`

**If the command fails**: Report the error verbatim to the user and STOP with status BLOCKED.
</step>

<step name="init_memory_index" gate="index.db exists at .devt/memory/index.db">

Initialize the memory FTS5 index. Without this, every `memory query` returns "not initialized", governance lanes in the Pre-Flight Brief silently render empty, and the Brief now surfaces a ⚠️ headline alert telling the user to run this command. Running it automatically here closes the gap — the project is fully usable from the moment init finishes.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory init 2>&1 | tail -5
```

Idempotent — running on an already-initialized project re-creates index.db cleanly with whatever docs exist in `.devt/memory/{decisions,concepts,flows,rejected,lessons}/`. Failure is non-fatal but unusual — report the error and continue. The verify_and_report step at the end will flag a missing index.db.

After the index builds, surface a tip to the user about the discovery pipeline:

> 💡 Memory index ready. As you work, claude-mem ⚖️/🔵 observations and decision logs collect candidate ADRs/CONs in `.devt/memory/_suggestions.md`. Run `/devt:retro` after workflows to have the curator promote them, or `/devt:memory promote` interactively.
</step>

<step name="prompt_graphify_setup" gate="graphify install/enable prompt resolved">

Probe Graphify availability and the project's effective `graphify.enabled` value. The aim is to surface install instructions when Graphify is absent (strongly recommended — ~10× lower-token code search across all dev agents) and to offer to flip `graphify.enabled=true` when Graphify is present but devt isn't yet configured to use it. Without this prompt, a fully-installed Graphify silently sits unused because the default in `bin/modules/config.cjs` is `enabled: false`.

```bash
GRAPHIFY_AVAILABLE=$(command -v graphify >/dev/null 2>&1 && echo yes || echo no)
GRAPHIFY_ENABLED=$(node -e "try{const c=require('${PWD}/.devt/config.json');console.log(c.graphify&&c.graphify.enabled?'yes':'no')}catch{console.log('no')}")
echo "graphify_available=$GRAPHIFY_AVAILABLE graphify_enabled=$GRAPHIFY_ENABLED"
```

Branch on the result:

**Case A — `graphify_available=no`** (binary not on PATH):

Ask via AskUserQuestion:

```yaml
question: "Graphify is not installed. devt agents fall back to grep-based search without it, but Graphify reduces code-search token cost ~10× and powers blast-radius + stale-symbol checks. Show install instructions?"
header: "Graphify Install"
multiSelect: false
options:
  - label: "Yes, show install command (Recommended)"
    description: "Prints the install command — does NOT execute it. devt setup continues regardless. Re-run /devt:init after install to register the integration."
  - label: "No, skip"
    description: "Continue without Graphify. Install later with `uv tool install graphifyy[mcp]` and re-run /devt:init."
```

On "Yes", print to the user (do NOT execute — Python env changes are user-owned):

```
To install Graphify:
  uv tool install graphifyy[mcp]      # recommended — MCP server launches via `uv run`
  # or: pipx install graphifyy[mcp]
  # or: pip install graphifyy[mcp]    # works for CLI; MCP server entry still requires `uv` on PATH

Then re-run /devt:init so devt can register the MCP server and offer to enable the integration.
```

**Case B — `graphify_available=yes` AND `graphify_enabled=no`** (the silent-failure case — Graphify is installed but devt isn't using it):

Ask via AskUserQuestion:

```yaml
question: "Graphify is installed but devt isn't using it (graphify.enabled=false in .devt/config.json). Enable now? Without this, blast-radius checks, stale-symbol detection, and Pre-Flight Brief enrichment all silently fall back to grep."
header: "Enable Graphify"
multiSelect: false
options:
  - label: "Yes, enable in devt config (Recommended)"
    description: "Sets graphify.enabled=true in .devt/config.json. All dev agents route code-search through Graphify with grep fallback on empty/error."
  - label: "No, keep disabled"
    description: "devt continues with grep fallback. Enable later: node bin/devt-tools.cjs config set graphify.enabled=true"
```

On "Yes":

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config set graphify.enabled=true 2>&1 | tail -3 || echo "(config update failed — non-fatal, run manually: node bin/devt-tools.cjs config set graphify.enabled=true)"
```

**Case C — `graphify_available=yes` AND `graphify_enabled=yes`**: skip (already configured).

This step is best-effort: failures NEVER fail the init workflow. Report which case was taken so the user has a record.
</step>

<step name="prompt_graphify_hook" gate="graphify hook prompt resolved (installed, declined, or N/A)">

Check whether Graphify is available and whether its post-commit hook is registered. If Graphify is on PATH but its hook is missing, prompt the user — without this hook, the graph cache drifts behind HEAD and Pre-Flight Briefs surface stale-symbol false alarms after every refactor.

```bash
GRAPHIFY_AVAILABLE=$(command -v graphify >/dev/null 2>&1 && echo yes || echo no)
HOOK_PATH=".git/hooks/post-commit"
HOOK_IS_GRAPHIFY=no
if [ -f "$HOOK_PATH" ] && grep -q "graphify" "$HOOK_PATH" 2>/dev/null; then
  HOOK_IS_GRAPHIFY=yes
fi
echo "graphify_available=$GRAPHIFY_AVAILABLE hook_is_graphify=$HOOK_IS_GRAPHIFY"
```

If `graphify_available=no` OR `hook_is_graphify=yes`: skip this step (nothing to do).

Otherwise, ask via AskUserQuestion:

```yaml
question: "Graphify is installed but its post-commit hook is not registered. Install it now? (Recommended — keeps the graph cache fresh after every commit so blast-radius and stale-symbol checks stay accurate.)"
header: "Graphify Hook"
multiSelect: false
options:
  - label: "Yes, install graphify hook"
    description: "Runs `graphify hook install` once. Each subsequent commit auto-refreshes the graph (~1-3s on small repos)."
  - label: "No, skip for now"
    description: "Graph cache will drift; Pre-Flight Brief alerts when ≥10 commits behind HEAD. Run `graphify hook install` manually when ready."
```

On "Yes":

```bash
graphify hook install 2>&1 | tail -5 || echo "(graphify hook install failed — non-fatal, you can retry manually)"
```

This is best-effort: failures NEVER fail the init workflow. Report which path was taken so the user has a record.
</step>

<step name="prompt_graphify_first_build" gate="graphify-out/graph.json exists OR user declined">

If `graphify_available=yes` AND `graphify.enabled=true` AND `graphify-out/graph.json` does NOT yet exist, offer to build the graph for the first time. Without this, the project has graphify wired but ALL graphify-derived signals (blast radius, scope_hint augmentation, get_neighbors caller sets) silently degrade until the user remembers to run `graphify update .` themselves.

```bash
GRAPHIFY_AVAILABLE=$(command -v graphify >/dev/null 2>&1 && echo yes || echo no)
GRAPHIFY_ENABLED=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get graphify.enabled 2>/dev/null | jq -r '.value // false')
GRAPH_EXISTS=$([ -f "graphify-out/graph.json" ] && echo yes || echo no)
echo "graphify_available=$GRAPHIFY_AVAILABLE graphify_enabled=$GRAPHIFY_ENABLED graph_exists=$GRAPH_EXISTS"
```

If any of (`available=no`, `enabled=false`, `graph_exists=yes`): skip this step. Otherwise AskUserQuestion:

```yaml
question: "Graphify is enabled but no graph has been built yet. Run the first build now? (One-time, may take 30s–2min depending on repo size; uses AST only — no LLM/API cost.)"
header: "First Graph Build"
multiSelect: false
options:
  - label: "Yes, build now"
    description: "Runs `graphify update .` once. Subsequent updates are incremental (~seconds). After this, every preflight/review/debug dispatch gets blast-radius + caller-set signals."
  - label: "No, I'll build manually later"
    description: "Run `graphify update .` whenever ready. Until then, preflight scope_trust will report 'empty' and downstream agents fall back to grep-first discovery."
```

On "Yes":

```bash
graphify update . 2>&1 | tail -10 || echo "(graphify update failed — non-fatal, you can retry manually with: graphify update .)"
```

Best-effort: failures NEVER fail init. Report which path was taken.
</step>

<step name="prompt_claude_mem_setup" gate="claude-mem presence detected and user informed">

Detect whether claude-mem (cross-session memory plugin) is available and surface install guidance if not. claude-mem is an OPTIONAL but high-leverage integration — when present, devt workflows query its MCP search tool (`mcp__plugin_claude-mem_mcp-search__search`) to harvest ⚖️ (decision) and 🔵 (discovery) observations from PRIOR sessions into the curator's candidate pool. Without claude-mem, harvest falls back to scratchpad-only sources and the curator sees a strictly smaller candidate set every retro.

```bash
# claude-mem v13+ self-registers as a Claude Code plugin under
# ~/.claude/plugins/ — there is no CLI binary on PATH. The canonical
# detection source is ~/.claude/plugins/installed_plugins.json::plugins
# which lists every installed plugin keyed as `<name>@<marketplace>`.
# Match any key starting with `claude-mem@` to handle marketplace forks.
CLAUDE_MEM_REGISTRY="$HOME/.claude/plugins/installed_plugins.json"
if [ -f "$CLAUDE_MEM_REGISTRY" ] && jq -e '.plugins | keys | any(startswith("claude-mem@"))' "$CLAUDE_MEM_REGISTRY" >/dev/null 2>&1; then
  CLAUDE_MEM_AVAILABLE=yes
else
  CLAUDE_MEM_AVAILABLE=no
fi
echo "claude_mem_available=$CLAUDE_MEM_AVAILABLE"
```

**Case A — `claude_mem_available=no`**: surface install hint via AskUserQuestion:

```yaml
question: "claude-mem is not installed. It's an optional Claude Code plugin that gives devt cross-session memory — ⚖️ decisions and 🔵 discoveries from past sessions become curator-eligible ADR/CON candidates. Install now? (Separate plugin; devt cannot install it for you.)"
header: "claude-mem"
multiSelect: false
options:
  - label: "Show me the install command"
    description: "Surface the one-liner. claude-mem registers its own MCP server in your global Claude config; devt detects it automatically at workflow time."
  - label: "Skip — I'll set it up later"
    description: "Curator runs without claude-mem. Harvest pool is strictly smaller (scratchpad + decisions.md + graphify god-nodes only). Re-run /devt:init or check claude-mem docs when ready."
```

On "Show me the install command", emit verbatim:

> Install via the Claude Code plugin system. From any Claude Code session:
> ```
> /plugin marketplace add anthropics/claude-code-plugins
> /plugin install claude-mem
> ```
> Restart Claude Code after install. Verify with `jq '.plugins | keys[] | select(startswith("claude-mem@"))' ~/.claude/plugins/installed_plugins.json` and re-run `/devt:init` to re-detect.

**Case B — `claude_mem_available=yes`**: emit a confirmation line so the user knows the integration is live:

> ✓ claude-mem detected on PATH. devt workflows will harvest its ⚖️/🔵 observations into the curator candidate pool automatically — no further setup needed. The MCP tool `mcp__plugin_claude-mem_mcp-search__search` is consulted by `dev-workflow.md`, `quick-implement.md`, and `lesson-extraction.md` orchestrator pre-steps.

This step is best-effort and informational: failures NEVER fail init. Report which case was taken.
</step>

<step name="verify_and_report" gate="all expected files exist">

Verify the setup created everything expected:

```bash
test -f .devt/config.json && echo "OK: .devt/config.json" || echo "MISSING: .devt/config.json"
test -d .devt/rules && echo "OK: .devt/rules/" || echo "MISSING: .devt/rules/"
test -d .devt/state && echo "OK: .devt/state/" || echo "MISSING: .devt/state/"
test -d .devt/memory && echo "OK: .devt/memory/" || echo "MISSING: .devt/memory/"
test -f .devt/memory/index.db && echo "OK: .devt/memory/index.db (FTS5 index)" || echo "MISSING: .devt/memory/index.db — run 'node bin/devt-tools.cjs memory init'"
test -f .devt/rules/coding-standards.md && echo "OK: coding-standards.md" || echo "MISSING: coding-standards.md"
test -f .devt/rules/architecture.md && echo "OK: architecture.md" || echo "MISSING: architecture.md"
test -f .devt/rules/quality-gates.md && echo "OK: quality-gates.md" || echo "MISSING: quality-gates.md"
test -f .devt/rules/testing-patterns.md && echo "OK: testing-patterns.md" || echo "MISSING: testing-patterns.md"
test -f .devt/rules/golden-rules.md && echo "OK: golden-rules.md" || echo "INFO: golden-rules.md not present (optional)"
test -f .devt/rules/git-workflow.md && echo "OK: git-workflow.md" || echo "INFO: git-workflow.md not present (optional)"
test -f .gitignore && grep -q ".devt/state" .gitignore && echo "OK: .gitignore includes .devt/state/" || echo "WARNING: .devt/state/ not in .gitignore"
# Graphify-conditional check — only emit when graphify is enabled
if [ "$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get graphify.enabled 2>/dev/null | jq -r '.value // false')" = "true" ]; then
  test -f graphify-out/graph.json && echo "OK: graphify-out/graph.json (graph built)" || echo "INFO: graphify-out/graph.json not yet built — run 'graphify update .' to enable graph-derived signals"
fi
```

Report to the user:

- Which files and directories were created or updated
- Which template was applied
- What git config was auto-detected vs manually entered
- Remind them to review and customize `.devt/rules/` files for their project
- Suggest next step: `/devt:workflow "your first task"` or `/devt:health` to verify
</step>

---

<deviation_rules>

1. **Auto-fix: bugs** — If the setup command fails due to a missing directory, create it and retry once.
2. **Auto-fix: lint** — Not applicable (no code generation in this workflow).
3. **Auto-fix: deps** — If `node` is not found, report "Node.js is required. Install it and retry." STOP with BLOCKED.
4. **STOP: architecture** — If the user requests a template that does not exist in `${CLAUDE_PLUGIN_ROOT}/templates/`, do NOT create one. Report the available templates and ask again.
</deviation_rules>

<success_criteria>

- `.devt/config.json` exists in the project root with valid JSON and auto-detected git config
- `.devt/rules/` directory exists with at least `coding-standards.md`, `architecture.md`, `quality-gates.md`
- `.devt/state/` directory exists
- `.devt/memory/index.db` exists (FTS5 index initialized — closes the "memory layer silently empty" failure mode)
- `.gitignore` includes `.devt/state/`
- If graphify is enabled: `graphify-out/graph.json` exists OR user explicitly declined the first-build prompt
- Status: **DONE**
</success_criteria>
