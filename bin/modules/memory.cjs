"use strict";

/**
 * Memory layer — permanent ADR/Concept/Flow/Rejected/Lesson docs with FTS5 unified index.
 *
 * Indexes `.devt/memory/{decisions,concepts,flows,rejected,lessons}/*.md`. The 5 doc types
 * share frontmatter shape (id/title/doc_type/status/confidence/summary/links/affects_*);
 * each id pattern is enforced via ID_PATTERN_BY_TYPE.
 *
 * Zero external dependencies. Uses node:sqlite (built-in since Node 22.5).
 * Every doc carries strict frontmatter; the index is regenerable from markdown at any time.
 *
 * Schema invariants:
 * - Atomic rebuild: drop all tables in a transaction, re-insert, commit.
 * - Files prefixed with `_` (e.g. `_suggestions.md`, `_index.md`) are NEVER indexed
 * as first-class docs — they are auto-generated reports.
 * - Documents.id is unique across all four doc_types.
 * - links.target_id has NO FK constraint — forward references to not-yet-created
 * docs are valid; `memory validate` flags broken links separately.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteFileSync, atomicWriteJsonSync } = require("./io.cjs");
// Sub-modules lazy-require this file inside their function bodies (for shared
// utilities like withDb / parseYamlSubset / serializeFrontmatter), so requiring
// them here at load time is safe — their top-level eval has no dependency on
// memory.cjs yet.
const { getLinks, getSubgraphTriples, getBacklinks, findOrphans, findStaleLinks } = require("./memory-graph.cjs");
const { resolveExportPath, resolveImportPath, exportBundle, importBundle } = require("./memory-bundle.cjs");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

const DOC_TYPES = ["decision", "concept", "flow", "rejected", "lesson"];
const STATUS_VALUES = ["candidate", "active", "superseded", "rejected"];
const CONFIDENCE_VALUES = ["verified", "explicit", "inferred", "observed", "speculative"];
const LINK_TYPES = ["supersedes", "depends_on", "implements", "relates_to"];
const REJECTION_REASONS = ["user_preference", "performance", "security", "maintainability", "compliance", "complexity"];

const ID_PATTERN_BY_TYPE = {
  decision: /^ADR-\d{3,}$/,
  concept: /^CON-\d{3,}$/,
  flow: /^FLOW-\d{3,}$/,
  rejected: /^REJ-\d{3,}$/,
  lesson: /^LES-\d{3,}$/,
};

const SUBDIR_BY_TYPE = {
  decision: "decisions",
  concept: "concepts",
  flow: "flows",
  rejected: "rejected",
  lesson: "lessons",
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function findProjectRoot() {
  return require("./config.cjs").findProjectRoot();
}

function getMemoryRoot() {
  // Project-local root — destination for curator writes and `memory init`.
  // Always exists in the resolved roots list (auto-appended by getMemoryRoots).
  return path.join(findProjectRoot(), ".devt", "memory");
}

/**
 * Resolve the configured list of memory roots.
 * Returns absolute paths in scan order. Project-local (.devt/memory) is always
 * the LAST entry so it wins ID collisions per the last-wins precedence rule.
 *
 * Each path is validated:
 * - relative paths resolve against the project root
 * - `..` segments after normalization are allowed (shared dirs are often siblings)
 * BUT the resolved path must still be a real existing directory
 * - null bytes rejected
 * - duplicates collapsed (preserving first occurrence to keep precedence stable)
 */
function getMemoryRoots() {
  let configured = null;
  try {
    const cfg = require("./config.cjs").getMergedConfig();
    configured = cfg && cfg.memory ? cfg.memory.paths : null;
  } catch { /* config unreadable — fall through to single-root default */ }

  const projectRoot = findProjectRoot();
  const localRoot = getMemoryRoot();

  if (!Array.isArray(configured) || configured.length === 0) {
    return [localRoot];
  }

  const resolved = [];
  const seen = new Set();
  for (const raw of configured) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) continue;
    if (raw.includes("\0")) continue;
    const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(projectRoot, raw));
    // Force project-local to end regardless of user-supplied position. Without this,
    // a user listing `.devt/memory` first followed by shared roots would silently
    // make shared override local — violating the "project-local always wins" invariant.
    // Skip here; we re-append at the end.
    if (abs === localRoot) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    resolved.push(abs);
  }
  // Project-local root is ALWAYS the last entry (highest precedence — last-wins).
  resolved.push(localRoot);
  return resolved;
}

function getDbPath() {
  // Index DB always lives in the project-local root, regardless of how many
  // shared roots are configured. The DB indexes the union of all roots but
  // the file itself is per-project (gitignored, regenerable).
  return path.join(getMemoryRoot(), "index.db");
}

// H10 helper — count successful graphify MCP trace records.
// Lets validate() distinguish "graphify is actually down" from "internal probe
// is broken while orchestrator path works". Returns 0 on any read failure
// (safe degradation: caller treats absence as "no recent ok").
//
// Three modes for the cutoff:
//   - number argument (minutes)         → sliding window of last N minutes
//   - {sinceSessionAnchor: true}        → use workflow.yaml::first_created_at
//                                          (anchored to session, not clock)
//   - default (no arg)                  → session-anchor with 24h fallback
//
// A short minutes-based default is too tight for real sessions (validate
// often runs hours after the graphify call burst — a 5-min OR 60-min
// window both miss). Session anchor is the right semantic: "if THIS
// session ever successfully called graphify, the probe failure is
// anomalous and the warning is a false positive".
function recentSuccessfulGraphifyTraceCount(arg) {
  try {
    const tracePath = path.join(getMemoryRoot(), "_mcp-trace.jsonl");
    if (!fs.existsSync(tracePath)) return 0;
    let cutoffMs;
    const opts = (arg && typeof arg === "object") ? arg : {};
    const wantsSessionAnchor = opts.sinceSessionAnchor === true || typeof arg === "undefined";
    if (typeof arg === "number" && Number.isFinite(arg) && arg >= 0) {
      cutoffMs = Date.now() - (arg * 60 * 1000);
    } else if (wantsSessionAnchor) {
      // Read first_created_at from workflow.yaml. Fall back to 24h window
      // when workflow.yaml is absent or anchor unparseable.
      let anchorMs = 0;
      try {
        const root = require("./config.cjs").findProjectRoot();
        const wfPath = path.join(root, ".devt", "state", "workflow.yaml");
        if (fs.existsSync(wfPath)) {
          const yaml = fs.readFileSync(wfPath, "utf8");
          const m = yaml.match(/^first_created_at:\s*"?([^"\n]+)"?\s*$/m);
          if (m) {
            const parsed = new Date(m[1].trim()).getTime();
            if (Number.isFinite(parsed)) anchorMs = parsed;
          }
        }
      } catch { /* fall through to 24h default */ }
      cutoffMs = anchorMs > 0 ? anchorMs : Date.now() - (24 * 60 * 60 * 1000);
    } else {
      cutoffMs = Date.now() - (24 * 60 * 60 * 1000);
    }
    const body = fs.readFileSync(tracePath, "utf8");
    let count = 0;
    for (const line of body.split("\n")) {
      if (!line || !line.includes("graphify")) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.ok !== true) continue;
        if (typeof rec.tool !== "string" || !rec.tool.includes("graphify")) continue;
        if (typeof rec.ts !== "string") continue;
        if (new Date(rec.ts).getTime() < cutoffMs) continue;
        count++;
      } catch { /* malformed line — skip */ }
    }
    return count;
  } catch { return 0; }
}

function getSubdirPath(docType) {
  // Project-local subdir — used for curator writes and the legacy
  // single-root path. For multi-root scanning, see getSubdirPathFor(root, docType).
  const subdir = SUBDIR_BY_TYPE[docType];
  if (!subdir) throw new Error(`unknown doc_type: ${docType}`);
  return path.join(getMemoryRoot(), subdir);
}

function getSubdirPathFor(memoryRoot, docType) {
  // Resolve a docType subdir under an explicit memory root (not necessarily local).
  // memoryRoot must be an absolute path (caller's responsibility — validated upstream
  // by getMemoryRoots). docType is whitelist-checked against SUBDIR_BY_TYPE.
  const subdir = SUBDIR_BY_TYPE[docType];
  if (!subdir) throw new Error(`unknown doc_type: ${docType}`);
  return path.join(memoryRoot, subdir);
}

// ---------------------------------------------------------------------------
// node:sqlite loader (lazy — only required when a DB op runs)
// ---------------------------------------------------------------------------

function getDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch {
    throw new Error(
      `node:sqlite requires Node.js 22.5+, current: ${process.version}. ` +
      `Memory layer indexing needs it; query subcommands also require an index file to query.`
    );
  }
}

/**
 * Run multi-statement SQL by splitting on `;` and preparing each fragment.
 * Avoids the broad `Database.exec()` API; uses prepared statements throughout.
 */
function runSql(db, sql) {
  // Strip SQL line comments before splitting — a semicolon in a comment
  // otherwise silently aborts schema init mid-stream.
  const stripped = sql.replace(/--[^\n]*/g, "");
  const stmts = stripped.split(";").map(s => s.trim()).filter(Boolean);
  for (const s of stmts) {
    db.prepare(s).run();
  }
}

// ---------------------------------------------------------------------------
// Frontmatter YAML subset parser
//
// Handles: scalars, list-of-scalars, list-of-objects.
// Does NOT handle: nested mappings beyond depth 2, anchors, multi-line strings.
// That's a deliberate scope choice — our schema doesn't need them.
// ---------------------------------------------------------------------------

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  return parseYamlSubset(m[1]);
}

function parseYamlSubset(yaml) {
  const lines = yaml.split("\n");
  const obj = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.match(/^(\s*)/)[1].length;
    if (indent !== 0) {
      i++;
      continue;
    }

    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }

    const key = kv[1];
    const inlineValue = kv[2];

    if (inlineValue.trim() !== "") {
      obj[key] = parseScalar(inlineValue);
      i++;
      continue;
    }

    // Multi-line value: list-of-scalars or list-of-objects
    const items = [];
    let j = i + 1;
    while (j < lines.length) {
      const sub = lines[j];
      if (!sub.trim() || sub.trim().startsWith("#")) {
        j++;
        continue;
      }
      const subIndent = sub.match(/^(\s*)/)[1].length;
      if (subIndent === 0) break;

      const dashItem = sub.match(/^\s*-\s+(.*)$/);
      if (!dashItem) break;

      const itemContent = dashItem[1];
      const inlineKv = itemContent.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);

      if (inlineKv) {
        const objItem = {};
        objItem[inlineKv[1]] = parseScalar(inlineKv[2]);
        j++;
        const siblingIndent = subIndent + 2;
        while (j < lines.length) {
          const sib = lines[j];
          if (!sib.trim() || sib.trim().startsWith("#")) {
            j++;
            continue;
          }
          const sibIndent = sib.match(/^(\s*)/)[1].length;
          if (sibIndent < siblingIndent) break;
          if (sib.match(/^\s*-\s+/)) break;
          const sibKv = sib.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
          if (sibKv) {
            objItem[sibKv[1]] = parseScalar(sibKv[2]);
          }
          j++;
        }
        items.push(objItem);
      } else {
        items.push(parseScalar(itemContent));
        j++;
      }
    }

    obj[key] = items;
    i = j;
  }

  return obj;
}

function parseScalar(raw) {
  let val = raw.trim();
  const commentIdx = val.search(/\s+#/);
  if (commentIdx !== -1) val = val.slice(0, commentIdx).trim();
  if (val === "") return "";
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  if (val.startsWith("[") && val.endsWith("]")) {
    const inner = val.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map(s => parseScalar(s.trim()));
  }
  return val;
}

// ---------------------------------------------------------------------------
// Frontmatter schema validation
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS_COMMON = ["id", "title", "doc_type", "status", "confidence", "summary"];
const REQUIRED_FIELDS_REJECTED = [...REQUIRED_FIELDS_COMMON, "reason"];

function validateFrontmatter(fm, filePath) {
  const errors = [];
  if (!fm || typeof fm !== "object") {
    return [{ filePath, error: "missing or unparseable frontmatter" }];
  }

  const required = fm.doc_type === "rejected" ? REQUIRED_FIELDS_REJECTED : REQUIRED_FIELDS_COMMON;
  for (const field of required) {
    if (!fm[field] || (typeof fm[field] === "string" && fm[field].trim() === "")) {
      errors.push({ filePath, error: `missing required field: ${field}` });
    }
  }

  if (fm.doc_type && !DOC_TYPES.includes(fm.doc_type)) {
    errors.push({ filePath, error: `invalid doc_type: ${fm.doc_type} (allowed: ${DOC_TYPES.join("|")})` });
  }
  if (fm.status && !STATUS_VALUES.includes(fm.status)) {
    errors.push({ filePath, error: `invalid status: ${fm.status} (allowed: ${STATUS_VALUES.join("|")})` });
  }
  if (fm.confidence && !CONFIDENCE_VALUES.includes(fm.confidence)) {
    errors.push({ filePath, error: `invalid confidence: ${fm.confidence} (allowed: ${CONFIDENCE_VALUES.join("|")})` });
  }
  if (fm.id && fm.doc_type && ID_PATTERN_BY_TYPE[fm.doc_type] && !ID_PATTERN_BY_TYPE[fm.doc_type].test(fm.id)) {
    errors.push({ filePath, error: `id "${fm.id}" does not match pattern for ${fm.doc_type}` });
  }
  if (fm.summary && fm.summary.length > 200) {
    errors.push({ filePath, error: `summary exceeds 200 chars (FTS5 ranking quality degrades)` });
  }
  if (fm.doc_type === "rejected" && fm.reason && !REJECTION_REASONS.includes(fm.reason)) {
    errors.push({ filePath, error: `invalid rejection reason: ${fm.reason} (allowed: ${REJECTION_REASONS.join("|")})` });
  }

  if (Array.isArray(fm.links)) {
    for (const link of fm.links) {
      if (!link || typeof link !== "object" || !link.id || !link.type) {
        errors.push({ filePath, error: `link entry missing id or type` });
        continue;
      }
      if (!LINK_TYPES.includes(link.type)) {
        errors.push({ filePath, error: `invalid link type: ${link.type}` });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Document scanner
// ---------------------------------------------------------------------------

function scanDocs() {
  const roots = getMemoryRoots();
  const projectRoot = findProjectRoot();
  const docs = [];
  const conflicts = []; // { id, source_roots: [...] } when same id appears in 2+ roots

  // Track first-seen id-to-source so we can detect collisions. Iteration order
  // matters: we walk roots in configured order, so the LAST occurrence wins
  // (later writes shadow earlier ones — see config doc for memory.paths).
  const idToIndex = new Map(); // id -> index into docs[]

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const docType of DOC_TYPES) {
      const subdir = getSubdirPathFor(root, docType);
      if (!fs.existsSync(subdir)) continue;
      for (const entry of fs.readdirSync(subdir)) {
        if (entry.startsWith("_")) continue;
        if (!entry.endsWith(".md")) continue;

        const filePath = path.join(subdir, entry);
        const content = fs.readFileSync(filePath, "utf8");
        const fm = parseFrontmatter(content);
        if (fm && typeof fm.id === "string" && /-000$/.test(fm.id)) continue;

        const doc = {
          filePath,
          // relativePath is from project root for the local files (preserves legacy)
          // and absolute for shared roots so file_path stays unambiguous in queries
          relativePath: filePath.startsWith(projectRoot + path.sep)
            ? path.relative(projectRoot, filePath)
            : filePath,
          frontmatter: fm,
          body: content.replace(/^---[\s\S]*?\n---\n?/, ""),
          source_root: root,
          content_hash: crypto.createHash("sha256").update(content).digest("hex"),
        };

        const id = fm && typeof fm.id === "string" ? fm.id : null;
        if (id && idToIndex.has(id)) {
          // Collision: track which roots had this id; replace previous entry
          // (last-wins per memory.paths precedence rule).
          const prevIdx = idToIndex.get(id);
          const prev = docs[prevIdx];
          conflicts.push({ id, prev_source: prev.source_root, prev_path: prev.relativePath, new_source: root, new_path: doc.relativePath });
          docs[prevIdx] = doc; // overwrite — last-wins
        } else {
          if (id) idToIndex.set(id, docs.length);
          docs.push(doc);
        }
      }
    }
  }

  // Stash conflicts on the array itself for rebuildIndex to surface in its return value.
  // Non-enumerable so JSON.stringify on a stray docs array doesn't leak it.
  Object.defineProperty(docs, "_conflicts", { value: conflicts, enumerable: false });
  return docs;
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS documents (
    id              TEXT PRIMARY KEY,
    doc_type        TEXT NOT NULL,
    doc_class       TEXT NOT NULL DEFAULT 'memory',
    status          TEXT NOT NULL,
    confidence      TEXT NOT NULL,
    domain          TEXT,
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    source_root     TEXT,
    created_at      TEXT,
    created_by      TEXT,
    schema_version  INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS affects (
    doc_id              TEXT NOT NULL,
    pattern             TEXT,
    symbol              TEXT,
    binding_confidence  TEXT,
    PRIMARY KEY (doc_id, pattern, symbol),
    FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS links (
    source_id   TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    link_type   TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id, link_type),
    FOREIGN KEY (source_id) REFERENCES documents(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS rejected_keywords (
    doc_id    TEXT NOT NULL,
    keyword   TEXT NOT NULL,
    PRIMARY KEY (doc_id, keyword),
    FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    id, title, summary, file_path, doc_type, doc_class, status,
    tokenize = 'unicode61'
  );
  CREATE INDEX IF NOT EXISTS idx_docs_doc_type ON documents(doc_type);
  CREATE INDEX IF NOT EXISTS idx_docs_status ON documents(status);
  CREATE INDEX IF NOT EXISTS idx_docs_domain ON documents(domain);
  CREATE INDEX IF NOT EXISTS idx_affects_pattern ON affects(pattern);
  CREATE INDEX IF NOT EXISTS idx_affects_symbol ON affects(symbol COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);

  -- Views. Survive atomic rebuildIndex() because
  -- rebuilds DELETE FROM tables rather than DROP them.
  CREATE VIEW IF NOT EXISTS pending_review AS
  SELECT id, doc_type, title, confidence, domain, created_at, file_path
  FROM documents
  WHERE status = 'candidate'
  ORDER BY
    CASE confidence
      WHEN 'verified' THEN 1
      WHEN 'explicit' THEN 2
      WHEN 'inferred' THEN 3
      WHEN 'observed' THEN 4
      WHEN 'speculative' THEN 5
      ELSE 6
    END,
    created_at DESC;

  CREATE VIEW IF NOT EXISTS speculative_candidates AS
  SELECT id, doc_type, status, title, domain, created_at, file_path
  FROM documents
  WHERE confidence = 'speculative'
  ORDER BY created_at DESC;

  CREATE VIEW IF NOT EXISTS constraint_chains AS
  SELECT
    d.id, d.doc_type, d.title, d.status,
    COUNT(DISTINCT l_out.target_id) AS outgoing_links,
    COUNT(DISTINCT l_in.source_id)  AS incoming_links
  FROM documents d
  LEFT JOIN links l_out ON l_out.source_id = d.id
  LEFT JOIN links l_in  ON l_in.target_id  = d.id
  GROUP BY d.id, d.doc_type, d.title, d.status;

  -- created_at as age proxy: last_hit_at tracking would break the
  -- regenerable-from-markdown invariant (writes during reads).
  CREATE VIEW IF NOT EXISTS stale_speculative AS
  SELECT
    id, doc_type, title, domain, created_at, file_path,
    CAST(julianday('now') - julianday(created_at) AS INTEGER) AS age_days
  FROM documents
  WHERE status = 'candidate'
    AND confidence = 'speculative'
    AND julianday('now') - julianday(created_at) > 30
  ORDER BY created_at ASC;
`;

function openDb(dbPath) {
  return new (getDatabaseSync())(dbPath);
}

function ensureDb() {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = openDb(dbPath);
  db.prepare("PRAGMA foreign_keys = ON").run();
  runSql(db, SCHEMA_DDL);
  const existing = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!existing) {
    db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)").run("schema_version", String(SCHEMA_VERSION));
  }
  return db;
}

/**
 * Atomic rebuild: drops all rows in a single transaction and re-inserts.
 * If anything throws mid-rebuild, the transaction rolls back and the
 * previous index state is preserved.
 *
 * Cross-process serialization: wraps the rebuild in a file lock
 * against the memory directory so two concurrent Claude sessions that both
 * trigger memory-auto-index.sh (e.g. user edits memory docs from two terminals)
 * cannot race on the DELETE→INSERT transaction. Returns `{ok:false, reason:
 * "index_in_progress"}` if another rebuild is in flight — the debounce timer
 * in memory-auto-index.sh will pick it up on the next cycle.
 */
function rebuildIndex() {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Acquire FTS5 rebuild lock against the memory directory. Bail cleanly on
  // contention so the caller can retry rather than waiting indefinitely.
  const { acquireLock, releaseLock } = require("./state.cjs");
  let lockFile;
  try {
    lockFile = acquireLock(dir);
  } catch (e) {
    return {
      ok: false,
      reason: "index_in_progress",
      error: e.message,
      inserted: 0,
      skipped: 0,
      errors: [],
    };
  }

  try {
    return rebuildIndexLocked();
  } finally {
    releaseLock(lockFile);
  }
}

function rebuildIndexLocked() {
  const docs = scanDocs();
  const validationErrors = [];
  const validDocs = [];
  for (const doc of docs) {
    const errors = validateFrontmatter(doc.frontmatter, doc.relativePath);
    if (errors.length) {
      validationErrors.push(...errors);
    } else {
      validDocs.push(doc);
    }
  }

  const db = ensureDb();

  // Shared-root delta baseline. The previous manifest survives the rebuild
  // because the transaction below clears the content tables but never `meta`
  // (same mechanism that preserves last_built_at). Deleting the DB deletes
  // the baseline with it — the next run honestly reports it unavailable.
  let prevManifest = null;
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'shared_manifest'").get();
    if (row && row.value) prevManifest = JSON.parse(row.value);
  } catch { /* absent or corrupt manifest — baseline unavailable */ }

  const localRoot = getMemoryRoot();
  const roots = getMemoryRoots();
  // Manifest covers post-precedence WINNERS only: a shared doc shadowed by a
  // local one does not govern, so it does not belong in the delta either.
  const newManifest = {};
  for (const doc of validDocs) {
    if (doc.source_root && doc.source_root !== localRoot) {
      newManifest[doc.frontmatter.id] = { root: doc.source_root, hash: doc.content_hash };
    }
  }

  // Delta only when multi-root is configured — single-root projects must see
  // zero new surface. First-ever baseline reports "unavailable" with empty
  // arrays rather than enumerating every shared doc as "added" (noise).
  let sharedDelta = null;
  if (roots.length > 1) {
    const rootLabel = (r) => {
      try { const info = sourceRootInfo(r); return info.local ? r : info.label; }
      catch { return path.basename(r); }
    };
    sharedDelta = { baseline: prevManifest ? "previous-index" : "unavailable", added: [], changed: [], removed: [] };
    if (prevManifest) {
      for (const [id, cur] of Object.entries(newManifest)) {
        const prev = prevManifest[id];
        if (!prev) sharedDelta.added.push({ id, root: rootLabel(cur.root) });
        else if (prev.hash !== cur.hash) sharedDelta.changed.push({ id, root: rootLabel(cur.root) });
      }
      for (const [id, prev] of Object.entries(prevManifest)) {
        if (!newManifest[id]) sharedDelta.removed.push({ id, root: rootLabel(prev.root) });
      }
    }
  }

  let inserted = 0;
  try {
    db.prepare("BEGIN").run();
    db.prepare("DELETE FROM documents_fts").run();
    db.prepare("DELETE FROM rejected_keywords").run();
    db.prepare("DELETE FROM links").run();
    db.prepare("DELETE FROM affects").run();
    db.prepare("DELETE FROM documents").run();

    const insertDoc = db.prepare(
      `INSERT INTO documents
        (id, doc_type, doc_class, status, confidence, domain, title, summary, file_path, source_root, created_at, created_by, schema_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertFts = db.prepare(
      `INSERT INTO documents_fts (id, title, summary, file_path, doc_type, doc_class, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertAffectPath = db.prepare(
      `INSERT OR IGNORE INTO affects (doc_id, pattern, symbol, binding_confidence) VALUES (?, ?, NULL, NULL)`
    );
    const insertAffectSymbol = db.prepare(
      `INSERT OR IGNORE INTO affects (doc_id, pattern, symbol, binding_confidence) VALUES (?, NULL, ?, ?)`
    );
    const insertLink = db.prepare(
      `INSERT OR IGNORE INTO links (source_id, target_id, link_type) VALUES (?, ?, ?)`
    );
    const insertRejKw = db.prepare(
      `INSERT OR IGNORE INTO rejected_keywords (doc_id, keyword) VALUES (?, ?)`
    );

    for (const doc of validDocs) {
      const fm = doc.frontmatter;
      insertDoc.run(
        fm.id,
        fm.doc_type,
        "memory",
        fm.status,
        fm.confidence,
        fm.domain || null,
        fm.title,
        fm.summary,
        doc.relativePath,
        doc.source_root || null,
        fm.created_at || null,
        fm.created_by || null,
        SCHEMA_VERSION
      );
      insertFts.run(fm.id, fm.title, fm.summary, doc.relativePath, fm.doc_type, "memory", fm.status);

      if (Array.isArray(fm.affects_paths)) {
        for (const p of fm.affects_paths) insertAffectPath.run(fm.id, String(p));
      }
      if (Array.isArray(fm.affects_symbols)) {
        for (const s of fm.affects_symbols) {
          if (typeof s === "object" && s !== null) {
            insertAffectSymbol.run(fm.id, s.symbol, s.binding_confidence || null);
          } else {
            insertAffectSymbol.run(fm.id, String(s), null);
          }
        }
      }
      if (Array.isArray(fm.links)) {
        for (const link of fm.links) insertLink.run(fm.id, link.id, link.type);
      }
      if (fm.doc_type === "rejected" && Array.isArray(fm.search_keywords)) {
        for (const kw of fm.search_keywords) insertRejKw.run(fm.id, String(kw));
      }
      inserted++;
    }

    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(
      "last_built_at", new Date().toISOString()
    );
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(
      "shared_manifest", JSON.stringify(newManifest)
    );
    if (sharedDelta) {
      db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(
        "last_shared_delta", JSON.stringify({ generated_at: new Date().toISOString(), ...sharedDelta })
      );
    } else {
      // Config flipped multi→single: a lingering delta row would keep health
      // flagging shared changes that no longer govern anything.
      db.prepare("DELETE FROM meta WHERE key = 'last_shared_delta'").run();
    }

    db.prepare("COMMIT").run();
  } catch (err) {
    try { db.prepare("ROLLBACK").run(); } catch { /* swallow */ }
    db.close();
    throw err;
  }
  db.close();

  const conflicts = (docs && docs._conflicts) || [];
  return {
    inserted,
    skipped: validationErrors.length,
    errors: validationErrors,
    last_built_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    memory_roots: roots,
    conflicts,
    conflict_count: conflicts.length,
    ...(sharedDelta ? { shared_delta: sharedDelta } : {}),
  };
}

// ---------------------------------------------------------------------------
// Programmatic upsert
// ---------------------------------------------------------------------------

/**
 * Slugify a title for filename use. Lowercase ASCII alphanumerics + hyphen,
 * max 60 chars. Stable, deterministic, no deps.
 */
function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "untitled";
}

// Frontmatter serialization is handled by the existing `serializeFrontmatter`
// + `serializeScalar` helpers further down this file (originally added for the
// importBundle path). upsertDoc wraps their output with the `---` doc delimiters.

/**
 * Atomic upsert of a single memory doc — single MCP call replaces the legacy
 * 4-tool curator ritual (Write .tmp + Bash mv + Bash memory index + state read).
 *
 * Steps (in order; failures roll back files this call CREATED):
 * 1. Validate frontmatter via validateFrontmatter
 * 2. Resolve target path: existing id → its current file (never recomputed;
 *    a retitle must update in place, not fork `<ID>-<new-slug>.md`);
 *    new id → `.devt/memory/<subdir>/<ID>-<slug>.md`
 * 3. Render markdown (YAML frontmatter + body)
 * 4. atomicWriteFileSync (tmp + rename)
 * 5. rebuildIndex() — refreshes FTS5, affects, links, rejected_keywords
 *
 * Returns: { ok: true, file_path, indexed: {inserted, skipped, ...} }
 * or { ok: false, errors: [...] }
 *
 * @param {object} doc - { frontmatter: {...}, body: "..." }
 */
function upsertDoc(doc) {
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: [{ error: "doc payload required" }] };
  }
  const fm = doc.frontmatter || {};
  const body = (doc.body == null) ? "" : String(doc.body);

  // 1. Validate
  const errors = validateFrontmatter(fm, "(programmatic upsert)");
  if (errors.length) return { ok: false, errors };

  // 2. Resolve target path. getSubdirPath throws on unknown doc_type — but
  // validateFrontmatter already checked, so this is defensive.
  let subdirPath;
  try { subdirPath = getSubdirPath(fm.doc_type); }
  catch (e) { return { ok: false, errors: [{ error: e.message }] }; }

  if (!fs.existsSync(subdirPath)) fs.mkdirSync(subdirPath, { recursive: true });

  // An EXISTING id keeps its current file. Recomputing from the current
  // title would fork a second file for any hand-named or retitled doc —
  // and the MCP memory_upsert_doc curator path hits this on every in-place
  // update. Only brand-new ids get the canonical <ID>-<slug>.md name.
  // supersede() applies the same rule for the same reason.
  const existing = scanDocs().find(d => d.frontmatter && d.frontmatter.id === fm.id);
  // path.join(<trusted subdirPath>, <validated-id>-<sanitized-slug>.md) — both
  // components fully constrained: subdirPath comes from the hardcoded
  // SUBDIR_BY_TYPE map, id is regex-validated by validateFrontmatter, slug is
  // ASCII-alphanum-hyphen via slugify. No untrusted input reaches path.join.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const targetPath = existing
    ? existing.filePath
    : path.join(subdirPath, `${fm.id}-${slugify(fm.title)}.md`);

  // 3. Render — wrap the existing serializer's body with the YAML doc delimiters.
  // Field order is whatever Object.entries() yields; callers wanting stable
  // diffs should construct their frontmatter object with the canonical order.
  const markdown = `---\n${serializeFrontmatter(fm)}\n---\n\n${body.replace(/\s+$/, "")}\n`;

  // 4. Atomic write
  try { atomicWriteFileSync(targetPath, markdown); }
  catch (e) { return { ok: false, errors: [{ error: `atomic write failed: ${e.message}` }] }; }

  // 5. Rebuild FTS index. On failure, undo the file write so the on-disk
  // state remains consistent with the index.
  let indexed;
  try {
    indexed = rebuildIndex();
    if (indexed && indexed.ok === false) {
      // Index rebuild lock contention — file IS written, but the next
      // memory-auto-index pass will pick it up. Surface as warning, not error.
      return {
        ok: true,
        file_path: targetPath,
        indexed: null,
        warning: `index_in_progress — file written, will be indexed on next auto-index cycle`,
      };
    }
  } catch (e) {
    // Roll back ONLY files this call created — unlinking an in-place update
    // would destroy a pre-existing doc (its old content is already
    // overwritten; deletion would make a bad state worse). Updated docs stay
    // on disk and the next auto-index pass picks them up.
    if (!existing) {
      try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch { /* swallow */ }
      return { ok: false, errors: [{ error: `index rebuild failed (new file rolled back): ${e.message}` }] };
    }
    return { ok: false, errors: [{ error: `index rebuild failed (in-place update kept on disk; next auto-index pass will reindex): ${e.message}` }] };
  }

  return { ok: true, file_path: targetPath, indexed };
}

// ---------------------------------------------------------------------------
// Supersession — atomic two-sided retirement
// ---------------------------------------------------------------------------

/**
 * Retire `oldId` in favor of `newId` as ONE operation. The manual ritual is
 * two-sided (flip old doc's status + add the supersedes link in the new doc)
 * across two files with no atomicity — forget side one and the retired doc
 * stays `active` in every retrieval lane forever; forget side two and the
 * lineage is untraceable. This command does both edits, stamps
 * `superseded_at`/`superseded_by`, validates the mutated frontmatter BEFORE
 * touching disk, and reindexes once.
 *
 * Writes to each doc's EXISTING file path (from scanDocs) — never a
 * recomputed `<id>-<slug>.md` path, which would fork a second file for
 * hand-named docs. Curator remains the authority: this is the mechanism the
 * curator (or operator) invokes, not an auto-supersession path.
 */
function supersede(oldId, newId, opts = {}) {
  if (!oldId || !newId) {
    return { ok: false, errors: [{ error: "usage: memory supersede <old-id> <new-id> [--reason=...]" }] };
  }
  if (oldId === newId) {
    return { ok: false, errors: [{ error: "a doc cannot supersede itself" }] };
  }
  const docs = scanDocs();
  const oldDoc = docs.find(d => d.frontmatter && d.frontmatter.id === oldId);
  const newDoc = docs.find(d => d.frontmatter && d.frontmatter.id === newId);
  if (!oldDoc) return { ok: false, errors: [{ error: `doc not found: ${oldId}` }] };
  if (!newDoc) return { ok: false, errors: [{ error: `doc not found: ${newId}` }] };
  if (newDoc.frontmatter.status === "superseded") {
    return { ok: false, errors: [{ error: `${newId} is itself superseded — supersede with its live successor instead` }] };
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const oldFm = {
    ...oldDoc.frontmatter,
    status: "superseded",
    superseded_at: stamp,
    superseded_by: newId,
    ...(opts.reason ? { superseded_reason: String(opts.reason) } : {}),
  };

  const newFm = { ...newDoc.frontmatter };
  const links = Array.isArray(newFm.links) ? [...newFm.links] : [];
  const linkExists = links.some(l => l && l.id === oldId && l.type === "supersedes");
  if (!linkExists) links.push({ id: oldId, type: "supersedes" });
  newFm.links = links;

  const errors = [
    ...validateFrontmatter(oldFm, oldDoc.relativePath),
    ...validateFrontmatter(newFm, newDoc.relativePath),
  ];
  if (errors.length) return { ok: false, errors };

  const render = (fm, body) =>
    `---\n${serializeFrontmatter(fm)}\n---\n\n${String(body || "").replace(/^\s+/, "").replace(/\s+$/, "")}\n`;
  try {
    atomicWriteFileSync(oldDoc.filePath, render(oldFm, oldDoc.body));
    atomicWriteFileSync(newDoc.filePath, render(newFm, newDoc.body));
  } catch (e) {
    return { ok: false, errors: [{ error: `write failed: ${e.message}` }] };
  }

  const indexed = rebuildIndex();
  return {
    ok: true,
    superseded: { id: oldId, file: oldDoc.relativePath, superseded_by: newId, superseded_at: stamp },
    successor: { id: newId, file: newDoc.relativePath, link_added: !linkExists },
    indexed,
  };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function withDb(fn) {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    return { error: "memory index not built; run `node bin/devt-tools.cjs memory index` first" };
  }
  const db = openDb(dbPath);
  try { return fn(db); } finally { db.close(); }
}

function getDoc(id) {
  return withDb(db => {
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
    if (!doc) return null;
    doc.affects_paths = db.prepare("SELECT pattern FROM affects WHERE doc_id = ? AND pattern IS NOT NULL").all(id).map(r => r.pattern);
    doc.affects_symbols = db.prepare("SELECT symbol, binding_confidence FROM affects WHERE doc_id = ? AND symbol IS NOT NULL").all(id);
    doc.links = db.prepare("SELECT target_id, link_type FROM links WHERE source_id = ?").all(id);
    if (doc.doc_type === "rejected") {
      doc.search_keywords = db.prepare("SELECT keyword FROM rejected_keywords WHERE doc_id = ?").all(id).map(r => r.keyword);
    }
    return doc;
  });
}

// Batch fetch of affects_paths for a list of doc IDs. One SQLite call instead
// of N×getDoc round trips when only the path projection is needed (preflight
// suggested-reading aggregation). Returns a flat deduped array of patterns.
function getAffectsPathsByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return withDb(db => {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT DISTINCT pattern FROM affects WHERE doc_id IN (${placeholders}) AND pattern IS NOT NULL`
    ).all(...ids);
    return rows.map(r => r.pattern);
  });
}

// Batch id → lifecycle metadata from the authoritative `documents` table.
// FTS rows carry status but not confidence; getLinks targets carry everything
// but arrive shape-mixed. One IN-query normalizes both for the preflight
// governing-union eligibility gate + Brief rendering.
function getDocsMeta(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return withDb(db => {
    const placeholders = ids.map(() => "?").join(",");
    return db.prepare(
      `SELECT id, doc_type, status, confidence, source_root FROM documents WHERE id IN (${placeholders})`
    ).all(...ids);
  });
}

// Most recent shared-root delta as persisted at index time (meta table).
// Null when the index has never run multi-root, the DB is absent, or the
// record is unparseable — consumers (health) treat null as nothing-to-report.
function getLastSharedDelta() {
  try {
    return withDb(db => {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'last_shared_delta'").get();
      if (!row || !row.value) return null;
      try { return JSON.parse(row.value); } catch { return null; }
    });
  } catch { return null; }
}

// Classify a doc's source_root as local vs shared and derive a short display
// label for shared roots. Null/absent source_root is treated as LOCAL: rows
// indexed before the column existed and single-root deployments must render
// with zero provenance noise. Label is the root's basename; only when two
// configured shared roots collide on basename does the parent segment join it
// (no config alias surface — that would front-run the planned {path, trust}
// entry form).
function sourceRootInfo(sourceRoot) {
  if (!sourceRoot || typeof sourceRoot !== "string") return { local: true, label: null };
  const localRoot = getMemoryRoot();
  const norm = path.normalize(sourceRoot);
  if (norm === localRoot) return { local: true, label: null };
  const base = path.basename(norm);
  let label = base;
  try {
    const siblings = getMemoryRoots().filter(r => r !== localRoot && r !== norm);
    if (siblings.some(r => path.basename(r) === base)) {
      label = `${path.basename(path.dirname(norm))}/${base}`;
    }
  } catch { /* roots unreadable — basename alone still identifies the doc as shared */ }
  return { local: false, label };
}

function matchesGlob(filePath, pattern) {
  if (pattern === filePath) return true;
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return filePath.startsWith(prefix);
  }
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    if (!filePath.startsWith(prefix)) return false;
    const remainder = filePath.slice(prefix.length + 1);
    return remainder !== "" && !remainder.includes("/");
  }
  if (pattern.includes("*")) {
    if (pattern.length > 256) return false; // defense-in-depth bound
    return globMatch(pattern, filePath);
  }
  return false;
}

/**
 * Pure-string glob matcher: `*` matches within a path segment (no `/`), `**`
 * matches across segments. Implemented via recursive descent — no RegExp, no
 * dynamic pattern construction. O(n*m) worst case where n=pattern length,
 * m=filePath length; both are bounded by the 256-char input cap above.
 */
function globMatch(pattern, str) {
  // Collapse `**/**/...` repeats — they're semantically equivalent to a single `**/`
  // and would otherwise multiply the recursive branching factor.
  pattern = pattern.replace(/(\*\*\/)+/g, "**/");
  function match(pi, si) {
    while (pi < pattern.length) {
      const pc = pattern[pi];
      if (pc === "*") {
        // Detect `**` (multi-segment) vs `*` (within-segment).
        const isDoubleStar = pattern[pi + 1] === "*";
        const nextPi = pi + (isDoubleStar ? 2 : 1);
        // Try every match position from current to end (or to next `/` for `*`).
        for (let k = si; k <= str.length; k++) {
          if (!isDoubleStar && k > si && str[k - 1] === "/") break;
          if (match(nextPi, k)) return true;
        }
        return false;
      }
      if (si >= str.length || str[si] !== pc) return false;
      pi++;
      si++;
    }
    return si === str.length;
  }
  return match(0, 0);
}

function getByPath(filePath) {
  return withDb(db => {
    const all = db.prepare(`
      SELECT d.*, a.pattern
      FROM documents d JOIN affects a ON d.id = a.doc_id
      WHERE a.pattern IS NOT NULL AND d.status IN ('active', 'candidate')
    `).all();
    const matches = [];
    for (const row of all) {
      if (matchesGlob(filePath, row.pattern)) matches.push(row);
    }
    return matches;
  });
}

function getBySymbol(symbol) {
  return withDb(db => db.prepare(`
    SELECT d.*, a.binding_confidence
    FROM documents d JOIN affects a ON d.id = a.doc_id
    WHERE a.symbol = ? COLLATE NOCASE AND d.status IN ('active', 'candidate')
  `).all(symbol));
}

function listActive(domain) {
  return withDb(db => {
    if (domain) {
      return db.prepare("SELECT * FROM documents WHERE status = 'active' AND domain = ? ORDER BY id").all(domain);
    }
    return db.prepare("SELECT * FROM documents WHERE status = 'active' ORDER BY id").all();
  });
}

function listRejectedKeywords() {
  return withDb(db => db.prepare(`
    SELECT d.id, d.title, d.summary, d.source_root, rk.keyword
    FROM documents d JOIN rejected_keywords rk ON d.id = rk.doc_id
    WHERE d.doc_type = 'rejected'
  `).all());
}

// Validate that an entry's declared symbols still exist in the current
// codebase. Catches stale memory entries that propagate as false-positive
// risk warnings (observed: a memory entry wrongly flagging "2-caller risk"
// for a symbol because stale claims propagated). Scope: ONLY entries whose
// doc_type is in the "risk warning" set — lessons + rejected (REJ
// tombstones). Decisions/concepts/flows are reference material, not
// propagating warnings — validating them adds cost without payback.
//
// Implementation uses doc.affects_symbols as the canonical list (no body
// regex extraction needed). Caps at 5 symbols per entry to bound cost.
// Fail-open: git unavailable / grep timeout → returns still_present:false
// (defensive — treat as missing rather than silently pass).
function validateRefs(doc) {
  const RISK_DOC_TYPES = ["lesson", "rejected"];
  if (!doc || !RISK_DOC_TYPES.includes(doc.doc_type)) return null;
  const symbols = Array.isArray(doc.affects_symbols)
    ? doc.affects_symbols.slice(0, 5).map(s => s.symbol || s).filter(s => typeof s === "string" && s.length > 0)
    : [];
  if (symbols.length === 0) {
    return { symbols: [], has_drift: false, summary: "no affects_symbols declared — nothing to validate" };
  }
  const { execFileSync } = require("child_process");
  const validated = [];
  for (const sym of symbols) {
    let stillPresent = false;
    let sample = null;
    try {
      // -l lists files; -F treats pattern as literal (avoids regex meta in
      // identifiers like dotted names); -- separator prevents flag parsing
      // of identifiers starting with -.
      const out = execFileSync("git", ["grep", "-l", "-F", "--", sym], {
        encoding: "utf8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const files = out.split("\n").filter(Boolean);
      stillPresent = files.length > 0;
      if (stillPresent) sample = files.slice(0, 3);
    } catch { /* not found OR git failure — fail-defensive */ }
    validated.push({ symbol: sym, still_present: stillPresent, sample_locations: sample });
  }
  const missing = validated.filter(v => !v.still_present);
  return {
    symbols: validated,
    has_drift: missing.length > 0,
    summary: missing.length > 0
      ? `${missing.length}/${validated.length} declared symbols no longer in codebase — entry may be stale`
      : `all ${validated.length} declared symbols still present`,
  };
}

function queryFTS(terms, opts) {
  const limit = (opts && opts.limit) || 20;
  // Optional doc_type filter: when set, restricts results to one of DOC_TYPES.
  // Whitelist-validated against DOC_TYPES so a typo or injection can never
  // reach the prepared statement as a free-form value.
  const docType = opts && opts.docType && DOC_TYPES.includes(opts.docType)
    ? opts.docType
    : null;
  // Aggregation modes — pre-filter CLI aggregations to cut token cost of
  // common probe-the-FTS-then-discard-most-rows patterns:
  // "full" — default; returns array of full rows
  // "count" — returns {count}; no rows
  // "domain-counts" — returns {counts: {<domain>: N, ...}}; no rows
  // "compact" — returns array of {id, title, doc_type} only (no summary/file_path/rank)
  const mode = (opts && opts.mode) || "full";
  return withDb(db => {
    // Tokenize on whitespace, strip FTS5 special chars per token, append * for
    // prefix matching. Multiple tokens AND together (FTS5 default). This makes
    // "argon" match "Argon2" and "auth jwt" match docs containing both terms
    // (or their prefixes). Quoted phrase queries are not supported in this
    // simple form — callers needing them can pre-escape.
    const tokens = terms.trim().split(/\s+/)
      .map(t => t.replace(/["()*+\-:^]/g, "").trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      if (mode === "count") return { count: 0 };
      if (mode === "domain-counts") return { counts: {} };
      return [];
    }
    const ftsQuery = tokens.map(t => `${t}*`).join(" ");
    const docTypeClause = docType ? " AND doc_type = ?" : "";
    try {
      if (mode === "count") {
        const sql = `SELECT COUNT(*) AS c FROM documents_fts WHERE documents_fts MATCH ?${docTypeClause}`;
        const row = docType ? db.prepare(sql).get(ftsQuery, docType) : db.prepare(sql).get(ftsQuery);
        return { count: row ? row.c : 0 };
      }
      if (mode === "domain-counts") {
        // Join FTS rows back to documents to read the indexed domain column.
        const sql = `SELECT d.domain AS domain, COUNT(*) AS c
                     FROM documents_fts f
                     JOIN documents d ON d.id = f.id
                     WHERE f.documents_fts MATCH ?${docType ? " AND d.doc_type = ?" : ""}
                     GROUP BY d.domain
                     ORDER BY c DESC`;
        const rows = docType ? db.prepare(sql).all(ftsQuery, docType) : db.prepare(sql).all(ftsQuery);
        const counts = {};
        for (const r of rows) counts[r.domain || "_uncategorized"] = r.c;
        return { counts };
      }
      if (mode === "compact") {
        const sql = `SELECT id, title, doc_type
                     FROM documents_fts
                     WHERE documents_fts MATCH ?${docTypeClause}
                     ORDER BY rank
                     LIMIT ?`;
        return docType
          ? db.prepare(sql).all(ftsQuery, docType, limit)
          : db.prepare(sql).all(ftsQuery, limit);
      }
      // default "full"
      const sql = `SELECT id, title, summary, file_path, doc_type, doc_class, status, rank
                   FROM documents_fts
                   WHERE documents_fts MATCH ?${docTypeClause}
                   ORDER BY rank
                   LIMIT ?`;
      return docType
        ? db.prepare(sql).all(ftsQuery, docType, limit)
        : db.prepare(sql).all(ftsQuery, limit);
    } catch (err) {
      // Malformed FTS5 query — return empty (or zero-shaped aggregate) rather than crash
      if (mode === "count") return { count: 0 };
      if (mode === "domain-counts") return { counts: {} };
      return [];
    }
  });
}

// Graph traversal lives in ./memory-graph.cjs (getLinks, getSubgraphTriples,
// getBacklinks, findOrphans, findStaleLinks). Re-exported below for the
// existing public API; consumers don't need to know the split.

function listDocs(docType) {
  return withDb(db => {
    if (docType) {
      return db.prepare("SELECT id, title, status, confidence, domain, file_path, source_root FROM documents WHERE doc_type = ? ORDER BY id").all(docType);
    }
    return db.prepare("SELECT id, title, doc_type, status, confidence, domain, file_path, source_root FROM documents ORDER BY doc_type, id").all();
  });
}

// affectsSymbol below — symbol-anchored docs lookup. Routes through
// graphify.cjs when available; otherwise returns degraded=true so callers
// fall back to grep.
// ---------------------------------------------------------------------------
// Portable bundle export / import
//
// Bundle format (JSON, schema_version=1):
// {
// schema_version: 1,
// exported_at: ISO,
// exported_from: <source project root>,
// doc_count: N,
// docs: [{ id, doc_type, frontmatter, body }, ...]
// }
//
// Export reads markdown files, parses frontmatter + body, emits JSON. Import
// reverses: regenerates markdown from the bundle. Conflict policy on import:
// default: skip if id exists
// --overwrite: replace existing file
// --prefix=X-: remap every id to X-ORIGINAL_ID (multi-source bundling)
// ---------------------------------------------------------------------------

// Export/import bundle operations live in ./memory-bundle.cjs.

function serializeFrontmatter(fm) {
  // Subset YAML emitter — handles strings, numbers, booleans, arrays of scalars,
  // arrays of objects (one level deep). Mirrors the parser's capabilities exactly.
  const lines = [];
  for (const [key, value] of Object.entries(fm)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) { lines.push(`${key}: []`); continue; }
      lines.push(`${key}:`);
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const keys = Object.keys(item);
          if (keys.length === 0) continue;
          lines.push(`  - ${keys[0]}: ${serializeScalar(item[keys[0]])}`);
          for (let i = 1; i < keys.length; i++) {
            lines.push(`    ${keys[i]}: ${serializeScalar(item[keys[i]])}`);
          }
        } else {
          lines.push(`  - ${serializeScalar(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${serializeScalar(value)}`);
    }
  }
  return lines.join("\n");
}

function serializeScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  // Strings: quote if contains : # or starts with - or has leading/trailing whitespace
  const s = String(v);
  if (/[:#]|^-|^\s|\s$/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

function affectsSymbol(symbol) {
  const dbResults = getBySymbol(symbol);
  let graphifyState = null;
  try {
    const graphify = require("./graphify.cjs");
    graphifyState = graphify.status();
  } catch {
    graphifyState = { state: "module_unavailable" };
  }
  return {
    symbol,
    docs: dbResults,
    graphify_state: graphifyState && graphifyState.state ? graphifyState.state : "disabled",
    degraded: !graphifyState || graphifyState.state !== "ready",
  };
}

// ---------------------------------------------------------------------------
// Validate (Phase 1: path-only — no Graphify yet)
// ---------------------------------------------------------------------------

/**
 * Resolve each affects_symbols entry through Graphify. Symbols that return
 * zero results are flagged as `stale-symbol` warnings — the canonical
 * "Refactor Safety" decay scenario from (a doc claims to govern
 * `UserService` but the class was renamed to `AccountService`).
 *
 * Gracefully no-ops when Graphify isn't ready (disabled in config, binary
 * missing, or graph cache absent). Symbol decay detection is opt-in based on
 * Graphify availability; the rest of validate() always runs.
 *
 * Caches per-symbol probes — many docs reference the same symbol, and each
 * Graphify query is a subprocess spawn.
 */
function validateSymbolsViaGraphify(docs) {
  let graphify;
  try { graphify = require("./graphify.cjs"); } catch { return []; }

  // Defer to graphify.status() as the authoritative readiness signal
  // BEFORE entering the per-symbol probe loop. The legacy path ran 3 probe
  // queries against the graph and aborted with GRAPHIFY_UNREACHABLE if any
  // subset failed consecutively — even when the orchestrator's impact-plan
  // path had successfully called blast_radius + get_neighbors seconds
  // earlier. Two consumers, two retry budgets, divergent verdicts. Sharing
  // a single status check gives validate the same "graphify is healthy"
  // signal the orchestrator already trusted. When status reports not-ready,
  // skip stale-symbol checks entirely with a STRUCTURED info-level note
  // instead of the legacy silent `return []` — users see explicitly why
  // the check was skipped rather than wondering whether validate ran the
  // symbol pass.
  const graphifyState = graphify.status();
  if (!graphifyState || graphifyState.state !== "ready") {
    return [{
      filePath: null,
      severity: "info",
      category: "graphify-not-ready",
      error: `Graphify state=${graphifyState ? graphifyState.state : "unavailable"} (${(graphifyState && graphifyState.reason) || "not_ready"}) — stale-symbol checks skipped`,
    }];
  }

  const issues = [];
  const probeCache = new Map();
  let consecutiveErrors = 0;
  let aborted = false;

  for (const doc of docs) {
    if (aborted) break;
    const fm = doc.frontmatter;
    if (!fm || !Array.isArray(fm.affects_symbols)) continue;
    for (const entry of fm.affects_symbols) {
      const symbol = typeof entry === "object" && entry !== null ? entry.symbol : entry;
      if (typeof symbol !== "string" || symbol.trim() === "") continue;

      if (!probeCache.has(symbol)) {
        const r = graphify.queryGraph(symbol);
        if (r && r.degraded) {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            // The validator's queryGraph probe is a SEPARATE code path from
            // the orchestrator's MCP dispatches. Observed: many successful
            // graphify MCP calls in the last hour with 0 errors while the
            // validator still claimed "3× consecutive failures". Check
            // _mcp-trace.jsonl for any successful graphify call in the
            // recent window — if found, the probe path is the one that's
            // broken, not graphify itself. Downgrade to info-only so the
            // warning surface doesn't cry wolf.
            //
            // Use session-anchor (first_created_at) instead of a fixed
            // minutes window. Graphify activity is bursty in real sessions
            // (many calls during context_init, then quiet); memory validate
            // typically runs HOURS after the burst, well past any
            // reasonable minutes window. Session-anchor semantic: "if THIS
            // session ever successfully called graphify, the probe failure
            // is anomalous". Override via
            // memory.graphify_probe_trace_window_minutes config for
            // projects that prefer a sliding window.
            let recentOk;
            let modeDescription;
            try {
              const cfg = require("./config.cjs").getMergedConfig();
              const cfgVal = cfg && cfg.memory && cfg.memory.graphify_probe_trace_window_minutes;
              if (Number.isFinite(cfgVal) && cfgVal > 0) {
                recentOk = recentSuccessfulGraphifyTraceCount(cfgVal);
                modeDescription = `in the last ${cfgVal} minutes`;
              } else {
                recentOk = recentSuccessfulGraphifyTraceCount({ sinceSessionAnchor: true });
                modeDescription = `since session start`;
              }
            } catch {
              recentOk = recentSuccessfulGraphifyTraceCount({ sinceSessionAnchor: true });
              modeDescription = `since session start`;
            }
            if (recentOk > 0) {
              issues.push({
                filePath: null,
                severity: "info",
                category: "graphify-probe-transient",
                error: `Internal stale-symbol probe failed ${consecutiveErrors}× but ${recentOk} graphify MCP calls succeeded ${modeDescription} — probe path independent from orchestrator's MCP transport. Stale-symbol checks deferred to next session.`,
              });
            } else {
              issues.push({
                filePath: null,
                severity: "warning",
                category: "graphify-unreachable",
                error: `Graphify queries failed ${consecutiveErrors}× consecutively despite graphify.status()=ready — stale-symbol checks aborted (transient outage; safe to retry or run \`graphify update .\` if persistent)`,
              });
            }
            aborted = true;
            break;
          }
          continue;
        }
        consecutiveErrors = 0;
        const count = Array.isArray(r && r.results) ? r.results.length : 0;
        probeCache.set(symbol, count > 0);
      }
      if (probeCache.has(symbol) && !probeCache.get(symbol)) {
        issues.push({
          filePath: doc.relativePath,
          severity: "warning",
          category: "stale-symbol",
          error: `affects_symbols entry "${symbol}" did not resolve via Graphify — likely renamed or removed`,
        });
      }
    }
  }
  return issues;
}

function validate() {
  const root = findProjectRoot();
  const docs = scanDocs();
  const issues = [];

  for (const doc of docs) {
    const fmErrors = validateFrontmatter(doc.frontmatter, doc.relativePath);
    issues.push(...fmErrors.map(e => ({ ...e, severity: "error", category: "frontmatter" })));

    if (!doc.frontmatter) continue;

    if (Array.isArray(doc.frontmatter.affects_paths)) {
      for (const pattern of doc.frontmatter.affects_paths) {
        const hasGlob = String(pattern).includes("*");
        if (!hasGlob && !fs.existsSync(path.join(root, pattern))) {
          issues.push({
            filePath: doc.relativePath,
            severity: "warning",
            category: "stale-path",
            error: `affects_paths entry "${pattern}" does not resolve to an existing file`,
          });
        }
      }
    }

    // Missing-affects: an active governing doc with no affects_paths is
    // structurally invisible to the affects-union memory_signal — the primary
    // review-time governance signal (prose-FTS is a demoted supplement that
    // never uniquely converted across field runs). Scoped to lineage-bearing
    // types, matching the orphaned-retirement check; lessons + REJ tombstones
    // legitimately carry no affects_paths.
    const _apDocType = doc.frontmatter.doc_type;
    const _apPaths = doc.frontmatter.affects_paths;
    if (["decision", "concept", "flow"].includes(_apDocType)
        && doc.frontmatter.status === "active"
        && (!Array.isArray(_apPaths) || _apPaths.length === 0)) {
      issues.push({
        filePath: doc.relativePath,
        severity: "warning",
        category: "missing-affects",
        error: `active ${_apDocType} has no affects_paths — invisible to the affects-union memory_signal (the primary review-time governance signal); add affects_paths so it can govern the files it applies to`,
      });
    }
  }

  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    const db = openDb(dbPath);
    try {
      const broken = db.prepare(`
        SELECT l.source_id, l.target_id, l.link_type
        FROM links l
        LEFT JOIN documents d ON d.id = l.target_id
        WHERE d.id IS NULL
      `).all();
      for (const b of broken) {
        issues.push({
          filePath: `(link from ${b.source_id})`,
          severity: "warning",
          category: "broken-link",
          error: `link points to non-existent doc: ${b.target_id} (${b.link_type})`,
        });
      }

      const selfLinks = db.prepare(`
        SELECT source_id, link_type
        FROM links
        WHERE source_id = target_id
      `).all();
      for (const s of selfLinks) {
        issues.push({
          filePath: `(link from ${s.source_id})`,
          severity: "warning",
          category: "self-link",
          error: `doc links to itself (${s.link_type}) — likely authoring mistake`,
        });
      }

      // Supersession consistency. A `supersedes` link asserts its target is
      // retired; a target still active/candidate means the retirement never
      // happened (or was reverted) — retrieval would surface BOTH docs as
      // governing, which is exactly the contradiction the link exists to
      // prevent.
      const contradictions = db.prepare(`
        SELECT l.source_id, l.target_id, d.status AS target_status
        FROM links l JOIN documents d ON d.id = l.target_id
        WHERE l.link_type = 'supersedes' AND d.status IN ('active', 'candidate')
      `).all();
      for (const c of contradictions) {
        issues.push({
          filePath: `(link from ${c.source_id})`,
          severity: "error",
          category: "supersession-contradiction",
          error: `${c.source_id} supersedes ${c.target_id}, but ${c.target_id} is still status: ${c.target_status} — run \`memory supersede ${c.target_id} ${c.source_id}\` to retire it atomically`,
        });
      }

      // Orphaned retirement: a superseded ADR/CON/FLOW with no incoming
      // supersedes link has untraceable lineage. Scoped to lineage-bearing
      // types — lessons and REJ tombstones legitimately retire without a
      // successor (curator archival), so they are exempt.
      const orphanedRetirements = db.prepare(`
        SELECT d.id, d.doc_type FROM documents d
        WHERE d.status = 'superseded'
          AND d.doc_type IN ('decision', 'concept', 'flow')
          AND NOT EXISTS (
            SELECT 1 FROM links l WHERE l.target_id = d.id AND l.link_type = 'supersedes'
          )
      `).all();
      for (const o of orphanedRetirements) {
        issues.push({
          filePath: `(doc ${o.id})`,
          severity: "warning",
          category: "orphaned-retirement",
          error: `${o.id} is superseded but no doc carries a supersedes link to it — lineage is untraceable (use \`memory supersede\` for two-sided retirement)`,
        });
      }
    } finally {
      db.close();
    }
  }

  issues.push(...validateSymbolsViaGraphify(docs));

  return {
    docs_scanned: docs.length,
    issues,
    summary: {
      errors: issues.filter(i => i.severity === "error").length,
      warnings: issues.filter(i => i.severity === "warning").length,
    },
  };
}

// ---------------------------------------------------------------------------
// Init: scaffold .devt/memory/{decisions,concepts,flows,rejected,lessons}/ + first index
// ---------------------------------------------------------------------------

function init() {
  const root = getMemoryRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

  const created = [];
  for (const docType of DOC_TYPES) {
    const subdir = getSubdirPath(docType);
    if (!fs.existsSync(subdir)) {
      fs.mkdirSync(subdir, { recursive: true });
      created.push(path.relative(findProjectRoot(), subdir));
    }
  }

  const result = rebuildIndex();
  return {
    created,
    memory_root: path.relative(findProjectRoot(), root),
    db_path: path.relative(findProjectRoot(), getDbPath()),
    ...result,
  };
}

// ---------------------------------------------------------------------------
// CLI dispatcher
// ---------------------------------------------------------------------------

function run(subcommand, args) {
  const json = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");

  switch (subcommand) {
    case "init": {
      json(init());
      return 0;
    }
    case "index": {
      json(rebuildIndex());
      return 0;
    }
    case "query": {
      const terms = args.filter(a => !a.startsWith("--")).join(" ");
      if (!terms.trim()) {
        process.stderr.write("Usage: memory query <terms> [--limit=N] [--doc-type=decision|concept|flow|rejected|lesson] [--count|--top=N|--domain-counts|--json-compact|--signal[=N]] [--validate-refs]\n");
        return 2;
      }
      const wantValidateRefs = args.includes("--validate-refs");
      const limitArg = args.find(a => a.startsWith("--limit="));
      const topArg = args.find(a => a.startsWith("--top="));
      const signalArg = args.find(a => a === "--signal" || a.startsWith("--signal="));
      const docTypeArg = args.find(a => a.startsWith("--doc-type="));
      const docType = docTypeArg ? docTypeArg.split("=")[1] : null;
      if (docType && !DOC_TYPES.includes(docType)) {
        process.stderr.write(`Invalid --doc-type: ${docType}. Allowed: ${DOC_TYPES.join("|")}\n`);
        return 2;
      }
      // --signal — combined mode that returns BOTH domain-counts AND top-N rows
      // in one payload. Wins over the mutually-exclusive aggregate flags below
      // so verifier-dispatch orchestration can fetch the full memory signal
      // in a single CLI call. Default N=3; cap at 10 to keep payload small.
      if (signalArg) {
        const signalN = signalArg.includes("=")
          ? Math.max(1, Math.min(10, parseInt(signalArg.split("=")[1], 10) || 3))
          : 3;
        const counts = queryFTS(terms, { limit: 50, docType, mode: "domain-counts" });
        const top = queryFTS(terms, { limit: signalN, docType, mode: "compact" });
        json({ query: terms, doc_type: docType, mode: "signal", counts: counts.counts, top });
        return 0;
      }
      // Aggregate modes — at most one wins; precedence:
      // --count > --domain-counts > --top > --json-compact > full.
      const wantCount = args.includes("--count");
      const wantDomain = args.includes("--domain-counts");
      const wantCompact = args.includes("--json-compact");
      const hasTop = !!topArg;
      // Input validation: --limit must be a positive integer when present.
      // Without this guard, `--limit=garbage` passes NaN through to the
      // FTS5 query (which falls back to its own default of 20) and
      // `--limit=-5` runs against the prepared statement with negative
      // bound, both producing silent-wrong-results — same bug class as
      // the dispatch/mcp-stats/token-report fixes in this cycle.
      let limit;
      if (limitArg) {
        const limitVal = limitArg.split("=")[1];
        const limitN = Number(limitVal);
        if (!Number.isInteger(limitN) || limitN < 1) {
          process.stderr.write(`memory query: invalid --limit value "${limitVal}" (expected positive integer ≥ 1)\n`);
          return 2;
        }
        limit = limitN;
      } else {
        limit = 20;
      }
      let mode = "full";
      if (wantCount) mode = "count";
      else if (wantDomain) mode = "domain-counts";
      else if (hasTop) { mode = "compact"; limit = Math.max(1, parseInt(topArg.split("=")[1], 10) || 5); }
      else if (wantCompact) mode = "compact";
      const out = queryFTS(terms, { limit, docType, mode });
      // --validate-refs enriches full-mode results with affects_symbols
      // existence check. Only fires on full mode (aggregates have no
      // row-level payload). Scope-filtered inside validateRefs (only
      // lesson/rejected entries get validated; others return null).
      if (wantValidateRefs && mode === "full" && Array.isArray(out)) {
        for (const result of out) {
          if (result && result.id) {
            try {
              const doc = getDoc(result.id);
              const refs = validateRefs(doc);
              if (refs) result.validated_refs = refs;
            } catch { /* validate-refs is best-effort enrichment */ }
          }
        }
      }
      if (mode === "count") json({ query: terms, doc_type: docType, count: out.count });
      else if (mode === "domain-counts") json({ query: terms, doc_type: docType, counts: out.counts });
      else json({ query: terms, limit, doc_type: docType, mode, results: out, validate_refs: wantValidateRefs });
      return 0;
    }
    case "get": {
      if (!args[0]) {
        process.stderr.write("Usage: memory get <doc-id>\n");
        return 2;
      }
      const doc = getDoc(args[0]);
      if (!doc) { process.stderr.write(`Not found: ${args[0]}\n`); return 1; }
      json(doc);
      return 0;
    }
    case "affects": {
      if (!args[0]) {
        process.stderr.write("Usage: memory affects <file-path>\n");
        return 2;
      }
      json({ path: args[0], matches: getByPath(args[0]) });
      return 0;
    }
    case "list": {
      const docType = args[0] && DOC_TYPES.includes(args[0]) ? args[0] : null;
      json({ doc_type: docType, docs: listDocs(docType) });
      return 0;
    }
    case "links": {
      if (!args[0]) {
        process.stderr.write("Usage: memory links <doc-id> [--depth=N]\n");
        return 2;
      }
      const depthArg = args.find(a => a.startsWith("--depth="));
      let depth = 2;
      if (depthArg) {
        const depthVal = depthArg.split("=")[1];
        const depthN = Number(depthVal);
        if (!Number.isInteger(depthN) || depthN < 1) {
          process.stderr.write(`memory links: invalid --depth value "${depthVal}" (expected positive integer ≥ 1)\n`);
          return 2;
        }
        depth = depthN;
      }
      json({ doc_id: args[0], depth, links: getLinks(args[0], depth) });
      return 0;
    }
    case "active": {
      const domain = args[0] || null;
      json({ domain, docs: listActive(domain) });
      return 0;
    }
    case "rejected-keywords": {
      json({ entries: listRejectedKeywords() });
      return 0;
    }
    case "validate": {
      json(validate());
      return 0;
    }
    case "supersede": {
      const positional = args.filter(a => !a.startsWith("--"));
      const reasonArg = args.find(a => a.startsWith("--reason="));
      const result = supersede(positional[0], positional[1], {
        reason: reasonArg ? reasonArg.slice("--reason=".length) : null,
      });
      json(result);
      return result.ok ? 0 : 1;
    }
    case "backlinks": {
      if (!args[0]) { process.stderr.write("Usage: memory backlinks <doc-id>\n"); return 2; }
      json({ doc_id: args[0], backlinks: getBacklinks(args[0]) });
      return 0;
    }
    case "orphans": {
      json({ orphans: findOrphans() });
      return 0;
    }
    case "stale-links": {
      json({ stale: findStaleLinks() });
      return 0;
    }
    case "affects-symbol": {
      if (!args[0]) { process.stderr.write("Usage: memory affects-symbol <symbol>\n"); return 2; }
      json(affectsSymbol(args[0]));
      return 0;
    }
    case "paths": {
      // memory paths [--validate] — echo resolved memory roots in scan order.
      // --validate flag: stat each root and surface missing dirs as errors.
      const validate = args.includes("--validate");
      const roots = getMemoryRoots();
      const result = roots.map(p => {
        const exists = fs.existsSync(p);
        const r = { path: p, exists };
        if (validate && !exists) {
          r.error = "MEM_PATH_UNREACHABLE";
          r.hint = "directory does not exist; check git submodule init / NFS mount / sibling clone";
        }
        return r;
      });
      const errorCount = validate ? result.filter(r => !r.exists).length : 0;
      json({
        roots: result,
        count: roots.length,
        project_local: roots[roots.length - 1],
        validation: validate ? { errors: errorCount } : null,
      });
      return errorCount > 0 ? 1 : 0;
    }
    case "diff": {
      // memory diff <root-a> <root-b> — surface added/removed/changed docs between two roots.
      // Both arguments are absolute paths or paths relative to project root. Useful for
      // reviewing what a `git pull` in a shared root just brought in.
      if (!args[0] || !args[1]) {
        process.stderr.write("Usage: memory diff <root-a> <root-b>\n");
        return 2;
      }
      const root = require("./config.cjs").findProjectRoot();
      const resolveRoot = p => {
        if (typeof p !== "string" || p.length === 0 || p.length > 4096 || p.includes("\0")) {
          throw new Error(`invalid root: ${p}`);
        }
        return path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.join(root, p));
      };
      const rootA = resolveRoot(args[0]);
      const rootB = resolveRoot(args[1]);
      const scanRoot = (r) => {
        const docs = new Map();
        if (!fs.existsSync(r)) return docs;
        for (const docType of DOC_TYPES) {
          const subdir = path.join(r, SUBDIR_BY_TYPE[docType]);
          if (!fs.existsSync(subdir)) continue;
          for (const entry of fs.readdirSync(subdir)) {
            if (entry.startsWith("_")) continue;
            if (!entry.endsWith(".md")) continue;
            const full = path.join(subdir, entry);
            const parsed = readDocFile(full);
            if (!parsed || !parsed.frontmatter || !parsed.frontmatter.id) continue;
            // Hash the body+frontmatter for change detection
            const crypto = require("crypto");
            const fp = crypto.createHash("sha256")
              .update(JSON.stringify(parsed.frontmatter) + "\n" + parsed.body)
              .digest("hex").slice(0, 16);
            docs.set(parsed.frontmatter.id, { id: parsed.frontmatter.id, doc_type: docType, file: full, fingerprint: fp });
          }
        }
        return docs;
      };
      const a = scanRoot(rootA);
      const b = scanRoot(rootB);
      const added = []; const removed = []; const changed = []; const unchanged = [];
      for (const [id, docB] of b) {
        const docA = a.get(id);
        if (!docA) added.push({ id, doc_type: docB.doc_type, file: docB.file });
        else if (docA.fingerprint !== docB.fingerprint) {
          changed.push({ id, doc_type: docB.doc_type, file_a: docA.file, file_b: docB.file });
        } else {
          unchanged.push(id);
        }
      }
      for (const [id, docA] of a) {
        if (!b.has(id)) removed.push({ id, doc_type: docA.doc_type, file: docA.file });
      }
      json({
        root_a: rootA, root_b: rootB,
        a_count: a.size, b_count: b.size,
        added, removed, changed,
        unchanged_count: unchanged.length,
      });
      return 0;
    }
    case "export": {
      // memory export [--out=PATH] [--include=decision,concept,flow,rejected] [--all-roots]
      // Writes a portable JSON bundle of selected docs (frontmatter + body).
      // Default output: .devt/memory/export-<ISO>.json. Default include: all four types.
      // Default scope: project-local root only (shared roots typically have their own
      // bundling pipeline). --all-roots includes every configured root, last-wins-deduped.
      const outArg = args.find(a => a.startsWith("--out="));
      const incArg = args.find(a => a.startsWith("--include="));
      const allRoots = args.includes("--all-roots");
      const includeTypes = incArg
        ? incArg.split("=")[1].split(",").filter(t => DOC_TYPES.includes(t))
        : DOC_TYPES.slice();
      const result = exportBundle({ includeTypes, allRoots });
      const defaultName = `export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const requestedOut = outArg ? outArg.split("=")[1] : path.join(getMemoryRoot(), defaultName);
      const resolved = resolveExportPath(requestedOut);
      atomicWriteJsonSync(resolved, result);
      json({ exported_to: resolved, doc_count: result.docs.length, exported_at: result.exported_at });
      return 0;
    }
    case "import": {
      // memory import <bundle.json> [--overwrite] [--prefix=NEW-]
      // Default: skip docs whose id already exists. --overwrite replaces; --prefix=X-
      // remaps every id to X-ORIGINAL (avoids collisions when bundling from multiple sources).
      if (!args[0]) { process.stderr.write("Usage: memory import <bundle.json> [--overwrite] [--prefix=NEW-]\n"); return 2; }
      const bundlePath = resolveImportPath(args[0]);
      const overwrite = args.includes("--overwrite");
      const prefixArg = args.find(a => a.startsWith("--prefix="));
      const prefix = prefixArg ? prefixArg.split("=")[1] : null;
      const result = importBundle(bundlePath, { overwrite, prefix });
      json(result);
      return 0;
    }
    case "suggest": {
      // Discovery engine — harvests #KNOWLEDGE-CANDIDATE + DEC-xxx + graphify god-nodes
      // entries into _suggestions.md for curator review. NEVER writes permanent doc files.
      //
      // The auto-index PostToolUse hook reindexes per-file edits but doesn't
      // observe writeSuggestionsReport's atomic write to _suggestions.md
      // (atomicWriteFileSync uses rename-after-tmp-write which the hook's
      // mtime-watch may miss). Result: FTS5 index drifts behind
      // _suggestions.md until the next manual edit triggers a hook fire.
      // Fix: invoke rebuildIndex immediately after writeSuggestionsReport
      // so the index stays current with the document the CLI just produced.
      const discovery = require("./discovery.cjs");
      const result = discovery.harvest({});
      const suggestionsPath = discovery.writeSuggestionsReport(result);
      let indexResult = null;
      try { indexResult = rebuildIndex(); }
      catch (e) { indexResult = { ok: false, error: e.message }; }
      json({
        ...result,
        suggestions_path: path.relative(findProjectRoot(), suggestionsPath),
        index_refresh: indexResult,
      });
      return 0;
    }
    case "candidates-status": {
      // B-III.1 surface metadata: drives the passive memory-candidate
      // surfacing across SessionStart, /devt:next, and present_findings
      // footers. Count is sourced from _suggestions.md proposal headings
      // (### ⚖️ / ### 🔵 / ### 🔄) — the canonical curator inbox. The
      // cooldown timestamp lives at .devt/memory/.last-candidate-surface
      // (NEVER committed; gitignored as a hidden file). Consumers should
      // treat ready_to_surface as the only call-to-action signal; count
      // alone is informational.
      const cfg = require("./config.cjs").getMergedConfig().memory || {};
      const threshold = Number.isInteger(cfg.candidates_surface_threshold) ? cfg.candidates_surface_threshold : 5;
      const cooldownHours = Number.isFinite(cfg.candidates_surface_cooldown_hours) ? cfg.candidates_surface_cooldown_hours : 24;
      const root = findProjectRoot();
      const suggestionsPath = path.join(root, ".devt", "memory", "_suggestions.md");
      const cooldownPath = path.join(root, ".devt", "memory", ".last-candidate-surface");
      let count = 0;
      if (fs.existsSync(suggestionsPath)) {
        try {
          const content = fs.readFileSync(suggestionsPath, "utf8");
          count = (content.match(/^### [⚖️🔵🔄]/gmu) || []).length;
        } catch { /* count stays 0 */ }
      }
      let lastSurfacedAt = null;
      let hoursSinceLast = null;
      if (fs.existsSync(cooldownPath)) {
        try {
          const ts = fs.readFileSync(cooldownPath, "utf8").trim();
          const parsed = new Date(ts).getTime();
          if (!isNaN(parsed)) {
            lastSurfacedAt = new Date(parsed).toISOString();
            hoursSinceLast = (Date.now() - parsed) / 3_600_000;
          }
        } catch { /* fields stay null */ }
      }
      const aboveThreshold = count >= threshold;
      const cooldownPassed = hoursSinceLast === null || hoursSinceLast >= cooldownHours;
      json({
        count,
        threshold,
        above_threshold: aboveThreshold,
        last_surfaced_at: lastSurfacedAt,
        hours_since_last_surface: hoursSinceLast,
        cooldown_hours: cooldownHours,
        cooldown_passed: cooldownPassed,
        ready_to_surface: aboveThreshold && cooldownPassed,
      });
      return 0;
    }
    case "candidates-touch-surface": {
      // Update the surface-tracking timestamp. Called by consumers AFTER
      // they emit the hint to the user (SessionStart hook, /devt:next,
      // present_findings footer). The next candidates-status call will
      // then report cooldown_passed=false until the cooldown window
      // elapses, suppressing duplicate hints within a single session.
      const root = findProjectRoot();
      const memDir = path.join(root, ".devt", "memory");
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
      const cooldownPath = path.join(memDir, ".last-candidate-surface");
      const ts = new Date().toISOString();
      fs.writeFileSync(cooldownPath, ts + "\n", "utf8");
      json({ ok: true, touched_at: ts });
      return 0;
    }
    case "candidates-footer": {
      // Finalize-footer convenience wrapper. Replaces the 7-line bash block
      // previously inlined in code-review.md, code-review-parallel.md,
      // quick-implement.md::finalize, dev-workflow.md::finalize — each of
      // which composed candidates-status + a jq probe + candidates-touch-surface
      // by hand. Centralizing here eliminates the drift surface their
      // KEEP IN SYNC prose comments had been trying to enforce.
      //
      // Contract: ALWAYS emits one status line carrying the three decision
      // inputs (count / threshold / cooldown) — silence below threshold was
      // field-indistinguishable from the command never executing at all.
      // When ready_to_surface, additionally emits the canonical 💭 hint and
      // touches the cooldown. Always exits 0 — surface failure is best-effort.
      //
      // Does NOT serve /devt:next's variant, which needs ready_to_surface as
      // a shell variable to gate a downstream AskUserQuestion. That call site
      // keeps the underlying candidates-status primitive.
      const cfg = require("./config.cjs").getMergedConfig().memory || {};
      const threshold = Number.isInteger(cfg.candidates_surface_threshold) ? cfg.candidates_surface_threshold : 5;
      const cooldownHours = Number.isFinite(cfg.candidates_surface_cooldown_hours) ? cfg.candidates_surface_cooldown_hours : 24;
      const root = findProjectRoot();
      const suggestionsPath = path.join(root, ".devt", "memory", "_suggestions.md");
      const cooldownPath = path.join(root, ".devt", "memory", ".last-candidate-surface");
      let count = 0;
      if (fs.existsSync(suggestionsPath)) {
        try {
          const content = fs.readFileSync(suggestionsPath, "utf8");
          count = (content.match(/^### [⚖️🔵🔄]/gmu) || []).length;
        } catch { /* count stays 0 */ }
      }
      let hoursSinceLast = null;
      if (fs.existsSync(cooldownPath)) {
        try {
          const ts = fs.readFileSync(cooldownPath, "utf8").trim();
          const parsed = new Date(ts).getTime();
          if (!isNaN(parsed)) hoursSinceLast = (Date.now() - parsed) / 3_600_000;
        } catch { /* stays null */ }
      }
      const cooldownOk = hoursSinceLast === null || hoursSinceLast >= cooldownHours;
      const ready = count >= threshold && cooldownOk;
      process.stdout.write(`[memory] candidates-footer: ${count} pending / threshold ${threshold} / cooldown ${cooldownOk ? "ok" : "blocked"}\n`);
      if (ready) {
        process.stdout.write(`\n💭 ${count} memory candidates pending in .devt/memory/_suggestions.md — run /devt:memory promote to triage.\n`);
        try {
          const memDir = path.join(root, ".devt", "memory");
          if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
          fs.writeFileSync(cooldownPath, new Date().toISOString() + "\n", "utf8");
        } catch { /* best-effort */ }
      }
      return 0;
    }
    case "promote":
    case "reject": {
      // These subcommands are routed to curator via workflows/memory-promote.md and
      // workflows/memory-reject.md. The CLI itself does NOT write permanent files —
      // curator agent dispatches AskUserQuestion approval flow. Surface a hint.
      process.stderr.write(
        `\n${subcommand} is curator-gated. Run via the slash command:\n` +
        `  /devt:memory ${subcommand} ${args.join(" ")}\n` +
        `which routes through workflows/memory-${subcommand}.md and dispatches the curator agent\n` +
        `with the memory-curation skill. The curator presents AskUserQuestion proposals; only on\n` +
        `your approval does the markdown file get written. NEVER auto-promotes.\n`
      );
      return 2;
    }
    default:
      process.stderr.write(
        `Unknown memory subcommand: ${subcommand}\n` +
        `Valid: init | index | query | get | affects | list | links | active | rejected-keywords |\n` +
        `       validate | supersede | backlinks | orphans | stale-links | affects-symbol | suggest |\n` +
        `       candidates-status | candidates-touch-surface | candidates-footer |\n` +
        `       paths | diff | export | import |\n` +
        `       promote (via /devt:memory) | reject (via /devt:memory)\n`
      );
      return 2;
  }
}

module.exports = {
  run,
  init,
  getByPath,
  rebuildIndex,
  validate,
  validateRefs,
  getDoc,
  getDocsMeta,
  sourceRootInfo,
  getLastSharedDelta,
  getAffectsPathsByIds,
  getByPath,
  getBySymbol,
  supersede,
  listActive,
  listRejectedKeywords,
  queryFTS,
  getLinks,
  getSubgraphTriples,
  listDocs,
  scanDocs,
  recentSuccessfulGraphifyTraceCount,
  parseFrontmatter,
  validateFrontmatter,
  matchesGlob,
  getMemoryRoot,
  getMemoryRoots,
  getSubdirPathFor,
  getDbPath,
  getSubdirPath,
  getBacklinks,
  findOrphans,
  findStaleLinks,
  affectsSymbol,
  DOC_TYPES,
  STATUS_VALUES,
  CONFIDENCE_VALUES,
  LINK_TYPES,
  SCHEMA_VERSION,
  upsertDoc,
  ID_PATTERN_BY_TYPE,
  SUBDIR_BY_TYPE,
  // Exported so sibling sub-modules (memory-graph.cjs, memory-bundle.cjs) can
  // lazy-require them for shared DB access, YAML parsing, project-root lookup,
  // and frontmatter serialization without duplicating logic across files.
  withDb,
  findProjectRoot,
  parseYamlSubset,
  serializeFrontmatter,
  // Bundle re-exports (live in ./memory-bundle.cjs).
  resolveExportPath,
  resolveImportPath,
  exportBundle,
  importBundle,
};
