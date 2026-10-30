/**
 * The plugin's settings page lists what the plugin found each camera can have, and saves a choice into the config.
 * The logic is in homebridge-ui/public/detected.js; these tests run it without a browser.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// The page's script is a classic browser script (homebridge-ui/package.json makes .js there ES modules for Node),
// so it is run the way a browser runs it: with `self` as the global it attaches WyzeDetected to.
const vm = require('node:vm')
const sandbox = {}
sandbox.self = sandbox
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../homebridge-ui/public/detected.js'), 'utf8'), sandbox)
// What the script returns is made in the vm's own realm; plain copies compare as ordinary objects.
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const inVm = sandbox.WyzeDetected
const page = {
  LABELS: plain(inVm.LABELS),
  settingFor: (...args) => plain(inVm.settingFor(...args)),
  buildView: (...args) => plain(inVm.buildView(...args)),
  valuesFor: (...args) => plain(inVm.valuesFor(...args)),
  applyDetections: (...args) => plain(inVm.applyDetections(...args))
}
const DetectionSensors = require('../src/camera/detectionSensors')
const { normalize } = require('../src/configMigrator')

const detected = {
  version: 1,
  cameras: {
    AA: { name: 'Front Doorbell', model: 'HL_DB2', motion: true, sound: false, labels: ['person', 'vehicle', 'pet', 'package'], unnamed: [], at: 't' },
    BB: { name: 'Garage', model: 'WYZE_CAKP2JFUS', motion: true, sound: true, labels: [], unnamed: [] },
    CC: { name: 'Porch', model: 'HL_DB2', motion: true, sound: false, labels: ['person', 'face'], unnamed: [901] }
  }
}
const entry = (cameras) => [{ platform: 'WyzeSmartHome', name: 'Wyze', cameras }]
const byMac = (view, mac) => view.find((cam) => cam.mac === mac)
const ticked = (cam) => cam.items.filter((i) => i.checked).map((i) => i.value)

// ---- the label table ----------------------------------------------------------------------------

test('the page\'s labels are the plugin\'s labels, with the same ones automatic', () => {
  assert.deepStrictEqual(page.LABELS.map((l) => l.label), DetectionSensors.KINDS)
  assert.deepStrictEqual(page.LABELS.filter((l) => l.auto).map((l) => l.label), DetectionSensors.AUTO_KINDS)
  assert.deepStrictEqual(page.LABELS.map((l) => l.value), DetectionSensors.KINDS.map((k) => k.toLowerCase()))
})

// ---- what is shown --------------------------------------------------------------------------------

test('a camera on automatic shows the automatic labels it has ticked, and Face as available', () => {
  const view = page.buildView(detected, entry([]))
  const doorbell = byMac(view, 'AA')
  assert.strictEqual(doorbell.setting, 'auto')
  assert.deepStrictEqual(ticked(doorbell), ['person', 'vehicle', 'pet', 'package'])
  assert.ok(doorbell.items.every((i) => !i.isNew), 'nothing is new: automatic already gives all four')
  const porch = byMac(view, 'CC')
  assert.deepStrictEqual(ticked(porch), ['person'])
  assert.deepStrictEqual(porch.items.filter((i) => i.isNew).map((i) => i.value), ['face'], 'Face exists but is not automatic')
  assert.deepStrictEqual(porch.unnamed, [901])
})

test('a camera with no labels shows no rows', () => {
  assert.deepStrictEqual(byMac(page.buildView(detected, entry([])), 'BB').items, [])
})

test('a chosen list is ticked as chosen, and a label found since is marked new', () => {
  const view = page.buildView(detected, entry([{ mac: 'AA', detections: ['Person', 'pet'] }]))
  const doorbell = byMac(view, 'AA')
  assert.deepStrictEqual(doorbell.setting, ['person', 'pet'])
  assert.deepStrictEqual(ticked(doorbell), ['person', 'pet'])
  assert.deepStrictEqual(doorbell.items.filter((i) => i.isNew).map((i) => i.value), ['vehicle', 'package'])
})

test('"none" ticks nothing, and a label named in the config but not seen lately is still listed', () => {
  assert.deepStrictEqual(ticked(byMac(page.buildView(detected, entry([{ mac: 'AA', detections: ['none'] }])), 'AA')), [])
  const view = page.buildView(detected, entry([{ mac: 'CC', detections: ['person', 'pet'] }]))
  const porch = byMac(view, 'CC')
  const pet = porch.items.find((i) => i.value === 'pet')
  assert.deepStrictEqual([pet.found, pet.checked], [false, true])
})

test('an empty file, or no plugin config yet, shows nothing and does not fail', () => {
  assert.deepStrictEqual(page.buildView({ version: 1, cameras: {} }, entry([])), [])
  assert.deepStrictEqual(page.buildView(undefined, undefined), [])
  assert.strictEqual(byMac(page.buildView(detected, []), 'AA').setting, 'auto')
})

// ---- what is saved --------------------------------------------------------------------------------

test('the ticked rows become the list; nothing ticked is none, never an empty list', () => {
  const doorbell = byMac(page.buildView(detected, entry([])), 'AA')
  assert.deepStrictEqual(page.valuesFor(doorbell.items), ['person', 'vehicle', 'pet', 'package'])
  doorbell.items.forEach((i) => { i.checked = false })
  assert.deepStrictEqual(page.valuesFor(doorbell.items), ['none'])
})

test('saving sets that camera\'s detections and leaves everything else as it was', () => {
  const config = entry([{ mac: 'AA', name: 'Front', siren: true, detections: ['person'] }, { mac: 'ZZ', detections: ['pet'] }])
  config[0].polling = { refreshInterval: 60000 }
  const next = page.applyDetections(config, 'AA', 'Front Doorbell', ['person', 'face'])
  assert.deepStrictEqual(next[0].cameras[0], { mac: 'AA', name: 'Front', siren: true, detections: ['person', 'face'] })
  assert.deepStrictEqual(next[0].cameras[1], { mac: 'ZZ', detections: ['pet'] })
  assert.deepStrictEqual(next[0].polling, { refreshInterval: 60000 })
  assert.deepStrictEqual(config[0].cameras[0].detections, ['person'], 'the config handed in is not changed')
})

test('a camera with no entry yet gets one, named, with the list', () => {
  const next = page.applyDetections(entry([{ mac: 'ZZ' }]), 'AA', 'Front Doorbell', ['package'])
  assert.deepStrictEqual(next[0].cameras[1], { mac: 'AA', name: 'Front Doorbell', detections: ['package'] })
  assert.deepStrictEqual(page.applyDetections([{ platform: 'WyzeSmartHome' }], 'AA', 'Front', ['pet'])[0].cameras, [{ mac: 'AA', name: 'Front', detections: ['pet'] }])
})

test('back to automatic removes the key, and adds no entry for a camera that has none', () => {
  const next = page.applyDetections(entry([{ mac: 'AA', siren: true, detections: ['person'] }]), 'AA', 'Front', [])
  assert.deepStrictEqual(next[0].cameras, [{ mac: 'AA', siren: true }])
  assert.deepStrictEqual(page.applyDetections(entry([]), 'AA', 'Front', [])[0].cameras, [])
})

test('with no plugin config at all, nothing is made up', () => {
  assert.deepStrictEqual(page.applyDetections([], 'AA', 'Front', ['pet']), [])
})

test('what the page saves is read back by the plugin as the same choice', () => {
  for (const values of [['person', 'face'], ['none'], ['vehicle']]) {
    const saved = page.applyDetections(entry([]), 'AA', 'Front', values)[0]
    const row = normalize({ platform: 'WyzeSmartHome', cameras: saved.cameras }).cameras[0]
    assert.deepStrictEqual(row.detections, values)
  }
})

// ---- the page and its server are part of the package ---------------------------------------------

test('the settings page files exist, and the page loads its logic and uses the Homebridge UI calls it needs', () => {
  const html = fs.readFileSync(path.join(__dirname, '../homebridge-ui/public/index.html'), 'utf8')
  assert.match(html, /<script src="detected\.js">/)
  for (const call of ['homebridge.showSchemaForm', "homebridge.request('/detected')", 'homebridge.getPluginConfig', 'homebridge.updatePluginConfig', 'homebridge.savePluginConfig']) {
    assert.ok(html.includes(call), `the page does not call ${call}`)
  }
  assert.ok(!html.includes('innerHTML'), 'camera names come from Wyze, so the page builds its elements as text')
  assert.ok(fs.existsSync(path.join(__dirname, '../homebridge-ui/server.js')))
})

test('its library is a dependency, and the page\'s folder is an ES module scope for the ESM-only library', () => {
  const pkg = require('../package.json')
  assert.ok(pkg.dependencies['@homebridge/plugin-ui-utils'])
  const ui = require('../homebridge-ui/package.json')
  assert.strictEqual(ui.type, 'module')
})

// The server is run as Homebridge runs it: a child process that is sent requests over IPC.
function askServer (storagePath, path_) {
  const { fork } = require('node:child_process')
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, '../homebridge-ui/server.js'), [], {
      env: { ...process.env, HOMEBRIDGE_STORAGE_PATH: storagePath },
      silent: true
    })
    const timer = setTimeout(() => { child.kill(); reject(new Error('the server did not answer')) }, 10000)
    child.on('error', reject)
    child.on('message', (message) => {
      if (message.action === 'ready') child.send({ action: 'request', requestId: 'r1', path: path_, body: {} })
      if (message.action === 'response') {
        clearTimeout(timer)
        child.kill()
        resolve(message.payload)
      }
    })
  })
}

test('the server, run as a child process, answers /detected with what the plugin recorded', async () => {
  const os = require('node:os')
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-ui-'))
  require('../src/detectedSensors').record(storage, { mac: 'AA', name: 'Front Doorbell', model: 'HL_DB2', motion: true, sound: false, labels: ['person'], unnamed: [] })
  const answer = await askServer(storage, '/detected')
  assert.strictEqual(answer.success, true)
  assert.strictEqual(answer.data.cameras.AA.name, 'Front Doorbell')
  assert.deepStrictEqual(answer.data.cameras.AA.labels, ['person'])
})

test('the server answers with nothing found when the plugin has recorded nothing yet', async () => {
  const os = require('node:os')
  const answer = await askServer(fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-ui-')), '/detected')
  assert.strictEqual(answer.success, true)
  assert.deepStrictEqual(answer.data, { version: 1, cameras: {} })
})
