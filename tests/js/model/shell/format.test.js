// Behavioral suite for hqptuner/static/model/shell/format.js: the number forms the faceplate prints (a value with its sign, a
// negative with a typographic minus, a sign always shown, a typed value's hyphen made a minus).
//
// Run: node --test tests/js/model/shell/format.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { minus, minusText, plusMinus, signed } from "../../../../hqptuner/static/model/shell/format.js";

//: The typographic minus every form prints in place of a hyphen.
const MINUS = "−";

// ── signed ───────────────────────────────────────────────────────────────

test("test_signed_puts_a_plus_on_a_positive_value", () => {
  assert.equal(signed(6), "+6");
});

test("test_signed_puts_a_minus_on_a_negative_value", () => {
  assert.equal(signed(-6), `${MINUS}6`);
});

test("test_signed_leaves_zero_bare", () => {
  assert.equal(signed(0), "0");
});

test("test_signed_rounds_to_the_places_asked", () => {
  assert.equal(signed(-3.456, 1), `${MINUS}3.5`);
});

test("test_signed_keeps_trailing_zeros_to_the_places_asked", () => {
  assert.equal(signed(2, 2), "+2.00");
});

test("test_signed_without_places_prints_the_whole_value", () => {
  assert.equal(signed(1.25), "+1.25");
});

// ── minus ────────────────────────────────────────────────────────────────

test("test_minus_puts_a_minus_on_a_negative_value", () => {
  assert.equal(minus(-4.5, 1), `${MINUS}4.5`);
});

test("test_minus_leaves_a_positive_value_unsigned", () => {
  assert.equal(minus(4.5, 1), "4.5");
});

test("test_minus_without_places_prints_the_whole_value", () => {
  assert.equal(minus(-0.125), `${MINUS}0.125`);
});

test("test_minus_rounds_to_the_places_asked", () => {
  assert.equal(minus(-12.345, 2), `${MINUS}12.35`);
});

// ── plusMinus ────────────────────────────────────────────────────────────

test("test_plus_minus_puts_a_plus_on_zero", () => {
  assert.equal(plusMinus(0, 2), "+0.00");
});

test("test_plus_minus_puts_a_minus_on_a_negative_value", () => {
  assert.equal(plusMinus(-0.5, 2), `${MINUS}0.50`);
});

// ── minusText ────────────────────────────────────────────────────────────

test("test_minus_text_turns_a_leading_hyphen_into_a_minus", () => {
  assert.equal(minusText("-60"), `${MINUS}60`);
});

test("test_minus_text_takes_a_number", () => {
  assert.equal(minusText(-3.5), `${MINUS}3.5`);
});

test("test_minus_text_leaves_text_without_a_hyphen_alone", () => {
  assert.equal(minusText("12"), "12");
});
