Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="
  <context>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
<memory_signal>{memory_signal_json}</memory_signal>
    <!-- Cal #32 rank #2: auto_memory carries user-curated decisions (laneH
         from ~/.claude/projects/<projHash>/memory/*.md) + claude-mem
         observations (.devt/state/claude-mem-harvest.md). G2 (cal #31.C)
         populated this in preflight-brief.json but the envelope never
         referenced the field — reviewers got it only redundantly via
         claude-mem harvest. Distinct from memory_signal which is the
         FTS-backed ADR/CON/FLOW/REJ/LES governance layer. -->
    <auto_memory>{auto_memory_json}</auto_memory>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <graphify_status>{graphify_status_json}</graphify_status>
    <god_node_warnings>{god_node_warnings_json}</god_node_warnings>
    <graph_impact>
{graph_impact_content}
</graph_impact>
    <graph_impact_note>The above is orchestrator-mediated MCP output inlined from .devt/state/graph-impact.md — high-signal review map for changed symbols. Your tool surface does not include `mcp__*graphify*`, so consume the inlined data rather than issuing graph queries.</graph_impact_note>
    {prior_outputs}
    {provenance_protocol}
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
    <!-- Inline rubric body from init payload — reviewer self-checks against
         the same axes the verifier will grade, reducing verifier-revision
         loops. Falls back to <rubric_path> on-disk Read when omitted
         (oversized rubric → init returns null inline_rubrics). -->
    <rubric_content>{inline_rubrics.code_review}</rubric_content>
    <review_scope>Read .devt/state/code-review-input.md</review_scope>
    <impl_summary>Read .devt/state/impl-summary.md (if exists)</impl_summary>
    <test_summary>Read .devt/state/test-summary.md (if exists)</test_summary>
    <decisions>Read .devt/state/decisions.md (if exists — from /devt:workflow --mode=clarify)</decisions>
    <learning_context>{learning_context — relevant review/quality lessons from .devt/memory/lessons/ via Pre-Flight Brief, if any}</learning_context>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Review the following files for quality, correctness, and standards compliance.
    Review ALL code in the listed files — do not filter by origin or label findings as pre-existing.
    Every valid finding must be reported with file, line, severity, and rule reference.

    **Self-grade against the rubric as you write.** The same axes the
    verifier will use to grade your review are inlined in <rubric_content> (or
    readable at <rubric_path> as fallback). Walk EVERY declared axis (both the
    A–G table rows AND any `## Axis [A-Z] —` top-level headings, currently
    including axis H for dispatch warnings acknowledgment)
    before emitting review.md: scope coverage (every input file mentioned),
    finding specificity (file:line + rule ref or pattern citation), severity
    calibration (no Critical-rated nits, no Minor-rated security issues),
    remediation concreteness (Critical/Important findings include a fix
    direction), ADR Compliance section when memory affects-paths returned
    hits, Reuse Discipline section when reuse-candidates.md is non-empty,
    Dispatch warnings section per axis H. Closing these gaps in your first
    pass avoids a verifier revision loop.

    Graph-impact map: the orchestrator wrote `.devt/state/graph-impact.md` (or `graphify-skip-reason.txt`)
    during context_init using upstream Graphify MCP. You consume that file READ-ONLY — your tool surface
    does not include `mcp__*graphify*`, so use the data already present rather than issuing graph queries
    yourself. When the impact map lists affected_communities, blast radius, or caller sets for symbols
    touched by your findings, cross-reference them as you write each finding's remediation. Use Grep/Read
    to validate specific code lines that the map points to. When `graphify-skip-reason.txt` exists, no
    graph data is available — proceed with Grep+Read review normally.

    **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing review.md):
    Per your agent body's `knowledge_candidates` step, if this review surfaces non-obvious patterns
    worth promoting to permanent memory (recurring code smell, undocumented invariant, "we always do X
    because Y" rule, REJ-tombstone-worthy anti-pattern), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Skip trivial findings
    or anything already in CLAUDE.md / .devt/rules/. Each tag passes the 5-filter test: specificity,
    durability, non-obviousness, evidence, actionability. Even when none qualify, surface that
    decision in your review.md ("no knowledge candidates emerged — all findings were code-local").
  </task>
  Write review to .devt/state/review.md
")
