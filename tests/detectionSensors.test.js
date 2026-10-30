/**
 * The Person, Vehicle, Pet and Package sensors: HomeKit motion sensors driven by the AI labels on the events in
 * Wyze's cloud event list, with the same rules as the Motion and Sound sensors. Automatic by default.
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

const { AiEventTag } = require('wyze-api/src/types')
const WyzeCamera = require('../src/accessories/WyzeCamera')
const DetectionSensors = require('../src/camera/detectionSensors')
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
    context: { mac: 'AA', product_type: 'Camera', product_model: 'HL_DB2' },
    services,
    removed: [],
    getService: () => undefined,
    getServiceById: (type, subtype) => hk.services.find((s) => s.UUID === type.UUID && s.subtype === subtype),
    addService: (type, name, subtype) => { const s = service(type, subtype); hk.services.push(s); return s },
    removeService: (s) => { hk.removed.push(s.subtype || '(none)'); hk.services = hk.services.filter((x) => x !== s) }
  }
  return hk
}

function camera ({ detections, events = () => [], cfg = {} } = {}) {
  const acc = Object.create(WyzeCamera.prototype)
  const asked = []
  const logs = []
  acc.mac = 'AA'
  acc.homeKitAccessory = homeKit()
  acc.plugin = {
    config: {
      motionSensorAccessory: [], motionSensorOff: [], soundSensorAccessory: [], soundSensorOff: [],
      cameras: detections === undefined ? [] : [{ mac: 'AA', detections }],
      ...cfg
    },
    log: Object.assign((m) => logs.push(m), { debug: () => {} }),
    client: { cameraGetEvents: async (mac, options) => { asked.push(options); return events(options) } }
  }
  acc.asked = asked
  acc.logs = logs
  acc._startEventWatch = () => {}
  return acc
}

const labelled = (id, tags, ageMs = 1_000) => ({ id, type: 'MOTION', tags, ageMs, time: 1 })
const PERSON = AiEventTag.PERSON
const PACKAGE = AiEventTag.PACKAGE
const PET = AiEventTag.PET
const VEHICLE = AiEventTag.VEHICLE
const FACE = AiEventTag.FACE

// ---- which sensors a camera gets ----------------------------------------------------------------

test('automatic by default: only the labels this camera\'s events were found to carry', () => {
  const cam = camera()
  assert.strictEqual(cam.detections.mode(), 'auto')
  assert.strictEqual(cam.detections.wanted('Person'), false, 'not found yet')
  cam.detections.seen.Person = true
  assert.strictEqual(cam.detections.wanted('Person'), true)
  assert.strictEqual(cam.detections.wanted('Pet'), false)
})

test('a chosen list is exactly those labels, whether seen or not; "none" is none', () => {
  const some = camera({ detections: ['person', 'Pet', 'dog'] })
  assert.deepStrictEqual(some.detections.mode(), ['Person', 'Pet'])
  assert.strictEqual(some.detections.wanted('Person'), true)
  assert.strictEqual(some.detections.wanted('Vehicle'), false)
  some.detections.seen.Vehicle = true
  assert.strictEqual(some.detections.wanted('Vehicle'), false, 'a chosen list is not widened by what was seen')

  const none = camera({ detections: ['none', 'person'] })
  assert.strictEqual(none.detections.mode(), 'none')
  assert.strictEqual(none.detections.wanted('Person'), false)
  none.detections.seen.Person = true
  assert.strictEqual(none.detections.wanted('Person'), false)
})

test('an empty list, or another camera\'s list, is automatic', () => {
  assert.strictEqual(camera({ detections: [] }).detections.mode(), 'auto')
  const other = camera()
  other.plugin.config.cameras = [{ mac: 'BB', detections: ['none'] }]
  assert.strictEqual(other.detections.mode(), 'auto')
})

test('only labels in the table can become sensors: four automatic, and Face by name', () => {
  assert.deepStrictEqual(DetectionSensors.AUTO_KINDS, ['Person', 'Vehicle', 'Pet', 'Package'])
  assert.deepStrictEqual(DetectionSensors.KINDS, ['Person', 'Vehicle', 'Pet', 'Package', 'Face'])
})

test('Face is never automatic, even if the camera has been found to carry it', () => {
  const cam = camera()
  cam.detections.seen.Face = true
  assert.strictEqual(cam.detections.wanted('Face'), false)
})

test('Face is built when it is named, and then follows the same rules', () => {
  const cam = camera({ detections: ['face'] })
  assert.deepStrictEqual(cam.detections.mode(), ['Face'])
  cam.detections.setupWanted()
  assert.deepStrictEqual(cam.homeKitAccessory.services.map((s) => s.subtype), ['Face'])
  cam.detections.check([])
  cam.detections.check([labelled('f', [PERSON, FACE], 3_000)])
  assert.deepStrictEqual(cam.detections.sensors.Face.service.updates, [true])
  cam.detections.check([labelled('g', [PERSON], 3_000), labelled('f', [PERSON, FACE], 13_000)])
  assert.deepStrictEqual(cam.detections.sensors.Face.service.updates, [true], 'a person with no recognised face is not a face')
})

// ---- the sensors react to fresh labelled events -----------------------------------------------------

function personCam (detections = ['person', 'package']) {
  const cam = camera({ detections })
  cam.detections.setupWanted()
  return cam
}
const updates = (cam, kind) => cam.detections.sensors[kind].service.updates

test('chosen labels get a service each, named for the label', () => {
  const cam = personCam()
  assert.deepStrictEqual(cam.homeKitAccessory.services.map((s) => s.subtype).sort(), ['Package', 'Person'])
  assert.strictEqual(cam.detections.any(), true)
  assert.strictEqual(camera({ detections: ['none'] }).detections.any(), false)
})

test('the first poll only records; a new fresh labelled event turns that sensor on, and only that one', () => {
  const cam = personCam()
  cam.detections.check([labelled('a', [PERSON])])
  assert.deepStrictEqual(updates(cam, 'Person'), [])
  cam.detections.check([labelled('b', [PERSON, PACKAGE]), labelled('a', [PERSON], 11_000)])
  assert.deepStrictEqual(updates(cam, 'Person'), [true])
  assert.deepStrictEqual(updates(cam, 'Package'), [true])
  cam.detections.set('Person', false)
  assert.deepStrictEqual(updates(cam, 'Person'), [true, false])
})

test('the same events listed again do not switch it again', () => {
  const cam = personCam(['person'])
  cam.detections.check([])
  cam.detections.check([labelled('a', [PERSON], 2_000)])
  cam.detections.check([labelled('a', [PERSON], 12_000)])
  cam.detections.check([labelled('a', [PERSON], 22_000)])
  assert.deepStrictEqual(updates(cam, 'Person'), [true])
})

test('a label Wyze adds a few seconds after the event appeared counts as new, while the event is fresh', () => {
  const cam = personCam(['person'])
  cam.detections.check([])
  cam.detections.check([labelled('a', [], 2_000)]) // listed without its label
  assert.deepStrictEqual(updates(cam, 'Person'), [])
  cam.detections.check([labelled('a', [PERSON], 12_000)]) // the label arrives
  assert.deepStrictEqual(updates(cam, 'Person'), [true])
})

test('a labelled event older than 30 seconds does not switch it', () => {
  const cam = personCam(['person'])
  cam.detections.check([])
  cam.detections.check([labelled('old', [PERSON], 31_000)])
  assert.deepStrictEqual(updates(cam, 'Person'), [])
  cam.detections.check([labelled('edge', [PERSON], 30_000), labelled('old', [PERSON], 41_000)])
  assert.deepStrictEqual(updates(cam, 'Person'), [true], '30 seconds is still fresh')
})

test('events with other labels, or none, do not switch it', () => {
  const cam = personCam(['person'])
  cam.detections.check([])
  cam.detections.check([labelled('v', [VEHICLE]), labelled('p', [PET]), labelled('n', []), { id: 'x', ageMs: 1 }])
  assert.deepStrictEqual(updates(cam, 'Person'), [])
})

test('going offline forgets what was seen, so the gap does not switch a sensor on late', () => {
  const cam = personCam(['person'])
  cam.detections.check([labelled('a', [PERSON], 2_000)])
  cam.detections.reset()
  cam.detections.check([labelled('b', [PERSON], 2_000)])
  assert.deepStrictEqual(updates(cam, 'Person'), [], 'the first poll after the gap only records')
})

test('stopping clears the hold timers', () => {
  const cam = personCam(['person'])
  cam.detections.check([])
  cam.detections.check([labelled('a', [PERSON])])
  assert.ok(cam.detections.sensors.Person.timer)
  cam.detections.stop()
  assert.strictEqual(cam.detections.sensors.Person.timer, null)
})

// ---- finding out which labels a camera has ------------------------------------------------------------

test('a camera whose newest events carry no label has no AI detection: nothing more is asked', async () => {
  const cam = camera({ events: () => [labelled('a', []), labelled('b', [])] })
  await cam.detections.discover()
  assert.strictEqual(cam.asked.length, 1)
  assert.strictEqual(cam.detections.any(), false)
})

test('otherwise each label is asked for on its own, and only the ones that exist are added', async () => {
  const cam = camera({
    events: (options) => {
      if (!options.tags) return [labelled('a', [PERSON])]
      return options.tags[0] === 'PACKAGE' || options.tags[0] === 'PERSON' ? [labelled('x', [PERSON, PACKAGE])] : []
    }
  })
  await cam.detections.discover()
  assert.deepStrictEqual(cam.asked.slice(1).map((o) => o.tags), [['VEHICLE'], ['PET'], ['PACKAGE'], ['FACE']],
    'every label the newest events do not already show, Face included only to be able to say it exists')
  assert.ok(cam.asked.every((o) => o.sinceMs === 7 * 24 * 60 * 60 * 1000 && o.count === 20))
  assert.deepStrictEqual(Object.keys(cam.detections.sensors).sort(), ['Package', 'Person'])
  assert.deepStrictEqual(cam.homeKitAccessory.services.map((s) => s.subtype).sort(), ['Package', 'Person'])
})

test('a wyze-api that ignores the filter does not add a label the answer does not show', async () => {
  const cam = camera({ events: () => [labelled('a', [PERSON])] }) // always the same newest event, filtered or not
  await cam.detections.discover()
  assert.deepStrictEqual(Object.keys(cam.detections.sensors), ['Person'])
})

test('a chosen list, or "none", is still scanned and reported, but discovery adds no sensor of its own', async () => {
  for (const detections of [['pet'], ['none']]) {
    const cam = camera({ detections, events: eventsWith([PERSON, PET]) })
    const report = await cam.detections.discover()
    assert.deepStrictEqual(report.found, ['Person', 'Pet'])
    assert.deepStrictEqual(Object.keys(cam.detections.sensors), [], 'sensors come from setupWanted, not from what was found')
    assert.strictEqual(cam.detections.scanned, true)
  }
})

test('a camera finds its labels through its own discovery, and then watches events for them', async () => {
  const cam = camera({ events: (options) => (options.tags ? (options.tags[0] === 'PET' ? [labelled('p', [PET])] : []) : [labelled('a', [PET])]) })
  let watched = 0
  cam._startEventWatch = () => { watched += 1 }
  await cam._discoverSensors()
  assert.ok(cam.homeKitAccessory.services.some((s) => s.subtype === 'Pet'))
  assert.strictEqual(watched, 1, 'the event watch is started again so the new sensor is fed')
})

// ---- removal and config -----------------------------------------------------------------------------

test('a detection service that is not wanted is removed; the Motion and Sound services are left alone', () => {
  const cam = camera({ detections: ['person'], cfg: { motionSensorAccessory: ['AA'], soundSensorAccessory: ['AA'] } })
  cam.homeKitAccessory = homeKit([
    service(MotionSensor, 'Motion'), service(MotionSensor, 'Sound'),
    service(MotionSensor, 'Person'), service(MotionSensor, 'Pet'), service(MotionSensor, 'Package')
  ])
  cam._removeSensorsNotWanted()
  assert.deepStrictEqual(cam.homeKitAccessory.removed.sort(), ['Package', 'Pet'])
  assert.deepStrictEqual(cam.homeKitAccessory.services.map((s) => s.subtype), ['Motion', 'Sound', 'Person'])
})

test('config: detections is a list of known labels, lower case, without repeats', () => {
  const c = normalize({
    platform: 'WyzeSmartHome',
    cameras: [
      { mac: 'A', detections: ['Person', 'person', 'PET', 'dog'] },
      { mac: 'B', detections: 'person' },
      { mac: 'C', detections: ['none'] },
      { mac: 'D' }
    ]
  })
  assert.deepStrictEqual(c.cameras.map((r) => r.detections), [['person', 'pet'], [], ['none'], []])
})

test('config: a camera that only appears in an old flat list gets an empty (automatic) detections list', () => {
  const c = normalize({ platform: 'WyzeSmartHome', sirenAccessory: ['A'] })
  assert.deepStrictEqual(c.cameras[0].detections, [])
})

// ---- seeing what a camera has -------------------------------------------------------------------------

const eventsWith = (labels) => (options) => {
  if (!options.tags) return [labelled('a', [PERSON])]
  const want = { PERSON, VEHICLE, PET, PACKAGE, FACE }[options.tags[0]]
  return labels.includes(want) ? [labelled('x', [want])] : []
}

test('the log names the labels a camera\'s events carry, once', async () => {
  const cam = camera({ events: eventsWith([PERSON, VEHICLE, PET, PACKAGE]) })
  await cam.detections.discover()
  assert.strictEqual(cam.logs.length, 1)
  assert.match(cam.logs[0], /events carry the AI labels Person, Vehicle, Pet, Package/)
  assert.doesNotMatch(cam.logs[0], /face/i, 'no Face events, so no hint about Face')
})

test('when Face events exist the log says so and how to get a sensor, but none is added', async () => {
  const cam = camera({ events: eventsWith([PERSON, FACE]) })
  await cam.detections.discover()
  assert.deepStrictEqual(Object.keys(cam.detections.sensors), ['Person'])
  assert.match(cam.logs[0], /Face events exist too: add "face" to this camera's detections/)
})

test('a camera that has chosen Face is not told how to get it', async () => {
  const cam = camera({ detections: ['person', 'face'], events: eventsWith([PERSON, FACE]) })
  await cam.detections.discover()
  assert.match(cam.logs[0], /events carry the AI labels Person, Face/)
  assert.doesNotMatch(cam.logs[0], /add "face"/)
})

test('labels this plugin has no name for are listed by number, and get no sensor', async () => {
  const cam = camera({
    events: (options) => (options.tags ? [] : [labelled('a', [PERSON, 777]), labelled('b', [888])])
  })
  await cam.detections.discover()
  assert.deepStrictEqual(Object.keys(cam.detections.sensors), ['Person'], 'only the named label gets a sensor; 777 and 888 get none')
  assert.match(cam.logs[0], /labels with no name here: 777, 888/)
})

test('a camera with no AI labels logs nothing', async () => {
  const cam = camera({ events: () => [labelled('a', [])] })
  await cam.detections.discover()
  assert.deepStrictEqual(cam.logs, [])
})

test('config: face is a known name', () => {
  const c = normalize({ platform: 'WyzeSmartHome', cameras: [{ mac: 'A', detections: ['Face', 'person'] }] })
  assert.deepStrictEqual(c.cameras[0].detections, ['face', 'person'])
})
