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
 *
 * @param {string} text - Raw JSON text.
 * @param {string} [label] - Context label for error messages.
 * @param {number} [maxSize] - Maximum byte length (default 1MB). Bump for
 *   trusted-but-large inputs (memory bundles, Graphify graph caches).
 */
function safeJsonParse(text, label, maxSize) {
  label = label || "JSON";
  const limit = (typeof maxSize === "number" && maxSize > 0) ? maxSize : 1048576;
  if (!text || typeof text !== "string") {
    return { ok: false, error: `${label}: empty or invalid input` };
  }
  if (text.length > limit) {
    const limitMb = (limit / 1048576).toFixed(1);
    return { ok: false, error: `${label}: exceeds ${limitMb}MB size limit` };
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

// Secret-shaped config keys masked before any value flows into agent context
// or `config get` JSON output. Defense-in-depth: today's DEFAULTS holds nothing
// secret, but `.devt/config.json` is user-extensible — a project that adds a
// custom integration key (e.g., a CI token) gets masked-by-default rather than
// leaked through every workflow init payload.
//
// Match shape: exact-case-insensitive name OR suffix `_<exact>`. Substring match
// is intentionally NOT used to avoid false positives on legitimate keys (e.g.,
// `auth_strategy` should not be masked just because it contains "auth").
const SECRET_KEY_NAMES = new Set([
  "secret", "password", "passwd", "token", "api_key", "apikey", "auth_token",
  "access_token", "refresh_token", "private_key", "client_secret", "credentials",
  "bearer", "authorization",
]);
const SECRET_KEY_SUFFIXES = ["_secret", "_password", "_token", "_key", "_apikey", "_credentials"];

function isSecretKey(name) {
  if (typeof name !== "string") return false;
  const k = name.toLowerCase();
  if (SECRET_KEY_NAMES.has(k)) return true;
  return SECRET_KEY_SUFFIXES.some((suffix) => k.endsWith(suffix) && k !== suffix.slice(1));
}

// Walk a plain-data structure and mask values whose KEY name matches the
// secret shape. Non-secret values pass through untouched. Arrays are walked but
// their indices never mask (no key name to match against). Returns a new
// object — never mutates the input.
//
// Empty/null/undefined secret values still mask: `api_key: ""` rendering as
// `***MASKED***` tells an LLM "exists, masked, don't reason about it" rather
// than "exists and is unset" (which would be a leakier signal).
//
// Cycle/depth guard: callers today only pass JSON-loaded data (no cycles, shallow
// nesting). The WeakSet + depth cap make the helper safe for future callers
// passing live objects without measurable cost on the JSON-loaded happy path.
const MAX_MASK_DEPTH = 50;
function maskSecrets(obj, _depth = 0, _seen = new WeakSet()) {
  if (obj === null || typeof obj !== "object") return obj;
  // Cycle/depth guard returns string sentinels rather than the live object so the
  // result stays JSON-serializable (the whole point of the helper).
  if (_seen.has(obj)) return "[Circular]";
  if (_depth >= MAX_MASK_DEPTH) return "[MaxDepth]";
  _seen.add(obj);
  if (Array.isArray(obj)) return obj.map((item) => maskSecrets(item, _depth + 1, _seen));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSecretKey(k) && v !== null && v !== undefined) {
      out[k] = "***MASKED***";
    } else {
      out[k] = maskSecrets(v, _depth + 1, _seen);
    }
  }
  return out;
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
  isSecretKey,
  maskSecrets,
};
