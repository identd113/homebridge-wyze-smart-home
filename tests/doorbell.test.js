/**
 * A doorbell press rings the HomeKit doorbell exactly once. It only exists in the
 * cloud event list, where it starts as motion and is flipped to "Doorbell rang".
 */
const test = require('node:test')
const assert = require('node:assert')

class FakeCameraController { constructor (o) { this.options = o } }
class FakeDoorbellController extends FakeCameraController { ringDoorbell () { this.rings = (this.rings || 0) + 1 } }
require('../src/types').update({
  hap: {
    Service: {},
    Characteristic: { On: 'On' },
    uuid: {},
    Categories: {},
    CameraController: FakeCameraController,
    DoorbellController: FakeDoorbellController,
    SRTPCryptoSuites: { AES_CM_128_HMAC_SHA1_80: 0 },
    H264Profile: { BASELINE: 0, MAIN: 1 },
    H264Level: { LEVEL3_1: 0, LEVEL4_0: 1 },
    AudioStreamingCodecType: { OPUS: 'OPUS' },
    AudioStreamingSamplerate: { KHZ_16: 16, KHZ_24: 24 }
  },
  platformAccessory: class {}
})

const WyzeCamera = require('../src/accessories/WyzeCamera')

function make (model, getEvents) {
  const acc = Object.create(WyzeCamera.prototype)
  const logged = []
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: model }, displayName: 'Front Doorbell', configureController: () => {} }
  acc.plugin = {
    config: {},
    log: Object.assign((m) => logged.push(m), { debug: () => {}, error: () => {} }),
    client: { cameraIsDoorbell: (m) => m === 'HL_DB2', cameraGetEvents: getEvents }
  }
  return { acc, logged }
}

const press = (id, type, ageMs = 1000) => ({ id, type, time: Date.now() - ageMs, value: type === 'DOORBELL_RANG' ? 10 : 13, tags: [] })

test('a doorbell model gets a DoorbellController, other cameras a CameraController', () => {
  const doorbell = make('HL_DB2', async () => [])
  doorbell.acc._setupCameraController()
  assert.ok(doorbell.acc._cameraController instanceof FakeDoorbellController)
  clearInterval(doorbell.acc._ringTimer)
  const camera = make('WYZE_CAKP2JFUS', async () => [])
  camera.acc._setupCameraController()
  assert.ok(!(camera.acc._cameraController instanceof FakeDoorbellController))
  // A camera without a doorbell only watches for motion; it never rings.
  assert.strictEqual(camera.acc._watchRing, false)
  clearInterval(camera.acc._ringTimer)
  clearInterval(camera.acc._refreshTimer)
})

function ringer (model, getEvents) {
  const made = make(model, getEvents)
  made.acc._cameraController = new FakeDoorbellController()
  made.acc._ringedIds = null
  made.acc._ringFailures = 0
  made.acc._ringSkip = 0
  return made
}

test('presses already in the list at startup are history; a later press rings once', async () => {
  let events = [press('old', 'DOORBELL_RANG', 60000)]
  const { acc, logged } = ringer('HL_DB2', async () => events)
  await acc._checkRing() // seeds from the existing list
  assert.strictEqual(acc._cameraController.rings, undefined)
  events = [press('new', 'DOORBELL_RANG'), press('old', 'DOORBELL_RANG', 60000)]
  await acc._checkRing()
  await acc._checkRing()
  assert.strictEqual(acc._cameraController.rings, 1)
  assert.match(logged[0], /doorbell pressed/)
})

test('a press that begins as motion rings when it is flipped to "Doorbell rang"', async () => {
  let events = []
  const { acc } = ringer('HL_DB2', async () => events)
  await acc._checkRing() // seed (empty)
  events = [press('e1', 'MOTION')]
  await acc._checkRing()
  assert.strictEqual(acc._cameraController.rings, undefined, 'plain motion must not ring')
  events = [press('e1', 'DOORBELL_RANG')]
  await acc._checkRing()
  assert.strictEqual(acc._cameraController.rings, 1)
})

test('ring detection does not depend on the host clock matching Wyze', async () => {
  // Wyze timestamps three hours in the past, as if the host clock were far ahead.
  let events = []
  const { acc } = ringer('HL_DB2', async () => events)
  await acc._checkRing()
  events = [press('e1', 'DOORBELL_RANG', 3 * 3600 * 1000)]
  await acc._checkRing()
  assert.strictEqual(acc._cameraController.rings, 1)
})

test('ids that left the look-back window are forgotten, so the set cannot grow forever', async () => {
  let events = [press('a', 'DOORBELL_RANG'), press('b', 'DOORBELL_RANG')]
  const { acc } = ringer('HL_DB2', async () => events)
  await acc._checkRing()
  assert.deepStrictEqual([...acc._ringedIds].sort(), ['a', 'b'])
  events = [press('b', 'DOORBELL_RANG')]
  await acc._checkRing()
  assert.deepStrictEqual([...acc._ringedIds], ['b'])
})

test('an event-list failure does not throw or ring, backs off, and recovers', async () => {
  let fail = false
  let calls = 0
  const { acc } = ringer('HL_DB2', async () => { calls += 1; if (fail) throw new Error('503'); return [] })
  await acc._checkRing() // seed
  fail = true
  await acc._checkRing()
  assert.strictEqual(acc._ringFailures, 1)
  const afterFirstFailure = calls
  // later ticks are skipped while backing off
  acc._ringSkip = 3
  for (let i = 0; i < 3; i += 1) await acc._checkRing()
  assert.strictEqual(calls, afterFirstFailure, 'no requests while backing off')
  fail = false
  await acc._checkRing()
  assert.strictEqual(acc._ringFailures, 0)
  assert.strictEqual(acc._cameraController.rings, undefined)
})

test('repeated failures lengthen the back-off up to a cap', async () => {
  const { acc } = ringer('HL_DB2', async () => { throw new Error('503') })
  const skips = []
  for (let i = 0; i < 8; i += 1) { acc._ringSkip = 0; await acc._checkRing(); skips.push(acc._ringSkip) }
  assert.deepStrictEqual(skips, [0, 1, 3, 7, 12, 12, 12, 12])
})

test('stopStreams stops the doorbell poll timer', () => {
  const { acc } = make('HL_DB2', async () => [])
  acc._startEventWatch(true)
  assert.ok(acc._ringTimer)
  acc.stopStreams()
  assert.strictEqual(acc._ringTimer, null)
})

test('a press made while the camera was offline is not announced late once it is back', async () => {
  let events = []
  const { acc } = ringer('HL_DB2', async () => events)
  await acc._checkRing() // seed
  acc.cameraOnline = false
  events = [press('during-gap', 'DOORBELL_RANG', 30000)]
  await acc._checkRing() // skipped, and the seed is dropped
  acc.cameraOnline = true
  await acc._checkRing() // re-seeds from the current list
  assert.strictEqual(acc._cameraController.rings, undefined)
})

test('a camera that cannot be powered off gets no Privacy switch, and a leftover one is removed', () => {
  const { acc } = make('HL_DB2', async () => [])
  acc.plugin.client.cameraSupportsPowerControl = (m) => m !== 'HL_DB2'
  const removed = []
  const stale = { stale: true }
  acc.homeKitAccessory.getServiceById = () => stale
  acc.homeKitAccessory.removeService = (s) => removed.push(s)
  acc.privacySwitch = { was: 'set' }
  acc._setupPrivacySwitch()
  assert.strictEqual(acc.privacySwitch, null)
  assert.deepStrictEqual(removed, [stale])
})

test('a camera that can be powered off still gets its Privacy switch', () => {
  const { acc } = make('WYZE_CAKP2JFUS', async () => [])
  acc.plugin.client.cameraSupportsPowerControl = () => true
  let added = 0
  const fakeChar = { onGet () { return this }, onSet () { return this } }
  acc._getOrAddService = () => { added += 1; return { getCharacteristic: () => fakeChar } }
  acc._setupPrivacySwitch()
  assert.strictEqual(added, 1)
  assert.ok(acc.privacySwitch)
})
