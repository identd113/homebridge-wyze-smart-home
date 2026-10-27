"use strict";

/**
 * When a maintainer puts the "verified" label on a device report that says the device works,
 * this opens a pull request that records it everywhere the repo lists supported and
 * unsupported devices, but only when that raises the device's level (see device-status.js):
 * the device becomes "confirmed by a user" in the README's supported tables, its row is removed
 * from the "Not Yet Supported" table (with that table's count), and its entry is removed from
 * src/plannedDevices.js. A device already at that level or above gets a thank-you and the
 * issue is closed, with no pull request. It runs from .github/workflows/verify-device.yml through
 * actions/github-script. The README is never pushed to directly, and the issue text is
 * untrusted: it is only read as data, and only a model code that passed MODEL_PATTERN is
 * ever used.
 */

const { parseForm, modelFrom, MODEL_PATTERN } = require("./triage-issue.js");
const { LEVELS, USER, statusOf, raiseToUser, noChangeNote } = require("./device-status.js");

const MARK = LEVELS[USER].symbol;
const MAINTAINER = new Set(["admin", "maintain", "write"]);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Removes the "Not Yet Supported" row for `code`, and lowers that table's count to match. */
function dropFromUnsupported(readme, code) {
  const start = readme.indexOf("## Not Yet Supported");
  const end = readme.indexOf("## Configuration");
  if (start < 0 || end < start || !MODEL_PATTERN.test(code)) return { text: readme, removed: false };
  const rowFor = new RegExp("^\\|[^|\n]*\\| `" + escapeRegex(code) + "`[^\n]*\n", "m");
  let section = readme.slice(start, end);
  if (!rowFor.test(section)) return { text: readme, removed: false };
  section = section.replace(rowFor, "");
  section = section.replace(/(Devices we do not support yet<\/strong> \()(\d+)(\))/, (_, a, n, c) => a + Math.max(0, Number(n) - 1) + c);
  return { text: readme.slice(0, start) + section + readme.slice(end), removed: true };
}

/** Removes the `code` entry from the source of src/plannedDevices.js. */
function dropPlanned(source, code) {
  if (!MODEL_PATTERN.test(code)) return { text: source, removed: false };
  const entry = new RegExp("\n  " + escapeRegex(code) + ": \\{[\\s\\S]*?\n  \\},", "");
  return entry.test(source) ? { text: source.replace(entry, ""), removed: true } : { text: source, removed: false };
}

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const issue = context.payload.issue;
  const sender = context.payload.sender.login;
  const say = (body) => github.rest.issues.createComment({ owner, repo, issue_number: issue.number, body });

  const { data: perm } = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: sender });
  if (!MAINTAINER.has(perm.permission)) {
    core.info(`#${issue.number}: ${sender} is not a maintainer`);
    await github.rest.issues.removeLabel({ owner, repo, issue_number: issue.number, name: "verified" });
    return;
  }

  const labels = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  const model = modelFrom(parseForm(issue.body));
  if (!labels.includes("report:works") || !labels.includes("already-supported") || !model) {
    await say("Not verified: this needs to be a device report that says the device **works**, for a model the plugin already handles. The `verified` label has been left on so you can check the report.");
    return;
  }

  const branch = context.payload.repository.default_branch;
  const file = await github.rest.repos.getContent({ owner, repo, path: "README.md", ref: branch });
  const readme = Buffer.from(file.data.content, "base64").toString("utf8");
  const status = statusOf(readme, model);
  if (!status) return void (await say(`Not verified: I could not find \`${model}\` in the README's supported-device tables. Add its row there first.`));
  if (status.level >= USER) {
    // Nothing to raise: thank the reporter and close, without a pull request.
    await say(noChangeNote(model, status));
    await github.rest.issues.update({ owner, repo, issue_number: issue.number, state: "closed", state_reason: "completed" });
    return;
  }
  const marked = raiseToUser(readme, model);
  const unsupported = dropFromUnsupported(marked.text, model);
  const plannedFile = await github.rest.repos.getContent({ owner, repo, path: "src/plannedDevices.js", ref: branch });
  const planned = dropPlanned(Buffer.from(plannedFile.data.content, "base64").toString("utf8"), model);

  const head = `verified/${model.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${issue.number}`;
  const base = await github.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  await github.rest.git.createRef({ owner, repo, ref: `refs/heads/${head}`, sha: base.data.object.sha });
  const message = `${model} confirmed working by a user report (#${issue.number})`;
  await github.rest.repos.createOrUpdateFileContents({
    owner, repo, path: "README.md", branch: head, sha: file.data.sha, message: `README: ${message}`,
    content: Buffer.from(unsupported.text, "utf8").toString("base64"),
  });
  if (planned.removed) {
    await github.rest.repos.createOrUpdateFileContents({
      owner, repo, path: "src/plannedDevices.js", branch: head, sha: plannedFile.data.sha, message: `Planned devices: ${message}`,
      content: Buffer.from(planned.text, "utf8").toString("base64"),
    });
  }
  const changes = [
    `- \`${model}\` raised from ${status.name} to ${LEVELS[USER].name} (${MARK}) in the README's supported tables`,
    unsupported.removed ? "- its row removed from the README's \"Not Yet Supported\" table" : null,
    planned.removed ? "- its entry removed from `src/plannedDevices.js`" : null,
  ].filter(Boolean).join("\n");
  const pr = await github.rest.pulls.create({
    owner, repo, head, base: branch,
    title: `README: ${model} confirmed working`,
    body: `\`${model}\` confirmed working, from the report in #${issue.number}, verified by @${sender}.\n\n${changes}\n\nCloses #${issue.number}`,
  });
  await say(`Thank you for the report. \`${model}\` is confirmed working. #${pr.data.number} records it in the device lists and closes this issue once it is merged.`);
  core.info(`#${issue.number}: ${model} -> PR #${pr.data.number}`);
}

module.exports = { MARK, dropFromUnsupported, dropPlanned, run };
