// The logic of the "Detected sensors" panel on the plugin's settings page, kept apart from the page so it can be tested.
// A classic script: the page loads it with a plain <script> tag and finds it as WyzeDetected. The tests run it in a
// vm, because homebridge-ui/package.json makes .js files in this folder ES modules for Node.
(function (root) {
  "use strict";

  // The AI labels a camera's events can carry, as the config names them. The ones marked `auto` are added by
  // themselves; the others only when named. A test keeps this in step with src/camera/detectionSensors.js.
  const LABELS = [
    { value: "person", label: "Person", auto: true },
    { value: "vehicle", label: "Vehicle", auto: true },
    { value: "pet", label: "Pet", auto: true },
    { value: "package", label: "Package", auto: true },
    { value: "face", label: "Face", auto: false },
  ];

  // This camera's `detections` setting: "auto" (not set, or empty), "none", or the list chosen. A list is exact,
  // and keeps names this page has no row for.
  function settingFor(entry, mac) {
    const row = ((entry && entry.cameras) || []).find((cam) => cam && cam.mac === mac);
    const list = (row && Array.isArray(row.detections) ? row.detections : []).map((name) => String(name).trim().toLowerCase()).filter(Boolean);
    if (list.includes("none")) return "none";
    return list.length > 0 ? [...new Set(list)] : "auto";
  }

  // Motion and Sound are a setting each on the camera's row: "auto" (the key absent), "on" or "off".
  const SENSORS = [
    { key: "motionSensor", label: "Motion", found: "motion" },
    {
      key: "soundSensor",
      label: "Sound",
      found: "sound",
      // Wyze only lists sound events when sound recording is on for the camera, so with it off the sensor cannot fire.
      needs: "soundRecording",
      warning: "Sound recording is off for this camera in Wyze, so Wyze reports no sound events and this sensor cannot fire. Turn it on in the Wyze app, then restart Homebridge.",
    },
  ];
  const MODES = ["auto", "on", "off"];

  function modeFor(entry, mac, key) {
    const row = ((entry && entry.cameras) || []).find((cam) => cam && cam.mac === mac);
    const value = row ? row[key] : undefined;
    if (value === "on" || value === true) return "on";
    return value === "off" ? "off" : "auto";
  }

  const titleCase = (name) => name.charAt(0).toUpperCase() + name.slice(1);

  // What to show: one entry per camera in the plugin's file, with a row for each label it carries (or that its
  // list names), ticked as the current setting would have it. `isNew` marks a label the current setting does not give.
  function buildView(detected, config) {
    const entry = Array.isArray(config) && config.length > 0 ? config[0] : null;
    return Object.entries((detected && detected.cameras) || {}).map(([mac, cam]) => {
      const setting = settingFor(entry, mac);
      const found = new Set(cam.labels || []);
      const given = (l) => (setting === "auto" ? l.auto && found.has(l.value) : setting !== "none" && setting.includes(l.value));
      const items = LABELS.filter((l) => found.has(l.value) || given(l)).map((l) => ({
        value: l.value,
        label: l.label,
        auto: l.auto,
        found: found.has(l.value),
        checked: given(l),
        isNew: found.has(l.value) && !given(l),
        other: false,
        ai: true, // these come from Wyze's AI tags, which need a plan that includes AI detection
      }));
      // Items the plugin has no name for (found, or already in the list). They can be saved into the list; the
      // plugin ignores them when it builds sensors, so they cannot create a tile.
      const known = new Set(LABELS.map((l) => l.value));
      const unknown = new Set([...found, ...(Array.isArray(setting) ? setting : [])]);
      for (const value of [...unknown].filter((name) => !known.has(name)).sort()) {
        const listed = Array.isArray(setting) && setting.includes(value);
        items.push({ value, label: titleCase(value), auto: false, found: found.has(value), checked: listed, isNew: found.has(value) && !listed, other: true, ai: true });
      }
      // Motion and Sound: ticked when the camera would have the sensor under its current setting.
      const sensors = SENSORS.map((sensor) => {
        const mode = modeFor(entry, mac, sensor.key);
        const seen = Boolean(cam[sensor.found]);
        const blocked = Boolean(sensor.needs) && cam[sensor.needs] === false;
        return { key: sensor.key, label: sensor.label, ai: false, blocked, warning: blocked ? sensor.warning : "", mode, found: seen, checked: mode === "on" || (mode === "auto" && seen) };
      });
      return {
        mac,
        name: cam.name || mac,
        model: cam.model || "",
        setting,
        items,
        sensors,
        unnamed: cam.unnamed || [],
        motion: Boolean(cam.motion),
        sound: Boolean(cam.sound),
        at: cam.at || "",
      };
    });
  }

  // The `detections` list for the ticked rows. Nothing ticked is "none": an empty list would mean automatic.
  function valuesFor(items) {
    const values = items.filter((item) => item.checked).map((item) => item.value);
    return values.length > 0 ? values : ["none"];
  }

  // The Motion and Sound settings for the ticked boxes. A box that matches what automatic would do leaves the
  // setting automatic; ticking one the camera has not reported turns it on; unticking one that would be there turns it off.
  function modesFor(sensors) {
    const modes = {};
    for (const sensor of sensors) {
      if (sensor.blocked) continue; // cannot be changed here: left as it is
      if (sensor.mode === "auto" && sensor.checked === sensor.found) modes[sensor.key] = "auto";
      else if (sensor.checked) modes[sensor.key] = sensor.mode === "on" ? "on" : sensor.found ? "auto" : "on";
      else modes[sensor.key] = "off";
    }
    return modes;
  }

  // The plugin config (an array, as the settings page hands it over) with this camera's `detections` set. With no
  // values the key is removed, which is automatic. A camera not in the config yet gets an entry. Returns a copy.
  function applyDetections(config, mac, name, values, modes) {
    const next = JSON.parse(JSON.stringify(config || []));
    const entry = next[0];
    if (!entry) return next;
    if (!Array.isArray(entry.cameras)) entry.cameras = [];
    // `values` null leaves `detections` as it is; `modes` names Motion/Sound settings to change.
    const keys = modes ? SENSORS.map((sensor) => sensor.key).filter((key) => modes[key] !== undefined) : [];
    const sets = (Array.isArray(values) && values.length > 0) || keys.some((key) => modes[key] !== "auto");
    let row = entry.cameras.find((cam) => cam && cam.mac === mac);
    if (!row) {
      if (!sets) return next; // automatic is what a camera with no entry already is
      row = { mac };
      if (name) row.name = name;
      entry.cameras.push(row);
    }
    if (Array.isArray(values)) {
      if (values.length === 0) delete row.detections;
      else row.detections = [...values];
    }
    for (const key of keys) {
      if (modes[key] === "auto") delete row[key];
      else row[key] = modes[key];
    }
    return next;
  }

  // ---- checking a change before it is saved -----------------------------------------------------------------
  // The page saves nothing unless every check here passes, and a check that cannot be completed counts as a
  // failure: it never saves on a guess.
  const NAME_PATTERN = /^[a-z0-9][a-z0-9 _-]{0,31}$/; // a name in the list: lower case, short, nothing that needs escaping
  const MAC_PATTERN = /^[A-Za-z0-9._:-]{4,64}$/;
  const MAX_NAMES = 30;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // The config with one camera's row taken out, and that row without its `detections`: what must not change.
  function split(config, mac) {
    const copy = clone(config);
    const entry = copy[0];
    const rows = Array.isArray(entry.cameras) ? entry.cameras : [];
    const matching = rows.filter((row) => row && row.mac === mac);
    if (matching.length > 1) throw new Error("more than one entry for this camera");
    if (Array.isArray(entry.cameras)) entry.cameras = rows.filter((row) => !(row && row.mac === mac));
    const row = matching[0] ? Object.assign({}, matching[0]) : null;
    if (row) for (const key of ["detections", "motionSensor", "soundSensor"]) delete row[key];
    const mine = matching[0] || {};
    return { rest: copy, row, detections: mine.detections, motionSensor: mine.motionSensor, soundSensor: mine.soundSensor };
  }

  /** The reasons a change must not be saved; an empty list means it may be. */
  function problemsWith(before, after, mac, values, modes) {
    const problems = [];
    if (!Array.isArray(before) || before.length === 0 || !before[0] || typeof before[0] !== "object") {
      return ["the plugin has no saved settings yet: save the settings once first"];
    }
    if (!Array.isArray(after) || after.length !== before.length) return ["the changed settings do not have the same shape"];
    if (typeof mac !== "string" || !MAC_PATTERN.test(mac)) problems.push("the camera has no usable id");
    if (values === null) {
      // `detections` is left alone
    } else if (!Array.isArray(values)) {
      problems.push("the list is not a list");
    } else {
      if (values.length > MAX_NAMES) problems.push("more than " + MAX_NAMES + " items");
      const seen = new Set();
      for (const value of values) {
        if (typeof value !== "string" || !NAME_PATTERN.test(value)) problems.push("\"" + String(value).slice(0, 24) + "\" is not a valid item name");
        else if (seen.has(value)) problems.push("\"" + value + "\" is listed twice");
        else seen.add(value);
      }
      if (values.includes("none") && values.length > 1) problems.push("\"none\" cannot be combined with other items");
    }
    for (const key of SENSORS.map((sensor) => sensor.key)) {
      if (modes && modes[key] !== undefined && !MODES.includes(modes[key])) problems.push("\"" + String(modes[key]).slice(0, 24) + "\" is not a valid " + key + " setting");
    }
    if (problems.length > 0) return problems;

    // Nothing but this camera's `detections` may differ.
    const was = split(before, mac);
    const now = split(after, mac);
    if (!sameJson(was.rest, now.rest)) problems.push("the change would alter other settings");
    if (was.row) {
      if (!sameJson(was.row, now.row)) problems.push("the change would alter the camera's other settings");
    } else if (now.row && !sameJson(Object.keys(now.row).sort(), now.row.name ? ["mac", "name"] : ["mac"])) {
      problems.push("the new camera entry would hold more than its id and name");
    }
    if (values === null) {
      if (!sameJson(now.detections, was.detections)) problems.push("the change would alter the list it should leave alone");
    } else if (values.length === 0) {
      if (now.detections !== undefined) problems.push("the list would not go back to automatic");
    } else if (!sameJson(now.detections, values)) {
      problems.push("the saved list would not be the list chosen");
    }
    for (const key of SENSORS.map((sensor) => sensor.key)) {
      const wanted = modes ? modes[key] : undefined;
      if (wanted === undefined) {
        if (!sameJson(now[key], was[key])) problems.push("the change would alter " + key + ", which it should leave alone");
      } else if (wanted === "auto") {
        if (now[key] !== undefined) problems.push(key + " would not go back to automatic");
      } else if (now[key] !== wanted) {
        problems.push("the saved " + key + " would not be the one chosen");
      }
    }
    // What is saved must survive being written out and read back unchanged.
    if (!sameJson(JSON.parse(JSON.stringify(after)), after)) problems.push("the settings cannot be saved as JSON");
    return problems;
  }

  /**
   * The config to save for this camera's choice, or the reasons it must not be saved.
   * @returns {{ok: true, next: Array}|{ok: false, errors: string[]}}
   */
  function prepareSave(config, mac, name, values, modes) {
    try {
      const next = applyDetections(config, mac, name, values, modes);
      const errors = problemsWith(config, next, mac, values, modes);
      return errors.length > 0 ? { ok: false, errors } : { ok: true, next };
    } catch (error) {
      return { ok: false, errors: ["the change could not be checked (" + (error && error.message ? error.message : "unknown problem") + ")"] };
    }
  }

  root.WyzeDetected = { LABELS, SENSORS, settingFor, modeFor, buildView, valuesFor, modesFor, applyDetections, problemsWith, prepareSave };
})(self);
