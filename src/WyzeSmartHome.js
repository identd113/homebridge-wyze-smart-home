const fs = require('fs')
const path = require('path')
const { homebridge, Accessory, UUIDGen, Categories } = require('./types')
const enums = require('./enums')
const wyzeApiVersion = require('./wyzeApiVersion')
const plannedDevices = require('./plannedDevices')
const PropertyPoller = require('./propertyPoller')
const { OutdoorPlugModels, PlugModels, CommonModels, CameraModels, LeakSensorModels,
  TemperatureHumidityModels, LockModels, LockBoltV2Models, MotionSensorModels, ContactSensorModels, LightModels,
  LightStripModels, MeshLightModels, ThermostatModels, ThermostatRoomSensor, S1GatewayModels,
  VacuumModels, IrrigationModels } = enums

// Single canonical require path. In dev, `npm run dev-link` (with a wyze-api
// clone next to this one) links node_modules/wyze-api to that clone. In
// published builds it resolves to the wyze-api version pinned in package.json.
const WyzeAPI = require('wyze-api')
const { resolveSecrets, getValidatedBaseUrls, sanitizeDeviceName } = require('wyze-api/src/util/security')
const { WyzeLogger } = require('wyze-api/src/util/wyzeLogger')
const configMigrator = require('./configMigrator')
const WyzePlug = require('./accessories/WyzePlug')
const WyzeLight = require('./accessories/WyzeLight')
const WyzeMeshLight = require('./accessories/WyzeMeshLight')
const WyzeLock = require('./accessories/WyzeLock')
const WyzeLockBoltV2 = require('./accessories/WyzeLockBoltV2')
const WyzeContactSensor = require('./accessories/WyzeContactSensor')
const WyzeMotionSensor = require('./accessories/WyzeMotionSensor')
const WyzeTemperatureHumidity = require('./accessories/WyzeTemperatureHumidity')
const WyzeLeakSensor = require('./accessories/WyzeLeakSensor')
const WyzeCamera = require('./accessories/WyzeCamera')
const WyzeSwitch = require('./accessories/WyzeSwitch')
const WyzeHMS = require('./accessories/WyzeHMS')
const WyzeThermostat = require('./accessories/WyzeThermostat')
const WyzeRoomSensor = require('./accessories/WyzeRoomSensor')
const WyzeVacuum = require('./accessories/WyzeVacuum')
const WyzeIrrigation = require('./accessories/WyzeIrrigation')
const { createWebSettings } = require('./webSettings')
const { createWebSensors } = require('./webSensors')
const webPageLink = require('./webPageLink')

const PLUGIN_NAME = 'homebridge-wyze-smart-home'
const PLATFORM_NAME = 'WyzeSmartHome'

const DEFAULT_REFRESH_INTERVAL = 30000
const DEFAULT_SECURITY_REFRESH_INTERVAL = 10000

// Fixed window (independent of user-configured refresh intervals) used to skip
// a fast poll immediately after a full refresh — avoids a redundant back-to-back
// API call. Deliberately NOT tied to securityRefreshInterval: that value is also
// the fast poll's own tick cadence, so reusing it here could make the skip
// window as long as (or longer than) the poll loop itself and silently disable
// fast polling whenever refreshInterval <= securityRefreshInterval.
const FULL_REFRESH_SKIP_WINDOW_MS = 10000
// Empty device lists in a row before the accessories are treated as gone (see refreshDevices).
const EMPTY_LIST_REFRESHES = 3

// Accessories that make their own API call in updateCharacteristics and return
// a boolean indicating whether state changed — safe to fast-poll independently.
const FAST_POLL_CLASSES = new Set([WyzeLock, WyzeLockBoltV2])

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// The process-wide handler below is installed once, however many Wyze platform entries there are. It only logs rejected
// promises nobody awaited. There is none for uncaught exceptions: that would be for the whole Homebridge process, and
// a real fatal error has to stop it so that it restarts.
let processHandlersInstalled = false

module.exports = class WyzeSmartHome {
  constructor(log, config, api) {
    // Run the 2.0 normalizer first so the rest of the constructor sees a
    // single canonical shape regardless of whether the user is on 1.x
    // flat or 2.x nested config. normalize() also back-fills the legacy
    // top-level fields, so accessory code that reads e.g.
    // `this.plugin.config.pluginLoggingEnabled` keeps working unchanged.
    const normalized = configMigrator.normalize(config)

    // Use WyzeLogger — it sanitizes bearer tokens, credentials, GPS,
    // emails, and MACs at write time, so plugin-side log calls get the same
    // protection the API logger does. Set logging.disableRedaction=true in
    // config to bypass when capturing raw output for your own debugging.
    //
    // Wrap the instance in a callable so accessory code that uses the
    // legacy homebridge log shape (`this.plugin.log("msg")` as a function,
    // treated as info) keeps working alongside the leveled methods
    // (`this.log.debug(...)` etc.).
    const _wyzeLogger = new WyzeLogger({
      level: normalized.logging.level,
      prefix: 'homebridge-wyze-smart-home',
      redact: !normalized.logging.disableRedaction,
    })
    const callableLog = (...args) => _wyzeLogger.info(...args)
    for (const m of ['error', 'warn', 'warning', 'info', 'debug', 'setLevel']) {
      callableLog[m] = (...args) => _wyzeLogger[m](...args)
    }
    this.log = callableLog

    // One-shot disk rewrite: if the user is still on the 1.x flat shape,
    // rewrite their homebridge config.json to the 2.0 nested shape so the
    // config-ui-x form has something pretty to render. Failure is
    // non-fatal — the in-memory normalized config above keeps the running
    // plugin happy either way.
    try {
      const status = configMigrator.rewriteHomebridgeConfigOnDisk({
        configPath: api?.user?.configPath?.(),
        platformAlias: PLATFORM_NAME,
        log: this.log,
      })
      if (status !== 'already-migrated' && status !== 'migrated') {
        this.log.debug?.(`[config] auto-migration ${status}`)
      }
    } catch (e) {
      this.log.warn?.(`[config] auto-migration threw: ${e.message}`)
    }

    // Merge in credentials from secretsFile (if configured) and WYZE_* env vars,
    // and validate / lock down the auth/api base URLs to known Wyze hosts.
    this.api = api
    this.config = normalized
    try {
      this.config = resolveSecrets(normalized, this.log)
      Object.assign(this.config, getValidatedBaseUrls(this.config, this.log))
    } catch (e) {
      // A missing or unsafe secrets file, or a base URL on a host that is not Wyze's, used to throw out of the constructor and
      // take the bridge with it. It is a fatal startup problem like the others below: say so once and stay inert, with the
      // cached accessories left alone.
      this.log.error(`[FATAL] ${e.message}`)
      this.disabled = true
      this.accessories = []
      return
    }

    // Apply user-supplied product-code overrides BEFORE constructing the
    // client or scanning devices, so getAccessoryClass sees the extended
    // model maps. Lets users route a brand-new Wyze model to an existing
    // handler class for testing without waiting for a plugin release.
    const overrideResult = enums.applyConfigOverrides(this.config.deviceTypeOverrides, this.log)
    if (overrideResult.added > 0) {
      this.log.info?.(
        `[enums] Applied ${overrideResult.added} model override(s) from config` +
        (overrideResult.skipped > 0 ? `; ${overrideResult.skipped} already present` : '') +
        (overrideResult.unknownCategories.length ? `; ignored unknown categor${overrideResult.unknownCategories.length === 1 ? 'y' : 'ies'}: ${overrideResult.unknownCategories.join(', ')}` : '')
      )
    }

    // Fatal startup problems: log once and leave the platform inert. Cached
    // accessories are left alone (see configureAccessory) so a config or
    // version problem never removes paired accessories from HomeKit.
    const apiCheck = wyzeApiVersion.checkInstalled()
    // The library can differ between two installs of the same plugin version
    // (it is a range), so say which one is loaded: it is the first thing to ask for.
    if (apiCheck.installed) {
      this.log.info?.(`[Wyze] homebridge-wyze-smart-home ${require('../package.json').version}, wyze-api ${apiCheck.installed} (needs ${apiCheck.required})`)
    }
    const username = typeof this.config.username === 'string' ? this.config.username.trim() : ''
    const fatal = !apiCheck.ok
      ? apiCheck.message
      : !username
          ? 'Cannot log in to Wyze: no username specified. Add your Wyze account email to the plugin config ("username") and restart Homebridge.'
          : null
    if (fatal) {
      this.log.error(`[FATAL] ${fatal}`)
      this.disabled = true
      this.accessories = []
      return
    }

    this.client = this.getClient()

    this.accessories = []
    this._fastPollStats = new Map()
    this._knownUnsupported = new Set()
    this._lastFullRefreshAt = 0

    if (!processHandlersInstalled) {
      processHandlersInstalled = true
      process.on('unhandledRejection', (reason) => {
        this.log.error(`Unhandled promise rejection: ${reason?.stack ?? reason}`)
      })
    }

    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this))
    this.api.on('shutdown', () => this.shutdown())
  }

  // Close live camera sessions cleanly: a camera that is left with a dead viewer
  // (a restart used to abandon them) can refuse the next one for a while.
  shutdown() {
    this._stopped = true // the refresh loops and anything still waiting on Wyze stop acting
    for (const accessory of this.accessories ?? []) {
      try { accessory.stopStreams?.() } catch (_) { /* best effort */ }
      try { accessory.stop?.() } catch (_) { /* best effort */ }
    }
    this.webServer?.stop().catch(() => {})
    if (this.webServer) webPageLink.clear(this.api?.user?.storagePath?.() || '')
    return this.client?.closeAllCameraSessions?.().catch(() => {})
  }

  // The settings the camera test page shows (read-only), read from Homebridge's config.json.
  webSettings () {
    return createWebSettings({
      configPath: () => this.api?.user?.configPath?.(),
      platformAlias: PLATFORM_NAME,
      instanceName: this.config.name,
      running: () => this.config
    })
  }

  // The sensors list of the camera test page (read-only): what each camera has, and how the config reads for it.
  webSensors () {
    return createWebSensors({
      configPath: () => this.api?.user?.configPath?.(),
      platformAlias: PLATFORM_NAME,
      instanceName: this.config.name,
      storagePath: () => this.api?.user?.storagePath?.()
    })
  }

  // The devices the camera test page offers to test and report because the plugin has no support for them, and what
  // is already known about their model.
  otherDevicesForTestPage () {
    let apiVersion
    try { apiVersion = require('wyze-api/package.json').version } catch (_) { /* unknown */ }
    return {
      unsupported: (device) => !this.getAccessoryClass(device.product_type, device.product_model),
      describeDevice: (model) => {
        const known = plannedDevices.lookup(model)
        return known ? `This looks like a ${known.name}. ${known.note}` : undefined
      },
      versions: { plugin: require('../package.json').version, ...(apiVersion ? { 'wyze-api': apiVersion } : {}), node: process.version }
    }
  }

  // What the camera test page needs to open this plugin's device report form with some fields filled in.
  issueFormForTestPage () {
    let labels = {}
    try { labels = require('./deviceIssueLabels.json') } catch (_) { /* the page then fills in the model code instead */ }
    let apiVersion
    try { apiVersion = require('wyze-api/package.json').version } catch (_) { /* unknown */ }
    return {
      url: 'https://github.com/wyze-smart-home/homebridge-wyze-smart-home/issues/new',
      template: 'new-device.yml',
      origin: 'camera-test-page',
      kind: 'Camera or doorbell',
      plugin: `${require('../package.json').version}${apiVersion ? ` (wyze-api ${apiVersion})` : ''}`,
      deviceLabel: (model) => labels[model]
    }
  }

  // The camera test page: a web page in this process for testing each camera over the home network.
  // Off unless advanced.webServerPort is a port from 1024 up. A bad value or a busy port is logged and the
  // plugin carries on without the page. `lib` is wyze-api; tests pass a stand-in.
  async startCameraTestPage (lib = WyzeAPI) {
    webPageLink.clear(this.api?.user?.storagePath?.() || '') // a link left by an earlier run is no longer good
    const raw = this.config.webServerPort ?? this.config.advanced?.webServerPort
    if (raw === undefined || raw === null || raw === '' || raw === 0 || raw === '0') return
    try {
      if (typeof lib.validateWebPort !== 'function' || typeof lib.createCameraTestServer !== 'function') {
        this.log.warn?.('[Web] advanced.webServerPort is set, but the installed wyze-api is too old for the camera test page. Update wyze-api and restart.')
        return
      }
      const check = lib.validateWebPort(raw)
      if (check.error) {
        this.log.warn?.(`[Web] ${check.error}. The camera test page is off.`)
        return
      }
      if (!check.enabled) return
      this.webServer = lib.createCameraTestServer({ client: this.client, port: check.port, log: this.log, issueForm: this.issueFormForTestPage(), settings: this.webSettings(), sensors: this.webSensors(), ...this.otherDevicesForTestPage() })
      const { urls } = await this.webServer.start()
      this.log.info?.(`[Web] Camera test page is on port ${check.port}. Open one of these from a computer on the same network (the token changes at every restart, and anyone with the link can test your cameras and change night vision):`)
      for (const url of urls) this.log.info?.(`[Web]   ${url}`)
      webPageLink.write(this.api?.user?.storagePath?.() || '', { port: check.port, urls })
    } catch (e) {
      this.webServer = undefined
      this.log.warn?.(`[Web] The camera test page could not start: ${e.code === 'EADDRINUSE' ? `port ${raw} is already in use` : e.message}`)
    }
  }

  static register() {
    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, WyzeSmartHome)
  }

  getClient() {
    return new WyzeAPI({
      // User login parameters
      username: this.config.username,
      password: this.config.password,
      mfaCode: this.config.mfaCode,
      totpSecret: this.config.totpSecret,
      // Stray whitespace from copy/paste is never part of a developer key
      keyId: typeof this.config.keyId === 'string' ? this.config.keyId.trim() : this.config.keyId,
      apiKey: typeof this.config.apiKey === 'string' ? this.config.apiKey.trim() : this.config.apiKey,
      //Logging — the API uses its own @ptkdev/logger for colored
      // terminal output. logLevel filters that output; apiLogEnabled is
      // the legacy true/false toggle (true → debug, false → info).
      logLevel: this.config.logLevel,
      apiLogEnabled: this.config.apiLogEnabled,
      //App Config
      lowBatteryPercentage: this.config.lowBatteryPercentage,
      //Storage Path
      persistPath: homebridge.user.persistPath(),
      //URLs
      authBaseUrl: this.config.authBaseUrl,
      apiBaseUrl: this.config.apiBaseUrl,
      // App emulation constants
      authApiKey: this.config.authApiKey,
      phoneId: this.config.phoneId,
      appName: this.config.appName,
      appVer: this.config.appVer,
      appVersion: this.config.appVersion,
      userAgent: this.config.userAgent,
      sc: this.config.sc,
      sv: this.config.sv,
      // Crypto Secrets
      fordAppKey: this.config.fordAppKey, // Required for Locks
      fordAppSecret: this.config.fordAppSecret, // Required for Locks
      oliveSigningSecret: this.config.oliveSigningSecret, // Required for the thermostat
      oliveAppId: this.config.oliveAppId, //  Required for the thermostat
      appInfo: this.config.appInfo // Required for the thermostat
    }, this.log)
  }

  didFinishLaunching() {
    if (fs.existsSync(path.join(__dirname, '..', '.git'))) {
      const { version } = require('../package.json')
      this.log(`[Plugin] Local dev build v${version}`)
    }
    this.runLoop()
    this.runLockFastPollLoop()
    this.startCameraTestPage()
  }

  async runLoop() {
    const interval = this.config.refreshInterval || DEFAULT_REFRESH_INTERVAL
    while (!this._stopped) {
      try {
        await this.refreshDevices()
      } catch (e) {
        this.log.error(`[Plugin] Refresh failed: ${e}`)
      }

      await delay(interval)
    }
  }

  async runLockFastPollLoop() {
    const interval = this.config.securityRefreshInterval || DEFAULT_SECURITY_REFRESH_INTERVAL
    await delay(interval)
    while (!this._stopped) {
      try {
        await this.refreshLockDevices()
      } catch (e) { }
      await delay(interval)
    }
  }

  async refreshLockDevices() {
    if (this._stopped) return
    if (Date.now() - this._lastFullRefreshAt < FULL_REFRESH_SKIP_WINDOW_MS) return

    const targets = this.accessories.filter(a => FAST_POLL_CLASSES.has(a.constructor) && a.lastDevice)
    if (targets.length === 0) return

    let changedDevices = []
    for (const accessory of targets) {
      const mac = accessory.mac
      if (!this._fastPollStats.has(mac)) {
        this._fastPollStats.set(mac, { name: accessory.display_name, model: accessory.model_name, attempts: 0, successes: 0, since: new Date() })
      }
      const stats = this._fastPollStats.get(mac)
      stats.attempts++
      try {
        const changed = await accessory.updateCharacteristics(accessory.lastDevice)
        stats.successes++
        if (changed) changedDevices.push(`${accessory.display_name} [${accessory.model_name}]`)
      } catch (e) { }
    }

    if (changedDevices.length > 0) {
      if (this.config.pluginLoggingEnabled)
        this.log(`[LockFastPoll] State change detected for ${changedDevices.join(', ')}, triggering full refresh`)
      await this.refreshDevices()
    }
  }

  // One refresh at a time. The lock fast poll can call this while the main loop's refresh is still running (Wyze slow), and two
  // at once would double the requests and let one refresh's bulk property rows be taken by the other.
  refreshDevices() {
    if (this._stopped) return Promise.resolve()
    if (!this._refreshing) {
      this._refreshing = this._refreshDevicesOnce().finally(() => { this._refreshing = null })
    }
    return this._refreshing
  }

  async _refreshDevicesOnce() {
    let fastPollSummary = ''
    if (this._fastPollStats.size > 0) {
      const parts = []
      for (const [, stats] of this._fastPollStats) {
        parts.push(`${stats.name} [${stats.model}]: ${stats.successes}/${stats.attempts} fast polls`)
      }
      fastPollSummary = ` (${parts.join(', ')})`
    }
    this._fastPollStats = new Map()

    try {
      const objectList = await this.client.getObjectList()
      const timestamp = objectList.ts
      const devices = objectList?.data?.device_list

      if (!Array.isArray(devices)) {
        this.log.error(`Error getting devices: unexpected response from getObjectList (device_list missing)`)
        return
      }

      // An empty list while accessories exist is most likely a Wyze outage. Acting on it would
      // unregister every bridged accessory (and with it the user's HomeKit rooms and automations),
      // so it is ignored until it has been empty for several refreshes in a row.
      if (devices.length === 0 && this.accessories.length > 0) {
        this._emptyListCount = (this._emptyListCount || 0) + 1
        if (this._emptyListCount < EMPTY_LIST_REFRESHES) {
          this.log.warn(`Wyze returned no devices (${this._emptyListCount}/${EMPTY_LIST_REFRESHES}); keeping the ${this.accessories.length} known accessories`)
          return
        }
      } else {
        this._emptyListCount = 0
      }

      if (this.config.pluginLoggingEnabled) this.log(`Found ${devices.length} device(s)`)

      // Wyze Room Sensors (CO_TH1) aren't returned by the bulk getObjectList
      // — they hang off a thermostat as sub-devices. Discover them via
      // getThermostatSensors and synthesize device entries so they flow
      // through the same loadDevice / accessory-update path as everything
      // else. Opt-in via config so users without room sensors don't pay
      // for the extra API call per refresh.
      if (this.config.enableThermostatRoomSensors) {
        const roomSensors = await this.discoverRoomSensors(devices)
        for (const rs of roomSensors) devices.push(rs)
        // A thermostat whose lookup failed this time has no sensors in the list, which would read as "removed" and unregister
        // them (and their HomeKit rooms and automations). Keep them, as they were last seen, until a lookup succeeds.
        for (const accessory of this.accessories) {
          const parent = accessory.lastDevice?.parent_device_mac
          if (accessory instanceof WyzeRoomSensor && parent && this._roomSensorLookupFailed?.has(parent) && !devices.some((d) => d.mac === accessory.mac)) {
            devices.push(accessory.lastDevice)
          }
        }
      }

      // One request for the properties every camera that needs them will read below, instead
      // of one request per camera. Cameras fall back to their own read if this has nothing for them.
      if (!this._propertyPoller) this._propertyPoller = new PropertyPoller(this.client, { log: this.log })
      await this._propertyPoller.prefetch(this.accessories)

      await this.loadDevices(devices, timestamp)
      this._lastFullRefreshAt = Date.now()
      if (this.config.pluginLoggingEnabled) this.log(`Refreshed ${this.accessories.length}/${devices.length} devices${fastPollSummary}`)
    } catch (e) {
      this.log.error(`Error getting devices: ${e}`)
      throw e
    }
  }

  /**
   * For each thermostat in `devices`, fetch its paired Wyze Room Sensors
   * (CO_TH1) via the Earth `get_sub_device` endpoint and return them as
   * synthetic device entries that loadDevice can consume.
   *
   * One extra API call per thermostat per refresh cycle.
   *
   * The Earth endpoint shape isn't publicly documented and varies across
   * firmwares — this method logs aggressively (once per startup per
   * thermostat) so unexpected shapes are easy to diagnose from a user's
   * log dump.
   */
  async discoverRoomSensors(devices) {
    const thermostats = devices.filter(
      (d) => d.product_type === 'Thermostat' && Object.values(ThermostatModels).includes(d.product_model)
    )
    if (thermostats.length === 0) return []

    if (!this._roomSensorRawLogged) this._roomSensorRawLogged = new Set()
    this._roomSensorLookupFailed = new Set() // thermostats whose lookup failed in this pass
    const out = []

    for (const t of thermostats) {
      let response
      try {
        response = await this.client.getThermostatSensors(t.mac)
      } catch (err) {
        this.log.error(
          `[RoomSensor] discovery API call failed for thermostat ${t.nickname} (${t.mac}): ${err.message || err}`
        )
        if (err?.response?.data) {
          this.log.error(`[RoomSensor]   Earth response body: ${JSON.stringify(err.response.data)}`)
        }
        this._roomSensorLookupFailed.add(t.mac)
        continue
      }

      // Log the raw response once per thermostat per startup. This is the
      // single most useful artifact when the API shape doesn't match our
      // expectations — without it we're guessing.
      if (!this._roomSensorRawLogged.has(t.mac)) {
        this._roomSensorRawLogged.add(t.mac)
        this.log.info(
          `[RoomSensor] First discovery response for thermostat "${t.nickname}" (${t.mac}). ` +
          `Save this if you're debugging:\n${JSON.stringify(response, null, 2)}`
        )
      }

      // Accept any of the response shapes we've seen across firmwares.
      // If yours isn't here, the raw log above will tell us what to add.
      let list = null
      let shapeUsed = null
      if (Array.isArray(response?.data?.sensor_list))     { list = response.data.sensor_list;     shapeUsed = 'data.sensor_list' }
      else if (Array.isArray(response?.data?.sub_device_list)) { list = response.data.sub_device_list; shapeUsed = 'data.sub_device_list' }
      else if (Array.isArray(response?.data?.sub_devices))     { list = response.data.sub_devices;     shapeUsed = 'data.sub_devices' }
      else if (Array.isArray(response?.data?.sub_device))      { list = response.data.sub_device;      shapeUsed = 'data.sub_device' }
      else if (Array.isArray(response?.data))                  { list = response.data;                 shapeUsed = 'data (array)' }
      else if (Array.isArray(response))                        { list = response;                       shapeUsed = '(array)' }
      else                                                     { list = [];                             shapeUsed = 'unknown — see raw log above' }

      if (this.config.pluginLoggingEnabled) {
        this.log(
          `[RoomSensor] Thermostat "${t.nickname}": parsed ${list.length} sensor(s) from response shape "${shapeUsed}"`
        )
      }
      if (list.length === 0 && response && this.config.pluginLoggingEnabled) {
        // We got something back but couldn't find a list — most likely a
        // shape we haven't catalogued. Log enough to add a new branch.
        this.log.warn?.(
          `[RoomSensor] Empty parse for "${t.nickname}". Top-level response keys: ${Object.keys(response || {}).join(', ') || '(none)'}; ` +
          `data keys: ${response?.data && typeof response.data === 'object' ? Object.keys(response.data).join(', ') : '(none)'}`
        )
      }

      for (const s of list) {
        const mac = s.device_id || s.device_mac || s.mac
        if (!mac) {
          this.log.warn?.(
            `[RoomSensor] Skipping sensor under "${t.nickname}" with no MAC. Entry keys: ${Object.keys(s || {}).join(', ')}`
          )
          continue
        }

        // The per-sensor properties may be nested or inline. Try the most
        // specific containers first; fall through to the entry itself.
        const props = s.props || s.device_params || s.device_info || s
        const iotState = props.iot_state ?? s.iot_state
        const conn_state = iotState === 'connect' || iotState === 1 ? 1 : 0

        const synthesized = {
          mac,
          nickname: s.name || s.nickname || `Room Sensor ${String(mac).slice(-4)}`,
          product_type: 'ThermostatRoomSensor',
          product_model: ThermostatRoomSensor.CO_TH1,
          firmware_ver: s.firmware_ver || t.firmware_ver,
          conn_state,
          parent_device_mac: t.mac,
          device_params: {
            temperature: props.temperature,
            humidity: props.humidity,
            battery: props.battery,
            rssi: props.rssi,
            iot_state: iotState,
          },
        }

        // Warn loudly if any of the four headline fields is missing — that's
        // a sign the Wyze schema differs from what we're assuming and the
        // tile will show a stale or default value.
        const missing = []
        if (synthesized.device_params.temperature == null) missing.push('temperature')
        if (synthesized.device_params.humidity == null) missing.push('humidity')
        if (synthesized.device_params.battery == null) missing.push('battery')
        if (synthesized.device_params.iot_state == null) missing.push('iot_state')
        if (missing.length > 0 && this.config.pluginLoggingEnabled) {
          this.log.warn?.(
            `[RoomSensor] "${synthesized.nickname}" (${mac}) missing fields [${missing.join(', ')}]. ` +
            `Sensor entry keys: ${Object.keys(s || {}).join(', ')}; ` +
            `props keys: ${props && typeof props === 'object' ? Object.keys(props).join(', ') : '(none)'}`
          )
        }

        out.push(synthesized)
      }
    }

    if (this.config.pluginLoggingEnabled) {
      this.log(`[RoomSensor] Discovered ${out.length} room sensor(s) across ${thermostats.length} thermostat(s)`)
    }
    return out
  }

  async loadDevices(devices, timestamp) {
    const foundAccessories = []

    for (const device of devices) {
      const accessory = await this.loadDevice(device, timestamp)
      if (accessory) {
        foundAccessories.push(accessory)
      }
    }

    const removedAccessories = this.accessories.filter(a => !foundAccessories.includes(a))
    if (removedAccessories.length > 0) {
      // A camera that is filtered out or leaves the account must stop its live
      // streams and its doorbell poll, or both keep running unseen.
      for (const a of removedAccessories) {
        try { a.stopStreams?.() } catch (_) { /* best effort */ }
      }
      // External (camera) accessories aren't registered with the bridge, so
      // they can't be unregistered here. They have to be removed manually
      // from the Home app — same behavior as homebridge-camera-ffmpeg /
      // homebridge-unifi-protect.
      const bridged = removedAccessories.filter(a => !(a instanceof WyzeCamera))
      if (bridged.length > 0) {
        if (this.config.pluginLoggingEnabled) this.log(`Removing ${bridged.length} device(s)`)
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, bridged.map(a => a.homeKitAccessory))
      }
    }

    this.accessories = foundAccessories
  }

  // The "Exclude by Device Type" list holds category names. The robot vacuum's product type is its model code
  // ("JA_RO2"), not "Vacuum", so that category is matched on the model.
  isExcludedType(device) {
    const types = this.config.filterDeviceTypeList
    if (!Array.isArray(types) || !types.length) return false
    return types.includes(device.product_type) ||
      (types.includes('Vacuum') && Object.values(VacuumModels).includes(device.product_model))
  }

  async loadDevice(device, timestamp) {
    const safeName = sanitizeDeviceName(device.nickname)
    const accessoryClass = this.getAccessoryClass(device.product_type, device.product_model, device.mac, device.nickname)
    if (!accessoryClass) {
      if (this.config.pluginLoggingEnabled && !this._knownUnsupported.has(device.mac)) {
        this._knownUnsupported.add(device.mac)
        this.log(`[${device.product_type}] Unsupported device type: (Name: ${safeName}) (MAC: ${device.mac}) (Model: ${device.product_model})${plannedDevices.describe(device.product_model)}`)
      }
      return
    }
    else if (this.config.filterByMacAddressList?.find(d => d === device.mac) || this.isExcludedType(device)) {
      if (this.config.pluginLoggingEnabled) this.log(`[${device.product_type}] Ignoring (${safeName}) (MAC: ${device.mac}) because it is in the Ignore Device list`)
      return
    }
    else if (device.product_type == 'S1Gateway' && !(this.config.hmsEnabled ?? this.config.hms?.enabled)) {
      if (this.config.pluginLoggingEnabled) this.log(`[${device.product_type}] Ignoring (${safeName}) (MAC: ${device.mac}) because it is not enabled`)
      return
    }


    let accessory = this.accessories.find(a => a.matches(device))
    if (!accessory) {
      const isCamera = accessoryClass === WyzeCamera
      const homeKitAccessory = this.createHomeKitAccessory(
        device,
        isCamera
          ? (this.client.cameraIsDoorbell?.(device.product_model) ? Categories?.VIDEO_DOORBELL : Categories?.CAMERA)
          : undefined,
        isCamera
      )
      accessory = new accessoryClass(this, homeKitAccessory)
      if (isCamera) {
        // Cameras are published as external accessories so they pair
        // independently from the bridge — sidesteps the ~150-accessory
        // bridge cap and gives much more reliable streaming. Each camera
        // shows up in HomeKit as its own device with its own setup code.
        this.api.publishExternalAccessories(PLUGIN_NAME, [homeKitAccessory])
      }
      this.accessories.push(accessory)
    }
    accessory.update(device, timestamp).catch((err) => {
      this.log.error(`[${device.product_type}] Unhandled error updating ${safeName}: ${err.message}\n${err.stack}`)
    })

    return accessory
  }

  getAccessoryClass(type, model) {
    const matches = (map) => map != null && Object.values(map).includes(model)
    switch (type) {
      case 'OutdoorPlug':
        if (matches(OutdoorPlugModels)) return WyzePlug
        break
      case 'Plug':
        if (matches(PlugModels)) return WyzePlug
        break
      case 'Light':
        if (matches(LightModels)) return WyzeLight
        break
      case 'MeshLight':
        if (matches(MeshLightModels)) return WyzeMeshLight
        break
      case 'LightStrip':
        if (matches(LightStripModels)) return WyzeMeshLight
        break
      case 'ContactSensor':
        if (matches(ContactSensorModels)) return WyzeContactSensor
        break
      case 'MotionSensor':
        if (matches(MotionSensorModels)) return WyzeMotionSensor
        break
      case 'Lock':
        if (matches(LockModels)) return WyzeLock
        break
      case 'TemperatureHumidity':
        if (matches(TemperatureHumidityModels)) return WyzeTemperatureHumidity
        break
      case 'ThermostatRoomSensor':
        if (matches(ThermostatRoomSensor)) return WyzeRoomSensor
        break
      case 'LeakSensor':
        if (matches(LeakSensorModels)) return WyzeLeakSensor
        break
      case 'Camera':
        if (matches(CameraModels)) return WyzeCamera
        break
      case 'Common':
        if (matches(LockBoltV2Models)) return WyzeLockBoltV2
        if (matches(CommonModels)) return WyzeSwitch
        break
      case 'S1Gateway':
        if (matches(S1GatewayModels)) return WyzeHMS
        break
      case 'Thermostat':
        if (matches(ThermostatModels)) return WyzeThermostat
        break
      // Wyze reports the vacuum's product_type as the model code itself
      // ("JA_RO2"), not "Vacuum" like every other accessory class.
      case VacuumModels.JA_RO2:
        if (matches(VacuumModels)) return WyzeVacuum
        break
      case 'Irrigation':
        if (matches(IrrigationModels)) return WyzeIrrigation
        break
    }
  }

  createHomeKitAccessory(device, category, external = false) {
    const uuid = UUIDGen.generate(device.mac)
    // Bound length and strip control chars so a malformed Wyze nickname
    // can't break HomeKit pairing or surprise the user.
    const safeName = sanitizeDeviceName(device.nickname)

    const homeKitAccessory = new Accessory(safeName, uuid, category)

    homeKitAccessory.context = {
      mac: device.mac,
      product_type: device.product_type,
      product_model: device.product_model,
      nickname: safeName
    }

    // External accessories (cameras) are published by the caller via
    // publishExternalAccessories so they don't go through the bridge.
    if (!external) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [homeKitAccessory])
    }
    return homeKitAccessory
  }

  // Homebridge calls this method on boot to reinitialize previously-discovered devices
  configureAccessory(homeKitAccessory) {
    // Platform disabled by a fatal startup error: leave cached accessories
    // untouched (neither set up nor unregistered) so nothing is lost.
    if (this.disabled) return

    // Make sure we haven't set up this accessory already
    let accessory = this.accessories.find(a => a.homeKitAccessory === homeKitAccessory)
    if (accessory) {
      return
    }

    const accessoryClass = this.getAccessoryClass(homeKitAccessory.context.product_type, homeKitAccessory.context.product_model)
    if (accessoryClass === WyzeCamera) {
      // Cameras must be external accessories. If a camera shows up here it
      // was cached from an older plugin version that bridged it — drop the
      // bridged copy so loadDevice re-publishes it externally.
      try {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [homeKitAccessory])
        if (this.config.pluginLoggingEnabled) {
          this.log(`[Camera] Migrating ${homeKitAccessory.context.nickname} (${homeKitAccessory.context.mac}) from bridged to external — re-pair in Home app.`)
        }
      } catch (error) {
        // "Cannot find the bridged Accessory to remove" is benign on
        // subsequent restarts — the camera was already migrated to external
        // in a previous run.
        if (!String(error?.message || error).includes("Cannot find the bridged Accessory")) {
          this.log.error(`[Camera] Migration unregister failed for ${homeKitAccessory.context.nickname}: ${error}`)
        }
      }
      return
    }
    if (accessoryClass) {
      accessory = new accessoryClass(this, homeKitAccessory)
      this.accessories.push(accessory)
    } else {
      try {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [homeKitAccessory])
      } catch (error) {
        this.log.error(`Error removing accessory ${homeKitAccessory.context.nickname} (MAC: ${homeKitAccessory.context.mac}) : ${error}`)
      }
    }
  }
}
