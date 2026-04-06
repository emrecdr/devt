"use strict";

/**
 * Model profiles — maps agent types to model tiers.
 *
 * Profiles: quality (default), balanced, budget, inherit
 * Per-agent overrides via .devt/config.json "model_overrides" key.
 */

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

const VALID_AGENTS = new Set(Object.keys(PROFILES.balanced));

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
      const profileName = args[0] || "quality";
      return getModels(profileName);
    }
    case "list":
      return {
        profiles: Object.keys(PROFILES),
        agents: Object.keys(PROFILES.balanced),
      };
    case "table": {
      const profileName = args[0] || "quality";
      return { table: formatAsTable(getModels(profileName)) };
    }
    default:
      throw new Error(
        `Unknown models subcommand: ${subcommand}. Use: get, list, table`,
      );
  }
}

module.exports = { run, getModels, formatAsTable, PROFILES };
