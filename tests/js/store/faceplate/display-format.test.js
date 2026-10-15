// Store suite for the display-format choice as hqptuner/static/store/faceplate/plate.js honors it: a chosen format,
// Expanded, Normal or Compact, lays the plate out at that format whatever the window; Auto lays it out at the format
// the window picks. Which format a window picks is the fit's (tests/js/model/shell/plate.test.js);
// how the choice is held and stored is the prefs suite's (tests/js/store/prefs/prefs-display-format.test.js).
//
// The choice is made through the prefs module's setter over a fake storage, read off the module namespace with
// optional access so a prefs module without one fails these cases on their assertions. The values chosen are the
// format ids.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/display-format.test.js

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

// A window Auto lays out at Compact.
const SMALL = { w: 1080, h: 810 };
// A window Auto lays out at Expanded.
const NEAR_EXPANDED = { w: 1366, h: 1004 };
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

test("test_a_chosen_compact_lays_a_large_window_out_at_compact", () => {
  choose(COMPACT);
  viewport.value = LARGE;
  assert.equal(plate.value.id, COMPACT);
});

test("test_a_chosen_expanded_lays_a_small_window_out_at_expanded", () => {
  choose(EXPANDED);
  assert.equal(plate.value.id, EXPANDED);
});

test("test_a_chosen_expanded_in_a_small_window_shows_every_explanation_in_place", () => {
  choose(EXPANDED);
  assert.equal(plate.value.both, true);
});

test("test_a_chosen_normal_lays_a_window_auto_gives_expanded_out_at_normal", () => {
  choose(NORMAL);
  viewport.value = NEAR_EXPANDED;
  assert.equal(plate.value.id, NORMAL);
});

test("test_a_chosen_normal_in_a_window_larger_than_every_format_folds_the_explanations", () => {
  choose(NORMAL);
  viewport.value = LARGE;
  assert.equal(plate.value.both, false);
});

test("test_choosing_auto_after_a_format_returns_the_plate_to_the_format_the_window_picks", () => {
  choose(EXPANDED);
  choose(AUTO);
  assert.equal(plate.value.id, COMPACT);
});
