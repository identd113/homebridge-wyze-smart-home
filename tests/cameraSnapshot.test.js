/**
 * A camera serves one WebRTC session at a time: concurrent snapshot requests
 * share one capture, snapshots don't open a session while a live stream runs,
 * and a stream waits for a capture that is already in flight.
 */
const test = require('node:test')
const assert = require('node:assert')

require('../src/types').update({ hap: { StreamRequestTypes: { START: 'start', RECONFIGURE: 'reconfigure', STOP: 'stop' } } })
const Delegate = require('../src/camera/WyzeCameraStreamingDelegate')

function make (capture) {
  const events = []
  const camera = {
    display_name: 'Cam',
    mac: 'AA',
    product_model: 'HL_DB2',
    cameraOnline: true,
    device: { device_params: {} },
    plugin: {
      config: {},
      log: Object.assign(() => {}, { error: () => {}, warn: () => {} }),
      client: {
        getCameraSnapshotImage: async () => { events.push('capture'); return { buffer: await capture() } },
        startCameraHKStream: async () => { events.push('stream'); return { stop () {} } }
      }
    }
  }
  return { delegate: new Delegate(camera), events }
}
const snap = (delegate) => new Promise((resolve) => delegate.handleSnapshotRequest({}, (err, buf) => resolve({ err, buf })))
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

test('concurrent snapshot requests share a single capture', async () => {
  let calls = 0
  const { delegate } = make(async () => { calls += 1; await tick(20); return Buffer.from('jpg') })
  const [a, b, c] = await Promise.all([snap(delegate), snap(delegate), snap(delegate)])
  assert.strictEqual(calls, 1)
  for (const r of [a, b, c]) assert.strictEqual(r.buf.toString(), 'jpg')
})

test('no capture is started while a live stream is active; the last picture is served', async () => {
  let calls = 0
  const { delegate } = make(async () => { calls += 1; return Buffer.from('jpg') })
  await snap(delegate) // one good picture
  delegate._snapshotCache = null // expired
  delegate._sessions.set('s1', { streamHandle: { stop () {} } })
  const r = await snap(delegate)
  assert.strictEqual(calls, 1)
  assert.strictEqual(r.buf.toString(), 'jpg')
})

test('while streaming with no earlier picture the request fails fast instead of opening a second session', async () => {
  let calls = 0
  const { delegate } = make(async () => { calls += 1; return Buffer.from('jpg') })
  delegate._sessions.set('s1', { streamHandle: { stop () {} } })
  const r = await snap(delegate)
  assert.ok(r.err)
  assert.strictEqual(calls, 0)
})

test('a session HomeKit prepared but never started does not block snapshots', async () => {
  let calls = 0
  const { delegate } = make(async () => { calls += 1; return Buffer.from('jpg') })
  delegate._sessions.set('s1', {}) // prepared, no START (or a failed start)
  const r = await snap(delegate)
  assert.strictEqual(calls, 1)
  assert.strictEqual(r.buf.toString(), 'jpg')
})

test('the cloud thumbnail is still served during a live stream (it is plain HTTP)', async () => {
  const axios = require('axios')
  const orig = axios.get
  axios.get = async () => ({ data: Buffer.from('thumb') })
  try {
    let calls = 0
    const { delegate } = make(async () => { calls += 1; return Buffer.from('jpg') })
    delegate.camera.device = { device_params: { camera_thumbnails: [{ url: 'https://example.invalid/t.jpg' }] } }
    delegate._sessions.set('s1', { streamHandle: { stop () {} } })
    const r = await snap(delegate)
    assert.strictEqual(r.buf.toString(), 'thumb')
    assert.strictEqual(calls, 0)
  } finally {
    axios.get = orig
  }
})

test('a quick RECONFIGURE after START keeps only the latest stream and stops the other', async () => {
  const handles = []
  const { delegate } = make(async () => Buffer.from('jpg'))
  delegate.camera.plugin.client.startCameraHKStream = async () => {
    const handle = { stopped: false, stop () { this.stopped = true } }
    handles.push(handle)
    await tick(handles.length === 1 ? 40 : 5) // the first start is slow
    return handle
  }
  const sessionID = Buffer.from('s1')
  delegate._sessions.set(sessionID.toString('hex'), { localRtpPort: 1 })
  delegate.handleStreamRequest({ type: 'start', sessionID, video: {} }, () => {})
  delegate.handleStreamRequest({ type: 'reconfigure', sessionID, video: {} }, () => {})
  await tick(80)
  const session = delegate._sessions.get(sessionID.toString('hex'))
  assert.strictEqual(handles.length, 2)
  assert.strictEqual(handles[0].stopped, true, 'the superseded start must be stopped, not leaked')
  assert.strictEqual(session.streamHandle, handles[1])
  assert.strictEqual(session.starting, false)
})

test('stopAll stops every live stream and forgets the sessions', () => {
  const { delegate } = make(async () => Buffer.from('jpg'))
  const stopped = []
  delegate._sessions.set('a', { streamHandle: { stop: () => stopped.push('a') } })
  delegate._sessions.set('b', { streamHandle: null })
  delegate.stopAll()
  assert.deepStrictEqual(stopped, ['a'])
  assert.strictEqual(delegate._sessions.size, 0)
})

test('a stream start that never settles stops counting as active after a minute', () => {
  const { delegate } = make(async () => Buffer.from('jpg'))
  delegate._sessions.set('s1', { starting: true, startingSince: Date.now() })
  assert.strictEqual(delegate._streamActive(), true)
  delegate._sessions.set('s1', { starting: true, startingSince: Date.now() - 61000 })
  assert.strictEqual(delegate._streamActive(), false)
})
