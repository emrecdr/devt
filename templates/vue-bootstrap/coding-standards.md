# Coding Standards — Vue 3 + Bootstrap 5

## Language & Stack

- **Framework**: Vue 3.5+ with Composition API exclusively
- **Build**: Vite 8+
- **State**: Pinia 3+
- **Router**: Vue Router 5+
- **HTTP**: Axios with centralized client (`src/shared/services/api.js`)
- **UI**: Bootstrap 5 + SCSS (no Tailwind)
- **i18n**: vue-i18n 11+
- **Module system**: ESM (`"type": "module"` in package.json)
- **Formatting**: Prettier (no semicolons, single quotes, 100 char width, 2-space indent)
- **Linting**: ESLint with eslint-plugin-vue (`vue/vue3-essential`)

## Component Style

**All components MUST use `<script setup>` syntax.** No Options API. No `defineComponent()`.

```vue
<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  items: { type: Array, default: () => [] },
})

const emit = defineEmits(['update', 'delete'])

const count = computed(() => props.items.length)
</script>

<template>
  <div>
    <h2>{{ title }} ({{ count }})</h2>
  </div>
</template>

<style scoped>
/* Component-specific styles */
</style>
```

**SFC order**: `<script setup>` -> `<template>` -> `<style scoped>`

## Naming Conventions

| What | Convention | Example |
|------|-----------|---------|
| Components (files) | PascalCase or kebab-case | `DataTable.vue`, `signin.vue` |
| Components (usage) | PascalCase in templates | `<DataTable />`, `<PageHeader />` |
| Composables | camelCase with `use` prefix | `useOperationHandler.js` |
| Stores (Pinia) | camelCase with `use` prefix + `Store` | `useAuthStore.js` |
| Services | camelCase | `api.js`, `userService.js` |
| Constants | UPPER_SNAKE_CASE | `API_ENDPOINTS`, `STORAGE_KEYS` |
| Props | camelCase | `itemCount`, `isActive` |
| Events/Emits | kebab-case | `@action-click`, `@update-item` |
| CSS classes | kebab-case (Bootstrap convention) | `.data-table-card`, `.btn-primary` |
| Route names | kebab-case | `user-list`, `role-detail` |
| Route paths | kebab-case | `/admin/users`, `/auth/signin` |

## Reactivity Rules

**Minimal state, derive everything else:**

```javascript
// Source state — ref for primitives, shallowRef for large arrays
const items = shallowRef([])
const searchQuery = ref('')

// Derived — computed, never a separate ref
const filteredItems = computed(() =>
  items.value.filter(i => i.name.includes(searchQuery.value))
)
```

**shallowRef for collections** — direct mutations (`.push()`, `[0].name = x`) will NOT trigger reactivity. Always replace the entire array:

```javascript
// ADD
items.value = [...items.value, newItem]

// UPDATE
items.value = items.value.map(i => (i.id === id ? { ...i, ...updates } : i))

// DELETE
items.value = items.value.filter(i => i.id !== id)
```

Use `ref()` for single values, booleans, and small objects.

## Props & Events

- **Define props with types and defaults**: `defineProps({ name: { type: String, required: true } })`
- **Define emits explicitly**: `defineEmits(['save', 'cancel', 'delete'])`
- **Props down, events up** — never mutate props directly
- **Use `v-model` only for genuine two-way binding** (form inputs, toggles)

## Template Rules

- Keep templates declarative — move complex logic to `computed` or methods in `<script setup>`
- Use `v-if` for conditional rendering, `v-show` for frequent toggles
- Always use `:key` with `v-for` — prefer unique IDs over array index
- Never use `v-html` with user-supplied content (XSS risk)
- Keep template expressions simple — max one level of chaining (`item.name`, not `item.details.contact.phone`)

## Error Handling

Use `useOperationHandler` composable for all API operations:

```javascript
import { useOperationHandler } from '@/shared/composables/useOperationHandler'

const { handleError, handleSuccess, executeWithErrorHandling } = useOperationHandler()

// Option 1: Manual try/catch
try {
  await api.post(API_ENDPOINTS.USERS.BASE, formData)
  handleSuccess('USERS', 'Create user', '', true)
} catch (err) {
  throw handleError(err, 'USERS', 'Create user')
}

// Option 2: Wrapped execution
await executeWithErrorHandling(
  () => api.post(API_ENDPOINTS.USERS.BASE, formData),
  'USERS',
  'Create user'
)
```

## API Usage

**Always use the centralized API client** — never create standalone Axios instances:

```javascript
import api from '@/shared/services/api'
import { API_ENDPOINTS } from '@/shared/constants/api'

const response = await api.get(API_ENDPOINTS.USERS.BASE)
await api.post(API_ENDPOINTS.AUTH.LOGIN, credentials)
```

For operations without retry (file uploads): `createApiWithoutRetry()`

## Constants

- All API endpoints in `src/shared/constants/api.js` (`API_ENDPOINTS`)
- All localStorage keys in `src/shared/constants/storage.js` (`STORAGE_KEYS`)
- All app configuration in `src/shared/constants/app.js` (`APP_CONFIG`)
- All retry settings in `src/shared/constants/retry.js`

**Never hardcode endpoint URLs, storage keys, or magic strings.**

## Import Order

```javascript
// 1. Vue core
import { ref, computed, onMounted } from 'vue'

// 2. Vue ecosystem (router, i18n)
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

// 3. Third-party libraries
import dayjs from 'dayjs'

// 4. Shared composables & stores
import { useOperationHandler } from '@/shared/composables/useOperationHandler'
import { useAuthStore } from '@/components/auth/stores/useAuthStore'

// 5. Shared constants & services
import api from '@/shared/services/api'
import { API_ENDPOINTS } from '@/shared/constants/api'

// 6. Local/feature imports
import UserModal from './UserModal.vue'
```

## Modals

Use Bootstrap 5 JS API — not a Vue modal component:

```javascript
import { Modal } from 'bootstrap/dist/js/bootstrap.esm.min.js'

// Open
new Modal(document.getElementById('myModal')).show()

// Close — click the close button to let Bootstrap handle cleanup
document.getElementById('closeBtn').click()
```

## i18n

- Use `useI18n()` composable in `<script setup>`, `$t()` in templates
- All user-visible strings must use translation keys
- Locale files: `src/assets/locales/*.json`
- Supported locales: en, es, fr, de, it, nl, tr
