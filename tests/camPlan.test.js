'use strict'

const test = require('node:test')
const assert = require('node:assert')
const camPlan = require('../src/camera/plan')
const detectedSensors = require('../src/detectedSensors')

const DAY = 86400000
const now = Date.now()
const plans = [
  { pid: 'cam-plus-yearly', name: 'Annual Plan', active: true, expires: now + 100 * DAY, macs: ['AABBCCDDEEFF'] },
  { pid: 'cam-plus-monthly', name: 'Monthly Plan', active: false, expires: now - 5 * DAY, macs: ['BBCCDDEEFF00'] },
  { pid: 'cam-plus-yearly', name: 'Annual Plan', active: false, expires: now - 90 * DAY, macs: [] }
]

test('summarize: a camera on a live plan, on a lapsed one, and on none', () => {
  assert.deepStrictEqual(camPlan.summarize(plans, 'AABBCCDDEEFF'), { state: 'active', name: 'Annual Plan', expires: plans[0].expires })
  assert.strictEqual(camPlan.summarize(plans, 'BBCCDDEEFF00').state, 'expired')
  assert.deepStrictEqual(camPlan.summarize(plans, 'CCDDEEFF0011'), { state: 'none', name: '', expires: null })
})

test('summarize: no answer from Wyze is unknown, not "no plan"', () => {
  assert.strictEqual(camPlan.summarize(null, 'AABBCCDDEEFF'), null)
  assert.strictEqual(camPlan.summarize(undefined, 'AABBCCDDEEFF'), null)
})

test('summarize: a live plan wins over an older lapsed one on the same camera', () => {
  const both = [
    { name: 'Old', active: false, expires: now - DAY, macs: ['AABBCCDDEEFF'] },
    { name: 'New', active: true, expires: now + DAY, macs: ['AABBCCDDEEFF'] }
  ]
  assert.strictEqual(camPlan.summarize(both, 'AABBCCDDEEFF').name, 'New')
})

test('warning: none, expired and ending soon speak; a healthy plan and an unknown one do not', () => {
  assert.match(camPlan.warning({ state: 'none', name: '', expires: null }), /no Cam Plus plan.*5 minutes/)
  assert.match(camPlan.warning({ state: 'expired', name: 'Monthly Plan', expires: now - DAY }), /expired/)
  assert.match(camPlan.warning({ state: 'active', name: 'Annual Plan', expires: now + 3 * DAY }), /ends \d{4}-\d{2}-\d{2}/)
  assert.strictEqual(camPlan.warning({ state: 'active', name: 'Annual Plan', expires: now + 100 * DAY }), '')
  assert.strictEqual(camPlan.warning(null), '')
})

test('plansOnce asks Wyze once however many cameras ask, and a failure is remembered as unknown', async () => {
  let calls = 0
  const plugin = { client: { getCamPlusPlans: async () => { calls++; return plans } } }
  const [a, b] = await Promise.all([camPlan.plansOnce(plugin), camPlan.plansOnce(plugin)])
  assert.strictEqual(calls, 1)
  assert.strictEqual(a, b)

  const broken = { client: { getCamPlusPlans: async () => { throw new Error('nope') } } }
  assert.strictEqual(await camPlan.plansOnce(broken), null)
  assert.strictEqual(await camPlan.plansOnce({ client: {} }), null)
})

const camera = (plan) => ({ mac: 'AABBCCDDEEFF', name: 'Cam', model: 'HL_DB2', motion: true, sound: false, labels: [], unnamed: [], plan })

test('the note accepts a well-formed plan, null or none, and rejects anything else', () => {
  for (const good of [undefined, null, { state: 'none', name: '', expires: null }, { state: 'active', name: 'Annual Plan', expires: 1804106553000 }]) {
    assert.strictEqual(detectedSensors.isValid(camera(good)), true, JSON.stringify(good))
  }
  for (const bad of ['active', [], { state: 'gold', name: '', expires: null }, { state: 'active', name: 5, expires: null }, { state: 'active', name: 'x', expires: 'soon' }, { state: 'active', name: 'x' }]) {
    assert.strictEqual(detectedSensors.isValid(camera(bad)), false, JSON.stringify(bad))
  }
})
