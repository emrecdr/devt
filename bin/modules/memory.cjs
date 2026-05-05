"use strict";

/**
 * Memory layer — permanent ADR/Concept/Flow/Rejected docs with FTS5 unified index.
 *
 * Phase 1 (v0.16.0): foundation only — indexes `.devt/memory/{decisions,concepts,flows,rejected}/*.md`
 * Phase 2 (v0.17.0): extends to lesson/rule/guardrail/state/claude_md/top_level doc_class values.
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

const DOC_TYPES = ["decision", "concept", "flow", "rejected"];
const STATUS_VALUES = ["candidate", "active", "superseded", "rejected"];
const CONFIDENCE_VALUES = ["verified", "explicit", "inferred", "observed", "speculative"];
const LINK_TYPES = ["supersedes", "depends_on", "implements", "relates_to"];
const REJECTION_REASONS = ["user_preference", "performance", "security", "maintainability", "compliance", "complexity"];

const ID_PATTERN_BY_TYPE = {
  decision: /^ADR-\d{3,}$/,
  concept: /^CON-\d{3,}$/,
  flow: /^FLOW-\d{3,}$/,
  rejected: /^REJ-\d{3,}$/,
};

const SUBDIR_BY_TYPE = {
  decision: "decisions",
  concept: "concepts",
  flow: "flows",
  rejected: "rejected",
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function findProjectRoot() {
  return require("./config.cjs").findProjectRoot();
}

function getMemoryRoot() {
  return path.join(findProjectRoot(), ".devt", "memory");
}

function getDbPath() {
  return path.join(getMemoryRoot(), "index.db");
}

function getSubdirPath(docType) {
  // docType is whitelisted via DOC_TYPES; SUBDIR_BY_TYPE is a hardcoded map.
  // No path traversal risk: even malicious docType values would yield `undefined`
  // and the join would produce a non-resolvable path, not escape getMemoryRoot().
  const subdir = SUBDIR_BY_TYPE[docType];
  if (!subdir) throw new Error(`unknown doc_type: ${docType}`);
  return path.join(getMemoryRoot(), subdir);
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
  const stmts = sql.split(";").map(s => s.trim()).filter(Boolean);
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
  const root = getMemoryRoot();
  if (!fs.existsSync(root)) return [];

  const docs = [];
  for (const docType of DOC_TYPES) {
    const subdir = getSubdirPath(docType);
    if (!fs.existsSync(subdir)) continue;

    for (const entry of fs.readdirSync(subdir)) {
      if (entry.startsWith("_")) continue;
      if (!entry.endsWith(".md")) continue;

      const filePath = path.join(subdir, entry);
      const content = fs.readFileSync(filePath, "utf8");
      const fm = parseFrontmatter(content);

      if (fm && typeof fm.id === "string" && /-000$/.test(fm.id)) continue;

      docs.push({
        filePath,
        relativePath: path.relative(findProjectRoot(), filePath),
        frontmatter: fm,
        body: content.replace(/^---[\s\S]*?\n---\n?/, ""),
      });
    }
  }

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
  CREATE INDEX IF NOT EXISTS idx_affects_symbol ON affects(symbol);
  CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);
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
        (id, doc_type, doc_class, status, confidence, domain, title, summary, file_path, created_at, created_by, schema_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

  return {
    inserted,
    skipped: validationErrors.length,
    errors: validationErrors,
    last_built_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
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
    // Patterns come from validated frontmatter (affects_paths). Cap length to bound
    // regex complexity and prevent ReDoS via pathological inputs. After substitution
    // every `*` becomes a bounded character class (`[^/]*` or `.*`), neither of which
    // exhibits catastrophic backtracking on the linear input strings we test.
    if (pattern.length > 256) return false;
    const re = new RegExp("^" + pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*") + "$");
    return re.test(filePath);
  }
  return false;
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
    WHERE a.symbol = ? AND d.status IN ('active', 'candidate')
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
    try {
      return db.prepare(`
        SELECT id, title, summary, file_path, doc_type, doc_class, status, rank
        FROM documents_fts
        WHERE documents_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit);
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
      return db.prepare("SELECT id, title, status, confidence, domain, file_path FROM documents WHERE doc_type = ? ORDER BY id").all(docType);
    }
    return db.prepare("SELECT id, title, doc_type, status, confidence, domain, file_path FROM documents ORDER BY doc_type, id").all();
  });
}

// ---------------------------------------------------------------------------
// Validate (Phase 1: path-only — no Graphify yet)
// ---------------------------------------------------------------------------

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
    } finally {
      db.close();
    }
  }

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
// Init: scaffold .devt/memory/{decisions,concepts,flows,rejected}/ + first index
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
        process.stderr.write("Usage: memory query <terms>\n");
        return 2;
      }
      const limitArg = args.find(a => a.startsWith("--limit="));
      const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 20;
      json({ query: terms, limit, results: queryFTS(terms, { limit }) });
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
    default:
      process.stderr.write(
        `Unknown memory subcommand: ${subcommand}\n` +
        `Valid: init | index | query | get | affects | list | links | active | rejected-keywords | validate\n`
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
  getDbPath,
  getSubdirPath,
  DOC_TYPES,
  STATUS_VALUES,
  CONFIDENCE_VALUES,
  LINK_TYPES,
  SCHEMA_VERSION,
};
