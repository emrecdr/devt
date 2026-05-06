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

module.exports = { atomicWriteFileSync, atomicWriteJsonSync };
