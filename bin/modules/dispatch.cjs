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

  // --rules-exclude=<list>: opt-in CLAUDE.md (and other governing_rules.content
  // entries) section strip by exact `## Heading` match. Field signal
  // (greenfield calibration thread Q6): 3 sections were cited 0 times across
  // both L1 and L6 lane reviews — ~15-20% of CLAUDE.md per dispatch. Per-
  // dispatch opt-in keeps project portability open; promote to config after
  // field evidence accumulates.
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
  return out;
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
  "governing_rules", "inline_rubrics", "rubric_content", "inline_guardrails",
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
  // Fix (greenfield audit 2026-06-10): dedupe by NESTING. A tag's bytes
  // are counted toward the outermost containing tag; inner tags appear
  // in blocks[] for visibility (nested_in field) but their bytes are
  // attributed only to the outermost ancestor in the summary totals.
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
  let includeAll = false;  // R10-6: --all opts back into the full series (incl. healthy task_output_bytes noise)
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
  // R10-6 (cal #24 round 10): default-filter healthy task_output_bytes noise.
  // Field signal: greenfield session emitted 246 task_output_bytes events,
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
  // R10-6: surface filtered-noise count when non-zero so operators see how
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
      // CLI use). cal #19 §7 F3: colon-only is non-obvious; users naturally
      // try space-separated first. Both forms render the same envelope.
      const positional = args.filter(a => !a.startsWith("--"));
      let target = positional[0];
      if (target && !target.includes(":") && positional[1]) {
        target = positional[0] + ":" + positional[1];
      }
      // --rules-exclude=<comma-separated heading list>: opt-in section strip
      // from governing_rules.content. Matches by exact `## Heading` title.
      // R11-4 (cal #24 round 10 follow-up): config-driven auto-wire. Reads
      // `.devt/config.json::rules.exclude_sections: []` and merges with the
      // CLI flag list (dedupe). Field signal: greenfield never used the flag
      // because it was unadvertised; project-level config makes the 18.1KB/
      // dispatch saving accrue automatically without per-call plumbing.
      const excludeArg = args.find(a => a.startsWith("--rules-exclude="));
      const flagList = excludeArg
        ? excludeArg.slice("--rules-exclude=".length).split(",").map(s => s.trim()).filter(Boolean)
        : [];
      const rulesExclude = _mergeConfigRulesExclude(flagList);
      let out;
      try { out = cmdRenderFilled(target, { rulesExclude }); }
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
      // C7-7 self-grade directive in its task body. Greenfield calibration
      // thread Q12 receipts: hand-rolled raw-dispatch task text consistently
      // omits C7-7, so emitting envelopes from the canonical template by
      // default makes the bypass structurally impossible.
      //
      // Args: [target] [--target=agent:workflow] [--out=dir]
      const positional = args.filter(a => !a.startsWith("--"));
      const targetFlag = args.find(a => a.startsWith("--target="));
      let target = targetFlag
        ? targetFlag.slice("--target=".length)
        : (positional[0] && positional[0].includes(":") ? positional[0] : "code-reviewer:code_review");
      const outFlag = args.find(a => a.startsWith("--out="));
      const outDir = outFlag ? outFlag.slice("--out=".length) : null;
      try {
        const result = cmdRenderLanes(target, { outDir });
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
    default:
      process.stderr.write("Usage: dispatch <list|contracts|render|render-filled|render-lanes|compile|decompose|warnings>\n");
      return 2;
  }
}

// Render per-lane envelopes for every lane registered in workflow.yaml::lanes[].
// Each lane gets the canonical template body (with C7-7 directive baked in)
// plus injected <lane_id>, <lane_community>, <lane_files> blocks and a lane-
// specific output path override. When outDir is set, writes one file per
// lane and returns a JSON summary; otherwise returns concatenated text with
// <!-- LANE: <id> --> separators.
// R11-4 (cal #24 round 10 follow-up): merge config-level `rules.exclude_sections`
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

function cmdRenderLanes(target, options) {
  options = options || {};
  const stateMod = require("./state.cjs");
  const fsLocal = require("fs");
  const pathLocal = require("path");
  const { lanes } = stateMod.listLaneOutputs();
  if (!lanes || lanes.length === 0) {
    return { lane_count: 0, text: "", lanes: [], reason: "no lanes registered in workflow.yaml::lanes[]" };
  }
  // R11-4: pass config-merged rules-exclude through to the base envelope.
  // Per-lane envelopes inherit the same rules.exclude_sections — the project-
  // wide cut applies uniformly across all lanes (no per-lane override needed
  // since lanes are scope-partitioned, not rules-partitioned).
  const baseRulesExclude = _mergeConfigRulesExclude(options.rulesExclude || []);
  // Render base envelope once (substitution is identical across lanes — the
  // per-lane variation is injected on top, not re-substituted).
  const base = cmdRenderFilled(target, baseRulesExclude.length ? { rulesExclude: baseRulesExclude } : undefined);
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
    const laneBlocks = [
      `    <lane_id>${lane.id}</lane_id>`,
      `    <lane_community>${community}</lane_community>`,
      `    <lane_files>\n${files.map(f => `      ${f}`).join("\n")}\n    </lane_files>`,
    ].join("\n");
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
      summary.push({ id: lane.id, community, files: files.length, path: outPath, bytes: injected.length });
    } else {
      out.push(`<!-- LANE: ${lane.id} (community=${community}, files=${files.length}) -->`);
      out.push(injected);
      out.push("");
    }
  }
  return {
    lane_count: lanes.length,
    text: out.join("\n"),
    lanes: summary,
    target,
  };
}

module.exports = { run, parseIoContracts, listMarkerRegions, cmdRenderFilled, cmdRenderLanes, cmdDecompose, cmdWarnings };
