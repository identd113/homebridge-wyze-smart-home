/**
 * 0.5.x showed a thermostat's humidity as its own HumiditySensor tile. It must stay, and it
 * must not be added twice when the accessory already has it.
 */
const test = require('node:test')
const assert = require('node:assert')

const HumiditySensor = { UUID: 'humidity' }
require('../src/types').update({
  hap: { Service: { HumiditySensor }, Characteristic: { CurrentRelativeHumidity: 'RH' }, uuid: {}, Categories: {} },
  platformAccessory: class {}
})

const WyzeThermostat = require('../src/accessories/WyzeThermostat')

function make (existing) {
  const acc = Object.create(WyzeThermostat.prototype)
  const added = []
  acc.homeKitAccessory = {
    getService: (type) => (type === HumiditySensor ? existing : undefined),
    addService: (type) => { added.push(type); return { fresh: true } }
  }
  acc.plugin = { config: {} }
  return { acc, added }
}

test('a thermostat without a humidity tile gets one', () => {
  const { acc, added } = make(undefined)
  assert.deepStrictEqual(acc.getHumidityService(), { fresh: true })
  assert.deepStrictEqual(added, [HumiditySensor])
})

test('a humidity tile that already exists is reused, not added again', () => {
  const existing = { cached: true }
  const { acc, added } = make(existing)
  assert.strictEqual(acc.getHumidityService(), existing)
  assert.deepStrictEqual(added, [])
})
