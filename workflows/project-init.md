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

**If git remote was detected**, show what was found:
```
Auto-detected from git remote:
  Provider: {provider}
  Workspace: {workspace}
  Repository: {slug}
  Branch: {primary_branch}
```

Ask via AskUserQuestion:

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
5. Sets up initial `.devt/learning-playbook.md` if it does not exist
6. Creates or appends `.devt/state/` to `.gitignore`

**If the command fails**: Report the error verbatim to the user and STOP with status BLOCKED.
</step>

<step name="verify_and_report" gate="all expected files exist">

Verify the setup created everything expected:

```bash
test -f .devt/config.json && echo "OK: .devt/config.json" || echo "MISSING: .devt/config.json"
test -d .devt/rules && echo "OK: .devt/rules/" || echo "MISSING: .devt/rules/"
test -d .devt/state && echo "OK: .devt/state/" || echo "MISSING: .devt/state/"
test -f .devt/rules/coding-standards.md && echo "OK: coding-standards.md" || echo "MISSING: coding-standards.md"
test -f .devt/rules/architecture.md && echo "OK: architecture.md" || echo "MISSING: architecture.md"
test -f .devt/rules/quality-gates.md && echo "OK: quality-gates.md" || echo "MISSING: quality-gates.md"
test -f .devt/rules/testing-patterns.md && echo "OK: testing-patterns.md" || echo "MISSING: testing-patterns.md"
test -f .devt/rules/golden-rules.md && echo "OK: golden-rules.md" || echo "INFO: golden-rules.md not present (optional)"
test -f .devt/rules/git-workflow.md && echo "OK: git-workflow.md" || echo "INFO: git-workflow.md not present (optional)"
test -f .gitignore && grep -q ".devt/state" .gitignore && echo "OK: .gitignore includes .devt/state/" || echo "WARNING: .devt/state/ not in .gitignore"
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
- `.gitignore` includes `.devt/state/`
- Status: **DONE**
</success_criteria>
