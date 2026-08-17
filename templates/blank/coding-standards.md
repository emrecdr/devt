# Coding Standards

> Template baseline — the project's own `CLAUDE.md` and documented conventions WIN on any conflict with this file. Tailor it to the project (`/devt:setup`); untailored copies are flagged by `/devt:setup --health`.

<!-- Define your project's coding conventions here. -->
<!-- Remove guidance comments and fill in your rules. -->

## Language & Runtime

<!-- Specify language version, runtime, key frameworks. -->
<!-- Example: Python 3.12+ / TypeScript 5+ / Go 1.22+ -->

## Type Safety

<!-- Define type annotation/checking requirements. -->
<!-- Example: Mandatory type hints, strict compiler mode, no `any` -->

## Naming Conventions

<!-- Define naming rules for functions, classes, constants, files. -->
<!-- Example: snake_case for functions, CamelCase for classes, UPPER_SNAKE for constants -->

## Code Structure

<!-- Define nesting limits, function size, early return rules. -->
<!-- Example: Max 3 levels of nesting, functions under 40 lines -->

## Error Handling

<!-- Define error class hierarchy and handling patterns. -->
<!-- Example: Custom error classes extending a base AppError, no generic catches -->

## Patterns

<!-- Define required design patterns (repository, service layer, etc.) -->
<!-- Example: Repository pattern for data access, thin controllers -->

## Anti-Patterns

<!-- List patterns that are explicitly forbidden. -->
<!-- Example: No inline imports, no god classes, no magic numbers -->

## Version Selection & Upgrades

- **New dependencies** (libraries, dev tools, CI actions): adopt the latest stable release at the time of introduction.
- **Core language toolchain** (compiler / interpreter / runtime): never adopt an x.y.0 initial release — wait 3–4 weeks after release and target x.y.1 or the first patch in that window. If the current x.y.0 is younger than that, stay on the previous stable line and note the pending upgrade.
- **Existing dependencies**: upgrades are suggest-only — surface the suggestion (current → available, and why it matters); never bump automatically or as a side effect of unrelated work. The operator decides when.

> **ADR override note**: if a project ADR in `.devt/memory/decisions/` contradicts these standards, the ADR wins. ADRs are constitutional. Run `node bin/devt-tools.cjs memory list decision` to see what's binding.
