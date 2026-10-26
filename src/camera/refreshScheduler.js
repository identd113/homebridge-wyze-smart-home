"use strict";

/**
 * Spreads the regular picture refresh evenly: with N cameras and an interval of T, one
 * camera is refreshed every T/N, in turn, so each camera is still refreshed every T but
 * they never bunch together at the same moment.
 *
 * A capture takes a few seconds and they run one at a time, so there is a floor on the time
 * between two of them (`minStepMs`). With so many cameras that T/N would be shorter, the
 * cameras are taken in turn at that pace instead and each one is refreshed less often
 * than T, rather than the plugin capturing nonstop.
 */
class RefreshScheduler {
  constructor(intervalMs, { log = null, minStepMs = 5000, announceDelayMs = 3000 } = {}) {
    this.intervalMs = intervalMs;
    this.log = log;
    this.minStepMs = minStepMs;
    this.announceDelayMs = announceDelayMs;
    this._announceTimer = null;
    this.members = []; // anything with refreshSnapshot(reason, keepFreshMs)
    this.next = 0;
    this.timer = null;
    this.stepMs = null; // time between two cameras
    this._announced = null;
  }

  /** How often each camera is actually refreshed: the interval, or longer with many cameras. */
  get effectiveIntervalMs() {
    return this.stepMs ? this.stepMs * this.members.length : this.intervalMs;
  }

  add(member) {
    if (this.members.includes(member)) return;
    this.members.push(member);
    this._restart();
  }

  remove(member) {
    const index = this.members.indexOf(member);
    if (index === -1) return;
    this.members.splice(index, 1);
    if (index < this.next) this.next -= 1;
    this._restart();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    clearTimeout(this._announceTimer);
  }

  _restart() {
    this.stop();
    if (this.members.length === 0) return;
    this.stepMs = Math.max(this.minStepMs, Math.floor(this.intervalMs / this.members.length));
    this.timer = setInterval(() => this._tick(), this.stepMs);
    this.timer.unref?.();
    this._announceSoon();
  }

  // Said once, a moment after the cameras have all joined, not at each one.
  _announceSoon() {
    clearTimeout(this._announceTimer);
    this._announceTimer = setTimeout(() => {
      const effective = this.effectiveIntervalMs;
      const slower = this.members.length > 0 && effective > this.intervalMs;
      if (slower && effective !== this._announced) {
        this.log?.(`[Camera] [Snapshot] ${this.members.length} cameras cannot all be refreshed every ${Math.round(this.intervalMs / 1000)} s (one picture takes a few seconds): each is refreshed every ${Math.round(effective / 1000)} s instead`);
      }
      this._announced = slower ? effective : null;
    }, this.announceDelayMs);
    this._announceTimer.unref?.();
  }

  _tick() {
    if (this.members.length === 0) return;
    this.next %= this.members.length;
    const member = this.members[this.next];
    this.next = (this.next + 1) % this.members.length;
    // The picture stays "fresh" for two refreshes, so a Home app tile never opens a session of its own.
    member.refreshSnapshot?.("timer", this.effectiveIntervalMs * 2);
  }
}

module.exports = RefreshScheduler;
