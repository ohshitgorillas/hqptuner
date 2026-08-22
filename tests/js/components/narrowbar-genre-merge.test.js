// Behavioral suite for the merged pop/rock genre option. No filter in the data
// carries one of the pair without the other, so the two options became one: it
// keeps the internal value `pop`, and the value `rock` no longer exists anywhere
// the bar can offer it.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. State is driven through tests/js/support/genrepopover.js,
// which resets the bar's source signals with wire-shaped payloads — the
// engine's `<GetFilters/>` enumeration (protocol.md:226) and the static
// name-keyed genre overlay from /api/metadata — and opens a facet by invoking
// the onClick its button carries.
//
// The merged row's caption is owner copy and is asserted nowhere: what the merge
// means to a caller is the VALUE domain — one row valued `pop`, no row valued
// `rock` — and that is what every case below reads (docs/testing.md rule 9).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-genre-merge.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nGenre } from "../../../hqptuner/static/store/narrow/state.js";
import { resetNarrowBar, openFacet, popoverRows, checkedRows } from "../support/genrepopover.js";

const MERGED = "pop";
const RETIRED = "rock";

// The overlay tags one filter with each genre these cases speak about, so a
// genre row that is offered at all is offered here.
const FILTERS = [
  { index: "0", name: "gauss-pop", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-jazz", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-classical", value: "2", arg: 0, description: "5/5 timbre ⥮ Any", apodizing: false },
];

const OVERLAY = {
  "gauss-pop": { genre: ["pop"] },
  "gauss-jazz": { genre: ["jazz"] },
  "gauss-classical": { genre: ["classical"] },
};

/** @returns {Promise<void>} */
const reset = () => resetNarrowBar(FILTERS, { overlay: OVERLAY });

/**
 * Every value the genre popover offers as a row.
 *
 * @returns {string[]}
 */
const genreValues = () => popoverRows(openFacet("genre")).map((r) => r.value);

// --- one option for the pair, under the surviving value ----------------------------

test("test_the_genre_popover_offers_exactly_one_row_for_the_merged_pair", async () => {
  await reset();
  assert.deepEqual(
    genreValues().filter((v) => v === MERGED),
    [MERGED],
  );
});

// The absence is read against the rows the popover actually offers: a popover
// rendering no rows at all also offers no `rock` row, and would pass an
// unanchored absence.

test("test_the_genre_popover_offers_rows_and_none_of_them_is_the_retired_value", async () => {
  await reset();
  const offered = genreValues();
  assert.deepEqual(
    { offered: offered.length > 0, retired: offered.includes(RETIRED) },
    { offered: true, retired: false },
  );
});

// --- the merged row keeps the value `pop` ------------------------------------------

test("test_picking_the_pop_genre_checks_the_merged_row", async () => {
  await reset();
  nGenre.value = [MERGED];
  assert.deepEqual(checkedRows(openFacet("genre")), [MERGED]);
});

// --- the value `rock` is gone, so it can check nothing --------------------------------

test("test_the_retired_rock_genre_value_checks_none_of_the_rows_offered", async () => {
  await reset();
  nGenre.value = [RETIRED];
  const block = openFacet("genre");
  assert.deepEqual(
    { offered: popoverRows(block).length > 0, checked: checkedRows(block) },
    { offered: true, checked: [] },
  );
});
