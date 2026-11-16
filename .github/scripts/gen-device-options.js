"use strict";

// Writes the device dropdown of .github/ISSUE_TEMPLATE/new-device.yml from device-names.json.
// An issue form cannot fill one field from another, so each option carries its model code in
// brackets ("Cam v4 (HL_CAM4)") and the issue triage reads the code from the chosen option.
// "released" in device-names.json is the month Wyze launched the device (from the Wyze community
// launch timeline) and only sets the order; "estimated": true marks a date or product match not confirmed.
// Run `npm run device-options` after editing device-names.json; tests/triageIssue.test.js
// fails when the form is out of date.

const fs = require("fs");
const path = require("path");

const OTHER = "Not in this list (enter the model code below)";
const FORM = path.join(__dirname, "../ISSUE_TEMPLATE/new-device.yml");
// The same labels by model code, shipped with the plugin (the .github folder is not), so the camera test
// page can open this form with the right device already chosen.
const LABELS = path.join(__dirname, "../../src/deviceIssueLabels.json");
const BEGIN = "        # BEGIN device options (npm run device-options)";
const END = "        # END device options";

// A dropdown has no headings, so each option starts with its group ("Cameras - Cam v4 (HL_CAM4)").
// Groups keep the order below; inside a group the newest device comes first.
const SECTIONS = ["Doorbells", "Cameras", "Battery cameras", "Locks", "Lights", "Plugs and switches", "Sensors", "Climate", "Appliances"];

function options() {
  const devices = Object.entries(require("./device-names.json"));
  const rank = (section) => SECTIONS.indexOf(section);
  devices.sort(([, a], [, b]) =>
    rank(a.section) - rank(b.section) || b.released.localeCompare(a.released) || a.name.localeCompare(b.name, "en", { numeric: true })
  );
  const labels = devices.map(([code, d]) => `${d.section} - ${d.name} (${code})`);
  return [...labels, OTHER];
}

/** { "HL_DB2": "Doorbells - Video Doorbell v2 (HL_DB2)", ... }, sorted by model code. */
function labelsByModel() {
  const out = {};
  for (const [code, d] of Object.entries(require("./device-names.json")).sort(([a], [b]) => a.localeCompare(b))) {
    out[code] = `${d.section} - ${d.name} (${code})`;
  }
  return out;
}

function renderLabels() {
  return `${JSON.stringify(labelsByModel(), null, 2)}\n`;
}

function render(form) {
  const start = form.indexOf(BEGIN);
  const stop = form.indexOf(END);
  if (start < 0 || stop < start) throw new Error("device option markers not found in new-device.yml");
  const all = options();
  const lines = all.map((o) => `        - ${JSON.stringify(o)}`);
  // The dropdown starts on its last option ("Not in this list"): a link from the camera test page cannot choose a
  // dropdown option for the person, so the case that link is for starts out right. `default` is the option's index.
  const before = form.slice(0, start);
  const at = before.indexOf("id: device");
  if (at < 0) throw new Error("the device dropdown was not found in new-device.yml");
  const head = before.slice(0, at) + before.slice(at).replace(/^(      default: )\d+$/m, (line, prefix) => prefix + (all.length - 1));
  return head + [BEGIN, ...lines].join("\n") + "\n" + form.slice(stop);
}

if (require.main === module) {
  fs.writeFileSync(FORM, render(fs.readFileSync(FORM, "utf8")));
  fs.writeFileSync(LABELS, renderLabels());
}

module.exports = { OTHER, FORM, LABELS, SECTIONS, options, render, labelsByModel, renderLabels };
