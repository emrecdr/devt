Task(subagent_type="devt:docs-writer", model="{models.docs-writer}", prompt="
  <context>
    <files_to_read>.devt/rules/documentation.md (if exists), CLAUDE.md, README.md (if exists)</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md (if exists)</impl_summary>
    <test_summary>Read .devt/state/test-summary.md (if exists)</test_summary>
    <review>Read .devt/state/review.md (if exists)</review>
    <spec>Read .devt/state/spec.md (if exists)</spec>
    <recent_changes>If no state artifacts above are present, derive the change set from `git log --pretty=format:'%h %s' -20` and `git diff --stat HEAD~10..HEAD`. Read the actual diff for any file the log suggests has a docs-relevant change.</recent_changes>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Update project documentation to reflect recent changes.

    Standalone mode rules:
    - Update existing docs — do not create parallel documentation.
    - Delete documentation for any removed features.
    - When no state artifacts exist, work from the git change set as the source of truth.
    - Report explicitly when documentation is already accurate (no-op is a valid outcome).

    Scope:
    - Update READMEs to reflect new/removed features, install steps, configuration keys.
    - Update docstrings or rustdoc/TSDoc/godoc comments for changed public APIs.
    - Update CHANGELOG.md when a new release is being prepared (skip otherwise).
    - Update docs/* for any architectural changes referenced.
  </task>
  Write summary to .devt/state/docs-summary.md
")
