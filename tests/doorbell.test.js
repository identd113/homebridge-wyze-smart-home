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
  assert.strictEqual(camera.acc._ringTimer, undefined)
})

test('a press rings once, not again on later polls', async () => {
  let events = [press('e1', 'DOORBELL_RANG')]
  const { acc, logged } = make('HL_DB2', async () => events)
  acc._cameraController = new FakeDoorbellController()
  acc._ringedIds = new Set()
  acc._ringWatchStartedAt = Date.now() - 60000
  await acc._checkRing()
  await acc._checkRing()
  assert.strictEqual(acc._cameraController.rings, 1)
  assert.match(logged[0], /doorbell pressed/)
})

test('a press that begins as motion rings when it is flipped to "Doorbell rang"', async () => {
  let events = [press('e1', 'MOTION')]
  const { acc } = make('HL_DB2', async () => events)
  acc._cameraController = new FakeDoorbellController()
  acc._ringedIds = new Set()
  acc._ringWatchStartedAt = Date.now() - 60000
  await acc._checkRing()
  assert.strictEqual(acc._cameraController.rings, undefined, 'plain motion must not ring')
  events = [press('e1', 'DOORBELL_RANG')]
  await acc._checkRing()
  assert.strictEqual(acc._cameraController.rings, 1)
})

test('presses from before the plugin started, or long ago, do not ring', async () => {
  const { acc } = make('HL_DB2', async () => [press('old', 'DOORBELL_RANG', 60000), press('ancient', 'DOORBELL_RANG', 10 * 60000)])
  acc._cameraController = new FakeDoorbellController()
  acc._ringedIds = new Set()
  acc._ringWatchStartedAt = Date.now() - 1000 // started after both
  await acc._checkRing()
  assert.strictEqual(acc._cameraController.rings, undefined)
})

test('an event-list failure does not throw or ring, and polling continues', async () => {
  let fail = true
  const { acc } = make('HL_DB2', async () => { if (fail) throw new Error('503'); return [press('e1', 'DOORBELL_RANG')] })
  acc._cameraController = new FakeDoorbellController()
  acc._ringedIds = new Set()
  acc._ringWatchStartedAt = Date.now() - 60000
  await acc._checkRing()
  assert.strictEqual(acc._cameraController.rings, undefined)
  fail = false
  await acc._checkRing()
  assert.strictEqual(acc._cameraController.rings, 1)
})

test('stopStreams stops the doorbell poll timer', () => {
  const { acc } = make('HL_DB2', async () => [])
  acc._startRingWatch()
  assert.ok(acc._ringTimer)
  acc.stopStreams()
  assert.strictEqual(acc._ringTimer, null)
})
