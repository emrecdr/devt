---
name: architecture-health-scanner
description: Interpret and triage architecture scanner output — cluster findings by module and root cause, classify true positives vs false positives vs acceptable design, and produce a prioritized remediation plan (Fix Now / Fix Soon / Document / Ignore). Use after the scanner has been run when there are findings to analyze. Trigger on 'scanner results', 'scanner findings', 'scanner output', 'triage findings', 'classify findings', 'coupling violations', 'cross-service imports', 'duplicate model definitions', 'architectural violations', 'tech debt triage', 'false positives from scanner', 'prioritize scanner output', 'architecture health scan', 'structural drift', 'remediation plan from scan', or when a refactor touched 3+ files/modules and you want to check for new violations. Also trigger on 'present architecture health metrics' or grouping findings into priority buckets. Do NOT use for single-file bug fixes, code review, fetching library docs, ESLint/linter config, project health checks (hooks/state/config validation), or writing new endpoints.
allowed-tools: Bash Read Write Edit Grep Glob WebFetch WebSearch Skill Task
context: fork
agent: general-purpose
---

# Architecture Health Scanner

## Overview

This skill teaches how to interpret scanner output, not how to run the scanner. The project provides its own scanner tool (configured in `.devt/config.json` under `arch_scanner.command`). This skill turns raw findings into a prioritized remediation plan.

Raw scanner output is noise. Interpretation converts noise into signal by clustering related findings, identifying root causes, and separating true problems from acceptable trade-offs.

## When NOT to Use

Skip for single-file changes or bug fixes that don't touch module boundaries. If the change is isolated to one module with no cross-boundary imports, this skill adds overhead without value.

## Time Budget

Quick scan: **2-3 minutes**. Full scan with triage: **5-10 minutes**.

## The Iron Law

```
NO CLASSIFICATION WITHOUT READING THE ACTUAL CODE
```

Scanner output is claims, not facts. Every finding must be verified by reading the code at the reported location before being classified as true positive or false positive.

Scanner output contains false positives and context-dependent findings that cannot be classified from the report alone. A coupling warning between two modules might be an intentional design decision or a genuine violation — only reading the actual code reveals which. Misclassified findings waste developer time or, worse, dismiss real architectural drift.

## The Process

### Step 1: Verify Scanner Was Run

Check that scanner output exists. The scanner command is defined in `.devt/config.json` under `arch_scanner.command`. If no output exists, the scanner must be run first — this skill does not run it.

### Step 2: Parse Output

Read the scanner output and extract individual findings. Each finding should have:

- **Detection category** (see `references/detection-categories.md`)
- **Location** (file, line, module)
- **Description** (what was detected)
- **Severity** (if provided by scanner)

### Step 3: Cluster by Module

Group findings by module/service. This reveals which areas of the codebase have the most issues and helps identify systemic problems vs. isolated incidents.

### Step 4: Cluster by Root Cause

Multiple findings often share a single root cause. Examples:

- 10 "missing type hint" findings in one module = one developer skipped type hints
- 5 "cross-service import" findings = one architectural boundary is unclear
- 3 "duplicate model" findings = one domain concept is defined in multiple places

Fixing the root cause resolves all related findings at once.

### Step 5: Classify Each Finding

Read the actual code before classifying. Never classify from the scanner description alone.

| Classification | Criteria | Action |
|---------------|----------|--------|
| **True Positive** | Real issue confirmed by reading the code | Fix it |
| **Acceptable Design** | Intentional trade-off with documented rationale | Document it |
| **False Positive** | Scanner limitation, code is actually correct | Dismiss with explanation |

See `references/interpretation-rules.md` for detailed classification guidance.

### Step 6: Prioritize

Assign each true positive to a priority bucket:

| Priority | Criteria | Timeline |
|----------|----------|----------|
| **Fix Now** | Security risk, data integrity, blocking other work | This sprint |
| **Fix Soon** | Architectural violation, growing tech debt | Next 2 sprints |
| **Document** | Known trade-off, acceptable for now | Add ADR or comment |
| **Ignore** | False positive or trivially low impact | Dismiss in report |

### Step 7: Write Remediation Plan

Structure the output as:

```
## Scanner Health Report

### Fix Now (X findings)
- [Module] Root cause → affected findings → suggested fix

### Fix Soon (X findings)
- [Module] Root cause → affected findings → suggested fix

### Documented Trade-offs (X findings)
- [Module] Why this is acceptable → reference to ADR/decision

### Dismissed (X findings)
- [Finding] Why this is a false positive
```

## Gate Functions

### Gate: Scanner Output Exists

- [ ] Scanner has been run (output file or recent execution confirmed)
- [ ] Output is parseable and contains findings

### Gate: Code Read Before Classification

- [ ] Every finding classified as "acceptable" or "false positive" has been verified by reading the actual code
- [ ] No finding was classified based solely on the scanner description

### Gate: Root Causes Identified

- [ ] Related findings are grouped by root cause
- [ ] Each priority bucket has actionable remediation steps

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
| --- | --- | --- |
| "All findings are false positives" | Unlikely -- re-examine your classification criteria | Read the actual code before dismissing any finding |
| "We'll fix these later" | Later means never | Prioritize and schedule concretely |
| "The scanner is wrong" | The scanner may be imprecise, but the code may still have issues | Read the code before dismissing |
| "This is just tech debt" | Tech debt without a remediation plan is rot | Create a prioritized remediation plan |
| "Too many findings to address" | 50 findings often share 5 root causes | Cluster by root cause and fix the roots |
| "The scanner flags too much" | Not all findings are equal -- that is why you classify | Classify each finding, then prioritize |
| "We know about these issues" | Knowing is not fixing | Prioritize and schedule |
| "This would require a big refactor" | Big refactors start with small steps | Break it into prioritized increments |

## Integration

- **Prerequisites**: Scanner must have been run (check `.devt/config.json` for `arch_scanner.command`)
- **References**: `references/detection-categories.md`, `references/interpretation-rules.md`
- **Used by agents**: architect (primary consumer), workflow orchestrator (for planning)
- **Related skills**: code-review-guide (for individual file issues), strategic-analysis (for refactor planning)
