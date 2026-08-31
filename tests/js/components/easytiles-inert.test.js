// Behavioral suite for the two ways an Easy Mode tile meets a knob position it
// cannot honour, and what the tile does instead of dropping the row.
//
// A knob carrying `when` is offered only where its siblings stand where the
// `when` names. Where they do not, the knob is still a row on the tile — shown
// inert rather than taken away, so the row a user learned is where they left it
// — and its control refuses a pointer while the sibling that gates it keeps
// taking one, which is what leaves the user a way back. The disabled case
// therefore reads BOTH knobs: a tile that dulled every row would honour the
// gated knob's half and still strand the user. `knobsShown()` is unchanged by
// this and still leaves such a knob out; what a tile RENDERS is the subject
// here, so every case reads the rendered card.
//
// The other way is a record holding a position the knob does not offer: the
// tile marks that knob's `default` instead.
//
// Shares tests/js/support/easytiles.js with the rest of the tile suites,
// imported dynamically after `useStorage()` so that `store/easyview.js` meets
// the fake localStorage at its load-time read.
//
// PROPERTIES, NOT EXEMPLARS. No preset is named to stand for a kind of tile.
// The gated-knob cases sweep every preset declaring a knob with a `when`, and
// drive one sibling the `when` names to a position it does not name. The record
// case takes the FIRST tile knob offering more than one position, selected off
// the table by that property rather than named: the fallback to a knob's
// `default` is one path that does not vary by preset, so a second case would
// exercise the same path again. A roster with no preset of a kind generates no
// case.
//
// NAMES, NOT WORDS (rule 9). Preset ids, knob ids and knob position ids are
// wire identifiers and are stated outright. Nothing here reads a label, a title
// or any other piece of owner copy.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-inert.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs, knobPositions, offeredAnySource } = await import("../support/easytiles.js");

const { knobPresent, knobIsDisabled } = await import("../support/easyknobs.js");

const { rememberKnobs } = await import("../../../hqptuner/static/store/easyview.js");
const { presetsFor, knobsShown } = await import("../../../hqptuner/static/store/easy.js");

/** @typedef {{ id: string, default: string, options: string[], when?: Record<string, string>, whenHires?: boolean, card?: boolean }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[] }} Preset */

/** @type {Preset[]} */
const PRESETS = presetsFor();

/**
 * Every knob of a preset's tile at its `default`: where the tile rests until
 * something moves it. The card's own knob is a row on no tile and is left out,
 * as the tile suites leave it out.
 *
 * @param {Preset} preset
 * @returns {Record<string, string>}
 */
const restingOf = (preset) =>
  Object.fromEntries(preset.knobs.filter((knob) => !knob.card).map((knob) => [String(knob.id), knob.default]));

/** Whether a knob is a row on the tile at all. */
const isTileKnob = (/** @type {Knob} */ knob) => offeredAnySource(knob);

/**
 * Whether a combination leaves a knob off the tile's OFFER as `knobsShown`
 * reads it — which is the state the gated cases put the tile in.
 *
 * @param {Preset} preset
 * @param {Record<string, string>} combo
 * @param {string} knobId
 * @returns {boolean}
 */
const hiddenAt = (preset, combo, knobId) => !knobsShown(preset, combo).some((knob) => String(knob.id) === knobId);

// --- the gated knobs, and a sibling parked where the gate does not name --------------
//
// For every preset, every tile knob carrying a `when`, every sibling that
// `when` names, and every position that sibling offers OTHER than the one named:
// the resting row with that sibling moved there. Only combinations that really
// take the gated knob off `knobsShown` generate a case, and only where the
// sibling itself is still a row there — a combination the tile cannot stand at
// says nothing about a knob it gates.

/** @type {{ presetId: string, knobId: string, sibId: string, at: string, combo: Record<string, string> }[]} */
const GATED = PRESETS.flatMap((preset) =>
  preset.knobs.filter(isTileKnob).flatMap((knob) =>
    Object.entries(knob.when || {}).flatMap(([sibId, named]) => {
      const sibling = preset.knobs.find((other) => String(other.id) === String(sibId));
      if (sibling === undefined) return [];
      return sibling.options
        .map(String)
        .filter((position) => position !== String(named))
        .map((position) => ({
          presetId: String(preset.id),
          knobId: String(knob.id),
          sibId: String(sibId),
          at: position,
          combo: { ...restingOf(preset), [String(sibId)]: position },
        }))
        .filter(
          (candidate) =>
            hiddenAt(preset, candidate.combo, candidate.knobId) && !hiddenAt(preset, candidate.combo, candidate.sibId),
        );
    }),
  ),
);

// ============================================================================
// a knob its `when` does not name is still on the tile, and refuses a pointer
// ============================================================================
//
// The tile is dark and stands where the record puts it, so the combination
// under test is the one the user last left, not one the four filter fields
// happen to carry.

for (const { presetId, knobId, sibId, at, combo } of GATED) {
  test(`test_the_${presetId}_${knobId}_knob_is_on_the_tile_while_its_${sibId}_sibling_stands_at_${at}`, async () => {
    await resetTab({ mode: "pcm" });
    rememberKnobs(presetId, combo);
    assert.equal(knobPresent(tabs(), presetId, knobId), true);
  });

  test(`test_the_${presetId}_${knobId}_knob_is_disabled_while_its_${sibId}_sibling_standing_at_${at}_stays_live`, async () => {
    await resetTab({ mode: "pcm" });
    rememberKnobs(presetId, combo);
    const out = tabs();
    assert.deepEqual([knobIsDisabled(out, presetId, knobId), knobIsDisabled(out, presetId, sibId)], [true, false]);
  });
}

// --- a record holding a position the knob does not offer -----------------------------
//
// The stored position is built out of the knob's own option list, so it cannot
// coincide with a position the owner later adds. The knob is one the tile
// offers at its resting row, so what is under test is the unoffered POSITION and
// not a knob its `when` also gates.

/** @type {{ presetId: string, knobId: string, fallback: string, record: Record<string, string> }[]} */
const QUALIFYING = PRESETS.flatMap((preset) =>
  preset.knobs
    .filter(isTileKnob)
    .filter((knob) => knob.options.length > 1)
    .filter((knob) => !hiddenAt(preset, restingOf(preset), String(knob.id)))
    .map((knob) => {
      const bogus = `not-${knob.options.map(String).join("-")}`;
      return {
        presetId: String(preset.id),
        knobId: String(knob.id),
        fallback: String(knob.default),
        record: { ...restingOf(preset), [String(knob.id)]: bogus },
      };
    }),
);

// ============================================================================
// an unoffered recorded position falls back to the knob's default
// ============================================================================

for (const { presetId, knobId, fallback, record } of QUALIFYING.slice(0, 1)) {
  test(`test_a_dark_${presetId}_tile_marks_the_${knobId}_default_when_its_record_holds_a_position_that_knob_does_not_offer`, async () => {
    await resetTab({ mode: "pcm" });
    rememberKnobs(presetId, record);
    assert.deepEqual(knobPositions(tabs(), presetId, knobId), [fallback]);
  });
}
