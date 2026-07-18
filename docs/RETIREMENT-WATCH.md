# Retirement Watch — Native Convergence + Scaffold Strip Audit

devt stays lightweight in two directions: it avoids building what the platform is about to ship (freeze zones), and it retires scaffolding built against model weaknesses that later generations heal (strip audit). Both are standing disciplines, reviewed on a fixed cadence — this file is their single register.

## Policy

- **Freeze zone**: where a native Claude Code / platform feature is converging on devt machinery, new devt features in that area require a field receipt the native path cannot serve. The cheapest kind of lightweight is the machinery never built.
- **Retirement**: when a trigger in the table fires, evaluate delegating to the native path and retiring the devt-side machinery. Retire loudly — CHANGELOG entry, and a REJ tombstone when the retirement encodes a decision future sessions might re-litigate.
- **Strip audit**: at every model-generation boundary, walk the strip-candidate ledger below. Every harness component encodes an assumption about what the model cannot do on its own; those assumptions go stale silently. A/B where cheap (`DEVT_HOOK_PROFILE=minimal` vs `standard`, config-disabled steps) using the existing grader verdicts + token/duration telemetry. Mechanism-firing ≠ value-conversion applies to *existing* machinery, not just new proposals.

Review cadence: each Claude Code release for the convergence table; each model-generation boundary for the strip ledger.

## Native-convergence table

| Native feature (status as of review) | devt machinery it approaches | Trigger to act |
|---|---|---|
| Agent Teams: shared task list, delegate mode, plan approval, TeammateIdle/TaskCompleted hooks (experimental; not `/resume`-restorable) | lane registration/fan-out, parts of dispatch-envelope coordination | teams gain resume + exit experimental |
| Observer agents (experimental, dual-gated: env flag + server-side) | stuck-detector, task-truncation-detector, subagent-status | ships enabled by default, OR a field-evidenced semantic miss the deterministic detectors cannot catch |
| Auto-mode permission pipeline (deny-and-continue grammar, 3-consecutive/20-total escalation, injection probe) | bash-guard, sensitive-path, prompt-guard, parts of pre-flight-guard | available to plugin-mediated sessions |
| `/usage`, per-subagent token breakdown | token-report / mcp-stats / session-report surfaces | field parity with token-report fields |
| Claude Code artifacts (org-scoped, republishable) | weekly-report / retro / review-findings presentation | GA on the operator's plan |
| `isolation: worktree` agent frontmatter + auto-cleanup | per-lane worktree plumbing (`register-lane --repo-root/--base`) | stable + mid-session support |
| Persistent-subagent resume via SendMessage handle (experimental flag; handles die at compaction/session boundary) | verifier-revision re-dispatch loop; `agent-resume.cjs` covers the walled-agent case already | flag removal/GA + a receipt where re-spawn context re-reads dominate iteration cost (counter-consideration: revision loops sometimes benefit from fresh eyes — fallback-to-fresh must stay automatic) |
| Managed Agents primitives: `wake(sessionId)`, hosted session log, scheduled deployments, "Dreaming" memory curation (hosted API only) | threads/handoffs machinery, curator cadence, autonomous_chain | any of these reach Claude Code proper |

## Strip-candidate ledger

Each entry names the model capability gap the scaffold compensates for (`compensates:`), so the per-generation audit has something to test against. Status reflects the last audit.

| Scaffold | Compensates for | Status |
|---|---|---|
| `read-before-edit-guard.sh` | pre-native harnesses did not error on Edit-without-Read | **STRIPPED from standard profile** — the runtime now enforces this natively; hook kept at `full` for environments without the native check |
| per-call effort plumbing (model-profiles) | none — Task tool never accepted per-call effort | **DELETED** (dead plumbing; agent frontmatter `effort:` is the live surface) |
| `effort:` frontmatter tiers (6 agents at `high`) | reasoning-depth calibration for the prior model generation | KEEP; re-baseline one notch down as a trial at each model-generation boundary |
| `task-truncation-detector.sh` | truncation-era silent partial Task returns | KEEP — records feed Axis-H cliff counts; re-test per release |
| turn-limit awareness blocks (10 agents) | mid-turn budget death without a durable artifact | KEEP; re-test per release |
| stub-first protocol (8 agents) | **not a strip candidate** — load-bearing for legible-compliance gates (recoverable sentinel that lets deterministic layers distinguish "never started" from "couldn't finalize"), independent of the truncation era | KEEP |
| context-reset / compaction scaffolds | n/a — deliberately never built; platform compaction suffices (validated against the harness-design engineering post) | — |

## Receipt-gated adoption items

Real improvements with no current consumer — do NOT ship before the named trigger:

- **Headless-Ask audit** (AskUserQuestion surfaces terminate headless `claude -p` runs): audit arch-scanner auto-wire, curator promotion, post-impl graphify refresh for config-backed non-interactive defaults. TRIGGER: first field evidence of devt running under headless/auto-mode.
- **Enforced active-interaction verification** (verifier must execute declared runnable surfaces at STANDARD+; the legible declare-what-ran contract ships already). TRIGGER: a receipt showing the static verifier missing a wiring-class bug.
- **Warm SendMessage-resume for verifier revision loops**. TRIGGER: see persistent-subagent row above.

## Cross-references

- `docs/GRADER.md` — grader verdicts used as the A/B comparison signal
- `docs/HOOKS.md` — profile mechanics (`DEVT_HOOK_PROFILE`) used for cheap strip trials
- `CHANGELOG.md` — the retirement record itself
