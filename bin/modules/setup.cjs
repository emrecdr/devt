"use strict";

/**
 * Project setup — scaffolds .devt/rules/ from templates and creates .devt/config.json.
 *
 * Called by /devt:init command via the project-init workflow.
 * The workflow handles the interactive questioning (AskUserQuestion).
 * This module handles the file operations.
 *
 * All artifacts go under .devt/ in the project root:
 * .devt/config.json — project configuration
 * .devt/rules/ — coding standards, testing patterns, etc.
 * .devt/state/ — workflow state (gitignored)
 * .devt/memory/lessons/ — operational lessons (LES-NNNN frontmatter docs)
 * .devt/memory/{decisions,concepts,flows,rejected}/ — architectural docs
 * .devt/memory/index.db — unified FTS5 index (regenerable from .md files)
 */

const fs = require("fs");
const path = require("path");
const { findProjectRoot, deepMerge } = require("./config.cjs");
const { validatePath, safeJsonParse } = require("./security.cjs");
const { atomicWriteFileSync, atomicWriteJsonSync } = require("./io.cjs");
const { probeBinary: probeGraphifyBinary, logProbeFailure } = require("./graphify.cjs");

/**
 * Reject filesystem entry names that could break out of their parent directory.
 * Mirrors the guard in init.cjs scanDevRules — separators, traversal markers,
 * null bytes, and symlinks are dropped before any path.join.
 */
function isUnsafeEntryName(name, isSymlink) {
  return (
    !name ||
    typeof name !== "string" ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name === "." ||
    name === ".." ||
    isSymlink === true
  );
}

const AVAILABLE_TEMPLATES = [
  "python-fastapi",
  "go",
  "typescript-node",
  "vue-bootstrap",
  "blank",
];

const STACK_MARKERS = {
  "python-fastapi": ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"],
  "go": ["go.mod", "go.sum"],
  "typescript-node": ["tsconfig.json"],
  "vue-bootstrap": ["vite.config.ts", "vite.config.js", "vue.config.js"],
};

function detectStack(projectRoot) {
  const detected = [];
  for (const [template, markers] of Object.entries(STACK_MARKERS)) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(projectRoot, marker))) {
        detected.push({ template, marker });
        break;
      }
    }
  }
  return detected;
}

function detectGitRemote(projectRoot) {
  try {
    const { execFileSync } = require("child_process");
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const result = { remote };

    if (remote.includes("github.com")) result.provider = "github";
    else if (remote.includes("bitbucket.org")) result.provider = "bitbucket";
    else if (remote.includes("gitlab.com") || remote.includes("gitlab")) result.provider = "gitlab";

    const match = remote.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (match) {
      result.workspace = match[1];
      result.slug = match[2];
    }

    const detected = detectPrimaryBranch(projectRoot, execFileSync);
    if (detected) {
      result.primary_branch = detected.value;
      if (detected.low_confidence) result.primary_branch_low_confidence = true;
      if (detected.detection_source) result.primary_branch_source = detected.detection_source;
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Resolve the project's integration branch by walking a fallback chain.
 * Returns { value, detection_source, low_confidence? }.
 *
 * Chain order:
 * 1. origin/HEAD symref — canonical answer (set on `git clone`, sometimes stale)
 * 2. init.defaultBranch — explicit user/local config
 * 3. Common-name heuristic — `development`, `develop`, `main`, `master`, `trunk` if present on origin
 * 4. Current branch — last-resort, marked low_confidence (callers should escalate)
 */
function detectPrimaryBranch(projectRoot, execFileSync) {
  const tryCmd = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      return "";
    }
  };

  // 1. origin/HEAD symref — strip "origin/" prefix
  const symref = tryCmd(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"]);
  if (symref) {
    return { value: symref.replace(/^origin\//, ""), detection_source: "origin_head_symref" };
  }

  // 2. init.defaultBranch (locally-configured or globally-configured)
  const initDefault = tryCmd(["config", "init.defaultBranch"]);
  if (initDefault) {
    return { value: initDefault, detection_source: "init_default_branch" };
  }

  // 3. Heuristic: common integration-branch names that exist on origin
  const remoteList = tryCmd(["branch", "-r", "--format=%(refname:short)"]);
  if (remoteList) {
    const remoteSet = new Set(remoteList.split("\n").map(s => s.trim()).filter(Boolean));
    for (const candidate of ["development", "develop", "main", "master", "trunk"]) {
      if (remoteSet.has(`origin/${candidate}`)) {
        return { value: candidate, detection_source: "common_name_heuristic" };
      }
    }
  }

  // 4. Last resort: current branch — flag as low-confidence so callers can escalate.
  // A branch matching ^(feat|fix|chore|wip|task)/ is almost certainly NOT the integration branch.
  const current = tryCmd(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current && current !== "HEAD") {
    const featureShape = /^(feat|feature|fix|bug|chore|wip|task|hotfix|release)\b[\/-]/i;
    return {
      value: current,
      detection_source: "current_branch",
      low_confidence: featureShape.test(current),
    };
  }

  return null;
}

function setupProject(templateName, pluginRoot, extraConfig, options) {
  if (!AVAILABLE_TEMPLATES.includes(templateName)) {
    throw new Error(
      `Unknown template: ${templateName}. Available: ${AVAILABLE_TEMPLATES.join(", ")}`,
    );
  }

  const projectRoot = findProjectRoot();
  const devtDir = path.join(projectRoot, ".devt");
  const rulesDir = path.join(devtDir, "rules");
  const stateDir = path.join(devtDir, "state");
  const configPath = path.join(devtDir, "config.json");

  // Defense-in-depth: even though templateName is allowlisted above, confirm the
  // resolved templateDir stays within pluginRoot/templates so a future regression
  // in AVAILABLE_TEMPLATES cannot escalate to a path-traversal write.
  const templatesBase = path.join(pluginRoot, "templates");
  const templateCheck = validatePath(templateName, templatesBase);
  if (!templateCheck.safe) {
    throw new Error(
      `Template path escapes templates directory: ${templateName} (${templateCheck.error})`,
    );
  }
  const templateDir = templateCheck.resolved;
  const mode = (options && options.mode) || "create"; // create | update | reinit

  const results = {
    template: templateName,
    project_root: projectRoot,
    files_created: [],
    files_updated: [],
    warnings: [],
    detected_stack: detectStack(projectRoot),
    detected_git: detectGitRemote(projectRoot),
  };

  // Ensure .devt/ base directory exists
  if (!fs.existsSync(devtDir)) {
    fs.mkdirSync(devtDir, { recursive: true });
  }

  // Handle .devt/rules/
  if (fs.existsSync(rulesDir)) {
    if (mode === "reinit") {
      fs.rmSync(rulesDir, { recursive: true, force: true });
      copyDirRecursive(templateDir, rulesDir);
      results.files_created.push(".devt/rules/ (overwritten from template: " + templateName + ")");
    } else if (mode === "update") {
      const added = copyMissingFiles(templateDir, rulesDir);
      if (added.length > 0) {
        results.files_updated.push(...added.map((f) => ".devt/rules/" + f + " (added)"));
      } else {
        results.warnings.push(".devt/rules/ already complete — no files added");
      }
    } else {
      results.warnings.push(
        ".devt/rules/ already exists — use --mode update to add missing files or --mode reinit to overwrite",
      );
    }
  } else {
    copyDirRecursive(templateDir, rulesDir);
    results.files_created.push(".devt/rules/ (from template: " + templateName + ")");
  }

  // Create .devt/state/ directory
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
    results.files_created.push(".devt/state/");
  }

  // Create .devt/memory/{decisions,concepts,flows,rejected}/ directories.
  // Phase 1: scaffolding only — no template seeding. Project owners
  // create their first ADR via /devt:memory promote or by hand.
  const memoryDir = path.join(devtDir, "memory");
  for (const subdir of ["decisions", "concepts", "flows", "rejected", "lessons"]) {
    const target = path.join(memoryDir, subdir);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
      results.files_created.push(`.devt/memory/${subdir}/`);
    }
  }

  // Create or update .devt/config.json
  const defaultConfig = {
    model_profile: "quality",
    git: {
      provider: null,
      workspace: null,
      slug: null,
      primary_branch: "main",
      contributors: [],
    },
  };

  if (!fs.existsSync(configPath) || mode === "reinit") {
    let finalConfig = deepMerge({}, defaultConfig);
    const gitInfo = results.detected_git;
    if (gitInfo) {
      const autoGit = Object.fromEntries(
        ["provider", "workspace", "slug", "primary_branch"]
          .filter((k) => gitInfo[k])
          .map((k) => [k, gitInfo[k]]),
      );
      finalConfig = deepMerge(finalConfig, { git: autoGit });
    }
    // Auto-enable graphify when binary is on PATH at first setup. Without this,
    // a fully-installed Graphify silently sits unused because the schema default
    // is `enabled: false`. The /devt:init workflow has its own AskUserQuestion
    // for the same — this branch covers CLI-direct setup.
    if (probeGraphifyBinary()) {
      finalConfig = deepMerge(finalConfig, { graphify: { enabled: true } });
    }
    if (extraConfig) {
      finalConfig = deepMerge(finalConfig, extraConfig);
    }
    atomicWriteJson(configPath, finalConfig);
    results.files_created.push(".devt/config.json");
  } else if (mode === "update" && extraConfig) {
    const existingRaw = fs.readFileSync(configPath, "utf8");
    const existingParse = safeJsonParse(existingRaw, ".devt/config.json");
    if (!existingParse.ok) throw new Error(existingParse.error);
    const existing = existingParse.value;
    const merged = deepMerge(existing, extraConfig);
    atomicWriteJson(configPath, merged);
    results.files_updated.push(".devt/config.json (merged)");
  } else {
    results.warnings.push(".devt/config.json already exists — skipping");
  }

  // Gitignore manifest:
  // ALWAYS-GITIGNORE — derived/ephemeral state, regenerable from canonical sources:
  // .devt/state/ (per-workflow scratch + preflight-brief.md)
  // .claude/agent-memory/ (per-agent persistent memory)
  // .devt/memory/index.db (FTS5 index — rebuild from .md)
  // graphify-out/cache/ (Graphify ephemeral cache)
  // graphify-out/manifest.json (Graphify per-machine manifest)
  //
  // ALWAYS-COMMIT (NOT in this list — kept by default):
  // .devt/memory/{decisions,concepts,flows,rejected}/*.md team-shared truth
  // graphify-out/graph.json team-shared graph
  // GRAPH_REPORT.md curated overview
  //
  // USER-DECIDES (commented hints — not auto-added):
  // .devt/memory/_suggestions.md (some teams commit for review history)
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const requiredIgnores = [
    { path: ".devt/state/", header: "# devt workflow state" },
    { path: ".claude/agent-memory/", header: "# devt agent persistent memory (per-project)" },
    { path: ".devt/memory/index.db", header: "# devt memory FTS5 index (regenerable from markdown)" },
    { path: ".devt/memory/.auto-index-stamp", header: "# devt memory auto-index debounce marker (transient)" },
    { path: ".devt/memory/_mcp-trace.jsonl", header: "# devt MCP tool-call trace" },
    { path: ".devt/memory/export-*.json", header: "# devt memory export bundles (transient — share via explicit channel)" },
    { path: "graphify-out/cache/", header: "# Graphify ephemeral cache" },
    { path: "graphify-out/manifest.json", header: "# Graphify per-machine manifest" },
  ];
  try {
    let content = fs.readFileSync(gitignorePath, "utf8");
    const appended = [];
    for (const { path: ignorePath, header } of requiredIgnores) {
      if (!content.includes(ignorePath)) {
        const block = `\n${header}\n${ignorePath}\n`;
        fs.appendFileSync(gitignorePath, block);
        content += block;
        appended.push(ignorePath);
      }
    }
    if (appended.length > 0) {
      results.files_updated.push(`.gitignore (appended ${appended.join(", ")})`);
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      const lines = requiredIgnores.flatMap(({ path, header }) => [header, path, ""]);
      atomicWriteFileSync(gitignorePath, lines.join("\n"));
      results.files_created.push(".gitignore");
    }
  }

  // Scaffold project .mcp.json — conditional graphify only.
  // The devt-memory MCP server is registered by the plugin's own .mcp.json at the plugin root
  // (resolved by Claude Code via ${CLAUDE_PLUGIN_ROOT} when devt is loaded as a plugin). Project-level
  // .mcp.json does NOT receive ${CLAUDE_PLUGIN_ROOT} substitution — it is reserved for project-relative
  // MCP servers (graphify) whose args reference the project working directory. claude-mem v13+ self-
  // registers as a Claude Code plugin under ~/.claude/plugins/ — no per-project entry needed.
  const mcpJsonPath = path.join(projectRoot, ".mcp.json");
  const mcpHints = [];
  const probedServers = {};
  // Graphify MCP scaffolding: the upstream `graphify mcp`
  // subcommand was removed; the MCP server is now `python -m graphify.serve <graph.json>`.
  // Two launch paths, probed in priority order:
  // 1. `uv` on PATH + `graphify` on PATH — preferred. Uses `uv run --with graphifyy --with mcp`
  // per graphify's own `__main__._antigravity_install` template; resolves dependencies
  // lazily and works regardless of how graphifyy was installed.
  // 2. `python3 -c "import graphify, mcp"` succeeds — pip / pipx fallback. Direct
  // `python3 -m graphify.serve` works when graphifyy was installed into the system
  // Python via `pip install graphifyy[mcp]` (no `uv` dependency).
  // If neither path resolves but the binary is on PATH, emit an actionable hint pointing at
  // the path most likely to fix the user's setup.
  function probePythonGraphifyMcp(pythonCmd = "python3", timeoutMs = 2000) {
    const args = ["-c", "import graphify, mcp"];
    let probe;
    try {
      probe = require("child_process").spawnSync(pythonCmd, args, { timeout: timeoutMs, stdio: "ignore" });
    } catch (e) {
      logProbeFailure("spawn-error", pythonCmd, args, { error: String(e && e.message || e), timeout_ms: timeoutMs });
      return false;
    }
    if (!probe) {
      logProbeFailure("no-result", pythonCmd, args, { timeout_ms: timeoutMs });
      return false;
    }
    if (probe.signal === "SIGTERM") {
      logProbeFailure("timeout", pythonCmd, args, { timeout_ms: timeoutMs, signal: probe.signal });
      return false;
    }
    if (probe.error) {
      const code = probe.error.code || "";
      const category = code === "ENOENT" ? "not-installed" : "spawn-error";
      logProbeFailure(category, pythonCmd, args, { error: probe.error.message, code, timeout_ms: timeoutMs });
      return false;
    }
    if (probe.status !== 0) {
      logProbeFailure("nonzero-exit", pythonCmd, args, { status: probe.status, signal: probe.signal || null, timeout_ms: timeoutMs });
      return false;
    }
    return true;
  }
  if (probeGraphifyBinary("uv") && probeGraphifyBinary()) {
    probedServers["graphify"] = {
      command: "uv",
      args: ["run", "--with", "graphifyy", "--with", "mcp", "-m", "graphify.serve", "graphify-out/graph.json"],
      env: {},
    };
  } else if (probePythonGraphifyMcp()) {
    probedServers["graphify"] = {
      command: "python3",
      args: ["-m", "graphify.serve", "graphify-out/graph.json"],
      env: {},
    };
  } else if (probeGraphifyBinary()) {
    mcpHints.push("graphify is on PATH but neither `uv` nor a system `python3` with graphifyy+mcp importable was found — either install uv (`curl -LsSf https://astral.sh/uv/install.sh | sh`) for the recommended launch path, or `pip install graphifyy[mcp]` into the system Python for the pip path. Then re-run setup to register the Graphify MCP server.");
  } else {
    mcpHints.push("graphify not detected on PATH — install with `uv tool install graphifyy[mcp]` (recommended) or `pip install graphifyy[mcp]`, then re-run setup to register the Graphify MCP server.");
  }
  if (!fs.existsSync(mcpJsonPath)) {
    if (Object.keys(probedServers).length > 0) {
      atomicWriteJson(mcpJsonPath, { mcpServers: probedServers });
      results.files_created.push(".mcp.json");
    }
  } else {
    try {
      const mcpRaw = fs.readFileSync(mcpJsonPath, "utf8");
      const mcpParse = safeJsonParse(mcpRaw, ".mcp.json");
      if (!mcpParse.ok) throw new Error(mcpParse.error);
      const existing = mcpParse.value;
      if (!existing.mcpServers) existing.mcpServers = {};
      const reconciled = reconcileMcpServers(existing.mcpServers, probedServers, mode);
      if (reconciled.mutated) {
        existing.mcpServers = reconciled.mcpServers;
        atomicWriteJson(mcpJsonPath, existing);
        const added = Object.keys(probedServers).filter(n => !reconciled.replacements.includes(n));
        const parts = [];
        if (added.length) parts.push(`added ${added.join(", ")}`);
        if (reconciled.replacements.length) parts.push(`reconciled ${reconciled.replacements.join(", ")}`);
        results.files_updated.push(`.mcp.json (${parts.join(", ")})`);
      }
    } catch (e) {
      results.warnings.push(`.mcp.json present but unreadable: ${e.message}`);
    }
  }
  if (mcpHints.length > 0) {
    results.warnings.push(...mcpHints);
  }

  // Post-commit hook installation.
  // Two paths based on whether Graphify is enabled:
  // GRAPHIFY ENABLED + binary present:
  // We do NOT install our hook. We surface a hint suggesting `graphify hook install`,
  // which registers Graphify's own post-commit hook (covers stale symbols + graph rebuild).
  // GRAPHIFY DISABLED OR ABSENT:
  // Install hooks/post-commit-validate.sh as the project's .git/hooks/post-commit.
  // Lightweight: runs `memory validate` after each commit, surfaces stale-path warnings.
  // Either path is opt-in (mode=create only); we never overwrite an existing post-commit hook.
  try {
    const gitDir = path.join(projectRoot, ".git");
    const hooksDir = path.join(gitDir, "hooks");
    const postCommitPath = path.join(hooksDir, "post-commit");
    if (fs.existsSync(gitDir) && mode === "create" && !fs.existsSync(postCommitPath)) {
      // Detect Graphify
      if (probeGraphifyBinary()) {
        results.warnings.push(
          "Graphify detected — for post-commit graph refresh + stale-symbol checks, run `graphify hook install` once. devt's lightweight post-commit-validate.sh is NOT installed (Graphify's own hook supersedes it)."
        );
      } else {
        if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });
        // Wrapper script delegates to plugin's post-commit-validate.sh — keeps the source-of-truth
        // hook script in the plugin, plugin updates propagate without per-project rewrites.
        const wrapper = `#!/usr/bin/env bash\n# devt post-commit hook — delegates to plugin script.\nif [ -n "\${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "\${CLAUDE_PLUGIN_ROOT}/hooks/post-commit-validate.sh" ]; then\n bash "\${CLAUDE_PLUGIN_ROOT}/hooks/post-commit-validate.sh"\nfi\nexit 0\n`;
        // Two-step: atomic write then chmod. io.cjs::atomicWriteFileSync uses
        // tmp+renameSync which doesn't preserve the requested mode option.
        atomicWriteFileSync(postCommitPath, wrapper);
        fs.chmodSync(postCommitPath, 0o755);
        results.files_created.push(".git/hooks/post-commit (devt memory-validate wrapper)");
      }
    }
  } catch (e) {
    results.warnings.push(`post-commit hook install skipped: ${e.message}`);
  }

  // Scaffold .claude/settings.json with permissive defaults (only if absent — never overwrites)
  const claudeDir = path.join(projectRoot, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");
  if (!fs.existsSync(settingsPath)) {
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    const defaultSettings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
      permissions: {
        allow: [
          "Bash",
          "Read",
          "Write",
          "Edit",
          "Grep",
          "Glob",
          "WebFetch",
          "WebSearch",
          "Skill",
          "Task",
        ],
        ask: [
          "Bash(rm -rf:*)",
          "Bash(git push --force:*)",
          "Bash(git reset --hard:*)",
          "Bash(npm publish:*)",
          "Bash(yarn publish:*)",
          "Bash(pip install:*)",
        ],
      },
    };
    atomicWriteJson(settingsPath, defaultSettings);
    results.files_created.push(".claude/settings.json");
  }

  return results;
}

function atomicWriteJson(filePath, data) {
  atomicWriteJsonSync(filePath, data);
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Template directory not found: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (isUnsafeEntryName(entry.name, entry.isSymbolicLink())) continue;
    const srcCheck = validatePath(entry.name, src);
    if (!srcCheck.safe) continue;
    const destCheck = validatePath(entry.name, dest);
    if (!destCheck.safe) continue;
    if (entry.isDirectory()) {
      copyDirRecursive(srcCheck.resolved, destCheck.resolved);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcCheck.resolved, destCheck.resolved);
    }
  }
}

function copyMissingFiles(src, dest, prefix) {
  const added = [];
  if (!fs.existsSync(src)) return added;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (isUnsafeEntryName(entry.name, entry.isSymbolicLink())) continue;
    const srcCheck = validatePath(entry.name, src);
    if (!srcCheck.safe) continue;
    const destCheck = validatePath(entry.name, dest);
    if (!destCheck.safe) continue;
    const relPath = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (!fs.existsSync(destCheck.resolved)) {
        copyDirRecursive(srcCheck.resolved, destCheck.resolved);
        added.push(relPath + "/");
      } else {
        added.push(...copyMissingFiles(srcCheck.resolved, destCheck.resolved, relPath));
      }
    } else if (entry.isFile()) {
      if (!fs.existsSync(destCheck.resolved)) {
        fs.copyFileSync(srcCheck.resolved, destCheck.resolved);
        added.push(relPath);
      }
    }
  }
  return added;
}

// Reconcile probed MCP server entries against an existing .mcp.json mcpServers map.
// Behavior:
//   - probed entry not in existing  -> add (any mode)
//   - probed entry already present, mode === "reinit"  -> replace command + args
//     when they differ from probed; preserve user-set env keys (probe env merged
//     under the existing env, so user customizations win on conflict)
//   - probed entry already present, mode !== "reinit"  -> leave untouched
//   - identical entries under reinit  -> no-op (avoid spurious writes)
//
// Pure function: no I/O, no probes. Easily testable. Exported for smoke gates.
function reconcileMcpServers(existingMcpServers, probedServers, mode) {
  const out = { ...existingMcpServers };
  let mutated = false;
  const replacements = [];
  for (const [name, cfg] of Object.entries(probedServers)) {
    const cur = out[name];
    if (!cur) {
      out[name] = cfg;
      mutated = true;
      continue;
    }
    if (mode !== "reinit") continue;
    const cmdSame = cur.command === cfg.command;
    const argsSame = JSON.stringify(cur.args) === JSON.stringify(cfg.args);
    if (cmdSame && argsSame) continue;
    out[name] = {
      ...cur,
      command: cfg.command,
      args: cfg.args,
      env: { ...(cfg.env || {}), ...(cur.env || {}) },
    };
    mutated = true;
    replacements.push(name);
  }
  return { mcpServers: out, mutated, replacements };
}

function run(args, pluginRoot) {
  let templateName = "blank";
  let extraConfig = null;
  let mode = "create";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--template" && args[i + 1]) {
      templateName = args[i + 1];
      i++;
    } else if (args[i] === "--config" && args[i + 1]) {
      const result = safeJsonParse(args[i + 1], "--config value");
      if (!result.ok) {
        throw new Error(`--config value must be valid JSON: ${result.error}`);
      }
      extraConfig = result.value;
      i++;
    } else if (args[i] === "--mode" && args[i + 1]) {
      mode = args[i + 1];
      i++;
    } else if (args[i] === "--detect") {
      const projectRoot = findProjectRoot();
      return {
        detected_stack: detectStack(projectRoot),
        detected_git: detectGitRemote(projectRoot),
        available_templates: AVAILABLE_TEMPLATES,
      };
    }
  }

  return setupProject(templateName, pluginRoot, extraConfig, { mode });
}

module.exports = { run, AVAILABLE_TEMPLATES, reconcileMcpServers };
