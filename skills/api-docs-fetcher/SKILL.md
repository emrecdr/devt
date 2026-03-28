---
name: api-docs-fetcher
description: Use when implementing external integrations and need up-to-date library documentation. Uses Context7 to fetch current docs for any library. Trigger on 'how do I use X', 'what is the API for Y', third-party library mentions, or when about to use a library API from memory — always fetch current docs instead.
---

# API Docs Fetcher

## Overview

External library documentation changes faster than training data. Always fetch current documentation before implementing integrations, instead of relying on potentially outdated knowledge.

## The Iron Law

```
NO LIBRARY CODE FROM MEMORY — ALWAYS FETCH CURRENT DOCS
```

Documentation changes faster than training data. Code written from memory uses stale APIs, misses breaking changes, and introduces bugs that current docs would have prevented.

Library APIs change between versions and LLM training data contains outdated signatures, deprecated patterns, and removed features. Code written from memory often compiles but uses wrong defaults, misses security patches, or triggers deprecation warnings. Fetching current docs takes seconds and prevents hours of debugging version mismatches.

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

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
| --- | --- | --- |
| "I know this library well" | Documentation may have changed since your last use | Fetch current docs and verify |
| "The API is straightforward" | Edge cases hide in documentation you haven't read | Fetch docs anyway |
| "I'll use the pattern I remember" | Memory is stale. Documentation is current. | Always query current docs |
| "Fetching docs is slow" | Debugging wrong API usage is slower | Spend 30 seconds fetching, save hours debugging |
| "I used this library last week" | Libraries release updates frequently | Re-fetch on every integration task |
| "The docs won't have this specific use case" | Specific queries often surface relevant patterns | Query specifically and you may be surprised |
| "I'll check docs if my code does not work" | Preventable issues waste debugging time | Check first, code second |

## Integration

- **Prerequisites**: None
- **Used by agents**: programmer (when implementing integrations), architect (when evaluating library choices)
- **Related skills**: strategic-analysis (when choosing between libraries)
