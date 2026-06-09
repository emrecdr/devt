Task(subagent_type="devt:tester", model="{models.tester}", prompt="
  <context>
    <files_to_read>.devt/rules/testing-patterns.md, .devt/rules/quality-gates.md, CLAUDE.md</files_to_read>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <testing_patterns>{governing_rules.content[\".devt/rules/testing-patterns.md\"]}</testing_patterns>
    </governing_rules>
<guardrails_inline>
      <golden_rules>{inline_guardrails[\"golden-rules.md\"]}</golden_rules>
    </guardrails_inline>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    {prior_outputs}
    <impl_summary_sidecar>Read .devt/state/impl-summary.json — files_changed (authoritative file list), concerns[] (per-file context), next_agent_hints.focus_areas (test priorities), next_agent_hints.skip_areas (don't-test set). Compute coverage_complete by comparing your coverage_files to files_changed; false → re-dispatch with gap as review_feedback.</impl_summary_sidecar>
    <impl_summary>Read .devt/state/impl-summary.md ONLY when a concerns[] entry references prose context not captured by structured fields, OR when next_agent_hints.focus_areas is empty AND files_changed is non-empty (degraded sidecar — fall back to narrative).</impl_summary>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify)</spec>
    <learning_context>{learning_context from context_init — relevant testing lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Write tests for the implementation described in .devt/state/impl-summary.md.
    Cover happy paths, error paths, and key edge cases.
  </task>
  Write summary to .devt/state/test-summary.md AND structured sidecar to .devt/state/test-summary.json (the JSON is authoritative for routing)
")
