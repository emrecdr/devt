Task(subagent_type="devt:verifier", model="{models.verifier}", prompt="
  <context>
    <workflow_type>dev</workflow_type>
    <!-- Rubric path is pinned by the `rubrics` config key. The init payload
         exposes `rubrics.dev` (default "dev.v1.md"); override per project in
         .devt/config.json. The verifier reads this block instead of computing
         the path from <workflow_type>, so we can ship rubric updates as new
         files (dev.v2.md) without breaking projects pinned to v1. -->
    <rubric_path>references/rubrics/{rubrics.dev}</rubric_path>
    <original_task>{task_description}</original_task>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify). Use as primary acceptance criteria source.</spec>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
    </governing_rules>
    <context_loaded_contract>governing_rules delivery: any sub-tag above carrying a (by-reference: …) stub means Read that rules file from disk when relevant to your scope, and record every file you actually read in a `## Context Loaded` section of your output artifact (name + full/section read) — the verifier checks that your reads cover the rules your findings depend on. Sub-tags carrying full content inline need no disk reads and no section.</context_loaded_contract>
    {prior_outputs}
    {provenance_protocol}
    <files_to_read>.devt/state/impl-summary.md, .devt/state/test-summary.md, .devt/state/review.md</files_to_read>
    <baseline>Read .devt/state/baseline-gates.md (if exists). Compare current quality gate results against this baseline — tests that PASSED in baseline but FAIL now are regressions. Pre-existing failures are NOT regressions.</baseline>
    <plan>Read .devt/state/plan.md (if exists)</plan>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Verify the implementation achieves the original task goal.
    Use goal-backward verification: trace from requirements to code.
    If a spec exists, verify against its user stories, success criteria, and test scenarios — not just the task description.
    Grade against the pinned rubric — Read it from <rubric_path> before grading (verdict vocabulary, required levels, and revisions[] shape all come from the rubric).
  </task>
  Write verification to .devt/state/verification.md
")
