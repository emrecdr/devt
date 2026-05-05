---
id: FLOW-000
title: "Flow Title"
doc_type: flow
domain: "general"
status: candidate
confidence: explicit
summary: "Step-by-step description of a business or system process. ≤ 200 chars."
affects_paths:
  - "src/services/process/**"
affects_symbols:
  - OrchestratorClass
links:
  # - id: ADR-005
  #   type: implements
created_at: "2026-01-01T00:00:00Z"
created_by: user
schema_version: 1
---

# Flow: Title

## Overview

One paragraph: what triggers this flow, what happens, what is the final state? Reader
should be able to predict whether this flow is relevant to their task after reading
this paragraph.

## Process Steps

1. **Trigger**: What initiates the flow?
   - Caller / event / scheduled job
2. **Action**: What happens next?
   - The sequence of operations, with the responsible class/function for each
3. **Outcome**: What is the terminal state?
   - Success state, persistence side-effects, downstream notifications

For complex flows, use subsections. Reference exact symbol names so Graphify can bind
the flow to code (when enabled).

## Error Handling

How does this flow fail? What partial states are possible mid-flow? What recovery /
retry / compensation logic applies?

- Failure mode 1: cause + handling
- Failure mode 2: cause + handling

## Related Decisions

ADRs that constrain this flow's implementation:
- `[[ADR-xxx]]` — relevant decision
- `[[ADR-yyy]]` — relevant decision
