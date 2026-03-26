---
name: api-docs-fetcher
description: Use when implementing external integrations and need up-to-date library documentation. Uses Context7 to fetch current docs for any library. Trigger on 'how do I use X', 'what is the API for Y', third-party library mentions, or when about to use a library API from memory — always fetch current docs instead.
---

# API Docs Fetcher

## Overview

External library documentation changes faster than training data. Always fetch current documentation before implementing integrations, instead of relying on potentially outdated knowledge.

## When to Use

- Implementing an integration with a third-party library or service
- Unsure about the current API for a specific library version
- Need code examples for a library's recommended patterns
- Verifying that a remembered API has not changed in a newer version
- Setting up a new dependency for the first time

## The Process

### Step 1: Identify the Library

Determine the exact library name and, if relevant, the version being used. Check the project's dependency file (e.g., `pyproject.toml`, `package.json`) for the pinned version.

### Step 2: Resolve Library ID

Use Context7's `resolve-library-id` to find the correct documentation source. Provide the library name as the query.

If multiple results are returned, select the one matching the project's language and framework.

### Step 3: Query Documentation

Use Context7's `query-docs` with the resolved library ID and a specific topic query. Be precise:

- Good: "Express middleware error handling async errors"
- Bad: "Express" (too broad)
- Good: "React useEffect cleanup function memory leaks"
- Bad: "React tutorial" (too vague)

### Step 4: Extract Relevant Patterns

From the documentation response, extract:

- The recommended pattern or API usage
- Required imports
- Configuration or setup requirements
- Common pitfalls or migration notes
- Code examples that match the project's use case

### Step 5: Adapt to Project

Documentation examples are generic. Adapt to the project's conventions:

- Match naming conventions
- Follow the project's architectural patterns
- Use the project's error handling approach
- Integrate with existing dependency injection

## Gate Functions

### Gate: Library Identified

- [ ] Exact library name known
- [ ] Version confirmed from project dependencies

### Gate: Documentation Retrieved

- [ ] Library ID resolved via Context7
- [ ] Relevant topic queried with specific query
- [ ] Patterns extracted and understood

## Red Flags — STOP

- "I know this library well" — Documentation may have changed. Verify.
- "The API is straightforward" — Fetch docs anyway. Edge cases hide in documentation.
- "I'll use the pattern I remember" — Memory is stale. Documentation is current.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Fetching docs is slow" | Debugging wrong API usage is slower |
| "I used this library last week" | Libraries release updates frequently |
| "The docs won't have this specific use case" | Query specifically and you may be surprised |
| "I'll check docs if my code does not work" | Check first. Do not debug preventable issues. |

## Integration

- **Prerequisites**: None
- **Used by agents**: programmer (when implementing integrations), architect (when evaluating library choices)
- **Related skills**: strategic-analysis (when choosing between libraries)
