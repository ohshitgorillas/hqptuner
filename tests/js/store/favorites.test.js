// Behavioral suite for favorite filters (store/narrow/favorites.js) and their
// integration with narrowing (store/narrow/state.js `nFavOnly`): a filter NAME the
// user has starred — now kept on the SERVER, so every browser sees the same
// stars — and an optional favorites-only facet that ANDs with the ordinary
// narrowing facets.
//
// Persistence is one REST pair, GET/PUT /api/favorites, driven through the
// wire fake in ../support/favoriteswire.js (docs/testing.md rule 4 — real path,
// real shapes, nothing of ours stubbed). `toggleFavorite` is optimistic: it
// moves the set first and reverts if the PUT fails, so the cases that pin what
// the user sees BEFORE the answer arrives park the fake with `hold` rather than
// waiting on a clock (rule 7).
//
// localStorage is no longer where favorites live; it survives only as the
// one-shot migration source hydration drains INTO the server's list, as a
// union. The fake storage is therefore installed for the migration cases alone
// and removed after every test.
//
// `nFavOnly` stays client-only and unpersisted.
//
// Facet data is driven the way narrowing.test.js drives it — by assigning the
// two source signals the real payloads carry (`enums.filters`, the engine's
// `<GetFilters/>` enumeration, protocol.md:226, and `metadata.filters.filters`,
// the static overlay from /api/metadata) — descriptions hand-written in the
// engine's own format with the PCM glyph.
//
// `reset()` reassigns both source signals, resets narrowing, empties the
// favorites set and the error line, and forces favorites-only off: module-level
// signals outlive a test, and a partial reset makes tests pass alone and fail in
// sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/favorites.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { useStorage, dropStorage } from "../support/storage.js";
import { favoritesWire, puts, settle } from "../support/favoriteswire.js";
import {
  favoriteFilters,
  favoritesError,
  nFavOnly,
  isFavorite,
  toggleFavorite,
  hydrateFavorites,
} from "../../../hqptuner/static/store/narrow/favorites.js";
import { nFocus, narrowingActive, resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { narrowOptions, narrowCount, previewCount } from "../../../hqptuner/static/store/narrow/match.js";
import { resetFilterFacets } from "../support/filterfacets.js";

const FAVORITES_MODULE = "../../../hqptuner/static/store/narrow/favorites.js";
const LEGACY_KEY = "hqptuner.favoriteFilters";

const favOnlyAtLoad = nFavOnly.value;

const STAGE = "nx";
const FIELD = "pcm_filter_nx";

/**
 * The global the fetch fake is installed on, viewed as an optional member: the
 * DOM lib declares `fetch` as always present, and the no-fetch environment is
 * one of the cases under test.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/**
 * One fixture row: a filter name, its hand-written description, and an
 * optional `arg` bitfield (apodizing is bit 0).
 *
 * @typedef {[name: string, description: string, arg?: number]} FixtureRow
 */

/**
 * One dropdown option as `reset()` and `narrowOptions` both build/consume it.
 *
 * @typedef {{ label: string, value: string }} Option
 */

/**
 * @param {FixtureRow[]} filters
 * @returns {Option[]}
 */
function reset(filters) {
  favoritesWire();
  const options = resetFilterFacets(filters);
  favoriteFilters.value = new Set();
  favoritesError.value = "";
  nFavOnly.value = false;
  return options;
}

// Narrowing judges every option on the facets alone: the selection the dropdown
// happens to be showing gets no exemption, so there is nothing to tell it about.
/**
 * @param {Option[]} options
 * @param {string} [stage]
 * @param {string} [field]
 */
const labels = (options, stage = STAGE, field = FIELD) => narrowOptions(options, stage, field).map((o) => o.label);

afterEach(dropStorage);

// --- fixtures ----------------------------------------------------------------
// Names carry no phase, length or hires marker, so nothing narrows by a facet a
// case did not engage.

/** @type {FixtureRow[]} */
const PLAIN = [
  ["gauss-a", "5/5 ⥮ Any"],
  ["gauss-b", "5/5 ⥮ Any"],
  ["gauss-c", "4/5 ⥮ Any"],
  ["gauss-d", "4/5 ⥮ Any"],
];

/** @type {FixtureRow[]} */
const FOCUS = [
  ["gauss-a", "5/5 timbre, transients ⥮ Any"],
  ["gauss-b", "5/5 timbre ⥮ Any"],
  ["gauss-c", "4/5 transients ⥮ Any"],
  ["gauss-d", "4/5 timbre, transients, space ⥮ Any"],
];

// --- the set itself -----------------------------------------------------------

test("test_toggling_a_name_marks_it_favorite", async () => {
  reset(PLAIN);
  await toggleFavorite("gauss-a");
  assert.equal(isFavorite("gauss-a"), true);
});

test("test_toggling_a_name_again_unmarks_it", async () => {
  reset(PLAIN);
  await toggleFavorite("gauss-a");
  await toggleFavorite("gauss-a");
  assert.equal(isFavorite("gauss-a"), false);
});

// --- the star lands before the server answers ----------------------------------

test("test_a_toggle_stars_the_name_before_its_request_resolves", async () => {
  reset(PLAIN);
  const w = favoritesWire();
  w.hold = true;
  const pending = toggleFavorite("gauss-a");
  await settle();
  const starredWhileInFlight = favoriteFilters.value.has("gauss-a");
  w.release();
  await pending;
  assert.equal(starredWhileInFlight, true);
});

// --- what the toggle sends -----------------------------------------------------

test("test_a_toggle_puts_the_whole_resulting_set_of_names", async () => {
  reset(PLAIN);
  const w = favoritesWire();
  await toggleFavorite("gauss-a");
  await toggleFavorite("gauss-c");
  assert.deepEqual([...(puts(w).at(-1) || [])].sort(), ["gauss-a", "gauss-c"]);
});

test("test_a_toggle_that_unstars_puts_the_set_without_that_name", async () => {
  reset(PLAIN);
  const w = favoritesWire();
  await toggleFavorite("gauss-a");
  await toggleFavorite("gauss-c");
  await toggleFavorite("gauss-a");
  assert.deepEqual([...(puts(w).at(-1) || [])].sort(), ["gauss-c"]);
});

// --- a refused save ------------------------------------------------------------

test("test_a_failed_save_reverts_the_favorites_set", async () => {
  reset(PLAIN);
  favoritesWire({ putStatus: 500, putDetail: "State directory is read-only." });
  await toggleFavorite("gauss-a");
  assert.equal(favoriteFilters.value.has("gauss-a"), false);
});

test("test_a_failed_save_reverts_an_unstar_too", async () => {
  reset(PLAIN);
  favoritesWire();
  await toggleFavorite("gauss-a");
  favoritesWire({ putStatus: 500, putDetail: "State directory is read-only." });
  await toggleFavorite("gauss-a");
  assert.equal(favoriteFilters.value.has("gauss-a"), true);
});

test("test_a_successful_save_leaves_no_error", async () => {
  reset(PLAIN);
  favoritesWire();
  await toggleFavorite("gauss-a");
  assert.equal(favoritesError.value, "");
});

test("test_a_toggle_clears_the_previous_errors_sentence_before_asking", async () => {
  reset(PLAIN);
  favoritesWire({ putStatus: 500, putDetail: "State directory is read-only." });
  await toggleFavorite("gauss-a");
  const w = favoritesWire();
  w.hold = true;
  const pending = toggleFavorite("gauss-b");
  await settle();
  const errorWhileInFlight = favoritesError.value;
  w.release();
  await pending;
  assert.equal(errorWhileInFlight, "");
});

// --- hydration -----------------------------------------------------------------

test("test_hydration_fills_the_set_from_the_server", async () => {
  reset(PLAIN);
  favoritesWire({ filters: ["gauss-b", "gauss-d"] });
  await hydrateFavorites();
  assert.deepEqual([...favoriteFilters.value].sort(), ["gauss-b", "gauss-d"]);
});

// The set is populated BEFORE the failing GET, because the behavior that
// matters is a backend down at page load leaving the stars already on screen
// alone: a hydration that clobbers the set on the way to failing passes any
// check made against a set the reset just emptied.
test("test_a_failed_hydration_leaves_the_favorites_already_starred_alone", async () => {
  reset(PLAIN);
  favoritesWire();
  await toggleFavorite("gauss-a");
  favoritesWire({ getStatus: 503, getDetail: "Favorites are unavailable." });
  await hydrateFavorites();
  assert.deepEqual([...favoriteFilters.value], ["gauss-a"]);
});

test("test_a_failed_hydration_does_not_throw", async () => {
  reset(PLAIN);
  favoritesWire({ getStatus: 503, getDetail: "Favorites are unavailable." });
  await assert.doesNotReject(() => hydrateFavorites());
});

// --- the one-shot migration out of localStorage ---------------------------------
// The pre-server build kept the starred names in localStorage under
// "hqptuner.favoriteFilters". Hydration UNIONs them with whatever the server
// already held — empty server or not, so the second device to load is not
// stranded showing the first machine's stars — and then the key is gone for
// good. A browser with no legacy names contributes nothing and must not write.

test("test_hydration_uploads_the_names_localstorage_still_holds", async () => {
  reset(PLAIN);
  const w = favoritesWire({ filters: [] });
  useStorage().map.set(LEGACY_KEY, JSON.stringify(["gauss-a", "gauss-c"]));
  await hydrateFavorites();
  assert.deepEqual([...(puts(w).at(-1) || [])].sort(), ["gauss-a", "gauss-c"]);
});

test("test_hydration_uploads_the_union_when_the_server_already_has_names", async () => {
  reset(PLAIN);
  const w = favoritesWire({ filters: ["gauss-d"] });
  useStorage().map.set(LEGACY_KEY, JSON.stringify(["gauss-a", "gauss-c"]));
  await hydrateFavorites();
  assert.deepEqual([...(puts(w).at(-1) || [])].sort(), ["gauss-a", "gauss-c", "gauss-d"]);
});

test("test_a_name_the_server_already_held_survives_the_migration", async () => {
  reset(PLAIN);
  favoritesWire({ filters: ["gauss-d"] });
  useStorage().map.set(LEGACY_KEY, JSON.stringify(["gauss-a"]));
  await hydrateFavorites();
  assert.equal(favoriteFilters.value.has("gauss-d"), true);
});

test("test_the_migrated_names_end_up_in_the_favorites_set", async () => {
  reset(PLAIN);
  favoritesWire({ filters: [] });
  useStorage().map.set(LEGACY_KEY, JSON.stringify(["gauss-a", "gauss-c"]));
  await hydrateFavorites();
  assert.deepEqual([...favoriteFilters.value].sort(), ["gauss-a", "gauss-c"]);
});

test("test_the_favorites_set_holds_the_union_after_the_migration", async () => {
  reset(PLAIN);
  favoritesWire({ filters: ["gauss-d"] });
  useStorage().map.set(LEGACY_KEY, JSON.stringify(["gauss-a", "gauss-c"]));
  await hydrateFavorites();
  assert.deepEqual([...favoriteFilters.value].sort(), ["gauss-a", "gauss-c", "gauss-d"]);
});

test("test_migration_removes_the_localstorage_key", async () => {
  reset(PLAIN);
  favoritesWire({ filters: [] });
  const storage = useStorage();
  storage.map.set(LEGACY_KEY, JSON.stringify(["gauss-a"]));
  await hydrateFavorites();
  assert.equal(storage.map.has(LEGACY_KEY), false);
});

test("test_migration_removes_the_localstorage_key_when_the_server_already_has_names", async () => {
  reset(PLAIN);
  favoritesWire({ filters: ["gauss-d"] });
  const storage = useStorage();
  storage.map.set(LEGACY_KEY, JSON.stringify(["gauss-a"]));
  await hydrateFavorites();
  assert.equal(storage.map.has(LEGACY_KEY), false);
});

// "localStorage holds no names" covers both shapes a browser can be in: no key
// at all, and a key left holding an empty list. Neither may provoke a write.

test("test_hydration_with_no_legacy_key_puts_nothing", async () => {
  reset(PLAIN);
  const w = favoritesWire({ filters: ["gauss-d"] });
  useStorage();
  await hydrateFavorites();
  assert.deepEqual(puts(w), []);
});

test("test_hydration_with_an_empty_legacy_key_puts_nothing", async () => {
  reset(PLAIN);
  const w = favoritesWire({ filters: ["gauss-d"] });
  useStorage().map.set(LEGACY_KEY, JSON.stringify([]));
  await hydrateFavorites();
  assert.deepEqual(puts(w), []);
});

// --- loading the module ---------------------------------------------------------
// A fresh instance comes from a dynamic import under a `.fresh-<tag>.js`
// specifier, resolved by tests/js/support/vendor-resolve.js to the real
// module's source under a URL node has not cached (and that does not alias
// its coverage onto the real instance's); the specifier is built rather than
// literal because it names a file that is not on disk, which `tsc -p
// jsconfig.json` refuses as a literal (TS2307).

test("test_favorites_only_defaults_off", () => {
  assert.equal(favOnlyAtLoad, false);
});

test("test_favorites_only_is_not_persisted_across_a_fresh_load", async () => {
  reset(PLAIN);
  favoritesWire();
  useStorage();
  await toggleFavorite("gauss-a");
  nFavOnly.value = true;
  const fresh = await import(`${FAVORITES_MODULE.replace(/\.js$/, ".fresh-favonly.js")}`);
  assert.equal(fresh.nFavOnly.value, false);
});

test("test_loading_the_module_without_fetch_does_not_throw", async () => {
  delete env.fetch;
  await assert.doesNotReject(() => import(`${FAVORITES_MODULE.replace(/\.js$/, ".fresh-nofetch.js")}`));
});

test("test_loading_the_module_without_fetch_leaves_no_rejected_promise", async () => {
  /** @type {unknown[]} */
  const unhandled = [];
  /** @param {unknown} reason */
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  delete env.fetch;
  await import(`${FAVORITES_MODULE.replace(/\.js$/, ".fresh-nofetch2.js")}`).catch(() => {});
  await settle();
  await new Promise((resolve) => setImmediate(resolve));
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, []);
});

// --- favorites-only off: favorites are inert ----------------------------------

test("test_with_favorites_only_off_favorites_change_the_offered_list_not_at_all", async () => {
  const options = reset(PLAIN);
  await toggleFavorite("gauss-b");
  assert.deepEqual(labels(options), ["gauss-a", "gauss-b", "gauss-c", "gauss-d"]);
});

// --- favorites-only on: exactly the favorites ---------------------------------
// The dropdown is showing gauss-a (value "0") in both cases below and gauss-a is
// not favorited: an engaged facet judges the current selection like any other
// option, so it is not offered.

test("test_favorites_only_offers_exactly_the_favorites", async () => {
  const options = reset(PLAIN);
  await toggleFavorite("gauss-b");
  await toggleFavorite("gauss-d");
  nFavOnly.value = true;
  assert.deepEqual(labels(options), ["gauss-b", "gauss-d"]);
});

test("test_favorites_only_ands_with_an_engaged_facet", async () => {
  const options = reset(FOCUS);
  await toggleFavorite("gauss-b");
  await toggleFavorite("gauss-c");
  nFocus.value = ["timbre"];
  nFavOnly.value = true;
  // timbre keeps a, b, d; the favorites are b and c; only b passes both.
  assert.deepEqual(labels(options), ["gauss-b"]);
});

// --- the counts follow the engaged favorites -----------------------------------

test("test_the_badge_count_includes_only_favorites_while_engaged", async () => {
  const options = reset(PLAIN);
  await toggleFavorite("gauss-a");
  await toggleFavorite("gauss-c");
  nFavOnly.value = true;
  assert.equal(narrowCount(options, STAGE, FIELD).n, 2);
});

test("test_a_preview_count_includes_only_favorites_while_engaged", async () => {
  const options = reset(FOCUS);
  await toggleFavorite("gauss-a");
  await toggleFavorite("gauss-b");
  nFavOnly.value = true;
  // timbre keeps a, b, d; of those only a and b are favorited.
  assert.equal(previewCount(options, STAGE, FIELD, { focus: ["timbre"] }), 2);
});

// --- favorites-only as narrowing state ------------------------------------------

test("test_favorites_only_is_active_narrowing", async () => {
  reset(PLAIN);
  await toggleFavorite("gauss-a");
  nFavOnly.value = true;
  assert.equal(narrowingActive.value, true);
});

test("test_reset_turns_favorites_only_off", async () => {
  reset(PLAIN);
  await toggleFavorite("gauss-a");
  nFavOnly.value = true;
  resetNarrowing();
  assert.equal(nFavOnly.value, false);
});

test("test_reset_keeps_the_favorites_set", async () => {
  reset(PLAIN);
  await toggleFavorite("gauss-a");
  nFavOnly.value = true;
  resetNarrowing();
  assert.equal(isFavorite("gauss-a"), true);
});

// --- removing favorites while engaged -------------------------------------------

test("test_removing_the_last_favorite_turns_favorites_only_off", async () => {
  reset(PLAIN);
  await toggleFavorite("gauss-a");
  nFavOnly.value = true;
  await toggleFavorite("gauss-a");
  assert.equal(nFavOnly.value, false);
});

test("test_removing_a_favorite_that_is_not_the_last_keeps_favorites_only_on", async () => {
  reset(PLAIN);
  await toggleFavorite("gauss-a");
  await toggleFavorite("gauss-b");
  nFavOnly.value = true;
  await toggleFavorite("gauss-a");
  assert.equal(nFavOnly.value, true);
});

// --- one set of favorites, shared by name across all four filter dropdowns ------
// Both 1x controls start at their neutral value — apodizing "all", sources
// "both" — so a fresh bar narrows nothing at all and the only narrowing in play
// is the favorite itself, toggled ONCE, never per field.

/** @type {FixtureRow[]} */
const SHARED = [
  ["gauss-apod-a", "5/5 ⥮ Any", 1],
  ["gauss-apod-b", "4/5 ⥮ Any", 1],
];

for (const [stage, field] of [
  ["1x", "pcm_filter_1x"],
  ["nx", "pcm_filter_nx"],
  ["1x", "sdm_filter_1x"],
  ["nx", "sdm_filter_nx"],
]) {
  test(`test_one_favorite_toggle_reaches_the_${field}_dropdown`, async () => {
    const options = reset(SHARED);
    await toggleFavorite("gauss-apod-a");
    nFavOnly.value = true;
    assert.deepEqual(labels(options, stage, field), ["gauss-apod-a"]);
  });
}
