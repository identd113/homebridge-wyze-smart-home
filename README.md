# This plugin adds support for Wyze Smart Home devices to [Homebridge](https://github.com/homebridge/homebridge).
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![certified-hoobs-plugin](https://badgen.net/badge/HOOBS/certified/yellow)](https://plugins.hoobs.org/plugin/homebridge-wyze-smart-home)
[![npm](https://img.shields.io/npm/dt/homebridge-wyze-smart-home)](https://www.npmjs.com/package/homebridge-wyze-smart-home)
[![npm](https://img.shields.io/npm/v/homebridge-wyze-smart-home.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-wyze-smart-home)
[![GitHub last commit](https://img.shields.io/github/last-commit/identd113/homebridge-wyze-smart-home)](https://github.com/identd113/homebridge-wyze-smart-home)
[![Chat](https://img.shields.io/discord/1134601590762913863)](https://discord.gg/Mjkpq2x9)

[![homebridge-wyze-smart-home: Wyze Connected Home plugin for Homebridge](https://github.com/identd113/homebridge-wyze-smart-home/blob/main/logo.png?raw=true)](https://github.com/identd113/homebridge-wyze-smart-home)

**[Project history](#history)** and **[timeline](#timeline)**: from misenhower's 2020 plugin to the current release.

> **Coming soon:** gun safe support.

## Support

If this plugin is useful to you, please look into supporting [Homebridge](https://github.com/sponsors/homebridge) first. None of this could happen without them.

Questions and bug reports: [open an issue](https://github.com/identd113/homebridge-wyze-smart-home/issues).

## Thanks

This plugin stands on other people's work:

- [misenhower](https://github.com/misenhower) wrote the original [homebridge-wyze-connected-home](https://github.com/misenhower/homebridge-wyze-connected-home) plugin in 2020, where all of this started.
- [jfarmer08](https://github.com/jfarmer08) built this plugin and its [wyze-api](https://github.com/identd113/wyze-api) library from 2022 and maintained them for years.
- [SecKatie](https://github.com/SecKatie) maintains [wyzeapy](https://github.com/SecKatie/wyzeapy), the source of the newer camera calls (Pan v4, Floodlight Pro, Battery Cam Pro, OG).
- [mrlt8](https://github.com/mrlt8) maintains [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge), whose camera model research we compare against.
- [shauntarves](https://github.com/shauntarves) wrote [wyze-sdk](https://github.com/shauntarves/wyze-sdk), a Python SDK we used for reference.
- [JoshuaMulliken](https://github.com/JoshuaMulliken/ha-wyzeapi) and [noelportugal](https://github.com/noelportugal/wyze-node) for the Home Assistant integration and the Node library that inspired early work.
- Everyone in [CONTRIBUTORS.md](CONTRIBUTORS.md) who fixed bugs and added devices.

**Looking for Home Assistant?** Please check out SecKatie's [ha-wyzeapi](https://github.com/SecKatie/ha-wyzeapi) integration.

### People who confirmed devices

Thank you to everyone who tested a device and told us it works. Each name was added when a maintainer checked their report. If you would rather not be listed, say so on your report and we will take you off.

<!-- confirmed-by -->
<!-- /confirmed-by -->

## Requirements
- Node.js 22 or newer (2.0.0-beta.3 and later). Homebridge 2.x already requires it; on Homebridge 1.x, update Node first.
- The plugin installs the matching `wyze-api` automatically and checks its version at startup. If the version is wrong, or no Wyze `username` is configured, the log shows a `[FATAL]` message and the plugin stays idle without removing your cached accessories.

## Supported Devices

**Status key:** ✅ tested on real hardware by the current maintainers · 🟢 supported, carried over from earlier releases · 🟡 registered but not yet verified on hardware (it should show up in HomeKit; please report what works) · 🔵 confirmed working by a user report that a maintainer checked (on a row with several model codes, the 🔵 sits next to the code). From least to most verified: 🟡 registered only, 🟢 supported, 🔵 confirmed by a user, ✅ confirmed by a maintainer.

### Supported hardware

Open a group to see its models. Each **report** link opens the device report form with that device already picked, for telling us whether it works.

<details>
<summary><strong>Cameras</strong> (18)</summary>

| Camera | Model code | Controls in HomeKit | Live view / snapshots | Status |
|---|---|---|---|---|
| Cam v1 | `WYZEC1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20v1%20%28WYZEC1%29&origin=readme) | Privacy, plus Siren / Floodlight / Garage switches per camera in config | WebRTC | 🟢 |
| Cam v2 | `WYZEC1-JZ` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20v2%20%28WYZEC1-JZ%29&origin=readme) | Privacy, plus the same optional switches | WebRTC | 🟢 |
| Cam v3 (and Floodlight Cam) | `WYZE_CAKP2JFUS` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20v3%20%2F%20Floodlight%20Cam%20%28WYZE_CAKP2JFUS%29&origin=readme) | Privacy, plus the same optional switches | WebRTC, snapshots and audio (if the camera's microphone is on) | ✅ |
| Cam v3 Pro | `HL_CAM3P` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20v3%20Pro%20%28HL_CAM3P%29&origin=readme) | Privacy, plus the same optional switches | WebRTC | 🟢 |
| Cam v4 | `HL_CAM4` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20v4%20%28HL_CAM4%29&origin=readme) | Privacy, plus the same optional switches | WebRTC | 🟢 |
| Cam Pan | `WYZECP1_JEF` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20Pan%20%28WYZECP1_JEF%29&origin=readme) | Privacy, Siren | WebRTC | 🟢 |
| Cam Pan v2 | `HL_PAN2` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20Pan%20v2%20%28HL_PAN2%29&origin=readme) | Privacy, Siren | WebRTC | 🟢 |
| Cam Pan v3 | `HL_PAN3` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20Pan%20v3%20%28HL_PAN3%29&origin=readme) | Privacy, Siren | WebRTC | 🟢 |
| Cam Pan v4 | `HL_PAN4` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20Pan%20v4%20%28HL_PAN4%29&origin=readme) | Privacy, Siren, Spotlight | WebRTC | 🟡 |
| Cam Pan Pro | `HL_PANP` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20Pan%20Pro%20%28HL_PANP%29&origin=readme) | Appears as a camera | WebRTC | 🟡 |
| Bulb Cam | `HL_BC` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Bulb%20Cam%20%28HL_BC%29&origin=readme) | Light | WebRTC | 🟡 |
| Cam Outdoor | `WVOD1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Battery%20cameras%20-%20Cam%20Outdoor%20%28WVOD1%29&origin=readme) | Privacy | WebRTC | 🟢 |
| Cam Outdoor v2 | `HL_WCO2` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Battery%20cameras%20-%20Cam%20Outdoor%20v2%20%28HL_WCO2%29&origin=readme) | Privacy | WebRTC | 🟢 |
| Cam Floodlight Pro | `LD_CFP` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20Floodlight%20Pro%20%28LD_CFP%29&origin=readme) | Appears as a camera (Privacy; light and siren expected) | WebRTC | 🟡 |
| Cam Floodlight v2 | `HL_CFL2` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20Floodlight%20v2%20%28HL_CFL2%29&origin=readme) | Appears as a camera | WebRTC | 🟡 |
| Battery Cam Pro | `AN_RSCW` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Battery%20cameras%20-%20Battery%20Cam%20Pro%20%28AN_RSCW%29&origin=readme) | Appears as a camera (spotlight and siren expected) | WebRTC | 🟡 |
| Cam OG | `GW_GC1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20OG%20%28GW_GC1%29&origin=readme) | Appears as a camera | WebRTC | 🟡 |
| Cam OG Telephoto 3x | `GW_GC2` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Cameras%20-%20Cam%20OG%20Telephoto%203x%20%28GW_GC2%29&origin=readme) | Appears as a camera | WebRTC | 🟡 |

Notes on cameras:
- Wyze cameras serve **one live viewer at a time**. The plugin closes each stream cleanly and shows the last snapshot while a stream is open.
- **Audio** depends on the camera. Check that its microphone is on in the Wyze app. One of our Cam v3 units stayed silent in HomeKit even though the Wyze app played its sound, and we have not found why; the plugin then carries on with video only. Other cameras (the Doorbell v2, another Cam v3) work.
- **Pictures** are refreshed every 30 seconds and when Wyze reports new motion (`advanced.snapshotRefreshSeconds`, `advanced.snapshotOnMotion`). Each refresh is a short live connection, so a Wyze app view of the same camera may be interrupted.
- The Doorbell v2 press arrives from Wyze's cloud event list, so it can lag a few seconds. Turn on notifications for the doorbell in the Home app.
- Extra switches (`garage`, `spotlight`, `floodlight`, `siren`, `notifications`, `motionDetection`) are set per camera under `cameras` in the config.
- **Motion Sensor:** set `motionSensor` for a camera and it also appears as a HomeKit motion sensor, for automations. It turns on when Wyze's event list shows new motion and off after 30 seconds without more. The events come from Wyze's cloud, so expect a delay of up to about 10 seconds, and a camera without a Wyze plan records at most one motion event about every 5 minutes. Not yet tried on hardware.
- **Floodlight:** a camera with a floodlight accessory plugged in (a Cam v3 with the Wyze floodlight) gets a Floodlight switch on its own, with nothing to configure. The Home app shows it with the camera; in the camera's settings you can choose to show it as a separate tile.
- Cam Pan v4 and Bulb Cam come from [SecKatie/wyzeapy](https://github.com/SecKatie/wyzeapy) and have not been tried on hardware here yet.

</details>

<details>
<summary><strong>Doorbells</strong> (4)</summary>

| Camera | Model code | Controls in HomeKit | Live view / snapshots | Status |
|---|---|---|---|---|
| Video Doorbell v2 | `HL_DB2` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Doorbells%20-%20Video%20Doorbell%20v2%20%28HL_DB2%29&origin=readme) | HomeKit doorbell: press notification. No Privacy switch (Wyze does not let it be powered off) | WebRTC at 640x480, with audio | ✅ |
| Video Doorbell | `WYZEDB3` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Doorbells%20-%20Video%20Doorbell%20%28WYZEDB3%29&origin=readme) | Appears as a camera only; no ring notification yet | WebRTC | 🟡 |
| Video Doorbell Pro | `GW_BE1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Doorbells%20-%20Video%20Doorbell%20Pro%20%28GW_BE1%29&origin=readme) | Appears as a camera only; no ring notification yet | WebRTC | 🟡 |
| Video Doorbell Pro 2 | `AN_RDB1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Doorbells%20-%20Video%20Doorbell%20Pro%202%20%28AN_RDB1%29&origin=readme) | Appears as a camera only; no ring notification yet | WebRTC | 🟡 |

</details>

<details>
<summary><strong>Locks</strong> (3)</summary>

| Device | Model code | Controls in HomeKit | Status |
|---|---|---|---|
| Lock | `YD.LO1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Locks%20-%20Lock%20%28YD.LO1%29&origin=readme) | Lock/unlock, door status, battery | 🟢 |
| Lock Bolt v2 | `DX_LB2` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Locks%20-%20Lock%20Bolt%20v2%20%28DX_LB2%29&origin=readme) | Lock/unlock, door status, battery | 🟢 |
| Palm Lock | `DX_PVLOC` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Locks%20-%20Palm%20Lock%20%28DX_PVLOC%29&origin=readme) | Lock/unlock, door status, battery (status refreshed every 10 s) | ✅ |

</details>

<details>
<summary><strong>Lights and bulbs</strong> (3)</summary>

| Device | Model code | Controls in HomeKit | Status |
|---|---|---|---|
| Light Bulb (White, White v2) | `WLPA19` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Lights%20-%20Bulb%20White%20%28WLPA19%29&origin=readme), `HL_HWB2` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Lights%20-%20Bulb%20White%20v2%20%28HL_HWB2%29&origin=readme) | On/off, brightness, colour temperature | 🟢 |
| Mesh / Color Bulb (A19, BR30, A19 v2) | `WLPA19C` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Lights%20-%20Color%20Bulb%20A19%20%28WLPA19C%29&origin=readme), `HL_BR30C` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Lights%20-%20Color%20Bulb%20BR30%20%28HL_BR30C%29&origin=readme), `HL_A19C2` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Lights%20-%20Color%20Bulb%20A19%20v2%20%28HL_A19C2%29&origin=readme) | On/off, brightness, colour, colour temperature | 🟢 |
| Light Strip, Light Strip Pro | `HL_LSL` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Lights%20-%20Light%20Strip%20%28HL_LSL%29&origin=readme), `HL_LSLP` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Lights%20-%20Light%20Strip%20Pro%20%28HL_LSLP%29&origin=readme) | On/off, brightness, colour | 🟢 |

</details>

<details>
<summary><strong>Plugs and switches</strong> (3)</summary>

| Device | Model code | Controls in HomeKit | Status |
|---|---|---|---|
| Plug | `WLPP1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Plugs%20and%20switches%20-%20Plug%20%28WLPP1%29&origin=readme), `WLPP1CFH` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Plugs%20and%20switches%20-%20Plug%20%28alternate%20model%29%20%28WLPP1CFH%29&origin=readme) | On/off | 🟢 |
| Outdoor Plug | `WLPPO-SUB` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Plugs%20and%20switches%20-%20Outdoor%20Plug%20%28WLPPO-SUB%29&origin=readme) | On/off | 🟢 |
| Wall Switch | `LD_SS1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Plugs%20and%20switches%20-%20Wall%20Switch%20%28LD_SS1%29&origin=readme) | On/off | 🟢 |

</details>

<details>
<summary><strong>Sensors</strong> (4)</summary>

| Device | Model code | Controls in HomeKit | Status |
|---|---|---|---|
| Contact Sensor v1, v2 | `DWS2U` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Sensors%20-%20Contact%20Sensor%20v1%20%28DWS2U%29&origin=readme), `DWS3U` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Sensors%20-%20Contact%20Sensor%20v2%20%28DWS3U%29&origin=readme) | Open/closed, battery | 🟢 |
| Motion Sensor v1, v2 | `PIR2U` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Sensors%20-%20Motion%20Sensor%20v1%20%28PIR2U%29&origin=readme), `PIR3U` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Sensors%20-%20Motion%20Sensor%20v2%20%28PIR3U%29&origin=readme) | Motion, battery | 🟢 |
| Temperature & Humidity Sensor | `TH3U` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Sensors%20-%20Temperature%20%26%20Humidity%20Sensor%20%28TH3U%29&origin=readme) | Temperature, humidity, battery | 🟢 |
| Leak Sensor | `WS3U` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Sensors%20-%20Leak%20Sensor%20%28WS3U%29&origin=readme) | Leak, battery | 🟢 |

</details>

<details>
<summary><strong>Climate and security</strong> (3)</summary>

| Device | Model code | Controls in HomeKit | Status |
|---|---|---|---|
| Home Monitoring System | `GW3U` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Sensors%20-%20Home%20Monitoring%20System%20%28GW3U%29&origin=readme) | Arm/disarm | 🟢 |
| Thermostat | `CO_EA1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Climate%20-%20Thermostat%20%28CO_EA1%29&origin=readme) | Mode, target / heat / cool temperatures, current temperature and humidity | 🟢 |
| Thermostat Room Sensor | `CO_TH1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Climate%20-%20Thermostat%20Room%20Sensor%20%28CO_TH1%29&origin=readme) | Temperature, humidity, battery | 🟢 |

</details>

<details>
<summary><strong>Vacuum and sprinklers</strong> (2)</summary>

| Device | Model code | Controls in HomeKit | Status |
|---|---|---|---|
| Robot Vacuum | `JA_RO2` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Appliances%20-%20Robot%20Vacuum%20%28JA_RO2%29&origin=readme) | Start/stop, fan speed, battery and charging state, fault codes, per-room switches | 🟢 |
| Sprinkler Controller | `BS_WK1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Appliances%20-%20Sprinkler%20Controller%20%28BS_WK1%29&origin=readme) | Zone valves: start/stop, duration, remaining time | 🟢 |

</details>

## Not Yet Supported

Have a Wyze device that is not on either list? [Tell us about it](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml). The form asks what the device is and for the information the plugin has about it, which is usually enough to add support.

**Effort** is our rough estimate. **Easy** means another open-source Wyze project already handles the device, so we can port from it; **Hard** means it needs a different protocol; **Unknown** means we found no reference implementation.

<details open>
<summary><strong>Devices we do not support yet</strong> (6)</summary>

| Device | Model code | Why it isn't supported | Effort |
|---|---|---|---|
| Air Purifier | `CO_AP1` [report](https://github.com/identd113/homebridge-wyze-smart-home/issues/new?template=new-device.yml&device=Appliances%20-%20Air%20Purifier%20%28CO_AP1%29&origin=readme) | No accessory class. [wyzeapy](https://github.com/SecKatie/wyzeapy) reads on/off, fan mode and air quality, and HomeKit has matching services | Medium |
| Keypad | — | It is an accessory of the lock and HomeKit has no keypad service. [wyze-sdk](https://github.com/shauntarves/wyze-sdk) reads its enable setting and events | Unknown |
| Lamp Socket / Lamp Socket v2 | — | No model code yet | Easy |
| Lock Bolt (original, Bluetooth only) | — | Bluetooth only, no cloud control | Hard |
| Window Cam, Battery Video Doorbell, Duo Cam Doorbell | — | No model codes yet | Unknown |
| Night Light, Surge Protector | — | No model codes yet | Unknown |

</details>

Not applicable to HomeKit, or not planned: Cordless Vacuum, Scales, Watch, Headphones, Chimes.

For more information about our version updates, please check our [change log](CHANGELOG.md).

## Configuration

The easiest way is the settings screen in Homebridge Config UI X. You can also edit the `platforms` section of `config.json` yourself.

### Quick start

Four fields are **required**. With only these, the plugin finds your Wyze devices and adds them to Homebridge automatically, using the default settings:

```json
{
  "platforms": [
    {
      "platform": "WyzeSmartHome",
      "name": "Wyze",
      "auth": {
        "username": "YOUR_EMAIL",
        "password": "YOUR_PASSWORD",
        "keyId": "YOUR_KEY_ID",
        "apiKey": "YOUR_API_KEY"
      }
    }
  ]
}
```

If your Wyze account uses an authenticator app for 2-factor authentication, also add `"totpSecret": "YOUR_2FA_KEY"` inside `auth` (see below).

### Required fields

| Field | What to enter |
|---|---|
| `auth.username` | Your Wyze account email address. |
| `auth.password` | Your Wyze account password. |
| `auth.keyId` | From the [Wyze developer portal](https://developer-api-console.wyze.com/). |
| `auth.apiKey` | From the same portal. |

To get the Key ID and API key, sign in to the [Wyze developer portal](https://developer-api-console.wyze.com/) with the same account you use in the Wyze app, then choose **Create an API key**. Wyze emails you to say a key was created. Use **view** to see the full key.

### Recommended settings

Everything else is optional. This example shows every common setting at the value the plugin uses when you leave it out, so you only need to write a line to change it:

```json
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
        { "mac": "MAC_ADDRESS_1", "name": "Garage cam", "garage": true, "siren": true }
      ],
      "excludes": { "macs": [], "types": [] },
      "hms": { "enabled": false },
      "logging": { "level": "info" },
      "advanced": {
        "snapshotRefreshSeconds": 30,
        "snapshotOnMotion": true,
        "warmLiveView": false
      }
    }
  ]
}
```

The `cameras` entry is only an example. Cameras not listed there still appear, with the camera and its Privacy switch (the Doorbell v2 has no Privacy switch).

### Optional fields

**Account**

| Field | Default | What it does |
|---|---|---|
| `auth.totpSecret` | none | Recommended if your account uses an authenticator app for 2-factor authentication. Enter the base32 key Wyze shows next to the QR code ("can't scan? enter this key"). The plugin generates the codes itself, so you enter it once. |
| `auth.mfaCode` | none | An alternative to `totpSecret`: the current 6-digit code from your authenticator app, needed once at login. It rotates every 30 seconds, so it must be current when Homebridge starts. |
| `auth.secretsFile` | none | Path to a private JSON file (mode 600) holding any of the credentials above, to keep them out of `config.json`. Values in the file override the config. The `WYZE_*` environment variables (for example `WYZE_USERNAME` and `WYZE_PASSWORD`) work too. |

**Polling**

| Field | Default | What it does |
|---|---|---|
| `polling.refreshInterval` | `30000` | How often device status is checked, in milliseconds. |
| `polling.lowBatteryPercentage` | `30` | Battery level that HomeKit reports as low. |
| `securityRefreshInterval` | `10000` | How often lock devices (Wyze Lock, Lock Bolt v2, Palm Lock) are checked for changes, in milliseconds, separately from the main refresh. Top-level option with no settings-screen field. |

**Devices**

| Field | Default | What it does |
|---|---|---|
| `cameras` | none | Extra switches for individual cameras, by `mac`: `garage`, `spotlight`, `floodlight`, `siren`, `notifications`, `motionDetection` and `motionSensor`, each `false` unless set. `name` is an optional label. A camera with a floodlight accessory needs no entry for the Floodlight switch. |
| `excludes.macs` | none | Hide devices by MAC address. |
| `excludes.types` | none | Hide every device of a type, for example `Plug`, `Light` or `Camera`. The settings screen lists the choices. |
| `hms.enabled` | `false` | Add the Home Monitoring System. Turn it on only with an active HMS subscription. |
| `thermostat.exposeRoomSensors` | `false` | Also add the thermostat's room sensors. Costs one extra request per thermostat on each refresh. |
| `thermostat.mode` | `auto` | `heat-only` or `cool-only` hides the modes your system doesn't have. |
| `vacuum.perRoomSwitches` | `false` | One HomeKit switch per room, for voice commands like "vacuum the kitchen". |

**Logging**

| Field | Default | What it does |
|---|---|---|
| `logging.level` | `info` | `error`, `warn`, `info` or `debug`. Use `debug` only when troubleshooting; the logs are long. |
| `logging.disableRedaction` | `false` | Keep tokens, emails and MAC addresses in the log. Never share a log made this way. |

**Camera pictures and live view** (under `advanced`)

| Field | Default | What it does |
|---|---|---|
| `advanced.snapshotRefreshSeconds` | `30` | How often each camera's picture in the Home app is refreshed; `0` turns it off. Each refresh is a short live connection, so a Wyze app view of the same camera may be interrupted. |
| `advanced.snapshotOnMotion` | `true` | Take a new picture as soon as Wyze reports motion. |
| `advanced.warmLiveView` | `false` | "Quick Live View". While the Home app is looking at a camera, the plugin opens a connection to it ahead of time (kept about 45 seconds after the Home app stops asking), so live view starts almost at once. Worth turning on if live view is slow to start. While a camera's connection is open the Wyze app cannot watch it, and all the cameras on screen are connected at once. |

Other advanced settings (`deviceTypeOverrides` and custom base URLs) are for troubleshooting and are explained in the settings screen.

### Older configs

The older flat format (`username`, `password`, `keyId`, `apiKey`, `filterByMacAddressList`, `garageDoorAccessory`, ...) is still accepted. On first start Homebridge converts it to the format above and keeps a copy of your old file next to it as `config.json.pre-2.0.bak`.

## Cameras and doorbells

- **Pairing.** Cameras are separate HomeKit accessories, not part of the bridge. When a camera is discovered, Homebridge's log prints its own setup code ("Please add [Camera name] manually in the Home app"); add each one in the Home app with that code. A camera that is newly recognised after an update (Cam Pan v4, Bulb Cam, Floodlight v2, Doorbell v2) shows up the same way and needs pairing once. Nothing already paired changes.
- **Live view, snapshots and audio** come from Wyze over WebRTC. A Wyze camera serves **one viewer at a time**, so opening the same camera in the Wyze app, or in a second Home app view, may interrupt the stream. While a live view is open, the tile keeps showing the last snapshot. Audio only arrives if the camera's microphone is switched on in the Wyze app.
- **Doorbell v2** is a HomeKit doorbell: a press rings the Home app (turn on notifications for it in the Home app). The plugin looks for presses in Wyze's cloud event list every 5 seconds, so the ring can arrive a few seconds late. Its picture is 640x480 (4:3) at 15 frames per second. Wyze doesn't let the doorbell be powered off through its API, so it has no Privacy switch.
- **Battery cameras** (Cam Outdoor, Cam Outdoor v2, Battery Cam Pro) are woken by every connection, so their picture is taken at startup and when motion is reported, not on a timer (unless you set `advanced.snapshotRefreshSeconds` yourself), and they never get Quick Live View.
- **Many cameras.** Pictures are taken one at a time, a few seconds each, so with more than about six cameras each one is refreshed less often than every 30 seconds (the log says how often).
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
