# Clarify Task

Pre-implementation step that identifies gray areas and captures decisions before any code is written.

---

<purpose>
Prevent wrong assumptions by discussing implementation choices with the user before coding.
This step is optional but recommended for STANDARD and COMPLEX tasks.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- The user has provided a task description as the command argument
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<deviation_rules>
1. **Auto-fix: minor issues** — Fix typos, formatting, and obvious errors inline
2. **STOP: scope creep** — If the task grows beyond clarification into implementation, suggest /devt:workflow or /devt:implement instead
3. **STOP: decision fatigue** — If the user expresses frustration with too many questions, capture remaining gray areas as assumptions and move on
</deviation_rules>

<process>

<step name="analyze" gate="gray areas identified">
## Step 1: Analyze the Task

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=clarify phase=context_init status=IN_PROGRESS stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null "task=${TASK_DESCRIPTION}"
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "${TASK_DESCRIPTION}"
```

The third call auto-fires the **Topic Pre-Flight Brief** — surfacing existing ADRs/Concepts/REJ tombstones for the topic. This is especially load-bearing for `/devt:clarify`: gray areas that match an active REJ tombstone do NOT need to be re-clarified — the team already decided. The Brief at `.devt/state/preflight-brief.md` is the first thing the agent should consult before listing gray areas.

Read `${CLAUDE_PLUGIN_ROOT}/references/questioning-guide.md` — how to question effectively. Follow the guide's philosophy: be a thinking partner, not an interviewer. **Critical sections**:
- "Before You Ask" — grep/Read the codebase before any question; only ask about decisions requiring user judgment
- "Walk the Decision Tree" — when multiple gray areas exist, resolve roots before dependents and cut subtrees on root answers
- "One at a Time" — AskUserQuestion supports up to 4 questions per call; use ONE unless they are genuinely independent

Read `${CLAUDE_PLUGIN_ROOT}/references/domain-probes.md` — structured probes for discovering domain unknowns, constraints, and edge cases. Use selectively based on the task's domain complexity.

Read `${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` — when a gray area is contentious enough to warrant offering `/devt:council` as a resolution path (threshold in §1; template in §2; capture in §3.2 — caller is `/devt:clarify`).

Load prior workflow artifacts (focus clarification on what's still ambiguous):
- Read `.devt/state/research.md` if it exists (from `/devt:research`) — research findings inform which areas are already settled and which still need clarification. Do NOT re-ask about technical approaches that research already recommended.
- Read `.devt/state/spec.md` if it exists (from `/devt:specify`) — focus gray area identification on what the spec left ambiguous or underspecified, not on topics the spec already covers in detail.

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

For each gray area:

1. **Evaluate against the council threshold** in `${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` §1. The gray area trips the threshold when ALL three conditions hold: multiple viable approaches with material trade-offs, hard to reverse, high stakes.

2. **If the threshold trips**, present the question via `AskUserQuestion` using the offramp template from §2 — list Option A and Option B with trade-offs AND include the "Run /devt:council" option AND the "Defer" option. **Soft cap**: at most 1 council invocation per `/devt:clarify` session. If multiple gray areas trip the threshold, surface that explicitly and ask the user to pick the highest-stakes one to council.

3. **If the threshold does not trip**, present the standard decision via `AskUserQuestion`:
   - The decision to make (one sentence)
   - Option A vs Option B (with trade-offs)
   - Your recommendation with reasoning
   - One question at a time

4. **When the user picks the council option**, follow `${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` §3 to invoke and resume. After the council returns, capture the verdict per §3.2 (clarify caller writes a new `DEC-xxx` entry in `.devt/state/decisions.md` referencing the transcript).

**Scope guardrail**: If the user suggests adding features beyond the task scope, acknowledge the idea and suggest capturing it as a follow-up. Do NOT expand the current task scope.
</step>

<step name="capture" gate="decisions document written">
## Step 3: Capture Decisions

Write `.devt/state/decisions.md` with:

- Task description
- Each decision with a **decision ID** (DEC-001, DEC-002, ...): what was decided, why, alternatives considered
- Any assumptions that were validated
- Scope boundaries confirmed

Decision IDs enable traceability — plan.md and impl-summary.md can reference specific decisions by ID (e.g., "Per DEC-003, using repository pattern").

```markdown
# Decisions

## Task
{task description}

## DEC-001: {decision title}
**Decision**: {what was decided}
**Why**: {reasoning}
**Alternatives**: {what was considered and rejected}

## DEC-002: {decision title}
...

## Assumptions
- {validated assumption}

## Scope
- In scope: {what's included}
- Out of scope: {what's excluded}
```

This document feeds into the programmer agent's context.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=false phase=complete status=DONE
```
</step>

</process>

<modes>
## Clarify Modes

This workflow supports two modes, selected by the user via the command argument:

### Default Mode (interview)
The standard process above: identify gray areas, ask questions one at a time, capture decisions.
Best for: new projects, unfamiliar domains, tasks with many unknowns.

### Assumptions Mode (`--assumptions`)
Codebase-first approach that minimizes user interaction:

1. **Scan**: Read 5-15 relevant source files to understand existing patterns, conventions, and data models
2. **Form assumptions**: For each gray area, form an assumption based on what the codebase already does
3. **Rate confidence**: Tag each assumption as **Confident** (strong codebase evidence), **Likely** (partial evidence), or **Unclear** (no evidence)
4. **Present for confirmation**: Show ALL assumptions to the user in a single batch:
   - Confident assumptions: "I'll proceed with these unless you object"
   - Likely assumptions: "These seem right based on the code — confirm or correct"
   - Unclear assumptions: "I need your input on these"
5. **Capture**: Write confirmed/corrected assumptions to `.devt/state/decisions.md` using the same DEC-xxx format

Best for: established codebases with clear patterns, tasks extending existing functionality.
Typical interaction count: 2-4 (vs 10-15 for interview mode).

The mode is determined by the command argument. If `--assumptions` is passed, use assumptions mode.
Otherwise, use default interview mode.
</modes>

<success_criteria>

- All identified gray areas have user decisions (or confirmed assumptions)
- Decisions captured in .devt/state/decisions.md with DEC-xxx IDs
- No unresolved ambiguity remains
  </success_criteria>

## Memory layer integration

At end of clarify, before writing decisions.md, run `node bin/devt-tools.cjs memory rejected-keywords`
and pre-reject any DEC matching a REJ tombstone (silently — surface only that the rejection
applied). After decisions.md is written, offer the user via AskUserQuestion: "Promote any
of these DECs to permanent ADRs?" (delegates to workflows/memory-promote.md → curator with
memory-curation skill). DECs not promoted stay ephemeral (existing behavior). The council
offramp's verdict capture (references/council-offramp.md) integrates here — chairman verdicts
matching the threshold can also seed ADR promotions.
