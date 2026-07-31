// Behavioral suite for scripts/eqlab/expr.js — the little expression evaluator
// behind `expr` metrics and search objectives. Written blind from a spec block:
// no eqlab source was read.
//
// Split out of the former eqlab.test.js; every test here is unchanged.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-expr.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { parse, evaluate, evalExpr } from "../../scripts/eqlab/expr.js";

const ENV = { vars: {}, funcs: {} };

test("test_multiplication_binds_tighter_than_addition", () => {
  assert.equal(evalExpr("2 + 3 * 4", ENV), 14);
});

test("test_parentheses_override_operator_precedence", () => {
  assert.equal(evalExpr("(2 + 3) * 4", ENV), 20);
});

test("test_a_leading_minus_negates_its_operand", () => {
  assert.equal(evalExpr("-3 + 1", ENV), -2);
});

test("test_a_bare_identifier_resolves_against_the_environment_variables", () => {
  assert.equal(evalExpr("body - hot", { vars: { body: 5, hot: 2 }, funcs: {} }), 3);
});

test("test_a_call_resolves_against_the_environment_functions_with_arguments_in_order", () => {
  // Non-commutative on purpose: a + b would pass on reversed arguments.
  assert.equal(evalExpr("mean(1, 2)", { vars: {}, funcs: { mean: (a, b) => a - b } }), -1);
});

test("test_an_unknown_identifier_is_named_in_the_error", () => {
  assert.throws(() => evalExpr("body - hot", { vars: { body: 5 }, funcs: {} }), /hot/);
});

test("test_an_unknown_function_is_named_in_the_error", () => {
  assert.throws(() => evalExpr("boost(1)", { vars: {}, funcs: {} }), /boost/);
});

test("test_a_character_outside_the_grammar_is_rejected", () => {
  assert.throws(() => evalExpr("2 $ 3", ENV));
});

test("test_trailing_input_after_a_complete_expression_is_rejected", () => {
  assert.throws(() => evalExpr("2 3", ENV));
});

const REUSED = parse("x * 2");

test("test_a_parsed_expression_evaluates_against_one_environment", () => {
  assert.equal(evaluate(REUSED, { vars: { x: 2 }, funcs: {} }), 4);
});

test("test_the_same_parsed_expression_re_evaluates_against_a_different_environment", () => {
  assert.equal(evaluate(REUSED, { vars: { x: 5 }, funcs: {} }), 10);
});

test("test_an_empty_expression_is_rejected", () => {
  assert.throws(() => evalExpr("", ENV));
});

test("test_a_non_string_expression_is_rejected", () => {
  assert.throws(() => evalExpr(null, ENV));
});
