// Behavioral suite for the inert genre rows: a genre choice row that can no
// longer change what the dropdowns offer renders as an unavailable control
// rather than as a live one. The rule the bar applies is a conjunction — the
// narrowing genre selection includes "any", the genre combine mode is "and",
// and the row is not the "any" row itself — so each of the three terms is
// entered on its own and pinned to leave every row live.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. State is driven by assigning the exported source signals
// the real payloads carry, through tests/js/support/genrepopover.js, which also
// carries the open-a-facet and read-a-row machinery and states what those
// couple to.
//
// Rows are never named by a hard-coded caption: the caption a genre value wears
// is looked up by picking that value and reading back which row renders checked,
// so a reworded genre label moves these cases with it instead of failing them.
//
// Reading taken where the spec was silent: "MultiSelect with no `off` prop
// renders every checkbox enabled" is exercised through the FOCUS facet, the
// bar's other multi-select, on the reading that the spec's inertness rule names
// the genre multi-select alone. The spec's fifth MultiSelect behaviour —
// clicking an off row leaves the bound array alone — is NOT covered here: a
// disabled control receives no click at all in a browser, so there is nothing
// SSR can deliver that would answer the question honestly, and inventing a
// handler invocation would test a path a pointer never takes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-genre-any.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nGenre, nGenreMode } from "../../../hqptuner/static/store/narrow/state.js";
import {
  resetNarrowBar,
  openFacet,
  checkedRows,
  popoverRows,
  rowIsDisabled,
  rowIsMarkedOff,
} from "../support/genrepopover.js";

// Filters in the engine's own description format, `"<q>/5 [focus, ...] <glyph>
// <ratio>"` with the PCM glyph, plus the static overlay's genre tags. The three
// genre values these cases speak about — classical, jazz and the manual's "any"
// escape hatch — each have a filter carrying them.
const FILTERS = [
  { index: "0", name: "gauss-classical", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-jazz", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-any", value: "2", arg: 0, description: "5/5 timbre ⥮ Any", apodizing: false },
];

const OVERLAY = {
  "gauss-classical": { genre: ["classical"] },
  "gauss-jazz": { genre: ["jazz"] },
  "gauss-any": { genre: ["any"] },
};

/** @returns {Promise<void>} */
const reset = () => resetNarrowBar(FILTERS, { overlay: OVERLAY });

// The caption a genre value wears, discovered rather than hard-coded: the value
// is picked under the OR mode (which marks nothing inert), and the row that
// comes back checked is that value's own row.
/** @type {Map<string, string>} */
const captions = new Map();

/**
 * @param {string} value
 * @returns {Promise<string>}
 */
async function captionFor(value) {
  const known = captions.get(value);
  if (known) return known;
  await reset();
  nGenreMode.value = "or";
  nGenre.value = [value];
  const [caption] = checkedRows(openFacet("genre"));
  if (!caption) throw new Error(`no genre row is bound to "${value}"`);
  captions.set(value, caption);
  return caption;
}

/**
 * The genre popover, open, under a stated selection and combine mode.
 *
 * @param {string[]} selection
 * @param {string} mode
 * @returns {Promise<string>}
 */
async function genrePopover(selection, mode) {
  await reset();
  nGenreMode.value = mode;
  nGenre.value = selection;
  return openFacet("genre");
}

// --- all three terms hold: every other genre row goes inert -----------------------

test("test_with_any_picked_and_the_and_mode_the_classical_row_is_disabled", async () => {
  const classical = await captionFor("classical");
  assert.equal(rowIsDisabled(await genrePopover(["any"], "and"), classical), true);
});

test("test_with_any_picked_and_the_and_mode_the_classical_row_is_marked_off", async () => {
  const classical = await captionFor("classical");
  assert.equal(rowIsMarkedOff(await genrePopover(["any"], "and"), classical), true);
});

// The rule reads "the selection INCLUDES any", so a selection carrying another
// genre alongside it marks the rest inert just the same, whichever end of the
// array the escape hatch sits at.

test("test_with_any_picked_before_another_genre_and_the_and_mode_the_classical_row_is_disabled", async () => {
  const classical = await captionFor("classical");
  assert.equal(rowIsDisabled(await genrePopover(["any", "jazz"], "and"), classical), true);
});

test("test_with_any_picked_after_another_genre_and_the_and_mode_the_classical_row_is_disabled", async () => {
  const classical = await captionFor("classical");
  assert.equal(rowIsDisabled(await genrePopover(["jazz", "any"], "and"), classical), true);
});

// --- the "any" row itself stays live, so the user can give the escape hatch back ---

test("test_with_any_picked_and_the_and_mode_the_any_row_is_not_disabled", async () => {
  const any = await captionFor("any");
  assert.equal(rowIsDisabled(await genrePopover(["any"], "and"), any), false);
});

test("test_with_any_picked_and_the_and_mode_the_any_row_is_not_marked_off", async () => {
  const any = await captionFor("any");
  assert.equal(rowIsMarkedOff(await genrePopover(["any"], "and"), any), false);
});

// --- drop one term at a time: every row stays live --------------------------------

test("test_with_any_picked_and_the_or_mode_the_classical_row_is_not_disabled", async () => {
  const classical = await captionFor("classical");
  assert.equal(rowIsDisabled(await genrePopover(["any"], "or"), classical), false);
});

test("test_with_any_picked_and_the_or_mode_the_classical_row_is_not_marked_off", async () => {
  const classical = await captionFor("classical");
  assert.equal(rowIsMarkedOff(await genrePopover(["any"], "or"), classical), false);
});

test("test_with_jazz_picked_and_the_and_mode_the_classical_row_is_not_disabled", async () => {
  const classical = await captionFor("classical");
  assert.equal(rowIsDisabled(await genrePopover(["jazz"], "and"), classical), false);
});

test("test_with_jazz_picked_and_the_and_mode_the_classical_row_is_not_marked_off", async () => {
  const classical = await captionFor("classical");
  assert.equal(rowIsMarkedOff(await genrePopover(["jazz"], "and"), classical), false);
});

test("test_with_no_genre_picked_and_the_and_mode_the_classical_row_is_not_disabled", async () => {
  const classical = await captionFor("classical");
  assert.equal(rowIsDisabled(await genrePopover([], "and"), classical), false);
});

test("test_with_no_genre_picked_and_the_and_mode_the_classical_row_is_not_marked_off", async () => {
  const classical = await captionFor("classical");
  assert.equal(rowIsMarkedOff(await genrePopover([], "and"), classical), false);
});

// --- the bar's other multi-select carries no inertness rule -----------------------

// Read against the rows the popover actually offers: a facet that rendered
// nothing at all would also disable nothing, so the row list is proven non-empty
// in the same breath.

test("test_the_focus_popover_marks_none_of_the_rows_it_offers_unavailable", async () => {
  await reset();
  const block = openFacet("focus");
  const offered = popoverRows(block).map((r) => r.label);
  assert.deepEqual(
    { offered: offered.length > 0, disabled: offered.filter((label) => rowIsDisabled(block, label)) },
    { offered: true, disabled: [] },
  );
});
