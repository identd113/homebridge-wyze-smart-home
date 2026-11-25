/**
 * Fixes from the full code audit of the plugin: one refresh at a time, loops that stop, room sensors kept when one lookup
 * fails, a bad secrets file leaving the platform inert, and process handlers installed once.
 */
const test = require('node:test')
const assert = require('node:assert')

require('../src/types').update({
  hap: { Service: {}, Characteristic: { On: 'On' }, uuid: {}, Categories: {} },
  platformAccessory: class {},
  user: { persistPath: () => require('os').tmpdir() },
  registerPlatform: () => {}
})

const WyzeSmartHome = require('../src/WyzeSmartHome')
const WyzeRoomSensor = require('../src/accessories/WyzeRoomSensor')

const flat = { platform: 'WyzeSmartHome', username: 'a', password: 'b', keyId: 'k', apiKey: 'x', name: 'Wyze' }

function make (extra = {}) {
  const lines = []
  const log = (m) => lines.push(['log', m])
  for (const level of ['debug', 'info', 'warn', 'warning', 'error']) log[level] = (m) => lines.push([level, m])
  const api = { on: () => {}, unregisterPlatformAccessories: () => {}, hap: {}, user: { storagePath: () => require('os').tmpdir() } }
  return { platform: new WyzeSmartHome(log, { ...flat, ...extra }, api), lines }
}

test('two refreshes started together run once: the second gets the first\'s result', async () => {
  const { platform } = make()
  let runs = 0
  platform._refreshDevicesOnce = async () => { runs += 1; await new Promise((r) => setTimeout(r, 30)); return 'done' }
  const [a, b] = await Promise.all([platform.refreshDevices(), platform.refreshDevices()])
  assert.strictEqual(runs, 1)
  assert.strictEqual(a, b)
  await platform.refreshDevices()
  assert.strictEqual(runs, 2, 'a later refresh runs again')
})

test('after shutdown nothing refreshes and the loops end', async () => {
  const { platform } = make()
  let runs = 0
  platform._refreshDevicesOnce = async () => { runs += 1 }
  platform.shutdown()
  await platform.refreshDevices()
  await platform.refreshLockDevices()
  assert.strictEqual(runs, 0)
  platform.config.refreshInterval = 5
  await platform.runLoop() // returns at once: it checks the flag before each pass
  assert.strictEqual(runs, 0)
})

test('a secrets file that cannot be read leaves the platform inert, instead of throwing out of the constructor', () => {
  const { platform } = make({ auth: { secretsFile: '/nonexistent/wyze-secrets.json' } })
  assert.strictEqual(platform.disabled, true)
  assert.deepStrictEqual(platform.accessories, [])
})

test('a custom base URL without the explicit opt-in is ignored, and the platform starts normally', () => {
  const { platform } = make({ advanced: { authBaseUrl: 'https://evil.example.com' } })
  assert.ok(!platform.disabled)
  assert.strictEqual(platform.config.authBaseUrl, 'https://auth-prod.api.wyze.com')
})

test('the process-wide rejection handler is installed once, however many Wyze platforms there are, and there is no handler for uncaught exceptions', () => {
  const rejections = process.listenerCount('unhandledRejection')
  const exceptions = process.listenerCount('uncaughtException')
  make()
  make()
  make()
  assert.ok(process.listenerCount('unhandledRejection') - rejections <= 1)
  assert.strictEqual(process.listenerCount('uncaughtException'), exceptions, 'a fatal error must still stop Homebridge')
})

test('"Exclude by Device Type: Vacuum" excludes the robot vacuum, whose product type is its model code', () => {
  const { platform } = make({ excludes: { types: ['Vacuum'] } })
  assert.strictEqual(platform.isExcludedType({ product_type: 'JA_RO2', product_model: 'JA_RO2' }), true)
  assert.strictEqual(platform.isExcludedType({ product_type: 'Plug', product_model: 'WLPP1' }), false)
  const { platform: plugs } = make({ excludes: { types: ['Plug'] } })
  assert.strictEqual(plugs.isExcludedType({ product_type: 'Plug', product_model: 'WLPP1' }), true)
  assert.strictEqual(plugs.isExcludedType({ product_type: 'JA_RO2', product_model: 'JA_RO2' }), false)
})

test('room sensors of a thermostat whose lookup failed stay registered, as last seen; a thermostat that answered replaces them', async () => {
  const { platform } = make({ enableThermostatRoomSensors: true })
  const sensor = Object.create(WyzeRoomSensor.prototype)
  Object.defineProperty(sensor, 'mac', { value: 'SENSOR1' })
  sensor.lastDevice = { mac: 'SENSOR1', product_type: 'ThermostatRoomSensor', parent_device_mac: 'THERM1' }
  platform.accessories = [sensor]
  platform.client = {
    getObjectList: async () => ({ ts: 1, data: { device_list: [{ mac: 'THERM1', nickname: 'Hall', product_type: 'Thermostat', product_model: 'CO_EA1' }] } }),
    getThermostatSensors: async () => { throw new Error('Earth timed out') }
  }
  platform._propertyPoller = { prefetch: async () => {} }
  let seen
  platform.loadDevices = async (devices) => { seen = devices.map((d) => d.mac) }
  await platform._refreshDevicesOnce()
  assert.deepStrictEqual(seen, ['THERM1', 'SENSOR1'], 'the sensor is kept')

  platform.client.getThermostatSensors = async () => ({ data: { sensor_list: [] } })
  await platform._refreshDevicesOnce()
  assert.deepStrictEqual(seen, ['THERM1'], 'a successful lookup that lists none removes it')
})

// ---- cameras ----

const WyzeCamera = require('../src/accessories/WyzeCamera')

function camera (client = {}) {
  const acc = Object.create(WyzeCamera.prototype)
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: 'WYZE_CAKP2JFUS' }, displayName: 'Garage' }
  const log = Object.assign(() => {}, { error: () => {}, warn: () => {}, debug: () => {}, info: () => {} })
  acc.plugin = { config: {}, client, log }
  return acc
}

test('after Wyze accepts a siren, light, notification or motion detection change, the cached value follows at once', async () => {
  const ok = async () => ({})
  const acc = camera({ cameraSiren: ok, cameraSpotLight: ok, cameraFloodLight: ok, cameraNotifications: ok, cameraMotionOn: ok, cameraMotionOff: ok })
  await acc.handleOnSetAlarmSwitch(true)
  assert.strictEqual(await acc.handleOnGetAlarmSwitch(), 1)
  await acc.handleOnSetSpotlight(true)
  assert.strictEqual(await acc.handleOnGetSpotlight(), 1)
  assert.strictEqual(await acc.handleOnGetFloodlight(), 1, 'one light: the floodlight switch follows too')
  await acc.handleOnSetFloodlight(false)
  assert.strictEqual(await acc.handleOnGetSpotlight(), 0)
  await acc.setNotification(true)
  assert.strictEqual(await acc.getNotification(), 1)
  await acc.setMotionDetection(true)
  assert.strictEqual(await acc.getMotionDetection(), 1)
  await acc.setMotionDetection(false)
  assert.strictEqual(await acc.getMotionDetection(), 0)
})

test('a change Wyze refuses leaves the cached value as it was', async () => {
  const acc = camera({ cameraSiren: async () => { throw new Error('rate limited') } })
  acc.siren = 0
  await assert.rejects(() => acc.handleOnSetAlarmSwitch(true), /rate limited/)
  assert.strictEqual(acc.siren, 0)
})

test('a camera that was stopped does not start watching or refreshing again when an earlier lookup finishes', () => {
  const acc = camera()
  acc.detections = { stop () {}, any: () => true }
  acc._motionMember = null
  acc._streamingDelegate = { stopAll () {} }
  acc.stopStreams()
  acc.plugin._motionPoller = { add: () => { throw new Error('must not be added') } }
  acc._startEventWatch(true)
  acc._startSnapshotRefresh()
  assert.strictEqual(acc._motionMember, null)
  assert.ok(!acc._refreshMember)
  acc._watchMotion = true
  acc._checkMotion = () => { throw new Error('must not run') }
  acc._onEvents([{ id: 1 }])
})

test('when the live view cannot be prepared, HomeKit is told, and the failure is logged', async () => {
  const Delegate = require('../src/camera/WyzeCameraStreamingDelegate')
  const errors = []
  const cam = camera({ prepareCameraHKStream: async () => { throw new Error('no free UDP port') } })
  cam.plugin.log.error = (m) => errors.push(m)
  Object.defineProperty(cam, 'display_name', { value: 'Garage' })
  const delegate = Object.create((Delegate.WyzeCameraStreamingDelegate || Delegate).prototype)
  delegate.camera = cam
  delegate._sessions = new Map()
  delegate._streamActive = () => false
  delegate._warmState = () => null
  const answers = []
  await delegate.prepareStream({ sessionID: Buffer.from('abcd', 'hex'), targetAddress: '10.0.0.2', video: { port: 5000 } }, (err, res) => answers.push([err && err.message, res]))
  assert.deepStrictEqual(answers, [['no free UDP port', undefined]])
  assert.match(errors.join(), /could not prepare the live view: no free UDP port/)
})

// ---- smaller fixes ----

test('a deviceTypeOverrides category named like an Object property is ignored, and nothing is written into Object', () => {
  const enums = require('../src/enums')
  const warnings = []
  const result = enums.applyConfigOverrides(JSON.parse('{"__proto__": ["BAD1"], "constructor": ["BAD2"], "toString": ["BAD3"]}'), { warn: (m) => warnings.push(m) })
  assert.strictEqual(result.added, 0)
  assert.deepStrictEqual([...result.unknownCategories].sort(), ['__proto__', 'constructor', 'toString'])
  assert.strictEqual(warnings.length, 3)
  assert.strictEqual({}.Override0, undefined)
  assert.strictEqual(Object.Override0, undefined)
})

test('one camera\'s event handler failing does not stop the other cameras being given their events', async () => {
  const MotionPoller = require('../src/camera/motionPoller')
  const Poller = MotionPoller.MotionPoller || MotionPoller
  const got = []
  const members = [
    { mac: 'A', everyMs: 10, online: () => true, onEvents: () => { throw new Error('boom') }, reset () {} },
    { mac: 'B', everyMs: 10, online: () => true, onEvents: (e) => got.push(['B', e]), reset () {} }
  ]
  const poller = new Poller({ cameraGetEventsMulti: async () => [] }, { log: { debug () {} } })
  poller._readEvents = async () => ({ A: [{ id: 1 }], B: [{ id: 2 }] })
  for (const m of members) poller.add(m)
  await poller.poll()
  assert.deepStrictEqual(got, [['B', [{ id: 2 }]]])
  assert.strictEqual(poller.failures, 0, 'not counted as a failed poll')
})

// ---- mesh light colour, lock failures ----

function meshLight (client) {
  const WyzeMeshLight = require('../src/accessories/WyzeMeshLight')
  const acc = Object.create(WyzeMeshLight.prototype)
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: 'HL_LSL' }, displayName: 'Strip' }
  const errors = []
  const log = Object.assign(() => {}, { error: (m) => errors.push(m), warn () {}, debug () {}, info () {} })
  acc.plugin = { config: {}, client, log }
  acc.cache = {}
  return { acc, errors }
}

test('a mesh light colour is sent once with both halves, whether HomeKit sends hue and saturation together or only one', async () => {
  const sent = []
  const client = { homeKitColorToWyze: (h, s) => `c${h}-${s}`, setMeshHue: async (m, mo, v) => sent.push(['hue', v]), setMeshSaturation: async (m, mo, v) => sent.push(['sat', v]) }
  const { acc } = meshLight(client)
  acc.cache = { hue: 10, saturation: 20 }
  await acc.setHue(120)
  await acc.setSaturation(50)
  await new Promise((r) => setTimeout(r, 220))
  assert.deepStrictEqual(sent, [['sat', 'c120-50']], 'one colour, from both writes')
  await acc.setSaturation(80) // only saturation changes: the colour still goes out, with the hue it has
  await new Promise((r) => setTimeout(r, 220))
  assert.deepStrictEqual(sent[1], ['sat', 'c120-80'])
})

test('a mesh light colour is not sent before both hue and saturation are known', async () => {
  let called = 0
  const { acc } = meshLight({ homeKitColorToWyze: () => { called += 1; return 'x' }, setMeshHue: async () => {}, setMeshSaturation: async () => {} })
  await acc.setHue(120)
  await new Promise((r) => setTimeout(r, 220))
  assert.strictEqual(called, 0)
})

test('a mesh light brightness sent as text is read as that number, not 1%, and a non-number is skipped', () => {
  const { propertyIds: PIDs } = require('wyze-api')
  const { acc } = meshLight({ checkBrightnessValue: (v) => (typeof v !== 'number' || Number.isNaN(v) ? 1 : v) })
  let shown
  acc.getCharacteristic = () => ({ updateValue: (v) => { shown = v } })
  acc.updateBrightness('70')
  assert.strictEqual(shown, 70)
  assert.strictEqual(acc.isValidProperty({ pid: PIDs.BRIGHTNESS, value: '70' }), true)
  assert.strictEqual(acc.isValidProperty({ pid: PIDs.BRIGHTNESS, value: 'abc' }), false)
  assert.strictEqual(acc.isValidProperty({ pid: PIDs.COLOR, value: 'FF00AA' }), true, 'a hex colour is not a number')
})

test('a failed light, plug or lock command is logged as an error whatever the log level', async () => {
  const { acc, errors } = meshLight({ lightMeshPower: async () => { throw new Error('Wyze said no') } })
  acc.armCommandGrace = () => {}
  acc.clearCommandGrace = () => {}
  await acc.setOn(true)
  await new Promise((r) => setImmediate(r))
  assert.match(errors.join(), /Command failed for .*Wyze said no/)
})

test('an unread Lock Bolt v2 reads as unknown, not secured', async () => {
  const WyzeLockBoltV2 = require('../src/accessories/WyzeLockBoltV2')
  const { Characteristic } = require('../src/types')
  Characteristic.LockCurrentState = { SECURED: 1, UNSECURED: 0, UNKNOWN: 3 }
  const acc = Object.create(WyzeLockBoltV2.prototype)
  acc.isLocked = undefined
  assert.strictEqual(await acc.getLockCurrentState(), 3)
  acc.isLocked = false
  assert.strictEqual(await acc.getLockCurrentState(), 0)
})
