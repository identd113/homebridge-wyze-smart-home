/**
 * Rewriting a flat config into the nested 2.0 shape must not reset the options that
 * have no nested home.
 */
const test = require('node:test')
const assert = require('node:assert')

const { normalize, toCanonical2x } = require('../src/configMigrator')

const meta = { name: 'Wyze', platform: 'WyzeSmartHome' }
const flat = { platform: 'WyzeSmartHome', username: 'a', password: 'b', keyId: 'k', apiKey: 'x' }

test('a flat config keeps securityRefreshInterval, phoneId and the app identity keys', () => {
  const kept = {
    securityRefreshInterval: 5000,
    phoneId: 'abc',
    authApiKey: 'key',
    appName: 'name',
    appVer: 'ver',
    appVersion: 'version',
    userAgent: 'agent',
    sc: 'sc',
    sv: 'sv'
  }
  const out = toCanonical2x(normalize({ ...flat, ...kept }), meta)
  for (const [k, v] of Object.entries(kept)) assert.strictEqual(out[k], v, k)
})

test('options that were never set do not appear in the rewritten config', () => {
  const out = toCanonical2x(normalize(flat), meta)
  for (const k of ['securityRefreshInterval', 'phoneId', 'authApiKey', 'appName', 'appVer', 'appVersion', 'userAgent', 'sc', 'sv']) {
    assert.ok(!(k in out), k)
  }
})

test('every per-camera switch survives normalizing, so the accessory sees it in its array', () => {
  const { normalize } = require('../src/configMigrator')
  const cameras = [{ mac: 'AA', garage: true, spotlight: true, floodlight: true, siren: true, notifications: true, motionDetection: true, nightVision: true }]
  const config = normalize({ platform: 'WyzeSmartHome', auth: { username: 'u', password: 'p', keyId: 'k', apiKey: 'a' }, cameras })
  for (const key of ['garageDoorAccessory', 'spotLightAccessory', 'floodLightAccessory', 'sirenAccessory', 'notificationAccessory', 'motionDetectionAccessory', 'nightVisionAccessory']) {
    assert.deepStrictEqual(config[key], ['AA'], key)
  }
  assert.strictEqual(config.cameras[0].nightVision, true)
  const off = normalize({ platform: 'WyzeSmartHome', auth: { username: 'u', password: 'p', keyId: 'k', apiKey: 'a' }, cameras: [{ mac: 'AA', nightVision: false }] })
  assert.deepStrictEqual(off.nightVisionAccessory, [])
})

test('a switch listed only in the legacy arrays reaches the camera row, and an old config loses nothing', () => {
  const { normalize } = require('../src/configMigrator')
  const config = normalize({ platform: 'WyzeSmartHome', username: 'u', password: 'p', keyId: 'k', apiKey: 'a', nightVisionAccessory: ['BB'], sirenAccessory: ['BB'] })
  assert.deepStrictEqual(config.cameras.map((c) => [c.mac, c.siren, c.nightVision]), [['BB', true, true]])
})

test('the disk rewrite of an old flat config keeps the child bridge settings Homebridge owns', () => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { rewriteHomebridgeConfigOnDisk } = require('../src/configMigrator')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-bridge-'))
  const file = path.join(dir, 'config.json')
  const bridge = { username: '0E:11:22:33:44:55', port: 51123, name: 'Wyze child', pin: '000-00-000' }
  fs.writeFileSync(file, JSON.stringify({ platforms: [{ platform: 'WyzeSmartHome', name: 'Wyze', username: 'u', password: 'p', keyId: 'k', apiKey: 'a', garageDoorAccessory: ['AA'], _bridge: bridge }] }))
  const lines = []
  const status = rewriteHomebridgeConfigOnDisk({ configPath: file, platformAlias: 'WyzeSmartHome', log: { warn: (m) => lines.push(m), error: (m) => lines.push(m) } })
  assert.strictEqual(status, 'migrated')
  const entry = JSON.parse(fs.readFileSync(file, 'utf8')).platforms[0]
  assert.deepStrictEqual(entry._bridge, bridge)
  assert.strictEqual(entry.garageDoorAccessory, undefined, 'the old keys are still converted')
  assert.strictEqual(entry.cameras[0].garage, true)
  assert.match(lines.join('\n'), /including your Wyze password, so delete it/)
})

// ---- the rewrite never deletes a setting ----

function migrateFile (entry, setup) {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { rewriteHomebridgeConfigOnDisk } = require('../src/configMigrator')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-mig-'))
  const file = path.join(dir, 'config.json')
  fs.writeFileSync(file, JSON.stringify({ platforms: [entry] }))
  if (setup) setup(dir, file)
  const status = rewriteHomebridgeConfigOnDisk({ configPath: file, platformAlias: 'WyzeSmartHome', log: { warn () {}, error () {} } })
  return { status, dir, file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')).platforms[0] }
}

const oldFlat = { platform: 'WyzeSmartHome', name: 'Wyze', username: 'u', password: 'p', keyId: 'k', apiKey: 'a' }

test('the disk rewrite keeps keys the plugin has no place for, at the top level and inside nested blocks and camera rows', () => {
  const { status, read } = migrateFile({
    ...oldFlat,
    myNote: 'keep me',
    garageDoorAccessory: ['AA'],
    cameras: [{ mac: 'AA', name: 'Garage', extraRowKey: 7 }, { name: 'no mac yet' }],
    thermostat: { mode: 'heat-only', futureKey: true }
  })
  assert.strictEqual(status, 'migrated')
  const entry = read()
  assert.strictEqual(entry.myNote, 'keep me')
  assert.strictEqual(entry.thermostat.futureKey, true)
  assert.strictEqual(entry.thermostat.mode, 'heat-only')
  const row = entry.cameras.find((c) => c.mac === 'AA')
  assert.strictEqual(row.extraRowKey, 7)
  assert.strictEqual(row.garage, true)
  assert.ok(entry.cameras.some((c) => c.name === 'no mac yet' && !c.mac), 'a row without a mac is kept')
})

test('an exclude list kept while its switch is off survives the rewrite without switching the exclusion on', () => {
  const { read } = migrateFile({ ...oldFlat, excludeMacAddress: false, filterByMacAddressList: ['AA', 'BB'] })
  const entry = read()
  assert.deepStrictEqual(entry.excludes.macs, [], 'still not excluding')
  assert.deepStrictEqual(entry._disabledExcludeMacs, ['AA', 'BB'], 'the list is kept')
})

test('a second migration (an old config restored) gets a backup of its own and leaves the first one alone', () => {
  const fs = require('node:fs')
  const { rewriteHomebridgeConfigOnDisk } = require('../src/configMigrator')
  const { file, dir } = migrateFile(oldFlat)
  const first = fs.readFileSync(`${file}.pre-2.0.bak`, 'utf8')
  fs.writeFileSync(file, JSON.stringify({ platforms: [{ ...oldFlat, username: 'restored' }] }))
  const status = rewriteHomebridgeConfigOnDisk({ configPath: file, platformAlias: 'WyzeSmartHome', log: { warn () {}, error () {} } })
  assert.strictEqual(status, 'migrated')
  assert.strictEqual(fs.readFileSync(`${file}.pre-2.0.bak`, 'utf8'), first, 'the first backup is untouched')
  const backups = fs.readdirSync(dir).filter((f) => /^config\.json\.pre-2\.0\..+\.bak$/.test(f))
  assert.strictEqual(backups.length, 1, 'the second one is timestamped')
  assert.match(fs.readFileSync(`${dir}/${backups[0]}`, 'utf8'), /restored/)
})

test('the disk rewrite follows a symlinked config.json and keeps the file mode', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { status, dir, file } = migrateFile(oldFlat, (d, f) => {
    const real = path.join(d, 'real.json')
    fs.renameSync(f, real)
    fs.chmodSync(real, 0o640)
    fs.symlinkSync(real, f)
  })
  assert.strictEqual(status, 'migrated')
  assert.ok(fs.lstatSync(file).isSymbolicLink(), 'still a symlink')
  assert.strictEqual(fs.statSync(path.join(dir, 'real.json')).mode & 0o777, 0o640)
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'real.json'), 'utf8')).platforms[0].auth)
})

test('an entry whose platform name carries the plugin prefix is found and migrated', () => {
  const { status } = migrateFile({ ...oldFlat, platform: 'homebridge-wyze-smart-home.WyzeSmartHome' })
  assert.strictEqual(status, 'migrated')
})
