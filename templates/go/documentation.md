# Documentation — Go

## Package-Level Comments

Every package must have a doc comment in one of its source files (idiomatically the file matching the package name):

```go
// Package user provides user management services including
// registration, authentication, and profile management.
//
// The primary entry point is [Service]. Construct one via [NewService]
// and inject a [Repository] implementation.
package user
```

Package docs render as the landing page on pkg.go.dev. Open with "Package <name>" + a one-sentence summary, then expand.

## Exported Symbols

Every exported function, type, constant, and variable gets a doc comment:

```go
// FindByID retrieves a user by their unique identifier.
//
// Returns [ErrNotFound] if no user exists with the given ID.
// Returns a wrapped [context.DeadlineExceeded] if ctx is canceled.
func (s *Service) FindByID(ctx context.Context, id string) (*User, error)
```

Comment style:

- Start with the symbol name: `// FindByID retrieves...`
- Use full sentences with terminating punctuation
- Describe behavior, not implementation
- Document error conditions, side effects, edge cases

## godoc Format Rules

The `gofmt` toolchain enforces specific conventions parsed by pkg.go.dev:

- **Doc comments are above the declaration**, no blank line between
- **Pre-formatted blocks** start with extra indentation (4+ spaces) — used for code samples + ASCII tables
- **Doc links**: `[OtherSymbol]` resolves to symbols in the same package; `[pkg.Symbol]` references symbols in another package
- **Section headings**: any line consisting of a single word + capitalized letters becomes a heading (Go 1.19+); use `# Heading` form for clearer intent
- **URLs**: bare URLs become hyperlinks; wrap in brackets for hyperlink text: `[text](https://...)` is NOT supported — use `[text]: https://...` reference-link form

## Runnable Examples

Examples are real tests living in `<package>_test.go` files. They compile, run, and verify output:

```go
// Example covers ParseConfig with a minimal valid input.
func ExampleParseConfig() {
    cfg, _ := ParseConfig([]byte(`port = 8080`))
    fmt.Println(cfg.Port)
    // Output: 8080
}
```

The `// Output:` comment is mandatory; `go test` validates the printed output matches.

For unordered output (e.g., map iteration):

```go
func ExampleSet_iteration() {
    s := NewSet("a", "b", "c")
    for v := range s.Range() {
        fmt.Println(v)
    }
    // Unordered output:
    // a
    // b
    // c
}
```

Examples render as runnable, copy-paste-ready snippets on pkg.go.dev. Every exported function should have at least one — they document AND test AND demo simultaneously.

### Example Naming Conventions

| Function name | Documents |
|---|---|
| `Example` | the package as a whole |
| `ExampleParseConfig` | the `ParseConfig` function |
| `ExampleConfig` | the `Config` type |
| `ExampleConfig_Validate` | the `Validate` method on `Config` |
| `ExampleParseConfig_unordered` | a `ParseConfig` variant (suffix after `_`) |

## Inline Doc Links

Use `[Symbol]` syntax to cross-reference:

```go
// Open returns a [DB] handle. See [Config] for connection tuning.
// Errors from the underlying driver are wrapped with [fmt.Errorf]; use
// [errors.Is] to compare against sentinels.
```

These resolve in `gopls`, `godoc`, and pkg.go.dev. Survive renames when your editor supports symbol-aware refactors.

## README Files

- `README.md` at the module root — install, build, run, deploy instructions
- Each significant internal package MAY have a `README.md` — useful for complex domains
- Keep READMEs focused on HOW to use, not implementation details (which `godoc` covers)
- For public modules: the README is the GitHub landing page; keep it accurate + example-driven

## Doc Tests on Methods

```go
// CountWords returns the number of whitespace-separated words in s.
//
// Empty string returns 0. Multi-byte runes are counted as a single word
// when separated by ASCII whitespace.
func CountWords(s string) int { ... }

func ExampleCountWords() {
    fmt.Println(CountWords("hello world"))
    // Output: 2
}

func ExampleCountWords_empty() {
    fmt.Println(CountWords(""))
    // Output: 0
}
```

Multiple examples per function: suffix with `_<scenario>`. Each runs independently.

## Deprecation

Mark deprecated items with a `Deprecated:` paragraph; `gopls` surfaces a strikethrough in editors:

```go
// GetUser retrieves a user.
//
// Deprecated: Use [Service.FindByID] instead. This will be removed in v2.
func GetUser(id string) (*User, error)
```

## API Documentation (HTTP / gRPC)

- **HTTP/REST**: generate OpenAPI from code (`swaggo`, `huma`, `oapi-codegen`) or hand-author + lint
- **gRPC**: protobuf service definitions in `proto/` are the source of truth; comments propagate to generated Go
- Document all endpoints, request/response schemas, error codes, status codes
- Include realistic example requests + responses

## Module Documentation

Every Go module's `go.mod` declares its module path — that path IS the import URL on pkg.go.dev. Module-level docs live in:

- The package doc comment of the module's "main" package (often `package <modulename>`)
- A top-level `doc.go` file containing only the package comment, when the docs don't fit on any source file
- The repository `README.md` — entry point for new users

## Inline Comments

Default to writing no comments. Add one only when WHY is non-obvious:

- Hidden invariants (locking order, channel close ownership)
- Subtle constraints (this branch handles a specific TLS quirk; this allocation cannot escape per benchmark X)
- Documented workarounds with issue links
- Behavior that would surprise a reader

Do NOT comment what well-named code already says. Do NOT add origin tags (`// added for issue #1234`) — that belongs in git history.

## Common Failures

- **Example missing `// Output:` comment** — `go test` skips it silently; reviewers can't tell the example is unverified
- **Example uses a renamed symbol** — `go test ./...` catches at compile time; rename in docs alongside the code rename
- **Bare URL in comment renders ugly on pkg.go.dev** — fine for plain links; for inline text wrap differently per the Go 1.19+ doc-comment rules
- **`[Symbol]` link to a private name** — works in `gopls` but doesn't render on pkg.go.dev (which only shows exported symbols)
- **Multi-paragraph doc comment without blank lines** — godoc treats as one paragraph; insert blank `//` comment lines as paragraph breaks
