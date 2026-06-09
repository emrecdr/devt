# `static-compress` recipe

**Status**: opt-in (`static_compress.mode: 'off'` by default)
**Borrowed**: caveman (MIT, juliusbrussee/caveman) — `compress.py` orchestrator pattern + `caveman-shrink/compress.js` prose compressor + `is_sensitive_path` denylist

## What it does

`node bin/devt-tools.cjs static-compress <path>` compresses a markdown file's prose in place while leaving fenced code blocks, inline code, URLs, filesystem paths, identifiers, and version numbers byte-equal. A `<path>.original.md` sibling is written first so the operation is reversible:

```
node bin/devt-tools.cjs static-compress .devt/rules/coding-standards.md
node bin/devt-tools.cjs static-compress --restore .devt/rules/coding-standards.md
```

## Why it exists

devt's static-load files (`.devt/rules/*.md`, `guardrails/*.md`, skill bodies) load into every code-touching agent dispatch. An envelope audit (programmer:dev, ~31 KB total) showed `guardrails_inline` at ~87% of envelope cost. Compressing the prose layer of these files — without touching code references, paths, or identifiers — gives a meaningful per-dispatch saving.

The feature shipped after a telemetry gate confirmed the static-load slice was >20% of dispatch cost.

## How to enable

```jsonc
// .devt/config.json
{
  "static_compress": {
    "mode": "on",          // default "off"
    "size_cap_bytes": 500000  // default 500 KB
  }
}
```

`mode: 'on'` (default) — the init-time prompt asks at setup, and existing projects inherit `on` after upgrade. Flip to `'off'` in `.devt/config.json` to disable.

## Compression path

1. **Sensitive-path denylist** runs first (same `is_sensitive_path` port `graphify.cjs` uses). Anything matching `.env`, `.netrc`, `credentials*`, `secrets*`, `id_rsa*`, `*.pem/key/p12/...`, `.ssh/`, `.aws/`, `.gnupg/`, `.kube/`, `.docker/`, or a token-normalized credential basename is refused before any compression.
2. **`prose-shrink.cjs` compressor** (caveman-shrink port) runs with sentinel-protected segments — fully deterministic, zero dependencies. **Compression ratio depends heavily on prose density**: conversational text with filler (articles, hedges, pleasantries) compresses 25–35% (caveman's design target); tightly written technical specs with minimal filler compress 4–15% (measured ~4% on `guardrails/golden-rules.md`). The compressor refuses files that would produce identical output, surfacing them in the `--all` aggregate's `skipped_no_change` list — distinct from `skipped_already_done` (which indicates a prior run already created a `.original.md` backup).
3. **Backup readback verify** — the original is written to `<path>.original.md` and immediately read back to confirm bytes match before the input file is touched.
4. **Structural-drift validate** — the compressed output runs through the same `structural-validator.cjs` extractors used by `state check-agent-output --structural`. If any structural element (heading, code block, URL, identifier, version number) is missing or mangled, the backup is deleted and the input is left untouched.
5. **Atomic write** — only after the validator passes does the compressed content replace the input via `atomicWriteFileSync`.

## What it does NOT do

- Doesn't auto-run on install, upgrade, or any workflow hook.
- Doesn't modify code blocks, URLs, paths, identifiers, function calls, CONST_CASE tokens, or version numbers — these stay byte-equal.
- Doesn't compress files matching the sensitive-path denylist, even on explicit opt-in. Rename if the heuristic is wrong.
- Doesn't compress files over `size_cap_bytes` (default 500 KB). Override per-project if needed.

## Reversing a compression

```bash
node bin/devt-tools.cjs static-compress --restore <path>
```

Reads `<path>.original.md`, atomically writes it back to `<path>`, removes the backup. Idempotent — re-running once the backup is gone returns a clear error.

## Telemetry

Every compress / restore action appends one JSON line to `.devt/state/static-compress.jsonl` (RESET_EXEMPT). Schema:

```jsonc
{
  "action": "compress",
  "ts": "2026-06-08T22:00:00.000Z",
  "path": "path/relative/to/project",
  "engine": "regex",
  "before_bytes": 27291,
  "after_bytes": 19023,
  "ratio": 0.303,
  "backup_path": "path/relative/to/project.original.md",
  "warnings": []
}
```

## Recommended targets

Best fit for compression — these are devt-authored prose files load-bearing in every dispatch:

- `guardrails/golden-rules.md`
- `guardrails/engineering-principles.md`
- `guardrails/generative-debt-checklist.md`
- `guardrails/contamination-prevention.md`

For project-local rules (`.devt/rules/*.md`): use sparingly. These are project-authored and any compression should be reviewed before merging — the compressed file becomes the source of truth for future sessions.

## When to skip

- Files with high code-block density (compression ratio will be tiny — most of the content is already protected).
- Files smaller than ~2 KB (compression savings won't offset the maintenance cost of the `.original.md` sibling).
- Files actively under collaborative edit (the backup→compress workflow conflicts with PR review cycles).

## Smoke gate

K77 (`scripts/smoke-test.sh`) covers: mode-off-refuses, mode-on compresses with code/URL/path preserved + backup written, `--restore` returns byte-equal original, sensitive filename refused, empty file refused.
