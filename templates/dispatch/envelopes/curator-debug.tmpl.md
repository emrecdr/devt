Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <context>
    <files_to_read>.devt/memory/_suggestions.md, .devt/memory/lessons/*.md (existing), CLAUDE.md</files_to_read>
    <agent_skills>{injected from .devt/config.json — must include devt:memory-curation}</agent_skills>
  </context>
  <task>
    Auto-curator triggered by /devt:debug post-debug threshold (≥${MIN} candidates pending, last run ≥${COOLDOWN}d ago).
    Evaluate ⚖️/🔵 entries in .devt/memory/_suggestions.md. For each that passes the 5-filter, present an
    AskUserQuestion proposal per memory-curation skill. Accepted candidates land in
    .devt/memory/{decisions,concepts,flows,rejected}/. Write .devt/state/curation-summary.md.
  </task>
")
