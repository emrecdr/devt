"use strict";

/**
 * Project setup — scaffolds .dev-rules/ from templates and creates .devt.json.
 *
 * Called by /devt:init command via the project-init workflow.
 * The workflow handles the interactive questioning (AskUserQuestion).
 * This module handles the file operations.
 */

const fs = require("fs");
const path = require("path");
const { findProjectRoot, deepMerge } = require("./config.cjs");

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
  const devRulesDir = path.join(projectRoot, ".dev-rules");
  const stateDir = path.join(projectRoot, ".devt-state");
  const configPath = path.join(projectRoot, ".devt.json");
  const templateDir = path.join(pluginRoot, "templates", templateName);
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

  // Handle .dev-rules/
  if (fs.existsSync(devRulesDir)) {
    if (mode === "reinit") {
      // Overwrite everything
      fs.rmSync(devRulesDir, { recursive: true, force: true });
      copyDirRecursive(templateDir, devRulesDir);
      results.files_created.push(".dev-rules/ (overwritten from template: " + templateName + ")");
    } else if (mode === "update") {
      // Copy only missing files
      const added = copyMissingFiles(templateDir, devRulesDir);
      if (added.length > 0) {
        results.files_updated.push(...added.map((f) => ".dev-rules/" + f + " (added)"));
      } else {
        results.warnings.push(".dev-rules/ already complete — no files added");
      }
    } else {
      results.warnings.push(
        ".dev-rules/ already exists — use --mode update to add missing files or --mode reinit to overwrite",
      );
    }
  } else {
    copyDirRecursive(templateDir, devRulesDir);
    results.files_created.push(".dev-rules/ (from template: " + templateName + ")");
  }

  // Create .devt-state/ directory
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
    results.files_created.push(".devt-state/");
  }

  // Create learning-playbook.md if it doesn't exist
  const playbookPath = path.join(projectRoot, "learning-playbook.md");
  if (!fs.existsSync(playbookPath)) {
    const playbookHeader = [
      "# Learning Playbook",
      "",
      "Lessons extracted from development workflows. Entries are YAML blocks separated by `---`.",
      "Managed by /devt:retro (extraction) and /devt:curator (curation).",
      "",
      "---",
      "",
    ].join("\n");
    fs.writeFileSync(playbookPath, playbookHeader);
    results.files_created.push("learning-playbook.md");
  }

  // Create or update .devt.json
  const defaultConfig = {
    model_profile: "balanced",
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
      // Only merge truthy auto-detected values (don't overwrite defaults with undefined)
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
    fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2) + "\n");
    results.files_created.push(".devt.json");
  } else if (mode === "update" && extraConfig) {
    // Merge into existing config
    const existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const merged = deepMerge(existing, extraConfig);
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n");
    results.files_updated.push(".devt.json (merged)");
  } else {
    results.warnings.push(".devt.json already exists — skipping");
  }

  const gitignorePath = path.join(projectRoot, ".gitignore");
  try {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(".devt-state")) {
      fs.appendFileSync(gitignorePath, "\n# devt workflow state\n.devt-state/\n");
      results.files_updated.push(".gitignore (appended .devt-state/)");
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      fs.writeFileSync(gitignorePath, "# devt workflow state\n.devt-state/\n");
      results.files_created.push(".gitignore");
    }
  }

  return results;
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Template directory not found: ${src}`);
  }
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

function copyMissingFiles(src, dest, prefix) {
  const added = [];
  if (!fs.existsSync(src)) return added;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        copyDirRecursive(srcPath, destPath);
        added.push(relPath + "/");
      } else {
        added.push(...copyMissingFiles(srcPath, destPath, relPath));
      }
    } else {
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
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
      try {
        extraConfig = JSON.parse(args[i + 1]);
      } catch {
        throw new Error("--config value must be valid JSON");
      }
      i++;
    } else if (args[i] === "--mode" && args[i + 1]) {
      mode = args[i + 1];
      i++;
    } else if (args[i] === "--detect") {
      // Just detect stack and git, don't set up anything
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
