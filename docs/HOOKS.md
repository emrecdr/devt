# Hook Subsystem

> ↑ Entry point: [`CLAUDE.md`](../CLAUDE.md) (orchestrator architecture + critical contracts).

> Mechanism reference for `hooks/*.sh`, the `run-hook.js` runner, hook profiles, deny logs, and the forensic trace. For the user-facing hook profile table, see `CLAUDE.md > Architecture > Hook Profiles`.

---

## Runner + Profiles

Hooks use a Node.js runner (`hooks/run-hook.js`) with profile support:

| Env var | Default | Purpose |
|---|---|---|
| `DEVT_HOOK_PROFILE` | `standard` | Selects the hook set — `minimal`, `standard`, or `full` |
| `DEVT_DISABLED_HOOKS` | (unset) | Comma-separated list of hook scripts to disable regardless of profile (e.g. `bash-guard.sh,dispatch-scope-guard.sh`) |
| `DEVT_HOOK_TRACE` | `1` | Set to `0` to disable the universal invocation trace |

The `run-hook.cmd` polyglot delegates to `run-hook.js` for cross-platform support.

---

## Universal Hook Invocation Trace

**Mechanism.** `hooks/run-hook.js` appends one JSON record per invocation to `.devt/state/hook-trace/run-hook.jsonl`:

```json
{"ts": "...", "script": "...", "profile": "...", "enabled": true, "stdin_bytes": N, "stdout_bytes": N, "stderr_bytes": N, "exit": 0, "reason": "..."}
```

**Captures.** Every hook dispatch — enabled, disabled, spawn-failed.

**Why.** Single source-of-truth for "did the CC harness actually invoke this hook?" — without it, a silent no-op is indistinguishable from a fired-but-conditions-not-met hook.

**Lifecycle.** The trace lives **outside** `RESET_EXEMPT` — only meaningful for the current session's diagnostic window. Prune at will.

**Kill switch.** `DEVT_HOOK_TRACE=0`.

---

## Tier 2 Pre-Flight Guard

**Hook.** `hooks/pre-flight-guard.sh` — PreToolUse matcher on `Edit`, `Write`, `NotebookEdit`.

**Mechanism.** Checks `.devt/state/scratchpad.md` for lines of the form:

```
PREFLIGHT <ts> edit <path> :: <governing IDs>
```

**Behavior matrix** (governed by `memory.preflight_mode`):

| Mode | Behavior |
|---|---|
| `off` | Hook is a no-op |
| `warn` | Stderr advisory; edit proceeds |
| `block` (default) | Returns `{decision: "deny"}` with a checklist; agent must produce the PREFLIGHT line first |

See `docs/MEMORY.md` for the full Two-Tier Pre-Flight Protocol context (Tier 1 = the Brief; Tier 2 = this guard).

---

## Forensic Deny Log

**File.** `.devt/state/preflight-denies.jsonl` (in `RESET_EXEMPT` — persists across `/devt:cancel-workflow`).

**Mechanism.** Every deny/warn appends one JSON record via `bin/modules/logger.cjs::appendJsonl`. 4KB-per-record PIPE_BUF cap guarantees POSIX atomic appends across concurrent writers.

**Sources** (`source` field discriminator):

| `source` value | Origin |
|---|---|
| `preflight` | The Edit/Write guard above. Written by `hooks/pre-flight-guard.sh` on both the helper-path (via `appendJsonl`) and the fallback-path (direct `fs.appendFileSync` used when `CLAUDE_PLUGIN_ROOT` isn't set). Pre-existing records that predate this field should be treated as `source: "preflight"` by consumers. |
| `bash_destroy` | Bash safety hook denying filesystem-wipe patterns |
| `no_verify` | Bash safety hook denying `--no-verify` / `--no-gpg-sign` |
| `graph_loader` | Graphify `graph.json` exceeded `GRAPH_SIZE_CAP` (per-process deduped) |

**Recovery for agents.** Agents recovering from a deny should read this log first to see prior denied attempts in the session before retrying. See `skills/memory-pre-flight/SKILL.md` "Recovering from a deny".

---

## Bash Safety Hook

**Hook.** `hooks/bash-guard.sh` — PreToolUse matcher on `Bash`.

**Denies two narrow rule families** with zero legitimate dev use:

1. **Filesystem-wipe** (`source: "bash_destroy"`):
   - `rm -rf` against root / `$HOME` / parent dirs
   - `dd` to raw block devices
   - `mkfs`
   - Fork bombs
   - Stdout redirect to `/dev/sd*`
2. **No-verify git ops** (`source: "no_verify"`):
   - `--no-verify`
   - `--no-gpg-sign`

**Quote stripping.** The hook strips quoted segments before testing patterns, so:
- `echo "rm -rf /"` passes (string literal)
- `git commit -m "discuss --no-verify scenario"` passes (commit-message literal)

**Profile.** Active in `standard` and `full`. Kill switch: `DEVT_DISABLED_HOOKS=bash-guard.sh`.

---

## Stuck-Agent Detector

**Module.** `bin/modules/stuck-detector.cjs` (exposed as `node bin/devt-tools.cjs stuck check`).

**Mechanism.** Counts deny records in the current workflow session, anchored to `workflow.yaml::created_at` (with `mtime` fallback for older state files lacking the field). Reports `stuck: true` at the **3-deny threshold** across all `source` values.

**Wiring.**
- `workflows/dev-workflow.md` — autonomous-mode pause block.
- `workflows/next.md` — PRIORITY GUARDS + a dedicated "Active workflow, stuck signal" routing branch.
- `workflows/status.md` — conditional surface line.

**Outcome.** Autonomous flows pause and surface the deny chain when the threshold trips, so guardrail loops surface to the user instead of burning iterations.

---

## Dispatch-Scope Advisory Hook

**Hook.** `hooks/dispatch-scope-guard.sh` — PreToolUse matcher on `Task`.

**Behavior.** Emits an advisory `additionalContext` when a subagent dispatch's prompt byte count exceeds `dispatch.max_prompt_bytes` (default `24576`) or its parsed `<scope_hint>` array exceeds `dispatch.max_files_hint` (default `8`). **NEVER blocks.**

**Telemetry.** Each warning appends one JSONL record to `.devt/state/dispatch-warnings.jsonl` (`source: "dispatch_scope"`) so `/devt:forensics` can surface "this workflow had N over-scoped dispatches" post-hoc.

**Tunables.** Per project in `.devt/config.json::dispatch.{max_prompt_bytes, max_files_hint}`.

**Profile.** Active in `standard` and `full`. Kill switch: `DEVT_DISABLED_HOOKS=dispatch-scope-guard.sh`.

---

## Dispatch-Hygiene Guard

**Hook.** `hooks/dispatch-hygiene-guard.sh` — PreToolUse matcher on `Task`.

**Behavior.** Emits advisory `additionalContext` and appends `source: "raw_dispatch"` to `dispatch-warnings.jsonl` on any `Task` call to a `devt:*` subagent whose prompt lacks all three context blocks (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`).

**Why.** Defense layer 1 of the "never raw-dispatch devt agents" contract. Layer 2 is `agents/code-reviewer.md::workflow_context_assertion` which hard-stops with `status=BLOCKED`. See `docs/AGENT-CONTRACTS.md` (Never raw-dispatch).

---

## Hook Messaging Is Right-Sized for Cost

**Rule.** Per-fire hook output (advisories, deny/warn messages, context-injection lines) is intentionally compact — the action cue + load-bearing recovery hints, not full re-explanation of protocols agents already know from preloaded skills.

**Why.** Verbose re-explanation of any documented protocol in a hook message is dead weight that pays a token tax on every fire.

**Enforcement.** Smoke gates enforce byte budgets on the four highest-frequency hook messages:
- `read-before-edit-guard.sh`
- `workflow-context-injector.sh` active line
- `pre-flight-guard.sh` warn message
- `dispatch-hygiene-guard.sh` advisory

Regressions in message length get caught at CI time, not in production.

---

## Cross-references

- `docs/AGENT-CONTRACTS.md` — agent + workflow rules consumed by hooks
- `docs/MEMORY.md` — Two-Tier Pre-Flight Protocol (Tier 1 + Tier 2 context)
- `docs/INTERNALS.md` — `run-hook.js` runner internals, state validation hooks
- `docs/STATE-RULES.md` — `.devt/state/` filename contract for hook outputs
- `hooks/hooks.json` — hook event registration
- `hooks/quality-gate-verifier.md` — opt-in template (not auto-registered)
