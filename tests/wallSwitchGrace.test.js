/**
 * A wall switch must hold the tile the user just set until Wyze has had time to apply it, and a
 * device nickname must be cleaned on every refresh, not only when the accessory is created.
 */
const test = require('node:test')
const assert = require('node:assert')

const On = { name: 'On' }
const Name = { name: 'Name' }
require('../src/types').update({
  hap: { Service: {}, Characteristic: { On, Name, Manufacturer: 'M', Model: 'Mo', SerialNumber: 'S' }, uuid: {}, Categories: {} },
  platformAccessory: class {}
})

const WyzeSwitch = require('../src/accessories/WyzeSwitch')
const WyzeAccessory = require('../src/accessories/WyzeAccessory')

function makeSwitch (props) {
  const acc = Object.create(WyzeSwitch.prototype)
  const tile = []
  const characteristic = { updateValue: (v) => { tile.push(v); return characteristic } }
  acc.wallSwitch = { getCharacteristic: () => characteristic, testCharacteristic: () => true, UUID: 'x', updateCharacteristic: () => {} }
  acc.plugin = {
    config: {},
    log: Object.assign(() => {}, { error: () => {} }),
    client: {
      getIotProp: async () => ({ data: { props } }),
      wallSwitchPower: async () => ({}),
      wallSwitchIot: async () => ({})
    }
  }
  acc.homeKitAccessory = { displayName: 'Hall', context: { mac: 'AABBCCDDEEFF', product_type: 'Common', product_model: 'X' } }
  acc.persistState = () => {}
  acc.switch_power = false
  return { acc, tile }
}

test('a poll that lands right after a write does not put the old state back', async () => {
  const { acc, tile } = makeSwitch({ 'switch-power': 0 })
  await acc.handleOnSetWallSwitch(true)
  tile.length = 0

  await acc.updateCharacteristics({ conn_state: 1 })

  assert.strictEqual(acc.switch_power, true)
  assert.ok(!tile.includes(false), 'the tile was not set back to off')
})

test('once the grace window has passed, a poll is applied again', async () => {
  const { acc } = makeSwitch({ 'switch-power': 0 })
  await acc.handleOnSetWallSwitch(true)
  acc._commandGraceUntil = Date.now() - 1

  await acc.updateCharacteristics({ conn_state: 1 })

  assert.strictEqual(acc.switch_power, false)
})

test('a failed write frees the next poll', async () => {
  const { acc } = makeSwitch({ 'switch-power': 0 })
  acc.plugin.client.wallSwitchPower = async () => { throw new Error('nope') }
  await acc.handleOnSetWallSwitch(true)
  await new Promise((resolve) => setImmediate(resolve))

  await acc.updateCharacteristics({ conn_state: 1 })

  assert.strictEqual(acc.switch_power, false)
})

test('the nickname is cleaned on every refresh', async () => {
  const acc = Object.create(WyzeAccessory.prototype)
  const names = []
  const context = {}
  const info = { updateCharacteristic (c, v) { if (c === Name) names.push(v); return info } }
  acc.homeKitAccessory = { context, getService: () => info }
  acc.plugin = { config: {} }
  acc.updateCharacteristics = async () => {}
  acc.lastTimestamp = null
  acc.updating = false
  const device = { mac: 'AABBCCDDEEFF', product_type: 'Common', product_model: 'X', nickname: 'Hall\u0007\nlight' }

  await acc.update(device, 1)

  assert.deepStrictEqual(names, ['Hall light'])
  assert.strictEqual(context.nickname, 'Hall light')
})
