"use strict";

/**
 * How well a device is verified, read from the README's supported-device tables. The levels,
 * lowest to highest:
 *   registered only  < supported  < confirmed by a user  < confirmed by a maintainer
 * A row's Status column gives the level of every model code in the row. A code that shares a
 * row with others can also carry its own 🔵 (confirmed by a user), which raises that code alone.
 * Both .github/scripts/triage-issue.js and verify-device.js use this, so a report only ever
 * moves a device up, never down or sideways.
 */

const LEVELS = [
  { key: "registered", symbol: "🟡", name: "registered only" },
  { key: "supported", symbol: "🟢", name: "supported" },
  { key: "user", symbol: "🔵", name: "confirmed by a user" },
  { key: "maintainer", symbol: "✅", name: "confirmed by a maintainer" },
];
const USER = 2;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The table row for `code` in the supported-device tables, or null. */
function rowFor(readme, code) {
  const start = readme.indexOf("## Supported Devices");
  const end = readme.indexOf("## Not Yet Supported");
  if (start < 0 || end < start) return null;
  const token = "`" + code + "`";
  return readme.slice(start, end).split("\n").find((line) => line.startsWith("|") && line.includes(token + " ")) || null;
}

/** @returns {{ level: number, name: string, symbol: string, shared: boolean } | null} null when there is no row. */
function statusOf(readme, code) {
  const row = rowFor(readme, code);
  if (!row) return null;
  const cells = row.split("|");
  const statusCell = cells[cells.length - 2] || "";
  const base = LEVELS.findIndex((l) => statusCell.includes(l.symbol));
  const marked = row.includes("`" + code + "` " + LEVELS[USER].symbol);
  const level = Math.max(base < 0 ? 0 : base, marked ? USER : 0);
  return { level, name: LEVELS[level].name, symbol: LEVELS[level].symbol, shared: (cells[2].match(/`[^`]+`/g) || []).length > 1 };
}

/**
 * Raises `code` to "confirmed by a user" in the README text. A row with one model code gets its
 * Status symbol replaced; a row with several gets a 🔵 next to that code only.
 * @returns {{ text: string, changed: boolean } | null} null when there is no row for the code.
 */
function raiseToUser(readme, code) {
  const status = statusOf(readme, code);
  if (!status) return null;
  if (status.level >= USER) return { text: readme, changed: false };
  const row = rowFor(readme, code);
  const token = "`" + code + "`";
  const upgraded = status.shared
    ? row.replace(new RegExp(escapeRegex(token) + " (?=\\[report\\])"), token + " " + LEVELS[USER].symbol + " ")
    : row.replace(/ (🟡|🟢) \|\s*$/, " " + LEVELS[USER].symbol + " |");
  if (upgraded === row) return null;
  return { text: readme.replace(row, upgraded), changed: true };
}

/** The sentence for a report that cannot move the device up. */
function noChangeNote(code, status) {
  return `\`${code}\` is currently listed as ${status.name}, so your report will not update the existing list, but it is confirmation that this is still working. Thank you.`;
}

module.exports = { LEVELS, USER, statusOf, raiseToUser, noChangeNote };
