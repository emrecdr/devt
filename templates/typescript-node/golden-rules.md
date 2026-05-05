# Golden Rules — TypeScript / Node

> Non-negotiable rules for all development work. Violations require immediate stop and correction.

## Quick Reference Card

| Rule | One-Liner |
|------|-----------|
| 1. Deep Analysis | Scan ALL related code BEFORE implementing |
| 2. No Duplicates | NEVER reimplement existing features or utilities |
| 3. No Backward Compat | Update callers directly — no compatibility shims |
| 4. Surgical Changes | Modify only what the task needs; surface unrelated findings instead of silently fixing |
| 5. Strict TypeScript | No `any`, no `@ts-ignore`, no `as unknown as` |
| 6. Error Types | Every thrown error extends AppError with a code |
| 7. Dependency Injection | No global singletons — inject everything via constructor |
| 8. Named Exports Only | No default exports — explicit over implicit |
| 9. One Obvious Way | If it exists, reuse it; don't build a second path |
| 10. Boundary Validation | Validate ALL external input with Zod at system boundaries |
| 11. No TODOs/Markers | Complete code only — no placeholders or temporal markers |
| 12. Verify Before Done | No completion claims without fresh test evidence |

---

## Rule 1: Deep Analysis Before Implementation

```
NO IMPLEMENTATION WITHOUT CODEBASE SCAN. NO EXCEPTIONS.
```

### Required Process

Before ANY implementation work:

1. **Scan target module**: Read EVERY file in the target feature directory
2. **Scan shared utilities**: Check `src/shared/`, `src/common/`, `src/lib/` for existing solutions
3. **Scan types**: Check existing type definitions — don't create duplicate interfaces
4. **Scan tests**: `*.test.ts` / `*.spec.ts` reveal actual behavior

### Violation Examples

- Implementing a `formatDate()` helper when `dayjs` is already a project dependency
- Creating a new `HttpClient` class when the project has a centralized API service
- Adding a new error type when `AppError` subtypes cover the case

---

## Rule 2: No Duplicate Features

Search before creating:

```bash
grep -r "function.*functionName\|class.*ClassName\|export.*name" --include="*.ts" src/
```

If a function, class, or pattern already exists — reuse it. If it doesn't fit exactly, extend it.

---

## Rule 3: No Backward Compatibility Code

Prefer direct changes over compatibility layers. No:

- `/** @deprecated */` wrappers
- Feature flags for old behavior
- Re-exports of renamed symbols
- Compatibility layers between old and new APIs

Just change the code. Update all callers. Delete the old path.

---

## Rule 4: Surgical Changes

Touch only what the task requires. Clean up orphans **your own** changes create — not pre-existing ones.

When you spot unrelated improvements or bugs (unused imports, ESLint warnings, dead branches, stale comments, `any` escape hatches), do NOT silently fix them. Use the **Find-Surface-Decide protocol**:

1. **Find**: note the file path and a one-line description of the issue
2. **Surface**: present it to the user as a side-finding
3. **Decide**: ask whether to (a) fix now in this task, (b) split into a follow-up task, or (c) just record in the session summary
4. Act on the user's choice — never assume

Match existing project conventions even if you would write it differently.

### Boy Scout Mode (opt-in)

`scope_mode` in `.devt/config.json` defaults to `"surgical"`. Set it to `"boyscout"` to grant agents permission to auto-fix small mechanical issues — unused imports, ESLint warnings, typos in comments, formatting — within files they are already editing, without asking. Anything larger (refactors, behavior changes, cross-module cleanups) still goes through Find-Surface-Decide regardless of mode.

---

## Rule 5: Strict TypeScript

```typescript
// CORRECT
function getUser(id: string): Promise<User | null> {
  // ...
}

// WRONG — any
function getUser(id: any): any { ... }

// WRONG — escape hatch
const data = response as unknown as User  // Don't bypass the type system

// WRONG — suppression
// @ts-ignore
const value = unsafeOperation()
```

If the type system is fighting you, the design is wrong — fix the design, not the types.

**Strict mode** (`strict: true` in tsconfig) is non-negotiable. Never disable individual strict checks.

---

## Rule 6: Error Types

```typescript
// CORRECT — typed errors
class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, 'NOT_FOUND', 404)
  }
}

throw new NotFoundError('User', userId)

// WRONG — generic errors
throw new Error('not found')

// WRONG — string throws
throw 'something went wrong'
```

Every error must:
- Extend a base `AppError` class
- Include an error code (`NOT_FOUND`, `VALIDATION_ERROR`, `UNAUTHORIZED`)
- Include an HTTP status code for API errors
- Be catchable by type: `if (error instanceof NotFoundError)`

---

## Rule 7: Dependency Injection

```typescript
// CORRECT — injected
class UserService {
  constructor(
    private readonly repo: UserRepository,
    private readonly logger: Logger,
  ) {}
}

// WRONG — global singleton
import { db } from '../database'
class UserService {
  async getUser(id: string) {
    return db.query(...)  // Hidden dependency, untestable
  }
}
```

**Why:** Singletons hide dependencies, prevent testing, and create initialization ordering bugs.

---

## Rule 8: Named Exports Only

```typescript
// CORRECT
export function createUser(...) { ... }
export class UserService { ... }
export interface UserRepository { ... }

// WRONG
export default class UserService { ... }
```

**Why:** Default exports cause inconsistent import names, worse IDE support, and harder refactoring.

---

## Rule 9: One Obvious Way

Before building a solution, search:

- Is there already a middleware that does this?
- Is there already a service method that fetches this data?
- Is there already an error type for this case?
- Is there already a test helper for this setup?

If yes — use it. Two ways to do the same thing is always worse than one.

---

## Rule 10: Boundary Validation

```typescript
// CORRECT — validate at the boundary
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'user']),
})

app.post('/users', (req, res) => {
  const body = CreateUserSchema.parse(req.body)  // Throws on invalid
  // body is now typed and validated
})

// WRONG — trust external input
app.post('/users', (req, res) => {
  const { email, name, role } = req.body  // Unvalidated!
  await createUser(email, name, role)
})
```

Validate at system boundaries (API handlers, CLI input, env vars, file reads). Trust internal function signatures — they're enforced by TypeScript.

---

## Rule 11: No TODOs or Placeholders

```typescript
// WRONG
async function createUser(data: CreateUserInput): Promise<User> {
  // TODO: implement validation
  return {} as User  // placeholder
}
```

Ship complete code or don't ship. If you can't complete a function, surface it as BLOCKED.

---

## Rule 12: Verify Before Claiming Done

Before reporting DONE:

```bash
npx eslint .
npx tsc --noEmit
npx vitest run  # or npx jest --ci
```

All three must pass. Copy the terminal output as evidence.

---

## Pre-Flight Protocol (v0.18.0+)

Before any non-trivial change, the **Two-Tier Pre-Flight Protocol** applies (see `${CLAUDE_PLUGIN_ROOT}/guardrails/golden-rules.md` Rule 14):

- **Tier 1 (Topic)**: dev workflows auto-fire `/devt:preflight "<task>"` at context_init, writing `.devt/state/preflight-brief.md`. Read the Brief FIRST — it lists every governing ADR/Concept/Flow + REJ tombstones for your task.
- **Tier 2 (File)**: before each Edit/Write, append a `PREFLIGHT <ts> edit <file> :: <governing IDs or 'no governance'>` line to `.devt/state/scratchpad.md`. The PreToolUse `pre-flight-guard` hook checks this — `memory.preflight_mode: block` (default v0.19.0+) denies the edit otherwise.

Project ADRs in `.devt/memory/decisions/` are **constitutional** — they override generic principles. Check `node bin/devt-tools.cjs memory affects <file>` if your edit isn't covered by the current Brief; run `/devt:preflight` again on scope expansion.
