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
// Rows are named by the WIRE VALUE their label carries in `data-v`, never by
// the caption beside the checkbox (docs/testing.md rule 9).
//
// Reading taken where the spec was silent: "MultiSelect with no `off` prop
// renders every checkbox enabled" is exercised through the FOCUS facet, the
// bar's other multi-select, on the reading that the spec's inertness rule names
// the genre multi-select alone. The spec's fifth MultiSelect behavior —
// clicking an off row leaves the bound array alone — is NOT covered here: a
// disabled control receives no click at all in a browser, so there is nothing
// SSR can deliver that would answer the question honestly, and inventing a
// handler invocation would test a path a pointer never takes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-genre-any.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nGenre, nGenreMode } from "../../../hqptuner/static/store/narrow/state.js";
import { resetNarrowBar, openFacet, popoverRows, rowIsDisabled, rowIsMarkedOff } from "../support/genrepopover.js";

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

// The two genre values these cases speak about, as the store and the rows both
// spell them.
const CLASSICAL = "classical";
const ANY = "any";

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
  assert.equal(rowIsDisabled(await genrePopover(["any"], "and"), CLASSICAL), true);
});

test("test_with_any_picked_and_the_and_mode_the_classical_row_is_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await genrePopover(["any"], "and"), CLASSICAL), true);
});

// The rule reads "the selection INCLUDES any", so a selection carrying another
// genre alongside it marks the rest inert just the same, whichever end of the
// array the escape hatch sits at.

test("test_with_any_picked_before_another_genre_and_the_and_mode_the_classical_row_is_disabled", async () => {
  assert.equal(rowIsDisabled(await genrePopover(["any", "jazz"], "and"), CLASSICAL), true);
});

test("test_with_any_picked_after_another_genre_and_the_and_mode_the_classical_row_is_disabled", async () => {
  assert.equal(rowIsDisabled(await genrePopover(["jazz", "any"], "and"), CLASSICAL), true);
});

// --- the "any" row itself stays live, so the user can give the escape hatch back ---

test("test_with_any_picked_and_the_and_mode_the_any_row_is_not_disabled", async () => {
  assert.equal(rowIsDisabled(await genrePopover(["any"], "and"), ANY), false);
});

test("test_with_any_picked_and_the_and_mode_the_any_row_is_not_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await genrePopover(["any"], "and"), ANY), false);
});

// --- drop one term at a time: every row stays live --------------------------------

test("test_with_any_picked_and_the_or_mode_the_classical_row_is_not_disabled", async () => {
  assert.equal(rowIsDisabled(await genrePopover(["any"], "or"), CLASSICAL), false);
});

test("test_with_any_picked_and_the_or_mode_the_classical_row_is_not_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await genrePopover(["any"], "or"), CLASSICAL), false);
});

test("test_with_jazz_picked_and_the_and_mode_the_classical_row_is_not_disabled", async () => {
  assert.equal(rowIsDisabled(await genrePopover(["jazz"], "and"), CLASSICAL), false);
});

test("test_with_jazz_picked_and_the_and_mode_the_classical_row_is_not_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await genrePopover(["jazz"], "and"), CLASSICAL), false);
});

test("test_with_no_genre_picked_and_the_and_mode_the_classical_row_is_not_disabled", async () => {
  assert.equal(rowIsDisabled(await genrePopover([], "and"), CLASSICAL), false);
});

test("test_with_no_genre_picked_and_the_and_mode_the_classical_row_is_not_marked_off", async () => {
  assert.equal(rowIsMarkedOff(await genrePopover([], "and"), CLASSICAL), false);
});

// --- the bar's other multi-select carries no inertness rule -----------------------

// Read against the rows the popover actually offers: a facet that rendered
// nothing at all would also disable nothing, so the row list is proven non-empty
// in the same breath.

test("test_the_focus_popover_marks_none_of_the_rows_it_offers_unavailable", async () => {
  await reset();
  const block = openFacet("focus");
  const offered = popoverRows(block).map((r) => r.value);
  assert.deepEqual(
    { offered: offered.length > 0, disabled: offered.filter((value) => rowIsDisabled(block, value)) },
    { offered: true, disabled: [] },
  );
});
