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

## Using AskUserQuestion

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
