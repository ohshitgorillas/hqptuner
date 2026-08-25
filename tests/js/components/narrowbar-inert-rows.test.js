// Behavioral suite for the narrow bar's INERT choice rows: a genre, focus,
// phase or length row whose pick would leave both the 1x and the Nx option list
// exactly the size they already are can no longer change what the dropdowns
// offer, so it renders as an unavailable control carrying an explanation rather
// than as a live one.
//
// The case this exists for is the union facets. Phase and length union within
// themselves — a filter has exactly one of each, so a second pick can only
// widen — and a widening that reaches nothing new is a click with no effect.
// With phase = minimum + intermediate and length = short picked over the
// fixture below, the lists hold one short minimum-phase filter, and the medium
// and xlong rows would add nothing to it.
//
// Two states that LOOK like that one are not it, and each is entered here on its
// own. A row already picked is a row whose click UNPICKS, which is always worth
// offering however its counts read. A row whose pick would empty both lists
// reads 0/0 and is a legitimate dead end the user may want; where the lists are
// already empty its counts are unchanged too, which is exactly where a rule
// reading counts alone gets it wrong.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. State is driven by assigning the exported source signals
// the real payloads carry — the engine's own `<GetFilters/>` enumeration
// (protocol.md:226) and the static name-keyed genre overlay from /api/metadata —
// and by resetNarrowing(). Opening a facet and reading its rows, chips, titles
// and marks back off the emitted HTML lives in tests/js/support/genrepopover.js,
// which states what that route couples to.
//
// Rows are named by the WIRE VALUE their label carries in `data-v`, never by the
// caption beside the checkbox (docs/testing.md rule 9). The tooltip is the one
// piece of user-facing wording asserted here, verbatim, because the spec states
// it as an exact string.
//
// The genre facet's older any-dominates rule is pinned in
// tests/js/components/narrowbar-genre-any.test.js; the only thing this file adds
// about it is that those rows carry no tooltip.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-inert-rows.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  nGenre,
  nGenreMode,
  nFocus,
  nFocusMode,
  nPhase,
  nLength,
} from "../../../hqptuner/static/store/narrow/state.js";
import {
  resetNarrowBar,
  openFacet as open,
  popoverRows as rows,
  countChip,
  rowIsDisabled,
  rowIsMarkedOff,
  rowTitle,
} from "../support/genrepopover.js";

/**
 * A fixture filter as the engine enumerates it, `"<q>/5 <focus, ...> <glyph>
 * <ratio>"`. Rated 5/5 and ratio-agnostic, so neither the quality floor nor any
 * rate rule can trim it and the only narrowing at work is the one a case picks.
 *
 * @param {string} name
 * @param {number} index
 * @param {string} [focus]
 * @returns {Record<string, unknown>}
 */
const item = (name, index, focus = "timbre") => ({
  index: String(index),
  name,
  value: String(index),
  arg: 1,
  description: `5/5 ${focus} ⥮ Any`,
  apodizing: true,
});

// One short minimum-phase filter and two linear-phase ones the length taxonomy
// puts elsewhere. Under phase = minimum (with or without intermediate, which no
// fixture filter carries) the lists hold the first alone, so every further
// length or phase pick that unions onto it reaches nothing new.
const BASE = [
  item("gauss-short-mp", 0),
  item("gauss-medium-lp", 1, "transients"),
  item("gauss-xl-lp", 2, "transients"),
];

// The same fixture plus a LONG minimum-phase filter, which is what makes the
// long row's pick a real widening: it is the control on every inert case below.
const WIDE = [...BASE, item("gauss-long-mp", 3)];

const OVERLAY = {
  "gauss-short-mp": { genre: ["classical"] },
  "gauss-medium-lp": { genre: ["jazz"] },
  "gauss-xl-lp": { genre: ["jazz"] },
  "gauss-long-mp": { genre: ["jazz"] },
};

/**
 * Put the bar back to its defaults over one fixture set. A count chip counts a
 * DROPDOWN's options, so both PCM filter slots are handed the options the
 * /config form would serve for these filters.
 *
 * @param {Record<string, unknown>[]} filters
 * @returns {Promise<void>}
 */
function reset(filters = BASE) {
  const options = filters.map((f) => ({ value: f.value, label: f.name }));
  const fields = [
    { name: "filter1x", value: "0", options },
    { name: "filter", value: "0", options },
  ];
  return resetNarrowBar(filters, { overlay: OVERLAY, fields });
}

const MINIMUM = "minimum";
const INTERMEDIATE = "intermediate";
const LINEAR = "linear";
const SHORT = "short";
const MEDIUM = "medium";
const LONG = "long";
const XLONG = "xlong";
const CLASSICAL = "classical";
const JAZZ = "jazz";
const ANY = "any";
const TIMBRE = "timbre";
const TRANSIENTS = "transients";

// Owner copy, and the spec states it character for character.
const TIP = "No filters with this property match the current selections.";

/**
 * The length popover over a stated fixture, with phase narrowed to the two
 * phases and length narrowed to short: the worked example.
 *
 * @param {Record<string, unknown>[]} [filters]
 * @returns {Promise<string>}
 */
async function lengthScene(filters = BASE) {
  await reset(filters);
  nPhase.value = [MINIMUM, INTERMEDIATE];
  nLength.value = [SHORT];
  return open("length");
}

/**
 * The phase popover with one phase and one length picked, where no fixture
 * filter carries a second phase reachable through the picked length.
 *
 * @returns {Promise<string>}
 */
async function phaseScene() {
  await reset();
  nPhase.value = [MINIMUM];
  nLength.value = [SHORT];
  return open("phase");
}

/**
 * The genre popover in OR mode with one genre picked, so the any-dominates rule
 * is out of the picture and a second genre would only union onto the one live
 * filter.
 *
 * @returns {Promise<string>}
 */
async function genreScene() {
  await reset();
  nPhase.value = [MINIMUM];
  nGenreMode.value = "or";
  nGenre.value = [CLASSICAL];
  return open("genre");
}

/**
 * The focus popover in OR mode with one focus picked, the same shape as the
 * genre scene on the bar's other multi-select.
 *
 * @returns {Promise<string>}
 */
async function focusScene() {
  await reset();
  nPhase.value = [MINIMUM];
  nFocusMode.value = "or";
  nFocus.value = [TIMBRE];
  return open("focus");
}

/**
 * The length popover where the lists are ALREADY empty: no fixture filter is
 * intermediate-phase, so every row reads 0/0 and every row's counts are
 * unchanged.
 *
 * @returns {Promise<string>}
 */
async function deadEndScene() {
  await reset();
  nPhase.value = [INTERMEDIATE];
  return open("length");
}

// --- a pick that changes neither list goes inert ----------------------------------
// The medium and xlong rows union onto a selection that already holds every
// filter they could reach, so clicking either would leave both dropdowns exactly
// as they stand.

test("test_a_length_row_whose_pick_would_change_neither_list_is_disabled", async () => {
  assert.equal(rowIsDisabled(await lengthScene(), MEDIUM), true);
});

test("test_a_length_row_whose_pick_would_change_neither_list_is_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await lengthScene(), MEDIUM), true);
});

test("test_a_second_length_row_whose_pick_would_change_neither_list_is_disabled", async () => {
  assert.equal(rowIsDisabled(await lengthScene(), XLONG), true);
});

// Phase unions the same way length does: intermediate is a phase no fixture
// filter carries, so adding it to the selection reaches nothing.
test("test_a_phase_row_whose_pick_would_change_neither_list_is_disabled", async () => {
  assert.equal(rowIsDisabled(await phaseScene(), INTERMEDIATE), true);
});

test("test_a_phase_row_whose_pick_would_change_neither_list_is_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await phaseScene(), INTERMEDIATE), true);
});

// Linear is a phase the fixture DOES carry, on filters the picked length has
// already dropped, so it is inert for the other reason a pick can reach nothing.
test("test_a_phase_row_reaching_only_filters_another_facet_dropped_is_disabled", async () => {
  assert.equal(rowIsDisabled(await phaseScene(), LINEAR), true);
});

test("test_a_genre_row_whose_pick_would_change_neither_list_is_disabled", async () => {
  assert.equal(rowIsDisabled(await genreScene(), JAZZ), true);
});

test("test_a_genre_row_whose_pick_would_change_neither_list_is_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await genreScene(), JAZZ), true);
});

test("test_a_focus_row_whose_pick_would_change_neither_list_is_disabled", async () => {
  assert.equal(rowIsDisabled(await focusScene(), TRANSIENTS), true);
});

test("test_a_focus_row_whose_pick_would_change_neither_list_is_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await focusScene(), TRANSIENTS), true);
});

// --- the inert row says why -------------------------------------------------------

test("test_an_inert_length_row_carries_the_no_matching_filters_tooltip", async () => {
  assert.equal(rowTitle(await lengthScene(), MEDIUM), TIP);
});

test("test_an_inert_phase_row_carries_the_no_matching_filters_tooltip", async () => {
  assert.equal(rowTitle(await phaseScene(), INTERMEDIATE), TIP);
});

test("test_an_inert_genre_row_carries_the_no_matching_filters_tooltip", async () => {
  assert.equal(rowTitle(await genreScene(), JAZZ), TIP);
});

test("test_an_inert_focus_row_carries_the_no_matching_filters_tooltip", async () => {
  assert.equal(rowTitle(await focusScene(), TRANSIENTS), TIP);
});

// --- a picked row is never inert --------------------------------------------------
// Clicking a picked row UNPICKS it. In the worked example the unpick reaches
// nothing new either — short is the only length the live filter has — so a rule
// reading counts without asking whether the row is picked disables the one row
// the user needs to get back out of the corner.

test("test_a_picked_length_row_is_not_disabled_though_its_counts_are_unchanged", async () => {
  assert.equal(rowIsDisabled(await lengthScene(), SHORT), false);
});

test("test_a_picked_length_row_is_not_marked_off_though_its_counts_are_unchanged", async () => {
  assert.equal(rowIsMarkedOff(await lengthScene(), SHORT), false);
});

test("test_a_picked_phase_row_is_not_disabled_though_its_counts_are_unchanged", async () => {
  assert.equal(rowIsDisabled(await phaseScene(), MINIMUM), false);
});

test("test_a_picked_genre_row_is_not_disabled_though_its_counts_are_unchanged", async () => {
  assert.equal(rowIsDisabled(await genreScene(), CLASSICAL), false);
});

// --- a pick that changes either list stays live -----------------------------------
// The control on the whole file: the same medium row stays inert here, and the
// long row, which the fourth fixture filter now makes reachable, does not.

test("test_a_length_row_whose_pick_would_widen_the_lists_is_not_disabled", async () => {
  assert.equal(rowIsDisabled(await lengthScene(WIDE), LONG), false);
});

test("test_a_length_row_whose_pick_would_widen_the_lists_is_not_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await lengthScene(WIDE), LONG), false);
});

test("test_a_length_row_whose_pick_would_widen_the_lists_carries_no_tooltip", async () => {
  assert.equal(rowTitle(await lengthScene(WIDE), LONG), null);
});

// --- a dead end is not an inert row -----------------------------------------------
// Both lists are already empty, so every row's pick leaves them exactly as they
// are — unchanged counts, and a rule reading counts alone disables the lot. A
// 0/0 pick is a real pick with a real result and stays live.

test("test_the_dead_end_scene_really_reads_zero_over_zero", async () => {
  const block = await deadEndScene();
  assert.equal(countChip(block, XLONG), "0/0");
});

test("test_a_row_whose_pick_would_empty_both_lists_is_not_disabled", async () => {
  assert.equal(rowIsDisabled(await deadEndScene(), XLONG), false);
});

test("test_a_row_whose_pick_would_empty_both_lists_is_not_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await deadEndScene(), XLONG), false);
});

test("test_a_row_whose_pick_would_empty_both_lists_carries_no_tooltip", async () => {
  assert.equal(rowTitle(await deadEndScene(), XLONG), null);
});

// --- the genre facet's older rule keeps its own wording ---------------------------
// An AND-mode genre selection carrying the manual's "any" escape hatch makes
// every other genre row unable to change the result, and that row is dimmed
// without an explanation (tests/js/components/narrowbar-genre-any.test.js pins
// the dimming itself).

test("test_a_genre_row_inert_under_the_any_rule_carries_no_tooltip", async () => {
  await reset();
  nGenreMode.value = "and";
  nGenre.value = [ANY];
  assert.equal(rowTitle(open("genre"), CLASSICAL), null);
});

// --- the facets the rule does not reach -------------------------------------------
// Quality is a floor rather than a set of picks, and every fixture filter is
// rated 5/5, so picking any floor the popover offers changes neither list. No
// row of it goes dim regardless. Read against the rows the popover actually
// offers, so a facet that rendered nothing would not pass by default.

/**
 * The rows of one open popover that render unavailable, with the offered count
 * carried alongside so an empty popover cannot answer "none disabled".
 *
 * @param {string} block
 * @returns {{ offered: boolean, disabled: string[] }}
 */
const disabledIn = (block) => {
  const offered = rows(block).map((r) => r.value);
  return { offered: offered.length > 0, disabled: offered.filter((value) => rowIsDisabled(block, value)) };
};

/**
 * The same, for the inert marker.
 *
 * @param {string} block
 * @returns {{ offered: boolean, marked: string[] }}
 */
const markedIn = (block) => {
  const offered = rows(block).map((r) => r.value);
  return { offered: offered.length > 0, marked: offered.filter((value) => rowIsMarkedOff(block, value)) };
};

test("test_the_quality_popover_disables_none_of_the_floors_it_offers", async () => {
  await reset();
  assert.deepEqual(disabledIn(open("quality")), { offered: true, disabled: [] });
});

test("test_the_quality_popover_marks_none_of_the_floors_it_offers", async () => {
  await reset();
  assert.deepEqual(markedIn(open("quality")), { offered: true, marked: [] });
});

// The rate popover's three rules are switches over the source rate rather than
// picks over the filter list, and none of them goes dim either.

test("test_the_rate_popover_disables_none_of_the_rules_it_offers", async () => {
  await reset();
  assert.deepEqual(disabledIn(open("rate")), { offered: true, disabled: [] });
});

test("test_the_rate_popover_marks_none_of_the_rules_it_offers", async () => {
  await reset();
  assert.deepEqual(markedIn(open("rate")), { offered: true, marked: [] });
});

// --- the count chips keep previewing the click ------------------------------------
// Dimming a row does not silence its chip: the number beside an inert row is
// still what the dropdowns would offer if it were clicked, which is what makes
// the row's inertness legible rather than mysterious. Here that is the live
// pair, unchanged, on both halves of the chip.

test("test_an_inert_row_still_previews_the_selection_its_click_would_produce", async () => {
  assert.equal(countChip(await lengthScene(), MEDIUM), "1/1");
});

// The other end of the same fact: on a row whose pick WOULD widen, the chip
// answers the wider pair, so the reading above is a preview rather than a
// constant.
test("test_a_widening_row_previews_the_larger_selection_its_click_would_produce", async () => {
  assert.equal(countChip(await lengthScene(WIDE), LONG), "2/2");
});
