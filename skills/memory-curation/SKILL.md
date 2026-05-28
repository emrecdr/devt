---
name: memory-curation
description: Promote any candidate into the unified memory layer at `.devt/memory/` — ephemeral DEC-xxx into permanent ADR-xxx, retro lesson drafts into LES-xxx, rejected ideas into REJ-xxx tombstones, or reviewing `_suggestions.md` proposals from the discovery engine. Trigger on 'promote this decision', 'capture as ADR/Concept/lesson', 'reject this idea, never suggest again', 'create tombstone', 'review memory suggestions', 'curator review', 'archive stale lesson', 'codify this rule', 'this should be permanent'. Single curation skill for ALL 5 doc types (decision, concept, flow, rejected, lesson). HARD INVARIANT — never writes a permanent `.devt/memory/**/*.md` file without explicit user approval via AskUserQuestion.
allowed-tools: Bash Read Write Edit Grep Glob Skill Task
---

# Memory Curation

## Overview

The memory layer at `.devt/memory/` holds permanent architectural rules: ADR (decisions),
CON (concepts), FLOW (processes), REJ (rejected ideas / tombstones). These rules govern
how future agents make decisions across sessions — they are constitutional, not advisory.

Because they are permanent and they shape future agent behavior, **every promotion runs
through human approval**. This skill is the gatekeeper. It reads candidate proposals
from `.devt/memory/_suggestions.md` (produced by the discovery engine), presents each
to the user via `AskUserQuestion` with the full original reasoning, and writes the
permanent markdown ONLY on approval.

This is the **sole** curation skill for the unified `.devt/memory/` layer. It
covers all 5 doc types under one approval flow:

- **architectural rules** — ADR (decisions), CON (concepts), FLOW (process), REJ (tombstones)
- **operational lessons** — LES ("when X happens, do Y") in `.devt/memory/lessons/`

The same 5-filter discipline (Specificity, Durability, Non-obviousness, Evidence,
Actionability) applies across all 5 — the curator agent's `memory: project` persistent
memory carries the running state.

## When to Run It

Trigger on:

- End of `/devt:clarify`, `/devt:specify`, `/devt:research` when the workflow produced
  DEC-xxx entries that look architectural (multi-session relevant, hard-to-reverse,
  high-stakes — meets the same threshold as the council offramp)
- End of `/devt:retro` when retro extracted ADR/Concept/Flow candidates alongside
  operational lessons
- End of `/devt:council` when the chairman's "What Grounded the Verdict" identifies a
  load-bearing decision worth codifying
- Direct user request: `/devt:memory promote DEC-003`, `/devt:memory reject "<idea>"`,
  `/devt:memory suggest` (then review)
- When `_suggestions.md` is non-empty and the user wants to triage

Skip for:

- Per-workflow tentative decisions that won't outlive the session — those stay in
  `.devt/state/decisions.md` ephemeral
- Trivial or single-use choices — promotion criteria below

## Promotion Criteria (the 5-filter)

The 5-filter, applied uniformly to architectural docs (ADR/CON/FLOW/REJ) and operational lessons (LES):

1. **Specificity**: The rule names a specific behavior or constraint, not vague advice.
   ✓ "Use Argon2 for password hashing" / ✗ "Be careful with auth"
2. **Durability**: The rule is expected to govern decisions for ≥3 months. If it might
   change next sprint, it's a session decision, not an ADR.
3. **Non-obviousness**: The rule is not already implied by language idioms, framework
   defaults, or basic security hygiene. ADRs document choices, not common sense.
4. **Evidence**: There is a concrete reason for the rule — past incident, compliance
   requirement, benchmark result, observed pattern. Pure preference is not evidence.
5. **Actionability**: A future agent reading this rule knows what to do (or NOT do)
   without further interpretation.

Candidates failing any filter are rejected at the curator stage — they do not reach
AskUserQuestion. Surface the failure reason in the curation summary so the user knows
why a candidate didn't make the cut.

## The Approval Protocol

### Step 1 — Triage

1. Read `.devt/memory/_suggestions.md` (or take the candidate from the workflow caller).
2. For each proposal:
   - Apply the 5-filter
   - Cross-check against existing memory docs via `node bin/devt-tools.cjs memory query <terms>` — if a duplicate exists, mark as "may need update" instead of "new"
   - Cross-check against REJ tombstones — if one of them suppressed the proposal already, the discovery engine should have filtered it; double-check via `node bin/devt-tools.cjs memory rejected-keywords`
3. Build a short queue of qualified candidates.

### Step 2 — Present each qualified candidate via AskUserQuestion

Before assembling the options, classify the candidate to pre-recommend the right
default status. The classifier inspects the candidate body for tooling-evolving
signal — those candidates describe how an external tool / framework / migration
behaves rather than an opinionated project decision. Promoting them as `active`
locks the project to a third-party detail that may shift in the next release;
`candidate` captures the observation without making it governing. Project
decisions (architecture, security stance, naming conventions) still default to
`active` because that's what the recorded reasoning is actually committing to.

**Tooling-evolving signal — pre-recommend `candidate` when ANY of these match the body:**

1. Names a specific external tool / framework / library with a version constraint
   (e.g., "Hurl 4.1+", "Postgres CONCURRENTLY", "Vue 3.4+", "Node 22 ESM resolver").
2. Describes the BEHAVIOR or PATTERN of an external tool (`how X handles Y`,
   `Z's default is W`, `command X needs flag Y`) rather than a project rule.
3. Lacks opinionated framing — no "we should", "must", "prefer", "always", "never",
   "the project rule is". Descriptive prose ("X happens when Y") signals
   observation, not decision.
4. Title contains `behavior`, `pattern`, `migration`, `syntax`, `quirk`,
   `workaround`, `gotcha`.

**When NO tooling-evolving signal is present** (clear project decision, security
posture, architectural invariant), pre-recommend `active`.

Greenfield calibration #2 finding 7c-7d: "Tooling-related candidates from THIS
session (Hurl scalar predicate behavior, CONCURRENTLY migration pattern) should
likely auto-route to candidate status rather than asking — they're descriptive,
not opinionated." This pre-recommendation moves that judgment up-front so the
user accepts/overrides instead of hunting through five symmetric options.

For each candidate, present (apply the pre-recommendation by putting the
recommended option FIRST with the suffix `(Recommended)` on the label;
descriptions and the other four options unchanged):

```yaml
question: "Promote this {⚖️ decision | 🔵 discovery} to {ADR | CON | FLOW}?"
header: "{short candidate title, ≤12 chars}"
multiSelect: false
options:
  # Pre-recommendation: when tooling-evolving signal present, swap the first two
  # so "Promote (candidate)" leads with the (Recommended) suffix. Otherwise the
  # default order below puts "Promote (active)" first with (Recommended).
  - label: "Promote (active) (Recommended)"  # or "Promote (candidate) (Recommended)" per classifier
    description: "Write {ADR-xxx} to .devt/memory/decisions/ with status: active. Becomes immediately governing for future agent edits."
  - label: "Promote (candidate)"  # or "Promote (active)" per classifier
    description: "Write {ADR-xxx} with status: candidate. Documented but not yet enforcing — promote to active later via the same flow."
  - label: "Reject — capture as REJ tombstone"
    description: "This idea was considered and explicitly NOT chosen. Write to .devt/memory/rejected/ with search_keywords so AI re-proposals are suppressed."
  - label: "Defer"
    description: "Keep the candidate in _suggestions.md; revisit in a later session."
  - label: "Edit before promoting"
    description: "Adjust title, summary, affects_paths, affects_symbols, or links before writing the markdown. Curator will re-prompt with the edited version."
```

When showing the question, INCLUDE the original reasoning verbatim above the options
block — the user must see exactly what was recorded, not a curator paraphrase. Also
include a one-line pre-recommendation rationale ("Pre-recommend `candidate` — body
describes Hurl 4.1+ predicate behavior, not a project rule") so the user can sanity-
check the classifier before accepting.

### Step 3 — Act on the choice

- **Promote (active|candidate)**: Use a `templates/memory/{ADR,CON,FLOW}-template.md` as
  the starting frontmatter. Fill in id (auto-incremented from existing docs), title,
  domain, status, confidence, summary, affects_paths, affects_symbols, links,
  created_at (ISO-8601 now), created_by="curator". Write to the appropriate subdir.
  Then run `node bin/devt-tools.cjs memory index` to update the FTS5 unified index.
- **Reject — REJ tombstone**: Use `templates/memory/REJ-template.md`. CRITICAL — fill
  `search_keywords` with every reasonable phrasing of the rejected idea. The autoskill
  skill consults this list before generating proposals; under-coverage means the AI
  will eventually re-propose this. Run `memory index` after writing.
- **Defer**: No file changes. Note in `.devt/state/curation-summary.md` that the
  candidate was deferred so it doesn't get re-presented immediately.
- **Edit before promoting**: Surface the proposed frontmatter to the user, accept their
  edits, then loop back to AskUserQuestion with the edited version. ONE edit cycle —
  if the user wants a third pass, defer and let them edit the markdown by hand.

### Step 4 — Capture summary

Append to `.devt/state/curation-summary.md` (status: DONE):

```markdown
## Status: DONE

# Memory Curation Summary

Run: <timestamp>

## Promoted
- ADR-007 (security): "Argon2 password hashing" — active, from DEC-003 (clarify session 2026-05-05)
- CON-005 (auth): "Role hierarchy" — candidate

## Rejected as Tombstones
- REJ-002 (security): "Magic link auth" — search_keywords: ["magic link", "passwordless email"]

## Deferred
- 🔵 "Maybe extract a generic rate limiter abstraction" — needs more evidence (only 2 use sites currently)

## Filtered (5-filter rejections)
- ⚖️ "Be careful with payments" — fails Specificity
- 🔵 "Use TypeScript" — fails Non-obviousness (project standard)
```

## Hard Invariants (enforced by the skill body)

1. **No file write without AskUserQuestion approval.** Even for high-confidence candidates,
   the user clicks an option. Curator does not auto-promote — that defeats the
   "permanent rules require human authority" invariant of the entire memory layer.
2. **Original reasoning preserved verbatim in the AskUserQuestion question text.** No
   curator paraphrasing — paraphrase loses fidelity and erodes user trust.
3. **REJ search_keywords are mandatory and exhaustive.** A REJ without keywords cannot
   suppress AI re-proposals; that is its only function.
4. **No bulk auto-approve flag.** Even for batches, present one AskUserQuestion per
   candidate (UI may render them in sequence). Bulk-approve buttons are how rules end
   up in the memory layer that nobody actually agreed to.
5. **Multi-root awareness.** When `memory.paths` is configured (a project that
   indexes shared org-wide ADRs alongside project-local), writes ALWAYS target the
   project-local root (`.devt/memory/`) — never a shared root. Shared roots are read-only
   from the curator's perspective; their maintainers edit those markdown files via their
   own toolchain (e.g., a PR to the shared org-ADR repo). When a candidate's content
   matches an existing shared-root ADR, surface that to the user via AskUserQuestion
   ("ADR-007 already exists in shared root `../org-adrs/` — promote a project-local
   override OR defer?") so the precedence choice is intentional, not silent.
6. **Always run `memory index` after a write.** The FTS5 unified index must mirror the
   markdown source; stale index = stale agent context.

## Anti-patterns

| Anti-pattern | Failure mode | Mitigation |
|---|---|---|
| Curator paraphrases the original reasoning into the AskUserQuestion text | User approves a curator-summarized version that drifts from the recorded reason; future agents read a different rule than the user intended | Quote `body` verbatim from `_suggestions.md` in the question text |
| Curator promotes without AskUserQuestion when "obvious" | Permanent rules accumulate that nobody explicitly chose; trust in the memory layer collapses | Hard invariant: skill body refuses to write without an approval signal |
| Curator skips the 5-filter and presents every candidate | User fatigue → rubber-stamping → bad rules slip through | Filter BEFORE AskUserQuestion; surface filter rejections in the summary |
| REJ tombstone with thin search_keywords | AI re-proposes the rejected idea in a session 2 weeks later under different wording | Curator MUST surface a "Are these keywords exhaustive?" prompt before committing the REJ |
| Curator promotes a duplicate without checking | Two ADRs cover the same rule with different wording — agents see contradictory guidance | Run `memory query` for the proposal's terms before any promote action |

## Output Contract

Per session:

```
.devt/memory/{decisions,concepts,flows,rejected}/<NEW-ID>-<slug>.md   # one per approval
.devt/state/curation-summary.md                                        # session log
.devt/memory/index.db                                                  # rebuilt
```

In-chat: a short summary listing what was promoted, rejected, deferred, filtered.
Reference the curation summary path so the user can audit the run.

## Credit & Lineage

Unified curation skill covering all 5 doc types (ADR/CON/FLOW/REJ/LES) with one
5-filter and one approval flow. The promotion-via-AskUserQuestion pattern is shared
with the council offramp (`references/council-offramp.md` §3.2) — both encode
"discovery automated, action approved" as the core devt invariant for irreversible
state changes.
