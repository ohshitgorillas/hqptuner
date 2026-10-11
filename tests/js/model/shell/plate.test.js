// Behavioral suite for hqptuner/static/model/shell/plate.js: which iPad landscape size the plate is laid out at for a
// window, and how far it scales down when the window is smaller than the smallest size. The sizes are three, in
// points.
//
// Run: node --test tests/js/model/shell/plate.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { plateFit } from "../../../../hqptuner/static/model/shell/plate.js";

/** @type {[string, { w: number, h: number }, number][]} */
const SCALE_CASES = [
  ["a_window_that_holds_the_plate", { w: 1500, h: 1100 }, 1],
  ["a_window_half_the_smallest_size", { w: 540, h: 405 }, 0.5],
  ["a_window_narrower_than_the_smallest_size", { w: 810, h: 900 }, 0.75],
  ["a_window_shorter_than_the_smallest_size", { w: 1100, h: 648 }, 0.8],
];

for (const [name, win, scale] of SCALE_CASES) {
  test(`test_${name}_scales_the_plate_down_to_fit_and_never_up`, () => {
    assert.equal(plateFit(win).scale, scale);
  });
}
