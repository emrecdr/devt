"use strict";

// Static-file prose compressor.
//
// Compresses prose in markdown files using prose-shrink (caveman-shrink
// port) with sentinel-protected code blocks, URLs, paths, identifiers,
// and heading lines. Compression ratio depends on prose density:
// conversational text compresses 25-35%, tight technical specifications
// compress 4-15%. Result is validated against the original via the
// structural-drift validator (caveman validate.py port) before the
// compressed file lands. Sensitive-path inputs (credentials, keys,
// .ssh, .aws) are refused with the same denylist graphify.cjs uses.
//
// Reversibility: writes <path>.original.md backup with backup-readback
// verification. --restore reads the backup, swaps it back, removes the
// .original.md sibling.
//
// CLI:
//   node bin/devt-tools.cjs static-compress <path>                — compress one file
//   node bin/devt-tools.cjs static-compress --all                 — compress .devt/rules/ + project guardrails/
//   node bin/devt-tools.cjs static-compress --restore <path>      — restore one file
//   node bin/devt-tools.cjs static-compress --plugin-build        — MAINTAINER: pre-compress plugin guardrails/ + skills/

const fs = require("fs");
const path = require("path");
const { atomicWriteFileSync } = require("./io.cjs");

const MAX_FILE_SIZE_DEFAULT = 500000;
const STATIC_COMPRESS_LOG = ".devt/state/static-compress.jsonl";

function _resolveConfig() {
  try {
    const { getMergedConfig } = require("./config.cjs");
    const cfg = getMergedConfig();
    return (cfg && cfg.static_compress) || { mode: "off", size_cap_bytes: MAX_FILE_SIZE_DEFAULT };
  } catch (e) {
    // ENOENT = no project config, that's the normal silent path. Other
    // errors (malformed JSON, forbidden-keys rejection from the prototype-
    // pollution guard, permission denied) are user-actionable mistakes
    // that would otherwise present as a confusing "feature disabled".
    if (e && e.code !== "ENOENT") {
      process.stderr.write(
        `[static-compress] config load failed: ${e.message} — defaulting to mode='off'\n`,
      );
    }
    return { mode: "off", size_cap_bytes: MAX_FILE_SIZE_DEFAULT };
  }
}

function _findProjectRoot() {
  try {
    const { findProjectRoot } = require("./config.cjs");
    return findProjectRoot();
  } catch {
    return process.cwd();
  }
}

function _logEntry(entry) {
  try {
    const root = _findProjectRoot();
    const logPath = path.join(root, STATIC_COMPRESS_LOG);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    /* logging best-effort */
  }
}

// Wrap-and-log helper — used by compressFile/restoreFile to guarantee EVERY
// return path persists an entry in .devt/state/static-compress.jsonl,
// not just the success path. Prior implementation only called _logEntry
// inline on success; refusal returns (mode=off, sensitive path, backup
// exists, drift, etc.) left no audit trail. Greenfield 2026-06-10 surfaced
// this: 14 files compressed but no log entries — the success calls had
// logged but the subsequent refusals on re-runs didn't.
function _logAndReturn(action, result) {
  _logEntry({ action, ts: new Date().toISOString(), ...result });
  return result;
}

function _backupPath(filepath) {
  const dir = path.dirname(filepath);
  const base = path.basename(filepath, ".md");
  return path.join(dir, base + ".original.md");
}

function _compressText(text) {
  const { compress } = require("./prose-shrink.cjs");
  const r = compress(text);
  return { compressed: r.compressed, engine: "regex" };
}

function compressFile(filepath) {
  const cfg = _resolveConfig();
  if (cfg.mode === "off") {
    // Disabled-by-config is the configured-as-designed state, not a failure
    // — return ok:true + skipped:true so `set -e` callers don't trip.
    return _logAndReturn("compress", {
      ok: true,
      path: filepath,
      skipped: true,
      reason:
        "static_compress.mode='off' — feature disabled by default. Set " +
        "static_compress.mode='on' in .devt/config.json to enable.",
    });
  }
  const abs = path.isAbsolute(filepath) ? filepath : path.join(_findProjectRoot(), filepath);
  if (!fs.existsSync(abs)) {
    return _logAndReturn("compress", { ok: false, path: filepath, reason: `file does not exist: ${filepath}` });
  }
  // Sensitive-path denylist — credentials/keys/secrets never get shipped
  // through the compressor. Same gate graphify uses.
  const { isSensitivePath } = require("./sensitive-path.cjs");
  if (isSensitivePath(filepath)) {
    return _logAndReturn("compress", {
      ok: false,
      path: filepath,
      reason:
        "refused: filename matches credential/key/secret pattern. " +
        "Rename if false-positive.",
    });
  }
  const sizeCap = cfg.size_cap_bytes || MAX_FILE_SIZE_DEFAULT;
  const stat = fs.statSync(abs);
  if (stat.size > sizeCap) {
    return _logAndReturn("compress", {
      ok: false,
      path: filepath,
      reason: `file too large: ${stat.size} bytes (cap: ${sizeCap}). Override via static_compress.size_cap_bytes.`,
    });
  }
  const original = fs.readFileSync(abs, "utf8");
  if (!original.trim()) {
    return _logAndReturn("compress", { ok: false, path: filepath, reason: "file empty or whitespace-only — nothing to compress." });
  }
  const backup = _backupPath(abs);
  if (fs.existsSync(backup)) {
    return _logAndReturn("compress", {
      ok: false,
      path: filepath,
      reason:
        `backup already exists: ${path.relative(_findProjectRoot(), backup)}. ` +
        "Remove or rename the backup before re-running.",
    });
  }
  const { compressed, engine } = _compressText(original);
  if (!compressed || !compressed.trim()) {
    return _logAndReturn("compress", { ok: false, path: filepath, reason: `compression returned empty output (engine=${engine})` });
  }
  if (compressed.trim() === original.trim()) {
    return _logAndReturn("compress", { ok: false, path: filepath, reason: `compression produced identical output (engine=${engine}) — nothing to do` });
  }
  // Backup + readback-verify before touching the input.
  atomicWriteFileSync(backup, original);
  let readback;
  try {
    readback = fs.readFileSync(backup, "utf8");
  } catch (e) {
    try { fs.unlinkSync(backup); } catch { /* best-effort */ }
    return _logAndReturn("compress", {
      ok: false,
      path: filepath,
      reason: `backup readback failed (read error: ${e.code || e.message}) — aborting before touching input.`,
    });
  }
  if (readback !== original) {
    try { fs.unlinkSync(backup); } catch { /* best-effort */ }
    return _logAndReturn("compress", {
      ok: false,
      path: filepath,
      reason: `backup readback failed: in-memory original (${original.length} bytes) differs from on-disk backup (${readback.length} bytes) — disk/encoding/antivirus may be interfering. Aborting before touching input.`,
    });
  }
  // Structural validation — must pass `superset` mode (compressed contains
  // all structural elements of the original).
  const { validate } = require("./structural-validator.cjs");
  const drift = validate(original, compressed, { mode: "superset" });
  if (!drift.ok) {
    try { fs.unlinkSync(backup); } catch { /* best-effort */ }
    return _logAndReturn("compress", {
      ok: false,
      path: filepath,
      reason:
        `compression dropped structural elements (engine=${engine}): ` +
        drift.errors.join("; "),
    });
  }
  atomicWriteFileSync(abs, compressed);
  return _logAndReturn("compress", {
    ok: true,
    path: filepath,
    engine,
    before_bytes: original.length,
    after_bytes: compressed.length,
    ratio: 1 - compressed.length / original.length,
    backup_path: path.relative(_findProjectRoot(), backup),
    warnings: drift.warnings,
  });
}

// Plugin maintainer-mode pre-compress — runs against the PLUGIN's own
// guardrails/ + skills/ at release-build time so distributed packages
// ship pre-compressed prose. Different semantics from compressFile:
//
//   • NO .original.md backup written — the plugin tree is git-managed,
//     and `git checkout <file>` is the canonical undo. Backups would
//     clutter the npm publish artifact + the plugin source tree.
//   • Accepts absolute paths inside the plugin tree (compressFile
//     resolves relative paths via _findProjectRoot, which would land
//     in the USER's project — wrong for maintainer mode).
//   • All other safety layers identical: sensitive-path denylist, size
//     cap, empty-input refusal, identical-output refusal, structural-
//     drift validator (superset mode).
//
// Returns the same shape as compressFile for telemetry consistency,
// minus the backup_path field.
function _compressPluginFile(absPath) {
  const cfg = _resolveConfig();
  // sensitivity check — refuse credential-shaped paths
  const { isSensitivePath } = require("./sensitive-path.cjs");
  if (isSensitivePath(absPath)) {
    return { ok: false, path: absPath, reason: "refused: filename matches credential/key/secret pattern" };
  }
  const sizeCap = cfg.size_cap_bytes || MAX_FILE_SIZE_DEFAULT;
  let stat;
  try { stat = fs.statSync(absPath); }
  catch (e) { return { ok: false, path: absPath, reason: `stat failed: ${e.code || e.message}` }; }
  if (stat.size > sizeCap) {
    return { ok: false, path: absPath, reason: `file too large: ${stat.size} bytes (cap: ${sizeCap})` };
  }
  const original = fs.readFileSync(absPath, "utf8");
  if (!original.trim()) {
    return { ok: false, path: absPath, reason: "file empty or whitespace-only" };
  }
  const { compressed, engine } = _compressText(original);
  if (!compressed || !compressed.trim()) {
    return { ok: false, path: absPath, reason: `compression returned empty output (engine=${engine})` };
  }
  if (compressed.trim() === original.trim()) {
    return { ok: false, path: absPath, reason: `compression produced identical output (engine=${engine})` };
  }
  const { validate } = require("./structural-validator.cjs");
  const drift = validate(original, compressed, { mode: "superset" });
  if (!drift.ok) {
    return {
      ok: false,
      path: absPath,
      reason: `compression dropped structural elements (engine=${engine}): ${drift.errors.join("; ")}`,
    };
  }
  atomicWriteFileSync(absPath, compressed);
  return {
    ok: true,
    path: absPath,
    engine,
    before_bytes: original.length,
    after_bytes: compressed.length,
    ratio: 1 - compressed.length / original.length,
    warnings: drift.warnings,
  };
}

// compressPluginBuild — walks the PLUGIN's own static-load surfaces and
// pre-compresses prose so distributed packages ship leaner content. This
// is the ONLY way to reach the ~32 KB guardrails_inline slice that
// dominates per-dispatch envelope cost — user-side static-compress --all
// deliberately excludes the plugin tree per the source/distribution
// boundary, so users have no way to compress guardrails themselves.
//
// Intended caller: the plugin MAINTAINER (you), as part of a release-build
// step BEFORE `git tag vX.Y.Z`. The compressed files get committed to git
// — users pulling the new version inherit the savings automatically.
//
// Surfaces walked:
//   • guardrails/**/*.md — the dominant slice (~32 KB inlined per dispatch)
//   • skills/**/SKILL.md — skill bodies injected into agents that load skills
//
// Surfaces NOT walked:
//   • templates/dispatch/envelopes/**/*.tmpl.md — these are substitution
//     templates, not prose. Compressing them would silently corrupt the
//     {placeholder} tokens because prose-shrink doesn't know they're code.
//   • workflows/**/*.md — same problem (these contain {placeholder} tokens
//     that get substituted at render time).
//   • commands/**/*.md, agents/**/*.md — same.
//   • CHANGELOG.md, README.md, docs/**/*.md — user-facing reference, not
//     loaded into agent context, no payoff from compression.
//
// Refuses to run when the plugin tree is not clean (uncommitted changes
// in target surfaces) — the maintainer must commit any in-progress work
// before pre-compression so the diff is reviewable and reversible via
// `git checkout`.
function compressPluginBuild(opts) {
  opts = opts || {};
  const pluginRoot = path.resolve(__dirname, "..", "..");
  const surfaces = [
    path.join(pluginRoot, "guardrails"),
    path.join(pluginRoot, "skills"),
  ];
  // Walk pre-flight — refuses to run if maintainer has uncommitted changes
  // to target surfaces. Maintainer should commit, run pre-compress, review
  // diff, commit pre-compress as a release-prep commit. Override via
  // opts.allowDirty for CI/testing.
  if (!opts.allowDirty) {
    try {
      const { execSync } = require("child_process");
      const dirty = execSync(
        `git -C "${pluginRoot}" status --porcelain -- guardrails skills 2>/dev/null`,
        { encoding: "utf8" },
      ).trim();
      if (dirty) {
        return {
          ok: false,
          reason:
            "plugin tree has uncommitted changes in guardrails/ or skills/. " +
            "Commit your work first so pre-compress runs against a clean baseline. " +
            "Override via --allow-dirty for CI/testing.",
          dirty_paths: dirty.split("\n").map((l) => l.slice(3)),
        };
      }
    } catch (e) {
      // git not available or not a git repo — surface but don't block
      process.stderr.write(`[plugin-build] git status check skipped: ${e.message}\n`);
    }
  }
  function walk(dir, predicate) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full, predicate));
      else if (entry.isFile() && predicate(entry.name, full)) out.push(full);
    }
    return out;
  }
  const guardrailsFiles = walk(surfaces[0], (name) => name.endsWith(".md"));
  const skillFiles = walk(surfaces[1], (name) => name === "SKILL.md");
  const candidates = [...guardrailsFiles, ...skillFiles];
  const result = {
    ok: true,
    plugin_root: pluginRoot,
    total_files: candidates.length,
    compressed: [],
    skipped_no_change: [],
    refused_sensitive: [],
    errors: [],
    total_bytes_before: 0,
    total_bytes_after: 0,
    engine_breakdown: { regex: 0 },
  };
  for (const abs of candidates) {
    const rel = path.relative(pluginRoot, abs);
    const r = _compressPluginFile(abs);
    if (r.ok) {
      result.compressed.push({ path: rel, engine: r.engine, ratio: r.ratio });
      result.total_bytes_before += r.before_bytes;
      result.total_bytes_after += r.after_bytes;
      result.engine_breakdown[r.engine] = (result.engine_breakdown[r.engine] || 0) + 1;
    } else if (r.reason && r.reason.includes("sensitive")) {
      result.refused_sensitive.push(rel);
    } else if (r.reason && (r.reason.includes("identical output") || r.reason.includes("empty"))) {
      result.skipped_no_change.push(rel);
    } else {
      result.errors.push({ path: rel, reason: r.reason });
    }
  }
  result.total_bytes_saved = result.total_bytes_before - result.total_bytes_after;
  result.median_ratio = result.compressed.length === 0
    ? null
    : (() => {
        const ratios = result.compressed.map((c) => c.ratio).sort((a, b) => a - b);
        const mid = Math.floor(ratios.length / 2);
        return ratios.length % 2 === 0
          ? Number(((ratios[mid - 1] + ratios[mid]) / 2).toFixed(4))
          : Number(ratios[mid].toFixed(4));
      })();
  return result;
}

function restoreFile(filepath) {
  const abs = path.isAbsolute(filepath) ? filepath : path.join(_findProjectRoot(), filepath);
  const backup = _backupPath(abs);
  if (!fs.existsSync(backup)) {
    return _logAndReturn("restore", { ok: false, path: filepath, reason: `no backup found at ${path.relative(_findProjectRoot(), backup)}` });
  }
  const orig = fs.readFileSync(backup, "utf8");
  atomicWriteFileSync(abs, orig);
  try { fs.unlinkSync(backup); } catch { /* best-effort */ }
  return _logAndReturn("restore", { ok: true, path: filepath, restored_bytes: orig.length });
}

// Bulk-compress entry point — walks PROJECT-OWNED static-load surfaces
// and compresses each file once. Idempotent: files with an existing
// <name>.original.md backup are skipped (already compressed). Per-file
// errors don't abort the run; they're collected and surfaced in the
// aggregate result so the caller sees both wins and losses.
//
// Surface boundary: only the PROJECT's .devt/rules/ + a PROJECT-LOCAL
// guardrails/ directory if one exists. The PLUGIN's own guardrails/ is
// source code shipped with devt — modifying it would (a) re-install
// pristine on next `devt update`, (b) overwrite the user's compression,
// (c) violate the plugin/source boundary. Plugin-side guardrails
// compression is the plugin maintainer's release-time concern, not the
// user's runtime opt-in.
//
// Returns: { ok, total_files, compressed, skipped_already_done,
//            skipped_no_change, refused_sensitive, errors,
//            total_bytes_before, total_bytes_after,
//            engine_breakdown: { regex: N } }
//
// Skipped categories — disjoint, both informational:
//   skipped_already_done — a .original.md backup exists; the file was
//     compressed in a prior run, so we leave it alone (idempotent).
//   skipped_no_change — the compressor considered the file but produced
//     identical output (tight prose with no removable filler) or refused
//     for empty-input. NOT the same as "already done" — calling --restore
//     would not undo anything because no backup was ever written.
function compressAll() {
  const cfg = _resolveConfig();
  if (cfg.mode === "off") {
    return {
      ok: true,
      skipped: true,
      reason: "static_compress.mode='off' — set to 'on' in .devt/config.json to enable",
    };
  }
  const root = _findProjectRoot();
  // Project-owned surfaces ONLY. Plugin's own guardrails/ is deliberately
  // excluded — see boundary commentary above.
  const surfaces = [
    path.join(root, ".devt", "rules"),
    path.join(root, "guardrails"),
  ];
  function walk(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.endsWith(".original.md")) {
        out.push(full);
      }
    }
    return out;
  }
  const candidates = surfaces.flatMap(walk);
  const result = {
    ok: true,
    total_files: candidates.length,
    compressed: [],
    skipped_already_done: [],
    skipped_no_change: [],
    refused_sensitive: [],
    errors: [],
    total_bytes_before: 0,
    total_bytes_after: 0,
    engine_breakdown: { regex: 0 },
  };
  for (const abs of candidates) {
    const rel = path.relative(root, abs);
    // Idempotent skip — backup-existence is the "already compressed" signal.
    if (fs.existsSync(_backupPath(abs))) {
      result.skipped_already_done.push(rel);
      continue;
    }
    const r = compressFile(rel);
    if (r.ok) {
      result.compressed.push({ path: rel, engine: r.engine, ratio: r.ratio });
      result.total_bytes_before += r.before_bytes;
      result.total_bytes_after += r.after_bytes;
      result.engine_breakdown[r.engine] = (result.engine_breakdown[r.engine] || 0) + 1;
    } else if (r.reason && r.reason.includes("sensitive")) {
      result.refused_sensitive.push(rel);
    } else if (r.reason && (r.reason.includes("identical output") || r.reason.includes("empty"))) {
      // Safety refusals (identical-output, empty-input) are no-ops, not
      // errors. Distinct from skipped_already_done so the caller can tell
      // "compressor refused" from "already compressed in prior run".
      result.skipped_no_change.push(rel);
    } else {
      result.errors.push({ path: rel, reason: r.reason });
    }
  }
  result.total_bytes_saved = result.total_bytes_before - result.total_bytes_after;
  result.median_ratio = result.compressed.length === 0
    ? null
    : (() => {
        const ratios = result.compressed.map((c) => c.ratio).sort((a, b) => a - b);
        const mid = Math.floor(ratios.length / 2);
        return ratios.length % 2 === 0
          ? Number(((ratios[mid - 1] + ratios[mid]) / 2).toFixed(4))
          : Number(ratios[mid].toFixed(4));
      })();
  return result;
}

function run(_subcommand, args) {
  const restore = args.includes("--restore");
  const bulk = args.includes("--all");
  const pluginBuild = args.includes("--plugin-build");
  const allowDirty = args.includes("--allow-dirty");
  if (pluginBuild) {
    const result = compressPluginBuild({ allowDirty });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result.ok ? 0 : 1;
  }
  if (bulk) {
    const result = compressAll();
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result.ok ? 0 : 1;
  }
  const positional = args.filter((a) => !a.startsWith("--"));
  const filepath = positional[0];
  if (!filepath) {
    process.stderr.write(
      "Usage:\n" +
      "  node bin/devt-tools.cjs static-compress <path>                — compress one file\n" +
      "  node bin/devt-tools.cjs static-compress --all                 — compress .devt/rules/ + guardrails/\n" +
      "  node bin/devt-tools.cjs static-compress --restore <path>      — restore one file\n" +
      "  node bin/devt-tools.cjs static-compress --plugin-build        — MAINTAINER: pre-compress plugin guardrails/ + skills/\n" +
      "  node bin/devt-tools.cjs static-compress --plugin-build --allow-dirty  — override the clean-tree check\n",
    );
    return 2;
  }
  const result = restore ? restoreFile(filepath) : compressFile(filepath);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  // ok:true (including ok:true + skipped:true for mode='off') → exit 0.
  // ok:false (refused, validation failure, IO error) → exit 1.
  return result.ok ? 0 : 1;
}

module.exports = { run, compressFile, restoreFile, compressAll, compressPluginBuild };
