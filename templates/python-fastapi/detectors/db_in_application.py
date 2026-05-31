"""Detector: DB primitives leaking into the application layer.

Application services must depend on repository interfaces, not Session /
select / engine primitives. Importing those into application/ is a hard
signal that data access is bypassing the repository pattern.
"""

from __future__ import annotations

from . import Finding, ScanContext, register

_DB_SYMBOLS = frozenset(
    {
        "Session",
        "AsyncSession",
        "select",
        "Select",
        "create_engine",
        "sessionmaker",
        "scoped_session",
    }
)

_DB_MODULES = frozenset(
    {
        "sqlalchemy",
        "sqlalchemy.orm",
        "sqlalchemy.future",
        "sqlmodel",
        "sqlmodel.ext",
    }
)


class DbInApplicationDetector:
    name = "db-in-application"
    categories = ("DB-IN-APPLICATION",)
    severities = ("high",)

    def run(self, ctx: ScanContext) -> list[Finding]:
        if ctx.layer != "application":
            return []
        rel = str(ctx.rel_path)
        findings: list[Finding] = []
        for lineno, mod, name in ctx.signals.imported_names:
            if mod in _DB_MODULES and name in _DB_SYMBOLS:
                findings.append(
                    Finding(
                        category="DB-IN-APPLICATION",
                        severity="high",
                        file=rel,
                        line=lineno,
                        message=f"application imports '{name}' from '{mod}'",
                        detail=(
                            "Application services should depend on repository "
                            "interfaces, not Session/select/engine primitives. "
                            "Move data access to infrastructure/repositories.py."
                        ),
                    )
                )
        return findings


register(DbInApplicationDetector())
