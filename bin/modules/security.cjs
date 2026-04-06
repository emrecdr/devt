"use strict";

/**
 * Security — input validation, path traversal prevention, prompt injection detection.
 *
 * devt generates markdown files that become LLM system prompts. User-controlled text
 * that flows into these files (task descriptions, config values) is an indirect
 * prompt injection vector. This module provides defense-in-depth validation.
 */

const fs = require("fs");
const path = require("path");

/**
 * Calculate Shannon entropy (bits per character) for a text string.
 * High entropy (>4.5) in long segments suggests encoded/obfuscated payloads.
 */
function shannonEntropy(text) {
  if (!text || text.length === 0) return 0;
  const freq = {};
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    freq[ch] = (freq[ch] || 0) + 1;
  }
  let entropy = 0;
  const len = text.length;
  for (const ch in freq) {
    const p = freq[ch] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Decode URL-encoded (%XX) sequences in text.
 * Returns the decoded string for re-scanning.
 */
function decodeUrlEncoding(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/%([0-9a-fA-F]{2})/g, function (_, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

/**
 * Decode common HTML entities in text.
 * Handles named entities (&lt; &gt; &amp; &quot; &apos;) and
 * numeric entities (&#xNN; &#NNN;).
 */
const HTML_NAMED_ENTITIES = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeHtmlEntities(text) {
  if (!text || typeof text !== "string") return text;
  let result = text;
  for (const entity in HTML_NAMED_ENTITIES) {
    result = result.replaceAll(entity, HTML_NAMED_ENTITIES[entity]);
  }
  // Hex numeric entities: &#xNN;
  result = result.replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
    const cp = parseInt(hex, 16);
    return cp > 0x10FFFF ? "" : String.fromCodePoint(cp);
  });
  // Decimal numeric entities: &#NNN;
  result = result.replace(/&#(\d+);/g, function (_, dec) {
    const cp = parseInt(dec, 10);
    return cp > 0x10FFFF ? "" : String.fromCodePoint(cp);
  });
  return result;
}

/**
 * Validate that a file path resolves within an allowed base directory.
 * Prevents path traversal attacks via ../ sequences, symlinks, or absolute paths.
 */
function validatePath(filePath, baseDir) {
  if (!filePath || typeof filePath !== "string") {
    return { safe: false, resolved: "", error: "Empty or invalid file path" };
  }
  if (!baseDir || typeof baseDir !== "string") {
    return { safe: false, resolved: "", error: "Empty or invalid base directory" };
  }
  if (filePath.includes("\0")) {
    return { safe: false, resolved: "", error: "Path contains null bytes" };
  }

  let resolvedBase;
  try {
    resolvedBase = fs.realpathSync(path.resolve(baseDir));
  } catch {
    resolvedBase = path.resolve(baseDir);
  }

  const resolvedPath = path.resolve(baseDir, filePath);

  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(resolvedBase + path.sep)) {
    return { safe: false, resolved: resolvedPath, error: `Path escapes allowed directory` };
  }

  return { safe: true, resolved: resolvedPath };
}

/**
 * Safely parse JSON with size limits and error handling.
 */
function safeJsonParse(text, label) {
  label = label || "JSON";
  if (!text || typeof text !== "string") {
    return { ok: false, error: `${label}: empty or invalid input` };
  }
  if (text.length > 1048576) {
    return { ok: false, error: `${label}: exceeds 1MB size limit` };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: `${label}: ${err.message}` };
  }
}

const INJECTION_PATTERNS = [
  // Direct instruction override attempts
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?above\s+instructions/i,
  /disregard\s+(all\s+)?previous/i,
  /forget\s+(all\s+)?(your\s+)?instructions/i,
  /override\s+(system|previous)\s+(prompt|instructions)/i,

  // Role/identity manipulation
  /you\s+are\s+now\s+(?:a|an|the)\s+/i,
  /act\s+as\s+(?:a|an|the)\s+(?!workflow|agent|tier)/i,
  /pretend\s+(?:you(?:'re| are)\s+|to\s+be\s+)/i,
  /from\s+now\s+on,?\s+you\s+(?:are|will|should|must)/i,

  // System prompt extraction
  /(?:print|output|reveal|show|display|repeat)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,
  /what\s+(?:are|is)\s+your\s+(?:system\s+)?(?:prompt|instructions)/i,

  // Hidden instruction markers (XML/HTML tags that mimic system messages)
  /<\/?(?:system|assistant|human)>/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<<\s*SYS\s*>>/i,

  // Exfiltration attempts
  /(?:send|post|fetch|curl|wget)\s+(?:to|from)\s+https?:\/\//i,
  /(?:base64|btoa|encode)\s+(?:and\s+)?(?:send|exfiltrate|output)/i,

  // Tool manipulation
  /(?:run|execute|call|invoke)\s+(?:the\s+)?(?:bash|shell|exec|spawn)\s+(?:tool|command)/i,
];

/**
 * Scan text for prompt injection patterns.
 * Returns { clean: boolean, findings: string[] }
 */
function scanForInjection(text, opts) {
  if (!text || typeof text !== "string") return { clean: true, findings: [] };
  const findings = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      findings.push(`Matched: ${pattern.source}`);
    }
  }
  if (opts && opts.strict) {
    if (/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/.test(text)) {
      findings.push("Contains suspicious zero-width or invisible Unicode characters");
    }
    const normalizedLength = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").length;
    if (normalizedLength > 50000) {
      findings.push(`Suspicious text length: ${normalizedLength} chars (potential prompt stuffing)`);
    }

    // Shannon entropy analysis — detect encoded/obfuscated payloads
    // Split on whitespace and check segments >200 chars
    const segments = text.split(/\s+/);
    for (const seg of segments) {
      if (seg.length > 200) {
        const ent = shannonEntropy(seg);
        if (ent > 4.5) {
          findings.push(`High-entropy segment detected (${ent.toFixed(1)} bits/char): potential encoded payload`);
          break; // one finding is enough
        }
      }
    }

    // Scan decoded text for injection patterns hidden by encoding
    function scanDecoded(decoded, label) {
      if (decoded === text) return;
      for (const pattern of INJECTION_PATTERNS) {
        if (!pattern.test(text) && pattern.test(decoded)) {
          findings.push(`${label} detected: decoded text matches ${pattern.source}`);
        }
      }
    }

    // URL-encoded injection — decode %XX sequences and re-scan
    // NOTE: parallel implementation in scripts/prompt-injection-scan.sh (category 7)
    if (/%[0-9a-fA-F]{2}/.test(text)) {
      scanDecoded(decodeUrlEncoding(text), "URL-encoded injection");
    }

    // HTML entity injection — decode entities and re-scan
    if (/&(?:#x?[0-9a-fA-F]+|[a-z]+);/i.test(text)) {
      scanDecoded(decodeHtmlEntities(text), "HTML-entity injection");
    }
  }
  return { clean: findings.length === 0, findings };
}

/**
 * Sanitize text that will be embedded in agent prompts.
 * Strips injection markers while preserving legitimate content.
 */
function sanitizeForPrompt(text) {
  if (!text || typeof text !== "string") return text;
  let s = text;
  // Strip zero-width characters
  s = s.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, "");
  // Neutralize system boundary tags
  s = s.replace(/<(\/?)(?:system|assistant|human)>/gi, "[$1system-text]");
  s = s.replace(/\[(SYSTEM|INST)\]/gi, "[$1-TEXT]");
  s = s.replace(/<<\s*SYS\s*>>/gi, "«SYS-TEXT»");
  return s;
}

/**
 * Sanitize text for display back to the user.
 * Removes protocol-like leak markers that should never surface in output.
 */
function sanitizeForDisplay(text) {
  if (!text || typeof text !== "string") return text;
  let s = sanitizeForPrompt(text);
  s = s.replace(/^\s*(?:assistant|user|system)\s+to=[^:\s]+:[^\n]+$/gim, "");
  s = s.replace(/^\s*<\|(?:assistant|user|system)[^|]*\|>\s*$/gim, "");
  return s;
}

/**
 * Validate a shell argument is safe when quoted.
 */
function validateShellArg(value, label) {
  if (!value || typeof value !== "string") {
    throw new Error(`${label || "Argument"}: empty or invalid`);
  }
  if (value.includes("\0")) {
    throw new Error(`${label || "Argument"}: contains null bytes`);
  }
  if (/\$\(|`/.test(value)) {
    throw new Error(`${label || "Argument"}: contains command substitution`);
  }
  return value;
}

module.exports = {
  validatePath,
  safeJsonParse,
  scanForInjection,
  sanitizeForPrompt,
  sanitizeForDisplay,
  validateShellArg,
  shannonEntropy,
  decodeUrlEncoding,
  decodeHtmlEntities,
  INJECTION_PATTERNS,
};
