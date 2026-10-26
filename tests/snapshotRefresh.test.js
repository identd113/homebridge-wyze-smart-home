/**
 * Each camera's picture is refreshed on a timer (default every 30 s) and again when the
 * cloud event list shows new motion, so the Home app always has a recent image.
 */
const test = require('node:test')
const assert = require('node:assert')

class FakeCameraController { constructor (o) { this.options = o } }
require('../src/types').update({
  hap: {
    Service: {},
    Characteristic: { On: 'On' },
    uuid: {},
    Categories: {},
    CameraController: FakeCameraController,
    DoorbellController: FakeCameraController,
    StreamRequestTypes: { START: 'start', RECONFIGURE: 'reconfigure', STOP: 'stop' }
  },
  platformAccessory: class {}
})
const Delegate = require('../src/camera/WyzeCameraStreamingDelegate')
const WyzeCamera = require('../src/accessories/WyzeCamera')

function makeDelegate (name, capture, extra = {}) {
  const camera = {
    display_name: name,
    mac: name,
    cameraOnline: true,
    power_switch: 1,
    device: { device_params: {} },
    plugin: {
      config: {},
      log: Object.assign(() => {}, { error: () => {}, warn: () => {}, debug: () => {} }),
      client: { getCameraSnapshotImage: async () => ({ buffer: await capture() }) }
    },
    ...extra
  }
  return new Delegate(camera)
}

test('a refresh replaces the cached picture and keeps it fresh for the interval', async () => {
  let n = 0
  const d = makeDelegate('A', async () => Buffer.from(`pic${++n}`))
  await d.refreshSnapshot('timer', 60_000)
  assert.strictEqual(d._snapshotCache.buffer.toString(), 'pic1')
  d._snapshotCache.expiresAt = 0 // expired, as after the normal 10 s
  await d.refreshSnapshot('timer', 60_000)
  assert.strictEqual(d._snapshotCache.buffer.toString(), 'pic2')
  assert.ok(d._snapshotCache.expiresAt - Date.now() > 50_000)
})

test('offline, switched-off and streaming cameras are not refreshed', async () => {
  let calls = 0
  const capture = async () => { calls += 1; return Buffer.from('x') }
  await makeDelegate('Off', capture, { cameraOnline: false }).refreshSnapshot('timer')
  await makeDelegate('Power', capture, { power_switch: 0 }).refreshSnapshot('timer')
  const live = makeDelegate('Live', capture)
  live._streamActive = () => true
  await live.refreshSnapshot('timer')
  assert.strictEqual(calls, 0)
})

test('a camera that is already waiting for a refresh is not queued twice', async () => {
  let calls = 0
  const d = makeDelegate('A', async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return Buffer.from('x') })
  await Promise.all([d.refreshSnapshot('timer'), d.refreshSnapshot('timer'), d.refreshSnapshot('timer')])
  assert.strictEqual(calls, 1)
})

test('a motion refresh right after another picture is skipped, a timer refresh is not', async () => {
  let calls = 0
  const d = makeDelegate('A', async () => { calls += 1; return Buffer.from(`p${calls}`) })
  await d.refreshSnapshot('timer')
  await d.refreshSnapshot('motion')
  assert.strictEqual(calls, 1, 'motion within 10 s of the last picture is skipped')
  await d.refreshSnapshot('timer')
  assert.strictEqual(calls, 2)
})

test('a failed refresh never throws', async () => {
  const d = makeDelegate('A', async () => { throw new Error('boom') })
  await d.refreshSnapshot('timer')
})

function makeCamera (config, model = 'WYZE_CAKP2JFUS') {
  const acc = Object.create(WyzeCamera.prototype)
  const refreshes = []
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: model }, displayName: 'Garage' }
  acc.plugin = {
    config,
    log: Object.assign(() => {}, { debug: () => {}, error: () => {} }),
    client: { cameraGetEvents: async () => [] }
  }
  acc._streamingDelegate = { refreshSnapshot: (...args) => refreshes.push(args), stopAll: () => {} }
  return { acc, refreshes }
}

test('new motion events refresh the picture; the first poll only records history', () => {
  const { acc, refreshes } = makeCamera({})
  acc._startEventWatch(false)
  clearInterval(acc._ringTimer)
  acc._checkMotion([{ id: 'old' }])
  assert.strictEqual(refreshes.length, 0)
  acc._checkMotion([{ id: 'old' }])
  assert.strictEqual(refreshes.length, 0)
  acc._checkMotion([{ id: 'new' }, { id: 'old' }])
  assert.deepStrictEqual(refreshes, [['motion']])
  acc._checkMotion([{ id: 'new' }, { id: 'old' }])
  assert.strictEqual(refreshes.length, 1)
})

test('snapshotOnMotion: false turns the motion poll off for a camera without a doorbell', () => {
  const on = makeCamera({})
  on.acc._startEventWatch(false)
  assert.ok(on.acc._ringTimer)
  clearInterval(on.acc._ringTimer)
  const off = makeCamera({ snapshotOnMotion: false })
  off.acc._startEventWatch(false)
  assert.strictEqual(off.acc._ringTimer, undefined)
})

test('a camera without a doorbell never rings on a motion event', async () => {
  const { acc } = makeCamera({})
  acc._cameraController = { ringDoorbell: () => { throw new Error('should not ring') } }
  acc.plugin.client.cameraGetEvents = async () => [{ id: 'e', type: 'DOORBELL_RANG' }]
  acc._startEventWatch(false)
  clearInterval(acc._ringTimer)
  await acc._checkRing()
  await acc._checkRing()
})

test('cameras join one shared scheduler (default 30 s), can opt out, and leave on shutdown', () => {
  const { acc } = makeCamera({})
  acc._startSnapshotRefresh()
  const scheduler = acc.plugin._refreshScheduler
  assert.strictEqual(scheduler.intervalMs, 30_000)
  assert.deepStrictEqual(scheduler.members, [acc._streamingDelegate])
  acc.stopStreams()
  assert.deepStrictEqual(scheduler.members, [])
  assert.strictEqual(scheduler.timer, null)
  const off = makeCamera({ snapshotRefreshSeconds: 0 })
  off.acc._startSnapshotRefresh()
  assert.strictEqual(off.acc.plugin._refreshScheduler, undefined)
})
