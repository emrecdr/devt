#!/usr/bin/env bash
# SessionStart hook — injects plugin orientation context.
# Tells the model about available commands, .dev-rules/ convention, and project status.
set -euo pipefail

HAS_DEV_RULES="false"
if [[ -d ".dev-rules" ]]; then
  HAS_DEV_RULES="true"
fi

HAS_DEVT_CONFIG="false"
if [[ -f ".devt.json" ]]; then
  HAS_DEVT_CONFIG="true"
fi

# Check for session continuity
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STOPPED_AT=""
if [[ -f "${PLUGIN_ROOT}/state/workflow.yaml" ]]; then
  STOPPED_AT=$(node -e "
    const fs = require('fs');
    try {
      const content = fs.readFileSync('${PLUGIN_ROOT}/state/workflow.yaml', 'utf8');
      const match = content.match(/^stopped_at:\s*(.+)$/m);
      if (match && match[1] !== 'null') process.stdout.write(match[1].trim());
    } catch(e) {}
  " 2>/dev/null || true)
fi

# Build orientation context
CONTEXT="[devt plugin loaded]

Available commands:
  /devt:init              — Initialize project with .dev-rules/ scaffolding
  /devt:plan              — Create a validated implementation plan before coding
  /devt:workflow          — Start a multi-phase development workflow
  /devt:implement         — Quick implementation (single task)
  /devt:fast              — Inline trivial task (3 or fewer files, no subagents)
  /devt:review            — Code review with quality gates
  /devt:quality           — Run quality checks (lint, type, test)
  /devt:ship              — Create PR from workflow artifacts (.devt-state/)
  /devt:status            — Show workflow progress and suggest next action
  /devt:arch-health       — Architecture health scan
  /devt:retro             — Extract lessons from recent work
  /devt:autoskill         — Auto-generate reusable skills from patterns
  /devt:weekly-report     — Generate weekly progress report
  /devt:research          — Research implementation approaches before planning
  /devt:clarify           — Discuss choices and capture decisions before coding
  /devt:pause             — Pause workflow and create structured handoff for resumption
  /devt:debug             — Systematic debugging with 4-phase investigation protocol
  /devt:cancel-workflow   — Cancel active workflow

Agent-skill mapping: Read \${CLAUDE_PLUGIN_ROOT}/skill-index.yaml for agent→skill relationships.

Convention: .dev-rules/ contains project-specific rules, standards, and patterns that all agents follow. Run /devt:init to scaffold it for a new project.

Project status:
  .dev-rules/ exists: ${HAS_DEV_RULES}
  .devt.json exists: ${HAS_DEVT_CONFIG}"

if [[ "$HAS_DEV_RULES" == "false" ]]; then
  CONTEXT="${CONTEXT}

Tip: Run /devt:init to set up .dev-rules/ for this project."
fi

if [[ -n "$STOPPED_AT" ]]; then
  CONTEXT="${CONTEXT}

Previous session stopped at: ${STOPPED_AT}
Consider running /devt:workflow to resume or /devt:cancel-workflow to start fresh."
fi

# Output with proper JSON escaping via node
node -e "
  const context = process.argv[1];
  const output = {
    hookSpecificOutput: { additionalContext: context },
    hookEventName: 'SessionStart'
  };
  process.stdout.write(JSON.stringify(output));
" "$CONTEXT"
