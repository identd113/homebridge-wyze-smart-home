/**
 * One request to Wyze covers every camera that is watched for motion, however many there are.
 */
const test = require('node:test')
const assert = require('node:assert')
const MotionPoller = require('../src/camera/motionPoller')

function setup (macs, extra = {}) {
  const calls = []
  const seen = {}
  const client = {
    cameraGetEventsMulti: extra.fetch || (async (list) => {
      calls.push(list)
      return Object.fromEntries(list.map((m) => [m, [{ id: `${m}-1` }]]))
    })
  }
  const log = { debug: () => {}, warn: (m) => (seen.warn = m) }
  const poller = new MotionPoller(client, { intervalMs: 1_000_000, log })
  const members = macs.map((mac) => ({
    mac,
    got: [],
    resets: 0,
    isOnline: true,
    online () { return this.isOnline },
    onEvents (e) { this.got.push(e) },
    reset () { this.resets += 1 }
  }))
  members.forEach((m) => poller.add(m))
  return { poller, members, calls, seen }
}

test('20 cameras are one request, and each camera gets only its own events', async () => {
  const macs = Array.from({ length: 20 }, (_, i) => `M${i}`)
  const { poller, members, calls } = setup(macs)
  await poller.poll()
  poller.stop()
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].length, 20)
  assert.deepStrictEqual(members[7].got, [[{ id: 'M7-1' }]])
})

test('an offline camera is not asked about and is told to forget what it has seen', async () => {
  const { poller, members, calls } = setup(['A', 'B'])
  members[1].isOnline = false
  await poller.poll()
  poller.stop()
  assert.deepStrictEqual(calls, [['A']])
  assert.strictEqual(members[1].resets, 1)
  assert.strictEqual(members[1].got.length, 0)
})

test('no request is made when every camera is offline', async () => {
  const { poller, members, calls } = setup(['A'])
  members[0].isOnline = false
  await poller.poll()
  poller.stop()
  assert.strictEqual(calls.length, 0)
})

test('failures back off (1, 3, 7 ticks skipped) and recover', async () => {
  let fail = true
  const { poller, members } = setup(['A'], { fetch: async () => { if (fail) throw new Error('boom'); return { A: [] } } })
  const skips = []
  for (let i = 0; i < 3; i += 1) { poller.skip = 0; await poller.poll(); skips.push(poller.skip) }
  assert.deepStrictEqual(skips, [0, 1, 3])
  fail = false
  poller.skip = 0
  await poller.poll()
  assert.strictEqual(poller.failures, 0)
  assert.strictEqual(members[0].got.length, 1)
  poller.stop()
})

test('removing the last camera stops the timer; a poll in progress is not doubled', async () => {
  const { poller, members } = setup(['A'])
  assert.ok(poller.timer)
  poller.busy = true
  await poller.poll()
  assert.strictEqual(members[0].got.length, 0)
  poller.remove(members[0])
  assert.strictEqual(poller.timer, null)
})

test('the beat follows the fastest camera, and every camera is read on each beat', async () => {
  const calls = []
  const client = { cameraGetEventsMulti: async (macs) => { calls.push(macs); return {} } }
  const poller = new MotionPoller(client, { intervalMs: 10_000 })
  const mk = (mac, everyMs) => ({ mac, everyMs, online: () => true, onEvents () {}, reset () {} })
  const camera = mk('CAM', 10_000)
  const doorbell = mk('DOOR', 5_000)
  poller.add(camera)
  assert.strictEqual(poller.beatMs, 10_000)
  poller.add(doorbell)
  assert.strictEqual(poller.beatMs, 5_000)
  await poller.poll()
  assert.deepStrictEqual(calls, [['CAM', 'DOOR']], 'one request names both cameras')
  poller.remove(doorbell)
  assert.strictEqual(poller.beatMs, 10_000)
  poller.stop()
})

// ---- one busy camera must not hide another's events ----------------------------------------------------

const events = (mac, n) => Array.from({ length: n }, (_, i) => ({ id: `${mac}-${i}` }))

test('a full answer from one busy camera is followed by asking for the cameras that came back empty', async () => {
  const asked = []
  const fetch = async (list) => {
    asked.push([...list])
    // Wyze caps the answer at 20 events in all, newest first: the busy camera takes every one of them
    if (list.includes('BUSY')) return { BUSY: events('BUSY', 20), QUIET1: [], QUIET2: [] }
    return Object.fromEntries(list.map((mac) => [mac, events(mac, 2)]))
  }
  const { poller, members } = setup(['BUSY', 'QUIET1', 'QUIET2'], { fetch })
  await poller.poll()
  assert.deepStrictEqual(asked, [['BUSY', 'QUIET1', 'QUIET2'], ['QUIET1', 'QUIET2']], 'the second request leaves the busy camera out')
  const byMac = Object.fromEntries(members.map((m) => [m.mac, m.got[0].length]))
  assert.deepStrictEqual(byMac, { BUSY: 20, QUIET1: 2, QUIET2: 2 })
})

test('an answer that is not full means nothing was crowded out: one request only', async () => {
  const asked = []
  const fetch = async (list) => { asked.push(list); return { A: events('A', 3), B: [], C: [] } }
  const { poller } = setup(['A', 'B', 'C'], { fetch })
  await poller.poll()
  assert.strictEqual(asked.length, 1)
})

test('the asking again stops after a few rounds', async () => {
  let calls = 0
  const fetch = async (list) => { calls += 1; return { [list[0]]: events(list[0], 20), ...Object.fromEntries(list.slice(1).map((m) => [m, []])) } }
  const { poller } = setup(['A', 'B', 'C', 'D', 'E'], { fetch })
  await poller.poll()
  assert.strictEqual(calls, 3, 'bounded, so a very busy account cannot make a request storm')
})
