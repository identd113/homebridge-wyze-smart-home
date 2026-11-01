const { Service, Characteristic } = require("../types");
const WyzeAccessory = require("./WyzeAccessory");
const enums = require("../enums");
const WyzeCameraStreamingDelegate = require("../camera/WyzeCameraStreamingDelegate");
const RefreshScheduler = require("../camera/refreshScheduler");
const DetectionSensors = require("../camera/detectionSensors");
const detectedSensors = require("../detectedSensors");
const MotionPoller = require("../camera/motionPoller");
const camPlan = require("../camera/plan");
const { holdMs, remainingMs } = require("../camera/sensorHold");
const { isBatteryCamera } = require("../camera/batteryModels");
const { markServiceOnline } = require("./offlineIndicator");

// The properties _refresh switches on. A property that is not named in the platform's bulk
// property request never comes back, so tests/propertyPoller.test.js keeps this in step with that switch.
const CAMERA_PIDS = ["P1", "P3", "P5", "P1001", "P1029", "P1049", "P1056", "P1301"];

// Sizes advertised to HomeKit. The video is passed through unscaled, so these
// must match what the camera really sends or the Home app letterboxes it.
const DEFAULT_STREAM_RESOLUTIONS = [
  [1920, 1080, 30],
  [1280, 720, 30],
  [1280, 720, 15],
  [640, 360, 30],
  [640, 360, 15],
  [320, 240, 15],
];
// Cameras whose WebRTC stream isn't 16:9 (read from the stream's SPS).
const NATIVE_STREAM_RESOLUTIONS = {
  [enums.CameraModels.WyzeCamDoorbellV2]: [[640, 480, 15]],
};

// Doorbell press: it only exists in Wyze's cloud event list, where a press starts
// as a motion event and is flipped to "Doorbell rang" a few seconds later. Poll
// often enough that the Home app rings promptly; each press rings once.
const DOORBELL_POLL_MS = 5000;
// Cameras without a doorbell button are checked for motion this often.
const MOTION_POLL_MS = 10_000;
// How often each camera's picture is refreshed by default; `snapshotRefreshSeconds` overrides it (0 = off).
const SNAPSHOT_REFRESH_DEFAULT_S = 30;
const SNAPSHOT_REFRESH_MIN_S = 10;
// Floodlight accessories (device parameter `dongle_product_model`) that get a light switch on
// their own. HL_CFL is the Cam v3 floodlight, seen on a real Cam v3.
const FLOODLIGHT_DONGLE_MODELS = new Set(["HL_CFL"]);
// A sensor only reacts to an event younger than this.
const SENSOR_EVENT_MAX_AGE_MS = 30_000;
// How far back Wyze's event list is read to find out whether a camera has events of a kind at all.
const SENSOR_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;
// Discovery is repeated, so a camera with no events when Homebridge started still gets its sensors later. Often while
// a Motion or Sound sensor is still missing, rarely once they all exist (only new AI labels are left to find).
const REDISCOVER_PENDING_MS = 30 * 60 * 1000;
const REDISCOVER_SETTLED_MS = 6 * 60 * 60 * 1000;
const REDISCOVER_RETRY_MS = 5 * 60 * 1000;
// Wyze sends on/off properties as strings ("1" on, "2" or "0" off), and any non-empty string is truthy.
const isOn = (v) => v === 1 || v === "1" || v === true;
// A power value as 1 or 0 (Wyze sends "1" and "0" in a property list, a number in the device list), or undefined.
const powerFlag = (v) => (v === 1 || v === "1" || v === true ? 1 : v === 0 || v === "0" || v === false ? 0 : undefined);
// The Privacy switch is on when the camera is off. A power state not known yet is not "off".
const privacyOf = (power) => (power === undefined || power === null || isOn(power) ? 0 : 1);

module.exports = class WyzeCamera extends WyzeAccessory {

  constructor(plugin, homeKitAccessory) {
    super(plugin, homeKitAccessory);

    // CameraController is deferred to first updateCharacteristics so it runs
    // after homebridge publishes the bridge (not during configureAccessory).
    this._cameraControllerReady = false;
    this.cameraOnline = false;

    // Restore last-known characteristic values from disk so HomeKit shows
    // the right state immediately on reboot instead of "undefined" until
    // the first refresh cycle runs.
    const persisted = this.loadPersistedState();
    this.on = persisted.on;                       // privacy (PID-driven)
    this.power_switch = persisted.power_switch;   // privacy (bulk-list)
    this.notification = persisted.notification;
    this.siren = persisted.siren;
    this.floodLight = persisted.floodLight;       // shared with spotlight (P1056)
    this.garageDoor = persisted.garageDoor;
    this.motionDetection = persisted.motionDetection;

    // A Motion Sensor service left over from earlier plugin versions is removed unless the
    // Motion Sensor option is on for this camera, and the Sound Sensor likewise (both are
    // driven by the event poller below).
    this._removeSensorsNotWanted();

    if (!Object.values(enums.CameraModels).includes(this.product_model)) return;

    this._setupPrivacySwitch();

    // These two follow the cloud event list, not the camera's properties, so they do not
    // depend on any of the switches below being on.
    if (this._sensorWanted("Motion")) this._setupMotionSensor();
    if (this._sensorWanted("Sound")) this._setupSoundSensor();
    this.detections.setupWanted();

    if (!this.cameraAccessoryAttached()) return;

    // Optional services driven by per-MAC config arrays.
    if (this._isInConfig("garageDoorAccessory")) {
      this.garageDoorEnabled = true;
      this.garageDoorService = this._getOrAddService({
        ServiceType: Service.GarageDoorOpener,
        subtype: "GarageDoor",
        defaultName: "Garage Door",
        label: "Garage Door",
      });
      this.garageDoorService
        .getCharacteristic(Characteristic.CurrentDoorState)
        .onGet(this.getGarageCurrentState.bind(this));
      this.garageDoorService
        .getCharacteristic(Characteristic.TargetDoorState)
        .onGet(this.getGarageTargetState.bind(this))
        .onSet(this.setGarageTargetState.bind(this));
      this.garageDoorService
        .getCharacteristic(Characteristic.ObstructionDetected)
        .onGet(this.handleObstructionDetectedGet.bind(this));
    }

    if (this._isInConfig("spotLightAccessory")) {
      this.spotLightEnabled = true;
      this.spotLightService = this._getOrAddService({
        ServiceType: Service.Lightbulb,
        subtype: "Spotlight",
        defaultName: "Spotlight",
        label: "Spotlight",
      });
      this.spotLightService
        .getCharacteristic(Characteristic.On)
        .onGet(this.handleOnGetSpotlight.bind(this))
        .onSet(this.handleOnSetSpotlight.bind(this));
    }

    if (this._isInConfig("floodLightAccessory") || this._hasFloodlightDongle()) {
      this._setupFloodlight();
    }

    if (this._isInConfig("sirenAccessory")) {
      this.sirenEnabled = true;
      this.sirenSwitch = this._getOrAddService({
        ServiceType: Service.Switch,
        subtype: "Siren",
        defaultName: "Siren",
        legacyLookup: () => this.homeKitAccessory.getService(`${this.display_name} Siren`),
        label: "Siren",
      });
      this.sirenSwitch
        .getCharacteristic(Characteristic.On)
        .onGet(this.handleOnGetAlarmSwitch.bind(this))
        .onSet(this.handleOnSetAlarmSwitch.bind(this));
    }

    if (this._isInConfig("notificationAccessory")) {
      this.notificationSwitch = this._getOrAddService({
        ServiceType: Service.Switch,
        subtype: "Notification",
        defaultName: "Notifications",
        legacyLookup: () =>
          this.homeKitAccessory.getService(`${this.display_name} Notification`),
        label: "Notifications",
      });
      this.notificationSwitch
        .getCharacteristic(Characteristic.On)
        .onGet(this.getNotification.bind(this))
        .onSet(this.setNotification.bind(this));
    }

    // Motion-detection master switch: toggles whether the camera even
    // looks for motion. Different from the Notifications switch above —
    // notifications gates the alerts you get; motion detection gates
    // whether the camera processes motion at all (so e.g. recording
    // triggers stop too). Useful for users who want the camera always
    // powered on but want to pause motion-driven automation via
    // HomeKit. Resolves #231.
    if (this._isInConfig("motionDetectionAccessory")) {
      this.motionDetectionSwitch = this._getOrAddService({
        ServiceType: Service.Switch,
        subtype: "MotionDetection",
        defaultName: "Motion Detection",
        legacyLookup: () =>
          this.homeKitAccessory.getService(`${this.display_name} Motion Detection`),
        label: "Motion Detection",
      });
      this.motionDetectionSwitch
        .getCharacteristic(Characteristic.On)
        .onGet(this.getMotionDetection.bind(this))
        .onSet(this.setMotionDetection.bind(this));
    }
  }

  /**
   * Cameras are published as external accessories, so they are not part of
   * Homebridge's platform accessory cache. Calling updatePlatformAccessories()
   * on one does not throw on Homebridge 2.x - it makes Homebridge fail to
   * serialize the whole cache ("missing associated platform"), so no accessory
   * after the first camera persists (#311). Keep the state in memory only.
   */
  persistState(state) {
    this.homeKitAccessory.context.lastState = {
      ...(this.homeKitAccessory.context.lastState || {}),
      ...state,
    };
  }

  // ---- Helpers --------------------------------------------------------------

  _isInConfig(key) {
    return Boolean(this.plugin.config[key]?.includes(this.mac));
  }

  // The spotlight and floodlight switches are one light (property P1056), so either
  // setting needs the camera's light state.
  _lightConfigured() {
    return (
      this._isInConfig("spotLightAccessory") ||
      this._isInConfig("floodLightAccessory") ||
      this._hasFloodlightDongle()
    );
  }

  // A camera with a floodlight accessory plugged in gets its light as a switch without
  // being listed in the config. Wyze reports the accessory as a device parameter; the
  // result is remembered so the switch is set up again from the cache on a restart.
  _hasFloodlightDongle() {
    return Boolean(this.homeKitAccessory.context.floodlightDongle);
  }

  _detectFloodlightDongle(device) {
    if (this._hasFloodlightDongle()) return;
    if (!FLOODLIGHT_DONGLE_MODELS.has(device?.device_params?.dongle_product_model)) return;
    this.homeKitAccessory.context.floodlightDongle = true;
    this._setupFloodlight();
  }

  _setupFloodlight() {
    this.floodLightEnabled = true;
    this.floodLightService = this._getOrAddService({
      ServiceType: Service.Lightbulb,
      subtype: "FloodLight",
      defaultName: "Floodlight",
      label: "Floodlight",
    });
    this.floodLightService
      .getCharacteristic(Characteristic.On)
      .onGet(this.handleOnGetFloodlight.bind(this))
      .onSet(this.handleOnSetFloodlight.bind(this));
  }

  _setLightState(value) {
    this.floodLight = value;
    this.spotLightService?.getCharacteristic(Characteristic.On).updateValue(this.floodLight);
    this.floodLightService?.getCharacteristic(Characteristic.On).updateValue(this.floodLight);
  }

  // A HomeKit Motion Sensor fed by the shared event poller: it turns on when a new event
  // appears in Wyze's cloud list and off again after the sensor hold time (camera/sensorHold.js) without another.
  _setupMotionSensor() {
    this.motionSensorEnabled = true;
    this._motionActive = false;
    this.motionSensorService = this._getOrAddService({
      ServiceType: Service.MotionSensor,
      subtype: "Motion",
      defaultName: "Motion",
      label: "Motion",
    });
    this.motionSensorService
      .getCharacteristic(Characteristic.MotionDetected)
      .onGet(() => this._motionActive === true);
  }

  // `holdLeft` is how long to stay on from now: the hold counted from the event's own time (see sensorHold.js).
  _setMotionActive(active, holdLeft = holdMs(this.plugin.config)) {
    if (!this.motionSensorEnabled) return;
    if (active) {
      if (holdLeft <= 0) return; // the hold has already passed
      const until = Date.now() + holdLeft;
      if (this._motionActive && this._motionUntil > until) return; // already on for longer
      this._motionUntil = until;
      clearTimeout(this._motionTimer);
      this._motionTimer = setTimeout(() => this._setMotionActive(false), holdLeft);
      this._motionTimer.unref?.();
    } else {
      clearTimeout(this._motionTimer);
      this._motionTimer = null;
      this._motionUntil = 0;
    }
    if (this._motionActive === active) return;
    this._motionActive = active;
    this.motionSensorService.getCharacteristic(Characteristic.MotionDetected).updateValue(active);
    if (active) this.plugin.log.debug?.(`[Camera] ${this.display_name}: motion`);
  }

  // The Person, Vehicle, Pet and Package sensors (see camera/detectionSensors.js).
  get detections() {
    if (!this._detections) this._detections = new DetectionSensors(this);
    return this._detections;
  }

  // "on", "off" or "auto" (the default) for the Motion or Sound sensor of this camera. An automatic
  // sensor is added once the camera's event list shows events of its kind (_discoverSensors).
  _sensorMode(kind) {
    if (this._isInConfig(`${kind.toLowerCase()}SensorAccessory`)) return "on";
    if (this._isInConfig(`${kind.toLowerCase()}SensorOff`)) return "off";
    return "auto";
  }

  _sensorWanted(kind) {
    const mode = this._sensorMode(kind);
    return mode === "on" || (mode === "auto" && Boolean(this._sensorsSeen?.[kind]));
  }

  // Add each automatic sensor this camera has events for. Wyze's event list is read a week back: a camera with no
  // Wyze plan, or one that never hears a sound, would otherwise get a sensor that never fires. Sound asks Wyze for
  // sound events alone, so a week of motion cannot crowd them out of the 20 events one request returns, and Motion
  // asks for motion-like events only, so a week of sounds cannot crowd those out. It is repeated (see REDISCOVER_*),
  // so a camera that had no events at start gets its sensors when they appear, and a new AI label is found later.
  async _discoverSensors() {
    if (this._discovering || Date.now() < (this._discoverNextAt || 0)) return;
    if (!Object.values(enums.CameraModels).includes(this.product_model)) return;
    if (typeof this.plugin.client?.cameraGetEvents !== "function") return;
    this._discovering = true;
    const first = !this._discoveredOnce;
    try {
      const pending = ["Motion", "Sound"].filter((kind) => this._sensorMode(kind) === "auto" && !this._sensorWanted(kind));
      for (const kind of pending) {
        const events = await this.plugin.client.cameraGetEvents(this.mac, {
          sinceMs: SENSOR_HISTORY_MS,
          count: 20,
          types: kind === "Sound" ? ["SOUND"] : ["MOTION", "DOORBELL_RANG"],
        });
        // Motion is any event that is not a sound (a press, a person, ...), as _checkMotion treats it.
        if (!events.some((event) => (kind === "Sound") === (event.type === "SOUND"))) continue;
        this._sensorsSeen = { ...this._sensorsSeen, [kind]: true };
        if (kind === "Motion") this._setupMotionSensor();
        else this._setupSoundSensor();
        if (this.plugin.config.pluginLoggingEnabled)
          this.plugin.log(`[Camera] ${this.display_name}: added a ${kind} sensor, its event list shows ${kind.toLowerCase()} events`);
      }
      const factsRead = first ? await this._readStartupFacts() : true;
      this._recordDetected(await this.detections.discover());
      this._discoveredOnce = factsRead; // the plan lookup failed: the start-up facts are read again next time
      const stillPending = ["Motion", "Sound"].some((kind) => this._sensorMode(kind) === "auto" && !this._sensorWanted(kind));
      this._discoverNextAt = Date.now() + (!factsRead ? REDISCOVER_RETRY_MS : stillPending ? REDISCOVER_PENDING_MS : REDISCOVER_SETTLED_MS);
      this._startEventWatch(this._watchRing); // pick up a sensor added after the watch began
    } catch (err) {
      this._discoverNextAt = Date.now() + REDISCOVER_RETRY_MS;
      this.plugin.log.debug?.(`[Camera] ${this.display_name}: sensor discovery failed (${err.message}); will try again`);
    } finally {
      this._discovering = false;
    }
  }

  // Read once per start: whether sound recording is on, and the camera's Cam Plus plan (logged, and noted for the
  // settings page). Kept out of the repeated discovery so they are not logged again every time. Returns false when
  // the plan lookup failed, so the caller reads them again later.
  async _readStartupFacts() {
    this._soundRecording = await this._readSoundRecording();
    const plans = await camPlan.plansOnce(this.plugin);
    this._plan = camPlan.summarize(plans, this.mac);
    const planWarning = camPlan.warning(this._plan);
    if (planWarning) this.plugin.log.info?.(`[Camera] ${this.display_name}: ${planWarning}`);
    else if (this._plan?.state === "active") this.plugin.log(`[Camera] ${this.display_name}: Cam Plus ${this._plan.name}${this._plan.expires ? `, until ${new Date(this._plan.expires).toISOString().slice(0, 10)}` : ""}`);
    const storagePath = this.plugin.api?.user?.storagePath?.();
    const forNote = camPlan.forNote(plans);
    if (storagePath && forNote) detectedSensors.recordPlans(storagePath, forNote);
    return plans !== null;
  }

  // Whether Wyze is set to record sound events on this camera (property P1048). With it off, no sound event is ever
  // listed, so a Sound sensor could not fire: the settings page warns about that. null when the camera does not say
  // (newer cameras have no property IDs) or the read fails. Read once per start.
  async _readSoundRecording() {
    try {
      if (this.plugin.client.cameraUsesDeviceMgmt(this.product_model)) return null;
      const rows = (await this.plugin.client.getDevicePID(this.mac, this.product_model))?.data?.property_list;
      const row = Array.isArray(rows) ? rows.find((property) => property.pid === "P1048") : undefined;
      return row ? String(row.value) === "1" : null;
    } catch (_) {
      return null;
    }
  }

  // Leave a note of what this camera was found to have, for the plugin's settings page (see detectedSensors.js).
  _recordDetected(report) {
    const storagePath = this.plugin.api?.user?.storagePath?.();
    if (!storagePath || !report) return;
    detectedSensors.record(storagePath, {
      mac: this.mac,
      name: this.display_name,
      model: this.product_model,
      motion: this._sensorWanted("Motion"),
      sound: this._sensorWanted("Sound"),
      soundRecording: this._soundRecording ?? null,
      plan: this._plan ?? null,
      labels: report.found.map((kind) => kind.toLowerCase()),
      unnamed: report.unnamed,
    });
  }

  // A sensor reacts only to an event this young. Wyze lists events late, and a camera without a plan
  // records about one every 5 minutes, so an older event is history and must not switch the sensor
  // on each time the list is read. The age is by Wyze's clock when wyze-api provides it.
  _isRecent(event) {
    const age = typeof event.ageMs === "number" ? event.ageMs : Date.now() - event.time;
    return Number.isNaN(age) || age <= SENSOR_EVENT_MAX_AGE_MS; // no usable time: judge by novelty alone
  }

  // Remove a Motion Sensor or Sound Sensor service whose option is off for this camera. A
  // Motion Sensor with no subtype is from earlier plugin versions and goes with the Motion option.
  _removeSensorsNotWanted() {
    const wanted = {
      Motion: this._sensorWanted("Motion"),
      Sound: this._sensorWanted("Sound"),
      ...Object.fromEntries(DetectionSensors.KINDS.map((kind) => [kind, this.detections.wanted(kind)])),
    };
    for (const service of [...(this.homeKitAccessory.services || [])]) {
      if (service.UUID !== Service.MotionSensor.UUID) continue;
      const kind = service.subtype || "Motion";
      if (kind in wanted && !wanted[kind]) this.homeKitAccessory.removeService(service);
    }
  }

  // A second HomeKit Motion Sensor, named Sound, that turns on when a new sound event appears
  // in Wyze's cloud event list and off again after the sensor hold time (camera/sensorHold.js) without another.
  // HomeKit has no sound sensor, so a motion sensor is the usual stand-in.
  _setupSoundSensor() {
    this.soundSensorEnabled = true;
    this._soundActive = false;
    this.soundSensorService = this._getOrAddService({
      ServiceType: Service.MotionSensor,
      subtype: "Sound",
      defaultName: "Sound",
      label: "Sound",
    });
    this.soundSensorService
      .getCharacteristic(Characteristic.MotionDetected)
      .onGet(() => this._soundActive === true);
  }

  _setSoundActive(active, holdLeft = holdMs(this.plugin.config)) {
    if (!this.soundSensorEnabled) return;
    if (active) {
      if (holdLeft <= 0) return;
      const until = Date.now() + holdLeft;
      if (this._soundActive && this._soundUntil > until) return;
      this._soundUntil = until;
      clearTimeout(this._soundTimer);
      this._soundTimer = setTimeout(() => this._setSoundActive(false), holdLeft);
      this._soundTimer.unref?.();
    } else {
      clearTimeout(this._soundTimer);
      this._soundTimer = null;
      this._soundUntil = 0;
    }
    if (this._soundActive === active) return;
    this._soundActive = active;
    this.soundSensorService.getCharacteristic(Characteristic.MotionDetected).updateValue(active);
    if (active) this.plugin.log.debug?.(`[Camera] ${this.display_name}: sound`);
  }

  _getOrAddService({ ServiceType, subtype, defaultName, legacyLookup, label }) {
    // Prefer subtype-based lookup (stable across renames). Fall back to a
    // legacy name-based lookup so cameras paired before the naming change
    // don't accidentally grow a duplicate service.
    let service = this.homeKitAccessory.getServiceById(ServiceType, subtype);
    if (!service && legacyLookup) service = legacyLookup();
    if (!service) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Camera] [${label}] Adding service for ${this.mac} (${this.display_name})`
        );
      service = this.homeKitAccessory.addService(ServiceType, defaultName, subtype);
      // Set ConfiguredName once at creation so the Home app shows a clear
      // default label. Don't overwrite on subsequent loads — that would
      // wipe out any rename the user has done themselves.
      if (Characteristic.ConfiguredName) {
        service.setCharacteristic(Characteristic.ConfiguredName, defaultName);
      }
    }
    return service;
  }

  // ---- Doorbell press -------------------------------------------------------

  // Every camera joins one shared check of the cloud event list: a single request covers
  // all of them. A doorbell reads it for presses, and any camera reads it for new motion,
  // which takes a fresh picture. With a doorbell present the whole list is read at the
  // doorbell's faster rate, which costs no extra requests.
  _startEventWatch(isDoorbell) {
    this._watchRing = !!isDoorbell;
    this._watchMotion = this.plugin.config.snapshotOnMotion !== false || !!this.motionSensorEnabled;
    this._watchSound = !!this.soundSensorEnabled;
    this._watchDetect = this.detections.any();
    if (!this._watchRing && !this._watchMotion && !this._watchSound && !this._watchDetect) return;
    if (this._motionMember) return;
    this._ringedIds = null; // seeded by the first successful poll
    this._motionIds = null; // likewise
    this._soundIds = null; // likewise
    if (!this.plugin._motionPoller) this.plugin._motionPoller = new MotionPoller(this.plugin.client, { log: this.plugin.log });
    this._motionMember = {
      mac: this.mac,
      everyMs: this._watchRing ? DOORBELL_POLL_MS : MOTION_POLL_MS,
      online: () => this.cameraOnline !== false,
      onEvents: (events) => this._onEvents(events),
      // Offline: forget what has been seen, so nothing from the gap rings or refreshes late.
      reset: () => { this._ringedIds = null; this._motionIds = null; this._soundIds = null; this.detections.reset(); },
    };
    this.plugin._motionPoller.add(this._motionMember);
  }

  _onEvents(events) {
    if (this._watchRing) this._checkRings(events);
    if (this._watchMotion) this._checkMotion(events);
    if (this._watchSound) this._checkSound(events);
    if (this._watchDetect) this.detections.check(events);
  }

  // Keep the Home app's picture current: one new capture every `snapshotRefreshSeconds`
  // (default 30, 0 turns it off). Each capture opens a short WebRTC session, so the
  // delegate skips a camera that is streaming, offline or off.
  _startSnapshotRefresh() {
    if (this._refreshMember) return;
    const configured = this.plugin.config.snapshotRefreshSeconds;
    const unset = configured === undefined || configured === null || configured === "";
    // A battery camera is woken by every refresh: unless it was asked for, leave it out.
    if (unset && isBatteryCamera(this.product_model)) {
      this.plugin.log.debug?.(`[Camera] ${this.display_name}: battery camera, so its picture is not refreshed on a timer (only at startup and on motion)`);
      return;
    }
    const seconds = unset ? SNAPSHOT_REFRESH_DEFAULT_S : Number(configured);
    if (!(seconds > 0) || !this._streamingDelegate) return;
    const ms = Math.max(seconds, SNAPSHOT_REFRESH_MIN_S) * 1000;
    // One scheduler for the whole platform takes the cameras in turn, evenly spaced,
    // so they never refresh at the same moment.
    if (!this.plugin._refreshScheduler) this.plugin._refreshScheduler = new RefreshScheduler(ms, { log: this.plugin.log });
    this._refreshMember = this._streamingDelegate;
    this.plugin._refreshScheduler.add(this._refreshMember);
  }

  _checkRings(events) {
    // Events change after they appear (a press starts as motion), so judge each
    // by its current type.
    const rings = events.filter((event) => event.type === "DOORBELL_RANG");
    if (this._ringedIds === null || this._ringedIds === undefined) {
      // Presses already in the list when we start are history. Going by event id,
      // not by comparing Wyze's timestamps with this host's clock, keeps this
      // right when the host clock is off.
      this._ringedIds = new Set(rings.map((event) => event.id));
    } else {
      for (const event of rings) {
        if (this._ringedIds.has(event.id)) continue;
        this._ringedIds.add(event.id);
        this._cameraController?.ringDoorbell();
        this.plugin.log(`[Camera] ${this.display_name}: doorbell pressed`);
      }
    }
    // An event that has left the look-back window can't come back: forget it.
    const current = new Set(events.map((event) => event.id));
    for (const id of this._ringedIds) if (!current.has(id)) this._ringedIds.delete(id);
  }

  // A new event in the cloud list (motion, a press, ...) means something just happened in
  // front of the camera: take a new picture. The first poll only records what is already there.
  // With the Sound Sensor on for this camera, sound events belong to it and are left out here.
  _checkMotion(events) {
    const motion = this.soundSensorEnabled ? events.filter((event) => event.type !== "SOUND") : events;
    const ids = new Set(motion.map((event) => event.id));
    const previous = this._motionIds;
    this._motionIds = ids;
    if (previous === null || previous === undefined) return;
    const fresh = motion.filter((event) => !previous.has(event.id));
    if (fresh.length > 0) {
      const recent = fresh.filter((event) => this._isRecent(event));
      if (recent.length > 0) this._setMotionActive(true, remainingMs(this.plugin.config, recent));
      if (this.plugin.config.snapshotOnMotion === false) return;
      this.plugin.log.debug?.(`[Camera] ${this.display_name}: new motion, refreshing the picture`);
      this._streamingDelegate?.refreshSnapshot?.("motion");
    }
  }

  // A new sound event in the cloud list turns the Sound Sensor on. The first poll only records
  // what is already there, so a sound from before the camera was watched does not trigger it.
  _checkSound(events) {
    const sounds = events.filter((event) => event.type === "SOUND");
    const ids = new Set(sounds.map((event) => event.id));
    const previous = this._soundIds;
    this._soundIds = ids;
    if (previous === null || previous === undefined) return;
    const recent = sounds.filter((event) => !previous.has(event.id) && this._isRecent(event));
    if (recent.length > 0) this._setSoundActive(true, remainingMs(this.plugin.config, recent));
  }

  // Stop live streams so the camera isn't left with a dead viewer (shutdown).
  stopStreams() {
    clearTimeout(this._motionTimer);
    this._motionTimer = null;
    clearTimeout(this._soundTimer);
    this._soundTimer = null;
    this.detections.stop();
    if (this._motionMember) this.plugin._motionPoller?.remove(this._motionMember);
    this._motionMember = null;
    if (this._refreshMember) this.plugin._refreshScheduler?.remove(this._refreshMember);
    this._refreshMember = null;
    this._streamingDelegate?.stopAll();
  }

  // Privacy switch — added for cameras that can be powered off. Legacy fallback
  // covers cameras that were paired before we started naming the service
  // "<name> Privacy" (used to be just the camera name).
  _setupPrivacySwitch() {
    // The Doorbell v2 can't be powered off through Wyze's API: the camera keeps
    // running whatever we send. A switch that looks like it turned the front-door
    // camera off while it keeps recording is worse than none, so don't offer one,
    // and drop the one a cached accessory may still carry.
    if (this.plugin.client?.cameraSupportsPowerControl?.(this.product_model) === false) {
      const stale = this.homeKitAccessory.getServiceById?.(Service.Switch, "Privacy");
      if (stale) this.homeKitAccessory.removeService(stale);
      this.privacySwitch = null;
      return;
    }

    this.privacySwitch = this._getOrAddService({
      ServiceType: Service.Switch,
      subtype: "Privacy",
      defaultName: "Privacy",
      legacyLookup: () => this.homeKitAccessory.getService(this.display_name),
      label: "Privacy Switch",
    });
    this.privacySwitch
      .getCharacteristic(Characteristic.On)
      .onGet(this.handleOnGetPrivacySwitch.bind(this))
      .onSet(this.handleOnSetPrivacySwitch.bind(this));
    this._setupNativeCameraPower();
  }

  // HomeKit's own camera power control: the Camera Operating Mode service with HomeKitCameraActive (1 = the camera is
  // on). HAP-NodeJS adds that service itself only for a camera set up for Secure Video, so it is added here, for every
  // camera that can be switched off, and kept in step with the Privacy switch (which stays). Turning it off with
  // `nativeCameraPower: false` removes it.
  _setupNativeCameraPower() {
    const stale = this.homeKitAccessory.getService?.(Service.CameraOperatingMode);
    if (this.plugin.config.nativeCameraPower === false || !Service.CameraOperatingMode || !Characteristic.HomeKitCameraActive) {
      if (stale) this.homeKitAccessory.removeService(stale);
      this.nativePower = null;
      return;
    }
    this.nativePower = stale || this.homeKitAccessory.addService(Service.CameraOperatingMode);
    this.nativePower
      .getCharacteristic(Characteristic.HomeKitCameraActive)
      .onGet(async () => this._nativePowerValue())
      .onSet((value) => this.handleOnSetNativePower(value));
  }

  // 1 when the camera is on. A power state not known yet counts as on, as it does for the Privacy switch.
  _nativePowerValue() {
    const power = this.cameraAccessoryAttached() ? this.on : this.power_switch;
    return power === undefined || power === null || isOn(power) ? 1 : 0;
  }

  // Show the camera's power on both HomeKit controls: the Privacy switch (on = camera off) and the native one.
  _showPower(power) {
    this.privacySwitch?.getCharacteristic(Characteristic.On).updateValue(privacyOf(power));
    if (power !== undefined && power !== null) {
      this.nativePower?.getCharacteristic(Characteristic.HomeKitCameraActive).updateValue(isOn(power) ? 1 : 0);
    }
  }

  // ---- HomeKit camera controller -------------------------------------------

  _setupCameraController() {
    const { hap } = require("../types");
    if (!hap?.CameraController) return; // unit-test environments

    // Cameras with a doorbell button get HomeKit's DoorbellController (a
    // CameraController plus a Doorbell service) so the Home app can ring.
    const isDoorbell = !!this.plugin.client?.cameraIsDoorbell?.(this.product_model) && !!hap.DoorbellController;

    const delegate = new WyzeCameraStreamingDelegate(this);
    this._streamingDelegate = delegate;

    const controller = new (isDoorbell ? hap.DoorbellController : hap.CameraController)({
      cameraStreamCount: 2,
      delegate,
      streamingOptions: {
        supportedCryptoSuites: [hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: NATIVE_STREAM_RESOLUTIONS[this.product_model] ?? DEFAULT_STREAM_RESOLUTIONS,
          codec: {
            profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN],
            levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL4_0],
          },
        },
        audio: {
          twoWayAudio: false,
          codecs: [
            {
              type: hap.AudioStreamingCodecType.OPUS,
              samplerate: [
                hap.AudioStreamingSamplerate.KHZ_16,
                hap.AudioStreamingSamplerate.KHZ_24,
              ],
            },
          ],
        },
      },
    });

    this.homeKitAccessory.configureController(controller);
    this._cameraController = controller;
    this._startEventWatch(isDoorbell);
    this._startSnapshotRefresh();

    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Camera] [Stream] CameraController configured for ${this.display_name} (${this.mac})`
      );
  }

  // ---- Update cycle ---------------------------------------------------------

  async updateCharacteristics(device) {
    this._detectFloodlightDongle(device);

    if (!this._cameraControllerReady) {
      this._cameraControllerReady = true;
      try {
        this._setupCameraController();
        // Have a picture ready for the first time the Home app asks. Delayed a few
        // seconds so the first poll has settled the camera's online and power state.
        const prefetch = setTimeout(() => this._streamingDelegate?.prefetchSnapshot?.(), 5000);
        prefetch.unref?.();
      } catch (err) {
        this.plugin.log.error(
          `[Camera] _setupCameraController failed for ${this.display_name}: ${err.message}\n${err.stack}`
        );
      }
    }

    this._discoverSensors(); // once per start; never throws, and does not hold up the refresh

    try {
      this.cameraOnline = this.plugin.client.cameraIsOnline(device);
    } catch (err) {
      this.plugin.log.error(
        `[Camera] cameraIsOnline failed for ${this.display_name}: ${err.message}`
      );
      this.cameraOnline = false;
    }

    // StatusActive on every service so the user sees an "inactive" badge
    // when the camera is offline (much friendlier than the noResponse
    // banner — the last known state stays visible).
    this._markServicesOnline(this.cameraOnline);

    if (!this.cameraOnline) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Camera] ${this.mac} (${this.display_name}) is offline — keeping last known state, marked inactive`
        );
      return;
    }

    // Newer cameras (Floodlight Pro, Battery Cam Pro, OG, Pan v4) report state
    // through the devicemgmt API, not property IDs.
    if (this.plugin.client.cameraUsesDeviceMgmt(this.product_model)) {
      return this._refreshFromDeviceMgmt(device);
    }

    if (!this.cameraAccessoryAttached()) {
      this._applyBulkPower(device);
      return;
    }

    // NOTE: a camera that has any attached accessory configured (garage /
    // spotlight / floodlight / siren / notification) needs its property list,
    // because the bulk getObjectList doesn't include those PIDs. The platform
    // reads them for all such cameras in one request when it can; otherwise
    // this is one extra getDevicePID API call per refresh per camera.
    let propertyList;
    try {
      propertyList = await this._readPropertyList();
    } catch (err) {
      this.plugin.log.error(
        `[Camera] getDevicePID failed for ${this.display_name}: ${err.message}`
      );
      markServiceOnline(this.privacySwitch, false);
      markServiceOnline(this.nativePower, false);
      return;
    }
    if (!propertyList?.data?.property_list) {
      this.plugin.log.error(
        `[Camera] getDevicePID returned unexpected data for ${this.display_name}`
      );
      return;
    }

    const summary = [];
    for (const property of propertyList.data.property_list) {
      switch (property.pid) {
        case "P1": // Notification
          if (this._isInConfig("notificationAccessory")) {
            this.notification = property.value;
            this.notificationSwitch?.getCharacteristic(Characteristic.On).updateValue(this.notification);
            summary.push(`notifications=${isOn(this.notification) ? "on" : "off"}`);
          }
          break;
        case "P3": // Privacy
          this.on = property.value;
          // The camera-off picture and the snapshot skips read power_switch, so it follows P3 here too: on a camera
          // with an attached accessory this path is the only one that runs, and it used to leave power_switch stale.
          this.power_switch = powerFlag(property.value) ?? this.power_switch;
          this._showPower(this.on);
          summary.push(`power=${isOn(this.on) ? "on" : "off"}`);
          break;
        case "P5": // Available
          this.available = property.value;
          break;
        case "P1049": // Siren
          if (this._isInConfig("sirenAccessory")) {
            this.siren = property.value;
            this.sirenSwitch?.getCharacteristic(Characteristic.On).updateValue(this.siren);
            summary.push(`siren=${isOn(this.siren) ? "on" : "off"}`);
          }
          break;
        case "P1056": // Spotlight / Floodlight (same PID — covers both)
          if (this._lightConfigured()) {
            this._setLightState(property.value);
            summary.push(`light=${isOn(this.floodLight) ? "on" : "off"}`);
          }
          break;
        case "P1301": // Garage Door
          if (this._isInConfig("garageDoorAccessory")) {
            this.garageDoor = property.value;
            summary.push(`garage=${property.value == 1 ? "open" : "closed"}`);
          }
          break;
        case "P1001":   // Motion detection state (most cameras)
        case "P1029": { // Motion detection state (Wyze Cam Outdoor)
          if (this._isInConfig("motionDetectionAccessory")) {
            // Wyze returns "1"/"0" strings on some firmwares, 1/0 ints
            // on others. Coerce to boolean explicitly so the HomeKit
            // characteristic gets a clean true/false.
            this.motionDetection = property.value == 1 || property.value === "1";
            this.motionDetectionSwitch
              ?.getCharacteristic(Characteristic.On)
              .updateValue(this.motionDetection);
            summary.push(`motion=${isOn(this.motionDetection) ? "on" : "off"}`);
          }
          break;
        }
      }
    }

    // Persist whatever fields we successfully read so the next reboot
    // gets accurate values immediately instead of "undefined" until the
    // first refresh.
    this.persistState({
      on: this.on,
      notification: this.notification,
      siren: this.siren,
      floodLight: this.floodLight,
      garageDoor: this.garageDoor,
      motionDetection: this.motionDetection,
    });

    if (this.plugin.config.pluginLoggingEnabled && summary.length > 0)
      this.plugin.log(
        `[Camera] ${this.mac} (${this.display_name}): ${summary.join(", ")}`
      );
  }

  _markServicesOnline(online) {
    markServiceOnline(this.privacySwitch, online);
    markServiceOnline(this.nativePower, online);
    markServiceOnline(this.sirenSwitch, online);
    markServiceOnline(this.floodLightService, online);
    markServiceOnline(this.spotLightService, online);
    markServiceOnline(this.garageDoorService, online);
    markServiceOnline(this.notificationSwitch, online);
    markServiceOnline(this.motionDetectionSwitch, online);
  }

  // Privacy-only path: no extra API call, just read the bulk-list field.
  _applyBulkPower(device) {
    const powerSwitch = device.device_params?.power_switch;
    this.power_switch = powerSwitch;
    this._showPower(powerSwitch);
    this.persistState({ power_switch: powerSwitch });
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Camera] ${this.mac} (${this.display_name}): camera power ${isOn(powerSwitch) ? "on" : "off"}`
      );
  }

  async _refreshFromDeviceMgmt(device) {
    let state;
    try {
      state = await this.plugin.client.cameraGetDeviceMgmtState(this.mac, this.product_model);
    } catch (err) {
      this.plugin.log.error(
        `[Camera] devicemgmt state failed for ${this.display_name}: ${err.message}`
      );
      if (device && !this.cameraAccessoryAttached()) {
        // Privacy-only: the bulk list already carries power_switch, which is all
        // beta.2 ever read, so keep working from it instead of going inactive.
        this._applyBulkPower(device);
        return;
      }
      this._markServicesOnline(false);
      return;
    }

    const summary = [];
    const flag = (v) => (v ? 1 : 0);
    if (state.available !== undefined) this.available = flag(state.available);
    if (state.on !== undefined) {
      this.on = flag(state.on);
      this.power_switch = this.on;
      this._showPower(this.on);
      summary.push(`power=${this.on ? "on" : "off"}`);
    }
    if (state.siren !== undefined && this._isInConfig("sirenAccessory")) {
      this.siren = flag(state.siren);
      this.sirenSwitch?.getCharacteristic(Characteristic.On).updateValue(this.siren);
      summary.push(`siren=${this.siren ? "on" : "off"}`);
    }
    if (state.floodlight !== undefined && this._lightConfigured()) {
      this._setLightState(flag(state.floodlight));
      summary.push(`light=${this.floodLight ? "on" : "off"}`);
    }
    if (state.notify !== undefined && this._isInConfig("notificationAccessory")) {
      this.notification = flag(state.notify);
      this.notificationSwitch?.getCharacteristic(Characteristic.On).updateValue(this.notification);
      summary.push(`notifications=${this.notification ? "on" : "off"}`);
    }
    if (state.motion !== undefined && this._isInConfig("motionDetectionAccessory")) {
      this.motionDetection = !!state.motion;
      this.motionDetectionSwitch?.getCharacteristic(Characteristic.On).updateValue(this.motionDetection);
      summary.push(`motion=${this.motionDetection ? "on" : "off"}`);
    }

    this.persistState({
      on: this.on,
      power_switch: this.power_switch,
      notification: this.notification,
      siren: this.siren,
      floodLight: this.floodLight,
      motionDetection: this.motionDetection,
    });

    if (this.plugin.config.pluginLoggingEnabled && summary.length > 0)
      this.plugin.log(
        `[Camera] ${this.mac} (${this.display_name}): ${summary.join(", ")}`
      );
  }

  // ---- Get handlers --------------------------------------------------------

  async handleOnGetPrivacySwitch() {
    // Pull from the right cached field depending on whether we have an
    // attached accessory (PID-driven flow) or just the bulk list field.
    const value = this.cameraAccessoryAttached() ? this.on : this.power_switch;
    return privacyOf(value);
  }

  async handleOnGetSpotlight()    { return this.floodLight ?? 0; }
  async handleOnGetFloodlight()   { return this.floodLight ?? 0; }
  async handleOnGetAlarmSwitch()  { return this.siren ?? 0; }
  async getNotification()         { return this.notification ?? 0; }
  async getMotionDetection()      { return this.motionDetection ?? 0; }

  async getGarageCurrentState() {
    return this.plugin.client.wyzeGarageDoorStateToHomeKit(this.garageDoor);
  }

  async getGarageTargetState() {
    return this.plugin.client.wyzeGarageDoorStateToHomeKit(this.garageDoor);
  }

  async handleObstructionDetectedGet() {
    return 0;
  }

  // ---- Set handlers --------------------------------------------------------

  // Privacy on means the camera is off, as the name says: the switch value is the opposite of the camera's power.
  handleOnSetPrivacySwitch(value) {
    return this._setPower(!value, "Privacy");
  }

  // HomeKit's own control: HomeKitCameraActive 1 is on.
  handleOnSetNativePower(value) {
    return this._setPower(Boolean(value), "Camera power");
  }

  async _setPower(powerOn, label) {
    await this._set(label, () =>
      this.plugin.client.cameraPrivacy(this.mac, this.product_model, powerOn ? "power_on" : "power_off")
    );
    // Wyze accepted it: keep what the plugin believes in step now, rather than at the next check, so the picture
    // HomeKit asks for (the "camera off" one) changes with the control, and the other control follows this one.
    this.power_switch = powerOn ? 1 : 0;
    if (this.on !== undefined) this.on = this.power_switch;
    this._showPower(this.power_switch);
  }

  async handleOnSetAlarmSwitch(value) {
    return this._set("Siren", () =>
      this.plugin.client.cameraSiren(this.mac, this.product_model, value ? "siren_on" : "siren_off")
    );
  }

  async handleOnSetSpotlight(value) {
    return this._set("Spotlight", () =>
      this.plugin.client.cameraSpotLight(this.mac, this.product_model, value ? "1" : "2")
    );
  }

  async handleOnSetFloodlight(value) {
    return this._set("Floodlight", () =>
      this.plugin.client.cameraFloodLight(this.mac, this.product_model, value ? "1" : "2")
    );
  }

  async setNotification(value) {
    return this._set("Notification", () =>
      this.plugin.client.cameraNotifications(this.mac, this.product_model, value ? "1" : "0")
    );
  }

  async setMotionDetection(value) {
    // cameraMotionOn / cameraMotionOff handle the per-model PID
    // routing internally (P1001 + P1047 for most cameras, P1029 for
    // Wyze Cam Outdoor). All we have to do here is pick the verb.
    return this._set("Motion Detection", () =>
      value
        ? this.plugin.client.cameraMotionOn(this.mac, this.product_model)
        : this.plugin.client.cameraMotionOff(this.mac, this.product_model)
    );
  }

  async setGarageTargetState(value) {
    await this._set("Garage Door", () =>
      this.plugin.client.garageDoor(this.mac, this.product_model)
    );
    // Optimistically reflect the user's intent — actual door state will
    // refresh on the next cycle's PID read.
    if (value == 0) {
      this.garageDoorService
        .getCharacteristic(Characteristic.CurrentDoorState)
        .updateValue(Characteristic.CurrentDoorState.OPEN);
    } else if (value == 1) {
      this.garageDoorService
        .getCharacteristic(Characteristic.CurrentDoorState)
        .updateValue(Characteristic.CurrentDoorState.CLOSED);
    }
  }

  async _set(label, fn) {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(`[Camera] [${label}] Set "${this.display_name}"`);
    try {
      await fn();
    } catch (err) {
      this.plugin.log.error(
        `[Camera] [${label}] Set failed for ${this.display_name}: ${err.message || err}`
      );
      throw err;
    }
  }

  cameraAccessoryAttached() {
    return (
      this._isInConfig("garageDoorAccessory") ||
      this._isInConfig("spotLightAccessory") ||
      this._isInConfig("sirenAccessory") ||
      this._isInConfig("floodLightAccessory") ||
      this._hasFloodlightDongle() ||
      this._isInConfig("notificationAccessory") ||
      this._isInConfig("motionDetectionAccessory")
    );
  }

  // For PropertyPoller: the properties _refresh switches on, and whether it will read them this cycle.
  get propertyPids() {
    return CAMERA_PIDS;
  }

  wantsProperties() {
    if (!this.lastDevice || !this.cameraAccessoryAttached()) return false;
    try {
      return (
        !this.plugin.client.cameraUsesDeviceMgmt(this.product_model) &&
        this.plugin.client.cameraIsOnline(this.lastDevice)
      );
    } catch (_) {
      return false;
    }
  }
};
