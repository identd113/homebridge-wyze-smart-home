"use strict";

const fs = require("fs");
const path = require("path");

// What the plugin found each camera can have, for the plugin's settings page in the Homebridge UI. The page
// reads this file and offers to save a choice into the config; the plugin never writes the config itself.
//
//   { "version": 1, "cameras": { "<mac>": { name, model, motion, sound, labels: ["person", ...],
//                                           unnamed: [<label numbers with no name here>], at: "<ISO time>" } } }
const FOLDER = "homebridge-wyze-smart-home";
const FILE = "detected-sensors.json";

const filePath = (storagePath) => path.join(storagePath, FOLDER, FILE);
const empty = () => ({ version: 1, cameras: {} });

/** The whole file, or an empty one when it is missing or unreadable. */
function read(storagePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath(storagePath), "utf8"));
    return data && typeof data === "object" && data.cameras && typeof data.cameras === "object" ? data : empty();
  } catch (_) {
    return empty();
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Record what one camera was found to have. Rewrites the file only when that differs from what is there,
 * so a restart that finds the same thing leaves the file (and its `at` time) alone. Never throws: this is a
 * convenience for the settings page and must not get in the way of the camera.
 * @returns {boolean} true when the file was written
 */
function record(storagePath, camera, now = () => new Date()) {
  try {
    const { mac, ...found } = camera;
    const data = read(storagePath);
    const before = { ...(data.cameras[mac] || {}) };
    delete before.at; // when it was written is not part of what was found
    if (data.cameras[mac] && same(before, found)) return false;
    data.cameras[mac] = { ...found, at: now().toISOString() };

    const target = filePath(storagePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, target);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { read, record, filePath, FOLDER, FILE };
