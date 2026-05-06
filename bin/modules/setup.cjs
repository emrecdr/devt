"use strict";

/**
 * Project setup — scaffolds .devt/rules/ from templates and creates .devt/config.json.
 *
 * Called by /devt:init command via the project-init workflow.
 * The workflow handles the interactive questioning (AskUserQuestion).
 * This module handles the file operations.
 *
 * All artifacts go under .devt/ in the project root:
 *   .devt/config.json          — project configuration
 *   .devt/rules/               — coding standards, testing patterns, etc.
 *   .devt/state/               — workflow state (gitignored)
 *   .devt/memory/lessons/      — operational lessons (LES-NNNN frontmatter docs)
 *   .devt/memory/{decisions,concepts,flows,rejected}/ — architectural docs
 *   .devt/memory/index.db      — unified FTS5 index (regenerable from .md files)
 */

const fs = require("fs");
const path = require("path");
const { findProjectRoot, deepMerge } = require("./config.cjs");
const { validatePath, safeJsonParse } = require("./security.cjs");

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

    try {
      const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (branch && branch !== "HEAD") result.primary_branch = branch;
    } catch {
      // Fall through
    }

    return result;
  } catch {
    return null;
  }
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
  // Phase 1 (v0.16.0): scaffolding only — no template seeding. Project owners
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

  // Gitignore manifest (Phase 3 v0.18.0):
  //   ALWAYS-GITIGNORE — derived/ephemeral state, regenerable from canonical sources:
  //     .devt/state/                  (per-workflow scratch + preflight-brief.md)
  //     .claude/agent-memory/         (per-agent persistent memory)
  //     .devt/memory/index.db         (FTS5 index — rebuild from .md)
  //     graphify-out/cache/           (Graphify ephemeral cache)
  //     graphify-out/manifest.json    (Graphify per-machine manifest)
  //     .claude-mem/mem.db            (claude-mem session DB — local only)
  //
  //   ALWAYS-COMMIT (NOT in this list — kept by default):
  //     .devt/memory/{decisions,concepts,flows,rejected}/*.md   team-shared truth
  //     graphify-out/graph.json                                 team-shared graph
  //     GRAPH_REPORT.md                                         curated overview
  //
  //   USER-DECIDES (commented hints — not auto-added):
  //     .devt/memory/_suggestions.md  (some teams commit for review history)
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const requiredIgnores = [
    { path: ".devt/state/", header: "# devt workflow state" },
    { path: ".claude/agent-memory/", header: "# devt agent persistent memory (per-project)" },
    { path: ".devt/memory/index.db", header: "# devt memory FTS5 index (regenerable from markdown)" },
    { path: ".devt/memory/.auto-index-stamp", header: "# devt memory auto-index debounce marker (transient)" },
    { path: ".devt/memory/_mcp-trace.jsonl", header: "# devt MCP tool-call trace (v0.21.0+, append-only telemetry; safe to delete)" },
    { path: ".devt/memory/export-*.json", header: "# devt memory export bundles (transient — share via explicit channel)" },
    { path: "graphify-out/cache/", header: "# Graphify ephemeral cache" },
    { path: "graphify-out/manifest.json", header: "# Graphify per-machine manifest" },
    { path: ".claude-mem/mem.db", header: "# claude-mem local session DB" },
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
      fs.writeFileSync(gitignorePath, lines.join("\n"));
      results.files_created.push(".gitignore");
    }
  }

  // Scaffold project .mcp.json (Phase 3 v0.18.0) — registers devt-memory-mcp + conditional graphify + claude-mem.
  // The vendored devt-memory-mcp server is referenced via ${CLAUDE_PLUGIN_ROOT} so plugin updates propagate
  // automatically — no per-project copy of the server script. Other MCP entries are conditional on detected
  // tooling; absence is logged as a hint, never an error.
  const mcpJsonPath = path.join(projectRoot, ".mcp.json");
  const mcpHints = [];
  if (!fs.existsSync(mcpJsonPath)) {
    const mcpServers = {
      "devt-memory": {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/bin/devt-memory-mcp.cjs"],
        env: {},
      },
    };
    // Probe Graphify
    try {
      const probe = require("child_process").spawnSync("graphify", ["--help"], { timeout: 1500, stdio: "ignore" });
      if (probe && probe.status === 0) {
        mcpServers["graphify"] = {
          command: "graphify",
          args: ["mcp", "--project", "."],
          env: {},
        };
      } else {
        mcpHints.push("graphify not detected on PATH — install with `pip install graphifyy[mcp]` and re-run setup to register the Graphify MCP server.");
      }
    } catch {
      mcpHints.push("graphify probe failed — Graphify MCP not registered.");
    }
    // Probe claude-mem
    try {
      const probe = require("child_process").spawnSync("claude-mem", ["--help"], { timeout: 1500, stdio: "ignore" });
      if (probe && probe.status === 0) {
        mcpServers["claude-mem"] = {
          command: "claude-mem",
          args: ["mcp", "--db", ".claude-mem/mem.db"],
          env: {},
        };
      } else {
        mcpHints.push("claude-mem not detected — install for richer mid-session capture.");
      }
    } catch {
      mcpHints.push("claude-mem probe failed — claude-mem MCP not registered.");
    }
    atomicWriteJson(mcpJsonPath, { mcpServers });
    results.files_created.push(".mcp.json");
  } else {
    // Only ADD devt-memory if missing — never modify existing servers (user may have customized)
    try {
      const mcpRaw = fs.readFileSync(mcpJsonPath, "utf8");
      const mcpParse = safeJsonParse(mcpRaw, ".mcp.json");
      if (!mcpParse.ok) throw new Error(mcpParse.error);
      const existing = mcpParse.value;
      if (!existing.mcpServers) existing.mcpServers = {};
      if (!existing.mcpServers["devt-memory"]) {
        existing.mcpServers["devt-memory"] = {
          command: "node",
          args: ["${CLAUDE_PLUGIN_ROOT}/bin/devt-memory-mcp.cjs"],
          env: {},
        };
        atomicWriteJson(mcpJsonPath, existing);
        results.files_updated.push(".mcp.json (added devt-memory entry)");
      }
    } catch (e) {
      results.warnings.push(`.mcp.json present but unreadable: ${e.message}`);
    }
  }
  if (mcpHints.length > 0) {
    results.warnings.push(...mcpHints);
  }

  // Post-commit hook installation (Phase 5 v0.20.0+).
  // Two paths based on whether Graphify is enabled:
  //   GRAPHIFY ENABLED + binary present:
  //     We do NOT install our hook. We surface a hint suggesting `graphify hook install`,
  //     which registers Graphify's own post-commit hook (covers stale symbols + graph rebuild).
  //   GRAPHIFY DISABLED OR ABSENT:
  //     Install hooks/post-commit-validate.sh as the project's .git/hooks/post-commit.
  //     Lightweight: runs `memory validate` after each commit, surfaces stale-path warnings.
  // Either path is opt-in (mode=create only); we never overwrite an existing post-commit hook.
  try {
    const gitDir = path.join(projectRoot, ".git");
    const hooksDir = path.join(gitDir, "hooks");
    const postCommitPath = path.join(hooksDir, "post-commit");
    if (fs.existsSync(gitDir) && mode === "create" && !fs.existsSync(postCommitPath)) {
      // Detect Graphify
      let graphifyAvailable = false;
      try {
        const probe = require("child_process").spawnSync("graphify", ["--help"], { timeout: 1500, stdio: "ignore" });
        graphifyAvailable = probe && probe.status === 0;
      } catch { /* fall through */ }

      if (graphifyAvailable) {
        results.warnings.push(
          "Graphify detected — for post-commit graph refresh + stale-symbol checks, run `graphify hook install` once. devt's lightweight post-commit-validate.sh is NOT installed (Graphify's own hook supersedes it)."
        );
      } else {
        if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });
        // Wrapper script delegates to plugin's post-commit-validate.sh — keeps the source-of-truth
        // hook script in the plugin, plugin updates propagate without per-project rewrites.
        const wrapper = `#!/usr/bin/env bash\n# devt post-commit hook (v0.20.0+) — delegates to plugin script.\nif [ -n "\${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "\${CLAUDE_PLUGIN_ROOT}/hooks/post-commit-validate.sh" ]; then\n  bash "\${CLAUDE_PLUGIN_ROOT}/hooks/post-commit-validate.sh"\nfi\nexit 0\n`;
        fs.writeFileSync(postCommitPath, wrapper, { mode: 0o755 });
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
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, filePath);
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

module.exports = { run, AVAILABLE_TEMPLATES };
