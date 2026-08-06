# This plugin adds support for Wyze Smart Home devices to [Homebridge](https://github.com/homebridge/homebridge).
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![certified-hoobs-plugin](https://badgen.net/badge/HOOBS/certified/yellow)](https://plugins.hoobs.org/plugin/homebridge-wyze-smart-home)
[![npm](https://img.shields.io/npm/dt/homebridge-wyze-smart-home)](https://www.npmjs.com/package/homebridge-wyze-smart-home)
[![npm](https://img.shields.io/npm/v/homebridge-wyze-smart-home.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-wyze-smart-home)
[![GitHub last commit](https://img.shields.io/github/last-commit/jfarmer08/homebridge-wyze-smart-home)](https://github.com/jfarmer08/homebridge-wyze-smart-home)
[![Chat](https://img.shields.io/discord/1134601590762913863)](https://discord.gg/Mjkpq2x9)

[![homebridge-wyze-smart-home: Wyze Connected Home plugin for Homebridge](https://github.com/jfarmer08/homebridge-wyze-smart-home/blob/main/logo.png?raw=true)](https://github.com/jfarmer08/homebridge-wyze-smart-home)

[Major Feature Backlog/Status](https://github.com/jfarmer08/homebridge-wyze-smart-home/discussions/224)

> **This is the `2.0.0-beta` branch.** It's a large release from the stable `latest` npm tag — real HomeKit camera streaming, several new device types, a restructured config, and security hardening. See [What's new in 2.0](#whats-new-in-20) below, or the full [change log](CHANGELOG.md).

# Funding   [![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square&maxAge=2592000)](https://www.paypal.com/paypalme/AllenFarmer) [![Donate](https://img.shields.io/badge/Donate-Venmo-blue.svg?style=flat-square&maxAge=2592000)](https://venmo.com/u/Allen-Farmer) [![Donate](https://img.shields.io/badge/Donate-Cash_App-blue.svg?style=flat-square&maxAge=2592000)](https://cash.app/$Jfamer08)
If you like what I have done here and want to help I would recommend that you firstly look into supporting Homebridge. None of this could happen without them.

After you have done that if you feel like my work has been valuable to you I welcome your support through Paypal, Venmo or Cash App.

## What's new in 2.0

- **Live HomeKit camera streaming.** Cameras publish as proper camera tiles with live video + audio (Opus) and snapshots — not just on/off switches. Cameras now pair as **external accessories**, independent of the bridge — if you're upgrading from an earlier version, you'll need to re-pair each camera in the Home app once.
- **New device types**: Robot Vacuum, Sprinkler/Irrigation Controller, and Wyze Thermostat Room Sensors.
- **Restructured, nested config** (`auth` / `polling` / `cameras` / `thermostat` / `vacuum` / `hms` / `excludes` / `logging` / `advanced`), auto-migrated from an old flat 1.x config on first launch — a backup is saved to `config.json.pre-2.0.bak`.
- **Security hardening**: credential/token log redaction by default, an optional mode-600 secrets file (`auth.secretsFile`), and base-URL hostname allowlisting.
- **Friendlier offline handling**: accessories show a small "inactive"/warning-triangle indicator instead of the full HomeKit "No Response" banner, and last-known state persists to disk across restarts.
- **`deviceTypeOverrides`**: route a Wyze model code the plugin doesn't recognize yet to an existing accessory class for testing, without waiting for a release.

## Supported Devices

- **Cameras** (live view, audio, snapshots) — V1, V2, V3, V3 Pro, V4, Pan, Pan v2, Pan v3, Pan Pro, Outdoor, Outdoor 2, Floodlight, Floodlight Pro, Battery Cam Pro, OG, OG Telephoto 3x, Doorbell, Doorbell Pro, Doorbell Pro 2
  - Optional per-camera capability switches: Garage Door, Spotlight, Floodlight, Siren, Notifications, Motion Detection (each configured per-MAC — see [Configuration](#configuration))
- **Locks** — Wyze Lock (YD.LO1), Lock Bolt V2, Palm Lock — battery, door-contact, and lock/unlock control
- **Robot Vacuum** — start/stop, suction level, battery; optional per-room sweep switches
- **Sprinkler / Irrigation Controller** — one HomeKit valve per zone
- **Thermostat** — including heat-only/cool-only mode restriction and optional Room Sensor discovery
- **Home Monitoring System (HMS)** — security panel arm/disarm
- **Wall Switch**
- Light Bulb (White, White V2)
- Light Strips (Light Strip, Light Strip Pro)
- Color Bulb / Mesh Light (A19, BR30, A19 v2)
- Plug, Outdoor Plug
- Contact Sensor (V1, V2), Motion Sensor (V1, V2) — status & battery
- Temperature & Humidity Sensor, Leak Sensor — status & battery

## Not Yet Supported

The following have no model code registered in the plugin yet — if you have one, check the Homebridge log for a line like `[Camera] Unsupported device type: (Name: ...) (Model: XXXXX)` and you can route it to an existing accessory class immediately via `advanced.deviceTypeOverrides`, without waiting for a release:

- Cam Pan v4, Window Cam, Battery Video Doorbell, Duo Cam Doorbell
- Lamp Socket / Lamp Socket v2, Night Light, Surge Protector
- Chime Sensor, Keypad
- Original Wyze Lock Bolt (BLE-only, pre-WiFi version)

The following are not applicable to HomeKit: Scales, Watch, Headphones, Air Purifier.

For more information about our version updates, please check our [change log](CHANGELOG.md).

## Configuration

Use the settings UI in Homebridge Config UI X to configure your Wyze account, or manually add the following to the `platforms` section of your config file:

```json
{
  "platforms": [
    {
      "name": "Wyze",
      "platform": "WyzeSmartHome",
      "auth": {
        "username": "you@example.com",
        "password": "your-wyze-password",
        "keyId": "your-key-id",
        "apiKey": "your-api-key"
      },
      "polling": {
        "refreshInterval": 30000,
        "lowBatteryPercentage": 30
      },
      "cameras": [
        {
          "mac": "AA:BB:CC:DD:EE:FF",
          "name": "Front Garage",
          "garage": true,
          "spotlight": false,
          "floodlight": false,
          "siren": false,
          "notifications": true,
          "motionDetection": false
        }
      ],
      "thermostat": {
        "exposeRoomSensors": false,
        "mode": "auto"
      },
      "vacuum": {
        "perRoomSwitches": false
      },
      "hms": {
        "enabled": false
      },
      "excludes": {
        "macs": [],
        "types": []
      },
      "logging": {
        "level": "info",
        "disableRedaction": false
      },
      "advanced": {
        "deviceTypeOverrides": {}
      }
    }
  ]
}
```

Supported devices will be discovered and added to Homebridge automatically. If you're upgrading from a 1.x flat config, it's migrated to this nested shape automatically on first launch.

### Required Fields

* **`auth.username`** &ndash; Wyze app email address
* **`auth.password`** &ndash; Wyze app password
* **`auth.apiKey`** / **`auth.keyId`** &ndash; Navigate to [this portal](https://developer-api-console.wyze.com/) and log in with the same account you use in the Wyze app. Click "Create an API key" — you'll receive an email once it's generated. Use the generated Key ID and API Key here.

As an alternative to putting credentials directly in `config.json`, set **`auth.secretsFile`** to the path of a JSON file (must be mode `600`) containing `{ "username", "password", "keyId", "apiKey" }`.

### Optional Fields

* **`polling.refreshInterval`** &ndash; How often (ms) to poll device status. Defaults to 30 seconds.
* **`polling.lowBatteryPercentage`** &ndash; Battery percentage at which a device is flagged low. Defaults to 30%.
* **`cameras[].garage` / `.spotlight` / `.floodlight` / `.siren` / `.notifications` / `.motionDetection`** &ndash; per-camera capability switches, keyed by MAC. Omit a camera entirely to just get the live-view tile with no extra switches.
* **`thermostat.exposeRoomSensors`** &ndash; Discover Wyze Thermostat Room Sensors (CO_TH1) as separate temperature/humidity accessories. One extra API call per thermostat per refresh cycle. Defaults to `false`.
* **`thermostat.mode`** &ndash; `"auto"` (default), `"heat-only"`, or `"cool-only"` — restricts which modes HomeKit shows, for systems that physically only support one side (e.g. a gas furnace with no AC).
* **`vacuum.perRoomSwitches`** &ndash; Add one HomeKit switch per room from the vacuum's current map ("Hey Siri, vacuum kitchen"). Off by default since a multi-room map can add many extra tiles.
* **`hms.enabled`** &ndash; Expose the Home Monitoring System security-panel accessory. Defaults to `false`.
* **`excludes.macs`** / **`excludes.types`** &ndash; Arrays of MAC addresses or device-type strings (e.g. `"OutdoorPlug"`, `"Plug"`) to skip entirely.
* **`logging.level`** &ndash; `"error"` / `"warn"` / `"info"` / `"debug"`. Defaults to `"info"`.
* **`logging.disableRedaction`** &ndash; Bypass automatic redaction of tokens/credentials/GPS/emails/MACs in log output — only for your own debugging; never share logs captured this way.
* **`advanced.deviceTypeOverrides`** &ndash; Route an unrecognized Wyze model code to an existing accessory class, e.g. `{ "CameraModels": ["NEW_MODEL_CODE"] }`. Lets you test a brand-new device before official support lands.
* **`advanced.dangerouslyAllowCustomBaseUrls`**, **`advanced.authBaseUrl`**, **`advanced.apiBaseUrl`** &ndash; Override the Wyze API hosts the plugin talks to. Off by default; only allowlisted Wyze hostnames are ever accepted even when enabled.
* **`securityRefreshInterval`** &ndash; A legacy top-level field (not yet promoted into `polling`) controlling how often, in milliseconds, lock devices (Wyze Lock, Lock Bolt V2, Palm Lock) are fast-polled independently of the main refresh cycle. Defaults to 10 seconds.

## Other Info

Special thanks to the following projects for reference and inspiration:

- [ha-wyzeapi](https://github.com/JoshuaMulliken/ha-wyzeapi), a Wyze integration for Home Assistant.
- [wyze-node](https://github.com/noelportugal/wyze-node), a Node library for the Wyze API.

Thanks to [misenhower](https://github.com/misenhower/homebridge-wyze-connected-home) for the original Wyze Homebridge plugin, and thanks to all [contributors](CONTRIBUTORS.md) who have volunteered their time to help fix bugs and add support for more devices and features.

This plugin is an actively maintained fork of misenhower's original [Wyze Homebridge Plugin](https://github.com/misenhower/homebridge-wyze-connected-home) project.
