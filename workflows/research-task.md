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
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state evict-graphify
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" preflight generate "${TASK_DESCRIPTION}"
PFRESH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-preflight-fresh)
if [ "$(echo "$PFRESH" | jq -r '.ok')" != "true" ]; then
  echo "BLOCKED: preflight-brief is stale — $(echo "$PFRESH" | jq -r '.reason')"
  exit 1
fi
SCOPE_HINT=$(jq -c '.suggested_reading // []' .devt/state/preflight-brief.json 2>/dev/null || echo '[]')
SCOPE_TRUST=$(jq -c '{trust: (.graph_stats.trust // "empty"), lag_commits: .staleness.lag_commits, fresh: (.staleness.fresh // false)}' .devt/state/preflight-brief.json 2>/dev/null || echo '{}')

# Mechanical staleness override — force scope_trust.trust='sparse' + write a suppression artifact when
# graph_stats.state=ready AND (lag_commits is null OR exceeds threshold). Bash-mechanical because the
# prior prose-only spec ("In autonomous mode, force sparse") was found violated in field validation:
# the orchestrator wrote scope_trust before the prose, then never re-wrote.
GRAPHIFY_STATE=$(jq -r '.graph_stats.state // "not_ready"' .devt/state/preflight-brief.json 2>/dev/null || echo "not_ready")
STALE_THRESHOLD=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" config get graphify.stale_threshold 2>/dev/null | jq -r '.value // 30')
LAG=$(echo "$SCOPE_TRUST" | jq -r '.lag_commits // "null"')
SUPPRESS=""
if [ "$GRAPHIFY_STATE" = "ready" ]; then
  if [ "$LAG" = "null" ]; then
    SUPPRESS="lag_commits=null, state=ready (unreachable SHA / shallow clone)"
  elif [ "$LAG" -gt "$STALE_THRESHOLD" ] 2>/dev/null; then
    SUPPRESS="lag_commits=$LAG > stale_threshold=$STALE_THRESHOLD"
  fi
fi
if [ -n "$SUPPRESS" ]; then
  SCOPE_TRUST=$(echo "$SCOPE_TRUST" | jq '.trust = "sparse"')
  printf '%s — %s\n' "$(date -u +%FT%TZ)" "$SUPPRESS" > .devt/state/staleness-suppressed.txt
fi

node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update scope_hint_json="${SCOPE_HINT}" scope_trust_json="${SCOPE_TRUST}"
```

The `state evict-graphify` call clears stale `graph-impact.md` / `graphify-impact-plan.json` from prior workflows so this research session doesn't inherit a different topic's blast radius.

**Staleness gate** — If `preflight-brief.json::staleness.lag_commits > graphify.stale_threshold` (default 30) OR (`graph_stats.state` is `ready` AND `staleness.lag_commits` is `null`), prompt the user via AskUserQuestion BEFORE the researcher dispatch: "Graphify graph is {lag_commits ?? 'unknown'} commits behind HEAD; codebase patterns may be stale. Refresh now?" Options: **Refresh (recommended)** — pause for `graphify update .`, re-run preflight, continue; **Proceed with stale graph** — continue with `scope_trust.fresh=false`; **Cancel** — STOP with BLOCKED. In autonomous mode, force `scope_trust.trust="sparse"` and proceed. Skip only when graphify is disabled — a null `lag_commits` while `state=ready` (e.g., unreachable SHA, shallow clone) now triggers the prompt instead of silently disabling the gate.

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

Your tool surface does not include `mcp__*graphify*`. Use the `<scope_hint>` block (derived from preflight Brief blast-radius and governing-doc affects_paths) as the high-signal starting set when looking for existing patterns or pitfalls to flag. Validate with Grep/Read against the actual implementation. When `<scope_trust>.trust` is `empty`, broaden Glob/Grep exploration and don't claim "no prior art exists" based on scope_hint alone.
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
