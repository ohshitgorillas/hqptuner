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
// The option list is curated data (docs/testing.md rule 9): pin that there is
// one, and that every offered value round-trips through the setter, never the
// list itself.

test("test_the_store_offers_at_least_one_window", () => {
  assert.ok(prefs.APOD_WINDOWS.length > 0);
});

for (const entry of prefs.APOD_WINDOWS) {
  test(`test_choosing_offered_window_${entry}_round_trips_through_the_signal`, () => {
    prefs.setApodWindow(entry);
    assert.equal(prefs.apodWindow.value, entry);
  });
}

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
