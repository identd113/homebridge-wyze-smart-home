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

// ---- the prefilled device report link ----

test('the label file the page uses is up to date, and every label is an option of the form', () => {
  const gen = require('../.github/scripts/gen-device-options.js')
  const labels = require('../src/deviceIssueLabels.json')
  assert.strictEqual(fs.readFileSync(gen.LABELS, 'utf8'), gen.renderLabels(), 'run `npm run device-options` and commit the result')
  const options = new Set(gen.options())
  for (const [model, label] of Object.entries(labels)) {
    assert.ok(options.has(label), `${model}: "${label}" is not an option of the device report form`)
    assert.ok(label.endsWith(`(${model})`), label)
  }
  assert.strictEqual(labels.HL_DB2, 'Doorbells - Video Doorbell v2 (HL_DB2)')
})

test('the form the page opens exists, and its values are ones the form and the triage accept', () => {
  const { p } = platformWith({})
  const form = p.issueFormForTestPage()
  const template = fs.readFileSync(path.join(__dirname, '../.github/ISSUE_TEMPLATE', form.template), 'utf8')
  assert.match(form.url, /^https:\/\/github\.com\/identd113\/homebridge-wyze-smart-home\/issues\/new$/)
  assert.ok(new RegExp(`^ +- "?${form.kind}"?$`, 'm').test(template), 'the kind is an option of the form')
  assert.match(form.origin, /^[a-z0-9][a-z0-9._-]{0,30}$/, 'the origin label rule in .github/scripts/origin-label.js')
  assert.ok(form.plugin.startsWith(require('../package.json').version))
  assert.strictEqual(form.deviceLabel('HL_DB2'), 'Doorbells - Video Doorbell v2 (HL_DB2)')
  assert.strictEqual(form.deviceLabel('NOT_A_MODEL'), undefined)
  for (const id of ['device', 'model', 'kind', 'plugin', 'details', 'blob', 'origin']) assert.match(template, new RegExp(`\\n    id: ${id}\\n`), `the form has a field "${id}"`)
})

test('the page is started with that form', async () => {
  const { p } = platformWith({ webServerPort: 8099 })
  const lib = fakeLib()
  await p.startCameraTestPage(lib)
  assert.strictEqual(lib.made[0].issueForm.template, 'new-device.yml')
  assert.strictEqual(lib.made[0].issueForm.deviceLabel('HL_DB2'), 'Doorbells - Video Doorbell v2 (HL_DB2)')
})

test('the page is given settings and sensors that are only read from Homebridge\'s config.json', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wyze-page-settings-'))
  const file = path.join(dir, 'config.json')
  fs.writeFileSync(file, JSON.stringify({ platforms: [{ platform: 'WyzeSmartHome', name: 'Wyze', advanced: { webServerPort: 8099 } }] }, null, 4) + '\n')
  const before = fs.readFileSync(file, 'utf8')
  const { p } = platformWith({ name: 'Wyze', webServerPort: 8099 })
  p.api = { user: { configPath: () => file, storagePath: () => dir } }
  const lib = fakeLib()
  await p.startCameraTestPage(lib)
  const { settings, sensors } = lib.made[0]
  assert.strictEqual((await settings.describe()).fields.find((f) => f.key === 'webServerPort').value, 8099)
  assert.deepStrictEqual((await sensors.describe()).cameras, [])
  assert.strictEqual(settings.save, undefined)
  assert.strictEqual(sensors.save, undefined)
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'the file is untouched')
})

test('the links are noted for the settings screen when the page starts, and removed at shutdown or when it is off', async () => {
  const webPageLink = require('../src/webPageLink')
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wyze-page-link-'))
  const on = platformWith({ webServerPort: 8099 })
  on.p.api = { user: { configPath: () => path.join(dir, 'config.json'), storagePath: () => dir } }
  await on.p.startCameraTestPage(fakeLib())
  assert.deepStrictEqual(webPageLink.read(dir).urls, ['http://localhost:8099/?token=abc', 'http://10.0.0.5:8099/?token=abc'])
  assert.strictEqual(webPageLink.read(dir).port, 8099)
  assert.strictEqual(fs.statSync(path.join(dir, 'homebridge-wyze-smart-home', 'web-page.json')).mode & 0o777, 0o600)
  on.p.shutdown()
  assert.deepStrictEqual(webPageLink.read(dir).urls, [])
  // a link left by an earlier run is removed when the page is off
  webPageLink.write(dir, { port: 1, urls: ['http://old:1/?token=x'] })
  const off = platformWith({})
  off.p.api = { user: { storagePath: () => dir } }
  await off.p.startCameraTestPage(fakeLib())
  assert.deepStrictEqual(webPageLink.read(dir).urls, [])
})

test('the link file is only read as http links, and a missing or odd file reads as none', () => {
  const webPageLink = require('../src/webPageLink')
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wyze-page-link-'))
  assert.deepStrictEqual(webPageLink.read(dir), { port: null, urls: [] })
  assert.deepStrictEqual(webPageLink.read(''), { port: null, urls: [] })
  assert.strictEqual(webPageLink.write('', { port: 1, urls: [] }), false, 'no storage folder, no file')
  fs.mkdirSync(path.join(dir, 'homebridge-wyze-smart-home'))
  fs.writeFileSync(path.join(dir, 'homebridge-wyze-smart-home', 'web-page.json'), JSON.stringify({ port: 8585, urls: ['http://10.0.0.2:8585/?token=a', 'javascript:alert(1)', 'https://evil.example/x', 5] }))
  assert.deepStrictEqual(webPageLink.read(dir).urls, ['http://10.0.0.2:8585/?token=a'])
  fs.writeFileSync(path.join(dir, 'homebridge-wyze-smart-home', 'web-page.json'), '{ nope')
  assert.deepStrictEqual(webPageLink.read(dir), { port: null, urls: [] })
})
