/**
 * A full refresh started by anything (the main loop or the lock fast poll) moves the next
 * scheduled refresh a whole interval away, and two never run at once.
 */
const test = require('node:test')
const assert = require('node:assert')

const WyzeSmartHome = require('../src/WyzeSmartHome')

function makePlugin (refreshOnce, refreshInterval = 30000) {
  const plugin = Object.create(WyzeSmartHome.prototype)
  plugin.config = { refreshInterval }
  plugin._nextFullRefreshAt = 0
  plugin._refreshing = null
  plugin.log = { error: () => {} }
  plugin._refreshDevicesOnce = refreshOnce
  return plugin
}

test('a refresh that is already running is shared, not started twice', async () => {
  let calls = 0
  let release
  const plugin = makePlugin(() => {
    calls += 1
    if (calls > 1) return Promise.resolve()
    return new Promise((resolve) => { release = resolve })
  })
  const first = plugin.refreshDevices()
  const second = plugin.refreshDevices()
  assert.strictEqual(first, second)
  release()
  await first
  assert.strictEqual(calls, 1)
  await plugin.refreshDevices()
  assert.strictEqual(calls, 2, 'a later call starts a new refresh')
})

test('a finished refresh, failed or not, puts the next one a full interval away', async () => {
  const plugin = makePlugin(async () => {}, 45000)
  const before = Date.now()
  await plugin.refreshDevices()
  assert.ok(plugin._nextFullRefreshAt >= before + 45000)

  const failing = makePlugin(async () => { throw new Error('503') }, 45000)
  const t = Date.now()
  await assert.rejects(failing.refreshDevices(), /503/)
  assert.ok(failing._nextFullRefreshAt >= t + 45000)
  assert.strictEqual(failing._refreshing, null, 'a failure does not leave the lock held')
})

test('the main loop waits out an interval that a lock-triggered refresh restarted', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let calls = 0
  const plugin = makePlugin(async () => { calls += 1 })
  plugin.runLoop()
  await Promise.resolve(); await Promise.resolve()
  assert.strictEqual(calls, 1, 'first refresh runs at once')

  // 29 s later the lock fast poll triggers a full refresh; the main tick is due a second later.
  t.mock.timers.tick(29000)
  await Promise.resolve(); await Promise.resolve()
  await plugin.refreshDevices()
  assert.strictEqual(calls, 2)

  t.mock.timers.tick(1000) // the main loop's original 30 s tick
  await Promise.resolve(); await Promise.resolve()
  assert.strictEqual(calls, 2, 'no second refresh a second after the first')

  t.mock.timers.tick(29000) // a full interval after the lock-triggered refresh
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.strictEqual(calls, 3)
})
