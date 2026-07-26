---
id: REJ-003
title: "Do NOT adopt OpenTelemetry (or any telemetry SDK) for devt's own observability"
doc_type: rejected
status: active
confidence: verified
domain: observability
summary: "No OTel/telemetry SDK: breaks zero-dep, SDK init would dwarf 26-73ms hook fires, and cross-process correlation has no audience in a local plugin. JSONL side-channels + aggregation verbs are the stack."
reason: complexity
search_keywords:
  - "opentelemetry"
  - "otel"
  - "tracing sdk"
  - "telemetry exporter"
  - "spans instrumentation"
  - "observability backend"
  - "structured tracing library"
affects_paths:
  - "bin/modules/telemetry-calibrate.cjs"
  - "hooks/run-hook.js"
created_at: "2026-07-26T00:00:00Z"
created_by: user
schema_version: 1
---

# Rejected: Do NOT adopt OpenTelemetry (or any telemetry SDK) for devt's own observability

## The Proposal & Why It Was Rejected

Rejected approach: replace or wrap devt's JSONL telemetry side-channels with an OpenTelemetry SDK (spans, exporters, a backend). Three independent grounds: (1) the zero-dependency rule is universal — every module is Node stdlib only, and a telemetry SDK is exactly the kind of always-loaded dependency the rule exists to keep out; (2) measured cost floor: hook fires run 26–73ms warm end-to-end and the entire 5-module state family parses in ~2ms over bare node startup — an SDK's init would be the largest single cost in paths that fire on every tool call; (3) no audience: OTel's value is cross-service/cross-process correlation into a collector — devt is a local, single-project plugin whose consumers are its own CLI verbs. The existing stack already delivers the queryable substance: append-only JSONL side-channels (`hook-trace/run-hook.jsonl`, `gate-trace.jsonl`, `dispatch-warnings.jsonl`, `_mcp-trace.jsonl`) with `workflow_id`/correlation-id attribution, aggregated by `mcp-stats`, `telemetry calibrate`, and the weekly report.

## Reconsideration Triggers

Revisit only if devt gains a genuinely multi-process/hosted runtime whose traces need cross-process correlation with an external consumer, or the platform itself ships native OTel plumbing that requires no in-repo dependency.
