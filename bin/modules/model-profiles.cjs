'use strict';

/**
 * Model profiles — maps agent types to model tiers.
 *
 * Profiles: quality, balanced (default), budget, inherit
 * Per-agent overrides via .devt.json "model_overrides" key.
 */

const PROFILES = {
  quality: {
    programmer: 'opus',
    tester: 'opus',
    'code-reviewer': 'opus',
    'docs-writer': 'opus',
    architect: 'opus',
    retro: 'opus',
    curator: 'opus'
  },
  balanced: {
    programmer: 'opus',
    tester: 'sonnet',
    'code-reviewer': 'opus',
    'docs-writer': 'sonnet',
    architect: 'opus',
    retro: 'sonnet',
    curator: 'sonnet'
  },
  budget: {
    programmer: 'sonnet',
    tester: 'sonnet',
    'code-reviewer': 'sonnet',
    'docs-writer': 'haiku',
    architect: 'sonnet',
    retro: 'haiku',
    curator: 'haiku'
  },
  inherit: {
    programmer: 'inherit',
    tester: 'inherit',
    'code-reviewer': 'inherit',
    'docs-writer': 'inherit',
    architect: 'inherit',
    retro: 'inherit',
    curator: 'inherit'
  }
};

function getModels(profileName, overrides) {
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown profile: ${profileName}. Available: ${Object.keys(PROFILES).join(', ')}`);
  }
  if (overrides && typeof overrides === 'object') {
    return { ...profile, ...overrides };
  }
  return { ...profile };
}

function run(subcommand, args) {
  switch (subcommand) {
    case 'get': {
      const profileName = args[0] || 'balanced';
      return getModels(profileName);
    }
    case 'list':
      return { profiles: Object.keys(PROFILES), agents: Object.keys(PROFILES.balanced) };
    default:
      throw new Error(`Unknown models subcommand: ${subcommand}. Use: get, list`);
  }
}

module.exports = { run, getModels, PROFILES };
