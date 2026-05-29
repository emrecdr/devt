Task(subagent_type="devt:researcher", model="{models.researcher}", prompt="
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
    </governing_rules>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <spec>Read .devt/state/spec.md (if exists)</spec>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <template>${CLAUDE_PLUGIN_ROOT}/templates/research-template.md</template>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>Research implementation approaches for: {task_description}

  **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing research.md): per your `knowledge_candidates` step, if investigation surfaces non-obvious facts worth promoting to permanent memory (recurring trap, undocumented constraint, verified rule of thumb, "why does the codebase do it this way" pattern), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write findings to .devt/state/research.md
")
