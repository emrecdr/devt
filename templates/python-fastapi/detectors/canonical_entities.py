"""Detector: canonical-entity drift.

Detects six anti-patterns where models/DTOs reference a concept (country,
calling-settings, language, …) without being structurally connected to its
canonical entity model.

Rules
=====
* R1  CANONICAL-MISSING-FK         (high)    — field name matches a registry
      trigger, type is bare str/int, no foreign_key annotation.
* R2  CANONICAL-WRONG-OWNER        (critical)— class declares an FK to a class
      listed in ``forbid_owners`` for this concept (e.g. calling-settings
      attached to ``User`` when owner must be ``Client``).
* R3  CANONICAL-OWNERSHIP-MISSING  (high)    — registry says ``must_belong_to:
      X`` but the class has no FK to X and (when graph available) does not
      import X.
* R4  CANONICAL-ENTITY-MISSING     (low)     — trigger fires but registry says
      ``entity_status: MISSING``. Surfaces the gap as WARN, not blocking.
* R5  CANONICAL-WIRING-ORPHAN      (medium)  — class has an FK to the
      canonical entity in AST but the graph shows no import edge from the
      file to that entity. Typo, dead scaffold, or dynamic loading. Requires
      Graphify.
* R6  CANONICAL-DUPLICATE-ENTITY   (medium)  — Graphify shows another code
      node labeled identically to a canonical entity, in a non-canonical
      file. Echo / shadow anti-pattern. Requires Graphify.

The registry lives at ``.devt/rules/canonical-entities.yaml`` (override via
``--registry``). Schema is documented in the template file.

Detector is **AST-first** — R1/R2/R4 work without the graph. R3/R5/R6 add
cross-module checks when the graph is available.
"""

from __future__ import annotations

import ast
import fnmatch
import re

from . import Finding, ScanContext, register
from ._registry_loader import load_registry  # noqa: F401  (re-exported for back-compat)

# Field-name suffixes that indicate free-text human-readable strings, NOT
# canonical references. ``scope_description: str`` is a label, not an enum
# reference; ``country_label: str`` is display text, not an FK. Detectors
# would emit MISSING-FK / MISSING-ENUM noise otherwise.
_FREE_TEXT_SUFFIXES: tuple[str, ...] = (
    "_description",
    "_label",
    "_note",
    "_comment",
    "_text",
    "_title",
)


def _is_free_text_field(field_name: str) -> bool:
    return field_name.endswith(_FREE_TEXT_SUFFIXES)


def _entity_denylists_path(ent: dict, rel: str) -> bool:
    """True when ``ent.denylist_paths`` glob-matches ``rel`` (i.e. the entity's
    triggers should be suppressed for this file). Empty / missing → False."""
    patterns = ent.get("denylist_paths") or []
    return any(fnmatch.fnmatch(rel, pat) for pat in patterns)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_IDENTIFIER_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _ann_to_str(annotation: ast.AST | None) -> str:
    """Return the textual annotation, best-effort. ``None`` if unknown."""
    if annotation is None:
        return ""
    try:
        return ast.unparse(annotation)
    except AttributeError:
        # Python < 3.9 fallback (devt targets 3.13 but be safe)
        return ""


def _ann_is_bare_string(annotation: ast.AST | None) -> bool:
    """True if the annotation is `str`, `int`, or `str | None` / `int | None`."""
    text = _ann_to_str(annotation)
    if not text:
        return False
    parts = [p.strip() for p in text.split("|")]
    parts = [p for p in parts if p and p != "None"]
    return parts in (["str"], ["int"])


def _field_keywords(value: ast.AST | None) -> dict[str, ast.AST]:
    """Return Field(...) keyword args as a name→AST mapping. ``{}`` if not a
    SQLModel/Pydantic Field call."""
    if not isinstance(value, ast.Call):
        return {}
    func = value.func
    func_name = ""
    if isinstance(func, ast.Name):
        func_name = func.id
    elif isinstance(func, ast.Attribute):
        func_name = func.attr
    if func_name not in {"Field", "mapped_column"}:
        return {}
    return {kw.arg: kw.value for kw in value.keywords if kw.arg}


def _field_has_foreign_key(value: ast.AST | None) -> bool:
    kws = _field_keywords(value)
    if "foreign_key" in kws:
        return True
    # SQLAlchemy column with ForeignKey(...)
    if isinstance(value, ast.Call):
        for arg in value.args:
            if isinstance(arg, ast.Call) and _call_name(arg) == "ForeignKey":
                return True
    return False


def _call_name(node: ast.Call) -> str:
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""


_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def _split_identifier(name: str) -> list[str]:
    """Lowercased word list from an identifier — handles snake_case AND CamelCase.

    Examples::

        billing_country     -> ['billing', 'country']
        BillingCountry      -> ['billing', 'country']
        UserCallingSettings -> ['user', 'calling', 'settings']
        HTTPResponse        -> ['http', 'response']
        role_scope          -> ['role', 'scope']
    """
    # Insert underscores at CamelCase boundaries, then lowercase + split.
    snake = _CAMEL_BOUNDARY.sub("_", name)
    return [w.lower() for w in re.split(r"[^A-Za-z0-9]+", snake) if w]


def _trigger_specificity(trigger: str) -> int:
    """How specific is this trigger? Multi-word triggers (``video_call_settings``)
    beat single-word ones (``settings``). Used to attribute an ambiguous field
    (``role_scope`` matches both ``role`` and ``scope``) to the most specific
    entity, suppressing duplicate findings."""
    return len(_split_identifier(trigger))


def _trigger_matches(field_name: str, triggers: list[str]) -> str | None:
    """Return the matching trigger if ``field_name`` mentions any.

    Word-level subset match against the identifier's word set: trigger
    ``country`` matches field ``country_id`` (subset of {'country', 'id'}) but
    not ``account`` (subset check fails because ``country`` is one word and
    ``account`` decomposes to ``{'account'}``). CamelCase fields (``BillingCountry``)
    are also handled because ``_split_identifier`` normalises them.

    When multiple triggers match, returns the most specific (longest) one so
    callers can rank.
    """
    name_words = set(_split_identifier(field_name))
    best: str | None = None
    best_specificity = 0
    for trig in triggers:
        trig_words = _split_identifier(trig)
        if not trig_words:
            continue
        if set(trig_words).issubset(name_words):
            spec = len(trig_words)
            if spec > best_specificity:
                best = trig
                best_specificity = spec
    return best


def _class_words(cls: ast.ClassDef) -> set[str]:
    """Word set of a class name — used by R2/R3 to decide if a class is 'about'
    a registered concept. CamelCase-aware so ``CallingSettings`` decomposes to
    ``{'calling', 'settings'}`` and matches trigger ``calling_settings``."""
    return set(_split_identifier(cls.name))


def _iter_class_fields(cls: ast.ClassDef):
    """Yield (lineno, field_name, annotation_node, value_node) for each
    ``AnnAssign`` field declaration in the class body."""
    for child in cls.body:
        if isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name):
            yield (
                child.lineno,
                child.target.id,
                child.annotation,
                child.value,
            )


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------


class CanonicalEntitiesDetector:
    name = "canonical-entities"
    categories = (
        "CANONICAL-MISSING-FK",
        "CANONICAL-MISSING-ENUM",
        "CANONICAL-WRONG-OWNER",
        "CANONICAL-OWNERSHIP-MISSING",
        "CANONICAL-ENTITY-MISSING",
        "CANONICAL-WIRING-ORPHAN",
        "CANONICAL-DUPLICATE-ENTITY",
    )
    severities = ("critical", "high", "medium", "low")
    # Declared optional Detector attribute — tells the orchestrator that R3/R5
    # benefit from a loaded GraphIndex. Detectors without this attr default to
    # `False` and the orchestrator skips the (expensive) graph load when no
    # active detector needs it.
    needs_graph = True

    def __init__(self) -> None:
        # Scan-local dedup of R6 emissions. Reset at the start of every run()
        # so repeated in-process invocations are idempotent (the singleton
        # detector instance otherwise leaks state across scans).
        self._duplicate_findings_emitted: set[tuple[str, str]] = set()

    @staticmethod
    def _best_entity_match(fname: str, entities: dict) -> tuple[str, dict] | None:
        """Pick the most-specific (longest-trigger) registry entity matching
        ``fname``. Returns ``(entity_key, entity_dict)`` or ``None``.

        Specificity = number of underscore-separated words in the matched
        trigger, so ``role_scope`` attributes to the ``scope`` entity (whose
        triggers include ``role_scope``) rather than ``role`` (single word).
        """
        best: tuple[str, dict] | None = None
        best_spec = 0
        for entity_key, ent in entities.items():
            triggers = ent.get("triggers") or []
            if not triggers:
                continue
            matched = _trigger_matches(fname, triggers)
            if matched is None:
                continue
            spec = _trigger_specificity(matched)
            if spec > best_spec:
                best = (entity_key, ent)
                best_spec = spec
        return best

    def run(self, ctx: ScanContext) -> list[Finding]:
        # Idempotency: clear scan-local dedup state so repeated invocations
        # on the same file produce the same result (fixes singleton-detector
        # state leak across in-process runs).
        self._duplicate_findings_emitted.clear()

        registry = ctx.registry
        if not registry:
            return []
        entities = registry.get("entities", {})
        if not entities:
            return []

        rel = str(ctx.rel_path)
        findings: list[Finding] = []

        # Only scan declared SQLModel/Pydantic class hierarchies. We use a
        # cheap heuristic: file lives under domain/, application/, infrastructure/,
        # or is a *.py file that declares classes. Tests and migrations are
        # ignored by file path.
        if "/tests/" in rel or rel.startswith("tests/"):
            return []
        if rel.startswith("alembic/") or "/migrations/" in rel:
            return []

        for node in ast.walk(ctx.tree):
            if not isinstance(node, ast.ClassDef):
                continue
            findings.extend(self._check_class(ctx, node, entities, rel))

        # R6 duplicates: report once per file even if multiple entities echo.
        findings.extend(self._check_duplicates(ctx, entities, rel))

        return findings

    # ------------------------------------------------------------------
    # Per-class field-level checks (R1, R2, R3, R4, R5)
    # ------------------------------------------------------------------

    def _check_class(
        self,
        ctx: ScanContext,
        cls: ast.ClassDef,
        entities: dict,
        rel: str,
    ) -> list[Finding]:
        findings: list[Finding] = []

        # Pre-collect this class's FK targets (column-name based heuristic)
        fk_columns: set[str] = set()
        for _line, fname, _ann, value in _iter_class_fields(cls):
            if _field_has_foreign_key(value):
                fk_columns.add(fname)

        # ---- per-field checks (R1, R4, R7-ENUM): attribute each field to its
        # MOST SPECIFIC matching entity to avoid duplicate findings on names
        # like `role_scope` that match both `role` and `scope` triggers.
        for line, fname, annotation, value in _iter_class_fields(cls):
            # Free-text suffix fields (``scope_description``, ``country_label``)
            # are human-readable strings, never canonical references — skip.
            if _is_free_text_field(fname):
                continue
            best = self._best_entity_match(fname, entities)
            if best is None:
                continue
            entity_key, ent = best
            # Per-entity path denylist: protocol-scope (OAuth) lives at a
            # different layer than RBAC RoleScope; the registry can scope a
            # trigger by file-path glob to prevent cross-domain misattribution.
            if _entity_denylists_path(ent, rel):
                continue

            entity_status = (ent.get("entity_status") or "EXISTS").upper()
            forbid_string_only = bool(ent.get("forbid_string_only", False))
            allowed_fk = set(ent.get("allowed_fk_columns") or [])

            # R4: trigger fires + entity is missing in domain → WARN
            if entity_status == "MISSING":
                if forbid_string_only and _ann_is_bare_string(annotation):
                    findings.append(
                        Finding(
                            category="CANONICAL-ENTITY-MISSING",
                            severity="low",
                            file=rel,
                            line=line,
                            message=(
                                f"`{cls.name}.{fname}` references concept "
                                f"`{entity_key}` but no canonical entity "
                                "exists yet"
                            ),
                            detail=(
                                f"Either create a {entity_key.capitalize()} "
                                "entity (preferred) or remove this field from "
                                "the registry's MISSING list."
                            ),
                            fingerprint=f"{entity_key}:{fname}:missing-entity",
                        )
                    )
                continue

            # R7 (ENUM): bare str/int field naming an enum-backed concept →
            # advise the correct enum type, not an FK column.
            if entity_status == "ENUM":
                if forbid_string_only and _ann_is_bare_string(annotation) and not _field_has_foreign_key(value):
                    allowed_types = list(ent.get("allowed_types") or [])
                    import_path = ent.get("import_path", "")
                    suggested = ", ".join(allowed_types) or import_path or entity_key
                    findings.append(
                        Finding(
                            category="CANONICAL-MISSING-ENUM",
                            severity="high",
                            file=rel,
                            line=line,
                            message=(
                                f"`{cls.name}.{fname}` is a bare "
                                f"`{_ann_to_str(annotation)}` referencing "
                                f"enum-backed concept `{entity_key}`"
                            ),
                            detail=(
                                f"Use the enum type instead: `{suggested}`. Import path: {import_path or '<unset>'}."
                            ),
                            fingerprint=f"{entity_key}:{fname}:missing-enum",
                        )
                    )
                continue

            # R1: bare str/int trigger field, no FK → MISSING-FK
            if (
                forbid_string_only
                and _ann_is_bare_string(annotation)
                and not _field_has_foreign_key(value)
                and fname not in allowed_fk
            ):
                findings.append(
                    Finding(
                        category="CANONICAL-MISSING-FK",
                        severity="high",
                        file=rel,
                        line=line,
                        message=(
                            f"`{cls.name}.{fname}` is a bare "
                            f"`{_ann_to_str(annotation)}` referencing concept "
                            f"`{entity_key}` without an FK"
                        ),
                        detail=(
                            f"Expected one of: {sorted(allowed_fk) or ['<entity>_id']}. "
                            f"Canonical entity: "
                            f"{ent.get('import_path', entity_key.capitalize())}."
                        ),
                        fingerprint=f"{entity_key}:{fname}:missing-fk",
                    )
                )

        # ---- class-level checks (R2 wrong-owner, R3 ownership-missing) ----
        findings.extend(self._check_ownership(ctx, cls, fk_columns, entities, rel))

        # ---- R5 wiring orphan (graph-only) ----
        if ctx.graph is not None:
            findings.extend(self._check_wiring_orphans(ctx, cls, fk_columns, entities, rel))

        return findings

    def _check_ownership(
        self,
        ctx: ScanContext,
        cls: ast.ClassDef,
        fk_columns: set[str],
        entities: dict,
        rel: str,
    ) -> list[Finding]:
        findings: list[Finding] = []
        cls_words = _class_words(cls)

        for entity_key, ent in entities.items():
            triggers = ent.get("triggers") or []
            forbid_owners = list(ent.get("forbid_owners") or [])
            must_belong_to = ent.get("must_belong_to")

            # Class is "about this concept" if its name's word set is a
            # superset of ANY trigger's word set. CamelCase-aware so
            # `CallingSettings` -> {'calling','settings'} matches trigger
            # `calling_settings` -> {'calling','settings'} -> subset → True.
            relevant = any(set(_split_identifier(t)).issubset(cls_words) for t in triggers if t)
            if not relevant:
                continue

            # R2: wrong owner — class has an FK column that is the canonical FK
            # of a forbidden owner (e.g. `user_id` when forbid_owners includes User).
            for owner in forbid_owners:
                forbidden_fk = f"{owner.lower()}_id"
                if forbidden_fk in fk_columns:
                    line = next(
                        (ln for ln, fn, _ann, _val in _iter_class_fields(cls) if fn == forbidden_fk),
                        cls.lineno,
                    )
                    findings.append(
                        Finding(
                            category="CANONICAL-WRONG-OWNER",
                            severity="critical",
                            file=rel,
                            line=line,
                            message=(
                                f"`{cls.name}` is owned by `{owner}` via "
                                f"`{forbidden_fk}` but concept `{entity_key}` "
                                f"must belong to `{must_belong_to or '<other>'}`"
                            ),
                            detail=(
                                f"Move ownership: replace `{forbidden_fk}` with "
                                f"`{(must_belong_to or 'owner').lower()}_id`."
                            ),
                            fingerprint=f"{entity_key}:{cls.name}:wrong-owner-{owner}",
                        )
                    )

            # R3: ownership missing — must_belong_to set, no FK to it AND
            # graph shows no import.
            if must_belong_to:
                expected_fk = f"{must_belong_to.lower()}_id"
                if expected_fk not in fk_columns:
                    graph_confirms_missing = True
                    if ctx.graph is not None:
                        graph_confirms_missing = not ctx.graph.file_imports_entity(rel, must_belong_to)
                    if graph_confirms_missing:
                        findings.append(
                            Finding(
                                category="CANONICAL-OWNERSHIP-MISSING",
                                severity="high",
                                file=rel,
                                line=cls.lineno,
                                message=(
                                    f"`{cls.name}` (concept `{entity_key}`) has no "
                                    f"`{expected_fk}` linking it to canonical owner "
                                    f"`{must_belong_to}`"
                                ),
                                detail=(
                                    f"Add `{expected_fk}: UUID = Field(..., "
                                    f'foreign_key="...")` and remove any FK to a '
                                    f"forbidden owner."
                                ),
                                fingerprint=(f"{entity_key}:{cls.name}:ownership-missing"),
                            )
                        )

        return findings

    def _check_wiring_orphans(
        self,
        ctx: ScanContext,
        cls: ast.ClassDef,
        fk_columns: set[str],
        entities: dict,
        rel: str,
    ) -> list[Finding]:
        """R5: class uses a canonical FK column name but the field has neither
        a SQLModel ``foreign_key=`` declaration NOR a runtime import of the
        canonical entity class. That's a dead reference — typo, removed FK,
        or a column named like an FK but never wired up.

        SQLModel's idiomatic FK is ``Field(foreign_key="table.col")`` — the
        string is resolved by SQLAlchemy via the metadata registry, NO class
        import is needed (and adding one usually creates a circular dep).
        This check therefore treats ``foreign_key=`` declarations as wired
        regardless of whether the class is imported.

        Skipped for domain/ layer files: domain models legitimately use SQL
        table-name strings and avoid cross-domain class imports by
        Clean-Architecture design.
        """
        findings: list[Finding] = []
        if ctx.graph is None or ctx.layer == "domain":
            return findings

        # Map field name → whether it carries a foreign_key declaration. Used
        # to skip "wired-by-string" fields when checking the orphan condition.
        fk_wired: dict[str, bool] = {
            fname: _field_has_foreign_key(value) for _ln, fname, _ann, value in _iter_class_fields(cls)
        }

        for entity_key, ent in entities.items():
            entity_status = (ent.get("entity_status") or "EXISTS").upper()
            if entity_status != "EXISTS":
                continue
            import_path = ent.get("import_path", "")
            if not import_path:
                continue
            entity_label = import_path.rsplit(".", 1)[-1]
            allowed_fk = set(ent.get("allowed_fk_columns") or [])
            overlap = fk_columns & allowed_fk
            if not overlap:
                continue
            # Filter to columns that are NOT wired via ``foreign_key=``. A
            # string-form FK is idiomatic SQLModel and resolves without an
            # explicit class import — those columns are wired by definition.
            unwired = {col for col in overlap if not fk_wired.get(col, False)}
            if not unwired:
                continue
            if ctx.graph.file_imports_entity(rel, entity_label):
                continue
            line = next(
                (ln for ln, fn, _ann, _val in _iter_class_fields(cls) if fn in unwired),
                cls.lineno,
            )
            findings.append(
                Finding(
                    category="CANONICAL-WIRING-ORPHAN",
                    severity="medium",
                    file=rel,
                    line=line,
                    message=(
                        f"`{cls.name}` uses canonical FK column(s) {sorted(unwired)} "
                        f"for entity `{entity_label}` but has neither a "
                        f"`foreign_key=` declaration nor a Python import of it"
                    ),
                    detail=(
                        "Field is named like a canonical FK column but is "
                        'neither wired via SQLModel `foreign_key="table.col"` '
                        "nor backed by an import of the canonical class — "
                        "dynamic load, typo, or dead scaffold."
                    ),
                    fingerprint=(f"{entity_key}:{cls.name}:wiring-orphan:{','.join(sorted(unwired))}"),
                )
            )
        return findings

    # ------------------------------------------------------------------
    # R6: duplicate-entity (graph-only, per-file)
    # ------------------------------------------------------------------

    def _check_duplicates(
        self,
        ctx: ScanContext,
        entities: dict,
        rel: str,
    ) -> list[Finding]:
        """R6: file defines a class labeled identically to a canonical entity
        but outside its canonical home.

        Implementation is pure AST — Graphify is not required. (An earlier
        version short-circuited when the graph was missing; that gate was
        dead code that silently disabled R6 on every consumer without
        ``graphify-out/graph.json``.)
        """
        # Collect actual class definitions in this file
        own_class_defs: dict[str, int] = {
            node.name: node.lineno for node in ast.walk(ctx.tree) if isinstance(node, ast.ClassDef)
        }
        if not own_class_defs:
            return []

        findings: list[Finding] = []
        for entity_key, ent in entities.items():
            entity_status = (ent.get("entity_status") or "EXISTS").upper()
            if entity_status != "EXISTS":
                continue
            canonical_file = ent.get("canonical_file", "")
            import_path = ent.get("import_path", "")
            if not (canonical_file and import_path):
                continue
            if rel == canonical_file:
                continue  # the canonical file itself
            entity_label = import_path.rsplit(".", 1)[-1]
            if entity_label not in own_class_defs:
                continue
            key = (entity_key, rel)
            if key in self._duplicate_findings_emitted:
                continue
            self._duplicate_findings_emitted.add(key)
            findings.append(
                Finding(
                    category="CANONICAL-DUPLICATE-ENTITY",
                    severity="medium",
                    file=rel,
                    line=own_class_defs[entity_label],
                    message=(
                        f"file defines a class labeled `{entity_label}` outside its canonical home ({canonical_file})"
                    ),
                    detail=(
                        "Echo / shadow of the canonical entity. Either "
                        f"import {import_path} (preferred) or rename to "
                        "avoid the collision."
                    ),
                    fingerprint=f"{entity_key}:{rel}:duplicate",
                )
            )
        return findings


register(CanonicalEntitiesDetector())
