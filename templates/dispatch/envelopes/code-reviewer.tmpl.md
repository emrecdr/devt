Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="
  <context>
    <!-- KEEP IN SYNC: this <governing_rules> block is duplicated across the
         researcher, code-reviewer, and verifier dispatch templates. When one
         changes, update the others. governing_rules comes from the init
         payload; omit this block entirely when content is empty (agent falls
         back to on-disk Reads of CLAUDE.md + .devt/rules/*.md). -->
    <governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
    <!-- KEEP IN SYNC: the <memory_signal> block + its orchestrator-prep step
         are duplicated across programmer + code-reviewer + verifier dispatches
         in dev-workflow.md, code-review.md, and quick-implement.md. When the
         CLI shape or block position changes, update all five. -->
    <memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <!-- KEEP IN SYNC: this <guardrails_inline> block is duplicated in the
         programmer and code-reviewer dispatch templates. When one changes,
         update the other. inline_guardrails comes from the init payload;
         omit this block entirely when it is null (agent falls back to on-disk
         Reads of the three guardrail files). -->
    <guardrails_inline>
      <golden_rules>{inline_guardrails["golden-rules.md"]}</golden_rules>
      <engineering_principles>{inline_guardrails["engineering-principles.md"]}</engineering_principles>
      <generative_debt_checklist>{inline_guardrails["generative-debt-checklist.md"]}</generative_debt_checklist>
    </guardrails_inline>
    <impl_summary>Read .devt/state/impl-summary.md</impl_summary>
    <test_summary>Read .devt/state/test-summary.md</test_summary>
    <decisions>Read .devt/state/decisions.md (if exists — from /devt:clarify)</decisions>
    <learning_context>{learning_context from context_init — relevant lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review the implementation and tests for quality, correctness, and standards compliance.
    Review ALL code in scope — do not filter by origin or label findings as pre-existing.

    **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing review.md): per your `knowledge_candidates` step, if this review surfaces non-obvious patterns worth promoting (recurring code smell, undocumented invariant, "we always do X because Y" rule, REJ-tombstone-worthy anti-pattern), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write review to .devt/state/review.md
")
