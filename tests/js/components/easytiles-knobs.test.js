// Behavioral suite for what a DARK Easy Mode tile shows on its knobs: the
// positions last recorded for that preset, rather than the knob's
// hardcoded default. Recording happens where the positions are written — a knob
// moved, or the tile pressed — and the record is read back through
// `store/easyview.js`'s `knobsFor`.
//
// The companion file is tests/js/components/easytiles.test.js, which owns the
// tiles, the active marking and where a press routes what the table names. Only
// the knob-memory half lives here, and it reuses that file's harness whole:
// tests/js/support/easytiles.js, imported dynamically after `useStorage()` so
// that `store/easyview.js` meets the fake localStorage at its load-time read.
// The store's OWN behavior — reading back, per-preset separation,
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
// WHAT IS NOT PINNED. The shape of the record is not read. How a
// preset is spelt into a key, and how a knob map is nested under it, is the
// writer's business — the record is only ever reached through `rememberKnobs`
// and `knobsFor`, exactly as a caller reaches it.
//
// NAMES, NOT WORDS (rule 9). Preset ids, knob ids and knob option ids are wire
// identifiers and are stated outright. Filter names are owner data and are read
// off `store/easy.js`'s `writeSet` for the position they stand for, never typed;
// nothing here asserts a title, a description or any other piece of owner copy.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-knobs.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const {
  resetTab,
  resetLive,
  seedPcmPair,
  flush,
  tabs,
  liveCard,
  seenTabs,
  seenLive,
  knobPositions,
  pressTile,
  pressKnob,
} = await import("../support/easytiles.js");

const { rememberKnobs, knobsFor } = await import("../../../hqptuner/static/store/easyview.js");
const { writeSet } = await import("../../../hqptuner/static/store/easy.js");

/**
 * The PCM pair a preset writes at a knob combination, read off the table so
 * that no filter name is typed here.
 *
 * @param {string} preset
 * @param {Record<string, string>} knobs
 * @returns {{ oneX: string, nX: string }}
 */
const pairFor = (preset, knobs) => {
  const set = writeSet(preset, "pcm", knobs);
  return { oneX: set.pcm_filter_1x, nX: set.pcm_filter_nx };
};

// The two presets that carry both knobs. `lifelike` is the one moved and read
// back; `perfect-ten` is the one whose record must not follow it.
const TWO_KNOB = "lifelike";
const OTHER = "perfect-ten";

// The tile pressed to take the light off whichever tile a case just wrote.
const ELSEWHERE = "concert-hall";

// `perfect-ten`'s lossless, space-emphasis PAIR, so fields carrying it light
// that tile with its knobs on that combination.
const PERFECT_TEN_LOSSLESS_SPACE = pairFor("perfect-ten", { emphasis: "space", material: "lossless" });

// The positions every knob rests at until something moves it — the reading the
// two dark-tile cases below are ABOUT, and named nowhere else in this file.
const RESTING = { material: "lossless", emphasis: "space" };

// The positions the seeded pair above stands for, which is what a LIT tile reads
// off the fields. Not derived from the resting positions: the fields say
// `lossless`/`space` because that is the combination that pair belongs to. They
// coincide with the resting pair, which is why the record the case seeds beside
// them is a MOVED one — a tile reading the fields and a tile reading the record
// answer differently there.
const SEEDED = { material: "lossless", emphasis: "space" };

// The positions this file moves to.
const MOVED_MATERIAL = "lossy";
const MOVED_EMPHASIS = "transients";

// `lifelike`'s lossless, transients-emphasis pair. The two record cases below
// seed it, so that the NEIGHBOUR position they read back out of the record is
// one they stated rather than one they inherited from wherever `emphasis`
// happens to rest: a resting position is the owner's to revisit, and moving it
// must not break a case about what a press RECORDS.
const LIFELIKE_LOSSLESS_TRANSIENTS = pairFor("lifelike", { emphasis: "transients", material: "lossless" });
const SEEDED_EMPHASIS = "transients";

// The one-knob preset the record cases press: it carries no `material` knob at
// all, so what a press of it records cannot be disturbed by where that knob
// comes to rest. Its `emphasis` knob is stated outright at the position it is
// pressed at.
const ONE_KNOB = "purist";
const ONE_KNOB_EMPHASIS = "space";

// ============================================================================
// where Damage Control's second knob rests
// ============================================================================
//
// The knob the tile gained with the `lossy` tile's retirement, on an untouched
// card with nothing recorded for it: a fresh tile stands at `lossless`, which is
// the position that keeps the material the user has. A card resting it on
// `lossy` would put every untouched press through the lossy filters.
//
// Read here rather than in the store, because a resting position is only ever
// observable as what a knob SHOWS. `lossless` and `lossy` are wire identifiers
// carried in `data-v`, so this reads no copy — which matters for this knob in
// particular, since the copy for it is not written yet.

test("test_an_untouched_damage_control_tile_shows_its_material_knob_on_lossless", async () => {
  await resetTab({ mode: "pcm" });
  assert.deepEqual(knobPositions(tabs(), "damage-control", "material"), ["lossless"]);
});

// And the mirror: the lossy filter in the fields lights the tile with the knob
// at the position that wrote it.

const DAMAGE_CONTROL_LOSSY = pairFor("damage-control", { material: "lossy" });

test("test_the_lossy_filter_in_the_fields_shows_the_material_knob_on_lossy", async () => {
  await resetTab({ mode: "pcm", names: seedPcmPair(DAMAGE_CONTROL_LOSSY.oneX, DAMAGE_CONTROL_LOSSY.nX) });
  assert.deepEqual(knobPositions(tabs(), "damage-control", "material"), ["lossy"]);
});

// ============================================================================
// a tile that is not lit shows what was recorded for it
// ============================================================================

test("test_a_dark_tile_shows_the_material_position_last_recorded_for_it", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs(TWO_KNOB, { material: MOVED_MATERIAL, emphasis: RESTING.emphasis });
  assert.deepEqual(knobPositions(tabs(), TWO_KNOB, "material"), [MOVED_MATERIAL]);
});

test("test_a_dark_tile_shows_the_emphasis_position_last_recorded_for_it", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs(TWO_KNOB, { material: RESTING.material, emphasis: MOVED_EMPHASIS });
  assert.deepEqual(knobPositions(tabs(), TWO_KNOB, "emphasis"), [MOVED_EMPHASIS]);
});

// One knob recorded, its neighbour not. Both are read in the one assertion,
// because "the recorded one moved" and "the unrecorded one did not" are halves
// of a single claim about a partial record: a tile that dragged its whole knob
// row along with the one recorded position fails here in place.
test("test_a_dark_tiles_unrecorded_knob_stays_at_its_default_while_its_neighbour_shows_its_record", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs(TWO_KNOB, { emphasis: MOVED_EMPHASIS });
  const out = tabs();
  assert.deepEqual(
    [knobPositions(out, TWO_KNOB, "material"), knobPositions(out, TWO_KNOB, "emphasis")],
    [[RESTING.material], [MOVED_EMPHASIS]],
  );
});

// A record belongs to the tile it was made for. Nothing is recorded for
// `lifelike` here, so both its knobs read their defaults while `perfect-ten`
// carries a full record — the state Easy Mode was already in before tiles
// remembered anything, and a guard rather than a new claim.
test("test_a_dark_tile_shows_its_defaults_while_only_another_tiles_positions_are_recorded", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs(OTHER, { material: MOVED_MATERIAL, emphasis: MOVED_EMPHASIS });
  const out = tabs();
  assert.deepEqual(
    [knobPositions(out, TWO_KNOB, "material"), knobPositions(out, TWO_KNOB, "emphasis")],
    [[RESTING.material], [RESTING.emphasis]],
  );
});

// ============================================================================
// a tile that IS lit reads the fields, not the record
// ============================================================================
//
// The fields carry `perfect-ten` at the pair one named position stands for while
// the record says both knobs are moved somewhere else. What the tile is showing
// is the state the engine is actually in, so the record loses — a card that let
// the record win would put a lit tile out of step with the four filter fields
// underneath it.

test("test_a_lit_tiles_knobs_show_the_positions_its_filters_carry_whatever_was_recorded", async () => {
  await resetTab({ mode: "pcm", names: seedPcmPair(PERFECT_TEN_LOSSLESS_SPACE.oneX, PERFECT_TEN_LOSSLESS_SPACE.nX) });
  rememberKnobs(OTHER, { material: MOVED_MATERIAL, emphasis: MOVED_EMPHASIS });
  const out = tabs();
  assert.deepEqual(
    [knobPositions(out, OTHER, "material"), knobPositions(out, OTHER, "emphasis")],
    [[SEEDED.material], [SEEDED.emphasis]],
  );
});

// ============================================================================
// what writing a preset records
// ============================================================================
//
// Read through `knobsFor`, the store's own reader, because what a press records
// is a claim about the record and not about a rendering. The positions a press
// records are the positions it WROTE, which for a knob move is the moved knob
// plus its neighbours where they stood, and for a plain tile press is the whole
// row the press wrote. The two knob-move cases seed the fields so that the
// neighbour they read back stands at a position they NAMED. The tile-press case
// reads the ONE-KNOB preset: what a press records is the subject, and a preset
// carrying no `material` knob cannot have that reading disturbed by where
// material rests.

test("test_moving_a_knob_records_the_positions_that_press_wrote", async () => {
  const w = await resetTab({
    mode: "pcm",
    names: seedPcmPair(LIFELIKE_LOSSLESS_TRANSIENTS.oneX, LIFELIKE_LOSSLESS_TRANSIENTS.nX),
  });
  pressKnob(seenTabs(), TWO_KNOB, MOVED_MATERIAL);
  await flush(w);
  assert.deepEqual(knobsFor(TWO_KNOB), { material: MOVED_MATERIAL, emphasis: SEEDED_EMPHASIS });
});

test("test_pressing_a_tile_records_the_positions_that_press_wrote", async () => {
  const w = await resetTab({ mode: "pcm" });
  pressTile(seenTabs(), ONE_KNOB);
  await flush(w);
  assert.deepEqual(knobsFor(ONE_KNOB), { emphasis: ONE_KNOB_EMPHASIS });
});

test("test_a_press_on_the_live_lane_records_the_positions_it_wrote", async () => {
  const w = await resetLive({
    oneX: LIFELIKE_LOSSLESS_TRANSIENTS.oneX,
    nX: LIFELIKE_LOSSLESS_TRANSIENTS.nX,
  });
  pressKnob(seenLive(), TWO_KNOB, MOVED_MATERIAL);
  await flush(w);
  assert.deepEqual(knobsFor(TWO_KNOB), { material: MOVED_MATERIAL, emphasis: SEEDED_EMPHASIS });
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
  const w = await resetTab({ mode: "pcm" });
  pressKnob(seenTabs(), TWO_KNOB, MOVED_MATERIAL);
  await flush(w);
  pressTile(seenTabs(), ELSEWHERE);
  await flush(w);
  assert.deepEqual(knobPositions(tabs(), TWO_KNOB, "material"), [MOVED_MATERIAL]);
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
  const w = await resetLive();
  pressKnob(seenLive(), TWO_KNOB, MOVED_MATERIAL);
  await flush(w);
  await resetTab({ mode: "pcm", keepKnobs: true });
  assert.deepEqual(knobPositions(tabs(), TWO_KNOB, "material"), [MOVED_MATERIAL]);
});

test("test_a_knob_moved_on_the_tabs_lane_is_showing_on_the_live_lane", async () => {
  const w = await resetTab({ mode: "pcm" });
  pressKnob(seenTabs(), TWO_KNOB, MOVED_MATERIAL);
  await flush(w);
  await resetLive({ keepKnobs: true });
  assert.deepEqual(knobPositions(liveCard(), TWO_KNOB, "material"), [MOVED_MATERIAL]);
});
