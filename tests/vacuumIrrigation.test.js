/**
 * Vacuum and sprinkler accessories from the review of the merge into 2.0.0: a command shows at once and is not undone
 * by a poll that lands before Wyze has caught up, a failed room list is asked for again, a sprinkler countdown stops
 * with Homebridge, and a zone that is not a whole number falls back to 1.
 */
const test = require('node:test')
const assert = require('node:assert')

require('../src/types').update({
  hap: { Service: { Switch: 'Switch' }, Characteristic: { On: 'On', Active: { ACTIVE: 1, INACTIVE: 0 }, InUse: { IN_USE: 1, NOT_IN_USE: 0 }, StatusFault: { GENERAL_FAULT: 1, NO_FAULT: 0 }, ChargingState: { CHARGING: 1, NOT_CHARGING: 0 }, StatusLowBattery: { BATTERY_LEVEL_LOW: 1, BATTERY_LEVEL_NORMAL: 0 } }, uuid: {}, Categories: {} },
  platformAccessory: class {}
})
const WyzeVacuum = require('../src/accessories/WyzeVacuum')
const WyzeIrrigation = require('../src/accessories/WyzeIrrigation')

const quiet = Object.assign(() => {}, { error () {}, warn () {}, debug () {}, info () {} })

function vacuum (client, log = quiet) {
  const acc = Object.create(WyzeVacuum.prototype)
  acc.homeKitAccessory = { context: { mac: 'VV', product_model: 'JA_RO2' }, displayName: 'Vac' }
  const pushed = []
  const sink = { updateValue: (v) => pushed.push(v) }
  const service = { getCharacteristic: () => sink, testCharacteristic: () => true, addCharacteristic () {} }
  Object.assign(acc, { fanService: service, batteryService: service, roomServices: new Map(), roomSwitchesEnabled: false, isCleaning: false, suctionLevel: 1, batteryLevel: 50 })
  acc.plugin = { config: {}, log, client }
  acc.persistState = () => {}
  return { acc, pushed }
}

const pollClient = (mode) => ({
  getVacuumInfo: async () => ({ battary: 60, cleanlevel: 1, chargeState: 0 }),
  vacuumGetMode: () => mode,
  vacuumGetFault: () => null,
  wyzeVacuumModeIsCleaning: (m) => m === 'CLEANING',
  wyzeVacuumSuctionToHomeKit: (x) => x,
  checkLowBattery: () => false,
})

test('a vacuum start shows at once, and a poll that still reports the old mode does not undo it', async () => {
  const client = { ...pollClient('PAUSED'), vacuumClean: async () => {}, vacuumDock: async () => {} }
  const { acc } = vacuum(client)
  await acc.setIsActive(true)
  assert.strictEqual(acc.isCleaning, true)
  await acc.updateCharacteristics({ conn_state: 1 }) // Wyze still says paused
  assert.strictEqual(acc.isCleaning, true, 'the poll inside the grace period did not flip it back')
  acc.clearCommandGrace()
  await acc.updateCharacteristics({ conn_state: 1 })
  assert.strictEqual(acc.isCleaning, false, 'after the grace period the poll is believed again')
})

test('a vacuum command that fails puts the tile back at once and frees the next poll', async () => {
  const client = { ...pollClient('CLEANING'), vacuumClean: async () => { throw new Error('Wyze said no') } }
  const { acc, pushed } = vacuum(client)
  await assert.rejects(() => acc.setIsActive(true), /Wyze said no/)
  assert.strictEqual(acc.isCleaning, false)
  assert.strictEqual(acc.inCommandGrace(), false)
  assert.strictEqual(pushed.at(-1), false, 'HomeKit was told it is off again')
})

test('per-room switches: a failed or empty room list is asked for again later, not never', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  let calls = 0
  let answer = () => { throw new Error('timeout') }
  const client = { getVacuumRooms: async () => { calls += 1; return answer() } }
  const { acc } = vacuum(client)
  acc.roomSwitchesEnabled = true
  acc.homeKitAccessory.getServiceById = () => ({ getCharacteristic: () => ({ onGet () { return this }, onSet () { return this }, value: 'x' }), setCharacteristic () {} })
  await acc._ensureRoomServices()
  assert.strictEqual(calls, 1)
  await acc._ensureRoomServices()
  assert.strictEqual(calls, 1, 'not asked at every refresh')
  t.mock.timers.tick(5 * 60_000 + 1)
  answer = () => []
  await acc._ensureRoomServices()
  assert.strictEqual(calls, 2, 'asked again after the wait')
  t.mock.timers.tick(5 * 60_000 + 1)
  answer = () => [{ id: 1, name: 'Kitchen', mapId: 'm' }]
  await acc._ensureRoomServices()
  assert.strictEqual(calls, 3)
  assert.strictEqual(acc._roomsLoaded, true, 'loaded once there are rooms')
  assert.strictEqual(acc.roomServices.size, 1)
  t.mock.timers.tick(10 * 60_000)
  await acc._ensureRoomServices()
  assert.strictEqual(calls, 3, 'and not asked again')
})

// ---- the sprinkler ----

function sprinkler (config = {}) {
  const acc = Object.create(WyzeIrrigation.prototype)
  acc.homeKitAccessory = { context: { mac: 'IR', product_model: 'BS_WK1' }, displayName: 'Sprinkler' }
  const warnings = []
  acc.plugin = { config, log: Object.assign(() => {}, { error () {}, warn: (m) => warnings.push(m), debug () {}, info () {} }) }
  return { acc, warnings }
}

test('the sprinkler countdown is cleared by stop(), which the platform calls at shutdown, and never keeps the process alive', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const { acc } = sprinkler()
  const ticks = []
  acc.remainingDuration = 5
  acc.valveService = { getCharacteristic: () => ({ updateValue: (v) => ticks.push(v) }) }
  acc._startCountdown()
  assert.ok(acc._remainingTimer)
  t.mock.timers.tick(2000)
  assert.deepStrictEqual(ticks, [4, 3])
  acc.stop()
  t.mock.timers.tick(5000)
  assert.deepStrictEqual(ticks, [4, 3], 'no more ticks once stopped')
  assert.strictEqual(acc._remainingTimer, null)
})

test('the platform stops every accessory that has a stop(), and one that throws does not stop the rest', () => {
  const WyzeSmartHome = require('../src/WyzeSmartHome')
  const stopped = []
  const platform = Object.create(WyzeSmartHome.prototype)
  platform.accessories = [{ stop: () => { throw new Error('x') } }, { stop: () => stopped.push('b') }, {}]
  platform.shutdown()
  assert.deepStrictEqual(stopped, ['b'])
})

test('a sprinkler zone that is not a whole number from 1 runs zone 1, and says so', () => {
  const build = (irrigationZone) => {
    const chain = { onGet () { return chain }, onSet () { return chain }, setProps () { return chain } }
    const service = { getCharacteristic: () => chain }
    const warnings = []
    const plugin = { config: { irrigationZone }, log: Object.assign(() => {}, { error () {}, warn: (m) => warnings.push(m), debug () {}, info () {} }) }
    const homeKitAccessory = { context: { mac: 'IR', product_model: 'BS_WK1' }, displayName: 'Sprinkler', getService: () => service, addService: () => service }
    return { acc: new WyzeIrrigation(plugin, homeKitAccessory), warnings }
  }
  for (const [wanted, expected, warns] of [[3, 3, false], ['2', 2, false], [0, 1, true], [-1, 1, true], [1.5, 1, true], ['x', 1, true], [null, 1, false]]) {
    const { acc, warnings } = build({ IR: wanted })
    assert.strictEqual(acc.zoneNumber, expected, String(wanted))
    assert.strictEqual(warnings.length > 0, warns, `${wanted}: ${warnings.join('|')}`)
  }
  assert.strictEqual(build({}).acc.zoneNumber, 1, 'a controller that is not listed runs zone 1')
  assert.strictEqual(build(undefined).acc.zoneNumber, 1)
})
