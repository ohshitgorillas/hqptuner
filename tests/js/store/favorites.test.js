// Behavioral suite for favorite filters (store/favorites.js) and their
// integration with narrowing (store/narrowing.js `nFavOnly`): a filter NAME the
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
// one-shot migration source hydration drains. The fake storage is therefore
// installed for the migration cases alone and removed after every test.
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
} from "../../../hqptuner/static/store/favorites.js";
import {
  nFocus,
  narrowingActive,
  resetNarrowing,
  narrowOptions,
  narrowCount,
  previewCount,
} from "../../../hqptuner/static/store/narrowing.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

const FAVORITES_MODULE = "../../../hqptuner/static/store/favorites.js";
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

// One `<FiltersItem/>` as the enumeration serves it (protocol.md:226); `arg`
// bit 0 is the apodizing flag and the backend-derived field agrees with it.
/**
 * @param {string} name
 * @param {string} description
 * @param {number} index
 * @param {number} arg
 */
const item = (name, description, index, arg) => ({
  index: String(index),
  name,
  value: String(index),
  arg,
  description,
  apodizing: Boolean(arg & 1),
});

/**
 * @param {FixtureRow[]} filters
 * @returns {Option[]}
 */
function reset(filters) {
  favoritesWire();
  enums.value = { filters: filters.map(([name, desc, arg = 0], i) => item(name, desc, i, arg)) };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
  favoriteFilters.value = new Set();
  favoritesError.value = "";
  nFavOnly.value = false;
  return filters.map(([name], i) => ({ label: name, value: String(i) }));
}

// `current` is the selection the dropdown is showing — the option VALUE, as the
// /config form carries it — which favorites-only must never hide.
/**
 * @param {Option[]} options
 * @param {string} [current]
 * @param {string} [stage]
 * @param {string} [field]
 */
const labels = (options, current = "", stage = STAGE, field = FIELD) =>
  narrowOptions(options, current, stage, field).map((o) => o.label);

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

test("test_a_failed_save_reports_the_sentence_the_server_sent", async () => {
  reset(PLAIN);
  favoritesWire({ putStatus: 500, putDetail: "State directory is read-only." });
  await toggleFavorite("gauss-a");
  assert.equal(favoritesError.value, "State directory is read-only.");
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

test("test_a_failed_hydration_leaves_the_set_empty", async () => {
  reset(PLAIN);
  favoritesWire({ getStatus: 503, getDetail: "Favorites are unavailable." });
  await hydrateFavorites();
  assert.equal(favoriteFilters.value.size, 0);
});

test("test_a_failed_hydration_does_not_throw", async () => {
  reset(PLAIN);
  favoritesWire({ getStatus: 503, getDetail: "Favorites are unavailable." });
  await assert.doesNotReject(() => hydrateFavorites());
});

// --- the one-shot migration out of localStorage ---------------------------------
// The pre-server build kept the starred names in localStorage under
// "hqptuner.favoriteFilters". Hydration adopts them ONCE, when the server has
// nothing of its own, and then the key is gone for good.

test("test_hydration_uploads_the_names_localstorage_still_holds", async () => {
  reset(PLAIN);
  const w = favoritesWire({ filters: [] });
  useStorage().map.set(LEGACY_KEY, JSON.stringify(["gauss-a", "gauss-c"]));
  await hydrateFavorites();
  assert.deepEqual([...(puts(w).at(-1) || [])].sort(), ["gauss-a", "gauss-c"]);
});

test("test_the_migrated_names_end_up_in_the_favorites_set", async () => {
  reset(PLAIN);
  favoritesWire({ filters: [] });
  useStorage().map.set(LEGACY_KEY, JSON.stringify(["gauss-a", "gauss-c"]));
  await hydrateFavorites();
  assert.deepEqual([...favoriteFilters.value].sort(), ["gauss-a", "gauss-c"]);
});

test("test_migration_removes_the_localstorage_key", async () => {
  reset(PLAIN);
  favoritesWire({ filters: [] });
  const storage = useStorage();
  storage.map.set(LEGACY_KEY, JSON.stringify(["gauss-a"]));
  await hydrateFavorites();
  assert.equal(storage.map.has(LEGACY_KEY), false);
});

test("test_a_server_that_already_has_favorites_ignores_localstorage", async () => {
  reset(PLAIN);
  favoritesWire({ filters: ["gauss-d"] });
  useStorage().map.set(LEGACY_KEY, JSON.stringify(["gauss-a"]));
  await hydrateFavorites();
  assert.deepEqual([...favoriteFilters.value], ["gauss-d"]);
});

test("test_a_server_that_already_has_favorites_leaves_the_localstorage_key_alone", async () => {
  reset(PLAIN);
  favoritesWire({ filters: ["gauss-d"] });
  const storage = useStorage();
  storage.map.set(LEGACY_KEY, JSON.stringify(["gauss-a"]));
  await hydrateFavorites();
  assert.equal(storage.map.get(LEGACY_KEY), JSON.stringify(["gauss-a"]));
});

// --- loading the module ---------------------------------------------------------
// A fresh instance comes from a cache-busting dynamic import, because node
// caches a module per URL; the specifier is built rather than literal so the
// query suffix — a cache-buster, not a real path — never has to resolve against
// a module on disk.

test("test_favorites_only_defaults_off", () => {
  assert.equal(favOnlyAtLoad, false);
});

test("test_favorites_only_is_not_persisted_across_a_fresh_load", async () => {
  reset(PLAIN);
  favoritesWire();
  useStorage();
  await toggleFavorite("gauss-a");
  nFavOnly.value = true;
  const fresh = await import(`${FAVORITES_MODULE}?favonly`);
  assert.equal(fresh.nFavOnly.value, false);
});

test("test_loading_the_module_without_fetch_does_not_throw", async () => {
  delete env.fetch;
  await assert.doesNotReject(() => import(`${FAVORITES_MODULE}?nofetch`));
});

test("test_loading_the_module_without_fetch_leaves_no_rejected_promise", async () => {
  /** @type {unknown[]} */
  const unhandled = [];
  /** @param {unknown} reason */
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  delete env.fetch;
  await import(`${FAVORITES_MODULE}?nofetch2`).catch(() => {});
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

// --- favorites-only on: exactly the favorites, plus the current selection ------

test("test_favorites_only_offers_exactly_the_favorites_plus_the_current_selection", async () => {
  const options = reset(PLAIN);
  await toggleFavorite("gauss-b");
  await toggleFavorite("gauss-d");
  nFavOnly.value = true;
  // current is gauss-a (value "0"), unfavorited — it must survive anyway.
  assert.deepEqual(labels(options, "0"), ["gauss-a", "gauss-b", "gauss-d"]);
});

test("test_favorites_only_ands_with_an_engaged_facet", async () => {
  const options = reset(FOCUS);
  await toggleFavorite("gauss-b");
  await toggleFavorite("gauss-c");
  nFocus.value = ["timbre"];
  nFavOnly.value = true;
  // timbre keeps a, b, d; the favorites are b and c; only b passes both.
  assert.deepEqual(labels(options, "1"), ["gauss-b"]);
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
// The fixture filters are apodizing (arg bit 0) and carry no hires marker, so
// they survive the 1x stage's apodizing-only / hires-hidden defaults and the
// only narrowing left in play is the favorite itself — toggled ONCE, never per
// field.

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
    assert.deepEqual(labels(options, "", stage, field), ["gauss-apod-a"]);
  });
}
