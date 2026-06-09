"use strict";

// Opt-in static-file prose compressor.
//
// Compresses prose in user-supplied markdown files using prose-shrink
// (caveman-shrink port) with sentinel-protected code blocks, URLs, paths,
// and identifiers. Probes for `headroom` CLI on PATH and shells out for
// neural extractive compression (~40% reduction) when available; falls
// back to deterministic regex (~25-35% reduction) when not. Either way,
// the result is validated against the original via the structural-drift
// validator (caveman validate.py port) before the compressed file lands.
// Sensitive-path inputs (credentials, keys, .ssh, .aws) are refused with
// the same denylist graphify.cjs uses.
//
// Reversibility: writes <path>.original.md backup with backup-readback
// verification (caveman compress.py pattern). --restore reads the
// backup, swaps it back, removes the .original.md sibling. Same idiom
// caveman uses — no ad-hoc invention.
//
// CLI:
//   node bin/devt-tools.cjs static-compress <path>            — compress
//   node bin/devt-tools.cjs static-compress --restore <path>  — restore
//
// Gated on DEFAULTS.static_compress.mode ('off' by default). 'off' means
// the CLI errors with a clear "feature disabled" message — explicit
// opt-in required in .devt/config.json.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
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

function _backupPath(filepath) {
  const dir = path.dirname(filepath);
  const base = path.basename(filepath, ".md");
  return path.join(dir, base + ".original.md");
}

// Probe `headroom` on PATH. ENOENT (not installed) is the silent expected
// case; every other failure mode is surfaced so users debugging "why isn't
// headroom firing?" get a signal.
//
// Two-stage probe (field finding 2026-06-09): some users have a `headroom`
// binary on PATH that responds to `--version` but does NOT support the
// `compress` subcommand — typically the `headroom-ai[proxy]` variant which
// targets `headroom wrap claude` use cases, not stdin compression. Without
// the second probe, _runHeadroom would shell out per file, fail with a
// noisy stderr per file, then fall back to regex. The two-stage probe
// detects the bad variant once and falls back silently.
//
// Result is cached for the lifetime of this Node process so an --all run
// over N files emits the probe-failure message at most once. Cache does
// not survive across CLI invocations (each `node devt-tools.cjs` is a new
// process), which is acceptable — probes are <100ms.
let _headroomProbeCache = null;
function _headroomAvailable() {
  if (_headroomProbeCache !== null) return _headroomProbeCache;
  let r;
  try {
    r = spawnSync("headroom", ["--version"], { stdio: "pipe", timeout: 2000 });
  } catch (e) {
    if (e.code !== "ENOENT") {
      process.stderr.write(`[static-compress] headroom probe threw: ${e.code || e.message}\n`);
    }
    return (_headroomProbeCache = false);
  }
  if (r.error) {
    if (r.error.code !== "ENOENT") {
      process.stderr.write(`[static-compress] headroom probe failed: ${r.error.code || r.error.message}\n`);
    }
    return (_headroomProbeCache = false);
  }
  if (r.status !== 0) {
    process.stderr.write(`[static-compress] headroom --version exited ${r.status} — treating as unavailable\n`);
    return (_headroomProbeCache = false);
  }
  // Stage 2 — verify the `compress` subcommand exists. Click's "No such
  // command" error returns exit 2; we treat any non-zero as missing-subcommand.
  let s;
  try {
    s = spawnSync("headroom", ["compress", "--help"], { stdio: "pipe", timeout: 2000 });
  } catch (e) {
    process.stderr.write(`[static-compress] headroom compress probe threw: ${e.code || e.message}\n`);
    return (_headroomProbeCache = false);
  }
  if (s.error || s.status !== 0) {
    process.stderr.write(
      "[static-compress] headroom binary on PATH but `compress` subcommand is not supported " +
      "(likely headroom-ai[proxy] variant). Install the stdin-compress variant " +
      "via `pipx install headroom-ai` (without the [proxy] extra), or accept regex fallback.\n",
    );
    return (_headroomProbeCache = false);
  }
  return (_headroomProbeCache = true);
}

// Run headroom in compress-stdin mode. Returns { ok, compressed, reason }
// where reason names the specific failure mode when ok=false (timeout,
// exit_code, empty_output, exception). Callers translate to a stderr line
// before falling back to regex — users debugging compression behavior need
// to see which mode hit.
function _runHeadroom(text) {
  let r;
  try {
    r = spawnSync("headroom", ["compress", "-"], {
      input: text,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
      maxBuffer: 5_000_000,
    });
  } catch (e) {
    return { ok: false, reason: `exception: ${e.code || e.message}` };
  }
  if (r.error) {
    return { ok: false, reason: `spawn error: ${r.error.code || r.error.message}` };
  }
  if (r.signal === "SIGTERM") {
    return { ok: false, reason: "timeout (30s)" };
  }
  if (r.status !== 0) {
    const stderrTail = (r.stderr ? r.stderr.toString("utf8") : "").slice(-200).trim();
    return { ok: false, reason: `non-zero exit ${r.status}${stderrTail ? `: ${stderrTail}` : ""}` };
  }
  const out = r.stdout ? r.stdout.toString("utf8") : "";
  if (!out || !out.trim()) {
    return { ok: false, reason: "empty output" };
  }
  return { ok: true, compressed: out };
}

function _compressText(text) {
  if (_headroomAvailable()) {
    const r = _runHeadroom(text);
    if (r.ok) return { compressed: r.compressed, engine: "headroom" };
    process.stderr.write(
      `[static-compress] headroom available but compression failed (${r.reason}) — falling back to regex.\n`,
    );
  }
  const { compress } = require("./prose-shrink.cjs");
  const r = compress(text);
  return { compressed: r.compressed, engine: "regex" };
}

function compressFile(filepath) {
  const cfg = _resolveConfig();
  if (cfg.mode === "off") {
    // Disabled-by-config is the configured-as-designed state, not a failure
    // — return ok:true + skipped:true so `set -e` callers don't trip.
    return {
      ok: true,
      path: filepath,
      skipped: true,
      reason:
        "static_compress.mode='off' — feature disabled by default. Set " +
        "static_compress.mode='on' in .devt/config.json to enable.",
    };
  }
  const abs = path.isAbsolute(filepath) ? filepath : path.join(_findProjectRoot(), filepath);
  if (!fs.existsSync(abs)) {
    return { ok: false, path: filepath, reason: `file does not exist: ${filepath}` };
  }
  // Sensitive-path denylist — credentials/keys/secrets never get shipped
  // through any compressor (regex or headroom). Same gate graphify uses.
  const { isSensitivePath } = require("./sensitive-path.cjs");
  if (isSensitivePath(filepath)) {
    return {
      ok: false,
      path: filepath,
      reason:
        "refused: filename matches credential/key/secret pattern. " +
        "Compression sends file contents to an LLM (when headroom routes " +
        "through Anthropic) or processes them in-memory (regex). Rename " +
        "if false-positive.",
    };
  }
  const sizeCap = cfg.size_cap_bytes || MAX_FILE_SIZE_DEFAULT;
  const stat = fs.statSync(abs);
  if (stat.size > sizeCap) {
    return {
      ok: false,
      path: filepath,
      reason: `file too large: ${stat.size} bytes (cap: ${sizeCap}). Override via static_compress.size_cap_bytes.`,
    };
  }
  const original = fs.readFileSync(abs, "utf8");
  if (!original.trim()) {
    return { ok: false, path: filepath, reason: "file empty or whitespace-only — nothing to compress." };
  }
  const backup = _backupPath(abs);
  if (fs.existsSync(backup)) {
    return {
      ok: false,
      path: filepath,
      reason:
        `backup already exists: ${path.relative(_findProjectRoot(), backup)}. ` +
        "Remove or rename the backup before re-running.",
    };
  }
  const { compressed, engine } = _compressText(original);
  if (!compressed || !compressed.trim()) {
    return { ok: false, path: filepath, reason: `compression returned empty output (engine=${engine})` };
  }
  if (compressed.trim() === original.trim()) {
    return { ok: false, path: filepath, reason: `compression produced identical output (engine=${engine}) — nothing to do` };
  }
  // Backup + readback-verify before touching the input.
  atomicWriteFileSync(backup, original);
  let readback;
  try {
    readback = fs.readFileSync(backup, "utf8");
  } catch (e) {
    try { fs.unlinkSync(backup); } catch { /* best-effort */ }
    return {
      ok: false,
      path: filepath,
      reason: `backup readback failed (read error: ${e.code || e.message}) — aborting before touching input.`,
    };
  }
  if (readback !== original) {
    try { fs.unlinkSync(backup); } catch { /* best-effort */ }
    return {
      ok: false,
      path: filepath,
      reason: `backup readback failed: in-memory original (${original.length} bytes) differs from on-disk backup (${readback.length} bytes) — disk/encoding/antivirus may be interfering. Aborting before touching input.`,
    };
  }
  // Structural validation — must pass `superset` mode (compressed contains
  // all structural elements of the original).
  const { validate } = require("./structural-validator.cjs");
  const drift = validate(original, compressed, { mode: "superset" });
  if (!drift.ok) {
    try { fs.unlinkSync(backup); } catch { /* best-effort */ }
    return {
      ok: false,
      path: filepath,
      reason:
        `compression dropped structural elements (engine=${engine}): ` +
        drift.errors.join("; "),
    };
  }
  atomicWriteFileSync(abs, compressed);
  const result = {
    ok: true,
    path: filepath,
    engine,
    before_bytes: original.length,
    after_bytes: compressed.length,
    ratio: 1 - compressed.length / original.length,
    backup_path: path.relative(_findProjectRoot(), backup),
    warnings: drift.warnings,
  };
  _logEntry({ action: "compress", ts: new Date().toISOString(), ...result });
  return result;
}

function restoreFile(filepath) {
  const abs = path.isAbsolute(filepath) ? filepath : path.join(_findProjectRoot(), filepath);
  const backup = _backupPath(abs);
  if (!fs.existsSync(backup)) {
    return { ok: false, path: filepath, reason: `no backup found at ${path.relative(_findProjectRoot(), backup)}` };
  }
  const orig = fs.readFileSync(backup, "utf8");
  atomicWriteFileSync(abs, orig);
  try { fs.unlinkSync(backup); } catch { /* best-effort */ }
  const result = { ok: true, path: filepath, restored_bytes: orig.length };
  _logEntry({ action: "restore", ts: new Date().toISOString(), ...result });
  return result;
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
//            engine_breakdown: { headroom: N, regex: N } }
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
    engine_breakdown: { headroom: 0, regex: 0 },
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
      "  node bin/devt-tools.cjs static-compress <path>            — compress one file\n" +
      "  node bin/devt-tools.cjs static-compress --all             — compress .devt/rules/ + guardrails/\n" +
      "  node bin/devt-tools.cjs static-compress --restore <path>  — restore one file\n",
    );
    return 2;
  }
  const result = restore ? restoreFile(filepath) : compressFile(filepath);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  // ok:true (including ok:true + skipped:true for mode='off') → exit 0.
  // ok:false (refused, validation failure, IO error) → exit 1.
  return result.ok ? 0 : 1;
}

module.exports = { run, compressFile, restoreFile, compressAll, headroomAvailable: _headroomAvailable };
