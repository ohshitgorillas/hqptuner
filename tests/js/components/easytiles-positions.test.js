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
const { presetsFor } = await import("../../../hqptuner/static/store/easy.js");

// The tiles that carry a `material` knob, read from `presetsFor()` rather than
// named by hand: which presets carry which knobs is owner data (rule 9), and a
// preset that gained or lost the knob is swept in or out here without a hand
// edit. Preset ids and knob ids are wire identifiers, stated outright.

/** @type {Array<{ id: string, knobs: Array<{ id: string }> }>} */
const PRESETS = presetsFor();

const MATERIAL_TILES = PRESETS.filter((preset) => preset.knobs.some((knob) => String(knob.id) === "material")).map(
  (preset) => String(preset.id),
);

// Guard: a sweep over an empty list generates no cases and reads as green, so
// the sweep's own precondition is one pin.

test("test_at_least_one_preset_carries_a_material_knob", () => {
  assert.equal(MATERIAL_TILES.length > 0, true);
});

/** @param {string} presetId */
function declaredKnobIds(presetId) {
  const preset = PRESETS.find((candidate) => String(candidate.id) === presetId);
  return (preset ? preset.knobs : []).map((knob) => String(knob.id)).sort();
}

// ============================================================================
// the knobs each material tile carries
// ============================================================================
//
// Which knobs a tile carries is read as a set against the knobs its preset
// declares: a tile whose knob went missing, and a tile that laid out a knob its
// preset never declared, both fail here by naming what that tile laid out. The
// order the knobs are laid out in is the owner's (rule 9), so both sides are
// sorted before comparing.

for (const presetId of MATERIAL_TILES) {
  test(`test_the_${presetId}_tile_carries_the_knobs_its_preset_declares`, async () => {
    await resetTab({ mode: "pcm" });
    assert.deepEqual([...knobIds(tabs(), presetId)].sort(), declaredKnobIds(presetId));
  });

  // The knob's two positions, sorted rather than in the order they are laid out:
  // which order the owner shows them in is the owner's (rule 9), and what a case
  // can state is WHICH two exist.

  test(`test_the_${presetId}_material_knob_offers_a_lossless_and_a_lossy_position`, async () => {
    await resetTab({ mode: "pcm" });
    assert.deepEqual(knobOptions(tabs(), presetId, "material").sort(), ["lossless", "lossy"]);
  });
}

// ============================================================================
// and what the revision retired is gone from the WHOLE roster
// ============================================================================
//
// Swept over `presetsFor`, the card's own enumeration of which tiles it has,
// rather than over the two tiles that used to carry the Source knob: "there is
// no `source` knob and no `auto`, `standard` or `hires` position anywhere" is a
// claim about the card, and a tile named by hand cannot make it — a preset that
// grew either of them, or a new preset that arrived carrying one, would go
// unread. One case per tile, so a failure names the tile that kept it.

const ROSTER = presetsFor().map((/** @type {{ id: string }} */ preset) => String(preset.id));

// The positions the retired knob offered. Wire identifiers, stated outright.
const RETIRED_POSITIONS = ["auto", "standard", "hires"];

for (const presetId of ROSTER) {
  test(`test_the_${presetId}_tile_carries_no_source_knob`, async () => {
    await resetTab({ mode: "pcm" });
    assert.equal(knobIds(tabs(), presetId).includes("source"), false);
  });

  // Every position of every knob the tile carries, against the three the
  // retired knob offered: what comes back is the retired positions this tile
  // still lays out, so a failure names them rather than reading as a bare false.

  test(`test_no_knob_on_the_${presetId}_tile_offers_a_retired_source_position`, async () => {
    await resetTab({ mode: "pcm" });
    const out = tabs();
    const offered = knobIds(out, presetId).flatMap((knobId) => knobOptions(out, presetId, knobId));
    assert.deepEqual(
      offered.filter((position) => RETIRED_POSITIONS.includes(String(position))),
      [],
    );
  });
}
