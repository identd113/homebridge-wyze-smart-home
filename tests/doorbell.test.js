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
  camera.acc.stopStreams()
})

function ringer (model) {
  const made = make(model, async () => [])
  made.acc._cameraController = new FakeDoorbellController()
  made.acc._ringedIds = null
  made.acc._watchRing = true
  made.acc._watchMotion = false
  return made
}

test('presses already in the list at startup are history; a later press rings once', () => {
  const { acc, logged } = ringer('HL_DB2')
  acc._onEvents([press('old', 'DOORBELL_RANG', 60000)]) // seeds from the existing list
  assert.strictEqual(acc._cameraController.rings, undefined)
  const events = [press('new', 'DOORBELL_RANG'), press('old', 'DOORBELL_RANG', 60000)]
  acc._onEvents(events)
  acc._onEvents(events)
  assert.strictEqual(acc._cameraController.rings, 1)
  assert.match(logged[0], /doorbell pressed/)
})

test('a press that begins as motion rings when it is flipped to "Doorbell rang"', () => {
  const { acc } = ringer('HL_DB2')
  acc._onEvents([]) // seed (empty)
  acc._onEvents([press('e1', 'MOTION')])
  assert.strictEqual(acc._cameraController.rings, undefined, 'plain motion must not ring')
  acc._onEvents([press('e1', 'DOORBELL_RANG')])
  assert.strictEqual(acc._cameraController.rings, 1)
})

test('ring detection does not depend on the host clock matching Wyze', () => {
  // Wyze timestamps three hours in the past, as if the host clock were far ahead.
  const { acc } = ringer('HL_DB2')
  acc._onEvents([])
  acc._onEvents([press('e1', 'DOORBELL_RANG', 3 * 3600 * 1000)])
  assert.strictEqual(acc._cameraController.rings, 1)
})

test('ids that left the look-back window are forgotten, so the set cannot grow forever', () => {
  const { acc } = ringer('HL_DB2')
  acc._onEvents([press('a', 'DOORBELL_RANG'), press('b', 'DOORBELL_RANG')])
  assert.deepStrictEqual([...acc._ringedIds].sort(), ['a', 'b'])
  acc._onEvents([press('b', 'DOORBELL_RANG')])
  assert.deepStrictEqual([...acc._ringedIds], ['b'])
})

test('the doorbell joins the shared event poll at its own faster rate, and leaves on shutdown', () => {
  const { acc } = make('HL_DB2', async () => [])
  acc.mac = 'AA'
  acc._startEventWatch(true)
  assert.strictEqual(acc._ringTimer, undefined, 'no poll of its own')
  const poller = acc.plugin._motionPoller
  assert.strictEqual(poller.members.length, 1)
  assert.strictEqual(poller.beatMs, 5000)
  acc.stopStreams()
  assert.strictEqual(poller.members.length, 0)
  assert.strictEqual(poller.timer, null)
})

test('a press made while the camera was offline is not announced late once it is back', () => {
  const { acc } = ringer('HL_DB2')
  acc._onEvents([]) // seed
  acc._motionMember = null
  acc.mac = 'AA'
  acc._startEventWatch(true)
  const member = acc.plugin._motionPoller.members[0]
  member.reset() // the poller does this for an offline camera, and the seed is dropped
  acc._cameraController = new FakeDoorbellController()
  member.onEvents([press('during-gap', 'DOORBELL_RANG', 30000)]) // re-seeds from the current list
  assert.strictEqual(acc._cameraController.rings, undefined)
  acc.stopStreams()
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
