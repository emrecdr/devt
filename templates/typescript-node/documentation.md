# Documentation — TypeScript / Node

## TSDoc / JSDoc

Every exported function, class, interface, type alias, and constant gets a doc comment:

```typescript
/**
 * Retrieves a user by their unique identifier.
 *
 * @param id - The user's UUID (branded as {@link UserId})
 * @returns The user entity, or `null` if not found
 * @throws {UnauthorizedError} If the caller lacks read permission
 *
 * @example
 * ```ts
 * const user = await findUserById(userId("550e8400-e29b-..."))
 * if (user) console.log(user.email)
 * ```
 */
export async function findUserById(id: UserId): Promise<User | null> { ... }
```

TSDoc is the official tag standard (microsoft/tsdoc). When in doubt, prefer TSDoc tags over legacy JSDoc tags — many tools (api-extractor, typedoc) parse TSDoc strictly.

## Required Sections

Three documentation sections are mandatory in the situations they describe:

### `@param` + `@returns`

Required on every public function with parameters or a non-`void` return:

```typescript
/**
 * Validates an email per the RFC-5321 subset this module supports.
 *
 * @param email - Candidate email string; not trimmed before validation
 * @returns `true` when well-formed, `false` otherwise
 */
export function validateEmail(email: string): boolean { ... }
```

### `@throws`

Required on every function that can throw. Document the error class:

```typescript
/**
 * @throws {ValidationError} When `input` fails schema validation
 * @throws {DatabaseError} When the underlying connection fails
 */
```

Functions returning a Result type (`{ok: true, data}` | `{ok: false, error}`) document via `@returns`, not `@throws`.

### `@example`

Required on every public API entry point. TSDoc fenced code blocks render in IDE tooltips + typedoc-generated sites:

```typescript
/**
 * @example
 * ```ts
 * import { Client } from "./client"
 *
 * const client = new Client({ apiKey: "..." })
 * const result = await client.send({ to: "user@example.com" })
 * ```
 */
```

### `@deprecated` + `@beta` + `@alpha`

Mark API stability explicitly:

```typescript
/**
 * @deprecated Use {@link findUserById} instead. Removed in v2.0.0.
 */
export function getUser(id: string): Promise<User> { ... }

/**
 * @beta — API may change before v1.0.0; do not depend on stability.
 */
export function experimentalBatch(items: Item[]): Promise<Result[]> { ... }
```

## Intra-Doc Links

Use `{@link Symbol}` to cross-reference other items — survives renames when tools support refactoring:

```typescript
/**
 * Wraps {@link Client} with retry logic. See {@link RetryOptions} for tuning.
 */
```

Modern editors (VS Code, IntelliJ) resolve these inline. typedoc + api-extractor validate them at build time.

## Comment Style

- Start with a one-sentence summary using third-person verb (`Retrieves`, `Validates`, `Computes`)
- Blank line, then longer-form explanation
- Use complete sentences with terminating punctuation
- Describe behavior + contracts, not implementation
- Document edge cases inline: nullability, error conditions, side effects

## Module-Level Documentation

Document each module via a TSDoc block at the top of the file:

```typescript
/**
 * @packageDocumentation
 *
 * User-domain types + validation rules.
 *
 * Primary entry points: {@link UserId} (branded ID), {@link User} (entity),
 * {@link createUser} (factory).
 *
 * @remarks
 * This module is the source of truth for user shape. Downstream code SHOULD NOT
 * reach into infrastructure to fetch user data — use {@link UserRepository} instead.
 */
```

## README Files

- `README.md` at repository root — install, run, build, deploy instructions
- For monorepos: `README.md` per package in `packages/<name>/README.md`
- Each significant feature module MAY have a README documenting its responsibilities + boundaries
- Keep READMEs focused on HOW to use, not internal mechanics — that's what TSDoc covers

For published packages (npm), the README is the package landing page on npmjs.com. Keep it focused, accurate, and example-driven.

## Generated API Docs

Two mainstream tools generate browsable docs from TSDoc:

| Tool | Choose when |
|---|---|
| [typedoc](https://typedoc.org/) | Single package, want quick HTML output, zero config |
| [@microsoft/api-extractor](https://api-extractor.com/) | Need rigorous public-API tracking (`.api.md` snapshot files), monorepo, want to catch unintentional breaking changes |

api-extractor pairs with api-documenter to render markdown — ideal for VuePress / Docusaurus sites.

### typedoc Quick Start

```bash
npm i -D typedoc
npx typedoc src/index.ts
```

```jsonc
// typedoc.json
{
  "entryPoints": ["src/index.ts"],
  "out": "docs",
  "validation": {
    "notExported": true,    // catch unintentionally-private exports
    "invalidLink": true,    // catch broken {@link ...}
    "notDocumented": true   // require docs on every public item
  }
}
```

Set `validation.notDocumented: true` to mirror Rust's `#![warn(missing_docs)]` semantics — every public item must have a TSDoc block.

## API Documentation (HTTP / gRPC)

- **OpenAPI / REST**: generate from code via `zod-to-openapi` + Fastify/Hono plugins, or hand-author the spec and run `openapi-typescript` to validate types match
- **gRPC**: protobuf service definitions in `proto/` are the source of truth; generated TS types document themselves via tsdoc comments synthesized from proto comments
- Document all endpoints, request/response schemas, error responses, status codes
- Include realistic example requests + responses

## Inline Comments

Default to writing no comments. Add one only when WHY is non-obvious:

- Hidden invariants (lock ordering, ABI requirements)
- Subtle constraints (this branch handles a Safari quirk; the API rejects empty arrays despite the type allowing them)
- Documented workarounds with issue links
- Behavior that would surprise a reader

Do NOT comment what well-named code already says. Do NOT add origin tags (`// added for issue #1234`) — that belongs in git history.

## Common Failures

- **Doc example references a private symbol** — typedoc / api-extractor flag this at validate time; either make it `export` or use a fenced example with imports
- **`@throws` documents the wrong error class** — refactor changed the type, doc didn't follow; tests would catch it if the test asserts the thrown class
- **`{@link}` to a renamed symbol** — caught by typedoc with `validation.invalidLink: true`
- **Missing `@param` on a destructured parameter** — TSDoc requires one `@param` block describing the whole object, then `@param obj.field` lines for individual fields
- **Hand-written URL where intra-doc link works** — breaks on rename, doesn't validate
