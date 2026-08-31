// The readers for the GRAYING an Easy Mode preset tile carries while the card's
// material knob is off its default, and the table-side oracle that says which
// tiles should carry it. The cases themselves are
// tests/js/components/easytiles-material.test.js.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// It is imported DYNAMICALLY by that suite, after its `useStorage()` call, for
// the same reason tests/js/support/easytiles.js is: `store/easyview.js` reads
// localStorage at import, and this module pulls that harness in.
//
// WHERE THE ORACLE COMES FROM. Whether a tile grays is a fact about the preset's
// TABLE and the FACETS together: the tile grays when no combination of the
// preset's knob positions writes a filter whose facet says hi-res family. Both
// halves are public — `combos` × `writeSet` is the table's sweep, and
// `filterFacets` is the facet the narrowing store computes for a name — so the
// oracle below asks them rather than restating either. Which names ARE hi-res
// family is the facet's business and never decided here: a name the facet
// knows nothing about counts as not hi-res family, which is what makes the
// "no facet at all" case a not-grayed one.

import { writeSet } from "../../../hqptuner/static/store/easy.js";
import { filterFacets } from "../../../hqptuner/static/store/narrow/facets.js";
import { combos } from "./easytable.js";
import { presetIds, tileHtml } from "./easytiles.js";
import { elements, classes, attr, text } from "./markup.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */
/** @typedef {import("./easytiles.js").Preset} Preset */

// The class the tile BOX wears, the marking a grayed tile carries, and the
// markings the filter block is found by: hooks, none of them a word.
const TILE = "easy-tile";
const GRAYED = "data-grayed";
const FILTER = "easy-filter";
const RAW = "raw";

// --- the table-side oracle -----------------------------------------------------

/**
 * Every distinct filter name a preset can write in one output mode, across
 * every combination of its knob positions, the card knob's included.
 *
 * @param {Preset} preset
 * @param {string} mode
 * @returns {string[]}
 */
const namesOf = (preset, mode) => [
  ...new Set(
    combos(preset.knobs)
      .flatMap((knobs) => Object.values(writeSet(preset.id, mode, knobs)))
      .filter(Boolean),
  ),
];

/**
 * Whether the facet the store holds for a name says hi-res family. A name it
 * holds no facet for answers false.
 *
 * @param {string} name
 * @returns {boolean}
 */
export const hiresFamily = (name) => filterFacets.value[name]?.hiresFamily === true;

/**
 * Whether a preset writes a hi-res-family filter at SOME combination of its
 * knob positions in one output mode.
 *
 * @param {Preset} preset
 * @param {string} mode
 * @returns {boolean}
 */
export const writesHiresFamily = (preset, mode) => namesOf(preset, mode).some(hiresFamily);

/**
 * Whether the store holds NO facet for any name a preset writes in one output
 * mode: the arrangement the "no facet at all" case is about.
 *
 * @param {Preset} preset
 * @param {string} mode
 * @returns {boolean}
 */
export const facetless = (preset, mode) =>
  namesOf(preset, mode).every((name) => filterFacets.value[name] === undefined);

// --- reading a tile ---------------------------------------------------------------

/**
 * One tile's BOX: the `.easy-tile` carrying that preset's marking. Anything but
 * exactly one throws, so a card that lost a tile, or drew the marking twice,
 * fails by name rather than by an attribute that is quietly nowhere.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {MarkupElement}
 */
function box(out, presetId) {
  const hits = elements(out).filter((el) => classes(el).includes(TILE) && attr(el, "data-preset") === presetId);
  if (hits.length !== 1)
    throw new Error(`expected one .${TILE} box for the "${presetId}" preset, found ${hits.length}`);
  return hits[0];
}

/**
 * The `data-grayed` one tile's box carries, or undefined when it carries none.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string | undefined}
 */
export const grayed = (out, presetId) => attr(box(out, presetId), GRAYED);

/**
 * Every tile the card laid out, against the `data-grayed` its box carries. The
 * whole map rather than the grayed ids alone, so "none is grayed" is a map of
 * undefineds that names every tile rather than an empty list that reads the
 * same as "nothing rendered".
 *
 * @param {string} out
 * @returns {Record<string, string | undefined>}
 */
export const grayMap = (out) => Object.fromEntries(presetIds(out).map((id) => [id, grayed(out, id)]));

/**
 * The map every tile of a rendering would carry were none grayed.
 *
 * @param {string} out
 * @returns {Record<string, undefined>}
 */
export const noneGrayed = (out) => Object.fromEntries(presetIds(out).map((id) => [id, undefined]));

/**
 * The engine filter name one tile displays: the text of the `raw` part of its
 * filter block. A tile showing no block, or no raw part, throws rather than
 * answering "", so "displays nothing" never reads as "displays a name whose
 * facet is not hi-res family".
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string}
 */
export function rawName(out, presetId) {
  const blocks = elements(tileHtml(out, presetId)).filter((el) => attr(el, "data-testid") === FILTER);
  if (blocks.length === 0) throw new Error(`the "${presetId}" tile shows no filter block`);
  const outer = blocks.reduce((a, b) => (a.start <= b.start ? a : b));
  const raws = elements(outer.html).filter((el) => attr(el, "data-part") === RAW);
  if (raws.length === 0) throw new Error(`the "${presetId}" tile's filter block carries no raw name`);
  return text(raws.reduce((a, b) => (a.start <= b.start ? a : b)));
}
