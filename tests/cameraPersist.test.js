/**
 * #311: persisting camera state must never call updatePlatformAccessories(),
 * which breaks the whole Homebridge 2.x accessory cache for external accessories.
 */
const test = require('node:test')
const assert = require('node:assert')

const WyzeCamera = require('../src/accessories/WyzeCamera')
const WyzeAccessory = require('../src/accessories/WyzeAccessory')

function make (Cls) {
  const calls = []
  const acc = Object.create(Cls.prototype)
  acc.homeKitAccessory = { context: {} }
  acc.plugin = { api: { updatePlatformAccessories: (a) => calls.push(a) } }
  return { acc, calls }
}

test('camera persistState keeps state in memory and never flushes the platform cache', () => {
  const { acc, calls } = make(WyzeCamera)
  acc.persistState({ power_switch: 1 })
  acc.persistState({ other: 2 })
  assert.deepStrictEqual(acc.homeKitAccessory.context.lastState, { power_switch: 1, other: 2 })
  assert.strictEqual(calls.length, 0)
})

test('bridged accessories still flush on change (and skip identical state)', () => {
  const { acc, calls } = make(WyzeAccessory)
  acc.persistState({ on: true })
  acc.persistState({ on: true })
  assert.strictEqual(calls.length, 1)
})
