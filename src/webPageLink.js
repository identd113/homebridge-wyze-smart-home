'use strict'

const fs = require('fs')
const path = require('path')

// Where the camera test page is, for the plugin's settings screen in Homebridge. The plugin writes the links here when
// the page starts and removes the file when it stops; the settings screen reads it to offer an "Open" button. It sits in
// the plugin's own folder under Homebridge's storage, and only the user running Homebridge can read it, because a link
// holds the page's token.
const FOLDER = 'homebridge-wyze-smart-home'
const FILE = 'web-page.json'

const filePath = (storagePath) => path.join(storagePath, FOLDER, FILE)

/** Notes the links. Never throws: the page works without it. */
function write (storagePath, { port, urls }) {
  if (!storagePath) return false
  try {
    fs.mkdirSync(path.join(storagePath, FOLDER), { recursive: true })
    const file = filePath(storagePath)
    fs.writeFileSync(file, JSON.stringify({ version: 1, port, urls }), { mode: 0o600 })
    return true
  } catch (_) {
    return false
  }
}

function clear (storagePath) {
  if (!storagePath) return
  try { fs.unlinkSync(filePath(storagePath)) } catch (_) { /* already gone */ }
}

/** { urls: [...] } when the page is on (its links are only good while this Homebridge keeps running), else { urls: [] }. */
function read (storagePath) {
  if (!storagePath) return { port: null, urls: [] }
  try {
    const data = JSON.parse(fs.readFileSync(filePath(storagePath), 'utf8'))
    const urls = Array.isArray(data.urls) ? data.urls.filter((u) => typeof u === 'string' && /^http:\/\/[^\s]+$/.test(u)) : []
    return { port: Number.isInteger(data.port) ? data.port : null, urls }
  } catch (_) {
    return { port: null, urls: [] }
  }
}

module.exports = { write, clear, read }
