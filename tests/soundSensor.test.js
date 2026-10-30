/**
 * The Motion and Sound sensors: "auto" by default (added when the camera's event list shows events of
 * that kind), "on" or "off" per camera. A sensor reacts only to an event under 30 seconds old.
 */
const test = require('node:test')
const assert = require('node:assert')

const MotionSensor = { name: 'MotionSensor', UUID: 'ms' }
const MotionDetected = { name: 'MotionDetected' }
require('../src/types').update({
  hap: {
    Service: { MotionSensor, Switch: { UUID: 'sw' } },
    Characteristic: { MotionDetected, Name: { name: 'Name' }, ConfiguredName: { name: 'ConfiguredName' }, On: { name: 'On' } },
    uuid: {},
    Categories: {}
  },
  platformAccessory: class {}
})

const WyzeCamera = require('../src/accessories/WyzeCamera')
const { normalize } = require('../src/configMigrator')

function service (type, subtype) {
  const updates = []
  const characteristic = () => {
    const c = { onGet: () => c, onSet: () => c, updateValue: (v) => updates.push(v) }
    return c
  }
  return { UUID: type.UUID, subtype, updates, getCharacteristic: characteristic, setCharacteristic: () => {} }
}

function homeKit (services = []) {
  const hk = {
    displayName: 'Cam',
    context: { mac: 'AA', product_type: 'Camera', product_model: 'WYZE_CAKP2JFUS' },
    services,
    removed: [],
    getService: () => undefined,
    getServiceById: (type, subtype) => hk.services.find((s) => s.UUID === type.UUID && s.subtype === subtype),
    addService: (type, name, subtype) => { const s = service(type, subtype); hk.services.push(s); return s },
    removeService: (s) => { hk.removed.push(s.subtype || '(none)'); hk.services = hk.services.filter((x) => x !== s) }
  }
  return hk
}

function config (extra = {}) {
  return { motionSensorAccessory: [], motionSensorOff: [], soundSensorAccessory: [], soundSensorOff: [], ...extra }
}

function camera ({ cfg = config(), events = [], seen } = {}) {
  const acc = Object.create(WyzeCamera.prototype)
  const asked = []
  acc.homeKitAccessory = homeKit()
  acc.plugin = {
    config: cfg,
    log: Object.assign(() => {}, { debug: () => {} }),
    client: {
      cameraGetEvents: async (mac, options) => { asked.push(options); return typeof events === 'function' ? events(options) : events }
    }
  }
  acc._sensorsSeen = seen
  acc.asked = asked
  acc.refreshes = 0
  acc._streamingDelegate = { refreshSnapshot: () => { acc.refreshes += 1 } }
  acc._startEventWatch = () => {}
  return acc
}

const sound = (id, ageMs) => ({ id, type: 'SOUND', value: 2, ageMs, time: 1 })
const motion = (id, ageMs) => ({ id, type: 'MOTION', value: 1, ageMs, time: 1 })

// ---- the mode of each sensor ------------------------------------------------------------------

test('a sensor is auto unless the camera is listed as on or off', () => {
  const cam = camera({ cfg: config({ motionSensorAccessory: ['AA'], soundSensorOff: ['AA'] }) })
  assert.strictEqual(cam._sensorMode('Motion'), 'on')
  assert.strictEqual(cam._sensorMode('Sound'), 'off')
  assert.strictEqual(camera()._sensorMode('Motion'), 'auto')
  assert.strictEqual(camera({ cfg: config({ soundSensorAccessory: ['BB'] }) })._sensorMode('Sound'), 'auto', 'another camera\'s setting does not count')
})

test('on is wanted at once, off never, auto only once the camera\'s events were seen', () => {
  assert.strictEqual(camera({ cfg: config({ motionSensorAccessory: ['AA'] }) })._sensorWanted('Motion'), true)
  assert.strictEqual(camera({ cfg: config({ motionSensorOff: ['AA'] }), seen: { Motion: true } })._sensorWanted('Motion'), false)
  assert.strictEqual(camera()._sensorWanted('Sound'), false)
  assert.strictEqual(camera({ seen: { Sound: true } })._sensorWanted('Sound'), true)
})

// ---- the config -------------------------------------------------------------------------------

test('config: true is on, "off" is off, and false or nothing is auto', () => {
  const c = normalize({
    platform: 'WyzeSmartHome',
    cameras: [
      { mac: 'A', motionSensor: true },
      { mac: 'B', motionSensor: false, soundSensor: 'off' },
      { mac: 'C' },
      { mac: 'D', soundSensor: 'on', motionSensor: 'off' }
    ]
  })
  assert.deepStrictEqual(c.motionSensorAccessory, ['A'])
  assert.deepStrictEqual(c.motionSensorOff, ['D'])
  assert.deepStrictEqual(c.soundSensorAccessory, ['D'])
  assert.deepStrictEqual(c.soundSensorOff, ['B'])
  assert.deepStrictEqual(c.cameras.map((r) => [r.motionSensor, r.soundSensor]), [['on', 'auto'], ['auto', 'off'], ['auto', 'auto'], ['off', 'on']])
})

test('config: the old flat motionSensorAccessory list still means on', () => {
  const c = normalize({ platform: 'WyzeSmartHome', motionSensorAccessory: ['A'] })
  assert.deepStrictEqual(c.motionSensorAccessory, ['A'])
  assert.strictEqual(c.cameras[0].motionSensor, 'on')
  assert.strictEqual(c.cameras[0].soundSensor, 'auto')
})

// ---- services ---------------------------------------------------------------------------------

test('a camera with only the Motion Sensor on still gets it', () => {
  const hk = homeKit()
  const plugin = { config: config({ motionSensorAccessory: ['AA'] }), log: Object.assign(() => {}, { debug: () => {}, error: () => {} }), client: { cameraSupportsPowerControl: () => true }, api: {} }
  // A real constructor run: only the Motion Sensor option is on, no siren, floodlight or other switch.
  new WyzeCamera(plugin, hk) // eslint-disable-line no-new
  assert.ok(hk.services.some((s) => s.subtype === 'Motion'), 'Motion sensor added with no other camera option on')
  assert.ok(!hk.services.some((s) => s.subtype === 'Sound'))
})

test('services that are not wanted are removed, and the others are left alone', () => {
  const cam = camera({ cfg: config({ soundSensorAccessory: ['AA'] }) })
  const legacy = service(MotionSensor, undefined) // from earlier plugin versions
  const motionSvc = service(MotionSensor, 'Motion')
  const soundSvc = service(MotionSensor, 'Sound')
  const privacy = service({ UUID: 'sw' }, 'Privacy')
  cam.homeKitAccessory = homeKit([legacy, motionSvc, soundSvc, privacy])
  cam._removeSensorsNotWanted()
  assert.deepStrictEqual(cam.homeKitAccessory.removed.sort(), ['(none)', 'Motion'])
  assert.deepStrictEqual(cam.homeKitAccessory.services.map((s) => s.subtype), ['Sound', 'Privacy'])
})

test('with Sound off, only the Sound service goes', () => {
  const cam = camera({ cfg: config({ motionSensorAccessory: ['AA'], soundSensorOff: ['AA'] }) })
  cam.homeKitAccessory = homeKit([service(MotionSensor, 'Motion'), service(MotionSensor, 'Sound')])
  cam._removeSensorsNotWanted()
  assert.deepStrictEqual(cam.homeKitAccessory.removed, ['Sound'])
})

// ---- the Sound Sensor -------------------------------------------------------------------------

function soundCam () {
  const cam = camera({ cfg: config({ soundSensorAccessory: ['AA'] }) })
  cam._setupSoundSensor()
  cam._watchSound = true
  return cam
}

test('Sound: the first poll only records; a new recent sound turns it on once', () => {
  const cam = soundCam()
  cam._checkSound([sound('a', 1_000)])
  assert.deepStrictEqual(cam.soundSensorService.updates, [])
  cam._checkSound([sound('b', 5_000), sound('a', 11_000)])
  cam._checkSound([sound('b', 15_000), sound('a', 21_000)]) // the same events listed again
  assert.deepStrictEqual(cam.soundSensorService.updates, [true])
  cam._setSoundActive(false)
  assert.deepStrictEqual(cam.soundSensorService.updates, [true, false])
})

test('Sound: a new event older than 30 seconds does not turn it on', () => {
  const cam = soundCam()
  cam._checkSound([])
  cam._checkSound([sound('old', 31_000)])
  assert.deepStrictEqual(cam.soundSensorService.updates, [])
  cam._checkSound([sound('edge', 30_000), sound('old', 31_000)])
  assert.deepStrictEqual(cam.soundSensorService.updates, [true], '30 seconds is still recent')
})

test('Sound: the age by Wyze\'s clock wins over this host\'s clock', () => {
  const cam = soundCam()
  cam._checkSound([])
  // time is far in the past by this host's clock, but Wyze says it just happened
  cam._checkSound([{ id: 'x', type: 'SOUND', time: 1, ageMs: 2_000 }])
  assert.deepStrictEqual(cam.soundSensorService.updates, [true])
})

test('Sound: with no age from wyze-api the host clock is used, and an event with no time counts by novelty', () => {
  const cam = soundCam()
  cam._checkSound([])
  cam._checkSound([{ id: 'x', type: 'SOUND', time: Date.now() - 120_000 }])
  assert.deepStrictEqual(cam.soundSensorService.updates, [], 'two minutes old by the host clock')
  cam._checkSound([{ id: 'y', type: 'SOUND', time: Date.now() - 2_000 }, { id: 'x', type: 'SOUND', time: Date.now() - 120_000 }])
  assert.deepStrictEqual(cam.soundSensorService.updates, [true])
  const bare = soundCam()
  bare._checkSound([])
  bare._checkSound([{ id: 'z', type: 'SOUND' }])
  assert.deepStrictEqual(bare.soundSensorService.updates, [true])
})

test('Sound: motion events do not switch it', () => {
  const cam = soundCam()
  cam._checkSound([])
  cam._checkSound([motion('m', 1_000)])
  assert.deepStrictEqual(cam.soundSensorService.updates, [])
})

test('Sound: with the option off nothing is switched', () => {
  const cam = soundCam()
  cam.soundSensorEnabled = false
  cam._checkSound([])
  cam._checkSound([sound('a', 1_000)])
  assert.deepStrictEqual(cam.soundSensorService.updates, [])
})

// ---- the Motion Sensor ------------------------------------------------------------------------

function motionCam (extra = {}) {
  const cam = camera({ cfg: config({ motionSensorAccessory: ['AA'], ...extra }) })
  cam._setupMotionSensor()
  cam._watchMotion = true
  return cam
}

test('Motion: an old new event refreshes the picture but does not switch the sensor', () => {
  const cam = motionCam()
  cam._checkMotion([])
  cam._checkMotion([motion('old', 200_000)])
  assert.strictEqual(cam._motionActive, false)
  assert.strictEqual(cam.refreshes, 1)
  cam._checkMotion([motion('new', 4_000), motion('old', 204_000)])
  assert.strictEqual(cam._motionActive, true)
})

test('Motion: sound events count as motion unless this camera has the Sound Sensor', () => {
  const without = motionCam()
  without._checkMotion([])
  without._checkMotion([sound('s', 1_000)])
  assert.strictEqual(without._motionActive, true)
  assert.strictEqual(without.refreshes, 1)

  const withSound = motionCam({ soundSensorAccessory: ['AA'] })
  withSound.soundSensorEnabled = true
  withSound._checkMotion([])
  withSound._checkMotion([sound('s', 1_000)])
  assert.strictEqual(withSound._motionActive, false)
  assert.strictEqual(withSound.refreshes, 0)
  withSound._checkMotion([motion('m', 1_000), sound('s', 2_000)])
  assert.strictEqual(withSound._motionActive, true)
})

// ---- finding out whether a camera has the events -----------------------------------------------

test('discovery adds a sensor when the last week shows events of its kind, and not otherwise', async () => {
  const cam = camera({
    events: (options) => (options.types.includes('SOUND') ? [sound('s', 1)] : [])
  })
  await cam._discoverSensors()
  const forKinds = cam.asked.filter((o) => o.types)
  assert.deepStrictEqual(forKinds.map((o) => o.types), [[], ['SOUND']], 'motion asks for every type, sound for sound alone')
  assert.ok(cam.asked.every((o) => o.sinceMs === 7 * 24 * 60 * 60 * 1000 && o.count === 20))
  assert.strictEqual(cam._sensorWanted('Sound'), true)
  assert.strictEqual(cam._sensorWanted('Motion'), false, 'no motion events, so no Motion sensor')
  assert.ok(cam.homeKitAccessory.services.some((s) => s.subtype === 'Sound'))
  assert.ok(!cam.homeKitAccessory.services.some((s) => s.subtype === 'Motion'))
})

test('discovery counts any event that is not a sound as motion', async () => {
  const cam = camera({ events: (options) => (options.types.length === 0 ? [{ id: 'p', type: 'DOORBELL_RANG' }] : []) })
  await cam._discoverSensors()
  assert.strictEqual(cam._sensorWanted('Motion'), true)
  assert.strictEqual(cam._sensorWanted('Sound'), false)
})

test('discovery leaves alone a sensor that is on or off, and asks nothing when none is auto', async () => {
  const cam = camera({
    cfg: config({ motionSensorAccessory: ['AA'], soundSensorOff: ['AA'], cameras: [{ mac: 'AA', detections: ['none'] }] }),
    events: [sound('s', 1)]
  })
  await cam._discoverSensors()
  assert.deepStrictEqual(cam.asked, [])
  assert.strictEqual(cam._sensorWanted('Sound'), false)
})

test('discovery asks once per start, and a failure is retried a few times without throwing', async () => {
  const answered = camera({ events: [] })
  await answered._discoverSensors()
  await answered._discoverSensors()
  assert.strictEqual(answered.asked.length, 3, 'motion, sound and the detection labels, asked once each')

  let tries = 0
  const failing = camera()
  failing.plugin.client.cameraGetEvents = async () => { tries += 1; throw new Error('Wyze is down') }
  for (let i = 0; i < 6; i++) await failing._discoverSensors()
  assert.strictEqual(tries, 3, 'gives up after three tries')
})

test('discovery does nothing for a wyze-api without cameraGetEvents', async () => {
  const cam = camera()
  cam.plugin.client = {}
  await cam._discoverSensors()
  assert.strictEqual(cam._sensorWanted('Motion'), false)
})
