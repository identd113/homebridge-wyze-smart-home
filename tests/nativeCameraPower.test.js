'use strict'

/**
 * HomeKit's own camera power control (the Camera Operating Mode service, HomeKitCameraActive), kept in step with
 * the Privacy switch. 1 means the camera is on; the Privacy switch is on when the camera is off.
 */
const test = require('node:test')
const assert = require('node:assert')

const types = require('../src/types')
const Characteristic = { On: 'On', HomeKitCameraActive: 'HomeKitCameraActive' }
const Service = { Switch: { UUID: 'switch' }, CameraOperatingMode: { UUID: 'operating-mode' } }
types.update({ hap: { Service, Characteristic, uuid: {}, Categories: {} }, platformAccessory: class {} })
const WyzeCamera = require('../src/accessories/WyzeCamera')

function fakeService () {
  const characteristics = {}
  const get = (name) => (characteristics[name] ||= { handlers: {}, updates: [], onGet (f) { this.handlers.get = f; return this }, onSet (f) { this.handlers.set = f; return this }, updateValue (v) { this.updates.push(v) } })
  return { getCharacteristic: get, characteristics }
}

function camera ({ config = {}, existing = null, power = 1, sends = [] } = {}) {
  const acc = Object.create(WyzeCamera.prototype)
  const removed = []
  const added = []
  acc.homeKitAccessory = {
    displayName: 'Garage',
    context: { mac: 'AABBCCDDEEFF', product_model: 'WYZE_CAKP2JFUS' },
    getService: (type) => (type === Service.CameraOperatingMode ? existing : null),
    addService: (type) => { const service = fakeService(); added.push([type, service]); return service },
    removeService: (service) => removed.push(service)
  }
  acc.privacySwitch = fakeService()
  acc.cameraAccessoryAttached = () => false
  acc.power_switch = power
  acc.plugin = {
    config,
    log: Object.assign(() => {}, { error: () => {}, debug: () => {} }),
    client: { cameraPrivacy: async (mac, model, action) => { sends.push(action) } }
  }
  return { acc, added, removed, sends }
}
const active = (acc) => acc.nativePower.getCharacteristic('HomeKitCameraActive')

test('a camera that can be switched off gets the native power service, reading 1 when on and 0 when off', async () => {
  const { acc, added } = camera({ power: 1 })
  acc._setupNativeCameraPower()
  assert.strictEqual(added.length, 1)
  assert.strictEqual(added[0][0], Service.CameraOperatingMode)
  assert.strictEqual(await active(acc).handlers.get(), 1)
  acc.power_switch = 0
  assert.strictEqual(await active(acc).handlers.get(), 0)
  acc.power_switch = undefined
  assert.strictEqual(await active(acc).handlers.get(), 1, 'not known yet counts as on')
})

test('turning the native control off or on powers the camera, and the Privacy switch follows', async () => {
  const { acc, sends } = camera({ power: 1 })
  acc._setupNativeCameraPower()
  await active(acc).handlers.set(0)
  assert.deepStrictEqual(sends, ['power_off'])
  assert.strictEqual(acc.power_switch, 0)
  assert.deepStrictEqual(acc.privacySwitch.getCharacteristic('On').updates, [1], 'Privacy goes on when the camera goes off')
  assert.deepStrictEqual(active(acc).updates, [0])
  await active(acc).handlers.set(1)
  assert.deepStrictEqual(sends, ['power_off', 'power_on'])
  assert.strictEqual(acc.power_switch, 1)
  assert.deepStrictEqual(acc.privacySwitch.getCharacteristic('On').updates, [1, 0])
})

test('the Privacy switch moves the native control too', async () => {
  const { acc, sends } = camera({ power: 1 })
  acc._setupNativeCameraPower()
  await acc.handleOnSetPrivacySwitch(true) // Privacy on: camera off
  assert.deepStrictEqual(sends, ['power_off'])
  assert.deepStrictEqual(active(acc).updates, [0])
  await acc.handleOnSetPrivacySwitch(false)
  assert.deepStrictEqual(active(acc).updates, [0, 1])
})

test('a refusal from Wyze leaves both controls as they were and the error reaches HomeKit', async () => {
  const { acc } = camera({ power: 1 })
  acc.plugin.client.cameraPrivacy = async () => { throw new Error('no') }
  acc._setupNativeCameraPower()
  await assert.rejects(active(acc).handlers.set(0))
  assert.strictEqual(acc.power_switch, 1)
  assert.deepStrictEqual(active(acc).updates, [])
})

test('a power state refreshed from Wyze is shown on the native control, and an unknown one is not', () => {
  const { acc } = camera({ power: 1 })
  acc._setupNativeCameraPower()
  acc._showPower(0)
  acc._showPower('1')
  acc._showPower(undefined)
  acc._showPower(null)
  assert.deepStrictEqual(active(acc).updates, [0, 1])
})

test('nativeCameraPower: false adds nothing, and removes one a cached accessory carries', () => {
  const stale = fakeService()
  const { acc, added, removed } = camera({ config: { nativeCameraPower: false }, existing: stale })
  acc._setupNativeCameraPower()
  assert.strictEqual(acc.nativePower, null)
  assert.strictEqual(added.length, 0)
  assert.deepStrictEqual(removed, [stale])
})

test('an existing native service is reused, not added twice', () => {
  const existing = fakeService()
  const { acc, added } = camera({ existing })
  acc._setupNativeCameraPower()
  assert.strictEqual(acc.nativePower, existing)
  assert.strictEqual(added.length, 0)
})

test('without the Camera Operating Mode service in HAP, the plugin carries on without it', () => {
  const saved = Service.CameraOperatingMode
  delete Service.CameraOperatingMode
  try {
    const { acc } = camera()
    acc._setupNativeCameraPower()
    assert.strictEqual(acc.nativePower, null)
    acc._showPower(0) // must not throw
  } finally {
    Service.CameraOperatingMode = saved
  }
})
