/**
 * Models we know about but do not support yet get a helpful startup log line; every other
 * model gets nothing extra. The registry must not shadow a model the plugin already supports.
 */
const test = require('node:test')
const assert = require('node:assert')

const planned = require('../src/plannedDevices')
const enums = require('../src/enums')

test('a known planned model is described, with the form link', () => {
  const text = planned.describe('CO_AP1')
  assert.match(text, /Wyze Air Purifier/)
  assert.ok(text.includes(planned.NEW_DEVICE_FORM))
})

test('an unknown model adds nothing', () => {
  assert.strictEqual(planned.describe('HL_NOT_REAL'), '')
  assert.strictEqual(planned.lookup('toString'), null)
})

test('no planned model is one the plugin already routes to an accessory', () => {
  const supported = new Set()
  for (const group of Object.values(enums)) {
    if (group && typeof group === 'object') for (const v of Object.values(group)) supported.add(v)
  }
  for (const model of Object.keys(planned.PLANNED_DEVICES)) {
    assert.ok(!supported.has(model), `${model} is already supported; remove it from plannedDevices.js`)
  }
})

test('every entry says what it is and where the information came from', () => {
  for (const [model, entry] of Object.entries(planned.PLANNED_DEVICES)) {
    assert.ok(entry.name && entry.source && entry.note, `${model} is missing a field`)
  }
})

test('the startup log line for an unsupported device names a planned model', async () => {
  const WyzeSmartHome = require('../src/WyzeSmartHome')
  const lines = []
  const plugin = Object.create(WyzeSmartHome.prototype)
  plugin.config = { pluginLoggingEnabled: true }
  plugin.log = (m) => lines.push(m)
  plugin._knownUnsupported = new Set()
  plugin.getAccessoryClass = () => null
  const base = { product_type: 'AirPurifier', mac: 'AABBCCDDEEFF', nickname: 'Example Purifier' }
  await plugin.loadDevice({ ...base, product_model: 'CO_AP1' }, Date.now())
  await plugin.loadDevice({ ...base, mac: '112233445566', product_model: 'HL_NOT_REAL' }, Date.now())
  assert.match(lines[0], /Unsupported device type.*CO_AP1.*Wyze Air Purifier/)
  assert.ok(!/looks like/.test(lines[1]))
})
