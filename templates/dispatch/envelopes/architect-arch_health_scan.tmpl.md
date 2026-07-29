Task(subagent_type="devt:architect", prompt="
  <context>
    <governing_rules>Read CLAUDE.md and .devt/rules/architecture.md from the project root — they are the governing law for this assessment. The project's own CLAUDE.md WINS on any conflict with .devt/rules/ baselines.</governing_rules>
    <context_loaded_contract>{context_loaded_contract}</context_loaded_contract>
    <guardrails_inline>Read {plugin_root}/guardrails/golden-rules.md and {plugin_root}/guardrails/engineering-principles.md before assessing.</guardrails_inline>
    <scope_hint>{JSON array of the top-level paths in scan scope, e.g. [\"app/\", \"tests/\"] — fill from the scan target; [] means whole repo}</scope_hint>
    <scope_trust>{JSON: {\"trust\": \"dense|sparse|empty\", \"lag_commits\": N|null, \"fresh\": true|false} — fill from the graphify staleness surface computed at workflow start; {\"trust\":\"empty\",\"lag_commits\":null,\"fresh\":false} when graphify is absent}</scope_trust>
    <memory_signal>{Run `node {plugin_root}/bin/devt-tools.cjs memory query \"<scan topic>\" --signal=3 --json-compact` and inline the JSON result — governing ADR/CON ids, REJ tombstones, and lessons the assessment must respect; {} when the memory layer is disabled. Deliberate design choices recorded there are DISMISSALS, not findings.}</memory_signal>
    <files_to_read>
      .devt/rules/architecture.md — layer rules, module boundaries, dependency direction
      .devt/rules/coding-standards.md — coding conventions, forbidden patterns, entity standards
      .devt/rules/testing-patterns.md — test structure, coverage rules, soft-delete testing requirements
      .devt/rules/golden-rules.md (if exists) — non-negotiable project rules
      .devt/rules/patterns/common-smells.md (if exists) — project-specific anti-patterns with detection commands
    </files_to_read>
    <scanner_output>Read .devt/state/scanner-output.txt (if exists)</scanner_output>
    <evolution>Read .devt/state/evolution-report.md (if exists) — git-history hotspots, change coupling, fix density</evolution>
    <delta>Read .devt/state/scan-delta.md (if exists)</delta>
    <triage>Read .devt/state/arch-triage.json (if exists)</triage>
    <agent_skills>{injected from .devt/config.json if available}</agent_skills>
  </context>
  <task>
    Perform a comprehensive architecture health scan of the codebase.
    Assess: module boundaries, dependency direction, coupling, structural duplication,
    data flow integrity, and convention compliance.

    If scanner output is available in .devt/state/scanner-output.txt, use it as input
    and focus on interpreting and prioritizing the findings.

    If a delta summary exists in .devt/state/scan-delta.md, focus ONLY on the new
    findings listed there — skip unchanged findings.

    If triage decisions exist in .devt/state/arch-triage.json, respect them:
    skip dismissed findings, prioritize accepted findings, note deferred findings.

    If no scanner output is available, perform the analysis manually by scanning
    imports, module structure, and cross-module references.

    If an evolution report exists in .devt/state/evolution-report.md, use it to
    EFFORT-WEIGHT your findings: a violation in a top hotspot file outranks the
    same violation in cold code (state the hotspot rank when elevating). Flag
    change-coupling pairs that lack a structural relationship (no import/call
    edge) as hidden-coupling findings — likely a missing abstraction or
    copy-paste twins. When coupling data carries confidence=low (small history),
    treat pairs as leads to verify via imports, never as findings by themselves.
    High churn/loc + high fix count = bleeding edge; note it in the health
    summary trend.

    Respect the memory_signal: approaches recorded as deliberate decisions or
    REJ tombstones are dismissals ("Dismissed as deliberate"), NOT findings.

    **Capture knowledge candidates** (load-bearing — not optional, do this BEFORE writing arch-review.md): per your `knowledge_candidates` step, if your assessment surfaces architectural rules / patterns worth promoting (cross-component invariants, "this layer cannot depend on that layer", non-obvious design constraints), append `#KNOWLEDGE-CANDIDATE: [type=decision|concept|flow|rejected] <one-line summary>` lines to `.devt/state/scratchpad.md`. Each tag passes: specificity, durability, non-obviousness, evidence, actionability.
  </task>
  Write findings to .devt/state/arch-review.md
")
