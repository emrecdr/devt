---
name: memory-pre-flight
description: Use BEFORE any code edit, plan, or architectural decision. Defines the Two-Tier Pre-Flight Protocol (Topic Pre-Flight at workflow start; File Pre-Flight at each Edit). Agents preload this skill when they may modify code or propose changes — it tells them how to read the .devt/state/preflight-brief.md, when to escalate to a 5-lane File Pre-Flight, and how to scratchpad-summarize their findings before touching files. The PreToolUse pre-flight-guard hook checks the scratchpad — missing summaries warn or block the edit.
allowed-tools: Bash Read Grep Glob
user-invocable: false
---

# Memory Pre-Flight Protocol

**Empty signal blocks mean no signal.** A dispatch block rendering as `{}` or
`[]` (memory_signal, scope_hint, auto_memory) carries nothing — skip it; do not
hunt for meaning in it or mention it in output.

The Two-Tier Pre-Flight Protocol stops silent ADR violations, REJ-tombstone
re-proposals, and ungoverned scope creep. **Tier 1** (Topic Pre-Flight) builds a
Brief at workflow start; **Tier 2** (File Pre-Flight) verifies coverage at each
edit and escalates when scope expands. This body is the hot protocol; the
cold-path detail (why it exists, the full Brief structure, the 5-lane mechanics,
config, multi-root) lives in `references/memory-pre-flight-details.md` — Read it
on demand, it is not preloaded.

## When it applies

Mandatory for: programmer, architect, code-reviewer, debugger, researcher,
tester, verifier, docs-writer (they preload it via `skills:` frontmatter).

**Applies** when you are about to Edit/Write/NotebookEdit a file in `src/`,
`lib/`, `tests/`, `.devt/memory/`, or `guardrails/`; propose an architectural
change in `plan.md`/`arch-review.md`/`decisions.md`; implement/fix/refactor; or
recommend an approach in `research.md`/`spec.md`.

**Does NOT apply** when: reading/grepping for understanding; editing only
ephemeral `.devt/state/` (scratchpad, debug notes); prose-only changes
(CHANGELOG, docs/, README); meta workflows (autoskill/weekly-report/status/help);
retro/lesson-extraction (they read memory, don't mutate code); or fast-tier work
(`/devt:workflow --mode=fast` ships explicit "no Brief expected" semantics).

## Tier 1 — Read the Brief (workflow start)

The workflow (or `/devt:preflight "<task>"`) writes `.devt/state/preflight-brief.md`.
At agent startup (after context_loading):

```bash
cat .devt/state/preflight-brief.md 2>/dev/null
```

- **`## Status: FRESH`** → treat it as the source of truth for what governance
  applies. Re-read it any time you change direction. (Section-by-section
  breakdown: `references/memory-pre-flight-details.md`.)
- **`## Status: STALE`** → a prior File Pre-Flight detected scope expansion.
  Re-run `/devt:preflight "<refined task>"` before substantial work. STALE is a
  warning that the governance set may be incomplete, not that it's wrong.
- **Missing** → pre-flight was skipped (non-dev workflow) or `preflight_mode: off`.
  Fall back to `codebase-scan`: read CLAUDE.md, scan `.devt/rules/`, search
  `.devt/memory/` manually if present.

## Tier 2 — File Pre-Flight (at EACH Edit)

BEFORE calling Edit/Write/NotebookEdit, append a 1-line summary to
`.devt/state/scratchpad.md`:

```
PREFLIGHT <ISO-timestamp> <action> <file_path> :: <comma-separated governing IDs>
```

Examples:

```
PREFLIGHT 2026-05-05T15:30:00Z edit src/auth/service.ts :: ADR-007, ADR-012, CON-003
PREFLIGHT 2026-05-05T15:31:00Z edit src/billing/invoice.ts :: brief-coverage-extended; ran 5-lane lookup
PREFLIGHT 2026-05-05T15:32:00Z write tests/auth/mfa.test.ts :: ADR-007, FLOW-002
```

Decision tree per edit:

```
1. Is the file covered by the Brief's affects_paths or your working scope?
   YES → summarize the relevant subset to scratchpad. Cheap. Proceed.
   NO  → scope expanded; run the 5-Lane File Pre-Flight, then mark the Brief STALE.
2. Append the PREFLIGHT line to .devt/state/scratchpad.md.
3. Proceed with Edit/Write.
```

**Escalation (scope expanded).** When the file isn't Brief-covered, run the
5-Lane lookup (wiki-links → `memory affects <file>` → `memory affects-symbol` →
`memory active <domain>` → `memory query <terms>`; aggregate-first with `--count`
/ `--top` / `--domain-counts` to stay cheap) — full lane table + probe reference
in `references/memory-pre-flight-details.md`. Then:

```bash
node bin/devt-tools.cjs preflight mark-stale "scope expanded to <file>"
```

## PreToolUse hook + deny recovery

`hooks/pre-flight-guard.sh` (PreToolUse on Edit/Write/NotebookEdit) scans
`.devt/state/scratchpad.md` for a `PREFLIGHT` line covering the target file.
`memory.preflight_mode`: `off` no-op / `warn` stderr advisory / `block` (default)
denies the edit. To pass: write the PREFLIGHT line BEFORE the edit — that is the
entire ceremony.

Every deny (or warn) is appended to `.devt/state/preflight-denies.jsonl` (append-only,
RESET_EXEMPT). On a `decision: "deny"` tool result, **read that log first**, then
recover per the record's `source`:

| `source` | What was denied | Recovery |
|---|---|---|
| `preflight` | Edit/Write with no PREFLIGHT scratchpad line | Append the `PREFLIGHT <ts> <action> <path> :: <IDs>` line, retry |
| `bash_destroy` | Filesystem-wipe Bash (root, `$HOME`, parent dirs, block devices) | Narrow to a specific project subdir, or ask the user to authorize the wider op |
| `no_verify` | Git commands carrying the hook-skip / signing-bypass flag | Stop and ask the user before retrying with the flag granted |

Records missing `source` (legacy) → treat as `preflight`. **Three denies in one
session trip the stuck-signal** — autonomous mode pauses and surfaces the chain.
Don't repeat a denied call without addressing the recovery path.

## Details reference

Config (`memory.preflight_mode`, `memory.enabled`, `memory.paths`), multi-root
behavior (`source_root` on Brief entries, org-shared vs project-local docs), the
full Brief structure, the complete 5-lane table, and common pitfalls all live in
`references/memory-pre-flight-details.md` — Read it when you escalate or need the
config/multi-root semantics.
