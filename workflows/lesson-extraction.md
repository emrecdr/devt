# Lesson Extraction Workflow

Retrospective and curation: extract lessons from the current session, validate them, and sync to the learning playbook.

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
- `devt:curator` — playbook quality maintenance specialist (Read, Write, Edit, Bash, Glob, Grep)

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
    "curator": ["playbook-curation"]
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
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=retro phase=retro status=IN_PROGRESS stopped_at=null stopped_phase=null
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

- `.devt/learning-playbook.md` — existing playbook for deduplication
- `CLAUDE.md` — project rules for evaluating lesson relevance
  </step>

<step name="extract" gate="lessons.yaml is written to .devt/state/">

Dispatch the retro agent:

```
Task(subagent_type="devt:retro", model="{models.retro}", prompt="
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
      .devt/learning-playbook.md (if exists)
    </files_to_read>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write lessons to .devt/state/lessons.yaml
")
```

**Gate check**: Read `.devt/state/lessons.yaml`:

- If it contains at least one lesson: proceed to curate
- If it contains zero lessons (all candidates were filtered out): report "No lessons met the quality threshold" and STOP with DONE
  </step>

<step name="curate" gate="curation-summary.md is written and .devt/learning-playbook.md is updated">

Dispatch the curator agent:

```
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <task>
    Evaluate incoming lessons from .devt/state/lessons.yaml.
    For each lesson, decide: accept, merge, edit, reject, or archive.
    Update .devt/learning-playbook.md with accepted/merged entries.
    Prune expired or low-confidence entries from the existing playbook.
    Resolve any contradictions between new and existing entries.
  </task>
  <context>
    <files_to_read>.devt/learning-playbook.md (if exists), .devt/state/lessons.yaml, CLAUDE.md</files_to_read>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  Write summary to .devt/state/curation-summary.md
")
```

</step>

<step name="sync" gate="semantic database is updated (or skipped if Python unavailable)">

After curation, sync the updated playbook to the FTS5 semantic database:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" semantic sync
```

If the sync succeeds, lessons are now searchable via FTS5 for future workflows.
If it fails (no playbook yet), this is non-blocking — the CLI falls back to keyword matching automatically.
</step>

<step name="report" gate="results are presented to the user">

Read `.devt/state/curation-summary.md` and report to the user:

- **Lessons extracted**: total count from retro agent
- **Lessons accepted**: added to playbook
- **Lessons merged**: combined with existing entries
- **Lessons rejected**: failed quality criteria (with brief reasons)
- **Entries archived**: pruned from playbook due to decay or low confidence
- **Playbook health**: total entries, average importance, entries expiring soon

Final status: **DONE**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update phase=retro status=DONE active=false
```
</step>

---

<deviation_rules>

1. **Auto-fix: bugs** — Not applicable. This workflow reads and writes knowledge artifacts, not code.
2. **Auto-fix: lint** — Not applicable.
3. **Auto-fix: deps** — If `.devt/learning-playbook.md` does not exist, the curator agent creates it from scratch.
4. **STOP: architecture** — If the retro agent encounters contradictory evidence (two artifacts disagree about what happened), it flags the contradiction in `lessons.yaml` for the curator to resolve. The curator decides which version to trust.
   </deviation_rules>

<success_criteria>

- Retro agent has reviewed all available artifacts
- Each extracted lesson passes the 4-filter test
- Curator has evaluated all incoming lessons (accept/merge/edit/reject/archive)
- `.devt/learning-playbook.md` is updated (or created) with accepted entries
- Expired and low-confidence entries are pruned
- Final status: **DONE**
  </success_criteria>
