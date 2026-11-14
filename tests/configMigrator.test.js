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
