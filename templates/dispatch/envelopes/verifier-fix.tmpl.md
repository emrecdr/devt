<!--
  Structural-fix prompt template for verifier agent.
  See programmer-fix.tmpl.md header for the full borrow attribution +
  usage protocol. SendMessage-resume (not fresh Task) so the verifier's
  prior rubric context + sidecar already written stay available.

  Placeholders:
    {drift_errors}  — newline-joined missing-sections list
-->

<structural_fix>
  Your previous verification.md write dropped one or more sections that
  io-contracts.yaml declares as required. Do NOT re-run the verification
  rubric. Do NOT rewrite the existing content. ONLY add the missing
  sections, preserving everything else byte-for-byte.

  MISSING SECTIONS (one per line):
{drift_errors}

  PROCEDURE:
  1. Read .devt/state/verification.md — that is your current artifact
  2. For each missing section above, add a `## <Section Name>` header
     at the natural order position (see agents/verifier.md — Task →
     Acceptance Criteria → Quality Gates → Artifact Consistency → Summary,
     with Gaps / Failures / Deferred only present when the verdict is
     GAPS_FOUND / FAILED / contains deferred work)
  3. Populate the body using only context already available from this
     dispatch. DO NOT re-grade or invent gap entries. If source material
     is missing, write: "[not captured during verification pass]"
  4. Re-write .devt/state/verification.md as ONE write — preserve all
     existing sections byte-for-byte
  5. Do NOT touch verification.json. The sidecar verdict + revisions[]
     stay as-is — those are the canonical re-dispatch contract

  The structural validator will re-check after your write. Drift cleared
  = done.
</structural_fix>
