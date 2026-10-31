"use strict";

// How long a camera's Motion, Sound and detection sensors stay on, counted from the time of the last new event: `advanced.sensorHoldSeconds`
// (flattened into the plugin config), 2 minutes when it is not set. A value that is not a number of at least
// MIN_SECONDS falls back to the default, and a very long one is capped, so a typo cannot leave a tile stuck on.
const DEFAULT_SECONDS = 120;
const MIN_SECONDS = 5;
const MAX_SECONDS = 3600;

function holdMs(config) {
  const seconds = Number(config && config.sensorHoldSeconds);
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS) return DEFAULT_SECONDS * 1000;
  return Math.min(seconds, MAX_SECONDS) * 1000;
}

// How old an event is: by Wyze's clock when wyze-api provides it (`ageMs`), else by this machine's clock. Never negative.
function ageOf(event) {
  const age = typeof event.ageMs === "number" ? event.ageMs : Date.now() - event.time;
  return Number.isFinite(age) ? Math.max(0, age) : 0;
}

// How much of the hold is left, counted from the time of the event itself and not from when the plugin noticed it: the
// newest of these events decides. Wyze lists an event several seconds late, so a tile that stays on for 2 minutes
// goes off 2 minutes after the event happened. Zero or less means the hold has already passed.
function remainingMs(config, events) {
  return holdMs(config) - Math.min(...events.map(ageOf));
}

module.exports = { holdMs, ageOf, remainingMs, DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS };
