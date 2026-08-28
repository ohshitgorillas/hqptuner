// Behavioral suite for filter narrowing (store/narrow/state.js): which filters a
// dropdown still offers once the user has picked facets, and what the counts
// beside it say.
//
// Two shapes of facet, and the difference is the whole point. Genre and focus
// are SETS a filter carries, and each combines picked values by its own mode —
// AND means every picked value must hold, so the list only shrinks as values are
// added; OR means any one is enough, so the list only grows. A case here that
// picks more than one value SETS the mode it is about rather than leaning on a
// default, so a flipped default moves nothing in this file; which mode each
// facet starts at belongs to tests/js/store/narrowing-mode.test.js. Phase and
// length are sets of picks too, but over a facet a filter carries exactly ONE
// of, so an AND across two picks would be empty by construction: they carry no
// mode and their picks always UNION, a second pick widening the list. Neither
// taxonomy reaches every filter, and both answer that the same way: each offers
// the empty string as a real VALUE, so the filters it does not classify can be
// asked for. Neither is the empty SELECTION, which is what
// "not narrowed by this facet" means for both. The
// manual's escape hatch ("any" genre) sits outside all of them and survives
// every selection. The rate-narrowing switches — hide-2x, hide-integer,
// downsample-safe-only — are tests/js/store/narrowing-rate.test.js's subject.
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
// Every case reads the Nx stage. Neither stage starts narrowed on a per-stage
// control any more — apodizing is "all" at both stages and the 1x lossy-source
// control starts at "both" — and the per-stage controls are
// tests/js/store/narrowing-lossy.test.js's subject.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrowing.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  nGenre,
  nGenreMode,
  nFocus,
  nFocusMode,
  nPhase,
  nLength,
  nApod1x,
  nApodNx,
  narrowingActive,
  resetNarrowing,
} from "../../../hqptuner/static/store/narrow/state.js";
import { narrowOptions, narrowCount, previewCount } from "../../../hqptuner/static/store/narrow/match.js";
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
 * matches store/narrow/state.js's own `NarrowOption`.
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
const labels = (options, stage = STAGE, field = FIELD) => narrowOptions(options, stage, field).map((o) => o.label);

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

// The phase facet reads a `-lp`/`-mp`/`-ip` token off the NAME
// (tests/js/store/phase-facet.test.js); `gauss-plain` carries none, and is what
// the empty-string pick asks for.
/** @type {FilterTuple[]} */
const PHASES = [
  ["gauss-lp", "4/5 ⥮ Any"],
  ["gauss-mp", "4/5 ⥮ Any"],
  ["gauss-ip", "4/5 ⥮ Any"],
  ["gauss-plain", "4/5 ⥮ Any"],
];

// The length taxonomy does not reach every filter either: `gauss-plain` carries
// no length, so no NAMED length pick can ask for it — only the empty-string
// pick can. `gauss-medium` says medium in its own name.
/** @type {FilterTuple[]} */
const MEDIUMS = [
  ["gauss-medium", "4/5 ⥮ Any"],
  ["gauss-plain", "4/5 ⥮ Any"],
];

// One filter per length the taxonomy names — short and medium and long say so
// in their own names, `-xl` is the extra-long suffix — plus one whose name
// carries no length word at all, which is what the empty-string pick asks for.
/** @type {FilterTuple[]} */
const ALL_LENGTHS = [
  ["gauss-short", "4/5 ⥮ Any"],
  ["gauss-medium", "4/5 ⥮ Any"],
  ["gauss-long", "4/5 ⥮ Any"],
  ["gauss-xl", "4/5 ⥮ Any"],
  ["gauss-plain", "4/5 ⥮ Any"],
];

// For the per-stage switches: `arg` bit 0 is the apodizing flag, and a filter
// counts as lossy-source when its NAME carries `hires`, `mqa` or `mp3`. Neither
// stage starts narrowed on either control.
/** @type {FilterTuple[]} */
const STAGES = [
  ["gauss-plain", "4/5 ⥮ Any", 0],
  ["gauss-apod", "4/5 ⥮ Any", 1],
  ["gauss-hires-apod", "4/5 ⥮ Any", 1],
];

// --- set-valued facets combine by the mode the case sets -------------------------
// Focus in OR: a filter passes on ANY one picked value. `gauss-b` is the
// discriminator — it carries timbre alone, so the union of space and transients
// leaves it out while the other three stay.

test("test_two_focus_values_in_or_keep_every_filter_carrying_either", () => {
  const options = reset(FOCUS);
  nFocusMode.value = "or";
  nFocus.value = ["space", "transients"];
  assert.deepEqual(labels(options), ["gauss-a", "gauss-c", "gauss-d"]);
});

test("test_the_count_for_two_focus_values_in_or_is_the_number_carrying_either", () => {
  const options = reset(FOCUS);
  nFocusMode.value = "or";
  nFocus.value = ["space", "transients"];
  assert.equal(narrowCount(options, STAGE, FIELD).n, 3);
});

test("test_adding_a_second_focus_value_in_or_never_shrinks_the_surviving_set", () => {
  const options = reset(FOCUS);
  nFocusMode.value = "or";
  nFocus.value = ["space"];
  const one = narrowCount(options, STAGE, FIELD).n;
  nFocus.value = ["space", "transients"];
  assert.deepEqual([one, narrowCount(options, STAGE, FIELD).n], [1, 3]);
});

test("test_two_genres_in_and_keep_only_the_filters_tagged_with_both", () => {
  const options = reset(PLAIN, { ...GENRES, "gauss-c": { genre: ["pop"] } });
  nGenreMode.value = "and";
  nGenre.value = ["jazz", "classical"];
  assert.deepEqual(labels(options), ["gauss-a", "gauss-d"]);
});

test("test_a_genre_agnostic_filter_survives_every_genre_picked_in_and", () => {
  const options = reset(PLAIN, GENRES);
  nGenreMode.value = "and";
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

// --- phase and length: picks over a one-of facet, so they union ------------------

test("test_narrowing_by_one_length_keeps_only_the_filters_of_that_length", () => {
  const options = reset(LENGTHS);
  nLength.value = ["short"];
  assert.deepEqual(labels(options), ["gauss-short"]);
});

test("test_narrowing_by_one_phase_keeps_only_the_filters_of_that_phase", () => {
  const options = reset(PHASES);
  nPhase.value = ["minimum"];
  assert.deepEqual(labels(options), ["gauss-mp"]);
});

// A second pick WIDENS: a filter carries one phase, so an intersection would
// answer nothing at all and only a union can answer two.

test("test_two_picked_phases_keep_the_filters_carrying_either", () => {
  const options = reset(PHASES);
  nPhase.value = ["linear", "intermediate"];
  assert.deepEqual(labels(options), ["gauss-lp", "gauss-ip"]);
});

test("test_two_picked_lengths_keep_the_filters_carrying_either", () => {
  const options = reset(LENGTHS);
  nLength.value = ["short", "long"];
  assert.deepEqual(labels(options), ["gauss-short", "gauss-long"]);
});

// The ratio-class and downsample-safety switches that replaced the single
// ratio pick are pinned in tests/js/store/narrowing-rate.test.js.

// Emptying the selection gives the whole list back — the narrowing is undone,
// not merely never applied, so each case narrows for real first.

test("test_an_empty_length_selection_excludes_nothing", () => {
  const options = reset(LENGTHS);
  nLength.value = ["short"];
  nLength.value = [];
  assert.deepEqual(labels(options), ["gauss-short", "gauss-plain", "gauss-long"]);
});

test("test_an_empty_phase_selection_excludes_nothing", () => {
  const options = reset(PHASES);
  nPhase.value = ["minimum"];
  nPhase.value = [];
  assert.deepEqual(labels(options), ["gauss-lp", "gauss-mp", "gauss-ip", "gauss-plain"]);
});

// --- the phase the taxonomy does not reach ----------------------------------------
// The empty string is a phase VALUE, meaning "no phase classification", and it
// is picked like any other. It is not the empty SELECTION: the empty selection
// narrows by phase not at all, and is pinned just above.

test("test_picking_no_phase_keeps_only_the_filters_the_taxonomy_does_not_reach", () => {
  const options = reset(PHASES);
  nPhase.value = [""];
  assert.deepEqual(labels(options), ["gauss-plain"]);
});

test("test_no_phase_unions_with_a_picked_phase_like_any_other_value", () => {
  const options = reset(PHASES);
  nPhase.value = ["linear", ""];
  assert.deepEqual(labels(options), ["gauss-lp", "gauss-plain"]);
});

// The other side of the same rule: a filter the taxonomy does not reach is out
// of every pick that does not name it, so a selection of linear alone drops it.
test("test_a_filter_with_no_phase_is_dropped_by_a_phase_pick_that_does_not_name_it", () => {
  const options = reset(PHASES);
  nPhase.value = ["linear"];
  assert.equal(labels(options).includes("gauss-plain"), false);
});

// --- the length the taxonomy does not reach -----------------------------------------
// A filter the length classifier cannot place carries NO length rather than a
// guessed medium, so no length pick surfaces it — medium included.

test("test_a_filter_the_length_taxonomy_does_not_reach_is_dropped_by_a_medium_pick", () => {
  const options = reset(MEDIUMS);
  nLength.value = ["medium"];
  assert.equal(labels(options).includes("gauss-plain"), false);
});

// The empty string is a length VALUE meaning "nothing states this filter's
// length", picked like any other value. It is not the empty SELECTION, which
// narrows by length not at all and is pinned above.

test("test_picking_the_unspecified_length_keeps_only_the_filters_no_length_word_reaches", () => {
  const options = reset(ALL_LENGTHS);
  nLength.value = [""];
  assert.deepEqual(labels(options), ["gauss-plain"]);
});

test("test_the_unspecified_length_unions_with_a_picked_length_like_any_other_value", () => {
  const options = reset(ALL_LENGTHS);
  nLength.value = ["medium", ""];
  assert.deepEqual(labels(options), ["gauss-medium", "gauss-plain"]);
});

test("test_a_name_that_says_medium_still_classifies_as_medium", () => {
  const options = reset(MEDIUMS);
  nLength.value = ["medium"];
  assert.deepEqual(labels(options), ["gauss-medium"]);
});

// Narrowing hides only what it can positively exclude, so a dropdown option the
// enumeration knows nothing about survives a phase pick that every filter it
// does know fails.
test("test_an_option_with_no_facet_record_survives_a_phase_pick", () => {
  const options = [...reset(PHASES), { label: "stranger", value: "9" }];
  nPhase.value = ["minimum"];
  assert.deepEqual(labels(options), ["gauss-mp", "stranger"]);
});

// The same for length, and it is its own case rather than a second reading of
// the one above: the two facets no longer share a classifier fallback, so phase
// surviving is no evidence about length.
test("test_an_option_with_no_facet_record_survives_a_length_pick", () => {
  const options = [...reset(LENGTHS), { label: "stranger", value: "9" }];
  nLength.value = ["short"];
  assert.deepEqual(labels(options), ["gauss-short", "stranger"]);
});

// --- selection state ------------------------------------------------------------

test("test_nothing_picked_is_not_active_narrowing", () => {
  reset(PLAIN);
  assert.equal(narrowingActive.value, false);
});

test("test_a_picked_length_is_active_narrowing", () => {
  reset(LENGTHS);
  nLength.value = ["long"];
  assert.equal(narrowingActive.value, true);
});

test("test_a_picked_phase_is_active_narrowing", () => {
  reset(PHASES);
  nPhase.value = ["minimum"];
  assert.equal(narrowingActive.value, true);
});

test("test_an_empty_phase_selection_is_not_active_narrowing", () => {
  reset(PHASES);
  nPhase.value = ["minimum"];
  nPhase.value = [];
  assert.equal(narrowingActive.value, false);
});

test("test_an_empty_length_selection_is_not_active_narrowing", () => {
  reset(LENGTHS);
  nLength.value = ["long"];
  nLength.value = [];
  assert.equal(narrowingActive.value, false);
});

test("test_reset_returns_length_to_not_narrowed", () => {
  reset(LENGTHS);
  nLength.value = ["long"];
  resetNarrowing();
  assert.deepEqual(nLength.value, []);
});

test("test_reset_returns_phase_to_not_narrowed", () => {
  reset(PHASES);
  nPhase.value = ["minimum", "linear"];
  resetNarrowing();
  assert.deepEqual(nPhase.value, []);
});

// The per-stage apodizing switches reset to their own default at both stages;
// the 1x lossy-source control's reset is pinned in
// tests/js/store/narrowing-lossy.test.js.

test("test_reset_returns_the_1x_apodizing_switch_to_all", () => {
  reset(STAGES);
  nApod1x.value = "only";
  resetNarrowing();
  assert.equal(nApod1x.value, "all");
});

test("test_reset_returns_the_nx_apodizing_switch_to_all", () => {
  reset(STAGES);
  nApodNx.value = "only";
  resetNarrowing();
  assert.equal(nApodNx.value, "all");
});

// --- previews answer for the selection they are handed ---------------------------

// The live selection leaves 2 and the override leaves 3, so a preview that
// ignored its overrides could not answer 3.
test("test_a_preview_counts_its_own_overrides_not_the_live_selection", () => {
  const options = reset(FOCUS);
  nFocusMode.value = "and";
  nFocus.value = ["timbre", "transients"];
  assert.equal(previewCount(options, STAGE, FIELD, { focus: ["timbre"] }), 3);
});

// --- the two stages narrow independently -----------------------------------------

test("test_the_nx_stage_defaults_leave_every_filter_offered", () => {
  const options = reset(STAGES);
  assert.deepEqual(labels(options), ["gauss-plain", "gauss-apod", "gauss-hires-apod"]);
});

test("test_the_1x_stage_defaults_leave_every_filter_offered", () => {
  const options = reset(STAGES);
  assert.deepEqual(labels(options, "1x", "pcm_filter_1x"), ["gauss-plain", "gauss-apod", "gauss-hires-apod"]);
});
