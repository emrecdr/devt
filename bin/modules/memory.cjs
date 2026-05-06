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
 *  - Atomic rebuild: drop all tables in a transaction, re-insert, commit.
 *  - Files prefixed with `_` (e.g. `_suggestions.md`, `_index.md`) are NEVER indexed
 *    as first-class docs — they are auto-generated reports.
 *  - Documents.id is unique across all four doc_types.
 *  - links.target_id has NO FK constraint — forward references to not-yet-created
 *    docs are valid; `memory validate` flags broken links separately.
 */

const fs = require("fs");
const path = require("path");
const { safeJsonParse } = require("./security.cjs");
const { atomicWriteFileSync, atomicWriteJsonSync } = require("./io.cjs");

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
 * Resolve the configured list of memory roots (v0.22.0+).
 * Returns absolute paths in scan order. Project-local (.devt/memory) is always
 * the LAST entry so it wins ID collisions per the last-wins precedence rule.
 *
 * Each path is validated:
 *   - relative paths resolve against the project root
 *   - `..` segments after normalization are allowed (shared dirs are often siblings)
 *     BUT the resolved path must still be a real existing directory
 *   - null bytes rejected
 *   - duplicates collapsed (preserving first occurrence to keep precedence stable)
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

  -- Views (CCA v21.0 §10, adapted). Survive atomic rebuildIndex() because
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
 */
function rebuildIndex() {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

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

    db.prepare("COMMIT").run();
  } catch (err) {
    try { db.prepare("ROLLBACK").run(); } catch { /* swallow */ }
    db.close();
    throw err;
  }
  db.close();

  const conflicts = (docs && docs._conflicts) || [];
  const roots = getMemoryRoots();
  return {
    inserted,
    skipped: validationErrors.length,
    errors: validationErrors,
    last_built_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    memory_roots: roots,
    conflicts,
    conflict_count: conflicts.length,
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
    SELECT d.id, d.title, d.summary, rk.keyword
    FROM documents d JOIN rejected_keywords rk ON d.id = rk.doc_id
    WHERE d.doc_type = 'rejected'
  `).all());
}

function queryFTS(terms, opts) {
  const limit = (opts && opts.limit) || 20;
  // Optional doc_type filter: when set, restricts results to one of DOC_TYPES.
  // Whitelist-validated against DOC_TYPES so a typo or injection can never
  // reach the prepared statement as a free-form value.
  const docType = opts && opts.docType && DOC_TYPES.includes(opts.docType)
    ? opts.docType
    : null;
  return withDb(db => {
    // Tokenize on whitespace, strip FTS5 special chars per token, append * for
    // prefix matching. Multiple tokens AND together (FTS5 default). This makes
    // "argon" match "Argon2" and "auth jwt" match docs containing both terms
    // (or their prefixes). Quoted phrase queries are not supported in this
    // simple form — callers needing them can pre-escape.
    const tokens = terms.trim().split(/\s+/)
      .map(t => t.replace(/["()*+\-:^]/g, "").trim())
      .filter(Boolean);
    if (tokens.length === 0) return [];
    const ftsQuery = tokens.map(t => `${t}*`).join(" ");
    const sql = docType
      ? `SELECT id, title, summary, file_path, doc_type, doc_class, status, rank
         FROM documents_fts
         WHERE documents_fts MATCH ? AND doc_type = ?
         ORDER BY rank
         LIMIT ?`
      : `SELECT id, title, summary, file_path, doc_type, doc_class, status, rank
         FROM documents_fts
         WHERE documents_fts MATCH ?
         ORDER BY rank
         LIMIT ?`;
    try {
      return docType
        ? db.prepare(sql).all(ftsQuery, docType, limit)
        : db.prepare(sql).all(ftsQuery, limit);
    } catch (err) {
      // Malformed FTS5 query — return empty rather than crash
      return [];
    }
  });
}

function getLinks(docId, depth) {
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

function listDocs(docType) {
  return withDb(db => {
    if (docType) {
      return db.prepare("SELECT id, title, status, confidence, domain, file_path, source_root FROM documents WHERE doc_type = ? ORDER BY id").all(docType);
    }
    return db.prepare("SELECT id, title, doc_type, status, confidence, domain, file_path, source_root FROM documents ORDER BY doc_type, id").all();
  });
}

// ---------------------------------------------------------------------------
// Phase 2 helpers — backlinks, orphans, stale-links, affects-symbol
// ---------------------------------------------------------------------------

/**
 * Find all docs that link TO the given doc_id. Load-bearing for safe ADR
 * supersession: before retiring ADR-007, see what depends on it.
 */
function getBacklinks(docId) {
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

/**
 * Symbol-anchored docs lookup. Routes through graphify.cjs when available;
 * otherwise returns a payload with degraded=true so callers fall back to grep.
 */
// ---------------------------------------------------------------------------
// Portable bundle export / import (v0.20.0+)
//
// Bundle format (JSON, schema_version=1):
//   {
//     schema_version: 1,
//     exported_at: ISO,
//     exported_from: <source project root>,
//     doc_count: N,
//     docs: [{ id, doc_type, frontmatter, body }, ...]
//   }
//
// Export reads markdown files, parses frontmatter + body, emits JSON. Import
// reverses: regenerates markdown from the bundle. Conflict policy on import:
//   default: skip if id exists
//   --overwrite: replace existing file
//   --prefix=X-: remap every id to X-ORIGINAL_ID (multi-source bundling)
// ---------------------------------------------------------------------------

/**
 * Resolve a user-supplied --out= path. Rules:
 *   - relative paths: resolved against project root, MUST stay inside project root
 *   - absolute paths: allowed (user explicitly chose external destination)
 *   - reject `..` segments after normalization on relative paths
 *   - reject null bytes
 */
function resolveExportPath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 4096) {
    throw new Error("--out path is invalid (empty or too long)");
  }
  if (p.includes("\0")) throw new Error("--out path contains null bytes");
  if (path.isAbsolute(p)) return path.normalize(p);
  const root = findProjectRoot();
  const joined = path.normalize(path.join(root, p));
  // Containment check — joined must remain inside (or equal to) the project root
  const rel = path.relative(root, joined);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("--out path resolves outside project root after normalization");
  }
  return joined;
}

/**
 * Resolve a user-supplied bundle path for import.
 *   - relative resolved against cwd
 *   - absolute allowed
 *   - reject null bytes; reject if file doesn't exist
 */
function resolveImportPath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 4096) {
    throw new Error("import path is invalid (empty or too long)");
  }
  if (p.includes("\0")) throw new Error("import path contains null bytes");
  const resolved = path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.join(process.cwd(), p));
  if (!fs.existsSync(resolved)) throw new Error(`bundle file not found: ${resolved}`);
  return resolved;
}

function readDocFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;
  const fm = parseYamlSubset(fmMatch[1]);
  const body = fmMatch[2];
  return { frontmatter: fm, body };
}

function exportBundle(opts) {
  opts = opts || {};
  const includeTypes = opts.includeTypes || DOC_TYPES.slice();
  // v0.22.0+: by default, bundle ONLY the project-local root. Shared roots are
  // typically maintained as their own repos with their own bundling — exporting
  // them here would be a copy that drifts from upstream. Pass allRoots:true to
  // bundle the union (last-wins-deduped) for multi-root archival use cases.
  const allRoots = !!opts.allRoots;
  const roots = allRoots ? getMemoryRoots() : [getMemoryRoot()];
  const docsById = new Map();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const docType of includeTypes) {
      const subdir = getSubdirPathFor(root, docType);
      if (!fs.existsSync(subdir)) continue;
      for (const entry of fs.readdirSync(subdir)) {
        if (entry.startsWith("_")) continue;
        if (!entry.endsWith(".md")) continue;
        const full = path.join(subdir, entry);
        const parsed = readDocFile(full);
        if (!parsed || !parsed.frontmatter || !parsed.frontmatter.id) continue;
        // Last-wins: later root in the list overwrites earlier. Project-local
        // is always last (per getMemoryRoots), so it wins.
        docsById.set(parsed.frontmatter.id, {
          id: parsed.frontmatter.id,
          doc_type: docType,
          filename: entry,
          source_root: root,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
        });
      }
    }
  }
  const docs = Array.from(docsById.values()).sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    exported_from: findProjectRoot(),
    exported_roots: roots,
    all_roots_mode: allRoots,
    doc_count: docs.length,
    include_types: includeTypes,
    docs,
  };
}

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

function importBundle(bundlePath, opts) {
  opts = opts || {};
  const overwrite = !!opts.overwrite;
  const prefix = opts.prefix || null;

  let bundle;
  let raw;
  try {
    raw = fs.readFileSync(bundlePath, "utf8");
  } catch (e) {
    throw new Error(`bundle file unreadable: ${e.message}`);
  }
  // 50MB cap — legitimate bundles can aggregate hundreds of ADR docs.
  const parseResult = safeJsonParse(raw, "bundle file", 50 * 1024 * 1024);
  if (!parseResult.ok) {
    throw new Error(`bundle file unreadable: ${parseResult.error}`);
  }
  bundle = parseResult.value;
  if (!bundle || !Array.isArray(bundle.docs)) {
    throw new Error("bundle missing required `docs` array");
  }
  if (bundle.schema_version && bundle.schema_version !== SCHEMA_VERSION) {
    throw new Error(`bundle schema_version=${bundle.schema_version} does not match current SCHEMA_VERSION=${SCHEMA_VERSION}`);
  }
  // Validate prefix shape: alphanumeric + dash, ≤16 chars, ends with -
  if (prefix !== null) {
    if (!/^[A-Z][A-Z0-9]{0,14}-$/.test(prefix)) {
      throw new Error("--prefix must match /^[A-Z][A-Z0-9]{0,14}-$/ (e.g. 'TEAM-' or 'OSS-')");
    }
  }

  const created = [];
  const skipped = [];
  const overwritten = [];
  const errors = [];

  for (const doc of bundle.docs) {
    try {
      if (!doc || !doc.id || !doc.doc_type || !doc.frontmatter || typeof doc.body !== "string") {
        errors.push({ id: (doc && doc.id) || "(unknown)", reason: "doc missing required fields" });
        continue;
      }
      if (!DOC_TYPES.includes(doc.doc_type)) {
        errors.push({ id: doc.id, reason: `unknown doc_type: ${doc.doc_type}` });
        continue;
      }

      // Compute the new id (with optional prefix remap) and corresponding filename
      const originalId = doc.id;
      const newId = prefix ? `${prefix}${originalId}` : originalId;
      const fm = { ...doc.frontmatter, id: newId };
      // Validate the resulting frontmatter. validateFrontmatter returns an array of
      // {filePath, error} entries (truthy when invalid). When a prefix is applied,
      // the ID pattern check is relaxed because the prefix is by design a namespace
      // marker that breaks the canonical ADR-NNN / CON-NNN / FLOW-NNN / REJ-NNN shape.
      const validationErrors = validateFrontmatter(fm, "(bundle import)");
      const filteredErrors = prefix
        ? validationErrors.filter(e => !/does not match pattern/.test(e.error || ""))
        : validationErrors;
      if (filteredErrors.length > 0) {
        errors.push({ id: newId, reason: "frontmatter invalid: " + filteredErrors.map(e => e.error || String(e)).join("; ") });
        continue;
      }

      const subdir = getSubdirPath(doc.doc_type);
      if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });

      // Filename: derive from original or use newId-slug (lowercase, dashes)
      const baseName = (doc.filename && !prefix) ? doc.filename : `${newId}.md`;
      // Reject filenames with separators (defense against bundle-supplied paths)
      if (baseName.includes("/") || baseName.includes("\\") || baseName.includes("..")) {
        errors.push({ id: newId, reason: `unsafe filename in bundle: ${baseName}` });
        continue;
      }
      const filePath = path.join(subdir, baseName);

      if (fs.existsSync(filePath)) {
        if (!overwrite) {
          skipped.push({ id: newId, file: filePath, reason: "exists; pass --overwrite to replace" });
          continue;
        }
        overwritten.push({ id: newId, file: filePath });
      } else {
        created.push({ id: newId, file: filePath });
      }

      const fmYaml = serializeFrontmatter(fm);
      const body = doc.body.startsWith("\n") ? doc.body : "\n" + doc.body;
      const md = `---\n${fmYaml}\n---${body}`;
      atomicWriteFileSync(filePath, md);
    } catch (e) {
      errors.push({ id: (doc && doc.id) || "(unknown)", reason: e.message });
    }
  }

  // Rebuild index after any successful writes
  if (created.length + overwritten.length > 0) {
    try { rebuildIndex(); } catch (e) {
      errors.push({ id: "(index rebuild)", reason: e.message });
    }
  }

  return {
    bundle_from: bundle.exported_from || null,
    bundle_exported_at: bundle.exported_at || null,
    schema_version: bundle.schema_version || null,
    prefix_applied: prefix,
    overwrite_mode: overwrite,
    counts: {
      created: created.length,
      overwritten: overwritten.length,
      skipped: skipped.length,
      errors: errors.length,
    },
    created,
    overwritten,
    skipped,
    errors,
  };
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
 * "Refactor Safety" decay scenario from CCA v27 §2 (a doc claims to govern
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
  if (graphify.status().state !== "ready") return [];

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
            issues.push({
              filePath: null,
              severity: "warning",
              category: "graphify-unreachable",
              error: `Graphify queries failed ${consecutiveErrors}× consecutively — stale-symbol checks aborted (run \`graphify update .\`)`,
            });
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
        process.stderr.write("Usage: memory query <terms> [--limit=N] [--doc-type=decision|concept|flow|rejected|lesson]\n");
        return 2;
      }
      const limitArg = args.find(a => a.startsWith("--limit="));
      const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 20;
      const docTypeArg = args.find(a => a.startsWith("--doc-type="));
      const docType = docTypeArg ? docTypeArg.split("=")[1] : null;
      if (docType && !DOC_TYPES.includes(docType)) {
        process.stderr.write(`Invalid --doc-type: ${docType}. Allowed: ${DOC_TYPES.join("|")}\n`);
        return 2;
      }
      json({ query: terms, limit, doc_type: docType, results: queryFTS(terms, { limit, docType }) });
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
      const depth = depthArg ? parseInt(depthArg.split("=")[1], 10) : 2;
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
      // Discovery engine — harvests claude-mem ⚖️/🔵 + #KNOWLEDGE-CANDIDATE + DEC-xxx
      // entries into _suggestions.md for curator review. NEVER writes permanent doc files.
      const discovery = require("./discovery.cjs");
      const result = discovery.harvest({});
      const suggestionsPath = discovery.writeSuggestionsReport(result);
      json({
        ...result,
        suggestions_path: path.relative(findProjectRoot(), suggestionsPath),
      });
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
        `       validate | backlinks | orphans | stale-links | affects-symbol | suggest |\n` +
        `       promote (via /devt:memory) | reject (via /devt:memory)\n`
      );
      return 2;
  }
}

module.exports = {
  run,
  init,
  rebuildIndex,
  validate,
  getDoc,
  getByPath,
  getBySymbol,
  listActive,
  listRejectedKeywords,
  queryFTS,
  getLinks,
  listDocs,
  scanDocs,
  parseFrontmatter,
  validateFrontmatter,
  matchesGlob,
  getMemoryRoot,
  getMemoryRoots,
  getSubdirPathFor,
  getDbPath,
  getSubdirPath,
  // Phase 2 additions
  getBacklinks,
  findOrphans,
  findStaleLinks,
  affectsSymbol,
  DOC_TYPES,
  STATUS_VALUES,
  CONFIDENCE_VALUES,
  LINK_TYPES,
  SCHEMA_VERSION,
};
