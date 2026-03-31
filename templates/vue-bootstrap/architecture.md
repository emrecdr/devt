# Architecture — Vue 3 + Bootstrap 5

## Project Layout

```
src/
├── components/              # Feature modules (feature-based organization)
│   ├── admin/              # Admin features
│   │   ├── services/       # Feature-specific API services
│   │   ├── stores/         # Feature-specific Pinia stores
│   │   ├── types/          # Type definitions
│   │   ├── views/          # Feature view components
│   │   └── index.js        # Module exports
│   ├── auth/               # Authentication module
│   ├── operations/         # Operations management
│   ├── settings/           # Settings features
│   └── dashboard/          # Dashboard views
├── shared/                 # Shared application resources
│   ├── services/           # Centralized services (api.js)
│   ├── stores/             # Shared Pinia stores
│   ├── composables/        # Vue composables (useLogger, useOperationHandler, useLoading)
│   ├── constants/          # Constants and configs (api.js, retry.js, storage.js, app.js)
│   ├── layouts/            # Layout components (MainDashboard, Landingpage)
│   ├── components/         # Shared components (DataTable, PageHeader)
│   └── UI/                 # Shared UI components
├── router/                 # Vue Router configuration
├── stores/                 # Global Pinia stores (theme/layout switcher)
├── assets/                 # Static assets (SCSS, images, locales)
├── data/                   # Static data files
├── main.js                 # Application entry point
└── i18n.js                 # Internationalization configuration
```

## Feature Module Pattern

Every feature lives in `src/components/<feature>/` with a consistent structure:

```
components/<feature>/
├── index.js                # Module exports
├── services/               # Feature-specific API service functions
├── stores/                 # Feature-specific Pinia stores
├── types/                  # Type definitions (if applicable)
└── views/                  # Feature view components
    ├── FeatureList.vue     # List/table view
    ├── FeatureDetail.vue   # Detail/edit view
    └── FeatureModal.vue    # Create/edit modal
```

**Rules:**
- Each feature module is self-contained — its own services, stores, and views
- Feature modules import from `@/shared/` but NEVER from other feature modules
- Cross-feature data access goes through shared services or stores
- Export main components via `index.js`

## Layer Boundaries

```
Views (components/<feature>/views/)
  ↓ uses
Stores (components/<feature>/stores/)
  ↓ calls
Services (components/<feature>/services/)
  ↓ calls
API Client (shared/services/api.js)
  ↓ HTTP
Backend
```

**Dependency direction**: Views → Stores → Services → API Client (never reverse)

### Constants Organization

Cross-cutting constants live in `shared/constants/` with dedicated files by concern:

| File | Contents | Example |
|------|----------|---------|
| `api.js` | API endpoints, base URL | `API_ENDPOINTS.USERS`, `API_BASE_URL` |
| `storage.js` | localStorage/sessionStorage keys | `STORAGE_KEYS.ACCESS_TOKEN` |
| `app.js` | App-wide config, supported languages | `APP_CONFIG.DEFAULT_LOCALE` |
| `retry.js` | HTTP retry configuration | `RETRY_CONFIG.MAX_RETRIES` |

Feature-specific constants (column definitions, status enums) may live within the feature module. Only cross-cutting constants belong in `shared/constants/`.

**Violations:**
- Views must NOT call API client directly — go through stores or services
- Stores must NOT import from other feature stores (use shared stores for cross-feature state)
- Services must NOT import Vue reactivity — they are plain functions returning data

## Component Architecture

### Component Types

| Type | Location | Responsibility |
|------|----------|---------------|
| **Layout** | `shared/layouts/` | Page shell (header, sidebar, footer) |
| **View** | `components/<feature>/views/` | Feature page — composition surface, route target |
| **Shared** | `shared/components/` | Reusable UI (DataTable, PageHeader, LanguageSelector) |
| **UI** | `shared/UI/` | Primitive UI components (toggles, selects, charts) |

### Component Split Rules

Split a component when **any** condition is true:

- It has 3+ distinct UI sections (form, list, filters, status)
- It handles both data orchestration AND substantial presentation
- A template block is repeated or reusable (card rows, list items)
- The template exceeds ~200 lines

**View components are composition surfaces** — they wire together child components, composables, and stores. Keep them thin.

## State Management

### Store Architecture

```
src/stores/                     # Global stores (theme, layout)
src/shared/stores/              # Shared stores (notifications)
src/components/<feature>/stores/ # Feature stores (users, roles, etc.)
```

### Store Conventions

```javascript
import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'

export const useFeatureStore = defineStore('feature', () => {
  // State — shallowRef for arrays, ref for primitives
  const items = shallowRef([])
  const loading = ref(false)
  const error = ref(null)

  // Getters — computed
  const activeItems = computed(() => items.value.filter(i => i.isActive))

  // Actions — async functions
  async function fetchItems() {
    loading.value = true
    try {
      const response = await api.get(API_ENDPOINTS.FEATURE.BASE)
      items.value = response.data
    } finally {
      loading.value = false
    }
  }

  return { items, loading, error, activeItems, fetchItems }
})
```

### API Client Architecture

The centralized API client (`shared/services/api.js`) handles:

- **JWT auto-attach**: Request interceptor adds `Bearer ${accessToken}` to all requests
- **Token refresh**: Response interceptor catches 401, refreshes token (single-flight guard prevents parallel refresh loops), retries original request
- **Retry logic**: `axios-retry` with exponential backoff for transient failures (configurable via `RETRY_CONFIG`)
- **Error notification**: Failed requests surface via `useToast()` composable
- **Logging**: All requests/responses logged via `useLogger()` in development

Never create standalone Axios instances. All HTTP traffic flows through the shared API client.

## Authentication Flow

- JWT-based with access/refresh tokens in localStorage
- Auto-refresh via API interceptor in `api.js` on 401 responses
- Auth state managed by `useAuthStore`
- Protected routes use `meta: { requiresAuth: true }`
- Route guard checks auth before navigation

## Routing

- Layout-based routing with nested children
- Main layouts: `MainDashboard`, `Landingpage`, `Errorpagesinfo`
- Route definitions in `src/router/index.js`
- Always add `meta: { requiresAuth: true }` for protected routes

## Environment Variables

All prefixed with `VITE_`:

- `VITE_API_BASE_URL` — Backend API base URL
- `VITE_DEBUG_MODE` — Enable debug mode
- `VITE_APP_NAME` — Application display name

Files: `.env.development`, `.env.production`, `.env.qa`, `.env.test`

## Theme & Layout System

A global Pinia `switcher` store manages visual settings via HTML `data-*` attributes:

- `data-theme-mode`: light / dark
- `data-nav-layout`: vertical / horizontal
- `data-page-style`: regular / classic

CSS variables (`--primary-rgb`, `--body-bg-rgb`) respond to these attributes. Components read theme state from the switcher store, never from DOM attributes directly.
