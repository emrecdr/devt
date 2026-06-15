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
  "read-before-edit-guard.sh": ["standard", "full"],
  // Two-Tier Pre-Flight enforcement hooks.
  // pre-flight-guard.sh: PreToolUse on Edit/Write — verifies scratchpad has a
  //   PREFLIGHT line covering the target file. memory.preflight_mode controls
  //   warn vs block (off = no-op).
  // memory-auto-index.sh: PostToolUse on Edit/Write — rebuilds the FTS5 index
  //   when an .devt/memory/**.md file is touched, so subsequent queries are fresh.
  "pre-flight-guard.sh": ["standard", "full"],
  "memory-auto-index.sh": ["standard", "full"],
  // bash-guard.sh: PreToolUse on Bash — denies filesystem-wipe and --no-verify
  // patterns with zero legitimate dev use. Same profile coverage as pre-flight-guard;
  // kill switch via DEVT_DISABLED_HOOKS=bash-guard.sh.
  "bash-guard.sh": ["standard", "full"],
  // subagent dispatch's prompt bytes or scope_hint path count exceeds the
  // configured cap (.devt/config.json::dispatch.{max_prompt_bytes,max_files_hint}).
  // Forensic trail appended to .devt/state/dispatch-warnings.jsonl. Never blocks.
  // dispatch-hygiene-guard.sh: PreToolUse on Task — advisory warning when a
  // devt:* subagent is dispatched WITHOUT the workflow-managed context blocks
  // (<scope_trust>, <scope_hint>, <memory_signal>). Detects "rogue orchestration"
  // where the orchestrator hand-rolls Task() calls bypassing /devt:review and
  // strips all the Wave 1-4 graphify protections. Forensic trail tagged
  // source: "raw_dispatch" in dispatch-warnings.jsonl. Never blocks.
  "dispatch-hygiene-guard.sh": ["standard", "full"],
  // task-truncation-detector.sh: PostToolUse on Task — emits one
  // dispatch-warnings.jsonl record per Task call tagged
  // source: "task_output_bytes" with the sub-agent's return byte count.
  // Records the comparison against telemetry.task_truncation_warn_bytes so
  // future calibration can re-bucket historical records. Surfaces an
  // additionalContext advisory only on near-cliff crossings. Never blocks.
  "task-truncation-detector.sh": ["standard", "full"],
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
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
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

function findProjectStateDir() {
  // Upward-search for .devt/state/ from cwd. Mirrors the same pattern hook
  // scripts use internally — keeps the trace file colocated with the project's
  // forensic logs rather than devt's plugin root.
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, ".devt", "state");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function appendTrace(scriptName, fields) {
  if (process.env.DEVT_HOOK_TRACE === "0") return;
  try {
    const stateDir = findProjectStateDir();
    if (!stateDir) return;
    const traceDir = path.join(stateDir, "hook-trace");
    if (!fs.existsSync(traceDir)) fs.mkdirSync(traceDir, { recursive: true });
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      script: scriptName,
      ...fields,
    });
    fs.appendFileSync(path.join(traceDir, "run-hook.jsonl"), record + "\n");
  } catch {
    // Trace failure must never affect hook delivery.
  }
}

function main() {
  const args = process.argv.slice(2);
  const scriptName = args[0];

  if (!scriptName) {
    process.stderr.write(JSON.stringify({ error: "No hook script specified" }) + "\n");
    process.exit(1);
  }

  const profile = getProfile();
  const enabled = isHookEnabled(scriptName);

  // Check if hook is enabled
  if (!enabled) {
    // Pass through stdin to stdout (hook skipped)
    let stdinPassthrough = "";
    try {
      stdinPassthrough = fs.readFileSync(0, "utf8");
      if (stdinPassthrough) process.stdout.write(stdinPassthrough);
    } catch {
      // No stdin — fine
    }
    appendTrace(scriptName, {
      profile,
      enabled: false,
      stdin_bytes: Buffer.byteLength(stdinPassthrough, "utf8"),
      exit: 0,
      reason: "disabled_by_profile_or_env",
    });
    process.exit(0);
  }

  const pluginRoot = resolvePluginRoot();
  const hookPath = path.join(pluginRoot, "hooks", scriptName);

  if (!fs.existsSync(hookPath)) {
    appendTrace(scriptName, { profile, enabled: true, exit: 1, reason: "script_not_found" });
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
    appendTrace(scriptName, {
      profile,
      enabled: true,
      stdin_bytes: Buffer.byteLength(stdin, "utf8"),
      exit: 1,
      reason: `spawn_failed: ${reason}`,
    });
    process.stderr.write(JSON.stringify({ error: `Hook ${scriptName} failed: ${reason}` }) + "\n");
    process.exit(1);
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  appendTrace(scriptName, {
    profile,
    enabled: true,
    stdin_bytes: Buffer.byteLength(stdin, "utf8"),
    stdout_bytes: Buffer.byteLength(result.stdout || "", "utf8"),
    stderr_bytes: Buffer.byteLength(result.stderr || "", "utf8"),
    exit: result.status ?? 0,
  });

  process.exit(result.status ?? 0);
}

main();
