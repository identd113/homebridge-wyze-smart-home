const { Service, Characteristic } = require("../types");
const WyzeAccessory = require("./WyzeAccessory");

const noResponse = new Error("No Response");
noResponse.toString = () => {
  return noResponse.message;
};

module.exports = class WyzeLockBoltV2 extends WyzeAccessory {
  constructor(plugin, homeKitAccessory) {
    super(plugin, homeKitAccessory);

    this.isLocked = true;
    this.isDoorOpen = false;
    this.batteryLevel = 100;
    this.chargingState = 0;
    this.firmwareVersion = "";
    this._commandGraceUntil = 0;

    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Retrieving previous service for "${this.display_name} [${this.model_name}] (${this.mac})"`
      );
    this.lockService = this.homeKitAccessory.getService(Service.LockMechanism);

    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] [Door Contact] Retrieving previous service for "${this.display_name} [${this.model_name}] (${this.mac})"`
      );
    this.contactService = this.homeKitAccessory.getService(Service.ContactSensor);

    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] [Battery] Retrieving previous service for "${this.display_name} [${this.model_name}] (${this.mac})"`
      );
    this.batteryService = this.homeKitAccessory.getService(Service.Battery);

    if (!this.lockService) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] Adding service for "${this.display_name} [${this.model_name}] (${this.mac})"`
        );
      this.lockService = this.homeKitAccessory.addService(Service.LockMechanism);
    }

    if (!this.contactService) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] [Door Contact] Adding service for "${this.display_name} [${this.model_name}] (${this.mac})"`
        );
      this.contactService = this.homeKitAccessory.addService(Service.ContactSensor);
    }

    if (!this.batteryService) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] [Battery] Adding service for "${this.display_name} [${this.model_name}] (${this.mac})"`
        );
      this.batteryService = this.homeKitAccessory.addService(Service.Battery);
    }

    this.batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this));

    this.batteryService
      .getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(this.getLowBatteryStatus.bind(this));

    this.batteryService
      .getCharacteristic(Characteristic.ChargingState)
      .onGet(this.getChargingState.bind(this));

    this.contactService
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(this.getDoorStatus.bind(this));

    this.lockService
      .getCharacteristic(Characteristic.LockCurrentState)
      .onGet(this.getLockCurrentState.bind(this));

    this.lockService
      .getCharacteristic(Characteristic.LockTargetState)
      .onGet(this.getLockTargetState.bind(this))
      .onSet(this.setLockTargetState.bind(this));
  }

  async updateCharacteristics(device) {
    if (device.conn_state === 0) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] Updating status of "${this.display_name} [${this.model_name}] (${this.mac})" to noResponse`
        );
      this.lockService
        .getCharacteristic(Characteristic.LockCurrentState)
        .updateValue(noResponse);
      return false;
    }

    const prevLocked = this.isLocked;
    const prevDoorOpen = this.isDoorOpen;
    const prevBattery = this.batteryLevel;
    const prevCharging = this.chargingState;

    try {
      // Palm Lock (DX_PVLOC) intentionally uses lockBoltV2GetProperties — it supports all 6 props
      // and palmLockGetProperties in wyze-api is missing door-status + power-source.
      const result = await this.plugin.client.lockBoltV2GetProperties(this.mac, this.product_model);
      if (!result || result.code !== "1") {
        if (this.plugin.config.pluginLoggingEnabled)
          this.plugin.log(
            `[Lock] IoT3 error for "${this.display_name} [${this.model_name}] (${this.mac})": ${result?.msg ?? 'no response'}`
          );
        return false;
      }

      const props = (result.data && result.data.props) || {};

      // iot-device::iot-state reflects live connectivity — catches disconnects
      // faster than device.conn_state which only updates on the slow poll.
      if (props["iot-device::iot-state"] !== undefined && !props["iot-device::iot-state"]) {
        if (this.plugin.config.pluginLoggingEnabled)
          this.plugin.log(
            `[Lock] Device offline per IoT3 "${this.display_name} [${this.model_name}] (${this.mac})"`
          );
        this.lockService
          .getCharacteristic(Characteristic.LockCurrentState)
          .updateValue(noResponse);
        return false;
      }

      if (props["lock::lock-status"] !== undefined) {
        // Skip during grace period after a command to avoid reverting an
        // optimistic update before the API has propagated the change.
        if (Date.now() > this._commandGraceUntil) {
          this.isLocked = props["lock::lock-status"];
          this.lockService
            .getCharacteristic(Characteristic.LockCurrentState)
            .updateValue(
              this.isLocked
                ? Characteristic.LockCurrentState.SECURED
                : Characteristic.LockCurrentState.UNSECURED
            );
          this.lockService
            .getCharacteristic(Characteristic.LockTargetState)
            .updateValue(
              this.isLocked
                ? Characteristic.LockTargetState.SECURED
                : Characteristic.LockTargetState.UNSECURED
            );
        }
      }

      if (props["lock::door-status"] !== undefined) {
        // door-status: true = door closed, false = door open
        this.isDoorOpen = !props["lock::door-status"];
        this.contactService
          .getCharacteristic(Characteristic.ContactSensorState)
          .updateValue(
            this.isDoorOpen
              ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
              : Characteristic.ContactSensorState.CONTACT_DETECTED
          );
      }

      if (props["battery::battery-level"] !== undefined) {
        this.batteryLevel = props["battery::battery-level"];
        this.batteryService
          .getCharacteristic(Characteristic.BatteryLevel)
          .updateValue(this.plugin.client.checkBatteryVoltage(this.batteryLevel));
        this.batteryService
          .getCharacteristic(Characteristic.StatusLowBattery)
          .updateValue(
            this.plugin.client.checkLowBattery(this.batteryLevel)
          );
      }

      if (props["battery::power-source"] !== undefined) {
        // power-source: 1 = battery (not charging), 2 = USB/charging (inferred)
        this.chargingState = props["battery::power-source"] === 2 ? 1 : 0;
        this.batteryService
          .getCharacteristic(Characteristic.ChargingState)
          .updateValue(this.chargingState);
      }

      if (props["device-info::firmware-ver"] !== undefined) {
        this.firmwareVersion = String(props["device-info::firmware-ver"]);
        this.homeKitAccessory
          .getService(Service.AccessoryInformation)
          .setCharacteristic(Characteristic.FirmwareRevision, this.firmwareVersion);
      }
    } catch (e) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] Error updating "${this.display_name} [${this.model_name}] (${this.mac})": ${e}`
        );
      return false;
    }

    return this.isLocked !== prevLocked ||
      this.isDoorOpen !== prevDoorOpen ||
      this.batteryLevel !== prevBattery ||
      this.chargingState !== prevCharging;
  }

  async getLockCurrentState() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Current State "${this.display_name} [${this.model_name}] (${this.mac}) to ${this.isLocked}"`
      );
    return this.isLocked
      ? Characteristic.LockCurrentState.SECURED
      : Characteristic.LockCurrentState.UNSECURED;
  }

  async getLockTargetState() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Target State "${this.display_name} [${this.model_name}] (${this.mac}) to ${this.isLocked}"`
      );
    return this.isLocked
      ? Characteristic.LockTargetState.SECURED
      : Characteristic.LockTargetState.UNSECURED;
  }

  async getDoorStatus() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Door Status "${this.display_name} [${this.model_name}] (${this.mac}) to ${this.isDoorOpen}"`
      );
    return this.isDoorOpen
      ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : Characteristic.ContactSensorState.CONTACT_DETECTED;
  }

  async getBatteryLevel() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Battery Level "${this.display_name} [${this.model_name}] (${this.mac}) to ${this.batteryLevel}"`
      );
    return this.plugin.client.checkBatteryVoltage(this.batteryLevel);
  }

  async getLowBatteryStatus() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Low Battery Status "${this.display_name} [${this.model_name}] (${this.mac}) to ${this.plugin.client.checkLowBattery(this.batteryLevel)}"`
      );
    return this.plugin.client.checkLowBattery(this.batteryLevel);
  }

  async getChargingState() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Charging State "${this.display_name} [${this.model_name}] (${this.mac}) to ${this.chargingState}"`
      );
    return this.chargingState;
  }

  async setLockTargetState(targetState) {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Setting Target State "${this.display_name} [${this.model_name}] (${this.mac}) to ${targetState}"`
      );

    // Optimistically update HomeKit immediately so the tile clears "waiting".
    // Grace period prevents the fast poll from reverting this before the API propagates.
    this.isLocked = targetState === Characteristic.LockTargetState.SECURED;
    this._commandGraceUntil = Date.now() + 15000;
    this.lockService
      .getCharacteristic(Characteristic.LockCurrentState)
      .updateValue(
        this.isLocked
          ? Characteristic.LockCurrentState.SECURED
          : Characteristic.LockCurrentState.UNSECURED
      );

    const call = this.isLocked
      ? this.plugin.client.lockBoltV2Lock(this.mac, this.product_model)
      : this.plugin.client.lockBoltV2Unlock(this.mac, this.product_model);

    call.catch((e) => {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] Command error for "${this.display_name} [${this.model_name}] (${this.mac})": ${e}`
        );
    });
  }
};
