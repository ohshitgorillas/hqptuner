// The curated preset table, swept: every write set Easy Mode's table can
// produce, and the filter vocabulary that sweep adds up to.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// It asks the shipped table — `presetsFor` for which presets a grid has and
// which knob positions each defines, `writeSet` for what every combination of
// those positions names — rather than restating any of it. A name typed out
// here would be a second copy of the table, drifting the first time the owner
// curates it.
//
// Its own module rather than part of tests/js/support/easytiles.js, because
// both a rendering suite and the pure store suite need it and that harness
// cannot be imported by the latter: it pulls in preact, EasyCard and the store
// signals, and `store/easyview.js` reads localStorage at import.

import { writeSet, presetsFor } from "../../../hqptuner/static/store/easy.js";

/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[] }} Preset */

/** @type {("album" | "playlist")[]} */
const GRIDS = ["album", "playlist"];

/**
 * Every combination of knob positions a preset defines, defaults included.
 *
 * @param {Knob[]} knobs
 * @returns {Record<string, string>[]}
 */
const combos = (knobs) =>
  knobs.reduce(
    (/** @type {Record<string, string>[]} */ acc, knob) =>
      acc.flatMap((one) => knob.options.map((option) => ({ ...one, [knob.id]: option }))),
    [{}],
  );

/**
 * Every write set one grid's table can produce, every knob position included.
 *
 * @param {string} grid
 * @returns {Record<string, string>[]}
 */
const writesFor = (grid) =>
  presetsFor(grid).flatMap((/** @type {Preset} */ preset) =>
    combos(preset.knobs).map((knobs) => writeSet(grid, preset.id, "auto", knobs)),
  );

/** Every write set the table can produce: both grids, every knob position. */
export const everyWrite = () => GRIDS.flatMap(writesFor);

/**
 * Every distinct filter name one grid's presets can write, across all four
 * schema keys and every knob combination — the whole vocabulary that grid can
 * put in front of the daemon.
 *
 * @param {string} grid
 * @returns {string[]}
 */
export const namesWritten = (grid) => [
  ...new Set(
    writesFor(grid)
      .flatMap((set) => Object.values(set))
      .filter(Boolean),
  ),
];
