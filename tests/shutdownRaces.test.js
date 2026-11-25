/**
 * Things that must hold when Homebridge shuts down, or an account changes, while something else is still going on:
 * issues #17 and #18, and the sweeps for the same class (state kept from an earlier pass, work that finishes after
 * shutdown).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

require('../src/types').update({ hap: { Service: {}, Characteristic: { On: 'On' }, uuid: {}, Categories: {} }, platformAccessory: class {}, user: { persistPath: () => os.tmpdir() }, registerPlatform: () => {} })
const WyzeSmartHome = require('../src/WyzeSmartHome')

const flat = { platform: 'WyzeSmartHome', username: 'a', password: 'b', keyId: 'k', apiKey: 'x', name: 'Wyze' }

function make (extra = {}) {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-storage-'))
  const lines = []
  const log = (m) => lines.push(['log', m])
  for (const level of ['debug', 'info', 'warn', 'warning', 'error']) log[level] = (m) => lines.push([level, m])
  const api = { on: () => {}, unregisterPlatformAccessories: () => {}, hap: {}, user: { storagePath: () => storage } }
  return { platform: new WyzeSmartHome(log, { ...flat, ...extra }, api), lines, storage }
}

// ---- #17: the failed-lookup set is reset when the last thermostat is gone ----

test('#17: room sensors are not kept alive after the last thermostat is removed from the account', async () => {
  const { platform } = make()
  platform.client = { getThermostatSensors: async () => { throw new Error('Wyze is down') } }
  const thermostat = { product_type: 'Thermostat', product_model: 'CO_EA1', mac: 'T1', nickname: 'Hall' }
  await platform.discoverRoomSensors([thermostat])
  assert.ok(platform._roomSensorLookupFailed.has('T1'), 'the failed lookup is remembered while the thermostat is there')
  await platform.discoverRoomSensors([]) // the thermostat was removed from the account
  assert.strictEqual(platform._roomSensorLookupFailed.size, 0, 'and forgotten once it is gone')
})

// ---- #18: the test page does not leave a dead link after shutdown ----

function fakeLib ({ onStart } = {}) {
  const calls = { stopped: 0 }
  return {
    calls,
    validateWebPort: (port) => ({ enabled: true, port: Number(port) }),
    createCameraTestServer: () => ({
      start: async () => { if (onStart) await onStart(); return { urls: ['http://localhost:8099/?token=t'] } },
      stop: async () => { calls.stopped += 1 }
    })
  }
}

test('#18: a test page that finishes starting after shutdown is stopped and leaves no link', async () => {
  const { platform, storage } = make({ webServerPort: 8099 })
  const lib = fakeLib({ onStart: async () => { platform.shutdown() } })
  await platform.startCameraTestPage(lib)
  assert.strictEqual(fs.existsSync(path.join(storage, 'homebridge-wyze-smart-home', 'web-page.json')), false, 'no link was written')
  assert.ok(lib.calls.stopped >= 1, 'the server was stopped')
  assert.strictEqual(platform.webServer, undefined)
})

test('#18: a test page that starts normally still writes its link', async () => {
  const { platform, storage } = make({ webServerPort: 8099 })
  await platform.startCameraTestPage(fakeLib())
  assert.strictEqual(fs.existsSync(path.join(storage, 'homebridge-wyze-smart-home', 'web-page.json')), true)
  assert.ok(platform.webServer)
})

// ---- the same class, everywhere: work that follows an await must check that it is still wanted ----

test('every await of a server start, a login or a refresh in WyzeSmartHome is followed by a check that Homebridge has not stopped', () => {
  const text = fs.readFileSync(path.join(__dirname, '../src/WyzeSmartHome.js'), 'utf8')
  const lines = text.split('\n')
  const unchecked = []
  lines.forEach((line, i) => {
    if (!/await this\.(webServer\.start|refreshDevices|refreshLockDevices)\(/.test(line)) return
    const around = lines.slice(i, i + 12).join('\n') + lines.slice(Math.max(0, i - 6), i).join('\n')
    if (!/_stopped/.test(around)) unchecked.push(`line ${i + 1}: ${line.trim()}`)
  })
  assert.deepStrictEqual(unchecked, [])
})
