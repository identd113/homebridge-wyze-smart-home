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
  assert.ok(require('semver').validRange(pj.dependencies['wyze-api']), 'the declared wyze-api range must be a valid semver range')
  const r = checkInstalled()
  assert.strictEqual(r.required, pj.dependencies['wyze-api'])
  assert.strictEqual(r.ok, true, r.message) // the installed wyze-api must satisfy the declared minimum
})

test('a range that is not semver (a file: or git link) is not checked, and does not fail', () => {
  const r = check('file:../wyze-api', '2.0.0-beta.4')
  assert.strictEqual(r.ok, true)
})

test('an old wyze-api gets the message that says what to install, before anything requires it', () => {
  const version = require('../src/wyzeApiVersion')
  const real = version.checkInstalled
  version.checkInstalled = () => check('^2.0.0-beta.4', '1.1.15')
  const registered = []
  const errors = []
  try {
    require('../src/index')({
      hap: { Service: {}, Characteristic: {}, uuid: {}, Categories: {} },
      platformAccessory: class {},
      registerPlatform: (plugin, name, Platform) => registered.push([plugin, name, Platform])
    })
  } finally {
    version.checkInstalled = real
  }
  assert.strictEqual(registered.length, 1)
  assert.deepStrictEqual(registered[0].slice(0, 2), ['homebridge-wyze-smart-home', 'WyzeSmartHome'])
  const platform = new registered[0][2]({ error: (m) => errors.push(m) })
  assert.match(errors[0], /\[FATAL\].*requires \^2\.0\.0-beta\.4/)
  assert.doesNotThrow(() => platform.configureAccessory({}), 'cached accessories are left alone')
})
