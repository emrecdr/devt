Task(subagent_type="devt:debugger", model="{models.debugger}", prompt="
<context>
<files_to_read>.devt/rules/coding-standards.md, .devt/rules/quality-gates.md</files_to_read>
<scope_hint>{scope_hint_json}</scope_hint>
<scope_trust>{scope_trust_json}</scope_trust>
<graph_impact>Read .devt/state/graph-impact.md if it exists — pre-computed caller set + blast radius for the bug's central symbol. When absent, .devt/state/graphify-skip-reason.txt explains why.</graph_impact>
<symptoms>Read .devt/state/debug-context.md</symptoms>
<agent_skills>{injected from .devt/config.json if available}</agent_skills>
</context>
<bug>{bug_description}</bug>
Follow the 4-phase investigation protocol. Write findings to .devt/state/debug-summary.md.

Your tool surface does not include `mcp__*graphify*`. Use the `<scope_hint>` block (derived from preflight Brief blast-radius) as the high-signal starting set for hypothesis formation, then validate with Grep/Read. When `<scope_trust>.trust` is `empty`, fall back to following the stack trace from the symptom.

**Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing debug-summary.md): per your `knowledge_candidates` step, if debugging surfaces a non-obvious pattern (recurring bug class, hidden invariant the bug violated, environmental gotcha worth documenting), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes the 5-filter test: specificity, durability, non-obviousness, evidence, actionability. When none qualify, surface that decision in debug-summary.md.
")
