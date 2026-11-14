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
  for (const key of ['snapshotRefreshSeconds', 'snapshotOnMotion', 'sensorHoldSeconds', 'warmLiveView', 'webServerPort']) {
    assert.ok(advanced.items.includes(`advanced.${key}`), key)
  }
})
