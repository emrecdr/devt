"use strict";

// Sensitive-path denylist ported from caveman (MIT, juliusbrussee/caveman,
// skills/caveman-compress/scripts/compress.py::is_sensitive_path).
//
// Purpose: refuse to send credential-, key-, or secret-shaped paths through
// any boundary that could disclose their contents. devt's graphify CLI
// accepts arbitrary file path args from orchestrators / user input —
// passing `~/.ssh/id_rsa` or `.env.production` would feed the path into
// graphify MCP queries, which is a disclosure path the orchestrator
// rarely intends. Same defensive seam caveman used for the LLM-call
// boundary in /caveman-compress.
//
// Public API:
//   isSensitivePath(filepath) → boolean
//
// Three checks (any match → sensitive):
//   1. Basename matches credential/key/secret patterns (.env, id_rsa, *.pem, etc.)
//   2. Any path component is a known credential dir (.ssh, .aws, .gnupg, .kube, .docker)
//   3. Token-normalized basename contains a sensitive token (secret, credential,
//      password, apikey, accesskey, token, privatekey). Normalization strips
//      _ - . and whitespace so "api-key" and "api_key" both match "apikey".

const path = require("path");

const SENSITIVE_BASENAME_REGEX = new RegExp(
  "^(" +
    "\\.env(\\..+)?" +
    "|\\.netrc" +
    "|credentials(\\..+)?" +
    "|secrets?(\\..+)?" +
    "|passwords?(\\..+)?" +
    "|id_(rsa|dsa|ecdsa|ed25519)(\\.pub)?" +
    "|authorized_keys" +
    "|known_hosts" +
    "|.*\\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc|gpg)" +
    ")$",
  "i",
);

const SENSITIVE_PATH_COMPONENTS = new Set([
  ".ssh", ".aws", ".gnupg", ".kube", ".docker",
]);

const SENSITIVE_NAME_TOKENS = [
  "secret", "credential", "password", "passwd",
  "apikey", "accesskey", "token", "privatekey",
];

// Source-code + structured-data extensions where the substring-token check
// must be skipped to avoid false positives. devt-specific divergence from
// caveman: caveman's heuristic targets user-shareable memory files; devt's
// graphify operates on source code where modules like auth/token.py,
// password-policy.py, secrets/loader.py are legitimate non-sensitive files.
// The basename regex (credentials*, *.pem, etc.) and path-component check
// (.ssh, .aws, etc.) still apply universally; only the substring fallback
// is gated by extension.
// Only true programming-language source extensions are exempt. Data/markup/
// config files (.json/.yaml/.toml/.md/.txt/.sql/.html/.css/.env) STAY in
// scope of the substring check because those are common credential containers
// (e.g. config.password.json, my-api-key.txt, secrets.yaml).
const CODE_EXTENSION_REGEX =
  /\.(py|js|ts|cjs|mjs|jsx|tsx|go|rs|rb|php|java|kt|kts|cpp|cc|hpp|h|hh|c|cs|swift|scala|m|mm|sh|bash|zsh|fish|vue|svelte|astro|elm|ex|exs|erl|lua|pl|hs|ml|fs|fsx|clj|cljs|nim|zig|dart|jl|R)$/i;

function isSensitivePath(filepath) {
  // Empty string is a legitimate caller signal (no path to check).
  // Non-string inputs are programming errors — silent false-return would
  // hide the bug as a "safe to process" verdict, exactly the wrong default
  // for a denylist gate.
  if (filepath === "") return false;
  if (typeof filepath !== "string") {
    throw new TypeError(
      `isSensitivePath: expected string, got ${filepath === null ? "null" : typeof filepath}`,
    );
  }
  const name = path.basename(filepath);
  if (SENSITIVE_BASENAME_REGEX.test(name)) return true;
  const parts = filepath.split(/[\/\\]/).map(p => p.toLowerCase());
  for (const c of SENSITIVE_PATH_COMPONENTS) {
    if (parts.includes(c)) return true;
  }
  if (CODE_EXTENSION_REGEX.test(name)) return false;
  const normalized = name.toLowerCase().replace(/[_\-\s.]/g, "");
  return SENSITIVE_NAME_TOKENS.some(tok => normalized.includes(tok));
}

module.exports = { isSensitivePath };
