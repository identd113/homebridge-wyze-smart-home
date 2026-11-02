'use strict'

/**
 * The README's "Supported hardware" grid must match what the plugin really recognises. These tests fail when a
 * model code is in the grid but not in wyze-api's model maps (or the other way round), when a group's count in its
 * heading is wrong, or when a device is listed as both supported and not supported.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { WyzeAccessoryModels, DeviceModels } = require('wyze-api')

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')
const gridStart = readme.indexOf('### Supported hardware')
const gridEnd = readme.indexOf('## Not Yet Supported')
const supported = readme.slice(gridStart, gridEnd)
const notYet = readme.slice(gridEnd, readme.indexOf('## Configuration'))

const codesIn = (text) => [...text.matchAll(/`([A-Z][A-Za-z0-9_.-]+)` \[report\]/g)].map((match) => match[1])

function recognisedCodes () {
  const codes = new Set()
  for (const models of Object.values(WyzeAccessoryModels)) {
    for (const value of Object.values(models)) for (const code of [].concat(value)) codes.add(code)
  }
  return codes
}

test('every model code in the supported grid is one the plugin recognises, and every recognised code is listed', () => {
  const listed = new Set(codesIn(supported))
  const known = recognisedCodes()
  assert.deepStrictEqual([...listed].filter((code) => !known.has(code)).sort(), [], 'in the grid but not recognised')
  assert.deepStrictEqual([...known].filter((code) => !listed.has(code)).sort(), [], 'recognised but not in the grid')
})

test('no model code is listed twice, or as both supported and not yet supported', () => {
  const all = codesIn(supported)
  assert.strictEqual(new Set(all).size, all.length, 'a code appears twice in the supported grid')
  const known = recognisedCodes()
  assert.deepStrictEqual(codesIn(notYet).filter((code) => known.has(code)), [])
})

test('each group heading counts its rows', () => {
  const groups = [...supported.matchAll(/<summary><strong>(.+?)<\/strong> \((\d+)\)<\/summary>([\s\S]*?)<\/details>/g)]
  assert.ok(groups.length >= 8, 'expected the device groups')
  for (const [, title, count, body] of groups) {
    const rows = body.split('\n').filter((line) => /^\| /.test(line)).length - 1 // minus the header row (the divider starts with "|-")
    assert.strictEqual(rows, Number(count), `${title}: heading says ${count}, table has ${rows}`)
  }
})

test('the doorbell and no-power-control claims in the grid match wyze-api', () => {
  const rowOf = (code) => supported.split('\n').find((line) => line.includes('`' + code + '`'))
  const doorbells = new Set(DeviceModels.DOORBELL)
  for (const code of codesIn(supported)) {
    const row = rowOf(code)
    if (/HomeKit doorbell/.test(row)) assert.ok(doorbells.has(code), `${code} is called a HomeKit doorbell but wyze-api does not know it as one`)
    if (doorbells.has(code)) assert.match(row, /HomeKit doorbell/, `${code} is a doorbell in wyze-api but the grid does not say so`)
    if (/No Privacy switch/.test(row)) assert.ok(DeviceModels.CAMERA_NO_POWER_CONTROL.includes(code), `${code} has "No Privacy switch" but wyze-api allows power control`)
    if (DeviceModels.CAMERA_NO_POWER_CONTROL.includes(code)) assert.match(row, /No Privacy switch/, `${code} cannot be powered off but the grid does not say so`)
  }
})
