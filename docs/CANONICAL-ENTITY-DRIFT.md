# Canonical Entity Drift Audit

Detector for the devt arch-scan engine that surfaces a recurring class of
production bug: **endpoints/models reference a domain concept (country,
calling-settings, language, …) without being structurally connected to its
canonical entity model.**

Two motivating examples of this bug class:

1. `Organization.billing_country: str` — free-form ISO code with no FK to the
   `Country` entity. Untangling required a multi-step migration + ISO
   resolver + invoice VAT chain + audit mapper + integration tests.
2. `calling_settings` attached to `User` when the call target is actually
   a `Client` (Client owns the device, has the license, is the callable
   party) — settings ended up on the wrong entity.

Both bugs share a structural fingerprint that AST + Graphify can detect.

---

## What ships

| Where                                                              | What                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `templates/python-fastapi/arch-scan.py`                            | Thin orchestrator — loads detectors, walks files, emits findings |
| `templates/python-fastapi/detectors/__init__.py`                   | Detector protocol + `register()` + `all_detectors()` auto-discovery |
| `templates/python-fastapi/detectors/_graph_index.py`               | Read-only `graphify-out/graph.json` query helper; fail-open on missing/stale |
| `templates/python-fastapi/detectors/canonical_entities.py`         | The drift detector (R1–R6)                                 |
| `templates/python-fastapi/detectors/{layer_imports,db_in_application,inline_imports,god_size}.py` | Existing six checks, now plugin-shaped |
| `templates/python-fastapi/canonical-entities.yaml`                 | Registry template — 10 default entities                    |
| `skills/architecture-health-scanner/`                              | Already-existing skill, now triages CANONICAL-\* categories |

Once a project runs `/devt:setup --init` (or copies the template manually), these
land at `.devt/rules/` and the canonical detector is live.

---

## How the detector decides

Six rules, each emitting one category. The detector is **AST-first** so it
works without Graphify; the three Graphify-augmented rules are pure adds.

| Rule | Category                     | Severity | Uses graph? | Triggered when |
| ---- | ---------------------------- | -------- | ----------- | -------------- |
| R1   | `CANONICAL-MISSING-FK`       | high     | no          | Field name matches a registry trigger, type is bare `str`/`int`, no `Field(..., foreign_key=...)` |
| R2   | `CANONICAL-WRONG-OWNER`      | critical | no          | Class has FK column whose name targets a class listed in `forbid_owners` |
| R3   | `CANONICAL-OWNERSHIP-MISSING`| high     | yes (cross-check) | Registry says `must_belong_to: X`; class lacks FK to X AND graph confirms file doesn't import X |
| R4   | `CANONICAL-ENTITY-MISSING`   | low      | no          | Trigger fires + registry says `entity_status: MISSING` (e.g. Currency, Language) |
| R5   | `CANONICAL-WIRING-ORPHAN`    | medium   | required    | Non-domain file has FK to canonical entity but graph shows no import edge — typo / dead scaffold / dynamic load |
| R6   | `CANONICAL-DUPLICATE-ENTITY` | medium   | required    | File defines a class with the same name as a canonical entity outside its canonical home |

**Why R5 skips `domain/`**: Clean Architecture domain models legitimately
declare FKs via SQL table-name strings (`foreign_key="organizations.id"`) and
deliberately avoid importing other domain entities. R5 only fires for
application/api/infrastructure layers where a Python import IS expected.

**Why R6 cross-checks AST**: Graphify indexes type annotations and parameter
types as nodes labeled with the class name. R6 only emits when the file
actually contains an `ast.ClassDef` with that name (a real definition, not a
reference).

---

## Registry schema

`.devt/rules/canonical-entities.yaml`:

```yaml
version: 1
defaults:
  forbid_string_only: false
  fk_column_pattern: "{entity_name}_id"

entities:
  country:
    entity_status: EXISTS                       # EXISTS | MISSING | ENUM
    import_path: app.services.countries.domain.models.Country
    canonical_file: app/services/countries/domain/models.py
    table_name: countries
    pk_column: id
    pk_type: int
    triggers: [country, country_code, billing_country, operational_country]
    allowed_fk_columns: [country_id, billing_country_id, operational_country_id]
    forbid_string_only: true

  calling_settings:
    entity_status: EXISTS
    import_path: app.services.clients.domain.models.Client
    triggers: [calling_settings, video_call_settings, video_autoanswer, can_be_called]
    must_belong_to: Client                      # OWNERSHIP: must FK to Client
    forbid_owners: [User]                       # MUST NOT FK to User

  currency:
    entity_status: MISSING                      # surfaces as WARN, not blocking
    triggers: [currency, currency_code, iso_currency]
    forbid_string_only: true
```

Unknown keys are silently ignored — projects can extend the schema with
their own metadata without breaking the detector.

---

## CLI

```
python3 .devt/rules/arch-scan.py [--canonical-only] [--registry=PATH] \
    [--baseline=PATH] [--write-baseline=PATH] [--report=PATH] \
    [--enable=name1,name2] [--disable=name1,name2] \
    [--detector-path=PATH] [--json] [--fail-on=critical,high]
```

| Flag                  | Purpose |
| --------------------- | ------- |
| `--canonical-only`    | Shortcut for `--enable=canonical-entities`, fast iteration when tuning the registry |
| `--registry=PATH`     | Override default `.devt/rules/canonical-entities.yaml` |
| `--baseline=PATH`     | Suppress findings already in baseline (the CI gate) |
| `--write-baseline=PATH` | Emit current findings as a baseline (first-run capture) |
| `--report=PATH`       | Write Markdown report grouped by entity / severity |
| `--enable=...`        | Exclusive allowlist of detector names |
| `--disable=...`       | Skip these detectors or categories (combinable with --enable) |
| `--detector-path=PATH`| Alternate directory for plugin discovery |
| `--json`              | JSON to stdout, text summary to stderr |
| `--fail-on=...`       | Severities that cause non-zero exit (default: critical,high) |

---

## Baseline workflow

```bash
# First-run capture — accept existing debt
python3 .devt/rules/arch-scan.py --canonical-only \
    --write-baseline=.devt/state/canonical-baseline.json

# Commit the baseline — it's a contract reviewed in PRs
git add .devt/state/canonical-baseline.json

# Subsequent runs (CI) — gate fails only on NEW violations
python3 .devt/rules/arch-scan.py --canonical-only \
    --baseline=.devt/state/canonical-baseline.json
```

Findings are fingerprinted as `(category, file, line, fingerprint)` where
`fingerprint` includes the field name + violation kind so the baseline
doesn't accidentally accept a different finding on the same line. Re-running
`--write-baseline` after fixing items shrinks the file. PRs that grow the
baseline must justify it in review.

---

## Pytest gate

```python
# tests/architecture/test_canonical_drift.py
@pytest.mark.architecture
def test_no_new_canonical_entity_drift() -> None:
    result = subprocess.run([
        sys.executable, ".devt/rules/arch-scan.py",
        "--canonical-only", "--json",
        f"--baseline={REPO / '.devt/state/canonical-baseline.json'}",
    ], capture_output=True, text=True, check=False)
    report = json.loads(result.stdout)
    blockers = [f for f in report["findings"] if f["severity"] in {"critical", "high"}]
    if blockers:
        pytest.fail(f"{len(blockers)} new canonical-entity drift finding(s)…")
```

Register the marker in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
markers = [
    "architecture: structural/contract tests that fail on new architectural drift",
]
```

The test takes ~2 seconds, no DB, no fixtures — runs in the unit phase of
`make quality`.

---

## Adding a new detector

Drop a file into `.devt/rules/detectors/`. No edits to `arch-scan.py`
required. Auto-discovery picks it up next run.

```python
# .devt/rules/detectors/my_detector.py
from . import Detector, ScanContext, Finding, register

class MyDetector:
    name = "my-detector"
    categories = ("MY-CATEGORY",)
    severities = ("medium",)

    def run(self, ctx: ScanContext) -> list[Finding]:
        # ctx gives you: rel_path, tree (parsed AST), signals (imports/classes/
        # inline imports, pre-walked), layer, service, registry, graph, config
        return [
            Finding(
                category="MY-CATEGORY",
                severity="medium",
                file=str(ctx.rel_path),
                line=node.lineno,
                message="...",
                fingerprint="...",   # optional, helps baseline matching
            )
            for node in ast.walk(ctx.tree)
            if ...
        ]

register(MyDetector())
```

Detectors are duck-typed via `runtime_checkable Protocol`. No inheritance
required — `MyDetector` just needs `name`, `categories`, `severities`, and
`run(ctx)`.

Internal helpers (modules whose name starts with `_`) are skipped by
auto-discovery, so utility code can live alongside detectors without
accidental registration.

---

## How Graphify is used

`detectors/_graph_index.py` builds three indexes from `graphify-out/graph.json`
once at scan startup:

- `_by_label` — every node grouped by its display label
- `_by_source` — every node grouped by its source file
- `_out_edges` / `_in_edges` — full incidence map keyed by node id

Then exposes three query methods used by the canonical detector:

```python
graph.file_imports_entity(source_file, entity_label) -> bool
graph.entity_consumer_files(entity_label) -> set[str]
graph.duplicate_entity_definitions(entity_label, canonical_file) -> list[(file, line)]
```

**Fail-open behavior**:
- If `graphify-out/graph.json` is missing → loader returns `None`, R3/R5/R6
  silently skip, AST-only rules (R1/R2/R4) still produce findings.
- If the graph's `built_at_commit` doesn't match `git rev-parse HEAD` →
  stderr warning, but the graph is still used. Stale graphs are a hint,
  not a fatal error.

No detector should crash because Graphify is missing or stale.

---

## Verification recipe

```bash
# 1. Self-check on a clean main
python3 .devt/rules/arch-scan.py --canonical-only

# 2. Generate baseline + report
python3 .devt/rules/arch-scan.py --canonical-only \
    --write-baseline=.devt/state/canonical-baseline.json \
    --report=docs/reports/CANONICAL-DRIFT.md

# 3. Confirm baseline absorbs everything
python3 .devt/rules/arch-scan.py --canonical-only \
    --baseline=.devt/state/canonical-baseline.json
# expected: exit 0

# 4. Synthetic violation — add `country: str` to any model class, run gate,
#    confirm exit 1 with finding pointing at the new line, then revert.

# 5. Pytest
uv run pytest tests/architecture/test_canonical_drift.py -v

# 6. Graph staleness handling
mv graphify-out/graph.json /tmp/
python3 .devt/rules/arch-scan.py --canonical-only
# expected: AST findings still flow, R5/R6 silently skip

# 7. devt:arch-health integration
/devt:review --focus=arch
# expected: CANONICAL-* findings appear in skill triage output
```

---

## Out of scope (deferred)

- Creating `Currency` / `Language` entities — the audit surfaces the gap;
  the entity-creation decision is per-project.
- Auto-fix / codemod — detection only in v1.
- Hurl request-body audit (string-typed concept fields in `.hurl` JSON) — phase 2.
- Per-route audit (handler arg types vs. canonical entities) — phase 2.
- IDE live integration (VSCode/PyCharm warnings) — phase 3.

---

## Related

- `templates/python-fastapi/architecture.md` — house architecture rules
- `skills/architecture-health-scanner/SKILL.md` — finding triage skill
- `docs/GRAPHIFY.md` — graph build/refresh workflow
- `docs/HOOKS.md` — wiring scans into pre-commit / CI
