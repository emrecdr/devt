# Testing Anti-Patterns

## 1. Testing Mock Behavior Instead of Real Behavior

**Anti-pattern**: Asserting that a mock was called N times or with specific arguments, rather than testing the actual outcome.

**Why it's wrong**: Proves nothing about production code. Mock call counts are implementation details that change when code is refactored.

**Bad**:
```
def test_create_user(mock_repo):
    service.create_user(data)
    mock_repo.create.assert_called_once_with(data)  # Tests mock, not behavior
```

**Good**:
```
def test_create_user(real_db):
    result = service.create_user(data)
    assert result.email == data.email  # Tests actual outcome
    assert repo.get_by_id(result.id) is not None  # Verifies persistence
```

**Gate**: Before asserting on any mock: "Am I testing real behavior or mock existence?" If mock existence → STOP, rewrite.

## 2. Incomplete Mocks

**Anti-pattern**: Mocking only the fields your test currently uses, hiding structural assumptions.

**Why it's wrong**: When the real object gains a new required field, your mock still passes. Test is green but code is broken.

**Bad**:
```
mock_user = Mock(id=1, name="test")  # Missing email, role, etc.
```

**Good**:
```
mock_user = UserFactory.build(name="test")  # Complete object with all fields
```

**Gate**: Before creating a mock: "Does this mock represent the FULL data structure?" If partial → use a factory.

## 3. Tests That Can't Fail

**Anti-pattern**: Tests that pass regardless of production code behavior — usually from mocking the thing being tested or asserting on constants.

**Why it's wrong**: A test that can't fail provides zero confidence.

**Bad**:
```
def test_validate(mock_validator):
    mock_validator.validate.return_value = True
    assert mock_validator.validate("anything") == True  # Always passes
```

**Good**:
```
def test_validate():
    assert validator.validate("good@email.com") == True
    assert validator.validate("not-an-email") == False
```

**Gate**: After writing a test, ask: "If I delete the production code being tested, does this test fail?" If no → rewrite.

## 4. Integration Tests as Afterthought

**Anti-pattern**: Writing only unit tests with mocks, adding integration tests "later" (which means never).

**Why it's wrong**: Unit tests with mocks verify your understanding of dependencies. Integration tests verify your understanding is CORRECT. Both are needed.

**Rule**: For every service method that crosses a boundary (DB, API, cache), write at least ONE integration test that uses the real dependency.

## 5. Test-Only Methods in Production

**Anti-pattern**: Adding `reset()`, `_clear_cache()`, `_test_setup()` methods to production classes for test convenience.

**Why it's wrong**: Test infrastructure leaking into production. Creates maintenance burden and risk of misuse.

**Fix**: Move cleanup to test fixtures or setup/teardown hooks. Production classes should not know about tests.
