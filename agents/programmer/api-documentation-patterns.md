# API Documentation Patterns

Standards for documenting APIs within the codebase. These are generic guidelines — read `.dev-rules/` for project-specific conventions and framework details.

## Endpoint Documentation

Every API endpoint must have:

### 1. Summary
A short, action-oriented phrase describing what the endpoint does.
- Good: "Register a new user account"
- Bad: "User registration endpoint"
- Bad: "POST user"

### 2. Description
A paragraph explaining:
- What the endpoint does in business terms
- Who should call it (roles, permissions if applicable)
- Important behavior details (side effects, async operations, idempotency)
- Relationship to other endpoints if part of a workflow

### 3. Response Examples
Document all response status codes with example payloads:
- **Success responses**: Full example of the response body
- **Error responses**: Example for each documented error status code
- **Validation errors**: Example of input validation failure format

### 4. Request Documentation
- All path parameters with descriptions and constraints
- All query parameters with descriptions, defaults, and valid ranges
- Request body schema with field descriptions and validation rules
- Required vs optional fields clearly marked

## Inline Code Documentation

### When to Add Docstrings
- Public functions and methods — always
- Complex business logic — explain the WHY, not the WHAT
- Non-obvious algorithms — explain the approach
- Functions with side effects — document them explicitly

### When NOT to Add Docstrings
- Private helper functions with obvious behavior
- Simple getters/setters
- Functions whose name and type signature fully describe their behavior

### Docstring Content
- First line: what the function does (imperative mood)
- Args: parameter names, types, descriptions, constraints
- Returns: what is returned and when
- Raises: which exceptions and under what conditions

## General Principles

- **Documentation lives with the code** — not in external wikis that go stale
- **Update docs when changing behavior** — stale docs are worse than no docs
- **Be precise** — vague documentation creates false confidence
- **Read `.dev-rules/documentation.md`** for project-specific formatting, file naming, and structural rules
