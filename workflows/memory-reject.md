# Memory Reject — Capture a REJ Tombstone

Workflow that captures a user's rejection of an idea as a permanent REJ tombstone in
`.devt/memory/rejected/`. The tombstone's `search_keywords` field is consulted by
autoskill and the discovery engine before any AI proposal is generated —
suppressing re-proposals of the rejected idea forever.

<purpose>
"AI nagging" is a well-known failure mode of automated suggestion systems: the user
rejects an idea, then 30 minutes later the AI re-proposes the same idea under slightly
different wording. REJ tombstones solve this by recording WHAT was rejected (verbatim
+ search keywords), WHY (the reason field), and WHO rejected it.

This workflow runs through the curator's AskUserQuestion flow to ensure the keyword
list is exhaustive — under-coverage is the only way a tombstone fails.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set
- `.devt/memory/` exists
- The user provided a rejection statement (the idea + reason), either as a command
  argument OR via an AskUserQuestion from a calling workflow (e.g. clarify can offer
  "Reject as REJ tombstone" as one option when the user dismisses a DEC)
</prerequisites>

<available_agent_types>
- devt:curator — handles tombstone capture via the memory-curation skill
</available_agent_types>

<deviation_rules>
1. **STOP: vague rejection** — If the user's statement is too vague to extract reliable search_keywords ("don't do that"), prompt for specifics before proceeding.
2. **STOP: duplicate REJ** — If `memory query` finds an existing REJ with overlapping keywords, surface it and ask whether to extend the existing tombstone instead.
3. **Auto-fix: missing index** — If the FTS5 index is missing, run `memory index` first.
</deviation_rules>

<process>

<step name="init" gate="rejection statement captured">
## Step 1: Capture the rejection

Parse the user's input. Required fields:

- **Title**: short rejection name (e.g. "Magic link auth")
- **Body**: detailed reason (the original proposal + WHY it was rejected)
- **Reason category**: user_preference | performance | security | maintainability | compliance | complexity

If any field is unclear, AskUserQuestion to clarify before continuing.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" init workflow
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=true workflow_type=memory_reject phase=context_init status=IN_PROGRESS stopped_at=null stopped_phase=null verdict=null repair=null verify_iteration=0 resume_context=null "task=Capture REJ tombstone"
```
</step>

<step name="dispatch" gate="curator returns curation-summary with REJ id">
## Step 2: Dispatch curator for the keyword-completeness review

```
Task(subagent_type="devt:curator", model="{models.curator}", prompt="
<context>
Title: ${TITLE}
Body: ${BODY}
Reason: ${REASON}
</context>
<task>
Capture a REJ tombstone with the user's rejection. Apply the memory-curation skill's
REJ-specific protocol:

1. Take the user's rejection title + body + reason category as input.
2. PROPOSE a search_keywords list — every reasonable phrasing of the rejected idea.
   Brainstorm broadly: technical synonyms, library names, pattern names, common slang.
3. AskUserQuestion: 'Are these search_keywords exhaustive? They will suppress AI
   re-proposals of this idea — under-coverage means the AI eventually re-proposes.'
   Show the proposed list. Options: Approve | Add more | Edit and re-propose.
4. ONLY on user approval, write .devt/memory/rejected/REJ-NNN-<slug>.md using
   templates/memory/REJ-template.md.
5. Run `node bin/devt-tools.cjs memory index` to update the unified FTS5 index.

CRITICAL: Search_keywords MUST cover every reasonable rephrasing. The user must
explicitly approve the list. Without this gate, REJs become useless tombstones.
</task>
Write summary to .devt/state/curation-summary.md (status: DONE)
Output the new REJ-id and the absolute path of the written file.
")
```

**Claim-check (Q11)**: mechanically verify the curator wrote its declared output:

```bash
ARTIFACT_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state assert-artifact-present curator)
if [ "$(printf '%s\n' "$ARTIFACT_CHECK" | jq -r '.ok')" != "true" ]; then
  echo "[BLOCKED] devt: $(printf '%s\n' "$ARTIFACT_CHECK" | jq -r '.reason')"
fi
```

Gate: Read `.devt/state/curation-summary.md`. Status must be DONE.
</step>

<step name="reindex" gate="REJ keyword now in index">
## Step 3: Rebuild the index

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" memory index
```

The unified `documents_fts` table is rebuilt with the new REJ doc, and the
`rejected_keywords` table picks up the new entries — these are queried by autoskill,
the discovery engine, and (in Phase 3) the council validation_material before any
proposal is generated.
</step>

<step name="report">
## Step 4: Report

Surface to the user:
- New REJ-id and file path
- The full search_keywords list (so the user remembers what's now suppressed)
- A reminder: "Future agent proposals containing any of these phrases will be
  silently filtered. Run `/devt:memory get REJ-NNN` to view or `/devt:memory
  rejected-keywords` to list all tombstones."

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state update active=false phase=complete status=DONE
```
</step>

</process>

<success_criteria>
- A new file exists at `.devt/memory/rejected/REJ-NNN-<slug>.md` with the correct frontmatter (id, doc_type=rejected, status=rejected, reason, search_keywords)
- The unified FTS5 index reflects the new REJ
- `.devt/state/curation-summary.md` has Status: DONE
- The user explicitly approved the search_keywords list (NOT auto-generated)
- `node bin/devt-tools.cjs memory rejected-keywords` returns the new entries
</success_criteria>
