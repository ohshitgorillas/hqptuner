// Behavioral suite for the PIP GROUP an Easy Mode preset tile carries: the row
// of marks standing for what that preset costs the machine. How many pips each
// preset costs is `pipsFor`'s to say and is pinned in
// tests/js/store/easy-pips.test.js; what is read here is that a tile DRAWS that
// many, that the group stands in the same row as the apodizing mark, and that a
// reader meets it by a name.
//
// The companion files are tests/js/components/easytiles.test.js (the tiles, the
// active marking and where a press routes what the table names) and
// tests/js/components/easytiles-mark.test.js (the apodizing mark itself). All
// share tests/js/support/easytiles.js, imported dynamically after `useStorage()`
// so that `store/easyview.js` meets the fake localStorage at its load-time read;
// the pip readers are tests/js/support/easypips.js.
//
// THE COUNTS ARE STATED OUTRIGHT, never read back out of `pipsFor`. Deriving
// them would only ask the card to agree with the module it draws from, and would
// pass on a card and a table that are wrong together. They are the same numbers
// tests/js/store/easy-pips.test.js states, on purpose: one is the table, the
// other is the drawing.
//
// HOOKS THIS SUITE REQUIRES the implementation to provide:
//   * `data-testid="easy-pips"` on the pip group, one per tile
//   * `data-pip` on each pip inside it
//   * an accessible name on the group — an `aria-label` with something in it, or
//     an `aria-labelledby` pointing at an element that says something
//
// NOTHING HERE READS COPY (docs/testing.md rule 9). The group's name is read for
// EXISTING and never for what it says, and no title, description, label or hint
// is asserted anywhere in this file.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easypips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs } = await import("../support/easytiles.js");
const { pipCount, pipsAreNamed, pipsShareTheMarksRow } = await import("../support/easypips.js");
const { seedFacets, uniformFacets } = await import("../support/easymark.js");

// preset, SDM count, PCM count — the owner's table, stated the way the store
// suite states it. Preset ids are wire identifiers.
/** @type {[string, number, number][]} */
const COSTS = [
  ["perfect-ten", 2, 1],
  ["lifelike", 2, 1],
  ["purist", 2, 1],
  ["old-school", 1, 1],
  ["damage-control", 1, 3],
  ["concert-hall", 13, 6],
];

// The tile the row and the naming are read on. `concert-hall` because it is the
// costliest, so a group drawn empty and a group drawn once are both a long way
// from what it must show.
const TILE = "concert-hall";

// ============================================================================
// a tile draws as many pips as its preset costs
// ============================================================================
//
// One case per preset per output mode, so a tile that drew the wrong number
// fails by naming the tile and the chain rather than by a count that could
// belong to any of the twelve.

for (const [presetId, , pcm] of COSTS) {
  test(`test_the_${presetId}_tile_draws_${pcm}_pips_in_the_pcm_output_mode`, async () => {
    await resetTab({ mode: "pcm" });
    assert.equal(pipCount(tabs(), presetId), pcm);
  });
}

for (const [presetId, sdm] of COSTS) {
  test(`test_the_${presetId}_tile_draws_${sdm}_pips_in_the_sdm_output_mode`, async () => {
    await resetTab({ mode: "sdm" });
    assert.equal(pipCount(tabs(), presetId), sdm);
  });
}

// The auto output mode shows the PCM number. One tile carries it, and it is the
// one whose two numbers are furthest apart: a card showing the SDM count under
// "auto" draws thirteen where six belong.

test("test_a_tile_draws_its_pcm_pips_in_the_auto_output_mode", async () => {
  await resetTab({ mode: "auto" });
  assert.equal(pipCount(tabs(), TILE), 6);
});

// ============================================================================
// where the group stands, and how a reader meets it
// ============================================================================
//
// The row is read with the apodizing mark present, which is what the seeded
// overlay is for: a class is stated for every filter the table can write, so
// whichever filter the tile is showing, it has a mark to stand beside. A tile
// with no mark makes the reader throw rather than answer.

test("test_the_pip_group_stands_in_the_same_row_as_the_apodizing_mark", async () => {
  await resetTab({ mode: "pcm" });
  seedFacets(uniformFacets("full"));
  assert.equal(pipsShareTheMarksRow(tabs(), TILE), true);
});

// A group announced as nothing is a row of marks a reader is told nothing about.
// What it SAYS is the owner's and is asserted nowhere.

test("test_the_pip_group_carries_an_accessible_name", async () => {
  await resetTab({ mode: "pcm" });
  assert.equal(pipsAreNamed(tabs(), TILE), true);
});
