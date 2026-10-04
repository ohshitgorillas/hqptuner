// Behavioral suite for lib/apodscale.js playedMs, the width of playback one
// apodizing bin observed between two Status frames.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/apodscale.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { CELL_MS, gridColumns, playedMs } from "../../../hqptuner/static/lib/apodscale.js";

/**
 * Contiguous bins from `start` ms of playback, one per [ms, n] pair.
 *
 * @param {number} start
 * @param {[number, number][]} pairs
 */
function run(start, pairs) {
  let at = start;
  return pairs.map(([ms, n]) => {
    at += ms;
    return { ms, n, at };
  });
}

test("test_the_width_is_how_far_the_position_moved", () => {
  assert.equal(playedMs(10, 12.5), 2500);
});

test("test_a_position_that_did_not_advance_observed_nothing", () => {
  assert.equal(playedMs(10, 10), 0);
});

test("test_an_unreadable_position_observed_nothing", () => {
  assert.equal(playedMs(null, 12), 0);
});

test("test_every_column_is_one_grid_cell_wide_whatever_the_bin_widths", () => {
  const { columns } = gridColumns(
    run(0, [
      [3000, 1],
      [960, 1],
      [2030, 1],
      [1920, 1],
      [2090, 1],
    ]),
    null,
  );
  assert.deepEqual(
    columns.slice(1).map((c, i) => c.x - columns[i].x),
    columns.slice(1).map(() => CELL_MS),
  );
});

test("test_a_column_reads_the_rate_of_the_bins_overlapping_it_weighted_by_overlap", () => {
  // 3 events over the first 3 s, 9 over the next 1 s: the cell from 2 s to 4 s
  // holds 1 event from the first bin and 9 from the second, 10 in 2 s
  const { columns } = gridColumns(
    run(0, [
      [3000, 3],
      [1000, 9],
    ]),
    null,
  );
  assert.equal(columns[1].rate, 5);
});

test("test_the_grid_ends_at_the_last_whole_cell_of_playback", () => {
  // playback reaches 7 s, so the newest whole cell ends at 6 s, at the right edge
  const { span, columns } = gridColumns(run(0, [[7000, 0]]), 30000);
  assert.equal(columns[columns.length - 1].x + CELL_MS, span);
});

test("test_a_fixed_window_holds_every_whole_cell_it_spans", () => {
  const { columns } = gridColumns(
    run(
      0,
      Array.from({ length: 200 }, () => [2000, 1]),
    ),
    300000,
  );
  assert.equal(columns.length, 150);
});

test("test_the_whole_history_window_spans_the_whole_cells_recorded", () => {
  // playback from 1 s to 7 s: whole cells from 2 s to 6 s
  assert.equal(gridColumns(run(1000, [[6000, 0]]), null).span, 4000);
});

test("test_no_bins_draw_no_columns", () => {
  assert.deepEqual(gridColumns([], 30000).columns, []);
});
