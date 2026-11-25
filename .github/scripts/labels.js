"use strict";

/**
 * Creates a label the issue scripts want, unless the repository already has plenty with that prefix. A label name can
 * come from the reporter (a model code, an origin), so without a limit one person could fill the label list.
 */
const MAX_PER_PREFIX = { "model:": 300, "from:": 50 };

async function ensureLabel(github, owner, repo, name, color = "ededed", core = null) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name });
    return true;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  const prefix = Object.keys(MAX_PER_PREFIX).find((p) => name.startsWith(p));
  if (prefix) {
    const all = await github.paginate(github.rest.issues.listLabelsForRepo, { owner, repo, per_page: 100 });
    if (all.filter((label) => label.name.startsWith(prefix)).length >= MAX_PER_PREFIX[prefix]) {
      core?.warning?.(`Not creating label ${name}: the repository already has ${MAX_PER_PREFIX[prefix]} labels starting with ${prefix}`);
      return false;
    }
  }
  await github.rest.issues.createLabel({ owner, repo, name, color });
  return true;
}

/**
 * The labels on an issue that the bot put there, and that nobody has taken off and put back since: the last time each
 * was added, it was added by a bot. Labels a maintainer set by hand are not in it.
 */
async function labelsSetByBot(github, owner, repo, issueNumber) {
  const events = await github.paginate(github.rest.issues.listEvents, { owner, repo, issue_number: issueNumber, per_page: 100 });
  const last = new Map();
  for (const event of events) {
    if ((event.event === "labeled" || event.event === "unlabeled") && event.label) last.set(event.label.name, event);
  }
  return new Set([...last].filter(([, e]) => e.event === "labeled" && e.actor && e.actor.type === "Bot").map(([name]) => name));
}

module.exports = { ensureLabel, labelsSetByBot, MAX_PER_PREFIX };
