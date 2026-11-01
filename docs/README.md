# Documentation

Notes for people working on the plugin. The user-facing guide is the [README](../README.md).

| File | What it covers |
|---|---|
| [design-bulk-property-read.md](design-bulk-property-read.md) | The plugin side of the bulk property read (`src/propertyPoller.js`), the verified facts and the risks |
| [releasing.md](releasing.md) | How a release reaches npm: the workflows, the staged publish, the checklist, and why `wyze-api` goes first |
| [releases/](releases/) | Release notes for whoever ships and supports a release |
| [branch-archive.md](branch-archive.md) | Old branches that were cleaned out, what each held, and where that work lives now |

## Tests

Tests are in [`../tests/`](../tests/) and run with `npm test`. They use stubs for Homebridge and Wyze, so they need no Homebridge install, no network and no Wyze account. `npm run lint` checks `src/`. CI runs both on every pull request.
