/**
 * The optional camera Motion Sensor follows new events from the shared event poller: on at a new
 * event, held while more arrive, off after the hold time, and absent unless asked for.
 */
const test = require('node:test')
const assert = require('node:assert')

const MotionDetected = { name: 'MotionDetected' }
require('../src/types').update({
  hap: { Service: {}, Characteristic: { MotionDetected, Name: { name: 'Name' } }, uuid: {}, Categories: {} },
  platformAccessory: class {}
})

const WyzeCamera = require('../src/accessories/WyzeCamera')

function makeCamera (config = {}) {
  const acc = Object.create(WyzeCamera.prototype)
  const updates = []
  acc.plugin = { config, log: Object.assign(() => {}, { debug: () => {} }) }
  acc.homeKitAccessory = { displayName: 'Example Camera', context: { mac: 'AABBCCDDEEFF', product_type: 'Camera', product_model: 'WYZE_CAKP2JFUS' } }
  acc.motionSensorEnabled = true
  acc._motionActive = false
  acc.motionSensorService = { getCharacteristic: () => ({ updateValue: (v) => updates.push(v) }) }
  acc.refreshes = 0
  acc._streamingDelegate = { refreshSnapshot: () => { acc.refreshes += 1 } }
  acc.updates = updates
  return acc
}

test('the first poll only records what is already there', () => {
  const cam = makeCamera()
  cam._checkMotion([{ id: 'a' }])
  assert.deepStrictEqual(cam.updates, [])
  assert.strictEqual(cam._motionActive, false)
})

test('a new event turns the sensor on once, even if several arrive', () => {
  const cam = makeCamera()
  cam._checkMotion([{ id: 'a' }])
  cam._checkMotion([{ id: 'b' }, { id: 'a' }])
  cam._checkMotion([{ id: 'c' }, { id: 'b' }, { id: 'a' }])
  assert.deepStrictEqual(cam.updates, [true])
  cam._setMotionActive(false)
  assert.deepStrictEqual(cam.updates, [true, false])
})

test('with the option off, nothing is switched', () => {
  const cam = makeCamera()
  cam.motionSensorEnabled = false
  cam._checkMotion([{ id: 'a' }])
  cam._checkMotion([{ id: 'b' }, { id: 'a' }])
  assert.deepStrictEqual(cam.updates, [])
})

test('the picture still refreshes on motion unless snapshotOnMotion is off', () => {
  const on = makeCamera()
  on._checkMotion([{ id: 'a' }]); on._checkMotion([{ id: 'b' }, { id: 'a' }])
  assert.strictEqual(on.refreshes, 1)
  const off = makeCamera({ snapshotOnMotion: false })
  off._checkMotion([{ id: 'a' }]); off._checkMotion([{ id: 'b' }, { id: 'a' }])
  assert.strictEqual(off.refreshes, 0)
  assert.deepStrictEqual(off.updates, [true])
  clearTimeout(on._motionTimer); clearTimeout(off._motionTimer)
})

test('the sensor is watched for even when pictures on motion are off', () => {
  const cam = makeCamera({ snapshotOnMotion: false })
  cam.cameraOnline = true
  const added = []
  cam.plugin._motionPoller = { add: (m) => added.push(m) }
  cam._startEventWatch(false)
  assert.strictEqual(added.length, 1)
})

test('the config migrator carries motionSensor and mirrors it to the legacy list', () => {
  const { normalize } = require('../src/configMigrator')
  const cfg = normalize({
    platform: 'WyzeSmartHome', username: 'user@example.com', password: 'x', keyId: 'k', apiKey: 'a',
    cameras: [{ mac: 'AABBCCDDEEFF', motionSensor: true }]
  })
  assert.deepStrictEqual(cfg.motionSensorAccessory, ['AABBCCDDEEFF'])
})
