# Common Code Smells — Python / FastAPI

Anti-patterns to detect and fix during code review and development.

## Inline Imports

**Smell**: Imports inside function bodies instead of at module top level.

**Why it's bad**: Indicates circular dependencies — a structural design problem.

**Fix**: Refactor to eliminate the circular dependency. Move shared logic to the correct layer or introduce an interface.

## God Services

**Smell**: Service class with 1000+ lines or 25+ methods.

**Why it's bad**: Violates single responsibility. Hard to test, hard to understand.

**Fix**: Extract focused sub-services. Group related methods into their own service class with a clear responsibility boundary.

## N+1 Queries

**Smell**: Database call inside a loop (`for item in items: repo.get(item.id)`).

**Why it's bad**: Linear DB round-trips. 100 items = 100 queries.

**Fix**: Use batch queries (`get_by_ids()`), eager loading, or JOINs in the repository.

## Missing Base Class Inheritance

**Smell**: Entity models that don't extend the project's base entity classes.

**Why it's bad**: Missing standard fields (id, timestamps, soft-delete). Inconsistent behavior across entities.

**Fix**: All entities must extend the appropriate base class (UUID base for API-exposed, Int base for internal).

## Direct Session Access in Services

**Smell**: Service importing `Session`, calling `session.execute()`, or accessing `repo._session`.

**Why it's bad**: Violates repository pattern. Business logic coupled to database internals.

**Fix**: Add the needed method to the repository interface and implementation. Services only call repository methods.

## Raw SQL in Services

**Smell**: SQL strings or `text()` calls in service layer code.

**Why it's bad**: Data access logic belongs in repositories. Services should express business intent, not query mechanics.

**Fix**: Move the query to the repository. Expose a domain-meaningful method name on the repository interface.

## Generic Exception Swallowing AppError

**Smell**: `except Exception` catching both domain errors and unexpected failures.

```python
# BAD
try:
    result = service.do_something()
except Exception:
    return JSONResponse(status_code=500, ...)
```

**Why it's bad**: Domain exceptions (NotFoundError, ConflictError) get swallowed and returned as 500 instead of their proper status codes.

**Fix**: Catch `AppError` first and re-raise, then handle generic `Exception`:

```python
# GOOD
try:
    result = service.do_something()
except AppError:
    raise  # Let centralized handler map to correct HTTP status
except Exception:
    return JSONResponse(status_code=500, ...)
```

## Deep Nesting

**Smell**: 4+ levels of indentation from nested if/for/try blocks.

**Why it's bad**: Hard to read, hard to test individual branches, high cognitive load.

**Fix**: Use early returns (guard clauses), extract helper functions, flatten control flow.

## uuid4 Usage

**Smell**: `uuid.uuid4()` for generating entity IDs.

**Why it's bad**: Random UUIDs have poor B-tree locality, are not time-sortable.

**Fix**: Use UUIDv7 (`uuid_utils.uuid7()` or project wrapper `generate_uuid()`). Time-ordered, RFC 9562 compliant, better database performance.
