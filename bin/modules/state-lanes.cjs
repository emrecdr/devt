"use strict";

// state-lanes — lane registration, sizing, diff generation, and lane-output listing for parallel-review fan-out.
// Mechanical split of the former single-file state.cjs — function bodies are
// verbatim moves; state.cjs remains the facade that re-exports every public
// name, so all consumers keep requiring bin/modules/state.cjs unchanged.

const fs = require("fs");
const path = require("path");
const { findProjectRoot } = require("./config.cjs");
const { atomicWriteFileSync, atomicWriteJsonSync } = require("./io.cjs");
const { FILE_REL: DEFERRED_FILE_REL } = require("./deferred.cjs");
const {
  STATE_DIR,
  WORKFLOW_FILE,
  LOCK_TIMEOUT_MS,
  LOCK_RETRY_MS,
  _INSTANCE_ID_PATTERN,
  ARTIFACT_FRESHNESS_GRACE_MS,
  KNOWN_STATE_KEYS,
  PHASE_ORDER,
  VALID_PHASES,
  PHASE_ARTIFACT_MAP,
  VALID_TIERS,
  TIER_RANK,
  INPUT_ARTIFACTS,
  MISMATCH_REASONS,
  VERIFICATION_STATUSES,
  VERIFICATION_VERDICTS,
  JSON_SIDECAR_SCHEMAS,
  JSON_INPUT_SCHEMAS,
  ARTIFACT_SCHEMA,
  SIDECAR_FOR_MARKDOWN,
  PERSISTENT_ARTIFACTS,
  VALID_WORKFLOW_TYPES,
  VALID_LANE_STATUSES,
  _ACTIVE_SUBAGENT_FRESH_MS,
  ARCHIVE_DIR,
  RESET_EXEMPT,
  STATE_FILE_CONTRACT,
  RESET_SOFT_CLEAR_KEYS,
  RESET_SOFT_ROTATE_LOGS,
  RESET_SOFT_EVICT_PATTERNS,
  TRUNCATABLE_ARTIFACTS,
  _DISK_WARN_MB,
  STUB_MARKER_PATTERNS,
  STUB_WORD_COUNT_THRESHOLD,
  STUB_PHRASE_WORD_CEILING,
  VERIFIER_REQUIRED_WORKFLOWS,
  SELF_FLAG_SIDECAR_FOR_AGENT,
  REUSE_REQUIRED_WORKFLOWS,
  STUB_SIZE_THRESHOLD,
  LANE_DIFF_CHUNKED_THRESHOLD,
  LANE_DIFF_SPLIT_THRESHOLD,
  SIZING_EXCLUDE_DEFAULT,
} = require("./state-contract.cjs");
const {
  getStateDir,
  getStateRoot,
  getWorkflowPath,
  ensureStateDir,
  isArtifactFresh,
  parseSimpleYaml,
  serializeSimpleYaml,
  warnState,
  validateStateEntry,
  getScopeFileCount,
  computeTierFloor,
  readState,
  extractStatus,
  validateConsistency,
  validateInputJson,
  describeMismatch,
  sleepSync,
  acquireLock,
  releaseLock,
  readSidecar,
  readSection,
  checkWorkflowLock,
  workflowIdChainSet,
  _getFlag,
} = require("./state-io.cjs");


// Slug normalization for lane file names. Graphify affected_communities[].name
// can carry spaces, hyphens, slashes, or other separators that would produce
// invalid filenames. Rule: lowercase, replace non-alphanum with underscore,
// collapse repeats, trim, cap at 32 chars. Deterministic and stable across
// re-partitions.
// Lane review artifacts are named `review-lane-<key>.md` — keyed by slug when
// registered, by lane id when the reader resolves a hand-written prompt. Both
// go through here so they cannot drift: if the shape ever moves and only the
// writer follows, the alias stops resolving and every lane reads as missing.
function laneReviewPath(dir, key) {
  return path.join(dir, `review-lane-${key}.md`);
}

function slugifyLaneName(name) {
  if (!name || typeof name !== "string") return "ungrouped";
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return slug || "ungrouped";
}


// Surfaces the canonical lane registry from workflow.yaml::lanes[] alongside
// each lane's review file existence + size. Consumed by code-review-parallel.md's
// substance_check_lanes + consolidate steps. Returns empty lanes:[] when no
// parallel workflow is active (lanes key missing from workflow.yaml).
function listLaneOutputs() {
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const wfPath = path.join(dir, "workflow.yaml");
  if (!fs.existsSync(wfPath)) {
    return { lanes: [], reason: "no workflow.yaml" };
  }
  const yaml = fs.readFileSync(wfPath, "utf8");
  // first_created_at lets each lane report stale=true when its review_file
  // predates the current session anchor — calibration #8 surfaced lanes
  // registered in a prior workflow whose physical files were long gone
  // (file_exists:false) but whose metadata still satisfied consumers.
  //
  // Cid-match correctness defense. Dispatch envelope stamps
  // `cid_<workflow_id_prefix>_<lane_id>` and the lane reviewer's file body
  // surfaces it. Matching against the whole session id chain (not just the
  // current id) keeps lanes stamped before a workflow_type rotation from
  // classifying as foreign; the mtime >= anchor bound keeps genuinely stale
  // files (prior session, eviction miss) out even when their id survives in
  // the preserved history.
  const chain = workflowIdChainSet(yaml);
  const anchorMs = chain.anchor_ms;
  // Light YAML parse: the lanes[] block uses a fixed shape; we extract via
  // line-based parsing to avoid pulling in a YAML library (zero-deps rule).
  const lanes = [];
  const blocks = yaml.split(/^  - id:/m).slice(1);
  for (const block of blocks) {
    const id = (block.match(/^\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const community = (block.match(/^\s+community:\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const reviewFile = (block.match(/^\s+review_file:\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const status = (block.match(/^\s+status:\s*"?([^"\n]+)"?\s*$/m) || [])[1];
    const redispatchCount = parseInt(
      (block.match(/^\s+redispatch_count:\s*(\d+)\s*$/m) || [])[1] || "0", 10);
    // Lane sizing fields written by registerLane (both the auto-partitioner
    // and hand-rolled partitions route through it). size_class is diff-LOC
    // based (ok/chunked/split); an empty diff re-sizes on whole-file LOC
    // (ok/chunked), and only an unusable git context yields "unknown". Absent
    // on lanes registered by older tool versions or stripped during a manual
    // workflow.yaml edit.
    const fileCount = parseInt(
      (block.match(/^\s+file_count:\s*(\d+)\s*$/m) || [])[1] || "0", 10);
    const estLoc = parseInt(
      (block.match(/^\s+est_loc:\s*(\d+)\s*$/m) || [])[1] || "0", 10);
    const sizeClass = (block.match(/^\s+size_class:\s*"?([\w-]+)"?\s*$/m) || [])[1] || null;
    const sizeBasis = (block.match(/^\s+size_basis:\s*"?([\w-]+)"?\s*$/m) || [])[1] || null;
    const diffArtifact = (block.match(/^\s+diff_artifact:\s*"?([^"\n]+)"?\s*$/m) || [])[1] || null;
    const correlationId = (block.match(/^\s+correlation_id:\s*"?([^"\n]+)"?\s*$/m) || [])[1] || null;
    if (!id) continue;
    let sizeBytes = 0;
    let exists = false;
    let mtimeMs = 0;
    let resolvedFile = reviewFile ? reviewFile.trim() : null;
    let aliasResolved = false;
    if (resolvedFile) {
      const statInto = (p) => {
        try {
          const stat = fs.statSync(p);
          sizeBytes = stat.size;
          mtimeMs = stat.mtimeMs;
          return true;
        } catch { return false; }
      };
      exists = statInto(resolvedFile);
      // review_file is slugified from the lane's scope string, which truncates
      // mid-word and is not obviously derivable. An operator writing dispatch
      // prompts by hand naturally names the lane by id, and every lane then
      // reported file_exists:false with the reviews sitting on disk beside the
      // expected path — enough to fail every claim-check and trigger a full
      // round of pointless re-dispatches. Accept the id-form as an alias.
      if (!exists) {
        const alias = laneReviewPath(path.dirname(resolvedFile), String(id).trim());
        if (alias !== resolvedFile && statInto(alias)) {
          resolvedFile = alias;
          exists = true;
          aliasResolved = true;
        }
      }
    }
    // stale when the on-disk file is older than this session's anchor;
    // absent files cannot be classified (no mtime) so they stay stale=false
    // even though file_exists:false — consumers should treat absence as its
    // own signal.
    const stale = exists && anchorMs > 0 && mtimeMs < anchorMs;

    // Cid-match extraction. Reads first 2KB of the lane file looking for
    // a `cid_<8hex>` pattern (the dispatch correlation-id format). Outcomes:
    //   "current" — cid prefix ∈ session id chain AND file mtime >= anchor
    //   "foreign" — prefix outside the chain, OR chain-matched but written
    //               before this session's anchor (prior-session leftover
    //               surviving eviction — history is preserved across resets,
    //               so id membership alone cannot vouch for freshness)
    //   "absent"  — no cid found (legacy lane file pre-cid OR file missing)
    // Consumers (consolidator query, gate checks) select `cid_match != "foreign"`
    // to defend against the eviction-misses-a-file case. Bounded 2KB read so
    // huge review files don't slow listLaneOutputs. cid_prefix is surfaced so
    // an exclusion is diagnosable (which rotation stamped the lane) instead of
    // a bare count.
    let cidMatch = "absent";
    let cidPrefix = null;
    if (exists && resolvedFile && chain.prefixes.size > 0) {
      try {
        const fd = fs.openSync(resolvedFile, "r");
        const buf = Buffer.alloc(2048);
        try { fs.readSync(fd, buf, 0, 2048, 0); } finally { fs.closeSync(fd); }
        const head = buf.toString("utf-8");
        const cidM = head.match(/cid_([0-9a-f]{8})/);
        if (cidM) {
          cidPrefix = cidM[1];
          const inChain = chain.prefixes.has(cidM[1]);
          const mtimeOk = anchorMs > 0 ? mtimeMs >= anchorMs : true;
          cidMatch = inChain && mtimeOk ? "current" : "foreign";
        }
      } catch { /* read error — leave as "absent" */ }
    }

    // Registration-cid fallback: before a reviewer echoes the cid into the
    // review file, fall back to the deterministic cid stamped at register-lanes
    // so trace-back + the stale-lane filter (cid_match != "foreign") work
    // immediately after registration, not only after a reviewer runs.
    if (cidMatch === "absent" && correlationId) {
      const rm = correlationId.match(/cid_([0-9a-f]{8})/);
      if (rm) {
        cidPrefix = cidPrefix || rm[1];
        const mtimeOk = (exists && anchorMs > 0) ? mtimeMs >= anchorMs : true;
        cidMatch = (chain.prefixes.has(rm[1]) && mtimeOk) ? "current" : "foreign";
      }
    }

    lanes.push({
      id: id ? id.trim() : null,
      community: community ? community.trim() : null,
      review_file: resolvedFile,
      ...(aliasResolved ? { review_file_registered: reviewFile.trim(), review_file_resolved_via: "id_alias" } : {}),
      status: status ? status.trim() : null,
      redispatch_count: redispatchCount,
      file_count: fileCount,
      est_loc: estLoc,
      size_class: sizeClass,
      size_basis: sizeBasis,
      diff_artifact: diffArtifact,
      file_exists: exists,
      file_size_bytes: sizeBytes,
      stale,
      cid_match: cidMatch,
      cid_prefix: cidPrefix,
      correlation_id: correlationId,
    });
  }
  return { lanes };
}

// Deterministic severity tally across registered lane review files. Parses
// the stable finding-heading markers (### [Critical|Important|Minor|Nit] ...)
// per lane and sums — the consolidate step compares these numbers against its
// consolidated counts and the orchestrator's notes, hard-stopping on mismatch
// (field: a consolidator correctly recounted 10 Importants where the
// orchestrator's mental tally said 7 — the error class exists; make the
// recount mechanical instead of a judgment save).
const _SEVERITIES = ["critical", "important", "minor", "nit"];

function _normalizeCounts(raw) {
  const out = {};
  for (const k of _SEVERITIES) out[k] = Number.isFinite(raw && raw[k]) ? raw[k] : 0;
  return out;
}

// Per-lane JSON sidecars written by each lane reviewer. This is the only lane
// total the consolidator cannot author, which is what makes it the primary
// basis: the consolidator's raw_lane_finding_counts stays as a cross-check,
// catching the case where the two disagree, but it cannot catch a drop that is
// under-reported consistently. Returns null when no lane wrote one, so the
// caller falls back and SAYS it fell back.
function _laneSidecarCounts() {
  let lanes = [];
  try { ({ lanes } = listLaneOutputs()); } catch { return null; }
  const totals = { critical: 0, important: 0, minor: 0, nit: 0 };
  const per_lane = {};
  const missing = [];
  for (const lane of lanes || []) {
    if (!lane.review_file) continue;
    const p = String(lane.review_file).replace(/\.md$/, ".json");
    let d = null;
    try { d = JSON.parse(fs.readFileSync(p, "utf8")); }
    catch { missing.push(lane.id); continue; }
    let counts = d.severity_counts;
    if (!counts && Array.isArray(d.findings)) {
      counts = {};
      for (const f of d.findings) {
        const s = f && typeof f.severity === "string" ? f.severity.toLowerCase() : null;
        if (s && _SEVERITIES.includes(s)) counts[s] = (counts[s] || 0) + 1;
      }
    }
    const norm = _normalizeCounts(counts);
    per_lane[lane.id] = norm;
    for (const k of _SEVERITIES) totals[k] += norm[k];
  }
  const found = Object.keys(per_lane).length;
  return found > 0 ? { totals, per_lane, lanes_with_sidecar: found, lanes_missing_sidecar: missing } : null;
}

// Severity counts come from review.json — the schema'd sidecar the consolidator
// already writes — never from re-parsing the rendered prose.
//
// The prose parser this replaces was a SECOND SOURCE OF TRUTH that disagreed
// with the first silently and confidently. It read {0,0,0,0} off a 91KB review
// whose own sidecar carried 3 critical / 37 important, then fired the "counts
// below lane totals — an unexplained drop is a lost finding" branch, costing a
// real investigation into 29 findings that had never gone anywhere. Tightening
// the regex was never the fix: the dispatch envelope instructs the consolidator
// to "Group findings by file for the consolidated output" while the parser
// counted severity headings, so the contract and the parser could not both be
// satisfied. A gate whose failure mode is confident wrong numbers is worse than
// no gate.
//
// `lane_declared` is the consolidator's OWN raw_lane_finding_counts. It is
// self-reported, so it catches INCONSISTENCY — the common failure — but not a
// consolidator that drops findings and under-reports the raw total to match.
// `basis` names that weakness at the call site rather than letting the gate read
// as stronger than it is; per-lane JSON sidecars are what would make this side
// machine-derived at source.
function laneSeverityTally(opts = {}) {
  const sidecar = opts.file || path.join(getStateDir(), "review.json");
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(sidecar, "utf8")); }
  catch (e) {
    // Fail CLOSED. A zero-shaped or success-shaped default here is precisely
    // the failure this rewrite exists to remove.
    return { ok: false, reason: `review sidecar unreadable or malformed: ${sidecar} (${e && e.message})`, source: sidecar };
  }
  const consolidated = _normalizeCounts(parsed.severity_counts);
  const selfReported = parsed.raw_lane_finding_counts ? _normalizeCounts(parsed.raw_lane_finding_counts) : null;
  const sidecars = _laneSidecarCounts();
  const laneDeclared = sidecars ? sidecars.totals : selfReported;
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];

  // Narrative guard: every finding the sidecar declares must be REACHABLE in the
  // rendered review by its id. This is the honest form of the check the prose
  // parser was reaching for — it asks "did the narrative lose a finding the
  // sidecar knows about", which is answerable, instead of re-deriving severities
  // the sidecar already states.
  let idsMissing = [];
  const rendered = sidecar.replace(/\.json$/, ".md");
  try {
    const body = fs.readFileSync(rendered, "utf8");
    idsMissing = findings
      .map(f => f && f.id)
      .filter(id => typeof id === "string" && id && !body.includes(id));
  } catch { idsMissing = null; } // rendered review absent — guard unavailable, not passing

  const out = {
    ok: true,
    source: sidecar,
    basis: sidecars ? "lane_sidecars" : "consolidator_self_reported_lane_totals",
    consolidated,
    lane_declared: laneDeclared,
    findings_listed: findings.length,
    ids_missing_from_review: idsMissing,
  };
  if (sidecars) {
    out.lanes_with_sidecar = sidecars.lanes_with_sidecar;
    out.lanes_missing_sidecar = sidecars.lanes_missing_sidecar;
    out.per_lane = sidecars.per_lane;
    // Cross-check: the consolidator's own lane totals against the lanes'. They
    // are independent sources, so a disagreement means one of them is wrong —
    // which is the whole reason to keep the weaker one around.
    if (selfReported) {
      out.self_reported_lane_totals = selfReported;
      const disagree = _SEVERITIES.filter(k => selfReported[k] !== sidecars.totals[k]);
      if (disagree.length > 0) {
        out.cross_check_mismatch = disagree.map(k => `${k}: lanes=${sidecars.totals[k]} vs review.json=${selfReported[k]}`).join("; ");
      }
    }
  }
  if (laneDeclared) {
    out.delta = {};
    for (const k of _SEVERITIES) out.delta[k] = consolidated[k] - laneDeclared[k];
  }
  return out;
}

function _sizingExcludePatterns() {
  const pats = SIZING_EXCLUDE_DEFAULT.slice();
  try {
    const cfg = require("./config.cjs").getMergedConfig();
    const extra = cfg && cfg.review && Array.isArray(cfg.review.size_exclude_globs) ? cfg.review.size_exclude_globs : [];
    for (const src of extra) { try { pats.push(new RegExp(src)); } catch { /* skip a bad user regex rather than throw */ } }
  } catch { /* config unavailable — defaults only */ }
  return pats;
}

// Count +/- change lines in a unified-diff body, EXCLUDING files whose path
// matches a sizing-exclude pattern. Keys each file section on its `+++ b/<path>`
// header (content lines follow it), so coverage is untouched — only the sizing
// tally drops the generated files.
function _laneSizingLines(body) {
  if (!body) return 0;
  const excl = _sizingExcludePatterns();
  const isExcl = (p) => excl.some(re => re.test(p));
  let total = 0, curExcluded = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.replace(/^\+\+\+ (b\/)?/, "").trim();
      curExcluded = p !== "/dev/null" && isExcl(p);
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("diff ") || line.startsWith("@@")) continue;
    if (curExcluded) continue;
    if (/^\+(?!\+\+)/.test(line) || /^-(?!--)/.test(line)) total++;
  }
  return total;
}


// Generates .devt/state/lane-diff-<id>.txt: merge-base diff of the lane's
// files (committed + staged + unstaged in one pass) plus /dev/null diffs for
// untracked lane files. Returns {ok, artifact, diff_lines} or {ok: false}.
function generateLaneDiff({ id, files, repoRoot, baseRef, stateDir }) {
  const { execFileSync } = require("child_process");
  const git = (argv, okCodes) => {
    try {
      return execFileSync("git", argv, { cwd: repoRoot, encoding: "utf8", timeout: 15000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) {
      // git diff --no-index exits 1 when the files differ — that's the
      // expected success path there, so callers opt specific codes in.
      if (okCodes && e.status !== undefined && okCodes.includes(e.status) && typeof e.stdout === "string") return e.stdout;
      throw e;
    }
  };
  try {
    let mergeBase = baseRef;
    try { mergeBase = git(["merge-base", baseRef, "HEAD"]).trim() || baseRef; }
    catch { /* unreachable base — two-dot against the ref itself below */ }
    let body = git(["diff", mergeBase, "--", ...files]);
    const untracked = new Set(git(["ls-files", "--others", "--exclude-standard", "--", ...files]).split("\n").map(s => s.trim()).filter(Boolean));
    for (const f of files) {
      const rel = path.isAbsolute(f) ? path.relative(repoRoot, f) : f;
      if (!untracked.has(rel) && !untracked.has(f)) continue;
      body += git(["diff", "--no-index", "--", "/dev/null", f], [1]);
    }
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const artifact = path.join(stateDir, `lane-diff-${id}.txt`);
    atomicWriteFileSync(artifact, body);
    // Diffstat basis: count only +/- change lines (not context, hunk headers,
    // or the +++/--- file headers). Raw artifact line count field-measured
    // ~25% over the true changed-line count, which breaks any comparison
    // against a real `git diff --stat`.
    const diffLines = body === "" ? 0 : (body.match(/^(\+(?!\+\+)|-(?!--))/gm) || []).length;
    const sizingLines = _laneSizingLines(body);
    return { ok: true, artifact, diff_lines: diffLines, sizing_lines: sizingLines };
  } catch {
    return { ok: false };
  }
}


// Whole-file LOC sum (trailing-newline aware) across a file set — the fallback
// sizing basis when there's no reviewable diff (empty or failed diff).
// Missing/unreadable files count as 0.
function sumWholeFileLoc(files) {
  let loc = 0;
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, "utf8");
      loc += content.length === 0 ? 0 : content.split("\n").length - 1;
    } catch { /* missing/unreadable — counts as 0 LOC */ }
  }
  return loc;
}

function registerLane({ id, scope, files, allowOverwrite, repoRoot, baseRef }) {
  if (!id || typeof id !== "string" || !/^L\d+$/.test(id)) {
    return { ok: false, reason: `invalid id "${id}" (must match /^L\\d+$/, e.g. L1, L2)` };
  }
  if (!scope || typeof scope !== "string") {
    return { ok: false, reason: "scope required (non-empty string)" };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, reason: "files required (non-empty array of paths)" };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const wfPath = path.join(dir, "workflow.yaml");
  if (!fs.existsSync(wfPath)) {
    return { ok: false, reason: "no workflow.yaml — initialize a workflow first" };
  }
  const laneRepoRoot = repoRoot ? path.resolve(repoRoot) : findProjectRoot();
  let laneBaseRef = baseRef;
  if (!laneBaseRef) {
    try {
      const cfg = require("./config.cjs").getMergedConfig();
      laneBaseRef = (cfg.git && cfg.git.primary_branch) || "main";
    } catch { laneBaseRef = "main"; }
  }
  // Lock so concurrent register-lane calls don't lose entries on the
  // read-modify-write cycle. acquireLock() defaults to getStateDir() —
  // matches updateState/resetState/syncState/pruneState's lock idiom.
  const lockFile = acquireLock();
  try {
    const state = parseSimpleYaml(fs.readFileSync(wfPath, "utf8"));
    const lanes = Array.isArray(state.lanes) ? state.lanes : [];
    const existing = lanes.findIndex(l => l && l.id === id);
    if (existing !== -1 && !allowOverwrite) {
      return { ok: false, reason: `lane id "${id}" already registered; pass --overwrite to replace` };
    }
    const slug = slugifyLaneName(scope);
    const diff = generateLaneDiff({ id, files, repoRoot: laneRepoRoot, baseRef: laneBaseRef, stateDir: dir });
    let estLoc;
    let sizeBasis;
    let sizeClass;
    if (diff.ok) {
      // Size by REVIEWABLE diff (generated/lockfile/append-only files
      // discounted), not raw diff — so a changelog-archive or lockfile bump
      // doesn't trip a spurious split. diff_lines_raw preserves the full count.
      estLoc = diff.sizing_lines != null ? diff.sizing_lines : diff.diff_lines;
      sizeBasis = "diff";
      sizeClass = estLoc >= LANE_DIFF_SPLIT_THRESHOLD ? "split"
        : estLoc >= LANE_DIFF_CHUNKED_THRESHOLD ? "chunked" : "ok";
      // An EMPTY diff over a non-empty file set is a full-content lane — an
      // explicit scope, or a blast radius whose files are the cascade rather
      // than the change. "0 LOC, ok" under-instructs a 10-18-file lane, so
      // re-size by whole-file LOC.
      //
      // Capped at "chunked" deliberately: whole-file LOC predicts READ effort,
      // so it can justify chunking, but says nothing about change volume, so it
      // must never justify a split — that conflation is what made whole-file
      // sizing useless before lanes moved to diff LOC.
      if (estLoc === 0 && files.length > 0) {
        const wholeLoc = sumWholeFileLoc(files);
        if (wholeLoc > 0) {
          estLoc = wholeLoc;
          sizeBasis = "whole_file";
          sizeClass = wholeLoc >= LANE_DIFF_CHUNKED_THRESHOLD ? "chunked" : "ok";
        }
      }
    } else {
      // No usable git context — the diff is unknown, not empty. Claiming a
      // class here would be a fake one, so the lane reports none.
      estLoc = sumWholeFileLoc(files);
      sizeBasis = "whole_file";
      sizeClass = "unknown";
    }
    const fileCount = files.length;
    const reviewFile = laneReviewPath(dir, slug);
    const registeredAt = new Date().toISOString();
    const laneEntry = {
      id,
      community: scope,
      slug,
      review_file: reviewFile,
      status: "in_flight",
      redispatch_count: 0,
      registered_at: registeredAt,
      file_count: fileCount,
      est_loc: estLoc,
      size_basis: sizeBasis,
      size_class: sizeClass,
      repo_root: laneRepoRoot,
      base_ref: laneBaseRef,
      // Correlation id stamped at REGISTRATION — fully determined here
      // (workflow_id + lane id), matching render-lanes' cid_<wfPrefix>_<id>.
      // Without it the consolidate step's cid_match!="foreign" stale-lane filter
      // can't function (the cid was null until a reviewer echoed it into the
      // review file), and callers had to hand-roll their own cid.
      correlation_id: `cid_${String(state.workflow_id || "noworkflow").split("-")[0]}_${id}`,
    };
    if (diff.ok) laneEntry.diff_artifact = diff.artifact;
    if (diff.ok && diff.diff_lines !== estLoc) laneEntry.diff_lines_raw = diff.diff_lines;
    if (existing !== -1) {
      lanes[existing] = laneEntry;
    } else {
      lanes.push(laneEntry);
    }
    state.lanes = lanes;
    atomicWriteFileSync(wfPath, serializeSimpleYaml(state));
    // Per-lane files sidecar. Atomic per-lane write. Read by render-lanes
    // (dispatch.cjs) and any future consumer that needs the file list
    // without re-parsing the orchestrator's partition input.
    const sidecarDir = path.join(dir, "lane-files");
    if (!fs.existsSync(sidecarDir)) fs.mkdirSync(sidecarDir, { recursive: true });
    atomicWriteFileSync(
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      path.join(sidecarDir, `${id}.json`),
      JSON.stringify({
        id, community: scope, files, registered_at: registeredAt,
        repo_root: laneRepoRoot, base_ref: laneBaseRef,
        size_class: sizeClass, size_basis: sizeBasis, est_loc: estLoc,
        diff_artifact: diff.ok ? diff.artifact : null,
      }, null, 2) + "\n",
    );
    return { ok: true, lane: { ...laneEntry, files } };
  } finally {
    releaseLock(lockFile);
  }
}


// Round 8 W2 — bulk-register from a YAML/JSON partition file. Format:
//   lanes:
//     - id: L1
//       scope: identity
//       files: [app/services/identity/auth.py, ...]
//     - id: L2
//       ...
// JSON shape (same key names) also accepted. Loops registerLane per entry.
function registerLanesFromYaml(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: `partition file not found: ${filePath}` };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed = null;
  // JSON-first: cheaper than the YAML branch and tolerates either format.
  try { parsed = JSON.parse(raw); } catch { /* fall through to YAML */ }
  if (!parsed) {
    // Minimal YAML parse for the lanes:[] shape. Each lane is a dash-prefixed
    // block. Reuses the existing parseSimpleYaml lanes round-trip when files
    // is absent, then falls through to a focused multi-line files parse.
    const lines = raw.split("\n");
    const lanes = [];
    let current = null;
    let inFiles = false;
    for (const line of lines) {
      if (/^\s*-\s+id:/.test(line)) {
        if (current) lanes.push(current);
        current = { files: [] };
        inFiles = false;
        const m = line.match(/id:\s*"?([^"\n]+)"?\s*$/);
        if (m) current.id = m[1].trim();
      } else if (current && /^\s+scope:/.test(line)) {
        inFiles = false;
        const m = line.match(/scope:\s*"?([^"\n]+)"?\s*$/);
        if (m) current.scope = m[1].trim();
      } else if (current && /^\s+(repo_root|base_ref):/.test(line)) {
        inFiles = false;
        const m = line.match(/(repo_root|base_ref):\s*"?([^"\n]+)"?\s*$/);
        if (m) current[m[1]] = m[2].trim();
      } else if (current && /^\s+files:\s*\[/.test(line)) {
        // Inline array form: files: [a.py, b.py]
        inFiles = false;
        const m = line.match(/files:\s*\[(.+)\]\s*$/);
        if (m) current.files = m[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
      } else if (current && /^\s+files:\s*$/.test(line)) {
        inFiles = true;
      } else if (current && inFiles && /^\s+-\s+/.test(line)) {
        current.files.push(line.replace(/^\s+-\s+/, "").trim().replace(/^"|"$/g, ""));
      } else if (/^[a-z_]/.test(line)) {
        inFiles = false;
      }
    }
    if (current) lanes.push(current);
    parsed = { lanes };
  }
  const lanes = (parsed && Array.isArray(parsed.lanes)) ? parsed.lanes : [];
  if (lanes.length === 0) {
    return { ok: false, reason: "no lanes found in partition file (expected `lanes: [...]` at top level)" };
  }
  const results = [];
  const errors = [];
  for (const entry of lanes) {
    const r = registerLane({
      id: entry.id,
      scope: entry.scope,
      files: entry.files,
      // Per-lane repo/base passthrough for cross-repo lanes (sibling
      // repository with its own diff base). Accepts both snake_case (JSON/
      // YAML convention) and camelCase.
      repoRoot: entry.repo_root || entry.repoRoot,
      baseRef: entry.base_ref || entry.baseRef,
      allowOverwrite: true, // bulk register is idempotent — re-runs replace
    });
    // review_file is surfaced because it is load-bearing and NOT derivable by
    // eye: it is slugified from the scope string and truncates mid-word, so an
    // operator writing dispatch prompts by hand cannot guess it. The batch path
    // dropped it while the single-lane path returned it, and every hand-written
    // lane then reported file_exists:false.
    results.push({ id: entry.id, community: (r.ok && r.lane && r.lane.community) || entry.scope || entry.community || null, ok: r.ok, reason: r.reason || null, review_file: r.ok && r.lane ? r.lane.review_file : null, size_class: r.ok ? r.lane.size_class : null, est_loc: r.ok ? r.lane.est_loc : null, file_count: r.ok && r.lane ? (r.lane.file_count ?? (Array.isArray(r.lane.files) ? r.lane.files.length : null)) : null });
    if (!r.ok) errors.push({ id: entry.id, reason: r.reason });
  }
  // Cross-lane disjointness check — WARN-only, never blocks. The parallel
  // review workflow assumes disjoint file slices; hand-rolled partitions can
  // double-assign a file, which costs duplicated review tokens + conflicting
  // findings at consolidation. Surfaced per [[telemetry-on-reduction]]: the
  // overlap is named, the operator decides.
  const fileOwners = new Map();
  for (const entry of lanes) {
    for (const f of (entry.files || [])) {
      if (!fileOwners.has(f)) fileOwners.set(f, []);
      fileOwners.get(f).push(entry.id);
    }
  }
  const overlaps = Array.from(fileOwners.entries())
    .filter(([, owners]) => owners.length > 1)
    .map(([file, owners]) => ({ file, lanes: owners }));
  const out = { ok: errors.length === 0, registered: results, errors };
  if (overlaps.length > 0) {
    out.overlap_warning = `${overlaps.length} file(s) assigned to multiple lanes — duplicated review tokens + conflicting findings likely; lanes are expected to be disjoint`;
    out.overlaps = overlaps.slice(0, 10);
  }

  // Coverage set-difference against the DECLARED scope universe. The auto-
  // partitioner merges overflow groups into an anchor lane, so nothing it emits
  // can drop; a hand-authored lanes.yaml had no equivalent guarantee and a field
  // partition silently omitted two files while the run reported complete
  // coverage. Only code-review-input.md answers this — the blast radius answers
  // a different question ("should this have been in scope?") and folding it in
  // here would flag dependents that were never review targets.
  const declared = _declaredScopeFiles();
  if (declared) {
    const assigned = new Set(Array.from(fileOwners.keys()).map(_normScopePath));
    const unassigned = declared.filter(f => !assigned.has(_normScopePath(f)));
    out.scope_declared = declared.length;
    out.scope_unassigned = unassigned;
    if (unassigned.length > 0) {
      out.coverage_warning = `${unassigned.length} of ${declared.length} declared file(s) are in NO lane — any consolidated claim of complete coverage would be false`;
      // Persisted so the consolidator envelope can carry the list. A warning
      // printed at partition time scrolls past twenty blocks before the
      // consolidator writes "no uncovered scope" in good faith; the envelope
      // makes that claim impossible rather than merely discouraged.
      try { atomicWriteFileSync(path.join(getStateDir(), "lane-unassigned.txt"), unassigned.join("\n") + "\n"); } catch { /* advisory */ }
    } else {
      try { fs.unlinkSync(path.join(getStateDir(), "lane-unassigned.txt")); } catch { /* absent is the normal case */ }
    }
  }
  return out;
}

function _normScopePath(p) {
  let s = String(p || "").trim().replace(/^\.\//, "");
  if (path.isAbsolute(s)) { try { s = path.relative(findProjectRoot(), s); } catch { /* keep absolute */ } }
  return s;
}

// Parses the `- <path>` bullets under the `## Files` heading of
// code-review-input.md. Returns null when the artifact is absent — the caller
// then makes no coverage claim at all, rather than reporting zero gaps from zero
// knowledge.
function _declaredScopeFiles() {
  const p = path.join(getStateDir(), "code-review-input.md");
  let body = "";
  try { body = fs.readFileSync(p, "utf8"); } catch { return null; }
  const files = [];
  let inFiles = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { inFiles = /^files\b/i.test(h[1].trim()); continue; }
    if (!inFiles) continue;
    const m = line.match(/^[-*]\s+(.+)$/);
    if (m) files.push(m[1].replace(/`/g, "").trim());
  }
  return files.length > 0 ? files : null;
}


function updateLane(laneId, kvPairs) {
  if (!laneId || typeof laneId !== "string") {
    return { ok: false, reason: "no lane-id provided" };
  }
  const updates = {};
  for (const kv of (kvPairs || [])) {
    const [k, v] = kv.split("=", 2);
    if (!k || v === undefined) continue;
    if (k === "status") {
      if (!VALID_LANE_STATUSES.has(v)) {
        return { ok: false, reason: `invalid status "${v}" (allowed: ${[...VALID_LANE_STATUSES].join(", ")})` };
      }
      updates.status = v;
    } else if (k === "redispatch_count") {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0) {
        return { ok: false, reason: `invalid redispatch_count "${v}" (must be non-negative integer)` };
      }
      updates.redispatch_count = n;
    } else if (k === "override_reason") {
      if (!v.trim()) {
        return { ok: false, reason: "override_reason must be non-empty" };
      }
      updates.override_reason = v.trim();
    } else {
      return { ok: false, reason: `unknown lane field "${k}" (allowed: status, redispatch_count, override_reason)` };
    }
  }
  if (updates.status === undefined && updates.redispatch_count === undefined) {
    return { ok: false, reason: "no updates provided (need status=... or redispatch_count=...; override_reason= only annotates one of those)" };
  }
  const dir = getStateDir();
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const wfPath = path.join(dir, "workflow.yaml");
  if (!fs.existsSync(wfPath)) {
    return { ok: false, reason: "no workflow.yaml" };
  }
  const yaml = fs.readFileSync(wfPath, "utf8");
  // Locate the lane block by id, then mutate the status/redispatch_count
  // lines in-place. Conservative line-based edit preserves YAML formatting.
  const lines = yaml.split("\n");
  let inLane = false;
  let mutated = false;
  let priorStatus = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^  - id:\s*"?/.test(line)) {
      inLane = line.includes(`"${laneId}"`) || line.replace(/^  - id:\s*"?/, "").replace(/"\s*$/, "").trim() === laneId;
    } else if (/^[a-z_]/.test(line)) {
      inLane = false;
    }
    if (!inLane) continue;
    if (updates.status !== undefined && /^\s+status:\s*/.test(line)) {
      if (priorStatus === null) priorStatus = (line.match(/status:\s*"?([^"\n]*?)"?\s*$/) || [null, null])[1];
      lines[i] = line.replace(/status:\s*"?[^"\n]*"?/, `status: "${updates.status}"`);
      mutated = true;
    }
    if (updates.redispatch_count !== undefined && /^\s+redispatch_count:\s*/.test(line)) {
      lines[i] = line.replace(/redispatch_count:\s*\d+/, `redispatch_count: ${updates.redispatch_count}`);
      mutated = true;
    }
  }
  if (!mutated) {
    return { ok: false, reason: `lane id "${laneId}" not found in workflow.yaml::lanes[]` };
  }
  atomicWriteFileSync(wfPath, lines.join("\n"));
  if (updates.override_reason) {
    // Operator overrides of lane verdicts (e.g. keeping a review the stub
    // gate false-flagged) were untraceable — the rationale lived only in
    // whatever scratchpad the operator kept. Same forensic class as
    // workflow-id-rotations.jsonl: append-only, RESET_EXEMPT.
    const { appendJsonl } = require("./logger.cjs");
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const auditPath = path.join(dir, "lane-status-overrides.jsonl");
    try {
      appendJsonl(auditPath, {
        ts: new Date().toISOString(),
        lane_id: laneId,
        prior_status: priorStatus,
        status: updates.status !== undefined ? updates.status : null,
        redispatch_count: updates.redispatch_count !== undefined ? updates.redispatch_count : null,
        override_reason: updates.override_reason,
        pid: process.pid,
      });
    } catch { /* audit-trail failure must not block the status write */ }
    return { ok: true, lane_id: laneId, updates, audit: auditPath };
  }
  return { ok: true, lane_id: laneId, updates };
}

module.exports = {
  laneSeverityTally,
  slugifyLaneName,
  listLaneOutputs,
  _sizingExcludePatterns,
  _laneSizingLines,
  generateLaneDiff,
  registerLane,
  registerLanesFromYaml,
  updateLane,
};
