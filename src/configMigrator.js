"use strict";

/**
 * 2.0 config migration.
 *
 * The 1.x schema grew flat: ~25 top-level keys, five parallel per-camera
 * MAC arrays (garageDoorAccessory / spotLightAccessory / ...), two
 * exclude mechanisms (booleans + arrays), and three logging knobs
 * (apiLogEnabled / pluginLoggingEnabled / logLevel) that overlapped.
 *
 * 2.0 collapses all of that into a sectioned shape:
 *   {
 *     auth:     { username, password, keyId, apiKey, secretsFile? },
 *     polling:  { refreshInterval, lowBatteryPercentage },
 *     cameras:  [{ mac, name?, garage, spotlight, floodlight, siren, notifications }],
 *     thermostat: { exposeRoomSensors },
 *     hms:      { enabled },
 *     excludes: { macs: [], types: [] },
 *     logging:  { level, disableRedaction },
 *     advanced: { deviceTypeOverrides, dangerouslyAllowCustomBaseUrls, authBaseUrl, apiBaseUrl }
 *   }
 *
 * This module does two jobs:
 *
 *   1. `normalize(config)` — take whatever shape the user has on disk
 *      (1.x flat, 2.0 nested, or a mix) and return a single object with
 *      BOTH shapes populated. That way downstream code that still reads
 *      legacy field names (e.g. `config.pluginLoggingEnabled` in every
 *      accessory) keeps working unchanged while new code reads the
 *      nested fields.
 *
 *   2. `rewriteHomebridgeConfigOnDisk(...)` — find this plugin's entry
 *      in the user's homebridge config.json and rewrite it to the 2.0
 *      nested shape. Atomic, with a `.bak` next to the original. Only
 *      runs once — subsequent loads see the new shape and short-circuit.
 *
 * The on-disk rewrite is a UX optimization, not a correctness one. If
 * it fails for any reason (permissions, malformed JSON, can't find our
 * platform entry), normalize() still produces a working config from the
 * legacy fields and we log a warning telling the user to migrate by
 * hand. We never destructively modify a config we couldn't safely parse
 * back to the same shape.
 */

const fs = require("fs");
const path = require("path");

// ---- Helpers ---------------------------------------------------------------

const CAMERA_FEATURE_KEYS = [
  ["garage", "garageDoorAccessory"],
  ["spotlight", "spotLightAccessory"],
  ["floodlight", "floodLightAccessory"],
  ["siren", "sirenAccessory"],
  ["notifications", "notificationAccessory"],
  ["motionDetection", "motionDetectionAccessory"],
  ["nightVision", "nightVisionAccessory"],
];

// The Motion and Sound sensors are "auto" (the default: added when the camera's event list shows
// events of that kind), "on" or "off". `true` is "on". Anything else, including the `false` that
// used to mean "not switched on", is "auto".
const CAMERA_SENSOR_KEYS = [
  ["motionSensor", "motionSensorAccessory", "motionSensorOff"],
  ["soundSensor", "soundSensorAccessory", "soundSensorOff"],
];

// The AI labels that can get a sensor of their own (see camera/detectionSensors.js), or "none". An empty
// list, the default, is automatic.
// Names the plugin does not know are kept (and ignored when sensors are built): a list is exact.
function normalizeDetections(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((name) => String(name).trim().toLowerCase()).filter(Boolean))];
}

function sensorMode(value) {
  if (value === true || value === "on") return "on";
  if (value === "off") return "off";
  return "auto";
}

const ADVANCED_KEYS = [
  "deviceTypeOverrides",
  "dangerouslyAllowCustomBaseUrls",
  "authBaseUrl",
  "apiBaseUrl",
  // Camera pictures and live view (see the README).
  "snapshotRefreshSeconds",
  "snapshotOnMotion",
  "sensorHoldSeconds",
  "warmLiveView",
  // The camera test page (see wyze-api's src/web): 0 is off, 1024 to 65535 is the port it listens on.
  "webServerPort",
];

// Advanced options that are ON unless set: a `false` here is the user's choice, so rewriting the config must keep it
// (dropping it would switch the option back on). For every other advanced option `false` is the default.
const ADVANCED_DEFAULT_ON = new Set(["snapshotOnMotion"]);

// Top-level options the plugin still reads that have no nested home. They are kept
// as they are when a flat config is rewritten, so a migration doesn't reset them.
const PASSTHROUGH_KEYS = [
  "securityRefreshInterval",
  "phoneId",
  "authApiKey",
  "appName",
  "appVer",
  "appVersion",
  "userAgent",
  "sc",
  "sv",
  // Read by WyzeSmartHome (locks, thermostat).
  "fordAppKey",
  "fordAppSecret",
  "oliveSigningSecret",
  "oliveAppId",
  "appInfo",
];

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

// ---- normalize -------------------------------------------------------------

/**
 * Take a config of any shape and return one that has both the nested 2.0
 * fields and the legacy flat fields populated, so old and new code paths
 * both work. Returns a NEW object — input is not mutated.
 */
function normalize(input) {
  const c = { ...(input || {}) };

  // --- Auth ---
  const auth = isPlainObject(c.auth) ? c.auth : {};
  c.auth = {
    username: auth.username ?? c.username ?? "",
    password: auth.password ?? c.password ?? "",
    keyId: auth.keyId ?? c.keyId ?? "",
    apiKey: auth.apiKey ?? c.apiKey ?? "",
    secretsFile: auth.secretsFile ?? c.secretsFile ?? "",
    mfaCode: auth.mfaCode ?? c.mfaCode ?? "",
    totpSecret: auth.totpSecret ?? c.totpSecret ?? "",
  };
  // Mirror to flat for legacy consumers.
  c.username = c.auth.username;
  c.password = c.auth.password;
  c.keyId = c.auth.keyId;
  c.apiKey = c.auth.apiKey;
  c.secretsFile = c.auth.secretsFile;
  c.mfaCode = c.auth.mfaCode;
  c.totpSecret = c.auth.totpSecret;

  // --- Polling ---
  const polling = isPlainObject(c.polling) ? c.polling : {};
  c.polling = {
    refreshInterval: polling.refreshInterval ?? c.refreshInterval ?? 30000,
    lowBatteryPercentage: polling.lowBatteryPercentage ?? c.lowBatteryPercentage ?? 30,
  };
  c.refreshInterval = c.polling.refreshInterval;
  c.lowBatteryPercentage = c.polling.lowBatteryPercentage;

  // --- Cameras (per-MAC capability rows) ---
  // Build the unified array from whichever side has data.
  const cameraMap = new Map();
  if (Array.isArray(c.cameras)) {
    for (const cam of c.cameras) {
      if (!cam?.mac) continue;
      cameraMap.set(cam.mac, {
        mac: cam.mac,
        name: cam.name || "",
        garage: !!cam.garage,
        spotlight: !!cam.spotlight,
        floodlight: !!cam.floodlight,
        siren: !!cam.siren,
        notifications: !!cam.notifications,
        motionDetection: !!cam.motionDetection,
        nightVision: !!cam.nightVision,
        motionSensor: sensorMode(cam.motionSensor),
        soundSensor: sensorMode(cam.soundSensor),
        detections: normalizeDetections(cam.detections),
      });
    }
  }
  for (const [feature, legacyKey] of CAMERA_FEATURE_KEYS) {
    const arr = Array.isArray(c[legacyKey]) ? c[legacyKey] : [];
    for (const mac of arr) {
      if (typeof mac !== "string" || !mac) continue;
      const row = cameraMap.get(mac) || {
        mac,
        name: "",
        garage: false, spotlight: false, floodlight: false, siren: false, notifications: false, motionDetection: false, nightVision: false,
        motionSensor: "auto", soundSensor: "auto", detections: [],
      };
      row[feature] = true;
      cameraMap.set(mac, row);
    }
  }
  for (const [feature, onKey] of CAMERA_SENSOR_KEYS) {
    const arr = Array.isArray(c[onKey]) ? c[onKey] : [];
    for (const mac of arr) {
      if (typeof mac !== "string" || !mac) continue;
      const row = cameraMap.get(mac) || {
        mac,
        name: "",
        garage: false, spotlight: false, floodlight: false, siren: false, notifications: false, motionDetection: false, nightVision: false,
        motionSensor: "auto", soundSensor: "auto", detections: [],
      };
      row[feature] = "on";
      cameraMap.set(mac, row);
    }
  }
  c.cameras = Array.from(cameraMap.values());
  // Mirror back to legacy arrays so existing accessory code keeps working.
  for (const [feature, legacyKey] of CAMERA_FEATURE_KEYS) {
    c[legacyKey] = c.cameras.filter((cam) => cam[feature]).map((cam) => cam.mac);
  }
  for (const [feature, onKey, offKey] of CAMERA_SENSOR_KEYS) {
    c[onKey] = c.cameras.filter((cam) => cam[feature] === "on").map((cam) => cam.mac);
    c[offKey] = c.cameras.filter((cam) => cam[feature] === "off").map((cam) => cam.mac);
  }

  // --- Thermostat ---
  const thermostat = isPlainObject(c.thermostat) ? c.thermostat : {};
  // mode: undefined/auto → no restriction, "heat-only" / "cool-only"
  // hide the unsupported sides in HomeKit. Useful when the physical
  // wiring is one-sided (gas furnace with no AC, etc.).
  let tmode = thermostat.mode ?? c.thermostatMode;
  if (tmode != null) {
    tmode = String(tmode).toLowerCase();
    if (!['auto', 'heat-only', 'cool-only'].includes(tmode)) tmode = 'auto';
  }
  c.thermostat = {
    exposeRoomSensors: thermostat.exposeRoomSensors ?? c.enableThermostatRoomSensors ?? false,
    mode: tmode || 'auto',
  };
  c.enableThermostatRoomSensors = c.thermostat.exposeRoomSensors;
  c.thermostatMode = c.thermostat.mode;

  // --- Vacuum ---
  const vacuum = isPlainObject(c.vacuum) ? c.vacuum : {};
  c.vacuum = {
    perRoomSwitches: vacuum.perRoomSwitches ?? c.vacuumPerRoomSwitches ?? false,
  };
  c.vacuumPerRoomSwitches = c.vacuum.perRoomSwitches;

  // --- Irrigation ---
  // The zone each sprinkler controller runs, as rows in the settings screen ({ mac, zone }) or as the older
  // `irrigationZone: { mac: zone }` map. Code reads the map.
  const irrigation = isPlainObject(c.irrigation) ? c.irrigation : {};
  const zones = isPlainObject(c.irrigationZone) ? { ...c.irrigationZone } : {};
  for (const row of Array.isArray(irrigation.zones) ? irrigation.zones : []) {
    if (isPlainObject(row) && row.mac) zones[String(row.mac)] = row.zone;
  }
  c.irrigationZone = zones;
  c.irrigation = { zones: Object.entries(zones).map(([mac, zone]) => ({ mac, zone })) };

  // --- HMS ---
  const hmsBlock = isPlainObject(c.hms) ? c.hms : null;
  const hmsEnabled = hmsBlock ? !!hmsBlock.enabled : !!c.hms;
  c.hms = { enabled: hmsEnabled };
  // Some old code does `if (config.hms == false)` — keep a top-level
  // boolean alias so those checks still work.
  Object.defineProperty(c, "hmsEnabled", { value: hmsEnabled, enumerable: false });

  // --- Excludes ---
  const excludes = isPlainObject(c.excludes) ? c.excludes : {};
  const macs = Array.isArray(excludes.macs)
    ? excludes.macs
    : (c.excludeMacAddress && Array.isArray(c.filterByMacAddressList) ? c.filterByMacAddressList : []);
  const types = Array.isArray(excludes.types)
    ? excludes.types
    : (c.excludedeviceType && Array.isArray(c.filterDeviceTypeList) ? c.filterDeviceTypeList : []);
  c.excludes = { macs, types };
  c.filterByMacAddressList = macs;
  c.filterDeviceTypeList = types;
  // Legacy boolean toggles — derive from array contents so old checks still gate correctly.
  c.excludeMacAddress = macs.length > 0;
  c.excludedeviceType = types.length > 0;

  // --- Logging ---
  const logging = isPlainObject(c.logging) ? c.logging : {};
  // Resolution priority: nested level → flat logLevel → legacy apiLogEnabled boolean → default 'info'.
  let level = logging.level ?? c.logLevel;
  // Either legacy toggle meant "more log lines", and both map onto debug (see pluginLoggingEnabled below).
  if (!level) level = c.apiLogEnabled || c.pluginLoggingEnabled ? "debug" : "info";
  level = String(level).toLowerCase();
  if (!["error", "warn", "info", "debug"].includes(level)) level = "info";

  c.logging = {
    level,
    disableRedaction: logging.disableRedaction ?? c.disableLogRedaction ?? false,
  };
  c.logLevel = level;
  c.disableLogRedaction = !!c.logging.disableRedaction;
  // Legacy boolean equivalents.
  c.apiLogEnabled = level === "debug";
  // pluginLoggingEnabled gates ~80 verbose log lines across accessory
  // files. Map it onto debug so users get the same behavior they used
  // to get from the standalone toggle without needing both knobs.
  c.pluginLoggingEnabled = level === "debug";

  // --- Advanced ---
  const advanced = isPlainObject(c.advanced) ? c.advanced : {};
  c.advanced = {};
  for (const k of ADVANCED_KEYS) {
    c.advanced[k] = advanced[k] ?? c[k];
    if (c.advanced[k] !== undefined) c[k] = c.advanced[k];
  }

  return c;
}

// ---- Build the canonical 2.0 shape for disk write -------------------------

/**
 * Project the normalized config down to the minimal 2.0 nested shape
 * (no legacy mirror fields). This is what we want sitting on disk.
 *
 * Drops empty optional fields so the saved file isn't cluttered with
 * keys the user never set.
 */
function toCanonical2x(normalized, platformMeta) {
  const out = {
    // Carry through homebridge platform identity.
    name: platformMeta.name || normalized.name || "Wyze",
    platform: platformMeta.platform || "WyzeSmartHome",

    auth: {
      username: normalized.auth.username,
      password: normalized.auth.password,
      keyId: normalized.auth.keyId,
      apiKey: normalized.auth.apiKey,
    },
    polling: {
      refreshInterval: normalized.polling.refreshInterval,
      lowBatteryPercentage: normalized.polling.lowBatteryPercentage,
    },
    cameras: normalized.cameras,
    thermostat: {
      exposeRoomSensors: normalized.thermostat.exposeRoomSensors,
      mode: normalized.thermostat.mode || 'auto',
    },
    vacuum: { perRoomSwitches: normalized.vacuum.perRoomSwitches },
    ...(normalized.irrigation.zones.length ? { irrigation: { zones: normalized.irrigation.zones } } : {}),
    hms: { enabled: normalized.hms.enabled },
    excludes: { macs: normalized.excludes.macs, types: normalized.excludes.types },
    logging: {
      level: normalized.logging.level,
      disableRedaction: normalized.logging.disableRedaction,
    },
  };

  if (normalized.auth.secretsFile) out.auth.secretsFile = normalized.auth.secretsFile;
  if (normalized.auth.mfaCode) out.auth.mfaCode = normalized.auth.mfaCode;
  if (normalized.auth.totpSecret) out.auth.totpSecret = normalized.auth.totpSecret;

  for (const k of PASSTHROUGH_KEYS) {
    const v = normalized[k];
    if (v != null && v !== "") out[k] = v;
  }

  // Only include the advanced block if anything in it is set, so the
  // file stays clean for the 99% of users who never touch it.
  const advanced = {};
  for (const k of ADVANCED_KEYS) {
    const v = normalized.advanced?.[k];
    if (v == null) continue;
    if (typeof v === "object" && Object.keys(v).length === 0) continue;
    if (typeof v === "boolean" && v === false && !ADVANCED_DEFAULT_ON.has(k)) continue;
    if (typeof v === "string" && v === "") continue;
    advanced[k] = v;
  }
  if (Object.keys(advanced).length > 0) out.advanced = advanced;

  return out;
}


// Top-level keys that normalize() reads and toCanonical2x() writes in their nested place (or deliberately drops, like
// the settings screen's `showAdvancedOptions` toggle). Every other key in the user's entry is kept as it was.
const CONSUMED_KEYS = new Set([
  "username", "password", "keyId", "apiKey", "secretsFile", "mfaCode", "totpSecret",
  "refreshInterval", "lowBatteryPercentage",
  ...CAMERA_FEATURE_KEYS.map(([, legacy]) => legacy),
  ...CAMERA_SENSOR_KEYS.flatMap(([, on, off]) => [on, off]),
  "enableThermostatRoomSensors", "thermostatMode", "vacuumPerRoomSwitches", "irrigationZone",
  "excludeMacAddress", "filterByMacAddressList", "excludedeviceType", "filterDeviceTypeList",
  "logLevel", "apiLogEnabled", "pluginLoggingEnabled", "disableLogRedaction", "showAdvancedOptions",
  ...ADVANCED_KEYS,
]);

// Copy what the user had that the canonical shape has no place for, so rewriting the file never deletes a setting:
// unknown top-level keys, unknown keys inside the nested blocks, and camera rows without a `mac` or with extra keys.
function carryUnknown(original, canonical) {
  for (const key of Object.keys(original)) {
    if (CONSUMED_KEYS.has(key)) continue;
    if (!(key in canonical)) {
      canonical[key] = original[key];
    } else if (isPlainObject(original[key]) && isPlainObject(canonical[key])) {
      for (const sub of Object.keys(original[key])) {
        if (!(sub in canonical[key])) canonical[key][sub] = original[key][sub];
      }
    }
  }
  if (Array.isArray(original.cameras) && Array.isArray(canonical.cameras)) {
    const rows = new Map(canonical.cameras.map((row) => [row.mac, row]));
    for (const cam of original.cameras) {
      if (!isPlainObject(cam)) continue;
      const row = cam.mac ? rows.get(cam.mac) : null;
      if (!row) {
        canonical.cameras.push({ ...cam });
        continue;
      }
      for (const sub of Object.keys(cam)) if (!(sub in row)) row[sub] = cam[sub];
    }
  }
  // An exclude list kept while its switch was off is not active, so it must not become one. Park it where the
  // plugin does not read it.
  if (original.excludeMacAddress === false && Array.isArray(original.filterByMacAddressList) && original.filterByMacAddressList.length) {
    canonical._disabledExcludeMacs = original.filterByMacAddressList;
  }
  if (original.excludedeviceType === false && Array.isArray(original.filterDeviceTypeList) && original.filterDeviceTypeList.length) {
    canonical._disabledExcludeTypes = original.filterDeviceTypeList;
  }
  return canonical;
}

// ---- isAlready2x ----------------------------------------------------------

/**
 * Detect whether a raw (pre-normalize) config is already in the 2.0
 * shape — meaning the on-disk rewrite has nothing to do.
 *
 * Heuristic: the nested blocks exist AND none of the legacy top-level
 * fields are present. We check for presence (not just truthiness) so a
 * deliberate `username: ""` in legacy form still triggers migration.
 */
function isAlready2x(raw) {
  if (!isPlainObject(raw)) return false;
  if (!isPlainObject(raw.auth)) return false;
  const legacyKeys = [
    "username", "password", "keyId", "apiKey",
    "garageDoorAccessory", "spotLightAccessory", "floodLightAccessory",
    "sirenAccessory", "notificationAccessory",
    "excludeMacAddress", "filterByMacAddressList",
    "excludedeviceType", "filterDeviceTypeList",
    "apiLogEnabled", "pluginLoggingEnabled", "showAdvancedOptions",
    "enableThermostatRoomSensors", "refreshInterval", "lowBatteryPercentage",
  ];
  return !legacyKeys.some((k) => Object.prototype.hasOwnProperty.call(raw, k));
}

// ---- rewriteHomebridgeConfigOnDisk ----------------------------------------

/**
 * Find our platform entry in homebridge's config.json and rewrite it to
 * the 2.0 nested shape. Atomic write with a `.bak` snapshot.
 *
 * Returns one of: "already-migrated" | "migrated" | "skipped:<reason>".
 *
 * Never throws — failures degrade gracefully (log + return reason). The
 * in-memory normalized config is what actually drives the running
 * plugin, so a failed disk rewrite means "users will see the old form
 * in the UI until they edit by hand," not "the plugin breaks."
 */
function rewriteHomebridgeConfigOnDisk({ configPath, platformAlias, log }) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (e) {
    return `skipped:read-failed (${e.code || e.message})`;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    log?.warn?.(`[config] homebridge config.json is not valid JSON; skipping 2.0 auto-migration: ${e.message}`);
    return "skipped:parse-failed";
  }

  if (!Array.isArray(parsed.platforms)) return "skipped:no-platforms-array";

  // Find ALL entries matching our alias. If a user has multiple Wyze
  // platforms (rare but legal — different accounts), migrate each.
  const indices = [];
  parsed.platforms.forEach((p, i) => {
    if (p && (p.platform === platformAlias || p.platform === "WyzeSmartHome" || /\.WyzeSmartHome$/.test(String(p.platform)))) indices.push(i);
  });
  if (indices.length === 0) return "skipped:plugin-not-in-config";

  let migratedAny = false;
  for (const i of indices) {
    const original = parsed.platforms[i];
    if (isAlready2x(original)) continue;
    const normalized = normalize(original);
    const canonical = toCanonical2x(normalized, {
      name: original.name,
      platform: original.platform,
    });
    // Keys Homebridge itself owns (`_bridge`: the child bridge's name, pin and port) are not plugin settings, so the
    // rebuilt entry would silently lose them: the plugin would fall back to the main bridge and every accessory would
    // have to be paired again. Any other key the plugin has no place for is kept too.
    carryUnknown(original, canonical);
    parsed.platforms[i] = canonical;
    migratedAny = true;
  }

  if (!migratedAny) return "already-migrated";

  // Round-trip the new JSON before touching disk to make sure we
  // produce something parseable. Safety net against bugs in
  // toCanonical2x.
  const newJson = JSON.stringify(parsed, null, 4);
  try {
    JSON.parse(newJson);
  } catch (e) {
    log?.error?.(`[config] internal error: migrated config did not round-trip JSON; aborting disk rewrite (${e.message})`);
    return "skipped:roundtrip-failed";
  }

  // Write the real file, not a symlink to it, and keep its mode. Resolve the path first so the temp file and the
  // rename are on the same file system as the target.
  let target = configPath;
  let mode = 0o600;
  try {
    target = fs.realpathSync(configPath);
    mode = fs.statSync(target).mode & 0o777;
  } catch (_) {}

  // A backup of this run's file, never overwriting an earlier one: the first goes to `.pre-2.0.bak`, later ones
  // (a restored old config migrated again) get a timestamp, so a stale backup is never all that is left.
  let backupPath = `${target}.pre-2.0.bak`;
  try {
    try {
      fs.writeFileSync(backupPath, raw, { mode: 0o600, flag: "wx" });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      backupPath = `${target}.pre-2.0.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      fs.writeFileSync(backupPath, raw, { mode: 0o600, flag: "wx" });
    }
  } catch (e) {
    log?.warn?.(`[config] could not write backup ${backupPath}; aborting auto-migration: ${e.message}`);
    return "skipped:backup-failed";
  }

  // Atomic write via temp + rename (same dir so it's always same fs).
  const tmpPath = path.join(path.dirname(target), `.${path.basename(target)}.wyze-migrate.tmp`);
  try {
    fs.writeFileSync(tmpPath, newJson, { mode });
    fs.renameSync(tmpPath, target);
  } catch (e) {
    log?.error?.(`[config] failed to write migrated config: ${e.message}`);
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    return `skipped:write-failed (${e.code || e.message})`;
  }

  log?.warn?.(
    `[config] Migrated ${indices.length} Wyze platform entr${indices.length === 1 ? "y" : "ies"} ` +
    `in ${configPath} to the 2.0 nested shape. A backup of your previous config ` +
    `was saved to ${backupPath}. It holds your old settings, including your Wyze password, so delete it once you are happy ` +
    `with the new config. See the 2.0 release notes for the new structure.`
  );
  return "migrated";
}

module.exports = {
  ADVANCED_DEFAULT_ON,
  ADVANCED_KEYS,
  normalize,
  toCanonical2x,
  isAlready2x,
  rewriteHomebridgeConfigOnDisk,
};
