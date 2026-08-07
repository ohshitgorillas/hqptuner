// Behavioral suite for filter narrowing (store/narrowing.js): which filters a
// dropdown still offers once the user has picked facets, and what the counts
// beside it say.
//
// Two shapes of facet, and the difference is the whole point. Genre and focus
// are SETS a filter carries — picking two means every one must hold, so the
// surviving list can only shrink as values are added. Length and ratio are
// single-valued: a filter is short or it is long, and picking one asks for that
// one. The manual's escape hatches ("any" genre, "any" ratio) sit outside both
// and survive every selection.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Facet data is driven by assigning the two source signals the real
// payloads carry — `enums.filters` is the running engine's `<GetFilters/>`
// enumeration (`{index, name, value, arg, description}`, protocol.md:226) and
// `metadata.filters.filters` is the static name-keyed overlay served by
// /api/metadata. Descriptions are hand-written in the engine's own format,
// `"<q>/5 [focus, ...] <glyph> <ratio>"`, with the PCM glyph `⥮` because every
// fixture here is read through a PCM field, and the engine's abbreviated ratio
// tail (`Int`, `2^x`, `Any`). No count is taken from the shipped data files.
//
// `reset()` reassigns BOTH source signals and calls resetNarrowing() on every
// case: module-level signals outlive a test, and a partial reset makes tests
// pass alone and fail in sequence.
//
// Every case reads the Nx stage, whose apodizing and hi-res switches default to
// "all" — the 1x stage defaults to apodizing-only and hi-res-hidden, which is a
// narrowing of its own and would be riding along under every assertion here.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrowing.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  nGenre,
  nFocus,
  nLength,
  nRatio,
  nApod1x,
  nApodNx,
  nHires1x,
  nHiresNx,
  narrowingActive,
  resetNarrowing,
  narrowOptions,
  narrowCount,
  previewCount,
} from "../../../hqptuner/static/store/narrowing.js";
import { enums, metadata } from "../../../hqptuner/static/store/signals.js";

const STAGE = "nx";
const FIELD = "pcm_filter_nx";

/**
 * A fixture row: filter name, its facet description, and an optional flags
 * bitfield (bit 0 = apodizing).
 *
 * @typedef {[string, string, number?]} FilterTuple
 */

/**
 * The two members `narrowOptions` and friends read off a dropdown option —
 * matches store/narrowing.js's own `NarrowOption`.
 *
 * @typedef {{ value: string | number | undefined, label: string }} NarrowOption
 */

// One `<FiltersItem/>` as the enumeration serves it. `arg` is the flags
// bitfield, bit 0 = apodizing (protocol.md:226); the backend derives the
// `apodizing` field from that same bit, so the two always agree.
const item = (
  /** @type {string} */ name,
  /** @type {string} */ description,
  /** @type {number} */ index,
  /** @type {number} */ arg,
) => ({
  index: String(index),
  name,
  value: String(index),
  arg,
  description,
  apodizing: Boolean(arg & 1),
});

/**
 * @param {FilterTuple[]} filters
 * @param {Record<string, { genre?: string[] }>} [overlay]
 * @returns {NarrowOption[]}
 */
function reset(filters, overlay = {}) {
  enums.value = { filters: filters.map(([name, desc, arg = 0], i) => item(name, desc, i, arg)) };
  metadata.value = {
    settings: {},
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  resetNarrowing();
  return filters.map(([name], i) => ({ label: name, value: String(i) }));
}

/** @param {NarrowOption[]} options */
const labels = (options, stage = STAGE, field = FIELD) => narrowOptions(options, "", stage, field).map((o) => o.label);

// --- fixtures ----------------------------------------------------------------
// Names carry no phase (-lp/-mp/-ip), length (short/long) or hires marker unless
// the case is about one, so nothing narrows by a facet the case did not pick.

// Focus, as the engine spells it: a comma-separated set between quality and glyph.
/** @type {FilterTuple[]} */
const FOCUS = [
  ["gauss-a", "5/5 timbre, transients ⥮ Any"],
  ["gauss-b", "5/5 timbre ⥮ Any"],
  ["gauss-c", "4/5 transients ⥮ Any"],
  ["gauss-d", "4/5 timbre, transients, space ⥮ Any"],
];

// Genre lives only in the static overlay; these four carry no focus at all.
/** @type {FilterTuple[]} */
const PLAIN = [
  ["gauss-a", "5/5 ⥮ Any"],
  ["gauss-b", "5/5 ⥮ Any"],
  ["gauss-c", "4/5 ⥮ Any"],
  ["gauss-d", "4/5 ⥮ Any"],
];

const GENRES = {
  "gauss-a": { genre: ["jazz", "classical"] },
  "gauss-b": { genre: ["jazz"] },
  "gauss-c": { genre: ["any"] },
  "gauss-d": { genre: ["classical", "jazz"] },
};

/** @type {FilterTuple[]} */
const LENGTHS = [
  ["gauss-short", "4/5 ⥮ Any"],
  ["gauss-plain", "4/5 ⥮ Any"],
  ["gauss-long", "4/5 ⥮ Any"],
];

/** @type {FilterTuple[]} */
const RATIOS = [
  ["rat-int", "4/5 ⥮ Int"],
  ["rat-two", "4/5 ⥮ 2^x"],
  ["rat-any", "4/5 ⥮ Any"],
];

// For the per-stage switches: `arg` bit 0 is the apodizing flag, and a filter is
// hi-res when its NAME carries `hires`. The 1x stage defaults to apodizing-only
// and hi-res-hidden, the Nx stage to all of both.
/** @type {FilterTuple[]} */
const STAGES = [
  ["gauss-plain", "4/5 ⥮ Any", 0],
  ["gauss-apod", "4/5 ⥮ Any", 1],
  ["gauss-hires-apod", "4/5 ⥮ Any", 1],
];

// --- set-valued facets AND together -------------------------------------------

test("test_two_focus_values_keep_only_the_filters_carrying_both", () => {
  const options = reset(FOCUS);
  nFocus.value = ["timbre", "transients"];
  assert.deepEqual(labels(options), ["gauss-a", "gauss-d"]);
});

test("test_the_count_for_two_focus_values_is_the_number_carrying_both", () => {
  const options = reset(FOCUS);
  nFocus.value = ["timbre", "transients"];
  assert.equal(narrowCount(options, STAGE, FIELD).n, 2);
});

test("test_adding_a_second_focus_value_never_grows_the_surviving_set", () => {
  const options = reset(FOCUS);
  nFocus.value = ["timbre"];
  const one = narrowCount(options, STAGE, FIELD).n;
  nFocus.value = ["timbre", "transients"];
  assert.deepEqual([one, narrowCount(options, STAGE, FIELD).n], [3, 2]);
});

test("test_two_genres_keep_only_the_filters_tagged_with_both", () => {
  const options = reset(PLAIN, { ...GENRES, "gauss-c": { genre: ["pop"] } });
  nGenre.value = ["jazz", "classical"];
  assert.deepEqual(labels(options), ["gauss-a", "gauss-d"]);
});

test("test_a_genre_agnostic_filter_survives_every_genre_picked", () => {
  const options = reset(PLAIN, GENRES);
  nGenre.value = ["jazz", "classical", "pop"];
  assert.deepEqual(labels(options), ["gauss-c"]);
});

test("test_an_empty_focus_selection_excludes_nothing", () => {
  const options = reset(FOCUS);
  nFocus.value = [];
  assert.deepEqual(labels(options), ["gauss-a", "gauss-b", "gauss-c", "gauss-d"]);
});

test("test_an_empty_genre_selection_excludes_nothing", () => {
  const options = reset(PLAIN, GENRES);
  nGenre.value = [];
  assert.deepEqual(labels(options), ["gauss-a", "gauss-b", "gauss-c", "gauss-d"]);
});

// --- single-valued facets ------------------------------------------------------

test("test_narrowing_by_length_keeps_only_the_filters_of_that_length", () => {
  const options = reset(LENGTHS);
  nLength.value = "short";
  assert.deepEqual(labels(options), ["gauss-short"]);
});

test("test_narrowing_by_ratio_keeps_only_the_filters_of_that_ratio_class", () => {
  const options = reset(RATIOS.slice(0, 2));
  nRatio.value = "integer";
  assert.deepEqual(labels(options), ["rat-int"]);
});

test("test_an_any_ratio_filter_survives_every_ratio_picked", () => {
  const options = reset(RATIOS);
  nRatio.value = "2x";
  assert.deepEqual(labels(options), ["rat-two", "rat-any"]);
});

// Setting the facet back to "" gives the whole list back — the narrowing is
// undone, not merely never applied, so each case narrows for real first.

test("test_putting_length_back_to_empty_narrows_by_length_not_at_all", () => {
  const options = reset(LENGTHS);
  nLength.value = "short";
  nLength.value = "";
  assert.deepEqual(labels(options), ["gauss-short", "gauss-plain", "gauss-long"]);
});

test("test_putting_ratio_back_to_empty_narrows_by_ratio_not_at_all", () => {
  const options = reset(RATIOS);
  nRatio.value = "integer";
  nRatio.value = "";
  assert.deepEqual(labels(options), ["rat-int", "rat-two", "rat-any"]);
});

// --- selection state ------------------------------------------------------------

test("test_nothing_picked_is_not_active_narrowing", () => {
  reset(PLAIN);
  assert.equal(narrowingActive.value, false);
});

test("test_a_picked_length_is_active_narrowing", () => {
  reset(LENGTHS);
  nLength.value = "long";
  assert.equal(narrowingActive.value, true);
});

test("test_a_picked_ratio_is_active_narrowing", () => {
  reset(RATIOS);
  nRatio.value = "integer";
  assert.equal(narrowingActive.value, true);
});

test("test_reset_returns_length_to_not_narrowed", () => {
  reset(LENGTHS);
  nLength.value = "long";
  resetNarrowing();
  assert.equal(nLength.value, "");
});

test("test_reset_returns_ratio_to_not_narrowed", () => {
  reset(RATIOS);
  nRatio.value = "integer";
  resetNarrowing();
  assert.equal(nRatio.value, "");
});

// The per-stage switches reset to their OWN defaults, not to a bare clear: the
// 1x pair is what tells the two apart — cleared would leave 1x apodizing at
// "all" and 1x hi-res at "show".

test("test_reset_returns_the_1x_apodizing_switch_to_apodizing_only", () => {
  reset(STAGES);
  nApod1x.value = "all";
  resetNarrowing();
  assert.equal(nApod1x.value, "only");
});

test("test_reset_returns_the_nx_apodizing_switch_to_all", () => {
  reset(STAGES);
  nApodNx.value = "only";
  resetNarrowing();
  assert.equal(nApodNx.value, "all");
});

test("test_reset_returns_the_1x_hires_switch_to_hidden", () => {
  reset(STAGES);
  nHires1x.value = "show";
  resetNarrowing();
  assert.equal(nHires1x.value, "hide");
});

test("test_reset_returns_the_nx_hires_switch_to_all", () => {
  reset(STAGES);
  nHiresNx.value = "only";
  resetNarrowing();
  assert.equal(nHiresNx.value, "all");
});

test("test_reset_leaves_narrowing_inactive", () => {
  reset(LENGTHS);
  nLength.value = "long";
  nRatio.value = "integer";
  resetNarrowing();
  assert.equal(narrowingActive.value, false);
});

// --- previews answer for the selection they are handed ---------------------------

// The live selection leaves 2 and the override leaves 3, so a preview that
// ignored its overrides could not answer 3.
test("test_a_preview_counts_its_own_overrides_not_the_live_selection", () => {
  const options = reset(FOCUS);
  nFocus.value = ["timbre", "transients"];
  assert.equal(previewCount(options, STAGE, FIELD, { focus: ["timbre"] }), 3);
});

// --- the two stages narrow independently -----------------------------------------

test("test_the_nx_stage_defaults_leave_every_filter_offered", () => {
  const options = reset(STAGES);
  assert.deepEqual(labels(options), ["gauss-plain", "gauss-apod", "gauss-hires-apod"]);
});

test("test_the_1x_stage_defaults_drop_the_non_apodizing_and_the_hires_filters", () => {
  const options = reset(STAGES);
  assert.deepEqual(labels(options, "1x", "pcm_filter_1x"), ["gauss-apod"]);
});
