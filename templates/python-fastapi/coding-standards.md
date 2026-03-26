# Coding Standards — Python / FastAPI

## Language & Runtime

- Python 3.13+
- FastAPI with Pydantic v2 for validation
- SQLModel for ORM / database models
- `uv` as package manager (never `pip`)

## Type Safety

- Mandatory type hints on all function signatures, return types, and class attributes
- Use `T | None` union syntax (not `Optional[T]`)
- No `Any` unless absolutely unavoidable — prefer `Unknown` patterns or generics
- Pydantic models for all request/response schemas (automatic validation)
- Run `mypy` on every change — type errors are blocking

## Naming Conventions

| Element       | Convention          | Example                     |
|---------------|---------------------|-----------------------------|
| Functions     | snake_case          | `get_user_by_id()`          |
| Classes       | CamelCase           | `UserService`               |
| Constants     | UPPER_SNAKE_CASE    | `MAX_RETRY_COUNT`           |
| Modules/files | snake_case          | `user_service.py`           |
| Env vars      | UPPER_SNAKE_CASE    | `DATABASE_URL`              |

## Async Rules

- `async def` for I/O operations (HTTP calls, file I/O, message queues)
- Regular `def` for database operations (synchronous SQLModel sessions)
- Never mix — if a function calls sync DB, it must be sync itself

## Import Rules

- All imports at module top level — no inline imports
- Inline imports are a design smell indicating circular dependencies
- If circular dependency exists, refactor to eliminate it (move logic to correct layer)
- Exception: test files may use inline imports for test-specific mocks only

## Code Structure

- Maximum 3 levels of nesting — extract helper functions beyond that
- Early returns: validate inputs at function start, return/raise immediately on failure
- Small functions: single responsibility, under 40 lines preferred
- Named constants: no magic numbers or strings
- Extract complex boolean conditions into named variables

## Error Handling

- All custom exceptions inherit from a base `AppError` class
- Never inherit from plain `Exception` — breaks centralized HTTP status mapping
- Use specific error subclasses: `NotFoundError`, `ConflictError`, `BadRequestError`
- Never catch generic `Exception` above `AppError` — it swallows domain errors

## Architecture Boundaries

- **Thin routers / fat services**: Business logic lives in the service layer, not routes
- **Repository pattern**: Services never access database sessions directly
- Services never import `Session`, `select`, or raw SQLModel queries
- Services never access `repository._session` — that is repository internals
- Clear layer boundaries: domain -> application -> infrastructure -> api

## Entity Standards

- All entities extend base classes (UUID base for API-exposed, Int base for internal)
- UUIDv7 for all entity IDs — never `uuid4()`
- No duplicate field declarations — base classes provide id, timestamps, soft-delete
- Every entity has a corresponding `Filters` Pydantic model for repository queries

## Configuration

- All behavior controlled by explicit environment variables
- Never change behavior based on `ENVIRONMENT` variable (local/test/prod)
- `ENVIRONMENT` identifies WHERE code runs, not HOW it behaves
- Use `ENABLE_X` or profile-based flags for feature toggles

## DRY Principle

- Always search before creating protocols, interfaces, or classes
- Reuse existing interfaces from the module that owns the domain
- Cross-service dependencies: import from the owning service
- One obvious way to do things — no convenience aliases or alternative formats
