# Documentation — TypeScript / Node

## TSDoc / JSDoc

All exported functions, classes, and interfaces must have doc comments:

```typescript
/**
 * Retrieves a user by their unique identifier.
 *
 * @param id - The user's UUID
 * @returns The user entity, or null if not found
 * @throws {UnauthorizedError} If the caller lacks read permission
 */
export async function findUserById(id: string): Promise<User | null>;
```

## Comment Style

- Describe behavior and contracts, not implementation
- Document parameters, return values, and thrown errors
- Use `@example` for non-obvious usage patterns
- Complex business rules get inline comments explaining WHY

## README Files

- `README.md` at project root — setup, build, run, deploy
- `README.md` per package in monorepo setups
- Keep focused on HOW to use, not implementation details

## API Documentation

- Auto-generate from TypeScript types where possible (OpenAPI, GraphQL schema)
- Document all endpoints with request/response examples
- Include error response formats and status codes
- Keep API docs in sync with implementation (generated > hand-written)

## Module Documentation

- Each feature module may have a `README.md` describing its responsibilities
- Document domain boundaries and integration points
- Update when models, capabilities, or dependencies change
