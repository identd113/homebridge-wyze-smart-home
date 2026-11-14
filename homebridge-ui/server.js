// The plugin's settings page asks this for what the plugin found each camera can have (see ../src/detectedSensors.js),
// and for the checks on a change before the page hands it to Homebridge to save. The logic is in ../src/detectedView.js,
// so there is one copy of it. This server never writes the config: Homebridge's own UI does, when the page asks it to.
// An ES module (see package.json beside it): @homebridge/plugin-ui-utils is ESM-only.
import { createRequire } from "node:module";
import { HomebridgePluginUiServer } from "@homebridge/plugin-ui-utils";

const require = createRequire(import.meta.url);
const detectedSensors = require("../src/detectedSensors.js");
const detectedView = require("../src/detectedView.js");
const webPage = require("../src/webPageLink.js");

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    // The cameras as the panel shows them, for the plugin config the page holds now.
    this.onRequest("/view", ({ config } = {}) => {
      const detected = detectedSensors.read(this.homebridgeStoragePath);
      const names = {};
      const cameras = detectedView.presentCameras(detected, Array.isArray(config) ? config : []);
      for (const cam of cameras) names[cam.id] = cam.name;
      return { plans: detectedView.planSummary(detected.plans, names), cameras };
    });
    // The config to save for one camera's choice, or why it must not be saved.
    this.onRequest("/prepare", ({ config, id, choice } = {}) => {
      const detected = detectedSensors.read(this.homebridgeStoragePath);
      return detectedView.prepareChoice(detected, Array.isArray(config) ? config : [], id, choice);
    });
    // The links of the camera test page, when it is on (the plugin notes them in its storage folder).
    this.onRequest("/web-link", () => webPage.read(this.homebridgeStoragePath));
    this.ready();
  }
}

(() => new UiServer())();
