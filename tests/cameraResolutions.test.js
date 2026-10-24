/**
 * The stream is passed to HomeKit unscaled, so the advertised sizes must match
 * the camera: the Doorbell v2 sends 640x480 (4:3), the other cameras 16:9.
 */
const test = require('node:test')
const assert = require('node:assert')

class FakeController { constructor (options) { this.options = options } }
require('../src/types').update({
  hap: {
    Service: {},
    Characteristic: { On: 'On' },
    uuid: {},
    Categories: {},
    CameraController: FakeController,
    SRTPCryptoSuites: { AES_CM_128_HMAC_SHA1_80: 0 },
    H264Profile: { BASELINE: 0, MAIN: 1 },
    H264Level: { LEVEL3_1: 0, LEVEL4_0: 1 },
    AudioStreamingCodecType: { OPUS: 'OPUS' },
    AudioStreamingSamplerate: { KHZ_16: 16, KHZ_24: 24 }
  },
  platformAccessory: class {}
})

const WyzeCamera = require('../src/accessories/WyzeCamera')

function resolutionsFor (model) {
  const acc = Object.create(WyzeCamera.prototype)
  let controller
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: model }, displayName: 'Cam', configureController: (c) => { controller = c } }
  acc.plugin = { config: {}, log: () => {} }
  acc._setupCameraController()
  return controller.options.streamingOptions.video.resolutions
}

test('the Doorbell v2 advertises only its native 640x480 (4:3) stream', () => {
  assert.deepStrictEqual(resolutionsFor('HL_DB2'), [[640, 480, 15]])
})

test('other cameras keep the default 16:9 sizes', () => {
  const sizes = resolutionsFor('WYZE_CAKP2JFUS')
  assert.deepStrictEqual(sizes[0], [1920, 1080, 30])
  assert.ok(sizes.length > 1)
})
