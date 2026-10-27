"use strict";

// Wyze devices we have some information about but no accessory for yet. Nothing here
// creates anything in HomeKit: the entry only lets the startup log say what the device is
// and what is missing, instead of a bare "Unsupported device type". Keep this in step with
// the README's "Not Yet Supported" table.
const NEW_DEVICE_FORM = "https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml";

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
  GW_CHI: {
    name: "Wyze Chime (base unit)",
    source: "SecKatie/wyzeapy",
    note: "wyzeapy knows the chime devices, but they have no accessory class here yet.",
  },
  CHIME: {
    name: "Wyze Chime Sensor",
    source: "SecKatie/wyzeapy",
    note: "wyzeapy knows the chime devices, but they have no accessory class here yet.",
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
