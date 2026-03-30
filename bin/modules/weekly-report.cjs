"use strict";

/**
 * Weekly contribution report — pure Node.js.
 *
 * Parses git log output, computes time windows, and renders markdown reports.
 * Zero external dependencies.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");

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

function parseGitLog(fromDate, toDate, contributors) {
  const args = [
    "log", "--all",
    "--after=" + fromDate, "--before=" + toDate,
    "--format=%H|%an|%ai|%s", "--numstat",
  ];

  let output;
  try {
    output = execFileSync("git", args, { encoding: "utf8", timeout: 30000 });
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
      const stats = parseGitLog(window.from, window.to, contributors);
      const title = `Contribution Report: ${window.from} to ${window.to}`;
      const report = renderMarkdown(stats, title);

      if (outputPath) {
        const tmp = outputPath + ".tmp";
        fs.writeFileSync(tmp, report);
        fs.renameSync(tmp, outputPath);
        return { output: outputPath, window, authors: Object.keys(stats).length };
      }

      return { report, window, authors: Object.keys(stats).length };
    }

    default:
      return { error: "Unknown report subcommand: " + subcommand + ". Use: window, generate" };
  }
}

module.exports = { run, computeWindow, parseGitLog, renderMarkdown };
