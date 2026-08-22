// Behavioral suite for the genre button's summary where the selection carries
// the manual's genre-agnostic "any" tag. Under the AND mode a selection
// including "any" makes every other pick inert (the popover already renders
// those rows unavailable, tests/js/components/narrowbar-genre-any.test.js), so
// the summary reports the "any" pick alone: no count, no combine mode. Every
// other shape reports the count and the mode that is biting.
//
// The wording the button carries is owner copy and is asserted nowhere: the
// state behind it is `genreSummary()` — `{count, single, mode, extra}`, where
// `single` is the picked value's own WIRE value, `mode` is named only once a
// second pick makes it bite, and `extra` carries the clause codes
// (docs/testing.md rule 9).
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. State is driven by assigning the exported source signals
// the real payloads carry — the engine's own `<GetFilters/>` enumeration
// (protocol.md:226) and the static name-keyed genre overlay from /api/metadata —
// through tests/js/support/genrepopover.js, the shared narrow-bar harness.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-genre-label.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nGenre, nGenreMode } from "../../../hqptuner/static/store/narrow/state.js";
import { genreSummary } from "../../../hqptuner/static/components/narrowbar/labels.js";
import { resetNarrowBar } from "../support/genrepopover.js";

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

test("test_a_genre_beside_any_under_the_and_mode_reports_the_dominating_any_clause", async () => {
  await pick(["classical", "any"], "and");
  assert.deepEqual(genreSummary().extra, ["any-dominates"]);
});

test("test_a_genre_beside_any_under_the_and_mode_names_no_combine_mode", async () => {
  await pick(["classical", "any"], "and");
  assert.equal(genreSummary().mode, null);
});

test("test_any_alone_under_the_and_mode_summarizes_the_any_pick", async () => {
  await pick(["any"], "and");
  assert.equal(genreSummary().single, "any");
});

// --- every other shape reports the count and the mode that bites ----------------

test("test_a_genre_beside_any_under_the_or_mode_counts_both_picks", async () => {
  await pick(["classical", "any"], "or");
  assert.equal(genreSummary().count, 2);
});

test("test_a_genre_beside_any_under_the_or_mode_names_the_or_mode", async () => {
  await pick(["classical", "any"], "or");
  assert.equal(genreSummary().mode, "or");
});

test("test_two_ordinary_genres_under_the_and_mode_count_both_picks", async () => {
  await pick(["classical", "electronic"], "and");
  assert.equal(genreSummary().count, 2);
});

test("test_two_ordinary_genres_under_the_and_mode_name_the_and_mode", async () => {
  await pick(["classical", "electronic"], "and");
  assert.equal(genreSummary().mode, "and");
});

test("test_one_ordinary_genre_under_the_and_mode_reports_that_genres_own_value", async () => {
  await pick(["classical"], "and");
  assert.equal(genreSummary().single, "classical");
});

test("test_one_ordinary_genre_names_no_combine_mode", async () => {
  // One pick cannot be combined with anything, so the mode is not yet biting.
  await pick(["classical"], "and");
  assert.equal(genreSummary().mode, null);
});
