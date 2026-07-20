"use strict";

// Atomic write: temp file + rename to prevent torn writes on crash.

const fs = require("fs");

function atomicWriteFileSync(filePath, content, encoding = "utf8") {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content, encoding);
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* leave orphan rather than mask the original error */ }
    throw e;
  }
}

function atomicWriteJsonSync(filePath, obj) {
  atomicWriteFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");
}

// Shared `git ls-files` boilerplate — one home for the 256MB buffer (large
// monorepos overflow the 1MB default), stderr suppression, and []-on-error.
// `nul: true` uses -z (NUL-separated raw paths, so non-ASCII names aren't
// core.quotePath-octal-escaped) — required when the paths are matched against
// plain-string globs; leave it off when comparing against other git output
// that carries the same quotePath escaping (e.g. a sibling `git log`).
function listTrackedFiles(cwd, { nul = false } = {}) {
  try {
    const opts = { encoding: "utf8", timeout: 60000, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] };
    if (cwd) opts.cwd = cwd;
    const out = require("child_process").execFileSync("git", nul ? ["ls-files", "-z"] : ["ls-files"], opts);
    return out.split(nul ? "\0" : "\n").filter(Boolean);
  } catch { return []; }
}

module.exports = { atomicWriteFileSync, atomicWriteJsonSync, listTrackedFiles };
