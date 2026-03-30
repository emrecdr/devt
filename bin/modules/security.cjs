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
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?above\s+instructions/i,
  /disregard\s+(all\s+)?previous/i,
  /override\s+(system|previous)\s+(prompt|instructions)/i,
  /you\s+are\s+now\s+(?:a|an|the)\s+/i,
  /pretend\s+(?:you(?:'re| are)\s+|to\s+be\s+)/i,
  /from\s+now\s+on,?\s+you\s+(?:are|will|should|must)/i,
  /<\/?(?:system|assistant|human)>/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
];

/**
 * Scan text for prompt injection patterns.
 * Returns { clean: boolean, findings: string[] }
 */
function scanForInjection(text) {
  if (!text || typeof text !== "string") return { clean: true, findings: [] };
  const findings = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      findings.push(`Matched: ${pattern.source}`);
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
  validateShellArg,
  INJECTION_PATTERNS,
};
