/**
 * Night vision as two HomeKit switches ("Night Vision" and "Night Vision Auto"; both off is off), read from and set on
 * the camera over the local network through wyze-api.
 */
const test = require('node:test')
const assert = require('node:assert')

require('../src/types').update({
  hap: { Service: { Switch: 'Switch' }, Characteristic: { On: 'On' }, uuid: {}, Categories: {} },
  platformAccessory: class {}
})

const WyzeCamera = require('../src/accessories/WyzeCamera')

function make ({ client, config = { nightVisionAccessory: ['AA'] } } = {}) {
  const acc = Object.create(WyzeCamera.prototype)
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: 'WYZE_CAKP2JFUS' }, displayName: 'Garage' }
  const lines = []
  const log = Object.assign((m) => lines.push(['log', m]), { warn: (m) => lines.push(['warn', m]), debug: (m) => lines.push(['debug', m]), error: (m) => lines.push(['error', m]) })
  acc.plugin = { config, client, log }
  const specs = {}
  const shown = {}
  const handlers = {}
  acc._getOrAddService = (spec) => {
    specs[spec.subtype] = spec
    const characteristic = {
      onGet: (fn) => { handlers[spec.subtype] = { ...handlers[spec.subtype], get: fn }; return characteristic },
      onSet: (fn) => { handlers[spec.subtype] = { ...handlers[spec.subtype], set: fn }; return characteristic },
      updateValue: (v) => { shown[spec.subtype] = v }
    }
    return { getCharacteristic: () => characteristic }
  }
  return { acc, lines, specs, shown, handlers }
}

const cleanUp = (acc) => { clearTimeout(acc._nightVisionFirst); clearInterval(acc._nightVisionTimer) }

test('the option adds two switches, and a camera with only this option counts as having extra accessories', () => {
  const { acc, specs } = make({ client: {} })
  assert.strictEqual(acc.cameraAccessoryAttached(), true)
  acc._setupNightVision()
  assert.deepStrictEqual(Object.keys(specs).sort(), ['NightVision', 'NightVisionAuto'])
  assert.strictEqual(specs.NightVision.defaultName, 'Night Vision')
  assert.strictEqual(specs.NightVisionAuto.defaultName, 'Night Vision Auto')
  cleanUp(acc)
  assert.strictEqual(make({ client: {}, config: {} }).acc.cameraAccessoryAttached(), false)
})

test('the switches show what the camera answered: on, auto, or both off', async () => {
  for (const [answer, expected] of [['on', [true, false]], ['auto', [false, true]], ['off', [false, false]]]) {
    const { acc, shown, handlers } = make({ client: { getCameraNightVision: async () => answer } })
    acc._setupNightVision()
    await acc._readNightVision()
    assert.deepStrictEqual([shown.NightVision, shown.NightVisionAuto], expected, answer)
    assert.strictEqual(await handlers.NightVision.get(), expected[0])
    assert.strictEqual(await handlers.NightVisionAuto.get(), expected[1])
    cleanUp(acc)
  }
})

test('switching on sets "on", Auto sets "auto", and switching either off sets "off"', async () => {
  const calls = []
  const { acc, shown, handlers } = make({ client: { setCameraNightVision: async (mac, mode) => { calls.push([mac, mode]); return { before: 'off', after: mode, matches: true } } } })
  acc._setupNightVision()
  await handlers.NightVision.set(true)
  assert.deepStrictEqual([shown.NightVision, shown.NightVisionAuto], [true, false])
  await handlers.NightVisionAuto.set(true)
  assert.deepStrictEqual([shown.NightVision, shown.NightVisionAuto], [false, true], 'one switch replaces the other')
  await handlers.NightVisionAuto.set(false)
  assert.deepStrictEqual([shown.NightVision, shown.NightVisionAuto], [false, false])
  assert.deepStrictEqual(calls, [['AA', 'on'], ['AA', 'auto'], ['AA', 'off']])
  cleanUp(acc)
})

test('a set that the camera does not confirm, or that fails, is an error and the switches go back', async () => {
  let reply = { before: 'off', after: 'off', matches: false }
  const { acc, shown, handlers, lines } = make({ client: { setCameraNightVision: async () => { if (reply instanceof Error) throw reply; return reply } } })
  acc._setupNightVision()
  acc.nightVision = 'auto'
  await assert.rejects(() => handlers.NightVision.set(true), /answered off instead of on/)
  assert.deepStrictEqual([shown.NightVision, shown.NightVisionAuto], [false, true])
  reply = new Error('night vision cannot be reached: the Wyze device list has no IP address for it')
  await assert.rejects(() => handlers.NightVision.set(true), /no IP address/)
  assert.ok(lines.some(([kind, text]) => kind === 'error' && /Set failed for Garage/.test(text)))
  assert.strictEqual(acc.nightVision, 'auto', 'what the camera has is kept')
  cleanUp(acc)
})

test('setting what it already is sends nothing', async () => {
  let sent = 0
  const { acc, handlers } = make({ client: { setCameraNightVision: async () => { sent += 1; return { matches: true } } } })
  acc._setupNightVision()
  acc.nightVision = 'off'
  await handlers.NightVision.set(false)
  assert.strictEqual(sent, 0)
  cleanUp(acc)
})

test('an older wyze-api says so, once, and a read that fails warns once then goes quiet', async () => {
  const old = make({ client: {} })
  old.acc._setupNightVision()
  await old.acc._readNightVision()
  await old.acc._readNightVision()
  assert.strictEqual(old.lines.filter(([kind]) => kind === 'warn').length, 1)
  await assert.rejects(() => old.handlers.NightVision.set(true), /needs a newer wyze-api/)
  cleanUp(old.acc)

  const busy = make({ client: { getCameraNightVision: async () => { throw new Error('camera busy') } } })
  busy.acc._setupNightVision()
  await busy.acc._readNightVision()
  await busy.acc._readNightVision()
  assert.deepStrictEqual(busy.lines.map(([kind]) => kind), ['warn', 'debug'])
  cleanUp(busy.acc)
})

test('the timers are stopped with the camera, and do not keep Homebridge from exiting', () => {
  const { acc } = make({ client: {} })
  acc.detections = { stop () {} }
  acc._setupNightVision()
  assert.ok(acc._nightVisionFirst && acc._nightVisionTimer)
  acc.stopStreams()
  assert.ok(acc._nightVisionFirst._destroyed || acc._nightVisionFirst._idleTimeout === -1)
})

test('turning off the switch that is already off does nothing; only the switch of the current mode turns it off', async () => {
  const calls = []
  const { acc, shown, handlers } = make({ client: { setCameraNightVision: async (mac, mode) => { calls.push(mode); return { before: 'x', after: mode, matches: true } } } })
  acc._setupNightVision()
  acc.nightVision = 'auto'
  await handlers.NightVision.set(false) // a scene's "everything off" also sets the switch that is already off
  assert.deepStrictEqual(calls, [], 'auto is left alone')
  assert.deepStrictEqual([shown.NightVision, shown.NightVisionAuto], [false, true])
  acc.nightVision = 'on'
  await handlers.NightVisionAuto.set(false)
  assert.deepStrictEqual(calls, [], 'on is left alone')
  await handlers.NightVision.set(false)
  assert.deepStrictEqual(calls, ['off'], 'the switch of the current mode turns it off')
  cleanUp(acc)
})
