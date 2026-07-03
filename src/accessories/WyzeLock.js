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
        `[Lock] Retrieving previous service for "${this.display_name} [${this.model_name}] (${this.mac})"`
      );
    this.lockService = this.homeKitAccessory.getService(Service.LockMechanism);

    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Lock] [Door Contact] Retrieving previous service for "${this.display_name} [${this.model_name}] (${this.mac})"`
      );
    this.contactService = this.homeKitAccessory.getService(
      Service.ContactSensor
    );

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
      this.lockService = this.homeKitAccessory.addService(
        Service.LockMechanism
      );
    }

    if (!this.contactService) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] [Door Contact] Adding service for "${this.display_name} [${this.model_name}] (${this.mac})"`
        );
      this.contactService = this.homeKitAccessory.addService(
        Service.ContactSensor
      );
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
          `[Lock] Updating status of "${this.display_name} [${this.model_name}] (${this.mac})" to noResponse`
        );
      this.lockService
        .getCharacteristic(Characteristic.LockCurrentState)
        .updateValue(noResponse);
      return false;
    } else {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Lock] Updating status of "${this.display_name} [${this.model_name}] (${this.mac})"`
        );
      const prevHardlock = this.hardlock;
      const prevDoorStatus = this.door_open_status;
      const prevPower = this.lockPower;

      const apiT0 = Date.now();
      const propertyList = await this.plugin.client.getLockInfo(
        this.mac,
        this.product_model
      );
      const apiMs = Date.now() - apiT0;
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
            // Door Locked Status — skip during grace period after a command
            if (!this.inCommandGrace()) {
              this.hardlock = lockerStatusProperties[prop];
              const lockState = this.plugin.client.getLockState(lockerStatusProperties[prop]);
              this.lockService
                .getCharacteristic(Characteristic.LockCurrentState)
                .updateValue(lockState);
              this.lockService
                .getCharacteristic(Characteristic.LockTargetState)
                .updateValue(lockState);
            }
            break;
        }
      }

      if (this.plugin.config.pluginLoggingEnabled) {
        const hkMs = Date.now() - apiT0 - apiMs;
        this.plugin.log(`[Lock] Timing for "${this.display_name}": API ${apiMs}ms | HK update ${hkMs}ms`);
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
      this.plugin.log(`[Lock] Setting Target State "${this.display_name} [${this.model_name}] (${this.mac}) to ${targetState}"`);

    const locking = targetState === Characteristic.LockTargetState.SECURED;

    // Optimistically update HomeKit immediately so the tile clears "waiting".
    // Grace period prevents the fast poll from reverting this before the API propagates.
    // Locking propagates in ~15s; unlocking takes ~90s on the Wyze Ford API endpoint.
    this.hardlock = locking ? 1 : 2;
    this.armCommandGrace(locking ? 15000 : 90000);
    this.lockService.getCharacteristic(Characteristic.LockCurrentState).updateValue(
      locking ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED
    );
    this.lockService.getCharacteristic(Characteristic.LockTargetState).updateValue(
      locking ? Characteristic.LockTargetState.SECURED : Characteristic.LockTargetState.UNSECURED
    );

    const cmdT0 = Date.now();
    this.plugin.client.controlLock(
      this.mac,
      this.product_model,
      locking ? "remoteLock" : "remoteUnlock"
    )
      .then(() => {
        if (this.plugin.config.pluginLoggingEnabled)
          this.plugin.log(`[Lock] Command ACK in ${Date.now() - cmdT0}ms for "${this.display_name}"`);
      })
      .catch((e) => {
        // Command failed — don't leave the optimistic state stuck for the
        // full grace window; let the next poll correct it.
        this.clearCommandGrace();
        if (this.plugin.config.pluginLoggingEnabled)
          this.plugin.log(`[Lock] Command error after ${Date.now() - cmdT0}ms for "${this.display_name}": ${e}`);
      });
  }

};
