/**
 * Camera robustness from the review of the merge into 2.0.0: one camera that hangs or throws must not stop the others,
 * nothing runs on a camera after it is stopped, and a read that wakes a camera is not made when it cannot answer.
 * The sweeps at the end check the same classes of mistake across all of src.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

require('../src/types').update({ hap: { Service: {}, Characteristic: { On: 'On' }, uuid: {}, Categories: {}, StreamRequestTypes: { START: 'start', RECONFIGURE: 'reconfigure', STOP: 'stop' } }, platformAccessory: class {} })
const Delegate = require('../src/camera/WyzeCameraStreamingDelegate')
const MotionPoller = require('../src/camera/motionPoller')
const WyzeCamera = require('../src/accessories/WyzeCamera')
const { withTimeout } = require('../src/camera/withTimeout')

const quiet = Object.assign(() => {}, { error () {}, warn () {}, debug () {}, info () {} })

function delegate (name, extra = {}) {
  const camera = {
    display_name: name, mac: name, product_model: 'WYZE_CAKP2JFUS', cameraOnline: true, power_switch: 1,
    device: { device_params: {} },
    plugin: { config: { warmLiveView: true }, log: quiet, client: { cameraWarmDown () {} } },
    ...extra
  }
  return new Delegate(camera)
}

// ---- withTimeout ----

test('withTimeout passes a result and an error through, and names what was slow', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  assert.strictEqual(await withTimeout(Promise.resolve(7), 1000, 'x'), 7)
  await assert.rejects(() => withTimeout(Promise.reject(new Error('boom')), 1000, 'x'), /boom/)
  const slow = withTimeout(new Promise(() => {}), 5000, 'reading events')
  t.mock.timers.tick(5000)
  await assert.rejects(() => slow, /reading events took longer than 5s/)
})

// ---- the picture queue ----

test('one picture that never finishes does not hold up the other cameras for ever', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const stuck = delegate('stuck')
  const other = delegate('other')
  const ran = []
  stuck._enqueuePicture('regular', () => new Promise(() => {}))
  const done = other._enqueuePicture('regular', async () => { ran.push('other') })
  await Promise.resolve()
  assert.deepStrictEqual(ran, [], 'waits behind the stuck one for now')
  t.mock.timers.tick(90_000)
  await done
  assert.deepStrictEqual(ran, ['other'])
})

test('stopping a camera takes its waiting pictures out of the queue, so none opens a session on it afterwards', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const first = delegate('first')
  const stopped = delegate('stopped')
  const ran = []
  first._enqueuePicture('regular', () => new Promise(() => {}))
  const waiting = stopped._enqueuePicture('regular', async () => { ran.push('stopped') })
  stopped.stopAll()
  await waiting // dropped, not run
  t.mock.timers.tick(90_000)
  await Promise.resolve()
  assert.deepStrictEqual(ran, [])
})

test('a picture request is still answered when opening a connection ahead throws', async () => {
  const d = delegate('Garage')
  d.camera.plugin.client.cameraWarmUp = () => { throw new Error('no connection') }
  d.camera.plugin.client.cameraWarmState = () => null
  d.camera.plugin.client.getCameraSnapshotImage = async () => ({ buffer: Buffer.from('captured') })
  d._lastSnapshot = Buffer.from('old')
  d._lastSnapshotAt = Date.now()
  const r = await new Promise((resolve) => d.handleSnapshotRequest({}, (err, buf) => resolve({ err, buf })))
  assert.ok(!r.err, `the request failed: ${r.err}`)
  assert.ok(r.buf)
})

// ---- the motion poller ----

function poller (members, readEvents) {
  const p = new MotionPoller({ intervalMs: 10_000, log: quiet })
  p.members = members
  p._readEvents = readEvents
  return p
}

test('a camera whose online check throws does not stop the others from being checked', async () => {
  const got = []
  const bad = { mac: 'BAD', online: () => { throw new Error('gone') }, onEvents () {} }
  const good = { mac: 'GOOD', online: () => true, onEvents: (events) => got.push(events) }
  const p = poller([bad, good], async (macs) => { assert.deepStrictEqual(macs, ['GOOD']); return { GOOD: [{ id: 1 }] } })
  await p.poll()
  assert.deepStrictEqual(got, [[{ id: 1 }]])
})

test('a read of the events that never answers is given up on, and the next check can run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const member = { mac: 'A', online: () => true, onEvents () {} }
  const p = poller([member], () => new Promise(() => {}))
  const first = p.poll()
  await Promise.resolve()
  assert.strictEqual(p.busy, true)
  t.mock.timers.tick(60_000)
  await first
  assert.strictEqual(p.busy, false, 'not stuck busy for ever')
  assert.strictEqual(p.failures, 1, 'counted as a failed read, so it backs off')
})

// ---- the camera accessory ----

function camera (extra = {}) {
  const acc = Object.create(WyzeCamera.prototype)
  const { product_model: model = 'WYZE_CAKP2JFUS', ...rest } = extra
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: model }, displayName: 'Cam' }
  Object.assign(acc, { cameraOnline: true, power_switch: 1, nightVision: 'off' }, rest)
  const reads = []
  acc.plugin = { log: quiet, client: { getCameraNightVision: async () => { reads.push(1); return 'auto' } } }
  acc.showNightVision = () => {}
  acc._showNightVision = () => {}
  return { acc, reads }
}

test('night vision is not read from a camera that is offline, switched off, or runs on a battery, nor after it is stopped', async () => {
  for (const extra of [{ cameraOnline: false }, { power_switch: 0 }, { power_switch: '0' }, { product_model: 'AN_RSCW' }, { _stopped: true }]) {
    const { acc, reads } = camera(extra)
    await acc._readNightVision()
    assert.strictEqual(reads.length, 0, JSON.stringify(extra))
  }
  const { acc, reads } = camera()
  await acc._readNightVision()
  assert.strictEqual(reads.length, 1, 'an ordinary camera is still read')
  assert.strictEqual(acc.nightVision, 'auto')
})

test('stopping a camera cancels the picture it was going to take at startup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { acc } = camera()
  let prefetched = 0
  acc._streamingDelegate = { prefetchSnapshot: () => { prefetched += 1 }, stopAll () {} }
  acc.detections = { stop () {} }
  acc._prefetchTimer = setTimeout(() => { if (!acc._stopped) acc._streamingDelegate.prefetchSnapshot() }, 5000)
  acc.stopStreams()
  t.mock.timers.tick(10_000)
  assert.strictEqual(prefetched, 0)
})

// ---- sweeps over src ----

function sourceFiles (dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return entry.name.endsWith('.js') ? [full] : []
  })
}

test('every timer a class keeps in a field is cleared somewhere in the same file', () => {
  const root = path.join(__dirname, '..')
  const offenders = []
  let kept = 0
  for (const file of sourceFiles(path.join(root, 'src'))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/this\.(\w+)\s*=\s*(setInterval|setTimeout)\(/g)) {
      kept += 1
      const clear = m[2] === 'setInterval' ? 'clearInterval' : 'clearTimeout'
      if (!new RegExp(`${clear}\\(\\s*this\\.${m[1]}\\b`).test(text)) offenders.push(`${path.relative(root, file)}: this.${m[1]}`)
    }
  }
  assert.ok(kept >= 6, `the sweep only found ${kept} kept timers; the pattern is wrong`)
  assert.deepStrictEqual(offenders, [])
})

test('every interval is unref()ed, so it never keeps Homebridge from exiting', () => {
  const root = path.join(__dirname, '..')
  const offenders = []
  for (const file of sourceFiles(path.join(root, 'src'))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/(?:this\.(\w+)|const (\w+))\s*=\s*setInterval\(/g)) {
      const name = m[1] ? `this\\.${m[1]}` : m[2]
      if (!new RegExp(`${name}\\.unref`).test(text)) offenders.push(`${path.relative(root, file)}: ${m[1] || m[2]}`)
    }
  }
  assert.deepStrictEqual(offenders, [])
})

test('no handler for uncaughtException is installed anywhere in src', () => {
  const root = path.join(__dirname, '..')
  const offenders = sourceFiles(path.join(root, 'src')).filter((f) => /process\.(on|once)\(\s*['"]uncaughtException/.test(fs.readFileSync(f, 'utf8')))
  assert.deepStrictEqual(offenders, [])
})

test('every AI detection the plugin asks for by name is a tag wyze-api knows', () => {
  const { AiEventTag } = require('wyze-api/src/types')
  const text = fs.readFileSync(path.join(__dirname, '../src/camera/detectionSensors.js'), 'utf8')
  const kinds = [...text.matchAll(/^\s+(\w+): \{ tag: AiEventTag\.(\w+)/gm)]
  assert.ok(kinds.length >= 5)
  for (const [, kind, tag] of kinds) {
    assert.ok(Object.hasOwn(AiEventTag, kind.toUpperCase()), `${kind} is asked for as "${kind.toUpperCase()}", which is not an AiEventTag name`)
    assert.strictEqual(kind.toUpperCase(), tag, `${kind} is matched on AiEventTag.${tag}`)
  }
})
