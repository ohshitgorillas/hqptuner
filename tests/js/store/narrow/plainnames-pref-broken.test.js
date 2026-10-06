// Behavioral suite for the "Option style" preference against a localStorage
// that is PRESENT and refuses every operation — a browser with storage blocked
// by policy, or a full quota (tests/js/store/live/livecollapse-prefs-broken.test.js
// is the pattern). The contract: an unusable storage costs the user nothing —
// the module loads without throwing, and the pref still moves in memory. What
// it loads as is loadBool's (tests/js/store/prefs-loadbool.test.js).
//
// The throwing fake is installed at file scope, before prefs.js is imported,
// so the module's load-time read is the one that meets it. Nothing of
// HQPTuner's is stubbed.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrow/plainnames-pref-broken.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useThrowingStorage } from "../../support/storage.js";

useThrowingStorage();

const prefs = await import("../../../../hqptuner/static/store/ui/prefs.js");

test("test_a_flip_against_a_throwing_storage_does_not_raise", () => {
  assert.doesNotThrow(() => prefs.setPlainNames(!prefs.plainNames.value));
});

test("test_a_flip_against_a_throwing_storage_still_moves_the_signal", () => {
  const flipped = !prefs.plainNames.value;
  prefs.setPlainNames(flipped);
  assert.equal(prefs.plainNames.value, flipped);
});
