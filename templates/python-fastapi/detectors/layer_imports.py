"""Detector: Clean-Architecture layer-import violations.

Two categories:
  * LAYER-IMPORT-DOMAIN — domain layer imports application/infrastructure/api.
  * LAYER-IMPORT-API    — api layer reaches past application into infrastructure.

Domain must depend on nothing. API must go through application services, not
directly into infrastructure repositories.

Acceptable cross-layer references this detector deliberately ignores:

* Imports inside ``if TYPE_CHECKING:`` blocks — pure type hints, never
  execute, no runtime coupling. Routed to ``signals.type_checking_imports``
  by the orchestrator's Visitor and excluded from ``signals.imports``.
* The FastAPI **composition root** files ``api/dependencies.py`` and
  ``api/v1/dependencies.py``. By design these wire concrete repository
  implementations into the DI container so route handlers can request an
  abstract interface. Without this exemption the very mechanism that keeps
  routes decoupled from infrastructure would itself be flagged.
"""

from __future__ import annotations

import re

from . import Finding, ScanContext, register

_FORBIDDEN_FOR_DOMAIN = ("application", "infrastructure", "api")

# Composition-root files allowed to import infrastructure for DI wiring.
# Matched on relative-path suffix (works for both ``api/dependencies.py`` and
# the versioned ``api/v1/dependencies.py`` variant). Matched as a structural
# path-prefix anchor on the canonical service-tree shape so a nested
# ``app/services/<svc>/feature/api/v1/dependencies.py`` (NOT a composition root)
# does not get accidentally exempted — only ``app/services/<svc>/api/...`` is.
_COMPOSITION_ROOT_PATTERNS = (
    re.compile(r"^app/services/[^/]+/api/dependencies\.py$"),
    re.compile(r"^app/services/[^/]+/api/v1/dependencies\.py$"),
)


def _is_composition_root(rel: str) -> bool:
    """Return True iff ``rel`` is the canonical FastAPI DI composition root.

    Uses a path-prefix anchor instead of ``str.endswith()`` so files at deeper
    paths named ``dependencies.py`` are NOT exempted from LAYER-IMPORT-API
    enforcement — only ``app/services/<svc>/api[/v1]/dependencies.py``.
    """
    return any(pattern.match(rel) for pattern in _COMPOSITION_ROOT_PATTERNS)


class LayerImportsDetector:
    name = "layer-imports"
    categories = ("LAYER-IMPORT-DOMAIN", "LAYER-IMPORT-API")
    severities = ("critical", "high")

    def run(self, ctx: ScanContext) -> list[Finding]:
        layer = ctx.layer
        if not layer:
            return []
        findings: list[Finding] = []
        rel = str(ctx.rel_path)

        if layer == "domain":
            for lineno, mod in ctx.signals.imports:
                parts = mod.split(".")
                for forbidden in _FORBIDDEN_FOR_DOMAIN:
                    if any(p == forbidden for p in parts):
                        findings.append(
                            Finding(
                                category="LAYER-IMPORT-DOMAIN",
                                severity="critical",
                                file=rel,
                                line=lineno,
                                message=f"domain layer imports from '{forbidden}' layer",
                                detail=(f"import target: {mod}. Domain must depend on nothing."),
                            )
                        )
                        break  # one finding per import line
        elif layer == "api":
            # api/dependencies.py is the FastAPI DI composition root — it is
            # allowed (and architecturally required) to wire concrete repos.
            if _is_composition_root(rel):
                return findings
            for lineno, mod in ctx.signals.imports:
                if any(p == "infrastructure" for p in mod.split(".")):
                    findings.append(
                        Finding(
                            category="LAYER-IMPORT-API",
                            severity="high",
                            file=rel,
                            line=lineno,
                            message="api layer imports directly from infrastructure",
                            detail=(f"import target: {mod}. Route handlers should call services, not repositories."),
                        )
                    )
        return findings


register(LayerImportsDetector())
