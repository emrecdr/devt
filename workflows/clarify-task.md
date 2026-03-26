# Clarify Task

Pre-implementation step that identifies gray areas and captures decisions before any code is written.

---

<purpose>
Prevent wrong assumptions by discussing implementation choices with the user before coding.
This step is optional but recommended for STANDARD and COMPLEX tasks.
</purpose>

<process>

<step name="analyze" gate="gray areas identified">
## Step 1: Analyze the Task

Read the task description and identify:
1. What is clearly specified (no ambiguity)
2. What has multiple valid approaches (gray areas)
3. What assumptions you would make if not asked

Focus on decisions the user CARES about — not technical trivia. Ask about:
- User-visible behavior choices (not internal implementation details)
- Data model decisions that are hard to change later
- Integration points where multiple approaches exist
- Scope boundaries (what's in vs out)
</step>

<step name="discuss" gate="all gray areas have decisions">
## Step 2: Present Gray Areas

For each gray area, present:
- The decision to make (one sentence)
- Option A vs Option B (with trade-offs)
- Your recommendation with reasoning

Use AskUserQuestion for each decision. One question at a time.

**Scope guardrail**: If the user suggests adding features beyond the task scope, acknowledge the idea and suggest capturing it as a follow-up. Do NOT expand the current task scope.
</step>

<step name="capture" gate="decisions document written">
## Step 3: Capture Decisions

Write `.devt-state/decisions.md` with:
- Task description
- Each decision: what was decided, why, alternatives considered
- Any assumptions that were validated
- Scope boundaries confirmed

This document feeds into the programmer agent's context.
</step>

</process>

<success_criteria>
- All identified gray areas have user decisions
- Decisions captured in .devt-state/decisions.md
- No unresolved ambiguity remains
</success_criteria>
