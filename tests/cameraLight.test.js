/**
 * A Cam v3's floodlight and spotlight settings are one light (property P1056): either
 * switch must follow the camera's state, not only the spotlight one.
 */
const test = require('node:test')
const assert = require('node:assert')

require('../src/types').update({
  hap: { Service: {}, Characteristic: { On: 'On' }, uuid: {}, Categories: {} },
  platformAccessory: class {}
})

const WyzeCamera = require('../src/accessories/WyzeCamera')

function make (config) {
  const acc = Object.create(WyzeCamera.prototype)
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: 'WYZE_CAKP2JFUS' }, displayName: 'Back Yard Cam' }
  acc.plugin = { config }
  const pushed = {}
  const service = (name) => ({ getCharacteristic: () => ({ updateValue: (v) => { pushed[name] = v } }) })
  acc.spotLightService = config.spotLightAccessory ? service('spotlight') : undefined
  acc.floodLightService = config.floodLightAccessory ? service('floodlight') : undefined
  return { acc, pushed }
}

test('a floodlight-only camera tracks the light state', () => {
  const { acc, pushed } = make({ floodLightAccessory: ['AA'] })
  assert.strictEqual(acc._lightConfigured(), true)
  acc._setLightState(1)
  assert.deepStrictEqual(pushed, { floodlight: 1 })
  assert.strictEqual(acc.floodLight, 1)
})

test('a spotlight-only camera tracks the light state', () => {
  const { acc, pushed } = make({ spotLightAccessory: ['AA'] })
  acc._setLightState(0)
  assert.deepStrictEqual(pushed, { spotlight: 0 })
})

test('with both switches, both follow the light', () => {
  const { acc, pushed } = make({ spotLightAccessory: ['AA'], floodLightAccessory: ['AA'] })
  acc._setLightState(1)
  assert.deepStrictEqual(pushed, { spotlight: 1, floodlight: 1 })
})

test('a camera with neither switch has no light to track', () => {
  const { acc } = make({ spotLightAccessory: ['BB'] })
  assert.strictEqual(acc._lightConfigured(), false)
})

function makeDetecting (dongle) {
  const acc = Object.create(WyzeCamera.prototype)
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: 'WYZE_CAKP2JFUS' }, displayName: 'Back Yard Cam' }
  acc.plugin = { config: {} }
  const handlers = []
  const names = []
  acc._getOrAddService = (spec) => {
    handlers.push(spec.subtype)
    names.push(spec.defaultName)
    const characteristic = { onGet: () => characteristic, onSet: () => characteristic }
    return { getCharacteristic: () => characteristic }
  }
  const device = { device_params: { dongle_product_model: dongle } }
  return { acc, device, handlers, names }
}

test('a camera with a floodlight accessory gets the light switch without being listed', () => {
  const { acc, device, handlers, names } = makeDetecting('HL_CFL')
  assert.strictEqual(acc.cameraAccessoryAttached(), false)
  acc._detectFloodlightDongle(device)
  assert.deepStrictEqual(handlers, ['FloodLight'])
  assert.deepStrictEqual(names, ['Floodlight'], 'named for what it does, not after the camera or its room')
  assert.strictEqual(acc.homeKitAccessory.context.floodlightDongle, true)
  assert.strictEqual(acc.cameraAccessoryAttached(), true, 'its properties are read from now on')
  assert.strictEqual(acc._lightConfigured(), true)
})

test('the switch is set up once, and a camera without the accessory gets none', () => {
  const { acc, device, handlers } = makeDetecting('HL_CFL')
  acc._detectFloodlightDongle(device)
  acc._detectFloodlightDongle(device)
  assert.strictEqual(handlers.length, 1)

  for (const dongle of ['', undefined, 'SOMETHING_ELSE']) {
    const none = makeDetecting(dongle)
    none.acc._detectFloodlightDongle(none.device)
    assert.deepStrictEqual(none.handlers, [])
    assert.strictEqual(none.acc.cameraAccessoryAttached(), false)
  }
})

test('a detected floodlight is remembered, so a restart sets the switch up from the cache', () => {
  const { acc } = makeDetecting('')
  acc.homeKitAccessory.context.floodlightDongle = true
  assert.strictEqual(acc._hasFloodlightDongle(), true)
  assert.strictEqual(acc.cameraAccessoryAttached(), true)
})
