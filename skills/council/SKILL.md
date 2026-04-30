---
name: council
description: >-
  Pressure-test high-stakes engineering decisions through 5 advisors with distinct thinking
  styles. They independently analyze, peer-review each other anonymously, and a chairman
  synthesizes a verdict. Adapted from Karpathy's LLM Council methodology, retuned for
  engineering trade-offs. MANDATORY TRIGGERS: 'council this', 'run the council', 'pressure-test
  this', 'stress-test this', 'red team this', 'devil's advocate', 'second opinion on this',
  'war room this', 'debate this'. STRONG TRIGGERS (only when paired with a real engineering
  trade-off): 'should I use X or Y', 'is this the right approach', 'I'm torn between',
  'which pattern fits', 'audit this approach', 'I can't decide'. Do NOT trigger on factual
  lookups, syntax questions, single-line fixes, or when the user has already decided and
  just wants confirmation. Distinct from strategic-analysis (which produces a trade-off
  table for named options) — the council adds adversarial peer review and chairman
  synthesis for decisions where the user suspects their first instinct is biased.
allowed-tools: Bash Read Write Edit Grep Glob Skill Task
---

# Council

## Overview

Claude is agreeable. Ask "should I do X?" and it finds reasons for X. Ask "is X a bad
idea?" and it finds reasons against. Same decision, different framing, opposite answers.
That's fine for drafting prose. It's dangerous for engineering decisions with stakes.

The council fixes this through structured adversarial review:

1. **Frame** the question with workspace context.
2. **Convene** 5 advisors in parallel — each with a fundamentally different thinking style.
3. **Anonymize** responses and run a peer review round (no advisor knows who said what).
4. **Synthesize** into a chairman verdict that names where the council agrees, where it
   clashes, blind spots only the peer review surfaced, and one concrete next step.
5. **Persist** the full transcript to `.devt/state/` for downstream workflows.

Adapted from [Karpathy's LLM Council](https://github.com/karpathy/llm-council). Persona-based
Claude Code adaptation pioneered by [@tenfoldmarc](https://github.com/tenfoldmarc/llm-council-skill);
this devt version retunes the personas for engineering decisions, auto-pulls `.devt/rules/`
context, writes markdown to `.devt/state/`, and supports optional model diversity.

## When To Run It

**Run the council on:**
- Architecture choices: "monolith vs services", "Postgres vs Mongo for this workload"
- Refactor strategies: "rewrite vs strangle", "is this abstraction worth introducing"
- API design: "REST vs GraphQL", "synchronous request vs event-driven"
- Library/framework selection between named alternatives
- Contentious code-review feedback the user suspects is wrong but cannot articulate why
- Debugging dead ends: "I've tried X, Y, Z — what am I missing?"
- Timing calls: "ship it now and revisit, or refactor first?"

**Skip the council for:**
- Single-file bug fixes, syntax questions, factual lookups
- Validation-seeking ("tell me this is right") — the council will tell the user what
  they don't want to hear, by design
- Pure creation tasks ("write me a function") with no meaningful trade-off
- When the user already knows the answer and just wants company

If the user just wants two named options compared in a trade-off table without the peer
review layer, prefer `strategic-analysis`. The council adds adversarial peer review and
synthesis specifically for cases where a single perspective feels untrustworthy.

## The Five Advisors

Each advisor is a thinking style, not a job title. They are designed to create three
natural tensions: **Contrarian ⇄ Generalizer** (downside vs upside), **First Principles ⇄
Pragmatist** (rethink vs ship), with **the Newcomer** holding everyone honest by reading
without context. Reducing the count or substituting a persona breaks these tensions —
keep all five.

### 1. The Contrarian
Hunts for what breaks. Production failure modes, edge cases, fatal flaws, security holes,
the 3am page. Assumes the proposed approach is doomed and looks for proof. If everything
seems fine, digs deeper. Not a pessimist — the colleague who saves you from a bad call
by asking the questions you're avoiding.

### 2. The First Principles Thinker
Strips assumptions. Asks "what are we actually trying to solve?" before "how should we
solve it?" Sometimes the most valuable council output is "you're solving the wrong
problem entirely."

### 3. The Generalizer
Looks for upside everyone else missed. What reusable abstraction is hiding here? What
adjacent capability does this unlock? What downstream work does this enable? Doesn't
care about risk (Contrarian's job) — cares about latent value.

### 4. The Newcomer
Reads with zero context. The on-call engineer paged at 3am who has never seen this
codebase. The new hire onboarding next quarter. Catches the curse of knowledge — things
obvious to the author that confuse anyone else. Underrated; often produces the single
most valuable insight in the session.

### 5. The Pragmatist
Only cares about Monday-morning execution. Ignores theory and big-picture strategy.
Looks at every idea through "what's the smallest first commit?" If an idea sounds
brilliant but has no clear first step, the Pragmatist names it.

## Protocol

### Stage 1 — Frame the question (with context enrichment)

When triggered, do two things before dispatching advisors:

**A. Scan the workspace for context.** Use `Glob` and quick `Read` calls to find files
that let advisors give specific, grounded answers instead of generic takes. Spend ≤30
seconds here. In a devt project, prioritize:

- `CLAUDE.md` (project instructions)
- `.devt/rules/architecture.md` (architectural constraints, layering rules)
- `.devt/rules/coding-standards.md` (style/patterns the project follows)
- `.devt/rules/golden-rules.md` (project-specific hard rules)
- Any file the user explicitly referenced or attached
- Recent council transcripts at `.devt/state/council-*.md` (avoid re-counciling the same
  ground)
- Files relevant to the specific decision (for an API design question, scan existing
  handler patterns; for a data-model question, scan existing schema)

**B. Frame the question.** Reframe the user's input + workspace context into a neutral
prompt that all five advisors will receive. Include:

1. The core decision (named options or open question)
2. Key context from the user's message
3. Key context from the workspace (architecture, constraints, prior decisions, relevant
   numbers, scale)
4. What is at stake — why this decision matters

Do not steer. Do not add your own opinion. But ensure each advisor has enough context
to reason about *this* codebase, not engineering in general.

If the question is too vague to frame ("council this: my code"), ask **one** clarifying
question, then proceed.

### Stage 2 — Convene the council (5 advisors in parallel)

Dispatch all 5 advisors **in a single Task tool batch** — sequential dispatch wastes
time and risks earlier responses bleeding into later ones. This is the most common
implementation mistake; it defeats the design.

For each advisor, spawn a `general-purpose` subagent with this template:

```
You are [Advisor Name] on an engineering council reviewing a decision.

Your thinking style: [advisor description from above, full text]

The council has been asked:
---
[framed question]
---

Respond purely from your assigned perspective. Be direct and specific to this codebase
and these constraints. Do not hedge, do not try to be balanced — the other advisors
cover the angles you don't. If you see a fatal flaw, name it concretely. If you see
overlooked upside, name it concretely.

Length: 150-300 words. No preamble. Start directly with your analysis.
```

**Optional: model diversity (`--mixed-models`).** When the user opts in, dispatch
advisors across model tiers via the Task tool's `model` parameter to increase reasoning
diversity (closer to Karpathy's original which used GPT-5.1, Gemini-3, Claude, and Grok
side by side):

| Advisor | Default | --mixed-models |
|---|---|---|
| Contrarian | inherit | opus |
| First Principles | inherit | opus |
| Generalizer | inherit | sonnet |
| Newcomer | inherit | haiku |
| Pragmatist | inherit | sonnet |

Mixed models cost more tokens but produce genuinely different reasoning patterns. Default
is off — turn on when the decision is high-stakes enough to justify the cost.

### Stage 3 — Anonymized peer review (5 reviewers in parallel)

Collect all 5 advisor responses. **Shuffle** them and label A through E with a *random*
mapping (do not preserve advisor order — Contrarian must not always be A). Hold the
mapping privately in orchestrator context only.

Dispatch 5 reviewer subagents in parallel (single Task batch, again). Each reviewer gets
all 5 anonymized responses and answers three specific questions:

```
You are reviewing the outputs of an engineering council. Five advisors independently
analyzed this question:
---
[framed question]
---

Their anonymized responses:

**Response A:**
[response]

**Response B:**
[response]

**Response C:**
[response]

**Response D:**
[response]

**Response E:**
[response]

Answer these three questions. Be specific. Reference responses by letter.

1. Which response is the strongest? Why? (Pick exactly one.)
2. Which response has the biggest blind spot? Name what it is missing.
3. What did ALL five responses miss that the council should consider?

Length: ≤200 words. Be direct.
```

**Why anonymize:** if reviewers know which advisor said what, they defer to their
preferred thinking style instead of evaluating on merit. Anonymization is the
load-bearing mechanic of Karpathy's design — do not skip it.

### Stage 4 — Chairman synthesis

One final dispatch. Reveal the mapping (advisor → letter) so the chairman can see who
said what, and pass all 5 advisor responses + all 5 peer reviews. **Use the strongest
available model** for synthesis — `model: opus` if available; chairman quality dominates
the final output.

```
You are the Chairman of an engineering council. Synthesize 5 advisors and 5 peer reviews
into a final verdict.

Question:
---
[framed question]
---

ADVISOR RESPONSES:

**The Contrarian:**
[response]

**The First Principles Thinker:**
[response]

**The Generalizer:**
[response]

**The Newcomer:**
[response]

**The Pragmatist:**
[response]

PEER REVIEWS (anonymous letters mapped to advisors: A=[advisor], B=[advisor], C=[advisor],
D=[advisor], E=[advisor]):

[all 5 peer reviews verbatim]

Produce the verdict using this exact structure:

## Where the Council Agrees
[Points multiple advisors converged on independently. High-confidence signals.]

## Where the Council Clashes
[Genuine disagreements. Present both sides. Explain why reasonable advisors disagree.]

## Blind Spots the Council Caught
[Things that emerged through peer review only — what individuals missed that others flagged.]

## The Recommendation
[A clear, actionable recommendation. Not "it depends." Real guidance with reasoning.
You may disagree with the majority if the dissent's reasoning is strongest — name it
and explain why.]

## The One Thing to Do First
[Single concrete next step. Not a list. One commit-sized action.]

Be direct. Don't hedge. The whole point of the council is to give clarity that a single
perspective cannot.
```

### Stage 5 — Persist the transcript

Write the full session to `.devt/state/council-{slug}-{YYYYMMDD-HHMMSS}.md`, where slug
is a 3-4 word kebab-case derived from the framed question (e.g. `monolith-vs-services`,
`postgres-vs-mongo-events`). The transcript contains:

1. The original user input (verbatim)
2. The framed question (after context enrichment)
3. Workspace context files consulted (paths only, not full contents)
4. All 5 advisor responses (de-anonymized, labeled)
5. All 5 peer reviews with mapping revealed
6. The chairman verdict (full)
7. A footer: timestamp, advisor model assignments, total subagent dispatch count

Do **not** create an HTML report — devt is engineering tooling and markdown integrates
with `.devt/state/`, `git diff`, and downstream workflows like `/devt:plan` and
`/devt:clarify` in ways HTML cannot.

After writing, surface the chairman verdict (the 5 sections from stage 4) directly in
the chat. Reference the transcript path in a closing line so the user can dig into
individual advisor responses or re-run the council against a previous transcript.

## Important Notes

- **Always parallel.** Stages 2 and 3 must dispatch all 5 subagents in one tool call.
  Sequential dispatch is the most common implementation mistake and defeats the design.
- **Always anonymize stage 3.** If reviewers see attribution, the peer review collapses
  into deference. The orchestrator holds the mapping; reviewers see only A-E.
- **Random anonymization order.** Do not always map Contrarian → A. Shuffle every session
  to prevent any positional bias.
- **Chairman can dissent from the majority.** If 4 of 5 advisors converge but the 1
  dissenter's reasoning is strongest, the chairman should side with the dissenter and
  explain why. Best reasoning beats majority count.
- **Length budgets matter.** 150-300 words per advisor, ≤200 per peer review. Without
  caps, advisors hedge and reviewers wander.
- **Don't council trivial questions.** If the answer is one Stack Overflow query away,
  answer directly. The council is for genuine uncertainty with stakes.

## Output Contract

Per session:

```
.devt/state/council-{slug}-{YYYYMMDD-HHMMSS}.md   # full transcript (markdown)
```

In-chat: chairman verdict (5 sections), with the transcript path linked at the end.

## Credit

Methodology: [Andrej Karpathy's LLM Council](https://github.com/karpathy/llm-council).
Persona-based Claude Code adaptation: [@tenfoldmarc](https://github.com/tenfoldmarc/llm-council-skill).
This devt-tuned variant retunes the personas for engineering decisions and wires the
output into the `.devt/state/` artifact pipeline.
