'use strict';

/**
 * Config resolution — 3-level merge: hardcoded defaults ← global ← project.
 *
 * Locations:
 *   defaults: hardcoded in this module
 *   global:   ~/.devt/defaults.json
 *   project:  .devt.json (in project root)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  model_profile: 'balanced',
  git: {
    provider: null,
    workspace: null,
    slug: null,
    primary_branch: 'main',
    contributors: []
  },
  arch_scanner: {
    command: null,
    report_dir: 'docs/reports'
  }
};

function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.devt.json')) ||
        fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function getMergedConfig() {
  const globalPath = path.join(os.homedir(), '.devt', 'defaults.json');
  const projectRoot = findProjectRoot();
  const projectPath = path.join(projectRoot, '.devt.json');

  const globalConfig = readJsonSafe(globalPath);
  const projectConfig = readJsonSafe(projectPath);

  return deepMerge(deepMerge(DEFAULTS, globalConfig), projectConfig);
}

function setConfig(key, value) {
  const projectRoot = findProjectRoot();
  const projectPath = path.join(projectRoot, '.devt.json');
  const existing = readJsonSafe(projectPath);

  // Support dot notation: "git.provider" → {git: {provider: value}}
  const keys = key.split('.');
  let obj = existing;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') {
      obj[keys[i]] = {};
    }
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;

  fs.writeFileSync(projectPath, JSON.stringify(existing, null, 2) + '\n');
  return { ok: true, path: projectPath, key, value };
}

function run(subcommand, args) {
  switch (subcommand) {
    case 'get':
      return getMergedConfig();
    case 'set': {
      const [keyValue] = args;
      if (!keyValue || !keyValue.includes('=')) {
        throw new Error('Usage: config set key=value');
      }
      const eqIndex = keyValue.indexOf('=');
      const key = keyValue.slice(0, eqIndex);
      const value = keyValue.slice(eqIndex + 1);
      return setConfig(key, value);
    }
    default:
      throw new Error(`Unknown config subcommand: ${subcommand}. Use: get, set`);
  }
}

module.exports = { run, getMergedConfig, findProjectRoot };
