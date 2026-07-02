# PRD Template (specify workflow — Step 4: Generate PRD)

Loaded on demand by `workflows/specify.md`'s `generate` step. Fill ALL sections with real interview answers; leave no placeholder brackets.

### PRD Template

```markdown
# {Feature Name}

## Summary
[2-3 sentences explaining what this feature does and why it matters]

## Context
- **Target Area**: {which part of the codebase — module, service, or directory}
- **Scope**: {MVP | Full | Phased}
- **Priority**: {HIGH | MEDIUM | LOW}
- **Created**: {YYYY-MM-DD}
- **Status**: Ready for Implementation

## User Stories

### Primary User Story
As a {user type}, I want to {action}, so that {benefit}.

### Additional Stories
- As a {user type}, I want to {action}, so that {benefit}.

## Scope

### In Scope (MVP)
- [Core feature 1]
- [Core feature 2]
- [Core feature 3]

### Out of Scope
- [Deferred feature 1] — reason for deferral
- [Deferred feature 2] — reason for deferral

## Decisions

| Topic | Decision | Reasoning |
|-------|----------|-----------|
| {topic} | {choice made} | {why this choice over alternatives} |

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/... | ... |
| POST | /api/v1/... | ... |

## Data Model

[Key entities and their relationships. Include field names, types, constraints.
For complex models, show the relationship diagram or parent-child structure.]

## Security
- **Access**: {who can access — roles, scopes}
- **Audit**: {what operations to log}
- **Validation**: {input validation rules and constraints}

## Test Scenarios

Happy Path:
  GIVEN: {precondition}
  WHEN: {action}
  THEN: {expected result}

Error Case:
  GIVEN: {precondition}
  WHEN: {invalid action}
  THEN: {error response with specific status code}

Edge Case:
  GIVEN: {boundary condition}
  WHEN: {action}
  THEN: {expected behavior}

## Success Criteria
- [ ] {Measurable criterion 1}
- [ ] {Measurable criterion 2}
- [ ] {Measurable criterion 3}

## Implementation Phases

### Phase 1: Foundation
**Goal:** {What this phase achieves}
- [ ] {Task 1}
- [ ] {Task 2}
**Validation:** {How to verify phase is complete — specific command or check}

### Phase 2: Core Features
**Goal:** {What this phase achieves}
- [ ] {Task 3}
- [ ] {Task 4}
**Validation:** {How to verify phase is complete}

### Phase 3: Polish & Testing
**Goal:** {What this phase achieves}
- [ ] Write tests for all endpoints
- [ ] Update module documentation
**Validation:** {How to verify phase is complete}

## Assumptions

| Assumption | Impact if Wrong | Confirmed? |
|------------|-----------------|------------|
| {Assumption 1} | {What breaks or needs rework} | Assumed |
| {Assumption 2} | {What breaks or needs rework} | Confirmed |

## Tasks

Atomic, dependency-ordered implementation tasks:
- [ ] {Task 1}
- [ ] {Task 2}
- [ ] {Task 3}
- [ ] Write tests
- [ ] Update documentation
```
