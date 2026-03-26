# Documentation — Python / FastAPI

## MODULE.md (Required per Service)

Every service module must maintain a `MODULE.md` at its root directory.

### Location

```
app/services/<service_name>/MODULE.md
```

### Required Sections

1. **Overview** — What this module does, its domain boundaries
2. **Models** — Domain entities, their fields, and relationships
3. **Capabilities** — Business operations the service provides
4. **Endpoints** — API routes with methods, paths, and descriptions
5. **Dependencies** — Other modules this service depends on
6. **Tests** — Test coverage summary and notable test scenarios

### When to Update

- Adding or modifying domain models
- Adding or changing service capabilities
- Adding or modifying API endpoints
- Changing module dependencies
- Adding database migrations
- Refactoring domain boundaries

## Code Documentation

- Docstrings on all public functions and classes
- Type hints serve as primary documentation for signatures
- Complex business rules get inline comments explaining WHY, not WHAT
- No TODO comments — all code must be complete and functional

## API Documentation

- FastAPI auto-generates OpenAPI docs from route decorators
- Use `summary` and `description` on route decorators
- Use `response_model` for typed responses
- Document error responses with `responses` dict on endpoints
- Pydantic model `Field(description=...)` for request/response field docs

## Project-Level Documentation

- `docs/architecture/` — System design, standards, principles
- `docs/guides/` — How-to guides for common tasks
- `docs/ops/` — Operational docs (CI/CD, env vars, deployment)
- Service-specific docs stay WITH the service, not in `docs/`

## Naming Convention

- All documentation files use UPPERCASE-WITH-HYPHENS: `MODULE.md`, `API-DESIGN.md`
- Exception: ADR files use kebab-case
