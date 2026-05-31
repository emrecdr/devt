"""Detector: imports inside function bodies (circular-dependency smell).

Honoured opt-outs:

* File-level pragma at the top of the file:

      # arch-scan: allow inline-imports

  Use for bootstrap/feature-toggle modules where lazy imports are intentional
  (e.g. ``register_routers()`` gating sub-routers by ``Services.AUTH``, ordered
  SQLModel mapper init in ``database.py``, OTEL bootstrap order).
"""

from __future__ import annotations

from . import Finding, ScanContext, register

_PRAGMA_TOKENS = frozenset({"inline-imports", "inline-import"})


class InlineImportsDetector:
    name = "inline-imports"
    categories = ("INLINE-IMPORT",)
    severities = ("medium",)

    def run(self, ctx: ScanContext) -> list[Finding]:
        if ctx.signals.pragmas & _PRAGMA_TOKENS:
            return []
        rel = str(ctx.rel_path)
        return [
            Finding(
                category="INLINE-IMPORT",
                severity="medium",
                file=rel,
                line=lineno,
                message=f"inline import inside function body: '{mod}'",
                detail=(
                    "Inline imports usually mask circular dependencies. Move "
                    "to module top, or refactor to break the cycle. If the "
                    "lazy import is intentional, add `# arch-scan: allow "
                    "inline-imports` at the top of the file."
                ),
            )
            for lineno, mod in ctx.signals.inline_imports
        ]


register(InlineImportsDetector())
