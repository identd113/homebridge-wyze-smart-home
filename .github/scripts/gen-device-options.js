"use strict";

// Writes the device dropdown of .github/ISSUE_TEMPLATE/new-device.yml from device-names.json.
// An issue form cannot fill one field from another, so each option carries its model code in
// brackets ("Cam v4 (HL_CAM4)") and the issue triage reads the code from the chosen option.
// "released" in device-names.json is the year Wyze first sold the device and only sets the order.
// Run `npm run device-options` after editing device-names.json; tests/triageIssue.test.js
// fails when the form is out of date.

const fs = require("fs");
const path = require("path");

const OTHER = "Not in this list (enter the model code below)";
const FORM = path.join(__dirname, "../ISSUE_TEMPLATE/new-device.yml");
const BEGIN = "        # BEGIN device options (npm run device-options)";
const END = "        # END device options";

// A dropdown has no headings, so each option starts with its group ("Cameras - Cam v4 (HL_CAM4)").
// Groups keep the order below; inside a group the newest device comes first.
const SECTIONS = ["Cameras", "Locks", "Lights", "Plugs and switches", "Sensors", "Climate", "Appliances"];

function options() {
  const devices = Object.entries(require("./device-names.json"));
  const rank = (section) => SECTIONS.indexOf(section);
  devices.sort(([, a], [, b]) =>
    rank(a.section) - rank(b.section) || b.released - a.released || a.name.localeCompare(b.name, "en", { numeric: true })
  );
  const labels = devices.map(([code, d]) => `${d.section} - ${d.name} (${code})`);
  return [...labels, OTHER];
}

function render(form) {
  const start = form.indexOf(BEGIN);
  const stop = form.indexOf(END);
  if (start < 0 || stop < start) throw new Error("device option markers not found in new-device.yml");
  const lines = options().map((o) => `        - ${JSON.stringify(o)}`);
  return form.slice(0, start) + [BEGIN, ...lines].join("\n") + "\n" + form.slice(stop);
}

if (require.main === module) {
  fs.writeFileSync(FORM, render(fs.readFileSync(FORM, "utf8")));
}

module.exports = { OTHER, FORM, SECTIONS, options, render };
