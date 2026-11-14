'use strict'

/**
 * Homebridge's config.json, as the camera test page reads it. Every read goes to the file, so the page holds no copy
 * of its own. The page never writes it: changes go through the plugin's settings screen in Homebridge, whose own UI
 * does the saving.
 */

const fs = require('fs')

/**
 * @param {object} opts
 * @param {() => string} opts.configPath Homebridge's config.json
 * @param {string} opts.platformAlias the platform name in config.json
 * @param {string} [opts.instanceName] picks the entry when there are several
 */
function createConfigFile ({ configPath, platformAlias, instanceName }) {
  return {
    /** The parsed file and this plugin's entry in it. Throws a plain message when it cannot. */
    read () {
      const file = configPath()
      if (!file) throw new Error('Homebridge did not say where its config.json is')
      let raw
      try { raw = fs.readFileSync(file, 'utf8') } catch (e) { throw new Error(`could not read config.json (${e.code || e.message})`) }
      let parsed
      try { parsed = JSON.parse(raw) } catch (e) { throw new Error('config.json is not valid JSON') }
      if (!parsed || !Array.isArray(parsed.platforms)) throw new Error('config.json has no platforms list')
      const entries = parsed.platforms.filter((p) => p && (p.platform === platformAlias || p.platform === 'WyzeSmartHome'))
      if (!entries.length) throw new Error('this plugin is not in config.json')
      const entry = entries.find((p) => instanceName && p.name === instanceName) || entries[0]
      return { file, raw, parsed, entry }
    }
  }
}

module.exports = { createConfigFile }
