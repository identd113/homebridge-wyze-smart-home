/**
 * Compatibility guard: every wyze-api member the plugin calls must exist on
 * the installed wyze-api. Catches a plugin change that uses a method the
 * declared minimum version does not have (run after bumping either side).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const srcDir = path.join(__dirname, '..', 'src')

function jsFiles (dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'wyze-api') return []
    const p = path.join(dir, e.name)
    return e.isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : []
  })
}

test('every wyze-api member used by the plugin exists on the installed wyze-api', () => {
  const WyzeAPI = require('wyze-api')
  const client = new WyzeAPI({ username: 'u@example.com', password: 'p', keyId: 'k', apiKey: 'a', persistPath: require('os').tmpdir() })
  const used = new Map()
  for (const f of jsFiles(srcDir)) {
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(/\bclient\.([A-Za-z_]\w*)/g)) {
      if (!used.has(m[1])) used.set(m[1], path.relative(srcDir, f))
    }
  }
  const missing = [...used].filter(([name]) => !(name in client)).map(([name, file]) => `client.${name} (${file})`)
  assert.deepStrictEqual(missing, [], `wyze-api is missing: ${missing.join(', ')}`)
  client.destroy?.()
})
