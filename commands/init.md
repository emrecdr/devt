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

In addition to scaffolding `.devt/rules/`, the wizard automatically runs `node bin/devt-tools.cjs memory init` to create the FTS5 index at `.devt/memory/index.db` and scaffold `.devt/memory/{decisions,concepts,flows,rejected,lessons}/`. The vendored read-only MCP server (`bin/devt-memory-mcp.cjs`) and the vendored read-only Graphify relay (`bin/devt-graphify-mcp.cjs`) both ship with the plugin and are auto-registered via the plugin-root `.mcp.json` whenever devt is loaded — no project-level scaffolding required. Project `.mcp.json` is reserved for project-relative servers like the upstream `graphify` Python MCP and `claude-mem` (registered conditionally if their binaries are detected on PATH). When Graphify is detected and enabled, the wizard also prompts to build the first `graphify-out/graph.json` so graph-derived signals are live from the first workflow onward. Optional configuration:
- `memory.paths` — multi-root memory: index company-wide ADRs alongside project-local ones via `["../engineering-adrs", ".devt/memory"]`. Project-local always wins on ID collisions. See `docs/MEMORY.md`.
- `memory.preflight_mode` — default `block`; PreToolUse hook denies edits without a `PREFLIGHT` scratchpad line. Set to `warn` for advisory mode during onboarding.
- `graphify.enabled` — opt-in AST symbol anchoring + ~10× lower token cost on code-search ops.
</process>
