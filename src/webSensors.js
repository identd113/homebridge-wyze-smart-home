'use strict'

/**
 * The "Detected sensors" panel of the camera test page: what each camera was found to have, and a choice of which
 * sensors to switch on. What the plugin found comes from the file it writes at startup (detectedSensors.js); what is
 * chosen lives in config.json, read fresh on every call and written straight back, so the page, the Homebridge
 * settings screen and anyone editing the JSON agree. Only a camera's own `detections`, `motionSensor` and
 * `soundSensor` can change, and nothing is written unless detectedView's checks pass.
 */

const detectedSensors = require('./detectedSensors')
const view = require('./detectedView')
const { createConfigFile, SettingsError } = require('./configFile')

const describeSetting = (setting) => {
  if (setting === 'auto') return 'Automatic: Person, Vehicle, Pet and Package where the camera has them. Face is never automatic.'
  if (setting === 'none') return 'No detection sensors.'
  return `Chosen: ${setting.join(', ')}.`
}

/**
 * @param {object} opts
 * @param {() => string} opts.configPath
 * @param {string} opts.platformAlias
 * @param {string} [opts.instanceName]
 * @param {() => string} opts.storagePath Homebridge's storage folder, where the plugin notes what it found
 * @param {{info?: Function}} [opts.log]
 */
function createWebSensors ({ configPath, platformAlias, instanceName, storagePath, log = {} }) {
  const configFile = createConfigFile({ configPath, platformAlias, instanceName })
  const found = () => detectedSensors.read(storagePath() || '')

  // The cameras as the config reads now, ready to show.
  function cameras (detected, entry) {
    return view.buildView(detected, [entry]).map((cam) => ({
      id: cam.mac,
      name: cam.name,
      model: cam.model,
      plan: view.planLine(cam.plan),
      planActive: Boolean(cam.plan && cam.plan.state === 'active'),
      setting: describeSetting(cam.setting),
      notAuto: cam.setting !== 'auto' || cam.sensors.some((s) => s.mode !== 'auto'),
      // sensors (Motion, Sound) first, then the labels with a sensor type, then names with no type yet
      items: [
        ...cam.sensors.map((s) => ({ key: s.key, label: s.label, ai: false, checked: s.checked, blocked: s.blocked, warning: s.warning, tag: '', other: false })),
        ...cam.items.map((i) => ({
          key: i.value,
          label: i.label,
          ai: i.ai,
          checked: i.checked,
          blocked: false,
          warning: '',
          tag: i.other ? '' : i.isNew ? (i.auto ? 'new' : 'off by default') : i.checked && !i.found ? 'not seen lately' : '',
          other: i.other
        }))
      ],
      unnamed: cam.unnamed
    }))
  }

  return {
    /** What each camera has and how the config reads, as the file holds it now. */
    async describe () {
      const { entry } = configFile.read()
      const detected = found()
      const list = cameras(detected, entry)
      const names = Object.fromEntries(list.map((c) => [c.id, c.name]))
      return { plans: view.planSummary(detected.plans, names), cameras: list }
    },

    /**
     * Saves one camera's choice. `ticks` maps an item key (a sensor or a label) to on or off; `auto` puts the camera
     * back to automatic. Nothing is saved unless every check passes.
     */
    async save (id, { ticks, auto } = {}) {
      const read = configFile.read()
      const detected = found()
      const mac = typeof id === 'string' ? Object.keys(detected.cameras || {}).find((m) => m === id) : undefined
      if (!mac) throw new SettingsError('that camera is not one the plugin has found')
      const cam = view.buildView(detected, [read.entry]).find((c) => c.mac === mac)

      let values
      let modes
      if (auto) {
        values = []
        modes = { motionSensor: 'auto', soundSensor: 'auto' }
      } else {
        if (!ticks || typeof ticks !== 'object' || Array.isArray(ticks)) throw new SettingsError('no changes given')
        const known = new Set([...cam.items.map((i) => i.value), ...cam.sensors.map((s) => s.key)])
        for (const [key, on] of Object.entries(ticks)) {
          if (!known.has(key)) throw new SettingsError(`${key} is not something this camera shows`)
          if (typeof on !== 'boolean') throw new SettingsError(`${key} must be true or false`)
        }
        for (const item of cam.items) if (ticks[item.value] !== undefined) item.checked = ticks[item.value]
        for (const sensor of cam.sensors) if (ticks[sensor.key] !== undefined) sensor.checked = ticks[sensor.key]
        values = view.detectionsToSave(cam.items)
        modes = view.modesFor(cam.sensors)
      }

      const before = [JSON.parse(JSON.stringify(read.entry))]
      const prepared = view.prepareSave(before, mac, cam.name, values, modes)
      if (!prepared.ok) throw new SettingsError(`Not saved: ${prepared.errors.join('; ')}`)
      // Put the checked entry back in the file, in the same place and order.
      const index = read.parsed.platforms.indexOf(read.entry)
      read.parsed.platforms[index] = prepared.next[0]
      configFile.write(read)
      log.info?.(`[Web] Saved sensors for ${cam.name} to config.json`)
      return { saved: true, restartNeeded: true }
    }
  }
}

module.exports = { createWebSensors }
