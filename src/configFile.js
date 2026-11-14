'use strict'

/**
 * Homebridge's config.json, as the camera test page reads and changes it. Every read goes to the file and every
 * change is written straight back, so the page holds no copy of its own. A write keeps a backup beside the file,
 * goes through a temporary file and an atomic rename, and keeps the file's own indentation and mode.
 */

const fs = require('fs')
const path = require('path')

class SettingsError extends Error {
  constructor (message) { super(message); this.status = 400 }
}

function indentOf (raw) {
  const match = /^([ \t]+)"/m.exec(raw)
  return match ? match[1] : 4
}

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
      try { parsed = JSON.parse(raw) } catch (e) { throw new Error('config.json is not valid JSON, so nothing was changed') }
      if (!parsed || !Array.isArray(parsed.platforms)) throw new Error('config.json has no platforms list')
      const entries = parsed.platforms.filter((p) => p && (p.platform === platformAlias || p.platform === 'WyzeSmartHome'))
      if (!entries.length) throw new Error('this plugin is not in config.json')
      const entry = entries.find((p) => instanceName && p.name === instanceName) || entries[0]
      return { file, raw, parsed, entry }
    },

    /** Writes `parsed` (changed in place from a read) back, with a backup of what was there. */
    write ({ file, raw, parsed }) {
      const text = JSON.stringify(parsed, null, indentOf(raw)) + (raw.endsWith('\n') ? '\n' : '')
      JSON.parse(text) // never write something that does not parse
      const mode = fs.statSync(file).mode & 0o777
      fs.writeFileSync(`${file}.web-settings.bak`, raw, { mode: 0o600 })
      const tmp = path.join(path.dirname(file), `.${path.basename(file)}.wyze-web.tmp`)
      fs.writeFileSync(tmp, text, { mode })
      fs.renameSync(tmp, file)
    }
  }
}

module.exports = { createConfigFile, SettingsError }
