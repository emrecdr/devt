# Questioning Guide

How to interview users for requirements and design decisions. Read this before `/devt:specify` and `/devt:clarify` sessions.

---

## The Goal

By the end of questioning, you need enough clarity for downstream phases to act:

- **Plan** needs: clear requirements to break into tasks, context for implementation choices
- **Implement** needs: success criteria to verify against, the "why" behind requirements
- **Verify** needs: observable outcomes to check, scope boundaries to enforce

A vague spec forces every downstream agent to guess. The cost compounds.

---

## Philosophy

**You are a thinking partner, not an interviewer.**

The user often has a fuzzy idea. Your job is to help them sharpen it. Ask questions that make them think "oh, I hadn't considered that" or "yes, that's exactly what I mean."

Don't interrogate. Collaborate. Don't follow a script. Follow the thread.

---

## Before You Ask

Every question costs the user time. Before asking, ask yourself: **can this be answered by reading the codebase?** If yes — `grep`, `Read`, or invoke `memory query` instead. Only ask about decisions that genuinely require user judgment (preferences, constraints not in the code, domain choices, scope boundaries).

**Examples — DON'T ask:**
- "What's the existing test framework?" → grep `package.json` / `pyproject.toml`
- "Is there an existing `X` function?" → grep
- "What do other modules do here?" → Read adjacent files
- "Which doc types does the memory layer support?" → Read `bin/modules/memory.cjs::DOC_TYPES`
- "What's the current test count?" → run smoke

**Examples — DO ask:**
- "Should this be visible to all users or admin-only?"
- "Do you want backward compatibility with existing data?"
- "Which of these 2 valid approaches matches your team's intent?"
- "Is this a hard requirement or a nice-to-have?"

A question the codebase could have answered is a question that wasted a turn.

---

## How to Question

**Start open.** Let them dump their mental model. Don't interrupt with structure.

**Follow energy.** Whatever they emphasized, dig into that. What excited them? What problem sparked this?

**Challenge vagueness.** Never accept fuzzy answers. "Good" means what? "Users" means who? "Simple" means how?

**Make the abstract concrete.** "Walk me through using this." "What does that actually look like?"

**Clarify ambiguity.** "When you say Z, do you mean A or B?" "You mentioned X — tell me more."

**Know when to stop.** When you understand what they want, why they want it, who it's for, and what done looks like — offer to proceed.

---

## Question Types

Use as inspiration, not a checklist. Pick what's relevant.

**Motivation — why this exists:**
- "What prompted this?"
- "What are you doing today that this replaces?"
- "What would you do if this existed?"

**Concreteness — what it actually is:**
- "Walk me through using this"
- "You said X — what does that actually look like?"
- "Give me an example"

**Clarification — what they mean:**
- "When you say Z, do you mean A or B?"
- "You mentioned X — tell me more about that"

**Success — how you'll know it's working:**
- "How will you know this is working?"
- "What does done look like?"

---

## Walk the Decision Tree

When multiple gray areas exist, they often have dependencies — the answer to one constrains the options for another. Map them mentally before asking:

1. **Identify root decisions** — the choices that cascade into others (e.g., "is this a CLI tool or a daemon?" gates almost everything else).
2. **Walk depth-first** — resolve roots first, then their dependents.
3. **Cut subtrees** — if a root answer eliminates a branch entirely, don't ask the dependents in that branch.

This prevents contradictions where Q3's answer invalidates Q1's framing. It also keeps the user's cognitive load minimal — they're never asked about a sub-branch that won't apply.

**Example:** A task "add caching to the API" has these gray areas:
- (root) In-memory vs distributed cache?
- (dependent on root=in-memory) LRU or TTL eviction?
- (dependent on root=distributed) Redis or Memcached?
- (independent) Cache invalidation on writes?

Ask the root first. The answer cuts one of the two dependent branches entirely.

---

## Using AskUserQuestion

### One at a Time

AskUserQuestion supports 1-4 questions per call. **Use one.** Each answer reframes the next question's options dynamically; batched questions get stale (Q2's options may not make sense after Q1's answer changes the context). Sequencing is itself a feature — it lets you adapt.

**Exception:** when 2-4 questions are genuinely independent (no dependency between them), batching is fine. When in doubt, ask one at a time.

### Recommendation Required

Every option must carry validated reasoning in its `description` — concrete why grounded in evidence (codebase patterns, prior conversation context, trade-off analysis, risk assessment), not bare preference. Mark the recommended option with "(Recommended)" in the label and place it FIRST in the options array.

### Options

**Good options:**
- Interpretations of what they might mean
- Specific examples to confirm or deny
- Concrete choices that reveal priorities
- 2-4 options max

**Bad options:**
- Generic categories ("Technical", "Business", "Other")
- Leading options that presume an answer
- More than 4 options
- Headers longer than 12 characters

**Example — vague answer:**
User says "it should be fast"
- header: "Fast"
- question: "Fast how?"
- options: ["Sub-second response", "Handles large datasets", "Quick to build", "Let me explain"]

**Example — following a thread:**
User mentions "frustrated with current tools"
- header: "Frustration"
- question: "What specifically frustrates you?"
- options: ["Too many clicks", "Missing features", "Unreliable", "Let me explain"]

**Tip — modifying an option:** Users can select "Other" and reference by number: `#1 but only for admin users` or `#2 with pagination`. This avoids retyping.

### Freeform Rule

**When the user wants to explain freely, STOP using AskUserQuestion.**

If they select "Other" and their response signals they want to describe something in their own words (e.g., "let me describe it", "I'll explain", or any open-ended reply):

1. Ask your follow-up as **plain text** — NOT via AskUserQuestion
2. Wait for them to type at the normal prompt
3. Resume AskUserQuestion only after processing their freeform response

**Wrong:** User says "let me describe it" → AskUserQuestion("What feature?", ["Feature A", "Feature B"])
**Right:** User says "let me describe it" → "Go ahead — what are you thinking?"

---

## Context Checklist

Check these mentally as you go. If gaps remain, weave questions naturally.

- [ ] What they're building (concrete enough to explain to a stranger)
- [ ] Why it needs to exist (the problem or desire driving it)
- [ ] Who it's for (even if just themselves)
- [ ] What "done" looks like (observable outcomes)

---

## Decision Gate

When you have enough clarity, offer to proceed:

- header: "Ready?"
- question: "I think I understand what you're after. Ready to proceed?"
- options: ["Yes, let's go", "Keep exploring"]

If "Keep exploring" — ask what they want to add or identify gaps and probe naturally. Loop until confirmed.

---

## Anti-Patterns

- **Checklist walking** — Going through domains regardless of what they said
- **Canned questions** — "What are your success criteria?" regardless of context
- **Corporate speak** — "Who are your stakeholders?" "What's your core value proposition?"
- **Interrogation** — Firing questions without building on answers
- **Rushing** — Minimizing questions to get to "the work"
- **Shallow acceptance** — Taking vague answers without probing
- **Premature constraints** — Asking about tech stack before understanding the idea
- **Asking about user skills** — Never ask about their technical experience. You build; they decide what to build.
