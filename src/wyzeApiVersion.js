const semver = require('semver')

/**
 * The minimum wyze-api version is declared once: `dependencies.wyze-api` in
 * package.json (a semver range). npm installs against it, the publish
 * workflows verify a matching release exists, and this check confirms the
 * wyze-api actually loaded at runtime satisfies it (e.g. a stale `npm link`
 * or a leftover older copy).
 */
function check (required, installed) {
  if (!required || !installed) {
    return { ok: false, required, installed, message: `Could not determine wyze-api version (required: ${required}, installed: ${installed}).` }
  }
  // includePrerelease: a beta range like ^2.0.0-beta.3 must accept 2.0.0-beta.4.
  const ok = semver.satisfies(installed, required, { includePrerelease: true })
  return {
    ok,
    required,
    installed,
    message: ok
      ? `wyze-api ${installed} satisfies ${required}`
      : `wyze-api ${installed} is installed but this plugin requires ${required}. Update it (npm install wyze-api@"${required}") and restart Homebridge.`
  }
}

function checkInstalled () {
  const required = require('../package.json').dependencies?.['wyze-api']
  let installed
  try {
    installed = require('wyze-api/package.json').version
  } catch (e) {
    return { ok: false, required, installed, message: `wyze-api could not be loaded: ${e.message}` }
  }
  return check(required, installed)
}

module.exports = { check, checkInstalled }
