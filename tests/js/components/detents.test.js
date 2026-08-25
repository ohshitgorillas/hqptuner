// Behavioral suite for the detent arithmetic behind a stepped slider: which
// option an index names, and which index a stored value lands on. Pure
// functions, called the way a caller calls them.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// The option list is the daemon's — the running engine is the enumeration
// authority — so nothing here hardcodes a list, a length or a bound: every
// expectation is derived from the very list the case feeds in.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/detents.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { stepIndex, stepValue } from "../../../hqptuner/static/components/controls/detents.js";

// The daemon's own fft_size option list, as `GET /config` hands it over: a
// `select` whose option values are STRINGS (docs/protocol.md:76). Five entries,
// not the live eight — the count is the test's to state.
//
// An option's label is a separate field from its value, and only the VALUE is
// the token the wire carries, so one option is given a label that differs from
// it: a step reading labels back would hand the daemon a string it never
// offered, and every case below runs through that option.
const SIZES = ["128", "256", "512", "1024", "2048"];
const LABELED = "512";
/** @type {{ value: string, label: string }[]} */
const OPTIONS = SIZES.map((value) => ({ value, label: value === LABELED ? `${value} (default)` : value }));

// --- index and value arithmetic -----------------------------------------------
// The option list is the daemon's, so a step's value is the daemon's own token
// handed straight back: never reformatted, never renumbered.

test("test_a_step_carries_the_daemons_own_option_value", async () => {
  const at = SIZES.indexOf(LABELED);
  assert.equal(stepValue(at, OPTIONS), OPTIONS[at].value);
});

test("test_a_step_below_the_first_clamps_to_the_first_option", async () => {
  assert.equal(stepValue(-1, OPTIONS), OPTIONS[0].value);
});

test("test_a_step_past_the_last_clamps_to_the_last_option", async () => {
  assert.equal(stepValue(OPTIONS.length, OPTIONS), OPTIONS[OPTIONS.length - 1].value);
});

test("test_a_stored_value_indexes_to_its_own_option", async () => {
  assert.equal(stepIndex("1024", OPTIONS), SIZES.indexOf("1024"));
});

test("test_a_stored_value_off_the_list_indexes_down_to_the_nearest_option", async () => {
  // 700 sits between 512 and 1024 and is nearer 512 (188 away against 324).
  assert.equal(stepIndex("700", OPTIONS), SIZES.indexOf("512"));
});

test("test_a_stored_value_off_the_list_indexes_up_to_the_nearest_option", async () => {
  // 900 sits between the same two and is nearer 1024 (124 away against 388), so
  // a step that merely floors to the last option at or below the value fails
  // here where the case above passes it.
  assert.equal(stepIndex("900", OPTIONS), SIZES.indexOf("1024"));
});

test("test_an_empty_option_list_indexes_to_zero", () => {
  assert.equal(stepIndex("512", []), 0);
});
