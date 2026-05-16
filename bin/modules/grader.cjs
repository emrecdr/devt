"use strict";

const fs = require("node:fs");
const path = require("node:path");

const config = require("./config.cjs");
const state = require("./state.cjs");

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

// Parse the `## Deterministic Gates` section from a rubric markdown body.
// Returns the parsed JSON object, or null if the section / fence / parse fails
// (callers treat null as "no enforceable gates" → pass).
function extractDeterministicGates(rubricBody) {
  const idx = rubricBody.search(/^##\s+Deterministic Gates\s*$/m);
  if (idx === -1) return null;
  const after = rubricBody.slice(idx);
  const fence = after.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!fence) return null;
  try {
    return JSON.parse(fence[1]);
  } catch {
    return null;
  }
}

// Walk a constraint tree against sidecar data, collecting field-keyed failures.
// Constraint leaves: scalar (equality), array (oneOf). Objects recurse.
function walkConstraints(constraint, sidecar, pathStr, failures) {
  if (Array.isArray(constraint)) {
    if (!constraint.includes(sidecar)) {
      failures.push({ field: pathStr || "<root>", expected: `one of ${JSON.stringify(constraint)}`, got: sidecar });
    }
    return;
  }
  if (constraint === null || typeof constraint !== "object") {
    if (sidecar !== constraint) {
      failures.push({ field: pathStr || "<root>", expected: constraint, got: sidecar });
    }
    return;
  }
  if (sidecar === null || typeof sidecar !== "object") {
    failures.push({ field: pathStr || "<root>", expected: "<object>", got: sidecar });
    return;
  }
  for (const key of Object.keys(constraint)) {
    walkConstraints(constraint[key], sidecar[key], pathStr ? `${pathStr}.${key}` : key, failures);
  }
}

// Pure grader: load rubric, extract gates for the sidecar name, walk constraints.
// Returns {pass: bool, gate_failures: [...]}.
function gradeArtifact(rubricPath, sidecarName, sidecarData) {
  if (!fs.existsSync(rubricPath)) {
    return { pass: false, gate_failures: [{ field: "<rubric>", expected: "exists", got: rubricPath }], error: "rubric not found" };
  }
  const body = fs.readFileSync(rubricPath, "utf8");
  const gates = extractDeterministicGates(body);
  if (!gates) return { pass: true, gate_failures: [] };
  const constraint = gates[sidecarName];
  if (constraint === undefined) return { pass: true, gate_failures: [] };
  const failures = [];
  walkConstraints(constraint, sidecarData, "", failures);
  return { pass: failures.length === 0, gate_failures: failures };
}

function resolveRubricPath(workflowType) {
  const merged = config.getMergedConfig();
  const rubricFile = merged.rubrics && merged.rubrics[workflowType];
  if (!rubricFile) return null;
  return path.join(PLUGIN_ROOT, "references", "rubrics", rubricFile);
}

function run(subcommand, args) {
  const workflowType = subcommand;
  const sidecarName = args && args[0];
  if (!workflowType || !sidecarName) {
    process.stdout.write(JSON.stringify({ ok: false, reason: "usage: grade <workflow_type> <sidecar.json>" }) + "\n");
    return 1;
  }
  const rubricPath = resolveRubricPath(workflowType);
  if (!rubricPath) {
    process.stdout.write(JSON.stringify({ ok: false, reason: `no rubric registered for workflow_type "${workflowType}"` }) + "\n");
    return 1;
  }
  const sidecar = state.readSidecar(sidecarName);
  if (!sidecar.ok) {
    process.stdout.write(JSON.stringify({ ok: false, reason: sidecar.reason, sidecar: sidecarName }) + "\n");
    return 1;
  }
  const result = gradeArtifact(rubricPath, sidecarName, sidecar.data);
  const payload = {
    ok: true,
    pass: result.pass,
    gate_failures: result.gate_failures,
    workflow_type: workflowType,
    sidecar: sidecarName,
    rubric: path.relative(PLUGIN_ROOT, rubricPath),
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
  return result.pass ? 0 : 1;
}

module.exports = { gradeArtifact, extractDeterministicGates, walkConstraints, resolveRubricPath, run };
