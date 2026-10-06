// Behavioral suite for the "Option style" preference against a localStorage
// that is PRESENT and refuses every operation — a browser with storage blocked
// by policy, or a full quota (tests/js/store/live/livecollapse-prefs-broken.test.js
// is the pattern). The contract: an unusable storage reads as Simplified and
// costs the user nothing else — the module loads without throwing, and the
// pref still moves in memory.
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

test("test_a_throwing_storage_reads_as_simplified", () => {
  assert.equal(prefs.plainNames.value, true);
});

test("test_a_flip_against_a_throwing_storage_does_not_raise", () => {
  assert.doesNotThrow(() => prefs.setPlainNames(false));
});

test("test_a_flip_against_a_throwing_storage_still_moves_the_signal", () => {
  prefs.setPlainNames(false);
  assert.equal(prefs.plainNames.value, false);
});
