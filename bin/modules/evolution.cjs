"use strict";

/**
 * Evolution scan — language-agnostic behavioral code analysis from git history.
 *
 * Computes the research-validated process metrics that a snapshot scanner
 * cannot see: hotspots (change frequency × size, Tornhill/CodeScene),
 * change coupling (co-change pairs, code-maat), fix density (SZZ syntactic
 * commit-message layer), relative churn (Nagappan & Ball), code age, and
 * ownership/minor-contributor counts (Bird et al.). Single `git log
 * --numstat` pass; zero dependencies; degrades to {ok:false} outside a
 * git repository so workflow callers never hard-fail.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { atomicWriteFileSync } = require("./io.cjs");

const SCANNER_NAME = "devt-evolution";
const SCANNER_VERSION = "1.0";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadConfig() {
  try {
    const { getMergedConfig } = require("./config.cjs");
    return getMergedConfig().evolution || {};
  } catch (_) {
    return {};
  }
}

function resolveOptions(args) {
  const cfg = loadConfig();
  const opts = {
    window_months: cfg.window_months || 12,
    max_changeset_size: cfg.max_changeset_size || 30,
    coupling: {
      min_revisions: (cfg.coupling && cfg.coupling.min_revisions) || 5,
      min_shared: (cfg.coupling && cfg.coupling.min_shared) || 5,
      min_degree_pct: (cfg.coupling && cfg.coupling.min_degree_pct) || 30,
    },
    top_n: cfg.top_n || 15,
    ownership: cfg.ownership !== undefined ? cfg.ownership : "auto",
    fix_pattern: cfg.fix_pattern || "\\b(fix(e[ds])?|bug(s|fix)?|defects?|hotfix|patch(ed|es)?)\\b",
    exclude: cfg.exclude || [
      "node_modules/", "vendor/", "dist/", "build/", ".devt/",
      "*.lock", "*.min.js", "*.map",
      "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    ],
    exclude_tests: cfg.exclude_tests !== undefined ? cfg.exclude_tests : true,
    test_path_patterns: Array.isArray(cfg.test_path_patterns) ? cfg.test_path_patterns : [],
    out_dir: path.join(".devt", "state"),
    write: true,
  };

  for (const a of args || []) {
    let m;
    if ((m = a.match(/^--window-months=(\d+)$/))) opts.window_months = parseInt(m[1], 10);
    else if ((m = a.match(/^--top=(\d+)$/))) opts.top_n = parseInt(m[1], 10);
    else if ((m = a.match(/^--max-changeset-size=(\d+)$/))) opts.max_changeset_size = parseInt(m[1], 10);
    else if ((m = a.match(/^--out-dir=(.+)$/))) opts.out_dir = m[1];
    else if (a === "--no-write") opts.write = false;
    else if (a === "--include-tests") opts.exclude_tests = false;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Git plumbing
// ---------------------------------------------------------------------------

function git(argv) {
  return execFileSync("git", argv, {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function isGitRepo() {
  try {
    git(["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch (_) {
    return false;
  }
}

function afterDate(windowMonths) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - windowMonths);
  return d.toISOString().slice(0, 10);
}

// Mirrors code-maat's documented input format. --no-renames keeps history
// parsing single-pass; the cost is that a renamed file's pre-rename history
// is attributed to the old path (documented limitation, same as code-maat).
function readLog(after) {
  return git([
    "log", "--numstat", "--no-renames", "--date=short",
    "--pretty=format:--%h--%ad--%aN", "--after=" + after,
  ]);
}

function listTrackedFiles() {
  // Shared boilerplate via io.cjs::listTrackedFiles. nul:false keeps
  // core.quotePath escaping consistent with this module's sibling `git log`
  // output, which these paths are matched against.
  return require("./io.cjs").listTrackedFiles(undefined, { nul: false });
}

// ---------------------------------------------------------------------------
// Log parsing
// ---------------------------------------------------------------------------

function matchesExclude(file, patterns) {
  for (const p of patterns) {
    if (p.endsWith("/")) {
      if (file.startsWith(p) || file.includes("/" + p)) return true;
    } else if (p.startsWith("*.")) {
      if (file.endsWith(p.slice(1))) return true;
    } else if (file === p || file.endsWith("/" + p)) {
      return true;
    }
  }
  return false;
}

// Language-general test-path detection. Tests are behavioral noise for
// architecture metrics — they churn on every feature, co-change with the code
// they cover, and inflate hotspot/coupling signal without representing
// production structure. Mirrors graphify.cjs's canonical set (kept as a
// self-contained copy so this module stays decoupled from the graph layer);
// `matchesExclude`'s glob shapes can express `tests/` dirs but not the
// prefix/suffix conventions (test_*.py, *_test.go), so this uses regexes.
// Gated by opts.exclude_tests (default on); projects extend the set via
// evolution.test_path_patterns[] and disable via evolution.exclude_tests.
const _DEFAULT_TEST_PATH_PATTERNS = [
  "(^|/)tests?/",                  // tests/ or test/
  "(^|/)__tests__/",               // JS Jest convention
  "(^|/)test_[^/]+\\.py$",         // Python: test_foo.py
  "(^|/)[^/]+_test\\.(py|go|rb)$", // Python/Go/Ruby: foo_test.{py,go,rb}
  "\\.spec\\.[jt]sx?$",            // JS/TS: foo.spec.ts
  "\\.test\\.[jt]sx?$",            // JS/TS: foo.test.ts
  "(^|/)conftest\\.py$",           // pytest shared fixtures
  "(^|/)src/test/",                // Java/Kotlin Maven/Gradle layout
];
const _COMPILED_DEFAULT_TEST_PATH_PATTERNS = _DEFAULT_TEST_PATH_PATTERNS
  .map((p) => { try { return new RegExp(p); } catch { return null; } })
  .filter(Boolean);

function compileTestPatterns(projectPatterns) {
  const extra = (Array.isArray(projectPatterns) ? projectPatterns : [])
    .filter((s) => typeof s === "string" && s.length > 0)
    .map((p) => { try { return new RegExp(p); } catch { return null; } })
    .filter(Boolean);
  return extra.length ? [..._COMPILED_DEFAULT_TEST_PATH_PATTERNS, ...extra] : _COMPILED_DEFAULT_TEST_PATH_PATTERNS;
}

function matchesTestPath(file, compiled) {
  for (const re of compiled) if (re.test(file)) return true;
  return false;
}

function parseLog(raw, opts, excludedTests) {
  const testRe = opts.exclude_tests ? compileTestPatterns(opts.test_path_patterns) : [];
  const commits = [];
  let current = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("--")) {
      const parts = line.split("--");
      // format: '', hash, date, author — author may itself contain '--', rejoin
      if (parts.length >= 4) {
        current = { hash: parts[1], date: parts[2], author: parts.slice(3).join("--"), files: [] };
        commits.push(current);
      }
      continue;
    }
    if (!current || !line.includes("\t")) continue;
    const [added, deleted, file] = line.split("\t");
    if (!file || matchesExclude(file, opts.exclude)) continue;
    if (matchesTestPath(file, testRe)) {
      if (excludedTests) excludedTests.add(file);
      continue;
    }
    current.files.push({
      path: file,
      added: added === "-" ? 0 : parseInt(added, 10) || 0,
      deleted: deleted === "-" ? 0 : parseInt(deleted, 10) || 0,
      binary: added === "-",
    });
  }
  return commits.filter((c) => c.files.length > 0);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function countLoc(file) {
  try {
    const buf = fs.readFileSync(file);
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
    return n;
  } catch (_) {
    return null; // deleted since, or unreadable — excluded from hotspot ranking
  }
}

function computeFileStats(commits, fixRe) {
  const files = new Map();
  for (const c of commits) {
    const isFix = fixRe.test(cSubjectSafe(c));
    for (const f of c.files) {
      let s = files.get(f.path);
      if (!s) {
        s = {
          path: f.path, revisions: 0, added: 0, deleted: 0,
          fix_commits: 0, authors: new Map(), last_date: c.date, binary: f.binary,
        };
        files.set(f.path, s);
      }
      s.revisions++;
      s.added += f.added;
      s.deleted += f.deleted;
      if (isFix) s.fix_commits++;
      s.authors.set(c.author, (s.authors.get(c.author) || 0) + 1);
      // log is newest-first, so last_date set at creation is the latest touch
      s.binary = s.binary && f.binary;
    }
  }
  return files;
}

// Subject lines aren't in the numstat format (kept single-pass); fix detection
// runs on a second cheap pass over hashes ↔ subjects.
let SUBJECTS = null;
function cSubjectSafe(c) {
  return (SUBJECTS && SUBJECTS.get(c.hash)) || "";
}

function readSubjects(after) {
  SUBJECTS = new Map();
  try {
    const raw = git(["log", "--date=short", "--pretty=format:%h\t%s", "--after=" + after]);
    for (const line of raw.split("\n")) {
      const i = line.indexOf("\t");
      if (i > 0) SUBJECTS.set(line.slice(0, i), line.slice(i + 1));
    }
  } catch (_) {
    /* fix density degrades to 0 */
  }
}

function computeCoupling(commits, fileStats, opts) {
  const pairs = new Map();
  let skippedLarge = 0;
  for (const c of commits) {
    if (c.files.length > opts.max_changeset_size) {
      skippedLarge++;
      continue;
    }
    const paths = c.files.map((f) => f.path).sort();
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const key = paths[i] + "\0" + paths[j];
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
    }
  }

  const result = [];
  for (const [key, shared] of pairs) {
    if (shared < opts.coupling.min_shared) continue;
    const [a, b] = key.split("\0");
    const ra = fileStats.get(a) ? fileStats.get(a).revisions : 0;
    const rb = fileStats.get(b) ? fileStats.get(b).revisions : 0;
    if (ra < opts.coupling.min_revisions || rb < opts.coupling.min_revisions) continue;
    // code-maat's degree formula: shared revisions over the pair's average revisions
    const degree = Math.round((shared / ((ra + rb) / 2)) * 100);
    if (degree < opts.coupling.min_degree_pct) continue;
    result.push({ a, b, shared, degree_pct: degree, rev_a: ra, rev_b: rb });
  }
  result.sort((x, y) => y.degree_pct - x.degree_pct || y.shared - x.shared);
  return { pairs: result, skipped_large: skippedLarge, raw_pair_count: pairs.size };
}

// Bird et al. define minor contributors as <5% of a component's commits. The
// threshold is meaningless under 20 revisions (1 commit is already ≥5%), so
// minor counts are only computed past that floor.
const MINOR_SHARE = 0.05;
const MINOR_MIN_REVISIONS = 20;

function ownershipFor(stats, enabled) {
  const authors = stats.authors.size;
  if (!enabled) return { authors, minor_authors: null };
  if (stats.revisions < MINOR_MIN_REVISIONS) return { authors, minor_authors: null };
  let minor = 0;
  for (const n of stats.authors.values()) {
    if (n / stats.revisions < MINOR_SHARE) minor++;
  }
  return { authors, minor_authors: minor };
}

function ageDays(dateStr) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

function computeHotspots(fileStats, ownershipEnabled) {
  const rows = [];
  let missingOnDisk = 0;
  let maxRev = 0;
  let maxLoc = 0;

  for (const s of fileStats.values()) {
    const loc = s.binary ? null : countLoc(s.path);
    if (loc === null) missingOnDisk++;
    const own = ownershipFor(s, ownershipEnabled);
    rows.push({
      file: s.path,
      revisions: s.revisions,
      loc,
      churn: s.added + s.deleted,
      churn_ratio: loc ? Math.round(((s.added + s.deleted) / loc) * 100) / 100 : null,
      fix_commits: s.fix_commits,
      authors: own.authors,
      minor_authors: own.minor_authors,
      age_days: ageDays(s.last_date),
      score: 0,
    });
    if (s.revisions > maxRev) maxRev = s.revisions;
    if (loc && loc > maxLoc) maxLoc = loc;
  }

  for (const r of rows) {
    if (r.loc === null || !maxRev || !maxLoc) continue;
    r.score = Math.round((r.revisions / maxRev) * (r.loc / maxLoc) * 1000) / 1000;
  }
  rows.sort((x, y) => y.score - x.score || y.revisions - x.revisions);
  return { rows, missing_on_disk: missingOnDisk };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function mdTable(header, rows) {
  const lines = ["| " + header.join(" | ") + " |", "|" + header.map(() => "---").join("|") + "|"];
  for (const r of rows) lines.push("| " + r.join(" | ") + " |");
  return lines.join("\n");
}

function renderMarkdown(data, opts) {
  const t = data.truncation;
  const lines = [
    "# Evolution Report (git-history behavioral metrics)",
    "",
    `Window: last ${opts.window_months} months (since ${data.window.from}) · commits analyzed: ${data.commits_analyzed} · files changed: ${data.files_tracked} · tracked files never touched in window (stable): ${data.aggregates.cold_files}`,
    "",
    `Shown: top ${t.hotspots_shown}/${t.hotspots_total} hotspots, top ${t.coupling_shown}/${t.coupling_total} coupling pairs (full data: evolution-report.json). Coupling excluded ${data.commits_skipped_large} commits over ${opts.max_changeset_size} files (mass edits create false coupling).${data.test_files_excluded ? ` Excluded ${data.test_files_excluded} test file(s) from all metrics (opts.exclude_tests).` : ""}`,
    "",
    "## Hotspots (change frequency × size)",
    "",
    "Files where structural findings cost the most — effort concentrates here. `score` is normalized revisions × LOC; `fix` counts bug-fix commits touching the file (defect-density proxy).",
    "",
    mdTable(
      ["file", "revs", "loc", "churn/loc", "fix", "authors", "minor", "age(d)", "score"],
      data.hotspots.slice(0, opts.top_n).map((h) => [
        h.file, h.revisions, h.loc === null ? "—" : h.loc,
        h.churn_ratio === null ? "—" : h.churn_ratio, h.fix_commits,
        h.authors, h.minor_authors === null ? "—" : h.minor_authors,
        h.age_days === null ? "—" : h.age_days, h.score,
      ]),
    ),
    "",
    "## Change coupling (files that co-change)",
    "",
    "Pairs with a hidden dependency: `degree` = shared commits / average revisions. Pairs WITHOUT a structural edge (import/call) are the interesting ones — invisible coupling the dependency graph cannot see.",
    "",
    data.coupling.length
      ? mdTable(
          ["file A", "file B", "shared", "degree %"],
          data.coupling.slice(0, opts.top_n).map((c) => [c.a, c.b, c.shared, c.degree_pct]),
        )
      : `_No pairs above thresholds (min shared ${opts.coupling.min_shared}, min degree ${opts.coupling.min_degree_pct}%)._`,
    "",
    "## Ownership",
    "",
    data.team.ownership_computed
      ? `Authors in window: ${data.team.authors}. Files with minor contributors (<5% of the file's commits, ≥${MINOR_MIN_REVISIONS} revisions) carry elevated defect risk (Bird et al.) — see \`minor\` column above.`
      : `Skipped: ${data.team.reason} (authors in window: ${data.team.authors}). Ownership metrics need ≥3 authors to carry signal; force with config \`evolution.ownership: true\`.`,
    "",
    "## How to use this",
    "",
    "- Rank structural findings by hotspot score: a violation in a top hotspot outranks the same violation in cold code.",
    "- High-degree coupling pairs with no structural relationship suggest a missing abstraction or copy-paste twins.",
    "- High `churn/loc` with high `fix` = bleeding edge; stabilize before extending.",
    "- Old + untouched (high age, zero fix) = stable; do not refactor without cause.",
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function scan(args) {
  const opts = resolveOptions(args);

  if (!isGitRepo()) {
    return { ok: false, reason: "not_a_git_repo", scanner: SCANNER_NAME };
  }

  const from = afterDate(opts.window_months);
  let raw;
  try {
    raw = readLog(from);
  } catch (err) {
    return { ok: false, reason: "git_log_failed", error: err.message, scanner: SCANNER_NAME };
  }

  readSubjects(from);
  const fixRe = new RegExp(opts.fix_pattern, "i");
  const excludedTests = new Set();
  const commits = parseLog(raw, opts, excludedTests);

  const fileStats = computeFileStats(commits, fixRe);

  const distinctAuthors = new Set(commits.map((c) => c.author)).size;
  const ownershipEnabled =
    opts.ownership === true || (opts.ownership === "auto" && distinctAuthors >= 3);

  const { rows: hotspots, missing_on_disk } = computeHotspots(fileStats, ownershipEnabled);
  const coupling = computeCoupling(commits, fileStats, opts);

  const trackedTestRe = opts.exclude_tests ? compileTestPatterns(opts.test_path_patterns) : [];
  const tracked = listTrackedFiles().filter(
    (f) => !matchesExclude(f, opts.exclude) && !matchesTestPath(f, trackedTestRe)
  );
  const changedSet = new Set(fileStats.keys());
  const coldFiles = tracked.filter((f) => !changedSet.has(f)).length;

  const totalRevs = hotspots.reduce((n, h) => n + h.revisions, 0);
  const top10Revs = hotspots.slice(0, 10).reduce((n, h) => n + h.revisions, 0);

  const data = {
    ok: true,
    scanner: SCANNER_NAME,
    version: SCANNER_VERSION,
    generated_at: new Date().toISOString(),
    window: { from, months: opts.window_months },
    commits_analyzed: commits.length,
    commits_skipped_large: coupling.skipped_large,
    files_tracked: fileStats.size,
    files_missing_on_disk: missing_on_disk,
    test_files_excluded: excludedTests.size,
    team: {
      authors: distinctAuthors,
      ownership_computed: ownershipEnabled,
      reason: ownershipEnabled ? null : (opts.ownership === false ? "disabled_by_config" : "solo_or_small_team"),
    },
    aggregates: {
      cold_files: coldFiles,
      tracked_files: tracked.length,
      top10_hotspot_share_pct: totalRevs ? Math.round((top10Revs / totalRevs) * 100) : 0,
    },
    truncation: {
      hotspots_shown: Math.min(opts.top_n, hotspots.length),
      hotspots_total: hotspots.length,
      coupling_shown: Math.min(opts.top_n, coupling.pairs.length),
      coupling_total: coupling.pairs.length,
      coupling_raw_pairs: coupling.raw_pair_count,
    },
    hotspots,
    coupling: coupling.pairs,
  };

  let report_md = null;
  let report_json = null;
  if (opts.write) {
    fs.mkdirSync(opts.out_dir, { recursive: true });
    report_md = path.join(opts.out_dir, "evolution-report.md");
    report_json = path.join(opts.out_dir, "evolution-report.json");
    atomicWriteFileSync(report_md, renderMarkdown(data, opts));
    atomicWriteFileSync(report_json, JSON.stringify(data, null, 2) + "\n");
  }

  // stdout stays compact — full tables live in the report files
  return {
    ok: true,
    scanner: SCANNER_NAME,
    window: data.window,
    commits_analyzed: data.commits_analyzed,
    commits_skipped_large: data.commits_skipped_large,
    files_tracked: data.files_tracked,
    test_files_excluded: data.test_files_excluded,
    team: data.team,
    aggregates: data.aggregates,
    truncation: data.truncation,
    top_hotspots: hotspots.slice(0, 5).map((h) => ({ file: h.file, revisions: h.revisions, score: h.score })),
    top_coupling: coupling.pairs.slice(0, 5).map((c) => ({ a: c.a, b: c.b, degree_pct: c.degree_pct })),
    report_md,
    report_json,
  };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function run(subcommand, args) {
  switch (subcommand) {
    case "scan":
      return scan(args);
    default:
      return {
        ok: false,
        error: "Unknown evolution subcommand. Use: scan",
        usage: "evolution scan [--window-months=N] [--top=N] [--max-changeset-size=N] [--out-dir=DIR] [--no-write]",
      };
  }
}

module.exports = { run, scan, parseLog, computeCoupling, matchesExclude };
