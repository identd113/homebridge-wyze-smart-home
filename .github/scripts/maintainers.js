"use strict";

// Who new issues and the pull requests the workflows open are assigned to. The issue forms
// list the same people in their `assignees:`; the workflows use this for anything a form did
// not cover (an issue made through the API, a pull request opened by verify-device.js).
const ASSIGNEES = ["identd113"];

/**
 * Assigns the maintainers to an issue or pull request that has nobody assigned yet. A failure
 * here (for example a person who has since lost access) is logged, never thrown, so it cannot
 * stop the labelling that runs next to it.
 */
async function assignIfUnassigned({ github, core, owner, repo, number, current = [] }) {
  if (current.length) return false;
  try {
    await github.rest.issues.addAssignees({ owner, repo, issue_number: number, assignees: ASSIGNEES });
    return true;
  } catch (err) {
    core.warning(`#${number}: could not assign ${ASSIGNEES.join(", ")}: ${err.message}`);
    return false;
  }
}

module.exports = { ASSIGNEES, assignIfUnassigned };
