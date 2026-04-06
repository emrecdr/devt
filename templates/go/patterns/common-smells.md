# Common Code Smells — Go

Anti-patterns to detect and fix during code review and development.

## Naked Returns

**Smell**: Named return values with `return` (no values) in functions longer than 5 lines.

**Why it's bad**: Readers must scan upward to find what's being returned. Easy to miss mutations.

**How to detect**: `grep -n "^[[:space:]]*return$" --include="*.go" -r .`

**Fix**: Use explicit returns. Named returns are acceptable only for short functions and `defer`-based error handling.

## Error Swallowing

**Smell**: `_ = someFunction()` or missing `if err != nil` after a call that returns error.

**Why it's bad**: Silent failures — the program continues in an invalid state.

**How to detect**: `grep -n "_ =" --include="*.go" -r .`

**Fix**: Always handle errors. If an error is truly ignorable, document why with a comment.

## init() Functions

**Smell**: `func init()` in any non-test file.

**Why it's bad**: Hidden initialization ordering, impossible to test, creates global state.

**How to detect**: `grep -rn "func init()" --include="*.go" .`

**Fix**: Move initialization into explicit constructors (`NewXxx`). Pass dependencies via function parameters.

## God Packages

**Smell**: Package with 20+ files or 5000+ lines of code.

**Why it's bad**: Violates single responsibility. Hard to navigate, hard to test independently.

**Fix**: Split into focused sub-packages. Each package should do one thing.

## Interface Pollution

**Smell**: Interface defined with 5+ methods, or interface defined next to its only implementation.

**Why it's bad**: Large interfaces couple consumers to implementation details. Producer-side interfaces prevent natural discovery.

**Fix**: Define small interfaces (1-3 methods) at the consumer. Let the implementation satisfy the interface implicitly.

## Goroutine Leaks

**Smell**: `go func()` without context cancellation or shutdown mechanism.

**Why it's bad**: Goroutine runs forever, consuming memory. No way to shut down cleanly.

**How to detect**: `grep -rn "go func" --include="*.go" . | grep -v "context\|cancel\|done\|errgroup"`

**Fix**: Use `errgroup`, pass `context.Context`, or use a done channel. Every goroutine must have an exit path.

## context.Background() in Application Code

**Smell**: `context.Background()` or `context.TODO()` outside of `main()` or test files.

**Why it's bad**: Loses cancellation propagation. Requests can't be timed out or cancelled.

**How to detect**: `grep -rn "context.Background\|context.TODO" --include="*.go" . | grep -v "_test.go\|main.go\|cmd/"`

**Fix**: Accept `context.Context` as first parameter and pass it through the call chain.

## Panics for Expected Errors

**Smell**: `panic()` or `log.Fatal()` in library or service code.

**Why it's bad**: Crashes the entire application instead of letting the caller handle the error.

**How to detect**: `grep -rn "panic(\|log.Fatal" --include="*.go" . | grep -v "_test.go\|main.go"`

**Fix**: Return errors. Let `main()` decide how to handle fatal conditions.

## String-Based Error Comparison

**Smell**: `err.Error() == "not found"` or `strings.Contains(err.Error(), ...)`.

**Why it's bad**: Fragile — error messages change. Not type-safe.

**Fix**: Use sentinel errors (`errors.Is(err, ErrNotFound)`) or custom error types (`errors.As(err, &target)`).

## Mutex Overuse

**Smell**: `sync.Mutex` protecting a simple counter or map in a request-scoped handler.

**Why it's bad**: Contention under load. Often unnecessary if the state is request-scoped.

**How to detect**: `grep -rn "sync.Mutex\|sync.RWMutex" --include="*.go" -r .`

**Fix**: Use channels for communication between goroutines. Use `sync.Map` only for high-read caches. For counters, use `atomic.Int64`.

## Deep Nesting (4+ levels)

**Smell**: `if { if { if { if {` — 4+ levels of nesting.

**Why it's bad**: Hard to read, hard to test, usually indicates missing abstractions.

**Fix**: Use early returns (guard clauses), extract helper functions, or use table-driven logic.

## Empty Struct Methods

**Smell**: Methods on a struct with no fields.

**Why it's bad**: If the struct has no state, the method is a plain function pretending to be OOP.

**Fix**: Use package-level functions instead. Structs are for grouping state with behavior.

## Hardcoded Timeouts

**Smell**: `time.Sleep(5 * time.Second)` or `ctx, cancel := context.WithTimeout(ctx, 30*time.Second)` with magic numbers.

**Why it's bad**: Not configurable, not testable, not documented.

**Fix**: Define timeout as a const or accept it as a configuration parameter.

## Test Logic in Production Code

**Smell**: `if os.Getenv("TESTING") == "true"` or `var testMode bool` in non-test files.

**Why it's bad**: Test concerns leak into production. Creates untestable branches.

**Fix**: Use interfaces and dependency injection. Tests inject mock implementations; production injects real ones.

## Raw SQL in Service Layer

**Smell**: SQL queries or `db.Query()` calls in service/handler code.

**Why it's bad**: Violates layer separation. SQL changes require touching business logic.

**Fix**: Put all data access in repository structs. Services call repository methods.

## time.After Leak in Select

**Smell**: `time.After()` inside a `for/select` loop.

**Why it's bad**: Each iteration creates a new timer that cannot be garbage collected until it fires. In tight loops, this leaks memory rapidly.

**How to detect**: `grep -rn "time.After" --include="*.go" . | grep -v "_test.go"`

```go
// WRONG — leaks a timer on every iteration
for {
    select {
    case msg := <-ch:
        process(msg)
    case <-time.After(5 * time.Second):
        return
    }
}

// CORRECT — reuse timer
timer := time.NewTimer(5 * time.Second)
defer timer.Stop()
for {
    timer.Reset(5 * time.Second)
    select {
    case msg := <-ch:
        process(msg)
    case <-timer.C:
        return
    }
}
```

## Nil Slice JSON Marshaling

**Smell**: Returning `var results []T` from API handlers.

**Why it's bad**: `nil` slice marshals to JSON `null`, not `[]`. Frontend code expecting an array gets null, causing crashes.

**How to detect**: Check API handlers that return slices — ensure empty results use `[]T{}` not `var []T`.

```go
// WRONG — JSON response: {"users": null}
var users []User
return json.NewEncoder(w).Encode(users)

// CORRECT — JSON response: {"users": []}
users := []User{}
return json.NewEncoder(w).Encode(users)
```
