#!/usr/bin/env bash
[[ $- == *i* ]] && return
# SessionStart hook — injects workflow awareness and project context.
# Teaches the agent HOW to use devt, not just what commands exist.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ─── Command Registration ───
# Symlink commands into ~/.claude/commands/devt/ for proper namespacing (devt:command)
COMMANDS_DIR="$HOME/.claude/commands/devt"
if [[ ! -d "$COMMANDS_DIR" ]] || [[ "$(readlink -f "$COMMANDS_DIR" 2>/dev/null)" != "$(readlink -f "$PLUGIN_ROOT/commands" 2>/dev/null)" ]]; then
  mkdir -p "$HOME/.claude/commands" 2>/dev/null || true
  rm -rf "$COMMANDS_DIR" 2>/dev/null || true
  ln -sf "$PLUGIN_ROOT/commands" "$COMMANDS_DIR" 2>/dev/null || true
fi

# ─── Project Detection ───

HAS_DEV_RULES="false"
[[ -d ".devt/rules" ]] && HAS_DEV_RULES="true"

HAS_DEVT_CONFIG="false"
[[ -f ".devt/config.json" ]] && HAS_DEVT_CONFIG="true"

# ─── Health Checks ───

MIGRATION_WARNINGS=""

# .devt/state/ exists but no .devt/rules/ (incomplete setup)
if [[ -d ".devt/state" && "$HAS_DEV_RULES" == "false" ]]; then
  MIGRATION_WARNINGS="${MIGRATION_WARNINGS}
Warning: .devt/state/ exists but .devt/rules/ is missing. Run /devt:init to set up project conventions."
fi

# ─── Workflow State Detection ───

STOPPED_AT=""
STOPPED_PHASE=""
WORKFLOW_TYPE=""
if [[ -f ".devt/state/workflow.yaml" ]]; then
  IFS=$'\n' read -r STOPPED_AT STOPPED_PHASE WORKFLOW_TYPE <<< "$(node -e "
    const fs = require('fs');
    try {
      const content = fs.readFileSync('.devt/state/workflow.yaml', 'utf8');
      const get = (key) => { const m = content.match(new RegExp('^' + key + ':\\\\s*(.+)$', 'm')); return (m && m[1].trim() !== 'null') ? m[1].trim() : ''; };
      [get('stopped_at'), get('stopped_phase'), get('workflow_type')].forEach(v => process.stdout.write(v + '\n'));
    } catch(e) { process.stdout.write('\n\n\n'); }
  " 2>/dev/null || printf '\n\n\n')"
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
  Fallback: cat \"\${TMPDIR:-/tmp}/devt-cache/plugin-root\" to read the resolved path

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
  RESUME_DETAIL="Previous session stopped at: ${STOPPED_AT}."
  [[ -n "$STOPPED_PHASE" ]] && RESUME_DETAIL="${RESUME_DETAIL} Phase: ${STOPPED_PHASE}."
  [[ -n "$WORKFLOW_TYPE" ]] && RESUME_DETAIL="${RESUME_DETAIL} Workflow: ${WORKFLOW_TYPE}."
  CONTEXT="${CONTEXT}

${RESUME_DETAIL} State in .devt/state/.
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

# ─── What's-New Surfacing ───
# Closes the doc-promotion gap where a project's Claude Code session only
# loads the project's CLAUDE.md, never devt's — new CHANGELOG entries
# never surface to the user. Per-machine version stamp under
# ~/.cache/devt/whats-new-seen — when the cached version differs from the
# installed VERSION, surface the CHANGELOG headline paragraph for this
# version once, then update the stamp so subsequent sessions stay silent.
CURRENT_VERSION=""
[[ -f "$PLUGIN_ROOT/VERSION" ]] && CURRENT_VERSION=$(tr -d '\n' < "$PLUGIN_ROOT/VERSION" 2>/dev/null)
WHATS_NEW_CACHE="${HOME}/.cache/devt"
WHATS_NEW_STAMP="${WHATS_NEW_CACHE}/whats-new-seen"
SEEN_VERSION=""
[[ -f "$WHATS_NEW_STAMP" ]] && SEEN_VERSION=$(tr -d '\n' < "$WHATS_NEW_STAMP" 2>/dev/null)

WHATS_NEW_MSG=""
if [[ -n "$CURRENT_VERSION" && "$CURRENT_VERSION" != "$SEEN_VERSION" ]]; then
  # Extract the headline paragraph of the [X.Y.Z] section in CHANGELOG.md.
  # Cap at 800 chars. When the version section is missing, fail silently.
  WHATS_NEW_MSG=$(node -e "
    (function() {
      const fs = require('fs');
      const path = require('path');
      try {
        const cl = fs.readFileSync(path.join(process.argv[1], 'CHANGELOG.md'), 'utf8');
        const v = process.argv[2];
        const lines = cl.split('\n');
        const startMarker = '## [' + v + ']';
        let i = lines.findIndex(l => l.startsWith(startMarker));
        if (i < 0) return;
        const header = lines[i].trim();
        i++;
        while (i < lines.length && lines[i].trim() === '') i++;
        const headline = [];
        let bytes = 0;
        const CAP = 800;
        while (i < lines.length && bytes < CAP) {
          const line = lines[i];
          if (line.startsWith('## [') || line.startsWith('### ')) break;
          if (line.trim() === '' && headline.length > 0 && headline[headline.length - 1] === '') break;
          headline.push(line);
          bytes += line.length + 1;
          i++;
        }
        const para = headline.join('\n').trim();
        if (!para) return;
        const out = header + '\n\n' + para;
        const truncated = out.length > CAP
          ? out.slice(0, CAP).trim() + '\n\n  ... see CHANGELOG.md for the full notes.'
          : out;
        process.stdout.write(truncated);
      } catch {}
    })();
  " "$PLUGIN_ROOT" "$CURRENT_VERSION" 2>/dev/null || true)

  if [[ -n "$WHATS_NEW_MSG" ]]; then
    mkdir -p "$WHATS_NEW_CACHE" 2>/dev/null || true
    echo "$CURRENT_VERSION" > "$WHATS_NEW_STAMP" 2>/dev/null || true
    CONTEXT="${CONTEXT}

What's new in devt v${CURRENT_VERSION}:
${WHATS_NEW_MSG}

(this announcement appears once per upgrade; cached at ${WHATS_NEW_STAMP})"
  fi
fi

# ─── Memory-Candidate Surfacing (B-III.1.a) ───
# When _suggestions.md has accumulated >= candidates_surface_threshold proposals
# AND cooldown has elapsed AND no active workflow, surface a one-liner hint and
# touch the cooldown timestamp so subsequent SessionStart fires in the same
# 24h window stay silent.
if [[ -z "$STOPPED_AT" && -z "$HANDOFF_INFO" ]]; then
  CANDIDATES_STATUS=$(node "${PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-status 2>/dev/null || echo '{"ready_to_surface":false}')
  READY=$(echo "$CANDIDATES_STATUS" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);console.log(j.ready_to_surface?'1':'0');}catch(e){console.log('0');}})" 2>/dev/null || echo "0")
  if [[ "$READY" == "1" ]]; then
    CC_COUNT=$(echo "$CANDIDATES_STATUS" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);console.log(j.count||0);}catch(e){console.log(0);}})" 2>/dev/null || echo "0")
    CONTEXT="${CONTEXT}

💭 ${CC_COUNT} memory candidates pending in .devt/memory/_suggestions.md — run /devt:memory promote when ready to triage. Hint will stay silent for ~24h after surfacing."
    node "${PLUGIN_ROOT}/bin/devt-tools.cjs" memory candidates-touch-surface >/dev/null 2>&1 || true
  fi
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
