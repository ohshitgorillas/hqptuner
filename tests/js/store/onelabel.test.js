// Behavioral suite for components/narrowbar/labels.js `oneLabel(rows, value,
// fallback)` — the single-select facet's "what does the picked value read as"
// lookup.
//
// The table here is invented by the test and fed straight back in, which is the
// point: the shipped facet tables are curated option lists and their labels are
// owner copy (docs/testing.md rule 9), so a case asserting one of those rows
// would pin wording rather than behavior. Round-tripping a table nobody ships
// states the lookup itself — matching by value, and the fallback for a value no
// row carries — and stays true whatever the owner renames.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/onelabel.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { oneLabel } from "../../../hqptuner/static/components/narrowbar/labels.js";

/** A table of the shape a facet supplies, with prose no shipped file carries. */
const ROWS = [
  [0, "zz-none"],
  [3, "zz-three"],
  [5, "zz-five"],
];

const FALLBACK = "zz-fallback";

for (const [value, label] of ROWS) {
  test(`test_a_value_the_table_carries_reads_as_its_own_row: ${value}`, () => {
    assert.equal(oneLabel(ROWS, value, FALLBACK), label);
  });
}

test("test_a_value_no_row_carries_reads_as_the_fallback", () => {
  assert.equal(oneLabel(ROWS, 4, FALLBACK), FALLBACK);
});

test("test_an_empty_table_reads_as_the_fallback", () => {
  assert.equal(oneLabel([], 0, FALLBACK), FALLBACK);
});
