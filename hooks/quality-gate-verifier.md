# Quality Gate Verifier -- Reference

This document describes how to set up a quality gate verification step that runs
before workflow completion. Because Claude Code plugins cannot register `agent`
type Stop hooks (security restriction), this must be configured manually.

## What it does

When active, the verifier checks `.devt-state/workflow.yaml` for an active
workflow. If one is found it reads `.dev-rules/quality-gates.md` and executes
every command listed there. If any command fails the hook blocks the completion
with a structured error; otherwise it allows it.

## Manual setup

Add the following entry to your Claude Code `settings.json` hooks section:

```json
{
  "hooks": {
    "Stop": [
      {
        "type": "agent",
        "description": "Verify quality gates before workflow completion",
        "tools": ["Read", "Bash", "Glob", "Grep"],
        "instructions": "Check if .devt-state/workflow.yaml shows active workflow. If active, read .dev-rules/quality-gates.md and run the commands. If any fail, return: {\"decision\": \"block\", \"reason\": \"Quality gate failed: <details>\"}. If all pass or no active workflow, return: {\"decision\": \"allow\"}"
      }
    ]
  }
}
```

Settings file locations:

- **Project-level** (recommended): `<project-root>/.claude/settings.json`
- **User-level**: `~/.claude/settings.json`

## Notes

- The hook only activates when a devt workflow is in progress (`active: true`
  in `workflow.yaml`).
- Quality gate commands are defined per-project in `.dev-rules/quality-gates.md`.
  Run `/devt:init` to scaffold this file if it does not exist.
- If no active workflow is detected the hook returns `allow` immediately
  (zero overhead for normal sessions).
