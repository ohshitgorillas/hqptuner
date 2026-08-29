// The readers for the ERROR-CORRECTION MARK an Easy Mode preset tile carries,
// and the seam its facts are seeded over. The cases themselves are
// tests/js/components/easytiles-mark.test.js.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// It is imported DYNAMICALLY by that suite, after its `useStorage()` call, for
// the same reason tests/js/support/easytiles.js is: `store/easyview.js` reads
// localStorage at import, and this module pulls that harness in.
//
// Its own module rather than part of tests/js/support/easytiles.js, which is at
// the file-length gate's ceiling. It reaches a tile through that harness's
// `tileHtml`, so a mark is always read inside the tile it belongs to and never
// across the card.
//
// WHERE THE FACTS COME FROM. A filter's apodizing class is the union of the
// running engine's `arg` bitfield and the static overlay's `apodizing` fact
// ("full" | "half" | "none", data/filters.json served under
// /api/metadata's `filters.filters`) — the same join
// tests/js/components/combobox-apod.test.js drives the dropdown badges over.
// This module seeds the OVERLAY half, because that half is served on both lanes:
// the tabs fixture has no engine enumeration at all, and the LIVE fixture's
// enumeration carries no `arg`. A name absent from the overlay is a filter whose
// class NOTHING has stated, which is the "no facet metadata" case.
//
// NO COPY IS READ HERE (docs/testing.md rule 9). A mark is found by the
// `apod-mark` class it wears — the shared class the filter dropdowns' badge
// already wears — and one form is told from another by the vector geometry it
// draws, never by the wording of its accessible label. That a label EXISTS and
// that the three forms carry three DIFFERENT ones is a behavior; which words it
// is spelt with is the owner's.

import { metadata } from "../../../hqptuner/static/store/signals.js";
import { namesWritten } from "./easytable.js";
import { tileHtml } from "./easytiles.js";
import { elements, classes, attr, hasAttr } from "./markup.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

// The class the mark wears, shared with the filter dropdowns' badge. A class
// token is contract; the words inside the mark are not.
const MARK = "apod-mark";

// --- seeding the facts -----------------------------------------------------------

/**
 * Serve an apodizing class per filter NAME as the static overlay carries it,
 * leaving the rest of the metadata payload (the card's own `easy` copy) where
 * the harness put it. A fresh object every call: writing the same object
 * reference to a signal does not notify.
 *
 * @param {Record<string, string>} byName
 * @returns {void}
 */
export function seedFacets(byName) {
  const current = /** @type {Record<string, any>} */ (metadata.value || {});
  const filters = /** @type {Record<string, any>} */ (current.filters || {});
  metadata.value = /** @type {never} */ ({
    ...current,
    filters: {
      ...filters,
      aliases: filters.aliases || {},
      filters: Object.fromEntries(Object.entries(byName).map(([name, apodizing]) => [name, { apodizing }])),
    },
  });
}

/**
 * One apodizing class for EVERY filter name the curated table can write, at
 * every knob position — so whichever filter a tile would write, its class is
 * stated. The roster comes from the shipped table, never from a list typed out
 * here.
 *
 * @param {string} apodizing
 * @returns {Record<string, string>}
 */
export const uniformFacets = (apodizing) => Object.fromEntries(namesWritten().map((n) => [n, apodizing]));

/**
 * One apodizing class for the names given, and no fact at all about any other
 * filter.
 *
 * @param {string[]} names
 * @param {string} apodizing
 * @returns {Record<string, string>}
 */
export const facetsFor = (names, apodizing) => Object.fromEntries(names.map((n) => [n, apodizing]));

// --- reading a tile's mark --------------------------------------------------------

/**
 * @param {string} out
 * @param {string} presetId
 * @returns {MarkupElement[]}
 */
const marksIn = (out, presetId) => elements(tileHtml(out, presetId)).filter((el) => classes(el).includes(MARK));

/**
 * How many marks one tile renders. One is the contract; zero is what a tile
 * whose filter has no stated class renders.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {number}
 */
const markCount = (out, presetId) => marksIn(out, presetId).length;

/**
 * The mark count of every tile named, so "which tile went wrong" is part of the
 * reading rather than a number that could be any of them.
 *
 * @param {string} out
 * @param {string[]} presetIds
 * @returns {Record<string, number>}
 */
export const markCounts = (out, presetIds) => Object.fromEntries(presetIds.map((id) => [id, markCount(out, id)]));

/**
 * The one mark of a tile; anything but exactly one throws.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {MarkupElement}
 */
function onlyMark(out, presetId) {
  const found = marksIn(out, presetId);
  if (found.length !== 1) throw new Error(`expected one mark on the "${presetId}" tile, found ${found.length}`);
  return found[0];
}

/**
 * The vector geometry a tile's mark draws — what tells one form from another,
 * the way tests/js/components/combobox-apod.test.js tells the full badge from
 * the half one. Anything but exactly one path throws.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string | undefined}
 */
export function markGlyph(out, presetId) {
  const mark = onlyMark(out, presetId);
  const paths = elements(mark.html).filter((el) => el.name === "path");
  if (paths.length !== 1) throw new Error(`expected one path in the "${presetId}" mark, found ${paths.length}`);
  return attr(paths[0], "d");
}

/**
 * The accessible label a tile's mark carries — on the mark itself or on the one
 * element inside it that carries the attribute. The WORDS are never asserted:
 * what is read is that a label SAYS something and that the three forms do not
 * share one.
 *
 * An EMPTY label reads as the empty string rather than as a missing attribute,
 * because SSR emits an empty-string attribute bare (` aria-label`, never
 * `aria-label=""` — docs/testing.md, harness facts). A mark labelled with
 * nothing is a mark a screen reader announces as nothing, so it belongs in the
 * assertion as a value and not in the harness as a throw.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string}
 */
export function markLabel(out, presetId) {
  const mark = onlyMark(out, presetId);
  const carriers = elements(mark.html).filter((el) => hasAttr(el, "aria-label"));
  if (carriers.length !== 1)
    throw new Error(`expected one aria-label on the "${presetId}" mark, found ${carriers.length}`);
  return attr(carriers[0], "aria-label") ?? "";
}

/**
 * Where the mark sits in a tile's reading order: after the tile's title and
 * before its description.
 *
 * The title is located by the offset of the STAND-IN the calling suite seeded
 * through /api/metadata — the suite's own invented text, never a word of what
 * ships — and only where that text renders as visible content, so a title
 * repeated into an attribute anchors nothing. The description is located by its
 * first `data-para` block, the marking
 * tests/js/components/easytiles-desc.test.js already pins. A tile showing no
 * description throws rather than answering true with nothing on its far side.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} titleText
 * @returns {boolean}
 */
export function markFollowsTitleAndPrecedesDescription(out, presetId, titleText) {
  const fragment = tileHtml(out, presetId);
  const at = visibleTextAt(fragment, titleText);
  const paragraphs = elements(fragment).filter((el) => attr(el, "data-para") !== undefined);
  if (paragraphs.length === 0) throw new Error(`the "${presetId}" tile shows no description`);
  const first = Math.min(...paragraphs.map((el) => el.start));
  const mark = onlyMark(out, presetId).start;
  return mark > at && mark < first;
}

/**
 * Where a needle renders as VISIBLE text of a fragment — a match inside a tag's
 * attribute run is skipped. Throws when the fragment shows no such text, the way
 * tests/js/components/combobox-apod.test.js's reader of the same shape does.
 *
 * @param {string} fragment
 * @param {string} needle
 * @returns {number}
 */
function visibleTextAt(fragment, needle) {
  for (let at = fragment.indexOf(needle); at >= 0; at = fragment.indexOf(needle, at + 1)) {
    if (fragment.lastIndexOf(">", at) > fragment.lastIndexOf("<", at)) return at;
  }
  throw new Error(`"${needle}" is not visible text of the fragment`);
}
