'use strict';

/**
 * State management — .devt-state/ directory operations.
 *
 * .devt-state/ is the shared state bus between workflow steps and agents.
 * Each file is written by one agent, read by subsequent agents.
 */

const fs = require('fs');
const path = require('path');
const { findProjectRoot } = require('./config.cjs');

const STATE_DIR = '.devt-state';
const WORKFLOW_FILE = 'workflow.yaml';

function getStateDir() {
  return path.join(findProjectRoot(), STATE_DIR);
}

function getWorkflowPath() {
  return path.join(getStateDir(), WORKFLOW_FILE);
}

function ensureStateDir() {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Simple YAML-like parser for workflow state.
 * Handles flat key: value pairs and basic nesting.
 */
function parseSimpleYaml(content) {
  const result = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (value === 'true') result[key] = true;
      else if (value === 'false') result[key] = false;
      else if (value === 'null') result[key] = null;
      else if (/^\d+$/.test(value)) result[key] = parseInt(value, 10);
      else result[key] = value;
    }
  }
  return result;
}

function serializeSimpleYaml(obj) {
  return Object.entries(obj)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n') + '\n';
}

function readState() {
  const filePath = getWorkflowPath();
  if (!fs.existsSync(filePath)) {
    return { active: false, phase: null, tier: null, iteration: 0 };
  }
  return parseSimpleYaml(fs.readFileSync(filePath, 'utf8'));
}

function acquireLock() {
  const lockFile = path.join(getStateDir(), '.lock');
  const maxWait = 3000; // 3 seconds
  const start = Date.now();
  while (fs.existsSync(lockFile) && (Date.now() - start) < maxWait) {
    // Busy wait (acceptable for short operations)
    const waitUntil = Date.now() + 50;
    while (Date.now() < waitUntil) {} // spin
  }
  fs.writeFileSync(lockFile, String(process.pid));
  return lockFile;
}

function releaseLock(lockFile) {
  try { fs.unlinkSync(lockFile); } catch {}
}

function updateState(keyValues) {
  ensureStateDir();
  const lockFile = acquireLock();

  try {
    const current = readState();
    for (const kv of keyValues) {
      const eqIndex = kv.indexOf('=');
      if (eqIndex === -1) continue;
      const key = kv.slice(0, eqIndex);
      let value = kv.slice(eqIndex + 1);
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value === 'null') value = null;
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      current[key] = value;
    }
    // Atomic write: temp file + rename
    const tmpFile = getWorkflowPath() + '.tmp';
    fs.writeFileSync(tmpFile, serializeSimpleYaml(current));
    fs.renameSync(tmpFile, getWorkflowPath());
    return current;
  } finally {
    releaseLock(lockFile);
  }
}

function resetState() {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) {
    return { ok: true, cleaned: dir };
  }
  const lockFile = acquireLock();
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file === '.lock') continue; // Don't remove our own lock
      fs.unlinkSync(path.join(dir, file));
    }
  } finally {
    releaseLock(lockFile);
  }
  return { ok: true, cleaned: dir };
}

function checkWorkflowLock() {
  const state = readState();
  if (state.active) {
    return { locked: true, phase: state.phase, tier: state.tier,
             message: 'A workflow is already active. Run /devt:cancel-workflow first, or wait for it to complete.' };
  }
  return { locked: false };
}

function run(subcommand, args) {
  switch (subcommand) {
    case 'read':
      return readState();
    case 'update':
      return updateState(args);
    case 'reset':
      return resetState();
    default:
      throw new Error(`Unknown state subcommand: ${subcommand}. Use: read, update, reset`);
  }
}

module.exports = { run, readState, updateState, resetState, checkWorkflowLock, getStateDir, ensureStateDir };
