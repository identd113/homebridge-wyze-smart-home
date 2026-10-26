"use strict";

/**
 * Spreads the regular picture refresh evenly: with N cameras and an interval of T, one
 * camera is refreshed every T/N, in turn, so each camera is still refreshed every T but
 * they never bunch together at the same moment.
 */
class RefreshScheduler {
  constructor(intervalMs) {
    this.intervalMs = intervalMs;
    this.members = []; // anything with refreshSnapshot(reason, keepFreshMs)
    this.next = 0;
    this.timer = null;
    this.stepMs = null; // time between two cameras
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
  }

  _restart() {
    this.stop();
    if (this.members.length === 0) return;
    this.stepMs = Math.max(1000, Math.floor(this.intervalMs / this.members.length));
    this.timer = setInterval(() => this._tick(), this.stepMs);
    this.timer.unref?.();
  }

  _tick() {
    if (this.members.length === 0) return;
    this.next %= this.members.length;
    const member = this.members[this.next];
    this.next = (this.next + 1) % this.members.length;
    // The picture stays "fresh" for two intervals, so a Home app tile never opens a session of its own.
    member.refreshSnapshot?.("timer", this.intervalMs * 2);
  }
}

module.exports = RefreshScheduler;
