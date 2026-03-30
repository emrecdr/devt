#!/usr/bin/env bash
[[ $- == *i* ]] && return
# SessionStart hook — injects workflow awareness and project context.
# Teaches the agent HOW to use devt, not just what commands exist.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ─── Project Detection ───

HAS_DEV_RULES="false"
[[ -d ".devt/rules" ]] && HAS_DEV_RULES="true"

HAS_DEVT_CONFIG="false"
[[ -f ".devt/config.json" ]] && HAS_DEVT_CONFIG="true"

# ─── Migration Checks ───
# Structured registry of breaking changes across versions.
# Each check: lightweight grep/test, emits warning if legacy pattern found.
# Add new checks per version. Remove checks for versions nobody uses (2+ major releases old).

MIGRATION_WARNINGS=""

migrate_check() {
  # Usage: migrate_check "version" "description"
  local ver="$1" msg="$2"
  MIGRATION_WARNINGS="${MIGRATION_WARNINGS}
[${ver}] ${msg}"
}

# ── General health checks (not version-specific) ──

# .devt/state/ exists but no .devt/rules/ (incomplete setup)
if [[ -d ".devt/state" && "$HAS_DEV_RULES" == "false" ]]; then
  MIGRATION_WARNINGS="${MIGRATION_WARNINGS}
Warning: .devt/state/ exists but .devt/rules/ is missing. Run /devt:init to set up project conventions."
fi

# ─── Workflow State Detection ───

STOPPED_AT=""
if [[ -f ".devt/state/workflow.yaml" ]]; then
  STOPPED_AT=$(node -e "
    const fs = require('fs');
    try {
      const content = fs.readFileSync('.devt/state/workflow.yaml', 'utf8');
      const match = content.match(/^stopped_at:\s*(.+)$/m);
      if (match && match[1] !== 'null') process.stdout.write(match[1].trim());
    } catch(e) {}
  " 2>/dev/null || true)
fi

HANDOFF_INFO=""
if [[ -f ".devt/state/handoff.json" ]]; then
  HANDOFF_INFO=$(node -e "
    const fs = require('fs');
    try {
      const h = JSON.parse(fs.readFileSync('.devt/state/handoff.json', 'utf8'));
      const parts = [];
      if (h.task) parts.push('Task: ' + h.task);
      if (h.tier) parts.push('Tier: ' + h.tier);
      if (h.phase) parts.push('Phase: ' + h.phase);
      if (h.next_action) parts.push('Next: ' + h.next_action);
      if (h.human_actions_pending && Array.isArray(h.human_actions_pending) && h.human_actions_pending.length > 0) {
        parts.push('Pending: ' + h.human_actions_pending.map(function(a) { return typeof a === 'string' ? a : (a && a.action) || JSON.stringify(a); }).join(', '));
      }
      process.stdout.write(parts.join('\\n  '));
    } catch(e) {}
  " 2>/dev/null || true)
fi

# ─── Background Update Check ───

(node "${PLUGIN_ROOT}/bin/devt-tools.cjs" update check >/dev/null 2>&1 &)

UPDATE_MSG=""
UPDATE_CACHE="${TMPDIR:-/tmp}/devt-cache/update-check.json"
if [[ -f "$UPDATE_CACHE" ]]; then
  UPDATE_MSG=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
      if (d.update_available) process.stdout.write('Update available: v' + d.installed + ' -> v' + d.latest + '. Run /devt:update');
    } catch {}
  " "$UPDATE_CACHE" 2>/dev/null || true)
fi

# ─── Build Context ───

CONTEXT="[devt plugin loaded]

IMPORTANT — CLI path resolution:
  \${CLAUDE_PLUGIN_ROOT} is NOT an environment variable in bash. When workflows reference:
    node \"\${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs\" <command>
  You MUST substitute the actual path:
    node \"${PLUGIN_ROOT}/bin/devt-tools.cjs\" <command>
  DEVT_BIN: ${PLUGIN_ROOT}/bin/devt-tools.cjs

How devt works:
  /devt:workflow is the main entry point. Give it a task — it auto-detects complexity and runs the right pipeline:
    TRIVIAL  (typo, config)         -> executes inline, no subagents
    SIMPLE   (1-2 files)            -> implement -> test -> review
    STANDARD (multiple files)       -> scan -> implement -> test -> review -> verify -> docs -> retro
    COMPLEX  (new patterns, multi-service) -> research -> plan -> [arch-health?] -> architect -> full pipeline

  Each step is handled by a specialized agent (programmer, tester, code-reviewer, architect, verifier, docs-writer, retro).
  Agents read project conventions from .devt/rules/ and communicate through .devt/state/ artifacts.
  The workflow handles retries, repair operators, and escalation automatically.

When to use what:
  Build/fix/improve something  -> /devt:workflow \"task description\"
  Define a feature first       -> /devt:specify -> /devt:workflow
  Fix a bug                    -> /devt:debug \"bug description\"
  Not sure what to do next     -> /devt:next
  Create PR when ready         -> /devt:ship

Utilities: /devt:status, /devt:pause, /devt:cancel-workflow, /devt:note, /devt:health, /devt:update

Project: .devt/rules/ ${HAS_DEV_RULES} | .devt/config.json ${HAS_DEVT_CONFIG}"

if [[ "$HAS_DEV_RULES" == "false" && "$HAS_DEVT_CONFIG" == "false" ]]; then
  CONTEXT="${CONTEXT}

This project is not configured for devt yet. Run /devt:init to set up .devt/rules/ with coding standards, testing patterns, and quality gates. Without .devt/rules/, devt works but agents have no project-specific conventions to follow."
fi

if [[ -n "$HANDOFF_INFO" ]]; then
  CONTEXT="${CONTEXT}

Paused workflow detected:
  ${HANDOFF_INFO}
Run /devt:next to resume or /devt:cancel-workflow to start fresh."
elif [[ -n "$STOPPED_AT" ]]; then
  CONTEXT="${CONTEXT}

Previous session stopped at: ${STOPPED_AT}. State in .devt/state/.
Run /devt:next to resume or /devt:cancel-workflow to start fresh."
fi

if [[ -n "$MIGRATION_WARNINGS" ]]; then
  CONTEXT="${CONTEXT}
${MIGRATION_WARNINGS}"
fi

if [[ -n "$UPDATE_MSG" ]]; then
  CONTEXT="${CONTEXT}

${UPDATE_MSG}"
fi

# ─── Output ───

node -e "
  const context = process.argv[1];
  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context
    }
  };
  process.stdout.write(JSON.stringify(output));
" "$CONTEXT"
