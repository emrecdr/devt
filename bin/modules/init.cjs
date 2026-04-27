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
const { sanitizeForPrompt, scanForInjection, validatePath } = require("./security.cjs");

const REQUIRED_DEV_RULES = [
  "coding-standards.md",
  "testing-patterns.md",
  "quality-gates.md",
  "architecture.md",
];

const MAX_TASK_LENGTH = 50_000;

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
    config,
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
