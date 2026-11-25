"use strict";

/**
 * Finds credentials pasted into an issue. It returns the NAMES of the secrets it sees, never
 * their values, so a comment about them cannot repeat them. A value replaced with REDACTED
 * (or <...>, [...], ***, xxx) counts as removed.
 */

// Secrets: the plugin's own settings (auth.password, auth.apiKey, auth.keyId, auth.totpSecret,
// auth.mfaCode), the tokens Wyze hands back, and the Homebridge setup PIN. Posting one means it
// has to be changed.
const SECRET_KEYS = [
  "password", "passwd", "apikey", "api_key", "keyid", "key_id", "totpsecret", "totp_secret",
  "mfacode", "mfa_code", "access_token", "accesstoken", "refresh_token", "refreshtoken",
  "token", "secret", "authorization", "cookie", "pin", "setupid",
];

// Other Homebridge plugins' configs, which people paste whole, use these for secrets (OpenGarage,
// TuyaLan and WeatherPlus "key", Pushover "user" and "token"). The words are too common in prose
// to match anywhere, so they count only as a quoted JSON key with a long value.
const JSON_ONLY_SECRET_KEYS = ["key", "user"];
const looksLikeSecretValue = (value) => String(value).trim().length >= 8 && !/\s/.test(String(value).trim());
const isSecretJson = (key, value) =>
  !isRemoved(value) && (SECRET_KEYS.includes(key.toLowerCase()) || (JSON_ONLY_SECRET_KEYS.includes(key.toLowerCase()) && looksLikeSecretValue(value)));

// Personal details that identify a person, a home or a network: a Wyze email (auth.username,
// or "username" in the _bridge block, which is a MAC), device MACs (cameras[].mac,
// excludes.macs), names and addresses from the device list. Posting one does not need a new
// key, but the value should not stay in a public issue.
const PERSONAL_KEYS = [
  "username", "user_name", "email", "mac", "macs", "bssid", "ssid", "ip", "ipaddr", "nickname",
  "phone", "phone_id", "address", "latitude", "longitude", "lat", "lon", "lng",
];
// username/email count only when the value is an email address or a MAC (a bare "username" in a
// log line can be anything).
const NEEDS_ADDRESS_LIKE = new Set(["username", "user_name", "email"]);
const EMAIL_OR_MAC = /@|^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{12}$/;

// Matches only the secret names themselves, so a word before one ("log: totpSecret = x") cannot hide it. A name that
// follows an underscore counts (WYZE_PASSWORD=, WYZE_API_KEY=, which the README documents), a letter or digit before it
// does not (mypassword).
const NAMES = SECRET_KEYS.join("|");
const BEFORE_NAME = "(?<![A-Za-z0-9])";
// A value is quoted (with escapes, so "p\"ass" is one value) or runs to the end of the line, so a password with spaces
// in it is removed whole and not just its first word.
const VALUE = "\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*'|[^\"',}\\]\\n]*[^\\s\"',}\\]]";
// A password a person chose can have spaces in it, so it is taken to the end of the line. A key or token cannot, so only
// its first word is the value and the words after it are left alone.
const SPACED_SECRETS = new Set(["password", "passwd", "secret", "pin"]);
function splitValue(key, value) {
  if (SPACED_SECRETS.has(key.toLowerCase()) || /^["']/.test(value)) return { secret: value, rest: "" };
  const token = value.split(/\s/)[0];
  return { secret: token, rest: value.slice(token.length) };
}
const KEY_VALUE = () => new RegExp(`${BEFORE_NAME}(${NAMES})(\\s*[:=]\\s*)(${VALUE})`, "gi");
// Command-line form: --password value
const FLAG_VALUE = () => new RegExp(`(--)(${NAMES})(\\s+)(\\S+)`, "gi");
// JSON: "password": "value", with escapes in the value.
const JSON_PAIR = () => /["']([A-Za-z_]+)["']\s*:\s*(["'])((?:\\.|(?!\2)[^\\\n])*)\2/g;

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
    [JSON_PAIR(), 3],
    [KEY_VALUE(), 3],
    [FLAG_VALUE(), 4],
  ];
  for (const [pattern, valueGroup] of patterns) {
    let m;
    while ((m = pattern.exec(source))) {
      const key = (valueGroup === 4 ? m[2] : m[1]).toLowerCase();
      const json = pattern.source === JSON_PAIR().source;
      const ok = json ? isSecretJson(key, m[valueGroup]) : SECRET_KEYS.includes(key) && !isRemoved(valueGroup === 3 ? splitValue(key, m[valueGroup]).secret : m[valueGroup]);
      if (ok) found.add(key);
    }
  }
  // A bearer token or a Wyze access token on its own.
  if (/\bBearer\s+[A-Za-z0-9._-]{20,}/.test(source)) found.add("authorization");
  return [...found].sort();
}

/** `text` with the value of every secret setting replaced by REDACTED. Removed values stay as they are. */
function redactCredentials(text) {
  const source = String(text || "");
  const quoted = /(["'])([A-Za-z_]+)\1(\s*:\s*)(["'])((?:\\.|(?!\4)[^\\\n])*)\4/g;
  return source
    .replace(quoted, (whole, q, key, colon, vq, value) =>
      isSecretJson(key, value) ? `${q}${key}${q}${colon}${vq}REDACTED${vq}` : whole)
    .replace(KEY_VALUE(), (whole, key, sep, value) => {
      const { secret, rest } = splitValue(key, value);
      return isRemoved(secret) ? whole : `${key}${sep}REDACTED${rest}`;
    })
    .replace(FLAG_VALUE(), (whole, dashes, key, space, value) => (isRemoved(value) ? whole : `${dashes}${key}${space}REDACTED`))
    .replace(/\bBearer\s+[A-Za-z0-9._-]{20,}/g, "Bearer REDACTED");
}

const PERSONAL = PERSONAL_KEYS.join("|");
const personalMatches = (value, key) => !isRemoved(value) && (!NEEDS_ADDRESS_LIKE.has(key.toLowerCase()) || EMAIL_OR_MAC.test(String(value).trim().replace(/^["']|["']$/g, "")));

/** Names (lower case, sorted) of personal details with a real-looking value in `text`. */
function personalKeysIn(text) {
  const found = new Set();
  const source = String(text || "");
  let m;
  const quoted = new RegExp(`["'](${PERSONAL})["']\\s*:\\s*["']([^"'\\n]*)["']`, "gi");
  while ((m = quoted.exec(source))) if (personalMatches(m[2], m[1])) found.add(m[1].toLowerCase());
  const numeric = /["'](latitude|longitude|lat|lon|lng)["']\s*:\s*(-?\d[\d.]*)/gi;
  while ((m = numeric.exec(source))) found.add(m[1].toLowerCase());
  const lists = new RegExp(`["'](macs)["']\\s*:\\s*\\[([^\\]]*)\\]`, "gi");
  while ((m = lists.exec(source))) if (/["'][^"']+["']/.test(m[2]) && !/^\s*(["']?REDACTED["']?\s*,?\s*)+$/i.test(m[2])) found.add("macs");
  // The log line the device form asks people to copy: "(Name: ...) (MAC: ...) (Model: XXXX)".
  const nameLine = /\((Name|MAC):\s*([^)]*)\)/g;
  while ((m = nameLine.exec(source))) if (!isRemoved(m[2])) found.add(m[1].toLowerCase() === "name" ? "nickname" : "mac");
  return [...found].sort();
}

/** `text` with every secret and every personal detail replaced by REDACTED. */
function redactAll(text) {
  const source = redactCredentials(text);
  return source
    .replace(new RegExp(`(["'])(${PERSONAL})\\1(\\s*:\\s*)(["'])([^"'\\n]*)\\4`, "gi"), (whole, q, key, colon, vq, value) =>
      personalMatches(value, key) ? `${q}${key}${q}${colon}${vq}REDACTED${vq}` : whole)
    .replace(/(["'](?:latitude|longitude|lat|lon|lng)["']\s*:\s*)(-?\d[\d.]*)/gi, '$1"REDACTED"')
    .replace(/(["']macs["']\s*:\s*)\[([^\]]*)\]/gi, (whole, head, items) =>
      /["'][^"']+["']/.test(items) ? `${head}[${items.replace(/(["'])[^"']*\1/g, '"REDACTED"')}]` : whole)
    .replace(/\((Name|MAC):\s*([^)]*)\)/g, (whole, label, value) => (isRemoved(value) ? whole : `(${label}: REDACTED)`));
}

module.exports = { SECRET_KEYS, JSON_ONLY_SECRET_KEYS, PERSONAL_KEYS, credentialKeysIn, personalKeysIn, redactCredentials, redactAll };
