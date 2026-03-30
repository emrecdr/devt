# Documentation — Vue 3 + Bootstrap 5

## Feature Module Documentation

Every feature module (`src/components/<feature>/`) MUST have a `README.md` with:

### Required Sections

```markdown
# Feature Name

One-sentence description of what this feature does.

## Routes

| Path | Component | Auth Required | Description |
|------|-----------|:---:|-------------|
| `/admin/users` | UsersList.vue | Yes | User management list view |
| `/admin/users/:id` | UserDetail.vue | Yes | User detail/edit view |

## Store

**Store**: `useUserStore` in `stores/useUserStore.js`

| State | Type | Description |
|-------|------|-------------|
| `users` | `shallowRef([])` | List of user objects |
| `loading` | `ref(false)` | Loading indicator |
| `selectedUser` | `ref(null)` | Currently selected user |

| Action | Description |
|--------|-------------|
| `fetchUsers()` | Load all users from API |
| `createUser(data)` | Create new user |
| `deleteUser(id)` | Delete user by ID |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `API_ENDPOINTS.USERS.BASE` | List all users |
| POST | `API_ENDPOINTS.USERS.BASE` | Create user |
| PUT | `API_ENDPOINTS.USERS.BY_ID(id)` | Update user |
| DELETE | `API_ENDPOINTS.USERS.BY_ID(id)` | Delete user |

## Components

| Component | Responsibility |
|-----------|---------------|
| `UsersList.vue` | List view with DataTable, search, create button |
| `UserModal.vue` | Create/edit modal form |
| `UserDetail.vue` | Detail view with tabs |

## Dependencies

- Depends on: `useAuthStore` (for permissions), `useNotificationStore` (for feedback)
- Depended on by: None (leaf feature module)
```

### When to Update Feature README

Update when ANY of these change:

1. New route added or path changed
2. New store action or state field added
3. New API endpoint consumed
4. New component added to the module
5. Component responsibilities change
6. New dependency on another store/service added
7. Permissions or auth requirements change
8. Data model changes (new fields, renamed fields)

**Rule**: Read the feature README BEFORE implementing changes. Update it AFTER.

## Shared Component Documentation

Document components in `src/shared/components/` with JSDoc-style comments in the `<script setup>`:

```vue
<script setup>
/**
 * DataTable — Reusable data list component with search, pagination, and actions.
 *
 * @example
 * <DataTable
 *   :items="users"
 *   :columns="columns"
 *   :actions="actions"
 *   :loading="loading"
 *   @action-click="handleAction"
 * />
 */
const props = defineProps({
  /** Array of data objects to display */
  items: { type: Array, required: true },
  /** Column definitions: { key, label, sortable?, slotName?, filterOptions? } */
  columns: { type: Array, required: true },
  /** Action buttons: { name, label, icon, class, condition? } */
  actions: { type: Array, default: () => [] },
  /** Show loading state */
  loading: { type: Boolean, default: false },
  /** Enable pagination */
  pagination: { type: Boolean, default: true },
})

const emit = defineEmits([
  /** Emitted when an action button is clicked. Payload: { action, item } */
  'action-click',
])
</script>
```

### Shared Component Checklist

For each shared component, document:

- [ ] All props with types, defaults, and descriptions
- [ ] All emitted events with payload shapes
- [ ] All named slots and their scoped data
- [ ] Usage example showing typical integration
- [ ] Any CSS classes that consumers can override
- [ ] Any accessibility notes (ARIA roles, keyboard navigation)

## Composable Documentation

Document composables with JSDoc before the export:

```javascript
/**
 * useOperationHandler — Standardized error/success handling with logging and notifications.
 *
 * @returns {{
 *   error: import('vue').Ref<string|null>,
 *   isError: import('vue').Ref<boolean>,
 *   handleError: (err: Error, context: string, operation: string, showNotification?: boolean) => Error,
 *   clearError: () => void,
 *   handleSuccess: (context: string, operation: string, details?: string, showNotification?: boolean) => void,
 *   executeWithErrorHandling: (asyncFn: Function, context: string, operation: string) => Promise<any>
 * }}
 *
 * @example
 * const { handleError, handleSuccess } = useOperationHandler()
 * try {
 *   await api.post(API_ENDPOINTS.USERS.BASE, data)
 *   handleSuccess('USERS', 'Create user', '', true)
 * } catch (err) {
 *   throw handleError(err, 'USERS', 'Create user')
 * }
 */
export function useOperationHandler() { ... }
```

## Pinia Store Documentation

Document stores with a header comment:

```javascript
/**
 * useUserStore — Manages user data for the admin/users feature.
 *
 * State:
 *   - users (shallowRef<User[]>): All loaded users
 *   - loading (ref<boolean>): Loading state
 *
 * Actions:
 *   - fetchUsers(): Load users from API
 *   - createUser(data): Create and add to list
 *   - deleteUser(id): Remove from list and API
 *
 * Getters:
 *   - activeUsers (computed): Users where isActive === true
 */
export const useUserStore = defineStore('user', () => { ... })
```

## API Endpoint Documentation

All endpoints in `src/shared/constants/api.js`:

```javascript
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/api/v1/auth/login',        // POST — { email, password } → { access_token, refresh_token }
    LOGOUT: '/api/v1/auth/logout',      // POST — {} → 204
    REFRESH: '/api/v1/auth/token/refresh', // POST — { refresh_token } → { access_token }
  },
  USERS: {
    BASE: '/api/v1/users',              // GET → User[], POST { email, ... } → User
    BY_ID: (id) => `/api/v1/users/${id}`, // GET → User, PUT → User, DELETE → 204
  },
}
```

When adding new endpoints:
1. Add to the appropriate section (or create a new section)
2. Include a comment with HTTP method and basic request/response shape
3. Use function syntax for parameterized URLs: `BY_ID: (id) => \`...\``

## E2E Test Documentation

### Page Object Documentation

Document non-obvious selectors:

```javascript
/**
 * Page object for the Sign In page.
 * Source: src/components/auth/views/signin/signin.vue
 *
 * Notes:
 * - The submit button is a <div>, not a <button> — getByRole('button') won't match.
 * - Email/password labels have for="email"/for="password" but inputs lack matching ids,
 *   so getByLabel() won't associate them. Use type-based selectors instead.
 */
```

### Fixture Documentation

Document fixture dependencies in `e2e/fixtures/auth.fixture.js`:

```javascript
/**
 * verifiedUser: Creates a verified test user, yields credentials, deletes after test.
 * Depends on: apiClient (worker-scoped)
 *
 * authenticatedPage: Logs in via UI, yields authenticated page.
 * Depends on: verifiedUser, page
 *
 * adminPage: Logs in as system admin.
 * Depends on: page (uses SYSTEM_ADMIN from constants)
 */
```

### Environment Variables for Tests

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_BASE_URL` | `http://localhost:3000` | Frontend URL |
| `E2E_BACKEND_URL` | `http://127.0.0.1:8000` | Backend API URL |
| `E2E_ADMIN_EMAIL` | `admin@example.com` | System admin email |
| `E2E_ADMIN_PASSWORD` | (default in constants) | System admin password |
| `E2E_TESTING_SECRET` | (none) | Backend testing API secret |
| `SLOW_MO` | 0 | Playwright slow motion (ms) |
| `CI` | (unset) | CI mode: 1 worker, 2 retries |

## CLAUDE.md Maintenance

The project `CLAUDE.md` is the primary reference for AI assistants. Update when:

- Architecture patterns change
- New shared components are added
- API client behavior changes
- Authentication flow changes
- New feature development patterns emerge
- Environment variables are added/removed
- Important conventions change

Keep `CLAUDE.md` as the single source of truth for project-level context.
