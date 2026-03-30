# Task Handoff Template

Standardized format for dispatching work to agents. Every agent receives the same structure,
ensuring no context is lost between workflow phases.

## Template

```markdown
# Task: {title}

## Context
- **Tier**: {TRIVIAL|SIMPLE|STANDARD|COMPLEX}
- **Target area**: {modules/services affected}
- **Iteration**: {N} (1 = first attempt, 2+ = fix iteration)

## Objective
{One paragraph: what to build/fix/review and why}

## Acceptance Criteria
- [ ] {Measurable criterion 1}
- [ ] {Measurable criterion 2}
- [ ] {Measurable criterion 3}

## Prior Artifacts
{List only artifacts that exist — do NOT reference missing files}
- spec.md: {summary of key requirements, or "none"}
- research.md: {recommended approach, or "none"}
- decisions.md: {key decisions with DEC-xxx IDs, or "none"}
- plan.md: {task breakdown, or "none"}
- scan-results.md: {patterns found, or "none"}
- arch-review.md: {architectural constraints, or "none"}
- review.md: {findings to address — only on fix iterations, or "none"}
- verification.md: {gaps to close — only on verify iterations, or "none"}

## Constraints
- Follow .devt/rules/coding-standards.md
- Follow .devt/rules/architecture.md (if exists)
- Pass quality gates in .devt/rules/quality-gates.md
- {Any additional constraints from spec or decisions}

## Test Scenarios (for tester)
{Only included when dispatching to tester agent}

Happy Path:
  GIVEN: {precondition}
  WHEN: {action}
  THEN: {expected result}

Error Case:
  GIVEN: {precondition}
  WHEN: {invalid action}
  THEN: {error response}

## Handoff Notes
{Context the next agent needs — what was done, what was tricky, what to watch out for}
```

## Usage

Workflows use this template when dispatching agents via `Task()`. The workflow fills in the
template fields from available `.devt/state/` artifacts and passes it as the agent's prompt.

Not every field is needed for every agent:
- **Programmer**: needs objective, acceptance criteria, prior artifacts, constraints
- **Tester**: needs objective, acceptance criteria, test scenarios, impl-summary
- **Code-reviewer**: needs objective, acceptance criteria, impl-summary, test-summary
- **Verifier**: needs objective, acceptance criteria, all prior artifacts
- **Docs-writer**: needs objective, impl-summary, test-summary, review

The handoff notes section is written by the workflow based on the previous agent's output
and any concerns flagged during the workflow.
