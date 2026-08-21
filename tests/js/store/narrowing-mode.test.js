// Behavioral suite for the per-facet AND/OR combine mode on the two multi-select
// narrowing facets (store/narrow/state.js for the signals, store/narrow/match.js for
// the matching, components/narrowbar/labels.js for the button wording).
//
// Genre and focus are both SETS a filter carries, and each now decides for
// itself how a multi-value pick combines: genre defaults to `or` (any one picked
// genre is enough), focus defaults to `and` (every picked focus must be
// carried). The two escape hatches differ too — the manual's `any` genre suits
// every genre selection whichever mode is set, while focus has no such token, so
// a filter carrying no focus at all fails every non-empty focus pick.
//
// Policy (docs/testing.md): public API only, one assertion per test, no store
// function stubbed. Facet data is driven by assigning the two source signals the
// real payloads carry — `enums.filters` is the running engine's `<GetFilters/>`
// enumeration (`{index, name, value, arg, description}`, protocol.md:226) and
// `metadata.filters.filters` is the static name-keyed overlay served by
// /api/metadata. Descriptions are in the engine's own format,
// `"<q>/5 [focus, ...] <glyph> <ratio>"`, with the PCM glyph `⥮` because every
// fixture is read through a PCM field. No count comes from the shipped data
// files.
//
// `reset()` reassigns BOTH source signals and calls resetNarrowing() on every
// case: module-level signals outlive a test, and a partial reset makes tests
// pass alone and fail in sequence.
//
// Every case reads the Nx stage. No per-stage control starts narrowed at either
// stage now — apodizing is "all" at both and the 1x lossy-source control starts
// at "both" — and those controls are tests/js/store/narrowing-lossy.test.js's
// subject.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrowing-mode.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  nGenre,
  nFocus,
  nGenreMode,
  nFocusMode,
  narrowingActive,
  resetNarrowing,
} from "../../../hqptuner/static/store/narrow/state.js";
import { narrowOptions, narrowCount, previewCount } from "../../../hqptuner/static/store/narrow/match.js";
import { genreLabel, focusLabel } from "../../../hqptuner/static/components/narrowbar/labels.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

const STAGE = "nx";
const FIELD = "pcm_filter_nx";

/**
 * A fixture row: filter name and its facet description.
 *
 * @typedef {[string, string]} FilterTuple
 */

/**
 * The two members `narrowOptions` reads off a dropdown option.
 *
 * @typedef {{ value: string | number | undefined, label: string }} NarrowOption
 */

// One `<FiltersItem/>` as the enumeration serves it. `arg` is the flags
// bitfield, bit 0 = apodizing (protocol.md:226); the backend derives the
// `apodizing` field from that same bit, so the two always agree.
const item = (/** @type {string} */ name, /** @type {string} */ description, /** @type {number} */ index) => ({
  index: String(index),
  name,
  value: String(index),
  arg: 0,
  description,
  apodizing: false,
});

/**
 * @param {FilterTuple[]} filters
 * @param {Record<string, { genre?: string[] }>} [overlay]
 * @returns {NarrowOption[]}
 */
function reset(filters, overlay = {}) {
  enums.value = { filters: filters.map(([name, desc], i) => item(name, desc, i)) };
  metadata.value = {
    settings: {},
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
  return filters.map(([name], i) => ({ label: name, value: String(i) }));
}

/** @param {NarrowOption[]} options */
const labels = (options) => narrowOptions(options, STAGE, FIELD).map((o) => o.label);

// --- fixtures ----------------------------------------------------------------
// Names carry no phase (-lp/-mp/-ip), length (short/long) or hires marker, so
// nothing narrows by a facet no case picked.

// Focus, as the engine spells it: a comma-separated set between quality and
// glyph. `gauss-d` carries none at all — the case with no escape hatch.
/** @type {FilterTuple[]} */
const FOCUS = [
  ["gauss-a", "5/5 timbre, transients ⥮ Any"],
  ["gauss-b", "5/5 timbre ⥮ Any"],
  ["gauss-c", "4/5 transients ⥮ Any"],
  ["gauss-d", "4/5 ⥮ Any"],
];

// Two filters alike in everything the narrow bar reads except that one carries
// no focus at all, so a case run past this pair turns on that one difference:
// the tagged filter passes in either mode, and only the untagged one can move
// the answer.
/** @type {FilterTuple[]} */
const FOCUS_UNTAGGED = [
  ["gauss-tagged", "5/5 timbre, transients ⥮ Any"],
  ["gauss-untagged", "5/5 ⥮ Any"],
];

// Genre lives only in the static overlay; these five carry no focus at all.
// `gauss-e` is tagged with a genre no case picks alongside it, so an OR over the
// picked genres leaves it out and the expected result of a case is never the
// whole list — a genre facet dropped altogether would answer five.
/** @type {FilterTuple[]} */
const PLAIN = [
  ["gauss-a", "5/5 ⥮ Any"],
  ["gauss-b", "5/5 ⥮ Any"],
  ["gauss-c", "4/5 ⥮ Any"],
  ["gauss-d", "4/5 ⥮ Any"],
  ["gauss-e", "4/5 ⥮ Any"],
];

// `any` is the manual's genre-agnostic tag: a real genre value meaning "suits
// all genres", distinct from picking no genre at all.
const GENRES = {
  "gauss-a": { genre: ["jazz", "classical"] },
  "gauss-b": { genre: ["jazz"] },
  "gauss-c": { genre: ["any"] },
  "gauss-d": { genre: ["classical"] },
  "gauss-e": { genre: ["pop"] },
};

// --- genre combines by its own mode -------------------------------------------

test("test_two_genres_in_and_mode_keep_only_the_filters_tagged_with_both", () => {
  const options = reset(PLAIN, GENRES);
  nGenreMode.value = "and";
  nGenre.value = ["jazz", "classical"];
  assert.deepEqual(labels(options), ["gauss-a", "gauss-c"]);
});

// `gauss-e` is the discriminator: pop is neither picked genre, so an OR still
// leaves it out and a genre facet ignored in or mode would answer five.
test("test_two_genres_in_the_default_mode_keep_every_filter_tagged_with_either_and_no_other", () => {
  const options = reset(PLAIN, GENRES);
  nGenre.value = ["jazz", "classical"];
  assert.deepEqual(labels(options), ["gauss-a", "gauss-b", "gauss-c", "gauss-d"]);
});

// --- the genre-agnostic tag survives either mode --------------------------------

test("test_a_genre_agnostic_filter_survives_every_genre_picked_in_and_mode", () => {
  const options = reset(PLAIN, GENRES);
  nGenreMode.value = "and";
  nGenre.value = ["jazz", "classical", "pop"];
  assert.deepEqual(labels(options), ["gauss-c"]);
});

// "metal" is carried by nothing but the `any` tag, so only the escape hatch can
// answer here — an OR over the picked genre alone would leave the list empty.
test("test_a_genre_agnostic_filter_survives_a_genre_no_filter_carries_in_or_mode", () => {
  const options = reset(PLAIN, GENRES);
  nGenreMode.value = "or";
  nGenre.value = ["metal"];
  assert.deepEqual(labels(options), ["gauss-c"]);
});

// --- focus combines by its own mode ---------------------------------------------

test("test_two_focus_values_in_or_mode_keep_every_filter_carrying_either", () => {
  const options = reset(FOCUS);
  nFocusMode.value = "or";
  nFocus.value = ["timbre", "transients"];
  assert.deepEqual(labels(options), ["gauss-a", "gauss-b", "gauss-c"]);
});

test("test_two_focus_values_in_the_default_mode_keep_only_the_filters_carrying_both", () => {
  const options = reset(FOCUS);
  nFocus.value = ["timbre", "transients"];
  assert.deepEqual(labels(options), ["gauss-a"]);
});

// --- focus has no escape hatch ----------------------------------------------------
// Genre's `any` has no focus counterpart, so an untagged filter is out of every
// non-empty focus pick whichever mode is set. The pair below is one tagged
// filter and one untagged, and the tagged one passes in both modes: the only
// thing either assertion can be reading is the untagged filter's exclusion.

test("test_a_filter_with_no_focus_fails_a_focus_pick_in_or_mode", () => {
  const options = reset(FOCUS_UNTAGGED);
  nFocusMode.value = "or";
  nFocus.value = ["timbre", "transients"];
  assert.deepEqual(labels(options), ["gauss-tagged"]);
});

test("test_a_filter_with_no_focus_fails_a_focus_pick_in_and_mode", () => {
  const options = reset(FOCUS_UNTAGGED);
  nFocusMode.value = "and";
  nFocus.value = ["timbre", "transients"];
  assert.deepEqual(labels(options), ["gauss-tagged"]);
});

// --- a mode alone narrows nothing --------------------------------------------------

test("test_a_genre_mode_with_no_genre_picked_narrows_nothing", () => {
  const options = reset(PLAIN, GENRES);
  nGenreMode.value = "and";
  assert.deepEqual(labels(options), ["gauss-a", "gauss-b", "gauss-c", "gauss-d", "gauss-e"]);
});

test("test_a_focus_mode_with_no_focus_picked_narrows_nothing", () => {
  const options = reset(FOCUS);
  nFocusMode.value = "or";
  assert.deepEqual(labels(options), ["gauss-a", "gauss-b", "gauss-c", "gauss-d"]);
});

test("test_a_genre_mode_alone_is_not_active_narrowing", () => {
  reset(PLAIN, GENRES);
  nGenreMode.value = "and";
  assert.equal(narrowingActive.value, false);
});

test("test_a_focus_mode_alone_is_not_active_narrowing", () => {
  reset(FOCUS);
  nFocusMode.value = "or";
  assert.equal(narrowingActive.value, false);
});

// --- reset returns each mode to its OWN default ------------------------------------
// Not to empty, and not to one shared value: the pair is what tells them apart.
// Each case names the value it expects literally, so it answers what a user gets
// back rather than restating whatever the store exports.

test("test_reset_returns_the_genre_mode_to_or", () => {
  reset(PLAIN, GENRES);
  nGenreMode.value = "and";
  resetNarrowing();
  assert.equal(nGenreMode.value, "or");
});

test("test_reset_returns_the_focus_mode_to_and", () => {
  reset(FOCUS);
  nFocusMode.value = "or";
  resetNarrowing();
  assert.equal(nFocusMode.value, "and");
});

// --- the count beside a dropdown follows the mode -----------------------------------
// The count chips are what a user reads while deciding, so each has to answer
// under the mode that is set. Both cases pick values the two modes disagree
// about, and neither expected number is the fixture's total, so a count taken
// under the default mode or with the facet dropped answers something else.

test("test_the_count_under_a_non_default_genre_mode_is_the_number_tagged_with_both", () => {
  const options = reset(PLAIN, GENRES);
  nGenreMode.value = "and";
  nGenre.value = ["jazz", "classical"];
  assert.equal(narrowCount(options, STAGE, FIELD).n, 2);
});

test("test_the_count_under_a_non_default_focus_mode_is_the_number_carrying_either", () => {
  const options = reset(FOCUS);
  nFocusMode.value = "or";
  nFocus.value = ["timbre", "transients"];
  assert.equal(narrowCount(options, STAGE, FIELD).n, 3);
});

// --- a preview counts under the mode it is handed -------------------------------
// The chip beside a mode row says what the dropdowns would offer if that row
// were clicked, so it has to answer for the mode in its overrides and not the
// one the store is on. Each case leaves the picked values live and overrides the
// mode alone, and the two modes give different numbers — neither of them the
// fixture's total, so a preview that dropped the facet on an override key it did
// not recognize could not answer either.

test("test_a_preview_counts_genres_under_the_mode_in_its_overrides", () => {
  const options = reset(PLAIN, GENRES);
  nGenre.value = ["jazz", "classical"];
  assert.equal(previewCount(options, STAGE, FIELD, { genreMode: "and" }), 2);
});

test("test_a_preview_counts_focus_under_the_mode_in_its_overrides", () => {
  const options = reset(FOCUS);
  nFocus.value = ["timbre", "transients"];
  assert.equal(previewCount(options, STAGE, FIELD, { focusMode: "or" }), 3);
});

// --- the button label carries the mode only where it can matter ---------------------
// One pick or none combines with nothing, so the mode is not in the label; two
// or more, the label ends with the mode.

const MODE_WORD = /\b(and|or)\b/i;

test("test_the_genre_button_with_nothing_picked_reads_any_genre", () => {
  reset(PLAIN, GENRES);
  assert.equal(genreLabel(), "Any genre");
});

test("test_the_focus_button_with_nothing_picked_reads_any_focus", () => {
  reset(FOCUS);
  assert.equal(focusLabel(), "Any focus");
});

test("test_the_genre_button_with_one_pick_carries_no_mode", () => {
  reset(PLAIN, GENRES);
  nGenre.value = ["jazz"];
  assert.equal(MODE_WORD.test(genreLabel()), false);
});

test("test_the_focus_button_with_one_pick_carries_no_mode", () => {
  reset(FOCUS);
  nFocus.value = ["timbre"];
  assert.equal(MODE_WORD.test(focusLabel()), false);
});

test("test_the_genre_button_with_two_picks_ends_with_its_default_mode", () => {
  reset(PLAIN, GENRES);
  nGenre.value = ["jazz", "classical"];
  assert.match(genreLabel(), /\bor$/i);
});

test("test_the_genre_button_with_two_picks_ends_with_and_once_that_mode_is_set", () => {
  reset(PLAIN, GENRES);
  nGenreMode.value = "and";
  nGenre.value = ["jazz", "classical"];
  assert.match(genreLabel(), /\band$/i);
});

test("test_the_focus_button_with_two_picks_ends_with_its_default_mode", () => {
  reset(FOCUS);
  nFocus.value = ["timbre", "transients"];
  assert.match(focusLabel(), /\band$/i);
});

test("test_the_focus_button_with_two_picks_ends_with_or_once_that_mode_is_set", () => {
  reset(FOCUS);
  nFocusMode.value = "or";
  nFocus.value = ["timbre", "transients"];
  assert.match(focusLabel(), /\bor$/i);
});
