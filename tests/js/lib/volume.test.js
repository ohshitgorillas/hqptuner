// Behavioral suite for lib/volume.js — the Min / Startup / Max clamp policy.
//
// WHY THIS FILE EXISTS: the clamping used to be a module-private `clamp` inside
// components/VolumeRangeBar.js, reachable only through the range handles'
// onInput / onChange callbacks. Server-side rendering never fires those, so not
// one of its rules could be asserted by a policy-compliant test. Moving the
// policy out of the component is what makes it testable at all; these cases are
// the first coverage the rules have ever had.
//
// Pure functions, so no rendering and no store: plain node:test over the public
// exports, in the zero-dependency shape of tests/js/matrixspec.test.js.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/volume.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { clampVolume, num } from "../../../hqptuner/static/lib/volume.js";

// The handles' current positions, which every clamp is relative to.
const CUR = { min: -60, startup: -20, max: 0 };

// --- num: reading a form value ----------------------------------------------

test("test_a_blank_value_falls_back_to_the_default", () => {
  assert.equal(num("", -60), -60);
});

test("test_a_missing_value_falls_back_to_the_default", () => {
  assert.equal(num(null, -60), -60);
});

test("test_an_undefined_value_falls_back_to_the_default", () => {
  assert.equal(num(undefined, -60), -60);
});

test("test_a_non_numeric_value_falls_back_to_the_default", () => {
  assert.equal(num("auto", -60), -60);
});

test("test_a_numeric_string_is_read_as_a_number", () => {
  assert.equal(num("-12", -60), -12);
});

test("test_a_zero_is_kept_rather_than_replaced_by_the_default", () => {
  // 0 dBFS is a legal setting, not an absent one
  assert.equal(num("0", -60), 0);
});

// --- the min handle ----------------------------------------------------------

test("test_min_is_capped_at_zero_dbfs", () => {
  // only Max is documented as accepting positive gain. Both neighbours sit at or
  // above 0 here so the 0 cap is what bites, not the cannot-cross rule.
  assert.equal(clampVolume("min", 5, { min: -60, startup: 0, max: 12 }), 0);
});

test("test_min_cannot_pass_the_startup_handle", () => {
  assert.equal(clampVolume("min", -10, { min: -60, startup: -30, max: 0 }), -30);
});

test("test_min_cannot_pass_the_max_handle", () => {
  assert.equal(clampVolume("min", -5, { min: -60, startup: 0, max: -40 }), -40);
});

test("test_min_stops_at_the_axis_floor", () => {
  assert.equal(clampVolume("min", -300, CUR), -120);
});

test("test_min_below_all_its_neighbours_is_kept", () => {
  assert.equal(clampVolume("min", -70, CUR), -70);
});

// --- the max handle ----------------------------------------------------------

test("test_max_stops_at_the_gain_ceiling", () => {
  assert.equal(clampVolume("max", 40, CUR), 12);
});

test("test_max_accepts_positive_gain_below_the_ceiling", () => {
  assert.equal(clampVolume("max", 6, CUR), 6);
});

test("test_max_cannot_pass_below_the_min_handle", () => {
  assert.equal(clampVolume("max", -80, { min: -60, startup: -60, max: 0 }), -60);
});

test("test_max_cannot_pass_below_the_startup_handle", () => {
  assert.equal(clampVolume("max", -30, CUR), -20);
});

// --- the startup handle ------------------------------------------------------

test("test_startup_cannot_go_below_the_min_handle", () => {
  assert.equal(clampVolume("startup", -80, CUR), -60);
});

test("test_startup_cannot_go_above_the_max_handle", () => {
  assert.equal(clampVolume("startup", 5, CUR), 0);
});

test("test_startup_between_the_two_is_kept", () => {
  assert.equal(clampVolume("startup", -35, CUR), -35);
});

test("test_startup_may_take_positive_gain_when_max_allows_it", () => {
  // the 0 dBFS cap belongs to Min alone; startup rides between its neighbours
  assert.equal(clampVolume("startup", 6, { min: -60, startup: 0, max: 12 }), 6);
});

// --- input coercion, shared by all three ------------------------------------

test("test_a_fractional_value_is_rounded_to_a_whole_decibel", () => {
  assert.equal(clampVolume("startup", -3.6, CUR), -4);
});

test("test_a_string_value_is_accepted", () => {
  assert.equal(clampVolume("startup", "-25", CUR), -25);
});

test("test_a_blank_value_lands_on_zero_before_clamping", () => {
  assert.equal(clampVolume("startup", "", CUR), 0);
});
