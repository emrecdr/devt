---
id: REJ-004
title: "Do NOT rewrite the devt CLI in Rust/Go/native code"
doc_type: rejected
status: active
confidence: verified
domain: architecture
summary: "No native rewrite: zero-build Node stdlib IS the distribution contract (no toolchain to install); node startup ~26ms is the measured floor - a binary buys ~25ms/call for a per-platform build matrix."
reason: performance
search_keywords:
  - "rust rewrite"
  - "rewrite in rust"
  - "golang port"
  - "native binary"
  - "compile the cli"
  - "performance rewrite"
  - "faster startup binary"
affects_paths:
  - "bin/devt-tools.cjs"
created_at: "2026-07-26T00:00:00Z"
created_by: user
schema_version: 1
---

# Rejected: Do NOT rewrite the devt CLI in Rust/Go/native code

## The Proposal & Why It Was Rejected

Rejected approach: port `devt-tools.cjs` (or its hot paths) to a compiled language for startup speed. The zero-build CommonJS-on-stdlib design is not an accident — it is the distribution contract: the plugin installs from the marketplace or a git clone with **no build step, no toolchain, no per-platform artifacts**, running on the Node the harness already ships everywhere Claude Code runs. Measurement kills the performance case: bare node startup is ~26ms and the entire 5-module state family adds ~2ms of parse; full CLI verbs land at 37–39ms warm and the heaviest hook chain at 73ms. A native binary would shave roughly the node-startup floor (~25ms/call) — imperceptible at devt's call frequencies — while adding a build matrix (macOS arm/x86, Linux, Windows), release-artifact management, and a contributor barrier to a codebase whose whole surface is currently readable, patchable markdown + plain JS. Latency work that mattered (the stop-hook 8-spawn chain, 928→~440ms) came from removing *spawns*, not from language speed.

## Reconsideration Triggers

Revisit only if a measured user-facing path emerges where the node-startup floor itself dominates a real latency budget at high frequency (none exists — hooks fire per tool call, not per keystroke), or the platform stops shipping a Node runtime.
