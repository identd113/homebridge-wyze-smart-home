const { Service, Characteristic } = require("../types");

// Responses from the Wyze API can lag a little after a new value is set
const UPDATE_THROTTLE_MS = 1000;

module.exports = class WyzeAccessory {
  constructor(plugin, homeKitAccessory) {
    this.updating = false;
    this.lastTimestamp = null;
    this.lastDevice = null;

    this.plugin = plugin;
    this.homeKitAccessory = homeKitAccessory;
  }

  // Default Prop
  get display_name() {
    return this.homeKitAccessory.displayName;
  }
  get mac() {
    return this.homeKitAccessory.context.mac;
  }
  get product_type() {
    return this.homeKitAccessory.context.product_type;
  }
  get product_model() {
    return this.homeKitAccessory.context.product_model;
  }

  /** Determines whether this accessory matches the given Wyze device */
  matches(device) {
    return this.mac === device.mac;
  }

  async update(device, timestamp) {
    const productType = device.product_type;

    switch (productType) {
      default:
        this.homeKitAccessory.context = {
          mac: device.mac,
          product_type: device.product_type,
          product_model: device.product_model,
          nickname: device.nickname,
        };
        break;
    }

    this.homeKitAccessory
      .getService(Service.AccessoryInformation)
      .updateCharacteristic(Characteristic.Name, device.nickname)
      .updateCharacteristic(Characteristic.Manufacturer, "Wyze")
      .updateCharacteristic(Characteristic.Model, device.product_model)
      .updateCharacteristic(Characteristic.SerialNumber, device.mac)
      .updateCharacteristic(
        Characteristic.FirmwareRevision,
        device.firmware_ver
      );

    this.lastDevice = device;
    if (this.shouldUpdateCharacteristics(timestamp)) {
      this.lastTimestamp = timestamp;
      this.updating = true;
      try {
        // Promise.resolve wraps both sync-return and async-return uniformly.
        // The outer try/catch is required: if updateCharacteristics() throws
        // synchronously, the throw escapes Promise.resolve() before .catch()
        // is attached, which would turn update() into an unhandled rejection.
        Promise.resolve(this.updateCharacteristics(device))
          .catch(e => {
            if (this.plugin?.log?.error)
              this.plugin.log.error(`[${this.product_type}] Error updating "${this.display_name}": ${e}`);
          })
          .finally(() => { this.updating = false; });
      } catch (e) {
        this.updating = false;
        if (this.plugin?.log?.error)
          this.plugin.log.error(`[${this.product_type}] Error updating "${this.display_name}": ${e}`);
      }
    }
  }
  shouldUpdateCharacteristics(timestamp) {
    if (this.updating) {
      return false;
    }

    if (
      this.lastTimestamp &&
      timestamp <= this.lastTimestamp + UPDATE_THROTTLE_MS
    ) {
      return false;
    }

    return true;
  }

  updateCharacteristics(device) {
    //
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};
