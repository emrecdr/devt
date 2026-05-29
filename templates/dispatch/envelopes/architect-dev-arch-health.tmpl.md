Task(subagent_type="devt:architect", model="{models.architect}", prompt="
  <context>
    <files_to_read>.devt/rules/architecture.md, .devt/rules/coding-standards.md, CLAUDE.md</files_to_read>
    <!-- KEEP IN SYNC: this <governing_rules> block is duplicated across the
         programmer, tester, code-reviewer, verifier, researcher, and architect
         dispatch templates. When one changes, update the others. -->
    <governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
    </governing_rules>
    <!-- KEEP IN SYNC: architect preloads golden-rules + engineering-principles
         from the guardrails set (not generative-debt-checklist). -->
    <guardrails_inline>
      <golden_rules>{inline_guardrails[\"golden-rules.md\"]}</golden_rules>
      <engineering_principles>{inline_guardrails[\"engineering-principles.md\"]}</engineering_principles>
    </guardrails_inline>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <scan_results>Read .devt/state/scan-results.md for affected modules — the plan does not exist yet, so scope from the scan.</scan_results>
    <skill>${CLAUDE_PLUGIN_ROOT}/skills/architecture-health-scanner/</skill>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Run an architecture health scan on the modules affected by this task.
    Focus on: layer violations, coupling issues, circular dependencies, and convention drift.
    Classify each finding as: true positive, false positive, or pre-existing.
    Report only findings relevant to the in-scope modules.

    **Capture knowledge candidates** (load-bearing — not optional): per your `knowledge_candidates` step, if your scan surfaces architectural rules / patterns worth promoting (cross-component invariants, "this layer cannot depend on that", non-obvious design constraints), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write findings to .devt/state/arch-health-scan.md
")
