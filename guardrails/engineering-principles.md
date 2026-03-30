# Engineering Principles

> Universal design principles that all devt agents MUST follow regardless of language, framework, or task type. These are not suggestions — they are the foundation of maintainable software.

## SOLID Principles

### S — Single Responsibility Principle (SRP)

Every module, class, function, and component should have **one reason to change**.

**Enforcement:**
- A function does ONE thing — if you need "and" to describe it, split it
- A service handles ONE domain concern — if it touches two DB tables from different domains, split it
- A component renders ONE feature section — if it has 3+ unrelated UI blocks, split it

**Violation signals:**
- Function/method with 5+ parameters
- Class with 10+ methods
- File with 500+ lines
- Function name contains "And" (`validateAndSave`, `fetchAndTransform`)

### O — Open/Closed Principle (OCP)

Software entities should be **open for extension, closed for modification**.

**Enforcement:**
- Add new behavior by adding new code (new function, new class, new handler) — not by modifying existing code with `if/else` branches
- Use strategy pattern, middleware chains, or plugin architectures for extensibility
- Prefer composition over deep inheritance

**Violation signals:**
- Growing `switch` statements that add a new `case` for every variant
- `if (type === 'X') ... else if (type === 'Y')` chains that grow over time

### L — Liskov Substitution Principle (LSP)

Subtypes must be **substitutable for their base types** without altering program correctness.

**Enforcement:**
- If a function accepts a base type, any subtype must work without surprises
- Don't override methods to throw `NotImplementedError`
- Don't tighten preconditions or loosen postconditions in subtypes

### I — Interface Segregation Principle (ISP)

Clients should **not depend on interfaces they don't use**.

**Enforcement:**
- Keep interfaces small and focused (1-3 methods)
- Split large interfaces into role-specific ones
- A consumer should import only what it needs

**Violation signals:**
- Interface with 5+ methods where most consumers use only 1-2
- Implementing a method as a no-op to satisfy an interface

### D — Dependency Inversion Principle (DIP)

High-level modules should **not depend on low-level modules**. Both should depend on abstractions.

**Enforcement:**
- Services depend on repository interfaces, not concrete database implementations
- Handlers depend on service interfaces, not concrete service classes
- Wire concrete implementations at the composition root (main/startup)

---

## DRY — Don't Repeat Yourself

Every piece of knowledge must have a **single, unambiguous, authoritative representation** in the system.

**Enforcement:**
- Before writing new code, SEARCH for existing implementations (Rule 1 from golden-rules)
- Extract repeated logic into shared functions, composables, or utilities
- Centralize configuration values — no hardcoded magic numbers or strings
- Constants, API endpoints, storage keys — define once, import everywhere

**When DRY goes too far (and KISS wins):**
- 3 similar lines of code is better than a premature abstraction
- Don't create a utility for something used exactly once
- If the abstraction is harder to understand than the duplication, keep the duplication

---

## KISS — Keep It Simple, Stupid

The simplest solution that works is the best solution.

**Enforcement:**
- Try the obvious approach first — only add complexity when the simple approach fails
- Don't design for hypothetical future requirements
- Don't add configuration for things that could just be code
- If a junior developer can't understand the code in 30 seconds, it's too complex
- Prefer explicit over clever: readable code > short code

**Violation signals:**
- Abstraction with one implementation and no plans for a second
- Generic framework for a specific problem
- Configuration system for values that never change
- "Flexible" API that no one uses flexibly
- Design pattern applied where a plain function would do

---

## SoC — Separation of Concerns

Each part of the system should address a **separate concern** with minimal overlap.

**Enforcement:**
- **Layer separation**: Views/controllers handle HTTP. Services handle business logic. Repositories handle data access. Each layer has ONE job.
- **Module separation**: Feature modules are self-contained. No cross-feature imports except through shared interfaces.
- **Component separation**: UI components handle rendering. Composables/hooks handle state and side effects. Stores handle shared state.

**Concrete rules:**
- Routes/handlers: Parse input, call service, format response — NO business logic
- Services: Orchestrate operations, enforce rules — NO HTTP concerns, NO SQL
- Repositories: Data access — NO business rules, NO HTTP
- Components: Render UI based on props — NO API calls (use composables/stores)

**Violation signals:**
- SQL queries in a route handler
- HTTP status codes in a service method
- Business validation in a database repository
- API calls inside a Vue template or React render function

---

## Applying These Principles

These principles are **constraints, not goals**. You don't "implement SOLID" — you use SOLID to evaluate design decisions:

1. **Before implementing**: "Does this approach violate any principle?"
2. **During code review**: "Does this change introduce a principle violation?"
3. **When refactoring**: "Which principle violation am I fixing?"

**Priority when principles conflict:**
1. **KISS** — simplicity wins over theoretical purity
2. **SRP/SoC** — separation is almost always worth it
3. **DRY** — but only when the duplication represents the SAME knowledge
4. **OCP/DIP** — add abstraction layers only when you have evidence of change

**The golden rule**: If applying a principle makes the code harder to understand, you're applying it wrong.
