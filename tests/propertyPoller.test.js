/**
 * One request per refresh cycle reads the properties of every device that needs them (cameras,
 * lights, mesh lights). A device that gets nothing from it reads its own, exactly as before, and a
 * warning says why.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

require('../src/types').update({
  hap: { Service: {}, Characteristic: { On: 'On', Brightness: 'Brightness', ColorTemperature: 'ColorTemperature' }, uuid: {}, Categories: {} },
  platformAccessory: class {}
})

const { propertyIds: PIDs } = require('wyze-api')
const PropertyPoller = require('../src/propertyPoller')
const WyzeAccessory = require('../src/accessories/WyzeAccessory')
const WyzeCamera = require('../src/accessories/WyzeCamera')
const WyzeLight = require('../src/accessories/WyzeLight')
const WyzeMeshLight = require('../src/accessories/WyzeMeshLight')

function member (mac, extra = {}) {
  return { mac, display_name: `Dev ${mac}`, propertyPids: ['P3', 'P5'], wantsProperties: () => true, ...extra }
}

function setup (macs, { fetch, withMethod = true } = {}) {
  const calls = []
  const logs = { warn: [], info: [], debug: [] }
  const client = withMethod
    ? {
        getPropertyListForDevices: fetch || (async (devices, pids) => {
          calls.push({ macs: devices.map((d) => d.mac), pids })
          return new Map(devices.map((d) => [d.mac, [{ pid: 'P3', value: `${d.mac}-v`, ts: 1 }]]))
        })
      }
    : {}
  const log = { warn: (m) => logs.warn.push(m), info: (m) => logs.info.push(m), debug: (m) => logs.debug.push(m) }
  const poller = new PropertyPoller(client, { log })
  return { poller, accessories: macs.map((m) => member(m)), calls, logs }
}

// ---- the poller ---------------------------------------------------------------------------

test('20 devices are one request, and each device takes only its own rows', async () => {
  const macs = Array.from({ length: 20 }, (_, i) => `M${i}`)
  const { poller, accessories, calls, logs } = setup(macs)
  await poller.prefetch(accessories)
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].macs.length, 20)
  assert.deepStrictEqual(poller.take('M7'), { data: { property_list: [{ pid: 'P3', value: 'M7-v', ts: 1 }] } })
  assert.deepStrictEqual(logs.warn, [])
})

test('a single device also goes through the one request', async () => {
  const { poller, accessories, calls } = setup(['A'])
  await poller.prefetch(accessories)
  assert.strictEqual(calls.length, 1)
  assert.ok(poller.take('A'))
})

test('rows are handed out once, and do not carry over to the next cycle', async () => {
  const { poller, accessories } = setup(['A', 'B'])
  await poller.prefetch(accessories)
  assert.ok(poller.take('A'))
  assert.strictEqual(poller.take('A'), null)
  await poller.prefetch([])
  assert.strictEqual(poller.take('B'), null)
})

test('the request names the union of every device\'s properties once', async () => {
  const { poller, calls } = setup([])
  await poller.prefetch([
    member('A', { propertyPids: ['P3', 'P5'] }),
    member('B', { propertyPids: ['P5', 'P1501'] })
  ])
  assert.deepStrictEqual(calls[0].pids, ['P3', 'P5', 'P1501'])
})

test('devices that do not want their properties are not asked about, and nothing is warned', async () => {
  const { poller, calls, logs } = setup([])
  await poller.prefetch([member('A'), member('B', { wantsProperties: () => false }), member('C')])
  assert.deepStrictEqual(calls[0].macs, ['A', 'C'])
  assert.strictEqual(poller.take('B'), null)
  assert.deepStrictEqual(logs.warn, [])
})

test('no request at all when no device wants properties', async () => {
  const { poller, calls } = setup([])
  await poller.prefetch([member('A', { wantsProperties: () => false })])
  assert.strictEqual(calls.length, 0)
})

test('a wyze-api without the bulk read: devices read their own, one warning in total', async () => {
  const { poller, accessories, logs } = setup(['A', 'B'], { withMethod: false })
  assert.strictEqual(poller.available, false)
  for (let i = 0; i < 5; i++) await poller.prefetch(accessories)
  assert.strictEqual(poller.take('A'), null)
  assert.strictEqual(logs.warn.length, 1)
  assert.match(logs.warn[0], /no bulk property read/)
})

test('a device whose row is missing or empty reads its own, with one warning, until it is back', async () => {
  let rowsFor = { A: [{ pid: 'P3', value: '1', ts: 1 }], B: [] } // C is absent altogether
  const fetch = async () => new Map(Object.entries(rowsFor))
  const { poller, accessories, logs } = setup(['A', 'B', 'C'], { fetch })
  await poller.prefetch(accessories)
  await poller.prefetch(accessories)
  assert.ok(poller.take('A'))
  assert.strictEqual(poller.take('B'), null)
  assert.strictEqual(poller.take('C'), null)
  assert.strictEqual(logs.warn.length, 2, 'one warning each for B and C, not one per cycle')
  assert.match(logs.warn.join('\n'), /Dev B/)
  assert.match(logs.warn.join('\n'), /Dev C/)

  rowsFor = { A: [{ pid: 'P3', value: '1', ts: 1 }], B: [{ pid: 'P3', value: '1', ts: 1 }], C: [{ pid: 'P3', value: '1', ts: 1 }] }
  await poller.prefetch(accessories)
  assert.ok(poller.take('B'))
  assert.strictEqual(logs.info.filter((m) => /has its properties again/.test(m)).length, 2)
})

test('a failed request: every device falls back, one warning, one message when it works again', async () => {
  let fail = true
  const fetch = async (devices) => {
    if (fail) throw new Error('boom')
    return new Map(devices.map((d) => [d.mac, [{ pid: 'P3', value: '1', ts: 1 }]]))
  }
  const { poller, accessories, logs } = setup(['A', 'B'], { fetch })
  await poller.prefetch(accessories) // fails; does not throw
  assert.strictEqual(poller.take('A'), null)
  assert.strictEqual(poller.take('B'), null)
  assert.strictEqual(logs.warn.length, 1)
  assert.match(logs.warn[0], /boom/)

  for (let i = 0; i < 4; i++) await poller.prefetch(accessories)
  assert.strictEqual(logs.warn.length, 1, 'still failing: no second warning')

  fail = false
  for (let i = 0; i < 20; i++) await poller.prefetch(accessories) // wait out the back-off
  assert.ok(logs.info.some((m) => /working again/.test(m)))
  await poller.prefetch(accessories)
  assert.ok(poller.take('A'))

  fail = true
  for (let i = 0; i < 20; i++) await poller.prefetch(accessories)
  assert.strictEqual(logs.warn.length, 2, 'a new failure after recovering warns again')
})

test('failures back off (0, 1, 3, 7 cycles skipped)', async () => {
  let requests = 0
  const { poller, accessories } = setup(['A', 'B'], { fetch: async () => { requests += 1; throw new Error('down') } })
  const cycles = async (n) => { for (let i = 0; i < n; i++) await poller.prefetch(accessories) }
  await cycles(1); assert.strictEqual(requests, 1)
  await cycles(2); assert.strictEqual(requests, 2) // 1 asked, 1 skipped
  await cycles(4); assert.strictEqual(requests, 3) // 1 asked, 3 skipped
  await cycles(8); assert.strictEqual(requests, 4) // 1 asked, 7 skipped
})

// ---- each accessory names exactly what it reads --------------------------------------------

function switchedPids (file, resolve) {
  const source = fs.readFileSync(path.join(__dirname, '../src/accessories', file), 'utf8')
  const loop = source.indexOf('for (const property of')
  assert.ok(loop > 0, `no property loop in ${file}`)
  const end = source.indexOf('\n    }\n', source.indexOf('switch (property.pid)', loop))
  return [...source.slice(loop, end).matchAll(/case ([^:]+):/g)].map((m) => resolve(m[1].trim()))
}
const literal = (s) => s.replace(/"/g, '')
const named = (s) => PIDs[s.replace('PIDs.', '')]

test('the camera requests every property it switches on', () => {
  const used = switchedPids('WyzeCamera.js', literal)
  assert.ok(used.length >= 8)
  const asked = Object.create(WyzeCamera.prototype).propertyPids
  for (const pid of used) assert.ok(asked.includes(pid), `${pid} is read by WyzeCamera but not requested in bulk`)
})

test('the light requests every property it switches on', () => {
  const used = switchedPids('WyzeLight.js', named)
  assert.deepStrictEqual(used.sort(), [PIDs.BRIGHTNESS, PIDs.COLOR_TEMP].sort())
  const asked = Object.create(WyzeLight.prototype).propertyPids
  for (const pid of used) assert.ok(asked.includes(pid), `${pid} is read by WyzeLight but not requested in bulk`)
})

test('the mesh light requests every property it switches on', () => {
  const used = switchedPids('WyzeMeshLight.js', named)
  assert.deepStrictEqual(used.sort(), [PIDs.BRIGHTNESS, PIDs.COLOR_TEMP, PIDs.COLOR].sort())
  const asked = Object.create(WyzeMeshLight.prototype).propertyPids
  for (const pid of used) assert.ok(asked.includes(pid), `${pid} is read by WyzeMeshLight but not requested in bulk`)
})

// ---- an accessory takes the poller's rows first, its own read second ------------------------

function plain ({ poller, getDevicePID }) {
  const acc = Object.create(WyzeAccessory.prototype)
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: 'M' }, displayName: 'Dev' }
  acc.plugin = { client: { getDevicePID }, _propertyPoller: poller }
  return acc
}

test('_readPropertyList: the poller\'s rows, with no request of its own', async () => {
  let own = 0
  const rows = { data: { property_list: [{ pid: 'P3', value: 1 }] } }
  const acc = plain({ poller: { take: (mac) => (mac === 'AA' ? rows : null) }, getDevicePID: async () => { own += 1 } })
  assert.strictEqual(await acc._readPropertyList(), rows)
  assert.strictEqual(own, 0)
})

test('_readPropertyList: its own read when the poller has nothing, or there is no poller', async () => {
  const own = { data: { property_list: [] } }
  assert.strictEqual(await plain({ poller: { take: () => null }, getDevicePID: async () => own })._readPropertyList(), own)
  assert.strictEqual(await plain({ poller: undefined, getDevicePID: async () => own })._readPropertyList(), own)
})

test('_readPropertyList: a failing own read still rejects, so each accessory handles it as before', async () => {
  const acc = plain({ poller: { take: () => null }, getDevicePID: async () => { throw new Error('nope') } })
  await assert.rejects(() => acc._readPropertyList(), /nope/)
})

// ---- camera ---------------------------------------------------------------------------------

function camera ({ poller, getDevicePID }) {
  const acc = Object.create(WyzeCamera.prototype)
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: 'WYZE_CAKP2JFUS' }, displayName: 'Cam' }
  acc.plugin = {
    config: { sirenAccessory: ['AA'] },
    log: Object.assign(() => {}, { error: () => {} }),
    client: { cameraIsOnline: () => true, cameraUsesDeviceMgmt: () => false, getDevicePID },
    _propertyPoller: poller
  }
  acc._cameraControllerReady = true
  acc._detectFloodlightDongle = () => {}
  acc._hasFloodlightDongle = () => false
  acc._markServicesOnline = () => {}
  acc.persistState = () => {}
  acc.sirenSwitch = { getCharacteristic: () => ({ updateValue: () => {} }) }
  acc.lastDevice = { mac: 'AA' }
  return acc
}

test('a camera uses the poller\'s rows and makes no request of its own', async () => {
  let own = 0
  const rows = { data: { property_list: [{ pid: 'P1049', value: 1 }, { pid: 'P5', value: 1 }] } }
  const acc = camera({ poller: { take: () => rows }, getDevicePID: async () => { own += 1 } })
  await acc.updateCharacteristics({ mac: 'AA' })
  assert.strictEqual(own, 0)
  assert.strictEqual(acc.siren, 1)
  assert.strictEqual(acc.available, 1)
})

test('a camera with nothing from the poller reads its own properties', async () => {
  let own = 0
  const acc = camera({ poller: { take: () => null }, getDevicePID: async () => { own += 1; return { data: { property_list: [{ pid: 'P1049', value: 2 }] } } } })
  await acc.updateCharacteristics({ mac: 'AA' })
  assert.strictEqual(own, 1)
  assert.strictEqual(acc.siren, 2)
})

test('camera wantsProperties: only a configured, online, property-based camera', () => {
  const acc = camera({ poller: null, getDevicePID: async () => {} })
  assert.strictEqual(acc.wantsProperties(), true)
  acc.plugin.config = {}
  assert.strictEqual(acc.wantsProperties(), false) // no accessory configured
  acc.plugin.config = { sirenAccessory: ['AA'] }
  acc.plugin.client.cameraUsesDeviceMgmt = () => true
  assert.strictEqual(acc.wantsProperties(), false) // devicemgmt cameras use another API
  acc.plugin.client.cameraUsesDeviceMgmt = () => false
  acc.plugin.client.cameraIsOnline = () => false
  assert.strictEqual(acc.wantsProperties(), false) // offline
  acc.plugin.client.cameraIsOnline = () => true
  acc.lastDevice = null
  assert.strictEqual(acc.wantsProperties(), false) // not seen in an object list yet
})

// ---- lights ---------------------------------------------------------------------------------

function light (Class, { poller, getDevicePID }) {
  const acc = Object.create(Class.prototype)
  const pushed = {}
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: 'WLPA19' }, displayName: 'Bulb' }
  acc.plugin = {
    config: {},
    log: Object.assign(() => {}, { error: () => {} }),
    client: {
      getDevicePID,
      checkBrightnessValue: (v) => v,
      checkColorTemp: (v) => v,
      kelvinToMired: (v) => v
    },
    _propertyPoller: poller
  }
  acc.getService = () => undefined
  acc.getCharacteristic = (c) => ({ updateValue: (v) => { pushed[c] = v } })
  return { acc, pushed }
}

for (const Class of [WyzeLight, WyzeMeshLight]) {
  test(`${Class.name} uses the poller's rows and makes no request of its own`, async () => {
    let own = 0
    const rows = { data: { property_list: [{ pid: PIDs.BRIGHTNESS, value: '40' }, { pid: PIDs.COLOR_TEMP, value: '2700' }] } }
    const { acc, pushed } = light(Class, { poller: { take: () => rows }, getDevicePID: async () => { own += 1 } })
    await acc.updateCharacteristics({ conn_state: 1, device_params: { switch_state: 1 } })
    assert.strictEqual(own, 0)
    assert.strictEqual(Number(pushed.Brightness), 40)
  })

  test(`${Class.name} reads its own properties when the poller has nothing`, async () => {
    let own = 0
    const { acc, pushed } = light(Class, {
      poller: { take: () => null },
      getDevicePID: async () => { own += 1; return { data: { property_list: [{ pid: PIDs.BRIGHTNESS, value: '70' }] } } }
    })
    await acc.updateCharacteristics({ conn_state: 1, device_params: { switch_state: 1 } })
    assert.strictEqual(own, 1)
    assert.strictEqual(Number(pushed.Brightness), 70)
  })

  test(`${Class.name} wantsProperties: only an online light that has been seen`, () => {
    const { acc } = light(Class, { poller: null, getDevicePID: async () => {} })
    assert.strictEqual(acc.wantsProperties(), false) // not seen in an object list yet
    acc.lastDevice = { conn_state: 1, device_params: { switch_state: 1 } }
    assert.strictEqual(acc.wantsProperties(), true)
    acc.lastDevice = { conn_state: 0, device_params: { switch_state: 1 } }
    assert.strictEqual(acc.wantsProperties(), false) // offline
    acc.lastDevice = { conn_state: 1 }
    assert.strictEqual(acc.wantsProperties(), false) // no device_params
  })
}
