// Behavioral suite for favorite filters (store/favorites.js) and their
// integration with narrowing (store/narrowing.js `nFavOnly`): a filter NAME the
// user has starred, kept across sessions, and an optional favorites-only facet
// that ANDs with the ordinary narrowing facets.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Facet data is driven the way narrowing.test.js drives it — by
// assigning the two source signals the real payloads carry (`enums.filters`,
// the engine's `<GetFilters/>` enumeration, protocol.md:226, and
// `metadata.filters.filters`, the static overlay from /api/metadata) —
// descriptions hand-written in the engine's own format with the PCM glyph.
//
// Storage is the environment's seam, exactly as in prefs.test.js: plain node
// has no localStorage, which IS the storage-disabled case, so nothing of ours
// is stubbed. console.warn is captured around the module's import AND one
// warm-up toggle, because the single storage warning may fire at load (prefs
// pattern) or on first use; either way the contract is ONE warning. favorites
// must therefore be imported dynamically before any module that could pull it
// in transitively — narrowing and signals are imported after it. Where a test
// needs working storage, a fake localStorage is installed and removed again.
//
// `reset()` reassigns both source signals, resets narrowing, empties the
// favorites set through its own public toggle, and forces favorites-only off:
// module-level signals outlive a test, and a partial reset makes tests pass
// alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/favorites.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

const warns = [];
const realWarn = console.warn;
console.warn = (msg) => warns.push(String(msg));
const { favoriteFilters, toggleFavorite, isFavorite } = await import("../../../hqptuner/static/store/favorites.js");
// The warning window covers first USE as well as load: a module that defers its
// storage probe to the first toggle still owes exactly one warning.
toggleFavorite("__warmup__");
toggleFavorite("__warmup__");
console.warn = realWarn;

const { nFavOnly, nFocus, narrowingActive, resetNarrowing, narrowOptions, narrowCount, previewCount } =
  await import("../../../hqptuner/static/store/narrowing.js");
const { enums, metadata } = await import("../../../hqptuner/static/store/signals.js");

const favOnlyAtLoad = nFavOnly.value;

const STAGE = "nx";
const FIELD = "pcm_filter_nx";

// One `<FiltersItem/>` as the enumeration serves it (protocol.md:226); `arg`
// bit 0 is the apodizing flag and the backend-derived field agrees with it.
const item = (name, description, index, arg) => ({
  index: String(index),
  name,
  value: String(index),
  arg,
  description,
  apodizing: Boolean(arg & 1),
});

function reset(filters) {
  enums.value = { filters: filters.map(([name, desc, arg = 0], i) => item(name, desc, i, arg)) };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
  for (const name of [...favoriteFilters.value]) toggleFavorite(name);
  nFavOnly.value = false;
  return filters.map(([name], i) => ({ label: name, value: String(i) }));
}

// `current` is the selection the dropdown is showing — the option VALUE, as the
// /config form carries it — which favorites-only must never hide.
const labels = (options, current = "", stage = STAGE, field = FIELD) =>
  narrowOptions(options, current, stage, field).map((o) => o.label);

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

afterEach(() => {
  delete globalThis.localStorage;
});

// --- fixtures ----------------------------------------------------------------
// Names carry no phase, length or hires marker, so nothing narrows by a facet a
// case did not engage.

const PLAIN = [
  ["gauss-a", "5/5 ⥮ Any"],
  ["gauss-b", "5/5 ⥮ Any"],
  ["gauss-c", "4/5 ⥮ Any"],
  ["gauss-d", "4/5 ⥮ Any"],
];

const FOCUS = [
  ["gauss-a", "5/5 timbre, transients ⥮ Any"],
  ["gauss-b", "5/5 timbre ⥮ Any"],
  ["gauss-c", "4/5 transients ⥮ Any"],
  ["gauss-d", "4/5 timbre, transients, space ⥮ Any"],
];

// --- the set itself -----------------------------------------------------------

test("test_toggling_a_name_marks_it_favorite", () => {
  reset(PLAIN);
  toggleFavorite("gauss-a");
  assert.equal(isFavorite("gauss-a"), true);
});

test("test_toggling_a_name_again_unmarks_it", () => {
  reset(PLAIN);
  toggleFavorite("gauss-a");
  toggleFavorite("gauss-a");
  assert.equal(isFavorite("gauss-a"), false);
});

// --- persistence and the storage-disabled warn contract -----------------------

test("test_without_storage_the_set_still_works_in_memory", () => {
  reset(PLAIN);
  toggleFavorite("gauss-b");
  assert.equal(favoriteFilters.value.has("gauss-b"), true);
});

test("test_loading_and_first_use_without_storage_warn_exactly_once", () => {
  assert.equal(warns.length, 1);
});

test("test_a_later_toggle_does_not_repeat_the_warning", () => {
  reset(PLAIN);
  console.warn = (msg) => warns.push(String(msg));
  toggleFavorite("gauss-c");
  console.warn = realWarn;
  assert.equal(warns.length, 1);
});

test("test_a_favorite_persists_under_an_hqptuner_prefixed_key", () => {
  reset(PLAIN);
  globalThis.localStorage = fakeStorage();
  toggleFavorite("gauss-a");
  assert.ok(
    [...globalThis.localStorage.map.entries()].some(
      ([k, v]) => k.startsWith("hqptuner.") && String(v).includes("gauss-a"),
    ),
  );
});

// The READ side of persistence, as a round-trip: whatever serialized form a
// toggle wrote to storage, a fresh module instance started over that same
// storage must load back — no serialization shape is assumed, and the fresh
// instance comes from a cache-busting dynamic import because node caches a
// module per URL.
test("test_a_persisted_favorite_is_loaded_back_at_startup", async () => {
  reset(PLAIN);
  globalThis.localStorage = fakeStorage();
  toggleFavorite("gauss-a");
  const fresh = await import("../../../hqptuner/static/store/favorites.js?seeded");
  assert.equal(fresh.isFavorite("gauss-a"), true);
});

// --- favorites-only off: favorites are inert ----------------------------------

test("test_favorites_only_defaults_off", () => {
  assert.equal(favOnlyAtLoad, false);
});

test("test_with_favorites_only_off_favorites_change_the_offered_list_not_at_all", () => {
  const options = reset(PLAIN);
  toggleFavorite("gauss-b");
  assert.deepEqual(labels(options), ["gauss-a", "gauss-b", "gauss-c", "gauss-d"]);
});

// --- favorites-only on: exactly the favorites, plus the current selection ------

test("test_favorites_only_offers_exactly_the_favorites_plus_the_current_selection", () => {
  const options = reset(PLAIN);
  toggleFavorite("gauss-b");
  toggleFavorite("gauss-d");
  nFavOnly.value = true;
  // current is gauss-a (value "0"), unfavorited — it must survive anyway.
  assert.deepEqual(labels(options, "0"), ["gauss-a", "gauss-b", "gauss-d"]);
});

test("test_favorites_only_ands_with_an_engaged_facet", () => {
  const options = reset(FOCUS);
  toggleFavorite("gauss-b");
  toggleFavorite("gauss-c");
  nFocus.value = ["timbre"];
  nFavOnly.value = true;
  // timbre keeps a, b, d; the favorites are b and c; only b passes both.
  assert.deepEqual(labels(options, "1"), ["gauss-b"]);
});

// --- the counts follow the engaged favorites -----------------------------------

test("test_the_badge_count_includes_only_favorites_while_engaged", () => {
  const options = reset(PLAIN);
  toggleFavorite("gauss-a");
  toggleFavorite("gauss-c");
  nFavOnly.value = true;
  assert.equal(narrowCount(options, STAGE, FIELD).n, 2);
});

test("test_a_preview_count_includes_only_favorites_while_engaged", () => {
  const options = reset(FOCUS);
  toggleFavorite("gauss-a");
  toggleFavorite("gauss-b");
  nFavOnly.value = true;
  // timbre keeps a, b, d; of those only a and b are favorited.
  assert.equal(previewCount(options, STAGE, FIELD, { focus: ["timbre"] }), 2);
});

// --- favorites-only as narrowing state ------------------------------------------

test("test_favorites_only_is_active_narrowing", () => {
  reset(PLAIN);
  toggleFavorite("gauss-a");
  nFavOnly.value = true;
  assert.equal(narrowingActive.value, true);
});

test("test_reset_turns_favorites_only_off", () => {
  reset(PLAIN);
  toggleFavorite("gauss-a");
  nFavOnly.value = true;
  resetNarrowing();
  assert.equal(nFavOnly.value, false);
});

test("test_reset_keeps_the_favorites_set", () => {
  reset(PLAIN);
  toggleFavorite("gauss-a");
  nFavOnly.value = true;
  resetNarrowing();
  assert.equal(isFavorite("gauss-a"), true);
});

// --- removing favorites while engaged -------------------------------------------

test("test_removing_the_last_favorite_turns_favorites_only_off", () => {
  reset(PLAIN);
  toggleFavorite("gauss-a");
  nFavOnly.value = true;
  toggleFavorite("gauss-a");
  assert.equal(nFavOnly.value, false);
});

test("test_removing_a_favorite_that_is_not_the_last_keeps_favorites_only_on", () => {
  reset(PLAIN);
  toggleFavorite("gauss-a");
  toggleFavorite("gauss-b");
  nFavOnly.value = true;
  toggleFavorite("gauss-a");
  assert.equal(nFavOnly.value, true);
});

// --- one set of favorites, shared by name across all four filter dropdowns ------
// The fixture filters are apodizing (arg bit 0) and carry no hires marker, so
// they survive the 1x stage's apodizing-only / hires-hidden defaults and the
// only narrowing left in play is the favorite itself — toggled ONCE, never per
// field.

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
  test(`test_one_favorite_toggle_reaches_the_${field}_dropdown`, () => {
    const options = reset(SHARED);
    toggleFavorite("gauss-apod-a");
    nFavOnly.value = true;
    assert.deepEqual(labels(options, "", stage, field), ["gauss-apod-a"]);
  });
}
