# Development Patterns

Universal development patterns that apply across languages, frameworks, and project types. These are reference patterns, not mandates. Each project chooses which patterns to follow and documents its choices in `.devt/rules/`. Agents should follow whatever patterns the project has adopted, and use this file as a reference when the project's rules reference these concepts.

---

## Repository Pattern

Separate data access from business logic through an interface.

**Principle**: Business logic depends on an abstraction (interface/contract), not on concrete data access code. The concrete implementation lives in the infrastructure layer and is injected at runtime.

**Why**: Testability (mock the interface in unit tests), flexibility (swap storage backends without changing business logic), clarity (each layer has one job).

**Key rules**:

- Services never import database sessions, query builders, or ORM-specific code
- Repositories never contain business logic, validation, or authorization
- Repository interfaces live with the domain that owns the data
- Cross-service data access goes through the owning service's interface, never by direct query

---

## Service Layer

Business logic lives in a dedicated service layer, separate from infrastructure and presentation.

**Principle**: A service orchestrates business operations — validation, authorization, state transitions, event emission. It does not know how data is stored or how requests arrive.

**Why**: Business rules are the most valuable code in the system. Isolating them makes them testable, portable, and readable. When business logic leaks into routes or repositories, it becomes scattered and untestable.

**Key rules**:

- Services accept and return domain objects or DTOs, not raw request/response formats
- Services call repositories through interfaces, never through direct database access
- One service per bounded context — avoid god services that do everything
- Complex workflows that span multiple domains use orchestration (one service coordinates), not direct cross-service calls inside a repository

---

## Dependency Injection

Loose coupling through constructor injection. Components declare what they need; the caller provides it.

**Principle**: A class receives its dependencies through its constructor (or framework-specific injection mechanism), rather than creating them internally or importing them globally.

**Why**: Testability (inject mocks), flexibility (swap implementations), visibility (dependencies are explicit in the constructor signature, not hidden inside methods).

**Key rules**:

- Dependencies are interfaces/abstractions, not concrete implementations
- Construction and configuration happen at the composition root (startup/bootstrap), not inside business logic
- No service locator pattern — dependencies are declared, not looked up at runtime
- If a class has too many constructor parameters, it likely has too many responsibilities

---

## Error Handling

Custom error hierarchy with centralized handling.

**Principle**: Application-level errors inherit from a base error class. A centralized handler maps error types to appropriate responses. Business logic raises domain-specific errors; the presentation layer translates them.

**Why**: Consistent error responses across the entire application. No scattered try/catch blocks in every route. New error types automatically get correct handling if they inherit from the base.

**Key rules**:

- All application errors inherit from a project-defined base error class
- Never raise generic/built-in exceptions from business logic
- Centralized error handler maps error types to response codes and formats
- Error classes carry structured context (what failed, which resource, which identifier) — not just a message string

---

## Guard Clauses

Validate inputs early. Return or raise immediately on failure.

**Principle**: Check preconditions at the top of a function. Handle the failure case and exit. The remaining function body handles only the success path, at a single level of indentation.

**Why**: Reduces nesting, improves readability, makes failure paths explicit. The reader sees all the ways a function can fail before they see the main logic.

**Key rules**:

- Validate at the function boundary, not deep inside nested logic
- One check per guard clause — do not combine unrelated validations
- Guards raise/return immediately — no setting flags for later checking
- After all guards pass, the remaining code can assume valid inputs

---

## Small Functions

Single responsibility. Each function does one thing and does it well.

**Principle**: Functions should be short enough to understand in one reading. If a function has multiple responsibilities, extract each into its own function with a descriptive name.

**Why**: Small functions are testable (one assertion per test), composable (build complex behavior from simple pieces), and readable (the function name tells you what it does, the body tells you how).

**Key rules**:

- If a function needs a comment explaining what a section does, that section should be a separate function with a descriptive name
- If a function has more than 2-3 levels of nesting, flatten it with extraction or early returns
- If a function takes more than 5-6 parameters, it likely needs a parameter object or should be split
- Helper functions should be pure when possible (same inputs produce same outputs, no side effects)

---

## Named Constants

No magic numbers, no magic strings. Every literal value with domain meaning gets a name.

**Principle**: When a literal value appears in code and its meaning is not immediately obvious from context, extract it into a named constant. The name documents the intent; the value is just an implementation detail.

**Why**: Readability (what does `86400` mean? `SECONDS_PER_DAY` is clear), maintainability (change the value in one place), discoverability (search for the constant name to find all usages).

**Key rules**:

- Constants are defined at module level, not inline
- Names describe the meaning, not the value: `MAX_RETRY_ATTEMPTS` not `THREE`
- Group related constants together (in a constants file, enum, or configuration object)
- Configuration values that change per environment belong in environment variables, not constants
