Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <context>
    <files_to_read>.devt/state/lessons.yaml, .devt/memory/_suggestions.md (if exists), .devt/memory/lessons/*.md (existing), CLAUDE.md</files_to_read>
    <agent_skills>{injected from .devt/config.json — must include devt:memory-curation}</agent_skills>
  </context>
  <task>
    Evaluate two upstream sources and gate every promotion via AskUserQuestion:
    1. LESSONS: drafts in .devt/state/lessons.yaml. accept → write LES-NNNN.md
       to .devt/memory/lessons/. merge → update existing LES. reject → record reason.
    2. ARCHITECTURAL CANDIDATES: ⚖️/🔵 entries in .devt/memory/_suggestions.md.
       For each candidate that passes the 5-filter, present AskUserQuestion per
       memory-curation skill. NEVER write without explicit user approval.
    3. PRUNE: propose status:superseded for contradicted/stale lessons.
    4. After all writes, run `memory index` to refresh the FTS5 index.
  </task>
  Write summary to .devt/state/curation-summary.md
")
