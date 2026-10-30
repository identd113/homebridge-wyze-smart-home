"use strict";

const { Service, Characteristic } = require("../types");
const { AiEventTag } = require("wyze-api/src/types");

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

const HOLD_MS = 30_000; // how long a sensor stays on after the last new labelled event, as Motion and Sound
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
    this.tries = 0;
    this.busy = false;
  }

  // "none", "auto", or the list of kinds chosen.
  mode() {
    const row = (this.camera.plugin.config.cameras || []).find((cam) => cam.mac === this.camera.mac);
    const chosen = (Array.isArray(row?.detections) ? row.detections : []).map((name) => String(name).toLowerCase());
    if (chosen.includes("none")) return "none";
    const kinds = KINDS.filter((kind) => chosen.includes(kind.toLowerCase()));
    return kinds.length > 0 ? kinds : "auto";
  }

  wanted(kind) {
    const mode = this.mode();
    if (mode === "none") return false;
    if (mode === "auto") return LABELS[kind].auto && Boolean(this.seen[kind]);
    return mode.includes(kind);
  }

  // Kinds still to be found out about: automatic mode, an automatic label, and not yet seen.
  pending() {
    return this.mode() === "auto" ? AUTO_KINDS.filter((kind) => !this.seen[kind]) : [];
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

  set(kind, active) {
    const sensor = this.sensors[kind];
    if (!sensor) return;
    clearTimeout(sensor.timer);
    sensor.timer = null;
    if (active) {
      sensor.timer = setTimeout(() => this.set(kind, false), HOLD_MS);
      sensor.timer.unref?.();
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
      if (labelled.some((event) => !previous.has(event.id) && this.camera._isRecent(event))) this.set(kind, true);
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

  // Find out which labels this camera's events carry, and add a sensor for each automatic one. A camera whose
  // newest events carry no label at all has no AI detection, so nothing more is asked. Otherwise each label is
  // asked for on its own: a rare one, like a package, would not show in the 20 newest events of a busy camera.
  // Labels that are not automatic (Face) are asked about too, only so the log can say they exist and how to
  // get a sensor for them. Returns true when it got an answer from Wyze (so it need not be asked again).
  async discover() {
    const pending = this.pending();
    if (pending.length === 0) return true;
    const { client } = this.camera.plugin;
    const mac = this.camera.mac;
    const ask = (kind) => client.cameraGetEvents(mac, { sinceMs: HISTORY_MS, count: 20, tags: [kind.toUpperCase()] });
    const carries = (events, kind) => events.some((event) => Array.isArray(event.tags) && event.tags.includes(TAG[kind]));

    const recent = await client.cameraGetEvents(mac, { sinceMs: HISTORY_MS, count: 20 });
    if (!recent.some((event) => Array.isArray(event.tags) && event.tags.length > 0)) return true;

    const found = [];
    for (const kind of pending) {
      if (!carries(await ask(kind), kind)) continue;
      found.push(kind);
      this.seen[kind] = true;
      this.setup(kind);
    }
    const optIn = [];
    for (const kind of KINDS.filter((k) => !LABELS[k].auto && !this.wanted(k))) {
      if (carries(await ask(kind), kind)) optIn.push(kind);
    }
    // Labels in the newest events that this plugin has no name for.
    const named = new Set(Object.values(TAG));
    const unnamed = [...new Set(recent.flatMap((event) => (Array.isArray(event.tags) ? event.tags : [])))].filter((tag) => !named.has(tag));

    if (found.length + optIn.length + unnamed.length > 0) {
      const parts = [`events carry the AI labels ${found.length ? found.join(", ") : "(none that get a sensor by themselves)"}`];
      if (optIn.length) parts.push(`${optIn.join(", ")} events exist too: add "${optIn.map((k) => k.toLowerCase()).join('", "')}" to this camera's detections for ${optIn.length > 1 ? "sensors" : "a sensor"}`);
      if (unnamed.length) parts.push(`labels with no name here: ${unnamed.join(", ")}`);
      this.camera.plugin.log(`[Camera] ${this.camera.display_name}: ${parts.join("; ")}`);
    }
    return true;
  }
}

DetectionSensors.KINDS = KINDS;
DetectionSensors.AUTO_KINDS = AUTO_KINDS;

module.exports = DetectionSensors;
