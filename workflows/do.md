# Do — Smart Command Router

Route freeform natural language to the right devt command.

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
3. **Never do the work** — This is a dispatcher only. Route and hand off.
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
| Setting up a project, "initialize", "configure" | `/devt:init` | Project setup |
| A bug, error, crash, "something broken" | `/devt:debug` | Systematic debugging |
| Exploring, researching, "how does X work" | `/devt:research` | Codebase investigation |
| Defining a feature, "write a spec", "requirements" | `/devt:specify` | PRD generation |
| Creating a plan, "plan how to", "approach" | `/devt:plan` | Implementation planning |
| Discussing choices, "which approach", "gray area" | `/devt:clarify` | Decision capture |
| A complex task: multi-file, architecture, migration | `/devt:workflow` | Full pipeline |
| A simple task: 1-2 files, clear scope | `/devt:implement` | Quick pipeline |
| A trivial task: typo, rename, config tweak | `/devt:fast` | Inline execution |
| Reviewing code, "check my code" | `/devt:review` | Read-only analysis |
| Running tests, lint, typecheck | `/devt:quality` | Quality gates |
| Creating a PR, "ready to merge" | `/devt:ship` | PR creation |
| Checking status, "where am I" | `/devt:status` | Workflow progress |
| Resuming work, "continue", "pick up" | `/devt:next` | Auto-detect next step |
| Pausing work, "stopping for now" | `/devt:pause` | Structured handoff |
| A note or idea for later | `/devt:note` | Idea capture |
| Plugin health, diagnostics | `/devt:health` | Plugin validation |
| Updating the plugin | `/devt:update` | Version check |
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

<step name="dispatch" gate="command invoked">

Display the routing decision:

```
Routing: /devt:{command} — {one-line reason}
```

Invoke the selected command, passing the original input as arguments.

</step>

<success_criteria>
- Input validated (not empty)
- Intent matched to exactly one command
- Routing decision displayed
- Command invoked — dispatcher exits
</success_criteria>
