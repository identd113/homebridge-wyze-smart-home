"use strict";

/**
 * Sorts a "Wyze device report" issue (a device to add, or whether one works): reads the form, labels the issue, and
 * posts (or updates) one comment. It runs from .github/workflows/triage-issues.yml through
 * actions/github-script, and everything it decides lives in triage() so it can be tested
 * without GitHub.
 *
 * The issue text is untrusted. It is only ever parsed as data here: never run, never put in
 * a shell command, and never repeated back except for a model code that passed MODEL_PATTERN.
 */

const fs = require("fs");
const path = require("path");
const { OTHER: OTHER_DEVICE } = require("./gen-device-options.js");
const { LEVELS, USER, statusOf, noChangeNote } = require("./device-status.js");

const MARKER = "<!-- wyze-device-triage -->";

// Headings GitHub writes for the questions in .github/ISSUE_TEMPLATE/new-device.yml.
// tests/triageIssue.test.js checks that they still match the form.
const FIELD = {
  report: "What are you reporting?",
  device: "Device",
  model: "Model code (only if your device is not in the list)",
  kind: "What kind of device is it?",
  blob: "Device information",
};

// Devices with no HomeKit equivalent we plan to support (README: "Not applicable").
const NOT_APPLICABLE = {
  CHIME: "chime sensor",
  GW_CHI: "chime box",
  WL_SC3: "scale",
  WL_SC2: "scale",
  "JA.SC": "scale",
  "JA.SC2": "scale",
  JA_HP: "headphones",
};

const KIND_LABELS = {
  "Camera or doorbell": "kind:camera",
  "Light, bulb or light strip": "kind:light",
  "Plug, outlet or switch": "kind:plug-switch",
  "Sensor (contact, motion, leak, climate)": "kind:sensor",
  "Lock or keypad": "kind:lock",
  "Thermostat or room sensor": "kind:climate",
  "Vacuum, sprinkler or other appliance": "kind:appliance",
  "Something else": "kind:other",
};

// The answers to the "What are you reporting?" question, and the label each one gets.
const REPORT_LABELS = {
  "It is not supported yet": null,
  "It works": "report:works",
  "It partly works": "report:partial",
  "It does not work": "report:broken",
};

// The kind label a device from the form's list gets when the reporter did not pick a kind:
// its group in device-names.json decides.
const SECTION_KIND = {
  Doorbells: "kind:camera",
  Cameras: "kind:camera",
  "Battery cameras": "kind:camera",
  Locks: "kind:lock",
  Lights: "kind:light",
  "Plugs and switches": "kind:plug-switch",
  Sensors: "kind:sensor",
  Climate: "kind:climate",
  Appliances: "kind:appliance",
};

function kindFromModel(model) {
  const names = require("./device-names.json");
  return model && has(names, model) ? SECTION_KIND[names[model].section] || null : null;
}

const STATUS_LABELS = ["already-supported", "not-applicable", "needs-redaction", "needs-info", "regression"];

const LABEL_COLORS = {
  "already-supported": "0e8a16",
  "not-applicable": "cccccc",
  "needs-redaction": "b60205",
  "needs-info": "fbca04",
  regression: "d93f0b",
  "new device": "1d76db",
  model: "5319e7",
  kind: "c5def5",
  report: "bfd4f2",
};

// A Wyze model code, as the plugin logs it: letters, digits, dot, underscore, dash.
const MODEL_PATTERN = /^[A-Za-z0-9._-]{2,40}$/;

// Keys in the pasted device information that identify a person, a home or a network.
const SENSITIVE_KEYS = new Set([
  "mac", "nickname", "ip", "ssid", "bssid", "email", "user_name", "username",
  "address", "phone", "phone_id", "latitude", "longitude", "lat", "lon", "lng",
]);

function parseForm(body) {
  const fields = {};
  const text = String(body || "").replace(/\r\n/g, "\n");
  const parts = text.split(/^### +(.+?) *$/m);
  for (let i = 1; i < parts.length; i += 2) {
    let value = parts[i + 1].trim();
    value = value.replace(/^```[A-Za-z]*\n?/, "").replace(/\n?```$/, "").trim();
    if (value === "_No response_") value = "";
    fields[parts[i].trim()] = value;
  }
  return fields;
}

// Issues made before the device list existed have a plain "Model code" question.
const LEGACY_MODEL_HEADING = "Model code";

// The code in brackets at the end of a chosen device option, for example "Cam v4 (HL_CAM4)".
const PICKED_CODE = /\(([A-Za-z0-9._-]{2,40})\)\s*$/;

function modelFrom(fields) {
  const picked = PICKED_CODE.exec(fields[FIELD.device] || "");
  if (picked) return cleanModel(picked[1]);
  return cleanModel(fields[FIELD.model] || fields[LEGACY_MODEL_HEADING]);
}

function cleanModel(raw) {
  const value = String(raw || "").trim().replace(/^[`'"]+|[`'"]+$/g, "");
  return MODEL_PATTERN.test(value) ? value : null;
}

// Own keys only: a model code such as "constructor" must not match an inherited property.
const has = (map, key) => Object.prototype.hasOwnProperty.call(map, key);

const isRedacted = (value) => {
  const v = String(value).trim();
  return v === "" || /^(redacted|x+|\*+)$/i.test(v) || /^<.*>$/.test(v) || /^\[.*\]$/.test(v);
};

/** Names of sensitive keys (never their values) that are filled in. */
function sensitiveKeysIn(text) {
  const found = new Set();
  const quoted = /"([A-Za-z_]+)"\s*:\s*"([^"]*)"/g;
  const numeric = /"([A-Za-z_]+)"\s*:\s*(-?\d+(?:\.\d+)?)\b/g;
  let m;
  while ((m = quoted.exec(text))) {
    const key = m[1].toLowerCase();
    if (SENSITIVE_KEYS.has(key) && !isRedacted(m[2])) found.add(key);
  }
  while ((m = numeric.exec(text))) {
    const key = m[1].toLowerCase();
    if (["latitude", "longitude", "lat", "lon", "lng"].includes(key)) found.add(key);
  }
  // A log line such as "(MAC: AABBCCDDEEFF)".
  if (/\bMAC:\s*[0-9A-Fa-f]{2}(?::?[0-9A-Fa-f]{2}){5}\b/.test(text)) found.add("mac");
  return [...found].sort();
}

function blobProblem(blob, model) {
  if (!blob) return "the device information is empty";
  try {
    JSON.parse(blob);
  } catch {
    return "the device information is not valid JSON (paste the whole entry, from the opening { to the closing })";
  }
  if (model && !blob.toLowerCase().includes(model.toLowerCase())) {
    return `the device information does not mention the model code \`${model}\``;
  }
  return null;
}

/**
 * @param {string} body the issue body
 * @param {{ supported: Object<string,string>, notApplicable?: Object<string,string> }} known
 *   supported maps a model code to the kind of accessory that handles it.
 */
function triage(body, known) {
  const notApplicable = known.notApplicable || NOT_APPLICABLE;
  const fields = parseForm(body);
  const model = modelFrom(fields);
  const kind = KIND_LABELS[fields[FIELD.kind]] || kindFromModel(model);
  const reportLabel = has(REPORT_LABELS, fields[FIELD.report]) ? REPORT_LABELS[fields[FIELD.report]] : null;
  const leaks = sensitiveKeysIn(Object.values(fields).join("\n"));

  const labels = new Set(["new device"]);
  const problems = [];
  let status = "new";

  if (!model) {
    problems.push("the device is not picked from the list and the model code is missing or is not a model code (letters, digits, `.`, `_` and `-` only)");
    labels.add("needs-info");
  } else if (has(known.supported, model)) {
    status = "supported";
    labels.add("already-supported");
    if (reportLabel) labels.add(reportLabel);
  } else if (has(notApplicable, model)) {
    status = "not-applicable";
    labels.add("not-applicable");
  } else {
    labels.add(`model:${model}`);
    const problem = blobProblem(fields[FIELD.blob], model);
    if (problem) {
      problems.push(problem);
      labels.add("needs-info");
    }
  }
  if (kind) labels.add(kind);
  if (leaks.length) labels.add("needs-redaction");

  // "It works" for a model the plugin does not handle is treated as a request for it.
  const report = status === "supported" && reportLabel ? reportLabel.slice("report:".length) : null;
  const misfiled = status === "new" && !!reportLabel;

  return { fields, model, status, report, misfiled, labels: [...labels].sort(), leaks, problems };
}

/**
 * @param {object} [listed] statusOf() for a "works" report on a supported model: where the
 *   README lists that model now.
 */
function buildComment(result, known, others = [], listed = null, waiting = []) {
  const { model, status, report, misfiled, leaks, problems } = result;
  const lines = [MARKER];

  if (status === "supported" && report === "works" && listed && listed.level >= USER) {
    lines.push(
      noChangeNote(model, listed),
      "",
      "Nothing needs to change, so this issue is being closed. If something stops working later, open a new report with the plugin log."
    );
  } else if (status === "supported" && report === "works") {
    lines.push(
      `Thanks for confirming that \`${model}\` works (it is handled as: ${known.supported[model]}). That helps us keep the supported-device list honest.`,
      ""
    );
    if (listed) {
      lines.push(
        `\`${model}\` is currently listed as ${listed.name}. A maintainer will check your report, and if it is confirmed the list moves up to ${LEVELS[USER].name}.`,
        ""
      );
    }
    if (waiting.length) {
      lines.push(
        `Another confirmation for \`${model}\` is already waiting (${waiting.join(", ")}). There is no need to repeat anything there: when a maintainer verifies yours, it is added to the same pull request and you are credited with the others.`,
        ""
      );
    }
    lines.push("If something stops working later, reply here or open a new report with the plugin log.");
  } else if (status === "supported" && (report === "partial" || report === "broken")) {
    lines.push(
      `Thanks for the report. \`${model}\` is handled by the plugin (as: ${known.supported[model]}), so we will look at what goes wrong.`,
      "",
      "It helps a lot if you reply with:",
      "- the plugin version and the `wyze-api` version (both are printed in the Homebridge log at startup);",
      "- the log from startup and from the moment you use the device, with the plugin's Log Level set to debug;",
      "- this device's part of your plugin config, with personal details removed."
    );
    if (listed && listed.level >= USER) {
      lines.push(
        "",
        `\`${model}\` is currently listed as ${listed.name}, so this is being treated as a possible **regression** and is flagged for a maintainer.`
      );
    }
  } else if (status === "supported") {
    lines.push(
      `Thanks for the report. \`${model}\` is already supported (it is handled as: ${known.supported[model]}).`,
      "",
      "If it does not show up in HomeKit:",
      "- restart Homebridge and look for it in the log;",
      "- check that it is not hidden by `excludes` in your config;",
      "- cameras and doorbells are separate accessories and need pairing once in the Home app (see the README).",
      "",
      "If it still does not appear after that, reply here with the plugin log from startup."
    );
  } else if (status === "not-applicable") {
    const what = (known.notApplicable || NOT_APPLICABLE)[model];
    lines.push(
      `Thanks for the report. \`${model}\` is a ${what}, which has no HomeKit equivalent we plan to support, so there is nothing to add for it.`,
      "",
      "A maintainer will close this. If you think it should be supported, say what you would want it to do in HomeKit."
    );
  } else {
    lines.push("Thanks for the report. This is labelled so that requests for the same device group together.");
    if (misfiled) {
      lines.push("", `The plugin does not handle \`${model || "this model"}\` yet, so this is being treated as a request to add it.`);
    }
    if (others.length) {
      lines.push(
        "",
        `${others.length === 1 ? "One other person has" : `${others.length} other people have`} asked for this model too: ` +
          others.map((n) => `#${n}`).join(", ") + "."
      );
    }
  }

  if (problems.length) {
    lines.push("", "**To make this usable, please edit the issue:**", ...problems.map((p) => `- ${p}`));
  }

  if (leaks.length) {
    lines.push(
      "",
      "**Please remove personal details.** The pasted text has values filled in for: " +
        leaks.map((k) => `\`${k}\``).join(", ") +
        ". Replace them with `REDACTED` by editing the issue.",
      "",
      "GitHub keeps an issue's edit history, so also delete the old revision: open the issue's \"edited\" dropdown, " +
        "choose the earlier version, and select **Delete revision**."
    );
  }

  lines.push("", "<sub>This comment is written by a script and updates when the issue is edited.</sub>");
  return lines.join("\n");
}

const managedLabel = (name) =>
  STATUS_LABELS.includes(name) || ["model:", "kind:", "report:"].some((prefix) => name.startsWith(prefix));

async function ensureLabel(github, owner, repo, name) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name });
  } catch (err) {
    if (err.status !== 404) throw err;
    const color = LABEL_COLORS[name] || LABEL_COLORS[name.split(":")[0]] || "ededed";
    await github.rest.issues.createLabel({ owner, repo, name, color });
  }
}

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const issue = context.payload.issue;
  const known = {
    supported: require("./known-models.json"),
    notApplicable: NOT_APPLICABLE,
  };
  const result = triage(issue.body, known);

  let listed = null;
  if (result.status === "supported" && ["works", "partial", "broken"].includes(result.report)) {
    try {
      listed = statusOf(fs.readFileSync(path.join(process.cwd(), "README.md"), "utf8"), result.model);
    } catch {
      listed = null; // no README to read: say nothing about the level
    }
  }
  // "Partly works" or "does not work" for a device a user or maintainer has confirmed is a
  // possible regression: label it so it stands out.
  if (listed && listed.level >= USER && (result.report === "partial" || result.report === "broken")) {
    result.labels = [...result.labels, "regression"].sort();
  }

  let others = [];
  if (result.status === "new" && result.model) {
    const found = await github.rest.issues.listForRepo({
      owner, repo, labels: `model:${result.model}`, state: "open", per_page: 30,
    });
    others = found.data.filter((i) => i.number !== issue.number && !i.pull_request).map((i) => i.number);
  }

  // Labels: add what applies now, drop managed labels that no longer apply (after an edit).
  const current = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  for (const name of result.labels) await ensureLabel(github, owner, repo, name);
  const toAdd = result.labels.filter((name) => !current.includes(name));
  if (toAdd.length) await github.rest.issues.addLabels({ owner, repo, issue_number: issue.number, labels: toAdd });
  for (const name of current.filter((n) => managedLabel(n) && !result.labels.includes(n))) {
    await github.rest.issues.removeLabel({ owner, repo, issue_number: issue.number, name });
  }

  // One comment, created once and updated on later edits.
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner, repo, issue_number: issue.number, per_page: 100,
  });
  const mine = comments.find((c) => c.body && c.body.includes(MARKER) && c.user && c.user.type === "Bot");
  // Other open confirmations for the same device: an open verification pull request, or other
  // "works" reports still waiting for a maintainer.
  const waiting = [];
  if (listed && listed.level < USER && result.report === "works") {
    const pulls = await github.rest.pulls.list({ owner, repo, head: `${owner}:verified/${result.model.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, state: "open" });
    for (const pr of pulls.data) waiting.push(`#${pr.number}`);
    const reports = await github.rest.issues.listForRepo({ owner, repo, labels: "report:works,already-supported", state: "open", per_page: 30 });
    for (const other of reports.data) {
      if (other.number === issue.number || other.pull_request) continue;
      if (modelFrom(parseForm(other.body)) === result.model) waiting.push(`#${other.number}`);
    }
  }
  const body = buildComment(result, known, others, listed, waiting);
  if (mine) {
    if (mine.body !== body) await github.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number: issue.number, body });
  }
  // A "works" report that cannot move the device up has nothing left to do: close it with the note.
  if (listed && listed.level >= USER && result.report === "works" && context.payload.action === "opened") {
    await github.rest.issues.update({ owner, repo, issue_number: issue.number, state: "closed", state_reason: "completed" });
  }
  core.info(`#${issue.number}: ${result.status}, model ${result.model || "none"}, labels ${result.labels.join(", ")}`);
}

module.exports = {
  MARKER, FIELD, OTHER_DEVICE, NOT_APPLICABLE, KIND_LABELS, REPORT_LABELS, MODEL_PATTERN,
  parseForm, modelFrom, kindFromModel, SECTION_KIND, cleanModel, sensitiveKeysIn, blobProblem, triage, buildComment, run,
};
