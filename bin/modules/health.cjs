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
const { safeJsonParse } = require("./security.cjs");
const { atomicWriteFileSync, atomicWriteJsonSync } = require("./io.cjs");

const CHECKS = {
  E001: { severity: "error", message: ".devt/ directory not found", repairable: true, fix: "Run /devt:setup --init to set up project, or /devt:setup --health --repair" },
  E002: { severity: "error", message: ".devt/config.json not found", repairable: true, fix: "Run /devt:setup --init, or /devt:setup --health --repair to create with defaults" },
  E003: { severity: "error", message: ".devt/config.json has invalid JSON", repairable: true, fix: "Fix JSON syntax, or /devt:setup --health --repair to reset to defaults" },
  E004: { severity: "error", message: ".devt/rules/ directory not found", repairable: false, fix: "Run /devt:setup --init to scaffold rules from a template" },
  E005: { severity: "error", message: ".devt/state/ directory not found", repairable: true, fix: "Run /devt:setup --health --repair to create the directory" },
  W001: { severity: "warning", message: "coding-standards.md missing from .devt/rules/", repairable: false, fix: "Run /devt:setup --init --mode update to add missing template files" },
  W002: { severity: "warning", message: "testing-patterns.md missing from .devt/rules/", repairable: false, fix: "Run /devt:setup --init --mode update to add missing template files" },
  W003: { severity: "warning", message: "quality-gates.md missing from .devt/rules/", repairable: false, fix: "Run /devt:setup --init --mode update to add missing template files" },
  W004: { severity: "warning", message: "architecture.md missing from .devt/rules/", repairable: false, fix: "Run /devt:setup --init --mode update to add missing template files" },
  W005: { severity: "warning", message: ".devt/state/ not in .gitignore", repairable: true, fix: "Run /devt:setup --health --repair to add .devt/state/ to .gitignore" },
  W015: { severity: "warning", message: ".gitignore has flat .devt/state/ but not recursive **/.devt/state/ — sub-tree devt invocations (e.g. tools/X/, tests/Y/) will leak state files into PR diffs", repairable: true, fix: "Run /devt:setup --upgrade-gitignore to append recursive pattern (preserves the existing flat entry)" },
  W006: { severity: "warning", message: "Stale workflow — active=true with old stopped_at", repairable: true, fix: "Run /devt:setup --health --repair to clear stale state, or /devt:workflow --cancel" },
  W007: { severity: "warning", message: "VERSION and plugin.json version mismatch", repairable: false, fix: "Update VERSION or plugin.json to match" },
  W008: { severity: "warning", message: "Hook script not executable", repairable: true, fix: "Run /devt:setup --health --repair to fix permissions, or: chmod +x hooks/<script>" },
  W009: { severity: "warning", message: "Plugin agent file missing", repairable: false, fix: "Reinstall devt — agent files may be corrupted or incomplete" },
  W010: { severity: "warning", message: "Workflow missing <available_agent_types> section", repairable: false, fix: "Add <available_agent_types> to the workflow to prevent post-/clear silent fallback to general-purpose" },
  I001: { severity: "info", message: "CLAUDE.md not found (recommended)", repairable: false, fix: "Create a CLAUDE.md with project-specific guidance for Claude Code" },
  I003: { severity: "info", message: "No active workflow", repairable: false, fix: "No action needed — start a workflow with /devt:workflow" },
  I004: { severity: "info", message: "Memory promotion candidates pending in _suggestions.md", repairable: false, fix: "Run /devt:workflow --retro or /devt:memory promote to triage candidates into permanent memory" },
  W011: { severity: "warning", message: "Invalid workflow state value", repairable: true, fix: "Run /devt:setup --health --repair to clear invalid state, or /devt:workflow --cancel" },
  W012: { severity: "warning", message: "Hook script referenced in hooks.json not found", repairable: false, fix: "Reinstall devt — hook files may be corrupted or incomplete" },
  W013: { severity: "warning", message: "Workflow state/artifact inconsistency", repairable: false, fix: "Re-run the phase to regenerate the artifact, fix the offending `## Status` line, or /devt:workflow --cancel to reset" },
  W014: { severity: "warning", message: "next.md missing routing for workflow_type", repairable: false, fix: "Add the missing workflow_type to the routing table in workflows/next.md" },
  // Memory layer checks — promoted from agent-orchestrated bash to native checks
  // so CI can rely on `health` returning these directly without an agent in the loop.
  MEM_INDEX_STALE: { severity: "warning", message: "Memory FTS5 index is older than the most recent .devt/memory/**/*.md file", repairable: true, fix: "Run /devt:setup --health --repair to rebuild, or: node bin/devt-tools.cjs memory index" },
  MEM_VALIDATE_ERRORS: { severity: "warning", message: "Memory layer has frontmatter validation errors", repairable: false, fix: "Run `node bin/devt-tools.cjs memory validate` for the full list and fix the offending markdown" },
  MEM_PATH_UNREACHABLE: { severity: "warning", message: "memory.paths references a directory that doesn't exist", repairable: false, fix: "Initialize the missing root: git submodule init, mount the NFS share, or remove the entry from .devt/config.json" },
  MEM_CONFLICT_HIGH: { severity: "info", message: "Memory layer has ID collisions across configured roots (last-wins applied)", repairable: false, fix: "Inspect with `node bin/devt-tools.cjs memory index` to see the collisions; rename project-local docs OR accept the override as intentional" },
  // Graphify integration drift — `graphify` binary on PATH but MCP server not registered in
  // .mcp.json. Setup wizard's MCP probe is one-shot at install time; users who install
  // Graphify AFTER /devt:setup --init don't auto-pick up the MCP entry. Warn-only by design — auto-
  // editing .mcp.json risks stomping user customizations.
  GRAPHIFY_MCP_UNREGISTERED: { severity: "info", message: "Graphify is on PATH but not registered in .mcp.json — MCP queries will fall back to grep", repairable: false, fix: "Add to .mcp.json mcpServers: `\"graphify\": { \"command\": \"graphify\", \"args\": [\"mcp\", \"--project\", \".\"] }` (or re-run `node bin/devt-tools.cjs setup --mode update` to regenerate)" },
  // Graphify silently emits empty hyperedges when skill/binary versions
  // drift. Drift is invisible without this surfaced check.
  GRAPHIFY_SKILL_DRIFT: { severity: "warning", message: "Graphify skill version drifted from binary — hyperedges may silently return empty", repairable: false, fix: "Run `graphify install` to refresh the local skill bundle to match the binary version" },
  PROBE_FAILURES_RECENT: { severity: "info", message: "Probe failures logged in .devt/state/probe-failures.jsonl — graphify/python setup detection diagnostics available", repairable: false, fix: "Inspect categories (timeout, nonzero-exit, spawn-error) to disambiguate \"not installed\" from \"installed but broken\"; common fixes: extend timeout in env, repair PATH, reinstall graphifyy[mcp] extra" },
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
      const raw = fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8");
      const r = safeJsonParse(raw, "plugin.json");
      if (!r.ok) throw new Error(r.error);
      version = r.value.version || null;
    } catch {
      try { version = fs.readFileSync(path.join(pluginRoot, "VERSION"), "utf8").trim(); } catch { /* skip */ }
    }
  }

  // Update check (read cache — non-blocking, no network).
  // Drop the cache when its `installed` field doesn't match the freshly-read
  // VERSION — local version may have been bumped since last `update check`,
  // and surfacing the stale installed/latest pair confuses users.
  let update = null;
  try {
    const cachePath = path.join(require("os").tmpdir(), "devt-cache", "update-check.json");
    const cacheRaw = fs.readFileSync(cachePath, "utf8");
    const cacheParse = safeJsonParse(cacheRaw, "update-check.json");
    if (!cacheParse.ok) throw new Error(cacheParse.error);
    const cached = cacheParse.value;
    if (version && cached.installed !== version) throw new Error("cache stale: installed mismatch");
    if (cached.update_available) {
      update = { available: true, installed: cached.installed, latest: cached.latest };
    } else if (cached.ahead) {
      update = { available: false, ahead: true, installed: cached.installed, latest: cached.latest };
    } else {
      update = { available: false, installed: cached.installed, latest: cached.latest };
    }
  } catch {
    // No cache, or cache stale relative to local VERSION — update check hasn't run since the bump
  }

  // Static-compress surface — surfaces config mode + cumulative savings
  // so users can see at a glance whether the compression path is active
  // and what it has saved. The recipe path is the canonical entry point
  // for operators who want to flip the mode or check the architecture.
  let compression = null;
  try {
    let mode = "on";
    try {
      const cfgRaw = fs.readFileSync(path.join(devtDir, "config.json"), "utf8");
      const cfgParse = safeJsonParse(cfgRaw, "config.json");
      if (cfgParse.ok && cfgParse.value?.static_compress?.mode) {
        mode = cfgParse.value.static_compress.mode;
      }
    } catch { /* defaults stay */ }
    compression = {
      static_compress_mode: mode,
      recipe: "docs/static-compress-recipe.md",
    };
    // Aggregate savings from .devt/state/static-compress.jsonl. Read-only —
    // the file persists across resets (RESET_EXEMPT per docs/STATE-RULES.md)
    // so it captures historical compression activity, not just current
    // workflow. Drives the adoption-feedback loop: users see what
    // compression has actually saved before deciding whether to keep it on.
    try {
      const logPath = path.join(devtDir, "state", "static-compress.jsonl");
      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
        const compressEvents = [];
        for (const line of lines) {
          try {
            const rec = JSON.parse(line);
            if (rec.action === "compress" && rec.ok === true && typeof rec.before_bytes === "number" && typeof rec.after_bytes === "number") {
              compressEvents.push(rec);
            }
          } catch { /* skip malformed line */ }
        }
        if (compressEvents.length > 0) {
          const totalSaved = compressEvents.reduce((acc, r) => acc + (r.before_bytes - r.after_bytes), 0);
          const ratios = compressEvents.map((r) => r.ratio).filter((n) => typeof n === "number").sort((a, b) => a - b);
          const mid = Math.floor(ratios.length / 2);
          const medianRatio = ratios.length === 0
            ? null
            : (ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid]);
          compression.savings = {
            files_compressed: compressEvents.length,
            total_bytes_saved: totalSaved,
            median_ratio: medianRatio === null ? null : Number(medianRatio.toFixed(4)),
            last_run_at: compressEvents[compressEvents.length - 1].ts || null,
          };
        }
      }
    } catch { /* swallow — savings info is purely informational */ }
  } catch { /* swallow — compression info is best-effort */ }

  function buildResult(status) {
    return { status, version, update, compression, issues, project_root: projectRoot, repairable_count: issues.filter((i) => i.repairable).length };
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
      const cfgRaw = fs.readFileSync(configPath, "utf8");
      const cfgParse = safeJsonParse(cfgRaw, "config.json");
      if (!cfgParse.ok) throw new Error(cfgParse.error);
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

  // W005: .gitignore lacks any .devt/state form
  // W015: .gitignore has flat form but not recursive (sub-tree leak risk)
  const gitignorePath = path.join(projectRoot, ".gitignore");
  try {
    const content = fs.readFileSync(gitignorePath, "utf8");
    const hasRecursive = content.includes("**/.devt/state/");
    const hasFlat = content.includes(".devt/state");
    if (!hasFlat && !hasRecursive) {
      add("W005");
    } else if (hasFlat && !hasRecursive) {
      add("W015");
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
      const pjRaw = fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8");
      const pjParse = safeJsonParse(pjRaw, "plugin.json");
      if (!pjParse.ok) throw new Error(pjParse.error);
      const pluginJson = pjParse.value;
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
      const mfRaw = fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8");
      const mfParse = safeJsonParse(mfRaw, "plugin.json");
      if (!mfParse.ok) throw new Error(mfParse.error);
      const manifest = mfParse.value;
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
      const hcRaw = fs.readFileSync(hooksJsonPath, "utf8");
      const hcParse = safeJsonParse(hcRaw, "hooks.json");
      if (!hcParse.ok) throw new Error(hcParse.error);
      const hooksConfig = hcParse.value;
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

  // I003: No active workflow
  if (!state.active) {
    add("I003");
  }

  // I004: Pending promotion candidates in _suggestions.md — surface count so the
  // discovery harvest doesn't rot silently between curator runs.
  try {
    const suggPath = path.join(devtDir, "memory", "_suggestions.md");
    if (fs.existsSync(suggPath)) {
      const sugg = fs.readFileSync(suggPath, "utf8");
      const matches = sugg.match(/^###\s+[⚖️🔵]/gm);
      const n = matches ? matches.length : 0;
      if (n > 0) add("I004", `${n} candidate${n === 1 ? "" : "s"}`, { count: n });
    }
  } catch { /* memory dir absent or unreadable — silent skip */ }

  // Memory layer checks — native, deterministic, no agent in the loop.
  // Skip cleanly when memory layer hasn't been initialized.
  const memoryDir = path.join(devtDir, "memory");
  if (fs.existsSync(memoryDir)) {
    try {
      const memMod = require("./memory.cjs");
      const roots = memMod.getMemoryRoots();
      // MEM_PATH_UNREACHABLE — any configured root that doesn't exist
      const unreachable = roots.filter(r => !fs.existsSync(r));
      for (const r of unreachable) {
        add("MEM_PATH_UNREACHABLE", r, { path: r });
      }

      // MEM_INDEX_STALE — index.db older than the most recent .md mtime across all roots
      const dbPath = path.join(memoryDir, "index.db");
      if (fs.existsSync(dbPath)) {
        const dbMtime = fs.statSync(dbPath).mtimeMs;
        let newestMdMtime = 0;
        for (const root of roots) {
          if (!fs.existsSync(root)) continue;
          for (const sub of ["decisions", "concepts", "flows", "rejected"]) {
            const subdir = path.join(root, sub);
            if (!fs.existsSync(subdir)) continue;
            for (const entry of fs.readdirSync(subdir)) {
              if (entry.startsWith("_")) continue;
              if (!entry.endsWith(".md")) continue;
              const m = fs.statSync(path.join(subdir, entry)).mtimeMs;
              if (m > newestMdMtime) newestMdMtime = m;
            }
          }
        }
        if (newestMdMtime > dbMtime) {
          add("MEM_INDEX_STALE", `newest .md is ${Math.round((newestMdMtime - dbMtime) / 1000)}s newer than index.db`,
              { db_mtime_ms: dbMtime, newest_md_mtime_ms: newestMdMtime });
        }
      }

      // MEM_VALIDATE_ERRORS — surface count from memory.validate
      try {
        const v = memMod.validate();
        if (v && v.summary && v.summary.errors > 0) {
          add("MEM_VALIDATE_ERRORS", `${v.summary.errors} error(s)`,
              { errors: v.summary.errors, warnings: v.summary.warnings || 0 });
        }
      } catch { /* validate may throw if index missing — skipped already */ }
    } catch { /* memory module load failed — skip silently */ }
  }

  // Drift case: Graphify installed after /devt:setup --init never gets registered in .mcp.json.
  // Read .mcp.json first — when graphify is already registered (the common case) we
  // skip the subprocess probe entirely.
  try {
    const mcpPath = path.join(projectRoot, ".mcp.json");
    let registered = false;
    if (fs.existsSync(mcpPath)) {
      try {
        const raw = fs.readFileSync(mcpPath, "utf8");
        const result = require("./security.cjs").safeJsonParse(raw, ".mcp.json", 1024 * 1024);
        registered = !!(result.ok && result.value?.mcpServers?.graphify);
      } catch { /* unreadable .mcp.json — treat as unregistered */ }
    }
    if (!registered && require("./graphify.cjs").probeBinary()) {
      add("GRAPHIFY_MCP_UNREGISTERED", null, { binary_on_path: true, mcp_json_exists: fs.existsSync(mcpPath) });
    }
  } catch { /* swallow */ }

  // Detect graphify skill/binary version drift. Only probes when the
  // binary is on PATH (otherwise nothing to compare against). Skipping the
  // probe when graphify is absent keeps health fast on projects that don't
  // use graphify at all.
  try {
    if (require("./graphify.cjs").probeBinary()) {
      const drift = require("./graphify.cjs").detectSkillVersionDrift();
      if (drift.detected) {
        add("GRAPHIFY_SKILL_DRIFT", `skill ${drift.skill_version} vs binary ${drift.binary_version}`, drift);
      }
    }
  } catch { /* swallow */ }

  // PROBE_FAILURES_RECENT (Q4) — surface diagnostic categories from the
  // probe failure log. Only flag when there's recent activity (last 24h) so
  // long-stale logs don't perpetually warn after the user fixed the cause.
  try {
    const probeLog = path.join(devtDir, "state", "probe-failures.jsonl");
    if (fs.existsSync(probeLog)) {
      const lines = fs.readFileSync(probeLog, "utf8").split("\n").filter(Boolean);
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const categories = {};
      let recent = 0;
      for (const line of lines.slice(-50)) {
        try {
          const rec = JSON.parse(line);
          const ts = rec.ts ? new Date(rec.ts).getTime() : 0;
          if (ts >= cutoff) {
            recent++;
            const c = rec.category || "unknown";
            categories[c] = (categories[c] || 0) + 1;
          }
        } catch { /* skip malformed line */ }
      }
      if (recent > 0) {
        add("PROBE_FAILURES_RECENT", `${recent} in last 24h`, { recent_count: recent, categories });
      }
    }
  } catch { /* swallow — diagnostic surface, never raise */ }

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
          atomicWriteJsonSync(configPath, DEFAULTS);
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
            // Bootstrap with recursive pattern (catches sub-tree devt invocations).
            fs.appendFileSync(gitignorePath, "\n# devt workflow state (recursive — catches sub-tree devt invocations)\n**/.devt/state/\n");
          } catch {
            atomicWriteFileSync(gitignorePath, "# devt workflow state (recursive — catches sub-tree devt invocations)\n**/.devt/state/\n");
          }
          repairs.push({ code: issue.code, action: "Added **/.devt/state/ (recursive) to .gitignore", success: true });
          break;
        }

        case "W015": {
          // Append recursive **/.devt/state/ alongside existing flat
          // entry. Reuses the setup module's upgradeGitignore helper so the
          // append shape stays canonical.
          const { run: setupRun } = require("./setup.cjs");
          const r = setupRun(["--upgrade-gitignore"]);
          const appended = (r && Array.isArray(r.appended) ? r.appended : []).join(", ") || "(none)";
          repairs.push({ code: issue.code, action: `Appended recursive .gitignore patterns: ${appended}`, success: true });
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

        case "MEM_INDEX_STALE": {
          // MEM_INDEX_STALE was declared repairable: true in the issue
          // catalogue but had no matching switch case, so `health --repair`
          // returned repairs: [] despite the warning being repairable.
          // Users hit "Yes — auto-repair" and the system reported success
          // without actually rebuilding the index; they had to fall back
          // to `memory index` manually. The repair is exactly that CLI
          // call surfaced through the official handler so the auto-repair
          // button works as advertised.
          const { rebuildIndex } = require("./memory.cjs");
          const result = rebuildIndex();
          if (result && result.ok !== false) {
            // rebuildIndex returns `inserted`, not `indexed_count` /
            // `doc_count`. The legacy field-name fallback chain always
            // resolved to 0, making every successful rebuild report
            // "doc_count=0" even when the FTS5 index was populated
            // correctly. Keep the legacy fallbacks for forward-compat with
            // any caller that might return one of those keys; just put
            // `inserted` first.
            const docCount = (result && result.inserted) || (result && result.indexed_count) || (result && result.doc_count) || 0;
            const conflictCount = (result && Array.isArray(result.conflicts)) ? result.conflicts.length : 0;
            repairs.push({
              code: issue.code,
              action: `Rebuilt FTS5 index (memory index, doc_count=${docCount}, conflict_count=${conflictCount})`,
              success: true,
            });
          } else {
            const errMsg = (result && (result.error || (Array.isArray(result.errors) && result.errors.length > 0 && result.errors[0].error))) || "unknown";
            repairs.push({
              code: issue.code,
              action: `Rebuild failed: ${errMsg}`,
              success: false,
            });
          }
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
