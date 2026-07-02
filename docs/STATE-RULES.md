# `.devt/state/` Directory Rules

**The state directory is governed by a strict contract.** This document is the single source of truth for what files are allowed there, who writes them, and what happens to ad-hoc names.

Source of truth (machine-readable): `bin/modules/state.cjs::STATE_FILE_CONTRACT` + `ARTIFACT_SCHEMA` + `JSON_SIDECAR_SCHEMAS` + `JSON_INPUT_SCHEMAS` + `SIDECAR_FOR_MARKDOWN` + `RESET_EXEMPT`.

Source of truth (regex compilation): `bin/modules/state-audit.cjs::ALLOWED_PATTERNS` + `EPHEMERAL_PATTERNS`. These two surfaces are smoke-test enforced to agree with the declared contract.

---

## The 4-bucket classifier

Every file in `.devt/state/` belongs to exactly one of these buckets:

| Bucket | What it is | Survives `state reset`? | Archived by `state cleanup`? |
|---|---|---|---|
| **canonical** | Listed by exact filename in the contract | Per RESET_EXEMPT — most are wiped, the RESET_EXEMPT set survives | Never |
| **pattern_allowed** | Matches an `ALLOWED_PATTERNS` regex | No (workflow-scoped) | Only when `mtime > stale_days_default` (default 21) |
| **ephemeral** | Matches `EPHEMERAL_PATTERNS` (`.tmp`, `~`) | No | Always (every cleanup) |
| **ad_hoc** | Matches NOTHING in the contract | No | Always (every cleanup) |

Files in `ad_hoc` are the failure mode. They appear when an agent or human writes a filename outside the contract. Smoke tests catch this at code review time; `state audit` catches it at runtime.

---

## Canonical file inventory

### Always-present (workflow control plane)

| Filename | Written by | Purpose | RESET_EXEMPT |
|---|---|---|---|
| `workflow.yaml` | orchestrator (`state update`) | Active workflow state — `workflow_id`, `phase`, `workflow_type`, `status`, `verdict`, autonomous flags, plus immutable session anchors `first_created_at` + `original_workflow_id` and the append-only `workflow_id_history[]` chain. History is idempotently self-healing — every `state update` ensures `{original, current} ⊆ history` (rotation appends + post-step backfills any missing anchor or current id) | No — wiped on reset |
| `scratchpad.md` | any agent | Ephemeral cross-agent notes; reset between workflows | No |
| `.lock` | `state update` | PID-based mutex preventing concurrent writes | ✓ Yes |

### Per-workflow artifacts (markdown only)

| Filename | Written by | Purpose | Status enum source |
|---|---|---|---|
| `plan.md` | architect / planner | Implementation plan | (not status-gated) |
| `spec.md` | spec-phase agent | Phase requirements clarification | (not status-gated) |
| `scope.md` | orchestrator | Workflow scope text | (not status-gated) |
| `decisions.md` | orchestrator | DEC-NNN entries from `/devt:workflow --mode=clarify` | (not status-gated) |
| `research.md` | researcher | Pattern + pitfall investigation | `ARTIFACT_SCHEMA` |
| `scan-results.md` | architect (arch-health) | Architecture scan output | (not status-gated) |
| `scan-delta.md` | architect (arch-health) | Delta from prior baseline | (not status-gated) |
| `evolution-report.md` | `evolution scan` CLI (arch-health) | Git-history behavioral metrics — hotspots, change coupling, fix density | (not status-gated) |
| `evolution-report.json` | `evolution scan` CLI (arch-health) | Full per-file evolution data (JSON companion) | (not status-gated) |
| `lessons.yaml` | retro | Retro hand-off draft → curator promotes to LES-NNNN | (not status-gated) |
| `debug-context.md` | orchestrator | Symptom capture | (not status-gated) |
| `debug-investigation.md` | debugger | Hypothesis log | (not status-gated) |
| `debug-summary.md` | debugger | Final findings | `ARTIFACT_SCHEMA` |
| `arch-review.md` | architect | Architectural review | `ARTIFACT_SCHEMA` |
| `arch-health-scan.md` | arch-health-scan workflow | Health scan body | (not status-gated) |
| `docs-summary.md` | docs-writer | Documentation update summary | `ARTIFACT_SCHEMA` |
| `curation-summary.md` | curator | Promotion decisions | `ARTIFACT_SCHEMA` |
| `session-report.md` | session-report workflow | Per-session summary | (not status-gated) |
| `autoskill-proposals.md` | autoskill | Skill/agent improvement proposals | (not status-gated) |
| `baseline-gates.md` | orchestrator | Regression baseline | (not status-gated) |
| `claude-mem-harvest.md` | orchestrator pre-step | claude-mem MCP harvest | (not status-gated) |
| `claude-mem-skipped.txt` | orchestrator pre-step | claude-mem decision-artifact (skip) | (not status-gated) |
| `review-scope.md` | orchestrator | Code-review file list | (not status-gated) |
| `review.md` | code-reviewer | Code review body | Sidecar (review.json) |
| `graph-impact.md` | orchestrator | Graphify-derived impact map | (not status-gated) |
| `topic-symbols-dropped.json` | code-review.md substep 5 | Symbols dropped when `symbol_anchored` truncates >32 from preflight; consumed by the impact step to emit a truncation notice in `graph-impact.md` | (not status-gated) |
| `continue-here.md` | `/devt:workflow --pause` | Session-resume narrative | (not status-gated) |

### Per-workflow artifacts (markdown + JSON sidecar pairs)

| Markdown | JSON sidecar | Status source | Verdict enum |
|---|---|---|---|
| `impl-summary.md` | `impl-summary.json` | sidecar | DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT |
| `test-summary.md` | `test-summary.json` | sidecar | DONE / DONE_WITH_CONCERNS / BLOCKED |
| `verification.md` | `verification.json` | sidecar | satisfied / needs_revision / failed |
| `review.md` | `review.json` | sidecar | APPROVED / APPROVED_WITH_NOTES / NEEDS_WORK |

Adding a new sidecar pair: register the schema in `state.cjs::JSON_SIDECAR_SCHEMAS`, add the pairing to `SIDECAR_FOR_MARKDOWN`, remove the markdown entry from `ARTIFACT_SCHEMA` if it was there.

### Input-only JSON artifacts

| Filename | Written by | Read by | Schema |
|---|---|---|---|
| `handoff.json` | `/devt:workflow --pause` | `/devt:next` | `JSON_INPUT_SCHEMAS` |
| `preflight-brief.json` | `preflight.cjs::generate` | every dispatch (`scope_hint`, `scope_trust`) | inline shape; informally documented in `preflight.cjs::generate` |

### Forensic / persistent logs (RESET_EXEMPT)

| Filename | Source | Format | Survives reset? |
|---|---|---|---|
| `.lock` | `state update` PID mutex | JSON | ✓ |
| `.archive/` | `state reset` + `state cleanup` | directory (ring buffer, default 5 snapshots) | ✓ |
| `lane-files/` | `state register-lane` + `register-lanes` (round 8 Tier C) | directory holding `<lane-id>.json` per-lane files sidecars (each: `{id, community, files[], registered_at}`); written because the lane-files array can't safely round-trip through `serializeSimpleYaml`'s primitive-only lane field encoder | ✓ |
| `deferred.md` | `/devt:note --defer`, deferred.cjs | markdown with DEF-NNN entries | ✓ |
| `preflight-denies.jsonl` | preflight hook + bash-guard + graph_loader | JSONL (one record per deny) | ✓ |
| `dispatch-warnings.jsonl` | dispatch-scope-guard hook | JSONL (advisory only) | ✓ |
| `probe-failures.jsonl` | `graphify.probeBinary` + `setup.probePythonGraphifyMcp` | JSONL with `{ts, category, command, args, error, ...}` — categories: `spawn-error` / `timeout` / `nonzero-exit` / `not-installed` / `no-result`. `health` surfaces `PROBE_FAILURES_RECENT` info-check when activity is logged within the last 24h. | ✓ |
| `.graphify-rebuild.lock` | `graphify rebuild` CLI (DEF-038) | atomic O_CREAT|O_EXCL lock holding `{pid, started_at}` JSON; auto-unlinked in finally; survives reset only when the holder crashed (next `rebuild` breaks past the debounce window) | ✓ |
| `static-compress.jsonl` | `static-compress.cjs` CLI | JSONL with `{action, ts, path, engine, before_bytes, after_bytes, ratio, backup_path, warnings}` records — one per compress / restore action. Audits the opt-in static-file compressor; survives reset so calibration data isn't lost when a workflow resets between compression runs. | ✓ |
| `last-curator-run.txt` | auto-curator cooldown tracker | timestamp marker gating the 7-day auto-curator cadence; survives reset so `/devt:workflow --cancel` can't bypass the cooldown | ✓ |
| `graphify-impact-plan.json` | `state compute-impact-plan` | `{tier, tool, args, skip_reason, …}` audit trail for the impact step; survives reset so the "args VERBATIM" contract stays auditable post-hoc (otherwise the only evidence is graph-impact.md, the MCP response, without the args that derived it) | ✓ |
| `workflow-id-rotations.jsonl` | `state` rotation sites + `init` strip | JSONL `{ts, prev_id, new_id, source, pid, argv}` per workflow_id mutation. RESET_EXEMPT because rotations BY resetSoft are themselves the audited events — wiping on reset would erase the forensic trail for the concurrent-rotation bug it exists to diagnose | ✓ |
| `lane-status-overrides.jsonl` | `state update-lane` (only when `override_reason=` passed) | JSONL `{ts, lane_id, prior_status, status, redispatch_count, override_reason, pid}` per operator override. RESET_EXEMPT so post-hoc audits can distinguish "gate wrong, operator overrode with reason" from "gate right, lane redispatched" | ✓ |

### Audit-only

| Filename | Source |
|---|---|
| `preflight-brief.md` | preflight.cjs::generate (human-readable Brief; sidecar `.json` is the machine surface) |
| `arch-baseline.json` | arch-health-scan |
| `arch-triage.json` | arch-health-scan |
| `arch-scan-report.md` | arch-health-scan (Markdown report from project scanner, e.g. `.devt/rules/arch-scan.py --report`) |
| `scanner-output.txt` | arch-health-scan (legacy stdout capture; new projects use `arch-scan-report.md` via the convention probe) |
| `evolution-report.md` + `.json` | arch-health-scan (`evolution scan` CLI — git-history behavioral metrics; prune-persistent like the other arch artifacts, cheaply regenerable) |

---

## Allowed patterns (slug variants)

When an artifact has multiple instances within one workflow (sliced PR reviews, multi-pass implementation variants), use these regex patterns. **No other slug patterns are accepted** — adding a new one means amending both `STATE_FILE_CONTRACT.allowed_patterns` in `state.cjs` AND `ALLOWED_PATTERNS` in `state-audit.cjs`, then re-running smoke tests.

| Pattern (regex) | Example | When to use |
|---|---|---|
| `^review-[A-Za-z0-9_.-]+\.md$` | `review-pr367-slice-A.md`, `review-architecture.md` | Sliced code reviews, themed reviews |
| `^impl-summary-[A-Za-z0-9_.-]+\.(md\|json)$` | `impl-summary-cr3.json` | Implementation variants when re-running impl with different scope |
| `^test-summary-[A-Za-z0-9_.-]+\.(md\|json)$` | `test-summary-integration.json` | Multiple test runs in one workflow |
| `^verification-[A-Za-z0-9_.-]+\.(md\|json)$` | `verification-rerun.json` | Multiple verifier passes |
| `^slice-[A-Za-z0-9_.-]+\.md$` | `slice-A.md`, `slice-frontend.md` | Generic slice files for non-review workflows |
| `^[a-z]+-summary\.md$` | `module-md-update-summary.md` | Topical summaries when none of the above fit |
| `^review-lane-[a-z][a-z0-9_]{0,31}\.md$` | `review-lane-api.md`, `review-lane-frontend.md` | Per-lane review output from `code-review-parallel.md`. Slug computed via `state.cjs::slugifyLaneName`. Multiple files allowed per workflow run. Not RESET_EXEMPT. |

**Pattern-allowed files are archived after 21 days** (`STATE_FILE_CONTRACT.stale_days_default`). Override per-run with `state cleanup --stale-days=N`.

---

## Ephemeral patterns (always wiped)

| Pattern | Example | Origin |
|---|---|---|
| `^\..*\.tmp$` | `.foo.tmp` | Hidden temp files (atomic-write orphans) |
| `^.*\.tmp$` | `bar.tmp` | Atomic-write orphans visible |
| `^.*~$` | `baz~` | Editor backups (vim, emacs autosave) |

These files should never exist on disk during normal operation. If they do, an atomic write failed or an editor crashed. `state cleanup` archives them every run regardless of `--stale-days`.

---

## Adding a new artifact (the only legal procedure)

If your new agent/workflow needs to write a new file to `.devt/state/`, do exactly one of:

1. **Exact filename** → add to `STATE_FILE_CONTRACT.additional_canonical` in `state.cjs` + describe it in the canonical inventory above. Use this for once-per-workflow artifacts.
2. **Slug variant** → check if your filename fits one of the existing patterns. If yes, you're done — just use the matching format. If no AND you need slug variants, propose a new `ALLOWED_PATTERNS` entry (requires smoke gate update).
3. **JSON sidecar for an existing markdown** → register in `JSON_SIDECAR_SCHEMAS`, add to `SIDECAR_FOR_MARKDOWN`, remove markdown's `## Status:` header if status moves to the sidecar.

**What NEVER to do**:
- Don't `Write` an arbitrary filename to `.devt/state/`. The smoke test scans `agents/*.md` and `workflows/*.md` for `.devt/state/<filename>` references and flags any that match no pattern in the contract.
- Don't bypass the contract by adding new ephemeral patterns. If a file truly needs to be temporary, it belongs in `os.tmpdir()` or `.devt/state/.archive/`, not at the top level.
- Don't disable smoke gates to ship a one-off filename. If the artifact is worth shipping, it's worth a contract entry.

---

## CLI reference

```bash
# Classify all files in .devt/state/ — read-only
node bin/devt-tools.cjs state audit

# Dry-run cleanup (safe; just reports what WOULD move)
node bin/devt-tools.cjs state cleanup

# Apply cleanup (moves to .devt/state/.archive/cleanup-<ts>/)
node bin/devt-tools.cjs state cleanup --apply

# Override staleness window for this run
node bin/devt-tools.cjs state cleanup --apply --stale-days=7
```

**`cleanup` is dry-run by default.** You must pass `--apply` for any move to happen. The smoke test gate enforces this safety default.

---

## How `state reset` and `state cleanup` differ

| | `state reset` | `state cleanup` |
|---|---|---|
| When invoked | Workflow boundary (`/devt:workflow --cancel`, end-of-workflow) | On-demand (manual) |
| What survives | RESET_EXEMPT only | canonical + non-stale pattern_allowed |
| What's archived | Everything not RESET_EXEMPT → `.archive/<ts>/` | ad_hoc + ephemeral + stale pattern_allowed → `.archive/cleanup-<ts>/` |
| Archive ring buffer | `state.archive_runs` (default 5) | Same ring buffer |
| Affects canonical files | Yes (most) | No |

**Rule of thumb**: `state reset` is for "I'm done with this workflow, sweep the workspace." `state cleanup` is for "I want to keep the active workflow but garbage-collect old slices and ad-hoc dumps."

### `state evict-workflow-artifacts` + `state cleanup` (both auto-fired on every `init *`)

`init.cjs` runs two complementary sweeps before re-stamping `workflow.yaml`. Together they cover three classes of stale state:

1. **Explicit allowlist** (evict-workflow-artifacts) — gate-satisfaction markers (`consolidator-ran.txt`, `auto-curator-considered.txt`, `reuse-search-attempted.txt`, `knowledge-candidates-none.txt`, etc.) plus verification sidecars (`verification.{md,json}`).
2. **Workflow-scoped canonical sweep** (evict-workflow-artifacts) — `WORKFLOW_SCOPED_CANONICAL` set in `state-audit.cjs` covers `review.{md,json}`, `test-summary.{md,json}`, `impl-summary.{md,json}`, `verification.{md,json}`, `debug-summary.md`. Each is single-PR; eviction is gated by `mtime < first_created_at` so current-session writes survive. Without this sweep, a verifier first-pass-fails because it grades against a stale `review.md` from a prior PR still on disk.
3. **Slug-variant regex sweep** (evict-workflow-artifacts) — matches `ALLOWED_PATTERNS` (`review-*.md`, `review-lane-*.{md,json}`, `impl-summary-*.{md,json}`, `test-summary-*.{md,json}`, `verification-*.{md,json}`, `slice-*.md`), also gated by `mtime < first_created_at`.
4. **Ad-hoc bucket sweep** (cleanupStateFiles) — `init.cjs` calls `cleanupStateFiles({ staleDays: 1, adHocStaleDays: 1, adHocCutoffMtime: <prior_workflow_created_at>, patternAllowedCutoffMtime: <prior_workflow_created_at> })`. Both `adHocCutoffMtime` AND `patternAllowedCutoffMtime` (when set) take precedence over their respective `*StaleDays` calendar-age gates; `init.cjs` reads `workflow.yaml::created_at` BEFORE the strip+restamp and passes it uniformly for both buckets so anything in either bucket older than the PRIOR workflow's start gets archived. Falls back to calendar-age gates when `created_at` is unavailable. Catches multi-PR-per-day residue in BOTH ad-hoc files (handfuls of leftover files from prior same-day sessions) AND pattern_allowed files (stale `review-lane-*.md` files from prior-day sessions that escape the calendar-age gate). Recent files in both buckets (current-session work-in-progress) are preserved.

Current-session writes are preserved by the mtime gates in (2), (3), and (4). Cross-workflow task outputs (`spec.md`, `plan.md`, `decisions.md`, `scratchpad.md`) are NOT in any sweep — they persist by design.

---

## Cross-references

- [`CLAUDE.md`](../CLAUDE.md) — entry point: orchestrator architecture + critical contracts
- [`docs/AGENT-CONTRACTS.md`](AGENT-CONTRACTS.md) — JSON sidecar contract, sidecar-only status routing (consumes `JSON_SIDECAR_SCHEMAS` referenced here)
- [`docs/INTERNALS.md`](INTERNALS.md) — `state.cjs` internals: locking, validation, session metadata
- [`docs/MEMORY.md`](MEMORY.md) — permanent knowledge layer (`.devt/memory/`), distinct from this directory's per-workflow artifacts
- `bin/modules/state.cjs` — machine-readable contract: `STATE_FILE_CONTRACT` + `ARTIFACT_SCHEMA` + `JSON_SIDECAR_SCHEMAS` + `SIDECAR_FOR_MARKDOWN` + `RESET_EXEMPT`
- `bin/modules/state-audit.cjs` — regex compilation: `ALLOWED_PATTERNS` + `EPHEMERAL_PATTERNS`
