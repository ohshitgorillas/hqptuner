// Behavioral suite for a value TYPED into one of the filter primer's number
// boxes (components/primer/Controls.js), written blind from a spec block: no
// control source was read.
//
// The product rule: the slider's range is the range. A figure typed into the box
// reaches the store signal clamped to that row's minimum and maximum, and a box
// holding nothing usable leaves the signal where it was.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Every reading is a number off an exported signal, never a
// word (rule 9); the row a case typed into is named by that row's minimum, which
// the spec states — Length 0.1/50, Roll-off 0/1, Transient 2/50 — and which
// support/primeredit.js turns into a selector that throws unless exactly one box
// answers to it.
//
// A type=number input reports "" for both an empty box and unparseable text, so
// the empty-box case covers both.
//
// Every case starts from the store's own `showMe("intro")` state and leaves it
// there again (signals persist for the life of the file, as
// tests/js/components/primergraph.test.js already handles).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primertyped.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { primerBoxEdit } from "../support/primeredit.js";
import { html } from "../../../hqptuner/static/lib/dom.js";
import { PrimerControls } from "../../../hqptuner/static/components/primer/Controls.js";
import { lengthMs, rolloff, transientUs, showMe } from "../../../hqptuner/static/store/primergraph.js";

// The three rows' minima, which are how a case says which box it typed into.
const LENGTH_MIN = 0.1;
const ROLLOFF_MIN = 0;
const TRANSIENT_MIN = 2;

test.afterEach(() => {
  showMe("intro");
});

const controls = () => html`<${PrimerControls} />`;

// The starting value a case is stated against. Throws rather than asserting: a
// case whose precondition never held must not read as a pass.
/**
 * @param {{ value: number }} signal
 * @param {number} want
 * @param {string} name
 * @returns {void}
 */
function requireStart(signal, want, name) {
  if (signal.value !== want) throw new Error(`${name} starts at ${signal.value}, not ${want}`);
}

test("test_length_typed_within_the_range_reaches_the_design", () => {
  requireStart(lengthMs, 2, "lengthMs");
  primerBoxEdit(controls(), LENGTH_MIN, "8");
  assert.equal(lengthMs.value, 8);
});

test("test_length_typed_above_the_maximum_clamps_to_the_maximum", () => {
  requireStart(lengthMs, 2, "lengthMs");
  primerBoxEdit(controls(), LENGTH_MIN, "500");
  assert.equal(lengthMs.value, 50);
});

test("test_negative_transient_typed_clamps_to_the_minimum", () => {
  requireStart(transientUs, 10, "transientUs");
  primerBoxEdit(controls(), TRANSIENT_MIN, "-5");
  assert.equal(transientUs.value, 2);
});

test("test_emptying_the_rolloff_box_leaves_the_value_alone", () => {
  primerBoxEdit(controls(), ROLLOFF_MIN, "0.8");
  requireStart(rolloff, 0.8, "rolloff");
  primerBoxEdit(controls(), ROLLOFF_MIN, "");
  assert.equal(rolloff.value, 0.8);
});
