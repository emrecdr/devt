# Specify — PRD Generation Through Interview

Generate a comprehensive Product Requirements Document by interviewing the user and analyzing the existing codebase.

<purpose>
Before any implementation, capture requirements systematically. The PRD becomes the source of truth
for /devt:plan (creates implementation plan from it) and /devt:workflow (implements it).

Without a spec, features grow organically during implementation — scope creeps, edge cases surface
late, and the developer makes design decisions that should be the user's call. A 15-minute interview
prevents hours of rework from wrong assumptions.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `.devt/rules/` directory exists with project conventions
- The user has provided a feature idea as the command argument (or will be prompted)
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<deviation_rules>
1. **Auto-fix: minor issues** — Fix typos, formatting, and obvious errors inline
2. **STOP: scope creep** — If the user starts requesting implementation during the interview, remind them that /devt:specify only captures requirements; suggest /devt:plan or /devt:workflow for implementation
3. **STOP: interview fatigue** — If the user shows signs of fatigue (>10 questions asked), wrap up with assumptions and proceed to PRD generation
4. **STOP: no codebase** — If .devt/rules/ is missing and no codebase context is available, warn the user and proceed with generic questions
</deviation_rules>

<process>

<step name="init" gate="feature idea is understood and codebase context loaded">
## Step 1: Initialize

Parse the feature idea from user input.
- If empty or too vague: ask for a one-sentence description via AskUserQuestion
- If clear: proceed

Load project context:
- Read `${CLAUDE_PLUGIN_ROOT}/references/questioning-guide.md` — how to interview effectively
- Read `.devt/rules/coding-standards.md` for naming/patterns
- Read `.devt/rules/architecture.md` for project structure
- Read `CLAUDE.md` if it exists
</step>

<step name="analyze" gate="codebase analysis complete">
## Step 2: Codebase Analysis

Before interviewing, analyze the codebase so your questions are contextual, not generic.
Generic questions ("How should we store data?") waste the user's time. Contextual questions
("The codebase uses the repository pattern for data access — should this feature follow the same
pattern or does it need something different?") show preparation and get better answers.

1. **Identify target area** — which part of the codebase does this feature touch?
2. **Read existing patterns** — what conventions does the project follow for similar features?
3. **Check for related functionality** — does something similar already exist? Avoid duplicates.
4. **Note conventions** — naming patterns, error handling, base classes, test patterns

Concrete analysis approach:
```
# Find related code by concept
Grep: the domain term across the codebase (e.g., "notification", "preference", "schedule")

# Check existing module structure
Glob: app/services/*/MODULE.md  (or src/*/README.md, etc.)

# Read the most relevant module's documentation
Read: MODULE.md or README of the target service/module

# Check for existing models, routes, tests in the target area
Glob: **/*feature_name*
```

Write a brief analysis summary (internal, not written to file yet):
- Target area: [which modules/files]
- Related code: [what already exists]
- Conventions: [patterns to follow]
- Gaps: [what doesn't exist yet]
</step>

<step name="interview" gate="all ambiguity resolved">
## Step 3: Systematic Interview

Use AskUserQuestion to cover ALL categories below. Continue until requirements are clear.

**Ask NON-OBVIOUS questions only.** Skip anything the feature description already answers.
The goal is to resolve ambiguity, not to confirm the obvious. If the user said "add email
notifications," do not ask "Should this feature send emails?" — ask "Should emails be sent
synchronously during the request or queued for background delivery?"

### Interview Categories

**Technical Implementation (3-5 questions)**
Architecture and data decisions that shape the entire implementation. Getting these wrong means
rewriting, not refactoring.
- Data model design choices
- API contract decisions (endpoints, request/response format)
- Storage/caching strategy
- Integration points with existing code

**Security & Permissions (2-3 questions)**
Access control decisions are expensive to retrofit. Defining them upfront prevents security
gaps that get discovered during code review.
- Who can access this feature? (roles, scopes)
- Audit requirements?
- Data sensitivity considerations

**Complexity & Scope (2-3 questions)**
The most important category for preventing scope creep. Explicitly defining what is OUT of
scope is as important as defining what is in scope.
- MVP vs full feature scope
- Phased rollout considerations
- What is explicitly OUT of scope?

**Migration & Integration (1-2 questions)**
How this feature connects to the existing system. Skip if the feature is entirely new
with no integration points.
- Does this replace or extend existing functionality?
- Backward compatibility or migration needs?
- External system dependencies?

**Edge Cases (2-3 questions)**
The scenarios that generate bugs and support tickets. Users rarely think about these unprompted,
so this category adds the most value from the interview.
- Concurrent access handling
- Error states and recovery
- Data validation rules

**Testing Strategy (1-2 questions)**
Defining test boundaries early prevents both over-testing (testing implementation details) and
under-testing (missing critical paths).
- Critical paths to test
- Integration points needing coverage

### Interview Rules

- Use `multiSelect: true` for feature toggles, capabilities, multiple selections
- Use `multiSelect: false` for mutually exclusive choices
- Provide 2-4 options with clear trade-off descriptions
- Include your recommendation with "(Recommended)" suffix and reasoning
- One question at a time — do not overwhelm
- Reference codebase findings: "I found X in the codebase, so I recommend Y"

### Example AskUserQuestion

```yaml
question: "How should notification preferences be stored?"
header: "Storage Strategy"
multiSelect: false
options:
  - label: "Dedicated database columns (Recommended)"
    description: "Queryable, matches existing user model pattern in the codebase, easy to validate"
  - label: "JSON field on user model"
    description: "Flexible schema for future expansion, but harder to query and no column-level constraints"
  - label: "Separate preferences table"
    description: "Clean separation, supports per-notification-type settings, but adds a JOIN for every preference read"
```
</step>

<step name="generate" gate="PRD file written">
## Step 4: Generate PRD

Create the spec file at TWO locations:
- `.devt/state/spec.md` — for workflow consumption by /devt:plan and /devt:workflow
- `docs/specs/{feature-slug}.md` — for permanent documentation (create `docs/specs/` directory if it does not exist)

Also extract decisions from the PRD's Decisions section into `.devt/state/decisions.md` so the code-reviewer can verify decision compliance.

Use the PRD template below. Fill ALL sections with interview answers. Do not leave placeholder
brackets — every section must contain real content from the interview.

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
</step>

<step name="validate_spec" gate="spec passes self-review">
## Step 5: Spec Validation

Before presenting to the user, self-review the generated PRD against these checks:

**1. Placeholder scan**: Search for unfilled template brackets `{`, `[`, `TBD`, `TODO`, or empty sections.
- If found: fill them from interview answers or remove the section if not applicable.

**2. Internal consistency**: Check for contradictions between sections.
- Does the API design match the data model?
- Do test scenarios cover the features listed in scope?
- Do tasks align with the implementation phases?

**3. Scope check**: Is the spec focused enough for a single workflow run?
- If the spec describes multiple independent features, flag it: "This spec covers N independent features. Consider splitting into separate specs."

**4. Ambiguity check**: Could any requirement be interpreted two different ways?
- Vague terms without definition ("fast", "secure", "user-friendly") → make them measurable
- Missing error behavior → add what happens on failure for each API endpoint

**5. Completeness check**: Are critical sections filled?
- Summary: present and specific (not generic)?
- Scope In/Out: both defined?
- Decisions: at least one decision with reasoning?
- Test scenarios: at least happy path + 1 error case?
- Tasks: at least 2 ordered tasks?

If validation finds issues, fix them inline. Do not ask the user about fixable issues — just fix them.
If a section is genuinely not applicable, remove it rather than leaving it empty.
</step>

<step name="report" gate="user informed of output">
## Step 6: Report

Tell the user:
- File path where PRD was written (both locations)
- Summary: user stories count, phases count, tasks count
- Any assumptions marked as "Assumed" that need validation
- Decisions that may need revisiting

Then ask the user what they want to do next via AskUserQuestion:

```yaml
question: "The spec is ready. What would you like to do next?"
header: "Next Step"
multiSelect: false
options:
  - label: "Create an implementation plan (/devt:plan)"
    description: "Break the spec into detailed, ordered tasks before coding — recommended for complex features"
  - label: "Start implementation now (/devt:workflow)"
    description: "Jump straight to the full development pipeline — the spec will be used as the primary requirements source"
  - label: "Clarify decisions first (/devt:clarify)"
    description: "Discuss remaining gray areas with more depth before planning"
  - label: "Done for now"
    description: "Save the spec and come back later"
```

If the user selects an action, execute the corresponding command with the feature description as the argument.
If "Done for now", report the file paths and stop.
</step>

</process>

## Best Practices

1. **Non-obvious questions only** — if the answer is implied by the feature description, do not ask
2. **Show your homework** — reference codebase findings in every question ("I found X, so I recommend Y")
3. **Cover all categories** — skipping security or edge cases creates gaps that surface during implementation
4. **Be specific in the PRD** — include field names, status codes, endpoint paths; vague specs produce vague implementations
5. **Order tasks by dependency** — later tasks should depend on earlier ones; the implementer should be able to work top-to-bottom
6. **Mark uncertainty explicitly** — if something was assumed rather than confirmed, mark it in the Assumptions table

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
|-------------|-------------|---------|
| Asking obvious questions | Wastes user's time, erodes trust | Only ask what the feature description does not answer |
| Generic questions without codebase context | Produces generic answers that may conflict with existing code | Analyze codebase first, then ask contextual questions |
| Skipping the "Out of Scope" section | Scope creeps during implementation because boundaries were never defined | Explicitly list what is NOT being built |
| Assumptions without marking them | Implementer treats assumptions as confirmed decisions, builds wrong thing | Always mark with "Assumed" and note impact if wrong |
| Too many interview questions (>12) | User fatigue leads to rushed answers | Batch related questions, skip obvious ones, aim for 6-10 |
| PRD with placeholder brackets left in | Downstream tools treat placeholders as real content | Fill every section or remove it if not applicable |

## Example Session

```
User: /devt:specify "Add rate limiting to public API endpoints"

Claude: [Reads .devt/rules/, analyzes codebase]
Claude: I analyzed the codebase and found:
- 12 public endpoints across 3 services
- No existing rate limiting implementation
- Redis is available (used for caching in services/cache/)
- The project uses dependency injection for service wiring

Let me ask a few questions to scope this:

[AskUserQuestion: Rate limiting strategy — per-IP, per-API-key, or per-user?]
[AskUserQuestion: Limits — fixed window, sliding window, or token bucket?]
[AskUserQuestion: Which endpoints — all public, or specific high-risk ones?]
[AskUserQuestion: What happens when limit is hit — 429 with retry-after, or silent throttle?]
[AskUserQuestion: Should admin endpoints be exempt?]

Claude: Based on your answers, I have generated the PRD.

Created:
- docs/specs/rate-limiting.md (permanent)
- .devt/state/spec.md (for pipeline)

Summary: 3 user stories, 2 phases, 8 tasks, 1 assumption needs validation

Next step: /devt:plan to create the implementation plan
```

<success_criteria>
- PRD file exists at docs/specs/{slug}.md AND .devt/state/spec.md
- All interview categories covered (not all questions — just all categories)
- Every decision has reasoning documented
- Tasks are atomic and dependency-ordered
- Test scenarios cover happy path + at least 2 error cases
- Assumptions are explicitly called out with impact assessment
- No placeholder brackets remain in the generated PRD
</success_criteria>
