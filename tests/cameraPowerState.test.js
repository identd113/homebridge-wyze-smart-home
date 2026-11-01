'use strict'

/**
 * A camera with an attached accessory (spotlight, siren, notifications, ...) gets its power from the property list
 * (P3), not from the device list. The camera-off picture and the snapshot skips read `power_switch`, so P3 must
 * keep it current: it used to stay undefined, or stuck at 0 after the camera was turned back on in the Wyze app.
 */
const test = require('node:test')
const assert = require('node:assert')

require('../src/types').update({
  hap: { Service: {}, Characteristic: { On: 'On' }, uuid: {}, Categories: {} },
  platformAccessory: class {}
})
const WyzeCamera = require('../src/accessories/WyzeCamera')

function propertyCamera (readRows) {
  const acc = Object.create(WyzeCamera.prototype)
  acc.homeKitAccessory = { displayName: 'Garage', context: { mac: 'AABBCCDDEEFF', product_model: 'WYZE_CAKP2JFUS' } }
  acc.privacySwitch = { getCharacteristic: () => ({ updateValue () {} }) }
  acc._markServicesOnline = () => {}
  acc.cameraAccessoryAttached = () => true
  acc._readPropertyList = readRows
  acc.plugin = {
    config: {},
    log: Object.assign(() => {}, { error: () => {}, debug: () => {} }),
    client: { cameraIsOnline: () => true, cameraUsesDeviceMgmt: () => false }
  }
  return acc
}

const rows = (value) => async () => ({ data: { property_list: [{ pid: 'P3', value }] } })

test('P3 sets power_switch on a camera that has an attached accessory', async () => {
  const off = propertyCamera(rows('0'))
  await off.updateCharacteristics({ device_params: {} })
  assert.strictEqual(off.power_switch, 0, 'switched off in the Wyze app: the camera-off picture can show')

  const on = propertyCamera(rows('1'))
  await on.updateCharacteristics({ device_params: {} })
  assert.strictEqual(on.power_switch, 1)
})

test('turning the camera back on in the Wyze app clears the off state HomeKit set', async () => {
  const acc = propertyCamera(rows('1'))
  acc.power_switch = 0 // Privacy was turned on in HomeKit
  await acc.updateCharacteristics({ device_params: {} })
  assert.strictEqual(acc.power_switch, 1, 'it must not stay at 0 and show the placeholder forever')
})

test('a power value that is not 0 or 1 leaves power_switch as it was', async () => {
  const acc = propertyCamera(rows(''))
  acc.power_switch = 1
  await acc.updateCharacteristics({ device_params: {} })
  assert.strictEqual(acc.power_switch, 1)
})
