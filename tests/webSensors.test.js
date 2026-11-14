/**
 * The sensors: the camera test page shows them read-only from config.json, and the plugin's settings screen
 * (homebridge-ui) saves a choice through Homebridge's own UI after the server has checked it.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createWebSensors } = require('../src/webSensors')
const detectedSensors = require('../src/detectedSensors')
const view = require('../src/detectedView')

const MAC = 'AABBCCDDEEFF'
const FOUND = { mac: MAC, name: 'Front Doorbell', model: 'HL_DB2', motion: true, sound: true, soundRecording: true, labels: ['person', 'package'], unnamed: [] }

function setup (platform = {}, found = FOUND) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-sensors-'))
  const file = path.join(dir, 'config.json')
  const config = { bridge: { name: 'Test' }, platforms: [{ platform: 'WyzeSmartHome', name: 'Wyze', username: 'u', password: 'p', ...platform }] }
  fs.writeFileSync(file, JSON.stringify(config, null, 4) + '\n', { mode: 0o600 })
  detectedSensors.record(dir, found)
  const sensors = createWebSensors({ configPath: () => file, platformAlias: 'WyzeSmartHome', instanceName: 'Wyze', storagePath: () => dir })
  return { dir, file, sensors, entry: () => JSON.parse(fs.readFileSync(file, 'utf8')).platforms[0] }
}

// ---- the camera test page: read-only ----

test('describe lists each camera with Motion and Sound first, then its AI labels, as the file reads now', async () => {
  const { sensors } = setup()
  const data = await sensors.describe()
  assert.strictEqual(data.cameras.length, 1)
  const cam = data.cameras[0]
  assert.strictEqual(cam.id, MAC)
  assert.strictEqual(cam.name, 'Front Doorbell')
  assert.deepStrictEqual(cam.items.map((i) => i.key), ['motionSensor', 'soundSensor', 'person', 'package'])
  assert.deepStrictEqual(cam.items.map((i) => i.checked), [true, true, true, true])
  assert.strictEqual(cam.items.find((i) => i.key === 'person').ai, true)
  assert.strictEqual(cam.items[0].ai, false)
  assert.strictEqual(cam.notAuto, false)
})

test('describe follows the config file, not anything remembered, and never writes it', async () => {
  const { sensors, file, entry } = setup()
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  config.platforms[0].cameras = [{ mac: MAC, detections: ['person'], motionSensor: 'off' }]
  fs.writeFileSync(file, JSON.stringify(config))
  const before = fs.readFileSync(file, 'utf8')
  const cam = (await sensors.describe()).cameras[0]
  assert.deepStrictEqual(Object.fromEntries(cam.items.map((i) => [i.key, i.checked])), { motionSensor: false, soundSensor: true, person: true, package: false })
  assert.strictEqual(cam.notAuto, true)
  assert.match(cam.setting, /Chosen: person/)
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before)
  assert.strictEqual(sensors.save, undefined)
  assert.ok(entry())
})

test('with nothing noted yet there are no cameras, and a missing or broken config says so plainly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-sensors-'))
  const file = path.join(dir, 'config.json')
  const make = (configPath) => createWebSensors({ configPath: () => configPath, platformAlias: 'WyzeSmartHome', storagePath: () => dir })
  fs.writeFileSync(file, JSON.stringify({ platforms: [{ platform: 'WyzeSmartHome' }] }))
  assert.deepStrictEqual((await make(file).describe()).cameras, [])
  await assert.rejects(() => make(path.join(dir, 'missing.json')).describe(), /could not read config.json/)
  fs.writeFileSync(file, '{ not json')
  await assert.rejects(() => make(file).describe(), /not valid JSON/)
  fs.writeFileSync(file, JSON.stringify({ platforms: [{ platform: 'Other' }] }))
  await assert.rejects(() => make(file).describe(), /not in config.json/)
})

// ---- the settings screen: the choice is checked on the server, then saved by Homebridge's UI ----

const detectedFile = (found = FOUND) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-sensors-'))
  detectedSensors.record(dir, found)
  return detectedSensors.read(dir)
}
const entryWith = (extra = {}) => [{ platform: 'WyzeSmartHome', name: 'Wyze', ...extra }]

test('unticking a label gives the list to save, and only that camera\'s row changes', () => {
  const config = entryWith()
  const result = view.prepareChoice(detectedFile(), config, MAC, { ticks: { package: false } })
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.name, 'Front Doorbell')
  assert.deepStrictEqual(result.next[0].cameras, [{ mac: MAC, name: 'Front Doorbell', detections: ['person'] }])
  assert.deepStrictEqual({ ...result.next[0], cameras: undefined }, { ...config[0], cameras: undefined })
  assert.strictEqual(config[0].cameras, undefined, 'the config it was given is not changed')
})

test('Motion off saves "off" and leaves the AI list alone', () => {
  const result = view.prepareChoice(detectedFile(), entryWith(), MAC, { ticks: { motionSensor: false } })
  assert.deepStrictEqual(result.next[0].cameras, [{ mac: MAC, name: 'Front Doorbell', motionSensor: 'off' }])
})

test('back to automatic removes the choices', () => {
  const chosen = view.prepareChoice(detectedFile(), entryWith(), MAC, { ticks: { package: false, motionSensor: false } })
  const back = view.prepareChoice(detectedFile(), chosen.next, MAC, { auto: true })
  assert.deepStrictEqual(back.next[0].cameras, [{ mac: MAC, name: 'Front Doorbell' }])
})

test('a camera the plugin has not found, an unknown item or a non-boolean tick is refused', () => {
  for (const [id, choice] of [['nope', { ticks: { person: false } }], [MAC, { ticks: { starship: true } }], [MAC, { ticks: { person: 'no' } }], [MAC, {}], [MAC, { ticks: [] }], [42, { auto: true }]]) {
    const result = view.prepareChoice(detectedFile(), entryWith(), id, choice)
    assert.strictEqual(result.ok, false, JSON.stringify([id, choice]))
    assert.ok(result.errors.length > 0)
  }
})

test('a blocked sensor (sound recording off) is left as it is', () => {
  const found = { mac: MAC, name: 'Garage', model: 'HL_CAM3', motion: true, sound: false, soundRecording: false, labels: [], unnamed: [] }
  const cam = view.presentCameras(detectedFile(found), entryWith())[0]
  const sound = cam.items.find((i) => i.key === 'soundSensor')
  assert.strictEqual(sound.blocked, true)
  assert.match(sound.warning, /Sound recording is off/)
  const result = view.prepareChoice(detectedFile(found), entryWith(), MAC, { ticks: { motionSensor: false, soundSensor: true } })
  assert.strictEqual(result.next[0].cameras[0].motionSensor, 'off')
  assert.strictEqual(result.next[0].cameras[0].soundSensor, undefined)
})

test('a config with no cameras list is the same as one with an empty list', () => {
  const result = view.prepareChoice(detectedFile(), entryWith(), MAC, { ticks: { package: false } })
  assert.strictEqual(result.ok, true)
  const empty = view.prepareChoice(detectedFile(), entryWith({ cameras: [] }), MAC, { ticks: { package: false } })
  assert.strictEqual(empty.ok, true)
})

// The settings screen's server is run as Homebridge runs it: a child process that is sent requests over IPC.
function ask (storagePath, requestPath, body = {}) {
  const { fork } = require('node:child_process')
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, '../homebridge-ui/server.js'), [], { env: { ...process.env, HOMEBRIDGE_STORAGE_PATH: storagePath }, silent: true })
    const timer = setTimeout(() => { child.kill(); reject(new Error('the server did not answer')) }, 10000)
    child.on('error', reject)
    child.on('message', (message) => {
      if (message.action === 'ready') child.send({ action: 'request', requestId: 'r1', path: requestPath, body })
      if (message.action === 'response') { clearTimeout(timer); child.kill(); resolve(message.payload) }
    })
  })
}

test('the settings screen\'s server shows the cameras for the config it is given', async () => {
  const { dir } = setup()
  const answer = await ask(dir, '/view', { config: entryWith({ cameras: [{ mac: MAC, detections: ['person'] }] }) })
  assert.strictEqual(answer.success, true)
  assert.strictEqual(answer.data.cameras[0].name, 'Front Doorbell')
  assert.strictEqual(answer.data.cameras[0].items.find((i) => i.key === 'package').checked, false)
  const empty = await ask(fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-ui-')), '/view', { config: [] })
  assert.deepStrictEqual(empty.data.cameras, [])
})

test('the settings screen\'s server checks a change and answers with the config to save, or the reasons not to', async () => {
  const { dir } = setup()
  const good = await ask(dir, '/prepare', { config: entryWith(), id: MAC, choice: { ticks: { package: false } } })
  assert.strictEqual(good.data.ok, true)
  assert.deepStrictEqual(good.data.next[0].cameras[0].detections, ['person'])
  const bad = await ask(dir, '/prepare', { config: entryWith(), id: MAC, choice: { ticks: { starship: true } } })
  assert.strictEqual(bad.data.ok, false)
  const none = await ask(dir, '/prepare', {})
  assert.strictEqual(none.data.ok, false)
})

test('the settings screen\'s server gives the camera test page\'s links, and none when it is off', async () => {
  const { dir } = setup()
  assert.deepStrictEqual((await ask(dir, '/web-link')).data, { port: null, urls: [] })
  require('../src/webPageLink').write(dir, { port: 8585, urls: ['http://10.0.0.2:8585/?token=abc'] })
  assert.deepStrictEqual((await ask(dir, '/web-link')).data, { port: 8585, urls: ['http://10.0.0.2:8585/?token=abc'] })
})

test('the settings screen is a real custom page: the schema turns it on, and it saves only through Homebridge\'s UI after the server\'s check', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.schema.json'), 'utf8'))
  assert.strictEqual(schema.customUi, true)
  assert.ok(require('../package.json').dependencies['@homebridge/plugin-ui-utils'])
  assert.strictEqual(require('../homebridge-ui/package.json').type, 'module')
  const html = fs.readFileSync(path.join(__dirname, '../homebridge-ui/public/index.html'), 'utf8')
  for (const call of ['homebridge.showSchemaForm', "homebridge.request('/view'", "homebridge.request('/prepare'", "homebridge.request('/web-link')", 'homebridge.getPluginConfig', 'homebridge.updatePluginConfig', 'homebridge.savePluginConfig']) {
    assert.ok(html.includes(call), `the page does not call ${call}`)
  }
  assert.ok(!html.includes('innerHTML'), 'camera names come from Wyze, so the page builds its elements as text')
  const save = html.slice(html.indexOf('async function save'), html.indexOf('function card'))
  const check = save.indexOf('if (!prepared || !prepared.ok)')
  const returns = save.indexOf('return;', check)
  const update = save.indexOf('homebridge.updatePluginConfig')
  assert.ok(check > 0 && returns > check && returns < update, 'a refused change returns before anything is updated or saved')
  assert.ok(save.indexOf('homebridge.savePluginConfig') > update)
  assert.match(save, /JSON\.stringify\(baseConfig\) !== JSON\.stringify\(config\)/, 'unsaved edits in the form block the save')
  assert.ok(!fs.existsSync(path.join(__dirname, '../homebridge-ui/public/detected.js')), 'the logic has one copy, in src/detectedView.js')
})

test('the camera test page does not write the config', () => {
  for (const name of ['webSensors', 'webSettings', 'configFile']) {
    const source = fs.readFileSync(path.join(__dirname, `../src/${name}.js`), 'utf8')
    assert.ok(!/writeFile|renameSync/.test(source), `${name} writes a file`)
  }
})

// ---- the Night Vision switches checkbox ----

test('the checkbox sets cameras[].nightVision for that camera, and unticking removes it', () => {
  const on = view.prepareChoice(detectedFile(), entryWith(), MAC, { nightVision: true })
  assert.strictEqual(on.ok, true)
  assert.deepStrictEqual(on.next[0].cameras, [{ mac: MAC, name: 'Front Doorbell', nightVision: true }])
  assert.strictEqual(view.presentCameras(detectedFile(), on.next)[0].nightVision, true)
  const off = view.prepareChoice(detectedFile(), on.next, MAC, { nightVision: false })
  assert.strictEqual(off.ok, true)
  assert.deepStrictEqual(off.next[0].cameras, [{ mac: MAC, name: 'Front Doorbell' }])
  assert.strictEqual(view.presentCameras(detectedFile(), off.next)[0].nightVision, false)
})

test('the checkbox can go with sensor choices, and a sensor change leaves nightVision as it was', () => {
  const both = view.prepareChoice(detectedFile(), entryWith(), MAC, { ticks: { package: false }, nightVision: true })
  assert.deepStrictEqual(both.next[0].cameras, [{ mac: MAC, name: 'Front Doorbell', detections: ['person'], nightVision: true }])
  const sensorOnly = view.prepareChoice(detectedFile(), both.next, MAC, { ticks: { motionSensor: false } })
  assert.strictEqual(sensorOnly.next[0].cameras[0].nightVision, true)
  const back = view.prepareChoice(detectedFile(), both.next, MAC, { auto: true })
  assert.strictEqual(back.next[0].cameras[0].nightVision, true, 'back to automatic is about sensors, not night vision')
})

test('only true or false is accepted for the checkbox, and it changes nothing else', () => {
  for (const nightVision of ['yes', 1, null]) {
    assert.strictEqual(view.prepareChoice(detectedFile(), entryWith(), MAC, { nightVision }).ok, false, String(nightVision))
  }
  const config = entryWith({ cameras: [{ mac: MAC, name: 'Front Doorbell', siren: true, detections: ['person'] }] })
  const result = view.prepareChoice(detectedFile(), config, MAC, { nightVision: true })
  assert.deepStrictEqual(result.next[0].cameras, [{ mac: MAC, name: 'Front Doorbell', siren: true, detections: ['person'], nightVision: true }])
})

test('the settings page has the checkbox, and sends the choice only when it changed', () => {
  const html = fs.readFileSync(path.join(__dirname, '../homebridge-ui/public/index.html'), 'utf8')
  assert.match(html, /nightBox\.type = 'checkbox'/)
  assert.match(html, /if \(nightVision !== cam\.nightVision\) choice\.nightVision = nightVision/)
})
