# Lesson Extraction Workflow

Retrospective and curation: extract lessons from the current session, validate them, and promote accepted lessons as LES-NNNN frontmatter docs in the unified memory layer (`.devt/memory/lessons/`).

---

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- At least one of the following exists:
  - `.devt/state/` with workflow artifacts (impl-summary.md, test-summary.md, review.md, etc.)
  - Active session context with observable patterns and decisions
</prerequisites>

<available_agent_types>
The following agent types are used in this workflow:

- `devt:retro` — lesson extraction specialist (Read, Write, Bash, Glob, Grep)
- `devt:curator` — memory-layer quality maintenance specialist (Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion)

Not used in this workflow:

- `devt:programmer` — implementation specialist
- `devt:tester` — testing specialist
- `devt:code-reviewer` — code review specialist
- `devt:architect` — structural review specialist
- `devt:docs-writer` — documentation specialist
  </available_agent_types>

<agent_skill_injection>
Before dispatching any agent, check `.devt/config.json` for an `agent_skills` configuration block:

```json
{
  "agent_skills": {
    "retro": ["lesson-extraction"],
    "curator": ["memory-curation"]
  }
}
```

If `agent_skills.<agent_type>` exists, inject the skill references into the agent's prompt context:

```
<agent_skills>
  Load and follow these skill protocols before starting work:
  - ${CLAUDE_PLUGIN_ROOT}/skills/<skill_name>/  (for each skill listed)
</agent_skills>
```

If not configured, omit the block.
</agent_skill_injection>

---

## Steps

Track state so `/devt:status` and `/devt:next` can detect and resume interrupted retros:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=retro phase=retro status=IN_PROGRESS stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null
```

<step name="gather_context" gate="artifacts are identified and accessible">

Identify available workflow artifacts by checking for these files:

- `.devt/state/impl-summary.md`
- `.devt/state/test-summary.md`
- `.devt/state/review.md`
- `.devt/state/arch-review.md`
- `.devt/state/docs-summary.md`

List which artifacts exist. If none exist, the retro agent will work from session context (the conversation history) instead.

Also check for:

- `.devt/memory/lessons/` — existing LES-NNNN docs for deduplication
- `CLAUDE.md` — project rules for evaluating lesson relevance
  </step>

<step name="extract" gate="lessons.yaml is written to .devt/state/">

Dispatch the retro agent:

```
Task(subagent_type="devt:retro", model="{models.retro}", prompt="
  <context>
    <files_to_read>
      .devt/state/impl-summary.md (if exists),
      .devt/state/test-summary.md (if exists),
      .devt/state/review.md (if exists),
      .devt/state/arch-review.md (if exists),
      .devt/state/docs-summary.md (if exists),
      CLAUDE.md (if exists),
      .devt/rules/coding-standards.md,
      .devt/rules/testing-patterns.md,
      .devt/memory/lessons/*.md (existing LES-NNNN entries)
    </files_to_read>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review all available workflow artifacts and session context.
    Extract lessons learned using the 4-filter test:
    1. Specific — describes a concrete situation and action
    2. Generalizable — applies beyond this single task
    3. Actionable — a developer can act on it immediately
    4. Evidence-based — grounded in what happened, not theory

    Discard any candidate that fails ANY filter.
    For each surviving lesson, assign importance (1-10), confidence (0.0-1.0), and decay_days.
  </task>
  Write lessons to .devt/state/lessons.yaml
")
```

**Gate check**: Read `.devt/state/lessons.yaml`:

- If it contains at least one lesson: proceed to curate
- If it contains zero lessons (all candidates were filtered out): report "No lessons met the quality threshold" and STOP with DONE
  </step>

<step name="harvest_observations" gate="memory suggest exits 0">

Unconditional harvest. Refreshes `.devt/memory/_suggestions.md` from claude-mem ⚖️/🔵 + `#KNOWLEDGE-CANDIDATE` scratchpad tags + DEC-xxx entries so the curator below can run the dual-path review. NEVER writes permanent memory docs; that's curator's gated job below.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory suggest >/dev/null 2>&1 || true
```

Best-effort: harvest gracefully no-ops when claude-mem is absent or no observations matched. Failure here MUST NOT fail the retro flow.

</step>

<step name="curate" gate="curation-summary.md is written and .devt/memory/ is updated">

Dispatch the curator agent. Both lessons and architectural candidates flow through the same unified memory layer at `.devt/memory/` — every promotion is gated by AskUserQuestion per candidate.

```
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <context>
    <files_to_read>.devt/state/lessons.yaml, .devt/memory/_suggestions.md (if exists), .devt/memory/lessons/*.md (existing), CLAUDE.md</files_to_read>
    <agent_skills>{injected from .devt/config.json — must include devt:memory-curation}</agent_skills>
  </context>
  <task>
    Evaluate two upstream sources and gate every promotion via AskUserQuestion:
    1. LESSONS: Incoming retro drafts in .devt/state/lessons.yaml. For each,
       decide: accept (write LES-NNNN.md), merge (update existing LES), edit
       (refine then accept), reject (record reason). Accepted lessons land in
       .devt/memory/lessons/.
    2. ARCHITECTURAL CANDIDATES: ⚖️/🔵 entries in .devt/memory/_suggestions.md.
       For each candidate that passes the 5-filter (Specificity, Durability,
       Non-obviousness, Evidence, Actionability), present an AskUserQuestion
       proposal per memory-curation skill. Accepted candidates land in
       .devt/memory/{decisions,concepts,flows,rejected}/. NEVER write without
       explicit user approval — hard invariant.
    3. PRUNE: Review existing LES-NNNN entries; propose status:superseded for
       contradicted or stale lessons via AskUserQuestion.
    4. After all writes, run `memory index` to refresh .devt/memory/index.db.
  </task>
  Write summary to .devt/state/curation-summary.md
")
```

</step>

<step name="reindex" gate="memory FTS5 index is up to date">

After curation, ensure the FTS5 index reflects newly written `.md` files:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory index
```

This is idempotent — safe to run even when the curator already triggered it. The index drives Pre-Flight Brief lookups, so any drift here means lessons silently disappear from future Briefs.
</step>

<step name="report" gate="results are presented to the user">

Read `.devt/state/curation-summary.md` and report to the user:

- **Lessons extracted**: total count from retro agent
- **Lessons accepted**: written as LES-NNNN.md to `.devt/memory/lessons/`
- **Lessons merged**: combined with existing LES-NNNN entries
- **Lessons rejected**: failed quality criteria (with brief reasons)
- **Entries superseded**: existing LES-NNNN moved to `status:superseded`
- **Memory layer health**: total active docs (LES + ADR + CON + FLOW + REJ), index rebuild status

Final status: **DONE**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=retro status=DONE active=false
```
</step>

---

<deviation_rules>

1. **Auto-fix: bugs** — Not applicable. This workflow reads and writes knowledge artifacts, not code.
2. **Auto-fix: lint** — Not applicable.
3. **Auto-fix: deps** — If `.devt/memory/lessons/` does not exist, the curator's `memory index` step creates it from scratch (init scaffolds all 5 subfolders).
4. **STOP: architecture** — If the retro agent encounters contradictory evidence (two artifacts disagree about what happened), it flags the contradiction in `lessons.yaml` for the curator to resolve via AskUserQuestion.
   </deviation_rules>

<success_criteria>

- Retro agent has reviewed all available artifacts
- Each extracted lesson passes the 4-filter test
- Curator has evaluated every incoming lesson (accept/merge/edit/reject)
- Accepted lessons written as LES-NNNN.md frontmatter docs to `.devt/memory/lessons/` with explicit user approval per candidate
- Superseded lessons marked `status:superseded` (not deleted — history preserved)
- `memory index` ran cleanly so Pre-Flight Briefs see new lessons immediately
- Final status: **DONE**
  </success_criteria>

## Memory layer integration

Retro extracts BOTH operational lessons AND architectural candidates. Both flow into the
**unified** memory layer at `.devt/memory/`:

- Operational lessons → `.devt/memory/lessons/LES-NNNN.md` (4-filter at extraction; curator
  AskUserQuestion at promotion)
- Architectural candidates (⚖️/🔵 from discovery harvest) → `.devt/memory/{decisions,concepts,flows,rejected}/`
  (5-filter from contamination-guidelines: Specificity, Durability, Non-obviousness, Evidence,
  Actionability)

There is one canonical store and one approval gate (curator + AskUserQuestion). All five doc
types are FTS5-indexed in `.devt/memory/index.db` and surface in Pre-Flight Briefs by the same
domain/symbol/keyword/wiki-link match logic.
