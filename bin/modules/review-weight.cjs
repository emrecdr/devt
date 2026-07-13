"use strict";

/**
 * review-weight — assess whether a review can safely run "light" (skip the
 * heavyweight graph drill-down machinery) or must run "heavy".
 *
 * Design (from a field receipt): the decision is FAIL-SAFE — light must be
 * EARNED by proving the absence of danger, never granted by a single noisy
 * metric. The hard gates are `god_node_match == false` and "no risk-surface
 * path in the diff"; `effect_size` is only a corroborating term, never a sole
 * gate (it is popularity-derived and noisy). A change the graph can't speak to
 * (blast unavailable / tier=skip) is NOT auto-eligible — absence of a headline
 * is not evidence of safety.
 *
 * This module computes the PATH-based signals itself (logic-file count, domain
 * count, risk-surface hits — all from the diff, no graph). The graph-derived
 * terms (`effect_size`, `god_node_match`, `tier`) are supplied by the caller
 * that already computed the blast headline, so this stays graph-decoupled and
 * never touches MCP (orchestrator owns MCP; sub-agents/CLIs are MCP-blind).
 *
 * STAYS GENERIC: the default patterns are framework-general (they apply to a
 * Spring / Django / .NET / Rails / Express layout equally). Every heuristic is
 * overridable in `.devt/config.json::review.*`. No project-specific paths.
 */

const { execFileSync } = require("child_process");

// Framework-general risk surfaces: touching one means "review this carefully,
// regardless of size." Matched case-insensitively against the posix path.
// A change here forces heavy — it is a hard gate, not a size heuristic.
const DEFAULT_RISK_SURFACE_PATTERNS = [
  // Security boundary: authn/authz, access control, crypto, secrets, redaction.
  "(^|/)(auth|authn|authz|rbac|permission|permissions|acl|security|crypto|cipher|secret|secrets|redact|redaction|sanitize|sanitizer|oauth|session|login|password|passwords)(/|_|-|\\.|$)",
  // Data contract: schema + migrations (a shape change ripples to every consumer).
  "(^|/)(migration|migrations|alembic|schema|schemas)(/|$)",
  "\\.(sql|proto)$",
  // Core / shared primitives + event bus + error bases (broad blast by nature).
  "(^|/)(core|common|shared|kernel|infra|infrastructure)(/|$)",
  "(^|/)(event_bus|eventbus)(/|_|\\.|$)",
  "(^|/)(errors?|exceptions?)\\.(py|ts|js|jsx|tsx|go|java|rb|cs)$",
];

// Non-logic files: excluded from logic-file count, domain count, and risk
// matching. A diff dominated by these (a lockfile bump + a VERSION line) has
// near-zero review risk regardless of file count.
const DEFAULT_LOGIC_EXCLUDES = [
  "(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|poetry\\.lock|Cargo\\.lock|go\\.sum|uv\\.lock|Gemfile\\.lock|composer\\.lock)$",
  "(^|/)requirements[\\w.-]*\\.txt$",
  "(^|/)VERSION$",
  "\\.(md|markdown|rst)$",
  "(^|/)CHANGELOG",
];

// Merge config extension list with a default list, honoring "!pattern" removal
// (mirrors graphify.framework_builtin_noise convention). Returns compiled
// RegExp[]. Invalid patterns are skipped (they can't silently match nothing).
function _compilePatterns(defaults, extra) {
  const removals = new Set();
  const additions = [];
  for (const e of Array.isArray(extra) ? extra : []) {
    if (typeof e !== "string" || !e.trim()) continue;
    if (e.startsWith("!")) removals.add(e.slice(1));
    else additions.push(e);
  }
  const raw = defaults.filter(d => !removals.has(d)).concat(additions);
  const compiled = [];
  for (const r of raw) {
    try { compiled.push(new RegExp(r, "i")); } catch { /* skip invalid pattern */ }
  }
  return compiled;
}

/**
 * collectChangedFiles — union of committed-range diff + uncommitted working-tree
 * changes + untracked files. The one file-collection semantic every scope-
 * sensitive consumer needs: an uncommitted tree has an EMPTY base...HEAD diff,
 * and gating that only sees the committed range goes blind exactly when the
 * review scope lives in the working tree.
 */
function collectChangedFiles(projectRoot, baseRef) {
  const collect = (argv) => execFileSync("git", argv, { cwd: projectRoot, encoding: "utf8", timeout: 10000 })
    .split("\n").map(s => s.trim()).filter(Boolean);
  const union = new Set();
  try { for (const f of collect(["diff", "--name-only", `${baseRef}...HEAD`])) union.add(f); } catch { /* base unreachable — working-tree passes below still apply */ }
  for (const f of collect(["diff", "--name-only", "HEAD"])) union.add(f);
  for (const f of collect(["ls-files", "--others", "--exclude-standard"])) union.add(f);
  return Array.from(union);
}

function _reviewConfig() {
  try {
    const { getMergedConfig } = require("./config.cjs");
    const cfg = getMergedConfig();
    return (cfg && cfg.review) || {};
  } catch { return {}; }
}

// Domain = the first `depth` path segments of a logic file (default 2). A coarse
// grouping — "how many distinct areas does this touch." One AND-term among
// several; the hard gates carry the weight, so coarseness here is acceptable.
function _domainOf(file, depth) {
  const segs = file.split("/").filter(Boolean);
  if (segs.length <= 1) return segs[0] || file;
  return segs.slice(0, Math.max(1, depth)).join("/");
}

/**
 * assessReviewWeight — returns the review-weight verdict.
 *
 * opts:
 *   projectRoot   — repo root (defaults to config.findProjectRoot()).
 *   baseRef       — diff base (defaults to config git.primary_branch or "main").
 *   files         — pre-supplied diff file list (skips git when provided; used
 *                   by tests and callers that already have the list).
 *   effectSize    — "small" | "medium" | "large" | null (from the blast headline).
 *   godNodeMatch  — boolean | null (from the blast headline).
 *   tier          — impact-plan tier ("symbol_anchored" | "pr_scoped" | "skip" | ...).
 *
 * Returns { eligible, blocked_by[], recommendation, logic_files, logic_file_count,
 *           domains, domain_count, risk_surface_hits[], effect_size, god_node_match,
 *           tier, graph_blind, thresholds, note }.
 */
function assessReviewWeight(opts = {}) {
  const cfg = _reviewConfig();
  const riskPatterns = _compilePatterns(DEFAULT_RISK_SURFACE_PATTERNS, cfg.risk_surface_patterns);
  const excludePatterns = _compilePatterns(DEFAULT_LOGIC_EXCLUDES, cfg.logic_file_excludes);
  const maxLogic = Number.isInteger(cfg.lite_max_logic_files) && cfg.lite_max_logic_files >= 0 ? cfg.lite_max_logic_files : 5;
  const maxDomains = Number.isInteger(cfg.lite_max_domains) && cfg.lite_max_domains >= 0 ? cfg.lite_max_domains : 2;
  const domainDepth = Number.isInteger(cfg.domain_depth) && cfg.domain_depth > 0 ? cfg.domain_depth : 2;

  // Resolve the changed-file list.
  let files = Array.isArray(opts.files) ? opts.files.slice() : null;
  let filesReadable = files !== null;
  if (files === null) {
    try {
      const { findProjectRoot, getMergedConfig } = require("./config.cjs");
      const proot = opts.projectRoot || findProjectRoot();
      let base = opts.baseRef;
      if (!base) {
        const gc = getMergedConfig();
        base = (gc && gc.git && gc.git.primary_branch) || "main";
      }
      files = collectChangedFiles(proot, base);
      filesReadable = true;
    } catch {
      files = [];
      filesReadable = false;
    }
  }

  const isExcluded = (f) => excludePatterns.some(re => re.test(f));
  const logicFiles = files.filter(f => !isExcluded(f));
  const domains = Array.from(new Set(logicFiles.map(f => _domainOf(f, domainDepth))));
  const riskHits = [];
  for (const f of logicFiles) {
    const hit = riskPatterns.find(re => re.test(f));
    if (hit) riskHits.push({ file: f, pattern: hit.source });
  }

  const effectSize = opts.effectSize !== undefined ? opts.effectSize : null;
  const godNodeMatch = opts.godNodeMatch !== undefined ? opts.godNodeMatch : null;
  const tier = opts.tier !== undefined ? opts.tier : null;
  // Graph-blind: no trustworthy blast headline (tier didn't resolve to a graph
  // tier, or god-node/effect_size weren't supplied). Fail-safe → not eligible.
  const graphTiers = new Set(["symbol_anchored", "pr_scoped"]);
  const graphBlind = !(graphTiers.has(tier) && (godNodeMatch === true || godNodeMatch === false));

  const blocked = [];
  if (!filesReadable) blocked.push("diff unreadable (no base ref / no git) — cannot prove scope");
  // Zero resolved files is NOT a safe diff — it means file detection failed
  // (or there is nothing to review). Without this, the count gates pass
  // vacuously and an invisible diff could earn LIGHT.
  if (filesReadable && files.length === 0) blocked.push("empty diff — no changed files resolvable (committed range + working tree + untracked all empty); nothing to prove safe");
  if (graphBlind) blocked.push("graph-blind (blast headline unavailable or tier not graph-anchored) — safety not provable");
  if (godNodeMatch === true) blocked.push("god_node_match: a diff symbol is a high-blast-radius hub");
  if (riskHits.length > 0) blocked.push(`risk-surface path(s): ${riskHits.slice(0, 5).map(h => h.file).join(", ")}${riskHits.length > 5 ? ` (+${riskHits.length - 5})` : ""}`);
  if (logicFiles.length > maxLogic) blocked.push(`logic files ${logicFiles.length} > ${maxLogic}`);
  if (domains.length > maxDomains) blocked.push(`domains ${domains.length} > ${maxDomains}`);
  // effect_size is popularity-derived and noisy — a corroborating signal only,
  // NEVER a blocker (the hard gates above carry the safety weight; a junk
  // anchor can inflate effect_size to large on a two-file change). Non-small
  // values surface as advisories so the operator sees the corroboration state.
  const advisories = [];
  if (effectSize && effectSize !== "small") advisories.push(`effect_size: ${effectSize} — corroborating signal only, not blocking`);

  const eligible = blocked.length === 0;
  return {
    eligible,
    recommendation: eligible ? "light" : "heavy",
    blocked_by: blocked,
    advisories,
    logic_files: logicFiles,
    logic_file_count: logicFiles.length,
    domains,
    domain_count: domains.length,
    risk_surface_hits: riskHits,
    effect_size: effectSize,
    god_node_match: godNodeMatch,
    tier,
    graph_blind: graphBlind,
    thresholds: { lite_max_logic_files: maxLogic, lite_max_domains: maxDomains, domain_depth: domainDepth },
    // v1 limitation, stated honestly: risk detection is path-based, so a
    // non-additive public-API or schema change hidden in an unremarkable file
    // is caught only when its path matches a risk pattern. Semantic-diff
    // detection is deferred; a human `--full` override is the backstop.
    note: "risk-surface detection is path-based (v1); a non-additive contract change in an unremarkable path may not be flagged — use --full when in doubt.",
  };
}

function _parseFlag(args, name) {
  const pfx = `--${name}=`;
  const a = args.find(x => x.startsWith(pfx));
  return a ? a.slice(pfx.length) : undefined;
}

function run(subcommand, args) {
  args = args || [];
  const USAGE = "Usage: review-weight assess [--base=<ref>] [--files=<csv>] [--effect-size=<s>] [--god-node=<true|false>] [--tier=<t>]\n";
  if (subcommand !== "assess") {
    process.stderr.write(USAGE);
    return 2;
  }
  // Strict flags: an unrecognized flag errors instead of silently no-oping.
  // A silently-ignored flag on an advisory that builds an auto-light track
  // record poisons the record (field receipt: a misspelled flag read as a
  // legitimately-absent signal).
  const ALLOWED_FLAGS = new Set(["base", "files", "effect-size", "god-node", "tier"]);
  for (const a of args) {
    if (a.startsWith("--")) {
      const name = a.slice(2).split("=")[0];
      if (!ALLOWED_FLAGS.has(name)) {
        process.stderr.write(`unknown flag: --${name}\n` + USAGE);
        return 2;
      }
    }
  }
  const godRaw = _parseFlag(args, "god-node");
  const filesRaw = _parseFlag(args, "files");
  const verdict = assessReviewWeight({
    baseRef: _parseFlag(args, "base"),
    files: filesRaw === undefined ? undefined : filesRaw.split(",").map(s => s.trim()).filter(Boolean),
    effectSize: _parseFlag(args, "effect-size"),
    godNodeMatch: godRaw === undefined ? undefined : (godRaw === "true" ? true : godRaw === "false" ? false : undefined),
    tier: _parseFlag(args, "tier"),
  });
  process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  return 0;
}

module.exports = { run, assessReviewWeight, collectChangedFiles, DEFAULT_RISK_SURFACE_PATTERNS, DEFAULT_LOGIC_EXCLUDES };
