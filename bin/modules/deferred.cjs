"use strict";

/**
 * Deferred-task tracker (v0.29.0).
 *
 * Single shared markdown file at `.devt/state/deferred.md` for "things we said
 * we'd do later." Distinct from `.devt/memory/` (permanent canonical knowledge,
 * curator-gated) and the rest of `.devt/state/` (per-workflow ephemeral, wiped
 * on `state reset`). Exempted from `state reset` via `RESET_EXEMPT` in
 * `state.cjs` so a deferred TODO captured in workflow A survives `/devt:cancel-
 * workflow` and can be picked up in workflow B.
 *
 * Format: append-only markdown, one item per `## DEF-NNN — title` block,
 * blocks separated by `---`. Each block has a small key:value list
 * (captured_at, captured_by, context, tags, status, closed_at, closed_by).
 *
 * Zero external dependencies; tolerant to user hand-edits.
 */

const fs = require("fs");
const path = require("path");
const { findProjectRoot } = require("./config.cjs");
const { sanitizeForDisplay } = require("./security.cjs");
const { atomicWriteFileSync } = require("./io.cjs");

const FILE_REL = path.join(".devt", "state", "deferred.md");
const ID_PATTERN = /^DEF-\d{3,}$/;
const STATUS_OPEN = "open";
const STATUS_CLOSED = "closed";
const VALID_STATUS = [STATUS_OPEN, STATUS_CLOSED];
const HEADER = [
  "# Deferred Tasks",
  "",
  "<!-- Append-only. Each item one block separated by `---`. -->",
  "<!-- Captured by /devt:defer or `node bin/devt-tools.cjs deferred add ...`. -->",
  "<!-- Survives /devt:cancel-workflow — exempted from state reset. -->",
  "",
].join("\n") + "\n";

function getPath() {
  return path.join(findProjectRoot(), FILE_REL);
}

function read() {
  const p = getPath();
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
}

function ensureFile() {
  const p = getPath();
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, HEADER);
  }
  return p;
}

function atomicWrite(content) {
  atomicWriteFileSync(ensureFile(), content);
}

/**
 * Parse the markdown into structured items. Tolerant: a malformed block is
 * skipped silently. Output preserves insertion order so DEF ids stay
 * monotonically increasing across appends.
 */
function parseAll(content) {
  if (!content) return [];
  const firstHeading = content.search(/^## DEF-\d/m);
  const body = firstHeading >= 0 ? content.slice(firstHeading) : "";
  if (!body) return [];

  const blocks = body.split(/\n---\n/).map(b => b.trim()).filter(Boolean);
  const items = [];
  for (const block of blocks) {
    const headingMatch = block.match(/^## (DEF-\d{3,}) — (.+)$/m);
    if (!headingMatch) continue;
    const id = headingMatch[1];
    const title = headingMatch[2].trim();
    const item = { id, title, tags: [], status: STATUS_OPEN };
    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim();
      if (!line.startsWith("- ")) continue;
      const kvMatch = line.slice(2).match(/^([a-z_]+):\s*(.+)$/);
      if (!kvMatch) continue;
      const key = kvMatch[1];
      const val = kvMatch[2].trim();
      if (key === "tags") {
        item.tags = val.split(",").map(t => t.trim()).filter(Boolean);
      } else {
        item[key] = val;
      }
    }
    items.push(item);
  }
  return items;
}

function nextId(items) {
  let max = 0;
  for (const item of items) {
    const n = parseInt(item.id.slice(4), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `DEF-${String(max + 1).padStart(3, "0")}`;
}

function renderBlock(item) {
  const lines = [`## ${item.id} — ${item.title}`];
  lines.push(`- captured_at: ${item.captured_at}`);
  if (item.captured_by) lines.push(`- captured_by: ${item.captured_by}`);
  if (item.context) lines.push(`- context: ${item.context}`);
  if (item.tags && item.tags.length) lines.push(`- tags: ${item.tags.join(", ")}`);
  lines.push(`- status: ${item.status}`);
  if (item.closed_at) lines.push(`- closed_at: ${item.closed_at}`);
  if (item.closed_by) lines.push(`- closed_by: ${item.closed_by}`);
  return lines.join("\n") + "\n";
}

function renderAll(items) {
  if (items.length === 0) return HEADER;
  const blocks = items.map(renderBlock);
  return HEADER + blocks.join("\n---\n\n");
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function addItem({ title, context, tags, capturedBy }) {
  if (!title || typeof title !== "string") {
    throw new Error("title is required");
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new Error("title must not be empty");
  if (trimmed.length > 80) throw new Error("title exceeds 80 chars");

  const items = parseAll(read());
  const id = nextId(items);
  const item = {
    id,
    title: sanitizeForDisplay(trimmed),
    captured_at: new Date().toISOString(),
    captured_by: capturedBy ? sanitizeForDisplay(String(capturedBy)) : "user",
    context: context ? sanitizeForDisplay(String(context)) : "",
    tags: Array.isArray(tags) ? tags.map(t => sanitizeForDisplay(String(t))) : [],
    status: STATUS_OPEN,
  };
  items.push(item);
  atomicWrite(renderAll(items));
  return item;
}

function listItems(opts) {
  opts = opts || {};
  let items = parseAll(read());
  if (opts.status && VALID_STATUS.includes(opts.status)) {
    items = items.filter(i => i.status === opts.status);
  }
  if (opts.tag) {
    items = items.filter(i => i.tags && i.tags.includes(opts.tag));
  }
  if (opts.limit && opts.limit > 0) {
    items = items.slice(0, opts.limit);
  }
  return items;
}

function getItem(id) {
  if (!ID_PATTERN.test(id)) throw new Error(`invalid id: ${id} (expected DEF-NNN)`);
  return parseAll(read()).find(i => i.id === id) || null;
}

function setStatus(id, newStatus, closedBy) {
  if (!ID_PATTERN.test(id)) throw new Error(`invalid id: ${id} (expected DEF-NNN)`);
  if (!VALID_STATUS.includes(newStatus)) {
    throw new Error(`invalid status: ${newStatus} (allowed: ${VALID_STATUS.join("|")})`);
  }
  const items = parseAll(read());
  const item = items.find(i => i.id === id);
  if (!item) throw new Error(`not found: ${id}`);
  item.status = newStatus;
  if (newStatus === STATUS_CLOSED) {
    item.closed_at = new Date().toISOString();
    item.closed_by = closedBy ? sanitizeForDisplay(String(closedBy)) : "user";
  } else {
    delete item.closed_at;
    delete item.closed_by;
  }
  atomicWrite(renderAll(items));
  return item;
}

function count() {
  const items = parseAll(read());
  return {
    open: items.filter(i => i.status === STATUS_OPEN).length,
    closed: items.filter(i => i.status === STATUS_CLOSED).length,
    total: items.length,
  };
}

// ---------------------------------------------------------------------------
// CLI dispatcher
// ---------------------------------------------------------------------------

function run(subcommand, args) {
  const json = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
  // Extract `--name=value` flags. Returns null if absent.
  const flag = (name) => {
    const prefix = `--${name}=`;
    const a = args.find(x => x.startsWith(prefix));
    return a ? a.slice(prefix.length) : null;
  };

  switch (subcommand) {
    case "add": {
      const title = args.find(a => !a.startsWith("--"));
      if (!title) {
        process.stderr.write('Usage: deferred add "<title>" [--context="..."] [--tags=a,b,c] [--by=<agent>]\n');
        return 2;
      }
      const tagsRaw = flag("tags");
      try {
        const item = addItem({
          title,
          context: flag("context") || "",
          tags: tagsRaw ? tagsRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
          capturedBy: flag("by"),
        });
        json(item);
        return 0;
      } catch (e) {
        process.stderr.write(`error: ${e.message}\n`);
        return 1;
      }
    }
    case "list": {
      const limitRaw = flag("limit");
      json(listItems({
        status: flag("status"),
        tag: flag("tag"),
        limit: limitRaw ? parseInt(limitRaw, 10) : 0,
      }));
      return 0;
    }
    case "get": {
      if (!args[0]) {
        process.stderr.write("Usage: deferred get <DEF-ID>\n");
        return 2;
      }
      try {
        const item = getItem(args[0]);
        if (!item) { process.stderr.write(`not found: ${args[0]}\n`); return 1; }
        json(item);
        return 0;
      } catch (e) {
        process.stderr.write(`error: ${e.message}\n`);
        return 2;
      }
    }
    case "close":
    case "reopen": {
      if (!args[0]) {
        process.stderr.write(`Usage: deferred ${subcommand} <DEF-ID> [--by=<agent>]\n`);
        return 2;
      }
      try {
        const item = setStatus(
          args[0],
          subcommand === "close" ? STATUS_CLOSED : STATUS_OPEN,
          flag("by"),
        );
        json(item);
        return 0;
      } catch (e) {
        process.stderr.write(`error: ${e.message}\n`);
        return e.message.startsWith("not found") ? 1 : 2;
      }
    }
    case "count": {
      json(count());
      return 0;
    }
    default:
      process.stderr.write(
        `Unknown deferred subcommand: ${subcommand}. Use: add | list | get | close | reopen | count\n`,
      );
      return 2;
  }
}

module.exports = { run, addItem, listItems, getItem, setStatus, count, getPath, FILE_REL };
