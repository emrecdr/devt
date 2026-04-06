# Testing Patterns — Vue 3 + Playwright

## Test Strategy

**Playwright E2E tests are the primary validation method.** No unit test framework (vitest/jest) is configured. All testing goes through Playwright.

## E2E Architecture

```
e2e/
├── tests/                  # Test specs organized by feature
│   ├── auth/              # Authentication tests
│   │   ├── login.spec.js
│   │   ├── logout.spec.js
│   │   ├── forgot-password.spec.js
│   │   ├── session-expiry.spec.js
│   │   └── ...
│   ├── admin/             # Admin feature tests
│   │   ├── users.spec.js
│   │   └── roles.spec.js
│   ├── header/            # Header/navigation tests
│   ├── pages/             # Page-specific tests
│   ├── global.setup.js    # Global setup (auth, seed data)
│   └── global.teardown.js # Global cleanup
├── pages/                 # Page Object Model classes
│   ├── base/              # Base page objects (DataListPage)
│   ├── signin.page.js
│   ├── dashboard.page.js
│   └── ...
├── fixtures/              # Playwright test fixtures
│   └── auth.fixture.js    # Extended test with auth, page objects, test data
├── helpers/               # Shared utilities
│   ├── api-client.js      # API client for test data management
│   └── constants.js       # Test constants, credentials, selectors
└── test-results/          # Generated reports and screenshots
```

## Page Object Model (POM)

Every page/component under test gets a page object class:

```javascript
export class SignInPage {
  constructor(page) {
    this.page = page
    // Define locators in constructor — single source of truth
    this.emailInput = page.locator('.form-signin input[type="email"]')
    this.passwordInput = page.locator('.form-signin input[type="password"]')
    this.submitButton = page.locator('.form-signin .btn-primary.d-grid')
    this.errorMessage = page.locator('.form-signin > div.invalid-feedback.d-block')
  }

  async goto() {
    await this.page.goto('/auth/signin')
  }

  async login(email, password) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }
}
```

**Rules:**
- One class per page/major component
- All locators defined in constructor
- Methods represent user actions (not implementation details)
- Document non-obvious selectors (e.g., "Submit is a `<div>`, not a `<button>`")
- Use base classes for shared patterns (`DataListPage` for all list views)

### Base Page Objects

For DataTable-based list pages, extend the base:

```javascript
import { DataListPage } from './base/data-list.page.js'

export class UsersListPage extends DataListPage {
  constructor(page) {
    super(page)
    // Feature-specific locators
    this.createUserModal = page.locator('#createUserModal')
  }
}
```

## Test Fixtures

Use Playwright's fixture system for test data lifecycle:

```javascript
import { test as base } from '@playwright/test'

export const test = base.extend({
  // Worker-scoped API client (shared across tests in a worker)
  apiClient: [async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext()
    const client = new ApiClient(ctx)
    await use(client)
    await ctx.dispose()
  }, { scope: 'worker' }],

  // Test-scoped: creates data, cleans up after test
  verifiedUser: async ({ apiClient }, use) => {
    const user = await apiClient.createTestUser({ ... })
    await use(user)
    await apiClient.deleteUser(user.id) // Always clean up
  },

  // Authenticated page: logs in through UI
  authenticatedPage: async ({ page, verifiedUser }, use) => {
    const signinPage = new SignInPage(page)
    await signinPage.goto()
    await signinPage.login(verifiedUser.email, verifiedUser.password)
    await page.waitForURL('**/dashboard**')
    await use(page)
  },

  // Page objects — auto-created per test
  signinPage: async ({ page }, use) => {
    await use(new SignInPage(page))
  },
})

export { expect } from '@playwright/test'
```

**Rules:**
- Test data created via API (not UI) — faster and more reliable
- Every fixture that creates data MUST delete it in the teardown
- Worker-scoped fixtures for expensive resources (API clients)
- Test-scoped fixtures for test-specific data (users, roles)
- If fixture setup fails, yield `null` so tests can `test.skip()`

## API Client for Test Data

```javascript
export class ApiClient {
  constructor(request) {
    this.request = request
    this.baseURL = BACKEND_URL
  }

  async createTestUser({ email, password, firstName, lastName }) { ... }
  async verifyUserEmail(userId) { ... }
  async deleteUser(userId) { ... }

  // Admin requests with automatic 401 retry
  async _adminRequest(method, url, options = {}) {
    const token = await this.loginAsSystemAdmin()
    const response = await this.request[method](url, {
      ...options,
      headers: { Authorization: `Bearer ${token}` },
    })
    if (response.status() === 401) {
      // Re-authenticate and retry once
    }
    return response
  }
}
```

## Writing Tests

### Structure

```javascript
import { test, expect } from '../../fixtures/auth.fixture.js'

test.describe('Login', () => {
  test('successful login redirects to dashboard', async ({ signinPage, verifiedUser, page }) => {
    await signinPage.goto()
    await signinPage.login(verifiedUser.email, verifiedUser.password)
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
  })

  test('wrong password shows error', async ({ signinPage, verifiedUser }) => {
    await signinPage.goto()
    await signinPage.login(verifiedUser.email, 'WrongP@ss123!')
    await expect(signinPage.errorMessage).toBeVisible()
  })
})
```

### Test Conventions

- **Use web-first assertions** — `await expect(locator).toBeVisible()` (auto-waits)
- **Never use `page.waitForTimeout()`** — use `waitForURL`, `waitForLoadState`, or web-first assertions
- **One assertion per test when practical** — clear failure messages
- **Use fixtures for test data** — never create test data in `beforeEach`
- **Test file naming**: `<feature>.spec.js` in `e2e/tests/<category>/`
- **Describe blocks** group related scenarios
- **Test names** describe the expected behavior, not the implementation

### Locator Strategy (Priority Order)

1. **Role-based**: `page.getByRole('button', { name: 'Submit' })` — preferred
2. **Test IDs**: `page.locator('[data-testid="submit-btn"]')` — for components without accessible roles
3. **CSS selectors**: `page.locator('.form-signin .btn-primary')` — when role/testid unavailable
4. **Text-based**: `page.getByText('Sign In')` — for static text assertions

**Document non-standard selectors** in page objects with comments explaining why.

### Conditional Test Skipping

```javascript
// Skip if feature is unavailable
test('2FA login flow', async ({ twoFactorUser }) => {
  test.skip(!twoFactorUser, '2FA not available in this environment')
  // ... test body
})

// Skip if permission missing
await page.skipIfNoCreatePermission(test)
```

## Playwright Configuration

```javascript
// playwright.config.js
export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './e2e/test-results',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /global\.setup\.js/, teardown: 'cleanup' },
    { name: 'cleanup', testMatch: /global\.teardown\.js/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

## Test Constants

Centralize all test configuration:

```javascript
// e2e/helpers/constants.js
export const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://127.0.0.1:8000'
export const SYSTEM_ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'DefaultP@ss!',
}
export const TEST_PASSWORD = 'E2eTest@2026!'

export function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}
```

## Anti-Patterns

| Anti-Pattern | Do Instead |
|-------------|-----------|
| `page.waitForTimeout(2000)` | Use web-first assertions or `waitForURL` |
| Hardcoded test credentials in spec files | Use `constants.js` and fixtures |
| Creating test data via UI in `beforeEach` | Create via API client in fixtures |
| Sharing state between tests | Each test creates and cleans its own data |
| Using `page.$()` or `page.evaluate()` for assertions | Use `expect(locator)` web-first assertions |
| Asserting on implementation details (CSS classes) | Assert on visible behavior (text, visibility, URL) |
| Tests that depend on execution order | Each test is independent and self-contained |
| Catching errors to prevent test failure | Let assertions fail — that's the point |
| Long test files (100+ lines per test) | Split into focused describe blocks |
| Testing third-party library behavior | Test YOUR code's behavior |

## Visual Regression & Screenshot Testing

Use Playwright's built-in visual comparison for catching unintended UI changes:

```javascript
test('dashboard renders correctly', async ({ authenticatedPage }) => {
  await authenticatedPage.goto('/dashboard')
  await authenticatedPage.waitForLoadState('networkidle')
  await expect(authenticatedPage).toHaveScreenshot('dashboard.png', {
    maxDiffPixelRatio: 0.01,  // Allow 1% pixel difference
    animations: 'disabled',   // Freeze CSS animations
  })
})

test('empty state shows placeholder', async ({ authenticatedPage }) => {
  await authenticatedPage.goto('/projects')
  await expect(authenticatedPage.locator('.empty-state')).toHaveScreenshot('empty-projects.png')
})
```

**Rules:**
- Baseline screenshots committed to `e2e/tests/__snapshots__/`
- Update baselines explicitly: `npx playwright test --update-snapshots`
- Disable animations for deterministic screenshots
- Use `maxDiffPixelRatio` not `maxDiffPixels` — resolution-independent
- Compare component screenshots (not full-page) when testing specific features

## Accessibility Testing

Playwright exposes an accessibility snapshot for every page:

```javascript
test('login form is accessible', async ({ signinPage }) => {
  await signinPage.goto()

  // Role-based locators verify accessibility — if getByRole finds it, the element is accessible
  const emailInput = signinPage.page.getByRole('textbox', { name: /email/i })
  await expect(emailInput).toBeVisible()

  const passwordInput = signinPage.page.getByRole('textbox', { name: /password/i })
  await expect(passwordInput).toBeVisible()

  const submitBtn = signinPage.page.getByRole('button', { name: /sign in/i })
  await expect(submitBtn).toBeVisible()
})

// For structured ARIA verification (Playwright v1.49+):
test('login form matches ARIA snapshot', async ({ signinPage }) => {
  await signinPage.goto()
  await expect(signinPage.page.locator('.form-signin')).toMatchAriaSnapshot(`
    - textbox "Email"
    - textbox "Password"
    - button "Sign In"
  `)
})
```

**Accessibility conventions:**
- Every interactive element must have an accessible name (from label, aria-label, or text content)
- Form inputs need associated `<label>` elements or `aria-label`
- Use `getByRole()` locators — if you can't find an element by role, it's an a11y issue
- Test keyboard navigation for critical flows (Tab order, Enter to submit)

## Network Inspection Patterns

Validate API calls during E2E flows:

```javascript
test('login sends correct API request', async ({ page, signinPage, verifiedUser }) => {
  const apiPromise = page.waitForRequest(req =>
    req.url().includes('/api/auth/login') && req.method() === 'POST'
  )
  await signinPage.goto()
  await signinPage.login(verifiedUser.email, verifiedUser.password)
  const request = await apiPromise
  const body = request.postData()
  expect(body).toBeTruthy()
  expect(JSON.parse(body)).toMatchObject({
    email: verifiedUser.email,
  })
})

test('dashboard loads data from API', async ({ authenticatedPage }) => {
  const responsePromise = authenticatedPage.waitForResponse(
    res => res.url().includes('/api/dashboard') && res.status() === 200
  )
  await authenticatedPage.goto('/dashboard')
  const response = await responsePromise
  const data = await response.json()
  expect(data).toHaveProperty('widgets')
})
```

**Rules:**
- Set up request/response watchers BEFORE triggering the action
- Assert on request shape (method, URL, body) not just success
- Use `waitForResponse` to verify API contracts between frontend and backend
- Never rely on network timing — use explicit waits, not timeouts

## Playwright MCP Integration (Agent Verification)

When the Playwright MCP server is available, agents can use browser tools for automated UI verification during the verification phase. This enables programmatic checks that would otherwise require human review.

**Available MCP tools** (when `plugin:playwright` is configured):
- `browser_navigate` — Load a URL
- `browser_snapshot` — Get accessibility snapshot (structured DOM tree)
- `browser_take_screenshot` — Capture visual screenshot
- `browser_click` / `browser_fill_form` — Interact with elements
- `browser_console_messages` — Read console errors/warnings
- `browser_network_requests` — Inspect network activity

**Verification workflow for agents:**
1. Start the dev server (if not already running)
2. Navigate to the implemented feature URL
3. Take an accessibility snapshot — verify key elements exist
4. Take a screenshot — save to `.devt/state/` for human review
5. Check console for errors/warnings — no uncaught exceptions
6. Verify network requests — expected API calls made

**When to use MCP vs. Playwright tests:**
- **Playwright tests** (`.spec.js`): Automated, repeatable, run in CI. For regression testing.
- **MCP verification**: One-shot agent checks during development. For "does the feature look right?"

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run with UI (interactive mode)
npm run test:e2e:ui

# Run headed with slow motion (debugging)
npm run test:e2e:headed

# Run with Playwright debugger
npm run test:e2e:debug

# Run specific test file
npx playwright test e2e/tests/auth/login.spec.js

# Run tests matching pattern
npx playwright test -g "successful login"
```
