// Behavioral suite for the LIVE cards' persisted disclosure in store/prefs.js —
// what a stored value does at LOAD, and what the setter writes.
//
// The environment is the seam: prefs.js reads its keys once, when the module is
// first imported, so the storage a case wants read has to be installed BEFORE
// that import. The fake below is therefore installed at file scope and prefs.js
// pulled in dynamically after it — no other module in this file may import
// prefs.js first, and the storage stands for the whole file rather than being
// dropped between cases (the load already happened).
//
// One key is seeded closed and the other three are left absent, so the two
// halves of the default contract are visible in the same process: a stored "0"
// comes back closed, and a key that was never written comes back open.
//
// Policy (docs/testing.md): public API only, one assertion per test. The keys
// are named here because they ARE the contract a persisted preference makes with
// the browser: a rename drops every user's saved layout on the floor.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/livecollapse-prefs.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const KEY = "hqptuner.liveCollapse";

const storage = useStorage();
storage.setItem(`${KEY}.narrow`, "0");

const prefs = await import("../../../hqptuner/static/store/prefs.js");

// --- what storage says at load ---------------------------------------------------

test("test_a_stored_zero_loads_the_narrow_card_closed", () => {
  assert.equal(prefs.liveNarrowOpen.value, false);
});

test("test_an_absent_key_loads_the_playback_card_open", () => {
  assert.equal(prefs.livePlaybackOpen.value, true);
});

test("test_an_absent_key_loads_the_health_card_open", () => {
  assert.equal(prefs.liveHealthOpen.value, true);
});

test("test_an_absent_key_loads_the_matrix_card_open", () => {
  assert.equal(prefs.liveMatrixOpen.value, true);
});

// --- what the setter writes -------------------------------------------------------

test("test_closing_a_card_stores_a_zero_under_that_cards_key", () => {
  prefs.setLiveCardOpen("health", false);
  assert.equal(storage.getItem(`${KEY}.health`), "0");
});

test("test_opening_a_card_stores_a_one_under_that_cards_key", () => {
  prefs.setLiveCardOpen("matrix", false);
  prefs.setLiveCardOpen("matrix", true);
  assert.equal(storage.getItem(`${KEY}.matrix`), "1");
});

test("test_the_setter_moves_the_cards_own_signal", () => {
  prefs.setLiveCardOpen("playback", false);
  assert.equal(prefs.livePlaybackOpen.value, false);
});

test("test_the_setter_leaves_the_other_cards_signals_alone", () => {
  prefs.setLiveCardOpen("playback", false);
  assert.equal(prefs.liveMatrixOpen.value, true);
});
