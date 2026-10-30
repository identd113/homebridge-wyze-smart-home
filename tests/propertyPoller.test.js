/**
 * One request per refresh cycle reads the properties of every camera that needs them, and a
 * camera that gets nothing from it reads its own, exactly as before.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

require('../src/types').update({
  hap: { Service: {}, Characteristic: { On: 'On' }, uuid: {}, Categories: {} },
  platformAccessory: class {}
})

const PropertyPoller = require('../src/camera/propertyPoller')
const WyzeCamera = require('../src/accessories/WyzeCamera')

function member (mac, extra = {}) {
  return { mac, propertyPids: ['P3', 'P5'], wantsProperties: () => true, ...extra }
}

function setup (macs, { fetch, withMethod = true, minDevices } = {}) {
  const calls = []
  const seen = {}
  const client = withMethod
    ? {
        getPropertyListForDevices: fetch || (async (devices, pids) => {
          calls.push({ macs: devices.map((d) => d.mac), pids })
          return new Map(devices.map((d) => [d.mac, [{ pid: 'P3', value: `${d.mac}-v`, ts: 1 }]]))
        })
      }
    : {}
  const log = { debug: () => {}, warn: (m) => (seen.warn = m) }
  const poller = new PropertyPoller(client, { log, minDevices })
  return { poller, accessories: macs.map((m) => member(m)), calls, seen }
}

test('20 cameras are one request, and each camera takes only its own rows', async () => {
  const macs = Array.from({ length: 20 }, (_, i) => `M${i}`)
  const { poller, accessories, calls } = setup(macs)
  await poller.prefetch(accessories)
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].macs.length, 20)
  assert.deepStrictEqual(poller.take('M7'), { data: { property_list: [{ pid: 'P3', value: 'M7-v', ts: 1 }] } })
})

test('rows are handed out once, so a second read in the same cycle falls back', async () => {
  const { poller, accessories } = setup(['A', 'B'])
  await poller.prefetch(accessories)
  assert.ok(poller.take('A'))
  assert.strictEqual(poller.take('A'), null)
})

test('rows do not carry over to the next cycle', async () => {
  const { poller, accessories } = setup(['A', 'B'])
  await poller.prefetch(accessories)
  await poller.prefetch([]) // next cycle with nothing to read
  assert.strictEqual(poller.take('A'), null)
})

test('the request names the union of every camera\'s properties once', async () => {
  const { poller, calls } = setup([])
  await poller.prefetch([
    member('A', { propertyPids: ['P3', 'P5'] }),
    member('B', { propertyPids: ['P5', 'P1056'] })
  ])
  assert.deepStrictEqual(calls[0].pids, ['P3', 'P5', 'P1056'])
})

test('only cameras that want their properties are asked about', async () => {
  const { poller, calls } = setup([])
  await poller.prefetch([member('A'), member('B', { wantsProperties: () => false }), member('C')])
  assert.deepStrictEqual(calls[0].macs, ['A', 'C'])
})

test('a single camera is left to read its own: batching one saves nothing', async () => {
  const { poller, accessories, calls } = setup(['A'])
  await poller.prefetch(accessories)
  assert.strictEqual(calls.length, 0)
  assert.strictEqual(poller.take('A'), null)
})

test('a wyze-api without the bulk read is left alone, with no error', async () => {
  const { poller, accessories } = setup(['A', 'B'], { withMethod: false })
  assert.strictEqual(poller.available, false)
  await poller.prefetch(accessories)
  assert.strictEqual(poller.take('A'), null)
})

test('a camera whose row is missing or empty reads its own; the others keep theirs', async () => {
  const fetch = async () => new Map([
    ['A', [{ pid: 'P3', value: '1', ts: 1 }]],
    ['B', []]
    // C is absent altogether
  ])
  const { poller, accessories } = setup(['A', 'B', 'C'], { fetch })
  await poller.prefetch(accessories)
  assert.ok(poller.take('A'))
  assert.strictEqual(poller.take('B'), null)
  assert.strictEqual(poller.take('C'), null)
})

test('a failed request gives every camera the fallback and does not throw', async () => {
  const { poller, accessories } = setup(['A', 'B'], { fetch: async () => { throw new Error('boom') } })
  await poller.prefetch(accessories)
  assert.strictEqual(poller.take('A'), null)
  assert.strictEqual(poller.take('B'), null)
})

test('failures back off (0, 1, 3 cycles skipped), warn on the 5th, and recover', async () => {
  let fail = true
  let requests = 0
  const fetch = async (devices) => {
    requests += 1
    if (fail) throw new Error('down')
    return new Map(devices.map((d) => [d.mac, [{ pid: 'P3', value: '1', ts: 1 }]]))
  }
  const { poller, accessories, seen } = setup(['A', 'B'], { fetch })
  const cycles = async (n) => { for (let i = 0; i < n; i++) await poller.prefetch(accessories) }

  await cycles(1) // failure 1: nothing to skip
  assert.strictEqual(requests, 1)
  await cycles(1) // failure 2 (skip next 1)
  await cycles(1) // skipped
  assert.strictEqual(requests, 2)
  await cycles(1) // failure 3 (skip next 3)
  await cycles(3) // skipped
  assert.strictEqual(requests, 3)
  await cycles(1) // failure 4 (skip next 7)
  await cycles(7)
  await cycles(1) // failure 5
  assert.strictEqual(requests, 5)
  assert.match(seen.warn, /keeps failing/)

  fail = false
  await cycles(15) // wait out the back-off
  await poller.prefetch(accessories)
  assert.ok(poller.take('A'))
})

test('the property list names every property WyzeCamera switches on', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/accessories/WyzeCamera.js'), 'utf8')
  const start = source.indexOf('for (const property of propertyList.data.property_list)')
  const end = source.indexOf('this.persistState(', start)
  assert.ok(start > 0 && end > start, 'could not find the property switch in WyzeCamera.js')
  const used = [...source.slice(start, end).matchAll(/case "(P\d+)"/g)].map((m) => m[1])
  assert.ok(used.length >= 8)
  for (const pid of used) assert.ok(PropertyPoller.CAMERA_PIDS.includes(pid), `${pid} is read by WyzeCamera but not requested in bulk`)
})

// ---- WyzeCamera: poller rows first, own read second -------------------------------------

function camera ({ poller, getDevicePID }) {
  const acc = Object.create(WyzeCamera.prototype)
  const logged = []
  acc.homeKitAccessory = { context: { mac: 'AA', product_model: 'WYZE_CAKP2JFUS' }, displayName: 'Cam' }
  acc.plugin = {
    config: { sirenAccessory: ['AA'] },
    log: Object.assign(() => {}, { error: (m) => logged.push(m) }),
    client: {
      cameraIsOnline: () => true,
      cameraUsesDeviceMgmt: () => false,
      getDevicePID
    },
    _propertyPoller: poller
  }
  acc._cameraControllerReady = true
  acc._detectFloodlightDongle = () => {}
  acc._hasFloodlightDongle = () => false
  acc._markServicesOnline = () => {}
  acc.persistState = () => {}
  acc.sirenSwitch = { getCharacteristic: () => ({ updateValue: () => {} }) }
  acc.lastDevice = { mac: 'AA' }
  return { acc, logged }
}

test('a camera uses the rows from the poller and makes no request of its own', async () => {
  let own = 0
  const rows = { data: { property_list: [{ pid: 'P1049', value: 1 }, { pid: 'P5', value: 1 }] } }
  const { acc } = camera({ poller: { take: (mac) => (mac === 'AA' ? rows : null) }, getDevicePID: async () => { own += 1 } })
  await acc.updateCharacteristics({ mac: 'AA' })
  assert.strictEqual(own, 0)
  assert.strictEqual(acc.siren, 1)
  assert.strictEqual(acc.available, 1)
})

test('a camera with nothing from the poller reads its own properties', async () => {
  let own = 0
  const { acc } = camera({
    poller: { take: () => null },
    getDevicePID: async () => { own += 1; return { data: { property_list: [{ pid: 'P1049', value: 2 }] } } }
  })
  await acc.updateCharacteristics({ mac: 'AA' })
  assert.strictEqual(own, 1)
  assert.strictEqual(acc.siren, 2)
})

test('a camera works with no poller at all', async () => {
  let own = 0
  const { acc } = camera({ poller: undefined, getDevicePID: async () => { own += 1; return { data: { property_list: [] } } } })
  await acc.updateCharacteristics({ mac: 'AA' })
  assert.strictEqual(own, 1)
})

test('wantsProperties: only a configured, online, property-based camera', () => {
  const { acc } = camera({ poller: null, getDevicePID: async () => {} })
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
