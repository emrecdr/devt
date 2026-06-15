# Docs Extraction Workflow

Standalone documentation refresh: dispatch the docs-writer agent to update project docs based on whatever state artifacts are present, OR on recent git changes when no workflow artifacts are available.

Use when: a workflow has already closed but docs weren't updated; after a refactor; after merging a feature; when the codebase has drifted from its README/docstrings.

---

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- At least one of the following exists:
  - `.devt/state/` with workflow artifacts (impl-summary.md, test-summary.md, review.md, etc.)
  - Active session context with observable changes
  - Recent git activity on the current branch
</prerequisites>

<available_agent_types>
The following agent types are used in this workflow:

- `devt:docs-writer` — documentation specialist (Read, Write, Edit, Bash, Glob, Grep)

Not used in this workflow: every other `devt:*` agent type (programmer, tester, code-reviewer, architect, verifier, retro, curator, researcher, debugger). This is a single-agent workflow by design — see `workflows/lesson-extraction.md` for the multi-agent retro counterpart.
</available_agent_types>

<agent_skill_injection>
Before dispatching the docs-writer agent, check `.devt/config.json` for an `agent_skills` configuration block:

```json
{
  "agent_skills": {
    "docs-writer": ["doc-coauthoring"]
  }
}
```

If `agent_skills.docs-writer` exists, inject the skill references into the agent's prompt context:

```
<agent_skills>
  Load and follow these skill protocols before starting work:
  - ${CLAUDE_PLUGIN_ROOT}/skills/<skill_name>/  (for each skill listed)
</agent_skills>
```

If not configured, omit the block.
</agent_skill_injection>

---

## Steps

Track state so `/devt:status` and `/devt:next` can detect and resume interrupted docs runs:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=docs phase=docs status=IN_PROGRESS stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null
```

<step name="gather_context" gate="artifacts and recent changes are identified">

Identify available signals in this priority order:

1. **Workflow artifacts** (preferred — most recent task context):
   - `.devt/state/impl-summary.md`
   - `.devt/state/test-summary.md`
   - `.devt/state/review.md`
   - `.devt/state/arch-review.md`
   - `.devt/state/spec.md`

2. **Recent git activity** (when artifacts are absent — derives the change set):
   ```bash
   git log --pretty=format:'%h %s' -10 2>/dev/null
   git diff --stat HEAD~5..HEAD 2>/dev/null | head -20
   ```

3. **Existing documentation surfaces**:
   - `README.md`, `CLAUDE.md`
   - `docs/` directory (if present)
   - Module-level READMEs in feature directories

List which signals are present. If both 1 and 2 are absent, the docs-writer will work from session context.

</step>

<step name="dispatch_docs_writer" gate="docs-summary.md is written to .devt/state/">

Dispatch the docs-writer agent. The dispatch envelope is rendered by `dispatch.cjs compile --write` so it stays consistent with the in-workflow variant:

<!-- BEGIN dispatch:docs-writer:docs -->
<!-- EDIT-SOURCE: templates/dispatch/envelopes/docs-writer-docs.tmpl.md -->
Task(subagent_type="devt:docs-writer", model="{models.docs-writer}", prompt="
  <context>
    <files_to_read>.devt/rules/documentation.md (if exists), CLAUDE.md, README.md (if exists)</files_to_read>
    <impl_summary>Read .devt/state/impl-summary.md (if exists)</impl_summary>
    <test_summary>Read .devt/state/test-summary.md (if exists)</test_summary>
    <review>Read .devt/state/review.md (if exists)</review>
    <spec>Read .devt/state/spec.md (if exists)</spec>
    <recent_changes>If no state artifacts above are present, derive the change set from `git log --pretty=format:'%h %s' -20` and `git diff --stat HEAD~10..HEAD`. Read the actual diff for any file the log suggests has a docs-relevant change.</recent_changes>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Update project documentation to reflect recent changes.

    Standalone mode rules:
    - Update existing docs — do not create parallel documentation.
    - Delete documentation for any removed features.
    - When no state artifacts exist, work from the git change set as the source of truth.
    - Report explicitly when documentation is already accurate (no-op is a valid outcome).

    Scope:
    - Update READMEs to reflect new/removed features, install steps, configuration keys.
    - Update docstrings or rustdoc/TSDoc/godoc comments for changed public APIs.
    - Update CHANGELOG.md when a new release is being prepared (skip otherwise).
    - Update docs/* for any architectural changes referenced.
  </task>
  Write summary to .devt/state/docs-summary.md
")
<!-- END dispatch:docs-writer:docs -->

</step>

<step name="layer1_claim_check" gate="docs-writer's artifact is present and substantive">

Layer-1 mechanical claim-check. Verifies the docs-writer agent's declared primary output actually exists:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present docs-writer
```

When this returns `ok:false`, the docs-writer dispatch failed to produce `.devt/state/docs-summary.md`. Surface the failure and re-dispatch (or escalate to the user). The Layer-2 finalize gate `assert-claim-checks-resolved` reads the persisted Layer-1 records and blocks finalize if any agent's latest record is a failure.

</step>

<step name="finalize" gate="workflow.yaml::active=false">

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state advance-phase complete status=DONE active=false verdict=PASS
```

Surface the docs-summary.md path to the user along with a brief one-line summary of what was updated. If the docs-writer reported "documentation already accurate" as the outcome, surface that explicitly so the user knows the docs-writer ran but no edits were needed.

</step>
