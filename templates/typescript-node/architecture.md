# Architecture — TypeScript / Node

## Pattern: Layered / Clean Architecture

Dependencies flow inward. Domain has no external dependencies.

```
Presentation (routes, controllers) -> Application (services, use cases) -> Domain (entities)
              |                              |
         Infrastructure (database, APIs, messaging)
```

## Project Layout

```
src/
    domain/
        entities/            # Business entities, value objects
        errors/              # Domain-specific error classes
        interfaces/          # Repository and service contracts
    application/
        services/            # Business logic, use cases
        dto/                 # Data transfer objects
    infrastructure/
        database/
            repositories/    # Database access implementations
            migrations/      # Schema migrations
        external/            # Third-party API clients
    presentation/
        routes/              # Route definitions
        controllers/         # Request handlers
        middleware/          # HTTP middleware
    common/
        config/              # Configuration loading
        utils/               # Shared utilities
```

## Layer Responsibilities

### Domain

- Business entities and value objects
- Domain errors and validation rules
- Repository interfaces (contracts)
- No framework dependencies — pure TypeScript

### Application

- Orchestrates business operations
- Depends only on domain layer
- DTOs for data crossing boundaries
- No HTTP concerns — framework-agnostic

### Infrastructure

- Implements domain interfaces (repositories, external services)
- Database queries, ORM configuration
- External API clients, message queue adapters
- Framework-specific code lives here

### Presentation

- HTTP routes and controllers
- Request validation and response formatting
- Authentication/authorization middleware
- Thin — delegates to application services immediately

## Dependency Injection

- Constructor injection for all services and repositories
- IoC container optional (tsyringe, inversify) for large projects
- Wire at application entry point (`main.ts` or `app.ts`)
- Interfaces defined by consumers, implemented by infrastructure

## Module Boundaries

- Feature modules are self-contained (domain + service + repo + routes)
- Cross-module communication through exported interfaces
- No circular dependencies between modules
- Shared types in `common/` — only truly shared items
