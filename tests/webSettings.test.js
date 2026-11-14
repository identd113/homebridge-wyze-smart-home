/**
 * The settings of the camera test page: config.json is the only place they live. Reads go to the file, writes go
 * straight back to it, and nothing outside the listed options can be read or changed.
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
    running: () => state.running,
    log: { info: (m) => lines.push(m) }
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

test('a change is written to config.json, and nothing else in the file changes', async () => {
  const t = setup(CONFIG)
  const result = await t.settings.save({ snapshotRefreshSeconds: 60, warmLiveView: false })
  assert.deepStrictEqual(result, { saved: { snapshotRefreshSeconds: 60, warmLiveView: false }, restartNeeded: true })
  const after = t.read()
  const expected = JSON.parse(JSON.stringify(CONFIG))
  expected.platforms[1].advanced.snapshotRefreshSeconds = 60
  expected.platforms[1].advanced.warmLiveView = false
  assert.deepStrictEqual(after, expected)
  const described = await t.settings.describe()
  assert.strictEqual(described.fields.find((f) => f.key === 'snapshotRefreshSeconds').value, 60, 'the next read sees it')
  assert.match(t.lines.join('\n'), /advanced\.snapshotRefreshSeconds = 60 to config\.json/)
})

test('the file keeps its indentation, its trailing newline and its mode, and a backup of the old file is made', async () => {
  for (const [indent, trailingNewline] of [[4, true], [2, true], [4, false]]) {
    const t = setup(CONFIG, { indent, trailingNewline })
    const before = fs.readFileSync(t.file, 'utf8')
    await t.settings.save({ webServerPort: 9000 })
    const after = fs.readFileSync(t.file, 'utf8')
    assert.strictEqual(after.endsWith('\n'), trailingNewline)
    assert.strictEqual(after, JSON.stringify(Object.assign(JSON.parse(before), {}), null, indent).replace('8585', '9000') + (trailingNewline ? '\n' : ''), `indent ${indent}`)
    assert.strictEqual(fs.readFileSync(`${t.file}.web-settings.bak`, 'utf8'), before, 'the backup is the file as it was')
    assert.strictEqual(fs.statSync(t.file).mode & 0o777, 0o600)
    assert.strictEqual(fs.statSync(`${t.file}.web-settings.bak`).mode & 0o777, 0o600)
    assert.deepStrictEqual(fs.readdirSync(t.dir).filter((n) => n.endsWith('.tmp')), [], 'no temp file is left')
  }
})

test('clearing a value removes it, so the default applies, and an empty advanced block is removed', async () => {
  const t = setup({ platforms: [{ platform: 'WyzeSmartHome', name: 'Wyze', advanced: { webServerPort: 8585 } }] })
  await t.settings.save({ webServerPort: null })
  assert.strictEqual(t.read().platforms[0].advanced, undefined)
  const again = setup(CONFIG)
  await again.settings.save({ snapshotOnMotion: '' })
  assert.ok(!('snapshotOnMotion' in again.read().platforms[1].advanced))
})

test('an option that is not set creates the advanced block', async () => {
  const t = setup({ platforms: [{ platform: 'WyzeSmartHome', name: 'Wyze' }] })
  await t.settings.save({ sensorHoldSeconds: 600 })
  assert.deepStrictEqual(t.read().platforms[0].advanced, { sensorHoldSeconds: 600 })
})

test('anything not in the list cannot be changed, and a bad value changes nothing at all', async () => {
  const t = setup(CONFIG)
  const before = fs.readFileSync(t.file, 'utf8')
  const cases = [
    [{ 'auth.password': 'x' }, /cannot be changed here/],
    [{ deviceTypeOverrides: {} }, /cannot be changed here/],
    [{ authBaseUrl: 'https://evil.example.com' }, /cannot be changed here/],
    [{ dangerouslyAllowCustomBaseUrls: true }, /cannot be changed here/],
    [{ sensorHoldSeconds: 4 }, /at least 5/],
    [{ sensorHoldSeconds: 3601 }, /at most 3600/],
    [{ sensorHoldSeconds: 12.5 }, /whole number/],
    [{ sensorHoldSeconds: '300' }, /whole number/],
    [{ warmLiveView: 'yes' }, /true or false/],
    [{ snapshotRefreshSeconds: -1 }, /at least 0/],
    [{ webServerPort: 80 }, /below 1024.*root/],
    [{ webServerPort: 1023 }, /below 1024/],
    [{ webServerPort: 65536 }, /at most 65535/],
    [{}, /no changes/],
    [null, /no changes/],
    [{ warmLiveView: false, sensorHoldSeconds: 4 }, /at least 5/]
  ]
  for (const [changes, pattern] of cases) {
    await assert.rejects(() => t.settings.save(changes), (e) => pattern.test(e.message) && e.status === 400, JSON.stringify(changes))
  }
  assert.strictEqual(fs.readFileSync(t.file, 'utf8'), before, 'the file is untouched')
  assert.ok(!fs.existsSync(`${t.file}.web-settings.bak`), 'no backup for a write that did not happen')
})

test('the port rule matches the page: 0 and 1024 to 65535 are accepted', async () => {
  const t = setup(CONFIG)
  for (const port of [0, 1024, 8585, 65535]) {
    await t.settings.save({ webServerPort: port })
    assert.strictEqual(t.read().platforms[1].advanced.webServerPort, port)
  }
})

test('with several Wyze entries the one with the instance name is used', async () => {
  const t = setup({ platforms: [{ platform: 'WyzeSmartHome', name: 'Other' }, { platform: 'WyzeSmartHome', name: 'Wyze' }] })
  await t.settings.save({ warmLiveView: true })
  assert.strictEqual(t.read().platforms[0].advanced, undefined)
  assert.strictEqual(t.read().platforms[1].advanced.warmLiveView, true)
})

test('a missing, broken or empty config is an error that changes nothing', async () => {
  const t = setup(CONFIG)
  fs.writeFileSync(t.file, '{ not json')
  await assert.rejects(() => t.settings.describe(), /not valid JSON/)
  await assert.rejects(() => t.settings.save({ warmLiveView: true }), /not valid JSON/)
  assert.strictEqual(fs.readFileSync(t.file, 'utf8'), '{ not json')
  fs.writeFileSync(t.file, JSON.stringify({ platforms: [{ platform: 'config' }] }))
  await assert.rejects(() => t.settings.describe(), /not in config\.json/)
  fs.unlinkSync(t.file)
  await assert.rejects(() => t.settings.describe(), /could not read config\.json/)
  const nowhere = createWebSettings({ configPath: () => undefined, platformAlias: 'WyzeSmartHome', running: () => ({}) })
  await assert.rejects(() => nowhere.describe(), /did not say where/)
})
