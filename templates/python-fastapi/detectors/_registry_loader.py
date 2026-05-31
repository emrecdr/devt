# ruff: noqa: T201  -- stderr warnings are the public surface of this loader
"""Tolerant YAML / JSON registry loader.

Used by the canonical-entities detector (and by ``arch-scan.py`` itself when
the registry path is not the default). Lives at the package root rather than
inside ``canonical_entities.py`` so other future detectors can share the same
loader without crossing into a sibling detector's private namespace.

Underscore-prefixed module name keeps the loader out of detector
auto-discovery (see ``detectors/__init__.py``).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

# PyYAML is an optional dependency — the canonical-entities detector only needs
# it when the registry is YAML. We probe it once at module import time so the
# load-time branch is a cheap None-check, not a try/except in the hot path.
try:
    import yaml as _yaml  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover - environment-dependent
    _yaml = None  # type: ignore[assignment]


def load_registry(path: Path) -> dict[str, Any] | None:
    """Load a registry file.

    Returns ``None`` if the file is missing, malformed, the top-level value is
    not a mapping, or — for YAML registries — PyYAML is not installed.

    Recognised by extension:
      * ``.yaml`` / ``.yml`` — parsed with PyYAML's safe loader
      * anything else        — parsed as JSON
    """
    if not path.exists():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"warning: cannot read registry {path}: {exc}", file=sys.stderr)
        return None

    if path.suffix in (".yaml", ".yml"):
        if _yaml is None:
            print(
                f"warning: registry {path} is YAML but PyYAML is not installed; "
                "install pyyaml or convert the registry to JSON",
                file=sys.stderr,
            )
            return None
        try:
            loaded = _yaml.safe_load(text) or {}
        except _yaml.YAMLError as exc:
            print(f"warning: registry {path} is malformed YAML: {exc}", file=sys.stderr)
            return None
    else:
        try:
            loaded = json.loads(text)
        except json.JSONDecodeError as exc:
            print(f"warning: registry {path} is malformed JSON: {exc}", file=sys.stderr)
            return None

    if not isinstance(loaded, dict):
        print(
            f"warning: registry {path} top-level is not a mapping; ignoring",
            file=sys.stderr,
        )
        return None
    return _validate(loaded, source=str(path))


# ---------------------------------------------------------------------------
# Shape validation — warn and drop malformed entries rather than crashing
# every detector run with AttributeErrors per-file.
# ---------------------------------------------------------------------------

# Per-entity fields whose value must be a string (or None / absent).
_STRING_FIELDS = (
    "entity_status",
    "import_path",
    "canonical_file",
    "table_name",
    "pk_column",
    "pk_type",
    "must_belong_to",
)

# Per-entity fields whose value must be a list of strings (or absent).
_LIST_FIELDS = (
    "triggers",
    "allowed_fk_columns",
    "forbid_owners",
    "allowed_types",
    "denylist_paths",
)


def _validate(registry: dict[str, Any], *, source: str) -> dict[str, Any]:
    """Drop malformed entries, warn the operator, return a cleaned registry.

    The detector should never see a registry that crashes on ``.lower()`` or
    ``.get()`` mid-scan: validation here turns a per-file crash storm into a
    single startup warning + a smaller (but well-formed) registry.
    """
    entities = registry.get("entities")
    if entities is None:
        return registry
    if not isinstance(entities, dict):
        print(
            f"warning: registry {source} has non-mapping `entities`; ignoring",
            file=sys.stderr,
        )
        registry["entities"] = {}
        return registry

    cleaned: dict[str, Any] = {}
    for key, ent in entities.items():
        if ent is None:
            print(
                f"warning: registry {source} entity `{key}` has empty body; skipping",
                file=sys.stderr,
            )
            continue
        if not isinstance(ent, dict):
            print(
                f"warning: registry {source} entity `{key}` is not a mapping (got {type(ent).__name__}); skipping",
                file=sys.stderr,
            )
            continue

        bad = False
        for sf in _STRING_FIELDS:
            if sf in ent and ent[sf] is not None and not isinstance(ent[sf], str):
                print(
                    f"warning: registry {source} entity `{key}`.{sf} must be a "
                    f"string (got {type(ent[sf]).__name__}); skipping entity",
                    file=sys.stderr,
                )
                bad = True
                break
        if bad:
            continue
        for lf in _LIST_FIELDS:
            if lf in ent and not isinstance(ent[lf], list):
                print(
                    f"warning: registry {source} entity `{key}`.{lf} must be a "
                    f"list (got {type(ent[lf]).__name__}); skipping entity",
                    file=sys.stderr,
                )
                bad = True
                break
        if bad:
            continue

        cleaned[key] = ent

    registry["entities"] = cleaned
    return registry


__all__ = ["load_registry"]
