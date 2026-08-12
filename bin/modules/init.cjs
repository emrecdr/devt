"use strict";

/**
 * Compound init — one call returns ALL context needed for a workflow.
 *
 * Compound-init pattern: every workflow makes ONE CLI call that returns a JSON blob
 * with models, config, phase info, file paths, and file existence checks.
 * This is the single biggest token-saver.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getMergedConfig, findProjectRoot } = require("./config.cjs");
const { getModels } = require("./model-profiles.cjs");
const { readState, checkWorkflowLock, ensureStateDir, updateState, priorTaskState } = require("./state.cjs");
const { sanitizeForPrompt, scanForInjection, validatePath, maskSecrets } = require("./security.cjs");
const { atomicWriteFileSync } = require("./io.cjs");
const { detectTier } = require("./preflight.cjs");

// Maps the `init <verb>` CLI verb to the canonical workflow_type written
// to workflow.yaml. New init verbs added in the future must also be added
// to this map AND to state.cjs::VALID_WORKFLOW_TYPES.
const WORKFLOW_TYPE_BY_INIT_VERB = Object.freeze({
  workflow: "dev",
  review: "code_review",
});

const REQUIRED_DEV_RULES = [
  "coding-standards.md",
  "testing-patterns.md",
  "quality-gates.md",
  "architecture.md",
];

const MAX_TASK_LENGTH = 50_000;

/**
 * Plugin-shipped guardrails inlined into the init payload.
 *
 * These three files are universal across all dev agents (programmer L34-37
 * lists them in context_loading), stable across plugin versions, and total
 * ~27KB at. Inlining them in `init.cjs` eliminates 3 Read tool calls
 * per agent dispatch — STANDARD workflow saves ~12 Reads (4 agents × 3 files).
 *
 * Cap at 64KB total to prevent runaway-template scenarios. On overflow,
 * fall back to path-only and emit a warning — agents revert to reading.
 */
const INLINE_GUARDRAILS = [
  "golden-rules.md",
  "engineering-principles.md",
  "generative-debt-checklist.md",
];
const MAX_INLINE_BYTES = 64 * 1024;

// Pinned-rubric content inlined into the init payload. The verifier reads
// `references/rubrics/<filename>` on every iteration; inlining keeps the
// dispatch prompt byte-stable across retries and saves one Read per iter.
// Mirrors loadInlineGuardrails, capped so a runaway rubric corpus cannot
// dominate a dispatch. Raised from 32 KB once the shipped trio reached ~32.6 KB
// and started forcing prose to be trimmed out of correct rubrics to fit — the
// cap was shaped when the corpus was smaller and inlining was the default.
// Rubric-by-reference is the default now, so this bounds the `--inline-rules`
// worktree path rather than the common one. Breaching it is loud at both call
// sites (init propagates the warning, dispatch prints it); it was the SILENCE
// that made this dangerous, not the number — over the cap every dispatch
// loses its inline rubric and lanes self-grade ad hoc against one they never
// received.
const MAX_INLINE_RUBRIC_BYTES = 48 * 1024;



// The rubric has to be readable from wherever the reviewer actually runs.
// Pointing at the plugin root put it OUTSIDE the project under review, and a
// lane declined to open it — "outside this repo and was not opened", a policy
// refusal rather than a filesystem error, which no path fix inside the plugin
// can reach. A copy under .devt/state/ is reachable by the same rules that
// already let every agent read code-review-input.md.
//
// Runs on every init and every dispatch render, so the steady state — dest
// already correct — must not read either file: size+mtime is an exact-enough
// skip for a byte-verbatim copy devt itself owns, and re-writing an unchanged
// rubric would churn the state mtimes several freshness gates read.
function materializeRubrics(pluginRoot, projectRoot, rubrics) {
  if (!pluginRoot || !projectRoot || !rubrics) return;
  const stateDir = path.join(projectRoot, ".devt", "state");
  let dirReady = false;
  // Keyed by source path, not by workflow_type: aliased types share one file
  // (code_review and code_review_parallel both pin code_review.v2.md), and each
  // still needs its OWN dest — <rubric_path> is .devt/state/rubric-<type>.md
  // with no exceptions, so a project overriding one alias gets what it
  // configured. Caching the body rather than only the resolved path is what
  // stops the shared source being re-read once per alias.
  const sources = new Map();
  for (const [workflowType, filename] of Object.entries(rubrics)) {
    if (!sources.has(filename)) {
      const resolved = require("./grader.cjs").resolveRubricFile(filename, { pluginRoot, projectRoot, requireExists: true });
      let entry = null;
      try { if (resolved) entry = { path: resolved, stat: fs.statSync(resolved), body: null }; } catch { /* unreadable source */ }
      sources.set(filename, entry);
    }
    const src = sources.get(filename);
    if (!src) continue;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const dest = path.join(stateDir, `rubric-${workflowType}.md`);
    try {
      let fresh = false;
      try {
        const cur = fs.statSync(dest);
        fresh = cur.size === src.stat.size && cur.mtimeMs >= src.stat.mtimeMs;
      } catch { /* dest absent — write it */ }
      if (fresh) continue;
      if (src.body === null) src.body = fs.readFileSync(src.path, "utf8");
      if (!dirReady) { fs.mkdirSync(stateDir, { recursive: true }); dirReady = true; }
      atomicWriteFileSync(dest, src.body);
    } catch { /* unresolvable source or unwritable state dir — the envelope's absence directive covers it */ }
  }
}


function loadInlineRubrics(pluginRoot, projectRoot, rubrics) {
  if (!pluginRoot || !rubrics) return { content: null, bytes: 0, warnings: [] };
  const result = {};
  const warnings = [];
  // Aliased workflow_types sharing one rubric file (code_review_parallel →
  // code_review.v2.md) must not double-count its bytes against the cap —
  // without dedup the shipped default trio exceeds the cap and inlining
  // silently falls back to path-only for everyone.
  const seen = new Map();
  let totalBytes = 0;
  for (const [workflowType, filename] of Object.entries(rubrics)) {
    if (!filename || typeof filename !== "string") continue;
    const resolved = require("./grader.cjs").resolveRubricFile(filename, { pluginRoot, projectRoot, requireExists: true });
    if (!resolved) {
      warnings.push(`rubric missing on disk for workflow_type=${workflowType}: ${filename}`);
      continue;
    }
    if (seen.has(resolved)) {
      result[workflowType] = seen.get(resolved);
      continue;
    }
    const buf = fs.readFileSync(resolved);
    totalBytes += buf.length;
    if (totalBytes > MAX_INLINE_RUBRIC_BYTES) {
      warnings.push(`inline-rubrics over ${MAX_INLINE_RUBRIC_BYTES} bytes — falling back to path-only`);
      return { content: null, bytes: totalBytes, warnings };
    }
    const text = buf.toString("utf8");
    seen.set(resolved, text);
    result[workflowType] = text;
  }
  return { content: result, bytes: totalBytes, warnings };
}

// loadPriorSidecars — inlines the structured JSON sidecars of upstream
// agents into the consuming agent's dispatch envelope. Saves the
// consuming agent the Read-tool round-trip on every .devt/state/*.json
// it would otherwise fetch turn-1.
//
// Each sidecar is ~80 bytes ({status, verdict, agent} enum triple), so
// the entire <prior_outputs> block stays <1 KB in practice — even with
// all 4 known sidecars present. The 8 KB cap is defensive only.
//
// Auto-discovery semantics: looks for every sidecar declared in
// JSON_SIDECAR_SCHEMAS that EXISTS at dispatch time AND is not produced
// by the consuming agent itself (verifier shouldn't see its own prior
// verification.json from a stale phase). Workflow-agnostic — whatever
// sidecars happen to be on disk, that's what the consumer receives.
const PRIOR_SIDECAR_CAP = 8 * 1024;
const PRIOR_SIDECAR_PRODUCERS = {
  "impl-summary.json": "programmer",
  "test-summary.json": "tester",
  "verification.json": "verifier",
  "review.json": "code-reviewer",
};
function loadPriorSidecars(projectRoot, consumerAgent) {
  if (!projectRoot || !consumerAgent) return { content: "", bytes: 0, count: 0 };
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const stateDir = path.join(projectRoot, ".devt", "state");
  const blocks = [];
  let totalBytes = 0;
  for (const [filename, producer] of Object.entries(PRIOR_SIDECAR_PRODUCERS)) {
    if (producer === consumerAgent) continue;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const filepath = path.join(stateDir, filename);
    if (!fs.existsSync(filepath)) continue;
    let raw;
    try { raw = fs.readFileSync(filepath, "utf8").trim(); }
    catch { continue; }
    if (!raw) continue;
    // Validate + canonicalize. JSON_SIDECAR_SCHEMAS asserts sidecars are
    // always-objects with a fixed status/verdict/agent enum triple. A
    // malformed file (mid-write, manual edit, schema drift) would otherwise
    // inject raw garbage into the consuming agent's dispatch envelope.
    // Re-serializing through JSON.stringify also guarantees byte-stable
    // representation across whitespace variations — K71 idempotence holds
    // even if a user edited the sidecar with extra newlines.
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { continue; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const canonical = JSON.stringify(parsed);
    const block = `<${producer}_sidecar>\n${canonical}\n</${producer}_sidecar>`;
    if (totalBytes + block.length > PRIOR_SIDECAR_CAP) {
      // Cap breached — emit what we have plus a notice. Realistic
      // payloads never hit this; cap exists for defense against an
      // ill-formed sidecar that ballooned somehow.
      blocks.push(`<truncation_notice>prior_outputs truncated at ${PRIOR_SIDECAR_CAP} bytes — full sidecars at .devt/state/*.json</truncation_notice>`);
      break;
    }
    blocks.push(block);
    totalBytes += block.length;
  }
  if (blocks.length === 0) return { content: "", bytes: 0, count: 0 };
  const content =
    `<prior_outputs>\n${blocks.join("\n")}\n</prior_outputs>\n` +
    `<prior_outputs_note>Sidecars above are the structured handoff from prior phase(s). Full markdown bodies remain at .devt/state/&lt;agent&gt;-summary.md or review.md — Read those only when you need verbatim content (e.g., to cite a specific decision text in your verdict).</prior_outputs_note>`;
  return { content, bytes: Buffer.byteLength(content), count: blocks.length };
}

function loadInlineGuardrails(pluginRoot) {
  if (!pluginRoot) return { content: null, bytes: 0, warnings: [] };
  const result = {};
  const warnings = [];
  let totalBytes = 0;
  for (const name of INLINE_GUARDRAILS) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const filePath = path.join(pluginRoot, "guardrails", name);
    if (!fs.existsSync(filePath)) {
      warnings.push(`guardrail missing on disk: ${name}`);
      continue;
    }
    const buf = fs.readFileSync(filePath);
    totalBytes += buf.length;
    if (totalBytes > MAX_INLINE_BYTES) {
      warnings.push(`inline-guardrails over ${MAX_INLINE_BYTES} bytes — falling back to path-only`);
      return { content: null, bytes: totalBytes, warnings };
    }
    result[name] = buf.toString("utf8");
  }
  return { content: result, bytes: totalBytes, warnings };
}

// loadGraphImpact — pulls .devt/state/graph-impact.md content for inline
// injection into investigative-agent dispatch envelopes (programmer,
// code-reviewer, debugger). Sub-agents are MCP-blind by contract, so the
// orchestrator inlines the file content rather than instructing a Read call.
//
// Returns { content, bytes, status } where:
//   status = "present"  — file exists, content inlined (possibly truncated)
//   status = "skipped"  — file absent, graphify-skip-reason.txt explanation
//                         inlined when available
//   status = "evicted"  — map gone but the impact plan records a real tier, so
//                         graphify ran and the artifact was lost afterwards
//   status = "absent"   — neither file present, and no plan either (no graphify
//                         configured / never run)
//
// Caps total content at 32 KB. When the file exceeds the cap, content carries
// the first 32 KB plus a truncation notice. Sub-agents reading the file
// directly via Bash/Read see the full version; inlined version is the
// high-signal head.
const GRAPH_IMPACT_CAP = 32 * 1024;
function loadGraphImpact(projectRoot) {
  if (!projectRoot) return { content: "", bytes: 0, status: "absent" };
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const impactPath = path.join(projectRoot, ".devt", "state", "graph-impact.md");
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const skipPath = path.join(projectRoot, ".devt", "state", "graphify-skip-reason.txt");
  if (fs.existsSync(impactPath)) {
    const buf = fs.readFileSync(impactPath);
    if (buf.length <= GRAPH_IMPACT_CAP) {
      return { content: buf.toString("utf8"), bytes: buf.length, status: "present" };
    }
    const truncated = buf.subarray(0, GRAPH_IMPACT_CAP).toString("utf8");
    const notice = `\n\n[truncated at ${GRAPH_IMPACT_CAP} bytes — full file at .devt/state/graph-impact.md (${buf.length} bytes)]`;
    return { content: truncated + notice, bytes: buf.length, status: "present" };
  }
  if (fs.existsSync(skipPath)) {
    let buf;
    try { buf = fs.readFileSync(skipPath); }
    catch { buf = Buffer.from(""); }
    const reason = buf.toString("utf8").trim() || "(graphify skipped — no reason recorded)";
    return {
      content: `(no graph-impact.md available — graphify skip reason: ${reason})`,
      bytes: buf.length,
      status: "skipped",
    };
  }
  // Absence of both files says the map is missing; it does NOT say why. The
  // impact plan survives evict-graphify by design (only the map, the skip
  // reason, and the staleness marker are evictable), so a plan carrying a real
  // tier beside a missing map is unambiguous: graphify ran and the artifact was
  // lost afterwards. Asserting "graphify did not run" in that state told five
  // lane reviewers the opposite of what happened AND told them to stop looking,
  // which is how an eviction bug stayed invisible for a whole run.
  //
  // The "(no graph-impact.md available — " prefix is load-bearing on both
  // branches: a smoke gate greps it, and the envelope-health classifier keys
  // "empty" off it. Only the clause after it may change.
  let planTier = null;
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
    const planPath = path.join(projectRoot, ".devt", "state", "graphify-impact-plan.json");
    if (fs.existsSync(planPath)) {
      const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
      const t = plan && plan.tier;
      if (typeof t === "string" && t && t !== "skip") planTier = t;
    }
  } catch { /* unreadable plan — fall through to the un-attributed message */ }
  if (planTier) {
    return {
      content: `(no graph-impact.md available — the impact plan on disk records tier="${planTier}", so graphify DID run for this workflow and the map was evicted or deleted afterwards. Treat blast-radius context as MISSING, not absent-by-design: ask the orchestrator to re-run the impact step, or investigate with grep and say explicitly that you did.)`,
      bytes: 0,
      status: "evicted",
    };
  }
  return {
    content: "(no graph-impact.md available — no impact plan on disk either, so graphify most likely never ran for this workflow; investigate with grep)",
    bytes: 0,
    status: "absent",
  };
}

/**
 * Project-shipped governing rules inlined into the init payload.
 *
 * Same pattern as `loadInlineGuardrails` but pulls from the PROJECT (CLAUDE.md +
 * .devt/rules/*.md), not the plugin. Consumed by 3 reading agents
 * (code-reviewer, verifier, researcher) via the `<governing_rules>` dispatch
 * tag block. Agents prefer inline content over on-disk Reads when present.
 *
 * Priority order (always-included first, then alphabetical):
 * CLAUDE.md, coding-standards.md, architecture.md, quality-gates.md,
 * review-checklist.md, then any remaining .devt/rules/*.md alphabetically.
 *
 * CLAUDE.md is hashed but NEVER inlined: the harness auto-injects project
 * CLAUDE.md into every subagent's context (built-in Explore/Plan are the
 * only exceptions, and devt agents are custom agents), so inlining it pays
 * the byte cost twice per dispatch. `content["CLAUDE.md"]` carries a short
 * stub so template substitution stays populated; the real bytes surface in
 * `paths_excluded` with reason "harness_injected" and still feed rules_hash.
 *
 * Cap at 96KB total for the .devt/rules/*.md corpus. Files beyond cap are
 * NOT included; their paths surface in `paths_excluded` so agents can Read
 * them on demand when relevant.
 *
 * The `rules_hash` is SHA-256 (first 16 chars) of the concatenated content
 * of ALL discovered rule files (included and excluded), in a stable order.
 * Workflows surface this in the dispatch prompt so agents can detect mid-
 * workflow drift via re-hash, and so the same dispatch is byte-identical
 * across cache-eligible retries.
 */
const GOVERNING_RULES_PRIORITY = [
  "coding-standards.md",
  "architecture.md",
  "quality-gates.md",
  "review-checklist.md",
];
const MAX_GOVERNING_RULES_BYTES = 96 * 1024;
const CLAUDE_MD_BY_REFERENCE_STUB =
  "(not inlined: the harness auto-injects project CLAUDE.md into every devt subagent's context — content covered by rules_hash)";
// Single source for the per-file by-reference stub. Both delivery pipelines
// must emit byte-identical stub text — the consumer agents' stub-awareness
// clause and the smoke gates pin this exact phrase.
const RULES_BY_REFERENCE_STUB = (key) =>
  `(by-reference: Read ${key} from disk when relevant to your scope — content covered by rules_hash)`;

// Per-guardrail by-reference stub. Guardrails are a fixed plugin-shipped set,
// identical across every dispatch, so by-reference mode swaps the ~25KB of
// bodies for these directives; the templates' Context-Loaded contract already
// treats a stub as read-and-record. Both delivery pipelines (init compound
// payload + cmdRenderFilled) must emit byte-identical stub text.
const GUARDRAILS_BY_REFERENCE_STUB = (name) =>
  `(by-reference: Read guardrails/${name} from disk before you start — a fixed plugin-shipped rule set, identical across every dispatch)`;

function loadGoverningRules(projectRoot, opts) {
  const result = { content: {}, paths_included: [], paths_excluded: [], rules_hash: null, total_bytes: 0, warnings: [] };
  if (!projectRoot) return result;
  // inlineByteCap=false (by-reference callers): the 96KB cap exists to protect
  // DISPATCH size, so it must not apply when bodies become ~120B stubs — an
  // over_budget exclusion in by-ref mode means the file never even gets a stub
  // and agents are never told it exists (field-observed: 5 project rules
  // invisible to reviewers). rules_hash is unaffected either way — it is
  // computed over ALL candidates before the budget branch.
  const inlineByteCap = !opts || opts.inlineByteCap !== false;

  // Discover candidate files in priority order. All path.join calls use
  // either project-root + fixed constant suffix, or rulesDir + a name from
  // an allowlist (GOVERNING_RULES_PRIORITY) or a readdir result that passes
  // validatePath confinement. Equivalent to scanDevRules's hardening at L266.
  const candidates = [];
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const claudeMd = path.join(projectRoot, "CLAUDE.md");
  if (fs.existsSync(claudeMd)) candidates.push({ name: "CLAUDE.md", filePath: claudeMd });

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const rulesDir = path.join(projectRoot, ".devt", "rules");
  if (fs.existsSync(rulesDir)) {
    // Priority files first — names come from a hardcoded allowlist.
    for (const name of GOVERNING_RULES_PRIORITY) {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const p = path.join(rulesDir, name);
      if (fs.existsSync(p)) candidates.push({ name: `.devt/rules/${name}`, filePath: p });
    }
    // Then any remaining *.md alphabetically — each name passes
    // validatePath confinement before being joined back to rulesDir.
    try {
      const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
      const others = entries
        .filter(e => e.isFile() && !e.isSymbolicLink())
        .map(e => e.name)
        .filter(n => n.endsWith(".md")
                     && !GOVERNING_RULES_PRIORITY.includes(n)
                     && !n.includes("/") && !n.includes("\\")
                     && n !== "." && n !== "..")
        .sort();
      for (const name of others) {
        const check = validatePath(name, rulesDir);
        if (!check.safe) continue;
        const rootCheck = validatePath(check.resolved, rulesDir);
        if (!rootCheck.safe) continue;
        // static-compress writes <name>.original.md backups as siblings —
        // inlining them duplicates the corpus per dispatch and cap-evicts
        // live rules. Excluded from content AND rules_hash (the hash must
        // reflect effective rules, not their backups), surfaced in
        // paths_excluded so the reduction is never silent.
        if (name.endsWith(".original.md")) {
          let bytes = 0;
          try { bytes = fs.statSync(check.resolved).size; } catch { /* best-effort size */ }
          result.paths_excluded.push({ name: `.devt/rules/${name}`, bytes, reason: "static_compress_backup" });
          continue;
        }
        candidates.push({ name: `.devt/rules/${name}`, filePath: check.resolved });
      }
    } catch { /* dir empty or unreadable */ }
  }

  if (candidates.length === 0) return result;

  // Read all candidates once, hash all, inline up to budget.
  const hash = crypto.createHash("sha256");
  let totalBytes = 0;
  for (const c of candidates) {
    let buf;
    try { buf = fs.readFileSync(c.filePath); } catch { result.warnings.push(`unreadable: ${c.name}`); continue; }
    hash.update(c.name); hash.update("\0"); hash.update(buf);
    if (c.name === "CLAUDE.md") {
      result.content[c.name] = CLAUDE_MD_BY_REFERENCE_STUB;
      result.paths_excluded.push({ name: c.name, bytes: buf.length, reason: "harness_injected" });
      continue;
    }
    if (!inlineByteCap || totalBytes + buf.length <= MAX_GOVERNING_RULES_BYTES) {
      result.content[c.name] = buf.toString("utf8");
      result.paths_included.push({ name: c.name, bytes: buf.length });
      totalBytes += buf.length;
    } else {
      result.paths_excluded.push({ name: c.name, bytes: buf.length, reason: "over_budget" });
      result.warnings.push(`${c.name} excluded from inline (${buf.length} bytes; budget ${MAX_GOVERNING_RULES_BYTES})`);
    }
  }

  result.rules_hash = hash.digest("hex").slice(0, 16);
  result.total_bytes = totalBytes;
  return result;
}

/**
 * Parse skill-index.yaml — devt's default-per-agent skill injection catalog.
 *
 * The file lives at `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` and ships with
 * the plugin. Structure (only the `agents` block is consumed today):
 *
 * agents:
 * <agent_type>:
 * skills:
 * - <skill-name>
 * - <skill-name>
 * reads: [ optional, ignored here ]
 *
 * Zero-deps parser scoped to this exact shape. Other YAML files in devt go
 * through `state.cjs::parseSimpleYaml` (flat-only) or are JSON. If
 * skill-index.yaml grows new top-level sections, extend this parser
 * explicitly — do NOT generalize.
 */
function parseSkillIndex(pluginRoot) {
  if (!pluginRoot) return {};
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const indexPath = path.join(pluginRoot, "skill-index.yaml");
  if (!fs.existsSync(indexPath)) return {};
  const content = fs.readFileSync(indexPath, "utf8");
  const lines = content.split("\n");

  const result = {};
  let section = null;        // top-level key: "agents" or "workflows"
  let currentName = null;    // the agent/workflow name
  let listKey = null;        // "skills" or "reads" — which list we're filling
  const indentOf = (l) => l.length - l.trimStart().length;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = indentOf(line);

    if (indent === 0 && trimmed.endsWith(":")) {
      section = trimmed.slice(0, -1);
      currentName = null;
      listKey = null;
      if (!result[section]) result[section] = {};
      continue;
    }
    if (section === "agents" && indent === 2 && trimmed.endsWith(":")) {
      currentName = trimmed.slice(0, -1);
      result[section][currentName] = {};
      listKey = null;
      continue;
    }
    if (section === "agents" && indent === 4 && trimmed.endsWith(":")) {
      listKey = trimmed.slice(0, -1);
      if (currentName) result[section][currentName][listKey] = [];
      continue;
    }
    if (indent === 6 && trimmed.startsWith("- ") && currentName && listKey) {
      result[section][currentName][listKey].push(trimmed.slice(2).trim());
      continue;
    }
  }
  return result;
}

// Merge tier buckets into a single deduped skill list. `skills` is always
// loaded; `skills_standard` adds when tier ≥ STANDARD; `skills_complex` adds
// only at COMPLEX. A null/unknown tier returns the union of all buckets —
// preserves prior behavior for callers that haven't classified yet.
//
// Two case conventions reach this function: `state.tier` is uppercase
// (state.cjs::VALID_TIERS) while `detectTier` returns lowercase. Normalize
// once via `.toLowerCase()` so the lookup key matches one shape.
const TIER_DEPTH = { trivial: 1, simple: 1, standard: 2, complex: 3 };
const BUCKET_KEYS = ["skills", "skills_standard", "skills_complex"];

function mergeSkillsForTier(buckets, tier) {
  const key = tier ? String(tier).toLowerCase() : null;
  const depth = TIER_DEPTH[key] ?? BUCKET_KEYS.length;
  const merged = BUCKET_KEYS.slice(0, depth).flatMap(
    k => Array.isArray(buckets[k]) ? buckets[k] : [],
  );
  return Array.from(new Set(merged));
}

/**
 * Resolve which skills the workflow orchestrator should inject as
 * `<agent_skills>` for a given agent type. Two sources, last-wins:
 *
 * 1. `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml`'s `agents.<type>` — ships with
 *    devt, supports tier-bucketed loading via `skills` (always),
 *    `skills_standard`, and `skills_complex` keys.
 * 2. `.devt/config.json`'s `agent_skills.<type>` — per-project override.
 *    Flat array shape preserved (= always loaded, ignores tier) so existing
 *    project configs don't break.
 *
 * `tier` is the workflow's complexity classification — TRIVIAL/SIMPLE get
 * only the `skills` bucket, STANDARD adds `skills_standard`, COMPLEX adds
 * both. Null/unknown returns the full union (safe default).
 *
 * Returns `{ <agent_type>: [...skill-names...], ... }`. Agents absent from
 * BOTH sources do not appear in the result.
 */
function resolveSkills(pluginRoot, config, tier) {
  const index = parseSkillIndex(pluginRoot);
  const indexAgents = (index && index.agents) || {};
  const configAgents = (config && config.agent_skills) || {};

  const resolved = {};
  const allAgentNames = new Set([
    ...Object.keys(indexAgents),
    ...Object.keys(configAgents),
  ]);

  for (const agent of allAgentNames) {
    if (Array.isArray(configAgents[agent])) {
      resolved[agent] = configAgents[agent].slice();
      continue;
    }
    if (indexAgents[agent]) {
      resolved[agent] = mergeSkillsForTier(indexAgents[agent], tier);
    }
  }
  return resolved;
}

function initWorkflow(task, pluginRoot, initVerb) {
  const projectRoot = findProjectRoot();
  const config = getMergedConfig();
  const models = getModels(
    config.model_profile || "balanced",
    config.model_overrides,
  );
  const state = readState();
  const workflowLock = checkWorkflowLock(state);
  const rulesDir = path.join(projectRoot, ".devt", "rules");
  const rulesFound = fs.existsSync(rulesDir);

  // Scan .devt/rules/ for available files
  let rulesFiles = [];
  if (rulesFound) {
    rulesFiles = scanDevRules(rulesDir);
  }

  // Check which required rules files are missing
  const missingRules = [];
  if (rulesFound) {
    for (const file of REQUIRED_DEV_RULES) {
      if (!fs.existsSync(path.join(rulesDir, file))) {
        missingRules.push(file);
      }
    }
  } else {
    missingRules.push(...REQUIRED_DEV_RULES);
  }

  // Check for CLAUDE.md
  const claudeMdExists = fs.existsSync(path.join(projectRoot, "CLAUDE.md"));

  // Check for .devt/config.json
  const configExists = fs.existsSync(path.join(projectRoot, ".devt", "config.json"));

  // Ensure state directory exists
  ensureStateDir();

  // Collect warnings for missing project setup
  const warnings = [];
  if (!rulesFound) {
    warnings.push(".devt/rules/ not found. Run /devt:setup --init to set up project.");
  }
  if (!configExists) {
    warnings.push(".devt/config.json not found. Run /devt:setup --init to configure project.");
  }

  // One line, and the foreign count is stated separately on purpose.
  // "archived 4 files" is ignorable; "2 not written by devt" is the part that
  // makes a reader open the manifest, and it is the only part that can point
  // at damage outside devt's own state. Silence when there is nothing to say.
  const summarizeSweep = (r) => {
    if (!r || r.ok === false) return null;
    const n = (r.archived || []).length;
    const f = r.foreign_count || 0;
    if (n === 0 && f === 0) return null;
    const where = r.archive_path ? ` → ${path.basename(r.archive_path)}/` : "";
    if (f === 0) return `swept ${n} devt file(s)${where}`;
    return `swept ${n} devt file(s)${where} · ⚠ ${f} not written by devt, left in place (run 'devt-tools state audit' to list)`;
  };

  // Sanitize task text before it flows into agent prompts
  let sanitizedTask = task || null;
  const injectionWarning = [];
  if (sanitizedTask) {
    if (sanitizedTask.length > MAX_TASK_LENGTH) {
      throw new Error(
        `Task description exceeds ${MAX_TASK_LENGTH} bytes (got ${sanitizedTask.length}). ` +
        `Trim the task or pass details via .devt/state/ artifacts instead.`,
      );
    }
    const scan = scanForInjection(sanitizedTask);
    if (!scan.clean) {
      injectionWarning.push(`Task text contains suspicious patterns: ${scan.findings.join("; ")}`);
      sanitizedTask = sanitizeForPrompt(sanitizedTask);
    }
  }

  // Tier seed: prefer the workflow's already-classified tier (set by
  // complexity-assessment); fall back to detectTier(task) so the first
  // dispatch in a fresh workflow still gets tier-aware skill loading.
  const seededTier = state.tier || (sanitizedTask ? detectTier(sanitizedTask) : null);

  // Clean prior-workflow gate markers + lane outputs before mutating workflow.yaml.
  // Without this, stale gate-satisfaction markers from a prior session would persist
  // into the new workflow's state directory and falsely satisfy freshness gates.
  // Eviction is best-effort — failure does not block init.
  let sweepReport = null;
  try {
    const { evictWorkflowArtifacts, cleanupStateFiles } = require("./state-audit.cjs");
    evictWorkflowArtifacts({ dryRun: false });
    // The workflow-artifact evict is keyed to a fixed allowlist + slug-
    // variant regex, but state accumulates ad-hoc filenames that no regex
    // catches. Wire cleanup here so every init * sweep covers both gate
    // markers AND the ad_hoc bucket.
    //
    // Read the PRIOR workflow's created_at from workflow.yaml BEFORE
    // init's strip+restamp. Pass it as adHocCutoffMtime so ad-hoc files
    // older than the prior workflow's start get archived — catches
    // multi-PR-per-day residue (e.g. handfuls of leftover lane/wave files
    // from yesterday's session). Falls back to staleDays=1 when
    // created_at is unavailable.
    let priorCreatedAt = null;
    try {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const wfPath = path.join(projectRoot, ".devt", "state", "workflow.yaml");
      if (fs.existsSync(wfPath)) {
        const yaml = fs.readFileSync(wfPath, "utf8");
        const m = yaml.match(/^created_at:\s*"?([^"\n]+)"?\s*$/m);
        if (m) priorCreatedAt = m[1].trim();
      }
    } catch { /* fall through with null — adHocStaleDays takes over */ }
    const swept = cleanupStateFiles({
      dryRun: false,
      autoSweep: true,
      staleDays: 1,
      adHocStaleDays: 1,
      adHocCutoffMtime: priorCreatedAt,
      // Same cutoff for pattern_allowed catches stale review-lane-*.md
      // from prior same-day workflows that calendar-age `staleDays=1`
      // couldn't catch.
      patternAllowedCutoffMtime: priorCreatedAt,
    });
    sweepReport = summarizeSweep(swept);
    if (sweepReport) process.stderr.write(`[devt] ${sweepReport}\n`);
  } catch { /* non-fatal */ }

  // Reset workflow.yaml on every init * call so stale prior-session values
  // (workflow_id, workflow_type, created_at from a closed workflow) never
  // bleed into a new session. PRESERVATION RULE: when the existing
  // workflow.yaml has `active: true`, the workflow is still in-flight —
  // preserve created_at + workflow_id so mcp-stats / dispatch-warnings /
  // gate-trace correlation across phase advances remains intact. Stripping
  // on every init was rotating IDs dozens of times within a single
  // conceptual workflow. Only strip when the prior workflow is closed
  // (active: false or absent).
  const workflowTypeForVerb = WORKFLOW_TYPE_BY_INIT_VERB[initVerb] || null;
  if (workflowTypeForVerb) {
    try {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const wfPath = path.join(projectRoot, ".devt", "state", "workflow.yaml");
      if (fs.existsSync(wfPath)) {
        let yaml = fs.readFileSync(wfPath, "utf8");
        const activeMatch = yaml.match(/^active:\s*(true|false)\s*$/m);
        const priorIsActive = activeMatch && activeMatch[1] === "true";
        if (priorIsActive) {
          // Active workflow — preserve created_at + workflow_id for
          // cross-phase correlation. Only strip lanes (workflow-scoped
          // partition state that doesn't survive re-init even within an
          // active workflow, per H7).
          yaml = yaml.replace(/^lanes:\s*\n(?:\s{2,}.*\n?)*/gm, "");
        } else {
          // Closed (active: false) or missing active marker — strip stamps
          // and lanes so updateState treats this as a fresh activation.
          // Concurrent-mutation guard (cal #37 #2): a lane subagent must
          // never strip/rotate the shared workflow_id mid-fan-out. Throws when
          // a fresh "running" subagent exists (block mode); the orchestrator
          // only inits at workflow boundaries when no subagent is active.
          try { require("./state.cjs")._guardConcurrentRotation("init workflow (strip closed workflow_id)"); }
          catch (e) { if (/lane_state_guard/.test(e.message)) throw e; }
          // Cal #37 #1 — audit-log the pre-strip workflow_id so post-hoc
          // forensics can pair "init stripped X" with the eventual
          // updateState "created Y" entry. Without this, the strip-and-
          // restamp pattern shows up in the audit log as `prev_id: null`
          // because updateState reads the already-stripped state.
          try {
            const priorIdMatch = yaml.match(/^workflow_id:\s*"?([^"\n]+)"?\s*$/m);
            const priorId = priorIdMatch ? priorIdMatch[1].trim() : null;
            if (priorId) {
              const stateDirPath = path.join(projectRoot, ".devt", "state");
              const auditPath = path.join(stateDirPath, "workflow-id-rotations.jsonl");
              fs.appendFileSync(auditPath, JSON.stringify({
                ts: new Date().toISOString(),
                prev_id: priorId,
                new_id: null,
                source: "initWorkflow:strip_closed_workflow",
                pid: process.pid,
                argv: (process.argv || []).slice(1, 6).join(" "),
              }) + "\n");
            }
          } catch { /* audit best-effort */ }
          yaml = yaml
            .replace(/^created_at:.*\n?/gm, "")
            .replace(/^workflow_id:.*\n?/gm, "")
            // lanes[] are workflow-scoped to code_review_parallel — they
            // describe THIS PR's partition, not a persistent registry.
            // Without this strip, a new review can inherit stale lanes
            // from the prior PR because the parser preserves the block.
            // Strip both the bare-key marker (rare empty form) AND the
            // nested block ("lanes:\n  - id:..." with continuation lines).
            .replace(/^lanes:\s*\n(?:\s{2,}.*\n?)*/gm, "");

          // Rotate JSONL counter logs on workflow_id change. Auto-reset is a
          // patch over counter accumulation: auto-reset-if-stale only fires
          // when task_changed AND workflow_type_changed AND age>1h —
          // same-type or same-hour workflow churn never triggers it, leaving
          // raw_dispatch +
          // claim_check_failures records from the closed workflow in the
          // gate's scan window. On block-mode projects this triggers KILL-gate
          // false-fire (dispatch_hygiene_kill_threshold=3 catches 3+
          // accumulated). Mirror resetSoft's RESET_SOFT_ROTATE_LOGS rotation:
          // when a closed workflow is being replaced, archive its counter
          // logs so the fresh workflow starts at count=0. Best-effort —
          // failure does not block init.
          try {
            const stateDirPath = path.join(projectRoot, ".devt", "state");
            const COUNTER_LOGS = ["dispatch-warnings.jsonl", "claim-checks.jsonl"];
            const archiveTs = new Date().toISOString().replace(/[:.]/g, "-");
            for (const logName of COUNTER_LOGS) {
              const src = path.join(stateDirPath, logName);
              if (!fs.existsSync(src)) continue;
              const archived = `${logName.replace(/\.jsonl$/, "")}.archive-${archiveTs}.jsonl`;
              const dst = path.join(stateDirPath, archived);
              try { fs.renameSync(src, dst); } catch { /* per-log non-fatal */ }
            }
          } catch { /* non-fatal: gate continues to work on whatever counts remain */ }
        }
        fs.writeFileSync(wfPath, yaml);
      }
    } catch {
      // fs error tolerated — updateState handles create-from-scratch
    }
    updateState([
      "active=true",
      `workflow_type=${workflowTypeForVerb}`,
      `task=${sanitizedTask || "null"}`,
      "phase=context_init",
      "status=in_progress",
      "verify_iteration=0",
      "verdict=null",
      "repair=null",
      "stopped_at=null",
      "stopped_phase=null",
      "resume_context=null",
      "memory_signal_json=null",
      "scope_hint_json=null",
      "scope_trust_json=null",
    ]);
  }

  // Inline rubric bodies: only the standalone-review single-dispatch reviewer
  // consumes one (its deliberate self-check). Every workflow-verb envelope reads
  // the rubric by-reference (<rubric_path>), so off the review path we skip the
  // rubric-file reads entirely rather than reading them only to discard the
  // bodies. inline_rubrics_omitted keeps the reduction visible (payload-size
  // delta stays attributable); its universe is the CONFIGURED rubric set, so an
  // oversized-rubric fallback still reports the bodies as omitted.
  // Materialized for BOTH verbs: dev workflows never inline the rubric, so the
  // verifier's <rubric_path> is the only copy it ever sees. The templates carry
  // the destination as a literal, so the return value has no consumer.
  materializeRubrics(pluginRoot, projectRoot, config.rubrics || {});
  const _inlineRubrics = initVerb === "review"
    ? loadInlineRubrics(pluginRoot, projectRoot, config.rubrics || {})
    : null;
  if (_inlineRubrics) warnings.push(..._inlineRubrics.warnings);
  const inlineRubricsForVerb = _inlineRubrics ? (_inlineRubrics.content || {}) : {};
  const inlineRubricsOmitted = Object.keys(config.rubrics || {}).filter((k) => !(k in inlineRubricsForVerb));

  return {
    task: sanitizedTask,
    project_root: projectRoot,
    plugin_root: pluginRoot,
    config: maskSecrets(config),
    models,
    state,
    workflow_lock: workflowLock,
    dev_rules: {
      found: rulesFound,
      path: rulesDir,
      files: rulesFiles,
      missing_rules: missingRules,
    },
    claude_md_exists: claudeMdExists,
    config_exists: configExists,
    // Carried into the bundle, not only stderr: a 20-block orchestration
    // scrolls stderr past the operator, and the foreign count is the one
    // signal here that can point at damage outside .devt/state/.
    state_sweep: sweepReport,
    state_dir: path.join(projectRoot, ".devt", "state"),
    tdd_mode: state.tdd_mode || false,
    tier: seededTier,
    resolved_skills: resolveSkills(pluginRoot, config, seededTier),
    inline_guardrails: (() => {
      const r = loadInlineGuardrails(pluginRoot);
      warnings.push(...r.warnings);
      // Mirror governing_rules: dispatch.guardrails_mode (default by-reference)
      // decides whether the compound payload carries full guardrail bodies or
      // per-file read-from-disk stubs. By-reference keeps ~25KB of a fixed,
      // dispatch-invariant rule set out of the orchestrator's fill context; the
      // consumer Reads them once. Inline stays available as a config escape.
      const byRef = ((config.dispatch || {}).guardrails_mode || "by-reference") !== "inline";
      if (!byRef || !r.content) return r.content;
      return Object.fromEntries(
        Object.keys(r.content).map((name) => [name, GUARDRAILS_BY_REFERENCE_STUB(name)])
      );
    })(),
    governing_rules: (() => {
      // Delivery-mode resolution mirrors cmdRenderFilled: config
      // dispatch.rules_mode (default by-reference) decides whether the
      // compound payload carries full rule bodies or per-file stubs. The
      // orchestrator fills dispatch placeholders verbatim from content, so
      // stubbing HERE is what makes the canonical LLM-fill dispatch paths
      // by-reference — and keeps the rules corpus out of orchestrator
      // context entirely. CLAUDE.md is already stubbed at load. Inline mode
      // (config escape) returns full bodies unchanged. By-ref bypasses the
      // inline byte-cap so oversized rules still get stubs.
      const byRef = ((config.dispatch || {}).rules_mode || "by-reference") !== "inline";
      const r = loadGoverningRules(projectRoot, { inlineByteCap: !byRef });
      warnings.push(...r.warnings);
      let content = r.content;
      let stubbedBytes = 0;
      if (byRef) {
        content = {};
        for (const [key, value] of Object.entries(r.content)) {
          if (key === "CLAUDE.md") { content[key] = value; continue; }
          content[key] = RULES_BY_REFERENCE_STUB(key);
          stubbedBytes += Buffer.byteLength(String(value), "utf8");
        }
      }
      return {
        content,
        delivery_mode: byRef ? "by-reference" : "inline",
        stubbed_bytes_saved: stubbedBytes,
        paths_included: r.paths_included,
        paths_excluded: r.paths_excluded,
        rules_hash: r.rules_hash,
        total_bytes: r.total_bytes,
      };
    })(),
    // Pinned rubric filenames per workflow_type. Surfaced at the
    // top level so dispatch templates use the flat `{rubrics.dev}` namespace
    // rather than nested `{config.rubrics.dev}` access. Defaults to
    // `dev.v1.md`; override in `.devt/config.json` to bump version.
    rubrics: config.rubrics || {},
    inline_rubrics: inlineRubricsForVerb,
    inline_rubrics_omitted: inlineRubricsOmitted,
    warnings: warnings.concat(injectionWarning),
  };
}

function scanDevRules(dir, prefix, rootDir) {
  const files = [];
  prefix = prefix || "";
  rootDir = rootDir || dir;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Reject names that could break out of rootDir; skip symlinks entirely.
      if (entry.name.includes("/") || entry.name.includes("\\") ||
          entry.name === "." || entry.name === ".." ||
          entry.isSymbolicLink()) {
        continue;
      }
      // validatePath enforces confinement under rootDir; reject anything that escapes.
      const check = validatePath(entry.name, dir);
      if (!check.safe) continue;
      const rootCheck = validatePath(check.resolved, rootDir);
      if (!rootCheck.safe) continue;

      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...scanDevRules(check.resolved, relPath, rootDir));
      } else if (entry.isFile()) {
        // static-compress .original.md backups are not rules — keep them out of listings
        if (entry.name.endsWith(".original.md")) continue;
        files.push(relPath);
      }
    }
  } catch {
    // Directory not readable
  }
  return files;
}

// An `init` with no task argument must not replace a task the caller already
// scoped. init runs at the top of every context-init bundle purely for its
// payload, and the placeholder it used to write unconditionally destroyed the
// real task on the way past — invisibly on the cached-bundle path, where
// nothing downstream rewrites it afterwards. Preserve what is already there;
// fall back to the placeholder only when state carries nothing.
function _taskOrExisting(supplied, placeholder) {
  if (supplied && supplied.trim()) return supplied;
  const { prior, usable } = priorTaskState(placeholder);
  return usable ? prior : placeholder;
}

function run(subcommand, args, pluginRoot) {
  switch (subcommand) {
    case "workflow":
      return initWorkflow(_taskOrExisting(args.join(" "), ""), pluginRoot, "workflow");
    case "review": {
      // G6 (cal #31.D) — opt-in compound bundling. `--bundle` attaches the
      // post-init context-build steps (preflight, memory signal, graphify
      // impact-plan) so the orchestrator gets all setup data in one CLI call
      // instead of 4-6 sequential round-trips. Receipt #5 Q7b: setup friction
      // was dominated by CLI calls (12-14 before Wave 1), not MCP or files.
      // Bundle is best-effort — any sub-step failure returns a partial result
      // with `bundle.errors[]` populated; init.workflow_id always succeeds.
      const wantBundle = args.includes("--bundle");
      const cleanArgs = args.filter(a => a !== "--bundle");
      const baseResult = initWorkflow(_taskOrExisting(cleanArgs.join(" "), "code review"), pluginRoot, "review");
      if (!wantBundle) return baseResult;
      const bundle = runReviewBundle(cleanArgs.join(" "));
      return { ...baseResult, bundle };
    }
    default:
      throw new Error(
        `Unknown init type: ${subcommand}. Use: workflow, review`,
      );
  }
}

// G6 (cal #31.D) — review-context bundling helper. Runs the 3 most common
// post-init data-fetch steps in one shot. Each step is wrapped so one
// failure doesn't sink the whole bundle; errors aggregate into bundle.errors
// for orchestrator visibility. Skips graphify steps when graphify is not
// enabled (cheap probe via graphify.status()).
function runReviewBundle(taskText) {
  const errors = [];
  let preflightOk = false;
  let memorySignalCount = 0;
  let graphifyImpactPlan = null;
  let graphifyEnabled = false;

  // Step 1: preflight generate (writes .devt/state/preflight-brief.{md,json})
  try {
    const preflight = require("./preflight.cjs");
    preflight.generate(taskText || "code review", {});
    preflightOk = true;
  } catch (e) {
    errors.push(`preflight: ${e.message || String(e)}`);
  }

  // Step 2: memory signal count (cheap probe — full query happens via existing
  // memory query CLI when needed; bundle just confirms FTS index exists +
  // returns top-line count). Skip if memory module fails.
  try {
    const memory = require("./memory.cjs");
    const sig = memory.queryFTS(taskText || "review", { limit: 50 });
    if (Array.isArray(sig)) memorySignalCount = sig.length;
  } catch (e) {
    errors.push(`memory: ${e.message || String(e)}`);
  }

  // Step 3: graphify impact-plan emit (only when graphify is enabled +
  // graph.json exists). status() short-circuits cheaply when not ready.
  try {
    const graphify = require("./graphify.cjs");
    const status = graphify.status();
    if (status && status.state === "ready") {
      graphifyEnabled = true;
      // Best-effort impact-plan: read the preflight-brief.json that step 1
      // just wrote, extract topic.symbols, attempt blast_radius. Cheap because
      // both files are now hot in cache.
      const fs = require("fs");
      const path = require("path");
      const briefPath = path.join(process.cwd(), ".devt", "state", "preflight-brief.json");
      if (fs.existsSync(briefPath)) {
        const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
        const symbols = brief && brief.topic && Array.isArray(brief.topic.symbols) ? brief.topic.symbols.slice(0, 5) : [];
        if (symbols.length > 0) {
          const blast = graphify.blastRadius(symbols);
          graphifyImpactPlan = {
            symbols,
            effect_size: blast && blast.effect_size ? blast.effect_size : null,
            source: blast && blast.source ? blast.source : "unknown",
          };
        }
      }
    }
  } catch (e) {
    errors.push(`graphify: ${e.message || String(e)}`);
  }

  return {
    preflight_generated: preflightOk,
    memory_signal_count: memorySignalCount,
    graphify_enabled: graphifyEnabled,
    graphify_impact_plan: graphifyImpactPlan,
    errors,
  };
}

module.exports = { run, REQUIRED_DEV_RULES, loadGoverningRules, loadInlineGuardrails, loadInlineRubrics, materializeRubrics, loadGraphImpact, loadPriorSidecars, CLAUDE_MD_BY_REFERENCE_STUB, RULES_BY_REFERENCE_STUB, GUARDRAILS_BY_REFERENCE_STUB };
