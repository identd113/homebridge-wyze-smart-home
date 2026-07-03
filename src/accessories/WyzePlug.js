const { Service, Characteristic } = require("../types");
const WyzeAccessory = require("./WyzeAccessory");

const noResponse = new Error("No Response");
noResponse.toString = () => {
  return noResponse.message;
};

module.exports = class WyzePlug extends WyzeAccessory {
  constructor(plugin, homeKitAccessory) {
    super(plugin, homeKitAccessory);

    this.getOnCharacteristic()
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));
  }

  async getOn() {
    return this._switchState ?? false;
  }

  async setOn(value) {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Plug] Setting power for "${this.display_name} (${this.mac})" to ${value}`
      );
    this._switchState = value ? 1 : 0;
    this.armCommandGrace(15000);
    this.plugin.client.plugPower(this.mac, this.product_model, value ? "1" : "0").catch((e) => {
      this.clearCommandGrace();
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(`[Plug] Command error for "${this.display_name}": ${e}`);
    });
  }

  updateCharacteristics(device) {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Plug] Updating status of "${this.display_name} (${this.mac})"`
      );
    if (device.conn_state === 0) {
      this.getOnCharacteristic().updateValue(noResponse);
    } else {
      const switchState = device.device_params?.switch_state;
      if (switchState != null && switchState !== this._switchState && !this.inCommandGrace()) {
        this._switchState = switchState;
        this.getOnCharacteristic().updateValue(switchState);
      }
    }
  }

  getOutletService() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Plug] Retrieving previous service for "${this.display_name} (${this.mac})"`
      );
    let service = this.homeKitAccessory.getService(Service.Outlet);

    if (!service) {
      if (this.plugin.config.pluginLoggingEnabled)
        this.plugin.log(
          `[Plug] Adding service for "${this.display_name} (${this.mac})"`
        );
      service = this.homeKitAccessory.addService(Service.Outlet);
    }

    return service;
  }

  getOnCharacteristic() {
    if (this.plugin.config.pluginLoggingEnabled)
      this.plugin.log(
        `[Plug] Fetching status of "${this.display_name} (${this.mac})"`
      );
    return this.getOutletService().getCharacteristic(Characteristic.On);
  }

};
