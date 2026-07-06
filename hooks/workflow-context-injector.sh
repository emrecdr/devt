#!/usr/bin/env bash
[[ $- == *i* ]] && return
# Inject active workflow state into user prompts.
# Reads workflow state via devt-tools.cjs and outputs additionalContext JSON.
# Exit 0 always — non-zero would block the user's prompt.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# State-read cache keyed by workflow.yaml mtime. Hook fires on every
# user prompt; the prior unconditional `node devt-tools.cjs state read` paid
# ~30-60ms cold-start per prompt. Cache invalidates automatically because
# state.cjs::updateState rewrites workflow.yaml on every state change, and we
# pin the cache file's mtime to match.
WF_PATH="$(pwd)/.devt/state/workflow.yaml"
CACHE_DIR="${TMPDIR:-/tmp}/devt-cache"
# 12-char project hash — shasum is universal (macOS + Linux).
PROJ_HASH=$(printf '%s' "$(pwd)" | shasum 2>/dev/null | cut -c1-12)
CACHE_FILE="$CACHE_DIR/wf-state-$PROJ_HASH.json"
STATE_JSON=""

# Hook stdin carries the UserPromptSubmit event JSON; session_id keys the
# once-per-session config-alert dedup below. Empty when the runner didn't
# forward stdin — dedup then degrades to every-prompt (fail-loud is the
# right failure mode for a safety banner).
HOOK_INPUT=$(cat 2>/dev/null || true)
SESSION_ID=$(printf '%s' "$HOOK_INPUT" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
ALERT_MARKER="$CACHE_DIR/config-alert-$PROJ_HASH"
mkdir -p "$CACHE_DIR" 2>/dev/null || true

if [ -f "$WF_PATH" ] && [ -f "$CACHE_FILE" ]; then
  # stat -f for BSD/macOS, stat -c for GNU/Linux — try both.
  WF_MTIME=$(stat -f %m "$WF_PATH" 2>/dev/null || stat -c %Y "$WF_PATH" 2>/dev/null || echo 0)
  CACHE_MTIME=$(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0)
  if [ "$WF_MTIME" != "0" ] && [ "$CACHE_MTIME" != "0" ] && [ "$CACHE_MTIME" -ge "$WF_MTIME" ]; then
    STATE_JSON=$(cat "$CACHE_FILE" 2>/dev/null || true)
  fi
fi

if [ -z "$STATE_JSON" ]; then
  STATE_JSON=$(node "${PLUGIN_ROOT}/bin/devt-tools.cjs" state read 2>/dev/null) || exit 0
  # Populate cache for the next prompt. Pin cache mtime to workflow.yaml mtime
  # so the next mtime comparison reuses without staleness.
  if [ -n "$STATE_JSON" ]; then
    mkdir -p "$CACHE_DIR" 2>/dev/null || true
    printf '%s' "$STATE_JSON" > "$CACHE_FILE" 2>/dev/null || true
    [ -f "$WF_PATH" ] && touch -r "$WF_PATH" "$CACHE_FILE" 2>/dev/null || true
  fi
fi

# Parse state and build context using node (proper JSON handling)
RESULT=$(node -e "
  const state = JSON.parse(process.argv[1]);
  const _pluginRoot = process.argv[2] || '';
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');

  // Walk-up project-root resolution so the hook works correctly when Claude
  // Code is launched from a subdirectory of the project. Matches
  // config.cjs::findProjectRoot semantics (walks up looking for .devt/ or
  // .git/; falls back to cwd if no marker found).
  function _hookFindProjectRoot() {
    let dir = process.cwd();
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.devt')) || fs.existsSync(path.join(dir, '.git'))) {
        return dir;
      }
      dir = path.dirname(dir);
    }
    return process.cwd();
  }
  const _projectRoot = _hookFindProjectRoot();

  // Config-drift banner. Field-observed: a project's .devt/config.json
  // overriding dispatch_hygiene_mode=warn (or similar safety mode) can be
  // silently inherited — operators have no way to recall when or why a
  // mode was flipped from the fail-secure default. Banner fires on every
  // UserPromptSubmit (active OR idle) so safety-floor weakening is visible
  // at the moment the operator decides what to dispatch. Cheap: one
  // shallow JSON read per prompt, only the explicit project overrides
  // (not the merged config). memory.preflight_mode also watched (defaults
  // to 'block' per state.cjs; warn/off means the PreToolUse PREFLIGHT-line
  // check is downgraded).
  const configAlertLines = [];
  try {
    const cfgPath = path.join(_projectRoot, '.devt', 'config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const drifts = [];
      if (cfg.dispatch_hygiene_mode && cfg.dispatch_hygiene_mode !== 'block') {
        drifts.push('dispatch_hygiene_mode=' + cfg.dispatch_hygiene_mode);
      }
      if (cfg.claim_check_mode && cfg.claim_check_mode !== 'block') {
        drifts.push('claim_check_mode=' + cfg.claim_check_mode);
      }
      if (cfg.graphify_decision_mode && cfg.graphify_decision_mode !== 'block') {
        drifts.push('graphify_decision_mode=' + cfg.graphify_decision_mode);
      }
      if (cfg.memory && cfg.memory.preflight_mode && cfg.memory.preflight_mode !== 'block') {
        drifts.push('memory.preflight_mode=' + cfg.memory.preflight_mode);
      }
      if (drifts.length > 0) {
        configAlertLines.push(
          '[devt config alert] safety floor weakened: ' + drifts.join(', ') +
          ' (fail-secure default = block). Restore: devt config set <key> block. ' +
          'Audit: devt config get'
        );
      }
    }
  } catch { /* config read/parse failure — silent (don't break the hook) */ }

  // Once-per-session dedup for the config alert. Field-observed: every-prompt
  // firing (~15-19x/session) trains operators to ignore the banner — the
  // opposite of its purpose — and SessionStart already surfaces the same
  // warning at session open. Marker stores the last-alerted session_id per
  // project; a different session (or a missing marker) re-alerts once.
  // Missing session_id (runner didn't forward hook stdin) keeps the
  // every-prompt behavior.
  const _sessionId = process.argv[3] || '';
  const _alertMarker = process.argv[4] || '';
  if (configAlertLines.length > 0 && _sessionId && _alertMarker) {
    try {
      if (fs.existsSync(_alertMarker) && fs.readFileSync(_alertMarker, 'utf8').trim() === _sessionId) {
        configAlertLines.length = 0;
      } else {
        fs.writeFileSync(_alertMarker, _sessionId);
      }
    } catch { /* marker IO failure — keep alerting */ }
  }

  // Active workflow — compact status line.
  // Format is human-facing only (no programmatic consumers). Compactness wins
  // tokens on every UserPromptSubmit during an active workflow.
  if (state.active) {
    const tier = state.tier || '?';
    const phase = state.phase || '?';
    const iter = state.iteration || 0;
    const task = state.task ? (state.task.length > 50 ? state.task.slice(0, 47) + '...' : state.task) : 'none';
    const flags = [];
    if (state.autonomous) flags.push('auto');
    if (state.tdd_mode) flags.push('tdd');
    if (state.stop_at_phase) flags.push('to=' + state.stop_at_phase);
    if (state.only_phase) flags.push('only=' + state.only_phase);
    const flagStr = flags.length > 0 ? '·' + flags.join('+') : '';
    const lines = ['[devt] ' + tier + '/' + phase + (iter > 1 ? '·i' + iter : '') + flagStr + ' · \"' + task + '\"'];

    // Workflow staleness warning. The dispatch-hygiene kill-counter scopes
    // by workflow.yaml::created_at, so a 3+ day workflow accumulates raw
    // dispatches across many sessions and trips the threshold. Operator's
    // mental model is per-session; counter's is per-workflow. Bridge the
    // gap with an actionable warning when the workflow has been open >24h
    // — operator decides whether to /devt:workflow --cancel (no auto-reset).
    if (state.created_at) {
      const wfStartMs = new Date(state.created_at).getTime();
      if (Number.isFinite(wfStartMs)) {
        const ageMs = Date.now() - wfStartMs;
        const dayMs = 24 * 60 * 60 * 1000;
        if (ageMs >= dayMs) {
          const ageDays = Math.floor(ageMs / dayMs);
          lines.push('[devt] workflow open ' + ageDays + 'd (since ' + state.created_at.slice(0, 10) + '); long-running — consider /devt:workflow --cancel');
        }
      }
    }

    // A parallel-canonical banner cannot fire from this hook: it receives
    // state-only via process.argv[1], not the UserPromptSubmit event JSON with
    // input.prompt. Emitting one would need a separate UserPromptSubmit hook OR
    // plumbing stdin into this one.

    // preflight-brief staleness banner. Operators can cite preflight-brief.json
    // data from a prior workflow run as fresh; the workflow.yaml-age banner
    // above covers workflow age but NOT .devt/state/ artifact age. Delegates to
    // state.cjs::isArtifactFresh which already prefers first_created_at
    // (immutable session anchor) over created_at (rotates on workflow_type
    // transitions) — using the inline arithmetic would false-fire on every
    // dev->debug rotation.
    try {
      const briefPath = path.join(_projectRoot, '.devt/state/preflight-brief.json');
      // state.cjs lives in PLUGIN_ROOT (the devt repo), not _projectRoot
      // (the consumer project) — the plugin can be installed anywhere.
      const stateMod = require(path.join(_pluginRoot, 'bin/modules/state.cjs'));
      // isArtifactFresh's getStateDir() walks from process.cwd() — chdir into
      // _projectRoot so it finds the consumer's workflow.yaml, not the plugin's.
      const prevCwd = process.cwd();
      process.chdir(_projectRoot);
      let f;
      try { f = stateMod.isArtifactFresh(briefPath); }
      finally { process.chdir(prevCwd); }
      // 4h staleness threshold — older than that is a prior session, not just slow rotation.
      const staleThresholdSeconds = 4 * 60 * 60;
      if (!f.fresh && typeof f.age_seconds === 'number' && f.age_seconds > staleThresholdSeconds) {
        const ageH = Math.round(f.age_seconds / 3600);
        lines.push('[devt] preflight-brief.json STALE (' + ageH + 'h older than workflow start) — run /devt:preflight before relying on memory_signal/governing-doc data');
      }
    } catch { /* fs probe / state module load failure non-fatal */ }

    // Session-scoped telemetry push. Field-observed: telemetry CLIs exist
    // but operators forget them when head-down in a workflow — discovery
    // surfaces are too passive for an LLM operator. UserPromptSubmit
    // injection surfaces the same signals without requiring the operator
    // to ask. All probes fail-open: any error path → no signal line, no
    // broken hook.
    const workflowStart = state.first_created_at || state.created_at || null;
    if (workflowStart) {
      const startMs = new Date(workflowStart).getTime();
      const signals = [];

      // Probe 1: dispatch-warnings.jsonl — dual-window scan.
      // Inline JSONL scan — uses resolved _projectRoot so subdir invocations
      // still find the canonical state file. cliff++ only on actionable
      // signals: task-truncation-detector tags every record signal in
      // {healthy, near_cliff, low_output, mid_task}. Counting ALL
      // task_output_bytes records (regardless of signal) produces cry-wolf
      // noise. Records predating the discriminator lack the signal field;
      // treated as noise.
      //
      // Window design: count records since workflow start (cumulative) AND
      // in the last hour (recent activity). Display recent count primarily;
      // surface cumulative only when workflow age > 24h to avoid noise from
      // long-running workflows where 'since workflow start' has drifted
      // from operator's mental model of 'this session'.
      const oneHourMs = 60 * 60 * 1000;
      const recentCutoffMs = Date.now() - oneHourMs;
      const workflowAgeMs = Date.now() - startMs;
      const STALE_WORKFLOW_MS = 24 * 60 * 60 * 1000;
      try {
        const dispatchPath = path.join(_projectRoot, '.devt', 'state', 'dispatch-warnings.jsonl');
        if (fs.existsSync(dispatchPath)) {
          const content = fs.readFileSync(dispatchPath, 'utf8');
          let rawRecent = 0, cliffRecent = 0, rawCumulative = 0, cliffCumulative = 0;
          const sourceCounts = {};  // for C2 inline --by-source output
          for (const ln of content.split('\n')) {
            if (!ln) continue;
            try {
              const r = JSON.parse(ln);
              if (!r.ts) continue;
              const tsMs = new Date(r.ts).getTime();
              if (tsMs < startMs) continue;
              const isRaw = r.source === 'raw_dispatch';
              const isCliff = r.source === 'task_output_bytes' && r.signal && r.signal !== 'healthy';
              if (isRaw) {
                rawCumulative++;
                if (tsMs >= recentCutoffMs) {
                  rawRecent++;
                  const agent = r.agent || 'unknown';
                  sourceCounts[agent] = (sourceCounts[agent] || 0) + 1;
                }
              } else if (isCliff) {
                cliffCumulative++;
                if (tsMs >= recentCutoffMs) cliffRecent++;
              }
            } catch { /* malformed line */ }
          }
          if (rawRecent > 0 || cliffRecent > 0) {
            let signal = rawRecent + ' raw_dispatch + ' + cliffRecent + ' cliff signal(s) (last 1h)';
            if (workflowAgeMs >= STALE_WORKFLOW_MS && (rawCumulative > rawRecent || cliffCumulative > cliffRecent)) {
              const ageDays = Math.floor(workflowAgeMs / (24 * 60 * 60 * 1000));
              signal += '; total this workflow (' + ageDays + 'd): ' + rawCumulative + ' raw + ' + cliffCumulative + ' cliff';
            }
            if (rawRecent > 0) {
              const topAgents = Object.entries(sourceCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([a, n]) => a + '=' + n)
                .join(', ');
              signal += ' [' + topAgents + ']';
            }
            signals.push(signal);
          }
        }
      } catch { /* fs error — silent */ }

      // Probe 2: inherited source edits via git status, scoped to mtime >
      // workflow start. 1-second timeout caps hook latency cost.
      // git invocation uses _projectRoot so git status reflects the
      // canonical repo's working tree (matches the dispatch-warnings probe
      // above).
      try {
        const porcelain = execSync('git status --porcelain', {
          cwd: _projectRoot,
          timeout: 1000,
          encoding: 'utf8',
        });
        let inherited = 0;
        for (const ln of porcelain.split('\n')) {
          if (!ln) continue;
          const status = ln.slice(0, 2);
          const filename = ln.slice(3).trim();
          if (status === '??' || status === '!!') continue;
          try {
            const stat = fs.statSync(path.join(_projectRoot, filename));
            if (stat.mtimeMs > startMs) inherited++;
          } catch { /* deleted file or stat error */ }
        }
        if (inherited > 0) {
          signals.push(inherited + ' uncommitted source edit(s) since workflow start');
        }
      } catch { /* git error — silent */ }

      if (signals.length > 0) {
        lines.push('[devt session signal] ' + signals.join('; ') + ' — inspect: dispatch warnings --by-source | state check-inherited-edits');
      }
    }

    // Prepend config-drift banner ABOVE the workflow status so the
    // safety-floor weakening is the topmost signal the operator sees.
    const allLines = configAlertLines.concat(lines);
    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: allLines.join('\n')
      }
    };
    process.stdout.write(JSON.stringify(output));
  } else if (configAlertLines.length > 0) {
    // Idle session BUT config is drifted — emit the banner standalone.
    // Idle-state activity is otherwise silent (per the comment below) but
    // safety-floor weakening is too important to hide; if the operator is
    // about to dispatch ANYTHING off-script, they should know first.
    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: configAlertLines.join('\n')
      }
    };
    process.stdout.write(JSON.stringify(output));
  }
  // No active workflow + no config drift — silent. Idle state is reachable
  // via explicit /devt:status or /devt:next; pinning it into every prompt
  // costs tokens long after the workflow ended without adding load-bearing
  // context.
" "$STATE_JSON" "$PLUGIN_ROOT" "$SESSION_ID" "$ALERT_MARKER" 2>/dev/null) || exit 0

# printf avoids echo's flag interpretation (-n, -e) regardless of JSON content
[ -n "$RESULT" ] && printf '%s\n' "$RESULT"
exit 0
