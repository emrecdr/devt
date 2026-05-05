"use strict";

/**
 * Shared CLI flag parser. Accepts `--key=value` and `--bare-flag` forms.
 * Hyphens in keys are normalized to underscores so callers see JS-friendly identifiers.
 * Numeric values (digits only) are coerced to integers; everything else stays a string.
 */
function parseFlags(args) {
  const opts = {};
  if (!Array.isArray(args)) return opts;
  for (const a of args) {
    const m = String(a).match(/^--([\w-]+)(?:=(.+))?$/);
    if (!m) continue;
    const key = m[1].replace(/-/g, "_");
    const val = m[2];
    if (val === undefined) opts[key] = true;
    else if (/^\d+$/.test(val)) opts[key] = parseInt(val, 10);
    else opts[key] = val;
  }
  return opts;
}

module.exports = { parseFlags };
