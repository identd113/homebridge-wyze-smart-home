"use strict";

const MAX_BACKOFF_CYCLES = 12;

/**
 * Once per refresh cycle, reads the properties of every device that needs them in a single request
 * (`client.getPropertyListForDevices`), instead of one `getDevicePID` request per device. A device
 * then collects its own rows with `take(mac)`.
 *
 * It never throws and never stands in the way. When it cannot supply a device (the installed
 * wyze-api has no bulk read, Wyze is failing, or a device's row is missing) `take` returns null and
 * the device reads its own properties exactly as before, and a warning says so. A warning is logged
 * once when a fallback begins, not on every cycle, and a message says when it ends.
 *
 * A member is an accessory with `{ mac, display_name, propertyPids, wantsProperties() }`. Devices
 * that are not members this cycle (not seen in an object list yet, offline) read their own
 * properties without a warning: that is not a failure of the bulk read.
 */
class PropertyPoller {
  constructor(client, { log } = {}) {
    this.client = client;
    this.log = log;
    this.rows = new Map();
    this.failures = 0;
    this.skip = 0;
    this.failing = false; // a bulk request failed and has not worked since
    this.missing = new Set(); // members Wyze returned no row for, last time
    this.warnedUnavailable = false;
  }

  // wyze-api before the bulk read was added does not have the method.
  get available() {
    return typeof this.client?.getPropertyListForDevices === "function";
  }

  async prefetch(accessories) {
    this.rows = new Map(); // rows are good for this cycle only
    const members = accessories.filter((a) => a.wantsProperties?.());
    if (members.length === 0) return;

    if (!this.available) {
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
        this.log?.warn?.("[Properties] the installed wyze-api has no bulk property read; each device reads its own properties");
      }
      return;
    }
    if (this.skip > 0) { this.skip -= 1; return; } // backing off after errors

    const pids = [...new Set(members.flatMap((m) => m.propertyPids))];
    try {
      const byMac = await this.client.getPropertyListForDevices(members.map((m) => ({ mac: m.mac })), pids);
      for (const member of members) {
        const list = byMac.get(member.mac);
        if (Array.isArray(list) && list.length > 0) {
          this.rows.set(member.mac, list);
          if (this.missing.delete(member.mac)) this.log?.info?.(`[Properties] ${member.display_name || member.mac}: bulk read has its properties again`);
        } else if (!this.missing.has(member.mac)) {
          this.missing.add(member.mac);
          this.log?.warn?.(`[Properties] no properties came back for ${member.display_name || member.mac}; it reads its own`);
        }
      }
      if (this.failing) this.log?.info?.("[Properties] the bulk property read is working again");
      this.failing = false;
      this.failures = 0;
      this.log?.debug?.(`[Properties] one request read ${this.rows.size} of ${members.length} devices`);
    } catch (err) {
      // Back off (0, 1, 3, 7 cycles skipped) so a failing Wyze isn't hammered; meanwhile each
      // device reads its own properties.
      this.failures += 1;
      this.skip = Math.min(2 ** (this.failures - 1) - 1, MAX_BACKOFF_CYCLES);
      if (!this.failing) {
        this.failing = true;
        this.log?.warn?.(`[Properties] the bulk property read failed (${err.message}); each device reads its own until it works`);
      }
      this.log?.debug?.(`[Properties] bulk read failed (${this.failures} in a row): ${err.message}`);
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

module.exports = PropertyPoller;
