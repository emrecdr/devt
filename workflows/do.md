# Do — Smart Command Router

Route freeform natural language to the right devt command.

> **Drift note**: the routing table in this file is mirrored in `agents/devt-coordinator.md` (the opt-in main-thread router). When adding/removing a `/devt:*` command from the table below, update the coordinator's table too. The smoke test enforces row-count parity but does not catch column-content drift.

<purpose>
Users describe what they want. This workflow matches intent to commands. Never does work itself.
</purpose>

<prerequisites>
- `${CLAUDE_PLUGIN_ROOT}` is set (devt plugin is loaded)
</prerequisites>

<available_agent_types>
This workflow does NOT use subagents. All steps are executed by the main session.
</available_agent_types>

<agent_skill_injection>
Not applicable.
</agent_skill_injection>

<deviation_rules>
1. **STOP: ambiguity** — If intent matches 2+ commands equally, ask the user to choose. Do not guess.
2. **STOP: no match** — If no command fits, show `/devt:help` and ask the user to rephrase.
3. **Never do the work** — This is a dispatcher only. The ONLY valid final action of this turn is invoking the routed command via the Skill tool. "Doing the work" is forbidden and includes:
   - Answering the user's underlying question in prose (even partially)
   - Running diagnostics, reading code, grepping the repo, or calling Bash
   - Asking clarifying questions about the task itself (the routed command will ask)
   - Validating whether the task is real, scoped correctly, or worth doing

   If you start typing prose about the task content instead of the routing decision, STOP — you've broken the contract. The routed command exists to do exactly that work, with persisted state.
</deviation_rules>

---

## Steps

<step name="validate" gate="input is present">

If no argument was provided, ask:

```yaml
question: "What would you like to do?"
header: "Task"
multiSelect: false
options:
  - label: "Build or fix something"
    description: "Implement a feature, fix a bug, refactor code"
  - label: "Set up or configure"
    description: "Initialize project, check health, update plugin"
  - label: "Review or investigate"
    description: "Code review, debug, research, forensics"
```

</step>

<step name="route" gate="command selected">

Match the input against this routing table. Apply the **first matching** rule:

| If the text describes... | Route to | Why |
|--------------------------|----------|-----|
| Setting up a project, "initialize", "configure" | `/devt:setup --init` | Project setup |
| A bug, error, crash, "something broken" | `/devt:debug` | Systematic debugging |
| Exploring, researching, "how does X work" | `/devt:research` | Codebase investigation |
| Defining a feature, "write a spec", "requirements" | `/devt:specify` | PRD generation |
| Creating a plan, "plan how to", "approach" | `/devt:plan` | Implementation planning |
| Discussing choices, "which approach", "gray area" | `/devt:workflow --mode=clarify` | Decision capture |
| A complex task: multi-file, architecture, migration | `/devt:workflow` | Full pipeline |
| A simple task: 1-2 files, clear scope | `/devt:implement` | Quick pipeline |
| A trivial task: typo, rename, config tweak | `/devt:workflow --mode=fast` | Inline execution |
| Reviewing code, "check my code" | `/devt:review` | Read-only analysis |
| Running tests, lint, typecheck | `/devt:review --focus=quality` | Quality gates |
| Creating a PR, "ready to merge" | `/devt:ship` | PR creation |
| Checking status, "where am I" | `/devt:status` | Workflow progress |
| Resuming work, "continue", "pick up" | `/devt:next` | Auto-detect next step |
| Pausing work, "stopping for now" | `/devt:workflow --pause` | Structured handoff |
| A note or idea for later | `/devt:note` | Idea capture |
| Plugin health, diagnostics | `/devt:setup --health` | Plugin validation |
| Updating the plugin | `/devt:setup --update` | Version check |
| Available commands, "help" | `/devt:help` | Command reference |

**Ambiguity handling:** If the text matches 2+ routes, ask:

```yaml
question: "This could go a few ways. Which fits better?"
header: "Route"
multiSelect: false
options:
  - label: "<command 1>"
    description: "<why this fits>"
  - label: "<command 2>"
    description: "<why this fits>"
```

**No match:** Show "I'm not sure which command fits. Here's what's available:" and invoke `/devt:help`.

</step>

<step name="dispatch" gate="Skill tool called for routed command">

**Mechanic:** invoke the routed command via the Skill tool. devt slash commands are addressable as skills with the `devt:` prefix (e.g., `/devt:debug` ↔ `Skill tool: name=devt:debug`).

**Order — exactly two actions, no others:**

1. Display the routing decision (one line only):
   ```
   Routing: /devt:{command} — {one-line reason}
   ```
2. **Immediately** invoke the routed command (Skill tool: `name=devt:{command}`, args=`{original input verbatim}`). No prose between the routing line and the Skill call.

**Worked example — bug report:**

User: `/devt:do "405 on POST /api/v1/admin/impersonate, integrator says it should work"`

✅ RIGHT — two actions only:
```
Routing: /devt:debug — bug report, systematic root-cause investigation

[Skill tool: name=devt:debug, args="405 on POST /api/v1/admin/impersonate, integrator says it should work"]
```

❌ WRONG — this is the failure mode this contract prevents:
```
Let me look at the route definition... [reads code]
The 405 likely means the method isn't registered. Probable cause is...
[never dispatches; the user is now stuck outside the devt ecosystem they invoked]
```
That's "doing the work." `/devt:debug` exists to do exactly that, with persisted state in `.devt/state/`, preflight Brief, debugger agent, and resume support. The dispatcher must hand off, not investigate.

</step>

<success_criteria>
- Input validated (not empty)
- Intent matched to exactly one command
- Routing decision displayed (one line)
- Skill tool invoked with `name=devt:<routed-command>` — dispatcher exits without further commentary or work
</success_criteria>
