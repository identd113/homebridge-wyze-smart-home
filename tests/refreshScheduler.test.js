/**
 * The regular picture refresh takes one camera at a time, evenly spaced across the
 * interval, so cameras never refresh at the same moment.
 */
const test = require('node:test')
const assert = require('node:assert')
const RefreshScheduler = require('../src/camera/refreshScheduler')

const member = (name, log) => ({ name, refreshSnapshot: (reason, keep) => log.push([name, reason, keep]) })

test('cameras are taken in turn, one per tick, and each gets the freshness window', () => {
  const log = []
  const s = new RefreshScheduler(30_000)
  s.add(member('A', log)); s.add(member('B', log)); s.add(member('C', log))
  s.stop()
  for (let i = 0; i < 6; i += 1) s._tick()
  assert.deepStrictEqual(log.map((e) => e[0]), ['A', 'B', 'C', 'A', 'B', 'C'])
  assert.deepStrictEqual(log[0].slice(1), ['timer', 60_000])
})

test('the tick spacing is the interval divided by the number of cameras', () => {
  const s = new RefreshScheduler(30_000)
  const a = member('A', []); const b = member('B', []); const c = member('C', [])
  s.add(a); s.add(b); s.add(c)
  assert.ok(s.timer)
  assert.strictEqual(s.stepMs, 10_000)
  s.remove(c)
  assert.strictEqual(s.stepMs, 15_000)
  s.stop()
})

test('a camera that leaves does not skip or repeat another', () => {
  const log = []
  const s = new RefreshScheduler(30_000)
  const [a, b, c] = ['A', 'B', 'C'].map((n) => member(n, log))
  s.add(a); s.add(b); s.add(c)
  s.stop()
  s._tick() // A
  s.remove(a) // B is now first
  s._tick() // B
  s._tick() // C
  assert.deepStrictEqual(log.map((e) => e[0]), ['A', 'B', 'C'])
})

test('an empty scheduler stops its timer and ticks do nothing', () => {
  const s = new RefreshScheduler(30_000)
  const a = member('A', [])
  s.add(a)
  s.remove(a)
  assert.strictEqual(s.timer, null)
  s._tick()
})

test('adding the same camera twice does not duplicate it', () => {
  const s = new RefreshScheduler(30_000)
  const a = member('A', [])
  s.add(a); s.add(a)
  assert.strictEqual(s.members.length, 1)
  s.stop()
})

test('with too many cameras to refresh in time, each is refreshed less often, and that is said once', async () => {
  const lines = []
  const s = new RefreshScheduler(30_000, { log: (m) => lines.push(m), announceDelayMs: 5 })
  const members = Array.from({ length: 20 }, (_, i) => member(`C${i}`, []))
  members.forEach((m) => s.add(m))
  await new Promise((resolve) => setTimeout(resolve, 30))
  s.stop()
  assert.strictEqual(s.stepMs, 5000, 'one capture every 5 s at most, not every 1.5 s')
  assert.strictEqual(s.effectiveIntervalMs, 100_000, '20 cameras x 5 s')
  assert.strictEqual(lines.length, 1, 'said once, not at each camera that joined')
  assert.match(lines[0], /20 cameras cannot all be refreshed every 30 s.*every 100 s instead/)
})

test('with three cameras nothing changes: every 30 s each, one every 10 s, no message', () => {
  const lines = []
  const log = []
  const s = new RefreshScheduler(30_000, { log: (m) => lines.push(m) })
  ;['A', 'B', 'C'].forEach((n) => s.add(member(n, log)))
  s.stop()
  assert.strictEqual(s.stepMs, 10_000)
  assert.strictEqual(s.effectiveIntervalMs, 30_000)
  assert.strictEqual(lines.length, 0)
  s._tick()
  assert.strictEqual(log[0][2], 60_000, 'a picture stays fresh for two refreshes')
})

test('the freshness window follows the slower rate when there are many cameras', () => {
  const log = []
  const s = new RefreshScheduler(30_000)
  Array.from({ length: 20 }, (_, i) => member(`C${i}`, log)).forEach((m) => s.add(m))
  s.stop()
  s._tick()
  assert.strictEqual(log[0][2], 200_000)
})
