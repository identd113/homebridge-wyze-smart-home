/**
 * The scripts under .github/scripts read issue text that anyone can write. From the review of the merge into 2.0.0:
 * secrets named in the way the README documents, headings with a long run of spaces, form answers named like object
 * properties, labels a maintainer set by hand, and text with "$&" in it. The sweeps run every parser on hostile input.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const credentials = require('../.github/scripts/credentials.js')
const triage = require('../.github/scripts/triage-issue.js')
const origin = require('../.github/scripts/origin-label.js')
const deviceStatus = require('../.github/scripts/device-status.js')
const { sections } = require('../.github/scripts/forms.js')
const { ensureLabel, labelsSetByBot } = require('../.github/scripts/labels.js')

// ---- credentials ----

test('secrets named the way the README documents them (WYZE_PASSWORD=) are found and redacted', () => {
  for (const [text, name] of [
    ['WYZE_PASSWORD=hunter2hunter2', 'password'],
    ['export WYZE_API_KEY=abcdef123456', 'api_key'],
    ['WYZE_KEY_ID: abc-123-def', 'key_id'],
    ['homebridge: WYZE_TOTP_SECRET=JBSWY3DPEHPK3PXP', 'totp_secret']
  ]) {
    assert.deepStrictEqual(credentials.credentialKeysIn(text), [name], text)
    const out = credentials.redactCredentials(text)
    assert.ok(out.includes('REDACTED') && !/hunter2|abcdef123456|abc-123-def|JBSWY3DPEHPK3PXP/.test(out), out)
  }
  assert.deepStrictEqual(credentials.credentialKeysIn('mypassword=hunter2hunter2'), [], 'a name inside another word is not a secret name')
})

test('a password on the command line (--password value) is found and redacted, as the comment in the script says', () => {
  assert.deepStrictEqual(credentials.credentialKeysIn('node x.js --password hunter2x --user me'), ['password'])
  assert.strictEqual(credentials.redactCredentials('node x.js --password hunter2x --user me'), 'node x.js --password REDACTED --user me')
  assert.deepStrictEqual(credentials.credentialKeysIn('--password REDACTED'), [])
})

test('a quoted password with an escaped quote, or with spaces, is removed whole and nothing of it is left behind', () => {
  const tricky = '{"password": "p\\"ass-tail-leftover"}'
  assert.ok(!credentials.redactCredentials(tricky).includes('leftover'), credentials.redactCredentials(tricky))
  for (const text of ['password: my secret pass phrase', 'password="with a space" next', "pin = 'two words'"]) {
    const out = credentials.redactCredentials(text)
    assert.ok(!/secret pass|a space|two words|phrase/.test(out), out)
  }
  assert.strictEqual(credentials.redactCredentials('WYZE_API_KEY=abc123456 then more words'), 'WYZE_API_KEY=REDACTED then more words', 'a key is one word; the words after it stay')
  for (const text of ['password: my secret pass phrase', 'WYZE_PASSWORD=x1y2z3w4', '--password hunter2x']) {
    const once = credentials.redactCredentials(text)
    assert.strictEqual(credentials.redactCredentials(once), once, 'redacting twice changes nothing')
    assert.deepStrictEqual(credentials.credentialKeysIn(once), [], 'a second pass finds nothing')
  }
})

test('the issue title is scanned and redacted like the body', async () => {
  const updates = []
  const github = {
    rest: { issues: {
      update: async (args) => updates.push(args), getLabel: async () => {}, createLabel: async () => {}, addLabels: async () => {},
      removeLabel: async () => {}, addAssignees: async () => {}, createComment: async () => {}, updateComment: async () => {}
    } },
    paginate: async () => []
  }
  const issue = { number: 9, title: 'Login fails: WYZE_PASSWORD=hunter2hunter2', body: 'nothing secret here', labels: [], assignees: [] }
  await origin.run({ github, context: { repo: { owner: 'o', repo: 'r' }, payload: { action: 'opened', issue } }, core: { info () {}, warning () {} } })
  assert.ok(updates.length >= 1, 'the issue was edited')
  assert.strictEqual(updates[0].title, 'Login fails: WYZE_PASSWORD=REDACTED')
  assert.strictEqual(updates[0].body, 'nothing secret here')
})

// ---- headings and form answers ----

test('sections() reads the form the way the old split did', () => {
  const body = 'intro\r\n### Device\r\n\r\nCam v4 (HL_CAM4)\r\n\r\n### What are you reporting?\r\n\r\nIt works\r\n###NotAHeading\r\nstill the answer'
  assert.deepStrictEqual(sections(body), [
    { heading: 'Device', value: 'Cam v4 (HL_CAM4)' },
    { heading: 'What are you reporting?', value: 'It works\n###NotAHeading\nstill the answer' }
  ])
  assert.deepStrictEqual(sections(null), [])
})

test('a form answer named like an object property is just an unknown answer, not a crash', () => {
  const hostile = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__']
  const known = { supported: {}, notApplicable: {} }
  for (const value of hostile) {
    const body = Object.values(triage.FIELD).map((heading) => `### ${heading}\n\n${value}`).join('\n\n')
    assert.doesNotThrow(() => triage.triage(body, known), value)
    const result = triage.triage(body, known)
    assert.ok(!result.labels.some((l) => l.includes('function') || l.includes('Object')), `${value}: ${result.labels}`)
  }
})

// ---- the sweep: every parser, hostile input, bounded time ----

const longSpaces = ' '.repeat(200_000)
const inputs = {
  'a heading of spaces': `### ${longSpaces}x\nanswer`,
  'a heading with only spaces': `###${longSpaces}`,
  'many headings': '### a\n'.repeat(50_000),
  'a key with no value': 'password'.repeat(25_000),
  'key then spaces': `password${longSpaces}`,
  'quotes': '"password": "'.repeat(20_000),
  'escapes': `"password": "${'\\"'.repeat(60_000)}`,
  'flag then spaces': `--password${longSpaces}`,
  'brackets': `"macs": [${'"'.repeat(60_000)}`,
  'parens': `(Name: ${'('.repeat(60_000)}`,
  'long line of key=value': 'a=b '.repeat(50_000)
}
const parsers = {
  'forms.sections': sections,
  'triage.parseForm': triage.parseForm,
  'triage.sensitiveKeysIn': triage.sensitiveKeysIn,
  'origin.originLabel': origin.originLabel,
  'credentials.credentialKeysIn': credentials.credentialKeysIn,
  'credentials.personalKeysIn': credentials.personalKeysIn,
  'credentials.redactCredentials': credentials.redactCredentials,
  'credentials.redactAll': credentials.redactAll,
  'triage.triage': (text) => triage.triage(text, { supported: {}, notApplicable: {} })
}

test('every parser of issue text finishes in good time on hostile input', () => {
  const slow = []
  for (const [name, parse] of Object.entries(parsers)) {
    assert.strictEqual(typeof parse, 'function', name)
    for (const [what, input] of Object.entries(inputs)) {
      const start = process.hrtime.bigint()
      try { parse(input) } catch (err) { slow.push(`${name} on ${what}: threw ${err.message}`); continue }
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      if (ms > 500) slow.push(`${name} on ${what}: ${Math.round(ms)} ms`)
    }
  }
  assert.deepStrictEqual(slow, [])
})

test('no script in .github/scripts splits issue text on a regular expression with a lazy group and trailing spaces', () => {
  const dir = path.join(__dirname, '../.github/scripts')
  const offenders = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).filter((f) => /split\(\/\^###/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
  assert.deepStrictEqual(offenders, [], 'read headings with forms.sections() instead')
})

// ---- labels ----

function fakeGithub ({ labels = [], events = [], existing = [] } = {}) {
  const calls = { created: [], removed: [], added: [] }
  const github = {
    rest: { issues: {
      getLabel: async ({ name }) => { if (!existing.includes(name)) throw Object.assign(new Error('nope'), { status: 404 }) },
      createLabel: async ({ name }) => { calls.created.push(name) },
      listLabelsForRepo: 'listLabelsForRepo',
      listEvents: 'listEvents',
      removeLabel: async ({ name }) => { calls.removed.push(name) },
      addLabels: async ({ labels: l }) => { calls.added.push(...l) }
    } },
    paginate: async (fn) => (fn === 'listEvents' ? events : labels.map((name) => ({ name })))
  }
  return { github, calls }
}

test('only labels the bot added are taken off an edited issue; a maintainer\'s own label stays', async () => {
  const bot = { type: 'Bot' }
  const person = { type: 'User' }
  const { github } = fakeGithub({ events: [
    { event: 'labeled', label: { name: 'kind:camera' }, actor: bot },
    { event: 'labeled', label: { name: 'kind:lock' }, actor: person }, // a maintainer chose this
    { event: 'labeled', label: { name: 'report:works' }, actor: bot },
    { event: 'unlabeled', label: { name: 'report:works' }, actor: person },
    { event: 'labeled', label: { name: 'report:works' }, actor: person } // put back by a person
  ] })
  const set = await labelsSetByBot(github, 'o', 'r', 1)
  assert.deepStrictEqual([...set], ['kind:camera'])
})

test('a model label is not created once the repository has plenty, and an existing one is always usable', async () => {
  const many = Array.from({ length: 300 }, (_, i) => `model:M${i}`)
  const full = fakeGithub({ labels: many })
  assert.strictEqual(await ensureLabel(full.github, 'o', 'r', 'model:NEWONE'), false)
  assert.deepStrictEqual(full.calls.created, [])
  const some = fakeGithub({ labels: many.slice(0, 10) })
  assert.strictEqual(await ensureLabel(some.github, 'o', 'r', 'model:NEWONE'), true)
  assert.deepStrictEqual(some.calls.created, ['model:NEWONE'])
  const existing = fakeGithub({ labels: many, existing: ['model:M1'] })
  assert.strictEqual(await ensureLabel(existing.github, 'o', 'r', 'model:M1'), true)
  assert.deepStrictEqual(existing.calls.created, [])
  const other = fakeGithub({ labels: many })
  assert.strictEqual(await ensureLabel(other.github, 'o', 'r', 'needs-info'), true, 'labels without a reporter-chosen part are not limited')
})

// ---- text with $ in it ----

test('a README row with "$&" or "$1" in it is changed as text, not expanded', () => {
  const readme = [
    '## Supported Devices',
    '',
    '| Device | Model | Notes | Status |',
    '|---|---|---|---|',
    '| Odd | `ZZ_ODD` [report](https://example.com/x) | works with $& and $1 and $` | 🟡 |',
    '',
    '## Not Yet Supported'
  ].join('\n')
  const result = deviceStatus.raiseToUser(readme, 'ZZ_ODD')
  assert.ok(result && result.changed, 'the row was found and raised')
  assert.ok(result.text.includes('works with $& and $1 and $` |'), result.text)
  assert.ok(result.text.includes('| 🔵 |'), 'the status moved up')
  assert.strictEqual(result.text.split('\n').length, readme.split('\n').length, 'nothing was duplicated or swallowed')
})
