"use strict";

// Structural extractors ported from caveman (MIT, juliusbrussee/caveman,
// skills/caveman-compress/scripts/validate.py). Adapted for devt's stub-first
// protocol: 'superset' mode permits the final artifact to ADD sections, URLs,
// or code blocks beyond the stub-first sentinel snapshot but never DROP them.
// Caveman's 'equality' mode (strict identity) stays available for use cases
// where final must match orig exactly (docs artifacts, lessons records).
//
// Public API:
//   extractHeadings(text)     → [{level, title}]
//   extractCodeBlocks(text)   → [string]  (line-based, nested-fence-aware)
//   extractUrls(text)         → Set<string>
//   extractPaths(text)        → Set<string>
//   extractInlineCodes(text)  → Map<string, count>
//   countBullets(text)        → number
//   validate(orig, comp, {mode}) → {ok, errors, warnings, mode}
//
// Zero dependencies — only Node.js stdlib.

const URL_REGEX = /https?:\/\/[^\s)]+/g;
const HEADING_REGEX = /^(#{1,6})\s+(.*)$/gm;
const BULLET_REGEX = /^\s*[-*+]\s+/gm;
// Crude but effective: either a path prefix (./ ../ / drive-letter) OR a
// slash-bearing token. Mirrors caveman's PATH_REGEX shape.
const PATH_REGEX =
  /(?:\.\/|\.\.\/|\/|[A-Za-z]:\\)[\w\-/\\.]+|[\w\-.]+[/\\][\w\-/\\.]+/g;

function extractHeadings(text) {
  const out = [];
  for (const m of text.matchAll(HEADING_REGEX)) {
    out.push({ level: m[1].length, title: m[2].trim() });
  }
  return out;
}

// Line-based fenced-code-block extractor. CommonMark fence rule: closing
// fence must use the same char as opening and be at least as long. Supports
// nested fences (outer 4-backtick block wrapping inner 3-backtick content).
// Unclosed fences are silently skipped — including them would cause
// false-positive validation failures on malformed markdown.
function extractCodeBlocks(text) {
  const blocks = [];
  const lines = text.split("\n");
  const fenceOpen = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
  let i = 0;
  while (i < lines.length) {
    const m = fenceOpen.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const fenceChar = m[2][0];
    const fenceLen = m[2].length;
    const blockLines = [lines[i]];
    i++;
    let closed = false;
    while (i < lines.length) {
      const cm = fenceOpen.exec(lines[i]);
      if (
        cm &&
        cm[2][0] === fenceChar &&
        cm[2].length >= fenceLen &&
        cm[3].trim() === ""
      ) {
        blockLines.push(lines[i]);
        closed = true;
        i++;
        break;
      }
      blockLines.push(lines[i]);
      i++;
    }
    if (closed) blocks.push(blockLines.join("\n"));
  }
  return blocks;
}

function extractUrls(text) {
  const out = new Set();
  for (const m of text.matchAll(URL_REGEX)) out.add(m[0]);
  return out;
}

function extractPaths(text) {
  const out = new Set();
  for (const m of text.matchAll(PATH_REGEX)) out.add(m[0]);
  return out;
}

function countBullets(text) {
  let n = 0;
  // eslint-disable-next-line no-unused-vars
  for (const _m of text.matchAll(BULLET_REGEX)) n++;
  return n;
}

// Strip fenced blocks before scanning for inline-code, otherwise inline
// backticks inside a fenced block would be double-counted.
function extractInlineCodes(text) {
  let stripped = text.replace(/^```[\s\S]*?^```/gm, "");
  stripped = stripped.replace(/^~~~[\s\S]*?^~~~/gm, "");
  const out = new Map();
  for (const m of stripped.matchAll(/`([^`\n]+)`/g)) {
    out.set(m[1], (out.get(m[1]) || 0) + 1);
  }
  return out;
}

function _headingKey(h) {
  return `${h.level}|${h.title}`;
}

function validate(orig, comp, opts) {
  const mode = (opts && opts.mode) || "superset";
  if (mode !== "superset" && mode !== "equality") {
    throw new Error(
      `structural-validator: unknown mode "${mode}" (expected "superset" or "equality")`,
    );
  }
  const errors = [];
  const warnings = [];

  // Headings
  const oH = extractHeadings(orig);
  const cH = extractHeadings(comp);
  if (mode === "equality") {
    if (oH.length !== cH.length) {
      errors.push(`Heading count mismatch: ${oH.length} vs ${cH.length}`);
    }
    if (JSON.stringify(oH) !== JSON.stringify(cH)) {
      warnings.push("Heading text/order changed");
    }
  } else {
    const cSet = new Set(cH.map(_headingKey));
    for (const h of oH) {
      if (!cSet.has(_headingKey(h))) {
        errors.push(`Section dropped: "${h.title}" (level ${h.level})`);
      }
    }
  }

  // Code blocks
  const oC = extractCodeBlocks(orig);
  const cC = extractCodeBlocks(comp);
  if (mode === "equality") {
    if (JSON.stringify(oC) !== JSON.stringify(cC)) {
      errors.push("Code blocks not preserved exactly");
    }
  } else {
    const cSet = new Set(cC);
    for (const block of oC) {
      if (!cSet.has(block)) {
        const preview = block.split("\n")[0].slice(0, 80);
        errors.push(`Code block dropped or mangled: ${preview}`);
      }
    }
  }

  // URLs
  const oU = extractUrls(orig);
  const cU = extractUrls(comp);
  const lostU = [...oU].filter((u) => !cU.has(u));
  if (lostU.length > 0) {
    errors.push(`URL lost: ${JSON.stringify(lostU)}`);
  }
  if (mode === "equality") {
    const addedU = [...cU].filter((u) => !oU.has(u));
    if (addedU.length > 0) {
      errors.push(`URL added: ${JSON.stringify(addedU)}`);
    }
  }

  // Paths — warning only. Path detection is intentionally fuzzy (caveman's
  // PATH_REGEX matches a wide net to catch typical file references); strict
  // path equality would false-positive on legitimate prose changes.
  const oP = extractPaths(orig);
  const cP = extractPaths(comp);
  const lostP = [...oP].filter((p) => !cP.has(p));
  if (lostP.length > 0) {
    warnings.push(`Path lost: ${JSON.stringify(lostP)}`);
  }

  // Bullets
  const oB = countBullets(orig);
  const cB = countBullets(comp);
  if (oB > 0) {
    if (mode === "equality") {
      const diff = Math.abs(oB - cB) / oB;
      if (diff > 0.15) {
        warnings.push(`Bullet count changed too much: ${oB} -> ${cB}`);
      }
    } else if (cB < oB) {
      warnings.push(`Bullet count decreased: ${oB} -> ${cB}`);
    }
  }

  // Inline codes
  const oIC = extractInlineCodes(orig);
  const cIC = extractInlineCodes(comp);
  const lostIC = [];
  for (const [code, count] of oIC.entries()) {
    const compCount = cIC.get(code) || 0;
    if (compCount < count) {
      lostIC.push(`${code} (lost ${count - compCount} of ${count})`);
    }
  }
  if (lostIC.length > 0) {
    errors.push(`Inline code lost: ${JSON.stringify(lostIC)}`);
  }

  return { ok: errors.length === 0, errors, warnings, mode };
}

module.exports = {
  extractHeadings,
  extractCodeBlocks,
  extractUrls,
  extractPaths,
  extractInlineCodes,
  countBullets,
  validate,
};
