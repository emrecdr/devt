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
const { getMergedConfig, findProjectRoot } = require("./config.cjs");
const { getModels } = require("./model-profiles.cjs");
const { readState, checkWorkflowLock, ensureStateDir } = require("./state.cjs");
const { sanitizeForPrompt, scanForInjection, validatePath, maskSecrets } = require("./security.cjs");

const REQUIRED_DEV_RULES = [
  "coding-standards.md",
  "testing-patterns.md",
  "quality-gates.md",
  "architecture.md",
];

const MAX_TASK_LENGTH = 50_000;

/**
 * Parse skill-index.yaml — devt's default-per-agent skill injection catalog.
 *
 * The file lives at `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml` and ships with
 * the plugin. Structure (only the `agents` block is consumed today):
 *
 *   agents:
 *     <agent_type>:
 *       skills:
 *         - <skill-name>
 *         - <skill-name>
 *       reads: [ optional, ignored here ]
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

/**
 * Resolve which skills the workflow orchestrator should inject as
 * `<agent_skills>` for a given agent type. Two sources, last-wins:
 *
 *   1. `${CLAUDE_PLUGIN_ROOT}/skill-index.yaml`'s `agents.<type>.skills` —
 *      ships with devt, single source of truth for defaults.
 *   2. `.devt/config.json`'s `agent_skills.<type>` — per-project override.
 *
 * Returns `{ <agent_type>: [...skill-names...], ... }`. Agents absent from
 * BOTH sources do not appear in the result — callers fall back to "no
 * runtime skill injection beyond the agent's preloaded frontmatter."
 */
function resolveSkills(pluginRoot, config) {
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
    const fromIndex = indexAgents[agent] && Array.isArray(indexAgents[agent].skills)
      ? indexAgents[agent].skills
      : null;
    if (fromIndex) resolved[agent] = fromIndex.slice();
  }
  return resolved;
}

function initWorkflow(task, pluginRoot) {
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
    resolved_skills: resolveSkills(pluginRoot, config),
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
      return initWorkflow(args.join(" "), pluginRoot);
    case "review":
      return initWorkflow(args.join(" ") || "code review", pluginRoot);
    default:
      throw new Error(
        `Unknown init type: ${subcommand}. Use: workflow, review`,
      );
  }
}

module.exports = { run, REQUIRED_DEV_RULES };
