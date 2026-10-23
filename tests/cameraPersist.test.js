/**
 * #311: persisting camera state must never call updatePlatformAccessories(),
 * which breaks the whole Homebridge 2.x accessory cache for external accessories.
 */
const test = require('node:test')
const assert = require('node:assert')

// Accessory modules destructure Service/Characteristic from types at load time.
require('../src/types').update({ hap: { Service: {}, Characteristic: { On: 'On' }, uuid: {}, Categories: {} }, platformAccessory: class {} })

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

test('devicemgmt cameras refresh state through cameraGetDeviceMgmtState, not getDevicePID', async () => {
  const acc = Object.create(WyzeCamera.prototype)
  const updates = []
  const svc = (name) => ({ getCharacteristic: () => ({ updateValue: (v) => updates.push([name, v]) }) })
  acc.mac = 'AA'
  acc.product_model = 'HL_PAN4'
  acc.display_name = 'Pan'
  acc.homeKitAccessory = { context: {} }
  acc.privacySwitch = svc('privacy')
  acc.spotLightService = svc('spot')
  acc.sirenSwitch = svc('siren')
  acc._isInConfig = () => true
  let flushed = 0
  acc.plugin = {
    config: {},
    log: Object.assign(() => {}, { error: () => {} }),
    api: { updatePlatformAccessories: () => { flushed += 1 } },
    client: {
      cameraUsesDeviceMgmt: (m) => m === 'HL_PAN4',
      getDevicePID: async () => { throw new Error('must not be called') },
      cameraGetDeviceMgmtState: async () => ({ on: true, floodlight: true, siren: false })
    }
  }
  await acc._refreshFromDeviceMgmt()
  assert.deepStrictEqual(updates, [['privacy', 1], ['siren', 0], ['spot', 1]])
  assert.strictEqual(acc.floodLight, 1)
  assert.strictEqual(flushed, 0) // camera state stays out of the platform cache
})
