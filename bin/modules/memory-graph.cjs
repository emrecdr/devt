// Graph traversal over the memory layer's `links` table.
//
// Functions here only need the DB handle, which they obtain via the
// `withDb` helper exported by ./memory.cjs. Lazy require inside each
// function breaks what would otherwise be a circular load-time dep
// (memory.cjs requires this file at the bottom and re-exports its surface;
// this file calling require("./memory.cjs") at the top would resolve to
// `{}` during the in-progress evaluation of memory.cjs).

"use strict";

/**
 * Expand the link graph outward from `docId` up to `maxDepth` hops.
 * Returns an array of `{ from, target_id, link_type, depth, target_exists, target }`
 * with cycle protection via a visited Set.
 */
function getLinks(docId, depth) {
  const { withDb } = require("./memory.cjs");
  const maxDepth = Math.max(1, Math.min(depth || 1, 5));
  return withDb(db => {
    const visited = new Set([docId]);
    const result = [];
    let frontier = [docId];
    for (let d = 1; d <= maxDepth; d++) {
      const next = [];
      const stmt = db.prepare("SELECT target_id, link_type FROM links WHERE source_id = ?");
      for (const id of frontier) {
        const links = stmt.all(id);
        for (const l of links) {
          if (visited.has(l.target_id)) continue;
          visited.add(l.target_id);
          const targetDoc = db.prepare("SELECT * FROM documents WHERE id = ?").get(l.target_id);
          result.push({ from: id, target_id: l.target_id, link_type: l.link_type, depth: d, target_exists: !!targetDoc, target: targetDoc || null });
          next.push(l.target_id);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return result;
  });
}

/**
 * Flatten transitive link expansion into `{source, predicate, target}` triples
 * for the Pre-Flight Brief subgraph section.
 *
 * Reuses `getLinks` so depth-capping, visited-set tracking, and the existing
 * `links` table query are inherited unchanged. The output is deduplicated
 * across seeds and capped at `maxTriples` (default 50) to keep the Brief
 * scannable — agents that need fuller graph data should call `getLinks`
 * directly via the MCP query layer.
 *
 * Triples come back sorted by `source` then `target` for byte-stable Brief
 * output (the renderer relies on this for cache-eligible re-dispatches).
 */
function getSubgraphTriples(seedIds, depth = 2, maxTriples = 50) {
  if (!Array.isArray(seedIds) || seedIds.length === 0) return [];
  const seen = new Set();
  const triples = [];
  for (const seedId of seedIds) {
    let links;
    try { links = getLinks(seedId, depth); } catch { links = []; }
    if (!Array.isArray(links)) continue;
    for (const row of links) {
      const source = row.from;
      const predicate = row.link_type;
      const target = row.target_id;
      if (!source || !predicate || !target) continue;
      const key = `${source}|${predicate}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      triples.push({ source, predicate, target });
      if (triples.length >= maxTriples) break;
    }
    if (triples.length >= maxTriples) break;
  }
  triples.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  return triples;
}

/**
 * Find all docs that link TO the given doc_id. Load-bearing for safe ADR
 * supersession: before retiring ADR-007, see what depends on it.
 */
function getBacklinks(docId) {
  const { withDb } = require("./memory.cjs");
  return withDb(db => db.prepare(`
    SELECT l.source_id, l.link_type, d.title AS source_title, d.doc_type AS source_type, d.status AS source_status, d.file_path
    FROM links l JOIN documents d ON d.id = l.source_id
    WHERE l.target_id = ?
    ORDER BY d.doc_type, d.id
  `).all(docId));
}

/**
 * Detect docs that have NO incoming links AND no outgoing links — possibly stale,
 * surface for curator review.
 */
function findOrphans() {
  const { withDb } = require("./memory.cjs");
  return withDb(db => db.prepare(`
    SELECT d.id, d.title, d.doc_type, d.status, d.file_path
    FROM documents d
    WHERE NOT EXISTS (SELECT 1 FROM links WHERE source_id = d.id)
      AND NOT EXISTS (SELECT 1 FROM links WHERE target_id = d.id)
      AND d.status IN ('active', 'candidate')
    ORDER BY d.doc_type, d.id
  `).all());
}

/**
 * Detect links pointing to non-existent target docs (forward refs that never got
 * created, OR refs to docs that were deleted).
 */
function findStaleLinks() {
  const { withDb } = require("./memory.cjs");
  return withDb(db => db.prepare(`
    SELECT l.source_id, l.target_id, l.link_type,
           d.title AS source_title, d.file_path AS source_path
    FROM links l
    JOIN documents d ON d.id = l.source_id
    LEFT JOIN documents t ON t.id = l.target_id
    WHERE t.id IS NULL
    ORDER BY l.source_id, l.target_id
  `).all());
}

module.exports = {
  getLinks,
  getSubgraphTriples,
  getBacklinks,
  findOrphans,
  findStaleLinks,
};
