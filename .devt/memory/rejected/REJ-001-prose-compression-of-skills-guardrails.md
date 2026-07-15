---
id: REJ-001
title: "Prose compression of skills/guardrails (article-stripping, hedge-removal, static-compress)"
doc_type: rejected
domain: token-optimization
status: active
confidence: verified
summary: "Never compress/strip prose in skills or guardrails for token savings. Twice evaluated, net-negative: savings cache-invisible; edits break exact-phrase gates, alter triggers, degrade grammar."
affects_paths:
  - "skills/**"
  - "guardrails/**"
reason: performance
search_keywords:
  - "article stripping"
  - "prose compression"
  - "static-compress guardrails"
  - "shrink skill prose"
  - "token optimization skills"
  - "compress markdown prose"
  - "hedge removal"
created_at: "2026-07-15T20:30:00Z"
created_by: user
---

# REJ-001 — Prose compression of skills/guardrails

## What was proposed (twice)

1. Static-compress pass over `guardrails/` (lightening-pass investigation):
   strip hedges/articles to save ~1,833 disk tokens.
2. Article-stripping pass over 17 `skills/*/SKILL.md` + 4 `guardrails/*.md`
   (raw-dispatch session, 2026-07-15): 721 lines reworded, 6,973 bytes saved.

## Why rejected

- **Savings are cache-invisible.** Measured 0.06–0.19% per dispatch; under
  prompt caching, repeated identical content is nearly free — and editing it
  invalidates the cache, making the change briefly net-NEGATIVE on tokens.
- **Breaks mechanical gates.** Smoke gates pin exact phrases in skill bodies
  (K25 broke on "of an external tool" → "of external tool").
- **Damages the skill-matching surface.** Quoted trigger phrases in
  frontmatter descriptions were altered ("run the council" → "run council");
  descriptions are the model's matching signal.
- **Degrades instruction quality.** Produced ungrammatical prose ("Use when
  user says", "is X bad idea") in files that agents pattern-match verbatim;
  hedge-removal additionally flips advisory guidance to mandatory on
  normative guardrails.

## What to do instead

Token reduction on dispatch surfaces goes through structural levers with
measured per-dispatch effect: rules/rubric by-reference, section excludes,
by-reference stubs — never through lossy prose rewriting of behavioral
instruction files.
