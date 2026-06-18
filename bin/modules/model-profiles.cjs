"use strict";

/**
 * Model profiles — maps agent types to model tiers.
 *
 * Profiles: quality, balanced (default), budget, inherit
 * Per-agent overrides via .devt/config.json "model_overrides" key.
 */

/**
 * Maps short aliases to current Anthropic model IDs.
 * Update this constant when Anthropic releases new model versions.
 */
const MODEL_ALIAS_MAP = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5",
};

/**
 * Resolve a model alias to its full Anthropic model ID.
 * Returns the alias unchanged if it is "inherit" or already a full model ID.
 */
function resolveModelId(alias) {
  if (!alias || alias === "inherit") return alias;
  return MODEL_ALIAS_MAP[alias] || alias;
}

const PROFILES = {
  quality: {
    programmer: "opus",
    tester: "opus",
    "code-reviewer": "opus",
    "docs-writer": "opus",
    architect: "opus",
    retro: "opus",
    curator: "opus",
    debugger: "opus",
    verifier: "opus",
    researcher: "opus",
  },
  balanced: {
    programmer: "opus",
    tester: "sonnet",
    "code-reviewer": "opus",
    "docs-writer": "sonnet",
    architect: "opus",
    retro: "sonnet",
    curator: "sonnet",
    debugger: "opus",
    verifier: "opus",
    researcher: "sonnet",
  },
  budget: {
    programmer: "sonnet",
    tester: "sonnet",
    "code-reviewer": "sonnet",
    "docs-writer": "haiku",
    architect: "sonnet",
    retro: "haiku",
    curator: "haiku",
    debugger: "sonnet",
    verifier: "sonnet",
    researcher: "haiku",
  },
  inherit: {
    programmer: "inherit",
    tester: "inherit",
    "code-reviewer": "inherit",
    "docs-writer": "inherit",
    architect: "inherit",
    retro: "inherit",
    curator: "inherit",
    debugger: "inherit",
    verifier: "inherit",
    researcher: "inherit",
  },
};

/**
 * Per-agent effort settings parallel to PROFILES. Calibrated to agent role:
 *   - architect/verifier always benefit from high (design + rubric grading)
 *   - code-reviewer/debugger benefit from medium-to-high (analysis-heavy)
 *   - programmer/researcher medium for balanced (synthesis tasks)
 *   - retro/tester/docs-writer/curator can drop to low for budget (mechanical)
 *
 * Why this exists: Opus 4.8 flipped the API-level effort default from `medium`
 * to `high`. Without explicit per-agent settings, every devt dispatch silently
 * spends 30-50% more tokens than necessary. Operators consuming these via
 * dispatch envelopes (effort="{efforts.<agent>}") opt out of the silent
 * regression on a per-role basis.
 *
 * effort values follow Anthropic's Claude API surface: `low`, `medium`, `high`
 * (plus `inherit` for the inherit profile, which defers to the caller's env).
 */
const EFFORTS = {
  quality: {
    programmer: "high",
    tester: "medium",
    "code-reviewer": "high",
    "docs-writer": "medium",
    architect: "high",
    retro: "medium",
    curator: "medium",
    debugger: "high",
    verifier: "high",
    researcher: "high",
  },
  balanced: {
    programmer: "medium",
    tester: "low",
    "code-reviewer": "medium",
    "docs-writer": "low",
    architect: "high",
    retro: "medium",
    curator: "low",
    debugger: "medium",
    verifier: "high",
    researcher: "medium",
  },
  budget: {
    programmer: "low",
    tester: "low",
    "code-reviewer": "low",
    "docs-writer": "low",
    architect: "medium",
    retro: "low",
    curator: "low",
    debugger: "low",
    verifier: "medium",
    researcher: "low",
  },
  inherit: {
    programmer: "inherit",
    tester: "inherit",
    "code-reviewer": "inherit",
    "docs-writer": "inherit",
    architect: "inherit",
    retro: "inherit",
    curator: "inherit",
    debugger: "inherit",
    verifier: "inherit",
    researcher: "inherit",
  },
};

const VALID_AGENTS = new Set(Object.keys(PROFILES.balanced));
const VALID_EFFORTS = new Set(["low", "medium", "high", "inherit"]);

function getModels(profileName, overrides) {
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(
      `Unknown profile: ${profileName}. Available: ${Object.keys(PROFILES).join(", ")}`,
    );
  }
  if (overrides && typeof overrides === "object") {
    const warnings = [];
    const validOverrides = {};
    for (const key of Object.keys(overrides)) {
      if (VALID_AGENTS.has(key)) {
        validOverrides[key] = overrides[key];
      } else {
        warnings.push(key);
      }
    }
    if (warnings.length > 0) {
      process.stderr.write(
        JSON.stringify({
          warning: `Unknown agent(s) in model_overrides: ${warnings.join(", ")}. Valid agents: ${[...VALID_AGENTS].join(", ")}`,
        }) + "\n",
      );
    }
    return { ...profile, ...validOverrides };
  }
  return { ...profile };
}

/**
 * Resolve per-agent effort settings for a profile. Mirrors getModels()'s shape:
 * accepts optional overrides via .devt/config.json::effort_overrides.
 */
function getEfforts(profileName, overrides) {
  const profile = EFFORTS[profileName];
  if (!profile) {
    throw new Error(
      `Unknown profile: ${profileName}. Available: ${Object.keys(EFFORTS).join(", ")}`,
    );
  }
  if (overrides && typeof overrides === "object") {
    const warnings = [];
    const validOverrides = {};
    for (const key of Object.keys(overrides)) {
      if (!VALID_AGENTS.has(key)) {
        warnings.push(`unknown agent: ${key}`);
        continue;
      }
      const v = overrides[key];
      if (typeof v !== "string" || !VALID_EFFORTS.has(v)) {
        warnings.push(`invalid effort for ${key}: ${v} (valid: low, medium, high, inherit)`);
        continue;
      }
      validOverrides[key] = v;
    }
    if (warnings.length > 0) {
      process.stderr.write(
        JSON.stringify({ warning: `effort_overrides issues: ${warnings.join("; ")}` }) + "\n",
      );
    }
    return { ...profile, ...validOverrides };
  }
  return { ...profile };
}

/**
 * Resolve all aliases in an agent-model map to full model IDs.
 */
function resolveAll(agentModelMap) {
  const resolved = {};
  for (const [agent, alias] of Object.entries(agentModelMap)) {
    resolved[agent] = resolveModelId(alias);
  }
  return resolved;
}

function formatAsTable(agentModelMap) {
  const agents = Object.keys(agentModelMap);
  const agentWidth = Math.max(5, ...agents.map((a) => a.length));
  const modelWidth = Math.max(5, ...Object.values(agentModelMap).map((m) => m.length));
  const sep = "─".repeat(agentWidth + 2) + "┼" + "─".repeat(modelWidth + 2);
  let table = " " + "Agent".padEnd(agentWidth) + " │ " + "Model".padEnd(modelWidth) + "\n" + sep + "\n";
  for (const [agent, model] of Object.entries(agentModelMap)) {
    table += " " + agent.padEnd(agentWidth) + " │ " + model.padEnd(modelWidth) + "\n";
  }
  return table;
}

function run(subcommand, args) {
  switch (subcommand) {
    case "get": {
      const profileName = args[0] || "balanced";
      return getModels(profileName);
    }
    case "resolve": {
      const profileName = args[0] || "balanced";
      return resolveAll(getModels(profileName));
    }
    case "list":
      return {
        profiles: Object.keys(PROFILES),
        agents: Object.keys(PROFILES.balanced),
      };
    case "table": {
      const profileName = args[0] || "balanced";
      return { table: formatAsTable(getModels(profileName)) };
    }
    case "efforts": {
      const profileName = args[0] || "balanced";
      return getEfforts(profileName);
    }
    case "efforts-table": {
      const profileName = args[0] || "balanced";
      return { table: formatAsTable(getEfforts(profileName)) };
    }
    default:
      throw new Error(
        `Unknown models subcommand: ${subcommand}. Use: get, resolve, list, table, efforts, efforts-table`,
      );
  }
}

module.exports = { run, getModels, getEfforts, resolveModelId, resolveAll, formatAsTable, PROFILES, EFFORTS, MODEL_ALIAS_MAP };
