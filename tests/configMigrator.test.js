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
