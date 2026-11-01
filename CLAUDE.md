# CLAUDE.md

Homebridge plugin for Wyze Smart Home.

## Scripts

- `npm test`: runs `node --test` on `tests/*.test.js`. No arguments.
- `npm run lint`: ESLint on `src/`, with zero warnings allowed. No arguments.
- `npm run dev-link`: links the sibling `../wyze-api` checkout into `node_modules`, so the plugin runs against the local library. No arguments. A later `npm install` can replace the link.
- `npm run start`: runs Homebridge from the parent folder with this plugin (`hb-service run -P ../ -U ./`). No arguments.
- `npm run known-models`: rewrites `known-models.json`, every model code the plugin handles. Run it after `wyze-api` gains a device. `tests/triageIssue.test.js` fails when it is out of date. No arguments.
- `npm run device-options`: rewrites the device dropdown in `.github/ISSUE_TEMPLATE/new-device.yml` from `device-names.json`. Run it after editing that file. The same test fails when the form is out of date. No arguments.
