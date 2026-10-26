/**
 * "Quick Live View": while the Home app is looking at a camera, a connection to it is opened
 * ahead of time, so a live view starts almost at once and pictures come from the connection.
 */
const test = require('node:test')
const assert = require('node:assert')

require('../src/types').update({ hap: { StreamRequestTypes: { START: 'start', RECONFIGURE: 'reconfigure', STOP: 'stop' } } })
const Delegate = require('../src/camera/WyzeCameraStreamingDelegate')

function make ({ enabled = true, state = null, shot = null, extra = {}, captures = [] } = {}) {
  const calls = { warmUp: [], warmDown: [], warmSnapshot: 0, capture: 0 }
  let currentState = state
  let opening = null
  const client = {
    cameraWarmUp: (mac, model, opts) => {
      calls.warmUp.push([mac, model, opts])
      if (!currentState) currentState = 'connecting'
      opening = Promise.resolve(true).then(() => { currentState = 'ready'; return true })
      return opening
    },
    cameraWarmState: () => currentState,
    cameraWarmSnapshot: async () => { calls.warmSnapshot += 1; return shot ? { buffer: shot, ageMs: 100 } : null },
    cameraWarmDown: (mac) => { calls.warmDown.push(mac); currentState = null },
    getCameraSnapshotImage: async () => { calls.capture += 1; return { buffer: Buffer.from('captured') } }
  }
  const camera = {
    display_name: 'Garage', mac: 'MAC1', product_model: 'WYZE_CAKP2JFUS', cameraOnline: true, power_switch: 1,
    device: { device_params: {} },
    plugin: { config: enabled ? { warmLiveView: true } : {}, log: Object.assign(() => {}, { error () {}, warn () {}, debug () {} }), client },
    ...extra
  }
  const d = new Delegate(camera)
  const request = () => new Promise((resolve) => d.handleSnapshotRequest({}, (err, buf) => resolve({ err, buf })))
  return { d, calls, request, setState: (s) => { currentState = s } }
}

test('with the setting off, a picture request opens nothing', async () => {
  const { d, calls, request } = make({ enabled: false })
  d._lastSnapshot = Buffer.from('old')
  await request()
  assert.strictEqual(calls.warmUp.length, 0)
})

test('a picture request opens a connection for the camera, for 45 seconds', async () => {
  const { d, calls, request } = make({ shot: Buffer.from('from-connection') })
  d._lastSnapshot = Buffer.from('old')
  const r = await request()
  assert.deepStrictEqual(calls.warmUp[0].slice(0, 2), ['MAC1', 'WYZE_CAKP2JFUS'])
  assert.strictEqual(calls.warmUp[0][2].ttlMs, 45_000)
  assert.strictEqual(calls.warmUp[0][2].label, 'Garage')
  assert.ok(r.buf, 'and the request itself is answered')
})

test('every request renews the connection, but only the first one is a new opening', async () => {
  const { d, calls, request } = make({ shot: Buffer.from('p') })
  d._lastSnapshot = Buffer.from('old')
  await request()
  d._snapshotCache = null
  await request()
  assert.strictEqual(calls.warmUp.length, 2, 'both renew the connection')
})

test('nothing is opened for a camera that is off, offline or already streaming', async () => {
  for (const extra of [{ power_switch: 0 }, { cameraOnline: false }]) {
    const { d, calls, request } = make({ extra })
    d._lastSnapshot = Buffer.from('old')
    await request()
    assert.strictEqual(calls.warmUp.length, 0)
  }
  const live = make()
  live.d._streamActive = () => true
  live.d._lastSnapshot = Buffer.from('old')
  await live.request()
  assert.strictEqual(live.calls.warmUp.length, 0)
})

test('while a connection is open, pictures come from it and are never older than 10 seconds', async () => {
  const { d, calls, request } = make({ state: 'ready', shot: Buffer.from('fresh') })
  d._snapshotCache = { buffer: Buffer.from('stale'), at: Date.now() - 30_000, expiresAt: Date.now() + 30_000 }
  const r = await request()
  assert.strictEqual(r.buf.toString(), 'fresh')
  assert.strictEqual(calls.warmSnapshot, 1)
  assert.strictEqual(calls.capture, 0, 'no new session was opened on the camera')
  const again = await request()
  assert.strictEqual(again.buf.toString(), 'fresh')
  assert.strictEqual(calls.warmSnapshot, 1, 'served from the cache for the next few seconds')
})

test('without an open connection the regular cache rule is unchanged', async () => {
  const { d, calls, request } = make({ enabled: false })
  d._snapshotCache = { buffer: Buffer.from('cached'), at: Date.now() - 30_000, expiresAt: Date.now() + 30_000 }
  assert.strictEqual((await request()).buf.toString(), 'cached')
  assert.strictEqual(calls.warmSnapshot, 0)
})

test('while a connection is still being made, the last picture is shown and no session is opened', async () => {
  const { d, calls, request } = make({ state: 'connecting', shot: null })
  d._lastSnapshot = Buffer.from('last')
  const r = await request()
  assert.strictEqual(r.buf.toString(), 'last')
  assert.strictEqual(calls.capture, 0)
})

test('with no earlier picture, the request waits for the connection and uses its picture', async () => {
  const { d, calls, request } = make({ shot: Buffer.from('first-picture') })
  const r = await request()
  assert.strictEqual(r.err, undefined)
  assert.strictEqual(r.buf.toString(), 'first-picture')
  assert.strictEqual(calls.capture, 0)
})

test('closing the plugin closes the open connection', () => {
  const { d, calls } = make({ state: 'ready' })
  d.stopAll()
  assert.deepStrictEqual(calls.warmDown, ['MAC1'])
})

test('preparing a stream does not fetch connection details when a connection is already open', async () => {
  const { d, calls } = make({ state: 'ready' })
  const asked = []
  d.camera.plugin.client.prefetchCameraConnection = (...a) => asked.push(a)
  d.camera.plugin.client.prepareCameraHKStream = async () => ({ localRtpPort: 1, localAudioRtpPort: 2, videoSsrc: 3, audioSsrc: 4, localAddress: '127.0.0.1' })
  const request = { sessionID: Buffer.from('aa'), targetAddress: '127.0.0.1', video: { port: 5000, srtp_key: Buffer.alloc(16), srtp_salt: Buffer.alloc(14) }, audio: { port: 5002, srtp_key: Buffer.alloc(16), srtp_salt: Buffer.alloc(14) } }
  await new Promise((resolve) => d.prepareStream(request, () => resolve()))
  assert.strictEqual(asked.length, 0)
  assert.strictEqual(calls.warmUp.length, 0)
})

test('a battery camera never gets Quick Live View', async () => {
  for (const model of ['WVOD1', 'HL_WCO2', 'AN_RSCW']) {
    const { d, calls, request } = make({ extra: { product_model: model } })
    d._lastSnapshot = Buffer.from('old')
    await request()
    assert.strictEqual(calls.warmUp.length, 0, model)
  }
})
