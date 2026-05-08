# Uninstall — Reset or remove devt

Interactive uninstall workflow. Lets the user choose between four destructiveness levels and confirms before any destructive operation.

---

<purpose>
Replace the manual reset/uninstall instructions in the README with a guided, confirmation-gated flow that handles both project-local reset (most common) and plugin-wide uninstall.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- Run from the project root (where `.devt/` lives)
</prerequisites>

<available_agent_types>
This workflow does not dispatch subagents — it runs bash directly via the Bash tool.
</available_agent_types>

<agent_skill_injection>
Not applicable — no subagents are spawned.
</agent_skill_injection>

---

## Steps

<step name="detect_state" gate="user has seen what exists in this project">
## Step 1: Detect installation state

Run a read-only inventory so the user knows what would be touched:

```bash
echo "=== Project devt footprint ==="
[ -d .devt ] && echo ".devt/ present ($(du -sh .devt 2>/dev/null | cut -f1))" || echo ".devt/ absent"
[ -f .devt/config.json ] && echo "  config.json present" || true
[ -d .devt/memory ] && echo "  memory/ present ($(find .devt/memory -name '*.md' 2>/dev/null | wc -l | tr -d ' ') docs)" || true
[ -f .devt/state/deferred.md ] && echo "  deferred queue: $(grep -c '^- DEF-' .devt/state/deferred.md 2>/dev/null || echo 0) items" || true
[ -f .mcp.json ] && echo ".mcp.json present" || true
[ -d .claude/agent-memory/devt-debugger ] && echo ".claude/agent-memory/devt-debugger present" || true
grep -q "^\.devt/" .gitignore 2>/dev/null && echo ".gitignore has devt entries" || true
[ -f .git/hooks/post-commit ] && grep -q "devt\|CLAUDE_PLUGIN_ROOT" .git/hooks/post-commit 2>/dev/null && echo ".git/hooks/post-commit is devt-managed" || true
[ -d graphify-out ] && echo "graphify-out/ present (cache)" || true
[ -d .claude-mem ] && echo ".claude-mem/ present (mid-session capture db)" || true
```

Show the inventory to the user — they need to know what each mode will remove.
</step>

<step name="select_mode" gate="user has picked a mode">
## Step 2: Pick mode

Ask via AskUserQuestion (single question, 5 options):

```yaml
question: "What kind of uninstall do you want?"
header: "Uninstall mode"
multiSelect: false
options:
  - label: "Reinit — re-scaffold rules + config from template, keep memory & lessons & deferred queue"
    description: "Safest. Overwrites .devt/rules/ and .devt/config.json from a template. Does NOT touch .devt/memory/ (ADR/CON/FLOW/REJ/LES) or .devt/state/deferred.md. Use when project conventions changed but you want to keep accumulated knowledge."
  - label: "Project reset — wipe all .devt/ in this project (Recommended for fresh start)"
    description: "Destructive — removes .devt/ entirely (config, rules, state, memory, lessons, deferred). Leaves files outside .devt/ alone (.mcp.json, .claude/, .gitignore entries, git hooks). Backs up to .devt.bak.YYYYMMDD first."
  - label: "Full reset — wipe .devt/ AND scattered files outside .devt/"
    description: "Most destructive project-local option. Also removes .mcp.json, .claude/agent-memory/devt-debugger, devt-managed git hooks, devt entries from .gitignore. Optional: graphify-out/ and .claude-mem/ caches. Backs up first."
  - label: "Plugin uninstall — remove the devt plugin itself (does not touch any project's .devt/)"
    description: "Removes the plugin code from your Claude Code install. Project .devt/ directories are owned by your repos and stay untouched — uninstall those separately with one of the modes above if needed."
  - label: "Cancel — exit without changes"
    description: "No-op. Nothing is modified."
```

Wait for the user's selection. Persist the choice to a shell variable for the next step.
</step>

<step name="confirm_destructive" gate="destructive ops have explicit confirmation">
## Step 3: Confirm before destructive operations

For modes "Project reset" and "Full reset" only: ask a second AskUserQuestion to confirm:

```yaml
question: "This will permanently remove devt artifacts in this project. A backup will be created at .devt.bak.YYYYMMDD/ first. Proceed?"
header: "Confirm destructive uninstall"
multiSelect: false
options:
  - label: "Yes, proceed with backup"
    description: "Creates .devt.bak.YYYYMMDD/ before deleting; you can restore by `mv .devt.bak.YYYYMMDD .devt`."
  - label: "No, cancel"
    description: "Abort. Nothing is modified."
```

For "Reinit" and "Plugin uninstall": no second confirmation needed (Reinit is non-destructive of memory; Plugin uninstall is per-user, not per-project).

For "Cancel": skip to Step 5 with no changes.
</step>

<step name="execute" gate="chosen mode has been executed">
## Step 4: Execute the chosen mode

### Mode A — Reinit

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" setup --mode reinit
```

The setup wizard auto-detects the appropriate template. Add `--template <name>` to force a specific one.

### Mode B — Project reset

```bash
BACKUP=".devt.bak.$(date +%Y%m%d-%H%M%S)"
[ -d .devt ] && cp -r .devt "$BACKUP" && echo "Backup created: $BACKUP"
rm -rf .devt/
echo "Removed .devt/. Run /devt:init to start fresh."
```

### Mode C — Full reset

```bash
BACKUP=".devt.bak.$(date +%Y%m%d-%H%M%S)"
[ -d .devt ] && cp -r .devt "$BACKUP" && echo "Backup created: $BACKUP"
rm -rf .devt/
rm -f .mcp.json
rm -rf .claude/agent-memory/devt-debugger 2>/dev/null

# Strip devt entries from .gitignore (preserves user-authored lines)
if [ -f .gitignore ]; then
  cp .gitignore .gitignore.bak
  sed -i.tmp -e '/^\.devt\//d' -e '/^\.claude\/agent-memory\//d' .gitignore && rm -f .gitignore.tmp
fi

# Remove devt-managed git post-commit hook (only if it references devt)
HOOK=.git/hooks/post-commit
if [ -f "$HOOK" ] && grep -q "devt\|CLAUDE_PLUGIN_ROOT" "$HOOK"; then
  rm "$HOOK"
  echo "Removed devt-managed .git/hooks/post-commit"
fi

echo ""
echo "Optional integration caches (NOT removed by default — uncomment if desired):"
echo "  rm -rf graphify-out/   # only if you don't want the Graphify cache"
echo "  rm -rf .claude-mem/    # only if you don't use claude-mem elsewhere"
echo ""
echo "Full reset complete. Run /devt:init to start fresh."
```

### Mode D — Plugin uninstall

This depends on how devt was installed. Detect and instruct:

```bash
echo "Detecting install type..."
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" update install-type
```

Based on the result, instruct the user — do NOT auto-run these (the user must own the plugin install lifecycle):

- `plugin-system` → run `/plugin uninstall devt` in Claude Code
- `git-clone` → `rm -rf <path-shown-by-install-type>` (or wherever they cloned it)
- `dev-mode` (`--plugin-dir <path>`) → just stop launching Claude with that flag

### Mode E — Cancel

No-op. Print "No changes made." and proceed to Step 5.
</step>

<step name="report" gate="user knows what was changed">
## Step 5: Report

Print a clean summary of:
- What was removed (list each path)
- Where the backup is (if any)
- Next recommended action (`/devt:init` for project resets; nothing for plugin uninstall or cancel)

Done.
</step>

---

<deviation_rules>
1. **Never destroy without confirmation**: Modes B and C MUST get the second AskUserQuestion confirmation before any `rm -rf`.
2. **Always back up first**: Modes B and C create a `.devt.bak.YYYYMMDD-HHMMSS/` snapshot before deletion. The user can restore by `mv` back if they regret it.
3. **Plugin uninstall is advisory**: Mode D detects the install type and instructs the user — it does NOT auto-execute, because plugin installation is owned by the user (marketplace vs git clone vs --plugin-dir).
4. **Do NOT touch `.git/`** other than the post-commit hook devt manages (and only if it references devt or `CLAUDE_PLUGIN_ROOT`). Never run `git` destructive commands.
5. **No data exfiltration**: This workflow never reads memory contents or sends data anywhere — operations are local file deletions only.
</deviation_rules>

<success_criteria>
- User picked a mode via AskUserQuestion
- For destructive modes, confirmed via second AskUserQuestion
- For Mode B/C, a backup exists at `.devt.bak.YYYYMMDD-HHMMSS/`
- The chosen mode executed successfully
- User has a clear summary of what changed
</success_criteria>
