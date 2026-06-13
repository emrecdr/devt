#!/usr/bin/env node
"use strict";

/**
 * devt CLI tools — state machine bridge between markdown prompts and filesystem state.
 *
 * Zero dependencies. Node.js stdlib only.
 * Compound-init pattern: one call returns all context as JSON.
 *
 * Usage:
 * node devt-tools.cjs init workflow "<task>" # Compound init for workflows
 * node devt-tools.cjs state read # Read workflow state
 * node devt-tools.cjs state update key=value # Update workflow state
 * node devt-tools.cjs state reset # Clean .devt/state/
 * node devt-tools.cjs config get # Get merged config
 * node devt-tools.cjs config set key=value # Set project config
 * node devt-tools.cjs models get <profile> # Get agent→model mapping
 * node devt-tools.cjs setup --template <name> # Interactive project setup
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
      case "memory": {
        // memory subcommand prints its own JSON via process.stdout.write — don't double-encode here.
        const code = require("./modules/memory.cjs").run(subcommand, args.slice(2));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "graphify": {
        // graphify subcommand — optional; degrades gracefully when graphify.enabled=false
        const code = require("./modules/graphify.cjs").run(subcommand, args.slice(2));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "discovery": {
        // discovery subcommand — #KNOWLEDGE-CANDIDATE + DEC-xxx + graphify god-node harvest
        const code = require("./modules/discovery.cjs").run(subcommand, args.slice(2));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "preflight": {
        // preflight subcommand — Topic Pre-Flight Brief
        const code = require("./modules/preflight.cjs").run(subcommand, args.slice(2));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "deferred": {
        // deferred subcommand — DEF-NNN TODO tracker at .devt/state/deferred.md
        const code = require("./modules/deferred.cjs").run(subcommand, args.slice(2));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "token-report": {
        // token-report — aggregate Claude Code session token usage
        const code = require("./modules/token-report.cjs").run(subcommand, args.slice(2));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "static-compress": {
        // First positional after `static-compress` is the file path (no
        // sub-action verbs); pass args.slice(1) so the path lands in args[0].
        const code = require("./modules/static-compress.cjs").run(null, args.slice(1));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "mcp-stats": {
        // mcp-stats — aggregate MCP tool-call traces
        const code = require("./modules/mcp-stats.cjs").run(subcommand, args.slice(2));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "hook-cost-estimate": {
        // hook-cost-estimate — per-hook migration ROI from run-hook.jsonl trace
        const code = require("./modules/hook-cost.cjs").run(args.slice(1));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "bash-guard": {
        // bash-guard — PreToolUse Bash classifier; reads stdin tool-call JSON,
        // emits hook response. See bin/modules/bash-guard.cjs.
        const code = require("./modules/bash-guard.cjs").run(subcommand);
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "stuck": {
        // stuck — count deny records in current workflow session; reports
        // stuck=true at ≥3 to trigger autonomous-mode pause.
        const code = require("./modules/stuck-detector.cjs").run(subcommand);
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "grade": {
        // grade <workflow_type> <sidecar.json> — deterministic pre-verifier
        // gate. Reads ## Deterministic Gates JSON from the rubric and walks
        // constraints against the sidecar; exits 0 on pass, 1 on fail.
        const code = require("./modules/grader.cjs").run(subcommand, args.slice(2));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
      case "dispatch": {
        // dispatch — compile-time generation of per-agent dispatch envelopes
        // from agents/io-contracts.yaml + templates/dispatch/. Closes the
        // "Smoke test (future)" TODO at agents/io-contracts.yaml:29.
        const code = require("./modules/dispatch.cjs").run(subcommand, args.slice(2));
        if (typeof code === "number" && code !== 0) process.exit(code);
        break;
      }
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
  state audit               Classify .devt/state/ files: canonical | pattern_allowed | ephemeral | ad_hoc
  state cleanup [--apply] [--stale-days=N]
                            Archive ad_hoc + ephemeral + stale pattern_allowed files to .archive/cleanup-<ts>/
  config get|set            Config resolution (defaults ← global ← project)
  models get <profile>      Agent→model mapping for a profile
  setup --template <name>   Scaffold .devt/rules/ for a project
        [--mode create|update|reinit]  create=fresh, update=add missing, reinit=overwrite
        [--config JSON]    Extra config to merge into .devt/config.json
        [--detect]         Just detect stack and git info, don't set up
  memory init               Scaffold .devt/memory/ + first FTS5 index pass
  memory index              Atomic drop+rebuild of the unified memory FTS5 index
  memory query <terms>      Full-text search across ADR/CON/FLOW/REJ/LES docs
                            [--limit=N] [--doc-type=decision|concept|flow|rejected|lesson]
  memory get <doc-id>       Fetch a single doc by id (e.g. ADR-007, LES-001)
  memory affects <path>     Which active/candidate docs govern this file? (glob-aware)
  memory list [doc_type]    List all docs (decision|concept|flow|rejected|lesson)
  memory links <id> [--depth=N]  Transitive link traversal (default depth 2)
  memory active [domain]    All status:active docs, optionally domain-filtered
  memory rejected-keywords  All REJ tombstones with their AI-suppression keywords
  memory validate           Frontmatter + path-resolution + broken-link checks
  memory backlinks <id>     What links TO this doc (load-bearing for safe ADR supersession)
  memory orphans            Docs with no incoming or outgoing links (possibly stale)
  memory stale-links        Links pointing to non-existent target docs
  memory affects-symbol <s> AST-anchored symbol lookup (Graphify-backed when enabled)
  memory suggest            Run discovery: #KNOWLEDGE-CANDIDATE + DEC-xxx + graphify god-node harvest
                            Writes proposals to .devt/memory/_suggestions.md (NEVER auto-promotes)
  deferred add "<title>"    Capture a deferred TODO to .devt/state/deferred.md (v0.29.0+)
                            [--context="..."] [--tags=a,b,c] [--by=<agent>]
                            Survives /devt:cancel-workflow (reset-exempted)
  deferred list             List deferred items [--status=open|closed] [--tag=X] [--limit=N]
  deferred get <DEF-ID>     Fetch a single deferred item
  deferred close <DEF-ID>   Mark deferred item as closed [--by=<agent>]
  deferred reopen <DEF-ID>  Reopen a closed deferred item
  deferred count            Counts: {open, closed, total}
  graphify status           Probe whether Graphify is enabled + binary present + graph.json exists
  graphify freshness        Compare graph.json built_at_commit to current HEAD
  graphify warm-cache       Return preferred warm-cache path (wiki/index.md OR GRAPH_REPORT.md)
  graphify query <text>     Search the Graphify knowledge graph (degrades to empty when disabled)
  graphify node <id>        Fetch a single node's definition + references
  graphify neighbors <sym>  Connected concepts (--direction=in|out|both, --depth=N)
  graphify path <a> <b>     Shortest path between two symbols
  graphify blast-radius <s> Effect-size estimate for editing a symbol (small|medium|large)
  dispatch list             List dispatch marker regions present in workflows/
  dispatch contracts        Print per-agent context_blocks resolved from io-contracts.yaml
  dispatch render <a>:<w>   Render one envelope to stdout (template form with placeholders)
  dispatch render-filled <a>:<w|auto>  Render envelope with state-driven placeholder substitution (use :auto to resolve workflow_id from active state)
  dispatch compile --check  Diff would-be-rendered vs committed marker regions; exit 1 on drift
  dispatch compile --write  Re-render marker regions atomically (manual pre-release step)
  dispatch decompose <a>:<w|auto>  Static/dynamic byte breakdown of the rendered envelope; surfaces which blocks dominate per-dispatch cache_creation cost
  discovery harvest         Same as 'memory suggest' — full discovery sweep
  discovery wiki-links      Just the wiki-link enrichment proposals
  preflight generate <task> Run Lanes A-F + blast radius; write .devt/state/preflight-brief.md
  preflight topic <task>    Just extract domains/symbols/keywords from a task description
  preflight status          Read current brief metadata (FRESH/STALE/MISSING + timestamp)
  preflight mark-stale [r]  Mark current brief STALE (called by File Pre-Flight on scope expansion)
  token-report              Aggregate Claude Code session token usage (cache hit rate, percentiles)
  mcp-stats                 Aggregate MCP tool-call traces (call counts, p95/p99 latency, error rate)
  mcp-stats --prune-older-than=30d  Compact the trace JSONL by dropping entries older than cutoff
  memory export [--out=PATH]      Export ADR/CON/FLOW/REJ docs to a portable JSON bundle
  memory import <bundle> [--prefix=ORG-] [--overwrite]  Restore docs from a bundle
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
