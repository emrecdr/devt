#!/usr/bin/env node
"use strict";

/**
 * check-workflow-shell-state — lints workflows/*.md for shell variables
 * assigned in one ```bash fence and consumed in a LATER fence.
 *
 * Each fenced block runs as a fresh shell (one Bash tool call per fence), so
 * nothing survives a fence boundary — a `$VAR` threaded across fences is dead
 * on arrival and the LLM orchestrator has to improvise a carrier (field: a
 * task-service run hand-rolled a `.current-scan-id` state file). The carrier
 * contract is `state update <key>=...` / `state read`; this lint makes the
 * broken pattern un-shippable. workflows/status.md is the clean example:
 * every variable is computed and consumed inside a single fence.
 *
 * Not flagged:
 *   - vars ASSIGNED in the same fence before use (including for-loop vars,
 *     case captures, `read` targets)
 *   - environment-provided names (CLAUDE_PLUGIN_ROOT, HOME, ...) and shell
 *     builtins ($?, $!, $$, $1..$9, $@, $*, $#)
 *   - uses carrying an inline default — ${X:-...} / ${X:=...} are explicitly
 *     fence-local-defensive
 *   - template placeholders ({VAR} without $) and prose outside fences
 *
 * Limit (stated): only ```bash fences are scanned — a var threaded from a
 * bash fence into prose instructions ("pass $SCAN_ID to the agent") is
 * invisible here; the dispatch-envelope compile path owns that class.
 *
 * Exit 0 clean; exit 1 with one line per violation:
 *   <file>: $VAR assigned in fence #i (line L1) but used in fence #j (line L2) — fences are separate shells; carry via `state update`
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WF_DIR = path.join(ROOT, "workflows");

const ENV_PROVIDED = new Set([
  "CLAUDE_PLUGIN_ROOT", "DEVT_WORKFLOW_ID", "DEVT_HOOK_PROFILE", "DEVT_DISABLED_HOOKS",
  "ARGUMENTS", "TASK_DESCRIPTION", "REVIEW_SCOPE", "PRIMARY_BRANCH", "USER_CHOICE",
  "HOME", "TMPDIR", "PATH", "PWD", "OSTYPE", "SHELL", "RANDOM",
]);

function fences(body) {
  const out = [];
  const lines = body.split("\n");
  let inFence = false, fenceLang = "", start = 0, buf = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*```(\w*)/);
    if (m && !inFence) { inFence = true; fenceLang = m[1]; start = i + 1; buf = []; continue; }
    if (m && inFence) {
      if (fenceLang === "bash" || fenceLang === "sh") out.push({ startLine: start + 1, lines: buf });
      inFence = false; continue;
    }
    if (inFence) buf.push(lines[i]);
  }
  return out;
}

function assignedIn(fenceLines) {
  const names = new Set();
  for (const l of fenceLines) {
    for (const m of l.matchAll(/(?:^|[;({]|\s|\bexport\s+|\blocal\s+)([A-Z][A-Z0-9_]{2,})=/g)) names.add(m[1]);
    for (const m of l.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g)) names.add(m[1]);
    for (const m of l.matchAll(/\bread\s+(?:-r\s+)?([A-Z][A-Z0-9_]{2,})\b/g)) names.add(m[1]);
  }
  return names;
}

function usedIn(fenceLines) {
  const uses = [];
  for (let i = 0; i < fenceLines.length; i++) {
    // strip single-quoted segments (no expansion there) and comments
    const l = fenceLines[i].replace(/'[^']*'/g, "''").replace(/(^|\s)#.*$/, "");
    for (const m of l.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})([:}\-=?+]|\b)/g)) {
      // ${X:-...} / ${X:=...} carry their own default — fence-local-defensive
      if (/^\{[A-Z][A-Z0-9_]*:[-=]/.test(l.slice(m.index + 1))) continue;
      uses.push({ name: m[1], lineOffset: i });
    }
  }
  return uses;
}

function lintFile(file) {
  const body = fs.readFileSync(path.join(WF_DIR, file), "utf8");
  const fs_ = fences(body);
  const violations = [];
  const assignedByFence = fs_.map((f) => assignedIn(f.lines));
  for (let j = 0; j < fs_.length; j++) {
    const localAssigned = assignedByFence[j];
    for (const use of usedIn(fs_[j].lines)) {
      if (localAssigned.has(use.name) || ENV_PROVIDED.has(use.name)) continue;
      for (let i = 0; i < j; i++) {
        if (assignedByFence[i].has(use.name)) {
          violations.push(
            `${file}: $${use.name} assigned in fence #${i + 1} (line ${fs_[i].startLine}) but used in fence #${j + 1} (line ${fs_[j].startLine + use.lineOffset}) — fences are separate shells; carry via \`state update ${use.name.toLowerCase()}=...\` + \`state read\``,
          );
          break;
        }
      }
    }
  }
  return violations;
}

const all = [];
for (const f of fs.readdirSync(WF_DIR)) {
  if (!f.endsWith(".md")) continue;
  all.push(...lintFile(f));
}

if (all.length === 0) {
  console.log("OK");
  process.exit(0);
}
// De-duplicate repeated uses of the same var in the same fence pair
const seen = new Set();
for (const v of all) {
  const key = v.split(" — ")[0];
  if (seen.has(key)) continue;
  seen.add(key);
  console.error(v);
}
process.exit(1);
