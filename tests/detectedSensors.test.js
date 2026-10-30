/**
 * What the plugin found each camera can have is left in a file for the plugin's settings page. Writing it
 * must be safe: atomic, private, only when something changed, and never able to get in the camera's way.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const detectedSensors = require('../src/detectedSensors')

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-detected-'))
const found = { mac: 'AABBCCDDEEFF', name: 'Front Doorbell', model: 'HL_DB2', motion: true, sound: false, labels: ['person', 'pet'], unnamed: [] }
const at = (iso) => () => new Date(iso)

test('a camera\'s findings are written and read back', () => {
  const storage = dir()
  assert.strictEqual(detectedSensors.record(storage, found, at('2026-10-30T12:00:00Z')), true)
  const data = detectedSensors.read(storage)
  assert.strictEqual(data.version, 1)
  assert.deepStrictEqual(data.cameras.AABBCCDDEEFF, { name: 'Front Doorbell', model: 'HL_DB2', motion: true, sound: false, labels: ['person', 'pet'], unnamed: [], at: '2026-10-30T12:00:00.000Z' })
})

test('the file is private and sits in the plugin\'s own folder', () => {
  const storage = dir()
  detectedSensors.record(storage, found)
  const file = detectedSensors.filePath(storage)
  assert.ok(file.endsWith(path.join('homebridge-wyze-smart-home', 'detected-sensors.json')))
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600)
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['detected-sensors.json'], 'no temporary file is left behind')
})

test('finding the same thing again does not rewrite the file or change its time', () => {
  const storage = dir()
  detectedSensors.record(storage, found, at('2026-10-30T12:00:00Z'))
  assert.strictEqual(detectedSensors.record(storage, { ...found }, at('2026-10-31T09:00:00Z')), false)
  assert.strictEqual(detectedSensors.read(storage).cameras.AABBCCDDEEFF.at, '2026-10-30T12:00:00.000Z')
})

test('a changed finding is written with a new time, and the other cameras are kept', () => {
  const storage = dir()
  detectedSensors.record(storage, found, at('2026-10-30T12:00:00Z'))
  detectedSensors.record(storage, { ...found, mac: 'BBCCDDEEFF00', name: 'Garage', labels: [] }, at('2026-10-30T12:01:00Z'))
  assert.strictEqual(detectedSensors.record(storage, { ...found, labels: ['person', 'pet', 'face'] }, at('2026-11-01T08:00:00Z')), true)
  const { cameras } = detectedSensors.read(storage)
  assert.deepStrictEqual(cameras.AABBCCDDEEFF.labels, ['person', 'pet', 'face'])
  assert.strictEqual(cameras.AABBCCDDEEFF.at, '2026-11-01T08:00:00.000Z')
  assert.strictEqual(cameras.BBCCDDEEFF00.name, 'Garage')
})

test('a missing, empty or broken file reads as nothing found', () => {
  const storage = dir()
  assert.deepStrictEqual(detectedSensors.read(storage), { version: 1, cameras: {} })
  fs.mkdirSync(path.dirname(detectedSensors.filePath(storage)), { recursive: true })
  fs.writeFileSync(detectedSensors.filePath(storage), '{ not json')
  assert.deepStrictEqual(detectedSensors.read(storage), { version: 1, cameras: {} })
  fs.writeFileSync(detectedSensors.filePath(storage), JSON.stringify({ cameras: 5 }))
  assert.deepStrictEqual(detectedSensors.read(storage), { version: 1, cameras: {} })
  assert.strictEqual(detectedSensors.record(storage, found), true, 'a broken file is replaced')
})

test('a storage path that cannot be written to is not an error', () => {
  const file = path.join(dir(), 'a-file')
  fs.writeFileSync(file, 'x')
  assert.strictEqual(detectedSensors.record(path.join(file, 'below-a-file'), found), false)
})

test('the camera records what it found, using Homebridge\'s storage path, and never fails because of it', () => {
  const MotionSensor = { name: 'MotionSensor', UUID: 'ms' }
  require('../src/types').update({
    hap: { Service: { MotionSensor }, Characteristic: { MotionDetected: {}, Name: {}, ConfiguredName: {}, On: {} }, uuid: {}, Categories: {} },
    platformAccessory: class {}
  })
  const WyzeCamera = require('../src/accessories/WyzeCamera')
  const storage = dir()
  const acc = Object.create(WyzeCamera.prototype)
  acc.mac = 'AABBCCDDEEFF'
  acc.homeKitAccessory = { displayName: 'Front Doorbell', context: { mac: 'AABBCCDDEEFF', product_model: 'HL_DB2' } }
  acc.plugin = { config: { motionSensorAccessory: ['AABBCCDDEEFF'], soundSensorAccessory: [], soundSensorOff: [], motionSensorOff: [] }, api: { user: { storagePath: () => storage } } }
  acc._recordDetected({ found: ['Person', 'Face'], unnamed: [777] })
  assert.deepStrictEqual(detectedSensors.read(storage).cameras.AABBCCDDEEFF, {
    name: 'Front Doorbell', model: 'HL_DB2', motion: true, sound: false, labels: ['person', 'face'], unnamed: [777],
    at: detectedSensors.read(storage).cameras.AABBCCDDEEFF.at
  })
  acc.plugin.api = undefined
  acc._recordDetected({ found: [], unnamed: [] }) // no storage path: quietly nothing
  acc._recordDetected(undefined)
})

// ---- nothing is written unless the entry passes the checks -----------------------------------------------

test('an entry that fails a check is not written, and the file is left as it was', () => {
  const storage = dir()
  detectedSensors.record(storage, found)
  const before = fs.readFileSync(detectedSensors.filePath(storage), 'utf8')
  const bad = [
    { ...found, mac: 'AA' },
    { ...found, mac: '' },
    { ...found, mac: undefined },
    { ...found, name: 5 },
    { ...found, name: 'x'.repeat(101) },
    { ...found, model: undefined },
    { ...found, motion: 'yes' },
    { ...found, sound: undefined },
    { ...found, labels: 'person' },
    { ...found, labels: ['Person'] },
    { ...found, labels: ['<script>'] },
    { ...found, labels: ['person', 'person'] },
    { ...found, labels: [5] },
    { ...found, labels: Array.from({ length: 51 }, (_, i) => `item${i}`) },
    { ...found, unnamed: ['777'] },
    { ...found, unnamed: [1.5] },
    { ...found, unnamed: 'none' },
    null,
    undefined,
    'a camera'
  ]
  for (const entry of bad) {
    assert.strictEqual(detectedSensors.isValid(entry), false, JSON.stringify(entry))
    assert.strictEqual(detectedSensors.record(storage, entry), false, JSON.stringify(entry))
  }
  assert.strictEqual(fs.readFileSync(detectedSensors.filePath(storage), 'utf8'), before, 'the file is byte for byte as it was')
})

test('an entry that fails a check is not written even when there is no file yet', () => {
  const storage = dir()
  assert.strictEqual(detectedSensors.record(storage, { ...found, labels: ['<b>'] }), false)
  assert.strictEqual(fs.existsSync(detectedSensors.filePath(storage)), false, 'no file, and no folder content, is created')
})

test('real entries pass: ordinary names, the plugin\'s labels, and the Star Trek test names', () => {
  for (const labels of [[], ['person', 'vehicle', 'pet', 'package', 'face'], ['starship', 'tribble', 'photon', 'cloaking']]) {
    assert.strictEqual(detectedSensors.isValid({ ...found, labels }), true, JSON.stringify(labels))
  }
  assert.strictEqual(detectedSensors.isValid({ ...found, mac: '80482C565064', name: 'Back Yard Cam', model: 'WYZE_CAKP2JFUS', unnamed: [901, 902] }), true)
})
