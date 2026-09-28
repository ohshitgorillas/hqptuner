// Suite for store/meter/spectrogram.js: nextColumns appends the column a bin
// closed, then one empty column for each bin skipped since the last one seen.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrogram.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nextColumns } from "../../../../hqptuner/static/store/meter/spectrogram.js";

test("test_each_skipped_bin_follows_the_closed_column_as_an_empty_column", () => {
  const older = { centres: [1000, 2000], nyquist: 22050, slices: [] };
  const closed = { centres: [1000, 2000], nyquist: 88200, slices: [] };
  const next = nextColumns([older, null], closed, { seen: 4, seq: 8 }, 100);
  assert.deepEqual(next, [older, null, closed, null, null, null]);
});
