// Behavioral suite for the ERROR-CORRECTION MARK an Easy Mode preset tile
// carries: every tile renders one, between its title and its description; the
// form it takes follows the apodizing class of the filter that tile would write
// at the knob positions it is SHOWING, lit or dark; and a filter whose class
// nothing has stated leaves the tile with no mark rather than a guessed one.
//
// The companion files are tests/js/components/easytiles.test.js (the tiles, the
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
// those labels says. WHICH form is the full-apodizing one is settled against the
// dropdown badge's own glyph for that class (tests/js/support/apodglyph.js), so
// no path data and no sentence is typed out anywhere in this file.
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

const { TILE, resetTab, running, seedPcm, tabs } = await import("../support/easytiles.js");
const {
  seedFacets,
  uniformFacets,
  facetsFor,
  markCounts,
  markGlyph,
  markLabel,
  markFollowsTitleAndPrecedesDescription,
} = await import("../support/easymark.js");
const { dropdownGlyphs } = await import("../support/apodglyph.js");
const { rememberKnobs } = await import("../../../hqptuner/static/store/easyview.js");

// The card's roster, stated outright: a preset id is a wire identifier,
// and a count alone would not name which tile lost its mark.
const ROSTER = ["perfect-ten", "lifelike", "concert-hall", "purist", "old-school", "damage-control"];

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
  await resetTab({ mode: "pcm" });
  seedFacets(uniformFacets(apodizing));
  return markGlyph(tabs(), TILE);
}

/**
 * The accessible label a tile's mark carries when its filter is stated to be in
 * one class.
 *
 * @param {string} apodizing
 * @returns {Promise<string>}
 */
async function labelOfClass(apodizing) {
  await resetTab({ mode: "pcm" });
  seedFacets(uniformFacets(apodizing));
  return markLabel(tabs(), TILE);
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
    await resetTab({ mode: "pcm" });
    seedFacets(uniformFacets(apodizing));
    assert.deepEqual(markCounts(tabs(), ROSTER), Object.fromEntries(ROSTER.map((id) => [id, 1])));
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
  await resetTab({ mode: "pcm" });
  assert.deepEqual(markCounts(tabs(), ROSTER), Object.fromEntries(ROSTER.map((id) => [id, 0])));
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
// which of the three forms is which
// ============================================================================
//
// The cases above can tell three forms apart but not which is which: a card that
// drew the crossed A for a full-apodizing filter and the circled A for one that
// does no correction satisfies every one of them. Identity is borrowed from the
// dropdown badge, which has drawn the full and half glyphs since before the
// tiles existed and whose own cases pin that it does
// (tests/js/components/combobox-apod.test.js) — so a tile that swapped two forms
// fails here without any path data being typed into a test.
//
// The "none" form has no dropdown counterpart to be anchored against: a row of
// neither class wears no badge at all. What pins it is the two below plus the
// distinctness case above — matching full and half leaves the crossed A the only
// form the third can be.

// The two classes the dropdown draws, named by the class itself: the badge
// reader answers under the same two names the overlay states a class by.
/** @type {("full" | "half")[]} */
const ANCHORED = ["full", "half"];

for (const apodizing of ANCHORED) {
  test(`test_a_${apodizing}_apodizing_tile_draws_the_same_mark_as_a_${apodizing}_apodizing_dropdown_row`, async () => {
    const badge = await dropdownGlyphs();
    assert.equal(await glyphOfClass(apodizing), badge[apodizing]);
  });
}

// ============================================================================
// where the mark sits in the tile
// ============================================================================
//
// After the tile's title and before its description, on every tile of the card —
// document order, which is the half of a layout a rendering can answer; where
// the three land on screen is CSS and belongs to the visual hand-back.
//
// The titles and descriptions are this file's own stand-ins, seeded through
// /api/metadata's `easy.<presetId>` shape
// (tests/api/test_metadata_easy.py). No word of what ships reaches these cases,
// and the title is used as a POSITION and never as a value.

/** @param {string} presetId */
const standInTitle = (presetId) => `A stand-in title for ${presetId}.`;

const COPY = Object.fromEntries(
  ROSTER.map((id) => [id, { title: standInTitle(id), description: "A stand-in description, seeded by the suite." }]),
);

for (const presetId of ROSTER) {
  test(`test_the_${presetId}_mark_sits_between_its_title_and_its_description`, async () => {
    await resetTab({ mode: "pcm", notes: true, copy: COPY });
    seedFacets(uniformFacets("full"));
    assert.equal(markFollowsTitleAndPrecedesDescription(tabs(), presetId, standInTitle(presetId)), true);
  });
}

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
  await resetTab({ mode: "pcm" });
  seedFacets(HALL_FACETS);
  assert.equal(markGlyph(tabs(), HALL.preset), full);
});

test("test_a_dark_concert_hall_tile_recorded_at_the_off_position_draws_the_no_apodizing_mark", async () => {
  const none = await glyphOfClass("none");
  await resetTab({ mode: "pcm" });
  seedFacets(HALL_FACETS);
  rememberKnobs(HALL.preset, { [HALL.knob]: HALL.off });
  assert.equal(markGlyph(tabs(), HALL.preset), none);
});

test("test_a_lit_concert_hall_tile_whose_fields_carry_its_off_filter_draws_the_no_apodizing_mark", async () => {
  const none = await glyphOfClass("none");
  await resetTab({ mode: "pcm", names: seedPcm(namesAt({ [HALL.knob]: HALL.off })[0]) });
  seedFacets(HALL_FACETS);
  assert.equal(markGlyph(tabs(), HALL.preset), none);
});
