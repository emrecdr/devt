# Golden Rules — Vue 3 + Bootstrap 5

> Non-negotiable rules for all development work. Violations require immediate stop and correction.

## Quick Reference Card

| Rule | One-Liner |
|------|-----------|
| 1. Deep Analysis | Scan ALL related code BEFORE implementing |
| 2. No Duplicates | NEVER reimplement existing components, composables, or utilities |
| 3. No Backward Compat | Update callers directly — no compatibility shims |
| 4. Boy Scout | Leave code CLEANER than you found it |
| 5. Composition API Only | `<script setup>` exclusively — no Options API, no `defineComponent()` |
| 6. Feature Module Structure | Every feature in `components/<feature>/` with services/stores/views |
| 7. Centralized API Client | ALL HTTP calls through `shared/services/api.js` — no standalone Axios |
| 8. shallowRef for Collections | Arrays in Pinia stores use `shallowRef` — replace, never mutate |
| 9. Page Object Model | Every Playwright test page gets a POM class — no inline selectors |
| 10. Fixture-Based Test Data | Test data created via API fixtures, never via UI — always cleaned up |
| 11. No TODOs/Markers | Complete code only — no placeholders or temporal markers |
| 12. Verify Before Done | No completion claims without fresh lint + build evidence |

---

## Rule 1: Deep Analysis Before Implementation

```
NO IMPLEMENTATION WITHOUT CODEBASE SCAN. NO EXCEPTIONS.
```

### Required Process

Before ANY implementation work:

1. **Scan target feature module**: Read EVERY file in `components/<feature>/`
2. **Scan shared resources**:
   - `shared/components/` — reusable UI components (DataTable, PageHeader, etc.)
   - `shared/composables/` — existing composables (useOperationHandler, useLogger, useLoading)
   - `shared/services/` — API client and service utilities
   - `shared/constants/` — API endpoints, storage keys, app config
   - `shared/stores/` — shared Pinia stores (notifications, etc.)
   - `shared/UI/` — primitive UI components
3. **Scan `main.js`**: Check globally registered components — don't install duplicates
4. **Scan router**: Check existing routes before adding new ones
5. **Check `CLAUDE.md`**: Project-specific conventions that override defaults

### Violation Examples

- Creating a new Axios instance when `shared/services/api.js` exists
- Building a custom toast when `useNotificationStore` provides `showSuccess/showError`
- Creating a date formatter when `dayjs` is already a project dependency
- Adding a loading spinner component when `useLoading` composable exists
- Installing a new form validation library when the project uses inline validation

---

## Rule 2: No Duplicate Features

Search before creating:

```bash
grep -r "function\|const\|export" --include="*.js" --include="*.vue" src/shared/
grep -r "defineStore\|useStore" --include="*.js" src/
grep -r "component.*name" --include="*.vue" src/shared/components/
```

If a composable, component, store, or utility already exists — **reuse it**. If it doesn't fit exactly, extend it. Creating a parallel implementation is always wrong.

**Common duplicate traps in Vue projects:**
- Multiple loading state trackers (use `useLoading`)
- Multiple error handling patterns (use `useOperationHandler`)
- Multiple notification systems (use `useNotificationStore`)
- Multiple API client configurations (use `shared/services/api.js`)

---

## Rule 3: No Backward Compatibility Code

Prefer direct changes over compatibility layers. No:

- `/** @deprecated */` wrappers around old component APIs
- Keeping both Options API and Composition API versions
- Supporting both `$emit` and `defineEmits` patterns
- Feature flags for old behavior
- Re-exports of renamed components

Just change the code. Update all usages. Delete the old path.

---

## Rule 4: Boy Scout Rule

Every commit leaves the codebase cleaner:

- Remove unused imports and components you encounter
- Fix ESLint warnings in files you touch
- Convert any Options API code you encounter to `<script setup>`
- Replace `var` with `const`/`let` in files you modify
- Simplify overly complex template expressions into computed properties

---

## Rule 5: Composition API Only

```vue
<!-- CORRECT -->
<script setup>
import { ref, computed } from 'vue'

const count = ref(0)
const doubled = computed(() => count.value * 2)
</script>

<!-- WRONG — Options API -->
<script>
export default {
  data() { return { count: 0 } },
  computed: { doubled() { return this.count * 2 } }
}
</script>

<!-- WRONG — defineComponent with setup function -->
<script>
import { defineComponent, ref } from 'vue'
export default defineComponent({
  setup() {
    const count = ref(0)
    return { count }
  }
})
</script>
```

**`<script setup>` is the ONLY accepted pattern.** It's shorter, has better TypeScript inference, and eliminates the boilerplate of `defineComponent` + `return`.

**Legacy exception**: Some existing shared components (app-header, app-sidebar) may use a hybrid pattern with `setup()` + `data()`/`methods()`. This is technical debt from the initial build. When you touch these files, convert them to `<script setup>` (Boy Scout Rule). Never write new components using Options API or hybrid patterns.

---

## Rule 6: Feature Module Structure

Every new feature MUST follow this structure:

```
components/<feature>/
├── index.js            # Module exports
├── services/           # Feature-specific API service functions
├── stores/             # Feature-specific Pinia stores
├── types/              # Type definitions (if applicable)
└── views/              # Feature view components
```

**Rules:**
- Never put feature code directly in `src/` or `shared/`
- Never import from other feature modules — use `shared/` for cross-feature code
- Always export main components via `index.js`
- Always add routes to `src/router/index.js`
- Always define API endpoints in `src/shared/constants/api.js`

### New Feature Checklist

1. Create `components/<feature>/` directory structure
2. Add API endpoints to `shared/constants/api.js`
3. Create Pinia store in `<feature>/stores/`
4. Create service functions in `<feature>/services/`
5. Create view components in `<feature>/views/`
6. Add routes to `router/index.js` with `meta: { requiresAuth: true }`
7. Use `useOperationHandler` for error handling
8. Use `useLogger` for logging
9. Use `DataTable` for list views, `PageHeader` for breadcrumbs

---

## Rule 7: Centralized API Client

```javascript
// CORRECT — centralized client
import api from '@/shared/services/api'
import { API_ENDPOINTS } from '@/shared/constants/api'

const response = await api.get(API_ENDPOINTS.USERS.BASE)

// WRONG — standalone Axios
import axios from 'axios'
const response = await axios.get('/api/users')  // No token, no retry, no logging!
```

The centralized API client provides:
- Automatic JWT token attachment
- Automatic token refresh on 401
- Retry logic for 5xx and network errors
- Request/response logging via `useLogger`
- User-friendly error notifications

**Exception:** For file uploads without retry, use `createApiWithoutRetry()`.

---

## Rule 8: shallowRef for Collections

```javascript
// CORRECT — shallowRef + replace
const items = shallowRef([])

// Add
items.value = [...items.value, newItem]

// Update
items.value = items.value.map(i => (i.id === id ? { ...i, ...changes } : i))

// Delete
items.value = items.value.filter(i => i.id !== id)

// WRONG — ref with mutation
const items = ref([])
items.value.push(newItem)      // Won't trigger reactivity with shallowRef!
items.value[0].name = 'new'   // Won't trigger reactivity with shallowRef!
```

**Why:** `shallowRef` avoids deep reactive proxying on large arrays — better performance. But it means you MUST replace the entire array to trigger reactivity. Direct mutations (`.push()`, property assignment) are silently ignored.

Use `ref()` for single values, booleans, and small objects.

**When `ref()` arrays are acceptable**: Small bounded collections (under ~20 items) where you frequently mutate individual item properties (e.g., `item.selected = true`), short-lived component state not in Pinia stores, and form builder arrays with nested configurations. For Pinia stores and API response data, always use `shallowRef`.

---

## Rule 9: Page Object Model for Tests

```javascript
// CORRECT — page object
export class UsersListPage extends DataListPage {
  constructor(page) {
    super(page)
    this.createUserModal = page.locator('#createUserModal')
    this.emailInput = page.locator('#createUserModal input[type="email"]')
  }

  async createUser(email, name) {
    await this.clickCreate()
    await this.emailInput.fill(email)
    // ...
  }
}

// WRONG — inline selectors in test
test('create user', async ({ page }) => {
  await page.locator('.page-header-breadcrumb button').click()
  await page.locator('#createUserModal input[type="email"]').fill('test@test.com')
})
```

**Rules:**
- One POM class per page/major component
- All locators in constructor (single source of truth)
- Methods represent user actions, not implementation details
- Extend `DataListPage` for all list/table views
- Document non-obvious selectors with comments

---

## Rule 10: Fixture-Based Test Data

```javascript
// CORRECT — API fixture with cleanup
verifiedUser: async ({ apiClient }, use) => {
  const user = await apiClient.createTestUser({ ... })
  await use(user)                    // Test runs here
  await apiClient.deleteUser(user.id) // Always clean up
}

// WRONG — UI-based setup
test.beforeEach(async ({ page }) => {
  await page.goto('/admin/users')
  await page.click('button.create')
  await page.fill('#email', 'test@test.com')
  // Slow, brittle, leaves data behind
})
```

**Rules:**
- Create test data via API client — faster and more reliable than UI
- Every fixture that creates data MUST delete it in teardown
- If setup fails, yield `null` so tests can `test.skip()`
- Worker-scoped for expensive resources (API clients)
- Test-scoped for test-specific data (users, roles)

---

## Rule 11: No TODOs or Placeholders

```vue
<!-- WRONG -->
<script setup>
// TODO: implement validation
const validate = () => {}

// FIXME: this is a hack
const items = ref([])
</script>

<template>
  <!-- placeholder -->
  <div>Coming soon</div>
</template>
```

Ship complete code or don't ship. If you can't complete a feature, surface it as BLOCKED.

---

## Rule 12: Verify Before Claiming Done

Before reporting DONE:

```bash
npx eslint . --ext .vue,.js --ignore-path .gitignore
npx prettier --check src/
npm run build
```

All three must pass. Copy the terminal output as evidence. "I believe it builds" is not verification — "Here is the output showing build succeeded" is.

- All interactive elements have visible focus states and hover transitions
- Touch targets are at least 24x24px (WCAG 2.2 SC 2.5.8 AA); 44x44px recommended (SC 2.5.5 AAA)
- Text contrast meets WCAG AA (4.5:1 normal, 3:1 large)
- `@media (prefers-reduced-motion: reduce)` is respected for animations
- No `<div @click>` — use semantic `<button>` or `<a>` elements

For Playwright tests (when applicable):
```bash
npx playwright test
```
