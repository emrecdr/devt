# Detection Categories

Generic taxonomy of architecture scanner findings. Each category describes what the scanner detected, its typical severity, and how to investigate further.

## Duplicate Modeling

**What**: The same domain concept is defined in multiple places — duplicate classes, redundant DTOs, parallel enum definitions.

**Typical severity**: Important

**Investigation**: Search for all definitions of the concept. Determine which is canonical. Check if consumers reference different copies. The fix is usually to delete duplicates and point all consumers to the canonical definition.

## Missing Constraints

**What**: Database columns or models lack expected constraints — missing NOT NULL, missing unique indexes, missing foreign keys, missing check constraints.

**Typical severity**: Important to Critical (depends on data integrity risk)

**Investigation**: Compare the model definition with business rules. If a field must be unique, the constraint must exist at the database level, not just application level. Check for existing migration that may add it.

## Orphan Risks

**What**: Deletion of a parent entity could leave child records without a valid reference. Missing CASCADE or SET NULL on foreign keys.

**Typical severity**: Important

**Investigation**: Trace the parent-child relationship. Check if the application handles deletion cascades explicitly (repository delete_hard methods). If only application-level cascade exists, document the risk or add database-level constraints.

## Layer Violations

**What**: Code in one architectural layer directly depends on code in a layer it should not access — domain importing infrastructure, routes containing business logic, services accessing database sessions.

**Typical severity**: Critical

**Investigation**: Trace the import chain. Identify which layer boundary is crossed. The fix is usually to introduce an interface/port at the correct boundary or move the logic to the appropriate layer.

## Circular Dependencies

**What**: Module A imports from Module B, which imports from Module A (directly or transitively).

**Typical severity**: Critical

**Investigation**: Map the import graph. Identify which import creates the cycle. The fix is usually to extract the shared concept into a separate module, use dependency injection, or move the logic to break the cycle.

## God Classes

**What**: A single class has too many responsibilities — excessive methods, large file size, mixed concerns.

**Typical severity**: Minor to Important

**Investigation**: List the class methods and group them by concern. If groups are clearly separable, extract them into focused classes. Check if the class is the only consumer of injected dependencies — each dependency group may indicate a separate responsibility.

## Missing Tests

**What**: Code paths, modules, or features lack corresponding test coverage.

**Typical severity**: Important

**Investigation**: Map the untested code to its risk level. High-risk code (auth, payments, data mutation) without tests is Critical. Low-risk utility code without tests is Minor. Prioritize test creation by risk.

## Security Gaps

**What**: Missing authentication checks, exposed internal data, hardcoded secrets, insufficient input validation, SQL injection vectors.

**Typical severity**: Critical

**Investigation**: Verify each finding by reading the code. Check if middleware or framework-level protections cover the gap. If a route lacks auth decoration, confirm it is intentionally public. Hardcoded secrets are always Critical regardless of context.

## Cross-Service Boundary Violations

**What**: One service directly imports concrete implementations from another service instead of using interfaces, or queries another service's database tables directly.

**Typical severity**: Important to Critical

**Investigation**: Check if an interface exists in the owning service's `repository_interfaces.py`. If so, the consumer should use the interface via dependency injection. If no interface exists, one should be created in the owning service.

## Dead Code

**What**: Unreachable code, unused imports, functions never called, classes never instantiated.

**Typical severity**: Minor

**Investigation**: Search for all references to the code. If truly unused, delete it. If used only in tests, verify the tests are testing real behavior. Git history preserves the code if needed later.
