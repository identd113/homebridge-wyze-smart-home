"use strict";

const MOTION_POLL_MS = 10_000;
const LOOK_BACK_MS = 5 * 60 * 1000;
const MAX_BACKOFF_TICKS = 12; // 1 to 2 minutes between tries while Wyze keeps failing

/**
 * One platform-wide check of the cloud event list for every camera that wants motion
 * events: a single request covers all of them, so the number of cameras does not change
 * how often Wyze is called.
 *
 * A member is `{ mac, everyMs, online(), onEvents(events), reset() }`. The poll runs as often
 * as the most demanding member asks (`everyMs`, default 10 s); every online camera is read
 * on each beat, because the request costs the same however many cameras it names. `onEvents` gets that
 * camera's recent events (newest first) on each successful poll; `reset()` is called for a
 * camera that is offline, so it can forget what it has seen.
 */
class MotionPoller {
  constructor(client, { intervalMs = MOTION_POLL_MS, log } = {}) {
    this.client = client;
    this.intervalMs = intervalMs;
    this.log = log;
    this.members = [];
    this.timer = null;
    this.beatMs = null;
    this.busy = false;
    this.failures = 0;
    this.skip = 0;
  }

  add(member) {
    if (this.members.includes(member)) return;
    this.members.push(member);
    this._restart();
  }

  remove(member) {
    this.members = this.members.filter((m) => m !== member);
    this._restart();
  }

  // The beat is the fastest any member needs; it is only restarted when that changes.
  _restart() {
    if (this.members.length === 0) return this.stop();
    const beat = Math.min(this.intervalMs, ...this.members.map((m) => m.everyMs || this.intervalMs));
    if (this.timer && beat === this.beatMs) return;
    this.stop();
    this.beatMs = beat;
    this.timer = setInterval(() => this.poll(), beat);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async poll() {
    if (this.busy) return;
    if (this.skip > 0) { this.skip -= 1; return; } // backing off after errors
    const online = [];
    for (const member of this.members) {
      if (member.online()) online.push(member);
      else member.reset?.();
    }
    if (online.length === 0) return;
    this.busy = true;
    try {
      const byMac = await this.client.cameraGetEventsMulti(online.map((m) => m.mac), { sinceMs: LOOK_BACK_MS, count: 20 });
      for (const member of online) member.onEvents(byMac[member.mac] ?? []);
      this.failures = 0;
    } catch (err) {
      // Back off (1, 3, 7, 12 beats skipped) so a failing Wyze isn't hammered.
      this.failures += 1;
      this.skip = Math.min(2 ** (this.failures - 1) - 1, MAX_BACKOFF_TICKS);
      this.log?.debug?.(`[Camera] motion check failed: ${err.message}`);
      if (this.failures === 5) this.log?.warn?.(`[Camera] motion can't be read from Wyze right now (${err.message}); retrying`);
    } finally {
      this.busy = false;
    }
  }
}

module.exports = MotionPoller;
