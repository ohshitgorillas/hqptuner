// Behavioral suite for hqptuner/static/model/shell/plate.js: which format the plate is laid out at for a window, how
// far it scales down to fit, and whether the format shows every setting explanation in place. The formats are three,
// tablet landscape in CSS px: Expanded 1366×1024, Normal 1180×820, Compact 1133×744. The window gets the largest
// format that still renders at a scale of 0.95 or above; when none does, it gets Compact, scaled down to fit. The
// scale never exceeds 1.
//
// Scales are compared at four decimals; each expected scale is the window's binding side over the format's.
//
// Run: node --test tests/js/model/shell/plate.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { plateFit } from "../../../../hqptuner/static/model/shell/plate.js";

const EXPANDED = "expanded";
const NORMAL = "normal";
const COMPACT = "compact";

/** @param {number} v */
const r4 = (v) => +v.toFixed(4);

/** @type {[string, { w: number, h: number }, string][]} */
const FORMAT_CASES = [
  ["a_window_larger_than_expanded", { w: 1500, h: 1100 }, EXPANDED],
  ["a_window_a_little_shorter_than_expanded", { w: 1366, h: 1004 }, EXPANDED],
  ["a_window_as_wide_as_expanded_but_too_short_for_it", { w: 1366, h: 800 }, NORMAL],
  ["a_window_that_renders_normal_at_exactly_0_95", { w: 1121, h: 779 }, NORMAL],
  ["a_window_that_renders_normal_just_under_0_95", { w: 1120, h: 779 }, COMPACT],
  ["a_1080_by_810_window", { w: 1080, h: 810 }, COMPACT],
  ["a_1133_by_744_window", { w: 1133, h: 744 }, COMPACT],
  ["a_window_too_small_for_any_format_at_0_95", { w: 540, h: 405 }, COMPACT],
];

for (const [name, win, format] of FORMAT_CASES) {
  test(`test_${name}_gets_the_${format}_format`, () => {
    assert.equal(plateFit(win).id, format);
  });
}

/** @type {[string, { w: number, h: number }, number][]} */
const SCALE_CASES = [
  ["a_window_a_little_shorter_than_expanded_scales_expanded_down", { w: 1366, h: 1004 }, 0.9805],
  ["a_1080_by_810_window_scales_compact_down", { w: 1080, h: 810 }, 0.9532],
  ["a_1133_by_744_window_renders_compact_1_to_1", { w: 1133, h: 744 }, 1],
  ["a_window_too_short_for_any_format_at_0_95_scales_compact_down_to_its_height", { w: 1100, h: 700 }, 0.9409],
  ["a_window_too_small_for_any_format_scales_compact_down_to_fit", { w: 540, h: 405 }, 0.4766],
  ["a_window_too_narrow_for_any_format_scales_compact_down_to_its_width", { w: 810, h: 900 }, 0.7149],
];

for (const [name, win, scale] of SCALE_CASES) {
  test(`test_${name}`, () => {
    assert.equal(r4(plateFit(win).scale), scale);
  });
}

test("test_a_window_a_little_shorter_than_expanded_shows_every_explanation_in_place", () => {
  assert.equal(plateFit({ w: 1366, h: 1004 }).both, true);
});
