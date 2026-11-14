/**
 * The settings of the camera test page: config.json is the only place they live. Reads go to the file, the page
 * cannot write them, and nothing outside the listed options can be read.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createWebSettings, FIELDS } = require('../src/webSettings')

function setup (config, { indent = 4, trailingNewline = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-web-settings-'))
  const file = path.join(dir, 'config.json')
  fs.writeFileSync(file, JSON.stringify(config, null, indent) + (trailingNewline ? '\n' : ''), { mode: 0o600 })
  const state = { running: {} }
  const lines = []
  const settings = createWebSettings({
    configPath: () => file,
    platformAlias: 'WyzeSmartHome',
    instanceName: 'Wyze',
    running: () => state.running
  })
  return { dir, file, settings, state, lines, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) }
}

const CONFIG = {
  bridge: { name: 'Homebridge', pin: '000-00-000' },
  platforms: [
    { platform: 'config', name: 'Config', port: 8581, auth: 'form' },
    {
      platform: 'WyzeSmartHome',
      name: 'Wyze',
      auth: { username: 'me@example.com', password: 'hunter2hunter2', keyId: 'KEYID-SECRET', apiKey: 'APIKEY-SECRET' },
      cameras: [{ mac: 'AABBCCDDEEFF', name: 'Cam' }],
      advanced: { snapshotOnMotion: true, warmLiveView: true, dangerouslyAllowCustomBaseUrls: false, webServerPort: 8585 }
    }
  ]
}

test('the fields are the ones the page may change, with the file\'s value and the running one', async () => {
  const t = setup(CONFIG)
  t.state.running = { advanced: { snapshotOnMotion: true, warmLiveView: false, webServerPort: 8585 } }
  const described = await t.settings.describe()
  assert.strictEqual(described.file, 'config.json')
  assert.deepStrictEqual(described.fields.map((f) => f.key), FIELDS)
  const by = Object.fromEntries(described.fields.map((f) => [f.key, f]))
  assert.deepStrictEqual([by.warmLiveView.value, by.warmLiveView.running, by.warmLiveView.pending], [true, false, true], 'saved but not running yet')
  assert.deepStrictEqual([by.webServerPort.value, by.webServerPort.running, by.webServerPort.pending], [8585, 8585, false])
  assert.deepStrictEqual([by.snapshotRefreshSeconds.value, by.snapshotRefreshSeconds.pending], [null, false], 'not set: the default applies')
  assert.deepStrictEqual([by.snapshotOnMotion.type, by.sensorHoldSeconds.type, by.sensorHoldSeconds.minimum, by.webServerPort.maximum], ['boolean', 'integer', 5, 65535], 'types and ranges come from the schema')
  assert.ok(by.snapshotOnMotion.title && by.snapshotOnMotion.description && by.snapshotOnMotion.default === true)
})

test('nothing outside the listed options leaves the module: no credentials, no other settings', async () => {
  const t = setup(CONFIG)
  const text = JSON.stringify(await t.settings.describe())
  for (const secret of ['me@example.com', 'hunter2', 'KEYID-SECRET', 'APIKEY-SECRET', 'AABBCCDDEEFF', 'dangerouslyAllowCustomBaseUrls']) assert.ok(!text.includes(secret), `leaked ${secret}`)
})

test('every read goes to the file, so a change made elsewhere shows at once', async () => {
  const t = setup(CONFIG)
  assert.strictEqual((await t.settings.describe()).fields.find((f) => f.key === 'sensorHoldSeconds').value, null)
  const edited = t.read()
  edited.platforms[1].advanced.sensorHoldSeconds = 300
  fs.writeFileSync(t.file, JSON.stringify(edited, null, 4) + '\n')
  assert.strictEqual((await t.settings.describe()).fields.find((f) => f.key === 'sensorHoldSeconds').value, 300)
})

test('with several Wyze entries the one with the instance name is used', async () => {
  const t = setup({ platforms: [{ platform: 'WyzeSmartHome', name: 'Other' }, { platform: 'WyzeSmartHome', name: 'Wyze' }] })
  const warm = (await t.settings.describe()).fields.find((f) => f.key === 'warmLiveView')
  assert.strictEqual(warm.value, null, 'the entry with the instance name has no advanced block')
})

test('a missing, broken or empty config is a plain error', async () => {
  const t = setup(CONFIG)
  fs.writeFileSync(t.file, '{ not json')
  await assert.rejects(() => t.settings.describe(), /not valid JSON/)
  assert.strictEqual(fs.readFileSync(t.file, 'utf8'), '{ not json')
  fs.writeFileSync(t.file, JSON.stringify({ platforms: [{ platform: 'config' }] }))
  await assert.rejects(() => t.settings.describe(), /not in config\.json/)
  fs.unlinkSync(t.file)
  await assert.rejects(() => t.settings.describe(), /could not read config\.json/)
  const nowhere = createWebSettings({ configPath: () => undefined, platformAlias: 'WyzeSmartHome', running: () => ({}) })
  await assert.rejects(() => nowhere.describe(), /did not say where/)
})

test('the module can only read: it has no save, and nothing in it writes the file', () => {
  const t = setup(CONFIG)
  assert.strictEqual(t.settings.save, undefined)
  for (const name of ['webSettings', 'webSensors', 'configFile']) {
    const source = fs.readFileSync(path.join(__dirname, `../src/${name}.js`), 'utf8')
    assert.ok(!/writeFile|renameSync|unlinkSync/.test(source), `${name} writes a file`)
  }
})
