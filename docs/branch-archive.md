# Archived branches

Old branches that were cleaned out of the repository, what each one held, and where that work lives now. Each tip is kept as an `archive/<name>` tag, so the commits stay reachable (`git log archive/2.0.0-merge-main`).

`2.x` is the default branch. `main` is the 0.5.x line (npm `latest`, 0.5.61).

## Summary

| Branch | Tip | Last commit | What it was | Where it lives now |
|---|---|---|---|---|
| `feature/lock-fast-poll-wyze-api-1.1.11` | `847142f9e` | 2026-04-30 | Lock Bolt V2 and Palm Lock, a separate 10 s lock poll, thermostat setter fixes, `wyze-api` 1.1.11 | `WyzeLockBoltV2.js` and the lock poll are in `2.x` |
| `feature/thermostat-hms-improvements` | `3cf78c5bd` | 2026-04-11 | Thermostat humidity sensor and fan switch, a fix for a Home Monitoring offline crash, dependency bumps | The fan switch is in `2.x`. The separate humidity tile was missing and was restored in 2.0.0-beta.3 |
| `release/0.5.56` | `1a928a8ec` | 2026-05-11 | The 0.5.56 stability release | Merged into `main` |
| `2.0.0-merge-main` | `11aa07d01` | 2026-08-06 | A parallel reconciliation of `main` (0.5.x) into the 2.0.0 line, with an audit pass | `2.x` took the same direction on its own. Three audit fixes were **not** carried over (below) |
| `codex/add-dx_pvloc-...` (two branches), `pr/merge-main-into-2.0.0` | n/a | n/a | Nothing that `2.x` does not already have | Deleted without a tag |

## Fixes on `2.0.0-merge-main` that `2.x` does not have

Checked against `2.x` on 2026-10-26. None of these is a regression from beta.2.

1. **Device nicknames are only sanitized once.** `sanitizeDeviceName()` runs when an accessory is created. `WyzeAccessory.update()` (every poll) writes the raw `device.nickname` into the HomeKit `Name` characteristic and the saved context, and some log lines print the raw nickname. A nickname with control characters or an oversized string passes through on every refresh after the first. Commit `1d88b26`.
2. **`WyzeSwitch` has no command grace period.** Plugs, lights, mesh lights, locks and Home Monitoring arm a short window after a write so a poll cannot revert the tile before Wyze catches up. `WyzeSwitch` (wall switch and Palm) does not, so it can flicker back and forth after a toggle. Commit `57e2abf`.
3. **The thermostat's `emheat`, `dev_hold` and `kid_lock` values are not coerced.** Wyze can send `"0"` and `"1"` as strings, and `"0"` is truthy in JavaScript. `2.x` assigns the value directly (`WyzeThermostat.js`, in the property-update switch). The branch compares with `true`, `1` and `"1"`. Commit `57e2abf`. This is checked against the code only; there is no thermostat on the test bridge.

The branch also contains the `wyze-api` fixes listed in `wyze-api`'s `docs/branch-archive.md` (the `getHmsID()` result, the thermostat setpoint units and error-message redaction).

Fixed on `2.x` by other means: the camera accessory-cache break on Homebridge 2.x (issue #311). `WyzeCamera.persistState()` keeps state in memory.

## Restoring a branch

```
git fetch origin 'refs/tags/archive/*:refs/tags/archive/*'
git switch -c 2.0.0-merge-main archive/2.0.0-merge-main
```
