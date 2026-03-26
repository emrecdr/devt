# Coding Standards — Go

## Language & Runtime

- Go 1.22+
- Use standard library first, external dependencies second
- Modules with `go.mod` — never vendor without reason

## Error Handling

- Always return errors — never panic for expected conditions
- Wrap errors with context using `fmt.Errorf("operation failed: %w", err)`
- Check errors immediately after the call — no deferred error checking
- Sentinel errors for known conditions: `var ErrNotFound = errors.New("not found")`
- Custom error types for errors needing structured data
- Use `errors.Is()` and `errors.As()` for error inspection

## Naming Conventions

| Element       | Convention          | Example                     |
|---------------|---------------------|-----------------------------|
| Packages      | short, lowercase    | `user`, `auth`, `storage`   |
| Interfaces    | -er suffix          | `Reader`, `Validator`       |
| Exported      | CamelCase           | `FindUserByID`              |
| Unexported    | camelCase           | `parseToken`                |
| Acronyms      | ALL CAPS            | `HTTPClient`, `userID`      |
| Constants     | CamelCase           | `MaxRetryCount`             |

- Short variable names in small scopes: `i`, `n`, `r`, `w`
- Descriptive names for larger scopes: `userRepository`, `tokenValidator`
- Receiver names: short, consistent, 1-2 letters (`s` for service, `r` for repo)

## Package Design

- Small, focused packages with clear purpose
- No `util`, `common`, `helpers`, or `misc` packages — find a better name
- Package name should describe what it provides, not what it contains
- Avoid package-level state — prefer dependency injection

## Concurrency

- Prefer channels for communication between goroutines
- Use mutexes only for protecting shared state within a struct
- Always pass `context.Context` as first parameter for cancellation
- Use `errgroup` for managing groups of goroutines
- Never start goroutines without a way to stop them (context or done channel)
- Channel direction in function signatures: `ch <-chan T` or `ch chan<- T`

## Initialization

- No `init()` functions — they create hidden dependencies and ordering issues
- Explicit initialization via constructors: `func NewService(deps) *Service`
- Use `sync.Once` for lazy initialization if truly needed
- Configuration via structs, not package-level vars

## Struct Design

- Keep structs focused — single responsibility
- Embed interfaces for composition, not concrete types
- Use functional options for complex constructors: `func WithTimeout(d time.Duration) Option`
- Zero values should be useful where possible

## Code Style

- `gofmt` / `goimports` are non-negotiable — always formatted
- No dead code — delete unused functions, types, variables
- Early returns to reduce nesting
- Limit line length to ~100 characters for readability
- Group related declarations with `const` / `var` blocks
