'use strict'

/**
 * The settings the camera test page can show and change. Homebridge's config.json is the one place they live:
 * every read goes to the file, and every change is written straight back to it, so this page, the Homebridge
 * settings screen and anyone editing the JSON always agree. The page holds no copy of its own.
 *
 * Only the options named in FIELDS can be read or written. Credentials, the base URLs and everything else in the
 * file never leave this module. Types, ranges and descriptions come from config.schema.json, so there is one
 * definition of each option.
 *
 * A change is validated, then written with a backup beside the file and an atomic rename, keeping the file's own
 * indentation. Most options are read when Homebridge starts, so a saved change applies after a restart; each
 * field says what the plugin is running now next to what the file holds.
 */

const fs = require('fs')
const path = require('path')
const { createConfigFile, SettingsError } = require('./configFile')

// The options that can be changed from the page, in the order shown. Not here, on purpose: credentials, the custom
// base URLs and device type overrides, which can break the plugin or send a login somewhere else.
const FIELDS = ['snapshotRefreshSeconds', 'snapshotOnMotion', 'sensorHoldSeconds', 'warmLiveView', 'webServerPort']

const schema = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../config.schema.json'), 'utf8')).schema.properties.advanced.properties

// The port rule of the page itself: 0 is off, 1 to 1023 need root.
function portProblem (value) {
  if (value >= 1 && value <= 1023) return `${value} is below 1024, which needs root; use 1024 or higher, or 0 to turn the page off`
  return null
}

function problemWith (key, property, value) {
  if (property.type === 'boolean') return typeof value === 'boolean' ? null : 'must be true or false'
  if (!Number.isInteger(value)) return 'must be a whole number'
  if (property.minimum !== undefined && value < property.minimum) return `must be at least ${property.minimum}`
  if (property.maximum !== undefined && value > property.maximum) return `must be at most ${property.maximum}`
  if (key === 'webServerPort') return portProblem(value)
  return null
}

/**
 * @param {object} opts
 * @param {() => string} opts.configPath Homebridge's config.json
 * @param {string} opts.platformAlias the platform name in config.json
 * @param {string} [opts.instanceName] picks the entry when there are several
 * @param {() => object} opts.running the plugin's config as it is running now
 * @param {{info?: Function, warn?: Function}} [opts.log]
 */
function createWebSettings ({ configPath, platformAlias, instanceName, running, log = {} }) {
  const configFile = createConfigFile({ configPath, platformAlias, instanceName })
  const readFile = () => configFile.read()

  const runningValue = (key) => {
    const config = running() || {}
    return config.advanced && config.advanced[key] !== undefined ? config.advanced[key] : config[key]
  }

  return {
    /** The fields with the value the file holds now and the value the plugin is running. */
    async describe () {
      const { entry, file } = readFile()
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
    },

    /**
     * Writes changes to config.json. `changes` maps an option to its new value; null or '' removes the option, so the
     * default applies. Nothing is written unless every change is valid.
     */
    async save (changes) {
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw new SettingsError('no changes given')
      const properties = schema()
      const wanted = {}
      for (const [key, value] of Object.entries(changes)) {
        if (!FIELDS.includes(key)) throw new SettingsError(`${key} cannot be changed here`)
        if (value === null || value === '') { wanted[key] = null; continue }
        const problem = problemWith(key, properties[key], value)
        if (problem) throw new SettingsError(`${properties[key].title} ${problem}`)
        wanted[key] = value
      }

      const { file, raw, parsed, entry } = readFile()
      entry.advanced = entry.advanced && typeof entry.advanced === 'object' ? entry.advanced : {}
      for (const [key, value] of Object.entries(wanted)) {
        if (value === null) delete entry.advanced[key]
        else entry.advanced[key] = value
      }
      if (!Object.keys(entry.advanced).length) delete entry.advanced

      configFile.write({ file, raw, parsed })
      for (const [key, value] of Object.entries(wanted)) log.info?.(`[Web] Saved advanced.${key} ${value === null ? 'removed (default)' : `= ${value}`} to config.json`)
      return { saved: wanted, restartNeeded: true }
    }
  }
}

module.exports = { createWebSettings, FIELDS, SettingsError }
