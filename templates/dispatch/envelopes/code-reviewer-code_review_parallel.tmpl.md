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
    <context_loaded_contract>{context_loaded_contract}</context_loaded_contract>
<memory_signal>{memory_signal_json}</memory_signal>
    <scope_hint>{scope_hint_json}</scope_hint>
    <scope_trust>{scope_trust_json}</scope_trust>
    <god_node_warnings>{god_node_warnings_json}</god_node_warnings>
    {prior_outputs}
    {provenance_protocol}
    <rubric_path>{plugin_root}/references/rubrics/{rubrics.code_review}</rubric_path>
    <lane_files>{lane_files_newline_separated}</lane_files>
    <unassigned_scope>{unassigned_scope}</unassigned_scope>
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
    - review.json MUST carry the routing fields: "status" ("DONE" | "PARTIAL" | "BLOCKED") and
      "verdict" — status absent fails the sidecar consistency check on every later state update.
      When any lane_scores[].score is null, add "lane_scores_null_reason" (one line: why lanes
      could not self-score) — a silent all-null distribution reads as a working feature.
    - MANDATORY provenance header: the FIRST lines of review.md include `Correlation: <your
      correlation_id>` — the consolidator-dispatched gate verifies this id against the render
      stamp, which is what proves review.md came from a dispatched synthesis agent.
    - Group findings by file for the consolidated output.
    - review.json MUST carry "raw_lane_finding_counts" in EXACTLY this shape — a per-lane
      breakdown keyed by lane id, optionally beside a roll-up:
        "raw_lane_finding_counts": {
          "by_lane": {"L1": {"critical":N,"important":N,"minor":N,"nit":N}, "L2": {...}},
          "raw_total": {"critical":N,"important":N,"minor":N,"nit":N}
        }
      `by_lane` is the field that matters: it is checked lane-by-lane against the per-lane
      sidecars, so it is the one number here that can be verified rather than trusted. If you
      supply a roll-up too it must equal the sum of by_lane — a disagreement between your own
      two figures is reported as a defect.
    - Coverage vocabulary — report these SEPARATELY in review.json::coverage; they are four
      different claims and collapsing them is how a review overstates itself:
        "files_assigned"      — declared files that went to some lane
        "files_mentioned"     — files named anywhere in review.md
        "files_with_findings" — files carrying at least one kept finding
        "files_cleared"       — files a lane verified with CONCRETE evidence of why there is
                                nothing to report ("base class is sole owner of X, both callers
                                re-verified"), not a bare "no issues found"
      A clean verification is a finding. When a lane proves a file safe, that proof must reach
      review.md — dropping it silently turns "verified safe" into "not mentioned", and those
      are indistinguishable to every downstream reader. Never report an N-of-M coverage figure
      without saying WHICH of these four N counts.
    - <unassigned_scope> lists declared files that were in NO lane. When it is non-empty you
      MUST NOT report complete coverage: carry the list into review.json::uncovered_scope and
      say so in review.md. Coverage is a claim about the declared scope universe, not about
      the lanes you happened to receive.
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
