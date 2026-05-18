// Portable bundle export / import for the memory layer.
//
// Bundle format (JSON, schema_version=1):
// {
//   schema_version: 1,
//   exported_at: ISO,
//   exported_from: <source project root>,
//   doc_count: N,
//   docs: [{ id, doc_type, frontmatter, body }, ...]
// }
//
// Export reads markdown files, parses frontmatter + body, emits JSON. Import
// reverses: regenerates markdown from the bundle. Conflict policy on import:
//   default:     skip if id exists
//   --overwrite: replace existing file
//   --prefix=X-: remap every id to X-ORIGINAL_ID (multi-source bundling)
//
// Functions here lazy-require ./memory.cjs inside each function body to break
// the load-time circular dep — memory.cjs requires this file near the top
// (for re-exports) and itself supplies the parser/validation helpers we need.

"use strict";

const fs = require("fs");
const path = require("path");
const { safeJsonParse } = require("./security.cjs");
const { atomicWriteFileSync } = require("./io.cjs");

/**
 * Resolve a user-supplied --out= path. Rules:
 * - relative paths: resolved against project root, MUST stay inside project root
 * - absolute paths: allowed (user explicitly chose external destination)
 * - reject `..` segments after normalization on relative paths
 * - reject null bytes
 */
function resolveExportPath(p) {
  const { findProjectRoot } = require("./memory.cjs");
  if (typeof p !== "string" || p.length === 0 || p.length > 4096) {
    throw new Error("--out path is invalid (empty or too long)");
  }
  if (p.includes("\0")) throw new Error("--out path contains null bytes");
  if (path.isAbsolute(p)) return path.normalize(p);
  const root = findProjectRoot();
  const joined = path.normalize(path.join(root, p));
  const rel = path.relative(root, joined);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("--out path resolves outside project root after normalization");
  }
  return joined;
}

/**
 * Resolve a user-supplied bundle path for import.
 * - relative resolved against cwd
 * - absolute allowed
 * - reject null bytes; reject if file doesn't exist
 */
function resolveImportPath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 4096) {
    throw new Error("import path is invalid (empty or too long)");
  }
  if (p.includes("\0")) throw new Error("import path contains null bytes");
  const resolved = path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.join(process.cwd(), p));
  if (!fs.existsSync(resolved)) throw new Error(`bundle file not found: ${resolved}`);
  return resolved;
}

function readDocFile(filePath) {
  const { parseYamlSubset } = require("./memory.cjs");
  const content = fs.readFileSync(filePath, "utf8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;
  const fm = parseYamlSubset(fmMatch[1]);
  const body = fmMatch[2];
  return { frontmatter: fm, body };
}

function exportBundle(opts) {
  const memory = require("./memory.cjs");
  opts = opts || {};
  const includeTypes = opts.includeTypes || memory.DOC_TYPES.slice();
  // By default, bundle ONLY the project-local root. Shared roots are
  // typically maintained as their own repos with their own bundling — exporting
  // them here would be a copy that drifts from upstream. Pass allRoots:true to
  // bundle the union (last-wins-deduped) for multi-root archival use cases.
  const allRoots = !!opts.allRoots;
  const roots = allRoots ? memory.getMemoryRoots() : [memory.getMemoryRoot()];
  const docsById = new Map();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const docType of includeTypes) {
      const subdir = memory.getSubdirPathFor(root, docType);
      if (!fs.existsSync(subdir)) continue;
      for (const entry of fs.readdirSync(subdir)) {
        if (entry.startsWith("_")) continue;
        if (!entry.endsWith(".md")) continue;
        const full = path.join(subdir, entry);
        const parsed = readDocFile(full);
        if (!parsed || !parsed.frontmatter || !parsed.frontmatter.id) continue;
        // Last-wins: later root in the list overwrites earlier. Project-local
        // is always last (per getMemoryRoots), so it wins.
        docsById.set(parsed.frontmatter.id, {
          id: parsed.frontmatter.id,
          doc_type: docType,
          filename: entry,
          source_root: root,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
        });
      }
    }
  }
  const docs = Array.from(docsById.values()).sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema_version: memory.SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    exported_from: memory.findProjectRoot(),
    exported_roots: roots,
    all_roots_mode: allRoots,
    doc_count: docs.length,
    include_types: includeTypes,
    docs,
  };
}

function importBundle(bundlePath, opts) {
  const memory = require("./memory.cjs");
  opts = opts || {};
  const overwrite = !!opts.overwrite;
  const prefix = opts.prefix || null;

  let bundle;
  let raw;
  try {
    raw = fs.readFileSync(bundlePath, "utf8");
  } catch (e) {
    throw new Error(`bundle file unreadable: ${e.message}`);
  }
  // 50MB cap — legitimate bundles can aggregate hundreds of ADR docs.
  const parseResult = safeJsonParse(raw, "bundle file", 50 * 1024 * 1024);
  if (!parseResult.ok) {
    throw new Error(`bundle file unreadable: ${parseResult.error}`);
  }
  bundle = parseResult.value;
  if (!bundle || !Array.isArray(bundle.docs)) {
    throw new Error("bundle missing required `docs` array");
  }
  if (bundle.schema_version && bundle.schema_version !== memory.SCHEMA_VERSION) {
    throw new Error(`bundle schema_version=${bundle.schema_version} does not match current SCHEMA_VERSION=${memory.SCHEMA_VERSION}`);
  }
  // Prefix shape: alphanumeric + dash, ≤16 chars, ends with -
  if (prefix !== null) {
    if (!/^[A-Z][A-Z0-9]{0,14}-$/.test(prefix)) {
      throw new Error("--prefix must match /^[A-Z][A-Z0-9]{0,14}-$/ (e.g. 'TEAM-' or 'OSS-')");
    }
  }

  const created = [];
  const skipped = [];
  const overwritten = [];
  const errors = [];

  for (const doc of bundle.docs) {
    try {
      if (!doc || !doc.id || !doc.doc_type || !doc.frontmatter || typeof doc.body !== "string") {
        errors.push({ id: (doc && doc.id) || "(unknown)", reason: "doc missing required fields" });
        continue;
      }
      if (!memory.DOC_TYPES.includes(doc.doc_type)) {
        errors.push({ id: doc.id, reason: `unknown doc_type: ${doc.doc_type}` });
        continue;
      }

      const originalId = doc.id;
      const newId = prefix ? `${prefix}${originalId}` : originalId;
      const fm = { ...doc.frontmatter, id: newId };
      // validateFrontmatter returns an array of {filePath, error} entries (truthy
      // when invalid). When a prefix is applied, the ID pattern check is relaxed
      // because the prefix is a namespace marker that breaks the canonical
      // ADR-NNN / CON-NNN / FLOW-NNN / REJ-NNN shape.
      const validationErrors = memory.validateFrontmatter(fm, "(bundle import)");
      const filteredErrors = prefix
        ? validationErrors.filter(e => !/does not match pattern/.test(e.error || ""))
        : validationErrors;
      if (filteredErrors.length > 0) {
        errors.push({ id: newId, reason: "frontmatter invalid: " + filteredErrors.map(e => e.error || String(e)).join("; ") });
        continue;
      }

      const subdir = memory.getSubdirPath(doc.doc_type);
      if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });

      const baseName = (doc.filename && !prefix) ? doc.filename : `${newId}.md`;
      // Defense against bundle-supplied paths.
      if (baseName.includes("/") || baseName.includes("\\") || baseName.includes("..")) {
        errors.push({ id: newId, reason: `unsafe filename in bundle: ${baseName}` });
        continue;
      }
      const filePath = path.join(subdir, baseName);

      if (fs.existsSync(filePath)) {
        if (!overwrite) {
          skipped.push({ id: newId, file: filePath, reason: "exists; pass --overwrite to replace" });
          continue;
        }
        overwritten.push({ id: newId, file: filePath });
      } else {
        created.push({ id: newId, file: filePath });
      }

      const fmYaml = memory.serializeFrontmatter(fm);
      const body = doc.body.startsWith("\n") ? doc.body : "\n" + doc.body;
      const md = `---\n${fmYaml}\n---${body}`;
      atomicWriteFileSync(filePath, md);
    } catch (e) {
      errors.push({ id: (doc && doc.id) || "(unknown)", reason: e.message });
    }
  }

  if (created.length + overwritten.length > 0) {
    try { memory.rebuildIndex(); } catch (e) {
      errors.push({ id: "(index rebuild)", reason: e.message });
    }
  }

  return {
    bundle_from: bundle.exported_from || null,
    bundle_exported_at: bundle.exported_at || null,
    schema_version: bundle.schema_version || null,
    prefix_applied: prefix,
    overwrite_mode: overwrite,
    counts: {
      created: created.length,
      overwritten: overwritten.length,
      skipped: skipped.length,
      errors: errors.length,
    },
    created,
    overwritten,
    skipped,
    errors,
  };
}

module.exports = {
  resolveExportPath,
  resolveImportPath,
  readDocFile,
  exportBundle,
  importBundle,
};
