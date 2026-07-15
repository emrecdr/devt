# Coding Standards — Python / FastAPI

## Language & Runtime

- Python 3.13+
- FastAPI with Pydantic v2 for validation — full Pydantic conventions in `pydantic-patterns.md`
- SQLModel for ORM / database models (rides on SQLAlchemy 2.0; SQLModel pins SQLAlchemy < 2.1)
- `uv` as package manager (never `pip`)

### Compatibility floor (assumptions the rules below rely on)

| Component | Floor | Consequence |
|-----------|-------|-------------|
| FastAPI | ≥ 0.128 | Pydantic v2 ONLY — any `pydantic.v1` import hard-fails |
| FastAPI | ≥ 0.132 | JSON request bodies REQUIRE a JSON `Content-Type` header (`strict_content_type` default) |
| Pydantic | ≥ 2.11 | `validate_by_name`/`validate_by_alias`/`serialize_by_alias` replace `populate_by_name` |
| pytest-asyncio | ≥ 1.0 | The `event_loop` fixture no longer exists — overriding it is dead code |
| httpx | 0.28.x | `AsyncClient(app=...)` is removed — use `ASGITransport(app=...)` |

## Type Safety

- Mandatory type hints on all function signatures, return types, and class attributes
- Use `T | None` union syntax (not `Optional[T]`)
- Use `list[int]`, `dict[str, Any]` (not `List[int]`, `Dict[str, Any]` from typing)
- No `Any` unless absolutely unavoidable — prefer `object` with narrowing, or generics
- Pydantic models for all request/response schemas (automatic validation) — see `pydantic-patterns.md`
- Run `mypy` (or `pyright`) on every change — type errors are blocking

## Naming Conventions

| Element       | Convention       | Example            |
| ------------- | ---------------- | ------------------ |
| Functions     | snake_case       | `get_user_by_id()` |
| Classes       | CamelCase        | `UserService`      |
| Constants     | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`  |
| Modules/files | snake_case       | `user_service.py`  |
| Env vars      | UPPER_SNAKE_CASE | `DATABASE_URL`     |

## Async Rules

One blocking call inside an `async def` route stalls EVERY in-flight request —
the event loop is shared. Sync (`def`) routes run in a threadpool that holds
only ~40 threads total, so they don't block the loop but do exhaust under
load. Decision tree per route/dependency:

| Situation | Form |
|-----------|------|
| Only non-blocking I/O (async DB driver, `httpx.AsyncClient`, async queue client) | `async def` |
| Only a blocking library (sync SDK, no async client exists) | plain `def` — FastAPI runs it in the threadpool |
| Mostly async but one blocking call is unavoidable | `async def` + wrap the call in `run_in_threadpool(...)` / `asyncio.to_thread(...)` |
| CPU-bound work (image processing, crypto, ML inference) | Neither — hand it to an external worker (task queue) |

- **Async-first database access is the default posture**: async driver
  (`asyncpg`) + `AsyncSession`. A fully-sync service (plain `def` routes +
  sync sessions throughout) is acceptable for small internal tools — but pick
  ONE posture per service and never mix sync sessions into async routes.
- Never call a sync DB session, `requests`, `time.sleep`, or any blocking SDK
  directly inside `async def` — `httpx.AsyncClient`, `asyncio.sleep`, async
  drivers, or `run_in_threadpool` are the substitutes.
- Prefer async dependencies over sync ones — every sync dependency burns a
  threadpool token even when trivial.

### Async SQLAlchemy/SQLModel rules (the trap kit)

- Engine is created ONCE in the lifespan handler — never per request. Every
  engine owns its own connection pool; accidental extra engines multiply pool
  size past the database's `max_connections`.
- Session-per-request via a yield dependency; the session closes in `finally`.
- `async_sessionmaker(engine, expire_on_commit=False)` — otherwise every
  post-commit attribute access triggers implicit IO and fails in async.
- **Never rely on lazy loading in async code** — it either raises
  `MissingGreenlet` or silently issues N+1 queries. Declare relationships
  `lazy="raise"` by default and load explicitly per query:
  `selectinload()` for collections, `joinedload()` for to-one.
- Loading strategy is part of the query, not the model: fetching a list
  endpoint without `selectinload` on a rendered relationship is an N+1 even
  when it happens to work.

## Import Rules

- All imports at module top level — no inline imports
- Inline imports are a design smell indicating circular dependencies
- If circular dependency exists, refactor to eliminate it (move logic to correct layer)
- Exception: test files may use inline imports for test-specific mocks only

## Code Structure

- Maximum 3 levels of nesting — extract helper functions beyond that
- Early returns: validate inputs at function start, return/raise immediately on failure
- Small functions: single responsibility, under 40 lines preferred

### Guard Clause Example

**Bad** — deeply nested:
```python
def process_order(order):
    if order:
        if order.is_valid():
            if order.has_items():
                # actual logic buried 3 levels deep
                return calculate_total(order)
    return None
```

**Good** — guard clauses:
```python
def process_order(order):
    if not order:
        return None
    if not order.is_valid():
        raise InvalidOrderError(order.id)
    if not order.has_items():
        raise EmptyOrderError(order.id)
    return calculate_total(order)
```
- Named constants: no magic numbers or strings
- Extract complex boolean conditions into named variables

## Error Handling

- All custom exceptions inherit from a base `AppError` class
- Never inherit from plain `Exception` — breaks centralized HTTP status mapping
- Use specific error subclasses: `NotFoundError`, `ConflictError`, `BadRequestError`
- Never catch generic `Exception` above `AppError` — it swallows domain errors

## Dependency Injection

Use `Annotated` types for FastAPI dependencies (PEP 593) — reusable, composable, type-checker friendly:

```python
from typing import Annotated
from fastapi import Depends

# Define reusable dependency types
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

# Use in route handlers — clean and explicit
@router.get("/photos")
async def list_photos(db: DbSession, user: CurrentUser): ...
```

Never use the older `param: Type = Depends(func)` style — it mixes default values with DI.

## Application Lifecycle

Use the lifespan context manager for startup/shutdown — `@app.on_event()` is deprecated:

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize pools, connections, caches
    app.state.db_pool = await create_pool()
    yield
    # Shutdown: clean up resources
    await app.state.db_pool.close()

app = FastAPI(lifespan=lifespan)
```

## Architecture Boundaries

- **Thin routers / fat services**: Business logic lives in the service layer, not routes
- **Repository pattern**: Services never access database sessions directly
- Services never import `Session`, `select`, or raw SQLModel queries
- Services never access `repository._session` — that is repository internals
- Clear layer boundaries: domain -> application -> infrastructure -> api

## Entity Standards

- All entities extend base classes (UUID base for API-exposed, Int base for internal)
- UUIDv7 for all entity IDs — never `uuid4()`
- No duplicate field declarations — base classes provide id, timestamps, soft-delete
- Every entity has a corresponding `Filters` Pydantic model for repository queries

## Configuration

- All behavior controlled by explicit environment variables
- Never change behavior based on `ENVIRONMENT` variable (local/test/prod)
- `ENVIRONMENT` identifies WHERE code runs, not HOW it behaves
- Use `ENABLE_X` or profile-based flags for feature toggles

## DRY Principle

- Always search before creating protocols, interfaces, or classes
- Reuse existing interfaces from the module that owns the domain
- Cross-service dependencies: import from the owning service
- One obvious way to do things — no convenience aliases or alternative formats

---

## Entity & Repository Standards

See golden-rules.md Rule 6 for the full selection matrix and decision guide.

### Entity Base Class Usage

```python
# CORRECT: Extend base class, only declare domain-specific fields
from app.core.domain.base_entity import BaseUUIDEntityWithSD

class Photo(BaseUUIDEntityWithSD, table=True):
    __tablename__ = "photos"
    # id, created_at, updated_at, deleted_at, deleted_by come from base
    title: str
    user_id: UUID = Field(foreign_key="users.id")

# WRONG: Redeclaring base fields
class Photo(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)  # Duplicate!
    created_at: datetime  # Duplicate!
```

### UUID Generation — Always UUIDv7

Always use UUIDv7 for generating new UUIDs — never `uuid4()`:

```python
from app.core.uuid_utils import generate_uuid  # Project wrapper
# OR directly:
from uuid_utils import uuid7
```

UUIDv7 benefits: time-ordered (better B-tree locality), sortable, RFC 9562 compliant.

### Repository Contracts (MANDATORY)

All repositories MUST extend `RepositoryContract[T, K, F]` from `app/core/domain/repository_contracts.py`:

```python
from app.core.domain.repository_contracts import RepositoryContract

# T = Entity type, K = ID type, F = Filters Pydantic model
class PhotoRepositoryInterface(RepositoryContract[Photo, UUID, PhotoFilters], ABC):
    # Standard methods inherited: get_by_id, get_by_ids, exists, count,
    # list_all, add, add_many, update, delete, restore, delete_hard

    @abstractmethod
    def get_by_album(self, album_id: UUID) -> list[Photo]:
        pass
```

### Entity Filters Model (MANDATORY)

Create `<Entity>Filters` Pydantic model for repository filtering:

```python
from pydantic import BaseModel

class PhotoFilters(BaseModel):
    user_id: UUID | None = None
    album_id: UUID | None = None
    is_public: bool | None = None
```

### File Locations

| Type | Location |
|------|----------|
| Interfaces | `app/services/<service>/repository_interfaces.py` (module root) |
| Implementations | `app/services/<service>/infrastructure/repositories.py` |
| Errors | `app/services/<service>/errors.py` |
| Filters | Co-located with interface or in `application/dto.py` |

---

## Cross-Service Interface Ownership

### Repository Interfaces at Module Root

Repository interfaces live at the module root in `repository_interfaces.py`. Other services import from the OWNING service — never create duplicate protocols.

### Ownership Table

Maintain a table like this for YOUR project's domains (generic example shape):

| Domain | Owner Service | Interface Location |
|--------|---------------|-------------------|
| Users, Roles, RBAC | Identity | `identity/repository_interfaces.py` |
| Orders, Line Items | Orders | `orders/repository_interfaces.py` |
| Products, Inventory | Catalog | `catalog/repository_interfaces.py` |
| Invoices, Payments | Billing | `billing/repository_interfaces.py` |
| Notifications | Notifications | `notifications/repository_interfaces.py` |
| Audit Logs | Audit | `audit/repository_interfaces.py` |

### Cross-Service Access Pattern

Inject the owning module's repository interface via DI:

```python
# CORRECT: Import from owning service
from app.services.identity.repository_interfaces import RoleRepositoryInterface
from app.services.orders.repository_interfaces import OrderRepositoryInterface

class MyService:
    def __init__(
        self,
        role_repo: RoleRepositoryInterface,
        order_repo: OrderRepositoryInterface,
    ):
        self.role_repo = role_repo
        self.order_repo = order_repo

# WRONG: Creating duplicate protocol
class RoleRepositoryProtocol(Protocol):  # Already exists in Identity!
    def get_by_code(self, code: str) -> Role | None: ...

# WRONG: Adding another domain's query to your own repo
class NotificationRepository:
    def get_by_user_id(self, user_id: UUID): ...  # Users belong to Identity!

# WRONG: Duplicating logic that exists in the owning repo
class NotificationRepository:
    def cancel_orders_by_user(self, user_id: UUID): ...  # Use OrderRepository!
```

---

## Service Isolation

See golden-rules.md Rule 8 for the full enforcement protocol.

**Quick reference**: Services NEVER import Session, select, or access repository._session. All data access goes through repository interfaces.

---

## DTO Conventions

### Naming Pattern

Use `<Action>Request` for input DTOs and `<Action>Response` for output DTOs:

```python
# CORRECT: Clear action-based naming
class CreatePhotoRequest(BaseModel):
    title: str
    album_id: UUID | None = None

class CreatePhotoResponse(BaseModel):
    id: UUID
    title: str
    created_at: datetime

class UpdatePhotoRequest(BaseModel):
    title: str | None = None

class ListPhotosResponse(BaseModel):
    items: list[PhotoSummary]
    total: int
    page: int

# WRONG: Vague or inconsistent naming
class PhotoDTO(BaseModel): ...     # Which operation?
class PhotoInput(BaseModel): ...   # Not standard
class PhotoData(BaseModel): ...    # Too generic
```

### DTOs Cross Boundaries

Only DTOs cross the API boundary — never models. Declare the response type as
the **return-type annotation** (the primary style; it also enables FastAPI's
fast Rust-path serialization). Reserve `response_model=` for the rare case
where the returned value's type differs from the declared schema — then
annotate `-> Any`:

```python
UserServiceDep = Annotated[UserService, Depends(get_user_service)]

# CORRECT: DTO crosses boundary, return type declares the schema
@router.get("/users/{user_id}")
async def get_user(user_id: UUID, service: UserServiceDep) -> UserResponse:
    user = await service.get_user(user_id)
    return UserResponse.model_validate(user)

# WRONG: Model crosses boundary + legacy default-value Depends style
@router.get("/users/{user_id}", response_model=User)  # Model!
def get_user(user_id: UUID, db: Session = Depends(get_db)):
    return db.query(User).filter(User.id == user_id).first()
```

FastAPI validates the return value against the declared response type — a
second validation pass. Keep response models flat and cheap, especially on
list endpoints. Partial updates (PATCH) use an all-optional request model +
`model_dump(exclude_unset=True)` — the full pattern is in
`pydantic-patterns.md`.

> **ADR override note**: if a project ADR in `.devt/memory/decisions/` contradicts these standards, the ADR wins. ADRs are constitutional. Run `node bin/devt-tools.cjs memory list decision` to see what's binding.
