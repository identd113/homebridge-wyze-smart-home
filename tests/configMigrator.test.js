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
