"use strict";

/**
 * dispatch — compile-time generation of per-agent dispatch envelopes.
 *
 * Reads `agents/io-contracts.yaml` for the per-agent `context_blocks` + `graphify_inputs`
 * contract, assembles the dispatch envelope from block fragments under
 * `templates/dispatch/blocks/`, and writes the rendered envelope into marker regions
 * of workflow files between `<!-- BEGIN dispatch:<agent>:<workflow> -->` and
 * `<!-- END dispatch:<agent>:<workflow> -->`.
 *
 * Closes the "Smoke test (future)" TODO at `agents/io-contracts.yaml:29` — the
 * `compile --check` subcommand IS the gate that asserts dispatch markup matches
 * the per-agent contract.
 *
 * Subcommands:
 *   list                    Print agent → workflow regions map (from marker scan)
 *   contracts               Print per-agent context_blocks resolved from io-contracts.yaml
 *   render <agent>:<wf>     Render one envelope to stdout
 *   compile --check         Diff would-be-rendered vs committed; exit 1 on drift
 *   compile --write         Re-render and write marker regions atomically
 *
 * Zero-dep: io-contracts.yaml is parsed by a purpose-built `parseIoContracts`
 * following the `init.cjs::parseSkillIndex` precedent — no YAML library.
 */

const fs = require("fs");
const path = require("path");
const { atomicWriteFileSync } = require("./io.cjs");

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const CONTRACTS_PATH = path.join(PLUGIN_ROOT, "agents", "io-contracts.yaml");
const TEMPLATES_ROOT = path.join(PLUGIN_ROOT, "templates", "dispatch");
const BLOCKS_DIR = path.join(TEMPLATES_ROOT, "blocks");
const ENVELOPES_DIR = path.join(TEMPLATES_ROOT, "envelopes");
const WORKFLOWS_DIR = path.join(PLUGIN_ROOT, "workflows");

const MARKER_LINE = /^<!--\s*(BEGIN|END)\s+dispatch:([\w-]+):([\w-]+)\s*-->\s*$/;

function parseIoContracts(content) {
  const lines = content.split("\n");
  const agents = {};
  let inAgents = false;
  let currentAgent = null;
  let inInputs = false;
  let inOutputs = false;

  const parseInlineList = (s) => {
    const t = s.trim();
    if (!t.startsWith("[") || !t.endsWith("]")) return null;
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => x.trim()).filter(Boolean);
  };
  const indentOf = (l) => l.length - l.trimStart().length;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = indentOf(line);

    if (indent === 0 && trimmed === "agents:") {
      inAgents = true;
      continue;
    }
    if (!inAgents) continue;

    if (indent === 2 && trimmed.endsWith(":")) {
      currentAgent = trimmed.slice(0, -1);
      agents[currentAgent] = {
        frontmatter_skills: [],
        index_buckets: [],
        outputs: { primary: null, sidecar: null },
        inputs: { context_blocks: [], graphify_inputs: [] },
      };
      inInputs = false;
      inOutputs = false;
      continue;
    }
    if (!currentAgent) continue;

    if (indent === 4 && trimmed === "inputs:") {
      inInputs = true;
      inOutputs = false;
      continue;
    }
    if (indent === 4 && trimmed === "outputs:") {
      inOutputs = true;
      inInputs = false;
      continue;
    }
    if (indent === 4) {
      inInputs = false;
      inOutputs = false;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx < 0) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const valueStr = trimmed.slice(colonIdx + 1).trim();
      if (key === "frontmatter_skills" || key === "index_buckets") {
        const list = parseInlineList(valueStr);
        if (list !== null) agents[currentAgent][key] = list;
      }
      continue;
    }

    if (indent === 6) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx < 0) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const valueStr = trimmed.slice(colonIdx + 1).trim();
      if (inInputs && (key === "context_blocks" || key === "graphify_inputs")) {
        const list = parseInlineList(valueStr);
        if (list !== null) agents[currentAgent].inputs[key] = list;
      } else if (inOutputs && (key === "primary" || key === "sidecar")) {
        agents[currentAgent].outputs[key] = valueStr === "null" ? null : valueStr;
      }
    }
  }
  return { agents };
}

function readContracts() {
  if (!fs.existsSync(CONTRACTS_PATH)) {
    throw new Error(`io-contracts.yaml not found at ${CONTRACTS_PATH}`);
  }
  return parseIoContracts(fs.readFileSync(CONTRACTS_PATH, "utf8"));
}

function listMarkerRegions() {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  const regions = [];
  for (const file of fs.readdirSync(WORKFLOWS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const wfPath = path.join(WORKFLOWS_DIR, file);
    const lines = fs.readFileSync(wfPath, "utf8").split("\n");
    let openAgent = null;
    let openLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(MARKER_LINE);
      if (!m) continue;
      const [, kind, agent, wfId] = m;
      if (kind === "BEGIN") {
        if (openAgent) {
          throw new Error(`${file}:${i + 1} unexpected BEGIN dispatch:${agent}:${wfId} — prior BEGIN dispatch:${openAgent} not closed`);
        }
        openAgent = `${agent}:${wfId}`;
        openLine = i;
      } else {
        if (!openAgent) {
          throw new Error(`${file}:${i + 1} unexpected END dispatch:${agent}:${wfId} — no matching BEGIN`);
        }
        if (openAgent !== `${agent}:${wfId}`) {
          throw new Error(`${file}:${i + 1} END dispatch:${agent}:${wfId} does not match open BEGIN dispatch:${openAgent}`);
        }
        regions.push({
          file,
          agent,
          workflow_id: wfId,
          begin_line: openLine + 1,
          end_line: i + 1,
        });
        openAgent = null;
      }
    }
    if (openAgent) {
      throw new Error(`${file} ended with unclosed BEGIN dispatch:${openAgent}`);
    }
  }
  return regions;
}

function renderEnvelope(agent, workflowId, contracts) {
  if (!contracts.agents[agent]) {
    throw new Error(`agent '${agent}' not declared in agents/io-contracts.yaml`);
  }
  const envelopePath = path.join(ENVELOPES_DIR, `${agent}.tmpl.md`);
  if (!fs.existsSync(envelopePath)) {
    throw new Error(`no envelope template for agent '${agent}' at ${envelopePath} (templates land per-agent starting C2)`);
  }
  // Strip trailing newline: the marker-region slice in cmdCompile joins inner
  // lines with "\n" and has no trailing newline. File reads include the
  // trailing newline that editors add. Normalize so byte-comparison succeeds.
  const envelope = fs.readFileSync(envelopePath, "utf8").replace(/\n+$/, "");
  return envelope.replace(/\{\{workflow_id\}\}/g, workflowId);
}

function cmdList() {
  return { regions: listMarkerRegions() };
}

function cmdContracts() {
  const { agents } = readContracts();
  const envelopesPresent = fs.existsSync(ENVELOPES_DIR);
  const blocksPresent = fs.existsSync(BLOCKS_DIR);
  const summary = {};
  for (const [name, c] of Object.entries(agents)) {
    summary[name] = {
      context_blocks: c.inputs.context_blocks,
      graphify_inputs: c.inputs.graphify_inputs,
      envelope_template: envelopesPresent && fs.existsSync(path.join(ENVELOPES_DIR, `${name}.tmpl.md`))
        ? `templates/dispatch/envelopes/${name}.tmpl.md`
        : null,
    };
  }
  return { agents: summary, blocks_dir_present: blocksPresent, envelopes_dir_present: envelopesPresent };
}

function cmdRender(target) {
  if (!target || !target.includes(":")) {
    throw new Error("Usage: dispatch render <agent>:<workflow_id>");
  }
  const [agent, workflowId] = target.split(":");
  return renderEnvelope(agent, workflowId, readContracts());
}

function cmdCompile(mode) {
  const regions = listMarkerRegions();
  const drift = [];
  for (const region of regions) {
    const wfPath = path.join(WORKFLOWS_DIR, region.file);
    const lines = fs.readFileSync(wfPath, "utf8").split("\n");
    const currentBody = lines.slice(region.begin_line, region.end_line - 1).join("\n");
    let rendered;
    try {
      rendered = renderEnvelope(region.agent, region.workflow_id, readContracts());
    } catch (err) {
      drift.push({ ...region, error: err.message });
      continue;
    }
    if (currentBody !== rendered) {
      drift.push({ ...region, drift: true });
      if (mode === "write") {
        const newLines = [
          ...lines.slice(0, region.begin_line),
          ...rendered.split("\n"),
          ...lines.slice(region.end_line - 1),
        ];
        atomicWriteFileSync(wfPath, newLines.join("\n"));
      }
    }
  }
  return { regions_checked: regions.length, drift, mode };
}

function run(subcommand, args) {
  const json = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
  switch (subcommand) {
    case "list":
      json(cmdList());
      return 0;
    case "contracts":
      json(cmdContracts());
      return 0;
    case "render": {
      const out = cmdRender(args[0]);
      process.stdout.write(out + (out.endsWith("\n") ? "" : "\n"));
      return 0;
    }
    case "compile": {
      const mode = args.includes("--write") ? "write" : "check";
      const result = cmdCompile(mode);
      json(result);
      return mode === "check" && result.drift.length > 0 ? 1 : 0;
    }
    default:
      process.stderr.write("Usage: dispatch <list|contracts|render|compile>\n");
      return 2;
  }
}

module.exports = { run, parseIoContracts, listMarkerRegions };
