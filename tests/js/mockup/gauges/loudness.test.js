// Behavioral suite for mockup/scripts/model/loudness.js: the whole percent of the maximum loudness shelving a shelf
// scale (0 … 1, lib/xdsp.js shelfScale) applies.
//
// Run: node --test tests/js/mockup/loudness.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { percentApplied } from "../../../../mockup/scripts/model/loudness.js";

test("test_percent_applied_of_full_shelving_is_a_hundred", () => {
  assert.equal(percentApplied(1), 100);
});

test("test_percent_applied_of_no_shelving_is_zero", () => {
  assert.equal(percentApplied(0), 0);
});

test("test_percent_applied_scales_a_share_to_a_percent", () => {
  assert.equal(percentApplied(0.25), 25);
});

test("test_percent_applied_rounds_a_half_percent_up", () => {
  assert.equal(percentApplied(0.625), 63);
});

test("test_percent_applied_rounds_down_below_a_half_percent", () => {
  assert.equal(percentApplied(0.5325), 53);
});
