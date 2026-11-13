// Store suite for the plate as hqptuner/static/store/faceplate/plate.js gives it: a chosen format, Compact 1133×744,
// Normal 1180×820 or Expanded 1366×1024, is never scaled down in a smaller window and keeps its own size in any window,
// never stretched like Auto; under Auto the plate takes the size the window fit gives it (tests/js/model/shell/plate-auto-stretch.test.js).
//
// The choice is made through the prefs module's setter over a fake storage, read off the module namespace with
// optional access so a prefs module without one fails these cases on their assertions. The plate's size is read as
// `w` and `h` on the plate, in CSS px.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/display-format-exact-size.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { viewport, plate } from "../../../../hqptuner/static/store/faceplate/plate.js";
import * as uiPrefs from "../../../../hqptuner/static/store/ui/prefs.js";
import { useStorage } from "../../support/storage.js";

/** @type {{ [k: string]: unknown, setDisplayFormat?(v: string): void }} */
const prefs = uiPrefs;

const AUTO = "auto";
const EXPANDED = "expanded";
const NORMAL = "normal";
const COMPACT = "compact";

const EXPANDED_W = 1366;
const EXPANDED_H = 1024;
const NORMAL_W = 1180;
const NORMAL_H = 820;
const COMPACT_W = 1133;
const COMPACT_H = 744;

// A window smaller than Normal and Expanded, a little bigger than Compact in height only.
const SMALL = { w: 1080, h: 810 };
// A window far smaller than every format.
const TINY = { w: 540, h: 405 };
// A window between Normal and Expanded in both directions.
const BETWEEN = { w: 1250, h: 900 };
// A window larger than every format.
const LARGE = { w: 1500, h: 1100 };

/** @param {string} format */
function choose(format) {
  prefs.setDisplayFormat?.(format);
}

beforeEach(() => {
  useStorage();
  choose(AUTO);
  viewport.value = SMALL;
});

test("test_a_chosen_compact_in_a_far_smaller_window_keeps_its_own_size", () => {
  choose(COMPACT);
  viewport.value = TINY;
  assert.deepEqual([plate.value.w, plate.value.h], [COMPACT_W, COMPACT_H]);
});

test("test_a_chosen_expanded_in_a_smaller_window_keeps_its_full_width", () => {
  choose(EXPANDED);
  assert.equal(plate.value.w, EXPANDED_W);
});

test("test_a_chosen_expanded_in_a_smaller_window_keeps_its_full_height", () => {
  choose(EXPANDED);
  assert.equal(plate.value.h, EXPANDED_H);
});

test("test_a_chosen_compact_in_a_larger_window_keeps_its_own_width", () => {
  choose(COMPACT);
  viewport.value = LARGE;
  assert.equal(plate.value.w, COMPACT_W);
});

test("test_a_chosen_compact_in_a_larger_window_keeps_its_own_height", () => {
  choose(COMPACT);
  viewport.value = LARGE;
  assert.equal(plate.value.h, COMPACT_H);
});

test("test_a_chosen_normal_in_a_larger_window_keeps_its_own_width", () => {
  choose(NORMAL);
  viewport.value = BETWEEN;
  assert.equal(plate.value.w, NORMAL_W);
});

test("test_a_chosen_normal_in_a_larger_window_keeps_its_own_height", () => {
  choose(NORMAL);
  viewport.value = BETWEEN;
  assert.equal(plate.value.h, NORMAL_H);
});

test("test_auto_gives_the_plate_the_width_of_a_window_between_the_formats", () => {
  viewport.value = BETWEEN;
  assert.equal(plate.value.w, BETWEEN.w);
});
