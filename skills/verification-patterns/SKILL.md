---
name: verification-patterns
description: Use before claiming work is complete to verify artifacts are real, not placeholders. 4-level verification — exists, substantive, wired, functional — catches stubs, TODO markers, and disconnected code. Trigger whenever any agent reports DONE, when reviewing completeness, or on 'is this actually working'.
---

# Verification Patterns

## Overview

The most common failure in AI-generated code is "looks done but isn't" — files exist but contain stubs, functions are defined but never called, features are coded but not wired into the system.

## When to Use

Before reporting DONE status on any implementation task. Before code review. Before claiming a feature works.

## The 4 Levels

### Level 1: Exists
- File is present at expected path
- Has non-zero size
- Is not a copy of a template with no modifications

### Level 2: Substantive
Content is real implementation, not placeholder. Scan for:
- `# TODO`, `# FIXME`, `# HACK`
- `pass` (Python), `return null/undefined` (JS/TS), `return nil` (Go)
- `raise NotImplementedError`
- `return {}`, `return []`, `return ""` where real data expected
- `"placeholder"`, `"example"`, `"test"` as return values
- Functions with only a docstring and no implementation
- Empty catch/except blocks

### Level 3: Wired
Connected to the rest of the system:
- Is the file imported somewhere?
- Is the function/class called from another module?
- Is the route registered in the router?
- Is the service injected via dependency injection?
- Is the test actually run by the test runner?

### Level 4: Functional
Actually works when invoked:
- Tests pass (not just exist)
- Quality gates pass
- Manual smoke test succeeds (if applicable)

## Gate Function

Before reporting DONE, verify ALL artifacts at Level 3 minimum:
1. List every file you created or modified
2. For each: confirm Level 1 (exists), Level 2 (no stubs), Level 3 (wired)
3. Run tests for Level 4
4. If ANY artifact fails Level 2 or 3, fix it before reporting

### Stub Detection Examples

**Python stubs:**
```python
def process_payment(amount):
    pass  # STUB -- Level 2 fail

def validate_email(email):
    return True  # STUB -- always returns True

def get_user(user_id):
    raise NotImplementedError  # STUB -- explicit
```

**JavaScript stubs:**
```javascript
function processPayment(amount) {
    return null; // STUB -- null return
}

const config = {}; // STUB -- empty object where real config expected
```

**Go stubs:**
```go
func ProcessPayment(amount float64) error {
    return nil // STUB -- silently succeeds
}
```

## Anti-patterns

| Don't | Why It Fails | Do Instead |
|-------|-------------|------------|
| "The file is there, that's enough" | Exists (L1) does not mean Substantive (L2) | Scan for stubs, pass, NotImplementedError, empty returns |
| "I'll wire it up later" | Unwired code is dead code -- it will never be wired | Wire it NOW. Verify imports and registrations. |
| "The test exists" | Written does not mean Passing | Run the test. Check Level 4. |
| "It should work" | "Should" is not evidence | Run it. Show output. Evidence before claims. |
| "It compiles" | Compiles does not mean Functional | Compilation catches syntax, not logic. Test behavior. |
| "The function is defined" | Defined does not mean Called | Grep for call sites. If zero, it is dead code. |

## Integration

Use with: codebase-scan (before), code-review-guide (after)
Related: programmer agent self-check, tester agent coverage verification
