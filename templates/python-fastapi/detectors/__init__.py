"""Plugin registry for arch-scan.py detectors.

Each detector lives in its own module under this package and registers itself
at import time via the :func:`register` decorator. ``all_detectors()`` walks
the package, auto-imports every public module, and returns the populated
registry in alphabetical order by detector ``name``.

Adding a new detector:

    # .devt/rules/detectors/my_detector.py
    from . import Detector, ScanContext, Finding, register

    class MyDetector:
        name = "my-detector"
        categories = ("MY-CATEGORY",)
        severities = ("medium",)

        def run(self, ctx: ScanContext) -> list[Finding]:
            ...
            return findings

    register(MyDetector())

No edits to ``arch-scan.py`` are required. The orchestrator passes a fully
populated :class:`ScanContext` (parsed AST, pre-walked visitor, layer/service,
canonical-entity registry, Graphify index, CLI config) to every detector.

Modules whose name starts with an underscore are ignored by auto-discovery
(treat them as internal helpers, e.g. ``_graph_index.py``).
"""

from __future__ import annotations

import ast
import importlib
import importlib.util
import pkgutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ._graph_index import GraphIndex
else:  # runtime placeholder so the annotation evaluates without the import
    GraphIndex = Any  # type: ignore[assignment,misc]


# ---------------------------------------------------------------------------
# Finding model — single source of truth shared with arch-scan.py
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    """One architectural finding emitted by a detector."""

    category: str
    severity: str  # "critical" | "high" | "medium" | "low"
    file: str
    line: int
    message: str
    detail: str = ""
    fingerprint: str = ""  # optional extra discriminator for baseline matching


# ---------------------------------------------------------------------------
# Visitor signal bundle — pre-computed once per file, shared across detectors
# ---------------------------------------------------------------------------


@dataclass
class VisitorSignals:
    """AST signals collected once per file by the orchestrator.

    Shared across detectors so each file is walked once, not once per detector.
    Detectors that need richer AST data can also walk ``ScanContext.tree``
    directly.

    ``imports`` is the set of RUNTIME imports — i.e. excluding imports that
    live inside an ``if TYPE_CHECKING:`` guard. TYPE_CHECKING-guarded imports
    land in ``type_checking_imports`` instead so detectors can opt in.
    """

    source_lines: int = 0
    imports: list[tuple[int, str]] = field(default_factory=list)
    imported_names: list[tuple[int, str, str]] = field(default_factory=list)
    inline_imports: list[tuple[int, str]] = field(default_factory=list)
    type_checking_imports: list[tuple[int, str]] = field(default_factory=list)
    classes: list[tuple[int, str, int]] = field(default_factory=list)
    pragmas: frozenset[str] = field(default_factory=frozenset)


# ---------------------------------------------------------------------------
# Scan context passed to every detector
# ---------------------------------------------------------------------------


@dataclass
class ScanContext:
    """Per-file context handed to each detector's ``run()`` method."""

    project_root: Path
    rel_path: Path
    tree: ast.AST
    source: str
    signals: VisitorSignals
    layer: str | None
    service: str | None
    registry: dict | None
    graph: GraphIndex | None
    config: dict


# ---------------------------------------------------------------------------
# Detector protocol + registry
# ---------------------------------------------------------------------------


@runtime_checkable
class Detector(Protocol):
    """Protocol every detector must satisfy.

    Detectors are duck-typed — no inheritance required, just attributes and
    a ``run(ctx)`` method.
    """

    name: str
    categories: tuple[str, ...]
    severities: tuple[str, ...]

    def run(self, ctx: ScanContext) -> list[Finding]: ...


_REGISTRY: dict[str, Detector] = {}


def register(detector: Detector) -> Detector:
    """Register a detector. Used as a decorator or as a plain function call.

    Raises ValueError on duplicate names so silent overrides are impossible.
    """
    if not isinstance(detector, Detector):
        raise TypeError(f"object does not implement the Detector protocol: {detector!r}")
    if detector.name in _REGISTRY:
        raise ValueError(
            f"duplicate detector name: {detector.name!r} (already registered: {_REGISTRY[detector.name]!r})"
        )
    _REGISTRY[detector.name] = detector
    return detector


def all_detectors(detector_path: Path | None = None) -> list[Detector]:
    """Auto-import every detector module then return the populated registry.

    ``detector_path``:
      * ``None`` → load built-in detectors from this package.
      * ``Path`` → ALSO load any ``*.py`` in that directory (in addition to
        built-ins). External detectors are loaded via spec-from-file-location
        under a synthetic ``_external_detectors.<name>`` namespace so they
        don't collide with built-ins of the same name.

    Modules whose name starts with an underscore are skipped (treated as
    internal helpers). Returns detectors sorted alphabetically by ``name`` for
    deterministic execution order.
    """
    # Always load built-ins from the package itself.
    pkg_path = Path(__file__).parent
    for mod in pkgutil.iter_modules([str(pkg_path)]):
        if mod.name.startswith("_"):
            continue
        importlib.import_module(f"{__package__}.{mod.name}")

    # Optionally load external detectors from an arbitrary directory.
    if detector_path is not None:
        ext_path = Path(detector_path).resolve()
        if ext_path.is_dir():
            for mod_info in pkgutil.iter_modules([str(ext_path)]):
                if mod_info.name.startswith("_"):
                    continue
                py_file = ext_path / f"{mod_info.name}.py"
                if not py_file.is_file():
                    continue
                synthetic_name = f"_external_detectors.{mod_info.name}"
                spec = importlib.util.spec_from_file_location(synthetic_name, py_file)
                if spec is None or spec.loader is None:
                    continue
                module = importlib.util.module_from_spec(spec)
                # Register before exec so the module's `from . import ...`
                # (relative imports) can find sibling helpers if needed.
                sys.modules[synthetic_name] = module
                spec.loader.exec_module(module)

    return sorted(_REGISTRY.values(), key=lambda d: d.name)


def clear_registry() -> None:
    """Reset the registry. Test-only helper; not used at runtime."""
    _REGISTRY.clear()


# ---------------------------------------------------------------------------
# Pragma helper — file-level opt-out from detector categories
# ---------------------------------------------------------------------------


import re as _re  # noqa: E402

_PRAGMA_RE = _re.compile(r"#\s*arch-scan:\s*allow\s+([A-Za-z0-9_\-]+)")
_PRAGMA_SCAN_LINES = 30  # how many leading lines to scan; pragmas belong at file head


def file_pragmas(source: str) -> frozenset[str]:
    """Extract ``# arch-scan: allow <token>`` pragmas from a file's header.

    Mirrors the precedent of ``# noqa`` and ``# type: ignore`` — operators
    declare detector opt-outs at the top of the file (first 30 lines) and
    detectors honour them. ``<token>`` is matched case-insensitively and
    can be either a category (``GOD-FILE``) or a detector name
    (``inline-imports``) — each detector decides which tokens it honours.

    Returns a frozenset of lowercased tokens. Empty if nothing matched.
    """
    head = "\n".join(source.splitlines()[:_PRAGMA_SCAN_LINES])
    return frozenset(m.group(1).lower() for m in _PRAGMA_RE.finditer(head))


__all__ = [
    "Detector",
    "Finding",
    "GraphIndex",
    "ScanContext",
    "VisitorSignals",
    "all_detectors",
    "clear_registry",
    "file_pragmas",
    "register",
]
