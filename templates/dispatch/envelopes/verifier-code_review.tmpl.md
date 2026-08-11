Task(subagent_type="devt:verifier", model="{models.verifier}", prompt="
  <context>
    <workflow_type>code_review</workflow_type>
    <rubric_path>.devt/state/rubric-code_review.md</rubric_path>
    <original_task>{review_scope_description}</original_task>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <god_node_warnings>{god_node_warnings_json}</god_node_warnings>
<governing_rules rules_hash=\"{governing_rules.rules_hash}\">
      <claude_md>{governing_rules.content[\"CLAUDE.md\"]}</claude_md>
      <quality_gates>{governing_rules.content[\".devt/rules/quality-gates.md\"]}</quality_gates>
      <review_checklist>{governing_rules.content[\".devt/rules/review-checklist.md\"]}</review_checklist>
    </governing_rules>
    <context_loaded_contract>{context_loaded_contract}</context_loaded_contract>
    {prior_outputs}
    {provenance_protocol}
    <files_to_read>.devt/state/review.md, .devt/state/code-review-input.md</files_to_read>
    <lane_sample>{lane_sample}</lane_sample>
    <impl_summary>Read .devt/state/impl-summary.md (if exists — code-review may follow an implementation phase)</impl_summary>
    <decisions>Read .devt/state/decisions.md (if exists)</decisions>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Grade the code review against the code_review rubric. You are NOT re-doing the review.
    Spot-check the review's thoroughness, specificity, severity calibration, and remediation
    concreteness using the rubric in <rubric_path>. Read review.md as the artifact under review.
    If axes fail, emit revisions[] keyed by axis-letter (A-1, B-3, etc.) for the reviewer to address.

    **Lane sample (parallel reviews only).** When <lane_sample> names a lane file, Read it and grade
    that ONE lane against the same rubric. Consolidation hides a lane that stopped early: its thin
    output merges into the review indistinguishably from a genuinely clean slice, and grading only
    the consolidated artifact can never surface it. The named lane is the highest LOC-per-finding
    lane — the "big diff, few findings" cell where under-review hides — not the biggest and not the
    one with the most findings. Report the result as a `lane_sample` object in verification.json
    ({lane_id, verdict, reasoning}). A weak sample does NOT block the review: record it, and add a
    one-line note under that lane's entry in `review.md`'s Lane Provenance section so a reader of the
    review — not only a reader of verification.json — knows that lane's depth is suspect.

    Cross-reference the review's remediation against `.devt/state/graph-impact.md` when present.
    The orchestrator wrote that file from upstream Graphify MCP during context_init. When the
    impact map lists high-blast-radius symbols or affected communities for findings the reviewer
    flagged, verify the remediation accounts for caller-set impact — propose a revision when a
    Critical finding ignores a documented structural risk. When `graphify-skip-reason.txt` exists,
    graph data is unavailable and structural-risk cross-checks do not apply.
  </task>
  Write verification to .devt/state/verification.md AND .devt/state/verification.json (sidecar).
  The sidecar MUST declare "criteria_total" and "criteria_met" —
  assert-verifier-graded-all-axes blocks on a missing or short count. **Count the axes in the
  rubric you actually loaded** — every `## Axis [A-Z] —` heading plus every `| **[A-Z]. ` table
  row — and never trust a number quoted in this envelope. The gate counts from the RUBRIC, so a
  stale figure here fails a CORRECT verification. (Field: this line said 7 after Axis I took the
  rubric to 8; the run survived only because the verifier read the rubric, caught the
  contradiction, and overrode its own envelope.)
")
