/**
 * The camera test page's sensors panel reads config.json fresh and writes a camera's choice straight back to it.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createWebSensors } = require('../src/webSensors')
const detectedSensors = require('../src/detectedSensors')

const MAC = 'AABBCCDDEEFF'

function setup (platform = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-sensors-'))
  const file = path.join(dir, 'config.json')
  const config = { bridge: { name: 'Test' }, platforms: [{ platform: 'WyzeSmartHome', name: 'Wyze', username: 'u', password: 'p', ...platform }] }
  fs.writeFileSync(file, JSON.stringify(config, null, 4) + '\n', { mode: 0o600 })
  detectedSensors.record(dir, { mac: MAC, name: 'Front Doorbell', model: 'HL_DB2', motion: true, sound: true, soundRecording: true, labels: ['person', 'package'], unnamed: [] })
  const sensors = createWebSensors({ configPath: () => file, platformAlias: 'WyzeSmartHome', instanceName: 'Wyze', storagePath: () => dir })
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'))
  return { dir, file, sensors, read }
}

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

test('describe follows the config file, not anything remembered', async () => {
  const { sensors, file, read } = setup()
  const config = read()
  config.platforms[0].cameras = [{ mac: MAC, detections: ['person'], motionSensor: 'off' }]
  fs.writeFileSync(file, JSON.stringify(config))
  const cam = (await sensors.describe()).cameras[0]
  assert.deepStrictEqual(Object.fromEntries(cam.items.map((i) => [i.key, i.checked])), { motionSensor: false, soundSensor: true, person: true, package: false })
  assert.strictEqual(cam.notAuto, true)
  assert.match(cam.setting, /Chosen: person/)
})

test('unticking a label saves the list to config.json, and only that camera\'s row changes', async () => {
  const { sensors, read } = setup()
  const before = read()
  const result = await sensors.save(MAC, { ticks: { package: false } })
  assert.deepStrictEqual(result, { saved: true, restartNeeded: true })
  const after = read()
  assert.deepStrictEqual(after.platforms[0].cameras, [{ mac: MAC, name: 'Front Doorbell', detections: ['person'] }])
  assert.deepStrictEqual({ ...after.platforms[0], cameras: undefined }, { ...before.platforms[0], cameras: undefined })
  assert.deepStrictEqual(after.bridge, before.bridge)
  const cam = (await sensors.describe()).cameras[0]
  assert.strictEqual(cam.items.find((i) => i.key === 'package').checked, false)
})

test('Motion off saves "off" and leaves the AI list alone', async () => {
  const { sensors, read } = setup()
  await sensors.save(MAC, { ticks: { motionSensor: false } })
  assert.deepStrictEqual(read().platforms[0].cameras, [{ mac: MAC, name: 'Front Doorbell', motionSensor: 'off' }])
})

test('back to automatic removes the choices', async () => {
  const { sensors, read } = setup()
  await sensors.save(MAC, { ticks: { package: false, motionSensor: false } })
  await sensors.save(MAC, { auto: true })
  assert.deepStrictEqual(read().platforms[0].cameras, [{ mac: MAC, name: 'Front Doorbell' }])
})

test('a write keeps a backup, the file\'s mode and its indentation', async () => {
  const { sensors, file } = setup()
  const raw = fs.readFileSync(file, 'utf8')
  await sensors.save(MAC, { ticks: { package: false } })
  assert.strictEqual(fs.readFileSync(`${file}.web-settings.bak`, 'utf8'), raw)
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600)
  assert.match(fs.readFileSync(file, 'utf8'), /^ {4}"bridge"/m)
})

test('a camera the plugin has not found, an unknown item or a non-boolean tick is refused and nothing is written', async () => {
  const { sensors, file } = setup()
  const raw = fs.readFileSync(file, 'utf8')
  for (const [id, choice] of [['nope', { ticks: { person: false } }], [MAC, { ticks: { starship: true } }], [MAC, { ticks: { person: 'no' } }], [MAC, {}], [MAC, { ticks: [] }], [42, { auto: true }]]) {
    await assert.rejects(() => sensors.save(id, choice), (e) => e.status === 400)
  }
  assert.strictEqual(fs.readFileSync(file, 'utf8'), raw)
})

test('a blocked sensor (sound recording off) is left as it is', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-sensors-'))
  const file = path.join(dir, 'config.json')
  fs.writeFileSync(file, JSON.stringify({ platforms: [{ platform: 'WyzeSmartHome', name: 'Wyze' }] }))
  detectedSensors.record(dir, { mac: MAC, name: 'Garage', model: 'HL_CAM3', motion: true, sound: false, soundRecording: false, labels: [], unnamed: [] })
  const sensors = createWebSensors({ configPath: () => file, platformAlias: 'WyzeSmartHome', storagePath: () => dir })
  const cam = (await sensors.describe()).cameras[0]
  const sound = cam.items.find((i) => i.key === 'soundSensor')
  assert.strictEqual(sound.blocked, true)
  assert.match(sound.warning, /Sound recording is off/)
  await sensors.save(MAC, { ticks: { motionSensor: false, soundSensor: true } })
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).platforms[0].cameras[0]
  assert.strictEqual(saved.motionSensor, 'off')
  assert.strictEqual(saved.soundSensor, undefined)
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

test('the plugin hands the page its sensors, and the old custom settings page is gone', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/WyzeSmartHome.js'), 'utf8')
  assert.match(source, /sensors: this\.webSensors\(\)/)
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.schema.json'), 'utf8'))
  assert.strictEqual(schema.customUi, undefined)
  assert.ok(!fs.existsSync(path.join(__dirname, '../homebridge-ui')))
})
