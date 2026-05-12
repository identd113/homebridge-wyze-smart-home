const { Service, Characteristic } = require("../types");
const WyzeAccessory = require("./WyzeAccessory");

const noResponse = new Error("No Response");
noResponse.toString = () => {
  return noResponse.message;
};

module.exports = class WyzeLock extends WyzeAccessory {
  constructor(plugin, homeKitAccessory) {
    super(plugin, homeKitAccessory);

    this.hardlock = null;
    this.door_open_status = null;
    this.lockPower = null;

    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Retrieving previous service for "${this.display_name} (${this.mac})"`
      );
    this.lockService = this.homeKitAccessory.getService(Service.LockMechanism);

    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] [Door Contact] Retrieving previous service for "${this.display_name} (${this.mac})"`
      );
    this.contactService = this.homeKitAccessory.getService(
      Service.ContactSensor
    );

    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] [Battery] Retrieving previous service for "${this.display_name} (${this.mac})"`
      );
    this.batteryService = this.homeKitAccessory.getService(Service.Battery);

    if (!this.lockService) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] Adding service for "${this.display_name} (${this.mac})"`
        );
      this.lockService = this.homeKitAccessory.addService(
        Service.LockMechanism
      );
    }

    if (!this.contactService) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] [Door Contact] Adding service for "${this.display_name} (${this.mac})"`
        );
      this.contactService = this.homeKitAccessory.addService(
        Service.ContactSensor
      );
    }

    if (!this.batteryService) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] [Battery] Adding service for "${this.display_name} (${this.mac})"`
        );
      this.batteryService = this.homeKitAccessory.addService(Service.Battery);
    }

    this.batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .onGet(this.getBatteryStatus.bind(this));

    this.batteryService
      .getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(this.getLowBatteryStatus.bind(this));

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
          `[Lock] Updating status of "${this.display_name} (${this.mac})" to noResponse`
        );
      this.lockService
        .getCharacteristic(Characteristic.LockCurrentState)
        .updateValue(noResponse);
      return false;
    } else {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] Updating status of "${this.display_name} (${this.mac})"`
        );
      const prevHardlock = this.hardlock;
      const prevDoorStatus = this.door_open_status;
      const prevPower = this.lockPower;

      const propertyList = await this.plugin.client.getLockInfo(
        this.mac,
        this.product_model
      );
      let lockProperties = propertyList?.device;
      if (!lockProperties) return false;
      const prop_key = Object.keys(lockProperties);
      for (const element of prop_key) {
        const prop = element;
        switch (prop) {
          case "onoff_line":
            this.lockOnOffline = lockProperties[prop];
            break;
          case "power":
            // Lock Battery
            this.batteryService
              .getCharacteristic(Characteristic.BatteryLevel)
              .updateValue(
                this.plugin.client.checkBatteryVoltage(lockProperties[prop])
              );
            this.lockPower = lockProperties[prop];
            break;
          case "door_open_status":
            // Door Status
            this.contactService
              .getCharacteristic(Characteristic.ContactSensorState)
              .updateValue(
                this.plugin.client.getLockDoorState(lockProperties[prop])
              );
            this.door_open_status = lockProperties[prop];
            break;
          case "trash_mode":
            this.trash_mode = lockProperties[prop];
            break;
        }
      }
      let lockerStatusProperties = lockProperties.locker_status;
      if (!lockerStatusProperties) return false;
      const prop_keyLock = Object.keys(lockerStatusProperties);
      for (const element of prop_keyLock) {
        const prop = element;
        switch (prop) {
          case "hardlock":
            // Door Locked Status
            this.lockService
              .getCharacteristic(Characteristic.LockCurrentState)
              .updateValue(
                this.plugin.client.getLockState(lockerStatusProperties[prop])
              );
            this.hardlock = lockerStatusProperties[prop];
            break;
        }
      }

      return this.hardlock !== prevHardlock ||
        this.door_open_status !== prevDoorStatus ||
        this.lockPower !== prevPower;
    }
  }

  async getLockCurrentState() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Current State "${this.display_name} (${this.mac}) to ${this.hardlock}"`
      );
    if (this.hardlock == 2) {
      return Characteristic.LockCurrentState.UNSECURED;
    } else {
      return Characteristic.LockCurrentState.SECURED;
    }
  }

  async getLockTargetState() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Target State "${this.display_name} (${this.mac}) to ${this.hardlock}"`
      );

    if (this.hardlock === 2) {
      return Characteristic.LockTargetState.UNSECURED;
    } else {
      return Characteristic.LockTargetState.SECURED;
    }
  }

  async getDoorStatus() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Door Status "${this.display_name} (${this.mac}) to ${this.door_open_status}"`
      );
    if (this.door_open_status == 1) {
      return Characteristic.ContactSensorState.CONTACT_NOT_DETECTED; // 1
    } else {
      return Characteristic.ContactSensorState.CONTACT_DETECTED; // 0
    }
  }

  async getBatteryStatus() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Battery Status "${this.display_name} (${this.mac}) to ${this.lockPower}"`
      );
    return this.plugin.client.checkBatteryVoltage(this.lockPower);
  }

  async getLowBatteryStatus() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] Getting Low Battery Status "${this.display_name} (${
          this.mac
        }) to ${this.plugin.client.checkLowBattery(this.lockPower)}"`
      );
    return this.plugin.client.checkLowBattery(this.lockPower);
  }

  async setLockTargetState(targetState) {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(`[Lock] Setting Target State "${targetState}"`); // this is zero or 1
    await this.plugin.client.controlLock(
      this.mac,
      this.product_model,
      targetState === Characteristic.LockTargetState.SECURED
        ? "remoteLock"
        : "remoteUnlock"
    );

    this.lockService.setCharacteristic(
      Characteristic.LockCurrentState,
      targetState === Characteristic.LockTargetState.SECURED
        ? Characteristic.LockCurrentState.SECURED
        : Characteristic.LockCurrentState.UNSECURED
    );
  }

};
