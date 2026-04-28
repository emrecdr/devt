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

      // Accept both flat `key: value` and YAML-list `- key: value` forms.
      // The schema example in schemas/learning-entry.yaml uses the dash form,
      // so any retro/curator output following the schema literally would have
      // been silently dropped without this strip.
      const cleanLine = line.replace(/^-\s+/, "");
      const m = cleanLine.match(/^(\w+):\s*(.+)$/);
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
        String(e.decay_days || "180"),
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

// ---------------------------------------------------------------------------
// Filters (shared by FTS5 and grep paths)
// ---------------------------------------------------------------------------

/**
 * Apply post-query filters to a row. Returns true if the row passes.
 * Operates on UNINDEXED FTS5 columns and string fields, never on rank.
 */
function passesFilters(row, opts) {
  if (opts.minImportance != null) {
    const imp = parseInt(row.importance, 10);
    if (!Number.isFinite(imp) || imp < opts.minImportance) return false;
  }
  if (opts.minConfidence != null) {
    const conf = parseFloat(row.confidence);
    if (!Number.isFinite(conf) || conf < opts.minConfidence) return false;
  }
  if (opts.category) {
    if ((row.category || "").toLowerCase() !== opts.category.toLowerCase()) return false;
  }
  if (opts.tags && opts.tags.length > 0) {
    const rowTags = (row.tags || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const wanted = opts.tags.map((t) => t.toLowerCase());
    if (!wanted.some((w) => rowTags.includes(w))) return false;
  }
  return true;
}

function hasAnyFilter(opts) {
  return (
    opts.minImportance != null ||
    opts.minConfidence != null ||
    !!opts.category ||
    (opts.tags && opts.tags.length > 0)
  );
}

/**
 * FTS5 full-text query. Rows come back FTS5-ranked, then post-filtered in Node.
 * When filters are active we over-fetch (capped at 200) so we still hit `limit`
 * after filtering — preserves match quality while honoring the cap.
 */
function queryFts(db, terms, limit, opts) {
  const fetch = hasAnyFilter(opts) ? Math.min(Math.max(limit * 5, 50), 200) : limit;

  const stmt = db.prepare(
    `SELECT description, category, tags, evidence, importance, confidence, decay_days, created_at
     FROM lessons WHERE lessons MATCH ? ORDER BY rank LIMIT ?`
  );

  let rows;
  try {
    rows = stmt.all(terms, fetch);
  } catch (_) {
    return null; // Table doesn't exist or query syntax error
  }

  if (!hasAnyFilter(opts)) return rows;
  return rows.filter((r) => passesFilters(r, opts)).slice(0, limit);
}

/**
 * Grep-based fallback when no FTS database exists.
 * Parses playbook entries and keyword-scores them, returning the same shape as FTS5.
 */
function fallbackGrep(playbookPath, terms, limit, opts) {
  const entries = parsePlaybook(playbookPath);
  if (entries.length === 0) return [];

  const keywords = terms.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = [];
  for (const entry of entries) {
    if (!passesFilters(entry, opts)) continue;
    const text = Object.values(entry).join(" ").toLowerCase();
    const score = keywords.reduce((s, kw) => s + (text.includes(kw) ? 1 : 0), 0);
    if (score > 0 || keywords.length === 0) {
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
 *
 * @param {string} terms - FTS5 query expression or space-separated keywords.
 * @param {string} pluginRoot - CLAUDE_PLUGIN_ROOT (for db path resolution).
 * @param {object|number} [opts] - Filter/pagination options. Number is treated
 *                                 as legacy `limit` for backward compatibility.
 * @param {number} [opts.limit=10]       - Max rows returned.
 * @param {number} [opts.minImportance]  - Drop rows where importance < N (1-10).
 * @param {number} [opts.minConfidence]  - Drop rows where confidence < F (0-1).
 * @param {string} [opts.category]       - Exact (case-insensitive) category match.
 * @param {string[]} [opts.tags]         - Match if ANY listed tag is present.
 */
function query(terms, pluginRoot, opts) {
  // Backward compat: callers passing a bare limit number still work.
  const o = typeof opts === "number" ? { limit: opts } : (opts || {});
  const lim = o.limit || 10;
  const filterOpts = {
    minImportance: o.minImportance,
    minConfidence: o.minConfidence,
    category: o.category,
    tags: o.tags,
  };
  const dbPath = getDbPath(pluginRoot);
  const playbook = getPlaybookPath();

  const filtersApplied = {};
  if (o.minImportance != null) filtersApplied.min_importance = o.minImportance;
  if (o.minConfidence != null) filtersApplied.min_confidence = o.minConfidence;
  if (o.category) filtersApplied.category = o.category;
  if (o.tags && o.tags.length > 0) filtersApplied.tags = o.tags;
  const hasFilters = Object.keys(filtersApplied).length > 0;

  // Try FTS5 first
  if (fs.existsSync(dbPath)) {
    try {
      const ftsResult = withDb(dbPath, (db) => {
        const results = queryFts(db, terms, lim, filterOpts);
        if (results !== null) {
          const out = { source: "fts5", query: terms, count: results.length, results };
          if (hasFilters) out.filters = filtersApplied;
          return out;
        }
        return null;
      });
      if (ftsResult) return ftsResult;
    } catch (_) {
      // Fall through to grep
    }
  }

  // Grep fallback
  const results = fallbackGrep(playbook, terms, lim, filterOpts);
  const out = { source: "grep_fallback", query: terms, count: results.length, results };
  if (hasFilters) out.filters = filtersApplied;
  return out;
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
      const decayMs = (parseInt(row.decay_days, 10) || 180) * 86400000;
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
      const placeholders = rowids.map(() => "?").join(",");
      db.prepare(`DELETE FROM lessons WHERE rowid IN (${placeholders})`).run(...rowids);
    }

    return {
      archived: toArchive.length,
      dry_run: dryRun,
      candidates: dryRun ? toArchive : [],
      db: dbPath,
    };
  });
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Split args into positional terms and known flags.
 * Supports `--flag=value` and `--flag value` forms. Throws on unknown flags or
 * malformed values.
 *
 * Recognized flags:
 *   --limit=N            max results (default 10)
 *   --min-importance=N   drop rows with importance < N (1-10)
 *   --min-confidence=F   drop rows with confidence < F (0-1)
 *   --category=NAME      exact (case-insensitive) category match
 *   --tags=a,b,c         match if any tag is present
 */
function parseQueryFlags(args) {
  const opts = {};
  const positional = [];

  const consumeValue = (i, name) => {
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`Flag ${name} requires a value`);
    }
    return [next, i + 1];
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { positional.push(a); continue; }

    let name, value;
    const eq = a.indexOf("=");
    if (eq > 0) {
      name = a.slice(0, eq);
      value = a.slice(eq + 1);
    } else {
      name = a;
    }

    switch (name) {
      case "--limit": {
        if (value === undefined) [value, i] = consumeValue(i, name);
        const n = parseInt(value, 10);
        if (!Number.isFinite(n) || n <= 0) throw new Error(`--limit must be a positive integer, got ${value}`);
        opts.limit = n;
        break;
      }
      case "--min-importance": {
        if (value === undefined) [value, i] = consumeValue(i, name);
        const n = parseInt(value, 10);
        if (!Number.isFinite(n) || n < 1 || n > 10) throw new Error(`--min-importance must be 1-10, got ${value}`);
        opts.minImportance = n;
        break;
      }
      case "--min-confidence": {
        if (value === undefined) [value, i] = consumeValue(i, name);
        const f = parseFloat(value);
        if (!Number.isFinite(f) || f < 0 || f > 1) throw new Error(`--min-confidence must be 0.0-1.0, got ${value}`);
        opts.minConfidence = f;
        break;
      }
      case "--category": {
        if (value === undefined) [value, i] = consumeValue(i, name);
        if (!value) throw new Error(`--category requires a non-empty value`);
        opts.category = value;
        break;
      }
      case "--tags": {
        if (value === undefined) [value, i] = consumeValue(i, name);
        opts.tags = value.split(",").map((t) => t.trim()).filter(Boolean);
        if (opts.tags.length === 0) throw new Error(`--tags requires at least one tag`);
        break;
      }
      default:
        throw new Error(`Unknown flag: ${name}. Supported: --limit, --min-importance, --min-confidence, --category, --tags`);
    }
  }

  return { opts, positional };
}

/**
 * CLI entry point.
 */
function run(subcommand, args, pluginRoot) {
  switch (subcommand) {
    case "sync":
      return sync(pluginRoot);

    case "query": {
      let parsed;
      try {
        parsed = parseQueryFlags(args);
      } catch (e) {
        return { error: e.message };
      }
      const terms = parsed.positional.join(" ");
      if (!terms) {
        return { error: "Usage: semantic query <search terms> [--limit=N] [--min-importance=N] [--min-confidence=F] [--category=NAME] [--tags=a,b,c]" };
      }
      return query(terms, pluginRoot, parsed.opts);
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

module.exports = { run, sync, query, compact, parseQueryFlags };
