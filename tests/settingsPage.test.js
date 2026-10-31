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
  applyDetections: (...args) => plain(inVm.applyDetections(...args)),
  problemsWith: (...args) => plain(inVm.problemsWith(...args)),
  prepareSave: (...args) => plain(inVm.prepareSave(...args)),
  modesFor: (...args) => plain(inVm.modesFor(...args))
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
  require('../src/detectedSensors').record(storage, { mac: 'AABBCCDDEEFF', name: 'Front Doorbell', model: 'HL_DB2', motion: true, sound: false, labels: ['person'], unnamed: [] })
  const answer = await askServer(storage, '/detected')
  assert.strictEqual(answer.success, true)
  assert.strictEqual(answer.data.cameras.AABBCCDDEEFF.name, 'Front Doorbell')
  assert.deepStrictEqual(answer.data.cameras.AABBCCDDEEFF.labels, ['person'])
})

test('the server answers with nothing found when the plugin has recorded nothing yet', async () => {
  const os = require('node:os')
  const answer = await askServer(fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-ui-')), '/detected')
  assert.strictEqual(answer.success, true)
  assert.deepStrictEqual(answer.data, { version: 1, cameras: {} })
})

// ---- items the plugin has no name for ----------------------------------------------------------------

const withOthers = {
  version: 1,
  cameras: { AA: { name: 'Front Doorbell', model: 'HL_DB2', motion: true, sound: false, labels: ['person', 'starship', 'phaser'], unnamed: [] } }
}

test('items with no name are listed as other rows, unticked until they are saved, and marked new', () => {
  const doorbell = byMac(page.buildView(withOthers, entry([])), 'AA')
  assert.deepStrictEqual(doorbell.items.map((i) => [i.value, i.label, i.other, i.checked, i.isNew]), [
    ['person', 'Person', false, true, false],
    ['phaser', 'Phaser', true, false, true],
    ['starship', 'Starship', true, false, true]
  ])
})

test('saving them puts the names in the list, and the page then shows them ticked and not new', () => {
  const doorbell = byMac(page.buildView(withOthers, entry([])), 'AA')
  doorbell.items.find((i) => i.value === 'starship').checked = true
  const values = page.valuesFor(doorbell.items)
  assert.deepStrictEqual(values, ['person', 'starship'])
  const saved = page.applyDetections(entry([]), 'AA', 'Front Doorbell', values)
  const again = byMac(page.buildView(withOthers, saved), 'AA')
  assert.deepStrictEqual(again.setting, ['person', 'starship'])
  assert.deepStrictEqual(again.items.filter((i) => i.checked).map((i) => i.value), ['person', 'starship'])
  assert.deepStrictEqual(again.items.filter((i) => i.isNew).map((i) => i.value), ['phaser'])
})

test('a name already in the list that is no longer found is still shown, so it can be removed', () => {
  const gone = byMac(page.buildView({ version: 1, cameras: { AA: { name: 'D', labels: ['person'], unnamed: [] } } }, entry([{ mac: 'AA', detections: ['person', 'tribble'] }])), 'AA')
  const tribble = gone.items.find((i) => i.value === 'tribble')
  assert.deepStrictEqual([tribble.found, tribble.checked, tribble.other], [false, true, true])
})

test('the plugin reads what the page saved, ignores the names it does not know, and builds no tile for them', () => {
  const saved = page.applyDetections(entry([]), 'AA', 'Front Doorbell', ['person', 'starship'])[0]
  const row = normalize({ platform: 'WyzeSmartHome', cameras: saved.cameras }).cameras[0]
  assert.deepStrictEqual(row.detections, ['person', 'starship'])
})

// ---- nothing is saved unless the change passes every check ------------------------------------------

const MAC = 'AABBCCDDEEFF'
const saved = () => [{
  platform: 'WyzeSmartHome',
  name: 'Wyze',
  auth: { username: 'u' },
  polling: { refreshInterval: 60000 },
  cameras: [{ mac: MAC, name: 'Front', siren: true }, { mac: 'BBCCDDEEFF00', detections: ['pet'] }]
}]

test('a good choice passes the checks and changes only that camera\'s detections', () => {
  const before = saved()
  const result = page.prepareSave(before, MAC, 'Front', ['person', 'starship'])
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.next[0].cameras[0], { mac: MAC, name: 'Front', siren: true, detections: ['person', 'starship'] })
  assert.deepStrictEqual(result.next[0].cameras[1], before[0].cameras[1])
  assert.deepStrictEqual(result.next[0].polling, before[0].polling)
})

test('going back to automatic, none, and a camera with no entry yet all pass', () => {
  assert.strictEqual(page.prepareSave(saved(), 'BBCCDDEEFF00', 'Garage', []).ok, true)
  assert.strictEqual(page.prepareSave(saved(), MAC, 'Front', ['none']).ok, true)
  const added = page.prepareSave(saved(), 'CCDDEEFF0011', 'Porch', ['package'])
  assert.strictEqual(added.ok, true)
  assert.deepStrictEqual(added.next[0].cameras[2], { mac: 'CCDDEEFF0011', name: 'Porch', detections: ['package'] })
})

const refused = (result, pattern) => {
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.next, undefined, 'a refused change comes with nothing to save')
  assert.match(result.errors.join('; '), pattern)
}

test('names that are not plain lower-case words are refused', () => {
  for (const bad of ['<script>', 'Person', '', ' ', 'a'.repeat(40), 'quo"te', "it's", '../x', 'x\ny']) {
    refused(page.prepareSave(saved(), MAC, 'Front', [bad]), /not a valid item name/)
  }
  refused(page.prepareSave(saved(), MAC, 'Front', [5]), /not a valid item name/)
  refused(page.prepareSave(saved(), MAC, 'Front', [null]), /not a valid item name/)
})

test('a name listed twice, "none" with others, and a very long list are refused', () => {
  refused(page.prepareSave(saved(), MAC, 'Front', ['pet', 'pet']), /listed twice/)
  refused(page.prepareSave(saved(), MAC, 'Front', ['none', 'pet']), /cannot be combined/)
  refused(page.prepareSave(saved(), MAC, 'Front', Array.from({ length: 31 }, (_, i) => `item${i}`)), /more than 30/)
  refused(page.prepareSave(saved(), MAC, 'Front', 'person'), /not a list/)
})

test('a camera id that is missing or odd is refused', () => {
  for (const bad of ['', 'ab', undefined, null, 'AA BB', '<img>']) refused(page.prepareSave(saved(), bad, 'X', ['pet']), /no usable id/)
})

test('no saved settings yet, or the wrong shape, is refused', () => {
  refused(page.prepareSave([], MAC, 'Front', ['pet']), /no saved settings yet/)
  refused(page.prepareSave(undefined, MAC, 'Front', ['pet']), /no saved settings yet|could not be checked/)
  refused(page.prepareSave(null, MAC, 'Front', ['pet']), /no saved settings yet|could not be checked/)
  refused(page.prepareSave([null], MAC, 'Front', ['pet']), /no saved settings yet/)
})

test('two entries for the same camera are refused, not guessed at', () => {
  const twice = saved()
  twice[0].cameras.push({ mac: MAC, detections: ['pet'] })
  refused(page.prepareSave(twice, MAC, 'Front', ['person']), /more than one entry/)
})

test('a change that would alter anything else is refused (checked against a faulty save)', () => {
  const before = saved()
  const damaged = (change) => {
    const after = JSON.parse(JSON.stringify(before))
    change(after)
    return page.problemsWith(before, after, MAC, ['person'])
  }
  const withDetections = (after) => { after[0].cameras[0].detections = ['person'] }
  const mustReport = (change, pattern) => assert.match(damaged((after) => { withDetections(after); change(after) }).join('; '), pattern)
  assert.deepStrictEqual(damaged(withDetections), [], 'the good change is clean')
  mustReport((after) => { after[0].polling.refreshInterval = 1 }, /alter other settings/)
  mustReport((after) => { after[0].auth = {} }, /alter other settings/)
  mustReport((after) => { after[0].cameras[1].detections = [] }, /alter other settings/)
  mustReport((after) => { after[0].cameras[0].siren = false }, /camera's other settings/)
  mustReport((after) => { after[0].cameras.pop() }, /alter other settings/)
  mustReport((after) => { after[0].extra = 1 }, /alter other settings/)
  assert.match(damaged((after) => { after[0].cameras[0].detections = ['pet'] }).join('; '), /not be the list chosen/)
  assert.match(damaged((after) => { after.push({}) }).join('; '), /same shape/)
})

test('a new camera entry may hold only its id and name', () => {
  const before = saved()
  const after = JSON.parse(JSON.stringify(before))
  after[0].cameras.push({ mac: 'CCDDEEFF0011', name: 'Porch', detections: ['pet'], siren: true })
  assert.match(page.problemsWith(before, after, 'CCDDEEFF0011', ['pet']).join('; '), /more than its id and name/)
})

test('going back to automatic must remove the key', () => {
  const before = saved()
  const after = JSON.parse(JSON.stringify(before))
  after[0].cameras[1].detections = ['pet']
  assert.match(page.problemsWith(before, after, 'BBCCDDEEFF00', []).join('; '), /not go back to automatic/)
})

test('a check that cannot be completed refuses to save', () => {
  const hostile = [{ platform: 'WyzeSmartHome', get cameras () { throw new Error('boom') } }]
  const result = page.prepareSave(hostile, MAC, 'Front', ['pet'])
  assert.strictEqual(result.ok, false)
  assert.match(result.errors.join('; '), /could not be checked/)
})

test('the page saves only through prepareSave, and does nothing when it says no', () => {
  const html = fs.readFileSync(path.join(__dirname, '../homebridge-ui/public/index.html'), 'utf8')
  const save = html.slice(html.indexOf('async function save'), html.indexOf('function card'))
  assert.ok(save.includes('WyzeDetected.prepareSave('), 'the save goes through the checks')
  assert.ok(!save.includes('WyzeDetected.applyDetections('), 'the page never builds a change that skips them')
  const check = save.indexOf('if (!prepared.ok)')
  const returnsBefore = save.indexOf('return;', check)
  const update = save.indexOf('homebridge.updatePluginConfig')
  assert.ok(check > 0 && returnsBefore > check && returnsBefore < update, 'a refused change returns before anything is updated or saved')
  assert.ok(save.indexOf('homebridge.savePluginConfig') > update)
  assert.match(save, /catch \(e\) \{\s*homebridge\.toast\.error\('Not saved: '/, 'an unexpected failure saves nothing and says so')
})

test('the schema turns the custom settings page on, or Homebridge never loads it', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.schema.json'), 'utf8'))
  assert.strictEqual(schema.customUi, true)
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'homebridge-ui', 'public', 'index.html')))
})

// ---- Motion and Sound sit in the panel like the labels do ----------------------------------------

const wide = {
  version: 1,
  cameras: {
    AABBCCDDEEFF: { name: 'Front Doorbell', model: 'HL_DB2', motion: true, sound: false, labels: ['person'], unnamed: [] },
    BBCCDDEEFF00: { name: 'Garage', model: 'WYZE_CAKP2JFUS', motion: true, sound: true, labels: [], unnamed: [] }
  }
}
const sensorsOf = (cam) => Object.fromEntries(cam.sensors.map((x) => [x.label, x.checked]))

test('every camera shows Motion and Sound, ticked when it would have the sensor', () => {
  const view = page.buildView(detected, entry([]))
  assert.deepStrictEqual(sensorsOf(byMac(view, 'AA')), { Motion: true, Sound: false })
  assert.deepStrictEqual(sensorsOf(byMac(view, 'BB')), { Motion: true, Sound: true }, 'a camera with no AI labels has them too')
})

test('Motion and Sound follow the camera\'s own setting', () => {
  const off = page.buildView(detected, entry([{ mac: 'BB', motionSensor: 'off', soundSensor: 'on' }]))
  assert.deepStrictEqual(sensorsOf(byMac(off, 'BB')), { Motion: false, Sound: true })
  const on = page.buildView(detected, entry([{ mac: 'AA', soundSensor: 'on' }]))
  assert.deepStrictEqual(sensorsOf(byMac(on, 'AA')), { Motion: true, Sound: true }, '"on" shows a sensor the camera has not reported')
})

test('unticking Motion saves "off", and ticking it again goes back to automatic', () => {
  const config = entry([{ mac: 'BBCCDDEEFF00', name: 'Garage' }])
  const view = byMac(page.buildView(wide, config), 'BBCCDDEEFF00')
  view.sensors[0].checked = false
  const modes = page.modesFor(view.sensors)
  assert.deepStrictEqual(modes, { motionSensor: 'off', soundSensor: 'auto' })
  const saved = page.prepareSave(config, 'BBCCDDEEFF00', 'Garage', null, modes)
  assert.strictEqual(saved.ok, true)
  assert.deepStrictEqual(saved.next[0].cameras, [{ mac: 'BBCCDDEEFF00', name: 'Garage', motionSensor: 'off' }])
  const again = byMac(page.buildView(wide, saved.next), 'BBCCDDEEFF00')
  again.sensors[0].checked = true
  const back = page.prepareSave(saved.next, 'BBCCDDEEFF00', 'Garage', null, page.modesFor(again.sensors))
  assert.strictEqual(back.ok, true)
  assert.deepStrictEqual(back.next[0].cameras, [{ mac: 'BBCCDDEEFF00', name: 'Garage' }])
})

test('ticking a sensor the camera has not reported turns it on; a camera with no row gets one only when needed', () => {
  const config = entry([])
  const view = byMac(page.buildView(wide, config), 'AABBCCDDEEFF')
  assert.strictEqual(page.prepareSave(config, 'AABBCCDDEEFF', 'Front', null, page.modesFor(view.sensors)).next[0].cameras.length, 0, 'nothing changed, so no row')
  view.sensors[1].checked = true
  const modes = page.modesFor(view.sensors)
  assert.strictEqual(modes.soundSensor, 'on')
  assert.deepStrictEqual(page.prepareSave(config, 'AABBCCDDEEFF', 'Front', null, modes).next[0].cameras, [{ mac: 'AABBCCDDEEFF', name: 'Front', soundSensor: 'on' }])
})

test('saving Motion and Sound leaves the AI list alone when the camera has none to show', () => {
  const config = entry([{ mac: 'BBCCDDEEFF00', name: 'Garage', detections: ['person'] }])
  const result = page.prepareSave(config, 'BBCCDDEEFF00', 'Garage', null, { motionSensor: 'off', soundSensor: 'auto' })
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.next[0].cameras[0].detections, ['person'])
})

test('a Motion or Sound change that is not one of auto, on, off is refused, and nothing else may change', () => {
  const config = entry([{ mac: 'BBCCDDEEFF00', name: 'Garage', cameraPollingInterval: 5 }])
  const bad = page.prepareSave(config, 'BBCCDDEEFF00', 'Garage', null, { motionSensor: 'banana' })
  assert.strictEqual(bad.ok, false)
  assert.match(bad.errors.join(';'), /not a valid motionSensor/)
  const next = JSON.parse(JSON.stringify(config))
  next[0].cameras[0].cameraPollingInterval = 1
  next[0].cameras[0].motionSensor = 'off'
  assert.ok(page.problemsWith(config, next, 'BBCCDDEEFF00', null, { motionSensor: 'off' }).length > 0, 'another setting changed')
  const stray = JSON.parse(JSON.stringify(config))
  stray[0].cameras[0].soundSensor = 'off'
  assert.ok(page.problemsWith(config, stray, 'BBCCDDEEFF00', null, { motionSensor: 'auto' }).length > 0, 'Sound changed when only Motion was chosen')
})
