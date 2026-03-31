#!/usr/bin/env node
"use strict";

/**
 * Hook runner — resolves plugin root, checks profile flags, dispatches hooks.
 *
 * Replaces the bash polyglot run-hook.cmd with a cross-platform Node.js runner.
 *
 * Usage: node run-hook.js <script.sh> [args...]
 *
 * Environment controls:
 *   DEVT_HOOK_PROFILE=minimal|standard|full  (default: standard)
 *   DEVT_DISABLED_HOOKS=hook1,hook2           (disable specific hooks by script name)
 *
 * Hook profiles:
 *   minimal  — session-start, stop only (essential lifecycle)
 *   standard — all hooks except heavy analysis (default)
 *   full     — everything including prompt-guard and context-monitor
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const VALID_PROFILES = new Set(["minimal", "standard", "full"]);

// Which hooks run at which profile level
const HOOK_PROFILES = {
  "session-start.sh": ["minimal", "standard", "full"],
  "stop.sh": ["minimal", "standard", "full"],
  "workflow-context-injector.sh": ["standard", "full"],
  "subagent-status.sh": ["standard", "full"],
  "context-monitor.sh": ["full"],
  "prompt-guard.sh": ["full"],
};

function getProfile() {
  const raw = (process.env.DEVT_HOOK_PROFILE || "standard").trim().toLowerCase();
  return VALID_PROFILES.has(raw) ? raw : "standard";
}

function getDisabledHooks() {
  const raw = process.env.DEVT_DISABLED_HOOKS || "";
  if (!raw.trim()) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

function isHookEnabled(scriptName) {
  // Check disabled list
  if (getDisabledHooks().has(scriptName)) return false;

  // Check profile
  const profile = getProfile();
  const allowed = HOOK_PROFILES[scriptName];
  if (!allowed) return true; // Unknown hooks run at all profiles
  return allowed.includes(profile);
}

function resolvePluginRoot() {
  const verify = (p) => fs.existsSync(path.join(p, ".claude-plugin", "plugin.json"));

  // 1. Derive from this script's location (most reliable for hooks)
  const fromScript = path.resolve(__dirname, "..");
  if (verify(fromScript)) return persistRoot(fromScript);

  // 2. CLAUDE_PLUGIN_ROOT env var
  const envRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (envRoot && verify(path.resolve(envRoot))) return persistRoot(path.resolve(envRoot));

  // 3. Repo-local installation: <projectDir>/.claude/devt/
  try {
    const cwd = process.cwd();
    const localPath = path.join(cwd, ".claude", "devt");
    if (verify(localPath)) return persistRoot(localPath);
  } catch {
    // cwd not accessible
  }

  // 4. Fallback
  return persistRoot(fromScript);
}

function persistRoot(pluginRoot) {
  // Write resolved path to temp file so workflow bash commands can read it
  try {
    const tmpDir = path.join(require("os").tmpdir(), "devt-cache");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "plugin-root"), pluginRoot);
  } catch {
    // Non-critical — session-start context is the primary mechanism
  }
  return pluginRoot;
}

function main() {
  const args = process.argv.slice(2);
  const scriptName = args[0];

  if (!scriptName) {
    process.stderr.write(JSON.stringify({ error: "No hook script specified" }) + "\n");
    process.exit(1);
  }

  // Check if hook is enabled
  if (!isHookEnabled(scriptName)) {
    // Pass through stdin to stdout (hook skipped)
    try {
      const stdin = fs.readFileSync(0, "utf8");
      if (stdin) process.stdout.write(stdin);
    } catch {
      // No stdin — fine
    }
    process.exit(0);
  }

  const pluginRoot = resolvePluginRoot();
  const hookPath = path.join(pluginRoot, "hooks", scriptName);

  if (!fs.existsSync(hookPath)) {
    process.stderr.write(JSON.stringify({ error: `Hook script not found: ${scriptName}` }) + "\n");
    process.exit(1);
  }

  // Read stdin for hook input
  let stdin = "";
  try {
    stdin = fs.readFileSync(0, "utf8");
  } catch {
    // No stdin
  }

  // Dispatch to the hook script
  const hookArgs = args.slice(1);
  const result = spawnSync("bash", [hookPath, ...hookArgs], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, PLUGIN_ROOT: pluginRoot },
    cwd: process.cwd(),
    timeout: 30000,
  });

  if (result.error) {
    // Spawn failed (ENOENT, EACCES) or process killed (timeout/signal)
    const reason = result.signal ? `killed by ${result.signal}` : result.error.message;
    process.stderr.write(JSON.stringify({ error: `Hook ${scriptName} failed: ${reason}` }) + "\n");
    process.exit(1);
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 0);
}

main();
