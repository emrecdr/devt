"""Unit tests for the arch-scan orchestrator + detector plugin internals.

Pure stdlib + pytest. No DB, no fixtures, no third-party deps required.

Covers:
  * detector registry: register / duplicate-name guard / auto-discovery
  * helpers: _ann_is_bare_string, _trigger_matches
  * disable semantics: name (pre-run drop) vs category (post-run filter)
  * baseline filtering
  * tolerant registry loader (YAML, JSON, malformed, missing)
"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

# Make the in-project detectors package importable for tests.
REPO = Path(__file__).resolve().parents[2]
RULES = REPO / ".devt" / "rules"
SCANNER = RULES / "arch-scan.py"
sys.path.insert(0, str(RULES))

from detectors import (  # noqa: E402
    Detector,
    Finding,
    ScanContext,
    VisitorSignals,
    all_detectors,
    clear_registry,
    register,
)
from detectors._registry_loader import load_registry  # noqa: E402
from detectors.canonical_entities import (  # noqa: E402
    _ann_is_bare_string,
    _split_identifier,
    _trigger_matches,
)

# ---------------------------------------------------------------------------
# Detector registry
# ---------------------------------------------------------------------------


class _Stub:
    name = "stub-detector"
    categories = ("STUB",)
    severities = ("low",)

    def run(self, ctx: ScanContext) -> list[Finding]:  # pragma: no cover - trivial
        return []


def test_detector_protocol_accepts_duck_typed_class() -> None:
    """A class with name/categories/severities/run satisfies the protocol."""
    assert isinstance(_Stub(), Detector)


def test_register_rejects_non_detectors() -> None:
    class Bad:
        pass

    with pytest.raises(TypeError):
        register(Bad())


def test_register_rejects_duplicate_names(monkeypatch: pytest.MonkeyPatch) -> None:
    # Snapshot + restore so we don't poison the global registry.
    from detectors import _REGISTRY

    saved = dict(_REGISTRY)
    try:
        clear_registry()
        register(_Stub())
        with pytest.raises(ValueError):
            register(_Stub())
    finally:
        _REGISTRY.clear()
        _REGISTRY.update(saved)


def test_all_detectors_returns_sorted() -> None:
    dets = all_detectors()
    names = [d.name for d in dets]
    assert names == sorted(names), "all_detectors() must return alphabetical order"
    assert "canonical-entities" in names
    assert "layer-imports" in names


# ---------------------------------------------------------------------------
# Annotation helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("x: str", True),
        ("x: int", True),
        ("x: str | None", True),
        ("x: int | None", True),
        ("x: None | str", True),
        ("x: Optional[str]", False),  # Optional not unwrapped — keep narrow
        ("x: list[str]", False),
        ("x: bytes", False),
        ("x: 'str'", False),  # quoted forward-ref not bare
    ],
)
def test_ann_is_bare_string(source: str, expected: bool) -> None:
    tree = ast.parse(source)
    ann_assign = tree.body[0]
    assert isinstance(ann_assign, ast.AnnAssign)
    assert _ann_is_bare_string(ann_assign.annotation) is expected


@pytest.mark.parametrize(
    ("field_name", "triggers", "match"),
    [
        ("country", ["country"], "country"),
        ("country_id", ["country"], "country"),
        ("billing_country", ["billing_country"], "billing_country"),
        ("billing_country", ["country"], "country"),
        ("account", ["country"], None),  # substring, not word
        ("Country", ["country"], "country"),  # case-insensitive
        ("currency_code", ["currency"], "currency"),
        # CamelCase fields (regression: previously missed)
        ("BillingCountry", ["country"], "country"),
        ("UserCallingSettings", ["calling_settings"], "calling_settings"),
        # When multiple triggers match, the most-specific (longest) wins
        ("role_scope", ["role", "role_scope"], "role_scope"),
        ("billing_country", ["country", "billing_country"], "billing_country"),
    ],
)
def test_trigger_matches(field_name: str, triggers: list[str], match: str | None) -> None:
    assert _trigger_matches(field_name, triggers) == match


@pytest.mark.parametrize(
    ("identifier", "expected"),
    [
        ("billing_country", ["billing", "country"]),
        ("BillingCountry", ["billing", "country"]),
        ("UserCallingSettings", ["user", "calling", "settings"]),
        ("HTTPResponse", ["http", "response"]),
        ("role_scope", ["role", "scope"]),
        ("snake_case_v2", ["snake", "case", "v2"]),
        ("", []),
    ],
)
def test_split_identifier(identifier: str, expected: list[str]) -> None:
    """CamelCase and snake_case must produce the same word list."""
    assert _split_identifier(identifier) == expected


# ---------------------------------------------------------------------------
# Disable semantics — P1 regression coverage
# ---------------------------------------------------------------------------


def _run_scanner(*args: str) -> dict:
    result = subprocess.run(
        [sys.executable, str(SCANNER), "--json", f"--root={REPO}", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode in (0, 1), f"scanner crashed (exit {result.returncode})\nstderr: {result.stderr[:500]}"
    return json.loads(result.stdout)


def _category_counts(report: dict) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in report["findings"]:
        counts[f["category"]] = counts.get(f["category"], 0) + 1
    return counts


def test_disable_by_detector_name_drops_all_its_categories() -> None:
    """--disable=NAME removes every category the detector emits."""
    report = _run_scanner("--disable=god-size,canonical-entities")
    counts = _category_counts(report)
    assert counts.get("GOD-FILE", 0) == 0
    assert counts.get("GOD-CLASS", 0) == 0
    # other detectors still fire
    assert counts.get("INLINE-IMPORT", 0) > 0


def test_disable_by_category_keeps_sibling_categories() -> None:
    """--disable=GOD-FILE silences only GOD-FILE; GOD-CLASS still flows.

    Regression test for the bug where the old code dropped the entire
    god-size detector when any of its categories was named in --disable.
    """
    report = _run_scanner("--disable=GOD-FILE,canonical-entities")
    counts = _category_counts(report)
    assert counts.get("GOD-FILE", 0) == 0
    assert counts.get("GOD-CLASS", 0) > 0, (
        "GOD-CLASS findings should still flow when only GOD-FILE is disabled via category-level filter"
    )


def test_canonical_only_runs_only_canonical_detector() -> None:
    report = _run_scanner("--canonical-only")
    assert report["detectors_loaded"] == ["canonical-entities"]


def test_enable_overrides_disable() -> None:
    report = _run_scanner("--enable=god-size", "--disable=GOD-CLASS")
    counts = _category_counts(report)
    # --enable allowlist wins; --disable category still applies post-run
    assert counts.get("GOD-FILE", 0) > 0
    assert counts.get("GOD-CLASS", 0) == 0


# ---------------------------------------------------------------------------
# Baseline filtering
# ---------------------------------------------------------------------------


def test_baseline_absorbs_existing_findings(tmp_path: Path) -> None:
    """Generate a baseline, re-run with it, confirm zero new findings."""
    baseline = tmp_path / "baseline.json"
    # Capture every current canonical finding
    subprocess.run(
        [
            sys.executable,
            str(SCANNER),
            "--canonical-only",
            "--json",
            f"--root={REPO}",
            f"--write-baseline={baseline}",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert baseline.exists()

    # Re-run with that baseline — should report zero NEW findings
    report = _run_scanner("--canonical-only", f"--baseline={baseline}")
    assert len(report["findings"]) == 0
    assert report["raw_finding_count"] > 0  # work was still done
    assert report["baseline_filtered"] == report["raw_finding_count"]


def test_baseline_does_not_match_different_line(tmp_path: Path) -> None:
    """Baseline matches on (category, file, line, fingerprint). A finding at a
    NEW line in the same file should still surface."""
    baseline = tmp_path / "baseline.json"
    baseline.write_text(
        json.dumps(
            {
                "scanner": "test",
                "version": "2.0",
                "entries": [
                    {
                        "category": "CANONICAL-MISSING-FK",
                        "file": "app/services/organizations/domain/models.py",
                        "line": 1,  # wrong line — should NOT absorb the real one
                        "fingerprint": "country:country:missing-fk",
                    }
                ],
            }
        )
    )
    report = _run_scanner("--canonical-only", f"--baseline={baseline}")
    # The real finding at organizations/domain/models.py:102 must NOT be absorbed
    survived = [
        f
        for f in report["findings"]
        if f["file"] == "app/services/organizations/domain/models.py" and f["category"] == "CANONICAL-MISSING-FK"
    ]
    assert survived, "baseline at wrong line should not absorb a different-line finding"


# ---------------------------------------------------------------------------
# Registry loader
# ---------------------------------------------------------------------------


def test_load_registry_missing_returns_none(tmp_path: Path) -> None:
    assert load_registry(tmp_path / "nope.yaml") is None


def test_load_registry_yaml(tmp_path: Path) -> None:
    pytest.importorskip("yaml")
    p = tmp_path / "r.yaml"
    p.write_text("entities:\n  foo:\n    triggers: [bar]\n")
    reg = load_registry(p)
    assert reg == {"entities": {"foo": {"triggers": ["bar"]}}}


def test_load_registry_json(tmp_path: Path) -> None:
    p = tmp_path / "r.json"
    p.write_text(json.dumps({"entities": {"foo": {"triggers": ["bar"]}}}))
    reg = load_registry(p)
    assert reg == {"entities": {"foo": {"triggers": ["bar"]}}}


def test_load_registry_malformed_json_returns_none(tmp_path: Path) -> None:
    p = tmp_path / "r.json"
    p.write_text("{ not valid json")
    assert load_registry(p) is None


def test_load_registry_non_mapping_returns_none(tmp_path: Path) -> None:
    p = tmp_path / "r.json"
    p.write_text(json.dumps([1, 2, 3]))  # top-level array, not mapping
    assert load_registry(p) is None


# ---------------------------------------------------------------------------
# VisitorSignals + ScanContext
# ---------------------------------------------------------------------------


def test_visitor_signals_default_factory_independence() -> None:
    """Two VisitorSignals instances must NOT share the same lists (regression
    guard for accidental mutable defaults)."""
    a = VisitorSignals()
    b = VisitorSignals()
    a.imports.append((1, "x"))
    assert b.imports == []


# ---------------------------------------------------------------------------
# Code-review remediation regression tests (F1–F10)
# ---------------------------------------------------------------------------


def _inject_and_scan(class_src: str, target_rel: str = "app/services/organizations/domain/models.py") -> dict:
    """Append ``class_src`` to a project model file, run the scanner, restore."""
    target = REPO / target_rel
    original = target.read_text()
    try:
        target.write_text(original + "\n\n" + class_src + "\n")
        return _run_scanner("--canonical-only")
    finally:
        target.write_text(original)


def test_r2_camel_case_class_name_triggers_wrong_owner() -> None:
    """F1 regression: `UserCallingSettings` (no underscores) must trigger R2
    against `calling_settings`/User. Previously failed because of substring
    match on stripped-underscore class name."""
    report = _inject_and_scan(
        "class UserCallingSettings:\n"
        '    """synthetic test"""\n'
        '    user_id: str = Field(default=None, foreign_key="users.id")'
    )
    wrongs = [
        f
        for f in report["findings"]
        if f["category"] == "CANONICAL-WRONG-OWNER" and "UserCallingSettings" in f["message"]
    ]
    assert wrongs, "R2 must catch the CamelCase calling-settings-on-User pattern"


def test_r1_no_duplicate_findings_for_ambiguous_field() -> None:
    """F6 regression: `role_scope` matches both `role` and `scope` triggers in
    the registry. The detector must attribute it to a SINGLE entity (the most
    specific match) instead of emitting two duplicate findings."""
    report = _inject_and_scan('class SyntheticAmbiguous:\n    role_scope: str = "x"')
    on_line = [
        f
        for f in report["findings"]
        if "SyntheticAmbiguous" in f.get("message", "") and "role_scope" in f.get("message", "")
    ]
    # Expect AT MOST ONE finding for this field — not two.
    assert len(on_line) <= 1, f"duplicate findings: {on_line}"


def test_r7_enum_concept_emits_missing_enum_not_missing_fk() -> None:
    """F7 regression: `scope` entity has entity_status=ENUM. A bare `scope: str`
    field must emit CANONICAL-MISSING-ENUM (advising enum type) not
    CANONICAL-MISSING-FK (advising an FK column)."""
    report = _inject_and_scan('class SyntheticScope:\n    scope: str = "system"')
    relevant = [f for f in report["findings"] if "SyntheticScope" in f.get("message", "") and f["line"] != 0]
    cats = {f["category"] for f in relevant}
    assert "CANONICAL-MISSING-ENUM" in cats, f"expected MISSING-ENUM, got {cats}"
    assert "CANONICAL-MISSING-FK" not in cats, f"ENUM concept must NOT emit MISSING-FK, got {cats}"


def test_write_baseline_excludes_internal_categories(tmp_path: Path) -> None:
    """F4 regression: SCAN-ERROR / DETECTOR-ERROR rows MUST NOT enter the
    baseline (else a broken detector hides itself forever)."""
    baseline = tmp_path / "baseline.json"
    # Create a project root with one broken Python file → SCAN-ERROR
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "broken.py").write_text("def bad syntax\n")
    subprocess.run(
        [
            sys.executable,
            str(SCANNER),
            "--canonical-only",
            f"--root={proj}",
            f"--write-baseline={baseline}",
            "--json",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    data = json.loads(baseline.read_text())
    cats = {e["category"] for e in data["entries"]}
    assert "SCAN-ERROR" not in cats, "SCAN-ERROR must be excluded from baseline"
    assert "DETECTOR-ERROR" not in cats


def test_write_baseline_ignores_disable_category(tmp_path: Path) -> None:
    """F3 regression: `--disable=CAT --write-baseline=X` must still write CAT
    findings to X. Otherwise rerunning without --disable surfaces them all as
    'new'."""
    baseline = tmp_path / "baseline.json"
    subprocess.run(
        [
            sys.executable,
            str(SCANNER),
            f"--root={REPO}",
            "--disable=GOD-FILE,canonical-entities",
            f"--write-baseline={baseline}",
            "--json",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    data = json.loads(baseline.read_text())
    cats = {e["category"] for e in data["entries"]}
    assert "GOD-FILE" in cats, (
        "Baseline must contain GOD-FILE even when --disable=GOD-FILE; "
        "otherwise reruns without --disable would re-surface the debt"
    )


def test_load_baseline_tolerates_null_line(tmp_path: Path) -> None:
    """F9 regression: baseline entries with `\"line\": null` must not crash
    the scanner; they should be either coerced to 0 or skipped."""
    baseline = tmp_path / "baseline.json"
    baseline.write_text(
        json.dumps(
            {
                "scanner": "test",
                "version": "2.0",
                "entries": [
                    {"category": "X", "file": "f.py", "line": None, "fingerprint": ""},
                    {"category": "Y", "file": "g.py", "line": "not-a-number", "fingerprint": ""},
                ],
            }
        )
    )
    # Scanner must run cleanly, NOT crash with TypeError
    r = subprocess.run(
        [sys.executable, str(SCANNER), "--canonical-only", "--json", f"--root={REPO}", f"--baseline={baseline}"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert r.returncode in (0, 1), f"scanner crashed on malformed baseline:\n{r.stderr[:500]}"


def test_registry_validation_drops_malformed_entity(tmp_path: Path) -> None:
    """F8 regression: a registry entity with `must_belong_to: [list]` instead
    of a string must be dropped at load (with warning), not crash the detector
    per-file with AttributeError."""
    from detectors._registry_loader import load_registry  # noqa: PLC0415

    reg = tmp_path / "r.json"
    reg.write_text(
        json.dumps(
            {
                "version": 1,
                "entities": {
                    "valid": {"triggers": ["v"]},
                    "bad_must_belong_to": {"triggers": ["x"], "must_belong_to": ["Client"]},
                    "bad_triggers": {"triggers": "not-a-list"},
                    "null_body": None,
                },
            }
        )
    )
    loaded = load_registry(reg)
    assert loaded is not None
    keys = set(loaded["entities"].keys())
    assert keys == {"valid"}, f"expected only 'valid' to survive, got {keys}"


def test_r6_duplicate_entity_works_without_graph(tmp_path: Path) -> None:
    """F2 regression: R6 (duplicate-entity) is pure AST. It must fire even
    when graphify-out/graph.json is absent."""
    # Build a synthetic project: a registry pointing Country at one file,
    # and a class named Country in a non-canonical file.
    proj = tmp_path / "proj"
    (proj / "app" / "services" / "countries" / "domain").mkdir(parents=True)
    (proj / "app" / "services" / "countries" / "domain" / "models.py").write_text("class Country:\n    pass\n")
    (proj / "app" / "services" / "other" / "application").mkdir(parents=True)
    (proj / "app" / "services" / "other" / "application" / "service.py").write_text("class Country:\n    pass\n")
    reg = proj / "canonical-entities.yaml"
    reg.write_text(
        "version: 1\n"
        "entities:\n"
        "  country:\n"
        "    entity_status: EXISTS\n"
        "    import_path: app.services.countries.domain.models.Country\n"
        "    canonical_file: app/services/countries/domain/models.py\n"
        "    triggers: [country]\n"
    )
    # Note: no graphify-out/graph.json exists in proj
    r = subprocess.run(
        [sys.executable, str(SCANNER), "--canonical-only", "--json", f"--root={proj}", f"--registry={reg}"],
        capture_output=True,
        text=True,
        check=False,
    )
    d = json.loads(r.stdout)
    dups = [f for f in d["findings"] if f["category"] == "CANONICAL-DUPLICATE-ENTITY"]
    assert dups, "R6 must fire without graphify-out (it's pure AST)"
    assert any("other/application/service.py" in f["file"] for f in dups)


def test_external_detector_path_loads_arbitrary_module(tmp_path: Path) -> None:
    """F5 regression: `--detector-path=DIR` must load a *.py from DIR as a
    detector, not crash with ModuleNotFoundError trying to import
    `detectors.NAME`."""
    ext_dir = tmp_path / "ext_detectors"
    ext_dir.mkdir()
    (ext_dir / "echo_detector.py").write_text(
        '"""External detector for the regression test."""\n'
        "import sys\n"
        "sys.path.insert(0, " + repr(str(RULES)) + ")\n"
        "from detectors import Finding, ScanContext, register\n"
        "\n"
        "class EchoDetector:\n"
        "    name = 'echo-detector'\n"
        "    categories = ('ECHO',)\n"
        "    severities = ('low',)\n"
        "    def run(self, ctx):\n"
        "        return []\n"
        "\n"
        "register(EchoDetector())\n"
    )
    r = subprocess.run(
        [
            sys.executable,
            str(SCANNER),
            "--enable=echo-detector",
            f"--detector-path={ext_dir}",
            "--json",
            f"--root={REPO}",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert r.returncode in (0, 1), f"external detector load crashed:\n{r.stderr[:500]}"
    d = json.loads(r.stdout)
    assert "echo-detector" in d["detectors_loaded"], (
        f"--detector-path failed to load external detector. "
        f"detectors_loaded={d['detectors_loaded']}, stderr={r.stderr[:300]}"
    )


# ---------------------------------------------------------------------------
# Audit-round-2 regression tests (N1, N2, N3, I4)
# ---------------------------------------------------------------------------


def test_canonical_detector_state_resets_between_runs() -> None:
    """N1 regression: CanonicalEntitiesDetector._duplicate_findings_emitted
    must NOT leak state across run() invocations. Two runs on the same input
    must produce identical output."""
    import ast as _ast  # noqa: PLC0415

    from detectors import ScanContext as _Ctx  # noqa: PLC0415
    from detectors import VisitorSignals as _Sig  # noqa: PLC0415
    from detectors import all_detectors as _all  # noqa: PLC0415

    det = next(d for d in _all() if d.name == "canonical-entities")
    src = "class Country:\n    pass\n"
    ctx = _Ctx(
        project_root=Path("."),
        rel_path=Path("app/x.py"),
        tree=_ast.parse(src),
        source=src,
        signals=_Sig(),
        layer=None,
        service=None,
        registry={
            "entities": {
                "country": {
                    "entity_status": "EXISTS",
                    "import_path": "app.services.countries.domain.models.Country",
                    "canonical_file": "app/services/countries/domain/models.py",
                    "triggers": ["country"],
                }
            }
        },
        graph=None,
        config={},
    )
    r1 = det.run(ctx)
    r2 = det.run(ctx)
    assert len(r1) == len(r2), (
        f"detector state leaked: run1={len(r1)} run2={len(r2)} — "
        f"singleton detector instance retained scan-local state across runs"
    )
    assert len(r1) == 1  # R6 duplicate-entity finding


def test_warn_on_unknown_disable_token() -> None:
    """N2 regression: --disable=<typo> must produce a stderr warning, not
    silently treat the token as a category filter that matches nothing."""
    result = subprocess.run(
        [sys.executable, str(SCANNER), "--disable=godSize,canonical-entities", "--json", f"--root={REPO}"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert "not recognized" in result.stderr, (
        f"--disable=godSize should warn (typo of god-size). stderr first 500 chars:\n{result.stderr[:500]}"
    )


def test_warn_on_unknown_enable_token() -> None:
    """N2 regression: --enable=<typo> must produce a stderr warning."""
    result = subprocess.run(
        [sys.executable, str(SCANNER), "--enable=godSize", "--json", f"--root={REPO}"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert "not recognized" in result.stderr, f"--enable=godSize should warn. stderr:\n{result.stderr[:500]}"


def test_graph_not_loaded_when_no_detector_needs_it(tmp_path: Path) -> None:
    """N3 regression: if no enabled detector declares `needs_graph=True`, the
    orchestrator must skip GraphIndex.load() — saving the I/O cost of reading
    graphify-out/graph.json and the `git rev-parse HEAD` subprocess."""
    # Build a tiny project with a stale graph.json that would emit a warning
    # IF loaded.
    proj = tmp_path / "proj"
    (proj / "app").mkdir(parents=True)
    (proj / "app" / "x.py").write_text("x = 1\n")
    (proj / "graphify-out").mkdir()
    (proj / "graphify-out" / "graph.json").write_text('{"nodes": [], "links": [], "built_at_commit": "deadbeef"}')
    # Initialize a git repo so `git rev-parse HEAD` would succeed-with-mismatch
    subprocess.run(["git", "init", "-q"], cwd=proj, check=False)
    subprocess.run(
        ["git", "commit", "--allow-empty", "-m", "init", "-q"],
        cwd=proj,
        check=False,
        env={
            **os.environ,
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@t",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@t",
        },
    )

    # Disable canonical (the only detector with needs_graph=True). Graph
    # should NOT be loaded → no stale warning on stderr.
    result = subprocess.run(
        [sys.executable, str(SCANNER), "--disable=canonical-entities", "--json", f"--root={proj}"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert "graphify graph built at" not in result.stderr, (
        f"Graph was loaded when no detector needed it. stderr:\n{result.stderr}"
    )


# ---------------------------------------------------------------------------
# Tuning-round-1 regression tests (T1-T7)
# ---------------------------------------------------------------------------


def _run_scanner_in_tmp(proj: Path, *args: str) -> dict:
    """Helper that runs the scanner against a throwaway project root."""
    r = subprocess.run(
        [sys.executable, str(SCANNER), "--json", f"--root={proj}", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    assert r.returncode in (0, 1), f"scanner crashed:\nstderr: {r.stderr[:500]}"
    return json.loads(r.stdout)


def _write_py(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)


def test_t1_type_checking_imports_do_not_fire_layer_violations(tmp_path: Path) -> None:
    """T1: imports inside `if TYPE_CHECKING:` are pure type hints — must NOT
    trigger LAYER-IMPORT-DOMAIN (the 3 false-positive criticals on
    photos/clients/organizations domain/models.py)."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "app" / "services" / "x" / "domain" / "models.py",
        "from __future__ import annotations\n"
        "from typing import TYPE_CHECKING\n"
        "if TYPE_CHECKING:\n"
        "    from app.services.y.infrastructure.models import Y\n"
        "class X:\n"
        "    pass\n",
    )
    report = _run_scanner_in_tmp(proj, "--disable=canonical-entities,inline-imports,god-size,db-in-application")
    cats = {f["category"] for f in report["findings"]}
    assert "LAYER-IMPORT-DOMAIN" not in cats, (
        f"TYPE_CHECKING-guarded import must not fire LAYER-IMPORT-DOMAIN. findings: {report['findings']}"
    )


def test_t1_runtime_imports_still_fire_layer_violations(tmp_path: Path) -> None:
    """T1 negative: a real runtime import from domain → infrastructure MUST
    still fire — the TYPE_CHECKING tune must not over-suppress."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "app" / "services" / "x" / "domain" / "models.py",
        "from app.services.y.infrastructure.models import Y\nclass X:\n    pass\n",
    )
    report = _run_scanner_in_tmp(proj, "--disable=canonical-entities,inline-imports,god-size,db-in-application")
    cats = {f["category"] for f in report["findings"]}
    assert "LAYER-IMPORT-DOMAIN" in cats, "runtime import from domain → infrastructure MUST still fire"


def test_t1b_type_checking_imports_do_not_fire_db_in_application(tmp_path: Path) -> None:
    """T1b: TYPE_CHECKING-guarded `from sqlmodel import Session` in an
    `application/` module must NOT fire DB-IN-APPLICATION. The visitor's
    `imported_names` signal (which db-in-application reads) must mirror the
    `imports` signal — both excluded under TYPE_CHECKING. Asymmetric handling
    of `Import` vs `ImportFrom` previously produced false positives on pure
    type hints in service modules."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "app" / "services" / "x" / "application" / "service.py",
        "from __future__ import annotations\n"
        "from typing import TYPE_CHECKING\n"
        "if TYPE_CHECKING:\n"
        "    from sqlmodel import Session\n"
        "class XService:\n"
        "    def __init__(self, session: 'Session') -> None:\n"
        "        self._session = session\n",
    )
    report = _run_scanner_in_tmp(proj, "--disable=canonical-entities,inline-imports,god-size,layer-imports")
    cats = {f["category"] for f in report["findings"]}
    assert "DB-IN-APPLICATION" not in cats, (
        f"TYPE_CHECKING-guarded SQLModel import must not fire DB-IN-APPLICATION. findings: {report['findings']}"
    )


def test_t1b_runtime_db_imports_still_fire_in_application(tmp_path: Path) -> None:
    """T1b negative: a runtime `from sqlmodel import Session` in `application/`
    MUST still fire DB-IN-APPLICATION. Symmetry with the layer-imports tune —
    suppressing TYPE_CHECKING must not over-suppress runtime use."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "app" / "services" / "x" / "application" / "service.py",
        "from sqlmodel import Session\nclass XService:\n    pass\n",
    )
    report = _run_scanner_in_tmp(proj, "--disable=canonical-entities,inline-imports,god-size,layer-imports")
    cats = {f["category"] for f in report["findings"]}
    assert "DB-IN-APPLICATION" in cats, (
        "runtime `from sqlmodel import Session` in application/ MUST still fire DB-IN-APPLICATION"
    )


def test_t2_api_dependencies_composition_root_allowed(tmp_path: Path) -> None:
    """T2: `api/dependencies.py` and `api/v1/dependencies.py` are FastAPI DI
    composition roots — must NOT fire LAYER-IMPORT-API for infrastructure
    imports (that's literally their purpose)."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "app" / "services" / "x" / "api" / "v1" / "dependencies.py",
        "from app.services.x.infrastructure.repository import XRepository\ndef get_x_repo(): return XRepository()\n",
    )
    _write_py(
        proj / "app" / "services" / "y" / "api" / "dependencies.py",
        "from app.services.y.infrastructure.repository import YRepository\n",
    )
    report = _run_scanner_in_tmp(proj, "--disable=canonical-entities,inline-imports,god-size,db-in-application")
    api_violations = [f for f in report["findings"] if f["category"] == "LAYER-IMPORT-API"]
    assert not api_violations, f"composition-root files must be allowlisted, got: {api_violations}"


def test_t2_non_dependencies_api_files_still_fire(tmp_path: Path) -> None:
    """T2 negative: a regular route file (not `dependencies.py`) reaching
    into infrastructure MUST still fire — the composition-root exemption
    must not leak to other files."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "app" / "services" / "x" / "api" / "v1" / "routes.py",
        "from app.services.x.infrastructure.repository import XRepository\ndef handler(): return XRepository()\n",
    )
    report = _run_scanner_in_tmp(proj, "--disable=canonical-entities,inline-imports,god-size,db-in-application")
    cats = {f["category"] for f in report["findings"]}
    assert "LAYER-IMPORT-API" in cats, "non-dependencies api files MUST still fire LAYER-IMPORT-API"


def test_t2_nested_dependencies_py_not_exempted(tmp_path: Path) -> None:
    """T2 negative (composition-root anchoring): a `dependencies.py` at a
    nested non-canonical path MUST still fire LAYER-IMPORT-API. The
    composition-root exemption is anchored to the canonical
    `app/services/<svc>/api[/v1]/dependencies.py` shape via regex, NOT to
    any file ending in `dependencies.py`. Guards against silent over-
    exemption of deep-nested DI-helper files that share the filename but
    are NOT structural composition roots."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "app" / "services" / "x" / "feature" / "api" / "v1" / "dependencies.py",
        "from app.services.x.infrastructure.repository import XRepository\ndef nested_helper(): return XRepository()\n",
    )
    report = _run_scanner_in_tmp(proj, "--disable=canonical-entities,inline-imports,god-size,db-in-application")
    cats = {f["category"] for f in report["findings"]}
    assert "LAYER-IMPORT-API" in cats, "nested dependencies.py at non-canonical path MUST still fire LAYER-IMPORT-API"


def test_t3_free_text_suffix_fields_skipped(tmp_path: Path) -> None:
    """T3: fields ending in `_description`, `_label`, `_note`, `_comment`,
    `_text`, `_title` are human-readable strings, not canonical references.
    Must NOT emit MISSING-FK/MISSING-ENUM."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "app" / "services" / "x" / "application" / "dto.py",
        "class XDto:\n"
        "    scope_description: str = ''\n"
        "    country_label: str = ''\n"
        "    role_note: str = ''\n"
        "    role_comment: str = ''\n",
    )
    reg = proj / "canonical-entities.yaml"
    reg.write_text(
        "version: 1\n"
        "entities:\n"
        "  scope:\n"
        "    entity_status: ENUM\n"
        "    import_path: app.core.enums.RoleScope\n"
        "    triggers: [scope]\n"
        "    forbid_string_only: true\n"
        "  country:\n"
        "    entity_status: EXISTS\n"
        "    import_path: app.services.countries.domain.models.Country\n"
        "    canonical_file: app/services/countries/domain/models.py\n"
        "    triggers: [country]\n"
        "    forbid_string_only: true\n"
        "  role:\n"
        "    entity_status: EXISTS\n"
        "    import_path: app.services.identity.domain.models.Role\n"
        "    canonical_file: app/services/identity/domain/models.py\n"
        "    triggers: [role]\n"
        "    forbid_string_only: true\n"
    )
    report = _run_scanner_in_tmp(proj, "--canonical-only", f"--registry={reg}")
    bad_cats = {"CANONICAL-MISSING-FK", "CANONICAL-MISSING-ENUM"}
    bad = [f for f in report["findings"] if f["category"] in bad_cats]
    assert not bad, f"free-text suffix fields must be skipped, got: {bad}"


def test_t3_real_canonical_field_still_fires(tmp_path: Path) -> None:
    """T3 negative: a bare `country: str` (no suffix) MUST still fire
    MISSING-FK — the suffix-skip must be narrowly scoped."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "app" / "services" / "x" / "application" / "dto.py",
        "class XDto:\n    country: str = ''\n",
    )
    reg = proj / "canonical-entities.yaml"
    reg.write_text(
        "version: 1\n"
        "entities:\n"
        "  country:\n"
        "    entity_status: EXISTS\n"
        "    import_path: app.services.countries.domain.models.Country\n"
        "    canonical_file: app/services/countries/domain/models.py\n"
        "    triggers: [country]\n"
        "    forbid_string_only: true\n"
        "    allowed_fk_columns: [country_id]\n"
    )
    report = _run_scanner_in_tmp(proj, "--canonical-only", f"--registry={reg}")
    cats = {f["category"] for f in report["findings"]}
    assert "CANONICAL-MISSING-FK" in cats, "bare `country: str` MUST still fire"


def test_t4_sqlmodel_string_form_fk_does_not_orphan(tmp_path: Path) -> None:
    """T4: `Field(foreign_key="users.id")` is the idiomatic SQLModel cross-
    mapper FK — class import is NOT required (and would create circular deps).
    Must NOT fire CANONICAL-WIRING-ORPHAN."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "app" / "services" / "x" / "infrastructure" / "models.py",
        "from sqlmodel import Field, SQLModel\n"
        "class X(SQLModel, table=True):\n"
        "    id: int = Field(primary_key=True)\n"
        "    user_id: str = Field(foreign_key='users.id')\n",
    )
    reg = proj / "canonical-entities.yaml"
    reg.write_text(
        "version: 1\n"
        "entities:\n"
        "  user:\n"
        "    entity_status: EXISTS\n"
        "    import_path: app.services.identity.domain.models.User\n"
        "    canonical_file: app/services/identity/domain/models.py\n"
        "    triggers: [user]\n"
        "    allowed_fk_columns: [user_id]\n"
    )
    report = _run_scanner_in_tmp(proj, "--canonical-only", f"--registry={reg}")
    orphans = [f for f in report["findings"] if f["category"] == "CANONICAL-WIRING-ORPHAN"]
    assert not orphans, f"SQLModel string-form FK must be considered wired, got: {orphans}"


def test_t5_denylist_paths_suppresses_trigger_for_namespace(tmp_path: Path) -> None:
    """T5: `denylist_paths` glob on an entity must suppress its triggers for
    matching files. Validates the OAuth `scope` vs RBAC RoleScope separation."""
    proj = tmp_path / "proj"
    # File matching the denylist — must NOT fire
    _write_py(
        proj / "app" / "services" / "external_calling" / "application" / "dto.py",
        "class OAuthTokenResponse:\n    scope: str = ''\n",
    )
    # File NOT matching the denylist — MUST still fire
    _write_py(
        proj / "app" / "services" / "identity" / "application" / "dto.py",
        "class RoleResponse:\n    scope: str = ''\n",
    )
    reg = proj / "canonical-entities.yaml"
    reg.write_text(
        "version: 1\n"
        "entities:\n"
        "  scope:\n"
        "    entity_status: ENUM\n"
        "    import_path: app.core.enums.RoleScope\n"
        "    triggers: [scope]\n"
        "    forbid_string_only: true\n"
        '    denylist_paths: ["app/services/external_calling/**"]\n'
    )
    report = _run_scanner_in_tmp(proj, "--canonical-only", f"--registry={reg}")
    by_file = {f["file"] for f in report["findings"] if f["category"] == "CANONICAL-MISSING-ENUM"}
    assert "app/services/external_calling/application/dto.py" not in by_file, (
        "denylist_paths must suppress the trigger for matching files"
    )
    assert "app/services/identity/application/dto.py" in by_file, "denylist_paths must NOT leak to non-matching files"


def test_t6_pragma_disables_inline_imports_for_file(tmp_path: Path) -> None:
    """T6: `# arch-scan: allow inline-imports` at file head suppresses
    INLINE-IMPORT for that file only."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "exempt.py",
        "# arch-scan: allow inline-imports\ndef f():\n    import json\n    return json\n",
    )
    _write_py(
        proj / "normal.py",
        "def f():\n    import json\n    return json\n",
    )
    report = _run_scanner_in_tmp(proj, "--enable=inline-imports")
    by_file = {f["file"] for f in report["findings"] if f["category"] == "INLINE-IMPORT"}
    assert "exempt.py" not in by_file, "pragma must suppress INLINE-IMPORT in exempt.py"
    assert "normal.py" in by_file, "pragma must NOT leak; normal.py inline import must still fire"


def test_t7_pragma_disables_god_file(tmp_path: Path) -> None:
    """T7: `# arch-scan: allow god-file` suppresses GOD-FILE for that file."""
    proj = tmp_path / "proj"
    _write_py(
        proj / "huge_exempt.py",
        "# arch-scan: allow god-file\n" + ("x = 1\n" * 700),
    )
    _write_py(proj / "huge_normal.py", "x = 1\n" * 700)
    report = _run_scanner_in_tmp(proj, "--enable=god-size")
    files_with_god = {f["file"] for f in report["findings"] if f["category"] == "GOD-FILE"}
    assert "huge_exempt.py" not in files_with_god
    assert "huge_normal.py" in files_with_god


def test_t7_pragma_disables_god_class_independently(tmp_path: Path) -> None:
    """T7: `# arch-scan: allow god-class` suppresses GOD-CLASS but NOT
    GOD-FILE (each category gets its own opt-out)."""
    proj = tmp_path / "proj"
    methods = "\n".join(f"    def m{i}(self): pass" for i in range(30))
    _write_py(
        proj / "mixed.py",
        "# arch-scan: allow god-class\n" + ("x = 1\n" * 700) + f"\nclass C:\n{methods}\n",
    )
    report = _run_scanner_in_tmp(proj, "--enable=god-size")
    cats_for_file = {f["category"] for f in report["findings"] if f["file"] == "mixed.py"}
    assert "GOD-CLASS" not in cats_for_file, "god-class pragma must suppress GOD-CLASS"
    assert "GOD-FILE" in cats_for_file, "god-class pragma must NOT suppress GOD-FILE"


def test_t7_pragma_god_size_suppresses_both(tmp_path: Path) -> None:
    """T7: `# arch-scan: allow god-size` (detector name) suppresses both."""
    proj = tmp_path / "proj"
    methods = "\n".join(f"    def m{i}(self): pass" for i in range(30))
    _write_py(
        proj / "mixed.py",
        "# arch-scan: allow god-size\n" + ("x = 1\n" * 700) + f"\nclass C:\n{methods}\n",
    )
    report = _run_scanner_in_tmp(proj, "--enable=god-size")
    cats_for_file = {f["category"] for f in report["findings"] if f["file"] == "mixed.py"}
    assert not cats_for_file, f"god-size pragma must suppress both, got: {cats_for_file}"


def test_visitor_signals_carry_type_checking_split_field() -> None:
    """Unit-level: `VisitorSignals` MUST expose `type_checking_imports` as a
    distinct list. The orchestrator's `_Visitor` populates it; the end-to-end
    behavior is covered by `test_t1_type_checking_imports_do_not_fire_layer_violations`,
    this guards against accidental removal of the dataclass field."""
    sig = VisitorSignals()
    assert hasattr(sig, "type_checking_imports")
    assert sig.type_checking_imports == []
    assert hasattr(sig, "pragmas")
    assert sig.pragmas == frozenset()


def test_file_pragmas_helper_extracts_tokens() -> None:
    """Unit-level: `file_pragmas()` extracts every `arch-scan: allow X` token
    in the file head (case-insensitive, set semantics)."""
    from detectors import file_pragmas as _fp  # noqa: PLC0415

    src = '# arch-scan: allow inline-imports\n# arch-scan: allow GOD-FILE\n"""module docstring"""\n'
    tokens = _fp(src)
    assert tokens == frozenset({"inline-imports", "god-file"})

    # Empty file → empty set
    assert _fp("") == frozenset()
    # Pragma outside the scanned header is ignored (placed beyond line 30)
    deep = ("\n" * 50) + "# arch-scan: allow god-file\n"
    assert _fp(deep) == frozenset()


def test_detector_error_includes_traceback(tmp_path: Path) -> None:
    """I4 regression: when a detector crashes, the DETECTOR-ERROR finding must
    include the full traceback in the `detail` field — operators shouldn't
    have to re-run with prints to debug detector crashes."""
    ext_dir = tmp_path / "ext"
    ext_dir.mkdir()
    (ext_dir / "crasher.py").write_text(
        "import sys\n"
        f"sys.path.insert(0, {str(RULES)!r})\n"
        "from detectors import register\n"
        "class Crasher:\n"
        "    name = 'crasher-test'\n"
        "    categories = ('CRASH',)\n"
        "    severities = ('low',)\n"
        "    def run(self, ctx):\n"
        "        raise RuntimeError('deliberate test crash')\n"
        "register(Crasher())\n"
    )
    # Limit to a single file so we get exactly 1 DETECTOR-ERROR row.
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "only.py").write_text("x = 1\n")
    result = subprocess.run(
        [
            sys.executable,
            str(SCANNER),
            "--enable=crasher-test",
            f"--detector-path={ext_dir}",
            "--json",
            f"--root={proj}",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    d = json.loads(result.stdout)
    errs = [f for f in d["findings"] if f["category"] == "DETECTOR-ERROR"]
    assert errs, f"expected DETECTOR-ERROR finding, got: {d['findings'][:3]}"
    err = errs[0]
    assert "RuntimeError" in err["message"], f"message should name the exception type, got: {err['message']!r}"
    assert "Traceback" in err.get("detail", ""), f"detail should include traceback, got: {err.get('detail', '')!r}"
    assert "deliberate test crash" in err["detail"], "detail should include the original exception message"
