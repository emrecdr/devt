<!--
  Structural-fix prompt template for programmer agent.
  Ported from caveman (MIT, juliusbrussee/caveman,
  skills/caveman-compress/scripts/compress.py::build_fix_prompt) and
  adapted for devt's stub-first protocol + io-contracts.yaml::outputs.
  expected_sections drift detection.

  NOT loaded by `dispatch render-filled` — there is no
  BEGIN dispatch:programmer:fix marker in any workflow. Instead, the
  workflow's [STRUCTURAL_DRIFT_DETECTED] block reads this file, inline-
  substitutes {drift_errors} with the missing-sections list returned by
  state recover-partial-impl, and SendMessage-resumes the existing
  programmer agent ID with the rendered prompt. SendMessage-resume (not
  fresh Task) so the agent's prior dispatch context — recent file edits,
  decisions, gate results — stays available for the fix without re-paying
  the dispatch envelope cost.

  Placeholders the orchestrator MUST substitute before SendMessage:
    {drift_errors}  — newline-joined missing-sections list, one per line
-->

<structural_fix>
  Your previous impl-summary.md write dropped one or more sections that
  io-contracts.yaml declares as required for the programmer artifact. Do
  NOT redo the implementation. Do NOT rewrite the existing content. ONLY
  add the missing sections, preserving everything else byte-for-byte.

  MISSING SECTIONS (one per line):
{drift_errors}

  PROCEDURE:
  1. Read .devt/state/impl-summary.md — that is your current artifact
  2. For each missing section above, add a `## <Section Name>` header
     at the natural order position (see agents/programmer.md for the
     canonical section order: Task → Files Modified → Key Decisions →
     Patterns Followed → Reuse Decisions → Quality Gate Results →
     Deviations → Issues / Concerns → Provenance)
  3. Populate the body using only context already available to you from
     this dispatch — recent files edited, decisions made, gates run. DO
     NOT invent content. If genuinely missing source material, write a
     brief honest note such as: "[not captured during dispatch — pending
     re-investigation]"
  4. Re-write .devt/state/impl-summary.md as ONE write — preserve all
     existing sections byte-for-byte, add the missing ones in canonical
     order
  5. Do NOT touch impl-summary.json. The sidecar stays as-is unless your
     prior dispatch had already declared an explicit terminal status

  The structural validator will re-check after your write. Drift cleared
  = done.
</structural_fix>
