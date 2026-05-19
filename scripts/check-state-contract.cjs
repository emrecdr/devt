#!/usr/bin/env node
"use strict";

/**
 * check-state-contract — strict static analyzer that scans every agents/*.md
 * and workflows/*.md for `.devt/state/<filename>` references and verifies each
 * one matches the contract declared in bin/modules/state.cjs.
 *
 * Exit 0 if all references are contract-compliant. Exit 1 otherwise, printing
 * one violation per line as `<file>: <filename>`.
 *
 * Called by scripts/smoke-test.sh as the STRICT enforcement gate that catches
 * the regression where an agent introduces a new ad-hoc filename — the exact
 * class of sprawl that accumulates in projects over time.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const state = require(path.join(ROOT, "bin", "modules", "state.cjs"));
const audit = require(path.join(ROOT, "bin", "modules", "state-audit.cjs"));

const known = new Set(state.STATE_FILE_CONTRACT.additional_canonical || []);
for (const k of Object.keys(state.ARTIFACT_SCHEMA || {})) known.add(k);
for (const k of Object.keys(state.SIDECAR_FOR_MARKDOWN || {})) {
  known.add(k);
  known.add(state.SIDECAR_FOR_MARKDOWN[k]);
}
for (const k of Object.keys(state.JSON_SIDECAR_SCHEMAS || {})) known.add(k);
for (const k of Object.keys(state.JSON_INPUT_SCHEMAS || {})) known.add(k);
for (const k of state.RESET_EXEMPT || []) known.add(k);

const PATTERNS = audit.ALLOWED_PATTERNS || [];
const EPHEMERAL = audit.EPHEMERAL_PATTERNS || [];

// Allowlist of fixture/example/teaching references — these appear in docs and
// don't represent agent code writing real files at runtime.
const ALLOW_REFS = new Set([
  "STATE-RULES.md",
  "foo.tmp", "bar.tmp", "baz~", "tmp.tmp",
  "random-junk.md", "review-foo.md",
]);

// Order alternations longest-first so jsonl matches before json (greedy alternation
// would otherwise truncate "preflight-denies.jsonl" to "preflight-denies.json").
const STATE_REF_REGEX = /\.devt\/state\/([A-Za-z0-9_.-]+\.(?:jsonl|json|yaml|lock|txt|md))/g;

function classify(name) {
  if (ALLOW_REFS.has(name)) return "allowed_ref";
  if (known.has(name)) return "canonical";
  for (const re of EPHEMERAL) if (re.test(name)) return "ephemeral";
  for (const re of PATTERNS) if (re.test(name)) return "pattern_allowed";
  return "violation";
}

function scanDir(dir) {
  const violations = [];
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch { return violations; }
  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    const p = path.join(dir, f);
    const txt = fs.readFileSync(p, "utf8");
    for (const m of txt.matchAll(STATE_REF_REGEX)) {
      const name = m[1];
      if (classify(name) === "violation") {
        violations.push(`${path.basename(dir)}/${f}: ${name}`);
      }
    }
  }
  return violations;
}

const all = [
  ...scanDir(path.join(ROOT, "agents")),
  ...scanDir(path.join(ROOT, "workflows")),
];

if (all.length === 0) process.exit(0);
for (const v of all) console.log(v);
process.exit(1);
