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

Available agent types in the devt system (for reference):
- `devt:programmer` — implementation specialist
- `devt:tester` — testing specialist
- `devt:code-reviewer` — code review specialist (READ-ONLY)
- `devt:architect` — structural review specialist (READ-ONLY)
- `devt:docs-writer` — documentation specialist
- `devt:retro` — lesson extraction specialist
- `devt:curator` — playbook quality maintenance specialist
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

---

## Steps

<step name="detect_existing" gate="no .devt.json exists in project root">

Check if the project already has devt configuration:

```bash
test -f .devt.json && echo "EXISTS" || echo "MISSING"
test -d .dev-rules && echo "RULES_EXIST" || echo "RULES_MISSING"
test -d .devt-state && echo "STATE_EXIST" || echo "STATE_MISSING"
```

**Gate**: If `.devt.json` already exists, ask the user via AskUserQuestion:
- Option A: "Reinitialize (overwrite existing configuration)"
- Option B: "Update (keep existing, fill in missing pieces)"
- Option C: "Cancel"

If Cancel, STOP with status DONE and report "No changes made."
</step>

<step name="select_template" gate="user has selected a template">

Ask the user which project template to use via AskUserQuestion:

- **python-fastapi** — Python 3.12+, FastAPI, SQLModel, pytest, ruff, mypy
- **go** — Go modules, standard library patterns, golangci-lint
- **typescript-node** — TypeScript, Node.js, ESLint, Vitest/Jest
- **blank** — No template. Creates empty .dev-rules/ files for manual configuration

Present these options with descriptions. Wait for the user's selection.

Store the selection as `$TEMPLATE`.
</step>

<step name="collect_config" gate="user has provided project metadata">

Ask the user for project configuration via AskUserQuestion:

**Required fields**:
- Git provider: `bitbucket` | `github` | `gitlab` | `none`
- Workspace/org name (if provider is not `none`)
- Repository slug
- Default branch name (default: `main`)

**Optional fields**:
- Contributors (comma-separated list of usernames for weekly reports)
- Architecture scanner command (e.g., `python scripts/arch_scanner.py`)
- Custom quality gate commands (override template defaults)

Build a JSON configuration object from the collected answers:

```json
{
  "git": {
    "provider": "<provider>",
    "workspace": "<workspace>",
    "slug": "<slug>",
    "branch": "<branch>"
  },
  "contributors": ["<user1>", "<user2>"],
  "arch_scanner": {
    "command": "<command or null>"
  }
}
```
</step>

<step name="run_setup" gate="setup command completes with exit code 0">

Execute the devt setup tool with the collected template and configuration:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" setup --template $TEMPLATE --config '$CONFIG_JSON'
```

This command:
1. Copies template files from `${CLAUDE_PLUGIN_ROOT}/templates/$TEMPLATE/` to `.dev-rules/`
2. Creates `.devt.json` with the project configuration
3. Creates `.devt-state/` directory for workflow state artifacts
4. Sets up initial `learning-playbook.md` if it does not exist

**If the command fails**: Report the error verbatim to the user and STOP with status BLOCKED.
</step>

<step name="verify_and_report" gate="all expected files exist">

Verify the setup created everything expected:

```bash
test -f .devt.json && echo "OK: .devt.json" || echo "MISSING: .devt.json"
test -d .dev-rules && echo "OK: .dev-rules/" || echo "MISSING: .dev-rules/"
test -d .devt-state && echo "OK: .devt-state/" || echo "MISSING: .devt-state/"
test -f .dev-rules/coding-standards.md && echo "OK: coding-standards.md" || echo "MISSING: coding-standards.md"
test -f .dev-rules/architecture.md && echo "OK: architecture.md" || echo "MISSING: architecture.md"
test -f .dev-rules/quality-gates.md && echo "OK: quality-gates.md" || echo "MISSING: quality-gates.md"
test -f .dev-rules/testing-patterns.md && echo "OK: testing-patterns.md" || echo "MISSING: testing-patterns.md"
```

Report to the user:
- Which files and directories were created
- Which template was applied
- What the user should do next (review and customize `.dev-rules/` files)
- Remind them to add `.devt-state/` to `.gitignore` if not already there
</step>

---

<deviation_rules>
1. **Auto-fix: bugs** — If the setup command fails due to a missing directory, create it and retry once.
2. **Auto-fix: lint** — Not applicable (no code generation in this workflow).
3. **Auto-fix: deps** — If `node` is not found, report "Node.js is required. Install it and retry." STOP with BLOCKED.
4. **STOP: architecture** — If the user requests a template that does not exist in `${CLAUDE_PLUGIN_ROOT}/templates/`, do NOT create one. Report the available templates and ask again.
</deviation_rules>

<success_criteria>
- `.devt.json` exists in the project root with valid JSON
- `.dev-rules/` directory exists with at least `coding-standards.md`, `architecture.md`, `quality-gates.md`
- `.devt-state/` directory exists
- Status: **DONE**
</success_criteria>
