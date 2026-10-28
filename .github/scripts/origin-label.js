"use strict";

/**
 * Intake for every new issue, whichever form made it: assigns the maintainers if nobody is
 * assigned, labels the issue by where the reporter came from, and warns when the text looks like
 * it contains a password, API key or token: the values are replaced with REDACTED in the issue
 * text, and only the names of the secrets are ever repeated. The bug report and device report forms
 * have an optional "Where did you come from?" question, which a link on another page can
 * fill in (for example `...issues/new?template=bug-report.yml&origin=wyze-api` from the
 * wyze-api repository). It runs from .github/workflows/label-origin.yml through
 * actions/github-script. The issue text is untrusted: it is only read as data, and only a
 * short, plain name ever becomes part of a label.
 */

const { assignIfUnassigned } = require("./maintainers.js");
const { credentialKeysIn, personalKeysIn, redactAll } = require("./credentials.js");

const CREDENTIAL_MARKER = "<!-- wyze-credentials -->";
const CREDENTIAL_LABEL = "credentials-exposed";

const HEADING = "Where did you come from?";
const ORIGIN = /^[a-z0-9][a-z0-9._-]{0,30}$/;

/** "from:wyze-api" for an answer such as "wyze-api", or null when there is none worth a label. */
function originLabel(body) {
  const text = String(body || "").replace(/\r\n/g, "\n");
  const parts = text.split(/^### +(.+?) *$/m);
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i].trim() !== HEADING) continue;
    const value = parts[i + 1].trim().toLowerCase();
    return ORIGIN.test(value) ? `from:${value}` : null;
  }
  return null;
}

function personalComment(keys, redacted) {
  return [
    CREDENTIAL_MARKER,
    "**This issue contained personal details** (" + keys.map((k) => `\`${k}\``).join(", ") + ")." +
      (redacted ? " I replaced the values with `REDACTED` automatically." : " Please replace the values with `REDACTED` by editing the issue."),
    "",
    "GitHub keeps an issue's edit history, so to remove the originals open the issue's \"edited\" dropdown, choose the earlier version, and select **Delete revision**. Nothing needs changing in your Wyze account.",
    "",
    "<sub>This comment is written by a script and updates when the issue is edited.</sub>",
  ].join("\n");
}

function credentialComment(keys, redacted, personal = []) {
  return [
    CREDENTIAL_MARKER,
    "**This issue contained credentials** (" + keys.map((k) => `\`${k}\``).join(", ") + ")." +
      (redacted ? " I replaced the values with `REDACTED` automatically." : " Please replace the values with `REDACTED` by editing the issue."),
    "",
    "GitHub keeps an issue's edit history, so the original values can still be seen and may already have been copied. Please:",
    "",
    "1. **Change them now.** Create a new API key in the Wyze developer portal, and change your Wyze password if you posted it.",
    "2. Open the issue's \"edited\" dropdown, choose the earlier version, and select **Delete revision**.",
    "",
    ...(personal.length ? ["", "Personal details were also replaced (" + personal.map((k) => `\`${k}\``).join(", ") + ")."] : []),
    "",
    "<sub>This comment is written by a script. The `credentials-exposed` label stays until a maintainer is satisfied the credentials were changed.</sub>",
  ].join("\n");
}

async function handleCredentials({ github, core, owner, repo, issue, labels }) {
  const keys = credentialKeysIn(issue.body);
  const personal = personalKeysIn(issue.body);
  if (!keys.length && !personal.length) return keys; // nothing found: leave any earlier label and comment alone
  let redacted = false;
  try {
    await github.rest.issues.update({ owner, repo, issue_number: issue.number, body: redactAll(issue.body) });
    redacted = true;
  } catch (err) {
    core.warning(`#${issue.number}: could not redact the issue text: ${err.message}`);
  }
  if (keys.length) {
    try {
      await github.rest.issues.getLabel({ owner, repo, name: CREDENTIAL_LABEL });
    } catch (err) {
      if (err.status !== 404) throw err;
      await github.rest.issues.createLabel({ owner, repo, name: CREDENTIAL_LABEL, color: "b60205" });
    }
    if (!labels.includes(CREDENTIAL_LABEL)) await github.rest.issues.addLabels({ owner, repo, issue_number: issue.number, labels: [CREDENTIAL_LABEL] });
  }
  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: issue.number, per_page: 100 });
  const mine = comments.find((c) => c.body && c.body.includes(CREDENTIAL_MARKER) && c.user && c.user.type === "Bot");
  const body = keys.length ? credentialComment(keys, redacted, personal) : personalComment(personal, redacted);
  if (mine) {
    if (mine.body !== body) await github.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number: issue.number, body });
  }
  return keys.length ? keys : personal;
}

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const issue = context.payload.issue;
  if (context.payload.action === "opened") {
    await assignIfUnassigned({ github, core, owner, repo, number: issue.number, current: issue.assignees || [] });
  }
  const label = originLabel(issue.body);
  const current = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  const exposed = await handleCredentials({ github, core, owner, repo, issue, labels: current });
  if (exposed.length) core.warning(`#${issue.number}: credentials in the issue: ${exposed.join(", ")}`);
  for (const name of current.filter((n) => n.startsWith("from:") && n !== label)) {
    await github.rest.issues.removeLabel({ owner, repo, issue_number: issue.number, name });
  }
  if (!label || current.includes(label)) return;
  try {
    await github.rest.issues.getLabel({ owner, repo, name: label });
  } catch (err) {
    if (err.status !== 404) throw err;
    await github.rest.issues.createLabel({ owner, repo, name: label, color: "c2e0c6" });
  }
  await github.rest.issues.addLabels({ owner, repo, issue_number: issue.number, labels: [label] });
  core.info(`#${issue.number}: ${label}`);
}

module.exports = { HEADING, CREDENTIAL_LABEL, originLabel, credentialComment, personalComment, run };
