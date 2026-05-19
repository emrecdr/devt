# `.devt/state/` Directory Rules

**The state directory is governed by a strict contract.** This document is the single source of truth for what files are allowed there, who writes them, and what happens to ad-hoc names.

Source of truth (machine-readable): `bin/modules/state.cjs::STATE_FILE_CONTRACT` + `ARTIFACT_SCHEMA` + `JSON_SIDECAR_SCHEMAS` + `JSON_INPUT_SCHEMAS` + `SIDECAR_FOR_MARKDOWN` + `RESET_EXEMPT`.

Source of truth (regex compilation): `bin/modules/state-audit.cjs::ALLOWED_PATTERNS` + `EPHEMERAL_PATTERNS`. These two surfaces are smoke-test enforced to agree with the declared contract.

---

## The 4-bucket classifier

Every file in `.devt/state/` belongs to exactly one of these buckets:

| Bucket | What it is | Survives `state reset`? | Archived by `state cleanup`? |
|---|---|---|---|
| **canonical** | Listed by exact filename in the contract | Per RESET_EXEMPT — most are wiped, 5 survive | Never |
| **pattern_allowed** | Matches an `ALLOWED_PATTERNS` regex | No (workflow-scoped) | Only when `mtime > stale_days_default` (default 21) |
| **ephemeral** | Matches `EPHEMERAL_PATTERNS` (`.tmp`, `~`) | No | Always (every cleanup) |
| **ad_hoc** | Matches NOTHING in the contract | No | Always (every cleanup) |

Files in `ad_hoc` are the failure mode. They appear when an agent or human writes a filename outside the contract. Smoke tests catch this at code review time; `state audit` catches it at runtime.

---

## Canonical file inventory

### Always-present (workflow control plane)

| Filename | Written by | Purpose | RESET_EXEMPT |
|---|---|---|---|
| `workflow.yaml` | orchestrator (`state update`) | Active workflow state (id, phase, type, status, verdict, autonomous flags) | No — wiped on reset |
| `scratchpad.md` | any agent | Ephemeral cross-agent notes; reset between workflows | No |
| `.lock` | `state update` | PID-based mutex preventing concurrent writes | ✓ Yes |

### Per-workflow artifacts (markdown only)

| Filename | Written by | Purpose | Status enum source |
|---|---|---|---|
| `plan.md` | architect / planner | Implementation plan | (not status-gated) |
| `spec.md` | spec-phase agent | Phase requirements clarification | (not status-gated) |
| `scope.md` | orchestrator | Workflow scope text | (not status-gated) |
| `decisions.md` | orchestrator | DEC-NNN entries from `/devt:clarify` | (not status-gated) |
| `research.md` | researcher | Pattern + pitfall investigation | `ARTIFACT_SCHEMA` |
| `scan-results.md` | architect (arch-health) | Architecture scan output | (not status-gated) |
| `scan-delta.md` | architect (arch-health) | Delta from prior baseline | (not status-gated) |
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
| `memory-suggestions.md` | discovery engine | Curator candidate pool | (not status-gated) |
| `regression-baseline.md` | orchestrator | Pre-impl test baseline | (not status-gated) |
| `review-scope.md` | orchestrator | Code-review file list | (not status-gated) |
| `review.md` | code-reviewer | Code review body | Sidecar (review.json) |
| `graph-impact.md` | orchestrator | Graphify-derived impact map | (not status-gated) |
| `pr-impact.md` | orchestrator | Legacy alias for graph-impact | (not status-gated) |
| `continue-here.md` | `/devt:pause` | Session-resume narrative | (not status-gated) |

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
| `handoff.json` | `/devt:pause` | `/devt:next` | `JSON_INPUT_SCHEMAS` |
| `preflight-brief.json` | `preflight.cjs::generate` | every dispatch (`scope_hint`, `scope_trust`) | inline shape; informally documented in `preflight.cjs::generate` |

### Forensic / persistent logs (RESET_EXEMPT)

| Filename | Source | Format | Survives reset? |
|---|---|---|---|
| `.lock` | `state update` PID mutex | JSON | ✓ |
| `.archive/` | `state reset` + `state cleanup` | directory (ring buffer, default 5 snapshots) | ✓ |
| `deferred.md` | `/devt:defer`, deferred.cjs | markdown with DEF-NNN entries | ✓ |
| `preflight-denies.jsonl` | preflight hook + bash-guard + graph_loader | JSONL (one record per deny) | ✓ |
| `dispatch-warnings.jsonl` | dispatch-scope-guard hook | JSONL (advisory only) | ✓ |

### Audit-only

| Filename | Source |
|---|---|
| `preflight-brief.md` | preflight.cjs::generate (human-readable Brief; sidecar `.json` is the machine surface) |
| `arch-baseline.json` | arch-health-scan |
| `arch-triage.json` | arch-health-scan |
| `scanner-output.txt` | arch-health-scan |

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
| When invoked | Workflow boundary (`/devt:cancel-workflow`, end-of-workflow) | On-demand (manual) |
| What survives | RESET_EXEMPT only (5 entries) | canonical + non-stale pattern_allowed |
| What's archived | Everything not RESET_EXEMPT → `.archive/<ts>/` | ad_hoc + ephemeral + stale pattern_allowed → `.archive/cleanup-<ts>/` |
| Archive ring buffer | `state.archive_runs` (default 5) | Same ring buffer |
| Affects canonical files | Yes (most) | No |

**Rule of thumb**: `state reset` is for "I'm done with this workflow, sweep the workspace." `state cleanup` is for "I want to keep the active workflow but garbage-collect old slices and ad-hoc dumps."
