"use strict";

/**
 * Semantic search — pure Node.js FTS5 implementation.
 *
 * Zero external dependencies. Uses node:sqlite (built-in since Node 22.5).
 * Syncs learning-playbook.md → SQLite FTS5 database for full-text lesson search.
 * Falls back to grep-based search if database doesn't exist.
 */

const fs = require("fs");
const path = require("path");

function getDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch {
    throw new Error(
      `node:sqlite requires Node.js 22.5+, current: ${process.version}. ` +
      `The "query" subcommand works without it (grep fallback), but "sync" and "compact" need it.`
    );
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getPlaybookPath() {
  const { findProjectRoot } = require("./config.cjs");
  return path.join(findProjectRoot(), ".devt", "learning-playbook.md");
}

function getDbPath(pluginRoot) {
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (pluginData) {
    return path.join(pluginData, "semantic", "lessons.db");
  }
  return path.join(pluginRoot, "memory", "semantic", "lessons.db");
}

// ---------------------------------------------------------------------------
// Playbook parser
// ---------------------------------------------------------------------------

/**
 * Parse flat key: value entries separated by --- from learning-playbook.md.
 * Handles comment lines (#) and quoted values.
 */
function parsePlaybook(playbookPath) {
  if (!fs.existsSync(playbookPath)) return [];

  const content = fs.readFileSync(playbookPath, "utf8");
  const blocks = content.split(/\n---\n/);
  const entries = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    const entry = {};
    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const m = line.match(/^(\w+):\s*(.+)$/);
      if (m) {
        let val = m[2].trim();
        // Strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        entry[m[1]] = val;
      }
    }

    if (entry.description) {
      entries.push(entry);
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

const FTS5_SCHEMA = `CREATE VIRTUAL TABLE IF NOT EXISTS lessons USING fts5(
  description, category, tags, evidence,
  importance UNINDEXED, confidence UNINDEXED,
  decay_days UNINDEXED, created_at UNINDEXED
)`;

function openDb(dbPath) {
  return new (getDatabaseSync())(dbPath);
}

function withDb(dbPath, fn) {
  const db = openDb(dbPath);
  try { return fn(db); } finally { db.close(); }
}

function ensureDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = openDb(dbPath);
  db.exec(FTS5_SCHEMA);
  return db;
}

/**
 * Full sync: clear table and re-insert all entries from playbook.
 */
function syncEntries(db, entries) {
  db.exec("DELETE FROM lessons");

  const stmt = db.prepare(
    "INSERT INTO lessons (description, category, tags, evidence, importance, confidence, decay_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );

  let inserted = 0;
  let skipped = 0;
  let firstError = null;
  for (const e of entries) {
    try {
      stmt.run(
        e.description || "",
        e.category || "general",
        e.tags || "",
        e.evidence || "",
        String(e.importance || "5"),
        String(e.confidence || "0.5"),
        String(e.decay_days || "90"),
        e.created_at || ""
      );
      inserted++;
    } catch (err) {
      skipped++;
      if (!firstError) firstError = err.message || String(err);
    }
  }

  return { inserted, skipped, firstError };
}

/**
 * FTS5 full-text query. Returns structured results sorted by relevance.
 */
function queryFts(db, terms, limit) {
  const stmt = db.prepare(
    `SELECT description, category, tags, evidence, importance, confidence, decay_days, created_at
     FROM lessons WHERE lessons MATCH ? ORDER BY rank LIMIT ?`
  );

  try {
    return stmt.all(terms, limit);
  } catch (_) {
    return null; // Table doesn't exist or query syntax error
  }
}

/**
 * Grep-based fallback when no FTS database exists.
 * Parses playbook entries and keyword-scores them, returning the same shape as FTS5.
 */
function fallbackGrep(playbookPath, terms, limit) {
  const entries = parsePlaybook(playbookPath);
  if (entries.length === 0) return [];

  const keywords = terms.toLowerCase().split(/\s+/);

  const scored = [];
  for (const entry of entries) {
    const text = Object.values(entry).join(" ").toLowerCase();
    const score = keywords.reduce((s, kw) => s + (text.includes(kw) ? 1 : 0), 0);
    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sync learning-playbook.md → FTS5 database.
 */
function sync(pluginRoot) {
  const playbook = getPlaybookPath();
  if (!fs.existsSync(playbook)) {
    return { synced: 0, reason: "learning-playbook.md does not exist yet (created after first /devt:retro)" };
  }

  const dbPath = getDbPath(pluginRoot);
  const entries = parsePlaybook(playbook);
  const db = ensureDb(dbPath);

  try {
    const { inserted, skipped, firstError } = syncEntries(db, entries);
    const result = { synced: inserted, db: dbPath, playbook };
    if (skipped > 0) result.skipped = skipped;
    if (firstError) result.error = firstError;
    return result;
  } finally {
    db.close();
  }
}

/**
 * Query for relevant lessons. Uses FTS5 if available, grep fallback otherwise.
 */
function query(terms, pluginRoot, limit) {
  const lim = limit || 10;
  const dbPath = getDbPath(pluginRoot);
  const playbook = getPlaybookPath();

  // Try FTS5 first
  if (fs.existsSync(dbPath)) {
    try {
      const ftsResult = withDb(dbPath, (db) => {
        const results = queryFts(db, terms, lim);
        if (results !== null) {
          return { source: "fts5", query: terms, count: results.length, results };
        }
        return null;
      });
      if (ftsResult) return ftsResult;
    } catch (_) {
      // Fall through to grep
    }
  }

  // Grep fallback
  const results = fallbackGrep(playbook, terms, lim);
  return { source: "grep_fallback", query: terms, count: results.length, results };
}

/**
 * Archive stale lessons from the FTS5 database.
 * Removes entries where importance < threshold AND confidence < threshold AND past decay period.
 */
function compact(pluginRoot, options) {
  const opts = options || {};
  const minImportance = opts.minImportance || 5;
  const minConfidence = opts.minConfidence || 0.5;
  const dryRun = opts.dryRun || false;

  const dbPath = getDbPath(pluginRoot);
  if (!fs.existsSync(dbPath)) {
    return { archived: 0, reason: "no database found" };
  }

  return withDb(dbPath, (db) => {
    const candidates = db.prepare(
      `SELECT rowid, description, importance, confidence, created_at, decay_days
       FROM lessons
       WHERE CAST(importance AS INTEGER) < ?
         AND CAST(confidence AS REAL) < ?`
    ).all(minImportance, minConfidence);

    const now = Date.now();
    const toArchive = [];

    for (const row of candidates) {
      const created = row.created_at ? new Date(row.created_at).getTime() : 0;
      const decayMs = (parseInt(row.decay_days, 10) || 90) * 86400000;
      if (created && (now - created) > decayMs) {
        toArchive.push({
          rowid: row.rowid,
          description: (row.description || "").slice(0, 80),
          importance: row.importance,
          confidence: row.confidence,
        });
      }
    }

    if (!dryRun && toArchive.length > 0) {
      const rowids = toArchive.map((r) => r.rowid);
      db.exec(`DELETE FROM lessons WHERE rowid IN (${rowids.join(",")})`);
    }

    return {
      archived: toArchive.length,
      dry_run: dryRun,
      candidates: dryRun ? toArchive : [],
      db: dbPath,
    };
  });
}

/**
 * CLI entry point.
 */
function run(subcommand, args, pluginRoot) {
  switch (subcommand) {
    case "sync":
      return sync(pluginRoot);

    case "query": {
      const terms = args.join(" ");
      if (!terms) {
        return { error: "Usage: semantic query <search terms>" };
      }
      return query(terms, pluginRoot);
    }

    case "compact": {
      const dryRun = args.includes("--dry-run");
      return compact(pluginRoot, { dryRun });
    }

    case "status": {
      const dbPath = getDbPath(pluginRoot);
      const playbook = getPlaybookPath();
      let entryCount = 0;
      if (fs.existsSync(dbPath)) {
        try {
          entryCount = withDb(dbPath, (db) =>
            db.prepare("SELECT count(*) as c FROM lessons").get().c
          );
        } catch (_) {}
      }
      return {
        database: fs.existsSync(dbPath) ? dbPath : "not created",
        playbook: fs.existsSync(playbook) ? playbook : "not created",
        entries: entryCount,
      };
    }

    default:
      return { error: "Unknown semantic subcommand: " + subcommand + ". Use: sync, query, compact, status" };
  }
}

module.exports = { run, sync, query, compact };
