// The readers for the PIP GROUP an Easy Mode preset tile carries: the little
// row of marks standing for what that preset costs the machine. The cases
// themselves are tests/js/components/easypips.test.js.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// It is imported DYNAMICALLY by that suite, after its `useStorage()` call, for
// the same reason tests/js/support/easymark.js is: it reaches a tile through
// tests/js/support/easytiles.js's `tileHtml`, and `store/easyview.js` reads
// localStorage at import.
//
// THE RENDERED CONTRACT these readers rest on:
//   * `data-testid="easy-pips"` on the pip GROUP, one per tile
//   * `data-pip` on each pip inside that group
//   * an accessible name on the group — an `aria-label` with something in it, or
//     an `aria-labelledby` pointing at an element that says something
//
// NO COPY IS READ HERE (docs/testing.md rule 9). A pip is found by the marking
// it carries and never by a word; that the group HAS a name is a behavior, the
// words it is spelt with are the owner's.

import { tileHtml } from "./easytiles.js";
import { elements, attr, text, enclosing } from "./markup.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

const GROUP = "easy-pips";

/**
 * One tile's pip group; anything but exactly one throws, so a tile that grew a
 * second group fails by name rather than reading the first it finds.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {MarkupElement}
 */
function group(out, presetId) {
  const hits = elements(tileHtml(out, presetId)).filter((el) => attr(el, "data-testid") === GROUP);
  if (hits.length !== 1) throw new Error(`expected one pip group on the "${presetId}" tile, found ${hits.length}`);
  return hits[0];
}

/**
 * How many pips one tile renders.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {number}
 */
export const pipCount = (out, presetId) =>
  elements(group(out, presetId).html).filter((el) => attr(el, "data-pip") !== undefined).length;

/**
 * Whether the pip group carries an accessible name: an `aria-label` with
 * something in it, or an `aria-labelledby` pointing at an element that says
 * something. Either wiring names the group and which one a writer reaches for is
 * not a behavior, so the two are one answer here — and no case reads the name.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {boolean}
 */
export function pipsAreNamed(out, presetId) {
  const fragment = tileHtml(out, presetId);
  const g = group(out, presetId);
  const label = attr(g, "aria-label");
  if (label !== undefined && label.trim() !== "") return true;
  const by = attr(g, "aria-labelledby");
  return by !== undefined && elements(fragment).some((el) => attr(el, "id") === by && text(el) !== "");
}

/**
 * Whether the pip group and the apodizing mark stand in ONE row.
 *
 * Read as: the smallest element of the tile that encloses BOTH of them is the
 * pip group's own parent. That is what "one row" means structurally and it is
 * indifferent to how the mark is wrapped — a mark sitting inside a positioning
 * wrapper that is the group's sibling answers true, and so does a bare mark
 * beside it, because the wrapper is the writer's business. A group moved out of
 * the row answers false: the smallest element enclosing both is then an
 * ancestor of the group's parent rather than the parent itself.
 *
 * A tile showing no mark throws rather than answering false about a row that is
 * not there.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {boolean}
 */
export function pipsShareTheMarksRow(out, presetId) {
  const fragment = tileHtml(out, presetId);
  const marks = elements(fragment).filter((el) => (attr(el, "class") || "").split(/\s+/).includes("apod-mark"));
  if (marks.length !== 1) throw new Error(`expected one mark on the "${presetId}" tile, found ${marks.length}`);
  const pips = group(out, presetId);
  const row = enclosing(fragment, pips);
  const both = smallestAround(fragment, [marks[0], pips]);
  return both.start === row.start && both.html.length === row.html.length;
}

/**
 * The smallest element of a fragment enclosing every one of the elements given.
 *
 * @param {string} fragment
 * @param {MarkupElement[]} els
 * @returns {MarkupElement}
 */
function smallestAround(fragment, els) {
  const from = Math.min(...els.map((el) => el.start));
  const to = Math.max(...els.map((el) => el.start + el.html.length));
  const around = elements(fragment).filter((el) => el.start <= from && el.start + el.html.length >= to);
  if (around.length === 0) throw new Error("nothing in the fragment encloses them all");
  return around.reduce((a, b) => (a.html.length <= b.html.length ? a : b));
}
