"use strict";

/**
 * Weekly contribution report — pure Node.js.
 *
 * Parses git log output, computes time windows, and renders markdown reports.
 * Zero external dependencies.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { atomicWriteFileSync } = require("./io.cjs");

// ---------------------------------------------------------------------------
// Time window
// ---------------------------------------------------------------------------

function computeWindow(weeks) {
  const w = weeks || 1;
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const lastMonday = new Date(now);
  lastMonday.setUTCDate(now.getUTCDate() - daysSinceMonday - 7 * (w - 1));
  lastMonday.setUTCHours(0, 0, 0, 0);

  const windowEnd = new Date(lastMonday);
  windowEnd.setUTCDate(lastMonday.getUTCDate() + 7 * w);

  const fmt = (d) => d.toISOString().slice(0, 10);

  return {
    window_start: lastMonday.toISOString(),
    window_end: windowEnd.toISOString(),
    from: fmt(lastMonday),
    to: fmt(windowEnd),
    weeks: w,
  };
}

// ---------------------------------------------------------------------------
// Git log parsing
// ---------------------------------------------------------------------------

function loadContributors() {
  try {
    const { getMergedConfig } = require("./config.cjs");
    const config = getMergedConfig();
    return (config.git && config.git.contributors) || [];
  } catch (_) {
    return [];
  }
}

function matchContributor(author, contributors) {
  for (const c of contributors) {
    const match = c.git_match || "";
    if (match && author.toLowerCase().includes(match.toLowerCase())) {
      return c.name || author;
    }
  }
  return author;
}

function parseGitLog(fromDate, toDate, contributors, changedFiles, cwd) {
  // Run at the project root so paths are project-relative (matching trackedFiles
  // and the affects globs). --no-renames emits plain paths, not `{a => b}`
  // arrows that match no tracked file. --relative scopes to (and reports paths
  // relative to) the project subtree. 256MB buffer clears the 1MB default.
  const base = cwd || require("./config.cjs").findProjectRoot();
  const args = [
    "log", "--all", "--no-renames", "--relative",
    "--after=" + fromDate, "--before=" + toDate,
    "--format=%H|%an|%ai|%s", "--numstat",
  ];

  let output;
  try {
    output = execFileSync("git", args, { encoding: "utf8", timeout: 30000, maxBuffer: 256 * 1024 * 1024, cwd: base });
  } catch (err) {
    return { error: "git command failed: " + (err.message || String(err)) };
  }

  const lines = output.trim().split("\n");
  const stats = {};
  let currentAuthor = null;

  for (const line of lines) {
    if (line.includes("|") && (line.match(/\|/g) || []).length >= 3) {
      const parts = line.split("|", 4);
      const rawAuthor = parts[1].trim();
      currentAuthor = matchContributor(rawAuthor, contributors);
      if (!stats[currentAuthor]) {
        stats[currentAuthor] = { commits: 0, insertions: 0, deletions: 0, files: new Set() };
      }
      stats[currentAuthor].commits++;
    } else if (line.includes("\t") && currentAuthor) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const ins = parts[0] !== "-" ? parseInt(parts[0], 10) || 0 : 0;
        const dels = parts[1] !== "-" ? parseInt(parts[1], 10) || 0 : 0;
        stats[currentAuthor].insertions += ins;
        stats[currentAuthor].deletions += dels;
        stats[currentAuthor].files.add(parts[2]);
        if (changedFiles) changedFiles.add(parts[2]);  // repo-wide union for affects-coverage (avoids a 2nd git log)
      }
    }
  }

  // Convert Sets to counts for JSON serialization
  const result = {};
  for (const [author, data] of Object.entries(stats)) {
    result[author] = {
      commits: data.commits,
      files_changed: data.files.size,
      insertions: data.insertions,
      deletions: data.deletions,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderMarkdown(stats, title) {
  const t = title || "Team Contribution Report";
  const lines = ["# " + t, ""];

  if (!stats || stats.error) {
    lines.push("No data available for this period.");
    return lines.join("\n");
  }

  const authors = Object.keys(stats).sort();
  if (authors.length === 0) {
    lines.push("No commits found in this period.");
    return lines.join("\n");
  }

  lines.push("## Summary", "");
  lines.push("| Contributor | Commits | Files Changed | Insertions | Deletions |");
  lines.push("|------------|---------|---------------|------------|-----------|");

  let totalC = 0, totalF = 0, totalI = 0, totalD = 0;
  for (const a of authors) {
    const d = stats[a];
    lines.push(`| ${a} | ${d.commits} | ${d.files_changed} | +${d.insertions} | -${d.deletions} |`);
    totalC += d.commits;
    totalF += d.files_changed;
    totalI += d.insertions;
    totalD += d.deletions;
  }

  lines.push(`| **Total** | **${totalC}** | **${totalF}** | **+${totalI}** | **-${totalD}** |`);
  lines.push("");

  lines.push("## Details", "");
  for (const a of authors) {
    const d = stats[a];
    lines.push(`### ${a}`);
    lines.push(`- Commits: ${d.commits}`);
    lines.push(`- Files changed: ${d.files_changed}`);
    lines.push(`- Lines: +${d.insertions} / -${d.deletions}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Memory layer event aggregations — counts new ADRs/Concepts/Flows/REJ/LES
 * created in the reporting window by reading file mtimes (cheap, no git log diff).
 *
 * Returns { adrs_added, concepts_added, flows_added, rejected_added,
 * lessons_added, total_active_adrs, briefs_invoked }.
 *
 * "Briefs invoked" is approximated from the existence of `.devt/state/preflight-brief.md`
 * — a precise count would require parsing session logs (see bin/modules/token-report.cjs
 * for a related telemetry pattern). Future work.
 */
function aggregateMemoryEvents(projectRoot, fromMs, toMs) {
  const path = require("path");
  const fs = require("fs");
  const memDir = path.join(projectRoot, ".devt", "memory");
  if (!fs.existsSync(memDir)) {
    return { available: false, reason: ".devt/memory/ not present" };
  }
  const counts = { adrs_added: 0, concepts_added: 0, flows_added: 0, rejected_added: 0, lessons_added: 0 };
  const subdirs = [
    { dir: "decisions", key: "adrs_added" },
    { dir: "concepts", key: "concepts_added" },
    { dir: "flows", key: "flows_added" },
    { dir: "rejected", key: "rejected_added" },
    { dir: "lessons", key: "lessons_added" },
  ];
  for (const { dir, key } of subdirs) {
    const full = path.join(memDir, dir);
    if (!fs.existsSync(full)) continue;
    const entries = fs.readdirSync(full);
    for (const f of entries) {
      if (f.startsWith("_")) continue;
      if (!f.endsWith(".md")) continue;
      const stat = fs.statSync(path.join(full, f));
      if (stat.birthtimeMs >= fromMs && stat.birthtimeMs <= toMs) counts[key]++;
    }
  }
  // Total active count (snapshot, not window-scoped)
  let totalActive = 0;
  try {
    const dbPath = path.join(memDir, "index.db");
    if (fs.existsSync(dbPath)) {
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const row = db.prepare("SELECT COUNT(*) AS n FROM documents WHERE status='active'").get();
        totalActive = (row && row.n) || 0;
      } finally {
        db.close();
      }
    }
  } catch { /* swallow */ }

  return {
    available: true,
    window: { from_ms: fromMs, to_ms: toMs },
    ...counts,
    total_active_docs: totalActive,
  };
}

function renderMemorySection(memoryEvents) {
  if (!memoryEvents || !memoryEvents.available) return "";
  const m = memoryEvents;
  const lines = ["## Memory Layer Activity", ""];
  lines.push(`- New ADRs (decisions): ${m.adrs_added}`);
  lines.push(`- New Concepts: ${m.concepts_added}`);
  lines.push(`- New Flows: ${m.flows_added}`);
  lines.push(`- New REJ tombstones: ${m.rejected_added}`);
  lines.push(`- New Lessons: ${m.lessons_added}`);
  lines.push(`- Total active docs (snapshot): ${m.total_active_docs}`);
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Guard telemetry — deny/recovery funnel from .devt/state/preflight-denies.jsonl.
// Surfaces per-source deny counts plus the outcome split the pre-flight guard
// records on covered re-edits (recovered-governed vs recovered-ungoverned) and
// the unrecovered remainder. Both strict signal (governed recoveries) and the
// noise class (ungoverned) are shown — a single aggregate would hide which
// lever to pull (tune the guard vs grow the memory layer's affects coverage).
// ---------------------------------------------------------------------------

function aggregateGuardTelemetry(projectRoot, fromMs, toMs) {
  const logPath = path.join(projectRoot, ".devt", "state", "preflight-denies.jsonl");
  if (!fs.existsSync(logPath)) return { available: false };
  let recs;
  try {
    recs = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && typeof r.ts === "string");
  } catch {
    return { available: false };
  }
  const inWindow = recs.filter((r) => {
    const t = new Date(r.ts).getTime();
    return Number.isFinite(t) && t >= fromMs && t < toMs;
  });
  const denies = inWindow.filter((r) => r.source !== "deny-outcome" && r.source !== "resolution");
  const outcomes = inWindow.filter((r) => r.source === "deny-outcome");
  const bySource = {};
  for (const d of denies) {
    const key = d.rule_id ? `${d.source}/${d.rule_id}` : (d.source || "unknown");
    bySource[key] = (bySource[key] || 0) + 1;
  }
  // Resolution matching runs against the FULL record set, not just the window —
  // a deny near the window edge may recover just outside it; counting that as
  // unrecovered would overstate the stuck signal.
  const resolvedTs = new Set(recs.filter((r) => r.source === "deny-outcome").map((r) => r.resolves_ts));
  const preflightDenies = denies.filter((d) => d.source === "preflight");
  const unrecovered = preflightDenies.filter((d) => !resolvedTs.has(d.ts)).length;
  return {
    available: true,
    total_denies: denies.length,
    by_source: bySource,
    recovered_governed: outcomes.filter((o) => o.outcome === "recovered-governed").length,
    recovered_ungoverned: outcomes.filter((o) => o.outcome === "recovered-ungoverned").length,
    preflight_unrecovered: unrecovered,
  };
}

function renderGuardSection(guard) {
  if (!guard || !guard.available) return "";
  const g = guard;
  const lines = ["## Guard Telemetry", ""];
  lines.push(`- Denies in window: ${g.total_denies}`);
  for (const [key, n] of Object.entries(g.by_source).sort((a, b) => b[1] - a[1])) {
    lines.push(`  - ${key}: ${n}`);
  }
  lines.push(`- Pre-flight recoveries — governed: ${g.recovered_governed}, ungoverned: ${g.recovered_ungoverned}`);
  lines.push(`- Pre-flight denies never recovered: ${g.preflight_unrecovered}`);
  if (g.recovered_ungoverned > g.recovered_governed && g.recovered_ungoverned > 3) {
    lines.push(`- Signal: recoveries are mostly ':: ungoverned' — the guard is firing on paths the memory layer does not govern; extend affects_paths coverage or tune memory.preflight_mode.`);
  }
  if (g.recovered_ungoverned > 0) {
    // The ungoverned bucket is only trustworthy once the guard matched absolute
    // paths — earlier it compared repo-relative globs against absolute
    // file_paths and auto-logged every abs-pathed edit as ':: ungoverned',
    // inflating this count with path mismatches rather than real coverage gaps.
    // Framed by the mechanism (not a version) so a long-window read doesn't
    // mistake the two levers (tune the guard vs grow affects coverage).
    lines.push(`- Caveat: ':: ungoverned' counts are reliable only for denies logged after the guard began matching absolute file paths; a window reaching earlier over-counts this bucket with path mismatches, not true coverage gaps.`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Affects coverage — per-governing-doc glob density over the reporting window.
// Denominator is the files a doc's OWN globs claim (tracked files), numerator
// the subset changed in the window. A broad glob claims far more than any
// window touches → low density, so dilution is visible rather than reading as
// full coverage. Rendered as a direction to track across windows, never a
// score to maximize — narrowing a glob to nothing would "improve" it while
// governing less.
// ---------------------------------------------------------------------------

// `changedFiles` is collected by the parseGitLog walk over this same window
// (no second `git log`). The tracked universe is memory.cjs's shared helper —
// the same "tracked files" concept coverage + enforce use.
function aggregateAffectsCoverage(projectRoot, changedFiles) {
  const memory = require("./memory.cjs");
  const universe = memory.trackedFiles(projectRoot);
  if (universe.length === 0) return { available: false };
  try {
    const cov = memory.computeAffectsCoverage(changedFiles, universe);
    // computeAffectsCoverage → withDb returns {error} (it does NOT throw) when
    // the memory index is absent; only {docs, summary} is a real result, so
    // guard the shape rather than spread an {error} into {available:true, …}.
    if (!cov || !Array.isArray(cov.docs)) return { available: false };
    return { available: true, changed_count: Array.isArray(changedFiles) ? changedFiles.length : 0, ...cov };
  } catch {
    return { available: false };
  }
}

function renderAffectsCoverageSection(coverage) {
  if (!coverage || !coverage.available || !Array.isArray(coverage.docs) || coverage.docs.length === 0) return "";
  const claiming = coverage.docs.filter(d => d.claimed > 0);
  const dead = coverage.docs.filter(d => d.claimed === 0);
  const lines = ["## Affects Coverage (trend)", ""];
  lines.push("_Direction, not a target — density is (files changed this window that a doc's globs claim) ÷ (files those globs claim). A broad glob claiming files it never governs reads as diluted; do not 'fix' it by narrowing globs to nothing._");
  lines.push("");
  if (coverage.changed_count === 0) {
    // The window had no commits (staged/uncommitted work). This report counts
    // COMMITTED history only, so every doc reads 0% — which a reader (human or
    // LLM) can misread as "the memory layer governs nothing". It does not:
    // review-time memory_signal matches the WORKING TREE and fires on docs this
    // report shows at 0%. (Field: a calibration LLM misdiagnosed a working
    // affects-union as empty off exactly this 0%/"no commits" artifact.)
    lines.push("_⚠ No commits in this window — coverage counts **committed** history only, so staged/uncommitted work reads 0% here. This does NOT mean the memory layer governs nothing: review-time `memory_signal` matches the working tree and can fire on docs shown at 0%._");
    lines.push("");
  }
  const plural = (n) => (n === 1 ? "" : "s");
  for (const d of claiming) {
    lines.push(`- ${d.id}: claims ${d.claimed} file${plural(d.claimed)}, ${d.matched} changed → ${Math.round(d.density * 100)}% density`);
  }
  for (const d of dead) {
    lines.push(`- ${d.id}: claims 0 tracked files — globs match nothing (dead governance)`);
  }
  if (coverage.summary && coverage.summary.mean_density != null) {
    lines.push("");
    lines.push(`- Governing-doc mean coverage this window: ${Math.round(coverage.summary.mean_density * 100)}% (compare across reports for the trend)`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Memory injection cost — bytes the context-injector hook emits per workflow,
// projected from the universal run-hook trace (the same source hook-cost reads;
// no new collector). This is the memory/context layer's #3 footprint: what
// memory_signal + governing lines + advisories cost per injection. It reads ~0
// in raw-dispatch/maintainer sessions — the injector emits nothing when no
// /devt:* workflow is active — and reflects real cost only in workflow-running
// projects. The `% cited` companion (would this injection have been worth its
// bytes?) is deliberately NOT here: citations are ephemeral (truncated per
// workflow) and governing[] has no lane tag, so aggregating them is the
// deferred DEF-006 build, not a projection.
// ---------------------------------------------------------------------------
function aggregateInjectionCost(projectRoot, fromMs, toMs) {
  const tracePath = path.join(projectRoot, ".devt", "state", "hook-trace", "run-hook.jsonl");
  if (!fs.existsSync(tracePath)) return { available: false };
  let fires = 0, bytes = 0, max = 0;
  try {
    for (const line of fs.readFileSync(tracePath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.script !== "workflow-context-injector.sh") continue;
      const ms = new Date(r.ts).getTime();
      if (!Number.isFinite(ms) || ms < fromMs || ms >= toMs) continue;
      fires++;
      const b = r.stdout_bytes || 0;
      bytes += b;
      if (b > max) max = b;
    }
  } catch { return { available: false }; }
  return { available: true, fires, bytes, avg: fires ? Math.round(bytes / fires) : 0, max, est_tokens_per_fire: fires ? Math.round(bytes / fires / 4) : 0 };
}

function renderInjectionSection(inj) {
  // Renders only when the injector actually injected in-window (like the
  // coverage/guard sections when empty). Kill-receipt: if this line changes no
  // decision across ~3 report windows, delete it.
  if (!inj || !inj.available || inj.fires === 0 || inj.bytes === 0) return "";
  const lines = ["## devt Memory Injection Cost", ""];
  lines.push(`- Context injected: ~${inj.bytes} bytes over ${inj.fires} injector fire${inj.fires === 1 ? "" : "s"} — ~${inj.avg} bytes/fire (~${inj.est_tokens_per_fire} tokens/fire est., peak ${inj.max} bytes).`);
  lines.push("- _devt's `workflow-context-injector` ONLY (memory_signal + governing lines + advisories). Excludes co-installed plugins' Read-hook injections — e.g. claude-mem's per-file-read observation blocks, field-measured far larger — which come from a different plugin's hook and are invisible here. Direction, not a target; pair with % cited (deferred DEF-006) to judge waste._");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function run(subcommand, args) {
  switch (subcommand) {
    case "window": {
      const wIdx = args.indexOf("--weeks");
      const weeks = wIdx >= 0 && args[wIdx + 1] ? parseInt(args[wIdx + 1], 10) : 1;
      return computeWindow(weeks);
    }

    case "generate": {
      const wIdx = args.indexOf("--weeks");
      const weeks = wIdx >= 0 && args[wIdx + 1] ? parseInt(args[wIdx + 1], 10) : 1;
      const oIdx = args.indexOf("--output");
      const outputPath = oIdx >= 0 ? args[oIdx + 1] : null;

      const window = computeWindow(weeks);
      const contributors = loadContributors();
      const projectRoot = require("./config.cjs").findProjectRoot();
      const changedFiles = new Set();
      const stats = parseGitLog(window.from, window.to, contributors, changedFiles, projectRoot);
      const title = `Contribution Report: ${window.from} to ${window.to}`;

      const fromMs = new Date(window.from).getTime();
      const toMs = new Date(window.to).getTime() + 24 * 3600 * 1000;
      const memoryEvents = aggregateMemoryEvents(projectRoot, fromMs, toMs);
      const coverage = aggregateAffectsCoverage(projectRoot, [...changedFiles]);
      const guard = aggregateGuardTelemetry(projectRoot, fromMs, toMs);
      const injection = aggregateInjectionCost(projectRoot, fromMs, toMs);
      const report = renderMarkdown(stats, title) + renderMemorySection(memoryEvents)
        + renderAffectsCoverageSection(coverage) + renderGuardSection(guard) + renderInjectionSection(injection);

      if (outputPath) {
        atomicWriteFileSync(outputPath, report);
        return { output: outputPath, window, authors: Object.keys(stats).length, memory_events: memoryEvents, affects_coverage: coverage, guard_telemetry: guard, injection_cost: injection };
      }

      return { report, window, authors: Object.keys(stats).length, memory_events: memoryEvents, affects_coverage: coverage, guard_telemetry: guard, injection_cost: injection };
    }

    default:
      return { error: "Unknown report subcommand: " + subcommand + ". Use: window, generate" };
  }
}

module.exports = { run, computeWindow, parseGitLog, renderMarkdown, aggregateMemoryEvents, renderMemorySection, aggregateAffectsCoverage, renderAffectsCoverageSection, aggregateGuardTelemetry, renderGuardSection };
