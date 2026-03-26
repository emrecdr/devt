# Testing Patterns — Go

## Table-Driven Tests

Primary testing pattern. Use subtests with `t.Run` for clear test case isolation:

```go
func TestParseToken(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    Token
        wantErr bool
    }{
        {name: "valid token", input: "abc.def.ghi", want: Token{...}},
        {name: "empty input", input: "", wantErr: true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := ParseToken(tt.input)
            if tt.wantErr {
                require.Error(t, err)
                return
            }
            require.NoError(t, err)
            assert.Equal(t, tt.want, got)
        })
    }
}
```

## Assertions

- `testing` package for zero-dependency tests
- `testify` (assert/require) for readable assertions — optional but recommended
- `require` for fatal conditions (stops test), `assert` for non-fatal checks

## HTTP Handler Tests

- Use `net/http/httptest` for handler testing — no external test servers
- Create request with `httptest.NewRequest`, record with `httptest.NewRecorder`
- Test full handler chain including middleware where relevant

## Integration Tests

- Use build tag: `//go:build integration`
- Separate from unit tests — run with `go test -tags=integration`
- Use real databases (testcontainers or Docker Compose)
- Each test manages its own data setup and teardown

## Mocking

- Prefer real implementations over mocks
- Use interfaces at consumption point — mock only the interface
- No mocking frameworks required — hand-written mocks are fine for Go
- If mocking becomes painful, the design likely needs refactoring

## Test Helpers

- Use `t.Helper()` in all test helper functions (correct error line reporting)
- `t.Cleanup()` for teardown instead of `defer` (runs even on `t.Fatal`)
- `t.Parallel()` for tests that can run concurrently
- `testdata/` directory for test fixtures (Go tooling ignores it)

## File Naming

- Test files: `*_test.go` in the same package
- Black-box tests: `package foo_test` (test exported API only)
- White-box tests: `package foo` (access unexported internals)
- Test helpers: `helpers_test.go` or `testutil_test.go`

## What NOT to Test

- Standard library behavior
- Generated code (protobuf, wire, etc.)
- Trivial struct constructors with no logic
