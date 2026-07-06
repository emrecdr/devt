---
name: ship
description: Create a pull request with auto-generated description from workflow artifacts — reads impl-summary, test-summary, and review verdict from .devt/state/
---

<tool_restrictions>
This workflow uses: Bash, Read, Glob, Grep
</tool_restrictions>

<objective>
Create a pull request with a rich, auto-generated description composed from the completed workflow's .devt/state/ artifacts (impl-summary.md, test-summary.md, review.md, decisions.md, preflight-brief.md). The PR body cites governing ADR/Concept/Flow ids consulted during the work and any REJ tombstones the implementation deliberately respected — reviewers can verify alignment without re-reading the Brief themselves.
</objective>

<process>
**Mandatory first action**: read `${CLAUDE_PLUGIN_ROOT}/workflows/ship.md` via the Read tool before any other action. The workflow body is NOT preloaded — the explicit Read is the only load path.

Then execute every `<step>` block in the file in order. Do NOT skip `context_init`. Do NOT dispatch any `Task(subagent_type="devt:*", ...)` without the workflow's `<scope_trust>`, `<scope_hint>`, and `<memory_signal>` blocks injected into the prompt — raw dispatches bypass the Graphify-first protocol and produce grep-quality output.

Execute the ship workflow from the referenced file end-to-end. Reads workflow artifacts, generates PR body, pushes branch, and creates the PR via gh CLI.
</process>
