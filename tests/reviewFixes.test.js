/**
 * Fixes from the full code review of src/: HMS opt-in surviving resolveSecrets, options kept when a
 * flat config is rewritten, an empty device list not wiping the accessories, and an unread lock.
 */
const test = require('node:test')
const assert = require('node:assert')

// The accessory modules take Service, Characteristic and the homebridge handle from types at load time.
const LockCurrentState = { SECURED: 1, UNSECURED: 0, UNKNOWN: 3 }
const Brightness = 'Brightness'
const ColorTemperature = 'ColorTemperature'
const On = 'On'
require('../src/types').update({
  hap: { Service: {}, Characteristic: { LockCurrentState, Brightness, ColorTemperature, On }, uuid: {}, Categories: {} },
  platformAccessory: class {},
  user: { persistPath: () => require('os').tmpdir() },
  registerPlatform: () => {}
})

const { normalize, toCanonical2x } = require('../src/configMigrator')
const WyzeSmartHome = require('../src/WyzeSmartHome')
const WyzeLock = require('../src/accessories/WyzeLock')
const WyzeLight = require('../src/accessories/WyzeLight')
const { propertyIds: PIDs } = require('wyze-api')
const { Characteristic } = require('../src/types')

const flat = { platform: 'WyzeSmartHome', username: 'a', password: 'b', keyId: 'k', apiKey: 'x' }

function makeApi () {
  const unregistered = []
  return {
    unregistered,
    on: () => {},
    unregisterPlatformAccessories: (...a) => unregistered.push(a),
    hap: {},
    user: { storagePath: () => require('os').tmpdir() }
  }
}

function makePlatform (extra = {}) {
  const log = () => {}
  for (const level of ['debug', 'info', 'warn', 'warning', 'error']) log[level] = () => {}
  const api = makeApi()
  const platform = new WyzeSmartHome(log, { ...flat, name: 'Wyze', ...extra }, api)
  return { platform, api }
}

test('a flat config keeps the lock, thermostat and irrigation options when it is rewritten', () => {
  const kept = {
    fordAppKey: 'fk',
    fordAppSecret: 'fs',
    oliveSigningSecret: 'os',
    oliveAppId: 'oa',
    appInfo: { a: 1 }
  }
  const out = toCanonical2x(normalize({ ...flat, ...kept }), { name: 'Wyze', platform: 'WyzeSmartHome' })
  for (const [k, v] of Object.entries(kept)) assert.deepStrictEqual(out[k], v, k)
})

test('the old irrigationZone map becomes rows on the settings screen, and rows read back as the map the accessory uses', () => {
  const out = toCanonical2x(normalize({ ...flat, irrigationZone: { AABBCCDDEEFF: 3 } }), { name: 'Wyze', platform: 'WyzeSmartHome' })
  assert.deepStrictEqual(out.irrigation, { zones: [{ mac: 'AABBCCDDEEFF', zone: 3 }] })
  assert.strictEqual(out.irrigationZone, undefined, 'the map is not written next to the rows')
  const back = normalize(out)
  assert.deepStrictEqual(back.irrigationZone, { AABBCCDDEEFF: 3 })
  assert.deepStrictEqual(normalize({ ...flat }).irrigation, { zones: [] })
  assert.strictEqual(toCanonical2x(normalize({ ...flat }), { name: 'Wyze' }).irrigation, undefined, 'nothing written when there are no zones')
})

test('hms.enabled still lets the S1 Gateway through after secrets are resolved', async () => {
  for (const [hms, expected] of [[{ enabled: true }, true], [true, true], [undefined, false]]) {
    const { platform } = makePlatform({ hms })
    let built = false
    platform.getAccessoryClass = () => function Fake () { built = true; this.update = async () => {}; this.matches = () => false }
    platform.createHomeKitAccessory = () => ({})
    await platform.loadDevice({ product_type: 'S1Gateway', product_model: 'GW3U', nickname: 'Hub', mac: 'AA' }, 0)
    assert.strictEqual(built, expected, JSON.stringify(hms))
  }
})

test('an empty device list keeps the accessories until it has been empty several times in a row', async () => {
  const { platform, api } = makePlatform()
  const gone = { stopStreams () {}, homeKitAccessory: {} }
  platform.accessories = [gone]
  platform.client = { getObjectList: async () => ({ ts: 1, data: { device_list: [] } }) }
  platform._propertyPoller = { prefetch: async () => {} }

  await platform.refreshDevices()
  await platform.refreshDevices()
  assert.deepStrictEqual(platform.accessories, [gone])
  assert.strictEqual(api.unregistered.length, 0)

  await platform.refreshDevices()
  assert.strictEqual(platform.accessories.length, 0)
  assert.strictEqual(api.unregistered.length, 1)
})

test('a lock that has not been read reports UNKNOWN, not SECURED', async () => {
  const current = (hardlock) => WyzeLock.prototype.getLockCurrentState.call({ hardlock })
  assert.strictEqual(await current(undefined), Characteristic.LockCurrentState.UNKNOWN)
  assert.strictEqual(await current(1), Characteristic.LockCurrentState.SECURED)
  assert.strictEqual(await current(2), Characteristic.LockCurrentState.UNSECURED)
})

test('a bulb that has not synced does not overwrite brightness or colour temperature', async () => {
  const pushed = {}
  const bulb = {
    plugin: { config: {}, log: () => {}, client: { checkBrightnessValue: (v) => v, kelvinToMired: (v) => v, checkColorTemp: (v) => v } },
    inCommandGrace: () => false,
    getService: () => ({ testCharacteristic: () => true, addCharacteristic () {}, getCharacteristic: () => ({ updateValue () {} }) }),
    getCharacteristic: (c) => ({ updateValue: (v) => { pushed[c] = v } }),
    _readPropertyList: async () => ({ data: { property_list: [
      { pid: PIDs.BRIGHTNESS, value: 'undefi' },
      { pid: PIDs.COLOR_TEMP, value: '0' }
    ] } }),
    isValidProperty: WyzeLight.prototype.isValidProperty
  }
  await WyzeLight.prototype.updateCharacteristics.call(bulb, { conn_state: 1, device_params: { switch_state: 1 } })
  assert.ok(!('Brightness' in pushed), 'brightness')
  assert.ok(!('ColorTemperature' in pushed), 'colour temperature')

  bulb._readPropertyList = async () => ({ data: { property_list: [{ pid: PIDs.BRIGHTNESS, value: '80' }] } })
  await WyzeLight.prototype.updateCharacteristics.call(bulb, { conn_state: 1, device_params: { switch_state: 1 } })
  assert.strictEqual(pushed.Brightness, 80)
})
