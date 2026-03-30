# Questioning Guide

How to interview users for requirements and design decisions. Read this before `/devt:specify` and `/devt:clarify` sessions.

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

**When the user wants to explain freely:** If they select "Other" or signal they want to describe something in their own words — STOP using AskUserQuestion. Ask follow-up as plain text. Resume AskUserQuestion after processing their response.

---

## Context Checklist

Check these mentally as you go. If gaps remain, weave questions naturally.

- [ ] What they're building (concrete enough to explain to a stranger)
- [ ] Why it needs to exist (the problem or desire driving it)
- [ ] Who it's for (even if just themselves)
- [ ] What "done" looks like (observable outcomes)

---

## Anti-Patterns

- **Checklist walking** — Going through domains regardless of what they said
- **Canned questions** — "What are your success criteria?" regardless of context
- **Interrogation** — Firing questions without building on answers
- **Rushing** — Minimizing questions to get to "the work"
- **Shallow acceptance** — Taking vague answers without probing
- **Premature constraints** — Asking about tech stack before understanding the idea
