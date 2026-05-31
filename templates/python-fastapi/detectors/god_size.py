"""Detector: god files and god classes.

Two categories sharing one detector because both come from the same visitor
signals.

Thresholds are tunable per project via CLI flags:
    --max-file-lines      (default 600)
    --max-class-methods   (default 25)

Honoured opt-outs (file-level pragmas at the top of the file):

    # arch-scan: allow god-file      → suppress GOD-FILE for this file
    # arch-scan: allow god-class     → suppress GOD-CLASS for this file
    # arch-scan: allow god-size      → suppress both categories

Use for files where size is intrinsic to purpose (coverage-gate test files,
generated migrations, vendored scanners) — never for "I'll get to it later".
"""

from __future__ import annotations

from . import Finding, ScanContext, register

_PRAGMA_FILE = frozenset({"god-file", "god-size"})
_PRAGMA_CLASS = frozenset({"god-class", "god-size"})


class GodSizeDetector:
    name = "god-size"
    categories = ("GOD-FILE", "GOD-CLASS")
    severities = ("medium",)

    def run(self, ctx: ScanContext) -> list[Finding]:
        rel = str(ctx.rel_path)
        findings: list[Finding] = []
        pragmas = ctx.signals.pragmas
        suppress_file = bool(pragmas & _PRAGMA_FILE)
        suppress_class = bool(pragmas & _PRAGMA_CLASS)

        max_lines = int(ctx.config.get("max_file_lines", 600))
        max_methods = int(ctx.config.get("max_class_methods", 25))

        if not suppress_file and ctx.signals.source_lines > max_lines:
            findings.append(
                Finding(
                    category="GOD-FILE",
                    severity="medium",
                    file=rel,
                    line=1,
                    message=(f"file is {ctx.signals.source_lines} lines (limit {max_lines})"),
                    detail=(
                        "Long files usually mix unrelated responsibilities. "
                        "Consider extracting cohesive subsets to sibling modules. "
                        "If the size is intentional, add `# arch-scan: allow "
                        "god-file` at the top of the file."
                    ),
                )
            )

        if not suppress_class:
            for lineno, name, method_count in ctx.signals.classes:
                if method_count > max_methods:
                    findings.append(
                        Finding(
                            category="GOD-CLASS",
                            severity="medium",
                            file=rel,
                            line=lineno,
                            message=(f"class '{name}' has {method_count} methods (limit {max_methods})"),
                            detail=(
                                "Single-Responsibility Principle: split methods into cohesive collaborator classes."
                            ),
                        )
                    )

        return findings


register(GodSizeDetector())
