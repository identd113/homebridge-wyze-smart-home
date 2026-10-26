"use strict";

const MOTION_POLL_MS = 10_000;
const LOOK_BACK_MS = 5 * 60 * 1000;
const MAX_BACKOFF_TICKS = 12; // ~2 minutes between tries while Wyze keeps failing

/**
 * One platform-wide check of the cloud event list for every camera that wants motion
 * events: a single request covers all of them, so the number of cameras does not change
 * how often Wyze is called.
 *
 * A member is `{ mac, online(), onEvents(events), reset() }`. `onEvents` gets that
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
    this.busy = false;
    this.failures = 0;
    this.skip = 0;
  }

  add(member) {
    if (this.members.includes(member)) return;
    this.members.push(member);
    if (!this.timer) {
      this.timer = setInterval(() => this.poll(), this.intervalMs);
      this.timer.unref?.();
    }
  }

  remove(member) {
    this.members = this.members.filter((m) => m !== member);
    if (this.members.length === 0) this.stop();
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
      // Back off (10 s, 20 s, 40 s ... about 2 minutes) so a failing Wyze isn't hammered.
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
