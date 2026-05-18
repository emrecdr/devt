# Memory Promote — Curator-Gated DEC → ADR/CON/FLOW Promotion

Workflow that promotes a candidate (a DEC-xxx from `.devt/state/decisions.md`, a
`#KNOWLEDGE-CANDIDATE` tag in scratchpad, a `.devt/state/decisions.md` DEC-xxx entry, or a fresh
proposal in `_suggestions.md`) into a permanent `.devt/memory/` doc through the
curator's AskUserQuestion approval flow.

<purpose>
The memory layer holds permanent architectural rules. Because they govern future
agent behavior across sessions, EVERY promotion runs through human approval. This
workflow dispatches the curator agent, which presents one AskUserQuestion per
qualified candidate and writes the markdown only on approval.

Hard invariant — NEVER auto-promotes. Even high-confidence candidates require
explicit user approval per `skills/memory-curation/SKILL.md`.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set
- `.devt/memory/` exists (created by `/devt:init` or `/devt:memory init`)
- One of:
  - `.devt/memory/_suggestions.md` exists (output of `/devt:memory suggest`), OR
  - The user provided a specific DEC-id, OR
  - A workflow caller (clarify, specify, research, retro, council) is invoking us
    with a candidate payload
</prerequisites>

<available_agent_types>
- devt:curator — has `memory: project` persistent memory and the `memory-curation` skill preloaded
</available_agent_types>

<agent_skill_injection>
Curator's `skills:` includes `devt:memory-curation`. The skill body drives the
AskUserQuestion approval flow.
</agent_skill_injection>

<deviation_rules>
1. **STOP: no candidates** — If `_suggestions.md` is empty AND no DEC-id was provided AND no caller payload exists, surface "No promotion candidates" and stop.
2. **STOP: 5-filter rejects everything** — If all candidates fail the 5-filter, write a curation summary listing the failures and stop. Do not present a degenerate AskUserQuestion.
3. **STOP: user picks Defer for every candidate** — Capture the deferral in curation-summary.md and stop. Do not loop back.
4. **Auto-fix: missing index** — If the FTS5 index is missing, run `node bin/devt-tools.cjs memory index` before dispatching curator (curator needs working query helpers).
</deviation_rules>

<process>

<step name="init" gate="candidates loaded">
## Step 1: Load candidates

Determine the candidate source:
- If user provided `<DEC-id>`: read that single DEC from `.devt/state/decisions.md`
- Else: read `.devt/memory/_suggestions.md` (run `node bin/devt-tools.cjs memory suggest` first if it doesn't exist)
- Else: take the candidate from the calling workflow's handoff

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=memory_promote phase=context_init status=IN_PROGRESS stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null "task=Promote candidates to .devt/memory/"
```

If `.devt/memory/_suggestions.md` doesn't exist, generate it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory suggest
```
</step>

<step name="dispatch" gate="curator returns curation-summary.md">
## Step 2: Dispatch the curator agent

```
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
<context>
<files_to_read>
- .devt/memory/_suggestions.md (the discovery report)
- .devt/state/decisions.md (DEC-xxx source)
- .devt/state/lessons.yaml (LES draft source from retro, if present)
- .devt/memory/lessons/*.md (existing LES-NNNN entries for cross-checking)
- skills/memory-curation/SKILL.md (the protocol body — already preloaded via your skills frontmatter)
- templates/memory/{ADR,CON,FLOW,REJ,LES}-template.md (use as scaffolding for any approved write)
</files_to_read>
</context>
<task>
Run the memory-curation flow on candidates from .devt/memory/_suggestions.md
${TARGET_DEC_ID ? `(focus on candidate matching ${TARGET_DEC_ID})` : ""}.

Apply the 5-filter (Specificity, Durability, Non-obviousness, Evidence, Actionability).
For each qualified candidate, present an AskUserQuestion with the FULL ORIGINAL
REASONING verbatim and the 5 options (Promote active | Promote candidate | Reject as
REJ | Defer | Edit before promoting).

CRITICAL HARD INVARIANTS — see skills/memory-curation/SKILL.md:
1. NEVER write a permanent .devt/memory/ file without explicit user approval via AskUserQuestion
2. Original reasoning preserved verbatim in the question text — no curator paraphrasing
3. REJ search_keywords are mandatory and exhaustive — under-coverage means AI re-proposes
4. No bulk auto-approve — present one AskUserQuestion per candidate (UI can render in sequence)
5. Always run `node bin/devt-tools.cjs memory index` after each markdown write
</task>
Write summary to .devt/state/curation-summary.md (status: DONE)
Each approved promotion produces one .devt/memory/{decisions,concepts,flows,rejected,lessons}/<NEW-ID>-<slug>.md file.
")
```

Gate: Read `.devt/state/curation-summary.md`. Status must be DONE. If
DONE_WITH_CONCERNS or BLOCKED, surface the concerns to the user before continuing.
</step>

<step name="reindex" gate="memory index updated">
## Step 3: Rebuild the unified FTS5 index

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory index
```

The atomic drop+rebuild ensures the FTS5 index reflects the new permanent docs the
curator just wrote. Without this, subsequent `memory query`, `memory affects`, and
Pre-Flight Brief queries would miss the new ADRs.
</step>

<step name="report">
## Step 4: Report to the user

Surface the curation summary's key counts:
- Promoted to active: N (with ids)
- Promoted to candidate: N (with ids)
- Rejected as REJ tombstones: N (with ids and search_keywords)
- Deferred: N
- Filtered by 5-filter: N (with reasons)

Reference the curation-summary.md path so the user can audit the run.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=false phase=complete status=DONE
```
</step>

</process>

<success_criteria>
- For every approved candidate, exactly one new file exists in `.devt/memory/{decisions,concepts,flows,rejected,lessons}/`
- The FTS5 index at `.devt/memory/index.db` has been rebuilt and contains the new docs
- `.devt/state/curation-summary.md` has Status: DONE and lists every action taken
- Zero permanent files were written without an AskUserQuestion approval
</success_criteria>
