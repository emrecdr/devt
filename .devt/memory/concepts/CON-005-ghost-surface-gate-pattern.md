---
id: CON-005
title: "Ghost-surface gate pattern: every doc surface naming an executable command gets a documented ⊆ routed gate"
doc_type: concept
domain: gates
status: active
confidence: verified
summary: "Every surface advertising an executable command needs a gate asserting it routes. Curated surfaces get one-way documented-subset-of-routed, never parity. Ghosts are caught by scanning claims."
affects_paths:
  - "scripts/smoke-test.sh"
  - "CLAUDE.md"
  - "bin/devt-tools.cjs"
created_at: "2026-07-17T00:00:00Z"
created_by: curator
schema_version: 1
---

# Concept: Ghost-surface gate pattern — every doc surface naming an executable command gets a documented ⊆ routed gate

## Definition & Logic

The `semantic sync|query|compact|status` CLI stayed documented in CLAUDE.md for months after its module was deleted — a ghost surface no gate watched. The fix generalizes: every surface that advertises an executable command needs a gate asserting the command routes. Direction matters per surface type: exhaustive surfaces could get parity checks, but CURATED surfaces (top-level printUsage deliberately omits plumbing subcommands) get one-way documented ⊆ routed — a parity gate on a curated list would institutionalize the wrong invariant and rot into an ignored red. Shipped instances: K280 (CLAUDE.md dev-commands ↔ devt-tools.cjs router cases; would have caught the semantic ghost the day it appeared) and K281 (printUsage memory lines ↔ memory.cjs case handlers; found live when `memory supersede` shipped routed + CLAUDE.md-documented but absent from the third surface). K156 covers the module-level fourth surface (case-handler ⊇ own default-case enumeration). The class insight: ghost commands are never caught by testing what exists — only by scanning what is claimed.
