// Suite for store/meter/spectrogram.js: slices laid along the time axis by the
// frame time the feed says each covers, and the newest of them that fit the
// strip's window.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/spectrogram.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  addSpectrumFrame,
  initSpectrogram,
  spectrogramCells,
  visibleCells,
} from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { setApodWindow } from "../../../../hqptuner/static/store/ui/prefs.js";

const GEO = { nyquist: 22050, channels: 2, centres: [1000, 2000] };

/**
 * One stored slice of `ms` frame time, its levels marked by `mark`.
 *
 * @param {number} ms
 * @param {number} mark
 */
const slice = (ms, mark) => ({
  ms,
  centres: GEO.centres,
  nyquist: GEO.nyquist,
  channels: [Float32Array.of(mark, mark), Float32Array.of(mark + 1, mark + 1)],
  sum: Float32Array.of(mark + 2, mark + 2),
});

test("test_the_newest_slices_that_fit_the_span_are_drawn_oldest_first", () => {
  const cells = visibleCells([slice(300, 10), slice(300, 20), slice(300, 30)], 700, "sum");
  assert.deepEqual(
    cells.map((c) => c.slices[0][0]),
    [22, 32],
  );
});

test("test_a_cell_is_as_wide_as_the_frame_time_its_slice_covers", () => {
  assert.deepEqual(
    visibleCells([slice(232.2, 0)], 30000, "sum").map((c) => c.ms),
    [232.2],
  );
});

test("test_a_cell_draws_the_picked_channel", () => {
  assert.equal(visibleCells([slice(200, 40)], 30000, "1")[0].slices[0][0], 41);
});

test("test_a_cell_falls_back_to_the_sum_where_its_slice_lacks_the_picked_channel", () => {
  assert.equal(visibleCells([slice(200, 40)], 30000, "5")[0].slices[0][0], 42);
});

test("test_five_feed_frames_make_one_slice_as_long_as_their_frame_time_together", () => {
  initSpectrogram();
  setApodWindow("30");
  const channels = [{ bands: [-20, -30] }, { bands: [-20, -30] }];
  for (let i = 0; i < 5; i++) addSpectrumFrame(GEO, channels, 46.4);
  assert.deepEqual(
    spectrogramCells.value.map((/** @type {{ ms: number }} */ c) => Math.round(c.ms * 10) / 10),
    [232],
  );
});
