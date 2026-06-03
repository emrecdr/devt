# API Changelog — TypeScript / Node.js

The API changelog is the primary reference for frontend and mobile developers consuming the API. Every version gets an entry — detailed for API changes, one-line for internal-only changes.

---

## Version Entry Structure

Every version entry has two parts:

1. **Version Summary** — What was done in this version: features added, issues fixed, improvements made. Written as a concise narrative for anyone reading the changelog (product, backend, frontend).
2. **API Endpoint Changes** — Deep-dive on HTTP contract changes only. Before/after JSON examples, error responses, migration checklist. For frontend/mobile developers who need to update their code.

---

## Entry Template — With API Changes

```markdown
## [X.Y.Z] - YYYY-MM-DD

PR [#NNN](https://repo-url/pull-requests/NNN) — Author Name — Short description

### Summary

Brief narrative of what this version delivers:
- Feature or capability added (what users/developers can now do)
- Bug fixed (what was broken, what's fixed now)
- Improvement made (performance, code quality, reliability)

### Added / Changed / Fixed / Removed

#### `METHOD /api/v1/endpoint` — Short Title

Brief description of what changed and why.

**Before:**
```json
{
  "id": "019d0a1b-...",
  "old_field": "value",
  "email": "user@example.com"
}
```

**After:**
```json
{
  "id": "019d0a1b-...",
  "email": "user@example.com"
}
```

> Optional context note.

### Migration Checklist

- [ ] **Breaking**: Description of what to change and which endpoint
- [ ] **New field**: Field name + type in `GET /endpoint` response
- [ ] **Changed**: What behavior changed on which endpoint
```

## Entry Template — No API Changes

```markdown
## [X.Y.Z] - YYYY-MM-DD

PR [#NNN](https://repo-url/pull-requests/NNN) — Author Name — Short description

### Summary

- What was done in this version (features, fixes, improvements)

No API endpoint changes.
```

---

## Before/After JSON Examples (MANDATORY)

Every API change MUST include before/after JSON showing the full request or response shape.

### Why Before/After JSON

Tables describing field changes (e.g., "`user_id` — Removed") cause real confusion — developers can't tell if a field was deleted, renamed, or moved. Concrete JSON examples make it immediately obvious:

```
Before: { "id": "...", "user_id": "..." }    <- two fields, both present
After:  { "id": "..." }                       <- user_id gone, id unchanged
```

### Before/After Rules

1. Show the **full** request or response shape, not just the changed field — developers need context
2. Label plainly: `**Before:**` and `**After:**` — no version numbers in labels
3. For new endpoints (no "before" exists), show request + response examples
4. For removed fields, show both states so the removal is visually obvious
5. For new additive fields, show before without the field and after with it
6. Use realistic-looking data (UUIDs, emails, names) — not placeholders like `"string"`

---

## Migration Checklist Format

Every version with any API endpoint change needs a migration checklist. It is the actionable summary that frontend developers actually use.

### Prefix Types

| Prefix | When to Use |
|--------|-------------|
| `**Breaking**` | Removed field, changed type, required field added, status code changed |
| `**Changed**` | Behavior change that doesn't break existing code but may need attention |
| `**New endpoint**` | Entirely new endpoint to integrate |
| `**New field**` | New field in existing response (non-breaking, additive) |
| `**New param**` | New query parameter on existing endpoint |
| `**Removed**` | Endpoint or field removed |
| `**Fixed**` | Bug fix that changes response shape or behavior |

### Good Checklist Items (API consumer actions)

```markdown
- [ ] **Breaking**: Remove `client_id` from `POST /licenses/` request body
- [ ] **New endpoint**: `POST /relationships/assign-role` — create orphan roles
- [ ] **New field**: `isAvailable` (boolean) in `GET /contacts` response
- [ ] **Changed**: `POST /invites` — `receiver_id` is now required
- [ ] **Fixed**: If reading `user_id` from registration response, switch to `id`
```

### Bad Checklist Items (not API consumer actions)

- ~~Run `alembic upgrade head` to sync permissions~~ (backend deployment task)
- ~~Run database migration~~ (internal migration filename)
- ~~Assign permission to role~~ (backend permission setup)
- ~~Implement UI for feature~~ (frontend implementation task)
- ~~Update MODULE.md~~ (internal documentation)

---

## Version Summary Rules

The `### Summary` section answers: "What did this version do?"

**Good summary bullets:**
- Added ability to clear all photos for a client (soft delete or permanent GDPR erasure)
- Fixed N+1 query performance in bulk photo operations
- Removed unused response schemas (dead code cleanup)

**Bad summary bullets (too internal):**
- ~~Added `PhotoAllClearedEvent` domain event~~ (internal event name)
- ~~Extracted `_has_modify_permission` static helper~~ (internal method)
- ~~Updated audit mapper `target_type`~~ (internal detail)

**Rule:** If it requires knowledge of the codebase internals to understand, it doesn't belong in the summary.

---

## Content Boundaries

### Belongs in API Changelog

- New/changed endpoints
- Request/response field changes
- Status code changes
- Error response format changes
- What API consumers need to change

### Belongs in MODULE.md (NOT Changelog)

- Domain event class names
- Migration filenames
- Repository/service method names
- Architecture patterns (DI, Clean Architecture)
- Internal refactoring details
- Database schema details

### Never Include in Changelog

- Internal class/method/function names
- Migration filenames
- Architecture terms (repository pattern, clean architecture, service layer)
- Legacy system references
- File paths or line numbers
- Infrastructure/CI/CD details
- Test file names or test counts
- Backend permission setup instructions

---

## Version Index

The changelog file starts with a Version Index table. When adding a new version:

1. Add a new row after `[Unreleased]`
2. Format: `| [X.Y.Z](#xyz---yyyy-mm-dd) | YYYY-MM-DD | One-line summary |`
3. Anchor format: version with dots removed — `0.20.7` becomes `#0207---2026-03-17`
4. Versions without API changes: append "— no API changes" to summary

### Summary cell length — KEEP IT SHORT

The summary cell is a **one-line index**, not a mini-section. Cells longer than ~350 characters break Bitbucket's repository markdown viewer (the table layout collapses visually); Bitbucket Cloud is the most fragile renderer here. Aim for **~200 characters**, hard cap **~350**.

**The summary cell is for theme-level navigation. The detail belongs in the per-version `## [X.Y.Z]` section body below.**

❌ **Bad — bloated summary (one cell crammed with every endpoint path, ticket ID, class / DTO name):**

```
| [0.52.0](#0520---2026-06-03) | 2026-06-03 | **Added (TICKET-184 / TICKET-132 Phase 1a)**: `PATCH /api/v1/resources/{id}/rights` accepts new role with new permission, new domain event; **Added (TICKET-144 / TICKET-176)**: `DELETE /api/v1/parents/{pid}/children?qid=<uid>` (moderation) + self-delete + new event class; **Added (TICKET-177)**: `DELETE /api/v1/parents/{pid}/items/mine` (self-delete; reuses existing event); **Changed (TICKET-134)**: `POST /api/v1/resources/{id}/unlock` rejects narrow-scope callers; **Operational**: ... |
```

✅ **Good — concise summary (~200 chars, theme-only):**

```
| [0.52.0](#0520---2026-06-03) | 2026-06-03 | **Added**: narrow-role self-service rights edit; parent-resource moderation + self-delete; self-service item delete. **Changed**: unlock rejects narrow-scope callers on tenant-owned resources. |
```

**Rules of thumb for keeping the cell short:**

| What | In summary cell? | In section body? |
|---|---|---|
| Thematic high-level change (e.g., "parent-resource moderation") | ✅ yes | ✅ also expanded |
| `Added` / `Changed` / `Fixed` group labels | ✅ yes | ✅ section headings |
| Full endpoint paths (`PATCH /api/v1/resources/{id}/rights`) | ❌ no | ✅ yes |
| Ticket IDs (TICKET-XXX) | ❌ no | ✅ yes |
| Event / DTO / handler class names | ❌ no | ✅ yes |
| Permission codes, error codes, status codes | ❌ no | ✅ yes |
| Before/After JSON examples | ❌ no | ✅ yes |
| Migration checklist | ❌ no | ✅ yes |

**Never drop information** — shorten by **relocating**. Every detail removed from the index row MUST appear in the per-version `## [X.Y.Z] - YYYY-MM-DD` section below. The index is a pointer; the section is the source of truth.

---

## Workflow

1. **Determine version range** — Read current VERSION file, find last documented version in changelog
2. **Gather changes** — Review commits/PRs between last documented version and HEAD
3. **Write version summary** — Summarize ALL work (not just API changes)
4. **Document API endpoint changes** — Scan `api/` and `dto` files for HTTP contract changes
5. **Update version index** — Add row to the top table
6. **Validate against code** — Read the actual git diff to verify claims, not just PR descriptions
7. **Synchronize all version sources** — See "Version Bump — Keep Sources In Sync" below

---

## Version Bump — Keep Sources In Sync (MANDATORY)

A project typically tracks its version in **several places at once**. Every version bump MUST update all of them in the same commit, and the values MUST be identical. Drift between any two of them either fails the CI pipeline or ships a build whose advertised version doesn't match its API contract.

### Version sources to keep aligned

Identify which of these your project actually uses (most projects have 2–3), then update them together on every bump:

1. **A dedicated `VERSION` file (strongly recommended).** A single line containing `X.Y.Z` with no `v` prefix. Cheap to read from shell, Make, Dockerfiles, and CI pipeline guards. devt promotes this pattern because it gives every other tool a stable, unambiguous source of truth.
2. **A changelog file (strongly recommended).** Conventionally `docs/API-CHANGELOG.md` or `CHANGELOG.md`, but the actual path is project-specific. The latest `## [X.Y.Z]` heading is the human-/consumer-facing version source and must match the numeric one.
3. **The package-manager manifest, if the stack has one.** For Node/TypeScript that is usually `package.json` (`"version": "X.Y.Z"`), but the exact file varies per stack. Always update whatever your project uses — it's the value the package manager, Docker, and the registry see. If a lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) exists, run an install so it re-syncs and commit it too.
4. **Any code-level constant or runtime exposure**, e.g. `process.env.npm_package_version` surfaced through a `/health` payload or `--version` CLI flag. These tend to be derived from one of the above; if yours is hard-coded, treat it as another source to update.

### Verification before commit

Read each source your project uses and confirm they all return the same `X.Y.Z`. A short script wired into a pre-commit hook or `npm` script is the most reliable enforcement; the exact shell varies by which sources you maintain.

### Anti-patterns

- ❌ Bumping the `VERSION` file alone "just to unblock the merge" — leaves the package manifest and lockfile stale.
- ❌ Adding a changelog entry without bumping the numeric sources — the next main-bound pipeline guard will reject the merge.
- ❌ Using a language-specific helper (e.g. `npm version`, `yarn version`) that touches only the manifest + lockfile + tag — it bypasses the `VERSION` file and the changelog.
- ❌ Letting `development` drift several patch versions ahead of `VERSION` — when caught at PR time the fix is non-obvious.
