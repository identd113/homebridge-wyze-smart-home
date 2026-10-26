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
