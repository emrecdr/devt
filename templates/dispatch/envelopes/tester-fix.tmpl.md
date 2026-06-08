<!--
  Structural-fix prompt template for tester agent.
  See programmer-fix.tmpl.md header for the full borrow attribution +
  usage protocol. SendMessage-resume (not fresh Task) so the tester's
  prior test-writing context + sidecar already written stay available.

  Placeholders:
    {drift_errors}  — newline-joined missing-sections list
-->

<structural_fix>
  Your previous test-summary.md write dropped one or more sections that
  io-contracts.yaml declares as required. Do NOT re-run the tests. Do
  NOT rewrite the existing content. ONLY add the missing sections,
  preserving everything else byte-for-byte.

  MISSING SECTIONS (one per line):
{drift_errors}

  PROCEDURE:
  1. Read .devt/state/test-summary.md — that is your current artifact
  2. For each missing section above, add a `## <Section Name>` header
     at the natural order position (see agents/tester.md — Coverage →
     Test Files → Scenario Coverage → Mocking Strategy → Quality Gate
     Results → Gaps / Concerns → Provenance)
  3. Populate the body using only context already available from this
     dispatch. DO NOT invent test counts or re-summarize results. If
     source material is missing, write: "[not captured during test pass]"
  4. Re-write .devt/state/test-summary.md as ONE write — preserve all
     existing sections byte-for-byte
  5. Do NOT touch test-summary.json. The sidecar status + verdict stay
     as-is

  The structural validator will re-check after your write. Drift cleared
  = done.
</structural_fix>
