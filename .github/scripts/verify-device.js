"use strict";

/**
 * When a maintainer puts the "verified" label on a device report that says the device works,
 * this marks the device as confirmed in the README (a 🔵 next to its model code) and opens a
 * pull request for it. It runs from .github/workflows/verify-device.yml through
 * actions/github-script. The README is never pushed to directly, and the issue text is
 * untrusted: it is only read as data, and only a model code that passed MODEL_PATTERN is
 * ever used.
 */

const { parseForm, modelFrom, MODEL_PATTERN } = require("./triage-issue.js");

const MARK = "🔵";
const MAINTAINER = new Set(["admin", "maintain", "write"]);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Puts the 🔵 mark next to `code` in the README's device tables.
 * @returns {{ text: string, changed: boolean } | null} null when the README has no row for the code.
 */
function markVerified(readme, code) {
  if (!MODEL_PATTERN.test(code)) return null;
  const token = "`" + code + "`";
  if (!readme.includes(token + " ")) return null;
  if (readme.includes(token + " " + MARK)) return { text: readme, changed: false };
  const pattern = new RegExp(escapeRegex(token) + " (?=\\[report\\])", "g");
  if (!pattern.test(readme)) return null;
  return { text: readme.replace(pattern, token + " " + MARK + " "), changed: true };
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
  const result = markVerified(readme, model);
  if (!result) return void (await say(`Not verified: I could not find \`${model}\` in the README's device tables.`));
  if (!result.changed) return void (await say(`\`${model}\` is already marked as confirmed in the README.`));

  const head = `verified/${model.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${issue.number}`;
  const base = await github.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  await github.rest.git.createRef({ owner, repo, ref: `refs/heads/${head}`, sha: base.data.object.sha });
  await github.rest.repos.createOrUpdateFileContents({
    owner, repo, path: "README.md", branch: head, sha: file.data.sha,
    message: `README: ${model} confirmed working by a user report (#${issue.number})`,
    content: Buffer.from(result.text, "utf8").toString("base64"),
  });
  const pr = await github.rest.pulls.create({
    owner, repo, head, base: branch,
    title: `README: ${model} confirmed working`,
    body: `Marks \`${model}\` with ${MARK} in the supported-device tables, from the report in #${issue.number}, verified by @${sender}.\n\nCloses #${issue.number}`,
  });
  await say(`Thank you for the report. \`${model}\` is confirmed working: ${MARK} is added next to it in the README by #${pr.data.number}, which closes this issue once it is merged.`);
  core.info(`#${issue.number}: ${model} -> PR #${pr.data.number}`);
}

module.exports = { MARK, markVerified, run };
