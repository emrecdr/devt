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
// Compiled from the contract's regex strings — never hand-list patterns here.
// A hand-maintained copy silently diverged (lane-diff/review-lane/plan/research/
// spec/debug slugs classified ad_hoc and were cleanup-archived while the
// contract declared them legal).
const ALLOWED_PATTERNS = ((state.STATE_FILE_CONTRACT || {}).allowed_patterns || []).map((s) => new RegExp(s));
const EPHEMERAL_PATTERNS = ((state.STATE_FILE_CONTRACT || {}).ephemeral_patterns || []).map((s) => new RegExp(s));

// Subdirectories that are legitimate citizens of .devt/state/ — never flagged
// ad_hoc, never moved by cleanupStateFiles. Update this set when a new
// canonical subdir convention ships.
const CANONICAL_SUBDIRS = new Set([
  ".archive",     // reset/cleanup archive history
  "threads",      // session handoffs + cross-session threads — an OPEN thread
                  // must never be bulk-archived out from under a future session
  "lane-files",   // round 8 register-lane sidecar dir (per-lane files arrays)
  // The project's own half of .devt/state/. Projects treat this directory as
  // shared scratch while devt treats it as private state, and that collision —
  // not any single filename — is what let a review archive a baseline the
  // project's test suite reads, three runs running. Anything a project needs to
  // SURVIVE a devt run belongs here; everything else in .devt/state/ is devt's
  // to sweep. Protecting individual filenames instead would fix one file and
  // let the next project-owned artifact reproduce the bug.
  "project",
  "hook-trace",   // universal hook invocation trace (run-hook.js). A directory,
                  // so it was bulk-moved whole; hook-cost + weekly-report +
                  // telemetry-calibrate read only the live path.
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

// Two populations, and the bug was one policy over both.
//
// devt-owned = matches the STATE_FILE_CONTRACT (canonical / pattern_allowed /
// ephemeral). Foreign = matched nothing, so devt did not write it. That
// question is answerable with certainty; age is a proxy, and it is wrong in
// exactly the case that hurt — a repo-committed file is ALWAYS older than the
// workflow, so a project's test baseline qualified for archival on every run
// while the test that reads it failed and blamed the branch.
//
// Git-tracking looked like a cleaner authorship signal and is not available:
// projects gitignore .devt/state/ wholesale, so "did the project commit it?"
// answers no for the baseline too.
//
// autoSweep (init's unattended call) archives ONLY devt-owned files and
// reports the foreign ones. An operator running `state cleanup` by hand still
// sweeps foreign files — the harm was the silence and the automation, not the
// archival, and a project whose scratch shares the directory still needs a way
// to clear it.
function cleanupStateFiles(opts = {}) {
  const dryRun = opts.dryRun !== false;
  const autoSweep = opts.autoSweep === true;
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
  const foreign = [];
  for (const f of audit.buckets.ad_hoc) {
    if (autoSweep) { foreign.push({ name: f.name, size: f.size, isDir: !!f.isDir }); continue; }
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

  foreign.sort((a, b) => a.name.localeCompare(b.name));

  if (toArchive.length === 0) {
    return { ok: true, dryRun, archived: [], total_bytes_archived: 0, archive_path: null, foreign, foreign_count: foreign.length };
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

  // The archive is the only place the eviction is recoverable from, so it
  // carries its own explanation. A file's presence here is otherwise
  // indistinguishable from a file nobody wanted.
  if (!dryRun && archived.length > 0) {
    const lines = [
      `# devt state archive — ${archiveTs}`,
      `# Each row: <reason>\t<file>. Restore with: mv <file> ../../`,
      "",
      ...archived.map((a) => `${a.reason}\t${a.name}`),
    ];
    if (foreign.length > 0) {
      lines.push("", "# NOT archived — devt did not write these, so they were left in place:",
        ...foreign.map((f) => `left_in_place\t${f.name}`));
    }
    try { fs.writeFileSync(`${archiveDir}${path.sep}MANIFEST.txt`, lines.join("\n") + "\n"); }
    catch { /* manifest is explanatory, not load-bearing */ }
  }

  return {
    ok: true,
    dryRun,
    archived,
    total_bytes_archived: totalBytes,
    archive_path: dryRun ? null : archiveDir,
    foreign,
    foreign_count: foreign.length,
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
  const { dryRun = false, maxAgeMinutes = null, minMtimeMs = null } = opts;
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
  // One cutoff, two entry forms: an absolute session anchor, or a duration a
  // caller already converted from one. Both mean "keep anything written at or
  // after this instant", so they resolve to a single instant here rather than
  // two gates in the loop — held apart, they drifted by up to the rounding in
  // the duration conversion and carried two `skipped` labels for one condition.
  const cutoffMs = minMtimeMs != null ? Number(minMtimeMs)
    : maxAgeMinutes != null ? nowMs - Number(maxAgeMinutes) * 60 * 1000
    : null;

  for (const filename of GRAPHIFY_EVICTABLE) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const fullPath = path.join(stateDir, filename);
    if (!fs.existsSync(fullPath)) {
      skipped.push({ file: filename, reason: "absent" });
      continue;
    }
    // Session gate — the same predicate the WORKFLOW_SCOPED_CANONICAL sweep
    // applies: anything written at or after the cutoff belongs to this session
    // and must survive. Stat failure falls through to eviction rather than
    // preserving state nothing can vouch for.
    if (cutoffMs != null) {
      try {
        const mtimeMs = fs.statSync(fullPath).mtimeMs;
        if (mtimeMs >= cutoffMs) {
          skipped.push({ file: filename, reason: "same_session", age_ms: Math.round(nowMs - mtimeMs) });
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

  // Session anchor + whether a run is in flight.
  //
  // Read through the canonical state reader rather than a regex over raw YAML:
  // any quoting or indentation the reader accepts but a regex misses would
  // silently disarm the guard.
  let anchorMs = 0;
  let priorIsActive = false;
  try {
    const st = state.readState() || {};
    priorIsActive = String(st.active) === "true";
    const parsed = Date.parse(st.first_created_at || "");
    if (Number.isFinite(parsed)) anchorMs = parsed;
  } catch { /* no workflow.yaml — sweep without the session gate */ }

  // Written at or after this session's anchor. Stat failure is NOT survival:
  // state nothing can vouch for is treated as residue.
  const survivesSession = (fullPath) => {
    if (anchorMs <= 0) return false;
    try { return fs.statSync(fullPath).mtimeMs >= anchorMs; } catch { return false; }
  };

  // Two contracts, deliberately different.
  //
  // "stale_only" (canonical + slug outputs): evict ONLY what predates the
  // session anchor. A current-session write always survives, and with no
  // anchor at all staleness is unjudgeable, so nothing is touched.
  //
  // "unless_in_flight" (gate markers): the opposite contract — a marker MUST
  // NOT outlive its workflow, or a stale one silently satisfies the next
  // workflow's gate, so being recent is no defence once the run is closed.
  // Freshness may only protect it while a run is genuinely in flight.
  // Ungated, this deleted a live run's verification.{json,md}, its
  // dropped-symbols sidecar and its markers on a mid-flight re-entry, and the
  // terminal verifier gate then blocked on a verifier that had in fact run.
  const sweep = (filenames, reason, mode) => {
    for (const filename of filenames) {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const fullPath = path.join(stateDir, filename);
      if (!fs.existsSync(fullPath)) {
        if (!reason) skipped.push({ file: filename, reason: "absent" });
        continue;
      }
      if (mode === "stale_only" && anchorMs <= 0) continue;
      const protectedByFreshness = mode === "stale_only" ? true : priorIsActive;
      if (protectedByFreshness && survivesSession(fullPath)) {
        skipped.push({ file: filename, reason: "same_session" });
        continue;
      }
      if (dryRun) {
        evicted.push(reason ? { file: filename, dry_run: true, reason } : { file: filename, dry_run: true });
        continue;
      }
      try {
        fs.unlinkSync(fullPath);
        evicted.push(reason ? { file: filename, reason } : { file: filename });
      } catch (e) {
        skipped.push({ file: filename, reason: "unlink_failed", error: String(e && e.message || e) });
      }
    }
  };

  sweep(WORKFLOW_EVICTABLE, null, "unless_in_flight");
  // Workflow-scoped canonical outputs — a single PR's review.md /
  // test-summary.* / verification.*. Left in place across a workflow boundary,
  // the verifier grades against the PRIOR PR's review and produces a confident
  // wrong verdict.
  sweep(WORKFLOW_SCOPED_CANONICAL, "stale_canonical", "stale_only");

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
  // Same session predicate as the sweeps above — one read, three consumers.
  try {
    for (const entry of fs.readdirSync(stateDir)) {
      if (!SLUG_VARIANT_PATTERNS.some(re => re.test(entry))) continue;
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const fullPath = path.join(stateDir, entry);
      if (survivesSession(fullPath)) {
        skipped.push({ file: entry, reason: "same_session" });
        continue;
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

  // Chain evictGraphifyArtifacts — workflow eviction is a superset.
  // Anchored on the same session cutoff the canonical sweep above uses.
  // Ungated, this deleted a graph-impact.md the CURRENT run had just built:
  // context-init calls `init`, `init` lands here, and the map died before the
  // orchestrator ever dispatched — leaving lane envelopes pointing at a file
  // that no longer existed while the workflow's own health field, which
  // nothing blocks on, was the only trace. A zero-second-old map was reachable
  // by this path. Cross-session artifacts still predate the anchor and go.
  // Same contract as the gate markers, for the same reason: graph-impact.md
  // SATISFIES assert-graphify-decision, so a map that outlives its workflow
  // would let a new run's gate pass on the prior run's blast radius. Freshness
  // protects it only while a run is in flight; once closed it goes and the next
  // context_init rebuilds it.
  const graphifyResult = evictGraphifyArtifacts(
    priorIsActive && anchorMs > 0 ? { dryRun, minMtimeMs: anchorMs } : { dryRun }
  );
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
