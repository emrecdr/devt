# Defense-in-Depth After Bug Fixes

When fixing a bug, don't just fix the single point of failure. Add validation at EVERY layer the data passes through.

## Why Single-Point Fixes Fail

A bug at Layer 3 means Layers 1 and 2 let invalid data through. If you only fix Layer 3, a different code path can bypass your fix.

## The 4-Layer Pattern

After fixing the root cause, add guards at each layer:

### Layer 1: Entry Point (API boundary)
Validate input at the API/route level. Reject invalid data before it enters the system.

### Layer 2: Business Logic (service layer)
Assert preconditions in the service method. If data shouldn't be null/empty/invalid here, check and throw.

### Layer 3: Data Access (repository/infrastructure)
Add constraints at the data layer. Database constraints, unique indexes, NOT NULL.

### Layer 4: Observability (logging/monitoring)
Log the context around the fixed area so future occurrences are detectable.

## When to Apply

- Always after fixing a data integrity bug
- Always after fixing a security vulnerability
- When the same bug class could appear at different entry points
- When the fix relies on callers "doing the right thing"

## When NOT to Apply

- Pure logic bugs with a single code path
- UI/presentation bugs
- Configuration errors
