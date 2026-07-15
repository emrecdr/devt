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
        inputs: { context_blocks: [], graphify_inputs: [], context_blocks_exempt: [] },
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
      if (inInputs && (key === "context_blocks" || key === "graphify_inputs" || key === "context_blocks_exempt")) {
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

// Compute the EDIT-SOURCE marker for a given agent + workflow_id. Returns
// the relative path to the template that cmdCompile would render. Used by
// cmdCompile to prepend a marker line to the in-workflow compiled body so
// editors see the actual template source at edit time (K119 enforces).
// Kept separate from renderEnvelope so render-filled output (CLI consumer
// paste path) stays free of the marker (K2 expects pure Task() output).
function editSourceMarkerFor(agent, workflowId) {
  const specificPath = path.join(ENVELOPES_DIR, `${agent}-${workflowId}.tmpl.md`);
  const defaultPath = path.join(ENVELOPES_DIR, `${agent}.tmpl.md`);
  const envelopePath = fs.existsSync(specificPath) ? specificPath : defaultPath;
  return `<!-- EDIT-SOURCE: ${path.relative(PLUGIN_ROOT, envelopePath)} -->`;
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

// Structural contract gate: assert every compiled dispatch region carries an
// XML block for each context_block its agent declares, minus that variant's
// declared context_blocks_exempt entries. Generalizes the per-agent presence
// greps — a dispatch silently missing a declared governance block (the class
// that left the researcher blind to <memory_signal>) becomes one structural
// failure caught for every agent+variant, not one literal string at a time.
function cmdCheckContracts() {
  const { agents } = readContracts();
  const violations = [];

  // Audit the suppression list first: an exemption whose block the agent never
  // declared is dead config that could mask a real gap if a block name later
  // changes. Force every exemption to name a real <workflow_id>:<declared-block>.
  for (const [agent, c] of Object.entries(agents)) {
    const declared = new Set(c.inputs.context_blocks || []);
    for (const entry of c.inputs.context_blocks_exempt || []) {
      const block = entry.includes(":") ? entry.slice(entry.indexOf(":") + 1) : "";
      if (!entry.includes(":") || !declared.has(block)) {
        violations.push({ agent, error: `context_blocks_exempt '${entry}' must be <workflow_id>:<declared-context_block>` });
      }
    }
  }

  const regions = listMarkerRegions();
  const fileCache = {};
  for (const r of regions) {
    const contract = agents[r.agent];
    if (!contract) {
      violations.push({ file: r.file, region: `${r.agent}:${r.workflow_id}`, error: "agent not declared in io-contracts.yaml" });
      continue;
    }
    const exemptPrefix = `${r.workflow_id}:`;
    const exempt = new Set(
      (contract.inputs.context_blocks_exempt || [])
        .filter((e) => e.startsWith(exemptPrefix))
        .map((e) => e.slice(exemptPrefix.length)),
    );
    const required = (contract.inputs.context_blocks || []).filter((b) => !exempt.has(b));
    if (!fileCache[r.file]) {
      fileCache[r.file] = fs.readFileSync(path.join(WORKFLOWS_DIR, r.file), "utf8").split("\n");
    }
    const body = fileCache[r.file].slice(r.begin_line - 1, r.end_line).join("\n");
    const missing = required.filter((b) => !body.includes(`<${b}`));
    if (missing.length) {
      violations.push({ file: r.file, region: `${r.agent}:${r.workflow_id}`, begin_line: r.begin_line, missing });
    }
  }

  return { ok: violations.length === 0, regions_checked: regions.length, violations };
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
    auto_memory_json: () => JSON.stringify(subs.auto_memory_json || []),
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
  // Closes a field audit finding: "WHAT was called, not WHAT
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

  // Cal #32 rank #2 — auto_memory bridge: read from preflight-brief.json
  // sidecar instead of workflow.yaml. The sidecar carries laneH output
  // (G2/cal #31.C: auto-memory + claude-mem-harvest matches) directly. Not
  // written to state.yaml because (a) no workflow step converts brief→state
  // for this field, and (b) reading once-per-dispatch is cheap. Best-effort:
  // empty array on missing brief OR parse error preserves dispatch path.
  let autoMemoryJson = [];
  try {
    const fs = require("fs");
    const path = require("path");
    const briefPath = path.join(projectRoot, ".devt", "state", "preflight-brief.json");
    if (fs.existsSync(briefPath)) {
      const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
      if (brief && Array.isArray(brief.auto_memory)) {
        autoMemoryJson = brief.auto_memory;
      }
    }
  } catch { /* missing brief / parse error → empty (degrades to existing memory_signal path) */ }

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
    auto_memory_json: autoMemoryJson,
    god_node_warnings_json: s.god_node_warnings_json,
    graphify_status_json: s.graphify_status_json,
    task: s.task || s.task_description || "",
    CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT || PLUGIN_ROOT,
  };
}

// Strip top-level `## <heading>` sections from a markdown string whose exact
// heading title appears in the exclude list. Match is on the trimmed title
// after the leading `## ` — predictable, no regex sub-matching. Each excluded
// section spans from its `## Heading` line up to (but not including) the next
// `## ` line OR end of string. Preamble (content before the first `## ` line)
// is always preserved. Returns {filtered, bytesSaved, sectionsCut}.
function stripMarkdownSections(content, excludeHeadings) {
  if (!content || !excludeHeadings || excludeHeadings.length === 0) {
    return { filtered: content || "", bytesSaved: 0, sectionsCut: 0 };
  }
  const excludeSet = new Set(excludeHeadings.map(h => h.trim()));
  const lines = content.split("\n");
  const out = [];
  let i = 0;
  let cut = 0;
  let savedBytes = 0;
  while (i < lines.length && !/^##\s+/.test(lines[i])) {
    out.push(lines[i]);
    i++;
  }
  while (i < lines.length) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (!m) { out.push(lines[i]); i++; continue; }
    const title = m[1].trim();
    const start = i;
    i++;
    while (i < lines.length && !/^##\s+/.test(lines[i])) i++;
    const sectionLines = lines.slice(start, i);
    if (excludeSet.has(title)) {
      cut++;
      savedBytes += sectionLines.join("\n").length + 1;
    } else {
      out.push(...sectionLines);
    }
  }
  return { filtered: out.join("\n"), bytesSaved: savedBytes, sectionsCut: cut };
}

function cmdRenderFilled(target, options) {
  if (!target || !target.includes(":")) {
    throw new Error("Usage: dispatch render-filled <agent>:<workflow_id|auto> [--rules-exclude=heading,list] (colon-joined) OR dispatch render-filled <agent> <workflow_id|auto> (space-separated)");
  }
  let [agent, workflowId] = target.split(":");
  if (workflowId === "auto") {
    workflowId = resolveAutoWorkflowId();
  }
  const template = renderEnvelope(agent, workflowId, readContracts());
  const subs = buildSubstitutionTable(agent);
  const { CLAUDE_MD_BY_REFERENCE_STUB } = require("./init.cjs");

  // --rules-exclude=<list>: opt-in CLAUDE.md (and other governing_rules.content
  // entries) section strip by exact `## Heading` match. Per-dispatch opt-in
  // keeps project portability open; promote to config after field evidence
  // accumulates that specific sections are routinely uncited across
  // dispatches.
  // rulesByReference: swap each governing_rules.content body for a short
  // read-from-disk stub while keeping the template's XML structure and the
  // rules_hash attribute intact. The receiving agent Reads only the rules
  // files relevant to its scope instead of being force-fed the full corpus;
  // rules_hash still gives drift detection without content duplication.
  // CLAUDE.md is dropped outright — the harness auto-injects project
  // CLAUDE.md into every subagent's context, so inlining it pays its byte
  // cost twice. Field-validated on a 5-lane review: selective reads (¼–½ of
  // the corpus, targeted) with zero verifier-flagged quality gaps.
  // Inline content remains the right call for worktree-isolated agents whose
  // disk view may not match the orchestrator's — hence opt-out, not removal.
  if (options && options.rulesByReference && subs.governing_rules && subs.governing_rules.content) {
    const refContent = {};
    for (const key of Object.keys(subs.governing_rules.content)) {
      refContent[key] = key === "CLAUDE.md"
        ? CLAUDE_MD_BY_REFERENCE_STUB
        : `(by-reference: Read ${key} from disk when relevant to your scope — content covered by rules_hash)`;
    }
    subs.governing_rules = { ...subs.governing_rules, content: refContent };
  }

  // rubricByReference: swap the inline rubric body for a short directive stub
  // that points at <rubric_path>. The rubric body is byte-identical across all
  // N lanes, so inlining it multiplies a large static block per lane for zero
  // signal gain. The plugin-root rubric path is a stable Read even from
  // worktree-isolated lanes, so no inline fallback is needed. The axis-walk
  // instruction stays STRONG — a weak or absent "walk EVERY declared axis"
  // directive is what degrades lane reviews to topic-shape output.
  if (options && options.rubricByReference && subs.inline_rubrics) {
    const stub = "(by-reference: Read the rubric at <rubric_path> FIRST, before writing any finding, and walk EVERY declared axis — both the A–G grading-table rows AND every `## Axis [A-Z] —` heading (currently including axis H). These are the SAME axes the verifier will grade; closing them in your first pass avoids a revision loop.)";
    // Stub every configured rubric key — not just the ones loadInlineRubrics
    // returned — so an oversized-rubric empty map still resolves each template's
    // {inline_rubrics.<type>} placeholder to the stub instead of leaking it.
    const rubricKeys = new Set([...Object.keys(subs.inline_rubrics), ...Object.keys(subs.rubrics || {})]);
    subs.inline_rubrics = Object.fromEntries([...rubricKeys].map((k) => [k, stub]));
  }

  const excludeHeadings = (options && options.rulesExclude) || [];
  let totalSaved = 0;
  let totalSectionsCut = 0;
  if (excludeHeadings.length > 0 && subs.governing_rules && subs.governing_rules.content) {
    const newContent = {};
    for (const [key, value] of Object.entries(subs.governing_rules.content)) {
      if (typeof value === "string") {
        const r = stripMarkdownSections(value, excludeHeadings);
        newContent[key] = r.filtered;
        totalSaved += r.bytesSaved;
        totalSectionsCut += r.sectionsCut;
      } else {
        newContent[key] = value;
      }
    }
    subs.governing_rules = { ...subs.governing_rules, content: newContent };
  }

  let out = applySubstitutions(template, subs);
  if (totalSectionsCut > 0) {
    const kb = (totalSaved / 1024).toFixed(1);
    out += `\n<!-- rules-excluded: ${totalSectionsCut} sections (${kb} KB saved) -->\n`;
  }

  // Consolidator envelope fill: the code_review_parallel synthesis template
  // carries {lane_files_newline_separated}, which the generic substitution
  // table can't know — it comes from the lane registry. Fill it with the
  // same filter the consolidate step uses (terminal lanes, foreign cids out)
  // so `render-filled code-reviewer:code_review_parallel` is paste-ready
  // instead of leaving a placeholder the operator must hand-edit — the top
  // field-reported reason the consolidator envelope got hand-rolled.
  if (out.includes("{lane_files_newline_separated}")) {
    try {
      const { lanes } = require("./state.cjs").listLaneOutputs();
      const laneFiles = (lanes || [])
        .filter(l => (l.status === "substance_pass" || l.status === "deferred") && l.cid_match !== "foreign")
        .map(l => l.review_file)
        .filter(Boolean);
      if (laneFiles.length > 0) {
        out = out.replace("{lane_files_newline_separated}", laneFiles.join("\n"));
      }
    } catch { /* no registry — placeholder stays visible; envelope_health flags it */ }
  }

  // <orchestrator_notes> injection (--notes-file). Free-text run-specific
  // directives ride inside <context> so custom judgment doesn't require
  // hand-rolling the whole envelope. Unreadable file is a loud error, not a
  // silent omission — the operator asked for notes, dropping them would be
  // a silent reduction.
  if (options && options.notesFile) {
    let notes;
    try { notes = require("fs").readFileSync(options.notesFile, "utf8").trim(); }
    catch (e) { throw new Error(`--notes-file unreadable: ${e.message}`); }
    if (notes) {
      const block = `    <orchestrator_notes>\n${notes}\n    </orchestrator_notes>\n  `;
      const lastIdx = out.lastIndexOf("</context>");
      out = lastIdx >= 0 ? out.slice(0, lastIdx) + block + out.slice(lastIdx) : out + "\n" + block;
    }
  }

  // Context-Loaded contract rides with by-reference rules: the agent must
  // record which rules files it actually Read, so the consolidator/verifier
  // can check that a lane's reads cover the rules its findings depend on.
  // This is the cheap gate that keeps selective reading honest — without it,
  // a weaker model skipping every Read is invisible.
  if (options && options.rulesByReference) {
    const contract = `    <context_loaded_contract>governing_rules are by-reference: Read the rules files relevant to your scope from disk, and record every file you actually read in a "## Context Loaded" section of your output artifact (name + full/section read). The verifier checks that your reads cover the rules your findings depend on.</context_loaded_contract>\n  `;
    const lastIdx = out.lastIndexOf("</context>");
    if (lastIdx >= 0) {
      out = out.slice(0, lastIdx) + contract + out.slice(lastIdx);
    }
  }

  // Inject <envelope_health> block before </context>. Surfaces (not gates)
  // the substantive payload state of 5 monitored context blocks so the
  // receiving agent can compensate for degraded inputs. The presence check
  // at code-reviewer.md::workflow_context_assertion is "forgiving" by
  // design — even `{}` empty payloads pass it. Field-observed: lane
  // reviewers can't tell when context is degraded (Bitbucket + stale brief
  // → empty memory_signal/scope_trust but envelope LOOKS healthy because
  // the tags are present). envelope_health makes the degradation explicit;
  // the consumer reads it and notes [context_degraded] in review.md when
  // status=degraded. Computed AFTER substitution so placeholder detection
  // catches missing inline_rubrics substitution etc.
  const health = computeEnvelopeHealth(out);
  if (health) {
    const healthJson = JSON.stringify(health);
    // Inject before the LAST </context> (governing_rules and other inlined
    // content can mention </context> in prose; first-occurrence replace would
    // misplace the injection inside the inlined CLAUDE.md content).
    const lastIdx = out.lastIndexOf("</context>");
    if (lastIdx >= 0) {
      out = out.slice(0, lastIdx) +
            `    <envelope_health>${healthJson}</envelope_health>\n  ` +
            out.slice(lastIdx);
    } else {
      out += `\n<envelope_health>${healthJson}</envelope_health>\n`;
    }
  }

  return out;
}

// Classify one context-block body: "absent" (block missing), "placeholder"
// (unsubstituted {token} literal — init didn't populate the sub-table for this
// key, e.g. inline_rubrics substitution failing when render-lanes runs outside
// a full init path), "empty" (literal {}, [], "", or a "(no … available —"
// fallback notice), or "populated".
function classifyBlockBody(raw) {
  if (raw === null || raw === undefined) return "absent";
  const body = String(raw).trim();
  if (/^\{[\w.\-\[\]"]+\}$/.test(body)) {
    return "placeholder";
  }
  if (body === "" || body === "{}" || body === "[]" || /^\(no .* available — /.test(body)) {
    return "empty";
  }
  return "populated";
}

// Classify the substantive payload state of each monitored context
// block. Returns {populated:[names], empty:[names], placeholder:[names],
// status:"healthy"|"degraded"} where status is "healthy" when ≥3 of 5 are
// populated. Returns null when the envelope is too short to meaningfully
// classify (e.g., a stub render). The 5 monitored blocks are the ones whose
// emptiness materially degrades a lane reviewer's discovery quality: scope
// signal (scope_trust/scope_hint), memory anchor (memory_signal), graph
// anchor (graph_impact), and rubric inlined for axis-walk (rubric_content).
function computeEnvelopeHealth(rendered) {
  if (!rendered || typeof rendered !== "string" || rendered.length < 200) return null;
  const MONITORED = ["scope_trust", "scope_hint", "memory_signal", "graph_impact", "rubric_content"];
  const populated = [];
  const empty = [];
  const placeholder = [];
  const bodyOf = (name) => {
    const m = rendered.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return m ? m[1] : null;
  };
  for (const name of MONITORED) {
    let state = classifyBlockBody(bodyOf(name));
    // The rubric signal is satisfied by EITHER an inline <rubric_content> body
    // OR a populated <rubric_path>. By-reference envelopes (verifier,
    // consolidator, lanes) carry only the path — that is a healthy rubric
    // anchor, not a gap — so fall back to rubric_path before recording a
    // non-populated verdict. When the path is ALSO unusable, the inline
    // placeholder/empty verdict is preserved so a genuine substitution miss
    // still surfaces.
    if (name === "rubric_content" && state !== "populated") {
      const pathState = classifyBlockBody(bodyOf("rubric_path"));
      if (pathState === "populated") state = "populated";
      else if (state === "absent" && pathState !== "absent") state = pathState;
    }
    if (state === "absent") continue; // block legitimately omitted for this agent
    if (state === "placeholder") { placeholder.push(name); continue; }
    if (state === "empty") { empty.push(name); continue; }
    populated.push(name);
  }
  // Nothing recognized — envelope shape too unusual to classify
  if (populated.length + empty.length + placeholder.length === 0) return null;
  const status = populated.length >= 3 ? "healthy" : "degraded";
  return { populated, empty, placeholder, status };
}

// STATIC_TAGS / DYNAMIC_TAGS — empirically classified per the envelope
// decomposition study. STATIC means content varies rarely or
// never across dispatches of the same workflow (governing_rules,
// guardrails, rubrics, files_to_read, decisions); DYNAMIC means the
// content changes per dispatch (scope_hint/scope_trust/memory_signal/
// graph_impact/task/prior_outputs/prior_outputs_note). Static blocks
// pay cache_creation cost on every Task() dispatch (each Task() is a
// fresh sub-conversation), so identifying which agents have large
// static slices is the primary input to A1 (selective inlining) work.
const STATIC_TAGS = [
  "governing_rules", "inline_rubrics", "rubric_content", "guardrails_inline",
  "files_to_read", "baseline", "plan", "decisions", "agent_skills", "spec",
  "workflow_type", "rubric_path", "original_task", "provenance_protocol",
  "impl_summary", "test_summary", "impl_summary_sidecar", "review_checklist",
  "graph_impact_status",
];
const DYNAMIC_TAGS = [
  "scope_hint", "scope_trust", "memory_signal", "graph_impact", "graph_impact_content",
  "task_description", "prior_outputs", "prior_outputs_note", "workflow_id", "task",
  "god_node_warnings",
];

// cmdDecompose — render the envelope for an agent:workflow and report
// the static/dynamic byte breakdown. Pure measurement (read-only). Use
// case: "before optimizing token cost on this envelope, what slice
// am I actually targeting?" Output is JSON with summary + per-block
// detail sorted by bytes desc. Per-block bytes include the wrapper tags.
// Unknown tags (not in STATIC_TAGS or DYNAMIC_TAGS) are counted toward
// the "wrapper" residual.
function cmdDecompose(target) {
  if (!target || !target.includes(":")) {
    throw new Error(
      "Usage: dispatch decompose <agent>:<workflow_id|auto> (colon-joined) " +
      "OR dispatch decompose <agent> <workflow_id|auto> (space-separated)",
    );
  }
  let [agent, workflowId] = target.split(":");
  if (workflowId === "auto") workflowId = resolveAutoWorkflowId();
  const text = cmdRenderFilled(target);
  const totalBytes = Buffer.byteLength(text, "utf8");

  // Locate every tag in the rendered text and record its [start, end]
  // byte range. Nested tags (e.g. <review_checklist> inside <governing_rules>)
  // produce overlapping ranges — the prior implementation summed their
  // bytes naively, producing negative wrapper_bytes when nesting was deep.
  // Dedupe by NESTING. A tag's bytes are counted toward the outermost
  // containing tag; inner tags appear in blocks[] for visibility
  // (nested_in field) but their bytes are attributed only to the outermost
  // ancestor in the summary totals.
  function findTagRanges(name, kind) {
    const escapedName = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const re = new RegExp("<" + escapedName + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + escapedName + ">", "g");
    const ranges = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      ranges.push({
        tag: name, kind,
        start: m.index,
        end: m.index + m[0].length,
        bytes: Buffer.byteLength(m[0], "utf8"),
      });
    }
    return ranges;
  }

  const allRanges = [];
  for (const t of STATIC_TAGS) allRanges.push(...findTagRanges(t, "static"));
  for (const t of DYNAMIC_TAGS) allRanges.push(...findTagRanges(t, "dynamic"));

  // Per-byte coverage tracking — guarantees no double-counting and
  // mathematically prevents negative wrapper_bytes. For each range,
  // determine its outermost ancestor by strict containment; outermost
  // ranges paint their byte span into a coverage map. Each byte is
  // attributed to at most one tag (the outermost containing it). The
  // wrapper category is total_bytes - bytes-painted-by-any-range.
  //
  // Why this replaces the prior aggregate-summation: a tag like <task>
  // can legitimately appear MULTIPLE times in a rendered envelope
  // (literal mentions inside CLAUDE.md prose, plus the real dispatch
  // <task> block). Summing per-tag-name across all occurrences double-
  // counted bytes when occurrences overlapped or when CLAUDE.md's prose
  // inside <governing_rules> contained literal <task> mentions — caused
  // a "real" outer-task plus 4 nested-prose-task siblings, all summed
  // as one entity, producing static_bytes + dynamic_bytes > total_bytes
  // and wrapper_bytes < 0.
  for (const r of allRanges) {
    r.nested_in = null;
    let smallestContainer = null;
    let smallestSpan = Infinity;
    for (const other of allRanges) {
      if (other === r) continue;
      // Strict containment: other contains r exclusively.
      if (other.start <= r.start && other.end >= r.end && (other.start < r.start || other.end > r.end)) {
        const span = other.end - other.start;
        if (span < smallestSpan) {
          smallestSpan = span;
          smallestContainer = other;
        }
      }
    }
    if (smallestContainer) r.nested_in = smallestContainer.tag;
  }

  // Paint per-byte coverage from outermost ranges only.
  // Each byte: "static" | "dynamic" | undefined (wrapper).
  const coverage = new Array(totalBytes);
  for (const r of allRanges) {
    if (r.nested_in) continue; // inner ranges don't paint — their ancestor already did
    for (let i = r.start; i < r.end; i++) {
      // Painting precedence: first writer wins. Two outermost siblings
      // CAN'T overlap by definition of "strict containment exclusion",
      // but if they touch end-to-start the indices won't collide. If
      // by pathology they do (envelope rendering bug), we accept the
      // first-painted kind — the count stays consistent with total_bytes.
      if (coverage[i] === undefined) coverage[i] = r.kind;
    }
  }
  let staticBytes = 0, dynamicBytes = 0;
  for (let i = 0; i < totalBytes; i++) {
    if (coverage[i] === "static") staticBytes++;
    else if (coverage[i] === "dynamic") dynamicBytes++;
  }

  // Build the per-block report. Each occurrence is a distinct entry
  // (no per-tag-name merging) so consumers can see exactly which
  // occurrence contributed which byte span — critical for envelopes
  // with multiple appearances of the same tag.
  const blocksOut = allRanges.map((r) => ({
    tag: r.tag,
    kind: r.kind,
    bytes: r.bytes,
    nested_in: r.nested_in,
  }));
  blocksOut.sort((a, b) => b.bytes - a.bytes);
  const wrapperBytes = totalBytes - staticBytes - dynamicBytes;
  const round = (n) => Math.round(n * 1000) / 1000;
  for (const b of blocksOut) b.pct = round(b.bytes / totalBytes);
  return {
    agent,
    workflow_id: workflowId,
    total_bytes: totalBytes,
    summary: {
      static_bytes: staticBytes,
      static_pct: round(staticBytes / totalBytes),
      dynamic_bytes: dynamicBytes,
      dynamic_pct: round(dynamicBytes / totalBytes),
      wrapper_bytes: wrapperBytes,
      wrapper_pct: round(wrapperBytes / totalBytes),
    },
    blocks: blocksOut,
  };
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
        rendered = editSourceMarkerFor(region.agent, region.workflow_id) + "\n" +
                   renderEnvelope(region.agent, region.workflow_id, contracts);
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

// Surfaces .devt/state/dispatch-warnings.jsonl — the JSONL forensic log
// written by hooks/dispatch-hygiene-guard.sh on raw_dispatch incidents
// (a workflow envelope absent on Task(devt:* …)). JSONL shape per entry:
//   { ts, source, agent, prompt_bytes, prompt_preview }
function cmdWarnings(args) {
  const tracePath = path.join(process.cwd(), ".devt/state/dispatch-warnings.jsonl");
  let mode = "summary";
  let limit = null;
  let limitRaw = null;
  let sinceTs = null;
  let raw = false;
  let includeAll = false;  // --all opts back into the full series (incl. healthy task_output_bytes noise)
  for (const a of args) {
    if (a === "--by-source") mode = "by-source";
    else if (a === "--by-agent") mode = "by-agent";
    else if (a === "--raw") raw = true;
    else if (a === "--all") includeAll = true;
    else if (a.startsWith("--limit=")) {
      limitRaw = a.slice(8);
      limit = parseInt(limitRaw, 10);
    }
    else if (a.startsWith("--since=")) sinceTs = a.slice(8);
  }
  // Input validation. `--since=garbage` silently returned 0 results under
  // string comparison (any non-ISO prefix > "2026-..." alphabetically).
  // `--limit=-1` produced an empty-array slice. Both wrong-without-error.
  if (sinceTs && isNaN(Date.parse(sinceTs))) {
    throw new Error(`invalid --since value "${sinceTs}" (expected ISO date like 2026-06-01 or full timestamp)`);
  }
  if (limit !== null && (isNaN(limit) || limit < 1)) {
    throw new Error(`invalid --limit value "${limitRaw}" (expected positive integer ≥ 1)`);
  }
  if (!fs.existsSync(tracePath)) {
    return {
      exists: false,
      path: tracePath,
      message: "No dispatch-warnings.jsonl yet — no raw_dispatch incidents recorded in this project.",
    };
  }
  const text = fs.readFileSync(tracePath, "utf8");
  const lines = text.split("\n").filter(Boolean);
  const entries = [];
  let parseErrors = 0;
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); }
    catch { parseErrors++; }
  }
  let filtered = sinceTs ? entries.filter((e) => e.ts && e.ts >= sinceTs) : entries;
  // Default-filter healthy task_output_bytes noise.
  // Field signal: a field session emitted 246 task_output_bytes events,
  // 0 actionable (all signal:healthy) — drowning the actionable raw_dispatch
  // count in the summary view. The full series stays available for the
  // stuck-detector consumer at state.cjs:3000 (reads the file directly,
  // bypasses this CLI). Opt back into full series with --all.
  const filteredNoise = includeAll
    ? 0
    : filtered.reduce((n, e) => n + ((e.source === "task_output_bytes" && e.signal === "healthy") ? 1 : 0), 0);
  if (!includeAll) {
    filtered = filtered.filter((e) => !(e.source === "task_output_bytes" && e.signal === "healthy"));
  }
  // Surface filtered-noise count when non-zero so operators see how
  // much was hidden by the default filter. Spread keeps the field absent
  // when the count is 0 (avoids JSON noise on every call).
  const noiseField = filteredNoise > 0 ? { filtered_noise_count: filteredNoise, filter_hint: "pass --all to include task_output_bytes signal=healthy events" } : {};
  if (raw) {
    const slice = limit ? filtered.slice(-limit) : filtered;
    return { entries: slice, total: filtered.length, parse_errors: parseErrors, ...noiseField };
  }
  if (mode === "by-source") {
    const counts = {};
    for (const e of filtered) {
      const k = e.source || "unknown";
      counts[k] = (counts[k] || 0) + 1;
    }
    return { mode: "by-source", total: filtered.length, parse_errors: parseErrors, counts, ...noiseField };
  }
  if (mode === "by-agent") {
    const counts = {};
    for (const e of filtered) {
      const k = e.agent || "unknown";
      counts[k] = (counts[k] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { mode: "by-agent", total: filtered.length, parse_errors: parseErrors, counts: Object.fromEntries(sorted), ...noiseField };
  }
  const bySource = {};
  const byAgent = {};
  for (const e of filtered) {
    bySource[e.source || "unknown"] = (bySource[e.source || "unknown"] || 0) + 1;
    byAgent[e.agent || "unknown"] = (byAgent[e.agent || "unknown"] || 0) + 1;
  }
  const topAgents = Object.entries(byAgent).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recent = filtered.slice(-5).map((e) => ({
    ts: e.ts,
    source: e.source,
    agent: e.agent,
    prompt_preview: e.prompt_preview,
  }));
  return {
    total: filtered.length,
    parse_errors: parseErrors,
    span: {
      first: filtered.length ? filtered[0].ts : null,
      last: filtered.length ? filtered[filtered.length - 1].ts : null,
    },
    by_source: bySource,
    top_agents: Object.fromEntries(topAgents),
    recent,
    ...noiseField,
  };
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
    case "check-contracts": {
      const res = cmdCheckContracts();
      json(res);
      return res.ok ? 0 : 1;
    }
    case "warnings":
      try { json(cmdWarnings(args)); return 0; }
      catch (err) { process.stderr.write("dispatch warnings: " + err.message + "\n"); return 2; }
    case "render": {
      const out = cmdRender(args[0]);
      process.stdout.write(out + (out.endsWith("\n") ? "" : "\n"));
      return 0;
    }
    case "render-filled": {
      // Accept both colon-joined `<agent>:<workflow_id|auto>` (canonical) and
      // space-separated `<agent> <workflow_id|auto>` (more intuitive for typed
      // CLI use). Colon-only is non-obvious; users naturally try
      // space-separated first. Both forms render the same envelope.
      const positional = args.filter(a => !a.startsWith("--"));
      let target = positional[0];
      if (target && !target.includes(":") && positional[1]) {
        target = positional[0] + ":" + positional[1];
      }
      // --rules-exclude=<comma-separated heading list>: opt-in section strip
      // from governing_rules.content. Matches by exact `## Heading` title.
      // Config-driven auto-wire. Reads
      // `.devt/config.json::rules.exclude_sections: []` and merges with the
      // CLI flag list (dedupe). Project-level config makes the per-dispatch
      // saving accrue automatically without per-call plumbing — important
      // because an unadvertised CLI flag rarely gets used in practice.
      const excludeArg = args.find(a => a.startsWith("--rules-exclude="));
      const flagList = excludeArg
        ? excludeArg.slice("--rules-exclude=".length).split(",").map(s => s.trim()).filter(Boolean)
        : [];
      const rulesExclude = _mergeConfigRulesExclude(flagList);
      // --notes-file=<path>: free-text orchestrator directives injected as an
      // <orchestrator_notes> context block. The consolidator envelope is the
      // primary consumer (cross-lane reconciliation directives, validation
      // notes, hand-included-lane annotations) — the static template has no
      // slot for run-specific judgment, which is why it got hand-rolled in
      // the field. Generic: works for any render-filled target.
      const notesArg = args.find(a => a.startsWith("--notes-file="));
      const notesFile = notesArg ? notesArg.slice("--notes-file=".length) : undefined;
      let out;
      try { out = cmdRenderFilled(target, { rulesExclude, notesFile }); }
      catch (err) {
        process.stderr.write(err.message + "\n");
        return 2;
      }
      process.stdout.write(out + (out.endsWith("\n") ? "" : "\n"));
      return 0;
    }
    case "run": {
      // Generic devt-agent launcher: render canonical envelope + substitute
      // task text, emit paste-ready Task() block. Closes the bypass
      // justification for cases where no /devt:* slash command matches the
      // intended agent dispatch (e.g., devt:tester for a one-shot rewrite
      // that has no matching skill). The operator copies the output verbatim
      // into a Task() call; the envelope satisfies the workflow contract
      // (dispatch-hygiene-guard passes; all context blocks present).
      //
      // Args: <agent> --task="..."   OR   <agent>:<workflow_id|auto> --task="..."
      const positional = args.filter(a => !a.startsWith("--"));
      const agentArg = positional[0];
      if (!agentArg) {
        process.stderr.write("Usage: dispatch run <agent>[:auto] --task=\"...\"\n");
        return 2;
      }
      const target = agentArg.includes(":") ? agentArg : agentArg + ":auto";

      const taskFlag = args.find(a => a.startsWith("--task="));
      if (!taskFlag) {
        process.stderr.write("dispatch run: --task=\"...\" required (the task text to inject into the envelope's <task> block)\n");
        return 2;
      }
      const taskText = taskFlag.slice("--task=".length);
      if (!taskText.trim()) {
        process.stderr.write("dispatch run: --task= cannot be empty\n");
        return 2;
      }

      const excludeArg = args.find(a => a.startsWith("--rules-exclude="));
      const flagList = excludeArg
        ? excludeArg.slice("--rules-exclude=".length).split(",").map(s => s.trim()).filter(Boolean)
        : [];
      const rulesExclude = _mergeConfigRulesExclude(flagList);

      let envelope;
      try { envelope = cmdRenderFilled(target, { rulesExclude }); }
      catch (err) {
        process.stderr.write(err.message + "\n");
        return 2;
      }

      // Substitute the rendered <task>...</task> block content with the
      // user-provided task text. Match across newlines (template tasks span
      // multiple lines). When the template has no <task> block (uncommon
      // for investigative agents but possible for docs-writer / curator),
      // fall through and emit the envelope as-is with a stderr advisory so
      // the user knows the --task content wasn't injected.
      const taskBlockRe = /<task>[\s\S]*?<\/task>/;
      if (taskBlockRe.test(envelope)) {
        envelope = envelope.replace(taskBlockRe, "<task>\n" + taskText + "\n</task>");
      } else {
        process.stderr.write("dispatch run: warning — template for " + agentArg + " has no <task> block; --task content not injected. Envelope emitted as-is.\n");
      }

      process.stdout.write(envelope + (envelope.endsWith("\n") ? "" : "\n"));
      return 0;
    }
    case "compile": {
      const mode = args.includes("--write") ? "write" : "check";
      const result = cmdCompile(mode);
      json(result);
      return mode === "check" && result.drift.length > 0 ? 1 : 0;
    }
    case "decompose": {
      // Same arg semantics as render-filled — accepts colon-joined OR
      // space-separated `<agent> <workflow_id|auto>`.
      let target = args[0];
      if (target && !target.includes(":") && args[1]) {
        target = args[0] + ":" + args[1];
      }
      try { json(cmdDecompose(target)); return 0; }
      catch (err) { process.stderr.write(err.message + "\n"); return 2; }
    }
    case "render-lanes": {
      // Render per-lane envelopes for every lane registered in
      // workflow.yaml::lanes[]. Default target is code-reviewer:code_review
      // — the canonical per-file review template that already carries the
      // self-grade directive in its task body. Hand-rolled raw-dispatch
      // task text consistently omits the self-grade directive, so emitting
      // envelopes from the canonical template by default makes the bypass
      // structurally impossible.
      //
      // Args: [target] [--target=agent:workflow] [--out=dir] [--inline-rules]
      const positional = args.filter(a => !a.startsWith("--"));
      const targetFlag = args.find(a => a.startsWith("--target="));
      let target = targetFlag
        ? targetFlag.slice("--target=".length)
        : (positional[0] && positional[0].includes(":") ? positional[0] : "code-reviewer:code_review");
      const outFlag = args.find(a => a.startsWith("--out="));
      const outDir = outFlag ? outFlag.slice("--out=".length) : null;
      const inlineRules = args.includes("--inline-rules");
      try {
        const result = cmdRenderLanes(target, { outDir, inlineRules });
        if (result.lane_count === 0) {
          // Don't silently exit non-zero — tell the operator why and how to
          // proceed. Round 9 #4 fix; previously empty stdout + exit 2 made
          // the failure mode indistinguishable from a render bug.
          process.stderr.write(
            `dispatch render-lanes: ${result.reason || "no lanes available"}\n` +
            `Run 'state register-lane --id=L1 --scope=<X> --files=a.py,b.py' for one lane,\n` +
            `or 'state register-lanes --from=<lanes.yaml|.json>' for bulk.\n`,
          );
          return 2;
        }
        if (outDir) {
          json(result);
        } else {
          process.stdout.write(result.text + (result.text.endsWith("\n") ? "" : "\n"));
        }
        return 0;
      } catch (err) {
        process.stderr.write(err.message + "\n");
        return 2;
      }
    }
    case "run-lanes": {
      // M3 (cal #30.5) — ergonomic launcher for canonical-path parallel
      // lane dispatch. Bundles register-lanes (from --partition) + render-lanes
      // + directive injection (per-lane focus + global task suffix + diff
      // base) into one CLI call. Per [[feedback_canonical_path_expressiveness]]:
      // without these directive shapes, operators hand-roll the dispatch
      // because the canonical path can't carry custom directives, and devt's
      // hygiene gates miss legitimate fan-outs as raw_dispatch.
      //
      // Args: [target] [--target=agent:workflow] [--partition=<file>]
      //       [--lane-N-focus=<text>]... [--base=<ref>] [--task-suffix=<file>]
      //       [--out=<dir>]
      const flag = (name) => {
        const a = args.find(x => x.startsWith(`--${name}=`));
        return a ? a.slice(name.length + 3) : null;
      };
      const positional = args.filter(a => !a.startsWith("--"));
      const target = flag("target")
        || (positional[0] && positional[0].includes(":") ? positional[0] : "code-reviewer:code_review");
      const partitionPath = flag("partition");
      const suffixPath = flag("task-suffix");
      const outDir = flag("out");
      // --lane-<id>-focus=<text> — parse all occurrences. The <id> segment
      // matches the lane id registered in workflow.yaml::lanes[].id.
      const focusByLane = new Map();
      for (const a of args) {
        const m = a.match(/^--lane-([\w-]+)-focus=(.*)$/);
        if (m) focusByLane.set(m[1], m[2]);
      }

      // Register lanes from --partition file (if provided) BEFORE rendering.
      // File format: same YAML/JSON shape as `state register-lanes --from`.
      if (partitionPath) {
        try {
          const stateMod = require("./state.cjs");
          const r = stateMod.registerLanesFromYaml(partitionPath);
          if (r && r.errors && r.errors.length > 0) {
            process.stderr.write(`dispatch run-lanes: partition file errors: ${r.errors.join("; ")}\n`);
            return 2;
          }
        } catch (e) {
          process.stderr.write(`dispatch run-lanes: --partition load failed: ${e.message}\n`);
          return 2;
        }
      }

      // Diff base resolution: --base flag > .devt/config.json::git.primary_branch
      // (auto-detected by setup.cjs) > $PRIMARY_BRANCH env > "main". Matches
      // preflight.cjs::L284 source ordering — operators who configured
      // primary_branch="development" via setup get that value automatically
      // instead of the env fallback silently shadowing the config.
      const baseOverride = flag("base");
      let diffBase = baseOverride;
      if (!diffBase) {
        try {
          const { getMergedConfig } = require("./config.cjs");
          const cfg = getMergedConfig();
          if (cfg && cfg.git && typeof cfg.git.primary_branch === "string" && cfg.git.primary_branch) {
            diffBase = cfg.git.primary_branch;
          }
        } catch { /* config read failure non-fatal — fall through */ }
      }
      if (!diffBase) diffBase = process.env.PRIMARY_BRANCH || "main";

      // --task-suffix=<file> — read file content for global injection.
      let taskSuffix = "";
      if (suffixPath) {
        try {
          taskSuffix = require("fs").readFileSync(suffixPath, "utf8").trim();
        } catch (e) {
          process.stderr.write(`dispatch run-lanes: --task-suffix load failed: ${e.message}\n`);
          return 2;
        }
      }

      try {
        const result = cmdRenderLanes(target, { outDir, focusByLane, taskSuffix, diffBase });
        if (result.lane_count === 0) {
          process.stderr.write(
            `dispatch run-lanes: ${result.reason || "no lanes available"}\n` +
            `Provide --partition=<lanes.yaml|.json> to register lanes first,\n` +
            `or run 'state register-lane --id=L1 --scope=<X> --files=a.py,b.py' beforehand.\n`,
          );
          return 2;
        }
        if (outDir) {
          json(result);
        } else {
          process.stdout.write(result.text + (result.text.endsWith("\n") ? "" : "\n"));
        }
        return 0;
      } catch (err) {
        process.stderr.write(err.message + "\n");
        return 2;
      }
    }
    default:
      process.stderr.write("Usage: dispatch <list|contracts|check-contracts|render|render-filled|render-lanes|run-lanes|run|compile|decompose|warnings>\n");
      return 2;
  }
}

// Render per-lane envelopes for every lane registered in workflow.yaml::lanes[].
// Each lane gets the canonical template body (with the self-grade directive
// baked in) plus injected <lane_id>, <lane_community>, <lane_files> blocks
// and a lane-specific output path override. When outDir is set, writes one
// file per lane and returns a JSON summary; otherwise returns concatenated
// text with <!-- LANE: <id> --> separators.
// Merge config-level `rules.exclude_sections`
// with the CLI flag list. Returns deduped array. Empty when neither source
// has entries. Safe on missing config / missing nested key — returns the flag
// list unchanged.
function _mergeConfigRulesExclude(flagList) {
  let configList = [];
  try {
    const { getMergedConfig } = require("./config.cjs");
    const cfg = getMergedConfig();
    if (cfg && cfg.rules && Array.isArray(cfg.rules.exclude_sections)) {
      configList = cfg.rules.exclude_sections.filter(s => typeof s === "string" && s.trim()).map(s => s.trim());
    }
  } catch { /* config read failure — fall back to flag-only list */ }
  if (configList.length === 0) return flagList;
  if (flagList.length === 0) return configList;
  return Array.from(new Set([...configList, ...flagList]));
}

// Read preflight-brief.json::auto_memory and return a compact top-N
// "name (type, score)" comma-joined summary suitable for an envelope tag.
// Returns null when the brief is absent OR has no auto_memory entries.
// Bounded length (top N entries, descriptions truncated) keeps the lane
// envelope under the dispatch hygiene matcher's content budget.
function _laneAutoMemorySummary(topN) {
  try {
    const fsLocal = require("fs");
    const pathLocal = require("path");
    const { findProjectRoot } = require("./config.cjs");
    const briefPath = pathLocal.join(findProjectRoot(), ".devt", "state", "preflight-brief.json");
    if (!fsLocal.existsSync(briefPath)) return null;
    const brief = JSON.parse(fsLocal.readFileSync(briefPath, "utf8"));
    const entries = Array.isArray(brief.auto_memory) ? brief.auto_memory : [];
    if (entries.length === 0) return null;
    const cap = Math.max(1, topN || 3);
    return entries.slice(0, cap)
      .map(e => `${e.name || "(unnamed)"} (${e.type || "?"}, score=${e.score || 0})`)
      .join("; ");
  } catch { return null; }
}

function cmdRenderLanes(target, options) {
  options = options || {};
  const stateMod = require("./state.cjs");
  const fsLocal = require("fs");
  const pathLocal = require("path");
  const { lanes } = stateMod.listLaneOutputs();
  if (!lanes || lanes.length === 0) {
    return { lane_count: 0, text: "", lanes: [], reason: "no lanes registered in workflow.yaml::lanes[]" };
  }
  // Per-lane correlation_id for dispatch-hygiene matcher. Stamped into each
  // envelope as <correlation_id>cid_<workflow_id_prefix>_<lane_id></correlation_id>
  // and recognized by hooks/dispatch-hygiene-guard.sh, so registered-lane
  // dispatches don't get flagged as raw_dispatch even when the operator
  // customizes other envelope content. Field-evidenced gap: the matcher
  // previously only recognized full envelope-tag preservation (<scope_trust>,
  // <context>, etc.); operators customizing prose lost hygiene credit.
  const currentState = stateMod.readState();
  const workflowId = currentState.workflow_id || "noworkflow";
  const workflowIdPrefix = String(workflowId).split("-")[0];
  // Pass config-merged rules-exclude through to the base envelope.
  // Per-lane envelopes inherit the same rules.exclude_sections — the project-
  // wide cut applies uniformly across all lanes (no per-lane override needed
  // since lanes are scope-partitioned, not rules-partitioned).
  const baseRulesExclude = _mergeConfigRulesExclude(options.rulesExclude || []);
  // Lanes default to rules-by-reference: the governing_rules body is
  // byte-identical across all N lanes, so inlining it multiplies the single
  // largest static block per lane (field-measured: ~57KB × 5 lanes ≈ 73% of
  // a 391KB render). Lane agents run in the same working tree as the
  // orchestrator, so read-from-disk is safe; --inline-rules restores full
  // inlining for worktree-isolated dispatches.
  // Lanes default to rules-by-reference AND rubric-by-reference for the same
  // reason: both bodies are byte-identical across all N lanes. --inline-rules
  // restores full inlining of both for worktree-isolated dispatches.
  const rulesByReference = !options.inlineRules;
  // Render base envelope once (substitution is identical across lanes — the
  // per-lane variation is injected on top, not re-substituted).
  const base = cmdRenderFilled(target, {
    ...(baseRulesExclude.length ? { rulesExclude: baseRulesExclude } : {}),
    ...(rulesByReference ? { rulesByReference: true, rubricByReference: true } : {}),
  });
  const stateDir = pathLocal.join(process.cwd(), ".devt", "state");
  const sidecarDir = pathLocal.join(stateDir, "lane-files");
  const out = [];
  const summary = [];
  for (const lane of lanes) {
    let files = [];
    let community = lane.community || "";
    try {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const sidecarPath = pathLocal.join(sidecarDir, `${lane.id}.json`);
      if (fsLocal.existsSync(sidecarPath)) {
        const data = JSON.parse(fsLocal.readFileSync(sidecarPath, "utf8"));
        files = Array.isArray(data.files) ? data.files : [];
        if (data.community) community = data.community;
      }
    } catch { /* sidecar missing or malformed — emit envelope without files block */ }
    const correlationId = `cid_${workflowIdPrefix}_${lane.id}`;
    // Compact auto_memory summary injected per-lane (cal #36 #5 from
    // receipt #9). The full auto_memory_json is already substituted via
    // cmdRenderFilled in the base envelope (cal #32 Rank #2), but lanes
    // produced via the hand-rolled register-lanes shortcut may discard
    // base-envelope placeholders. Surfacing a top-N name+score summary in
    // the lane-context block guarantees the bridge's output reaches each
    // lane regardless of how operators customize the prose. Falls back
    // to empty string when laneH found no matches.
    const autoMemorySummary = _laneAutoMemorySummary(3);
    // Axis E pre-compute (field receipt: five lanes produced four different
    // epistemologies for the same skip, including one false "CLI not present"
    // claim). The orchestrator owns the memory layer — affects is deterministic
    // and cheap, so every lane receives the SAME mechanical answer; [] means
    // axis E is a verified skip, not an improvised one.
    let memoryAffects = "[]";
    try {
      const mem = require("./memory.cjs");
      const hits = [];
      for (const f of files) {
        const matches = mem.getByPath(f) || [];
        for (const m of matches.slice(0, 5)) hits.push({ file: f, id: m.id || m.doc_id || "", title: m.title || "" });
        if (hits.length >= 10) break;
      }
      memoryAffects = JSON.stringify(hits.slice(0, 10));
    } catch { /* memory layer unavailable — [] is the honest answer */ }
    const blockLines = [
      `    <lane_id>${lane.id}</lane_id>`,
      `    <lane_community>${community}</lane_community>`,
      `    <correlation_id>${correlationId}</correlation_id>`,
      `    <lane_files>\n${files.map(f => `      ${f}`).join("\n")}\n    </lane_files>`,
      `    <memory_affects>${memoryAffects}</memory_affects>`,
    ];
    if (autoMemorySummary) {
      blockLines.push(`    <auto_memory>${autoMemorySummary}</auto_memory>`);
    }
    // Diff-first review method. Field-proven pattern: the per-lane diff
    // artifact is what let lanes over huge whole-file footprints land within
    // budget — the lane reads the diff as THE change under review and opens
    // full files only for context around changed hunks. size_class=chunked/
    // split additionally gets the hunk-enumeration read strategy (proven at
    // ~8000 diff lines; without it a large diff gets one shallow pass).
    if (lane.diff_artifact) {
      blockLines.push(`    <lane_diff>${lane.diff_artifact}</lane_diff>`);
      let method = `Read ${lane.diff_artifact} FIRST — that diff IS the change under review for this lane (merge-base diff: committed + working tree + untracked). Read full files only to verify context around changed hunks and cascade effects.`;
      if (lane.size_class === "chunked" || lane.size_class === "split") {
        method += ` The diff is large (${lane.est_loc} lines): enumerate per-file hunks first (Grep '^diff --git' against the diff file), then read it file-by-file in priority order rather than one pass.`;
      }
      blockLines.push(`    <lane_method>${method}</lane_method>`);
    }
    // M3 (cal #30.5) — optional directive blocks. Per
    // [[feedback_canonical_path_expressiveness]]: operators hand-roll when
    // canonical paths can't carry custom directives. These blocks let
    // `dispatch run-lanes` inject per-lane focus + global task suffix + diff
    // base WITHOUT requiring the operator to rewrite envelope prose.
    const directives = [
      ["lane_focus", options.focusByLane && options.focusByLane.get && options.focusByLane.get(lane.id)],
      ["task_suffix", options.taskSuffix],
      ["diff_base", options.diffBase],
    ];
    for (const [tag, val] of directives) {
      if (typeof val === "string" && val.length > 0) blockLines.push(`    <${tag}>${val}</${tag}>`);
    }
    const laneBlocks = blockLines.join("\n");
    // Inject lane context blocks right before the closing </context> tag.
    let injected = base.replace(/(\n\s*<\/context>)/, "\n" + laneBlocks + "$1");
    // Override the canonical "Write review to .devt/state/review.md" trailer
    // so each lane writes to its own review_file. Without this, all lanes
    // would clobber the same path.
    if (lane.review_file) {
      injected = injected.replace(
        /Write review to \.devt\/state\/review\.md/g,
        `Write review to ${lane.review_file}`,
      );
    }
    if (options.outDir) {
      if (!fsLocal.existsSync(options.outDir)) fsLocal.mkdirSync(options.outDir, { recursive: true });
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
      const outPath = pathLocal.join(options.outDir, `lane-${lane.id}.txt`);
      fsLocal.writeFileSync(outPath, injected + (injected.endsWith("\n") ? "" : "\n"));
      summary.push({ id: lane.id, community, correlation_id: correlationId, files: files.length, path: outPath, bytes: injected.length });
    } else {
      out.push(`<!-- LANE: ${lane.id} (community=${community}, correlation_id=${correlationId}, files=${files.length}) -->`);
      out.push(injected);
      out.push("");
    }
  }
  const result = {
    lane_count: lanes.length,
    text: out.join("\n"),
    lanes: summary,
    target,
    // Reduction is never silent: the modes name what was withheld per lane
    // so a size comparison across runs is attributable to the right lever.
    rules_mode: rulesByReference ? "by-reference" : "inline",
    rubric_mode: rulesByReference ? "by-reference" : "inline",
  };
  // Disk preflight (cal #38.C, pre-fan-out surface) — warn-only. This is the
  // moment right before N lane transcripts start accumulating, the exact spot
  // a field run hit ENOSPC mid-lane. Surface a low-disk signal so the
  // operator can free space before fanning out; never blocks the dispatch.
  try {
    const _disk = require("./state.cjs").diskCheck();
    if (_disk && _disk.status === "warn" && _disk.message) result.disk_warning = _disk.message;
  } catch { /* disk probe best-effort */ }
  return result;
}

module.exports = { run, parseIoContracts, listMarkerRegions, cmdRenderFilled, cmdRenderLanes, cmdDecompose, cmdWarnings };
