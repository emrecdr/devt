# Review Checklist — Go

Language-specific review priorities. The code-reviewer reads this alongside `coding-standards.md`.

---

## CRITICAL — Security

- [ ] **SQL injection**: string concatenation in `database/sql` queries — use `$1` placeholders
- [ ] **Command injection**: unvalidated input in `os/exec` — validate and allowlist
- [ ] **Path traversal**: user-controlled paths without `filepath.Clean` + prefix check
- [ ] **Race conditions**: shared state without synchronization — use `sync.Mutex` or channels
- [ ] **Unsafe package**: usage without documented justification
- [ ] **Hardcoded secrets**: API keys, passwords in source — use environment variables
- [ ] **Insecure TLS**: `InsecureSkipVerify: true` without justification

## CRITICAL — Error Handling

- [ ] **Ignored errors**: `_` discarding error returns — handle or explicitly document why
- [ ] **Missing error wrapping**: `return err` without `fmt.Errorf("context: %w", err)`
- [ ] **Panic for recoverable errors**: use error returns, not panic
- [ ] **Missing `errors.Is`/`errors.As`**: use `errors.Is(err, target)` not `err == target`
- [ ] **Deferred close without error check**: `defer f.Close()` — check error on write paths

## HIGH — Concurrency

- [ ] **Goroutine leaks**: no cancellation mechanism — pass `context.Context`
- [ ] **Unbuffered channel deadlock**: sending without a receiver ready
- [ ] **Missing `sync.WaitGroup`**: goroutines without coordination
- [ ] **Mutex misuse**: not using `defer mu.Unlock()` after `mu.Lock()`
- [ ] **Context not propagated**: missing `ctx` parameter in function chains

## HIGH — Idiomatic Go

- [ ] **Non-idiomatic control flow**: `if/else` chains instead of early return
- [ ] **Package-level mutable variables**: global state — prefer dependency injection
- [ ] **Interface pollution**: defining interfaces consumers don't need — accept interfaces, return structs
- [ ] **Exported but unused**: public symbols not referenced outside the package
- [ ] **Error messages**: should be lowercase, no trailing punctuation

## HIGH — Resource Management

- [ ] **Unclosed resources**: HTTP response bodies, database connections, file handles
- [ ] **Missing `defer`**: resources opened without deferred cleanup
- [ ] **Context timeout**: long operations without `context.WithTimeout`

## MEDIUM — Performance

- [ ] **String concatenation in loops**: use `strings.Builder`
- [ ] **Missing slice pre-allocation**: `make([]T, 0, expectedCap)`
- [ ] **N+1 queries**: database queries in loops — batch or use joins
- [ ] **Unnecessary allocations**: object creation in hot paths
- [ ] **Deferred call in loop**: resource accumulation — close inside loop body

## MEDIUM — Best Practices

- [ ] **`ctx context.Context` first parameter**: standard convention
- [ ] **Table-driven tests**: prefer over individual test functions
- [ ] **Package naming**: short, lowercase, no underscores
- [ ] **Struct tags**: JSON/DB tags present and correct on exported structs
- [ ] **`fmt.Println`/`log.Println`** in production code — use structured logger
- [ ] **`log/slog`**: use `slog.Info`/`slog.Error` with key-value pairs, not `log.Println` or `fmt.Printf`
- [ ] **Pointer vs value receivers**: consistent within type; pointer if any method mutates
- [ ] **Nil slice in JSON**: return `[]T{}` not `var []T` for empty collections in API responses
- [ ] **`time.After` in select loop**: use `time.NewTimer` with `Reset()` instead

## MEDIUM — Testing Gaps

- [ ] New exported function without test
- [ ] Error paths not tested
- [ ] Race condition tests missing (`go test -race`)
- [ ] Missing table-driven test pattern for multi-case logic

## Diagnostic Commands

```bash
go vet ./...           # Static analysis
staticcheck ./...      # Extended checks
golangci-lint run      # Comprehensive linting
go build -race ./...   # Race detector (build)
go test -race ./...    # Race detector (tests)
govulncheck ./...      # Vulnerability scan
```

## Approval Criteria

- **Approve**: No CRITICAL or HIGH issues
- **Request changes**: Any CRITICAL or HIGH issue found
- **Note**: MEDIUM issues are advisory — mention but don't block
