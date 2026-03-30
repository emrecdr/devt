# Update — Check and Install devt Updates

Check for a newer version of the devt plugin on GitHub and guide the user through updating.

Supports `--force` flag to bypass cache and check GitHub immediately.

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
- `node` is available on PATH
- Internet connectivity (to check GitHub)
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable — this workflow does not dispatch subagents.
</agent_skill_injection>

<deviation_rules>
1. **STOP: network failures** — If GitHub is unreachable, report the error and show manual update instructions
2. **STOP: destructive actions** — Never force-update or bypass confirmation
3. **STOP: dirty tree** — If local modifications exist in a git install, warn before pulling
4. **STOP: active workflow** — If a workflow is in progress, warn before updating
</deviation_rules>

---

## Steps

<step name="pre_check" gate="safe to proceed with update">

Check if a workflow is currently active — updating mid-workflow could break `.devt/state/` artifacts.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" state read
```

If `active: true`, warn the user:

```yaml
question: "A workflow is currently active. Updating devt mid-workflow may cause issues. Proceed?"
header: "Active Workflow Warning"
multiSelect: false
options:
  - label: "Proceed anyway"
    description: "Check for updates (workflow state is preserved)"
  - label: "Cancel"
    description: "Finish or cancel the workflow first, then run /devt:update"
```

If Cancel: STOP.

If no active workflow or user chose to proceed: continue.

</step>

<step name="check_version" gate="version comparison complete">

Check if `--force` was passed in the user's command. If present, add `--force` to bypass the 4-hour cache.

```bash
# Without --force (uses cache if fresh):
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" update check

# With --force (always hits GitHub):
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" update check --force
```

Parse the JSON result:

- `installed`: current local version
- `latest`: version on GitHub main branch
- `update_available`: boolean — true if remote is newer
- `ahead`: boolean — true if local is newer than remote (development version)
- `repo`: GitHub owner/repo
- `error`: if check failed

**If error**: Report and show manual instructions:
```
Could not check for updates: {error}
Manual update: git clone https://github.com/emrecdr/devt.git ~/.devt && claude --plugin-dir ~/.devt
```
STOP here.

**If ahead** (`ahead` is true):
```
devt v{installed} — you're running a development version (remote is v{latest}).
No update needed.
```
STOP here.

**If up to date** (`update_available` is false and `ahead` is false):
```
devt v{installed} — you're on the latest version.
```
STOP here.

</step>

<step name="gather_status" gate="install type and tree state determined">

Get install type, dirty state, and version in a single call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" update status
```

Parse the JSON result:
- `type`: `"plugin"` | `"git"` | `"unknown"`
- `update_command`: the appropriate command for this install type
- `branch`: the detected default branch (for git installs)
- `dirty`: boolean — true if uncommitted local changes exist
- `files`: list of modified files (if dirty)
- `count`: number of modified files (if dirty)
- `version`: current installed version

</step>

<step name="show_changelog" gate="user has seen what changed">

Fetch and display the changelog:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" update changelog
```

The CLI automatically parses entries between the installed version and latest. Present to the user:

```
devt update available: v{installed} → v{latest}

What's new:
{parsed changelog entries}
```

If no changelog available, show just the version diff.

</step>

<step name="confirm_and_update" gate="user has chosen and update executed or skipped">

**If dirty tree detected** (git install with local modifications):

Show warning before the update prompt:
```
Warning: {count} locally modified file(s) in the devt plugin directory:
{list first 5 files}

These changes will be affected by the update.
```

Then ask via AskUserQuestion:

```yaml
question: "Update devt from v{installed} to v{latest}?"
header: "devt Update"
multiSelect: false
options:
  - label: "Stash changes and update"
    description: "Git stash local changes, pull update. Restore later with: git stash pop"
  - label: "Update anyway (discard local changes)"
    description: "Reset to remote version, overwriting local modifications"
  - label: "Skip"
    description: "Keep local changes, stay on v{installed}"
```

**If clean tree or plugin install**, simpler prompt:

```yaml
question: "Update devt from v{installed} to v{latest}?"
header: "devt Update"
multiSelect: false
options:
  - label: "Update now"
    description: "{update_command}"
  - label: "Skip"
    description: "Stay on v{installed} for now"
```

**If Skip**: Report "Update skipped. Run /devt:update anytime." STOP.

### Execute based on install type:

**Type: `plugin`** (installed via plugin system)

```bash
claude plugin update {plugin_id}
```

If the command fails (non-zero exit), report:
```
Plugin update failed. Try reinstalling:
  git clone https://github.com/emrecdr/devt.git ~/.devt && claude --plugin-dir ~/.devt
```

**Type: `git`** (cloned repo)

Use `{branch}` from the status detection (not hardcoded).

If user chose "Stash changes and update":
```bash
cd "${CLAUDE_PLUGIN_ROOT}" && git stash push -m "devt-pre-update-$(date +%Y%m%d)"
```

Show incoming commits:
```bash
cd "${CLAUDE_PLUGIN_ROOT}" && git fetch origin {branch} && git log --oneline HEAD..origin/{branch}
```

Pull the update:
```bash
cd "${CLAUDE_PLUGIN_ROOT}" && git pull origin {branch}
```

**If git pull fails** (merge conflict or diverged history):
```
Git pull failed. To resolve manually:
  cd {CLAUDE_PLUGIN_ROOT}
  git stash push -m "devt-local-changes"
  git reset --hard origin/{branch}

Your stash is preserved in: git stash list
```
Do NOT auto-run destructive git commands. Show the instructions and STOP.

If user chose "Update anyway (discard local changes)":
```bash
cd "${CLAUDE_PLUGIN_ROOT}" && git fetch origin {branch} && git reset --hard origin/{branch}
```

If stashed, remind user:
```
Local changes stashed. To restore: cd {CLAUDE_PLUGIN_ROOT} && git stash pop
```

**Type: `unknown`**

Show manual instructions:
```
Could not determine install type. Update manually:
  Option 1: git clone https://github.com/emrecdr/devt.git ~/.devt && claude --plugin-dir ~/.devt
  Option 2: cd {CLAUDE_PLUGIN_ROOT} && git pull
```

</step>

<step name="verify_and_cleanup" gate="update verified and cache cleared">

After successful update:

1. Verify new version:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" update local-version
```

2. Clear update cache (removes session-start notification):
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/devt-tools.cjs" update clear-cache
```

3. Check if new version has migration notes by reading the session-start hook context:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/VERSION"
```

Report:
```
devt updated: v{old} → v{new}
Restart your Claude Code session to load the new version.
```

If the new version differs by a minor or major bump, add:
```
After restarting, run /devt:health to check for any migration steps.
```

</step>

<success_criteria>
- Active workflow check performed before update
- Version check completed (pass or fail with clear error)
- Development version correctly identified (local > remote)
- Install type and dirty state gathered in one call
- Dirty tree warning shown if local modifications exist
- User informed of available update with parsed changelog
- Correct update command executed for the install type
- Update executed only with explicit user confirmation
- Post-update version verified
- Update cache cleared (session-start notification disappears)
- Migration guidance shown for minor/major version bumps
</success_criteria>
