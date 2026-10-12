// Behavioral suite for lib/coerce.js wireNum: reading a wire value as a number when blank means the caller's default.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/coerce.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { wireNum } from "../../../hqptuner/static/lib/coerce.js";

test("test_a_blank_value_falls_back_to_the_default", () => {
  assert.equal(wireNum("", -60), -60);
});

test("test_a_missing_value_falls_back_to_the_default", () => {
  assert.equal(wireNum(null, -60), -60);
});

test("test_an_undefined_value_falls_back_to_the_default", () => {
  assert.equal(wireNum(undefined, -60), -60);
});

test("test_a_non_numeric_value_falls_back_to_the_default", () => {
  assert.equal(wireNum("auto", -60), -60);
});

test("test_a_numeric_string_is_read_as_a_number", () => {
  assert.equal(wireNum("-12", -60), -12);
});

test("test_a_zero_is_kept_rather_than_replaced_by_the_default", () => {
  // 0 dBFS is a legal setting, not an absent one
  assert.equal(wireNum("0", -60), 0);
});
