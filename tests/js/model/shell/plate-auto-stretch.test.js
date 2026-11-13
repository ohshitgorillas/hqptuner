// Behavioral suite for the Auto fit in hqptuner/static/model/shell/plate.js: the plate's size and layout for a
// window. The formats are three, tablet landscape in CSS px: Compact 1133×744, Normal 1180×820, Expanded 1366×1024.
// Under Auto the plate stretches to the window, each direction on its own, from Compact's size up to Expanded's size:
// a direction smaller than Compact stays at Compact's, a direction bigger than Expanded stops at Expanded's. Nothing
// is scaled. Compact's layout holds until the window is at least Normal's size in both directions, then Normal's;
// Expanded's layout applies once the window is at least 916 tall and at least Normal's width.
//
// The plate's size is read as `w` and `h` on the fit, in CSS px.
//
// Run: node --test tests/js/model/shell/plate-auto-stretch.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { plateFit } from "../../../../hqptuner/static/model/shell/plate.js";

const EXPANDED = "expanded";
const NORMAL = "normal";
const COMPACT = "compact";

const COMPACT_W = 1133;
const COMPACT_H = 744;
const NORMAL_W = 1180;
const NORMAL_H = 820;
const MAX_W = 1366;
const MAX_H = 1024;
const EXPANDED_START_H = 916;

/** @type {[string, { w: number, h: number }, number][]} */
const WIDTH_CASES = [
  ["a_window_between_compact_and_the_maximum_stretches_the_plate_to_its_width", { w: 1250, h: 900 }, 1250],
  ["a_window_wider_than_normal_but_compact_tall_stretches_the_plate_to_its_width", { w: 1300, h: 760 }, 1300],
  ["a_window_wider_than_normal_at_normal_height_stretches_the_plate_to_its_width", { w: 1300, h: NORMAL_H }, 1300],
  ["a_window_wider_than_the_maximum_stops_the_plate_at_the_maximum_width", { w: 1500, h: 900 }, MAX_W],
];

for (const [name, win, width] of WIDTH_CASES) {
  test(`test_auto_${name}`, () => {
    assert.equal(plateFit(win).w, width);
  });
}

/** @type {[string, { w: number, h: number }, number][]} */
const HEIGHT_CASES = [
  ["a_window_between_compact_and_the_maximum_stretches_the_plate_to_its_height", { w: 1250, h: 900 }, 900],
  ["a_window_compact_wide_but_tall_stretches_the_plate_to_its_height", { w: 1150, h: 1000 }, 1000],
  ["a_window_taller_than_the_maximum_stops_the_plate_at_the_maximum_height", { w: 1250, h: 1100 }, MAX_H],
  ["a_window_wider_than_the_maximum_still_stretches_the_plate_to_its_height", { w: 1500, h: 900 }, 900],
];

for (const [name, win, height] of HEIGHT_CASES) {
  test(`test_auto_${name}`, () => {
    assert.equal(plateFit(win).h, height);
  });
}

/** @type {[string, { w: number, h: number }, [number, number]][]} */
const SIZE_CASES = [
  [
    "a_window_narrower_than_compact_keeps_compact_width_and_stretches_to_its_height",
    { w: 1000, h: 900 },
    [COMPACT_W, 900],
  ],
  [
    "a_window_shorter_than_compact_keeps_compact_height_and_stretches_to_its_width",
    { w: 1250, h: 700 },
    [1250, COMPACT_H],
  ],
  ["a_window_far_smaller_than_compact_keeps_compact_size", { w: 540, h: 405 }, [COMPACT_W, COMPACT_H]],
  [
    "a_window_a_little_smaller_than_normal_keeps_compact_width_and_stretches_to_its_height",
    { w: 1080, h: 810 },
    [COMPACT_W, 810],
  ],
  ["a_window_a_little_shorter_than_the_maximum_stretches_the_plate_to_its_size", { w: MAX_W, h: 1004 }, [MAX_W, 1004]],
  ["a_compact_sized_window_gives_the_plate_compact_size", { w: COMPACT_W, h: COMPACT_H }, [COMPACT_W, COMPACT_H]],
];

for (const [name, win, size] of SIZE_CASES) {
  test(`test_auto_${name}`, () => {
    const fit = plateFit(win);
    assert.deepEqual([fit.w, fit.h], size);
  });
}

test("test_auto_switches_to_normal_layout_when_the_window_reaches_normal_height", () => {
  const layouts = [plateFit({ w: NORMAL_W, h: NORMAL_H - 1 }).id, plateFit({ w: NORMAL_W, h: NORMAL_H }).id];
  assert.deepEqual(layouts, [COMPACT, NORMAL]);
});

test("test_auto_switches_to_normal_layout_when_the_window_reaches_normal_width", () => {
  const layouts = [plateFit({ w: NORMAL_W - 1, h: NORMAL_H }).id, plateFit({ w: NORMAL_W, h: NORMAL_H }).id];
  assert.deepEqual(layouts, [COMPACT, NORMAL]);
});

test("test_auto_keeps_compact_layout_in_a_window_wider_than_the_maximum_but_shorter_than_normal", () => {
  assert.equal(plateFit({ w: 1500, h: NORMAL_H - 1 }).id, COMPACT);
});

test("test_auto_switches_to_expanded_layout_when_the_window_reaches_916_tall", () => {
  const layouts = [plateFit({ w: MAX_W, h: EXPANDED_START_H - 1 }).id, plateFit({ w: MAX_W, h: EXPANDED_START_H }).id];
  assert.deepEqual(layouts, [NORMAL, EXPANDED]);
});

test("test_auto_switches_to_expanded_layout_at_normal_width_once_the_window_is_916_tall", () => {
  const layouts = [
    plateFit({ w: NORMAL_W - 1, h: EXPANDED_START_H }).id,
    plateFit({ w: NORMAL_W, h: EXPANDED_START_H }).id,
  ];
  assert.deepEqual(layouts, [COMPACT, EXPANDED]);
});
