/**
 * config.schema.json must validate under Config UI X (JSON Schema draft 7, where
 * `required` is a list on the parent), and pasted developer keys are trimmed.
 */
const test = require('node:test')
const assert = require('node:assert')

const schema = require('../config.schema.json')
// Modules destructure homebridge from types at load time.
require('../src/types').update({ hap: { Service: {}, Characteristic: {}, uuid: {}, Categories: {} }, platformAccessory: class {}, user: { persistPath: () => require('os').tmpdir() } })

const WyzeSmartHome = require('../src/WyzeSmartHome')

function walk (node, fn) {
  if (node && typeof node === 'object') {
    fn(node)
    Object.values(node).forEach((v) => walk(v, fn))
  }
}

test('schema uses required arrays, not draft-3 per-property booleans', () => {
  walk(schema.schema, (n) => {
    if (n.properties) for (const [k, v] of Object.entries(n.properties)) assert.notStrictEqual(typeof v.required, 'boolean', `${k} has a boolean "required"`)
  })
  assert.deepStrictEqual(schema.schema.properties.auth.required, ['username', 'password', 'keyId', 'apiKey'])
})

test('secret fields are masked in the settings UI', () => {
  const auth = schema.schema.properties.auth.properties
  for (const k of ['password', 'apiKey', 'totpSecret']) assert.strictEqual(auth[k].format, 'password', k)
})

test('getClient trims whitespace around keyId and apiKey', () => {
  const platform = Object.create(WyzeSmartHome.prototype)
  platform.config = { username: 'u@example.com', password: 'p', keyId: ' 9c2e9f81-6af6 \n', apiKey: '\tabc ' }
  platform.log = Object.assign(() => {}, { debug () {}, info () {}, warn () {}, error () {} })
  const client = platform.getClient()
  assert.strictEqual(client.keyId, '9c2e9f81-6af6')
  assert.strictEqual(client.apiKey, 'abc')
})
