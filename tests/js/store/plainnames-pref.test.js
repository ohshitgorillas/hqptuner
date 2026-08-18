// Behavioral suite for the "Option style" preference's persistence — the
// localStorage-backed pref that flips the six chain dropdowns between Standard
// (raw engine names) and Simplified (plain names). Boolean like the store's
// other persisted prefs: false is Standard, true is Simplified, stored under
// the house key convention as "1"/"0".
//
// The environment is the seam (tests/js/store/prefs.test.js): a working fake
// localStorage is installed and PRE-SEEDED with a persisted opt-in BEFORE
// prefs.js is imported, so the module's load-time read is the one that meets
// it. No other module in this file may pull prefs.js in first. Nothing of
// HQPTuner's is stubbed.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/plainnames-pref.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();
storage.setItem("hqptuner.plainNames", "1");

const prefs = await import("../../../hqptuner/static/store/prefs.js");

// --- the persisted choice is read back at load --------------------------------

test("test_a_persisted_simplified_choice_loads_as_simplified", () => {
  assert.equal(prefs.plainNames.value, true);
});

// --- the setter persists -------------------------------------------------------

test("test_choosing_standard_persists_as_zero", () => {
  prefs.setPlainNames(false);
  assert.equal(storage.getItem("hqptuner.plainNames"), "0");
});

test("test_choosing_simplified_persists_as_one", () => {
  prefs.setPlainNames(true);
  assert.equal(storage.getItem("hqptuner.plainNames"), "1");
});

test("test_the_setter_moves_the_signal", () => {
  prefs.setPlainNames(false);
  assert.equal(prefs.plainNames.value, false);
});
