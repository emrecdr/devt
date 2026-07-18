Task(subagent_type="devt:tester", model="{models.tester}", prompt="
  <context>
    <files_to_read>.devt/rules/testing-patterns.md, .devt/rules/quality-gates.md</files_to_read>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <testing_patterns>{governing_rules.content[\".devt/rules/testing-patterns.md\"]}</testing_patterns>
    </governing_rules>
    <context_loaded_contract>governing_rules delivery: any sub-tag above carrying a (by-reference: …) stub means Read that rules file from disk when relevant to your scope, and record every file you actually read in a `## Context Loaded` section of your output artifact (name + full/section read) — the verifier checks that your reads cover the rules your findings depend on. Sub-tags carrying full content inline need no disk reads and no section.</context_loaded_contract>
<guardrails_inline>
      <golden_rules>{inline_guardrails[\"golden-rules.md\"]}</golden_rules>
    </guardrails_inline>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <graphify_status>{graphify_status_json}</graphify_status>
    {prior_outputs}
    <impl_summary_sidecar>Read .devt/state/impl-summary.json — files_changed (authoritative file list), concerns[] (per-file context), next_agent_hints.focus_areas (test priorities), next_agent_hints.skip_areas (don't-test set). Compute coverage_complete by comparing your coverage_files to files_changed; false → re-dispatch with gap as review_feedback.</impl_summary_sidecar>
    <impl_summary>Read .devt/state/impl-summary.md ONLY when a concerns[] entry references prose context not captured by structured fields, OR when next_agent_hints.focus_areas is empty AND files_changed is non-empty (degraded sidecar — fall back to narrative).</impl_summary>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify). Use the "Test Scenarios" section as required coverage targets.</spec>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Write comprehensive tests for the implementation described in .devt/state/impl-summary.md.
    Cover happy paths, error paths, edge cases, and boundary conditions.
    If a spec exists, ensure every test scenario from the spec has a corresponding test.
  </task>
  Write summary to .devt/state/test-summary.md AND structured sidecar to .devt/state/test-summary.json (the JSON is authoritative for routing)
")
