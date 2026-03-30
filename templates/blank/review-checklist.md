# Review Checklist — General

Language-agnostic review priorities. Customize this file for your stack.
The code-reviewer reads this alongside `coding-standards.md`.

---

## CRITICAL — Security

- [ ] **Injection**: user input in queries, commands, or dynamic execution without sanitization
- [ ] **Path traversal**: user-controlled file paths without validation
- [ ] **Hardcoded secrets**: API keys, passwords, tokens in source — use environment variables
- [ ] **Weak crypto**: insecure hash/encryption for security-sensitive data

## CRITICAL — Error Handling

- [ ] **Swallowed errors**: catch blocks that ignore or silently discard errors
- [ ] **Missing resource cleanup**: opened files, connections, handles not closed on error paths
- [ ] **Unhandled async errors**: fire-and-forget operations without error handling

## HIGH — Code Quality

- [ ] Functions over 50 lines — extract helper
- [ ] Functions with more than 5 parameters — use object/struct
- [ ] Deep nesting (> 4 levels) — use early returns
- [ ] Duplicate code patterns — extract shared function
- [ ] Magic numbers/strings — use named constants

## HIGH — Concurrency (if applicable)

- [ ] Shared mutable state without synchronization
- [ ] N+1 operations in loops — batch or parallelize
- [ ] Missing timeout/cancellation on long operations

## MEDIUM — Best Practices

- [ ] Consistent naming conventions
- [ ] Public APIs without documentation
- [ ] Debug/print statements in production code
- [ ] Unused imports or dead code

## MEDIUM — Testing Gaps

- [ ] New functionality without corresponding test
- [ ] Error paths not tested
- [ ] Edge cases not covered

## Approval Criteria

- **Approve**: No CRITICAL or HIGH issues
- **Request changes**: Any CRITICAL or HIGH issue found
- **Note**: MEDIUM issues are advisory — mention but don't block

---

> Customize this file with your language and framework-specific checks.
> See other templates (python-fastapi, go, typescript-node, vue-bootstrap) for examples.
