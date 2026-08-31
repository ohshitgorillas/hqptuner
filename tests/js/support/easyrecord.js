// Putting a preset's knob positions on record, the way a user leaves them: a
// TILE knob's position through `rememberKnobs`, the record a dark tile reads its
// knobs back from, and the CARD knob's through `setEasyMaterial`, the one
// control on the card body. Which knob is which is the table's declaration
// (`card` on the knob), never a knob id typed here.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// It is imported DYNAMICALLY by the suites that use it, after their
// `useStorage()` call: `store/easyview.js` reads localStorage at import.

import { rememberKnobs, setEasyMaterial } from "../../../hqptuner/static/store/easyview.js";
import { presetsFor } from "../../../hqptuner/static/store/easy.js";

/** @typedef {import("./easytiles.js").Knob} Knob */
/** @typedef {import("./easytiles.js").Preset} Preset */

// The ids of the knobs the table declares as the card's.
const CARD_KNOBS = new Set(
  /** @type {Preset[]} */ (presetsFor())
    .flatMap((preset) => preset.knobs)
    .filter((knob) => knob.card)
    .map((knob) => String(knob.id)),
);

/**
 * Put a preset on a set of knob positions: the card knob's position is set on
 * the card, every other knob's is recorded for the tile.
 *
 * @param {string} presetId
 * @param {Record<string, string>} positions
 * @returns {void}
 */
export function recordPositions(presetId, positions) {
  /** @type {Record<string, string>} */
  const tile = {};
  for (const [knobId, option] of Object.entries(positions)) {
    if (CARD_KNOBS.has(knobId)) setEasyMaterial(String(option));
    else tile[knobId] = option;
  }
  rememberKnobs(presetId, tile);
}
