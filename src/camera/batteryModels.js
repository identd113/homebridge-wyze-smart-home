"use strict";

// Cameras that run on a battery. A connection to one wakes it, so a picture every 30 seconds
// or a connection held open for a live view would flatten the battery within days. These
// models are left out of the timed picture refresh (unless it is set explicitly) and of
// Quick Live View; their picture is taken at startup and when motion is reported.
const BATTERY_CAMERA_MODELS = new Set([
  "WVOD1", // Cam Outdoor
  "HL_WCO2", // Cam Outdoor v2
  "AN_RSCW", // Battery Cam Pro
]);

const isBatteryCamera = (model) => BATTERY_CAMERA_MODELS.has(model);

module.exports = { BATTERY_CAMERA_MODELS, isBatteryCamera };
