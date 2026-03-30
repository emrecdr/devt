# Review Checklist — Vue 3 / Bootstrap 5

Language-specific review priorities. The code-reviewer reads this alongside `coding-standards.md`.

---

## CRITICAL — Security

- [ ] **XSS via v-html**: unsanitized user input in `v-html` — sanitize with DOMPurify or avoid
- [ ] **Dynamic code execution**: user input in eval-like paths
- [ ] **API key exposure**: secrets in client-side code — use server-side proxy
- [ ] **CORS misconfiguration**: overly permissive origins in API config
- [ ] **Unvalidated route params**: user input from `$route.params` used without validation

## CRITICAL — Error Handling

- [ ] **Swallowed errors**: empty catch in async setup/composables
- [ ] **Missing error boundaries**: no `onErrorCaptured` or `errorHandler` for component trees
- [ ] **Unhandled promise rejections** in lifecycle hooks or watchers

## HIGH — Vue 3 Composition API

- [ ] **Options API in new code**: use Composition API with `<script setup>` for new components
- [ ] **Reactive state outside setup**: `ref()` / `reactive()` called outside component context
- [ ] **Missing `toRefs` on destructured props**: loses reactivity — use `toRefs(props)`
- [ ] **Computed without return**: computed properties must return a value
- [ ] **Watch without cleanup**: watchers that create side effects without `onCleanup`
- [ ] **Mutating props directly**: emit events instead of modifying prop values

## HIGH — Reactivity Pitfalls

- [ ] **Destructuring reactive objects**: breaks reactivity — use `toRefs()` or access via `.value`
- [ ] **Missing `.value`** on refs in script (not template)
- [ ] **Stale closures in watchers**: capturing non-reactive values
- [ ] **Unnecessary deep watchers**: `{ deep: true }` on large objects — use specific paths

## HIGH — Component Patterns

- [ ] **Prop drilling > 2 levels**: use provide/inject or Pinia store
- [ ] **Missing prop validation**: props without type or required declaration
- [ ] **Emits not declared**: events emitted but not in `defineEmits`
- [ ] **v-if with v-for on same element**: separate into nested elements

## MEDIUM — Pinia / State Management

- [ ] **Store actions without error handling**: async actions need try/catch
- [ ] **Direct state mutation outside actions**: use actions for state changes
- [ ] **Reactive state leak**: returning raw reactive objects from stores — use `storeToRefs`

## MEDIUM — Performance

- [ ] **Missing `key` on v-for**: or using array index as key
- [ ] **Heavy computation in template**: move to computed property
- [ ] **Missing lazy loading**: large components not using `defineAsyncComponent`
- [ ] **Unused component imports**: imported but never used in template

## MEDIUM — Bootstrap 5 / Styling

- [ ] **Inline styles for layout**: use Bootstrap utility classes instead
- [ ] **Custom CSS duplicating Bootstrap**: check if a utility class exists
- [ ] **Missing responsive breakpoints**: fixed widths instead of responsive grid
- [ ] **Accessibility**: missing ARIA labels on interactive elements

## MEDIUM — Testing Gaps

- [ ] New component without test
- [ ] User interactions not tested (click, input, form submit)
- [ ] Missing async flush in tests (`await nextTick()`)
- [ ] Store-dependent components tested without mock store

## Diagnostic Commands

```bash
vue-tsc --noEmit                # Type check
eslint . --ext .vue,.ts,.js     # Linting
vitest run                      # Unit tests
npx playwright test             # E2E tests
```

## Approval Criteria

- **Approve**: No CRITICAL or HIGH issues
- **Request changes**: Any CRITICAL or HIGH issue found
- **Note**: MEDIUM issues are advisory — mention but don't block
