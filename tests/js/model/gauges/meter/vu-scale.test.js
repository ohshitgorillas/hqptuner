// Behavioral suite for where a VU reading sits along the Source VU scale (hqptuner/static/model/gauges/meter/vu.js): 0 at the
// bottom of the -20 to +3 VU scale, 1 at its top, linear in voltage as an analog needle's deflection is, and held on
// the scale past either end. The face draws its ticks and turns its needle by this place.
//
// Run: node --test tests/js/model/gauges/meter/vu-scale.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { scaleShare } from "../../../../../hqptuner/static/model/gauges/meter/vu.js";
import { near } from "../../../support/near.js";

//: The ends of the scale, VU.
const BOTTOM_VU = -20;
const TOP_VU = 3;

//: Tolerance on a place along the scale.
const EPS = 0.0001;

test("test_the_bottom_of_the_scale_sits_at_the_start", () => {
  assert.equal(scaleShare(BOTTOM_VU), 0);
});

test("test_the_top_of_the_scale_sits_at_the_end", () => {
  assert.equal(scaleShare(TOP_VU), 1);
});

// Linear in dB, 0 VU would sit at 20/23 = 0.8696 and -10 VU at 10/23 = 0.4348.
test("test_0_vu_sits_where_its_voltage_puts_it", () => {
  assert.ok(...near(scaleShare(0), 0.6857, EPS));
});

test("test_minus_10_vu_sits_where_its_voltage_puts_it", () => {
  assert.ok(...near(scaleShare(-10), 0.1647, EPS));
});

test("test_a_reading_below_the_scale_holds_at_its_bottom", () => {
  assert.equal(scaleShare(-40), 0);
});

test("test_a_reading_above_the_scale_holds_at_its_top", () => {
  assert.equal(scaleShare(10), 1);
});
