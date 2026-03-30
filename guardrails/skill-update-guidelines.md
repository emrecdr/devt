# Skill Update Guidelines

Rules for proposing updates to skills, agents, and workflows via autoskill. The system improves through evidence, not intuition. These guidelines prevent speculative bloat and ensure every change to the plugin is justified by observed patterns.

---

## Evidence Threshold

Every proposed update MUST be backed by 3 or more evidence instances from actual sessions.

- Evidence must be specific: what happened, in which task, what the ideal behavior would have been
- Evidence must be from real sessions, not hypothetical scenarios
- Evidence instances should be independent — three occurrences in the same session of the same task count as one pattern, not three

**Why 3?** One instance is an incident. Two might be coincidence. Three is a pattern. Below this threshold, the observation is not mature enough to justify a system change.

---

## No Project-Specific Language

Proposed updates MUST NOT introduce language, patterns, or references tied to any specific project, framework, or language.

- No project names, file paths, or domain terminology
- No framework-specific API calls or library references
- No language-specific syntax in generic rules

**Test**: Would this update make sense to someone working on a completely different project in a different language? If not, it is project-specific and belongs in `.devt/rules/`, not in the plugin.

---

## No Breaking Changes

Proposed updates MUST NOT break existing skill behavior or invalidate current agent workflows.

- Adding a new step to a skill: acceptable
- Changing the meaning of an existing step: requires migration path
- Removing a step that agents depend on: requires proof that no workflow uses it
- Changing gate criteria: must be backward-compatible or explicitly versioned

**Test**: If this update were applied right now, would all existing workflows still work correctly?

---

## Before/After Comparison

Every proposal MUST include a before/after comparison showing the exact change.

```
BEFORE: [exact current text or behavior]
AFTER:  [exact proposed text or behavior]
```

This removes ambiguity about what is changing and allows the reviewer to evaluate the impact precisely. "Improve the scan step" is not a proposal — "Add 'check base classes' as step 3 in the scan sequence" is.

---

## Confidence Tiers

Proposals are classified by confidence based on evidence strength:

### HIGH Confidence
- 5+ evidence instances across multiple sessions
- Pattern is clear and unambiguous
- Fix is low-risk and narrowly scoped
- **Action**: Auto-apply (present to user as completed change)

### MEDIUM Confidence
- 3-4 evidence instances
- Pattern is clear but fix has moderate scope
- Change touches agent behavior or workflow logic
- **Action**: Present to user for review before applying

### LOW Confidence
- Fewer than 3 evidence instances
- Pattern is unclear or evidence is ambiguous
- Change is broad or touches multiple components
- **Action**: Reject. Collect more evidence before re-proposing.

---

## Red Flags

Stop and reconsider if any of these apply:

- **"This seems like it might be useful"** — Intuition is not evidence. Show the instances.
- **"Let's add this just in case"** — Speculative rules are noise. They slow agents and create confusion.
- **"The agent should know about everything"** — More context is not better context. Only add what solves a demonstrated problem.
- **"One really strong example is enough"** — It is not. Patterns require repetition.
- **"This is obviously needed"** — If it were obvious, it would already exist. Prove the need.
