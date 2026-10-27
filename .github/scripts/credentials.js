"use strict";

/**
 * Finds credentials pasted into an issue. It returns the NAMES of the secrets it sees, never
 * their values, so a comment about them cannot repeat them. A value replaced with REDACTED
 * (or <...>, [...], ***, xxx) counts as removed.
 */

const SECRET_KEYS = [
  "password", "passwd", "apikey", "api_key", "keyid", "key_id", "totpsecret", "totp_secret",
  "mfacode", "mfa_code", "access_token", "accesstoken", "refresh_token", "refreshtoken",
  "token", "secret", "authorization",
];

// Matches only the secret names themselves, so a word before one ("log: totpSecret = x") cannot hide it.
const KEY_VALUE = () => new RegExp("\\b(" + SECRET_KEYS.join("|") + ")(\\s*[:=]\\s*)([^\\s\"',}\\]]+)", "gi");

const isRemoved = (value) => {
  const v = String(value).trim().replace(/^["'`]+|["'`,]+$/g, "");
  return v === "" || /^(redacted|removed|hidden|none|null|undefined|x+|\*+|\.+)$/i.test(v) || /^<.*>$/.test(v) || /^\[.*\]$/.test(v) || /^\$\{.*\}$/.test(v);
};

/** Names (lower case, sorted) of secret settings that have a real-looking value in `text`. */
function credentialKeysIn(text) {
  const found = new Set();
  const source = String(text || "");
  // "password": "value" (JSON) and password: value / password=value / --password value (logs, shells)
  const patterns = [
    [/["']([A-Za-z_]+)["']\s*:\s*["']([^"'\n]*)["']/g, 2],
    [KEY_VALUE(), 3],
  ];
  for (const [pattern, valueGroup] of patterns) {
    let m;
    while ((m = pattern.exec(source))) {
      const key = m[1].toLowerCase();
      if (SECRET_KEYS.includes(key) && !isRemoved(m[valueGroup])) found.add(key);
    }
  }
  // A bearer token or a Wyze access token on its own.
  if (/\bBearer\s+[A-Za-z0-9._-]{20,}/.test(source)) found.add("authorization");
  return [...found].sort();
}

/** `text` with the value of every secret setting replaced by REDACTED. Removed values stay as they are. */
function redactCredentials(text) {
  const source = String(text || "");
  const quoted = /(["'])([A-Za-z_]+)\1(\s*:\s*)(["'])([^"'\n]*)\4/g;
  return source
    .replace(quoted, (whole, q, key, colon, vq, value) =>
      SECRET_KEYS.includes(key.toLowerCase()) && !isRemoved(value) ? `${q}${key}${q}${colon}${vq}REDACTED${vq}` : whole)
    .replace(KEY_VALUE(), (whole, key, sep, value) => (isRemoved(value) ? whole : `${key}${sep}REDACTED`))
    .replace(/\bBearer\s+[A-Za-z0-9._-]{20,}/g, "Bearer REDACTED");
}

module.exports = { SECRET_KEYS, credentialKeysIn, redactCredentials };
