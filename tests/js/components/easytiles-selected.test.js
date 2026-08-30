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
  TILE,
  PICK,
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

// The preset the ENGINE is left running: `concert-hall`, at the `version`
// position its knob does NOT rest on, so that what the running tile shows is
// distinguishable from what an unmatched tile shows. `PICK.fallback` is the
// resting position, which is what a tile the grid has not matched falls back to.
const ENGINE = { preset: PICK.preset, knob: PICK.knob, position: PICK.option };

/**
 * The Output tab with `ENGINE`'s filters in the daemon's form and a different
 * preset staged on top of them. The filter names are the table's own, read back
 * through `running`.
 *
 * @returns {Promise<string>} the card, rendered after the press has settled
 */
async function staged() {
  const set = running(ENGINE.preset, { [ENGINE.knob]: ENGINE.position });
  const w = await resetTab({ mode: "pcm", names: seedPcmPair(set.oneX, set.nX) });
  pressTile(seenTabs(), TILE);
  await flush(w);
  return tabs();
}

// ============================================================================
// the two markings, once they have come apart
// ============================================================================

test("test_the_active_marking_stays_on_the_running_preset_while_another_is_staged", async () => {
  assert.deepEqual(activeMap(await staged()), oneLit(ENGINE.preset));
});

test("test_the_selected_marking_moves_to_the_staged_preset", async () => {
  assert.deepEqual(selectedMap(await staged()), oneLit(TILE));
});

// A tile that is ACTIVE but not SELECTED is still showing the engine: its knob
// stands where the running filters put it, not on the position it rests at when
// the grid has matched it to nothing.

test("test_an_active_but_unselected_tiles_knob_shows_the_position_the_engine_is_running", async () => {
  assert.deepEqual(knobPositions(await staged(), ENGINE.preset, ENGINE.knob), [ENGINE.position]);
});
