"use strict";

/**
 * agent resume — generate paste-ready SendMessage continuation for a walled agent.
 *
 * Reads the relevant sidecar from .devt/state/, extracts the continuation point
 * (next_section field OR auto-resume marker when absent), and emits a SendMessage
 * prompt block the operator pastes to resume the agent without losing conversation
 * cache.
 *
 * Reduces a 4-step manual recovery (find sidecar → infer next_section → construct
 * continuation prompt → remember SendMessage vs Agent) to a single CLI call.
 *
 * Usage:
 *   node bin/devt-tools.cjs agent resume [agent_id] [--section=NAME] [--sidecar=PATH]
 *
 * When agent_id is omitted: scans .devt/state/*.json for sidecars with
 * status: "PARTIAL" and picks the newest mtime.
 *
 * Output: paste-ready SendMessage(to="<id>", content="...") block to stdout.
 * Non-zero exit on usage error / no sidecar found.
 */

const fs = require("fs");
const path = require("path");
const { findProjectRoot } = require("./config.cjs");

const SIDECAR_GLOB = [
  "impl-summary.json",
  "impl-summary-",  // any impl-summary-<slug>.json
  "review.json",
  "review-lane-",
  "test-summary.json",
  "test-summary-",
  "verification.json",
  "verification-",
  "debug-summary.json",
];

function listSidecarCandidates(stateDir) {
  if (!fs.existsSync(stateDir)) return [];
  return fs.readdirSync(stateDir)
    .filter(f => f.endsWith(".json"))
    .filter(f => SIDECAR_GLOB.some(pat => pat.endsWith("-") ? f.startsWith(pat) : f === pat))
    .map(f => ({ name: f, path: path.join(stateDir, f) }));
}

function loadSidecar(sidecarPath) {
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  } catch (e) {
    return null;
  }
}

function findAutoResumeTarget(stateDir) {
  const candidates = listSidecarCandidates(stateDir);
  const partials = [];
  for (const c of candidates) {
    const data = loadSidecar(c.path);
    if (!data) continue;
    const status = String(data.status || "").toUpperCase();
    if (status === "PARTIAL") {
      const stat = fs.statSync(c.path);
      partials.push({ ...c, data, mtimeMs: stat.mtimeMs });
    }
  }
  if (partials.length === 0) return null;
  partials.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return partials[0];
}

function findByAgentId(stateDir, agentId) {
  const candidates = listSidecarCandidates(stateDir);
  for (const c of candidates) {
    const data = loadSidecar(c.path);
    if (!data) continue;
    if (data.agent_id === agentId || data.subagent_id === agentId) {
      return { ...c, data };
    }
  }
  return null;
}

function renderResumePrompt({ agentId, sidecarRelPath, nextSection, status, completed }) {
  const lines = [];
  if (nextSection) {
    lines.push(`<continue_from_section>${nextSection}</continue_from_section>`);
  } else {
    lines.push(`<continue_from_checkpoint/>`);
  }
  lines.push(`<context>`);
  if (completed && completed.length > 0) {
    lines.push(`  <prior_work>Read ${sidecarRelPath} — completed: ${completed.join(", ")}. Status was: ${status || "unknown"}.</prior_work>`);
  } else {
    lines.push(`  <prior_work>Read ${sidecarRelPath} for current state. Status was: ${status || "unknown"}.</prior_work>`);
  }
  if (nextSection) {
    lines.push(`  <task>Continue from section ${nextSection}. Same Q8 protocol — emit Status: PARTIAL with next_section if you hit the wall again.</task>`);
  } else {
    lines.push(`  <task>Pick up where you left off — the sidecar shows incomplete work but no explicit next_section. Re-scan your prior output and continue from the most recent incomplete section. Emit Status: PARTIAL with next_section if you hit the wall.</task>`);
  }
  lines.push(`</context>`);
  return `SendMessage(to="${agentId || "<paste-agent-id-here>"}", content="""\n${lines.join("\n")}\n""")`;
}

function run(subcommand, args) {
  if (subcommand !== "resume") {
    process.stderr.write("Usage: agent resume [agent_id] [--section=NAME] [--sidecar=PATH]\n");
    return 2;
  }

  const positional = args.filter(a => !a.startsWith("--"));
  const sectionFlag = args.find(a => a.startsWith("--section="));
  const sidecarFlag = args.find(a => a.startsWith("--sidecar="));
  const overrideSection = sectionFlag ? sectionFlag.slice("--section=".length).trim() : null;
  const overrideSidecar = sidecarFlag ? sidecarFlag.slice("--sidecar=".length).trim() : null;

  const projectRoot = findProjectRoot();
  const stateDir = path.join(projectRoot, ".devt", "state");
  if (!fs.existsSync(stateDir)) {
    process.stderr.write(`agent resume: .devt/state/ not found at ${projectRoot} — no active project state.\n`);
    return 2;
  }

  let target = null;
  if (overrideSidecar) {
    const sidecarPath = path.isAbsolute(overrideSidecar)
      ? overrideSidecar
      : path.join(projectRoot, overrideSidecar);
    const data = loadSidecar(sidecarPath);
    if (!data) {
      process.stderr.write(`agent resume: sidecar not readable: ${sidecarPath}\n`);
      return 2;
    }
    target = { name: path.basename(sidecarPath), path: sidecarPath, data };
  } else if (positional[0]) {
    target = findByAgentId(stateDir, positional[0]);
    if (!target) {
      process.stderr.write(`agent resume: no sidecar with agent_id=${positional[0]} in .devt/state/ — pass --sidecar=PATH explicitly, or omit to auto-detect newest PARTIAL.\n`);
      return 2;
    }
  } else {
    target = findAutoResumeTarget(stateDir);
    if (!target) {
      process.stderr.write(`agent resume: no PARTIAL sidecars found in .devt/state/. If the agent walled mid-section without writing PARTIAL status, pass --sidecar=PATH explicitly.\n`);
      return 2;
    }
  }

  const sidecarRel = path.relative(projectRoot, target.path);
  const data = target.data;
  const agentId = data.agent_id || data.subagent_id || null;
  const status = data.status || null;
  const nextSection = overrideSection || data.next_section || null;
  const completed = Array.isArray(data.sections_completed)
    ? data.sections_completed
    : (Array.isArray(data.completed_sections) ? data.completed_sections : []);

  const prompt = renderResumePrompt({
    agentId,
    sidecarRelPath: sidecarRel,
    nextSection,
    status,
    completed,
  });

  if (!agentId) {
    process.stderr.write(`agent resume: sidecar ${sidecarRel} has no agent_id field — paste-ready block uses <paste-agent-id-here> placeholder; substitute the real subagent_id from the original Task() dispatch.\n`);
  }
  if (!nextSection) {
    process.stderr.write(`agent resume: sidecar ${sidecarRel} has no next_section — agent likely walled mid-section before writing it. Emitting <continue_from_checkpoint/> with "scan and continue" task instead.\n`);
  }

  process.stdout.write(prompt + "\n");
  return 0;
}

module.exports = { run, listSidecarCandidates, findAutoResumeTarget, findByAgentId, renderResumePrompt };
