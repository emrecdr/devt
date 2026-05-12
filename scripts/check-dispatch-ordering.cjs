#!/usr/bin/env node
"use strict";

/**
 * Cache-friendly dispatch-ordering linter.
 *
 * For every `Task(subagent_type="devt:...", ...)` dispatch block in
 * `workflows/*.md`, verify the per-task dynamic `<task>` tag appears AFTER
 * the `</context>` closer, not before. The Anthropic prompt cache works on
 * byte-stable prefixes — if `<task>` (per-task, dynamic) leads the prompt,
 * the static `<governing_rules>` + `<guardrails_inline>` blocks that follow
 * cannot cache-hit across retry iterations within the 5-min TTL.
 *
 * Exit 0 with no output when all dispatches are cache-friendly.
 * Exit 1 with one error line per offender otherwise.
 *
 * Called by scripts/smoke-test.sh. Kept as a stand-alone .cjs so the regex
 * logic stays readable and so devs can run it directly during PR review:
 * node scripts/check-dispatch-ordering.cjs
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "workflows");

const bad = [];

for (const name of fs.readdirSync(DIR)) {
  if (!name.endsWith(".md")) continue;
  const filePath = path.join(DIR, name);
  const lines = fs.readFileSync(filePath, "utf8").split("\n");

  let inBlock = false;
  let blockStart = 0;
  let sawTask = 0;
  let sawCloseCtx = 0;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/Task\(subagent_type="devt:/.test(ln)) {
      inBlock = true;
      blockStart = i + 1;
      sawTask = 0;
      sawCloseCtx = 0;
      continue;
    }
    if (!inBlock) continue;

    // First <task> opening tag (single-line or multi-line block).
    if (sawTask === 0 && /^\s*<task[> ]/.test(ln)) sawTask = i + 1;
    // First </context> closer in this dispatch.
    if (sawCloseCtx === 0 && /<\/context>/.test(ln)) sawCloseCtx = i + 1;

    // End-of-dispatch sentinel: the closing `")` that terminates the prompt
    // string. Matches either `")` at column 0 or indented-then-`")`.
    if (/^\s*"\)\s*$/.test(ln)) {
      if (sawTask > 0 && sawCloseCtx > 0 && sawTask < sawCloseCtx) {
        bad.push(
          `workflows/${name}:${blockStart} <task> at line ${sawTask} precedes </context> at line ${sawCloseCtx}`,
        );
      }
      inBlock = false;
      blockStart = 0;
      sawTask = 0;
      sawCloseCtx = 0;
    }
  }
}

if (bad.length) {
  process.stderr.write(bad.join("\n") + "\n");
  process.exit(1);
}
process.exit(0);
