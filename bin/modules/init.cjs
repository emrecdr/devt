'use strict';

/**
 * Compound init — one call returns ALL context needed for a workflow.
 *
 * GSD pattern: every workflow makes ONE CLI call that returns a JSON blob
 * with models, config, phase info, file paths, and file existence checks.
 * This is the single biggest token-saver.
 */

const fs = require('fs');
const path = require('path');
const { getMergedConfig, findProjectRoot } = require('./config.cjs');
const { getModels } = require('./model-profiles.cjs');
const { readState, checkWorkflowLock, ensureStateDir } = require('./state.cjs');

const REQUIRED_DEV_RULES = ['coding-standards.md', 'testing-patterns.md', 'quality-gates.md'];

function initWorkflow(task, pluginRoot) {
  const projectRoot = findProjectRoot();
  const config = getMergedConfig();
  const models = getModels(config.model_profile || 'balanced', config.model_overrides);
  const state = readState();
  const workflowLock = checkWorkflowLock();
  const devRulesDir = path.join(projectRoot, '.dev-rules');
  const devRulesFound = fs.existsSync(devRulesDir);

  // Scan .dev-rules/ for available files
  let devRulesFiles = [];
  if (devRulesFound) {
    devRulesFiles = scanDevRules(devRulesDir);
  }

  // Check which required .dev-rules/ files are missing
  const missingRules = [];
  if (devRulesFound) {
    for (const file of REQUIRED_DEV_RULES) {
      if (!fs.existsSync(path.join(devRulesDir, file))) {
        missingRules.push(file);
      }
    }
  }

  // Check for CLAUDE.md
  const claudeMdExists = fs.existsSync(path.join(projectRoot, 'CLAUDE.md'));

  // Check for .devt.json
  const configExists = fs.existsSync(path.join(projectRoot, '.devt.json'));

  // Ensure state directory exists
  ensureStateDir();

  // Collect warnings for missing project setup
  const warnings = [];
  if (!devRulesFound) {
    warnings.push('.dev-rules/ not found. Run /devt:init to set up project.');
  }
  if (!configExists) {
    warnings.push('.devt.json not found. Run /devt:init to configure project.');
  }

  return {
    task: task || null,
    project_root: projectRoot,
    plugin_root: pluginRoot,
    config,
    models,
    state,
    workflow_lock: workflowLock,
    dev_rules: {
      found: devRulesFound,
      path: devRulesDir,
      files: devRulesFiles,
      missing_rules: missingRules
    },
    claude_md_exists: claudeMdExists,
    config_exists: configExists,
    state_dir: path.join(projectRoot, '.devt-state'),
    warnings
  };
}

function scanDevRules(dir, prefix) {
  const files = [];
  prefix = prefix || '';
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...scanDevRules(path.join(dir, entry.name), relPath));
      } else {
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
    case 'workflow':
      return initWorkflow(args.join(' '), pluginRoot);
    case 'review':
      return initWorkflow(args.join(' ') || 'code review', pluginRoot);
    case 'quality':
      return initWorkflow(args.join(' ') || 'quality gates', pluginRoot);
    default:
      throw new Error(`Unknown init type: ${subcommand}. Use: workflow, review, quality`);
  }
}

module.exports = { run };
