# code-review.md context_init — by-reference detail

Uncommon-path handling relocated out of `code-review.md`'s `context_init` so the common review path (fresh graph, no arch scanner, normal drill-down responses) doesn't load it every run. Each section is loaded on-demand: `code-review.md` reads it only when the substep's precondition fires. Anchors are referenced by mandatory-Read pointers in `code-review.md`; the pointer↔anchor bijection is enforced by smoke gate K309.

## arch-scan-advisory

Loaded from substep 4 only when `.devt/state/arch-scan-report.md` exists.

Check how recent the report is. Advisory-only — surfaces a `[STALE-ARCH-SCAN]` sentinel if the report is older than 24h so the reviewer can decide whether to refresh before reviewing structural changes. Surfaces state subcommands that would otherwise be available but unwired into workflows:

```bash
ARCH_FRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-arch-scan-fresh --max-age-hours=24 2>/dev/null || echo '{}')
if [ "$(printf '%s\n' "$ARCH_FRESH" | jq -r '.warn // false')" = "true" ]; then
  echo "[STALE-ARCH-SCAN] $(printf '%s\n' "$ARCH_FRESH" | jq -r '.reason')"
fi
if [ "$(printf '%s\n' "$ARCH_FRESH" | jq -r '.ok // false')" != "true" ]; then
  echo "[ARCH-SCAN-MISSING] $(printf '%s\n' "$ARCH_FRESH" | jq -r '.reason')"
fi
```

If the diff under review touches files that arch-scan has flagged (cross-reference arch-scan-report.md::findings vs the review's `scope_files`), surface the overlap explicitly to the reviewer — known architectural drift in the review's scope is a strong signal worth elevating.

## drill-down-recovery

Loaded from substep 6 only when a drill-down response comes back anomalous (empty, god-node-oversized, or below the substance threshold). Normal drill-downs need none of it.

**Empty drill-down handling**: `get_neighbors` self-recovers on empty results — identifier-shaped dropped callers return in `results` marked `recovered_from_noise: true` (confidence RECOVERED), with `dropped_by_file` still aggregating what stayed filtered. A drill-down is genuinely empty only when BOTH are absent — then record `## Drill-down: <SYM> (empty — dynamic dispatch suspected) [call: <correlation_id>]` and substitute the next-ranked dependent (bounded: try up to 5).

**God-node oversize handling**: when a top-3 dependent carries `is_god_node: true` in its `direct_dependents_degrees` entry — a high-fan-in node now demoted by relevance ranking, so it only reaches the top-3 when relevant dependents are scarce, typically a class with hundreds of incoming edges — the upstream MCP `get_neighbors(symbol, direction="in", depth=2)` response can overflow the MCP transport's response-size cap, returning zero usable data (observed: 84KB overflow → empty response on high-degree symbols). When this happens, fall back to the devt CLI wrapper which supports `--max-bytes` truncation: `node bin/devt-tools.cjs graphify neighbors <symbol> --direction=in --depth=2 --max-bytes=60000`. The CLI sorts results depth-ascending + label-alphabetical and truncates deterministically, returning `truncated: true` + `total_neighbors` so the heading can record the partial nature: `## Drill-down: <SYM> (truncated — depth-2 incoming exceeded 60KB; first <N> of <total>) [via CLI fallback]`.

**Substance threshold on drill-down sections.** `assert-graphify-decision` doesn't check "was the MCP tool called?" — it checks "is each drill-down section dense enough to be useful?" The gate uses a substance-byte-threshold heuristic per `## Drill-down:` block (currently 200 bytes minimum after stripping headings). A thin drill-down (e.g., 57 bytes) can fail the gate even when the MCP call succeeded — the section is thin because the topic extraction returned a generic concept that didn't map to a single useful subgraph. **If the gate fails with reason `drill-down section below substance threshold`**: re-derive the drill-down symbol from the impact-plan's `args.symbols` (NOT from topic keywords) so each section anchors on a real graph node with real dependents to enumerate. The gate is by design about output usefulness, not call presence.
