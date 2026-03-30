# {Feature Name}

## Summary
[2-3 sentences explaining what this feature does and why]

## Context
- **Target Area**: {which part of the codebase}
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
- [Deferred feature 1] — Phase 2
- [Deferred feature 2] — Future consideration

## Decisions

| Topic | Decision | Reasoning |
|-------|----------|-----------|
| {topic} | {choice} | {why} |

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/... | ... |
| POST | /api/v1/... | ... |

## Data Model

[Key entities and their relationships. Include field names, types, constraints.]

## Security
- **Access**: {who can access — roles, scopes}
- **Audit**: {what to log}
- **Validation**: {input validation rules}

## Test Scenarios

```yaml
Happy Path:
  GIVEN: {precondition}
  WHEN: {action}
  THEN: {expected result}

Error Case:
  GIVEN: {precondition}
  WHEN: {invalid action}
  THEN: {error response}

Edge Case:
  GIVEN: {boundary condition}
  WHEN: {action}
  THEN: {expected behavior}
```

## Success Criteria
- [ ] {Measurable criterion 1}
- [ ] {Measurable criterion 2}
- [ ] {Measurable criterion 3}

## Implementation Phases

### Phase 1: Foundation
**Goal:** {What this phase achieves}
- [ ] {Task 1}
- [ ] {Task 2}
**Validation:** {How to verify phase is complete}

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
| {Assumption 1} | {What breaks} | Assumed |
| {Assumption 2} | {What breaks} | Confirmed |

## Tasks

Atomic, dependency-ordered implementation tasks:
- [ ] {Task 1}
- [ ] {Task 2}
- [ ] {Task 3}
- [ ] Write tests
- [ ] Update documentation
