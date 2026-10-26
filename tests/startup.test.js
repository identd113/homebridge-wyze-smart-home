/**
 * Fatal startup problems must log once and leave the platform inert, without
 * touching cached accessories.
 */
const test = require('node:test')
const assert = require('node:assert')

const WyzeSmartHome = require('../src/WyzeSmartHome')

function makeLog () {
  const lines = []
  const log = (m) => lines.push(['info', m])
  for (const level of ['debug', 'info', 'warn', 'warning', 'error']) log[level] = (m) => lines.push([level, m])
  log.lines = lines
  return log
}

function makeApi () {
  const calls = { on: [], unregister: [] }
  return {
    calls,
    on: (evt) => calls.on.push(evt),
    unregisterPlatformAccessories: (...a) => calls.unregister.push(a),
    hap: {},
    user: { storagePath: () => require('os').tmpdir() }
  }
}

// The platform logs through its own WyzeLogger (stdout), so capture that.
function captureStdout (fn) {
  const chunks = []
  const orig = process.stdout.write
  process.stdout.write = (c, ...rest) => { chunks.push(String(c)); return true }
  try { fn() } finally { process.stdout.write = orig }
  // eslint-disable-next-line no-control-regex
  return chunks.join('').replace(/\u001b\[[0-9;]*m/g, '')
}

test('empty username logs a [FATAL] error and disables the platform', () => {
  const log = makeLog()
  const api = makeApi()
  let platform
  const out = captureStdout(() => {
    platform = new WyzeSmartHome(log, { platform: 'WyzeSmartHome', name: 'Wyze', username: '', password: 'p', keyId: 'k', apiKey: 'a' }, api)
  })

  const fatal = out.split('\n').filter((l) => /\[ERROR\].*\[FATAL\].*no username specified/.test(l))
  assert.strictEqual(fatal.length, 1)
  assert.strictEqual(platform.disabled, true)
  assert.ok(!api.calls.on.includes('didFinishLaunching'), 'must not start discovery')
  assert.strictEqual(platform.client, undefined)
})

test('a disabled platform leaves cached accessories alone (no unregister, no setup)', () => {
  const log = makeLog()
  const api = makeApi()
  const platform = new WyzeSmartHome(log, { platform: 'WyzeSmartHome', name: 'Wyze', username: ' ', password: 'p', keyId: 'k', apiKey: 'a' }, api)
  const cached = { context: { product_type: 'Camera', product_model: 'WYZEC1-JZ', nickname: 'Cam', mac: 'AA' } }

  platform.configureAccessory(cached)

  assert.strictEqual(api.calls.unregister.length, 0)
  assert.strictEqual(platform.accessories.length, 0)
})

test('a camera that drops out of the device list stops its streams and doorbell poll', async () => {
  const platform = Object.create(WyzeSmartHome.prototype)
  const stopped = []
  platform.config = { pluginLoggingEnabled: false }
  platform.log = makeLog()
  platform.api = makeApi()
  platform.accessories = [{ stopStreams: () => stopped.push('doorbell') }]
  platform.loadDevice = async () => null // nothing found any more
  await platform.loadDevices([{ mac: 'AA' }], Date.now())
  assert.deepStrictEqual(stopped, ['doorbell'])
  assert.strictEqual(platform.accessories.length, 0)
})

test('startup says which plugin and wyze-api versions are loaded', () => {
  const log = makeLog()
  const api = makeApi()
  const out = captureStdout(() => {
    // eslint-disable-next-line no-new
    new WyzeSmartHome(log, { platform: 'WyzeSmartHome', name: 'Wyze', username: ' ', password: 'p', keyId: 'k', apiKey: 'a' }, api)
  })
  const pluginVersion = require('../package.json').version
  const apiVersion = require('wyze-api/package.json').version
  const lines = out.split('\n').filter((l) => l.includes('[Wyze] homebridge-wyze-smart-home'))
  assert.strictEqual(lines.length, 1)
  assert.ok(lines[0].includes(`homebridge-wyze-smart-home ${pluginVersion}, wyze-api ${apiVersion} (needs `), lines[0])
})
