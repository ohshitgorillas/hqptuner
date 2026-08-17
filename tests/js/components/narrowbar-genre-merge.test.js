// Behavioral suite for the merged pop/rock genre option. No filter in the data
// carries one of the pair without the other, so the two options became one: it
// keeps the internal value `pop`, it is captioned "Pop & rock", and the value
// `rock` no longer exists anywhere the bar can offer it.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. State is driven through tests/js/support/genrepopover.js,
// which resets the bar's source signals with wire-shaped payloads — the
// engine's `<GetFilters/>` enumeration (protocol.md:226) and the static
// name-keyed genre overlay from /api/metadata — and opens a facet by invoking
// the onClick its button carries.
//
// The caption is owner-approved user-facing text and is pinned here character
// for character, in this one place. SSR escapes the ampersand, so a case reads
// the row caption decoded, the way a reader sees it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-genre-merge.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nGenre } from "../../../hqptuner/static/store/narrowing.js";
import { resetNarrowBar, openFacet, popoverRows, checkedRows } from "../support/genrepopover.js";

const MERGED_CAPTION = "Pop & rock";

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
const reset = () => resetNarrowBar(FILTERS, OVERLAY);

/**
 * The characters a reader sees, with the entities the renderer emits put back.
 *
 * @param {string} s
 * @returns {string}
 */
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * Every caption the genre popover offers, as a reader sees it.
 *
 * @returns {string[]}
 */
const genreCaptions = () => popoverRows(openFacet("genre")).map((r) => decode(r.label));

// --- one option for the pair, under the merged caption ----------------------------
// Read as "every caption that mentions rock", so a bar still offering a separate
// Rock row fails here rather than passing on the merged row alone.

test("test_the_genre_popover_offers_one_row_mentioning_rock_and_it_reads_pop_and_rock", async () => {
  await reset();
  assert.deepEqual(
    genreCaptions().filter((c) => /rock/i.test(c)),
    [MERGED_CAPTION],
  );
});

test("test_the_genre_popover_offers_no_row_captioned_pop_alone", async () => {
  await reset();
  assert.equal(genreCaptions().includes("Pop"), false);
});

// --- the merged row keeps the value `pop` ------------------------------------------

test("test_picking_the_pop_genre_checks_the_merged_row", async () => {
  await reset();
  nGenre.value = ["pop"];
  assert.deepEqual(checkedRows(openFacet("genre")).map(decode), [MERGED_CAPTION]);
});

// --- the value `rock` is gone, so it can check nothing --------------------------------

test("test_the_retired_rock_genre_value_checks_no_row", async () => {
  await reset();
  nGenre.value = ["rock"];
  assert.deepEqual(checkedRows(openFacet("genre")), []);
});
