const { Service, Characteristic } = require("../types");
const WyzeAccessory = require("./WyzeAccessory");
const enums = require("../enums");
const WyzeCameraStreamingDelegate = require("../camera/WyzeCameraStreamingDelegate");
const { markServiceOnline } = require("./offlineIndicator");

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
const DOORBELL_MAX_BACKOFF_TICKS = 12; // ~1 minute between tries while Wyze keeps failing

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

    // Remove any MotionSensor service left over from earlier plugin versions —
    // we don't have a reliable way to detect motion so we no longer expose it.
    const staleMotion = this.homeKitAccessory.getService(Service.MotionSensor);
    if (staleMotion) this.homeKitAccessory.removeService(staleMotion);

    if (!Object.values(enums.CameraModels).includes(this.product_model)) return;

    this._setupPrivacySwitch();

    if (!this.cameraAccessoryAttached()) return;

    // Optional services driven by per-MAC config arrays.
    if (this._isInConfig("garageDoorAccessory")) {
      this.garageDoorEnabled = true;
      this.garageDoorService = this._getOrAddService({
        ServiceType: Service.GarageDoorOpener,
        subtype: "GarageDoor",
        defaultName: `${this.display_name} Garage Door`,
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
        defaultName: `${this.display_name} Spotlight`,
        label: "Spotlight",
      });
      this.spotLightService
        .getCharacteristic(Characteristic.On)
        .onGet(this.handleOnGetSpotlight.bind(this))
        .onSet(this.handleOnSetSpotlight.bind(this));
    }

    if (this._isInConfig("floodLightAccessory")) {
      this.floodLightEnabled = true;
      this.floodLightService = this._getOrAddService({
        ServiceType: Service.Lightbulb,
        subtype: "FloodLight",
        defaultName: `${this.display_name} Floodlight`,
        label: "Floodlight",
      });
      this.floodLightService
        .getCharacteristic(Characteristic.On)
        .onGet(this.handleOnGetFloodlight.bind(this))
        .onSet(this.handleOnSetFloodlight.bind(this));
    }

    if (this._isInConfig("sirenAccessory")) {
      this.sirenEnabled = true;
      this.sirenSwitch = this._getOrAddService({
        ServiceType: Service.Switch,
        subtype: "Siren",
        defaultName: `${this.display_name} Siren`,
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
        defaultName: `${this.display_name} Notifications`,
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
        defaultName: `${this.display_name} Motion Detection`,
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

  _startRingWatch() {
    if (this._ringTimer) return;
    this._ringedIds = null; // seeded by the first successful poll
    this._ringFailures = 0;
    this._ringSkip = 0;
    this._ringTimer = setInterval(() => this._checkRing(), DOORBELL_POLL_MS);
    this._ringTimer.unref?.();
  }

  async _checkRing() {
    if (this._ringBusy) return;
    if (this.cameraOnline === false) {
      this._ringedIds = null; // re-seed when it is back, so nothing from the gap rings late
      return;
    }
    if (this._ringSkip > 0) { this._ringSkip -= 1; return; } // backing off after errors
    this._ringBusy = true;
    try {
      const events = await this.plugin.client.cameraGetEvents(this.mac, { sinceMs: 5 * 60 * 1000, count: 10 });
      // Events change after they appear (a press starts as motion), so judge each
      // by its current type.
      const rings = events.filter((event) => event.type === "DOORBELL_RANG");
      if (this._ringedIds === null) {
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
      this._ringFailures = 0;
    } catch (err) {
      // Back off (5 s, 10 s, 20 s ... about a minute) so a failing Wyze doesn't
      // get hammered, or slow the main refresh that shares the same client.
      this._ringFailures += 1;
      this._ringSkip = Math.min(2 ** (this._ringFailures - 1) - 1, DOORBELL_MAX_BACKOFF_TICKS);
      this.plugin.log.debug?.(`[Camera] ${this.display_name}: doorbell event check failed: ${err.message}`);
      if (this._ringFailures === 5) {
        this.plugin.log.warn?.(`[Camera] ${this.display_name}: doorbell presses can't be read from Wyze right now (${err.message}); retrying`);
      }
    } finally {
      this._ringBusy = false;
    }
  }

  // Stop live streams so the camera isn't left with a dead viewer (shutdown).
  stopStreams() {
    clearInterval(this._ringTimer);
    this._ringTimer = null;
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
      defaultName: `${this.display_name} Privacy`,
      legacyLookup: () => this.homeKitAccessory.getService(this.display_name),
      label: "Privacy Switch",
    });
    this.privacySwitch
      .getCharacteristic(Characteristic.On)
      .onGet(this.handleOnGetPrivacySwitch.bind(this))
      .onSet(this.handleOnSetPrivacySwitch.bind(this));
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
    if (isDoorbell) this._startRingWatch();

    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Camera] [Stream] CameraController configured for ${this.display_name} (${this.mac})`
      );
  }

  // ---- Update cycle ---------------------------------------------------------

  async updateCharacteristics(device) {
    if (!this._cameraControllerReady) {
      this._cameraControllerReady = true;
      try {
        this._setupCameraController();
      } catch (err) {
        this.plugin.log.error(
          `[Camera] _setupCameraController failed for ${this.display_name}: ${err.message}\n${err.stack}`
        );
      }
    }

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

    // NOTE: one extra getDevicePID API call per refresh per camera that has
    // any attached accessory configured (garage / spotlight / floodlight /
    // siren / notification). Required because the bulk getObjectList
    // doesn't include those PIDs.
    let propertyList;
    try {
      propertyList = await this.plugin.client.getDevicePID(this.mac, this.product_model);
    } catch (err) {
      this.plugin.log.error(
        `[Camera] getDevicePID failed for ${this.display_name}: ${err.message}`
      );
      markServiceOnline(this.privacySwitch, false);
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
            summary.push(`notifications=${this.notification ? "on" : "off"}`);
          }
          break;
        case "P3": // Privacy
          this.on = property.value;
          this.privacySwitch?.getCharacteristic(Characteristic.On).updateValue(this.on);
          summary.push(`power=${this.on ? "on" : "off"}`);
          break;
        case "P5": // Available
          this.available = property.value;
          break;
        case "P1049": // Siren
          if (this._isInConfig("sirenAccessory")) {
            this.siren = property.value;
            this.sirenSwitch?.getCharacteristic(Characteristic.On).updateValue(this.siren);
            summary.push(`siren=${this.siren ? "on" : "off"}`);
          }
          break;
        case "P1056": // Spotlight / Floodlight (same PID — covers both)
          if (this._isInConfig("spotLightAccessory")) {
            this.floodLight = property.value;
            this.spotLightService?.getCharacteristic(Characteristic.On).updateValue(this.floodLight);
            summary.push(`spotlight=${this.floodLight ? "on" : "off"}`);
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
            summary.push(`motion=${this.motionDetection ? "on" : "off"}`);
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
    this.privacySwitch?.getCharacteristic(Characteristic.On).updateValue(powerSwitch);
    this.persistState({ power_switch: powerSwitch });
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Camera] ${this.mac} (${this.display_name}): camera power ${powerSwitch ? "on" : "off"}`
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
      this.privacySwitch?.getCharacteristic(Characteristic.On).updateValue(this.on);
      summary.push(`power=${this.on ? "on" : "off"}`);
    }
    if (state.siren !== undefined && this._isInConfig("sirenAccessory")) {
      this.siren = flag(state.siren);
      this.sirenSwitch?.getCharacteristic(Characteristic.On).updateValue(this.siren);
      summary.push(`siren=${this.siren ? "on" : "off"}`);
    }
    if (state.floodlight !== undefined && this._isInConfig("spotLightAccessory")) {
      this.floodLight = flag(state.floodlight);
      this.spotLightService?.getCharacteristic(Characteristic.On).updateValue(this.floodLight);
      summary.push(`spotlight=${this.floodLight ? "on" : "off"}`);
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
    return value ?? 0;
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

  async handleOnSetPrivacySwitch(value) {
    return this._set("Privacy", () =>
      this.plugin.client.cameraPrivacy(this.mac, this.product_model, value ? "power_on" : "power_off")
    );
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
      this._isInConfig("notificationAccessory") ||
      this._isInConfig("motionDetectionAccessory")
    );
  }
};
