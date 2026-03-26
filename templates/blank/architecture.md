# Architecture

<!-- Define your project's architecture here. -->
<!-- Remove guidance comments and fill in your rules. -->

## Pattern

<!-- Name your architecture pattern and draw the dependency flow. -->
<!-- Example: Clean Architecture, Hexagonal, MVC, etc.
```
Presentation -> Application -> Domain
      |              |
   Infrastructure
```
-->

## Project Layout

<!-- Define directory structure and what goes where. -->
<!-- Example:
```
src/
    domain/       # Entities, value objects
    application/  # Services, use cases
    infrastructure/  # Database, external APIs
    presentation/    # Routes, controllers
```
-->

## Layer Responsibilities

<!-- Define what each layer does and does NOT do. -->
<!-- Example: Domain has no external dependencies, Services never access DB directly -->

## Boundaries

<!-- Define rules for cross-module communication. -->
<!-- Example: Modules communicate through interfaces, no circular deps -->

## Dependency Injection

<!-- Define how dependencies are wired together. -->
<!-- Example: Constructor injection, DI container, composition root -->
