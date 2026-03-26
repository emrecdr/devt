# Documentation — Go

## Package-Level Comments

Every package must have a doc comment in one of its source files:

```go
// Package user provides user management services including
// registration, authentication, and profile management.
package user
```

## Exported Symbols

All exported functions, types, and constants must have doc comments:

```go
// FindByID retrieves a user by their unique identifier.
// Returns ErrNotFound if no user exists with the given ID.
func (s *Service) FindByID(ctx context.Context, id string) (*User, error)
```

## Comment Style

- Start with the symbol name: `// FindByID retrieves...`
- Describe behavior, not implementation
- Document error conditions and edge cases
- Use `godoc` format — renders in pkg.go.dev

## README Files

- `README.md` at project root — setup, build, run instructions
- `README.md` per significant internal package — optional but helpful for complex domains
- Keep README focused on HOW to use, not implementation details

## API Documentation

- Use OpenAPI/Swagger annotations or generate from code
- Document all endpoints, request/response schemas, error codes
- Include example requests and responses
