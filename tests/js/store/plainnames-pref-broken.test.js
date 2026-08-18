// Behavioral suite for the "Option style" preference against a localStorage
// that is PRESENT and refuses every operation — a browser with storage blocked
// by policy, or a full quota (tests/js/store/livecollapse-prefs-broken.test.js
// is the pattern). The contract: an unusable storage reads as Standard and
// costs the user nothing else — the module loads without throwing, and the
// pref still moves in memory.
//
// The throwing fake is installed at file scope, before prefs.js is imported,
// so the module's load-time read is the one that meets it. Nothing of
// HQPTuner's is stubbed.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/plainnames-pref-broken.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useThrowingStorage } from "../support/storage.js";

useThrowingStorage();

const prefs = await import("../../../hqptuner/static/store/prefs.js");

test("test_a_throwing_storage_reads_as_standard", () => {
  assert.equal(prefs.plainNames.value, false);
});

test("test_a_flip_against_a_throwing_storage_does_not_raise", () => {
  assert.doesNotThrow(() => prefs.setPlainNames(true));
});

test("test_a_flip_against_a_throwing_storage_still_moves_the_signal", () => {
  prefs.setPlainNames(true);
  assert.equal(prefs.plainNames.value, true);
});
