Task(subagent_type="devt:verifier", model="{models.verifier}", prompt="
  <context>
    <workflow_type>code_review</workflow_type>
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
    <!-- Inline rubric body from init payload — verifier prefers this over the
         on-disk Read at <rubric_path> when present. Falls back to path when
         omitted (oversized rubric → init returns null inline_rubrics). -->
    <rubric_content>{inline_rubrics.code_review}</rubric_content>
    <original_task>{review_scope_description}</original_task>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <god_node_warnings>{god_node_warnings_json}</god_node_warnings>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
    {prior_outputs}
    <files_to_read>.devt/state/review.md, .devt/state/code-review-input.md</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md (if exists — code-review may follow an implementation phase)</impl_summary>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Grade the code review against the code_review rubric. You are NOT re-doing the review.
    Spot-check the review's thoroughness, specificity, severity calibration, and remediation
    concreteness using the rubric in <rubric_path>. Read review.md as the artifact under review.
    If axes fail, emit revisions[] keyed by axis-letter (A-1, B-3, etc.) for the reviewer to address.

    Cross-reference the review's remediation against `.devt/state/graph-impact.md` when present.
    The orchestrator wrote that file from upstream Graphify MCP during context_init. When the
    impact map lists high-blast-radius symbols or affected communities for findings the reviewer
    flagged, verify the remediation accounts for caller-set impact — propose a revision when a
    Critical finding ignores a documented structural risk. When `graphify-skip-reason.txt` exists,
    graph data is unavailable and structural-risk cross-checks do not apply.
  </task>
  Write verification to .devt/state/verification.md AND .devt/state/verification.json (sidecar).
")
