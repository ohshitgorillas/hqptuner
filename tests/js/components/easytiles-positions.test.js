// Behavioral suite for the positions Easy Mode's tiles OFFER, and for how many
// tiles the playlist grid lays out.
//
// The companion files are tests/js/components/easytiles.test.js (the grids, the
// active marking and where a press routes what the table names) and
// tests/js/components/easytiles-knobs.test.js (which position a tile's knob
// MARKS). What a knob offers is a different reading from what it marks, and it
// is the one a knob that gained a third position, or a grid that gained a third
// tile, is observable as — so it has its own reader,
// tests/js/support/easyknobs.js, and its own file.
//
// All of these share tests/js/support/easytiles.js, imported dynamically after
// `useStorage()` so that `store/easyview.js` meets the fake localStorage at its
// load-time read.
//
// NAMES, NOT WORDS (docs/testing.md rule 9). A knob's positions are read by the
// `data-v` each option carries — the wire identifier `writeSet` speaks, not the
// word printed on the button. No title, description or label is asserted
// anywhere in this file.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-positions.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs, cells } = await import("../support/easytiles.js");
const { knobOptions } = await import("../support/easyknobs.js");

// The album tile whose Source knob is read, and the playlist tile the grid
// gained. Preset ids and knob ids are wire identifiers, stated outright.
const ALBUM_TILE = "perfect-ten";
const LOSSY_TILE = "lossy";

// ============================================================================
// the Source knob's three positions
// ============================================================================
//
// The count and the order are read separately: a knob that offers three
// positions in the wrong order is a different defect from one that offers two,
// and the count is what stays green while the owner rearranges nothing.

test("test_the_source_knob_offers_three_positions", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  assert.equal(knobOptions(tabs(), ALBUM_TILE, "source").length, 3);
});

test("test_the_source_knob_lays_its_positions_out_with_auto_first_then_standard_then_hires", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  assert.deepEqual(knobOptions(tabs(), ALBUM_TILE, "source"), ["auto", "standard", "hires"]);
});

// ============================================================================
// the playlist grid's third tile
// ============================================================================

test("test_the_playlist_grid_lays_out_three_tiles", async () => {
  await resetTab({ grid: "playlist", mode: "pcm" });
  assert.equal(cells(tabs()), 3);
});

test("test_the_lossy_tile_offers_two_emphasis_positions", async () => {
  await resetTab({ grid: "playlist", mode: "pcm" });
  assert.equal(knobOptions(tabs(), LOSSY_TILE, "emphasis").length, 2);
});
