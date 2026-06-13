#!/usr/bin/env python3
"""Pluggable architecture scanner for Python/FastAPI Clean Architecture projects.

This script is a thin **orchestrator**. It does not contain detection logic
itself — every detection rule lives in a standalone module under
``detectors/`` and registers itself via the ``@register`` decorator.

Stdlib-only at the orchestrator level. Individual detectors may declare
optional third-party dependencies (e.g. ``canonical-entities`` uses PyYAML
when the registry is YAML; falls back to JSON otherwise).

Built-in detectors (shipped with the devt plugin):

  LAYER-IMPORT-DOMAIN          domain/ depending on application/infrastructure/api/
  LAYER-IMPORT-API             api/ reaching past application/ into infrastructure/
  DB-IN-APPLICATION            application/ importing Session/select/SQLModel primitives
  INLINE-IMPORT                function-body import (circular-dependency smell)
  GOD-FILE                     file longer than --max-file-lines (default 600)
  GOD-CLASS                    class with more than --max-class-methods methods (default 25)
  CANONICAL-MISSING-FK         concept-named field with no FK to canonical entity
  CANONICAL-WRONG-OWNER        FK to a forbidden owner (e.g. settings on User not Client)
  CANONICAL-OWNERSHIP-MISSING  no FK to required canonical owner
  CANONICAL-ENTITY-MISSING     trigger fires but canonical entity does not exist yet
  CANONICAL-WIRING-ORPHAN      FK declared but file does not import the entity
  CANONICAL-DUPLICATE-ENTITY   canonical entity name redefined outside its module

Add a new detector by dropping a file into ``.devt/rules/detectors/`` — no
edits here required. See ``detectors/__init__.py`` for the protocol.

Designed to be wired into devt's /devt:review --focus=arch workflow via .devt/config.json:

  "arch_scanner": {
    "command": "python3 .devt/rules/arch-scan.py --json",
    "report_dir": "docs/reports"
  }

Stdout is the report; stderr is human-readable progress. With --json, stdout
is a single JSON document the architect agent parses into findings.
"""
# ruff: noqa: T201  -- this is a CLI tool; stdout/stderr prints are the public surface

from __future__ import annotations

import argparse
import ast
import json
import subprocess
import sys
import traceback
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

# Make `detectors/` importable when arch-scan.py runs from its own directory
# (the common case both in the devt template and after seeding into a project).
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from detectors import (  # noqa: E402
    Detector,
    Finding,
    ScanContext,
    VisitorSignals,
    all_detectors,
    file_pragmas,
)
from detectors._graph_index import GraphIndex  # noqa: E402
from detectors._registry_loader import load_registry  # noqa: E402

if TYPE_CHECKING:  # pragma: no cover
    from typing import TextIO


# ---------------------------------------------------------------------------
# Report + scan helpers
# ---------------------------------------------------------------------------

LAYERS = ("domain", "application", "infrastructure", "api")
SCANNER_NAME = "devt-python-arch-scan"
SCANNER_VERSION = "2.0"

# Categories emitted by the orchestrator itself (not by any detector). They
# represent scanner-internal failures and MUST NOT be written into the baseline
# — otherwise a broken detector becomes silently absorbed forever.
_INTERNAL_CATEGORIES = frozenset({"SCAN-ERROR", "DETECTOR-ERROR"})


@dataclass
class ScanReport:
    """Top-level scan result. Mirrors the JSON payload produced by ``--json``.

    Kept as a typed dataclass (not a raw dict) so downstream tooling and the
    test suite can inspect runs without stringly-keyed access.
    """

    scanner: str = SCANNER_NAME
    version: str = SCANNER_VERSION
    scanned_files: int = 0
    detectors_loaded: list[str] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    raw_finding_count: int = 0
    baseline_filtered: int = 0

    def to_dict(self) -> dict:
        return {
            "scanner": self.scanner,
            "version": self.version,
            "scanned_files": self.scanned_files,
            "detectors_loaded": list(self.detectors_loaded),
            "findings": [asdict(f) for f in self.findings],
            "raw_finding_count": self.raw_finding_count,
            "baseline_filtered": self.baseline_filtered,
        }


def _is_type_checking_guard(test: ast.expr) -> bool:
    """Return True when ``test`` is ``TYPE_CHECKING`` or ``<mod>.TYPE_CHECKING``.

    Recognises the two idiomatic spellings::

        if TYPE_CHECKING:            # from typing import TYPE_CHECKING
        if typing.TYPE_CHECKING:     # import typing
    """
    if isinstance(test, ast.Name):
        return test.id == "TYPE_CHECKING"
    if isinstance(test, ast.Attribute):
        return test.attr == "TYPE_CHECKING"
    return False


class _Visitor(ast.NodeVisitor):
    """Single-pass AST walker that fills a VisitorSignals bundle.

    Tracks two independent scope flags:
      * ``_depth``        > 0 → inside a function body (drives ``inline_imports``)
      * ``_tc_depth``     > 0 → inside an ``if TYPE_CHECKING:`` block
                                  (TYPE_CHECKING imports never execute, so they
                                  are diverted to ``type_checking_imports``
                                  rather than ``imports``)
    """

    def __init__(self, signals: VisitorSignals) -> None:
        self.signals = signals
        self._depth = 0
        self._tc_depth = 0

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            mod = alias.name
            if self._tc_depth > 0:
                self.signals.type_checking_imports.append((node.lineno, mod))
                continue
            if self._depth > 0:
                self.signals.inline_imports.append((node.lineno, mod))
            self.signals.imports.append((node.lineno, mod))
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        mod = node.module or ""
        if self._tc_depth > 0:
            # TYPE_CHECKING-guarded imports never execute. Mirror visit_Import
            # by routing the module to `type_checking_imports` only and NOT
            # populating `imported_names` — otherwise downstream detectors
            # that read `imported_names` (db_in_application) would treat a
            # type-only `from sqlmodel import Session` as a runtime use.
            self.signals.type_checking_imports.append((node.lineno, mod))
            self.generic_visit(node)
            return
        if self._depth > 0:
            self.signals.inline_imports.append((node.lineno, mod))
        self.signals.imports.append((node.lineno, mod))
        for alias in node.names:
            self.signals.imported_names.append((node.lineno, mod, alias.name))
        self.generic_visit(node)

    def visit_If(self, node: ast.If) -> None:
        # Only the True-branch of ``if TYPE_CHECKING:`` carries the guarded
        # imports. The Else-branch (rare) is normal runtime code.
        if _is_type_checking_guard(node.test):
            self._tc_depth += 1
            for child in node.body:
                self.visit(child)
            self._tc_depth -= 1
            for child in node.orelse:
                self.visit(child)
            return
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._depth += 1
        self.generic_visit(node)
        self._depth -= 1

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._depth += 1
        self.generic_visit(node)
        self._depth -= 1

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        methods = sum(1 for child in node.body if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)))
        self.signals.classes.append((node.lineno, node.name, methods))
        self.generic_visit(node)


def _detect_layer(rel_path: Path) -> str | None:
    for part in rel_path.parts:
        if part in LAYERS:
            return part
    return None


def _detect_service(rel_path: Path, service_root: tuple[str, ...]) -> str | None:
    parts = rel_path.parts
    rl = len(service_root)
    if len(parts) <= rl or parts[:rl] != service_root:
        return None
    return parts[rl]


def _iter_python_files(root: Path) -> Iterable[Path]:
    skip = {
        ".venv",
        "venv",
        ".tox",
        "__pycache__",
        ".git",
        "node_modules",
        "build",
        "dist",
        ".devt",
        ".history",  # VSCode local-history snapshots
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "site-packages",
    }
    for path in root.rglob("*.py"):
        if any(part in skip for part in path.parts):
            continue
        yield path


# ---------------------------------------------------------------------------
# Baseline + report
# ---------------------------------------------------------------------------


def _finding_key(f: Finding) -> tuple[str, str, int, str]:
    return (f.category, f.file, f.line, f.fingerprint)


def _load_baseline(path: Path) -> set[tuple[str, str, int, str]]:
    """Parse a baseline file into a set of finding keys.

    Tolerant: malformed JSON, non-mapping entries, and bad ``line`` values
    (None / non-int) all produce a stderr warning and either skip the entry
    or treat the value as 0. A baseline that crashes the scanner with a bare
    traceback is worse than an empty baseline.
    """
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(
            f"warning: baseline at {path} is malformed: {exc}; treating as empty",
            file=sys.stderr,
        )
        return set()
    if not isinstance(data, dict):
        print(
            f"warning: baseline at {path} top-level is not a mapping; treating as empty",
            file=sys.stderr,
        )
        return set()
    entries = data.get("entries") or []
    keys: set[tuple[str, str, int, str]] = set()
    skipped = 0
    for e in entries:
        if not isinstance(e, dict):
            skipped += 1
            continue
        line_raw = e.get("line", 0)
        try:
            line_num = int(line_raw or 0)
        except (TypeError, ValueError):
            skipped += 1
            continue
        keys.add(
            (
                str(e.get("category", "")),
                str(e.get("file", "")),
                line_num,
                str(e.get("fingerprint", "")),
            )
        )
    if skipped:
        print(
            f"warning: baseline at {path} had {skipped} malformed entry(s); ignored",
            file=sys.stderr,
        )
    return keys


def _write_baseline(path: Path, findings: list[Finding], commit: str | None) -> None:
    payload = {
        "scanner": SCANNER_NAME,
        "version": SCANNER_VERSION,
        "created_at": datetime.now(UTC).isoformat(),
        "created_at_commit": commit,
        "entries": [
            {
                "category": f.category,
                "file": f.file,
                "line": f.line,
                "fingerprint": f.fingerprint,
                "message": f.message,
            }
            for f in findings
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _write_report(path: Path, findings: list[Finding], registry: dict | None) -> None:
    by_entity: dict[str, list[Finding]] = {}
    for f in findings:
        # Bucket by entity_key embedded in fingerprint when present, else by category.
        key = f.fingerprint.split(":", 1)[0] if ":" in f.fingerprint else f.category
        by_entity.setdefault(key, []).append(f)

    by_severity: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings:
        by_severity[f.severity] = by_severity.get(f.severity, 0) + 1

    lines: list[str] = []
    lines.append("# Canonical Entity Drift Report")
    lines.append("")
    lines.append(f"Generated: {datetime.now(UTC).isoformat()}")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(
        f"- {by_severity['critical']} critical, "
        f"{by_severity['high']} high, "
        f"{by_severity['medium']} medium, "
        f"{by_severity['low']} low "
        f"— {len(findings)} total findings"
    )
    lines.append("")

    lines.append("## Findings by entity")
    lines.append("")
    if not findings:
        lines.append("No findings. Architecture is clean against the canonical registry.")
        lines.append("")
    else:
        registry_entities = (registry or {}).get("entities") or {}
        for key in sorted(by_entity):
            entity_status = ""
            ent = registry_entities.get(key)
            # Defensive: even though _registry_loader drops malformed entries,
            # avoid AttributeError if a non-mapping leaks through.
            if isinstance(ent, dict):
                entity_status = f" ({ent.get('entity_status', 'EXISTS')})"
            lines.append(f"### {key}{entity_status}")
            lines.append("")
            for f in sorted(by_entity[key], key=lambda x: (x.severity, x.file, x.line)):
                lines.append(f"- **{f.severity.upper()}** `{f.file}:{f.line}` [{f.category}] {f.message}")
                if f.detail:
                    lines.append(f"  - {f.detail}")
            lines.append("")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def _scan_file(
    file_path: Path,
    project_root: Path,
    service_root: tuple[str, ...],
    registry: dict | None,
    graph: GraphIndex | None,
    config: dict,
    detectors: list[Detector],
) -> list[Finding]:
    rel = file_path.relative_to(project_root)
    try:
        source = file_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [
            Finding(
                category="SCAN-ERROR",
                severity="low",
                file=str(rel),
                line=0,
                message=f"could not read file: {exc}",
            )
        ]
    try:
        tree = ast.parse(source, filename=str(file_path))
    except SyntaxError as exc:
        return [
            Finding(
                category="SCAN-ERROR",
                severity="low",
                file=str(rel),
                line=exc.lineno or 0,
                message=f"syntax error: {exc.msg}",
            )
        ]

    signals = VisitorSignals(
        source_lines=source.count("\n") + 1,
        pragmas=file_pragmas(source),
    )
    _Visitor(signals).visit(tree)

    ctx = ScanContext(
        project_root=project_root,
        rel_path=rel,
        tree=tree,
        source=source,
        signals=signals,
        layer=_detect_layer(rel),
        service=_detect_service(rel, service_root),
        registry=registry,
        graph=graph,
        config=config,
    )

    findings: list[Finding] = []
    for det in detectors:
        try:
            findings.extend(det.run(ctx))
        except Exception as exc:  # noqa: BLE001 — detector isolation
            findings.append(
                Finding(
                    category="DETECTOR-ERROR",
                    severity="low",
                    file=str(rel),
                    line=0,
                    message=(f"detector {det.name!r} crashed: {type(exc).__name__}: {exc}"),
                    # Full traceback in detail so the operator doesn't have
                    # to re-run with manual prints to debug detector crashes.
                    detail=traceback.format_exc().strip(),
                )
            )
    return findings


def _emit_text(findings: list[Finding], scanned: int, stream: TextIO) -> None:
    if not findings:
        print(f"OK — scanned {scanned} files, no findings.", file=stream)
        return
    by_sev: dict[str, list[Finding]] = {}
    for f in findings:
        by_sev.setdefault(f.severity, []).append(f)
    print(f"Architecture scan — {scanned} files, {len(findings)} findings", file=stream)
    print("", file=stream)
    for sev in ("critical", "high", "medium", "low"):
        items = by_sev.get(sev, [])
        if not items:
            continue
        print(f"[{sev.upper()}] {len(items)} finding(s)", file=stream)
        for f in items:
            print(f"  {f.file}:{f.line} [{f.category}] {f.message}", file=stream)
            if f.detail:
                print(f"    -> {f.detail}", file=stream)
        print("", file=stream)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Pluggable Python/FastAPI architecture scanner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--root", default=".", help="Project root (default: cwd)")
    parser.add_argument(
        "--service-root",
        default="app/services",
        help="Slash-separated path under root where services live "
        "(default: app/services). Empty string disables service grouping.",
    )
    parser.add_argument("--max-file-lines", type=int, default=600)
    parser.add_argument("--max-class-methods", type=int, default=25)
    parser.add_argument(
        "--disable",
        default="",
        help=(
            "Comma-separated detector names AND/OR category names to skip. "
            "Detector names disable a detector before it runs (no findings "
            "emitted). Category names filter findings after the run, so a "
            "multi-category detector (e.g. god-size emits GOD-FILE+GOD-CLASS) "
            "can have just one of its categories silenced."
        ),
    )
    parser.add_argument(
        "--enable",
        default="",
        help="Comma-separated detector names — exclusive allowlist (overrides --disable when set)",
    )
    parser.add_argument(
        "--canonical-only",
        action="store_true",
        help="Run only the canonical-entities detector (shortcut for --enable=canonical-entities)",
    )
    parser.add_argument(
        "--registry",
        default="",
        help="Path to canonical-entities.yaml (default: .devt/rules/canonical-entities.yaml under --root)",
    )
    parser.add_argument(
        "--baseline",
        default="",
        help="Path to baseline JSON; suppress findings already in it",
    )
    parser.add_argument(
        "--write-baseline",
        default="",
        help="Emit current findings as a baseline file at this path (does not filter)",
    )
    parser.add_argument(
        "--report",
        default="",
        help="Write a Markdown summary report to this path",
    )
    parser.add_argument(
        "--detector-path",
        default="",
        help="Alternate directory for detector plugin discovery",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON report to stdout (text summary to stderr)",
    )
    parser.add_argument(
        "--fail-on",
        default="critical,high",
        help="Severities that cause non-zero exit (default: critical,high)",
    )
    args = parser.parse_args(argv)

    project_root = Path(args.root).resolve()
    if not project_root.is_dir():
        print(f"error: --root not a directory: {project_root}", file=sys.stderr)
        return 2

    # Load detectors
    detector_path = Path(args.detector_path) if args.detector_path else None
    all_dets = all_detectors(detector_path)

    # Apply --enable / --canonical-only / --disable filtering.
    #
    # Disable semantics — split into two paths so users get exactly what they
    # asked for:
    #   * NAME match  → drop the detector BEFORE it runs (no work done)
    #   * CATEGORY match → run the detector, filter its output AFTER, so other
    #     categories from the same detector still flow (matches backup
    #     behaviour where --disable=GOD-FILE kept GOD-CLASS).
    enabled_set = {n.strip() for n in args.enable.split(",") if n.strip()}
    if args.canonical_only:
        enabled_set = {"canonical-entities"}
    raw_disabled = {n.strip() for n in args.disable.split(",") if n.strip()}

    all_names = {d.name for d in all_dets}
    all_categories = {c for d in all_dets for c in d.categories} | _INTERNAL_CATEGORIES
    disabled_names = raw_disabled & all_names
    disabled_categories = raw_disabled - all_names

    # ---- Warn on unknown tokens so typos don't silently no-op ----
    unknown_disabled = disabled_categories - all_categories
    if unknown_disabled:
        print(
            f"warning: --disable token(s) not recognized as detector names or "
            f"categories: {sorted(unknown_disabled)}. "
            f"Known detectors: {sorted(all_names)}. "
            f"Known categories: {sorted(all_categories)}.",
            file=sys.stderr,
        )
    unknown_enabled = enabled_set - all_names
    if unknown_enabled:
        print(
            f"warning: --enable token(s) not recognized as detector names: "
            f"{sorted(unknown_enabled)}. Known detectors: {sorted(all_names)}.",
            file=sys.stderr,
        )

    if enabled_set:
        detectors = [d for d in all_dets if d.name in enabled_set]
    else:
        detectors = [d for d in all_dets if d.name not in disabled_names]

    # Load registry (only if canonical-entities is active). Try .yaml first,
    # then .json with the same stem; the loader handles missing PyYAML and
    # malformed inputs by returning None.
    registry: dict | None = None
    if any(d.name == "canonical-entities" for d in detectors):
        if args.registry:
            registry = load_registry(Path(args.registry))
        else:
            base = project_root / ".devt" / "rules" / "canonical-entities"
            for candidate in (base.with_suffix(".yaml"), base.with_suffix(".json")):
                registry = load_registry(candidate)
                if registry is not None:
                    break

    # ---- Lazy graph load: only pay the I/O cost when an active detector
    # declares it needs the graph via `needs_graph = True`. Detectors without
    # the attribute default to False. The 45MB graph.json read + git-rev-parse
    # subprocess is non-trivial; skipping it when nothing consumes it is free.
    graph: GraphIndex | None = None
    if any(getattr(d, "needs_graph", False) for d in detectors):
        graph = GraphIndex.load(project_root)

    # Config bag passed to every detector
    config = {
        "max_file_lines": args.max_file_lines,
        "max_class_methods": args.max_class_methods,
    }

    service_root = tuple(p for p in args.service_root.strip("/").split("/") if p)

    findings: list[Finding] = []
    scanned = 0
    for file_path in _iter_python_files(project_root):
        scanned += 1
        findings.extend(
            _scan_file(
                file_path=file_path,
                project_root=project_root,
                service_root=service_root,
                registry=registry,
                graph=graph,
                config=config,
                detectors=detectors,
            )
        )

    # `findings` so far is the RAW detector output — needed by --write-baseline
    # so a `--disable=CAT --write-baseline=...` combo doesn't strip CAT findings
    # from the baseline (which would then resurface them as "new" on a plain
    # rerun without --disable).
    raw_findings = findings

    # ---- write-baseline FIRST so it sees the raw output ----
    if args.write_baseline:
        try:
            commit = subprocess.check_output(
                ["git", "rev-parse", "HEAD"],
                cwd=project_root,
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            commit = None
        # Exclude scanner-internal categories (SCAN-ERROR, DETECTOR-ERROR) —
        # baselining them masks scanner bugs forever.
        baseline_input = [f for f in raw_findings if f.category not in _INTERNAL_CATEGORIES]
        _write_baseline(Path(args.write_baseline), baseline_input, commit)
        skipped = len(raw_findings) - len(baseline_input)
        note = f" ({skipped} internal finding(s) excluded)" if skipped else ""
        print(
            f"wrote baseline with {len(baseline_input)} entries to {args.write_baseline}{note}",
            file=sys.stderr,
        )

    # ---- category-level --disable: drops finding ROWS (post-detector) ----
    findings = (
        [f for f in raw_findings if f.category not in disabled_categories] if disabled_categories else raw_findings
    )

    # ---- baseline filtering for display/exit-code ----
    baseline_keys: set[tuple[str, str, int, str]] = set()
    if args.baseline:
        baseline_keys = _load_baseline(Path(args.baseline))

    filtered = [f for f in findings if _finding_key(f) not in baseline_keys] if baseline_keys else findings

    if args.report:
        # Write post-baseline `filtered` so the Markdown report agrees with the
        # JSON output and the CI exit code. Writing raw `findings` here would
        # surface baselined debt as if it were live drift.
        _write_report(Path(args.report), filtered, registry)
        print(f"wrote report to {args.report}", file=sys.stderr)

    report = ScanReport(
        scanned_files=scanned,
        detectors_loaded=[d.name for d in detectors],
        findings=filtered,
        raw_finding_count=len(findings),
        baseline_filtered=len(findings) - len(filtered),
    )

    if args.json:
        json.dump(report.to_dict(), sys.stdout, indent=2)
        sys.stdout.write("\n")
        _emit_text(filtered, scanned, sys.stderr)
    else:
        _emit_text(filtered, scanned, sys.stdout)

    fail_sev = {s.strip() for s in args.fail_on.split(",") if s.strip()}
    if any(f.severity in fail_sev for f in filtered):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
