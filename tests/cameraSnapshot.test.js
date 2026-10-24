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
  delegate._sessions.set('s1', {})
  const r = await snap(delegate)
  assert.strictEqual(calls, 1)
  assert.strictEqual(r.buf.toString(), 'jpg')
})

test('while streaming with no earlier picture the request fails fast instead of opening a second session', async () => {
  let calls = 0
  const { delegate } = make(async () => { calls += 1; return Buffer.from('jpg') })
  delegate._sessions.set('s1', {})
  const r = await snap(delegate)
  assert.ok(r.err)
  assert.strictEqual(calls, 0)
})

test('a stream start waits for a capture that is already in flight', async () => {
  const { delegate, events } = make(async () => { await tick(30); return Buffer.from('jpg') })
  const pending = snap(delegate) // capture begins before the stream is prepared
  await tick(5)
  const sessionID = Buffer.from('s1')
  delegate._sessions.set(sessionID.toString('hex'), { localRtpPort: 1 })
  delegate.handleStreamRequest({ type: 'start', sessionID, video: {} }, () => {})
  await pending
  await tick(20)
  assert.deepStrictEqual(events, ['capture', 'stream'])
})
