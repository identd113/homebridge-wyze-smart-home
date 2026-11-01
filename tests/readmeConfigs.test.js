'use strict'

/**
 * The README shows a minimum, a recommended and a maximum config. These tests keep them honest: each must be
 * valid JSON, every setting in them must exist in config.schema.json, and each enum value must be one the
 * schema allows. A renamed or removed setting then fails here instead of staying in the README.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
const schema = require('../config.schema.json').schema

// Top-level options the plugin reads that have no settings-screen field (the README says so).
const NO_SCREEN_FIELD = new Set(['platform', 'securityRefreshInterval'])

function configBlock (heading) {
  const start = readme.indexOf(`### ${heading}`)
  assert.ok(start >= 0, `README has no "${heading}" heading`)
  const fence = readme.indexOf('```json', start)
  const end = readme.indexOf('```', fence + 7)
  return JSON.parse(readme.slice(fence + 7, end))
}

function allowed (property) {
  const values = property.enum || (property.oneOf || []).flatMap((option) => option.enum || [])
  return values.length ? values : null
}

function check (node, properties, where, problems) {
  for (const [key, value] of Object.entries(node)) {
    const property = properties[key]
    if (!property) { problems.push(`${where}.${key} is not in the schema`); continue }
    const options = allowed(property.items || property)
    const given = Array.isArray(value) ? value : [value]
    if (options && given.every((item) => typeof item === 'string')) {
      for (const item of given) if (!options.includes(item)) problems.push(`${where}.${key}: "${item}" is not allowed`)
    }
    if (property.properties && value && typeof value === 'object' && !Array.isArray(value)) {
      check(value, property.properties, `${where}.${key}`, problems)
    }
    if (property.items && property.items.properties && Array.isArray(value)) {
      value.forEach((row, index) => check(row, property.items.properties, `${where}.${key}[${index}]`, problems))
    }
  }
}

for (const heading of ['Minimum config', 'Recommended config', 'Maximum config']) {
  test(`README ${heading.toLowerCase()} is valid and uses only settings the schema knows`, () => {
    const platform = configBlock(heading).platforms[0]
    assert.strictEqual(platform.platform, 'WyzeSmartHome')
    const problems = []
    const settings = Object.fromEntries(Object.entries(platform).filter(([key]) => !NO_SCREEN_FIELD.has(key)))
    check(settings, schema.properties, 'config', problems)
    assert.deepStrictEqual(problems, [])
  })
}

test('the minimum config has exactly the four required credentials', () => {
  const auth = configBlock('Minimum config').platforms[0].auth
  assert.deepStrictEqual(Object.keys(auth).sort(), ['apiKey', 'keyId', 'password', 'username'])
})

test('the maximum config sets every option the schema offers, except the troubleshooting ones', () => {
  const platform = configBlock('Maximum config').platforms[0]
  const troubleshooting = new Set(['deviceTypeOverrides', 'dangerouslyAllowCustomBaseUrls', 'authBaseUrl', 'apiBaseUrl', 'mfaCode', 'secretsFile'])
  const missing = []
  const walk = (properties, node, where) => {
    for (const [key, property] of Object.entries(properties)) {
      if (troubleshooting.has(key)) continue
      if (node === undefined || !(key in node)) { missing.push(`${where}.${key}`); continue }
      if (property.properties) walk(property.properties, node[key], `${where}.${key}`)
      if (property.items && property.items.properties) walk(property.items.properties, node[key][0], `${where}.${key}[0]`)
    }
  }
  walk(schema.properties, platform, 'config')
  assert.deepStrictEqual(missing, [])
})
