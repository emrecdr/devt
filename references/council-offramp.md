# Council Offramp Decision Helper

Reference document used by `/devt:clarify`, `/devt:research`, and `/devt:specify` workflows
to decide **when** to offer the council as a resolution path for an open question, **how**
to present it as one option among several, and **how** to capture the council verdict back
into the calling workflow's primary artifact.

The council is heavyweight (5 advisors + 5 peer reviews + chairman = 11 model dispatches).
Used at the right threshold it pays back many times over — used too readily it becomes
ceremony that fatigues the user and devalues the verdict. This file is the gate.

---

## §1. Threshold (when to offer)

A gray area or open question qualifies for the council offramp **only when ALL three
conditions hold**:

| # | Condition | Concrete check |
|---|---|---|
| 1 | **Multiple viable approaches** with material trade-offs | At least 2 options where each has a real upside (not "X is clearly better but a beginner might pick Y") |
| 2 | **Hard to reverse** | Touches one of: architecture (module boundaries, data flow direction), public API surface, data model / schema, security or permission model, or affects ≥3 downstream call sites |
| 3 | **High stakes** | Affects one of: security posture, performance at scale, data integrity, public contract, or estimated rework cost > 1 day if wrong |

**Decision matrix:**

- All 3 trip → offer the council via the §2 template
- Exactly 2 trip → offer `strategic-analysis` skill instead (lighter — produces a
  trade-off table without the peer-review layer)
- 0-1 trip → present the standard 2-option `AskUserQuestion` and move on

The threshold is intentionally AND (not OR). Council fatigue is the failure mode this
gate guards against.

---

## §2. Offramp Template

When the threshold trips, present the question via `AskUserQuestion` with these options:

```yaml
question: "{the actual decision} — multiple viable approaches with real trade-offs."
header: "Decision: {short title}"
multiSelect: false
options:
  - label: "Pick {Option A} and proceed"
    description: "{one-line summary of A's trade-off profile}"
  - label: "Pick {Option B} and proceed"
    description: "{one-line summary of B's trade-off profile}"
  - label: "Run /devt:council on this decision (~2-3 min, 5 advisors + peer review)"
    description: "Pressure-test through structured adversarial review — best when you suspect your first instinct is biased or the decision is hard to reverse"
  - label: "Defer — capture as open question and continue"
    description: "Note the decision in artifacts and revisit later (sometimes more code clarifies the right call)"
```

The workflow still presents its own recommendation in the option labels — council is the
**escalation**, not the **answer**. Skipping the workflow's own recommendation ("just
council it") is an anti-pattern (see §4).

---

## §3. Council Invocation From Within a Workflow

When the user picks the council option:

1. **Pause the current workflow.** State remains `active=true`, `workflow_type` unchanged.
   Do NOT reset state.

2. **Invoke the council skill** with explicit `validation_material`:

   ```
   Skill(skill="council", args="
     Question: {the framed decision}
     Options under consideration:
     - Option A: {summary + trade-off}
     - Option B: {summary + trade-off}

     Validation material to ground reasoning:
     - .devt/rules/architecture.md
     - .devt/rules/coding-standards.md
     - .devt/rules/golden-rules.md
     {caller-specific paths — see §3.1 below}
   ")
   ```

3. **After council returns**, the transcript lives at
   `.devt/state/council-{slug}-{YYYYMMDD-HHMMSS}.md`. Read it; surface the chairman
   verdict's **The Recommendation** + **The One Thing to Do First** sections directly
   in chat.

4. **Resume the outer workflow** by capturing the verdict per §3.2.

### §3.1 Caller-Specific Validation Material

Each calling workflow passes a different set of artifacts as the validation surface:

| Caller | Additional `validation_material` paths |
|---|---|
| `/devt:clarify` | `.devt/state/decisions.md` (prior decisions in the same session); `.devt/state/research.md` and `.devt/state/spec.md` if upstream workflows ran |
| `/devt:research` | `.devt/state/research.md` (the researcher's findings — the council's primary anchor); `.devt/state/decisions.md` if exists |
| `/devt:specify` | `.devt/state/spec.md` (the in-progress PRD); `.devt/state/research.md` and `.devt/state/decisions.md` if upstream workflows ran |

The council's Stage 1 framing reads each path, tags `EXISTS` / `MISSING`, and passes the
annotated list verbatim into each advisor's "Validation material available" block. Missing
artifacts are not fatal — advisors flag claims as `Unvalidated Concerns` when validation
material is absent.

### §3.2 Capturing the Council Verdict Back Into the Outer Workflow

The council writes its full transcript independently. To make the verdict visible from
the outer workflow's primary artifact, append a reference using the format below:

| Caller | Where to capture | Format |
|---|---|---|
| `/devt:clarify` | New `DEC-xxx` entry in `.devt/state/decisions.md` | `**Decision**: {chairman's One Thing to Do First} **Why**: {one-line synthesis of Recommendation} **Source**: council transcript at .devt/state/{transcript filename}` |
| `/devt:research` | Append `## Council Verdict on {decision}` section to `.devt/state/research.md` | Section body links to transcript and quotes the Recommendation + One Thing to Do First |
| `/devt:specify` | New entry in PRD's `## Decisions` section + DEC-xxx in `.devt/state/decisions.md` | Same DEC-xxx format as clarify, with transcript link |

This keeps the council finding traceable from the calling workflow's main artifact
without duplicating the full transcript inline.

---

## §4. Anti-patterns

| Anti-pattern | Failure mode | Mitigation |
|---|---|---|
| Offering council when only condition 1 trips (multiple options exist but stakes are low) | Council loses signal value; user fatigue | §1 is AND, not OR — all 3 must trip |
| Auto-invoking council without asking | Slow workflows, model burn, removes user agency | Always present as one option via `AskUserQuestion`; user picks |
| Council as a way to avoid forming a recommendation | Agent stops doing its job; council becomes default | Workflows still present their own recommendation in the A/B option labels — council is the *escalation*, not the *answer* |
| Running council on every gray area in a clarify session | Cumulative time blowup (5+ councils in one /devt:clarify = 10-15 minutes) | **Soft cap: at most 1 council per workflow invocation.** If multiple decisions trip the threshold, suggest the user pick the highest-stakes one to council; capture the rest as deferred decisions or strategic-analysis prompts |
| Re-running council on a decision a transcript already exists for | Wasted spend, contradictory verdicts | Before offering, check `.devt/state/council-*.md` for filename matching the decision slug — if found, surface the existing transcript instead of running a new council |
| Passing no `validation_material` array | Advisors fall back to general engineering reasoning instead of grounding in this codebase | Always pass at least the three `.devt/rules/*.md` files; add caller-specific paths per §3.1 |

---

## §5. When Council Is Wrong For The Question (Use Strategic-Analysis Instead)

Two scenarios where the council is the wrong tool even when condition 1 trips:

1. **The user just wants two named options compared in a table.** No suspicion of bias,
   no "I can't decide" — just wants the trade-offs laid out. Use `strategic-analysis`;
   it produces the table without the 11-dispatch peer review overhead.

2. **The decision is contested but well-researched.** A research session already produced
   a clear recommendation, the user trusts it, but wants a single sanity-check pass.
   Use `strategic-analysis` to validate; only escalate to council if the strategic-analysis
   pass surfaces a genuine concern.

In both cases the council remains available as a follow-up — strategic-analysis is the
cheaper first step.
