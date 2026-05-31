"""CI gate: fails when a NEW canonical-entity drift is introduced.

Existing debt is captured in ``.devt/state/canonical-baseline.json``; this
test passes until something new lands. To pay off debt: fix the field, re-run
``python3 .devt/rules/arch-scan.py --canonical-only --write-baseline=...``.

To inspect findings interactively::

    python3 .devt/rules/arch-scan.py --canonical-only \\
        --report=docs/reports/CANONICAL-DRIFT.md

Anti-pattern this guards against — the two production bugs that motivated
the audit:
  1. ``Organization.billing_country: str`` (no FK to canonical Country entity)
  2. Nettie ``calling_settings`` attached to ``User`` instead of ``Client``

The detector implementation lives at
``.devt/rules/detectors/canonical_entities.py`` and reads its rules from
``.devt/rules/canonical-entities.yaml``.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCANNER = REPO / ".devt" / "rules" / "arch-scan.py"
BASELINE = REPO / ".devt" / "state" / "canonical-baseline.json"

_BLOCKING_SEVERITIES = {"critical", "high"}


@pytest.mark.architecture
def test_no_new_canonical_entity_drift() -> None:
    if not SCANNER.exists():
        pytest.skip(f"scanner not present at {SCANNER}")

    cmd = [
        sys.executable,
        str(SCANNER),
        "--canonical-only",
        "--json",
        f"--root={REPO}",
    ]
    if BASELINE.exists():
        cmd.append(f"--baseline={BASELINE}")

    result = subprocess.run(cmd, capture_output=True, text=True, check=False)

    if result.returncode not in (0, 1):
        pytest.fail(
            f"scanner crashed (exit {result.returncode}):\n"
            f"stdout: {result.stdout[:1000]}\n"
            f"stderr: {result.stderr[:1000]}"
        )

    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(f"scanner did not emit valid JSON: {exc}\n{result.stdout[:500]}")

    blockers = [f for f in report.get("findings", []) if f.get("severity") in _BLOCKING_SEVERITIES]

    if not blockers:
        return

    lines = [
        "",
        f"{len(blockers)} new canonical-entity drift finding(s) "
        "(critical/high). Fix the code OR — if accepted as debt — "
        "regenerate the baseline:",
        "",
        "  python3 .devt/rules/arch-scan.py --canonical-only --write-baseline=.devt/state/canonical-baseline.json",
        "",
    ]
    for f in blockers[:25]:
        lines.append(f"  {f['file']}:{f['line']} [{f['category']}] {f['message']}")
        if f.get("detail"):
            lines.append(f"    -> {f['detail']}")
    if len(blockers) > 25:
        lines.append(f"  ... and {len(blockers) - 25} more")
    pytest.fail("\n".join(lines))
