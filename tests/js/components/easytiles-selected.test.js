// Behavioral suite for the two independent markings Easy Mode's preset tiles
// carry on the Output tab: SELECTED, the preset the grid has picked, and
// ACTIVE, the preset the engine is actually running.
//
// The whole subject is the one page where the two can differ. A write on the
// Output tab STAGES into the pending buffer rather than reaching the engine
// (docs/architecture.md, "Two write paths"), so between the press and the Apply
// there is a staged preset AND a running one, and each gets its own marking.
// On the LIVE lane a write goes straight through and never stages, so the two
// always coincide there and the existing cases in
// tests/js/components/easytiles.test.js already cover that lane unchanged.
//
// The setup every case here shares is one and the same: the daemon's config
// form seeded with the filters ONE preset writes — that is what the engine is
// running — and then a DIFFERENT preset pressed, which stages. Both halves come
// from the shipped table through `running` and `pressTile`, never from a filter
// name typed out beside it.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The lane is driven by the exported store signals with the shapes
// /api/config, /api/state and /api/enumerations serve, and the press leaves over
// a faked `globalThis.fetch` on the real REST path. No store function is
// stubbed, and no user-facing word is asserted or selected on (rule 9) — a tile
// is found by its `data-preset`, a knob by its `data-knob`, a knob position by
// the `data-v` its option button carries.
//
// THE RENDERED CONTRACT: each tile box carries `data-active="0"|"1"` and
// `data-selected="0"|"1"`, both on every tile.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-selected.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const {
  ROSTER,
  resetTab,
  running,
  oneLit,
  flush,
  tabs,
  seenTabs,
  seedPcmPair,
  activeMap,
  selectedMap,
  knobPositions,
  pressTile,
} = await import("../support/easytiles.js");
const { presetsFor, knobsShown } = await import("../../../hqptuner/static/store/easy.js");

/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[] }} Preset */
/**
 * The preset the ENGINE is left running, one of its knobs, the position that
 * knob does NOT rest on that the engine is running it at, and a DIFFERENT
 * preset to stage on top.
 * @typedef {{ preset: string, knob: string, position: string, pressed: string }} Engine
 */

/**
 * Every knob of one preset at its `default`: the positions a tile rests at.
 *
 * @param {Preset} preset
 * @returns {Record<string, string>}
 */
const resting = (preset) => Object.fromEntries(preset.knobs.map((knob) => [String(knob.id), knob.default]));

// Every state the engine can be left in that the cases below can tell apart
// from an unmatched tile, swept from the shipped table: each preset, each knob
// its tile OFFERS at rest (read through `knobsShown()`, so a knob whose `when`
// hides it at the resting positions is not expected of the tile), each
// position off that knob's default (a tile the grid has matched to nothing
// falls back to the resting position, so a running position that IS the
// resting one would show nothing distinguishable). Each is paired with the
// first tile in the roster that is not the running one, which is what gets
// staged. No preset is named to stand for the property; zero matches, or a
// roster of one tile, generates no case.
/** @type {Engine[]} */
const ENGINES = /** @type {Preset[]} */ (presetsFor()).flatMap((preset) =>
  /** @type {Knob[]} */ (knobsShown(preset, resting(preset))).flatMap((knob) =>
    knob.options
      .filter((option) => option !== knob.default)
      .flatMap((position) =>
        ROSTER.filter((id) => id !== String(preset.id))
          .slice(0, 1)
          .map((pressed) => ({ preset: String(preset.id), knob: String(knob.id), position, pressed })),
      ),
  ),
);

/**
 * The Output tab with one `Engine`'s filters in the daemon's form and its
 * `pressed` preset staged on top of them. The filter names are the table's
 * own, read back through `running`.
 *
 * @param {Engine} engine
 * @returns {Promise<string>} the card, rendered after the press has settled
 */
async function staged(engine) {
  const set = running(engine.preset, { [engine.knob]: engine.position });
  const w = await resetTab({ mode: "pcm", names: seedPcmPair(set.oneX, set.nX) });
  pressTile(seenTabs(), engine.pressed);
  await flush(w);
  return tabs();
}

// ============================================================================
// the two markings, once they have come apart
// ============================================================================

for (const engine of ENGINES) {
  const at = `${engine.preset}_at_${engine.knob}_${engine.position}`;

  test(`test_the_active_marking_stays_on_the_running_${at}_while_another_is_staged`, async () => {
    assert.deepEqual(activeMap(await staged(engine)), oneLit(engine.preset));
  });

  test(`test_the_selected_marking_moves_to_the_preset_staged_over_the_running_${at}`, async () => {
    assert.deepEqual(selectedMap(await staged(engine)), oneLit(engine.pressed));
  });

  // A tile that is ACTIVE but not SELECTED is still showing the engine: its
  // knob stands where the running filters put it, not on the position it rests
  // at when the grid has matched it to nothing.

  test(`test_the_active_but_unselected_${at}_tiles_knob_shows_the_position_the_engine_is_running`, async () => {
    assert.deepEqual(knobPositions(await staged(engine), engine.preset, engine.knob), [engine.position]);
  });
}
