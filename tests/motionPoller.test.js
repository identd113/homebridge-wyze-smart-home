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
