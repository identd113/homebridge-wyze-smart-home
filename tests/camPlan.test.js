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

// ---- the account line: noted by the plugin, shown by the settings page ----

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const sandbox = {}
sandbox.self = sandbox
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../homebridge-ui/public/detected.js'), 'utf8'), sandbox)
const planSummary = (...args) => JSON.parse(JSON.stringify(sandbox.WyzeDetected.planSummary(...args)))

const wyzePlans = [
  { pid: 'x', name: 'Monthly Plan', status: 'EXPIRED', active: false, expires: now - DAY, quantity: 1, used: 0, macs: [] },
  { pid: 'y', name: 'Annual Plan', status: 'RENEW', active: true, expires: now + 100 * DAY, quantity: 1, used: 1, macs: ['AABBCCDDEEFF'] }
]

test('forNote lists live plans first and keeps only what the page needs', () => {
  const noted = camPlan.forNote(wyzePlans)
  assert.deepStrictEqual(noted.map((plan) => plan.name), ['Annual Plan', 'Monthly Plan'])
  assert.deepStrictEqual(Object.keys(noted[0]).sort(), ['active', 'expires', 'macs', 'name', 'quantity', 'status', 'used'])
  assert.strictEqual(camPlan.forNote(null), null)
  assert.strictEqual(detectedSensors.validPlans(noted), true)
})

test('recordPlans writes valid plans once, keeps the cameras, and refuses odd entries', () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'))
  const cam = { mac: 'AABBCCDDEEFF', name: 'Cam', model: 'HL_DB2', motion: true, sound: false, labels: [], unnamed: [], plan: null }
  assert.strictEqual(detectedSensors.record(storage, cam), true)
  const noted = camPlan.forNote(wyzePlans)
  assert.strictEqual(detectedSensors.recordPlans(storage, noted), true)
  assert.strictEqual(detectedSensors.recordPlans(storage, noted), false, 'same again: not rewritten')
  const data = detectedSensors.read(storage)
  assert.strictEqual(data.plans.length, 2)
  assert.ok(data.cameras.AABBCCDDEEFF, 'the cameras are still there')
  assert.strictEqual(detectedSensors.record(storage, { ...cam, name: 'Renamed' }), true)
  assert.strictEqual(detectedSensors.read(storage).plans.length, 2, 'a camera write keeps the plans')
  for (const bad of ['plans', [{ name: 5 }], [{ ...noted[0], macs: ['x y'] }], [{ ...noted[0], quantity: 'one' }], [{ ...noted[0], expires: 'soon' }]]) {
    assert.strictEqual(detectedSensors.recordPlans(storage, bad), false, JSON.stringify(bad))
  }
})

test('planSummary names the live plan, its seats and its cameras, and flags one ending soon', () => {
  const lines = planSummary(camPlan.forNote(wyzePlans), { AABBCCDDEEFF: 'Front Doorbell' }, now)
  assert.strictEqual(lines.length, 1, 'expired plans are not listed')
  assert.match(lines[0].text, /^Cam Plus: Annual Plan, 1 of 1 seat used \(Front Doorbell\), until \d{4}-\d{2}-\d{2}\.$/)
  assert.strictEqual(lines[0].soon, false)
  const ending = planSummary([{ ...wyzePlans[1], expires: now + 3 * DAY }], {}, now)
  assert.match(ending[0].text, /\(a camera\).*Ending soon\.$/)
  assert.strictEqual(ending[0].soon, true)
})

test('planSummary says so when no plan is live, and says nothing when the plugin noted none', () => {
  assert.deepStrictEqual(planSummary([wyzePlans[0]], {}, now).map((line) => line.text), ['No active Cam Plus plan on this account.'])
  assert.deepStrictEqual(planSummary(undefined, {}, now), [])
  assert.deepStrictEqual(planSummary('plans', {}, now), [])
})
