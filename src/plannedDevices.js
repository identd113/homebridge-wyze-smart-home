"use strict";

// Wyze devices we have some information about but no accessory for yet. Nothing here
// creates anything in HomeKit: the entry only lets the startup log say what the device is
// and what is missing, instead of a bare "Unsupported device type". Keep this in step with
// the README's "Not Yet Supported" table.
const NEW_DEVICE_FORM = "https://github.com/wyze-smart-home/homebridge-wyze-smart-home/issues/new?template=new-device.yml";

const PLANNED_DEVICES = {
  CO_AP1: {
    name: "Wyze Air Purifier",
    source: "SecKatie/wyzeapy",
    note: "wyzeapy reads on/off, fan mode and air quality. HomeKit has matching Air Purifier and Air Quality services. It needs a new accessory class and has not been tried on hardware.",
  },
  YD_BT1: {
    name: "Wyze Lock Bolt (original, Bluetooth only)",
    source: "SecKatie/wyzeapy",
    note: "It is controlled over Bluetooth, not Wyze's cloud, so the plugin cannot reach it.",
  },
  GW_DBD: {
    name: "Wyze Duo Cam Doorbell",
    source: "mrlt8/docker-wyze-bridge issue 1386 and SecKatie/wyzeapy issue 350",
    note: "It reports its state as iot-device::iot-state and has no iot-device::iot-power property, and other projects get snapshots but no stream from it. Nothing has been tried on hardware here.",
  },
  GW_WC: {
    name: "Wyze Window Cam",
    source: "mrlt8/docker-wyze-bridge issue 1516",
    note: "docker-wyze-bridge lists it as not supported. Nothing is known about how it is controlled and nothing has been tried on hardware here.",
  },
  ME_DB1: {
    name: "Wyze Battery Video Doorbell",
    source: "SecKatie/ha-wyzeapi issue 973",
    note: "ha-wyzeapi finds its Motion Detection, Notifications, Power and Siren controls but the camera stays unavailable. Nothing has been tried on hardware here.",
  },
  ME_WCO3: {
    name: "Wyze Solar Cam Pan",
    source: "SecKatie/wyzeapy pull request 336 and mrlt8/docker-wyze-bridge issues 1525 and 1545",
    note: "wyzeapy's open pull request reads and controls it through the devicemgmt API, like the Battery Cam Pro. Its live view uses Agora, not the WebRTC stream the plugin uses, so there would be no live view yet. Nothing has been tried on hardware here.",
  },
  MR_BVD: {
    name: "Wyze Battery Video Doorbell (a second model code reported for it)",
    source: "a comment on mrlt8/docker-wyze-bridge issue 1516",
    note: "It may be the same product as ME_DB1 or a variant of it; that is not known. Nothing has been tried on hardware here.",
  },
  // Not a real model code, so nothing ever matches it.
  GUN_SAFE: {
    name: "Wyze Gun Safe",
    source: "the README",
    note: "Coming soon.",
  },
};

function lookup(model) {
  return Object.prototype.hasOwnProperty.call(PLANNED_DEVICES, model) ? PLANNED_DEVICES[model] : null;
}

// The text appended to the "Unsupported device type" line for a known model, or "".
function describe(model) {
  const entry = lookup(model);
  if (!entry) return "";
  return ` - this looks like a ${entry.name}. ${entry.note} Details from ${entry.source}. To help get it supported: ${NEW_DEVICE_FORM}`;
}

module.exports = { PLANNED_DEVICES, lookup, describe, NEW_DEVICE_FORM };
