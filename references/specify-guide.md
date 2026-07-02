# specify workflow — reference material (best practices, anti-patterns, example)

Loaded on demand from `workflows/specify.md`. Illustration + technique for `/devt:specify`; not required to execute the workflow steps.

## Best Practices

1. **Non-obvious questions only** — if the answer is implied by the feature description, do not ask
2. **Show your homework** — reference codebase findings in every question ("I found X, so I recommend Y")
3. **Cover all categories** — skipping security or edge cases creates gaps that surface during implementation
4. **Be specific in the PRD** — include field names, status codes, endpoint paths; vague specs produce vague implementations
5. **Order tasks by dependency** — later tasks should depend on earlier ones; the implementer should be able to work top-to-bottom
6. **Mark uncertainty explicitly** — if something was assumed rather than confirmed, mark it in the Assumptions table

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
|-------------|-------------|---------|
| Asking obvious questions | Wastes user's time, erodes trust | Only ask what the feature description does not answer |
| Generic questions without codebase context | Produces generic answers that may conflict with existing code | Analyze codebase first, then ask contextual questions |
| Skipping the "Out of Scope" section | Scope creeps during implementation because boundaries were never defined | Explicitly list what is NOT being built |
| Assumptions without marking them | Implementer treats assumptions as confirmed decisions, builds wrong thing | Always mark with "Assumed" and note impact if wrong |
| Too many interview questions (>12) | User fatigue leads to rushed answers | Batch related questions, skip obvious ones, aim for 6-10 |
| PRD with placeholder brackets left in | Downstream tools treat placeholders as real content | Fill every section or remove it if not applicable |

## Example Session

```
User: /devt:specify "Add rate limiting to public API endpoints"

Claude: [Reads .devt/rules/, analyzes codebase]
Claude: I analyzed the codebase and found:
- 12 public endpoints across 3 services
- No existing rate limiting implementation
- Redis is available (used for caching in services/cache/)
- The project uses dependency injection for service wiring

Let me ask a few questions to scope this:

[AskUserQuestion: Rate limiting strategy — per-IP, per-API-key, or per-user?]
[AskUserQuestion: Limits — fixed window, sliding window, or token bucket?]
[AskUserQuestion: Which endpoints — all public, or specific high-risk ones?]
[AskUserQuestion: What happens when limit is hit — 429 with retry-after, or silent throttle?]
[AskUserQuestion: Should admin endpoints be exempt?]

Claude: Based on your answers, I have generated the PRD.

Created:
- docs/specs/rate-limiting.md (permanent)
- .devt/state/spec.md (for pipeline)

Summary: 3 user stories, 2 phases, 8 tasks, 1 assumption needs validation

Next step: /devt:plan to create the implementation plan
```
