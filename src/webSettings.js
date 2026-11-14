'use strict'

/**
 * The plugin's Advanced options as the camera test page shows them, read-only. Homebridge's config.json is the one
 * place they live: every read goes to the file, so this page, the Homebridge settings screen and anyone editing the
 * JSON always agree. The page cannot change them. A change is made on the plugin's settings screen in Homebridge,
 * whose own UI saves it.
 *
 * Only the options named in FIELDS are shown. Credentials, the base URLs and everything else in the file never leave
 * this module. Types, ranges and descriptions come from config.schema.json, so there is one definition of each option.
 * Most options are read when Homebridge starts, so each field shows what the file holds next to what the plugin is
 * running now.
 */

const fs = require('fs')
const path = require('path')
const { createConfigFile } = require('./configFile')

const FIELDS = ['snapshotRefreshSeconds', 'snapshotOnMotion', 'sensorHoldSeconds', 'warmLiveView', 'webServerPort']

const schema = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../config.schema.json'), 'utf8')).schema.properties.advanced.properties

/**
 * @param {object} opts
 * @param {() => string} opts.configPath Homebridge's config.json
 * @param {string} opts.platformAlias the platform name in config.json
 * @param {string} [opts.instanceName] picks the entry when there are several
 * @param {() => object} opts.running the plugin's config as it is running now
 */
function createWebSettings ({ configPath, platformAlias, instanceName, running }) {
  const configFile = createConfigFile({ configPath, platformAlias, instanceName })

  const runningValue = (key) => {
    const config = running() || {}
    return config.advanced && config.advanced[key] !== undefined ? config.advanced[key] : config[key]
  }

  return {
    /** The fields with the value the file holds now and the value the plugin is running. */
    async describe () {
      const { entry, file } = configFile.read()
      const properties = schema()
      const same = (a, b) => (a === undefined && b === undefined) || a === b
      return {
        file: path.basename(file),
        fields: FIELDS.map((key) => {
          const property = properties[key]
          const saved = entry.advanced ? entry.advanced[key] : undefined
          const live = runningValue(key)
          return {
            key,
            title: property.title,
            type: property.type === 'boolean' ? 'boolean' : 'integer',
            description: property.description,
            default: property.default,
            minimum: property.minimum,
            maximum: property.maximum,
            value: saved === undefined ? null : saved,
            running: live === undefined ? null : live,
            pending: !same(saved, live)
          }
        })
      }
    }
  }
}

module.exports = { createWebSettings, FIELDS }
