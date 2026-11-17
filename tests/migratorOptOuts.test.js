/**
 * Rewriting a 1.x config must not lose an explicit opt-out (snapshotOnMotion: false) or the legacy logging toggle
 * (pluginLoggingEnabled: true).
 */
const test = require('node:test')
const assert = require('node:assert')

const { normalize, toCanonical2x } = require('../src/configMigrator')

const meta = { name: 'Wyze', platform: 'WyzeSmartHome' }
const flat = { platform: 'WyzeSmartHome', username: 'a', password: 'b', keyId: 'k', apiKey: 'x' }

test('snapshotOnMotion: false is kept when the config is rewritten (it is on unless set)', () => {
  const out = toCanonical2x(normalize({ ...flat, snapshotOnMotion: false }), meta)
  assert.strictEqual(out.advanced.snapshotOnMotion, false)
  assert.strictEqual(normalize(toCanonical2x(normalize({ ...flat, snapshotOnMotion: false }), meta)).advanced.snapshotOnMotion, false, 'and survives a second pass')
})

test('snapshotOnMotion: true and an unset one are not written, so the file stays clean', () => {
  assert.ok(!('advanced' in toCanonical2x(normalize(flat), meta)))
  const on = toCanonical2x(normalize({ ...flat, snapshotOnMotion: true }), meta)
  assert.strictEqual(on.advanced && on.advanced.snapshotOnMotion, true)
})

test('other advanced options that are off by default are still left out when false', () => {
  const out = toCanonical2x(normalize({ ...flat, warmLiveView: false, dangerouslyAllowCustomBaseUrls: false }), meta)
  assert.ok(!('advanced' in out), 'nothing to write')
})

test('pluginLoggingEnabled: true alone resolves to debug, as apiLogEnabled does', () => {
  assert.strictEqual(normalize({ ...flat, pluginLoggingEnabled: true }).logging.level, 'debug')
  assert.strictEqual(normalize({ ...flat, apiLogEnabled: true }).logging.level, 'debug')
  assert.strictEqual(normalize({ ...flat, pluginLoggingEnabled: false, apiLogEnabled: false }).logging.level, 'info')
  assert.strictEqual(normalize(flat).logging.level, 'info')
})

test('an explicit log level still wins over the legacy toggles', () => {
  assert.strictEqual(normalize({ ...flat, pluginLoggingEnabled: true, logLevel: 'warn' }).logging.level, 'warn')
  assert.strictEqual(normalize({ ...flat, apiLogEnabled: true, logging: { level: 'error' } }).logging.level, 'error')
})

test('ADVANCED_DEFAULT_ON is exactly the advanced booleans that default to true in the schema', () => {
  const { ADVANCED_DEFAULT_ON, ADVANCED_KEYS } = require('../src/configMigrator')
  const schema = require('../config.schema.json')
  const props = schema.schema.properties.advanced.properties
  const onByDefault = ADVANCED_KEYS.filter((k) => props[k] && props[k].type === 'boolean' && props[k].default === true)
  assert.deepStrictEqual([...ADVANCED_DEFAULT_ON].sort(), onByDefault.sort())
})
