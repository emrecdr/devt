'use strict';

/**
 * Project setup — scaffolds .dev-rules/ from templates and creates .devt.json.
 *
 * Called by /devt:init command via the project-init workflow.
 * The workflow handles the interactive questioning (AskUserQuestion).
 * This module handles the file operations.
 */

const fs = require('fs');
const path = require('path');
const { findProjectRoot } = require('./config.cjs');

const AVAILABLE_TEMPLATES = ['python-fastapi', 'go', 'typescript-node', 'blank'];

function setupProject(templateName, pluginRoot, extraConfig) {
  if (!AVAILABLE_TEMPLATES.includes(templateName)) {
    throw new Error(`Unknown template: ${templateName}. Available: ${AVAILABLE_TEMPLATES.join(', ')}`);
  }

  const projectRoot = findProjectRoot();
  const devRulesDir = path.join(projectRoot, '.dev-rules');
  const stateDir = path.join(projectRoot, '.devt-state');
  const configPath = path.join(projectRoot, '.devt.json');
  const templateDir = path.join(pluginRoot, 'templates', templateName);

  const results = {
    template: templateName,
    project_root: projectRoot,
    files_created: [],
    warnings: []
  };

  // Check if .dev-rules/ already exists
  if (fs.existsSync(devRulesDir)) {
    results.warnings.push('.dev-rules/ already exists — skipping template copy to avoid overwriting');
  } else {
    // Copy template files to .dev-rules/
    copyDirRecursive(templateDir, devRulesDir);
    results.files_created.push('.dev-rules/ (from template: ' + templateName + ')');
  }

  // Create .devt-state/ directory
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
    results.files_created.push('.devt-state/');
  }

  // Create learning-playbook.md if it doesn't exist
  const playbookPath = path.join(projectRoot, 'learning-playbook.md');
  if (!fs.existsSync(playbookPath)) {
    const playbookHeader = [
      '# Learning Playbook',
      '',
      'Lessons extracted from development workflows. Entries are YAML blocks separated by `---`.',
      'Managed by /devt:retro (extraction) and /devt:curator (curation).',
      '',
      '---',
      ''
    ].join('\n');
    fs.writeFileSync(playbookPath, playbookHeader);
    results.files_created.push('learning-playbook.md');
  }

  // Create .devt.json if it doesn't exist
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      model_profile: 'balanced',
      git: {
        provider: null,
        workspace: null,
        slug: null,
        primary_branch: 'main',
        contributors: []
      }
    };
    // Merge any extra config from the interactive wizard
    const finalConfig = extraConfig ? { ...defaultConfig, ...extraConfig } : defaultConfig;
    fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2) + '\n');
    results.files_created.push('.devt.json');
  } else {
    results.warnings.push('.devt.json already exists — skipping');
  }

  // Add .devt-state/ to .gitignore if not already there
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes('.devt-state')) {
      fs.appendFileSync(gitignorePath, '\n# devt workflow state\n.devt-state/\n');
      results.files_created.push('.gitignore (appended .devt-state/)');
    }
  }

  return results;
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function run(args, pluginRoot) {
  let templateName = 'blank';
  let extraConfig = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--template' && args[i + 1]) {
      templateName = args[i + 1];
      i++;
    } else if (args[i] === '--config' && args[i + 1]) {
      try {
        extraConfig = JSON.parse(args[i + 1]);
      } catch {
        throw new Error('--config value must be valid JSON');
      }
      i++;
    }
  }

  return setupProject(templateName, pluginRoot, extraConfig);
}

module.exports = { run, AVAILABLE_TEMPLATES };
