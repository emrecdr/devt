Task(subagent_type="devt:retro", model="{models.retro}", prompt="
  <context>
    <files_to_read>
      .devt/state/impl-summary.md,
      .devt/state/test-summary.md,
      .devt/state/review.md,
      .devt/state/arch-review.md (if exists),
      .devt/state/docs-summary.md (if exists),
      .devt/rules/coding-standards.md,
      .devt/rules/testing-patterns.md,
      .devt/memory/lessons/*.md (existing LES-NNNN entries)
    </files_to_read>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review all workflow artifacts and extract lessons learned.
    Apply the 4-filter test: specific, generalizable, actionable, evidence-based.
    Discard anything that fails any filter.
  </task>
  Write lessons to .devt/state/lessons.yaml
")
