// Behavioral suite for hqptuner/static/model/shell/plate.js: which format the plate is laid out at for a window, and
// whether the format shows every setting explanation in place. The formats are three, tablet landscape in CSS px:
// Expanded 1366×1024, Normal 1180×820, Compact 1133×744. How the plate stretches to the window under Auto, its size
// in each window, and the window sizes where each layout starts, are tests/js/model/shell/plate-auto-stretch.test.js's.
//
// Run: node --test tests/js/model/shell/plate.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { plateFit } from "../../../../hqptuner/static/model/shell/plate.js";

const EXPANDED = "expanded";
const COMPACT = "compact";

/** @type {[string, { w: number, h: number }, string][]} */
const FORMAT_CASES = [
  ["a_window_larger_than_expanded", { w: 1500, h: 1100 }, EXPANDED],
  ["a_window_a_little_shorter_than_expanded", { w: 1366, h: 1004 }, EXPANDED],
  ["a_window_narrower_and_shorter_than_normal", { w: 1120, h: 779 }, COMPACT],
  ["a_1080_by_810_window", { w: 1080, h: 810 }, COMPACT],
  ["a_1133_by_744_window", { w: 1133, h: 744 }, COMPACT],
  ["a_window_smaller_than_every_format", { w: 540, h: 405 }, COMPACT],
];

for (const [name, win, format] of FORMAT_CASES) {
  test(`test_${name}_gets_the_${format}_format`, () => {
    assert.equal(plateFit(win).id, format);
  });
}

test("test_a_window_a_little_shorter_than_expanded_shows_every_explanation_in_place", () => {
  assert.equal(plateFit({ w: 1366, h: 1004 }).both, true);
});
