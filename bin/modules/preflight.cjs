"use strict";

/**
 * Topic Pre-Flight Brief generator.
 *
 * Orchestrates Lanes A-F + Graphify blast radius for a development task,
 * producing `.devt/state/preflight-brief.md` — a single document that lists
 * every governing ADR/Concept/Flow, all relevant REJ tombstones, related
 * lessons, and (when Graphify is enabled) blast-radius analysis.
 *
 * Lanes:
 * A: Domain match — list_active(domain) per extracted domain
 * B: FTS expansion — queryFTS(terms) across the unified index
 * C: Symbol match (Graphify) — getBySymbol(sym) per subject symbol
 * D: Wiki-link closure — getLinks(id, depth=2) from initial matches
 * E: Rejected check — listRejectedKeywords() filtered to topic
 * F: Lessons filter — filters governing docs (A∪B∪C∪D) for doc_type='lesson'
 *
 * Memory Graph: a flat `{source, predicate, target}` triples view of
 * the depth-2 subgraph rooted at the governing union (A∪B∪C∪D). Rendered as a
 * dedicated section between Governing Documentation and Rejected Approaches.
 *
 * Determinism: lanes are independent and ordered; merging is by doc_id;
 * output ordering is alphabetical by id within each section. Identical
 * input on identical state produces byte-identical output (modulo the
 * timestamp footer, which is deliberately the only varying field).
 */

const fs = require("fs");
const path = require("path");
const memory = require("./memory.cjs");
const graphify = require("./graphify.cjs");
const { findProjectRoot, getMergedConfig, isMemoryEnabled } = require("./config.cjs");
const { atomicWriteFileSync, atomicWriteJsonSync } = require("./io.cjs");

const STATE_DIR = path.join(".devt", "state");
const BRIEF_FILE = "preflight-brief.md";

// Graph staleness threshold for Pre-Flight warnings — balances actionable signal
// vs noise after every minor commit.
const STALE_LAG_COMMITS = 10;

// Suggested-reading caps: keep the orchestrator's <scope_hint> payload bounded
// so a topic with many governing docs can't balloon dispatch prefix bytes.
const MAX_DIRECT_DEPS = 12;

// Tier-aware <scope_hint> cap. Field-validated against greenfield-api: a
// 61-file PR in COMPLEX-tier review was crowded out by the 8-item ceiling —
// reviewers fell back to grep. SURGICAL/TRIVIAL keep 8 (scannable Brief),
// STANDARD bumps to 15, COMPLEX/QUALITY gets 25.
const SCOPE_HINT_CAP_BY_TIER = {
  TRIVIAL: 8,
  SIMPLE: 8,
  STANDARD: 15,
  COMPLEX: 25,
};
const DEFAULT_SCOPE_HINT_CAP = 8;

// Read the current workflow's complexity tier from workflow.yaml. Returns
// undefined when no workflow is active or tier is absent — callers fall back
// to DEFAULT_SCOPE_HINT_CAP. Never throws.
function readWorkflowTier() {
  try {
    const fs = require("fs");
    const path = require("path");
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, ".devt", "state", "workflow.yaml");
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, "utf8");
        const m = content.match(/^tier:\s*"?(TRIVIAL|SIMPLE|STANDARD|COMPLEX)"?\s*$/m);
        return m ? m[1] : undefined;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fall through to default */ }
  return undefined;
}

function resolveScopeHintCap() {
  const tier = readWorkflowTier();
  if (tier && Object.prototype.hasOwnProperty.call(SCOPE_HINT_CAP_BY_TIER, tier)) {
    return SCOPE_HINT_CAP_BY_TIER[tier];
  }
  return DEFAULT_SCOPE_HINT_CAP;
}


function dedupeCap(items, cap) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

// Topic extraction — pragmatic keyword + symbol parsing. Not NLP-grade, but
// deterministic and zero-deps. The intent: pull domain hints, capitalized
// symbols (likely class names), and quoted phrases out of a free-form task.

const DOMAIN_HINTS = [
  "auth", "authentication", "authorization", "rbac", "session", "login", "logout",
  "payment", "billing", "checkout", "subscription", "invoice",
  "user", "account", "profile", "registration", "signup",
  "api", "endpoint", "route", "controller",
  "database", "migration", "schema", "query", "orm",
  "cache", "redis", "memcached",
  "ui", "frontend", "view", "component", "page",
  "test", "testing", "fixture", "mock",
  "security", "encryption", "hashing", "csrf", "xss", "ssrf",
  "logging", "metrics", "telemetry", "observability",
  "error", "exception", "validation",
  "deployment", "ci", "cd", "build", "release",
];

// Stop-words filtered out before FTS query construction
const STOP_WORDS = new Set([
  "a", "an", "and", "the", "or", "but", "to", "for", "of", "in", "on", "at",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "should", "could", "can", "may", "might",
  "i", "you", "we", "they", "it", "this", "that", "these", "those",
  "add", "fix", "update", "change", "remove", "refactor", "implement", "build",
  "make", "create", "new", "support", "feature", "task",
]);

// Symbol-extraction denylist.
// PascalCase regex catches common English words used as sentence-leading verbs/markers
// ("Add", "Fix", "Refactor" at the start of a task description). These are NOT symbols
// and pollute Lane C results. Filter them out so symbol-anchored queries stay precise.
//
// Lowercased for comparison — matches symbols regardless of original casing.
const SYMBOL_DENYLIST = new Set([
  // Action verbs commonly capitalized as task-leading words
  "add", "fix", "remove", "delete", "update", "change", "rename", "refactor",
  "implement", "build", "create", "make", "extend", "improve", "optimize",
  "support", "introduce", "migrate", "wire", "integrate", "polish",
  // Field signal (greenfield 2026-05-28 calibration #2): "Enrich relative-clients
  // picker endpoint…" returned topic.symbols=["Enrich"] — the lone noise symbol
  // also blocked the snake_case FTS fallback (gated on symbols.length === 0).
  // Extend with task-vocabulary verbs that appear PascalCase at sentence start.
  "enrich", "harvest", "normalize", "validate", "deprecate", "sunset",
  "ratify", "expose", "enable", "disable", "surface", "propagate",
  "expand", "shrink", "split", "merge", "join", "annotate", "tag", "track",
  "monitor", "observe", "log", "trace", "report",
  // Common English markers
  "before", "after", "during", "while", "when", "where", "what", "which", "who",
  "the", "this", "that", "these", "those", "some", "all", "any", "each",
  // Generic nouns that are usually NOT symbols
  "feature", "task", "bug", "issue", "todo", "fixme", "note", "review",
  // Common short labels
  "api", "ui", "cli", "db", "url", "http", "https", "json", "yaml", "xml",
  "css", "html", "sql",
  // Doc / repo / spec filenames commonly capitalized in task text
  "readme", "changelog", "license", "notice", "authors", "maintainers",
  "module", "modules", "package", "packages", "openapi", "swagger",
  "graphql", "restful", "sdk", "mvp",
  // Product / platform proper nouns — mixed-case so isAllCapsNoise misses them
  // but they appear in task titles ("PR #N (Bitbucket feature/X)") where the
  // PascalCase regex grabs them as symbols. Without this filter they crowd out
  // real code identifiers and the scan-prep gate fires on noise.
  "bitbucket", "github", "gitlab", "stripe", "notion", "linear", "slack",
  "hubspot", "salesforce", "discord", "confluence", "jira", "trello", "asana",
  "intercom", "segment", "datadog", "sentry", "pagerduty", "cloudflare",
  // Domain-prose tokens that slip through when REVIEW_SCOPE prose contains
  // PascalCase labels that LOOK like symbols but are descriptive English
  // (greenfield 2026-05-27 PR #372: "Deep notification service review" → the
  // regex extracted Deep, Notification, Service as symbols; none are graph
  // nodes; they polluted the 32-symbol blast_radius args).
  "deep", "shallow", "primary", "secondary", "tertiary",
  "service", "services", "notification", "notifications", "scope", "scopes",
  "audit", "audits", "summary", "summaries",
  "lane", "lanes", "tier", "tiers", "phase", "phases",
  // devt-internal terminology that appears in task descriptions about devt itself
  "graphify", "claudemem", "devt", "preflight",
  // Field signal (greenfield calibration #16 + #17): task-text noise tokens
  // that win the central-symbol picker by string-overlap with the task
  // description. "Batch B" scored 1.0 against task "Batch B refactor…",
  // beating real graph symbols. Single-token English words that LOOK like
  // PascalCase identifiers slip past the PascalCase regex.
  "batch", "wave", "section", "full", "skip", "semver",
]);

// Tokens of pure ALL-CAPS letters (≥4 chars, no lowercase) are usually
// project labels (CHANGELOG, MODULE), issue prefixes (GFBUGS, ENG, JIRA-NNN),
// or file/doc names — rarely code identifiers. Mixed-case PascalCase names
// like DeviceSummary, LicenseResponse, OpenAPI keep flowing through.
function isAllCapsNoise(token) {
  if (token.length < 4) return false;
  return /^[A-Z][A-Z0-9_-]*$/.test(token);
}

// File extensions whose contents we'll parse for declaration symbols. Anything
// outside this set is skipped to avoid binary reads and meaningless lockfile
// noise. Keep narrow on purpose — false positives from generated/vendored
// files would crowd out real anchor symbols.
const DIFF_SYMBOL_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".cs", ".swift",
  ".vue", ".svelte",
]);

// Pulls declaration symbols (class/function/interface/etc.) out of changed
// files in the working tree. These are higher-signal than PascalCase regex on
// task text because they're grounded in actual code touched right now —
// unblocks the `symbol_anchored` graphify tier on Bitbucket projects where
// PR-scoped diffs aren't available.
//
// Cheap by design: caps file count + per-file byte read so a large diff can't
// stall the preflight call. All git/fs failures fall through silently — the
// caller still gets a topic from the task text.
// Single-range extraction worker — pulls declaration symbols from files that
// changed in one git ref range. Caller is responsible for merging across
// multiple ranges via extractDiffSymbols().
function _symbolsFromRange(refRange, maxFiles, maxBytesPerFile) {
  // Defensive whitelist so the git ref can never escape into a shell — also
  // catches typos that would otherwise turn into a confused `git diff`.
  if (!/^[A-Za-z0-9_./~^@-]{1,100}$/.test(refRange)) return [];

  try {
    const { execFileSync } = require("child_process");
    const fs = require("fs");
    const path = require("path");

    const out = execFileSync(
      "git",
      ["diff", "--name-only", refRange],
      { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }
    );
    const files = out.split("\n").filter(Boolean).slice(0, maxFiles);

    const declRe = /(?:^|\n)\s*(?:export\s+(?:default\s+)?(?:async\s+)?)?(?:class|function|interface|type|def|trait|struct|enum|fn)\s+([A-Z][a-zA-Z0-9_]{2,})/g;

    const symbols = [];
    const seen = new Set();
    for (const rel of files) {
      const ext = path.extname(rel).toLowerCase();
      if (!DIFF_SYMBOL_EXTENSIONS.has(ext)) continue;
      try {
        const fd = fs.openSync(rel, "r");
        const buf = Buffer.alloc(maxBytesPerFile);
        const n = fs.readSync(fd, buf, 0, maxBytesPerFile, 0);
        fs.closeSync(fd);
        const content = buf.subarray(0, n).toString("utf8");
        let m;
        declRe.lastIndex = 0;
        while ((m = declRe.exec(content)) !== null) {
          const sym = m[1];
          if (SYMBOL_DENYLIST.has(sym.toLowerCase())) continue;
          if (isAllCapsNoise(sym)) continue;
          if (!seen.has(sym)) { seen.add(sym); symbols.push(sym); }
        }
      } catch { /* unreadable file → skip */ }
    }
    return symbols;
  } catch {
    return [];
  }
}

function extractDiffSymbols(opts = {}) {
  const maxFiles = Number.isFinite(opts.maxFiles) ? opts.maxFiles : 30;
  const maxBytesPerFile = Number.isFinite(opts.maxBytesPerFile) ? opts.maxBytesPerFile : 50000;

  // Explicit refRange opts.refRange short-circuits multi-range — preserves the
  // smoke-test contract where callers pin a specific ref to verify a behavior.
  if (typeof opts.refRange === "string") {
    return _symbolsFromRange(opts.refRange, maxFiles, maxBytesPerFile);
  }

  // Default: merge two ranges to cover both PR-review (committed diff vs.
  // primary branch) and in-progress work (uncommitted working tree). On a
  // feature branch with no uncommitted edits, `git diff HEAD` returns 0
  // files — the merged range catches those.
  const ranges = ["HEAD"];
  try {
    const { getMergedConfig } = require("./config.cjs");
    const cfg = getMergedConfig();
    const primary = (cfg && cfg.git && typeof cfg.git.primary_branch === "string" && cfg.git.primary_branch) || "main";
    // Three-dot syntax: symbols changed on this branch since divergence from
    // primary. This is the PR diff for typical feature-branch workflows.
    ranges.push(`${primary}...HEAD`);
  } catch { /* config unavailable → working-tree-only fallback */ }

  const seen = new Set();
  const merged = [];
  for (const range of ranges) {
    for (const sym of _symbolsFromRange(range, maxFiles, maxBytesPerFile)) {
      if (!seen.has(sym)) { seen.add(sym); merged.push(sym); }
    }
  }
  return merged;
}

/**
 * Extract topic structure from a free-form task description.
 * Returns: { domains, symbols, keywords, raw }
 *
 * `opts.gitDiffSymbols` — symbols pre-extracted from the working-tree diff.
 * When supplied (or auto-fetched by callers via `extractDiffSymbols()`), they
 * rank ABOVE PascalCase-on-text matches in the returned `symbols` array
 * because changed-file declarations are higher-signal than NLP-on-task-text.
 */
// G3 — extract a referenced plan file's contributing sections so its symbols
// reach the extractor without depending on the user redoing the work in the
// task text. Greenfield calibration #8: a task "Implement X per
// /Users/emrec/.claude/plans/foo.md" gave the extractor zero scope_hint signal
// from the plan even though the plan contained an explicit `## Files to
// change` table. Scope intentionally narrow: only `~/.claude/plans/*.md` (the
// established convention); project-local `docs/plans/*.md` deferred to a
// follow-up if anyone asks. Returns absolute paths so callers can read them.
function extractPlanReferences(taskText) {
  if (!taskText || typeof taskText !== "string") return [];
  const homeDir = require("os").homedir();
  const matches = [];
  const claudePlanRe = /(?:~|\$HOME|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/\.claude\/plans\/[\w.-]+\.md/g;
  let m;
  while ((m = claudePlanRe.exec(taskText)) !== null) {
    let raw = m[0];
    if (raw.startsWith("~")) raw = raw.replace(/^~/, homeDir);
    else if (raw.startsWith("$HOME")) raw = raw.replace(/^\$HOME/, homeDir);
    matches.push(raw);
  }
  return Array.from(new Set(matches));
}

// Pull symbols + paths out of plan sections that document the touched surface
// ("Files to change", "Scope", "Symbols"). PascalCase ≥3 chars and snake_case
// ≥3 chars with at least one underscore. Denylist-filtered like extractTopic.
// Cap at 200KB per plan to keep preflight cheap.
function extractSymbolsFromPlan(planPath) {
  const fs = require("fs");
  const MAX_BYTES = 200000;
  let body;
  try {
    const fd = fs.openSync(planPath, "r");
    const buf = Buffer.alloc(MAX_BYTES);
    const n = fs.readSync(fd, buf, 0, MAX_BYTES, 0);
    fs.closeSync(fd);
    body = buf.subarray(0, n).toString("utf8");
  } catch { return { symbols: [], paths: [] }; }
  // Split on H2 headings so we can match section titles cleanly without
  // anchoring against end-of-string (JS regex has no \Z; previous version
  // used \Z which became a literal Z and truncated sections at the first Z).
  const sectionTitleRe = /^(Files to change|Files affected|Files touched|Scope|In scope|Symbols|Symbols to touch|Touched symbols)\b/i;
  const sections = body.split(/^##\s+/m);
  let combined = "";
  for (const section of sections) {
    if (sectionTitleRe.test(section)) combined += "\n" + section;
  }
  if (!combined) return { symbols: [], paths: [] };
  const pascalSymbols = Array.from(new Set(combined.match(/\b[A-Z][a-zA-Z0-9]{2,}\b/g) || []))
    .filter(s => !SYMBOL_DENYLIST.has(s.toLowerCase()))
    .filter(s => !isAllCapsNoise(s));
  const snakeSymbols = Array.from(new Set(combined.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) || []))
    .filter(s => !SYMBOL_DENYLIST.has(s.toLowerCase()));
  const paths = Array.from(new Set(combined.match(/(?:[\w-]+\/)+[\w.-]+\.(?:py|ts|tsx|js|jsx|mjs|cjs|go|rs|java|kt|rb|php|cs|swift|vue|svelte|md|yaml|yml|json|toml|sql)\b/g) || []));
  return { symbols: [...pascalSymbols, ...snakeSymbols], paths };
}

// Unified symbol filter applied consistently to all three extraction
// channels (plan, diff, text). Plan-derived and diff-derived channels
// can drag pytest test classes via extractSymbolsFromPlan reading "Files
// to change" sections that mention test files, so filtering only the
// text channel leaks Test* identifiers through the other two.
//
// Filter rules — same across all channels:
//   - length ≥ 3 (avoid 1-2 char acronyms)
//   - not in SYMBOL_DENYLIST (PascalCase verbs, project labels, etc.)
//   - not isAllCapsNoise (CHANGELOG, GFBUGS, etc.)
//   - not /^Test[A-Z]/ (pytest test classes)
function applySymbolFilter(symbols) {
  if (!Array.isArray(symbols)) return [];
  return symbols.filter(s =>
    typeof s === "string" &&
    s.length >= 3 &&
    !SYMBOL_DENYLIST.has(s.toLowerCase()) &&
    !isAllCapsNoise(s) &&
    !/^Test[A-Z]/.test(s)
  );
}

function extractTopic(taskText, opts = {}) {
  if (!taskText || typeof taskText !== "string") {
    return { domains: [], symbols: [], keywords: [], raw: "", resolution_path: "none" };
  }
  const text = taskText.trim();
  // Strip absolute path + URL tokens before tokenization. Field signal
  // (greenfield 2026-05-29 calibration #8): a task like "...per
  // /Users/emrec/.claude/plans/foo.md" leaked `Users`, `emrec`, `claude`,
  // `plans` into keywords AND the PascalCase regex picked `Users` as a
  // symbol, crowding out the real `billing_country` signal. The raw field
  // below preserves the original text for downstream prose; only the
  // tokenization view is sanitized.
  const tokenizableText = text
    .replace(/https?:\/\/[\w./?#%&=+-]+/g, " ")
    .replace(/~\/[\w./_-]+/g, " ")
    .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, " ");
  const diffSymbols = applySymbolFilter(opts.gitDiffSymbols);
  const planSymbols = applySymbolFilter(opts.planDerivedSymbols);

  // Symbols: PascalCase identifiers ≥3 chars, deduped, denylist-filtered,
  // ALL-CAPS noise filtered. Preserves mixed-case identifiers
  // (DeviceSummary) while rejecting project labels (CHANGELOG, GFBUGS).
  const symbolMatches = tokenizableText.match(/\b[A-Z][a-zA-Z0-9]{2,}\b/g) || [];
  const textSymbols = applySymbolFilter(Array.from(new Set(symbolMatches)));
  // Diff symbols come first; text symbols only contribute their delta. Order
  // matters because downstream consumers (blast_radius args, scope_hint cap)
  // may truncate to top-N — the higher-signal source wins.
  const seen = new Set();
  const symbols = [];
  // G4-v2 (greenfield calibration #11): per-symbol provenance ledger.
  // Reviewers triaging god-node noise need to know WHY a symbol landed in
  // the topic — was it diff-anchored, plan-referenced, text-fallback, or
  // FTS-rescued? `symbolProvenance` maps symbol → source channel; surfaces
  // in preflight-brief.json::topic.symbol_provenance for downstream
  // graphify-impact-plan.json consumers.
  const symbolProvenance = {};
  // resolution_path tracks the DEEPEST fallback leg that contributed at least
  // one unique symbol. Calibrations use this to measure how often each leg
  // actually rescues a task vs. the upstream legs being sufficient on their
  // own. Priority order ascending: none(0) < diff(1) < text(2) <
  // snake_fts/kebab_fts(3) < full_text_fts(4). A leg only upgrades the
  // recorded path when it contributes — silent fallbacks stay invisible.
  let resolutionPath = "none";
  // G3: "plan" ranks alongside "diff" — both are grounded, high-trust sources
  // (diff comes from changed code, plan from a referenced design doc). Rank
  // numbers represent depth of fallback chain, NOT confidence — see
  // computeExtractionConfidence for the confidence mapping.
  const pathRank = { none: 0, plan: 1, diff: 1, text: 2, snake_fts: 3, kebab_fts: 3, full_text_fts: 4 };
  const promotePath = (next) => { if (pathRank[next] > pathRank[resolutionPath]) resolutionPath = next; };
  // Track which symbols came from the text leg so FTS rescue can demote
  // short text-leg stand-ins after producing higher-quality matches (B4).
  const textLegContributions = new Set();
  for (const s of planSymbols) {
    if (!seen.has(s)) { seen.add(s); symbols.push(s); symbolProvenance[s] = "plan"; promotePath("plan"); }
  }
  for (const s of diffSymbols) {
    if (!seen.has(s)) { seen.add(s); symbols.push(s); symbolProvenance[s] = "diff"; promotePath("diff"); }
  }
  for (const s of textSymbols) {
    if (!seen.has(s)) {
      seen.add(s);
      symbols.push(s);
      symbolProvenance[s] = "text";
      textLegContributions.add(s);
      promotePath("text");
    }
  }

  // Lowercased word stream for domain + keyword extraction. Uses the
  // path-stripped view so absolute paths don't leak segments into keywords.
  const words = (tokenizableText.toLowerCase().match(/[a-z][a-z0-9_-]{1,30}/g) || []);
  const domains = Array.from(new Set(words.filter(w => DOMAIN_HINTS.includes(w)))).sort();

  // Keywords: words ≥3 chars, not stop-words, not domains, not symbols (lowered)
  const symbolLower = new Set(symbols.map(s => s.toLowerCase()));
  const domainSet = new Set(domains);
  const keywords = Array.from(new Set(
    words.filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !domainSet.has(w) && !symbolLower.has(w))
  )).sort();

  // Service-directory fallback. Field case (greenfield GF-543): "tablet_communication
  // permission" returned 0 symbols because tablet_communication is a snake_case
  // directory name, not a PascalCase identifier. Without this fallback the
  // scan_prep cascade fails (symbols=0 → blast=skip → impact=skip → subagent blind).
  // When `opts.graphifyQuery` is injected, resolve snake_case + kebab_case
  // keywords via FTS against the live graph. The gate fires when either
  //   (a) no symbols at all survived diff+text, OR
  //   (b) every surviving symbol is ≤6 chars (likely PascalCase noise like
  //       "Enrich" that escapes the denylist but carries no useful signal).
  // Greenfield calibration #2 (GFBUGS-180): a single noise symbol that
  // survived denylist filtering blocked the rescue path entirely under the
  // legacy `symbols.length === 0` gate. Cap at 3 candidate queries — beyond
  // that the FTS pass starts polluting scope_hint with weak matches.
  const SNAKE = /^[a-z][a-z0-9]+(_[a-z0-9]+)+$/;
  const KEBAB = /^[a-z][a-z0-9]+(-[a-z0-9]+)+$/;
  const graphifyQuery = typeof opts.graphifyQuery === "function" ? opts.graphifyQuery : null;
  const allShortSymbols = symbols.length > 0 && symbols.every(s => s.length <= 6);
  if ((symbols.length === 0 || allShortSymbols) && graphifyQuery) {
    const candidates = Array.from(new Set(
      words.filter(w => (SNAKE.test(w) || KEBAB.test(w)) && !STOP_WORDS.has(w))
    )).slice(0, 3);
    for (const cand of candidates) {
      let r;
      try { r = graphifyQuery(cand, { limit: 2 }); } catch { continue; }
      if (!r || !Array.isArray(r.results)) continue;
      const candPath = SNAKE.test(cand) ? "snake_fts" : "kebab_fts";
      for (const node of r.results) {
        const label = (node && (node.label || node.id)) || null;
        if (!label) continue;
        if (!seen.has(label) && !SYMBOL_DENYLIST.has(label.toLowerCase()) && !isAllCapsNoise(label)) {
          seen.add(label);
          symbols.push(label);
          symbolProvenance[label] = candPath;
          promotePath(candPath);
        }
      }
    }
  }

  // Terminal fallback. Field case (greenfield calibration #2): tasks dominated
  // by domain nouns ("license", "subscription", "picker") carry no PascalCase,
  // no snake_case, no kebab_case keywords — the keyword FTS legs above all
  // miss. Run one FTS pass on the full task text so the graph itself decides
  // which nouns resolve. Cap merge at 5 — beyond that we're polluting
  // scope_hint with weak matches that the keyword legs would have caught if
  // they were strong signal.
  if (symbols.length === 0 && graphifyQuery) {
    let r;
    try { r = graphifyQuery(text, { limit: 5 }); } catch { r = null; }
    if (r && Array.isArray(r.results)) {
      for (const node of r.results.slice(0, 5)) {
        const label = (node && (node.label || node.id)) || null;
        if (!label) continue;
        if (!seen.has(label) && !SYMBOL_DENYLIST.has(label.toLowerCase()) && !isAllCapsNoise(label)) {
          seen.add(label);
          symbols.push(label);
          symbolProvenance[label] = "full_text_fts";
          promotePath("full_text_fts");
        }
      }
    }
  }

  // B4 — when FTS rescue produced real symbols, drop the short text-leg
  // stand-ins that triggered the rescue gate. Field signal (greenfield
  // 2026-05-29 calibration #8): a task containing `VAT` (3 chars) +
  // path-leaked `Users` (5 chars) "succeeded" at the text leg with two
  // junk symbols, polluting downstream blast_radius args even when FTS
  // resolved the real snake_case identifier. Demotion only applies to
  // text-leg contributions that are ≤6 chars (the same threshold that
  // gates FTS rescue) so diff-derived symbols and longer text symbols
  // are preserved.
  if (
    textLegContributions.size > 0 &&
    (resolutionPath === "snake_fts" || resolutionPath === "kebab_fts" || resolutionPath === "full_text_fts")
  ) {
    for (let i = symbols.length - 1; i >= 0; i--) {
      if (textLegContributions.has(symbols[i]) && symbols[i].length <= 6) {
        symbols.splice(i, 1);
      }
    }
  }

  return { domains, symbols, keywords, raw: text, resolution_path: resolutionPath, symbol_provenance: symbolProvenance };
}

/**
 * Defensive coercion — memory.cjs `withDb` helper returns `{ error }` when no
 * index exists. Normalize that to an empty array so lane code stays simple.
 */
function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function dedupSortById(docs) {
  const map = new Map();
  for (const d of docs) if (d && d.id && !map.has(d.id)) map.set(d.id, d);
  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Lane A — domain match. For each extracted domain, pull active docs.
 */
function laneA(topic) {
  const out = [];
  for (const domain of topic.domains) {
    try { out.push(...asArray(memory.listActive(domain))); } catch { /* empty */ }
  }
  return dedupSortById(out);
}

/**
 * Lane B — FTS expansion. Combines domain words + symbols (lowercased) +
 * a bounded slice of keywords. Caps at 12 tokens to keep FTS query tight.
 */
function laneB(topic, limit = 30) {
  const tokens = [
    ...topic.domains,
    ...topic.symbols.map(s => s.toLowerCase()),
    ...topic.keywords.slice(0, 8),
  ].slice(0, 12);
  if (tokens.length === 0) return [];
  let results;
  try { results = asArray(memory.queryFTS(tokens.join(" "), { limit })); }
  catch { results = []; }
  return results;
}

/**
 * Lane C — symbol match. Requires Graphify-enabled OR the doc's
 * affects_symbols already populated (path-only deployments still get this lane,
 * just without AST validation).
 */
function laneC(topic) {
  const out = [];
  for (const sym of topic.symbols) {
    try { out.push(...asArray(memory.getBySymbol(sym))); } catch { /* empty */ }
  }
  return dedupSortById(out);
}

/**
 * Lane D — wiki-link transitive closure (depth 2) from the union of
 * lanes A+B+C. Only returns docs NOT already in the seed set.
 */
function laneD(seedDocs, depth = 2) {
  const seedIds = new Set(seedDocs.map(d => d.id));
  const expanded = new Map();
  for (const seed of seedDocs) {
    let linked;
    try { linked = asArray(memory.getLinks(seed.id, depth)); } catch { linked = []; }
    for (const l of linked) {
      // getLinks may return either flat doc rows or {target_id} rows; handle both.
      const id = l.id || l.target_id;
      if (!id || seedIds.has(id) || expanded.has(id)) continue;
      // Resolve to full doc if we only have an id reference
      let doc = l.title ? l : null;
      if (!doc) { try { doc = memory.getDoc(id); } catch { doc = null; } }
      if (doc) expanded.set(id, doc);
    }
  }
  return Array.from(expanded.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Lane E — rejected check. Pull all REJ tombstones and filter to those whose
 * search_keywords overlap with the topic's keyword/domain/symbol set.
 */
function laneE(topic) {
  let all;
  try { all = asArray(memory.listRejectedKeywords()); } catch { all = []; }
  if (all.length === 0) return [];
  const haystack = new Set([
    ...topic.domains,
    ...topic.keywords,
    ...topic.symbols.map(s => s.toLowerCase()),
  ]);
  const matchedById = new Map();
  for (const row of all) {
    const kw = (row.keyword || "").toLowerCase();
    if (!kw) continue;
    // Two match modes: direct word overlap OR substring against raw task text
    const hit = haystack.has(kw)
      || kw.split(/\s+/).some(t => haystack.has(t))
      || (topic.raw && topic.raw.toLowerCase().includes(kw));
    if (hit && !matchedById.has(row.id)) {
      matchedById.set(row.id, { id: row.id, title: row.title, summary: row.summary, keyword: row.keyword });
    }
  }
  return Array.from(matchedById.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Lane F — pulls lesson-typed entries out of the deduped governing union so the
 * Brief can render them under a dedicated header. Caller must pass an already-
 * deduped array; the architectural rationale lives in docs/MEMORY.md.
 *
 * @param {Array<{id: string, doc_type: string}>} dedupedUnion
 */
function laneF(dedupedUnion, limit = 8) {
  return dedupedUnion.filter(d => d && d.doc_type === "lesson").slice(0, limit);
}

/**
 * Compute blast radius via Graphify when available; emit degraded payload otherwise.
 */
function blastRadius(topic) {
  if (topic.symbols.length === 0) {
    return { effect_size: null, source: "skipped", reason: "no symbols extracted from task" };
  }
  return graphify.blastRadius(topic.symbols);
}

/**
 * Render the markdown Brief from lane outputs.
 */
function renderBrief({ task, topic, lanes, governing, triples, blast, report, generatedAt, suggestedReading }) {
  const lines = [];
  lines.push(`# Pre-Flight Brief: ${task || "(unspecified task)"}`);
  lines.push("");
  lines.push("## Status: FRESH");
  lines.push("");

  // Memory FTS5 index missing → governance lanes A/B/D/F return empty even
  // when ADR/CON/FLOW/REJ/LES docs exist on disk. The signal is invisible to
  // a reader who doesn't know the database had to be built. Surface it
  // explicitly at the top so the next action ("run `/devt:memory init`") is
  // unambiguous.
  try {
    const dbPath = path.join(findProjectRoot(), ".devt", "memory", "index.db");
    if (!fs.existsSync(dbPath)) {
      lines.push("> ⚠️ **Memory index not built** — governing-doc lanes (A/B/D/F) will be empty even if `.devt/memory/{decisions,concepts,flows,rejected,lessons}/` contain docs. Run `node bin/devt-tools.cjs memory init` then re-run preflight to enable ADR/CON/FLOW/REJ/LES discovery.");
      lines.push("");
    }
  } catch { /* findProjectRoot may throw in tests — skip the check */ }

  lines.push("## Topic Extracted");
  lines.push(`- **Domains:** ${topic.domains.length ? topic.domains.join(", ") : "_(none)_"}`);
  lines.push(`- **Symbols:** ${topic.symbols.length ? topic.symbols.join(", ") : "_(none)_"}`);
  lines.push(`- **Keywords:** ${topic.keywords.length ? topic.keywords.slice(0, 12).join(", ") : "_(none)_"}`);
  lines.push("");

  // Caller passes the deduped union directly. Defensive fallback for tests
  // that build `lanes` without pre-deduping — keeps renderer self-sufficient.
  if (!governing) {
    governing = dedupSortById([...lanes.A, ...lanes.B, ...lanes.C, ...lanes.D]);
  }

  // Per-doc lane attribution: A wins on tie, then B, C, D. Build once (O(n))
  // instead of running 3 Array.find probes per governing doc.
  const laneOf = new Map();
  for (const [letter, arr] of [["A", lanes.A], ["B", lanes.B], ["C", lanes.C], ["D", lanes.D]]) {
    for (const d of arr) if (d && d.id && !laneOf.has(d.id)) laneOf.set(d.id, letter);
  }

  lines.push("## Governing Documentation (depth-2 transitive closure)");
  if (governing.length === 0) {
    lines.push("_No active ADR/Concept/Flow docs match this topic._");
  } else {
    for (const d of governing) {
      const lane = laneOf.get(d.id) || "D";
      lines.push(`- [${d.id}] ${d.title || "(untitled)"} — ${d.summary || ""} _(lane ${lane})_`);
    }
  }
  lines.push("");

  // Memory Graph subgraph. Renders the depth-2 link
  // closure rooted at the governing union as flat triples — agents can scan
  // structural relationships (supersedes/depends_on/relates_to/etc.) without
  // running individual get_doc calls per neighbor.
  lines.push("## Memory Graph (2-hop subgraph)");
  if (!Array.isArray(triples) || triples.length === 0) {
    lines.push("_No outgoing links from governing docs — flat docset for this topic._");
  } else {
    for (const t of triples) {
      lines.push(`- ${t.source} → ${t.predicate} → ${t.target}`);
    }
  }
  lines.push("");

  lines.push("## Rejected Approaches (REJ tombstones)");
  if (lanes.E.length === 0) {
    lines.push("_No matching REJ tombstones — no prior NOs in this topic area._");
  } else {
    for (const r of lanes.E) {
      lines.push(`- [${r.id}] ${r.title} — matched on keyword \`${r.keyword}\``);
      if (r.summary) lines.push(`  > ${r.summary}`);
    }
  }
  lines.push("");

  lines.push("## Related Operational Lessons");
  if (lanes.F.length === 0) {
    lines.push("_No related lessons indexed for this topic._");
  } else {
    for (const l of lanes.F.slice(0, 8)) {
      const id = l.id || "LES-?";
      const text = l.title || l.summary || "";
      lines.push(`- [${id}] ${text}`);
    }
  }
  lines.push("");

  lines.push("## Blast Radius");
  if (blast.source === "skipped") {
    lines.push(`_${blast.reason || "skipped"}_`);
  } else if (blast.source === "grep") {
    lines.push("_Graphify disabled or unavailable — blast radius computed from path heuristics only._");
    if (blast.reason) lines.push(`_${blast.reason}_`);
  } else {
    lines.push(`- **Effect size:** ${blast.effect_size || "unknown"}`);
    lines.push(`- **Direct dependents:** ${(blast.direct_dependents || []).length}`);
    lines.push(`- **Indirect dependents (depth 2):** ${(blast.indirect_dependents || []).length}`);
    lines.push(`- **Modules touched:** ${blast.modules_touched || 0}`);
    if (blast.god_node_match) lines.push("- ⚠️ **God-node match** — review GRAPH_REPORT.md before proceeding");
    if (blast.ambiguous_bindings && blast.ambiguous_bindings > 0) {
      lines.push(`- ⚠️ **AMBIGUOUS bindings:** ${blast.ambiguous_bindings} (review needed)`);
    }
    try {
      const f = graphify.freshness();
      const stale = f.state === "ready" && !f.fresh;
      if (stale && typeof f.lag_commits === "number" && f.lag_commits >= STALE_LAG_COMMITS) {
        lines.push(`- ⚠️ **Graph cache is stale** — ${f.lag_commits} commits behind HEAD. Run \`graphify update .\` (or \`graphify hook install\` once for auto-refresh on commit). Numbers above may reflect old code.`);
      } else if (stale && f.built_at && f.head && f.lag_commits === null) {
        // Shallow clone: built_at != head but rev-list count unavailable.
        lines.push(`- ⚠️ **Graph cache may be stale** — built at ${f.built_at.slice(0,7)}, HEAD is ${f.head.slice(0,7)}. Run \`graphify update .\`.`);
      }
    } catch { /* freshness probe is advisory; never fail the Brief */ }
  }
  lines.push("");

  // Suggested Reading Set — paths derived from governing docs' affects_paths
  // and blast-radius direct_dependents. Consumed by workflows via the JSON
  // sidecar's `suggested_reading` field for <scope_hint> dispatch injection.
  if (Array.isArray(suggestedReading) && suggestedReading.length > 0) {
    lines.push("## Suggested Reading Set (auto-derived)");
    for (const p of suggestedReading) {
      lines.push(`- ${p}`);
    }
    lines.push("");
  }

  // Cross-Cutting Concerns — surfaces god-nodes / surprising-connections /
  // knowledge-gaps from graphify-out/GRAPH_REPORT.md that overlap the topic.
  // Omitted entirely when no overlap or when graphify hasn't produced a report.
  if (report && (report.god_nodes.length || report.surprising_connections.length || report.knowledge_gaps_summary)) {
    const topicTokens = new Set([
      ...topic.symbols.map(s => s.toLowerCase()),
      ...topic.domains.map(d => d.toLowerCase()),
    ]);
    const tokenMatches = (str) => {
      if (!str || !topicTokens.size) return false;
      const lower = str.toLowerCase();
      for (const t of topicTokens) {
        if (t.length >= 3 && lower.includes(t)) return true;
      }
      return false;
    };

    // B5 — when blast.god_node_match is true, the topic touched a god-node even
    // if the textual symbol comparison missed (e.g. CamelCase vs snake_case
    // tokenization differences). Surface the top god-node so the operational
    // guidance below (>=50 edges) fires. Field case: ClientService was a
    // god_node_match but tokenMatches() rejected it.
    let matchedGods = report.god_nodes.filter(g => tokenMatches(g.symbol)).slice(0, 5);
    if (matchedGods.length === 0 && blast && blast.god_node_match && report.god_nodes.length > 0) {
      matchedGods = report.god_nodes.slice(0, 1);
    }
    const matchedConns = report.surprising_connections
      .filter(c => tokenMatches(c.from) || tokenMatches(c.to))
      .slice(0, 5);

    if (matchedGods.length || matchedConns.length) {
      lines.push("## Cross-Cutting Concerns (graphify)");
      if (matchedGods.length) {
        lines.push("**God-nodes touching this topic (high coupling — scope changes carefully):**");
        for (const g of matchedGods) {
          // Operational guidance — distinguish raw edge count from behavior the
          // agent should adopt. Field audit (greenfield GF-543) showed agents
          // ignored bare edge counts but modified signatures of 100+ edge nodes
          // anyway. Reifying the implication makes the guidance load-bearing.
          const guidance = g.edge_count >= 50
            ? " — prefer adding new methods over modifying signatures; any signature change ripples to all callers"
            : "";
          lines.push(`- \`${g.symbol}\` — ${g.edge_count} edges${guidance}`);
        }
      }
      if (matchedConns.length) {
        if (matchedGods.length) lines.push("");
        lines.push("**Surprising connections involving this topic:**");
        for (const c of matchedConns) {
          lines.push(`- \`${c.from}\` --${c.relation}--> \`${c.to}\`  [${c.confidence}]`);
        }
      }
      lines.push("");
    }
  }

  lines.push("## Pre-Flight Recommendations");
  const recs = synthesizeRecommendations(governing, lanes.E, blast);
  if (recs.length === 0) {
    lines.push("- No specific guardrails detected; proceed with normal review discipline.");
  } else {
    for (const r of recs) lines.push(`- ${r}`);
  }
  lines.push("");

  lines.push("---");
  lines.push(`Generated ${generatedAt} by /devt:preflight`);
  lines.push("");
  return lines.join("\n");
}

function synthesizeRecommendations(governing, rejected, blast) {
  const recs = [];
  if (governing.length > 0) {
    const ids = governing.slice(0, 5).map(d => d.id).join(", ");
    recs.push(`Re-read ${ids} before any change — they constrain this topic area.`);
  }
  if (rejected.length > 0) {
    const ids = rejected.map(r => r.id).join(", ");
    recs.push(`${ids} govern: any solution involving the matched keywords is pre-rejected. Read these tombstones before proposing.`);
  }
  if (blast && blast.effect_size === "large") {
    recs.push("Effect size is LARGE — coordinate via /devt:plan, not /devt:fast. Plan thorough test coverage for the dependent set.");
  } else if (blast && blast.effect_size === "medium") {
    recs.push("Effect size is MEDIUM — STANDARD-tier review recommended; identify and test direct dependents.");
  }
  if (blast && blast.god_node_match) {
    recs.push("Subject matches a god-node entry — high coupling. Consider whether the change can be scoped narrower.");
  }
  if (blast && blast.ambiguous_bindings && blast.ambiguous_bindings > 0) {
    recs.push("Graphify reports AMBIGUOUS symbol bindings — manually verify the affected docs before edits.");
  }
  return recs;
}

// Tier detection for the Memory-Graph lane budget. Keywords classify first
// (explicit signal beats length); length-based bands are conservative fallbacks
// so most tasks land in "standard" unless they're clearly trivial or complex.
// `preflight.max_triples` in config overrides tier resolution entirely.
function detectTier(taskText) {
  if (!taskText || typeof taskText !== "string") return "standard";
  const t = taskText.toLowerCase();
  if (/\b(refactor|architecture|migration|cross-cutting|rewrite)\b/.test(t)) return "complex";
  if (/\b(small fix|tweak|adjust|patch|hotfix)\b/.test(t)) return "simple";
  if (/\b(typo|rename|one-line|trivial|whitespace)\b/.test(t)) return "trivial";
  if (taskText.length < 40) return "trivial";
  if (taskText.length >= 500) return "complex";
  return "standard";
}

function resolveTripleBudget(taskText, cfg, opts) {
  // Precedence: explicit CLI override → config max_triples → tier-based budget → 50
  if (opts && opts.budget != null) return opts.budget;
  const pre = cfg && cfg.preflight;
  if (pre && pre.max_triples != null) return pre.max_triples;
  const tier = detectTier(taskText);
  return (pre && pre.lane_budget && pre.lane_budget[tier]) || 50;
}

// Deterministic 0.0–1.0 score for how much we trust the extracted symbols.
// Greenfield calibration #8 surfaced the gap: the structural side of preflight
// (lag, decision artifact, threshold) was fully observable, but the semantic
// side (do symbols actually match the task's subject?) was invisible. Without
// a numeric handle, orchestrators couldn't degrade scope_hint when extraction
// produced noise; with one, downstream gates can warn and v0.69 R3/R4 can
// fold it into adaptive-threshold decisions.
//
// Scoring tiers:
//   1.0  diff symbols present — grounded in actual code touched
//   0.8  FTS rescue fired — graph matched a snake/kebab keyword
//   0.6  text symbols with ≥1 long token (>6 chars) — likely meaningful
//   0.3  text symbols, all ≤6 chars — likely acronym/path-leak stand-ins
//   0.0  no symbols at all
// Overlap bonus: +0.2 capped at 1.0 when any symbol token (CamelCase split)
// appears in keywords. Catches the case where short symbols are real but
// happen to be the canonical term (e.g. "VAT" alongside "vat_rate" keyword).
function computeExtractionConfidence(topic) {
  if (!topic || !Array.isArray(topic.symbols) || topic.symbols.length === 0) {
    return { score: 0.0, band: "none", reason: "no symbols extracted" };
  }
  const path = topic.resolution_path;
  let base, band, reason;
  if (path === "diff") {
    base = 1.0; band = "high"; reason = "diff-derived symbols (grounded in touched code)";
  } else if (path === "plan") {
    base = 1.0; band = "high"; reason = "plan-referenced symbols (grounded in design doc)";
  } else if (path === "snake_fts" || path === "kebab_fts" || path === "full_text_fts") {
    base = 0.8; band = "high"; reason = `FTS rescue (${path}) matched graph nodes`;
  } else {
    const anyLong = topic.symbols.some(s => typeof s === "string" && s.length > 6);
    if (anyLong) { base = 0.6; band = "medium"; reason = "text-leg symbols with ≥1 long token"; }
    else { base = 0.3; band = "low"; reason = "text-leg symbols all ≤6 chars (likely stand-ins)"; }
  }
  // Overlap bonus: do any symbol tokens overlap with keywords? Split CamelCase
  // so "BillingCountry" → ["billing","country"] can match keyword "billing_country".
  const keywordSet = new Set((topic.keywords || []).map(k => String(k).toLowerCase()));
  let overlap = false;
  for (const sym of topic.symbols) {
    const tokens = String(sym).split(/(?=[A-Z])|[_-]/).filter(t => t.length >= 3).map(t => t.toLowerCase());
    if (tokens.some(t => keywordSet.has(t) || [...keywordSet].some(k => k.includes(t)))) {
      overlap = true;
      break;
    }
  }
  let score = base;
  if (overlap) {
    score = Math.min(1.0, base + 0.2);
    if (band === "low") band = "medium";
  }
  return { score: Number(score.toFixed(2)), band, reason: overlap ? `${reason}; symbol↔keyword overlap detected` : reason };
}

/**
 * Generate the Brief end-to-end and write it to .devt/state/preflight-brief.md.
 * Returns { brief_path, topic, counts, blast }.
 */
function generate(taskText, opts) {
  opts = opts || {};

  // Master switch — when memory.enabled=false, no Brief is generated.
  // Returns a disabled envelope so callers can branch cleanly without crashing.
  const cfg = getMergedConfig();
  if (!isMemoryEnabled(cfg)) {
    return {
      state: "disabled",
      reason: "memory.enabled=false in .devt/config.json",
      brief_path: null,
      topic: null,
      counts: { lane_a: 0, lane_b: 0, lane_c: 0, lane_d: 0, lane_e: 0, lane_f: 0, governing: 0, triples: 0 },
      blast: { effect_size: 0, source: null, god_node_match: false, ambiguous_bindings: 0 },
      generated_at: null,
    };
  }

  // Higher-signal source: declaration symbols pulled from changed files in
  // the working tree. Falls back to empty array when not in a git repo or
  // when nothing has changed — extractTopic still produces text-derived
  // symbols in that case.
  const diffSymbols = extractDiffSymbols();
  // G3 — load any plan files referenced in taskText (e.g.
  // `~/.claude/plans/foo.md`) and lift their `## Files to change` /
  // `## Scope` / `## Symbols` sections into the extractor's symbol channel.
  // High-trust signal: equivalent priority to diff-derived symbols.
  let planSymbols = [];
  try {
    for (const planPath of extractPlanReferences(taskText)) {
      const extracted = extractSymbolsFromPlan(planPath);
      if (extracted && Array.isArray(extracted.symbols)) {
        for (const s of extracted.symbols) planSymbols.push(s);
      }
    }
    planSymbols = Array.from(new Set(planSymbols));
  } catch { /* plan extraction is best-effort */ }
  const topic = extractTopic(taskText, {
    gitDiffSymbols: diffSymbols,
    planDerivedSymbols: planSymbols,
    graphifyQuery: (text, qOpts) => graphify.queryGraph(text, qOpts),
  });

  // v0.73 WI-4 (greenfield cal #18 assessment #2): extend v0.71 M1 graph-
  // existence filter from just-the-central-symbol to ALL topic.symbols.
  // Without this, downstream blast_radius wastes cycles on phantom symbols
  // and the dispatch envelope shows misleading "topic.symbols=[A,B,C]" when
  // only one of them actually exists in graphify. When graphify is ready,
  // keep only symbols whose getNode returns a real graph node; surface
  // dropped non-existent symbols as topic.symbols_dropped_no_graph_node so
  // downstream agents (and cal #19 observability) can see what was filtered.
  // Falls through to legacy (no filtering) when graphify unavailable —
  // identical degradation pattern to M1 in pickCentralSymbol.
  let symbolsDroppedNoGraphNode = [];
  try {
    const graphStatus = graphify.status();
    if (graphStatus && graphStatus.state === "ready" && Array.isArray(topic.symbols) && topic.symbols.length > 0) {
      const kept = [];
      for (const sym of topic.symbols) {
        if (typeof sym !== "string" || sym.length === 0) continue;
        try {
          const res = graphify.getNode(sym);
          if (res && Array.isArray(res.results) && res.results.length > 0) {
            kept.push(sym);
          } else {
            symbolsDroppedNoGraphNode.push(sym);
          }
        } catch { /* per-symbol getNode error — keep symbol (defensive) */ kept.push(sym); }
      }
      topic.symbols = kept;
    }
  } catch { /* graphify unavailable — leave topic.symbols intact (legacy) */ }

  // Run lanes
  const A = laneA(topic);
  const B = laneB(topic);
  const C = laneC(topic);
  const D = laneD(dedupSortById([...A, ...B, ...C]), opts.depth || 2);
  const E = laneE(topic);
  // Hoist the deduped union once: laneF filters it for lessons, renderBrief reuses
  // it for the governing docs section. Avoids two separate dedupSortById passes.
  const governingUnion = dedupSortById([...A, ...B, ...C, ...D]);
  const F = laneF(governingUnion);

  // Blast radius
  const blast = blastRadius(topic);

  // Parse GRAPH_REPORT.md once for surprising connections + knowledge gaps.
  // Empty sections when graphify is not ready or the report is missing —
  // the renderer omits the block.
  const report = graphify.parseReportSections();
  // Overlay live god-nodes from graph.json adjacency. Post-`graphify update`
  // rebuilds without `cluster-only` don't rewrite GRAPH_REPORT.md, so the
  // text-scraped god_nodes field can lag the actual graph; godNodes() reads
  // the live loader cache.
  const liveGods = graphify.godNodes(50);
  if (liveGods.length > 0) report.god_nodes = liveGods;

  // Memory Graph triples — depth-2 subgraph rooted at governing union.
  // Cheap to compute since getLinks already does the heavy lifting; the helper
  // just reshapes per-seed results into flat triples and dedupes across seeds.
  // Budget resolves from cfg.preflight (config) → tier heuristic over taskText
  // → default 50. Trivial tasks get a smaller subgraph; complex tasks get more.
  let triples = [];
  try {
    const budget = resolveTripleBudget(taskText, cfg, opts);
    triples = memory.getSubgraphTriples(governingUnion.map(d => d.id), opts.depth || 2, budget);
  } catch { /* memory layer not initialized — empty triples is the correct degradation */ }

  // Aggregate task-relevant code paths for the orchestrator's <scope_hint>
  // injection: governing docs' affects_paths (frontmatter-declared) plus
  // blast-radius direct_dependents (depth-1 incoming). Capped at
  // MAX_SUGGESTED_READING so the Brief stays scannable and the hint inflates
  // dispatch prefixes by at most a few hundred bytes.
  let affectsPaths = [];
  try {
    affectsPaths = memory.getAffectsPathsByIds(governingUnion.map(d => d.id));
  } catch { /* memory layer not initialized — empty list is correct */ }
  // B2 — when the topic central symbol is itself a god-node, blast.direct_dependents
  // is the god-node's general neighborhood (often 200+ entries unrelated to the task).
  // Suppressing direct_dependents avoids poisoning scope_hint with structurally
  // adjacent but task-irrelevant paths. Field case (greenfield 2026-05-26):
  // ClientService god-node match produced scope_hint filled with
  // OrganizationCreatedEvent etc. that had zero overlap with the actual task scope.
  const directDeps = blast.god_node_match
    ? []
    : (blast.direct_dependents || []).slice(0, MAX_DIRECT_DEPS);

  // Graphify wiki output (when the project ran `graphify <path> --wiki`) is the
  // agent-crawlable curated navigation surface. When present, prepend it to the
  // suggested reading so agents land on the wiki entry point before raw source.
  // Hidden behind existsSync — projects that never built a wiki see no change.
  const wikiPaths = [];
  try {
    const wikiIndex = path.join(findProjectRoot(), "graphify-out", "wiki", "index.md");
    if (fs.existsSync(wikiIndex)) wikiPaths.push("graphify-out/wiki/index.md");
  } catch { /* findProjectRoot may throw — skip */ }

  const suggestedReading = dedupeCap([...wikiPaths, ...affectsPaths, ...directDeps], resolveScopeHintCap());

  const lanes = { A, B, C, D, E, F };
  const generatedAt = new Date().toISOString();
  const brief = renderBrief({ task: taskText, topic, lanes, governing: governingUnion, triples, blast, report, generatedAt, suggestedReading });

  // Write atomically to .devt/state/preflight-brief.md
  const root = findProjectRoot();
  const stateDir = path.join(root, STATE_DIR);
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  const dest = path.join(stateDir, BRIEF_FILE);
  atomicWriteFileSync(dest, brief);

  // Emit JSON sidecar for deterministic orchestrator consumption. The .md is
  // the human-readable surface; .json is the machine interface workflows read
  // via jq for scope_hint injection without parsing markdown.
  const sidecarDest = path.join(stateDir, BRIEF_FILE.replace(/\.md$/, ".json"));
  // graph_stats + staleness give agents trust + freshness signals so they can
  // de-weight scope_hint / blast-radius when the underlying graph is sparse
  // (graphify not done indexing) or stale (built_at >> N commits behind HEAD).
  // Cheap — graph_stats reuses the Phase A loader cache; freshness reads ~8KB
  // of graph.json + 1 git call. Both surface state="not_ready" gracefully when
  // graphify is disabled or graph.json is absent.
  let graphStats, staleness;
  try { graphStats = graphify.graphStats(); }
  catch { graphStats = { state: "not_ready", trust: "empty" }; }
  try { staleness = graphify.freshness(); }
  catch { staleness = { state: "not_ready", fresh: false, built_at: null, head: null, lag_commits: null }; }

  let memoryIndexMissing = false;
  try {
    memoryIndexMissing = !fs.existsSync(path.join(findProjectRoot(), ".devt", "memory", "index.db"));
  } catch { memoryIndexMissing = false; }

  // Top-N god-nodes for downstream consumers. graphify.godNodes() may have been
  // called above when overlaying report.god_nodes; re-resolve here so the sidecar
  // surfaces structured data even when the markdown brief omits god-node prose
  // (e.g., topic doesn't textually match any god-node). Subagent dispatch
  // templates inject this list as operational guidance — "X is a god-node with
  // N edges; signature changes ripple to N sites". Cap at 3 — beyond that the
  // signal/noise ratio in agent prompts degrades.
  let topGods = [];
  try { topGods = (graphify.godNodes(3) || []).slice(0, 3); } catch { /* empty */ }

  // Option A (greenfield calibration #11): hyperedge intersection lookup.
  // For every hyperedge whose members include any of topic.symbols (or
  // diff-file basenames), record the match + which members are in/out of
  // scope. Surfaces in sidecar so /devt:ship completeness gate can warn
  // when a PR touches some-but-not-all members of a semantic grouping.
  let hyperedgesMatched = [];
  try {
    const hyperResult = graphify.getHyperedgesContaining(topic.symbols, { limit: 10 });
    if (hyperResult && Array.isArray(hyperResult.results)) {
      hyperedgesMatched = hyperResult.results;
    }
  } catch { /* hyperedge lookup is best-effort */ }
  // DEF-052 (greenfield calibration #16): when hyperedges_matched is empty AND
  // the locally-installed graphify skill drifts from the binary version, surface
  // the version mismatch as a reason in the sidecar. Workflows that consume
  // hyperedges_matched can flag "no hyperedges due to skill 0.7.10 vs binary 0.8.24
  // drift" instead of silently treating empty as "no semantic groupings found".
  let hyperedgesSuppressedReason = null;
  if (!hyperedgesMatched || hyperedgesMatched.length === 0) {
    try {
      const drift = graphify.detectSkillVersionDrift();
      if (drift.detected) {
        hyperedgesSuppressedReason = `graphify skill ${drift.skill_version} drift from binary ${drift.binary_version}; hyperedges may be silently empty — run 'graphify install' to refresh`;
      }
    } catch { /* drift detection is best-effort */ }
  }

  // WI-6b / M4 (greenfield calibration #17 §F4): label-collision detection.
  // For each topic.symbol, check whether MORE THAN ONE node in the graph shares
  // its label. When count > 1, surface the collision in blast.collisions[]
  // so downstream agents see ALL distinct definitions rather than the single
  // arbitrarily-resolved one (greenfield's update_license_rights × 2 case).
  // Empty array when no collisions OR graphify unavailable — fail-open.
  const symbolCollisions = [];
  try {
    if (Array.isArray(topic.symbols)) {
      for (const sym of topic.symbols) {
        const result = graphify.getSymbolCollisions(sym);
        if (result && result.count > 1) {
          symbolCollisions.push({
            symbol: sym,
            count: result.count,
            bindings: result.collisions,
          });
        }
      }
    }
  } catch { /* collision detection is best-effort */ }

  // WI-4 / Q2 (greenfield cal #17 §F2): caller_count_via_grep cross-check.
  // For each top topic.symbol (cap at 5 to bound cost), run git grep for the
  // literal seed pattern + "(" — the canonical callsite shape. Compare with
  // graphify's direct_dependents_count: when graphify's count is ≥ Nx the
  // grep count (default 3x), emit a magnification advisory in the brief.
  // Field evidence: greenfield's update_license_rights reported 33 modules
  // via BFS-in depth 2 (interface transitive reach), grep showed 1 literal
  // caller — 33x magnification. The advisory lets downstream agents calibrate.
  // Strong N4 alignment: delegates to git grep + graphify rather than
  // reimplementing caller-counting; pure coordination wrapper around two
  // existing tools.
  let callerCountGrep = null;
  let magnificationAdvisory = null;
  try {
    const topSyms = Array.isArray(topic.symbols) ? topic.symbols.slice(0, 5) : [];
    if (topSyms.length > 0) {
      const { execFileSync } = require("child_process");
      let totalGrepCount = 0;
      let probedSymbols = 0;
      for (const sym of topSyms) {
        if (typeof sym !== "string" || sym.length === 0 || sym.length > 256) continue;
        try {
          // -F treats pattern as literal (no regex interpretation of identifiers).
          // -c counts matching lines per file; we sum across files. -- separator
          // prevents flag parsing on identifiers like dotted names.
          const out = execFileSync("git", ["grep", "-c", "-F", "--", sym + "("], {
            encoding: "utf8",
            timeout: 2000,
            stdio: ["ignore", "pipe", "ignore"],
          });
          for (const line of out.split("\n")) {
            const colon = line.lastIndexOf(":");
            if (colon < 0) continue;
            const n = parseInt(line.slice(colon + 1), 10);
            if (Number.isFinite(n)) totalGrepCount += n;
          }
          probedSymbols += 1;
        } catch { /* git unavailable / no matches → contribute 0 */ }
      }
      if (probedSymbols > 0) {
        callerCountGrep = totalGrepCount;
        const cfg = getMergedConfig();
        const threshold = (cfg && cfg.graphify && cfg.graphify.blast_magnification_threshold !== undefined)
          ? cfg.graphify.blast_magnification_threshold
          : 3;
        const bfsCount = (blast.direct_dependents || []).length;
        if (threshold !== null && totalGrepCount > 0 && bfsCount >= totalGrepCount * threshold) {
          const ratio = (bfsCount / totalGrepCount).toFixed(1);
          magnificationAdvisory = `direct_dependents_count=${bfsCount} is ${ratio}× the literal git-grep caller count (${totalGrepCount} across ${probedSymbols} probed symbols, threshold ${threshold}×). BFS-in depth-2 likely amplified through interface/contract edges. Treat blast scope as upper-bound; cross-check critical decisions against the grep count.`;
        }
      }
    }
  } catch { /* Q2 cross-check is best-effort */ }

  const extractionConfidence = computeExtractionConfidence(topic);
  // scope_hint confidence is a placeholder — without observed dispatch
  // hit-rate against suggested_reading paths we'd be guessing thresholds.
  // V0.69 R3 will fold real signal here once G4's confidence data accrues.
  const scopeHintConfidence = suggestedReading.length === 0
    ? { score: 0.0, band: "none", reason: "no suggested_reading entries" }
    : { score: 1.0, band: "high", reason: "placeholder pending v0.69 R3 calibration" };
  const topicWithConfidence = {
    ...topic,
    extraction_confidence: extractionConfidence,
    // v0.73 WI-4: surface symbols that were extracted but had no matching
    // graphify node (when graphify was ready). Empty array when graphify
    // disabled OR all extracted symbols were graph-anchored.
    symbols_dropped_no_graph_node: symbolsDroppedNoGraphNode,
  };
  atomicWriteJsonSync(sidecarDest, {
    status: "FRESH",
    topic: topicWithConfidence,
    governing_ids: governingUnion.map(d => d.id),
    suggested_reading: suggestedReading,
    scope_hint: { confidence: scopeHintConfidence },
    hyperedges_matched: hyperedgesMatched,
    hyperedges_suppressed_reason: hyperedgesSuppressedReason,
    blast: {
      effect_size: blast.effect_size,
      source: blast.source,
      direct_dependents_count: (blast.direct_dependents || []).length,
      // HF-3 (greenfield calibration #7): god_node_match + ambiguous_bindings
      // were emitted in the function's returned envelope but stripped on
      // persist. Downstream consumers — workflows/code-review.md::substep_3's
      // jq extraction for <god_node_warnings> + future ambiguous_bindings
      // surfacing — read .blast.god_node_match from the persisted JSON and
      // got null, then fell back to false. Code-reviewer's severity-elevation
      // path keys on the boolean, so god-nodes silently under-elevated in
      // every dispatch. Persist both fields explicitly so the cached state
      // matches the function's in-memory return.
      god_node_match: !!blast.god_node_match,
      ambiguous_bindings: blast.ambiguous_bindings || 0,
      // C7-3+C7-6 (greenfield calibration #7): the ambiguous_bindings COUNT
      // was visible but the colliding symbols + their source_files were not.
      // Greenfield's session had two ExternalCallService modules (external_calls
      // Nettie vs external_calling Vicasa legacy); reviewers had to manually
      // cross-check every finding against both modules. Persist the full
      // details list so workflows can surface them in <god_node_warnings> +
      // graph-impact.md without re-running blast_radius.
      ambiguous_details: Array.isArray(blast.ambiguous_details) ? blast.ambiguous_details : [],
      // WI-6b / M4 (greenfield calibration #17 §F4): label-collision detection.
      // For each topic.symbol whose label has > 1 matching node, surface every
      // distinct binding so downstream agents see all definitions, not just
      // the one arbitrarily resolved by _resolveOne's Map-iteration order.
      // Empty array when no collisions OR graphify unavailable.
      collisions: symbolCollisions,
      // WI-4 / Q2 (greenfield cal #17 §F2): grep-derived caller count
      // cross-check for the top topic.symbols. When BFS-derived count is
      // >= threshold × grep count, magnification_advisory flags potential
      // interface-edge amplification (e.g., 33 vs 1 case).
      caller_count_grep: callerCountGrep,
      magnification_advisory: magnificationAdvisory,
    },
    graph_stats: graphStats,
    staleness,
    god_nodes: topGods,
    memory_index_missing: memoryIndexMissing,
    rej_keyword_matches: lanes.E.map(r => r.keyword).filter(Boolean),
    generated_at: generatedAt,
  });

  return {
    brief_path: dest,
    sidecar_path: sidecarDest,
    topic,
    counts: {
      lane_a: A.length, lane_b: B.length, lane_c: C.length,
      lane_d: D.length, lane_e: E.length, lane_f: F.length,
      governing: governingUnion.length,
      triples: triples.length,
      suggested_reading: suggestedReading.length,
    },
    blast: {
      effect_size: blast.effect_size,
      source: blast.source,
      god_node_match: !!blast.god_node_match,
      ambiguous_bindings: blast.ambiguous_bindings || 0,
    },
    generated_at: generatedAt,
  };
}

/**
 * Mark an existing brief STALE (typically when File Pre-Flight discovers
 * an unanchored file mid-task). Idempotent — no-op if no brief exists.
 */
function markStale(reason) {
  const root = findProjectRoot();
  const dest = path.join(root, STATE_DIR, BRIEF_FILE);
  if (!fs.existsSync(dest)) return { ok: false, reason: "no brief exists" };
  let body;
  try { body = fs.readFileSync(dest, "utf8"); } catch (e) { return { ok: false, reason: e.message }; }
  if (/^## Status:\s*STALE/m.test(body)) return { ok: true, already_stale: true };
  const updated = body.replace(/^## Status:\s*FRESH.*$/m, `## Status: STALE\n\n_Reason:_ ${reason || "scope expanded mid-task"}`);
  atomicWriteFileSync(dest, updated);
  return { ok: true, marked_stale_at: new Date().toISOString() };
}

/**
 * Read the current Brief metadata (status, generated_at). Returns null if absent.
 */
function readBriefMeta() {
  const root = findProjectRoot();
  const dest = path.join(root, STATE_DIR, BRIEF_FILE);
  if (!fs.existsSync(dest)) return null;
  let body;
  try { body = fs.readFileSync(dest, "utf8"); } catch { return null; }
  const status = (body.match(/^## Status:\s*(\w+)/m) || [, "MISSING"])[1];
  const generatedAt = (body.match(/Generated\s+([0-9T:.\-Z]+)/) || [, null])[1];
  const titleMatch = body.match(/^# Pre-Flight Brief:\s*(.+)$/m);
  return {
    path: dest,
    status,
    generated_at: generatedAt,
    task: titleMatch ? titleMatch[1] : null,
  };
}

// B1 — pick the central symbol from a topic.symbols list that best matches the
// task description text. Field rationale (greenfield 2026-05-26): the prior
// bash logic `jq -r '.[0]'` picked the alphabetically-first symbol regardless
// of task relevance (chose `AuditMapping` for a task about clients/relatives).
// Strategy: tokenize each symbol (CamelCase + snake_case + _underscores) into
// lowercase 3-char-plus tokens, score by what fraction appear in task text.
// Highest score wins; ties broken by original order; falls back to first symbol
// when no symbol scores above zero.
function pickCentralSymbol(symbols, taskText) {
  if (!Array.isArray(symbols) || symbols.length === 0) return null;

  // M1 (greenfield calibration #16 + #17): filter candidates by graph existence
  // BEFORE token-overlap scoring. Without this filter the picker can return a
  // task-text noise word ("Batch") that scores 1.0 against the task description
  // even though it has no graph node — downstream blast_radius then runs against
  // a fictional symbol and returns degraded results. When graphify is unavailable
  // (not setup, disabled, or graph degraded), fall through to legacy scoring on
  // raw symbols so projects without graphify behave as before. Gate via the
  // exported graphify.status() so we distinguish "graph not loaded" from
  // "graph loaded but symbol absent" — both look like source:"grep" through
  // getNode but only the former should trigger legacy fallback.
  //
  // M2 (greenfield 2026-06-05 calibration): god-node de-ranking. Without this
  // filter the picker promotes high-degree framework keywords like FastAPI's
  // `Depends` (888 edges) over task-specific function names — downstream
  // blast_radius then explodes across the whole codebase. Read god_nodes from
  // GRAPH_REPORT.md and exclude symbols whose edge_count exceeds the threshold.
  let graphValidSymbols = [];
  let graphAvailable = false;
  let godNodeSymbols = new Set();
  try {
    const graphify = require("./graphify.cjs");
    const graphStatus = graphify.status();
    if (graphStatus && graphStatus.state === "ready") {
      graphAvailable = true;
      try {
        const sections = graphify.parseReportSections();
        if (sections && Array.isArray(sections.god_nodes)) {
          for (const g of sections.god_nodes) {
            if (g && typeof g.symbol === "string") godNodeSymbols.add(g.symbol);
          }
        }
      } catch { /* parseReportSections failure — proceed without god-node filter */ }
      for (const sym of symbols) {
        if (godNodeSymbols.has(sym)) continue;  // M2: skip god-nodes
        const result = graphify.getNode(sym);
        if (result && Array.isArray(result.results) && result.results.length > 0) {
          graphValidSymbols.push(sym);
        }
      }
    }
  } catch { /* graphify module load failed — keep graphAvailable=false */ }

  // Choose candidate set:
  // - Graph available + valid candidates → score those (the M1 fix)
  // - Graph available + zero valid candidates → return null (no real symbol exists;
  //   callers' bash fallback to symbols[0] is the documented degraded behavior)
  // - Graph not available → score raw symbols (legacy, projects without graphify)
  const candidates = graphAvailable
    ? (graphValidSymbols.length > 0 ? graphValidSymbols : null)
    : symbols;
  if (candidates === null) return null;

  // M3 (greenfield 2026-06-07 calibration): diff-recency weighting. M2
  // de-ranked god nodes but the surviving candidates were token-overlap-noisy
  // — DebounceService got picked over _check_calendar_feature_gate for a
  // license-gate PR because token overlap matched debounce.py test files in
  // the topic.symbols list. Solution: count how many times each candidate
  // appears in the working-tree git diff and add a weight to its score.
  // Symbols that ARE the diff's primary subject (mentioned many times) win
  // even when their tokens don't match the task description vocabulary.
  const diffCounts = _diffSymbolCounts(candidates);

  const task = (taskText || "").toLowerCase();
  const tokenize = (sym) => sym
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 3);
  let best = { sym: candidates[0], score: 0, idx: -1 };
  candidates.forEach((sym, i) => {
    const tokens = tokenize(sym);
    let tokenScore = 0;
    if (task && tokens.length > 0) {
      const hits = tokens.filter(t => task.includes(t)).length;
      tokenScore = hits / tokens.length;
    }
    // Diff weight: each mention adds 0.2, capped at 2.0 (= 10 mentions). A
    // single mention barely nudges; a symbol mentioned 5+ times dominates
    // any token-overlap noise from unrelated test/debounce files.
    const diffCount = diffCounts.get(sym) || 0;
    const diffWeight = Math.min(diffCount * 0.2, 2.0);
    const finalScore = tokenScore + diffWeight;
    if (finalScore > best.score) best = { sym, score: finalScore, idx: i };
  });
  return best.score > 0 ? best.sym : candidates[0];
}

// _diffSymbolCounts (M3 helper) — counts occurrences of each candidate
// symbol in the working-tree + staged git diff. Returns Map<symbol, count>;
// empty Map when git is unavailable, not in a repo, or diff is empty.
// Bounded to ~256 KB of diff output to keep runtime predictable on large
// PRs. Uses word-boundary matching to avoid counting `Foo` inside `FooBar`.
function _diffSymbolCounts(candidates) {
  const counts = new Map();
  if (!Array.isArray(candidates) || candidates.length === 0) return counts;
  try {
    const { execSync } = require("child_process");
    // Combine working-tree + staged diffs (HEAD). On a clean checkout this
    // returns empty; in mid-PR state it shows the in-flight changes.
    const diff = execSync("git diff HEAD --unified=0 2>/dev/null", {
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout: 2000,
    });
    if (!diff || typeof diff !== "string") return counts;
    for (const sym of candidates) {
      if (typeof sym !== "string" || sym.length < 3) continue;
      // Escape regex special chars; symbols are typically identifiers so
      // unlikely to contain them, but defensive.
      const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "g");
      const matches = diff.match(re);
      if (matches && matches.length > 0) counts.set(sym, matches.length);
    }
  } catch { /* git unavailable / not a repo / diff failed — keep counts empty */ }
  return counts;
}

function run(subcommand, args) {
  const json = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
  switch (subcommand) {
    case "generate": {
      const budgetArg = args.find(a => a.startsWith("--budget="));
      const task = args.filter(a => !a.startsWith("--")).join(" ").trim();
      if (!task) { process.stderr.write("Usage: preflight generate <task description> [--budget=N]\n"); return 2; }
      const opts = {};
      if (budgetArg) {
        const n = parseInt(budgetArg.split("=")[1], 10);
        if (Number.isFinite(n) && n > 0) opts.budget = n;
      }
      json(generate(task, opts));
      return 0;
    }
    case "topic": {
      const task = args.join(" ").trim();
      json(extractTopic(task));
      return 0;
    }
    case "status": {
      const meta = readBriefMeta();
      json(meta || { status: "MISSING" });
      return 0;
    }
    case "mark-stale": {
      const reason = args.join(" ").trim();
      json(markStale(reason));
      return 0;
    }
    case "pick-central-symbol": {
      // Usage: preflight pick-central-symbol <symbols-json> <task-text>
      if (args.length < 2) {
        process.stderr.write("Usage: preflight pick-central-symbol <symbols-json> <task-text>\n");
        return 2;
      }
      let symbols;
      try { symbols = JSON.parse(args[0]); }
      catch (e) { process.stderr.write(`Invalid symbols JSON: ${e.message}\n`); return 2; }
      const task = args.slice(1).join(" ");
      const picked = pickCentralSymbol(symbols, task);
      // Plain string output — easier for bash to consume than JSON
      process.stdout.write((picked || "") + "\n");
      return 0;
    }
    case "scope-cache": {
      // Consolidates the SCOPE_HINT + SCOPE_TRUST + staleness-override bash
      // chain (4 jq calls + 2 CLI calls + conditional) into one Node call.
      // Reads .devt/state/preflight-brief.json, computes scope_hint +
      // scope_trust, applies mechanical staleness override when graphify
      // state=ready AND lag exceeds threshold (or is null), writes
      // staleness-suppressed.txt when the override fires, persists both JSON
      // blobs to workflow.yaml. Returns the cached values + suppress reason.
      json(scopeCache());
      return 0;
    }
    default:
      process.stderr.write(
        `Unknown preflight subcommand: ${subcommand}\n` +
        `Valid: generate | topic | status | mark-stale | pick-central-symbol | scope-cache\n`
      );
      return 2;
  }
}

function scopeCache() {
  let root;
  try { root = findProjectRoot(); }
  catch (e) { return { ok: false, error: `findProjectRoot: ${e.message}`, scope_hint: [], scope_trust: {} }; }

  const briefPath = path.join(root, ".devt", "state", "preflight-brief.json");
  if (!fs.existsSync(briefPath)) {
    return { ok: false, error: "no preflight-brief.json", scope_hint: [], scope_trust: {} };
  }
  let brief;
  try { brief = JSON.parse(fs.readFileSync(briefPath, "utf8")); }
  catch (e) { return { ok: false, error: `parse preflight-brief.json: ${e.message}`, scope_hint: [], scope_trust: {} }; }

  const scope_hint = Array.isArray(brief.suggested_reading) ? brief.suggested_reading : [];
  const scope_trust = {
    trust: (brief.graph_stats && brief.graph_stats.trust) || "empty",
    lag_commits: brief.staleness ? brief.staleness.lag_commits : null,
    fresh: !!(brief.staleness && brief.staleness.fresh),
  };

  // Mechanical staleness override — match the bash semantics exactly:
  // force scope_trust.trust='sparse' when graph_stats.state=ready AND
  // (lag_commits is null OR exceeds the configured threshold).
  const graphifyState = (brief.graph_stats && brief.graph_stats.state) || "not_ready";
  const cfg = getMergedConfig();
  const threshold = (cfg && cfg.graphify && cfg.graphify.stale_threshold !== undefined)
    ? cfg.graphify.stale_threshold
    : 30;
  let suppress_reason = null;
  if (graphifyState === "ready") {
    const lag = scope_trust.lag_commits;
    if (lag === null || lag === undefined) {
      suppress_reason = "lag_commits=null, state=ready (unreachable SHA / shallow clone)";
    } else if (Number.isFinite(lag) && lag > threshold) {
      suppress_reason = `lag_commits=${lag} > stale_threshold=${threshold}`;
    }
  }
  if (suppress_reason) {
    scope_trust.trust = "sparse";
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const suppressPath = path.join(root, ".devt", "state", "staleness-suppressed.txt");
    atomicWriteFileSync(suppressPath, `${ts} — ${suppress_reason}\n`);
  }

  // Persist to workflow.yaml via the state module's key=value update path.
  const state = require("./state.cjs");
  try {
    state.run("update", [
      `scope_hint_json=${JSON.stringify(scope_hint)}`,
      `scope_trust_json=${JSON.stringify(scope_trust)}`,
    ]);
  } catch (e) {
    return {
      ok: false,
      error: `state update: ${e.message}`,
      scope_hint, scope_trust, suppress_reason,
    };
  }

  return { ok: true, scope_hint, scope_trust, suppress_reason, threshold };
}

module.exports = {
  run,
  generate,
  scopeCache,
  pickCentralSymbol,
  extractTopic,
  computeExtractionConfidence,
  extractPlanReferences,
  extractSymbolsFromPlan,
  extractDiffSymbols,
  resolveScopeHintCap,
  SCOPE_HINT_CAP_BY_TIER,
  readBriefMeta,
  markStale,
  // Lanes exported for testing
  laneA, laneB, laneC, laneD, laneE, laneF,
  // Tier budget — exported for smoke-test gates and CLI override paths
  detectTier, resolveTripleBudget,
};
