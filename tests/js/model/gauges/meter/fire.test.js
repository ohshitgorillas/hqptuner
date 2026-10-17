// Behavioral suite for the Flames spectrum style's pacing (hqptuner/static/model/gauges/meter/fire.js): the flames move
// as far over a stretch of time whatever paints it comes in, and a paint after a gap far longer than the grid takes to
// burn through draws no more heat than a full grid and shows nothing of what burned before the gap.
//
// Time is a table: each paint is an interval in seconds, the intervals of one stretch differ, and nothing here reads a
// clock or waits on one. The random draws are a table too, handed out in order and silent, a draw of 0, past its end.
//
// Run: node --test tests/js/model/gauges/meter/fire.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  fireSize,
  fireSource,
  freshFlames,
  stepFire,
  stepFlames,
} from "../../../../../hqptuner/static/model/gauges/meter/fire.js";

//: A canvas tall enough that heat is still climbing at the end of a stretch, px.
const SIZE = fireSize(40, 80);
//: Paint intervals, s, at and above a 30 Hz paint, changing from paint to paint.
const PAINTS = [0.0333, 0.05, 0.0417, 0.1, 0.0667, 0.0333];
//: Random draws, varied, cycled to fill a table.
const DRAWS = [0.91, 0.12, 0.57, 0.33, 0.78, 0.05, 0.64];
//: Grids' worth of draws a stretch table holds, more than any stretch here takes.
const STRETCH_GRIDS = 4;
//: A loud and a quieter band, plot fractions.
const LOUD_FRAC = 0.9;
const QUIET_FRAC = 0.5;
//: The one draw a steady fire is lit with.
const STEADY_DRAW = 0.5;
//: Grid steps a steady fire is burnt for, far more than heat takes to climb the grid.
const SETTLE_STEPS = 200;
//: Paints the flames burn loud before the gap.
const LOUD_PAINTS = 30;
//: A gap far longer than heat takes to climb the grid, s.
const GAP_S = 20;

const CELLS = SIZE.cols * SIZE.rows;

/**
 * A random source answering from `table` in order, 0 past its end.
 *
 * @param {number[]} table
 * @returns {() => number}
 */
function drawsFrom(table) {
  let i = 0;
  return () => table[i++] ?? 0;
}

/**
 * `n` draws, DRAWS cycled.
 *
 * @param {number} n
 * @returns {number[]}
 */
const cycled = (n) => Array.from({ length: n }, (_, k) => DRAWS[k % DRAWS.length]);

/**
 * Every column's source at plot fraction `frac`.
 *
 * @param {number} frac
 */
const sourceAt = (frac) => fireSource(new Array(SIZE.cols).fill(frac), SIZE);

/**
 * @param {number[]} dts
 * @returns {number}
 */
const total = (dts) => dts.reduce((sum, dt) => sum + dt, 0);

/**
 * How much heat the flames moved over the paints `dts` from a cold grid: each cell's change, summed.
 *
 * @param {number[]} dts
 * @returns {number}
 */
function moved(dts) {
  const rand = drawsFrom(cycled(STRETCH_GRIDS * CELLS));
  const source = sourceAt(LOUD_FRAC);
  const end = dts.reduce((s, dt) => stepFlames(s, source, dt, rand), freshFlames(SIZE));
  return end.heat.reduce((sum, h) => sum + h, 0);
}

test("test_flames_move_as_far_over_a_stretch_whether_it_comes_as_one_paint_or_many", () => {
  assert.equal(moved(PAINTS) / moved([total(PAINTS)]), 1);
});

test("test_a_paint_after_a_long_gap_burns_no_more_than_a_full_grid_and_shows_only_the_flames_since", () => {
  const loud = sourceAt(LOUD_FRAC);
  const quiet = sourceAt(QUIET_FRAC);
  const warm = drawsFrom(cycled(LOUD_PAINTS * STRETCH_GRIDS * CELLS));
  const before = PAINTS.concat(new Array(LOUD_PAINTS).fill(PAINTS[0])).reduce(
    (s, dt) => stepFlames(s, loud, dt, warm),
    freshFlames(SIZE),
  );
  const oneGrid = drawsFrom(new Array(CELLS).fill(STEADY_DRAW));
  const after = stepFlames(before, quiet, GAP_S, oneGrid).heat;
  let steady = null;
  for (let k = 0; k < SETTLE_STEPS; k++) steady = stepFire(steady, quiet, SIZE, () => STEADY_DRAW);
  assert.deepEqual(after, steady);
});
