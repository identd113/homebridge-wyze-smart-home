const types = require('./types')
const wyzeApiVersion = require('./wyzeApiVersion')

// Boot the plugin
module.exports = function (homebridge) {
  types.update(homebridge)

  // Check the wyze-api that is installed before loading anything that requires it: an old copy fails inside those
  // requires with a stack trace, not with the message that says what to install. The platform is still registered
  // (and does nothing) so the accessories already paired are left alone in the cache.
  const apiCheck = wyzeApiVersion.checkInstalled()
  if (!apiCheck.ok) {
    homebridge.registerPlatform('homebridge-wyze-smart-home', 'WyzeSmartHome', class InertWyzeSmartHome {
      constructor (log) {
        log.error(`[FATAL] ${apiCheck.message}`)
      }

      configureAccessory () {}
    })
    return
  }

  require('./WyzeSmartHome').register()
}
