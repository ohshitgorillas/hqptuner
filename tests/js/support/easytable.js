// The curated preset table, swept: every write set Easy Mode's table can
// produce, and the filter vocabulary that sweep adds up to.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// It asks the shipped table — `presetsFor` for which presets the card has and
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

/**
 * Every combination of knob positions a preset defines, defaults included.
 *
 * @param {Knob[]} knobs
 * @returns {Record<string, string>[]}
 */
export const combos = (knobs) =>
  knobs.reduce(
    (/** @type {Record<string, string>[]} */ acc, knob) =>
      acc.flatMap((one) => knob.options.map((option) => ({ ...one, [knob.id]: option }))),
    [{}],
  );

/** Every write set the table can produce, every knob position included. */
export const everyWrite = () =>
  presetsFor().flatMap((/** @type {Preset} */ preset) =>
    combos(preset.knobs).map((knobs) => writeSet(preset.id, "auto", knobs)),
  );

/**
 * Every distinct filter name the card's presets can write, across all four
 * schema keys and every knob combination — the whole vocabulary Easy Mode can
 * put in front of the daemon.
 *
 * @returns {string[]}
 */
export const namesWritten = () => [
  ...new Set(
    everyWrite()
      .flatMap((set) => Object.values(set))
      .filter(Boolean),
  ),
];
