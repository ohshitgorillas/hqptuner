// Behavioral suite for the ERROR-CORRECTION MARK an Easy Mode preset tile
// carries: every tile renders one, below its knobs; the form it takes follows
// the apodizing class of the filter that tile would write at the knob positions
// it is SHOWING, lit or dark; and a filter whose class nothing has stated leaves
// the tile with no mark rather than a guessed one.
//
// The companion files are tests/js/components/easytiles.test.js (the grids, the
// active marking and where a press routes what the table names),
// tests/js/components/easytiles-knobs.test.js (what a dark tile's knobs show)
// and tests/js/components/easytiles-desc.test.js (a description's structure).
// All four share tests/js/support/easytiles.js, imported dynamically after
// `useStorage()` so that `store/easyview.js` meets the fake localStorage at its
// load-time read; the mark's own readers and its seeding seam are
// tests/js/support/easymark.js.
//
// NOTHING HERE READS COPY (docs/testing.md rule 9, and never owner copy
// verbatim). The three forms are told apart by the vector geometry each draws
// and by the fact that their accessible labels DIFFER — never by what any of
// those labels says. Which form is "the full-apodizing one" is established by
// rendering a tile whose filter is stated full and reading what it drew, so no
// path data and no sentence is typed out anywhere in this file.
//
// HOOKS THIS SUITE REQUIRES the implementation to provide:
//   * the `apod-mark` class on the mark element — the shared class the filter
//     dropdowns' badge wears, this being the same mark in a second place
//   * one <path> inside it, distinct per form, as the dropdown badge already
//     draws (tests/js/components/combobox-apod.test.js)
//   * an `aria-label` on the mark, or on exactly one element inside it
//
// THE FACTS ARE SEEDED AT THE WIRE: an apodizing class reaches the frontend as
// the static overlay's `apodizing` fact under /api/metadata's `filters.filters`,
// unioned with the engine enumeration's `arg` bitfield. The overlay half is what
// these cases serve, because it is the half both lane fixtures can carry — see
// tests/js/support/easymark.js.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-mark.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { ALBUM_TILE, resetTab, running, seedPcm, tabs } = await import("../support/easytiles.js");
const { seedFacets, uniformFacets, facetsFor, markCounts, markGlyph, markLabel, knobsPrecedeMark } =
  await import("../support/easymark.js");
const { rememberKnobs } = await import("../../../hqptuner/static/store/easyview.js");

// The album grid's roster, stated outright: a preset id is a wire identifier,
// and a count alone would not name which tile lost its mark.
const ALBUM_ROSTER = ["perfect-ten", "lifelike", "concert-hall", "purist", "old-school", "damage-control"];

// The three classes a filter can be in, as the overlay spells them.
const CLASSES = ["full", "half", "none"];

// The preset whose own knob names error correction, and the two positions it
// offers. Knob ids and option ids are wire identifiers.
const HALL = { preset: "concert-hall", knob: "correction", on: "on", off: "off" };

/** The PCM filter names one preset writes at one set of knob positions. */
const namesAt = (/** @type {Record<string, string>} */ knobs) => {
  const { oneX, nX } = running(HALL.preset, knobs);
  return [oneX, nX];
};

/**
 * The geometry a tile draws when the filter it would write is stated to be in
 * one class — the reference every "which form is this" case below is read
 * against. One render of its own, so nothing about the subject's fixture leaks
 * into it.
 *
 * @param {string} apodizing
 * @returns {Promise<string | undefined>}
 */
async function glyphOfClass(apodizing) {
  await resetTab({ grid: "album", mode: "pcm" });
  seedFacets(uniformFacets(apodizing));
  return markGlyph(tabs(), ALBUM_TILE);
}

/**
 * The accessible label a tile's mark carries when its filter is stated to be in
 * one class.
 *
 * @param {string} apodizing
 * @returns {Promise<string>}
 */
async function labelOfClass(apodizing) {
  await resetTab({ grid: "album", mode: "pcm" });
  seedFacets(uniformFacets(apodizing));
  return markLabel(tabs(), ALBUM_TILE);
}

/** The facts the two concert-hall cases run on: its On filter full, its Off filter none. */
const HALL_FACETS = {
  ...facetsFor(namesAt({ [HALL.knob]: HALL.on }), "full"),
  ...facetsFor(namesAt({ [HALL.knob]: HALL.off }), "none"),
};

// ============================================================================
// every tile carries exactly one mark, in every class
// ============================================================================
//
// The "none" case is the one that separates this mark from the dropdowns'
// badge: a filter that does no error correction still gets a mark of its own
// here, rather than the nothing a dropdown row shows.

for (const apodizing of CLASSES) {
  test(`test_every_album_tile_renders_one_mark_while_its_filter_is_${apodizing}_apodizing`, async () => {
    await resetTab({ grid: "album", mode: "pcm" });
    seedFacets(uniformFacets(apodizing));
    assert.deepEqual(markCounts(tabs(), ALBUM_ROSTER), Object.fromEntries(ALBUM_ROSTER.map((id) => [id, 1])));
  });
}

// ============================================================================
// and none at all while nothing has stated a class
// ============================================================================
//
// No overlay entry and no engine `arg`: the class of every filter on the card is
// unknown, which is not the same fact as "does no error correction". A card that
// fell back to one of the three forms fails here by naming every tile it marked.

test("test_a_tile_renders_no_mark_while_no_facet_metadata_states_its_filters_class", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  assert.deepEqual(markCounts(tabs(), ALBUM_ROSTER), Object.fromEntries(ALBUM_ROSTER.map((id) => [id, 0])));
});

// ============================================================================
// the three forms are three forms
// ============================================================================

test("test_the_three_apodizing_classes_draw_three_distinct_marks", async () => {
  const drawn = [await glyphOfClass("full"), await glyphOfClass("half"), await glyphOfClass("none")];
  assert.equal(new Set(drawn).size, 3);
});

test("test_the_three_marks_carry_three_distinct_accessible_labels", async () => {
  const labels = [await labelOfClass("full"), await labelOfClass("half"), await labelOfClass("none")];
  assert.equal(new Set(labels).size, 3);
});

test("test_each_marks_accessible_label_says_something", async () => {
  const labels = [await labelOfClass("full"), await labelOfClass("half"), await labelOfClass("none")];
  assert.deepEqual(
    labels.map((label) => label.trim() !== ""),
    [true, true, true],
  );
});

// ============================================================================
// the mark sits below the knobs
// ============================================================================
//
// Document order, which is the half of "below" a rendering can answer; where the
// two land on screen is CSS and belongs to the visual hand-back.

test("test_a_tiles_mark_renders_after_every_one_of_its_knobs", async () => {
  await resetTab({ grid: "album", mode: "pcm" });
  seedFacets(uniformFacets("full"));
  assert.equal(knobsPrecedeMark(tabs(), ALBUM_TILE), true);
});

// ============================================================================
// the mark follows the knob positions the tile is SHOWING
// ============================================================================
//
// Concert Hall's own knob is the error-correction switch, so its two positions
// name filters of two different classes and the mark has to move with it. The
// three cases below put the tile in the three states it can show a position
// from: dark at its default, dark at a recorded position, and lit by the fields
// underneath it.

test("test_a_dark_concert_hall_tile_at_the_on_position_draws_the_full_apodizing_mark", async () => {
  const full = await glyphOfClass("full");
  await resetTab({ grid: "album", mode: "pcm" });
  seedFacets(HALL_FACETS);
  assert.equal(markGlyph(tabs(), HALL.preset), full);
});

test("test_a_dark_concert_hall_tile_recorded_at_the_off_position_draws_the_no_apodizing_mark", async () => {
  const none = await glyphOfClass("none");
  await resetTab({ grid: "album", mode: "pcm" });
  seedFacets(HALL_FACETS);
  rememberKnobs("album", HALL.preset, { [HALL.knob]: HALL.off });
  assert.equal(markGlyph(tabs(), HALL.preset), none);
});

test("test_a_lit_concert_hall_tile_whose_fields_carry_its_off_filter_draws_the_no_apodizing_mark", async () => {
  const none = await glyphOfClass("none");
  await resetTab({ grid: "album", mode: "pcm", names: seedPcm(namesAt({ [HALL.knob]: HALL.off })[0]) });
  seedFacets(HALL_FACETS);
  assert.equal(markGlyph(tabs(), HALL.preset), none);
});
