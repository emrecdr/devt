# Common Code Smells — Vue 3 + Bootstrap 5

Anti-patterns to detect and fix during code review and development.

## Options API Usage

**Smell**: `export default { data(), methods: {}, computed: {} }` or `defineComponent()` with setup function.

**Why it's bad**: Inconsistent with project standard. Options API has worse TypeScript inference, more boilerplate, and splits related logic across sections.

**How to detect**: `grep -rn "export default {" --include="*.vue" src/`

**Fix**: Convert to `<script setup>` with Composition API. Move `data()` to `ref()`, `computed` to `computed()`, `methods` to functions, `watch` to `watch()`.

## Direct Axios Usage

**Smell**: `import axios from 'axios'` or `axios.get(...)` outside of `shared/services/api.js`.

**Why it's bad**: Bypasses centralized token handling, retry logic, logging, and error notifications.

**How to detect**: `grep -rn "import axios\|from 'axios'" --include="*.js" --include="*.vue" src/ | grep -v "shared/services/api"`

**Fix**: Use `import api from '@/shared/services/api'` with `API_ENDPOINTS` constants.

## Mutating shallowRef Arrays

**Smell**: `.push()`, `.splice()`, `[index] = value` on a `shallowRef` array.

**Why it's bad**: Mutations are silently ignored — the UI won't update. This is the #1 reactivity bug in this codebase.

**How to detect**: Look for `.push(`, `.splice(`, `[0] =` on store arrays. Check if the store uses `shallowRef`.

**Fix**: Always replace the entire array: `items.value = [...items.value, newItem]`

## God Components (200+ lines template)

**Smell**: `.vue` file with template exceeding 200 lines or script exceeding 150 lines.

**Why it's bad**: Too many responsibilities. Hard to test, maintain, and review.

**How to detect**: `find src/ -name "*.vue" -exec wc -l {} + | sort -rn | head -20`

**Fix**: Split into focused child components. Extract state logic into composables. View components should be composition surfaces, not monoliths.

## Business Logic in Templates

**Smell**: Complex expressions in `{{ }}`, `v-if`, or `v-for` — ternaries, method chains, filtering.

```vue
<!-- WRONG -->
<div v-if="items.filter(i => i.active && i.role === 'admin').length > 0">
  {{ items.filter(i => i.active && i.role === 'admin').map(i => i.name).join(', ') }}
</div>
```

**Why it's bad**: Templates should be declarative. Complex logic is hard to read, can't be debugged, and runs on every render.

**Fix**: Extract into `computed` properties:
```vue
<script setup>
const activeAdmins = computed(() => items.value.filter(i => i.active && i.role === 'admin'))
const adminNames = computed(() => activeAdmins.value.map(i => i.name).join(', '))
</script>
<template>
  <div v-if="activeAdmins.length > 0">{{ adminNames }}</div>
</template>
```

## Cross-Feature Imports

**Smell**: `import { something } from '@/components/auth/stores/useAuthStore'` from inside `components/settings/`.

**Why it's bad**: Creates coupling between feature modules. Changes to auth break settings.

**How to detect**: `grep -rn "from '@/components/" --include="*.js" --include="*.vue" src/components/ | grep -v "from '@/components/$(basename $(dirname $file))"`

**Fix**: Move shared logic to `shared/stores/`, `shared/composables/`, or `shared/services/`. Feature modules import from `shared/`, never from each other.

**Exception**: `useAuthStore` is often needed broadly — if so, re-export it from `shared/stores/`.

## Hardcoded API URLs

**Smell**: `api.get('/api/v1/users')` or `fetch('http://localhost:8000/...')`.

**Why it's bad**: URLs change. Base URLs differ per environment. No single source of truth.

**How to detect**: `grep -rn "api\.\(get\|post\|put\|delete\)('/" --include="*.js" --include="*.vue" src/`

**Fix**: Use `API_ENDPOINTS` from `shared/constants/api.js`:
```javascript
import { API_ENDPOINTS } from '@/shared/constants/api'
await api.get(API_ENDPOINTS.USERS.BASE)
```

## Hardcoded localStorage Keys

**Smell**: `localStorage.getItem('token')` or `localStorage.setItem('locale', ...)`.

**Why it's bad**: Key typos cause silent bugs. No single source of truth.

**How to detect**: `grep -rn "localStorage\.\(get\|set\|remove\)Item" --include="*.js" --include="*.vue" src/ | grep -v "STORAGE_KEYS"`

**Fix**: Use `STORAGE_KEYS` from `shared/constants/storage.js`:
```javascript
import { STORAGE_KEYS } from '@/shared/constants/storage'
localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN)
```

## Missing Error Handling on API Calls

**Smell**: `await api.get(...)` without try/catch or `useOperationHandler`.

**Why it's bad**: Unhandled promise rejections crash silently. No user feedback on errors.

**Fix**: Use `useOperationHandler`:
```javascript
const { handleError, handleSuccess } = useOperationHandler()
try {
  await api.post(API_ENDPOINTS.USERS.BASE, data)
  handleSuccess('USERS', 'Create user', '', true)
} catch (err) {
  throw handleError(err, 'USERS', 'Create user')
}
```

## v-for Without :key

**Smell**: `<div v-for="item in items">` without `:key`.

**Why it's bad**: Vue can't track items efficiently. Causes subtle rendering bugs with stateful children (inputs, animations).

**How to detect**: `grep -rn "v-for=" --include="*.vue" src/ | grep -v ":key"`

**Fix**: Always add `:key` with a unique identifier: `<div v-for="item in items" :key="item.id">`

## Using Index as Key

**Smell**: `:key="index"` in `v-for`.

**Why it's bad**: Index changes when items are reordered, inserted, or deleted — causes wrong components to re-render.

**Fix**: Use a unique identifier: `:key="item.id"`. If items have no ID, generate one.

## v-html with User Content

**Smell**: `v-html="userProvidedContent"`.

**Why it's bad**: XSS vulnerability. Arbitrary HTML/JS execution.

**How to detect**: `grep -rn "v-html" --include="*.vue" src/`

**Fix**: Use text interpolation `{{ }}` for user content. Use `v-html` only for trusted, sanitized content with a comment explaining why it's safe.

## Props Mutation

**Smell**: `props.item.name = 'new'` or `delete props.items[0]` inside a child component.

**Why it's bad**: Violates one-way data flow. Changes propagate upward without explicit events. Vue warns about this in dev mode.

**Fix**: Emit an event: `emit('update', { ...props.item, name: 'new' })`. Parent handles the mutation.

## Inline Selectors in Tests

**Smell**: `page.locator('.btn-primary.d-grid')` directly in test spec files.

**Why it's bad**: Selector changes require updating every test. No single source of truth.

**Fix**: Put all selectors in Page Object Model classes. Tests reference methods: `signinPage.submit()`, not `page.locator('.btn-primary').click()`.

## Test Data Created Via UI

**Smell**: `beforeEach` that navigates to a form, fills it, and submits to create test data.

**Why it's bad**: Slow (full page load per test). Brittle (UI changes break setup). Leaves data behind.

**Fix**: Use API fixtures that create data directly and clean up after:
```javascript
verifiedUser: async ({ apiClient }, use) => {
  const user = await apiClient.createTestUser({ ... })
  await use(user)
  await apiClient.deleteUser(user.id)
}
```

## waitForTimeout in Tests

**Smell**: `await page.waitForTimeout(2000)` or `await new Promise(r => setTimeout(r, 1000))`.

**Why it's bad**: Arbitrary delays are flaky. Too short = test fails. Too long = test suite is slow.

**How to detect**: `grep -rn "waitForTimeout\|setTimeout" --include="*.js" e2e/`

**Fix**: Use web-first assertions: `await expect(locator).toBeVisible()`. Use `waitForURL`, `waitForLoadState('networkidle')`, or `waitForResponse`.

## Global Component Registration for Feature-Specific Components

**Smell**: Feature-specific components registered globally in `main.js`.

**Why it's bad**: All components are loaded upfront regardless of usage. Increases bundle size.

**How to detect**: Check `main.js` for `app.component()` calls with feature-specific names.

**Fix**: Import components locally in the `.vue` files that use them. Only truly shared components (used in 3+ features) belong in `main.js`.

## Missing requiresAuth on Protected Routes

**Smell**: Route definition without `meta: { requiresAuth: true }` for admin/authenticated pages.

**Why it's bad**: Route is accessible without login. Security bypass.

**How to detect**: `grep -A5 "path:" src/router/index.js | grep -B5 "component:" | grep -v "requiresAuth"`

**Fix**: Add `meta: { requiresAuth: true }` to every route that requires authentication.
