// Behavioral suite: finding the option a control's value names, where the value may arrive as a string or a number and
// the option's own value as either.

import test from "node:test";
import assert from "node:assert/strict";

import { optionOf } from "../../../../hqptuner/static/model/shell/options.js";

//: Options the test writes: numeric and string values mixed, as the catalogs carry them.
const OPTS = [
  { v: 0, label: "zero" },
  { v: "1", label: "one" },
  { v: "lshelf", label: "shelf" },
];

test("test_option_of_finds_a_string_value", () => {
  assert.equal(optionOf(OPTS, "lshelf"), OPTS[2]);
});

test("test_option_of_finds_a_numeric_option_from_its_string_form", () => {
  assert.equal(optionOf(OPTS, "0"), OPTS[0]);
});

test("test_option_of_finds_a_string_option_from_a_number", () => {
  assert.equal(optionOf(OPTS, 1), OPTS[1]);
});

test("test_option_of_an_unknown_value_is_undefined", () => {
  assert.equal(optionOf(OPTS, "2"), undefined);
});

test("test_option_of_returns_the_first_of_two_matches", () => {
  assert.equal(optionOf([...OPTS, { v: "0", label: "again" }], 0), OPTS[0]);
});
