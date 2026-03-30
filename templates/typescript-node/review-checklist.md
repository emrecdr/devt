# Review Checklist — TypeScript / Node.js

Language-specific review priorities. The code-reviewer reads this alongside `coding-standards.md`.

---

## CRITICAL — Security

- [ ] **Dynamic code execution**: user input in eval-like paths — never execute untrusted strings
- [ ] **XSS**: unsanitized user input rendered as HTML — sanitize all dynamic content
- [ ] **SQL/NoSQL injection**: string concatenation in queries — use parameterized queries or ORM
- [ ] **Path traversal**: user input in file operations without path.resolve + prefix validation
- [ ] **Hardcoded secrets**: API keys, tokens, passwords in source — use environment variables
- [ ] **Prototype pollution**: merging untrusted objects — validate with schema or safe merge
- [ ] **Shell injection**: user input in child_process — validate and allowlist args
- [ ] **ReDoS**: user-controlled input in complex regex patterns

## CRITICAL — Error Handling

- [ ] **Swallowed errors**: empty catch blocks — at minimum log the error
- [ ] **JSON.parse without try/catch**: throws on invalid input — always wrap
- [ ] **Throwing non-Error objects**: throw string literals — always throw Error instances
- [ ] **Unhandled promise rejections**: async called without await or .catch()

## HIGH — Type Safety

- [ ] `any` without justification — use `unknown` and narrow
- [ ] Non-null assertion `value!` without preceding guard — add runtime check
- [ ] `as` casts that silence type errors — fix the type definition
- [ ] Changes that weaken tsconfig strict mode
- [ ] Public/exported functions without explicit return types

## HIGH — Async Correctness

- [ ] Sequential awaits for independent work — use Promise.all
- [ ] Floating promises without error handling
- [ ] async with forEach (does not await) — use for...of or Promise.all
- [ ] Long-running operations without AbortController/timeout

## HIGH — Node.js Specifics

- [ ] Sync fs in request handlers — use async variants
- [ ] Missing input validation at API boundaries (zod, joi)
- [ ] Unvalidated process.env access without fallback
- [ ] Module system mixing (require in ESM) without clear intent
- [ ] Event listener leaks — .on() without .off() or { once: true }

## HIGH — Idiomatic Patterns

- [ ] `var` usage — use const by default, let when needed
- [ ] `==` instead of `===` — use strict equality
- [ ] Mutable module-level state — prefer immutable data
- [ ] Callback-style mixed with async/await — standardize on promises

## MEDIUM — React / Frontend (when applicable)

- [ ] Missing useEffect/useCallback/useMemo dependency arrays
- [ ] Direct state mutation instead of new object returns
- [ ] Array index as key prop in dynamic lists
- [ ] useEffect for derived state (compute during render instead)
- [ ] Inline object/array creation in JSX props (causes re-renders)

## MEDIUM — Code Quality

- [ ] Functions over 50 lines — extract helper
- [ ] Deep nesting (> 4 levels) — use early returns
- [ ] Duplicate code patterns — extract shared function
- [ ] Magic numbers/strings — use named constants or enums
- [ ] console.log in production code — use structured logger
- [ ] Deep optional chaining without fallback value

## MEDIUM — Testing Gaps

- [ ] New exported function without test
- [ ] Error paths not tested (rejection, throw, edge cases)
- [ ] Missing async/await in test assertions
- [ ] Snapshot tests without semantic assertion

## Diagnostic Commands

```bash
tsc --noEmit                         # Type check
eslint . --ext .ts,.tsx,.js,.jsx     # Linting
prettier --check .                   # Format check
npm audit                            # Dependency vulnerabilities
vitest run                           # Tests (Vitest)
jest --ci                            # Tests (Jest)
```

## Approval Criteria

- **Approve**: No CRITICAL or HIGH issues
- **Request changes**: Any CRITICAL or HIGH issue found
- **Note**: MEDIUM issues are advisory — mention but don't block
