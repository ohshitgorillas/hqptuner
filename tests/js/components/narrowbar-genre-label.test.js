// Behavioral suite for the genre button's summary label where the selection
// carries the manual's genre-agnostic "any" tag. Under the AND mode a selection
// including "any" makes every other pick inert (the popover already renders
// those rows unavailable, tests/js/components/narrowbar-genre-any.test.js), so
// the button summarizes the selection by the "any" row's label alone: no count,
// no mode suffix. Every other shape keeps the count-plus-mode wording.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. State is driven by assigning the exported source signals
// the real payloads carry — the engine's own `<GetFilters/>` enumeration
// (protocol.md:226) and the static name-keyed genre overlay from /api/metadata —
// through tests/js/support/genrepopover.js, the shared narrow-bar harness.
//
// Reading taken where the spec named exact text: the three wordings the spec
// quotes ("All genres", "2 genres · OR", "2 genres · AND") are asserted verbatim,
// because user-facing copy is owner-approved character for character. The one
// case whose text the spec does NOT quote — a single picked genre reads "that one
// genre's label" — is pinned against the caption that genre's own popover row
// wears, discovered at run time, so a reworded genre label moves the case with it
// instead of failing it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-genre-label.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nGenre, nGenreMode } from "../../../hqptuner/static/store/narrow/state.js";
import { genreLabel } from "../../../hqptuner/static/components/narrowbar/labels.js";
import { resetNarrowBar, openFacet, checkedRows } from "../support/genrepopover.js";

// Filters in the engine's own description format, `"<q>/5 [focus, ...] <glyph>
// <ratio>"` with the PCM glyph, plus the static overlay's genre tags. One filter
// per genre value the facet offers, so every value these cases pick is a live
// option rather than a tag no filter carries.
const FILTERS = [
  { index: "0", name: "gauss-classical", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-electronic", value: "1", arg: 1, description: "5/5 timbre ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-any", value: "2", arg: 0, description: "5/5 timbre ⥮ Any", apodizing: false },
  { index: "3", name: "gauss-pop", value: "3", arg: 0, description: "4/5 space ⥮ Any", apodizing: false },
  { index: "4", name: "gauss-jazz", value: "4", arg: 0, description: "5/5 timbre ⥮ Any", apodizing: false },
];

const OVERLAY = {
  "gauss-classical": { genre: ["classical"] },
  "gauss-electronic": { genre: ["electronic"] },
  "gauss-any": { genre: ["any"] },
  "gauss-pop": { genre: ["pop"] },
  "gauss-jazz": { genre: ["jazz"] },
};

/**
 * The bar back at its starting state, then a stated genre selection and combine
 * mode.
 *
 * @param {string[]} selection
 * @param {string} mode
 * @returns {Promise<void>}
 */
async function pick(selection, mode) {
  await resetNarrowBar(FILTERS, { overlay: OVERLAY });
  nGenreMode.value = mode;
  nGenre.value = selection;
}

// --- "any" under AND swallows the rest of the selection -------------------------

test("test_a_genre_beside_any_under_the_and_mode_reads_the_any_label_alone", async () => {
  await pick(["classical", "any"], "and");
  assert.equal(genreLabel(), "All genres");
});

test("test_any_alone_under_the_and_mode_reads_the_any_label", async () => {
  await pick(["any"], "and");
  assert.equal(genreLabel(), "All genres");
});

// --- every other shape keeps the count and its mode suffix ----------------------

test("test_a_genre_beside_any_under_the_or_mode_reads_a_count_with_its_mode", async () => {
  await pick(["classical", "any"], "or");
  assert.equal(genreLabel(), "2 genres · OR");
});

test("test_two_ordinary_genres_under_the_and_mode_read_a_count_with_its_mode", async () => {
  await pick(["classical", "electronic"], "and");
  assert.equal(genreLabel(), "2 genres · AND");
});

test("test_one_ordinary_genre_under_the_and_mode_reads_that_genres_own_row_caption", async () => {
  await pick(["classical"], "and");
  assert.equal(genreLabel(), checkedRows(openFacet("genre"))[0]);
});
