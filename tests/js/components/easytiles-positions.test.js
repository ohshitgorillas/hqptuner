// Behavioral suite for what Easy Mode's tiles OFFER: which knobs a tile carries
// at all, in which order, and the positions each of them lays out.
//
// The companion files are tests/js/components/easytiles.test.js (the tiles, the
// active marking and where a press routes what the table names) and
// tests/js/components/easytiles-knobs.test.js (which position a tile's knob
// MARKS). What a knob offers is a different reading from what it marks, and it
// is the one a knob that gained a position, or a tile that gained a knob, is
// observable as — so it has its own reader,
// tests/js/support/easyknobs.js, and its own file.
//
// All of these share tests/js/support/easytiles.js, imported dynamically after
// `useStorage()` so that `store/easyview.js` meets the fake localStorage at its
// load-time read.
//
// NAMES, NOT WORDS (docs/testing.md rule 9). A knob is read by its `data-knob`
// and its positions by the `data-v` each option carries — the wire identifiers
// `writeSet` speaks, not the words printed on the buttons. No title, description
// or label is asserted anywhere in this file, and none is needed: Damage
// Control's `material` knob ships no copy at all yet, and its two positions are
// still wire identifiers that can be read.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-positions.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs } = await import("../support/easytiles.js");
const { knobOptions, knobIds } = await import("../support/easyknobs.js");

// The three tiles that carry a `material` knob — the two flagships, which gained
// it in place of the Source knob the revision retired, and Damage Control, which
// gained it in place of the retired `lossy` tile. Preset ids and knob ids are
// wire identifiers, stated outright.
const MATERIAL_TILES = ["perfect-ten", "lifelike", "damage-control"];

// ============================================================================
// the two knobs each material tile carries
// ============================================================================
//
// Which knobs a tile carries AND the order it lays them out are one reading: a
// tile whose second knob went missing and a tile that put it first are both
// wrong, and both fail here by naming what that tile laid out. The order is the
// spec's own — `emphasis` then `material` — and not a display detail this file
// invented.

for (const presetId of MATERIAL_TILES) {
  test(`test_the_${presetId}_tile_carries_the_emphasis_knob_then_the_material_knob`, async () => {
    await resetTab({ mode: "pcm" });
    assert.deepEqual(knobIds(tabs(), presetId), ["emphasis", "material"]);
  });

  // The knob's two positions, sorted rather than in the order they are laid out:
  // which order the owner shows them in is the owner's (rule 9), and what a case
  // can state is WHICH two exist.

  test(`test_the_${presetId}_material_knob_offers_a_lossless_and_a_lossy_position`, async () => {
    await resetTab({ mode: "pcm" });
    assert.deepEqual(knobOptions(tabs(), presetId, "material").sort(), ["lossless", "lossy"]);
  });
}

// And the knob the revision retired outright. No tile carries a `source` knob
// any more, so the reader that finds one by its `data-knob` finds none — it
// throws where the knob is absent, which is what this reads.

for (const presetId of ["perfect-ten", "lifelike"]) {
  test(`test_the_${presetId}_tile_carries_no_source_knob`, async () => {
    await resetTab({ mode: "pcm" });
    assert.equal(knobIds(tabs(), presetId).includes("source"), false);
  });
}
