/**
 * The settings screen shows only what config.schema.json's "form" lists. An option that is in the schema but not in
 * the form can be changed only by editing the JSON, so every option must be in both.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.schema.json'), 'utf8'))
const shown = new Set()
const walk = (node) => {
  if (typeof node === 'string') shown.add(node)
  else if (Array.isArray(node)) node.forEach(walk)
  else if (node && typeof node === 'object') {
    if (typeof node.key === 'string') shown.add(node.key)
    for (const value of Object.values(node)) if (typeof value === 'object') walk(value)
  }
}
walk(schema.form)

test('every advanced option in the schema is on the settings screen', () => {
  const missing = Object.keys(schema.schema.properties.advanced.properties).filter((key) => !shown.has(`advanced.${key}`))
  assert.deepStrictEqual(missing, [], 'add these to the Advanced section of "form" in config.schema.json')
})

test('the camera picture and live view options are in the Advanced section, with the test page port', () => {
  const advanced = schema.form.flatMap((tab) => tab.items || []).find((item) => item && item.title === 'Advanced')
  const keys = advanced.items.map((item) => (typeof item === 'string' ? item : item.key))
  for (const key of ['snapshotRefreshSeconds', 'snapshotOnMotion', 'sensorHoldSeconds', 'warmLiveView', 'webServerPort']) {
    assert.ok(keys.includes(`advanced.${key}`), key)
  }
})

test('a number with both a minimum and a maximum is drawn as a slider by default, so these are forced to plain number inputs', () => {
  const advanced = schema.form.flatMap((tab) => tab.items || []).find((item) => item && item.title === 'Advanced')
  const properties = schema.schema.properties.advanced.properties
  for (const [key, property] of Object.entries(properties)) {
    if (!['integer', 'number'].includes(property.type) || property.minimum === undefined || property.maximum === undefined) continue
    const item = advanced.items.find((i) => (typeof i === 'string' ? i : i.key) === `advanced.${key}`)
    assert.ok(item && typeof item === 'object' && item.type === 'number', `advanced.${key} needs { "key": "advanced.${key}", "type": "number" } in the form`)
  }
})
