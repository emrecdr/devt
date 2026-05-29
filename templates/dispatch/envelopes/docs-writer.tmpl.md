Task(subagent_type="devt:docs-writer", model="{models.docs-writer}", prompt="
  <context>
    <files_to_read>.devt/rules/documentation.md (if exists), CLAUDE.md</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md</impl_summary>
    <test_summary>Read .devt/state/test-summary.md</test_summary>
    <review>Read .devt/state/review.md</review>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Update module documentation to reflect the implementation changes.
    Update existing docs — do not create parallel documentation.
    Delete documentation for any removed features.
  </task>
  Write summary to .devt/state/docs-summary.md
")
