// Behavioral suite for the narrow bar's INERT choice rows. A genre, focus,
// phase or length row is inert on either of two independent grounds: its pick
// would leave both the 1x and the Nx option list exactly the size they already
// are, so the click can no longer change what the dropdowns offer; or its pick
// would leave both of those lists EMPTY, which is just as useless. Either way
// the row renders as an unavailable control carrying an explanation rather than
// as a live one.
//
// The first ground exists for the union facets. Phase and length union within
// themselves — a filter has exactly one of each, so a second pick can only
// widen — and a widening that reaches nothing new is a click with no effect.
// With phase = minimum + intermediate and length = short picked over the
// fixture below, the lists hold one short minimum-phase filter, and the medium
// and xlong rows would add nothing to it.
//
// The boundary on the second ground is EITHER list, not both: a chip reading
// "0/2" or "2/0" is a live row and only "0/0" is not, so the two one-sided
// scenes are entered here on their own, over dropdowns holding deliberately
// different option lists.
//
// Two states that LOOK inert are not, and each is entered here on its own. A row
// already picked is a row whose click UNPICKS, which is always worth offering
// however its counts read. And before /config has been read the two dropdowns
// hold no options at all, so every row's counts read 0/0 for a reason that has
// nothing to do with the filters; the bar's first paint dims nothing.
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
// caption beside the checkbox (docs/testing.md rule 9). The same rule keeps the
// tooltip's SENTENCE out of every assertion below: the wording is owner copy and
// is reworded at will, and what the spec makes behavior is that an inert row
// explains itself and a live one does not. So the tooltip is read as present or
// absent and never as text.
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
  rowHasTitle,
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

/**
 * The same, with the two PCM filter slots offering DIFFERENT option lists, so a
 * pick can empty one chain's dropdown while leaving the other's populated.
 *
 * @param {Record<string, unknown>[]} oneFilters
 * @param {Record<string, unknown>[]} nxFilters
 * @returns {Promise<void>}
 */
function resetSplit(oneFilters, nxFilters) {
  const opts = (/** @type {Record<string, unknown>[]} */ fs) => fs.map((f) => ({ value: f.value, label: f.name }));
  const fields = [
    { name: "filter1x", value: "0", options: opts(oneFilters) },
    { name: "filter", value: "0", options: opts(nxFilters) },
  ];
  return resetNarrowBar(BASE, { overlay: OVERLAY, fields });
}

/**
 * The bar as it first paints: the engine enumeration is in, /config is not, so
 * neither dropdown holds a single option yet.
 *
 * @returns {Promise<void>}
 */
const resetFirstPaint = () => resetNarrowBar(BASE, { overlay: OVERLAY });

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

/**
 * The same, for the tooltip.
 *
 * @param {string} block
 * @returns {{ offered: boolean, titled: string[] }}
 */
const titledIn = (block) => {
  const offered = rows(block).map((r) => r.value);
  return { offered: offered.length > 0, titled: offered.filter((value) => rowHasTitle(block, value)) };
};

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

/**
 * The same, with short already picked, so the row read back is a PICKED one
 * whose click would still leave both lists empty.
 *
 * @returns {Promise<string>}
 */
async function pickedDeadEndScene() {
  await reset();
  nPhase.value = [INTERMEDIATE];
  nLength.value = [SHORT];
  return open("length");
}

/**
 * The length popover over live lists, where one row's pick would empty them:
 * both linear-phase fixture filters sit outside the short taxonomy, so the lists
 * hold two filters now and would hold none after that click.
 *
 * @returns {Promise<string>}
 */
async function emptyingLengthScene() {
  await reset();
  nPhase.value = [LINEAR];
  return open("length");
}

/**
 * The genre popover in AND mode with one genre picked. Adding a second genre
 * demands a filter carrying both, and no fixture filter does, so this is a row
 * whose tag IS carried under the other facets and whose pick still empties the
 * lists.
 *
 * @returns {Promise<string>}
 */
async function emptyingGenreScene() {
  await reset();
  nGenreMode.value = "and";
  nGenre.value = [CLASSICAL];
  return open("genre");
}

/**
 * The focus popover where picking transients empties ONE chain's dropdown and
 * leaves the other's holding two: the 1x slot offers the short minimum-phase
 * filter alone, and that filter is the one transients drops.
 *
 * @param {Record<string, unknown>[]} oneFilters
 * @param {Record<string, unknown>[]} nxFilters
 * @returns {Promise<string>}
 */
async function oneSidedScene(oneFilters, nxFilters) {
  await resetSplit(oneFilters, nxFilters);
  nFocusMode.value = "or";
  return open("focus");
}

// The short minimum-phase filter alone: the option list that transients empties.
const SHORT_ONLY = [BASE[0]];

/**
 * The length popover at first paint, before /config has been read.
 *
 * @returns {Promise<string>}
 */
async function firstPaintScene() {
  await resetFirstPaint();
  return open("length");
}

/**
 * The same, with the selection that dims rows once the dropdowns are populated:
 * phase narrowed to the two phases and length to short, exactly the worked
 * example. With no options in either dropdown the bar has nothing to say about
 * which tags match, so nothing here is dim for any reason at all.
 *
 * @returns {Promise<string>}
 */
async function narrowedFirstPaintScene() {
  await resetFirstPaint();
  nPhase.value = [MINIMUM, INTERMEDIATE];
  nLength.value = [SHORT];
  return open("length");
}

/**
 * The genre popover with the manual's "any" escape hatch picked in AND mode,
 * where the older any-dominates rule puts every other genre row out of action.
 *
 * @returns {Promise<string>}
 */
async function anyRuleScene() {
  await reset();
  nGenreMode.value = "and";
  nGenre.value = [ANY];
  return open("genre");
}

/**
 * A facet other than length opened over the dead end: phase is pinned to a value
 * no fixture filter carries, so every chip in the bar reads 0/0 and the inertness
 * rule is demonstrably firing on the tag facets (the length popover over this
 * same selection goes wholly inert below).
 *
 * @param {string} facet
 * @returns {Promise<string>}
 */
async function deadEndFacet(facet) {
  await reset();
  nPhase.value = [INTERMEDIATE];
  return open(facet);
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
// An inert row explains itself. What the sentence says is owner copy and stays
// out of the assertion (docs/testing.md rule 9); that an explanation is on screen
// at all is the behavior, and it is what separates these rows from the ones the
// any-dominates rule dims silently.

test("test_an_inert_length_row_carries_a_tooltip", async () => {
  assert.equal(rowHasTitle(await lengthScene(), MEDIUM), true);
});

test("test_an_inert_phase_row_carries_a_tooltip", async () => {
  assert.equal(rowHasTitle(await phaseScene(), INTERMEDIATE), true);
});

test("test_an_inert_genre_row_carries_a_tooltip", async () => {
  assert.equal(rowHasTitle(await genreScene(), JAZZ), true);
});

test("test_an_inert_focus_row_carries_a_tooltip", async () => {
  assert.equal(rowHasTitle(await focusScene(), TRANSIENTS), true);
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

test("test_a_picked_phase_row_is_not_marked_off_though_its_counts_are_unchanged", async () => {
  assert.equal(rowIsMarkedOff(await phaseScene(), MINIMUM), false);
});

test("test_a_picked_genre_row_is_not_disabled_though_its_counts_are_unchanged", async () => {
  assert.equal(rowIsDisabled(await genreScene(), CLASSICAL), false);
});

test("test_a_picked_genre_row_is_not_marked_off_though_its_counts_are_unchanged", async () => {
  assert.equal(rowIsMarkedOff(await genreScene(), CLASSICAL), false);
});

// The same on the bar's other multi-select, whose picked row the earlier cases
// left unread: unpicking timbre reaches nothing new either, since the one live
// filter is the only minimum-phase one the fixture carries.

test("test_a_picked_focus_row_is_not_disabled_though_its_counts_are_unchanged", async () => {
  assert.equal(rowIsDisabled(await focusScene(), TIMBRE), false);
});

test("test_a_picked_focus_row_is_not_marked_off_though_its_counts_are_unchanged", async () => {
  assert.equal(rowIsMarkedOff(await focusScene(), TIMBRE), false);
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
  assert.equal(rowHasTitle(await lengthScene(WIDE), LONG), false);
});

// --- a pick that empties both lists goes inert too ---------------------------------
// A click that leaves the user with nothing to choose from is as useless as one
// that changes nothing, and gets the same treatment. This is the second, wholly
// independent ground for inertness: the lists are live now and the chip reads
// 0/0, so the row is not one nothing carries.

test("test_the_emptying_length_scene_really_reads_zero_over_zero", async () => {
  assert.equal(countChip(await emptyingLengthScene(), SHORT), "0/0");
});

test("test_a_length_row_whose_pick_would_empty_both_lists_is_disabled", async () => {
  assert.equal(rowIsDisabled(await emptyingLengthScene(), SHORT), true);
});

test("test_a_length_row_whose_pick_would_empty_both_lists_is_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await emptyingLengthScene(), SHORT), true);
});

test("test_a_row_whose_pick_would_empty_both_lists_carries_a_tooltip", async () => {
  assert.equal(rowHasTitle(await emptyingLengthScene(), SHORT), true);
});

// The same ground on a facet where the row's own tag is plainly carried under
// every other pick: jazz has three filters to itself, and only the AND with the
// picked classical empties the lists.
test("test_the_emptying_genre_scene_really_reads_zero_over_zero", async () => {
  assert.equal(countChip(await emptyingGenreScene(), JAZZ), "0/0");
});

test("test_a_genre_row_whose_pick_would_empty_both_lists_is_disabled", async () => {
  assert.equal(rowIsDisabled(await emptyingGenreScene(), JAZZ), true);
});

// The discriminating scene of the whole file, so it gets all three halves: this
// row's own tag IS carried under every other pick, so an implementation reading
// only "does anything carry this tag" would leave it live, and one that dimmed it
// without marking or explaining it would be dimming it for no visible reason.

test("test_a_genre_row_whose_pick_would_empty_both_lists_is_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await emptyingGenreScene(), JAZZ), true);
});

test("test_a_genre_row_whose_pick_would_empty_both_lists_carries_a_tooltip", async () => {
  assert.equal(rowHasTitle(await emptyingGenreScene(), JAZZ), true);
});

// Where the lists are ALREADY empty every row's pick leaves them empty, so the
// whole popover goes inert on the same ground.
test("test_the_dead_end_scene_really_reads_zero_over_zero", async () => {
  const block = await deadEndScene();
  assert.equal(countChip(block, XLONG), "0/0");
});

test("test_a_row_of_an_already_empty_selection_is_disabled", async () => {
  assert.equal(rowIsDisabled(await deadEndScene(), XLONG), true);
});

test("test_a_row_of_an_already_empty_selection_is_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await deadEndScene(), XLONG), true);
});

test("test_a_row_of_an_already_empty_selection_carries_a_tooltip", async () => {
  assert.equal(rowHasTitle(await deadEndScene(), XLONG), true);
});

// --- one empty list is not two ----------------------------------------------------
// The boundary the rule turns on. Handing the two PCM filter slots different
// option lists makes the halves of the chip disagree, and a row that leaves
// EITHER half populated is a row with something left to offer.

test("test_a_row_emptying_only_the_one_x_list_reads_zero_over_two", async () => {
  assert.equal(countChip(await oneSidedScene(SHORT_ONLY, BASE), TRANSIENTS), "0/2");
});

test("test_a_row_emptying_only_the_one_x_list_is_not_disabled", async () => {
  assert.equal(rowIsDisabled(await oneSidedScene(SHORT_ONLY, BASE), TRANSIENTS), false);
});

test("test_a_row_emptying_only_the_one_x_list_is_not_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await oneSidedScene(SHORT_ONLY, BASE), TRANSIENTS), false);
});

test("test_a_row_emptying_only_the_one_x_list_carries_no_tooltip", async () => {
  assert.equal(rowHasTitle(await oneSidedScene(SHORT_ONLY, BASE), TRANSIENTS), false);
});

test("test_a_row_emptying_only_the_nx_list_reads_two_over_zero", async () => {
  assert.equal(countChip(await oneSidedScene(BASE, SHORT_ONLY), TRANSIENTS), "2/0");
});

test("test_a_row_emptying_only_the_nx_list_is_not_disabled", async () => {
  assert.equal(rowIsDisabled(await oneSidedScene(BASE, SHORT_ONLY), TRANSIENTS), false);
});

test("test_a_row_emptying_only_the_nx_list_is_not_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await oneSidedScene(BASE, SHORT_ONLY), TRANSIENTS), false);
});

test("test_a_row_emptying_only_the_nx_list_carries_no_tooltip", async () => {
  assert.equal(rowHasTitle(await oneSidedScene(BASE, SHORT_ONLY), TRANSIENTS), false);
});

// --- a picked row outranks the emptying rule too -----------------------------------
// Unpicking short here leaves the lists as empty as they already are, and it is
// still the click that gets the user back out of the corner.

test("test_the_picked_dead_end_row_really_reads_zero_over_zero", async () => {
  assert.equal(countChip(await pickedDeadEndScene(), SHORT), "0/0");
});

test("test_a_picked_row_is_not_disabled_though_its_click_leaves_both_lists_empty", async () => {
  assert.equal(rowIsDisabled(await pickedDeadEndScene(), SHORT), false);
});

test("test_a_picked_row_is_not_marked_off_though_its_click_leaves_both_lists_empty", async () => {
  assert.equal(rowIsMarkedOff(await pickedDeadEndScene(), SHORT), false);
});

test("test_a_picked_row_whose_click_leaves_both_lists_empty_carries_no_tooltip", async () => {
  assert.equal(rowHasTitle(await pickedDeadEndScene(), SHORT), false);
});

// --- before /config arrives nothing is dim ----------------------------------------
// The dropdowns hold no options at all on the bar's first paint, so every count
// reads 0/0 for a reason that says nothing about the filters. The xlong row is
// read because a fixture filter carries it: the older "nothing carries this"
// rule cannot be what answers here.

test("test_the_first_paint_scene_really_reads_zero_over_zero", async () => {
  assert.equal(countChip(await firstPaintScene(), XLONG), "0/0");
});

// Every row the popover offers is read, not one of them, because the suspension
// is total: while the dropdowns hold no options nothing is dim on ANY ground.

test("test_no_row_the_popover_offers_is_disabled_while_the_dropdowns_hold_no_options", async () => {
  assert.deepEqual(disabledIn(await firstPaintScene()), { offered: true, disabled: [] });
});

test("test_no_row_the_popover_offers_is_marked_off_while_the_dropdowns_hold_no_options", async () => {
  assert.deepEqual(markedIn(await firstPaintScene()), { offered: true, marked: [] });
});

test("test_no_row_the_popover_offers_carries_a_tooltip_while_the_dropdowns_hold_no_options", async () => {
  assert.deepEqual(titledIn(await firstPaintScene()), { offered: true, titled: [] });
});

// And the suspension outranks the other grounds rather than merely not meeting
// them: this is the worked example's own selection, under which the medium and
// xlong rows are dim once /config has been read, and here nothing is.

test("test_no_row_is_disabled_under_a_narrowing_selection_while_the_dropdowns_hold_no_options", async () => {
  assert.deepEqual(disabledIn(await narrowedFirstPaintScene()), { offered: true, disabled: [] });
});

test("test_no_row_is_marked_off_under_a_narrowing_selection_while_the_dropdowns_hold_no_options", async () => {
  assert.deepEqual(markedIn(await narrowedFirstPaintScene()), { offered: true, marked: [] });
});

test("test_no_row_carries_a_tooltip_under_a_narrowing_selection_while_the_dropdowns_hold_no_options", async () => {
  assert.deepEqual(titledIn(await narrowedFirstPaintScene()), { offered: true, titled: [] });
});

// --- the genre facet's older rule keeps its own wording ---------------------------
// An AND-mode genre selection carrying the manual's "any" escape hatch makes
// every other genre row unable to change the result, and that row is dimmed
// without an explanation (tests/js/components/narrowbar-genre-any.test.js pins
// the dimming itself).

// The row is established as inert in this very scene first, so the absence of a
// tooltip below is the absence on a DIMMED row rather than on a live one.

test("test_a_genre_row_inert_under_the_any_rule_is_disabled", async () => {
  assert.equal(rowIsDisabled(await anyRuleScene(), CLASSICAL), true);
});

test("test_a_genre_row_inert_under_the_any_rule_is_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await anyRuleScene(), CLASSICAL), true);
});

test("test_a_genre_row_inert_under_the_any_rule_carries_no_tooltip", async () => {
  assert.equal(rowHasTitle(await anyRuleScene(), CLASSICAL), false);
});

// --- the facets the rule does not reach -------------------------------------------
// Quality is a floor rather than a set of picks, and the rate popover's three
// rules are switches over the source rate; neither is a pick over the filter
// list, and no row of either goes dim ever.
//
// Both are read over the DEAD END — phase pinned to a value no fixture filter
// carries, every chip in the bar reading 0/0 — where the rule is demonstrably
// firing on the tag facets (the length popover over this same selection is wholly
// inert above). Over a bare reset these cases would pass on any implementation,
// because there the rule fires on nothing at all. Read against the rows the
// popover actually offers, so a facet that rendered nothing would not pass by
// default either.

test("test_the_quality_popover_disables_none_of_the_floors_it_offers", async () => {
  assert.deepEqual(disabledIn(await deadEndFacet("quality")), { offered: true, disabled: [] });
});

test("test_the_quality_popover_marks_none_of_the_floors_it_offers", async () => {
  assert.deepEqual(markedIn(await deadEndFacet("quality")), { offered: true, marked: [] });
});

test("test_the_rate_popover_disables_none_of_the_rules_it_offers", async () => {
  assert.deepEqual(disabledIn(await deadEndFacet("rate")), { offered: true, disabled: [] });
});

test("test_the_rate_popover_marks_none_of_the_rules_it_offers", async () => {
  assert.deepEqual(markedIn(await deadEndFacet("rate")), { offered: true, marked: [] });
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
