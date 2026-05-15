# homebridge-wyze-smart-home

# Funding   [![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square&maxAge=2592000)](https://www.paypal.com/paypalme/AllenFarmer) [![Donate](https://img.shields.io/badge/Donate-Venmo-blue.svg?style=flat-square&maxAge=2592000)](https://venmo.com/u/Allen-Farmer) [![Donate](https://img.shields.io/badge/Donate-Cash_App-blue.svg?style=flat-square&maxAge=2592000)](https://cash.app/$Jfamer08)

If you like what I have done here and want to help I would recommend that you firstly look into supporting Homebridge. None of this could happen without them.

After you have done that if you feel like my work has been valuable to you I welcome your support through Paypal or other means. 

## Releases

### v0.5.58
- Fix original Wyze Lock (YD.LO1) failing with `PARAM_SIGN_INVALID` / `PARAM_TIMESTAMP_INVALID` — bumps `wyze-api` to `1.1.14`, which corrects Ford API payload signing: signature is now computed after `access_token`, `key`, and `timestamp` are injected, and `getLockInfo` now sends signed parameters on the GET request. Lock Bolt V2, Lock Bolt Pro, and Palm Lock (IoT3 path) are unaffected.
- Closes #300

### v0.5.57
- Add `ModelNames` lookup table for cleaner device identification across all accessories
- Standardize log prefixes across all accessories for consistent log formatting
- Update README device list and add CONTRIBUTORS.md

### v0.5.56
- Remove `homebridge-config-ui-x` from plugin dependencies — it was never imported and caused install failures on Node.js 22/24 due to `node-pty` native bindings. Closes #286
- Reduce log noise: apply change-detection to all accessories so HomeKit characteristics are only updated when values actually change, eliminating redundant `[Wyze]` log lines on every poll
- Fix accessory routing regression — accessories were dispatching to the wrong handler after the 0.5.55 refactor
- Normalize all `noResponse` log messages to a consistent format across all accessories
- Fix four bugs identified in code review (null guards, incorrect characteristic references)
- Homebridge 1.x and 2.x compatibility verified

### v0.5.55
- Fix continuous Homebridge restart loop introduced in 0.5.54 — closes #295
- Add null guards for API responses across WyzeCamera, WyzeLight, WyzeMeshLight, WyzeLock, WyzeHMS, and WyzeThermostat to prevent `TypeError` crashes on transient Wyze API errors
- Wrap all `updateCharacteristics()` calls with `Promise.resolve().catch()` to prevent unhandled rejections from terminating the Homebridge process on Node.js 15+
- Add `default` branch to HMS state conversion to prevent undefined return

### v0.5.54
- Add Node.js 22 and 24 to supported engines — closes #281
- Pin `eslint` to v8 to satisfy `eslint-config-standard@17` peer dependency
- Bump `@typescript-eslint` to v8 for ESLint 9 compatibility

### v0.5.53
- First npm-published release via automated workflow
- Add Wyze Lock Bolt v2 (`DX_LB2`) support via IoT3 API — closes #285
- Add Palm Lock (`DX_PVLOC`) support via IoT3 API
- Add security fast-poll loop (10s) for locks — lock state changes reflect in HomeKit within 10 seconds
- Add `ChargingState` characteristic and firmware revision reporting to Lock Bolt V2
- Add live connectivity detection via `iot-state` in Lock Bolt V2
- Add humidity sensor, fan mode switch, emergency heat switch, hold mode switch, and keypad lock switch to thermostat
- Fix thermostat sub-services resolving to the same cached service on restart
- Fix WyzeHMS crash on offline
- Update `wyze-api` to 1.1.12

### v0.5.48
- Add security fast-poll loop (10s) for locks — lock state changes now reflect in HomeKit within 10 seconds instead of 60
- Add `lastDevice` caching to `WyzeAccessory` base class to support fast-poll without a full device list refresh
- Fix `WyzeLock` first-poll spurious full refresh by initializing state vars to `null`
- Refactor `WyzeLockBoltV2` to delegate IoT3 calls to `wyze-api` client (removes inline axios/crypto code)
- Add `ChargingState` characteristic to `WyzeLockBoltV2` battery service (`battery::power-source` confirmed as integer: 1=battery, 2=USB)
- Add firmware revision reporting to `WyzeLockBoltV2` via `device-info::firmware-ver`
- Add live connectivity detection via `iot-device::iot-state` in `WyzeLockBoltV2` (faster offline detection than `conn_state`)
- Add humidity sensor service to thermostat (surfaces `humidity` prop as `HumiditySensor`)
- Add fan mode switch to thermostat (on = continuous fan, off = auto)
- Add emergency heat switch to thermostat
- Add hold mode switch to thermostat
- Add keypad lock switch to thermostat
- Add read-only current scenario indicator to thermostat (reflects active schedule, snaps back if toggled)
- Fix thermostat Switch services to use `getServiceById` — prevents all sub-services resolving to the same cached service on restart
- Fix WyzeHMS crash on offline — `this.getCharacteristic` corrected to `this.securityService.getCharacteristic`
- Update wyze-api to 1.1.12 — includes bug fixes, lazy-load camera streaming, and removed moment dependency; if upgrading manually, run `npm install` or reinstall via the Homebridge UI to ensure the package is updated
- Remove unused dependencies: `moment`, `inherits`, `md5`, `uuid`; revert `homebridge-config-ui-x` to `^4.56.4`

### v0.5.47
- Add Wyze Lock Bolt v2 (DX_LB2) support via IoT3 API
- Add Palm Lock (DX_PVLOC) support via IoT3 API
- Add WyzeCamV4 support
- Update axios to 1.7.4 for security improvements
- Fix color crashloop issue in camera v4

### v0.5.46
- Update thermostat structure to new format
- Update thermostat to have min/max thresholds closer to Wyze Thermostat thresholds -  https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/203
- Update thermostat to avoid constant reboot -  https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/228

### v0.5.45
- Increase Wyze-api Verison 1.0.7
- Update Logging

### v0.5.44
- Increase Wyze-api Version 1.0.5

### v0.5.43
- Increase Wyze-api Version 1.0.6

### v0.5.42
### v0.5.41
- Increase version of wyze-api 1.0.3

### v0.5.40
- Correct Outdoor Cam 2 model number

### v0.5.39
- Support for WyzeCamOutdoor2

### v0.5.38
- Resolve issues with API changes from Wyze (2024-02-01) by @hgoscenski in #3
- Format Code

### v0.5.37-alpha.7
- Remove Delay from MeshLight
- Format Code

### v0.5.37-alpha.6
- Correct Mesh Brightness
- Correct camera offline

### v0.5.37-alpha.5
- Code Clean up
- Add Switch to turn on/off Notifications
- Correct Wall Switch Status
- Adjust Logging

### v0.5.37-alpha.4
- Add HL_A19C2
- Code clean up

### v0.5.37-alpha.3
- Fix issue with Light

### v0.5.37-alpha.2
- Add check box for HMS Subscription
- Removed MFA Support
- Correct Door State for Garage Door
- Code clean up

### v0.5.37-alpha.1
- Support for Siren
- Support for Garage Door
- Support for Spotlight
- Support for Floodlight

### v0.5.36
- Add HL_Cam3p to Approved List
- Require API Key and KeyID
- Add Info Logging

### v0.5.35
- Add loging to sub models

### v0.5.34
- Allow all sub models.

### v0.5.33
- Updated Thermostat behavior for single mode usage (heat/cool) (Thanks https://github.com/carTloyal123) - https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/111

### v0.5.32
- Improve logging - https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/117

### v0.5.31
- Improve Camera support - https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/92

### v0.5.30
- HMS Code Clean up
- Update ReadME
- Update WyzeLeakSensor

### v0.5.29
- Support for API Key and Key ID
- Support for WYZECP1_JEF

### v0.5.28
- Correction for No-Response

### v0.5.26
- Release of Beta

### v0.5.25-beta.5
- Support for Thermostat
- Support for Wall Switch
- Support for HMS

### v0.5.25-dev.0
- Support for Thermostat
- Support for Wall Switch
- Support for HMS
### v0.5.25-beta.3
- Wall Switch Status update
- HMS
- Lock support is broken
### v0.5.25-beta.2
- Wall Switch was not status being followed
- Unable to turn Wall Switch On or Off.
- LOCK support is broken for this release
### v0.5.25-beta.1
- Wall Switch Support
- Lock changes - Reduce calls to wyze platform 
- Major Changes to SDK
- Initial support for Thermostat in SDK
- Initial support for HMS in SDK.

### v0.5.24
- Release

### v0.5.24-beta.1
- Filter Devices by Mac Address (Thanks https://github.com/kliu99)
- Filter Devices by Device Type
- Refresh refreshToken every 48 Hours
- Add Logging

### v0.5.24-beta.0
- Feature Support for ignoring devices
- Upate default refresh interval to 30 secounds
- Update grammer error

### v0.5.23
- Bug OutDoor Camera was not working with on/off
- Bug Wyze Doorbell does not support on/off

### v0.5.22
- Update NPM Version

### v0.5.21
- Battery Support for Locks
- Door Sensor from lock now being reported
- Update NPM Version
- Change Log Update

### v0.5.20
- Broke Offline Support

### v0.5.19
- Issue with Locks after adding Camera Support

### v0.5.18
- Initial Support for Camera on/off switch
- Code Clean up

### v0.5.17
- Initial Support for noResponse when device is offline. 
    ContactSensor v2
    LeakSensor v2
    Light Bulb
    Mesh Light Bulb
    Motion Sensor
    Plug
- Initial Support for Battery Level on Leak Sensor

### v0.5.15
- Bug Sensor can send a value greater then 100 for Battery Level
- v0.5.14 Initial Support for Battery level on Temperature Sensor
- v0.5.14 Initial Support for Battery level on v2 Contact Sensor
- v0.5.14 Initial Support for Battery level on v2 Motion Sensor
- v0.5.13 Fix issue with Temperature Sensor
- v0.5.12 Fix issue with Leak Sensor
- v0.5.11 Fix issue with Motion Sensor
- v0.5.10 Initial support for Wyze Temperature Sensor
- v0.5.10 Initial support for Wyze Leak Sensor
- v0.5.9 Initial support for Wyze Light Strips
- v0.5.9 Initial support for Wyze V2 Contact & Motion sensors
- v0.5.8 Fixed Bulbs not properly changing values when in a Scene with other Bulbs
- v0.5.8 Improved & streamlined logging (moved all status changes to Debug logs)
- v0.5.7 Initial support for the Wyze Lock
- v0.5.6 Initial support for new Wyze Color Bulbs
- v0.5.3 Improve logfile output for Bulb and Outdoor Plug
- v0.5.2 Added support for Wyze Outdoor Plug
- v0.5.1 Improve debug logging for Contact and Motion sensors.
- v0.5.0 Added support to Contact and Motion sensors
- v0.5.0 Added support to two factor authentication (2FA) via Authenticator app
- v0.4.1 Fix an issue that prevented the auto re-login from working
- v0.4.0 Add experimental support for the Wyze Bulb accessory
- v0.4.0 Set the homepage property
- v0.4.0 Improve logging to help diagnose occasional login issues
- v0.3.0 Add config schema for Homebridge Config UI X
- v0.2.0 Fix an issue caused by the Wyze API lagging behind updates
- v0.2.0 Fix description
- v0.2.0 Fix project link
- v0.1.0 Initial commit
