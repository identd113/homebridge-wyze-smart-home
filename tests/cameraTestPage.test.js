/**
 * The camera test page's setting: advanced.webServerPort. 0 or unset is off, 1 to 1023 is refused, and a
 * bad value or a busy port is logged without stopping the plugin. wyze-api is replaced by a stand-in.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const WyzeSmartHome = require('../src/WyzeSmartHome')
const { normalize, toCanonical2x } = require('../src/configMigrator')

const flat = { platform: 'WyzeSmartHome', username: 'a', password: 'b', keyId: 'k', apiKey: 'x' }

function platformWith (config) {
  const lines = []
  const log = (m) => lines.push(['info', m])
  for (const level of ['debug', 'info', 'warn', 'error']) log[level] = (m) => lines.push([level, m])
  const p = Object.create(WyzeSmartHome.prototype)
  p.config = config
  p.log = log
  p.client = { getDeviceList: async () => [] }
  return { p, lines }
}

// A stand-in for wyze-api that follows the same port rules.
function fakeLib ({ startError } = {}) {
  const made = []
  return {
    made,
    validateWebPort: (v) => {
      if (v === undefined || v === 0 || v === '0') return { enabled: false }
      const n = Number(v)
      if (!Number.isInteger(n)) return { enabled: false, error: 'web server port must be a whole number' }
      if (n < 1024) return { enabled: false, error: `web server port ${n} is below 1024, which needs root` }
      return { enabled: true, port: n }
    },
    createCameraTestServer: (opts) => {
      made.push(opts)
      return {
        started: false,
        stopped: false,
        start () { if (startError) return Promise.reject(startError); this.started = true; return Promise.resolve({ port: opts.port, urls: [`http://localhost:${opts.port}/?token=abc`, `http://10.0.0.5:${opts.port}/?token=abc`] }) },
        stop () { this.stopped = true; return Promise.resolve() }
      }
    }
  }
}

test('the port is an advanced setting that survives the config migrator, and is off by default', () => {
  assert.strictEqual(normalize(flat).webServerPort, undefined)
  const withPort = { ...flat, advanced: { webServerPort: 8099 } }
  assert.strictEqual(normalize(withPort).webServerPort, 8099, 'mirrored for the code that reads it')
  assert.strictEqual(normalize(withPort).advanced.webServerPort, 8099)
  assert.strictEqual(toCanonical2x(normalize(withPort), { name: 'Wyze', platform: 'WyzeSmartHome' }).advanced.webServerPort, 8099)
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.schema.json'), 'utf8'))
  const field = schema.schema.properties.advanced.properties.webServerPort
  assert.deepStrictEqual([field.type, field.default, field.minimum, field.maximum], ['integer', 0, 0, 65535])
  assert.match(field.description, /1024 to 65535/)
})

test('off when the port is unset or 0: nothing is created and nothing is logged', async () => {
  for (const config of [{}, { webServerPort: 0 }, { advanced: { webServerPort: 0 } }, { webServerPort: '0' }, { webServerPort: null }]) {
    const { p, lines } = platformWith(config)
    const lib = fakeLib()
    await p.startCameraTestPage(lib)
    assert.strictEqual(lib.made.length, 0, JSON.stringify(config))
    assert.deepStrictEqual(lines, [])
    assert.strictEqual(p.webServer, undefined)
  }
})

test('a port from 1 to 1023 is refused with a warning, and the plugin carries on', async () => {
  for (const port of [1, 80, 443, 1023]) {
    const { p, lines } = platformWith({ webServerPort: port })
    const lib = fakeLib()
    await p.startCameraTestPage(lib)
    assert.strictEqual(lib.made.length, 0)
    assert.strictEqual(lines.length, 1)
    assert.strictEqual(lines[0][0], 'warn')
    assert.match(lines[0][1], /below 1024.*root.*camera test page is off/s)
  }
})

test('a good port starts the page with the client, logs every link, and shutdown stops it', async () => {
  const { p, lines } = platformWith({ webServerPort: 8099 })
  const lib = fakeLib()
  await p.startCameraTestPage(lib)
  assert.strictEqual(lib.made.length, 1)
  assert.strictEqual(lib.made[0].port, 8099)
  assert.strictEqual(lib.made[0].client, p.client)
  assert.strictEqual(lib.made[0].log, p.log)
  assert.ok(p.webServer.started)
  const text = lines.map((l) => l[1]).join('\n')
  assert.match(text, /port 8099/)
  assert.match(text, /http:\/\/localhost:8099\/\?token=abc/)
  assert.match(text, /http:\/\/10\.0\.0\.5:8099\/\?token=abc/)
  const server = p.webServer
  p.shutdown()
  assert.ok(server.stopped)
})

test('the setting is also read from the advanced block', async () => {
  const { p } = platformWith({ advanced: { webServerPort: 9000 } })
  const lib = fakeLib()
  await p.startCameraTestPage(lib)
  assert.strictEqual(lib.made[0].port, 9000)
})

test('a busy port or a failing start is logged as a warning, not thrown', async () => {
  const busy = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })
  const { p, lines } = platformWith({ webServerPort: 8099 })
  await p.startCameraTestPage(fakeLib({ startError: busy }))
  assert.strictEqual(p.webServer, undefined)
  assert.strictEqual(lines.at(-1)[0], 'warn')
  assert.match(lines.at(-1)[1], /port 8099 is already in use/)
  const other = platformWith({ webServerPort: 8099 })
  await other.p.startCameraTestPage(fakeLib({ startError: new Error('boom') }))
  assert.match(other.lines.at(-1)[1], /could not start: boom/)
})

test('a wyze-api without the page says so instead of failing', async () => {
  const { p, lines } = platformWith({ webServerPort: 8099 })
  await p.startCameraTestPage({})
  assert.strictEqual(lines.length, 1)
  assert.match(lines[0][1], /too old for the camera test page/)
  // and with the setting off, an old wyze-api is not mentioned at all
  const quiet = platformWith({})
  await quiet.p.startCameraTestPage({})
  assert.deepStrictEqual(quiet.lines, [])
})
