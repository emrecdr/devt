# Pydantic Patterns — v2 Conventions for API Services

Pydantic v2 idioms for request/response models, settings, and validation. The
v1 surface (`@validator`, `class Config`, `.dict()`) still *runs* under v2 —
deprecated, not removed — which is exactly why it keeps leaking into new code.
Everything here is the v2-native form.

## Model Configuration

Use `model_config = ConfigDict(...)` — the inner `class Config` is deprecated:

```python
from pydantic import BaseModel, ConfigDict

class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
```

Flags that matter for API services:

| Flag | Use | Why |
|------|-----|-----|
| `extra="forbid"` | Request models | Unknown keys become 422s instead of being silently dropped — catches client typos and stale clients |
| `from_attributes=True` | Read/response models | Enables `Model.model_validate(orm_obj)` |
| `frozen=True` | Value objects | Immutability + hashability |
| `validate_assignment=True` | Long-lived mutable models only | Re-validates on attribute set; skip for throwaway DTOs |
| `str_strip_whitespace=True` | Request models | Kills invisible-whitespace bugs at the boundary |

Config does NOT propagate into nested models — every model is its own
configuration boundary. Put shared flags on a project base model (below), not
on the outermost model.

### Aliases — use the v2.11+ trio, not `populate_by_name`

`populate_by_name` is superseded (official guidance: not recommended in
v2.11+, slated for deprecation). Use the explicit trio:

```python
from pydantic.alias_generators import to_camel

class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,     # accept snake_case input too
        validate_by_alias=True,    # accept camelCase input (default True)
        serialize_by_alias=True,   # emit camelCase WITHOUT per-call by_alias=True
    )
```

Without `serialize_by_alias=True`, dumps use field names — the classic "my API
returned snake_case" bug. `alias` applies to both directions;
`validation_alias` / `serialization_alias` are one-directional.

### Project base model

Define ONE shared base for API-facing models and inherit from it. Whatever the
project standardizes (alias policy, timezone serialization, `extra` posture)
lives there once:

```python
class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

class ReadModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
```

## Field Constraints — Annotated, never `con*`

`conint` / `constr` / `confloat` return types, break static analysis, and are
deprecated for removal in Pydantic 3.0:

```python
from typing import Annotated
from pydantic import Field, StringConstraints

Percentage = Annotated[int, Field(ge=0, le=100)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]

class CreatePhotoRequest(ApiModel):
    title: Title
    quality: Percentage = 80
```

- Constraints go in `Annotated`; `default`, `default_factory`, and `alias` go
  in the assignment form (`field: T = Field(default=..., alias=...)`) — type
  checkers only synthesize a correct `__init__` from the assignment form.
- Mutable defaults are SAFE in Pydantic (it deep-copies non-hashable defaults)
  — don't import the dataclasses ban. Still prefer `default_factory` for
  expensive or fresh-per-instance values.
- `default_factory` can receive already-validated data:
  `Field(default_factory=lambda data: data["email"])`.

## Optional ≠ Default

The #1 v2 confusion: `X | None` makes a field NULLABLE, not optional. A field
without a default is required, `None`-allowing or not:

```python
class UpdateRequest(ApiModel):
    title: str | None            # REQUIRED, may be null
    album_id: UUID | None = None # optional, defaults to null
```

## Validators

```python
from pydantic import field_validator, model_validator
from typing import Self

class BookingRequest(ApiModel):
    start: AwareDatetime
    end: AwareDatetime

    @field_validator("start", mode="after")   # "after" is the default and preferred mode
    @classmethod
    def not_in_past(cls, v: datetime) -> datetime:
        if v < now_utc():
            raise ValueError("start must be in the future")
        return v

    @model_validator(mode="after")             # instance method, returns self
    def end_after_start(self) -> Self:
        if self.end <= self.start:
            raise ValueError("end must be after start")
        return self
```

Rules:

- Raise **`ValueError`** (or `PydanticCustomError`) — never `ValidationError`
  directly, never custom exception classes: a custom exception escapes
  Pydantic and surfaces as a 500 instead of a 422.
- Validator messages appear **verbatim in 422 response bodies** — write them
  client-safe (no internals, no repr of secrets).
- Never use `assert` in validators — it disappears under `python -O`.
- `mode="before"` only for input massaging of raw/untyped data; `"after"`
  validators are type-safe.
- v1 forms are banned: `@validator` → `@field_validator`, `@root_validator` →
  `@model_validator`, `.dict()` → `model_dump()`, `.json()` →
  `model_dump_json()`, `.parse_obj()` → `model_validate()`, `.parse_raw()` →
  `model_validate_json()`.

## Serialization

- `json_encoders` is deprecated — use `@field_serializer` /
  `@model_serializer` (or `Annotated[..., PlainSerializer(...)]`):

```python
class Receipt(ApiModel):
    amount: Decimal

    @field_serializer("amount")
    def serialize_amount(self, v: Decimal) -> str:
        return f"{v:.2f}"
```

- `@computed_field` over an explicit `@property` puts derived values into
  dumps AND the OpenAPI schema — use for values like `full_name` that must
  appear in output without being stored. Return-type annotation required.
- Subclass responses: when an endpoint returns a subclass of the declared
  model and the extra fields must serialize, set
  `model_config = ConfigDict(polymorphic_serialization=True)` on the base —
  the targeted replacement for the `SerializeAsAny` blast radius.
- `model_dump(mode="json")` when you need a JSON-safe dict (UUIDs/datetimes
  already converted).

### `exclude_unset` vs `exclude_none` vs `exclude_defaults`

Three different things; PATCH correctness depends on picking the right one:

| Parameter | Excludes | Use |
|-----------|----------|-----|
| `exclude_unset` | fields the client did not send | **PATCH** — the only correct discriminator |
| `exclude_none` | fields whose value is `None` | response slimming |
| `exclude_defaults` | fields equal to their default | rarely what you want |

The partial-update pattern (all-optional update model):

```python
@router.patch("/photos/{photo_id}")
async def update_photo(photo_id: UUID, patch: UpdatePhotoRequest, service: PhotoServiceDep) -> PhotoResponse:
    changes = patch.model_dump(exclude_unset=True)   # NOT exclude_none —
    return await service.update(photo_id, changes)   # that would drop explicit nulls
```

Using `exclude_none` in PATCH flows silently destroys legitimate
set-this-field-to-null updates.

## Discriminated Unions

For polymorphic payloads, tagged unions are both faster and more predictable
than untagged ones (untagged "smart mode" can pick surprising branches):

```python
class CardPayment(ApiModel):
    method: Literal["card"]
    card_token: str

class BankPayment(ApiModel):
    method: Literal["bank"]
    iban: str

Payment = Annotated[CardPayment | BankPayment, Field(discriminator="method")]
```

## Datetimes

- Annotate API datetime fields as `AwareDatetime` (from `pydantic`) — plain
  `datetime` silently accepts naive values, and naive-vs-aware comparisons
  blow up later, far from the boundary.
- Standardize timezone handling once on the project base model (serializer to
  UTC ISO-8601), not per-model.

## Settings (pydantic-settings)

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="APP_",
        env_nested_delimiter="__",     # APP_DB__POOL_SIZE=10 → settings.db.pool_size
        secrets_dir="/run/secrets",    # Docker/K8s secrets: filename = key
    )
    database_url: PostgresDsn
    debug: bool = False
```

- **`BaseSettings` defaults to `extra="forbid"`** (unlike `BaseModel`'s
  `ignore`) — a shared `.env` with unrelated keys raises `ValidationError` at
  startup. Either keep per-service env files or set `extra="ignore"`
  deliberately.
- Priority order: init args > env vars > `.env` > secrets dir > defaults.
- Split settings per domain module instead of one god-Settings class.
- Wire into FastAPI as a dependency so tests can override it, AND instantiate
  once at import/startup so a missing env var fails the boot, not the first
  request:

```python
@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()   # eager: invalid config kills startup
SettingsDep = Annotated[Settings, Depends(get_settings)]
```

## Performance Doctrine — Validate at Boundaries

Pydantic belongs at every I/O boundary (HTTP, queue, config, external APIs) —
and, deliberately, nowhere else. Internal hot paths use plain
dataclasses/dicts/TypedDicts; re-validating trusted data mid-pipeline is pure
overhead ("serdes debt").

- `Model.model_validate_json(raw_bytes)` — never
  `model_validate(json.loads(raw))`; the latter parses in Python first.
- Build `TypeAdapter` instances ONCE at module level and reuse them —
  construction carries real cost. Use `TypeAdapter(list[Item])` for top-level
  non-model shapes instead of a wrapper model.
- ORM objects: validate into a read model ONCE at the boundary
  (`from_attributes`), never per loop iteration. Instances are assumed valid
  on re-validation (`revalidate_instances="never"` default) — leave it.
- Response models get a second validation pass in FastAPI — keep them flat
  and cheap; don't nest deep model trees in list endpoints.
- `TypedDict` via `TypeAdapter` is ~2.5× faster than nested models in hot
  paths.
- `FailFast()` annotation on large sequence fields aborts on first bad item —
  use for bulk-ingest endpoints.
- Do NOT use `model_construct()` as a performance trick — the gap has
  narrowed, and it silently builds invalid instances.

## Strict Mode

Lax (default) coerces — `"123"` validates as `int`. Enable strictness
per-field where silent coercion is a bug risk (identifiers, booleans, money):

```python
class TransferRequest(ApiModel):
    amount_cents: Annotated[int, Field(strict=True)]
```

Note: strict mode is deliberately looser when validating FROM JSON (JSON has
no date/UUID types — ISO strings still parse), so field-level strictness on
request models is less draconian than it sounds. Blanket
`ConfigDict(strict=True)` on request models is usually overkill.

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| v1 idioms (`@validator`, `class Config`, `.dict()`) | Deprecation debt; removal in v3 | v2 forms; lint-ban the v1 surface |
| Custom exception raised in a validator | 500 instead of 422 | Raise `ValueError` / `PydanticCustomError` |
| Internals in validator messages | Leaks into 422 bodies verbatim | Client-safe messages |
| `populate_by_name=True` in new code | Superseded; deprecation planned | `validate_by_name` + `validate_by_alias` |
| `exclude_none` in PATCH | Explicit nulls silently dropped | `exclude_unset` |
| `X | None` assumed optional | 422 "field required" surprises | Add `= None` when optional |
| Plain `datetime` on API fields | Naive/aware mixing downstream | `AwareDatetime` |
| Re-validating ORM rows per iteration | Serdes overhead in loops | Validate once at the boundary |
| `TypeAdapter` built per call | Validator reconstruction cost | Module-level singleton |
| Shared `.env` + default `BaseSettings` | Startup `ValidationError` on foreign keys | Per-service env file or `extra="ignore"` |
| Config flags on outer model only | Nested models unaffected (config boundary) | Shared base model |

> **ADR override note**: if a project ADR in `.devt/memory/decisions/`
> contradicts these patterns, the ADR wins. ADRs are constitutional.
