/**
 * The issue triage (.github/scripts/triage-issue.js) reads the "Wyze device report"
 * form. These bodies are shaped the way GitHub writes a submitted issue form.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const triage = require('../.github/scripts/triage-issue.js')
const known = { supported: require('../.github/scripts/known-models.json'), notApplicable: triage.NOT_APPLICABLE }

const blobFor = (model, extra = {}) => JSON.stringify({ product_model: model, product_type: 'Common', firmware_ver: '1.2.3', ...extra }, null, 2)

function issue ({ report = 'It is not supported yet', device = triage.OTHER_DEVICE, model = 'HL_NEW1', kind = 'Light, bulb or light strip', blob = blobFor(model), details = 'turns on' } = {}) {
  return [
    '### Before you start', '', '- [x] I looked at the README lists', '',
    '### What are you reporting?', '', report, '',
    '### Device', '', device, '',
    '### Model code (only if your device is not in the list)', '', model, '',
    '### What kind of device is it?', '', kind, '',
    '### Plugin version', '', '_No response_', '',
    '### What the device does, and what you see in HomeKit', '', details, '',
    '### Device information', '', '```json', blob, '```', '',
    '### Anything else from the log (optional)', '', '_No response_', ''
  ].join('\n')
}

test('the headings the script reads are the ones in the issue form', () => {
  const form = fs.readFileSync(path.join(__dirname, '../.github/ISSUE_TEMPLATE/new-device.yml'), 'utf8')
  for (const heading of Object.values(triage.FIELD)) assert.ok(form.includes(`label: ${heading}`), heading)
  for (const kind of Object.keys(triage.KIND_LABELS)) assert.ok(form.includes(`- ${kind}`), kind)
  for (const report of Object.keys(triage.REPORT_LABELS)) assert.ok(form.includes(`- ${report}`), report)
})

test('a form body is split into its fields, and "No response" is empty', () => {
  const fields = triage.parseForm(issue())
  assert.strictEqual(fields['Model code (only if your device is not in the list)'], 'HL_NEW1')
  assert.strictEqual(fields['Plugin version'], '')
  assert.ok(fields['Device information'].startsWith('{'), 'the json fence is removed')
})

test('a new model gets a model label, a kind label and no complaints', () => {
  const r = triage.triage(issue(), known)
  assert.strictEqual(r.status, 'new')
  assert.deepStrictEqual(r.labels, ['kind:light', 'model:HL_NEW1', 'new device'])
  assert.deepStrictEqual(r.problems, [])
  assert.deepStrictEqual(r.leaks, [])
})

test('a model the plugin handles is labelled already-supported and says what handles it', () => {
  const r = triage.triage(issue({ model: 'HL_DB2', kind: 'Camera or doorbell' }), known)
  assert.strictEqual(r.status, 'supported')
  assert.ok(r.labels.includes('already-supported'))
  assert.ok(!r.labels.some((l) => l.startsWith('model:')))
  assert.match(triage.buildComment(r, known), /handled as: camera or doorbell/)
})

test('scales, headphones and chimes are labelled not-applicable', () => {
  for (const model of ['WL_SC3', 'JA_HP', 'GW_CHI', 'CHIME']) {
    const r = triage.triage(issue({ model }), known)
    assert.strictEqual(r.status, 'not-applicable', model)
    assert.ok(r.labels.includes('not-applicable'))
  }
})

test('personal details in the pasted text are flagged by key, and never repeated', () => {
  const blob = blobFor('HL_NEW1', { mac: 'HL_NEW1_AABBCCDDEEFF', nickname: 'Example Lock', ip: '192.0.2.10', ssid: 'ExampleWifi' })
  const r = triage.triage(issue({ blob }), known)
  assert.deepStrictEqual(r.leaks, ['ip', 'mac', 'nickname', 'ssid'])
  assert.ok(r.labels.includes('needs-redaction'))
  const comment = triage.buildComment(r, known)
  for (const secret of ['AABBCCDDEEFF', 'Example Lock', '192.0.2.10', 'ExampleWifi']) assert.ok(!comment.includes(secret), secret)
  assert.match(comment, /Delete revision/)
})

test('values replaced with REDACTED are accepted', () => {
  const blob = blobFor('HL_NEW1', { mac: 'REDACTED', nickname: 'REDACTED', ip: '<redacted>', ssid: '***' })
  assert.deepStrictEqual(triage.triage(issue({ blob }), known).leaks, [])
})

test('a firmware version that looks like an IP address is not a leak', () => {
  const blob = blobFor('HL_NEW1', { firmware_ver: '4.10.3.22' })
  assert.deepStrictEqual(triage.triage(issue({ blob }), known).leaks, [])
})

test('a MAC in a pasted log line is flagged', () => {
  assert.deepStrictEqual(triage.sensitiveKeysIn('Unsupported device type: (Name: X) (MAC: AABBCCDDEEFF) (Model: HL_A)'), ['mac'])
})

test('a blob that is not JSON, or lacks the model code, needs more information', () => {
  const broken = triage.triage(issue({ blob: '{ "product_model": ' }), known)
  assert.ok(broken.labels.includes('needs-info'))
  assert.match(broken.problems[0], /not valid JSON/)
  const wrong = triage.triage(issue({ blob: blobFor('SOMETHING_ELSE') }), known)
  assert.ok(wrong.labels.includes('needs-info'))
  assert.match(wrong.problems[0], /does not mention the model code/)
})

test('a missing or odd model code is rejected and does not become a label', () => {
  for (const model of ['', '_No response_', 'x', '../../etc', 'a b', 'HL_NEW1; rm -rf /']) {
    const r = triage.triage(issue({ model }), known)
    assert.ok(r.labels.includes('needs-info'), JSON.stringify(model))
    assert.ok(!r.labels.some((l) => l.startsWith('model:')), JSON.stringify(model))
  }
  assert.strictEqual(triage.cleanModel('`HL_NEW1`'), 'HL_NEW1')
})

test('requests for the same model are counted in the comment', () => {
  const r = triage.triage(issue(), known)
  assert.match(triage.buildComment(r, known, [12]), /One other person has asked for this model too: #12/)
  assert.match(triage.buildComment(r, known, [12, 15]), /2 other people have asked for this model too: #12, #15/)
  assert.ok(!/other people/.test(triage.buildComment(r, known, [])))
})

test('the comment is marked so it can be found and updated', () => {
  assert.ok(triage.buildComment(triage.triage(issue(), known), known).startsWith(triage.MARKER))
})

test('known-models.json lists exactly the models wyze-api provides', () => {
  const generated = require('../.github/scripts/gen-known-models.js').build()
  assert.deepStrictEqual(known.supported, generated, 'run `npm run known-models` and commit the result')
})

test('run() labels the issue, creates missing labels, and posts one comment', async () => {
  const calls = { created: [], added: [], comments: [] }
  const github = {
    rest: {
      issues: {
        getLabel: async ({ name }) => { if (name !== 'new device') { const e = new Error('nf'); e.status = 404; throw e } },
        createLabel: async ({ name }) => calls.created.push(name),
        addLabels: async ({ labels }) => calls.added.push(...labels),
        removeLabel: async () => {},
        listForRepo: async () => ({ data: [{ number: 7 }, { number: 9, pull_request: {} }, { number: 42 }] }),
        listComments: async () => {},
        createComment: async ({ body }) => calls.comments.push(body),
        updateComment: async () => { throw new Error('should create, not update') }
      }
    },
    paginate: async () => []
  }
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { issue: { number: 42, body: issue(), labels: [{ name: 'new device' }] } } }
  await triage.run({ github, context, core: { info () {} } })
  assert.deepStrictEqual(calls.created.sort(), ['kind:light', 'model:HL_NEW1'])
  assert.deepStrictEqual(calls.added.sort(), ['kind:light', 'model:HL_NEW1'])
  assert.strictEqual(calls.comments.length, 1)
  assert.match(calls.comments[0], /One other person has asked for this model too: #7\./, 'pull requests and the issue itself are not counted')
})

test('model codes that are Object.prototype names are new devices, not supported ones', () => {
  for (const model of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const r = triage.triage(issue({ model, blob: blobFor(model) }), known)
    assert.strictEqual(r.status, 'new', model)
    assert.ok(!r.labels.includes('already-supported'), model)
  }
})

test('"it works" on a supported model is labelled, thanked, and not told it is unsupported', () => {
  const r = triage.triage(issue({ report: 'It works', model: 'HL_DB2', kind: 'Camera or doorbell', blob: '' }), known)
  assert.strictEqual(r.status, 'supported')
  assert.strictEqual(r.report, 'works')
  assert.ok(r.labels.includes('report:works') && r.labels.includes('already-supported'))
  assert.deepStrictEqual(r.problems, [], 'the device information is optional for a working device')
  const comment = triage.buildComment(r, known)
  assert.match(comment, /Thanks for confirming that `HL_DB2` works/)
  assert.ok(!/If it does not show up in HomeKit/.test(comment))
})

test('"partly works" and "does not work" on a supported model ask for versions, logs and config', () => {
  for (const [report, label] of [['It partly works', 'report:partial'], ['It does not work', 'report:broken']]) {
    const r = triage.triage(issue({ report, model: 'HL_DB2', kind: 'Camera or doorbell', blob: '' }), known)
    assert.ok(r.labels.includes(label), report)
    const comment = triage.buildComment(r, known)
    assert.match(comment, /wyze-api` version/)
    assert.match(comment, /Log Level set to debug/)
  }
})

test('"it works" on a model the plugin does not handle is treated as a request', () => {
  const r = triage.triage(issue({ report: 'It works' }), known)
  assert.strictEqual(r.status, 'new')
  assert.ok(r.misfiled)
  assert.match(triage.buildComment(r, known), /treated as a request to add it/)
})

test('an issue made before the report question existed is still read as a request', () => {
  const body = issue().replace(/### What are you reporting\?\n\n.*\n\n/, '')
  const r = triage.triage(body, known)
  assert.strictEqual(r.status, 'new')
  assert.ok(!r.misfiled)
  assert.ok(!r.labels.some((l) => l.startsWith('report:')))
})

test('the device chosen from the list supplies the model code', () => {
  const r = triage.triage(issue({ report: 'It works', device: 'Cam v2 (WYZEC1-JZ)', model: '', blob: '' }), known)
  assert.strictEqual(r.model, 'WYZEC1-JZ')
  assert.strictEqual(r.status, 'supported')
  assert.strictEqual(triage.modelFrom({ Device: 'Light Strip Pro (HL_LSLP)', 'Model code (only if your device is not in the list)': 'IGNORED' }), 'HL_LSLP')
})

test('picking "not in this list" without a model code asks for one', () => {
  const r = triage.triage(issue({ model: '' }), known)
  assert.ok(r.labels.includes('needs-info'))
  assert.match(r.problems[0], /not picked from the list/)
})

test('an issue made before the device list existed still has its model read', () => {
  const body = issue().replace('### Model code (only if your device is not in the list)', '### Model code').replace(/### Device\n\n.*\n\n/, '')
  assert.strictEqual(triage.triage(body, known).model, 'HL_NEW1')
})

test('every model the plugin handles has a name in the device list, and the form lists them all', () => {
  const names = require('../.github/scripts/device-names.json')
  const gen = require('../.github/scripts/gen-device-options.js')
  for (const code of Object.keys(known.supported)) {
    const d = names[code]
    assert.ok(d && d.name && gen.SECTIONS.includes(d.section) && /^\d{4}-\d{2}$/.test(d.released), `add ${code} to .github/scripts/device-names.json, then run npm run device-options`)
  }
  const form = fs.readFileSync(gen.FORM, 'utf8')
  assert.strictEqual(gen.render(form), form, 'run `npm run device-options` and commit the result')
})

test('the form asks for two confirmations first and requires little else', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../.github/ISSUE_TEMPLATE/new-device.yml'), 'utf8')
  assert.ok(yaml.indexOf('id: checks') < yaml.indexOf('id: report'), 'the confirmations come first')
  assert.strictEqual((yaml.match(/required: true/g) || []).length, 4, 'two confirmations, what you are reporting, and the device')
})

test('the device list is grouped, and newest first inside each group', () => {
  const names = require('../.github/scripts/device-names.json')
  const gen = require('../.github/scripts/gen-device-options.js')
  const opts = gen.options().slice(0, -1)
  const byCode = (o) => names[triage.modelFrom({ Device: o })]
  const sections = opts.map((o) => byCode(o).section)
  assert.deepStrictEqual([...new Set(sections)], gen.SECTIONS.filter((s) => sections.includes(s)), 'groups stay together, in order')
  for (let i = 1; i < opts.length; i++) {
    if (byCode(opts[i]).section === byCode(opts[i - 1]).section) assert.ok(byCode(opts[i - 1]).released >= byCode(opts[i]).released, opts[i])
  }
  assert.strictEqual(opts[0].startsWith('Doorbells - '), true)
  assert.strictEqual(gen.options().at(-1), gen.OTHER)
})

test('a device picked from the list gets its kind label without the kind question', () => {
  const r = triage.triage(issue({ report: 'It works', device: 'Cam v2 (WYZEC1-JZ)', model: '', kind: '_No response_', blob: '' }), known)
  assert.ok(r.labels.includes('kind:camera'))
  assert.strictEqual(triage.triage(issue({ device: 'Palm Lock (DX_PVLOC)', model: '', kind: '_No response_' }), known).labels.includes('kind:lock'), true)
  assert.strictEqual(triage.kindFromModel('NOT_A_MODEL'), null)
})

test('a kind the reporter picked wins over the one from the list', () => {
  const r = triage.triage(issue({ device: 'Cam v2 (WYZEC1-JZ)', model: '', kind: 'Something else' }), known)
  assert.ok(r.labels.includes('kind:other') && !r.labels.includes('kind:camera'))
})

test('every group in the device list maps to a kind label', () => {
  for (const section of require('../.github/scripts/gen-device-options.js').SECTIONS) assert.ok(triage.SECTION_KIND[section], section)
})

test('every model in the README has a report link that picks a real option in the form', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8')
  const options = new Set(require('../.github/scripts/gen-device-options.js').options())
  const linked = new Set()
  for (const m of readme.matchAll(/`([^`]+)` \[report\]\(https:\/\/github\.com\/identd113\/homebridge-wyze-smart-home\/issues\/new\?template=new-device\.yml&device=([^&)]+)&origin=readme\)/g)) {
    const option = decodeURIComponent(m[2])
    assert.ok(options.has(option), option)
    assert.strictEqual(triage.modelFrom({ Device: option }), m[1], 'the link is on the row of its own model code')
    linked.add(m[1])
  }
  for (const code of Object.keys(known.supported)) assert.ok(linked.has(code), `${code} needs a report link in the README`)
})

test('the origin question is in both forms, and the label comes from its answer', () => {
  const origin = require('../.github/scripts/origin-label.js')
  for (const form of ['bug-report.yml', 'new-device.yml']) {
    assert.ok(fs.readFileSync(path.join(__dirname, '../.github/ISSUE_TEMPLATE', form), 'utf8').includes(`label: ${origin.HEADING}`), form)
  }
  assert.strictEqual(origin.originLabel(`### ${origin.HEADING}\n\nwyze-api\n\n### Other\n\nx`), 'from:wyze-api')
  assert.strictEqual(origin.originLabel(`### ${origin.HEADING}\n\n_No response_`), null)
  assert.strictEqual(origin.originLabel(`### ${origin.HEADING}\n\nsome long sentence with spaces`), null)
  assert.strictEqual(origin.originLabel('### Plugin version\n\n2.0.0'), null)
})

test('a report only ever raises a device, and the level comes from its row and its own mark', () => {
  const st = require('../.github/scripts/device-status.js')
  const readme = [
    '## Supported Devices',
    '| Cam v2 | `WYZEC1-JZ` [report](https://x/y) | 🟢 |',
    '| Pan v4 | `HL_PAN4` [report](https://x/y) | 🟡 |',
    '| Doorbell | `HL_DB2` [report](https://x/y) | ✅ |',
    '| Bulb | `WLPA19` [report](https://x/y), `HL_HWB2` [report](https://x/z) | 🟢 |',
    '## Not Yet Supported'
  ].join('\n')
  assert.deepStrictEqual(['WYZEC1-JZ', 'HL_PAN4', 'HL_DB2'].map((c) => st.statusOf(readme, c).name), ['supported', 'registered only', 'confirmed by a maintainer'])
  const one = st.raiseToUser(readme, 'HL_PAN4')
  assert.ok(one.changed && one.text.includes('| 🔵 |') && one.text.includes('`HL_PAN4`'), 'a single-code row gets its status replaced')
  assert.strictEqual(st.statusOf(one.text, 'HL_PAN4').name, 'confirmed by a user')
  const shared = st.raiseToUser(readme, 'HL_HWB2')
  assert.ok(shared.text.includes('`HL_HWB2` 🔵 [report]') && !shared.text.includes('`WLPA19` 🔵'), 'on a shared row only that code is raised')
  assert.strictEqual(st.statusOf(shared.text, 'HL_HWB2').name, 'confirmed by a user')
  assert.strictEqual(st.statusOf(shared.text, 'WLPA19').name, 'supported')
  assert.strictEqual(st.raiseToUser(one.text, 'HL_PAN4').changed, false, 'already confirmed by a user: no change')
  assert.strictEqual(st.raiseToUser(readme, 'HL_DB2').changed, false, 'a maintainer-confirmed device is never lowered')
  assert.strictEqual(st.raiseToUser(readme, 'NOT_THERE'), null)
  assert.match(st.noChangeNote('HL_DB2', st.statusOf(readme, 'HL_DB2')), /`HL_DB2` is currently listed as confirmed by a maintainer, so your report will not update the existing list, but it is confirmation that this is still working/)
})

test('a works report on a device already confirmed is thanked and closed, one that can move up is not', () => {
  const st = require('../.github/scripts/device-status.js')
  const r = triage.triage(issue({ report: 'It works', device: 'Video Doorbell v2 (HL_DB2)', model: '', blob: '' }), known)
  const high = triage.buildComment(r, known, [], { level: 3, name: 'confirmed by a maintainer', symbol: '✅' })
  assert.match(high, /will not update the existing list/)
  assert.match(high, /being closed/)
  const low = triage.buildComment(r, known, [], { level: 1, name: 'supported', symbol: '🟢' })
  assert.match(low, /currently listed as supported/)
  assert.match(low, /moves up to confirmed by a user/)
  assert.ok(!/being closed/.test(low))
  assert.ok(st.USER === 2)
})

test('every supported model has a status in the real README', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8')
  const st = require('../.github/scripts/device-status.js')
  for (const code of Object.keys(known.supported)) assert.ok(st.statusOf(readme, code), `${code} needs a row in the README's supported tables`)
})

test('the verify workflow only runs for the verified label', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../.github/workflows/verify-device.yml'), 'utf8')
  assert.match(yaml, /github\.event\.label\.name == 'verified'/)
  assert.match(yaml, /types: \[labeled\]/)
})

test('a verified device is also taken off the unsupported list and the planned devices', () => {
  const verify = require('../.github/scripts/verify-device.js')
  const readme = [
    '| Air Purifier | `CO_AP1` [report](https://x/y) | a |',
    '## Not Yet Supported',
    '<summary><strong>Devices we do not support yet</strong> (6)</summary>',
    '| Device | Model code | Why | Effort |',
    '| Air Purifier | `CO_AP1` [report](https://x/y) | No accessory class | Medium |',
    '| Keypad | — | No model code | Unknown |',
    '## Configuration'
  ].join('\n')
  const dropped = verify.dropFromUnsupported(readme, 'CO_AP1')
  assert.strictEqual(dropped.removed, true)
  assert.ok(dropped.text.includes('(5)') && !dropped.text.includes('No accessory class') && dropped.text.includes('Keypad'))
  assert.ok(dropped.text.startsWith('| Air Purifier | `CO_AP1`'), 'the supported-table row above it is untouched')
  assert.strictEqual(verify.dropFromUnsupported(readme, 'NOPE').removed, false)

  const real = require('node:fs').readFileSync(path.join(__dirname, '../src/plannedDevices.js'), 'utf8')
  const gone = verify.dropPlanned(real, 'CO_AP1')
  assert.strictEqual(gone.removed, true)
  assert.ok(!gone.text.includes('CO_AP1') && gone.text.includes('YD_BT1'))
  assert.doesNotThrow(() => new Function('module', 'require', gone.text)({ exports: {} }, require), 'the file still runs')
})

test('the reporter is added to the list of people who confirmed devices, once per device', () => {
  const verify = require('../.github/scripts/verify-device.js')
  const readme = 'x\n<!-- confirmed-by -->\n<!-- /confirmed-by -->\ny'
  const first = verify.addSupporter(readme, 'octo-cat', 'HL_CAM4')
  assert.ok(first.added && first.text.includes('- [octo-cat](https://github.com/octo-cat): `HL_CAM4`'))
  const second = verify.addSupporter(first.text, 'Octo-Cat', 'WYZEC1-JZ')
  assert.ok(second.text.includes('`HL_CAM4`, `WYZEC1-JZ`') && (second.text.match(/octo-cat/gi) || []).length === 2, 'the same person gets one line, case aside')
  assert.strictEqual(verify.addSupporter(second.text, 'octo-cat', 'HL_CAM4').added, false, 'no duplicates')
  for (const bad of ['', null, 'a b', '../x', 'x]y', 'a'.repeat(40), '-lead']) assert.strictEqual(verify.addSupporter(readme, bad, 'HL_CAM4').added, false, String(bad))
  assert.strictEqual(verify.addSupporter('no list here', 'octo-cat', 'HL_CAM4').added, false)
  assert.ok(fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8').includes('<!-- confirmed-by -->'), 'the real README has the list')
})

test('every issue form assigns the maintainers, and the intake assigns them when a form did not', async () => {
  const { ASSIGNEES, assignIfUnassigned } = require('../.github/scripts/maintainers.js')
  const dir = path.join(__dirname, '../.github/ISSUE_TEMPLATE')
  for (const form of fs.readdirSync(dir).filter((f) => f.endsWith('.yml') && f !== 'config.yml')) {
    const head = fs.readFileSync(path.join(dir, form), 'utf8').split('body:')[0]
    assert.match(head, /^labels: \[.+\]$/m, `${form} sets labels`)
    for (const who of ASSIGNEES) assert.ok(head.includes(`assignees: [${JSON.stringify(who)}`), `${form} assigns ${who}`)
  }
  const calls = []
  const github = { rest: { issues: { addAssignees: async (a) => calls.push(a) } } }
  const core = { warning () {} }
  assert.strictEqual(await assignIfUnassigned({ github, core, owner: 'o', repo: 'r', number: 5 }), true)
  assert.deepStrictEqual(calls[0].assignees, ASSIGNEES)
  assert.strictEqual(await assignIfUnassigned({ github, core, owner: 'o', repo: 'r', number: 6, current: [{ login: 'someone' }] }), false, 'an assigned issue is left alone')
  const failing = { rest: { issues: { addAssignees: async () => { throw new Error('no access') } } } }
  assert.strictEqual(await assignIfUnassigned({ github: failing, core, owner: 'o', repo: 'r', number: 7 }), false, 'a failure is not thrown')
})

test('CI skips changes that only touch Markdown, so the README pull requests from verify need no run', () => {
  const ci = fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8')
  assert.match(ci, /pull_request:\n    paths-ignore: \["\*\*\.md"\]/)
  assert.match(ci, /branches: \[2\.x\]\n    paths-ignore: \["\*\*\.md"\]/)
})

test('pasted credentials are found by name, never by value, and removed ones are not', () => {
  const { credentialKeysIn } = require('../.github/scripts/credentials.js')
  const origin = require('../.github/scripts/origin-label.js')
  assert.deepStrictEqual(credentialKeysIn('{"username": "a@b.c", "password": "hunter2", "apiKey": "REDACTED", "keyId": "abc-123"}'), ['keyid', 'password'])
  assert.deepStrictEqual(credentialKeysIn('password: <hidden>\nkeyId=***\ntotpSecret = JBSWY3DPEHPK3PXP'), ['totpsecret'])
  assert.deepStrictEqual(credentialKeysIn('Using the password to log in. The token expired.'), [])
  assert.deepStrictEqual(credentialKeysIn('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789'), ['authorization'])
  const warning = origin.credentialComment(['keyid', 'password'], true)
  assert.ok(warning.includes('`keyid`') && warning.includes('`password`') && !/hunter2|abc-123/.test(warning))
  assert.match(warning, /replaced the values with `REDACTED` automatically/)
})

test('credentials are replaced with REDACTED in place, and nothing else in the text changes', () => {
  const { redactCredentials, credentialKeysIn } = require('../.github/scripts/credentials.js')
  const text = '{\n  "username": "a@b.c",\n  "password": "hunter2",\n  "apiKey": "REDACTED",\n  "keyId": "abc-123"\n}\nlog: totpSecret = JBSWY3DPEHPK3PXP and Bearer abcdefghijklmnopqrstuvwxyz0123456789\nUsing the password to log in.'
  const out = redactCredentials(text)
  assert.ok(!/hunter2|abc-123|JBSWY3DPEHPK3PXP|abcdefghijklmnopqrstuvwxyz0123456789/.test(out), out)
  assert.ok(out.includes('"username": "a@b.c"') && out.includes('Using the password to log in.'), 'the rest is untouched')
  assert.ok(out.includes('"password": "REDACTED"') && out.includes('totpSecret = REDACTED') && out.includes('Bearer REDACTED'))
  assert.deepStrictEqual(credentialKeysIn(out), [], 'a second pass finds nothing')
  assert.strictEqual(redactCredentials(out), out, 'redacting twice changes nothing')
})

test('the intake redacts the issue text, labels it, and warns once', async () => {
  const origin = require('../.github/scripts/origin-label.js')
  const calls = { updated: null, labels: [], comments: [] }
  const github = {
    rest: { issues: {
      update: async ({ body }) => { calls.updated = body }, getLabel: async () => {}, createLabel: async () => {},
      addLabels: async ({ labels }) => calls.labels.push(...labels), removeLabel: async () => {}, addAssignees: async () => {},
      listComments: async () => {}, createComment: async ({ body }) => calls.comments.push(body), updateComment: async () => {}
    } },
    paginate: async () => []
  }
  const issue = { number: 3, body: '### Plugin config\n\n{"password": "hunter2"}', labels: [], assignees: [] }
  await origin.run({ github, context: { repo: { owner: 'o', repo: 'r' }, payload: { action: 'opened', issue } }, core: { info () {}, warning () {} } })
  assert.ok(calls.updated.includes('"password": "REDACTED"') && !calls.updated.includes('hunter2'))
  assert.deepStrictEqual(calls.labels, ['credentials-exposed'])
  assert.strictEqual(calls.comments.length, 1)
  assert.ok(!calls.comments[0].includes('hunter2'))
})

test('the bug form is short, asks for the checks first, and has the origin question', () => {
  const yaml = require('node:fs').readFileSync(path.join(__dirname, '../.github/ISSUE_TEMPLATE/bug-report.yml'), 'utf8')
  const questions = (yaml.match(/^    id: /gm) || []).length
  assert.ok(questions <= 8, `${questions} questions`)
  assert.ok(yaml.indexOf('id: checks') < yaml.indexOf('id: what'))
  assert.ok(yaml.includes('label: Where did you come from?'))
})

test('a "does not work" report on a confirmed device is flagged as a possible regression, and never auto-closed', async () => {
  const calls = { labels: [], closed: false }
  const body = issue({ report: 'It does not work', device: 'Video Doorbell v2 (HL_DB2)', model: '', blob: '' })
  const github = {
    rest: { issues: {
      getLabel: async () => {}, createLabel: async () => {}, addLabels: async ({ labels }) => calls.labels.push(...labels), removeLabel: async () => {},
      listForRepo: async () => ({ data: [] }), listComments: async () => {}, createComment: async ({ body: text }) => { calls.comment = text },
      updateComment: async () => {}, update: async () => { calls.closed = true }
    } },
    paginate: async () => []
  }
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { action: 'opened', issue: { number: 9, body, labels: [{ name: 'new device' }] } } }
  await triage.run({ github, context, core: { info () {} } })
  assert.ok(calls.labels.includes('regression') && calls.labels.includes('report:broken'))
  assert.match(calls.comment, /possible \*\*regression\*\*/)
  assert.strictEqual(calls.closed, false)
})

// An in-memory GitHub, enough for verify-device.js: one default branch with the real README,
// refs, pull requests and comments.
function fakeRepo ({ maintainer = true } = {}) {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const files = { main: { 'README.md': read('README.md'), 'src/plannedDevices.js': read('src/plannedDevices.js') } }
  const refs = { main: 'sha-main' }
  const state = { pulls: [], comments: [], closed: [], labels: [], removed: [], created: 0, deleted: [] }
  const file = (branch, p) => ({ data: { content: Buffer.from(files[branch][p]).toString('base64'), sha: `sha-${branch}-${p}` } })
  const rest = {
    repos: {
      getCollaboratorPermissionLevel: async () => ({ data: { permission: maintainer ? 'admin' : 'triage' } }),
      getContent: async ({ path: p, ref }) => file(files[ref] ? ref : 'main', p),
      createOrUpdateFileContents: async ({ path: p, branch, content }) => { files[branch][p] = Buffer.from(content, 'base64').toString('utf8') }
    },
    git: {
      getRef: async ({ ref }) => { const name = ref.replace('heads/', ''); if (!refs[name]) { const e = new Error('nf'); e.status = 404; throw e } return { data: { object: { sha: refs[name] } } } },
      createRef: async ({ ref }) => { const name = ref.replace('refs/heads/', ''); if (refs[name]) throw new Error('Reference already exists'); refs[name] = 'sha'; files[name] = { ...files.main } },
      deleteRef: async ({ ref }) => { const name = ref.replace('heads/', ''); delete refs[name]; delete files[name]; state.deleted.push(name) }
    },
    pulls: {
      list: async ({ head }) => ({ data: state.pulls.filter((p) => `o:${p.head}` === head && p.state === 'open') }),
      create: async ({ head, body }) => { const pr = { number: 100 + state.pulls.length, head, body, state: 'open' }; state.pulls.push(pr); state.created += 1; return { data: pr } },
      update: async ({ pull_number, body }) => { state.pulls.find((p) => p.number === pull_number).body = body }
    },
    issues: {
      createComment: async ({ body }) => state.comments.push(body),
      update: async ({ issue_number }) => state.closed.push(issue_number),
      removeLabel: async ({ name }) => state.removed.push(name),
      addLabels: async ({ labels }) => state.labels.push(...labels),
      addAssignees: async () => {}
    }
  }
  return { github: { rest }, state, files }
}

function verifyContext (number, login, model = 'Cam Pan v4 (HL_PAN4)') {
  const body = issue({ report: 'It works', device: model, model: '', blob: '' })
  const labels = [{ name: 'report:works' }, { name: 'already-supported' }]
  return { repo: { owner: 'o', repo: 'r' }, payload: { sender: { login: 'maint' }, repository: { default_branch: 'main' }, issue: { number, body, labels, user: { login, type: 'User' } } } }
}

test('verify: the first report opens one pull request that raises the device and thanks the reporter', async () => {
  const verify = require('../.github/scripts/verify-device.js')
  const { github, state, files } = fakeRepo()
  await verify.run({ github, context: verifyContext(20, 'alice'), core: { info () {}, warning () {} } })
  assert.strictEqual(state.created, 1)
  const readme = files['verified/hl-pan4']['README.md']
  assert.ok(readme.includes('- [alice](https://github.com/alice): `HL_PAN4`'))
  assert.ok(/Closes #20/.test(state.pulls[0].body))
  assert.strictEqual(files.main['README.md'].includes('alice'), false, 'the default branch is never written to')
})

test('verify: a second report for the same device joins the open pull request, no second PR', async () => {
  const verify = require('../.github/scripts/verify-device.js')
  const { github, state, files } = fakeRepo()
  const core = { info () {}, warning () {} }
  await verify.run({ github, context: verifyContext(20, 'alice'), core })
  await verify.run({ github, context: verifyContext(21, 'bob'), core })
  assert.strictEqual(state.created, 1, 'still one pull request')
  const readme = files['verified/hl-pan4']['README.md']
  assert.ok(readme.includes('[alice]') && readme.includes('[bob]'), 'both are credited')
  assert.ok(/Closes #20/.test(state.pulls[0].body) && /Closes #21/.test(state.pulls[0].body))
  assert.match(state.comments.at(-1), /already has a confirmation waiting in #100/)
  await verify.run({ github, context: verifyContext(21, 'bob'), core })
  assert.strictEqual((state.pulls[0].body.match(/Closes #21/g) || []).length, 1, 'verifying the same issue again adds nothing')
  assert.strictEqual((files['verified/hl-pan4']['README.md'].match(/\[bob\]/g) || []).length, 1)
})

test('verify: a branch left by a closed pull request is replaced, not a failure', async () => {
  const verify = require('../.github/scripts/verify-device.js')
  const { github, state } = fakeRepo()
  const core = { info () {}, warning () {} }
  await verify.run({ github, context: verifyContext(20, 'alice'), core })
  state.pulls[0].state = 'closed'
  await verify.run({ github, context: verifyContext(20, 'alice'), core })
  assert.deepStrictEqual(state.deleted, ['verified/hl-pan4'])
  assert.strictEqual(state.created, 2)
})

test('verify: a label from someone without write access is removed and nothing is created', async () => {
  const verify = require('../.github/scripts/verify-device.js')
  const { github, state } = fakeRepo({ maintainer: false })
  await verify.run({ github, context: verifyContext(20, 'alice'), core: { info () {}, warning () {} } })
  assert.deepStrictEqual(state.removed, ['verified'])
  assert.strictEqual(state.created, 0)
})

test('the verify workflow runs one at a time for the whole repo', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../.github/workflows/verify-device.yml'), 'utf8')
  assert.match(yaml, /group: verify-device\n/)
})

test('the triage comment says when another confirmation for the device is already waiting', () => {
  const r = triage.triage(issue({ report: 'It works', device: 'Cam Pan v4 (HL_PAN4)', model: '', blob: '' }), known)
  const text = triage.buildComment(r, known, [], { level: 0, name: 'registered only', symbol: '🟡' }, ['#100', '#21'])
  assert.match(text, /already waiting \(#100, #21\)/)
  assert.ok(!/already waiting/.test(triage.buildComment(r, known, [], { level: 0, name: 'registered only', symbol: '🟡' }, [])))
})
