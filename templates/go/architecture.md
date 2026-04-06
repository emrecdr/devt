# Architecture — Go

## Pattern: Clean Architecture

Dependencies flow inward. Domain has no external dependencies.

```
Handler (HTTP) -> Service (use cases) -> Domain (entities, interfaces)
       |                |
  Repository (database, external APIs)
```

## Project Layout

```
cmd/
    <app-name>/
        main.go              # Entry point, wiring
internal/
    domain/
        models.go            # Business entities, value objects
        errors.go            # Domain errors
        interfaces.go        # Repository and service contracts
    service/
        user_service.go      # Business logic, use cases
    repository/
        postgres/
            user_repo.go     # PostgreSQL implementation
    handler/
        http/
            user_handler.go  # HTTP handlers
            middleware.go    # HTTP middleware
            router.go        # Route registration
pkg/
    <reusable>/              # Public packages (if any)
```

## Key Principles

### `cmd/` — Entry Points

- One directory per binary
- Wires dependencies together (DI composition root)
- No business logic — only configuration and startup

### `internal/` — Private Application Code

- Not importable by external projects (Go enforces this)
- Domain at the center, everything depends inward

### `pkg/` — Public Reusable Code

- Only if you intend other projects to import it
- Most projects don't need this — prefer `internal/`

## Interface Design

- Interfaces defined by consumers, not implementers
- Keep interfaces small: 1-3 methods preferred
- Accept interfaces, return structs
- No circular imports — Go compiler enforces this

## Dependency Injection

- Constructor injection: `func NewService(repo Repository) *Service`
- Wire at `cmd/main.go` — no DI container needed for most projects
- Use `wire` or similar only if dependency graph becomes large

## Error Propagation

- Wrap errors with context at each layer boundary
- Domain errors are plain types — no HTTP concerns
- Handler layer maps domain errors to HTTP status codes
- Use sentinel errors or custom types for known conditions

## Concurrency in Architecture

- Long-running operations accept `context.Context` for cancellation — pass it from handler through service to repository
- Use `errgroup` at the service layer to coordinate parallel sub-tasks with proper error propagation
- Keep goroutine ownership clear: the function that starts a goroutine is responsible for its lifecycle

## Configuration

- Environment variables for runtime config
- Struct-based config with validation at startup
- Fail fast on invalid configuration — don't start with bad config

### Graceful Shutdown

Every Go service needs graceful shutdown for clean container deployments:

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    srv := &http.Server{Addr: ":8080", Handler: router}

    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            slog.Error("server error", "error", err)
        }
    }()

    <-ctx.Done()
    slog.Info("shutting down")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    srv.Shutdown(shutdownCtx)
}
```

Without this, SIGTERM kills in-flight requests during Kubernetes rolling deploys.

### Health Endpoints

```go
mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
})
mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
    if err := db.PingContext(r.Context()); err != nil {
        http.Error(w, "not ready", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
})
```

- `/healthz` — liveness: is the process alive? Always return 200.
- `/readyz` — readiness: can it serve traffic? Check dependencies (DB, cache).

### HTTP Middleware Pattern

Standard middleware signature for composability:

```go
func RequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := uuid.NewString()
        ctx := context.WithValue(r.Context(), requestIDKey, id)
        w.Header().Set("X-Request-ID", id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// Chain: handler := RequestID(Logging(Recovery(router)))
```

Common middleware: request ID, structured logging, panic recovery, auth, CORS, timeout.
