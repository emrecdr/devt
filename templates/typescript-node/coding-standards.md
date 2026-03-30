# Coding Standards — TypeScript / Node

## Language & Runtime

- TypeScript 5+ with strict mode enabled
- `strict: true` in `tsconfig.json` — non-negotiable
- Node.js LTS version
- ESM modules preferred (`"type": "module"` in package.json)

## Type Safety

- No `any` — use `unknown` with type guards or proper generics
- Explicit return types on all exported functions
- Prefer `interface` over `type` for object shapes (better error messages, extendable)
- Use discriminated unions for state machines and variants
- Zod or similar for runtime validation at boundaries (API input, env vars)

## Naming Conventions

| Element    | Convention       | Example           |
| ---------- | ---------------- | ----------------- |
| Functions  | camelCase        | `getUserById()`   |
| Classes    | PascalCase       | `UserService`     |
| Interfaces | PascalCase       | `UserRepository`  |
| Constants  | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Files      | kebab-case       | `user-service.ts` |
| Enums      | PascalCase       | `UserRole.Admin`  |

- No `I` prefix on interfaces — `UserRepository`, not `IUserRepository`
- No `Impl` suffix on classes — name by what it IS, not what it implements

## Async Rules

- `async/await` everywhere — no raw Promise chains or callbacks
- Always handle errors in async code (try/catch or .catch())
- Use `Promise.all()` for independent concurrent operations
- Use `Promise.allSettled()` when partial failure is acceptable

## Exports

- Named exports only — no default exports
- One export per declaration for clarity
- Re-export from barrel files (`index.ts`) for public API of a module
- Keep barrel files shallow — only re-export, no logic

## Immutability

- `const` by default — `let` only when reassignment is necessary
- `readonly` on all class properties that don't change after construction
- `as const` for literal types and configuration objects
- Prefer `ReadonlyArray<T>` or `readonly T[]` for arrays that shouldn't mutate
- Use spread/map/filter for transformations — avoid in-place mutation

## Error Handling

- Custom error classes extending a base `AppError`
- Never throw plain strings or generic `Error`
- Typed error responses at API boundaries
- Use Result types (`{ok: true, data}` | `{ok: false, error}`) for expected failures in domain logic

## Code Structure

- Small functions: single responsibility, under 40 lines preferred
- Early returns to reduce nesting — guard clauses at top
- Maximum 3 levels of nesting
- Extract complex conditions into named booleans
- No dead code — delete unused functions, types, imports

## Module Organization

- Group by feature, not by type (no `controllers/`, `models/`, `services/` at root)
- Colocate related code: service + repository + types + tests together
- Shared utilities in a `common/` or `shared/` package with clear boundaries

## Dependencies

- Audit before adding — prefer standard library / small focused packages
- Pin versions in `package-lock.json` or equivalent
- No circular dependencies between modules
