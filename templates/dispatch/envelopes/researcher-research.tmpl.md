Task(subagent_type="devt:researcher", model="{models.researcher}", prompt="
<context>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
  <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
  <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
  <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
</governing_rules>
<scope_hint>{scope_hint_json}</scope_hint>
<scope_trust>{scope_trust_json}</scope_trust>
<graph_impact>Read .devt/state/graph-impact.md if it exists — pre-computed caller set + blast radius for the topic's central symbol. When absent, .devt/state/graphify-skip-reason.txt explains why (orchestrator already wrote one of these before dispatch).</graph_impact>
<spec>Read .devt/state/spec.md (if exists — from /devt:specify)</spec>
<decisions>Read .devt/state/decisions.md (if exists)</decisions>
<template>${CLAUDE_PLUGIN_ROOT}/templates/research-template.md</template>
<agent_skills>{injected from .devt/config.json if available}</agent_skills>
</context>
<task>
Research implementation approaches for: {task_description}
Investigate the codebase for existing patterns, recommend an approach, identify pitfalls.

Your tool surface does not include `mcp__*graphify*`. Use the `<scope_hint>` block (derived from preflight Brief blast-radius and governing-doc affects_paths) as the high-signal starting set when looking for existing patterns or pitfalls to flag. Validate with Grep/Read against the actual implementation. When `<scope_trust>.trust` is `empty`, broaden Glob/Grep exploration and don't claim "no prior art exists" based on scope_hint alone.

**Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing research.md): per your `knowledge_candidates` step, if investigation surfaces non-obvious facts worth promoting to permanent memory (a recurring trap, a constraint not documented anywhere, a verified rule of thumb, a pattern that explains "why does the codebase do it this way"), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes the 5-filter test: specificity, durability, non-obviousness, evidence, actionability. When none qualify, surface that decision in research.md.
</task>
Write findings to .devt/state/research.md
")
