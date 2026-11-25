/**
 * The tests themselves. A test with no assertion passes whatever the code does; this is how "never rings" and "never
 * throws" tests were found that checked nothing. A test counts as asserting if its body, or a helper in the same file
 * that it calls, contains an assertion. Skips that quietly switch a guard off are listed here with the reason.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const dir = __dirname
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js'))

test('every test makes at least one assertion, itself or through a helper in its file', () => {
  const offenders = []
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    const parts = text.split(/\n(?=test(?:\.\w+)?\()/).slice(1)
    // helpers: functions in the file that contain an assertion
    const helpers = new Set()
    for (const m of text.matchAll(/^(?:async )?function (\w+)[^{]*\{([\s\S]*?)^\}/gm)) if (/assert|\.rejects|\.throws/.test(m[2])) helpers.add(m[1])
    for (const m of text.matchAll(/^const (\w+) = (?:async )?\([^)]*\) =>\s*\{?([\s\S]*?)(?:^\}|\n\n)/gm)) if (/assert/.test(m[2])) helpers.add(m[1])
    for (const part of parts) {
      const name = (/^test(?:\.\w+)?\((['"`])(.*?)\1/s.exec(part) || [])[2] || part.slice(0, 60)
      const asserts = /assert|\.rejects|\.throws|\bexpect\(/.test(part) || [...helpers].some((h) => new RegExp(`\\b${h}\\(`).test(part))
      if (!asserts) offenders.push(`${file}: ${name}`)
    }
  }
  assert.deepStrictEqual(offenders, [])
})

test('no test is left on .only', () => {
  const offenders = files.filter((f) => /\b(test|describe|it)\.only\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
  assert.deepStrictEqual(offenders, [])
})

test('the only tests that skip themselves are the ones whose reason is written down', () => {
  const allowed = {
    'privateFiles.test.js': ['not a git checkout', 'npm pack is not available here']
  }
  const offenders = []
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const m of text.matchAll(/\bt\.skip\((['"`])(.*?)\1/g)) {
      if (!(allowed[file] || []).includes(m[2])) offenders.push(`${file}: ${m[2]}`)
    }
    for (const m of text.matchAll(/\b(?:test|it)\.skip\(/g)) offenders.push(`${file}: a test that is always skipped`)
  }
  assert.deepStrictEqual(offenders, [])
})
