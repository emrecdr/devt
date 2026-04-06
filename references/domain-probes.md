# Domain Probes

Structured techniques for discovering domain unknowns before implementation. Read this alongside the questioning guide when entering unfamiliar territory.

---

## Purpose

Requirements describe what the user wants. Domain probes uncover what they haven't thought about yet — the constraints, edge cases, and integration boundaries that surface mid-implementation and force rework.

Use these probes selectively. They are exploration tools, not checklists.

---

## Probe Categories

### Data Flow

Where data originates, how it transforms, and where it lands.

- "Where does this data come from — user input, another service, or a scheduled job?"
- "What happens when this data is missing or arrives late?"
- "Does this data need to be transformed before storage, or is it stored raw?"

### Authorization

Who is allowed to do what, and what happens when they can't.

- "Who can perform this action — any authenticated user, specific roles, or the owner only?"
- "What should happen when an unauthorized user attempts this — 403, silent redirect, or hidden UI?"
- "Are there role hierarchies where a higher role inherits lower permissions?"

### Temporal

Time-dependent behavior, ordering, and concurrency.

- "Can two users do this at the same time to the same resource? What wins?"
- "Does the order of operations matter, or are these steps independent?"
- "If this fails halfway, should it retry automatically or wait for manual intervention?"

### Edge Cases

Boundary conditions, empty states, and limits.

- "What does this look like when there's no data yet — empty list, onboarding prompt, or hidden section?"
- "Is there a maximum? What happens when it's reached — hard block, warning, or graceful degradation?"
- "What inputs are technically valid but semantically wrong? How should they be handled?"

### Integration

External dependencies and their failure modes.

- "Which external systems does this depend on? What happens when they're unreachable?"
- "Are there rate limits, quotas, or SLAs on the external APIs involved?"
- "Does the external system version its API? Which version are we targeting?"

### State Machine

Valid states, transitions, and terminal conditions.

- "What are the possible states this entity can be in?"
- "Which transitions are allowed — can you go from cancelled back to active?"
- "Is there a terminal state, or can this cycle indefinitely?"

---

## When to Probe

Use domain probes when:

- **Unfamiliar domain** — You're about to plan work in a domain you haven't touched before
- **Vague nouns** — The requirements mention "the system", "the process", or "the data" without specifics
- **Cross-module scope** — The task touches 3+ modules or services
- **State-driven behavior** — The feature involves entities that change state over time
- **External dependencies** — The task integrates with systems outside the codebase

## When NOT to Probe

Skip domain probes when:

- **Standard CRUD** — Simple create/read/update/delete with no special business logic
- **Established patterns** — The codebase already has a working example of the same pattern
- **Detailed spec exists** — The task has a PRD or spec that already covers edge cases and constraints
- **Trivial scope** — The task touches 1-2 files with no integration points

---

## Using Probes Effectively

**Pick 2-3 relevant categories.** Never run all six — that's an interrogation, not a conversation.

**Ground probes in the codebase.** Instead of "What happens when the service is down?", say "I see the payment service uses a 30-second timeout with no retry — should this new integration follow the same pattern?"

**Combine with the questioning guide.** Domain probes discover technical unknowns. The questioning guide discovers intent and motivation. Use both, but don't blur them — ask "why" questions and "what-if" questions in separate passes.

**Stop when you have enough.** If the answers reveal a well-understood domain with clear patterns, move on. Probing a domain the team knows well wastes everyone's time.
