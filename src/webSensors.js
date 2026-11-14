'use strict'

/**
 * The "Detected sensors" list of the camera test page, read-only: what each camera was found to have, and how the
 * config reads for it now. What the plugin found comes from the file it writes at startup (detectedSensors.js); the
 * choices come from config.json, read fresh on every call. The page cannot change them: sensors are chosen on the
 * plugin's settings screen in Homebridge, whose own UI saves the config.
 */

const detectedSensors = require('./detectedSensors')
const view = require('./detectedView')
const { createConfigFile } = require('./configFile')

/**
 * @param {object} opts
 * @param {() => string} opts.configPath
 * @param {string} opts.platformAlias
 * @param {string} [opts.instanceName]
 * @param {() => string} opts.storagePath Homebridge's storage folder, where the plugin notes what it found
 */
function createWebSensors ({ configPath, platformAlias, instanceName, storagePath }) {
  const configFile = createConfigFile({ configPath, platformAlias, instanceName })
  return {
    async describe () {
      const { entry } = configFile.read()
      const detected = detectedSensors.read(storagePath() || '')
      const cameras = view.presentCameras(detected, [entry])
      const names = Object.fromEntries(cameras.map((c) => [c.id, c.name]))
      return { plans: view.planSummary(detected.plans, names), cameras }
    }
  }
}

module.exports = { createWebSensors }
