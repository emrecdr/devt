# Architecture — Python / FastAPI

## Pattern: Clean / Hexagonal / Onion Architecture

Dependencies flow inward: outer layers depend on inner layers, never the reverse.

```
API (presentation) -> Application (use cases) -> Domain (entities)
         |                    |
    Infrastructure (adapters, repositories)
```

## Layer Responsibilities

### Domain Layer (`domain/`)
- Business entities, value objects, enums
- No external dependencies — pure Python
- Defines what the business IS

### Application Layer (`application/`)
- Use cases, services, DTOs
- Depends only on domain layer
- Orchestrates business operations
- Defines what the system DOES

### Infrastructure Layer (`infrastructure/`)
- Database repositories, external API clients, message queues
- Implements application-layer interfaces
- Adapts external systems to domain contracts

### Presentation Layer (`api/v1/`)
- FastAPI routes, request/response schemas
- Thin — delegates to application services immediately
- Handles HTTP concerns only (status codes, headers, serialization)

## Service Module Structure

```
app/services/<service_name>/
    domain/
        models.py           # SQLModel entities
        enums.py            # Domain enumerations
    application/
        service.py          # Business logic
        dto.py              # Data transfer objects
    infrastructure/
        repositories.py     # Database access implementations
    api/v1/
        routes.py           # FastAPI router
    repository_interfaces.py  # Repository contracts (module root)
    errors.py                 # Custom exceptions (module root)
    config.py                 # Module configuration
    tests/
        unit/               # Unit tests
        integration/        # Integration tests
    MODULE.md               # Module documentation
```

## Repository Pattern

- **Interfaces** defined at module root: `repository_interfaces.py`
- **Implementations** in `infrastructure/repositories.py`
- Repositories own all data access for their domain tables
- Services inject repository interfaces via dependency injection

## Cross-Service Data Access

- Inject the owning module's repository interface via DI
- Never add methods to a repository that query another service's domain
- Never duplicate repository logic across module boundaries
- If you need data from another service, inject that service's repository interface

## Dependency Injection

- FastAPI `Depends()` for wiring dependencies
- Repository implementations injected into services
- Services injected into route handlers
- Configuration via Pydantic `Settings` classes

## Module Documentation

- Every service module MUST maintain a `MODULE.md` file
- Documents: responsibilities, models, capabilities, endpoints, dependencies
- Updated whenever the module changes (models, endpoints, dependencies)

## Scope-Based Data Filtering

- Services implement role-based access using user context
- Repository validates scope and filters data accordingly
- Unsupported scopes return empty results with warning (graceful degradation)
