---
name: cancel-workflow
description: Abort the currently active workflow and reset state
---

<tool_restrictions>
This workflow uses: Bash, Read
</tool_restrictions>

<objective>
Abort any currently active devt workflow and reset the workflow state to idle. Use this when a workflow is stuck, no longer needed, or must be interrupted.
</objective>

<process>
Run the cancel workflow script directly:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/cancel-workflow.sh
```

Report the result to the user — confirm cancellation or indicate that no workflow was active.
</process>
