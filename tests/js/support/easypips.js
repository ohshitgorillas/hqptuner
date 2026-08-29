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
//   * the `easy-cost` class on the tile's cost row, and the `easy-apod` class on
//     the apodizing mark standing in it — the same two hooks
//     tests/js/components/easytiles-hires.test.js reads that row's arrangement
//     through
//
// NO COPY IS READ HERE (docs/testing.md rule 9). A pip is found by the marking
// it carries and never by a word; that the group HAS a name is a behavior, the
// words it is spelt with are the owner's.

import { tileHtml } from "./easytiles.js";
import { elements, attr, classes, hasAttr, text } from "./markup.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

const GROUP = "easy-pips";

// The COST ROW, and the apodizing mark that stands in it. Both are class
// tokens, both are hooks and not words, and both are the ones
// tests/js/components/easytiles-hires.test.js already reads the same row's
// arrangement through, so the two suites name the row's parts identically.
//
// `easy-apod` is the ROW PART: the element the row lays out beside the badge
// and the pips. The `apod-mark` class tests/js/support/easymark.js reads is a
// DIFFERENT element nested inside it — the glyph badge shared with the filter
// dropdowns, which is where the geometry and the accessible label live. Row
// membership is a question about the row's part, so it is asked here about
// `easy-apod`; what the mark DRAWS is asked there about `apod-mark`.
const ROW = "easy-cost";
const MARK = "easy-apod";

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
 * Read as MEMBERSHIP OF THE COST ROW: the tile's one `.easy-cost` element
 * encloses both the mark and the pip group. That is what "one row" means
 * structurally, and it is indifferent to how deeply either of them is wrapped
 * INSIDE the row — a mark inside a positioning wrapper answers true, and so do
 * pips inside one, because a row is free to group its contents however it likes
 * and how it does so is the writer's business, not a behavior.
 *
 * A group moved OUT of the row — into a row of its own, into the tile body, or
 * anywhere else on the tile — answers false, however many outer wrappers still
 * happen to contain both it and the mark. That is the reading an earlier
 * revision of this helper did not have: it asked only whether SOME element
 * below the tile root enclosed both, which any tile body or content div does,
 * so a relocated group went on passing.
 *
 * A tile showing no cost row, or no mark, throws rather than answering false
 * about a row that is not there, and so does a tile carrying anything but
 * exactly one pip group (`group`).
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {boolean}
 */
export function pipsShareTheMarksRow(out, presetId) {
  const fragment = tileHtml(out, presetId);
  const row = only(fragment, (el) => classes(el).includes(ROW), "cost row", presetId);
  const mark = only(fragment, (el) => classes(el).includes(MARK), "mark", presetId);
  const pips = group(out, presetId);
  return encloses(row, mark) && encloses(row, pips);
}

/**
 * The one element of a tile answering a test; anything but exactly one throws,
 * so "there is no row" and "the group left the row" fail differently.
 *
 * @param {string} fragment
 * @param {(el: MarkupElement) => boolean} test
 * @param {string} what
 * @param {string} presetId
 * @returns {MarkupElement}
 */
function only(fragment, test, what, presetId) {
  const hits = elements(fragment).filter(test);
  if (hits.length !== 1) throw new Error(`expected one ${what} on the "${presetId}" tile, found ${hits.length}`);
  return hits[0];
}

/**
 * Whether one element of a fragment contains another, an element counting as
 * containing itself: a row IS its own region.
 *
 * @param {MarkupElement} outer
 * @param {MarkupElement} inner
 * @returns {boolean}
 */
const encloses = (outer, inner) =>
  outer.start <= inner.start && outer.start + outer.html.length >= inner.start + inner.html.length;
