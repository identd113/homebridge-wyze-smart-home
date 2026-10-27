"use strict";

/**
 * Intake for every new issue, whichever form made it: assigns the maintainers if nobody is
 * assigned, and labels the issue by where the reporter came from. The bug report and device report forms
 * have an optional "Where did you come from?" question, which a link on another page can
 * fill in (for example `...issues/new?template=bug-report.yml&origin=wyze-api` from the
 * wyze-api repository). It runs from .github/workflows/label-origin.yml through
 * actions/github-script. The issue text is untrusted: it is only read as data, and only a
 * short, plain name ever becomes part of a label.
 */

const { assignIfUnassigned } = require("./maintainers.js");

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

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const issue = context.payload.issue;
  if (context.payload.action === "opened") {
    await assignIfUnassigned({ github, core, owner, repo, number: issue.number, current: issue.assignees || [] });
  }
  const label = originLabel(issue.body);
  const current = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
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

module.exports = { HEADING, originLabel, run };
