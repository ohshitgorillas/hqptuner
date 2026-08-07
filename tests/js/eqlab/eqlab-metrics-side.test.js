// Behavioral suite for scripts/eqlab/metrics.js — the `side` option on the
// target-relative `rmse` metric kind. Written blind from a spec block: no
// eqlab source was read.
//
// Curves and targets are hand-built on tiny grids (spec sanctions this: the
// public contract is parallel freqs/db arrays on a shared grid), so every
// expected value computes by hand under the default log domain, whose
// reduction over in-range points is the plain mean.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/eqlab-metrics-side.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { computeMetrics } from "../../../scripts/eqlab/metrics.js";
import { near } from "../support/eqlab-helpers.js";

/** @typedef {import("../../../scripts/eqlab/curve.js").Curve} Curve */
/** @typedef {import("../../../scripts/eqlab/curve.js").CurveLike} CurveLike */

const FREQS = [100, 200, 400, 800];
/** @type {[number, number]} */
const RANGE = [50, 1000];
/** @type {CurveLike} */
const ZEROS = { freqs: FREQS, db: [0, 0, 0, 0] };

/**
 * @param {number[]} db
 * @returns {Curve}
 */
const grid = (db) => ({ freqs: FREQS, db: Float64Array.from(db), fs: 48000, partial: false });

// Mixed curve: two above target (3, 5), one below (−4), one at (0).
const MIXED = grid([3, -4, 0, 5]);

// --- one-sided reduction -----------------------------------------------------

// Spec exact case: only the above-target points contribute, squared.
test("test_side_above_scores_only_above_target_deviation", () => {
  const m = computeMetrics(MIXED, { d: { kind: "rmse", range: RANGE, side: "above" } }, ZEROS);
  assert.ok(...near(m.d.value, Math.sqrt((9 + 0 + 0 + 25) / 4), 1e-9));
});

test("test_side_below_scores_only_below_target_deviation", () => {
  const m = computeMetrics(MIXED, { d: { kind: "rmse", range: RANGE, side: "below" } }, ZEROS);
  assert.ok(...near(m.d.value, Math.sqrt((0 + 16 + 0 + 0) / 4), 1e-9));
});

test("test_a_curve_entirely_at_or_below_target_scores_zero_on_the_above_side", () => {
  const m = computeMetrics(grid([-1, 0, -3, -2]), { d: { kind: "rmse", range: RANGE, side: "above" } }, ZEROS);
  assert.ok(...near(m.d.value, 0, 1e-12));
});

test("test_a_curve_entirely_at_or_above_target_scores_zero_on_the_below_side", () => {
  const m = computeMetrics(grid([1, 0, 3, 2]), { d: { kind: "rmse", range: RANGE, side: "below" } }, ZEROS);
  assert.ok(...near(m.d.value, 0, 1e-12));
});

// --- side omitted: symmetric rmse unchanged ----------------------------------

test("test_omitting_side_keeps_the_symmetric_root_mean_square_of_all_deviations", () => {
  const m = computeMetrics(MIXED, { d: { kind: "rmse", range: RANGE } }, ZEROS);
  assert.ok(...near(m.d.value, Math.sqrt((9 + 16 + 0 + 25) / 4), 1e-9));
});

// --- validation --------------------------------------------------------------

test("test_an_unknown_side_value_is_rejected_naming_the_valid_sides", () => {
  assert.throws(
    () => computeMetrics(MIXED, { d: { kind: "rmse", range: RANGE, side: "left" } }, ZEROS),
    /above[\s\S]*below|below[\s\S]*above/,
  );
});

test("test_rmse_with_a_side_still_requires_a_target", () => {
  assert.throws(() => computeMetrics(MIXED, { d: { kind: "rmse", range: RANGE, side: "above" } }));
});

// --- composition with the erb domain -----------------------------------------

const ALL_ABOVE = grid([1, 2, 3, 4]);
const ALL_BELOW = grid([-1, -2, -3, -4]);

test("test_side_above_under_erb_equals_plain_erb_rmse_for_a_curve_everywhere_above_target", () => {
  const sided = computeMetrics(ALL_ABOVE, { d: { kind: "rmse", range: RANGE, domain: "erb", side: "above" } }, ZEROS);
  const plain = computeMetrics(ALL_ABOVE, { d: { kind: "rmse", range: RANGE, domain: "erb" } }, ZEROS);
  assert.ok(...near(sided.d.value, plain.d.value, 1e-9));
});

test("test_side_below_under_erb_equals_plain_erb_rmse_for_a_curve_everywhere_below_target", () => {
  const sided = computeMetrics(ALL_BELOW, { d: { kind: "rmse", range: RANGE, domain: "erb", side: "below" } }, ZEROS);
  const plain = computeMetrics(ALL_BELOW, { d: { kind: "rmse", range: RANGE, domain: "erb" } }, ZEROS);
  assert.ok(...near(sided.d.value, plain.d.value, 1e-9));
});
