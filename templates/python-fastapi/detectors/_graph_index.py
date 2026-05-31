# ruff: noqa: T201  -- stderr warnings (stale graph, malformed file) are the public surface
"""Read-only index over ``graphify-out/graph.json``.

Used by detectors that need to answer cross-module wiring questions the AST
alone cannot — e.g. "is the canonical Country entity actually imported by this
DTO file?" or "are there two `Country` classes defined in different modules?".

Design goals:
- **Fail open.** If the graph file is missing, malformed, or stale, loading
  returns ``None`` and detectors that depend on graph queries silently skip.
  AST-based findings still flow. No detector should crash because the graph
  is gone.
- **Single load, many queries.** Build all indexes up front so detector
  queries are O(1) lookups.
- **Stdlib only.** Reads JSON; no third-party deps.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


class GraphIndex:
    """In-memory query API over ``graphify-out/graph.json``."""

    def __init__(self, graph_path: Path, *, project_root: Path | None = None):
        data = json.loads(graph_path.read_text(encoding="utf-8"))
        nodes = data.get("nodes", [])
        links = data.get("links", [])

        self._nodes: dict[str, dict] = {n["id"]: n for n in nodes}
        self._by_label: dict[str, list[str]] = defaultdict(list)
        self._by_source: dict[str, list[str]] = defaultdict(list)

        for n in nodes:
            label = n.get("label", "")
            if label:
                self._by_label[label].append(n["id"])
            sf = n.get("source_file", "")
            if sf:
                self._by_source[sf].append(n["id"])

        self._out_edges: dict[str, list[tuple[str, str]]] = defaultdict(list)
        self._in_edges: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for e in links:
            src = e.get("source")
            tgt = e.get("target")
            rel = e.get("relation", "")
            if src is None or tgt is None:
                continue
            self._out_edges[src].append((tgt, rel))
            self._in_edges[tgt].append((src, rel))

        self.built_at_commit: str | None = data.get("built_at_commit")
        self._project_root = project_root

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    @classmethod
    def load(
        cls,
        project_root: Path,
        *,
        graph_path: Path | None = None,
        warn_on_stale: bool = True,
    ) -> GraphIndex | None:
        """Load the graph index, or ``None`` on any failure.

        Emits a stderr warning when the graph is present but stale (commit
        mismatch with HEAD). Stale graphs still load — staleness is a hint,
        not a fatal error.
        """
        gp = graph_path or (project_root / "graphify-out" / "graph.json")
        if not gp.exists():
            return None
        try:
            idx = cls(gp, project_root=project_root)
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
            print(
                f"warning: failed to load graphify graph at {gp}: {exc}",
                file=sys.stderr,
            )
            return None

        if warn_on_stale:
            idx._maybe_warn_stale()
        return idx

    def _maybe_warn_stale(self) -> None:
        if not self.built_at_commit or self._project_root is None:
            return
        try:
            head = subprocess.check_output(
                ["git", "rev-parse", "HEAD"],
                cwd=self._project_root,
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            return
        if head and self.built_at_commit != head:
            print(
                f"warning: graphify graph built at {self.built_at_commit[:8]} "
                f"but HEAD is {head[:8]} — wiring checks may be inaccurate. "
                f"Re-run `/graphify update .` to refresh.",
                file=sys.stderr,
            )

    # ------------------------------------------------------------------
    # Query API used by canonical_entities detector
    # ------------------------------------------------------------------

    _WIRE_RELATIONS = frozenset({"imports", "imports_from", "uses", "references"})

    def file_imports_entity(self, source_file: str, entity_label: str) -> bool:
        """True if any node in ``source_file`` has an import-like edge to a
        node labeled ``entity_label``."""
        targets = set(self._by_label.get(entity_label, []))
        if not targets:
            return False
        for nid in self._by_source.get(source_file, []):
            for tgt, rel in self._out_edges.get(nid, []):
                if tgt in targets and rel in self._WIRE_RELATIONS:
                    return True
        return False

    def entity_consumer_files(self, entity_label: str) -> set[str]:
        """All source files with an import-like edge to ``entity_label``."""
        result: set[str] = set()
        for nid in self._by_label.get(entity_label, []):
            for src, rel in self._in_edges.get(nid, []):
                if rel not in self._WIRE_RELATIONS:
                    continue
                node = self._nodes.get(src)
                if node and node.get("source_file"):
                    result.add(node["source_file"])
        return result

    def duplicate_entity_definitions(
        self,
        entity_label: str,
        canonical_file: str,
    ) -> list[tuple[str, int]]:
        """Find files defining a class with the same label as the canonical
        entity but living outside the canonical service.

        Returns ``[(source_file, line), ...]`` for each duplicate. Skips test
        files and the canonical file itself.
        """
        result: list[tuple[str, int]] = []
        for nid in self._by_label.get(entity_label, []):
            node = self._nodes[nid]
            if node.get("file_type") != "code":
                continue
            sf = node.get("source_file", "")
            if not sf or sf == canonical_file:
                continue
            if sf.startswith("tests/") or "/tests/" in sf:
                continue
            line_str = (node.get("source_location") or "L0").lstrip("L")
            try:
                line = int(line_str)
            except ValueError:
                line = 0
            result.append((sf, line))
        return result

    def entity_exists(self, entity_label: str) -> bool:
        """True if the graph has at least one code node labeled this way."""
        return any(
            self._nodes[nid].get("file_type") == "code"
            for nid in self._by_label.get(entity_label, [])
        )


__all__ = ["GraphIndex"]
