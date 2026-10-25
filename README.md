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
- Light Bulb (White, White V2)
- Light Strips (Light Strip, Light Strip Pro)
- Color Bulb (Mesh Light A19, BR30, A19 v2)
- Plug
- Outdoor Plug
- V1 & V2 Contact Sensor (Status / Battery)
- V1 & V2 Motion Sensor (Status / Battery)
- Temperature & Humidity Sensor (Status / Battery)
- Leak Sensor (Status / Battery)
- Lock (Battery / Door Status / Control)
- Lock Bolt v2 / Palm Lock (Battery / Door Status / Control)
- Camera v1, v2, v3, v3 Pro, v4 (on/off, Siren, Floodlight, Garage Door)
- Cam Pan, Pan v2, Pan v3 (on/off, Siren)
- Cam Pan v4 (on/off, Siren, Spotlight, state; new in 2.0.0-beta.3, not yet verified on hardware)
- Bulb Cam (light; new in 2.0.0-beta.3, not yet verified on hardware)
- Cam Doorbell v2 (HomeKit doorbell: press notification, snapshots and live view with audio at 640x480; new in 2.0.0-beta.3). There is no Privacy switch for it: Wyze doesn't let the doorbell be powered off through its API. The press comes from Wyze's cloud event list, so it can arrive a few seconds after the button is pressed. Turn on notifications for the doorbell in the Home app.
- Outdoor Cam, Outdoor Cam 2
- Wall Switch
- Home Monitoring System (HMS)
- Thermostat

## Not Yet Supported
The following Wyze products are recognized by the plugin but have no HomeKit support yet:
- Cameras: Battery Cam Pro, Cam OG, Cam OG Telephoto 3x, Cam Floodlight Pro, Cam Pan Pro
- Doorbells: Video Doorbell, Video Doorbell Pro, Video Doorbell Pro 2
- Plugs: Outdoor Plug (main unit)
- Sensors: Chime Sensor, Room Sensor (thermostat companion), Keypad
- Locks: Lock Bolt (original BLE-only version)
- Sprinkler Controller

The following newer Wyze products have no model codes in the plugin yet:
- Window Cam, Battery Video Doorbell, Duo Cam Doorbell
- Lamp Socket / Lamp Socket v2, Night Light, Surge Protector

The following Wyze products are not applicable to HomeKit:
- Robot Vacuum, Cordless Vacuum, Scales, Watch, Headphones, Air Purifier

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

## Other Info

Special thanks to the following projects for reference and inspiration:

- [ha-wyzeapi](https://github.com/JoshuaMulliken/ha-wyzeapi), a Wyze integration for Home Assistant.
- [wyze-node](https://github.com/noelportugal/wyze-node), a Node library for the Wyze API.

Thanks to [misenhower](https://github.com/misenhower/homebridge-wyze-connected-home) for the original Wyze Homebridge plugin, and thanks to all [contributors](CONTRIBUTORS.md) who have volunteered their time to help fix bugs and add support for more devices and features.

This plugin is an actively maintained fork of misenhower's original [Wyze Homebridge Plugin](https://github.com/misenhower/homebridge-wyze-connected-home) project.
