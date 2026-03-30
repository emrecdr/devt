# Golden Rules — Go

> Non-negotiable rules for all development work. Violations require immediate stop and correction.

## Quick Reference Card

| Rule | One-Liner |
|------|-----------|
| 1. Deep Analysis | Scan ALL related code BEFORE implementing |
| 2. No Duplicates | NEVER reimplement existing features or utilities |
| 3. No Backward Compat | Update callers directly — no compatibility shims |
| 4. Boy Scout | Leave code CLEANER than you found it |
| 5. Error Wrapping | Every error returned MUST have context via `fmt.Errorf %w` |
| 6. Interface Discipline | Define interfaces at the consumer, not the producer |
| 7. No Package-Level State | No `var` globals, no `init()` — inject everything |
| 8. Context Propagation | Every I/O function accepts `context.Context` as first parameter |
| 9. One Obvious Way | If it exists, reuse it; don't build a second path |
| 10. Goroutine Ownership | Every goroutine has an owner, a shutdown path, and error reporting |
| 11. No TODOs/Markers | Complete code only — no placeholders or temporal markers |
| 12. Verify Before Done | No completion claims without fresh `go test` evidence |

---

## Rule 1: Deep Analysis Before Implementation

```
NO IMPLEMENTATION WITHOUT CODEBASE SCAN. NO EXCEPTIONS.
```

### Required Process

Before ANY implementation work:

1. **Scan target package**: Read EVERY file in the target package directory
2. **Scan interfaces**: Check `internal/` for existing interfaces the new code should implement
3. **Scan shared packages**: Check `pkg/` and `internal/common/` for utilities that already solve your subproblem
4. **Scan tests**: `*_test.go` files reveal actual behavior, not just intent

### Violation Examples

- Implementing a `ParseDuration()` helper when `time.ParseDuration()` exists in stdlib
- Creating a new HTTP client wrapper when the project already has one in `pkg/httpclient/`
- Adding a new error type when `errors.New()` or an existing sentinel error covers the case

---

## Rule 2: No Duplicate Features

Search before creating:

```bash
grep -r "func.*FunctionName" --include="*.go" .
grep -r "type.*TypeName" --include="*.go" .
```

If a function, type, or pattern already exists — reuse it. If it doesn't fit exactly, extend it. Creating a parallel implementation is always wrong.

---

## Rule 3: No Backward Compatibility Code

Prefer direct changes over compatibility layers. No:

- Deprecated function aliases
- `// Deprecated:` wrappers
- Feature flags for old behavior
- Compatibility shims between old and new APIs

Just change the code. Update all callers. Delete the old path.

---

## Rule 4: Boy Scout Rule

Every commit leaves the codebase cleaner:

- Remove dead code you encounter (unused functions, unreachable branches)
- Fix `golangci-lint` warnings in files you touch
- Simplify overly complex conditions in code you read
- Update stale comments in functions you modify

---

## Rule 5: Error Wrapping with Context

```go
// CORRECT — caller knows what failed and where
if err != nil {
    return fmt.Errorf("create user %q: %w", username, err)
}

// WRONG — no context
if err != nil {
    return err
}

// WRONG — loses the original error chain
if err != nil {
    return fmt.Errorf("failed: %v", err)  // %v instead of %w
}
```

Every error returned from a function MUST add context that answers: "What operation failed, and with what input?"

Use `%w` to preserve the error chain. Use sentinel errors (`errors.Is`) for known conditions.

---

## Rule 6: Interface Discipline

```go
// CORRECT — interface defined where it's consumed
// In package "handler":
type UserFinder interface {
    FindByID(ctx context.Context, id string) (*User, error)
}

// WRONG — interface defined alongside implementation
// In package "user":
type UserService interface { ... }  // Don't do this
type userService struct { ... }
```

**Rules:**
- Define interfaces at the consumption point, not next to the implementation
- Keep interfaces small: 1-3 methods maximum
- Name by what they DO, not what they ARE: `Reader`, `Validator`, `Finder`
- Accept interfaces, return structs

---

## Rule 7: No Package-Level State

```go
// WRONG
var db *sql.DB
func init() {
    db, _ = sql.Open(...)
}

// CORRECT
type Service struct {
    db *sql.DB
}
func NewService(db *sql.DB) *Service {
    return &Service{db: db}
}
```

**Why:** Package-level state creates hidden dependencies, makes testing impossible without global mutation, and introduces initialization ordering bugs.

**Exception:** `var ErrNotFound = errors.New("not found")` — sentinel errors are acceptable as package-level vars.

---

## Rule 8: Context Propagation

```go
// CORRECT
func (s *Service) GetUser(ctx context.Context, id string) (*User, error) {
    return s.repo.FindByID(ctx, id)
}

// WRONG — no context
func (s *Service) GetUser(id string) (*User, error) {
    return s.repo.FindByID(context.Background(), id)
}
```

Every function that does I/O (database, HTTP, file, gRPC) MUST accept `context.Context` as its first parameter. Never use `context.Background()` in application code — that's for `main()` and tests only.

---

## Rule 9: One Obvious Way

Before building a solution, search for existing approaches in the codebase:

- Is there already a middleware that does this?
- Is there already a repository method that fetches this data?
- Is there already an error type for this case?
- Is there already a test helper for this setup?

If yes — use it. If it doesn't quite fit, extend it. Two ways to do the same thing is always worse than one.

---

## Rule 10: Goroutine Ownership

Every goroutine must satisfy:

1. **Has an owner**: The function that spawns it is responsible for its lifecycle
2. **Has a shutdown path**: Responds to context cancellation or a done channel
3. **Reports errors**: Errors are collected (via `errgroup` or error channel), never silently dropped

```go
// CORRECT — errgroup handles lifecycle + errors
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error {
    return processItems(ctx, items)
})
if err := g.Wait(); err != nil {
    return fmt.Errorf("processing: %w", err)
}

// WRONG — fire and forget
go processItems(items)  // Who waits? Who catches errors?
```

---

## Rule 11: No TODOs or Placeholders

```go
// WRONG
func CreateUser(ctx context.Context, u User) error {
    // TODO: implement validation
    return nil
}

// WRONG
func GetReport() Report {
    return Report{} // placeholder
}
```

Ship complete code or don't ship. If you can't complete a function, surface it as BLOCKED in your summary.

---

## Rule 12: Verify Before Claiming Done

Before reporting DONE:

```bash
go test ./... -race -count=1
golangci-lint run ./...
go vet ./...
```

All three must pass. Copy the terminal output as evidence. "I believe the tests pass" is not verification — "Here is the output showing 0 failures" is.
