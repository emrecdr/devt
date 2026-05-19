---
name: update
description: Check for and install devt plugin updates from GitHub. Use --force to bypass cache.
argument-hint: "[--force]"
---

Check for newer versions of the devt plugin and guide the user through updating.

Use `--force` to bypass the 4-hour cache and check GitHub immediately.

@${CLAUDE_PLUGIN_ROOT}/workflows/update.md

**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/update.md` via the Read tool before any other action. The `@`-reference above may not be inlined by every harness; the explicit Read guarantees the workflow body is in context.

Then execute every `<step>` block in the file in order.
