# This plugin adds support for Wyze Smart Home devices to [Homebridge](https://github.com/homebridge/homebridge).
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![certified-hoobs-plugin](https://badgen.net/badge/HOOBS/certified/yellow)](https://plugins.hoobs.org/plugin/homebridge-wyze-smart-home)
[![npm](https://img.shields.io/npm/dt/homebridge-wyze-smart-home)](https://www.npmjs.com/package/homebridge-wyze-smart-home)
[![npm](https://img.shields.io/npm/v/homebridge-wyze-smart-home.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-wyze-smart-home)
[![GitHub last commit](https://img.shields.io/github/last-commit/identd113/homebridge-wyze-smart-home)](https://github.com/identd113/homebridge-wyze-smart-home)
[![Chat](https://img.shields.io/discord/1134601590762913863)](https://discord.gg/Mjkpq2x9)

[![homebridge-wyze-smart-home: Wyze Connected Home plugin for Homebridge](https://github.com/identd113/homebridge-wyze-smart-home/blob/main/logo.png?raw=true)](https://github.com/identd113/homebridge-wyze-smart-home)


## Support

If this plugin is useful to you, please look into supporting [Homebridge](https://github.com/sponsors/homebridge) first. None of this could happen without them.

Questions and bug reports: [open an issue](https://github.com/identd113/homebridge-wyze-smart-home/issues).

## Requirements
- Node.js 22 or newer (2.0.0-beta.3 and later). Homebridge 2.x already requires it; on Homebridge 1.x, update Node first.
- The plugin installs the matching `wyze-api` automatically and checks its version at startup. If the version is wrong, or no Wyze `username` is configured, the log shows a `[FATAL]` message and the plugin stays idle without removing your cached accessories.

## Supported Devices

**Status key:** ✅ tested on real hardware by the current maintainers · 🟢 supported, carried over from earlier releases · 🟡 registered but not yet verified on hardware (it should show up in HomeKit; please report what works).

**Library key:** every device is reached through [`wyze-api`](https://github.com/identd113/wyze-api) (this project's Wyze cloud client). *devicemgmt* marks the newer Wyze endpoint that `wyze-api` uses for Pan v4, Floodlight Pro, Battery Cam Pro and OG; it follows [SecKatie/wyzeapy](https://github.com/SecKatie/wyzeapy). *WebRTC* means live view and snapshots use Wyze's cloud signalling through [werift](https://github.com/shinyoshiaki/werift) and ffmpeg. Nothing is recorded or stored.

### Supported hardware

Open a group to see its models.

<details>
<summary><strong>Cameras</strong> (18)</summary>

| Camera | Model code | Library | Controls in HomeKit | Live view / snapshots | Status |
|---|---|---|---|---|---|
| Cam v1 | `WYZEC1` | wyze-api | Privacy, plus Siren / Floodlight / Garage switches per camera in config | WebRTC | 🟢 |
| Cam v2 | `WYZEC1-JZ` | wyze-api | Privacy, plus the same optional switches | WebRTC | 🟢 |
| Cam v3 (and Floodlight Cam) | `WYZE_CAKP2JFUS` | wyze-api | Privacy, plus the same optional switches | WebRTC, snapshots and audio (if the camera's microphone is on) | ✅ |
| Cam v3 Pro | `HL_CAM3P` | wyze-api | Privacy, plus the same optional switches | WebRTC | 🟢 |
| Cam v4 | `HL_CAM4` | wyze-api | Privacy, plus the same optional switches | WebRTC | 🟢 |
| Cam Pan | `WYZECP1_JEF` | wyze-api | Privacy, Siren | WebRTC | 🟢 |
| Cam Pan v2 | `HL_PAN2` | wyze-api | Privacy, Siren | WebRTC | 🟢 |
| Cam Pan v3 | `HL_PAN3` | wyze-api | Privacy, Siren | WebRTC | 🟢 |
| Cam Pan v4 | `HL_PAN4` | wyze-api *devicemgmt* | Privacy, Siren, Spotlight | WebRTC | 🟡 |
| Cam Pan Pro | `HL_PANP` | wyze-api | Appears as a camera | WebRTC | 🟡 |
| Bulb Cam | `HL_BC` | wyze-api | Light | WebRTC | 🟡 |
| Cam Outdoor | `WVOD1` | wyze-api | Privacy | WebRTC | 🟢 |
| Cam Outdoor v2 | `HL_WCO2` | wyze-api | Privacy | WebRTC | 🟢 |
| Cam Floodlight Pro | `LD_CFP` | wyze-api *devicemgmt* | Appears as a camera (Privacy; light and siren expected) | WebRTC | 🟡 |
| Cam Floodlight v2 | `HL_CFL2` | wyze-api | Appears as a camera | WebRTC | 🟡 |
| Battery Cam Pro | `AN_RSCW` | wyze-api *devicemgmt* | Appears as a camera (spotlight and siren expected) | WebRTC | 🟡 |
| Cam OG | `GW_GC1` | wyze-api *devicemgmt* | Appears as a camera | WebRTC | 🟡 |
| Cam OG Telephoto 3x | `GW_GC` | wyze-api | Appears as a camera | WebRTC | 🟡 |

Notes on cameras:
- Wyze cameras serve **one live viewer at a time**. The plugin closes each stream cleanly and shows the last snapshot while a stream is open.
- The Doorbell v2 press arrives from Wyze's cloud event list, so it can lag a few seconds. Turn on notifications for the doorbell in the Home app.
- Extra switches (`garage`, `spotlight`, `floodlight`, `siren`, `notifications`, `motionDetection`) are set per camera under `cameras` in the config.
- Cam Pan v4 and Bulb Cam come from [SecKatie/wyzeapy](https://github.com/SecKatie/wyzeapy) and have not been tried on hardware here yet.

</details>

<details>
<summary><strong>Doorbells</strong> (4)</summary>

| Camera | Model code | Library | Controls in HomeKit | Live view / snapshots | Status |
|---|---|---|---|---|---|
| Cam Doorbell v2 | `HL_DB2` | wyze-api | HomeKit doorbell: press notification. No Privacy switch (Wyze does not let it be powered off) | WebRTC at 640x480, with audio | ✅ |
| Video Doorbell | `WYZEDB3` | wyze-api | Appears as a camera only; no ring notification yet | WebRTC | 🟡 |
| Video Doorbell Pro | `GW_BE1` | wyze-api | Appears as a camera only; no ring notification yet | WebRTC | 🟡 |
| Video Doorbell Pro 2 | `AN_RDB1` | wyze-api | Appears as a camera only; no ring notification yet | WebRTC | 🟡 |

</details>

<details>
<summary><strong>Locks</strong> (3)</summary>

| Device | Model code | Library | Controls in HomeKit | Status |
|---|---|---|---|---|
| Lock | `YD.LO1` | wyze-api | Lock/unlock, door status, battery | 🟢 |
| Lock Bolt v2 | `DX_LB2` | wyze-api | Lock/unlock, door status, battery | 🟢 |
| Palm Lock | `DX_PVLOC` | wyze-api | Lock/unlock, door status, battery (status refreshed every 10 s) | ✅ |

</details>

<details>
<summary><strong>Lights and bulbs</strong> (3)</summary>

| Device | Model code | Library | Controls in HomeKit | Status |
|---|---|---|---|---|
| Light Bulb (White, White v2) | `WLPA19`, `HL_HWB2` | wyze-api | On/off, brightness, colour temperature | 🟢 |
| Mesh / Color Bulb (A19, BR30, A19 v2) | `WLPA19C`, `HL_BR30C`, `HL_A19C2` | wyze-api | On/off, brightness, colour, colour temperature | 🟢 |
| Light Strip, Light Strip Pro | `HL_LSL`, `HL_LSLP` | wyze-api | On/off, brightness, colour | 🟢 |

</details>

<details>
<summary><strong>Plugs and switches</strong> (3)</summary>

| Device | Model code | Library | Controls in HomeKit | Status |
|---|---|---|---|---|
| Plug | `WLPP1`, `WLPP1CFH` | wyze-api | On/off | 🟢 |
| Outdoor Plug | `WLPPO-SUB` | wyze-api | On/off | 🟢 |
| Wall Switch | `LD_SS1` | wyze-api | On/off | 🟢 |

</details>

<details>
<summary><strong>Sensors</strong> (4)</summary>

| Device | Model code | Library | Controls in HomeKit | Status |
|---|---|---|---|---|
| Contact Sensor v1, v2 | `DWS2U`, `DWS3U` | wyze-api | Open/closed, battery | 🟢 |
| Motion Sensor v1, v2 | `PIR2U`, `PIR3U` | wyze-api | Motion, battery | 🟢 |
| Temperature & Humidity Sensor | `TH3U` | wyze-api | Temperature, humidity, battery | 🟢 |
| Leak Sensor | `WS3U` | wyze-api | Leak, battery | 🟢 |

</details>

<details>
<summary><strong>Climate and security</strong> (3)</summary>

| Device | Model code | Library | Controls in HomeKit | Status |
|---|---|---|---|---|
| Home Monitoring System | `GW3U` | wyze-api | Arm/disarm | 🟢 |
| Thermostat | `CO_EA1` | wyze-api | Mode, target / heat / cool temperatures, current temperature and humidity | 🟢 |
| Thermostat Room Sensor | `CO_TH1` | wyze-api | Temperature, humidity, battery | 🟢 |

</details>

<details>
<summary><strong>Vacuum and sprinklers</strong> (2)</summary>

| Device | Model code | Library | Controls in HomeKit | Status |
|---|---|---|---|---|
| Robot Vacuum | `JA_RO2` | wyze-api | Start/stop, fan speed, battery and charging state, fault codes, per-room switches | 🟢 |
| Sprinkler Controller | `BS_WK1` | wyze-api | Zone valves: start/stop, duration, remaining time | 🟢 |

</details>

## Not Yet Supported

"Likely library" names a project that already handles the device, so we can port from it. **Easy** means working code exists in a library we already follow; **Hard** means the device needs a different protocol or no library covers it; **Unknown** means we found no reference implementation.

<details>
<summary><strong>Devices we do not support yet</strong> (6)</summary>

| Device | Model code | Why it isn't supported | Likely library | Effort |
|---|---|---|---|---|
| Chime / Chime Sensor | — | No accessory class | [wyzeapy](https://github.com/SecKatie/wyzeapy) (`CHIME_SENSOR`) | Easy |
| Keypad | — | No accessory class | wyzeapy (`KEYPAD`); [wyze-sdk](https://github.com/shauntarves/wyze-sdk) (Lock Keypad) | Easy |
| Lamp Socket / Lamp Socket v2 | — | No model code yet | wyzeapy (shares the camera light controls) | Easy |
| Lock Bolt (original, Bluetooth only) | — | Bluetooth only, no cloud control | none | Hard |
| Window Cam, Battery Video Doorbell, Duo Cam Doorbell | — | No model codes yet | none found | Unknown |
| Night Light, Surge Protector | — | No model codes yet | none found | Unknown |

</details>

Not applicable to HomeKit, or not planned: Cordless Vacuum, Scales, Watch, Headphones, Air Purifier. [wyzeapy](https://github.com/SecKatie/wyzeapy) and [wyze-sdk](https://github.com/shauntarves/wyze-sdk) cover some of these if you want to build on them.

Related projects we compare against: [SecKatie/wyzeapy](https://github.com/SecKatie/wyzeapy) (Home Assistant; the source of the devicemgmt calls), [mrlt8/docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge) (camera streaming over TUTK/RTSP), [shauntarves/wyze-sdk](https://github.com/shauntarves/wyze-sdk) (Python SDK).

For more information about our version updates, please check our [change log](CHANGELOG.md).

## Configuration

Use the settings UI in Homebridge Config UI X to configure your Wyze account, or add the following to the platforms section of your config file:

```js
{
  "platforms": [
    {
      "platform": "WyzeSmartHome",
      "name": "Wyze",
      "auth": {
        "username": "YOUR_EMAIL",
        "password": "YOUR_PASSWORD",
        "keyId": "YOUR_KEY_ID",
        "apiKey": "YOUR_API_KEY",
        "totpSecret": ""
      },
      "polling": {
        "refreshInterval": 30000,
        "lowBatteryPercentage": 30
      },
      "cameras": [
        {
          "mac": "MAC_ADDRESS_1",
          "name": "Garage cam",
          "garage": true,
          "siren": true
        }
      ],
      "hms": { "enabled": false },
      "excludes": { "macs": ["MAC_ADDRESS_2"], "types": ["Plug"] },
      "logging": { "level": "info" }
    }
  ]
}
```

Supported devices will be discovered and added to Homebridge automatically. Each entry under `cameras` can add extra switches to that camera: `garage`, `spotlight`, `floodlight`, `siren`, `notifications` and `motionDetection`. Cameras not listed there get only the camera and its Privacy switch (the Doorbell v2 has no Privacy switch).

The older flat format (`username`, `password`, `keyId`, `apiKey`, `filterByMacAddressList`, `garageDoorAccessory`, ...) is still accepted. On first start Homebridge converts it to the format above and keeps a copy of your old file next to it as `config.json.pre-2.0.bak`. Instead of putting credentials in `config.json` you can point `auth.secretsFile` at a private JSON file or use the `WYZE_*` environment variables.

### Required Fields

* **`username`** &ndash; App email address
* **`password`** &ndash; App password
* **`apiKey`** &ndash; Navigate to [this portal](https://developer-api-console.wyze.com/)
* **`keyId`** &ndash; Navigate to [this portal](https://developer-api-console.wyze.com/), and click Login to sign in to your Wyze account.
Note: Ensure that the login info you are using matches the info you use when logLevel into the Wyze app.
Once you’ve signed in, you’ll be automatically redirected back to the developer page.
Click Create an API key for your API key to be created.
Once created, you can click view to see the entire key.
You should receive an email that a new API key has been generated.
Once you have the API key, you can use it in your script to get the access token and refresh token.

### Optional Fields

These use the flat option names; in the nested format above they live under `auth`, `polling`, `hms`, `logging` and so on (the settings UI shows where).

* **`totpSecret`** &ndash; Recommended if your Wyze account uses an authenticator app for 2-factor authentication. Enter the base32 key Wyze shows next to the QR code when you set up 2FA ("can't scan? enter this key"). The plugin generates a fresh code on every login, so it keeps working when Wyze forces a re-login. Treat it like your password. Takes precedence over `mfaCode`. Authenticator apps only, not SMS.
* **`mfaCode`** &ndash; Only required if your Wyze account has 2-factor authentication enabled (authenticator-app/TOTP only). Enter the current code from your authenticator app. This code rotates every 30 seconds, so it must be current at the moment Homebridge logs in - if login fails because the code expired, update this value and restart Homebridge.
* **`hms`** &ndash; Set to `true` to enable the Home Monitoring System (HMS) gateway accessory. Defaults to `false`.
* **`refreshInterval`** &ndash; Defines how often the status of the devices will be polled in milliseconds (e.g., `"refreshInterval": 60000` will check the status of your devices' status every 60 seconds). Defaults to 60 seconds.
* **`phoneId`** &ndash; The phone id used by the Wyze App. This value is just found by intercepting your phone's traffic. If no `phoneId` is specified, a default value will be used.
* **`logLevel`** &ndash; If no `logLevel` is specified, a default value will be used.
* **`apiLogEnabled`** &ndash; If no `apiLogEnabled` is specified, a default value will be used.
* **`authApiKey`** &ndash; If no `authApiKey` is specified, a default value will be used.
* **`appName`** &ndash; If no `appName` is specified, a default value will be used.
* **`appVer`** &ndash; If no `appVer` is specified, a default value will be used.
* **`appVersion`** &ndash; If no `appVersion` is specified, a default value will be used.
* **`userAgent`** &ndash; If no `userAgent` is specified, a default value will be used.
* **`sc`** &ndash; If no `sc` is specified, a default value will be used.
* **`sv`** &ndash; If no `sv` is specified, a default value will be used.
* **`persistPath`** &ndash; If no `persistPath` is specified, a default value will be used.
* **`refreshTokenTimerEnabled`** &ndash; If no `refreshTokenTimerEnabled` is specified, a default value will be used.
* **`lowBatteryPercentage`** &ndash; Defines when to show devices with low battery (e.g., `"lowBatteryPercentage": 30`). Defaults to 30%.
* **`securityRefreshInterval`** &ndash; How often (in milliseconds) to fast-poll lock devices (Wyze Lock, Lock Bolt v2, Palm Lock) for state changes independently of the main refresh cycle (e.g., `"securityRefreshInterval": 10000`). Defaults to 10 seconds.
* **`pluginLoggingEnabled`** &ndash; Enables additional plugin-level debug logging, including lock fast-poll summaries. Defaults to false.

## Cameras and doorbells

- **Pairing.** Cameras are separate HomeKit accessories, not part of the bridge. When a camera is discovered, Homebridge's log prints its own setup code ("Please add [Camera name] manually in the Home app"); add each one in the Home app with that code. A camera that is newly recognised after an update (Cam Pan v4, Bulb Cam, Floodlight v2, Doorbell v2) shows up the same way and needs pairing once. Nothing already paired changes.
- **Live view, snapshots and audio** come from Wyze over WebRTC. A Wyze camera serves **one viewer at a time**, so opening the same camera in the Wyze app, or in a second Home app view, may interrupt the stream. While a live view is open, the tile keeps showing the last snapshot. Audio only arrives if the camera's microphone is switched on in the Wyze app.
- **Doorbell v2** is a HomeKit doorbell: a press rings the Home app (turn on notifications for it in the Home app). The plugin looks for presses in Wyze's cloud event list every 5 seconds, so the ring can arrive a few seconds late. Its picture is 640x480 (4:3) at 15 frames per second. Wyze doesn't let the doorbell be powered off through its API, so it has no Privacy switch.
- **Wyze plan limit.** Motion and doorbell events come from Wyze's cloud event list, which depends on your plan: cameras without a Wyze plan record at most one motion event about every 5 minutes (and no person/vehicle tags), and a doorbell without a plan may also miss a press that lands inside that cooldown. Live view and snapshots are not affected.

## Upgrading

- **From 2.0.0-beta.2:** nothing in your config needs to change. Update Node.js to 22 or newer first. Newly recognised cameras need pairing (see above).
- **From 0.5.x or 1.x:** your flat config is converted on first start (see Configuration). Update Node.js to 22 or newer first.
- If the installed `wyze-api` is older than this plugin needs, the log shows one `[FATAL]` line and the plugin stays inactive without removing your paired accessories.

## History

### The story

The plugin began in May 2020 as [homebridge-wyze-connected-home](https://github.com/misenhower/homebridge-wyze-connected-home), written by [misenhower](https://github.com/misenhower). Its README listed four devices (Light Bulb, Plug, Contact Sensor, Motion Sensor), and it already supported two-factor logins through an `mfaCode` setting. Seven npm releases (`0.1.0` to `0.5.1`) went out in five weeks, and the last commit to the repository is `v0.5.1` on 2020-06-14 (`015806c`). Issues kept arriving there until at least November 2024.

In May 2022 [jfarmer08](https://github.com/jfarmer08) started this repository as `homebridge-wyze-smart-home` and carried on the `0.5.x` numbering (first npm release `0.5.10`, 2022-05-18). It is not a GitHub fork, and its first commit (`4a7bb75`, "First Check In") arrived with 21 files, including accessories for lights, locks, sensors and a camera, so what came before it isn't in this repository's history. Over the next year the plugin grew a device at a time: camera on/off in June 2022, more camera models in July, the Home Monitoring System and a thermostat (contributed by Carson Loyal) in December, and siren, floodlight and garage-door controls for cameras in October 2023. The Wyze cloud client was published separately as [wyze-api](https://github.com/identd113/wyze-api) in September 2023.

In 2026 the project moved quickly. Lock Bolt v2 and the Palm Lock arrived in April through Wyze's newer IoT3 API (contributed by identd113), followed the same month by robot-vacuum and sprinkler accessories and a motion sensor on cameras. `2.0.0-beta.1` was published on 2026-04-28 and `2.0.0-beta.2` on 2026-08-29.

In October 2026 jfarmer08 said in [issue #315](https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/315) that they could no longer maintain the project, and identd113 offered to take it over.

### Timeline

Each row can be checked against the repository (commit) or the npm registry (release).

| Date | Event | Evidence |
|---|---|---|
| 2020-05-07 | Original plugin created; four devices | misenhower repo, npm `0.1.0` |
| 2020-06-14 | Last release and last commit of the original, `v0.5.1` | `015806c`, npm `0.5.1` |
| 2022-05-17 | This repository's first commit: lights, plugs, sensors, lock, camera accessory | `4a7bb75` |
| 2022-05-18 | Thermostat Room Sensor and Temperature/Humidity accessories; first npm release `0.5.10` | `48ebe9d`, npm |
| 2022-06-21 | Camera (on/off) listed | `9d59a45` |
| 2022-07-07 | Camera v2, v3, Outdoor and Pan listed | `2e8ff12` |
| 2022-12-08 | Home Monitoring System accessory | `c9447cf` |
| 2022-12-15 | Thermostat accessory (Carson Loyal) | `c845eff` |
| 2023-09-06 | `wyze-api` first published to npm | npm |
| 2023-10-23 | Camera siren, floodlight and garage-door controls listed | `a43c9a1` |
| 2026-04-08 | Lock Bolt v2 and Palm Lock (identd113) | `657d5d7` |
| 2026-04-26 | Vacuum and sprinkler accessories | `8c97a3c` |
| 2026-04-28 | `2.0.0-beta.1` | npm |
| 2026-07-21 | `0.5.61`, the last `0.5.x` release | npm |
| 2026-08-06 | README lists the newer bulb, strip, camera and Pan variants | `a270466` |
| 2026-08-29 | `2.0.0-beta.2` | npm |

Dates for a README entry show when a device was documented, which can be later than when it first worked.

## Other Info

Special thanks to the following projects for reference and inspiration:

- [ha-wyzeapi](https://github.com/JoshuaMulliken/ha-wyzeapi), a Wyze integration for Home Assistant.
- [wyze-node](https://github.com/noelportugal/wyze-node), a Node library for the Wyze API.

Thanks to [misenhower](https://github.com/misenhower/homebridge-wyze-connected-home) for the original Wyze Homebridge plugin, and thanks to all [contributors](CONTRIBUTORS.md) who have volunteered their time to help fix bugs and add support for more devices and features.

This plugin is an actively maintained fork of misenhower's original [Wyze Homebridge Plugin](https://github.com/misenhower/homebridge-wyze-connected-home) project.
