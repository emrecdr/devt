# Quality Gate Verifier

Optional Stop hook that runs quality gate commands before allowing a devt workflow
to complete. When active, it checks for an active workflow in `.devt/state/workflow.yaml`,
reads the gate commands from `.devt/rules/quality-gates.md`, and blocks completion
if any command fails.

## Setup

Plugins CAN register Stop hooks of any type (command, prompt, agent) directly in
`hooks/hooks.json`. However, quality gate verification is best configured per-project
since the commands vary by stack. Add one of the options below to your project's
`.claude/settings.json` (or `~/.claude/settings.json` for user-wide).

### Option A: Prompt hook (lightweight, LLM-based judgment)

Uses a fast model to decide whether to block. Good for soft verification.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "The user has a devt workflow. Check if .devt/state/workflow.yaml has active: true. If not, respond {\"ok\": true}. If active, the workflow has quality gates in .devt/rules/quality-gates.md that must pass before stopping. Respond {\"ok\": false, \"reason\": \"Workflow still active — run quality gates before stopping\"} to keep Claude working. Context: $ARGUMENTS",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

### Option B: Agent hook (full verification with tool access)

Spawns a subagent that reads files and runs commands. Most thorough.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "agent",
            "prompt": "Check if .devt/state/workflow.yaml shows active: true. If not active, respond {\"ok\": true}. If active, read .devt/rules/quality-gates.md, run each command listed there, and respond {\"ok\": false, \"reason\": \"Quality gate failed: <details>\"} if any fail, or {\"ok\": true} if all pass. $ARGUMENTS",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

### Option C: Command hook (deterministic, no LLM cost)

Runs the bundled `scripts/run-quality-gates.sh` which extracts bash commands from
`.devt/rules/quality-gates.md` fenced code blocks and runs each one. Fastest and most
predictable — no LLM tokens consumed.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'if grep -q \"active: true\" .devt/state/workflow.yaml 2>/dev/null; then bash \"${CLAUDE_PLUGIN_ROOT}/scripts/run-quality-gates.sh\" || { echo \"{\\\"decision\\\": \\\"block\\\", \\\"reason\\\": \\\"Quality gates failed — run /devt:quality to see details\\\"}\" ; exit 0; }; fi'",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

For a simpler version that just blocks on active workflows without running gates:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'if grep -q \"active: true\" .devt/state/workflow.yaml 2>/dev/null; then echo \"{\\\"decision\\\": \\\"block\\\", \\\"reason\\\": \\\"devt workflow still active — run /devt:quality before stopping\\\"}\" ; else exit 0; fi'",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

## Notes

- The hook only activates when a devt workflow is active (`active: true` in `workflow.yaml`).
- Quality gate commands are defined per-project in `.devt/rules/quality-gates.md`.
  Run `/devt:init` to scaffold this file if it does not exist.
- If no active workflow is detected, the hook allows completion immediately (zero overhead).
- The existing `stop.sh` hook in devt's `hooks.json` already handles incomplete workflow
  detection. This verifier adds quality gate enforcement on top of that.
