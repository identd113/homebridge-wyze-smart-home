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

  // This camera's `detections` setting: "auto" (not set, or empty), "none", or the list chosen.
  function settingFor(entry, mac) {
    const row = ((entry && entry.cameras) || []).find((cam) => cam && cam.mac === mac);
    const list = (row && Array.isArray(row.detections) ? row.detections : []).map((name) => String(name).toLowerCase());
    if (list.includes("none")) return "none";
    const chosen = LABELS.map((l) => l.value).filter((value) => list.includes(value));
    return chosen.length > 0 ? chosen : "auto";
  }

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
      }));
      return {
        mac,
        name: cam.name || mac,
        model: cam.model || "",
        setting,
        items,
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

  // The plugin config (an array, as the settings page hands it over) with this camera's `detections` set. With no
  // values the key is removed, which is automatic. A camera not in the config yet gets an entry. Returns a copy.
  function applyDetections(config, mac, name, values) {
    const next = JSON.parse(JSON.stringify(config || []));
    const entry = next[0];
    if (!entry) return next;
    if (!Array.isArray(entry.cameras)) entry.cameras = [];
    let row = entry.cameras.find((cam) => cam && cam.mac === mac);
    if (!row) {
      if (values.length === 0) return next; // automatic is what a camera with no entry already is
      row = { mac };
      if (name) row.name = name;
      entry.cameras.push(row);
    }
    if (values.length === 0) delete row.detections;
    else row.detections = [...values];
    return next;
  }

  root.WyzeDetected = { LABELS, settingFor, buildView, valuesFor, applyDetections };
})(self);
