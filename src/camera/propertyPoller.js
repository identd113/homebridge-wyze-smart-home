"use strict";

// The properties WyzeCamera switches on in _refresh. A property that is not named in the bulk
// request never comes back, so tests/propertyPoller.test.js keeps this list in step with that switch.
const CAMERA_PIDS = ["P1", "P3", "P5", "P1001", "P1029", "P1049", "P1056", "P1301"];

const MIN_BULK_DEVICES = 2; // one device costs the same either way, so only batch when it saves a request
const MAX_BACKOFF_CYCLES = 12;

/**
 * Once per refresh cycle, reads the properties of every camera that needs them in one request
 * (`client.getPropertyListForDevices`), instead of one `getDevicePID` request per camera. A camera
 * then collects its own rows with `take(mac)`.
 *
 * It never throws and never stands in the way: when it cannot help (the installed wyze-api has no
 * bulk read, Wyze is failing, too few cameras, or a camera's row is missing) `take` returns null
 * and the camera reads its own properties exactly as before.
 *
 * A member is an accessory with `{ mac, propertyPids, wantsProperties() }`.
 */
class PropertyPoller {
  constructor(client, { log, minDevices = MIN_BULK_DEVICES } = {}) {
    this.client = client;
    this.log = log;
    this.minDevices = minDevices;
    this.rows = new Map();
    this.failures = 0;
    this.skip = 0;
  }

  // wyze-api before the bulk read was added does not have the method.
  get available() {
    return typeof this.client?.getPropertyListForDevices === "function";
  }

  async prefetch(accessories) {
    this.rows = new Map(); // rows are good for this cycle only
    if (!this.available) return;
    if (this.skip > 0) { this.skip -= 1; return; } // backing off after errors
    const members = accessories.filter((a) => a.wantsProperties?.());
    if (members.length < this.minDevices) return;
    const pids = [...new Set(members.flatMap((m) => m.propertyPids))];
    try {
      const byMac = await this.client.getPropertyListForDevices(members.map((m) => ({ mac: m.mac })), pids);
      for (const member of members) {
        const list = byMac.get(member.mac);
        if (Array.isArray(list) && list.length > 0) this.rows.set(member.mac, list);
      }
      this.failures = 0;
      this.log?.debug?.(`[Properties] one request read ${this.rows.size} of ${members.length} devices`);
    } catch (err) {
      // Back off (0, 1, 3, 7 cycles skipped) so a failing Wyze isn't hammered; meanwhile each
      // camera reads its own properties.
      this.failures += 1;
      this.skip = Math.min(2 ** (this.failures - 1) - 1, MAX_BACKOFF_CYCLES);
      this.log?.debug?.(`[Properties] bulk read failed: ${err.message}`);
      if (this.failures === 5) this.log?.warn?.(`[Properties] the bulk property read keeps failing (${err.message}); reading each device on its own`);
    }
  }

  /** This device's rows from the bulk read, in the shape `getDevicePID` returns, or null. */
  take(mac) {
    const list = this.rows.get(mac);
    if (!list) return null;
    this.rows.delete(mac);
    return { data: { property_list: list } };
  }
}

PropertyPoller.CAMERA_PIDS = CAMERA_PIDS;

module.exports = PropertyPoller;
