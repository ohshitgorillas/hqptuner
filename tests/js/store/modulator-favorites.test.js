// Behavioral suite for favorite MODULATOR names (store/narrow/favorites.js) and
// the narrowing rule they share with favorite filters (store/narrow/match.js
// `favOnlyModulators`, `narrowOptions`).
//
// Two sets now, one file, one REST pair: GET /api/favorites answers
// {filters, modulators} and PUT replaces whichever member it carries. The wire
// fake in ../support/favoriteswire.js speaks exactly that (docs/testing.md
// rule 4 — real path, real shapes, nothing of HQPTuner's stubbed), and holds
// both lists so "the toggle sends the whole resulting set" is observable rather
// than assumed. `toggleFavoriteModulator` is optimistic, like its filter
// counterpart: the case that pins what the user sees BEFORE the answer arrives
// parks the fake with `hold` rather than waiting on a clock (rule 7).
//
// The binding rule of the feature: favorites-only narrowing applies PER SET,
// and a set with nothing in it narrows nothing. Star a modulator and the
// modulator dropdown offers the starred ones; star none and it offers all of
// them, filter stars notwithstanding — and the other way round for filters.
// Favorites-only itself is one flag over both sets, so it stays engaged while
// EITHER set still holds a star and goes off when the last star of both goes.
//
// Filter facet data is driven the way favorites.test.js drives it — the two
// source signals the real payloads carry (`enums.filters`, the engine's
// <GetFilters/> enumeration, and `metadata.filters.filters`, the static overlay
// from /api/metadata) — with descriptions in the engine's own format so no
// facet a case did not engage trims anything.
//
// `reset()` reassigns both source signals, resets narrowing, empties BOTH
// favorite sets and the error line and forces favorites-only off: module-level
// signals outlive a test, and a partial reset makes cases pass alone and fail in
// sequence.
//
// AMBIGUITY, and the reading taken: the spec names `favOnlyModulators(options)`
// without saying which member of an option carries the modulator NAME. The
// filter side matches on `label` (the raw engine name the dropdown renders in
// Standard style), so these cases build options of the same `{label, value}`
// shape and expect the same join key. A different key would fail here.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/modulator-favorites.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { favoritesWire, puts, modulatorPuts, settle } from "../support/favoriteswire.js";
import {
  favoriteFilters,
  favoriteModulators,
  favoritesError,
  nFavOnly,
  isFavorite,
  isFavoriteModulator,
  toggleFavorite,
  toggleFavoriteModulator,
  hydrateFavorites,
} from "../../../hqptuner/static/store/narrow/favorites.js";
import { narrowOptions, favOnlyModulators } from "../../../hqptuner/static/store/narrow/match.js";
import { resetFilterFacets } from "../support/filterfacets.js";

const STAGE = "nx";
const FIELD = "pcm_filter_nx";

// Four filters, none carrying a phase, length or hires marker, every one rated
// above the quality floor with ratio "Any": nothing narrows unless a case
// engages it.
const FILTERS = ["gauss-a", "gauss-b", "gauss-c", "gauss-d"];

// Raw engine modulator names, the join key the favorites record and the shaper
// overlay share (docs/architecture.md §2).
const MODULATORS = ["ASDM7", "ASDM7EC", "AHM5EC5L", "DSD7 256+fs"];

/**
 * One dropdown option as the store builds and consumes it.
 *
 * @typedef {{ label: string, value: string }} Option
 */

/**
 * @param {string[]} names
 * @returns {Option[]}
 */
const options = (names) => names.map((label, i) => ({ label, value: String(i) }));

const FILTER_OPTIONS = options(FILTERS);
const MODULATOR_OPTIONS = options(MODULATORS);

function reset() {
  favoritesWire();
  resetFilterFacets(FILTERS.map((name) => [name, "5/5 ⥮ Any"]));
  favoriteFilters.value = new Set();
  favoriteModulators.value = new Set();
  favoritesError.value = "";
  nFavOnly.value = false;
}

/** @param {Option[]} opts */
const filterLabels = (opts) => narrowOptions(opts, STAGE, FIELD).map((o) => o.label);

/** @param {Option[]} opts */
const modulatorLabels = (opts) => favOnlyModulators(opts).map((o) => o.label);

// --- the set itself ------------------------------------------------------------

test("test_toggling_a_modulator_name_marks_it_favorite", async () => {
  reset();
  await toggleFavoriteModulator("ASDM7EC");
  assert.equal(isFavoriteModulator("ASDM7EC"), true);
});

test("test_toggling_a_modulator_name_again_unmarks_it", async () => {
  reset();
  await toggleFavoriteModulator("ASDM7EC");
  await toggleFavoriteModulator("ASDM7EC");
  assert.equal(isFavoriteModulator("ASDM7EC"), false);
});

test("test_starring_a_modulator_leaves_the_filter_set_alone", async () => {
  reset();
  await toggleFavoriteModulator("ASDM7EC");
  assert.equal(isFavorite("ASDM7EC"), false);
});

test("test_starring_a_filter_leaves_the_modulator_set_alone", async () => {
  reset();
  await toggleFavorite("gauss-a");
  assert.equal(isFavoriteModulator("gauss-a"), false);
});

// --- the star lands before the server answers -----------------------------------

test("test_a_modulator_toggle_stars_the_name_before_its_request_resolves", async () => {
  reset();
  const w = favoritesWire();
  w.hold = true;
  const pending = toggleFavoriteModulator("ASDM7EC");
  await settle();
  const starredWhileInFlight = favoriteModulators.value.has("ASDM7EC");
  w.release();
  await pending;
  assert.equal(starredWhileInFlight, true);
});

// --- what the toggle sends --------------------------------------------------------

test("test_a_modulator_toggle_puts_the_whole_resulting_set_of_names", async () => {
  reset();
  const w = favoritesWire();
  await toggleFavoriteModulator("ASDM7");
  await toggleFavoriteModulator("AHM5EC5L");
  assert.deepEqual([...(modulatorPuts(w).at(-1) || [])].sort(), ["AHM5EC5L", "ASDM7"]);
});

test("test_a_modulator_toggle_that_unstars_puts_the_set_without_that_name", async () => {
  reset();
  const w = favoritesWire();
  await toggleFavoriteModulator("ASDM7");
  await toggleFavoriteModulator("AHM5EC5L");
  await toggleFavoriteModulator("ASDM7");
  assert.deepEqual([...(modulatorPuts(w).at(-1) || [])].sort(), ["AHM5EC5L"]);
});

// A modulator toggle must not carry a filter list the server would then store:
// the two sets are replaced independently, and a body naming both would make a
// modulator star overwrite whatever another tab starred.
test("test_a_modulator_toggle_sends_no_filter_list", async () => {
  reset();
  const w = favoritesWire();
  await toggleFavoriteModulator("ASDM7");
  assert.equal(puts(w).at(-1), undefined);
});

test("test_a_filter_toggle_sends_no_modulator_list", async () => {
  reset();
  const w = favoritesWire();
  await toggleFavorite("gauss-a");
  assert.equal(modulatorPuts(w).at(-1), undefined);
});

// --- a refused save ----------------------------------------------------------------

test("test_a_failed_modulator_save_reverts_the_set", async () => {
  reset();
  favoritesWire({ putStatus: 500, putDetail: "State directory is read-only." });
  await toggleFavoriteModulator("ASDM7EC");
  assert.equal(favoriteModulators.value.has("ASDM7EC"), false);
});

test("test_a_failed_modulator_save_reverts_an_unstar_too", async () => {
  reset();
  favoritesWire();
  await toggleFavoriteModulator("ASDM7EC");
  favoritesWire({ putStatus: 500, putDetail: "State directory is read-only." });
  await toggleFavoriteModulator("ASDM7EC");
  assert.equal(favoriteModulators.value.has("ASDM7EC"), true);
});

test("test_a_failed_modulator_save_reports_the_sentence_the_server_sent", async () => {
  reset();
  favoritesWire({ putStatus: 500, putDetail: "State directory is read-only." });
  await toggleFavoriteModulator("ASDM7EC");
  assert.equal(favoritesError.value, "State directory is read-only.");
});

test("test_a_successful_modulator_save_leaves_no_error", async () => {
  reset();
  favoritesWire();
  await toggleFavoriteModulator("ASDM7EC");
  assert.equal(favoritesError.value, "");
});

// --- hydration ----------------------------------------------------------------------

test("test_hydration_fills_the_modulator_set_from_the_server", async () => {
  reset();
  favoritesWire({ modulators: ["ASDM7", "AHM5EC5L"] });
  await hydrateFavorites();
  assert.deepEqual([...favoriteModulators.value].sort(), ["AHM5EC5L", "ASDM7"]);
});

test("test_hydration_fills_the_two_sets_from_their_own_members", async () => {
  reset();
  favoritesWire({ filters: ["gauss-b"], modulators: ["ASDM7"] });
  await hydrateFavorites();
  assert.deepEqual([...favoriteFilters.value].sort(), ["gauss-b"]);
});

// --- favorites-only: each set narrows its own dropdown ---------------------------------

test("test_favorites_only_offers_exactly_the_starred_modulators", async () => {
  reset();
  await toggleFavoriteModulator("ASDM7EC");
  await toggleFavoriteModulator("DSD7 256+fs");
  nFavOnly.value = true;
  assert.deepEqual(modulatorLabels(MODULATOR_OPTIONS), ["ASDM7EC", "DSD7 256+fs"]);
});

// The binding rule: an empty set narrows nothing. A user who stars filters only
// still sees every modulator, rather than an empty modulator dropdown.
test("test_favorites_only_with_no_modulator_starred_offers_every_modulator", async () => {
  reset();
  await toggleFavorite("gauss-a");
  nFavOnly.value = true;
  assert.deepEqual(modulatorLabels(MODULATOR_OPTIONS), MODULATORS);
});

test("test_favorites_only_with_no_star_at_all_offers_every_modulator", () => {
  reset();
  nFavOnly.value = true;
  assert.deepEqual(modulatorLabels(MODULATOR_OPTIONS), MODULATORS);
});

test("test_favorites_only_with_no_filter_starred_offers_every_filter", async () => {
  reset();
  await toggleFavoriteModulator("ASDM7EC");
  nFavOnly.value = true;
  assert.deepEqual(filterLabels(FILTER_OPTIONS), FILTERS);
});

test("test_favorites_only_with_no_star_at_all_offers_every_filter", () => {
  reset();
  nFavOnly.value = true;
  assert.deepEqual(filterLabels(FILTER_OPTIONS), FILTERS);
});

// --- favorites-only off: the stars are inert -----------------------------------------

test("test_with_favorites_only_off_a_starred_modulator_changes_the_modulator_list_not_at_all", async () => {
  reset();
  await toggleFavoriteModulator("ASDM7EC");
  assert.deepEqual(modulatorLabels(MODULATOR_OPTIONS), MODULATORS);
});

test("test_with_favorites_only_off_a_starred_filter_changes_the_filter_list_not_at_all", async () => {
  reset();
  await toggleFavorite("gauss-b");
  assert.deepEqual(filterLabels(FILTER_OPTIONS), FILTERS);
});

// --- one flag over both sets -----------------------------------------------------------

test("test_unstarring_the_last_modulator_while_a_filter_is_starred_keeps_favorites_only_on", async () => {
  reset();
  await toggleFavorite("gauss-a");
  await toggleFavoriteModulator("ASDM7EC");
  nFavOnly.value = true;
  await toggleFavoriteModulator("ASDM7EC");
  assert.equal(nFavOnly.value, true);
});

test("test_unstarring_the_last_filter_while_a_modulator_is_starred_keeps_favorites_only_on", async () => {
  reset();
  await toggleFavorite("gauss-a");
  await toggleFavoriteModulator("ASDM7EC");
  nFavOnly.value = true;
  await toggleFavorite("gauss-a");
  assert.equal(nFavOnly.value, true);
});

test("test_unstarring_the_last_star_of_both_sets_turns_favorites_only_off", async () => {
  reset();
  await toggleFavorite("gauss-a");
  await toggleFavoriteModulator("ASDM7EC");
  nFavOnly.value = true;
  await toggleFavorite("gauss-a");
  await toggleFavoriteModulator("ASDM7EC");
  assert.equal(nFavOnly.value, false);
});

test("test_unstarring_the_only_modulator_with_no_filter_starred_turns_favorites_only_off", async () => {
  reset();
  await toggleFavoriteModulator("ASDM7EC");
  nFavOnly.value = true;
  await toggleFavoriteModulator("ASDM7EC");
  assert.equal(nFavOnly.value, false);
});
