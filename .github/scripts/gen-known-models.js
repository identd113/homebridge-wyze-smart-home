"use strict";

// Writes known-models.json: every model code the plugin handles, and the kind of accessory
// that handles it. The issue triage reads it, so it does not need wyze-api installed.
// Run `npm run known-models` after wyze-api gains a device. tests/triageIssue.test.js fails
// when the file is out of date.

const fs = require("fs");
const path = require("path");

function build() {
  const { WyzeAccessoryModels } = require("wyze-api");
  const kinds = {
    CameraModels: "camera or doorbell",
    OutdoorPlugModels: "plug",
    PlugModels: "plug",
    LightModels: "light",
    MeshLightModels: "light",
    LightStripModels: "light",
    ContactSensorModels: "contact sensor",
    MotionSensorModels: "motion sensor",
    LockModels: "lock",
    LockBoltV2Models: "lock",
    TemperatureHumidityModels: "temperature and humidity sensor",
    LeakSensorModels: "leak sensor",
    CommonModels: "wall switch",
    S1GatewayModels: "home monitoring system",
    ThermostatModels: "thermostat",
    ThermostatRoomSensor: "thermostat room sensor",
    VacuumModels: "vacuum",
    IrrigationModels: "sprinkler controller",
  };
  const out = {};
  for (const [group, models] of Object.entries(WyzeAccessoryModels)) {
    for (const code of Object.values(models)) out[code] = kinds[group] || group;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, "known-models.json"), JSON.stringify(build(), null, 2) + "\n");
}

module.exports = { build };
