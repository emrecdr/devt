"use strict";

/**
 * Health check — validates devt project configuration, state, and plugin integrity.
 *
 * Returns structured JSON with error codes, severity, and repair actions.
 * Supports --repair flag for auto-fixing safe issues.
 */

const fs = require("fs");
const path = require("path");
const { findProjectRoot, DEFAULTS } = require("./config.cjs");
const { readState, validateConsistency, describeMismatch, VALID_PHASES, VALID_WORKFLOW_TYPES, VALID_TIERS } = require("./state.cjs");
const { REQUIRED_DEV_RULES } = require("./init.cjs");

const CHECKS = {
  E001: { severity: "error", message: ".devt/ directory not found", repairable: true, fix: "Run /devt:init to set up project, or /devt:health --repair" },
  E002: { severity: "error", message: ".devt/config.json not found", repairable: true, fix: "Run /devt:init, or /devt:health --repair to create with defaults" },
  E003: { severity: "error", message: ".devt/config.json has invalid JSON", repairable: true, fix: "Fix JSON syntax, or /devt:health --repair to reset to defaults" },
  E004: { severity: "error", message: ".devt/rules/ directory not found", repairable: false, fix: "Run /devt:init to scaffold rules from a template" },
  E005: { severity: "error", message: ".devt/state/ directory not found", repairable: true, fix: "Run /devt:health --repair to create the directory" },
  W001: { severity: "warning", message: "coding-standards.md missing from .devt/rules/", repairable: false, fix: "Run /devt:init --mode update to add missing template files" },
  W002: { severity: "warning", message: "testing-patterns.md missing from .devt/rules/", repairable: false, fix: "Run /devt:init --mode update to add missing template files" },
  W003: { severity: "warning", message: "quality-gates.md missing from .devt/rules/", repairable: false, fix: "Run /devt:init --mode update to add missing template files" },
  W004: { severity: "warning", message: "architecture.md missing from .devt/rules/", repairable: false, fix: "Run /devt:init --mode update to add missing template files" },
  W005: { severity: "warning", message: ".devt/state/ not in .gitignore", repairable: true, fix: "Run /devt:health --repair to add .devt/state/ to .gitignore" },
  W006: { severity: "warning", message: "Stale workflow — active=true with old stopped_at", repairable: true, fix: "Run /devt:health --repair to clear stale state, or /devt:cancel-workflow" },
  W007: { severity: "warning", message: "VERSION and plugin.json version mismatch", repairable: false, fix: "Update VERSION or plugin.json to match" },
  W008: { severity: "warning", message: "Hook script not executable", repairable: true, fix: "Run /devt:health --repair to fix permissions, or: chmod +x hooks/<script>" },
  W009: { severity: "warning", message: "Plugin agent file missing", repairable: false, fix: "Reinstall devt — agent files may be corrupted or incomplete" },
  W010: { severity: "warning", message: "Workflow missing <available_agent_types> section", repairable: false, fix: "Add <available_agent_types> to the workflow to prevent post-/clear silent fallback to general-purpose" },
  I001: { severity: "info", message: "CLAUDE.md not found (recommended)", repairable: false, fix: "Create a CLAUDE.md with project-specific guidance for Claude Code" },
  I002: { severity: "info", message: ".devt/learning-playbook.md not found", repairable: true, fix: "Run /devt:health --repair to create, or /devt:retro to start the learning loop" },
  I003: { severity: "info", message: "No active workflow", repairable: false, fix: "No action needed — start a workflow with /devt:workflow" },
  W011: { severity: "warning", message: "Invalid workflow state value", repairable: true, fix: "Run /devt:health --repair to clear invalid state, or /devt:cancel-workflow" },
  W012: { severity: "warning", message: "Hook script referenced in hooks.json not found", repairable: false, fix: "Reinstall devt — hook files may be corrupted or incomplete" },
  W013: { severity: "warning", message: "Workflow state/artifact inconsistency", repairable: false, fix: "Re-run the phase to regenerate the artifact, fix the offending `## Status` line, or /devt:cancel-workflow to reset" },
  W014: { severity: "warning", message: "next.md missing routing for workflow_type", repairable: false, fix: "Add the missing workflow_type to the routing table in workflows/next.md" },
};

const RULE_WARNING_CODES = { "coding-standards.md": "W001", "testing-patterns.md": "W002", "quality-gates.md": "W003", "architecture.md": "W004" };

function runChecks(pluginRoot) {
  const projectRoot = findProjectRoot();
  const devtDir = path.join(projectRoot, ".devt");
  const issues = [];

  function add(code, extra, data) {
    const check = CHECKS[code];
    issues.push({
      code,
      severity: check.severity,
      message: extra ? `${check.message}: ${extra}` : check.message,
      fix: check.fix,
      repairable: check.repairable,
      ...(data && { data }),
    });
  }

  // Version info (resolve early so all return paths include it)
  let version = null;
  if (pluginRoot) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
      version = manifest.version || null;
    } catch {
      try { version = fs.readFileSync(path.join(pluginRoot, "VERSION"), "utf8").trim(); } catch { /* skip */ }
    }
  }

  // Update check (read cache — non-blocking, no network)
  let update = null;
  try {
    const cachePath = path.join(require("os").tmpdir(), "devt-cache", "update-check.json");
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (cached.update_available) {
      update = { available: true, installed: cached.installed, latest: cached.latest };
    } else if (cached.ahead) {
      update = { available: false, ahead: true, installed: cached.installed, latest: cached.latest };
    } else {
      update = { available: false, installed: cached.installed, latest: cached.latest };
    }
  } catch {
    // No cache — update check hasn't run yet
  }

  function buildResult(status) {
    return { status, version, update, issues, project_root: projectRoot, repairable_count: issues.filter((i) => i.repairable).length };
  }

  // E001: .devt/ directory
  if (!fs.existsSync(devtDir)) {
    add("E001");
    return buildResult("broken");
  }

  // E002/E003: .devt/config.json
  const configPath = path.join(devtDir, "config.json");
  if (!fs.existsSync(configPath)) {
    add("E002");
  } else {
    try {
      JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      add("E003", e.message);
    }
  }

  // E004: .devt/rules/ + W001-W004
  const rulesDir = path.join(devtDir, "rules");
  if (!fs.existsSync(rulesDir)) {
    add("E004");
  } else {
    for (const file of REQUIRED_DEV_RULES) {
      if (!fs.existsSync(path.join(rulesDir, file))) {
        add(RULE_WARNING_CODES[file]);
      }
    }
  }

  // E005: .devt/state/
  const stateDir = path.join(devtDir, "state");
  if (!fs.existsSync(stateDir)) {
    add("E005");
  }

  // W005: .gitignore
  const gitignorePath = path.join(projectRoot, ".gitignore");
  try {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(".devt/state")) {
      add("W005");
    }
  } catch {
    add("W005");
  }

  // Read workflow state once for W006 + I003
  const state = readState();

  // W006: Stale workflow
  if (state.active && state.stopped_at && state.stopped_at !== "null") {
    const stoppedAt = new Date(state.stopped_at);
    const hoursSince = (Date.now() - stoppedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince > 24) {
      add("W006", `stopped ${Math.floor(hoursSince)}h ago`);
    }
  }

  // W007: Version consistency
  if (pluginRoot) {
    try {
      const versionFile = fs.readFileSync(path.join(pluginRoot, "VERSION"), "utf8").trim();
      const pluginJson = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
      if (versionFile !== pluginJson.version) {
        add("W007", `VERSION=${versionFile}, plugin.json=${pluginJson.version}`);
      }
    } catch {
      // Can't check — skip
    }
  }

  // W008: Hook scripts executable
  if (pluginRoot) {
    const hooksDir = path.join(pluginRoot, "hooks");
    try {
      for (const script of fs.readdirSync(hooksDir).filter((f) => f.endsWith(".sh"))) {
        try {
          fs.accessSync(path.join(hooksDir, script), fs.constants.X_OK);
        } catch {
          add("W008", script, { script });
        }
      }
    } catch {
      // hooks dir not readable
    }
  }

  // W009: Agent file validation
  if (pluginRoot) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
      if (Array.isArray(manifest.agents)) {
        for (const agentPath of manifest.agents) {
          const resolved = path.join(pluginRoot, agentPath.replace(/^\.\//, ""));
          if (!fs.existsSync(resolved)) {
            add("W009", path.basename(agentPath), { agent: agentPath });
          }
        }
      }
    } catch {
      // Can't read manifest — skip
    }
  }

  // W010: Workflows dispatching agents must have <available_agent_types>
  if (pluginRoot) {
    const workflowsDir = path.join(pluginRoot, "workflows");
    try {
      for (const file of fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".md"))) {
        const content = fs.readFileSync(path.join(workflowsDir, file), "utf8");
        // Check if workflow dispatches named agents (devt:agent-name pattern)
        const dispatches = content.match(/devt:(?:programmer|tester|code-reviewer|architect|docs-writer|verifier|debugger|researcher|retro|curator)/g);
        if (dispatches && dispatches.length > 0 && !content.includes("<available_agent_types>")) {
          add("W010", file, { workflow: file });
        }
      }
    } catch {
      // Can't read workflows — skip
    }
  }

  // W011: Validate active workflow state fields
  if (state.active) {
    if (state.workflow_type && !VALID_WORKFLOW_TYPES.has(state.workflow_type)) {
      add("W011", `workflow_type="${state.workflow_type}" is not in VALID_WORKFLOW_TYPES`, { field: "workflow_type", value: state.workflow_type });
    }
    if (state.phase && !VALID_PHASES.has(state.phase)) {
      add("W011", `phase="${state.phase}" is not in VALID_PHASES`, { field: "phase", value: state.phase });
    }
    if (state.tier && !VALID_TIERS.has(state.tier)) {
      add("W011", `tier="${state.tier}" is not in VALID_TIERS`, { field: "tier", value: state.tier });
    }
  }

  // W012: Hook scripts referenced in hooks.json exist
  if (pluginRoot) {
    const hooksJsonPath = path.join(pluginRoot, "hooks", "hooks.json");
    try {
      const hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"));
      const referenced = new Set();
      for (const eventHooks of Object.values(hooksConfig.hooks || {})) {
        for (const entry of eventHooks) {
          for (const hook of entry.hooks || []) {
            const m = (hook.command || "").match(/run-hook\.js[" ]+(\S+)/);
            if (m) referenced.add(m[1]);
          }
        }
      }
      for (const script of referenced) {
        if (!fs.existsSync(path.join(pluginRoot, "hooks", script))) {
          add("W012", script, { script });
        }
      }
    } catch {
      // hooks.json not readable — skip
    }
  }

  // W013: State/artifact consistency
  if (state.active && state.phase) {
    const consistency = validateConsistency();
    if (!consistency.consistent) {
      for (const m of consistency.mismatches) {
        const detail = describeMismatch(m);
        add("W013", `phase "${m.phase}" completed but ${m.expected_artifact} ${detail}`, { phase: m.phase, artifact: m.expected_artifact, reason: m.reason });
      }
    }
  }

  // W014: next.md routing completeness — every VALID_WORKFLOW_TYPE must have a routing entry
  if (pluginRoot) {
    const nextMdPath = path.join(pluginRoot, "workflows", "next.md");
    try {
      const nextContent = fs.readFileSync(nextMdPath, "utf8");
      for (const wfType of VALID_WORKFLOW_TYPES) {
        if (wfType === null) continue;
        if (!nextContent.includes(`\`${wfType}\``)) {
          add("W014", `"${wfType}"`, { workflow_type: wfType });
        }
      }
    } catch {
      // Can't read next.md — skip
    }
  }

  // I001: CLAUDE.md
  if (!fs.existsSync(path.join(projectRoot, "CLAUDE.md"))) {
    add("I001");
  }

  // I002: Learning playbook
  if (!fs.existsSync(path.join(devtDir, "learning-playbook.md"))) {
    add("I002");
  }

  // I003: No active workflow
  if (!state.active) {
    add("I003");
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  const hasWarnings = issues.some((i) => i.severity === "warning");
  return buildResult(hasErrors ? "broken" : hasWarnings ? "degraded" : "healthy");
}

function runRepairs(pluginRoot, checkResult) {
  const result = checkResult || runChecks(pluginRoot);
  const repairs = [];
  const devtDir = path.join(result.project_root, ".devt");

  for (const issue of result.issues) {
    if (!issue.repairable) continue;

    try {
      switch (issue.code) {
        case "E001":
          fs.mkdirSync(devtDir, { recursive: true });
          repairs.push({ code: issue.code, action: "Created .devt/ directory", success: true });
          break;

        case "E002":
        case "E003": {
          const configPath = path.join(devtDir, "config.json");
          const tmp = configPath + ".tmp";
          fs.writeFileSync(tmp, JSON.stringify(DEFAULTS, null, 2) + "\n");
          fs.renameSync(tmp, configPath);
          repairs.push({ code: issue.code, action: "Created .devt/config.json with defaults", success: true });
          break;
        }

        case "E005":
          fs.mkdirSync(path.join(devtDir, "state"), { recursive: true });
          repairs.push({ code: issue.code, action: "Created .devt/state/ directory", success: true });
          break;

        case "W005": {
          const gitignorePath = path.join(result.project_root, ".gitignore");
          try {
            fs.appendFileSync(gitignorePath, "\n# devt workflow state\n.devt/state/\n");
          } catch {
            fs.writeFileSync(gitignorePath, "# devt workflow state\n.devt/state/\n");
          }
          repairs.push({ code: issue.code, action: "Added .devt/state/ to .gitignore", success: true });
          break;
        }

        case "W006": {
          const { updateState } = require("./state.cjs");
          updateState(["active=false"]);
          repairs.push({ code: issue.code, action: "Set active=false (was stale)", success: true });
          break;
        }

        case "W008": {
          // Use structured data instead of parsing message string
          const script = issue.data && issue.data.script;
          if (pluginRoot && script) {
            fs.chmodSync(path.join(pluginRoot, "hooks", script), 0o755);
            repairs.push({ code: issue.code, action: `Made ${script} executable`, success: true });
          }
          break;
        }

        case "W011": {
          const { updateState } = require("./state.cjs");
          const field = issue.data && issue.data.field;
          if (field) {
            updateState([`${field}=null`]);
            repairs.push({ code: issue.code, action: `Cleared invalid ${field}`, success: true });
          }
          break;
        }

        case "I002": {
          const playbookPath = path.join(devtDir, "learning-playbook.md");
          fs.writeFileSync(playbookPath, [
            "# Learning Playbook", "",
            "Lessons extracted from development workflows. Entries are YAML blocks separated by `---`.",
            "Managed by /devt:retro (extraction) and /devt:curator (curation).", "", "---", "",
          ].join("\n"));
          repairs.push({ code: issue.code, action: "Created .devt/learning-playbook.md", success: true });
          break;
        }
      }
    } catch (e) {
      repairs.push({ code: issue.code, action: e.message, success: false });
    }
  }

  return { repairs, recheck_needed: repairs.length > 0 };
}

function run(args, pluginRoot) {
  const repair = args.includes("--repair");

  if (repair) {
    const initial = runChecks(pluginRoot);
    if (initial.repairable_count === 0) {
      return { ...initial, repairs: [], message: "Nothing to repair" };
    }
    const { repairs } = runRepairs(pluginRoot, initial);
    const after = runChecks(pluginRoot);
    return { ...after, repairs, initial_status: initial.status };
  }

  return runChecks(pluginRoot);
}

module.exports = { run };
