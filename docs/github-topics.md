# GitHub Topic Tags

`devt` configures these topic tags on the GitHub repository for discoverability + matching the Claude Code plugin ecosystem (so users browsing `https://github.com/topics/claude-code-plugin` and `https://github.com/topics/multi-agent` find devt side by side with related tools). The README also displays the most prominent ones as badges (see top of README.md).

## Recommended topic set (18 tags)

GitHub allows up to 20 topics per repository. We use 18 — leaves headroom for future additions without churn.

### Primary discoverability (5)

| Topic | Why |
|---|---|
| `claude-code` | Primary platform association. Highest-signal topic — every Claude Code user searches it. |
| `claude-code-plugin` | Direct plugin-marketplace category. Sister tools (skills, hooks) tag the same. |
| `anthropic` | Pulls traffic from anyone browsing Anthropic-ecosystem tooling. |
| `multi-agent` | Core architectural pattern — devt orchestrates 10 specialized sub-agents. |
| `ai-development-tools` | Broadest umbrella for AI-assisted developer tooling. |

### Tech-stack + capability tags (10)

| Topic | Why |
|---|---|
| `agent-workflow` | Workflow-orchestration discipline — Command → Workflow → Agent architecture. |
| `subagent` | Sub-agent dispatch pattern — every Task() call goes through a typed contract. |
| `code-review-automation` | One of devt's headline capabilities (`/devt:review` workflow). |
| `llm-tools` | Broad umbrella for LLM-based developer tooling. |
| `prompt-engineering` | What devt's skills + workflows + envelopes ARE — structured prompt composition. |
| `mcp` | Devt ships 2 MCP servers (devt-memory-mcp, devt-graphify-mcp). |
| `model-context-protocol` | Canonical academic form of MCP — pulls research-interest traffic. |
| `cli` | Devt's Node CLI tools (`bin/devt-tools.cjs`) — every CLI tool wants this. |
| `nodejs` | Language of implementation (zero-dependency stdlib Node). |
| `developer-tools` | Broadest dev-tool umbrella. |

### Backing-store + ecosystem (3)

| Topic | Why |
|---|---|
| `sqlite` | FTS5-indexed permanent memory layer uses SQLite. |
| `claude` | Adjacent association — pulls traffic from anyone searching "claude integration". |
| `automation` | Workflow-automation umbrella — adjacent to CI/CD search traffic. |

## Set the topics on github.com

### One-shot setup via the gh CLI (recommended)

```bash
gh repo edit \
  --add-topic claude-code \
  --add-topic claude-code-plugin \
  --add-topic anthropic \
  --add-topic multi-agent \
  --add-topic ai-development-tools \
  --add-topic agent-workflow \
  --add-topic subagent \
  --add-topic code-review-automation \
  --add-topic llm-tools \
  --add-topic prompt-engineering \
  --add-topic mcp \
  --add-topic model-context-protocol \
  --add-topic cli \
  --add-topic nodejs \
  --add-topic developer-tools \
  --add-topic sqlite \
  --add-topic claude \
  --add-topic automation
```

### Via the GitHub web UI

1. Open the repo's main page on github.com.
2. Click the ⚙️ gear icon next to "About" (top-right of the repo description).
3. Paste the comma-separated topics:
   `claude-code, claude-code-plugin, anthropic, multi-agent, ai-development-tools, agent-workflow, subagent, code-review-automation, llm-tools, prompt-engineering, mcp, model-context-protocol, cli, nodejs, developer-tools, sqlite, claude, automation`
4. Save.

### Via the REST API (CI-friendly)

```bash
gh api -X PUT /repos/<owner>/<repo>/topics \
  -F 'names[]=claude-code' \
  -F 'names[]=claude-code-plugin' \
  -F 'names[]=anthropic' \
  -F 'names[]=multi-agent' \
  -F 'names[]=ai-development-tools' \
  -F 'names[]=agent-workflow' \
  -F 'names[]=subagent' \
  -F 'names[]=code-review-automation' \
  -F 'names[]=llm-tools' \
  -F 'names[]=prompt-engineering' \
  -F 'names[]=mcp' \
  -F 'names[]=model-context-protocol' \
  -F 'names[]=cli' \
  -F 'names[]=nodejs' \
  -F 'names[]=developer-tools' \
  -F 'names[]=sqlite' \
  -F 'names[]=claude' \
  -F 'names[]=automation'
```

Note: this form *replaces* the entire topic list, so include every topic you want to keep.

## Mirror locations

The tag list is mirrored in two places so each discovery channel surfaces devt consistently:

| Channel | What's there | File |
|---|---|---|
| GitHub repo topics | Full 18 (set via `gh repo edit`) | (live on github.com — set manually) |
| README badges | 10 most prominent | `README.md` top-of-file |
| Canonical source-of-truth | All 18 with rationale | this file |

When adding or removing a topic, update this file first, then propagate to the other channels.
