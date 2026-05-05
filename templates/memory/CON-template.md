---
id: CON-000
title: "Concept Title"
doc_type: concept
domain: "general"
status: candidate              # candidate | active | superseded
confidence: explicit
summary: "Definition of a core domain concept, model, or term used throughout the codebase. ≤ 200 chars."
affects_paths:
  - "src/domain/**"
affects_symbols:
  - DomainModelClass
links:
  # - id: FLOW-001
  #   type: relates_to
created_at: "2026-01-01T00:00:00Z"
created_by: user
schema_version: 1
---

# Concept: Title

## Definition

In plain English, what is this concept? Treat the reader as someone onboarding to the
codebase — no shared assumptions about prior context.

## Logic & Constraints

The rules that govern this concept. What invariants must hold? What's the shape of valid
state? What operations preserve vs. break the invariant?

- Rule 1: ...
- Rule 2: ...
- Rule 3: ...

## Related Components

The classes, modules, services, or schemas that implement this concept. Use exact symbol
names so Graphify can bind the concept to code (when enabled).

- `ClassName` (src/domain/file.ts)
- `RelatedClass` (src/domain/other.ts)

## Boundaries

What is NOT part of this concept? What adjacent concepts get confused with it? Naming
the boundary is often as important as defining the core.
