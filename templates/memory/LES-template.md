---
id: LES-000
title: "Imperative — what to do or check"
doc_type: lesson
domain: "general"
status: active                  # candidate | active | superseded
confidence: explicit            # verified | explicit | inferred | observed | speculative
summary: "One-sentence summary, ≤ 200 chars, used as the FTS5 indexed surface for high-speed search."
affects_paths:
  - "src/module/**"
affects_symbols:
  # - SymbolName
links:
  # Cross-references to related docs. Forward references are allowed.
  # - id: LES-001
  #   type: supersedes            # supersedes | depends_on | implements | relates_to
created_at: "2026-01-01T00:00:00Z"
created_by: curator              # user | curator | retro | council | manual
schema_version: 1
---

# LES-000: Imperative — what to do or check

## Trigger

The recurring situation where this lesson applies. Be concrete: what conditions must hold,
what code paths or workflows are in play, what symptoms tell you you're here. Avoid vague
framing like "in some cases" — name the case.

## Action

The specific thing to do when the trigger condition recurs. Imperative voice, single
sentence preferred: "Run `grep -rn 'class.*Error' core/` before defining a new error type."
If multiple steps, number them. The reader should be able to act without further research.

## Evidence

What happened in a real workflow that proved this lesson. Cite the artifact: "review.md
flagged this at file:line in the workflow on YYYY-MM-DD" or "test-summary noted a
regression where N existing tests broke." Lessons without evidence are platitudes — every
LES doc must point at a concrete instance.

## Related

Optional: cross-references to ADRs/Concepts/Flows that explain the underlying constraint
this lesson protects. If a lesson keeps recurring against the same architectural rule,
that's a signal the rule needs reinforcement (e.g., adding a guardrail or a smoke test).
