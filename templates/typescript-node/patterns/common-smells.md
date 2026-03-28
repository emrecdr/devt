# Common Code Smells — TypeScript / Node

Anti-patterns to detect and fix during code review and development.

## `any` Type Usage

**Smell**: `any` type annotation anywhere in the codebase.

**Why it's bad**: Disables type checking entirely for that value. Defeats the purpose of TypeScript.

**How to detect**: `grep -rn ": any\|as any\|<any>" --include="*.ts" src/`

**Fix**: Use `unknown` with type guards, proper generics, or specific types.

## `@ts-ignore` / `@ts-expect-error`

**Smell**: TypeScript suppression comments.

**Why it's bad**: Silences legitimate type errors. The error is still there, just hidden.

**How to detect**: `grep -rn "@ts-ignore\|@ts-expect-error" --include="*.ts" src/`

**Fix**: Fix the underlying type issue. If the types are wrong, create proper type definitions.

## Default Exports

**Smell**: `export default` in any file.

**Why it's bad**: Inconsistent import names across consumers. Poor IDE auto-import. Harder to refactor.

**How to detect**: `grep -rn "export default" --include="*.ts" src/`

**Fix**: Use named exports exclusively.

## God Files (500+ lines)

**Smell**: Single file with 500+ lines of code.

**Why it's bad**: Too many responsibilities. Hard to navigate, test, and review.

**How to detect**: `find src/ -name "*.ts" -exec wc -l {} + | sort -rn | head -20`

**Fix**: Extract into focused modules. Each file should have one clear purpose.

## Callback Hell / Promise Chains

**Smell**: Nested `.then().then().catch()` chains or deeply nested callbacks.

**Why it's bad**: Hard to read, hard to debug, error handling is inconsistent.

**Fix**: Use `async/await` everywhere. Use `try/catch` for error handling.

## Barrel File Side Effects

**Smell**: `index.ts` files that do more than re-export — contain logic, initialization, or complex re-mapping.

**Why it's bad**: Importing one symbol pulls in the entire module graph. Can cause circular dependencies.

**Fix**: Keep barrel files to pure re-exports only. Move logic to dedicated files.

## Circular Dependencies

**Smell**: Module A imports from B, and B imports from A (directly or transitively).

**Why it's bad**: Undefined behavior at runtime (one module gets `undefined` for its imports). Breaks tree-shaking.

**How to detect**: `npx madge --circular src/`

**Fix**: Extract shared types/interfaces into a third module. Restructure the dependency graph.

## Mutable Global State

**Smell**: `let` variables at module scope, or singleton patterns with mutable state.

**Why it's bad**: Race conditions in concurrent requests. Impossible to test in isolation.

**How to detect**: `grep -rn "^let \|^var " --include="*.ts" src/ | grep -v "\.test\.\|\.spec\."`

**Fix**: Use dependency injection. Pass state through function parameters or constructor injection.

## Throwing Strings

**Smell**: `throw 'something failed'` or `throw { message: '...' }`.

**Why it's bad**: No stack trace, no error type, impossible to catch by type.

**Fix**: Always throw instances of `Error` subclasses.

## Nested Ternaries

**Smell**: `a ? b : c ? d : e ? f : g`

**Why it's bad**: Unreadable. Bugs hide in the precedence.

**Fix**: Use `if/else` or extract into a function with named conditions.

## Over-Mocking in Tests

**Smell**: More than 3 `jest.mock()` calls in a single test file, or mocking the module under test.

**Why it's bad**: Tests verify mock behavior, not real behavior. False confidence.

**Fix**: Use dependency injection instead. Mock at module boundaries only. Prefer integration tests.

## Empty Catch Blocks

**Smell**: `catch (e) {}` or `catch { /* do nothing */ }`.

**Why it's bad**: Silently swallows errors. The failure is invisible.

**Fix**: At minimum, log the error. Better: re-throw or handle explicitly.

## Hardcoded Magic Numbers

**Smell**: `if (status === 3)` or `setTimeout(() => {}, 5000)`.

**Why it's bad**: What does `3` mean? What's `5000`? Impossible to understand without context.

**Fix**: Extract to named constants: `const STATUS_ACTIVE = 3`, `const RETRY_DELAY_MS = 5000`.

## Missing `readonly` on Class Properties

**Smell**: Class properties that are set once in constructor but not marked `readonly`.

**Why it's bad**: Allows accidental mutation of dependencies. Defeats immutability guarantees.

**How to detect**: Check constructor assignments that lack `readonly` modifier.

**Fix**: Mark all constructor-injected dependencies as `readonly`.

## Direct Process.env Access

**Smell**: `process.env.SOME_VAR` scattered throughout the codebase.

**Why it's bad**: No validation, no type safety, no default values, impossible to test.

**Fix**: Centralize env var access in a config module. Validate with Zod at startup. Import typed config everywhere else.

## Synchronous I/O

**Smell**: `fs.readFileSync`, `execSync`, or any sync I/O in request-handling code.

**Why it's bad**: Blocks the event loop. One slow operation blocks all other requests.

**How to detect**: `grep -rn "Sync(" --include="*.ts" src/ | grep -v "_test\.\|\.spec\."`

**Fix**: Use async alternatives (`fs.promises.readFile`, `exec` with promisify).
