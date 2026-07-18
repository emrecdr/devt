Task(subagent_type="devt:code-reviewer", model="{models.code-reviewer}", prompt="
  <context>
    <workflow_type>code_review_parallel</workflow_type>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <coding_standards>{governing_rules.content[\".devt/rules/coding-standards.md\"]}</coding_standards>
      <architecture>{governing_rules.content[\".devt/rules/architecture.md\"]}</architecture>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
    <context_loaded_contract>governing_rules delivery: any sub-tag above carrying a (by-reference: …) stub means Read that rules file from disk when relevant to your scope, and record every file you actually read in a `## Context Loaded` section of your output artifact (name + full/section read) — the verifier checks that your reads cover the rules your findings depend on. Sub-tags carrying full content inline need no disk reads and no section.</context_loaded_contract>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <god_node_warnings>{god_node_warnings_json}</god_node_warnings>
    {prior_outputs}
    {provenance_protocol}
    <rubric_path>references/rubrics/{rubrics.code_review}</rubric_path>
    <lane_files>{lane_files_newline_separated}</lane_files>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Synthesize the N lane review files listed in <lane_files> into a single .devt/state/review.md
    plus .devt/state/review.json sidecar. Synthesis mode — you are NOT performing a fresh review;
    the lane files were produced by per-lane code-reviewer dispatches over disjoint file slices.
    Read each lane file, then consolidate.

    Synthesis rules:
    - Dedupe findings by (file:line:finding_class). When the same finding appears in multiple
      lanes (cross-cutting concern), keep the most specific one and cite all source lanes.
    - Reconcile severity using the rubric at <rubric_path> (Read it BEFORE reconciling
      severities) when lanes disagree — promote to the higher severity when evidence supports it.
    - Preserve EVERY Critical finding. Important and Minor may be deduped but never silently
      dropped — when you drop one, note it in the per-lane provenance.
    - NO merged 0-100 score: review.json carries "score": null + "lane_scores": [{id,
      community, score, verdict, findings_contributed}]; the review.md headline is verdict +
      severity counts + the per-lane score distribution. A consolidated deduction score
      saturates at the 0 floor and misleads any consumer that trusts it.
    - Group findings by file for the consolidated output.
    - Add a `## Lane Provenance` section listing each lane's id, community, status, and finding
      count contributed. Lanes with status=deferred contribute zero findings — still list them so
      the reader knows coverage is partial.

    Self-grade against the rubric as you write (axes that apply to synthesis: A — every lane
    referenced; B — every kept finding carries file:line + severity + rule ref; C — severity
    calibration after merge; D — Critical remediations remain concrete; H — dispatch warnings
    acknowledged). The verifier will grade against the same rubric — closing these gaps here
    avoids a revision loop.

    Do NOT re-issue lane reviews. Do NOT issue new graph queries (your tool surface has no
    `mcp__*graphify*`; the per-lane reviewers already consumed graph-impact.md). Do NOT promote
    or curate memory — the parallel workflow's `present_findings` step runs lane aggregation
    + knowledge-candidate gating separately.
  </task>
  Write the consolidated review to .devt/state/review.md and the sidecar to .devt/state/review.json
")
