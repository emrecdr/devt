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
const { readState, checkWorkflowLock, ensureStateDir, updateState } = require("./state.cjs");
const { sanitizeForPrompt, scanForInjection, validatePath, maskSecrets } = require("./security.cjs");
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
// Mirrors loadInlineGuardrails: small files (~5 KB each); cap at 32 KB total
// so a future multi-rubric project still fits before falling back to
// path-only via `<rubric_path>`.
const MAX_INLINE_RUBRIC_BYTES = 32 * 1024;

function loadInlineRubrics(pluginRoot, projectRoot, rubrics) {
  if (!pluginRoot || !rubrics) return { content: null, bytes: 0, warnings: [] };
  const result = {};
  const warnings = [];
  let totalBytes = 0;
  for (const [workflowType, filename] of Object.entries(rubrics)) {
    if (!filename || typeof filename !== "string") continue;
    // Resolution order mirrors grader.cjs::resolveRubricPath:
    // absolute path → project-local .devt/rubrics/<f> → plugin defaults.
    // Each candidate is confined to its trusted root.
    let resolved = null;
    if (path.isAbsolute(filename)) {
      resolved = filename;
    } else if (projectRoot) {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const projectDir = path.join(projectRoot, ".devt", "rubrics");
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const cand = path.normalize(path.join(projectDir, filename));
      const scoped = cand === projectDir || cand.startsWith(projectDir + path.sep);
      if (scoped && fs.existsSync(cand)) resolved = cand;
    }
    if (!resolved) {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const pluginDir = path.join(pluginRoot, "references", "rubrics");
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const cand = path.normalize(path.join(pluginDir, filename));
      const scoped = cand === pluginDir || cand.startsWith(pluginDir + path.sep);
      if (scoped && fs.existsSync(cand)) resolved = cand;
    }
    if (!resolved) {
      warnings.push(`rubric missing on disk for workflow_type=${workflowType}: ${filename}`);
      continue;
    }
    const buf = fs.readFileSync(resolved);
    totalBytes += buf.length;
    if (totalBytes > MAX_INLINE_RUBRIC_BYTES) {
      warnings.push(`inline-rubrics over ${MAX_INLINE_RUBRIC_BYTES} bytes — falling back to path-only`);
      return { content: null, bytes: totalBytes, warnings };
    }
    result[workflowType] = buf.toString("utf8");
  }
  return { content: result, bytes: totalBytes, warnings };
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
 * Cap at 96KB total — generous enough for CLAUDE.md (~27KB) + 5 rule files
 * (~8KB each). Files beyond cap are NOT included; their paths surface in
 * `paths_excluded` so agents can Read them on demand when relevant.
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

function loadGoverningRules(projectRoot) {
  const result = { content: {}, paths_included: [], paths_excluded: [], rules_hash: null, total_bytes: 0, warnings: [] };
  if (!projectRoot) return result;

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
    if (totalBytes + buf.length <= MAX_GOVERNING_RULES_BYTES) {
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
    config.model_profile || "quality",
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
    warnings.push(".devt/rules/ not found. Run /devt:init to set up project.");
  }
  if (!configExists) {
    warnings.push(".devt/config.json not found. Run /devt:init to configure project.");
  }

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
  try {
    const { evictWorkflowArtifacts, cleanupStateFiles } = require("./state-audit.cjs");
    evictWorkflowArtifacts({ dryRun: false });
    // H1 (greenfield calibration #9): the workflow-artifact evict is keyed to a
    // fixed allowlist + slug-variant regex, but state accumulates ad-hoc
    // filenames (council-*, simplify-*, validated-*, graphify-*-review.md,
    // *.json sidecars for slug variants) that no regex catches. Greenfield's
    // calibration #9 audit: 29 of 30 stale files clear via the existing
    // ad_hoc classifier when cleanup runs with staleDays=1. Wire it here so
    // every init * sweep covers both gate markers AND the ad_hoc bucket.
    // Non-fatal — failure to clean ad_hoc files never blocks workflow init.
    cleanupStateFiles({ dryRun: false, staleDays: 1, adHocStaleDays: 1 });
  } catch { /* non-fatal */ }

  // Reset workflow.yaml unconditionally on every init * call so stale prior-session
  // values (workflow_id, workflow_type, created_at from a different workflow) never
  // bleed into the new session. Strip created_at + workflow_id first so updateState
  // treats this as a fresh activation and re-stamps both fields unconditionally —
  // the transition branch only fires on workflow_type change, but the !created_at
  // branch fires whenever the field is absent, covering same-type re-activations too.
  const workflowTypeForVerb = WORKFLOW_TYPE_BY_INIT_VERB[initVerb] || null;
  if (workflowTypeForVerb) {
    try {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const wfPath = path.join(projectRoot, ".devt", "state", "workflow.yaml");
      if (fs.existsSync(wfPath)) {
        let yaml = fs.readFileSync(wfPath, "utf8");
        yaml = yaml
          .replace(/^created_at:.*\n?/gm, "")
          .replace(/^workflow_id:.*\n?/gm, "")
          // H7 (greenfield calibration #9): lanes[] are workflow-scoped to
          // code_review_parallel — they describe THIS PR's partition, not a
          // persistent registry. Greenfield's PR #376 review saw PR #374's
          // lanes still in workflow.yaml because the old parser preserved the
          // block. Strip both the bare-key marker (rare empty form) AND the
          // nested block ("lanes:\n  - id:..." with continuation lines).
          .replace(/^lanes:\s*\n(?:\s{2,}.*\n?)*/gm, "");
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
    state_dir: path.join(projectRoot, ".devt", "state"),
    tdd_mode: state.tdd_mode || false,
    tier: seededTier,
    resolved_skills: resolveSkills(pluginRoot, config, seededTier),
    inline_guardrails: (() => {
      const r = loadInlineGuardrails(pluginRoot);
      warnings.push(...r.warnings);
      return r.content;
    })(),
    governing_rules: (() => {
      const r = loadGoverningRules(projectRoot);
      warnings.push(...r.warnings);
      return {
        content: r.content,
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
    inline_rubrics: (() => {
      const r = loadInlineRubrics(pluginRoot, projectRoot, config.rubrics || {});
      warnings.push(...r.warnings);
      return r.content;
    })(),
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
        files.push(relPath);
      }
    }
  } catch {
    // Directory not readable
  }
  return files;
}

function run(subcommand, args, pluginRoot) {
  switch (subcommand) {
    case "workflow":
      return initWorkflow(args.join(" "), pluginRoot, "workflow");
    case "review":
      return initWorkflow(args.join(" ") || "code review", pluginRoot, "review");
    default:
      throw new Error(
        `Unknown init type: ${subcommand}. Use: workflow, review`,
      );
  }
}

module.exports = { run, REQUIRED_DEV_RULES };
