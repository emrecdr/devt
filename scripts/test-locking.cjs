#!/usr/bin/env node
"use strict";

/**
 * Concurrent locking test for .devt/state/workflow.yaml writes.
 *
 * Spawns N parallel child processes that each issue a `state update` against
 * the same workflow file. The lock primitive in bin/modules/state.cjs must
 * serialize them so every write lands — no lost updates, no corrupted YAML,
 * no orphaned .lock file.
 *
 * Run: node scripts/test-locking.js
 * Exits 0 on success, 1 on any failure.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "devt-tools.cjs");
const WORKERS = 20;

function log(msg) { process.stdout.write(msg + "\n"); }
function fail(msg) { process.stderr.write("FAIL: " + msg + "\n"); process.exit(1); }

function runWorker(cwd, workerId) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [CLI, "state", "update", `worker_${workerId}=value_${workerId}`],
      { cwd, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("exit", (code) => resolve({ workerId, code, stderr }));
  });
}

async function main() {
  // Set up a temp project directory with a minimal workflow
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devt-lock-"));
  const stateDir = path.join(tmp, ".devt", "state");
  fs.mkdirSync(stateDir, { recursive: true });
  // Seed an empty workflow.yaml so updates have something to merge into
  fs.writeFileSync(path.join(stateDir, "workflow.yaml"), "active: true\n");

  log(`== Concurrent locking test (${WORKERS} workers) ==`);
  log(`Temp project: ${tmp}`);

  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => runWorker(tmp, i))
  );
  const elapsed = Date.now() - start;

  // Assert: all workers exited 0
  const failed = results.filter((r) => r.code !== 0);
  if (failed.length) {
    failed.forEach((r) => log(`  worker ${r.workerId} exited ${r.code}: ${r.stderr.trim()}`));
    fail(`${failed.length}/${WORKERS} workers failed`);
  }
  log(`  PASS: all ${WORKERS} workers exited 0 (${elapsed}ms)`);

  // Assert: workflow.yaml still parses and contains every worker's key
  const finalPath = path.join(stateDir, "workflow.yaml");
  const content = fs.readFileSync(finalPath, "utf8");
  const present = [];
  const missing = [];
  for (let i = 0; i < WORKERS; i++) {
    if (new RegExp(`^worker_${i}: value_${i}$`, "m").test(content)) {
      present.push(i);
    } else {
      missing.push(i);
    }
  }
  if (missing.length) {
    log("---- workflow.yaml ----");
    log(content);
    log("-----------------------");
    fail(`${missing.length}/${WORKERS} writes were lost: workers ${missing.join(",")}`);
  }
  log(`  PASS: all ${WORKERS} keys present in workflow.yaml (no lost updates)`);

  // Assert: no orphaned .lock file
  const lockPath = path.join(stateDir, ".lock");
  if (fs.existsSync(lockPath)) {
    fail(`orphaned .lock file remains at ${lockPath}`);
  }
  log("  PASS: .lock file cleaned up after all workers");

  // Cleanup
  fs.rmSync(tmp, { recursive: true, force: true });
  log(`\n== Result: 3/3 assertions passed ==`);
}

main().catch((e) => fail(e.stack || e.message));
