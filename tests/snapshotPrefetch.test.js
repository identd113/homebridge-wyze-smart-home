/**
 * At startup each camera fetches one picture ahead of time so the first Home app request
 * is answered from the cache. Cameras are fetched one at a time, and a camera that is
 * offline, switched off or already streaming is skipped.
 */
const test = require('node:test')
const assert = require('node:assert')

require('../src/types').update({ hap: { StreamRequestTypes: { START: 'start', RECONFIGURE: 'reconfigure', STOP: 'stop' } } })
const Delegate = require('../src/camera/WyzeCameraStreamingDelegate')

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

function make (name, capture, extra = {}) {
  const logs = []
  const camera = {
    display_name: name,
    mac: name,
    product_model: 'WYZE_CAKP2JFUS',
    cameraOnline: true,
    power_switch: 1,
    device: { device_params: {} },
    plugin: {
      config: {},
      log: Object.assign((m) => logs.push(m), { error: () => {}, warn: (m) => logs.push(`WARN ${m}`), debug: () => {} }),
      client: { getCameraSnapshotImage: async () => ({ buffer: await capture() }) }
    },
    ...extra
  }
  return { delegate: new Delegate(camera), logs }
}
const request = (delegate) => new Promise((resolve) => delegate.handleSnapshotRequest({}, (err, buf) => resolve({ err, buf })))

test('a prefetched picture answers the first request without another capture', async () => {
  let calls = 0
  const { delegate, logs } = make('Garage', async () => { calls += 1; return Buffer.from('jpg') })
  await delegate.prefetchSnapshot()
  assert.strictEqual(calls, 1)
  const r = await request(delegate)
  assert.strictEqual(r.buf.toString(), 'jpg')
  assert.strictEqual(calls, 1, 'served from the cache')
  assert.ok(logs.some((l) => /Startup picture ready for Garage/.test(l)))
  assert.ok(delegate._snapshotCache.expiresAt - Date.now() > 30_000, 'kept fresh longer than a normal snapshot')
})

test('cameras are prefetched one at a time', async () => {
  let running = 0
  let maxRunning = 0
  const capture = async () => { running += 1; maxRunning = Math.max(maxRunning, running); await tick(15); running -= 1; return Buffer.from('x') }
  const a = make('A', capture)
  const b = make('B', capture)
  const c = make('C', capture)
  await Promise.all([a.delegate.prefetchSnapshot(), b.delegate.prefetchSnapshot(), c.delegate.prefetchSnapshot()])
  assert.strictEqual(maxRunning, 1)
})

test('offline, switched-off and already-streaming cameras are skipped', async () => {
  let calls = 0
  const capture = async () => { calls += 1; return Buffer.from('x') }
  await make('Off', capture, { cameraOnline: false }).delegate.prefetchSnapshot()
  await make('Power', capture, { power_switch: 0 }).delegate.prefetchSnapshot()
  const streaming = make('Live', capture)
  streaming.delegate._streamActive = () => true
  await streaming.delegate.prefetchSnapshot()
  assert.strictEqual(calls, 0)
})

test('a failed prefetch is logged, never thrown, and does not block the next camera', async () => {
  const bad = make('Bad', async () => { throw new Error('boom') })
  const good = make('Good', async () => Buffer.from('ok'))
  await bad.delegate.prefetchSnapshot()
  await good.delegate.prefetchSnapshot()
  assert.ok(bad.logs.some((l) => /Startup picture failed for Bad: boom/.test(l)))
  assert.ok(good.logs.some((l) => /Startup picture ready for Good/.test(l)))
})
