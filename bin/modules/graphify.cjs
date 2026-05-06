"use strict";

/**
 * Graphify integration — optional, with graceful degradation.
 *
 * Wraps the `graphify` CLI binary (https://github.com/safishamsi/graphify) as an
 * optional dependency. Project owners install via `pip install graphifyy[mcp]`
 * (or uv tool / pipx equivalent) and set `graphify.enabled: true` in
 * .devt/config.json. devt itself stays Node-stdlib-only.
 *
 * Core invariant (locked decision): the system is fully functional WITHOUT
 * Graphify. Every method returns a structured `{ source, results, degraded?,
 * error? }` payload so callers can transparently fall back to grep/path-based
 * heuristics when Graphify is disabled, missing, or fails.
 *
 * Four fallback triggers (per the Graphify-First Skill Protocol):
 *   1. Graphify returns empty
 *   2. Graphify errors out
 *   3. Graphify is not setup (config disabled OR binary missing)
 *   4. Graphify returns too few results (< caller's min_results_threshold)
 *
 * Phase 2 (v0.17.0). Phase 3 (v0.18.0) will add the vendored MCP query layer
 * that exposes these functions to agents over stdio.
 */

const fs = require("fs");
const path = require("path");
const child_process = require("node:child_process");
const { safeJsonParse } = require("./security.cjs");

// ---------------------------------------------------------------------------
// Config + binary discovery
// ---------------------------------------------------------------------------

function getConfig() {
  const { getMergedConfig } = require("./config.cjs");
  const cfg = getMergedConfig();
  return cfg.graphify || { enabled: false, command: "graphify" };
}

function findProjectRoot() {
  return require("./config.cjs").findProjectRoot();
}

function getGraphifyOutDir() {
  // Respect Graphify's own GRAPHIFY_OUT env var if set (per Graphify docs:
  // "useful for sharing one graph across multiple git worktrees")
  if (process.env.GRAPHIFY_OUT) {
    const v = process.env.GRAPHIFY_OUT;
    return path.isAbsolute(v) ? v : path.join(findProjectRoot(), v);
  }
  return path.join(findProjectRoot(), "graphify-out");
}

/**
 * Returns one of: "ready" | "disabled" | "binary_missing" | "graph_missing"
 * Callers use this to skip MCP attempts entirely when Graphify isn't usable.
 */
function status() {
  const cfg = getConfig();
  if (!cfg.enabled) return { state: "disabled", reason: "graphify.enabled is false in .devt/config.json" };

  const cmd = cfg.command || "graphify";
  // Probe the binary cheaply via `--help`; capture exit code only.
  let probeOk = false;
  try {
    const r = child_process.spawnSync(cmd, ["--help"], {
      timeout: 2000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    probeOk = r.status === 0;
  } catch (e) {
    probeOk = false;
  }
  if (!probeOk) {
    return {
      state: "binary_missing",
      reason: `command "${cmd}" not found on PATH. Install: pip install graphifyy[mcp] (or uv tool / pipx equivalent)`,
    };
  }

  const outDir = getGraphifyOutDir();
  const graphPath = path.join(outDir, "graph.json");
  if (!fs.existsSync(graphPath)) {
    return {
      state: "graph_missing",
      reason: `${graphPath} not found. Run: ${cmd} update . to extract`,
    };
  }
  return { state: "ready", out_dir: outDir, graph_path: graphPath };
}

/**
 * Read graph.json's `built_at_commit` and compare to current HEAD.
 * Returns { fresh: bool, built_at: string|null, head: string|null, lag_commits: number|null }.
 */
function freshness() {
  const s = status();
  if (s.state !== "ready") return { state: s.state, fresh: false, built_at: null, head: null };

  // Read only the first 8KB to extract built_at_commit. graph.json is a top-level
  // object emitted by graphify with built_at_commit near the start, and full JSON
  // parse on a 50MB+ graph would dominate freshness() cost.
  let builtAt = null;
  try {
    const fd = fs.openSync(s.graph_path, "r");
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    const head = buf.toString("utf8", 0, bytesRead);
    const m = head.match(/"built_at_commit"\s*:\s*"([0-9a-fA-F]{4,64})"/);
    if (m) builtAt = m[1];
  } catch {
    return { state: "ready", fresh: false, built_at: null, head: null, error: "graph.json unreadable" };
  }

  let head = null;
  try {
    const r = child_process.spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: findProjectRoot(),
      timeout: 2000,
      encoding: "utf8",
    });
    if (r.status === 0) head = r.stdout.trim();
  } catch { /* swallow — git may be missing */ }

  const fresh = !!(builtAt && head && builtAt === head);

  // lag_commits stays null when count can't be computed (built_at/head missing,
  // shallow clone where built_at sha is unreachable, or git unavailable).
  let lagCommits = fresh ? 0 : null;
  if (builtAt && head && builtAt !== head) {
    try {
      const r = child_process.spawnSync(
        "git",
        ["rev-list", "--count", `${builtAt}..${head}`],
        { cwd: findProjectRoot(), timeout: 2000, encoding: "utf8" }
      );
      if (r.status === 0) {
        const n = parseInt(r.stdout.trim(), 10);
        if (Number.isFinite(n)) lagCommits = n;
      }
    } catch { /* swallow */ }
  }

  return { state: "ready", fresh, built_at: builtAt, head, lag_commits: lagCommits };
}

// ---------------------------------------------------------------------------
// Lane 0 warm-cache discovery
// ---------------------------------------------------------------------------

/**
 * Returns the path of the preferred warm-cache file (wiki/index.md when present,
 * else GRAPH_REPORT.md, else null). Per Graphify's own AGENTS.md guidance:
 * "If graphify-out/wiki/index.md exists, navigate it instead of reading raw files."
 */
function warmCachePath() {
  const outDir = getGraphifyOutDir();
  const wikiIndex = path.join(outDir, "wiki", "index.md");
  if (fs.existsSync(wikiIndex)) return wikiIndex;
  const report = path.join(outDir, "GRAPH_REPORT.md");
  if (fs.existsSync(report)) return report;
  // Some installs put GRAPH_REPORT.md at project root via `graphify install`
  const rootReport = path.join(findProjectRoot(), "GRAPH_REPORT.md");
  if (fs.existsSync(rootReport)) return rootReport;
  return null;
}

// ---------------------------------------------------------------------------
// Generic invocation helper
// ---------------------------------------------------------------------------

/**
 * Run a graphify subcommand and parse its JSON output. Returns a structured
 * result that callers can branch on. Never throws — always returns a payload.
 *
 *   { source: "graphify" | "grep" | "merged", results: any[], degraded?, error? }
 */
function callGraphify(subargs, options) {
  options = options || {};
  const minResults = options.min_results_threshold || 0;
  const cfg = getConfig();
  const s = status();

  if (s.state !== "ready") {
    return {
      source: "grep", // Caller should fall back
      results: [],
      degraded: true,
      reason: s.reason,
      state: s.state,
      fallback_trigger: "not_setup",
    };
  }

  let proc;
  try {
    proc = child_process.spawnSync(cfg.command || "graphify", subargs, {
      cwd: findProjectRoot(),
      timeout: options.timeout_ms || 10000,
      encoding: "utf8",
    });
  } catch (e) {
    return {
      source: "grep",
      results: [],
      degraded: true,
      error: String(e && e.message ? e.message : e),
      fallback_trigger: "error",
    };
  }

  if (proc.status !== 0) {
    return {
      source: "grep",
      results: [],
      degraded: true,
      error: (proc.stderr || "").toString().trim() || `graphify exited with ${proc.status}`,
      fallback_trigger: "error",
    };
  }

  // 100MB cap — Graphify subprocess output for blast-radius can be large on big graphs.
  const parseResult = safeJsonParse(proc.stdout || "[]", "graphify subprocess", 100 * 1024 * 1024);
  if (!parseResult.ok) {
    // Graphify CLI sometimes emits human-readable text — return raw stdout
    return {
      source: "graphify",
      results: [],
      degraded: true,
      raw_output: (proc.stdout || "").trim(),
      error: "non-JSON output (graphify version may not support --json)",
      fallback_trigger: "error",
    };
  }

  const parsed = parseResult.value;
  const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.nodes || []);

  if (results.length === 0) {
    return {
      source: "grep",
      results: [],
      degraded: true,
      reason: "graphify returned 0 results",
      fallback_trigger: "empty",
    };
  }
  if (results.length < minResults) {
    return {
      source: "merged",  // Caller should supplement with grep
      results,
      degraded: true,
      reason: `graphify returned ${results.length} results, below min_results_threshold=${minResults}`,
      fallback_trigger: "below_threshold",
    };
  }

  return { source: "graphify", results };
}

// ---------------------------------------------------------------------------
// MCP-style helpers (these mirror Graphify's own MCP tool names)
// ---------------------------------------------------------------------------

/**
 * Search for concepts/symbols by name or text. Mirrors Graphify's `query_graph`.
 */
function queryGraph(text, options) {
  return callGraphify(["query", text, "--json"], options || {});
}

/**
 * Fetch a single node's details (definition, references). Mirrors `get_node`.
 */
function getNode(nodeId, options) {
  return callGraphify(["explain", nodeId, "--json"], options || { min_results_threshold: 1 });
}

/**
 * Find connected concepts. Mirrors `get_neighbors`. Direction can be "in" / "out" / "both".
 */
function getNeighbors(symbol, options) {
  options = options || {};
  const args = ["query", symbol, "--neighbors", "--json"];
  if (options.direction === "in") args.push("--direction=in");
  if (options.direction === "out") args.push("--direction=out");
  if (options.depth) args.push(`--depth=${options.depth}`);
  return callGraphify(args, options);
}

/**
 * Shortest path between two symbols. Mirrors `shortest_path`.
 */
function shortestPath(from, to, options) {
  return callGraphify(["path", from, to, "--json"], options || {});
}

/**
 * Compute blast radius for a set of subject symbols. Returns:
 *   { effect_size: 'small' | 'medium' | 'large',
 *     direct_dependents: [...],   // depth-1 incoming
 *     indirect_dependents: [...], // depth-2 incoming
 *     modules_touched: number,
 *     god_node_match: boolean,
 *     ambiguous_bindings: number,
 *     source: 'graphify' | 'grep' }
 *
 * When Graphify is disabled, returns a degraded payload with effect_size estimated
 * from path heuristics and grep counts (callers fall back per the protocol).
 */
function blastRadius(symbols, _options) {
  const s = status();
  if (s.state !== "ready") {
    return {
      effect_size: null,
      direct_dependents: [],
      indirect_dependents: [],
      modules_touched: 0,
      god_node_match: false,
      ambiguous_bindings: 0,
      source: "grep",
      degraded: true,
      reason: s.reason,
    };
  }

  // Fetch direct + depth-2 neighbors per symbol. Aggregate.
  const direct = new Set();
  const indirect = new Set();
  const modules = new Set();
  const ambiguous = [];
  let godNodeMatch = false;

  for (const sym of symbols) {
    const r1 = getNeighbors(sym, { direction: "in", depth: 1 });
    if (r1.results) {
      for (const n of r1.results) {
        if (n.id || n.label) direct.add(n.id || n.label);
        if (n.source_file) modules.add(path.dirname(n.source_file));
        if (n.confidence === "AMBIGUOUS") ambiguous.push({ symbol: sym, node: n });
      }
    }
    const r2 = getNeighbors(sym, { direction: "in", depth: 2 });
    if (r2.results) {
      for (const n of r2.results) {
        if (n.id || n.label) indirect.add(n.id || n.label);
      }
    }
  }

  // Detect god_node match by reading GRAPH_REPORT.md's god-nodes section if available
  try {
    const reportPath = path.join(s.out_dir, "GRAPH_REPORT.md");
    if (fs.existsSync(reportPath)) {
      const report = fs.readFileSync(reportPath, "utf8");
      // Coarse detection: any subject symbol mentioned in the "God Nodes" section
      const godSection = report.match(/##\s*God Nodes[\s\S]*?(?=\n##\s|$)/i);
      if (godSection) {
        const haystack = godSection[0];
        // Whole-word match without dynamic RegExp. `\b` = word/non-word transition;
        // we check that condition at both edges of each indexOf hit.
        const isWord = c => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
        for (const sym of symbols) {
          if (typeof sym !== "string" || sym.length === 0 || sym.length > 256) continue;
          const symStartWord = isWord(sym.charCodeAt(0));
          const symEndWord = isWord(sym.charCodeAt(sym.length - 1));
          let idx = 0;
          let found = false;
          while ((idx = haystack.indexOf(sym, idx)) !== -1) {
            // Treat "off the ends of haystack" as non-word (matches regex `\b` at boundaries).
            const beforeWord = idx > 0 ? isWord(haystack.charCodeAt(idx - 1)) : false;
            const afterWord = idx + sym.length < haystack.length ? isWord(haystack.charCodeAt(idx + sym.length)) : false;
            // `\b` matches when exactly one side is a word char (XOR transition).
            if (symStartWord !== beforeWord && symEndWord !== afterWord) { found = true; break; }
            idx += sym.length;
          }
          if (found) { godNodeMatch = true; break; }
        }
      }
    }
  } catch { /* swallow */ }

  let effect_size;
  if (godNodeMatch || direct.size + indirect.size > 20 || modules.size >= 4) effect_size = "large";
  else if (direct.size + indirect.size > 5 || modules.size >= 2) effect_size = "medium";
  else effect_size = "small";

  return {
    effect_size,
    direct_dependents: Array.from(direct),
    indirect_dependents: Array.from(indirect),
    modules_touched: modules.size,
    god_node_match: godNodeMatch,
    ambiguous_bindings: ambiguous.length,
    ambiguous_details: ambiguous,
    source: "graphify",
  };
}

// ---------------------------------------------------------------------------
// CLI dispatcher
// ---------------------------------------------------------------------------

function run(subcommand, args) {
  const json = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");

  switch (subcommand) {
    case "status":
      json(status());
      return 0;
    case "freshness":
      json(freshness());
      return 0;
    case "warm-cache":
      json({ path: warmCachePath() });
      return 0;
    case "query": {
      if (!args[0]) { process.stderr.write("Usage: graphify query <text>\n"); return 2; }
      json(queryGraph(args.join(" ")));
      return 0;
    }
    case "node": {
      if (!args[0]) { process.stderr.write("Usage: graphify node <id>\n"); return 2; }
      json(getNode(args[0]));
      return 0;
    }
    case "neighbors": {
      if (!args[0]) { process.stderr.write("Usage: graphify neighbors <symbol> [--direction=in|out|both] [--depth=N]\n"); return 2; }
      const dirArg = args.find(a => a.startsWith("--direction="));
      const depthArg = args.find(a => a.startsWith("--depth="));
      const direction = dirArg ? dirArg.split("=")[1] : "both";
      const depth = depthArg ? parseInt(depthArg.split("=")[1], 10) : 1;
      json(getNeighbors(args[0], { direction, depth }));
      return 0;
    }
    case "path": {
      if (!args[0] || !args[1]) { process.stderr.write("Usage: graphify path <from> <to>\n"); return 2; }
      json(shortestPath(args[0], args[1]));
      return 0;
    }
    case "blast-radius": {
      if (args.length === 0) { process.stderr.write("Usage: graphify blast-radius <symbol> [<symbol>...]\n"); return 2; }
      json(blastRadius(args));
      return 0;
    }
    default:
      process.stderr.write(
        `Unknown graphify subcommand: ${subcommand}\n` +
        `Valid: status | freshness | warm-cache | query | node | neighbors | path | blast-radius\n`
      );
      return 2;
  }
}

// Config-independent binary probe used during setup/health before .devt/config.json
// exists. Returns true when `graphify --help` exits 0 within the timeout.
function probeBinary(command = "graphify", timeoutMs = 1500) {
  try {
    const probe = require("child_process").spawnSync(command, ["--help"], { timeout: timeoutMs, stdio: "ignore" });
    return Boolean(probe && probe.status === 0);
  } catch {
    return false;
  }
}

module.exports = {
  run,
  status,
  freshness,
  warmCachePath,
  callGraphify,
  queryGraph,
  getNode,
  getNeighbors,
  shortestPath,
  blastRadius,
  getGraphifyOutDir,
  probeBinary,
};
