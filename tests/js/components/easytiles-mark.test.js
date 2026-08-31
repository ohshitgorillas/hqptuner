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

const { ROSTER, resetTab, running, seedPcmPair, tabs } = await import("../support/easytiles.js");
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
const { recordPositions } = await import("../support/easyrecord.js");
const { presetsFor } = await import("../../../hqptuner/static/store/easy.js");

// The three classes a filter can be in, as the overlay spells them.
const CLASSES = ["full", "half", "none"];

/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, knobs: Knob[] }} Preset */
/**
 * One preset, one of its knobs, and one position off that knob's default, with
 * the PCM filter names the tile writes at rest and at that position.
 * @typedef {{ preset: string, knob: string, moved: string, restNames: string[], movedNames: string[] }} Move
 */

/**
 * The PCM filter names one preset writes at one set of knob positions, the
 * knobs left unnamed resting at their defaults.
 *
 * @param {string} presetId
 * @param {Record<string, string>} knobs
 * @returns {string[]}
 */
const namesAt = (presetId, knobs) => {
  const { oneX, nX } = running(presetId, knobs);
  return [oneX, nX];
};

// Every knob move the shipped table offers whose filters can be told apart
// from the resting ones: each preset, each knob it declares, each position
// off that knob's default, kept only where the names written at that position
// share nothing with the names written at rest. That property is what lets
// the two states be stated in two classes without one name being stated in
// both; a move that changes nothing the tile writes, or that trades one end's
// name for the other's, generates no case. No preset is named to stand for
// the property.
/** @type {Move[]} */
const MOVES = /** @type {Preset[]} */ (presetsFor())
  .flatMap((preset) =>
    preset.knobs.flatMap((knob) =>
      knob.options
        .filter((option) => option !== knob.default)
        .map((moved) => ({
          preset: String(preset.id),
          knob: String(knob.id),
          moved,
          restNames: namesAt(String(preset.id), {}),
          movedNames: namesAt(String(preset.id), { [knob.id]: moved }),
        })),
    ),
  )
  .filter((move) => move.restNames.every((name) => !move.movedNames.includes(name)));

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
  return markGlyph(tabs(), ROSTER[0]);
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
  return markLabel(tabs(), ROSTER[0]);
}

/**
 * The facts one move's cases run on: the filters written at rest stated full,
 * the filters written at the moved position stated none.
 *
 * @param {Move} move
 * @returns {Record<string, string>}
 */
const facetsOf = (move) => ({
  ...facetsFor(move.restNames, "full"),
  ...facetsFor(move.movedNames, "none"),
});

// ============================================================================
// every tile carries exactly one mark, in every class
// ============================================================================
//
// The "none" case is the one that separates this mark from the dropdowns'
// badge: a filter that does no error correction still gets a mark of its own
// here, rather than the nothing a dropdown row shows.

for (const apodizing of CLASSES) {
  test(`test_every_preset_tile_renders_one_mark_while_its_filter_is_${apodizing}_apodizing`, async () => {
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
// A knob whose move changes the filter a tile writes names filters of two
// different classes once the two are stated so, and the mark has to move with
// it. For every such move the table offers (`MOVES`), the three cases below
// put the tile in the three states it can show a position from: dark at its
// default, dark at a recorded position, and lit by the fields underneath it.
// The rest state is stated full and the moved one none, so a tile that read
// the wrong state draws the other class's form and fails by naming the move.

for (const move of MOVES) {
  test(`test_a_dark_${move.preset}_tile_with_${move.knob}_at_rest_draws_the_mark_of_the_class_stated_for_its_resting_filter`, async () => {
    const full = await glyphOfClass("full");
    await resetTab({ mode: "pcm" });
    seedFacets(facetsOf(move));
    assert.equal(markGlyph(tabs(), move.preset), full);
  });
}

for (const move of MOVES) {
  test(`test_a_dark_${move.preset}_tile_recorded_at_${move.knob}_${move.moved}_draws_the_mark_of_the_class_stated_for_that_positions_filter`, async () => {
    const none = await glyphOfClass("none");
    await resetTab({ mode: "pcm" });
    seedFacets(facetsOf(move));
    recordPositions(move.preset, { [move.knob]: move.moved });
    assert.equal(markGlyph(tabs(), move.preset), none);
  });
}

// Lit: the fields underneath carry the two PCM names the moved position writes,
// so the tile shows that position without anything having been recorded.

for (const move of MOVES) {
  test(`test_a_lit_${move.preset}_tile_whose_fields_carry_its_${move.knob}_${move.moved}_filters_draws_the_mark_of_the_class_stated_for_them`, async () => {
    const none = await glyphOfClass("none");
    await resetTab({ mode: "pcm", names: seedPcmPair(move.movedNames[0], move.movedNames[1]) });
    seedFacets(facetsOf(move));
    assert.equal(markGlyph(tabs(), move.preset), none);
  });
}
