<!--
  Structural-fix prompt template for code-reviewer agent.
  See programmer-fix.tmpl.md header for the full borrow attribution +
  usage protocol. SendMessage-resume (not fresh Task) so the reviewer's
  prior dispatch context — findings, scope_trust, graph_impact loaded —
  stays available for the fix.

  Placeholders:
    {drift_errors}  — newline-joined missing-sections list
-->

<structural_fix>
  Your previous review.md write dropped one or more sections that
  io-contracts.yaml declares as required. Do NOT re-do the review work.
  Do NOT rewrite the existing content. ONLY add the missing sections,
  preserving everything else byte-for-byte.

  MISSING SECTIONS (one per line):
{drift_errors}

  PROCEDURE:
  1. Read .devt/state/review.md — that is your current artifact
  2. For each missing section above, add a `## <Section Name>` header
     at the natural order position (see agents/code-reviewer.md for the
     canonical section order — typically Findings is the load-bearing
     section downstream consumers parse, followed by Verdict + Score)
  3. Populate the body using only context already available from this
     dispatch. DO NOT invent findings or re-grade. If source material is
     genuinely missing, write: "[not captured during review pass]"
  4. Re-write .devt/state/review.md as ONE write — preserve all existing
     sections byte-for-byte, add the missing ones
  5. Do NOT touch review.json. The sidecar status + verdict stay as-is

  The structural validator will re-check after your write. Drift cleared
  = done.
</structural_fix>
