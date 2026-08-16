// Behavioral suite for the LIVE cards' disclosure against a localStorage that is
// PRESENT and refuses every operation — a browser with storage blocked by
// policy, or a full quota. Distinct from having no localStorage at all, which
// tests/js/store/prefs.test.js covers: there the member is missing, here every
// call throws.
//
// The environment is the seam again: the throwing fake is installed at file
// scope, before prefs.js is imported, so the module's load-time read is the one
// that meets it. Nothing of ours is stubbed — the fake stands in for the browser
// API, and the code under test is untouched.
//
// The contract: an unusable storage costs the user their saved layout and
// nothing else. Every card loads at its default, and a toggle still moves the
// signal instead of taking the page down with it.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/livecollapse-prefs-broken.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useThrowingStorage } from "../support/storage.js";

useThrowingStorage();

const prefs = await import("../../../hqptuner/static/store/prefs.js");

// --- the defaults survive a storage that cannot be read ---------------------------

test("test_a_throwing_storage_loads_the_narrow_card_open", () => {
  assert.equal(prefs.liveNarrowOpen.value, true);
});

test("test_a_throwing_storage_loads_the_playback_card_open", () => {
  assert.equal(prefs.livePlaybackOpen.value, true);
});

test("test_a_throwing_storage_loads_the_health_card_open", () => {
  assert.equal(prefs.liveHealthOpen.value, true);
});

test("test_a_throwing_storage_loads_the_matrix_card_open", () => {
  assert.equal(prefs.liveMatrixOpen.value, true);
});

// --- and a toggle still works ------------------------------------------------------

test("test_a_toggle_against_a_throwing_storage_does_not_raise", () => {
  assert.doesNotThrow(() => prefs.setLiveCardOpen("narrow", false));
});

test("test_a_toggle_against_a_throwing_storage_still_moves_the_signal", () => {
  prefs.setLiveCardOpen("health", false);
  assert.equal(prefs.liveHealthOpen.value, false);
});
