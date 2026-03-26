#!/usr/bin/env node
'use strict';

/**
 * devt CLI tools — state machine bridge between markdown prompts and filesystem state.
 *
 * Zero dependencies. Node.js stdlib only.
 * Follows GSD's compound-init pattern: one call returns all context as JSON.
 *
 * Usage:
 *   node devt-tools.cjs init workflow "<task>"    # Compound init for workflows
 *   node devt-tools.cjs state read                # Read workflow state
 *   node devt-tools.cjs state update key=value    # Update workflow state
 *   node devt-tools.cjs state reset               # Clean .devt-state/
 *   node devt-tools.cjs config get                # Get merged config
 *   node devt-tools.cjs config set key=value      # Set project config
 *   node devt-tools.cjs models get <profile>      # Get agent→model mapping
 *   node devt-tools.cjs setup --template <name>   # Interactive project setup
 */

const path = require('path');

// Module imports
const initCmd = require('./modules/init.cjs');
const state = require('./modules/state.cjs');
const config = require('./modules/config.cjs');
const modelProfiles = require('./modules/model-profiles.cjs');
const setup = require('./modules/setup.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..');

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  if (!command) {
    printUsage();
    process.exit(1);
  }

  try {
    switch (command) {
      case 'init':
        console.log(JSON.stringify(initCmd.run(subcommand, args.slice(2), PLUGIN_ROOT)));
        break;
      case 'state':
        console.log(JSON.stringify(state.run(subcommand, args.slice(2))));
        break;
      case 'config':
        console.log(JSON.stringify(config.run(subcommand, args.slice(2))));
        break;
      case 'models':
        console.log(JSON.stringify(modelProfiles.run(subcommand, args.slice(2))));
        break;
      case 'setup':
        console.log(JSON.stringify(setup.run(args.slice(1), PLUGIN_ROOT)));
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

function printUsage() {
  console.error(`
devt-tools — CLI for the devt plugin

Commands:
  init <workflow> [task]    Compound init — returns JSON context blob
  state read|update|reset   Manage .devt-state/ workflow state
  config get|set            Config resolution (defaults ← global ← project)
  models get <profile>      Agent→model mapping for a profile
  setup --template <name>   Scaffold .dev-rules/ for a project
`);
}

main();
