// The plugin's settings page asks this for what the plugin found each camera can have (see ../src/detectedSensors.js).
// An ES module (see package.json beside it): @homebridge/plugin-ui-utils is ESM-only.
import { createRequire } from "node:module";
import { HomebridgePluginUiServer } from "@homebridge/plugin-ui-utils";

const detectedSensors = createRequire(import.meta.url)("../src/detectedSensors.js");

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest("/detected", () => detectedSensors.read(this.homebridgeStoragePath));
    this.ready();
  }
}

(() => new UiServer())();
