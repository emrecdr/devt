# Contamination Guidelines

Quality filters for lessons, playbook entries, and knowledge captured during sessions. Not every observation is worth preserving. Low-value entries dilute the playbook, slow agent context loading, and create noise that masks real patterns.

---

## Reject: Project-Specific Debugging Steps

Lessons that describe how to fix a problem in one specific project's setup are too narrow to be useful elsewhere. They belong in that project's documentation, not in the shared knowledge base.

**Example of what to reject**: "When the user service fails, check that the Redis container is running on port 6380 because the default config uses a non-standard port."

**Why**: This is operational knowledge for one project. It does not generalize.

---

## Reject: Version-Specific Workarounds

Workarounds tied to a specific version of a tool, library, or runtime will expire. They are maintenance liabilities, not lessons.

**Example of what to reject**: "Library X version 2.3.1 has a bug in date parsing; use version 2.3.0 instead."

**Why**: The next version will fix it. The workaround becomes wrong advice.

---

## Reject: Obvious Facts

If every competent developer already knows this, it is not a lesson. Capturing obvious facts signals that the extraction process is scraping the bottom.

**Example of what to reject**: "Always test your code before deploying." "Use version control for source code." "Read error messages to understand what went wrong."

**Why**: These add zero value and dilute entries that matter.

---

## Require: Evidence

Every lesson must include what happened and what the result was. Lessons without evidence are opinions disguised as knowledge.

**Structure**: What was the situation? What action was taken (or not taken)? What was the outcome? What should be done differently?

**Example of what to reject**: "It's a good idea to scan for duplicates before creating new code."

**Example of what to accept**: "Agent created a duplicate DTO because it skipped the codebase scan. The review caught 47 lines of dead code. Adding a mandatory scan step before implementation prevented recurrence in the next 3 sessions."

---

## Require: Actionable Guidance

Every lesson must tell the reader what to DO differently. Observations without actions are trivia.

**Test**: Can someone read this lesson and change their behavior? If the answer is "interesting, but I don't know what to do with this" — it fails.

**Example of what to reject**: "Complex queries can be slow."

**Example of what to accept**: "When a query joins 4+ tables, extract it into a named scope on the repository with an explaining comment. This prevents N+1 patterns and makes the query testable in isolation."

---

## Summary: The Five Filters

| Filter | Question | Fail action |
|--------|----------|-------------|
| Specificity | Is this tied to one project's setup? | Move to project docs |
| Durability | Will this expire with a version bump? | Discard |
| Non-obviousness | Would a competent developer learn from this? | Discard |
| Evidence | Does this include what happened and the result? | Reject until evidence is added |
| Actionability | Does this tell the reader what to DO? | Reject until action is added |
