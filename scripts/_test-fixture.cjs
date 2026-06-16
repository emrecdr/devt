"use strict";

/**
 * Shared test-fixture helpers for `scripts/test-*.cjs`.
 *
 * Extracted from `scripts/test-graphify.cjs::setupFixture` so subsequent gate
 * tests (`test-gates.cjs`, etc.) can share the same temp-project shape without
 * re-implementing mkdtemp + .devt/ + config scaffolding. The graphify-specific
 * graph.json setup stays in `test-graphify.cjs` — this module is the project-
 * shell-only common subset.
 *
 * Exports:
 *   setupDevtFixture(opts?) → { tmp, devtDir, stateDir, runCli, cleanup }
 *   seedArtifact(stateDir, relpath, content) → void
 *
 * The `runCli(...args)` closure spawns the project's devt-tools.cjs from the
 * tmp project, eliminating per-test spawn boilerplate.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "devt-tools.cjs");

/**
 * Create a fresh devt-shaped project under an OS temp directory.
 *
 * @param {object} [opts]
 * @param {object} [opts.config] - Override config.json contents (replaces default).
 * @param {boolean} [opts.graphify=false] - Add minimal graphify-out/graph.json scaffold.
 * @param {object} [opts.graph] - Custom graph.json contents (when graphify=true).
 * @returns {{tmp, devtDir, stateDir, runCli, cleanup}}
 */
function setupDevtFixture(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devt-test-"));
  const devtDir = path.join(tmp, ".devt");
  const stateDir = path.join(devtDir, "state");
  const rulesDir = path.join(devtDir, "rules");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(rulesDir, { recursive: true });
  // When graphify=true we want graphify.status() to report "ready" — that
  // requires BOTH config.graphify.enabled=true AND graph.json on disk. The
  // explicit `command` keeps the binary-resolve path predictable for tests.
  const defaultGraphifyEnabled = !!opts.graphify;
  const config = opts.config || {
    graphify: {
      enabled: defaultGraphifyEnabled,
      command: opts.command || "graphify-not-on-path",
    },
  };
  fs.writeFileSync(path.join(devtDir, "config.json"), JSON.stringify(config, null, 2));
  if (opts.graphify) {
    const graphDir = path.join(tmp, "graphify-out");
    fs.mkdirSync(graphDir, { recursive: true });
    const defaultGraph = {
      built_at_commit: "test",
      nodes: [{ id: "a", label: "A", source_file: "src/a.py", file_type: "code" }],
      links: [],
      hyperedges: [],
    };
    fs.writeFileSync(path.join(graphDir, "graph.json"), JSON.stringify(opts.graph || defaultGraph));
  }
  const runCli = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], {
      cwd: tmp, encoding: "utf8", timeout: 10000,
    });
    return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
  };
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  return { tmp, devtDir, stateDir, runCli, cleanup };
}

/**
 * Write an arbitrary file under .devt/state/. Auto-creates parent dirs so
 * tests can seed nested paths like `lanes/L1.json` without setup boilerplate.
 *
 * @param {string} stateDir - .devt/state path from setupDevtFixture
 * @param {string} relpath - relative path under stateDir
 * @param {string} content - file contents (utf8)
 */
function seedArtifact(stateDir, relpath, content) {
  const target = path.join(stateDir, relpath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

module.exports = { setupDevtFixture, seedArtifact };
