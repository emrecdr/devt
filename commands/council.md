---
name: council
description: Pressure-test an engineering decision through 5 advisors with adversarial peer review. Use for high-stakes choices where you suspect your first instinct is biased.
---

<tool_restrictions>
This command invokes the council skill, which uses: Read, Write, Bash, Grep, Glob, Task.
</tool_restrictions>

<objective>
Run the council skill on the user-supplied question. Producing a chairman verdict with
consensus, conflicts, blind spots, a recommendation, and one concrete next step. The
full transcript (5 advisor responses + 5 peer reviews + chairman synthesis) is saved
under `.devt/state/council-{slug}-{timestamp}.md`.
</objective>

<process>
Argument forms:
- `/devt:council "<question>"`
- `/devt:council --mixed-models "<question>"`

Parse the argument:
1. If the argument starts with `--mixed-models`, strip that flag and remember the choice.
   It tells the council skill to dispatch advisors across opus/sonnet/haiku for higher
   reasoning diversity at extra token cost (default is single-model dispatch).
2. Treat the remaining text as the question to put to the council.

Invoke the council skill (Skill tool: name=council). Pass the question through, plus the
mixed-models choice if set. The skill handles framing with workspace context, parallel
advisor dispatch, anonymized peer review, chairman synthesis, and writing the transcript
to `.devt/state/`.

If the user provides no argument, do not invoke the skill. Instead, surface usage:

> Run `/devt:council "your question"` (or use a phrase trigger like `council this: …`,
> `pressure-test this`, `red team this`, or `second opinion on this`).
> Add `--mixed-models` to dispatch advisors across opus/sonnet/haiku for higher reasoning
> diversity at extra token cost.

Do **not** invoke the council on trivial questions (factual lookups, single-line fixes,
syntax questions). The skill's description lists the trigger boundary; respect it. If the
question doesn't justify the council, answer directly and tell the user why you skipped
the council.
</process>
