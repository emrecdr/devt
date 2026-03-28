# Common Code Smells

Anti-patterns to detect and fix during code review and development.

## Deep Nesting (4+ levels)

**Smell**: 4+ levels of nested conditionals.

**Why it's bad**: Hard to read, hard to test, usually indicates missing abstractions.

**Fix**: Use early returns (guard clauses), extract helper functions, or use table-driven logic.

## God Classes / God Modules

**Smell**: A single class or module with 20+ methods or 500+ lines.

**Why it's bad**: Violates single responsibility. Hard to navigate, hard to test independently.

**Fix**: Split into focused modules. Each module should do one thing.

## Silent Error Swallowing

**Smell**: Catching errors and doing nothing, or logging without propagating.

**Why it's bad**: Silent failures — the program continues in an invalid state.

**Fix**: Always handle errors explicitly. If truly ignorable, document why with a comment.

## Magic Numbers / Strings

**Smell**: Hardcoded values like `if (status === 3)` or `timeout = 30000`.

**Why it's bad**: No semantic meaning. Changes require hunting through code.

**Fix**: Extract to named constants or configuration. `const MAX_RETRIES = 3`.

## Duplicate Logic

**Smell**: Same logic repeated in 3+ places with minor variations.

**Why it's bad**: Changes must be applied everywhere. Easy to miss one.

**Fix**: Extract a shared function. If variations exist, parameterize the common parts.

## Primitive Obsession

**Smell**: Using raw strings/numbers where a domain type would be clearer (e.g., `userId: string` everywhere instead of a `UserId` type).

**Why it's bad**: No type safety. Easy to pass wrong values (user ID where order ID expected).

**Fix**: Create domain types or type aliases. Let the type system catch misuse.

## Long Parameter Lists

**Smell**: Functions with 5+ parameters.

**Why it's bad**: Hard to remember order. Easy to swap arguments.

**Fix**: Group related parameters into an options object or configuration struct.

## Test Logic in Production Code

**Smell**: Environment checks like `if (process.env.TESTING)` in non-test files.

**Why it's bad**: Test concerns leak into production. Creates untestable branches.

**Fix**: Use dependency injection. Tests inject mock implementations; production injects real ones.

## Dead Code

**Smell**: Commented-out code blocks, unused functions, unreachable branches.

**Why it's bad**: Adds noise. Creates false sense of intentionality.

**Fix**: Delete it. Git has the history if you need it back.

## Unclear Naming

**Smell**: Variables like `data`, `result`, `temp`, `x`, `handler2`.

**Why it's bad**: Reader must trace usage to understand purpose.

**Fix**: Name by what it represents: `userProfile`, `validationErrors`, `retryCount`.
