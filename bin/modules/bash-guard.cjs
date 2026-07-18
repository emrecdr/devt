"use strict";

/**
 * Bash safety guard — PreToolUse hook on Bash tool calls.
 *
 * Two narrow rule families with zero legitimate dev use, so no allowlist needed:
 *   destroy   — filesystem-wipe patterns (rm -rf /, dd of=/dev/sd*, mkfs, …)
 *   no_verify — git operations that skip hooks or GPG signing
 *
 * Returns {decision: "deny", source, reason, …} on match; null on allow.
 * Deny records append to .devt/state/preflight-denies.jsonl with a `source` field
 * so the stuck-detector can count them alongside preflight denies.
 */

const fs = require("fs");
const path = require("path");
const { appendJsonl } = require("./logger.cjs");

const DESTROY_PATTERNS = [
  {
    rx: /^\s*rm\s+(?:-[a-zA-Z]*[rRf][a-zA-Z]*\s+)+(?:\/(?:\s|$)|~(?:\/|\s|$)|\$HOME|\.\.(?:\/|\s|$)|\*(?:\s|$))/,
    id: "rm-root",
    reason:
      "Refused destructive `rm -rf` targeting filesystem root, $HOME, parent dirs, or a bare wildcard. If intentional, narrow the path explicitly (e.g. `rm -rf ./dist`) or ask the user to authorize the wider scope.",
  },
  {
    rx: /^\s*dd\s+(?:[^|;&]+\s+)?of=\/dev\/(?:sd|nvme|disk|mmcblk|hd)/,
    id: "dd-block-device",
    reason:
      "Refused `dd` writing to a raw block device. This overwrites disks. If intentional, ask the user to authorize the specific device.",
  },
  {
    rx: /^\s*mkfs(?:\.|\s)/,
    id: "mkfs",
    reason: "Refused filesystem-creation command (`mkfs`). This wipes the target device. Ask the user to authorize.",
  },
  {
    rx: /^\s*:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    id: "fork-bomb",
    reason: "Refused fork bomb pattern. This is never a legitimate dev operation.",
  },
  {
    rx: /^\s*>\s*\/dev\/(?:sd|nvme|disk|mmcblk|hd)/,
    id: "redirect-block-device",
    reason: "Refused stdout redirect to a raw block device. This overwrites disks.",
  },
];

const NO_VERIFY_PATTERNS = [
  {
    rx: /\bgit\s+(?:commit|push|merge|rebase|cherry-pick)\b[^|;&]*\s--no-verify\b/,
    id: "no-verify",
    reason:
      "Refused `--no-verify` on a git operation. Skipping hooks requires explicit user authorization (golden rule). Ask the user before retrying with the flag.",
  },
  {
    rx: /\bgit\s+(?:commit|tag|push)\b[^|;&]*\s--no-gpg-sign\b/,
    id: "no-gpg-sign",
    reason:
      "Refused `--no-gpg-sign` on a git operation. Bypassing GPG signing requires explicit user authorization.",
  },
];

// Git destructive operations narrower than the general DESTROY_PATTERNS. Each
// pattern targets an operation that overwrites or loses work irrecoverably AND
// has no legitimate fast-path in a normal dev workflow. `git reset --hard` is
// deliberately NOT included — devt's own self-update flow (workflows/update.md)
// resets to origin/main, and forcing it through the deny path would block the
// update mechanism. Force-push to a project branch is fine; force-push to a
// shared/protected branch is what we deny.
const GIT_DESTRUCTIVE_PATTERNS = [
  {
    // --force-with-lease is the safe variant — checks the remote hasn't moved under us — and is
    // not blocked. The negative lookahead `(?!-with-lease)` excludes it while still catching `--force`.
    rx: /\bgit\s+push\b[^|;&]*\s(?:--force(?!-with-lease)|-f)\b[^|;&]*\b(?:main|master|release(?:\/[\w.-]+)?|prod(?:uction)?|develop)\b/,
    id: "force-push-protected",
    reason:
      "Refused force-push to a protected branch (main, master, release, prod, develop). This overwrites upstream history shared with other contributors. Use --force-with-lease for a safer variant, or ask the user to authorize the specific branch override.",
  },
  {
    rx: /\bgit\s+clean\s+(?:-[a-zA-Z]*x[a-zA-Z]*|-[a-zA-Z]+\s+-[a-zA-Z]*x[a-zA-Z]*)\b/,
    id: "clean-ignored-x",
    reason:
      "Refused `git clean -x` (or any flag combo including `x`). This deletes gitignored files including `.env`, build artifacts, and credentials. If intentional, narrow to specific paths or ask the user.",
  },
  {
    rx: /\bgit\s+checkout\s+--\s+(?:\.|\*)(?:\s|$)/,
    id: "checkout-mass-discard",
    reason:
      "Refused `git checkout -- .` or `git checkout -- *` (mass-discard of all working-tree changes). If intentional, narrow to specific files or ask the user.",
  },
];

// Strip the contents of quoted segments so patterns don't false-match on text
// inside a `-m "message"` body. We replace the body with empty quotes (`""`)
// instead of removing entirely so token boundaries and whitespace count stay intact.
function stripQuotedSegments(s) {
  return s
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function checkCommand(command) {
  if (typeof command !== "string" || !command) return null;
  const probe = stripQuotedSegments(command);
  for (const p of DESTROY_PATTERNS) {
    if (p.rx.test(probe)) return { decision: "deny", source: "bash_destroy", rule_id: p.id, reason: p.reason };
  }
  for (const p of NO_VERIFY_PATTERNS) {
    if (p.rx.test(probe)) return { decision: "deny", source: "no_verify", rule_id: p.id, reason: p.reason };
  }
  for (const p of GIT_DESTRUCTIVE_PATTERNS) {
    if (p.rx.test(probe)) return { decision: "deny", source: "git_destructive", rule_id: p.id, reason: p.reason };
  }
  return null;
}

// findProjectRoot is replicated here rather than imported from config.cjs so the
// hook stays usable in environments where the full config module hasn't loaded.
function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".devt")) || fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function run(subcommand) {
  if (subcommand !== "check") {
    process.stderr.write("Usage: bash-guard check  (reads tool-call JSON from stdin)\n");
    return 2;
  }

  const input = readStdinSync();
  if (!input) {
    process.stdout.write("{}");
    return 0;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    // Malformed input — fail open, never block legitimate work on a parse error.
    process.stdout.write("{}");
    return 0;
  }

  const command = (payload.tool_input || {}).command || "";
  const verdict = checkCommand(command);

  if (!verdict) {
    process.stdout.write("{}");
    return 0;
  }

  // Forensic log — append-only, atomic per record via logger.cjs's 4 KB PIPE_BUF cap.
  // Wrapped so a log failure never blocks the deny path itself.
  try {
    const root = findProjectRoot();
    const stateDir = path.join(root, ".devt", "state");
    if (fs.existsSync(stateDir)) {
      appendJsonl(path.join(stateDir, "preflight-denies.jsonl"), {
        source: verdict.source,
        ts: new Date().toISOString(),
        tool: "Bash",
        command_excerpt: command.slice(0, 200),
        rule_id: verdict.rule_id,
        reason: verdict.reason,
      });
    }
  } catch {
    /* never block on log failure */
  }

  // Recovery grammar appended once at emit time (not per-pattern): a deny is
  // a redirect, not a halt — the agent should keep working via a safer path.
  // The jsonl record above keeps the raw rule reason for telemetry classification.
  const reasonOut =
    verdict.reason +
    " Deny is a redirect, not a stop: continue the task via a safer path to the same goal — do not retry the exact command and do not work around the guard. If no safer path exists, ask the user.";

  process.stdout.write(
    JSON.stringify({
      decision: "deny",
      source: verdict.source,
      rule_id: verdict.rule_id,
      reason: reasonOut,
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reasonOut },
    }),
  );
  return 0;
}

module.exports = { checkCommand, run, DESTROY_PATTERNS, NO_VERIFY_PATTERNS, GIT_DESTRUCTIVE_PATTERNS };
