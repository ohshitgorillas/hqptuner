// The apodizing strip's time-window setter — what setApodWindow() writes and
// what the store offers as the windows to choose from.
//
// Storage-shape-independent, which is why it is not in one of the
// tests/js/store/apodwindow-pref*.test.js files: nothing here reads the key at
// load, so these cases neither depend on nor disturb what was stored before
// prefs.js was imported. A working fake localStorage is installed at file scope
// and each case writes and reads it through the public setter only.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/apodwindow-set.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();

const prefs = await import("../../../hqptuner/static/store/prefs.js");

// --- the windows on offer -------------------------------------------------------

test("test_the_store_offers_the_five_windows_shortest_first", () => {
  assert.deepEqual(prefs.APOD_WINDOWS, ["30", "60", "120", "300", "all"]);
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
