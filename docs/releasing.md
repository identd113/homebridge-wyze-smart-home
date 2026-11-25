# Releasing the plugin

How a release gets to npm, and the order to do things in. This plugin depends on [wyze-api](https://github.com/wyze-smart-home/wyze-api), so **`wyze-api` always goes first**.

## How publishing works

- A release is made on GitHub (a **GitHub Release** on the `2.x` branch). Publishing the release starts a workflow:
  - **Pre-release ticked** → `npm-publish-beta.yml`, which publishes to the npm `beta` tag.
  - **Pre-release not ticked** → `npm-publish-stable.yml`, which publishes to `latest`.
  - Either workflow can also be started by hand (`workflow_dispatch`).
- The version in `package.json` must not already be on npm.
- The workflow also checks that a published `wyze-api` satisfies the range in `dependencies.wyze-api`, and stops if not. That range is the one place the minimum `wyze-api` version is declared. The plugin checks the installed `wyze-api` against it again at startup.
- CI installs `wyze-api` from npm when the version in `dependencies.wyze-api` is published. Until then (before a paired release) the install step (`.github/actions/install`) takes `wyze-api` from its repository instead: the same owner as the run, on the branch with the same name, else `2.x`. So the plugin's CI can pass on a release branch before `wyze-api` is on npm, and switches to npm by itself afterwards.
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
8. Check the README "Supported hardware" grid against what the code recognises (`tests/readmeGrid.test.js` fails on a model code that is missing or unknown, a wrong group count, or a wrong doorbell or no-Privacy claim). Rewrite the README section "What's new in <version>" (it sits above Support) for this release: the user-facing features and improvements, and a boxed warning for any breaking change. It is replaced each release, with the older items living on in the change log. Also check the README shows the three example configs (minimum, recommended, maximum) and the table of what each adds, and that they match the settings you added or changed. `tests/readmeConfigs.test.js` fails when an example uses a setting the schema no longer has, or when the maximum config leaves a new setting out.

## Releasing

1. Make sure `release/<version>` is level with the commit you mean to ship, and pushed (`git branch -f release/<version> 2.x`, then `git push origin release/<version>`). Push `2.x` too, so the two match.
2. Make the GitHub Release (`v<version>`, **target `release/<version>`, not `2.x`**, pre-release ticked for a beta). The tag then sits on the release branch, so a later commit on `2.x` cannot slip into it.
3. Approve the staged publish on npmjs.com.
4. Check the tags: `npm view homebridge-wyze-smart-home dist-tags`. For a beta, `beta` points at the new version and `latest` is unchanged.

## Getting the release into the upstream repository

The same steps as in `wyze-api`'s `docs/releasing.md` ("Getting the release into the upstream repository"), and `wyze-api` goes first. In short: cut `release/<version>` from `2.x`, open the pull request to upstream `2.0.0`, merge it with a merge commit (never a squash or rebase, which rewrite the commits and strand the tags), then `git fetch upstream` and `git merge --ff-only upstream/2.0.0` on `2.x`.

Tags are not copied by a push or a merge, and are never deleted by them. Push our `v2.0.0-beta.3` to upstream with `git push upstream <tag>` after the merge, and bring upstream's missing tags over with `git fetch upstream --tags` (this fork lacks `v0.5.46`, `v0.5.47`, `v0.5.54`, `v0.5.56`, `v0.5.61`, `v2.0.0-beta.1` and `v2.0.0-beta.2`).

## After

- Install both packages from the registry into a scratch Homebridge, start it, and check the log for errors. Open the plugin's settings page and look at the Detected sensors panel; set `advanced.webServerPort` and check its "Open" link works.
- Let a beta soak for a while with no new bugs before cutting a stable 2.0.0.

## Making `2.0.0` the default branch (once the pull requests are merged)

Until this is done, upstream's default branch is `main` (the old line). Issue forms, the issue-triggered workflows and the "Report" links all read the default branch, so they do not see our versions yet. Do these in order, in both repositories (`wyze-api` first).

1. **Settings.** Set the default branch to `2.0.0`. In the plugin repository also: Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests" (the verify-device workflow opens pull requests), and check the `NPM_TOKEN` secret exists in both.
2. **Labels (plugin repository).** The issue workflows use these labels; create the ones upstream lacks: `from:wyze-api`, `from:readme`, `verified`, `report:works`, `report:partial`, `kind:camera`, `kind:light`, `kind:other`, `needs-info`, `needs-redaction`, `credentials-exposed`, `already-supported`, `new device`, `not-applicable`.
3. **Links and metadata.** Change `identd113/...` to `wyze-smart-home/...` in: `package.json` (`homepage`, `repository`, `bugs`), the README (badges, clone URL, the device "report" links), `.github/ISSUE_TEMPLATE/*`, `config.schema.json` (footer), `src/WyzeSmartHome.js` and `src/plannedDevices.js` (form URLs), `wiki/` (`Local-Protocol.md` links to `blob/2.x`; `Browser-Viewer-Example.md` clone URL), `docs/downstream.md` and this file. Keep the copyright line, the credits and history entries that name the fork. Decide who the `assignees` are (the four issue forms and `.github/scripts/maintainers.js` name `identd113`).
4. **Workflows.** `ci.yml` and `wiki-sync.yml` already run on `2.0.0`. CodeQL, dependency-review and njsscan are tied to `main`: point them at `2.0.0`. The plugin's `.github/dependabot.yml` still has an empty `package-ecosystem`, so Dependabot does nothing; fill it in or delete it. Change the README CI badge from `branch=2.x` to `branch=2.0.0`.
5. **Wording.** Where these docs say `2.x` is "the default branch" or that a release is made "on the `2.x` branch", `2.0.0` takes that place and `2.x` is only our fork's working branch (`releasing.md`, `docs/downstream.md`, `docs/branch-archive.md`).
6. **Check it works.** Open the new-device form from a README "report" link and from the camera test page; confirm the form opens with the fields filled. Open a throwaway issue and check the triage and label workflows ran. Run "Sync wiki" once and check the wiki shows the new pages (`wyze-api` only).
