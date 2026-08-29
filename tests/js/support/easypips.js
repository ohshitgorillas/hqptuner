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
import { elements, attr, hasAttr, text } from "./markup.js";

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
 * A pip is marked with a BARE `data-pip`, so its presence is read with
 * `hasAttr` and never with `attr`: SSR emits a valueless attribute bare
 * (docs/testing.md, harness facts), and `attr` only matches `name="value"` — it
 * would answer `undefined` for every pip on the card and count them all as
 * none.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {number}
 */
export const pipCount = (out, presetId) =>
  elements(group(out, presetId).html).filter((el) => hasAttr(el, "data-pip")).length;

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
 * Read as: the smallest element of the tile enclosing BOTH of them is some
 * element INSIDE the tile rather than the tile box itself. That is what "one
 * row" means structurally, and it is indifferent to how deeply either of them
 * is wrapped — a mark inside a positioning wrapper answers true, and so do pips
 * inside one, because a row is free to group its contents however it likes and
 * how it does so is the writer's business, not a behavior.
 *
 * A group moved OUT of the mark's row — into a row of its own, or anywhere else
 * the two no longer share a region of the tile — answers false: the smallest
 * element enclosing both is then the tile box, the only thing left that holds
 * them both.
 *
 * A tile showing no mark throws rather than answering false about a row that is
 * not there, and so does a tile carrying anything but exactly one pip group
 * (`group`).
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
  const both = smallestAround(fragment, [marks[0], pips]);
  return both.html.length < fragment.length;
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
