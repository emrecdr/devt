# Coding Standards — TypeScript / Node

## Language & Runtime

- TypeScript 7+ — the native Go-based `tsc` (~10× faster full builds; the type system and inference are a structural port of 5.x/6.x, so your types don't change). Libraries pin an explicit floor in `package.json`.
- `strict: true` in `tsconfig.json` — non-negotiable
- Node.js 24 LTS (the active LTS; 22 is in maintenance until April 2027)
- ESM modules required (`"type": "module"` in `package.json`) — CommonJS only for legacy interop

### Running TypeScript without a build step (Node 24+)

Node 24 strips type annotations natively (on by default), so `node app.ts` Just Works — no `tsc` build, no loader, no `tsconfig.json` needed to run. Use it for dev, scripts, and production entry points alike.

Two things this does NOT relax:
- **Type-stripping does not type-check** — it only erases annotations. Keep `tsc --noEmit` as a CI gate, or broken types reach production.
- **Only erasable syntax runs** — no `enum`, no parameter properties (`constructor(private x: T)`), no `namespace`; those need code generation, not erasure. Prefer `const`-object / union types over `enum` and explicit field assignment over parameter properties. (`node --experimental-transform-types` handles them, but avoiding them keeps `node file.ts` portable.)

## Built-in Node APIs (Node 24+)

Modern Node projects use first-party features instead of reaching for dependencies:

- **`node:` prefix imports** (required for clarity):
  ```typescript
  import { readFile } from "node:fs/promises"   // ✓ explicit, future-proof
  import { readFile } from "fs/promises"        // ✗ ambiguous with bare-specifier resolution
  ```
- **`node --test`** — built-in test runner (stable since 18, recommended over Jest for greenfield)
- **`node --watch`** — built-in file watcher (replaces `nodemon` for most uses)
- **`node --env-file=.env`** — built-in env loader (replaces `dotenv` for most uses; Node 20.6+)
- **`AsyncLocalStorage`** (`node:async_hooks`) — request-scoped context without prop-drilling
- **`AbortSignal.timeout(ms)`** — built-in cancellation; pass to `fetch`, streams, etc.
- **`structuredClone(value)`** — built-in deep clone; replaces `JSON.parse(JSON.stringify(...))` and `lodash.cloneDeep`
- **`crypto.randomUUID()`** — built-in UUID v4

## Type Safety

- No `any` — use `unknown` with type guards or proper generics
- Explicit return types on all exported functions
- Prefer `interface` over `type` for object shapes (better error messages, extendable via declaration merging)
- `type` for unions, intersections, mapped + conditional types — situations interfaces can't express
- Use discriminated unions for state machines and variants
- Zod, valibot, or `@effect/schema` for runtime validation at boundaries (API input, env vars, JSON config)

## Modern TypeScript Idioms

### `satisfies` operator (TS 4.9+)

Constrain a value's shape WITHOUT widening its type:

```typescript
// WRONG — type is widened to Record<string, string>, loses literal info
const routes: Record<string, string> = {
  home: "/",
  user: "/users/:id",
}

// CORRECT — `satisfies` validates shape, preserves the literal type
const routes = {
  home: "/",
  user: "/users/:id",
} satisfies Record<string, string>

// routes.home is `"/"`, not `string` — usable in template-literal types
```

### `using` declarations + `AsyncDisposable` (TS 5.2+)

Deterministic resource cleanup without try/finally boilerplate:

```typescript
class DatabaseTransaction implements AsyncDisposable {
  async [Symbol.asyncDispose]() {
    await this.commit()
  }
}

async function transfer(amount: number) {
  await using tx = new DatabaseTransaction()
  await tx.debit(amount)
  await tx.credit(amount)
  // tx.commit() runs automatically at end of scope, even on throw
}
```

Use for: database connections, file handles, lock acquisitions, span ends. Requires `target: "es2022"` + `lib: ["esnext.disposable"]`.

### Const type parameters (TS 5.0+)

Preserve literal types in generic functions:

```typescript
// WITHOUT const — T is inferred as string
function first<T>(arr: T[]): T | undefined { return arr[0] }
first(["a", "b", "c"])  // T = string

// WITH const — T is inferred as the literal union
function first<const T>(arr: T[]): T | undefined { return arr[0] }
first(["a", "b", "c"])  // T = "a" | "b" | "c"
```

### `NoInfer<T>` utility type (TS 5.4+)

Disable inference for specific generic positions:

```typescript
function createState<T>(initial: T, validator: (value: NoInfer<T>) => boolean) { ... }

createState("hello", (value) => value.length > 0)
// `value` is `string` (inferred from initial), not contaminated by validator's narrower type
```

### Branded types (newtype pattern)

Prevent primitive ID confusion at compile time:

```typescript
type UserId = string & { readonly __brand: "UserId" }
type OrderId = string & { readonly __brand: "OrderId" }

function findUser(id: UserId): Promise<User> { ... }
function findOrder(id: OrderId): Promise<Order> { ... }

declare const u: UserId
findOrder(u)  // ❌ compile error — cannot pass UserId where OrderId expected
```

Construct via a validating factory: `function userId(s: string): UserId { ... }`.

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
- Use `AbortSignal.timeout(ms)` for cancellation; pass to `fetch`, streams, sub-tasks
- Use `AbortSignal.any([s1, s2])` to combine cancellation signals from multiple sources
- `AsyncLocalStorage` for request-scoped context (trace IDs, tenant IDs, user identity) — avoid prop-drilling through every function signature

## Top-Level Await

ESM allows `await` at module top level. Use for resource-init that must complete before first import:

```typescript
// db.ts
const url = process.env.DATABASE_URL ?? throwError("DATABASE_URL missing")
export const db = await connectToDatabase(url)  // module evaluation blocks until ready
```

Avoid for non-deterministic work (HTTP fetches, dynamic config) — slows every module-load on cold start.

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

> **ADR override note**: if a project ADR in `.devt/memory/decisions/` contradicts these standards, the ADR wins. ADRs are constitutional. Run `node bin/devt-tools.cjs memory list decision` to see what's binding.
