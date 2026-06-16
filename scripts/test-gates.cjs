#!/usr/bin/env node
"use strict";

/**
 * Gate unit tests — exercises five named claim-check / substance gates against
 * fixture artifacts. Closes the substance-byte-threshold regression class:
 * the 200-byte drill-down floor in assertGraphifyDecision is load-bearing
 * prose with zero JS coverage, and a future tweak from 200 → 150 would
 * silently change drill-down acceptance across every code review.
 *
 * Gates covered (line numbers shift as state.cjs grows — use grep on the
 * function name when navigating):
 *   1. assertGraphifyDecision     — state.cjs:1701
 *   2. assertArtifactPresent      — state.cjs:2778
 *   3. assertFileQuiescent        — state.cjs:3284
 *   4. assertClaimChecksResolved  — state.cjs:4525
 *   5. assertVerifierGradedAllAxes — state.cjs:2192
 *
 * Run: node scripts/test-gates.cjs
 * Exits 0 on success, 1 on any failure.
 */

const { setupDevtFixture, seedArtifact } = require("./_test-fixture.cjs");

let PASS = 0;
let FAIL = 0;
const failures = [];

function pass(name) { PASS++; process.stdout.write(`  PASS: ${name}\n`); }
function fail(name, reason) {
  FAIL++;
  failures.push(`${name} :: ${reason}`);
  process.stdout.write(`  FAIL: ${name} — ${reason}\n`);
}
function parseJson(s) { try { return JSON.parse(s); } catch { return null; } }

// Seed an active workflow.yaml — most gates require workflow_type or
// created_at anchors. Wrapper for the lock-aware updateState path.
function seedActiveWorkflow(runCli, workflowType, opts) {
  opts = opts || {};
  const args = [
    "state", "update", "active=true",
    `workflow_type=${workflowType}`,
    "phase=context_init", "status=DONE",
    `task=${opts.task || "test"}`,
  ];
  runCli(...args);
}

// ── 1. assertGraphifyDecision — substance-byte threshold regression class ──
process.stdout.write("== assertGraphifyDecision ==\n");
{
  const { runCli, cleanup } = setupDevtFixture();
  const r = runCli("state", "assert-graphify-decision");
  const j = parseJson(r.stdout);
  if (j && j.ok === true && /gate does not apply/.test(j.reason || "")) {
    pass("graphify not ready → ok:true with 'does not apply' reason");
  } else {
    fail("graphify not ready inapplicable", `got: ${JSON.stringify(j)} stderr=${r.stderr}`);
  }
  cleanup();
}
{
  // ready + neither artifact → ok:false (orchestrator skipped the step)
  const { runCli, cleanup } = setupDevtFixture({ graphify: true });
  const r = runCli("state", "assert-graphify-decision");
  const j = parseJson(r.stdout);
  if (j && j.ok === false && /neither/.test(j.reason || "")) {
    pass("ready + no artifacts → ok:false (skipped step)");
  } else {
    fail("ready no artifacts", `got: ${JSON.stringify(j)} stderr=${r.stderr}`);
  }
  cleanup();
}
{
  // ready + drill-down section without backing MCP get_neighbors trace
  // → ok:false with fabricated_drill_down:true. This is a load-bearing
  // anti-hallucination contract: agents that fabricate drill-down sections
  // without actually calling the MCP tool are caught. Verifying with a real
  // ok:true path requires an _mcp-trace.jsonl fixture matched to workflow_id,
  // out of scope for this suite — the negative path is the regression class.
  const { stateDir, runCli, cleanup } = setupDevtFixture({ graphify: true });
  const meatyBody = "A".repeat(250);
  seedArtifact(stateDir, "graph-impact.md", `# Graph Impact\n\n## Drill-down: ClientService\n\n${meatyBody}\n`);
  const r = runCli("state", "assert-graphify-decision");
  const j = parseJson(r.stdout);
  if (j && j.ok === false && j.fabricated_drill_down === true && j.drill_down_sections === 1 && (j.thin_drill_down_sections || 0) === 0) {
    pass("substantive drill-down without MCP trace → ok:false (fabricated_drill_down detected)");
  } else {
    fail("fabricated drill-down detection", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}
{
  // ready + THIN drill-down (<200 bytes body, no truncation marker) → ok:false
  const { stateDir, runCli, cleanup } = setupDevtFixture({ graphify: true });
  seedArtifact(stateDir, "graph-impact.md", `# Graph Impact\n\n## Drill-down: GDPR\n\n57 bytes of body that's well under threshold.\n`);
  const r = runCli("state", "assert-graphify-decision");
  const j = parseJson(r.stdout);
  // Per current implementation, thin drill-down counts in metrics; ok depends
  // on whether F1 mode blocks on thin-content. Substance signal is what we test.
  if (j && j.drill_down_sections === 1 && j.thin_drill_down_sections >= 1) {
    pass("thin drill-down (<200 bytes) flagged in thin_drill_down_sections");
  } else {
    fail("thin drill-down flagged", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}

// ── 2. assertArtifactPresent — Layer-1 claim-check ─────────────────────────
process.stdout.write("== assertArtifactPresent ==\n");
{
  const { runCli, cleanup } = setupDevtFixture();
  const r = runCli("state", "assert-artifact-present");
  const j = parseJson(r.stdout);
  if (j && j.ok === false && /missing agent argument/.test(j.reason || "")) {
    pass("missing agent argument → ok:false");
  } else {
    fail("missing agent argument", `got: ${JSON.stringify(j)} stderr=${r.stderr}`);
  }
  cleanup();
}
{
  // Unknown agent → ok:false with "no canonical mapping" or similar.
  const { runCli, cleanup } = setupDevtFixture();
  const r = runCli("state", "assert-artifact-present", "nonexistent-agent");
  const j = parseJson(r.stdout);
  if (j && j.ok === false) {
    pass("unknown agent → ok:false");
  } else {
    fail("unknown agent", `got: ${JSON.stringify(j)} stderr=${r.stderr}`);
  }
  cleanup();
}
{
  // Known agent (programmer) with impl-summary.md present → ok:true
  const { stateDir, runCli, cleanup } = setupDevtFixture();
  seedArtifact(stateDir, "impl-summary.md", "# Implementation summary\n\nReal body with enough bytes to count as substantive output for the gate to consider this a non-stub artifact written by the programmer agent.\n");
  const r = runCli("state", "assert-artifact-present", "programmer");
  const j = parseJson(r.stdout);
  // ok=true OR ok=false (when stub-detection runs) — we accept either as
  // long as it routes to a recognized path. Smoke contract: known agent
  // resolves expected_path without "missing canonical mapping" failure.
  if (j && /impl-summary/.test(j.expected_path || "")) {
    pass("known agent (programmer) resolves to impl-summary.md path");
  } else {
    fail("programmer expected path", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}

// ── 3. assertFileQuiescent — race guard timing ─────────────────────────────
process.stdout.write("== assertFileQuiescent ==\n");
{
  const { runCli, cleanup } = setupDevtFixture();
  const r = runCli("state", "assert-file-quiescent");
  const j = parseJson(r.stdout);
  if (j && j.ok === false && /missing path/.test(j.reason || "")) {
    pass("no path argument → ok:false");
  } else {
    fail("no path argument", `got: ${JSON.stringify(j)} stderr=${r.stderr}`);
  }
  cleanup();
}
{
  const { runCli, cleanup } = setupDevtFixture();
  const r = runCli("state", "assert-file-quiescent", ".devt/state/nonexistent.md");
  const j = parseJson(r.stdout);
  if (j && j.ok === false && /does not exist/.test(j.reason || "")) {
    pass("nonexistent file → ok:false with 'does not exist'");
  } else {
    fail("nonexistent file", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}
{
  // Stable file with short settle-ms → ok:true after 2 attempts
  const { stateDir, runCli, cleanup } = setupDevtFixture();
  seedArtifact(stateDir, "stable.md", "# stable content");
  const r = runCli("state", "assert-file-quiescent", ".devt/state/stable.md", "--settle-ms=50", "--timeout-ms=2000");
  const j = parseJson(r.stdout);
  if (j && j.ok === true && j.attempts >= 2) {
    pass("stable file → ok:true after >=2 attempts");
  } else {
    fail("stable file quiescent", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}

// ── 4. assertClaimChecksResolved — Layer-2 aggregation ─────────────────────
process.stdout.write("== assertClaimChecksResolved ==\n");
{
  const { runCli, cleanup } = setupDevtFixture();
  const r = runCli("state", "assert-claim-checks-resolved");
  const j = parseJson(r.stdout);
  if (j && j.ok === true && j.unresolved_count === 0 && /absent/.test(j.reason || "")) {
    pass("failures jsonl absent → ok:true with ambiguity note");
  } else {
    fail("failures absent", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}
{
  // claim_check_mode=off → ok:true regardless of failure file presence
  const { stateDir, runCli, cleanup } = setupDevtFixture({
    config: { graphify: { enabled: false }, claim_check_mode: "off" },
  });
  seedArtifact(stateDir, "claim-check-failures.jsonl",
    JSON.stringify({ source: "claim_check", ts: new Date().toISOString(), agent: "programmer", ok: false }) + "\n");
  const r = runCli("state", "assert-claim-checks-resolved");
  const j = parseJson(r.stdout);
  if (j && j.ok === true && j.mode === "off") {
    pass("claim_check_mode=off → ok:true (gate disabled)");
  } else {
    fail("mode=off disabled", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}
{
  // present + workflow.yaml::created_at within window + unresolved failure → ok:false
  const { stateDir, runCli, cleanup } = setupDevtFixture();
  // Seed an active workflow so created_at anchor is set.
  seedActiveWorkflow(runCli, "code_review");
  // Append an unresolved Layer-1 failure timestamped now. Gate looks for
  // verdict==="failure" (or success+substance_verdict===stub); ok:false alone
  // isn't the trigger — verdict is the discriminator per state.cjs:4587.
  seedArtifact(stateDir, "claim-check-failures.jsonl",
    JSON.stringify({ source: "claim_check", ts: new Date().toISOString(), agent: "programmer", verdict: "failure", reason: "stub artifact" }) + "\n");
  const r = runCli("state", "assert-claim-checks-resolved");
  const j = parseJson(r.stdout);
  if (j && j.ok === false && (j.unresolved_count || 0) >= 1) {
    pass("unresolved failure in window → ok:false");
  } else {
    fail("unresolved failure", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}

// ── 5. assertVerifierGradedAllAxes — axis-walk enforcement ─────────────────
process.stdout.write("== assertVerifierGradedAllAxes ==\n");
{
  const { runCli, cleanup } = setupDevtFixture();
  const r = runCli("state", "assert-verifier-graded-all-axes");
  const j = parseJson(r.stdout);
  if (j && j.ok === true && /no active workflow/.test(j.reason || "")) {
    pass("no active workflow → ok:true with 'does not apply'");
  } else {
    fail("no active workflow", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}
{
  // code_review workflow + verification.json absent → ok:false (verifier never ran)
  const { runCli, cleanup } = setupDevtFixture();
  seedActiveWorkflow(runCli, "code_review");
  const r = runCli("state", "assert-verifier-graded-all-axes");
  const j = parseJson(r.stdout);
  if (j && j.ok === false && /verification\.json/.test(j.reason || "")) {
    pass("code_review + verification.json absent → ok:false (verifier never ran)");
  } else {
    fail("verification absent", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}
{
  // code_review + verification.json with criteria_total < axes → ok:false with missing count
  const { stateDir, runCli, cleanup } = setupDevtFixture();
  seedActiveWorkflow(runCli, "code_review");
  // Real code_review.v1.md has 8 axes (A-H). Seed criteria_total=6 to trigger gap.
  seedArtifact(stateDir, "verification.json", JSON.stringify({
    verdict: "satisfied",
    criteria_total: 6,
    criteria_met: 6,
  }));
  const r = runCli("state", "assert-verifier-graded-all-axes");
  const j = parseJson(r.stdout);
  // Gate emits `missing_axes_count` not `missing`; see state.cjs:2192 contract.
  // code_review.v1.md ships 7 axes (A–G as table rows; H is currently absent
  // from the rubric per the smoke gate's "7 axes" expectation).
  if (j && j.ok === false && (j.missing_axes_count || 0) >= 1) {
    pass("criteria_total=6 vs rubric axes → ok:false with missing_axes_count>=1");
  } else {
    fail("under-graded axes", `got: ${JSON.stringify(j)}`);
  }
  cleanup();
}

// ── Summary ────────────────────────────────────────────────────────────────
process.stdout.write(`\n== Result: ${PASS} passed, ${FAIL} failed ==\n`);
if (FAIL > 0) {
  process.stdout.write("\nFailures:\n");
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
  process.exit(1);
}
process.exit(0);
