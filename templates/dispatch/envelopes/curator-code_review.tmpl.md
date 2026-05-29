Task(subagent_type="devt:curator", model="{models.curator}", prompt="
  <context>
    <files_to_read>.devt/memory/_suggestions.md, .devt/memory/lessons/*.md (existing), CLAUDE.md</files_to_read>
    <agent_skills>{injected from .devt/config.json — must include devt:memory-curation}</agent_skills>
  </context>
  <task>
    Auto-curator triggered by /devt:review post-review threshold (≥${MIN} candidates pending, last run ≥${COOLDOWN}d ago).
    Evaluate ⚖️/🔵 entries in .devt/memory/_suggestions.md. For each that passes the 5-filter (Specificity, Durability,
    Non-obviousness, Evidence, Actionability), present an AskUserQuestion proposal per memory-curation skill.
    Accepted candidates land in .devt/memory/{decisions,concepts,flows,rejected}/.
    Write .devt/state/curation-summary.md with verdicts per candidate (accepted / edited / rejected with reason).
  </task>
")
