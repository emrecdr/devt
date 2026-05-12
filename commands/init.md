---
name: init
description: Interactive project setup wizard that configures devt for a new or existing project
---

<tool_restrictions>
This workflow uses: Bash, Read, Write, AskUserQuestion
</tool_restrictions>

<objective>
Run the interactive project setup wizard to configure devt for the current project. Detects project type, sets up configuration files, and establishes conventions.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/project-init.md
</execution_context>

<process>
Execute the project initialization workflow from the referenced file end-to-end.

In addition to scaffolding `.devt/rules/`, the wizard sets up the memory layer (`/devt:memory init`) creating `.devt/memory/{decisions,concepts,flows,rejected}/`. The vendored read-only MCP server (`bin/devt-memory-mcp.cjs`) ships with the plugin and is auto-registered via the plugin-root `.mcp.json` whenever devt is loaded — no project-level scaffolding required. Project `.mcp.json` is reserved for project-relative servers like `graphify` and `claude-mem` (registered conditionally if their binaries are detected on PATH). Optional configuration:
- `memory.paths` — multi-root memory: index company-wide ADRs alongside project-local ones via `["../engineering-adrs", ".devt/memory"]`. Project-local always wins on ID collisions. See `docs/MEMORY.md`.
- `memory.preflight_mode` — default `block`; PreToolUse hook denies edits without a `PREFLIGHT` scratchpad line. Set to `warn` for advisory mode during onboarding.
- `graphify.enabled` — opt-in AST symbol anchoring + ~10× lower token cost on code-search ops.
</process>
