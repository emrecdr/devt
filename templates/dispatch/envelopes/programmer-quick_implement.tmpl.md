Task(subagent_type="devt:programmer", model="{models.programmer}", prompt="
  <context>
    <files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md, .devt/rules/architecture.md, CLAUDE.md</files_to_read>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
    </governing_rules>
<guardrails_inline>
      <golden_rules>{inline_guardrails["golden-rules.md"]}</golden_rules>
      <engineering_principles>{inline_guardrails["engineering-principles.md"]}</engineering_principles>
      <generative_debt_checklist>{inline_guardrails["generative-debt-checklist.md"]}</generative_debt_checklist>
    </guardrails_inline>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
<reuse_candidates>Read .devt/state/reuse-candidates.md if present — graphify-derived list of existing functions with similar responsibility. Address each candidate in .devt/state/reuse-analysis.md before writing new code (see programmer.md::reuse_analysis step).</reuse_candidates>
    <scan_results>Read .devt/state/scan-results.md (if exists)</scan_results>
    <spec>Read .devt/state/spec.md (if exists — from /devt:specify)</spec>
    <research>Read .devt/state/research.md (if exists — from /devt:research)</research>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <review_feedback>Read .devt/state/review.md (if this is a fix iteration)</review_feedback>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>{task_description}

  **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing impl-summary.md): per your `knowledge_candidates` step, if implementation surfaces non-obvious patterns worth promoting (hidden constraint discovered mid-flight, "must always do X" verified empirically, existing invariant that took grep-archaeology to find), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write summary to .devt/state/impl-summary.md
")
