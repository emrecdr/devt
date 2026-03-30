#!/usr/bin/env node
"use strict";

/**
 * devt CLI tools — state machine bridge between markdown prompts and filesystem state.
 *
 * Zero dependencies. Node.js stdlib only.
 * Compound-init pattern: one call returns all context as JSON.
 *
 * Usage:
 *   node devt-tools.cjs init workflow "<task>"    # Compound init for workflows
 *   node devt-tools.cjs state read                # Read workflow state
 *   node devt-tools.cjs state update key=value    # Update workflow state
 *   node devt-tools.cjs state reset               # Clean .devt/state/
 *   node devt-tools.cjs config get                # Get merged config
 *   node devt-tools.cjs config set key=value      # Set project config
 *   node devt-tools.cjs models get <profile>      # Get agent→model mapping
 *   node devt-tools.cjs setup --template <name>   # Interactive project setup
 */

const path = require("path");

// Module imports
const initCmd = require("./modules/init.cjs");
const state = require("./modules/state.cjs");
const config = require("./modules/config.cjs");
const modelProfiles = require("./modules/model-profiles.cjs");
const setup = require("./modules/setup.cjs");
const update = require("./modules/update.cjs");

const PLUGIN_ROOT = path.resolve(__dirname, "..");

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
      case "init":
        console.log(
          JSON.stringify(initCmd.run(subcommand, args.slice(2), PLUGIN_ROOT)),
        );
        break;
      case "state":
        console.log(JSON.stringify(state.run(subcommand, args.slice(2))));
        break;
      case "config":
        console.log(JSON.stringify(config.run(subcommand, args.slice(2))));
        break;
      case "models":
        console.log(
          JSON.stringify(modelProfiles.run(subcommand, args.slice(2))),
        );
        break;
      case "setup":
        console.log(JSON.stringify(setup.run(args.slice(1), PLUGIN_ROOT)));
        break;
      case "semantic":
        console.log(
          JSON.stringify(require("./modules/semantic.cjs").run(subcommand, args.slice(2), PLUGIN_ROOT)),
        );
        break;
      case "report":
        console.log(
          JSON.stringify(require("./modules/weekly-report.cjs").run(subcommand, args.slice(2))),
        );
        break;
      case "health":
        console.log(JSON.stringify(require("./modules/health.cjs").run(args.slice(1), PLUGIN_ROOT)));
        break;
      case "update":
        update.run(subcommand, args.slice(2), PLUGIN_ROOT).then((result) => {
          console.log(JSON.stringify(result));
        }).catch((err) => {
          console.error(JSON.stringify({ error: err.message }));
          process.exit(1);
        });
        return; // async — don't fall through to main() exit
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
  init <workflow|review> [task]  Compound init — returns JSON context blob
  state read|update|reset   Manage .devt/state/ workflow state
  config get|set            Config resolution (defaults ← global ← project)
  models get <profile>      Agent→model mapping for a profile
  setup --template <name>   Scaffold .devt/rules/ for a project
        [--mode create|update|reinit]  create=fresh, update=add missing, reinit=overwrite
        [--config JSON]    Extra config to merge into .devt/config.json
        [--detect]         Just detect stack and git info, don't set up
  semantic sync             Sync learning-playbook.md → FTS5 database
  semantic query <terms>    Query lessons by keyword (FTS5 or grep fallback)
  semantic compact          Archive stale lessons (--dry-run to preview)
  semantic status           Show database, playbook, and entry count
  report window [--weeks N] Compute reporting time window
  report generate [--weeks N] [--output PATH]  Generate contribution report
  health [--repair]         Validate project config, state, hooks. --repair auto-fixes safe issues
  update check [--force]    Check for newer version on GitHub (--force bypasses cache)
  update status             Combined: install type + dirty tree + version (one call)
  update local-version      Show installed version
  update install-type       Detect how devt was installed (plugin/git/unknown)
  update dirty              Check for local modifications in plugin directory
  update clear-cache        Clear the update check cache
  update changelog          Fetch and parse changelog from GitHub
`);
}

main();
