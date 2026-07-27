#!/usr/bin/env node
"use strict";

/**
 * generate-coordinator-table — renders workflows/do.md's routing table into
 * agents/devt-coordinator.md between the GENERATED markers.
 *
 * workflows/do.md is the single source of truth for routing rows; the
 * coordinator's copy is generated, never hand-edited (the hand-maintained era
 * drifted at the trigger-text level while row-count and command-token parity
 * gates stayed green).
 *
 *   --write   regenerate the marked region in place
 *   (default) check mode: exit 0 fresh / 1 stale / 2 structural error
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DO = path.join(ROOT, "workflows", "do.md");
const COORD = path.join(ROOT, "agents", "devt-coordinator.md");
const BEGIN_PREFIX = "<!-- BEGIN GENERATED: do.md routing table";
const END_LINE = "<!-- END GENERATED: do.md routing table -->";

function doTable() {
  const lines = fs.readFileSync(DO, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("| If the prompt describes"));
  if (start < 0) throw new Error("workflows/do.md routing-table header not found");
  let end = start;
  while (end + 1 < lines.length && lines[end + 1].startsWith("|")) end++;
  return lines.slice(start, end + 1).join("\n");
}

const cLines = fs.readFileSync(COORD, "utf8").split("\n");
const b = cLines.findIndex((l) => l.startsWith(BEGIN_PREFIX));
const e = cLines.findIndex((l) => l === END_LINE);
if (b < 0 || e < 0 || e <= b) {
  console.error("GENERATED markers not found (or inverted) in agents/devt-coordinator.md");
  process.exit(2);
}
const current = cLines.slice(b + 1, e).join("\n");
const expected = doTable();

if (process.argv.includes("--write")) {
  const next = [...cLines.slice(0, b + 1), expected, ...cLines.slice(e)].join("\n");
  fs.writeFileSync(COORD, next);
  console.log(current === expected ? "coordinator table already fresh" : "coordinator table regenerated from workflows/do.md");
} else {
  if (current === expected) {
    console.log("OK");
    process.exit(0);
  }
  console.error("STALE: coordinator routing table differs from workflows/do.md — run `node scripts/generate-coordinator-table.cjs --write`");
  process.exit(1);
}
