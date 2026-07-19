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
| `DEVT_VALIDATE_SHADOW` | `1` | Set to `0` to disable the shadow-mode state validation that runs on every `state update` and persists `validation_status` to `workflow.yaml` |
| `DEVT_VALIDATE_ENFORCE` | `0` | Set to `1` to make `state update` HARD-fail on validation mismatches (default: shadow-only — log + persist warning but don't block) |
| `DEVT_AUTO_INDEX_DEBOUNCE_SEC` | `30` | Debounce window for the memory-auto-index PostToolUse hook. Edits to `.devt/memory/*.md` within the window are coalesced into one FTS5 rebuild |
| `DEVT_MCP_ALLOW_WRITES` | (unset) | Set to `1` to enable write-tools on the memory MCP server (`memory_upsert_doc` etc.). Default disabled — read-only MCP surface unless explicitly opted-in per project |

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

**File.** `.devt/state/preflight-denies.jsonl` (in `RESET_EXEMPT` — persists across `/devt:workflow --cancel`).

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

**Telemetry.** Each warning appends one JSONL record to `.devt/state/dispatch-warnings.jsonl` (`source: "dispatch_scope"`) so `/devt:debug --mode=forensics` can surface "this workflow had N over-scoped dispatches" post-hoc.

**Tunables.** Per project in `.devt/config.json::dispatch.{max_prompt_bytes, max_files_hint}`.

**Profile.** Active in `standard` and `full`. Kill switch: `DEVT_DISABLED_HOOKS=dispatch-scope-guard.sh`.

---

## Dispatch-Hygiene Guard

**Hook.** `hooks/dispatch-hygiene-guard.sh` — PreToolUse matcher on `Task`.

**Behavior.** Emits advisory `additionalContext` and appends `source: "raw_dispatch"` (with a stamped `warning_id: "w_<8hex>"` — the address for scoped remediation via `dispatch warnings resolve <id> --reason=…`, which annotates the record rather than deleting it) to `dispatch-warnings.jsonl` on any `Task` call to a `devt:*` subagent whose prompt lacks all three context blocks (`<scope_trust>`, `<scope_hint>`, `<memory_signal>`). When `dispatch_hygiene_mode: "block"` (the default), the hook returns `{decision: "deny"}` for INVESTIGATIVE agents (code-reviewer, programmer, verifier, researcher, debugger, architect, tester); the deny reason includes a `/devt:review` redirect but does NOT include the rendered envelope (block mode stays strict — no paste-ready escape from the canonical workflow path).

**Warn-mode envelope auto-injection.** When `dispatch_hygiene_mode: "warn"`, the advisory in `additionalContext` is followed by a structured `<canonical_envelope>…</canonical_envelope>` block carrying the fully-rendered envelope for the target agent (via `dispatch.cjs::cmdRenderFilled(<agent>:auto)`). The orchestrator sees the exact paste-ready envelope it should have used, derived from current state + governing rules + guardrails + model-profile config. Best-effort with fail-open semantics: any rendering failure (no active workflow, missing template, plugin root absent) falls back to advisory-only. The envelope render reads from the active workflow's `workflow.yaml::workflow_id`; workflows auto-call `state refresh-scope-context` before each dispatch block so the cached `scope_trust` reflects current graph state rather than the value computed at workflow start.

**Known Claude Code limitation.** As of the CC versions tested, PreToolUse `decision: "deny"` is **not enforced for the Task tool** — the hook returns the deny payload correctly, but CC proceeds with the dispatch anyway. The hook's advisory still surfaces in `additionalContext` but the block is effectively a no-op for Task dispatches. Observed: hook fires + raw_dispatch entries written + agents run anyway despite `decision:deny` payloads in stdout. This is a platform limitation, not a hook bug.

**Defense layer 1.5 (post-hoc enforcement).** Because PreToolUse deny is unreliable on Task, the workflow gates `code-review.md::present_findings`, `dev-workflow.md::finalize`, `quick-implement.md::finalize`, and `debug.md::report` now also call `state assert-no-raw-dispatches-this-session` BEFORE the knowledge-candidates-tagged gate. The CLI scans `dispatch-warnings.jsonl` for `source:"raw_dispatch"` entries in the workflow window and BLOCKS the workflow if any are UNRESOLVED — records carrying a `source:"resolution"` annotation (written by `dispatch warnings resolve <warning_id> --reason=…`) stop counting, so a substantively-compliant-but-illegible dispatch (e.g. pointer dispatch) is remediated per-record instead of via `--skip-gates`, which bypasses every gate on the transition. Set `dispatch_hygiene_mode: "warn"` in `.devt/config.json` to opt out (the gate respects the same config knob the hook reads).

**Why layered.** Defense layer 1 (the hook) advises at dispatch time but can be ignored. Layer 1.5 (the post-hoc gate) enforces at finalize time and cannot be ignored — the orchestrator can rationalize past the advisory but cannot reach `present_findings` with raw dispatches in their session. Layer 2 (`agents/code-reviewer.md::workflow_context_assertion`) hard-stops the agent itself with `status=BLOCKED` when dispatched without context. See `docs/AGENT-CONTRACTS.md` (Never raw-dispatch).

---

## Task-Truncation Detector

**`hooks/task-truncation-detector.sh`** is a PostToolUse hook on `Task` / `Agent` dispatches. It measures sub-agent return size + detects three cliff signals:

- `near_cliff` — return bytes ≥ `telemetry.task_truncation_warn_bytes` threshold (default 40000)
- `low_output` — return bytes < 500 (mid-task wall hit at the rate-limit boundary)
- `mid_task_language` — regex match for continuation phrasing like "Now B.5", "paused at X", "continuing with phase 2"

When any cliff fires, the hook:

1. Appends a forensic record to `.devt/state/dispatch-warnings.jsonl` (`source: "task_output_bytes"`)
2. Emits an `additionalContext` advisory pointing the orchestrator at the sidecar + SendMessage-resume path

**Quiet-by-default + `task_truncation_log_all` opt-in.** Pre-greenfield-June-2026 calibration, every dispatch return logged a forensic record regardless of cliff signal. Field data: 178 of 192 records carried `near_cliff:false, low_output:false` — 93% noise. Default flipped to quiet-by-default; set `.devt/config.json::telemetry.task_truncation_log_all: true` to restore the emit-on-every-return behavior for calibration cycles. Orchestrator-visible advisory stays cliff-only regardless of the flag (log-all mode adds no advisory noise; the forensic record is the only delta).

Use log-all mode when computing return-size histograms, latency baselines, or any coverage-dependent analysis. Flip back to default before normal workflow runs to avoid the noise tax on dispatch-warnings reads.

## SessionStart What's-New Surfacing

**`hooks/session-start.sh`** computes `additionalContext` for every session-start event. Beyond the standard plugin-loaded banner, it surfaces a once-per-machine-per-upgrade "what's new" excerpt from `CHANGELOG.md`.

**How it works.**

1. Read `VERSION` (the canonical devt version).
2. Read `~/.cache/devt/whats-new-seen` (per-machine stamp file containing the last-acknowledged version).
3. If the stamp differs from `VERSION`, extract the headline paragraph of the `## [X.Y.Z]` section in `CHANGELOG.md` (cap 800 chars; truncate to "… see CHANGELOG.md for the full notes." on overflow).
4. Append to the SessionStart context as `What's new in devt v<version>:` followed by the extracted text.
5. Update the stamp file so subsequent sessions stay silent for this version.

**Why.** Doc-promotion fails because users load their project's CLAUDE.md, never devt's. New slash commands and new CLAUDE.md sections (escape-hatch recipes) register nowhere in user attention. The SessionStart hook is the single channel users actually see; surfacing the CHANGELOG headline once per upgrade closes the gap without spamming subsequent sessions.

The mechanism is announcement-only. It does NOT change CLI behavior, does NOT block, and degrades gracefully when `CHANGELOG.md` is missing or the version section is absent (empty surfacing → no stamp update).

## Session-End Curation Surface

**`hooks/stop.sh`** (universal Stop hook, all profiles) appends a curation hint to its `stopReason` when memory candidates are ready for triage: `💭 N memory candidates pending in .devt/memory/_suggestions.md — run /devt:memory promote to triage.`

**How it works.** After the unconditional knowledge-candidate harvest, the hook calls `memory candidates-footer --hint-only` — a mode that emits ONLY the hint, and only when `count >= memory.candidates_surface_threshold` (default 5) AND the `memory.candidates_surface_cooldown_hours` window (default 24h, stamp `.devt/memory/.last-candidate-surface`) allows. Emitting touches the cooldown, so despite Stop firing on every response turn, the hint appears at most once per cooldown window. Below readiness the hook's messages are byte-identical to before.

**Why.** Curation triggers are otherwise workflow-finalize-bound (`skills/memory-curation/SKILL.md`), so raw-dispatch maintainer sessions — which never hit a finalize step — accumulate candidates nobody ever sees. Session end is also the moment a human is most likely to notice an anomalous candidate before it reaches the curator (the memory-trust angle: candidates are the untrusted inbox). The `--hint-only` mode deliberately drops the always-on status line the finalize-footer contract requires — that contract exists for once-per-workflow call sites where silence is indistinguishable from never-executing; a per-turn hook has the invocation trace for that, and the always-on line would be per-turn noise.

## Hook Messaging Is Right-Sized for Cost

**Rule.** Per-fire hook output (advisories, deny/warn messages, context-injection lines) is intentionally compact — the action cue + load-bearing recovery hints, not full re-explanation of protocols agents already know from preloaded skills.

**Why.** Verbose re-explanation of any documented protocol in a hook message is dead weight that pays a token tax on every fire.

**Enforcement.** Smoke gates enforce byte budgets on the four highest-frequency hook messages:
- `read-before-edit-guard.sh`
- `workflow-context-injector.sh` active line
- `pre-flight-guard.sh` warn message
- `dispatch-hygiene-guard.sh` advisory

Regressions in message length get caught at CI time, not in production.

**Frequency is right-sized too.** The config-drift safety banner (`workflow-context-injector.sh`, fires when a safety mode like `dispatch_hygiene_mode` is weakened below `block`) alerts once per session per project — a marker in the devt cache dir stores the last-alerted `session_id`. Every-prompt alerting field-tested as alert fatigue (~15+ fires/session) that trains operators to ignore the one banner that matters; `session-start.sh` still surfaces the same warning at session open. A missing `session_id` (runner didn't forward hook stdin) falls back to every-prompt — fail-loud is the right failure mode for a safety banner.

---

## Cross-references

- `docs/AGENT-CONTRACTS.md` — agent + workflow rules consumed by hooks
- `docs/MEMORY.md` — Two-Tier Pre-Flight Protocol (Tier 1 + Tier 2 context)
- `docs/INTERNALS.md` — `run-hook.js` runner internals, state validation hooks
- `docs/STATE-RULES.md` — `.devt/state/` filename contract for hook outputs
- `hooks/hooks.json` — hook event registration
- `hooks/quality-gate-verifier.md` — opt-in template (not auto-registered)
