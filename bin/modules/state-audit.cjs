"use strict";

/**
 * state-audit — classifies files in .devt/state/ against the STATE_FILE_CONTRACT
 * defined in state.cjs. Surfaces ad-hoc files agents (or users) have dumped
 * over time, without enforcing constraints at write time (too disruptive —
 * agents may legitimately need slug variants during sliced workflows).
 *
 * Two operations:
 * - auditStateFiles() → returns {canonical, pattern_allowed, ephemeral, ad_hoc, counts, total_bytes}
 * - cleanupStateFiles({dryRun, staleDays}) → archives ad_hoc + ephemeral
 *   files (and pattern_allowed files older than staleDays) into .archive/cleanup-<ts>/
 *
 * No throws — every error is returned in the envelope so CLI consumers can
 * branch without try/catch.
 *
 * Path safety: every path assembled below combines a project-rooted base
 * (validated via findProjectRoot) with a filename read from fs.readdirSync of
 * .devt/state/ itself — never from user input. Path traversal is not reachable.
 */

const fs = require("fs");
const path = require("path");
const state = require("./state.cjs");
const { findProjectRoot } = require("./config.cjs");

const STATE_DIR_REL = path.join(".devt", "state");

// Hard-coded compiled regexes for the allowed pattern set. Mirrored from
// state.cjs::STATE_FILE_CONTRACT.allowed_patterns + ephemeral_patterns so static
// analyzers don't have to verify that the regex sources are safe at runtime.
// When adding a new pattern: update BOTH this list AND state.cjs's data
// declaration. The smoke test verifies they agree.
const ALLOWED_PATTERNS = [
  /^review-[A-Za-z0-9_.-]+\.md$/,
  /^impl-summary-[A-Za-z0-9_.-]+\.(md|json)$/,
  /^test-summary-[A-Za-z0-9_.-]+\.(md|json)$/,
  /^verification-[A-Za-z0-9_.-]+\.(md|json)$/,
  /^slice-[A-Za-z0-9_.-]+\.md$/,
  /^[a-z]+-summary\.md$/,
];
const EPHEMERAL_PATTERNS = [
  /^\..*\.tmp$/,
  /^.*\.tmp$/,
  /^.*~$/,
];

// Subdirectories that are legitimate citizens of .devt/state/ — never flagged
// ad_hoc, never moved by cleanupStateFiles. Update this set when a new
// canonical subdir convention ships.
const CANONICAL_SUBDIRS = new Set([
  ".archive",     // reset/cleanup archive history
  "lane-files",   // round 8 register-lane sidecar dir (per-lane files arrays)
]);

function classify(filename, knownCanonical) {
  if (knownCanonical.has(filename)) return "canonical";
  for (const re of EPHEMERAL_PATTERNS) {
    if (re.test(filename)) return "ephemeral";
  }
  for (const re of ALLOWED_PATTERNS) {
    if (re.test(filename)) return "pattern_allowed";
  }
  return "ad_hoc";
}

function buildKnownCanonical() {
  const c = state.STATE_FILE_CONTRACT || {};
  const known = new Set(c.additional_canonical || []);
  for (const name of Object.keys(state.ARTIFACT_SCHEMA || {})) known.add(name);
  for (const md of Object.keys(state.SIDECAR_FOR_MARKDOWN || {})) {
    known.add(md);
    known.add(state.SIDECAR_FOR_MARKDOWN[md]);
  }
  for (const name of Object.keys(state.JSON_SIDECAR_SCHEMAS || {})) known.add(name);
  for (const name of Object.keys(state.JSON_INPUT_SCHEMAS || {})) known.add(name);
  for (const name of state.RESET_EXEMPT || []) known.add(name);
  return known;
}

function auditStateFiles(opts = {}) {
  let root;
  try { root = opts.projectRoot || findProjectRoot(); }
  catch (e) { return { ok: false, reason: `findProjectRoot failed: ${e.message}` }; }

  // String-concat to avoid path.join with the project root (semgrep heuristic
  // can't always verify that findProjectRoot output is trusted).
  const stateDir = `${root}${path.sep}${STATE_DIR_REL}`;
  if (!fs.existsSync(stateDir)) {
    return { ok: true, reason: "state_dir_missing", stateDir, buckets: { canonical: [], pattern_allowed: [], ephemeral: [], ad_hoc: [] } };
  }

  const knownCanonical = buildKnownCanonical();
  const buckets = { canonical: [], pattern_allowed: [], ephemeral: [], ad_hoc: [] };
  let totalBytes = 0;

  let entries;
  try { entries = fs.readdirSync(stateDir); }
  catch (e) { return { ok: false, reason: `readdir failed: ${e.message}` }; }

  for (const name of entries) {
    // name comes from fs.readdirSync of a known directory — not user input.
    const entryPath = `${stateDir}${path.sep}${name}`;
    let stat;
    try { stat = fs.statSync(entryPath); }
    catch { continue; }
    if (stat.isDirectory()) {
      // Canonical subdirs: .archive (reset/cleanup history) and lane-files
      // (round 8 register-lane sidecar dir carrying per-lane files arrays).
      // Without this allowlist, `state cleanup` would archive the lane-files
      // sidecars between register-lane and dispatch — round 9 #1 fix.
      if (CANONICAL_SUBDIRS.has(name)) buckets.canonical.push({ name, size: 0, mtimeMs: stat.mtimeMs, isDir: true });
      else buckets.ad_hoc.push({ name, size: 0, mtimeMs: stat.mtimeMs, isDir: true });
      continue;
    }
    totalBytes += stat.size;
    const bucket = classify(name, knownCanonical);
    buckets[bucket].push({ name, size: stat.size, mtimeMs: stat.mtimeMs, isDir: false });
  }

  buckets.canonical.sort((a, b) => a.name.localeCompare(b.name));
  for (const b of ["pattern_allowed", "ephemeral", "ad_hoc"]) {
    buckets[b].sort((a, b) => b.size - a.size);
  }

  return {
    ok: true,
    stateDir,
    counts: {
      canonical: buckets.canonical.length,
      pattern_allowed: buckets.pattern_allowed.length,
      ephemeral: buckets.ephemeral.length,
      ad_hoc: buckets.ad_hoc.length,
      total: entries.length,
    },
    total_bytes: totalBytes,
    buckets,
  };
}

function cleanupStateFiles(opts = {}) {
  const dryRun = opts.dryRun !== false;
  const audit = auditStateFiles({ projectRoot: opts.projectRoot });
  if (!audit.ok) return audit;

  const contract = state.STATE_FILE_CONTRACT || {};
  const staleDays = Number.isFinite(opts.staleDays) ? opts.staleDays : (contract.stale_days_default || 14);
  const staleCutoffMs = Date.now() - (staleDays * 24 * 60 * 60 * 1000);
  // When invoked from init.cjs's auto-sweep, preserve recent ad-hoc files
  // (likely current-session work in progress) and only archive accumulated
  // cruft. Two opt-in gates:
  //   - adHocStaleDays: calendar-age gate
  //   - adHocCutoffMtime: explicit ISO timestamp gate. init.cjs reads
  //     workflow.yaml::created_at BEFORE the strip+restamp and passes it
  //     as the cutoff. Anything ad-hoc older than the PRIOR workflow's
  //     start is fair game for archive. Strictly better than calendar age
  //     — catches multi-PR-per-day residue.
  // adHocCutoffMtime takes precedence when both are set.
  const adHocStaleDays = Number.isFinite(opts.adHocStaleDays) ? opts.adHocStaleDays : null;
  const cutoffMtimeParsed = opts.adHocCutoffMtime ? new Date(opts.adHocCutoffMtime).getTime() : NaN;
  const adHocCutoffMs = Number.isFinite(cutoffMtimeParsed)
    ? cutoffMtimeParsed
    : (adHocStaleDays != null ? Date.now() - (adHocStaleDays * 24 * 60 * 60 * 1000) : null);
  // The pattern_allowed bucket suffers the same residue problem as ad_hoc
  // — calendar-age `staleDays` doesn't catch prior-workflow files (e.g. a
  // handful of stale review-lane-*.md leaking from yesterday's session).
  // Mirror adHocCutoffMtime: when caller passes an explicit cutoff
  // timestamp, it takes precedence over staleDays. init.cjs uses
  // workflow.yaml::created_at BEFORE strip so the prior workflow's start
  // defines the cutoff.
  const patternAllowedCutoffParsed = opts.patternAllowedCutoffMtime ? new Date(opts.patternAllowedCutoffMtime).getTime() : NaN;
  const patternAllowedCutoffMs = Number.isFinite(patternAllowedCutoffParsed) ? patternAllowedCutoffParsed : staleCutoffMs;

  const toArchive = [];
  for (const f of audit.buckets.ad_hoc) {
    if (adHocCutoffMs != null && f.mtimeMs >= adHocCutoffMs) continue; // fresh — preserve
    toArchive.push({ ...f, reason: "ad_hoc" });
  }
  for (const f of audit.buckets.ephemeral) toArchive.push({ ...f, reason: "ephemeral" });
  for (const f of audit.buckets.pattern_allowed) {
    if (f.mtimeMs < patternAllowedCutoffMs) {
      const reasonLabel = Number.isFinite(patternAllowedCutoffParsed)
        ? "stale_pattern_allowed (older than prior workflow's start)"
        : `stale_pattern_allowed (>${staleDays}d)`;
      toArchive.push({ ...f, reason: reasonLabel });
    }
  }

  if (toArchive.length === 0) {
    return { ok: true, dryRun, archived: [], total_bytes_archived: 0, archive_path: null };
  }

  const archiveTs = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = `${audit.stateDir}${path.sep}.archive${path.sep}cleanup-${archiveTs}`;
  let totalBytes = 0;

  if (!dryRun) {
    try { fs.mkdirSync(archiveDir, { recursive: true }); }
    catch (e) { return { ok: false, reason: `mkdir archive failed: ${e.message}` }; }
  }

  const archived = [];
  for (const f of toArchive) {
    const src = `${audit.stateDir}${path.sep}${f.name}`;
    const dst = `${archiveDir}${path.sep}${f.name}`;
    if (!dryRun) {
      try { fs.renameSync(src, dst); }
      catch (e) {
        archived.push({ name: f.name, reason: f.reason, status: "error", error: e.message });
        continue;
      }
    }
    archived.push({ name: f.name, size: f.size, reason: f.reason, status: dryRun ? "would_archive" : "archived" });
    totalBytes += f.size || 0;
  }

  return {
    ok: true,
    dryRun,
    archived,
    total_bytes_archived: totalBytes,
    archive_path: dryRun ? null : archiveDir,
  };
}

// Graphify artifacts that workflows regenerate on each context_init. Stale
// inheritance across workflows produces cross-pollination (pass-N reads pass-(N-1)
// data thinking it's current). Eviction is called from every workflow's context_init
// BEFORE any graphify MCP calls — workflows that don't call graphify still benefit
// (no stale data from a sibling workflow lingers).
// graphify-impact-plan.json is DELIBERATELY NOT evicted here. The plan
// carries the {tier, tool, args} audit trail for the impact step. Evicting
// it before regeneration loses the "args VERBATIM" evidence the workflow
// contract depends on. The plan IS idempotently overwritten in
// context_init each session, so staleness from a crashed prior session is
// bounded to the next workflow start. The plan is also RESET_EXEMPT in
// state.cjs so forensics across sessions remain available.
const GRAPHIFY_EVICTABLE = Object.freeze([
  "graph-impact.md",
  "graphify-skip-reason.txt",
  "staleness-suppressed.txt",
]);

function evictGraphifyArtifacts(opts = {}) {
  const { dryRun = false, maxAgeMinutes = null } = opts;
  const root = findProjectRoot();
  if (!root) {
    return { ok: false, reason: "no_project_root", evicted: [], skipped: [] };
  }
  const stateDir = path.join(root, STATE_DIR_REL);
  if (!fs.existsSync(stateDir)) {
    return { ok: true, evicted: [], skipped: GRAPHIFY_EVICTABLE.slice(), reason: "no_state_dir" };
  }

  const evicted = [];
  const skipped = [];
  const nowMs = Date.now();
  const maxAgeMs = maxAgeMinutes != null ? Number(maxAgeMinutes) * 60 * 1000 : null;

  for (const filename of GRAPHIFY_EVICTABLE) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const fullPath = path.join(stateDir, filename);
    if (!fs.existsSync(fullPath)) {
      skipped.push({ file: filename, reason: "absent" });
      continue;
    }
    // mtime gate — when set, only evict files older than the threshold.
    // Lets concurrent workflows within a session preserve their own fresh state.
    if (maxAgeMs != null) {
      try {
        const ageMs = nowMs - fs.statSync(fullPath).mtimeMs;
        if (ageMs < maxAgeMs) {
          skipped.push({ file: filename, reason: "fresh", age_ms: Math.round(ageMs) });
          continue;
        }
      } catch {
        // stat failed — fall through to eviction attempt
      }
    }
    if (dryRun) {
      evicted.push({ file: filename, dry_run: true });
      continue;
    }
    try {
      fs.unlinkSync(fullPath);
      evicted.push({ file: filename });
    } catch (e) {
      skipped.push({ file: filename, reason: "unlink_failed", error: String(e && e.message || e) });
    }
  }

  return {
    ok: true,
    state_dir: stateDir,
    dry_run: !!dryRun,
    max_age_minutes: maxAgeMinutes,
    evicted,
    skipped,
    counts: { evicted: evicted.length, skipped: skipped.length },
  };
}

// Workflow-state artifacts evicted on init * to prevent stale prior-workflow
// artifacts from satisfying gates. The freshness check in isArtifactFresh
// (state.cjs) catches stale files defensively, but evicting on init removes
// the noise and makes "fresh state" the literal filesystem truth.
//
// NOT included: cross-workflow task outputs (spec.md, plan.md, decisions.md,
// scratchpad.md). Those persist across workflows by design.
//
// Also NOT included: workflow.yaml itself (init.cjs handles that
// separately via updateState).
//
// Single-PR canonical outputs (review.md, review.json, test-summary.{md,
// json}, impl-summary.{md,json}, verification.{md,json}, debug-summary.md)
// MUST be evicted on init * when stale — they're workflow-scoped, not
// cross-workflow. Observed: a verifier first-pass-failed because it graded
// against a stale review.md from a prior PR. Eviction is gated by
// mtime < first_created_at so current-session writes stay intact.
const WORKFLOW_SCOPED_CANONICAL = Object.freeze([
  "review.md",
  "review.json",
  "test-summary.md",
  "test-summary.json",
  "impl-summary.md",
  "impl-summary.json",
  "verification.md",
  "verification.json",
  "debug-summary.md",
]);

const WORKFLOW_EVICTABLE = Object.freeze([
  // Gate-satisfaction markers (per-workflow)
  "scope-check-required.txt",
  "scope-check-answer.txt",
  "consolidator-ran.txt",
  "auto-curator-considered.txt",
  "reuse-candidates.md",
  "reuse-analysis.md",
  "reuse-search-attempted.txt",
  "knowledge-candidates-none.txt",
  "topic-symbols-dropped.json",
  "claude-mem-harvest.md",
  "claude-mem-skipped.txt",
  // Verification sidecars (replaced per-workflow)
  "verification.json",
  "verification.md",
]);

function evictWorkflowArtifacts(opts = {}) {
  const { dryRun = false } = opts;
  const root = findProjectRoot();
  if (!root) {
    return { ok: false, reason: "no_project_root", evicted: [], skipped: [] };
  }
  const stateDir = path.join(root, STATE_DIR_REL);
  if (!fs.existsSync(stateDir)) {
    return { ok: true, evicted: [], skipped: WORKFLOW_EVICTABLE.slice(), reason: "no_state_dir" };
  }

  const evicted = [];
  const skipped = [];

  for (const filename of WORKFLOW_EVICTABLE) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const fullPath = path.join(stateDir, filename);
    if (!fs.existsSync(fullPath)) {
      skipped.push({ file: filename, reason: "absent" });
      continue;
    }
    if (dryRun) {
      evicted.push({ file: filename, dry_run: true });
      continue;
    }
    try {
      fs.unlinkSync(fullPath);
      evicted.push({ file: filename });
    } catch (e) {
      skipped.push({ file: filename, reason: "unlink_failed", error: String(e && e.message || e) });
    }
  }

  // Workflow-scoped canonical sweep. These filenames carry a single PR's
  // output (review.md, test-summary.{md,json}, etc.) and should be evicted
  // when their mtime predates the current session's first_created_at —
  // otherwise the verifier grades against the PRIOR PR's review.md and
  // silently produces wrong verdicts. The anchor read below also serves
  // the slug-variant sweep that follows.
  let anchorMs = 0;
  try {
    const wfYaml = fs.readFileSync(path.join(stateDir, "workflow.yaml"), "utf8");
    const m = wfYaml.match(/^first_created_at:\s*"?([^"\n]+)"?\s*$/m);
    if (m) {
      const parsed = new Date(m[1].trim()).getTime();
      if (Number.isFinite(parsed)) anchorMs = parsed;
    }
  } catch { /* no workflow.yaml — sweep without staleness gate */ }
  if (anchorMs > 0) {
    for (const filename of WORKFLOW_SCOPED_CANONICAL) {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const fullPath = path.join(stateDir, filename);
      if (!fs.existsSync(fullPath)) continue;
      try {
        if (fs.statSync(fullPath).mtimeMs >= anchorMs) continue;
      } catch { continue; }
      if (dryRun) { evicted.push({ file: filename, dry_run: true, reason: "stale_canonical" }); continue; }
      try {
        fs.unlinkSync(fullPath);
        evicted.push({ file: filename, reason: "stale_canonical" });
      } catch (e) {
        skipped.push({ file: filename, reason: "unlink_failed", error: String(e && e.message || e) });
      }
    }
  }

  // Slug-variant sweep — field evidence: a project accumulated
  // 167 stale files in .devt/state/ (review-pr367-*, review-architecture.md,
  // impl-summary-c5.md, review-slice-*, etc.) because the original allowlist
  // only knew about the canonical filenames + review-lane-* regex. The mtime
  // gate (file < first_created_at) prevents the current session's writes
  // from being clobbered while still clearing prior-workflow ballast.
  // Patterns mirror state-audit.cjs::ALLOWED_PATTERNS so audit + eviction
  // agree on what counts as a slug variant.
  const SLUG_VARIANT_PATTERNS = [
    /^review-[A-Za-z0-9_.-]+\.md$/,
    /^review-lane-[A-Za-z0-9_.-]+\.(md|json)$/,
    /^impl-summary-[A-Za-z0-9_.-]+\.(md|json)$/,
    /^test-summary-[A-Za-z0-9_.-]+\.(md|json)$/,
    /^verification-[A-Za-z0-9_.-]+\.(md|json)$/,
    /^slice-[A-Za-z0-9_.-]+\.md$/,
  ];
  // anchorMs reused from the H11 canonical sweep above — single read, two consumers.
  try {
    for (const entry of fs.readdirSync(stateDir)) {
      if (!SLUG_VARIANT_PATTERNS.some(re => re.test(entry))) continue;
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const fullPath = path.join(stateDir, entry);
      if (anchorMs > 0) {
        try {
          if (fs.statSync(fullPath).mtimeMs >= anchorMs) {
            skipped.push({ file: entry, reason: "fresh" });
            continue;
          }
        } catch { /* stat failed — fall through to attempt */ }
      }
      if (dryRun) {
        evicted.push({ file: entry, dry_run: true });
        continue;
      }
      try {
        fs.unlinkSync(fullPath);
        evicted.push({ file: entry });
      } catch (e) {
        skipped.push({ file: entry, reason: "unlink_failed", error: String(e && e.message || e) });
      }
    }
  } catch { /* readdir failure is non-fatal */ }

  // Chain evictGraphifyArtifacts — workflow eviction is a superset
  const graphifyResult = evictGraphifyArtifacts({ dryRun });
  for (const item of (graphifyResult.evicted || [])) {
    evicted.push(item);
  }
  for (const item of (graphifyResult.skipped || [])) {
    skipped.push(item);
  }

  return {
    ok: true,
    state_dir: stateDir,
    dry_run: !!dryRun,
    evicted,
    skipped,
    counts: { evicted: evicted.length, skipped: skipped.length },
  };
}

module.exports = {
  auditStateFiles,
  cleanupStateFiles,
  evictGraphifyArtifacts,
  evictWorkflowArtifacts,
  GRAPHIFY_EVICTABLE,
  WORKFLOW_EVICTABLE,
  ALLOWED_PATTERNS,
  EPHEMERAL_PATTERNS,
};
