/**
 * Fixes from the full code review of src/: HMS opt-in surviving resolveSecrets, options kept when a
 * flat config is rewritten, an empty device list not wiping the accessories, and an unread lock.
 */
const test = require('node:test')
const assert = require('node:assert')

// The accessory modules take Service, Characteristic and the homebridge handle from types at load time.
const LockCurrentState = { SECURED: 1, UNSECURED: 0, UNKNOWN: 3 }
require('../src/types').update({
  hap: { Service: {}, Characteristic: { LockCurrentState }, uuid: {}, Categories: {} },
  platformAccessory: class {},
  user: { persistPath: () => require('os').tmpdir() },
  registerPlatform: () => {}
})

const { normalize, toCanonical2x } = require('../src/configMigrator')
const WyzeSmartHome = require('../src/WyzeSmartHome')
const WyzeLock = require('../src/accessories/WyzeLock')
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
    irrigationZone: { AABBCCDDEEFF: 3 },
    fordAppKey: 'fk',
    fordAppSecret: 'fs',
    oliveSigningSecret: 'os',
    oliveAppId: 'oa',
    appInfo: { a: 1 }
  }
  const out = toCanonical2x(normalize({ ...flat, ...kept }), { name: 'Wyze', platform: 'WyzeSmartHome' })
  for (const [k, v] of Object.entries(kept)) assert.deepStrictEqual(out[k], v, k)
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
