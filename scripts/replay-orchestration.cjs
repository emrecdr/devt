#!/usr/bin/env node
"use strict";

/**
 * replay-orchestration — the orchestration replay harness.
 *
 * The workflow layer is ~10.5K lines of LLM-executed markdown prose that no
 * unit test exercises; its `field:` notes are a scar-tissue log of past silent
 * orchestration failures. This harness converts that class into regression
 * tests: it records a `.devt/state/` fixture for a known precondition, drives
 * the REAL producer/gate CLIs the workflow prose invokes — in sequence — and
 * asserts the block/advance decision the prose promises. No LLM; the assert-*
 * and context-init CLIs are pure and CLI-addressable, so this runs in CI.
 *
 * Distinct from test-gates.cjs (which unit-tests a single gate against seeded
 * inputs): this replays PRODUCER→GATE sequences against what the producer
 * actually emits — the seam class two independent field reports flagged.
 *
 * Each case cites the workflow `field:` note it guards.
 * Run: node scripts/replay-orchestration.cjs   (exit 0 pass / 1 fail)
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { setupDevtFixture } = require("./_test-fixture.cjs");

let PASS = 0, FAIL = 0;
function pass(n) { PASS++; process.stdout.write(`  PASS: ${n}\n`); }
function fail(n, why) { FAIL++; process.stdout.write(`  FAIL: ${n} — ${why}\n`); }
function j(s) { try { return JSON.parse(s); } catch { return null; } }
function git(cwd, args) { execFileSync("git", args, { cwd, stdio: "pipe" }); }
function gitInit(cwd) {
  git(cwd, ["init", "-q", "-b", "main"]);
  git(cwd, ["config", "user.email", "t@t.t"]);
  git(cwd, ["config", "user.name", "devt-replay"]);
}

// ── Case 1: explicit-scope bundle re-anchor (code-review.md::identify_scope) ──
// field: "a 64-file explicit-scope review carried a signal claiming '3 changed
// files'." The bundle must derive memory_signal from the pre-written
// code-review-input.md (the scope universe), NOT the git diff. Guards v0.220 F2.
process.stdout.write("== Case 1: explicit-scope bundle re-anchor ==\n");
{
  const fx = setupDevtFixture({ config: { graphify: { enabled: false }, git: { primary_branch: "main" } } });
  try {
    gitInit(fx.tmp);
    fs.writeFileSync(path.join(fx.tmp, "base.py"), "base\n");
    git(fx.tmp, ["add", "-A"]); git(fx.tmp, ["commit", "-qm", "base"]);
    // Working-tree diff of 3 files — the DIFF universe (what a regressed bundle would see).
    fs.appendFileSync(path.join(fx.tmp, "base.py"), "change\n");
    fs.writeFileSync(path.join(fx.tmp, "d1.py"), "x\n");
    fs.writeFileSync(path.join(fx.tmp, "d2.py"), "y\n");
    // Explicit 5-file scope artifact — the SCOPE universe (what the fix must honor).
    fs.writeFileSync(path.join(fx.stateDir, "code-review-input.md"),
      "# Review Scope\n\n## Files\n\n- a/one.py\n- a/two.py\n- b/three.py\n- b/four.py\n- c/five.py\n");
    fs.writeFileSync(path.join(fx.stateDir, "workflow.yaml"),
      'active: true\nworkflow_id: 11112222-3333-4444-5555-666677778888\nworkflow_type: code_review\nphase: context_init\ntask: "explicit scope review"\nfirst_created_at: "2026-01-01T00:00:00Z"\ncreated_at: "2026-01-01T00:00:00Z"\n');
    fx.runCli("memory", "init");
    fs.mkdirSync(path.join(fx.devtDir, "memory", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(fx.devtDir, "memory", "decisions", "ADR-001-x.md"),
      "---\nid: ADR-001\ntitle: t\ndoc_type: decision\nstatus: active\nconfidence: explicit\nsummary: s\n---\nbody\n");
    fx.runCli("memory", "index");
    const r = fx.runCli("state", "review-context-init", "--scope=explicit scope review", "--primary-branch=main");
    const o = j(r.stdout);
    const prim = o && o.memory_signal && o.memory_signal.primary;
    // files_checked honors the 5-file scope artifact, not the 3-file diff (v0.220 F2).
    // The claim is GOVERNANCE-framed and MUST NOT read as review-scope/completeness
    // (v0.224 F2: "scope file(s)" was misread by a consolidator as the completeness
    // denominator). files_checked is the governance-scan universe, never review coverage.
    if (prim && prim.files_checked === 5 && /governance/.test(prim.claim || "") && !/scope file|changed file/.test(prim.claim || "")) {
      pass("memory_signal honors the 5-file scope artifact; claim is governance-framed, not review-scope (no 'scope file'/'changed file' wording)");
    } else {
      fail("explicit-scope re-anchor", `expected files_checked=5 + governance-framed claim; got ${JSON.stringify(prim)}`);
    }
  } finally { fx.cleanup(); }
}

// ── Case 4: governance-layer liveness degrades LOUDLY (F1) ────────────────────
// field: on a project with 0 .devt/memory/ docs the whole ADR/CON/FLOW + Axis-E
// apparatus silently no-ops — an empty layer looked identical to a compliant one,
// so an operator read the N/A as a pass. Empty must announce; populated must not.
process.stdout.write("== Case 4: governance-layer liveness (F1 degrade-loud) ==\n");
{
  const fx = setupDevtFixture({ config: { graphify: { enabled: false }, git: { primary_branch: "main" } } });
  try {
    gitInit(fx.tmp);
    fs.writeFileSync(path.join(fx.tmp, "base.py"), "base\n");
    git(fx.tmp, ["add", "-A"]); git(fx.tmp, ["commit", "-qm", "base"]);
    fs.writeFileSync(path.join(fx.stateDir, "workflow.yaml"),
      'active: true\nworkflow_id: 11112222-3333-4444-5555-666677778888\nworkflow_type: code_review\nphase: context_init\ntask: t\nfirst_created_at: "2026-01-01T00:00:00Z"\ncreated_at: "2026-01-01T00:00:00Z"\n');
    fx.runCli("memory", "init");
    // Empty layer → governance_active:false + a loud stderr banner.
    let r = fx.runCli("state", "review-context-init", "--scope=t", "--primary-branch=main");
    let o = j(r.stdout);
    const empty = o && o.memory_signal && o.memory_signal.governance_active === false
      && /governance layer INACTIVE/i.test(r.stderr || "");
    // Populated layer → governance_active:true, no banner.
    fs.mkdirSync(path.join(fx.devtDir, "memory", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(fx.devtDir, "memory", "decisions", "ADR-001-x.md"),
      "---\nid: ADR-001\ntitle: t\ndoc_type: decision\nstatus: active\nconfidence: explicit\nsummary: s\n---\nbody\n");
    fx.runCli("memory", "index");
    r = fx.runCli("state", "review-context-init", "--scope=t", "--primary-branch=main", "--fresh");
    o = j(r.stdout);
    const populated = o && o.memory_signal && o.memory_signal.governance_active === true
      && !/governance layer INACTIVE/i.test(r.stderr || "");
    if (empty && populated) {
      pass("empty .devt/memory announces governance_active:false + loud banner; populated announces true + silent");
    } else {
      fail("governance liveness", `empty→loud=${empty} populated→silent=${populated}`);
    }
  } finally { fx.cleanup(); }
}

// ── Case 2: union scope on uncommitted work (code-review.md::identify_scope) ──
// field: "Raw `git diff base...HEAD` returns an EMPTY set exactly when the
// review target is uncommitted work, silently under-scoping the review." The
// union CLI must count working-tree + untracked, where the raw range is 0.
process.stdout.write("== Case 2: union scope sees uncommitted + untracked ==\n");
{
  const fx = setupDevtFixture({ config: { graphify: { enabled: false }, git: { primary_branch: "main" } } });
  try {
    gitInit(fx.tmp);
    fs.writeFileSync(path.join(fx.tmp, "base.py"), "base\n");
    git(fx.tmp, ["add", "-A"]); git(fx.tmp, ["commit", "-qm", "base"]);
    // base...HEAD is empty (nothing committed past base); the review target is the working tree.
    fs.appendFileSync(path.join(fx.tmp, "base.py"), "uncommitted change\n"); // modified, unstaged
    fs.writeFileSync(path.join(fx.tmp, "untracked.py"), "new file\n");       // untracked
    const rawEmpty = execFileSync("git", ["diff", "--name-only", "main...HEAD"], { cwd: fx.tmp, encoding: "utf8" }).trim();
    const r = fx.runCli("state", "changed-files", "--base=main");
    const o = j(r.stdout);
    const files = (o && o.files) || [];
    if (rawEmpty === "" && files.length === 2 && files.includes("untracked.py") && files.includes("base.py")) {
      pass("changed-files unions working-tree + untracked (2 files) where raw base...HEAD is empty");
    } else {
      fail("union scope", `raw='${rawEmpty}' union=${JSON.stringify(files)} (expected [] raw, 2-file union incl untracked)`);
    }
  } finally { fx.cleanup(); }
}

// ── Case 3: graphify-decision gate blocks until drill-downs are real ──────────
// field: "an orchestrator hit the gate first, then had to go back and run the
// top-3 by hand." symbol_anchored tier demands drill-downs that (a) exist,
// (b) are backed by real get_neighbors MCP calls (anti-fabrication), and
// (c) clear the substance threshold — three-state block/advance contract.
process.stdout.write("== Case 3: graphify-decision three-state contract ==\n");
{
  const fx = setupDevtFixture({
    config: { graphify: { enabled: true, command: "graphify" }, graphify_decision_mode: "block" },
    graphify: true,
  });
  try {
    const wf = 'active: true\nworkflow_id: 11112222-3333-4444-5555-666677778888\nworkflow_type: code_review\nphase: context_init\ntask: t\nfirst_created_at: "2026-01-01T00:00:00Z"\ncreated_at: "2026-01-01T00:00:00Z"\n';
    fs.writeFileSync(path.join(fx.stateDir, "workflow.yaml"), wf);
    fs.writeFileSync(path.join(fx.stateDir, "graphify-impact-plan.json"),
      '{"tier":"symbol_anchored","tool":"blast_radius","args":{"symbols":["S"]}}');
    const gi = path.join(fx.stateDir, "graph-impact.md");
    const memDir = path.join(fx.devtDir, "memory");
    fs.mkdirSync(memDir, { recursive: true });

    // (a) missing drill-downs → block
    fs.writeFileSync(gi, "# Graph Impact\n\n## Blast radius — S\n\ndirect_dependents: 12\n");
    let o = j(fx.runCli("state", "assert-graphify-decision").stdout);
    const a = o && o.ok === false;

    const pad = "Caller-set analysis: this dependent is invoked from twelve sites across the auth and billing layers; changes here ripple to session validation, token refresh, and the admin override path — reviewers must trace each before approving. ";
    const withDrills = "# Graph Impact\n\n## Blast radius — S\n\ndirect_dependents: 12\n\n"
      + `## Drill-down: DepA [call: aabbccdd]\n\n${pad}\n\n`
      + `## Drill-down: DepB [call: eeff0011]\n\n${pad}\n`;

    // (b) drill-downs present but NO backing MCP trace → block (anti-fabrication / provenance)
    fs.writeFileSync(gi, withDrills);
    o = j(fx.runCli("state", "assert-graphify-decision").stdout);
    const b = o && o.ok === false && /get_neighbors|fabricat|MCP call/i.test(o.reason || "");

    // (c) drill-downs + real get_neighbors trace records → advance
    fs.writeFileSync(path.join(memDir, "_mcp-trace.jsonl"),
      '{"workflow_id":"11112222-3333-4444-5555-666677778888","ts":"2026-01-02T00:00:00Z","tool":"mcp__plugin_devt_devt-graphify__get_neighbors"}\n'
      + '{"workflow_id":"11112222-3333-4444-5555-666677778888","ts":"2026-01-02T00:00:01Z","tool":"mcp__plugin_devt_devt-graphify__get_neighbors"}\n');
    o = j(fx.runCli("state", "assert-graphify-decision").stdout);
    const c = o && o.ok === true;

    if (a && b && c) {
      pass("symbol_anchored gate blocks on missing drill-downs, blocks on unbacked drill-downs (provenance), advances only when substantive + MCP-traced");
    } else {
      fail("graphify three-state", `missing→block=${a} unbacked→block=${b} traced→advance=${c}`);
    }
  } finally { fx.cleanup(); }
}

process.stdout.write(`\n== Result: ${PASS} passed, ${FAIL} failed ==\n`);
process.exit(FAIL === 0 ? 0 : 1);
