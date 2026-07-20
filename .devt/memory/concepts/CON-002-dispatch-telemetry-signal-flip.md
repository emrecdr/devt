---
id: CON-002
title: Dispatch Telemetry Signal Flip Across Project Surfaces
doc_type: concept
status: active
confidence: verified
domain: telemetry
summary: dispatch-warnings.jsonl carries 2 signal classes (raw_dispatch + task_output_bytes). Dominant signal is project-shaped — devt 99.7%/0.08% vs greenfield 13%/84.7%. Recipes must surface both classes.
affects_paths:
  - hooks/dispatch-hygiene-guard.sh
  - hooks/task-truncation-detector.sh
  - bin/modules/dispatch.cjs
  - bin/modules/state.cjs
  - docs/COMMANDS.md
  - workflows/status.md
created_at: 2026-06-14
created_by: emre
schema_version: 1
---

# Dispatch Telemetry Signal Flip Across Project Surfaces

`dispatch-warnings.jsonl` is the union of two independent telemetry streams:

| Source                  | Written by                              | Trigger condition                                                                 |
| ----------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| `raw_dispatch`          | `hooks/dispatch-hygiene-guard.sh` (PreToolUse) | Task call to `devt:*` agent without `<scope_trust>/<scope_hint>/<memory_signal>` or any of 7 other envelope-signal blocks |
| `task_output_bytes`     | `hooks/task-truncation-detector.sh` (PostToolUse) | Sub-agent return triggers a cliff (`near_cliff` / `low_output` / `mid_task_language`) |

Devt's own usage of devt produces almost-exclusively raw_dispatch entries (envelope-skipping is the dominant misuse). Greenfield calibration #21 F18 surfaced the inversion empirically.

## Field-validated signal distribution (cal #21 F18 + F22)

| Project    | Total entries | raw_dispatch | task_output_bytes | Notes                                                                                    |
| ---------- | ------------- | ------------ | ----------------- | ---------------------------------------------------------------------------------------- |
| **devt**   | 2,495         | 99.7%        | 0.08% (2 of 2495) | devt's agents work on a small codebase; cliff signals never fire in practice             |
| **greenfield** | 216       | 13%          | **84.7%** (183)   | greenfield uses devt:programmer / devt:docs-writer against a 30-service codebase. Of the 183 task_output entries, the distribution is: `low_output` 6%, `mid_task_language` 2%, `near_cliff` 0% |

## Implication for recipes and documentation

devt's recipe instinct ("dispatch warnings is for catching envelope-skippers") under-sells the CLI's actual value in projects with larger agent outputs. Documentation must surface BOTH signal classes:

- **raw_dispatch** — orchestrator envelope discipline. Action: dispatch through `/devt:workflow` or inject envelope blocks manually.
- **task_output_bytes** — sub-agent return-size anomaly. Action: read the structured sidecar artifact (not the prose return) and inspect Status field; if PARTIAL, SendMessage-resume the same agent.

The `low_output` signal is the canary in projects like greenfield: it caught W12's credential-expiry-returning-zero-tokens case AND the F21-falsification-test's proportional-response false alarm (later fixed by F26's prompt-size gate).

## Field-validated W12 case (cal #21 F-OBS-1 + F5)

The strongest field evidence for the cliff-detection value:

1. **W12 first dispatch died** at "Not logged in" with `total_tokens: 0`. Pure credential-expiry pattern.
2. **task-truncation-detector** correctly logged `low_output: true` for the 0-byte return (would have, if `low_output` weren't gated by `near_cliff`-only at the time — fix shipped with this concept).
3. **Operator re-dispatched** without running `state validate` or `state recover-partial-impl`. The orchestrator had no programmatic signal that prior partial work existed.
4. **W12 retry inherited bad state** (`PermissionQueryParams.scope: str | None`) from a sibling agent's earlier session and self-corrected to `PScope`. Self-correction was the safety net; no programmatic check.

## Concrete instrumentation now wired (cal #21 actions α)

| Surface | Action | What it does | Test |
|---|---|---|---|
| `hooks/task-truncation-detector.sh` | F26 — proportional-response gate | `low_output` only fires when prompt >= 1000 bytes; suppresses false alarms on trivial probes | K107 |
| `bin/modules/state.cjs` | A4 — `state check-inherited-edits` | Surfaces uncommitted source edits filtered by `workflow.yaml::first_created_at`; orchestrators call this between dispatches after a failure | K108 |
| `workflows/status.md` | A2 — `/devt:status` includes both counts | Session-scoped raw_dispatch + cliff signal counts; threshold-gated (suppressed when both zero) | (workflow body — no smoke gate) |
| `hooks/task-truncation-detector.sh` | A2b — PostToolUse hint | Emits one-line raw_dispatch hint in additionalContext when any raw_dispatch entries exist within last 60min; fires regardless of cliff | K109 |
| `bin/modules/dispatch.cjs` | (already shipped earlier in cycle) | `dispatch warnings` CLI — query the JSONL with `--by-source`, `--by-agent`, `--limit=N`, `--since=ISO`, `--raw` | K104 |

## What this concept says about future telemetry work

**Avoid project-specific tuning baked into hook code.** devt's pattern (raw_dispatch heavy) shouldn't drive threshold defaults. greenfield's pattern (task_output heavy) is different but equally valid. Tuning should live in `.devt/config.json::telemetry.*` keys per-project, with sensible defaults that don't over-optimize for either pattern.

When a new telemetry signal is proposed, validate against MORE THAN ONE project's `dispatch-warnings.jsonl`. devt's own evidence is necessary but not sufficient.
