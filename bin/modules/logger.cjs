"use strict";

/**
 * Append-only JSONL logger for forensic side-channels.
 *
 * Use cases in devt today:
 * - hooks/pre-flight-guard.sh deny/warn records → .devt/state/preflight-denies.jsonl
 * - bin/devt-memory-mcp.cjs tool-call telemetry → .devt/memory/_mcp-trace.jsonl
 * (currently does its own appendFileSync; can migrate later for symmetry)
 *
 * Why JSONL not plain text: unified parsing surface for `/devt:debug --mode=forensics`,
 * `/devt:status --stats=mcp`, and future log readers. One record per line, valid JSON
 * per line, missing fields tolerated by the consumer.
 *
 * Atomicity invariant: each record's serialized form must fit within PIPE_BUF
 * (4096 bytes on macOS + Linux). POSIX guarantees `write()` calls ≤ PIPE_BUF
 * are atomic — concurrent appenders never interleave their bytes. Records
 * exceeding the cap get truncated to a `{_truncated:true, _original_bytes:N}`
 * stub rather than risking torn writes.
 *
 * Zero deps (Node stdlib).
 */

const fs = require("fs");

const PIPE_BUF = 4096;
// Leave headroom for the trailing newline + JSON escaping artifacts.
const MAX_RECORD_BYTES = PIPE_BUF - 64;

/**
 * Append one JSON record to a JSONL file. The record is serialized, validated
 * against MAX_RECORD_BYTES, and appended with a trailing newline. On oversize,
 * a truncated stub is appended instead so the file stays valid JSONL.
 *
 * Returns `{ ok: true, bytes }` on success, or
 * `{ ok: false, reason }` if the file cannot be written.
 *
 * The CALLER is responsible for ensuring the parent directory exists. This
 * keeps the helper zero-IO outside of the append itself.
 */
function appendJsonl(filePath, record) {
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, reason: "filePath is required" };
  }
  if (record == null || typeof record !== "object") {
    return { ok: false, reason: "record must be a non-null object" };
  }
  let serialized;
  try {
    serialized = JSON.stringify(record);
  } catch (e) {
    return { ok: false, reason: `record not serializable: ${e.message}` };
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) {
    // Append a truncation stub instead of the oversized record so the JSONL
    // file remains parseable line-by-line. Preserve a few identifying fields
    // when present so post-mortem can match the truncation to its source.
    const stub = {
      _truncated: true,
      _original_bytes: Buffer.byteLength(serialized, "utf8"),
      _cap: MAX_RECORD_BYTES,
      ts: record.ts || new Date().toISOString(),
    };
    // Preserve up to 3 identifying keys from the original record (mode,
    // action, file_path style) to aid forensic search later.
    const identifyingKeys = ["mode", "action", "file_path", "tool", "agent"];
    for (const k of identifyingKeys) {
      if (typeof record[k] === "string" && record[k].length < 256) stub[k] = record[k];
    }
    serialized = JSON.stringify(stub);
  }
  try {
    fs.appendFileSync(filePath, serialized + "\n");
    return { ok: true, bytes: Buffer.byteLength(serialized, "utf8") + 1 };
  } catch (e) {
    return { ok: false, reason: `append failed: ${e.message}` };
  }
}

module.exports = { appendJsonl, MAX_RECORD_BYTES, PIPE_BUF };
