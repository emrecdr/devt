#!/usr/bin/env node
"use strict";

/**
 * Graphify wrapper test — drives the CLI surface against a fixture graph.json.
 *
 * Spawns `node bin/devt-tools.cjs graphify <subcmd>` from a temp project that
 * has a known graph.json artifact. Validates the return shape every consumer
 * (preflight.cjs, memory.cjs, discovery.cjs) depends on.
 *
 * Run: node scripts/test-graphify.cjs
 * Exits 0 on success, 1 on any failure.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "devt-tools.cjs");

let PASS = 0;
let FAIL = 0;
const failures = [];

function pass(name) { PASS++; process.stdout.write(`  PASS: ${name}\n`); }
function fail(name, reason) {
  FAIL++;
  failures.push(`${name} :: ${reason}`);
  process.stdout.write(`  FAIL: ${name} — ${reason}\n`);
}

function run(cwd, ...args) {
  const r = spawnSync(process.execPath, [CLI, "graphify", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10000,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function parseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// graph.json fixture — three nodes, four edges. Mirrors the NetworkX
// node_link_data shape that upstream graphify emits (key is "links",
// not "edges" — confirmed against graphify/build.py and graphify/serve.py
// in the upstream repo).
const FIXTURE = {
  built_at_commit: "abc1234",
  nodes: [
    { id: "auth_authservice", label: "AuthService", source_file: "src/auth/service.py", file_type: "code", confidence_score: 1.0 },
    { id: "session_sessionmanager", label: "SessionManager", source_file: "src/session/manager.py", file_type: "code", confidence_score: 1.0 },
    { id: "api_login_handler", label: "login_handler", source_file: "src/api/handlers.py", file_type: "code", confidence_score: 0.9 },
    { id: "util_helpers", label: "helpers", source_file: "src/util/helpers.py", file_type: "code", confidence_score: 0.8 },
  ],
  links: [
    { source: "api_login_handler", target: "auth_authservice", relation: "calls", confidence: "EXTRACTED", confidence_score: 1.0, weight: 1.0 },
    { source: "auth_authservice", target: "session_sessionmanager", relation: "calls", confidence: "EXTRACTED", confidence_score: 1.0, weight: 1.0 },
    { source: "auth_authservice", target: "util_helpers", relation: "calls", confidence: "INFERRED", confidence_score: 0.7, weight: 1.0 },
    { source: "session_sessionmanager", target: "util_helpers", relation: "calls", confidence: "AMBIGUOUS", confidence_score: 0.5, weight: 1.0 },
  ],
  hyperedges: [],
  input_tokens: 0,
  output_tokens: 0,
};

// Creates a fresh fixture project rooted in an OS temp directory.
// `tmp` is the mkdtempSync result and never escapes the function as input —
// avoids the path-traversal pattern that flags function-parameter joins.
function setupFixture(opts = {}) {
  const TMP_PREFIX = path.join(os.tmpdir(), "devt-graphify-test-");
  const tmp = fs.mkdtempSync(TMP_PREFIX);
  const devtDir = path.join(tmp, ".devt");
  const stateDir = path.join(devtDir, "state");
  const rulesDir = path.join(devtDir, "rules");
  const configFile = path.join(devtDir, "config.json");
  const graphDir = path.join(tmp, "graphify-out");
  const graphFile = path.join(graphDir, "graph.json");
  fs.mkdirSync(devtDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({
    graphify: { enabled: opts.enabled !== false, command: opts.command || "graphify-not-on-path" },
  }, null, 2));
  if (opts.withGraph !== false) {
    fs.mkdirSync(graphDir, { recursive: true });
    // opts.graphRaw lets a test write malformed bytes for degradation coverage.
    if (typeof opts.graphRaw === "string") {
      fs.writeFileSync(graphFile, opts.graphRaw);
    } else {
      fs.writeFileSync(graphFile, JSON.stringify(opts.graph || FIXTURE));
    }
  }
  return { tmp, graphFile };
}

// ── status ─────────────────────────────────────────────────────────────────
{
  const { tmp } = setupFixture();
  const r = run(tmp, "status");
  const j = parseJson(r.stdout);
  if (j && j.state === "ready" && j.graph_path && j.graph_path.endsWith("graph.json")) {
    pass("status reports ready when graph.json exists (no binary needed)");
  } else {
    fail("status ready without binary", `got: ${JSON.stringify(j)} stderr=${r.stderr}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  const { tmp } = setupFixture({ withGraph: false });
  const r = run(tmp, "status");
  const j = parseJson(r.stdout);
  if (j && j.state === "graph_missing") {
    pass("status reports graph_missing when graph.json absent");
  } else {
    fail("status graph_missing", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  const { tmp } = setupFixture({ enabled: false });
  const r = run(tmp, "status");
  const j = parseJson(r.stdout);
  if (j && j.state === "disabled") {
    pass("status reports disabled when config.graphify.enabled=false");
  } else {
    fail("status disabled", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── query ──────────────────────────────────────────────────────────────────
{
  const { tmp } = setupFixture();
  const r = run(tmp, "query", "AuthService");
  const j = parseJson(r.stdout);
  if (j && j.source === "graphify" && Array.isArray(j.results) && j.results.length >= 1
      && j.results[0].label === "AuthService") {
    pass("query finds node by exact label");
  } else {
    fail("query by label", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  const { tmp } = setupFixture();
  const r = run(tmp, "query", "Manager");
  const j = parseJson(r.stdout);
  if (j && j.source === "graphify" && Array.isArray(j.results)
      && j.results.some(n => n.label === "SessionManager")) {
    pass("query finds node by case-insensitive substring");
  } else {
    fail("query substring", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  const { tmp } = setupFixture();
  const r = run(tmp, "query", "NonExistentZzzz");
  const j = parseJson(r.stdout);
  if (j && Array.isArray(j.results) && j.results.length === 0) {
    pass("query returns empty results array for unknown label");
  } else {
    fail("query empty", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── neighbors ──────────────────────────────────────────────────────────────
{
  const { tmp } = setupFixture();
  const r = run(tmp, "neighbors", "AuthService");
  const j = parseJson(r.stdout);
  // AuthService outgoing: session_sessionmanager, util_helpers (2 out)
  // AuthService incoming: api_login_handler (1 in)
  // default direction is "both" → 3 neighbors total
  if (j && j.source === "graphify" && Array.isArray(j.results) && j.results.length === 3) {
    pass("neighbors both direction returns 3 hits for AuthService");
  } else {
    fail("neighbors both", `expected 3 results, got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  const { tmp } = setupFixture();
  const r = run(tmp, "neighbors", "AuthService", "--direction=in");
  const j = parseJson(r.stdout);
  if (j && Array.isArray(j.results) && j.results.length === 1
      && (j.results[0].label === "login_handler" || j.results[0].id === "api_login_handler")) {
    pass("neighbors direction=in returns only incoming callers");
  } else {
    fail("neighbors in", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  const { tmp } = setupFixture();
  const r = run(tmp, "neighbors", "AuthService", "--direction=out");
  const j = parseJson(r.stdout);
  if (j && Array.isArray(j.results) && j.results.length === 2) {
    pass("neighbors direction=out returns only outgoing dependents");
  } else {
    fail("neighbors out", `expected 2, got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  const { tmp } = setupFixture();
  const r = run(tmp, "neighbors", "AuthService", "--direction=in", "--depth=2");
  const j = parseJson(r.stdout);
  // depth=2 incoming from AuthService → api_login_handler at depth 1, nothing at depth 2
  if (j && Array.isArray(j.results) && j.results.length === 1) {
    pass("neighbors depth=2 walks transitively");
  } else {
    fail("neighbors depth=2", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── path ───────────────────────────────────────────────────────────────────
{
  const { tmp } = setupFixture();
  const r = run(tmp, "path", "login_handler", "util_helpers");
  const j = parseJson(r.stdout);
  // login → auth → session → util OR login → auth → util: shortest is 2 hops
  if (j && j.source === "graphify" && Array.isArray(j.results) && j.results.length >= 2) {
    pass("path returns shortest-path hops between connected nodes");
  } else {
    fail("path connected", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  const { tmp } = setupFixture();
  const r = run(tmp, "path", "util_helpers", "login_handler");
  const j = parseJson(r.stdout);
  // util_helpers has no outgoing edges → no path
  if (j && Array.isArray(j.results) && j.results.length === 0) {
    pass("path returns empty when no route exists in directed graph");
  } else {
    fail("path empty", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── blast-radius ───────────────────────────────────────────────────────────
{
  const { tmp } = setupFixture();
  const r = run(tmp, "blast-radius", "AuthService");
  const j = parseJson(r.stdout);
  // AuthService direct incoming: 1 (login_handler). depth-2 incoming: 0 more.
  // The contract preserved from the previous wrapper:
  // {effect_size, direct_dependents[], indirect_dependents[], modules_touched,
  //  god_node_match, ambiguous_bindings, source}
  if (j && j.source === "graphify"
      && Array.isArray(j.direct_dependents)
      && Array.isArray(j.indirect_dependents)
      && typeof j.modules_touched === "number"
      && typeof j.god_node_match === "boolean"
      && typeof j.ambiguous_bindings === "number"
      && ["small", "medium", "large", null].includes(j.effect_size)) {
    pass("blast-radius preserves the consumer contract shape");
  } else {
    fail("blast-radius shape", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  const { tmp } = setupFixture();
  const r = run(tmp, "blast-radius", "AuthService");
  const j = parseJson(r.stdout);
  // direct_dependents should list api_login_handler (or its label)
  if (j && j.direct_dependents.length === 1) {
    pass("blast-radius direct_dependents lists depth-1 incoming");
  } else {
    fail("blast-radius direct count", `expected 1 dep, got ${j && j.direct_dependents ? j.direct_dependents.length : "?"}: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── legacy 'edges' field name compatibility ────────────────────────────────
// graph.json from older NetworkX uses 'edges' instead of 'links'
{
  const legacy = JSON.parse(JSON.stringify(FIXTURE));
  legacy.edges = legacy.links;
  delete legacy.links;
  const { tmp } = setupFixture({ graph: legacy });
  const r = run(tmp, "neighbors", "AuthService");
  const j = parseJson(r.stdout);
  if (j && Array.isArray(j.results) && j.results.length === 3) {
    pass("legacy 'edges' field name compatible with current parser");
  } else {
    fail("legacy edges", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── stats (B-2 trust gate) ─────────────────────────────────────────────────
{
  const { tmp } = setupFixture();
  const r = run(tmp, "stats");
  const j = parseJson(r.stdout);
  // 4-node fixture is below the 50-node sparse threshold
  if (j && j.state === "ready"
      && j.node_count === 4
      && j.edge_count === 4
      && j.density === 1
      && j.trust === "sparse") {
    pass("stats reports trust=sparse for small fixture (node_count<50)");
  } else {
    fail("stats sparse fixture", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  const { tmp } = setupFixture({ withGraph: false });
  const r = run(tmp, "stats");
  const j = parseJson(r.stdout);
  if (j && j.trust === "empty" && j.node_count === 0) {
    pass("stats reports trust=empty when graph.json absent");
  } else {
    fail("stats empty graph", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  // Dense-graph fixture: 60 nodes, 120 edges → 50+ nodes AND density >= 1
  const denseGraph = { nodes: [], links: [] };
  for (let i = 0; i < 60; i++) {
    denseGraph.nodes.push({ id: `n${i}`, label: `Node ${i}`, source_file: `src/m${i % 6}/f${i}.py`, file_type: "code" });
  }
  for (let i = 0; i < 120; i++) {
    denseGraph.links.push({ source: `n${i % 60}`, target: `n${(i + 7) % 60}`, relation: "calls", confidence: "EXTRACTED" });
  }
  const { tmp } = setupFixture({ graph: denseGraph });
  const r = run(tmp, "stats");
  const j = parseJson(r.stdout);
  if (j && j.trust === "dense" && j.node_count === 60 && j.edge_count === 120) {
    pass("stats reports trust=dense for 60-node graph with density=2");
  } else {
    fail("stats dense graph", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── god-node detection via degree-sort (X-3: replaces GRAPH_REPORT.md regex) ─
// Fixture: 6 nodes, one is a clear god-node by degree (4 inbound edges),
// one is a file-named hub that MUST be filtered, one is a concept node
// (no source_file) that MUST be filtered.
{
  const fixture = {
    nodes: [
      { id: "core_dispatch", label: "Dispatch", source_file: "src/core/dispatch.py", file_type: "code" },
      { id: "h1", label: "HandlerA", source_file: "src/h/a.py", file_type: "code" },
      { id: "h2", label: "HandlerB", source_file: "src/h/b.py", file_type: "code" },
      { id: "h3", label: "HandlerC", source_file: "src/h/c.py", file_type: "code" },
      { id: "h4", label: "HandlerD", source_file: "src/h/d.py", file_type: "code" },
      // File-named hub — same label as basename of its source_file → must be filtered
      { id: "dispatch_module", label: "dispatch.py", source_file: "src/core/dispatch.py", file_type: "code" },
      // Concept node — no source_file → must be filtered
      { id: "concept_authz", label: "Authorization", source_file: "", file_type: "concept" },
    ],
    links: [
      { source: "h1", target: "core_dispatch", relation: "calls", confidence: "EXTRACTED" },
      { source: "h2", target: "core_dispatch", relation: "calls", confidence: "EXTRACTED" },
      { source: "h3", target: "core_dispatch", relation: "calls", confidence: "EXTRACTED" },
      { source: "h4", target: "core_dispatch", relation: "calls", confidence: "EXTRACTED" },
      // Give file-named hub + concept node high degree to test the filter
      { source: "h1", target: "dispatch_module", relation: "references", confidence: "INFERRED" },
      { source: "h2", target: "dispatch_module", relation: "references", confidence: "INFERRED" },
      { source: "h3", target: "dispatch_module", relation: "references", confidence: "INFERRED" },
      { source: "h4", target: "dispatch_module", relation: "references", confidence: "INFERRED" },
      { source: "h1", target: "concept_authz", relation: "references", confidence: "INFERRED" },
      { source: "h2", target: "concept_authz", relation: "references", confidence: "INFERRED" },
      { source: "h3", target: "concept_authz", relation: "references", confidence: "INFERRED" },
      { source: "h4", target: "concept_authz", relation: "references", confidence: "INFERRED" },
    ],
  };
  const { tmp } = setupFixture({ graph: fixture });
  const r = run(tmp, "blast-radius", "Dispatch");
  const j = parseJson(r.stdout);
  if (j && j.god_node_match === true) {
    pass("blast-radius detects real god-node (Dispatch with 4 inbound edges)");
  } else {
    fail("god-node detection (real)", `expected god_node_match=true, got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  // Same fixture, but query the file-named hub label — must NOT match.
  const fixture = {
    nodes: [
      { id: "core_dispatch", label: "Dispatch", source_file: "src/core/dispatch.py", file_type: "code" },
      { id: "h1", label: "HandlerA", source_file: "src/h/a.py", file_type: "code" },
      { id: "h2", label: "HandlerB", source_file: "src/h/b.py", file_type: "code" },
      { id: "h3", label: "HandlerC", source_file: "src/h/c.py", file_type: "code" },
      { id: "h4", label: "HandlerD", source_file: "src/h/d.py", file_type: "code" },
      { id: "dispatch_module", label: "dispatch.py", source_file: "src/core/dispatch.py", file_type: "code" },
    ],
    links: [
      // Give dispatch_module 4 inbound edges → would be #1 by raw degree
      // but file-name filter must exclude it from top-N.
      { source: "h1", target: "dispatch_module", relation: "references", confidence: "INFERRED" },
      { source: "h2", target: "dispatch_module", relation: "references", confidence: "INFERRED" },
      { source: "h3", target: "dispatch_module", relation: "references", confidence: "INFERRED" },
      { source: "h4", target: "dispatch_module", relation: "references", confidence: "INFERRED" },
    ],
  };
  const { tmp } = setupFixture({ graph: fixture });
  const r = run(tmp, "blast-radius", "dispatch.py");
  const j = parseJson(r.stdout);
  if (j && j.god_node_match === false) {
    pass("blast-radius filters file-named hubs from god-node detection (matches upstream _is_file_node)");
  } else {
    fail("god-node file-name filter", `expected god_node_match=false, got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── malformed graph.json (Phase A degradation paths) ──────────────────────
{
  // Invalid JSON syntax — safeJsonParse returns ok:false; loader degrades.
  const { tmp } = setupFixture({ graphRaw: "{ this is not valid JSON" });
  const r = run(tmp, "query", "anything");
  const j = parseJson(r.stdout);
  if (j && j.degraded === true && j.source === "grep"
      && typeof j.reason === "string" && j.reason.includes("parse failed")) {
    pass("query degrades gracefully when graph.json is malformed JSON (parse failed reason surfaced)");
  } else {
    fail("malformed JSON degradation", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  // Empty schema — graph.json is valid JSON but has no nodes/links keys.
  // Loader defaults both to []; queryGraph returns empty results via the
  // "empty" fallback_trigger.
  const { tmp } = setupFixture({ graph: {} });
  const r = run(tmp, "query", "anything");
  const j = parseJson(r.stdout);
  if (j && j.source === "grep" && Array.isArray(j.results) && j.results.length === 0
      && j.fallback_trigger === "empty") {
    pass("query handles empty graph.json (no nodes/links keys) — degraded with fallback_trigger=empty");
  } else {
    fail("empty schema", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  // Schema mismatch — links is a string instead of an array. The loader's
  // Array.isArray() guards default to [] so we don't crash on
  // .map / .filter / for...of over a non-array value.
  const { tmp } = setupFixture({ graph: { nodes: [{ id: "a", label: "A", source_file: "src/a.py" }], links: "not_an_array" } });
  const r = run(tmp, "neighbors", "A");
  const j = parseJson(r.stdout);
  if (j && Array.isArray(j.results) && j.results.length === 0) {
    pass("neighbors handles schema mismatch (links is non-array) without crashing — returns empty");
  } else {
    fail("schema mismatch (links non-array)", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── degraded path: graph missing ───────────────────────────────────────────
{
  const { tmp } = setupFixture({ withGraph: false });
  const r = run(tmp, "query", "anything");
  const j = parseJson(r.stdout);
  if (j && j.degraded === true && j.source === "grep") {
    pass("query degrades gracefully when graph.json missing");
  } else {
    fail("query degraded", `got: ${JSON.stringify(j)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── summary ────────────────────────────────────────────────────────────────
process.stdout.write(`\nResults: ${PASS} passed, ${FAIL} failed\n`);
if (FAIL > 0) {
  process.stdout.write("\nFailures:\n");
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
  process.exit(1);
}
process.exit(0);
