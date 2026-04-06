"use strict";

/**
 * Config resolution — 3-level merge: hardcoded defaults ← global ← project.
 *
 * Locations:
 *   defaults: hardcoded in this module
 *   global:   ~/.devt/defaults.json
 *   project:  .devt/config.json (in project root)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const DEFAULTS = {
  model_profile: "quality",
  git: {
    provider: null,
    workspace: null,
    slug: null,
    primary_branch: "main",
    contributors: [],
  },
  arch_scanner: {
    command: null,
    report_dir: "docs/reports",
  },
  workflow: {
    docs: true,
    retro: true,
    verification: true,
    autoskill: true,
    regression_baseline: true,
  },
};

let _cachedProjectRoot = null;

function findProjectRoot() {
  if (_cachedProjectRoot) return _cachedProjectRoot;
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, ".devt")) ||
      fs.existsSync(path.join(dir, ".git"))
    ) {
      _cachedProjectRoot = dir;
      return dir;
    }
    dir = path.dirname(dir);
  }
  // No project markers found — fall back to cwd (may be outside a project)
  process.stderr.write(
    JSON.stringify({ warning: "No .devt/ or .git found; using cwd as project root: " + process.cwd() }) + "\n"
  );
  _cachedProjectRoot = process.cwd();
  return _cachedProjectRoot;
}

function readJsonSafe(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (e) {
    if (e.code === "ENOENT") return {}; // File not found — expected
    if (e instanceof SyntaxError) {
      process.stderr.write(
        JSON.stringify({ warning: "Corrupt JSON in " + filePath + ": " + e.message }) + "\n"
      );
    }
    return {};
  }
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = Array.isArray(source[key]) ? [...source[key]] : source[key];
    }
  }
  return result;
}

function getMergedConfig() {
  const globalPath = path.join(os.homedir(), ".devt", "defaults.json");
  const projectRoot = findProjectRoot();
  const projectPath = path.join(projectRoot, ".devt", "config.json");

  const globalConfig = readJsonSafe(globalPath);
  const projectConfig = readJsonSafe(projectPath);

  // Warn about unknown top-level keys in project config (catches typos like "agent_skils")
  const knownKeys = new Set(Object.keys(DEFAULTS));
  // Also allow common extension keys that aren't in DEFAULTS
  knownKeys.add("model_overrides");
  knownKeys.add("agent_skills");
  const unknownKeys = Object.keys(projectConfig).filter((k) => !knownKeys.has(k));
  if (unknownKeys.length > 0) {
    process.stderr.write(
      JSON.stringify({
        warning: `Unknown config key(s) in .devt/config.json: ${unknownKeys.join(", ")} — these will be ignored. Valid keys: ${[...knownKeys].sort().join(", ")}`,
      }) + "\n",
    );
  }

  return deepMerge(deepMerge(DEFAULTS, globalConfig), projectConfig);
}

function setConfig(key, value) {
  const projectRoot = findProjectRoot();
  const projectPath = path.join(projectRoot, ".devt", "config.json");
  const existing = readJsonSafe(projectPath);

  // Support dot notation: "git.provider" → {git: {provider: value}}
  const keys = key.split(".");
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k)) {
      throw new Error("Forbidden key segment: " + k);
    }
  }
  let obj = existing;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]] || typeof obj[keys[i]] !== "object") {
      obj[keys[i]] = {};
    }
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;

  // Atomic write: temp file + rename to prevent corruption on crash
  const tmpPath = projectPath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2) + "\n");
  fs.renameSync(tmpPath, projectPath);
  return { ok: true, path: projectPath, key, value };
}

function run(subcommand, args) {
  switch (subcommand) {
    case "get":
      return getMergedConfig();
    case "set": {
      const [keyValue] = args;
      if (!keyValue || !keyValue.includes("=")) {
        throw new Error("Usage: config set key=value");
      }
      const eqIndex = keyValue.indexOf("=");
      const key = keyValue.slice(0, eqIndex);
      const raw = keyValue.slice(eqIndex + 1);
      // Coerce CLI string values to proper types
      let value = raw;
      if (raw === "true") value = true;
      else if (raw === "false") value = false;
      else if (raw === "null") value = null;
      else if (/^\d+$/.test(raw)) value = parseInt(raw, 10);
      return setConfig(key, value);
    }
    default:
      throw new Error(
        `Unknown config subcommand: ${subcommand}. Use: get, set`,
      );
  }
}

module.exports = { run, getMergedConfig, findProjectRoot, deepMerge, DEFAULTS };
