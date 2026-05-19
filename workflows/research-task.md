# Research Task

Investigate implementation approaches before planning or coding.

<purpose>
Research the best approach for a task by scanning the codebase, identifying patterns,
and producing a prescriptive recommendation. This step prevents wrong approaches
and surfaces pitfalls before any code is written.
</purpose>

<prerequisites>
- `.devt/rules/` directory exists with coding-standards.md, architecture.md
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
</prerequisites>

<available_agent_types>

- devt:researcher — technical investigation specialist, READ-ONLY (Read, Bash, Glob, Grep)
  </available_agent_types>

<agent_skill_injection>
Before dispatching the researcher agent, read `resolved_skills.researcher` from the compound `init` output. Pre-resolved by `init.cjs::resolveSkills` — `.devt/config.json::agent_skills.researcher` overrides; default falls back to skill-index.yaml (`codebase-scan`, `strategic-analysis`).
</agent_skill_injection>

<process>

<step name="init" gate="project context loaded">
## Step 1: Initialize

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=research phase=context_init status=IN_PROGRESS stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null "task=${TASK_DESCRIPTION}"
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "${TASK_DESCRIPTION}"
SCOPE_HINT=$(jq -c '.suggested_reading // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
SCOPE_TRUST=$(jq -c '{trust: (.graph_stats.trust // "empty"), lag_commits: .staleness.lag_commits, fresh: (.staleness.fresh // false)}' .devt/state/preflight-brief.json 2>/dev/null || echo '{}')
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update scope_hint_json="${SCOPE_HINT}" scope_trust_json="${SCOPE_TRUST}"
```

**Staleness gate** — If `preflight-brief.json::staleness.lag_commits > graphify.stale_threshold` (default 30; `null` disables), prompt the user via AskUserQuestion BEFORE the researcher dispatch: "Graphify graph is {lag_commits} commits behind HEAD; codebase patterns may be stale. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed. Skip when graphify disabled or lag_commits is null.

The third call auto-fires the **Topic Pre-Flight Brief** — researcher reads it FIRST so investigation builds on existing governance instead of re-discovering it. REJ tombstones in the Brief act as "we already evaluated and rejected this" markers — researcher cites them in research.md when relevant approaches are out of scope.

The fourth call caches `scope_hint_json` for the researcher dispatch — paths derived from governing docs' `affects_paths` plus blast-radius `direct_dependents`, capped at 8.

Read .devt/rules/ for project conventions.
Read CLAUDE.md if it exists.
Read .devt/state/decisions.md if it exists (from /devt:clarify).
Read `${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` — when researcher findings are inconclusive or contested enough to warrant offering `/devt:council` as a resolution path (threshold in §1; template in §2; capture in §3.2 — caller is `/devt:research`).
</step>

<step name="scope_check" gate="research scope determined">
## Step 2: Scope Check

Is research actually needed?

- **Known pattern** (simple CRUD, config change, well-documented feature): Skip research. Tell user: "This is a well-known pattern. Proceed directly with /devt:plan or /devt:implement."
- **Unfamiliar domain** (new integration, complex algorithm, multiple approaches): Proceed with research.
- **Multiple valid approaches** (architecture decision needed): Proceed with research.

If skipping, report why and suggest next command. Do NOT dispatch the researcher for trivial tasks.
</step>

<step name="research" gate="research.md is written to .devt/state/">
## Step 3: Dispatch Researcher

Task(subagent_type="devt:researcher", model="{models.researcher}", prompt="
<context>
<!-- KEEP IN SYNC: this <governing_rules> block is duplicated across the
     researcher, code-reviewer, and verifier dispatch templates in
     workflows/{dev-workflow,quick-implement,code-review,research-task}.md.
     When one changes, update the others. governing_rules comes from the
     init payload; omit this block entirely when content is empty (agent
     falls back to on-disk Reads of CLAUDE.md + .devt/rules/*.md). -->
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
  <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
  <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
  <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
</governing_rules>
<scope_hint>{scope_hint_json}</scope_hint>
<scope_trust>{scope_trust_json}</scope_trust>
<spec>Read .devt/state/spec.md (if exists — from /devt:specify)</spec>
<decisions>Read .devt/state/decisions.md (if exists)</decisions>
<template>${CLAUDE_PLUGIN_ROOT}/templates/research-template.md</template>
<agent_skills>{injected from .devt/config.json if available}</agent_skills>
</context>
<task>
Research implementation approaches for: {task_description}
Investigate the codebase for existing patterns, recommend an approach, identify pitfalls.

Graphify-first discovery protocol (when `<scope_trust>.trust` is `dense` or `sparse`):
Use `mcp__devt-graphify__*` PROACTIVELY as your primary discovery mechanism, not as a fallback:
  1. `mcp__devt-graphify__query_graph({text: "<topic>"})` to anchor existing symbols in the area.
  2. `mcp__devt-graphify__god_nodes({limit: 20})` to identify the abstractions a new feature would touch.
  3. `mcp__devt-graphify__get_neighbors` on candidate anchor points — establishes which patterns the area already uses.
Use `Grep`/`Read` to VALIDATE graph findings against actual implementation (semantics, comments),
NOT to enumerate symbols from scratch. Grep on a graph-indexed project re-discovers what the AST extractor already knows. Research that ignores the graph produces "patterns" that only describe what was easy to grep for. Empty/degraded responses (`{degraded: true}`) signal fall back to grep; proceed normally for that query. When `<scope_trust>.trust` is `empty`, skip the protocol.
</task>
Write findings to .devt/state/research.md
")

Gate: Read .devt/state/research.md and check status:

- DONE: proceed to present
- NEEDS_CONTEXT: ask user for clarification, re-dispatch
- DONE_WITH_CONCERNS: proceed but flag concerns
  </step>

<step name="present" gate="user has seen findings">
## Step 4: Present Findings

Show the user:

- **Summary**: recommended approach (2-3 sentences)
- **Key finding**: most important pattern/pitfall discovered
- **Open questions**: anything that needs user decision

If open questions exist, ask the user via AskUserQuestion.

**Council offramp**: When the researcher returned `DONE_WITH_CONCERNS`, OR an open question trips the threshold in `${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` §1, use the offramp template from §2 — include the "Run /devt:council" option in the AskUserQuestion list. Council is especially valuable here because the researcher already laid the factual groundwork the advisors need, and `.devt/state/research.md` becomes the primary anchor for the council's `validation_material`. Soft cap: at most 1 council invocation per `/devt:research` session.

When the user picks the council option, follow `${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` §3 to invoke and resume. After the council returns, capture the verdict per §3.2 (research caller appends a `## Council Verdict on {decision}` section to `.devt/state/research.md`).

Append answers (and the council verdict link, if applicable) to .devt/state/research.md.
</step>

<step name="next">
## Step 5: Suggest Next Step

Based on research completeness:

- If approach is clear: "Research complete. Run /devt:plan to create an implementation plan, or /devt:workflow to start implementing."
- If concerns flagged: "Research has concerns. Review .devt/state/research.md before proceeding."
- If user provided answers to open questions: update research.md and suggest proceeding.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=false phase=complete status=DONE
```
</step>

</process>

<deviation_rules>
1. **STOP: scope creep** — If the research reveals the task is actually multiple independent tasks, report this to the user and suggest decomposition. Do not try to research everything.
2. **STOP: insufficient codebase** — If the codebase doesn't have enough context to make a recommendation (e.g., greenfield with no existing patterns), say so explicitly rather than guessing.
3. **Auto-fix: blocked researcher** — If the researcher agent returns BLOCKED or NEEDS_CONTEXT, provide the missing context from .devt/rules/ or CLAUDE.md and retry once. If still blocked, escalate to user.
4. **STOP: research inconclusive** — If no clear recommendation emerges after scanning, present the trade-offs honestly rather than forcing a pick. Use the council offramp (`${CLAUDE_PLUGIN_ROOT}/references/council-offramp.md` §2) to give the user a structured resolution path beyond binary "pick A or B" — council is especially valuable here because the researcher already laid the factual groundwork the advisors need to ground their reasoning.
</deviation_rules>

<success_criteria>

- .devt/state/research.md exists with recommended approach
- All open questions resolved (or explicitly deferred)
- User has reviewed summary
  </success_criteria>

## Memory layer integration

Researcher consults `.devt/memory/concepts/` and `.devt/memory/decisions/` BEFORE recommending
an approach — `node bin/devt-tools.cjs memory query <topic>` and `memory affects <relevant-path>`
surface governing rules. Recommendations matching active REJ tombstones are pre-filtered. When
research findings stabilize into a reusable Concept ("here's the auth domain model"), the
researcher tags `#KNOWLEDGE-CANDIDATE: [type=concept] <summary>` for curator promotion.
research.md's `links:` field is now populated with related ADR/CON IDs.
