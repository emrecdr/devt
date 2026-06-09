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
 * Subcommands:
 *   list                            Print agent → workflow regions map (from marker scan)
 *   contracts                       Print per-agent context_blocks resolved from io-contracts.yaml
 *   render <agent>:<wf>             Render one envelope to stdout (template with placeholders)
 *   render-filled <agent>:<wf|auto> Render envelope with state-driven placeholder substitution.
 *                                   `auto` resolves workflow_id from .devt/state/workflow.yaml.
 *                                   Unknown placeholders preserved verbatim (prose-descriptions
 *                                   like `{learning_context — ...}` instruct the orchestrator,
 *                                   not the substituter).
 *   compile --check                 Diff would-be-rendered vs committed; exit 1 on drift
 *   compile --write                 Re-render and write marker regions atomically
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
        outputs: { primary: null, sidecar: null, expected_sections: null },
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
      } else if (inOutputs && key === "expected_sections") {
        const list = parseInlineList(valueStr);
        if (list !== null) {
          agents[currentAgent].outputs.expected_sections = list;
        } else if (valueStr.trim().startsWith("[")) {
          // Looks like a list but didn't parse — silent-skip would poison
          // structural-drift detection for this agent without any signal.
          throw new Error(
            `io-contracts.yaml::${currentAgent}.outputs.expected_sections has malformed list value: ${JSON.stringify(valueStr)}`,
          );
        }
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
  // Prefer workflow-specific template (e.g. architect-dev-arch-health for the
  // dispatch:architect:dev-arch-health variant) over the agent default. This
  // lets a single agent type ship multiple envelope variants for different
  // call sites without breaking the contract model.
  const specificPath = path.join(ENVELOPES_DIR, `${agent}-${workflowId}.tmpl.md`);
  const defaultPath = path.join(ENVELOPES_DIR, `${agent}.tmpl.md`);
  const envelopePath = fs.existsSync(specificPath) ? specificPath : defaultPath;
  if (!fs.existsSync(envelopePath)) {
    throw new Error(`no envelope template for agent '${agent}' (looked for ${specificPath}, then ${defaultPath})`);
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

// Resolves `<agent>:auto` against the active workflow. Returns the resolved
// workflow_id or throws with an exit-2 hint when no workflow is active —
// callers should treat the throw as a hard failure (no fallback to a guessed
// workflow_id), so the orchestrator sees an explicit "pass --workflow-id"
// message rather than silently rendering against a stale workflow_id_history
// entry.
function resolveAutoWorkflowId() {
  const state = require("./state.cjs");
  let s;
  try { s = state.readState(); }
  catch (e) { throw new Error(`auto-workflow-id: state read failed (${e.message})`); }
  if (!s || !s.active || !s.workflow_id) {
    throw new Error("auto-workflow-id: no active workflow; pass <agent>:<workflow_id> explicitly");
  }
  return s.workflow_id;
}

// Walks the envelope template and substitutes known placeholders against the
// state-driven context. Three placeholder classes:
//   (a) Simple data refs — {scope_trust_json}, {task_description}, etc.
//   (b) Structured lookups — {governing_rules.content["X"]}, {inline_guardrails["X"]},
//       {governing_rules.rules_hash}, {models.X}, {rubrics.X}, {inline_rubrics.X}
//   (c) Prose descriptions — {learning_context — ...}, {injected from .devt/config.json ...}
//       Left verbatim. These instruct the agent to look up context at read-time;
//       not substitution targets.
// Both `{X["key"]}` and `{X[\"key\"]}` shell-escaped variants are handled —
// templates carry the escape form because they're meant to be pasted inside
// double-quoted bash heredocs, but `render-filled` is for informational paste,
// not shell-eval. Both match the same substitution.
function applySubstitutions(template, subs) {
  let out = template;

  // Structured lookups — order matters: replace the bracketed forms BEFORE
  // any prefix-overlapping simple ref (e.g. {governing_rules.rules_hash}
  // would partial-match if the .content[X] regex were too loose).
  out = out.replace(/\{governing_rules\.content\[\\?"([^"\\]+)\\?"\]\}/g, (m, key) => {
    const v = subs.governing_rules && subs.governing_rules.content && subs.governing_rules.content[key];
    return v !== undefined ? v : m;
  });
  out = out.replace(/\{governing_rules\.rules_hash\}/g, () =>
    (subs.governing_rules && subs.governing_rules.rules_hash) || ""
  );
  out = out.replace(/\{inline_guardrails\[\\?"([^"\\]+)\\?"\]\}/g, (m, key) => {
    const v = subs.inline_guardrails && subs.inline_guardrails[key];
    return v !== undefined ? v : m;
  });
  out = out.replace(/\{inline_rubrics\.([\w-]+)\}/g, (m, key) => {
    const v = subs.inline_rubrics && subs.inline_rubrics[key];
    return v !== undefined ? v : m;
  });
  out = out.replace(/\{rubrics\.([\w-]+)\}/g, (m, key) => {
    const v = subs.rubrics && subs.rubrics[key];
    return v !== undefined ? v : m;
  });
  out = out.replace(/\{models\.([\w-]+)\}/g, (m, key) => {
    const v = subs.models && subs.models[key];
    return v !== undefined ? v : m;
  });

  // Simple data refs. Each key maps 1:1 to a placeholder shape `{key}`.
  // Three distinct task-description aliases all map to state.task — the
  // workflow type determines which one appears in the envelope, but the
  // semantic content is the same task field.
  const DATA_REFS = {
    scope_trust_json: () => JSON.stringify(subs.scope_trust_json || {}),
    scope_hint_json: () => JSON.stringify(subs.scope_hint_json || []),
    memory_signal_json: () => JSON.stringify(subs.memory_signal_json || {}),
    god_node_warnings_json: () => JSON.stringify(subs.god_node_warnings_json || {}),
    graphify_status_json: () => JSON.stringify(subs.graphify_status_json || {}),
    graph_impact_content: () => subs.graph_impact_content || "",
    prior_outputs: () => subs.prior_outputs || "",
    provenance_protocol: () => subs.provenance_protocol || "",
    task_description: () => subs.task || "",
    bug_description: () => subs.task || "",
    review_scope_description: () => subs.task || "",
    CLAUDE_PLUGIN_ROOT: () => subs.CLAUDE_PLUGIN_ROOT || "",
  };
  for (const [key, getter] of Object.entries(DATA_REFS)) {
    // Anchor with negative-lookahead to skip prose-description placeholders
    // that START with the same key but carry additional text — e.g.
    // `{learning_context from context_init — ...}` should NOT match a
    // hypothetical `{learning_context}` rule. Each DATA_REFS key matches
    // ONLY `{key}` exactly.
    const re = new RegExp(`\\{${key}\\}`, "g");
    out = out.replace(re, getter());
  }

  return out;
}

function buildSubstitutionTable(agent) {
  const { findProjectRoot } = require("./config.cjs");
  const { getMergedConfig } = require("./config.cjs");
  const { loadGoverningRules, loadInlineGuardrails, loadInlineRubrics, loadGraphImpact, loadPriorSidecars } = require("./init.cjs");
  const { getModels } = require("./model-profiles.cjs");
  const state = require("./state.cjs");

  let projectRoot;
  try { projectRoot = findProjectRoot(); }
  catch { projectRoot = process.cwd(); }

  const config = getMergedConfig();
  const models = getModels(config.model_profile || "balanced", config.model_overrides);

  // loadGoverningRules / loadInlineGuardrails return { content, ... } shapes;
  // we hoist `content` to the top level so the regex substitution can index
  // by-key without an extra .content prop dance.
  const gr = loadGoverningRules(projectRoot);
  const ig = loadInlineGuardrails(PLUGIN_ROOT);
  const ir = loadInlineRubrics(PLUGIN_ROOT, projectRoot, (config.rubrics || {}));
  const gi = loadGraphImpact(projectRoot);
  // Prior-output sidecar injection — auto-discovers .devt/state/*.json
  // produced by upstream agents. Skips the consumer's own sidecar so
  // verifier never sees stale verification.json from a prior phase.
  // Degrades to empty string when no agent passed or no sidecars exist.
  const ps = agent ? loadPriorSidecars(projectRoot, agent) : { content: "", count: 0 };

  let s = {};
  try { s = state.readState() || {}; } catch { s = {}; }

  // Provenance citation protocol — instructs the consuming agent to cite
  // `[via call: <id>]` when a finding/recommendation was sourced from a
  // graph-impact.md drill-down section (each carries an 8-char hex
  // correlation_id from the MCP _meta envelope). Conditional: only inject
  // when graph-impact.md is actually present. In graphify-skip flows the
  // protocol would have nothing to cite and would just waste tokens.
  // Closes greenfield's audit finding #5 "WHAT was called, not WHAT
  // signal was delivered" — converts graphify from an opaque dependency
  // into an auditable signal source (mcp-stats --correlation-id=<id>
  // resolves citations back to the specific MCP call).
  const provenanceProtocol = (gi.status === "present")
    ? `<provenance_protocol>When a finding, risk, or recommendation traces back to a `+
      `\`## Drill-down: <SYM> [call: <corr_id>]\` section in graph-impact.md, append `+
      `\`(via call: <corr_id>)\` to that finding. The 8-char hex correlation_id maps `+
      `1-to-1 to a specific MCP call — \`node bin/devt-tools.cjs mcp-stats `+
      `--correlation-id=<id>\` resolves the call back to its args + response, so `+
      `downstream auditors can verify the graph-derived signal. Skip the citation `+
      `when no drill-down is the source (grep-derived, code-derived, doc-derived).`+
      `</provenance_protocol>`
    : "";

  return {
    governing_rules: { content: gr.content || {}, rules_hash: gr.rules_hash || "" },
    inline_guardrails: ig.content || {},
    inline_rubrics: ir.content || {},
    graph_impact_content: gi.content || "",
    graph_impact_status: gi.status || "absent",
    prior_outputs: ps.content || "",
    prior_outputs_count: ps.count || 0,
    provenance_protocol: provenanceProtocol,
    rubrics: config.rubrics || {},
    models: models || {},
    scope_trust_json: s.scope_trust_json,
    scope_hint_json: s.scope_hint_json,
    memory_signal_json: s.memory_signal_json,
    god_node_warnings_json: s.god_node_warnings_json,
    graphify_status_json: s.graphify_status_json,
    task: s.task || s.task_description || "",
    CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT || PLUGIN_ROOT,
  };
}

function cmdRenderFilled(target) {
  if (!target || !target.includes(":")) {
    throw new Error("Usage: dispatch render-filled <agent>:<workflow_id|auto> (colon-joined) OR dispatch render-filled <agent> <workflow_id|auto> (space-separated)");
  }
  let [agent, workflowId] = target.split(":");
  if (workflowId === "auto") {
    workflowId = resolveAutoWorkflowId();
  }
  const template = renderEnvelope(agent, workflowId, readContracts());
  const subs = buildSubstitutionTable(agent);
  return applySubstitutions(template, subs);
}

function cmdCompile(mode) {
  const regions = listMarkerRegions();
  const drift = [];
  const contracts = readContracts();

  // Group by file so we can apply all rewrites to a file in one pass.
  // Crucial: per-region rewrites would invalidate the stale begin_line/end_line
  // of subsequent regions in the same file. Process within a file in REVERSE
  // begin_line order so earlier regions' positions stay valid.
  const byFile = new Map();
  for (const r of regions) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r);
  }

  for (const [file, fileRegions] of byFile) {
    const wfPath = path.join(WORKFLOWS_DIR, file);
    let lines = fs.readFileSync(wfPath, "utf8").split("\n");
    let fileChanged = false;
    // Reverse begin_line order so each rewrite preserves earlier regions' indices.
    const sorted = [...fileRegions].sort((a, b) => b.begin_line - a.begin_line);
    for (const region of sorted) {
      const currentBody = lines.slice(region.begin_line, region.end_line - 1).join("\n");
      let rendered;
      try {
        rendered = renderEnvelope(region.agent, region.workflow_id, contracts);
      } catch (err) {
        drift.push({ ...region, error: err.message });
        continue;
      }
      if (currentBody !== rendered) {
        drift.push({ ...region, drift: true });
        if (mode === "write") {
          lines = [
            ...lines.slice(0, region.begin_line),
            ...rendered.split("\n"),
            ...lines.slice(region.end_line - 1),
          ];
          fileChanged = true;
        }
      }
    }
    if (fileChanged && mode === "write") {
      atomicWriteFileSync(wfPath, lines.join("\n"));
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
    case "render-filled": {
      // Accept both colon-joined `<agent>:<workflow_id|auto>` (canonical) and
      // space-separated `<agent> <workflow_id|auto>` (more intuitive for typed
      // CLI use). cal #19 §7 F3: colon-only is non-obvious; users naturally
      // try space-separated first. Both forms render the same envelope.
      let target = args[0];
      if (target && !target.includes(":") && args[1]) {
        target = args[0] + ":" + args[1];
      }
      let out;
      try { out = cmdRenderFilled(target); }
      catch (err) {
        process.stderr.write(err.message + "\n");
        return 2;
      }
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
      process.stderr.write("Usage: dispatch <list|contracts|render|render-filled|compile>\n");
      return 2;
  }
}

module.exports = { run, parseIoContracts, listMarkerRegions, cmdRenderFilled };
