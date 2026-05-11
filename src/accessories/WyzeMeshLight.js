const colorsys = require("colorsys");
const { Service, Characteristic } = require("../types");
const WyzeAccessory = require("./WyzeAccessory");

const WYZE_API_BRIGHTNESS_PROPERTY = "P1501";
const WYZE_API_COLOR_TEMP_PROPERTY = "P1502";
const WYZE_API_COLOR_PROPERTY = "P1507";

const WYZE_COLOR_TEMP_MIN = 2700;
const WYZE_COLOR_TEMP_MAX = 6500;
const HOMEKIT_COLOR_TEMP_MIN = 500;
const HOMEKIT_COLOR_TEMP_MAX = 140;

const noResponse = new Error("No Response");
noResponse.toString = () => {
  return noResponse.message;
};

module.exports = class WyzeMeshLight extends WyzeAccessory {
  constructor(plugin, homeKitAccessory) {
    super(plugin, homeKitAccessory);

    this.getCharacteristic(Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));
    this.getCharacteristic(Characteristic.Brightness).onSet(this.setBrightness.bind(this));
    this.getCharacteristic(Characteristic.ColorTemperature).onSet(this.setColorTemperature.bind(this));
    this.getCharacteristic(Characteristic.Hue).onSet(this.setHue.bind(this));
    this.getCharacteristic(Characteristic.Saturation).onSet(this.setSaturation.bind(this));

    // Local caching of HSV color space handling separate Hue & Saturation on HomeKit
    // Caching idea for handling HSV colors from:
    //    https://github.com/QuickSander/homebridge-http-rgb-push/blob/master/index.js
    this.cache = {};
    this.cacheUpdated = false;
  }

  async updateCharacteristics(device) {
    if (device.conn_state == 0) {
      this.getCharacteristic(Characteristic.On).updateValue(noResponse);
    } else {
      const switchState = device.device_params?.switch_state;
      if (switchState != null) {
        this._switchState = switchState;
        this.getCharacteristic(Characteristic.On).updateValue(switchState);
      }

      const propertyList = await this.plugin.client.getDevicePID(
        this.mac,
        this.product_model
      );
      for (const property of propertyList?.data?.property_list ?? []) {
        switch (property.pid) {
          case WYZE_API_BRIGHTNESS_PROPERTY:
            if (this.isValidProperty(property)) this.updateBrightness(property.value);
            break;
          case WYZE_API_COLOR_TEMP_PROPERTY:
            if (this.isValidProperty(property)) this.updateColorTemp(property.value);
            break;
          case WYZE_API_COLOR_PROPERTY:
            if (this.isValidProperty(property)) this.updateColor(property.value);
            break;
        }
      }
    }
  }

  isValidProperty(property) {
    if (
        property.value != null &&
        property.value !== "0" &&
        property.value !== "undefined"
    ) {
      return true;
    } else {
      this.plugin.log(`Encountered invalid property value: ${JSON.stringify(property, null, 2)}`);
      return false;
    }
  }

  updateBrightness(value) {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[MeshLight] Updating brightness record for "${this.display_name} (${
          this.mac
        }) to ${value}: ${JSON.stringify(value)}"`
      );
    this.getCharacteristic(Characteristic.Brightness).updateValue(
      this.plugin.client.checkBrightnessValue(value)
    );
  }

  updateColorTemp(value) {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[MeshLight] Updating color Temp record for "${this.display_name} (${
          this.mac
        }) to ${value}: ${JSON.stringify(
          this.plugin.client.kelvinToMired(value)
        )}"`
      );
    this.getCharacteristic(Characteristic.ColorTemperature).updateValue(
      this.plugin.client.checkColorTemp(this.plugin.client.kelvinToMired(value))
    );
  }

  updateColor(value) {
    // Convert a Hex color from Wyze into the HSL values recognized by HomeKit.
    const hslValue = colorsys.hex2Hsv(value);
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[MeshLight] Updating color record for "${this.display_name} (${
          this.mac
        }) to ${value}: ${JSON.stringify(hslValue)}"`
      );

    // Update Hue
    this.updateHue(hslValue.h);
    this.cache.hue = hslValue.h;

    // Update Saturation
    this.updateSaturation(hslValue.s);
    this.cache.saturation = hslValue.s;
  }

  updateHue(value) {
    this.getCharacteristic(Characteristic.Hue).updateValue(value);
  }

  updateSaturation(value) {
    this.getCharacteristic(Characteristic.Saturation).updateValue(value);
  }

  getService() {
    let service = this.homeKitAccessory.getService(Service.Lightbulb);

    if (!service) {
      service = this.homeKitAccessory.addService(Service.Lightbulb);
    }

    return service;
  }

  getCharacteristic(characteristic) {
    return this.getService().getCharacteristic(characteristic);
  }

  async getOn() {
    return this._switchState ?? false;
  }

  async setOn(value) {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[MeshLight] Setting power for "${this.display_name} (${this.mac})" to ${value}"`
      );
    await this.plugin.client.lightMeshPower(this.mac, this.product_model, value ? "1" : "0");
  }

  async setBrightness(value) {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[MeshLight] Setting brightness for "${this.display_name} (${this.mac}) to ${value}"`
      );
    await this.plugin.client.setMeshBrightness(this.mac, this.product_model, value);
  }

  async setColorTemperature(value) {
    if (value == null) return;
    const floatValue = this.plugin.client.rangeToFloat(value, HOMEKIT_COLOR_TEMP_MIN, HOMEKIT_COLOR_TEMP_MAX);
    const wyzeValue = this.plugin.client.floatToRange(floatValue, WYZE_COLOR_TEMP_MIN, WYZE_COLOR_TEMP_MAX);
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[MeshLight] Setting color temperature for "${this.display_name} (${this.mac}) to ${value} : ${wyzeValue}"`
      );
    await this.plugin.client.setMeshColorTemperature(this.mac, this.product_model, wyzeValue);
  }

  async setHue(value) {
    if (value == null) return;
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[MeshLight] Setting hue (color) for "${this.display_name} (${this.mac}) to ${value} : (H)S Values: ${value}, ${this.cache.saturation}"`
      );
    this.cache.hue = value;
    if (this.cacheUpdated) {
      let hexValue = colorsys.hsv2Hex(this.cache.hue, this.cache.saturation, 100);
      hexValue = hexValue.replace("#", "");
      if (this.plugin.config.pluginLoggingEnabled) this.plugin.log(hexValue);
      await this.plugin.client.setMeshHue(this.mac, this.product_model, hexValue);
      this.cacheUpdated = false;
    } else {
      this.cacheUpdated = true;
    }
  }

  async setSaturation(value) {
    if (value == null) return;
    if (this.plugin.config.pluginLoggingEnabled) {
      this.plugin.log(
        `[MeshLight] Setting saturation (color) for "${this.display_name} (${this.mac}) to ${value}"`
      );
      this.plugin.log(
        `[MeshLight] H(S) Values: ${this.cache.saturation}, ${value}`
      );
    }
    this.cache.saturation = value;
    if (this.cacheUpdated) {
      let hexValue = colorsys.hsv2Hex(this.cache.hue, this.cache.saturation, 100);
      hexValue = hexValue.replace("#", "");
      await this.plugin.client.setMeshSaturation(this.mac, this.product_model, hexValue);
      this.cacheUpdated = false;
    } else {
      this.cacheUpdated = true;
    }
  }
};
