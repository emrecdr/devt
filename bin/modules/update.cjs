"use strict";

/**
 * Update check — compares local plugin version against GitHub remote.
 *
 * Zero dependencies. Uses Node.js built-in https module.
 * Caches results to avoid hitting GitHub API on every session.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const os = require("os");

const CACHE_DIR = path.join(os.tmpdir(), "devt-cache");
const CACHE_FILE = path.join(CACHE_DIR, "update-check.json");
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function getLocalVersion(pluginRoot) {
  // Primary: plugin.json manifest
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
    );
    if (manifest.version) return manifest.version;
  } catch {
    // Fall through to VERSION file
  }
  // Fallback: VERSION file
  try {
    return fs.readFileSync(path.join(pluginRoot, "VERSION"), "utf8").trim();
  } catch {
    return "0.0.0";
  }
}

function getRepoUrl(pluginRoot) {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
    );
    const repo = manifest.repository || "";
    // Extract owner/repo from URL or direct value
    const match = repo.match(/github\.com\/([^/]+\/[^/]+)/);
    if (match) return match[1].replace(/\.git$/, "");
    // If it's already owner/repo format
    if (repo.match(/^[^/]+\/[^/]+$/)) return repo;
    return null;
  } catch {
    return null;
  }
}

function fetchRemoteVersion(repo) {
  return new Promise((resolve, reject) => {
    const url = `https://raw.githubusercontent.com/${repo}/main/.claude-plugin/plugin.json`;
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          const manifest = JSON.parse(data);
          resolve(manifest.version || "0.0.0");
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function fetchChangelog(repo) {
  return new Promise((resolve) => {
    const url = `https://raw.githubusercontent.com/${repo}/main/CHANGELOG.md`;
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve(null); // Changelog is optional
          return;
        }
        resolve(data);
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function compareVersions(a, b) {
  // Strip pre-release/build metadata (e.g., "0.2.2-rc1" → "0.2.2")
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  // Same numeric version — pre-release is lower than release (1.0.0-rc1 < 1.0.0)
  const aPre = a.includes("-");
  const bPre = b.includes("-");
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  return 0;
}

function readCache() {
  try {
    const content = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (Date.now() - content.checked < CACHE_TTL_MS) {
      return content;
    }
  } catch {
    // Cache miss or corrupt — will re-check
  }
  return null;
}

function writeCache(data) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch {
    // Non-critical — cache write failure is acceptable
  }
}

function clearCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}

function checkDirtyTree(pluginRoot) {
  if (!fs.existsSync(path.join(pluginRoot, ".git"))) {
    return { dirty: false, type: "not-git" };
  }
  try {
    const { execFileSync } = require("child_process");
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: pluginRoot,
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (!status) return { dirty: false };
    const files = status.split("\n").map((l) => l.trim());
    return { dirty: true, files: files, count: files.length };
  } catch {
    return { dirty: false, error: "could not check" };
  }
}

function parseChangelogBetween(changelog, fromVersion, toVersion) {
  if (!changelog) return null;
  const lines = changelog.split("\n");
  const entries = [];
  let capturing = false;
  for (const line of lines) {
    // Match version headers like "## [0.2.0]" or "## 0.2.0" or "# v0.2.0"
    const versionMatch = line.match(/^#{1,2}\s+\[?v?(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      const ver = versionMatch[1];
      if (compareVersions(ver, fromVersion) > 0 && compareVersions(ver, toVersion) <= 0) {
        capturing = true;
        entries.push(line);
        continue;
      }
      if (capturing) break; // Past our range
    }
    if (capturing) entries.push(line);
  }
  return entries.length > 0 ? entries.join("\n").trim() : null;
}

async function check(pluginRoot, force) {
  const local = getLocalVersion(pluginRoot);
  const repo = getRepoUrl(pluginRoot);

  if (!repo) {
    return {
      update_available: false,
      installed: local,
      latest: local,
      checked: Date.now(),
      error: "No repository URL in plugin.json",
    };
  }

  // Check cache first (skip if force)
  if (!force) {
    const cached = readCache();
    if (cached && cached.installed === local) {
      return cached;
    }
  }

  try {
    const remote = await fetchRemoteVersion(repo);
    const cmp = compareVersions(local, remote);
    const result = {
      update_available: cmp < 0,
      ahead: cmp > 0,
      installed: local,
      latest: remote,
      repo: repo,
      checked: Date.now(),
    };
    writeCache(result);
    return result;
  } catch (e) {
    return {
      update_available: false,
      ahead: false,
      installed: local,
      latest: "unknown",
      checked: Date.now(),
      error: e.message,
    };
  }
}

function detectDefaultBranch(pluginRoot) {
  try {
    const { execFileSync } = require("child_process");
    // Check what HEAD's upstream tracks
    const branch = execFileSync(
      "git", ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: pluginRoot, encoding: "utf8", timeout: 5000 },
    ).trim();
    if (branch && branch !== "HEAD") return branch;
  } catch {
    // Fall through
  }
  return "main";
}

function detectInstallType(pluginRoot) {
  let resolved;
  try {
    resolved = fs.realpathSync(pluginRoot);
  } catch {
    return { type: "unknown", update_command: null, error: "cannot resolve plugin path" };
  }

  // Check if inside ~/.claude/plugins/cache/ (marketplace or plugin-add install)
  const cacheDir = path.join(os.homedir(), ".claude", "plugins", "cache");
  if (resolved.startsWith(cacheDir)) {
    // Check installed_plugins.json for the entry
    try {
      const installed = JSON.parse(
        fs.readFileSync(
          path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json"),
          "utf8",
        ),
      );
      for (const [key, entries] of Object.entries(installed.plugins || {})) {
        for (const entry of entries) {
          try {
            if (entry.installPath && fs.realpathSync(entry.installPath) === resolved) {
              return {
                type: "plugin",
                plugin_id: key,
                scope: entry.scope || "user",
                update_command: `claude plugin update ${key.split("@")[0]}`,
              };
            }
          } catch {
            // installPath may not exist — skip
          }
        }
      }
    } catch {
      // Fall through
    }
    return {
      type: "plugin",
      plugin_id: "devt",
      scope: "user",
      update_command: "claude plugin update devt",
    };
  }

  // Check if it's a git repo (cloned or development copy)
  if (fs.existsSync(path.join(pluginRoot, ".git"))) {
    const branch = detectDefaultBranch(pluginRoot);
    try {
      const { execFileSync } = require("child_process");
      const remote = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd: pluginRoot,
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      return {
        type: "git",
        remote: remote,
        branch: branch,
        update_command: `git pull origin ${branch}`,
      };
    } catch {
      return { type: "git", remote: null, branch: branch, update_command: `git pull` };
    }
  }

  return { type: "unknown", update_command: null };
}

async function run(subcommand, args, pluginRoot) {
  const force = args.includes("--force");
  switch (subcommand) {
    case "check":
      return await check(pluginRoot, force);
    case "local-version":
      return { version: getLocalVersion(pluginRoot) };
    case "install-type":
      return detectInstallType(pluginRoot);
    case "dirty":
      return checkDirtyTree(pluginRoot);
    case "status": {
      // Combined: install-type + dirty + version in one call
      const install = detectInstallType(pluginRoot);
      const dirty = checkDirtyTree(pluginRoot);
      const version = getLocalVersion(pluginRoot);
      // Destructure to avoid key collision: dirty.type ("not-git") would overwrite install.type ("plugin")
      const { type: _dirtyType, ...dirtyFields } = dirty;
      return { ...install, ...dirtyFields, version };
    }
    case "clear-cache":
      return clearCache();
    case "changelog": {
      const repo = getRepoUrl(pluginRoot);
      if (!repo) return { error: "No repository URL" };
      const log = await fetchChangelog(repo);
      const local = getLocalVersion(pluginRoot);
      // Try to parse relevant entries; fall back to first 40 lines
      const parsed = log ? parseChangelogBetween(log, local, "99.99.99") : null;
      return {
        changelog: parsed || (log ? log.split("\n").slice(0, 40).join("\n") : null),
        full_available: !!log,
      };
    }
    default:
      throw new Error(
        `Unknown update subcommand: ${subcommand}. Use: check, status, local-version, install-type, dirty, clear-cache, changelog`,
      );
  }
}

module.exports = { run, check, getLocalVersion, getRepoUrl, compareVersions, clearCache };
