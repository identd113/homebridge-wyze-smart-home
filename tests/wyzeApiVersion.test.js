const test = require('node:test')
const assert = require('node:assert')
const { check, checkInstalled } = require('../src/wyzeApiVersion')

test('accepts the declared minimum and newer compatible versions', () => {
  for (const v of ['2.0.0-beta.3', '2.0.0-beta.4', '2.0.0', '2.3.1']) {
    assert.strictEqual(check('^2.0.0-beta.3', v).ok, true, v)
  }
})

test('rejects older betas, 1.x, and a missing version', () => {
  for (const v of ['2.0.0-beta.2', '2.0.0-beta.1', '1.1.15']) {
    const r = check('^2.0.0-beta.3', v)
    assert.strictEqual(r.ok, false, v)
    assert.match(r.message, /requires \^2\.0\.0-beta\.3/)
  }
  assert.strictEqual(check('^2.0.0-beta.3', undefined).ok, false)
})

test('the range is declared once, in package.json', () => {
  const pj = require('../package.json')
  assert.strictEqual(pj.dependencies['wyze-api'], '^2.0.0-beta.3')
  const r = checkInstalled()
  assert.strictEqual(r.required, pj.dependencies['wyze-api'])
  assert.strictEqual(r.ok, true, r.message) // the installed wyze-api must satisfy the declared minimum
})
