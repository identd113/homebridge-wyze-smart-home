# Releasing the plugin

How a release gets to npm, and the order to do things in. This plugin depends on [wyze-api](https://github.com/identd113/wyze-api), so **`wyze-api` always goes first**.

## How publishing works

- A release is made on GitHub (a **GitHub Release** on the `2.x` branch). Publishing the release starts a workflow:
  - **Pre-release ticked** → `npm-publish-beta.yml`, which publishes to the npm `beta` tag.
  - **Pre-release not ticked** → `npm-publish-stable.yml`, which publishes to `latest`.
  - Either workflow can also be started by hand (`workflow_dispatch`).
- The version in `package.json` must not already be on npm.
- The workflow also checks that a published `wyze-api` satisfies the range in `dependencies.wyze-api`, and stops if not. That range is the one place the minimum `wyze-api` version is declared. The plugin checks the installed `wyze-api` against it again at startup.
- Publishing is **staged**: the workflow runs `npm stage publish` with a stage-only token, so nothing goes live until you approve it on npmjs.com (with 2FA) or with `npm stage approve <id>`.
- Until 2.0 is stable, `latest` stays on the old line (`0.5.61` at the time of writing), so a plain `npm install homebridge-wyze-smart-home` does not move anyone to 2.x.

## Before the release

1. Release `wyze-api` first (see its `docs/releasing.md`), and wait until it is on npm.
2. Set `dependencies.wyze-api` to the version you just published. If the plugin uses a method only the new `wyze-api` has (the Cam Plus plan lookup, the bulk property read), a range that still allows an older one lets users end up with those features quietly switched off.
3. `npm test` and `npm run lint` pass against the published `wyze-api`, not only against a local link. Some tests fail until the `wyze-api` they need is on npm.
4. If `wyze-api` gained a device, run `npm run known-models` (and `npm run device-options` after editing `device-names.json`). `tests/triageIssue.test.js` fails when either file is out of date.
5. `npm audit --omit=dev` is clean, or you know why not. The plugin has no lockfile, so run it in a copy after `npm install`.
6. Bump `version` in `package.json`, and give the new section of `CHANGELOG.md` its version heading. Anything that changes behavior for existing users goes first in it.
7. Add release notes under `docs/releases/` if needed, and say which `wyze-api` version it pairs with.
8. Check the README shows the three example configs (minimum, recommended, maximum) and the table of what each adds, and that they match the settings you added or changed. `tests/readmeConfigs.test.js` fails when an example uses a setting the schema no longer has, or when the maximum config leaves a new setting out.

## Releasing

1. Push `2.x`.
2. Make the GitHub Release (`v<version>`, target `2.x`, pre-release ticked for a beta).
3. Approve the staged publish on npmjs.com.
4. Check the tags: `npm view homebridge-wyze-smart-home dist-tags`. For a beta, `beta` points at the new version and `latest` is unchanged.

## After

- Install both packages from the registry into a scratch Homebridge, start it, and check the log for errors. Open the plugin's settings page and look at the Detected sensors panel.
- Let a beta soak for a while with no new bugs before cutting a stable 2.0.0.
