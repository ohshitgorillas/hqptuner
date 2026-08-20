// Behavioral suite for the apodizing strip's time-window preference — the
// localStorage-backed choice of how much history the strip shows, one of
// "30" / "60" / "120" / "300" / "all", stored under the house key convention.
//
// The environment is the seam (tests/js/store/plainnames-pref.test.js is the
// pattern): a working fake localStorage is installed and PRE-SEEDED with a
// persisted choice BEFORE prefs.js is imported, so the module's load-time read
// is the one that meets it. No other module in this file may pull prefs.js in
// first. Nothing of HQPTuner's is stubbed.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/apodwindow-pref.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();
storage.setItem("hqptuner.apodWindow", "300");

const prefs = await import("../../../hqptuner/static/store/prefs.js");

// --- the persisted choice is read back at load --------------------------------

test("test_a_persisted_window_loads_as_that_window", () => {
  assert.equal(prefs.apodWindow.value, "300");
});

// --- the setter -----------------------------------------------------------------

test("test_choosing_a_window_persists_it", () => {
  prefs.setApodWindow("120");
  assert.equal(storage.getItem("hqptuner.apodWindow"), "120");
});

test("test_choosing_the_whole_track_persists_all", () => {
  prefs.setApodWindow("all");
  assert.equal(storage.getItem("hqptuner.apodWindow"), "all");
});

test("test_the_setter_moves_the_signal", () => {
  prefs.setApodWindow("30");
  assert.equal(prefs.apodWindow.value, "30");
});
