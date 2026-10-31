'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { holdMs, DEFAULT_SECONDS } = require('../src/camera/sensorHold')
const { normalize } = require('../src/configMigrator')

test('a sensor stays on for 2 minutes unless told otherwise', () => {
  assert.strictEqual(DEFAULT_SECONDS, 120)
  assert.strictEqual(holdMs({}), 120000)
  assert.strictEqual(holdMs(undefined), 120000)
})

test('sensorHoldSeconds sets it, and a value that makes no sense falls back or is capped', () => {
  assert.strictEqual(holdMs({ sensorHoldSeconds: 45 }), 45000)
  assert.strictEqual(holdMs({ sensorHoldSeconds: '300' }), 300000)
  for (const bad of [0, 1, -10, 'soon', null, NaN]) assert.strictEqual(holdMs({ sensorHoldSeconds: bad }), 120000, String(bad))
  assert.strictEqual(holdMs({ sensorHoldSeconds: 999999 }), 3600000, 'capped, so a typo cannot leave a tile on for days')
})

test('the setting is in the schema under Advanced and survives the config migration', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.schema.json'), 'utf8'))
  const prop = schema.schema.properties.advanced.properties.sensorHoldSeconds
  assert.strictEqual(prop.type, 'integer')
  assert.ok(prop.minimum >= 1 && prop.maximum <= 3600)
  const flat = normalize({ platform: 'WyzeSmartHome', name: 'Wyze', username: 'a', password: 'b', keyId: 'c', apiKey: 'd', sensorHoldSeconds: 90 })
  assert.strictEqual(flat.advanced.sensorHoldSeconds, 90)
})
