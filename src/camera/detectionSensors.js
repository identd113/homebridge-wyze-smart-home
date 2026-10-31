"use strict";

const { Service, Characteristic } = require("../types");
const { AiEventTag } = require("wyze-api/src/types");
const { holdMs, remainingMs } = require("./sensorHold");

// The AI labels Wyze puts on events that can get a sensor of their own, by the name used in the config (lower
// case) and for the HomeKit service. `auto` labels are added by themselves when a camera's events carry them;
// the others only when named in the camera's `detections`. Only a label in this table can become a sensor, so
// the number of tiles is bounded by this list and not by whatever Wyze starts sending.
const LABELS = {
  Person: { tag: AiEventTag.PERSON, auto: true },
  Vehicle: { tag: AiEventTag.VEHICLE, auto: true },
  Pet: { tag: AiEventTag.PET, auto: true },
  Package: { tag: AiEventTag.PACKAGE, auto: true },
  // Face is an identity feature (it needs face recognition turned on in the Wyze app), so it is never automatic.
  Face: { tag: AiEventTag.FACE, auto: false },
};
const KINDS = Object.keys(LABELS);
const AUTO_KINDS = KINDS.filter((kind) => LABELS[kind].auto);
const TAG = Object.fromEntries(KINDS.map((kind) => [kind, LABELS[kind].tag]));

const HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The Person, Vehicle, Pet and Package sensors of one camera: HomeKit motion sensors named for the label,
 * driven by the AI labels (`tags`) on the events in Wyze's cloud event list, the same list the Motion and
 * Sound sensors read.
 *
 * The camera's `detections` setting chooses them: empty (the default) is automatic, which adds a sensor for
 * each automatic label the camera's last week of events carries; a list such as ["person", "pet", "face"] adds
 * exactly those, whether seen or not; ["none"] adds none. A sensor reacts only to a labelled event under 30 seconds old, and a label that Wyze
 * adds to an event a few seconds after it appeared counts as new.
 */
class DetectionSensors {
  constructor(camera) {
    this.camera = camera;
    this.seen = {}; // automatic: kinds this camera's events were found to carry
    this.sensors = {}; // kind -> { service, active, timer, ids }
    this.scanned = false; // discover() has had its answer from Wyze
    this.report = null; // what it found: { found, unnamed }
  }

  // "none", "auto", or the list of kinds chosen.
  mode() {
    const row = (this.camera.plugin.config.cameras || []).find((cam) => cam.mac === this.camera.mac);
    const chosen = (Array.isArray(row?.detections) ? row.detections : []).map((name) => String(name).toLowerCase());
    if (chosen.includes("none")) return "none";
    if (chosen.length === 0) return "auto";
    // A list is exact. Names this plugin does not know (saved by the settings page for something newer, or
    // by hand) get no sensor, and a list of only those is no sensors, not automatic.
    const kinds = KINDS.filter((kind) => chosen.includes(kind.toLowerCase()));
    return kinds.length > 0 ? kinds : "none";
  }

  wanted(kind) {
    const mode = this.mode();
    if (mode === "none") return false;
    if (mode === "auto") return LABELS[kind].auto && Boolean(this.seen[kind]);
    return mode.includes(kind);
  }

  any() {
    return Object.keys(this.sensors).length > 0;
  }

  setupWanted() {
    for (const kind of KINDS) if (this.wanted(kind)) this.setup(kind);
  }

  setup(kind) {
    if (this.sensors[kind]) return;
    const service = this.camera._getOrAddService({
      ServiceType: Service.MotionSensor,
      subtype: kind,
      defaultName: kind,
      label: kind,
    });
    const sensor = { service, active: false, timer: null, ids: null };
    service.getCharacteristic(Characteristic.MotionDetected).onGet(() => sensor.active === true);
    this.sensors[kind] = sensor;
  }

  // `holdLeft` is how long to stay on from now: the hold counted from the event's own time (see sensorHold.js).
  set(kind, active, holdLeft = holdMs(this.camera.plugin.config)) {
    const sensor = this.sensors[kind];
    if (!sensor) return;
    if (active) {
      if (holdLeft <= 0) return; // the hold has already passed
      const until = Date.now() + holdLeft;
      if (sensor.active && sensor.until > until) return; // already on for longer
      sensor.until = until;
      clearTimeout(sensor.timer);
      sensor.timer = setTimeout(() => this.set(kind, false), holdLeft);
      sensor.timer.unref?.();
    } else {
      clearTimeout(sensor.timer);
      sensor.timer = null;
      sensor.until = 0;
    }
    if (sensor.active === active) return;
    sensor.active = active;
    sensor.service.getCharacteristic(Characteristic.MotionDetected).updateValue(active);
    if (active) this.camera.plugin.log.debug?.(`[Camera] ${this.camera.display_name}: ${kind.toLowerCase()}`);
  }

  // A labelled event that was not in the list last time, and is under 30 seconds old, turns the sensor on.
  // The first poll only records what is already there. An event is tracked by id for each label it carries,
  // so a label added to an event that was already listed is new for that label.
  check(events) {
    for (const [kind, sensor] of Object.entries(this.sensors)) {
      const labelled = events.filter((event) => Array.isArray(event.tags) && event.tags.includes(TAG[kind]));
      const previous = sensor.ids;
      sensor.ids = new Set(labelled.map((event) => event.id));
      if (previous === null) continue;
      const recent = labelled.filter((event) => !previous.has(event.id) && this.camera._isRecent(event));
      if (recent.length > 0) this.set(kind, true, remainingMs(this.camera.plugin.config, recent));
    }
  }

  // Offline: forget what has been seen, so nothing from the gap switches a sensor on late.
  reset() {
    for (const sensor of Object.values(this.sensors)) sensor.ids = null;
  }

  stop() {
    for (const sensor of Object.values(this.sensors)) {
      clearTimeout(sensor.timer);
      sensor.timer = null;
    }
  }

  // Find out which labels this camera's events carry. In automatic mode a sensor is added for each automatic
  // label found. In every mode the result is returned, so it can be logged and offered in the settings page: a
  // label that turns up on a camera whose list was chosen earlier is exactly what the owner wants to hear about.
  // A camera whose newest events carry no label at all has no AI detection, so nothing more is asked. Otherwise
  // each label not already in those events is asked for on its own: a rare one, like a package, would not show in
  // the 20 newest events of a busy camera. Returns { found, unnamed } once Wyze has answered.
  async discover() {
    const { client } = this.camera.plugin;
    const mac = this.camera.mac;
    const ask = (kind) => client.cameraGetEvents(mac, { sinceMs: HISTORY_MS, count: 20, tags: [kind.toUpperCase()] });
    const tagsOf = (events) => events.flatMap((event) => (Array.isArray(event.tags) ? event.tags : []));

    const recent = await client.cameraGetEvents(mac, { sinceMs: HISTORY_MS, count: 20 });
    const inRecent = new Set(tagsOf(recent));
    const found = [];
    if (inRecent.size > 0) {
      for (const kind of KINDS) {
        if (inRecent.has(TAG[kind]) || tagsOf(await ask(kind)).includes(TAG[kind])) found.push(kind);
      }
    }
    // Labels in the newest events that this plugin has no name for.
    const named = new Set(Object.values(TAG));
    const unnamed = [...inRecent].filter((tag) => !named.has(tag));

    const automatic = this.mode() === "auto";
    for (const kind of found) {
      if (!automatic || !LABELS[kind].auto || this.seen[kind]) continue;
      this.seen[kind] = true;
      this.setup(kind);
    }
    this.scanned = true;
    this.report = { found, unnamed };

    const shown = found.filter((kind) => LABELS[kind].auto || this.wanted(kind));
    const available = found.filter((kind) => !LABELS[kind].auto && !this.wanted(kind));
    if (found.length + unnamed.length > 0) {
      const parts = [];
      if (shown.length) parts.push(`events carry the AI labels ${shown.join(", ")}`);
      if (available.length) parts.push(`${available.join(", ")} events exist too: add "${available.map((k) => k.toLowerCase()).join('", "')}" to this camera's detections for ${available.length > 1 ? "sensors" : "a sensor"}`);
      if (unnamed.length) parts.push(`labels with no name here: ${unnamed.join(", ")}`);
      this.camera.plugin.log(`[Camera] ${this.camera.display_name}: ${parts.join("; ")}`);
    }
    return this.report;
  }
}

DetectionSensors.KINDS = KINDS;
DetectionSensors.AUTO_KINDS = AUTO_KINDS;

module.exports = DetectionSensors;
