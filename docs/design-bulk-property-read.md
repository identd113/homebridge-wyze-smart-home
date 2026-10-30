# Design: plugin side of the bulk property read

Status: proposed, not implemented. The library side, the verified facts and the risks are in
`wyze-api/docs/design-bulk-property-read.md`. This file covers only what changes in this plugin.

## Problem

`WyzeCamera` reads each camera's properties on every refresh with its own request:

- `src/accessories/WyzeCamera.js:519`: the comment notes "one extra getDevicePID API call per
  refresh per camera".
- `src/accessories/WyzeCamera.js:525`: `client.getDevicePID(this.mac, this.product_model)`.
- `src/accessories/WyzeCamera.js:541`: the `switch (property.pid)` that maps each property onto
  a HomeKit characteristic. This is the code that consumes the rows.

With four cameras and the default `polling.refreshInterval` of 30 s, that is four requests every
30 s for properties alone. The request count grows with every camera added.

## Proposed change

### 1. A `PropertyPoller`, modelled on `src/camera/motionPoller.js`

- One platform-wide timer, running at `refreshInterval`.
- Each tick, it reads the properties of every online camera that has a cached pid list, in one
  library call (`getPropertyListForDevices`, see the library design).
- It stores the rows per camera MAC, along with the time of the tick.
- Cameras register with it the way they register with the motion poller. A camera that is offline,
  or not yet registered, is not included.

### 2. `WyzeCamera` reads from the poller first

- `_refresh` asks the poller for its rows. If they are fresh (read on this tick), it uses them.
- If there are no rows, or the bulk call failed, it falls back to `getDevicePID`, exactly as now.
- The rows are reshaped to `{ data: { property_list: [...] } }` before they reach the existing
  switch, so `WyzeCamera.js:541` is unchanged.

### 3. Backoff

- After repeated failures the poller waits longer between tries, like `motionPoller`
  (`MAX_BACKOFF_TICKS`). During backoff, cameras use the per-device fallback, so nothing goes
  stale silently.

## Behaviour that must not change

- Values reach HomeKit the same way. The switch in `WyzeCamera` is untouched.
- The devicemgmt path (`cameraUsesDeviceMgmt`, `WyzeCamera.js:510`) is unchanged. Those models
  never reach the poller.
- A camera that fails in the bulk call still updates via `getDevicePID`. No camera should miss a
  refresh because another camera's row failed.

## Tests

- Unit test: a camera gets the same values from the poller as it would from `getDevicePID`, using
  a recorded response.
- Unit test: a missing row, or a failed bulk call, falls back to `getDevicePID`.
- Unit test: every pid the `switch` handles is in the cached pid list. This catches a new pid
  added to the switch but not to the list.
- Live check (manual): run the same comparison as the library design before enabling, and confirm
  the HomeKit tiles update the same way.

## Other candidates found in the same review (not part of this change)

- **Sound events:** the camera event call already returns sound events (type 2). A sound sensor
  per camera would need no new request. Separate feature proposal.
- **Per-device `get_device_info`:** adds `rssi`, `conn_state` and `open_close_state`. Could give a
  Wi-Fi signal characteristic. Separate proposal.
