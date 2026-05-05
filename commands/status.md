---
name: status
description: Show current workflow status — what step completed, what's next, any blockers. Use when resuming work or checking progress.
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob
</tool_restrictions>

<objective>
Display the current workflow's progress: completed steps, pending steps, available artifacts, and suggested next action. Useful when resuming work or checking where a workflow left off.
</objective>

<execution_context>
@${CLAUDE_PLUGIN_ROOT}/workflows/status.md
</execution_context>

<process>
Execute the status workflow from the referenced file end-to-end. Reads workflow state and artifacts, then reports progress.

The status output also surfaces the Pre-Flight Brief state (FRESH | STALE | MISSING with generated_at timestamp) when `.devt/state/preflight-brief.md` exists — see `workflows/status.md` for the integration point. STALE means a prior File Pre-Flight detected scope expansion; re-run `/devt:preflight "<refined task>"` to refresh.
</process>
