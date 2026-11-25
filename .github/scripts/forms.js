"use strict";

/**
 * Reads the "### Heading" sections of an issue form body. Done line by line: a regular expression with a lazy
 * group and a trailing optional run of spaces backtracks badly on a heading made of thousands of spaces, and issue
 * bodies are written by anyone.
 *
 * Returns [{ heading, value }] in order. Text before the first heading is dropped.
 */
function sections(body) {
  const text = String(body || "").replace(/\r\n/g, "\n");
  const out = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("### ")) {
      current = { heading: line.slice(4).trim(), lines: [] };
      out.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return out.map(({ heading, lines }) => ({ heading, value: lines.join("\n").trim() }));
}

module.exports = { sections };
