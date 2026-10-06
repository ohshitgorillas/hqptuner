// The readers for the GRAYING an Easy Mode preset tile carries while the card's
// material knob is off its default, and the table-side oracle that says which
// tiles should carry it. The cases themselves are
// tests/js/components/easytiles-material.test.js.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// It is imported DYNAMICALLY by that suite, after its `useStorage()` call, for
// the same reason tests/js/support/easy/easytiles.js is: `store/easy/easyview.js` reads
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

import { writeSet } from "../../../../hqptuner/static/store/easy/easy.js";
import { filterFacets } from "../../../../hqptuner/static/store/narrow/facets.js";
import { combos } from "./easytable.js";

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("./easytiles.js").Preset} Preset */

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
const hiresFamily = (name) => filterFacets.value[name]?.hiresFamily === true;

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

// --- the buttons a grayed tile takes away ---------------------------------------------
//
// A grayed tile disables what it offers a pointer: its preset button and every
// option button of every knob row it renders. Disabled is the `disabled`
// attribute on the button, which SSR emits BARE (` disabled`, never
// `disabled=""`), so presence is read with `hasAttr` rather than by value.
