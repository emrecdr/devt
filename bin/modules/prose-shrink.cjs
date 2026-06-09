"use strict";

// Prose compressor ported from caveman-shrink (MIT, juliusbrussee/caveman,
// src/mcp-servers/caveman-shrink/compress.js). Zero-dep, deterministic,
// sentinel-protected. Compresses natural-language prose while leaving
// fenced code, inline code, URLs, paths, identifiers, function calls,
// CONST_CASE tokens, and version numbers byte-equal.
//
// Public API:
//   compress(text, opts?) → {compressed, before, after}
//   withProtectedSegments(text, transform) → string
//
// Boundaries (NEVER touched):
//   - fenced code blocks (``` ... ```)
//   - inline code (`...`)
//   - URLs (https?://...)
//   - filesystem paths (anything with `/` or `\`)
//   - identifiers in dotted.path or function() form
//   - CONST_CASE tokens
//   - version numbers (1.2.3)

// Whitespace classes deliberately exclude newlines — line structure
// (especially heading boundaries) must survive compression, so we strip
// only spaces and tabs after fillers/pleasantries/hedges, never across
// line boundaries.
const FILLERS = /\b(?:just|really|basically|actually|simply|quite|very|essentially|literally)\b/gi;
const PLEASANTRIES = /\b(?:please|kindly|thank you|thanks|sure|certainly|of course|happy to|i'?d be happy)\b[,.]?[ \t]*/gi;
const HEDGES = /\b(?:perhaps|maybe|might|could potentially|would like to|i think|in my opinion|it seems|it appears)\b[ \t]*/gi;
const LEADERS = /^(?:i'?ll|i will|i can|i'?d|you can|we will|we can|let me|let'?s)[ \t]+/gim;
// ARTICLES — lowercase only, NO /i flag. Under /i, the lookahead `[a-z]`
// matches uppercase too, which strips articles from headings like
// `## The Iron Law` → `## Iron Law` (mangles heading title, fails
// structural validator). Limiting to lowercase articles preserves all
// title-cased / sentence-start cases at a marginal compression cost.
const ARTICLES = /\b(?:a|an|the)[ \t]+(?=[a-z])/g;

// Protected patterns walked in order — first match wins. Path pattern is
// generous (anything containing / or \ surrounded by word chars / dots / dashes)
// and runs BEFORE the identifier pattern so dotted file paths stay intact.
//
// Heading lines (^#{1,6} ...) protected as whole-line atoms — runs FIRST
// so the structural validator's heading-title extraction sees byte-equal
// titles before/after. Without this, any in-heading article ("Step 1: keep
// the scope_trust fresh") would mangle to "Step 1: keep scope_trust fresh"
// and fail superset validation. Markdown allows 1-6 hashes; the [ \t]+
// requirement prevents accidental matches on header-comment-style lines
// in fenced bodies that aren't actually headings.
const PROTECTED_PATTERNS = [
  /^#{1,6}[ \t]+.*$/gm,
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /\bhttps?:\/\/\S+/gi,
  /(?:\.\/|\.\.\/|\/|[A-Za-z]:\\)[\w./\\-]+/g,
  /\b[\w.-]*[/\\][\w./\\-]+/g,
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
  /\b\w+\.\w+(?:\.\w+)*(?:\(\))?/g,
  /[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)/g,
  /\b\d+\.\d+\.\d+\b/g,
];

// Sentinel uses ZZZPROTZZZ delimiters — uppercase Z-runs are extremely
// uncommon in real prose and survive every compressProse transform
// (no whitespace runs, no article/filler patterns, no leading-i hits).
function _sentinel(i) {
  return "ZZZPROTZZZ" + i + "ZZZPROTZZZ";
}

function withProtectedSegments(text, transform) {
  const segments = [];
  let working = text;
  for (const re of PROTECTED_PATTERNS) {
    working = working.replace(re, function (m) {
      const i = segments.length;
      segments.push(m);
      return _sentinel(i);
    });
  }
  let out = transform(working);
  // Iterative restore — protected patterns can nest (e.g. dotted.method
  // matched config.<CONST_CASE_sentinel> as a single chunk; the inner
  // CONST_CASE sentinel needs unrolling after the outer one). Loop until
  // stable or up to a safe cap.
  for (let pass = 0; pass < 8; pass++) {
    const next = out.replace(/ZZZPROTZZZ(\d+)ZZZPROTZZZ/g, function (_m, idx) {
      const i = Number(idx);
      return i < segments.length ? segments[i] : `ZZZPROTZZZ${idx}ZZZPROTZZZ`;
    });
    if (next === out) break;
    out = next;
  }
  // Sentinel non-convergence is silent corruption — the validator
  // downstream would see "URL lost" or "code block dropped" with no
  // signal that the real cause is pathological nesting. Throw so callers
  // (static-compress.cjs) trip cleanly and the user gets actionable text.
  if (/ZZZPROTZZZ\d+ZZZPROTZZZ/.test(out)) {
    throw new Error(
      "prose-shrink: sentinel restoration did not converge in 8 passes — input has pathological nested-protection structure",
    );
  }
  return out;
}

function compressProse(text) {
  let s = text;
  s = s.replace(LEADERS, "");
  s = s.replace(PLEASANTRIES, "");
  s = s.replace(HEDGES, "");
  s = s.replace(FILLERS, "");
  s = s.replace(ARTICLES, "");
  // Collapse INTERIOR multi-space runs only — preserve leading line
  // indentation. The unanchored form `[ \t]{2,}` would mangle markdown
  // list continuation lines indented with 3+ spaces (CommonMark loose-
  // list pattern), including the indented code fences they contain.
  // Requiring a non-whitespace char before the run keeps the substitution
  // mid-line where the redundancy actually lives.
  s = s.replace(/(\S)[ \t]{2,}/g, "$1 ");
  s = s.replace(/\s+([,.;:!?])/g, "$1");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function compress(text, _opts) {
  if (typeof text !== "string" || text.length === 0) {
    return { compressed: text || "", before: 0, after: 0 };
  }
  const before = text.length;
  const compressed = withProtectedSegments(text, compressProse);
  return { compressed, before, after: compressed.length };
}

module.exports = { compress, withProtectedSegments, compressProse };
