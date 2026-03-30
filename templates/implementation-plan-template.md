# Implementation Plan: [Feature Name]

## Goal

[One sentence: what this builds and why]

## Files

| Action | Path                  | Purpose        |
| ------ | --------------------- | -------------- |
| Create | `path/to/new_file`      | [what it does] |
| Modify | `path/to/existing_file` | [what changes] |

## Tasks

### Task 1: [Component/Behavior Name]

**Files:** `path/to/file`

- [ ] Write failing test

  ```
  Run: [exact test command]
  Expected: FAIL — [specific failure message]
  ```

- [ ] Implement

  ```
  [actual code or description]
  ```

- [ ] Verify passes

  ```
  Run: [exact test command]
  Expected: PASS
  ```

- [ ] Run quality gates

  ```
  Run: [commands from .devt/rules/quality-gates.md]
  Expected: all pass
  ```

- [ ] Commit: `feat: [description]`

### Task 2: [Next Component]

...

## Verification

- [ ] All quality gates pass
- [ ] All tests pass
- [ ] No TODO/FIXME markers in new code
- [ ] New code is wired (imported and used)
