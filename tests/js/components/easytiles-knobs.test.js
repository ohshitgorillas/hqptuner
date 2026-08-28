// Behavioral suite for what a DARK Easy Mode tile shows on its knobs: the
// positions last recorded for that preset in that grid, rather than the knob's
// hardcoded default. Recording happens where the positions are written — a knob
// moved, or the tile pressed — and the record is read back through
// `store/easyview.js`'s `knobsFor`.
//
// The companion file is tests/js/components/easytiles.test.js, which owns the
// grids, the active marking and where a press routes what the table names. Only
// the knob-memory half lives here, and it reuses that file's harness whole:
// tests/js/support/easytiles.js, imported dynamically after `useStorage()` so
// that `store/easyview.js` meets the fake localStorage at its load-time read.
// The store's OWN behavior — reading back, per-grid and per-preset separation,
// surviving a reload — is tests/js/store/easyview.test.js's.
//
// WHAT IS RESET. The record is a module-level signal and outlives a case, so
// `resetTab` and `resetLive` clear it along with every other signal either lane
// reads — a press made by one case is otherwise still recorded when the next one
// renders. Every case here therefore records AFTER its reset, never before. The
// two cross-lane cases at the foot of the file are the exception and ask for
// `keepKnobs`: there the reset is standing in for a user changing lanes, which
// the record is meant to cross.
//
// WHAT IS NOT PINNED. The shape of the record is not read. How a grid and a
// preset are spelt into one key, and how a knob map is nested under it, is the
// writer's business — the record is only ever reached through `rememberKnobs`
// and `knobsFor`, exactly as a caller reaches it.
//
// NAMES, NOT WORDS (rule 9). Preset ids, knob ids, knob option ids and filter
// names are wire identifiers and are stated outright; nothing here asserts a
// title, a description or any other piece of owner copy.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-knobs.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, resetLive, seedPcm, flush, tabs, liveCard, seenTabs, seenLive, knobPositions, pressTile, pressKnob } =
  await import("../support/easytiles.js");

const { rememberKnobs, knobsFor } = await import("../../../hqptuner/static/store/easyview.js");

// The two presets that carry both knobs. `lifelike` is the one moved and read
// back; `perfect-ten` is the one whose record must not follow it.
const TWO_KNOB = "lifelike";
const OTHER = "perfect-ten";

// The tile pressed to take the light off whichever tile a case just wrote.
const ELSEWHERE = "concert-hall";

// `perfect-ten`'s standard-source, space-emphasis filter — what an untouched
// press of that tile writes, so a field carrying it lights that tile with both
// knobs at their defaults. Stated outright, as tests/js/components/easytiles.test.js
// states it: a filter name is a wire identifier.
const PERFECT_TEN_STANDARD_SPACE = "poly-sinc-gauss-long";

// The defaults every knob starts from, and the positions this file moves to.
const DEFAULTS = { source: "standard", emphasis: "space" };
const MOVED_SOURCE = "hires";
const MOVED_EMPHASIS = "transients";

// ============================================================================
// a tile that is not lit shows what was recorded for it
// ============================================================================

test("test_a_dark_tile_shows_the_source_position_last_recorded_for_it", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  rememberKnobs("album", TWO_KNOB, { source: MOVED_SOURCE, emphasis: DEFAULTS.emphasis });
  assert.deepEqual(knobPositions(tabs(), TWO_KNOB, "source"), [MOVED_SOURCE]);
});

test("test_a_dark_tile_shows_the_emphasis_position_last_recorded_for_it", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  rememberKnobs("album", TWO_KNOB, { source: DEFAULTS.source, emphasis: MOVED_EMPHASIS });
  assert.deepEqual(knobPositions(tabs(), TWO_KNOB, "emphasis"), [MOVED_EMPHASIS]);
});

// One knob recorded, its neighbour not. Both are read in the one assertion,
// because "the recorded one moved" and "the unrecorded one did not" are halves
// of a single claim about a partial record: a tile that dragged its whole knob
// row along with the one recorded position fails here in place.
test("test_a_dark_tiles_unrecorded_knob_stays_at_its_default_while_its_neighbour_shows_its_record", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  rememberKnobs("album", TWO_KNOB, { emphasis: MOVED_EMPHASIS });
  const out = tabs();
  assert.deepEqual(
    [knobPositions(out, TWO_KNOB, "source"), knobPositions(out, TWO_KNOB, "emphasis")],
    [[DEFAULTS.source], [MOVED_EMPHASIS]],
  );
});

// A record belongs to the tile it was made for. Nothing is recorded for
// `lifelike` here, so both its knobs read their defaults while `perfect-ten`
// carries a full record — the state Easy Mode was already in before tiles
// remembered anything, and a guard rather than a new claim.
test("test_a_dark_tile_shows_its_defaults_while_only_another_tiles_positions_are_recorded", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  rememberKnobs("album", OTHER, { source: MOVED_SOURCE, emphasis: MOVED_EMPHASIS });
  const out = tabs();
  assert.deepEqual(
    [knobPositions(out, TWO_KNOB, "source"), knobPositions(out, TWO_KNOB, "emphasis")],
    [[DEFAULTS.source], [DEFAULTS.emphasis]],
  );
});

// ============================================================================
// a tile that IS lit reads the fields, not the record
// ============================================================================
//
// The fields carry `perfect-ten` at both knob defaults while the record says
// both are moved. What the tile is showing is the state the engine is actually
// in, so the record loses — a card that let the record win would put a lit tile
// out of step with the four filter fields underneath it.

test("test_a_lit_tiles_knobs_show_the_positions_its_filters_carry_whatever_was_recorded", async () => {
  await resetTab({ grid: "album", mode: "pcm", names: seedPcm(PERFECT_TEN_STANDARD_SPACE) });
  rememberKnobs("album", OTHER, { source: MOVED_SOURCE, emphasis: MOVED_EMPHASIS });
  const out = tabs();
  assert.deepEqual(
    [knobPositions(out, OTHER, "source"), knobPositions(out, OTHER, "emphasis")],
    [[DEFAULTS.source], [DEFAULTS.emphasis]],
  );
});

// ============================================================================
// what writing a preset records
// ============================================================================
//
// Read through `knobsFor`, the store's own reader, because what a press records
// is a claim about the record and not about a rendering. The positions a press
// records are the positions it WROTE, which for a knob move is the moved knob
// plus its neighbours where they stood, and for a plain tile press is the
// defaults the press wrote.

test("test_moving_a_knob_records_the_positions_that_press_wrote", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  pressKnob(seenTabs(), TWO_KNOB, MOVED_SOURCE);
  await flush(w);
  assert.deepEqual(knobsFor("album", TWO_KNOB), { source: MOVED_SOURCE, emphasis: DEFAULTS.emphasis });
});

test("test_pressing_a_tile_records_the_positions_that_press_wrote", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  pressTile(seenTabs(), TWO_KNOB);
  await flush(w);
  assert.deepEqual(knobsFor("album", TWO_KNOB), { source: DEFAULTS.source, emphasis: DEFAULTS.emphasis });
});

test("test_a_press_on_the_live_lane_records_the_positions_it_wrote", async () => {
  const w = await resetLive({ grid: "album" });
  pressKnob(seenLive(), TWO_KNOB, MOVED_SOURCE);
  await flush(w);
  assert.deepEqual(knobsFor("album", TWO_KNOB), { source: MOVED_SOURCE, emphasis: DEFAULTS.emphasis });
});

// ============================================================================
// the whole round trip, as a user meets it
// ============================================================================
//
// The defect this behavior was added for: a knob set on one tile, then another
// tile pressed, and the first tile's knob back at its default. The light moves
// away from the tile that was written and the position it was written at is
// still on it.

test("test_a_knob_moved_on_a_tile_is_still_showing_after_another_tile_is_pressed", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  pressKnob(seenTabs(), TWO_KNOB, MOVED_SOURCE);
  await flush(w);
  pressTile(seenTabs(), ELSEWHERE);
  await flush(w);
  assert.deepEqual(knobPositions(tabs(), TWO_KNOB, "source"), [MOVED_SOURCE]);
});

// ============================================================================
// both lanes, one record
// ============================================================================
//
// The lane switch is the reset itself, asked to keep the record: `resetLive` and
// `resetTab` rebuild every signal either lane reads, which is what a user
// changing lanes meets, and `keepKnobs` is the record crossing with them. A
// record kept per lane fails both of these.

test("test_a_knob_moved_on_the_live_lane_is_showing_on_the_tabs_lane", async () => {
  const w = await resetLive({ grid: "album" });
  pressKnob(seenLive(), TWO_KNOB, MOVED_SOURCE);
  await flush(w);
  await resetTab({ grid: "album", mode: "pcm", keepKnobs: true });
  assert.deepEqual(knobPositions(tabs(), TWO_KNOB, "source"), [MOVED_SOURCE]);
});

test("test_a_knob_moved_on_the_tabs_lane_is_showing_on_the_live_lane", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  pressKnob(seenTabs(), TWO_KNOB, MOVED_SOURCE);
  await flush(w);
  await resetLive({ grid: "album", keepKnobs: true });
  assert.deepEqual(knobPositions(liveCard(), TWO_KNOB, "source"), [MOVED_SOURCE]);
});
